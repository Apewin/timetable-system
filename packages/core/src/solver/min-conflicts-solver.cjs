/**
 * Min-Conflicts CSP Solver for course scheduling
 * Based on: Russell & Norvig, "Artificial Intelligence: A Modern Approach"
 * Algorithm: start with greedy assignment, iteratively repair conflicts
 */
class MinConflictsSolver {
  /**
   * @param {Array} courses - [[courseId, hours, teacherId], ...] per TC
   * @param {Set} blocked - Set of "DxPy" slots that are admin-blocked
   * @param {Array} students - students in this TC
   * @param {Function} isSlotFree - (slotId) => boolean (student conflict)
   * @param {Function} teacherConflict - (teacherId, slotId) => boolean
   */
  constructor(courses, blocked, students, isSlotFree, teacherConflict) {
    this.courses = courses;
    this.blocked = blocked;
    this.students = students;
    this.isSlotFree = isSlotFree;
    this.teacherConflict = teacherConflict;
    this.assignment = new Map(); // "courseId_periodIndex" → "DxPy"
    this.maxSteps = 50000;
  }

  /** Build initial greedy assignment (one period per day, distribute) */
  initialAssignment() {
    this.assignment.clear();
    const allSlots = [];
    for (let d = 1; d <= 5; d++) {
      for (let p = 1; p <= 10; p++) {
        const sid = 'D' + d + 'P' + p;
        if (!this.blocked.has(sid)) allSlots.push(sid);
      }
    }

    // Shuffle slots for randomness
    for (let i = allSlots.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [allSlots[i], allSlots[j]] = [allSlots[j], allSlots[i]];
    }

    let slotIdx = 0;
    for (const [cid, hrs, tid] of this.courses) {
      for (let h = 0; h < hrs; h++) {
        const key = cid + '::' + h;
        // Find a valid slot
        let found = false;
        for (let attempt = 0; attempt < allSlots.length; attempt++) {
          const sid = allSlots[(slotIdx + attempt) % allSlots.length];
          if (!this.isSlotFree(sid)) continue;
          if (tid && this.teacherConflict(tid, sid)) continue;
          // Distribution: ≤5hr max 1/day on same course
          const d = parseInt(sid.charAt(1));
          let sameDay = 0;
          for (let h2 = 0; h2 < h; h2++) {
            const prevKey = cid + '::' + h2;
            const prevSlot = this.assignment.get(prevKey);
            if (prevSlot && prevSlot.startsWith('D' + d)) sameDay++;
          }
          if (sameDay >= 1 && hrs <= 5) continue;
          if (sameDay >= 2) continue;
          this.assignment.set(key, sid);
          slotIdx = (slotIdx + attempt + 1) % allSlots.length;
          found = true;
          break;
        }
        if (!found) {
          // Fallback: any free slot
          for (const sid of allSlots) {
            if (!this.isSlotFree(sid)) continue;
            this.assignment.set(key, sid);
            found = true;
            break;
          }
        }
        if (!found) {
          // Last resort: any non-blocked slot
          for (const sid of allSlots) {
            this.assignment.set(key, sid);
            found = true;
            break;
          }
        }
      }
    }
  }

  /** Count conflicts for a variable at a given value */
  countConflicts(cid, h, sid) {
    const hrs = this.courses.find(c => c[0] === cid)?.[1] || 0;
    const tid = this.courses.find(c => c[0] === cid)?.[2];
    let conflicts = 0;

    const d = parseInt(sid.charAt(1));
    const p = parseInt(sid.substring(3));

    // Student conflict
    if (!this.isSlotFree(sid)) conflicts += 100;

    // Teacher conflict
    if (tid && this.teacherConflict(tid, sid)) conflicts += 100;

    // Distribution: same course on same day (≤5hr: max 1, >5hr: max 2 consecutive)
    let sameDay = 0;
    const sameDayPeriods = [];
    for (let h2 = 0; h2 < hrs; h2++) {
      if (h2 === h) continue;
      const key = cid + '_' + h2;
      const s = this.assignment.get(key);
      if (s && s.startsWith('D' + d)) {
        sameDay++;
        sameDayPeriods.push(parseInt(s.substring(3)));
      }
    }
    if (hrs <= 5 && sameDay >= 1) conflicts += 10000;
    if (sameDay >= 2) conflicts += 50000;
    if (hrs > 5 && sameDay === 1) {
      sameDayPeriods.push(p);
      sameDayPeriods.sort((a,b)=>a-b);
      for (let i = 1; i < sameDayPeriods.length; i++) {
        if (sameDayPeriods[i] - sameDayPeriods[i-1] !== 1) conflicts += 10;
      }
    }

    return conflicts;
  }

  /** Get all currently occupied slots */
  getOccupiedSlots() {
    const occ = new Set();
    for (const [, sid] of this.assignment) occ.add(sid);
    return occ;
  }

  /** Run min-conflicts algorithm */
  solve() {
    this.initialAssignment();

    const allCourses = [];
    for (const [cid, hrs] of this.courses) {
      for (let h = 0; h < hrs; h++) allCourses.push([cid, h]);
    }

    const allSlots = [];
    for (let d = 1; d <= 5; d++) {
      for (let p = 1; p <= 10; p++) {
        const sid = 'D' + d + 'P' + p;
        if (!this.blocked.has(sid)) allSlots.push(sid);
      }
    }

    for (let step = 0; step < this.maxSteps; step++) {
      // Find conflicted variables
      const conflicted = [];
      for (const [cid, h] of allCourses) {
        const sid = this.assignment.get(cid + '_' + h);
        if (!sid) continue;
        if (this.countConflicts(cid, h, sid) > 0) {
          conflicted.push([cid, h]);
        }
      }

      if (conflicted.length === 0) return true; // Solved!

      // Pick a random conflicted variable
      const [cid, h] = conflicted[Math.floor(Math.random() * conflicted.length)];

      // Find the value that minimizes conflicts
      let bestSid = this.assignment.get(cid + '_' + h);
      let bestConflicts = this.countConflicts(cid, h, bestSid);
      let bestSameDayFine = false;

      // Shuffle slots for tie-breaking
      const shuffled = [...allSlots].sort(() => Math.random() - 0.5);
      for (const sid of shuffled) {
        const c = this.countConflicts(cid, h, sid);
        if (c < bestConflicts || (c === bestConflicts && !bestSameDayFine && c === 0)) {
          bestConflicts = c;
          bestSid = sid;
        }
      }

      this.assignment.set(cid + '_' + h, bestSid);
    }

    return false; // Did not converge
  }

  /** Get the solved assignments as [[cid, sid], ...] */
  getResult() {
    const result = [];
    for (const [key, sid] of this.assignment) {
      const [cid, h] = key.split('::');
      result.push([cid, sid]);
    }
    return result;
  }
}

module.exports = { MinConflictsSolver };
