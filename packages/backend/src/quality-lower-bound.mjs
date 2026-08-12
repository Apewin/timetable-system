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

export function mergeMetricEvidence(searchResult, baselineValue) {
  const baseline = baselineValue != null && Number.isFinite(Number(baselineValue))
    ? Number(baselineValue)
    : null;
  const searched = searchResult?.best_known != null && Number.isFinite(Number(searchResult.best_known))
    ? Number(searchResult.best_known)
    : null;
  const useBaseline = baseline !== null && (searched === null || baseline <= searched);
  const bestKnown = useBaseline ? baseline : searched;
  return {
    ...searchResult,
    baseline_value: baseline,
    search_best_known: searched,
    best_known: bestKnown,
    best_source: useBaseline ? 'current_schedule' : 'single_objective_search',
    improved_by: baseline === null || bestKnown === null ? null : Math.max(0, baseline - bestKnown),
  };
}

function measureBaseline(problem, schedule, locks) {
  if (!schedule) return {
    ap_student_gap_days: null,
    ap_morning_empty_student_periods: null,
  };
  const validation = validateSchedule(problem, { ...schedule, locks });
  if (!validation.ok) {
    throw new Error('当前课表未通过相同硬约束校验，不能作为单目标分析基准');
  }
  const meetingsBySection = new Map();
  for (const meeting of schedule.meetings || []) {
    const slots = meetingsBySection.get(meeting.section_id) || new Set();
    slots.add(meeting.slot_id);
    meetingsBySection.set(meeting.section_id, slots);
  }
  let morningEmpty = 0;
  for (const rule of problem.rules || []) {
    if (rule.id !== AP_STUDENT_GAP_RULE_ID || rule.scope !== 'student') continue;
    const morningPeriods = Math.max(
      0,
      Math.floor(Number(rule.params?.preferred_morning_periods || 0)),
    );
    const morningSlots = (problem.slots || []).filter(slot => slot.period <= morningPeriods);
    for (const studentId of rule.target_ids || []) {
      const occupied = new Set((problem.sections || [])
        .filter(section => (section.student_ids || []).includes(studentId))
        .flatMap(section => [...(meetingsBySection.get(section.id) || [])]));
      morningEmpty += morningSlots.filter(slot => !occupied.has(slot.id)).length;
    }
  }
  return {
    ap_student_gap_days: (validation.soft_violations || [])
      .filter(item => item.rule_id === AP_STUDENT_GAP_RULE_ID).length,
    ap_morning_empty_student_periods: morningEmpty,
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
  const baseline = measureBaseline(
    problem,
    options.baselineSchedule,
    options.lockedMeetings || [],
  );
  const totalSeconds = Math.max(2, Number(options.maxTimeSeconds || 120));
  const perMetricSeconds = totalSeconds / 2;
  const common = { ...options, maxTimeSeconds: perMetricSeconds };
  const apStudentGapDays = mergeMetricEvidence(
    await solveMetric(problem, 'ap_student_gap_days', common),
    baseline.ap_student_gap_days,
  );
  const elapsedSeconds = (performance.now() - startedAt) / 1_000;
  const remainingSeconds = Math.max(0.1, totalSeconds - elapsedSeconds);
  const apMorningEmptyStudentPeriods = mergeMetricEvidence(
    await solveMetric(
      problem,
      'ap_morning_empty_student_periods',
      { ...options, maxTimeSeconds: remainingSeconds },
    ),
    baseline.ap_morning_empty_student_periods,
  );
  return {
    ap_student_gap_days: apStudentGapDays,
    ap_morning_empty_student_periods: apMorningEmptyStudentPeriods,
    analysis_scope: {
      membership: options.freezeMembership !== false
        ? 'frozen_current_sections'
        : 'solver_may_reassign_sections',
      membership_frozen: options.freezeMembership !== false,
      locks: 'preserved',
      hard_constraints: 'unchanged',
      soft_objectives: 'target_metric_only',
      directly_comparable_to_default_solver: false,
      note: options.freezeMembership !== false
        ? '本分析冻结当前 Section 分班并一次只优化一个质量指标；普通一键排课允许重新分班且使用完整词典序目标，结果不能直接等同比较。'
        : '本分析允许重新分班但一次只优化一个质量指标；普通一键排课使用完整词典序目标，结果不能直接等同比较。',
    },
    budget: {
      total_seconds: totalSeconds,
      first_metric_planned_seconds: perMetricSeconds,
      proof_guaranteed: false,
      note: '即使增加分析时间，也可能只能得到最好已知值，不能保证证明数学最优。',
    },
    interpretation: apStudentGapDays.proven && apMorningEmptyStudentPeriods.proven
      ? '两个指标均已在其他软偏好关闭的情况下证明最优，可视为当前硬约束与分班结构下的独立数学下界。'
      : '至少一个指标尚未证明最优；最好已知值取当前有效课表与本次单目标搜索结果中的较优者，只能用于决策参考。',
    solve_duration_ms: Math.round(performance.now() - startedAt),
  };
}
