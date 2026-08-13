import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { fromBinary, toBinary } from '@bufbuild/protobuf';
import {
  CpSolver as NativeCpSolver,
  CpSolverResponseSchema,
  SatParametersSchema,
} from '@ortools-node/cp-sat';

export {
  CpModel,
  CpSolverResponseSchema,
  CpSolverStatus,
  DomainReductionStrategy,
  LinearExpr,
  SatParametersSchema,
  VariableSelectionStrategy,
} from '@ortools-node/cp-sat';

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const stdout = [];
    const stderr = [];
    child.stdout.on('data', chunk => stdout.push(chunk));
    child.stderr.on('data', chunk => stderr.push(chunk));
    child.once('error', reject);
    child.once('close', code => {
      const output = Buffer.concat(stdout).toString('utf8');
      const errorOutput = Buffer.concat(stderr).toString('utf8');
      if (code === 0) resolve({ output, errorOutput });
      else reject(new Error(`CP-SAT sidecar exited with code ${code}: ${errorOutput || output}`));
    });
  });
}

export class SidecarCpSolver extends NativeCpSolver {
  constructor({ command, args = [] } = {}) {
    super();
    if (!command) throw new Error('CP-SAT sidecar command is required');
    this.sidecarCommand = command;
    this.sidecarArgs = [...args];
  }

  async solve(model, _options = {}) {
    const directory = await mkdtemp(join(tmpdir(), 'timetable-cpsat-'));
    const modelPath = join(directory, 'model.bin');
    const parametersPath = join(directory, 'parameters.bin');
    const responsePath = join(directory, 'response.bin');
    try {
      await Promise.all([
        writeFile(modelPath, model.toBytes()),
        writeFile(parametersPath, toBinary(SatParametersSchema, this.parameters)),
      ]);
      const result = await run(
        this.sidecarCommand,
        [...this.sidecarArgs, modelPath, parametersPath, responsePath],
      );
      if (this.logCallback && result.output) {
        for (const line of result.output.split(/\r?\n/).filter(Boolean)) this.logCallback(line);
      }
      this.response_ = fromBinary(CpSolverResponseSchema, await readFile(responsePath));
      return this.response_.status;
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }
}

const configuredSidecar = process.env.TIMETABLE_SOLVER_SIDECAR;

export const CpSolver = configuredSidecar
  ? class ConfiguredSidecarCpSolver extends SidecarCpSolver {
    constructor() {
      super({ command: configuredSidecar });
    }
  }
  : NativeCpSolver;
