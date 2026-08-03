import { solveSchedule } from './cpsat-solver.mjs';
import { buildDynamicSchedulingLayer } from './decomposed-solver.mjs';
import { validateSchedule } from './schedule-validator.mjs';
import { assignStudentsToScheduledSections } from './student-section-assignment.mjs';

function indexedMeetings(problem, meetings) {
  const slotOrder = new Map(problem.slots.map((slot, index) => [slot.id, index]));
  const bySection = new Map();
  for (const meeting of meetings || []) {
    const own = bySection.get(meeting.section_id) || [];
    own.push(meeting);
    bySection.set(meeting.section_id, own);
  }
  return [...bySection].flatMap(([sectionId, own]) => own
    .sort((left, right) => slotOrder.get(left.slot_id) - slotOrder.get(right.slot_id))
    .map((meeting, occurrenceIndex) => ({
      section_id: sectionId,
      occurrence_index: occurrenceIndex,
      slot_id: meeting.slot_id,
    })));
}

function cutKey(cut) {
  return cut.map(item =>
    `${item.section_id}#${item.occurrence_index}@${item.slot_id}`)
    .sort()
    .join('|');
}

function fixedSectionsFromRoster(group, rosterBySection) {
  return Object.fromEntries((group.courses || []).map(course => {
    const students = course.student_ids || group.student_ids || [];
    const matches = (course.candidate_section_ids || []).filter(sectionId =>
      students.every(studentId => rosterBySection.get(sectionId)?.has(studentId)));
    if (matches.length !== 1) {
      throw new Error(
        `无法从可行学生分配中唯一确定 ${group.id} ${course.course_id} 的 section`,
      );
    }
    return [course.course_id, matches[0]];
  }));
}

function problemWithDynamicRoster(problem, dynamicSectionIds, sections) {
  const rosterBySection = new Map((sections || [])
    .filter(section => dynamicSectionIds.has(section.id))
    .map(section => [section.id, section.student_ids || []]));
  return {
    ...problem,
    sections: problem.sections.map(section => dynamicSectionIds.has(section.id)
      ? { ...section, student_ids: [...(rosterBySection.get(section.id) || [])] }
      : section),
  };
}

/**
 * Repair a near-feasible exact-student timetable with a two-level model.
 *
 * The master contains every section, teacher, lock and real selection group,
 * but deliberately omits student prefix/no-gap rules.  Section membership
 * already proven by the seed is fixed; only failed selection profiles remain
 * free.  The subproblem fixes the master's complete timing and roster, applies
 * every student hard rule, and returns a sufficient timing conflict.  Each
 * conflict becomes a Benders no-good in the next master pass.
 */
