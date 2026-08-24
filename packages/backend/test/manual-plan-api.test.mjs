import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import test from 'node:test';

test('a newly confirmed manual plan replaces stale manual locks saved in the previous schedule', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'timetable-manual-plan-'));
  const stateFile = join(directory, 'state.json');
  const previousStateFile = process.env.STATE_FILE;
  process.env.STATE_FILE = stateFile;
  writeFileSync(stateFile, `${JSON.stringify({
    meta: { revision: 1 },
    students: [{
      id: 'S1', name: '学生一', grade: 10,
      admin_class_id: 'AC1', teaching_class_id: 'TC1',
    }],
    admin_classes: [{ id: 'AC1', name: '高一一班', grade: 10, student_ids: ['S1'] }],
    teaching_classes: [{ id: 'TC1', name: '高一教学一班', grade: 10, student_ids: ['S1'] }],
    courses: [{
      id: 'MATH', name: '数学', type: 'required', grade: 10, weekly_hours: 1,
      delivery_class_type_by_grade: { 10: 'teaching' },
    }],
    teachers: [{ id: 'T1', name: '数学教师', can_teach: ['MATH'] }],
    teaching_assignments: [{
      id: 'A1', course_id: 'MATH', teacher_id: 'T1', class_type: 'teaching',
      class_ids: ['TC1'], weekly_hours: 1,
    }],
    constraints: [],
    selection_blocks: [],
    manual_plan: {
      status: 'confirmed',
      locks: [{
        section_id: 'SEC_teaching_A1_TC1', slot_id: 'D1P1', origin: 'manual',
      }],
    },
    schedule: {
      version: 1,
      sections: [],
      meetings: [],
      assignments: [],
      locks: [{
        section_id: 'SEC_teaching_REMOVED_TC1', slot_id: 'D1P2', origin: 'manual',
      }],
    },
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

  const response = await fetch(
    `http://127.0.0.1:${server.address().port}/api/manual-plan/ai-solve`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        use_ai_strategy: false,
        solver_strategy: 'exact',
        max_time_seconds: 5,
        num_search_workers: 1,
      }),
    },
  );
  const payload = await response.json();

  assert.equal(response.status, 200, JSON.stringify(payload));
  assert.equal(payload.ok, true, JSON.stringify(payload));
  assert.equal(payload.data.solved, true, payload.data.reason || payload.data.status);
  assert.equal(payload.data.manual_lock_count, 1);
});
