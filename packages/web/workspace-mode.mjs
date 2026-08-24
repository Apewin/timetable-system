const WORKSPACE_MODE_PRESENTATION = Object.freeze({
  schedule: Object.freeze({
    mark: '排',
    title: '智能排课',
    subtitle: 'Academic Scheduler',
    footerTitle: 'Rules-first 引擎',
    footerSubtitle: '硬约束独立校验',
    primaryAction: '进入排课',
    switchLabel: '切换到智能排考试模式',
  }),
  exam: Object.freeze({
    mark: '考',
    title: '智能排考试',
    subtitle: 'Exam Scheduler',
    footerTitle: 'CP-SAT 排考引擎',
    footerSubtitle: '考试周独立约束',
    primaryAction: '进入排考试',
    switchLabel: '切换到智能排课模式',
  }),
});

export function normalizeWorkspaceMode(mode) {
  return mode === 'exam' ? 'exam' : 'schedule';
}

export function workspaceModeForView(viewName) {
  return viewName === 'exam-scheduling' ? 'exam' : 'schedule';
}

export function workspaceModePresentation(mode) {
  return WORKSPACE_MODE_PRESENTATION[normalizeWorkspaceMode(mode)];
}
