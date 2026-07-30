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

export function buildSchedulingProblem(state, rules = state.constraints || []) {
  const gradeByStudentId = new Map((state.students || []).map(student => [student.id, student.grade]));
  const sections = buildSections(state).map(section => ({
    id: section.id, course_id: section.course_id, teacher_id: section.teacher_id,
    room_id: section.room_id, class_type: section.class_type, weekly_hours: section.weekly_hours,
    class_id: section.class_id, cohort_id: section.cohort_id, source: section.source,
    student_ids: section.student_ids || [], eligible_student_ids: section.eligible_student_ids || [],
    locked_student_ids: section.locked_student_ids || [],
    grades: [...new Set([...(section.student_ids || []), ...(section.eligible_student_ids || [])]
      .map(studentId => gradeByStudentId.get(studentId)).filter(grade => grade !== undefined))].sort((a, b) => a - b),
    room_candidates: section.room_candidates || [], room_binding: section.room_binding,
    capacity: section.capacity, warnings: section.warnings || [],
  }));
  const studentHours = new Map(state.students.map(student => [student.id, 0]));
  for (const section of sections) for (const studentId of section.student_ids) {
    studentHours.set(studentId, (studentHours.get(studentId) || 0) + section.weekly_hours);
  }
  return {
    slots: Array.from({ length: 50 }, (_, index) => ({ id: `D${Math.floor(index / 10) + 1}P${index % 10 + 1}`, day: Math.floor(index / 10) + 1, period: index % 10 + 1 })),
    sections,
    rooms: (state.rooms || []).map(room => ({ id: room.id, capacity: room.capacity, type: room.type })),
    rules: [...compileRules(state, rules, { sections }), ...synchronizedSelectionBlockRules(state, sections)],
    diagnostics: {
      sections: sections.length,
      meetings: sections.reduce((total, section) => total + section.weekly_hours, 0),
      student_weekly_hours: Object.fromEntries(studentHours),
      students_not_at_50_hours: [...studentHours].filter(([, hours]) => hours !== 50).map(([id, hours]) => ({ id, hours })),
    },
  };
}
