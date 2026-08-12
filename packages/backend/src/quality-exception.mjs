export const QUALITY_EXCEPTION_CONFIRMATION = '确认质量例外';

export function qualityExceptionReview(schedule) {
  const gate = schedule?.quality_gate;
  const hardValid = schedule?.validation?.ok === true
    && !(schedule.validation?.hard_violations || []).length;
  const policyRelaxed = schedule?.policy_relaxed === true
    || (schedule?.deferred_rule_ids || []).length > 0;
  return {
    required: Boolean(gate && gate.passed === false),
    allowed: Boolean(gate && gate.passed === false && hardValid && !policyRelaxed),
    confirmation_phrase: QUALITY_EXCEPTION_CONFIRMATION,
    requires_reason: true,
    blocked_reason: !hardValid
      ? '当前课表没有通过硬约束校验'
      : policyRelaxed
        ? '当前课表使用了经审批降级的硬规则，质量例外不能覆盖硬规则问题'
        : null,
    quality_gate: gate || null,
    lower_bound_analysis: schedule?.quality_lower_bound_analysis || null,
  };
}

export function approveScheduleQualityException(schedule, request = {}, {
  now = new Date().toISOString(),
} = {}) {
  const review = qualityExceptionReview(schedule);
  if (!review.required) throw new Error('当前课表不需要质量例外审批');
  if (!review.allowed) throw new Error(review.blocked_reason || '当前课表不允许质量例外审批');
  if (request.confirmation !== QUALITY_EXCEPTION_CONFIRMATION) {
    throw new Error(`请输入“${QUALITY_EXCEPTION_CONFIRMATION}”完成管理员确认`);
  }
  const reason = String(request.reason || '').trim();
  if (reason.length < 10) throw new Error('质量例外原因至少需要 10 个字符');
  const approvedBy = String(request.approved_by || '').trim();
  if (!approvedBy) throw new Error('质量例外必须记录审批人');
  return {
    ...schedule,
    publication_status: 'ready_with_quality_exception',
    review_required: false,
    quality_exception_approval: {
      approved_at: now,
      approved_by: approvedBy,
      reason,
      confirmation_phrase: QUALITY_EXCEPTION_CONFIRMATION,
      schedule_version: schedule.version ?? null,
      metrics: structuredClone(schedule.quality_gate.metrics || {}),
      limits: structuredClone(schedule.quality_gate.limits || {}),
      issues: structuredClone(schedule.quality_gate.issues || []),
    },
  };
}
