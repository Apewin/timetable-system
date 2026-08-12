import assert from 'node:assert/strict';
import test from 'node:test';

import {
  mergeMetricEvidence,
  solveScheduleQualityLowerBounds,
} from '../src/quality-lower-bound.mjs';

test('never reports a worse best-known value than the validated current timetable', () => {
  assert.deepEqual(mergeMetricEvidence({
    best_known: 110,
    lower_bound: null,
    proven: false,
    status: 'FEASIBLE',
  }, 94), {
    baseline_value: 94,
    search_best_known: 110,
    best_known: 94,
    best_source: 'current_schedule',
    improved_by: 0,
    lower_bound: null,
    proven: false,
    status: 'FEASIBLE',
  });
});

test('keeps the current timetable when the timed analysis finds no candidate', () => {
  const merged = mergeMetricEvidence({
    best_known: null,
    lower_bound: null,
    proven: false,
    status: 'UNKNOWN',
  }, 94);

  assert.equal(merged.search_best_known, null);
  assert.equal(merged.best_known, 94);
  assert.equal(merged.best_source, 'current_schedule');
});

test('proves separate lower bounds for AP gap-days and morning empty student-periods', async () => {
  const problem = {
    slots: [
      { id: 'D1P1', day: 1, period: 1 },
      { id: 'D1P2', day: 1, period: 2 },
      { id: 'D1P3', day: 1, period: 3 },
    ],
    rooms: [],
    rules: [
      {
        id: 'LOCK_A', type: 'fixed_slots', hard: true, scope: 'section',
        target_ids: ['A'], section_target_ids: ['A'], params: { slots: ['D1P1'], mode: 'exact' },
      },
      {
        id: 'LOCK_B', type: 'fixed_slots', hard: true, scope: 'section',
        target_ids: ['B'], section_target_ids: ['B'], params: { slots: ['D1P3'], mode: 'exact' },
      },
      {
        id: 'ap_block_students_compact_daily_schedule', type: 'no_internal_gaps',
        hard: false, weight: 1000, scope: 'student', target_ids: ['S1'],
        params: { preferred_morning_periods: 3 },
      },
    ],
    sections: [
      {
        id: 'A', course_id: 'A', teacher_id: 'TA', class_type: 'ap', weekly_hours: 1,
        student_ids: ['S1'], eligible_student_ids: [], grades: [11],
      },
      {
        id: 'B', course_id: 'B', teacher_id: 'TB', class_type: 'ap', weekly_hours: 1,
        student_ids: ['S1'], eligible_student_ids: [], grades: [11],
      },
    ],
  };

  const result = await solveScheduleQualityLowerBounds(problem, {
    maxTimeSeconds: 5,
    numSearchWorkers: 1,
    baselineSchedule: {
      sections: problem.sections,
      meetings: [
        { section_id: 'A', slot_id: 'D1P1', room_id: null },
        { section_id: 'B', slot_id: 'D1P3', room_id: null },
      ],
    },
  });

  assert.deepEqual(result.ap_student_gap_days, {
    best_known: 1,
    baseline_value: 1,
    search_best_known: 1,
    best_source: 'current_schedule',
    improved_by: 0,
    lower_bound: 1,
    proven: true,
    status: 'OPTIMAL',
  });
  assert.deepEqual(result.ap_morning_empty_student_periods, {
    best_known: 1,
    baseline_value: 1,
    search_best_known: 1,
    best_source: 'current_schedule',
    improved_by: 0,
    lower_bound: 1,
    proven: true,
    status: 'OPTIMAL',
  });
  assert.deepEqual(result.analysis_scope, {
    membership: 'frozen_current_sections',
    membership_frozen: true,
    locks: 'preserved',
    hard_constraints: 'unchanged',
    soft_objectives: 'target_metric_only',
    directly_comparable_to_default_solver: false,
    note: '本分析冻结当前 Section 分班并一次只优化一个质量指标；普通一键排课允许重新分班且使用完整词典序目标，结果不能直接等同比较。',
  });
  assert.deepEqual(result.budget, {
    total_seconds: 5,
    first_metric_planned_seconds: 2.5,
    proof_guaranteed: false,
    note: '即使增加分析时间，也可能只能得到最好已知值，不能保证证明数学最优。',
  });
  assert.equal(
    result.interpretation,
    '两个指标均已在其他软偏好关闭的情况下证明最优，可视为当前硬约束与分班结构下的独立数学下界。',
  );
});
