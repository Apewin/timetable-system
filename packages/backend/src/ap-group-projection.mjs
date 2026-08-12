function indexes(state) {
  return {
    courses: new Map((state.courses || []).map(item => [item.id, item])),
    teachers: new Map((state.teachers || []).map(item => [item.id, item])),
    students: new Map((state.students || []).map(item => [item.id, item])),
  };
}

function projectSection(section, index) {
  return {
    id: section.id,
    course_id: section.course_id,
    course_name: index.courses.get(section.course_id)?.name || section.course_id,
    teacher_id: section.teacher_id || null,
    teacher_name: index.teachers.get(section.teacher_id)?.name || null,
    grades: section.grades || [],
    student_count: section.student_ids?.length || 0,
  };
}

export function listApGroups(state) {
  const index = indexes(state);
  return (state.schedule?.sections || [])
    .filter(section => section.class_type === 'ap')
    .map(section => projectSection(section, index))
    .sort((left, right) => left.course_name.localeCompare(right.course_name, 'zh-CN')
      || left.id.localeCompare(right.id));
}

export function apGroupDetail(state, sectionId) {
  const section = (state.schedule?.sections || [])
    .find(item => item.id === sectionId && item.class_type === 'ap');
  if (!section) throw new Error(`AP 分流组不存在: ${sectionId}`);
  const index = indexes(state);
  return {
    section: projectSection(section, index),
    students: (section.student_ids || []).map(studentId => {
      const student = index.students.get(studentId);
      return student ? {
        id: student.id,
        name: student.name || null,
        english_name: student.english_name || null,
        grade: student.grade ?? null,
        admin_class_id: student.admin_class_id || null,
        teaching_class_id: student.teaching_class_id || null,
      } : { id: studentId, name: null };
    }).sort((left, right) => String(left.name || left.id)
      .localeCompare(String(right.name || right.id), 'zh-CN')),
  };
}
