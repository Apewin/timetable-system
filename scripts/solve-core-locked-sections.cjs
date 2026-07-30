const fs = require('fs');
const path = require('path');
const state = require('../timetable.json');
const rules = require('../rules.json');
const { buildSections, solveSectionTimetable } = require('../packages/core/src/solver/section-cpsat-engine.cjs');
const { solveIntegerSections } = require('../packages/core/src/solver/integer-section-cpsat-engine.cjs');

async function main() {
  const allSections = buildSections(state);
  const core = allSections.filter(section => section.class_type === 'admin' || section.class_type === 'teaching');
  const attempts = Number(process.env.ATTEMPTS || 12);
  const selectionSeconds = Number(process.env.SELECTION_SECONDS || 45);
  const output = path.resolve(__dirname, '../core-locked-candidate.json');
  let last = null;
  for (let attempt = 0; attempt < attempts; attempt++) {
    const seed = Number(process.env.SEED || 20260730) + attempt * 7919;
    const coreResult = await solveSectionTimetable(state, { sections: core, rules, maxTimeSeconds: 20, randomSeed: seed });
    if (!coreResult.ok) { last = coreResult; continue; }
    const lockedMeetings = {};
    for (const meeting of coreResult.meetings) (lockedMeetings[meeting.section_id] ||= []).push(meeting.slot_id);
    const result = await solveIntegerSections(state, { sections: allSections, rules, lockedMeetings, maxTimeSeconds: selectionSeconds, seed });
    last = { ...result, core_meetings: coreResult.meetings, attempt: attempt + 1 };
    fs.writeFileSync(output, JSON.stringify(last, null, 2));
    console.log(JSON.stringify({ attempt: attempt + 1, ok: result.ok, status: result.status, assignments: result.assignments.length }));
    if (result.ok) return;
  }
}
main().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
