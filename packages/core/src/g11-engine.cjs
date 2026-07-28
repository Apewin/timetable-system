/**
 * 高二排课引擎 - 支持分层教学+AP选修
 */
const fs = require('fs');

class G11Engine {
  constructor(rulesPath, dataPath) {
    this.rules = JSON.parse(fs.readFileSync(rulesPath, 'utf-8'));
    this.data = JSON.parse(fs.readFileSync(dataPath, 'utf-8'));
    this.students = this.data.students.filter(s => s.grade === 11);
    this.ac3 = this.students.filter(s => s.admin_class_id === 'AC3');
    this.ac4 = this.students.filter(s => s.admin_class_id === 'AC4');
    this.tc1 = this.students.filter(s => s.teaching_class_id === 'TC_G11_1');
    this.tc2 = this.students.filter(s => s.teaching_class_id === 'TC_G11_2');
    this.tc3 = this.students.filter(s => s.teaching_class_id === 'TC_G11_3');
    this.tcS = [this.tc1, this.tc2, this.tc3];
    this.tcI = ['TC_G11_1', 'TC_G11_2', 'TC_G11_3'];
    this.tcR = ['R5', 'R6', 'R6'];
  }

  getRule(id) { return this.rules.rules.find(r => r.id === id); }

  _add(stu, cid, sid, cls, ctype, room, tid, A) {
    stu.forEach(s => A.push({ task_id: cls + '_' + cid + '_' + s.id, slot_id: sid, room_id: room, course_id: cid, class_id: cls, class_type: ctype, teacher_id: tid, student_id: s.id }));
  }

