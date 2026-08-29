import assert from 'node:assert/strict';
import test from 'node:test';

import {
  computationJobPresentation,
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

test('renders backend-reported job stages and a durable result location', () => {
  const running = computationJobPresentation({
    label: '生成考试安排', status: 'running', percent: 37,
    created_at: '2026-08-25T08:00:00.000Z',
    started_at: '2026-08-25T08:00:01.000Z',
    message: '正在安排无冲突的考试时间',
    result_location: { view: 'exam-scheduling', label: '排考试 → 安排结果' },
  }, Date.parse('2026-08-25T08:00:11.000Z'));
  assert.equal(running.percent, 37);
  assert.equal(running.timeText, '已运行 10 秒');
  assert.match(running.stageText, /无冲突/);
  assert.equal(running.resultText, '结果位置：排考试 → 安排结果');

  const failed = computationJobPresentation({
    status: 'failed', percent: 100,
    created_at: '2026-08-25T08:00:00.000Z',
    started_at: '2026-08-25T08:00:01.000Z',
    finished_at: '2026-08-25T08:00:05.000Z',
    message: '无可行解',
  });
  assert.equal(failed.terminal, true);
  assert.equal(failed.state, 'error');
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
  assert.equal(computationRequestDescriptor('/manual-plan/ai-solve', {
    method: 'POST',
    body: JSON.stringify({ use_ai_strategy: false }),
  }).maxSeconds, 70);
  assert.equal(computationRequestDescriptor('/solve', {
    method: 'POST',
    body: JSON.stringify({ timeout: 45_000 }),
  }).maxSeconds, 45);
  assert.equal(computationRequestDescriptor('/solve-sections', { method: 'POST' }).label, '正在计算选修课分班');
  assert.equal(computationRequestDescriptor('/ai/solve', { method: 'POST' }).label, '正在运行智能排课（规则求解器）');
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
