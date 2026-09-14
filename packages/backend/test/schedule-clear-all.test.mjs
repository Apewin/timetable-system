import assert from 'node:assert/strict';
import test from 'node:test';

import { clearAllSchedule, previewClearAllSchedule } from '../src/schedule-clear-all.mjs';

function sampleState() {
  return {
    solve_status: 'valid',
    manual_plan: {
      status: 'confirmed',
      placements: [{ class_id: 'TC1', slot_id: 'D1P1', item_id: 'MATH', course_ids: ['MATH'], section_ids: ['SEC_MATH'] }],
      locks: [{ section_id: 'SEC_MATH', slot_id: 'D1P1', origin: 'manual' }],
    },
    schedule: {
      version: 4,
      publication_status: 'ready',
      review_required: false,
      quality_gate: { passed: true },
      validation: { ok: true },
      sections: [
        {
          id: 'SEC_MATH', course_id: 'MATH', class_id: 'TC1', class_type: 'teaching',
          teacher_id: 'T1', student_ids: ['S1'],
        },
        {
          id: 'SEC_ENG', course_id: 'ENG', class_id: 'TC1', class_type: 'teaching',
          teacher_id: 'T2', student_ids: ['S1'],
        },
      ],
      meetings: [
        { section_id: 'SEC_MATH', slot_id: 'D1P1', room_id: null },
        { section_id: 'SEC_ENG', slot_id: 'D1P2', room_id: null },
      ],
      locks: [
        { section_id: 'SEC_MATH', slot_id: 'D1P1', origin: 'manual' },
      ],
      adjustment_buffer: [{ id: 'parked-1', section_id: 'SEC_ENG', slot_id: '__buffer__' }],
    },
  };
}

test('preview reports locked, unlocked, parked and manual placements before wiping the timetable', () => {
  assert.deepEqual(previewClearAllSchedule(sampleState()), {
    total_meetings: 2,
    locked_meetings: 1,
    unlocked_meetings: 1,
    parked_meetings: 1,
    lock_count: 1,
    manual_placements: 1,
  });
});

test('clear-all removes every meeting, lock, parked class and manual plan', () => {
  const result = clearAllSchedule(sampleState(), { now: '2026-09-14T07:00:00.000Z' });

  assert.equal(result.changed, true);
  assert.deepEqual(result.state.schedule.meetings, []);
  assert.deepEqual(result.state.schedule.locks, []);
  assert.deepEqual(result.state.schedule.adjustment_buffer, []);
  assert.equal(result.state.schedule.assignments.length, 0);
  assert.equal(result.state.manual_plan.status, 'draft');
  assert.deepEqual(result.state.manual_plan.placements, []);
  assert.equal(result.state.solve_status, 'stale');
  assert.equal(result.state.schedule.publication_status, 'not_ready');
  assert.equal(result.state.schedule.sections.length, 2);
  assert.equal(result.state.schedule.clear_all_summary.confirmed_by, '教务用户');
});

test('clear-all is a no-op when the timetable is already empty', () => {
  const state = {
    solve_status: 'stale',
    schedule: {
      version: 1,
      sections: [{ id: 'SEC_MATH', course_id: 'MATH', class_id: 'TC1', student_ids: ['S1'] }],
      meetings: [],
      locks: [],
    },
  };
  const result = clearAllSchedule(state);
  assert.equal(result.changed, false);
  assert.equal(result.state, state);
});
