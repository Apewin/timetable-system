const COURSE_TYPES = new Set(['required', 'ap', 'required_elective', 'other']);
const GRADE_VALUES = new Set([10, 11, 12]);

function asList(value) {
  return Array.isArray(value) ? value : value === undefined || value === null ? [] : [value];
}

function includesChoice(value, id) {
  return asList(value).includes(id);
}

function withoutChoice(value, id) {
  if (Array.isArray(value)) return value.filter(item => item !== id);
  return value === id ? undefined : value;
}

function dependencyCollector() {
  const records = new Map();
  return {
    add(kind, label, reference) {
      const current = records.get(kind) || { kind, label, count: 0, references: [] };
      current.count += 1;
      if (current.references.length < 8) current.references.push(reference);
      records.set(kind, current);
    },
    result() { return [...records.values()]; },
  };
}

export function validateEntityInput(entity, item) {
  if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error('实体内容必须是对象');
  if (typeof item.id !== 'string' || !item.id.trim()) throw new Error('实体必须有非空字符串 id');
  if (entity === 'courses') {
    if (!COURSE_TYPES.has(item.type)) throw new Error(`课程 ${item.id} 的类型无效`);
    if (!Number.isInteger(Number(item.weekly_hours)) || Number(item.weekly_hours) < 0) {
      throw new Error(`课程 ${item.id} 的每周课时必须是非负整数`);
    }
    const grades = asList(item.grade);
    if (!grades.length || !grades.every(grade => GRADE_VALUES.has(Number(grade)))) {
      throw new Error(`课程 ${item.id} 必须设置 Senior 1–3 适用年级`);
    }
  }
  if (entity === 'teachers') {
    if (!Array.isArray(item.can_teach || [])) {
      throw new Error(`教师 ${item.id} 的可授课程必须是数组`);
    }
    for (const [field, label] of [
      ['max_per_day', '每天上限'],
      ['max_per_week', '每周上限'],
    ]) {
      if (item[field] === undefined || item[field] === null) continue;
      if (!Number.isInteger(Number(item[field])) || Number(item[field]) < 0) {
        throw new Error(`教师 ${item.id} 的${label}必须是非负整数`);
      }
    }
  }
  if (entity === 'students' && !GRADE_VALUES.has(Number(item.grade))) {
    throw new Error(`学生 ${item.id} 的年级必须是 Senior 1–3`);
  }
  if ((entity === 'admin_classes' || entity === 'teaching_classes')
    && !GRADE_VALUES.has(Number(item.grade))) {
    throw new Error(`班级 ${item.id} 的年级必须是 Senior 1–3`);
  }
  if (entity === 'teaching_assignments') {
    if (typeof item.course_id !== 'string' || !item.course_id) throw new Error(`教师分工 ${item.id} 缺少课程`);
    if (!Array.isArray(item.class_ids)) throw new Error(`教师分工 ${item.id} 的班级必须是数组`);
  }
  return item;
}

