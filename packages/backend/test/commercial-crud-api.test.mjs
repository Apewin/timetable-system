import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

async function startCommercialTestServer(t) {
  const directory = mkdtempSync(join(tmpdir(), 'timetable-commercial-crud-'));
  const stateFile = join(directory, 'state.json');
  writeFileSync(stateFile, `${JSON.stringify({
    meta: { revision: 7, school: '商用验收学校' },
    teachers: [{
      id: 'T1', name: '教师一', can_teach: ['C1'], available_slots: [],
      max_per_day: 5, max_per_week: 20,
    }],
    rooms: [],
    courses: [{ id: 'C1', name: '课程一', type: 'required', weekly_hours: 1, grade: [10] }],
    students: [],
    admin_classes: [{ id: 'AC1', name: '行政班一', grade: 10, student_ids: [] }],
    teaching_classes: [{ id: 'TC1', name: '教学班一', grade: 10, student_ids: [] }],
    teaching_assignments: [], selection_blocks: [], constraints: [],
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
  const { startServer } = await import(`../src/server.mjs?commercial-crud=${Date.now()}`);
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
  return {
    base: `http://127.0.0.1:${server.address().port}`,
    stateFile,
  };
}

function jsonMutation(method, body, revision) {
  return {
    method,
    headers: {
      'content-type': 'application/json',
      ...(revision === undefined ? {} : { 'if-match': `"${revision}"` }),
    },
    body: JSON.stringify(body),
  };
}

test('generic CRUD requires a state revision and rejects a stale overwrite', async t => {
  const { base, stateFile } = await startCommercialTestServer(t);

  const missing = await fetch(`${base}/api/teachers/T1`, jsonMutation('PUT', { name: '无版本修改' }));
  assert.equal(missing.status, 428);
  assert.equal((await missing.json()).errors[0].code, 'STATE_VERSION_REQUIRED');

  const first = await fetch(`${base}/api/teachers/T1`, jsonMutation('PUT', { name: '第一次修改' }, 7));
  assert.equal(first.status, 200);
  assert.equal(first.headers.get('x-state-revision'), '8');

  const stale = await fetch(`${base}/api/teachers/T1`, jsonMutation('PUT', {
    name: '过期修改', expected_revision: 7,
  }, 7));
  assert.equal(stale.status, 409);
  assert.equal((await stale.json()).errors[0].code, 'STATE_VERSION_CONFLICT');

  const saved = JSON.parse(readFileSync(stateFile, 'utf8'));
  assert.equal(saved.teachers[0].name, '第一次修改');
  assert.equal(Object.hasOwn(saved.teachers[0], 'expected_revision'), false);
});

test('generic CRUD rejects orphan references before they are persisted', async t => {
  const { base, stateFile } = await startCommercialTestServer(t);

  const orphanTeacher = await fetch(`${base}/api/teachers`, jsonMutation('POST', {
    id: 'T2', name: '悬空教师', can_teach: ['COURSE_MISSING'], available_slots: [],
    max_per_day: 5, max_per_week: 20,
  }, 7));
  assert.equal(orphanTeacher.status, 422);
  assert.equal((await orphanTeacher.json()).errors[0].code, 'ENTITY_REFERENCE_INVALID');

  const orphanAssignment = await fetch(`${base}/api/teaching_assignments`, jsonMutation('POST', {
    id: 'TA1', course_id: 'C1', teacher_id: 'T_MISSING',
    class_type: 'teaching', class_ids: ['TC1'], weekly_hours: 1,
  }, 7));
  assert.equal(orphanAssignment.status, 422);
  assert.equal((await orphanAssignment.json()).errors[0].code, 'ENTITY_REFERENCE_INVALID');

  const unqualifiedAssignment = await fetch(`${base}/api/teaching_assignments`, jsonMutation('POST', {
    id: 'TA2', course_id: 'C1', teacher_id: 'T2',
    class_type: 'teaching', class_ids: ['TC1'], weekly_hours: 1,
  }, 7));
  assert.equal(unqualifiedAssignment.status, 422);
  assert.equal((await unqualifiedAssignment.json()).errors[0].code, 'ENTITY_REFERENCE_INVALID');

  const saved = JSON.parse(readFileSync(stateFile, 'utf8'));
  assert.equal(saved.teachers.length, 1);
  assert.deepEqual(saved.teaching_assignments, []);
  assert.equal(saved.meta.revision, 7);
});

test('generic CRUD exposes stable conflict and not-found error codes', async t => {
  const { base } = await startCommercialTestServer(t);
  const duplicate = await fetch(`${base}/api/teachers`, jsonMutation('POST', {
    id: 'T1', name: '重复教师', can_teach: ['C1'], available_slots: [],
  }, 7));
  assert.equal(duplicate.status, 409);
  assert.equal((await duplicate.json()).errors[0].code, 'ENTITY_ALREADY_EXISTS');

  const missing = await fetch(`${base}/api/teachers/NO_SUCH_TEACHER`, jsonMutation('PUT', {
    name: '不存在',
  }, 7));
  assert.equal(missing.status, 404);
  assert.equal((await missing.json()).errors[0].code, 'ENTITY_NOT_FOUND');

  const missingDependencies = await fetch(`${base}/api/entity-dependencies/teachers/NO_SUCH_TEACHER`);
  assert.equal(missingDependencies.status, 404);
  assert.equal((await missingDependencies.json()).errors[0].code, 'ENTITY_NOT_FOUND');

  const missingDelete = await fetch(
    `${base}/api/teachers/NO_SUCH_TEACHER`,
    jsonMutation('DELETE', {}, 7),
  );
  assert.equal(missingDelete.status, 404);
  assert.equal((await missingDelete.json()).errors[0].code, 'ENTITY_NOT_FOUND');
});
