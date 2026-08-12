export const AP_STUDENT_GAP_RULE_ID = 'ap_block_students_compact_daily_schedule';
const QUALITY_REVIEW_CODES = new Set([
  'AP_STUDENT_GAP_DAYS_EXCEEDED',
  'AP_MORNING_EMPTY_STUDENT_PERIODS_EXCEEDED',
  'AP_MORNING_EMPTY_METRIC_UNAVAILABLE',
]);

function nonNegativeInteger(value, fallback, name) {
  const parsed = value === undefined ? fallback : Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`${name} 必须是非负整数`);
  }
  return parsed;
}

export function evaluateScheduleQuality(validation, options = {}) {
  const maxApStudentGapDays = nonNegativeInteger(
    options.maxApStudentGapDays,
    0,
    'maxApStudentGapDays',
  );
  const maxApMorningEmptyStudentPeriods = nonNegativeInteger(
    options.maxApMorningEmptyStudentPeriods,
    0,
    'maxApMorningEmptyStudentPeriods',
  );
  const apGapViolations = (validation.soft_violations || [])
    .filter(item => item.rule_id === AP_STUDENT_GAP_RULE_ID);
  const apStudentGapDays = apGapViolations.length;
  const apFirstPeriodGapDays = apGapViolations
    .filter(item => (item.missing_periods || []).includes(1))
    .length;
  const issues = [];
  if (apStudentGapDays > maxApStudentGapDays) {
    issues.push({
      code: 'AP_STUDENT_GAP_DAYS_EXCEEDED',
      message: `AP 学生空堂为 ${apStudentGapDays} 个学生日，超过发布上限 ${maxApStudentGapDays}`,
      actual: apStudentGapDays,
      maximum: maxApStudentGapDays,
      rule_id: AP_STUDENT_GAP_RULE_ID,
    });
  }
  const metrics = {
    soft_score: Number(validation.soft_score || 0),
    ap_student_gap_days: apStudentGapDays,
    ap_first_period_gap_days: apFirstPeriodGapDays,
  };
  if (options.apBlockAfternoonOccurrences !== undefined) {
    metrics.ap_block_afternoon_occurrences = nonNegativeInteger(
      options.apBlockAfternoonOccurrences,
      0,
      'apBlockAfternoonOccurrences',
    );
  }
  if (options.apBlockFirstPeriodDeviation !== undefined) {
    metrics.ap_block_first_period_deviation = nonNegativeInteger(
      options.apBlockFirstPeriodDeviation,
      0,
      'apBlockFirstPeriodDeviation',
    );
    metrics.ap_block_first_period_actual_count = nonNegativeInteger(
      options.apBlockFirstPeriodActualCount,
      0,
      'apBlockFirstPeriodActualCount',
    );
    metrics.ap_block_first_period_target_count = nonNegativeInteger(
      options.apBlockFirstPeriodTargetCount,
      0,
      'apBlockFirstPeriodTargetCount',
    );
  }
  if (options.apMorningEmptyStudentPeriods !== undefined) {
    metrics.ap_morning_empty_student_periods = nonNegativeInteger(
      options.apMorningEmptyStudentPeriods,
      0,
      'apMorningEmptyStudentPeriods',
    );
    if (metrics.ap_morning_empty_student_periods > maxApMorningEmptyStudentPeriods) {
      issues.push({
        code: 'AP_MORNING_EMPTY_STUDENT_PERIODS_EXCEEDED',
        message: `AP 学生上午空节为 ${metrics.ap_morning_empty_student_periods} 个学生节次，超过发布上限 ${maxApMorningEmptyStudentPeriods}`,
        actual: metrics.ap_morning_empty_student_periods,
        maximum: maxApMorningEmptyStudentPeriods,
      });
    }
  } else {
    issues.push({
      code: 'AP_MORNING_EMPTY_METRIC_UNAVAILABLE',
      message: 'AP 学生上午空节指标缺失，需用新版算法重新排课',
    });
  }
  const limits = {
    max_ap_morning_empty_student_periods: maxApMorningEmptyStudentPeriods,
    max_ap_student_gap_days: maxApStudentGapDays,
  };
  return {
    passed: issues.length === 0,
    metrics,
    limits,
    issues,
  };
}

export function publicationStatusForSchedule({
  qualityPassed,
  policyRelaxed = false,
} = {}) {
  return qualityPassed === true && policyRelaxed !== true
    ? 'ready'
    : 'review_required';
}

export function withScheduleQualityStatus(schedule, validation, options = {}) {
  const maxApStudentGapDays = options.maxApStudentGapDays
    ?? schedule.quality_gate?.limits?.max_ap_student_gap_days;
  const maxApMorningEmptyStudentPeriods = options.maxApMorningEmptyStudentPeriods
    ?? schedule.quality_gate?.limits?.max_ap_morning_empty_student_periods;
  const qualityGate = evaluateScheduleQuality(validation, {
    maxApStudentGapDays,
    maxApMorningEmptyStudentPeriods,
    apBlockAfternoonOccurrences: schedule.ap_block_afternoon_occurrences,
    apBlockFirstPeriodDeviation: schedule.ap_block_first_period_deviation,
    apBlockFirstPeriodActualCount: schedule.ap_block_first_period_actual_count,
    apBlockFirstPeriodTargetCount: schedule.ap_block_first_period_target_count,
    apMorningEmptyStudentPeriods: schedule.morning_empty_student_periods,
  });
  const policyRelaxed = schedule.policy_relaxed === true
    || (schedule.deferred_rule_ids || []).length > 0;
  const publicationStatus = publicationStatusForSchedule({
    qualityPassed: qualityGate.passed,
    policyRelaxed,
  });
  const retainedReviewItems = (schedule.review_items || [])
    .filter(item => !QUALITY_REVIEW_CODES.has(item.code));
  return {
    ...schedule,
    validation,
    quality_gate: qualityGate,
    publication_status: publicationStatus,
    policy_relaxed: policyRelaxed,
    review_required: publicationStatus === 'review_required',
    review_items: [...retainedReviewItems, ...qualityGate.issues],
  };
}
