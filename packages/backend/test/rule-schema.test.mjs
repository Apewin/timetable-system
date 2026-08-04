import assert from 'node:assert/strict';
import test from 'node:test';
import { validateRules } from '../src/rule-schema.mjs';

test('accepts a hard student rule that forbids internal daily gaps', () => {
  const rules = [{
    id: 'student-daily-prefix',
    type: 'no_internal_gaps',
    hard: true,
    scope: 'student',
    target_ids: ['S1'],
    params: {},
  }];

  assert.equal(validateRules(rules), rules);
});

test('rejects a daily-gap rule outside student scope', () => {
  assert.throws(() => validateRules([{
    id: 'class-daily-prefix',
    type: 'no_internal_gaps',
    hard: true,
    scope: 'class',
    target_ids: ['C1'],
    params: {},
  }]), /student/);
});

test('rejects a soft daily-gap rule', () => {
  assert.throws(() => validateRules([{
    id: 'soft-student-daily-prefix',
    type: 'no_internal_gaps',
    hard: false,
    weight: 1,
    scope: 'student',
    target_ids: ['S1'],
    params: {},
  }]), /必须是硬约束/);
});

test('rejects a malformed ignored-course list for a daily-gap rule', () => {
  assert.throws(() => validateRules([{
    id: 'student-daily-prefix',
    type: 'no_internal_gaps',
    hard: true,
    scope: 'student',
    target_ids: ['S1'],
    params: { ignore_course_ids: 'ACTIVITY' },
  }]), /ignore_course_ids/);
});

test('accepts a soft consecutive-pair preference only for sections', () => {
  const rule = {
    id: 'teaching-double-periods', type: 'preferred_consecutive_pairs', hard: false, weight: 120,
    scope: 'section', params: { selector: { class_types: ['teaching'], min_weekly_hours: 2 }, target_pairs: 1 },
  };
  assert.equal(validateRules([rule])[0], rule);
  assert.throws(() => validateRules([{ ...rule, scope: 'course' }]), /section/);
  assert.throws(() => validateRules([{ ...rule, hard: true }]), /软约束/);
  assert.throws(() => validateRules([{ ...rule, params: { target_pairs: 0 } }]), /target_pairs/);
});

test('accepts a minimum number of teaching days', () => {
  const rule = {
    id: 'spread-six-hour-course', type: 'min_occurrence_days', hard: true,
    scope: 'section', params: { min: 5 },
  };
  assert.equal(validateRules([rule])[0], rule);
  assert.throws(() => validateRules([{ ...rule, params: { min: 0 } }]), /params.min/);
});

test('accepts the soft teacher first-and-last-period avoidance rule', () => {
  const rule = {
    id: 'teacher-day-extremes', type: 'avoid_teacher_day_extremes', hard: false, weight: 1000,
    scope: 'teacher', params: { first_period: 1, last_period: 10 },
  };
  assert.equal(validateRules([rule])[0], rule);
  assert.throws(() => validateRules([{ ...rule, hard: true }]), /必须是软约束/);
  assert.throws(() => validateRules([{ ...rule, scope: 'section' }]), /teacher/);
  assert.throws(() => validateRules([{ ...rule, params: { first_period: 10, last_period: 1 } }]), /必须小于/);
});
