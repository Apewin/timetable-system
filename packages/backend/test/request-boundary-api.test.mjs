import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

async function startBoundaryServer(t) {
  const directory = mkdtempSync(join(tmpdir(), 'timetable-request-boundary-'));
  const stateFile = join(directory, 'state.json');
  writeFileSync(stateFile, `${JSON.stringify({
    meta: { revision: 1 }, teachers: [], rooms: [], courses: [], students: [],
    admin_classes: [], teaching_classes: [], teaching_assignments: [],
    selection_blocks: [], constraints: [],
  })}\n`);
  const previous = {
    STATE_FILE: process.env.STATE_FILE,
    TIMETABLE_AUTH_MODE: process.env.TIMETABLE_AUTH_MODE,
    TIMETABLE_ALLOWED_HOSTS: process.env.TIMETABLE_ALLOWED_HOSTS,
    TIMETABLE_AUDIT_FILE: process.env.TIMETABLE_AUDIT_FILE,
    TIMETABLE_JOB_FILE: process.env.TIMETABLE_JOB_FILE,
  };
  process.env.STATE_FILE = stateFile;
  process.env.TIMETABLE_AUTH_MODE = 'off';
  process.env.TIMETABLE_ALLOWED_HOSTS = '127.0.0.1,localhost';
  process.env.TIMETABLE_AUDIT_FILE = join(directory, 'audit.jsonl');
  process.env.TIMETABLE_JOB_FILE = join(directory, 'jobs.json');
  const { startServer } = await import(`../src/server.mjs?request-boundary=${Date.now()}`);
  const server = startServer({ port: 0, host: '127.0.0.1' });
  await once(server, 'listening');
  t.after(() => {
    server.close();
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    rmSync(directory, { recursive: true, force: true });
  });
  return `http://127.0.0.1:${server.address().port}`;
}

test('rejects a forged Host even when Origin is forged to match it', async t => {
  const base = await startBoundaryServer(t);
  const target = new URL(`${base}/api/teachers`);
  const body = JSON.stringify({ id: 'T1', can_teach: [], available_slots: [] });
  const result = await new Promise((resolve, reject) => {
    const outgoing = request({
      hostname: target.hostname,
      port: target.port,
      path: target.pathname,
      method: 'POST',
      headers: {
        host: 'attacker.example',
        origin: 'http://attacker.example',
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(body),
        'if-match': '"1"',
      },
    }, response => {
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => resolve({
        status: response.statusCode,
        payload: JSON.parse(Buffer.concat(chunks).toString('utf8')),
      }));
    });
    outgoing.on('error', reject);
    outgoing.end(body);
  });
  assert.equal(result.status, 421);
  assert.equal(result.payload.errors[0].code, 'HOST_REJECTED');
});

test('rejects a write whose Origin host does not match Host', async t => {
  const base = await startBoundaryServer(t);
  const target = new URL(`${base}/api/teachers`);
  const body = JSON.stringify({ id: 'T1', can_teach: [], available_slots: [] });
  const result = await new Promise((resolve, reject) => {
    const outgoing = request({
      hostname: target.hostname,
      port: target.port,
      path: target.pathname,
      method: 'POST',
      headers: {
        host: target.host,
        origin: 'http://127.0.0.1:3000',
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(body),
        'if-match': '"1"',
      },
    }, response => {
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => resolve({
        status: response.statusCode,
        payload: JSON.parse(Buffer.concat(chunks).toString('utf8')),
      }));
    });
    outgoing.on('error', reject);
    outgoing.end(body);
  });
  assert.equal(result.status, 403);
  assert.equal(result.payload.errors[0].code, 'ORIGIN_REJECTED');
});

test('returns JSON for malformed and oversized JSON requests', async t => {
  const base = await startBoundaryServer(t);
  const malformed = await fetch(`${base}/api/teachers`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{not-json',
  });
  assert.equal(malformed.status, 400);
  assert.match(malformed.headers.get('content-type'), /application\/json/);
  assert.equal((await malformed.json()).errors[0].code, 'INVALID_JSON');

  const oversized = await fetch(`${base}/api/teachers`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ padding: 'x'.repeat(2 * 1024 * 1024 + 1) }),
  });
  assert.equal(oversized.status, 413);
  assert.match(oversized.headers.get('content-type'), /application\/json/);
  assert.equal((await oversized.json()).errors[0].code, 'REQUEST_TOO_LARGE');
});

test('returns a 413 JSON error for an oversized workbook upload', async t => {
  const base = await startBoundaryServer(t);
  const form = new FormData();
  form.append('file', new Blob([new Uint8Array(10 * 1024 * 1024 + 1)]), 'too-large.xlsx');
  const response = await fetch(`${base}/api/exams/import-durations`, {
    method: 'POST',
    body: form,
  });
  assert.equal(response.status, 413);
  assert.match(response.headers.get('content-type'), /application\/json/);
  assert.equal((await response.json()).errors[0].code, 'REQUEST_TOO_LARGE');
});
