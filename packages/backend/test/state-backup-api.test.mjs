import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import test from 'node:test';

test('lists state versions and restores one only with revision-bound confirmation', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'timetable-backup-api-'));
  const stateFile = join(directory, 'state.json');
  const backupDirectory = join(directory, 'backups');
  const previousStateFile = process.env.STATE_FILE;
  const previousBackupDirectory = process.env.STATE_BACKUP_DIR;
  process.env.STATE_FILE = stateFile;
  process.env.STATE_BACKUP_DIR = backupDirectory;
  writeFileSync(stateFile, '{"meta":{"revision":7},"students":[{"id":"S1"}],"teachers":[]}\n');

  const { StateRepository } = await import('../src/state-repository.mjs');
  const seed = new StateRepository(stateFile, { backupDirectory });
  seed.write({ ...seed.read(), students: [{ id: 'S1' }, { id: 'S2' }] });

  const { startServer } = await import('../src/server.mjs');
  const server = startServer({ port: 0, host: '127.0.0.1' });
  await once(server, 'listening');
  t.after(() => {
    server.close();
    if (previousStateFile === undefined) delete process.env.STATE_FILE;
    else process.env.STATE_FILE = previousStateFile;
    if (previousBackupDirectory === undefined) delete process.env.STATE_BACKUP_DIR;
    else process.env.STATE_BACKUP_DIR = previousBackupDirectory;
    rmSync(directory, { recursive: true, force: true });
  });

  const base = `http://127.0.0.1:${server.address().port}/api/state-backups`;
  const listPayload = await fetch(base).then(response => response.json());
  assert.equal(listPayload.ok, true);
  assert.equal(listPayload.data.revision, 8);
  assert.equal(listPayload.data.backups.length, 1);
  const backupId = listPayload.data.backups[0].id;

  const wrong = await fetch(`${base}/${encodeURIComponent(backupId)}/restore`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ expected_revision: 8, confirmation: '错误确认' }),
  });
  assert.equal(wrong.status, 400);
  assert.equal(JSON.parse(readFileSync(stateFile, 'utf8')).meta.revision, 8);

  const restoredResponse = await fetch(`${base}/${encodeURIComponent(backupId)}/restore`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ expected_revision: 8, confirmation: '恢复此版本' }),
  });
  const restored = await restoredResponse.json();
  assert.equal(restoredResponse.status, 200);
  assert.equal(restored.data.revision, 9);
  assert.deepEqual(JSON.parse(readFileSync(stateFile, 'utf8')).students, [{ id: 'S1' }]);
});
