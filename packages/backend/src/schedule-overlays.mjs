const SLOT_PATTERN = /^D([1-5])P([1-9]|10)$/;
const OVERLAY_KINDS = new Set(['self_study', 'special_event']);
const COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;

function positiveInteger(value, fallback = 1) {
  const parsed = Number(value ?? fallback);
  if (!Number.isInteger(parsed) || parsed < 1) throw new Error('持续节数必须是正整数');
  return parsed;
}

export function overlaySlotIds(startSlotId, duration = 1) {
  const match = SLOT_PATTERN.exec(String(startSlotId || ''));
  if (!match) throw new Error('特殊事件的起始时段无效');
  const day = Number(match[1]);
  const startPeriod = Number(match[2]);
  const length = positiveInteger(duration);
  if (startPeriod + length - 1 > 10) throw new Error('特殊事件不能跨越当天第 10 节课');
  return Array.from({ length }, (_, index) => `D${day}P${startPeriod + index}`);
}

export function createScheduleOverlay(existingOverlays = [], input = {}) {
  const id = String(input.id || '').trim();
  const classId = String(input.class_id || '').trim();
  const kind = String(input.kind || '').trim();
  const title = String(input.title || '').trim();
  if (!id) throw new Error('课表标注缺少 ID');
  if (!classId) throw new Error('课表标注缺少班级');
  if (!OVERLAY_KINDS.has(kind)) throw new Error('不支持的课表标注类型');
  if (!title) throw new Error('课表标注需要名称');

  const slotIds = overlaySlotIds(input.start_slot_id, kind === 'self_study' ? 1 : input.duration);
  const color = kind === 'self_study' ? '#607d8b' : String(input.color || '#7e57c2');
  if (!COLOR_PATTERN.test(color)) throw new Error('特殊事件颜色必须是六位十六进制颜色');
  const usedSlots = new Set((existingOverlays || [])
    .filter(item => item?.class_id === classId)
    .flatMap(item => item.slot_ids || []));
  if (slotIds.some(slotId => usedSlots.has(slotId))) {
    throw new Error('特殊事件不能覆盖已有的自习或特殊事件');
  }

  return {
    id,
    class_id: classId,
    kind,
    title,
    color,
    slot_ids: slotIds,
  };
}
