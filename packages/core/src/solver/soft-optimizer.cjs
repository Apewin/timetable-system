/**
 * 软约束优化器 — CP-SAT 保证硬约束合法后，局部搜索优化软目标
 * 基于 2026 研究：CP-SAT + Local Search hybrid
 *
 * 软目标：
 * 1. 早上自习最小化（优先下午）
 * 2. 连续同槽避免（同课同时段连天）
 * 3. 教师 P1 连续避免
 */
class SoftOptimizer {
  /**
   * @param {Array} A - assignments (modified in place)
   * @param {Array} students - all students
   */
  static optimize(A, students) {
    let totalSwaps = 0;

    // Phase 1: Eliminate morning self-study
    totalSwaps += SoftOptimizer.eliminateMorningSS(A, students);

    // Phase 2: Reduce consecutive same-slot
    totalSwaps += SoftOptimizer.reduceConsecutiveSame(A, students);

    return { swaps: totalSwaps };
  }

  /** Move self-study from morning to afternoon */
  static eliminateMorningSS(A, students) {
    // Build teacher-at-slot index
    const teacherSlots = {};
    A.forEach(a => {
      if (!a.teacher_id) return;
      const key = a.teacher_id + '@' + a.slot_id;
      teacherSlots[key] = (teacherSlots[key] || 0) + 1;
    });

    let swaps = 0;
    for (let pass = 0; pass < 20; pass++) {
      let passSwaps = 0;
      students.forEach(stu => {
        const stuA = A.filter(a => a.student_id === stu.id);
        const morningSS = stuA.filter(a =>
          a.course_id === 'SELF_STUDY' &&
          a.class_type !== 'admin' &&
          parseInt(a.slot_id.substring(3)) <= 5
        );
        const afternoonCourses = stuA.filter(a =>
          a.course_id !== 'SELF_STUDY' &&
          a.class_type !== 'admin' &&
          !['DUTY', 'MEETING', 'CLUB'].includes(a.course_id) &&
          parseInt(a.slot_id.substring(3)) >= 6
        );

        for (const ss of morningSS) {
          const morningSlot = ss.slot_id;
          for (let i = 0; i < afternoonCourses.length; i++) {
            const ac = afternoonCourses[i];
            const afternoonSlot = ac.slot_id;

            // Check: can ac's teacher go to the morning slot?
            let conflict = false;
            if (ac.teacher_id) {
              const key = ac.teacher_id + '@' + morningSlot;
              if (teacherSlots[key] > 0) conflict = true;
            }

            // Check: distribution rules preserved — ac course: ≤5hr max 1/day on morning day
            const acDay = parseInt(morningSlot.charAt(1));
            const acHours = stuA.filter(a => a.course_id === ac.course_id).length;
            if (acHours <= 5) {
              const onTargetDay = stuA.filter(a =>
                a.course_id === ac.course_id &&
                a.slot_id.startsWith('D' + acDay) &&
                a !== ac
              ).length;
              if (onTargetDay >= 1) conflict = true; // would create 2 on same day
            }

            if (!conflict) {
              // Update teacher index
              if (ac.teacher_id) {
                teacherSlots[ac.teacher_id + '@' + afternoonSlot]--;
                teacherSlots[ac.teacher_id + '@' + morningSlot] = (teacherSlots[ac.teacher_id + '@' + morningSlot] || 0) + 1;
              }
              // Swap
              ac.slot_id = morningSlot;
              ss.slot_id = afternoonSlot;
              afternoonCourses.splice(i, 1);
              passSwaps++;
              break;
            }
          }
        }
      });
      swaps += passSwaps;
      if (passSwaps === 0) break;
    }
    return swaps;
  }

  /** Reduce same course at same period on consecutive days */
  static reduceConsecutiveSame(A, students) {
    let swaps = 0;
    students.forEach(stu => {
      const stuA = A.filter(a => a.student_id === stu.id);
      const slotByCourse = {}; // course_id → Map<period, Set<day>>
      stuA.forEach(a => {
        if (a.course_id === 'SELF_STUDY') return;
        const p = parseInt(a.slot_id.substring(3));
        const d = parseInt(a.slot_id.charAt(1));
        if (!slotByCourse[a.course_id]) slotByCourse[a.course_id] = {};
        if (!slotByCourse[a.course_id][p]) slotByCourse[a.course_id][p] = new Set();
        slotByCourse[a.course_id][p].add(d);
      });

      Object.entries(slotByCourse).forEach(([cid, periods]) => {
        Object.entries(periods).forEach(([p, days]) => {
          const sorted = [...days].sort((a, b) => a - b);
          // Find 3+ consecutive days at same period
          let runStart = 0;
          for (let i = 1; i <= sorted.length; i++) {
            if (i < sorted.length && sorted[i] === sorted[i - 1] + 1) continue;
            // End of run
            const runLen = i - runStart;
            if (runLen >= 3) {
              // Move middle occurrence to a nearby free slot
              const midDay = sorted[runStart + 1]; // second day in the run
              const oldSlot = 'D' + midDay + 'P' + p;
              // Find alternative slot on same day, different period
              for (const newP of [p + 2, p - 2, p + 3, p - 3, p + 1, p - 1]) {
                if (newP < 1 || newP > 10) continue;
                const newSlot = 'D' + midDay + 'P' + newP;
                if (stuA.some(a => a.slot_id === newSlot)) continue;
                // Check distribution: ≤5hr max 1/day (already 1 at old slot on this day, moving preserves it)
                const entry = A.find(a => a.student_id === stu.id && a.slot_id === oldSlot && a.course_id === cid);
                if (entry) {
                  // Teacher conflict check
                  if (entry.teacher_id && A.some(a => a.teacher_id === entry.teacher_id && a.slot_id === newSlot && a.student_id !== stu.id)) continue;
                  entry.slot_id = newSlot;
                  swaps++;
                  break;
                }
              }
            }
            runStart = i;
          }
        });
      });
    });
    return swaps;
  }
}

module.exports = { SoftOptimizer };
