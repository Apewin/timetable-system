const SLOT_PATTERN = /^D[1-9]\d*P[1-9]\d*$/;

// A Block is first a student-and-section cohort, not a preselected time band.
// Administrators may optionally enter fixed weekly slots in 分班管理 only after
// the school has decided to make those times non-negotiable.
export const DEFAULT_AP_BLOCKS = [
  { id: 'AP_BLOCK_1', name: 'Block 1', slots: [] },
  { id: 'AP_BLOCK_2', name: 'Block 2', slots: [] },
  { id: 'AP_BLOCK_3', name: 'Block 3', slots: [] },
];

function byId(items = []) {
  return new Map(items.map(item => [item.id, item]));
}

function sectionLimit(course) {
  const value = course.section_count;
  if (Array.isArray(value)) {
    const values = value.filter(Number.isInteger).filter(item => item > 0);
    return values.length ? Math.max(...values) : 1;
  }
  return Number.isInteger(value) && value > 0 ? value : 1;
}

function combinations(items, count, start = 0, prefix = [], output = []) {
  if (prefix.length === count) {
    output.push(prefix);
    return output;
  }
  for (let index = start; index <= items.length - (count - prefix.length); index++) {
    combinations(items, count, index + 1, [...prefix, items[index]], output);
  }
  return output;
}

function displayName(course) {
  return course.name || course.id;
}

/**
 * Returns a complete, editable Block-mode configuration.  `course_block_ids`
 * declares candidate Blocks, rather than forcing every candidate to open;
 * the sectioning engine will open no more than the configured section count.
 */
export function defaultApBlockConfig() {
  return {
    enabled: false,
    blocks: structuredClone(DEFAULT_AP_BLOCKS),
    course_block_ids: {},
    offering_block_ids: {},
  };
}

function cohortLabelForGrades(grades) {
  return `G${[...new Set(grades.map(Number))].sort((left, right) => left - right).join('_G')}`;
}

function configuredOfferingIds(courses) {
  const ids = new Set();
  for (const course of courses) for (const requirement of course.section_requirements || []) {
    const grades = [...new Set((requirement.grades || []).map(Number))]
      .filter(grade => [10, 11, 12].includes(grade));
    if (grades.length) ids.add(`${course.id}:${cohortLabelForGrades(grades)}`);
  }
  return ids;
}

export function normalizeApBlockConfig(raw, courses = []) {
  const fallback = defaultApBlockConfig();
  if (raw === undefined || raw === null) return fallback;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('AP Block 配置必须是对象');
  }
  if (raw.enabled !== undefined && typeof raw.enabled !== 'boolean') {
    throw new Error('AP Block 模式 enabled 必须是布尔值');
  }
  const blocks = raw.blocks === undefined ? fallback.blocks : raw.blocks;
  if (!Array.isArray(blocks) || blocks.length < 2 || blocks.length > 6) {
    throw new Error('AP Block 模式需要 2–6 个 Block');
  }
  const ids = new Set();
  const allSlots = new Set();
  const normalizedBlocks = blocks.map((block, index) => {
    if (!block || typeof block !== 'object' || Array.isArray(block)) {
      throw new Error(`第 ${index + 1} 个 AP Block 无效`);
    }
    const id = String(block.id || '').trim();
    const name = String(block.name || '').trim();
    if (!id || !name) throw new Error('每个 AP Block 都需要 ID 和名称');
    if (ids.has(id)) throw new Error(`AP Block ID 重复: ${id}`);
    ids.add(id);
    const slots = block.slots === undefined || block.slots === null ? [] : block.slots;
    if (!Array.isArray(slots) || !slots.every(slot => typeof slot === 'string' && SLOT_PATTERN.test(slot))) {
      throw new Error(`AP Block ${name} 的固定时段必须是 D1P1 格式的数组`);
    }
    if (new Set(slots).size !== slots.length) throw new Error(`AP Block ${name} 的固定时段重复`);
    for (const slot of slots) {
      if (allSlots.has(slot)) throw new Error(`AP Block 固定时段不能重叠: ${slot}`);
      allSlots.add(slot);
    }
    return { id, name, slots: [...slots] };
  });
  const courseMap = byId(courses);
  const rawCandidates = raw.course_block_ids === undefined ? {} : raw.course_block_ids;
  if (!rawCandidates || typeof rawCandidates !== 'object' || Array.isArray(rawCandidates)) {
    throw new Error('AP Block 的课程候选 Block 必须是对象');
  }
  const courseBlockIds = {};
  for (const [courseId, value] of Object.entries(rawCandidates)) {
    const course = courseMap.get(courseId);
    if (!course || course.type !== 'ap') throw new Error(`AP Block 引用了不存在的 AP 课程: ${courseId}`);
    if (!Array.isArray(value) || !value.length || !value.every(item => typeof item === 'string' && ids.has(item))) {
      throw new Error(`课程 ${displayName(course)} 至少需要一个有效的候选 Block`);
    }
    if (new Set(value).size !== value.length) throw new Error(`课程 ${displayName(course)} 的候选 Block 重复`);
    courseBlockIds[courseId] = [...value];
  }
  const knownOfferingIds = configuredOfferingIds(courses);
  const rawOfferingCandidates = raw.offering_block_ids === undefined ? {} : raw.offering_block_ids;
  if (!rawOfferingCandidates || typeof rawOfferingCandidates !== 'object' || Array.isArray(rawOfferingCandidates)) {
    throw new Error('AP Block 的分年级课程候选 Block 必须是对象');
  }
  const offeringBlockIds = {};
  for (const [offeringId, value] of Object.entries(rawOfferingCandidates)) {
    if (!knownOfferingIds.has(offeringId)) throw new Error(`AP Block 引用了不存在的分年级课程班: ${offeringId}`);
    if (!Array.isArray(value) || !value.length || !value.every(item => typeof item === 'string' && ids.has(item))) {
      throw new Error(`分年级课程班 ${offeringId} 至少需要一个有效的候选 Block`);
    }
    if (new Set(value).size !== value.length) throw new Error(`分年级课程班 ${offeringId} 的候选 Block 重复`);
    offeringBlockIds[offeringId] = [...value];
  }
  return {
    enabled: raw.enabled === true,
    blocks: normalizedBlocks,
    course_block_ids: courseBlockIds,
    offering_block_ids: offeringBlockIds,
  };
}

