const fs = require('fs');
const path = require('path');
const state = require('../timetable.json');
const rules = require('../rules.json');
const { buildSections, solveSectionTimetable } = require('../packages/core/src/solver/section-cpsat-engine.cjs');

async function main() {
  const sections = buildSections(state);
  const result = await solveSectionTimetable(state, {
    sections,
    rules,
    maxTimeSeconds: Number(process.env.MAX_SECONDS || 120),
    numSearchWorkers: 8,
    randomSeed: Number(process.env.SEED || 20260730),
  });
  const output = path.resolve(__dirname, '../default-sections-candidate.json');
  fs.writeFileSync(output, JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ ok: result.ok, status: result.status, assignments: result.assignments.length, output }));
}
main().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
