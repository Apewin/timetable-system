import { solveSchedule } from './cpsat-solver.mjs';
import { buildDynamicSchedulingLayer } from './decomposed-solver.mjs';
import { validateSchedule } from './schedule-validator.mjs';
import { assignStudentsToScheduledSections } from './student-section-assignment.mjs';

function studentRuleSubset(problem, studentIds) {
  return {
    ...problem,
    rules: (problem.rules || []).flatMap(rule => {
      if (rule.scope !== 'student') return [rule];
      const targets = (rule.target_ids || []).filter(id => studentIds.has(id));
      return targets.length ? [{ ...rule, target_ids: targets }] : [];
    }),
  };
}

function groupGrade(layer, group) {
  const sectionById = new Map(layer.problem.sections.map(section => [section.id, section]));
  const coreGrades = [...new Set((group.core_section_ids || [])
    .flatMap(sectionId => sectionById.get(sectionId)?.grades || []))];
  if (coreGrades.length === 1) return coreGrades[0];
  const candidateGrades = [...new Set((group.courses || [])
    .flatMap(course => course.candidate_section_ids || [])
    .flatMap(sectionId => sectionById.get(sectionId)?.grades || []))];
  return candidateGrades.length === 1 ? candidateGrades[0] : null;
}

function neighborhoodSectionIds(layer, grade) {
  if (!Number.isInteger(Number(grade))) {
    return new Set(layer.problem.sections.map(section => section.id));
  }
  const unlocked = new Set(layer.problem.sections
    .filter(section => (section.grades || []).map(Number).includes(Number(grade)))
    .map(section => section.id));
  let changed = true;
  while (changed) {
    changed = false;
    const teachers = new Set(layer.problem.sections
      .filter(section => unlocked.has(section.id))
      .map(section => section.teacher_id)
      .filter(Boolean));
    for (const section of layer.problem.sections) {
      if (teachers.has(section.teacher_id) && !unlocked.has(section.id)) {
        unlocked.add(section.id);
        changed = true;
      }
    }
    for (const rule of layer.problem.rules || []) {
      if (rule.type !== 'synchronized_slots') continue;
      const targets = rule.section_target_ids || rule.target_ids || [];
      if (!targets.some(sectionId => unlocked.has(sectionId))) continue;
      for (const sectionId of targets) if (!unlocked.has(sectionId)) {
        unlocked.add(sectionId);
        changed = true;
      }
    }
  }
  return unlocked;
}

function activeStudentIds(groups, alwaysActiveStudentIds = []) {
  return new Set([
    ...alwaysActiveStudentIds,
    ...groups.flatMap(group => group.student_ids || []),
  ]);
}

function failedGroups(layer, failures, activeIds, skippedIds) {
  const failedStudentIds = new Set((failures || []).map(failure => failure.student_id));
  return layer.assignmentGroups
    .filter(group => !activeIds.has(group.id)
      && !skippedIds.has(group.id)
      && (group.student_ids || []).some(studentId => failedStudentIds.has(studentId)))
    .sort((left, right) =>
      left.courses.length - right.courses.length
      || right.student_ids.length - left.student_ids.length
      || left.id.localeCompare(right.id));
}

function resultCheckpoint(groupIds, timing, assignment) {
  return {
    group_ids: [...groupIds],
    timing,
    failures: assignment.failures || [],
  };
}

/**
 * Incremental exact-student scheduling.
 *
 * The timetable master initially carries only representative student choice
 * profiles.  After every feasible timing pass, an independent assignment
 * subproblem checks every real student.  A failed profile is then added to the
 * master and only the affected grade plus its cross-grade teacher closure is
 * reopened.  No candidate is accepted until all active profiles still pass;
 * a final result additionally passes the ordinary full schedule validator.
 */
