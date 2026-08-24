import assert from 'node:assert/strict';
import test from 'node:test';
import ExcelJS from 'exceljs';

import { exportExamScheduleWorkbook } from '../src/exam-export.mjs';
import { solveExamSchedule } from '../src/exam-scheduling.mjs';

test('exports a usable workbook with schedule, teacher duties, and room seat assignments', async () => {
  const state = {
    courses: [{ id: 'MATH', name: '数学', type: 'required', grade: 10 }],
    students: [
      { id: 'S1', name: '张三', grade: 10, admin_class_id: 'AC1' },
      { id: 'S2', name: '李四', grade: 10, admin_class_id: 'AC1' },
    ],
    teachers: [],
    teaching_assignments: [],
  };
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
    exams: [{ id: 'EXAM_MATH', course_id: 'MATH', duration_minutes: 90 }],
  });

  const buffer = await exportExamScheduleWorkbook({ state, schedule: solved });
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);

  assert.deepEqual(workbook.worksheets.map(sheet => sheet.name), ['考试安排', '教师任务', '考场座次', '座次-数学']);
  assert.deepEqual(workbook.getWorksheet('考试安排').getRow(2).values.slice(1, 6), [
    '第 1 天', '08:00', '09:30', '数学', 90,
  ]);
  assert.deepEqual(workbook.getWorksheet('考场座次').getRow(2).values.slice(1, 8), [
    '第 1 天', '08:00', '数学', '考场 A', 1, 'S1', '张三',
  ]);
});

test('exports a 30-student room as five desk columns in a printable seating worksheet', async () => {
  const students = Array.from({ length: 30 }, (_, index) => ({
    id: `S${String(index + 1).padStart(2, '0')}`,
    name: `学生${String(index + 1).padStart(2, '0')}`,
    english_name: `English${String(index + 1).padStart(2, '0')}`,
    grade: 11,
    ap_courses: ['AP_MICRO'],
  }));
  const seats = students.map((student, index) => ({
    seat_number: index + 1,
    student_id: student.id,
  }));
  const schedule = {
    ok: true,
    plan: {
      config: { timetable_only: false, day_count: 1, start_date: '2027-01-21' },
    },
    sessions: [{
      exam_id: 'EXAM_AP_MICRO',
      day_index: 0,
      day_label: '第 1 天',
      start_time: '08:00',
      end_time: '09:30',
      course_name: 'AP 微观经济学',
      duration_minutes: 90,
      student_count: 30,
      chief_teacher_ids: [],
      room_allocations: [{
        room_id: 'EXAM_ROOM_1',
        room_name: '考场 A',
        student_ids: students.map(student => student.id),
        seats,
        invigilator_teacher_ids: [],
      }],
    }],
    teacher_loads: [],
  };

  const buffer = await exportExamScheduleWorkbook({ state: { students }, schedule });
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);

  const worksheet = workbook.getWorksheet('座次-AP 微观经济学');
  assert.ok(worksheet);
  assert.equal(worksheet.getCell('A1').value, 'AP 微观经济学\n2027-01-21 08:00-09:30');
  assert.equal(worksheet.getCell('E1').master.address, 'A1');
  assert.equal(worksheet.getCell('A2').value, '考场 A 讲台（30人）');
  assert.equal(worksheet.getCell('E2').master.address, 'A2');
  assert.equal(worksheet.getCell('A3').value, '学生01\nEnglish01');
  assert.equal(worksheet.getCell('E8').value, '学生30\nEnglish30');
  assert.equal(worksheet.getCell('F3').value, null);
});

test('exports a room below 30 students as four columns with a centered final row', async () => {
  const students = Array.from({ length: 26 }, (_, index) => ({
    id: `E${String(index + 1).padStart(2, '0')}`,
    name: `选修生${String(index + 1).padStart(2, '0')}`,
    english_name: `Elective${String(index + 1).padStart(2, '0')}`,
    grade: 12,
    ap_courses: ['AP_ES'],
  }));
  const schedule = {
    ok: true,
    plan: { config: { timetable_only: false, day_count: 1, start_date: '2027-01-22' } },
    sessions: [{
      exam_id: 'EXAM_AP_ES',
      day_index: 0,
      day_label: '第 1 天',
      start_time: '10:00',
      end_time: '11:30',
      course_name: 'AP 环境科学',
      duration_minutes: 90,
      student_count: 26,
      chief_teacher_ids: [],
      room_allocations: [{
        room_id: 'EXAM_ROOM_1',
        room_name: '考场 A',
        student_ids: students.map(student => student.id),
        seats: students.map((student, index) => ({ seat_number: index + 1, student_id: student.id })),
        invigilator_teacher_ids: [],
      }],
    }],
    teacher_loads: [],
  };

  const buffer = await exportExamScheduleWorkbook({ state: { students }, schedule });
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const worksheet = workbook.getWorksheet('座次-AP 环境科学');

  assert.equal(worksheet.getCell('D1').master.address, 'A1');
  assert.notEqual(worksheet.getCell('E1').master.address, 'A1');
  assert.equal(worksheet.getCell('A9').value, null);
  assert.equal(worksheet.getCell('B9').value, '选修生25\nElective25');
  assert.equal(worksheet.getCell('C9').value, '选修生26\nElective26');
  assert.equal(worksheet.getCell('D9').value, null);
});

