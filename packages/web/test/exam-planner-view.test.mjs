import assert from 'node:assert/strict';
import test from 'node:test';

import {
  changeExamRooms,
  examSeatReview,
  examScheduleReview,
  examTeacherDutyReview,
  examMarkingPriorityForEditor,
  examPlanFromEditor,
  examRestPolicySummary,
  examRoomsForEditor,
  examRowsFromDurationImport,
  examSolveRequest,
  examSubjectReadiness,
  examWorkflowState,
} from '../exam-planner-view.mjs';

test('preselects biology and chemistry for early marking while honoring staff overrides', () => {
  assert.equal(examMarkingPriorityForEditor({}, { id: 'BIO', name: '生物' }), 'high');
  assert.equal(examMarkingPriorityForEditor({}, { id: 'CHEM', name: 'Chemistry' }), 'high');
  assert.equal(examMarkingPriorityForEditor({}, { id: 'MATH', name: '数学' }), 'normal');
  assert.equal(examMarkingPriorityForEditor({ marking_priority: 'normal' }, { id: 'BIO', name: '生物' }), 'normal');
});

test('exam subject readiness identifies grade and source before allowing the next stage', () => {
  const courses = [
    { id: 'CN', name: '语文', grade: 10 },
    { id: 'AP_MACRO', name: 'AP Macroeconomics', grade: 11 },
  ];
  const review = examSubjectReadiness([
    { id: 'E1', course_id: 'CN', grades: [10], source_row: 5, source_sheet: '时长统计' },
    { id: 'E2', course_id: 'AP_MACRO' },
    { id: 'E3', course_id: 'MISSING' },
  ], courses);

  assert.equal(review.ready, false);
  assert.equal(review.ready_count, 2);
  assert.equal(review.issue_count, 1);
  assert.deepEqual(review.rows[0].grades, [10]);
  assert.equal(review.rows[0].source_label, '时长统计 · 第 5 行');
  assert.deepEqual(review.rows[1].grades, [11]);
  assert.equal(review.rows[2].grade_label, '年级未识别');
});

test('builds a staff-reviewable seating preview with the same four/five-column layout as Excel', () => {
  const students = Array.from({ length: 34 }, (_, index) => ({
    id: `S${index + 1}`,
    name: `学生${index + 1}`,
    english_name: `Student ${index + 1}`,
    grade: 11,
    admin_class_id: 'G11_A',
  }));
  const seats = (offset, count) => Array.from({ length: count }, (_, index) => ({
    seat_number: index + 1,
    student_id: `S${offset + index + 1}`,
  }));
  const review = examSeatReview({
    plan: { config: { start_date: '2027-01-21' } },
    sessions: [{
      exam_id: 'EXAM_AP_ENV',
      course_name: 'AP 环境科学',
      grades: [11],
      day_index: 0,
      day_label: '第 1 天',
      start_time: '08:00',
      end_time: '09:30',
      room_allocations: [
        { room_id: 'R1', room_name: '报告厅', seats: seats(0, 30) },
        { room_id: 'R2', room_name: '实验室', seats: seats(30, 4) },
      ],
    }],
  }, students);

  assert.equal(review.rooms.length, 2);
  assert.equal(review.rooms[0].column_count, 5);
  assert.equal(review.rooms[1].column_count, 4);
  assert.equal(review.rooms[0].seats[0].student_name, '学生1');
  assert.equal(review.rooms[0].seats[0].english_name, 'Student 1');
  assert.equal(review.rooms[1].seats[3].student_id, 'S34');
  assert.deepEqual(review.exam_options, [{ value: 'EXAM_AP_ENV', label: 'AP 环境科学' }]);
  assert.deepEqual(review.room_options, [
    { value: 'R1', label: '报告厅' },
    { value: 'R2', label: '实验室' },
  ]);
  assert.deepEqual(review.grade_options, [{ value: '11', label: '高二' }]);
  assert.equal(review.missing_student_count, 0);
});

