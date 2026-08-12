const SUPPORTED_SOLVERS = new Set([
  'resilient-optimize',
  'constructive-lns',
  'feasible-first',
  'exact',
]);

function boundedSeconds(body) {
  const requested = Number(body.max_time_seconds
    ?? (body.timeout ? Number(body.timeout) / 1_000 : 120));
  return Math.min(600, Math.max(5, Number.isFinite(requested) ? requested : 120));
}

function boundedCandidateCount(body, strategy) {
  const requested = Number(body.candidate_count ?? 1);
  const normalized = Number.isFinite(requested)
    ? Math.min(5, Math.max(1, Math.floor(requested)))
    : 1;
  return (strategy?.priority_section_ids || []).length ? Math.max(2, normalized) : normalized;
}

/**
 * Converts an HTTP scheduling request into the small, serializable Interface
 * understood by the isolated solver process.
 */
export function createSolverJob(problem, body = {}, context = {}) {
  const feasibleFirst = body.feasible_first !== false;
  const requestedSolver = String(body.solver_strategy || '').replaceAll('_', '-');
  const solver = requestedSolver || (feasibleFirst ? 'resilient-optimize' : 'exact');
  if (!SUPPORTED_SOLVERS.has(solver)) {
    throw new Error(`不支持的求解策略: ${body.solver_strategy}`);
  }
  const maxTimeSeconds = boundedSeconds(body);
  const priorHint = context.priorHint || { meetings: [], sections: [] };
  const common = {
    maxTimeSeconds,
    randomSeed: Number.isInteger(body.random_seed) ? body.random_seed : 20260803,
    freezeMembership: body.lock_section_rosters === true,
    lockedMeetings: context.lockedMeetings || [],
    hintMeetings: priorHint.meetings || [],
    hintSections: priorHint.sections || [],
    numSearchWorkers: Math.min(8, Math.max(1, Number(body.num_search_workers || 4))),
  };
  const options = solver === 'exact'
    ? { ...common, optimizeSoft: body.optimize_soft !== false, repairHints: false }
    : {
      ...common,
      candidateCount: boundedCandidateCount(body, context.strategy),
      deferredRuleIds: context.approvedHardRuleIds || [],
    };
  return { solver, problem, options };
}
