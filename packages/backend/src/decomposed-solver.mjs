import { solveSchedule } from './cpsat-solver.mjs';
import { validateSchedule } from './schedule-validator.mjs';

function isDynamicSection(section) {
  return ['ap', 'elective'].includes(section.class_type)
    && (section.eligible_student_ids || []).length > 0;
}

function unique(values) {
  return [...new Set(values)];
}

function anchorSlots(problem, lockedMeetings) {
  const dynamicIds = new Set(problem.sections.filter(isDynamicSection).map(section => section.id));
  const slots = new Map();
  const add = (sectionId, slotId) => {
    if (dynamicIds.has(sectionId)) return;
    const values = slots.get(sectionId) || new Set();
    values.add(slotId);
    slots.set(sectionId, values);
  };
  for (const lock of lockedMeetings || []) add(lock.section_id, lock.slot_id);
  for (const rule of problem.rules || []) {
    if (!rule.hard || rule.type !== 'fixed_slots') continue;
    for (const sectionId of rule.section_target_ids || []) {
      for (const slotId of rule.params?.slots || []) add(sectionId, slotId);
    }
  }
  return slots;
}

function filteredDynamicRules(problem, includedSectionIds, options = {}) {
  return (problem.rules || []).flatMap(rule => {
    if (rule.scope === 'student') {
      return options.includeStudentRules === true ? [rule] : [];
    }
    if (rule.type === 'fixed_slots') {
      const targets = (rule.section_target_ids || []).filter(id => includedSectionIds.has(id));
      if (!targets.length) return [];
      return [{
        ...rule,
        section_target_ids: targets,
        ...(rule.scope === 'section' ? { target_ids: targets } : {}),
      }];
    }
    if (Array.isArray(rule.section_target_ids)) {
      const targets = rule.section_target_ids.filter(id => includedSectionIds.has(id));
      if (!targets.length || (rule.type === 'synchronized_slots' && targets.length < 2)) return [];
      return [{
        ...rule,
        section_target_ids: targets,
        ...(rule.scope === 'section' ? { target_ids: targets } : {}),
      }];
    }
    if (rule.scope === 'section') {
      const targets = (rule.target_ids || []).filter(id => includedSectionIds.has(id));
      return targets.length ? [{ ...rule, target_ids: targets }] : [];
    }
    return [rule];
  });
}

function coupledCoreSections(problem, candidates) {
  const separatingRules = (problem.rules || []).filter(rule =>
    rule.hard && rule.type === 'separate_class_types');
  return problem.sections.filter(section => {
    if (isDynamicSection(section) || section.weekly_hours <= 0) return false;
    return separatingRules.some(rule => candidates.some(candidate => {
      const left = new Set(rule.params?.left_class_types || []);
      const right = new Set(rule.params?.right_class_types || []);
      const oppositeTypes = (left.has(section.class_type) && right.has(candidate.class_type))
        || (right.has(section.class_type) && left.has(candidate.class_type));
      if (!oppositeTypes) return false;
      const affectedGrades = new Set(rule.params?.grades || []);
      return (section.grades || []).some(grade =>
        (candidate.grades || []).includes(grade)
        && (!affectedGrades.size || affectedGrades.has(grade)));
    }));
  });
}

