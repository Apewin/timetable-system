import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { ensureUserState, serverUrl } from '../runtime.mjs';

test('copies a blank seed into the writable user data directory on first launch', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'timetable-desktop-'));
  const seedFile = join(directory, 'seed.json');
  const stateFile = join(directory, 'user', 'timetable.json');
  await writeFile(seedFile, '{"version":"test","students":[]}\n');
  try {
    const result = await ensureUserState({ stateFile, seedFile });

    assert.equal(result.created, true);
    assert.deepEqual(JSON.parse(await readFile(stateFile, 'utf8')), {
      version: 'test',
      students: [],
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('never overwrites an existing school state on application restart', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'timetable-desktop-'));
  const seedFile = join(directory, 'seed.json');
  const stateFile = join(directory, 'user', 'timetable.json');
  await writeFile(seedFile, '{"version":"seed"}\n');
  await ensureUserState({ stateFile, seedFile });
  await writeFile(stateFile, '{"version":"school-data"}\n');
  try {
    const result = await ensureUserState({ stateFile, seedFile });

    assert.equal(result.created, false);
    assert.equal(JSON.parse(await readFile(stateFile, 'utf8')).version, 'school-data');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('formats an ephemeral loopback server address for the desktop window', () => {
  assert.equal(serverUrl({ address: '127.0.0.1', port: 43123 }), 'http://127.0.0.1:43123/');
  assert.equal(serverUrl({ address: '::', port: 43123 }), 'http://127.0.0.1:43123/');
});
