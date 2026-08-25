import assert from 'node:assert/strict';
import test from 'node:test';

import {
  normalizeExamPlan,
  solveExamSchedule,
  validateExamSchedule,
} from '../src/exam-scheduling.mjs';
import { runSolverJob } from '../src/solver-job-runner.mjs';

function schoolState() {
  return {
    courses: [
      { id: 'MATH', name: '数学', type: 'required', grade: 10 },
      { id: 'PHYS', name: '物理', type: 'ap', grade: [10, 11] },
    ],
    students: [
      { id: 'S1', name: '学生一', grade: 10, ap_courses: ['PHYS'] },
      { id: 'S2', name: '学生二', grade: 10, ap_courses: [] },
      { id: 'S3', name: '学生三', grade: 11, ap_courses: ['PHYS'] },
    ],
    teachers: [],
    teaching_assignments: [],
  };
}

test('normalizes exam durations and derives each course roster from current student data', () => {
  const plan = normalizeExamPlan(schoolState(), {
    config: { day_count: 4, room_count: 3, room_capacity: 30 },
    exams: [
      { id: 'EXAM_MATH', course_id: 'MATH', duration_minutes: 90 },
      { id: 'EXAM_PHYS', course_id: 'PHYS', duration_minutes: 60 },
    ],
  });

  assert.deepEqual(plan.exams.map(exam => ({
    id: exam.id,
    duration_units: exam.duration_units,
    student_ids: exam.student_ids,
  })), [
    { id: 'EXAM_MATH', duration_units: 3, student_ids: ['S1', 'S2'] },
    { id: 'EXAM_PHYS', duration_units: 2, student_ids: ['S1', 'S3'] },
  ]);
});

test('supports five-minute duration adjustments and scopes an imported required exam to its source grade', () => {
  const state = {
    courses: [{ id: 'CHIN', name: '语文', type: 'required', grade: [10, 11, 12] }],
    students: [
      { id: 'S10', grade: 10 },
      { id: 'S11', grade: 11 },
      { id: 'S12', grade: 12 },
    ],
  };

  const plan = normalizeExamPlan(state, {
    config: { day_count: 3, slot_minutes: 5, room_count: 1, room_capacity: 30 },
    exams: [{
      id: 'EXAM_CHIN_G11',
      course_id: 'CHIN',
      course_name: '高二语文',
      grades: [11],
      duration_minutes: 65,
    }],
  });

  assert.equal(plan.config.slot_minutes, 5);
  assert.equal(plan.exams[0].duration_units, 13);
  assert.equal(plan.exams[0].course_name, '高二语文');
  assert.deepEqual(plan.exams[0].grades, [11]);
  assert.deepEqual(plan.exams[0].student_ids, ['S11']);
});

test('defaults to fifteen-minute breaks and thirty minutes after the longest exam', () => {
  const state = {
    courses: [{ id: 'MATH', name: '数学', type: 'required', grade: 10 }],
    students: [{ id: 'S1', grade: 10 }],
  };

  const plan = normalizeExamPlan(state, {
    config: { day_count: 3, room_count: 1, room_capacity: 30 },
    exams: [{ id: 'EXAM_MATH', course_id: 'MATH', duration_minutes: 90 }],
  });

  assert.equal(plan.config.minimum_exam_gap_minutes, 15);
  assert.equal(plan.config.longest_exam_gap_minutes, 30);
});

test('rejects duplicate managed exam room names', () => {
  assert.throws(() => normalizeExamPlan(schoolState(), {
    config: {
      day_count: 3,
      room_capacity: 30,
      rooms: [
        { id: 'HALL_1', name: '报告厅', capacity: 30 },
        { id: 'HALL_2', name: '  报告厅 ', capacity: 30 },
      ],
    },
    exams: [{ id: 'EXAM_MATH', course_id: 'MATH', duration_minutes: 60 }],
  }), /考场名称不能重复/);
});

test('normalizes separate exam-day limits for senior one, two, and three', () => {
  const state = {
    courses: [{ id: 'MATH', name: '数学', type: 'required', grade: 10 }],
    students: [{ id: 'S1', grade: 10 }],
  };

  const plan = normalizeExamPlan(state, {
    config: {
      day_count: 3,
      grade_day_counts: { 10: 3, 11: 4, 12: 5 },
      room_count: 1,
      room_capacity: 30,
    },
    exams: [{ id: 'EXAM_MATH', course_id: 'MATH', duration_minutes: 60 }],
  });

  assert.deepEqual(plan.config.grade_day_counts, { 10: 3, 11: 4, 12: 5 });
  assert.equal(plan.config.day_count, 5);
  assert.equal(plan.config.day_labels.length, 5);
});

test('normalizes 二外 as one combined French, Japanese, and German exam', () => {
  const state = {
    courses: [
      { id: 'FRENCH', name: '法语', type: 'required_elective', grade: 12 },
      { id: 'JAPANESE', name: '日语', type: 'required_elective', grade: 12 },
      { id: 'GERMAN', name: '德语', type: 'required_elective', grade: 12 },
    ],
    students: [
      { id: 'S_F', grade: 12, elective_choices: { group_c: 'FRENCH' } },
      { id: 'S_J', grade: 12, elective_choices: { group_c: 'JAPANESE' } },
      { id: 'S_G', grade: 12, elective_choices: { group_c: 'GERMAN' } },
      { id: 'S_OTHER', grade: 12, elective_choices: { group_c: 'BUSINESS' } },
    ],
  };

  const plan = normalizeExamPlan(state, {
    config: { day_count: 3, room_count: 1, room_capacity: 30 },
    exams: [{
      id: 'EXAM_IMPORT_G12_R16_JAPANESE',
      course_id: 'JAPANESE',
      course_name: '二外',
      grades: [12],
      duration_minutes: 30,
    }],
  });

  assert.equal(plan.exams[0].subject_id, 'SECOND_FOREIGN_LANGUAGE');
  assert.deepEqual(plan.exams[0].component_course_ids, ['FRENCH', 'GERMAN', 'JAPANESE']);
  assert.deepEqual(plan.exams[0].student_ids, ['S_F', 'S_G', 'S_J']);
});

