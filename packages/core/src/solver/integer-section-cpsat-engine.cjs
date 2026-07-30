const { CpModel, CpSolver, CpSolverStatus, VariableSelectionStrategy, DomainReductionStrategy } = require('@ortools-node/cp-sat');
const { makeTaskId } = require('../constants.cjs');
const { buildSections } = require('./section-cpsat-engine.cjs');
const { normalizePolicies, matches } = require('./policy-rules.cjs');

const SLOTS = Array.from({ length: 50 }, (_, index) => `D${Math.floor(index / 10) + 1}P${(index % 10) + 1}`);

function fixedSlotsFor(section, rules) {
  if (section.fixed_slots?.length) return section.fixed_slots;
  const rule = (rules?.rules || rules || []).find(item => item.course === section.course_id && (item.fixed_slot || item.fixed_slots));
  return rule ? (rule.fixed_slot ? [rule.fixed_slot] : rule.fixed_slots) : [];
}

function slotIndex(slotId) {
  const match = /^D(\d+)P(\d+)$/.exec(slotId);
  if (!match) throw new Error(`非法时段 ${slotId}`);
  return (Number(match[1]) - 1) * 10 + Number(match[2]) - 1;
}

function sum(model, values, expected) {
  if (!values.length) throw new Error('分班模型出现空变量集合');
  model.addEquality(values.slice(1).reduce((total, item) => total.add(item), values[0]), BigInt(expected));
}

function mayMeetAtSameTime(left, right) {
  return left.day === null || right.day === null || left.day === right.day;
}

function isExperimentalTeacher(state, teacherId) {
  const teacher = state.teachers.find(item => item.id === teacherId);
  return Boolean(teacherId?.startsWith('T_EXP_') || /实验教师/.test(teacher?.name || ''));
}

function crossGradeApTeachers(state, candidateSections) {
  const gradeByStudent = new Map(state.students.map(student => [student.id, student.grade]));
  const gradesByTeacher = new Map();
  for (const section of candidateSections) {
    if (!section.teacher_id) continue;
    const grades = gradesByTeacher.get(section.teacher_id) || new Set();
    for (const studentId of section.eligible_student_ids || []) grades.add(gradeByStudent.get(studentId));
    gradesByTeacher.set(section.teacher_id, grades);
  }
  return new Set([...gradesByTeacher].filter(([, grades]) => grades.has(11) && grades.has(12)).map(([teacherId]) => teacherId));
}

function addDifferent(model, left, right, onlyIf) {
  if (!mayMeetAtSameTime(left, right)) return;
  const constraint = model.addDifferent(left.time, right.time);
  if (onlyIf) constraint.onlyEnforceIf(onlyIf);
}

/**
 * Whole-school CP-SAT model with section-level time variables.  A student is
 * assigned to one of the already-required parallel sections of each course;
 * conditional non-overlap constraints make the generated individual timetable
 * conflict-free without turning every student-slot pair into a new variable.
 */