function buildDetailedAssignmentGroups(problem, candidates, anchors) {
  const sectionsByStudent = new Map();
  for (const section of candidates) for (const studentId of section.eligible_student_ids || []) {
    const courses = sectionsByStudent.get(studentId) || new Map();
    const parallel = courses.get(section.course_id) || [];
    parallel.push(section);
    courses.set(section.course_id, parallel);
    sectionsByStudent.set(studentId, courses);
  }
  const grouped = new Map();
  for (const [studentId, courses] of sectionsByStudent) {
    const coreSectionIds = anchors
      .filter(section => (section.student_ids || []).includes(studentId))
      .map(section => section.id)
      .sort();
    const courseItems = [...courses].map(([courseId, sections]) => ({
      course_id: courseId,
      candidate_section_ids: sections.map(section => section.id).sort(),
    })).sort((left, right) => left.course_id.localeCompare(right.course_id));
    const fixedSections = Object.fromEntries(courseItems.flatMap(course => {
      const fixed = course.candidate_section_ids.filter(sectionId => {
        const section = problem.sections.find(item => item.id === sectionId);
        return (section.locked_student_ids || []).includes(studentId);
      });
      if (fixed.length > 1) throw new Error(`学生 ${studentId} 的 ${course.course_id} 被锁定到多个 section`);
      return fixed.length ? [[course.course_id, fixed[0]]] : [];
    }));
    const key = [
      coreSectionIds.join(','),
      courseItems.map(course => `${course.course_id}:${course.candidate_section_ids.join(',')}`).join(';'),
      Object.entries(fixedSections).sort().map(([courseId, sectionId]) => `${courseId}:${sectionId}`).join(','),
    ].join('|');
    const group = grouped.get(key) || {
      id: `DYNAMIC_GROUP_${grouped.size + 1}`,
      exact_student_cohort: true,
      student_ids: [],
      core_section_ids: coreSectionIds,
      courses: courseItems,
      fixed_sections: fixedSections,
    };
    group.student_ids.push(studentId);
    grouped.set(key, group);
  }
  return [...grouped.values()];
}

function buildAssignmentGroups(problem, candidates, scheduledCoreSections, options = {}) {
  if (options.assignmentMode === 'detailed'
    || candidates.some(section => (section.locked_student_ids || []).length)) {
    return buildDetailedAssignmentGroups(problem, candidates, scheduledCoreSections);
  }
  const dynamicIds = new Set(candidates.map(section => section.id));
  const fullCoreSections = problem.sections.filter(section => !dynamicIds.has(section.id));
  const coursesByStudent = new Map();
  for (const section of candidates) for (const studentId of section.eligible_student_ids || []) {
    const courses = coursesByStudent.get(studentId) || new Map();
    const own = courses.get(section.course_id) || [];
    own.push(section.id);
    courses.set(section.course_id, own);
    coursesByStudent.set(studentId, courses);
  }
  const grouped = new Map();
  let incompatibleCandidateSets = false;
  for (const [studentId, courses] of coursesByStudent) {
    const identityCoreIds = fullCoreSections
      .filter(section => (section.student_ids || []).includes(studentId))
      .map(section => section.id)
      .sort();
    const scheduledCoreIds = scheduledCoreSections
      .filter(section => (section.student_ids || []).includes(studentId))
      .map(section => section.id)
      .sort();
    const key = identityCoreIds.join(',');
    const group = grouped.get(key) || {
      id: `CLASS_GROUP_${grouped.size + 1}`,
      exact_student_cohort: false,
      student_ids: [],
      core_section_ids: scheduledCoreIds,
      courseMap: new Map(),
      fixed_sections: {},
    };
    group.student_ids.push(studentId);
    for (const [courseId, rawCandidateIds] of courses) {
      const candidateIds = unique(rawCandidateIds).sort();
      const course = group.courseMap.get(courseId) || {
        course_id: courseId,
        candidate_section_ids: candidateIds,
        student_ids: [],
      };
      if (course.candidate_section_ids.join(',') !== candidateIds.join(',')) {
        incompatibleCandidateSets = true;
      }
      course.student_ids.push(studentId);
      group.courseMap.set(courseId, course);
    }
    grouped.set(key, group);
  }
  if (incompatibleCandidateSets) {
    return buildDetailedAssignmentGroups(problem, candidates, scheduledCoreSections);
  }
  return [...grouped.values()].map(group => ({
    id: group.id,
    exact_student_cohort: false,
    student_ids: group.student_ids.sort(),
    core_section_ids: group.core_section_ids,
    courses: [...group.courseMap.values()]
      .map(course => ({ ...course, student_ids: course.student_ids.sort() }))
      .sort((left, right) => left.course_id.localeCompare(right.course_id)),
    fixed_sections: group.fixed_sections,
  }));
}

