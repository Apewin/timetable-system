/**
 * A protected soft rule behaves as a hard rule until an administrator gives
 * an explicit, per-solve approval to relax it.  This keeps "soft" from
 * meaning "the solver may silently ignore it".
 */
export function approvalGatedRules(problem, approvedRuleIds = []) {
  const approved = new Set(approvedRuleIds);
  return (problem.rules || []).filter(rule =>
    !rule.hard && rule.requires_approval_to_relax === true && !approved.has(rule.id));
}

export function enforceApprovalGates(problem, approvedRuleIds = []) {
  const protectedIds = new Set(approvalGatedRules(problem, approvedRuleIds).map(rule => rule.id));
  if (!protectedIds.size) return problem;
  return {
    ...problem,
    rules: problem.rules.map(rule => protectedIds.has(rule.id)
      ? { ...rule, hard: true, weight: 0 }
      : rule),
  };
}

/** Removes only explicitly approved protected rules from this solve model.
 * The original problem is retained by the caller for post-solve validation
 * and the approval audit trail, so the exception remains visible. */
export function relaxApprovedRules(problem, approvedRuleIds = []) {
  const approved = new Set(approvedRuleIds);
  return {
    ...problem,
    rules: (problem.rules || []).filter(rule =>
      !(rule.requires_approval_to_relax === true && approved.has(rule.id))),
  };
}
