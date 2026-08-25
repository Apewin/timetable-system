function integer(value, label, minimum, maximum) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${label}必须是 ${minimum}–${maximum} 范围内的整数`);
  }
  return parsed;
}

function canonicalName(value) {
  return String(value || '').trim().normalize('NFKC').toLocaleLowerCase('zh-CN');
}

function updatedRoomId(rooms, currentId, value) {
  const id = String(value ?? currentId).trim();
  if (!id) throw new Error('教室 ID（门牌号）不能为空');
  if (id.length > 80) throw new Error('教室 ID（门牌号）不能超过 80 个字符');
  if (rooms.some(room => room.id !== currentId
    && canonicalName(room.id) === canonicalName(id))) {
    throw new Error('教室 ID（门牌号）不能重复');
  }
  return id;
}

export function changeSchedulingRooms(rooms = [], command = {}) {
  const current = (rooms || []).map(room => ({ ...room }));
  const normalizedRoom = exceptId => {
    const name = String(command.name || '').trim();
    if (!name) throw new Error('教室名称不能为空');
    if (current.some(room => room.id !== exceptId
      && canonicalName(room.name) === canonicalName(name))) {
      throw new Error('教室名称不能重复');
    }
    return {
      name,
      type: String(command.roomType || 'general'),
      capacity: integer(command.capacity, '教室容量', 1, 500),
    };
  };
  if (command.type === 'add') {
    const ids = new Set(current.map(room => room.id));
    let nextIndex = 1;
    while (ids.has(`ROOM_${nextIndex}`)) nextIndex += 1;
    const generatedId = `ROOM_${nextIndex}`;
    const id = command.id == null
      ? generatedId
      : updatedRoomId(current, '', command.id);
    return [...current, { id, ...normalizedRoom('') }];
  }
  if (command.type === 'update') {
    const id = String(command.id || '').trim();
    if (!current.some(room => room.id === id)) throw new Error('找不到需要修改的教室');
    const update = normalizedRoom(id);
    const nextId = updatedRoomId(current, id, command.newId);
    return current.map(room => room.id === id ? { ...room, ...update, id: nextId } : room);
  }
  if (command.type === 'delete') {
    const id = String(command.id || '').trim();
    if (!current.some(room => room.id === id)) throw new Error('找不到需要删除的教室');
    return current.filter(room => room.id !== id);
  }
  throw new Error('不支持的教室修改操作');
}
