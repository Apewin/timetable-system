const fs = require('fs');
const path = require('path');
const state = require('../timetable.json');
const rules = require('../rules.json');
const { solveTwoStageWholeSchool } = require('../packages/core/src/solver/section-cpsat-engine.cjs');

async function main() {
  const output = path.resolve(__dirname, '../two-stage-candidate.json');
  const result = await solveTwoStageWholeSchool(state, {
    rules,
    maxTimeSeconds: Number(process.env.MAX_SECONDS || 20),
    maxSectioningAttempts: Number(process.env.ATTEMPTS || 40),
    seed: Number(process.env.SEED || 20260730),
  });
  fs.writeFileSync(output, JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ ok: result.ok, status: result.status, reason: result.reason, attempts: result.attempts, assignments: result.assignments.length, output }));
}

main().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
