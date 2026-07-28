/**
 * G10 高一引擎 — Google OR-Tools CP-SAT求解器
 *
 * 与 logic-solver (MiniSat) 的关键区别:
 *   1. 原生整数/线性约束 — 模型更接近人类思维（sum ≤ 1 vs atMostOne）
 *   2. minimize/maximize — 软约束直接建模为目标函数，无需 SoftOptimizer
 *   3. 全局优化 — 所有 3 个 TC 联合求解，教师 P1 限制自然满足
 *   4. 并行搜索 — numSearchWorkers 自动利用多核
 *
 * 硬约束:
 *   1. 所有课程排满，不能有空堂
 *   2. 教师不冲突（同一时段不能教不同课程/班级）
 *   3. ≤5hr课程每天最多1节（无连堂）
 *   4. 同一教师一周 P1 不超过3次（全局，跨TC）
 *   5. 周一 P9=班会, P10=自习/值日（G10无值日）
 *   6. 周二 P10 + 周五 P10 = 社团
 *   7. 自习优先排 P10 > P9 > P8...
 */
const fs = require('fs');
const { CpModel, CpSolver, CpSolverStatus } = require('@ortools-node/cp-sat');

function sumVars(vars) {
  if (vars.length === 0) throw new Error('Empty var list');
  let s = vars[0];
  for (let i = 1; i < vars.length; i++) s = s.add(vars[i]);
  return s;
}

