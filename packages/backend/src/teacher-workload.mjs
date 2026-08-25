export function scheduledWeeklyHoursByTeacher(state = {}) {
  if (state.solve_status !== 'valid' || !state.schedule) return {};
  const teacherBySection = new Map((state.schedule.sections || [])
    .filter(section => section?.id && section?.teacher_id)
    .map(section => [section.id, section.teacher_id]));
  const counts = {};
  for (const meeting of state.schedule.meetings || []) {
    const teacherId = teacherBySection.get(meeting?.section_id);
    if (!teacherId) continue;
    counts[teacherId] = (counts[teacherId] || 0) + 1;
  }
  return counts;
}
