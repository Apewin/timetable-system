import assert from 'node:assert/strict';
import test from 'node:test';
import { createSolverJob } from '../src/solver-job-policy.mjs';

test('uses constructive LNS for quick completion and preserves a second AI-priority candidate', () => {
  const problem = { rules: [] };
  const strategy = { priority_section_ids: ['SEC_A'] };
  const job = createSolverJob(problem, {
    feasible_first: true,
    candidate_count: 1,
    max_time_seconds: 60,
  }, {
    strategy,
    lockedMeetings: [],
    priorHint: { meetings: [], sections: [] },
  });

  assert.equal(job.solver, 'constructive-lns');
  assert.equal(job.options.candidateCount, 2);
  assert.equal(job.options.maxTimeSeconds, 60);
});

test('uses an exact improvement pass when explicitly requested', () => {
  const job = createSolverJob({ rules: [] }, {
    solver_strategy: 'exact',
    max_time_seconds: 30,
  }, {
    lockedMeetings: [{ section_id: 'A', slot_id: 'D1P1' }],
    priorHint: { meetings: [{ section_id: 'A', slot_id: 'D1P1' }], sections: [] },
  });

  assert.equal(job.solver, 'exact');
  assert.equal(job.options.optimizeSoft, true);
  assert.equal(job.options.hintMeetings.length, 1);
  assert.equal(job.options.lockedMeetings.length, 1);
});
