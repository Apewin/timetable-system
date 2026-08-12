import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeSchedulingPolicy, schedulingPolicyForState } from '../src/scheduling-policy.mjs';

test('provides explicit defaults for Block preferences and publication quality', () => {
  const policy = schedulingPolicyForState({});
  assert.deepEqual(policy.ap_block.preferred_periods, [1, 2, 3, 4, 5, 6]);
  assert.equal(policy.ap_block.first_period_target, 1);
  assert.equal(policy.quality_limits.max_ap_student_gap_days, 0);
  assert.equal(policy.quality_limits.max_ap_morning_empty_student_periods, 0);
});

test('normalizes administrator overrides without dropping unspecified defaults', () => {
  const policy = normalizeSchedulingPolicy({
    ap_block: { preferred_periods: [2, 3, 4], preferred_band_weight: 3000 },
  });
  assert.deepEqual(policy.ap_block.preferred_periods, [2, 3, 4]);
  assert.equal(policy.ap_block.preferred_band_weight, 3000);
  assert.equal(policy.ap_block.student_compactness_weight, 1000);
});

test('rejects invalid policy periods and negative quality limits', () => {
  assert.throws(() => normalizeSchedulingPolicy({ ap_block: { preferred_periods: [0, 11] } }), /1–10/);
  assert.throws(() => normalizeSchedulingPolicy({
    quality_limits: { max_ap_student_gap_days: -1 },
  }), /非负整数/);
});
