import test from 'node:test';
import assert from 'node:assert/strict';

import { priorTimetableHintForState } from '../src/schedule-hints.mjs';

const schedule = {
  meetings: [{ section_id: 'SEC_1', slot_id: 'D1P1' }],
  sections: [{ id: 'SEC_1' }],
};

test('exact AP Block rosters may reuse the last valid timetable as a search hint', () => {
  const hint = priorTimetableHintForState({
    solve_status: 'valid',
    ap_block_assignments: [{ student_id: 'S1', course_id: 'AP_BIO', block_id: 'AP_BLOCK_1' }],
    schedule,
  }, { diagnostics: { ap_block_mode: { enabled: true } } });

  assert.deepEqual(hint, {
    meetings: schedule.meetings,
    sections: schedule.sections,
    enabled: true,
    reason: 'exact_ap_rosters',
  });
});

test('dynamic AP Block rosters do not reuse a potentially scattered timetable', () => {
  const hint = priorTimetableHintForState({ solve_status: 'valid', schedule }, {
    diagnostics: { ap_block_mode: { enabled: true } },
  });

  assert.deepEqual(hint, {
    meetings: [],
    sections: [],
    enabled: false,
    reason: 'dynamic_ap_rosters',
  });
});

test('stale timetables are never passed back to the solver', () => {
  const hint = priorTimetableHintForState({
    solve_status: 'stale',
    ap_block_assignments: [{ student_id: 'S1', course_id: 'AP_BIO', block_id: 'AP_BLOCK_1' }],
    schedule,
  }, { diagnostics: { ap_block_mode: { enabled: true } } });

  assert.equal(hint.enabled, false);
  assert.equal(hint.reason, 'schedule_not_valid');
  assert.deepEqual(hint.meetings, []);
});
