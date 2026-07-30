import assert from 'node:assert/strict';
import test from 'node:test';
import { solveSchedule } from '../src/cpsat-solver.mjs';
import { validateSchedule } from '../src/schedule-validator.mjs';

test('synchronizes a hard elective block without naming a particular course in the solver', async () => {
  const problem = {
    slots: Array.from({ length: 10 }, (_, index) => ({ id: `D1P${index + 1}`, day: 1, period: index + 1 })),
    rooms: [{ id: 'R1', capacity: 30 }, { id: 'R2', capacity: 30 }, { id: 'R3', capacity: 30 }],
    rules: [{ id: 'language-block', type: 'synchronized_slots', hard: true, scope: 'section', target_ids: ['J', 'F', 'G'], section_target_ids: ['J', 'F', 'G'], params: {} }],
    sections: [
      { id: 'J', course_id: 'JAPANESE', teacher_id: 'TJ', class_type: 'elective', weekly_hours: 2, student_ids: ['S1'], eligible_student_ids: ['S1'], capacity: 30, room_id: 'R1', room_candidates: ['R1'] },
      { id: 'F', course_id: 'FRENCH', teacher_id: 'TF', class_type: 'elective', weekly_hours: 2, student_ids: ['S2'], eligible_student_ids: ['S2'], capacity: 30, room_id: 'R2', room_candidates: ['R2'] },
      { id: 'G', course_id: 'GERMAN', teacher_id: 'TG', class_type: 'elective', weekly_hours: 2, student_ids: ['S3'], eligible_student_ids: ['S3'], capacity: 30, room_id: 'R3', room_candidates: ['R3'] },
    ],
  };
  const solution = await solveSchedule(problem, { maxTimeSeconds: 5, useConstructiveSeed: false });
  assert.equal(solution.ok, true);
  const slots = sectionId => solution.meetings.filter(meeting => meeting.section_id === sectionId).map(meeting => meeting.slot_id).sort();
  assert.deepEqual(slots('J'), slots('F'));
  assert.deepEqual(slots('F'), slots('G'));
  assert.equal(validateSchedule(problem, solution).ok, true);
});
