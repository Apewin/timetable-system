import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import test from 'node:test';

test('clear-all API requires a second confirmation phrase and wipes locked meetings', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'timetable-clear-all-'));
  const stateFile = join(directory, 'state.json');
  const previousStateFile = process.env.STATE_FILE;
  process.env.STATE_FILE = stateFile;
  writeFileSync(stateFile, `${JSON.stringify({
    meta: { revision: 12 },
    solve_status: 'valid',
    manual_plan: {
      status: 'confirmed',
      placements: [{ class_id: 'TC1', slot_id: 'D1P1', item_id: 'C1', course_ids: ['C1'], section_ids: ['SEC1'] }],
      locks: [{ section_id: 'SEC1', slot_id: 'D1P1', origin: 'manual' }],
    },
    schedule: {
      version: 3,
      publication_status: 'ready',
      sections: [{
        id: 'SEC1', course_id: 'C1', class_id: 'TC1', class_type: 'teaching',
        teacher_id: 'T1', student_ids: ['S1'],
      }],
      meetings: [
        { section_id: 'SEC1', slot_id: 'D1P1', room_id: null },
        { section_id: 'SEC1', slot_id: 'D2P1', room_id: null },
      ],
      locks: [{ section_id: 'SEC1', slot_id: 'D1P1', origin: 'manual' }],
    },
  })}\n`);

  const { startServer } = await import('../src/server.mjs');
  const server = startServer({ port: 0, host: '127.0.0.1' });
  await once(server, 'listening');
  t.after(() => {
    server.close();
    if (previousStateFile === undefined) delete process.env.STATE_FILE;
    else process.env.STATE_FILE = previousStateFile;
    rmSync(directory, { recursive: true, force: true });
  });

  const port = server.address().port;
  const previewResponse = await fetch(`http://127.0.0.1:${port}/api/schedule/clear-all/preview`);
  const previewPayload = await previewResponse.json();
  assert.equal(previewResponse.status, 200);
  assert.equal(previewPayload.data.total_meetings, 2);
  assert.equal(previewPayload.data.locked_meetings, 1);
  assert.equal(previewPayload.data.revision, 12);

  const rejected = await fetch(`http://127.0.0.1:${port}/api/schedule/clear-all`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      expected_revision: 12,
      confirmation: '清空',
      confirmed_by: '教务用户',
    }),
  });
  const rejectedPayload = await rejected.json();
  assert.equal(rejected.status, 400);
  assert.match(rejectedPayload.errors?.[0]?.msg || '', /二次确认/);
  assert.equal(JSON.parse(readFileSync(stateFile, 'utf8')).schedule.meetings.length, 2);

  const response = await fetch(`http://127.0.0.1:${port}/api/schedule/clear-all`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      expected_revision: 12,
      confirmation: '清空全部课表',
      confirmed_by: '教务用户',
    }),
  });
  const payload = await response.json();
  assert.equal(response.status, 200);
  assert.match(payload.data.message, /已清空全部课表/);
  assert.equal(payload.data.total_meetings, 2);
  const saved = JSON.parse(readFileSync(stateFile, 'utf8'));
  assert.deepEqual(saved.schedule.meetings, []);
  assert.deepEqual(saved.schedule.locks, []);
  assert.equal(saved.manual_plan.status, 'draft');
  assert.equal(saved.solve_status, 'stale');
});
