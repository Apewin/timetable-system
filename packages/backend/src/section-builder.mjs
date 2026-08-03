import { validateClassIdentity } from './state-integrity.mjs';

/**
 * Converts the school's source data into schedulable sections.
 *
 * A section is the smallest unit the timetable engine can place: one course,
 * one teacher (or an explicitly unstaffed activity), one student cohort and
 * one meeting count.  It deliberately does not choose a time or a room.  That
 * is the solver's job, because assigning either here can accidentally turn a
 * feasible timetable into an artificial conflict.
 */

function byId(items = []) {
  return new Map(items.map(item => [item.id, item]));
}

const SCHOOL_GRADES = [10, 11, 12];

/**
 * Returns the canonical grade range for a course. Historical data may store a
 * single grade as a number, while cross-grade courses use an array.
 * `undefined` is retained for backwards compatibility and means unrestricted.
 */
export function courseGradeRange(course) {
  if (course?.grade === undefined || course?.grade === null || course?.grade === '') return null;
  const rawGrades = Array.isArray(course.grade) ? course.grade : [course.grade];
  if (!rawGrades.length) throw new Error(`课程 ${course.id || '（未命名）'} 至少需要一个适用年级`);
  const grades = rawGrades.map(Number);
  if (!grades.every(grade => Number.isInteger(grade) && SCHOOL_GRADES.includes(grade))) {
    throw new Error(`课程 ${course.id || '（未命名）'} 的适用年级只能是高一、高二或高三`);
  }
  return [...new Set(grades)].sort((left, right) => left - right);
}

/**
 * Canonicalizes the editable grade range and removes obsolete per-grade
 * section requirements when an administrator narrows a course's scope.
 */
export function normalizeCourseGradeRange(course) {
  const grades = courseGradeRange(course);
  if (!grades) return course;
  const normalized = {
    ...course,
    grade: grades.length === 1 ? grades[0] : grades,
  };
  if (Array.isArray(course.section_requirements)) {
    const requirements = course.section_requirements
      .map(requirement => ({
        ...requirement,
        grades: [...new Set((requirement.grades || []).map(Number))]
          .filter(grade => grades.includes(grade))
          .sort((left, right) => left - right),
      }))
      .filter(requirement => requirement.grades.length);
    if (requirements.length) normalized.section_requirements = requirements;
    else delete normalized.section_requirements;
  }
  return normalized;
}

export function courseClassRange(course) {
  if (course?.applicable_class_ids === undefined || course?.applicable_class_ids === null) return null;
  if (!Array.isArray(course.applicable_class_ids) || !course.applicable_class_ids.length) {
    throw new Error(`课程 ${course.id || '（未命名）'} 的高二适用班级不能为空`);
  }
  if (!course.applicable_class_ids.every(classId => typeof classId === 'string' && classId.trim())) {
    throw new Error(`课程 ${course.id || '（未命名）'} 的适用班级必须是班级 ID 数组`);
  }
  return [...new Set(course.applicable_class_ids)];
}

/**
 * A required/activity course may be delivered through a different stable
 * grouping in each grade.  Keep the choice on the course so the course
 * editor is the source of truth, while teacher assignments retain staffing
 * and weekly-hour details.
 */
export function courseDeliveryClassTypeForGrade(course, grade) {
  const scope = course?.delivery_class_type_by_grade;
  if (scope === undefined || scope === null) return null;
  if (!scope || typeof scope !== 'object' || Array.isArray(scope)) {
    throw new Error(`课程 ${course?.id || '（未命名）'} 的授课班型必须按年级保存`);
  }
  const value = scope[String(Number(grade))];
  if (value === undefined || value === null || value === '') return null;
  if (!['admin', 'teaching'].includes(value)) {
    throw new Error(`课程 ${course?.id || '（未命名）'} 的授课班型只能是行政班或教学班`);
  }
  return value;
}

