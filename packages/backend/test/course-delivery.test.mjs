import assert from 'node:assert/strict';
import test from 'node:test';
import { synchronizeCourseDeliveryAssignments } from '../src/course-delivery.mjs';
import { buildSections } from '../src/section-builder.mjs';

function baseState(overrides = {}) {
  return {
    students: [
      { id: 'S1', grade: 11, admin_class_id: 'AC1', teaching_class_id: 'TC1', ap_courses: [], elective_choices: {} },
      { id: 'S2', grade: 11, admin_class_id: 'AC2', teaching_class_id: 'TC2', ap_courses: [], elective_choices: {} },
    ],
    courses: [{ id: 'MATH', name: '数学', type: 'required', grade: 11, weekly_hours: 2 }],
    teachers: [{ id: 'T1', can_teach: ['MATH'] }],
    admin_classes: [
      { id: 'AC1', grade: 11, student_ids: ['S1'] },
      { id: 'AC2', grade: 11, student_ids: ['S2'] },
    ],
    teaching_classes: [
      { id: 'TC1', grade: 11, student_ids: ['S1'] },
      { id: 'TC2', grade: 11, student_ids: ['S2'] },
    ],
    teaching_assignments: [{
      id: 'TA_MATH', course_id: 'MATH', teacher_id: 'T1', class_type: 'admin', class_ids: ['AC1', 'AC2'], weekly_hours: 2,
    }],
    selection_blocks: [],
    ...overrides,
  };
}

test('changing a course delivery mode rewrites its fixed-class assignments and sections', () => {
  const state = baseState();
  const nextCourse = {
    ...state.courses[0],
    delivery_class_type_by_grade: { 11: 'teaching' },
  };
  const assignments = synchronizeCourseDeliveryAssignments(state, state.courses[0], nextCourse);

  assert.deepEqual(assignments, [{
    id: 'TA_DELIVERY_MATH_G11_teaching',
    course_id: 'MATH', teacher_id: 'T1', class_type: 'teaching', class_ids: ['TC1', 'TC2'], weekly_hours: 2,
  }]);
  const sections = buildSections({ ...state, courses: [nextCourse], teaching_assignments: assignments });
  assert.deepEqual(sections.map(section => [section.class_type, section.class_id]), [
    ['teaching', 'TC1'], ['teaching', 'TC2'],
  ]);
});

test('refuses an ambiguous delivery conversion when a grade has different teachers', () => {
  const state = baseState({
    teachers: [{ id: 'T1', can_teach: ['MATH'] }, { id: 'T2', can_teach: ['MATH'] }],
    teaching_assignments: [
      { id: 'TA_MATH_1', course_id: 'MATH', teacher_id: 'T1', class_type: 'admin', class_ids: ['AC1'], weekly_hours: 2 },
      { id: 'TA_MATH_2', course_id: 'MATH', teacher_id: 'T2', class_type: 'admin', class_ids: ['AC2'], weekly_hours: 2 },
    ],
  });
  const nextCourse = {
    ...state.courses[0],
    delivery_class_type_by_grade: { 11: 'teaching' },
  };

  assert.throws(
    () => synchronizeCourseDeliveryAssignments(state, state.courses[0], nextCourse),
    /不同教师、课时或配班方式/,
  );
});