  generateInitial() {
    const A = [];
    // === Fixed: DUTY(D1P10), MEETING(D1P9), CLUB(D2P10,D5P10) ===
    this._add(this.ac3, 'DUTY', 'D1P10', 'AC3', 'admin', 'R5', null, A);
    this._add(this.ac4, 'DUTY', 'D1P10', 'AC4', 'admin', 'R6', null, A);
    // Process fixed-slot rules (only MEETING and CLUB; DUTY handled explicitly above)
    this.rules.rules.filter(r => (r.fixed_slot || r.fixed_slots) && (r.course === 'MEETING' || r.course === 'CLUB')).forEach(r => {
      (r.fixed_slot ? [r.fixed_slot] : r.fixed_slots).forEach(s => {
        this._add(this.ac3, r.course, s, 'AC3', 'admin', 'R5', null, A);
        this._add(this.ac4, r.course, s, 'AC4', 'admin', 'R6', null, A);
      });
    });

    // Admin pairs: 14 pairs (2 pairs per day, 1 course to each AC per pair)
    // AC3 needs: MATH_CN×2,CHIN×2,POL×2,PE×2,IT×1,GUIDANCE×2,SELF_STUDY×2,DUTY×1 = 14
    // AC4 needs: same 14 (mirrored)
    // Admin pairs: 13 pairs × 2 ACs = 26 course slots. Per Excel: M(2),C(2),P(2),G(2),PE(2),IT(1),SS(2)=13 per AC
    const adminPairs = [
      {s:'D1P2',a3:'MATH_CN',a4:'CHIN'},{s:'D1P3',a3:'CHIN',a4:'MATH_CN'},
      {s:'D1P4',a3:'POL',a4:'GUIDANCE'},
      {s:'D2P2',a3:'GUIDANCE',a4:'POL'},{s:'D2P3',a3:'PE',a4:'IT'},
      {s:'D2P4',a3:'IT',a4:'PE'},
      {s:'D3P2',a3:'MATH_CN',a4:'CHIN'},{s:'D3P3',a3:'CHIN',a4:'MATH_CN'},
      {s:'D3P4',a3:'POL',a4:'GUIDANCE'},
      {s:'D4P2',a3:'GUIDANCE',a4:'POL'},{s:'D4P3',a3:'PE',a4:'ADMIN_SS'},
      {s:'D5P2',a3:'ADMIN_SS',a4:'PE'},{s:'D5P3',a3:'ADMIN_SS',a4:'ADMIN_SS'},
    ];
    const adminT = { MATH_CN:'T_EXP_E',CHIN:'T_EXP_F',POL:'T_EXP_G',IT:'T_EXP_J',GUIDANCE:'T_GUIDANCE',PE:'T_EXP_H1',ADMIN_SS:null };
    adminPairs.forEach(p => {
      const t3 = p.a3==='PE'?'T_EXP_H1':adminT[p.a3];
      const t4 = p.a4==='PE'?'T_EXP_H2':adminT[p.a4];
      this._add(this.ac3,p.a3,p.s,'AC3','admin','R5',t3,A);
      this._add(this.ac4,p.a4,p.s,'AC4','admin','R6',t4,A);
    });

    // === AP Sectioning + Assignment FIRST (batch, before teaching) ===
    const apCourses = {
      AP_PHYS2:{teacher:'T_ZHANGZUOPING',sections:2},
      AP_CHEM:{teacher:'T_YANGHONGXU',sections:2},
      AP_BIO:{teacher:'T_FANZHENGWEI',sections:2},
      AP_CS:{teacher:'T_SUNHUA',sections:2},
      AP_PSYCH:{teacher:'T_FUXIAOMENG',sections:2},
      AP_ENVSCI:{teacher:'T_ZHUJIE',sections:2},
      AP_MACRO:{teacher:'T_QINXINXUAN',sections:2},
      AP_ARTHIST:{teacher:'T_ZHANGHUIHUI',sections:2},
      AP_MICRO:{teacher:'T_GLENN',sections:2},
    };

    Object.entries(apCourses).forEach(([cid, cfg]) => {
      const students = this.students.filter(s => (s.ap_courses||[]).includes(cid));
      if (!students.length) return;
      const nS = cfg.sections, perS = Math.ceil(students.length / nS);
      const sections = [];
      for (let i = 0; i < nS; i++) sections.push(students.slice(i * perS, (i + 1) * perS));

      sections.forEach((secStu, secIdx) => {
        let assigned = 0;
        // Pass 1: empty slots (all section students free + teacher free)
        for (let d = 1; d <= 5 && assigned < 5; d++) {
          for (const p of [1,2,3,4,5,8,9,10,6,7]) {
            if (assigned >= 5) break; const sid = 'D'+d+'P'+p;
            if (A.some(x => x.teacher_id === cfg.teacher && x.slot_id === sid)) continue;
            if (secStu.some(s => A.some(x => x.student_id===s.id && x.slot_id===sid))) continue;
            this._add(secStu, cid, sid, cid+'_S'+(secIdx+1), 'ap', 'R8', cfg.teacher, A);
            assigned++; break;
          }
        }
        // Pass 2: clear ALL entries for ALL section students at a slot, add AP
        for (let d = 1; d <= 5 && assigned < 5; d++) {
          for (const p of [1,2,3,4,5,8,9,10,6,7]) {
            if (assigned >= 5) break; const sid = 'D'+d+'P'+p;
            if (A.some(x => x.teacher_id === cfg.teacher && x.slot_id === sid)) continue;
            // Clear ALL entries at this slot for ALL section students (if any)
            secStu.forEach(s => { const i = A.findIndex(x => x.student_id===s.id && x.slot_id===sid); if (i>=0) A.splice(i,1); });
            // Add AP for all section students
            this._add(secStu, cid, sid, cid+'_S'+(secIdx+1), 'ap', 'R8', cfg.teacher, A);
            assigned++; break;
          }
        }
      });
    });

    // === Teaching: Common courses (all 3 TCs) ===
    const commonCourses = [
      ['ENG_COMP',4,'T_YULIN'],['AP_CALC_BC',5,'T_WANGLILI'],
      ['PRE_AP_LIT',2,'T_RACHEL'],['PHYS_CN',2,'T_BAIRUSHUANG']
    ];
    const layeredCourses = {
      tc12: [['HONOR_LC',2,'T_LUKE'],['TOEFL',3,'T_WEIWEI']],
      tc3: [['AP_LC',5,'T_HANPENG']]
    };

    const assignCourses = (stu, courses, tcId, room, ti) => {
      courses.forEach(([cid, hrs, tid]) => {
        let as = 0;
        // TC stagger for courses taught to all TCs by same teacher
        const tcStagger = cid === 'AP_CALC_BC' ? ti * 2 : 0;
        for (let d = 1; d <= 5 && as < Math.min(hrs, 5); d++) {
          const periods = [1,2,3,4,5,8,9,10,6,7];
          const p = periods[(as + tcStagger) % periods.length];
          const sid = 'D' + d + 'P' + p;
          if (stu.some(s => A.some(x => x.student_id === s.id && x.slot_id === sid))) continue;
          if (tid && A.some(x => x.teacher_id === tid && x.slot_id === sid)) continue;
          this._add(stu, cid, sid, tcId, 'teaching', room, tid, A); as++;
        }
        for (let d = 1; d <= 5 && as < hrs; d++) for (const p of [1,2,3,4,5,8,9,10,6,7]) {
          if (as >= hrs) break; const sid = 'D' + d + 'P' + p;
          if (stu.some(s => A.some(x => x.student_id === s.id && x.slot_id === sid))) continue;
          if (tid && A.some(x => x.teacher_id === tid && x.slot_id === sid)) continue;
          this._add(stu, cid, sid, tcId, 'teaching', room, tid, A); as++; break;
        }
      });
    };

    // TC1 & TC2: common + layered(tc12)
    [this.tc1, this.tc2].forEach((stu, i) => {
      const tcId = i === 0 ? 'TC_G11_1' : 'TC_G11_2';
      assignCourses(stu, [...commonCourses, ...layeredCourses.tc12], tcId, 'R5', i);
    });
    // TC3: common + layered(tc3)
    assignCourses(this.tc3, [...commonCourses, ...layeredCourses.tc3], 'TC_G11_3', 'R6', 2);

    // Re-fill after AP stealing
    this.students.forEach(stu => {
      const daily = [0,0,0,0,0], occ = new Set();
      A.filter(a => a.student_id === stu.id).forEach(a => { daily[a.slot_id.charAt(1)-1]++; occ.add(a.slot_id); });
      const room = stu.admin_class_id === 'AC3' ? 'R5' : 'R6';
      for (let d = 1; d <= 5; d++) while (daily[d-1] < 10) { let f = false;
        for (const p of [10,9,8,7,6]) { const sid = 'D'+d+'P'+p; if (!occ.has(sid)) { A.push({ task_id: 'refill_'+stu.id+'_'+sid, slot_id: sid, room_id: room, course_id: 'SELF_STUDY', class_id: stu.id, class_type: 'filler', teacher_id: null, student_id: stu.id }); daily[d-1]++; occ.add(sid); f = true; break; } } if (!f) break;
      }
      for (let d = 1; d <= 5; d++) while (daily[d-1] < 10) { let f = false;
        for (const p of [5,4,3,2,1]) { const sid = 'D'+d+'P'+p; if (!occ.has(sid)) { A.push({ task_id: 'refill2_'+stu.id+'_'+sid, slot_id: sid, room_id: room, course_id: 'SELF_STUDY', class_id: stu.id, class_type: 'filler', teacher_id: null, student_id: stu.id }); daily[d-1]++; occ.add(sid); f = true; break; } } if (!f) break;
      }
    });
    return A;
  }

