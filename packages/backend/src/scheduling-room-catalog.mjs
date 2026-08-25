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

function canonicalName(value) {
  return text(value).normalize('NFKC').toLocaleLowerCase('zh-CN');
}

export function normalizeSchedulingRooms(rawRooms) {
  if (!Array.isArray(rawRooms)) throw new Error('教室名单必须是数组');
  if (rawRooms.length > 500) throw new Error('教室数量不能超过 500 个');
  const rooms = rawRooms.map((room, index) => {
    if (!room || typeof room !== 'object' || Array.isArray(room)) {
      throw new Error(`第 ${index + 1} 个教室格式无效`);
    }
    const id = text(room.id);
    const name = text(room.name);
    const type = text(room.type) || 'general';
    if (!id) throw new Error(`第 ${index + 1} 个教室缺少 ID`);
    if (!name) throw new Error(`第 ${index + 1} 个教室名称不能为空`);
    return {
      ...structuredClone(room),
      id,
      name,
      type,
      capacity: integer(room.capacity ?? 30, `第 ${index + 1} 个教室容量`, 1, 500),
    };
  });
  if (new Set(rooms.map(room => canonicalName(room.id))).size !== rooms.length) {
    throw new Error('教室 ID 不能重复');
  }
  if (new Set(rooms.map(room => canonicalName(room.name))).size !== rooms.length) {
    throw new Error('教室名称不能重复');
  }
  return rooms;
}

export function normalizeSchedulingRoomRenames(rawRenames, { currentRooms = [], nextRooms = [] } = {}) {
  if (rawRenames == null) return [];
  if (!Array.isArray(rawRenames)) throw new Error('教室 ID 修改记录必须是数组');
  if (rawRenames.length > 500) throw new Error('教室 ID 修改记录不能超过 500 条');
  const currentIds = new Set(currentRooms.map(room => text(room.id)));
  const nextIds = new Set(nextRooms.map(room => text(room.id)));
  const renames = rawRenames.map((rename, index) => {
    const from = text(rename?.from);
    const to = text(rename?.to);
    if (!from || !to) throw new Error(`第 ${index + 1} 条教室 ID 修改记录不完整`);
    if (!currentIds.has(from)) throw new Error(`原教室 ID 不存在: ${from}`);
    if (!nextIds.has(to)) throw new Error(`新教室 ID 不存在于待保存名单: ${to}`);
    if (from !== to && nextIds.has(from)) throw new Error(`修改 ID 后旧教室 ID 仍然存在: ${from}`);
    return { from, to };
  }).filter(rename => rename.from !== rename.to);
  if (new Set(renames.map(rename => canonicalName(rename.from))).size !== renames.length) {
    throw new Error('同一个教室 ID 不能重复修改');
  }
  if (new Set(renames.map(rename => canonicalName(rename.to))).size !== renames.length) {
    throw new Error('多个教室不能修改为同一个 ID');
  }
  return renames;
}

function renameRoomRecord(record, renameId) {
  if (!record || typeof record !== 'object') return record;
  const renamed = { ...record };
  if (typeof record.room_id === 'string') renamed.room_id = renameId(record.room_id);
  if (Array.isArray(record.room_candidates)) {
    renamed.room_candidates = record.room_candidates.map(renameId);
  }
  return renamed;
}

export function renameSchedulingRoomReferences(state, renames = []) {
  if (!renames.length) return state;
  const renameMap = new Map(renames.map(rename => [rename.from, rename.to]));
  const renameId = value => renameMap.get(value) || value;
  const renameFixedRooms = items => (items || []).map(item => ({
    ...item,
    ...(typeof item.fixed_room_id === 'string'
      ? { fixed_room_id: renameId(item.fixed_room_id) }
      : {}),
  }));
  const next = {
    ...state,
    admin_classes: renameFixedRooms(state.admin_classes),
    teaching_classes: renameFixedRooms(state.teaching_classes),
    constraints: (state.constraints || []).map(rule => rule.scope === 'room'
      ? { ...rule, target_ids: (rule.target_ids || []).map(renameId) }
      : rule),
    assignments: (state.assignments || []).map(item => renameRoomRecord(item, renameId)),
  };
  if (state.section_plan) {
    next.section_plan = {
      ...state.section_plan,
      sections: (state.section_plan.sections || []).map(item => renameRoomRecord(item, renameId)),
    };
  }
  if (state.schedule) {
    next.schedule = {
      ...state.schedule,
      sections: (state.schedule.sections || []).map(item => renameRoomRecord(item, renameId)),
      meetings: (state.schedule.meetings || []).map(item => renameRoomRecord(item, renameId)),
      assignments: (state.schedule.assignments || []).map(item => renameRoomRecord(item, renameId)),
    };
  }
  return next;
}
