function indexById(items = []) {
  return new Map(items.map(item => [item.id, item]));
}

function slotParts(slotId) {
  const match = /^D(\d+)P(\d+)$/.exec(slotId || '');
  return match ? { day: Number(match[1]), period: Number(match[2]) } : null;
}

function violation(ruleId, message, details = {}) {
  return { rule_id: ruleId, message, ...details };
}

function selectedSectionMap(problem, solution) {
  const overrides = indexById(solution.sections || []);
  return new Map(problem.sections.map(section => {
    const override = overrides.get(section.id);
    return [section.id, {
      ...section,
      // A solved schedule may carry a different final roster (and an
      // administrator may subsequently assign another qualified teacher).
      // Resolve those presentation-layer values here, so the independent
      // validator checks the schedule that will actually be saved rather
      // than silently reverting to the input model.
      ...(override || {}),
      id: section.id,
      student_ids: override?.student_ids ? [...override.student_ids] : [...(section.student_ids || [])],
      eligible_student_ids: override?.eligible_student_ids
        ? [...override.eligible_student_ids]
        : [...(section.eligible_student_ids || [])],
      room_candidates: override?.room_candidates
        ? [...override.room_candidates]
        : [...(section.room_candidates || [])],
    }];
  }));
}

function allStudentEvents(sections, meetingsBySection) {
  const events = new Map();
  for (const section of sections.values()) for (const studentId of section.student_ids || []) {
    for (const meeting of meetingsBySection.get(section.id) || []) {
      const list = events.get(studentId) || [];
      list.push({ ...meeting, section });
      events.set(studentId, list);
    }
  }
  return events;
}

function sectionIdsForRule(rule, sections) {
  if (Array.isArray(rule.section_target_ids)) return rule.section_target_ids;
  switch (rule.scope) {
    case 'global': return [...sections.keys()];
    case 'section': return rule.target_ids;
    case 'course': return [...sections.values()].filter(section => rule.target_ids.includes(section.course_id)).map(section => section.id);
    case 'class': return [...sections.values()].filter(section => rule.target_ids.includes(section.class_id)).map(section => section.id);
    case 'teacher': return [...sections.values()].filter(section => rule.target_ids.includes(section.teacher_id)).map(section => section.id);
    default: return [];
  }
}

function groupedEvents(rule, sections, meetings, studentEvents) {
  const groups = new Map();
  const add = (key, event) => { const list = groups.get(key) || []; list.push(event); groups.set(key, list); };
  if (rule.scope === 'student') {
    for (const studentId of rule.target_ids) for (const event of studentEvents.get(studentId) || []) add(studentId, event);
    return groups;
  }
  if (rule.scope === 'course') {
    for (const [studentId, events] of studentEvents) for (const event of events) {
      if (rule.target_ids.includes(event.section.course_id)) add(`${studentId}@${event.section.course_id}`, event);
    }
    return groups;
  }
  if (rule.scope === 'room') {
    for (const event of meetings) if (rule.target_ids.includes(event.room_id)) add(event.room_id, event);
    return groups;
  }
  for (const sectionId of sectionIdsForRule(rule, sections)) {
    const section = sections.get(sectionId);
    for (const event of meetings.filter(meeting => meeting.section_id === sectionId)) {
      const key = rule.scope === 'teacher' ? section.teacher_id : sectionId;
      if (key) add(key, { ...event, section });
    }
  }
  return groups;
}

function maxConsecutive(events) {
  const byDay = new Map();
  for (const event of events) {
    const { day, period } = slotParts(event.slot_id);
    const periods = byDay.get(day) || new Set(); periods.add(period); byDay.set(day, periods);
  }
  let maximum = 0;
  for (const periods of byDay.values()) {
    let current = 0;
    for (const period of [...periods].sort((left, right) => left - right)) {
      current = periods.has(period - 1) ? current + 1 : 1;
      maximum = Math.max(maximum, current);
    }
  }
  return maximum;
}

