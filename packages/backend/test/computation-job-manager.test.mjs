import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { createComputationJobManager } from '../src/computation-job-manager.mjs';
import { computationJobDescriptor } from '../src/computation-job-policy.mjs';

async function eventually(read, predicate, timeoutMs = 1_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = read();
    if (predicate(value)) return value;
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  throw new Error('timed out waiting for computation job');
}

test('a computation job exposes real stages, survives page-style polling, and returns its result', async () => {
  const manager = createComputationJobManager();
  const started = manager.start({
    type: 'test', label: '测试计算', actor: 'admin',
    resultLocation: { view: 'status', label: '系统状态' },
    run: async ({ progress }) => {
      progress({ stage: 'solving', percent: 55, message: '正在求解约束' });
      return { answer: 42 };
    },
  });
  assert.equal(started.status, 'queued');

  const finished = await eventually(
    () => manager.get(started.id),
    value => value.status === 'succeeded',
  );
  assert.equal(finished.percent, 100);
  assert.deepEqual(finished.result, { answer: 42 });
  assert.deepEqual(finished.result_location, { view: 'status', label: '系统状态' });
});

test('a running computation can be cancelled without reporting success later', async () => {
  const manager = createComputationJobManager();
  const started = manager.start({
    type: 'slow', label: '慢计算', actor: 'admin',
    run: ({ signal, progress }) => new Promise((resolve, reject) => {
      progress({ stage: 'solver', percent: 20, message: '求解中' });
      signal.addEventListener('abort', () => reject(Object.assign(new Error('cancelled'), {
        code: 'SOLVER_JOB_CANCELLED',
      })), { once: true });
    }),
  });
  await eventually(() => manager.get(started.id), value => value.status === 'running');
  assert.equal(manager.cancel(started.id).status, 'cancelled');
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(manager.get(started.id).status, 'cancelled');
});

test('job metadata persists and an in-flight job is marked interrupted after a backend restart', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'timetable-job-manager-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const file = join(directory, 'jobs.json');
  const manager = createComputationJobManager({ file });
  const started = manager.start({
    type: 'slow', label: '慢计算', actor: 'admin',
    run: () => new Promise(() => {}),
  });
  await eventually(() => manager.get(started.id), value => value.status === 'running');

  const restored = createComputationJobManager({ file });
  assert.equal(restored.get(started.id).status, 'interrupted');
  assert.match(restored.get(started.id).message, /后端重启/);
  manager.cancel(started.id);
});

test('only known scheduling computations can enter the asynchronous job seam', () => {
  assert.equal(computationJobDescriptor('POST', '/api/exams/solve').type, 'exam-schedule');
  assert.equal(computationJobDescriptor('POST', '/api/teachers'), null);
  assert.equal(computationJobDescriptor('GET', '/api/exams/solve'), null);
});
