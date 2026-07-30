/**
 * Declarative policy layer shared by all timetable solvers.
 *
 * A policy never names a particular course or teacher in solver code.  The
 * UI/importer writes the selector and the hard/soft level into state.constraints;
 * this module resolves it against the current data set before CP-SAT variables
 * are created.  New policy types can therefore be added without changing the
 * course-section algorithm.
 */

function policyLevel(policy) {
  return policy.hard === true || policy.type === 'hard' || policy.isCompel === true ? 'hard' : 'soft';
}

function normalizePolicies(state, legacy = {}) {
  const declared = state.constraints || [];
  const imported = (legacy.rules || []).map(rule => ({
    id: rule.id,
    kind: rule.kind || rule.check || rule.condition || 'legacy',
    scope: rule.scope || rule.category || 'global',
    target: rule.target_id,
    params: rule.params || rule,
    hard: rule.type === 'hard' || rule.isCompel === true,
    weight: rule.penalty || 1,
  }));
  return [...declared, ...imported].map(policy => ({
    id: policy.id,
    kind: policy.kind || policy.type,
    scope: policy.scope || 'global',
    target: policy.target_id,
    params: policy.params || {},
    level: policyLevel(policy),
    weight: policy.weight || 1,
  }));
}

function matches(policy, entity) {
  const selector = policy.params?.selector || {};
  if (policy.target && policy.target !== entity.id) return false;
  return (!selector.teacher_ids || selector.teacher_ids.includes(entity.teacher_id))
    && (!selector.course_ids || selector.course_ids.includes(entity.course_id))
    && (!selector.class_types || selector.class_types.includes(entity.class_type));
}

module.exports = { normalizePolicies, matches };
