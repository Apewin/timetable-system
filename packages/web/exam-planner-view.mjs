function integer(value, label, minimum, maximum) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${label}必须是 ${minimum}–${maximum} 范围内的整数`);
  }
  return parsed;
}

function time(value, label) {
  const normalized = String(value ?? '').trim();
  if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(normalized)) throw new Error(`${label}必须使用 HH:MM 格式`);
  return normalized;
}

function parseBreaks(value) {
  return String(value ?? '')
    .split(/[,，\n]+/)
    .map(item => item.trim())
    .filter(Boolean)
    .map((item, index) => {
      const match = /^(\d{2}:\d{2})\s*[-–—~至]\s*(\d{2}:\d{2})$/.exec(item);
      if (!match) throw new Error(`停考时段“${item}”格式无效，请填写 12:00-13:30`);
      return {
        start: time(match[1], `第 ${index + 1} 个停考时段开始时间`),
        end: time(match[2], `第 ${index + 1} 个停考时段结束时间`),
        label: `停考时段 ${index + 1}`,
      };
    });
}

export const DEFAULT_EXAM_SOLVE_SECONDS = 90;

const GRADE_LABELS = { 10: '高一', 11: '高二', 12: '高三' };

function normalizedExamGrades(exam = {}, course = {}) {
  const source = exam.grades ?? exam.grade ?? course.grade;
  const values = Array.isArray(source) ? source : source == null || source === '' ? [] : [source];
  return [...new Set(values.map(Number).filter(grade => [10, 11, 12].includes(grade)))]
    .sort((left, right) => left - right);
}

export function examSubjectReadiness(exams = [], courses = []) {
  const courseById = new Map((courses || []).map(course => [course.id, course]));
  const rows = (exams || []).map(exam => {
    const course = courseById.get(exam.course_id);
    const grades = normalizedExamGrades(exam, course);
    const sourceRow = Number(exam.source_row);
    const sourceSheet = String(exam.source_sheet || '').trim();
    const sourceLabel = Number.isInteger(sourceRow) && sourceRow > 0
      ? `${sourceSheet ? `${sourceSheet} · ` : ''}第 ${sourceRow} 行`
      : '手动添加';
    const issues = [];
    if (!course) issues.push('名单来源课程不存在');
    if (!grades.length) issues.push('年级未识别');
    return {
      ...exam,
      grades,
      grade_label: grades.length ? grades.map(grade => GRADE_LABELS[grade]).join('、') : '年级未识别',
      source_label: sourceLabel,
      issues,
      ready: issues.length === 0,
    };
  });
  const readyCount = rows.filter(row => row.ready).length;
  return {
    ready: rows.length > 0 && readyCount === rows.length,
    ready_count: readyCount,
    issue_count: rows.length - readyCount,
    rows,
  };
}

function generatedExamRoomName(index) {
  let value = index + 1;
  let suffix = '';
  while (value > 0) {
    value -= 1;
    suffix = String.fromCharCode(65 + (value % 26)) + suffix;
    value = Math.floor(value / 26);
  }
  return `考场 ${suffix}`;
}

export function examRoomsForEditor(config = {}) {
  const fallbackCapacity = Number(config.room_capacity) || 30;
  if (Array.isArray(config.rooms) && config.rooms.length) {
    return config.rooms.map((room, index) => ({
      id: String(room?.id || `EXAM_ROOM_${index + 1}`),
      name: String(room?.name || generatedExamRoomName(index)),
      capacity: Number(room?.capacity) || fallbackCapacity,
    }));
  }
  const roomCount = Number(config.room_count) || 10;
  return Array.from({ length: roomCount }, (_, index) => ({
    id: `EXAM_ROOM_${index + 1}`,
    name: generatedExamRoomName(index),
    capacity: fallbackCapacity,
  }));
}

function canonicalExamRoomName(value) {
  return String(value || '').trim().normalize('NFKC').toLocaleLowerCase('zh-CN');
}

function examRoomNameExists(rooms, name, exceptId = '') {
  const canonicalName = canonicalExamRoomName(name);
  return rooms.some(room => room.id !== exceptId && canonicalExamRoomName(room.name) === canonicalName);
}

export function changeExamRooms(rooms = [], command = {}) {
  const current = (rooms || []).map(room => ({ ...room }));
  if (command.type === 'add') {
    const name = String(command.name ?? '').trim();
    if (!name) throw new Error('考场名称不能为空');
    if (examRoomNameExists(current, name)) throw new Error('考场名称不能重复');
    const capacity = integer(command.capacity, '考场容量', 1, 200);
    const ids = new Set(current.map(room => room.id));
    let nextIndex = 1;
    while (ids.has(`EXAM_ROOM_${nextIndex}`)) nextIndex += 1;
    return [...current, { id: `EXAM_ROOM_${nextIndex}`, name, capacity }];
  }
  if (command.type === 'rename') {
    const id = String(command.id ?? '').trim();
    const name = String(command.name ?? '').trim();
    if (!name) throw new Error('考场名称不能为空');
    if (!current.some(room => room.id === id)) throw new Error('找不到需要修改的考场');
    if (examRoomNameExists(current, name, id)) throw new Error('考场名称不能重复');
    return current.map(room => room.id === id ? { ...room, name } : room);
  }
  if (command.type === 'delete') {
    const id = String(command.id ?? '').trim();
    if (!current.some(room => room.id === id)) throw new Error('找不到需要删除的考场');
    if (current.length <= 1) throw new Error('至少保留一个考场');
    return current.filter(room => room.id !== id);
  }
  throw new Error('不支持的考场修改操作');
}

function minutes(value) {
  const match = /^(\d{2}):(\d{2})$/.exec(String(value || ''));
  return match ? Number(match[1]) * 60 + Number(match[2]) : Number.NaN;
}

function dateAfter(startDate, dayIndex) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(startDate || ''));
  if (!match) return '';
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + Number(dayIndex || 0)));
  return [date.getUTCFullYear(), String(date.getUTCMonth() + 1).padStart(2, '0'), String(date.getUTCDate()).padStart(2, '0')].join('-');
}

function sessionsOverlap(left, right) {
  return Number(left.day_index) === Number(right.day_index)
    && minutes(left.start_time) < minutes(right.end_time)
    && minutes(right.start_time) < minutes(left.end_time);
}

/**
 * Stable view model for the exam-review screen. The page does not need to
 * understand solver units, date arithmetic, or cross-grade rest rules.
 */
export function examScheduleReview(schedule = {}) {
  const sessions = [...(schedule.sessions || [])].sort((left, right) =>
    Number(left.day_index) - Number(right.day_index)
      || minutes(left.start_time) - minutes(right.start_time)
      || String(left.course_name || '').localeCompare(String(right.course_name || ''), 'zh-CN'));
  const config = schedule.plan?.config || {};
  const longestDuration = Number(schedule.metrics?.longest_exam_duration_minutes);
  const ordinaryRest = Number(config.minimum_exam_gap_minutes || 15);
  const longestRest = Number(config.longest_exam_gap_minutes || 30);

  const conflictExamIds = new Set();
  let conflictCount = 0;
  for (let leftIndex = 0; leftIndex < sessions.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < sessions.length; rightIndex += 1) {
      const left = sessions[leftIndex];
      const right = sessions[rightIndex];
      if (!sessionsOverlap(left, right)) continue;
      const rightStudents = new Set(right.student_ids || []);
      if (!(left.student_ids || []).some(studentId => rightStudents.has(studentId))) continue;
      conflictCount += 1;
      conflictExamIds.add(left.exam_id);
      conflictExamIds.add(right.exam_id);
    }
  }

  const rows = sessions.map(session => {
    const grades = [...new Set((session.grades || []).map(Number).filter(Number.isInteger))]
      .sort((left, right) => left - right);
    const currentEnd = minutes(session.end_time);
    const nextStarts = sessions
      .filter(candidate => candidate !== session
        && Number(candidate.day_index) === Number(session.day_index)
        && minutes(candidate.start_time) >= currentEnd
        && (grades.length === 0 || (candidate.grades || []).some(grade => grades.includes(Number(grade)))))
      .map(candidate => minutes(candidate.start_time))
      .filter(Number.isFinite);
    const nextStart = nextStarts.length ? Math.min(...nextStarts) : null;
    const restAfter = nextStart === null || !Number.isFinite(currentEnd) ? null : nextStart - currentEnd;
    const requiredRest = Number(session.duration_minutes) === longestDuration ? longestRest : ordinaryRest;
    const hasConflict = conflictExamIds.has(session.exam_id);
    const date = dateAfter(config.start_date, session.day_index);
    return {
      ...session,
      date,
      date_label: [date, session.day_label].filter(Boolean).join(' · '),
      grade_label: grades.length ? grades.map(grade => GRADE_LABELS[grade] || `${grade} 年级`).join('、') : '未标年级',
      grade_filter: grades.map(String),
      time_label: `${session.start_time}–${session.end_time}`,
      rest_after_minutes: restAfter,
      required_rest_minutes: requiredRest,
      rest_status: restAfter === null ? '当天最后一场' : restAfter >= requiredRest ? '通过' : '不足',
      conflict_status: hasConflict ? '存在冲突' : '无冲突',
      review_status: hasConflict || (restAfter !== null && restAfter < requiredRest) ? '需处理' : '通过',
    };
  });
  const dayOptions = [...new Map(rows.map(row => [String(row.day_index), {
    value: String(row.day_index),
    label: row.date_label || row.day_label,
  }])).values()];
  const gradeOptions = [...new Set(rows.flatMap(row => row.grade_filter))]
    .sort((left, right) => Number(left) - Number(right))
    .map(value => ({ value, label: GRADE_LABELS[value] || `${value} 年级` }));
  return {
    rows,
    day_options: dayOptions,
    grade_options: gradeOptions,
    conflict_count: conflictCount,
    validation_ok: schedule.validation?.ok === true && conflictCount === 0,
  };
}

/**
 * Flattens the generated room allocations into a browser-friendly seating
 * preview. Its row-major layout mirrors the printable Excel worksheets.
 */
export function examSeatReview(schedule = {}, students = []) {
  const studentById = new Map((students || []).map(student => [String(student.id), student]));
  const rooms = [];
  let missingStudentCount = 0;
  for (const session of schedule.sessions || []) {
    const grades = [...new Set((session.grades || []).map(Number).filter(Number.isInteger))]
      .sort((left, right) => left - right);
    const date = dateAfter(schedule.plan?.config?.start_date, session.day_index);
    for (const allocation of session.room_allocations || []) {
      const sourceSeats = [...(allocation.seats || [])]
        .sort((left, right) => Number(left.seat_number) - Number(right.seat_number));
      const columnCount = sourceSeats.length === 30 ? 5 : 4;
      const fullSeatCount = Math.floor(sourceSeats.length / columnCount) * columnCount;
      const finalRowSeatCount = sourceSeats.length % columnCount;
      const seats = sourceSeats.map((seat, index) => {
        const student = studentById.get(String(seat.student_id));
        if (!student) missingStudentCount += 1;
        const inFinalRow = finalRowSeatCount > 0 && index >= fullSeatCount;
        const centeredOffset = inFinalRow ? Math.floor((columnCount - finalRowSeatCount) / 2) : 0;
        return {
          seat_number: Number(seat.seat_number),
          student_id: String(seat.student_id),
          student_name: String(student?.name || student?.chinese_name || seat.student_id),
          english_name: String(student?.english_name || ''),
          grade: Number(student?.grade) || null,
          admin_class_id: String(student?.admin_class_id || ''),
          teaching_class_id: String(student?.teaching_class_id || ''),
          grid_row: Math.floor(index / columnCount) + 1,
          grid_column: centeredOffset + (index % columnCount) + 1,
          student_found: Boolean(student),
        };
      });
      rooms.push({
        key: `${session.exam_id}:${allocation.room_id}`,
        exam_id: String(session.exam_id),
        course_name: String(session.course_name || session.course_id || session.exam_id),
        day_index: Number(session.day_index),
        day_label: String(session.day_label || `第 ${Number(session.day_index) + 1} 天`),
        date,
        date_label: [date, session.day_label].filter(Boolean).join(' · '),
        start_time: String(session.start_time || ''),
        end_time: String(session.end_time || ''),
        time_label: `${session.start_time || ''}–${session.end_time || ''}`,
        grades,
        grade_filter: grades.map(String),
        grade_label: grades.length
          ? grades.map(grade => GRADE_LABELS[grade] || `${grade} 年级`).join('、')
          : '未标年级',
        room_id: String(allocation.room_id),
        room_name: String(allocation.room_name || allocation.room_id),
        capacity: Number(allocation.capacity) || null,
        student_count: seats.length,
        column_count: columnCount,
        seats,
      });
    }
  }
  rooms.sort((left, right) => left.day_index - right.day_index
    || minutes(left.start_time) - minutes(right.start_time)
    || left.course_name.localeCompare(right.course_name, 'zh-CN')
    || left.room_name.localeCompare(right.room_name, 'zh-CN'));
  const options = (key, label) => [...new Map(rooms.map(room => [room[key], {
    value: room[key],
    label: room[label],
  }])).values()];
  return {
    rooms,
    day_options: options('day_index', 'date_label').map(option => ({ ...option, value: String(option.value) })),
    exam_options: options('exam_id', 'course_name'),
    room_options: options('room_id', 'room_name'),
    grade_options: [...new Set(rooms.flatMap(room => room.grade_filter))]
      .sort((left, right) => Number(left) - Number(right))
      .map(value => ({ value, label: GRADE_LABELS[value] || `${value} 年级` })),
    total_students: rooms.reduce((total, room) => total + room.student_count, 0),
    missing_student_count: missingStudentCount,
  };
}

/** Present invigilation fairness separately from exempt staff. */
export function examTeacherDutyReview(schedule = {}) {
  const loads = schedule.teacher_loads || [];
  const eligibleSource = loads.filter(item => item.invigilation_eligible !== false);
  const average = eligibleSource.length
    ? eligibleSource.reduce((total, item) => total + Number(item.invigilation_count || 0), 0) / eligibleSource.length
    : 0;
  const eligible = eligibleSource.map(item => {
    const count = Number(item.invigilation_count || 0);
    const deviation = count - average;
    return {
      ...item,
      deviation,
      fairness: deviation > 0.5 ? '偏高' : deviation < -0.5 ? '偏低' : '均衡',
    };
  }).sort((left, right) => Number(right.invigilation_count || 0) - Number(left.invigilation_count || 0)
    || String(left.teacher_name || '').localeCompare(String(right.teacher_name || ''), 'zh-CN'));
  const counts = eligible.map(item => Number(item.invigilation_count || 0));
  const ineligible = loads.filter(item => item.invigilation_eligible === false).map(item => ({
    ...item,
    reason: item.invigilation_exemption_reason || '不参加监考',
  })).sort((left, right) => String(left.teacher_name || '').localeCompare(String(right.teacher_name || ''), 'zh-CN'));
  return {
    eligible,
    ineligible,
    average_count: average,
    spread: counts.length ? Math.max(...counts) - Math.min(...counts) : 0,
  };
}

export function examWorkflowState({
  examCount = 0,
  subjectIssueCount = 0,
  planSaved = false,
  planIssues = [],
  dirty = false,
  solveStatus = 'not_run',
  schedule = null,
} = {}) {
  const subjectsReady = Number(examCount) > 0 && Number(subjectIssueCount) === 0;
  const settingsReady = subjectsReady && planSaved && !dirty && !(planIssues || []).length;
  const timetableReady = settingsReady
    && solveStatus === 'valid'
    && schedule?.ok === true
    && schedule?.validation?.ok === true;
  const staffingReady = timetableReady && schedule?.plan?.config?.timetable_only === false;
  const activeStage = !subjectsReady
    ? 'subjects'
    : !settingsReady
      ? 'config'
      : !timetableReady
        ? 'timetable'
        : 'staffing';
  const stages = {
    subjects: {
      complete: subjectsReady,
      locked: false,
      label: Number(examCount) === 0
        ? '待导入'
        : Number(subjectIssueCount) > 0
          ? `${subjectIssueCount} 门待确认`
          : `${examCount} 门已添加`,
    },
    config: {
      complete: settingsReady,
      locked: !subjectsReady,
      label: dirty ? '有未保存修改' : settingsReady ? '已保存' : '待设置',
    },
    timetable: {
      complete: timetableReady,
      locked: !settingsReady,
      label: timetableReady ? '已生成' : '未生成',
    },
    staffing: {
      complete: staffingReady,
      locked: !timetableReady,
      label: staffingReady ? '已完成，可导出' : timetableReady ? '可开始' : '未解锁',
    },
  };
  return {
    activeStage,
    stages,
    canStaff: timetableReady,
    canExport: timetableReady,
    staffingReady,
    exportLabel: staffingReady ? '导出考试安排与座次 Excel' : '导出三个年级考试时间表',
  };
}

export function examSolveRequest(expectedRevision) {
  return {
    expected_revision: Number(expectedRevision),
    max_time_seconds: DEFAULT_EXAM_SOLVE_SECONDS,
  };
}

export function examRestPolicySummary(schedule = {}) {
  const config = schedule.plan?.config || {};
  const exams = new Map((schedule.plan?.exams || []).map(exam => [exam.id, exam]));
  const longestExamIds = schedule.metrics?.longest_exam_ids || [];
  const longestExamNames = [...new Set(longestExamIds
    .map(id => exams.get(id)?.course_name || exams.get(id)?.name || id)
    .filter(Boolean))];
  const longestDuration = Number(schedule.metrics?.longest_exam_duration_minutes);
  const ordinaryGap = Number(config.minimum_exam_gap_minutes || 15);
  const longestGap = Number(config.longest_exam_gap_minutes || 30);
  if (!longestExamNames.length || !Number.isFinite(longestDuration)) {
    return `普通考试结束后休息 ${ordinaryGap} 分钟；最长考试结束后休息 ${longestGap} 分钟。`;
  }
  return `本批次最长考试：${longestExamNames.join('、')}（${longestDuration} 分钟），结束后休息 ${longestGap} 分钟；其他考试结束后休息 ${ordinaryGap} 分钟。`;
}

export function examDurationImportRowKey(row) {
  return `${Number(row?.grade)}:${Number(row?.source_row)}:${String(row?.subject_name ?? '').trim()}`;
}

export function examRowsFromDurationImport(rows = [], courseOverrides = {}) {
  const exams = [];
  const unmapped = [];
  for (const row of rows || []) {
    const courseId = String(courseOverrides[examDurationImportRowKey(row)] || row?.course_id || '').trim();
    if (!courseId) {
      unmapped.push({ ...row });
      continue;
    }
    const grade = Number(row?.grade);
    const sourceRow = Number(row?.source_row);
    const courseName = String(row?.subject_name ?? '').trim() || courseId;
    const secondForeignLanguage = /二外|second[ _-]*foreign[ _-]*language/i.test(courseName);
    const idCourse = courseId.toUpperCase().replace(/[^A-Z0-9_]+/g, '_').replace(/^_+|_+$/g, '');
    exams.push({
      id: `EXAM_IMPORT_G${grade}_R${sourceRow}_${idCourse}`,
      course_id: courseId,
      course_name: courseName,
      ...(secondForeignLanguage ? {
        subject_id: 'SECOND_FOREIGN_LANGUAGE',
        component_course_ids: ['FRENCH', 'GERMAN', 'JAPANESE'],
        staffing_mode: 'single_teacher_combined_chief_invigilator',
      } : {}),
      grades: [grade],
      source_row: sourceRow,
      ...(String(row?.source_sheet || '').trim() ? { source_sheet: String(row.source_sheet).trim() } : {}),
      duration_minutes: Number(row?.duration_minutes),
      source_duration: String(row?.source_duration ?? '').trim(),
    });
  }
  return { exams, unmapped };
}

function examDayConfiguration(fields = {}) {
  const fallbackDayCount = integer(fields.day_count ?? 4, '考试天数', 3, 5);
  if (fields.grade_day_counts === undefined) return { day_count: fallbackDayCount };
  if (!fields.grade_day_counts
    || typeof fields.grade_day_counts !== 'object'
    || Array.isArray(fields.grade_day_counts)) {
    throw new Error('分年级考试天数必须是对象');
  }
  const gradeDayCounts = Object.fromEntries([10, 11, 12].map(grade => [
    grade,
    integer(fields.grade_day_counts[grade] ?? fallbackDayCount, `高${grade - 9}考试天数`, 3, 5),
  ]));
  return {
    day_count: Math.max(...Object.values(gradeDayCounts)),
    grade_day_counts: gradeDayCounts,
  };
}

function examRoomConfiguration(fields = {}) {
  if (!Array.isArray(fields.rooms)) {
    return { room_count: integer(fields.room_count, '同时可用考场上限', 1, 100) };
  }
  if (!fields.rooms.length) throw new Error('至少需要一个考场');
  const rooms = fields.rooms.map((room, index) => {
    const id = String(room?.id ?? '').trim();
    const name = String(room?.name ?? '').trim();
    if (!id) throw new Error(`第 ${index + 1} 个考场缺少 ID`);
    if (!name) throw new Error(`第 ${index + 1} 个考场名称不能为空`);
    return {
      id,
      name,
      capacity: integer(room?.capacity, `第 ${index + 1} 个考场容量`, 1, 200),
    };
  });
  return { room_count: rooms.length, rooms };
}

export function examPlanFromEditor(fields = {}, examRows = []) {
  const exams = (examRows || []).map((row, index) => {
    const courseId = String(row?.course_id ?? '').trim();
    if (!courseId) throw new Error(`第 ${index + 1} 门考试未选择课程`);
    const exam = {
      id: String(row?.id || `EXAM_${courseId}`).trim(),
      course_id: courseId,
      duration_minutes: integer(row?.duration_minutes, `第 ${index + 1} 门考试时长`, 5, 240),
    };
    if (String(row?.course_name ?? '').trim()) exam.course_name = String(row.course_name).trim();
    if (String(row?.source_duration ?? '').trim()) exam.source_duration = String(row.source_duration).trim();
    if (Number.isInteger(Number(row?.source_row)) && Number(row.source_row) > 0) exam.source_row = Number(row.source_row);
    if (String(row?.source_sheet ?? '').trim()) exam.source_sheet = String(row.source_sheet).trim();
    if (String(row?.subject_id ?? '').trim()) exam.subject_id = String(row.subject_id).trim();
    if (Array.isArray(row?.component_course_ids)) {
      exam.component_course_ids = [...new Set(row.component_course_ids.map(String).map(value => value.trim()).filter(Boolean))].sort();
    }
    if (String(row?.staffing_mode ?? '').trim()) exam.staffing_mode = String(row.staffing_mode).trim();
    const grades = [...new Set((Array.isArray(row?.grades) ? row.grades : [])
      .map(Number).filter(Number.isInteger))].sort((left, right) => left - right);
    if (grades.length) exam.grades = grades;
    if (row?.roster_mode === 'explicit') {
      if (!Array.isArray(row.student_ids)) throw new Error(`第 ${index + 1} 门考试的手工考生名单无效`);
      return { ...exam, roster_mode: 'explicit', student_ids: [...row.student_ids] };
    }
    return exam;
  });
  if (!exams.length) throw new Error('请至少添加一门考试');
  if (new Set(exams.map(exam => exam.id)).size !== exams.length) throw new Error('考试 ID 不能重复');
  const minimumExamGapMinutes = integer(
    fields.minimum_exam_gap_minutes ?? 15,
    '考试间最短休息时间',
    10,
    120,
  );
  const longestExamGapMinutes = integer(
    fields.longest_exam_gap_minutes ?? 30,
    '最长考试后休息时间',
    10,
    120,
  );
  if (longestExamGapMinutes < minimumExamGapMinutes) {
    throw new Error('最长考试后的休息时间不能短于普通考试休息时间');
  }
  const dayConfiguration = examDayConfiguration(fields);
  return {
    config: {
      timetable_only: fields.timetable_only !== false,
      ...dayConfiguration,
      start_date: String(fields.start_date ?? '').trim(),
      day_start: time(fields.day_start, '每日开始时间'),
      day_end: time(fields.day_end, '每日结束时间'),
      slot_minutes: 5,
      minimum_exam_gap_minutes: minimumExamGapMinutes,
      longest_exam_gap_minutes: longestExamGapMinutes,
      breaks: parseBreaks(fields.breaks),
      ...examRoomConfiguration(fields),
      room_capacity: integer(fields.room_capacity, '单考场容量上限', 1, 200),
      invigilators_per_room: integer(fields.invigilators_per_room, '每考场监考人数', 1, 4),
      require_every_teacher_invigilates: fields.require_every_teacher_invigilates !== false,
    },
    exams,
  };
}