export function normalizeCourseDeliveryScope(course) {
  const rawScope = course?.delivery_class_type_by_grade;
  if (rawScope === undefined) return course;
  if (rawScope === null) {
    const withoutDeliveryScope = { ...course };
    delete withoutDeliveryScope.delivery_class_type_by_grade;
    return withoutDeliveryScope;
  }
  if (!rawScope || typeof rawScope !== 'object' || Array.isArray(rawScope)) {
    throw new Error(`课程 ${course?.id || '（未命名）'} 的授课班型必须按年级保存`);
  }
  // AP 和必修选修课始终按学生选课分流，不应伪装成固定班课程。
  if (['ap', 'required_elective'].includes(course.type)) {
    const withoutDeliveryScope = { ...course };
    delete withoutDeliveryScope.delivery_class_type_by_grade;
    return withoutDeliveryScope;
  }
  const allowedGrades = courseGradeRange(course);
  const scope = {};
  for (const [rawGrade, rawClassType] of Object.entries(rawScope)) {
    const grade = Number(rawGrade);
    if (!Number.isInteger(grade) || !SCHOOL_GRADES.includes(grade)) {
      throw new Error(`课程 ${course?.id || '（未命名）'} 的授课班型年级无效: ${rawGrade}`);
    }
    if (allowedGrades && !allowedGrades.includes(grade)) {
      throw new Error(`课程 ${course?.id || '（未命名）'} 未适用于 Senior ${grade - 9}，不能设置该年级授课班型`);
    }
    if (!['admin', 'teaching'].includes(rawClassType)) {
      throw new Error(`课程 ${course?.id || '（未命名）'} 的授课班型只能是行政班或教学班`);
    }
    scope[grade] = rawClassType;
  }
  if (!Object.keys(scope).length) {
    const withoutDeliveryScope = { ...course };
    delete withoutDeliveryScope.delivery_class_type_by_grade;
    return withoutDeliveryScope;
  }
  return { ...course, delivery_class_type_by_grade: scope };
}

export function normalizeCourseScope(course) {
  const normalized = normalizeCourseDeliveryScope(normalizeCourseGradeRange(course));
  const grades = courseGradeRange(normalized);
  if (grades && !grades.includes(11)) {
    const withoutHighTwoClasses = { ...normalized };
    delete withoutHighTwoClasses.applicable_class_ids;
    return withoutHighTwoClasses;
  }
  const classIds = courseClassRange(normalized);
  if (!classIds) {
    const unrestricted = { ...normalized };
    delete unrestricted.applicable_class_ids;
    return unrestricted;
  }
  return { ...normalized, applicable_class_ids: classIds.sort() };
}

function gradeAllowed(course, grade) {
  const grades = courseGradeRange(course);
  return !grades || grades.includes(Number(grade));
}

function classAllowed(course, group, classType) {
  const classIds = courseClassRange(course);
  if (!classIds || classType !== 'teaching' || Number(group.grade) !== 11) return true;
  return classIds.includes(group.id);
}

/**
 * Prevents a grade-range edit from silently dropping students who have
 * already selected the course. The administrator can first amend those
 * students' choices, then narrow the course safely.
 */
export function validateCourseGradeSelections(state, courses = byId(state.courses)) {
  for (const course of courses.values()) courseGradeRange(course);
  for (const student of state.students || []) {
    const selectedCourseIds = [
      ...(student.ap_courses || []),
      ...Object.values(student.elective_choices || {}),
    ];
    for (const courseId of selectedCourseIds) {
      const course = courses.get(courseId);
      if (!course || gradeAllowed(course, student.grade)) continue;
      throw new Error(
        `学生 ${student.name || student.id}（${student.id}，高${Number(student.grade) - 9}）`
        + `已选择 ${course.name || course.id}，不在该课程的新适用年级范围内；请先调整该生选课`,
      );
    }
  }
}

export function validateCourseClassScopes(state, courses = byId(state.courses)) {
  const teachingClasses = byId(state.teaching_classes);
  for (const course of courses.values()) {
    const deliveryScope = course.delivery_class_type_by_grade;
    if (deliveryScope !== undefined && deliveryScope !== null) {
      for (const grade of Object.keys(deliveryScope)) courseDeliveryClassTypeForGrade(course, grade);
      if (['ap', 'required_elective'].includes(course.type)) {
        throw new Error(`课程 ${course.id} 是选课分流课程，不能设置行政班或教学班授课班型`);
      }
    }
    const classIds = courseClassRange(course);
    if (!classIds) continue;
    const grades = courseGradeRange(course);
    if (grades && !grades.includes(11)) {
      throw new Error(`课程 ${course.id} 未包含高二，不能设置高二适用班级`);
    }
    for (const classId of classIds) {
      const teachingClass = teachingClasses.get(classId);
      if (!teachingClass) throw new Error(`课程 ${course.id} 引用了不存在的教学班 ${classId}`);
      if (Number(teachingClass.grade) !== 11) {
        throw new Error(`课程 ${course.id} 的适用班级 ${classId} 不是高二教学班`);
      }
    }
  }
}

