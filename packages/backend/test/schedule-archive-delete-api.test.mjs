import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import test from 'node:test';

function archive(id, savedAt) {
  return {
    id,
    name: `课表存档 · ${savedAt}`,
    saved_at: savedAt,
    schedule_version: 3,
    assignments_count: 1,
    schedule: {
      version: 3,
      solver_status: 'OPTIMAL',
      meetings: [{ section_id: 'SEC1', slot_id: 'D1P1' }],
      locks: [],
    },
    context: {
      meta: {}, courses: [], teachers: [], rooms: [], students: [],
      admin_classes: [], teaching_classes: [], constraints: [],
    },
  };
}

test('deletes exactly one confirmed schedule archive without changing the current timetable', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'timetable-delete-archive-'));
  const stateFile = join(directory, 'state.json');
  const previousStateFile = process.env.STATE_FILE;
  process.env.STATE_FILE = stateFile;
  const targetId = 'ARCHIVE_20260820080000000';
  const retainedId = 'ARCHIVE_20260819080000000';
  writeFileSync(stateFile, `${JSON.stringify({
    meta: { revision: 21 },
    solve_status: 'valid',
    schedule: { version: 8, current_marker: 'must-remain', sections: [], meetings: [] },
    schedule_archives: [
      archive(targetId, '2026-08-20T08:00:00.000Z'),
      archive(retainedId, '2026-08-19T08:00:00.000Z'),
    ],
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
  const base = `http://127.0.0.1:${port}/api/schedule-archives/${targetId}`;
  const previewResponse = await fetch(`${base}/delete-preview`);
  const previewPayload = await previewResponse.json();

  assert.equal(previewResponse.status, 200);
  assert.equal(previewPayload.ok, true);
  assert.equal(previewPayload.data.archive.id, targetId);
  assert.equal(previewPayload.data.revision, 21);
  assert.equal(previewPayload.data.remaining_count, 1);
  assert.equal(JSON.parse(readFileSync(stateFile, 'utf8')).schedule_archives.length, 2);

  const wrongConfirmationResponse = await fetch(base, {
    method: 'DELETE',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ expected_revision: 21, confirmation: 'WRONG_ARCHIVE' }),
  });
  assert.equal(wrongConfirmationResponse.status, 400);
  assert.equal(JSON.parse(readFileSync(stateFile, 'utf8')).meta.revision, 21);

  const staleResponse = await fetch(base, {
    method: 'DELETE',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ expected_revision: 20, confirmation: targetId }),
  });
  assert.equal(staleResponse.status, 409);
  assert.equal(JSON.parse(readFileSync(stateFile, 'utf8')).schedule_archives.length, 2);

  const response = await fetch(base, {
    method: 'DELETE',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ expected_revision: 21, confirmation: targetId }),
  });
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(payload.ok, true);
  assert.equal(payload.data.deleted_archive.id, targetId);
  assert.equal(payload.data.remaining_count, 1);
  assert.equal(payload.data.revision, 22);
  const saved = JSON.parse(readFileSync(stateFile, 'utf8'));
  assert.equal(saved.meta.revision, 22);
  assert.equal(saved.schedule.current_marker, 'must-remain');
  assert.deepEqual(saved.schedule_archives.map(item => item.id), [retainedId]);
});
