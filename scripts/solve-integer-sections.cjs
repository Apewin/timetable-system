const fs = require('fs');
const path = require('path');
const state = require('../timetable.json');
const rules = require('../rules.json');
const { solveIntegerSections } = require('../packages/core/src/solver/integer-section-cpsat-engine.cjs');
const { buildSections } = require('../packages/core/src/solver/section-cpsat-engine.cjs');

async function main() {
  const candidateOnly = process.env.CANDIDATE_ONLY === '1';
  const hint = process.env.HINT_FILE ? JSON.parse(fs.readFileSync(path.resolve(process.env.HINT_FILE), 'utf8')) : null;
  const result = await solveIntegerSections(state, {
    sections: candidateOnly ? buildSections(state).filter(section => section.class_type === 'ap' || section.class_type === 'elective') : undefined,
    rules,
    maxTimeSeconds: Number(process.env.MAX_SECONDS || 180),
    numSearchWorkers: 8,
    seed: Number(process.env.SEED || 20260730),
    hint,
  });
  const output = path.resolve(__dirname, candidateOnly ? '../integer-selections-hint.json' : '../integer-sections-candidate.json');
  fs.writeFileSync(output, JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ ok: result.ok, status: result.status, assignments: result.assignments.length, output }));
}
main().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
