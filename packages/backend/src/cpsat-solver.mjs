import { createRequire } from 'node:module';
import { constructInitialSchedule } from './initial-schedule.mjs';

const require = createRequire(import.meta.url);
const {
  CpModel, CpSolver, CpSolverStatus, LinearExpr,
  VariableSelectionStrategy, DomainReductionStrategy,
} = require('@ortools-node/cp-sat');

function sum(values) {
  if (!values.length) throw new Error('模型中出现空变量集合');
  // Keep the expression tree flat.  Chaining `.add()` creates a recursive
  // binary tree and overflows V8's stack once feasible-first scoring adds tens
  // of thousands of independent quality terms.
  return LinearExpr.sum(values);
}

function emptySuffixPatterns(problem, slotByDay, emptyCount, limit = 4096) {
  if (!Number.isInteger(emptyCount) || emptyCount < 0) return null;
  const days = [...slotByDay.keys()].sort((left, right) => left - right);
  const patterns = [];
  const visit = (dayIndex, remaining, slots) => {
    if (patterns.length > limit) return;
    if (dayIndex === days.length) {
      if (remaining === 0) patterns.push(slots);
      return;
    }
    const daySlots = [...(slotByDay.get(days[dayIndex]) || [])]
      .sort((left, right) => left.period - right.period);
    const maximum = Math.min(daySlots.length, remaining);
    for (let count = 0; count <= maximum; count += 1) {
      const suffix = count === 0 ? [] : daySlots.slice(-count)
        .map(slot => slotIndex(problem, slot.id));
      visit(dayIndex + 1, remaining - count, [...slots, ...suffix]);
      if (patterns.length > limit) return;
    }
  };
  visit(0, emptyCount, []);
  return patterns.length > limit ? null : patterns;
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
  const eligibleSectionsByStudentCourse = new Map();
  for (const section of sections) {
    if (candidateSet.has(section)) {
      for (const studentId of section.eligible_student_ids || []) {
        const courses = coursesByStudent.get(studentId) || new Set(); courses.add(section.course_id); coursesByStudent.set(studentId, courses);
        const key = `${studentId}\u0000${section.course_id}`;
        const eligibleSections = eligibleSectionsByStudentCourse.get(key) || [];
        eligibleSections.push(section.id);
        eligibleSectionsByStudentCourse.set(key, eligibleSections);
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
    // A Block decides which section a student may attend. Students with the
    // same course names but different eligible Block sections are not
    // exchangeable: grouping them would require one section to accept both.
    const eligibilitySignature = selected.map(courseId => [
      courseId,
      [...(eligibleSectionsByStudentCourse.get(`${studentId}\u0000${courseId}`) || [])].sort(),
    ]);
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
    const key = `${core.join(',')}|${selected.join(',')}|${JSON.stringify(eligibilitySignature)}|${Object.entries(fixedSections).sort().map(([courseId, sectionId]) => `${courseId}:${sectionId}`).join(',')}|${ruleSignature}`;
    const cohort = grouped.get(key) || {
      id: `COHORT_${grouped.size + 1}`, student_ids: [], core_section_ids: core,
      course_ids: selected, fixed_sections: fixedSections,
    };
    cohort.student_ids.push(studentId);
    grouped.set(key, cohort);
  }
  return [...grouped.values()].sort((left, right) => left.id.localeCompare(right.id));
}

function addEquals(model, variable, value, name) {
  const literal = model.newBoolVar(name);
  model.addEquality(variable, BigInt(value)).onlyEnforceIf(literal);
  model.addDifferent(variable, BigInt(value)).onlyEnforceIf(literal.not());
  return literal;
}

function addSameValue(model, left, right, name) {
  const literal = model.newBoolVar(name);
  model.addEquality(left, right).onlyEnforceIf(literal);
  model.addDifferent(left, right).onlyEnforceIf(literal.not());
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
    const ignoredCourseIds = new Set(rule.params?.ignore_course_ids || []);
    const represented = new Map();
    for (const studentId of rule.target_ids) {
      const representative = studentRepresentatives?.get(studentId) || studentId;
      // A cohort can stand for several students only when their complete
      // student-scoped rule signature is the same.  Process it once.
      if (!represented.has(representative)) represented.set(representative, studentId);
    }
    for (const [representative, originalStudentId] of represented) {
      for (const occurrence of coreByStudent.get(representative) || []) {
        if (!ignoredCourseIds.has(occurrence.section.course_id)) add(originalStudentId, occurrence.time);
      }
      for (const [key, times] of selectedByStudentCourse) if (key.startsWith(`${representative}@`)) {
        const courseId = key.slice(representative.length + 1);
        if (!ignoredCourseIds.has(courseId)) for (const time of times) add(originalStudentId, time);
      }
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
  const slotByDay = new Map();
  const periodsPerDay = Math.max(...problem.slots.map(slot => slot.period));
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
      const affectedGrades = [...new Set([...left, ...right].flatMap(section => section.grades || []))]
        .filter(grade => !allowedGrades.size || allowedGrades.has(grade));
      for (const grade of affectedGrades) {
        const leftOccurrences = left
          .filter(section => (section.grades || []).includes(grade))
          .flatMap(section => occurrencesBySection.get(section.id) || []);
        const rightOccurrences = right
          .filter(section => (section.grades || []).includes(grade))
          .flatMap(section => occurrencesBySection.get(section.id) || []);
        if (!leftOccurrences.length || !rightOccurrences.length) continue;
        // One Boolean colors each slot for this grade.  A left-side meeting
        // forces its actual slot to the left color; a right-side meeting forces
        // the opposite color.  This is exactly equivalent to every left/right
        // occurrence pair being different, but replaces thousands of pairwise
        // disequalities with a linear-size channeling model.
        for (const [slotValue] of problem.slots.entries()) {
          const rightSide = model.newBoolVar(`${rule.id}_GRADE_${grade}_SLOT_${slotValue}_RIGHT`);
          for (const occurrence of leftOccurrences) {
            if (occurrence.minimumSlot <= slotValue && slotValue <= occurrence.maximumSlot) {
              model.addDifferent(occurrence.time, BigInt(slotValue)).onlyEnforceIf(rightSide);
            }
          }
          for (const occurrence of rightOccurrences) {
            if (occurrence.minimumSlot <= slotValue && slotValue <= occurrence.maximumSlot) {
              model.addDifferent(occurrence.time, BigInt(slotValue)).onlyEnforceIf(rightSide.not());
            }
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
    // Hard course-once-per-day rules are compiled directly into each
    // section's occurrence-day variables when the model is created.  Rebuild-
    // ing the same rule over every channeled student/cohort schedule creates
    // thousands of redundant literals without strengthening propagation.
    if (rule.type === 'max_occurrences_per_day'
      && rule.scope === 'course'
      && hardWeight === null
      && rule.params.max === 1) continue;
    const valuesByTarget = valuesForRule(rule, occurrencesBySection, selectedByStudentCourse, coreByStudent, sections, studentRepresentatives);
    if (rule.type === 'no_internal_gaps') {
      // Many students share exactly the same section-time variables (for
      // example, classmates with the same administrative and teaching
      // curriculum).  The prefix constraint is identical for those students;
      // building it repeatedly creates tens of thousands of redundant
      // literals.  Canonicalize by variable identity while leaving the
      // student collision constraints themselves untouched.
      const variableIds = new Map();
      const uniqueTargets = new Map();
      for (const [targetId, rawValues] of valuesByTarget) {
        const values = [...new Set(rawValues)];
        const signature = values.map(value => {
          if (!variableIds.has(value)) variableIds.set(value, variableIds.size + 1);
          return variableIds.get(value);
        }).sort((left, right) => left - right).join(',');
        if (!uniqueTargets.has(signature)) uniqueTargets.set(signature, { targetId, values });
      }
      for (const { targetId, values } of uniqueTargets.values()) {
        const emptyCount = problem.slots.length - values.length;
        if (hardWeight !== null) {
          if (emptyCount <= 0) continue;
          if (emptyCount > problem.slots.length) {
            throw new Error(`规则 ${rule.id} 的 ${targetId} 课时数无效`);
          }
          // In feasible-first mode a prefix rule is a quality target rather
          // than a search blocker.  Complete the student's distinct lesson
          // variables with explicit empty-slot variables, then penalize every
          // empty-before-lesson inversion inside a day.  Zero inversions is
          // exactly the ordinary P1..Pk prefix rule; a positive value still
          // leaves a complete, collision-free timetable for manual review.
          const emptySlots = Array.from({ length: emptyCount }, (_, index) =>
            model.newIntVar(
              0n,
              BigInt(problem.slots.length - 1),
              `${rule.id}_${targetId}_SOFT_EMPTY_${index}`,
            ));
          model.addAllDifferent([...values, ...emptySlots]);
          for (let index = 0; index < emptySlots.length - 1; index += 1) {
            model.addLessThan(emptySlots[index], emptySlots[index + 1]);
          }
          const emptyAtSlot = problem.slots.map((slot, slotValue) => {
            const flags = emptySlots.map((empty, index) => addEquals(
              model,
              empty,
              slotValue,
              `${rule.id}_${targetId}_SOFT_EMPTY_${index}_AT_${slot.id}`,
            ));
            if (flags.length === 1) return flags[0];
            const empty = model.newBoolVar(`${rule.id}_${targetId}_SOFT_EMPTY_AT_${slot.id}`);
            for (const flag of flags) model.addImplication(flag, empty);
            model.addBoolOr([...flags, empty.not()]);
            return empty;
          });
          for (const daySlots of slotByDay.values()) {
            const ordered = [...daySlots].sort((left, right) => left.period - right.period);
            for (let earlier = 0; earlier < ordered.length - 1; earlier += 1) {
              const earlierEmpty = emptyAtSlot[slotIndex(problem, ordered[earlier].id)];
              for (let later = earlier + 1; later < ordered.length; later += 1) {
                const laterEmpty = emptyAtSlot[slotIndex(problem, ordered[later].id)];
                const inversion = model.newBoolVar(
                  `${rule.id}_${targetId}_GAP_${ordered[earlier].id}_${ordered[later].id}`,
                );
                model.addBoolOr([earlierEmpty.not(), laterEmpty, inversion]);
                penaltyTerms.push({ variable: inversion, weight: hardWeight });
              }
            }
          }
          continue;
        }
        const suffixPatterns = emptySuffixPatterns(problem, slotByDay, emptyCount);
        if (suffixPatterns?.length && emptyCount > 0) {
          // With N distinct lessons in S slots, exactly S-N slots are empty.
          // Adding one variable per empty slot and one AllDifferent over all S
          // variables turns them into a permutation of the week.  Restricting
          // the empty variables to suffix-only tuples is exactly the no-gap
          // rule, and is dramatically smaller for near-full timetables (48/50
          // lessons => two variables and only 15 possible suffix patterns).
          const emptySlots = Array.from({ length: emptyCount }, (_, index) =>
            model.newIntVar(
              0n,
              BigInt(problem.slots.length - 1),
              `${rule.id}_${targetId}_EMPTY_${index}`,
            ));
          model.addAllDifferent([...values, ...emptySlots]);
          model.addAllowedAssignments(emptySlots, suffixPatterns);
          continue;
        }
        if (emptyCount === 0) {
          // Student AllDifferent already makes a full-week workload occupy
          // every slot, so an internal gap is impossible.
          continue;
        }
        const dailyCounts = [];
        const minimumDailyCount = Math.max(
          0,
          values.length - (slotByDay.size - 1) * periodsPerDay,
        );
        const maximumDailyCount = Math.min(periodsPerDay, values.length);
        for (const day of slotByDay.keys()) {
          const onDay = values.map((value, index) => {
            const dayVariable = dayVariables.get(value);
            if (!dayVariable) throw new Error(`规则 ${rule.id} 缺少 ${targetId} 的日期变量`);
            return addEquals(model, dayVariable, day - 1, `${rule.id}_${targetId}_${index}_DAY_${day}`);
          });
          // Every lesson belongs to exactly one day and the student's lesson
          // times are AllDifferent.  Consequently a day contains at most the
          // number of periods in that day, while the other days can absorb at
          // most `(dayCount - 1) * periodsPerDay` lessons.  Giving CP-SAT these
          // proven bounds up front is especially important for near-full
          // schedules (for example 48 lessons in 50 slots => 8..10 per day).
          const dailyCount = model.newIntVar(
            BigInt(minimumDailyCount),
            BigInt(maximumDailyCount),
            `${rule.id}_${targetId}_DAY_${day}_COUNT`,
          );
          model.addEquality(dailyCount, sum(onDay));
          dailyCounts.push(dailyCount);
          // Periods are zero based inside the model.  If k lessons occur on a
          // day, every one must have period < k.  Student AllDifferent then
          // forces those k lessons to occupy exactly P1..Pk, leaving only a
          // trailing empty suffix.
          const dayStart = BigInt((day - 1) * periodsPerDay);
          values.forEach((value, index) => {
            model.addLessThan(value, dailyCount.add(dayStart)).onlyEnforceIf(onDay[index]);
          });
        }
        // This equality is implied by the day-channel literals, but stating it
        // explicitly propagates the very small total suffix capacity before
        // the solver has assigned individual lesson days.
        if (dailyCounts.length) {
          model.addEquality(sum(dailyCounts), BigInt(values.length));
        }
      }
      continue;
    }
    if (rule.type === 'preferred_consecutive_pairs') {
      for (const section of targetSections) {
        // Do not turn every repeated lesson into a double period.  A rule
        // requests one pair by default; exceptional courses can opt in to a
        // different count through params.target_pairs.
        const expectedPairs = rule.params.target_pairs ?? 1;
        if (!expectedPairs) continue;
        const occurrences = occurrencesBySection.get(section.id) || [];
        const occupiedBySlot = new Map();
        for (const rawDaySlots of slotByDay.values()) {
          const daySlots = [...rawDaySlots].sort((left, right) => left.period - right.period);
          for (const slot of daySlots) {
            const slotValue = slotIndex(problem, slot.id);
            const equals = occurrences
              .filter(occurrence => occurrence.minimumSlot <= slotValue && slotValue <= occurrence.maximumSlot)
              .map(occurrence => addEquals(
                model,
                occurrence.time,
                slotValue,
                `${rule.id}_${section.id}_AT_${slot.id}_${occurrence.index}`,
              ));
            if (!equals.length) continue;
            const occupied = model.newBoolVar(`${rule.id}_${section.id}_OCCUPIED_${slot.id}`);
            for (const equality of equals) model.addImplication(equality, occupied);
            model.addBoolOr([...equals, occupied.not()]);
            occupiedBySlot.set(slot.id, occupied);
          }
        }
        const pairs = [];
        const incidentPairs = new Map();
        for (const rawDaySlots of slotByDay.values()) {
          const daySlots = [...rawDaySlots].sort((left, right) => left.period - right.period);
          for (let index = 0; index < daySlots.length - 1; index += 1) {
            const left = daySlots[index];
            const right = daySlots[index + 1];
            if (right.period !== left.period + 1) continue;
            const leftOccupied = occupiedBySlot.get(left.id);
            const rightOccupied = occupiedBySlot.get(right.id);
            if (!leftOccupied || !rightOccupied) continue;
            const paired = model.newBoolVar(`${rule.id}_${section.id}_PAIR_${left.id}_${right.id}`);
            model.addImplication(paired, leftOccupied);
            model.addImplication(paired, rightOccupied);
            pairs.push(paired);
            for (const slotId of [left.id, right.id]) {
              const list = incidentPairs.get(slotId) || [];
              list.push(paired);
              incidentPairs.set(slotId, list);
            }
          }
        }
        for (const pairList of incidentPairs.values()) if (pairList.length > 1) {
          model.addLessOrEqual(sum(pairList), 1n);
        }
        if (!pairs.length) {
          if (hardWeight === null) throw new Error(`规则 ${rule.id} 的 section ${section.id} 没有可用的相邻时段`);
          const shortfall = model.newIntVar(BigInt(expectedPairs), BigInt(expectedPairs), `${rule.id}_${section.id}_SHORTFALL`);
          penaltyTerms.push({ variable: shortfall, weight: hardWeight });
          continue;
        }
        if (hardWeight === null) {
          model.addGreaterOrEqual(sum(pairs), BigInt(expectedPairs));
        } else {
          const shortfall = model.newIntVar(0n, BigInt(expectedPairs), `${rule.id}_${section.id}_SHORTFALL`);
          model.addGreaterOrEqual(sum(pairs).add(shortfall), BigInt(expectedPairs));
          penaltyTerms.push({ variable: shortfall, weight: hardWeight });
        }
      }
      continue;
    }
    if (rule.type === 'avoid_teacher_day_extremes') {
      for (const [teacherId, values] of valuesByTarget) for (const [day, daySlots] of slotByDay) {
        const firstSlot = daySlots.find(slot => slot.period === rule.params.first_period);
        const lastSlot = daySlots.find(slot => slot.period === rule.params.last_period);
        if (!firstSlot || !lastSlot || !values.length) continue;
        const firstFlags = values.map((value, index) => addEquals(
          model,
          value,
          slotIndex(problem, firstSlot.id),
          `${rule.id}_${teacherId}_${index}_${firstSlot.id}`,
        ));
        const lastFlags = values.map((value, index) => addEquals(
          model,
          value,
          slotIndex(problem, lastSlot.id),
          `${rule.id}_${teacherId}_${index}_${lastSlot.id}`,
        ));
        const hasFirst = model.newBoolVar(`${rule.id}_${teacherId}_DAY_${day}_HAS_FIRST`);
        const hasLast = model.newBoolVar(`${rule.id}_${teacherId}_DAY_${day}_HAS_LAST`);
        for (const flag of firstFlags) model.addImplication(flag, hasFirst);
        for (const flag of lastFlags) model.addImplication(flag, hasLast);
        model.addBoolOr([...firstFlags, hasFirst.not()]);
        model.addBoolOr([...lastFlags, hasLast.not()]);
        const both = model.newBoolVar(`${rule.id}_${teacherId}_DAY_${day}_HAS_BOTH`);
        model.addImplication(both, hasFirst);
        model.addImplication(both, hasLast);
        model.addBoolOr([hasFirst.not(), hasLast.not(), both]);
        penaltyTerms.push({ variable: both, weight: hardWeight });
      }
      continue;
    }
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
    if (rule.type === 'min_occurrence_days') {
      for (const [targetId, values] of valuesByTarget) {
        const usedDays = [];
        for (const [day, daySlots] of slotByDay) {
          const flags = values.map((value, index) => {
            const dayVariable = dayVariables.get(value);
            return dayVariable
              ? [addEquals(model, dayVariable, day - 1, `${rule.id}_${targetId}_${index}_DAY_${day}`)]
              : daySlots.map(slot => addEquals(model, value, slotIndex(problem, slot.id), `${rule.id}_${targetId}_${index}_${day}_${slot.period}`));
          }).flat();
          if (!flags.length) continue;
          const used = model.newBoolVar(`${rule.id}_${targetId}_USES_DAY_${day}`);
          for (const flag of flags) model.addImplication(flag, used);
          model.addBoolOr([...flags, used.not()]);
          usedDays.push(used);
        }
        if (hardWeight === null) {
          model.addGreaterOrEqual(sum(usedDays), BigInt(rule.params.min));
        } else {
          const shortfall = model.newIntVar(0n, BigInt(rule.params.min), `${rule.id}_${targetId}_DAY_SHORTFALL`);
          model.addGreaterOrEqual(sum(usedDays).add(shortfall), BigInt(rule.params.min));
          penaltyTerms.push({ variable: shortfall, weight: hardWeight });
        }
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
  for (const [, variables] of [...rankBuckets].sort(([left], [right]) => left - right)) {
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
  if (options.useConstructiveSeed !== false && !hasMembershipLocks) {
    const constructed = constructInitialSchedule(problem, {
      lockedMeetings: options.lockedMeetings || [],
    });
    if (constructed && (options.optimizeSoft !== true || constructed.soft_score === 0)) {
      return { ok: true, status: 'CONSTRUCTIVE_FEASIBLE', ...constructed };
    }
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
      let minimumSlot = 0;
      let maximumSlot = problem.slots.length - 1;
      if (dailyRule && section.weekly_hours === days.length) {
        const daySlots = problem.slots.filter(slot => slot.day === days[index]);
        minimumSlot = slotIndex(problem, daySlots[0].id);
        maximumSlot = slotIndex(problem, daySlots[daySlots.length - 1].id);
        model.addGreaterOrEqual(time, BigInt(minimumSlot));
        model.addLessOrEqual(time, BigInt(maximumSlot));
      }
      const day = model.newIntVar(0n, BigInt(days.length - 1), `DAY_${section.id}_${index}`);
      model.addDivisionEquality(day, time, BigInt(periodsPerDay));
      dayVariables.set(time, day);
      const occurrence = { section, index, time, day, minimumSlot, maximumSlot };
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
  const hintsBySection = new Map();
  for (const hint of options.hintMeetings || []) {
    if (!occurrencesBySection.has(hint.section_id)) continue;
    const value = problem.slots.findIndex(slot => slot.id === hint.slot_id);
    if (value < 0) continue;
    const values = hintsBySection.get(hint.section_id) || new Set();
    values.add(value);
    hintsBySection.set(hint.section_id, values);
  }
  for (const [sectionId, rawValues] of hintsBySection) {
    const own = occurrencesBySection.get(sectionId) || [];
    const values = [...rawValues].sort((left, right) => left - right);
    // Occurrence variables are ordered.  A complete prior section timetable
    // maps unambiguously onto them; partial hints are intentionally ignored
    // because guessing an occurrence index can mislead daily-domain presolve.
    if (values.length !== own.length) continue;
    own.forEach((occurrence, index) => model.addHint(occurrence.time, BigInt(values[index])));
  }
  const collisionLiterals = new Map();
  const slotEqualityLiterals = new Map();
  const assumptionByLiteralIndex = new Map();
  const occurrencesCanCollide = (left, right) =>
    left.minimumSlot <= right.maximumSlot && right.minimumSlot <= left.maximumSlot;
  const occurrenceForCut = (sectionId, occurrenceIndex) => {
    const occurrence = occurrencesBySection.get(sectionId)?.[occurrenceIndex];
    if (!occurrence) {
      throw new Error(`碰撞切割引用了不存在的 section 课时: ${sectionId}#${occurrenceIndex}`);
    }
    return occurrence;
  };
  const collisionLiteralFor = (left, right) => {
    if (!occurrencesCanCollide(left, right)) return model.falseLiteral();
    const ordered = [
      `${left.section.id}#${left.index}`,
      `${right.section.id}#${right.index}`,
    ].sort();
    const key = ordered.join('|');
    if (!collisionLiterals.has(key)) {
      collisionLiterals.set(key, addSameValue(
        model,
        left.time,
        right.time,
        `COLLISION_${collisionLiterals.size}`,
      ));
    }
    return collisionLiterals.get(key);
  };
  const slotEqualityLiteralFor = (occurrence, slotId) => {
    const value = slotIndex(problem, slotId);
    const key = `${occurrence.section.id}#${occurrence.index}@${slotId}`;
    if (!slotEqualityLiterals.has(key)) {
      slotEqualityLiterals.set(key, addEquals(
        model,
        occurrence.time,
        value,
        `TIMETABLE_VALUE_${slotEqualityLiterals.size}`,
      ));
    }
    return slotEqualityLiterals.get(key);
  };
  for (const [cutIndex, rawCut] of (options.timetableCuts || []).entries()) {
    if (!Array.isArray(rawCut) || rawCut.length === 0) {
      throw new Error(`第 ${cutIndex + 1} 条课表切割为空`);
    }
    model.addBoolOr(rawCut.map(item => slotEqualityLiteralFor(
      occurrenceForCut(item.section_id, item.occurrence_index),
      item.slot_id,
    ).not()));
  }
  for (const [assumptionIndex, item] of (options.assumptionMeetings || []).entries()) {
    const occurrence = occurrenceForCut(item.section_id, item.occurrence_index);
    const assumption = model.newBoolVar(`TIMETABLE_ASSUMPTION_${assumptionIndex}`);
    model.addEquality(occurrence.time, BigInt(slotIndex(problem, item.slot_id))).onlyEnforceIf(assumption);
    model.addAssumption(assumption);
    assumptionByLiteralIndex.set(assumption.literalIndex, {
      section_id: item.section_id,
      occurrence_index: item.occurrence_index,
      slot_id: item.slot_id,
    });
  }
  for (const [boundIndex, bound] of (options.slotUnionBounds || []).entries()) {
    if (!Number.isInteger(bound.max_distinct_slots) || bound.max_distinct_slots < 0) {
      throw new Error(`时段并集上限 ${bound.id || boundIndex + 1} 的 max_distinct_slots 无效`);
    }
    const targetOccurrences = [...new Set(bound.section_ids || [])].flatMap(sectionId => {
      const own = occurrencesBySection.get(sectionId);
      if (!own) throw new Error(`时段并集上限 ${bound.id || boundIndex + 1} 引用了不存在的 section: ${sectionId}`);
      return own;
    });
    const occupiedSlots = [];
    for (const [slotValue, slot] of problem.slots.entries()) {
      const equals = targetOccurrences
        .filter(occurrence => occurrence.minimumSlot <= slotValue && slotValue <= occurrence.maximumSlot)
        .map(occurrence => slotEqualityLiteralFor(occurrence, slot.id));
      if (!equals.length) continue;
      const occupied = model.newBoolVar(`SLOT_UNION_${boundIndex}_${slotValue}`);
      for (const equality of equals) model.addImplication(equality, occupied);
      model.addBoolOr([...equals, occupied.not()]);
      occupiedSlots.push(occupied);
    }
    if (occupiedSlots.length) {
      model.addLessOrEqual(sum(occupiedSlots), BigInt(bound.max_distinct_slots));
    }
  }
  for (const [cutIndex, rawCut] of (options.collisionCuts || []).entries()) {
    if (!Array.isArray(rawCut) || rawCut.length === 0) {
      throw new Error(`第 ${cutIndex + 1} 条碰撞切割为空`);
    }
    const literals = rawCut.map(pair => {
      const left = occurrenceForCut(pair.left_section_id, pair.left_occurrence_index);
      const right = occurrenceForCut(pair.right_section_id, pair.right_occurrence_index);
      return collisionLiteralFor(left, right).not();
    });
    // The student subproblem proved that the current collection of equal-time
    // collisions cannot admit a section choice.  At least one equality must
    // therefore be broken; unlike a heuristic pair ban, this removes only an
    // actually impossible master pattern.
    model.addBoolOr(literals);
  }
  for (const [groupIndex, group] of (options.availabilityGroups || []).entries()) {
    const coreOccurrences = (group.core_section_ids || []).flatMap(sectionId => {
      const own = occurrencesBySection.get(sectionId);
      if (!own) throw new Error(`可用性组 ${group.id || groupIndex + 1} 引用了不存在的基础 section: ${sectionId}`);
      return own;
    });
    const candidateIds = [...new Set(group.candidate_section_ids || [])];
    if (!candidateIds.length) throw new Error(`可用性组 ${group.id || groupIndex + 1} 没有候选 section`);
    const available = candidateIds.map((sectionId, candidateIndex) => {
      const candidateOccurrences = occurrencesBySection.get(sectionId);
      if (!candidateOccurrences) {
        throw new Error(`可用性组 ${group.id || groupIndex + 1} 引用了不存在的候选 section: ${sectionId}`);
      }
      const collisions = candidateOccurrences.flatMap(candidateOccurrence =>
        coreOccurrences
          .filter(coreOccurrence => occurrencesCanCollide(candidateOccurrence, coreOccurrence))
          .map(coreOccurrence => collisionLiteralFor(candidateOccurrence, coreOccurrence)));
      const literal = model.newBoolVar(`AVAILABLE_${groupIndex}_${candidateIndex}`);
      if (!collisions.length) model.addEquality(literal, 1n);
      else {
        for (const collision of collisions) model.addImplication(literal, collision.not());
        model.addBoolOr([...collisions, literal]);
      }
      return literal;
    });
    model.addBoolOr(available);
  }
  const hintedRosterBySection = new Map((options.hintSections || []).map(section => [
    section.id,
    new Set(section.student_ids || []),
  ]));
  let hintMembershipCount = 0;
  const assignmentMembership = new Map();
  const assignmentGroupSelectedTimes = new Map();
  const assignmentGroupCoreOccurrences = new Map();
  const assignmentGroupStudentRepresentatives = new Map();
  const assignmentChoiceVariables = [];
  const channelAssignmentGroupTimes = options.channelAssignmentGroupTimes === true;
  for (const [groupIndex, group] of (options.assignmentGroups || []).entries()) {
    const groupId = group.id || `GROUP_${groupIndex + 1}`;
    if (channelAssignmentGroupTimes && group.exact_student_cohort !== true) {
      throw new Error(`动态分班组 ${groupId} 不是完整选课组合，不能接入学生课表规则`);
    }
    const coreOccurrences = (group.core_section_ids || []).flatMap(sectionId => {
      const own = occurrencesBySection.get(sectionId);
      if (!own) throw new Error(`动态分班组 ${groupId} 引用了不存在的基础 section: ${sectionId}`);
      return own;
    });
    if (channelAssignmentGroupTimes) {
      assignmentGroupCoreOccurrences.set(groupId, coreOccurrences);
      for (const studentId of group.student_ids || []) {
        assignmentGroupStudentRepresentatives.set(studentId, groupId);
      }
    }
    if (!(group.courses || []).length) throw new Error(`动态分班组 ${groupId} 没有选课`);
    for (const course of group.courses) {
      const candidateIds = [...new Set(course.candidate_section_ids || [])];
      if (!candidateIds.length) throw new Error(`动态分班组 ${groupId} 的 ${course.course_id} 没有候选 section`);
      const variables = candidateIds.map(sectionId => {
        if (!occurrencesBySection.has(sectionId)) {
          throw new Error(`动态分班组 ${groupId} 引用了不存在的候选 section: ${sectionId}`);
        }
        const variable = model.newBoolVar(`ASSIGN_${groupIndex}_${course.course_id}_${sectionId}`);
        assignmentMembership.set(`${groupId}@${sectionId}`, variable);
        return variable;
      });
      model.addEquality(sum(variables), 1n);
      const fixedSectionId = group.fixed_sections?.[course.course_id];
      if (fixedSectionId) {
        const literal = assignmentMembership.get(`${groupId}@${fixedSectionId}`);
        if (!literal) throw new Error(`动态分班组 ${groupId} 的 ${course.course_id} 锁定 section 不可用`);
        if (options.assumeFixedAssignments === true) {
          const assumption = model.newBoolVar(
            `ASSIGNMENT_ASSUMPTION_${groupIndex}_${course.course_id}_${fixedSectionId}`,
          );
          model.addEquality(literal, 1n).onlyEnforceIf(assumption);
          model.addAssumption(assumption);
          assumptionByLiteralIndex.set(assumption.literalIndex, {
            kind: 'assignment',
            group_id: groupId,
            course_id: course.course_id,
            section_id: fixedSectionId,
          });
        } else {
          model.addEquality(literal, 1n);
        }
      }
      const hinted = candidateIds.filter(sectionId => {
        const roster = hintedRosterBySection.get(sectionId);
        const courseStudents = course.student_ids || group.student_ids || [];
        return roster && courseStudents.every(studentId => roster.has(studentId));
      });
      if (hinted.length === 1) for (const sectionId of candidateIds) {
        model.addHint(
          assignmentMembership.get(`${groupId}@${sectionId}`),
          sectionId === hinted[0],
        );
        hintMembershipCount += 1;
      }
      for (const sectionId of candidateIds) {
        const selected = assignmentMembership.get(`${groupId}@${sectionId}`);
        if (channelAssignmentGroupTimes) continue;
        for (const candidateOccurrence of occurrencesBySection.get(sectionId) || []) {
          for (const coreOccurrence of coreOccurrences) {
            if (!occurrencesCanCollide(candidateOccurrence, coreOccurrence)) continue;
            model.addDifferent(candidateOccurrence.time, coreOccurrence.time)
              .onlyEnforceIf(selected);
          }
        }
      }
      if (channelAssignmentGroupTimes) {
        const parallel = candidateIds.map(sectionId => sections.find(section => section.id === sectionId));
        const weeklyHours = parallel[0].weekly_hours;
        if (!parallel.every(section => section.weekly_hours === weeklyHours)) {
          throw new Error(`动态分班组 ${groupId} 的 ${course.course_id} 平行 section 周课时不一致`);
        }
        const choice = model.newIntVar(
          0n,
          BigInt(parallel.length - 1),
          `GROUP_SECTION_CHOICE_${groupIndex}_${course.course_id}`,
        );
        assignmentChoiceVariables.push(choice);
        parallel.forEach((section, index) => {
          model.addEquality(choice, BigInt(index))
            .onlyEnforceIf(assignmentMembership.get(`${groupId}@${section.id}`));
        });
        const selectedTimes = [];
        for (let occurrenceIndex = 0; occurrenceIndex < weeklyHours; occurrenceIndex += 1) {
          const time = model.newIntVar(
            0n,
            BigInt(problem.slots.length - 1),
            `GROUP_SELECTED_${groupIndex}_${course.course_id}_${occurrenceIndex}`,
          );
          model.addElement(
            choice,
            parallel.map(section => occurrencesBySection.get(section.id)[occurrenceIndex].time),
            time,
          );
          selectedTimes.push(time);
        }
        assignmentGroupSelectedTimes.set(`${groupId}@${course.course_id}`, selectedTimes);
      }
    }
    if (channelAssignmentGroupTimes) continue;
    for (let leftIndex = 0; leftIndex < group.courses.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < group.courses.length; rightIndex += 1) {
        const leftStudents = new Set(group.courses[leftIndex].student_ids || group.student_ids || []);
        const sharesStudent = (group.courses[rightIndex].student_ids || group.student_ids || [])
          .some(studentId => leftStudents.has(studentId));
        if (!sharesStudent) continue;
        for (const leftSectionId of group.courses[leftIndex].candidate_section_ids || []) {
          for (const rightSectionId of group.courses[rightIndex].candidate_section_ids || []) {
            const leftSelected = assignmentMembership.get(`${groupId}@${leftSectionId}`);
            const rightSelected = assignmentMembership.get(`${groupId}@${rightSectionId}`);
            for (const leftOccurrence of occurrencesBySection.get(leftSectionId) || []) {
              for (const rightOccurrence of occurrencesBySection.get(rightSectionId) || []) {
                if (!occurrencesCanCollide(leftOccurrence, rightOccurrence)) continue;
                model.addDifferent(leftOccurrence.time, rightOccurrence.time)
                  .onlyEnforceIf([leftSelected, rightSelected]);
              }
            }
          }
        }
      }
    }
  }

  // A fixed-roster subproblem can prove that a collection of parallel-section
  // choices can never admit a timetable satisfying every student rule.  Feed
  // that sufficient core back as a membership no-good: at least one selected
  // section in the core must change.  This keeps roster search separate from
  // the much larger section-time search without weakening correctness.
  for (const [cutIndex, cut] of (options.assignmentCuts || []).entries()) {
    if (!Array.isArray(cut) || cut.length === 0) {
      throw new Error(`第 ${cutIndex + 1} 条分班切割为空`);
    }
    const literals = cut.map(item => {
      const selected = assignmentMembership.get(`${item.group_id}@${item.section_id}`);
      if (!selected) {
        throw new Error(
          `分班切割引用了不存在的选择: ${item.group_id}@${item.section_id}`,
        );
      }
      return selected.not();
    });
    model.addBoolOr(literals);
  }

  // The dynamic master does not yet contain every administrative/teaching
  // section.  Still reserve enough slots in which each omitted core section
  // could later meet.  A slot is a valid witness only when it is clear of
  // unconditional blockers (same teacher or a grade-wide separation rule)
  // and of every dynamic section selected by any student in that core class.
  // This is a necessary condition, not a guessed placement of the core class.
  const availabilityAttendanceCache = new Map();
  for (const [requirementIndex, requirement] of (options.coreAvailabilityRequirements || []).entries()) {
    const requirementId = requirement.id || `CORE_${requirementIndex + 1}`;
    if (!Number.isInteger(requirement.required_slots) || requirement.required_slots < 0) {
      throw new Error(`核心课程可用时段 ${requirementId} 的 required_slots 无效`);
    }
    const targetStudents = new Set(requirement.student_ids || []);
    const targetGroupIds = new Set(requirement.assignment_group_ids || []);
    const unconditionalIds = new Set(requirement.unconditional_blocking_section_ids || []);
    const unconditionalOccurrences = [...unconditionalIds].flatMap(sectionId => {
      const own = occurrencesBySection.get(sectionId);
      if (!own) throw new Error(`核心课程可用时段 ${requirementId} 引用了不存在的阻塞 section: ${sectionId}`);
      return own;
    });
    const relevantGroups = (options.assignmentGroups || []).flatMap((group, groupIndex) => {
      const groupId = group.id || `GROUP_${groupIndex + 1}`;
      const explicitlySelected = targetGroupIds.has(groupId);
      const sharesStudent = (group.student_ids || []).some(studentId => targetStudents.has(studentId));
      if (!explicitlySelected && !sharesStudent) return [];
      return [{ group, groupIndex, groupId }];
    });
    const relevantGroupSignature = relevantGroups.map(item => item.groupId).sort().join(',');
    const selectedByCandidate = new Map();
    for (const { group, groupId } of relevantGroups) for (const course of group.courses || []) {
      for (const sectionId of course.candidate_section_ids || []) {
        if (unconditionalIds.has(sectionId)) continue;
        const selected = assignmentMembership.get(`${groupId}@${sectionId}`);
        if (!selected) {
          throw new Error(`核心课程可用时段 ${requirementId} 缺少动态分班变量: ${groupId}@${sectionId}`);
        }
        const own = selectedByCandidate.get(sectionId) || new Set();
        own.add(selected);
        selectedByCandidate.set(sectionId, own);
      }
    }
    const attendedCandidates = [...selectedByCandidate].map(([sectionId, selectedSet]) => {
      const selectedLiterals = [...selectedSet];
      const cacheKey = `${relevantGroupSignature}@${sectionId}`;
      let attended = availabilityAttendanceCache.get(cacheKey);
      if (!attended) {
        if (selectedLiterals.length === 1) attended = selectedLiterals[0];
        else {
          attended = model.newBoolVar(`CORE_ATTENDS_${availabilityAttendanceCache.size}`);
          for (const selected of selectedLiterals) model.addImplication(selected, attended);
          model.addBoolOr([...selectedLiterals, attended.not()]);
        }
        availabilityAttendanceCache.set(cacheKey, attended);
      }
      return { sectionId, attended };
    });
    const eligibleSlotIds = requirement.eligible_slot_ids
      ? new Set(requirement.eligible_slot_ids)
      : null;
    if (eligibleSlotIds) for (const slotId of eligibleSlotIds) slotIndex(problem, slotId);
    const availableSlots = problem.slots.flatMap((slot, slotValue) => {
      if (eligibleSlotIds && !eligibleSlotIds.has(slot.id)) return [];
      const available = model.newBoolVar(`CORE_AVAILABLE_${requirementIndex}_${slotValue}`);
      const blockers = [];
      for (const occurrence of unconditionalOccurrences) {
        if (occurrence.minimumSlot > slotValue || slotValue > occurrence.maximumSlot) continue;
        blockers.push(slotEqualityLiteralFor(occurrence, slot.id));
      }
      for (const { sectionId, attended } of attendedCandidates) {
        for (const occurrence of occurrencesBySection.get(sectionId) || []) {
          if (occurrence.minimumSlot > slotValue || slotValue > occurrence.maximumSlot) continue;
          const atSlot = slotEqualityLiteralFor(occurrence, slot.id);
          const blocked = model.newBoolVar(
            `CORE_BLOCKED_${requirementIndex}_${slotValue}_${blockers.length}`,
          );
          // blocked <=> the target group attends this section and one of its
          // occurrences is placed in this slot.
          model.addImplication(blocked, attended);
          model.addImplication(blocked, atSlot);
          model.addBoolOr([attended.not(), atSlot.not(), blocked]);
          blockers.push(blocked);
        }
      }
      // Make availability an exact value instead of a one-way witness.  The
      // former encoding allowed any free slot to arbitrarily remain false,
      // creating an enormous number of symmetric witness subsets.
      if (!blockers.length) model.addEquality(available, 1n);
      else {
        for (const blocked of blockers) model.addImplication(available, blocked.not());
        model.addBoolOr([...blockers, available]);
      }
      return [available];
    });
    if (requirement.required_slots > 0) {
      model.addGreaterOrEqual(sum(availableSlots), BigInt(requirement.required_slots));
    }
  }

  // Teacher is a hard physical resource.  A teacher may handle several
  // sections, but their individual meetings must serialize.
  const byTeacher = new Map();
  for (const occurrence of occurrences) if (occurrence.section.teacher_id) {
    const list = byTeacher.get(occurrence.section.teacher_id) || []; list.push(occurrence.time); byTeacher.set(occurrence.section.teacher_id, list);
  }
  for (const values of byTeacher.values()) if (values.length > 1) model.addAllDifferent(values);

  for (const [pairIndex, pair] of (options.courseConflictPairs || []).entries()) {
    const left = sections.filter(section => section.course_id === pair.left_course_id)
      .flatMap(section => occurrencesBySection.get(section.id) || []);
    const right = sections.filter(section => section.course_id === pair.right_course_id)
      .flatMap(section => occurrencesBySection.get(section.id) || []);
    if (!left.length || !right.length) {
      throw new Error(`共选课程冲突 ${pairIndex + 1} 引用了没有课时的课程`);
    }
    for (const leftOccurrence of left) for (const rightOccurrence of right) {
      if (!occurrencesCanCollide(leftOccurrence, rightOccurrence)) continue;
      model.addDifferent(leftOccurrence.time, rightOccurrence.time);
    }
  }

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
  for (const [groupId, own] of assignmentGroupCoreOccurrences) coreByStudent.set(groupId, own);
  for (const [key, times] of assignmentGroupSelectedTimes) selectedByStudentCourse.set(key, times);
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
      const hinted = parallel.filter(section => {
        const roster = hintedRosterBySection.get(section.id);
        return roster && cohort.student_ids.every(studentId => roster.has(studentId));
      });
      if (hinted.length === 1) for (const section of parallel) {
        model.addHint(membership.get(`${cohortId}@${section.id}`), section.id === hinted[0].id);
        hintMembershipCount += 1;
      }
    }
    // Channeled selected-time variables avoid a Cartesian product of
    // attendance booleans when section membership is being rebalanced.
    for (const [key, parallel] of choicesByStudentCourse) {
      const [cohortId, courseId] = key.split('@');
      const choice = model.newIntVar(0n, BigInt(parallel.length - 1), `SECTION_CHOICE_${cohortId}_${courseId}`);
      assignmentChoiceVariables.push(choice);
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
  for (const [studentId, groupId] of assignmentGroupStudentRepresentatives) {
    studentRepresentatives.set(studentId, groupId);
  }
  const allStudents = new Set([...coreByStudent.keys(), ...[...choicesByStudentCourse.keys()].map(key => key.split('@')[0])]);
  const collisionVariableIds = new Map();
  const collisionSignatures = new Set();
  for (const studentId of allStudents) {
    const values = [...(coreByStudent.get(studentId) || []).map(occurrence => occurrence.time)];
    for (const [key, selected] of selectedByStudentCourse) if (key.startsWith(`${studentId}@`)) values.push(...selected);
    const distinctValues = [...new Set(values)];
    const signature = distinctValues.map(value => {
      if (!collisionVariableIds.has(value)) collisionVariableIds.set(value, collisionVariableIds.size + 1);
      return collisionVariableIds.get(value);
    }).sort((left, right) => left - right).join(',');
    if (distinctValues.length > 1 && !collisionSignatures.has(signature)) {
      model.addAllDifferent(distinctValues);
      collisionSignatures.add(signature);
    }
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
  if (options.fixedSearch === true) {
    if (assignmentChoiceVariables.length) {
      model.addDecisionStrategy(
        assignmentChoiceVariables,
        VariableSelectionStrategy.CHOOSE_MIN_DOMAIN_SIZE,
        DomainReductionStrategy.SELECT_MIN_VALUE,
      );
    }
    model.addDecisionStrategy(
      occurrences.map(occurrence => occurrence.time),
      VariableSelectionStrategy.CHOOSE_MIN_DOMAIN_SIZE,
      DomainReductionStrategy.SELECT_MIN_VALUE,
    );
  }
  if (penaltyTerms.length) model.minimize(sum(penaltyTerms.map(({ variable, weight }) => variable.mul(BigInt(weight)))));

  const solveBudgetSeconds = options.maxTimeSeconds || 120;
  const deadline = performance.now() + solveBudgetSeconds * 1000;
  while (performance.now() < deadline) {
    const solver = new CpSolver();
    solver.parameters.maxTimeInSeconds = Math.max(0.01, (deadline - performance.now()) / 1000);
    const hasHints = (options.hintMeetings || []).length > 0 || hintMembershipCount > 0;
    const useRepairHintSearch = hasHints && options.repairHints !== false;
    solver.parameters.numSearchWorkers = useRepairHintSearch
      ? (options.numSearchWorkers || 1)
      : (options.numSearchWorkers || 8);
    if (useRepairHintSearch) {
      solver.parameters.searchBranching = 6; // HINT_SEARCH
      solver.parameters.repairHint = true;
      solver.parameters.hintConflictLimit = 100000;
    } else if (options.fixedSearch === true) {
      solver.parameters.searchBranching = 1; // FIXED_SEARCH
    }
    // A student's 50 weekly lessons form a permutation of 50 slots.  Keeping
    // that as a native AllDifferent is dramatically smaller than expanding each
    // student into 50×50 Boolean assignment literals during presolve.
    solver.parameters.expandAlldiffConstraints = false;
    if (Number.isInteger(options.randomSeed)) {
      solver.parameters.randomSeed = options.randomSeed;
      solver.parameters.randomizeSearch = true;
    }
    if (options.logSearch) { solver.parameters.logSearchProgress = true; solver.parameters.logToStdout = true; }
    const remainingMs = Math.max(10, deadline - performance.now());
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), remainingMs);
    let status;
    try {
      status = await solver.solve(model, { signal: controller.signal });
    } finally {
      clearTimeout(timeout);
    }
    const ok = status === CpSolverStatus.FEASIBLE || status === CpSolverStatus.OPTIMAL;
    if (!ok) {
      const statusName = CpSolverStatus[status] || String(status);
      const infeasibleAssumptions = status === CpSolverStatus.INFEASIBLE
        ? solver.sufficientAssumptionsForInfeasibility()
          .map(index => assumptionByLiteralIndex.get(index))
          .filter(Boolean)
        : [];
      return {
        ok: false,
        status: statusName,
        sections: [],
        meetings: [],
        assignments: [],
        infeasible_assumption_meetings: infeasibleAssumptions
          .filter(item => item.kind !== 'assignment'),
        infeasible_assumption_assignments: infeasibleAssumptions
          .filter(item => item.kind === 'assignment')
          .map(({ kind: _kind, ...item }) => item),
      };
    }
    const groupedAssignment = (options.assignmentGroups || []).length > 0;
    const allocated = sections.map(section => ({
      ...section,
      student_ids: ((!freezeMembership || groupedAssignment) && candidateSet.has(section))
        ? []
        : [...section.student_ids],
    }));
    const allocatedById = byId(allocated);
    if (!freezeMembership) for (const cohort of cohorts) for (const courseId of cohort.course_ids) {
      const parallel = choicesByStudentCourse.get(`${cohort.id}@${courseId}`) || [];
      const selected = parallel.find(section => solver.booleanValue(membership.get(`${cohort.id}@${section.id}`)));
      if (!selected) throw new Error(`cohort ${cohort.id} 的 ${courseId} 未得到 section 分配`);
      allocatedById.get(selected.id).student_ids.push(...cohort.student_ids);
    }
    if (groupedAssignment) for (const [groupIndex, group] of options.assignmentGroups.entries()) {
      const groupId = group.id || `GROUP_${groupIndex + 1}`;
      for (const course of group.courses || []) {
        const sectionId = (course.candidate_section_ids || []).find(candidateId =>
          solver.booleanValue(assignmentMembership.get(`${groupId}@${candidateId}`)));
        if (!sectionId) throw new Error(`动态分班组 ${groupId} 的 ${course.course_id} 未得到 section 分配`);
        allocatedById.get(sectionId).student_ids.push(...(course.student_ids || group.student_ids || []));
      }
    }
    const meetings = occurrences.map(occurrence => ({
      section_id: occurrence.section.id,
      slot_id: problem.slots[Number(solver.value(occurrence.time))].id,
      room_id: null,
    }));
    const assignments = meetings.flatMap(meeting => {
      const section = allocatedById.get(meeting.section_id);
      return section.student_ids.map(studentId => ({
        task_id: `${section.id}:${studentId}:${meeting.slot_id}`,
        section_id: section.id, student_id: studentId, slot_id: meeting.slot_id,
        room_id: null, teacher_id: section.teacher_id, course_id: section.course_id,
        class_id: section.class_id || section.id, class_type: section.class_type,
      }));
    });
    return {
      ok: true,
      status: CpSolverStatus[status] || String(status),
      sections: allocated,
      meetings,
      assignments,
      hint_meeting_count: (options.hintMeetings || []).length,
      hint_membership_count: hintMembershipCount,
      search_seed: Number.isInteger(options.randomSeed) ? options.randomSeed : null,
    };
  }
  return { ok: false, status: 'UNKNOWN', reason: '在求解时限内未找到满足课程、教师、学生和时段约束的课表', sections: [], meetings: [], assignments: [] };
}
