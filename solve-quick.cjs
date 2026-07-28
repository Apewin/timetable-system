/**
 * 多轮求解器 — 运行N轮，自动选择违规最少的课表
 * 用法: node solve-quick.cjs [轮数，默认3]
 */
const fs = require('fs');
const { SchedulingEngine } = require('./packages/core/src/engine.cjs');
const { G11Engine } = require('./packages/core/src/g11-engine.cjs');
const { G12Engine } = require('./packages/core/src/g12-engine.cjs');
const { PostChecker } = require('./packages/core/src/solver/post-check.cjs');

const RULES_PATH = '/Users/apewin/Desktop/排课系统/rules.json';
const DATA_PATH = '/Users/apewin/Desktop/排课系统/timetable.json';
const ROUNDS = parseInt(process.argv[2]) || 3;

// Post-anneal fill: ensure daily=10 for all students
function postFill(assignments, students) {
  students.forEach(stu => {
    const daily = [0,0,0,0,0], occ = new Set();
    assignments.filter(a => a.student_id === stu.id).forEach(a => { daily[parseInt(a.slot_id.charAt(1))-1]++; occ.add(a.slot_id); });
    for (let d = 1; d <= 5; d++) {
      while (daily[d-1] < 10) {
        let f = false;
        for (const p of [10,9,8,7,6]) { const sid = 'D'+d+'P'+p; if (!occ.has(sid)) { assignments.push({ task_id:'postfill_'+stu.id+'_'+sid, slot_id:sid, room_id:'R1', course_id:'SELF_STUDY', class_id:stu.id, class_type:'filler', teacher_id:null, student_id:stu.id }); daily[d-1]++; occ.add(sid); f=true; break; } }
        if (!f) { for (const p of [5,4,3,2,1]) { const sid = 'D'+d+'P'+p; if (!occ.has(sid)) { assignments.push({ task_id:'postfill_'+stu.id+'_'+sid, slot_id:sid, room_id:'R1', course_id:'SELF_STUDY', class_id:stu.id, class_type:'filler', teacher_id:null, student_id:stu.id }); daily[d-1]++; occ.add(sid); f=true; break; } } }
        if (!f) break;
      }
    }
  });
}

function runOneRound(round) {
  console.log('\n' + '='.repeat(50));
  console.log('Round ' + round + '/' + ROUNDS);
  console.log('='.repeat(50));

  // Clear state
  const state = JSON.parse(fs.readFileSync(DATA_PATH, 'utf-8'));
  state.assignments = [];
  fs.writeFileSync(DATA_PATH, JSON.stringify(state, null, 2), 'utf-8');

  // G10
  console.log('--- G10 ---');
  const e10 = new SchedulingEngine(RULES_PATH, DATA_PATH);
  let best10 = null, bestS10 = Infinity;
  const init10 = e10.generateInitial();
  const r10 = e10.anneal(init10, 20000);
  bestS10 = r10.score; best10 = r10.assignments;
  postFill(best10, e10.students);
  const s10 = e10.students[0];
  const c10 = {};
  best10.filter(a => a.student_id === s10.id && a.course_id).forEach(a => { c10[a.course_id] = (c10[a.course_id] || 0) + 1; });
  const exp10 = { ENG_LS: 3, ENG_RW: 3, ENG_LIT: 4, ENG_SURVEY: 2, MATH_PRECAL: 6, AP_PHYS1: 5, CHEM_PRE: 5, BIO_PRE: 5, PE: 2, GRAMMAR: 2, CHIN: 2, HIST: 2, GEOG: 2, ART: 1, GUIDANCE: 1, MEETING: 1, CLUB: 2, SELF_STUDY: 2 };
  let ok10 = true;
  Object.entries(exp10).forEach(([cid, hrs]) => { if ((c10[cid] || 0) !== hrs) { ok10 = false; console.log('  ❌ ' + cid + ': ' + (c10[cid] || 0) + '≠' + hrs); } });
  console.log('  ' + (ok10 ? '✅' : '❌') + ' Score=' + bestS10);

  // Write G10
  state.assignments = best10;
  fs.writeFileSync(DATA_PATH, JSON.stringify(state, null, 2), 'utf-8');

  // G11
  console.log('--- G11 ---');
  const e11 = new G11Engine(RULES_PATH, DATA_PATH);
  let best11 = null, bestS11 = Infinity;
  const init11 = e11.generateInitial();
  const r11 = e11.anneal(init11, 20000);
  bestS11 = r11.score; best11 = r11.assignments;
  postFill(best11, e11.students);
  console.log('  Score=' + bestS11);

  // Write G10+G11
  state.assignments = [...best10, ...best11];
  fs.writeFileSync(DATA_PATH, JSON.stringify(state, null, 2), 'utf-8');

  // G12
  console.log('--- G12 ---');
  const e12 = new G12Engine(RULES_PATH, DATA_PATH);
  let best12 = null, bestS12 = Infinity;
  const init12 = e12.generateInitial();
  const r12 = e12.anneal(init12, 20000);
  bestS12 = r12.score; best12 = r12.assignments;
  postFill(best12, e12.students);
  console.log('  Score=' + bestS12);

  // Write final
  const allA = [...best10, ...best11, ...best12];
  state.assignments = allA;
  state.meta = state.meta || {};
  state.meta.updated_at = new Date().toISOString();
  state.meta.scores = { g10: bestS10, g11: bestS11, g12: bestS12 };
  fs.writeFileSync(DATA_PATH, JSON.stringify(state, null, 2), 'utf-8');

  // Post-check
  const result = PostChecker.check(state);
  return { result, scores: { g10: bestS10, g11: bestS11, g12: bestS12 } };
}

// === Main: multi-round ===
console.log('=== 多轮求解器 (' + ROUNDS + '轮) ===');
let bestResult = null;
let bestViolations = Infinity;
let bestRound = 0;
let bestState = null;

for (let r = 1; r <= ROUNDS; r++) {
  const { result } = runOneRound(r);
  const v = result.violations.length;
  console.log('\n  Round ' + r + ' violations: ' + v);
  if (v < bestViolations) {
    bestViolations = v;
    bestResult = result;
    bestRound = r;
    bestState = JSON.parse(fs.readFileSync(DATA_PATH, 'utf-8'));
  }
}

// Write best result
if (bestState) {
  fs.writeFileSync(DATA_PATH, JSON.stringify(bestState, null, 2), 'utf-8');
}

// Final report
console.log('\n' + '='.repeat(50));
console.log('🏆 最佳结果: Round ' + bestRound + '/' + ROUNDS + ' — ' + bestViolations + ' violations');
console.log('='.repeat(50));
PostChecker.report(bestResult);
process.exit(bestResult.pass ? 0 : 1);