export async function solveIncrementalStudentSchedule(problem, options = {}) {
  const startedAt = performance.now();
  const maxTimeSeconds = Math.max(1, Number(options.maxTimeSeconds || 600));
  const deadline = startedAt + maxTimeSeconds * 1000;
  const iterationTimeSeconds = Math.max(1, Number(options.iterationTimeSeconds || 45));
  const maxIterations = Math.max(1, Number(options.maxIterations || 100));
  const lockedMeetings = options.lockedMeetings || [];
  const layer = buildDynamicSchedulingLayer(problem, lockedMeetings, {
    includeAllCore: true,
    assignmentMode: 'detailed',
    includeStudentRules: true,
  });
  const dynamicStudentIds = new Set(layer.assignmentGroups
    .flatMap(group => group.student_ids || []));
  // Students without AP/elective section choices never appear in an
  // assignment group.  Their core timetable rules (notably daily prefix/no
  // gaps) are still hard constraints and must be present in every master pass.
  const alwaysActiveStudentIds = new Set(layer.problem.sections
    .flatMap(section => section.student_ids || [])
    .filter(studentId => !dynamicStudentIds.has(studentId)));
  let checkpoint = options.initialCheckpoint ? structuredClone(options.initialCheckpoint) : null;
  let activeIds = new Set(checkpoint?.group_ids || []);
  const skippedIds = new Set();
  const progress = typeof options.onProgress === 'function' ? options.onProgress : () => {};
  const saveCheckpoint = typeof options.onCheckpoint === 'function' ? options.onCheckpoint : () => {};

  const solvePass = async ({ groups, prior, grade = null, iteration = 0 }) => {
    const students = activeStudentIds(groups, alwaysActiveStudentIds);
    const model = studentRuleSubset(layer.problem, students);
    const unlocked = prior ? neighborhoodSectionIds(layer, grade) : null;
    const neighborhoodLocks = prior
      ? (prior.timing?.meetings || [])
        .filter(meeting => !unlocked.has(meeting.section_id))
        .map(meeting => ({ ...meeting, origin: 'neighborhood' }))
      : [];
    const remainingSeconds = Math.max(0.1, (deadline - performance.now()) / 1000);
    const budget = Math.min(iterationTimeSeconds, remainingSeconds);
    progress({
      stage: prior ? 'repair' : 'initial',
      iteration,
      active_group_count: groups.length,
      active_student_count: students.size,
      neighborhood_section_count: unlocked?.size || layer.problem.sections.length,
      time_limit_seconds: budget,
    });
    return solveSchedule(model, {
      maxTimeSeconds: budget,
      optimizeSoft: false,
      freezeMembership: true,
      lockedMeetings: [...lockedMeetings, ...neighborhoodLocks],
      useConstructiveSeed: false,
      assignmentGroups: groups,
      channelAssignmentGroupTimes: true,
      hintMeetings: prior?.timing?.meetings || options.hintMeetings || [],
      hintSections: prior?.timing?.sections || options.hintSections || [],
      repairHints: false,
      randomSeed: Number.isInteger(options.randomSeed)
        ? options.randomSeed + iteration
        : 1 + (iteration % 7),
    });
  };

  if (!checkpoint) {
    const seedCount = Math.max(0, Number(options.initialSeedGroupCount ?? 8));
    const requestedSeedIds = new Set(options.initialGroupIds || []);
    const unknownSeedIds = [...requestedSeedIds]
      .filter(id => !layer.assignmentGroups.some(group => group.id === id));
    if (unknownSeedIds.length) {
      throw new Error(`初始学生组不存在: ${unknownSeedIds.join('、')}`);
    }
    const rankedSeeds = [...layer.assignmentGroups]
      .sort((left, right) =>
        right.student_ids.length - left.student_ids.length
        || left.courses.length - right.courses.length
        || left.id.localeCompare(right.id));
    const seedIds = requestedSeedIds.size
      ? requestedSeedIds
      : new Set(rankedSeeds.slice(0, seedCount).map(group => group.id));
    const seedGroups = layer.assignmentGroups.filter(group => seedIds.has(group.id));
    activeIds = new Set(seedGroups.map(group => group.id));
    const timing = await solvePass({ groups: seedGroups, prior: null });
    if (!timing.ok) return {
      ...timing,
      algorithm: 'incremental-exact-student-lns',
      solve_duration_ms: Math.round(performance.now() - startedAt),
    };
    const assignment = assignStudentsToScheduledSections(problem, timing.meetings);
    const activeStudents = activeStudentIds(seedGroups, alwaysActiveStudentIds);
    const activeFailures = (assignment.failures || [])
      .filter(failure => activeStudents.has(failure.student_id));
    if (activeFailures.length) throw new Error('初始增量模型返回了未被满足的已激活学生组');
    checkpoint = resultCheckpoint(activeIds, timing, assignment);
    saveCheckpoint(structuredClone(checkpoint));
  }

  for (let iteration = 1;
    iteration <= maxIterations && performance.now() < deadline;
    iteration += 1) {
    if (!(checkpoint.failures || []).length) {
      const assignment = assignStudentsToScheduledSections(problem, checkpoint.timing.meetings);
      const candidate = { ...assignment, locks: lockedMeetings };
      const validation = validateSchedule(problem, candidate);
      if (!validation.ok) return {
        ok: false,
        status: 'VALIDATION_FAILED',
        reason: validation.hard_violations[0]?.message || '最终课表未通过硬约束校验',
        validation,
        checkpoint,
        algorithm: 'incremental-exact-student-lns',
        solve_duration_ms: Math.round(performance.now() - startedAt),
      };
      return {
        ...assignment,
        status: 'INCREMENTAL_FEASIBLE',
        validation,
        active_group_ids: [...activeIds],
        algorithm: 'incremental-exact-student-lns',
        solve_duration_ms: Math.round(performance.now() - startedAt),
      };
    }
    const candidates = failedGroups(layer, checkpoint.failures, activeIds, skippedIds);
    if (!candidates.length) {
      // A previous UNKNOWN is not an infeasibility proof.  Clear the temporary
      // skip list and give candidates another chance from the newer checkpoint.
      if (skippedIds.size) {
        skippedIds.clear();
        continue;
      }
      break;
    }
    const target = candidates[0];
    const nextIds = new Set([...activeIds, target.id]);
    const groups = layer.assignmentGroups.filter(group => nextIds.has(group.id));
    const timing = await solvePass({
      groups,
      prior: checkpoint,
      grade: groupGrade(layer, target),
      iteration,
    });
    progress({
      stage: 'iteration-result',
      iteration,
      target_group_id: target.id,
      status: timing.status,
      ok: timing.ok,
    });
    if (!timing.ok) {
      // A repair pass fixes every section outside the affected grade/teacher
      // neighborhood.  INFEASIBLE therefore proves only that this particular
      // neighborhood is too small; it is not a proof that the school-wide
      // problem is infeasible.  Treat it like UNKNOWN and try another failed
      // profile (or a later restart with a wider/cumulative seed set).
      skippedIds.add(target.id);
      continue;
    }
    const assignment = assignStudentsToScheduledSections(problem, timing.meetings);
    const students = activeStudentIds(groups, alwaysActiveStudentIds);
    const activeFailures = (assignment.failures || [])
      .filter(failure => students.has(failure.student_id));
    if (activeFailures.length) throw new Error(
      `增量模型丢失已激活学生约束: ${activeFailures.map(item => item.student_id).join('、')}`,
    );
    activeIds = nextIds;
    checkpoint = resultCheckpoint(activeIds, timing, assignment);
    saveCheckpoint(structuredClone(checkpoint));
    skippedIds.clear();
    progress({
      stage: 'assignment-check',
      iteration,
      target_group_id: target.id,
      remaining_failure_count: checkpoint.failures.length,
      active_group_count: activeIds.size,
    });
  }
  return {
    ok: false,
    status: 'UNKNOWN',
    reason: '增量学生求解在时限或迭代上限内未收敛',
    checkpoint,
    active_group_ids: [...activeIds],
    remaining_failures: checkpoint?.failures || [],
    algorithm: 'incremental-exact-student-lns',
    solve_duration_ms: Math.round(performance.now() - startedAt),
  };
}
