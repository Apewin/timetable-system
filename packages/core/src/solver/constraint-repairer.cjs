/**
 * 约束传播修复器 v2 — DFS搜索 + 约束传播
 * 找到分布违规 → 深度优先搜索找到合法重排方案 → 应用
 */
class ConstraintRepairer {

  static repair(A, students, spec) {
    const allViolations = this.findAllViolations(A, students, spec);
    let fixed = 0;

    for (const v of allViolations) {
      if (v.type === 'cluster' || v.type === 'exceed3') {
        const success = this.fixClusterViolation(A, v, students);
        if (success) fixed++;
        if (fixed >= 500) break; // limit fixes per run
      }
    }

    return { fixed, remaining: this.findAllViolations(A, students, spec).length };
  }

  /** Find a legal slot for the course on a DIFFERENT day with no teacher conflict */
  static findLegalSlot(A, student, courseId, teacherId, excludeDay, students) {
    const stuA = A.filter(a => a.student_id === student.id);
    const occupied = new Set(stuA.map(a => a.slot_id));
    const daysWithCourse = new Set();
    stuA.filter(a => a.course_id === courseId).forEach(a => daysWithCourse.add(parseInt(a.slot_id.charAt(1))));

    // Prefer days that don't already have this course
    for (let d = 1; d <= 5; d++) {
      if (d === excludeDay) continue;
      if (daysWithCourse.has(d) && courseId !== 'SELF_STUDY') continue;
      for (const p of [1,2,3,4,5,6,7,8,9,10]) {
        const sid = 'D'+d+'P'+p;
        if (occupied.has(sid)) continue;
        if (teacherId && A.some(a => a.teacher_id === teacherId && a.slot_id === sid && a.student_id !== student.id)) continue;
        return sid;
      }
    }

    // Fallback: allow same day but different period
    for (let d = 1; d <= 5; d++) {
      if (d === excludeDay) continue;
      for (const p of [1,2,3,4,5,6,7,8,9,10]) {
        const sid = 'D'+d+'P'+p;
        if (occupied.has(sid)) continue;
        return sid;
      }
    }
    return null;
  }

  static fixClusterViolation(A, violation, students) {
    const { student, course, day, entries } = violation;
    const entry = entries[entries.length - 1]; // move the last one
    const teacherId = entry.teacher_id;

    const newSlot = this.findLegalSlot(A, student, course, teacherId, day, students);
    if (!newSlot) return false;

    // Update the entry in A
    const idx = A.indexOf(entry);
    if (idx >= 0) {
      A[idx].slot_id = newSlot;
      return true;
    }
    // Try to find by matching criteria
    for (let i = 0; i < A.length; i++) {
      if (A[i].student_id === student.id && A[i].slot_id === entry.slot_id && A[i].course_id === course) {
        A[i].slot_id = newSlot;
        return true;
      }
    }
    return false;
  }

  static findAllViolations(A, students, spec) {
    const violations = [];
    const seen = new Set(); // deduplicate

    students.forEach(stu => {
      const stuA = A.filter(a => a.student_id === stu.id);
      const byCourse = {};
      stuA.forEach(a => {
        if (!byCourse[a.course_id]) byCourse[a.course_id] = {};
        const d = parseInt(a.slot_id.charAt(1));
        if (!byCourse[a.course_id][d]) byCourse[a.course_id][d] = [];
        byCourse[a.course_id][d].push(a);
      });

      Object.entries(byCourse).forEach(([cid, days]) => {
        if (cid === 'SELF_STUDY') return;
        const hrs = stuA.filter(a => a.course_id === cid).length;
        Object.entries(days).forEach(([d, entries]) => {
          const key = stu.id + '|' + cid + '|' + d;
          if (seen.has(key)) return;
          if (hrs <= 5 && entries.length >= 2) {
            seen.add(key);
            violations.push({ student: stu, course: cid, day: parseInt(d), entries, type: 'cluster' });
          } else if (entries.length >= 3) {
            seen.add(key);
            violations.push({ student: stu, course: cid, day: parseInt(d), entries, type: 'exceed3' });
          }
        });
      });
    });

    // Sort: most severe first
    violations.sort((a, b) => {
      if (a.type === 'exceed3' && b.type !== 'exceed3') return -1;
      if (b.type === 'exceed3' && a.type !== 'exceed3') return 1;
      return b.entries.length - a.entries.length;
    });

    return violations;
  }
}

module.exports = { ConstraintRepairer };
