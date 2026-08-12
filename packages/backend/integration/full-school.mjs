import assert from 'node:assert/strict';
import { runSolverJob } from '../src/solver-job-runner.mjs';
import { createSolverJob } from '../src/solver-job-policy.mjs';
import { validateSchedule } from '../src/schedule-validator.mjs';
import { fullSchoolProblemFixture } from '../test/fixtures/full-school-problem.mjs';

const fixture = fullSchoolProblemFixture();
const { locks, ...problem } = fixture;
const job = createSolverJob(problem, {
  max_time_seconds: 20,
  candidate_count: 1,
  num_search_workers: 4,
}, {
  lockedMeetings: locks,
});
assert.equal(job.solver, 'resilient-optimize');
const solution = await runSolverJob(job, { timeoutMs: 30_000 });
assert.equal(solution.ok, true, `全校联合求解失败: ${solution.status} ${solution.reason || ''}`);
assert.equal(solution.algorithm, 'constructive-fallback-global-optimize');
const validation = validateSchedule(problem, { ...solution, locks });
assert.equal(validation.ok, true, JSON.stringify(validation.hard_violations.slice(0, 3)));
assert.equal(
  solution.meetings.length,
  problem.sections.reduce((total, item) => total + item.weekly_hours, 0),
  '每个匿名 section 的规定课时都必须排完',
);
assert.ok(solution.meetings.some(item =>
  item.section_id === locks[0].section_id && item.slot_id === locks[0].slot_id));
assert.ok(solution.assignments.length > solution.meetings.length);
console.log(JSON.stringify({
  fixture: 'anonymous-three-grade-school',
  status: solution.status,
  meetings: solution.meetings.length,
  assignments: solution.assignments.length,
  soft_score: validation.soft_score,
  solve_duration_ms: solution.solve_duration_ms,
}));
