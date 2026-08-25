import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import test from 'node:test';

test('renames administrative and teaching classes without changing identity or invalidating the timetable', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'class-name-'));
  const stateFile = join(directory, 'state.json');
  const previousStateFile = process.env.STATE_FILE;
  process.env.STATE_FILE = stateFile;
  writeFileSync(stateFile, `${JSON.stringify({
    meta: { revision: 1, school: '测试学校' },
    admin_classes: [{ id: 'AC1', name: '高一（1）班', grade: 10, student_ids: ['S1'] }],
    teaching_classes: [{ id: 'TC1', name: '高一（2）班', grade: 10, student_ids: ['S1'] }],
    students: [{
      id: 'S1', name: '学生一', grade: 10,
      admin_class_id: 'AC1', teaching_class_id: 'TC1',
    }],
    teaching_assignments: [{
      id: 'TA1', class_ids: ['AC1'], class_type: 'admin',
      course_id: 'C1', teacher_id: 'T1', weekly_hours: 1,
    }],
    schedule: { sections: [], meetings: [], assignments: [], validation: { ok: true } },
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
  const base = `http://127.0.0.1:${server.address().port}/api`;

  const response = await fetch(`${base}/class-names/admin_classes/AC1`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ expected_revision: 1, name: '高一博雅班' }),
  });
  const payload = await response.json();
  assert.equal(response.status, 200, JSON.stringify(payload));
  assert.deepEqual(payload.data.class, {
    id: 'AC1', name: '高一博雅班', grade: 10, student_ids: ['S1'],
  });
  assert.equal(payload.data.revision, 2);
  assert.equal(payload.data.solve_status, 'valid');
  assert.equal(payload.data.manual_plan_status, 'confirmed');

  const persisted = JSON.parse(readFileSync(stateFile, 'utf8'));
  assert.equal(persisted.admin_classes[0].id, 'AC1');
  assert.equal(persisted.admin_classes[0].name, '高一博雅班');
  assert.equal(persisted.students[0].admin_class_id, 'AC1');
  assert.deepEqual(persisted.teaching_assignments[0].class_ids, ['AC1']);
  assert.equal(persisted.solve_status, 'valid');
  assert.equal(persisted.manual_plan.status, 'confirmed');

  const teachingResponse = await fetch(`${base}/class-names/teaching_classes/TC1`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ expected_revision: 2, name: '高一数学 A 班' }),
  });
  const teachingPayload = await teachingResponse.json();
  assert.equal(teachingResponse.status, 200, JSON.stringify(teachingPayload));
  assert.equal(teachingPayload.data.class.id, 'TC1');
  assert.equal(teachingPayload.data.class.name, '高一数学 A 班');
  assert.equal(teachingPayload.data.revision, 3);
  assert.equal(teachingPayload.data.solve_status, 'valid');
  assert.equal(teachingPayload.data.manual_plan_status, 'confirmed');
});