test('builds editable exam rooms from either named rooms or the legacy room count', () => {
  assert.deepEqual(examRoomsForEditor({ room_count: 2, room_capacity: 30 }), [
    { id: 'EXAM_ROOM_1', name: '考场 A', capacity: 30 },
    { id: 'EXAM_ROOM_2', name: '考场 B', capacity: 30 },
  ]);
  assert.deepEqual(examRoomsForEditor({
    room_capacity: 30,
    rooms: [{ id: 'HALL', name: '报告厅', capacity: 80 }],
  }), [{ id: 'HALL', name: '报告厅', capacity: 80 }]);
});

test('adds a named room with a stable unused id', () => {
  assert.deepEqual(changeExamRooms([
    { id: 'EXAM_ROOM_1', name: '考场 A', capacity: 30 },
  ], { type: 'add', name: '报告厅', capacity: 45 }), [
    { id: 'EXAM_ROOM_1', name: '考场 A', capacity: 30 },
    { id: 'EXAM_ROOM_2', name: '报告厅', capacity: 45 },
  ]);
});

test('rejects a duplicate exam room name when adding', () => {
  assert.throws(() => changeExamRooms([
    { id: 'EXAM_ROOM_1', name: '报告厅', capacity: 30 },
  ], { type: 'add', name: '  报告厅 ', capacity: 30 }), /考场名称不能重复/);
});

test('renames one exam room without changing its stable id', () => {
  assert.deepEqual(changeExamRooms([
    { id: 'EXAM_ROOM_1', name: '考场 A', capacity: 30 },
    { id: 'EXAM_ROOM_2', name: '考场 B', capacity: 30 },
  ], { type: 'rename', id: 'EXAM_ROOM_2', name: '  体育馆  ' }), [
    { id: 'EXAM_ROOM_1', name: '考场 A', capacity: 30 },
    { id: 'EXAM_ROOM_2', name: '体育馆', capacity: 30 },
  ]);
});

test('rejects a duplicate exam room name when renaming', () => {
  assert.throws(() => changeExamRooms([
    { id: 'EXAM_ROOM_1', name: '报告厅', capacity: 30 },
    { id: 'EXAM_ROOM_2', name: '体育馆', capacity: 30 },
  ], { type: 'rename', id: 'EXAM_ROOM_2', name: '报告厅' }), /考场名称不能重复/);
});

test('deletes only the selected exam room', () => {
  assert.deepEqual(changeExamRooms([
    { id: 'EXAM_ROOM_1', name: '报告厅', capacity: 30 },
    { id: 'EXAM_ROOM_2', name: '体育馆', capacity: 30 },
  ], { type: 'delete', id: 'EXAM_ROOM_1' }), [
    { id: 'EXAM_ROOM_2', name: '体育馆', capacity: 30 },
  ]);
});

test('keeps at least one exam room available', () => {
  assert.throws(() => changeExamRooms([
    { id: 'EXAM_ROOM_1', name: '报告厅', capacity: 30 },
  ], { type: 'delete', id: 'EXAM_ROOM_1' }), /至少保留一个考场/);
});

test('builds dated, graded exam review rows with rest and conflict evidence', () => {
  const review = examScheduleReview({
    ok: true,
    plan: {
      config: {
        start_date: '2027-01-21',
        minimum_exam_gap_minutes: 15,
        longest_exam_gap_minutes: 30,
      },
    },
    metrics: { longest_exam_duration_minutes: 120 },
    sessions: [
      {
        exam_id: 'MATH', course_name: '数学', grades: [10], day_index: 0, day_label: '第 1 天',
        start_time: '08:00', end_time: '10:00', duration_minutes: 120, student_ids: ['S1'],
      },
      {
        exam_id: 'ENGLISH', course_name: '英语', grades: [10, 11], day_index: 0, day_label: '第 1 天',
        start_time: '10:30', end_time: '11:30', duration_minutes: 60, student_ids: ['S2'],
      },
    ],
    validation: { ok: true, violations: [] },
  });

  assert.equal(review.rows[0].date, '2027-01-21');
  assert.equal(review.rows[0].grade_label, '高一');
  assert.equal(review.rows[1].grade_label, '高一、高二');
  assert.equal(review.rows[0].rest_after_minutes, 30);
  assert.equal(review.rows[0].required_rest_minutes, 30);
  assert.equal(review.rows[0].rest_status, '通过');
  assert.equal(review.conflict_count, 0);
  assert.deepEqual(review.day_options, [{ value: '0', label: '2027-01-21 · 第 1 天' }]);
});

