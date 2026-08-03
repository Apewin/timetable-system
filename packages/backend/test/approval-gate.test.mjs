import assert from 'node:assert/strict';
import test from 'node:test';
import { approvalGatedRules, enforceApprovalGates, relaxApprovedRules } from '../src/approval-gate.mjs';
import { solveSchedule } from '../src/cpsat-solver.mjs';
import { validateRules } from '../src/rule-schema.mjs';
import { validateSchedule } from '../src/schedule-validator.mjs';

test('keeps an approval-gated student rule hard until its rule id is explicitly approved', async () => {
  const problem = {
    slots: Array.from({ length: 10 }, (_, index) => ({ id: `D1P${index + 1}`, day: 1, period: index + 1 })),
    rooms: [{ id: 'R1', capacity: 30 }],
    rules: [{ id: 'student-max-three', type: 'max_consecutive_lessons', hard: false, weight: 100, requires_approval_to_relax: true, scope: 'student', target_ids: ['S1'], params: { max: 3 } }],
    sections: [{ id: 'FULL', course_id: 'FULL', teacher_id: 'T1', class_type: 'teaching', weekly_hours: 10, student_ids: ['S1'], eligible_student_ids: [], room_id: 'R1', room_candidates: ['R1'] }],
  };
  assert.deepEqual(approvalGatedRules(problem).map(rule => rule.id), ['student-max-three']);
  const protectedAttempt = await solveSchedule(enforceApprovalGates(problem), { maxTimeSeconds: 5 });
  assert.equal(protectedAttempt.status, 'INFEASIBLE_BY_WORKLOAD');
  assert.equal(approvalGatedRules(problem, ['student-max-three']).length, 0);
  const hardened = enforceApprovalGates(problem);
  assert.equal(hardened.rules[0].hard, true);
  assert.equal(hardened.rules[0].requires_approval_to_relax, false);
  validateRules(hardened.rules);

  const relaxed = relaxApprovedRules(problem, ['student-max-three']);
  assert.equal(relaxed.rules.length, 1);
  assert.equal(relaxed.rules[0].hard, false);
  assert.equal(relaxed.rules[0].requires_approval_to_relax, false);
  const approvedAttempt = await solveSchedule(relaxed, { maxTimeSeconds: 5, optimizeSoft: true });
  assert.equal(approvedAttempt.ok, true);
  assert.ok(validateSchedule(problem, approvedAttempt).soft_score > 0);
});