function configuredSectionCount(value) {
  if (Array.isArray(value)) return Math.max(1, ...value.filter(Number.isFinite));
  return Number.isInteger(value) && value > 0 ? value : 1;
}

function defaultTeacher(state, courseId) {
  return (state.teachers || [])
    .filter(teacher => (teacher.can_teach || []).includes(courseId))
    .sort((left, right) => left.id.localeCompare(right.id))[0] || null;
}

function addSelection(selectedByCourse, courseId, student) {
  const students = selectedByCourse.get(courseId) || new Map();
  students.set(student.id, student);
  selectedByCourse.set(courseId, students);
}

function requiredAssignments(state, courses, adminClasses, teachingClasses) {
  const sections = [];
  for (const assignment of state.teaching_assignments || []) {
    const classIds = Array.isArray(assignment.class_ids)
      ? assignment.class_ids
      : assignment.class_id ? [assignment.class_id] : [];
    if (!classIds.length) throw new Error(`教师分工 ${assignment.id} 未指定班级`);
    const classes = assignment.class_type === 'admin' ? adminClasses : teachingClasses;
    const course = courses.get(assignment.course_id);
    if (!course) throw new Error(`教师分工 ${assignment.id} 引用了不存在的课程 ${assignment.course_id}`);
    if (assignment.synchronized_classes !== undefined
      && typeof assignment.synchronized_classes !== 'boolean') {
      throw new Error(`教师分工 ${assignment.id} 的 synchronized_classes 必须是布尔值`);
    }

    // A per-class staffing assignment represents a role (for example “each
    // homeroom teacher”), not one real person shared by every listed class.
    // Until concrete teacher_ids_by_class are supplied, each section occupies
    // its students without creating a false shared-teacher resource.
    if (assignment.staffing_mode
      && !['shared_teacher', 'per_class'].includes(assignment.staffing_mode)) {
      throw new Error(`教师分工 ${assignment.id} 的 staffing_mode 无效: ${assignment.staffing_mode}`);
    }
    const perClassStaffing = assignment.staffing_mode === 'per_class';
    const unstaffedActivity = !assignment.teacher_id || perClassStaffing;
    if (!unstaffedActivity) {
      const teacher = (state.teachers || []).find(item => item.id === assignment.teacher_id);
      if (!teacher) throw new Error(`教师分工 ${assignment.id} 引用了不存在的教师 ${assignment.teacher_id || '（空）'}`);
      if (!(teacher.can_teach || []).includes(course.id)) {
        throw new Error(`教师 ${teacher.id} 未配置为可教授 ${course.id}（教师分工 ${assignment.id}）`);
      }
    }

    for (const classId of classIds) {
      const group = classes.get(classId);
      if (!group) throw new Error(`教师分工 ${assignment.id} 引用了不存在的班级 ${classId}`);
      if (!gradeAllowed(course, group.grade)) {
        throw new Error(`课程 ${course.id} 不适用于 ${group.name || classId} 所在年级`);
      }
      const configuredClassType = courseDeliveryClassTypeForGrade(course, group.grade);
      if (configuredClassType && configuredClassType !== assignment.class_type) {
        const expectedLabel = configuredClassType === 'admin' ? '行政班' : '教学班';
        throw new Error(
          `课程 ${course.id} 在 Senior ${Number(group.grade) - 9} 设置为${expectedLabel}上课，`
          + `但教师分工 ${assignment.id} 仍引用${assignment.class_type === 'admin' ? '行政班' : '教学班'}`,
        );
      }
      // A teacher assignment may deliberately list all parallel teaching
      // classes. The editable course scope is the effective subset and
      // therefore suppresses out-of-scope tasks rather than invalidating the
      // broader staffing record.
      if (!classAllowed(course, group, assignment.class_type)) continue;
      sections.push({
        id: `SEC_${assignment.class_type}_${assignment.id}_${classId}`,
        course_id: course.id,
        teacher_id: unstaffedActivity ? null : assignment.teacher_id,
        class_id: classId,
        class_type: assignment.class_type,
        source: 'required',
        source_assignment_id: assignment.id,
        synchronized_group_id: assignment.synchronized_classes ? assignment.id : null,
        weekly_hours: assignment.weekly_hours,
        student_ids: [...group.student_ids],
        eligible_student_ids: [],
        room_id: null,
        room_candidates: [],
        room_binding: 'disabled',
        capacity: null,
        staffing_mode: assignment.staffing_mode || 'shared_teacher',
        warnings: perClassStaffing
          ? ['每班由各自教师负责，不占用共享教师资源']
          : unstaffedActivity ? ['未记录授课教师，作为无教师活动处理'] : [],
      });
    }
  }
  return sections;
}

