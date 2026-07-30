import { createRequire } from 'node:module';
import { constructInitialSchedule } from './initial-schedule.mjs';

const require = createRequire(import.meta.url);
const {
  CpModel, CpSolver, CpSolverStatus, VariableSelectionStrategy, DomainReductionStrategy,
} = require('@ortools-node/cp-sat');

function sum(values) {
  if (!values.length) throw new Error('模型中出现空变量集合');
  return values.slice(1).reduce((total, value) => total.add(value), values[0]);
}

function slotIndex(problem, slotId) {
  const index = problem.slots.findIndex(slot => slot.id === slotId);
  if (index < 0) throw new Error(`规则引用了不存在的时段: ${slotId}`);
  return index;
}

function byId(items) { return new Map(items.map(item => [item.id, item])); }

/**
 * Catches contradictions that follow directly from the weekly workload, before
 * CP-SAT builds a large model.  For example, a student with 50 distinct
 * lessons in a 50-slot week necessarily occupies every daily period, so a
 * hard "no more than three consecutive lessons" rule cannot be satisfied.
 */
function workloadInfeasibility(problem) {
  const periodsPerDay = Math.max(...problem.slots.map(slot => slot.period));
  const totalSlots = problem.slots.length;
  const studentHours = new Map();
  for (const section of problem.sections) for (const studentId of section.student_ids || []) {
    studentHours.set(studentId, (studentHours.get(studentId) || 0) + section.weekly_hours);
  }
  for (const rule of problem.rules || []) {
    if (!rule.hard || rule.type !== 'max_consecutive_lessons' || rule.scope !== 'student') continue;
    if (rule.params.max >= periodsPerDay) continue;
    const affected = (rule.target_ids || []).filter(studentId => (studentHours.get(studentId) || 0) >= totalSlots);
    if (affected.length) {
      return {
        status: 'INFEASIBLE_BY_WORKLOAD',
        reason: `规则 ${rule.id} 要求学生连续不超过 ${rule.params.max} 节，但 ${affected.length} 名目标学生每周 ${totalSlots} 节已占满全部 ${totalSlots} 个时段（每天连续 ${periodsPerDay} 节）；需先安排空课或减少必修总课时`,
        rule_id: rule.id,
        affected_students: affected,
      };
    }
  }
  return null;
}

function buildCohorts(sections, candidateSet, rules = []) {
  const coreSectionIds = new Map();
  const coursesByStudent = new Map();
  for (const section of sections) {
    if (candidateSet.has(section)) {
      for (const studentId of section.eligible_student_ids || []) {
        const courses = coursesByStudent.get(studentId) || new Set(); courses.add(section.course_id); coursesByStudent.set(studentId, courses);
      }
    } else for (const studentId of section.student_ids || []) {
      const core = coreSectionIds.get(studentId) || []; core.push(section.id); coreSectionIds.set(studentId, core);
    }
  }
  const grouped = new Map();
  const studentRuleSignature = new Map();
  for (const rule of rules) if (rule.scope === 'student') {
    for (const studentId of rule.target_ids || []) {
      const list = studentRuleSignature.get(studentId) || [];
      list.push(rule.id);
      studentRuleSignature.set(studentId, list);
    }
  }
  for (const [studentId, courses] of coursesByStudent) {
    const core = [...(coreSectionIds.get(studentId) || [])].sort();
    const selected = [...courses].sort();
    const fixedSections = Object.fromEntries(selected.flatMap(courseId => {
      const locked = sections.filter(section => candidateSet.has(section)
        && section.course_id === courseId
        && (section.locked_student_ids || []).includes(studentId));
      if (locked.length > 1) throw new Error(`学生 ${studentId} 的 ${courseId} 被锁定到多个 section`);
      return locked.length ? [[courseId, locked[0].id]] : [];
    }));
    // Lock choices are part of cohort identity.  That splits just the
    // affected students out of an otherwise exchangeable cohort.
    // A rule addressed to one named student changes their semantics, so they
    // cannot remain exchangeable with classmates who have the same choices.
    const ruleSignature = [...(studentRuleSignature.get(studentId) || [])].sort().join(',');
    const key = `${core.join(',')}|${selected.join(',')}|${Object.entries(fixedSections).sort().map(([courseId, sectionId]) => `${courseId}:${sectionId}`).join(',')}|${ruleSignature}`;
    const cohort = grouped.get(key) || {
      id: `COHORT_${grouped.size + 1}`, student_ids: [], core_section_ids: core,
      course_ids: selected, fixed_sections: fixedSections,
    };
    cohort.student_ids.push(studentId);
    grouped.set(key, cohort);
  }
  return [...grouped.values()].sort((left, right) => left.id.localeCompare(right.id));
}

