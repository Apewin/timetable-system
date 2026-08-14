import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import test from 'node:test';

test('confirmed clear-unlocked API persists only locked timetable meetings', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'timetable-clear-unlocked-'));
  const stateFile = join(directory, 'state.json');
  const previousStateFile = process.env.STATE_FILE;
  process.env.STATE_FILE = stateFile;
  writeFileSync(stateFile, `${JSON.stringify({
    meta: { revision: 9 },
    solve_status: 'valid',
    manual_plan: {
      status: 'confirmed',
      locks: [{ section_id: 'SEC1', slot_id: 'D1P1', origin: 'manual' }],
    },
    schedule: {
      version: 2,
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
  const response = await fetch(`http://127.0.0.1:${port}/api/assistant/actions/execute-cli-operation`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      operation: 'schedule.clear-unlocked',
      params: {},
      body: { expected_revision: 9, confirmed_by: 'AI 助手确认卡' },
      expected_revision: 9,
    }),
  });
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(payload.ok, true);
  assert.match(payload.data.message, /已保留 1 个锁定课时.*清除 1 个未锁定课时/);
  assert.equal(payload.data.result.retained_locked_meetings, 1);
  assert.equal(payload.data.result.cleared_unlocked_meetings, 1);
  assert.equal(payload.data.result.revision, 10);
  const saved = JSON.parse(readFileSync(stateFile, 'utf8'));
  assert.deepEqual(saved.schedule.meetings, [
    { section_id: 'SEC1', slot_id: 'D1P1', room_id: null },
  ]);
  assert.equal(saved.manual_plan.status, 'confirmed');
  assert.equal(saved.solve_status, 'stale');
});
