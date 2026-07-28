/**
 * 高三排课引擎 - 必修+必修选修+AP选修，跨年级教师冲突
 */
const fs = require('fs');

class G12Engine {
  constructor(rulesPath, dataPath) {
    this.rules = JSON.parse(fs.readFileSync(rulesPath, 'utf-8'));
    this.data = JSON.parse(fs.readFileSync(dataPath, 'utf-8'));
    this.students = this.data.students.filter(s => s.grade === 12);
    this.ac5 = this.students.filter(s => s.admin_class_id === 'AC5');
    this.ac6 = this.students.filter(s => s.admin_class_id === 'AC6');
    this.tc1 = this.students.filter(s => s.teaching_class_id === 'TC_G12_1');
    this.tc2 = this.students.filter(s => s.teaching_class_id === 'TC_G12_2');
    this.tc3 = this.students.filter(s => s.teaching_class_id === 'TC_G12_3');
    this.tcS = [this.tc1, this.tc2, this.tc3];
    this.tcI = ['TC_G12_1', 'TC_G12_2', 'TC_G12_3'];
    this.tcR = ['R9', 'R10', 'R10'];
    // Global teacher schedule (from all grades)
    this.globalTeacher = {};
    const allAs = this.data.assignments || [];
    allAs.forEach(a => { if (a.teacher_id) { if (!this.globalTeacher[a.teacher_id]) this.globalTeacher[a.teacher_id] = new Set(); this.globalTeacher[a.teacher_id].add(a.slot_id); } });
  }

  _add(stu, cid, sid, cls, ctype, room, tid, A) {
    stu.forEach(s => A.push({ task_id: cls + '_' + cid + '_' + s.id, slot_id: sid, room_id: room, course_id: cid, class_id: cls, class_type: ctype, teacher_id: tid, student_id: s.id }));
  }

  teacherBusy(tid, sid) { return this.globalTeacher[tid]?.has(sid) || false; }

