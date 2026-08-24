import assert from 'node:assert/strict';
import test from 'node:test';

import {
  computationRequestDescriptor,
  computationProgressSnapshot,
} from '../computation-progress.mjs';

test('reports honest time-budget progress without claiming completion early', () => {
  const halfway = computationProgressSnapshot({
    startedAt: 1_000,
    now: 46_000,
    maxSeconds: 90,
  });
  assert.equal(halfway.state, 'running');
  assert.equal(halfway.elapsedSeconds, 45);
  assert.ok(halfway.percent >= 45 && halfway.percent <= 55);
  assert.match(halfway.timeText, /已用 45 秒.*预计预算 90 秒/);
  assert.match(halfway.note, /按时间预算估算/);

  const overdue = computationProgressSnapshot({
    startedAt: 1_000,
    now: 96_000,
    maxSeconds: 90,
  });
  assert.equal(overdue.percent, 95);
  assert.match(overdue.timeText, /后台仍在安全收尾/);

  const completed = computationProgressSnapshot({
    startedAt: 1_000,
    now: 31_000,
    maxSeconds: 90,
    state: 'success',
  });
  assert.equal(completed.percent, 100);
  assert.equal(completed.percentText, '100%');
});

test('recognizes every scheduling calculation request and its time budget', () => {
  assert.deepEqual(computationRequestDescriptor('/exams/solve', {
    method: 'POST',
    body: JSON.stringify({ max_time_seconds: 90 }),
  }), {
    label: '正在计算考试安排',
    successText: '考试安排计算完成',
    maxSeconds: 90,
  });
  assert.equal(computationRequestDescriptor('/manual-plan/ai-solve', {
    method: 'POST',
    body: JSON.stringify({ max_time_seconds: 120, use_ai_strategy: true }),
  }).maxSeconds, 210);
  assert.equal(computationRequestDescriptor('/manual-plan/ai-solve', {
    method: 'POST',
    body: JSON.stringify({ max_time_seconds: 120, use_ai_strategy: false }),
  }).maxSeconds, 120);
  assert.equal(computationRequestDescriptor('/solve', {
    method: 'POST',
    body: JSON.stringify({ timeout: 45_000 }),
  }).maxSeconds, 45);
  assert.equal(computationRequestDescriptor('/solve-sections', { method: 'POST' }).label, '正在计算选修课分班');
  assert.equal(computationRequestDescriptor('/ai/solve', { method: 'POST' }).label, '正在生成 AI 排课方案');
  assert.equal(computationRequestDescriptor('/build-tasks', { method: 'POST' }).label, '正在生成教学任务');
  assert.equal(computationRequestDescriptor('/exams/solve', { method: 'GET' }), null);
});

test('a failed calculation is terminal instead of leaving the bar looking stuck', () => {
  const failed = computationProgressSnapshot({
    startedAt: 1_000,
    now: 11_000,
    maxSeconds: 90,
    state: 'error',
  });
  assert.equal(failed.percent, 100);
});
