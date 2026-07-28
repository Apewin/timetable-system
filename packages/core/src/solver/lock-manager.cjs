/**
 * 课表锁定管理器 — 借鉴四维排课 FixedSchedule / ClearFixedSchedule 机制
 * 支持：锁定特定assignment → 部分重排 → 保持锁定不受影响
 */
class LockManager {
  constructor() {
    this.lockedAssignments = new Map(); // task_id → assignment
    this.lockedSlots = new Map();       // student_id → Set<slot_id>
    this.lockedTeacherSlots = new Map();// teacher_id → Set<slot_id>
  }

  /** Lock an assignment (prevents modification during re-scheduling) */
  lock(assignment) {
    this.lockedAssignments.set(assignment.task_id, { ...assignment });

    // Track locked slots per student
    if (!this.lockedSlots.has(assignment.student_id)) {
      this.lockedSlots.set(assignment.student_id, new Set());
    }
    this.lockedSlots.get(assignment.student_id).add(assignment.slot_id);

    // Track locked slots per teacher
    if (assignment.teacher_id) {
      if (!this.lockedTeacherSlots.has(assignment.teacher_id)) {
        this.lockedTeacherSlots.set(assignment.teacher_id, new Set());
      }
      this.lockedTeacherSlots.get(assignment.teacher_id).add(assignment.slot_id);
    }
  }

  /** Unlock by task_id */
  unlock(taskId) {
    const a = this.lockedAssignments.get(taskId);
    if (a) {
      this.lockedSlots.get(a.student_id)?.delete(a.slot_id);
      if (a.teacher_id) this.lockedTeacherSlots.get(a.teacher_id)?.delete(a.slot_id);
      this.lockedAssignments.delete(taskId);
    }
  }

  /** Check if a slot is locked for a student */
  isSlotLocked(studentId, slotId) {
    return this.lockedSlots.get(studentId)?.has(slotId) || false;
  }

  /** Check if a teacher is locked at a slot */
  isTeacherLocked(teacherId, slotId) {
    return this.lockedTeacherSlots.get(teacherId)?.has(slotId) || false;
  }

  /** Check if an assignment is locked */
  isLocked(taskId) {
    return this.lockedAssignments.has(taskId);
  }

  /** Get all locked assignments */
  getLockedAssignments() {
    return [...this.lockedAssignments.values()];
  }

  /** Clear all locks */
  clearAll() {
    this.lockedAssignments.clear();
    this.lockedSlots.clear();
    this.lockedTeacherSlots.clear();
  }

  /** Clear locks for a specific course */
  clearByCourse(courseId, classId) {
    const toRemove = [];
    this.lockedAssignments.forEach((a, taskId) => {
      if (a.course_id === courseId && (!classId || a.class_id === classId)) {
        toRemove.push(taskId);
      }
    });
    toRemove.forEach(id => this.unlock(id));
  }

  /** Merge locked assignments into a new assignment array */
  mergeWithNew(lockedAs, newAs, students) {
    const result = [...newAs];
    lockedAs.forEach(la => {
      // Remove any conflicting new assignment at the locked slot
      const conflictIdx = result.findIndex(a =>
        a.student_id === la.student_id && a.slot_id === la.slot_id
      );
      if (conflictIdx >= 0) result.splice(conflictIdx, 1);
      result.push({ ...la });
    });
    return result;
  }

  /** Count how many locked slots exist per student */
  getLockedCountPerStudent(studentId) {
    return this.lockedSlots.get(studentId)?.size || 0;
  }
}

module.exports = { LockManager };
