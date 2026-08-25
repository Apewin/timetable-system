function normalizedIdentifierPart(value, fallback) {
  const normalized = String(value || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return normalized || fallback;
}

export function nextTeachingAssignmentId({
  courseId,
  teacherId,
  classType,
  existingIds = [],
} = {}) {
  const base = [
    'TA',
    normalizedIdentifierPart(courseId, 'COURSE'),
    normalizedIdentifierPart(teacherId, 'TEACHER'),
    normalizedIdentifierPart(classType, 'CLASS'),
  ].join('_');
  const used = new Set((existingIds || []).map(String));
  if (!used.has(base)) return base;
  let suffix = 2;
  while (used.has(`${base}_${suffix}`)) suffix += 1;
  return `${base}_${suffix}`;
}

export function teachersQualifiedForCourse(teachers = [], courseId) {
  if (!courseId) return Array.isArray(teachers) ? teachers : [];
  return (Array.isArray(teachers) ? teachers : [])
    .filter(teacher => (teacher?.can_teach || []).includes(courseId));
}

export function summarizeTeacherWorkloads(teachers = [], assignments = []) {
  const assignedByTeacher = new Map();
  for (const assignment of Array.isArray(assignments) ? assignments : []) {
    if (!assignment?.teacher_id || assignment.staffing_mode === 'per_class') continue;
    const weeklyHours = Number(assignment.weekly_hours);
    if (!Number.isFinite(weeklyHours) || weeklyHours < 0) continue;
    const classCount = Array.isArray(assignment.class_ids) ? assignment.class_ids.length : 1;
    assignedByTeacher.set(
      assignment.teacher_id,
      (assignedByTeacher.get(assignment.teacher_id) || 0) + weeklyHours * classCount,
    );
  }

  return (Array.isArray(teachers) ? teachers : []).map(teacher => {
    const assigned = assignedByTeacher.get(teacher.id) || 0;
    const rawMaximum = Number(teacher.max_per_week);
    const maximum = Number.isInteger(rawMaximum) && rawMaximum >= 0 ? rawMaximum : null;
    return {
      ...teacher,
      assigned_weekly_hours: assigned,
      remaining_weekly_capacity: maximum === null ? null : Math.max(0, maximum - assigned),
      exceeds_weekly_limit: maximum !== null && assigned > maximum,
    };
  });
}

export function teacherWorkloadStatus(teacher = {}) {
  const assigned = Number.isFinite(Number(teacher.assigned_weekly_hours))
    ? Number(teacher.assigned_weekly_hours)
    : 0;
  const hasScheduled = teacher.scheduled_weekly_hours !== null
    && teacher.scheduled_weekly_hours !== undefined
    && Number.isFinite(Number(teacher.scheduled_weekly_hours));
  const scheduled = hasScheduled ? Number(teacher.scheduled_weekly_hours) : null;
  const rawMaximum = Number(teacher.max_per_week);
  const maximum = Number.isInteger(rawMaximum) && rawMaximum >= 0 ? rawMaximum : null;
  return {
    has_scheduled_hours: hasScheduled,
    scheduled_weekly_hours: scheduled,
    assigned_weekly_hours: assigned,
    maximum_weekly_hours: maximum,
    difference_from_fixed_demand: hasScheduled ? scheduled - assigned : null,
    over_limit: maximum !== null && (assigned > maximum || (hasScheduled && scheduled > maximum)),
    no_scheduled_hours: hasScheduled && scheduled === 0,
    mismatch: hasScheduled && scheduled !== assigned,
  };
}

export function teacherMatchesWorkloadFilter(teacher, filter = 'all') {
  const status = teacherWorkloadStatus(teacher);
  if (filter === 'over-limit') return status.over_limit;
  if (filter === 'no-scheduled') return status.no_scheduled_hours;
  if (filter === 'mismatch') return status.mismatch;
  return true;
}

export function teachingTaskStaffing(task = {}) {
  const requiresTeacher = Number(task.weekly_hours || 0) > 0;
  if (task.teacher_id) return { code: 'ready', label: '已分工', requires_teacher: requiresTeacher };
  if (!requiresTeacher) return { code: 'not_required', label: '无需教师', requires_teacher: false };
  return { code: 'missing', label: '待补教师', requires_teacher: true };
}

export function summarizeTeachingTasks(tasks = []) {
  const typeCounts = { teaching: 0, admin: 0, ap: 0, elective: 0, other: 0 };
  const students = new Set();
  let weeklyPeriods = 0;
  let unassignedTeacherRecords = 0;
  let noTeacherRequiredRecords = 0;

  for (const task of Array.isArray(tasks) ? tasks : []) {
    const classType = Object.hasOwn(typeCounts, task?.class_type) ? task.class_type : 'other';
    typeCounts[classType] += 1;
    weeklyPeriods += Number.isFinite(Number(task?.weekly_hours))
      ? Math.max(0, Number(task.weekly_hours))
      : 0;
    if (!task?.teacher_id && Number(task?.weekly_hours || 0) > 0) unassignedTeacherRecords += 1;
    if (!task?.teacher_id && Number(task?.weekly_hours || 0) <= 0) noTeacherRequiredRecords += 1;
    for (const studentId of task?.student_ids || []) students.add(studentId);
  }

  return {
    task_records: Array.isArray(tasks) ? tasks.length : 0,
    weekly_periods: weeklyPeriods,
    unassigned_teacher_records: unassignedTeacherRecords,
    no_teacher_required_records: noTeacherRequiredRecords,
    unique_students: students.size,
    type_counts: typeCounts,
  };
}
