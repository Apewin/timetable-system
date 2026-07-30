import assert from 'node:assert/strict';
import test from 'node:test';
import { solveSchedule } from '../src/cpsat-solver.mjs';
import { validateSchedule } from '../src/schedule-validator.mjs';

test('keeps administrative and elective sections of the same grade in different slots', async () => {
  const problem = {
    slots: [{ id: 'D1P1', day: 1, period: 1 }, { id: 'D1P2', day: 1, period: 2 }],
    rooms: [{ id: 'R1', capacity: 30 }, { id: 'R2', capacity: 30 }],
    rules: [{ id: 'admin-separate-elective', type: 'separate_class_types', hard: true, scope: 'global', target_ids: ['GLOBAL'], params: { grades: [12], left_class_types: ['admin'], right_class_types: ['elective'] } }],
    sections: [
      { id: 'ADMIN', course_id: 'CHIN', teacher_id: 'TA', class_type: 'admin', grades: [12], weekly_hours: 1, student_ids: ['S1'], eligible_student_ids: [], room_id: 'R1', room_candidates: ['R1'] },
      { id: 'ELECTIVE', course_id: 'J', teacher_id: 'TE', class_type: 'elective', grades: [12], weekly_hours: 1, student_ids: ['S2'], eligible_student_ids: [], room_id: 'R2', room_candidates: ['R2'], capacity: 30 },
    ],
  };
  const solution = await solveSchedule(problem, { maxTimeSeconds: 5, useConstructiveSeed: false, freezeMembership: true });
  assert.equal(solution.ok, true);
  assert.notEqual(solution.meetings.find(item => item.section_id === 'ADMIN').slot_id, solution.meetings.find(item => item.section_id === 'ELECTIVE').slot_id);
  assert.equal(validateSchedule(problem, solution).ok, true);
});
