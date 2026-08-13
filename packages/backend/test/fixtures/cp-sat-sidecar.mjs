import { readFile, writeFile } from 'node:fs/promises';

import { create, fromBinary, toBinary } from '@bufbuild/protobuf';
import {
  CpModelProtoSchema,
  CpSolverResponseSchema,
  CpSolverStatus,
  SatParametersSchema,
} from '@ortools-node/cp-sat';

const [, , modelPath, parametersPath, responsePath] = process.argv;
const model = fromBinary(CpModelProtoSchema, await readFile(modelPath));
const parameters = fromBinary(SatParametersSchema, await readFile(parametersPath));

if (!['value', 'delayed'].includes(model.variables[0]?.name)) {
  throw new Error('sidecar did not receive the model');
}
if (parameters.maxTimeInSeconds !== 5) throw new Error('sidecar did not receive solver parameters');
if (model.variables[0]?.name === 'delayed') {
  await new Promise(resolve => setTimeout(resolve, 50));
}

const response = create(CpSolverResponseSchema, {
  status: CpSolverStatus.OPTIMAL,
  solution: [7n],
  objectiveValue: 0,
  bestObjectiveBound: 0,
});
await writeFile(responsePath, toBinary(CpSolverResponseSchema, response));
