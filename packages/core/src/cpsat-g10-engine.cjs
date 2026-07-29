/**
 * G10 高一引擎 — Google OR-Tools CP-SAT 全局求解器
 *
 * 与 logic-solver 的关键区别:
 *   1. 3个TC联合求解 — 教师约束跨TC全局生效
 *   2. 线性约束 — sum(x) <= 1 比 atMostOne 更直观
 *   3. minimize目标 — 自习优先排下午直接在模型优化
 *   4. 同格排课 — 课程组约束直接表达
 *
 * 硬约束:
 *   - 所有课程排满，无空堂
 *   - 教师不冲突（全局）
 *   - ≤5hr课程每天≤1节
 *   - 教师P1≤3次/周
 *   - 周一P9=班会 P10=值班(无) 周二/五P10=社团
 *   - 自习优先下午
 */
const fs = require('fs');
const { CpModel, CpSolver, CpSolverStatus } = require('@ortools-node/cp-sat');
const { makeTaskId } = require('./constants.cjs');

function sumVars(vars) {
  if (vars.length === 0) throw new Error('Empty var list');
  let s = vars[0];
  for (let i = 1; i < vars.length; i++) s = s.add(vars[i]);
  return s;
}

class CpSatG10Engine {
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
    this.allSlots = [];
    for (let d = 1; d <= 5; d++)
      for (let p = 1; p <= 10; p++)
        this.allSlots.push('D' + d + 'P' + p);
    // P2-10 fix: 读其他年级教师占用（支持单独重跑 G10）
    this.globalTeacher = {};
    (this.data.assignments || []).forEach(a => {
      if (a.teacher_id && this.students.every(s => s.id !== a.student_id)) {
        if (!this.globalTeacher[a.teacher_id]) this.globalTeacher[a.teacher_id] = new Set();
        this.globalTeacher[a.teacher_id].add(a.slot_id);
      }
    });
    this._rand = Math.random; // 可替换为 seeded PRNG
  }

  teacherBusy(tid, sid) { return this.globalTeacher[tid]?.has(sid) || false; }

  /** 设置可播种随机数生成器（用于可复现求解） */
  setRandom(rng) { this._rand = rng; }

  _add(stu, cid, sid, cls, ctype, room, tid, A) {
    for (const s of stu) A.push({
      task_id: makeTaskId(cls, cid, s.id, sid),
      slot_id: sid, room_id: room, course_id: cid,
      class_id: cls, class_type: ctype, teacher_id: tid,
      student_id: s.id
    });
  }

  _placeAdmin() {
    const A = [];
    this.rules.rules.filter(r =>
      (r.fixed_slot || r.fixed_slots) && (!r.grades || r.grades.includes(10))
    ).forEach(r => {
      (r.fixed_slot ? [r.fixed_slot] : r.fixed_slots).forEach(s => {
        this._add(this.ac1, r.course, s, 'AC1', 'admin', 'R1', null, A);
        this._add(this.ac2, r.course, s, 'AC2', 'admin', 'R2', null, A);
      });
    });
    const adminT = {
      GRAMMAR: 'T_JIZHUREN', CHIN: 'T_EXP_A', HIST: 'T_EXP_B',
      GEOG: 'T_EXP_C', ART: 'T_EXP_D', GUIDANCE: 'T_GUIDANCE'
    };
    (this.rules.admin_pairs?.slots || []).forEach(p => {
      const slot = p.slot;
      this._add(this.ac1, p.ac1, slot, 'AC1', 'admin', 'R1', adminT[p.ac1], A);
      this._add(this.ac2, p.ac2, slot, 'AC2', 'admin', 'R2', adminT[p.ac2], A);
    });
    return A;
  }

  async generateInitial() {
    const A = this._placeAdmin();

    const courses = [
      ['MATH_PRECAL', 6, 'T_CUIXIAOPENG'],
      ['AP_PHYS1', 5, 'T_XIEHAOYANG'],
      ['CHEM_PRE', 5, 'T_ZHANGRAN'],
      ['BIO_PRE', 5, 'T_LIYIXUAN'],
      ['ENG_LS', 3, 'T_BIFEI'],
      ['ENG_RW', 3, 'T_NIUYONGMEI'],
      ['ENG_LIT', 4, 'T_RACHEL'],
      ['ENG_SURVEY', 2, 'T_VINCENT'],
      ['PE', 2, 'T_VINCENT'],
      ['SELF_STUDY', 2, null]
    ];

    const model = new CpModel();

    // ===== Variables: x[tc][cid][hour][slot] = BoolVar =====
    const tcVarMap = [[], [], []]; // tcVarMap[ti] = [{cid,tid,hrs,slotVars:{sid:BoolVar}}]

    for (let ti = 0; ti < 3; ti++) {
      const stu = this.tcS[ti];
      const blocked = new Set();
      stu.forEach(s => A.filter(a => a.student_id === s.id).forEach(a => blocked.add(a.slot_id)));

      for (const [cid, hrs, tid] of courses) {
        const svList = []; // [{h, slotVars: {sid: BoolVar}}]
        for (let h = 0; h < hrs; h++) {
          const sv = {};
          const candidateSlots = cid === 'SELF_STUDY'
            ? this.allSlots.filter(sid => !blocked.has(sid) && parseInt(sid.substring(3)) >= 6)
            : this.allSlots.filter(sid => !blocked.has(sid));

          for (const sid of candidateSlots) {
            // Follow-up #1: G10 CP-SAT 排除跨年级教师占用
            if (tid && this.teacherBusy(tid, sid)) continue;
            sv[sid] = model.newBoolVar(`TC${ti}_${cid}_h${h}_${sid}`);
          }

          svList.push({ h, slotVars: sv });

          // Each course-hour assigned to exactly 1 slot
          const varList = Object.values(sv);
          if (varList.length === 0) {
            throw new Error(`TC${ti} ${cid}[${h}] has 0 candidate slots`);
          }
          model.addEquality(sumVars(varList), 1n);
        }
        tcVarMap[ti].push({ cid, tid, hrs, svList });
      }
    }

    // ===== Per-TC: at most 1 course per slot =====
    for (let ti = 0; ti < 3; ti++) {
      const stu = this.tcS[ti];
      const blocked = new Set();
      stu.forEach(s => A.filter(a => a.student_id === s.id).forEach(a => blocked.add(a.slot_id)));
      const availSlots = this.allSlots.filter(sid => !blocked.has(sid));

      for (const sid of availSlots) {
        const svars = [];
        for (const ci of tcVarMap[ti]) {
          for (const { slotVars } of ci.svList) {
            if (slotVars[sid]) svars.push(slotVars[sid]);
          }
        }
        if (svars.length > 1) {
          model.addLessOrEqual(sumVars(svars), 1n);
        }
      }
    }

    // ===== Per-TC: distribution — ≤5hr courses max 1/day =====
    for (let ti = 0; ti < 3; ti++) {
      for (const ci of tcVarMap[ti]) {
        if (ci.hrs > 5) continue;
        for (let d = 1; d <= 5; d++) {
          const dayVars = [];
          for (const { slotVars } of ci.svList) {
            for (const [sid, v] of Object.entries(slotVars)) {
              if (sid.startsWith('D' + d)) dayVars.push(v);
            }
          }
          if (dayVars.length > 1) {
            model.addLessOrEqual(sumVars(dayVars), 1n);
          }
        }
      }
    }

    // ===== MATH_PRECAL (6hrs): max 2/day, consecutive if 2 =====
    for (let ti = 0; ti < 3; ti++) {
      const mathCI = tcVarMap[ti].find(ci => ci.cid === 'MATH_PRECAL');
      if (!mathCI) continue;
      for (let d = 1; d <= 5; d++) {
        const dv = [];
        for (const { slotVars } of mathCI.svList) {
          for (const [sid, v] of Object.entries(slotVars)) {
            if (sid.startsWith('D' + d)) dv.push({ v, p: parseInt(sid.substring(3)) });
          }
        }
        if (dv.length >= 2) {
          model.addLessOrEqual(sumVars(dv.map(x => x.v)), 2n);
          for (let i = 0; i < dv.length; i++) {
            for (let j = i + 1; j < dv.length; j++) {
              if (Math.abs(dv[i].p - dv[j].p) !== 1) {
                model.addLessOrEqual(dv[i].v.add(dv[j].v), 1n);
              }
            }
          }
        }
      }
    }

    // ===== Cross-TC: teacher conflicts =====
    for (let ti = 0; ti < 3; ti++) {
      for (let tj = ti + 1; tj < 3; tj++) {
        for (const sid of this.allSlots) {
          // Group by teacher
          const teacherVars = {}; // tid -> {ti: [vars], tj: [vars]}
          for (const [idx, vms] of [[ti, tcVarMap[ti]], [tj, tcVarMap[tj]]]) {
            for (const ci of vms) {
              if (!ci.tid) continue;
              if (!teacherVars[ci.tid]) teacherVars[ci.tid] = {};
              if (!teacherVars[ci.tid][idx]) teacherVars[ci.tid][idx] = [];
              for (const { slotVars } of ci.svList) {
                if (slotVars[sid]) teacherVars[ci.tid][idx].push(slotVars[sid]);
              }
            }
          }
          // Same teacher can't teach different TCs at same slot
          for (const [tid, tcVars] of Object.entries(teacherVars)) {
            const va = tcVars[ti] || [];
            const vb = tcVars[tj] || [];
            for (const a of va) {
              for (const b of vb) {
                model.addLessOrEqual(a.add(b), 1n);
              }
            }
          }
        }
      }
    }

    // ===== Global: teacher P1 ≤ 3 per week =====
    const p1ByTeacher = {};
    for (let ti = 0; ti < 3; ti++) {
      for (const ci of tcVarMap[ti]) {
        if (!ci.tid) continue;
        if (!p1ByTeacher[ci.tid]) p1ByTeacher[ci.tid] = [];
        for (const { slotVars } of ci.svList) {
          for (const [sid, v] of Object.entries(slotVars)) {
            if (sid.endsWith('P1')) p1ByTeacher[ci.tid].push(v);
          }
        }
      }
    }
    for (const [tid, vars] of Object.entries(p1ByTeacher)) {
      if (vars.length > 3) {
        model.addLessOrEqual(sumVars(vars), 3n);
      }
    }

    // ===== Objective: minimize self-study distance from P10 =====
    const ssTerms = [];
    for (let ti = 0; ti < 3; ti++) {
      const ssCI = tcVarMap[ti].find(ci => ci.cid === 'SELF_STUDY');
      if (!ssCI) continue;
      for (const { slotVars } of ssCI.svList) {
        for (const [sid, v] of Object.entries(slotVars)) {
          const p = parseInt(sid.substring(3));
          if (p < 10) {
            ssTerms.push(v.mul(BigInt(10 - p)));
          }
        }
      }
    }
    if (ssTerms.length > 0) {
      model.minimize(sumVars(ssTerms));
    }

    // ===== Solve =====
    const solver = new CpSolver();
    solver.parameters.maxTimeInSeconds = 60;
    solver.parameters.numSearchWorkers = 8;

    const status = await solver.solve(model);

    if (status !== CpSolverStatus.OPTIMAL && status !== CpSolverStatus.FEASIBLE) {
      console.error(`  CP-SAT G10: ${status} — falling back`);
      return A;
    }

    console.log(`  CP-SAT G10: ${status === CpSolverStatus.OPTIMAL ? 'OPTIMAL' : 'FEASIBLE'}`);

    // ===== Extract solution =====
    for (let ti = 0; ti < 3; ti++) {
      const stu = this.tcS[ti];
      const tcId = this.tcI[ti];
      const room = this.tcR[ti];

      for (const ci of tcVarMap[ti]) {
        for (const { slotVars } of ci.svList) {
          for (const [sid, v] of Object.entries(slotVars)) {
            if (solver.booleanValue(v)) {
              this._add(stu, ci.cid, sid, tcId, 'teaching', room, ci.tid, A);
              break;
            }
          }
        }
      }
    }

    // Smart fill remaining slots
    this._smartFill(A);
    return A;
  }

  _smartFill(A) {
    for (const stu of this.students) {
      const room = stu.admin_class_id === 'AC1' ? 'R1' : 'R2';
      const daily = [0, 0, 0, 0, 0];
      const occ = new Set();
      A.filter(a => a.student_id === stu.id).forEach(a => {
        daily[parseInt(a.slot_id.charAt(1)) - 1]++;
        occ.add(a.slot_id);
      });

      for (let d = 1; d <= 5; d++) {
        while (daily[d - 1] < 10) {
          let f = false;
          for (const p of [10, 9, 8, 7, 6]) {
            const sid = 'D' + d + 'P' + p;
            if (!occ.has(sid)) {
              this._add([stu], 'SELF_STUDY', sid, stu.id, 'filler', room, null, A);
              daily[d - 1]++; occ.add(sid); f = true; break;
            }
          }
          if (!f) break;
        }
      }

      for (let d = 1; d <= 5; d++) {
        while (daily[d - 1] < 10) {
          let moved = false;
          for (const pp of [6, 7, 8, 9, 10]) {
            const afterSid = 'D' + d + 'P' + pp;
            const moveA = A.find(a =>
              a.student_id === stu.id && a.slot_id === afterSid &&
              a.class_type !== 'admin' && a.course_id !== 'SELF_STUDY' &&
              !['DUTY', 'MEETING', 'CLUB'].includes(a.course_id)
            );
            if (!moveA) continue;
            for (const mp of [5, 4, 3, 2, 1]) {
              const morningSid = 'D' + d + 'P' + mp;
              if (occ.has(morningSid)) continue;
              if (moveA.teacher_id && A.some(a =>
                a.teacher_id === moveA.teacher_id &&
                a.slot_id === morningSid && a.student_id !== stu.id
              )) continue;
              // P1-2 fix: 检查日分布约束 — ≤5hr 课程同一天最多1节
              const moveCourseHrs = A.filter(a => a.student_id === stu.id && a.course_id === moveA.course_id).length;
              if (moveCourseHrs <= 5) {
                const sameDayOther = A.some(a => a.student_id === stu.id && a.course_id === moveA.course_id
                  && a.slot_id.startsWith('D' + d) && a !== moveA);
                if (sameDayOther) continue;
              }
              moveA.slot_id = morningSid;
              occ.add(morningSid); occ.delete(afterSid);
              this._add([stu], 'SELF_STUDY', afterSid, stu.id, 'filler', room, null, A);
              daily[d - 1]++; occ.add(afterSid); moved = true; break;
            }
            if (moved) break;
          }
          if (!moved) break;
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

    const exp = {
      MATH_PRECAL: 6, AP_PHYS1: 5, CHEM_PRE: 5, BIO_PRE: 5,
      ENG_LS: 3, ENG_RW: 3, ENG_LIT: 4, ENG_SURVEY: 2, PE: 2
    };
    this.tcS.forEach(stu => {
      const s = stu[0];
      Object.entries(exp).forEach(([cid, hrs]) => {
        sc += Math.abs(A.filter(a => a.student_id === s.id && a.course_id === cid).length - hrs) * 100;
      });
      const daily = [0, 0, 0, 0, 0];
      A.filter(a => a.student_id === s.id).forEach(a => daily[a.slot_id.charAt(1) - 1]++);
      if (daily.some(d => d !== 10)) sc += 1000;
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
      const tcId = a1.class_id;
      if (!tcId?.startsWith('TC_')) continue;
      const tcStu = this.students.filter(s => s.teaching_class_id === tcId);
      let ok = true;
      for (const a of cur)
        if (!tcStu.some(s => s.id === a.student_id) &&
          ((a.slot_id === o2 && a.teacher_id === t1) || (a.slot_id === o1 && a.teacher_id === t2)))
        { ok = false; break; }
      if (!ok) continue;
      tcStu.forEach(s => cur.forEach(a => {
        if (a.student_id === s.id) {
          if (a.slot_id === o1) a.slot_id = o2;
          else if (a.slot_id === o2) a.slot_id = o1;
        }
      }));
      const ns = this.evaluate(cur);
      if (ns < curS || this._rand() < Math.exp(-(ns - curS) / temp)) {
        curS = ns;
        if (ns < bestS) { best = cur.map(a => ({ ...a })); bestS = ns; }
      } else {
        tcStu.forEach(s => cur.forEach(a => {
          if (a.student_id === s.id) {
            if (a.slot_id === o2) a.slot_id = o1;
            else if (a.slot_id === o1) a.slot_id = o2;
          }
        }));
      }
      temp *= 0.9995;
    }
    return { assignments: best, score: bestS };
  }
}

module.exports = { CpSatG10Engine };
