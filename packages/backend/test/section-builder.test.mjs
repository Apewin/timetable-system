import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import {
  buildSections,
  normalizeCourseGradeRange,
  normalizeCourseScope,
  validateCourseGradeSelections,
} from '../src/section-builder.mjs';

function state(overrides = {}) {
  return {
    teachers: [], rooms: [], courses: [], students: [],
    admin_classes: [], teaching_classes: [], teaching_assignments: [],
    ...overrides,
  };
}

test('keeps a mixed-grade AP cohort together when its section requirement permits it', () => {
  const sections = buildSections(state({
    students: [
      { id: 'S11', grade: 11, ap_courses: ['BIO'], elective_choices: {} },
      { id: 'S12', grade: 12, ap_courses: ['BIO'], elective_choices: {} },
    ],
    courses: [{ id: 'BIO', type: 'ap', grade: [11, 12], weekly_hours: 5, section_count: 1 }],
    teachers: [{ id: 'T_BIO', can_teach: ['BIO'] }],
    rooms: [{ id: 'LAB', type: 'biology', capacity: 30 }],
  }));

  assert.equal(sections.length, 1);
  assert.deepEqual(sections[0].student_ids, ['S11', 'S12']);
  assert.deepEqual(sections[0].eligible_student_ids, ['S11', 'S12']);
  assert.equal(sections[0].room_id, null);
  assert.deepEqual(sections[0].room_candidates, []);
});

test('rejects an existing selection outside the edited course grade range', () => {
  assert.throws(() => validateCourseGradeSelections(state({
    students: [{ id: 'S12', name: '高三学生', grade: 12, ap_courses: ['BIO'], elective_choices: {} }],
    courses: [{ id: 'BIO', name: 'AP Biology', type: 'ap', grade: 11, weekly_hours: 5 }],
  })), /高三学生.*不在该课程的新适用年级范围内/);
});

test('normalizes a narrowed grade range and removes obsolete section requirements', () => {
  const course = normalizeCourseGradeRange({
    id: 'MACRO',
    grade: [12, 11, 11],
    section_requirements: [
      { grades: [11], count: 1, teacher_id: 'T11' },
      { grades: [12], count: 2, teacher_id: 'T12' },
    ],
  });
  assert.deepEqual(course.grade, [11, 12]);

  const narrowed = normalizeCourseGradeRange({ ...course, grade: 11 });
  assert.equal(narrowed.grade, 11);
  assert.deepEqual(narrowed.section_requirements, [
    { grades: [11], count: 1, teacher_id: 'T11' },
  ]);
});

test('generates layered required-course tasks only for selected high-two teaching classes', () => {
  const sections = buildSections(state({
    students: [
      { id: 'S1', grade: 11, ap_courses: [], elective_choices: {} },
      { id: 'S2', grade: 11, ap_courses: [], elective_choices: {} },
    ],
    courses: [{
      id: 'HONOR',
      name: '分层必修',
      type: 'required',
      grade: 11,
      applicable_class_ids: ['TC_G11_1'],
      weekly_hours: 2,
    }],
    teaching_classes: [
      { id: 'TC_G11_1', name: '高二教学1班', grade: 11, student_ids: ['S1'], fixed_room_id: 'R' },
      { id: 'TC_G11_2', name: '高二教学2班', grade: 11, student_ids: ['S2'], fixed_room_id: 'R' },
    ],
    teachers: [{ id: 'T', can_teach: ['HONOR'] }],
    rooms: [{ id: 'R', type: 'general', capacity: 30 }],
    teaching_assignments: [{
      id: 'TA',
      class_type: 'teaching',
      class_ids: ['TC_G11_1', 'TC_G11_2'],
      course_id: 'HONOR',
      teacher_id: 'T',
      weekly_hours: 2,
    }],
  }));
  assert.equal(sections.length, 1);
  assert.equal(sections[0].class_id, 'TC_G11_1');
  assert.deepEqual(sections[0].student_ids, ['S1']);
});

