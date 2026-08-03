import { solveSchedule } from './cpsat-solver.mjs';
import { validateSchedule } from './schedule-validator.mjs';

const DEFAULT_DEFERRED_RULE_TYPES = new Set(['no_internal_gaps']);

function effectiveRules(problem, options) {
  const deferredTypes = new Set(options.deferredRuleTypes || DEFAULT_DEFERRED_RULE_TYPES);
  const qualityWeight = Math.max(1, Number(options.deferredRuleWeight || 100));
  const deferredIds = [];
  const rules = (problem.rules || []).map(rule => {
    if (!rule.hard || !deferredTypes.has(rule.type)) return rule;
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

function candidateQuality(originalValidation, effectiveValidation, deferredIds) {
  const deferred = new Set(deferredIds);
  const reviewItems = originalValidation.hard_violations
    .filter(item => deferred.has(item.rule_id));
  const immutableViolations = originalValidation.hard_violations
    .filter(item => !deferred.has(item.rule_id));
  return {
    reviewItems,
    immutableViolations,
    // Producing a complete timetable dominates preference tuning.  Among
    // complete candidates, first reduce the number of daily prefix issues,
    // then use the ordinary weighted soft score as a deterministic tie-break.
    score: reviewItems.length * 1_000_000 + effectiveValidation.soft_score,
  };
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
    options.onProgress?.({
      stage: 'feasible-first-candidate',
      candidate: index + 1,
      candidate_count: candidateCount,
      time_limit_seconds: attemptSeconds,
      ai_priority_count: aiPriorityCount,
    });
    const solution = await solveSchedule(attemptProblem, {
      maxTimeSeconds: attemptSeconds,
      optimizeSoft: true,
      freezeMembership: options.freezeMembership === true,
      lockedMeetings: options.lockedMeetings || [],
      useConstructiveSeed: false,
      hintMeetings: bestSoFar?.solution.meetings || options.hintMeetings || [],
      hintSections: bestSoFar?.solution.sections || options.hintSections || [],
      repairHints: Boolean(bestSoFar),
      randomSeed: seed,
      numSearchWorkers: options.numSearchWorkers || 8,
    });
    attempts.push({
      candidate: index + 1,
      seed,
      status: solution.status,
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
    );
    if (quality.immutableViolations.length) continue;
    candidates.push({
      solution,
      effectiveValidation,
      originalValidation,
      quality,
      seed,
    });
    if (!bestSoFar || quality.score < bestSoFar.quality.score) {
      bestSoFar = candidates.at(-1);
    }
    options.onProgress?.({
      stage: 'feasible-first-candidate-complete',
      candidate: index + 1,
      quality_score: quality.score,
      review_item_count: quality.reviewItems.length,
    });
  }

  candidates.sort((left, right) =>
    left.quality.score - right.quality.score || left.seed - right.seed);
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
      : 'FEASIBLE_FIRST',
    algorithm: 'bounded-feasible-first',
    effective_rules: prepared.rules,
    deferred_rule_ids: prepared.deferredIds,
    review_required: best.quality.reviewItems.length > 0,
    review_items: best.quality.reviewItems,
    quality_score: best.quality.score,
    validation: best.effectiveValidation,
    policy_validation: best.originalValidation,
    candidate_count: candidates.length,
    attempts,
    solve_duration_ms: Math.round(performance.now() - startedAt),
  };
}
