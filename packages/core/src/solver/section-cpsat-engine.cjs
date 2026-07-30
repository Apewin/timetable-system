const { CpModel, CpSolver, CpSolverStatus } = require('@ortools-node/cp-sat');
const { makeTaskId } = require('../constants.cjs');

/**
 * Section-level timetable primitives.
 *
 * A section is the smallest schedulable teaching unit: one teacher teaches a
 * cohort of students in one room.  Student assignments are expanded only
 * after a section has been placed.  This is intentionally different from the
 * legacy engines, which attempted to schedule AP periods student by student.
 */

function configuredSectionCount(value) {
  // 跨年级课程可用 [高二需求, 高三需求] 记录开班要求；允许混班时
  // 实际要开的平行班数取其中最大值，而不是数组长度。
  if (Array.isArray(value)) return Math.max(1, ...value.filter(Number.isFinite));
  return Number.isInteger(value) && value > 0 ? value : 1;
}

function courseRoomCandidates(state, course, size) {
  const matchingType = course.required_room_type
    ? state.rooms.filter(room => room.type === course.required_room_type)
    : state.rooms;
  return matchingType
    .filter(room => room.capacity >= size)
    .sort((a, b) => a.id.localeCompare(b.id));
}

function teacherForCourse(state, courseId) {
  const candidates = state.teachers
    .filter(teacher => (teacher.can_teach || []).includes(courseId))
    .sort((a, b) => a.id.localeCompare(b.id));
  return candidates[0] || null;
}

function addSelectedStudent(selectedStudents, courseId, student) {
  if (!selectedStudents.has(courseId)) selectedStudents.set(courseId, []);
  selectedStudents.get(courseId).push(student);
}

/**
 * Build every schedulable section in the school. Grade is deliberately not a
 * grouping key for AP and elective selections: G11/G12 students can share a
 * section whenever the course, teacher, and room capacity allow it.
 */
