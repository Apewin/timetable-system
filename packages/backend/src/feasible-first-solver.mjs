import { solveSchedule } from './cpsat-solver.mjs';
import { validateSchedule } from './schedule-validator.mjs';

const DEFAULT_DEFERRED_RULE_TYPES = new Set();
const EXPLICITLY_DEFERABLE_HARD_RULE_TYPES = new Set(['no_internal_gaps']);

export function deferableHardRules(problem) {
  return (problem.rules || []).filter(rule =>
    rule.hard && EXPLICITLY_DEFERABLE_HARD_RULE_TYPES.has(rule.type));
}

function effectiveRules(problem, options) {
  const deferredTypes = new Set(options.deferredRuleTypes || DEFAULT_DEFERRED_RULE_TYPES);
  const approvedIds = new Set(options.deferredRuleIds || []);
  const qualityWeight = Math.max(1, Number(options.deferredRuleWeight || 100));
  const deferredIds = [];
  const rules = (problem.rules || []).map(rule => {
    if (!rule.hard
      || !EXPLICITLY_DEFERABLE_HARD_RULE_TYPES.has(rule.type)
      || (!approvedIds.has(rule.id) && !deferredTypes.has(rule.type))) return rule;
    deferredIds.push(rule.id);
    return {
      ...rule,
      hard: false,
      weight: qualityWeight,
      deferred_for_manual_review: true,
    };
  });
  return { rules, deferredIds };
}

export function candidateQuality(originalValidation, effectiveValidation, deferredIds, solution) {
  const deferred = new Set(deferredIds);
  const reviewItems = originalValidation.hard_violations
    .filter(item => deferred.has(item.rule_id));
  const immutableViolations = originalValidation.hard_violations
    .filter(item => !deferred.has(item.rule_id));
  return {
    reviewItems,
    reviewItemCount: reviewItems.length,
    immutableViolations,
    // Producing a complete timetable dominates preference tuning. Approved
    // review items remain first; then candidate selection follows the same
    // student-morning and weighted-soft hierarchy as the CP-SAT objective.
    score: reviewItems.length * 1_000_000 + effectiveValidation.soft_score,
    softScore: effectiveValidation.soft_score,
    apBlockAfternoonOccurrences: Number(
      solution.ap_block_outside_preferred_band_occurrences
        ?? solution.ap_block_afternoon_occurrences
        ?? Number.MAX_SAFE_INTEGER,
    ),
    apBlockFirstPeriodDeviation: Number(
      solution.ap_block_first_period_deviation ?? Number.MAX_SAFE_INTEGER,
    ),
    morningEmptyStudentPeriods: Number(
      solution.morning_empty_student_periods ?? Number.MAX_SAFE_INTEGER,
    ),
    firstPeriodGapDays: (effectiveValidation.soft_violations || [])
      .filter(item => item.rule_id === 'ap_block_students_compact_daily_schedule'
        && (item.missing_periods || []).includes(1))
      .length,
  };
}

export function compareQuality(left, right) {
  return left.reviewItemCount - right.reviewItemCount
    || left.apBlockFirstPeriodDeviation - right.apBlockFirstPeriodDeviation
    || left.apBlockAfternoonOccurrences - right.apBlockAfternoonOccurrences
    || left.morningEmptyStudentPeriods - right.morningEmptyStudentPeriods
    || left.softScore - right.softScore
    || left.firstPeriodGapDays - right.firstPeriodGapDays;
}

/**
 * Bounded feasible-first scheduling.
 *
 * This is deliberately not an exhaustive/optimal search.  Immutable physical
 * constraints stay hard.  Policy rules listed in `deferredRuleTypes` become
 * high-weight review targets, and a small fixed number of seeded candidates
 * is sampled.  The best complete candidate seen before the deadline wins.
 */