  evaluate(A) {
    let sc = 0;
    const exp = { ENG_COMP: 4, AP_CALC_BC: 5, PRE_AP_LIT: 2, PHYS_CN: 2, HONOR_LC: 2, TOEFL: 3, AP_LC: 5 };
    // Evaluate: sample 5 students per TC + all students for morning SS
    const evalSample = [];
    this.tcS.forEach(stu => {
      for (let i = 0; i < Math.min(5, stu.length); i++) evalSample.push(stu[Math.floor(i * stu.length / Math.min(5, stu.length))]);
    });
    evalSample.forEach(s => {
      const tcId = s.teaching_class_id;
      const tcExp = {...exp};
      if (tcId === 'TC_G11_3') { delete tcExp.HONOR_LC; delete tcExp.TOEFL; }
      else { delete tcExp.AP_LC; }
      Object.entries(tcExp).forEach(([cid, hrs]) => { sc += Math.abs(A.filter(a => a.student_id === s.id && a.course_id === cid).length - hrs) * 100; });
      const apIds = (s.ap_courses || []).filter(cid => cid !== 'AP_CALC_BC');
      if (apIds.length > 0) { const apTotal = apIds.reduce((sum, cid) => sum + A.filter(a => a.student_id === s.id && a.course_id === cid).length, 0); sc += Math.abs(apTotal - apIds.length * 5) * 100; }
      const daily = [0,0,0,0,0]; A.filter(a => a.student_id === s.id).forEach(a => daily[a.slot_id.charAt(1)-1]++);
      if (daily.some(d => d !== 10)) sc += 1000;
      const seen = new Set(); A.filter(a => a.student_id === s.id).forEach(a => { if (seen.has(a.slot_id)) sc += 500; seen.add(a.slot_id); });
      Object.entries(tcExp).forEach(([cid, hrs]) => { if (hrs > 5) return; const d = [0,0,0,0,0]; A.filter(a => a.student_id === s.id && a.course_id === cid).forEach(a => d[a.slot_id.charAt(1)-1]++); d.forEach(c => { if (c >= 2) sc += 3; }); });
      const ssAM = A.filter(a => a.student_id === s.id && a.course_id === 'SELF_STUDY' && parseInt(a.slot_id.substring(3)) <= 5).length;
      if (ssAM > 0) sc += ssAM * 5000;
    });
    // Admin pairing
    let pi = 0; const s1 = this.ac3[0], s2 = this.ac4[0];
    for (let d = 1; d <= 5; d++) for (let p = 1; p <= 10; p++) {
      const sid = 'D' + d + 'P' + p;
      if (A.some(a => a.student_id === s1.id && a.slot_id === sid && a.class_type === 'admin') !== A.some(a => a.student_id === s2.id && a.slot_id === sid && a.class_type === 'admin')) pi++;
    }
    sc += pi * 100;
    return sc;
  }

