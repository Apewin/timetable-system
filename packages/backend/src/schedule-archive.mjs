const ARCHIVE_CONTEXT_KEYS = [
  'meta', 'courses', 'teachers', 'rooms', 'students',
  'admin_classes', 'teaching_classes', 'constraints',
];

function copy(value) {
  return structuredClone(value);
}

export function archiveSummary(archive) {
  const schedule = archive.schedule || {};
  return {
    id: archive.id,
    name: archive.name,
    saved_at: archive.saved_at,
    schedule_version: archive.schedule_version ?? schedule.version ?? null,
    solver_status: schedule.solver_status || null,
    solve_duration_ms: schedule.solve_duration_ms ?? null,
    assignments_count: archive.assignments_count ?? schedule.assignments?.length ?? 0,
    meetings_count: schedule.meetings?.length || 0,
    manual_lock_count: (schedule.locks || []).filter(lock => lock.origin === 'manual').length,
    validation: schedule.validation || null,
  };
}

export function createScheduleArchive(state, { id, savedAt = new Date().toISOString(), name } = {}) {
  if (!state.schedule) throw new Error('尚未生成课表，无法储存');
  if (!id) throw new Error('课表归档缺少唯一 ID');
  const schedule = copy(state.schedule);
  const assignmentsCount = schedule.assignments?.length || 0;
  // Student-level assignments are a deterministic expansion of sections ×
  // meetings and dominate archive size. Store the compact source data and
  // reconstruct assignments only when an old timetable is opened.
  delete schedule.assignments;
  const context = Object.fromEntries(ARCHIVE_CONTEXT_KEYS.map(key => [key, copy(state[key] ?? [])]));
  return {
    id,
    name: name || `课表存档 · ${savedAt}`,
    saved_at: savedAt,
    schedule_version: schedule.version ?? null,
    assignments_count: assignmentsCount,
    schedule,
    context,
  };
}

export function stateForScheduleArchive(archive) {
  if (!archive?.schedule || !archive?.context) throw new Error('课表归档内容不完整');
  const schedule = copy(archive.schedule);
  if (!Array.isArray(schedule.assignments)) {
    const sections = new Map((schedule.sections || []).map(section => [section.id, section]));
    schedule.assignments = (schedule.meetings || []).flatMap(meeting => {
      const section = sections.get(meeting.section_id);
      if (!section) throw new Error(`课表归档引用了不存在的 section ${meeting.section_id}`);
      return (section.student_ids || []).map(studentId => ({
        task_id: `${section.id}:${studentId}:${meeting.slot_id}`,
        section_id: section.id,
        student_id: studentId,
        slot_id: meeting.slot_id,
        room_id: meeting.room_id || section.room_id,
        teacher_id: section.teacher_id,
        course_id: section.course_id,
        class_id: section.class_id || section.id,
        class_type: section.class_type,
      }));
    });
  }
  return {
    ...copy(archive.context),
    schedule,
    assignments: copy(schedule.assignments),
    // An archive is immutable historical output. It must not inherit the
    // current state's stale flag after courses or enrolments are edited.
    solve_status: 'valid',
  };
}
