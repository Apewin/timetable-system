import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { once } from 'node:events';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

test('password mode protects the API and accepts a signed login session', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'timetable-security-api-'));
  const stateFile = join(directory, 'state.json');
  writeFileSync(stateFile, `${JSON.stringify({
    meta: { revision: 1, school: '安全测试学校' },
    teachers: [], courses: [], students: [], constraints: [],
  })}\n`);
  const previous = {
    STATE_FILE: process.env.STATE_FILE,
    TIMETABLE_AUTH_MODE: process.env.TIMETABLE_AUTH_MODE,
    TIMETABLE_ADMIN_PASSWORD: process.env.TIMETABLE_ADMIN_PASSWORD,
    TIMETABLE_SESSION_SECRET: process.env.TIMETABLE_SESSION_SECRET,
    TIMETABLE_AUDIT_FILE: process.env.TIMETABLE_AUDIT_FILE,
  };
  process.env.STATE_FILE = stateFile;
  process.env.TIMETABLE_AUTH_MODE = 'password';
  process.env.TIMETABLE_ADMIN_PASSWORD = 'school-secret';
  process.env.TIMETABLE_SESSION_SECRET = 'a-secure-session-secret-with-at-least-32-characters';
  process.env.TIMETABLE_AUDIT_FILE = join(directory, 'audit.jsonl');

  const { startServer } = await import(`../src/server.mjs?security-api=${Date.now()}`);
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
  const base = `http://127.0.0.1:${server.address().port}`;

  const anonymous = await fetch(`${base}/api/status`);
  assert.equal(anonymous.status, 401);
  assert.equal((await anonymous.json()).errors[0].code, 'AUTH_REQUIRED');

  const login = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ password: 'school-secret' }),
  });
  assert.equal(login.status, 200);
  const cookie = login.headers.get('set-cookie').split(';')[0];

  const authenticated = await fetch(`${base}/api/status`, { headers: { cookie } });
  assert.equal(authenticated.status, 200);
  const status = (await authenticated.json()).data;
  assert.equal(status.school, '安全测试学校');
  assert.equal(status.security.authentication_enabled, true);
  assert.equal(status.security.audit_enabled, true);

  const mutation = await fetch(`${base}/api/teachers`, {
    method: 'POST',
    headers: { cookie, 'content-type': 'application/json', 'if-match': '"1"' },
    body: JSON.stringify({
      id: 'T1', name: '数学教师', can_teach: [], available_slots: [],
      max_per_day: 5, max_per_week: 20,
    }),
  });
  assert.equal(mutation.status, 200);
  const audit = await (await fetch(`${base}/api/audit`, { headers: { cookie } })).json();
  const entry = audit.data.find(item => item.path === '/api/teachers');
  assert.equal(entry.actor, 'admin');
  assert.equal(entry.method, 'POST');
  assert.equal(entry.status, 200);
});
