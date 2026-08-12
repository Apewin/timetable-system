import assert from 'node:assert/strict';
import test from 'node:test';

import { solveScheduleQualityLowerBounds } from '../src/quality-lower-bound.mjs';

test('proves separate lower bounds for AP gap-days and morning empty student-periods', async () => {
  const problem = {
    slots: [
      { id: 'D1P1', day: 1, period: 1 },
      { id: 'D1P2', day: 1, period: 2 },
      { id: 'D1P3', day: 1, period: 3 },
    ],
    rooms: [],
    rules: [
      {
        id: 'LOCK_A', type: 'fixed_slots', hard: true, scope: 'section',
        target_ids: ['A'], section_target_ids: ['A'], params: { slots: ['D1P1'], mode: 'exact' },
      },
      {
        id: 'LOCK_B', type: 'fixed_slots', hard: true, scope: 'section',
        target_ids: ['B'], section_target_ids: ['B'], params: { slots: ['D1P3'], mode: 'exact' },
      },
      {
        id: 'ap_block_students_compact_daily_schedule', type: 'no_internal_gaps',
        hard: false, weight: 1000, scope: 'student', target_ids: ['S1'],
        params: { preferred_morning_periods: 3 },
      },
    ],
    sections: [
      {
        id: 'A', course_id: 'A', teacher_id: 'TA', class_type: 'ap', weekly_hours: 1,
        student_ids: ['S1'], eligible_student_ids: [], grades: [11],
      },
      {
        id: 'B', course_id: 'B', teacher_id: 'TB', class_type: 'ap', weekly_hours: 1,
        student_ids: ['S1'], eligible_student_ids: [], grades: [11],
      },
    ],
  };

  const result = await solveScheduleQualityLowerBounds(problem, {
    maxTimeSeconds: 5,
    numSearchWorkers: 1,
  });

  assert.deepEqual(result.ap_student_gap_days, {
    best_known: 1,
    lower_bound: 1,
    proven: true,
    status: 'OPTIMAL',
  });
  assert.deepEqual(result.ap_morning_empty_student_periods, {
    best_known: 1,
    lower_bound: 1,
    proven: true,
    status: 'OPTIMAL',
  });
});
