import { solveSchedule } from './cpsat-solver.mjs';
import { solveFeasibleFirstSchedule } from './feasible-first-solver.mjs';
import { validateSchedule } from './schedule-validator.mjs';

function synchronizedTargets(rule) {
  return rule.section_target_ids || rule.target_ids || [];
}

/**
 * A neighborhood starts with a grade, then closes over shared teachers and
 * synchronized Block rules.  Reopening that whole closure prevents a local
 * repair from freezing the other side of a real scheduling dependency.
 */
export function buildGradeNeighborhoods(problem) {
  const sections = problem.sections || [];
  const grades = [...new Set(sections
    .flatMap(section => section.grades || [])
    .map(Number)
    .filter(Number.isFinite))]
    .sort((left, right) => left - right);
  const seeds = grades.length
    ? grades.map(grade => ({ id: `grade-${grade}`, grade }))
    : [{ id: 'all-sections', grade: null }];

  return seeds.map(seed => {
    const sectionIds = new Set(seed.grade === null
      ? sections.map(section => section.id)
      : sections
        .filter(section => (section.grades || []).map(Number).includes(seed.grade))
        .map(section => section.id));
    let changed = true;
    while (changed) {
      changed = false;
      const teacherIds = new Set(sections
        .filter(section => sectionIds.has(section.id))
        .map(section => section.teacher_id)
        .filter(Boolean));
      for (const section of sections) {
        if (teacherIds.has(section.teacher_id) && !sectionIds.has(section.id)) {
          sectionIds.add(section.id);
          changed = true;
        }
      }
      for (const rule of problem.rules || []) {
        if (rule.type !== 'synchronized_slots') continue;
        const targets = synchronizedTargets(rule);
        if (!targets.some(sectionId => sectionIds.has(sectionId))) continue;
        for (const sectionId of targets) {
          if (!sectionIds.has(sectionId)) {
            sectionIds.add(sectionId);
            changed = true;
          }
        }
      }
    }
    return { ...seed, section_ids: [...sectionIds].sort() };
  });
}

function mergeLocks(...groups) {
  const merged = new Map();
  for (const lock of groups.flat()) {
    merged.set(`${lock.section_id}@${lock.slot_id}`, lock);
  }
  return [...merged.values()];
}

function qualityFor(problem, effectiveProblem, solution, lockedMeetings, deferredRuleIds) {
  const validation = validateSchedule(effectiveProblem, {
    ...solution,
    locks: lockedMeetings,
  });
  if (!validation.ok) return null;
  const policyValidation = validateSchedule(problem, {
    ...solution,
    locks: lockedMeetings,
  });
  const deferred = new Set(deferredRuleIds);
  const immutableViolations = policyValidation.hard_violations
    .filter(item => !deferred.has(item.rule_id));
  if (immutableViolations.length) return null;
  const reviewItems = policyValidation.hard_violations
    .filter(item => deferred.has(item.rule_id));
  return {
    validation,
    policyValidation,
    reviewItems,
    score: reviewItems.length * 1_000_000 + validation.soft_score,
  };
}

/**
 * Phase 1 constructs the first complete timetable.  Phase 2 keeps that
 * validated timetable as a fallback while it reopens dependency-closed grade
 * neighborhoods.  A failed or worse repair is discarded.
 */