class CpSatEngine {
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
  }

  _add(stu, cid, sid, cls, ctype, room, tid, A) {
    for (const s of stu) {
      A.push({
        task_id: cls + '_' + cid + '_' + s.id,
        slot_id: sid, room_id: room, course_id: cid,
        class_id: cls, class_type: ctype, teacher_id: tid,
        student_id: s.id
      });
    }
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

  /**
   * Joint CP-SAT solve for ALL 3 TCs simultaneously.
   * Benefits:
   *   - Teacher P1 limit enforced globally
   *   - Natural teacher conflict prevention
   *   - Soft objective (SS placement) optimized across all TCs
   */
  async generateInitial() {
    const A = this._placeAdmin();

    // Per-TC blocked slots (admin assignments)
    const blocked = this.tcS.map(stu => {
      const b = new Set();
      stu.forEach(s => A.filter(a => a.student_id === s.id).forEach(a => b.add(a.slot_id)));
      return b;
    });

    // Teacher already occupied from admin slots
    const adminTeacherSlots = {};
    for (const a of A) {
      if (a.teacher_id) {
        if (!adminTeacherSlots[a.teacher_id]) adminTeacherSlots[a.teacher_id] = new Set();
        adminTeacherSlots[a.teacher_id].add(a.slot_id);
      }
    }

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

    // ===== Variables: x[tcIdx][cid][hourIdx][slotId] = BoolVar =====
    // Structure: varMap[tcIdx] = [{cid, h, slotVars: {sid: BoolVar}}]
    const varMap = [[], [], []];

    for (let ti = 0; ti < 3; ti++) {
      const availSlots = this.allSlots.filter(sid => !blocked[ti].has(sid));

      for (const [cid, hrs, tid] of courses) {
        for (let h = 0; h < hrs; h++) {
          const sv = {};
          const candidateSlots = cid === 'SELF_STUDY'
            ? availSlots.filter(sid => parseInt(sid.substring(3)) >= 6)
            : availSlots;

          for (const sid of candidateSlots) {
            // Teacher already occupied at this slot (from admin)?
            if (tid && adminTeacherSlots[tid]?.has(sid)) continue;
            sv[sid] = model.newBoolVar(`TC${ti}_${cid}_h${h}_${sid}`);
          }

          varMap[ti].push({ cid, h, tid, slotVars: sv });

          // Exactly 1 slot per course-hour
          const varList = Object.values(sv);
          if (varList.length === 0) {
            console.error(`  TC${ti}: ${cid}[${h}] has 0 candidate slots!`);
            return A;
          }
          model.addEquality(sumVars(varList), 1n);
        }
      }

      // Per-slot: at most 1 course (per student, same TC)
      for (const sid of availSlots) {
        const slotVars = [];
        for (const vm of varMap[ti]) {
          if (vm.slotVars[sid]) slotVars.push(vm.slotVars[sid]);
        }
        if (slotVars.length > 1) {
          model.addLessOrEqual(sumVars(slotVars), 1n);
        }
      }

      // Distribution: ≤5hr courses max 1/day
      for (const [cid, hrs] of courses) {
        if (hrs > 5) continue;
        for (let d = 1; d <= 5; d++) {
          const dayVars = [];
          for (const vm of varMap[ti]) {
            if (vm.cid !== cid) continue;
            for (const [sid, v] of Object.entries(vm.slotVars)) {
              if (sid.startsWith('D' + d)) dayVars.push(v);
            }
          }
          if (dayVars.length > 1) {
            model.addLessOrEqual(sumVars(dayVars), 1n);
          }
        }
      }

      // MATH_PRECAL (6hrs): max 2/day, consecutive if 2
      const mathVars = varMap[ti].filter(vm => vm.cid === 'MATH_PRECAL');
      for (let d = 1; d <= 5; d++) {
        const dv = [];
        for (const vm of mathVars) {
          for (const [sid, v] of Object.entries(vm.slotVars)) {
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

    // ===== Cross-TC teacher conflict: same teacher can't teach different TCs at same slot =====
    for (let ti = 0; ti < 3; ti++) {
      for (let tj = ti + 1; tj < 3; tj++) {
        for (const sid of this.allSlots) {
          // Find courses with same teacher in both TCs
          const teacherMap = {};  // tid → {[tcIdx]: [BoolVar]}
          for (const [idx, vms] of [[ti, varMap[ti]], [tj, varMap[tj]]]) {
            for (const vm of vms) {
              if (!vm.tid) continue;
              const v = vm.slotVars[sid];
              if (!v) continue;
              if (!teacherMap[vm.tid]) teacherMap[vm.tid] = {};
              if (!teacherMap[vm.tid][idx]) teacherMap[vm.tid][idx] = [];
              teacherMap[vm.tid][idx].push(v);
            }
          }
          // For each teacher, they can't be in both TCs at the same slot
          for (const [tid, tcVars] of Object.entries(teacherMap)) {
            const varsA = tcVars[ti] || [];
            const varsB = tcVars[tj] || [];
            for (const va of varsA) {
              for (const vb of varsB) {
                model.addLessOrEqual(va.add(vb), 1n);
              }
            }
          }
        }
      }
    }

    // ===== GLOBAL: Teacher P1 limit ≤ 3 per week =====
    const p1ByTeacher = {};
    for (let ti = 0; ti < 3; ti++) {
      for (const vm of varMap[ti]) {
        if (!vm.tid) continue;
        if (!p1ByTeacher[vm.tid]) p1ByTeacher[vm.tid] = [];
        for (const [sid, v] of Object.entries(vm.slotVars)) {
          if (sid.endsWith('P1')) p1ByTeacher[vm.tid].push(v);
        }
      }
    }
    for (const [tid, vars] of Object.entries(p1ByTeacher)) {
      if (vars.length > 3) {
        model.addLessOrEqual(sumVars(vars), 3n);
      }
    }

    // ===== GLOBAL: VINCENT has PE + ENG_SURVEY, each 2hrs × 3 TCs = 12 slots =====
    // VINCENT teaches both PE and ENG_SURVEY to all 3 TCs.
    // PE + ENG_SURVEY total hours = 2+2=4 per TC, ×3 TCs = 12 total unique slots.
    // Constraint: VINCENT can't teach 2 courses at the same slot
    // This is implicitly handled by: PE and ENG_SURVEY are in the same TC,
    // and per-slot atMostOne already prevents them from sharing a slot within a TC.
    // Across TCs, the teacher conflict above handles it.

    // ===== SOFTOPT: Self-study preference =====
    // Minimize distance from P10 for SELF_STUDY across all TCs
    const ssPenalty = [];
    for (let ti = 0; ti < 3; ti++) {
      const ssVars = varMap[ti].filter(vm => vm.cid === 'SELF_STUDY');
      for (const vm of ssVars) {
        for (const [sid, v] of Object.entries(vm.slotVars)) {
          const p = parseInt(sid.substring(3));
          if (p < 10) {
            // Weighted penalty: P9=1, P8=2, P7=3, P6=4
            ssPenalty.push(v.mul(BigInt(10 - p)));
          }
        }
      }
    }
    if (ssPenalty.length > 0) {
      model.minimize(sumVars(ssPenalty));
    }

    // ===== Solve =====
    const solver = new CpSolver();
    solver.parameters.maxTimeInSeconds = 60;
    solver.parameters.numSearchWorkers = 8;

    const status = await solver.solve(model);

    if (status !== CpSolverStatus.OPTIMAL && status !== CpSolverStatus.FEASIBLE) {
      console.error(`  CP-SAT joint solve: ${status}`);
      return A;
    }

    console.log(`  CP-SAT joint solve: ${status === CpSolverStatus.OPTIMAL ? 'OPTIMAL' : 'FEASIBLE'}`);

    // ===== Extract solution (all 3 TCs) =====
    for (let ti = 0; ti < 3; ti++) {
      const stu = this.tcS[ti];
      const tcId = this.tcI[ti];
      const room = this.tcR[ti];

      for (const vm of varMap[ti]) {
        for (const [sid, v] of Object.entries(vm.slotVars)) {
          if (solver.booleanValue(v)) {
            this._add(stu, vm.cid, sid, tcId, 'teaching', room, vm.tid, A);
            break;
          }
        }
      }
    }

    // Fill remaining
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

      // Fill afternoon with SELF_STUDY
      for (let d = 1; d <= 5; d++) {
        while (daily[d - 1] < 10) {
          let filled = false;
          for (const p of [10, 9, 8, 7, 6]) {
            const sid = 'D' + d + 'P' + p;
            if (!occ.has(sid)) {
              this._add([stu], 'SELF_STUDY', sid, stu.id, 'filler', room, null, A);
              daily[d - 1]++; occ.add(sid); filled = true; break;
            }
          }
          if (!filled) break;
        }
      }

      // Move afternoon courses to morning
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
    for (let i = 0; i < iters && temp > 0.05; i++) {
      const stu = this.students[Math.floor(Math.random() * this.students.length)];
      const sA = cur.filter(a => a.student_id === stu.id && (a.class_type === 'teaching' || a.class_type === 'filler'));
      if (sA.length < 2) continue;
      const [ai, aj] = [Math.floor(Math.random() * sA.length), Math.floor(Math.random() * sA.length)];
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
      if (ns < curS || Math.random() < Math.exp(-(ns - curS) / temp)) {
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

module.exports = { CpSatEngine };
