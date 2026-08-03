function text(value) {
  return String(value ?? '').trim();
}

function assignmentClassCount(assignment) {
  if (Array.isArray(assignment.class_ids)) return assignment.class_ids.length;
  return assignment.class_id ? 1 : 0;
}

function teacherCanTeach(teacher, courseId) {
  return Boolean(teacher && (teacher.can_teach || []).includes(courseId));
}

function assignmentClassIds(assignment) {
  return Array.isArray(assignment.class_ids)
    ? assignment.class_ids.filter(Boolean)
    : assignment.class_id ? [assignment.class_id] : [];
}

function mentionedGrades(value) {
  const source = text(value).toLowerCase();
  const aliases = [
    [10, /高一|高\s*10|senior\s*1|grade\s*10/],
    [11, /高二|高\s*11|senior\s*2|grade\s*11/],
    [12, /高三|高\s*12|senior\s*3|grade\s*12/],
  ];
  return aliases.filter(([, pattern]) => pattern.test(source)).map(([grade]) => grade);
}

function segmentForTeacher(message, teacherName, startAt = 0) {
  const index = message.indexOf(teacherName, startAt);
  if (index < 0) return null;
  return { index, text: message.slice(index) };
}

/**
 * Resolve one very explicit, common natural-language operation without asking
 * the model to reason about IDs. It deliberately returns null on ambiguity;
 * the model remains responsible for conversational clarification.
 */
export function inferTeacherAssignmentSwap(state = {}, rawMessage) {
  const message = text(rawMessage);
  if (!/(调换|互换|交换)/.test(message)) return null;
  const teachers = (state.teachers || [])
    .filter(teacher => text(teacher.name) && message.includes(text(teacher.name)))
    .sort((left, right) => message.indexOf(left.name) - message.indexOf(right.name));
  if (teachers.length !== 2) return null;
  const allClasses = new Map([
    ...(state.admin_classes || []),
    ...(state.teaching_classes || []),
  ].map(item => [item.id, item]));
  const courses = new Map((state.courses || []).map(item => [item.id, item]));
  const assignments = state.teaching_assignments || [];
  const mentions = teachers.map(teacher => segmentForTeacher(message, teacher.name));
  const assignmentForMention = (teacher, mention, nextMention) => {
    const segment = message.slice(mention.index, nextMention?.index ?? message.length);
    const namedCourseIds = [...courses.values()]
      .filter(course => text(course.name) && segment.includes(text(course.name)))
      .map(course => course.id);
    const requestedGrades = mentionedGrades(segment);
    const candidates = assignments.filter(assignment => {
      if (assignment.teacher_id !== teacher.id || assignment.staffing_mode === 'per_class') return false;
      if (namedCourseIds.length && !namedCourseIds.includes(assignment.course_id)) return false;
      if (!requestedGrades.length) return true;
      const classGrades = assignmentClassIds(assignment)
        .map(classId => Number(allClasses.get(classId)?.grade))
        .filter(Number.isFinite);
      return requestedGrades.every(grade => classGrades.includes(grade));
    });
    return candidates.length === 1 ? candidates[0] : null;
  };
  const left = assignmentForMention(teachers[0], mentions[0], mentions[1]);
  const right = assignmentForMention(teachers[1], mentions[1], null);
  return left && right ? [left.id, right.id] : null;
}

function describeAssignment(assignment, teachers, courses) {
  const teacher = teachers.get(assignment.teacher_id);
  const course = courses.get(assignment.course_id);
  return {
    assignment_id: assignment.id,
    teacher_id: teacher?.id || assignment.teacher_id,
    teacher_name: teacher?.name || assignment.teacher_id,
    course_id: course?.id || assignment.course_id,
    course_name: course?.name || assignment.course_id,
    class_type: assignment.class_type,
    class_count: assignmentClassCount(assignment),
    weekly_hours: Number(assignment.weekly_hours) || 0,
  };
}

/**
 * Validate a proposed teacher exchange against the canonical staffing data.
 * The result is safe to render and to send back for explicit confirmation.
 */
export function teacherAssignmentSwapProposal(state = {}, rawAssignmentIds) {
  if (!Array.isArray(rawAssignmentIds) || rawAssignmentIds.length !== 2) {
    throw new Error('调换授课教师必须指定恰好两项教师分工');
  }
  const assignmentIds = rawAssignmentIds.map(text);
  if (assignmentIds.some(id => !id) || assignmentIds[0] === assignmentIds[1]) {
    throw new Error('请选择两项不同的教师分工');
  }
  const assignments = new Map((state.teaching_assignments || []).map(item => [item.id, item]));
  const teachers = new Map((state.teachers || []).map(item => [item.id, item]));
  const courses = new Map((state.courses || []).map(item => [item.id, item]));
  const [left, right] = assignmentIds.map(id => assignments.get(id));
  if (!left || !right) throw new Error('待调换的教师分工已不存在或已变更，请重新发起操作');
  if (!left.teacher_id || !right.teacher_id) throw new Error('无固定授课教师的活动不能使用教师调换');
  if (left.staffing_mode === 'per_class' || right.staffing_mode === 'per_class') {
    throw new Error('按班分别配教师的活动不能作为一位共享教师调换');
  }
  if (left.teacher_id === right.teacher_id) throw new Error('这两项分工当前已由同一位教师负责，无需调换');
  const [leftTeacher, rightTeacher] = [teachers.get(left.teacher_id), teachers.get(right.teacher_id)];
  if (!leftTeacher || !rightTeacher) throw new Error('待调换的教师资料不存在，请先在教师管理中核对');
  if (!teacherCanTeach(leftTeacher, right.course_id) || !teacherCanTeach(rightTeacher, left.course_id)) {
    throw new Error(
      `${leftTeacher.name || left.teacher_id} 与 ${rightTeacher.name || right.teacher_id} 不同时具备互换后课程的授课资格`,
    );
  }
  const impacts = [];
  if (state.schedule) impacts.push('当前正式课表会标记为“待重排”；课程时段不会在本操作中直接移动。');
  if (state.manual_plan?.status === 'confirmed') {
    impacts.push('已确认的手动必要条件会变为“待重新确认”，金框课程的位置不会被本操作直接移动。');
  }
  return {
    type: 'swap_teaching_assignments',
    assignment_ids: assignmentIds,
    expected_revision: Number(state.meta?.revision) || 0,
    title: '调换两项课程的授课教师',
    assignments: [
      describeAssignment(left, teachers, courses),
      describeAssignment(right, teachers, courses),
    ],
    impacts,
  };
}

export function applyTeacherAssignmentSwap(state, rawAssignmentIds) {
  const proposal = teacherAssignmentSwapProposal(state, rawAssignmentIds);
  const [leftId, rightId] = proposal.assignment_ids;
  const [left, right] = proposal.assignments;
  const teachingAssignments = (state.teaching_assignments || []).map(assignment => {
    if (assignment.id === leftId) return { ...assignment, teacher_id: right.teacher_id };
    if (assignment.id === rightId) return { ...assignment, teacher_id: left.teacher_id };
    return assignment;
  });
  return { proposal, teachingAssignments };
}
