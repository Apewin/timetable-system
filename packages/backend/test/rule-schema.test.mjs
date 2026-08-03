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
