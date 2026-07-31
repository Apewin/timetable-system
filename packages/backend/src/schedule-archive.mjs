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
    assignments_count: schedule.assignments?.length || 0,
    meetings_count: schedule.meetings?.length || 0,
    manual_lock_count: (schedule.locks || []).filter(lock => lock.origin === 'manual').length,
    validation: schedule.validation || null,
  };
}

export function createScheduleArchive(state, { id, savedAt = new Date().toISOString(), name } = {}) {
  if (!state.schedule) throw new Error('尚未生成课表，无法储存');
  if (!id) throw new Error('课表归档缺少唯一 ID');
  const schedule = copy(state.schedule);
  const context = Object.fromEntries(ARCHIVE_CONTEXT_KEYS.map(key => [key, copy(state[key] ?? [])]));
  return {
    id,
    name: name || `课表存档 · ${savedAt}`,
    saved_at: savedAt,
    schedule_version: schedule.version ?? null,
    schedule,
    context,
  };
}

export function stateForScheduleArchive(archive) {
  if (!archive?.schedule || !archive?.context) throw new Error('课表归档内容不完整');
  return {
    ...copy(archive.context),
    schedule: copy(archive.schedule),
    assignments: copy(archive.schedule.assignments || []),
    // An archive is immutable historical output. It must not inherit the
    // current state's stale flag after courses or enrolments are edited.
    solve_status: 'valid',
  };
}
