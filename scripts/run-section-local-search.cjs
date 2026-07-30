const fs = require('fs');
const path = require('path');
const state = require('../timetable.json');
const rules = require('../rules.json');
const { buildSections } = require('../packages/core/src/solver/section-cpsat-engine.cjs');
const { SectionLocalSearch } = require('../packages/core/src/solver/section-local-search.cjs');

const steps = Number(process.env.STEPS || 25000);
const restarts = Number(process.env.RESTARTS || 8);
const output = path.resolve(__dirname, '../local-search-candidate.json');
let best = null;

for (let restart = 0; restart < restarts; restart++) {
  const solver = new SectionLocalSearch(buildSections(state), rules, 20260730 + restart * 104729);
  const result = solver.solve(steps);
  const candidate = { restart, score: result.score, ok: result.ok, meetings: result.meetings, sections: solver.sections };
  if (!best || candidate.score < best.score) {
    best = candidate;
    fs.writeFileSync(output, JSON.stringify(best, null, 2));
  }
  console.log(JSON.stringify({ restart, score: result.score, ok: result.ok }));
}
console.log(JSON.stringify({ best_score: best.score, candidate: output }));
