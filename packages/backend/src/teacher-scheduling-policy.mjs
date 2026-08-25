function nonNegativeInteger(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
}

function violation(ruleId, message, details = {}) {
  return { rule_id: ruleId, message, ...details };
}

export function validateTeacherSchedulingSettings(teacher, { allowedSlotIds } = {}) {
  for (const [field, label] of [
    ['max_per_day', '每天上限'],
    ['max_per_week', '每周上限'],
  ]) {
    if (teacher[field] === undefined || teacher[field] === null) continue;
    if (nonNegativeInteger(teacher[field]) === null) {
      throw new Error(`教师 ${teacher.id} 的${label}必须是非负整数`);
    }
  }
  if (!Array.isArray(teacher.available_slots || [])) {
    throw new Error(`教师 ${teacher.id} 的可用时段必须是数组`);
  }
  const availableSlots = teacher.available_slots || [];
  if (new Set(availableSlots).size !== availableSlots.length) {
    throw new Error(`教师 ${teacher.id} 的可用时段不能重复`);
  }
  if (allowedSlotIds) {
    const invalidAvailableSlot = availableSlots.find(slotId => !allowedSlotIds.has(slotId));
    if (invalidAvailableSlot !== undefined) {
      throw new Error(`教师 ${teacher.id} 的可用时段无效: ${invalidAvailableSlot}`);
    }
  }
  return teacher;
}

export function teacherSchedulingLimits(teachers = [], slots = []) {
  const allowedSlotIds = new Set(slots.map(slot => slot.id));
  return teachers.flatMap(teacher => {
    validateTeacherSchedulingSettings(teacher, { allowedSlotIds });
    const limit = {
      teacher_id: teacher.id,
      teacher_name: teacher.name || teacher.id,
    };
    const maxPerDay = nonNegativeInteger(teacher.max_per_day);
    const maxPerWeek = nonNegativeInteger(teacher.max_per_week);
    if (maxPerDay !== null) limit.max_per_day = maxPerDay;
    if (maxPerWeek !== null) limit.max_per_week = maxPerWeek;
    const availableSlotIds = [...(teacher.available_slots || [])];
    if (availableSlotIds.length) limit.available_slot_ids = availableSlotIds;
    return Object.keys(limit).length > 2 ? [limit] : [];
  });
}

export function teacherWorkloadInfeasibility({ slots = [], limits = [], sections = [] } = {}) {
  const weeklyHours = new Map();
  for (const section of sections) if (section.teacher_id) {
    weeklyHours.set(
      section.teacher_id,
      (weeklyHours.get(section.teacher_id) || 0) + Number(section.weekly_hours || 0),
    );
  }
  for (const limit of limits) {
    const assigned = weeklyHours.get(limit.teacher_id) || 0;
    const weeklyMaximum = nonNegativeInteger(limit.max_per_week);
    if (weeklyMaximum !== null && assigned > weeklyMaximum) return {
      status: 'INFEASIBLE_BY_TEACHER_WEEKLY_LIMIT',
      reason: `教师 ${limit.teacher_name || limit.teacher_id} 已分配 ${assigned} 节/周，超过上限 ${weeklyMaximum} 节/周；请调整教师分工或提高该教师的每周上限`,
      teacher_id: limit.teacher_id,
      assigned_weekly_hours: assigned,
      max_per_week: weeklyMaximum,
    };

    const dailyMaximum = nonNegativeInteger(limit.max_per_day);
    const availableSlotIds = new Set(limit.available_slot_ids || []);
    if (dailyMaximum === null && !availableSlotIds.size) continue;
    const slotsByDay = new Map();
    for (const slot of slots) {
      if (availableSlotIds.size && !availableSlotIds.has(slot.id)) continue;
      slotsByDay.set(slot.day, (slotsByDay.get(slot.day) || 0) + 1);
    }
    const capacity = [...slotsByDay.values()].reduce(
      (total, count) => total + (dailyMaximum === null ? count : Math.min(count, dailyMaximum)),
      0,
    );
    if (assigned > capacity) return {
      status: dailyMaximum === null
        ? 'INFEASIBLE_BY_TEACHER_AVAILABILITY'
        : 'INFEASIBLE_BY_TEACHER_DAILY_LIMIT',
      reason: dailyMaximum === null
        ? `教师 ${limit.teacher_name || limit.teacher_id} 已分配 ${assigned} 节/周，但当前可用时段最多只能安排 ${capacity} 节；请调整教师分工或增加可用时段`
        : `教师 ${limit.teacher_name || limit.teacher_id} 已分配 ${assigned} 节/周；按每天上限 ${dailyMaximum} 节和当前可用时段，一周最多安排 ${capacity} 节`,
      teacher_id: limit.teacher_id,
      assigned_weekly_hours: assigned,
      max_per_day: dailyMaximum,
      available_capacity: capacity,
    };
  }
  return null;
}

