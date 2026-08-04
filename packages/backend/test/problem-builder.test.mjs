import assert from 'node:assert/strict';
import test from 'node:test';
import { buildSchedulingProblem } from '../src/problem-builder.mjs';

test('rejects a stale class roster that references an unknown student', () => {
  const state = {
    teachers: [{ id: 'T1', can_teach: ['C1'] }],
    rooms: [{ id: 'R1', type: 'general', capacity: 30 }],
    courses: [{ id: 'C1', type: 'required', grade: 11, weekly_hours: 1 }],
    students: [],
    admin_classes: [],
    teaching_classes: [{
      id: 'TC1', grade: 11, student_ids: ['MISSING_STUDENT'], fixed_room_id: 'R1',
    }],
    teaching_assignments: [{
      id: 'A1', class_type: 'teaching', class_ids: ['TC1'], course_id: 'C1',
      teacher_id: 'T1', weekly_hours: 1,
    }],
    selection_blocks: [],
    constraints: [],
  };
  assert.throws(
    () => buildSchedulingProblem(state),
    /section .*引用了不存在的学生 MISSING_STUDENT/,
  );
});

test('turns a synchronized multi-class activity into a hard same-slot rule', () => {
  const problem = buildSchedulingProblem({
    teachers: [{ id: 'HOMEROOM_ROLE', can_teach: ['ADVISORY'] }],
    rooms: [
      { id: 'R1', type: 'general', capacity: 30 },
      { id: 'R2', type: 'general', capacity: 30 },
    ],
    courses: [{ id: 'ADVISORY', type: 'other', grade: 11, weekly_hours: 1 }],
    students: [],
    admin_classes: [
      { id: 'AC1', grade: 11, student_ids: [], fixed_room_id: 'R1' },
      { id: 'AC2', grade: 11, student_ids: [], fixed_room_id: 'R2' },
    ],
    teaching_classes: [],
    teaching_assignments: [{
      id: 'TA_ADVISORY',
      class_type: 'admin',
      class_ids: ['AC1', 'AC2'],
      course_id: 'ADVISORY',
      teacher_id: 'HOMEROOM_ROLE',
      staffing_mode: 'per_class',
      synchronized_classes: true,
      weekly_hours: 1,
    }],
    selection_blocks: [],
    constraints: [],
  });

  const rule = problem.rules.find(item => item.id === 'assignment_TA_ADVISORY_synchronized_slots');
  assert.equal(rule?.hard, true);
  assert.deepEqual(rule?.target_ids, [
    'SEC_admin_TA_ADVISORY_AC1',
    'SEC_admin_TA_ADVISORY_AC2',
  ]);
});

test('builds the timetable while students with incomplete required choices remain unassigned', () => {
  const courseIds = ['JAPANESE', 'FRENCH', 'GERMAN'];
  const problem = buildSchedulingProblem({
    teachers: courseIds.map(courseId => ({ id: `T_${courseId}`, can_teach: [courseId] })),
    rooms: [{ id: 'R1', type: 'general', capacity: 30 }],
    courses: courseIds.map(courseId => ({
      id: courseId,
      type: 'required_elective',
      grade: 12,
      weekly_hours: 2,
    })),
    students: [
      { id: 'S_J', grade: 12, ap_courses: [], elective_choices: { group_c: 'JAPANESE' } },
      { id: 'S_F', grade: 12, ap_courses: [], elective_choices: { group_c: 'FRENCH' } },
      { id: 'S_G', grade: 12, ap_courses: [], elective_choices: { group_c: 'GERMAN' } },
      { id: 'S_INCOMPLETE', grade: 12, ap_courses: [], elective_choices: {} },
    ],
    admin_classes: [],
    teaching_classes: [],
    teaching_assignments: [],
    selection_blocks: [{
      id: 'g12_language_choices',
      name: '高三语言选修组',
      grades: [12],
      choice_key: 'group_c',
      allowed_course_ids: courseIds,
      required: true,
      synchronized_time_block: true,
      section_count: 1,
    }],
    constraints: [],
  });

  const electiveSections = problem.sections.filter(section => section.source === 'required_elective');
  assert.deepEqual(electiveSections.map(section => section.course_id).sort(), [...courseIds].sort());
  assert.ok(electiveSections.every(section => !section.student_ids.includes('S_INCOMPLETE')));
  assert.ok(problem.diagnostics.students_not_at_50_hours.some(student => student.id === 'S_INCOMPLETE'));
  assert.deepEqual(problem.diagnostics.incomplete_required_choices, [{
    student_id: 'S_INCOMPLETE',
    student_name: 'S_INCOMPLETE',
    block_id: 'g12_language_choices',
    block_name: '高三语言选修组',
    choice_key: 'group_c',
  }]);
});