function buildSections(state) {
  const coursesById = new Map(state.courses.map(course => [course.id, course]));
  const adminClasses = new Map((state.admin_classes || []).map(group => [group.id, group]));
  const teachingClasses = new Map((state.teaching_classes || []).map(group => [group.id, group]));
  const sections = [];
  const roomLoad = new Map((state.rooms || []).map(room => [room.id, 0]));

  // Required administrative and teaching classes already have explicit
  // teacher/class membership in the input.  Each listed class is its own
  // section because a teacher cannot teach multiple rooms at once.
  for (const assignment of state.teaching_assignments || []) {
    const classIds = Array.isArray(assignment.class_ids)
      ? assignment.class_ids
      : assignment.class_id ? [assignment.class_id] : [];
    const classes = assignment.class_type === 'admin' ? adminClasses : teachingClasses;
    // The legacy fixture represents several class teachers with one grade-wide
    // placeholder (for example T_G11_HOMEROOM), while the meeting rule fixes
    // all of those classes to the same period. Treat it as an explicitly
    // unassigned supervisor until the school records per-class homeroom
    // teachers; otherwise the placeholder falsely makes the model infeasible.
    const sharedMeetingPlaceholder = assignment.course_id === 'MEETING'
      && assignment.class_type === 'admin'
      && classIds.length > 1;
    for (const classId of classIds) {
      const group = classes.get(classId);
      if (!group) throw new Error(`教师分工 ${assignment.id} 引用了不存在的班级 ${classId}`);
      const course = coursesById.get(assignment.course_id);
      if (!course) throw new Error(`教师分工 ${assignment.id} 引用了不存在的课程 ${assignment.course_id}`);
      // 行政班的固定教室是业务规则；教学班的 fixed_room_id 只是首选
      // 教室。后者在多个教学班共用时必须自动换到同容量的可用教室，
      // 否则会在模型建立前就制造每周超过 50 节的物理无解。
      let roomId = group.fixed_room_id;
      if (assignment.class_type === 'teaching') {
        const room = courseRoomCandidates(state, course, group.student_ids.length)
          .sort((a, b) => (roomLoad.get(a.id) - roomLoad.get(b.id)) || a.id.localeCompare(b.id))[0];
        if (!room) throw new Error(`教学班 ${classId} 没有容量足够的教室`);
        roomId = room.id;
      }
      const section = {
        id: `SEC_${assignment.class_type}_${assignment.id}_${classId}`,
        course_id: assignment.course_id,
        teacher_id: sharedMeetingPlaceholder ? null : assignment.teacher_id || null,
        student_ids: [...group.student_ids],
        weekly_hours: assignment.weekly_hours,
        room_id: roomId,
        class_type: assignment.class_type,
        source: 'required',
        teacher_assignment_warning: sharedMeetingPlaceholder
          ? `班会 ${classId} 未配置独立班主任；当前按无教师固定活动排课`
          : undefined,
      };
      sections.push(section);
      roomLoad.set(section.room_id, (roomLoad.get(section.room_id) || 0) + section.weekly_hours);
    }
  }

  // Gather AP and required-elective membership before creating sections. This
  // is the key boundary that fixes the legacy per-student scheduling bug.
  const selectedStudents = new Map();
  for (const student of state.students) {
    for (const courseId of student.ap_courses || []) {
      const course = coursesById.get(courseId);
      if (course?.type === 'ap') addSelectedStudent(selectedStudents, courseId, student);
    }
    for (const courseId of Object.values(student.elective_choices || {})) {
      const course = coursesById.get(courseId);
      if (course?.type === 'required_elective') addSelectedStudent(selectedStudents, courseId, student);
    }
  }

  for (const [courseId, unsortedStudents] of [...selectedStudents.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const allStudents = [...new Map(unsortedStudents.map(student => [student.id, student])).values()]
      .sort((a, b) => a.id.localeCompare(b.id));
    const course = coursesById.get(courseId);
    const requirements = course.section_requirements?.length
      ? course.section_requirements
      : [{ grades: null, count: configuredSectionCount(course.section_count), teacher_id: null }];
    const claimedStudents = new Set();

    for (const requirement of requirements) {
      const students = allStudents.filter(student => !requirement.grades || requirement.grades.includes(student.grade));
      if (!students.length) continue;
      for (const student of students) {
        if (claimedStudents.has(student.id)) throw new Error(`课程 ${courseId} 的分班要求重复包含学生 ${student.id}`);
        claimedStudents.add(student.id);
      }
      const teacher = requirement.teacher_id
        ? state.teachers.find(item => item.id === requirement.teacher_id)
        : teacherForCourse(state, courseId);
      if (!teacher || !(teacher.can_teach || []).includes(courseId)) {
        throw new Error(`课程 ${courseId} 没有可教授该年级组的教师`);
      }
      const allRooms = courseRoomCandidates(state, course, 1);
      if (!allRooms.length) throw new Error(`课程 ${courseId} 没有可用教室`);
      const maxCapacity = Math.max(...allRooms.map(room => room.capacity));
      // 教务规定的开班数是下限；容量不足时才追加 section。一个老师可承担
      // 多个 section，后续共享排课模型会强制这些课时不重叠。
      const count = Math.max(requirement.count, Math.ceil(students.length / maxCapacity));
      const perSection = Math.ceil(students.length / count);
      const cohortKey = requirement.grades ? `_G${[...requirement.grades].sort((a, b) => a - b).join('_G')}` : '';
      const cohortId = `${courseId}:${cohortKey || 'ALL'}`;

      for (let index = 0; index < count; index++) {
        const members = students.slice(index * perSection, (index + 1) * perSection);
        if (!members.length) continue;
        const room = courseRoomCandidates(state, course, members.length)
          .sort((a, b) => (roomLoad.get(a.id) - roomLoad.get(b.id)) || a.id.localeCompare(b.id))[0];
        if (!room) throw new Error(`课程 ${courseId} 第 ${index + 1} 个 section 没有容量足够的教室`);
        sections.push({
          id: `SEC_${course.type === 'ap' ? 'AP' : 'ELECTIVE'}_${courseId}${cohortKey}_${index + 1}`,
          course_id: courseId,
          teacher_id: teacher.id,
          student_ids: members.map(student => student.id),
          eligible_student_ids: students.map(student => student.id),
          cohort_id: cohortId,
          weekly_hours: course.weekly_hours,
          room_id: room.id,
          capacity: room.capacity,
          class_type: course.type === 'ap' ? 'ap' : 'elective',
          source: course.type,
        });
        roomLoad.set(room.id, (roomLoad.get(room.id) || 0) + course.weekly_hours);
      }
    }
    if (claimedStudents.size !== allStudents.length) {
      const omitted = allStudents.filter(student => !claimedStudents.has(student.id)).map(student => student.id).join(', ');
      throw new Error(`课程 ${courseId} 的分班要求未覆盖学生: ${omitted}`);
    }
  }
  return sections;
}

function sumVars(vars) {
  if (!vars.length) throw new Error('求解模型中出现了没有候选时段的课时');
  return vars.slice(1).reduce((sum, variable) => sum.add(variable), vars[0]);
}

function allSlots() {
  const slots = [];
  for (let day = 1; day <= 5; day++) {
    for (let period = 1; period <= 10; period++) slots.push(`D${day}P${period}`);
  }
  return slots;
}

function slotDay(slotId) {
  return Number(slotId.match(/^D(\d+)P/)[1]);
}

function slotPeriod(slotId) {
  return Number(slotId.match(/P(\d+)$/)[1]);
}

function seededKey(value, seed) {
  let hash = seed >>> 0;
  for (let index = 0; index < value.length; index++) hash = Math.imul(hash ^ value.charCodeAt(index), 16777619);
  return hash >>> 0;
}

function fixedSlotsFor(section, rules) {
  if (section.fixed_slots?.length) return section.fixed_slots;
  const rule = (rules?.rules || rules || []).find(item => item.course === section.course_id && (item.fixed_slot || item.fixed_slots));
  if (!rule) return [];
  return rule.fixed_slot ? [rule.fixed_slot] : rule.fixed_slots;
}

function sectionSlots(meetings) {
  const result = new Map();
  for (const meeting of meetings) {
    const slots = result.get(meeting.section_id) || new Set();
    slots.add(meeting.slot_id);
    result.set(meeting.section_id, slots);
  }
  return result;
}

function sharesSlot(left, right) {
  for (const slot of left || []) if ((right || new Set()).has(slot)) return true;
  return false;
}

/**
 * Decide membership for already-open AP/elective sections after their common
 * meeting times are known.  A student is assigned to exactly one section of
 * each selected course; the assignment is balanced and cannot collide with
 * any required class or another selected section.
 */
async function assignStudentsToSections(state, sections, meetings) {
  const candidateSections = sections.filter(section =>
    (section.class_type === 'ap' || section.class_type === 'elective')
    && (section.eligible_student_ids || []).length
  );
  const slotsBySection = sectionSlots(meetings);
  const model = new CpModel();
  const variables = new Map();
  const candidatesByStudent = new Map();
  const fixedSlotsByStudent = new Map();

  for (const section of sections) {
    if (candidateSections.includes(section)) continue;
    const slots = slotsBySection.get(section.id) || new Set();
    for (const studentId of section.student_ids) {
      const occupied = fixedSlotsByStudent.get(studentId) || new Set();
      slots.forEach(slot => occupied.add(slot));
      fixedSlotsByStudent.set(studentId, occupied);
    }
  }

  for (const section of candidateSections) {
    for (const studentId of section.eligible_student_ids) {
      const variable = model.newBoolVar(`MEMBER_${studentId}_${section.id}`);
      variables.set(`${studentId}@${section.id}`, variable);
      const entries = candidatesByStudent.get(studentId) || [];
      entries.push({ section, variable });
      candidatesByStudent.set(studentId, entries);
      if (sharesSlot(fixedSlotsByStudent.get(studentId), slotsBySection.get(section.id))) {
        model.addEquality(variable, 0n);
      }
    }
  }

  for (const [studentId, entries] of candidatesByStudent) {
    const byCourse = new Map();
    for (const entry of entries) {
      const values = byCourse.get(entry.section.course_id) || [];
      values.push(entry.variable);
      byCourse.set(entry.section.course_id, values);
    }
    for (const [courseId, values] of byCourse) {
      if (!values.length) throw new Error(`学生 ${studentId} 的课程 ${courseId} 没有可选 section`);
      model.addEquality(sumVars(values), 1n);
    }
    for (let left = 0; left < entries.length; left++) {
      for (let right = left + 1; right < entries.length; right++) {
        if (entries[left].section.course_id === entries[right].section.course_id) continue;
        if (sharesSlot(slotsBySection.get(entries[left].section.id), slotsBySection.get(entries[right].section.id))) {
          model.addLessOrEqual(entries[left].variable.add(entries[right].variable), 1n);
        }
      }
    }
  }

  const byCourse = new Map();
  for (const section of candidateSections) {
    const cohortKey = `${section.course_id}@${section.cohort_id || 'ALL'}`;
    const values = byCourse.get(cohortKey) || [];
    values.push(section);
    byCourse.set(cohortKey, values);
  }
  for (const sectionsForCourse of byCourse.values()) {
    const students = [...new Set(sectionsForCourse.flatMap(section => section.eligible_student_ids))];
    const minSize = Math.floor(students.length / sectionsForCourse.length);
    const maxSize = Math.ceil(students.length / sectionsForCourse.length);
    for (const section of sectionsForCourse) {
      const membership = section.eligible_student_ids.map(studentId => variables.get(`${studentId}@${section.id}`));
      model.addGreaterOrEqual(sumVars(membership), BigInt(minSize));
      model.addLessOrEqual(sumVars(membership), BigInt(Math.min(maxSize, section.capacity || maxSize)));
    }
  }

  const solver = new CpSolver();
  solver.parameters.maxTimeInSeconds = 20;
  solver.parameters.numSearchWorkers = 8;
  const status = await solver.solve(model);
  const ok = status === CpSolverStatus.OPTIMAL || status === CpSolverStatus.FEASIBLE;
  if (!ok) return { ok: false, status, sections };
  const allocated = sections.map(section => ({ ...section, student_ids: candidateSections.includes(section) ? [] : [...section.student_ids] }));
  const allocatedById = new Map(allocated.map(section => [section.id, section]));
  for (const section of candidateSections) {
    for (const studentId of section.eligible_student_ids) {
      if (solver.booleanValue(variables.get(`${studentId}@${section.id}`))) {
        allocatedById.get(section.id).student_ids.push(studentId);
      }
    }
  }
  return { ok: true, status, sections: allocated };
}

/**
 * Place sections in one shared CP-SAT model, then expand each section meeting
 * into student-facing assignment rows.  All students and all teachers in the
 * supplied state participate in the same model, irrespective of grade.
 */
async function solveSectionTimetable(state, options = {}) {
  const sections = options.sections || buildSections(state);
  const slots = allSlots();
  const model = new CpModel();
  const occurrences = [];

  for (const section of sections) {
    const fixedSlots = fixedSlotsFor(section, options.rules);
    for (let occurrence = 0; occurrence < section.weekly_hours; occurrence++) {
      const variables = {};
      const allowedSlots = occurrence < fixedSlots.length ? [fixedSlots[occurrence]]
        // A five-hour course has exactly one meeting on each school day. Its
        // occurrence labels are interchangeable, so pinning H0..H4 to
        // D1..D5 only removes 5! symmetric copies of the same timetable.
        : section.weekly_hours === 5 ? slots.filter(slotId => slotDay(slotId) === occurrence + 1)
        : section.course_id === 'SELF_STUDY' ? slots.filter(slotId => Number(slotId.split('P')[1]) >= 6) : slots;
      for (const slotId of allowedSlots) {
        if (section.student_ids.some(studentId => options.blockedSlotsByStudent?.get(studentId)?.has(slotId))) continue;
        if (section.teacher_id && options.blockedSlotsByTeacher?.get(section.teacher_id)?.has(slotId)) continue;
        if (section.room_id && options.blockedSlotsByRoom?.get(section.room_id)?.has(slotId)) continue;
        variables[slotId] = model.newBoolVar(`${section.id}_H${occurrence}_${slotId}`);
      }
      model.addEquality(sumVars(Object.values(variables)), 1n);
      occurrences.push({ section, occurrence, variables });
    }
  }

  // A section cannot meet itself twice in one time slot.
  for (const section of sections) {
    const own = occurrences.filter(item => item.section.id === section.id);
    for (const slotId of slots) {
      const variables = own.map(item => item.variables[slotId]).filter(Boolean);
      if (variables.length > 1) model.addLessOrEqual(sumVars(variables), 1n);
    }
  }

  // A student belongs to several independent class systems.  Their combined
  // membership, not their grade, defines the no-overlap constraint.
  if (!options.ignoreStudentConflicts) {
    const studentsById = new Map(state.students.map(student => [student.id, student]));
    for (const studentId of studentsById.keys()) {
      const enrolled = occurrences.filter(item => item.section.student_ids.includes(studentId));
      for (const slotId of slots) {
        const variables = enrolled.map(item => item.variables[slotId]).filter(Boolean);
        if (variables.length > 1) model.addLessOrEqual(sumVars(variables), 1n);
      }
      const dailyLimit = options.maxLessonsPerDayByStudent?.get(studentId);
      if (dailyLimit !== undefined) {
        for (let day = 1; day <= 5; day++) {
          const variables = enrolled.flatMap(item => slots
            .filter(slotId => slotDay(slotId) === day)
            .map(slotId => item.variables[slotId]).filter(Boolean));
          if (variables.length > 1) model.addLessOrEqual(sumVars(variables), BigInt(dailyLimit));
        }
      }
    }
  }

  // One teacher / one physical room can host only one section at a time.
  for (const slotId of slots) {
    const byTeacher = new Map();
    const byRoom = new Map();
    for (const item of occurrences) {
      if (item.section.teacher_id) {
        const values = byTeacher.get(item.section.teacher_id) || [];
        if (item.variables[slotId]) values.push(item.variables[slotId]);
        byTeacher.set(item.section.teacher_id, values);
      }
      if (item.section.room_id) {
        const values = byRoom.get(item.section.room_id) || [];
        if (item.variables[slotId]) values.push(item.variables[slotId]);
        byRoom.set(item.section.room_id, values);
      }
    }
    if (!options.ignoreTeacherConflicts) {
      for (const values of byTeacher.values()) if (values.length > 1) model.addLessOrEqual(sumVars(values), 1n);
    }
    if (!options.ignoreRoomConflicts) {
      for (const values of byRoom.values()) if (values.length > 1) model.addLessOrEqual(sumVars(values), 1n);
    }
  }

  // Weekly courses up to five hours are distributed across the week, matching
  // the school rule and avoiding a course being compressed into one day.
  for (const section of sections.filter(section => section.weekly_hours <= 5)) {
    const own = occurrences.filter(item => item.section.id === section.id);
    for (let day = 1; day <= 5; day++) {
      const values = own.flatMap(item => slots.filter(slotId => slotDay(slotId) === day).map(slotId => item.variables[slotId]).filter(Boolean));
      if (values.length > 1) model.addLessOrEqual(sumVars(values), 1n);
    }
  }

  // A course with more than five weekly periods needs one double period. The
  // two meetings on that day must be consecutive rather than two scattered
  // lessons, which is the existing school validation rule.
  for (const section of sections.filter(section => section.weekly_hours > 5)) {
    const own = occurrences.filter(item => item.section.id === section.id);
    for (let day = 1; day <= 5; day++) {
      const daySlots = slots.filter(slotId => slotDay(slotId) === day);
      const dayVariables = own.flatMap(item => daySlots.map(slotId => item.variables[slotId]).filter(Boolean));
      if (dayVariables.length > 1) model.addLessOrEqual(sumVars(dayVariables), 2n);
      for (let left = 0; left < own.length; left++) {
        for (let right = left + 1; right < own.length; right++) {
          for (const leftSlot of daySlots) {
            const leftVariable = own[left].variables[leftSlot];
            if (!leftVariable) continue;
            for (const rightSlot of daySlots) {
              const rightVariable = own[right].variables[rightSlot];
              if (!rightVariable || Math.abs(slotPeriod(leftSlot) - slotPeriod(rightSlot)) === 1) continue;
              model.addLessOrEqual(leftVariable.add(rightVariable), 1n);
            }
          }
        }
      }
    }
  }

  const solver = new CpSolver();
  solver.parameters.maxTimeInSeconds = options.maxTimeSeconds || 30;
  solver.parameters.numSearchWorkers = options.numSearchWorkers || 8;
  if (options.randomSeed !== undefined) {
    solver.parameters.randomSeed = options.randomSeed;
    solver.parameters.randomizeSearch = true;
  }
  const status = await solver.solve(model);
  const ok = status === CpSolverStatus.OPTIMAL || status === CpSolverStatus.FEASIBLE;
  const warnings = sections
    .filter(section => section.teacher_assignment_warning)
    .map(section => section.teacher_assignment_warning);
  if (!ok) return { ok: false, status, sections, assignments: [], meetings: [], warnings };

  const meetings = occurrences.map(item => ({
    section_id: item.section.id,
    slot_id: Object.keys(item.variables).find(candidate => solver.booleanValue(item.variables[candidate])),
  }));
  const meetingSlots = new Map(meetings.map(meeting => [
    `${meeting.section_id}@${meeting.slot_id}`, meeting.slot_id,
  ]));
  const assignments = [];
  for (const item of occurrences) {
    const slotId = meetingSlots.get(`${item.section.id}@${Object.keys(item.variables).find(candidate => solver.booleanValue(item.variables[candidate]))}`);
    for (const studentId of item.section.student_ids) {
      assignments.push({
        task_id: makeTaskId(item.section.id, item.section.course_id, studentId, slotId),
        slot_id: slotId,
        room_id: item.section.room_id,
        course_id: item.section.course_id,
        class_id: item.section.id,
        class_type: item.section.class_type,
        teacher_id: item.section.teacher_id,
        student_id: studentId,
        section_id: item.section.id,
      });
    }
  }
  return { ok: true, status, sections, assignments, meetings, warnings };
}

function expandAssignments(sections, meetings) {
  const sectionsById = new Map(sections.map(section => [section.id, section]));
  const assignments = [];
  for (const meeting of meetings) {
    const section = sectionsById.get(meeting.section_id);
    for (const studentId of section.student_ids) {
      assignments.push({
        task_id: makeTaskId(section.id, section.course_id, studentId, meeting.slot_id),
        slot_id: meeting.slot_id,
        room_id: section.room_id,
        course_id: section.course_id,
        class_id: section.id,
        class_type: section.class_type,
        teacher_id: section.teacher_id,
        student_id: studentId,
        section_id: section.id,
      });
    }
  }
  return assignments;
}

/**
 * Solve the optional/AP layer after the administrative and teaching-class
 * timetable has been fixed.  This keeps the mandatory part of a student's
 * timetable out of the attendance product variables, while still deciding
 * every optional section's meeting time and every student's parallel-section
 * membership in one model.
 */
async function solveSelectionsOnCore(state, core, candidateSections, options = {}) {
  const slots = allSlots();
  const model = new CpModel();
  const occurrences = [];
  const candidateBusyByTeacherSlot = new Map(), candidateBusyByRoomSlot = new Map();
  const coreByTeacher = new Map(), coreByRoom = new Map(), coreByStudent = new Map();
  const addCore = (map, id, slotId) => {
    if (!id) return;
    const values = map.get(id) || new Set(); values.add(slotId); map.set(id, values);
  };
  const coreById = new Map(core.sections.map(section => [section.id, section]));
  for (const meeting of core.meetings) {
    const section = coreById.get(meeting.section_id);
    addCore(coreByTeacher, section.teacher_id, meeting.slot_id);
    addCore(coreByRoom, section.room_id, meeting.slot_id);
    for (const studentId of section.student_ids) addCore(coreByStudent, studentId, meeting.slot_id);
  }

  for (const section of candidateSections) {
    const fixedSlots = fixedSlotsFor(section, options.rules);
    for (let occurrence = 0; occurrence < section.weekly_hours; occurrence++) {
      const allowed = occurrence < fixedSlots.length ? [fixedSlots[occurrence]]
        : section.weekly_hours === 5 ? slots.filter(slotId => slotDay(slotId) === occurrence + 1)
        : section.course_id === 'SELF_STUDY' ? slots.filter(slotId => slotPeriod(slotId) >= 6) : slots;
      const variables = {};
      for (const slotId of allowed) {
        if (section.teacher_id && coreByTeacher.get(section.teacher_id)?.has(slotId)) continue;
        if (section.room_id && coreByRoom.get(section.room_id)?.has(slotId)) continue;
        variables[slotId] = model.newBoolVar(`SEL_TIME_${section.id}_${occurrence}_${slotId}`);
      }
      model.addEquality(sumVars(Object.values(variables)), 1n);
      for (const [slotId, variable] of Object.entries(variables)) {
        if (section.teacher_id) {
          const key = `${section.teacher_id}@${slotId}`;
          const values = candidateBusyByTeacherSlot.get(key) || []; values.push(variable); candidateBusyByTeacherSlot.set(key, values);
        }
        if (section.room_id) {
          const key = `${section.room_id}@${slotId}`;
          const values = candidateBusyByRoomSlot.get(key) || []; values.push(variable); candidateBusyByRoomSlot.set(key, values);
        }
      }
      occurrences.push({ section, occurrence, variables });
    }
  }

  for (const section of candidateSections) {
    const own = occurrences.filter(item => item.section.id === section.id);
    for (const slotId of slots) {
      const vars = own.map(item => item.variables[slotId]).filter(Boolean);
      if (vars.length > 1) model.addLessOrEqual(sumVars(vars), 1n);
    }
    for (let day = 1; day <= 5; day++) {
      const vars = own.flatMap(item => slots.filter(slotId => slotDay(slotId) === day).map(slotId => item.variables[slotId]).filter(Boolean));
      if (section.weekly_hours <= 5 && vars.length > 1) model.addLessOrEqual(sumVars(vars), 1n);
      if (section.weekly_hours > 5 && vars.length > 1) model.addLessOrEqual(sumVars(vars), 2n);
    }
  }
  for (const slotId of slots) {
    const byTeacher = new Map(), byRoom = new Map();
    for (const item of occurrences) {
      const variable = item.variables[slotId]; if (!variable) continue;
      if (item.section.teacher_id) { const vars = byTeacher.get(item.section.teacher_id) || []; vars.push(variable); byTeacher.set(item.section.teacher_id, vars); }
      if (item.section.room_id) { const vars = byRoom.get(item.section.room_id) || []; vars.push(variable); byRoom.set(item.section.room_id, vars); }
    }
    for (const vars of byTeacher.values()) if (vars.length > 1) model.addLessOrEqual(sumVars(vars), 1n);
    for (const vars of byRoom.values()) if (vars.length > 1) model.addLessOrEqual(sumVars(vars), 1n);
  }

  const membership = new Map(), choicesByStudent = new Map();
  for (const section of candidateSections) {
    for (const studentId of section.eligible_student_ids) {
      const variable = model.newBoolVar(`SEL_MEMBER_${studentId}_${section.id}`);
      membership.set(`${studentId}@${section.id}`, variable);
      const choices = choicesByStudent.get(studentId) || [];
      choices.push({ section, variable }); choicesByStudent.set(studentId, choices);
    }
  }
  for (const choices of choicesByStudent.values()) {
    const byCourse = new Map();
    for (const choice of choices) { const vars = byCourse.get(choice.section.course_id) || []; vars.push(choice.variable); byCourse.set(choice.section.course_id, vars); }
    for (const vars of byCourse.values()) model.addEquality(sumVars(vars), 1n);
  }
  const sectionsByCourse = new Map();
  for (const section of candidateSections) {
    const cohortKey = `${section.course_id}@${section.cohort_id || 'ALL'}`;
    const list = sectionsByCourse.get(cohortKey) || []; list.push(section); sectionsByCourse.set(cohortKey, list);
  }
  for (const list of sectionsByCourse.values()) {
    const enrolled = [...new Set(list.flatMap(section => section.eligible_student_ids))];
    const min = Math.floor(enrolled.length / list.length), max = Math.ceil(enrolled.length / list.length);
    for (const section of list) {
      const vars = section.eligible_student_ids.map(studentId => membership.get(`${studentId}@${section.id}`));
      model.addGreaterOrEqual(sumVars(vars), BigInt(min));
      model.addLessOrEqual(sumVars(vars), BigInt(Math.min(max, section.capacity || max)));
    }
  }

  const attendedByStudentSlot = new Map();
  const addAttendance = (studentId, slotId, variable) => {
    const key = `${studentId}@${slotId}`; const vars = attendedByStudentSlot.get(key) || []; vars.push(variable); attendedByStudentSlot.set(key, vars);
  };
  for (const item of occurrences) {
    for (const studentId of item.section.eligible_student_ids) {
      const member = membership.get(`${studentId}@${item.section.id}`);
      for (const [slotId, time] of Object.entries(item.variables)) {
        if (coreByStudent.get(studentId)?.has(slotId)) {
          model.addLessOrEqual(member.add(time), 1n);
          continue;
        }
        const attended = model.newBoolVar(`SEL_ATTEND_${studentId}_${item.section.id}_${item.occurrence}_${slotId}`);
        model.addLessOrEqual(attended, member);
        model.addLessOrEqual(attended, time);
        model.addGreaterOrEqual(attended, member.add(time).sub(1n));
        addAttendance(studentId, slotId, attended);
      }
    }
  }
  for (const vars of attendedByStudentSlot.values()) if (vars.length > 1) model.addLessOrEqual(sumVars(vars), 1n);

  // The next phase must still be able to place every fixed-membership core
  // section.  Reserve enough common free slots for its whole roster here;
  // without this bridge, a perfectly valid elective timetable can leave a
  // teaching class with no time at which all of its students are available.
  for (const coreSection of core.sections || []) {
    const freeBySlot = new Map();
    for (const slotId of slots) {
      const busy = [
        ...coreSection.student_ids.flatMap(studentId => attendedByStudentSlot.get(`${studentId}@${slotId}`) || []),
        ...(coreSection.teacher_id ? candidateBusyByTeacherSlot.get(`${coreSection.teacher_id}@${slotId}`) || [] : []),
        ...(coreSection.room_id ? candidateBusyByRoomSlot.get(`${coreSection.room_id}@${slotId}`) || [] : []),
      ];
      const free = model.newBoolVar(`CORE_FREE_${coreSection.id}_${slotId}`);
      for (const variable of busy) model.addLessOrEqual(free.add(variable), 1n);
      if (busy.length) model.addGreaterOrEqual(sumVars([...busy, free]), 1n);
      freeBySlot.set(slotId, free);
    }
    model.addGreaterOrEqual(sumVars([...freeBySlot.values()]), BigInt(coreSection.weekly_hours));
    if (coreSection.weekly_hours === 5) {
      for (let day = 1; day <= 5; day++) {
        const dayFree = slots.filter(slotId => slotDay(slotId) === day).map(slotId => freeBySlot.get(slotId));
        model.addGreaterOrEqual(sumVars(dayFree), 1n);
      }
    }
  }

  const solver = new CpSolver();
  solver.parameters.maxTimeInSeconds = options.maxTimeSeconds || 120;
  solver.parameters.numSearchWorkers = options.numSearchWorkers || 8;
  if (options.seed !== undefined) { solver.parameters.randomSeed = options.seed; solver.parameters.randomizeSearch = true; }
  const status = await solver.solve(model);
  const ok = status === CpSolverStatus.OPTIMAL || status === CpSolverStatus.FEASIBLE;
  if (!ok) return { ok: false, status, sections: candidateSections, meetings: [] };
  const allocated = candidateSections.map(section => ({ ...section, student_ids: [] }));
  const allocatedById = new Map(allocated.map(section => [section.id, section]));
  for (const section of candidateSections) for (const studentId of section.eligible_student_ids) {
    if (solver.booleanValue(membership.get(`${studentId}@${section.id}`))) allocatedById.get(section.id).student_ids.push(studentId);
  }
  const meetings = occurrences.map(item => ({ section_id: item.section.id, slot_id: Object.keys(item.variables).find(slotId => solver.booleanValue(item.variables[slotId])) }));
  return { ok: true, status, sections: allocated, meetings };
}

async function solveCoreThenSelections(state, options = {}) {
  const sections = buildSections(state);
  const coreSections = sections.filter(section => section.class_type === 'admin' || section.class_type === 'teaching');
  const candidates = sections.filter(section => section.class_type === 'ap' || section.class_type === 'elective');
  const fiveHourCoursesByStudent = new Map();
  for (const section of candidates.filter(section => section.weekly_hours === 5)) {
    for (const studentId of section.eligible_student_ids) {
      const courses = fiveHourCoursesByStudent.get(studentId) || new Set();
      courses.add(section.course_id); fiveHourCoursesByStudent.set(studentId, courses);
    }
  }
  // Every five-hour selected course meets once per day.  The core schedule
  // must leave that many daily spaces free before the optional layer is
  // solved; otherwise a random core timetable can be globally impossible.
  const maxCorePerDayByStudent = new Map(state.students.map(student => [
    student.id,
    10 - (fiveHourCoursesByStudent.get(student.id)?.size || 0),
  ]));
  const attempts = options.attempts || 12;
  let last;
  for (let attempt = 0; attempt < attempts; attempt++) {
    const seed = (options.seed || 20260730) + attempt * 7919;
    const core = await solveSectionTimetable(state, { ...options, sections: coreSections, randomSeed: seed, maxTimeSeconds: options.coreMaxTimeSeconds || 20, maxLessonsPerDayByStudent: maxCorePerDayByStudent });
    if (!core.ok) { last = core; continue; }
    const selections = await solveSelectionsOnCore(state, core, candidates, { ...options, seed, maxTimeSeconds: options.selectionMaxTimeSeconds || 120 });
    if (!selections.ok) { last = { ...selections, attempt: attempt + 1 }; continue; }
    const allSections = [...core.sections, ...selections.sections];
    const meetings = [...core.meetings, ...selections.meetings];
    return { ok: true, status: selections.status, sections: allSections, meetings, assignments: expandAssignments(allSections, meetings), attempts: attempt + 1,
      warnings: core.warnings };
  }
  return { ok: false, ...last, attempts };
}

/**
 * Reverse decomposition for the present school data.  G11 students have
 * exactly three daily AP periods, so a random core timetable leaves AP with
 * a brittle set of holes.  We first solve all optional section times and
 * memberships together, then fit the fixed-membership core classes into the
 * remaining student, teacher, and room availability.
 */
async function solveSelectionsThenCore(state, options = {}) {
  const sections = buildSections(state);
  const coreSections = sections.filter(section => section.class_type === 'admin' || section.class_type === 'teaching');
  const candidates = sections.filter(section => section.class_type === 'ap' || section.class_type === 'elective');
  const fixedCore = {
    sections: coreSections,
    meetings: coreSections.flatMap(section => fixedSlotsFor(section, options.rules)
      .map(slot_id => ({ section_id: section.id, slot_id }))),
  };
  const attempts = options.attempts || 12;
  let last;
  for (let attempt = 0; attempt < attempts; attempt++) {
    const seed = (options.seed || 20260730) + attempt * 7919;
    const selections = await solveSelectionsOnCore(state, fixedCore, candidates, { ...options, seed, maxTimeSeconds: options.selectionMaxTimeSeconds || 90 });
    if (!selections.ok) { last = selections; continue; }
    const blockedSlotsByStudent = new Map(), blockedSlotsByTeacher = new Map(), blockedSlotsByRoom = new Map();
    const sectionsById = new Map(selections.sections.map(section => [section.id, section]));
    const add = (map, id, slotId) => { if (!id) return; const values = map.get(id) || new Set(); values.add(slotId); map.set(id, values); };
    for (const meeting of selections.meetings) {
      const section = sectionsById.get(meeting.section_id);
      add(blockedSlotsByTeacher, section.teacher_id, meeting.slot_id);
      add(blockedSlotsByRoom, section.room_id, meeting.slot_id);
      for (const studentId of section.student_ids) add(blockedSlotsByStudent, studentId, meeting.slot_id);
    }
    const core = await solveSectionTimetable(state, {
      ...options,
      sections: coreSections,
      randomSeed: seed,
      maxTimeSeconds: options.coreMaxTimeSeconds || 30,
      blockedSlotsByStudent,
      blockedSlotsByTeacher,
      blockedSlotsByRoom,
    });
    if (!core.ok) { last = core; continue; }
    const allSections = [...core.sections, ...selections.sections];
    const meetings = [...core.meetings, ...selections.meetings];
    return { ok: true, status: core.status, sections: allSections, meetings, assignments: expandAssignments(allSections, meetings), attempts: attempt + 1, warnings: core.warnings };
  }
  return { ok: false, ...last, attempts };
}

/**
 * Full school pipeline: place all real sections with shared teacher/room
 * constraints, then solve the membership of students in the already-defined
 * multi-section elective classes.
 */
async function solveTwoStageWholeSchool(state, options = {}) {
  const templates = buildSections(state);
  const attempts = options.maxSectioningAttempts || 30;
  let lastResult;
  for (let attempt = 0; attempt < attempts; attempt++) {
    const seed = (options.seed || 20260730) + attempt * 7919;
    const orderedTemplates = [...templates].sort((left, right) => {
      const leftKey = seededKey(left.id, seed);
      const rightKey = seededKey(right.id, seed);
      return leftKey - rightKey || left.id.localeCompare(right.id);
    });
    const timetable = await solveSectionTimetable(state, {
      ...options,
      sections: orderedTemplates,
      ignoreStudentConflicts: true,
      randomSeed: seed,
    });
    if (!timetable.ok) {
      lastResult = timetable;
      continue;
    }
    const allocation = await assignStudentsToSections(state, orderedTemplates, timetable.meetings);
    if (!allocation.ok) {
      lastResult = { ok: false, status: allocation.status, sections: orderedTemplates, assignments: [], meetings: timetable.meetings, warnings: timetable.warnings,
        reason: 'SECTION_MEMBERSHIP_INFEASIBLE' };
      continue;
    }
    return {
      ok: true,
      status: timetable.status,
      sections: allocation.sections,
      meetings: timetable.meetings,
      assignments: expandAssignments(allocation.sections, timetable.meetings),
      warnings: timetable.warnings,
      attempts: attempt + 1,
    };
  }
  return { ...lastResult, attempts };
}

/**
 * Production model.  Unlike the legacy and transitional solvers, this model
 * chooses section meeting times and a student's membership in the school's
 * already-defined parallel sections at the same time.
 */
async function solveWholeSchool(state, options = {}) {
  const sections = buildSections(state);
  const slots = allSlots();
  const model = new CpModel();
  const occurrences = [];
  const candidateSections = sections.filter(section =>
    (section.class_type === 'ap' || section.class_type === 'elective') && section.eligible_student_ids?.length
  );
  const candidateSet = new Set(candidateSections);

  for (const section of sections) {
    const fixedSlots = fixedSlotsFor(section, options.rules);
    for (let occurrence = 0; occurrence < section.weekly_hours; occurrence++) {
      const allowed = occurrence < fixedSlots.length ? [fixedSlots[occurrence]]
        : section.weekly_hours === 5 ? slots.filter(slotId => slotDay(slotId) === occurrence + 1)
        : section.course_id === 'SELF_STUDY' ? slots.filter(slotId => slotPeriod(slotId) >= 6) : slots;
      const variables = {};
      for (const slotId of allowed) variables[slotId] = model.newBoolVar(`TIME_${section.id}_${occurrence}_${slotId}`);
      model.addEquality(sumVars(Object.values(variables)), 1n);
      occurrences.push({ section, variables });
    }
  }

  const occurrencesFor = section => occurrences.filter(item => item.section.id === section.id);
  for (const section of sections) {
    const own = occurrencesFor(section);
    for (const slotId of slots) {
      const vars = own.map(item => item.variables[slotId]).filter(Boolean);
      if (vars.length > 1) model.addLessOrEqual(sumVars(vars), 1n);
    }
    for (let day = 1; day <= 5; day++) {
      const vars = own.flatMap(item => slots.filter(slotId => slotDay(slotId) === day).map(slotId => item.variables[slotId]).filter(Boolean));
      if (section.weekly_hours <= 5 && vars.length > 1) model.addLessOrEqual(sumVars(vars), 1n);
      if (section.weekly_hours > 5 && vars.length > 1) model.addLessOrEqual(sumVars(vars), 2n);
    }
  }

  for (const slotId of slots) {
    const teachers = new Map(), rooms = new Map();
    for (const item of occurrences) {
      const variable = item.variables[slotId];
      if (!variable) continue;
      if (item.section.teacher_id) {
        const vars = teachers.get(item.section.teacher_id) || []; vars.push(variable); teachers.set(item.section.teacher_id, vars);
      }
      if (item.section.room_id) {
        const vars = rooms.get(item.section.room_id) || []; vars.push(variable); rooms.set(item.section.room_id, vars);
      }
    }
    for (const vars of teachers.values()) if (vars.length > 1) model.addLessOrEqual(sumVars(vars), 1n);
    for (const vars of rooms.values()) if (vars.length > 1) model.addLessOrEqual(sumVars(vars), 1n);
  }

  // Membership variables: exactly one of the school's already-open sections
  // for every selected course, with balanced section sizes.
  const membership = new Map();
  const choicesByStudent = new Map();
  for (const section of candidateSections) {
    for (const studentId of section.eligible_student_ids) {
      const variable = model.newBoolVar(`MEMBER_${studentId}_${section.id}`);
      membership.set(`${studentId}@${section.id}`, variable);
      const choices = choicesByStudent.get(studentId) || []; choices.push({ section, variable }); choicesByStudent.set(studentId, choices);
    }
  }
  for (const [studentId, choices] of choicesByStudent) {
    const byCourse = new Map();
    for (const choice of choices) { const vars = byCourse.get(choice.section.course_id) || []; vars.push(choice.variable); byCourse.set(choice.section.course_id, vars); }
    for (const vars of byCourse.values()) model.addEquality(sumVars(vars), 1n);
  }
  const byCourse = new Map();
  for (const section of candidateSections) {
    const cohortKey = `${section.course_id}@${section.cohort_id || 'ALL'}`;
    const list = byCourse.get(cohortKey) || []; list.push(section); byCourse.set(cohortKey, list);
  }
  for (const list of byCourse.values()) {
    const enrolled = [...new Set(list.flatMap(section => section.eligible_student_ids))];
    const min = Math.floor(enrolled.length / list.length), max = Math.ceil(enrolled.length / list.length);
    for (const section of list) {
      const vars = section.eligible_student_ids.map(studentId => membership.get(`${studentId}@${section.id}`));
      model.addGreaterOrEqual(sumVars(vars), BigInt(min));
      model.addLessOrEqual(sumVars(vars), BigInt(Math.min(max, section.capacity || max)));
    }
  }

  // A candidate student attends an occurrence exactly when both their section
  // membership and that occurrence's time slot are selected.
  const attendanceByStudentSlot = new Map();
  const addAttendance = (studentId, slotId, variable) => {
    const key = `${studentId}@${slotId}`; const vars = attendanceByStudentSlot.get(key) || []; vars.push(variable); attendanceByStudentSlot.set(key, vars);
  };
  for (const item of occurrences) {
    const isCandidate = candidateSet.has(item.section);
    const members = isCandidate ? item.section.eligible_student_ids : item.section.student_ids;
    for (const studentId of members) {
      for (const [slotId, timeVariable] of Object.entries(item.variables)) {
        if (!isCandidate) { addAttendance(studentId, slotId, timeVariable); continue; }
        const memberVariable = membership.get(`${studentId}@${item.section.id}`);
        const attended = model.newBoolVar(`ATTEND_${studentId}_${item.section.id}_${slotId}`);
        model.addLessOrEqual(attended, memberVariable);
        model.addLessOrEqual(attended, timeVariable);
        model.addGreaterOrEqual(attended, memberVariable.add(timeVariable).sub(1n));
        addAttendance(studentId, slotId, attended);
      }
    }
  }
  for (const vars of attendanceByStudentSlot.values()) if (vars.length > 1) model.addLessOrEqual(sumVars(vars), 1n);

  const solver = new CpSolver();
  solver.parameters.maxTimeInSeconds = options.maxTimeSeconds || 120;
  solver.parameters.numSearchWorkers = options.numSearchWorkers || 8;
  if (options.seed !== undefined) { solver.parameters.randomSeed = options.seed; solver.parameters.randomizeSearch = true; }
  const status = await solver.solve(model);
  const ok = status === CpSolverStatus.OPTIMAL || status === CpSolverStatus.FEASIBLE;
  const warnings = sections.filter(section => section.teacher_assignment_warning).map(section => section.teacher_assignment_warning);
  if (!ok) return { ok: false, status, sections, assignments: [], warnings };

  const allocated = sections.map(section => ({ ...section, student_ids: candidateSet.has(section) ? [] : [...section.student_ids] }));
  const allocatedById = new Map(allocated.map(section => [section.id, section]));
  for (const section of candidateSections) for (const studentId of section.eligible_student_ids) {
    if (solver.booleanValue(membership.get(`${studentId}@${section.id}`))) allocatedById.get(section.id).student_ids.push(studentId);
  }
  const meetings = occurrences.map(item => ({ section_id: item.section.id, slot_id: Object.keys(item.variables).find(slotId => solver.booleanValue(item.variables[slotId])) }));
  return { ok: true, status, sections: allocated, meetings, assignments: expandAssignments(allocated, meetings), warnings };
}

module.exports = { buildSections, solveSectionTimetable, assignStudentsToSections, solveWholeSchool, solveTwoStageWholeSchool, solveCoreThenSelections, solveSelectionsOnCore, solveSelectionsThenCore };
