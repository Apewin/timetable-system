/**
 * 排课引擎 v2 - 模拟退火核心
 */
const fs = require('fs');

class SchedulingEngine {
  constructor(rulesPath, dataPath) {
    this.rules = JSON.parse(fs.readFileSync(rulesPath, 'utf-8'));
    this.data = JSON.parse(fs.readFileSync(dataPath, 'utf-8'));
    this.students = this.data.students.filter(s => s.grade === 10);
    this.ac1 = this.students.filter(s => s.admin_class_id === 'AC1');
    this.ac2 = this.students.filter(s => s.admin_class_id === 'AC2');
    this.tc1 = this.students.filter(s => s.teaching_class_id === 'TC_G10_1');
    this.tc2 = this.students.filter(s => s.teaching_class_id === 'TC_G10_2');
    this.tc3 = this.students.filter(s => s.teaching_class_id === 'TC_G10_3');
    this.tcS = [this.tc1, this.tc2, this.tc3];
    this.tcI = ['TC_G10_1', 'TC_G10_2', 'TC_G10_3'];
    this.tcR = ['R1', 'R2', 'R2'];
    this.teacherRestrictions = this._getTeacherRestrictions();
  }

  getRule(id) { return this.rules.rules.find(r => r.id === id); }
  _getTeacherRestrictions() {
    const m = {};
    this.rules.rules.filter(r => r.scope === 'teacher' && r.forbidden_periods).forEach(r => {
      r.teachers.forEach(tid => { if (!m[tid]) m[tid] = new Set(); r.forbidden_periods.forEach(p => m[tid].add(p)); });
    });
    return m;
  }

  _add(stu, cid, sid, cls, ctype, room, tid, A) {
    stu.forEach(s => A.push({ task_id: cls + '_' + cid + '_' + s.id, slot_id: sid, room_id: room, course_id: cid, class_id: cls, class_type: ctype, teacher_id: tid, student_id: s.id }));
  }

