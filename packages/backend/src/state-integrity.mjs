function classIndex(state) {
  const allIds = new Map();
  const indexes = {};
  for (const [key, label] of [
    ['admin_classes', '行政班'],
    ['teaching_classes', '教学班'],
  ]) {
    const index = new Map();
    for (const item of state[key] || []) {
      if (typeof item.id !== 'string' || !item.id.trim()) throw new Error(`${label}缺少有效 ID`);
      if (index.has(item.id)) throw new Error(`${label} ID 重复: ${item.id}`);
      const previous = allIds.get(item.id);
      if (previous) throw new Error(`班级 ID ${item.id} 在行政班和教学班中重复（${previous}、${label}）`);
      index.set(item.id, item);
      allIds.set(item.id, label);
    }
    indexes[key] = index;
  }
  return indexes;
}

export function validateClassIdentity(state) {
  classIndex(state);
}

/**
 * Student class references are canonical. Class-level student_ids are a
 * derived index used by scheduling and presentation, never an independent
 * editable source of truth.
 */
export function synchronizeClassMemberships(state) {
  const indexes = classIndex(state);
  const rosters = {
    admin_classes: new Map((state.admin_classes || []).map(item => [item.id, []])),
    teaching_classes: new Map((state.teaching_classes || []).map(item => [item.id, []])),
  };
  const studentIds = new Set();
  for (const student of state.students || []) {
    if (typeof student.id !== 'string' || !student.id.trim()) throw new Error('学生缺少有效 ID');
    if (studentIds.has(student.id)) throw new Error(`学生 ID 重复: ${student.id}`);
    studentIds.add(student.id);
    for (const [field, key, label] of [
      ['admin_class_id', 'admin_classes', '行政班'],
      ['teaching_class_id', 'teaching_classes', '教学班'],
    ]) {
      const classId = student[field];
      if (classId === undefined || classId === null || classId === '') continue;
      const classItem = indexes[key].get(classId);
      if (!classItem) throw new Error(`学生 ${student.name || student.id} 引用了不存在的${label} ${classId}`);
      if (student.grade !== undefined && classItem.grade !== undefined
        && Number(student.grade) !== Number(classItem.grade)) {
        throw new Error(`学生 ${student.name || student.id} 的年级与${label} ${classId} 不一致`);
      }
      rosters[key].get(classId).push(student.id);
    }
  }
  const synced = key => (state[key] || []).map(item => {
    const student_ids = rosters[key].get(item.id).sort((left, right) => left.localeCompare(right));
    return { ...item, student_ids, student_count: student_ids.length };
  });
  return {
    ...state,
    admin_classes: synced('admin_classes'),
    teaching_classes: synced('teaching_classes'),
  };
}
