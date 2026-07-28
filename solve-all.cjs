/**
 * 综合排课求解器 v4 - 串行排课 G10→G11→G12，传递教师课表
 */
const fs = require('fs');
const { SchedulingEngine } = require('./packages/core/src/engine.cjs');
const { G11Engine } = require('./packages/core/src/g11-engine.cjs');
const { G12Engine } = require('./packages/core/src/g12-engine.cjs');

const RULES_PATH = './rules.json';
const DATA_PATH = './timetable.json';
const ITERS = 50;
const ANNEAL_ITERS = 5000;

function swapSSFromMorning(A, students) {
  const byST = {};
  A.forEach(a => {
    if (a.teacher_id) {
      if (!byST[a.slot_id]) byST[a.slot_id] = new Set();
      byST[a.slot_id].add(a.teacher_id);
    }
  });
  // Iterative: keep swapping until no more progress
  let totalSwaps = 0;
  for (let pass = 0; pass < 10; pass++) {
    let passSwaps = 0;
    students.forEach(stu => {
      const sA = A.filter(a => a.student_id === stu.id);
      const mSS = sA.filter(a => a.course_id === 'SELF_STUDY' && parseInt(a.slot_id.substring(3)) <= 5);
      const aC = sA.filter(a => a.course_id !== 'SELF_STUDY' && a.class_type !== 'admin' && !['DUTY','MEETING','CLUB'].includes(a.course_id) && parseInt(a.slot_id.substring(3)) >= 6);
      for (const ss of mSS) {
        for (let i = 0; i < aC.length; i++) {
          const ac = aC[i];
          if (!ac.teacher_id || !byST[ss.slot_id]?.has(ac.teacher_id)) {
            if (ac.teacher_id) {
              byST[ac.slot_id].delete(ac.teacher_id);
              if (!byST[ss.slot_id]) byST[ss.slot_id] = new Set();
              byST[ss.slot_id].add(ac.teacher_id);
            }
            const t = ac.slot_id; ac.slot_id = ss.slot_id; ss.slot_id = t;
            aC.splice(i, 1); passSwaps++; break;
          }
        }
      }
    });
    totalSwaps += passSwaps;
    if (passSwaps === 0) break;
  }
}

function bestOfN(engine, iters, label) {
  let best = null, bestScore = Infinity, bestSSam = Infinity;
  for (let i = 0; i < iters; i++) {
    if (i % 10 === 0) process.stdout.write('  ' + label + ' ' + i + '/' + iters + '...\n');
    const init = engine.generateInitial();
    const r = engine.anneal(init, ANNEAL_ITERS);
    swapSSFromMorning(r.assignments, engine.students);
    const am = r.assignments.filter(a => a.course_id==='SELF_STUDY' && parseInt(a.slot_id.substring(3))<=5).length;
    if (r.score < bestScore || (r.score === bestScore && am < bestSSam)) {
      bestScore = r.score; bestSSam = am; best = r.assignments.slice();
    }
  }
  return { assignments: best, score: bestScore, ssAM: bestSSam };
}

function stats(A, students, label) {
  const ssAM = A.filter(a => a.course_id==='SELF_STUDY' && parseInt(a.slot_id.substring(3))<=5).length;
  const ssTotal = A.filter(a => a.course_id==='SELF_STUDY').length;
  console.log('  ' + label + ': Score=' + (A._score||'?') + ' SS_am=' + ssAM + ' SS_tot=' + ssTotal);
  return { ssAM, ssTotal };
}

// ===== Phase 1: Clear all assignments, run G10 =====
console.log('=== Phase 1: 高一 G10 ===');
let state = JSON.parse(fs.readFileSync(DATA_PATH, 'utf-8'));
state.assignments = []; // Clear all
fs.writeFileSync(DATA_PATH, JSON.stringify(state, null, 2), 'utf-8');

const e10 = new SchedulingEngine(RULES_PATH, DATA_PATH);
const r10 = bestOfN(e10, ITERS, 'G10');
r10.assignments._score = r10.score;
stats(r10.assignments, e10.students, 'G10');

// Write G10 results
state = JSON.parse(fs.readFileSync(DATA_PATH, 'utf-8'));
state.assignments = r10.assignments;
state.meta.updated_at = new Date().toISOString();
fs.writeFileSync(DATA_PATH, JSON.stringify(state, null, 2), 'utf-8');

// ===== Phase 2: Run G11 with G10 teacher schedule =====
console.log('\n=== Phase 2: 高二 G11 ===');
const e11 = new G11Engine(RULES_PATH, DATA_PATH);
const r11 = bestOfN(e11, ITERS, 'G11');
r11.assignments._score = r11.score;
stats(r11.assignments, e11.students, 'G11');

// AP coverage
const ap11 = {};
e11.students.filter(s => (s.ap_courses||[]).length>0).forEach(s => {
  (s.ap_courses||[]).forEach(cid => {
    if(!ap11[cid]) ap11[cid]={studs:0,assigned:0};
    ap11[cid].studs++; ap11[cid].assigned+=r11.assignments.filter(a=>a.student_id===s.id&&a.course_id===cid).length;
  });
});
Object.entries(ap11).sort().forEach(([cid,c])=>console.log('  '+cid+': '+c.assigned+'/'+(c.studs*5)));

// Write combined G10+G11
state = JSON.parse(fs.readFileSync(DATA_PATH, 'utf-8'));
state.assignments = [...r10.assignments, ...r11.assignments];
state.meta.updated_at = new Date().toISOString();
fs.writeFileSync(DATA_PATH, JSON.stringify(state, null, 2), 'utf-8');

// ===== Phase 3: Run G12 with G10+G11 teacher schedule =====
console.log('\n=== Phase 3: 高三 G12 ===');
const e12 = new G12Engine(RULES_PATH, DATA_PATH);
const r12 = bestOfN(e12, ITERS, 'G12');
r12.assignments._score = r12.score;
stats(r12.assignments, e12.students, 'G12');

const ap12 = {};
e12.students.filter(s => (s.ap_courses||[]).length>0).forEach(s => {
  (s.ap_courses||[]).forEach(cid => {
    if(!ap12[cid]) ap12[cid]={studs:0,assigned:0};
    ap12[cid].studs++; ap12[cid].assigned+=r12.assignments.filter(a=>a.student_id===s.id&&a.course_id===cid).length;
  });
});
Object.entries(ap12).sort().forEach(([cid,c])=>console.log('  '+cid+': '+c.assigned+'/'+(c.studs*5)));

// ===== Final write =====
const allA = [...r10.assignments, ...r11.assignments, ...r12.assignments];
state = JSON.parse(fs.readFileSync(DATA_PATH, 'utf-8'));
state.assignments = allA;
state.meta.updated_at = new Date().toISOString();
state.meta.scores = {
  g10: {score:r10.score, ssAM: r10.ssAM},
  g11: {score:r11.score, ssAM: r11.ssAM},
  g12: {score:r12.score, ssAM: r12.ssAM}
};
fs.writeFileSync(DATA_PATH, JSON.stringify(state, null, 2), 'utf-8');

// ===== Summary =====
console.log('\n=== 最终汇总 ===');
console.log('| G10 | Score=' + r10.score + ' | SS_am=' + r10.ssAM + ' |');
console.log('| G11 | Score=' + r11.score + ' | SS_am=' + r11.ssAM + ' |');
console.log('| G12 | Score=' + r12.score + ' | SS_am=' + r12.ssAM + ' |');
console.log('\n✅ 已写入 ' + DATA_PATH);