function selectedCourseStudents(state, courses) {
  const selected = new Map();
  for (const student of state.students || []) {
    for (const courseId of student.ap_courses || []) {
      const course = courses.get(courseId);
      if (course?.type === 'ap') {
        if (!gradeAllowed(course, student.grade)) {
          throw new Error(`学生 ${student.id} 的年级不在课程 ${courseId} 的适用范围内`);
        }
        addSelection(selected, courseId, student);
      }
    }
    for (const courseId of Object.values(student.elective_choices || {})) {
      const course = courses.get(courseId);
      if (course?.type === 'required_elective') {
        if (!gradeAllowed(course, student.grade)) {
          throw new Error(`学生 ${student.id} 的年级不在课程 ${courseId} 的适用范围内`);
        }
        addSelection(selected, courseId, student);
      }
    }
  }
  return selected;
}

/**
 * Validates the declared course options for each named student choice block.
 * `allowIncomplete` is used only while building a scheduling problem: chosen
 * students keep their exact course membership, while students who have not
 * submitted a choice are left out until their data is imported later.
 */
export function validateSelectionBlocks(
  state,
  courses = new Map((state.courses || []).map(course => [course.id, course])),
  { allowIncomplete = false } = {},
) {
  const ids = new Set();
  for (const block of state.selection_blocks || []) {
    if (!block || typeof block.id !== 'string' || !block.id) throw new Error('选课组必须有 id');
    if (ids.has(block.id)) throw new Error(`选课组 id 重复: ${block.id}`);
    ids.add(block.id);
    if (typeof block.choice_key !== 'string' || !block.choice_key) throw new Error(`选课组 ${block.id} 必须有 choice_key`);
    if (!Array.isArray(block.grades) || !block.grades.length || !block.grades.every(Number.isInteger)) {
      throw new Error(`选课组 ${block.id} 必须有非空 grades 数组`);
    }
    if (!Array.isArray(block.allowed_course_ids) || block.allowed_course_ids.length < 2) {
      throw new Error(`选课组 ${block.id} 至少需要两门允许课程`);
    }
    const allowed = new Set(block.allowed_course_ids);
    if (allowed.size !== block.allowed_course_ids.length) throw new Error(`选课组 ${block.id} 的 allowed_course_ids 不能重复`);
    for (const courseId of allowed) {
      const course = courses.get(courseId);
      if (!course) throw new Error(`选课组 ${block.id} 引用了不存在的课程 ${courseId}`);
      if (course.type !== 'required_elective') throw new Error(`选课组 ${block.id} 的课程 ${courseId} 必须是选修课`);
      const courseGrades = courseGradeRange(course);
      const unsupported = courseGrades ? block.grades.filter(grade => !courseGrades.includes(grade)) : [];
      if (unsupported.length) {
        throw new Error(`选课组 ${block.id} 的课程 ${courseId} 不适用于组内年级: ${unsupported.join(', ')}`);
      }
    }
    if (block.synchronized_time_block) {
      if (!Number.isInteger(block.section_count) || block.section_count < 1) {
        throw new Error(`同步选课组 ${block.id} 必须指定正整数 section_count`);
      }
    }
    for (const student of state.students || []) {
      if (!block.grades.includes(student.grade)) continue;
      const selected = student.elective_choices?.[block.choice_key];
      if (!selected && block.required !== false && !allowIncomplete) {
        throw new Error(`学生 ${student.id} 未在选课组 ${block.id} 选择课程`);
      }
      if (selected && !allowed.has(selected)) throw new Error(`学生 ${student.id} 在选课组 ${block.id} 选择了不允许的课程 ${selected}`);
    }
  }
}

