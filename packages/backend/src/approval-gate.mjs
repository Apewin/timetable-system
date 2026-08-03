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
      ? { ...rule, hard: true, weight: 0, requires_approval_to_relax: false }
      : rule),
  };
}

/** Turns an explicitly approved protected rule back into an ordinary soft
 * preference.  Approval permits a violation; it does not tell the optimizer
 * to stop trying to satisfy the rule.  The original problem is retained by
 * the caller for post-solve validation and the approval audit trail. */
export function relaxApprovedRules(problem, approvedRuleIds = []) {
  const approved = new Set(approvedRuleIds);
  return {
    ...problem,
    rules: (problem.rules || []).map(rule =>
      rule.requires_approval_to_relax === true && approved.has(rule.id)
        ? { ...rule, requires_approval_to_relax: false }
        : rule),
  };
}
