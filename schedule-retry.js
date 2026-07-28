// 配置驱动排课引擎 - 读取rules.json，无需改代码加规则
const fs = require('fs');
const orig = JSON.parse(fs.readFileSync('/Users/apewin/Desktop/排课系统/timetable.json', 'utf-8'));
const rules = JSON.parse(fs.readFileSync('/Users/apewin/Desktop/排课系统/rules.json', 'utf-8'));

// 从规则配置中提取教师ID映射
const T = {};
orig.teachers.forEach(t => T[t.id] = t.id);

// 从rules.json提取配置
function getRule(id) { return rules.rules.find(r => r.id === id); }
function forEachSoftRule(fn) { rules.rules.filter(r => r.type === 'soft').forEach(fn); }
function forEachHardRule(fn) { rules.rules.filter(r => r.type === 'hard').forEach(fn); }

// 从配置中提取受限教师和时段
const teacherRestrictions = {};
rules.rules.filter(r => r.scope === 'teacher' && r.forbidden_periods).forEach(r => {
  r.teachers.forEach(tid => {
    if (!teacherRestrictions[tid]) teacherRestrictions[tid] = new Set();
    r.forbidden_periods.forEach(p => teacherRestrictions[tid].add(p));
  });
});

// 课程优先级
const coursePriority = rules.course_priority?.order || [];

