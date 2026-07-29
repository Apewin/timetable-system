/**
 * G11 高二引擎 — CP-SAT TC联合求解 + logic-solver逐学生AP
 *
 * 策略: TC课程用CP-SAT联合求解(消除跨TC教师冲突)
 *       AP选修保持逐学生SAT(模型小,不易爆炸)
 */
const fs = require('fs');
const Logic = require('logic-solver');
const { CpModel, CpSolver, CpSolverStatus } = require('@ortools-node/cp-sat');

function sumVars(vars) {
  let s = vars[0];
  for (let i = 1; i < vars.length; i++) s = s.add(vars[i]);
  return s;
}

class CpSatG11Engine {
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
    this.tcR = ['R5', 'R5', 'R6'];
    this.allSlots = [];
    for (let d = 1; d <= 5; d++)
      for (let p = 1; p <= 10; p++)
        this.allSlots.push('D' + d + 'P' + p);
    this._rand = Math.random; // 可替换为 seeded PRNG
  }

  /** 设置可播种随机数生成器（用于可复现求解） */
  setRandom(rng) { this._rand = rng; }

  _add(stu, cid, sid, cls, ctype, room, tid, A) {
    for (const s of stu) A.push({
      task_id: cls + '_' + cid + '_' + s.id + '_' + sid, // P1-4 fix: 拼 slot 保证唯一
      slot_id: sid, room_id: room, course_id: cid,
      class_id: cls, class_type: ctype, teacher_id: tid,
      student_id: s.id
    });
  }

  async generateInitial() {
    const A = [];

    // ===== Phase 1: Admin =====
    this._add(this.ac3, 'DUTY', 'D1P10', 'AC3', 'admin', 'R5', null, A);
    this._add(this.ac4, 'DUTY', 'D1P10', 'AC4', 'admin', 'R6', null, A);
    this.rules.rules.filter(r =>
      (r.fixed_slot || r.fixed_slots) && (r.course === 'MEETING' || r.course === 'CLUB')
    ).forEach(r => {
      (r.fixed_slot ? [r.fixed_slot] : r.fixed_slots).forEach(s => {
        this._add(this.ac3, r.course, s, 'AC3', 'admin', 'R5', null, A);
        this._add(this.ac4, r.course, s, 'AC4', 'admin', 'R6', null, A);
      });
    });

    const pairs = [
      { s: 'D1P2', a3: 'MATH_CN', a4: 'CHIN' }, { s: 'D1P3', a3: 'CHIN', a4: 'MATH_CN' },
      { s: 'D1P4', a3: 'POL', a4: 'GUIDANCE' }, { s: 'D2P2', a3: 'GUIDANCE', a4: 'POL' },
      { s: 'D2P3', a3: 'PE', a4: 'IT' }, { s: 'D2P4', a3: 'IT', a4: 'PE' },
      { s: 'D3P2', a3: 'MATH_CN', a4: 'CHIN' }, { s: 'D3P3', a3: 'CHIN', a4: 'MATH_CN' },
      { s: 'D3P4', a3: 'POL', a4: 'GUIDANCE' }, { s: 'D4P2', a3: 'GUIDANCE', a4: 'POL' },
      { s: 'D4P7', a3: 'PE', a4: 'SELF_STUDY' }, { s: 'D5P7', a3: 'SELF_STUDY', a4: 'PE' },
      { s: 'D5P8', a3: 'SELF_STUDY', a4: 'SELF_STUDY' }
    ];
    const aT = { MATH_CN: 'T_EXP_E', CHIN: 'T_EXP_F', POL: 'T_EXP_G', IT: 'T_EXP_J', GUIDANCE: 'T_GUIDANCE' };
    pairs.forEach(p => {
      this._add(this.ac3, p.a3, p.s, 'AC3', 'admin', 'R5', p.a3 === 'PE' ? 'T_EXP_H1' : aT[p.a3], A);
      this._add(this.ac4, p.a4, p.s, 'AC4', 'admin', 'R6', p.a4 === 'PE' ? 'T_EXP_H2' : aT[p.a4], A);
    });

    // ===== Phase 2: CP-SAT for TC courses (3 TCs joint) =====
    const common = [['AP_CALC_BC', 5, 'T_WANGLILI'], ['ENG_COMP', 4, 'T_YULIN'], ['PRE_AP_LIT', 2, 'T_RACHEL'], ['PHYS_CN', 2, 'T_BAIRUSHUANG']];
    const tcCourses = [
      [...common, ['TOEFL', 3, 'T_WEIWEI'], ['HONOR_LC', 2, 'T_LUKE']],
      [...common, ['TOEFL', 3, 'T_WEIWEI'], ['HONOR_LC', 2, 'T_LUKE']],
      [...common, ['AP_LC', 5, 'T_HANPENG']]
    ];

    const model = new CpModel();
    const tcVarMap = [[], [], []];

    for (let ti = 0; ti < 3; ti++) {
      const stu = this.tcS[ti];
      const blocked = new Set();
      stu.forEach(s => A.filter(a => a.student_id === s.id).forEach(a => blocked.add(a.slot_id)));
      const availSlots = this.allSlots.filter(sid => !blocked.has(sid));

      for (const [cid, hrs, tid] of tcCourses[ti]) {
        const svList = [];
        for (let h = 0; h < hrs; h++) {
          const sv = {};
          for (const sid of availSlots)
            sv[sid] = model.newBoolVar(`TC${ti}_${cid}_h${h}_${sid}`);
          svList.push({ h, slotVars: sv });
          model.addEquality(sumVars(Object.values(sv)), 1n);
        }
        tcVarMap[ti].push({ cid, tid, hrs, svList });
      }

      for (const sid of availSlots) {
        const svars = [];
        for (const ci of tcVarMap[ti])
          for (const { slotVars } of ci.svList)
            if (slotVars[sid]) svars.push(slotVars[sid]);
        if (svars.length > 1) model.addLessOrEqual(sumVars(svars), 1n);
      }

      for (const ci of tcVarMap[ti]) {
        if (ci.hrs > 5) continue;
        for (let d = 1; d <= 5; d++) {
          const dv = [];
          for (const { slotVars } of ci.svList)
            for (const [sid, v] of Object.entries(slotVars))
              if (sid.startsWith('D' + d)) dv.push(v);
          if (dv.length > 1) model.addLessOrEqual(sumVars(dv), 1n);
        }
      }
    }

    // Cross-TC teacher conflicts
    for (let ti = 0; ti < 3; ti++) {
      for (let tj = ti + 1; tj < 3; tj++) {
        for (const sid of this.allSlots) {
          const tv = {};
          for (const [idx, vms] of [[ti, tcVarMap[ti]], [tj, tcVarMap[tj]]]) {
            for (const ci of vms) {
              if (!ci.tid) continue;
              for (const { slotVars } of ci.svList)
                if (slotVars[sid]) { if (!tv[ci.tid]) tv[ci.tid] = []; tv[ci.tid].push(slotVars[sid]); }
            }
          }
          for (const vars of Object.values(tv))
            for (let a = 0; a < vars.length; a++)
              for (let b = a + 1; b < vars.length; b++)
                model.addLessOrEqual(vars[a].add(vars[b]), 1n);
        }
      }
    }

    // Teacher P1 limit
    const p1ByTeacher = {};
    for (let ti = 0; ti < 3; ti++) {
      for (const ci of tcVarMap[ti]) {
        if (!ci.tid) continue;
        for (const { slotVars } of ci.svList)
          for (const [sid, v] of Object.entries(slotVars))
            if (sid.endsWith('P1')) { if (!p1ByTeacher[ci.tid]) p1ByTeacher[ci.tid] = []; p1ByTeacher[ci.tid].push(v); }
      }
    }
    for (const [tid, vars] of Object.entries(p1ByTeacher))
      if (vars.length > 3) model.addLessOrEqual(sumVars(vars), 3n);

    const solver = new CpSolver();
    solver.parameters.maxTimeInSeconds = 60;
    solver.parameters.numSearchWorkers = 8;
    const status = await solver.solve(model);

    if (status !== CpSolverStatus.OPTIMAL && status !== CpSolverStatus.FEASIBLE) {
      console.error(`  CP-SAT G11 TC: ${status} — fallback to logic-solver`);
      return this._fallbackLogicSolver(A);
    }

    console.log(`  CP-SAT G11 TC: ${status === CpSolverStatus.OPTIMAL ? 'OPTIMAL' : 'FEASIBLE'}`);

    for (let ti = 0; ti < 3; ti++) {
      const stu = this.tcS[ti];
      for (const ci of tcVarMap[ti])
        for (const { slotVars } of ci.svList)
          for (const [sid, v] of Object.entries(slotVars))
            if (solver.booleanValue(v)) { this._add(stu, ci.cid, sid, this.tcI[ti], 'teaching', this.tcR[ti], ci.tid, A); break; }
    }

    // ===== Phase 3: Per-student AP (logic-solver, sequential) =====
    const apCfg = { AP_PHYS2: 'T_ZHANGZUOPING', AP_CHEM: 'T_YANGHONGXU', AP_BIO: 'T_FANZHENGWEI', AP_CS: 'T_SUNHUA', AP_PSYCH: 'T_FUXIAOMENG', AP_ENVSCI: 'T_ZHUJIE', AP_MACRO: 'T_QINXINXUAN', AP_ARTHIST: 'T_ZHANGHUIHUI', AP_MICRO: 'T_GLENN' };

    this.students.forEach(stu => {
      const apList = (stu.ap_courses || []).filter(c => c !== 'AP_CALC_BC');
      if (!apList.length) return;
      const apCourses = apList.map(cid => [cid, 5, apCfg[cid]]);
      const blocked = new Set();
      A.filter(a => a.student_id === stu.id).forEach(a => blocked.add(a.slot_id));
      const allSlots = [];
      for (let d = 1; d <= 5; d++) for (let p = 1; p <= 10; p++) { const sid = 'D' + d + 'P' + p; if (!blocked.has(sid)) allSlots.push(sid); }
      if (allSlots.length < apCourses.reduce((s, c) => s + c[1], 0)) return;

      const lsolver = new Logic.Solver();
      const varMap = [];
      for (const [cid, hrs, tid] of apCourses) {
        for (let h = 0; h < hrs; h++) {
          const sv = {};
          for (const sid of allSlots) {
            if (tid && A.some(x => x.teacher_id === tid && x.slot_id === sid && x.student_id !== stu.id)) continue;
            sv[sid] = `ap_${cid}_${h}_${sid}`;
          }
          varMap.push({ cid, h, slotVars: sv });
          lsolver.require(Logic.exactlyOne(Object.values(sv)));
        }
      }
      for (const sid of allSlots) {
        const sv = [];
        for (const vm of varMap) { if (vm.slotVars[sid]) sv.push(vm.slotVars[sid]); }
        if (sv.length > 1) lsolver.require(Logic.atMostOne(sv));
      }
      for (const [cid, hrs] of apCourses) {
        for (let d = 1; d <= 5; d++) {
          const dv = [];
          for (const vm of varMap) { if (vm.cid !== cid) continue; for (const [sid, vname] of Object.entries(vm.slotVars)) { if (sid.startsWith('D' + d)) dv.push(vname); } }
          if (dv.length > 1) lsolver.require(Logic.atMostOne(dv));
        }
      }
      const solution = lsolver.solve();
      if (solution) {
        const trueVars = solution.getTrueVars();
        for (const vm of varMap) {
          for (const [sid, vname] of Object.entries(vm.slotVars)) {
            if (trueVars.includes(vname)) {
              const [cid, , tid] = apCourses.find(c => c[0] === vm.cid) || [vm.cid, 0, null];
              this._add([stu], vm.cid, sid, stu.id, 'ap', null, tid, A); break;
            }
          }
        }
      } else {
        // P0-2 fix: greedy fallback 必须检查教师占用
        apCourses.forEach(([cid, hrs, tid]) => {
          let a = 0; const dc = [0, 0, 0, 0, 0, 0];
          for (let d = 1; d <= 5 && a < hrs; d++) {
            for (const p of [1, 2, 3, 4, 5, 8, 9, 10, 6, 7]) {
              if (a >= hrs) break; const sid = 'D' + d + 'P' + p;
              if (blocked.has(sid)) continue;
              if (A.some(x => x.student_id === stu.id && x.slot_id === sid)) continue;
              // P0-2 fix: 检查教师占用
              if (tid && A.some(x => x.teacher_id === tid && x.slot_id === sid && x.student_id !== stu.id)) continue;
              if (dc[d] >= 1) continue;
              this._add([stu], cid, sid, stu.id, 'ap', null, tid, A); blocked.add(sid); dc[d]++; a++; break;
            }
          }
          for (let d = 1; d <= 5 && a < hrs; d++) {
            for (const p of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]) {
              if (a >= hrs) break; const sid = 'D' + d + 'P' + p;
              if (blocked.has(sid)) continue;
              if (A.some(x => x.student_id === stu.id && x.slot_id === sid)) continue;
              // P0-2 fix: 第二轮也检查教师占用
              if (tid && A.some(x => x.teacher_id === tid && x.slot_id === sid && x.student_id !== stu.id)) continue;
              this._add([stu], cid, sid, stu.id, 'ap', null, tid, A); blocked.add(sid); a++; break;
            }
          }
        });
      }
    });

    // Fill
    this._fill(A);
    return A;
  }

  _fallbackLogicSolver(A) {
    // Original logic-solver approach as fallback
    const common = [['AP_CALC_BC', 5, 'T_WANGLILI'], ['ENG_COMP', 4, 'T_YULIN'], ['PRE_AP_LIT', 2, 'T_RACHEL'], ['PHYS_CN', 2, 'T_BAIRUSHUANG']];
    const l12 = [['TOEFL', 3, 'T_WEIWEI'], ['HONOR_LC', 2, 'T_LUKE']], l3 = [['AP_LC', 5, 'T_HANPENG']];
    this.tcS.forEach((stu, ti) => {
      const courses = ti === 2 ? [...common, ...l3] : [...common, ...l12];
      const blocked = new Set(); stu.forEach(s => { A.filter(a => a.student_id === s.id).forEach(a => blocked.add(a.slot_id)); });
      const allSlots = []; for (let d = 1; d <= 5; d++) for (let p = 1; p <= 10; p++) { const sid = 'D' + d + 'P' + p; if (!blocked.has(sid)) allSlots.push(sid); }
      const solver = new Logic.Solver(); const varMap = [];
      for (const [cid, hrs, tid] of courses) {
        for (let h = 0; h < hrs; h++) {
          const sv = {}; for (const sid of allSlots) { if (tid && A.some(x => x.teacher_id === tid && x.slot_id === sid && !stu.some(s => s.id === x.student_id))) continue; sv[sid] = `${cid}_${h}_${sid}`; }
          varMap.push({ cid, h, slotVars: sv }); solver.require(Logic.exactlyOne(Object.values(sv)));
        }
      }
      for (const sid of allSlots) { const sv = []; for (const vm of varMap) { if (vm.slotVars[sid]) sv.push(vm.slotVars[sid]); } if (sv.length > 1) solver.require(Logic.atMostOne(sv)); }
      for (const [cid, hrs] of courses) { if (hrs > 5) continue; for (let d = 1; d <= 5; d++) { const dv = []; for (const vm of varMap) { if (vm.cid !== cid) continue; for (const [sid, vname] of Object.entries(vm.slotVars)) { if (sid.startsWith('D' + d)) dv.push(vname); } } if (dv.length > 1) solver.require(Logic.atMostOne(dv)); } }
      const solution = solver.solve(); if (!solution) return;
      const trueVars = solution.getTrueVars();
      for (const vm of varMap) { for (const [sid, vname] of Object.entries(vm.slotVars)) { if (trueVars.includes(vname)) { const [cid, , tid] = courses.find(c => c[0] === vm.cid) || [vm.cid, 0, null]; this._add(stu, vm.cid, sid, ti === 2 ? 'TC_G11_3' : ti === 0 ? 'TC_G11_1' : 'TC_G11_2', 'teaching', ti === 2 ? 'R6' : 'R5', tid, A); break; } } }
    });
    return A;
  }

  _fill(A) {
    for (const stu of this.students) {
      const room = stu.admin_class_id === 'AC3' ? 'R5' : 'R6';
      const daily = [0, 0, 0, 0, 0], occ = new Set();
      A.filter(a => a.student_id === stu.id).forEach(a => { daily[parseInt(a.slot_id.charAt(1)) - 1]++; occ.add(a.slot_id); });
      for (let d = 1; d <= 5; d++) {
        while (daily[d - 1] < 10) {
          let f = false;
          for (const p of [10, 9, 8, 7, 6]) {
            const sid = 'D' + d + 'P' + p; if (!occ.has(sid)) { this._add([stu], 'SELF_STUDY', sid, stu.id, 'filler', room, null, A); daily[d - 1]++; occ.add(sid); f = true; break; }
          }
          if (!f) { for (const p of [5, 4, 3, 2, 1]) { const sid = 'D' + d + 'P' + p; if (!occ.has(sid)) { this._add([stu], 'SELF_STUDY', sid, stu.id, 'filler', room, null, A); daily[d - 1]++; occ.add(sid); f = true; break; } } }
          if (!f) break;
        }
      }
    }
  }

  evaluate(A) {
    let sc = 0;

    // P1-1 fix: 教师冲突硬惩罚（权重必须大于任何软目标）
    const tMap = {};
    A.forEach(a => {
      if (!a.teacher_id) return;
      const k = a.teacher_id + '@' + a.slot_id;
      (tMap[k] = tMap[k] || new Set()).add(a.course_id);
    });
    Object.values(tMap).forEach(courses => { if (courses.size > 1) sc += 100000; });

    const exp = { ENG_COMP: 4, AP_CALC_BC: 5, PRE_AP_LIT: 2, PHYS_CN: 2 };
    this.tcS.forEach(stu => {
      const s = stu[0]; const te = { ...exp };
      if (s.teaching_class_id === 'TC_G11_3') te.AP_LC = 5; else { te.HONOR_LC = 2; te.TOEFL = 3; }
      Object.entries(te).forEach(([cid, hrs]) => { sc += Math.abs(A.filter(a => a.student_id === s.id && a.course_id === cid).length - hrs) * 100; });
      const daily = [0, 0, 0, 0, 0]; A.filter(a => a.student_id === s.id).forEach(a => daily[a.slot_id.charAt(1) - 1]++);
      if (daily.some(d => d !== 10)) sc += 1000;
    });
    this.students.forEach(s => {
      const sA = A.filter(a => a.student_id === s.id); const count = {};
      sA.forEach(a => { count[a.course_id] = (count[a.course_id] || 0) + 1; });
      (s.ap_courses || []).filter(c => c !== 'AP_CALC_BC').forEach(cid => { sc += Math.abs((count[cid] || 0) - 5) * 200; });
    });
    return sc;
  }

  anneal(initial, iters = 3000) {
    const cur = initial.map(a => ({ ...a }));
    let curS = this.evaluate(cur), best = cur.map(a => ({ ...a })), bestS = curS, temp = 200;
    for (let i = 0; i < iters; i++) {
      const stu = this.students[Math.floor(this._rand() * this.students.length)];
      const sA = cur.filter(a => a.student_id === stu.id && (a.class_type === 'teaching' || a.class_type === 'filler'));
      if (sA.length < 2) continue;
      const [ai, aj] = [Math.floor(this._rand() * sA.length), Math.floor(this._rand() * sA.length)];
      if (ai === aj) continue;
      const [a1, a2] = [sA[ai], sA[aj]];
      if (a1.slot_id === a2.slot_id) continue;
      const [t1, t2, o1, o2] = [a1.teacher_id, a2.teacher_id, a1.slot_id, a2.slot_id];
      const tcId = a1.class_id; if (!tcId?.startsWith('TC_')) continue;
      const tcStu = this.students.filter(s => s.teaching_class_id === tcId);
      let ok = true;
      for (const a of cur) if (!tcStu.some(s => s.id === a.student_id) && ((a.slot_id === o2 && a.teacher_id === t1) || (a.slot_id === o1 && a.teacher_id === t2))) { ok = false; break; }
      if (!ok) continue;
      tcStu.forEach(s => cur.forEach(a => { if (a.student_id === s.id) { if (a.slot_id === o1) a.slot_id = o2; else if (a.slot_id === o2) a.slot_id = o1; } }));
      const ns = this.evaluate(cur);
      if (ns < curS || this._rand() < Math.exp(-(ns - curS) / temp)) { curS = ns; if (ns < bestS) { best = cur.map(a => ({ ...a })); bestS = ns; } }
      else { tcStu.forEach(s => cur.forEach(a => { if (a.student_id === s.id) { if (a.slot_id === o2) a.slot_id = o1; else if (a.slot_id === o1) a.slot_id = o2; } })); }
      temp *= 0.9995;
    }
    return { assignments: best, score: bestS };
  }
}

module.exports = { CpSatG11Engine };
