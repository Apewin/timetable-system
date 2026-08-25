function text(value) {
  return String(value ?? '').trim();
}

function integer(value, label, minimum, maximum) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${label}必须是 ${minimum}–${maximum} 范围内的整数`);
  }
  return parsed;
}

function generatedRoomName(index) {
  let value = index + 1;
  let suffix = '';
  while (value > 0) {
    value -= 1;
    suffix = String.fromCharCode(65 + (value % 26)) + suffix;
    value = Math.floor(value / 26);
  }
  return `考场 ${suffix}`;
}

function canonicalName(value) {
  return text(value).normalize('NFKC').toLocaleLowerCase('zh-CN');
}

export function normalizeExamRoomCatalog(rawRooms, {
  fallbackCapacity = 30,
  allowEmpty = false,
} = {}) {
  if (!Array.isArray(rawRooms)) throw new Error('考场名单必须是数组');
  if (!allowEmpty && rawRooms.length === 0) throw new Error('请先添加至少一个考场');
  if (rawRooms.length > 100) throw new Error('考场数量不能超过 100 个');
  const defaultCapacity = integer(fallbackCapacity, '默认考场容量', 1, 200);
  const rooms = rawRooms.map((room, index) => ({
    id: text(room?.id) || `EXAM_ROOM_${index + 1}`,
    name: text(room?.name) || generatedRoomName(index),
    capacity: integer(room?.capacity ?? defaultCapacity, `第 ${index + 1} 个考场容量`, 1, 200),
  }));
  if (new Set(rooms.map(room => room.id)).size !== rooms.length) {
    throw new Error('考场 ID 不能重复');
  }
  if (new Set(rooms.map(room => canonicalName(room.name))).size !== rooms.length) {
    throw new Error('考场名称不能重复');
  }
  return rooms;
}

function legacyExamRooms(state) {
  const config = state?.exam_plan?.config;
  if (!config || typeof config !== 'object') return [];
  const fallbackCapacity = Number(config.room_capacity) || 30;
  if (Array.isArray(config.rooms) && config.rooms.length) {
    return normalizeExamRoomCatalog(config.rooms, { fallbackCapacity });
  }
  const roomCount = Number(config.room_count);
  if (!Number.isInteger(roomCount) || roomCount < 1 || roomCount > 100) return [];
  return normalizeExamRoomCatalog(
    Array.from({ length: roomCount }, () => ({ capacity: fallbackCapacity })),
    { fallbackCapacity },
  );
}

export function examRoomCatalogForState(state = {}) {
  if (Array.isArray(state.exam_rooms)) {
    return normalizeExamRoomCatalog(state.exam_rooms, { allowEmpty: true });
  }
  return legacyExamRooms(state);
}

export function examPlanUsingRoomCatalog(rawPlan, rooms) {
  if (!rawPlan || typeof rawPlan !== 'object' || Array.isArray(rawPlan) || rooms.length === 0) {
    return rawPlan;
  }
  const normalizedRooms = normalizeExamRoomCatalog(rooms);
  return {
    ...rawPlan,
    config: {
      ...(rawPlan.config || {}),
      rooms: normalizedRooms,
      room_count: normalizedRooms.length,
      room_capacity: normalizedRooms[0].capacity,
    },
  };
}

export function stateWithExamRoomCatalog(state = {}, rawRooms = []) {
  const rooms = normalizeExamRoomCatalog(rawRooms);
  const next = { ...state, exam_rooms: rooms };
  if (state.exam_plan) next.exam_plan = examPlanUsingRoomCatalog(state.exam_plan, rooms);
  if (state.exam_plan || state.exam_schedule || state.exam_solve_status) {
    next.exam_schedule = null;
    next.exam_solve_status = 'not_run';
  }
  return next;
}