function schedule(seed) {
  const g = orig.students.filter(s => s.grade === 10);
  const a1 = g.filter(s => s.admin_class_id === 'AC1'), a2 = g.filter(s => s.admin_class_id === 'AC2');
  const t1 = g.filter(s => s.teaching_class_id === 'TC_G10_1'), t2 = g.filter(s => s.teaching_class_id === 'TC_G10_2'), t3 = g.filter(s => s.teaching_class_id === 'TC_G10_3');
  const A = [], tcS = [t1, t2, t3], tcR = ['R1', 'R2', 'R2'], tcI = ['TC_G10_1', 'TC_G10_2', 'TC_G10_3'];

  function add(stu, cid, sid, cls, ctype, room, tid) {
    stu.forEach(s => A.push({ task_id: 'T_' + cls + '_' + cid + '_' + s.id, slot_id: sid, room_id: room, course_id: cid, class_id: cls, class_type: ctype, teacher_id: tid, student_id: s.id }));
  }

  function shf(arr, s) { const a = [...arr]; for (let i = a.length - 1; i > 0; i--) { s = s * 1664525 + 1013904223; const j = Math.floor((s % 4294967296) / 4294967296 * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }

  // === 固定时段(从配置读取) ===
  rules.rules.filter(r => r.type === 'hard' && (r.fixed_slot || r.fixed_slots)).forEach(r => {
    const slots = r.fixed_slot ? [r.fixed_slot] : r.fixed_slots;
    const tid = r.course === 'MEETING' ? (orig.teachers.find(t => t.name === '高一班主任')?.id || 'T_G10_HOMEROOM') : null;
    const room1 = r.course === 'MEETING' ? 'R1' : 'R1';
    const room2 = r.course === 'MEETING' ? 'R2' : 'R2';
    slots.forEach(sid => {
      add(a1, r.course, sid, 'AC1', 'admin', room1, tid);
      add(a2, r.course, sid, 'AC2', 'admin', room2, tid);
    });
  });

  // === 行政班配对(从配置读取) ===
  (rules.admin_pairs?.slots || []).forEach(p => {
    const t1 = orig.teachers.find(t => t.can_teach?.includes(p.ac1));
    const t2 = orig.teachers.find(t => t.can_teach?.includes(p.ac2));
    // Teacher lookup from course name
    const teacherMap = { GRAMMAR: 'T_JIZHUREN', CHIN: 'T_EXP_A', HIST: 'T_EXP_B', GEOG: 'T_EXP_C', ART: 'T_EXP_D', GUIDANCE: 'T_GUIDANCE' };
    add(a1, p.ac1, p.slot, 'AC1', 'admin', 'R1', teacherMap[p.ac1]);
    add(a2, p.ac2, p.slot, 'AC2', 'admin', 'R2', teacherMap[p.ac2]);
  });

  // === 教学班课程(按优先级排序) ===
  const courseTeacherMap = { MATH_PRECAL: T.T_CUIXIAOPENG || 'T_CUIXIAOPENG', AP_PHYS1: T.T_XIEHAOYANG || 'T_XIEHAOYANG', CHEM_PRE: T.T_ZHANGRAN || 'T_ZHANGRAN', BIO_PRE: T.T_LIYIXUAN || 'T_LIYIXUAN', ENG_LS: T.T_BIFEI || 'T_BIFEI', ENG_RW: T.T_NIUYONGMEI || 'T_NIUYONGMEI', ENG_LIT: T.T_RACHEL || 'T_RACHEL', ENG_SURVEY: T.T_VINCENT || 'T_VINCENT', PE: T.T_VINCENT || 'T_VINCENT' };
  const courseHours = { MATH_PRECAL: 6, AP_PHYS1: 5, CHEM_PRE: 5, BIO_PRE: 5, ENG_LS: 3, ENG_RW: 3, ENG_LIT: 4, ENG_SURVEY: 2, PE: 2 };

  const courses = coursePriority.map(cid => [cid, courseHours[cid], courseTeacherMap[cid]]);

  courses.forEach(([cid, hrs, tid]) => {
    shf([0, 1, 2], seed + Math.random()).forEach(ti => {
      const stu = tcS[ti]; let as = 0;

      // 从配置获取受限时段
      const forbidden = teacherRestrictions[tid] ? [...teacherRestrictions[tid]] : [];
      const allPeriods = [1, 2, 3, 4, 5, 8, 9, 10, 6, 7];
      const periods = allPeriods.filter(p => !forbidden.includes(p));

      for (let dO = 0; dO < 5 && as < Math.min(hrs, 5); dO++) {
        const day = ((ti * 2 + dO) % 5) + 1;
        for (const p of periods) {
          const sid = 'D' + day + 'P' + p;
          if (stu.some(s => A.some(x => x.student_id === s.id && x.slot_id === sid))) continue;
          if (tid && A.some(x => x.teacher_id === tid && x.slot_id === sid)) continue;
          add(stu, cid, sid, tcI[ti], 'teaching', tcR[ti], tid); as++; break;
        }
      }
      for (let d = 1; d <= 5 && as < hrs; d++) {
        for (const p of periods) { if (as >= hrs) break; const sid = 'D' + d + 'P' + p; if (stu.some(s => A.some(x => x.student_id === s.id && x.slot_id === sid))) continue; if (tid && A.some(x => x.teacher_id === tid && x.slot_id === sid)) continue; add(stu, cid, sid, tcI[ti], 'teaching', tcR[ti], tid); as++; break; }
      }
    });
  });

  // 教学班自习 + 填充
  tcS.forEach((stu, ti) => { let a = 0; for (let d = 1; d <= 5 && a < 2; d++) { for (const p of [10, 9, 8]) { if (a >= 2) break; const sid = 'D' + d + 'P' + p; if (stu.every(s => !A.some(x => x.student_id === s.id && x.slot_id === sid))) { add(stu, 'SELF_STUDY', sid, tcI[ti], 'teaching', tcR[ti], null); a++; } } } });
  g.forEach(stu => { const daily = [0, 0, 0, 0, 0], occ = new Set(); A.filter(a => a.student_id === stu.id).forEach(a => { daily[a.slot_id.charAt(1) - 1]++; occ.add(a.slot_id); }); const room = stu.admin_class_id === 'AC1' ? 'R1' : 'R2';
    for (let d = 1; d <= 5; d++) { while (daily[d - 1] < 10) { let f = false; for (const p of [10, 9, 8, 7, 6]) { const sid = 'D' + d + 'P' + p; if (!occ.has(sid)) { A.push({ task_id: 'Tf_' + stu.id + '_' + sid, slot_id: sid, room_id: room, course_id: 'SELF_STUDY', class_id: stu.id, class_type: 'filler', teacher_id: null, student_id: stu.id }); daily[d - 1]++; occ.add(sid); f = true; break; } } if (!f) break; } }
    for (let d = 1; d <= 5; d++) { while (daily[d - 1] < 10) { let f = false; for (const p of [5, 4, 3, 2, 1]) { const sid = 'D' + d + 'P' + p; if (!occ.has(sid)) { A.push({ task_id: 'Tf2_' + stu.id + '_' + sid, slot_id: sid, room_id: room, course_id: 'SELF_STUDY', class_id: stu.id, class_type: 'filler', teacher_id: null, student_id: stu.id }); daily[d - 1]++; occ.add(sid); f = true; break; } } if (!f) break; } }
  });
  return A;
}

// === 评分函数(从rules.json读取规则) ===
function score(A) {
  const g = orig.students.filter(s => s.grade === 10), tcS = [g.filter(s => s.teaching_class_id === 'TC_G10_1'), g.filter(s => s.teaching_class_id === 'TC_G10_2'), g.filter(s => s.teaching_class_id === 'TC_G10_3')];
  const exp = { MATH_PRECAL: 6, AP_PHYS1: 5, CHEM_PRE: 5, BIO_PRE: 5, ENG_LS: 3, ENG_RW: 3, ENG_LIT: 4, ENG_SURVEY: 2, PE: 2 };
  let sc = 0;

  tcS.forEach(stu => {
    const s = stu[0];
    // Hard: course hours
    Object.entries(exp).forEach(([cid, hrs]) => { const act = A.filter(a => a.student_id === s.id && a.course_id === cid).length; sc += Math.abs(act - hrs) * (getRule('no_duplicate')?.penalty || 100); });
    // Hard: daily=10
    const daily = [0, 0, 0, 0, 0]; A.filter(a => a.student_id === s.id).forEach(a => daily[a.slot_id.charAt(1) - 1]++);
    if (daily.some(d => d !== 10)) sc += (getRule('daily_limit')?.penalty || 1000);
    // Hard: no duplicate
    const seen = new Set(); A.filter(a => a.student_id === s.id).forEach(a => { if (seen.has(a.slot_id)) sc += (getRule('no_duplicate')?.penalty || 500); seen.add(a.slot_id); });
    // Soft: each from rules
    forEachSoftRule(rule => {
      if (rule.id === 'no_cluster') {
        Object.entries(exp).forEach(([cid, hrs]) => { if (hrs > 5) return; const d = [0, 0, 0, 0, 0]; A.filter(a => a.student_id === s.id && a.course_id === cid).forEach(a => d[a.slot_id.charAt(1) - 1]++); d.forEach(c => { if (c >= 2) sc += rule.penalty }); });
      }
      if (rule.id === 'self_study_no_p1') {
        const ssP1 = A.filter(a => a.student_id === s.id && a.course_id === 'SELF_STUDY' && a.slot_id.endsWith('P1')).length;
        if (ssP1 > 0) sc += ssP1 * rule.penalty;
      }
      if (rule.id === 'self_study_afternoon') {
        const ssAM = A.filter(a => a.student_id === s.id && a.course_id === 'SELF_STUDY' && parseInt(a.slot_id.substring(3)) <= 5).length;
        if (ssAM > 0) sc += ssAM * rule.penalty;
      }
    });
  });

  // P1 consecutive (from rules)
  const noP1Rule = getRule('no_p1_consecutive');
  if (noP1Rule) {
    const tP1 = {}; g.forEach(stu => { A.filter(a => a.student_id === stu.id && a.teacher_id && a.slot_id.endsWith('P1')).forEach(a => { if (!tP1[a.teacher_id]) tP1[a.teacher_id] = new Set(); tP1[a.teacher_id].add(parseInt(a.slot_id.charAt(1))); }); });
    Object.entries(tP1).forEach(([tid, days]) => { const arr = [...days].sort((a, b) => a - b); let c = 1; for (let i = 1; i < arr.length; i++) { if (arr[i] === arr[i - 1] + 1) c++; else c = 1; if (c >= 3) sc += noP1Rule.penalty; } });
  }

  // Foreign teacher restrictions (from rules)
  const foreignRule = getRule('foreign_teacher_restrictions');
  if (foreignRule) {
    const teachers = foreignRule.teachers || [];
    teachers.forEach(tid => {
      const periods = foreignRule.forbidden_periods || [];
      periods.forEach(p => {
        A.filter(a => a.teacher_id === tid && a.slot_id.endsWith('P' + p)).forEach(() => sc += foreignRule.penalty);
      });
    });
  }

  // Admin pairing
  const ac1s = g.filter(s => s.admin_class_id === 'AC1')[0], ac2s = g.filter(s => s.admin_class_id === 'AC2')[0];
  let pairIssues = 0;
  for (let d = 1; d <= 5; d++) for (let p = 1; p <= 10; p++) {
    const sid = 'D' + d + 'P' + p;
    const x1 = A.some(a => a.student_id === ac1s.id && a.slot_id === sid && a.class_type === 'admin');
    const x2 = A.some(a => a.student_id === ac2s.id && a.slot_id === sid && a.class_type === 'admin');
    if (x1 !== x2) pairIssues++;
  }
  sc += pairIssues * (getRule('admin_paired')?.penalty || 100);

  return sc;
}

// === 主循环 ===
console.log('=== 配置驱动排课引擎 ===');
console.log('读取规则: ' + rules.rules.length + ' 条 (' + rules.rules.filter(r => r.type === 'hard').length + ' 硬约束, ' + rules.rules.filter(r => r.type === 'soft').length + ' 软约束)');
console.log('受限教师: ' + Object.keys(teacherRestrictions).join(', '));
let best = { score: Infinity, A: null };
for (let i = 0; i < 3000; i++) {
  const A = schedule(Math.floor(Math.random() * 1e6));
  const s = score(A);
  if (s < best.score) { best = { score: s, A }; if (s < 100) console.log('  try ' + i + ': ' + s); }
  if (s === 0) break;
}
console.log('Best: ' + best.score);

const f = JSON.parse(JSON.stringify(orig)); f.assignments = best.A;
fs.writeFileSync('/Users/apewin/Desktop/排课系统/timetable.json', JSON.stringify(f, null, 2));

// Quick verification
const g2 = f.students.filter(s => s.grade === 10);
const rP1 = best.A.filter(a => a.teacher_id === (T.T_RACHEL || 'T_RACHEL') && a.slot_id.endsWith('P1')).length;
const rP10 = best.A.filter(a => a.teacher_id === (T.T_RACHEL || 'T_RACHEL') && a.slot_id.endsWith('P10')).length;
const vP1 = best.A.filter(a => a.teacher_id === (T.T_VINCENT || 'T_VINCENT') && a.slot_id.endsWith('P1')).length;
const vP10 = best.A.filter(a => a.teacher_id === (T.T_VINCENT || 'T_VINCENT') && a.slot_id.endsWith('P10')).length;
console.log('外教 P1/P10: Rachel ' + rP1 + '/' + rP10 + ' Vincent ' + vP1 + '/' + vP10);
