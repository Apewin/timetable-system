function dynamicSection(section) {
  return ['ap', 'elective'].includes(section.class_type)
    && (section.eligible_student_ids || []).length > 0;
}

function slotParts(slotId) {
  const match = /^D(\d+)P(\d+)$/.exec(slotId || '');
  return match ? { day: Number(match[1]), period: Number(match[2]) } : null;
}

function studentRulesSatisfied(studentId, events, rules) {
  for (const rule of rules) {
    if (!rule.hard || rule.scope !== 'student' || !(rule.target_ids || []).includes(studentId)) continue;
    const ignored = new Set(rule.params?.ignore_course_ids || []);
    const included = events.filter(event => !ignored.has(event.course_id));
    if (rule.type === 'no_internal_gaps') {
      const periodsByDay = new Map();
      for (const event of included) {
        const parts = slotParts(event.slot_id);
        if (!parts) return false;
        const periods = periodsByDay.get(parts.day) || new Set();
        periods.add(parts.period);
        periodsByDay.set(parts.day, periods);
      }
      for (const periods of periodsByDay.values()) {
        const last = Math.max(...periods);
        for (let period = 1; period <= last; period += 1) if (!periods.has(period)) return false;
      }
    }
    if (rule.type === 'max_occurrences_per_day') {
      const countByDay = new Map();
      for (const event of included) {
        const day = slotParts(event.slot_id)?.day;
        countByDay.set(day, (countByDay.get(day) || 0) + 1);
      }
      if ([...countByDay.values()].some(count => count > rule.params.max)) return false;
    }
    if (rule.type === 'max_consecutive_lessons') {
      const periodsByDay = new Map();
      for (const event of included) {
        const parts = slotParts(event.slot_id);
        const periods = periodsByDay.get(parts.day) || new Set();
        periods.add(parts.period);
        periodsByDay.set(parts.day, periods);
      }
      for (const periods of periodsByDay.values()) {
        let run = 0;
        for (let period = 1; period <= Math.max(...periods); period += 1) {
          run = periods.has(period) ? run + 1 : 0;
          if (run > rule.params.max) return false;
        }
      }
    }
  }
  return true;
}

function solutionAssignments(sections, meetingsBySection) {
  return sections.flatMap(section => (meetingsBySection.get(section.id) || []).flatMap(meeting =>
    (section.student_ids || []).map(studentId => ({
      task_id: `${section.id}:${studentId}:${meeting.slot_id}`,
      section_id: section.id,
      student_id: studentId,
      slot_id: meeting.slot_id,
      room_id: null,
      teacher_id: section.teacher_id,
      course_id: section.course_id,
      class_id: section.class_id || section.id,
      class_type: section.class_type,
    }))));
}

/**
 * Assigns students to already-timed AP/elective parallel sections.
 *
 * Room capacity is intentionally absent: without section capacities, each
 * student's choices are independent and can be solved with a small DFS rather
 * than one school-wide CP-SAT membership model.
 */