async function solveIntegerSections(state, options = {}) {
  const rules = options.rules || { rules: [] };
  const policies = normalizePolicies(state, rules);
  const sections = options.sections || buildSections(state);
  const model = new CpModel();
  const candidateSections = sections.filter(section => section.class_type === 'ap' || section.class_type === 'elective');
  const candidateSet = new Set(candidateSections);
  const coreSections = sections.filter(section => !candidateSet.has(section));
  const studentById = new Map(state.students.map(student => [student.id, student]));
  const grade12Students = state.students.filter(student => student.grade === 12);
  const courseById = new Map(state.courses.map(course => [course.id, course]));
  const useGrade12ApBands = options.grade12ApBands !== false && grade12Students.length > 0 && grade12Students.every(student => {
    const selected = [...(student.ap_courses || []), ...Object.values(student.elective_choices || {})];
    return selected.filter(courseId => courseById.get(courseId)?.weekly_hours === 5).length === 4;
  });
  const occurrences = [];
  const occurrencesBySection = new Map();
  const softDailyPenalties = [];

  for (const section of sections) {
    const fixed = fixedSlotsFor(section, rules);
    const hasGrade12 = (section.eligible_student_ids || section.student_ids || []).some(studentId => studentById.get(studentId)?.grade === 12);
    const softDailyFiveHour = options.softDailyFiveHourCourses && candidateSet.has(section) && hasGrade12 && section.weekly_hours === 5 && !fixed.length;
    const locked = options.lockedMeetings?.[section.id] || [];
    const own = [];
    for (let index = 0; index < section.weekly_hours; index++) {
      const fixedSlot = locked[index] || (index < fixed.length ? fixed[index] : null);
      const day = fixedSlot ? Math.floor(slotIndex(fixedSlot) / 10) + 1 : section.weekly_hours === 5 && !softDailyFiveHour ? index + 1 : null;
      const lower = fixedSlot ? slotIndex(fixedSlot) : day ? (day - 1) * 10 : section.course_id === 'SELF_STUDY' ? 5 : 0;
      const upper = fixedSlot ? lower : day ? (day - 1) * 10 + 9 : 49;
      const time = model.newIntVar(BigInt(lower), BigInt(upper), `TIME_${section.id}_${index}`);
      const occurrence = { section, index, day, time };
      own.push(occurrence); occurrences.push(occurrence);
    }
    occurrencesBySection.set(section.id, own);
    for (let left = 0; left < own.length; left++) for (let right = left + 1; right < own.length; right++) addDifferent(model, own[left], own[right]);
    // Occurrences of an unfixed section are indistinguishable.  Canonicalise
    // their order to avoid exploring the same timetable 2! or 4! times.  Do
    // not apply this to multiple explicit fixed slots: their input order may
    // itself carry business meaning.
    if (!fixed.length && section.weekly_hours !== 5) {
      for (let index = 0; index < own.length - 1; index++) model.addLessThan(own[index].time, own[index + 1].time);
    }
    // Confirmed school policy: G12's four daily five-hour AP/elective courses
    // occupy a common five-period AP band.  The fifth position is deliberate
    // slack for the overlapping AP-choice graph and for one core/short lesson
    // each day. A section may use a different period on different days.
    if (useGrade12ApBands && candidateSet.has(section) && hasGrade12 && section.weekly_hours === 5 && !fixed.length) {
      if (softDailyFiveHour) {
        const byDay = Array.from({ length: 5 }, () => []);
        for (const occurrence of own) {
          const period = model.newIntVar(0n, 9n, `AP_BAND_PERIOD_${section.id}_${occurrence.index}`);
          model.addModuloEquality(period, occurrence.time, 10n);
          model.addLessOrEqual(period, 4n);
          const occurrenceDays = [];
          for (let day = 0; day < 5; day++) {
            const onDay = model.newBoolVar(`AP_DAY_${section.id}_${occurrence.index}_${day + 1}`);
            model.addGreaterOrEqual(occurrence.time, BigInt(day * 10)).onlyEnforceIf(onDay);
            model.addLessOrEqual(occurrence.time, BigInt(day * 10 + 9)).onlyEnforceIf(onDay);
            byDay[day].push(onDay);
            occurrenceDays.push(onDay);
          }
          sum(model, occurrenceDays, 1);
        }
        for (let day = 0; day < 5; day++) {
          const onDay = byDay[day];
          model.addLessOrEqual(onDay.slice(1).reduce((total, item) => total.add(item), onDay[0]), 2n);
          const doubled = model.newBoolVar(`AP_DOUBLE_${section.id}_${day + 1}`);
          model.addLessOrEqual(onDay.slice(1).reduce((total, item) => total.add(item), onDay[0]), 1n).onlyEnforceIf(doubled.not());
          model.addGreaterOrEqual(onDay.slice(1).reduce((total, item) => total.add(item), onDay[0]), 2n).onlyEnforceIf(doubled);
          softDailyPenalties.push(doubled);
        }
      } else for (const occurrence of own) model.addLessOrEqual(occurrence.time, BigInt((occurrence.day - 1) * 10 + 4));
    }
  }

  // 教务指定的落位优先级。它是一个全局模型内的搜索次序，而非把前一层
  // 硬锁后再靠随机重启尝试后续课程：
  //   1) 实验教师；2) 同时覆盖高二、高三的 AP/选修教师；
  //   3) 单年级 AP/选修；4) 其他课程。
  const crossGradeTeachers = crossGradeApTeachers(state, candidateSections);
  const priorityGroups = [[], [], [], []];
  const sectionPriority = new Map();
  for (const occurrence of occurrences) {
    const section = occurrence.section;
    const explicitPriority = policies
      .filter(policy => policy.kind === 'teacher_priority' && matches(policy, section))
      .reduce((highest, policy) => Math.max(highest, policy.weight), 0);
    const rank = explicitPriority > 0
      ? 0
      : candidateSet.has(section) && crossGradeTeachers.has(section.teacher_id)
        ? 1
        : candidateSet.has(section)
          ? 2
          : 3;
    sectionPriority.set(section.id, rank);
    priorityGroups[rank].push(occurrence.time);
  }

  // Teacher and room are hard physical resources, including a teacher who
  // takes several sections of the same course.
  for (const field of ['teacher_id', 'room_id']) {
    if ((field === 'teacher_id' && options.ignoreTeacherConflicts) || (field === 'room_id' && options.ignoreRoomConflicts)) continue;
    const byResource = new Map();
    for (const section of sections) {
      const resource = section[field]; if (!resource) continue;
      const list = byResource.get(resource) || []; list.push(section); byResource.set(resource, list);
    }
    for (const list of byResource.values()) {
      const times = list.flatMap(section => occurrencesBySection.get(section.id).map(occurrence => occurrence.time));
      if (times.length > 1) model.addAllDifferent(times);
    }
  }

  // Static core-to-core student conflicts are deduplicated per section pair.
  const coreByStudent = new Map();
  for (const section of coreSections) for (const studentId of section.student_ids) {
    const list = coreByStudent.get(studentId) || []; list.push(section); coreByStudent.set(studentId, list);
  }
  if (!options.ignoreStudentConflicts) {
    const distinctCoreRosters = new Map();
    for (const list of coreByStudent.values()) {
      const unique = [...new Map(list.map(section => [section.id, section])).values()];
      const key = unique.map(section => section.id).sort().join('|');
      distinctCoreRosters.set(key, unique);
    }
    for (const roster of distinctCoreRosters.values()) {
      const times = roster.flatMap(section => occurrencesBySection.get(section.id).map(occurrence => occurrence.time));
      if (times.length > 1) model.addAllDifferent(times);
    }
  }

  const membership = new Map();
  const choicesByStudent = new Map();
  const sectionChoiceByStudentCourse = new Map();
  const priorityChoiceGroups = [[], [], [], []];
  for (const section of candidateSections) for (const studentId of section.eligible_student_ids || []) {
    const variable = model.newBoolVar(`MEMBER_${studentId}_${section.id}`);
    membership.set(`${studentId}@${section.id}`, variable);
    const lockedMembers = options.lockedMembership?.[section.id];
    if (lockedMembers) model.addEquality(variable, lockedMembers.has(studentId) ? 1n : 0n);
    const list = choicesByStudent.get(studentId) || []; list.push(section); choicesByStudent.set(studentId, list);
  }
  if (!options.ignoreStudentConflicts) for (const [studentId, choices] of choicesByStudent) {
    const byCourse = new Map();
    for (const section of choices) { const list = byCourse.get(section.course_id) || []; list.push(section); byCourse.set(section.course_id, list); }
    for (const [courseId, list] of byCourse) {
      const members = list.map(section => membership.get(`${studentId}@${section.id}`));
      sum(model, members, 1);
      // One compact integer represents the actual parallel section choice.
      // The exact-one membership constraint plus these channels makes the
      // relation bidirectional without a separate attendance product.
      const choice = model.newIntVar(0n, BigInt(list.length - 1), `SECTION_CHOICE_${studentId}_${courseId}`);
      sectionChoiceByStudentCourse.set(`${studentId}@${courseId}`, choice);
      priorityChoiceGroups[sectionPriority.get(list[0].id) || 3].push(choice);
      list.forEach((section, index) => model.addEquality(choice, BigInt(index)).onlyEnforceIf(membership.get(`${studentId}@${section.id}`)));
    }
  }
  const byCourse = new Map();
  for (const section of candidateSections) {
    const cohortKey = `${section.course_id}@${section.cohort_id || 'ALL'}`;
    const list = byCourse.get(cohortKey) || []; list.push(section); byCourse.set(cohortKey, list);
  }
  for (const list of byCourse.values()) {
    const eligible = [...new Set(list.flatMap(section => section.eligible_student_ids || []))];
    const min = Math.floor(eligible.length / list.length), max = Math.ceil(eligible.length / list.length);
    for (const section of list) {
      const variables = section.eligible_student_ids.map(studentId => membership.get(`${studentId}@${section.id}`));
      const expression = variables.slice(1).reduce((total, item) => total.add(item), variables[0]);
      model.addGreaterOrEqual(expression, BigInt(min));
      model.addLessOrEqual(expression, BigInt(Math.min(max, section.capacity || max)));
    }
  }

  // A student's actual time for a candidate course is a derived integer, not
  // another arbitrary choice.  Exactly one membership literal is true, so the
  // selected-time variable equals the corresponding occurrence of that
  // section.  One AllDifferent per student gives much stronger propagation
  // than expanding every candidate/core pair into conditional inequalities.
  // When the course load is 50 periods this also proves that the student's
  // timetable covers every weekly slot exactly once.
  for (const [studentId, choices] of choicesByStudent) {
    const byCourse = new Map();
    for (const section of choices) { const list = byCourse.get(section.course_id) || []; list.push(section); byCourse.set(section.course_id, list); }
    const studentTimes = (coreByStudent.get(studentId) || [])
      .flatMap(section => occurrencesBySection.get(section.id).map(occurrence => occurrence.time));
    for (const [courseId, parallel] of byCourse) {
      const weeklyHours = parallel[0].weekly_hours;
      if (!parallel.every(section => section.weekly_hours === weeklyHours)) {
        throw new Error(`学生 ${studentId} 的 ${courseId} 平行 section 周课时不一致`);
      }
      for (let occurrenceIndex = 0; occurrenceIndex < weeklyHours; occurrenceIndex++) {
        // Five-hour courses are explicitly one period on each weekday.  Make
        // that domain visible before membership is chosen, instead of waiting
        // for a reified equality to infer it during search.
        const lower = weeklyHours === 5 ? occurrenceIndex * 10 : 0;
        const upper = weeklyHours === 5 ? lower + 9 : 49;
        const selectedTime = model.newIntVar(BigInt(lower), BigInt(upper), `SELECTED_TIME_${studentId}_${courseId}_${occurrenceIndex}`);
        const sectionChoice = sectionChoiceByStudentCourse.get(`${studentId}@${courseId}`);
        model.addElement(sectionChoice, parallel.map(section => occurrencesBySection.get(section.id)[occurrenceIndex].time), selectedTime);
        studentTimes.push(selectedTime);
      }
    }
    if (studentTimes.length > 1) model.addAllDifferent(studentTimes);
  }

  // A solved elective layer is a valuable warm start for the whole-school
  // model. Hints are never constraints: CP-SAT may move any value required to
  // fit the core timetable.
  if (options.hint) {
    const hintedSlots = new Map();
    for (const meeting of options.hint.meetings || []) {
      const list = hintedSlots.get(meeting.section_id) || []; list.push(slotIndex(meeting.slot_id)); hintedSlots.set(meeting.section_id, list);
    }
    for (const [sectionId, list] of hintedSlots) {
      const own = occurrencesBySection.get(sectionId) || [];
      list.sort((left, right) => left - right).forEach((value, index) => {
        if (own[index]) model.addHint(own[index].time, BigInt(value));
      });
    }
    const hintedSections = new Map((options.hint.sections || []).map(section => [section.id, new Set(section.student_ids || [])]));
    for (const section of candidateSections) {
      const members = hintedSections.get(section.id); if (!members) continue;
      for (const studentId of section.eligible_student_ids || []) {
        model.addHint(membership.get(`${studentId}@${section.id}`), members.has(studentId) ? 1n : 0n);
      }
    }
  }

  if (options.optimizeSoftDailyDistribution && softDailyPenalties.length) {
    model.minimize(softDailyPenalties.slice(1).reduce((total, item) => total.add(item), softDailyPenalties[0]));
  }

  // Preserve the school's semantic priority all the way through section
  // membership: experimental teachers → cross-grade AP → single-grade AP →
  // remaining core.  All stages remain in the same CP model, so no stage is
  // permanently locked before the later hard constraints are considered.
  for (let rank = 0; rank < priorityGroups.length; rank++) {
    const times = priorityGroups[rank];
    if (times.length) model.addDecisionStrategy(times, VariableSelectionStrategy.CHOOSE_FIRST, DomainReductionStrategy.SELECT_MIN_VALUE);
    const choices = priorityChoiceGroups[rank];
    if (choices.length) model.addDecisionStrategy(choices, VariableSelectionStrategy.CHOOSE_FIRST, DomainReductionStrategy.SELECT_MIN_VALUE);
  }

  const solver = new CpSolver();
  solver.parameters.maxTimeInSeconds = options.maxTimeSeconds || 180;
  if (options.logSearch) {
    solver.parameters.logSearchProgress = true;
    solver.parameters.logToStdout = true;
  }
  // Large student permutations are stronger and smaller as native global
  // constraints than as tens of thousands of SAT literals.  Keep the option
  // explicit so the expanded encoding remains available for diagnostics.
  if (options.preserveAllDifferent) solver.parameters.expandAlldiffConstraints = false;
  // With prioritySearch, make the model's decision strategies authoritative.
  // OR-Tools enum value 1 is FIXED_SEARCH.  This is intentionally a single
  // deterministic branch order: experimental teachers → remaining constraints,
  // not a random multi-start attempt.
  if (options.prioritySearch) {
    solver.parameters.numSearchWorkers = 1;
    solver.parameters.searchBranching = 1;
    solver.parameters.randomizeSearch = false;
  } else {
    solver.parameters.numSearchWorkers = options.numSearchWorkers || 8;
    if (options.seed !== undefined) { solver.parameters.randomSeed = options.seed; solver.parameters.randomizeSearch = true; }
  }
  const status = await solver.solve(model);
  const ok = status === CpSolverStatus.FEASIBLE || status === CpSolverStatus.OPTIMAL;
  if (!ok) return { ok: false, status, sections, meetings: [], assignments: [] };
  const allocated = sections.map(section => ({ ...section, student_ids: candidateSet.has(section) ? [] : [...section.student_ids] }));
  const allocatedById = new Map(allocated.map(section => [section.id, section]));
  for (const section of candidateSections) for (const studentId of section.eligible_student_ids || []) {
    if (solver.booleanValue(membership.get(`${studentId}@${section.id}`))) allocatedById.get(section.id).student_ids.push(studentId);
  }
  const meetings = occurrences.map(occurrence => ({ section_id: occurrence.section.id, slot_id: SLOTS[Number(solver.value(occurrence.time))] }));
  const assignments = [];
  for (const meeting of meetings) {
    const section = allocatedById.get(meeting.section_id);
    for (const studentId of section.student_ids) assignments.push({
      task_id: makeTaskId(section.id, section.course_id, studentId, meeting.slot_id),
      slot_id: meeting.slot_id, room_id: section.room_id, course_id: section.course_id,
      class_id: section.id, class_type: section.class_type, teacher_id: section.teacher_id,
      student_id: studentId, section_id: section.id,
    });
  }
  return { ok: true, status, sections: allocated, meetings, assignments };
}

module.exports = { solveIntegerSections };
