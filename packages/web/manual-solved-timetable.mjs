function meetingKey(sectionId, slotId) {
  return `${String(sectionId || '').trim()}\u0000${String(slotId || '').trim()}`;
}

function sectionIdsForSlot(slot = {}) {
  const ids = Array.isArray(slot.split_groups)
    ? slot.split_groups.map(group => group?.section_id)
    : [slot.section_id];
  return [...new Set(ids.filter(Boolean))];
}

export function manualSolvedCellsBySlot(timetable = {}, locks = []) {
  const lockKeys = new Set((locks || []).map(lock => meetingKey(lock.section_id, lock.slot_id)));
  const cells = new Map();
  for (const [rowIndex, row] of (timetable.rows || []).entries()) {
    for (let day = 1; day <= 5; day++) {
      const slot = row?.[day];
      if (!slot) continue;
      const slotId = slot.slot_id || `D${day}P${rowIndex + 1}`;
      const sectionIds = sectionIdsForSlot(slot);
      const lockedCount = sectionIds.filter(sectionId => lockKeys.has(meetingKey(sectionId, slotId))).length;
      const manualLockState = lockedCount === 0
        ? 'none'
        : lockedCount === sectionIds.length
          ? 'all'
          : 'partial';
      cells.set(slotId, {
        ...slot,
        slot_id: slotId,
        section_ids: sectionIds,
        manual_lock_state: manualLockState,
      });
    }
  }
  return cells;
}
