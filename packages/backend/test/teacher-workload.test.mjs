import assert from 'node:assert/strict';
import test from 'node:test';

import { scheduledWeeklyHoursByTeacher } from '../src/teacher-workload.mjs';

test('counts actual scheduled section meetings for every teacher including AP per-class sections', () => {
  const counts = scheduledWeeklyHoursByTeacher({
    solve_status: 'valid',
    schedule: {
      sections: [
        { id: 'SEC_REQUIRED', teacher_id: 'T1' },
        { id: 'SEC_AP_A', teacher_id: 'T_AP' },
        { id: 'SEC_AP_B', teacher_id: 'T_AP' },
      ],
      meetings: [
        { section_id: 'SEC_REQUIRED', slot_id: 'D1P1' },
        { section_id: 'SEC_REQUIRED', slot_id: 'D2P1' },
        { section_id: 'SEC_AP_A', slot_id: 'D1P2' },
        { section_id: 'SEC_AP_A', slot_id: 'D2P2' },
        { section_id: 'SEC_AP_B', slot_id: 'D3P2' },
      ],
    },
  });

  assert.deepEqual(counts, { T1: 2, T_AP: 3 });
  assert.deepEqual(scheduledWeeklyHoursByTeacher({ solve_status: 'stale' }), {});
});