export async function solvePrefixedRosterBenders(problem, options = {}) {
  const startedAt = performance.now();
  const maxTimeSeconds = Math.max(1, Number(options.maxTimeSeconds || 600));
  const deadline = startedAt + maxTimeSeconds * 1000;
  const maxIterations = Math.max(1, Number(options.maxIterations || 100));
  const masterTimeSeconds = Math.max(1, Number(options.masterTimeSeconds || 45));
  const masterRetrySeconds = Math.max(masterTimeSeconds, Number(options.masterRetrySeconds || 120));
  const subproblemTimeSeconds = Math.max(1, Number(options.subproblemTimeSeconds || 15));
  const lockedMeetings = options.lockedMeetings || [];
  const seedTiming = options.seedTiming;
  const progress = typeof options.onProgress === 'function' ? options.onProgress : () => {};
  const saveCheckpoint = typeof options.onCheckpoint === 'function'
    ? options.onCheckpoint
    : () => {};
  if (!seedTiming?.meetings?.length || !seedTiming?.sections?.length) {
    throw new Error('前缀 Benders 求解需要一张部分学生可行的种子课表');
  }

  const layer = buildDynamicSchedulingLayer(problem, lockedMeetings, {
    includeAllCore: true,
    assignmentMode: 'detailed',
    includeStudentRules: false,
  });
  const seedAssignment = assignStudentsToScheduledSections(problem, seedTiming.meetings);
  const failedStudentIds = new Set((seedAssignment.failures || [])
    .map(failure => failure.student_id));
  const seedRoster = new Map((seedAssignment.sections || [])
    .map(section => [section.id, new Set(section.student_ids || [])]));
  let assignmentGroups = layer.assignmentGroups.map(group =>
    (group.student_ids || []).some(studentId => failedStudentIds.has(studentId))
      ? group
      : { ...group, fixed_sections: fixedSectionsFromRoster(group, seedRoster) });
  let completeRosterFrozen = false;

  const timetableCuts = [...(options.initialCuts || [])];
  const cutKeys = new Set(timetableCuts.map(cutKey));
  let previous = options.initialTiming || seedTiming;
  for (let iteration = 1;
    iteration <= maxIterations && performance.now() < deadline;
    iteration += 1) {
    const remainingSeconds = () => Math.max(0.1, (deadline - performance.now()) / 1000);
    const masterOptions = {
      optimizeSoft: false,
      freezeMembership: true,
      lockedMeetings,
      useConstructiveSeed: false,
      assignmentGroups,
      channelAssignmentGroupTimes: false,
      timetableCuts,
      hintMeetings: previous.meetings,
      hintSections: previous.sections,
      repairHints: false,
      randomSeed: Number(options.randomSeed || 1) + iteration,
    };
    progress({
      stage: 'master', iteration, cut_count: timetableCuts.length,
      failed_seed_student_count: failedStudentIds.size,
    });
    let master = await solveSchedule(layer.problem, {
      ...masterOptions,
      maxTimeSeconds: Math.min(masterTimeSeconds, remainingSeconds()),
    });
    if (!master.ok && master.status === 'UNKNOWN' && performance.now() < deadline) {
      master = await solveSchedule(layer.problem, {
        ...masterOptions,
        maxTimeSeconds: Math.min(masterRetrySeconds, remainingSeconds()),
        repairHints: true,
        numSearchWorkers: Number(options.numSearchWorkers || 8),
      });
    }
    if (!master.ok) return {
      ...master,
      algorithm: 'prefixed-roster-exact-benders',
      reason: master.reason || '课程骨架主问题未找到可行解',
      benders_iterations: iteration - 1,
      timetable_cut_count: timetableCuts.length,
      failed_seed_student_ids: [...failedStudentIds],
      solve_duration_ms: Math.round(performance.now() - startedAt),
    };
    previous = master;
    // Timing-only Benders cuts are valid only while the section roster that
    // produced the subproblem core stays fixed.  Complete the four (or other)
    // seed-failure profiles in the first master, then freeze that full roster
    // before adding any no-good cuts.  A different roster is explored by an
    // outer restart, never by silently reusing a roster-specific cut.
    if (!completeRosterFrozen) {
      const masterRoster = new Map((master.sections || [])
        .map(section => [section.id, new Set(section.student_ids || [])]));
      assignmentGroups = assignmentGroups.map(group => ({
        ...group,
        fixed_sections: fixedSectionsFromRoster(group, masterRoster),
      }));
      completeRosterFrozen = true;
    }

    const fullProblem = problemWithDynamicRoster(
      problem,
      layer.dynamicSectionIds,
      master.sections,
    );
    const full = await solveSchedule(fullProblem, {
      maxTimeSeconds: Math.min(subproblemTimeSeconds, remainingSeconds()),
      optimizeSoft: false,
      freezeMembership: true,
      lockedMeetings,
      assumptionMeetings: indexedMeetings(problem, master.meetings),
      useConstructiveSeed: false,
      hintMeetings: master.meetings,
      hintSections: master.sections,
      repairHints: false,
      randomSeed: Number(options.randomSeed || 1) + 1000 + iteration,
    });
    if (full.ok) {
      const validation = validateSchedule(problem, { ...full, locks: lockedMeetings });
      return {
        ...full,
        status: 'PREFIXED_BENDERS_FEASIBLE',
        validation,
        algorithm: 'prefixed-roster-exact-benders',
        benders_iterations: iteration,
        timetable_cut_count: timetableCuts.length,
        failed_seed_student_ids: [...failedStudentIds],
        solve_duration_ms: Math.round(performance.now() - startedAt),
      };
    }
    const core = full.infeasible_assumption_meetings || [];
    progress({
      stage: 'subproblem', iteration, status: full.status,
      infeasible_core_size: core.length, cut_count: timetableCuts.length,
    });
    saveCheckpoint({
      iteration,
      timetable_cuts: structuredClone(timetableCuts),
      timing: structuredClone(previous),
      subproblem_status: full.status,
      infeasible_core: structuredClone(core),
    });
    if (full.status !== 'INFEASIBLE' || !core.length) return {
      ...full,
      algorithm: 'prefixed-roster-exact-benders',
      reason: full.reason || '学生规则子问题未返回可用冲突核',
      benders_iterations: iteration,
      timetable_cut_count: timetableCuts.length,
      failed_seed_student_ids: [...failedStudentIds],
      solve_duration_ms: Math.round(performance.now() - startedAt),
    };
    const key = cutKey(core);
    if (cutKeys.has(key)) return {
      ok: false,
      status: 'BENDERS_STALLED',
      reason: '学生规则子问题重复返回同一冲突核',
      sections: [], meetings: [], assignments: [],
      algorithm: 'prefixed-roster-exact-benders',
      benders_iterations: iteration,
      timetable_cut_count: timetableCuts.length,
      failed_seed_student_ids: [...failedStudentIds],
      solve_duration_ms: Math.round(performance.now() - startedAt),
    };
    cutKeys.add(key);
    timetableCuts.push(core);
  }
  return {
    ok: false,
    status: 'UNKNOWN',
    reason: '前缀 Benders 求解在时限或迭代上限内未收敛',
    sections: [], meetings: [], assignments: [],
    checkpoint: { timing: previous, timetable_cuts: timetableCuts },
    algorithm: 'prefixed-roster-exact-benders',
    benders_iterations: Math.min(maxIterations, timetableCuts.length),
    timetable_cut_count: timetableCuts.length,
    failed_seed_student_ids: [...failedStudentIds],
    solve_duration_ms: Math.round(performance.now() - startedAt),
  };
}

