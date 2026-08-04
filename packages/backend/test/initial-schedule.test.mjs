import assert from 'node:assert/strict';
import test from 'node:test';
import { constructInitialSchedule } from '../src/initial-schedule.mjs';

test('warm-start construction honors a hard teacher unavailable-slot rule', () => {
  const problem = {
    slots: [
      { id: 'D1P1', day: 1, period: 1 },
      { id: 'D1P2', day: 1, period: 2 },
    ],
    rooms: [],
    rules: [{
      id: 'teacher_unavailability_T1',
      type: 'forbid_slots',
      hard: true,
      scope: 'teacher',
      target_ids: ['T1'],
      params: { slots: ['D1P1'] },
    }],
    sections: [{
      id: 'SEC_1', course_id: 'C1', teacher_id: 'T1', class_type: 'teaching', weekly_hours: 1,
      student_ids: ['S1'], eligible_student_ids: [],
    }],
  };

  const solution = constructInitialSchedule(problem);
  assert.equal(solution?.meetings[0]?.slot_id, 'D1P2');
});