export async function solveFeasibleFirstSchedule(problem, options = {}) {
  const startedAt = performance.now();
  const maxTimeSeconds = Math.max(1, Number(options.maxTimeSeconds || 120));
  const candidateCount = Math.max(1, Math.floor(Number(options.candidateCount || 3)));
  const deadline = startedAt + maxTimeSeconds * 1000;
  const prepared = effectiveRules(problem, options);
  const effectiveProblem = { ...problem, rules: prepared.rules };
  const aiPriorityRules = prepared.rules.filter(rule =>
    rule.type === 'priority' && rule.id.startsWith('ai_priority_'));
  const feasibilityRules = prepared.rules.filter(rule =>
    !(rule.type === 'priority' && rule.id.startsWith('ai_priority_')));
  const candidates = [];
  const attempts = [];
  let bestSoFar = null;
  let earlyStopReason = null;
  const firstCandidateShare = candidateCount > 1 ? 0.65 : 1;
  const laterCandidateSeconds = candidateCount > 1
    ? maxTimeSeconds * (1 - firstCandidateShare) / (candidateCount - 1)
    : 0;

  for (let index = 0; index < candidateCount && performance.now() < deadline; index += 1) {
    const remainingSeconds = Math.max(0.1, (deadline - performance.now()) / 1000);
    const plannedSeconds = index === 0
      ? maxTimeSeconds * firstCandidateShare
      : laterCandidateSeconds;
    const attemptSeconds = Math.max(0.1, Math.min(plannedSeconds, remainingSeconds));
    const seed = Number(options.randomSeed || 20260803) + index;
    const attemptProblem = index === 0
      ? { ...effectiveProblem, rules: feasibilityRules }
      : effectiveProblem;
    const aiPriorityCount = index === 0 ? 0 : aiPriorityRules.length;
    const constructiveAttempt = options.constructiveFirst === true && index === 0;
    options.onProgress?.({
      stage: 'feasible-first-candidate',
      candidate: index + 1,
      candidate_count: candidateCount,
      time_limit_seconds: attemptSeconds,
      ai_priority_count: aiPriorityCount,
    });
    const solution = await solveSchedule(attemptProblem, {
      maxTimeSeconds: attemptSeconds,
      optimizeSoft: !constructiveAttempt,
      freezeMembership: options.freezeMembership === true,
      lockedMeetings: options.lockedMeetings || [],
      useConstructiveSeed: constructiveAttempt,
      hintMeetings: bestSoFar?.solution.meetings || options.hintMeetings || [],
      hintSections: bestSoFar?.solution.sections || options.hintSections || [],
      repairHints: Boolean(bestSoFar) && aiPriorityCount === 0,
      randomSeed: seed,
      numSearchWorkers: options.numSearchWorkers || 8,
    });
    attempts.push({
      candidate: index + 1,
      seed,
      status: solution.status,
      constructive: constructiveAttempt,
      ai_priority_count: aiPriorityCount,
      time_limit_seconds: attemptSeconds,
    });
    if (!solution.ok) continue;
    const effectiveValidation = validateSchedule(effectiveProblem, {
      ...solution,
      locks: options.lockedMeetings || [],
    });
    if (!effectiveValidation.ok) continue;
    const originalValidation = validateSchedule(problem, {
      ...solution,
      locks: options.lockedMeetings || [],
    });
    const quality = candidateQuality(
      originalValidation,
      effectiveValidation,
      prepared.deferredIds,
      solution,
    );
    if (quality.immutableViolations.length) continue;
    candidates.push({
      solution,
      effectiveValidation,
      originalValidation,
      quality,
      seed,
    });
    if (!bestSoFar || compareQuality(quality, bestSoFar.quality) < 0) {
      bestSoFar = candidates.at(-1);
    }
    options.onProgress?.({
      stage: 'feasible-first-candidate-complete',
      candidate: index + 1,
      quality_score: quality.score,
      ap_block_first_period_deviation: quality.apBlockFirstPeriodDeviation,
      ap_block_afternoon_occurrences: quality.apBlockAfternoonOccurrences,
      morning_empty_student_periods: quality.morningEmptyStudentPeriods,
      first_period_gap_days: quality.firstPeriodGapDays,
      review_item_count: quality.reviewItems.length,
    });
    // With no alternate AI decision strategy and no deferred hard rule, every
    // candidate has the same feasible region and objective. Once CP-SAT proves
    // that objective optimal, new seeds cannot improve the saved candidate.
    if (solution.status === 'OPTIMAL'
      && aiPriorityRules.length === 0
      && prepared.deferredIds.length === 0) {
      earlyStopReason = 'optimal_without_alternate_search_strategy';
      break;
    }
  }

  candidates.sort((left, right) =>
    compareQuality(left.quality, right.quality) || left.seed - right.seed);
  const best = candidates[0];
  if (!best) {
    const statuses = attempts.map(attempt => attempt.status);
    const status = statuses.length && statuses.every(value => value === 'INFEASIBLE')
      ? 'INFEASIBLE'
      : 'UNKNOWN';
    return {
      ok: false,
      status,
      reason: status === 'INFEASIBLE'
        ? '不可延后的硬约束之间互相冲突'
        : '在限定时间内未构造出完整课表',
      sections: [], meetings: [], assignments: [],
      attempts,
      algorithm: 'bounded-feasible-first',
      solve_duration_ms: Math.round(performance.now() - startedAt),
    };
  }

  return {
    ...best.solution,
    status: best.quality.reviewItems.length
      ? 'FEASIBLE_FIRST_REVIEW'
      : prepared.deferredIds.length
        ? 'FEASIBLE_FIRST_APPROVED_RELAXATION'
      : 'FEASIBLE_FIRST',
    algorithm: 'bounded-feasible-first',
    effective_rules: prepared.rules,
    deferred_rule_ids: prepared.deferredIds,
    review_required: prepared.deferredIds.length > 0,
    review_items: best.quality.reviewItems,
    quality_score: best.quality.score,
    validation: best.effectiveValidation,
    policy_validation: best.originalValidation,
    candidate_count: candidates.length,
    attempts,
    early_stop_reason: earlyStopReason,
    solve_duration_ms: Math.round(performance.now() - startedAt),
  };
}