function synchronizedBlockForCourse(state, courseId) {
  const blocks = (state.selection_blocks || []).filter(block =>
    block.synchronized_time_block === true && (block.allowed_course_ids || []).includes(courseId));
  if (blocks.length > 1) throw new Error(`课程 ${courseId} 同时属于多个同步选课组`);
  return blocks[0] || null;
}

function selectedSections(state, courses) {
  const sections = [];
  const selected = selectedCourseStudents(state, courses);
  for (const [courseId, studentMap] of [...selected].sort(([left], [right]) => left.localeCompare(right))) {
    const course = courses.get(courseId);
    const allStudents = [...studentMap.values()].sort((left, right) => left.id.localeCompare(right.id));
    const synchronizedBlock = synchronizedBlockForCourse(state, courseId);
    if (synchronizedBlock && allStudents.some(student => !synchronizedBlock.grades.includes(student.grade))) {
      throw new Error(`同步选课组 ${synchronizedBlock.id} 的课程 ${courseId} 含有组外年级学生`);
    }
    let requirements = synchronizedBlock
      ? [{ grades: synchronizedBlock.grades, count: synchronizedBlock.section_count, teacher_id: null, synchronized_block_id: synchronizedBlock.id }]
      : course.section_requirements?.length
      ? course.section_requirements
      : [{ grades: null, count: configuredSectionCount(course.section_count), teacher_id: null }];
    if (!synchronizedBlock && course.section_requirements?.length) {
      const allowedGrades = courseGradeRange(course);
      if (allowedGrades) {
        requirements = requirements
          .map(requirement => ({
            ...requirement,
            grades: (requirement.grades || []).filter(grade => allowedGrades.includes(Number(grade))),
          }))
          .filter(requirement => requirement.grades.length);
        const explicitlyCovered = new Set(requirements.flatMap(requirement => requirement.grades));
        const uncoveredGrades = allowedGrades.filter(grade => !explicitlyCovered.has(grade));
        if (uncoveredGrades.length) {
          requirements.push({
            grades: uncoveredGrades,
            count: configuredSectionCount(course.section_count),
            teacher_id: null,
          });
        }
      }
    }
    const claimed = new Set();

    for (const requirement of requirements) {
      const cohortStudents = allStudents.filter(student =>
        !requirement.grades || requirement.grades.includes(student.grade));
      if (!cohortStudents.length) continue;
      for (const student of cohortStudents) {
        if (claimed.has(student.id)) throw new Error(`课程 ${courseId} 的分班要求重复覆盖学生 ${student.id}`);
        claimed.add(student.id);
      }
      const teacher = requirement.teacher_id
        ? (state.teachers || []).find(item => item.id === requirement.teacher_id)
        : defaultTeacher(state, courseId);
      if (!teacher || !(teacher.can_teach || []).includes(courseId)) {
        throw new Error(`课程 ${courseId} 没有可教授该分班组的教师`);
      }
      const sectionCount = requirement.count;
      const targetSize = Math.ceil(cohortStudents.length / sectionCount);
      const cohortLabel = requirement.grades?.length
        ? `G${[...requirement.grades].sort((left, right) => left - right).join('_G')}`
        : 'ALL';
      const prefix = course.type === 'ap' ? 'AP' : 'ELECTIVE';
      for (let index = 0; index < sectionCount; index++) {
        const provisionalStudents = cohortStudents.slice(index * targetSize, (index + 1) * targetSize);
        if (!provisionalStudents.length) continue;
        sections.push({
          id: `SEC_${prefix}_${courseId}_${cohortLabel}_${index + 1}`,
          course_id: courseId,
          teacher_id: teacher.id,
          class_id: null,
          class_type: course.type === 'ap' ? 'ap' : 'elective',
          source: course.type,
          cohort_id: `${courseId}:${cohortLabel}`,
          weekly_hours: course.weekly_hours,
          // This is a balanced starting roster for a preview, not a final
          // placement.  The solver may move a student between parallel sections.
          student_ids: provisionalStudents.map(student => student.id),
          eligible_student_ids: cohortStudents.map(student => student.id),
          room_id: null,
          room_candidates: [],
          room_binding: 'disabled',
          capacity: null,
          warnings: [],
        });
      }
    }
    if (claimed.size !== allStudents.length) {
      const omitted = allStudents.filter(student => !claimed.has(student.id)).map(student => student.id);
      throw new Error(`课程 ${courseId} 的分班要求未覆盖学生: ${omitted.join(', ')}`);
    }
  }
  return sections;
}

