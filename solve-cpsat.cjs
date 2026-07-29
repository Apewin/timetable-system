/**
 * 综合排课求解器 — CP-SAT版本
 * 全部年级使用全局CP-SAT (TC联合求解)
 */
const fs = require('fs');
const { CpSatG10Engine } = require('./packages/core/src/cpsat-g10-engine.cjs');
const { CpSatG11Engine } = require('./packages/core/src/cpsat-g11-engine.cjs');
const { CpSatG12Engine } = require('./packages/core/src/cpsat-g12-engine.cjs');

const RULES_PATH = './rules.json';
const DATA_PATH = './timetable.json';
const ITERS = 50;
const ANNEAL_ITERS = 5000;

function stats(A, students, label) {
  const ssAM = A.filter(a => a.course_id === 'SELF_STUDY' && parseInt(a.slot_id.substring(3)) <= 5).length;
  const ssTotal = A.filter(a => a.course_id === 'SELF_STUDY').length;
  console.log('  ' + label + ': SS_am=' + ssAM + ' SS_tot=' + ssTotal);
}

async function bestOfN(engine, iters, label) {
  let best = null, bestScore = Infinity;
  for (let i = 0; i < iters; i++) {
    if (i % 10 === 0) process.stdout.write('  ' + label + ' ' + i + '/' + iters + '...\n');
    const init = await engine.generateInitial();
    if (init.length < engine.students.length * 40) {
      // Fallback triggered — try next iteration
      continue;
    }
    const r = engine.anneal(init, ANNEAL_ITERS);
    if (r.score < bestScore) {
      bestScore = r.score; best = r.assignments.slice();
    }
  }
  return { assignments: best, score: bestScore };
}

(async () => {
  try {
    // Clear existing G10 assignments for clean start
    let state = JSON.parse(fs.readFileSync(DATA_PATH, 'utf-8'));
    state.assignments = [];
    fs.writeFileSync(DATA_PATH, JSON.stringify(state, null, 2), 'utf-8');

    // G10
    console.log('=== Phase 1: G10 CP-SAT ===');
    const e10 = new CpSatG10Engine(RULES_PATH, DATA_PATH);
    const r10 = await bestOfN(e10, ITERS, 'G10');
    stats(r10.assignments, e10.students, 'G10');

    // Write G10
    state = JSON.parse(fs.readFileSync(DATA_PATH, 'utf-8'));
    state.assignments = r10.assignments;
    state.meta.updated_at = new Date().toISOString();
    fs.writeFileSync(DATA_PATH, JSON.stringify(state, null, 2), 'utf-8');

    // G11
    console.log('\n=== Phase 2: G11 CP-SAT ===');
    const e11 = new CpSatG11Engine(RULES_PATH, DATA_PATH);
    const r11 = await bestOfN(e11, ITERS, 'G11');
    stats(r11.assignments, e11.students, 'G11');

    state = JSON.parse(fs.readFileSync(DATA_PATH, 'utf-8'));
    state.assignments = [...r10.assignments, ...r11.assignments];
    state.meta.updated_at = new Date().toISOString();
    fs.writeFileSync(DATA_PATH, JSON.stringify(state, null, 2), 'utf-8');

    // G12
    console.log('\n=== Phase 3: G12 CP-SAT ===');
    const e12 = new CpSatG12Engine(RULES_PATH, DATA_PATH);
    const r12 = await bestOfN(e12, ITERS, 'G12');
    stats(r12.assignments, e12.students, 'G12');

    // Final write
    const allA = [...r10.assignments, ...r11.assignments, ...r12.assignments];
    state = JSON.parse(fs.readFileSync(DATA_PATH, 'utf-8'));
    state.assignments = allA;
    state.meta.updated_at = new Date().toISOString();
    state.meta.scores = { g10: r10.score, g11: r11.score, g12: r12.score };
    fs.writeFileSync(DATA_PATH, JSON.stringify(state, null, 2), 'utf-8');

    console.log('\n=== 汇总 ===');
    console.log('G10: ' + r10.score + ' | G11: ' + r11.score + ' | G12: ' + r12.score);
  } catch (e) {
    console.error('Error:', e.message);
    console.error(e.stack);
  }
})();
