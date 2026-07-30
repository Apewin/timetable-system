import assert from 'node:assert/strict';
import test from 'node:test';
import { solveSchedule } from '../src/cpsat-solver.mjs';
import { validateSchedule } from '../src/schedule-validator.mjs';

const slots = Array.from({ length: 10 }, (_, index) => ({ id: `D1P${index + 1}`, day: 1, period: index + 1 }));

test('solves section time, flexible room and student membership in one model', async () => {
  const problem = {
    slots,
    rooms: [{ id: 'R1', capacity: 2 }, { id: 'R2', capacity: 2 }],
    rules: [
      { id: 'ap-once-a-day', type: 'max_occurrences_per_day', hard: true, scope: 'course', target_ids: ['AP'], params: { max: 1 } },
      { id: 'fixed-core', type: 'fixed_slots', hard: true, scope: 'section', target_ids: ['CORE'], params: { slots: ['D1P1'], mode: 'exact' } },
      { id: 'late-core', type: 'preferred_slots', hard: false, weight: 2, scope: 'section', target_ids: ['CORE'], params: { slots: ['D1P10'] } },
    ],
    sections: [
      { id: 'CORE', course_id: 'CORE', teacher_id: 'T1', class_id: 'C', class_type: 'teaching', weekly_hours: 1, student_ids: ['S1', 'S2'], eligible_student_ids: [], room_id: 'R1', room_candidates: ['R1', 'R2'] },
      { id: 'AP1', course_id: 'AP', teacher_id: 'T2', class_type: 'ap', weekly_hours: 1, student_ids: ['S1'], eligible_student_ids: ['S1', 'S2'], room_id: 'R1', room_candidates: ['R1', 'R2'], capacity: 2 },
      { id: 'AP2', course_id: 'AP', teacher_id: 'T3', class_type: 'ap', weekly_hours: 1, student_ids: ['S2'], eligible_student_ids: ['S1', 'S2'], room_id: 'R1', room_candidates: ['R1', 'R2'], capacity: 2 },
    ],
  };
  const solution = await solveSchedule(problem, { maxTimeSeconds: 5 });
  assert.equal(solution.ok, true);
  assert.equal(solution.meetings.length, 3);
  assert.equal(solution.assignments.length, 4);
  const validation = validateSchedule(problem, solution);
  assert.equal(validation.ok, true, JSON.stringify(validation.hard_violations));
});

test('keeps a locked section meeting at its locked slot', async () => {
  const problem = {
    slots,
    rooms: [{ id: 'R1', capacity: 30 }],
    rules: [],
    sections: [{ id: 'LOCKED', course_id: 'C', teacher_id: 'T', class_type: 'teaching', weekly_hours: 1, student_ids: ['S'], eligible_student_ids: [], room_id: 'R1', room_candidates: ['R1'] }],
  };
  const solution = await solveSchedule(problem, { maxTimeSeconds: 5, useConstructiveSeed: false, lockedMeetings: [{ section_id: 'LOCKED', slot_id: 'D1P7' }] });
  assert.equal(solution.ok, true);
  assert.equal(solution.meetings[0].slot_id, 'D1P7');
  assert.equal(validateSchedule(problem, { ...solution, locks: [{ section_id: 'LOCKED', slot_id: 'D1P7' }] }).ok, true);
});

test('keeps an administrator-locked student in the selected parallel section', async () => {
  const problem = {
    slots,
    rooms: [{ id: 'R1', capacity: 2 }, { id: 'R2', capacity: 2 }],
    rules: [],
    sections: [
      { id: 'CORE', course_id: 'CORE', teacher_id: 'T1', class_type: 'teaching', weekly_hours: 1, student_ids: ['S1', 'S2'], eligible_student_ids: [], room_id: 'R1', room_candidates: ['R1', 'R2'] },
      { id: 'AP1', course_id: 'AP', teacher_id: 'T2', class_type: 'ap', weekly_hours: 1, student_ids: ['S1'], eligible_student_ids: ['S1', 'S2'], locked_student_ids: [], room_id: 'R1', room_candidates: ['R1', 'R2'], capacity: 2 },
      { id: 'AP2', course_id: 'AP', teacher_id: 'T3', class_type: 'ap', weekly_hours: 1, student_ids: ['S2'], eligible_student_ids: ['S1', 'S2'], locked_student_ids: ['S1'], room_id: 'R1', room_candidates: ['R1', 'R2'], capacity: 2 },
    ],
  };
  const solution = await solveSchedule(problem, { maxTimeSeconds: 5 });
  assert.equal(solution.ok, true);
  assert.ok(solution.sections.find(section => section.id === 'AP2').student_ids.includes('S1'));
  assert.ok(!solution.sections.find(section => section.id === 'AP1').student_ids.includes('S1'));
  assert.equal(validateSchedule(problem, solution).ok, true);
});

