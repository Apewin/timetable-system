import { compileRules } from './rule-compiler.mjs';
import { buildSections } from './section-builder.mjs';

function synchronizedSelectionBlockRules(state, sections) {
  return (state.selection_blocks || [])
    .filter(block => block.synchronized_time_block === true)
    .map(block => {
      const targets = sections.filter(section =>
        section.source === 'required_elective' && (block.allowed_course_ids || []).includes(section.course_id));
      const courseIds = new Set(targets.map(section => section.course_id));
      if (courseIds.size !== (block.allowed_course_ids || []).length) {
        throw new Error(`同步选课组 ${block.id} 没有生成全部允许课程的 section`);
      }
      return {
        id: `selection_block_${block.id}_synchronized_slots`,
        name: `${block.name || block.id} 同步时间块`,
        type: 'synchronized_slots', hard: true, weight: 0, scope: 'section',
        target_ids: targets.map(section => section.id), section_target_ids: targets.map(section => section.id),
        params: {}, unmatched: false,
      };
    });
}

function synchronizedAssignmentRules(sections) {
  const groups = new Map();
  for (const section of sections) {
    if (!section.synchronized_group_id) continue;
    const targets = groups.get(section.synchronized_group_id) || [];
    targets.push(section);
    groups.set(section.synchronized_group_id, targets);
  }
  return [...groups].filter(([, targets]) => targets.length > 1).map(([assignmentId, targets]) => ({
    id: `assignment_${assignmentId}_synchronized_slots`,
    name: `${assignmentId} 各班同步时间`,
    type: 'synchronized_slots', hard: true, weight: 0, scope: 'section',
    target_ids: targets.map(section => section.id).sort(),
    section_target_ids: targets.map(section => section.id).sort(),
    params: {}, unmatched: false,
  }));
}

function incompleteRequiredChoices(state) {
  const missing = [];
  for (const block of state.selection_blocks || []) {
    if (block.required === false) continue;
    for (const student of state.students || []) {
      if (!(block.grades || []).includes(student.grade)) continue;
      if (student.elective_choices?.[block.choice_key]) continue;
      missing.push({
        student_id: student.id,
        student_name: student.name || student.id,
        block_id: block.id,
        block_name: block.name || block.id,
        choice_key: block.choice_key,
      });
    }
  }
  return missing.sort((left, right) =>
    left.block_id.localeCompare(right.block_id) || left.student_id.localeCompare(right.student_id));
}

export function buildSchedulingProblem(state, rules = state.constraints || []) {
  const students = state.students || [];
  const manualFillerCourseIds = new Set((state.courses || [])
    .filter(course => course.manual_unlimited === true)
    .map(course => course.id));
  const gradeByStudentId = new Map(students.map(student => [student.id, student.grade]));
  if (gradeByStudentId.size !== students.length) throw new Error('学生数据库存在重复 ID，不能构建排课问题');
  const rawSections = buildSections(state);
  for (const section of rawSections) for (const field of [
    'student_ids', 'eligible_student_ids', 'locked_student_ids',
  ]) for (const studentId of section[field] || []) {
    if (!gradeByStudentId.has(studentId)) {
      throw new Error(`section ${section.id} 的 ${field} 引用了不存在的学生 ${studentId}`);
    }
  }
  const sections = rawSections.map(section => ({
    id: section.id, course_id: section.course_id, teacher_id: section.teacher_id,
    room_id: null, class_type: section.class_type,
    weekly_hours: manualFillerCourseIds.has(section.course_id) ? 0 : section.weekly_hours,
    class_id: section.class_id, cohort_id: section.cohort_id, source: section.source,
    student_ids: section.student_ids || [], eligible_student_ids: section.eligible_student_ids || [],
    locked_student_ids: section.locked_student_ids || [],
    grades: [...new Set([...(section.student_ids || []), ...(section.eligible_student_ids || [])]
      .map(studentId => gradeByStudentId.get(studentId)).filter(grade => grade !== undefined))].sort((a, b) => a - b),
    room_candidates: [], room_binding: 'disabled',
    capacity: null, warnings: section.warnings || [],
    source_assignment_id: section.source_assignment_id,
    synchronized_group_id: section.synchronized_group_id,
  }));
  const studentHours = new Map(students.map(student => [student.id, 0]));
  for (const section of sections) for (const studentId of section.student_ids) {
    studentHours.set(studentId, (studentHours.get(studentId) || 0) + section.weekly_hours);
  }
  return {
    slots: Array.from({ length: 50 }, (_, index) => ({ id: `D${Math.floor(index / 10) + 1}P${index % 10 + 1}`, day: Math.floor(index / 10) + 1, period: index % 10 + 1 })),
    sections,
    rooms: [],
    rules: [
      ...compileRules(state, rules.filter(rule => rule.scope !== 'room'), { sections }),
      ...synchronizedSelectionBlockRules(state, sections),
      ...synchronizedAssignmentRules(sections),
    ],
    diagnostics: {
      sections: sections.length,
      meetings: sections.reduce((total, section) => total + section.weekly_hours, 0),
      student_weekly_hours: Object.fromEntries(studentHours),
      students_not_at_50_hours: [...studentHours].filter(([, hours]) => hours !== 50).map(([id, hours]) => ({ id, hours })),
      incomplete_required_choices: incompleteRequiredChoices(state),
      room_assignment: 'disabled',
      ignored_room_rule_ids: rules.filter(rule => rule.scope === 'room').map(rule => rule.id),
    },
  };
}
