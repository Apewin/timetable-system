import assert from 'node:assert/strict';
import test from 'node:test';

import {
  examPlanFromEditor,
  examRestPolicySummary,
  examRowsFromDurationImport,
  examSolveRequest,
} from '../exam-planner-view.mjs';

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
      duration_minutes: 30,
      source_duration: '30min',
    },
  ]);
});
