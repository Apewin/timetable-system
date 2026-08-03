import assert from 'node:assert/strict';
import test from 'node:test';
import { solveFeasibleFirstSchedule } from '../src/feasible-first-solver.mjs';
import { validateSchedule } from '../src/schedule-validator.mjs';

test('returns a complete reviewable timetable when only the daily-prefix policy is impossible', async () => {
  const problem = {
    slots: [
      { id: 'D1P1', day: 1, period: 1 },
      { id: 'D1P2', day: 1, period: 2 },
      { id: 'D1P3', day: 1, period: 3 },
    ],
    rooms: [],
    rules: [
      {
        id: 'fixed-a', type: 'fixed_slots', hard: true, scope: 'section',
        target_ids: ['A'], section_target_ids: ['A'], params: { slots: ['D1P1'], mode: 'exact' },
      },
      {
        id: 'fixed-b', type: 'fixed_slots', hard: true, scope: 'section',
        target_ids: ['B'], section_target_ids: ['B'], params: { slots: ['D1P3'], mode: 'exact' },
      },
      {
        id: 'student-prefix', type: 'no_internal_gaps', hard: true,
        scope: 'student', target_ids: ['S1'], params: {},
      },
    ],
    sections: [
      {
        id: 'A', course_id: 'A', teacher_id: 'TA', class_type: 'teaching', weekly_hours: 1,
        student_ids: ['S1'], eligible_student_ids: [], locked_student_ids: [], grades: [11],
      },
      {
        id: 'B', course_id: 'B', teacher_id: 'TB', class_type: 'teaching', weekly_hours: 1,
        student_ids: ['S1'], eligible_student_ids: [], locked_student_ids: [], grades: [11],
      },
    ],
  };

  const result = await solveFeasibleFirstSchedule(problem, {
    maxTimeSeconds: 5,
    candidateCount: 1,
  });

  assert.equal(result.ok, true, result.reason || result.status);
  assert.equal(result.meetings.length, 2);
  assert.deepEqual(result.deferred_rule_ids, ['student-prefix']);
  assert.equal(result.review_required, true);
  assert.equal(result.review_items.length, 1);
  assert.equal(validateSchedule({ ...problem, rules: result.effective_rules }, result).ok, true);
  assert.equal(validateSchedule(problem, result).ok, false);
});

test('never defers teacher collisions, weekly hours, locks, or fixed-slot rules', async () => {
  const problem = {
    slots: [{ id: 'D1P1', day: 1, period: 1 }],
    rooms: [],
    rules: [
      {
        id: 'fixed-a', type: 'fixed_slots', hard: true, scope: 'section',
        target_ids: ['A'], section_target_ids: ['A'], params: { slots: ['D1P1'], mode: 'exact' },
      },
      {
        id: 'fixed-b', type: 'fixed_slots', hard: true, scope: 'section',
        target_ids: ['B'], section_target_ids: ['B'], params: { slots: ['D1P1'], mode: 'exact' },
      },
    ],
    sections: [
      { id: 'A', course_id: 'A', teacher_id: 'T', class_type: 'teaching', weekly_hours: 1, student_ids: [], eligible_student_ids: [] },
      { id: 'B', course_id: 'B', teacher_id: 'T', class_type: 'teaching', weekly_hours: 1, student_ids: [], eligible_student_ids: [] },
    ],
  };

  const result = await solveFeasibleFirstSchedule(problem, {
    maxTimeSeconds: 5,
    candidateCount: 1,
  });

  assert.equal(result.ok, false);
  assert.equal(result.status, 'INFEASIBLE');
});

test('reserves the first candidate for feasibility before applying AI search priorities', async () => {
  const progress = [];
  const problem = {
    slots: [
      { id: 'D1P1', day: 1, period: 1 },
      { id: 'D1P2', day: 1, period: 2 },
    ],
    rooms: [],
    rules: [{
      id: 'ai_priority_1_A', type: 'priority', hard: false, weight: 0,
      scope: 'section', target_ids: ['A'], section_target_ids: ['A'], params: { rank: 1 },
    }],
    sections: [{
      id: 'A', course_id: 'A', teacher_id: 'T', class_type: 'teaching', weekly_hours: 1,
      student_ids: [], eligible_student_ids: [], locked_student_ids: [], grades: [11],
    }],
  };

  const result = await solveFeasibleFirstSchedule(problem, {
    maxTimeSeconds: 4,
    candidateCount: 2,
    onProgress: item => progress.push(item),
  });

  assert.equal(result.ok, true);
  assert.equal(result.attempts.length, 2);
  assert.equal(result.attempts[0].ai_priority_count, 0);
  assert.equal(result.attempts[1].ai_priority_count, 1);
  const starts = progress.filter(item => item.stage === 'feasible-first-candidate');
  assert.ok(starts[0].time_limit_seconds > starts[1].time_limit_seconds);
});