function ruleViolations(rule, sections, meetings, studentEvents) {
  const targetSectionIds = sectionIdsForRule(rule, sections);
  const targetMeetings = meetings.filter(meeting => targetSectionIds.includes(meeting.section_id));
  const params = rule.params || {};
  switch (rule.type) {
    case 'fixed_slots': {
      const expected = new Set(params.slots);
      return targetSectionIds.flatMap(sectionId => {
        const actual = new Set(meetings.filter(meeting => meeting.section_id === sectionId).map(meeting => meeting.slot_id));
        const missing = [...expected].filter(slot => !actual.has(slot));
        const unexpected = params.mode === 'exact' ? [...actual].filter(slot => !expected.has(slot)) : [];
        return missing.length || unexpected.length
          ? [violation(rule.id, `section ${sectionId} 未满足固定时段`, { section_id: sectionId, missing, unexpected })]
          : [];
      });
    }
    case 'synchronized_slots': {
      if (targetSectionIds.length < 2) return [];
      const orderedSlots = sectionId => meetings.filter(meeting => meeting.section_id === sectionId)
        .map(meeting => meeting.slot_id)
        .sort((left, right) => {
          const a = slotParts(left); const b = slotParts(right);
          return a.day - b.day || a.period - b.period;
        });
      const baselineId = targetSectionIds[0];
      const baseline = orderedSlots(baselineId);
      return targetSectionIds.slice(1).flatMap(sectionId => {
        const actual = orderedSlots(sectionId);
        return baseline.length === actual.length && baseline.every((slot, index) => slot === actual[index])
          ? []
          : [violation(rule.id, `section ${sectionId} 未与 ${baselineId} 同步上课时段`, { baseline_section_id: baselineId, section_id: sectionId, expected_slots: baseline, actual_slots: actual })];
      });
    }
    case 'separate_class_types': {
      const allowedGrades = new Set(params.grades || []);
      const left = [...sections.values()].filter(section => params.left_class_types.includes(section.class_type));
      const right = [...sections.values()].filter(section => params.right_class_types.includes(section.class_type));
      const overlaps = (leftSection, rightSection) => (leftSection.grades || []).some(grade =>
        (rightSection.grades || []).includes(grade) && (!allowedGrades.size || allowedGrades.has(grade)));
      const issues = [];
      for (const leftSection of left) for (const rightSection of right) {
        if (!overlaps(leftSection, rightSection)) continue;
        const rightSlots = new Set(meetings.filter(meeting => meeting.section_id === rightSection.id).map(meeting => meeting.slot_id));
        for (const meeting of meetings.filter(item => item.section_id === leftSection.id && rightSlots.has(item.slot_id))) {
          issues.push(violation(rule.id, `${leftSection.id} 与 ${rightSection.id} 在 ${meeting.slot_id} 混排`, { left_section_id: leftSection.id, right_section_id: rightSection.id, slot_id: meeting.slot_id }));
        }
      }
      return issues;
    }
    case 'forbid_slots':
      return targetMeetings.filter(meeting => params.slots.includes(meeting.slot_id))
        .map(meeting => violation(rule.id, `section ${meeting.section_id} 排入禁止时段 ${meeting.slot_id}`, meeting));
    case 'preferred_slots':
      return targetMeetings.filter(meeting => !params.slots.includes(meeting.slot_id))
        .map(meeting => violation(rule.id, `section ${meeting.section_id} 未排入偏好时段`, meeting));
    case 'max_occurrences_per_day': {
      const groups = groupedEvents(rule, sections, meetings, studentEvents);
      const issues = [];
      for (const [key, events] of groups) {
        const byDay = new Map();
        for (const event of events) {
          const day = slotParts(event.slot_id).day;
          const list = byDay.get(day) || []; list.push(event); byDay.set(day, list);
        }
        for (const [day, dayEvents] of byDay) if (dayEvents.length > params.max) {
          issues.push(violation(rule.id, `${key} 在第 ${day} 天安排 ${dayEvents.length} 节，超过 ${params.max} 节`, { target_id: key, day, meetings: dayEvents }));
        }
      }
      return issues;
    }
    case 'no_internal_gaps': {
      const groups = groupedEvents(rule, sections, meetings, studentEvents);
      const ignoredCourseIds = new Set(params.ignore_course_ids || []);
      const issues = [];
      for (const [key, events] of groups) {
        const byDay = new Map();
        for (const event of events.filter(item => !ignoredCourseIds.has(item.section.course_id))) {
          const { day, period } = slotParts(event.slot_id);
          const periods = byDay.get(day) || new Set();
          periods.add(period);
          byDay.set(day, periods);
        }
        for (const [day, periodSet] of byDay) {
          const actualPeriods = [...periodSet].sort((left, right) => left - right);
          const missingPeriods = Array.from(
            { length: actualPeriods.at(-1) || 0 },
            (_, index) => index + 1,
          ).filter(period => !periodSet.has(period));
          if (missingPeriods.length) {
            issues.push(violation(
              rule.id,
              `${key} 在第 ${day} 天的课程未从第 1 节连续排列`,
              { target_id: key, day, actual_periods: actualPeriods, missing_periods: missingPeriods },
            ));
          }
        }
      }
      return issues;
    }
    case 'max_consecutive_lessons': {
      const groups = groupedEvents(rule, sections, meetings, studentEvents);
      return [...groups].flatMap(([key, events]) => {
        const longest = maxConsecutive(events);
        return longest > params.max
          ? [violation(rule.id, `${key} 连续 ${longest} 节，超过 ${params.max} 节`, { target_id: key, longest })]
          : [];
      });
    }
    case 'max_consecutive_days_in_period': {
      const groups = groupedEvents(rule, sections, meetings, studentEvents);
      return [...groups].flatMap(([key, events]) => {
        const days = new Set(events.filter(event => slotParts(event.slot_id).period === params.period).map(event => slotParts(event.slot_id).day));
        let longest = 0; let current = 0;
        for (const day of [...days].sort((left, right) => left - right)) {
          current = days.has(day - 1) ? current + 1 : 1;
          longest = Math.max(longest, current);
        }
        return longest > params.max
          ? [violation(rule.id, `${key} 连续 ${longest} 天排在第 ${params.period} 节，超过 ${params.max} 天`, { target_id: key, longest })]
          : [];
      });
    }
    case 'priority':
      return [];
    default:
      return [violation(rule.id, `未知规则类型 ${rule.type}`)];
  }
}

