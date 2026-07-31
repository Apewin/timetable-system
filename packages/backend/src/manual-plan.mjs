function text(value) {
  return String(value ?? '').trim();
}

function uniqueBy(items, keyOf) {
  const seen = new Set();
  return items.filter(item => {
    const key = keyOf(item);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function classCatalog(state) {
  return new Map([
    ...(state.admin_classes || []).map(item => [item.id, { ...item, class_type: 'admin' }]),
    ...(state.teaching_classes || []).map(item => [item.id, { ...item, class_type: 'teaching' }]),
  ]);
}

function normalizePlacement(value, index) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`第 ${index + 1} 条手动安排格式无效`);
  }
  const classId = text(value.class_id);
  const slotId = text(value.slot_id);
  const itemId = text(value.item_id);
  const courseIds = Array.isArray(value.course_ids)
    ? [...new Set(value.course_ids.map(text).filter(Boolean))]
    : [];
  const sectionIds = Array.isArray(value.section_ids)
    ? [...new Set(value.section_ids.map(text).filter(Boolean))]
    : [];
  if (!classId) throw new Error(`第 ${index + 1} 条手动安排缺少班级`);
  if (!/^D[1-5]P(?:[1-9]|10)$/.test(slotId)) {
    throw new Error(`第 ${index + 1} 条手动安排的时段无效: ${slotId || '空'}`);
  }
  if (!itemId) throw new Error(`第 ${index + 1} 条手动安排缺少课程项`);
  if (!courseIds.length) throw new Error(`第 ${index + 1} 条手动安排缺少课程`);
  return {
    class_id: classId,
    slot_id: slotId,
    item_id: itemId,
    item_name: text(value.item_name),
    course_ids: courseIds,
    section_ids: sectionIds,
  };
}

export function normalizeManualPlacements(placements) {
  if (!Array.isArray(placements)) throw new Error('手动课表 placements 必须是数组');
  return uniqueBy(
    placements.map(normalizePlacement),
    item => `${item.class_id}\u0000${item.slot_id}\u0000${item.item_id}`,
  ).sort((left, right) =>
    left.class_id.localeCompare(right.class_id)
    || left.slot_id.localeCompare(right.slot_id)
    || left.item_id.localeCompare(right.item_id));
}

function selectedSectionAppliesToClass(section, classItem) {
  if (!['ap', 'elective'].includes(section.class_type)) return false;
  if (!(section.grades || []).length) return true;
  return section.grades.map(Number).includes(Number(classItem.grade));
}

function expectedSectionsForPlacement(problem, classItem, placement) {
  const courseIds = new Set(placement.course_ids);
  const eligible = problem.sections.filter(section => {
    if (!courseIds.has(section.course_id)) return false;
    if (['ap', 'elective'].includes(section.class_type)) {
      return selectedSectionAppliesToClass(section, classItem);
    }
    return section.class_id === classItem.id && section.class_type === classItem.class_type;
  });
  if (!placement.section_ids.length) return eligible;
  const requested = new Set(placement.section_ids);
  const selected = eligible.filter(section => requested.has(section.id));
  const missing = [...requested].filter(sectionId => !selected.some(section => section.id === sectionId));
  if (missing.length) {
    throw new Error(
      `${classItem.name || classItem.id} 的“${placement.item_name || placement.item_id}”`
      + `引用了不适用于该班级的 section：${missing.join('、')}`,
    );
  }
  return selected;
}