export function assignStudentsToScheduledSections(problem, meetings) {
  const slotOrder = new Map((problem.slots || []).map((slot, index) => [slot.id, index]));
  const meetingsBySection = new Map();
  for (const meeting of meetings || []) {
    const list = meetingsBySection.get(meeting.section_id) || [];
    list.push({ ...meeting, room_id: null });
    meetingsBySection.set(meeting.section_id, list);
  }
  for (const [sectionId, sectionMeetings] of meetingsBySection) {
    meetingsBySection.set(sectionId, sectionMeetings
      .sort((left, right) => (slotOrder.get(left.slot_id) ?? Infinity) - (slotOrder.get(right.slot_id) ?? Infinity))
      .map((meeting, occurrenceIndex) => ({ ...meeting, occurrence_index: occurrenceIndex })));
  }
  const sections = problem.sections.map(section => ({
    ...section,
    student_ids: dynamicSection(section) ? [] : [...(section.student_ids || [])],
  }));
  const sectionById = new Map(sections.map(section => [section.id, section]));
  const candidateSections = sections.filter(dynamicSection);
  const eligibleByStudentCourse = new Map();
  for (const section of candidateSections) for (const studentId of section.eligible_student_ids || []) {
    const key = `${studentId}@${section.course_id}`;
    const candidates = eligibleByStudentCourse.get(key) || [];
    candidates.push(section);
    eligibleByStudentCourse.set(key, candidates);
  }
  const baseEventsByStudent = new Map();
  for (const section of sections.filter(item => !dynamicSection(item))) {
    for (const studentId of section.student_ids || []) {
      const events = baseEventsByStudent.get(studentId) || [];
      events.push(...(meetingsBySection.get(section.id) || []).map(meeting => ({
        slot_id: meeting.slot_id,
        course_id: section.course_id,
        section_id: section.id,
        occurrence_index: meeting.occurrence_index,
      })));
      baseEventsByStudent.set(studentId, events);
    }
  }
  const coursesByStudent = new Map();
  for (const [key, candidates] of eligibleByStudentCourse) {
    const splitAt = key.indexOf('@');
    const studentId = key.slice(0, splitAt);
    const courseId = key.slice(splitAt + 1);
    const locked = candidates.filter(section => (section.locked_student_ids || []).includes(studentId));
    const options = locked.length ? locked : candidates;
    const courses = coursesByStudent.get(studentId) || [];
    courses.push({ courseId, options });
    coursesByStudent.set(studentId, courses);
  }
  const failures = [];
  let searchNodes = 0;
  const collisionPair = (left, right) => ({
    left_section_id: left.section_id,
    left_occurrence_index: left.occurrence_index,
    right_section_id: right.section_id,
    right_occurrence_index: right.occurrence_index,
  });
  const uniquePairs = pairs => {
    const seen = new Set();
    return pairs.filter(pair => {
      const endpoints = [
        `${pair.left_section_id}#${pair.left_occurrence_index}`,
        `${pair.right_section_id}#${pair.right_occurrence_index}`,
      ].sort();
      const key = endpoints.join('|');
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  };
  for (const [studentId, rawCourses] of coursesByStudent) {
    const baseEvents = baseEventsByStudent.get(studentId) || [];
    const occupied = new Set(baseEvents.map(event => event.slot_id));
    const rejectedBaseCollisions = new Map();
    const courses = rawCourses
      .map(course => ({
        ...course,
        options: course.options.filter(section => {
          const pairs = (meetingsBySection.get(section.id) || []).flatMap(meeting =>
            baseEvents
              .filter(event => event.slot_id === meeting.slot_id)
              .map(event => collisionPair(event, {
                section_id: section.id,
                occurrence_index: meeting.occurrence_index,
              })));
          if (pairs.length) rejectedBaseCollisions.set(section.id, pairs);
          return pairs.length === 0;
        }),
      }))
      .sort((left, right) => left.options.length - right.options.length);
    if (courses.some(course => course.options.length === 0)) {
      const failedCourse = courses.find(course => course.options.length === 0);
      failures.push({
        student_id: studentId,
        course_id: failedCourse.courseId,
        reason: '所有平行 section 均与固定课程冲突',
        collision_cut: uniquePairs(failedCourse.options.length
          ? []
          : rawCourses.find(course => course.courseId === failedCourse.courseId).options
            .flatMap(section => rejectedBaseCollisions.get(section.id) || [])),
      });
      continue;
    }
    const selected = [];
    const choose = index => {
      searchNodes += 1;
      if (index === courses.length) {
        const candidateEvents = selected.flatMap(section =>
          (meetingsBySection.get(section.id) || []).map(meeting => ({
            slot_id: meeting.slot_id,
            course_id: section.course_id,
            section_id: section.id,
            occurrence_index: meeting.occurrence_index,
          })));
        return studentRulesSatisfied(studentId, [...baseEvents, ...candidateEvents], problem.rules || []);
      }
      for (const section of courses[index].options) {
        const slots = (meetingsBySection.get(section.id) || []).map(meeting => meeting.slot_id);
        if (slots.some(slot => occupied.has(slot))) continue;
        slots.forEach(slot => occupied.add(slot));
        selected.push(section);
        if (choose(index + 1)) return true;
        selected.pop();
        slots.forEach(slot => occupied.delete(slot));
      }
      return false;
    };
    if (!choose(0)) {
      const candidateCollisions = [];
      for (let leftIndex = 0; leftIndex < courses.length; leftIndex += 1) {
        for (let rightIndex = leftIndex + 1; rightIndex < courses.length; rightIndex += 1) {
          for (const leftSection of courses[leftIndex].options) for (const rightSection of courses[rightIndex].options) {
            for (const leftMeeting of meetingsBySection.get(leftSection.id) || []) {
              for (const rightMeeting of meetingsBySection.get(rightSection.id) || []) {
                if (leftMeeting.slot_id !== rightMeeting.slot_id) continue;
                candidateCollisions.push(collisionPair({
                  section_id: leftSection.id,
                  occurrence_index: leftMeeting.occurrence_index,
                }, {
                  section_id: rightSection.id,
                  occurrence_index: rightMeeting.occurrence_index,
                }));
              }
            }
          }
        }
      }
      failures.push({
        student_id: studentId,
        reason: '无法在已定时段中完成所有选课且满足学生硬规则',
        collision_cut: uniquePairs(candidateCollisions),
      });
      continue;
    }
    for (const section of selected) sectionById.get(section.id).student_ids.push(studentId);
  }
  const normalizedMeetings = (meetings || []).map(meeting => ({ ...meeting, room_id: null }));
  return {
    ok: failures.length === 0,
    status: failures.length ? 'STUDENT_ASSIGNMENT_INFEASIBLE' : 'STUDENT_ASSIGNMENT_FEASIBLE',
    sections,
    meetings: normalizedMeetings,
    assignments: solutionAssignments(sections, meetingsBySection),
    failures,
    search_nodes: searchNodes,
  };
}
