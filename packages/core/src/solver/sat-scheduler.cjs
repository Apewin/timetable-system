/**
 * SAT-based scheduler using logic-solver (MiniSat)
 */
const Logic = require('logic-solver');

class SATScheduler {
  /**
   * @param {Array} courses - [[courseId, hours, teacherId], ...]
   * @param {Set} blocked - blocked "DxPy" slots
   * @param {Array} students - students for conflict checking
   */
  constructor(courses, blocked) {
    this.courses = courses;
    this.blocked = blocked;
    this.solver = new Logic.Solver();
    this.vars = []; // [{courseId, hourIdx, slotId}] → Logic variable

    // Build all valid slots
    this.allSlots = [];
    for (let d = 1; d <= 5; d++) {
      for (let p = 1; p <= 10; p++) {
        const sid = 'D' + d + 'P' + p;
        if (!blocked.has(sid)) this.allSlots.push(sid);
      }
    }
  }

  solve() {
    // Create variables: for each (course, hour), create a variable representing "which slot"
    const courseVars = [];
    for (const [cid, hrs] of this.courses) {
      for (let h = 0; h < hrs; h++) {
        // Create one boolean var per possible slot
        const slotVars = {};
        for (const sid of this.allSlots) {
          slotVars[sid] = `var_${cid}_${h}_${sid}`;
        }
        courseVars.push({ cid, h, slotVars });

        // Exactly one slot per (course, hour)
        const varNames = Object.values(slotVars);
        this.solver.require(Logic.exactlyOne(varNames));
      }
    }

    // Distribution: same course max 1/day for ≤5hr
    for (const [cid, hrs] of this.courses) {
      if (hrs > 5) continue; // skip >5hr (handled separately)
      for (let d = 1; d <= 5; d++) {
        // All hours of this course on day d
        const dayVars = [];
        for (const cv of courseVars) {
          if (cv.cid !== cid) continue;
          for (const [sid, vname] of Object.entries(cv.slotVars)) {
            if (sid.startsWith('D' + d)) dayVars.push(vname);
          }
        }
        if (dayVars.length > 1) {
          this.solver.require(Logic.atMostOne(dayVars));
        }
      }
    }

    // Student conflict: each slot can have at most 1 entry per student
    // (Simplified: we model per-TC, so all students share slots by construction)

    // Teacher conflict: for courses with no teacher, allow any slot
    // For courses with teacher, the teacher conflict is across TCs — handled externally

    // Solve
    const solution = this.solver.solve();
    if (!solution) return null;

    // Extract result
    const result = [];
    const trueVars = solution.getTrueVars();
    for (const cv of courseVars) {
      for (const [sid, vname] of Object.entries(cv.slotVars)) {
        if (trueVars.includes(vname)) {
          result.push([cv.cid, sid]);
          break;
        }
      }
    }
    return result;
  }
}

module.exports = { SATScheduler };