test('does not create a section from a stale assignment outside the course grade', () => {
  const sections = buildSections(state({
    students: [],
    courses: [{ id: 'GUIDANCE', type: 'required', grade: 10, weekly_hours: 2 }],
    teachers: [{ id: 'T', can_teach: ['GUIDANCE'] }],
    teaching_classes: [{ id: 'TC_G11_1', grade: 11, student_ids: [] }],
    teaching_assignments: [{
      id: 'TA_GUIDANCE', course_id: 'GUIDANCE', teacher_id: 'T', class_type: 'teaching',
      class_ids: ['TC_G11_1'], weekly_hours: 2,
    }],
  }));

  assert.deepEqual(sections, []);
});

test('creates visible placeholder sections for a configured required course without a teacher assignment', () => {
  const sections = buildSections(state({
    students: [],
    courses: [{
      id: 'BIO', type: 'required', grade: 10, weekly_hours: 2,
      delivery_class_type_by_grade: { 10: 'admin' },
    }],
    admin_classes: [
      { id: 'AC1', grade: 10, student_ids: [] },
      { id: 'AC2', grade: 10, student_ids: [] },
    ],
    teaching_assignments: [],
  }));

  assert.deepEqual(sections.map(section => [section.id, section.class_id, section.teacher_id]), [
    ['SEC_admin_UNASSIGNED_BIO_AC1', 'AC1', null],
    ['SEC_admin_UNASSIGNED_BIO_AC2', 'AC2', null],
  ]);
  assert.match(sections[0].warnings.join(' '), /尚未配置教师分工/);
});

test('removes the high-two class scope when high two is removed from a course', () => {
  const normalized = normalizeCourseScope({
    id: 'ONLY_G12',
    grade: 12,
    applicable_class_ids: ['TC_G11_1'],
  });
  assert.equal(normalized.grade, 12);
  assert.equal(normalized.applicable_class_ids, undefined);
});

test('uses per-grade teacher and section requirements without treating teacher count as a section limit', () => {
  const sections = buildSections(state({
    students: [
      { id: 'S11', grade: 11, ap_courses: ['MACRO'], elective_choices: {} },
      { id: 'S12A', grade: 12, ap_courses: ['MACRO'], elective_choices: {} },
      { id: 'S12B', grade: 12, ap_courses: ['MACRO'], elective_choices: {} },
    ],
    courses: [{ id: 'MACRO', type: 'ap', weekly_hours: 5, section_requirements: [
      { grades: [11], count: 1, teacher_id: 'T11' },
      { grades: [12], count: 2, teacher_id: 'T12' },
    ] }],
    teachers: [{ id: 'T11', can_teach: ['MACRO'] }, { id: 'T12', can_teach: ['MACRO'] }],
    rooms: [{ id: 'R', type: 'general', capacity: 30 }],
  }));

  assert.equal(sections.length, 3);
  assert.equal(sections.filter(section => section.teacher_id === 'T11').length, 1);
  assert.equal(sections.filter(section => section.teacher_id === 'T12').length, 2);
  assert.ok(sections.filter(section => section.teacher_id === 'T11').every(section => section.student_ids.includes('S11')));
});

test('does not bind teaching classes to any classroom during scheduling', () => {
  const sections = buildSections(state({
    students: [{ id: 'S1', grade: 11, ap_courses: [], elective_choices: {} }],
    courses: [{ id: 'C', type: 'required', weekly_hours: 1 }],
    teachers: [{ id: 'T', can_teach: ['C'] }],
    rooms: [{ id: 'R1', type: 'general', capacity: 30 }, { id: 'R2', type: 'general', capacity: 30 }],
    teaching_classes: [{ id: 'TC', student_ids: ['S1'], fixed_room_id: 'R1' }],
    teaching_assignments: [{ id: 'TA', class_type: 'teaching', class_ids: ['TC'], course_id: 'C', teacher_id: 'T', weekly_hours: 1 }],
  }));

  assert.equal(sections[0].room_binding, 'disabled');
  assert.equal(sections[0].room_id, null);
  assert.deepEqual(sections[0].room_candidates, []);
});

