import { synchronizeClassMemberships } from './state-integrity.mjs';

export const GRADUATION_CONFIRMATION = '确认毕业';

const SCHOOL_GRADES = [10, 11, 12];

function text(value) {
  return String(value ?? '').trim();
}

function clone(value) {
  return structuredClone(value);
}

function classOrder(left, right) {
  const numberOf = item => {
    const match = /(\d+)(?!.*\d)/.exec(text(item.name) || text(item.id));
    return match ? Number(match[1]) : Number.MAX_SAFE_INTEGER;
  };
  return numberOf(left) - numberOf(right) || text(left.id).localeCompare(text(right.id));
}

function withoutRoster(classItem, { id = classItem.id, grade = classItem.grade, name = classItem.name } = {}) {
  const rest = clone(classItem);
  delete rest.student_ids;
  delete rest.student_count;
  return { ...rest, id, grade, name };
}

function promotedClassName(name, fromGrade, toGrade) {
  const fromSenior = fromGrade - 9;
  const toSenior = toGrade - 9;
  const chineseNumerals = ['', '一', '二', '三'];
  const fromChinese = chineseNumerals[fromSenior];
  const toChinese = chineseNumerals[toSenior];
  return text(name)
    .replace(new RegExp(`高\\s*(?:${fromSenior}|${fromChinese})`, 'g'), `高${toChinese}`)
    .replace(new RegExp(`Senior\\s*${fromSenior}`, 'gi'), `Senior ${toSenior}`)
    .replace(new RegExp(`Grade\\s*${fromGrade}`, 'gi'), `Grade ${toGrade}`)
    .replace(new RegExp(`G${fromGrade}`, 'g'), `G${toGrade}`);
}

function classRollover(classes, label) {
  const groups = Object.fromEntries(SCHOOL_GRADES.map(grade => [grade, []]));
  const other = [];
  for (const classItem of classes || []) {
    const grade = Number(classItem.grade);
    if (SCHOOL_GRADES.includes(grade)) groups[grade].push(classItem);
    else other.push(clone(classItem));
  }
  for (const grade of SCHOOL_GRADES) groups[grade].sort(classOrder);

  if (!groups[10].length || !groups[11].length || !groups[12].length) {
    throw new Error(`无法执行学生毕业：${label}必须同时配置 Senior 1、Senior 2、Senior 3 的班级槽位`);
  }
  if (groups[10].length !== groups[11].length || groups[11].length !== groups[12].length) {
    throw new Error(
      `无法执行学生毕业：${label}在三个年级的班级数量不一致（Senior 1 ${groups[10].length} 个、Senior 2 ${groups[11].length} 个、Senior 3 ${groups[12].length} 个）。请先在班级管理中调整为一一对应的班级槽位。`,
    );
  }

  const promotedIds = new Map();
  groups[10].forEach((source, index) => promotedIds.set(source.id, groups[11][index].id));
  groups[11].forEach((source, index) => promotedIds.set(source.id, groups[12][index].id));

  const next = [
    ...other,
    // Reuse the old Senior 1 slots as empty slots for the incoming cohort.
    ...groups[10].map(item => withoutRoster(item, { grade: 10 })),
    // Existing Senior 1 and Senior 2 cohorts take the canonical next-grade
    // IDs. Course scopes and teaching assignments therefore keep referring to
    // the intended grade rather than to last year's cohort.
    ...groups[10].map((item, index) => withoutRoster(item, {
      id: groups[11][index].id,
      grade: 11,
      name: promotedClassName(item.name, 10, 11),
    })),
    ...groups[11].map((item, index) => withoutRoster(item, {
      id: groups[12][index].id,
      grade: 12,
      name: promotedClassName(item.name, 11, 12),
    })),
  ].sort((left, right) => Number(left.grade) - Number(right.grade) || classOrder(left, right));

  return {
    classes: next,
    promoted_ids: promotedIds,
    counts: Object.fromEntries(SCHOOL_GRADES.map(grade => [grade, groups[grade].length])),
  };
}

function selectionTotals(students) {
  return (students || []).reduce((summary, student) => {
    const ap = (student.ap_courses || []).filter(Boolean);
    const electiveCourses = (student.elective_courses || []).filter(Boolean);
    const elective = Object.values(student.elective_choices || {}).filter(Boolean);
    summary.ap_course_entries += ap.length;
    summary.elective_course_entries += electiveCourses.length;
    summary.elective_choice_entries += elective.length;
    if (ap.length) summary.students_with_ap += 1;
    if (electiveCourses.length || elective.length) summary.students_with_electives += 1;
    return summary;
  }, {
    ap_course_entries: 0,
    elective_course_entries: 0,
    elective_choice_entries: 0,
    students_with_ap: 0,
    students_with_electives: 0,
  });
}

function graduateSnapshot(student) {
  return {
    student_id: student.id,
    chinese_name: student.name || '',
    english_name: student.english_name || '',
    pinyin_name: student.pinyin_name || '',
    final_grade: Number(student.grade),
    admin_class_id: student.admin_class_id || '',
    teaching_class_id: student.teaching_class_id || '',
    source_admin_class: student.source_admin_class || '',
    source_teaching_class: student.source_teaching_class || '',
    ap_courses: [...(student.ap_courses || [])],
    elective_choices: { ...(student.elective_choices || {}) },
    elective_courses: [...(student.elective_courses || [])],
    courses: [...(student.courses || [])],
    required_courses: [...(student.required_courses || [])],
  };
}

function archiveId(existing = [], now) {
  const stamp = String(now).replace(/[^0-9]/g, '').slice(0, 14) || Date.now().toString();
  const prefix = `GRADUATES_${stamp}`;
  const ids = new Set(existing.map(item => item.id));
  let id = prefix;
  let suffix = 2;
  while (ids.has(id)) id = `${prefix}_${suffix++}`;
  return id;
}

