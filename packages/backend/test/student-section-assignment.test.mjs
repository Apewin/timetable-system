import assert from 'node:assert/strict';
import test from 'node:test';
import { assignStudentsToScheduledSections } from '../src/student-section-assignment.mjs';
import { validateSchedule } from '../src/schedule-validator.mjs';

test('assigns flexible elective students after course times are fixed', () => {
  const problem = {
    slots: [
      { id: 'D1P1', day: 1, period: 1 },
      { id: 'D1P2', day: 1, period: 2 },
      { id: 'D1P3', day: 1, period: 3 },
      { id: 'D1P4', day: 1, period: 4 },
    ],
    rooms: [],
    rules: [],
    sections: [
      {
        id: 'CORE_S1', course_id: 'CORE', teacher_id: 'T_CORE_1', class_type: 'teaching',
        weekly_hours: 1, student_ids: ['S1'], eligible_student_ids: [], locked_student_ids: [],
      },
      {
        id: 'CORE_S2', course_id: 'CORE', teacher_id: 'T_CORE_2', class_type: 'teaching',
        weekly_hours: 1, student_ids: ['S2'], eligible_student_ids: [], locked_student_ids: [],
      },
      {
        id: 'AP_A', course_id: 'AP', teacher_id: 'T_AP_A', class_type: 'ap',
        weekly_hours: 1, student_ids: ['S1'], eligible_student_ids: ['S1', 'S2'], locked_student_ids: ['S2'],
      },
      {
        id: 'AP_B', course_id: 'AP', teacher_id: 'T_AP_B', class_type: 'ap',
        weekly_hours: 1, student_ids: ['S2'], eligible_student_ids: ['S1', 'S2'], locked_student_ids: [],
      },
    ],
  };
  const meetings = [
    { section_id: 'CORE_S1', slot_id: 'D1P1', room_id: null },
    { section_id: 'CORE_S2', slot_id: 'D1P2', room_id: null },
    { section_id: 'AP_A', slot_id: 'D1P1', room_id: null },
    { section_id: 'AP_B', slot_id: 'D1P2', room_id: null },
  ];

  const solution = assignStudentsToScheduledSections(problem, meetings);

  assert.equal(solution.ok, true, JSON.stringify(solution.failures));
  assert.deepEqual(
    solution.sections.find(section => section.id === 'AP_A').student_ids,
    ['S2'],
  );
  assert.deepEqual(
    solution.sections.find(section => section.id === 'AP_B').student_ids,
    ['S1'],
  );
  assert.equal(validateSchedule(problem, solution).ok, true);
});

test('returns an exact collision cut when every parallel section hits a core lesson', () => {
  const problem = {
    slots: [
      { id: 'D1P1', day: 1, period: 1 },
      { id: 'D1P2', day: 1, period: 2 },
    ],
    rooms: [],
    rules: [],
    sections: [
      { id: 'CORE', course_id: 'CORE', teacher_id: 'T0', class_type: 'teaching', weekly_hours: 1, student_ids: ['S1'], eligible_student_ids: [] },
      { id: 'AP1', course_id: 'AP', teacher_id: 'T1', class_type: 'ap', weekly_hours: 1, student_ids: [], eligible_student_ids: ['S1'] },
      { id: 'AP2', course_id: 'AP', teacher_id: 'T2', class_type: 'ap', weekly_hours: 1, student_ids: [], eligible_student_ids: ['S1'] },
    ],
  };
  const meetings = [
    { section_id: 'CORE', slot_id: 'D1P1' },
    { section_id: 'AP1', slot_id: 'D1P1' },
    { section_id: 'AP2', slot_id: 'D1P1' },
  ];

  const solution = assignStudentsToScheduledSections(problem, meetings);

  assert.equal(solution.ok, false);
  assert.equal(solution.failures.length, 1);
  assert.equal(solution.failures[0].collision_cut.length, 2);
  assert.deepEqual(
    new Set(solution.failures[0].collision_cut.map(pair => pair.right_section_id)),
    new Set(['AP1', 'AP2']),
  );
});