  anneal(initial, iterations = 5000) {
    const cur = initial.map(a => ({...a}));
    let curScore = this.evaluate(cur);
    let best = cur.map(a => ({...a})), bestScore = curScore;
    let temp = 200;
    for (let iter = 0; iter < iterations && temp > 0.05; iter++) {
      const stu = this.students[Math.floor(Math.random() * this.students.length)];
      const stuAs = cur.filter(a => a.student_id === stu.id && a.class_type !== 'admin');
      if (stuAs.length < 2) continue;
      const [i, j] = [Math.floor(Math.random() * stuAs.length), Math.floor(Math.random() * stuAs.length)];
      if (i === j) continue; const a1 = stuAs[i], a2 = stuAs[j];
      if (a1.slot_id === a2.slot_id) continue;
      const [t1, t2, o1, o2] = [a1.teacher_id, a2.teacher_id, a1.slot_id, a2.slot_id];
      let ok = true;
      for (const a of cur) if (a.student_id !== stu.id && ((a.slot_id === o2 && a.teacher_id === t1) || (a.slot_id === o1 && a.teacher_id === t2))) { ok = false; break; }
      if (!ok) continue;
      // Apply swap
      cur.forEach(a => { if (a.student_id === stu.id) { if (a.slot_id === o1) a.slot_id = o2; else if (a.slot_id === o2) a.slot_id = o1; } });
      const newScore = this.evaluate(cur);
      if (newScore < curScore || Math.random() < Math.exp(-(newScore - curScore) / temp)) {
        curScore = newScore; if (newScore < bestScore) { best = cur.map(a => ({...a})); bestScore = newScore; }
      } else {
        cur.forEach(a => { if (a.student_id === stu.id) { if (a.slot_id === o2) a.slot_id = o1; else if (a.slot_id === o1) a.slot_id = o2; } });
      }
      temp *= 0.9995;
    }
    return { assignments: best, score: bestScore };
  }
}

module.exports = { G11Engine };
