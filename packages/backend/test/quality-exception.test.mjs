import assert from 'node:assert/strict';
import test from 'node:test';

import {
  QUALITY_EXCEPTION_CONFIRMATION,
  approveScheduleQualityException,
} from '../src/quality-exception.mjs';

function reviewSchedule(overrides = {}) {
  return {
    version: 7,
    validation: { ok: true, hard_violations: [] },
    publication_status: 'review_required',
    policy_relaxed: false,
    quality_gate: {
      passed: false,
      metrics: { ap_student_gap_days: 94, ap_morning_empty_student_periods: 59 },
      limits: { max_ap_student_gap_days: 0, max_ap_morning_empty_student_periods: 0 },
      issues: [{ code: 'AP_STUDENT_GAP_DAYS_EXCEEDED', actual: 94, maximum: 0 }],
    },
    ...overrides,
  };
}

test('turns an explicit administrator quality exception into an auditable publication state', () => {
  const approved = approveScheduleQualityException(reviewSchedule(), {
    confirmation: QUALITY_EXCEPTION_CONFIRMATION,
    reason: '本学期 Block 与必修课结构暂时无法调整，教务会议同意采用当前最优课表。',
    approved_by: '教务管理员',
  }, { now: '2026-08-12T10:00:00.000Z' });

  assert.equal(approved.publication_status, 'ready_with_quality_exception');
  assert.equal(approved.review_required, false);
  assert.deepEqual(approved.quality_exception_approval.metrics, {
    ap_student_gap_days: 94,
    ap_morning_empty_student_periods: 59,
  });
  assert.equal(approved.quality_exception_approval.schedule_version, 7);
  assert.equal(approved.quality_exception_approval.approved_by, '教务管理员');
});

test('never lets a quality exception approve a schedule with relaxed hard policy rules', () => {
  assert.throws(() => approveScheduleQualityException(reviewSchedule({ policy_relaxed: true }), {
    confirmation: QUALITY_EXCEPTION_CONFIRMATION,
    reason: '这段原因足够长但硬规则仍然不能通过质量例外放宽。',
    approved_by: '教务管理员',
  }), /硬规则/);
});
