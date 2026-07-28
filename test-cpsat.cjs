/**
 * CP-SAT 排课测试 — G10 only
 * 对比 CP-SAT vs logic-solver 的效果和性能
 */
const { CpSatEngine } = require('./packages/core/src/cpsat-engine.cjs');
const { SchedulingEngine } = require('./packages/core/src/engine.cjs');
const { PostChecker } = require('./packages/core/src/solver/post-check.cjs');

const RULES_PATH = './rules.json';
const DATA_PATH = './timetable.json';

function stats(A, students, label) {
  const hasAny = A.length > 0;
  const ssAM = hasAny ? A.filter(a => a.course_id === 'SELF_STUDY' && parseInt(a.slot_id.substring(3)) <= 5).length : 0;
  const ssTotal = hasAny ? A.filter(a => a.course_id === 'SELF_STUDY').length : 0;
  const tc = hasAny ? A.filter(a => a.teacher_id).reduce((acc, a) => {
    const key = a.teacher_id + '@' + a.slot_id;
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {}) : {};
  const teacherConflicts = Object.values(tc).filter(c => c > 1).length;

  // Distribution check: ≤5hr courses on same day
  const byStu = {};
  if (hasAny) {
    A.forEach(a => {
      if (!byStu[a.student_id]) byStu[a.student_id] = [];
      byStu[a.student_id].push(a);
    });
  }
  let distViolations = 0;
  const courseHours = {}; // per student
  for (const [sid, sA] of Object.entries(byStu)) {
    const counts = {};
    sA.forEach(a => { counts[a.course_id] = (counts[a.course_id] || 0) + 1; });
    courseHours[sid] = counts;
    for (const [cid, hrs] of Object.entries(counts)) {
      if (hrs <= 5) {
        for (let d = 1; d <= 5; d++) {
          const onDay = sA.filter(a => a.course_id === cid && a.slot_id.startsWith('D' + d)).length;
          if (onDay > 1) distViolations++;
        }
      }
    }
  }

  const dailyCheck = hasAny ? Object.entries(byStu).map(([sid, sA]) => {
    const daily = [0, 0, 0, 0, 0];
    sA.forEach(a => daily[parseInt(a.slot_id.charAt(1)) - 1]++);
    return daily.every(d => d === 10);
  }).filter(Boolean).length : 0;
  const totalStu = students.length;

  console.log(`  ${label}: SS_am=${ssAM} SS_tot=${ssTotal} TConflicts=${teacherConflicts} DistV=${distViolations} FullDays=${dailyCheck}/${totalStu}`);
  return { ssAM, ssTotal, teacherConflicts, distViolations, dailyCheck, totalStu };
}

async function testCpSat() {
  console.log('=== CP-SAT Engine Test (G10) ===\n');

  const start = Date.now();

  const engine = new CpSatEngine(RULES_PATH, DATA_PATH);
  const A = await engine.generateInitial();

  const elapsed = Date.now() - start;
  console.log(`\n  CP-SAT generateInitial: ${elapsed}ms, ${A.length} assignments`);

  const s = stats(A, engine.students, 'CP-SAT raw');

  // Anneal
  const annealStart = Date.now();
  const result = engine.anneal(A, 3000);
  const annealElapsed = Date.now() - annealStart;
  console.log(`  Anneal: ${annealElapsed}ms, score=${result.score}`);

  const s2 = stats(result.assignments, engine.students, 'CP-SAT annealed');

  console.log(`\n  Total time: ${Date.now() - start}ms`);
  return result;
}

function testLogicSolver() {
  console.log('=== logic-solver Engine Test (G10) ===\n');

  const start = Date.now();
  const engine = new SchedulingEngine(RULES_PATH, DATA_PATH);
  const A = engine.generateInitial();
  const elapsed = Date.now() - start;

  console.log(`  logic-solver generateInitial: ${elapsed}ms, ${A.length} assignments`);
  const s = stats(A, engine.students, 'SAT raw');

  // Anneal
  const annealStart = Date.now();
  const result = engine.anneal(A, 3000);
  const annealElapsed = Date.now() - annealStart;
  console.log(`  Anneal: ${annealElapsed}ms, score=${result.score}`);

  const s2 = stats(result.assignments, engine.students, 'SAT annealed');

  console.log(`\n  Total time: ${Date.now() - start}ms`);
  return result;
}

(async () => {
  try {
    // Test logic-solver first (sync)
    const satResult = testLogicSolver();

    console.log('\n' + '='.repeat(60) + '\n');

    // Test CP-SAT (async)
    const cpResult = await testCpSat();

    // Compare
    console.log('\n=== Comparison ===');
    console.log(`  logic-solver final score: ${satResult.score}`);
    console.log(`  CP-SAT final score:      ${cpResult.score}`);

  } catch (e) {
    console.error('Error:', e.message);
    console.error(e.stack);
  }
})();
