const COMPUTATION_JOBS = new Map([
  ['/api/exams/solve', {
    type: 'exam-schedule',
    label: '生成考试安排',
    resultLocation: { view: 'exam-scheduling', label: '排考试 → 安排结果' },
  }],
  ['/api/manual-plan/ai-solve', {
    type: 'manual-timetable-solve',
    label: '生成完整课表',
    resultLocation: { view: 'manual-timetable', label: '排课表 → 完整课表' },
  }],
  ['/api/solve', {
    type: 'timetable-solve',
    label: '生成正式课表',
    resultLocation: { view: 'overview-timetable', label: '总课表概览' },
  }],
  ['/api/solve-sections', {
    type: 'sectioning',
    label: '生成选修课分班',
    resultLocation: { view: 'sectioning', label: '分班管理' },
  }],
  ['/api/build-tasks', {
    type: 'teaching-tasks',
    label: '生成教学任务',
    resultLocation: { view: 'assignments', label: '教师分工 → 教学任务' },
  }],
  ['/api/schedule-quality-lower-bounds', {
    type: 'quality-analysis',
    label: '分析课表质量下界',
    resultLocation: { view: 'manual-timetable', label: '排课表 → 质量分析' },
  }],
]);

export function computationJobDescriptor(method, path) {
  if (String(method).toUpperCase() !== 'POST') return null;
  const descriptor = COMPUTATION_JOBS.get(String(path).split('?')[0]);
  return descriptor ? structuredClone(descriptor) : null;
}

const SOLVER_STAGE_PRESENTATION = {
  'fallback-construction': { percent: 20, message: '正在构造第一份完整可行方案' },
  'feasible-first-candidate': { percent: 35, message: '正在搜索满足全部硬约束的候选方案' },
  'feasible-first-candidate-complete': { percent: 58, message: '已有可行候选，正在比较质量' },
  'global-optimization': { percent: 68, message: '正在以可行方案为保底进行全局优化' },
  'global-optimization-complete': { percent: 90, message: '全局优化结束，正在独立校验结果' },
  'constructive-initial': { percent: 22, message: '正在构造初始完整课表' },
};

export function solverProgressForJob(data = {}) {
  const presentation = SOLVER_STAGE_PRESENTATION[data.stage] || {
    percent: 45,
    message: '约束求解器正在计算',
  };
  const candidateProgress = data.stage === 'feasible-first-candidate'
    && Number(data.candidate_count) > 0
    ? Math.round(30 + (Number(data.candidate) - 1) / Number(data.candidate_count) * 25)
    : presentation.percent;
  return {
    stage: String(data.stage || 'solver'),
    percent: candidateProgress,
    message: presentation.message,
  };
}