  generateInitial() {
    const A = [];

    // === Fixed: DUTY, MEETING, CLUB ===
    this._add(this.ac5, 'DUTY', 'D1P10', 'AC5', 'admin', 'R9', null, A);
    this._add(this.ac6, 'DUTY', 'D1P10', 'AC6', 'admin', 'R10', null, A);
    this._add(this.ac5, 'MEETING', 'D1P9', 'AC5', 'admin', 'R9', null, A);
    this._add(this.ac6, 'MEETING', 'D1P9', 'AC6', 'admin', 'R10', null, A);
    this._add(this.ac5, 'CLUB', 'D2P10', 'AC5', 'admin', 'R9', null, A);
    this._add(this.ac6, 'CLUB', 'D2P10', 'AC6', 'admin', 'R10', null, A);
    this._add(this.ac5, 'CLUB', 'D5P10', 'AC5', 'admin', 'R9', null, A);
    this._add(this.ac6, 'CLUB', 'D5P10', 'AC6', 'admin', 'R10', null, A);

    // Admin pairs moved to P2-P4 (morning) to free afternoon for self-study
    const adminPairs = [
      {s:'D1P2',a5:'CHIN',a6:'PE'},{s:'D1P3',a5:'PE',a6:'CHIN'},
      {s:'D2P2',a5:'CHIN',a6:'PE'},{s:'D2P3',a5:'PE',a6:'CHIN'},
    ];
    adminPairs.forEach(p => {
      const t5 = p.a5 === 'CHIN' ? 'T_EXP_K' : p.a5 === 'PE' ? 'T_EXP_L' : null;
      const t6 = p.a6 === 'CHIN' ? 'T_EXP_K' : p.a6 === 'PE' ? 'T_EXP_L' : null;
      this._add(this.ac5, p.a5, p.s, 'AC5', 'admin', 'R9', t5, A);
      this._add(this.ac6, p.a6, p.s, 'AC6', 'admin', 'R10', t6, A);
    });

    // === Teaching courses (16 periods per TC) ===
    const tcCourses = [
      ['AP_STAT',5,'T_JAIME'],['ENG_CW',5,'T_LUKE'],
      ['COLLEGE_APP',4,null],['SELF_STUDY',2,null]
    ];
    this.tcS.forEach((stu, ti) => {
      tcCourses.forEach(([cid, hrs, tid]) => {
        let as = 0;
        for (let d = 1; d <= 5 && as < Math.min(hrs, 5); d++) for (const p of [1,2,3,4,5,8,9,10,6,7]) {
          if (as >= hrs) break; const sid = 'D' + d + 'P' + p;
          if (stu.some(s => A.some(x => x.student_id === s.id && x.slot_id === sid))) continue;
          if (tid && (A.some(x => x.teacher_id === tid && x.slot_id === sid) || this.teacherBusy(tid, sid))) continue;
          this._add(stu, cid, sid, this.tcI[ti], 'teaching', this.tcR[ti], tid, A); as++; break;
        }
        for (let d = 1; d <= 5 && as < hrs; d++) for (const p of [1,2,3,4,5,8,9,10,6,7]) {
          if (as >= hrs) break; const sid = 'D' + d + 'P' + p;
          if (stu.some(s => A.some(x => x.student_id === s.id && x.slot_id === sid))) continue;
          if (tid && (A.some(x => x.teacher_id === tid && x.slot_id === sid) || this.teacherBusy(tid, sid))) continue;
          this._add(stu, cid, sid, this.tcI[ti], 'teaching', this.tcR[ti], tid, A); as++; break;
        }
      });
    });

    // === AP electives (BATCH sections, before personal electives) ===
    const apConfig = {
      AP_PHYSC:{teacher:'T_BAIRUSHUANG',sections:2},AP_CHEM:{teacher:'T_YANGHONGXU',sections:2},
      AP_BIO:{teacher:'T_FANZHENGWEI',sections:2},AP_CS:{teacher:'T_SUNHUA',sections:2},
      AP_ENVSCI:{teacher:'T_ZHUJIE',sections:2},AP_PSYCH:{teacher:'T_XINLI',sections:2},
      AP_ARTHIST:{teacher:'T_ZHANGHUIHUI',sections:2},AP_MACRO:{teacher:'T_YUYUANYING',sections:2}
    };
    Object.entries(apConfig).forEach(([cid, cfg]) => {
      const students = this.students.filter(s => (s.ap_courses || []).includes(cid));
      if (!students.length) return;
      const nS = cfg.sections, perS = Math.ceil(students.length / nS);
      const sections = []; for (let i = 0; i < nS; i++) sections.push(students.slice(i * perS, (i + 1) * perS));
      sections.forEach((secStu, secIdx) => {
        let as = 0;
        // Pass 1: all section students free + teacher not busy
        for (let d = 1; d <= 5 && as < 5; d++) for (const p of [1,2,3,4,5,8,9,10,6,7]) {
          if (as >= 5) break; const sid = 'D'+d+'P'+p;
          if (secStu.some(s => A.some(x => x.student_id===s.id && x.slot_id===sid))) continue;
          if (A.some(x => x.teacher_id===cfg.teacher && x.slot_id===sid)) continue;
          if (this.teacherBusy(cfg.teacher, sid)) continue;
          this._add(secStu, cid, sid, cid+'_S'+(secIdx+1), 'ap', 'R8', cfg.teacher, A); as++;
        }
        // Pass 2: clear ALL entries at slot for ALL section students
        for (let d = 1; d <= 5 && as < 5; d++) for (const p of [1,2,3,4,5,8,9,10,6,7]) {
          if (as >= 5) break; const sid = 'D'+d+'P'+p;
          if (A.some(x => x.teacher_id===cfg.teacher && x.slot_id===sid)) continue;
          if (this.teacherBusy(cfg.teacher, sid)) continue;
          secStu.forEach(s => { const i = A.findIndex(x => x.student_id===s.id && x.slot_id===sid); if (i>=0) A.splice(i,1); });
          this._add(secStu, cid, sid, cid+'_S'+(secIdx+1), 'ap', 'R8', cfg.teacher, A); as++;
        }
      });
    });
    const electiveTeachers = {
      AP_LANG:'T_HANPENG',AP_LIT:'T_WEIWEI',HONOR_LIT:'T_ZHANGHUIHUI',
      LINEAR_ALG:'T_ZHANGZUOPING',BUSINESS:'T_QINXINXUAN',MECH_BASIS:'T_YUYUANYING',
      JAPANESE:'T_NIUYONGMEI',FRENCH:'T_BIFEI',GERMAN:'T_GLENN'
    };
    this.students.forEach(stu => {
      const choices = stu.elective_choices || {};
      [{g:'group_a',h:5},{g:'group_b',h:4},{g:'group_c',h:2}].forEach(({g,h}) => {
        const cid = choices[g]; if (!cid) return;
        const tid = electiveTeachers[cid]; let as = 0;
        for (let d = 1; d <= 5 && as < h; d++) for (const p of [1,2,3,4,5,8,9,10,6,7]) {
          if (as >= h) break; const sid = 'D' + d + 'P' + p;
          if (A.some(x => x.student_id === stu.id && x.slot_id === sid)) continue;
          if (tid && (A.some(x => x.teacher_id === tid && x.slot_id === sid) || this.teacherBusy(tid, sid))) continue;
          this._add([stu], cid, sid, stu.id, 'elective', 'R9', tid, A); as++;
        }
      });
    });

    // Fill
    this.students.forEach(stu => {
      const daily = [0, 0, 0, 0, 0], occ = new Set();
      A.filter(a => a.student_id === stu.id).forEach(a => { daily[a.slot_id.charAt(1) - 1]++; occ.add(a.slot_id); });
      const room = stu.admin_class_id === 'AC5' ? 'R9' : 'R10';
      for (let d = 1; d <= 5; d++) while (daily[d - 1] < 10) {
        let f = false; for (const p of [10, 9, 8, 7, 6]) { const sid = 'D' + d + 'P' + p; if (!occ.has(sid)) { A.push({ task_id: 'fill_' + stu.id + '_' + sid, slot_id: sid, room_id: room, course_id: 'SELF_STUDY', class_id: stu.id, class_type: 'filler', teacher_id: null, student_id: stu.id }); daily[d - 1]++; occ.add(sid); f = true; break; } } if (!f) break;
      }
      for (let d = 1; d <= 5; d++) while (daily[d - 1] < 10) {
        let f = false; for (const p of [5, 4, 3, 2, 1]) { const sid = 'D' + d + 'P' + p; if (!occ.has(sid)) { A.push({ task_id: 'fill2_' + stu.id + '_' + sid, slot_id: sid, room_id: room, course_id: 'SELF_STUDY', class_id: stu.id, class_type: 'filler', teacher_id: null, student_id: stu.id }); daily[d - 1]++; occ.add(sid); f = true; break; } } if (!f) break;
      }
    });
    return A;
  }