export function apBlockConfigForState(state) {
  return normalizeApBlockConfig(state.ap_block_config, state.courses || []);
}

function teacherForOffering(state, offering, resolveTeacher) {
  const teacher = offering.teacher_id
    ? (state.teachers || []).find(item => item.id === offering.teacher_id)
    : resolveTeacher(offering.course_id);
  if (!teacher || !(teacher.can_teach || []).includes(offering.course_id)) {
    throw new Error(`课程 ${displayName(offering.course)} 没有可教授该 Block 班的教师`);
  }
  return teacher;
}

function apOfferings(studentsByCourse, courses) {
  const offerings = new Map();
  for (const [courseId, students] of studentsByCourse) {
    const course = courses.get(courseId);
    const requirements = course.section_requirements?.length ? course.section_requirements : null;
    if (!requirements) {
      offerings.set(courseId, {
        id: courseId,
        course_id: courseId,
        course,
        students,
        section_limit: sectionLimit(course),
        teacher_id: null,
        cohort_label: 'ALL',
      });
      continue;
    }
    const claimed = new Set();
    for (const requirement of requirements) {
      const grades = [...new Set((requirement.grades || []).map(Number))].sort((left, right) => left - right);
      if (!grades.length || !grades.every(grade => [10, 11, 12].includes(grade))) {
        throw new Error(`课程 ${displayName(course)} 的 AP Block 分班要求包含无效年级`);
      }
      if (!Number.isInteger(requirement.count) || requirement.count < 1) {
        throw new Error(`课程 ${displayName(course)} 的 AP Block 分班要求缺少有效 Section 数`);
      }
      const roster = new Map([...students].filter(([, student]) => grades.includes(Number(student.grade))));
      for (const studentId of roster.keys()) {
        if (claimed.has(studentId)) throw new Error(`课程 ${displayName(course)} 的 AP Block 分班要求重复覆盖学生 ${studentId}`);
        claimed.add(studentId);
      }
      if (!roster.size) continue;
      const cohortLabel = cohortLabelForGrades(grades);
      offerings.set(`${courseId}:${cohortLabel}`, {
        id: `${courseId}:${cohortLabel}`,
        course_id: courseId,
        course,
        students: roster,
        section_limit: requirement.count,
        teacher_id: requirement.teacher_id || null,
        cohort_label: cohortLabel,
      });
    }
    if (claimed.size !== students.size) {
      const missing = [...students.keys()].filter(studentId => !claimed.has(studentId));
      throw new Error(`课程 ${displayName(course)} 的 AP Block 分班要求未覆盖学生: ${missing.join('、')}`);
    }
  }
  return offerings;
}

