import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

function text(value) {
  return String(value ?? '').trim();
}

function integer(value, label, { minimum, maximum }) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${label}必须是 ${minimum}–${maximum} 范围内的整数`);
  }
  return parsed;
}

function timeMinutes(value, label) {
  const match = /^(\d{2}):(\d{2})$/.exec(text(value));
  if (!match) throw new Error(`${label}必须使用 HH:MM 格式`);
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) throw new Error(`${label}不是有效时间`);
  return hours * 60 + minutes;
}

function courseGrades(course) {
  const source = Array.isArray(course?.grade) ? course.grade : [course?.grade];
  return source.map(Number).filter(Number.isInteger);
}

function examGrades(rawExam) {
  const source = rawExam?.grades ?? rawExam?.grade;
  if (source === undefined || source === null || source === '') return [];
  const values = Array.isArray(source) ? source : [source];
  return [...new Set(values.map(Number).filter(Number.isInteger))].sort((left, right) => left - right);
}

const SECOND_FOREIGN_LANGUAGE_SUBJECT_IDS = new Set(['FRENCH', 'GERMAN', 'JAPANESE']);
const COMBINED_CHIEF_INVIGILATOR_MODE = 'single_teacher_combined_chief_invigilator';
const EXAM_STAFF_GROUP_LABELS = Object.freeze({
  ansheng: '安生教师',
  director: '主任',
  homeroom: '班主任',
  experimental: '实验教师',
});

export function examStaffProfileForTeacher(teacher = {}) {
  const explicitValue = text(teacher.exam_staff_group).toLowerCase();
  const explicitAliases = {
    ansheng: 'ansheng',
    安生教师: 'ansheng',
    director: 'director',
    主任: 'director',
    homeroom: 'homeroom',
    班主任: 'homeroom',
    experimental: 'experimental',
    实验教师: 'experimental',
  };
  const id = text(teacher.id).toUpperCase();
  const name = text(teacher.name);
  const group = explicitAliases[explicitValue]
    || (id === 'T_JIZHUREN' || name === '季主任' ? 'director' : null)
    || (id.includes('HOMEROOM') || name.includes('班主任') ? 'homeroom' : null)
    || (/^T_EXP(?:_|$)/.test(id) || name.startsWith('实验教师') ? 'experimental' : null)
    || 'ansheng';
  const isGuidanceCounselor = id === 'T_GUIDANCE' || name === '升学顾问';
  const invigilationExemptionReason = group === 'ansheng' && isGuidanceCounselor
    ? '升学顾问不参加监考'
    : null;
  return {
    exam_staff_group: group,
    exam_staff_group_name: EXAM_STAFF_GROUP_LABELS[group],
    invigilation_eligible: group === 'ansheng' && !invigilationExemptionReason,
    invigilation_exemption_reason: invigilationExemptionReason,
  };
}

function isSecondForeignLanguageExam(rawExam, course) {
  const signature = [
    rawExam?.subject_id,
    rawExam?.course_name,
    rawExam?.name,
    course?.name,
  ].map(text).join(' ').toUpperCase();
  return /二外|SECOND[ _-]*FOREIGN[ _-]*LANGUAGE/.test(signature);
}

function isCombinedChiefInvigilatorExam(exam) {
  return exam?.staffing_mode === COMBINED_CHIEF_INVIGILATOR_MODE;
}

function normalizedSubjectId(value) {
  return text(value).toUpperCase().replace(/[^A-Z0-9\u3400-\u9FFF]+/g, '_').replace(/^_+|_+$/g, '');
}

function examSubjectIdForCourse(course) {
  const explicit = normalizedSubjectId(course?.subject_id || course?.subject);
  if (explicit) return explicit;
  const signature = `${course?.id || ''} ${course?.name || ''}`.toUpperCase();
  if (/(?:AP_ARTHIST|ART[ _-]?HIST|艺术史)/.test(signature)) return 'ART_HISTORY';
  if (/(?:AP_ENVSCI|ENVIRONMENTAL|环境科学)/.test(signature)) return 'ENVIRONMENTAL_SCIENCE';
  if (/(?:AP_CS\b|COMPUTER|计算机|信息技术|\bIT\b)/.test(signature)) return 'COMPUTER_SCIENCE';
  if (/(?:^|[ _-])(?:ENG|ENGLISH)(?:[ _-]|$)|TOEFL|GRAMMAR|LITERATURE|\bLIT\b|\bLANG\b|(?:HONOR|AP)[ _-]?LC|语法|英美/.test(signature)) return 'ENGLISH';
  if (/(?:MATH|CALC|CALCULUS|STATISTICS|\bSTAT\b|ALGEBRA|\bALG\b|数学|代数)/.test(signature)) return 'MATHEMATICS';
  if (/(?:PHYS|PHYSICS|物理|力学)/.test(signature)) return 'PHYSICS';
  if (/(?:CHEM|CHEMISTRY|化学)/.test(signature)) return 'CHEMISTRY';
  if (/(?:BIO|BIOLOGY|生物)/.test(signature)) return 'BIOLOGY';
  if (/(?:CHIN|CHINESE|语文)/.test(signature)) return 'CHINESE';
  if (/(?:JAPANESE|日语)/.test(signature)) return 'JAPANESE';
  if (/(?:FRENCH|法语)/.test(signature)) return 'FRENCH';
  if (/(?:GERMAN|德语)/.test(signature)) return 'GERMAN';
  if (/(?:AP_PSYCH|PSYCHOLOGY|心理)/.test(signature)) return 'PSYCHOLOGY';
  if (/(?:AP_MACRO|AP_MICRO|ECONOMICS|经济)/.test(signature)) return 'ECONOMICS';
  if (/(?:BUSINESS|商业)/.test(signature)) return 'BUSINESS';
  if (/(?:HIST|HISTORY|历史)/.test(signature)) return 'HISTORY';
  if (/(?:GEOG|GEOGRAPHY|地理)/.test(signature)) return 'GEOGRAPHY';
  if (/(?:\bPOL\b|POLITICS|政治)/.test(signature)) return 'POLITICS';
  if (/(?:\bART\b|美术)/.test(signature)) return 'ART';
  if (/(?:(?:^|[ _-])PE(?:[ _-]|$)|PHYSICAL EDUCATION|体育)/.test(signature)) return 'PHYSICAL_EDUCATION';
  return `COURSE_${normalizedSubjectId(course?.id)}`;
}

function selectedCourseIds(student) {
  const flatten = value => Array.isArray(value)
    ? value.flatMap(flatten)
    : value === undefined || value === null
      ? []
      : [value];
  return new Set(flatten([
    student.ap_courses,
    student.elective_courses,
    Object.values(student.elective_choices || {}),
    student.courses,
    student.required_courses,
  ]).map(text).filter(Boolean));
}

function courseAppliesToStudent(course, student) {
  const grades = courseGrades(course);
  if (grades.length && !grades.includes(Number(student.grade))) return false;
  if (Array.isArray(course.applicable_class_ids) && course.applicable_class_ids.length) {
    return course.applicable_class_ids.includes(student.teaching_class_id)
      || course.applicable_class_ids.includes(student.admin_class_id);
  }
  return true;
}

function examStudentIds(state, course, rawExam) {
  const students = state.students || [];
  const rosterMode = rawExam.roster_mode === 'derived'
    ? 'derived'
    : rawExam.roster_mode === 'explicit' || rawExam.student_ids !== undefined
      ? 'explicit'
      : 'derived';
  if (rosterMode === 'explicit') {
    if (!Array.isArray(rawExam.student_ids)) throw new Error(`考试 ${rawExam.id} 的考生必须是学生 ID 数组`);
    const known = new Set(students.map(student => student.id));
    const ids = [...new Set(rawExam.student_ids.map(text).filter(Boolean))].sort();
    const missing = ids.filter(id => !known.has(id));
    if (missing.length) throw new Error(`考试 ${rawExam.id} 引用了不存在的学生: ${missing.join('、')}`);
    return ids;
  }
  const scopedGrades = examGrades(rawExam);
  const applicable = students.filter(student => courseAppliesToStudent(course, student))
    .filter(student => !scopedGrades.length || scopedGrades.includes(Number(student.grade)));
  const participants = course.type === 'required'
    ? applicable
    : applicable.filter(student => selectedCourseIds(student).has(course.id));
  return participants.map(student => student.id).sort();
}

function secondForeignLanguageCourseIds(state, grades) {
  return (state.courses || [])
    .filter(course => SECOND_FOREIGN_LANGUAGE_SUBJECT_IDS.has(examSubjectIdForCourse(course)))
    .filter(course => {
      const targetGrades = courseGrades(course);
      return !grades.length || !targetGrades.length || targetGrades.some(grade => grades.includes(grade));
    })
    .map(course => course.id)
    .sort();
}

function secondForeignLanguageStudentIds(state, course, rawExam, componentCourseIds) {
  const explicitRoster = rawExam.roster_mode === 'explicit'
    || (rawExam.roster_mode !== 'derived' && rawExam.student_ids !== undefined);
  if (explicitRoster) {
    return examStudentIds(state, course, rawExam);
  }
  const grades = examGrades(rawExam);
  const componentIds = new Set(componentCourseIds);
  return (state.students || [])
    .filter(student => !grades.length || grades.includes(Number(student.grade)))
    .filter(student => [...selectedCourseIds(student)].some(courseId => componentIds.has(courseId)))
    .map(student => student.id)
    .sort();
}

function roomName(index) {
  let value = index + 1;
  let suffix = '';
  while (value > 0) {
    value -= 1;
    suffix = String.fromCharCode(65 + (value % 26)) + suffix;
    value = Math.floor(value / 26);
  }
  return `考场 ${suffix}`;
}

function normalizeConfig(raw = {}) {
  const slotMinutes = integer(raw.slot_minutes ?? 30, '最小排考时间单位', { minimum: 5, maximum: 60 });
  if (60 % slotMinutes !== 0) throw new Error('最小排考时间单位必须能整除 60 分钟');
  const minimumExamGapMinutes = integer(raw.minimum_exam_gap_minutes ?? 15, '考试间最短休息时间', { minimum: 10, maximum: 120 });
  const longestExamGapMinutes = integer(raw.longest_exam_gap_minutes ?? 30, '最长考试后休息时间', { minimum: 10, maximum: 120 });
  if (longestExamGapMinutes < minimumExamGapMinutes) {
    throw new Error('最长考试后的休息时间不能短于普通考试休息时间');
  }
  const fallbackDayCount = integer(raw.day_count ?? 4, '考试天数', { minimum: 3, maximum: 5 });
  if (raw.grade_day_counts !== undefined
    && (!raw.grade_day_counts || typeof raw.grade_day_counts !== 'object' || Array.isArray(raw.grade_day_counts))) {
    throw new Error('分年级考试天数必须是对象');
  }
  const rawGradeDayCounts = raw.grade_day_counts || {};
  const gradeDayCounts = Object.fromEntries([10, 11, 12].map(grade => [
    grade,
    integer(
      rawGradeDayCounts[grade] ?? fallbackDayCount,
      `高${grade - 9}考试天数`,
      { minimum: 3, maximum: 5 },
    ),
  ]));
  const dayCount = Math.max(...Object.values(gradeDayCounts));
  const roomCapacity = integer(raw.room_capacity ?? 30, '单考场容量上限', { minimum: 1, maximum: 200 });
  const configuredRooms = Array.isArray(raw.rooms) ? raw.rooms : null;
  const roomCount = configuredRooms
    ? configuredRooms.length
    : integer(raw.room_count ?? 10, '同时可用考场上限', { minimum: 1, maximum: 100 });
  if (roomCount < 1) throw new Error('至少需要一个考场');
  const rooms = configuredRooms
    ? configuredRooms.map((room, index) => ({
      id: text(room?.id) || `EXAM_ROOM_${index + 1}`,
      name: text(room?.name) || roomName(index),
      capacity: integer(room?.capacity ?? roomCapacity, `第 ${index + 1} 个考场容量`, { minimum: 1, maximum: 200 }),
    }))
    : Array.from({ length: roomCount }, (_, index) => ({
      id: `EXAM_ROOM_${index + 1}`,
      name: roomName(index),
      capacity: roomCapacity,
    }));
  if (new Set(rooms.map(room => room.id)).size !== rooms.length) throw new Error('考场 ID 不能重复');

  const dayStart = text(raw.day_start || '08:00');
  const dayEnd = text(raw.day_end || '17:30');
  if (timeMinutes(dayStart, '每日开始时间') >= timeMinutes(dayEnd, '每日结束时间')) {
    throw new Error('每日结束时间必须晚于开始时间');
  }
  const breaks = raw.breaks === undefined
    ? [{ start: '12:00', end: '13:30', label: '午休' }]
    : raw.breaks;
  if (!Array.isArray(breaks)) throw new Error('停考时段必须是数组');
  const normalizedBreaks = breaks.map((item, index) => {
    const start = text(item?.start);
    const end = text(item?.end);
    if (timeMinutes(start, `第 ${index + 1} 个停考时段开始时间`)
      >= timeMinutes(end, `第 ${index + 1} 个停考时段结束时间`)) {
      throw new Error(`第 ${index + 1} 个停考时段结束时间必须晚于开始时间`);
    }
    return { start, end, label: text(item?.label) || `停考时段 ${index + 1}` };
  });
  return {
    timetable_only: raw.timetable_only === true,
    day_count: dayCount,
    grade_day_counts: gradeDayCounts,
    day_labels: Array.from({ length: dayCount }, (_, index) => text(raw.day_labels?.[index]) || `第 ${index + 1} 天`),
    start_date: text(raw.start_date) || null,
    slot_minutes: slotMinutes,
    minimum_exam_gap_minutes: minimumExamGapMinutes,
    longest_exam_gap_minutes: longestExamGapMinutes,
    day_start: dayStart,
    day_end: dayEnd,
    breaks: normalizedBreaks,
    rooms,
    room_capacity: roomCapacity,
    invigilators_per_room: integer(raw.invigilators_per_room ?? 1, '每考场监考人数', { minimum: 1, maximum: 4 }),
    require_every_teacher_invigilates: raw.require_every_teacher_invigilates !== false,
  };
}

export function normalizeExamPlan(state = {}, raw = {}) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('考试计划必须是对象');
  const config = normalizeConfig(raw.config || {});
  if (!Array.isArray(raw.exams)) throw new Error('考试计划 exams 必须是数组');
  const courses = new Map((state.courses || []).map(course => [course.id, course]));
  const ids = new Set();
  const exams = raw.exams.map((rawExam, index) => {
    const id = text(rawExam?.id) || `EXAM_${index + 1}`;
    if (ids.has(id)) throw new Error(`考试 ID 重复: ${id}`);
    ids.add(id);
    const courseId = text(rawExam?.course_id);
    const course = courses.get(courseId);
    if (!course) throw new Error(`考试 ${id} 引用了不存在的课程 ${courseId || '（空）'}`);
    const durationMinutes = integer(rawExam.duration_minutes, `考试 ${id} 时长`, { minimum: config.slot_minutes, maximum: 240 });
    if (durationMinutes % config.slot_minutes !== 0) {
      throw new Error(`考试 ${id} 时长必须是 ${config.slot_minutes} 分钟的整数倍`);
    }
    const rosterMode = rawExam.roster_mode === 'derived'
      ? 'derived'
      : rawExam.roster_mode === 'explicit' || rawExam.student_ids !== undefined
        ? 'explicit'
        : 'derived';
    const grades = examGrades(rawExam).length ? examGrades(rawExam) : courseGrades(course);
    const secondForeignLanguage = isSecondForeignLanguageExam(rawExam, course);
    const componentCourseIds = secondForeignLanguage
      ? secondForeignLanguageCourseIds(state, grades)
      : [];
    const studentIds = secondForeignLanguage
      ? secondForeignLanguageStudentIds(
        state,
        course,
        { ...rawExam, id, roster_mode: rosterMode },
        componentCourseIds,
      )
      : examStudentIds(state, course, { ...rawExam, id, roster_mode: rosterMode });
    return {
      id,
      course_id: course.id,
      course_name: text(rawExam.course_name || rawExam.name) || course.name || course.id,
      subject_id: secondForeignLanguage
        ? 'SECOND_FOREIGN_LANGUAGE'
        : normalizedSubjectId(rawExam.subject_id) || examSubjectIdForCourse(course),
      ...(secondForeignLanguage ? {
        component_course_ids: componentCourseIds,
        staffing_mode: COMBINED_CHIEF_INVIGILATOR_MODE,
      } : {}),
      ...(grades.length ? { grades } : {}),
      ...(text(rawExam.source_duration) ? { source_duration: text(rawExam.source_duration) } : {}),
      roster_mode: rosterMode,
      duration_minutes: durationMinutes,
      duration_units: durationMinutes / config.slot_minutes,
      student_ids: studentIds,
      student_count: studentIds.length,
    };
  });
  return { version: 1, config, exams };
}

function preservedExamRow(rawExam, index, config) {
  const source = rawExam && typeof rawExam === 'object' && !Array.isArray(rawExam) ? rawExam : {};
  const durationMinutes = Number(source.duration_minutes);
  const studentIds = Array.isArray(source.student_ids) ? [...source.student_ids] : [];
  return {
    ...structuredClone(source),
    id: text(source.id) || `EXAM_${index + 1}`,
    course_id: text(source.course_id),
    course_name: text(source.course_name) || text(source.course_id),
    subject_id: normalizedSubjectId(source.subject_id),
    duration_minutes: Number.isFinite(durationMinutes) ? durationMinutes : config.slot_minutes,
    duration_units: Number.isFinite(durationMinutes) ? durationMinutes / config.slot_minutes : 1,
    student_ids: studentIds,
    student_count: Number.isInteger(Number(source.student_count))
      ? Number(source.student_count)
      : studentIds.length,
  };
}

export function examPlanForEditing(state = {}, raw = {}) {
  try {
    return { plan: normalizeExamPlan(state, raw), issues: [] };
  } catch {
    // A saved plan can become stale after courses or students change. Rebuild
    // valid rows independently while preserving invalid rows for removal/editing.
  }

  const issues = [];
  const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  let config;
  try {
    config = normalizeConfig(source.config || {});
  } catch (error) {
    config = normalizeConfig({});
    issues.push({ code: 'INVALID_EXAM_CONFIG', message: error.message });
  }
  const rawExams = Array.isArray(source.exams) ? source.exams : [];
  if (!Array.isArray(source.exams)) {
    issues.push({ code: 'INVALID_EXAM_PLAN', message: '考试计划 exams 必须是数组' });
  }
  const courses = new Set((state.courses || []).map(course => course.id));
  const seenIds = new Set();
  const exams = rawExams.map((rawExam, index) => {
    const preserved = preservedExamRow(rawExam, index, config);
    if (seenIds.has(preserved.id)) {
      issues.push({
        code: 'DUPLICATE_EXAM_ID',
        exam_id: preserved.id,
        message: `考试 ID 重复: ${preserved.id}`,
      });
      return preserved;
    }
    seenIds.add(preserved.id);
    if (!courses.has(preserved.course_id)) {
      issues.push({
        code: 'UNKNOWN_EXAM_COURSE',
        exam_id: preserved.id,
        course_id: preserved.course_id,
        message: `考试 ${preserved.id} 引用了不存在的课程 ${preserved.course_id || '（空）'}`,
      });
      return preserved;
    }
    try {
      return normalizeExamPlan(state, { config, exams: [rawExam] }).exams[0];
    } catch (error) {
      issues.push({
        code: 'INVALID_EXAM',
        exam_id: preserved.id,
        course_id: preserved.course_id,
        message: error.message,
      });
      return preserved;
    }
  });
  return { plan: { version: 1, config, exams }, issues };
}

function timeline(config, exams = []) {
  const dayStartMinutes = timeMinutes(config.day_start, '每日开始时间');
  const dayEndMinutes = timeMinutes(config.day_end, '每日结束时间');
  const dayDuration = dayEndMinutes - dayStartMinutes;
  if (dayDuration % config.slot_minutes !== 0) {
    throw new Error(`每日考试时间必须按 ${config.slot_minutes} 分钟对齐`);
  }
  const unitsPerDay = dayDuration / config.slot_minutes;
  const minimumExamGapUnits = Math.ceil(config.minimum_exam_gap_minutes / config.slot_minutes);
  const longestExamGapUnits = Math.ceil(config.longest_exam_gap_minutes / config.slot_minutes);
  const longestExamDurationMinutes = Math.max(0, ...exams.map(exam => exam.duration_minutes));
  const gapUnitsForExam = exam => exam.duration_minutes === longestExamDurationMinutes
    ? longestExamGapUnits
    : minimumExamGapUnits;
  const solverDayStride = unitsPerDay + Math.max(minimumExamGapUnits, longestExamGapUnits);
  const breaks = config.breaks.map(item => {
    const start = timeMinutes(item.start, '停考时段开始时间');
    const end = timeMinutes(item.end, '停考时段结束时间');
    if (start < dayStartMinutes || end > dayEndMinutes) throw new Error('停考时段必须位于每日考试时间内');
    if ((start - dayStartMinutes) % config.slot_minutes !== 0
      || (end - dayStartMinutes) % config.slot_minutes !== 0) {
      throw new Error(`停考时段必须按 ${config.slot_minutes} 分钟对齐`);
    }
    return {
      start_unit: (start - dayStartMinutes) / config.slot_minutes,
      end_unit: (end - dayStartMinutes) / config.slot_minutes,
    };
  });
  const collectAllowedStarts = (durationUnits, dayStride, dayCount = config.day_count) => {
    const starts = [];
    for (let day = 0; day < dayCount; day += 1) {
      for (let unit = 0; unit + durationUnits <= unitsPerDay; unit += 1) {
        const end = unit + durationUnits;
        if (breaks.some(item => unit < item.end_unit && item.start_unit < end)) continue;
        starts.push(day * dayStride + unit);
      }
    }
    return starts;
  };
  return {
    dayStartMinutes,
    unitsPerDay,
    minimumExamGapUnits,
    longestExamGapUnits,
    longestExamDurationMinutes,
    gapUnitsForExam,
    solverDayStride,
    solverHorizon: (config.day_count - 1) * solverDayStride + unitsPerDay,
    allowedStarts: (durationUnits, dayCount) => collectAllowedStarts(durationUnits, unitsPerDay, dayCount),
    solverStarts: (durationUnits, dayCount) => collectAllowedStarts(durationUnits, solverDayStride, dayCount),
  };
}

function dayCountForExam(config, exam) {
  const gradeDayCounts = (exam.grades || [])
    .map(grade => config.grade_day_counts?.[grade])
    .filter(Number.isInteger);
  return gradeDayCounts.length ? Math.min(...gradeDayCounts) : config.day_count;
}

function minutesLabel(totalMinutes) {
  const normalized = ((totalMinutes % 1440) + 1440) % 1440;
  return `${String(Math.floor(normalized / 60)).padStart(2, '0')}:${String(normalized % 60).padStart(2, '0')}`;
}

function allocateStudentsToRooms(studentIds, rooms) {
  const counts = rooms.map(() => 0);
  for (let studentIndex = 0; studentIndex < studentIds.length; studentIndex += 1) {
    let target = -1;
    for (let roomIndex = 0; roomIndex < rooms.length; roomIndex += 1) {
      if (counts[roomIndex] >= rooms[roomIndex].capacity) continue;
      if (target < 0 || counts[roomIndex] < counts[target]) target = roomIndex;
    }
    if (target < 0) throw new Error('已选考场总容量不足以安排全部考生');
    counts[target] += 1;
  }
  let offset = 0;
  return rooms.map((room, index) => {
    const count = counts[index];
    const assigned = studentIds.slice(offset, offset + count);
    offset += assigned.length;
    return {
      room_id: room.id,
      room_name: room.name,
      capacity: room.capacity,
      student_ids: assigned,
      seats: assigned.map((studentId, seatIndex) => ({
        seat_number: seatIndex + 1,
        student_id: studentId,
      })),
      invigilator_teacher_ids: [],
    };
  });
}

function relationGrades(state, relation = {}) {
  const explicit = examGrades(relation);
  if (explicit.length) return explicit;
  const classGrades = new Map([
    ...(state.admin_classes || []).map(item => [item.id, Number(item.grade)]),
    ...(state.teaching_classes || []).map(item => [item.id, Number(item.grade)]),
  ]);
  const classIds = Array.isArray(relation.class_ids)
    ? relation.class_ids
    : relation.class_id ? [relation.class_id] : [];
  const fromClasses = classIds.map(classId => classGrades.get(classId)).filter(Number.isInteger);
  if (fromClasses.length) return [...new Set(fromClasses)].sort((left, right) => left - right);
  const students = new Map((state.students || []).map(student => [student.id, student]));
  const fromStudents = (relation.student_ids || [])
    .map(studentId => Number(students.get(studentId)?.grade))
    .filter(Number.isInteger);
  return [...new Set(fromStudents)].sort((left, right) => left - right);
}

function gradesOverlap(left = [], right = []) {
  return !left.length || !right.length || left.some(grade => right.includes(grade));
}

function actualTeacherIdsForCourses(state, courseIds, grades = []) {
  const knownTeacherIds = new Set((state.teachers || []).map(teacher => teacher.id));
  const teacherIds = new Set();
  for (const courseId of new Set(courseIds)) {
    const course = (state.courses || []).find(item => item.id === courseId);
    const sourceGroups = [
      state.teaching_assignments || [],
      state.solve_status === 'valid' ? state.schedule?.sections || [] : [],
      state.section_plan?.sections || [],
      state.teaching_tasks || [],
      (course?.section_requirements || []).map(requirement => ({ ...requirement, course_id: courseId })),
    ];
    for (const relations of sourceGroups) {
      const matches = relations.filter(relation => relation?.course_id === courseId
        && relation.teacher_id
        && knownTeacherIds.has(relation.teacher_id)
        && gradesOverlap(grades, relationGrades(state, relation)));
      if (!matches.length) continue;
      for (const relation of matches) teacherIds.add(relation.teacher_id);
      break;
    }
  }
  return [...teacherIds].sort();
}

function actualTeacherIdsForExam(state, exam) {
  const courseIds = isCombinedChiefInvigilatorExam(exam)
    ? exam.component_course_ids || []
    : [exam.course_id];
  return actualTeacherIdsForCourses(state, courseIds, exam.grades || []);
}

function minimumRoomsForStudents(rooms, studentCount) {
  let capacity = 0;
  let count = 0;
  for (const room of [...rooms].sort((left, right) => right.capacity - left.capacity)) {
    capacity += room.capacity;
    count += 1;
    if (capacity >= studentCount) return count;
  }
  return Infinity;
}

function sessionsOverlap(left, right) {
  return left.global_start_unit < right.global_start_unit + right.duration_units
    && right.global_start_unit < left.global_start_unit + left.duration_units;
}

function gapUnitsBetweenSessions(left, right, unitsPerDay) {
  const leftDay = Math.floor(left.global_start_unit / unitsPerDay);
  const rightDay = Math.floor(right.global_start_unit / unitsPerDay);
  if (leftDay !== rightDay) return Infinity;
  if (left.global_start_unit <= right.global_start_unit) {
    return right.global_start_unit - (left.global_start_unit + left.duration_units);
  }
  return left.global_start_unit - (right.global_start_unit + right.duration_units);
}

export function validateExamSchedule(state = {}, rawPlan = {}, schedule = {}) {
  const plan = rawPlan?.version === 1 ? normalizeExamPlan(state, rawPlan) : normalizeExamPlan(state, rawPlan);
  const timetableOnly = plan.config.timetable_only;
  const time = timeline(plan.config, plan.exams);
  const exams = new Map(plan.exams.map(exam => [exam.id, exam]));
  const rooms = new Map(plan.config.rooms.map(room => [room.id, room]));
  const teachers = new Map((timetableOnly ? [] : state.teachers || []).map(teacher => [teacher.id, teacher]));
  const invigilatorTeacherIds = new Set([...teachers.values()]
    .filter(teacher => examStaffProfileForTeacher(teacher).invigilation_eligible)
    .map(teacher => teacher.id));
  const courses = new Map((state.courses || []).map(course => [course.id, course]));
  const violations = [];
  const warnings = [];
  const sessions = Array.isArray(schedule.sessions) ? schedule.sessions : [];
  const sessionsByExam = new Map();

  for (const session of sessions) {
    const exam = exams.get(session.exam_id);
    if (!exam) {
      violations.push({ code: 'UNKNOWN_EXAM', message: `排考结果引用了不存在的考试 ${session.exam_id}` });
      continue;
    }
    if (sessionsByExam.has(exam.id)) {
      violations.push({ code: 'DUPLICATE_EXAM_SESSION', message: `考试 ${exam.course_name} 被安排了多次` });
      continue;
    }
    sessionsByExam.set(exam.id, session);
    const globalStart = Number(session.global_start_unit);
    const examDayCount = dayCountForExam(plan.config, exam);
    const scheduledDayIndex = Number.isInteger(globalStart)
      ? Math.floor(globalStart / time.unitsPerDay)
      : null;
    const allowed = new Set(time.allowedStarts(exam.duration_units, examDayCount));
    if (scheduledDayIndex !== null
      && (exam.grades || []).length
      && scheduledDayIndex >= examDayCount) {
      const limitingGrades = (exam.grades || [])
        .filter(grade => plan.config.grade_day_counts[grade] === examDayCount)
        .map(grade => `高${grade - 9}`)
        .join('、');
      violations.push({
        code: 'GRADE_DAY_LIMIT_EXCEEDED',
        message: `${exam.course_name} 被安排在第 ${scheduledDayIndex + 1} 天，超出${limitingGrades || '参与年级'}设置的 ${examDayCount} 天范围`,
        exam_id: exam.id,
        grades: exam.grades || [],
      });
    } else if (!Number.isInteger(globalStart) || !allowed.has(globalStart)) {
      violations.push({ code: 'INVALID_EXAM_TIME', message: `考试 ${exam.course_name} 的时间超出可用窗口或跨越停考时段` });
    }

    const chiefTeacherIds = Array.isArray(session.chief_teacher_ids)
      ? session.chief_teacher_ids.map(text).filter(Boolean)
      : [];
    const combinedChiefInvigilator = !timetableOnly && isCombinedChiefInvigilatorExam(exam);
    const actualTeacherIds = timetableOnly ? [] : actualTeacherIdsForExam(state, exam);
    if (combinedChiefInvigilator) {
      const teacherId = chiefTeacherIds[0];
      if (chiefTeacherIds.length !== 1) {
        violations.push({
          code: 'SECOND_LANGUAGE_STAFF_COUNT',
          message: `考试 ${exam.course_name} 必须恰好由 1 名教师同时担任巡考和监考`,
        });
      } else if (!teachers.has(teacherId)) {
        violations.push({ code: 'UNKNOWN_CHIEF_TEACHER', message: `考试 ${exam.course_name} 引用了不存在的教师 ${teacherId}` });
      } else if (!actualTeacherIds.includes(teacherId)) {
        violations.push({
          code: 'INVALID_SECOND_LANGUAGE_TEACHER',
          message: `教师 ${teacherId} 没有实际教授法语、日语或德语，不能承担 ${exam.course_name} 的合并任务`,
        });
      } else if (!invigilatorTeacherIds.has(teacherId)) {
        const exemptionReason = examStaffProfileForTeacher(teachers.get(teacherId)).invigilation_exemption_reason;
        violations.push({
          code: 'INELIGIBLE_SECOND_LANGUAGE_INVIGILATOR',
          message: `教师 ${teacherId} 不具备监考资格${exemptionReason ? `（${exemptionReason}）` : ''}，不能承担 ${exam.course_name} 的监考任务`,
        });
      }
    } else if (teachers.size) {
      if (!actualTeacherIds.length) {
        violations.push({
          code: 'MISSING_CHIEF_TEACHER',
          message: `考试 ${exam.course_name} 没有配置教授课程 ${exam.course_id} 的实际任课教师`,
        });
      }
      if (chiefTeacherIds.length !== 1) {
        violations.push({
          code: 'CHIEF_TEACHER_COUNT',
          message: `考试 ${exam.course_name} 必须恰好安排 1 位巡考教师`,
        });
      }
      for (const teacherId of chiefTeacherIds) {
        if (!teachers.has(teacherId)) {
          violations.push({ code: 'UNKNOWN_CHIEF_TEACHER', message: `考试 ${exam.course_name} 引用了不存在的主考教师 ${teacherId}` });
        } else if (!actualTeacherIds.includes(teacherId)) {
          violations.push({ code: 'INVALID_CHIEF_TEACHER', message: `教师 ${teacherId} 没有实际教授课程 ${exam.course_id}，不能巡考 ${exam.course_name}` });
        }
      }
    }

    const allocations = Array.isArray(session.room_allocations) ? session.room_allocations : [];
    const seated = [];
    const combinedTeacherId = combinedChiefInvigilator ? chiefTeacherIds[0] : null;
    let combinedTeacherRoomCount = 0;
    const invigilationRoomsByTeacher = new Map();
    for (const allocation of allocations) {
      const room = rooms.get(allocation.room_id);
      if (!room) {
        violations.push({ code: 'UNKNOWN_EXAM_ROOM', message: `考试 ${exam.course_name} 引用了不存在的考场 ${allocation.room_id}` });
        continue;
      }
      const studentIds = Array.isArray(allocation.student_ids) ? allocation.student_ids : [];
      seated.push(...studentIds);
      if (studentIds.length > room.capacity) {
        violations.push({ code: 'EXAM_ROOM_CAPACITY', message: `${room.name} 安排了 ${studentIds.length} 人，超过容量 ${room.capacity}` });
      }
      const seats = Array.isArray(allocation.seats) ? allocation.seats : [];
      const seatNumbers = seats.map(seat => Number(seat.seat_number));
      const seatedStudentIds = seats.map(seat => text(seat.student_id)).sort();
      const roomStudentIds = [...studentIds].sort();
      if (seatNumbers.length !== studentIds.length
        || new Set(seatNumbers).size !== seatNumbers.length
        || seatNumbers.some(number => !Number.isInteger(number) || number < 1)
        || new Set(seatedStudentIds).size !== seatedStudentIds.length
        || roomStudentIds.some((studentId, index) => studentId !== seatedStudentIds[index])) {
        violations.push({ code: 'INVALID_EXAM_SEATS', message: `${room.name} 的座号不完整、重复，或座次学生与考场名单不一致` });
      }
      const invigilators = allocation.invigilator_teacher_ids || [];
      if (teachers.size && invigilators.length !== plan.config.invigilators_per_room) {
        violations.push({ code: 'INVIGILATOR_COUNT', message: `${room.name} 的监考教师人数不符合配置` });
      }
      if (combinedTeacherId && invigilators.includes(combinedTeacherId)) {
        combinedTeacherRoomCount += 1;
      }
      for (const teacherId of invigilators) {
        const teacherRooms = invigilationRoomsByTeacher.get(teacherId) || [];
        teacherRooms.push(room.id);
        invigilationRoomsByTeacher.set(teacherId, teacherRooms);
        if (!teachers.has(teacherId)) {
          violations.push({ code: 'UNKNOWN_INVIGILATOR', message: `${room.name} 引用了不存在的监考教师 ${teacherId}` });
        } else if (!invigilatorTeacherIds.has(teacherId)) {
          const exemptionReason = examStaffProfileForTeacher(teachers.get(teacherId)).invigilation_exemption_reason;
          violations.push({
            code: 'INELIGIBLE_INVIGILATOR',
            message: `教师 ${teacherId} 不具备监考资格${exemptionReason ? `（${exemptionReason}）` : ''}，不能参加监考`,
          });
        }
        if (actualTeacherIds.includes(teacherId)
          && !(combinedChiefInvigilator && teacherId === combinedTeacherId)) {
          violations.push({ code: 'OWN_COURSE_INVIGILATION', message: `教师 ${teacherId} 实际教授课程 ${exam.course_id}，不能监考该课程考试` });
        }
      }
    }
    if (combinedChiefInvigilator && combinedTeacherRoomCount !== 1) {
      violations.push({
        code: 'SECOND_LANGUAGE_COMBINED_DUTY',
        message: `考试 ${exam.course_name} 的语言巡考教师必须且只能兼任 1 个考场的监考`,
      });
    }
    for (const [teacherId, roomIds] of invigilationRoomsByTeacher) {
      if (roomIds.length > 1) {
        violations.push({
          code: 'TEACHER_MULTIPLE_ROOMS_SAME_EXAM',
          message: `教师 ${teachers.get(teacherId)?.name || teacherId} 同时被安排到 ${roomIds.length} 个考场监考 ${exam.course_name}`,
        });
      }
    }
    const expectedRoomCount = minimumRoomsForStudents(plan.config.rooms, exam.student_count);
    if (!timetableOnly && Number.isFinite(expectedRoomCount) && allocations.length !== expectedRoomCount) {
      violations.push({
        code: 'EXAM_ROOM_COUNT',
        message: `考试 ${exam.course_name} 应按 ${exam.student_count} 名考生自动使用 ${expectedRoomCount} 个考场，实际使用 ${allocations.length} 个`,
      });
    }
    const electiveExam = courses.get(exam.course_id)?.type !== 'required';
    if (!timetableOnly && electiveExam && allocations.length > 3) {
      violations.push({ code: 'ELECTIVE_ROOM_LIMIT', message: `选修课 ${exam.course_name} 最多只能使用 3 个考场` });
    }
    if (!timetableOnly && electiveExam && allocations.length > 1) {
      const counts = allocations.map(allocation => (allocation.student_ids || []).length);
      const balancedMaximum = Math.ceil(exam.student_count / allocations.length);
      const balanceIsCapacityFeasible = allocations.every(allocation =>
        (rooms.get(allocation.room_id)?.capacity || 0) >= balancedMaximum);
      if (balanceIsCapacityFeasible && Math.max(...counts) - Math.min(...counts) > 1) {
        violations.push({
          code: 'UNBALANCED_EXAM_ROOMS',
          message: `选修课 ${exam.course_name} 的各考场人数应尽量均衡，当前相差超过 1 人`,
        });
      }
    }
    const expectedStudents = [...exam.student_ids].sort();
    const actualStudents = [...seated].sort();
    if (!timetableOnly && (new Set(actualStudents).size !== actualStudents.length
      || expectedStudents.length !== actualStudents.length
      || expectedStudents.some((studentId, index) => studentId !== actualStudents[index]))) {
      violations.push({ code: 'EXAM_ROSTER_PARTITION', message: `考试 ${exam.course_name} 的考场名单没有完整且唯一地覆盖全部考生` });
    }
  }

  for (const exam of plan.exams) {
    if (!sessionsByExam.has(exam.id)) {
      violations.push({ code: 'MISSING_EXAM_SESSION', message: `考试 ${exam.course_name} 尚未安排` });
    }
  }

  const scheduled = plan.exams.flatMap(exam => {
    const session = sessionsByExam.get(exam.id);
    return session ? [{ exam, session: { ...session, duration_units: exam.duration_units } }] : [];
  });
  for (let left = 0; left < scheduled.length; left += 1) {
    for (let right = left + 1; right < scheduled.length; right += 1) {
      const overlaps = sessionsOverlap(scheduled[left].session, scheduled[right].session);
      const gapUnits = gapUnitsBetweenSessions(
        scheduled[left].session,
        scheduled[right].session,
        time.unitsPerDay,
      );
      const preceding = scheduled[left].session.global_start_unit <= scheduled[right].session.global_start_unit
        ? scheduled[left]
        : scheduled[right];
      const requiredGapUnits = time.gapUnitsForExam(preceding.exam);
      const requiredGapMinutes = requiredGapUnits * plan.config.slot_minutes;
      if (timetableOnly) {
        const rightGrades = new Set(scheduled[right].exam.grades || []);
        const sharedGrades = (scheduled[left].exam.grades || []).filter(grade => rightGrades.has(grade));
        if (sharedGrades.length && overlaps) {
          violations.push({
            code: 'GRADE_EXAM_OVERLAP',
            message: `${sharedGrades.map(grade => `高${grade - 9}`).join('、')}的 ${scheduled[left].exam.course_name} 与 ${scheduled[right].exam.course_name} 考试时间重叠`,
            grades: sharedGrades,
            exam_ids: [scheduled[left].exam.id, scheduled[right].exam.id],
          });
        } else if (sharedGrades.length && gapUnits < requiredGapUnits) {
          violations.push({
            code: 'GRADE_EXAM_GAP_TOO_SHORT',
            message: `${sharedGrades.map(grade => `高${grade - 9}`).join('、')}的 ${scheduled[left].exam.course_name} 与 ${scheduled[right].exam.course_name} 之间不足 ${requiredGapMinutes} 分钟`,
            grades: sharedGrades,
            exam_ids: [scheduled[left].exam.id, scheduled[right].exam.id],
          });
        }
        continue;
      }
      const shared = scheduled[left].exam.student_ids.filter(studentId =>
        scheduled[right].exam.student_ids.includes(studentId));
      if (shared.length && overlaps) {
        violations.push({
          code: 'STUDENT_EXAM_OVERLAP',
          message: `${shared.length} 名学生的 ${scheduled[left].exam.course_name} 与 ${scheduled[right].exam.course_name} 考试冲突`,
          student_ids: shared,
          exam_ids: [scheduled[left].exam.id, scheduled[right].exam.id],
        });
      } else if (shared.length && gapUnits < requiredGapUnits) {
        violations.push({
          code: 'STUDENT_EXAM_GAP_TOO_SHORT',
          message: `${shared.length} 名学生的 ${scheduled[left].exam.course_name} 与 ${scheduled[right].exam.course_name} 之间不足 ${requiredGapMinutes} 分钟`,
          student_ids: shared,
          exam_ids: [scheduled[left].exam.id, scheduled[right].exam.id],
        });
      }
    }
  }

  const roomSessions = new Map();
  const teacherDuties = new Map();
  const invigilationCounts = new Map([...teachers.keys()].map(id => [id, 0]));
  const addDuty = (teacherId, session, role, examId) => {
    const duties = teacherDuties.get(teacherId) || [];
    duties.push({ ...session, role, exam_id: examId, duration_units: exams.get(examId)?.duration_units || 0 });
    teacherDuties.set(teacherId, duties);
  };
  for (const { exam, session } of scheduled) {
    const combinedTeacherId = isCombinedChiefInvigilatorExam(exam)
      ? session.chief_teacher_ids?.[0]
      : null;
    for (const allocation of session.room_allocations || []) {
      const used = roomSessions.get(allocation.room_id) || [];
      used.push({ ...session, duration_units: exam.duration_units, exam_id: exam.id });
      roomSessions.set(allocation.room_id, used);
      for (const teacherId of allocation.invigilator_teacher_ids || []) {
        if (teacherId === combinedTeacherId) continue;
        invigilationCounts.set(teacherId, (invigilationCounts.get(teacherId) || 0) + 1);
        addDuty(teacherId, session, 'invigilator', exam.id);
      }
    }
    if (combinedTeacherId) {
      invigilationCounts.set(combinedTeacherId, (invigilationCounts.get(combinedTeacherId) || 0) + 1);
      addDuty(combinedTeacherId, session, 'chief_and_invigilator', exam.id);
    } else {
      for (const teacherId of session.chief_teacher_ids || []) addDuty(teacherId, session, 'chief', exam.id);
    }
  }
  for (const [roomId, used] of roomSessions) {
    for (let left = 0; left < used.length; left += 1) for (let right = left + 1; right < used.length; right += 1) {
      if (sessionsOverlap(used[left], used[right])) {
        violations.push({ code: 'EXAM_ROOM_OVERLAP', message: `考场 ${rooms.get(roomId)?.name || roomId} 同时安排了多场考试` });
      }
    }
  }
  for (const [teacherId, duties] of teacherDuties) {
    for (let left = 0; left < duties.length; left += 1) for (let right = left + 1; right < duties.length; right += 1) {
      if (sessionsOverlap(duties[left], duties[right])) {
        violations.push({ code: 'TEACHER_EXAM_DUTY_OVERLAP', message: `教师 ${teachers.get(teacherId)?.name || teacherId} 的考试任务发生冲突` });
      }
    }
  }
  if (invigilatorTeacherIds.size && plan.config.require_every_teacher_invigilates) {
    const missing = [...invigilatorTeacherIds].filter(teacherId => !(invigilationCounts.get(teacherId) > 0));
    if (missing.length) {
      violations.push({ code: 'TEACHER_WITHOUT_INVIGILATION', message: `${missing.length} 位具备监考资格的安生教师没有分配监考任务`, teacher_ids: missing });
    }
  }
  if (timetableOnly) warnings.push('当前为时间表阶段：未校验考生人数、学生冲突、考场和教师任务');
  else if (!teachers.size) warnings.push('当前没有教师数据，考试已排期和分考场，但尚未分配监考与巡考任务');

  return { ok: violations.length === 0, violations, warnings };
}

function addTimetableOnlySymmetryBreaking(model, records) {
  const interchangeableExamGroups = new Map();

  for (const record of records.values()) {
    const grades = [...(record.exam.grades || [])].sort((left, right) => left - right);
    const key = `${grades.join(',')}:${record.exam.duration_units}`;
    const group = interchangeableExamGroups.get(key) || [];
    group.push(record);
    interchangeableExamGroups.set(key, group);
  }

  for (const group of interchangeableExamGroups.values()) {
    group.sort((left, right) => left.exam.id.localeCompare(right.exam.id));
    for (let index = 1; index < group.length; index += 1) {
      model.addLessOrEqual(group[index - 1].start, group[index].start);
    }
  }
}

/**
 * Builds a compact CP-SAT exam timetable. Timetable-only mode schedules one
 * exact-duration sequence per grade; the retained advanced mode also assigns
 * rooms, seats, chief teachers, and balanced invigilation duties.
 */
export async function solveExamSchedule(state = {}, rawPlan = {}, options = {}) {
  const {
    CpModel,
    CpSolver,
    CpSolverStatus,
    Domain,
    LinearExpr,
  } = require('@ortools-node/cp-sat');
  const plan = normalizeExamPlan(state, rawPlan);
  if (!plan.exams.length) throw new Error('至少需要配置一门考试');
  const timetableOnly = plan.config.timetable_only;
  const time = timeline(plan.config, plan.exams);
  const courses = new Map((state.courses || []).map(course => [course.id, course]));
  const model = new CpModel();
  const records = new Map();
  const intervalsByStudent = new Map();
  const intervalsByGrade = new Map([10, 11, 12].map(grade => [grade, []]));
  const intervalsByRoom = new Map(plan.config.rooms.map(room => [room.id, []]));
  const teachers = [...(timetableOnly ? [] : state.teachers || [])]
    .sort((left, right) => left.id.localeCompare(right.id));
  const invigilatorTeachers = teachers
    .filter(teacher => examStaffProfileForTeacher(teacher).invigilation_eligible);
  const intervalsByTeacher = new Map(teachers.map(teacher => [teacher.id, []]));
  const invigilationVarsByTeacher = new Map(invigilatorTeachers.map(teacher => [teacher.id, []]));
  const objectiveRoomTerms = [];

  if (!timetableOnly && teachers.length && !invigilatorTeachers.length) {
    throw new Error('当前没有具备监考资格的安生教师；季主任、班主任、实验教师和升学顾问不会进入监考名单');
  }

  for (const exam of plan.exams) {
    const requiredRoomCount = timetableOnly ? 0 : minimumRoomsForStudents(plan.config.rooms, exam.student_count);
    if (!timetableOnly && !Number.isFinite(requiredRoomCount)) {
      throw new Error(`现有考场总容量不足以容纳 ${exam.course_name} 的 ${exam.student_count} 名考生`);
    }
    if (!timetableOnly && courses.get(exam.course_id)?.type !== 'required' && requiredRoomCount > 3) {
      throw new Error(`选修课 ${exam.course_name} 的 ${exam.student_count} 名考生需要 ${requiredRoomCount} 个考场；选修课最多只能使用 3 个考场`);
    }
    const starts = time.solverStarts(exam.duration_units, dayCountForExam(plan.config, exam));
    if (!starts.length) throw new Error(`考试 ${exam.course_name} 无法放入任何一个可用时间窗口`);
    const start = model.newIntVarFromDomain(
      Domain.fromValues(starts.map(BigInt)),
      `EXAM_START_${exam.id}`,
    );
    const interval = model.newFixedSizeIntervalVar(start, BigInt(exam.duration_units), `EXAM_INTERVAL_${exam.id}`);
    const attendeeInterval = model.newFixedSizeIntervalVar(
      start,
      BigInt(exam.duration_units + time.gapUnitsForExam(exam)),
      `EXAM_ATTENDEE_INTERVAL_${exam.id}`,
    );
    const combinedChiefInvigilator = !timetableOnly && isCombinedChiefInvigilatorExam(exam);
    const actualTeacherIds = timetableOnly ? [] : actualTeacherIdsForExam(state, exam);
    const combinedDutyTeachers = combinedChiefInvigilator
      ? invigilatorTeachers.filter(teacher => actualTeacherIds.includes(teacher.id))
      : [];
    if (combinedChiefInvigilator && !combinedDutyTeachers.length) {
      throw new Error(`考试 ${exam.course_name} 需要 1 名具备监考资格的安生法语、日语或德语任课教师同时担任巡考和监考`);
    }
    const combinedDutyVars = combinedDutyTeachers.map(teacher => {
      const assigned = model.newBoolVar(`EXAM_COMBINED_DUTY_${exam.id}_${teacher.id}`);
      const dutyInterval = model.newOptionalFixedSizeIntervalVar(
        start,
        BigInt(exam.duration_units),
        assigned,
        `EXAM_COMBINED_DUTY_INTERVAL_${exam.id}_${teacher.id}`,
      );
      intervalsByTeacher.get(teacher.id).push(dutyInterval);
      invigilationVarsByTeacher.get(teacher.id).push({
        assigned,
        duration_minutes: exam.duration_minutes,
        exam_id: exam.id,
        room_id: null,
      });
      return { teacher_id: teacher.id, assigned };
    });
    if (combinedDutyVars.length) {
      model.addEquality(LinearExpr.sum(combinedDutyVars.map(item => item.assigned)), 1n);
    }
    const chiefTeacherIds = combinedChiefInvigilator
      ? []
      : actualTeacherIds.slice(0, 1);
    if (!timetableOnly && !combinedChiefInvigilator && teachers.length && !chiefTeacherIds.length) {
      throw new Error(`考试 ${exam.course_name} 没有配置教授课程 ${exam.course_id} 的实际任课教师，无法安排巡考`);
    }
    for (const teacherId of chiefTeacherIds) intervalsByTeacher.get(teacherId).push(interval);
    const roomVars = timetableOnly ? [] : plan.config.rooms.map(room => {
      const selected = model.newBoolVar(`EXAM_ROOM_${exam.id}_${room.id}`);
      const combinedRoom = combinedChiefInvigilator
        ? model.newBoolVar(`EXAM_COMBINED_DUTY_ROOM_${exam.id}_${room.id}`)
        : null;
      const optionalInterval = model.newOptionalFixedSizeIntervalVar(
        start,
        BigInt(exam.duration_units),
        selected,
        `EXAM_ROOM_INTERVAL_${exam.id}_${room.id}`,
      );
      intervalsByRoom.get(room.id).push(optionalInterval);
      objectiveRoomTerms.push(selected);
      const invigilators = invigilatorTeachers
        .filter(teacher => !actualTeacherIds.includes(teacher.id)).map(teacher => {
          const assigned = model.newBoolVar(`EXAM_INVIGILATOR_${exam.id}_${room.id}_${teacher.id}`);
          const dutyInterval = model.newOptionalFixedSizeIntervalVar(
            start,
            BigInt(exam.duration_units),
            assigned,
            `EXAM_INVIGILATOR_INTERVAL_${exam.id}_${room.id}_${teacher.id}`,
          );
          intervalsByTeacher.get(teacher.id).push(dutyInterval);
          invigilationVarsByTeacher.get(teacher.id).push({
            assigned,
            duration_minutes: exam.duration_minutes,
            exam_id: exam.id,
            room_id: room.id,
          });
          return { teacher_id: teacher.id, assigned };
        });
      if (teachers.length) {
        if (combinedChiefInvigilator) {
          // The selected language teacher fills exactly one invigilator seat
          // in exactly one room. Every other room still receives the normal
          // configured number of distinct Ansheng invigilators.
          model.addEquality(
            LinearExpr.sum([
              ...invigilators.map(item => item.assigned),
              combinedRoom,
            ]),
            selected.mul(BigInt(plan.config.invigilators_per_room)),
          );
        } else if (invigilators.length < plan.config.invigilators_per_room) {
          model.addEquality(selected, 0n);
        } else {
          model.addEquality(
            LinearExpr.sum(invigilators.map(item => item.assigned)),
            selected.mul(BigInt(plan.config.invigilators_per_room)),
          );
        }
      }
      return { room, selected, invigilators, combinedRoom };
    });
    if (combinedChiefInvigilator) {
      model.addEquality(
        LinearExpr.sum(roomVars.map(item => item.combinedRoom)),
        1n,
      );
    }
    if (timetableOnly) {
      const grades = (exam.grades || []).filter(grade => intervalsByGrade.has(grade));
      if (!grades.length) throw new Error(`考试 ${exam.course_name} 缺少高一、高二或高三年级信息`);
      for (const grade of grades) intervalsByGrade.get(grade).push(attendeeInterval);
    } else {
      model.addGreaterOrEqual(
        LinearExpr.weightedSum(
          roomVars.map(item => item.selected),
          roomVars.map(item => BigInt(item.room.capacity)),
        ),
        BigInt(exam.student_count),
      );
      model.addEquality(
        LinearExpr.sum(roomVars.map(item => item.selected)),
        BigInt(requiredRoomCount),
      );
      for (const studentId of exam.student_ids) {
        const intervals = intervalsByStudent.get(studentId) || [];
        intervals.push(attendeeInterval);
        intervalsByStudent.set(studentId, intervals);
      }
    }
    records.set(exam.id, {
      exam,
      start,
      interval,
      roomVars,
      chiefTeacherIds,
      combinedDutyVars,
      requiredRoomCount,
    });
  }

  if (timetableOnly) {
    // With no student, room, or teacher coupling, exams for the same grades and
    // duration are interchangeable. A stable order removes equivalent branches.
    addTimetableOnlySymmetryBreaking(model, records);
    for (const intervals of intervalsByGrade.values()) {
      if (intervals.length > 1) model.addNoOverlap(intervals);
    }
  } else {
    for (const intervals of intervalsByStudent.values()) {
      if (intervals.length > 1) model.addNoOverlap(intervals);
    }
    for (const intervals of intervalsByRoom.values()) {
      if (intervals.length > 1) model.addNoOverlap(intervals);
    }
    for (const intervals of intervalsByTeacher.values()) {
      if (intervals.length > 1) model.addNoOverlap(intervals);
    }
  }

  const minimumDutyCount = [...records.values()].reduce(
    (total, record) => total
      + record.requiredRoomCount * plan.config.invigilators_per_room,
    0,
  );
  if (invigilatorTeachers.length
    && plan.config.require_every_teacher_invigilates
    && minimumDutyCount < invigilatorTeachers.length) {
    throw new Error(`监考任务至少只有 ${minimumDutyCount} 个，无法保证 ${invigilatorTeachers.length} 位具备监考资格的安生教师每人至少监考一次`);
  }
  const teacherLoadVars = [];
  const teacherMinuteLoadVars = [];
  for (const teacher of invigilatorTeachers) {
    const duties = invigilationVarsByTeacher.get(teacher.id);
    const load = model.newIntVar(0n, BigInt(minimumDutyCount), `EXAM_TEACHER_LOAD_${teacher.id}`);
    if (duties.length) model.addEquality(load, LinearExpr.sum(duties.map(item => item.assigned)));
    else model.addEquality(load, 0n);
    if (plan.config.require_every_teacher_invigilates) model.addGreaterOrEqual(load, 1n);
    const minuteLoad = model.newIntVar(
      0n,
      BigInt(plan.exams.reduce((total, exam) => total + exam.duration_minutes, 0)),
      `EXAM_TEACHER_MINUTE_LOAD_${teacher.id}`,
    );
    if (duties.length) {
      model.addEquality(
        minuteLoad,
        LinearExpr.weightedSum(
          duties.map(item => item.assigned),
          duties.map(item => BigInt(item.duration_minutes)),
        ),
      );
    } else model.addEquality(minuteLoad, 0n);
    teacherLoadVars.push({ teacher, load });
    teacherMinuteLoadVars.push({ teacher, load: minuteLoad });
  }

  const latestEnd = model.newIntVar(
    0n,
    BigInt(time.solverHorizon),
    'EXAM_LATEST_END',
  );
  model.addMaxEquality(
    latestEnd,
    [...records.values()].map(record => record.start.add(BigInt(record.exam.duration_units))),
  );
  const startTerms = [...records.values()].map(record => record.start);
  const objectiveTerms = [latestEnd.mul(1_000_000_000n)];
  let maxTeacherLoad;
  let minTeacherLoad;
  let maxTeacherMinutes;
  let minTeacherMinutes;
  if (invigilatorTeachers.length) {
    maxTeacherLoad = model.newIntVar(0n, BigInt(minimumDutyCount), 'EXAM_MAX_TEACHER_LOAD');
    minTeacherLoad = model.newIntVar(0n, BigInt(minimumDutyCount), 'EXAM_MIN_TEACHER_LOAD');
    model.addMaxEquality(maxTeacherLoad, teacherLoadVars.map(item => item.load));
    model.addMinEquality(minTeacherLoad, teacherLoadVars.map(item => item.load));
    const maximumMinutes = plan.exams.reduce((total, exam) => total + exam.duration_minutes, 0);
    maxTeacherMinutes = model.newIntVar(0n, BigInt(maximumMinutes), 'EXAM_MAX_TEACHER_MINUTES');
    minTeacherMinutes = model.newIntVar(0n, BigInt(maximumMinutes), 'EXAM_MIN_TEACHER_MINUTES');
    model.addMaxEquality(maxTeacherMinutes, teacherMinuteLoadVars.map(item => item.load));
    model.addMinEquality(minTeacherMinutes, teacherMinuteLoadVars.map(item => item.load));
    objectiveTerms.push(maxTeacherLoad.sub(minTeacherLoad).mul(1_000_000n));
    objectiveTerms.push(maxTeacherMinutes.sub(minTeacherMinutes).mul(1_000n));
  }
  objectiveTerms.push(LinearExpr.sum(startTerms).mul(10n));
  if (objectiveRoomTerms.length) objectiveTerms.push(LinearExpr.sum(objectiveRoomTerms));
  model.minimize(LinearExpr.sum(objectiveTerms));

  const solver = new CpSolver();
  solver.parameters.maxTimeInSeconds = Math.max(0.1, Number(options.maxTimeSeconds || 20));
  solver.parameters.numSearchWorkers = Math.max(1, Number(options.numSearchWorkers || 8));
  const status = await solver.solve(model);
  const ok = status === CpSolverStatus.FEASIBLE || status === CpSolverStatus.OPTIMAL;
  if (!ok) {
    return {
      ok: false,
      status: CpSolverStatus[status] || String(status),
      reason: timetableOnly
        ? '无法在考试天数、每日时间窗口和停考时段约束内完成三个年级的排考'
        : '无法在考试天数、考生冲突和考场容量约束内完成排考',
      plan,
      sessions: [],
    };
  }

  const sessions = [...records.values()].map(record => {
    const solverStart = Number(solver.value(record.start));
    const dayIndex = Math.floor(solverStart / time.solverDayStride);
    const startUnit = solverStart % time.solverDayStride;
    const globalStart = dayIndex * time.unitsPerDay + startUnit;
    const endUnit = startUnit + record.exam.duration_units;
    const roomRecords = record.roomVars
      .filter(item => solver.booleanValue(item.selected))
      .sort((left, right) => left.room.id.localeCompare(right.room.id));
    const combinedTeacherIds = record.combinedDutyVars
      .filter(item => solver.booleanValue(item.assigned))
      .map(item => item.teacher_id)
      .sort();
    const roomAllocations = (timetableOnly ? [] : allocateStudentsToRooms(
      record.exam.student_ids,
      roomRecords.map(item => item.room),
    )).map(allocation => {
      const roomRecord = roomRecords.find(item => item.room.id === allocation.room_id);
      const combinedRoomTeacherIds = roomRecord.combinedRoom
        && solver.booleanValue(roomRecord.combinedRoom)
        ? combinedTeacherIds
        : [];
      return {
        ...allocation,
        invigilator_teacher_ids: [
          ...combinedRoomTeacherIds,
          ...roomRecord.invigilators
            .filter(item => solver.booleanValue(item.assigned))
            .map(item => item.teacher_id),
        ].sort(),
      };
    });
    return {
      exam_id: record.exam.id,
      course_id: record.exam.course_id,
      course_name: record.exam.course_name,
      subject_id: record.exam.subject_id,
      grades: record.exam.grades || [],
      student_ids: record.exam.student_ids,
      student_count: record.exam.student_count,
      duration_minutes: record.exam.duration_minutes,
      day_index: dayIndex,
      day_label: plan.config.day_labels[dayIndex],
      global_start_unit: globalStart,
      start_unit: startUnit,
      end_unit: endUnit,
      start_time: minutesLabel(time.dayStartMinutes + startUnit * plan.config.slot_minutes),
      end_time: minutesLabel(time.dayStartMinutes + endUnit * plan.config.slot_minutes),
      chief_teacher_ids: combinedTeacherIds.length ? combinedTeacherIds : record.chiefTeacherIds,
      room_allocations: roomAllocations,
    };
  }).sort((left, right) => left.global_start_unit - right.global_start_unit
    || left.course_name.localeCompare(right.course_name, 'zh-CN'));

  const loadVarsByTeacher = new Map(teacherLoadVars.map(item => [item.teacher.id, item.load]));
  const minuteLoadVarsByTeacher = new Map(teacherMinuteLoadVars.map(item => [item.teacher.id, item.load]));
  const teacherLoads = teachers.map(teacher => {
    const load = loadVarsByTeacher.get(teacher.id);
    const minuteLoad = minuteLoadVarsByTeacher.get(teacher.id);
    const chiefExamIds = sessions
      .filter(session => session.chief_teacher_ids.includes(teacher.id))
      .map(session => session.exam_id);
    return {
      teacher_id: teacher.id,
      teacher_name: teacher.name || teacher.id,
      ...examStaffProfileForTeacher(teacher),
      invigilation_count: load ? Number(solver.value(load)) : 0,
      invigilation_minutes: minuteLoad ? Number(solver.value(minuteLoad)) : 0,
      chief_exam_ids: chiefExamIds,
    };
  });

  const result = {
    ok: true,
    status: CpSolverStatus[status] || String(status),
    plan,
    sessions,
    teacher_loads: teacherLoads,
    metrics: {
      used_days: Math.max(...sessions.map(session => session.day_index)) + 1,
      latest_end_unit: Math.max(...sessions.map(session =>
        session.global_start_unit + session.duration_minutes / plan.config.slot_minutes)),
      total_room_sessions: sessions.reduce((total, session) => total + session.room_allocations.length, 0),
      invigilator_teacher_count: invigilatorTeachers.length,
      longest_exam_duration_minutes: time.longestExamDurationMinutes,
      longest_exam_ids: plan.exams
        .filter(exam => exam.duration_minutes === time.longestExamDurationMinutes)
        .map(exam => exam.id)
        .sort(),
    },
  };
  return { ...result, validation: validateExamSchedule(state, plan, result) };
}
