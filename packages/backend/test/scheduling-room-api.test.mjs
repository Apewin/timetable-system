import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import test from 'node:test';

test('saves or clears timetable rooms without invalidating a room-disabled schedule', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'timetable-rooms-'));
  const stateFile = join(directory, 'state.json');
  const previousStateFile = process.env.STATE_FILE;
  process.env.STATE_FILE = stateFile;
  writeFileSync(stateFile, `${JSON.stringify({
    meta: { revision: 1, school: '测试学校' },
    rooms: [{ id: 'R1', name: '旧教室', type: 'general', capacity: 30 }],
    admin_classes: [{ id: 'AC1', name: '高一一班', fixed_room_id: 'R1', student_ids: [] }],
    teaching_classes: [{ id: 'TC1', name: '高一教学班', fixed_room_id: 'R1', student_ids: [] }],
    constraints: [{
      id: 'ROOM_RULE', type: 'forbid_slots', scope: 'room', target_ids: ['R1'],
      hard: true, weight: 0, params: { slots: ['D1P1'] },
    }],
    schedule: { sections: [], meetings: [], validation: { ok: true } },
    solve_status: 'valid',
    manual_plan: { status: 'confirmed', placements: [], locks: [] },
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
  const base = `http://127.0.0.1:${server.address().port}/api/rooms`;
  const initialStatus = await (await fetch(base.replace('/rooms', '/status'))).json();
  assert.equal(initialStatus.data.revision, 1);

  const saveResponse = await fetch(base, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      expected_revision: 1,
      renames: [{ from: 'R1', to: '101' }],
      rooms: [
        { id: '101', name: '一号教室', type: 'general', capacity: 32 },
        { id: 'R2', name: '物理实验室', type: 'physics', capacity: 24 },
      ],
    }),
  });
  const saved = await saveResponse.json();
  assert.equal(saveResponse.status, 200, JSON.stringify(saved));
  assert.deepEqual(saved.data.rooms.map(room => room.name), ['一号教室', '物理实验室']);
  assert.equal(saved.data.revision, 2);
  assert.equal(saved.data.solve_status, 'valid');
  assert.equal(saved.data.manual_plan_status, 'confirmed');
  assert.equal(saved.data.room_assignment, 'disabled');
  assert.equal(saved.data.rooms[0].id, '101');

  const renamedState = JSON.parse(readFileSync(stateFile, 'utf8'));
  assert.equal(renamedState.admin_classes[0].fixed_room_id, '101');
  assert.equal(renamedState.teaching_classes[0].fixed_room_id, '101');
  assert.deepEqual(renamedState.constraints[0].target_ids, ['101']);

  const clearResponse = await fetch(base, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ expected_revision: 2, rooms: [] }),
  });
  const cleared = await clearResponse.json();
  assert.equal(clearResponse.status, 200, JSON.stringify(cleared));
  assert.deepEqual(cleared.data.rooms, []);
  assert.equal(cleared.data.solve_status, 'valid');
  assert.equal(cleared.data.manual_plan_status, 'confirmed');
  assert.equal(cleared.data.room_assignment, 'disabled');
  assert.deepEqual(await (await fetch(base)).json(), { ok: true, data: [] });

  const persisted = JSON.parse(readFileSync(stateFile, 'utf8'));
  assert.deepEqual(persisted.rooms, []);
  assert.equal(persisted.solve_status, 'valid');
  assert.equal(persisted.manual_plan.status, 'confirmed');
});
