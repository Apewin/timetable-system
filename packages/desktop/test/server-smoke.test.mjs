import assert from 'node:assert/strict';
import { once } from 'node:events';
import { copyFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { serverUrl } from '../runtime.mjs';

const seedFile = fileURLToPath(new URL('../seed-state.json', import.meta.url));

test('blank desktop state boots the backend and serves the packaged web application', {
  skip: process.env.TIMETABLE_DESKTOP_NETWORK_TEST !== '1',
}, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'timetable-desktop-server-'));
  const stateFile = join(directory, 'timetable.json');
  await copyFile(seedFile, stateFile);
  const previousStateFile = process.env.STATE_FILE;
  process.env.STATE_FILE = stateFile;
  let server;
  try {
    const backend = await import(`../../backend/src/server.mjs?desktop=${Date.now()}`);
    server = backend.startServer({ port: 0, host: '127.0.0.1' });
    if (!server.listening) await once(server, 'listening');
    const url = serverUrl(server.address());

    const statusResponse = await fetch(`${url}api/status`);
    const status = await statusResponse.json();
    const pageResponse = await fetch(url);

    assert.equal(statusResponse.status, 200);
    assert.equal(status.ok, true);
    assert.equal(pageResponse.status, 200);
    assert.match(await pageResponse.text(), /AP 排课|排课表/);
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    if (previousStateFile === undefined) delete process.env.STATE_FILE;
    else process.env.STATE_FILE = previousStateFile;
    await rm(directory, { recursive: true, force: true });
  }
});
