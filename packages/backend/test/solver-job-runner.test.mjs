import assert from 'node:assert/strict';
import test from 'node:test';
import { runSolverJob } from '../src/solver-job-runner.mjs';

test('reports a native solver worker exit without terminating the backend process', async () => {
  const workerUrl = new URL('./fixtures/solver-exit-worker.mjs', import.meta.url);

  await assert.rejects(
    runSolverJob(
      { solver: 'exact', problem: { slots: [], sections: [], rules: [] }, options: {} },
      { workerUrl, timeoutMs: 2_000 },
    ),
    error => error.code === 'SOLVER_WORKER_EXIT'
      && error.message.includes('86'),
  );
});

test('returns a validated solver result through the worker process seam', async () => {
  const result = await runSolverJob({
    solver: 'exact',
    problem: {
      slots: [{ id: 'D1P1', day: 1, period: 1 }],
      rooms: [],
      rules: [],
      sections: [{
        id: 'A', course_id: 'A', teacher_id: 'T', class_type: 'teaching',
        weekly_hours: 1, student_ids: [], eligible_student_ids: [],
      }],
    },
    options: { maxTimeSeconds: 2, numSearchWorkers: 1 },
  });

  assert.equal(result.ok, true, result.reason || result.status);
  assert.deepEqual(result.meetings, [{ section_id: 'A', slot_id: 'D1P1', room_id: null }]);
});

test('isolates the two-metric quality lower-bound analysis in the solver worker', async () => {
  const result = await runSolverJob({
    solver: 'quality-lower-bounds',
    problem: {
      slots: [
        { id: 'D1P1', day: 1, period: 1 },
        { id: 'D1P2', day: 1, period: 2 },
      ],
      rooms: [],
      rules: [{
        id: 'ap_block_students_compact_daily_schedule', type: 'no_internal_gaps',
        hard: false, weight: 1000, scope: 'student', target_ids: ['S1'],
        params: { preferred_morning_periods: 2 },
      }],
      sections: [{
        id: 'A', course_id: 'A', teacher_id: 'T', class_type: 'ap',
        weekly_hours: 1, student_ids: ['S1'], eligible_student_ids: [], grades: [11],
      }],
    },
    options: { maxTimeSeconds: 2, numSearchWorkers: 1 },
  });

  assert.equal(result.ap_student_gap_days.proven, true);
  assert.equal(result.ap_morning_empty_student_periods.proven, true);
});