test('separates eligible teacher loads and highlights workload fairness', () => {
  const review = examTeacherDutyReview({
    teacher_loads: [
      { teacher_id: 'T2', teacher_name: '李老师', invigilation_eligible: true, invigilation_count: 4, invigilation_minutes: 240, chief_exam_ids: [] },
      { teacher_id: 'T1', teacher_name: '张老师', invigilation_eligible: true, invigilation_count: 2, invigilation_minutes: 120, chief_exam_ids: ['E1'] },
      { teacher_id: 'T3', teacher_name: '王顾问', invigilation_eligible: false, invigilation_exemption_reason: '升学顾问不参加监考', invigilation_count: 0, invigilation_minutes: 0, chief_exam_ids: [] },
    ],
  });

  assert.equal(review.average_count, 3);
  assert.equal(review.spread, 2);
  assert.deepEqual(review.eligible.map(row => row.teacher_id), ['T2', 'T1']);
  assert.equal(review.eligible[0].fairness, '偏高');
  assert.equal(review.eligible[1].fairness, '偏低');
  assert.equal(review.ineligible[0].reason, '升学顾问不参加监考');
});

test('exam workflow unlocks each stage only after the prior result is durable', () => {
  assert.equal(examWorkflowState().activeStage, 'subjects');
  const edited = examWorkflowState({ examCount: 8, dirty: true });
  assert.equal(edited.activeStage, 'config');
  assert.equal(edited.stages.config.label, '有未保存修改');
  assert.equal(edited.stages.timetable.locked, true);

  const saved = examWorkflowState({ examCount: 8, planSaved: true });
  assert.equal(saved.activeStage, 'timetable');
  assert.equal(saved.canStaff, false);

  const timetable = examWorkflowState({
    examCount: 8,
    planSaved: true,
    solveStatus: 'valid',
    schedule: { ok: true, validation: { ok: true }, plan: { config: { timetable_only: true } } },
  });
  assert.equal(timetable.activeStage, 'staffing');
  assert.equal(timetable.canStaff, true);
  assert.equal(timetable.exportLabel, '导出三个年级考试时间表');

  const staffed = examWorkflowState({
    examCount: 8,
    planSaved: true,
    solveStatus: 'valid',
    schedule: { ok: true, validation: { ok: true }, plan: { config: { timetable_only: false } } },
  });
  assert.equal(staffed.staffingReady, true);
  assert.equal(staffed.exportLabel, '导出考试安排与座次 Excel');
});

test('requests a 90-second exam solve by default', () => {
  assert.deepEqual(examSolveRequest(47), {
    expected_revision: 47,
    max_time_seconds: 90,
  });
});

test('describes which exams receive the longest-exam rest policy', () => {
  assert.equal(examRestPolicySummary({
    plan: {
      config: { minimum_exam_gap_minutes: 15, longest_exam_gap_minutes: 30 },
      exams: [
        { id: 'EXAM_CHINESE', course_name: '语文' },
        { id: 'EXAM_MATH', course_name: '数学' },
      ],
    },
    metrics: {
      longest_exam_duration_minutes: 120,
      longest_exam_ids: ['EXAM_CHINESE', 'EXAM_MATH'],
    },
  }), '本批次最长考试：语文、数学（120 分钟），结束后休息 30 分钟；其他考试结束后休息 15 分钟。');
});

