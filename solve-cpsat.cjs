/**
 * 综合排课求解器 — CP-SAT版本 【🏭 生产主路径 P2-1】
 * 全部年级使用全局CP-SAT (TC联合求解)
 *
 * 用法:
 *   SEED=20260729 node solve-cpsat.cjs    # 可复现生产排课
 *   node solve-cpsat.cjs                   # 默认seed
 *
 * 验证:
 *   node validate-against-excel.cjs        # Excel 规格校验
 *
 * 其他求解器已归档至 archive/ 目录:
 *   solve-all.cjs, solve-quick.cjs — 旧 logic-solver 路径
 *   engine.cjs, g11-engine.cjs, g12-engine.cjs, cpsat-engine.cjs — 旧引擎
 */
const fs = require('fs');
const { CpSatG10Engine } = require('./packages/core/src/cpsat-g10-engine.cjs');
const { CpSatG11Engine } = require('./packages/core/src/cpsat-g11-engine.cjs');
const { CpSatG12Engine } = require('./packages/core/src/cpsat-g12-engine.cjs');
const { PostChecker } = require('./packages/core/src/solver/post-check.cjs');

const RULES_PATH = './rules.json';
const DATA_PATH = './timetable.json';
const ITERS = 50;
const ANNEAL_ITERS = 5000;

// P1-6 fix: 可播种 PRNG，支持 --seed 可复现
function mulberry32(seed) {
  return function() {
    seed |= 0; seed = seed + 0x6D2B79F5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
const SEED = parseInt(process.env.SEED || '20260729');
const rand = mulberry32(SEED);

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
    // P2-5 fix: 阈值改为 50×N（每人50节课），而非魔法数字40
    const minExpected = engine.students.length * 50;
    if (init.length < minExpected) {
      // Fallback triggered — try next iteration
      continue;
    }
    const r = engine.anneal(init, ANNEAL_ITERS);
    if (r.score < bestScore) {
      bestScore = r.score; best = r.assignments.slice();
    }
  }
  // P2-5 fix: best 判空，避免 [...null] TypeError
  if (!best) {
    console.error('  ERROR: All ' + iters + ' iterations failed for ' + label);
    return { assignments: [], score: Infinity, failed: true };
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
    e10.setRandom(rand);
    const r10 = await bestOfN(e10, ITERS, 'G10');
    if (r10.failed) { console.error('G10 求解失败'); process.exit(2); }
    stats(r10.assignments, e10.students, 'G10');

    // Atomic write G10 (P0-5 fix: 写临时文件 + rename 原子替换)
    state = JSON.parse(fs.readFileSync(DATA_PATH, 'utf-8'));
    state.assignments = r10.assignments;
    state.meta.updated_at = new Date().toISOString();
    const tmp10 = DATA_PATH + '.tmp';
    fs.writeFileSync(tmp10, JSON.stringify(state, null, 2), 'utf-8');
    fs.renameSync(tmp10, DATA_PATH);

    // G11
    console.log('\n=== Phase 2: G11 CP-SAT ===');
    const e11 = new CpSatG11Engine(RULES_PATH, DATA_PATH);
    e11.setRandom(rand);
    const r11 = await bestOfN(e11, ITERS, 'G11');
    if (r11.failed) { console.error('G11 求解失败'); process.exit(2); }
    stats(r11.assignments, e11.students, 'G11');

    state = JSON.parse(fs.readFileSync(DATA_PATH, 'utf-8'));
    state.assignments = [...r10.assignments, ...r11.assignments];
    state.meta.updated_at = new Date().toISOString();
    const tmp11 = DATA_PATH + '.tmp';
    fs.writeFileSync(tmp11, JSON.stringify(state, null, 2), 'utf-8');
    fs.renameSync(tmp11, DATA_PATH);

    // G12
    console.log('\n=== Phase 3: G12 CP-SAT ===');
    const e12 = new CpSatG12Engine(RULES_PATH, DATA_PATH);
    e12.setRandom(rand);
    const r12 = await bestOfN(e12, ITERS, 'G12');
    if (r12.failed) { console.error('G12 求解失败'); process.exit(2); }
    stats(r12.assignments, e12.students, 'G12');

    // Final atomic write
    const allA = [...r10.assignments, ...r11.assignments, ...r12.assignments];
    state = JSON.parse(fs.readFileSync(DATA_PATH, 'utf-8'));
    state.assignments = allA;
    state.meta.updated_at = new Date().toISOString();
    state.meta.scores = { g10: r10.score, g11: r11.score, g12: r12.score };
    const tmpFinal = DATA_PATH + '.tmp';
    fs.writeFileSync(tmpFinal, JSON.stringify(state, null, 2), 'utf-8');
    fs.renameSync(tmpFinal, DATA_PATH);

    console.log('\n=== 汇总 ===');
    console.log('G10: ' + r10.score + ' | G11: ' + r11.score + ' | G12: ' + r12.score);
    console.log('SEED: ' + SEED);

    // P1-5 fix: 生产路径接入 PostChecker 全量验证
    console.log('\n=== 排课后验证 ===');
    const finalState = JSON.parse(fs.readFileSync(DATA_PATH, 'utf-8'));
    const check = PostChecker.check(finalState);
    PostChecker.report(check);
    if (!check.pass) {
      console.error('\n❌ 验证未通过，退出码 1');
      process.exit(1);
    } else {
      console.log('\n✅ 全部验证通过');
      process.exit(0);
    }
  } catch (e) {
    // P1-6 fix: catch 分支明确退出码 1
    console.error('Error:', e.message);
    console.error(e.stack);
    process.exit(1);
  }
})();
