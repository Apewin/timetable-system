export const DEFAULT_SCHEDULING_POLICY = Object.freeze({
  ap_block: Object.freeze({
    preferred_periods: Object.freeze([1, 2, 3, 4, 5, 6]),
    first_period_target: 1,
    preferred_band_weight: 2_000,
    first_period_weight: 5_000,
    student_compactness_weight: 1_000,
    student_preferred_morning_periods: 5,
  }),
  quality_limits: Object.freeze({
    max_ap_student_gap_days: 0,
    max_ap_morning_empty_student_periods: 0,
  }),
});

function integer(value, name, { minimum = 0, maximum = Number.MAX_SAFE_INTEGER } = {}) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${name} 必须是 ${minimum}–${maximum} 范围内的整数`);
  }
  return parsed;
}

function nonNegative(value, name) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) throw new Error(`${name} 必须是非负整数`);
  return parsed;
}

export function normalizeSchedulingPolicy(raw = {}) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('排课策略必须是对象');
  const rawBlock = raw.ap_block || {};
  const rawLimits = raw.quality_limits || {};
  if (typeof rawBlock !== 'object' || Array.isArray(rawBlock)) throw new Error('AP Block 策略必须是对象');
  if (typeof rawLimits !== 'object' || Array.isArray(rawLimits)) throw new Error('课表发布门槛必须是对象');
  const periods = rawBlock.preferred_periods === undefined
    ? [...DEFAULT_SCHEDULING_POLICY.ap_block.preferred_periods]
    : rawBlock.preferred_periods;
  if (!Array.isArray(periods) || !periods.length
    || !periods.every(period => Number.isInteger(Number(period)) && Number(period) >= 1 && Number(period) <= 10)) {
    throw new Error('AP Block 优先节次必须是 1–10 的非空整数数组');
  }
  const preferredPeriods = [...new Set(periods.map(Number))].sort((left, right) => left - right);
  return {
    ap_block: {
      preferred_periods: preferredPeriods,
      first_period_target: integer(
        rawBlock.first_period_target ?? DEFAULT_SCHEDULING_POLICY.ap_block.first_period_target,
        'AP Block 每周第一节目标',
        { minimum: 1, maximum: 5 },
      ),
      preferred_band_weight: integer(
        rawBlock.preferred_band_weight ?? DEFAULT_SCHEDULING_POLICY.ap_block.preferred_band_weight,
        'AP Block 优先节次权重',
        { minimum: 1 },
      ),
      first_period_weight: integer(
        rawBlock.first_period_weight ?? DEFAULT_SCHEDULING_POLICY.ap_block.first_period_weight,
        'AP Block 第一节目标权重',
        { minimum: 1 },
      ),
      student_compactness_weight: integer(
        rawBlock.student_compactness_weight ?? DEFAULT_SCHEDULING_POLICY.ap_block.student_compactness_weight,
        'AP 学生连续性权重',
        { minimum: 1 },
      ),
      student_preferred_morning_periods: integer(
        rawBlock.student_preferred_morning_periods
          ?? DEFAULT_SCHEDULING_POLICY.ap_block.student_preferred_morning_periods,
        'AP 学生上午优先节数',
        { minimum: 1, maximum: 10 },
      ),
    },
    quality_limits: {
      max_ap_student_gap_days: nonNegative(
        rawLimits.max_ap_student_gap_days
          ?? DEFAULT_SCHEDULING_POLICY.quality_limits.max_ap_student_gap_days,
        'AP 学生空堂发布上限',
      ),
      max_ap_morning_empty_student_periods: nonNegative(
        rawLimits.max_ap_morning_empty_student_periods
          ?? DEFAULT_SCHEDULING_POLICY.quality_limits.max_ap_morning_empty_student_periods,
        'AP 上午空节发布上限',
      ),
    },
  };
}

export function schedulingPolicyForState(state) {
  return normalizeSchedulingPolicy(state.scheduling_policy || {});
}
