import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

async function pollJob(base, id) {
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    const response = await fetch(`${base}/api/computation-jobs/${id}`);
    const job = (await response.json()).data;
    if (!['queued', 'running'].includes(job.status)) return job;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error('timed out waiting for API computation job');
}

test('known computations return a pollable job while ordinary mutations stay synchronous', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'timetable-computation-api-'));
  const stateFile = join(directory, 'state.json');
  writeFileSync(stateFile, `${JSON.stringify({
    meta: { revision: 1, school: '作业测试学校' },
    teachers: [], rooms: [], courses: [], students: [], admin_classes: [],
    teaching_classes: [], teaching_assignments: [], selection_blocks: [], constraints: [],
  })}\n`);
  const previous = {
    STATE_FILE: process.env.STATE_FILE,
    TIMETABLE_AUTH_MODE: process.env.TIMETABLE_AUTH_MODE,
    TIMETABLE_JOB_FILE: process.env.TIMETABLE_JOB_FILE,
    TIMETABLE_AUDIT_FILE: process.env.TIMETABLE_AUDIT_FILE,
  };
  process.env.STATE_FILE = stateFile;
  process.env.TIMETABLE_AUTH_MODE = 'off';
  process.env.TIMETABLE_JOB_FILE = join(directory, 'jobs.json');
  process.env.TIMETABLE_AUDIT_FILE = join(directory, 'audit.jsonl');

  const { startServer } = await import(`../src/server.mjs?computation-api=${Date.now()}`);
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

  const accepted = await fetch(`${base}/api/build-tasks`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-computation-job': 'async' },
    body: '{}',
  });
  assert.equal(accepted.status, 202);
  const id = (await accepted.json()).data.job.id;
  const completed = await pollJob(base, id);
  assert.equal(completed.status, 'succeeded');
  assert.equal(completed.result.tasks_generated, 0);
  assert.equal(completed.result_location.view, 'assignments');
  const currentRevision = (await (await fetch(`${base}/api/status`)).json()).data.revision;

  const mutation = await fetch(`${base}/api/teachers`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-computation-job': 'async',
      'if-match': `"${currentRevision}"`,
    },
    body: JSON.stringify({
      id: 'T1', name: '教师一', can_teach: [], available_slots: [],
      max_per_day: 5, max_per_week: 20,
    }),
  });
  assert.equal(mutation.status, 200);
  assert.equal((await mutation.json()).data.id, 'T1');
});
