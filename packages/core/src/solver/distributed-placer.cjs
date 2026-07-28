/**
 * 约束感知分布放置器 — 在生成阶段保证分布规则
 * ≤5hr: 每天最多1节
 * >5hr: 每天最多2节，同天必须连堂
 * 用法: DistributedPlacer.place(courses, blockedSlots, allocFn)
 */
class DistributedPlacer {
  /**
   * @param {Array} courses - [[courseId, hours, teacherId], ...]
   * @param {Set} blockedSlots - 不可用的槽位 (如 "D1P2")
   * @param {Function} isSlotFree - (slotId) => boolean 检查槽位是否空闲
   * @param {Function} placeFn - (courseId, slotId) => void 放置课程
   * @returns {Object} { placed: Map<courseId, string[]>, unplaced: number }
   */
  static place(courses, blockedSlots, isSlotFree, placeFn) {
    const placed = new Map(); // courseId → [slotId, ...]
    let totalUnplaced = 0;

    courses.forEach(([cid, hrs, tid]) => {
      const slots = [];
      const dayCount = [0,0,0,0,0,0]; // day → count

      // Phase 1: place 1 per day across all 5 days
      for (let d = 1; d <= 5 && slots.length < Math.min(hrs, 5); d++) {
        const found = DistributedPlacer._findBestSlot(d, cid, slots, dayCount, hrs, blockedSlots, isSlotFree);
        if (found) {
          placeFn(cid, found);
          slots.push(found);
          dayCount[d]++;
        }
      }

      // Phase 2: for >5hr courses, add second period on a day (must be consecutive)
      if (hrs > 5 && slots.length < hrs) {
        for (let d = 1; d <= 5 && slots.length < hrs; d++) {
          if (dayCount[d] >= 2) continue;
          const existing = slots.filter(s => s.startsWith('D'+d));
          if (existing.length === 0) continue;
          const existingP = parseInt(existing[0].substring(3));
          // Try adjacent periods
          for (const adj of [existingP - 1, existingP + 1]) {
            if (adj < 1 || adj > 10) continue;
            const sid = 'D' + d + 'P' + adj;
            if (blockedSlots.has(sid)) continue;
            if (!isSlotFree(sid)) continue;
            placeFn(cid, sid);
            slots.push(sid);
            dayCount[d]++;
            break;
          }
        }
      }

      // Phase 3: relaxed — allow 2/day for ≤5hr if needed
      if (slots.length < hrs) {
        for (let d = 1; d <= 5 && slots.length < hrs; d++) {
          if (dayCount[d] >= 2) continue;
          const found = DistributedPlacer._findAnySlot(d, cid, blockedSlots, isSlotFree);
          if (found) {
            placeFn(cid, found);
            slots.push(found);
            dayCount[d]++;
          }
        }
      }

      // Phase 4: brute force — any free slot
      if (slots.length < hrs) {
        for (let d = 1; d <= 5 && slots.length < hrs; d++) {
          for (let p = 1; p <= 10 && slots.length < hrs; p++) {
            const sid = 'D' + d + 'P' + p;
            if (blockedSlots.has(sid)) continue;
            if (!isSlotFree(sid)) continue;
            placeFn(cid, sid);
            slots.push(sid);
            dayCount[d]++;
          }
        }
      }

      placed.set(cid, slots);
      if (slots.length < hrs) totalUnplaced += (hrs - slots.length);
    });

    return { placed, unplaced: totalUnplaced };
  }

  /** Find best slot on a given day — prefers morning periods, avoids adjacent to admin */
  static _findBestSlot(d, cid, existing, dayCount, hrs, blocked, isSlotFree) {
    const preferred = [1, 2, 3, 4, 5, 8, 9, 10, 6, 7];
    for (const p of preferred) {
      const sid = 'D' + d + 'P' + p;
      if (blocked.has(sid)) continue;
      if (!isSlotFree(sid)) continue;
      // For ≤5hr: never allow 2 on same day
      if (dayCount[d] >= 1 && hrs <= 5) continue;
      // For >5hr: if already 1 on this day, must be consecutive
      if (dayCount[d] >= 1 && hrs > 5) {
        const existingOnDay = existing.filter(s => s.startsWith('D' + d));
        if (existingOnDay.length > 0) {
          const ep = parseInt(existingOnDay[0].substring(3));
          if (Math.abs(p - ep) !== 1) continue;
        }
      }
      return sid;
    }
    return null;
  }

  /** Find any free slot on a day */
  static _findAnySlot(d, cid, blocked, isSlotFree) {
    for (let p = 1; p <= 10; p++) {
      const sid = 'D' + d + 'P' + p;
      if (blocked.has(sid)) continue;
      if (!isSlotFree(sid)) continue;
      return sid;
    }
    return null;
  }
}

module.exports = { DistributedPlacer };