test('deduplicates repeated course names in the longest-exam summary', () => {
  assert.equal(examRestPolicySummary({
    plan: {
      config: { minimum_exam_gap_minutes: 15, longest_exam_gap_minutes: 30 },
      exams: [
        { id: 'E1', course_name: 'AP Psychology' },
        { id: 'E2', course_name: 'AP Psychology' },
      ],
    },
    metrics: { longest_exam_duration_minutes: 120, longest_exam_ids: ['E1', 'E2'] },
  }), '本批次最长考试：AP Psychology（120 分钟），结束后休息 30 分钟；其他考试结束后休息 15 分钟。');
});

test('serializes the exam editor into the backend plan contract', () => {
  const plan = examPlanFromEditor({
    day_count: '4',
    start_date: '2026-11-02',
    day_start: '08:00',
    day_end: '17:30',
    minimum_exam_gap_minutes: '15',
    longest_exam_gap_minutes: '30',
    breaks: '12:00-13:30',
    room_count: '12',
    room_capacity: '30',
    invigilators_per_room: '2',
    require_every_teacher_invigilates: true,
  }, [
    { id: 'EXAM_MATH', course_id: 'MATH', duration_minutes: '90' },
  ]);

  assert.deepEqual(plan, {
    config: {
      timetable_only: true,
      day_count: 4,
      start_date: '2026-11-02',
      day_start: '08:00',
      day_end: '17:30',
      slot_minutes: 5,
      minimum_exam_gap_minutes: 15,
      longest_exam_gap_minutes: 30,
      breaks: [{ start: '12:00', end: '13:30', label: '停考时段 1' }],
      room_count: 12,
      room_capacity: 30,
      invigilators_per_room: 2,
      require_every_teacher_invigilates: true,
    },
    exams: [{ id: 'EXAM_MATH', course_id: 'MATH', duration_minutes: 90 }],
  });
});

test('serializes separate exam-day settings for all three grades', () => {
  const plan = examPlanFromEditor({
    grade_day_counts: { 10: '3', 11: '4', 12: '5' },
    start_date: '2027-01-21',
    day_start: '08:00',
    day_end: '17:30',
    breaks: '12:00-13:30',
    room_count: '10',
    room_capacity: '30',
    invigilators_per_room: '1',
    require_every_teacher_invigilates: true,
  }, [{ id: 'EXAM_MATH', course_id: 'MATH', duration_minutes: 90 }]);

  assert.deepEqual(plan.config.grade_day_counts, { 10: 3, 11: 4, 12: 5 });
  assert.equal(plan.config.day_count, 5);
});

test('serializes the editor into the room and teacher staffing phase', () => {
  const plan = examPlanFromEditor({
    timetable_only: false,
    day_count: '4',
    start_date: '2027-01-21',
    day_start: '08:00',
    day_end: '17:30',
    minimum_exam_gap_minutes: '10',
    breaks: '12:00-13:30',
    room_count: '10',
    room_capacity: '30',
    invigilators_per_room: '1',
    require_every_teacher_invigilates: true,
  }, [{ id: 'EXAM_MATH', course_id: 'MATH', duration_minutes: 90 }]);

  assert.equal(plan.config.timetable_only, false);
});

test('preserves the staff-selected marking priority in the saved exam plan', () => {
  const plan = examPlanFromEditor({
    day_count: '3',
    start_date: '2027-01-21',
    day_start: '08:00',
    day_end: '17:30',
    breaks: '',
    room_count: '1',
    room_capacity: '30',
    invigilators_per_room: '1',
    require_every_teacher_invigilates: false,
  }, [{
    id: 'EXAM_BIO',
    course_id: 'BIO',
    duration_minutes: 90,
    marking_priority: 'high',
  }]);

  assert.equal(plan.exams[0].marking_priority, 'high');
});

