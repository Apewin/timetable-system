import assert from 'node:assert/strict';
import test from 'node:test';
import { runSolverJob, solverWorkerForkOptions } from '../src/solver-job-runner.mjs';

test('runs a forked solver worker in Node mode inside packaged Electron', () => {
  const options = solverWorkerForkOptions({
    electronVersion: '43.4.0',
    environment: { TIMETABLE_SOLVER_SIDECAR: 'C:\\solver\\timetable-solver.exe' },
  });

  assert.equal(options.env.ELECTRON_RUN_AS_NODE, '1');
  assert.equal(options.env.TIMETABLE_SOLVER_SIDECAR, 'C:\\solver\\timetable-solver.exe');
  assert.equal(options.serialization, 'advanced');
});

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
    options: {
      maxTimeSeconds: 2,
      numSearchWorkers: 1,
      baselineSchedule: {
        sections: [{
          id: 'A', course_id: 'A', teacher_id: 'T', class_type: 'ap',
          weekly_hours: 1, student_ids: ['S1'], eligible_student_ids: [], grades: [11],
        }],
        meetings: [{ section_id: 'A', slot_id: 'D1P1', room_id: null }],
      },
    },
  });

  assert.equal(result.ap_student_gap_days.proven, true);
  assert.equal(result.ap_morning_empty_student_periods.proven, true);
  assert.equal(result.ap_student_gap_days.baseline_value, 0);
  assert.equal(result.ap_morning_empty_student_periods.baseline_value, 1);
});