test('enforces a rule targeting one student even when elective students would otherwise share a cohort', async () => {
  const problem = {
    slots,
    rooms: [{ id: 'R1', capacity: 2 }, { id: 'R2', capacity: 2 }],
    rules: [
      { id: 'fixed-core', type: 'fixed_slots', hard: true, scope: 'section', target_ids: ['CORE'], section_target_ids: ['CORE'], params: { slots: ['D1P1', 'D1P2'], mode: 'exact' } },
      { id: 'fixed-ap', type: 'fixed_slots', hard: true, scope: 'course', target_ids: ['AP'], section_target_ids: ['AP1', 'AP2'], params: { slots: ['D1P3'], mode: 'exact' } },
      { id: 's1-no-three-in-a-row', type: 'max_consecutive_lessons', hard: true, scope: 'student', target_ids: ['S1'], params: { max: 2 } },
    ],
    sections: [
      { id: 'CORE', course_id: 'CORE', teacher_id: 'T1', class_type: 'teaching', weekly_hours: 2, student_ids: ['S1', 'S2'], eligible_student_ids: [], room_id: 'R1', room_candidates: ['R1', 'R2'] },
      { id: 'AP1', course_id: 'AP', teacher_id: 'T2', class_type: 'ap', weekly_hours: 1, student_ids: ['S1'], eligible_student_ids: ['S1', 'S2'], room_id: 'R1', room_candidates: ['R1', 'R2'], capacity: 2 },
      { id: 'AP2', course_id: 'AP', teacher_id: 'T3', class_type: 'ap', weekly_hours: 1, student_ids: ['S2'], eligible_student_ids: ['S1', 'S2'], room_id: 'R1', room_candidates: ['R1', 'R2'], capacity: 2 },
    ],
  };
  const solution = await solveSchedule(problem, { maxTimeSeconds: 5, useConstructiveSeed: false });
  assert.equal(solution.ok, false, 'S1 would have fixed lessons in D1P1, D1P2 and D1P3');
});

test('explains a full-week student workload that contradicts a consecutive-lesson hard rule', async () => {
  const problem = {
    slots,
    rooms: [{ id: 'R1', capacity: 30 }],
    rules: [{ id: 'all-courses-no-four-in-a-row', type: 'max_consecutive_lessons', hard: true, scope: 'student', target_ids: ['S1'], params: { max: 3 } }],
    sections: [{ id: 'FULL', course_id: 'FULL', teacher_id: 'T1', class_type: 'teaching', weekly_hours: 10, student_ids: ['S1'], eligible_student_ids: [], room_id: 'R1', room_candidates: ['R1'] }],
  };
  const solution = await solveSchedule(problem, { maxTimeSeconds: 5 });
  assert.equal(solution.ok, false);
  assert.equal(solution.status, 'INFEASIBLE_BY_WORKLOAD');
  assert.match(solution.reason, /占满全部/);
});

test('optimizes a soft time preference after satisfying hard constraints', async () => {
  const problem = {
    slots,
    rooms: [{ id: 'R1', capacity: 30 }],
    rules: [{ id: 'prefer-last', type: 'preferred_slots', hard: false, weight: 5, scope: 'section', target_ids: ['PREFERRED'], params: { slots: ['D1P10'] } }],
    sections: [{ id: 'PREFERRED', course_id: 'C', teacher_id: 'T', class_type: 'teaching', weekly_hours: 1, student_ids: ['S'], eligible_student_ids: [], room_id: 'R1', room_candidates: ['R1'] }],
  };
  const solution = await solveSchedule(problem, { maxTimeSeconds: 5, useConstructiveSeed: false, optimizeSoft: true });
  const validation = validateSchedule(problem, solution);
  assert.equal(solution.ok, true);
  assert.equal(solution.meetings[0].slot_id, 'D1P10');
  assert.equal(validation.soft_score, 0);
});
