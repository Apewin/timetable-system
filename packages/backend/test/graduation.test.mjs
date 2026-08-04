import assert from 'node:assert/strict';
import test from 'node:test';
import {
  GRADUATION_CONFIRMATION,
  graduateStudents,
  graduationArchiveSummary,
  graduationPreview,
} from '../src/graduation.mjs';

function baseState(overrides = {}) {
  return {
    meta: { revision: 19 },
    courses: [
      { id: 'AP_G11', name: '仅高二 AP', type: 'ap', grade: 11 },
      { id: 'AP_SHARED', name: '跨年级 AP', type: 'ap', grade: [11, 12] },
      { id: 'ELECTIVE_G12', name: '高三选修', type: 'required_elective', grade: 12 },
    ],
    admin_classes: [
      { id: 'AC10', name: '高一(1)班', grade: 10 },
      { id: 'AC11', name: '高二(1)班', grade: 11 },
      { id: 'AC12', name: '高三(1)班', grade: 12 },
    ],
    teaching_classes: [
      { id: 'TC_G10_1', name: '高一教学1班', grade: 10 },
      { id: 'TC_G11_1', name: '高二教学1班', grade: 11 },
      { id: 'TC_G12_1', name: '高三教学1班', grade: 12 },
    ],
    students: [
      { id: 'S10', name: '高一学生', grade: 10, admin_class_id: 'AC10', teaching_class_id: 'TC_G10_1', ap_courses: [], elective_choices: {} },
      { id: 'S11', name: '高二学生', grade: 11, admin_class_id: 'AC11', teaching_class_id: 'TC_G11_1', ap_courses: ['AP_G11', 'AP_SHARED'], elective_courses: ['ELECTIVE_G12'], elective_choices: { group_a: 'ELECTIVE_G12' } },
      { id: 'S12', name: '毕业学生', english_name: 'Graduate', grade: 12, admin_class_id: 'AC12', teaching_class_id: 'TC_G12_1', ap_courses: ['AP_SHARED'], elective_choices: { group_a: 'ELECTIVE_G12' } },
    ],
    graduation_archives: [],
    ...overrides,
  };
}

test('graduates Senior 3, clears every active elective selection, and retains a graduation selection snapshot', () => {
  const state = baseState();
  const preview = graduationPreview(state);
  assert.equal(preview.confirmation_phrase, GRADUATION_CONFIRMATION);
  assert.equal(preview.graduating_students, 1);
  assert.deepEqual(preview.active_selection_totals_to_clear, {
    ap_course_entries: 2,
    elective_course_entries: 1,
    elective_choice_entries: 1,
    students_with_ap: 1,
    students_with_electives: 1,
  });
  assert.equal(preview.active_selection_entries_to_clear, 4);

  const result = graduateStudents(state, { confirmedBy: '教务管理员', now: '2026-08-03T08:00:00.000Z' });
  assert.deepEqual(result.next.students.map(student => [student.id, student.grade]), [['S10', 11], ['S11', 12]]);
  assert.deepEqual(result.next.students.map(student => [student.id, student.admin_class_id, student.teaching_class_id]), [
    ['S10', 'AC11', 'TC_G11_1'],
    ['S11', 'AC12', 'TC_G12_1'],
  ]);
  assert.deepEqual(result.next.students.find(student => student.id === 'S11').ap_courses, []);
  assert.deepEqual(result.next.students.find(student => student.id === 'S11').elective_courses, []);
  assert.deepEqual(result.next.students.find(student => student.id === 'S11').elective_choices, {});
  assert.deepEqual(result.next.admin_classes.map(item => [item.id, item.grade, item.name, item.student_ids]), [
    ['AC10', 10, '高一(1)班', []],
    ['AC11', 11, '高二(1)班', ['S10']],
    ['AC12', 12, '高三(1)班', ['S11']],
  ]);
  assert.deepEqual(result.next.teaching_classes.map(item => [item.id, item.grade, item.student_ids]), [
    ['TC_G10_1', 10, []],
    ['TC_G11_1', 11, ['S10']],
    ['TC_G12_1', 12, ['S11']],
  ]);
  assert.equal(result.archive.students[0].student_id, 'S12');
  assert.deepEqual(result.archive.students[0].ap_courses, ['AP_SHARED']);
  assert.deepEqual(result.archive.students[0].elective_choices, { group_a: 'ELECTIVE_G12' });
  assert.deepEqual(graduationArchiveSummary(result.archive), {
    id: result.archive.id,
    name: '毕业学生选课信息 · 2026-08-03',
    graduated_at: '2026-08-03T08:00:00.000Z',
    confirmed_by: '教务管理员',
    source_revision: 19,
    graduate_count: 1,
    ap_course_entries: 1,
    elective_course_entries: 0,
    elective_choice_entries: 1,
    cleared_active_selection_entries: 4,
  });
});

test('refuses a rollover when class slots cannot be matched safely', () => {
  const state = baseState({
    teaching_classes: [
      { id: 'TC_G10_1', grade: 10 },
      { id: 'TC_G10_2', grade: 10 },
      { id: 'TC_G11_1', grade: 11 },
      { id: 'TC_G12_1', grade: 12 },
    ],
  });
  assert.throws(() => graduationPreview(state), /班级数量不一致/);
});

test('refuses to graduate twice when no Senior 3 student remains', () => {
  const state = baseState({ students: baseState().students.filter(student => student.grade !== 12) });
  assert.throws(() => graduationPreview(state), /没有 Senior 3 学生/);
});