function assignStudentCourses(studentCourses, courseBlocks, blockIds, rosterCounts) {
  const orderedCourses = [...studentCourses].sort((left, right) =>
    courseBlocks.get(left).length - courseBlocks.get(right).length || left.localeCompare(right));
  const assignments = new Map();
  const used = new Set();
  const visit = index => {
    if (index === orderedCourses.length) return true;
    const courseId = orderedCourses[index];
    const choices = [...courseBlocks.get(courseId)].sort((left, right) => {
      const leftLoad = rosterCounts.get(`${courseId}\u0000${left}`) || 0;
      const rightLoad = rosterCounts.get(`${courseId}\u0000${right}`) || 0;
      const leftGlobal = rosterCounts.get(`*\u0000${left}`) || 0;
      const rightGlobal = rosterCounts.get(`*\u0000${right}`) || 0;
      return leftLoad - rightLoad || leftGlobal - rightGlobal || blockIds.indexOf(left) - blockIds.indexOf(right);
    });
    for (const blockId of choices) {
      if (used.has(blockId)) continue;
      assignments.set(courseId, blockId);
      used.add(blockId);
      if (visit(index + 1)) return true;
      used.delete(blockId);
      assignments.delete(courseId);
    }
    return false;
  };
  return visit(0) ? assignments : null;
}

function studentCourseRecords(offerings) {
  const coursesByStudent = new Map();
  for (const [offeringId, offering] of offerings) for (const student of offering.students.values()) {
    const selected = coursesByStudent.get(student.id) || { student, courseIds: [] };
    selected.courseIds.push(offeringId);
    coursesByStudent.set(student.id, selected);
  }
  return [...coursesByStudent.values()].sort((left, right) =>
    right.courseIds.length - left.courseIds.length || left.student.id.localeCompare(right.student.id));
}

function assertStudentBlockCapacity(records, blockIds) {
  for (const { student, courseIds } of records) {
    // AP selection count is not a graduation/roster-completeness rule.  A
    // student who chose one or two APs is fully valid and receives only the
    // corresponding distinct Blocks.  We only reject a true structural
    // impossibility: more selected courses than available time Blocks.
    if (courseIds.length > blockIds.length) {
      throw new Error(
        `学生 ${student.name || student.id} 选择了 ${courseIds.length} 门 AP，但当前只有 ${blockIds.length} 个 Block；请增加 Block 或调整选课`,
      );
    }
  }
}

function canUseDistinctBlocks(courseIds, blocksByOffering) {
  const ordered = [...courseIds].sort((left, right) =>
    (blocksByOffering.get(left)?.length || 0) - (blocksByOffering.get(right)?.length || 0)
      || left.localeCompare(right));
  const used = new Set();
  const visit = index => {
    if (index === ordered.length) return true;
    for (const blockId of blocksByOffering.get(ordered[index]) || []) {
      if (used.has(blockId)) continue;
      used.add(blockId);
      if (visit(index + 1)) return true;
      used.delete(blockId);
    }
    return false;
  };
  return visit(0);
}

function canCompleteStudentAssignments(records, selected, candidateSets) {
  return records.every(({ courseIds }) => {
    const blocksByOffering = new Map(courseIds.map(offeringId => {
      const selectedBlocks = selected.get(offeringId);
      if (selectedBlocks) return [offeringId, selectedBlocks];
      const candidateBlocks = [...new Set((candidateSets.get(offeringId) || []).flat())];
      return [offeringId, candidateBlocks];
    }));
    return canUseDistinctBlocks(courseIds, blocksByOffering);
  });
}

function assignRosters(offerings, courseBlocks, blockIds, records = studentCourseRecords(offerings)) {
  assertStudentBlockCapacity(records, blockIds);
  const rosterCounts = new Map();
  const rosters = new Map();
  for (const { student, courseIds } of records) {
    const assignment = assignStudentCourses(courseIds, courseBlocks, blockIds, rosterCounts);
    if (!assignment) return null;
    for (const [offeringId, blockId] of assignment) {
      const key = JSON.stringify([offeringId, blockId]);
      const roster = rosters.get(key) || [];
      roster.push(student);
      rosters.set(key, roster);
      const countKey = `${offeringId}\u0000${blockId}`;
      rosterCounts.set(countKey, (rosterCounts.get(countKey) || 0) + 1);
      rosterCounts.set(`*\u0000${blockId}`, (rosterCounts.get(`*\u0000${blockId}`) || 0) + 1);
    }
  }
  return rosters;
}