export function teacherSchedulingViolations({
  slots = [],
  limits = [],
  sections = [],
  meetings = [],
} = {}) {
  const sectionsById = new Map(sections.map(section => [section.id, section]));
  const slotDays = new Map(slots.map(slot => [slot.id, slot.day]));
  const weeklyHours = new Map();
  const dailyHours = new Map();
  const meetingsByTeacher = new Map();
  for (const meeting of meetings) {
    const teacherId = sectionsById.get(meeting.section_id)?.teacher_id;
    if (!teacherId) continue;
    weeklyHours.set(teacherId, (weeklyHours.get(teacherId) || 0) + 1);
    const teacherMeetings = meetingsByTeacher.get(teacherId) || [];
    teacherMeetings.push(meeting);
    meetingsByTeacher.set(teacherId, teacherMeetings);
    const day = slotDays.get(meeting.slot_id);
    if (day === undefined) continue;
    const teacherDays = dailyHours.get(teacherId) || new Map();
    teacherDays.set(day, (teacherDays.get(day) || 0) + 1);
    dailyHours.set(teacherId, teacherDays);
  }

  const violations = [];
  for (const limit of limits) {
    const weeklyMaximum = nonNegativeInteger(limit.max_per_week);
    const assignedWeekly = weeklyHours.get(limit.teacher_id) || 0;
    if (weeklyMaximum !== null && assignedWeekly > weeklyMaximum) violations.push(violation(
      'kernel.teacher_max_per_week',
      `教师 ${limit.teacher_name || limit.teacher_id} 实际排课 ${assignedWeekly} 节/周，超过上限 ${weeklyMaximum} 节/周`,
      { teacher_id: limit.teacher_id, actual: assignedWeekly, maximum: weeklyMaximum },
    ));

    const dailyMaximum = nonNegativeInteger(limit.max_per_day);
    if (dailyMaximum !== null) {
      for (const [day, assigned] of dailyHours.get(limit.teacher_id) || []) {
        if (assigned <= dailyMaximum) continue;
        violations.push(violation(
          'kernel.teacher_max_per_day',
          `教师 ${limit.teacher_name || limit.teacher_id} 第 ${day} 天实际排课 ${assigned} 节，超过每天上限 ${dailyMaximum} 节`,
          { teacher_id: limit.teacher_id, day, actual: assigned, maximum: dailyMaximum },
        ));
      }
    }

    const availableSlotIds = new Set(limit.available_slot_ids || []);
    if (!availableSlotIds.size) continue;
    for (const meeting of meetingsByTeacher.get(limit.teacher_id) || []) {
      if (availableSlotIds.has(meeting.slot_id)) continue;
      violations.push(violation(
        'kernel.teacher_available_slots',
        `教师 ${limit.teacher_name || limit.teacher_id} 在不可用时段 ${meeting.slot_id} 被安排课程`,
        {
          teacher_id: limit.teacher_id,
          section_id: meeting.section_id,
          slot_id: meeting.slot_id,
        },
      ));
    }
  }
  return violations;
}
