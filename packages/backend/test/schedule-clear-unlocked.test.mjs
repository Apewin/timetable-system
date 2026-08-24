import assert from 'node:assert/strict';
import test from 'node:test';

import { clearUnlockedSchedule } from '../src/schedule-clear-unlocked.mjs';

test('clears only unlocked timetable meetings while preserving every active lock', () => {
  const state = {
    solve_status: 'valid',
    manual_plan: {
      status: 'confirmed',
      last_solve: { schedule_version: 4 },
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
        { section_id: 'SEC_MATH', slot_id: 'D2P1', room_id: null },
        { section_id: 'SEC_ENG', slot_id: 'D1P2', room_id: null },
      ],
      locks: [
        { section_id: 'SEC_MATH', slot_id: 'D1P1', origin: 'manual' },
        { section_id: 'SEC_ENG', slot_id: 'D1P2', origin: 'schedule' },
      ],
    },
  };

  const result = clearUnlockedSchedule(state, { now: '2026-08-14T10:00:00.000Z' });

  assert.deepEqual(result.state.schedule.meetings, [
    { section_id: 'SEC_MATH', slot_id: 'D1P1', room_id: null },
    { section_id: 'SEC_ENG', slot_id: 'D1P2', room_id: null },
  ]);
  assert.equal(result.preview.retained_locked_meetings, 2);
  assert.equal(result.preview.cleared_unlocked_meetings, 1);
  assert.equal(result.state.manual_plan.status, 'confirmed');
  assert.equal(result.state.manual_plan.last_solve, null);
  assert.equal(result.state.solve_status, 'stale');
  assert.equal(result.state.schedule.publication_status, 'not_ready');
  assert.equal(result.state.schedule.assignments.length, 2);
});
