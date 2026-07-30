const fs = require('fs');
const path = require('path');
const state = require('../timetable.json');
const rules = require('../rules.json');
const { solveSectionTimetable } = require('../packages/core/src/solver/section-cpsat-engine.cjs');

async function main() {
  const input = path.resolve(__dirname, '../local-search-candidate.json');
  const output = path.resolve(__dirname, '../fixed-sections-candidate.json');
  const candidate = JSON.parse(fs.readFileSync(input, 'utf8'));
  const result = await solveSectionTimetable(state, {
    sections: candidate.sections,
    rules,
    maxTimeSeconds: Number(process.env.MAX_SECONDS || 120),
    numSearchWorkers: 8,
    randomSeed: Number(process.env.SEED || 20260730),
  });
  fs.writeFileSync(output, JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ ok: result.ok, status: result.status, assignments: result.assignments.length, output }));
}

main().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
