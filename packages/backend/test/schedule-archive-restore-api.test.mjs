import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { createScheduleArchive } from '../src/schedule-archive.mjs';

function timetableState(courseName, revision = 1) {
  return {
    meta: { revision, school: '恢复测试学校' },
    courses: [{ id: 'MATH', name: courseName }],
    teachers: [{ id: 'T1', name: '王老师' }],
    rooms: [{ id: 'R1', name: '101' }],
    students: [{ id: 'S1', name: '学生甲' }],
    admin_classes: [],
    teaching_classes: [{ id: 'TC1', name: '教学一班' }],
    constraints: [],
    solve_status: 'valid',
    schedule: {
      version: 1,
      sections: [{
        id: 'SEC1', course_id: 'MATH', teacher_id: 'T1', room_id: 'R1',
        class_id: 'TC1', class_type: 'teaching', student_ids: ['S1'],
      }],
      meetings: [{ section_id: 'SEC1', slot_id: 'D1P1', room_id: 'R1' }],
      validation: { ok: true, hard_violations: [] },
      publication_status: 'ready',
    },
  };
}

test('restoring a named archive creates a safety snapshot and replaces the active timetable context', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'timetable-archive-restore-'));
  const stateFile = join(directory, 'state.json');
  const archived = timetableState('归档数学');
  const target = createScheduleArchive(archived, {
    id: 'ARCHIVE_TARGET',
    name: '2025–2026 学年正式课表',
    notes: '历史版本',
  });
  const current = timetableState('当前数学', 8);
  current.schedule.version = 2;
  current.schedule_archives = [target];
  writeFileSync(stateFile, `${JSON.stringify(current)}\n`);
  const previous = {
    STATE_FILE: process.env.STATE_FILE,
    TIMETABLE_AUTH_MODE: process.env.TIMETABLE_AUTH_MODE,
    TIMETABLE_AUDIT_FILE: process.env.TIMETABLE_AUDIT_FILE,
  };
  process.env.STATE_FILE = stateFile;
  process.env.TIMETABLE_AUTH_MODE = 'off';
  process.env.TIMETABLE_AUDIT_FILE = join(directory, 'audit.jsonl');

  const { startServer } = await import(`../src/server.mjs?archive-restore=${Date.now()}`);
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

  const previewResponse = await fetch(`${base}/api/schedule-archives/ARCHIVE_TARGET/restore-preview`);
  const preview = (await previewResponse.json()).data;
  assert.equal(previewResponse.status, 200);
  assert.equal(preview.revision, 8);
  assert.deepEqual(preview.impact.courses, { current: 1, restored: 1 });
  assert.equal(preview.creates_safety_snapshot, true);

  const restoreResponse = await fetch(`${base}/api/schedule-archives/ARCHIVE_TARGET/restore`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ expected_revision: 8, confirmation: 'ARCHIVE_TARGET' }),
  });
  const restorePayload = await restoreResponse.json();
  assert.equal(restoreResponse.status, 200, JSON.stringify(restorePayload));
  const restored = restorePayload.data;
  assert.match(restored.message, /已恢复/);
  assert.match(restored.safety_archive.name, /恢复前自动备份/);

  const saved = JSON.parse(readFileSync(stateFile, 'utf8'));
  assert.equal(saved.meta.revision, 9);
  assert.equal(saved.courses[0].name, '归档数学');
  assert.equal(saved.schedule.version, 1);
  assert.equal(saved.schedule_archives.length, 2);
  assert.equal(saved.schedule_archives[0].name.includes('恢复前自动备份'), true);
});