  generateInitial() {
    const A = [];
    const courseTeacher = { MATH_PRECAL: 'T_CUIXIAOPENG', AP_PHYS1: 'T_XIEHAOYANG', CHEM_PRE: 'T_ZHANGRAN', BIO_PRE: 'T_LIYIXUAN', ENG_LS: 'T_BIFEI', ENG_RW: 'T_NIUYONGMEI', ENG_LIT: 'T_RACHEL', ENG_SURVEY: 'T_VINCENT', PE: 'T_VINCENT' };
    const courseHrs = { MATH_PRECAL: 6, AP_PHYS1: 5, CHEM_PRE: 5, BIO_PRE: 5, ENG_LS: 3, ENG_RW: 3, ENG_LIT: 4, ENG_SURVEY: 2, PE: 2 };
    const adminT = { GRAMMAR: 'T_JIZHUREN', CHIN: 'T_EXP_A', HIST: 'T_EXP_B', GEOG: 'T_EXP_C', ART: 'T_EXP_D', GUIDANCE: 'T_GUIDANCE' };

    // Fixed slots (filter by grade: only apply rules whose grades include this grade or have no grade restriction)
    const grade = 10;
    this.rules.rules.filter(r => (r.fixed_slot || r.fixed_slots) && (!r.grades || r.grades.includes(grade))).forEach(r => {
      (r.fixed_slot ? [r.fixed_slot] : r.fixed_slots).forEach(s => { this._add(this.ac1, r.course, s, 'AC1', 'admin', 'R1', null, A); this._add(this.ac2, r.course, s, 'AC2', 'admin', 'R2', null, A); });
    });

    // Admin pairs
    (this.rules.admin_pairs?.slots || []).forEach(p => {
      // Remap to P2-P5 (morning) so afternoon is free for self-study
      const origSlot = p.slot, origP = parseInt(origSlot.substring(3));
      const newP = origP <= 5 ? origP : origP - 4; // remap P6-P10 → P2-P6
      const slot = origSlot.substring(0, 2) + 'P' + newP;
      this._add(this.ac1, p.ac1, slot, 'AC1', 'admin', 'R1', adminT[p.ac1], A);
      this._add(this.ac2, p.ac2, slot, 'AC2', 'admin', 'R2', adminT[p.ac2], A);
    });

    // Teaching — use DistributedPlacer for constraint-aware placement
    const { DistributedPlacer } = require('./solver/distributed-placer.cjs');
    for (let ti = 0; ti < 3; ti++) {
      const stu = this.tcS[ti], tcId = this.tcI[ti], room = this.tcR[ti];
      // Build blocked slots from admin entries for all TC students
      const blocked = new Set();
      stu.forEach(s => { A.filter(a => a.student_id === s.id && a.class_type === 'admin').forEach(a => blocked.add(a.slot_id)); });

      const courses = Object.entries(courseHrs).map(([cid, hrs]) => [cid, hrs, courseTeacher[cid]]);
      DistributedPlacer.place(courses, blocked,
        (sid) => !stu.some(s => A.some(x => x.student_id === s.id && x.slot_id === sid)),
        (cid, sid) => { this._add(stu, cid, sid, tcId, 'teaching', room, courseTeacher[cid], A); }
      );
    }

    // Guarantee: all courses have exact hours (overwrite self-study if needed)
    this.tcS.forEach((stu, ti) => {
      const s = stu[0];
      Object.entries(courseHrs).forEach(([cid, hrs]) => {
        const tid = courseTeacher[cid];
        const fb = this.teacherRestrictions[tid] ? [...this.teacherRestrictions[tid]] : [];
        const periods = [1, 2, 3, 4, 5, 8, 9, 10, 6, 7].filter(p => !fb.includes(p));

        while (A.filter(a => a.student_id === s.id && a.course_id === cid).length < hrs) {
          let assigned = false;
          // Try empty slots first
          for (let d = 1; d <= 5 && !assigned; d++) {
            for (const p of periods) {
              if (!assigned) {
                const sid = 'D' + d + 'P' + p;
                if (stu.some(x => A.some(y => y.student_id === x.id && y.slot_id === sid))) continue;
                if (tid && A.some(x => x.teacher_id === tid && x.slot_id === sid)) continue;
                this._add(stu, cid, sid, this.tcI[ti], 'teaching', this.tcR[ti], tid, A);
                assigned = true;
              }
            }
          }
          // If no empty slot, steal from self-study (not admin, not this course)
          if (!assigned) {
            for (let d = 1; d <= 5 && !assigned; d++) {
              for (const p of periods) {
                if (!assigned) {
                  const sid = 'D' + d + 'P' + p;
                  const existing = A.find(x => stu.some(y => y.id === x.student_id) && x.slot_id === sid && x.course_id === 'SELF_STUDY' && x.class_type !== 'admin');
                  if (!existing) continue;
                  if (tid && A.some(x => x.teacher_id === tid && x.slot_id === sid && !stu.some(y => y.id === x.student_id))) continue;
                  // Remove self-study, add course
                  stu.forEach(y => { const idx = A.findIndex(a => a.student_id === y.id && a.slot_id === sid); if (idx >= 0) A.splice(idx, 1); });
                  this._add(stu, cid, sid, this.tcI[ti], 'teaching', this.tcR[ti], tid, A);
                  assigned = true;
                }
              }
            }
          }
          if (!assigned) break; // truly can't fix
        }
      });
    });

    // SS + fill
    // Teaching self-study: P10 first, then P9, P8
    this.tcS.forEach((stu, ti) => {
      let a = 0;
      for (const p of [10, 9, 8]) { for (let d = 1; d <= 5 && a < 2; d++) { if (a >= 2) break; const sid = 'D' + d + 'P' + p; if (stu.every(s => !A.some(x => x.student_id === s.id && x.slot_id === sid))) { this._add(stu, 'SELF_STUDY', sid, this.tcI[ti], 'teaching', this.tcR[ti], null, A); a++; } } }
    });
    this.students.forEach(stu => {
      const daily = [0, 0, 0, 0, 0], occ = new Set(); A.filter(a => a.student_id === stu.id).forEach(a => { daily[a.slot_id.charAt(1) - 1]++; occ.add(a.slot_id); });
      const room = stu.admin_class_id === 'AC1' ? 'R1' : 'R2';
      for (let d = 1; d <= 5; d++) while (daily[d - 1] < 10) { let f = false; for (const p of [10, 9, 8, 7, 6]) { const sid = 'D' + d + 'P' + p; if (!occ.has(sid)) { A.push({ task_id: 'fill_' + stu.id + '_' + sid, slot_id: sid, room_id: room, course_id: 'SELF_STUDY', class_id: stu.id, class_type: 'filler', teacher_id: null, student_id: stu.id }); daily[d - 1]++; occ.add(sid); f = true; break; } } if (!f) break; }
      for (let d = 1; d <= 5; d++) while (daily[d - 1] < 10) { let f = false; for (const p of [5, 4, 3, 2, 1]) { const sid = 'D' + d + 'P' + p; if (!occ.has(sid)) { A.push({ task_id: 'fill2_' + stu.id + '_' + sid, slot_id: sid, room_id: room, course_id: 'SELF_STUDY', class_id: stu.id, class_type: 'filler', teacher_id: null, student_id: stu.id }); daily[d - 1]++; occ.add(sid); f = true; break; } } if (!f) break; }
    });
    // === 课时强制修正 (确保完全符合Excel) ===
    const { CourseCorrector } = require('./solver/course-corrector.cjs');
    const _alloc = (stu, cid, sid, room, tid, ctype) => {
      stu.forEach(s => A.push({ task_id: (ctype||'fix') + '_' + cid + '_' + s.id, slot_id: sid, room_id: room, course_id: cid, class_id: s.id, class_type: ctype||'fix', teacher_id: tid, student_id: s.id }));
    };
    const _getRoom = (stu) => stu.admin_class_id === 'AC1' ? 'R1' : 'R2';
    const g10Courses = {
      ENG_LS:{hrs:3,teacher:'T_BIFEI'},ENG_RW:{hrs:3,teacher:'T_NIUYONGMEI'},
      ENG_LIT:{hrs:4,teacher:'T_RACHEL'},ENG_SURVEY:{hrs:2,teacher:'T_VINCENT'},
      MATH_PRECAL:{hrs:6,teacher:'T_CUIXIAOPENG'},AP_PHYS1:{hrs:5,teacher:'T_XIEHAOYANG'},
      CHEM_PRE:{hrs:5,teacher:'T_ZHANGRAN'},BIO_PRE:{hrs:5,teacher:'T_LIYIXUAN'},
      PE:{hrs:2,teacher:'T_VINCENT'},SELF_STUDY:{hrs:2,teacher:null},
      GRAMMAR:{hrs:2,teacher:'T_JIZHUREN'},CHIN:{hrs:2,teacher:'T_EXP_A'},
      HIST:{hrs:2,teacher:'T_EXP_B'},GEOG:{hrs:2,teacher:'T_EXP_C'},
      ART:{hrs:1,teacher:'T_EXP_D'},GUIDANCE:{hrs:1,teacher:'T_GUIDANCE'},
      MEETING:{hrs:1,teacher:null},CLUB:{hrs:2,teacher:null},
    };
    const cr10 = CourseCorrector.enforce(A, this.students, g10Courses, _alloc, _getRoom);
    if (cr10.remaining > 0) {
      // Fallback: remove ALL self-study and re-add teaching courses
      this.students.forEach(stu => {
        const toRemove = [];
        A.forEach((a, i) => { if (a.student_id === stu.id && a.course_id === 'SELF_STUDY' && a.class_type !== 'admin') toRemove.push(i); });
        toRemove.sort((a,b) => b-a).forEach(i => A.splice(i, 1));
      });
      CourseCorrector.enforce(A, this.students, g10Courses, _alloc, _getRoom);
    }
    return A;
  }

