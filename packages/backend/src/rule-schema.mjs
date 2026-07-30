const scopes = new Set(['teacher', 'room', 'course', 'class', 'section', 'student', 'global']);
const slotPattern = /^D[1-9]\d*P[1-9]\d*$/;

export const RULE_TYPES = new Set([
  'fixed_slots',
  'forbid_slots',
  'preferred_slots',
  'max_occurrences_per_day',
  'max_consecutive_lessons',
  'max_consecutive_days_in_period',
  'synchronized_slots',
  'separate_class_types',
  'priority',
]);

function slots(value, rule, field) {
  if (!Array.isArray(value) || !value.length || !value.every(slot => typeof slot === 'string' && slotPattern.test(slot))) {
    throw new Error(`规则 ${rule.id} 的 params.${field} 必须是非空时段数组`);
  }
}

function positiveInteger(value, rule, field) {
  if (!Number.isInteger(value) || value < 1) throw new Error(`规则 ${rule.id} 的 params.${field} 必须是正整数`);
}

function validateTypeParameters(rule) {
  const params = rule.params || {};
  switch (rule.type) {
    case 'fixed_slots':
      slots(params.slots, rule, 'slots');
      if (params.mode !== undefined && !['contains', 'exact'].includes(params.mode)) {
        throw new Error(`规则 ${rule.id} 的 params.mode 只能为 contains 或 exact`);
      }
      break;
    case 'forbid_slots':
    case 'preferred_slots':
      slots(params.slots, rule, 'slots');
      break;
    case 'max_occurrences_per_day':
    case 'max_consecutive_lessons':
      positiveInteger(params.max, rule, 'max');
      break;
    case 'max_consecutive_days_in_period':
      positiveInteger(params.max, rule, 'max');
      positiveInteger(params.period, rule, 'period');
      break;
    case 'synchronized_slots':
      if (rule.scope !== 'section') throw new Error(`规则 ${rule.id} 的 synchronized_slots 只能作用于 section`);
      if (!rule.hard) throw new Error(`规则 ${rule.id} 的 synchronized_slots 必须是硬约束`);
      break;
    case 'separate_class_types':
      if (rule.scope !== 'global') throw new Error(`规则 ${rule.id} 的 separate_class_types 只能作用于 global`);
      if (!rule.hard) throw new Error(`规则 ${rule.id} 的 separate_class_types 必须是硬约束`);
      for (const field of ['left_class_types', 'right_class_types']) {
        if (!Array.isArray(params[field]) || !params[field].length || !params[field].every(value => typeof value === 'string')) {
          throw new Error(`规则 ${rule.id} 的 params.${field} 必须是非空 class_type 数组`);
        }
      }
      if (params.grades !== undefined && (!Array.isArray(params.grades) || !params.grades.length || !params.grades.every(Number.isInteger))) {
        throw new Error(`规则 ${rule.id} 的 params.grades 必须是非空年级数组`);
      }
      break;
    case 'priority':
      if (!Number.isFinite(params.rank)) throw new Error(`规则 ${rule.id} 的 params.rank 必须是数字`);
      break;
    default:
      throw new Error(`不支持的规则类型: ${rule.type}`);
  }
}

/**
 * Validates the canonical rules-first format.  Legacy rules.json is not
 * silently accepted here: importing it must translate each rule explicitly,
 * so no prose condition accidentally becomes a hard constraint.
 */
export function validateRules(rules) {
  if (!Array.isArray(rules)) throw new Error('rules 必须是数组');
  const ids = new Set();
  for (const rule of rules) {
    if (!rule || typeof rule !== 'object') throw new Error('每条规则必须是对象');
    if (typeof rule.id !== 'string' || !rule.id.trim()) throw new Error('规则必须有 id');
    if (ids.has(rule.id)) throw new Error(`规则 id 重复: ${rule.id}`);
    ids.add(rule.id);
    if (typeof rule.type !== 'string' || !RULE_TYPES.has(rule.type)) {
      throw new Error(`规则 ${rule.id} 的 type 非法`);
    }
    if (!scopes.has(rule.scope || 'global')) throw new Error(`规则 ${rule.id} 的 scope 非法`);
    if (typeof rule.hard !== 'boolean') throw new Error(`规则 ${rule.id} 必须明确 hard=true/false`);
    if (!rule.hard && (!(Number.isFinite(rule.weight)) || rule.weight <= 0)) {
      throw new Error(`软规则 ${rule.id} 必须有正 weight`);
    }
    if (rule.requires_approval_to_relax !== undefined && typeof rule.requires_approval_to_relax !== 'boolean') {
      throw new Error(`规则 ${rule.id} 的 requires_approval_to_relax 必须是布尔值`);
    }
    if (rule.hard && rule.requires_approval_to_relax) {
      throw new Error(`规则 ${rule.id} 已是硬约束，不需要 requires_approval_to_relax`);
    }
    if (rule.params !== undefined && (typeof rule.params !== 'object' || Array.isArray(rule.params) || rule.params === null)) {
      throw new Error(`规则 ${rule.id} 的 params 必须是对象`);
    }
    if (rule.target_id !== undefined && (typeof rule.target_id !== 'string' || !rule.target_id)) {
      throw new Error(`规则 ${rule.id} 的 target_id 必须是非空字符串`);
    }
    validateTypeParameters(rule);
  }
  return rules;
}
