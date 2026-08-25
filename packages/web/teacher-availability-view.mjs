const DAY_LABELS = ['周一', '周二', '周三', '周四', '周五'];

export const TEACHER_AVAILABILITY_SLOTS = Array.from({ length: 50 }, (_, index) => ({
  id: `D${Math.floor(index / 10) + 1}P${index % 10 + 1}`,
  day: Math.floor(index / 10) + 1,
  period: index % 10 + 1,
}));

export function teacherAvailabilityEditor({ availableSlots = [] } = {}) {
  const selected = new Set(availableSlots);
  const limited = selected.size > 0;
  const rows = Array.from({ length: 10 }, (_, periodIndex) => {
    const period = periodIndex + 1;
    const cells = DAY_LABELS.map((dayLabel, dayIndex) => {
      const slotId = `D${dayIndex + 1}P${period}`;
      return `<label class="teacher-availability-slot" title="${dayLabel}第 ${period} 节">
        <input type="checkbox" name="available_slots" value="${slotId}"${selected.has(slotId) ? ' checked' : ''}>
        <span>${period}</span>
      </label>`;
    }).join('');
    return `<div class="teacher-availability-row"><strong>第 ${period} 节</strong>${cells}</div>`;
  }).join('');
  return `<div class="teacher-availability-editor">
    <select name="availability_mode">
      <option value="all"${limited ? '' : ' selected'}>所有时段均可排课</option>
      <option value="selected"${limited ? ' selected' : ''}>仅允许下方勾选时段</option>
    </select>
    <div class="teacher-availability-head"><span></span>${DAY_LABELS.map(label => `<strong>${label}</strong>`).join('')}</div>
    <div class="teacher-availability-grid">${rows}</div>
    <small>选择“所有时段”时下方勾选不会限制排课；选择“仅允许”后，至少勾选一个时段。</small>
  </div>`;
}

export function teacherAvailableSlotsFromForm(formData) {
  if (formData.get('availability_mode') !== 'selected') return [];
  const slots = [...new Set(formData.getAll('available_slots').map(String))];
  if (!slots.length) throw new Error('请选择至少勾选一个可用时段');
  return slots;
}

export function teacherAvailabilitySummary(availableSlots = []) {
  return availableSlots.length ? `限定 ${availableSlots.length} 个时段` : '所有时段';
}
