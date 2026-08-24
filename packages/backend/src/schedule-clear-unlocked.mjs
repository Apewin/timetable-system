import { expandScheduleAssignments } from './schedule-projection.mjs';

function text(value) {
  return String(value ?? '').trim();
}

function meetingKey(value) {
  return `${text(value?.section_id)}\u0000${text(value?.slot_id)}`;
}

function activeLocks(state) {
  const manualPlan = state.manual_plan || {};
  const manualConfirmed = manualPlan.status === 'confirmed';
  const candidates = [
    ...(state.schedule?.locks || []).filter(lock => lock.origin !== 'manual' || manualConfirmed),
    ...(manualConfirmed ? manualPlan.locks || [] : []),
  ];
  const seen = new Set();
  return candidates.filter(lock => {
    const key = meetingKey(lock);
    if (key === '\u0000' || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function previewClearUnlockedSchedule(state = {}) {
  if (!state.schedule) throw new Error('当前没有可清理的课表');
  const locks = activeLocks(state);
  const lockKeys = new Set(locks.map(meetingKey));
  const meetings = state.schedule.meetings || [];
  const retained = meetings.filter(meeting => lockKeys.has(meetingKey(meeting)));
  const meetingKeys = new Set(meetings.map(meetingKey));
  return {
    total_meetings: meetings.length,
    retained_locked_meetings: retained.length,
    cleared_unlocked_meetings: meetings.length - retained.length,
    preserved_lock_count: locks.length,
    orphaned_lock_count: locks.filter(lock => !meetingKeys.has(meetingKey(lock))).length,
  };
}

export function clearUnlockedSchedule(state = {}, {
  now = new Date().toISOString(),
  confirmedBy = '教务用户',
} = {}) {
  const preview = previewClearUnlockedSchedule(state);
  const locks = activeLocks(state);
  const lockKeys = new Set(locks.map(meetingKey));
  const meetings = (state.schedule.meetings || [])
    .filter(meeting => lockKeys.has(meetingKey(meeting)));
  const assignments = expandScheduleAssignments(state.schedule.sections || [], meetings);
  const changed = preview.cleared_unlocked_meetings > 0;
  const schedule = changed ? {
    ...state.schedule,
    version: (Number(state.schedule.version) || 0) + 1,
    meetings,
    assignments,
    locks,
    solver_status: 'PARTIAL_LOCKED_DRAFT',
    validation: null,
    quality_gate: null,
    quality_score: null,
    quality_exception_approval: null,
    publication_status: 'not_ready',
    review_required: false,
    cleared_unlocked_at: now,
    clear_unlocked_summary: {
      ...preview,
      confirmed_by: text(confirmedBy) || '教务用户',
    },
  } : state.schedule;
  const manualPlan = state.manual_plan ? {
    ...state.manual_plan,
    ...(changed ? { last_solve: null, updated_at: now } : {}),
  } : state.manual_plan;
  return {
    changed,
    preview,
    state: changed ? {
      ...state,
      assignments,
      schedule,
      ...(manualPlan ? { manual_plan: manualPlan } : {}),
      solve_status: 'stale',
    } : state,
  };
}
