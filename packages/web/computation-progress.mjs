function boundedSeconds(value, fallback = 90) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(300, Math.max(1, Math.round(parsed)));
}

const COMPUTATION_ROUTES = new Map([
  ['/exams/solve', {
    label: '正在计算考试安排',
    successText: '考试安排计算完成',
    defaultMaxSeconds: 90,
  }],
  ['/manual-plan/ai-solve', {
    label: '正在生成完整课表',
    successText: '完整课表计算完成',
    defaultMaxSeconds: 70,
  }],
  ['/solve', {
    label: '正在计算正式课表',
    successText: '正式课表计算完成',
    defaultMaxSeconds: 120,
  }],
  ['/solve-sections', {
    label: '正在计算选修课分班',
    successText: '选修课分班计算完成',
    defaultMaxSeconds: 60,
  }],
  ['/build-tasks', {
    label: '正在生成教学任务',
    successText: '教学任务生成完成',
    defaultMaxSeconds: 30,
  }],
  ['/ai/solve', {
    label: '正在运行智能排课（规则求解器）',
    successText: '智能排课方案计算完成',
    defaultMaxSeconds: 60,
  }],
  ['/schedule-quality-lower-bounds', {
    label: '正在分析课表质量',
    successText: '课表质量分析完成',
    defaultMaxSeconds: 120,
  }],
]);

function requestPayload(body) {
  if (body && typeof body === 'object') return body;
  if (typeof body !== 'string' || !body.trim()) return {};
  try {
    const parsed = JSON.parse(body);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

export function computationRequestDescriptor(path, options = {}) {
  if (String(options.method || 'GET').toUpperCase() !== 'POST') return null;
  const route = COMPUTATION_ROUTES.get(String(path));
  if (!route) return null;
  const payload = requestPayload(options.body);
  const requestedSeconds = Number.isFinite(Number(payload.max_time_seconds))
    ? Number(payload.max_time_seconds)
    : Number.isFinite(Number(payload.timeout))
      ? Number(payload.timeout) / 1_000
      : route.defaultMaxSeconds;
  // Manual AI scheduling first asks the model for a bounded search strategy.
  // That stage can make two 45-second attempts before the independent solver
  // receives its own time budget, so the user-facing estimate must include
  // both phases instead of presenting the solver budget as a total deadline.
  const estimatedSeconds = String(path) === '/manual-plan/ai-solve'
    && payload.use_ai_strategy !== false
    ? requestedSeconds + 90
    : requestedSeconds;
  return {
    label: route.label,
    successText: route.successText,
    maxSeconds: boundedSeconds(estimatedSeconds, route.defaultMaxSeconds),
  };
}

export function computationProgressSnapshot({
  startedAt,
  now = Date.now(),
  maxSeconds = 90,
  state = 'running',
} = {}) {
  const budgetSeconds = boundedSeconds(maxSeconds);
  const elapsedSeconds = Math.max(0, Math.floor((Number(now) - Number(startedAt)) / 1_000));
  const ratio = Math.min(1, elapsedSeconds / budgetSeconds);
  const percent = state !== 'running'
    ? 100
    : Math.min(95, Math.max(4, Math.round(4 + ratio * 91)));
  const overdue = state === 'running' && elapsedSeconds >= budgetSeconds;
  return {
    state,
    percent,
    percentText: `${percent}%`,
    elapsedSeconds,
    maxSeconds: budgetSeconds,
    overdue,
    timeText: overdue
      ? `已用 ${elapsedSeconds} 秒，超过预计的 ${budgetSeconds} 秒；后台仍在安全收尾…`
      : `已用 ${elapsedSeconds} 秒 / 预计预算 ${budgetSeconds} 秒`,
    note: '进度按时间预算估算；求解器可能提前完成。',
  };
}

export function computationJobPresentation(job, now = Date.now()) {
  const status = String(job?.status || 'queued');
  const startedAt = Date.parse(job?.started_at || job?.created_at || '');
  const finishedAt = Date.parse(job?.finished_at || '');
  const elapsedSeconds = Number.isFinite(startedAt)
    ? Math.max(0, Math.floor(((Number.isFinite(finishedAt) ? finishedAt : Number(now)) - startedAt) / 1_000))
    : 0;
  const terminal = ['succeeded', 'failed', 'cancelled', 'interrupted'].includes(status);
  const state = status === 'succeeded'
    ? 'success'
    : ['failed', 'interrupted'].includes(status)
      ? 'error'
      : status === 'cancelled'
        ? 'cancelled'
        : 'running';
  return {
    state,
    terminal,
    percent: Math.min(100, Math.max(0, Math.round(Number(job?.percent) || 0))),
    elapsedSeconds,
    timeText: terminal ? `总用时 ${elapsedSeconds} 秒` : `已运行 ${elapsedSeconds} 秒`,
    title: String(job?.label || '后台计算'),
    stageText: String(job?.message || job?.stage || '正在等待后台执行'),
    resultText: job?.result_location?.label
      ? `结果位置：${job.result_location.label}`
      : '',
  };
}