test('keeps a zero-student subject in timetable-only planning', () => {
  const state = {
    courses: [{ id: 'AP_MICRO', name: 'AP Microeconomics', type: 'ap', grade: 10 }],
    students: [],
  };

  const plan = normalizeExamPlan(state, {
    config: {
      timetable_only: true,
      day_count: 3,
      room_count: 1,
      room_capacity: 30,
    },
    exams: [{
      id: 'EXAM_IMPORT_G10_R14_AP_MICRO',
      course_id: 'AP_MICRO',
      duration_minutes: 90,
    }],
  });

  assert.equal(plan.config.timetable_only, true);
  assert.equal(plan.exams[0].student_count, 0);
  assert.deepEqual(plan.exams[0].grades, [10]);
});

test('timetable-only solving schedules a zero-student exam without rooms or teacher duties', async () => {
  const state = {
    courses: [{ id: 'AP_MICRO', name: 'AP Microeconomics', type: 'ap', grade: 10 }],
    students: [],
    teachers: [{ id: 'T_ECON', name: '经济教师', can_teach: ['AP_MICRO'] }],
    teaching_assignments: [],
  };

  const result = await solveExamSchedule(state, {
    config: {
      timetable_only: true,
      day_count: 3,
      day_start: '08:00',
      day_end: '12:00',
      breaks: [],
      room_count: 1,
      room_capacity: 30,
      require_every_teacher_invigilates: true,
    },
    exams: [{
      id: 'EXAM_IMPORT_G10_R14_AP_MICRO',
      course_id: 'AP_MICRO',
      duration_minutes: 90,
    }],
  });

  assert.equal(result.ok, true);
  assert.equal(result.validation.ok, true);
  assert.deepEqual(result.sessions[0].grades, [10]);
  assert.deepEqual(result.sessions[0].room_allocations, []);
  assert.deepEqual(result.teacher_loads, []);
});

test('timetable-only solving defers the 二外 combined teacher duty to the staffing phase', async () => {
  const state = {
    courses: [
      { id: 'FRENCH', name: '法语', type: 'required_elective', grade: 12 },
      { id: 'JAPANESE', name: '日语', type: 'required_elective', grade: 12 },
      { id: 'GERMAN', name: '德语', type: 'required_elective', grade: 12 },
    ],
    students: [],
    teachers: [],
  };

  const result = await solveExamSchedule(state, {
    config: {
      timetable_only: true,
      day_count: 3,
      day_start: '08:00',
      day_end: '10:00',
      breaks: [],
      room_count: 1,
      room_capacity: 30,
    },
    exams: [{
      id: 'EXAM_IMPORT_G12_R16_JAPANESE',
      course_id: 'JAPANESE',
      course_name: '二外',
      grades: [12],
      duration_minutes: 30,
    }],
  });

  assert.equal(result.ok, true);
  assert.equal(result.validation.ok, true);
  assert.deepEqual(result.sessions[0].chief_teacher_ids, []);
  assert.deepEqual(result.sessions[0].room_allocations, []);
});

