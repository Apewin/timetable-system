const CLASS_ENTITIES = new Map([
  ['admin_classes', '行政班'],
  ['teaching_classes', '教学班'],
]);

function text(value) {
  return String(value ?? '').trim();
}

function canonicalName(value) {
  return text(value).normalize('NFKC').toLocaleLowerCase('zh-CN');
}

export function renameClassDisplayName(state, { entity, id, name } = {}) {
  const classType = CLASS_ENTITIES.get(entity);
  if (!classType) throw new Error('只支持修改行政班或教学班名称');
  const classId = text(id);
  const nextName = text(name);
  if (!classId) throw new Error('必须提供班级 ID');
  if (!nextName) throw new Error('班级名称不能为空');
  if (nextName.length > 80) throw new Error('班级名称不能超过 80 个字符');
  const classes = state[entity] || [];
  const index = classes.findIndex(item => item.id === classId);
  if (index < 0) throw new Error(`${classType}不存在: ${classId}`);
  const current = classes[index];
  if (classes.some(item => item.id !== classId
    && Number(item.grade) === Number(current.grade)
    && canonicalName(item.name) === canonicalName(nextName))) {
    throw new Error(`同年级${classType}名称不能重复`);
  }
  const renamedClass = { ...current, name: nextName };
  const renamedClasses = [...classes];
  renamedClasses[index] = renamedClass;
  return {
    state: { ...state, [entity]: renamedClasses },
    class: renamedClass,
    class_type: entity,
  };
}