function selectedSlotUnionBounds(problem, candidates) {
  const separatingRules = (problem.rules || []).filter(rule => {
    if (!rule.hard || rule.type !== 'separate_class_types') return false;
    const left = new Set(rule.params?.left_class_types || []);
    const right = new Set(rule.params?.right_class_types || []);
    const selectedOnLeft = left.has('ap') || left.has('elective');
    const selectedOnRight = right.has('ap') || right.has('elective');
    return (left.has('admin') && selectedOnRight) || (right.has('admin') && selectedOnLeft);
  });
  if (!separatingRules.length) return [];
  const grades = unique(candidates.flatMap(section => section.grades || [])).sort((a, b) => a - b);
  return grades.flatMap(grade => {
    const applies = separatingRules.some(rule =>
      !(rule.params?.grades || []).length || rule.params.grades.includes(grade));
    if (!applies) return [];
    const adminHoursByClass = new Map();
    for (const section of problem.sections) {
      if (section.class_type !== 'admin' || !(section.grades || []).includes(grade)) continue;
      adminHoursByClass.set(
        section.class_id,
        (adminHoursByClass.get(section.class_id) || 0) + section.weekly_hours,
      );
    }
    const requiredAdminSlots = Math.max(0, ...adminHoursByClass.values());
    return [{
      id: `GRADE_${grade}_SELECTED_SLOT_UNION`,
      section_ids: candidates
        .filter(section => (section.grades || []).includes(grade))
        .map(section => section.id),
      max_distinct_slots: problem.slots.length - requiredAdminSlots,
    }];
  });
}