function chooseCourseBlocks(state, offerings, config, resolveTeacher) {
  const blockIds = config.blocks.map(block => block.id);
  const candidateSets = new Map();
  const teachersByOffering = new Map();
  for (const [offeringId, offering] of offerings) {
    const allowed = config.offering_block_ids[offeringId]
      || config.course_block_ids[offering.course_id]
      || blockIds;
    const count = Math.min(offering.section_limit, allowed.length);
    candidateSets.set(offeringId, combinations(allowed, count)
      .sort((left, right) => left.join('|').localeCompare(right.join('|'))));
    teachersByOffering.set(offeringId, teacherForOffering(state, offering, resolveTeacher));
  }

  const records = studentCourseRecords(offerings);
  assertStudentBlockCapacity(records, blockIds);
  const courseEntries = [...offerings.entries()].sort(([leftId, left], [rightId, right]) => {
    const leftCandidates = candidateSets.get(leftId)?.length || 0;
    const rightCandidates = candidateSets.get(rightId)?.length || 0;
    return leftCandidates - rightCandidates
      || right.students.size - left.students.size
      || leftId.localeCompare(rightId);
  });

  // This is a small, deterministic CSP for Block membership, not a timetable
  // enumeration.  The old implementation sampled 160 random combinations;
  // that made dense but feasible real rosters intermittently look impossible.
  const selected = new Map();
  const teacherBlocks = new Map();
  const maxSearchNodes = 250000;
  let searchNodes = 0;
  const search = index => {
    if (searchNodes++ >= maxSearchNodes) return null;
    if (index === courseEntries.length) return assignRosters(offerings, selected, blockIds, records);
    const [offeringId] = courseEntries[index];
    const teacher = teachersByOffering.get(offeringId);
    const occupied = teacherBlocks.get(teacher.id) || new Set();
    for (const blockSet of candidateSets.get(offeringId) || []) {
      if (blockSet.some(blockId => occupied.has(blockId))) continue;
      selected.set(offeringId, blockSet);
      const nextOccupied = new Set([...occupied, ...blockSet]);
      teacherBlocks.set(teacher.id, nextOccupied);
      if (canCompleteStudentAssignments(records, selected, candidateSets)) {
        const rosters = search(index + 1);
        if (rosters) return rosters;
      }
      selected.delete(offeringId);
      if (occupied.size) teacherBlocks.set(teacher.id, occupied);
      else teacherBlocks.delete(teacher.id);
    }
    return null;
  };

  const rosters = search(0);
  if (rosters) return { courseBlocks: selected, rosters };
  const names = [...new Set(courseEntries.map(([, offering]) => displayName(offering.course)))].join('、');
  if (searchNodes >= maxSearchNodes) {
    throw new Error(
      `AP Block 分班搜索未能在 ${maxSearchNodes.toLocaleString()} 个候选组合内完成（${names}）。请缩小课程候选 Block 或增加 Block。`,
    );
  }
  throw new Error(
    `AP Block 分班无法为已选课程构造无冲突组合（${names}）。请在 Block 配置中调整课程候选 Block 或增加 Block。`,
  );
}

/**
 * Builds AP sections whose rosters have already been assigned to one Block.
 * This is deliberately a small constructive preprocessing step, independent
 * of the whole-school timetable solver; it never enumerates full timetables.
 */
export function buildApBlockSections(state, courses, studentsByCourse, resolveTeacher) {
  const config = apBlockConfigForState(state);
  if (!config.enabled) return null;
  if (!studentsByCourse.size) return [];
  const offerings = apOfferings(studentsByCourse, courses);
  const { rosters } = chooseCourseBlocks(state, offerings, config, resolveTeacher);
  const blockById = byId(config.blocks);
  const sections = [];
  for (const [key, students] of [...rosters.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    const [offeringId, blockId] = JSON.parse(key);
    const offering = offerings.get(offeringId);
    const course = offering.course;
    const block = blockById.get(blockId);
    if (block.slots.length && block.slots.length !== course.weekly_hours) {
      throw new Error(
        `${displayName(course)} 每周 ${course.weekly_hours} 节，不能放入 ${block.name} 的 ${block.slots.length} 个固定时段`,
      );
    }
    const teacher = teacherForOffering(state, offering, resolveTeacher);
    sections.push({
      id: `SEC_AP_${offering.course_id}_${offering.cohort_label}_${blockId}`,
      course_id: offering.course_id,
      teacher_id: teacher.id,
      class_id: null,
      class_type: 'ap',
      source: 'ap',
      cohort_id: `AP_BLOCK:${blockId}:${offering.cohort_label}`,
      ap_block_id: block.id,
      ap_block_name: block.name,
      ap_block_slots: [...block.slots],
      weekly_hours: course.weekly_hours,
      student_ids: students.map(student => student.id).sort(),
      // A Block roster is computed from all of a student's AP choices. It is
      // intentionally not a freely interchangeable "parallel class".
      eligible_student_ids: students.map(student => student.id).sort(),
      room_id: null,
      room_candidates: [],
      room_binding: 'disabled',
      capacity: null,
      warnings: [`AP ${block.name}：同 Block 课程同步上课`],
    });
  }
  return sections;
}