test('serializes the named exam rooms managed by the user', () => {
  const plan = examPlanFromEditor({
    timetable_only: false,
    day_count: '4',
    start_date: '2027-01-21',
    day_start: '08:00',
    day_end: '17:30',
    breaks: '12:00-13:30',
    rooms: [
      { id: 'EXAM_ROOM_1', name: '报告厅', capacity: 45 },
      { id: 'EXAM_ROOM_2', name: '体育馆', capacity: 60 },
    ],
    room_capacity: '30',
    invigilators_per_room: '1',
    require_every_teacher_invigilates: true,
  }, [{ id: 'EXAM_MATH', course_id: 'MATH', duration_minutes: 90 }]);

  assert.deepEqual(plan.config.rooms, [
    { id: 'EXAM_ROOM_1', name: '报告厅', capacity: 45 },
    { id: 'EXAM_ROOM_2', name: '体育馆', capacity: 60 },
  ]);
  assert.equal(plan.config.room_count, 2);
});

test('preserves an API-provided explicit exam roster when settings are saved in the page', () => {
  const plan = examPlanFromEditor({
    day_count: '3',
    start_date: '',
    day_start: '08:00',
    day_end: '17:30',
    breaks: '',
    room_count: '2',
    room_capacity: '30',
    invigilators_per_room: '1',
    require_every_teacher_invigilates: false,
  }, [{
    id: 'EXAM_SELECTED',
    course_id: 'SPECIAL',
    duration_minutes: 60,
    roster_mode: 'explicit',
    student_ids: ['S2', 'S1'],
  }]);

  assert.deepEqual(plan.exams[0], {
    id: 'EXAM_SELECTED',
    course_id: 'SPECIAL',
    duration_minutes: 60,
    roster_mode: 'explicit',
    student_ids: ['S2', 'S1'],
  });
});

test('preserves imported grade and source labels while allowing five-minute duration adjustments', () => {
  const plan = examPlanFromEditor({
    day_count: '3',
    start_date: '',
    day_start: '08:00',
    day_end: '17:30',
    breaks: '',
    room_count: '3',
    room_capacity: '30',
    invigilators_per_room: '1',
    require_every_teacher_invigilates: false,
  }, [{
    id: 'EXAM_IMPORT_G11_ENG',
    course_id: 'ENG_COMP',
    course_name: '综英',
    grades: [11],
    duration_minutes: 65,
    source_duration: '1h',
  }]);

  assert.equal(plan.config.slot_minutes, 5);
  assert.deepEqual(plan.exams, [{
    id: 'EXAM_IMPORT_G11_ENG',
    course_id: 'ENG_COMP',
    course_name: '综英',
    grades: [11],
    duration_minutes: 65,
    source_duration: '1h',
  }]);
});

test('turns a reviewed duration preview into editable exam rows and reports anything still unmapped', () => {
  const imported = examRowsFromDurationImport([
    {
      grade: 10,
      source_row: 5,
      subject_name: '数学',
      source_duration: '1.5h',
      duration_minutes: 90,
      course_id: 'MATH_PRECAL',
    },
    {
      grade: 12,
      source_row: 16,
      subject_name: '二外',
      source_duration: '30min',
      duration_minutes: 30,
      course_id: null,
    },
  ], { '12:16:二外': 'JAPANESE' });

  assert.deepEqual(imported.unmapped, []);
  assert.deepEqual(imported.exams, [
    {
      id: 'EXAM_IMPORT_G10_R5_MATH_PRECAL',
      course_id: 'MATH_PRECAL',
      course_name: '数学',
      grades: [10],
      source_row: 5,
      duration_minutes: 90,
      source_duration: '1.5h',
    },
    {
      id: 'EXAM_IMPORT_G12_R16_JAPANESE',
      course_id: 'JAPANESE',
      course_name: '二外',
      subject_id: 'SECOND_FOREIGN_LANGUAGE',
      component_course_ids: ['FRENCH', 'GERMAN', 'JAPANESE'],
      staffing_mode: 'single_teacher_combined_chief_invigilator',
      grades: [12],
      source_row: 16,
      duration_minutes: 30,
      source_duration: '30min',
    },
  ]);
});
