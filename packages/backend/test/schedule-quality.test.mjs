import assert from 'node:assert/strict';
import test from 'node:test';
import {
  evaluateScheduleQuality,
  publicationStatusForSchedule,
  withScheduleQualityStatus,
} from '../src/schedule-quality.mjs';

test('treats afternoon-only AP gaps as diagnostic when mornings are full', () => {
  const quality = evaluateScheduleQuality({
    soft_score: 1000,
    soft_violations: [{
      rule_id: 'ap_block_students_compact_daily_schedule',
      target_id: 'S1',
      day: 1,
      missing_periods: [6],
    }],
  }, { maxApStudentGapDays: 1, apMorningEmptyStudentPeriods: 0 });

  assert.equal(quality.passed, true);
  assert.deepEqual(quality.issues, []);
});

test('requires review when AP morning empty student-periods exceed the default limit', () => {
  const quality = evaluateScheduleQuality({
    soft_score: 2000,
    soft_violations: [
      { rule_id: 'ap_block_students_compact_daily_schedule', target_id: 'S1', day: 1, missing_periods: [1, 2] },
      { rule_id: 'ap_block_students_compact_daily_schedule', target_id: 'S2', day: 3, missing_periods: [2] },
      { rule_id: 'another-preference', target_id: 'SEC1' },
    ],
  }, { apMorningEmptyStudentPeriods: 2 });

  assert.deepEqual(quality.metrics, {
    soft_score: 2000,
    ap_student_gap_days: 2,
    ap_first_period_gap_days: 1,
    ap_morning_empty_student_periods: 2,
  });
  assert.deepEqual(quality.limits, {
    max_ap_morning_empty_student_periods: 0,
    max_ap_student_gap_days: 0,
  });
  assert.equal(quality.passed, false);
  assert.ok(quality.issues.some(item => item.code === 'AP_MORNING_EMPTY_STUDENT_PERIODS_EXCEEDED'));
  assert.ok(quality.issues.some(item => item.code === 'AP_STUDENT_GAP_DAYS_EXCEEDED'));
});

test('accepts an explicitly configured AP student-gap quality limit', () => {
  const quality = evaluateScheduleQuality({
    soft_score: 2000,
    soft_violations: [
      { rule_id: 'ap_block_students_compact_daily_schedule', target_id: 'S1', day: 1 },
      { rule_id: 'ap_block_students_compact_daily_schedule', target_id: 'S2', day: 3 },
    ],
  }, { maxApStudentGapDays: 2, apMorningEmptyStudentPeriods: 0 });

  assert.equal(quality.passed, true);
  assert.deepEqual(quality.limits, {
    max_ap_morning_empty_student_periods: 0,
    max_ap_student_gap_days: 2,
  });
  assert.deepEqual(quality.issues, []);
});

test('reports the solver-measured AP morning empty student-periods', () => {
  const quality = evaluateScheduleQuality({
    soft_score: 0,
    soft_violations: [],
  }, {
    apBlockAfternoonOccurrences: 1,
    apMorningEmptyStudentPeriods: 12,
  });

  assert.equal(quality.metrics.ap_block_afternoon_occurrences, 1);
  assert.equal(quality.metrics.ap_morning_empty_student_periods, 12);
  assert.equal(quality.passed, false);
  assert.equal(quality.issues[0].code, 'AP_MORNING_EMPTY_STUDENT_PERIODS_EXCEEDED');
});

test('publishes only quality-passing schedules that used no hard-rule relaxation', () => {
  assert.equal(publicationStatusForSchedule({ qualityPassed: true }), 'ready');
  assert.equal(publicationStatusForSchedule({ qualityPassed: false }), 'review_required');
  assert.equal(publicationStatusForSchedule({
    qualityPassed: true,
    policyRelaxed: true,
  }), 'review_required');
});

test('refreshes stored quality status after a timetable edit without losing policy review items', () => {
  const schedule = withScheduleQualityStatus({
    deferred_rule_ids: ['student-prefix'],
    morning_empty_student_periods: 2,
    review_items: [
      { rule_id: 'student-prefix', message: '已批准降级' },
      { code: 'AP_MORNING_EMPTY_STUDENT_PERIODS_EXCEEDED', message: '旧质量结果' },
    ],
    quality_gate: { limits: { max_ap_morning_empty_student_periods: 1 } },
  }, {
    soft_score: 1000,
    soft_violations: [
      { rule_id: 'ap_block_students_compact_daily_schedule', target_id: 'S1', day: 1 },
      { rule_id: 'ap_block_students_compact_daily_schedule', target_id: 'S2', day: 1 },
    ],
  });

  assert.equal(schedule.policy_relaxed, true);
  assert.equal(schedule.publication_status, 'review_required');
  assert.equal(schedule.review_required, true);
  assert.equal(schedule.review_items.filter(item =>
    item.code === 'AP_MORNING_EMPTY_STUDENT_PERIODS_EXCEEDED').length, 1);
  assert.equal(schedule.review_items.some(item => item.rule_id === 'student-prefix'), true);
});
