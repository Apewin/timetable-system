const fs = require('fs');
const path = require('path');
const state = require('../timetable.json');
const rules = require('../rules.json');
const { solveSelectionsThenCore } = require('../packages/core/src/solver/section-cpsat-engine.cjs');

async function main() {
  const output = path.resolve(__dirname, '../selections-core-candidate.json');
  const result = await solveSelectionsThenCore(state, {
    rules,
    attempts: Number(process.env.ATTEMPTS || 8),
    selectionMaxTimeSeconds: Number(process.env.SELECTION_SECONDS || 90),
    coreMaxTimeSeconds: Number(process.env.CORE_SECONDS || 30),
    seed: Number(process.env.SEED || 20260730),
  });
  fs.writeFileSync(output, JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ ok: result.ok, status: result.status, attempts: result.attempts, assignments: result.assignments?.length || 0, output }));
}

main().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
