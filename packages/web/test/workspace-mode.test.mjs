import assert from 'node:assert/strict';
import test from 'node:test';

import {
  normalizeWorkspaceMode,
  workspaceModeForView,
  workspaceModePresentation,
} from '../workspace-mode.mjs';

test('workspace mode defaults to schedule and only exam scheduling enters exam mode', () => {
  assert.equal(normalizeWorkspaceMode('schedule'), 'schedule');
  assert.equal(normalizeWorkspaceMode('exam'), 'exam');
  assert.equal(normalizeWorkspaceMode('unexpected'), 'schedule');
  assert.equal(workspaceModeForView('exam-scheduling'), 'exam');
  assert.equal(workspaceModeForView('manual-timetable'), 'schedule');
});

test('workspace mode exposes the copy used by the shell switch', () => {
  assert.deepEqual(workspaceModePresentation('exam'), {
    mark: '考',
    title: '智能排考试',
    subtitle: 'Exam Scheduler',
    footerTitle: 'CP-SAT 排考引擎',
    footerSubtitle: '考试周独立约束',
    primaryAction: '进入排考试',
    switchLabel: '切换到智能排课模式',
  });
  assert.equal(workspaceModePresentation('schedule').title, '智能排课');
  assert.equal(workspaceModePresentation('schedule').switchLabel, '切换到智能排考试模式');
});
