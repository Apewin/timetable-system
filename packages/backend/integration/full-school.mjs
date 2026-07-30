import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildSchedulingProblem } from '../src/problem-builder.mjs';
import { solveSchedule } from '../src/cpsat-solver.mjs';
import { validateSchedule } from '../src/schedule-validator.mjs';

const state = JSON.parse(readFileSync(new URL('../../../timetable.json', import.meta.url), 'utf8'));
const problem = buildSchedulingProblem(state);
const solution = await solveSchedule(problem, { maxTimeSeconds: 60, numSearchWorkers: 8, optimizeSoft: true });
assert.equal(solution.ok, true, `全校联合求解失败: ${solution.status} ${solution.reason || ''}`);
const validation = validateSchedule(problem, solution);
assert.equal(validation.ok, true, JSON.stringify(validation.hard_violations.slice(0, 3)));
assert.equal(solution.meetings.length, 439);
assert.equal(solution.assignments.length, 12000);
console.log(JSON.stringify({ status: solution.status, meetings: solution.meetings.length, assignments: solution.assignments.length, soft_score: validation.soft_score }));