export async function solveConstructiveLnsSchedule(problem, options = {}) {
  const startedAt = performance.now();
  const maxTimeSeconds = Math.max(1, Number(options.maxTimeSeconds || 120));
  const deadline = startedAt + maxTimeSeconds * 1_000;
  const initialShare = Math.min(0.9, Math.max(0.1, Number(options.initialShare || 0.45)));
  const initialBudget = Math.max(1, maxTimeSeconds * initialShare);
  const lockedMeetings = options.lockedMeetings || [];
  const progress = typeof options.onProgress === 'function' ? options.onProgress : () => {};

  progress({ stage: 'constructive-initial', time_limit_seconds: initialBudget });
  const initial = await solveFeasibleFirstSchedule(problem, {
    maxTimeSeconds: initialBudget,
    candidateCount: Math.max(1, Number(options.candidateCount || 1)),
    constructiveFirst: true,
    randomSeed: options.randomSeed,
    freezeMembership: options.freezeMembership === true,
    lockedMeetings,
    hintMeetings: options.hintMeetings || [],
    hintSections: options.hintSections || [],
    numSearchWorkers: options.numSearchWorkers || 4,
    deferredRuleIds: options.deferredRuleIds,
    deferredRuleTypes: options.deferredRuleTypes,
    deferredRuleWeight: options.deferredRuleWeight,
  });
  const initialDurationMs = Math.round(performance.now() - startedAt);
  if (!initial.ok) return {
    ...initial,
    algorithm: 'constructive-grade-lns',
    initial_status: initial.status,
    initial_solver_status: initial.attempts?.[0]?.status || initial.status,
    initial_duration_ms: initialDurationMs,
    lns_iterations: [],
    solve_duration_ms: Math.round(performance.now() - startedAt),
  };

  const deferredRuleIds = initial.deferred_rule_ids || [];
  const effectiveProblem = initial.effective_rules
    ? { ...problem, rules: initial.effective_rules }
    : problem;
  const initialQuality = qualityFor(
    problem,
    effectiveProblem,
    initial,
    lockedMeetings,
    deferredRuleIds,
  );
  if (!initialQuality) throw new Error('构造初稿未通过独立硬约束校验');

  let best = { solution: initial, quality: initialQuality };
  const iterations = [];
  const neighborhoods = buildGradeNeighborhoods(effectiveProblem)
    .filter(neighborhood => neighborhood.section_ids.length > 0)
    .sort((left, right) => left.section_ids.length - right.section_ids.length
      || left.id.localeCompare(right.id));

  for (let index = 0; index < neighborhoods.length && performance.now() < deadline; index += 1) {
    const neighborhood = neighborhoods[index];
    const remainingSeconds = Math.max(0.1, (deadline - performance.now()) / 1_000);
    const remainingPasses = neighborhoods.length - index;
    const passBudget = Math.max(0.1, Math.min(
      Number(options.iterationTimeSeconds || 20),
      remainingSeconds / remainingPasses,
    ));
    const unlocked = new Set(neighborhood.section_ids);
    const neighborhoodLocks = best.solution.meetings
      .filter(meeting => !unlocked.has(meeting.section_id))
      .map(meeting => ({ ...meeting, origin: 'lns-frozen' }));
    const iterationProblem = {
      ...effectiveProblem,
      sections: best.solution.sections.map(section => ({
        ...section,
        student_ids: [...(section.student_ids || [])],
      })),
    };
    progress({
      stage: 'lns-neighborhood',
      iteration: index + 1,
      neighborhood_id: neighborhood.id,
      open_section_count: unlocked.size,
      frozen_meeting_count: neighborhoodLocks.length,
      time_limit_seconds: passBudget,
    });
    const candidate = await solveSchedule(iterationProblem, {
      maxTimeSeconds: passBudget,
      optimizeSoft: true,
      freezeMembership: true,
      lockedMeetings: mergeLocks(lockedMeetings, neighborhoodLocks),
      useConstructiveSeed: false,
      hintMeetings: best.solution.meetings,
      hintSections: best.solution.sections,
      // Hints still guide the search, but the release-candidate native
      // HINT_SEARCH path can abort the process.  Normal search is stable and
      // the process boundary remains a second line of defence.
      repairHints: false,
      randomSeed: Number(options.randomSeed || 20260803) + index + 1,
      numSearchWorkers: options.numSearchWorkers || 4,
    });
    const quality = candidate.ok
      ? qualityFor(problem, effectiveProblem, candidate, lockedMeetings, deferredRuleIds)
      : null;
    const accepted = Boolean(quality && quality.score < best.quality.score);
    iterations.push({
      neighborhood_id: neighborhood.id,
      open_section_count: unlocked.size,
      status: candidate.status,
      accepted,
      quality_before: best.quality.score,
      quality_after: quality?.score ?? null,
      time_limit_seconds: passBudget,
    });
    if (accepted) best = { solution: candidate, quality };
    progress({
      stage: 'lns-neighborhood-complete',
      iteration: index + 1,
      neighborhood_id: neighborhood.id,
      status: candidate.status,
      accepted,
      quality_score: best.quality.score,
    });
  }

  return {
    ...best.solution,
    ok: true,
    status: best.quality.reviewItems.length
      ? 'CONSTRUCTIVE_LNS_REVIEW'
      : 'CONSTRUCTIVE_LNS_FEASIBLE',
    algorithm: 'constructive-grade-lns',
    effective_rules: effectiveProblem.rules,
    deferred_rule_ids: deferredRuleIds,
    review_required: best.quality.reviewItems.length > 0,
    review_items: best.quality.reviewItems,
    validation: best.quality.validation,
    policy_validation: best.quality.policyValidation,
    initial_status: initial.status,
    initial_solver_status: initial.attempts?.[0]?.status || initial.status,
    initial_duration_ms: initialDurationMs,
    initial_quality_score: initialQuality.score,
    quality_score: best.quality.score,
    lns_iterations: iterations,
    candidate_count: 1 + iterations.filter(item => item.quality_after !== null).length,
    solve_duration_ms: Math.round(performance.now() - startedAt),
  };
}