export function entityDependencies(state, entity, id) {
  const found = dependencyCollector();
  if (entity === 'courses') {
    for (const assignment of state.teaching_assignments || []) {
      if (assignment.course_id === id) found.add('teaching_assignment', '教师分工', assignment.id);
    }
    for (const teacher of state.teachers || []) {
      if ((teacher.can_teach || []).includes(id)) found.add('teacher_qualification', '教师可授课程', teacher.id);
    }
    for (const student of state.students || []) {
      if ((student.ap_courses || []).includes(id)) found.add('student_ap_selection', '学生 AP 选课', student.id);
      if (Object.values(student.elective_choices || {}).some(value => includesChoice(value, id))) {
        found.add('student_elective_choice', '学生其他选课', student.id);
      }
    }
    for (const block of state.selection_blocks || []) {
      if ((block.allowed_course_ids || []).includes(id)) found.add('selection_block', '选课组', block.id);
    }
    if (state.ap_block_config?.course_block_ids?.[id]
      || Object.keys(state.ap_block_config?.offering_block_ids || {}).some(key => key.startsWith(`${id}:`))) {
      found.add('ap_block_config', 'AP Block 配置', id);
    }
  }
  if (entity === 'teachers') {
    for (const assignment of state.teaching_assignments || []) {
      if (assignment.teacher_id === id) found.add('teaching_assignment', '教师分工', assignment.id);
    }
    for (const course of state.courses || []) for (const requirement of course.section_requirements || []) {
      if (requirement.teacher_id === id) found.add('course_section_requirement', '课程 Section 教师', course.id);
    }
    for (const [sectionId, override] of Object.entries(state.section_overrides || {})) {
      if (override.teacher_id === id) found.add('section_override', '分班教师调整', sectionId);
    }
    for (const rule of state.constraints || []) {
      if (rule.scope === 'teacher' && (rule.target_id === id || (rule.target_ids || []).includes(id))) {
        found.add('constraint', '教师排课规则', rule.id);
      }
    }
  }
  if (entity === 'admin_classes' || entity === 'teaching_classes') {
    const field = entity === 'admin_classes' ? 'admin_class_id' : 'teaching_class_id';
    for (const student of state.students || []) {
      if (student[field] === id) found.add('student_class_membership', '学生班级归属', student.id);
    }
    for (const assignment of state.teaching_assignments || []) {
      if ((assignment.class_ids || []).includes(id)) found.add('teaching_assignment', '教师分工', assignment.id);
    }
    for (const course of state.courses || []) {
      if ((course.applicable_class_ids || []).includes(id)) found.add('course_class_scope', '课程适用班级', course.id);
    }
  }
  if (entity === 'selection_blocks') {
    const block = (state.selection_blocks || []).find(item => item.id === id);
    if (block) for (const student of state.students || []) {
      if (student.elective_choices?.[block.choice_key] !== undefined) {
        found.add('student_elective_choice', '学生选课', student.id);
      }
    }
  }
  if (entity === 'students') {
    for (const [sectionId, override] of Object.entries(state.section_overrides || {})) {
      if ((override.locked_student_ids || []).includes(id)) found.add('section_override', '分班锁定名单', sectionId);
    }
    for (const assignment of state.ap_block_assignments || []) {
      if (assignment.student_id === id) found.add('ap_block_assignment', 'AP Block 分配', assignment.course_id || assignment.block_id);
    }
  }
  return found.result();
}

function removeCourseReferences(state, id) {
  const students = (state.students || []).map(student => ({
    ...student,
    ap_courses: (student.ap_courses || []).filter(courseId => courseId !== id),
    elective_choices: Object.fromEntries(Object.entries(student.elective_choices || {})
      .map(([key, value]) => [key, withoutChoice(value, id)])
      .filter(([, value]) => value !== undefined && (!Array.isArray(value) || value.length))),
  }));
  const selectionBlocks = [];
  const removedChoiceKeys = new Set();
  for (const block of state.selection_blocks || []) {
    const allowed = (block.allowed_course_ids || []).filter(courseId => courseId !== id);
    if (allowed.length >= 2) selectionBlocks.push({ ...block, allowed_course_ids: allowed });
    else removedChoiceKeys.add(block.choice_key);
  }
  const cleanedStudents = removedChoiceKeys.size ? students.map(student => ({
    ...student,
    elective_choices: Object.fromEntries(Object.entries(student.elective_choices || {})
      .filter(([key]) => !removedChoiceKeys.has(key))),
  })) : students;
  const courseBlockIds = { ...(state.ap_block_config?.course_block_ids || {}) };
  delete courseBlockIds[id];
  const offeringBlockIds = Object.fromEntries(Object.entries(
    state.ap_block_config?.offering_block_ids || {},
  ).filter(([key]) => !key.startsWith(`${id}:`)));
  return {
    ...state,
    teachers: (state.teachers || []).map(teacher => ({
      ...teacher,
      can_teach: (teacher.can_teach || []).filter(courseId => courseId !== id),
    })),
    students: cleanedStudents,
    teaching_assignments: (state.teaching_assignments || [])
      .filter(assignment => assignment.course_id !== id),
    selection_blocks: selectionBlocks,
    ...(state.ap_block_config ? {
      ap_block_config: { ...state.ap_block_config, course_block_ids: courseBlockIds, offering_block_ids: offeringBlockIds },
    } : {}),
  };
}

