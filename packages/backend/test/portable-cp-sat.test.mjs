import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { CpModel, CpSolverStatus } from '@ortools-node/cp-sat';
import { SidecarCpSolver } from '../src/cp-sat-runtime.mjs';

const fixture = fileURLToPath(new URL('./fixtures/cp-sat-sidecar.mjs', import.meta.url));
const pythonSidecar = fileURLToPath(new URL('../../desktop/solver_sidecar.py', import.meta.url));

test('solves a Node-built CP-SAT model through a sidecar process', async () => {
  const model = new CpModel();
  const value = model.newIntVar(0, 10, 'value');
  model.addEquality(value, 7);

  const solver = new SidecarCpSolver({
    command: process.execPath,
    args: [fixture],
  });
  solver.parameters.maxTimeInSeconds = 5;

  const status = await solver.solve(model);

  assert.equal(status, CpSolverStatus.OPTIMAL);
  assert.equal(solver.value(value), 7n);
  assert.equal(solver.objectiveValue, 0);
});

test('allows the sidecar to serialize its bounded solve response after the JS deadline', async () => {
  const model = new CpModel();
  const value = model.newIntVar(0, 10, 'delayed');
  model.addEquality(value, 7);
  const solver = new SidecarCpSolver({
    command: process.execPath,
    args: [fixture],
  });
  solver.parameters.maxTimeInSeconds = 5;
  const controller = new AbortController();
  setTimeout(() => controller.abort(), 10);

  const status = await solver.solve(model, { signal: controller.signal });

  assert.equal(status, CpSolverStatus.OPTIMAL);
  assert.equal(solver.value(value), 7n);
});

test('official Python OR-Tools sidecar accepts the same binary model protocol', {
  skip: !process.env.TIMETABLE_TEST_PYTHON_PACKAGES,
}, async () => {
  const model = new CpModel();
  const value = model.newIntVar(0, 10, 'value');
  model.addEquality(value, 7);

  const packagePath = process.env.TIMETABLE_TEST_PYTHON_PACKAGES;
  const bootstrap = [
    'import runpy, sys',
    `sys.path.insert(0, ${JSON.stringify(packagePath)})`,
    'script = sys.argv[1]',
    'sys.argv = sys.argv[1:]',
    'runpy.run_path(script, run_name="__main__")',
  ].join('; ');
  const solver = new SidecarCpSolver({
    command: 'python3',
    args: ['-c', bootstrap, pythonSidecar],
  });

  const status = await solver.solve(model);

  assert.equal(status, CpSolverStatus.OPTIMAL);
  assert.equal(solver.value(value), 7n);
});

test('packaged solver executable implements the production sidecar contract', {
  skip: !process.env.TIMETABLE_TEST_SOLVER_EXECUTABLE,
}, async () => {
  const model = new CpModel();
  const value = model.newIntVar(0, 10, 'value');
  model.addEquality(value, 7);
  const solver = new SidecarCpSolver({
    command: process.env.TIMETABLE_TEST_SOLVER_EXECUTABLE,
  });

  const status = await solver.solve(model);

  assert.equal(status, CpSolverStatus.OPTIMAL);
  assert.equal(solver.value(value), 7n);
});