function coreAvailabilityRequirements(
  problem,
  candidates,
  scheduledCoreSections,
  assignmentGroups,
  fixedAnchorSlots,
) {
  const dynamicIds = new Set(candidates.map(section => section.id));
  const coreSections = problem.sections.filter(section =>
    !dynamicIds.has(section.id) && section.weekly_hours > 0);
  const scheduledHours = new Map(scheduledCoreSections.map(section => [section.id, section.weekly_hours]));
  const remainingHours = section => Math.max(
    0,
    section.weekly_hours - (scheduledHours.get(section.id) || 0),
  );
  const requirements = [];

  const dynamicStudents = new Set(assignmentGroups.flatMap(group => group.student_ids || []));
  const coreByClass = new Map();
  for (const section of coreSections) {
    if (!section.class_id
      || section.class_type !== 'teaching'
      || remainingHours(section) <= 0
      || !(section.student_ids || []).some(studentId => dynamicStudents.has(studentId))) continue;
    const own = coreByClass.get(section.class_id) || [];
    own.push(section);
    coreByClass.set(section.class_id, own);
  }
  for (const [classId, ownCore] of coreByClass) {
    const classStudents = unique(ownCore.flatMap(section => section.student_ids || [])).sort();
    const classStudentSet = new Set(classStudents);
    requirements.push({
      id: `CLASS_TOTAL_${classId}`,
      student_ids: classStudents,
      required_slots: ownCore.reduce((total, section) => total + remainingHours(section), 0),
      unconditional_blocking_section_ids: scheduledCoreSections
        .filter(section => (section.student_ids || []).some(studentId => classStudentSet.has(studentId)))
        .map(section => section.id)
        .sort(),
    });
  }

  // A five-day course constrained to at most one occurrence per day needs one
  // common-free slot on every school day.  Reserve those daily witnesses per
  // class, considering the union of every selected section attended by any
  // class member and every already scheduled core section attended by them.
  const days = [...new Set(problem.slots.map(slot => slot.day))].sort((left, right) => left - right);
  const recurringCourseIds = new Set((problem.rules || [])
    .filter(rule => rule.hard
      && rule.type === 'max_occurrences_per_day'
      && rule.scope === 'course'
      && rule.params?.max === 1)
    .flatMap(rule => rule.target_ids || []));
  const recurringByClass = new Map();
  for (const section of coreSections) {
    if (!section.class_id
      || section.weekly_hours !== days.length
      || !recurringCourseIds.has(section.course_id)
      || !(section.student_ids || []).some(studentId => dynamicStudents.has(studentId))) continue;
    const own = recurringByClass.get(section.class_id) || [];
    own.push(section);
    recurringByClass.set(section.class_id, own);
  }
  const dayBySlotId = new Map(problem.slots.map(slot => [slot.id, slot.day]));
  for (const [classId, recurringSections] of recurringByClass) {
    const classStudents = unique(recurringSections.flatMap(section => section.student_ids || [])).sort();
    const classStudentSet = new Set(classStudents);
    const blockers = scheduledCoreSections
      .filter(section => (section.student_ids || []).some(studentId => classStudentSet.has(studentId)))
      .map(section => section.id)
      .sort();
    for (const day of days) {
      const requiredSlots = recurringSections.filter(section => {
        if (remainingHours(section) <= 0) return false;
        return ![...(fixedAnchorSlots.get(section.id) || [])]
          .some(slotId => dayBySlotId.get(slotId) === day);
      }).length;
      if (!requiredSlots) continue;
      requirements.push({
        id: `CLASS_DAY_${classId}_${day}`,
        student_ids: classStudents,
        required_slots: requiredSlots,
        eligible_slot_ids: problem.slots.filter(slot => slot.day === day).map(slot => slot.id),
        unconditional_blocking_section_ids: blockers,
      });
    }
  }

  // Cross-grade teachers are another global resource.  Reserve their total
  // remaining core workload outside all already anchored or dynamic meetings
  // taught by that teacher, independently of student section choices.
  const coreByTeacher = new Map();
  for (const section of coreSections) if (section.teacher_id) {
    const own = coreByTeacher.get(section.teacher_id) || [];
    own.push(section);
    coreByTeacher.set(section.teacher_id, own);
  }
  for (const [teacherId, ownCore] of coreByTeacher) {
    const requiredSlots = ownCore.reduce((total, section) =>
      total + remainingHours(section), 0);
    const blockers = unique([
      ...candidates.filter(section => section.teacher_id === teacherId).map(section => section.id),
      ...scheduledCoreSections.filter(section => section.teacher_id === teacherId).map(section => section.id),
    ]).sort();
    if (requiredSlots <= 0 || !blockers.length) continue;
    requirements.push({
      id: `TEACHER_${teacherId}`,
      assignment_group_ids: [],
      student_ids: [],
      required_slots: requiredSlots,
      unconditional_blocking_section_ids: blockers,
    });
  }
  return requirements;
}

function indexedMeetings(problem, meetings, sectionIds) {
  const slotOrder = new Map(problem.slots.map((slot, index) => [slot.id, index]));
  const grouped = new Map();
  for (const meeting of meetings || []) {
    if (!sectionIds.has(meeting.section_id)) continue;
    const list = grouped.get(meeting.section_id) || [];
    list.push(meeting);
    grouped.set(meeting.section_id, list);
  }
  return [...grouped].flatMap(([sectionId, values]) => values
    .sort((left, right) => slotOrder.get(left.slot_id) - slotOrder.get(right.slot_id))
    .map((meeting, occurrenceIndex) => ({
      section_id: sectionId,
      occurrence_index: occurrenceIndex,
      slot_id: meeting.slot_id,
    })));
}