function removeTeacherReferences(state, id) {
  return {
    ...state,
    teaching_assignments: (state.teaching_assignments || []).map(assignment =>
      assignment.teacher_id === id ? { ...assignment, teacher_id: null } : assignment),
    courses: (state.courses || []).map(course => ({
      ...course,
      ...(course.section_requirements ? {
        section_requirements: course.section_requirements.map(requirement =>
          requirement.teacher_id === id ? { ...requirement, teacher_id: null } : requirement),
      } : {}),
    })),
    section_overrides: Object.fromEntries(Object.entries(state.section_overrides || {}).map(([key, value]) => [
      key,
      value.teacher_id === id ? { ...value, teacher_id: null } : value,
    ])),
    constraints: (state.constraints || []).filter(rule =>
      !(rule.scope === 'teacher' && (rule.target_id === id || (rule.target_ids || []).includes(id)))),
  };
}

function removeClassReferences(state, entity, id) {
  const field = entity === 'admin_classes' ? 'admin_class_id' : 'teaching_class_id';
  return {
    ...state,
    students: (state.students || []).map(student =>
      student[field] === id ? { ...student, [field]: null } : student),
    teaching_assignments: (state.teaching_assignments || []).map(assignment => ({
      ...assignment,
      class_ids: (assignment.class_ids || []).filter(classId => classId !== id),
    })).filter(assignment => assignment.class_ids.length),
    courses: (state.courses || []).map(course => ({
      ...course,
      ...(course.applicable_class_ids ? {
        applicable_class_ids: course.applicable_class_ids.filter(classId => classId !== id),
      } : {}),
    })),
  };
}

export function deleteEntityFromState(state, entity, id, { cascade = false } = {}) {
  const items = state[entity] || [];
  if (!items.some(item => item.id === id)) throw new Error(`实体不存在: ${id}`);
  const dependencies = entityDependencies(state, entity, id);
  if (dependencies.length && !cascade) {
    const summary = dependencies.map(item => `${item.label} ${item.count} 项`).join('、');
    const error = new Error(`${id} 仍被引用：${summary}。请确认级联清理后再删除。`);
    error.code = 'ENTITY_IN_USE';
    error.dependencies = dependencies;
    throw error;
  }
  let next = structuredClone(state);
  if (entity === 'courses') next = removeCourseReferences(next, id);
  if (entity === 'teachers') next = removeTeacherReferences(next, id);
  if (entity === 'admin_classes' || entity === 'teaching_classes') {
    next = removeClassReferences(next, entity, id);
  }
  if (entity === 'selection_blocks') {
    const block = items.find(item => item.id === id);
    next.students = (next.students || []).map(student => ({
      ...student,
      elective_choices: Object.fromEntries(Object.entries(student.elective_choices || {})
        .filter(([key]) => key !== block.choice_key)),
    }));
  }
  if (entity === 'students') {
    next.ap_block_assignments = (next.ap_block_assignments || [])
      .filter(assignment => assignment.student_id !== id);
    next.section_overrides = Object.fromEntries(Object.entries(next.section_overrides || {}).map(([key, value]) => [
      key,
      { ...value, locked_student_ids: (value.locked_student_ids || []).filter(studentId => studentId !== id) },
    ]));
  }
  next[entity] = (next[entity] || []).filter(item => item.id !== id);
  return { state: next, dependencies, removed: id };
}
