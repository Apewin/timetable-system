import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { manualSolvedCellsBySlot } from '../manual-solved-timetable.mjs';

const appSource = await readFile(new URL('../app.js', import.meta.url), 'utf8');

test('projects a complete class timetable into the manual grid with lock states', () => {
  const cells = manualSolvedCellsBySlot({
    rows: [[
      'P1',
      { slot_id: 'D1P1', section_id: 'SEC_LOCKED', course: '数学' },
      {
        slot_id: 'D2P1',
        course: 'AP 选课分流',
        split_groups: [
          { section_id: 'SEC_AP_1', course: 'AP 物理' },
          { section_id: 'SEC_AP_2', course: 'AP 化学' },
        ],
      },
      null,
      null,
      null,
    ]],
  }, [
    { section_id: 'SEC_LOCKED', slot_id: 'D1P1' },
    { section_id: 'SEC_AP_1', slot_id: 'D2P1' },
  ]);

  assert.equal(cells.size, 2);
  assert.equal(cells.get('D1P1').manual_lock_state, 'all');
  assert.equal(cells.get('D2P1').manual_lock_state, 'partial');
  assert.deepEqual(cells.get('D2P1').section_ids, ['SEC_AP_1', 'SEC_AP_2']);
});

test('the manual timetable loads and renders the solved class timetable', () => {
  assert.match(appSource, /function renderSolvedManualTimetableGrid/);
  assert.match(appSource, /async function loadManualGeneratedTimetable/);
  assert.match(appSource, /\/timetable\/class\/\$\{encodeURIComponent\(classId\)\}/);
  assert.match(appSource, /manualSolvedCellsBySlot/);
});
