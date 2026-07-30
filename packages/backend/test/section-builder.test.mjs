import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { buildSections } from '../src/section-builder.mjs';

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
    courses: [{ id: 'BIO', type: 'ap', weekly_hours: 5, section_count: 1 }],
    teachers: [{ id: 'T_BIO', can_teach: ['BIO'] }],
    rooms: [{ id: 'LAB', type: 'biology', capacity: 30 }],
  }));

  assert.equal(sections.length, 1);
  assert.deepEqual(sections[0].student_ids, ['S11', 'S12']);
  assert.deepEqual(sections[0].eligible_student_ids, ['S11', 'S12']);
  assert.deepEqual(sections[0].room_candidates, ['LAB']);
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

test('does not bind teaching classes to their nominal classroom before scheduling', () => {
  const sections = buildSections(state({
    students: [{ id: 'S1', grade: 11, ap_courses: [], elective_choices: {} }],
    courses: [{ id: 'C', type: 'required', weekly_hours: 1 }],
    teachers: [{ id: 'T', can_teach: ['C'] }],
    rooms: [{ id: 'R1', type: 'general', capacity: 30 }, { id: 'R2', type: 'general', capacity: 30 }],
    teaching_classes: [{ id: 'TC', student_ids: ['S1'], fixed_room_id: 'R1' }],
    teaching_assignments: [{ id: 'TA', class_type: 'teaching', class_ids: ['TC'], course_id: 'C', teacher_id: 'T', weekly_hours: 1 }],
  }));

  assert.equal(sections[0].room_binding, 'flexible');
  assert.deepEqual(sections[0].room_candidates, ['R1', 'R2']);
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

test('normalizes the actual school data without changing section or student workload totals', t => {
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
  assert.equal(sections.length, 135);
  assert.equal(sections.reduce((total, section) => total + section.weekly_hours, 0), 427);
  assert.deepEqual([...hours].filter(([, weeklyHours]) => weeklyHours !== 50), []);
});
