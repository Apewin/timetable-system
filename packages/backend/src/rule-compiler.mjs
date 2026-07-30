const collections = {
  teacher: 'teachers',
  room: 'rooms',
  course: 'courses',
  student: 'students',
};

function allClasses(state) {
  return [...(state.admin_classes || []), ...(state.teaching_classes || [])];
}

function gradesForSection(section, state) {
  const students = new Map((state.students || []).map(student => [student.id, student]));
  return new Set([...(section.eligible_student_ids || []), ...(section.student_ids || [])]
    .map(id => students.get(id)?.grade)
    .filter(grade => grade !== undefined));
}

function matchesSelector(entity, selector, scope, state, sections) {
  if (!selector) return true;
  if (selector.ids && !selector.ids.includes(entity.id)) return false;
  if (selector.teacher_ids && !selector.teacher_ids.includes(scope === 'teacher' ? entity.id : entity.teacher_id)) return false;
  if (selector.course_ids && !selector.course_ids.includes(scope === 'course' ? entity.id : entity.course_id)) return false;
  if (selector.class_ids && !selector.class_ids.includes(scope === 'class' ? entity.id : entity.class_id)) return false;
  if (selector.class_types && !selector.class_types.includes(entity.class_type)) return false;
  if (selector.sources && !selector.sources.includes(entity.source)) return false;
  if (selector.weekly_hours && !selector.weekly_hours.includes(entity.weekly_hours)) return false;
  if (selector.max_weekly_hours !== undefined && entity.weekly_hours > selector.max_weekly_hours) return false;
  if (selector.min_weekly_hours !== undefined && entity.weekly_hours < selector.min_weekly_hours) return false;
  if (selector.grades) {
    const grades = scope === 'section' ? gradesForSection(entity, state) : new Set([entity.grade]);
    if (!selector.grades.some(grade => grades.has(grade))) return false;
  }
  if (selector.teaches_grades) {
    if (scope !== 'teacher') return false;
    const grades = new Set((sections || [])
      .filter(section => section.teacher_id === entity.id)
      .filter(section => !selector.section_class_types || selector.section_class_types.includes(section.class_type))
      .flatMap(section => [...gradesForSection(section, state)]));
    if (!selector.teaches_grades.every(grade => grades.has(grade))) return false;
  }
  return true;
}

function targetEntities(state, rule, sections) {
  if (rule.scope === 'global') return [{ id: 'GLOBAL' }];
  if (rule.scope === 'class') return allClasses(state);
  if (rule.scope === 'section') return sections || [];
  return state[collections[rule.scope]] || [];
}

/** Resolves selectors once, against an immutable scheduling problem. */
export function compileRules(state, rules, { sections = [] } = {}) {
  return rules.map(rule => {
    const selector = rule.params?.selector || {};
    const targetIds = targetEntities(state, rule, sections)
      .filter(entity => !rule.target_id || entity.id === rule.target_id)
      .filter(entity => matchesSelector(entity, selector, rule.scope, state, sections))
      .map(entity => entity.id);
    const sectionTargetIds = sections.filter(section => {
      if (rule.scope === 'global') return true;
      if (rule.scope === 'section') return targetIds.includes(section.id);
      if (rule.scope === 'course') return targetIds.includes(section.course_id);
      if (rule.scope === 'class') return targetIds.includes(section.class_id);
      if (rule.scope === 'teacher') return targetIds.includes(section.teacher_id)
        && (!selector.section_class_types || selector.section_class_types.includes(section.class_type));
      if (rule.scope === 'room') return (section.room_candidates || []).some(roomId => targetIds.includes(roomId));
      return false;
    }).map(section => section.id);
    return {
      id: rule.id,
      name: rule.name || rule.id,
      type: rule.type,
      hard: rule.hard,
      weight: rule.hard ? 0 : rule.weight,
      requires_approval_to_relax: rule.requires_approval_to_relax === true,
      scope: rule.scope || 'global',
      target_ids: targetIds,
      section_target_ids: sectionTargetIds,
      params: rule.params || {},
      unmatched: rule.scope !== 'global' && targetIds.length === 0,
    };
  });
}