test('rejects a required-course assignment whose teacher is not qualified for the course', () => {
  assert.throws(() => buildSections(state({
    students: [{ id: 'S1', grade: 11, ap_courses: [], elective_choices: {} }],
    courses: [{ id: 'C', type: 'required', weekly_hours: 1 }],
    teachers: [{ id: 'T', can_teach: [] }],
    rooms: [{ id: 'R', type: 'general', capacity: 30 }],
    teaching_classes: [{ id: 'TC', student_ids: ['S1'], fixed_room_id: 'R' }],
    teaching_assignments: [{ id: 'TA', class_type: 'teaching', class_ids: ['TC'], course_id: 'C', teacher_id: 'T', weekly_hours: 1 }],
  })), /未配置为可教授/);
});

test('models per-class staffing as independent teachers instead of one shared teacher resource', () => {
  const sections = buildSections(state({
    courses: [{ id: 'ADVISORY', type: 'other', grade: 11, weekly_hours: 1 }],
    teachers: [{ id: 'HOMEROOM_ROLE', can_teach: ['ADVISORY'] }],
    rooms: [
      { id: 'R1', type: 'general', capacity: 30 },
      { id: 'R2', type: 'general', capacity: 30 },
    ],
    admin_classes: [
      { id: 'AC1', name: '一班', grade: 11, student_ids: [], fixed_room_id: 'R1' },
      { id: 'AC2', name: '二班', grade: 11, student_ids: [], fixed_room_id: 'R2' },
    ],
    teaching_assignments: [{
      id: 'TA_ADVISORY',
      class_type: 'admin',
      class_ids: ['AC1', 'AC2'],
      course_id: 'ADVISORY',
      teacher_id: 'HOMEROOM_ROLE',
      staffing_mode: 'per_class',
      weekly_hours: 1,
    }],
  }));

  assert.equal(sections.length, 2);
  assert.ok(sections.every(section => section.teacher_id === null));
});

test('persists selected-section teacher and student transfer overrides into a rebuilt problem', () => {
  const sections = buildSections(state({
    students: [
      { id: 'S1', grade: 11, ap_courses: ['AP'], elective_choices: {} },
      { id: 'S2', grade: 11, ap_courses: ['AP'], elective_choices: {} },
    ],
    courses: [{ id: 'AP', type: 'ap', weekly_hours: 1, section_count: 2 }],
    teachers: [{ id: 'T1', can_teach: ['AP'] }, { id: 'T2', can_teach: ['AP'] }],
    rooms: [{ id: 'R', type: 'general', capacity: 30 }],
    section_overrides: {
      SEC_AP_AP_ALL_1: { teacher_id: 'T2' },
      SEC_AP_AP_ALL_2: { locked_student_ids: ['S1'] },
    },
  }));
  const first = sections.find(section => section.id === 'SEC_AP_AP_ALL_1');
  const second = sections.find(section => section.id === 'SEC_AP_AP_ALL_2');
  assert.equal(first.teacher_id, 'T2');
  assert.ok(!first.student_ids.includes('S1'));
  assert.deepEqual(second.locked_student_ids, ['S1']);
  assert.ok(second.student_ids.includes('S1'));
});

test('builds the actual school data without room-derived sections or capacity splits', t => {
  const school = JSON.parse(readFileSync(new URL('../../../timetable.json', import.meta.url), 'utf8'));
  const missingRequiredChoices = (school.selection_blocks || [])
    .filter(block => block.required)
    .some(block => (school.students || [])
      .filter(student => (block.grades || []).includes(student.grade))
      .some(student => !student.elective_choices?.[block.choice_key]));
  if (missingRequiredChoices) {
    t.skip('真实高三 A/B/C 选课尚未导入，完整学校数据断言暂不适用');
    return;
  }
  const sections = buildSections(school);
  const hours = new Map(school.students.map(student => [student.id, 0]));
  for (const section of sections) for (const studentId of section.student_ids) {
    hours.set(studentId, hours.get(studentId) + section.weekly_hours);
  }
  assert.equal(sections.length, 133);
  assert.equal(sections.reduce((total, section) => total + section.weekly_hours, 0), 417);
  assert.deepEqual([...hours].filter(([, weeklyHours]) => weeklyHours !== 50), []);
});
