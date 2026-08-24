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
  const longestExamNames = longestExamIds
    .map(id => exams.get(id)?.course_name || exams.get(id)?.name || id)
    .filter(Boolean);
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
      room_count: integer(fields.room_count, '同时可用考场上限', 1, 100),
      room_capacity: integer(fields.room_capacity, '单考场容量上限', 1, 200),
      invigilators_per_room: integer(fields.invigilators_per_room, '每考场监考人数', 1, 4),
      require_every_teacher_invigilates: fields.require_every_teacher_invigilates !== false,
    },
    exams,
  };
}