test('wraps a fourth room into a new printable band below the first three rooms', async () => {
  const students = Array.from({ length: 16 }, (_, index) => ({
    id: `R${String(index + 1).padStart(2, '0')}`,
    name: `考生${String(index + 1).padStart(2, '0')}`,
  }));
  const rooms = Array.from({ length: 4 }, (_, roomIndex) => {
    const roomStudents = students.slice(roomIndex * 4, roomIndex * 4 + 4);
    return {
      room_id: `ROOM_${roomIndex + 1}`,
      room_name: `考场 ${String.fromCharCode(65 + roomIndex)}`,
      student_ids: roomStudents.map(student => student.id),
      seats: roomStudents.map((student, seatIndex) => ({
        seat_number: seatIndex + 1,
        student_id: student.id,
      })),
      invigilator_teacher_ids: [],
    };
  });
  const schedule = {
    ok: true,
    plan: { config: { timetable_only: false, day_count: 1 } },
    sessions: [{
      exam_id: 'EXAM_REQUIRED',
      day_index: 0,
      day_label: '第 1 天',
      start_time: '13:30',
      end_time: '15:00',
      course_name: '全年级必修考试',
      duration_minutes: 90,
      student_count: 16,
      chief_teacher_ids: [],
      room_allocations: rooms,
    }],
    teacher_loads: [],
  };

  const buffer = await exportExamScheduleWorkbook({ state: { students }, schedule });
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const worksheet = workbook.getWorksheet('座次-全年级必修考试');

  assert.equal(worksheet.getCell('A1').value, '全年级必修考试\n第 1 天 13:30-15:00');
  assert.equal(worksheet.getCell('K2').value, '考场 C 讲台（4人）');
  assert.equal(worksheet.getCell('A6').value, '全年级必修考试\n第 1 天 13:30-15:00');
  assert.equal(worksheet.getCell('A7').value, '考场 D 讲台（4人）');
  assert.equal(worksheet.getCell('A8').value, '考生13');
});

test('exports exactly the selected-course roster with Chinese and English names', async () => {
  const state = {
    courses: [{ id: 'AP_ES', name: 'AP 环境科学', type: 'ap', grade: 11 }],
    students: [
      { id: 'S1', name: '张三', english_name: 'Alex', grade: 11, ap_courses: ['AP_ES'] },
      { id: 'S2', name: '李四', english_name: 'Taylor', grade: 11, ap_courses: ['AP_ES'] },
      { id: 'S3', name: '未选课学生', english_name: 'Jordan', grade: 11, ap_courses: [] },
    ],
    teachers: [],
    teaching_assignments: [],
  };
  const solved = await solveExamSchedule(state, {
    config: {
      day_count: 3,
      day_start: '08:00',
      day_end: '10:00',
      breaks: [],
      room_count: 1,
      room_capacity: 30,
      require_every_teacher_invigilates: false,
    },
    exams: [{ id: 'EXAM_AP_ES', course_id: 'AP_ES', duration_minutes: 60 }],
  });

  const buffer = await exportExamScheduleWorkbook({ state, schedule: solved });
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const rosterSheet = workbook.getWorksheet('考场座次');
  const visualSheet = workbook.getWorksheet('座次-AP 环境科学');

  assert.equal(rosterSheet.getCell('H1').value, '英文名');
  assert.deepEqual(
    [rosterSheet.getCell('F2').value, rosterSheet.getCell('F3').value].sort(),
    ['S1', 'S2'],
  );
  assert.deepEqual(
    [rosterSheet.getCell('H2').value, rosterSheet.getCell('H3').value].sort(),
    ['Alex', 'Taylor'],
  );
  const visualNames = [visualSheet.getCell('B3').value, visualSheet.getCell('C3').value].sort();
  assert.deepEqual(visualNames, ['张三\nAlex', '李四\nTaylor'].sort());
  assert.equal(JSON.stringify(visualSheet.getSheetValues()).includes('未选课学生'), false);
});

test('exports timetable-only results as one combined and three grade workbooks sheets', async () => {
  const courses = [10, 11, 12].map(grade => ({
    id: `MATH_G${grade}`,
    name: `高${['一', '二', '三'][grade - 10]}数学`,
    type: 'required',
    grade,
  }));
  const state = { courses, students: [], teachers: [], teaching_assignments: [] };
  const solved = await solveExamSchedule(state, {
    config: {
      timetable_only: true,
      day_count: 3,
      start_date: '2027-01-21',
      day_start: '08:00',
      day_end: '12:00',
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

  const buffer = await exportExamScheduleWorkbook({ state, schedule: solved });
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);

  assert.deepEqual(workbook.worksheets.map(sheet => sheet.name), [
    '三年级考试时间表',
    '高一考试时间表',
    '高二考试时间表',
    '高三考试时间表',
  ]);
  const combined = workbook.getWorksheet('三年级考试时间表');
  assert.equal(combined.getCell('A2').value, '高一');
  assert.equal(combined.getCell('E2').value, '高二');
  assert.equal(combined.getCell('I2').value, '高三');
  assert.equal(workbook.getWorksheet('高一考试时间表').getCell('C4').value, '高一数学');
  assert.equal(workbook.getWorksheet('高二考试时间表').getCell('C4').value, '高二数学');
  assert.equal(workbook.getWorksheet('高三考试时间表').getCell('C4').value, '高三数学');
});