  // 模拟退火优化
  anneal(initial, iterations = 100000) {
    const cur = initial.map(a => ({ ...a }));
    let curScore = this.evaluate(cur);
    let best = cur.map(a => ({ ...a })), bestScore = curScore;
    let temp = 200;

    for (let iter = 0; iter < iterations && temp > 0.05; iter++) {
      // Pick random student, swap two of their teaching courses
      const stu = this.students[Math.floor(Math.random() * this.students.length)];
      const stuAs = cur.filter(a => a.student_id === stu.id && (a.class_type === 'teaching' || a.class_type === 'filler'));
      if (stuAs.length < 2) continue;

      const [i, j] = [Math.floor(Math.random() * stuAs.length), Math.floor(Math.random() * stuAs.length)];
      if (i === j) continue;
      const a1 = stuAs[i], a2 = stuAs[j];
      if (a1.slot_id === a2.slot_id) continue;

      // Check teacher conflict
      const [tid1, tid2, old1, old2] = [a1.teacher_id, a2.teacher_id, a1.slot_id, a2.slot_id];
      let ok = true;
      for (const a of cur) if (a.student_id !== stu.id && ((a.slot_id === old2 && a.teacher_id === tid1) || (a.slot_id === old1 && a.teacher_id === tid2))) { ok = false; break; }
      if (!ok) continue;

      // Apply swap to entire TC
      const tcId = a1.class_id;
      if (!tcId?.startsWith('TC_')) continue;
      const tcStu = this.students.filter(s => s.teaching_class_id === tcId);
      tcStu.forEach(s => cur.forEach(a => { if (a.student_id === s.id) { if (a.slot_id === old1) a.slot_id = old2; else if (a.slot_id === old2) a.slot_id = old1; } }));

      const newScore = this.evaluate(cur);
      if (newScore < curScore || Math.random() < Math.exp(-(newScore - curScore) / temp)) {
        curScore = newScore;
        if (newScore < bestScore) { best = cur.map(a => ({ ...a })); bestScore = newScore; }
      } else {
        tcStu.forEach(s => cur.forEach(a => { if (a.student_id === s.id) { if (a.slot_id === old2) a.slot_id = old1; else if (a.slot_id === old1) a.slot_id = old2; } }));
      }
      temp *= 0.9995;
    }
    return { assignments: best, score: bestScore };
  }

