#!/usr/bin/env node

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildCommandPlan, CliError } from './command-planner.mjs';
import { materializeExport } from './export-output.mjs';
import { requestJson, requestMultipart } from './http-client.mjs';

const DEFAULT_API_URL = 'http://127.0.0.1:3001/api';

function writeJson(writer, value) {
  writer(`${JSON.stringify(value, null, 2)}\n`);
}

export async function runCli(argv, dependencies = {}) {
  const request = dependencies.request || requestJson;
  const upload = dependencies.upload || requestMultipart;
  const writeOut = dependencies.writeOut || (value => process.stdout.write(value));
  const writeError = dependencies.writeError || (value => process.stderr.write(value));
  const readFile = dependencies.readFile || readFileSync;
  const mkdir = dependencies.mkdir || mkdirSync;
  const writeFile = dependencies.writeFile || writeFileSync;
  const cwd = dependencies.cwd || process.cwd();
  const env = dependencies.env || process.env;
  const baseUrl = (env.TIMETABLE_API_URL || DEFAULT_API_URL).replace(/\/+$/, '');
  let plan;
  try {
    plan = buildCommandPlan(argv, { baseUrl, readFile, cwd });
  } catch (error) {
    const cliError = error instanceof CliError
      ? error
      : new CliError('CLI_USAGE', error.message);
    writeJson(writeError, { ok: false, error: { code: cliError.code, message: cliError.message } });
    return cliError.exitCode;
  }
  if (plan.local) {
    writeJson(writeOut, plan.local);
    return 0;
  }
  try {
    let result = plan.transport === 'multipart'
      ? await upload({ baseUrl, path: plan.path, fields: plan.fields, files: plan.files })
      : await request({ baseUrl, path: plan.path, method: plan.method, body: plan.body });
    if (plan.outputDir) result = materializeExport(result, plan.outputDir, { mkdir, writeFile });
    writeJson(writeOut, result);
    return 0;
  } catch (error) {
    writeJson(writeError, { ok: false, error: { code: 'CLI_REQUEST_FAILED', message: error.message } });
    return 3;
  }
}

const isMainModule = process.argv[1]
  && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMainModule) {
  runCli(process.argv.slice(2)).then(exitCode => { process.exitCode = exitCode; });
}