function allocateRooms(problem, sections, meetings) {
  const roomById = byId(problem.rooms);
  const sectionById = byId(sections);
  const allocated = [];
  const meetingsBySlot = new Map();
  for (const meeting of meetings) {
    const atSlot = meetingsBySlot.get(meeting.slot_id) || [];
    atSlot.push(meeting);
    meetingsBySlot.set(meeting.slot_id, atSlot);
  }
  for (const atSlot of meetingsBySlot.values()) {
    const candidates = new Map(atSlot.map(meeting => {
      const section = sectionById.get(meeting.section_id);
      const rooms = section.room_candidates
        .filter(roomId => (roomById.get(roomId)?.capacity || 0) >= section.student_ids.length)
        .sort();
      return [meeting.section_id, rooms];
    }));
    if ([...candidates.values()].some(rooms => !rooms.length)) return { ok: false, slot_id: atSlot[0].slot_id, reason: '容量不足，找不到可用教室' };
    const roomOwner = new Map();
    const assign = (sectionId, visited = new Set()) => {
      for (const roomId of candidates.get(sectionId)) {
        if (visited.has(roomId)) continue;
        visited.add(roomId);
        const owner = roomOwner.get(roomId);
        if (!owner || assign(owner, visited)) { roomOwner.set(roomId, sectionId); return true; }
      }
      return false;
    };
    const ordered = [...candidates.keys()].sort((left, right) => candidates.get(left).length - candidates.get(right).length || left.localeCompare(right));
    for (const sectionId of ordered) if (!assign(sectionId)) return { ok: false, slot_id: atSlot[0].slot_id, reason: '同一时段可用教室不足' };
    const roomForSection = new Map([...roomOwner].map(([roomId, sectionId]) => [sectionId, roomId]));
    allocated.push(...atSlot.map(meeting => ({ ...meeting, room_id: roomForSection.get(meeting.section_id) })));
  }
  return { ok: true, meetings: allocated };
}

function addEquals(model, variable, value, name) {
  const literal = model.newBoolVar(name);
  model.addEquality(variable, BigInt(value)).onlyEnforceIf(literal);
  model.addDifferent(variable, BigInt(value)).onlyEnforceIf(literal.not());
  return literal;
}

function valuesForRule(rule, occurrencesBySection, selectedByStudentCourse, coreByStudent, sections, studentRepresentatives) {
  const values = new Map();
  const add = (key, variable) => { const list = values.get(key) || []; list.push(variable); values.set(key, list); };
  const targetSections = () => {
    if (Array.isArray(rule.section_target_ids)) return sections.filter(section => rule.section_target_ids.includes(section.id));
    switch (rule.scope) {
      case 'global': return sections;
      case 'section': return sections.filter(section => rule.target_ids.includes(section.id));
      case 'course': return sections.filter(section => rule.target_ids.includes(section.course_id));
      case 'class': return sections.filter(section => rule.target_ids.includes(section.class_id));
      case 'teacher': return sections.filter(section => rule.target_ids.includes(section.teacher_id));
      default: return [];
    }
  };
  if (rule.scope === 'student') {
    const represented = new Map();
    for (const studentId of rule.target_ids) {
      const representative = studentRepresentatives?.get(studentId) || studentId;
      // A cohort can stand for several students only when their complete
      // student-scoped rule signature is the same.  Process it once.
      if (!represented.has(representative)) represented.set(representative, studentId);
    }
    for (const [representative, originalStudentId] of represented) {
      for (const occurrence of coreByStudent.get(representative) || []) add(originalStudentId, occurrence.time);
      for (const [key, times] of selectedByStudentCourse) if (key.startsWith(`${representative}@`)) for (const time of times) add(originalStudentId, time);
    }
    return values;
  }
  if (rule.scope === 'course') {
    for (const [key, times] of selectedByStudentCourse) {
      const [studentId, courseId] = key.split('@');
      if (rule.target_ids.includes(courseId)) for (const time of times) add(`${studentId}@${courseId}`, time);
    }
    for (const [studentId, core] of coreByStudent) for (const occurrence of core) {
      if (rule.target_ids.includes(occurrence.section.course_id)) add(`${studentId}@${occurrence.section.course_id}`, occurrence.time);
    }
    return values;
  }
  for (const section of targetSections()) for (const occurrence of occurrencesBySection.get(section.id) || []) {
    const key = rule.scope === 'teacher' ? section.teacher_id : section.id;
    if (key) add(key, occurrence.time);
  }
  return values;
}

