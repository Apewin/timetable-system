/**
 * 课程课时强制修正器 — 确保每个学生的每门课都恰好符合Excel规格
 * 借鉴四维排课 DtRuleCounter 的 Before/After 对比思路
 */
class CourseCorrector {
  /**
   * 修正学生课程课时
   * @param {Array} A - assignments 数组（会被原地修改）
   * @param {Array} students - 学生列表
   * @param {Object} courseSpec - { courseId: { hrs, teacher, type } }
   * @param {Function} allocFn - (stu, cid, sid, room, tid) => 创建assignment
   * @param {Function} getRoom - (stu) => roomId
   * @returns {Object} { fixed, added, removed, remaining }
   */
  static enforce(A, students, courseSpec, allocFn, getRoom) {
    const stats = { fixed: 0, added: 0, removed: 0, remaining: 0 };

    students.forEach(stu => {
      const stuAs = A.filter(a => a.student_id === stu.id);
      const room = getRoom(stu);

      Object.entries(courseSpec).forEach(([cid, spec]) => {
        const hrs = spec.hrs;
        if (!hrs || hrs === 0) return;
        let current = stuAs.filter(a => a.course_id === cid).length;

        // Remove excess
        while (current > hrs) {
          const extras = stuAs.filter(a => a.course_id === cid && a.class_type !== 'admin');
          if (extras.length === 0) break;
          // Remove the one that appears most clustered (same day)
          const byDay = {};
          extras.forEach(a => { const d = a.slot_id.charAt(1); byDay[d] = (byDay[d] || 0) + 1; });
          extras.sort((a, b) => (byDay[b.slot_id.charAt(1)] || 0) - (byDay[a.slot_id.charAt(1)] || 0));
          const toRemove = extras[0];
          const idx = A.indexOf(toRemove);
          if (idx >= 0) { A.splice(idx, 1); current--; stats.removed++; }
        }

        // Add missing
        let attempts = 0;
        while (current < hrs && attempts < 50) {
          attempts++;
          let added = false;

          // Try empty slots (prefer afternoon for self-study, morning for courses)
          const preferAfternoon = cid === 'SELF_STUDY';
          const periods = preferAfternoon
            ? [10, 9, 8, 7, 6, 5, 4, 3, 2, 1]
            : [1, 2, 3, 4, 5, 8, 9, 10, 6, 7];

          for (let d = 1; d <= 5 && !added; d++) {
            for (const p of periods) {
              if (added) break;
              const sid = 'D' + d + 'P' + p;
              if (stuAs.some(a => a.slot_id === sid)) continue;
              if (spec.teacher && A.some(a => a.teacher_id === spec.teacher && a.slot_id === sid && a.course_id !== cid)) continue;
              allocFn([stu], cid, sid, room, spec.teacher, 'teaching');
              stuAs.push({ student_id: stu.id, slot_id: sid, course_id: cid });
              current++; stats.added++; added = true;
            }
          }

          // Steal from self-study (for non-SS courses)
          if (!added && cid !== 'SELF_STUDY') {
            for (let d = 1; d <= 5 && !added; d++) {
              for (const p of [10, 9, 8, 7, 6, 5, 4, 3, 2, 1]) {
                if (added) break;
                const sid = 'D' + d + 'P' + p;
                if (spec.teacher && A.some(a => a.teacher_id === spec.teacher && a.slot_id === sid && a.course_id !== cid)) continue;
                const ssIdx = A.findIndex(a => a.student_id === stu.id && a.slot_id === sid && a.course_id === 'SELF_STUDY' && a.class_type !== 'admin');
                if (ssIdx >= 0) {
                  A.splice(ssIdx, 1);
                  const ssInStu = stuAs.findIndex(a => a.slot_id === sid && a.course_id === 'SELF_STUDY');
                  if (ssInStu >= 0) stuAs.splice(ssInStu, 1);
                  allocFn([stu], cid, sid, room, spec.teacher, 'teaching');
                  stuAs.push({ student_id: stu.id, slot_id: sid, course_id: cid });
                  current++; stats.added++; stats.removed++; added = true;
                }
              }
            }
          }

          // Last resort: clear any non-admin, non-fixed entry for this student
          if (!added && cid !== 'SELF_STUDY') {
            for (let d = 1; d <= 5 && !added; d++) {
              for (const p of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]) {
                if (added) break;
                const sid = 'D' + d + 'P' + p;
                if (spec.teacher && A.some(a => a.teacher_id === spec.teacher && a.slot_id === sid && a.course_id !== cid)) continue;
                const entry = A.findIndex(a => a.student_id === stu.id && a.slot_id === sid && a.class_type !== 'admin' && !['DUTY', 'MEETING', 'CLUB'].includes(a.course_id) && a.course_id !== cid);
                if (entry >= 0) {
                  const oldCourse = A[entry].course_id;
                  A.splice(entry, 1);
                  const si = stuAs.findIndex(a => a.slot_id === sid && a.course_id === oldCourse);
                  if (si >= 0) stuAs.splice(si, 1);
                  allocFn([stu], cid, sid, room, spec.teacher, 'teaching');
                  stuAs.push({ student_id: stu.id, slot_id: sid, course_id: cid });
                  current++; stats.added++; stats.removed++; added = true;
                }
              }
            }
          }

          if (!added) { stats.remaining++; break; }
        }
      });
    });

    return stats;
  }
}

module.exports = { CourseCorrector };
