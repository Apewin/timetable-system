import { solveSchedule } from './cpsat-solver.mjs';
import {
  candidateQuality,
  compareQuality,
  solveFeasibleFirstSchedule,
} from './feasible-first-solver.mjs';
import { validateSchedule } from './schedule-validator.mjs';

function qualitySummary(quality) {
  if (!quality) return null;
  const measured = value => value === Number.MAX_SAFE_INTEGER ? null : value;
  return {
    review_item_count: quality.reviewItemCount,
    ap_block_first_period_deviation: measured(quality.apBlockFirstPeriodDeviation),
    ap_block_outside_preferred_band_occurrences: measured(quality.apBlockAfternoonOccurrences),
    morning_empty_student_periods: measured(quality.morningEmptyStudentPeriods),
    soft_score: quality.softScore,
    first_period_gap_days: quality.firstPeriodGapDays,
  };
}

function evaluatedCandidate(originalProblem, effectiveProblem, solution, locks, deferredRuleIds) {
  if (!solution?.ok) return null;
  const validation = validateSchedule(effectiveProblem, { ...solution, locks });
  if (!validation.ok) return null;
  const policyValidation = validateSchedule(originalProblem, { ...solution, locks });
  const quality = candidateQuality(
    policyValidation,
    validation,
    deferredRuleIds,
    solution,
  );
  if (quality.immutableViolations.length) return null;
  return { solution, validation, policyValidation, quality };
}

/**
 * Returns a validated timetable even when the expensive optimization pass
 * fails. Construction receives only a small capped budget; the complete draft
 * then becomes a hint—not a lock—for one global lexicographic optimization
 * using all remaining time.
 */
export async function solveResilientOptimizedSchedule(problem, options = {}) {
  const startedAt = performance.now();
  const maxTimeSeconds = Math.max(1, Number(options.maxTimeSeconds || 120));
  const deadline = startedAt + maxTimeSeconds * 1_000;
  const constructionBudget = Math.min(
    Number(options.maxConstructionSeconds || 8),
    Math.max(1, maxTimeSeconds * Number(options.constructionShare || 0.08)),
  );
  const locks = options.lockedMeetings || [];
  const progress = typeof options.onProgress === 'function' ? options.onProgress : () => {};

  progress({ stage: 'fallback-construction', time_limit_seconds: constructionBudget });
  const initial = await solveFeasibleFirstSchedule(problem, {
    ...options,
    maxTimeSeconds: constructionBudget,
    candidateCount: 1,
    constructiveFirst: true,
    lockedMeetings: locks,
  });
  const constructionDurationMs = Math.round(performance.now() - startedAt);
  if (!initial.ok) return {
    ...initial,
    algorithm: 'constructive-fallback-global-optimize',
    construction_duration_ms: constructionDurationMs,
    global_optimization: { attempted: false, accepted: false, status: 'NOT_RUN' },
    solve_duration_ms: Math.round(performance.now() - startedAt),
  };

  const deferredRuleIds = initial.deferred_rule_ids || [];
  const effectiveProblem = { ...problem, rules: initial.effective_rules || problem.rules || [] };
  const fallback = evaluatedCandidate(problem, effectiveProblem, initial, locks, deferredRuleIds);
  if (!fallback) throw new Error('构造保底课表未通过独立硬约束校验');

  const remainingSeconds = Math.max(0, (deadline - performance.now()) / 1_000);
  let optimized = null;
  let globalSolution = null;
  if (remainingSeconds >= 0.05) {
    progress({ stage: 'global-optimization', time_limit_seconds: remainingSeconds });
    globalSolution = await solveSchedule(effectiveProblem, {
      maxTimeSeconds: remainingSeconds,
      optimizeSoft: true,
      freezeMembership: options.freezeMembership === true,
      lockedMeetings: locks,
      hintMeetings: initial.meetings,
      hintSections: initial.sections,
      // Normal search safely consumes the draft as a hint. Native HINT_SEARCH
      // remains disabled because its assertion failures motivated the worker
      // process seam in the first place.
      repairHints: false,
      randomSeed: options.randomSeed,
      numSearchWorkers: options.numSearchWorkers || 4,
    });
    optimized = evaluatedCandidate(
      problem,
      effectiveProblem,
      globalSolution,
      locks,
      deferredRuleIds,
    );
  }

  const accepted = Boolean(optimized && compareQuality(optimized.quality, fallback.quality) <= 0);
  const best = accepted ? optimized : fallback;
  const reviewItems = best.quality.reviewItems;
  progress({
    stage: 'global-optimization-complete',
    status: globalSolution?.status || 'NOT_RUN',
    accepted,
    fallback_quality_score: fallback.quality.score,
    quality_score: best.quality.score,
  });

  return {
    ...best.solution,
    ok: true,
    status: reviewItems.length
      ? 'RESILIENT_OPTIMIZE_REVIEW'
      : accepted
        ? 'RESILIENT_OPTIMIZED'
        : 'RESILIENT_FEASIBLE_FALLBACK',
    algorithm: 'constructive-fallback-global-optimize',
    effective_rules: effectiveProblem.rules,
    deferred_rule_ids: deferredRuleIds,
    review_required: reviewItems.length > 0,
    review_items: reviewItems,
    validation: best.validation,
    policy_validation: best.policyValidation,
    quality_score: best.quality.score,
    candidate_count: accepted ? 2 : 1,
    attempts: [
      ...(initial.attempts || []),
      ...(globalSolution ? [{
        candidate: 'global',
        status: globalSolution.status,
        time_limit_seconds: remainingSeconds,
      }] : []),
    ],
    construction_duration_ms: constructionDurationMs,
    fallback_quality_score: fallback.quality.score,
    global_optimization: {
      attempted: Boolean(globalSolution),
      accepted,
      comparison: accepted ? 'global_not_worse' : 'fallback_better',
      status: globalSolution?.status || 'NOT_RUN',
      time_limit_seconds: remainingSeconds,
      quality_score: optimized?.quality.score ?? null,
      fallback_quality: qualitySummary(fallback.quality),
      optimized_quality: qualitySummary(optimized?.quality),
    },
    solve_duration_ms: Math.round(performance.now() - startedAt),
  };
}