function flexibleCoreGroups(core, groupById, releasedIds) {
  const scores = new Map();
  for (const item of core || []) {
    if (releasedIds.has(item.group_id)) continue;
    const group = groupById.get(item.group_id);
    const course = (group?.courses || []).find(candidate =>
      candidate.course_id === item.course_id);
    if (!course || (course.candidate_section_ids || []).length < 2) continue;
    scores.set(item.group_id, (scores.get(item.group_id) || 0) + 1);
  }
  return [...scores]
    .map(([groupId, score]) => ({
      group_id: groupId,
      score,
      student_count: groupById.get(groupId)?.student_ids?.length || 0,
    }))
    .sort((left, right) =>
      right.score - left.score
      || right.student_count - left.student_count
      || left.group_id.localeCompare(right.group_id));
}

/**
 * Conflict-directed roster/timing decomposition.
 *
 * A collision-only master chooses the few parallel-section memberships that
 * the seed could not establish.  With that complete roster frozen, a compact
 * timing subproblem enforces every student rule.  If the roster itself is
 * impossible, an assumption core is converted into an assignment no-good and
 * the master changes at least one implicated membership.  Existing seed
 * memberships are released only when the accumulated no-goods require it.
 */
export async function solveRosterBenders(problem, options = {}) {
  const startedAt = performance.now();
  const maxTimeSeconds = Math.max(1, Number(options.maxTimeSeconds || 900));
  const deadline = startedAt + maxTimeSeconds * 1000;
  const maxIterations = Math.max(1, Number(options.maxIterations || 100));
  const lockedMeetings = options.lockedMeetings || [];
  const seedTiming = options.seedTiming;
  const progress = typeof options.onProgress === 'function' ? options.onProgress : () => {};
  const saveCheckpoint = typeof options.onCheckpoint === 'function'
    ? options.onCheckpoint
    : () => {};
  if (!seedTiming?.meetings?.length || !seedTiming?.sections?.length) {
    throw new Error('Roster Benders 求解需要一张部分学生可行的种子课表');
  }

  const masterLayer = buildDynamicSchedulingLayer(problem, lockedMeetings, {
    includeAllCore: true,
    assignmentMode: 'detailed',
    includeStudentRules: false,
  });
  const coreLayer = buildDynamicSchedulingLayer(problem, lockedMeetings, {
    includeAllCore: true,
    assignmentMode: 'detailed',
    includeStudentRules: true,
  });
  const groupById = new Map(masterLayer.assignmentGroups.map(group => [group.id, group]));
  const seedAssignment = assignStudentsToScheduledSections(problem, seedTiming.meetings);
  const failedStudentIds = new Set((seedAssignment.failures || [])
    .map(failure => failure.student_id));
  const seedRoster = new Map((seedAssignment.sections || [])
    .map(section => [section.id, new Set(section.student_ids || [])]));
  const seedFixedSections = new Map(masterLayer.assignmentGroups.flatMap(group =>
    (group.student_ids || []).some(studentId => failedStudentIds.has(studentId))
      ? []
      : [[group.id, fixedSectionsFromRoster(group, seedRoster)]]));
  const releasedIds = new Set(options.initialReleasedGroupIds || []);
  const assignmentCuts = [...(options.initialAssignmentCuts || [])];
  const assignmentCutKeys = new Set(assignmentCuts.map(cut => cut
    .map(item => `${item.group_id}@${item.course_id}@${item.section_id}`)
    .sort().join('|')));
  let latestCore = assignmentCuts.at(-1) || [];
  const releaseEveryCuts = Math.max(1, Number(options.releaseEveryCuts || 5));
  let lastReleaseCutCount = releasedIds.size ? assignmentCuts.length : 0;
  if (assignmentCuts.length - lastReleaseCutCount >= releaseEveryCuts) {
    const releaseCandidates = flexibleCoreGroups(latestCore, groupById, releasedIds);
    if (releaseCandidates.length) {
      releasedIds.add(releaseCandidates[0].group_id);
      lastReleaseCutCount = assignmentCuts.length;
    }
  }
  let previous = options.initialTiming || seedTiming;
  let rosterIteration = 0;

  while (rosterIteration < maxIterations && performance.now() < deadline) {
    const remainingSeconds = () => Math.max(0.1, (deadline - performance.now()) / 1000);
    const assignmentGroups = masterLayer.assignmentGroups.map(group =>
      seedFixedSections.has(group.id) && !releasedIds.has(group.id)
        ? { ...group, fixed_sections: seedFixedSections.get(group.id) }
        : group);
    const masterOptions = {
      optimizeSoft: false,
      freezeMembership: true,
      lockedMeetings,
      useConstructiveSeed: false,
      assignmentGroups,
      assignmentCuts,
      channelAssignmentGroupTimes: false,
      hintMeetings: previous.meetings,
      hintSections: previous.sections,
      repairHints: false,
      randomSeed: Number(options.randomSeed || 1) + rosterIteration,
    };
    progress({
      stage: 'roster-master',
      iteration: rosterIteration + 1,
      assignment_cut_count: assignmentCuts.length,
      released_group_count: releasedIds.size,
      failed_seed_student_count: failedStudentIds.size,
    });
    let master = await solveSchedule(masterLayer.problem, {
      ...masterOptions,
      maxTimeSeconds: Math.min(Number(options.masterTimeSeconds || 45), remainingSeconds()),
    });
    if (!master.ok && master.status === 'UNKNOWN' && performance.now() < deadline) {
      master = await solveSchedule(masterLayer.problem, {
        ...masterOptions,
        maxTimeSeconds: Math.min(Number(options.masterRetrySeconds || 120), remainingSeconds()),
        repairHints: true,
        numSearchWorkers: Number(options.numSearchWorkers || 8),
      });
    }
    if (!master.ok) {
      const releaseCandidates = flexibleCoreGroups(latestCore, groupById, releasedIds);
      if (['INFEASIBLE', 'UNKNOWN'].includes(master.status) && releaseCandidates.length) {
        releasedIds.add(releaseCandidates[0].group_id);
        lastReleaseCutCount = assignmentCuts.length;
        progress({
          stage: 'release-group',
          group_id: releaseCandidates[0].group_id,
          score: releaseCandidates[0].score,
          master_status: master.status,
          released_group_count: releasedIds.size,
        });
        continue;
      }
      return {
        ...master,
        algorithm: 'conflict-directed-roster-benders',
        reason: master.reason || '分班骨架主问题未找到可行解',
        roster_iterations: rosterIteration,
        assignment_cut_count: assignmentCuts.length,
        released_group_ids: [...releasedIds],
        failed_seed_student_ids: [...failedStudentIds],
        solve_duration_ms: Math.round(performance.now() - startedAt),
      };
    }
    rosterIteration += 1;
    previous = master;

    const fixedRosterProblem = problemWithDynamicRoster(
      problem,
      masterLayer.dynamicSectionIds,
      master.sections,
    );
    const fixedTiming = await solveSchedule(fixedRosterProblem, {
      maxTimeSeconds: Math.min(Number(options.timingTimeSeconds || 90), remainingSeconds()),
      optimizeSoft: false,
      freezeMembership: true,
      lockedMeetings,
      useConstructiveSeed: false,
      hintMeetings: master.meetings,
      hintSections: master.sections,
      repairHints: false,
      randomSeed: Number(options.randomSeed || 1) + 1000 + rosterIteration,
    });
    if (fixedTiming.ok) {
      const validation = validateSchedule(problem, { ...fixedTiming, locks: lockedMeetings });
      return {
        ...fixedTiming,
        status: 'ROSTER_BENDERS_FEASIBLE',
        validation,
        algorithm: 'conflict-directed-roster-benders',
        roster_iterations: rosterIteration,
        assignment_cut_count: assignmentCuts.length,
        released_group_ids: [...releasedIds],
        failed_seed_student_ids: [...failedStudentIds],
        solve_duration_ms: Math.round(performance.now() - startedAt),
      };
    }
    if (fixedTiming.status !== 'INFEASIBLE') return {
      ...fixedTiming,
      algorithm: 'conflict-directed-roster-benders',
      reason: fixedTiming.reason || '固定分班的时段子问题未返回结论',
      roster_iterations: rosterIteration,
      assignment_cut_count: assignmentCuts.length,
      released_group_ids: [...releasedIds],
      failed_seed_student_ids: [...failedStudentIds],
      solve_duration_ms: Math.round(performance.now() - startedAt),
    };

    const masterRoster = new Map((master.sections || [])
      .map(section => [section.id, new Set(section.student_ids || [])]));
    const fixedCoreGroups = coreLayer.assignmentGroups.map(group => ({
      ...group,
      fixed_sections: fixedSectionsFromRoster(group, masterRoster),
    }));
    const coreResult = await solveSchedule(coreLayer.problem, {
      maxTimeSeconds: Math.min(Number(options.coreTimeSeconds || 45), remainingSeconds()),
      optimizeSoft: false,
      freezeMembership: true,
      lockedMeetings,
      useConstructiveSeed: false,
      assignmentGroups: fixedCoreGroups,
      channelAssignmentGroupTimes: true,
      assumeFixedAssignments: true,
      hintMeetings: master.meetings,
      hintSections: master.sections,
      repairHints: false,
      randomSeed: Number(options.randomSeed || 1) + 2000 + rosterIteration,
    });
    latestCore = coreResult.infeasible_assumption_assignments || [];
    progress({
      stage: 'roster-core',
      iteration: rosterIteration,
      timing_status: fixedTiming.status,
      core_status: coreResult.status,
      assignment_core_size: latestCore.length,
      assignment_cut_count: assignmentCuts.length,
      released_group_count: releasedIds.size,
    });
    if (coreResult.status !== 'INFEASIBLE' || !latestCore.length) return {
      ...coreResult,
      algorithm: 'conflict-directed-roster-benders',
      reason: coreResult.reason || '无法从不可行 roster 中提取分班冲突核',
      roster_iterations: rosterIteration,
      assignment_cut_count: assignmentCuts.length,
      released_group_ids: [...releasedIds],
      failed_seed_student_ids: [...failedStudentIds],
      solve_duration_ms: Math.round(performance.now() - startedAt),
    };
    const key = latestCore.map(item =>
      `${item.group_id}@${item.course_id}@${item.section_id}`)
      .sort().join('|');
    if (assignmentCutKeys.has(key)) return {
      ok: false,
      status: 'ROSTER_BENDERS_STALLED',
      reason: '分班子问题重复返回同一冲突核',
      sections: [], meetings: [], assignments: [],
      algorithm: 'conflict-directed-roster-benders',
      roster_iterations: rosterIteration,
      assignment_cut_count: assignmentCuts.length,
      released_group_ids: [...releasedIds],
      failed_seed_student_ids: [...failedStudentIds],
      solve_duration_ms: Math.round(performance.now() - startedAt),
    };
    assignmentCutKeys.add(key);
    assignmentCuts.push(latestCore);
    if (assignmentCuts.length - lastReleaseCutCount >= releaseEveryCuts) {
      const releaseCandidates = flexibleCoreGroups(latestCore, groupById, releasedIds);
      if (releaseCandidates.length) {
        releasedIds.add(releaseCandidates[0].group_id);
        lastReleaseCutCount = assignmentCuts.length;
        progress({
          stage: 'release-group',
          group_id: releaseCandidates[0].group_id,
          score: releaseCandidates[0].score,
          master_status: 'PLATEAU',
          released_group_count: releasedIds.size,
        });
      }
    }
    saveCheckpoint({
      roster_iteration: rosterIteration,
      assignment_cuts: structuredClone(assignmentCuts),
      released_group_ids: [...releasedIds],
      timing: structuredClone(previous),
      latest_assignment_core: structuredClone(latestCore),
    });
  }
  return {
    ok: false,
    status: 'UNKNOWN',
    reason: 'Roster Benders 求解在时限或迭代上限内未收敛',
    sections: [], meetings: [], assignments: [],
    checkpoint: {
      timing: previous,
      assignment_cuts: assignmentCuts,
      released_group_ids: [...releasedIds],
    },
    algorithm: 'conflict-directed-roster-benders',
    roster_iterations: rosterIteration,
    assignment_cut_count: assignmentCuts.length,
    released_group_ids: [...releasedIds],
    failed_seed_student_ids: [...failedStudentIds],
    solve_duration_ms: Math.round(performance.now() - startedAt),
  };
}
