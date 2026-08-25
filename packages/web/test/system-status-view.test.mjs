import assert from 'node:assert/strict';
import test from 'node:test';

import { qualityAffectedStudents, systemStatusReview } from '../system-status-view.mjs';

test('turns a review-required status into an actionable staff-facing checklist', () => {
  const review = systemStatusReview({
    publication_status: 'review_required',
    review_required: true,
    review_items: [
      { code: 'AP_GAP', message: '高二 AP 学生存在 2 个全天空档' },
      { code: 'MORNING_EMPTY', message: '上午空节超过发布上限' },
    ],
  });

  assert.equal(review.label, '2 项待复核');
  assert.equal(review.tone, 'warning');
  assert.deepEqual(review.items, [
    '高二 AP 学生存在 2 个全天空档',
    '上午空节超过发布上限',
  ]);
  assert.match(review.guidance, /处理完再发布/);
  assert.equal(review.ordinary_publication_allowed, false);
  assert.equal(review.quality_exception_available, true);
});

test('describes a ready schedule without inventing review items', () => {
  const review = systemStatusReview({
    publication_status: 'ready',
    review_required: false,
    review_items: [],
  });

  assert.equal(review.label, '发布前检查已通过');
  assert.equal(review.tone, 'success');
  assert.deepEqual(review.items, []);
  assert.equal(review.ordinary_publication_allowed, true);
});

test('builds staff-readable student and day details from AP gap violations', () => {
  const details = qualityAffectedStudents({
    soft_violations: [
      { rule_id: 'ap_block_students_compact_daily_schedule', target_id: 'S2', day: 3, missing_periods: [1, 4] },
      { rule_id: 'ap_block_students_compact_daily_schedule', target_id: 'S2', day: 5, missing_periods: [2] },
      { rule_id: 'another_rule', target_id: 'S1', day: 1, missing_periods: [1] },
    ],
  }, [{ id: 'S2', name: '张三', english_name: 'Sam', grade: 11 }]);

  assert.equal(details.affected_students, 1);
  assert.equal(details.affected_student_days, 2);
  assert.deepEqual(details.rows[0], {
    student_id: 'S2',
    student_name: '张三',
    english_name: 'Sam',
    grade: 11,
    grade_label: '高二',
    day_details: [
      { day: 3, day_label: '周三', missing_periods: [1, 4] },
      { day: 5, day_label: '周五', missing_periods: [2] },
    ],
  });
});
