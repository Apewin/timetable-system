import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import test from 'node:test';

test('teacher API exposes the Ansheng invigilation group and excluded roles', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'timetable-teacher-groups-'));
  const stateFile = join(directory, 'state.json');
  const previousStateFile = process.env.STATE_FILE;
  process.env.STATE_FILE = stateFile;
  writeFileSync(stateFile, `${JSON.stringify({
    meta: { revision: 1, school: '测试学校' },
    teachers: [
      { id: 'T_JIZHUREN', name: '季主任', can_teach: [] },
      { id: 'T_G10_HOMEROOM', name: '高一班主任', can_teach: [] },
      { id: 'T_EXP_A', name: '实验教师 A', can_teach: [] },
      { id: 'T_GUIDANCE', name: '升学顾问', can_teach: [] },
      { id: 'T_NORMAL', name: '普通教师', can_teach: [] },
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

  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/teachers`);
  const payload = await response.json();
  assert.equal(response.status, 200);
  const teachers = Object.fromEntries(payload.data.map(teacher => [teacher.id, teacher]));
  assert.deepEqual(
    Object.fromEntries(Object.entries(teachers).map(([id, teacher]) => [id, teacher.exam_staff_group_name])),
    {
      T_JIZHUREN: '主任',
      T_G10_HOMEROOM: '班主任',
      T_EXP_A: '实验教师',
      T_GUIDANCE: '安生教师',
      T_NORMAL: '安生教师',
    },
  );
  assert.equal(teachers.T_NORMAL.invigilation_eligible, true);
  assert.equal(teachers.T_JIZHUREN.invigilation_eligible, false);
  assert.equal(teachers.T_G10_HOMEROOM.invigilation_eligible, false);
  assert.equal(teachers.T_EXP_A.invigilation_eligible, false);
  assert.equal(teachers.T_GUIDANCE.invigilation_eligible, false);
  assert.equal(teachers.T_GUIDANCE.invigilation_exemption_reason, '升学顾问不参加监考');
});
