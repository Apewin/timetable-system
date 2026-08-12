export function expandScheduleAssignments(sections = [], meetings = []) {
  const bySection = new Map(sections.map(section => [section.id, section]));
  return meetings.flatMap(meeting => {
    const section = bySection.get(meeting.section_id);
    if (!section) throw new Error(`课表引用了不存在的 section ${meeting.section_id}`);
    return (section.student_ids || []).map(studentId => ({
      task_id: `${section.id}:${studentId}:${meeting.slot_id}`,
      section_id: section.id,
      student_id: studentId,
      slot_id: meeting.slot_id,
      room_id: meeting.room_id ?? section.room_id ?? null,
      teacher_id: section.teacher_id,
      course_id: section.course_id,
      class_id: section.class_id || section.id,
      class_type: section.class_type,
    }));
  });
}

export function hydrateDerivedScheduleState(rawState) {
  const state = rawState;
  if (!state.schedule) {
    delete state.assignments;
    return state;
  }
  const assignments = expandScheduleAssignments(
    state.schedule.sections || [],
    state.schedule.meetings || [],
  );
  state.schedule.assignments = assignments;
  // Compatibility alias: both names point to the same in-memory projection,
  // while neither is persisted.
  state.assignments = assignments;
  return state;
}

export function compactPersistedState(state) {
  const compact = structuredClone(state);
  delete compact.assignments;
  if (compact.schedule) delete compact.schedule.assignments;
  for (const archive of compact.schedule_archives || []) {
    if (archive.schedule) delete archive.schedule.assignments;
  }
  return compact;
}
