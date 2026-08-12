import { solveSchedule } from './cpsat-solver.mjs';
import { AP_STUDENT_GAP_RULE_ID } from './schedule-quality.mjs';
import { validateSchedule } from './schedule-validator.mjs';

function boundResult(solution, bestKnown) {
  return {
    best_known: bestKnown,
    lower_bound: solution.status === 'OPTIMAL' ? bestKnown : null,
    proven: solution.status === 'OPTIMAL',
    status: solution.status,
  };
}

async function solveMetric(problem, metric, options) {
  const solution = await solveSchedule(problem, {
    maxTimeSeconds: options.maxTimeSeconds,
    optimizeSoft: true,
    objectiveMode: metric,
    useConstructiveSeed: false,
    freezeMembership: options.freezeMembership !== false,
    lockedMeetings: options.lockedMeetings || [],
    hintMeetings: options.hintMeetings || [],
    hintSections: options.hintSections || [],
    repairHints: false,
    randomSeed: options.randomSeed,
    numSearchWorkers: options.numSearchWorkers || 4,
  });
  if (!solution.ok) return {
    best_known: null,
    lower_bound: null,
    proven: false,
    status: solution.status,
    reason: solution.reason || '单目标分析未找到可行课表',
  };
  if (metric === 'ap_morning_empty_student_periods') {
    return boundResult(solution, Number(solution.morning_empty_student_periods || 0));
  }
  const validation = validateSchedule(problem, {
    ...solution,
    locks: options.lockedMeetings || [],
  });
  if (!validation.ok) throw new Error('单目标分析结果未通过独立硬约束校验');
  const gapDays = (validation.soft_violations || [])
    .filter(item => item.rule_id === AP_STUDENT_GAP_RULE_ID).length;
  return boundResult(solution, gapDays);
}

/** Runs two independent objectives so neither metric can trade against other
 * timetable preferences. Only OPTIMAL is reported as a mathematical bound;
 * a timed-out feasible result remains explicitly "best known". */
export async function solveScheduleQualityLowerBounds(problem, options = {}) {
  const startedAt = performance.now();
  const totalSeconds = Math.max(2, Number(options.maxTimeSeconds || 120));
  const perMetricSeconds = totalSeconds / 2;
  const common = { ...options, maxTimeSeconds: perMetricSeconds };
  const apStudentGapDays = await solveMetric(problem, 'ap_student_gap_days', common);
  const elapsedSeconds = (performance.now() - startedAt) / 1_000;
  const remainingSeconds = Math.max(0.1, totalSeconds - elapsedSeconds);
  const apMorningEmptyStudentPeriods = await solveMetric(
    problem,
    'ap_morning_empty_student_periods',
    { ...options, maxTimeSeconds: remainingSeconds },
  );
  return {
    ap_student_gap_days: apStudentGapDays,
    ap_morning_empty_student_periods: apMorningEmptyStudentPeriods,
    interpretation: apStudentGapDays.proven && apMorningEmptyStudentPeriods.proven
      ? '两个指标均已在其他软偏好关闭的情况下证明最优，可视为当前硬约束与分班结构下的独立数学下界。'
      : '至少一个指标尚未证明最优；当前数字只能视为限定时间内的最好已知值。',
    solve_duration_ms: Math.round(performance.now() - startedAt),
  };
}