/**
 * Applies the few administrative choices that must survive a later re-solve.
 * Generated `schedule.sections` are output, whereas `section_overrides` is
 * input: it records a deliberately assigned teacher and students explicitly
 * placed in a particular parallel section.  Keeping this distinction avoids
 * accidentally freezing every solver-produced roster forever.
 */
function applySectionOverrides(sections, state) {
  const overrides = state.section_overrides;
  if (!overrides || typeof overrides !== 'object' || Array.isArray(overrides)) return sections;
  const sectionById = byId(sections);
  const teachers = byId(state.teachers);
  const lockedTargetByStudentCourse = new Map();
  for (const [sectionId, override] of Object.entries(overrides)) {
    if (!override || typeof override !== 'object' || Array.isArray(override)) {
      throw new Error(`section override ${sectionId} 必须是对象`);
    }
    const section = sectionById.get(sectionId);
    if (!section) throw new Error(`section override 引用了不存在的 section: ${sectionId}`);
    if (override.teacher_id !== undefined) {
      const teacher = teachers.get(override.teacher_id);
      if (!teacher || !(teacher.can_teach || []).includes(section.course_id)) {
        throw new Error(`section override ${sectionId} 的教师不能教授 ${section.course_id}`);
      }
      section.teacher_id = teacher.id;
    }
    if (override.locked_student_ids === undefined) continue;
    if (!Array.isArray(override.locked_student_ids) || !override.locked_student_ids.every(id => typeof id === 'string')) {
      throw new Error(`section override ${sectionId} 的 locked_student_ids 必须是学生 ID 数组`);
    }
    if (new Set(override.locked_student_ids).size !== override.locked_student_ids.length) {
      throw new Error(`section override ${sectionId} 的锁定学生重复`);
    }
    const eligible = new Set(section.eligible_student_ids || []);
    section.locked_student_ids = [...override.locked_student_ids];
    for (const studentId of section.locked_student_ids) {
      if (!eligible.has(studentId)) throw new Error(`学生 ${studentId} 未选择 ${section.course_id}，不能锁定在 ${sectionId}`);
      const key = `${studentId}\u0000${section.course_id}`;
      const existing = lockedTargetByStudentCourse.get(key);
      if (existing && existing.id !== section.id) {
        throw new Error(`学生 ${studentId} 被锁定到 ${section.course_id} 的多个平行 section`);
      }
      lockedTargetByStudentCourse.set(key, section);
    }
  }
  // Make the preview roster reflect those persistent transfers.  The solver
  // additionally receives `locked_student_ids`, so a future re-solve keeps
  // the chosen student in this parallel section without freezing everyone.
  for (const [key, target] of lockedTargetByStudentCourse) {
    const [studentId, courseId] = key.split('\u0000');
    const parallel = sections.filter(section => section.course_id === courseId && section.class_type === target.class_type);
    for (const section of parallel) section.student_ids = section.student_ids.filter(id => id !== studentId);
    target.student_ids.push(studentId);
  }
  return sections;
}

export function buildSections(state) {
  validateClassIdentity(state);
  const courses = byId(state.courses);
  validateCourseGradeSelections(state, courses);
  validateCourseClassScopes(state, courses);
  // Timetable construction is allowed to proceed from partial rosters. A
  // missing choice is diagnostic data, not a contradiction in course times.
  // Invalid choices still fail validation above and are never scheduled.
  validateSelectionBlocks(state, courses, { allowIncomplete: true });
  const adminClasses = byId(state.admin_classes);
  const teachingClasses = byId(state.teaching_classes);
  const sections = [
    ...requiredAssignments(state, courses, adminClasses, teachingClasses),
    ...selectedSections(state, courses),
  ];
  return applySectionOverrides(sections, state);
}
