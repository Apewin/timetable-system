import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildGradeNeighborhoods,
  solveConstructiveLnsSchedule,
} from '../src/constructive-lns-solver.mjs';
import { solveResilientOptimizedSchedule } from '../src/resilient-optimizer.mjs';
import { validateSchedule } from '../src/schedule-validator.mjs';

test('grade neighborhoods include cross-grade teachers and synchronized Block sections', () => {
  const problem = {
    slots: [], rooms: [],
    sections: [
      { id: 'G11', teacher_id: 'SHARED', grades: [11] },
      { id: 'G12_SHARED', teacher_id: 'SHARED', grades: [12] },
      { id: 'G12_BLOCK', teacher_id: 'OTHER', grades: [12] },
    ],
    rules: [{
      id: 'block', type: 'synchronized_slots', target_ids: ['G12_SHARED', 'G12_BLOCK'],
    }],
  };

  const grade11 = buildGradeNeighborhoods(problem).find(item => item.grade === 11);
  assert.deepEqual(grade11.section_ids, ['G11', 'G12_BLOCK', 'G12_SHARED']);
});

test('constructs a complete timetable then improves it without discarding the feasible draft', async () => {
  const problem = {
    slots: [
      { id: 'D1P1', day: 1, period: 1 },
      { id: 'D1P2', day: 1, period: 2 },
    ],
    rooms: [],
    rules: [{
      id: 'prefer-second', type: 'preferred_slots', hard: false, weight: 10,
      scope: 'section', target_ids: ['A'], section_target_ids: ['A'], params: { slots: ['D1P2'] },
    }],
    sections: [{
      id: 'A', course_id: 'A', teacher_id: 'TA', class_type: 'teaching',
      weekly_hours: 1, student_ids: ['S1'], eligible_student_ids: [],
      locked_student_ids: [], grades: [11],
    }],
  };

  const result = await solveConstructiveLnsSchedule(problem, {
    maxTimeSeconds: 5,
    initialShare: 0.2,
    iterationTimeSeconds: 2,
    numSearchWorkers: 1,
  });

  assert.equal(result.ok, true, result.reason || result.status);
  assert.equal(result.algorithm, 'constructive-grade-lns');
  assert.equal(result.meetings[0].slot_id, 'D1P2');
  assert.equal(validateSchedule(problem, result).ok, true);
});

test('uses the constructive draft only as fallback before a global soft optimization pass', async () => {
  const problem = {
    slots: [
      { id: 'D1P1', day: 1, period: 1 },
      { id: 'D1P2', day: 1, period: 2 },
    ],
    rooms: [],
    rules: [{
      id: 'prefer-second', type: 'preferred_slots', hard: false, weight: 10,
      scope: 'section', target_ids: ['A'], section_target_ids: ['A'], params: { slots: ['D1P2'] },
    }],
    sections: [{
      id: 'A', course_id: 'A', teacher_id: 'TA', class_type: 'teaching',
      weekly_hours: 1, student_ids: ['S1'], eligible_student_ids: [],
      // A membership lock disables the graph-colouring shortcut, so the
      // fallback CP pass deliberately runs without modeling soft objectives.
      locked_student_ids: ['S1'], grades: [11],
    }],
  };

  const result = await solveResilientOptimizedSchedule(problem, {
    maxTimeSeconds: 5,
    numSearchWorkers: 1,
  });

  assert.equal(result.ok, true, result.reason || result.status);
  assert.equal(result.algorithm, 'constructive-fallback-global-optimize');
  assert.equal(result.global_optimization.attempted, true);
  assert.equal(result.global_optimization.accepted, true);
  assert.equal(result.global_optimization.comparison, 'global_not_worse');
  assert.equal(
    result.global_optimization.fallback_quality.morning_empty_student_periods,
    null,
  );
  assert.equal(result.global_optimization.fallback_quality.soft_score, 10);
  assert.equal(result.global_optimization.optimized_quality.soft_score, 0);
  assert.equal(result.meetings[0].slot_id, 'D1P2');
});

test('keeps manual locks hard during every improvement pass', async () => {
  const problem = {
    slots: [
      { id: 'D1P1', day: 1, period: 1 },
      { id: 'D1P2', day: 1, period: 2 },
    ],
    rooms: [],
    rules: [{
      id: 'prefer-second', type: 'preferred_slots', hard: false, weight: 10,
      scope: 'section', target_ids: ['A'], section_target_ids: ['A'], params: { slots: ['D1P2'] },
    }],
    sections: [{
      id: 'A', course_id: 'A', teacher_id: 'TA', class_type: 'teaching',
      weekly_hours: 1, student_ids: ['S1'], eligible_student_ids: [],
      locked_student_ids: [], grades: [11],
    }],
  };
  const locks = [{ section_id: 'A', slot_id: 'D1P1', origin: 'manual' }];

  const result = await solveConstructiveLnsSchedule(problem, {
    maxTimeSeconds: 4,
    initialShare: 0.25,
    iterationTimeSeconds: 2,
    lockedMeetings: locks,
    numSearchWorkers: 1,
  });

  assert.equal(result.ok, true, result.reason || result.status);
  assert.equal(result.meetings[0].slot_id, 'D1P1');
  assert.equal(validateSchedule(problem, { ...result, locks }).ok, true);
});