function courseCatalogSnapshot(courses) {
  return (courses || []).map(course => ({
    id: course.id,
    name: course.name || course.id,
    type: course.type || '',
    grade: clone(course.grade),
    elective_group: course.elective_group || '',
  }));
}

function rolloutPreview(state, { admin, teaching }) {
  const graduating = (state.students || []).filter(student => Number(student.grade) === 12);
  if (!graduating.length) {
    throw new Error('当前没有 Senior 3 学生，无法执行毕业操作。该操作不能重复执行。');
  }
  const currentStudents = state.students || [];
  const continuingStudents = currentStudents
    .filter(student => Number(student.grade) === 10 || Number(student.grade) === 11);
  const activeSelectionTotals = selectionTotals(continuingStudents);
  return {
    confirmation_required: true,
    confirmation_phrase: GRADUATION_CONFIRMATION,
    expected_revision: Number(state.meta?.revision) || 0,
    graduating_students: graduating.length,
    promoted_students: {
      senior_1_to_senior_2: currentStudents.filter(student => Number(student.grade) === 10).length,
      senior_2_to_senior_3: currentStudents.filter(student => Number(student.grade) === 11).length,
    },
    class_slots: {
      admin: admin.counts,
      teaching: teaching.counts,
    },
    preserved_graduate_selection_totals: selectionTotals(graduating),
    active_selection_totals_to_clear: activeSelectionTotals,
    active_selection_entries_to_clear:
      activeSelectionTotals.ap_course_entries
      + activeSelectionTotals.elective_course_entries
      + activeSelectionTotals.elective_choice_entries,
    existing_graduation_archives: (state.graduation_archives || []).length,
    resets: [
      '当前课表会被清空，需要按新学年数据重新排课。',
      '已确认的手动必要条件会解除，金框课程不会带入新学年。',
      '原 Senior 3 学生会从当前学生库移除，但其选课快照会保存在“毕业学生选课信息”。',
      '所有继续在校学生的 AP、其他选修和 A/B/C 选课组信息会被清空；请在新学年重新导入选课。',
    ],
  };
}

export function graduationPreview(state = {}) {
  const admin = classRollover(state.admin_classes || [], '行政班');
  const teaching = classRollover(state.teaching_classes || [], '教学班');
  return rolloutPreview(state, { admin, teaching });
}

export function graduationArchiveSummary(archive = {}) {
  const totals = archive.selection_totals || selectionTotals(archive.students || []);
  return {
    id: archive.id,
    name: archive.name || `毕业学生选课信息 · ${archive.graduated_at || ''}`,
    graduated_at: archive.graduated_at,
    confirmed_by: archive.confirmed_by || '',
    source_revision: archive.source_revision ?? null,
    graduate_count: archive.graduate_count ?? (archive.students || []).length,
    ap_course_entries: totals.ap_course_entries || 0,
    elective_course_entries: totals.elective_course_entries || 0,
    elective_choice_entries: totals.elective_choice_entries || 0,
    cleared_active_selection_entries: Number(archive.cleared_active_selection_entries) || 0,
  };
}

/**
 * Roll the active student population into a new school year. This function is
 * intentionally deterministic and does not write to disk; the HTTP handler
 * performs the final version-checked write after an administrator confirms.
 */
export function graduateStudents(state = {}, { confirmedBy = '管理员', now = new Date().toISOString() } = {}) {
  const admin = classRollover(state.admin_classes || [], '行政班');
  const teaching = classRollover(state.teaching_classes || [], '教学班');
  rolloutPreview(state, { admin, teaching });
  const graduates = (state.students || []).filter(student => Number(student.grade) === 12);
  const continuingStudents = (state.students || [])
    .filter(student => Number(student.grade) === 10 || Number(student.grade) === 11);
  const clearedActiveSelectionTotals = selectionTotals(continuingStudents);
  const students = (state.students || []).flatMap(student => {
    const grade = Number(student.grade);
    if (grade === 12) return [];
    if (grade !== 10 && grade !== 11) return [clone(student)];
    return [{
      ...clone(student),
      grade: grade + 1,
      admin_class_id: admin.promoted_ids.get(student.admin_class_id) || student.admin_class_id,
      teaching_class_id: teaching.promoted_ids.get(student.teaching_class_id) || student.teaching_class_id,
      // A new school year requires a fresh course-selection import. Required
      // course data remains intact, while every elective source is cleared.
      ap_courses: [],
      elective_courses: [],
      elective_choices: {},
    }];
  });
  const archive = {
    id: archiveId(state.graduation_archives || [], now),
    name: `毕业学生选课信息 · ${String(now).slice(0, 10)}`,
    graduated_at: now,
    confirmed_by: text(confirmedBy) || '管理员',
    source_revision: Number(state.meta?.revision) || 0,
    graduate_count: graduates.length,
    selection_totals: selectionTotals(graduates),
    cleared_active_selection_totals: clearedActiveSelectionTotals,
    cleared_active_selection_entries:
      clearedActiveSelectionTotals.ap_course_entries
      + clearedActiveSelectionTotals.elective_course_entries
      + clearedActiveSelectionTotals.elective_choice_entries,
    students: graduates.map(graduateSnapshot),
    course_catalog: courseCatalogSnapshot(state.courses || []),
  };
  const next = synchronizeClassMemberships({
    ...state,
    students,
    admin_classes: admin.classes,
    teaching_classes: teaching.classes,
    graduation_archives: [archive, ...(state.graduation_archives || [])],
  });
  return { next, archive, preview: graduationArchiveSummary(archive) };
}