export function findUnmetCoreAvailabilityRequirements(problem, requirements, solution) {
  const meetingsBySection = new Map();
  for (const meeting of solution.meetings || []) {
    const own = meetingsBySection.get(meeting.section_id) || [];
    own.push(meeting);
    meetingsBySection.set(meeting.section_id, own);
  }
  const validSlotIds = new Set((problem.slots || []).map(slot => slot.id));
  return (requirements || []).flatMap(requirement => {
    const eligible = requirement.eligible_slot_ids
      ? new Set(requirement.eligible_slot_ids)
      : new Set(validSlotIds);
    const blocked = new Set();
    for (const sectionId of requirement.unconditional_blocking_section_ids || []) {
      for (const meeting of meetingsBySection.get(sectionId) || []) {
        if (eligible.has(meeting.slot_id)) blocked.add(meeting.slot_id);
      }
    }
    const students = new Set(requirement.student_ids || []);
    if (students.size) for (const section of solution.sections || []) {
      if (!['ap', 'elective'].includes(section.class_type)) continue;
      if (!(section.student_ids || []).some(studentId => students.has(studentId))) continue;
      for (const meeting of meetingsBySection.get(section.id) || []) {
        if (eligible.has(meeting.slot_id)) blocked.add(meeting.slot_id);
      }
    }
    const availableSlots = [...eligible].filter(slotId => validSlotIds.has(slotId) && !blocked.has(slotId));
    return availableSlots.length < requirement.required_slots
      ? [{ ...requirement, available_slots: availableSlots.length }]
      : [];
  });
}

export function buildDynamicSchedulingLayer(problem, lockedMeetings = [], options = {}) {
  const sectionById = new Map(problem.sections.map(section => [section.id, section]));
  const candidates = problem.sections.filter(isDynamicSection);
  const dynamicSectionIds = new Set(candidates.map(section => section.id));
  const fixedAnchorSlots = anchorSlots(problem, lockedMeetings);
  const coupled = options.includeAllCore
    ? problem.sections.filter(section => !isDynamicSection(section) && section.weekly_hours > 0)
    : coupledCoreSections(problem, candidates);
  const coupledIds = new Set(coupled.map(section => section.id));
  const scheduledCoreById = new Map(coupled.map(section => [section.id, section]));
  for (const [sectionId, slots] of fixedAnchorSlots) {
    const section = sectionById.get(sectionId);
    if (!section) throw new Error(`固定锚点引用了不存在的 section: ${sectionId}`);
    if (!scheduledCoreById.has(sectionId)) {
      scheduledCoreById.set(sectionId, { ...section, weekly_hours: slots.size });
    }
  }
  const scheduledCoreSections = [...scheduledCoreById.values()];
  const included = [...candidates, ...scheduledCoreSections];
  const includedSectionIds = new Set(included.map(section => section.id));
  const masterSectionIds = new Set(includedSectionIds);
  const slotOrder = new Map(problem.slots.map((slot, index) => [slot.id, index]));
  const anchorRules = [...fixedAnchorSlots].filter(([sectionId]) => !coupledIds.has(sectionId)).map(([sectionId, slots], index) => ({
    id: `decomposed_anchor_${index + 1}`,
    name: `分解求解固定锚点 ${sectionId}`,
    type: 'fixed_slots',
    hard: true,
    weight: 0,
    scope: 'section',
    target_ids: [sectionId],
    section_target_ids: [sectionId],
    params: {
      slots: [...slots].sort((left, right) => slotOrder.get(left) - slotOrder.get(right)),
      mode: 'exact',
    },
    unmatched: false,
  }));
  const assignmentGroups = buildAssignmentGroups(
    problem,
    candidates,
    scheduledCoreSections,
    options,
  );
  return {
    dynamicSectionIds,
    masterSectionIds,
    assignmentGroups,
    slotUnionBounds: selectedSlotUnionBounds(problem, candidates),
    coreAvailabilityRequirements: coreAvailabilityRequirements(
      problem,
      candidates,
      scheduledCoreSections,
      assignmentGroups,
      fixedAnchorSlots,
    ),
    problem: {
      ...problem,
      sections: included.map(section => dynamicSectionIds.has(section.id)
        ? { ...section, student_ids: [] }
        : section),
      rules: [
        ...filteredDynamicRules(problem, includedSectionIds, options),
        ...anchorRules,
      ],
    },
  };
}