function applyBound(model, values, maximum, penaltyTerms, weight, name) {
  if (!values.length) return;
  if (weight === null) { model.addLessOrEqual(sum(values), BigInt(maximum)); return; }
  const excess = model.newIntVar(0n, BigInt(values.length), name);
  model.addLessOrEqual(sum(values), excess.add(BigInt(maximum)));
  penaltyTerms.push({ variable: excess, weight });
}

function applyRules(model, problem, sections, occurrencesBySection, selectedByStudentCourse, coreByStudent, studentRepresentatives, penaltyTerms, dayVariables, includeSoft) {
  const rankBuckets = new Map();
  const periods = Math.max(...problem.slots.map(slot => slot.period));
  const slotByDay = new Map();
  for (const slot of problem.slots) {
    const list = slotByDay.get(slot.day) || []; list.push(slot); slotByDay.set(slot.day, list);
  }
  for (const rule of problem.rules || []) {
    if (rule.unmatched) throw new Error(`规则 ${rule.id} 未匹配到目标`);
    if (!rule.hard && !includeSoft && rule.type !== 'priority') continue;
    const targetSections = (() => {
      if (Array.isArray(rule.section_target_ids)) return sections.filter(section => rule.section_target_ids.includes(section.id));
      switch (rule.scope) {
        case 'global': return sections;
        case 'section': return sections.filter(section => rule.target_ids.includes(section.id));
        case 'course': return sections.filter(section => rule.target_ids.includes(section.course_id));
        case 'class': return sections.filter(section => rule.target_ids.includes(section.class_id));
        case 'teacher': return sections.filter(section => rule.target_ids.includes(section.teacher_id));
        default: return [];
      }
    })();
    const hardWeight = rule.hard ? null : rule.weight;
    if (rule.type === 'priority') {
      const rank = rule.params.rank;
      const bucket = rankBuckets.get(rank) || [];
      for (const section of targetSections) for (const occurrence of occurrencesBySection.get(section.id) || []) bucket.push(occurrence.time);
      rankBuckets.set(rank, bucket);
      continue;
    }
    if (rule.type === 'synchronized_slots') {
      if (targetSections.length < 2) continue;
      const baseline = occurrencesBySection.get(targetSections[0].id) || [];
      for (const section of targetSections.slice(1)) {
        const occurrences = occurrencesBySection.get(section.id) || [];
        if (occurrences.length !== baseline.length) {
          throw new Error(`规则 ${rule.id} 的 section 周课时不一致，无法同步时段`);
        }
        occurrences.forEach((occurrence, index) =>
          model.addEquality(occurrence.time, baseline[index].time));
      }
      continue;
    }
    if (rule.type === 'separate_class_types') {
      const allowedGrades = new Set(rule.params.grades || []);
      const left = sections.filter(section => rule.params.left_class_types.includes(section.class_type));
      const right = sections.filter(section => rule.params.right_class_types.includes(section.class_type));
      const shareAffectedGrade = (leftSection, rightSection) => (leftSection.grades || []).some(grade =>
        (rightSection.grades || []).includes(grade) && (!allowedGrades.size || allowedGrades.has(grade)));
      for (const leftSection of left) for (const rightSection of right) {
        if (!shareAffectedGrade(leftSection, rightSection)) continue;
        for (const leftOccurrence of occurrencesBySection.get(leftSection.id) || []) {
          for (const rightOccurrence of occurrencesBySection.get(rightSection.id) || []) {
            model.addAllDifferent([leftOccurrence.time, rightOccurrence.time]);
          }
        }
      }
      continue;
    }
    if (rule.type === 'fixed_slots') {
      const values = rule.params.slots.map(slot => slotIndex(problem, slot));
      for (const section of targetSections) {
        const occurrences = occurrencesBySection.get(section.id) || [];
        if (values.length > occurrences.length) throw new Error(`规则 ${rule.id} 固定时段数量超过 section ${section.id} 的周课时`);
        if (rule.params.mode === 'exact' && values.length !== occurrences.length) throw new Error(`规则 ${rule.id} 要求 exact，但固定时段数量与 section ${section.id} 周课时不一致`);
        values.forEach((value, index) => model.addEquality(occurrences[index].time, BigInt(value)));
      }
      continue;
    }
    if (rule.type === 'forbid_slots' || rule.type === 'preferred_slots') {
      const slotValues = rule.params.slots.map(slot => slotIndex(problem, slot));
      for (const section of targetSections) for (const occurrence of occurrencesBySection.get(section.id) || []) {
        const equals = slotValues.map(value => addEquals(model, occurrence.time, value, `${rule.id}_${occurrence.section.id}_${occurrence.index}_${value}`));
        if (rule.type === 'forbid_slots') {
          if (hardWeight === null) equals.forEach(literal => model.addEquality(literal, 0n));
          else equals.forEach(literal => penaltyTerms.push({ variable: literal, weight: hardWeight }));
        } else {
          const outside = model.newBoolVar(`${rule.id}_OUTSIDE_${occurrence.section.id}_${occurrence.index}`);
          model.addBoolOr([...equals, outside]);
          if (hardWeight === null) model.addEquality(outside, 0n);
          else penaltyTerms.push({ variable: outside, weight: hardWeight });
        }
      }
      continue;
    }
    const valuesByTarget = valuesForRule(rule, occurrencesBySection, selectedByStudentCourse, coreByStudent, sections, studentRepresentatives);
    if (rule.type === 'max_occurrences_per_day') {
      for (const [targetId, values] of valuesByTarget) for (const [day, daySlots] of slotByDay) {
        const flags = values.map((value, index) => {
          const dayVariable = dayVariables.get(value);
          return dayVariable
            ? addEquals(model, dayVariable, day - 1, `${rule.id}_${targetId}_${index}_DAY_${day}`)
            : daySlots.map(slot => addEquals(model, value, slotIndex(problem, slot.id), `${rule.id}_${targetId}_${index}_${day}_${slot.period}`));
        }).flat();
        applyBound(model, flags, rule.params.max, penaltyTerms, hardWeight, `${rule.id}_EXCESS_${targetId}_${day}`);
      }
      continue;
    }
    if (rule.type === 'max_consecutive_lessons') {
      for (const [targetId, values] of valuesByTarget) for (const [day, daySlots] of slotByDay) {
        const ordered = [...daySlots].sort((left, right) => left.period - right.period);
        for (let start = 0; start + rule.params.max < ordered.length; start++) {
          const window = ordered.slice(start, start + rule.params.max + 1);
          const flags = values.flatMap((value, index) => window.map(slot => addEquals(model, value, slotIndex(problem, slot.id), `${rule.id}_${targetId}_${index}_${slot.id}`)));
          applyBound(model, flags, rule.params.max, penaltyTerms, hardWeight, `${rule.id}_EXCESS_${targetId}_${day}_${start}`);
        }
      }
      continue;
    }
    if (rule.type === 'max_consecutive_days_in_period') {
      const days = [...slotByDay.keys()].sort((left, right) => left - right);
      for (const [targetId, values] of valuesByTarget) for (let start = 0; start + rule.params.max < days.length; start++) {
        const flags = values.flatMap((value, index) => days.slice(start, start + rule.params.max + 1).flatMap(day => {
          const slot = (slotByDay.get(day) || []).find(item => item.period === rule.params.period);
          return slot ? [addEquals(model, value, slotIndex(problem, slot.id), `${rule.id}_${targetId}_${index}_${slot.id}`)] : [];
        }));
        applyBound(model, flags, rule.params.max, penaltyTerms, hardWeight, `${rule.id}_EXCESS_${targetId}_${start}`);
      }
    }
  }
  for (const [rank, variables] of [...rankBuckets].sort(([left], [right]) => left - right)) {
    if (variables.length) model.addDecisionStrategy(variables, VariableSelectionStrategy.CHOOSE_FIRST, DomainReductionStrategy.SELECT_MIN_VALUE);
  }
}