test('does not block sectioning when an unselected synchronized choice course has no section yet', () => {
  const problem = buildSchedulingProblem({
    teachers: [
      { id: 'T_J', can_teach: ['JAPANESE'] },
      { id: 'T_F', can_teach: ['FRENCH'] },
    ],
    rooms: [],
    courses: [
      { id: 'JAPANESE', type: 'required_elective', grade: 12, weekly_hours: 2 },
      { id: 'FRENCH', type: 'required_elective', grade: 12, weekly_hours: 2 },
    ],
    students: [{ id: 'S_J', grade: 12, ap_courses: [], elective_choices: { group_c: 'JAPANESE' } }],
    admin_classes: [], teaching_classes: [], teaching_assignments: [], constraints: [],
    selection_blocks: [{
      id: 'g12_language_choices', name: '高三语言选修组', grades: [12], choice_key: 'group_c',
      allowed_course_ids: ['JAPANESE', 'FRENCH'], required: true, synchronized_time_block: true, section_count: 1,
    }],
  });
  assert.deepEqual(problem.sections.map(section => section.course_id), ['JAPANESE']);
  assert.equal(problem.rules.some(rule => rule.id === 'selection_block_g12_language_choices_synchronized_slots'), false);
});

test('builds administrative sections without rooms or room-capacity limits', () => {
  const students = Array.from({ length: 41 }, (_, index) => ({
    id: `S${index + 1}`,
    grade: 12,
    ap_courses: [],
    elective_choices: {},
  }));
  const problem = buildSchedulingProblem({
    teachers: [{ id: 'T_CHIN', can_teach: ['CHIN'] }],
    rooms: [],
    courses: [{ id: 'CHIN', type: 'required', grade: 12, weekly_hours: 2 }],
    students,
    admin_classes: [{
      id: 'AC5', grade: 12, student_ids: students.map(student => student.id), fixed_room_id: 'R9',
    }],
    teaching_classes: [],
    teaching_assignments: [{
      id: 'TA_CHIN', class_type: 'admin', class_ids: ['AC5'], course_id: 'CHIN',
      teacher_id: 'T_CHIN', weekly_hours: 2,
    }],
    selection_blocks: [],
    constraints: [{
      id: 'legacy-room-rule',
      name: '旧教室禁排规则',
      type: 'forbid_slots',
      hard: true,
      weight: 0,
      scope: 'room',
      target_ids: ['R9'],
      params: { slots: ['D1P1'] },
    }],
  });

  assert.deepEqual(problem.rooms, []);
  assert.equal(problem.sections.length, 1);
  assert.equal(problem.sections[0].student_ids.length, 41);
  assert.equal(problem.sections[0].room_id, null);
  assert.deepEqual(problem.sections[0].room_candidates, []);
  assert.equal(problem.sections[0].capacity, null);
  assert.equal(problem.rules.some(rule => rule.id === 'legacy-room-rule'), false);
  assert.deepEqual(problem.diagnostics.ignored_room_rule_ids, ['legacy-room-rule']);
});

test('leaves unlimited self-study out of the automatic timetable workload', () => {
  const problem = buildSchedulingProblem({
    teachers: [{ id: 'T_SELF', can_teach: ['SELF_STUDY'] }],
    rooms: [],
    courses: [{
      id: 'SELF_STUDY', name: '自习', type: 'other', grade: 10,
      weekly_hours: 2, manual_unlimited: true,
    }],
    students: [{ id: 'S1', grade: 10, ap_courses: [], elective_choices: {} }],
    admin_classes: [],
    teaching_classes: [{ id: 'TC1', grade: 10, student_ids: ['S1'] }],
    teaching_assignments: [{
      id: 'TA_SELF', class_type: 'teaching', class_ids: ['TC1'],
      course_id: 'SELF_STUDY', teacher_id: 'T_SELF', weekly_hours: 2,
    }],
    selection_blocks: [],
    constraints: [],
  });

  assert.equal(problem.sections.length, 1);
  assert.equal(problem.sections[0].weekly_hours, 0);
  assert.equal(problem.diagnostics.meetings, 0);
  assert.equal(problem.diagnostics.student_weekly_hours.S1, 0);
});