/**
 * Logic-based Benders scheduling:
 * 1. schedule the difficult AP/elective layer with fixed anchors;
 * 2. allocate the remaining core timetable while treating dynamic meetings as
 *    assumptions;
 * 3. feed a sufficient infeasible assumption core back as an exact no-good.
 */
export async function solveDecomposedSchedule(problem, options = {}) {
  const startedAt = performance.now();
  const maxTimeSeconds = Math.max(1, Number(options.maxTimeSeconds || 120));
  const deadline = startedAt + maxTimeSeconds * 1000;
  const maxIterations = Math.max(1, Number(options.maxIterations || 60));
  const lockedMeetings = options.lockedMeetings || [];
  const layer = buildDynamicSchedulingLayer(problem, lockedMeetings, {
    assignmentMode: options.assignmentMode,
    includeAllCore: options.includeAllCoreInMaster === true,
  });
  if (!layer.dynamicSectionIds.size) {
    return solveSchedule(problem, {
      ...options,
      freezeMembership: true,
      lockedMeetings,
      maxTimeSeconds,
    });
  }
  const timetableCuts = [];
  const cutKeys = new Set();
  const iterations = [];
  const activeAvailabilityRequirements = new Map();
  let previousDynamic = null;
  const masterLocks = lockedMeetings.filter(lock => layer.masterSectionIds.has(lock.section_id));
  const phaseRules = options.enforceStudentRules === false
    ? (problem.rules || []).filter(rule => rule.scope !== 'student')
    : problem.rules || [];
  for (let iteration = 1; iteration <= maxIterations && performance.now() < deadline; iteration += 1) {
    const remainingSeconds = Math.max(0.1, (deadline - performance.now()) / 1000);
    const phaseBudget = Math.min(Number(options.phaseTimeSeconds || 20), remainingSeconds);
    const phase1Started = performance.now();
    const dynamic = await solveSchedule(layer.problem, {
      maxTimeSeconds: phaseBudget,
      optimizeSoft: false,
      freezeMembership: true,
      lockedMeetings: masterLocks,
      useConstructiveSeed: false,
      assignmentGroups: layer.assignmentGroups,
      slotUnionBounds: layer.slotUnionBounds,
      coreAvailabilityRequirements: [...activeAvailabilityRequirements.values()],
      timetableCuts,
      hintMeetings: previousDynamic?.meetings
        || options.masterHintMeetings
        || options.hintMeetings
        || [],
      hintSections: previousDynamic?.sections
        || options.masterHintSections
        || options.hintSections
        || [],
      repairHints: previousDynamic ? false : options.repairHints,
      randomSeed: options.randomSeed,
    });
    const phase1Ms = Math.round(performance.now() - phase1Started);
    if (!dynamic.ok) return {
      ...dynamic,
      algorithm: 'dynamic-first-benders',
      reason: dynamic.reason || '动态选修主问题未找到可行解',
      benders_iterations: iterations,
      solve_duration_ms: Math.round(performance.now() - startedAt),
    };
    const unmetAvailability = options.useAvailabilityRequirements === false
      ? []
      : findUnmetCoreAvailabilityRequirements(
        layer.problem,
        layer.coreAvailabilityRequirements,
        dynamic,
      ).filter(requirement => !activeAvailabilityRequirements.has(requirement.id))
        .sort((left, right) =>
          (right.required_slots - right.available_slots) - (left.required_slots - left.available_slots)
          || left.id.localeCompare(right.id))
        .slice(0, Math.max(1, Number(options.availabilityCutBatchSize || 3)));
    previousDynamic = dynamic;
    if (unmetAvailability.length) {
      for (const requirement of unmetAvailability) {
        activeAvailabilityRequirements.set(requirement.id, requirement);
      }
      iterations.push({
        iteration,
        phase1_ms: phase1Ms,
        phase2_ms: 0,
        cut_count: timetableCuts.length,
        infeasible_core_size: 0,
        infeasible_core: [],
        phase2_status: 'MASTER_AVAILABILITY_CUT',
        activated_availability_requirements: unmetAvailability.map(item => item.id),
      });
      continue;
    }
    const rosterBySection = new Map(dynamic.sections
      .filter(section => layer.dynamicSectionIds.has(section.id))
      .map(section => [section.id, section.student_ids || []]));
    const fullProblem = {
      ...problem,
      rules: phaseRules,
      sections: problem.sections.map(section => layer.dynamicSectionIds.has(section.id)
        ? { ...section, student_ids: [...(rosterBySection.get(section.id) || [])] }
        : section),
    };
    const assumptions = indexedMeetings(problem, dynamic.meetings, layer.masterSectionIds);
    const phase2Started = performance.now();
    const full = await solveSchedule(fullProblem, {
      maxTimeSeconds: Math.min(phaseBudget, Math.max(0.1, (deadline - performance.now()) / 1000)),
      optimizeSoft: false,
      freezeMembership: true,
      lockedMeetings,
      assumptionMeetings: assumptions,
      useConstructiveSeed: false,
      hintMeetings: options.fullHintMeetings || options.hintMeetings || [],
      hintSections: options.fullHintSections || options.hintSections || [],
      randomSeed: options.randomSeed,
    });
    const phase2Ms = Math.round(performance.now() - phase2Started);
    const infeasibleCore = full.infeasible_assumption_meetings || [];
    iterations.push({
      iteration,
      phase1_ms: phase1Ms,
      phase2_ms: phase2Ms,
      cut_count: timetableCuts.length,
      infeasible_core_size: infeasibleCore.length,
      infeasible_core: infeasibleCore,
      phase2_status: full.status,
    });
    if (full.ok) {
      const validation = validateSchedule(problem, { ...full, locks: lockedMeetings });
      if (!validation.ok) return {
        ok: false,
        status: 'DECOMPOSED_VALIDATION_FAILED',
        reason: validation.hard_violations[0]?.message || '分解求解结果未通过独立校验',
        sections: [], meetings: [], assignments: [], validation,
        algorithm: 'dynamic-first-benders',
        benders_iterations: iterations,
        solve_duration_ms: Math.round(performance.now() - startedAt),
      };
      return {
        ...full,
        status: 'DECOMPOSED_FEASIBLE',
        algorithm: 'dynamic-first-benders',
        validation,
        benders_iterations: iterations,
        solve_duration_ms: Math.round(performance.now() - startedAt),
      };
    }
    if (full.status !== 'INFEASIBLE' || !infeasibleCore.length) return {
      ...full,
      algorithm: 'dynamic-first-benders',
      reason: full.reason || '基础课程子问题未能返回可用的不可行核心',
      benders_iterations: iterations,
      solve_duration_ms: Math.round(performance.now() - startedAt),
    };
    const cutKey = infeasibleCore
      .map(item => `${item.section_id}#${item.occurrence_index}@${item.slot_id}`)
      .sort()
      .join('|');
    if (cutKeys.has(cutKey)) return {
      ok: false,
      status: 'BENDERS_STALLED',
      reason: '基础课程子问题重复返回同一不可行核心',
      sections: [], meetings: [], assignments: [],
      algorithm: 'dynamic-first-benders',
      benders_iterations: iterations,
      solve_duration_ms: Math.round(performance.now() - startedAt),
    };
    cutKeys.add(cutKey);
    timetableCuts.push(infeasibleCore);
  }
  return {
    ok: false,
    status: 'UNKNOWN',
    reason: '分解求解在时限或迭代上限内未找到完整可行课表',
    sections: [], meetings: [], assignments: [],
    algorithm: 'dynamic-first-benders',
    benders_iterations: iterations,
    solve_duration_ms: Math.round(performance.now() - startedAt),
  };
}
