import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

test('system status explains review requirements and distinguishes meetings from student-period rows', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'timetable-system-status-'));
  const stateFile = join(directory, 'state.json');
  writeFileSync(stateFile, `${JSON.stringify({
    meta: { revision: 7, school: '状态测试学校' },
    teachers: [],
    rooms: [],
    courses: [{ id: 'C1', name: '测试课程' }],
    students: [{ id: 'S1' }, { id: 'S2' }],
    constraints: [],
    solve_status: 'valid',
    schedule: {
      sections: [{
        id: 'SEC1', course_id: 'C1', class_id: 'TC1', class_type: 'teaching',
        teacher_id: null, student_ids: ['S1', 'S2'],
      }],
      meetings: [{ section_id: 'SEC1', slot_id: 'D1P1', room_id: null }],
      publication_status: 'review_required',
      review_items: [{ code: 'AP_GAP', message: '一名 AP 学生存在全天空档' }],
      quality_gate: {
        passed: false,
        issues: [{ code: 'AP_GAP', message: '一名 AP 学生存在全天空档' }],
      },
    },
  })}\n`);
  const previous = {
    STATE_FILE: process.env.STATE_FILE,
    TIMETABLE_AUTH_MODE: process.env.TIMETABLE_AUTH_MODE,
    TIMETABLE_AUDIT_FILE: process.env.TIMETABLE_AUDIT_FILE,
    TIMETABLE_RELEASE_COMMIT: process.env.TIMETABLE_RELEASE_COMMIT,
  };
  process.env.STATE_FILE = stateFile;
  process.env.TIMETABLE_AUTH_MODE = 'off';
  process.env.TIMETABLE_AUDIT_FILE = join(directory, 'audit.jsonl');
  process.env.TIMETABLE_RELEASE_COMMIT = '0123456789abcdef0123456789abcdef01234567';

  const { startServer } = await import(`../src/server.mjs?system-status=${Date.now()}`);
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

  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/status`);
  const payload = await response.json();
  assert.equal(response.status, 200, JSON.stringify(payload));
  const status = payload.data;

  assert.equal(status.counts.assignments, 2);
  assert.equal(status.counts.meetings, 1);
  assert.equal(status.release_commit, '0123456789abcdef0123456789abcdef01234567');
  assert.equal(status.review_required, true);
  assert.deepEqual(status.review_items, [
    { code: 'AP_GAP', message: '一名 AP 学生存在全天空档' },
  ]);
  assert.equal(status.quality_gate.passed, false);
});
