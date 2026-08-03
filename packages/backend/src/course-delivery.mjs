import { courseDeliveryClassTypeForGrade } from './section-builder.mjs';

function groupsForAssignment(assignment, adminClasses, teachingClasses) {
  const classes = assignment.class_type === 'admin' ? adminClasses : teachingClasses;
  const ids = Array.isArray(assignment.class_ids)
    ? assignment.class_ids
    : assignment.class_id ? [assignment.class_id] : [];
  return ids.map(id => ({ id, group: classes.get(id) })).filter(item => item.group);
}

function staffingSignature(assignment) {
  return JSON.stringify({
    teacher_id: assignment.teacher_id || null,
    weekly_hours: Number(assignment.weekly_hours),
    staffing_mode: assignment.staffing_mode || 'shared_teacher',
    synchronized_classes: assignment.synchronized_classes === true,
  });
}

function nextAssignmentId(existingIds, courseId, grade, classType) {
  const stem = `TA_DELIVERY_${courseId}_G${grade}_${classType}`.replace(/[^A-Za-z0-9_]/g, '_');
  let id = stem;
  let suffix = 2;
  while (existingIds.has(id)) id = `${stem}_${suffix++}`;
  existingIds.add(id);
  return id;
}

function targetClassIds(state, course, grade, classType) {
  const classes = classType === 'admin' ? state.admin_classes || [] : state.teaching_classes || [];
  let matching = classes.filter(item => Number(item.grade) === Number(grade));
  if (classType === 'teaching' && Number(grade) === 11 && Array.isArray(course.applicable_class_ids)) {
    const allowed = new Set(course.applicable_class_ids);
    matching = matching.filter(item => allowed.has(item.id));
  }
  return matching.map(item => item.id).sort((left, right) => left.localeCompare(right));
}

/**
 * A course editor changes a course-level delivery choice.  This translates the
 * choice into the concrete class IDs used by the section builder, retaining
 * the existing teacher, hours and staffing policy.  A conversion is rejected
 * when multiple incompatible teacher assignments would make the intended
 * staffing ambiguous instead of silently producing duplicate classes.
 */
export function synchronizeCourseDeliveryAssignments(state, previousCourse, nextCourse) {
  const assignments = state.teaching_assignments || [];
  const adminClasses = new Map((state.admin_classes || []).map(item => [item.id, item]));
  const teachingClasses = new Map((state.teaching_classes || []).map(item => [item.id, item]));
  const existingIds = new Set(assignments.map(item => item.id));
  const removals = new Map();
  const additions = [];
  const courseId = nextCourse.id;
  const configuredGrades = Object.keys(nextCourse.delivery_class_type_by_grade || {})
    .map(Number)
    .filter(Number.isInteger)
    .sort((left, right) => left - right);

  for (const grade of configuredGrades) {
    const targetType = courseDeliveryClassTypeForGrade(nextCourse, grade);
    if (!targetType) continue;
    const entries = assignments
      .filter(assignment => assignment.course_id === courseId)
      .flatMap(assignment => groupsForAssignment(assignment, adminClasses, teachingClasses)
        .filter(({ group }) => Number(group.grade) === grade)
        .map(({ id, group }) => ({ assignment, id, group })));
    if (!entries.length) continue;

    const sourceTypes = new Set(entries.map(entry => entry.assignment.class_type));
    if (sourceTypes.size !== 1) {
      throw new Error(
        `课程 ${nextCourse.name || courseId} 在 Senior ${grade - 9} 同时存在行政班和教学班分工，`
        + '请先在教师分工中整理为一种班型后再修改课程设置',
      );
    }
    const sourceType = [...sourceTypes][0];
    if (sourceType === targetType) continue;

    const templates = [...new Map(entries.map(entry => [entry.assignment.id, entry.assignment])).values()];
    const signatures = new Set(templates.map(staffingSignature));
    if (signatures.size !== 1) {
      throw new Error(
        `课程 ${nextCourse.name || courseId} 在 Senior ${grade - 9} 有不同教师、课时或配班方式，`
        + '无法自动转换班型；请先在教师分工中统一配置后再修改',
      );
    }
    const classIds = targetClassIds(state, nextCourse, grade, targetType);
    if (!classIds.length) {
      throw new Error(`Senior ${grade - 9} 没有可用于 ${targetType === 'admin' ? '行政班' : '教学班'}上课的班级`);
    }

    for (const { assignment, id } of entries) {
      const removed = removals.get(assignment.id) || new Set();
      removed.add(id);
      removals.set(assignment.id, removed);
    }

    const template = templates[0];
    additions.push({
      id: nextAssignmentId(existingIds, courseId, grade, targetType),
      teacher_id: template.teacher_id || null,
      course_id: courseId,
      class_ids: classIds,
      class_type: targetType,
      weekly_hours: template.weekly_hours,
      ...(template.staffing_mode ? { staffing_mode: template.staffing_mode } : {}),
      ...(template.synchronized_classes !== undefined
        ? { synchronized_classes: template.synchronized_classes }
        : {}),
    });
  }

  if (!removals.size) return assignments;
  return [
    ...assignments.flatMap(assignment => {
      const removed = removals.get(assignment.id);
      if (!removed) return [assignment];
      const classIds = (Array.isArray(assignment.class_ids) ? assignment.class_ids : [assignment.class_id])
        .filter(classId => classId && !removed.has(classId));
      return classIds.length ? [{ ...assignment, class_ids: classIds, class_id: undefined }] : [];
    }),
    ...additions,
  ];
}