test('timetable-only solving leaves fifteen minutes after exams shorter than the batch maximum', async () => {
  const courses = [
    { id: 'G10_A', name: '高一考试 A', type: 'required', grade: 10 },
    { id: 'G10_B', name: '高一考试 B', type: 'required', grade: 10 },
    { id: 'G11_LONG', name: '高二最长考试', type: 'required', grade: 11 },
  ];

  const result = await solveExamSchedule({ courses, students: [], teachers: [] }, {
    config: {
      timetable_only: true,
      day_count: 3,
      day_start: '08:00',
      day_end: '10:15',
      slot_minutes: 5,
      breaks: [],
      room_count: 1,
      room_capacity: 30,
    },
    exams: courses.map(course => ({
      id: `EXAM_${course.id}`,
      course_id: course.id,
      duration_minutes: course.id === 'G11_LONG' ? 90 : 60,
    })),
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.sessions
    .filter(session => session.grades.includes(10))
    .map(session => [session.start_time, session.end_time]), [
    ['08:00', '09:00'],
    ['09:15', '10:15'],
  ]);
});

test('timetable-only solving leaves thirty minutes after every jointly longest exam', async () => {
  const courses = [
    { id: 'G10_A', name: '高一考试 A', type: 'required', grade: 10 },
    { id: 'G10_B', name: '高一考试 B', type: 'required', grade: 10 },
  ];

  const result = await solveExamSchedule({ courses, students: [], teachers: [] }, {
    config: {
      timetable_only: true,
      day_count: 3,
      day_start: '08:00',
      day_end: '10:30',
      slot_minutes: 5,
      breaks: [],
      room_count: 1,
      room_capacity: 30,
    },
    exams: courses.map(course => ({
      id: `EXAM_${course.id}`,
      course_id: course.id,
      duration_minutes: 60,
    })),
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.sessions.map(session => [session.start_time, session.end_time]), [
    ['08:00', '09:00'],
    ['09:30', '10:30'],
  ]);
  assert.equal(result.metrics.longest_exam_duration_minutes, 60);
  assert.deepEqual(result.metrics.longest_exam_ids, ['EXAM_G10_A', 'EXAM_G10_B']);
});

test('timetable-only solving builds complete non-overlapping timelines for all three grades', async () => {
  const courses = [10, 11, 12].flatMap(grade => [1, 2].map(index => ({
    id: `G${grade}_C${index}`,
    name: `高${grade - 9}科目${index}`,
    type: index === 1 ? 'required' : 'ap',
    grade,
  })));
  const result = await solveExamSchedule({ courses, students: [], teachers: [] }, {
    config: {
      timetable_only: true,
      day_count: 3,
      day_start: '08:00',
      day_end: '10:00',
      breaks: [],
      room_count: 1,
      room_capacity: 30,
      require_every_teacher_invigilates: true,
    },
    exams: courses.map(course => ({
      id: `EXAM_${course.id}`,
      course_id: course.id,
      duration_minutes: 90,
    })),
  });

  assert.equal(result.ok, true);
  assert.equal(result.sessions.length, 6);
  for (const grade of [10, 11, 12]) {
    const sessions = result.sessions.filter(session => session.grades.includes(grade));
    assert.equal(sessions.length, 2);
    assert.ok(sessions.every(session => session.day_index >= 0 && session.day_index < 3));
    assert.ok(sessions.every(session => session.end_unit - session.start_unit === 3));
    assert.equal(
      sessions[0].day_index === sessions[1].day_index
        && sessions[0].start_unit < sessions[1].end_unit
        && sessions[1].start_unit < sessions[0].end_unit,
      false,
    );
  }
});

test('solving enforces each grade day limit instead of borrowing days from another grade', async () => {
  const courses = [1, 2, 3, 4].map(index => ({
    id: `G10_C${index}`,
    name: `高一科目 ${index}`,
    type: 'required',
    grade: 10,
  }));
  const result = await solveExamSchedule({ courses, students: [], teachers: [] }, {
    config: {
      timetable_only: true,
      day_count: 5,
      grade_day_counts: { 10: 3, 11: 5, 12: 5 },
      day_start: '08:00',
      day_end: '09:00',
      slot_minutes: 5,
      breaks: [],
      room_count: 1,
      room_capacity: 30,
    },
    exams: courses.map(course => ({
      id: `EXAM_${course.id}`,
      course_id: course.id,
      duration_minutes: 60,
    })),
  });

  assert.equal(result.ok, false);
});

test('timetable-only solving proves a repeated-duration exam plan optimal within the production budget', async () => {
  const durationsByGrade = new Map([
    [10, [...Array(9).fill(60), ...Array(3).fill(90)]],
    [11, [...Array(6).fill(60), ...Array(6).fill(90), 110]],
    [12, [30, ...Array(3).fill(40), ...Array(5).fill(60), ...Array(8).fill(90), 110]],
  ]);
  const courses = [...durationsByGrade].flatMap(([grade, durations]) => durations.map((duration, index) => ({
    id: `G${grade}_EXAM_${index + 1}`,
    name: `高${grade - 9}考试 ${index + 1}`,
    type: 'required',
    grade,
    duration,
  })));

  const result = await runSolverJob({
    solver: 'exam',
    state: { courses, students: [], teachers: [] },
    plan: {
      config: {
        timetable_only: true,
        day_count: 4,
        day_start: '08:00',
        day_end: '17:30',
        slot_minutes: 5,
        breaks: [{ start: '12:00', end: '13:30' }],
        room_count: 1,
        room_capacity: 30,
      },
      exams: courses.map(course => ({
        id: `EXAM_${course.id}`,
        course_id: course.id,
        duration_minutes: course.duration,
      })),
    },
    options: { maxTimeSeconds: 60, numSearchWorkers: 8 },
  });

  assert.equal(result.status, 'OPTIMAL');
  assert.equal(result.sessions.length, 43);
  assert.equal(result.validation.ok, true);
});

test('derives every non-required exam roster only from current student selections', () => {
  const state = {
    courses: [{ id: 'ART_ELECTIVE', name: '艺术选修', type: 'other', grade: 10 }],
    students: [
      { id: 'S1', grade: 10, elective_choices: { art: 'ART_ELECTIVE' } },
      { id: 'S2', grade: 10, elective_choices: { art: ['ART_ELECTIVE'] } },
      { id: 'S3', grade: 10, elective_choices: {} },
    ],
  };

  const plan = normalizeExamPlan(state, {
    config: { day_count: 3, room_count: 3, room_capacity: 30 },
    exams: [{ id: 'EXAM_ART', course_id: 'ART_ELECTIVE', duration_minutes: 60 }],
  });

  assert.deepEqual(plan.exams[0].student_ids, ['S1', 'S2']);
});

test('recomputes a derived roster after student selections change but preserves an explicit roster', () => {
  const state = schoolState();
  const derived = normalizeExamPlan(state, {
    config: { day_count: 3, room_count: 1, room_capacity: 30 },
    exams: [{ id: 'EXAM_PHYS', course_id: 'PHYS', duration_minutes: 60 }],
  });
  const changedState = structuredClone(state);
  changedState.students[0].ap_courses = [];

  const refreshed = normalizeExamPlan(changedState, derived);
  assert.equal(refreshed.exams[0].roster_mode, 'derived');
  assert.deepEqual(refreshed.exams[0].student_ids, ['S3']);

  const explicit = normalizeExamPlan(state, {
    config: { day_count: 3, room_count: 1, room_capacity: 30 },
    exams: [{
      id: 'EXAM_PHYS_SELECTED',
      course_id: 'PHYS',
      duration_minutes: 60,
      student_ids: ['S1'],
    }],
  });
  const fixed = normalizeExamPlan(changedState, explicit);
  assert.equal(fixed.exams[0].roster_mode, 'explicit');
  assert.deepEqual(fixed.exams[0].student_ids, ['S1']);
});

test('packs independent exams together while keeping every shared student conflict-free', async () => {
  const state = schoolState();
  state.courses.push({ id: 'CHEM', name: '化学', type: 'ap', grade: 10 });
  state.students[1].ap_courses = ['CHEM'];
  const result = await solveExamSchedule(state, {
    config: {
      day_count: 3,
      day_start: '08:00',
      day_end: '12:00',
      breaks: [],
      room_count: 2,
      room_capacity: 30,
      require_every_teacher_invigilates: false,
    },
    exams: [
      { id: 'EXAM_MATH', course_id: 'MATH', duration_minutes: 90 },
      { id: 'EXAM_PHYS', course_id: 'PHYS', duration_minutes: 60 },
      { id: 'EXAM_CHEM', course_id: 'CHEM', duration_minutes: 60 },
    ],
  });

  assert.equal(result.ok, true);
  const sessions = new Map(result.sessions.map(session => [session.exam_id, session]));
  const overlaps = (left, right) => left.day_index === right.day_index
    && left.start_unit < right.end_unit
    && right.start_unit < left.end_unit;
  const gapMinutes = (left, right) => left.day_index === right.day_index
    ? Math.max(left.start_unit - right.end_unit, right.start_unit - left.end_unit)
      * result.plan.config.slot_minutes
    : Infinity;
  assert.equal(overlaps(sessions.get('EXAM_MATH'), sessions.get('EXAM_PHYS')), false);
  assert.equal(overlaps(sessions.get('EXAM_MATH'), sessions.get('EXAM_CHEM')), false);
  assert.ok(gapMinutes(sessions.get('EXAM_MATH'), sessions.get('EXAM_PHYS')) >= 10);
  assert.ok(gapMinutes(sessions.get('EXAM_MATH'), sessions.get('EXAM_CHEM')) >= 10);
  assert.equal(overlaps(sessions.get('EXAM_PHYS'), sessions.get('EXAM_CHEM')), true);
});

test('ignores the normal teaching timetable because exam week is a separate scheduling period', async () => {
  const state = schoolState();
  state.schedule = {
    assignments: Array.from({ length: 50 }, (_, index) => ({
      student_id: index % 2 ? 'S1' : 'S2',
      teacher_id: 'T_NORMAL',
      day: Math.floor(index / 10) + 1,
      period: (index % 10) + 1,
    })),
  };

  const result = await solveExamSchedule(state, {
    config: {
      day_count: 3,
      day_start: '08:00',
      day_end: '10:00',
      breaks: [],
      room_count: 1,
      room_capacity: 30,
      require_every_teacher_invigilates: false,
    },
    exams: [{ id: 'EXAM_MATH', course_id: 'MATH', duration_minutes: 60 }],
  });

  assert.equal(result.ok, true);
  assert.equal(result.sessions.length, 1);
});

test('assigns one actual course teacher as chief and balances other teachers across invigilation', async () => {
  const state = schoolState();
  state.courses.push({ id: 'CHEM', name: '化学', type: 'ap', grade: 10 });
  state.students[1].ap_courses = ['CHEM'];
  state.teachers = [
    { id: 'T_MATH', name: '数学教师', can_teach: ['MATH'] },
    { id: 'T_PHYS', name: '物理教师', can_teach: ['PHYS'] },
    { id: 'T_CHEM', name: '化学教师', can_teach: ['CHEM'] },
    { id: 'T_OTHER', name: '综合教师', can_teach: [] },
  ];
  state.teaching_assignments = [
    { id: 'TA_MATH', teacher_id: 'T_MATH', course_id: 'MATH' },
    { id: 'TA_PHYS', teacher_id: 'T_PHYS', course_id: 'PHYS' },
    { id: 'TA_CHEM', teacher_id: 'T_CHEM', course_id: 'CHEM' },
  ];
  const result = await solveExamSchedule(state, {
    config: {
      day_count: 3,
      day_start: '08:00',
      day_end: '12:00',
      breaks: [],
      room_count: 2,
      room_capacity: 30,
      invigilators_per_room: 2,
    },
    exams: [
      { id: 'EXAM_MATH', course_id: 'MATH', duration_minutes: 60 },
      { id: 'EXAM_PHYS', course_id: 'PHYS', duration_minutes: 60 },
      { id: 'EXAM_CHEM', course_id: 'CHEM', duration_minutes: 60 },
    ],
  });

  assert.equal(result.ok, true);
  assert.deepEqual(
    Object.fromEntries(result.sessions.map(session => [session.course_id, session.chief_teacher_ids])),
    { MATH: ['T_MATH'], PHYS: ['T_PHYS'], CHEM: ['T_CHEM'] },
  );
  for (const session of result.sessions) {
    const invigilators = session.room_allocations.flatMap(room => room.invigilator_teacher_ids);
    assert.equal(invigilators.includes(session.chief_teacher_ids[0]), false);
  }
  const loads = result.teacher_loads.map(item => item.invigilation_count);
  assert.equal(Math.min(...loads) >= 1, true);
  assert.equal(Math.max(...loads) - Math.min(...loads) <= 1, true);
});

test('only eligible Ansheng teachers invigilate while exempt teachers may still chief their own exams', async () => {
  const state = {
    courses: [
      { id: 'MATH', name: '数学', type: 'required', grade: 10 },
      { id: 'PHYS', name: '物理', type: 'required', grade: 10 },
    ],
    students: [{ id: 'S1', grade: 10 }],
    teachers: [
      { id: 'T_JIZHUREN', name: '季主任', can_teach: ['MATH'] },
      { id: 'T_G10_HOMEROOM', name: '高一班主任', can_teach: ['PHYS'] },
      { id: 'T_EXP_A', name: '实验教师 A', can_teach: [] },
      { id: 'T_GUIDANCE', name: '升学顾问', can_teach: [] },
      { id: 'T_ANSHENG_A', name: '安生甲', can_teach: [] },
      { id: 'T_ANSHENG_B', name: '安生乙', can_teach: [] },
    ],
    teaching_assignments: [
      { id: 'TA_MATH', teacher_id: 'T_JIZHUREN', course_id: 'MATH' },
      { id: 'TA_PHYS', teacher_id: 'T_G10_HOMEROOM', course_id: 'PHYS' },
    ],
  };

  const result = await solveExamSchedule(state, {
    config: {
      day_count: 3,
      day_start: '08:00',
      day_end: '11:00',
      breaks: [],
      room_count: 1,
      room_capacity: 30,
      invigilators_per_room: 1,
    },
    exams: [
      { id: 'EXAM_MATH', course_id: 'MATH', duration_minutes: 60 },
      { id: 'EXAM_PHYS', course_id: 'PHYS', duration_minutes: 60 },
    ],
  });

  assert.equal(result.ok, true);
  assert.deepEqual(
    new Set(result.sessions.flatMap(session => session.room_allocations
      .flatMap(room => room.invigilator_teacher_ids))),
    new Set(['T_ANSHENG_A', 'T_ANSHENG_B']),
  );
  assert.deepEqual(
    new Set(result.sessions.flatMap(session => session.chief_teacher_ids)),
    new Set(['T_JIZHUREN', 'T_G10_HOMEROOM']),
  );
  const loads = Object.fromEntries(result.teacher_loads.map(load => [load.teacher_id, load]));
  assert.equal(loads.T_ANSHENG_A.exam_staff_group_name, '安生教师');
  assert.equal(loads.T_ANSHENG_A.invigilation_eligible, true);
  assert.equal(loads.T_JIZHUREN.invigilation_count, 0);
  assert.equal(loads.T_JIZHUREN.invigilation_eligible, false);
  assert.equal(loads.T_G10_HOMEROOM.invigilation_count, 0);
  assert.equal(loads.T_EXP_A.invigilation_count, 0);
  assert.equal(loads.T_GUIDANCE.exam_staff_group_name, '安生教师');
  assert.equal(loads.T_GUIDANCE.invigilation_eligible, false);
  assert.equal(loads.T_GUIDANCE.invigilation_count, 0);
  assert.equal(loads.T_GUIDANCE.invigilation_exemption_reason, '升学顾问不参加监考');
});

test('assigns exactly one language teacher as both chief and invigilator for 二外', async () => {
  const languageCourseIds = ['FRENCH', 'JAPANESE', 'GERMAN'];
  const state = {
    courses: [
      { id: 'FRENCH', name: '法语', type: 'required_elective', grade: 12 },
      { id: 'JAPANESE', name: '日语', type: 'required_elective', grade: 12 },
      { id: 'GERMAN', name: '德语', type: 'required_elective', grade: 12 },
    ],
    students: Array.from({ length: 61 }, (_, index) => ({
      id: `S_${index + 1}`,
      grade: 12,
      elective_choices: { group_c: languageCourseIds[index % languageCourseIds.length] },
    })),
    teachers: [
      { id: 'T_F', name: '法语教师', can_teach: ['FRENCH'] },
      { id: 'T_J', name: '日语教师', can_teach: ['JAPANESE'] },
      { id: 'T_G', name: '德语教师', can_teach: ['GERMAN'] },
      { id: 'T_OTHER_A', name: '其他教师甲', can_teach: [] },
      { id: 'T_OTHER_B', name: '其他教师乙', can_teach: [] },
    ],
    teaching_assignments: [
      { id: 'TA_F', teacher_id: 'T_F', course_id: 'FRENCH' },
      { id: 'TA_J', teacher_id: 'T_J', course_id: 'JAPANESE' },
      { id: 'TA_G', teacher_id: 'T_G', course_id: 'GERMAN' },
    ],
  };

  const result = await solveExamSchedule(state, {
    config: {
      day_count: 3,
      day_start: '08:00',
      day_end: '10:00',
      breaks: [],
      room_count: 3,
      room_capacity: 30,
      invigilators_per_room: 1,
      require_every_teacher_invigilates: false,
    },
    exams: [{
      id: 'EXAM_IMPORT_G12_R16_JAPANESE',
      course_id: 'JAPANESE',
      course_name: '二外',
      grades: [12],
      duration_minutes: 30,
    }],
  });

  assert.equal(result.ok, true);
  assert.equal(result.validation.ok, true);
  const session = result.sessions[0];
  const invigilatorIds = session.room_allocations
    .flatMap(room => room.invigilator_teacher_ids);
  assert.equal(session.room_allocations.length, 3);
  assert.equal(session.room_allocations.every(room => room.invigilator_teacher_ids.length === 1), true);
  assert.equal(session.chief_teacher_ids.length, 1);
  assert.equal(new Set(['T_F', 'T_J', 'T_G']).has(session.chief_teacher_ids[0]), true);
  assert.equal(invigilatorIds.filter(id => id === session.chief_teacher_ids[0]).length, 1);
  assert.equal(new Set(invigilatorIds).size, 3);
  const selectedLoad = result.teacher_loads.find(load => load.teacher_id === session.chief_teacher_ids[0]);
  assert.equal(selectedLoad.invigilation_count, 1);
  assert.deepEqual(selectedLoad.chief_exam_ids, ['EXAM_IMPORT_G12_R16_JAPANESE']);
});

test('assigns one chief only from teachers actually assigned to the exact exam course', async () => {
  const state = {
    courses: [
      { id: 'PHYS_1', name: '物理 1', type: 'required', grade: 10 },
      { id: 'PHYS_2', name: '物理 2', type: 'required', grade: 11 },
    ],
    students: [{ id: 'S11', grade: 11 }],
    teachers: [
      { id: 'T_PHYS_1', name: '高一物理教师', can_teach: ['PHYS_1'] },
      { id: 'T_PHYS_2', name: '高二物理教师', can_teach: ['PHYS_2'] },
      { id: 'T_PHYS_2_ASSIGNED_B', name: '高二物理第二任课教师', can_teach: ['PHYS_2'] },
      { id: 'T_PHYS_2_QUALIFIED_ONLY', name: '仅有高二物理授课资格的教师', can_teach: ['PHYS_2'] },
      { id: 'T_OTHER', name: '其他学科教师', can_teach: [] },
    ],
    teaching_assignments: [
      { id: 'TA_PHYS_2', teacher_id: 'T_PHYS_2', course_id: 'PHYS_2' },
      { id: 'TA_PHYS_2_B', teacher_id: 'T_PHYS_2_ASSIGNED_B', course_id: 'PHYS_2' },
    ],
  };

  const result = await solveExamSchedule(state, {
    config: {
      day_count: 3,
      day_start: '08:00',
      day_end: '10:00',
      breaks: [],
      room_count: 1,
      room_capacity: 30,
      invigilators_per_room: 1,
      require_every_teacher_invigilates: false,
    },
    exams: [{ id: 'EXAM_PHYS_2', course_id: 'PHYS_2', duration_minutes: 60 }],
  });

  assert.equal(result.ok, true);
  assert.equal(result.sessions[0].chief_teacher_ids.length, 1);
  assert.equal(new Set(['T_PHYS_2', 'T_PHYS_2_ASSIGNED_B']).has(result.sessions[0].chief_teacher_ids[0]), true);
  assert.equal(result.sessions[0].chief_teacher_ids.includes('T_PHYS_2_QUALIFIED_ONLY'), false);
  assert.equal(result.sessions[0].room_allocations[0].invigilator_teacher_ids.includes('T_PHYS_2'), false);
  assert.equal(result.sessions[0].room_allocations[0].invigilator_teacher_ids.includes('T_PHYS_2_ASSIGNED_B'), false);
});

test('normalizes common school course variants to stable exam subjects', () => {
  const courses = [
    { id: 'ENG_LS', name: 'English Listening and Speaking' },
    { id: 'AP_LIT', name: 'AP Literature and Composition' },
    { id: 'MATH_PRECAL', name: 'Pre-Calculus' },
    { id: 'AP_CALC_BC', name: 'AP Calculus BC' },
    { id: 'CHEM_PRE', name: 'Pre-Chemistry' },
    { id: 'AP_CHEM', name: 'AP Chemistry' },
    { id: 'BIO_PRE', name: 'Pre-Biology' },
    { id: 'AP_BIO', name: 'AP Biology' },
  ].map(course => ({ ...course, type: 'required', grade: 10 }));
  const state = {
    courses,
    students: [{ id: 'S1', grade: 10 }],
  };

  const plan = normalizeExamPlan(state, {
    config: { day_count: 3, room_count: 1, room_capacity: 30 },
    exams: courses.map(course => ({
      id: `EXAM_${course.id}`,
      course_id: course.id,
      duration_minutes: 60,
    })),
  });

  assert.deepEqual(plan.exams.map(exam => exam.subject_id), [
    'ENGLISH', 'ENGLISH',
    'MATHEMATICS', 'MATHEMATICS',
    'CHEMISTRY', 'CHEMISTRY',
    'BIOLOGY', 'BIOLOGY',
  ]);
});

test('splits a large exam evenly across capacity-bounded rooms with deterministic seat numbers', async () => {
  const state = {
    courses: [{ id: 'MATH', name: '数学', type: 'required', grade: 10 }],
    students: Array.from({ length: 65 }, (_, index) => ({
      id: `S${String(index + 1).padStart(3, '0')}`,
      name: `学生${index + 1}`,
      grade: 10,
    })),
    teachers: [],
    teaching_assignments: [],
  };
  const result = await solveExamSchedule(state, {
    config: {
      day_count: 3,
      day_start: '08:00',
      day_end: '12:00',
      breaks: [],
      room_count: 3,
      room_capacity: 30,
      require_every_teacher_invigilates: false,
    },
    exams: [{ id: 'EXAM_MATH', course_id: 'MATH', duration_minutes: 60 }],
  });

  const rooms = result.sessions[0].room_allocations;
  assert.deepEqual(rooms.map(room => room.student_ids.length), [22, 22, 21]);
  assert.deepEqual(rooms.map(room => room.seats.map(seat => seat.seat_number)), [
    Array.from({ length: 22 }, (_, index) => index + 1),
    Array.from({ length: 22 }, (_, index) => index + 1),
    Array.from({ length: 21 }, (_, index) => index + 1),
  ]);
});

test('rejects an elective exam that would require more than three rooms', async () => {
  const students = Array.from({ length: 91 }, (_, index) => ({
    id: `S${String(index + 1).padStart(3, '0')}`,
    grade: 10,
    ap_courses: ['AP_ART'],
  }));
  const state = {
    courses: [{ id: 'AP_ART', name: 'AP Art', type: 'ap', grade: 10 }],
    students,
    teachers: [],
    teaching_assignments: [],
  };

  await assert.rejects(
    solveExamSchedule(state, {
      config: {
        day_count: 3,
        day_start: '08:00',
        day_end: '12:00',
        breaks: [],
        room_count: 4,
        room_capacity: 30,
        require_every_teacher_invigilates: false,
      },
      exams: [{ id: 'EXAM_AP_ART', course_id: 'AP_ART', duration_minutes: 60 }],
    }),
    /选修课.*最多只能使用 3 个考场/,
  );
});

test('automatically uses one, two, or three rooms from each elective roster size', async () => {
  const courses = [
    { id: 'AP_SMALL', name: '小班选修', type: 'ap', grade: 10 },
    { id: 'AP_MEDIUM', name: '中班选修', type: 'ap', grade: 10 },
    { id: 'AP_LARGE', name: '大班选修', type: 'ap', grade: 10 },
  ];
  const students = Array.from({ length: 65 }, (_, index) => ({
    id: `S${String(index + 1).padStart(3, '0')}`,
    grade: 10,
    ap_courses: [
      ...(index < 20 ? ['AP_SMALL'] : []),
      ...(index < 40 ? ['AP_MEDIUM'] : []),
      'AP_LARGE',
    ],
  }));

  const solved = await solveExamSchedule({
    courses,
    students,
    teachers: [],
    teaching_assignments: [],
  }, {
    config: {
      day_count: 3,
      day_start: '08:00',
      day_end: '12:00',
      breaks: [],
      room_count: 3,
      room_capacity: 30,
      require_every_teacher_invigilates: false,
    },
    exams: courses.map(course => ({
      id: `EXAM_${course.id}`,
      course_id: course.id,
      duration_minutes: 60,
    })),
  });

  assert.deepEqual(
    Object.fromEntries(solved.sessions.map(session => [session.course_id, session.room_allocations.length])),
    { AP_SMALL: 1, AP_MEDIUM: 2, AP_LARGE: 3 },
  );
  assert.deepEqual(
    solved.sessions.find(session => session.course_id === 'AP_LARGE')
      .room_allocations.map(room => room.student_ids.length),
    [22, 22, 21],
  );
});

test('independent validation rejects a persisted timetable with a student exam collision', async () => {
  const state = schoolState();
  const solved = await solveExamSchedule(state, {
    config: {
      day_count: 3,
      day_start: '08:00',
      day_end: '12:00',
      breaks: [],
      room_count: 2,
      room_capacity: 30,
      require_every_teacher_invigilates: false,
    },
    exams: [
      { id: 'EXAM_MATH', course_id: 'MATH', duration_minutes: 60 },
      { id: 'EXAM_PHYS', course_id: 'PHYS', duration_minutes: 60 },
    ],
  });
  const [first, second] = solved.sessions;
  const invalid = {
    ...solved,
    sessions: [first, {
      ...second,
      day_index: first.day_index,
      global_start_unit: first.global_start_unit,
      start_unit: first.start_unit,
      end_unit: first.end_unit,
    }],
  };

  const validation = validateExamSchedule(state, solved.plan, invalid);
  assert.equal(validation.ok, false);
  assert.equal(validation.violations.some(item => item.code === 'STUDENT_EXAM_OVERLAP'), true);
});

test('independent validation rejects a timetable that violates the dynamic rest policy', async () => {
  const courses = [
    { id: 'G10_A', name: '高一考试 A', type: 'required', grade: 10 },
    { id: 'G10_B', name: '高一考试 B', type: 'required', grade: 10 },
  ];
  const solved = await solveExamSchedule({ courses, students: [], teachers: [] }, {
    config: {
      timetable_only: true,
      day_count: 3,
      day_start: '08:00',
      day_end: '10:10',
      slot_minutes: 5,
      breaks: [],
      room_count: 1,
      room_capacity: 30,
    },
    exams: courses.map(course => ({
      id: `EXAM_${course.id}`,
      course_id: course.id,
      duration_minutes: 60,
    })),
  });
  const invalid = structuredClone(solved);
  const [first, second] = invalid.sessions;
  second.day_index = first.day_index;
  second.global_start_unit = first.global_start_unit + first.duration_minutes / solved.plan.config.slot_minutes;
  second.start_unit = first.end_unit;
  second.end_unit = second.start_unit + second.duration_minutes / solved.plan.config.slot_minutes;

  const validation = validateExamSchedule({ courses, students: [], teachers: [] }, solved.plan, invalid);

  assert.equal(validation.ok, false);
  assert.equal(validation.violations.some(item => item.code === 'GRADE_EXAM_GAP_TOO_SHORT'), true);
  assert.equal(validation.violations.some(item => item.message.includes('不足 30 分钟')), true);
});

test('independent validation rejects exam duties without the dynamic teacher transition gap', async () => {
  const courses = [
    { id: 'PSY_G11', name: '高二心理', type: 'required', grade: 11 },
    { id: 'PSY_G12', name: '高三心理', type: 'required', grade: 12 },
  ];
  const state = {
    courses,
    students: [
      { id: 'S11', name: '高二学生', grade: 11 },
      { id: 'S12', name: '高三学生', grade: 12 },
    ],
    teachers: [
      { id: 'T_PSY', name: '付晓萌' },
      { id: 'T_INV_A', name: '监考教师甲' },
      { id: 'T_INV_B', name: '监考教师乙' },
    ],
    teaching_assignments: [
      { id: 'TA_PSY_G11', teacher_id: 'T_PSY', course_id: 'PSY_G11' },
      { id: 'TA_PSY_G12', teacher_id: 'T_PSY', course_id: 'PSY_G12' },
    ],
  };
  const solved = await solveExamSchedule(state, {
    config: {
      day_count: 3,
      day_start: '08:00',
      day_end: '12:30',
      slot_minutes: 5,
      breaks: [],
      room_count: 1,
      room_capacity: 30,
      invigilators_per_room: 1,
      require_every_teacher_invigilates: false,
    },
    exams: courses.map(course => ({
      id: `EXAM_${course.id}`,
      course_id: course.id,
      duration_minutes: 110,
    })),
  });
  const solvedDuties = [...solved.sessions].sort((left, right) =>
    left.global_start_unit - right.global_start_unit);
  const solvedGapMinutes = (solvedDuties[1].global_start_unit - solvedDuties[0].end_unit)
    * solved.plan.config.slot_minutes;
  assert.equal(solved.validation.ok, true);
  assert.ok(solvedGapMinutes >= 30);
  const invalid = structuredClone(solved);
  const [first, second] = invalid.sessions;
  const durationUnits = first.duration_minutes / solved.plan.config.slot_minutes;
  second.day_index = first.day_index;
  second.global_start_unit = first.global_start_unit + durationUnits;
  second.start_unit = first.start_unit + durationUnits;
  second.end_unit = second.start_unit + durationUnits;

  const validation = validateExamSchedule(state, solved.plan, invalid);
  const transitionViolation = validation.violations.find(item =>
    item.code === 'TEACHER_EXAM_DUTY_GAP_TOO_SHORT' && item.teacher_id === 'T_PSY');

  assert.equal(validation.ok, false);
  assert.ok(transitionViolation);
  assert.match(transitionViolation.message, /付晓萌/);
  assert.match(transitionViolation.message, /不足 30 分钟/);
});

test('independent validation rejects an exam beyond its grade-specific day limit', async () => {
  const courses = [{ id: 'G10_MATH', name: '高一数学', type: 'required', grade: 10 }];
  const state = { courses, students: [], teachers: [] };
  const solved = await solveExamSchedule(state, {
    config: {
      timetable_only: true,
      day_count: 5,
      grade_day_counts: { 10: 3, 11: 5, 12: 5 },
      day_start: '08:00',
      day_end: '09:00',
      slot_minutes: 5,
      breaks: [],
      room_count: 1,
      room_capacity: 30,
    },
    exams: [{ id: 'EXAM_G10_MATH', course_id: 'G10_MATH', duration_minutes: 60 }],
  });
  const invalid = structuredClone(solved);
  invalid.sessions[0] = {
    ...invalid.sessions[0],
    day_index: 3,
    day_label: '第 4 天',
    global_start_unit: 36,
    start_unit: 0,
    end_unit: 12,
  };

  const validation = validateExamSchedule(state, solved.plan, invalid);

  assert.equal(validation.ok, false);
  assert.equal(validation.violations.some(item => item.code === 'GRADE_DAY_LIMIT_EXCEEDED'), true);
});

test('independent validation rejects a seat list that does not match its room roster', async () => {
  const state = schoolState();
  const solved = await solveExamSchedule(state, {
    config: {
      day_count: 3,
      day_start: '08:00',
      day_end: '12:00',
      breaks: [],
      room_count: 2,
      room_capacity: 30,
      require_every_teacher_invigilates: false,
    },
    exams: [{ id: 'EXAM_MATH', course_id: 'MATH', duration_minutes: 60 }],
  });
  const invalid = structuredClone(solved);
  invalid.sessions[0].room_allocations[0].seats[0].student_id = 'S3';

  const validation = validateExamSchedule(state, solved.plan, invalid);

  assert.equal(validation.ok, false);
  assert.equal(validation.violations.some(item => item.code === 'INVALID_EXAM_SEATS'), true);
});

test('independent validation rejects unnecessarily uneven elective room rosters', async () => {
  const students = Array.from({ length: 35 }, (_, index) => ({
    id: `S${String(index + 1).padStart(3, '0')}`,
    grade: 10,
    ap_courses: ['AP_ART'],
  }));
  const state = {
    courses: [{ id: 'AP_ART', name: 'AP Art', type: 'ap', grade: 10 }],
    students,
    teachers: [],
    teaching_assignments: [],
  };
  const solved = await solveExamSchedule(state, {
    config: {
      day_count: 3,
      day_start: '08:00',
      day_end: '12:00',
      breaks: [],
      room_count: 2,
      room_capacity: 30,
      require_every_teacher_invigilates: false,
    },
    exams: [{ id: 'EXAM_AP_ART', course_id: 'AP_ART', duration_minutes: 60 }],
  });
  const invalid = structuredClone(solved);
  const [left, right] = invalid.sessions[0].room_allocations;
  left.student_ids.push(...right.student_ids.splice(-2));
  for (const room of [left, right]) {
    room.seats = room.student_ids.map((studentId, index) => ({
      seat_number: index + 1,
      student_id: studentId,
    }));
  }

  const validation = validateExamSchedule(state, solved.plan, invalid);

  assert.equal(validation.ok, false);
  assert.equal(validation.violations.some(item => item.code === 'UNBALANCED_EXAM_ROOMS'), true);
});

test('independent validation requires exactly one actually assigned chief for every exam', async () => {
  const state = schoolState();
  state.teachers = [
    { id: 'T_MATH', name: '数学教师', can_teach: ['MATH'] },
    { id: 'T_OTHER', name: '其他学科教师', can_teach: [] },
  ];
  state.teaching_assignments = [{ id: 'TA_MATH', teacher_id: 'T_MATH', course_id: 'MATH' }];
  const solved = await solveExamSchedule(state, {
    config: {
      day_count: 3,
      day_start: '08:00',
      day_end: '12:00',
      breaks: [],
      room_count: 1,
      room_capacity: 30,
      require_every_teacher_invigilates: false,
    },
    exams: [{ id: 'EXAM_MATH', course_id: 'MATH', duration_minutes: 60 }],
  });

  const invalid = structuredClone(solved);
  invalid.sessions[0].chief_teacher_ids = [];
  const validation = validateExamSchedule(state, solved.plan, invalid);

  assert.equal(validation.ok, false);
  assert.equal(validation.violations.some(item => item.code === 'CHIEF_TEACHER_COUNT'), true);
});