/**
 * Rules-first CP-SAT solver.  It contains no school-, course-, teacher-, or
 * grade-specific branch: all policy enters through compiled rule objects.
 */
export async function solveSchedule(problem, options = {}) {
  const preflight = workloadInfeasibility(problem);
  if (preflight) return { ok: false, sections: [], meetings: [], assignments: [], ...preflight };
  const hasMembershipLocks = (problem.sections || []).some(section => (section.locked_student_ids || []).length);
  if (options.useConstructiveSeed !== false && !(options.lockedMeetings || []).length && !hasMembershipLocks) {
    const constructed = constructInitialSchedule(problem);
    if (constructed) return { ok: true, status: 'CONSTRUCTIVE_FEASIBLE', ...constructed };
  }
  const model = new CpModel();
  const sections = problem.sections;
  const days = [...new Set(problem.slots.map(slot => slot.day))].sort((left, right) => left - right);
  const periodsPerDay = Math.max(...problem.slots.map(slot => slot.period));
  const dailyCourseRules = new Map((problem.rules || [])
    .filter(rule => rule.hard && rule.type === 'max_occurrences_per_day' && rule.scope === 'course' && rule.params.max === 1)
    .flatMap(rule => rule.target_ids.map(courseId => [courseId, rule])));
  const occurrences = [];
  const occurrencesBySection = new Map();
  const dayVariables = new Map();
  for (const section of sections) {
    const own = [];
    for (let index = 0; index < section.weekly_hours; index++) {
      const time = model.newIntVar(0n, BigInt(problem.slots.length - 1), `TIME_${section.id}_${index}`);
      const dailyRule = dailyCourseRules.get(section.course_id);
      if (dailyRule && section.weekly_hours === days.length) {
        const daySlots = problem.slots.filter(slot => slot.day === days[index]);
        model.addGreaterOrEqual(time, BigInt(slotIndex(problem, daySlots[0].id)));
        model.addLessOrEqual(time, BigInt(slotIndex(problem, daySlots[daySlots.length - 1].id)));
      }
      const day = model.newIntVar(0n, BigInt(days.length - 1), `DAY_${section.id}_${index}`);
      model.addDivisionEquality(day, time, BigInt(periodsPerDay));
      dayVariables.set(time, day);
      const occurrence = { section, index, time, day };
      own.push(occurrence); occurrences.push(occurrence);
    }
    for (let index = 0; index < own.length - 1; index++) model.addLessThan(own[index].time, own[index + 1].time);
    if (dailyCourseRules.has(section.course_id) && own.length > 1) model.addAllDifferent(own.map(occurrence => occurrence.day));
    occurrencesBySection.set(section.id, own);
  }
  for (const lock of options.lockedMeetings || []) {
    const own = occurrencesBySection.get(lock.section_id);
    if (!own) throw new Error(`锁定引用了不存在的 section: ${lock.section_id}`);
    const value = slotIndex(problem, lock.slot_id);
    model.addBoolOr(own.map(occurrence => addEquals(model, occurrence.time, value, `LOCK_${lock.section_id}_${lock.slot_id}_${occurrence.index}`)));
  }

  // Teacher is a hard physical resource.  A teacher may handle several
  // sections, but their individual meetings must serialize.
  const byTeacher = new Map();
  for (const occurrence of occurrences) if (occurrence.section.teacher_id) {
    const list = byTeacher.get(occurrence.section.teacher_id) || []; list.push(occurrence.time); byTeacher.set(occurrence.section.teacher_id, list);
  }
  for (const values of byTeacher.values()) if (values.length > 1) model.addAllDifferent(values);

  const candidateSections = sections.filter(section => ['ap', 'elective'].includes(section.class_type));
  const candidateSet = new Set(candidateSections);
  // The section builder already creates a deterministic, balanced cohort for
  // every selected course.  Scheduling those real cohorts first is both a
  // valid timetable mode and a much stronger model than making thousands of
  // optional memberships before a first feasible timetable exists.  A future
  // section-rebalancing action can explicitly set freezeMembership=false.
  const freezeMembership = options.freezeMembership === true;
  const coreByStudent = new Map();
  for (const section of sections) if (freezeMembership || !candidateSet.has(section)) for (const studentId of section.student_ids || []) {
    const list = coreByStudent.get(studentId) || []; list.push(...occurrencesBySection.get(section.id)); coreByStudent.set(studentId, list);
  }
  const membership = new Map();
  const choicesByStudentCourse = new Map();
  const selectedByStudentCourse = new Map();
  let cohorts = [];
  if (!freezeMembership) {
    // Students with identical core sections and identical selected courses are
    // exchangeable for every hard constraint.  Assigning these cohorts as
    // whole units removes a large permutation symmetry while still producing
    // an individual timetable for every member after expansion.
    cohorts = buildCohorts(sections, candidateSet, problem.rules || []);
    const candidateByCourse = new Map();
    for (const section of candidateSections) {
      const list = candidateByCourse.get(section.course_id) || []; list.push(section); candidateByCourse.set(section.course_id, list);
    }
    for (const cohort of cohorts) {
      coreByStudent.set(cohort.id, cohort.core_section_ids.flatMap(sectionId => occurrencesBySection.get(sectionId) || []));
      for (const courseId of cohort.course_ids) {
        const parallel = (candidateByCourse.get(courseId) || [])
          .filter(section => cohort.student_ids.every(studentId => (section.eligible_student_ids || []).includes(studentId)));
        if (!parallel.length) throw new Error(`cohort ${cohort.id} 的 ${courseId} 没有可选 section`);
        const key = `${cohort.id}@${courseId}`;
        choicesByStudentCourse.set(key, parallel);
        for (const section of parallel) membership.set(`${cohort.id}@${section.id}`, model.newBoolVar(`MEMBER_${cohort.id}_${section.id}`));
      }
    }
    for (const [key, parallel] of choicesByStudentCourse) {
      const cohortId = key.split('@')[0];
      const variables = parallel.map(section => membership.get(`${cohortId}@${section.id}`));
      model.addEquality(sum(variables), 1n);
      const cohort = cohorts.find(item => item.id === cohortId);
      const courseId = key.slice(key.indexOf('@') + 1);
      const fixedSectionId = cohort?.fixed_sections?.[courseId];
      if (fixedSectionId) {
        const literal = membership.get(`${cohortId}@${fixedSectionId}`);
        if (!literal) throw new Error(`cohort ${cohortId} 的 ${courseId} 锁定 section 不可用`);
        model.addEquality(literal, 1n);
      }
    }
    for (const section of candidateSections) {
      const members = cohorts
        .filter(cohort => membership.has(`${cohort.id}@${section.id}`))
        .map(cohort => membership.get(`${cohort.id}@${section.id}`).mul(BigInt(cohort.student_ids.length)));
      model.addLessOrEqual(sum(members), BigInt(section.capacity));
    }
    // Channeled selected-time variables avoid a Cartesian product of
    // attendance booleans when section membership is being rebalanced.
    for (const [key, parallel] of choicesByStudentCourse) {
      const [cohortId, courseId] = key.split('@');
      const choice = model.newIntVar(0n, BigInt(parallel.length - 1), `SECTION_CHOICE_${cohortId}_${courseId}`);
      parallel.forEach((section, index) => model.addEquality(choice, BigInt(index)).onlyEnforceIf(membership.get(`${cohortId}@${section.id}`)));
      const weeklyHours = parallel[0].weekly_hours;
      if (!parallel.every(section => section.weekly_hours === weeklyHours)) throw new Error(`cohort ${cohortId} 的 ${courseId} 平行 section 周课时不一致`);
      const selected = [];
      for (let occurrenceIndex = 0; occurrenceIndex < weeklyHours; occurrenceIndex++) {
        const time = model.newIntVar(0n, BigInt(problem.slots.length - 1), `SELECTED_${cohortId}_${courseId}_${occurrenceIndex}`);
        model.addElement(choice, parallel.map(section => occurrencesBySection.get(section.id)[occurrenceIndex].time), time);
        selected.push(time);
      }
      selectedByStudentCourse.set(key, selected);
    }
  }
  const studentRepresentatives = new Map();
  for (const cohort of cohorts) for (const studentId of cohort.student_ids) studentRepresentatives.set(studentId, cohort.id);
  const allStudents = new Set([...coreByStudent.keys(), ...[...choicesByStudentCourse.keys()].map(key => key.split('@')[0])]);
  for (const studentId of allStudents) {
    const values = [...(coreByStudent.get(studentId) || []).map(occurrence => occurrence.time)];
    for (const [key, selected] of selectedByStudentCourse) if (key.startsWith(`${studentId}@`)) values.push(...selected);
    if (values.length > 1) model.addAllDifferent(values);
  }

  const penaltyTerms = [];
  // Channeled student times inherit a day variable as well, which keeps
  // daily rules compact (five values rather than fifty slot comparisons).
  for (const selected of selectedByStudentCourse.values()) for (const time of selected) {
    const day = model.newIntVar(0n, BigInt(days.length - 1), `DAY_SELECTED_${dayVariables.size}`);
    model.addDivisionEquality(day, time, BigInt(periodsPerDay));
    dayVariables.set(time, day);
  }
  applyRules(model, problem, sections, occurrencesBySection, selectedByStudentCourse, coreByStudent, studentRepresentatives, penaltyTerms, dayVariables, options.optimizeSoft === true);
  if (penaltyTerms.length) model.minimize(sum(penaltyTerms.map(({ variable, weight }) => variable.mul(BigInt(weight)))));

  const solver = new CpSolver();
  solver.parameters.maxTimeInSeconds = options.maxTimeSeconds || 120;
  solver.parameters.numSearchWorkers = options.numSearchWorkers || 8;
  // A student's 50 weekly lessons form a permutation of 50 slots.  Keeping
  // that as a native AllDifferent is dramatically smaller than expanding each
  // student into 50×50 Boolean assignment literals during presolve.
  solver.parameters.expandAlldiffConstraints = false;
  if (options.logSearch) { solver.parameters.logSearchProgress = true; solver.parameters.logToStdout = true; }
  const status = await solver.solve(model);
  const ok = status === CpSolverStatus.FEASIBLE || status === CpSolverStatus.OPTIMAL;
  if (!ok) return { ok: false, status: CpSolverStatus[status] || String(status), sections: [], meetings: [], assignments: [] };
  const allocated = sections.map(section => ({ ...section, student_ids: !freezeMembership && candidateSet.has(section) ? [] : [...section.student_ids] }));
  const allocatedById = byId(allocated);
  if (!freezeMembership) for (const cohort of cohorts) for (const courseId of cohort.course_ids) {
    const parallel = choicesByStudentCourse.get(`${cohort.id}@${courseId}`) || [];
    const selected = parallel.find(section => solver.booleanValue(membership.get(`${cohort.id}@${section.id}`)));
    if (!selected) throw new Error(`cohort ${cohort.id} 的 ${courseId} 未得到 section 分配`);
    allocatedById.get(selected.id).student_ids.push(...cohort.student_ids);
  }
  const timeOnlyMeetings = occurrences.map(occurrence => ({
    section_id: occurrence.section.id,
    slot_id: problem.slots[Number(solver.value(occurrence.time))].id,
  }));
  // Room assignment is a separate exact bipartite matching at each time slot,
  // after section membership is known.  It avoids encoding every pair of
  // meetings × every room as SAT literals, while still proving that every
  // placed meeting has a distinct compatible room.
  const roomAllocation = allocateRooms(problem, allocated, timeOnlyMeetings);
  if (!roomAllocation.ok) return { ok: false, status: 'ROOM_ALLOCATION_FAILED', reason: roomAllocation.reason, slot_id: roomAllocation.slot_id, sections: allocated, meetings: [], assignments: [] };
  const meetings = roomAllocation.meetings;
  const assignments = meetings.flatMap(meeting => {
    const section = allocatedById.get(meeting.section_id);
    return section.student_ids.map(studentId => ({
      task_id: `${section.id}:${studentId}:${meeting.slot_id}`,
      section_id: section.id, student_id: studentId, slot_id: meeting.slot_id,
      room_id: meeting.room_id, teacher_id: section.teacher_id, course_id: section.course_id,
      class_id: section.class_id || section.id, class_type: section.class_type,
    }));
  });
  return { ok: true, status: CpSolverStatus[status] || String(status), sections: allocated, meetings, assignments };
}