function immediateConflicts(problem, locks) {
  const sectionById = new Map(problem.sections.map(section => [section.id, section]));
  const issues = [];
  const locksBySection = new Map();
  for (const lock of locks) {
    const list = locksBySection.get(lock.section_id) || [];
    list.push(lock);
    locksBySection.set(lock.section_id, list);
  }
  for (const [sectionId, sectionLocks] of locksBySection) {
    const section = sectionById.get(sectionId);
    if (sectionLocks.length > section.weekly_hours) {
      issues.push({
        code: 'WEEKLY_HOURS_EXCEEDED',
        message: `${sectionId} 只有 ${section.weekly_hours} 节/周，却锁定了 ${sectionLocks.length} 个时段`,
        section_ids: [sectionId],
        slot_ids: sectionLocks.map(item => item.slot_id),
      });
    }
  }

  const bySlot = new Map();
  for (const lock of locks) {
    const list = bySlot.get(lock.slot_id) || [];
    list.push(sectionById.get(lock.section_id));
    bySlot.set(lock.slot_id, list);
  }
  for (const [slotId, sections] of bySlot) {
    const teacherOwner = new Map();
    for (const section of sections) {
      if (!section.teacher_id) continue;
      const existing = teacherOwner.get(section.teacher_id);
      if (existing && existing.id !== section.id) {
        issues.push({
          code: 'TEACHER_OVERLAP',
          message: `教师 ${section.teacher_id} 在 ${slotId} 被同时锁定到 ${existing.id} 和 ${section.id}`,
          teacher_id: section.teacher_id,
          section_ids: [existing.id, section.id],
          slot_ids: [slotId],
        });
      } else teacherOwner.set(section.teacher_id, section);
    }

    // Parallel sections of the same selected course share an eligible roster.
    // Treat a course as one attendance unit here, otherwise the same course
    // would falsely conflict with itself before the solver chooses sections.
    const attendanceUnits = new Map();
    for (const section of sections) {
      const selected = ['ap', 'elective'].includes(section.class_type);
      const key = selected ? `${section.class_type}:${section.course_id}` : `section:${section.id}`;
      const unit = attendanceUnits.get(key) || {
        key,
        label: selected ? section.course_id : section.id,
        section_ids: [],
        student_ids: new Set(),
      };
      unit.section_ids.push(section.id);
      const studentIds = selected && (section.eligible_student_ids || []).length
        ? section.eligible_student_ids
        : section.student_ids || [];
      studentIds.forEach(studentId => unit.student_ids.add(studentId));
      attendanceUnits.set(key, unit);
    }
    const units = [...attendanceUnits.values()];
    for (let left = 0; left < units.length; left++) for (let right = left + 1; right < units.length; right++) {
      const shared = [...units[left].student_ids].filter(studentId => units[right].student_ids.has(studentId));
      if (!shared.length) continue;
      issues.push({
        code: 'STUDENT_OVERLAP',
        message: `${shared.length} 名学生在 ${slotId} 被同时锁定到 ${units[left].label} 和 ${units[right].label}`,
        student_ids: shared,
        section_ids: [...units[left].section_ids, ...units[right].section_ids],
        slot_ids: [slotId],
      });
    }
  }
  return uniqueBy(issues, issue =>
    `${issue.code}\u0000${(issue.section_ids || []).slice().sort().join(',')}\u0000${(issue.slot_ids || []).join(',')}`);
}

/**
 * Resolves visual manual-timetable cells to canonical section meeting locks.
 * The browser is never trusted to invent section IDs: every requested section
 * must still match the selected class, grade and course in the current model.
 */
export function resolveManualPlan(state, problem, rawPlacements) {
  const placements = normalizeManualPlacements(rawPlacements);
  const classes = classCatalog(state);
  const courseIds = new Set((state.courses || []).map(course => course.id));
  const locks = [];
  const resolvedPlacements = [];
  for (const placement of placements) {
    const classItem = classes.get(placement.class_id);
    if (!classItem) throw new Error(`手动课表引用了不存在的班级: ${placement.class_id}`);
    const missingCourses = placement.course_ids.filter(courseId => !courseIds.has(courseId));
    if (missingCourses.length) throw new Error(`手动课表引用了不存在的课程: ${missingCourses.join('、')}`);
    const sections = expectedSectionsForPlacement(problem, classItem, placement);
    if (!sections.length) {
      throw new Error(
        `${classItem.name || classItem.id} 的“${placement.item_name || placement.item_id}”`
        + '没有匹配到可排 section；课程适用年级、班级或教师分工可能已变更',
      );
    }
    // An unqualified AP/elective course with several parallel sections is
    // ambiguous. The UI emits explicit section IDs for these cards.
    const selectedSections = sections.filter(section => ['ap', 'elective'].includes(section.class_type));
    if (!placement.section_ids.length && placement.course_ids.length === 1 && selectedSections.length > 1) {
      throw new Error(
        `${placement.item_name || placement.item_id} 有 ${selectedSections.length} 个平行 section，`
        + '请从课程池选择标有 Section 的具体课程卡',
      );
    }
    for (const section of sections) {
      locks.push({
        section_id: section.id,
        slot_id: placement.slot_id,
        origin: 'manual',
        class_id: placement.class_id,
        item_id: placement.item_id,
      });
    }
    resolvedPlacements.push({ ...placement, section_ids: sections.map(section => section.id).sort() });
  }
  const uniqueLocks = uniqueBy(locks, lock => `${lock.section_id}\u0000${lock.slot_id}`);
  return {
    placements: resolvedPlacements,
    locks: uniqueLocks,
    issues: immediateConflicts(problem, uniqueLocks),
    counts: {
      visual_placements: resolvedPlacements.length,
      section_locks: uniqueLocks.length,
    },
  };
}

export function mergedMeetingLocks(...groups) {
  return uniqueBy(
    groups.flat().filter(Boolean).map(lock => ({
      ...lock,
      section_id: text(lock.section_id),
      slot_id: text(lock.slot_id),
    })).filter(lock => lock.section_id && lock.slot_id),
    lock => `${lock.section_id}\u0000${lock.slot_id}`,
  );
}

export function emptyManualPlan() {
  return {
    version: 0,
    draft_revision: 0,
    status: 'draft',
    placements: [],
    locks: [],
    issues: [],
  };
}
