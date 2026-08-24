import assert from 'node:assert/strict';
import test from 'node:test';

import {
  nextTeachingAssignmentId,
  summarizeTeacherWorkloads,
  teachersQualifiedForCourse,
  summarizeTeachingTasks,
} from '../teacher-assignment-view.mjs';

test('summarizes generated task records separately from weekly lesson periods', () => {
  assert.deepEqual(summarizeTeachingTasks([
    {
      id: 'SEC_1',
      class_type: 'teaching',
      teacher_id: 'T1',
      weekly_hours: 3,
      student_ids: ['S1', 'S2'],
    },
    {
      id: 'SEC_2',
      class_type: 'admin',
      teacher_id: null,
      weekly_hours: 5,
      student_ids: ['S2', 'S3'],
    },
  ]), {
    task_records: 2,
    weekly_periods: 8,
    unassigned_teacher_records: 1,
    unique_students: 3,
    type_counts: { teaching: 1, admin: 1, ap: 0, elective: 0, other: 0 },
  });
});

test('creates a readable unique assignment id from the selected course and teacher', () => {
  assert.equal(nextTeachingAssignmentId({
    courseId: 'BIO',
    teacherId: 'T Li',
    classType: 'admin',
    existingIds: ['TA_BIO_T_LI_ADMIN'],
  }), 'TA_BIO_T_LI_ADMIN_2');
});

test('keeps an empty generated-task state numerically explicit', () => {
  assert.deepEqual(summarizeTeachingTasks([]), {
    task_records: 0,
    weekly_periods: 0,
    unassigned_teacher_records: 0,
    unique_students: 0,
    type_counts: { teaching: 0, admin: 0, ap: 0, elective: 0, other: 0 },
  });
});

test('filters assignment teachers by the exact configured course id without subject guessing', () => {
  const teachers = [
    { id: 'T_BIO', name: '生物教师', can_teach: ['BIO'] },
    { id: 'T_PRE_BIO', name: 'Pre Biology 教师', can_teach: ['BIO_PRE'] },
    { id: 'T_NAME_ONLY', name: '另一位生物教师', can_teach: [] },
  ];
  assert.deepEqual(
    teachersQualifiedForCourse(teachers, 'BIO').map(teacher => teacher.id),
    ['T_BIO'],
  );
});

test('reports assigned teacher hours separately from the weekly upper limit', () => {
  const workloads = summarizeTeacherWorkloads(
    [{ id: 'T1', name: '数学教师', max_per_week: 25 }],
    [
      { teacher_id: 'T1', weekly_hours: 5, class_ids: ['TC1', 'TC2'] },
      {
        teacher_id: 'T1', weekly_hours: 2, class_ids: ['AC1', 'AC2'],
        staffing_mode: 'per_class',
      },
    ],
  );

  assert.deepEqual(workloads, [{
    id: 'T1',
    name: '数学教师',
    max_per_week: 25,
    assigned_weekly_hours: 10,
    remaining_weekly_capacity: 15,
    exceeds_weekly_limit: false,
  }]);
});
