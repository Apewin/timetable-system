import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import test from 'node:test';
import ExcelJS from 'exceljs';

test('saves, solves, retrieves, and exports one exam plan through the public API', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'timetable-exams-'));
  const stateFile = join(directory, 'state.json');
  const previousStateFile = process.env.STATE_FILE;
  process.env.STATE_FILE = stateFile;
  writeFileSync(stateFile, `${JSON.stringify({
    meta: { revision: 1, school: '测试学校' },
    courses: [
      { id: 'MATH', name: '数学', type: 'required', grade: 10 },
      { id: 'AP_MICRO', name: 'AP Microeconomics', type: 'ap', grade: 10 },
    ],
    students: [
      { id: 'S1', name: '张三', grade: 10 },
      { id: 'S2', name: '李四', grade: 10 },
    ],
    teachers: [],
    teaching_assignments: [],
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
  const base = `http://127.0.0.1:${server.address().port}/api/exams`;

  const saveResponse = await fetch(base, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      expected_revision: 1,
      plan: {
        config: {
          timetable_only: true,
          day_count: 3,
          day_start: '08:00',
          day_end: '12:00',
          breaks: [],
          room_count: 1,
          room_capacity: 30,
          require_every_teacher_invigilates: false,
        },
        exams: [
          { id: 'EXAM_MATH', course_id: 'MATH', duration_minutes: 90 },
          {
            id: 'EXAM_IMPORT_G10_R14_AP_MICRO',
            course_id: 'AP_MICRO',
            duration_minutes: 90,
          },
        ],
      },
    }),
  });
  const savedPlan = await saveResponse.json();
  assert.equal(saveResponse.status, 200);
  assert.equal(savedPlan.data.plan.exams[0].student_count, 2);
  assert.equal(savedPlan.data.plan.exams[1].student_count, 0);
  assert.equal(savedPlan.data.revision, 2);

  const solveResponse = await fetch(`${base}/solve`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ expected_revision: 2 }),
  });
  const solved = await solveResponse.json();
  assert.equal(solveResponse.status, 200, JSON.stringify(solved));
  assert.equal(solved.data.schedule.ok, true);
  assert.equal(solved.data.schedule.validation.ok, true);
  assert.equal(solved.data.revision, 3);

  const readPayload = await (await fetch(base)).json();
  assert.deepEqual(
    readPayload.data.schedule.sessions.map(session => session.course_name).sort(),
    ['AP Microeconomics', '数学'].sort(),
  );

  const exportResponse = await fetch(`${base}/export`);
  assert.equal(exportResponse.status, 200);
  assert.match(exportResponse.headers.get('content-type'), /spreadsheetml/);
  assert.match(exportResponse.headers.get('content-disposition'), /%E4%B8%89%E4%B8%AA%E5%B9%B4%E7%BA%A7%E8%80%83%E8%AF%95%E6%97%B6%E9%97%B4%E8%A1%A8/);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(Buffer.from(await exportResponse.arrayBuffer()));
  assert.ok(workbook.getWorksheet('高一考试时间表'));

  const persisted = JSON.parse(readFileSync(stateFile, 'utf8'));
  assert.equal(persisted.exam_solve_status, 'valid');
  assert.equal(persisted.exam_schedule.sessions.length, 2);

  const invalidPersisted = structuredClone(persisted);
  const [firstSession, secondSession] = invalidPersisted.exam_schedule.sessions;
  secondSession.day_index = firstSession.day_index;
  secondSession.global_start_unit = firstSession.global_start_unit + 3;
  secondSession.start_unit = firstSession.end_unit;
  secondSession.end_unit = secondSession.start_unit + 3;
  writeFileSync(stateFile, `${JSON.stringify(invalidPersisted)}\n`);

  const invalidReadResponse = await fetch(base);
  const invalidReadPayload = await invalidReadResponse.json();
  assert.equal(invalidReadPayload.data.solve_status, 'stale');
  assert.equal(
    invalidReadPayload.data.schedule.validation.violations
      .some(item => item.code === 'GRADE_EXAM_GAP_TOO_SHORT'),
    true,
  );
  assert.equal((await fetch(`${base}/export`)).status, 400);

  writeFileSync(stateFile, `${JSON.stringify(persisted)}\n`);

  const deleteResponse = await fetch(`${base.replace(/\/exams$/, '')}/courses/MATH`, {
    method: 'DELETE',
  });
  assert.equal(deleteResponse.status, 200);

  const staleResponse = await fetch(base);
  const stalePayload = await staleResponse.json();
  assert.equal(staleResponse.status, 200);
  assert.equal(stalePayload.data.solve_status, 'stale');
  assert.equal(stalePayload.data.plan.exams[0].course_id, 'MATH');
  assert.equal(stalePayload.data.plan_issues[0].code, 'UNKNOWN_EXAM_COURSE');
});