  evaluate(A) {
    let sc = 0;
    const exp = { MATH_PRECAL: 6, AP_PHYS1: 5, CHEM_PRE: 5, BIO_PRE: 5, ENG_LS: 3, ENG_RW: 3, ENG_LIT: 4, ENG_SURVEY: 2, PE: 2 };
    // Check all TC students for course hours + morning SS (sample 5 per TC for speed)
    this.tcS.forEach(stu => {
      const sample = stu.length <= 5 ? stu : [0,1,2,3,4].map(i => stu[Math.floor(i * stu.length / 5)]);
      sample.forEach(s => {
        Object.entries(exp).forEach(([cid, hrs]) => { sc += Math.abs(A.filter(a => a.student_id === s.id && a.course_id === cid).length - hrs) * 100; });
        const daily = [0, 0, 0, 0, 0]; A.filter(a => a.student_id === s.id).forEach(a => daily[a.slot_id.charAt(1) - 1]++);
        if (daily.some(d => d !== 10)) sc += 1000;
        const seen = new Set(); A.filter(a => a.student_id === s.id).forEach(a => { if (seen.has(a.slot_id)) sc += 500; seen.add(a.slot_id); });
        // Distribution penalty: ≤5hr max 1/day; >5hr max 2/day consecutive
        [...Object.entries(exp),['SELF_STUDY',2]].forEach(([cid, hrs]) => {
          const byDay = [0,0,0,0,0,0]; const periods = [[],[],[],[],[],[]];
          A.filter(a => a.student_id === s.id && a.course_id === cid).forEach(a => { const d=parseInt(a.slot_id.charAt(1)); byDay[d]++; periods[d].push(parseInt(a.slot_id.substring(3))); });
          for(let d=1;d<=5;d++){
            if(hrs<=5 && byDay[d]>=2) sc += 5000; // ≤5hr: max 1/day
            if(byDay[d]>=3) sc += 10000; // never 3+ on same day
            if(hrs>5 && byDay[d]===2){ const ps=periods[d].sort((a,b)=>a-b); if(Math.abs(ps[1]-ps[0])!==1) sc += 5000; } // >5hr: must be consecutive
          }
        });
        const ssAM = A.filter(a => a.student_id === s.id && a.course_id === 'SELF_STUDY' && parseInt(a.slot_id.substring(3)) <= 5).length;
        if (ssAM > 0) sc += ssAM * (this.getRule('no_self_study_morning')?.penalty || 1000);
      });
    });
    const tP1 = {}; this.students.forEach(stu => { A.filter(a => a.student_id === stu.id && a.teacher_id && a.slot_id.endsWith('P1')).forEach(a => { if (!tP1[a.teacher_id]) tP1[a.teacher_id] = new Set(); tP1[a.teacher_id].add(parseInt(a.slot_id.charAt(1))); }); });
    Object.entries(tP1).forEach(([tid, days]) => { const arr = [...days].sort((a, b) => a - b); let c = 1; for (let i = 1; i < arr.length; i++) { if (arr[i] === arr[i - 1] + 1) c++; else c = 1; if (c >= 3) sc += (this.getRule('no_p1_consecutive')?.penalty || 30); } });
    const fr = this.getRule('foreign_teacher_restrictions');
    if (fr) fr.teachers.forEach(tid => { fr.forbidden_periods.forEach(p => { A.filter(a => a.teacher_id === tid && a.slot_id.endsWith('P' + p)).forEach(() => sc += fr.penalty); }); });
    const s1 = this.ac1[0], s2 = this.ac2[0]; let pi = 0;
    for (let d = 1; d <= 5; d++) for (let p = 1; p <= 10; p++) {
      const sid = 'D' + d + 'P' + p;
      if (A.some(a => a.student_id === s1.id && a.slot_id === sid && a.class_type === 'admin') !== A.some(a => a.student_id === s2.id && a.slot_id === sid && a.class_type === 'admin')) pi++;
    }
    sc += pi * (this.getRule('admin_paired')?.penalty || 100);
    return sc;
  }
}

module.exports = { SchedulingEngine };
