import assert from 'node:assert/strict';
import test from 'node:test';

import { qualityMetricSummary } from '../quality-analysis-view.mjs';

test('explains when a timed search did not improve the current timetable', () => {
  assert.equal(qualityMetricSummary({
    baseline_value: 94,
    search_best_known: 110,
    best_known: 94,
    best_source: 'current_schedule',
    improved_by: 0,
    lower_bound: null,
    proven: false,
    status: 'FEASIBLE',
  }), '最好已知 94；当前课表 94；本次搜索 110，预算内没有改善；尚未证明数学最优（FEASIBLE）');
});

test('distinguishes a proven bound from a better unproven candidate', () => {
  assert.equal(qualityMetricSummary({
    baseline_value: 94,
    search_best_known: 84,
    best_known: 84,
    best_source: 'single_objective_search',
    improved_by: 10,
    lower_bound: 84,
    proven: true,
    status: 'OPTIMAL',
  }), '数学下界 84；当前课表 94；改善 10（10.6%）；已证明数学最优（OPTIMAL）');
});
