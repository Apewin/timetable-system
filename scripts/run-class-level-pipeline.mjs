import fs from 'node:fs';
import { solveSections } from '../packages/core/dist/solver/sectioning.js';
import { solveTimetable } from '../packages/core/dist/solver/timetable.js';

const state = JSON.parse(fs.readFileSync(new URL('../timetable.json', import.meta.url), 'utf8'));
const sectioned = solveSections(state, {
  max_students_per_section: Number(process.env.MAX_SECTION_SIZE || 30),
  balance_sections: true,
});
state.teaching_tasks = sectioned.teaching_tasks;
state.ap_sections = sectioned.ap_sections;
state.elective_sections = sectioned.elective_sections;
const result = solveTimetable(state, {
  timeout: Number(process.env.TIMEOUT_MS || 60000),
  seed: Number(process.env.SEED || 20260730),
});
const output = new URL('../class-level-candidate.json', import.meta.url);
fs.writeFileSync(output, JSON.stringify({ sectioned, result }, null, 2));
console.log(JSON.stringify({
  ok: result.ok,
  assignments: result.assignments.length,
  hard_violations: result.hard_violations.length,
  soft_score: result.soft_score,
  output: output.pathname,
}));
