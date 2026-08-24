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

export function summarizeTeachingTasks(tasks = []) {
  const typeCounts = { teaching: 0, admin: 0, ap: 0, elective: 0, other: 0 };
  const students = new Set();
  let weeklyPeriods = 0;
  let unassignedTeacherRecords = 0;

  for (const task of Array.isArray(tasks) ? tasks : []) {
    const classType = Object.hasOwn(typeCounts, task?.class_type) ? task.class_type : 'other';
    typeCounts[classType] += 1;
    weeklyPeriods += Number.isFinite(Number(task?.weekly_hours))
      ? Math.max(0, Number(task.weekly_hours))
      : 0;
    if (!task?.teacher_id) unassignedTeacherRecords += 1;
    for (const studentId of task?.student_ids || []) students.add(studentId);
  }

  return {
    task_records: Array.isArray(tasks) ? tasks.length : 0,
    weekly_periods: weeklyPeriods,
    unassigned_teacher_records: unassignedTeacherRecords,
    unique_students: students.size,
    type_counts: typeCounts,
  };
}
