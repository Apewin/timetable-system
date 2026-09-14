import { emptyManualPlan } from './manual-plan.mjs';
import { expandScheduleAssignments } from './schedule-projection.mjs';
import { previewClearUnlockedSchedule } from './schedule-clear-unlocked.mjs';

export const CLEAR_ALL_SCHEDULE_CONFIRMATION = '清空全部课表';

function text(value) {
  return String(value ?? '').trim();
}

export function previewClearAllSchedule(state = {}) {
  if (!state.schedule) throw new Error('当前没有可清空的课表');
  const unlocked = previewClearUnlockedSchedule(state);
  return {
    total_meetings: unlocked.total_meetings,
    locked_meetings: unlocked.retained_locked_meetings,
    unlocked_meetings: unlocked.cleared_unlocked_meetings,
    parked_meetings: Array.isArray(state.schedule.adjustment_buffer)
      ? state.schedule.adjustment_buffer.length
      : 0,
    lock_count: unlocked.preserved_lock_count,
    manual_placements: Array.isArray(state.manual_plan?.placements)
      ? state.manual_plan.placements.length
      : 0,
  };
}

export function clearAllSchedule(state = {}, {
  now = new Date().toISOString(),
  confirmedBy = '教务用户',
} = {}) {
  const preview = previewClearAllSchedule(state);
  const changed = preview.total_meetings > 0
    || preview.parked_meetings > 0
    || preview.lock_count > 0
    || preview.manual_placements > 0;
  if (!changed) return { changed: false, preview, state };

  const assignments = expandScheduleAssignments(state.schedule.sections || [], []);
  return {
    changed: true,
    preview,
    state: {
      ...state,
      assignments,
      schedule: {
        ...state.schedule,
        version: (Number(state.schedule.version) || 0) + 1,
        meetings: [],
        assignments,
        locks: [],
        adjustment_buffer: [],
        solver_status: 'CLEARED',
        validation: null,
        quality_gate: null,
        quality_score: null,
        quality_exception_approval: null,
        publication_status: 'not_ready',
        review_required: false,
        cleared_all_at: now,
        clear_all_summary: {
          ...preview,
          confirmed_by: text(confirmedBy) || '教务用户',
        },
      },
      manual_plan: emptyManualPlan(),
      solve_status: 'stale',
    },
  };
}