  evaluate(A) {
    let sc = 0;
    const exp = { AP_STAT: 5, ENG_CW: 5, COLLEGE_APP: 4 };
    // Sample 5 students per TC
    const evalS = [];
    this.tcS.forEach(stu => { for (let i = 0; i < Math.min(5, stu.length); i++) evalS.push(stu[Math.floor(i * stu.length / Math.min(5, stu.length))]); });
    evalS.forEach(s => {
      Object.entries(exp).forEach(([cid, hrs]) => { sc += Math.abs(A.filter(a => a.student_id === s.id && a.course_id === cid).length - hrs) * 100; });
      const daily = [0, 0, 0, 0, 0]; A.filter(a => a.student_id === s.id).forEach(a => daily[a.slot_id.charAt(1) - 1]++);
      if (daily.some(d => d !== 10)) sc += 1000;
      const seen = new Set(); A.filter(a => a.student_id === s.id).forEach(a => { if (seen.has(a.slot_id)) sc += 500; seen.add(a.slot_id); });
      const ssAM = A.filter(a => a.student_id === s.id && a.course_id === 'SELF_STUDY' && parseInt(a.slot_id.substring(3)) <= 5).length;
      if (ssAM > 0) sc += ssAM * 5000;
      // AP hours
      const apIds = (s.ap_courses || []);
      if (apIds.length > 0) { const apTotal = apIds.reduce((sum, cid) => sum + A.filter(a => a.student_id === s.id && a.course_id === cid).length, 0); sc += Math.abs(apTotal - apIds.length * 5) * 100; }
    });
    const s5 = this.ac5[0], s6 = this.ac6[0]; let pi = 0;
    for (let d = 1; d <= 5; d++) for (let p = 1; p <= 10; p++) {
      const sid = 'D' + d + 'P' + p;
      if (A.some(a => a.student_id === s5.id && a.slot_id === sid && a.class_type === 'admin') !== A.some(a => a.student_id === s6.id && a.slot_id === sid && a.class_type === 'admin')) pi++;
    }
    sc += pi * 100;
    return sc;
  }

  anneal(initial, iters = 5000) {
    const cur = initial.map(a => ({ ...a })); let curS = this.evaluate(cur);
    let best = cur.map(a => ({ ...a })), bestS = curS; let temp = 200;
    for (let i = 0; i < iters && temp > 0.05; i++) {
      const stu = this.students[Math.floor(Math.random() * this.students.length)];
      const sA = cur.filter(a => a.student_id === stu.id && a.class_type !== 'admin'); if (sA.length < 2) continue;
      const [ai, aj] = [Math.floor(Math.random() * sA.length), Math.floor(Math.random() * sA.length)]; if (ai === aj) continue;
      const [a1, a2] = [sA[ai], sA[aj]]; if (a1.slot_id === a2.slot_id) continue;
      const [t1, t2, o1, o2] = [a1.teacher_id, a2.teacher_id, a1.slot_id, a2.slot_id];
      let ok = true; for (const a of cur) if (a.student_id !== stu.id && ((a.slot_id === o2 && a.teacher_id === t1) || (a.slot_id === o1 && a.teacher_id === t2))) { ok = false; break; }
      if (!ok) continue;
      cur.forEach(a => { if (a.student_id === stu.id) { if (a.slot_id === o1) a.slot_id = o2; else if (a.slot_id === o2) a.slot_id = o1; } });
      const ns = this.evaluate(cur);
      if (ns < curS || Math.random() < Math.exp(-(ns - curS) / temp)) { curS = ns; if (ns < bestS) { best = cur.map(a => ({ ...a })); bestS = ns; } }
      else { cur.forEach(a => { if (a.student_id === stu.id) { if (a.slot_id === o2) a.slot_id = o1; else if (a.slot_id === o1) a.slot_id = o2; } }); }
      temp *= 0.9995;
    }
    return { assignments: best, score: bestS };
  }
}

module.exports = { G12Engine };