/**
 * Validates a candidate schedule independently of the solver.  The kernel
 * checks are always hard; configured rules contribute either hard violations
 * or a weighted soft score.  This makes a solver result auditable even after
 * a future algorithm replacement.
 */
export function validateSchedule(problem, solution) {
  const sections = selectedSectionMap(problem, solution);
  const validSlots = new Set(problem.slots.map(slot => slot.id));
  const hard = [];
  const meetings = [];
  const seenMeetings = new Set();
  for (const meeting of solution.meetings || []) {
    const section = sections.get(meeting.section_id);
    if (!section) { hard.push(violation('kernel.section_exists', `未知 section: ${meeting.section_id}`, meeting)); continue; }
    if (!validSlots.has(meeting.slot_id)) { hard.push(violation('kernel.slot_exists', `未知时段: ${meeting.slot_id}`, meeting)); continue; }
    const key = `${meeting.section_id}@${meeting.slot_id}`;
    if (seenMeetings.has(key)) { hard.push(violation('kernel.section_no_duplicate_slot', `section ${meeting.section_id} 在 ${meeting.slot_id} 重复`, meeting)); continue; }
    seenMeetings.add(key);
    meetings.push({ ...meeting, room_id: null });
  }
  for (const section of sections.values()) {
    const count = meetings.filter(meeting => meeting.section_id === section.id).length;
    if (count !== section.weekly_hours) hard.push(violation('kernel.weekly_hours', `section ${section.id} 需要 ${section.weekly_hours} 节，实际 ${count} 节`, { section_id: section.id, expected: section.weekly_hours, actual: count }));
  }
  for (const lock of solution.locks || []) {
    const exists = meetings.some(meeting => meeting.section_id === lock.section_id && meeting.slot_id === lock.slot_id);
    if (!exists) hard.push(violation('kernel.lock_preserved', `锁定的 section ${lock.section_id} 不在 ${lock.slot_id}`, lock));
  }

  // Candidate rosters are a partition: every selected student must be in one
  // parallel section of each selected course, neither omitted nor duplicated.
  const memberships = new Map();
  const eligibleByCourse = new Map();
  for (const section of sections.values()) for (const studentId of section.eligible_student_ids || []) {
    const eligible = eligibleByCourse.get(section.course_id) || new Set();
    eligible.add(studentId);
    eligibleByCourse.set(section.course_id, eligible);
  }
  for (const section of sections.values()) {
    const sectionEligible = new Set(section.eligible_student_ids || []);
    const courseEligible = eligibleByCourse.get(section.course_id);
    for (const studentId of section.student_ids || []) {
      if (courseEligible?.size) {
        if (!sectionEligible.has(studentId)) hard.push(violation('kernel.eligible_membership', `学生 ${studentId} 不在 ${section.id} 的候选名单`, { section_id: section.id, student_id: studentId }));
        const key = `${studentId}@${section.course_id}`;
        const list = memberships.get(key) || []; list.push(section.id); memberships.set(key, list);
      }
    }
  }
  for (const [courseId, eligible] of eligibleByCourse) for (const studentId of eligible) {
    const key = `${studentId}@${courseId}`;
    const assigned = memberships.get(key) || [];
    if (assigned.length !== 1) hard.push(violation('kernel.selected_course_membership', `学生 ${studentId} 的 ${courseId} 应恰好分入一个 section，实际 ${assigned.length}`, { student_id: studentId, course_id: courseId, section_ids: assigned }));
  }

  const byResourceSlot = new Map();
  const addResource = (kind, id, meeting) => {
    if (!id) return;
    const key = `${kind}@${id}@${meeting.slot_id}`;
    const list = byResourceSlot.get(key) || []; list.push(meeting); byResourceSlot.set(key, list);
  };
  for (const meeting of meetings) {
    const section = sections.get(meeting.section_id);
    addResource('teacher', section.teacher_id, meeting);
  }
  for (const [key, collisions] of byResourceSlot) if (collisions.length > 1) {
    hard.push(violation('kernel.resource_no_overlap', `${key} 同时有 ${collisions.length} 个 section`, { meetings: collisions }));
  }
  const meetingsBySection = new Map();
  for (const meeting of meetings) { const list = meetingsBySection.get(meeting.section_id) || []; list.push(meeting); meetingsBySection.set(meeting.section_id, list); }
  const studentEvents = allStudentEvents(sections, meetingsBySection);
  for (const [studentId, events] of studentEvents) {
    const bySlot = new Map();
    for (const event of events) { const list = bySlot.get(event.slot_id) || []; list.push(event); bySlot.set(event.slot_id, list); }
    for (const [slot, collisions] of bySlot) if (collisions.length > 1) hard.push(violation('kernel.student_no_overlap', `学生 ${studentId} 在 ${slot} 有 ${collisions.length} 门课`, { student_id: studentId, slot_id: slot, meetings: collisions }));
  }

  const soft = [];
  for (const rule of problem.rules || []) {
    if (rule.scope === 'room') continue;
    if (rule.unmatched) {
      const item = violation(rule.id, '规则未匹配到任何目标');
      if (rule.hard) hard.push(item); else soft.push({ ...item, penalty: rule.weight });
      continue;
    }
    for (const item of ruleViolations(rule, sections, meetings, studentEvents)) {
      if (rule.hard) hard.push(item); else soft.push({ ...item, penalty: rule.weight });
    }
  }
  return {
    ok: hard.length === 0,
    hard_violations: hard,
    soft_violations: soft,
    soft_score: soft.reduce((score, item) => score + item.penalty, 0),
    counts: { sections: sections.size, meetings: meetings.length, students: studentEvents.size },
  };
}
