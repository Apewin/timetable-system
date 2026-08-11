function emptyHint(reason) {
  return { meetings: [], sections: [], enabled: false, reason };
}

/**
 * Reusing a valid timetable gives CP-SAT an incumbent instead of making every
 * solve restart from zero. Dynamic AP sectioning is the one unsafe case: its
 * roster choices may need a global reshuffle. Once exact imported Block
 * rosters are present, section identities and membership are stable again.
 */
export function priorTimetableHintForState(state, problem) {
  if (state.solve_status !== 'valid' || !state.schedule) {
    return emptyHint('schedule_not_valid');
  }
  const apBlockMode = problem.diagnostics?.ap_block_mode?.enabled === true;
  const hasExactApRosters = Array.isArray(state.ap_block_assignments)
    && state.ap_block_assignments.length > 0;
  if (apBlockMode && !hasExactApRosters) return emptyHint('dynamic_ap_rosters');
  return {
    meetings: state.schedule.meetings || [],
    sections: state.schedule.sections || [],
    enabled: true,
    reason: apBlockMode ? 'exact_ap_rosters' : 'stable_sectioning',
  };
}
