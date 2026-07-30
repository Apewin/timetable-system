/**
 * 快速验证求解器 — 少量迭代，验证课时正确性
 */
const fs = require('fs');
const { SchedulingEngine } = require('./archive/engine.cjs');
const { G11Engine } = require('./archive/g11-engine.cjs');
const { G12Engine } = require('./archive/g12-engine.cjs');
const { SoftOptimizer } = require('./packages/core/src/solver/soft-optimizer.cjs');

const RULES_PATH = '/Users/apewin/Desktop/排课系统/rules.json';
const DATA_PATH = '/Users/apewin/Desktop/排课系统/timetable.json';

// Clear previous assignments
const state = JSON.parse(fs.readFileSync(DATA_PATH, 'utf-8'));
state.assignments = [];
fs.writeFileSync(DATA_PATH, JSON.stringify(state, null, 2), 'utf-8');

// G10 - 3 iterations
console.log('--- G10 ---');
const e10 = new SchedulingEngine(RULES_PATH, DATA_PATH);
const init10 = e10.generateInitial();
const r10 = e10.anneal(init10, 3000);
const s10 = e10.students[0];
const c10 = {}; r10.assignments.filter(a => a.student_id === s10.id && a.course_id).forEach(a => { c10[a.course_id] = (c10[a.course_id] || 0) + 1; });
const exp10 = { ENG_LS: 3, ENG_RW: 3, ENG_LIT: 4, ENG_SURVEY: 2, MATH_PRECAL: 6, AP_PHYS1: 5, CHEM_PRE: 5, BIO_PRE: 5, PE: 2, GRAMMAR: 2, CHIN: 2, HIST: 2, GEOG: 2, ART: 1, GUIDANCE: 1, MEETING: 1, CLUB: 2, SELF_STUDY: 2 };
let ok10 = true;
Object.entries(exp10).forEach(([cid, hrs]) => { if ((c10[cid] || 0) !== hrs) { ok10 = false; console.log('  ❌ ' + cid + ': ' + (c10[cid] || 0) + '≠' + hrs); } });
console.log('  ' + (ok10 ? '✅ ALL CORRECT' : '❌ ERRORS') + ' | Score=' + r10.score);

// Write G10
state.assignments = r10.assignments;
fs.writeFileSync(DATA_PATH, JSON.stringify(state, null, 2), 'utf-8');

// G11
console.log('\n--- G11 ---');
const e11 = new G11Engine(RULES_PATH, DATA_PATH);
const init11 = e11.generateInitial();
const r11 = e11.anneal(init11, 3000);
const s11 = e11.students[0];
const tc = s11.teaching_class_id;
const exp11 = tc === 'TC_G11_3'
  ? { ENG_COMP: 4, AP_CALC_BC: 5, PRE_AP_LIT: 2, PHYS_CN: 2, AP_LC: 5, DUTY: 1, MEETING: 1, CLUB: 2, MATH_CN: 2, CHIN: 2, POL: 2, PE: 2, IT: 1, GUIDANCE: 2, SELF_STUDY: 2 }
  : { ENG_COMP: 4, AP_CALC_BC: 5, PRE_AP_LIT: 2, PHYS_CN: 2, HONOR_LC: 2, TOEFL: 3, DUTY: 1, MEETING: 1, CLUB: 2, MATH_CN: 2, CHIN: 2, POL: 2, PE: 2, IT: 1, GUIDANCE: 2, SELF_STUDY: 2 };
const c11 = {}; r11.assignments.filter(a => a.student_id === s11.id && a.course_id).forEach(a => { c11[a.course_id] = (c11[a.course_id] || 0) + 1; });
let ok11 = true;
Object.entries(exp11).forEach(([cid, hrs]) => { if ((c11[cid] || 0) !== hrs) { ok11 = false; console.log('  ❌ ' + cid + ': ' + (c11[cid] || 0) + '≠' + hrs); } });
console.log('  ' + (ok11 ? '✅ ALL CORRECT' : '❌ ERRORS') + ' | Score=' + r11.score + ' | TC=' + tc);

// Write combined
state.assignments = [...r10.assignments, ...r11.assignments];
fs.writeFileSync(DATA_PATH, JSON.stringify(state, null, 2), 'utf-8');

// G12
console.log('\n--- G12 ---');
const e12 = new G12Engine(RULES_PATH, DATA_PATH);
const init12 = e12.generateInitial();
const r12 = e12.anneal(init12, 3000);
const s12 = e12.students[0];
const c12 = {}; r12.assignments.filter(a => a.student_id === s12.id && a.course_id).forEach(a => { c12[a.course_id] = (c12[a.course_id] || 0) + 1; });
console.log('  Sample courses: ' + JSON.stringify(c12));
const d12 = [0, 0, 0, 0, 0];
r12.assignments.filter(a => a.student_id === s12.id).forEach(a => d12[a.slot_id.charAt(1) - 1]++);
console.log('  Daily: ' + d12 + ' ' + (d12.every(d => d === 10) ? '✅' : '❌'));
const ap12 = (s12.ap_courses || []).map(cid => cid + ':' + r12.assignments.filter(a => a.student_id === s12.id && a.course_id === cid).length);
console.log('  AP: ' + ap12.join(', '));
console.log('  Score=' + r12.score);

// Final write
const allA = [...r10.assignments, ...r11.assignments, ...r12.assignments];
state.assignments = allA;
state.meta = state.meta || {};
state.meta.updated_at = new Date().toISOString();
fs.writeFileSync(DATA_PATH, JSON.stringify(state, null, 2), 'utf-8');

// Soft optimization: eliminate morning self-study + reduce consecutive same-slot
const optResult = SoftOptimizer.optimize(allA, state.students);
if (optResult.swaps > 0) {
  state.assignments = allA;
  fs.writeFileSync(DATA_PATH, JSON.stringify(state, null, 2), 'utf-8');
  console.log('  🔧 Soft optimizer: ' + optResult.swaps + ' swaps');
}

console.log('\n✅ Written to ' + DATA_PATH);
