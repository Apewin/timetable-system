import assert from 'node:assert/strict';
import test from 'node:test';
import { apGroupDetail, listApGroups } from '../src/ap-group-projection.mjs';

const state = {
  courses: [{ id: 'BIO', name: 'AP Biology' }],
  teachers: [{ id: 'T1', name: 'Teacher One' }],
  students: [{ id: 'S1', name: '学生一', grade: 11 }],
  schedule: { sections: [{
    id: 'SEC_AP_BIO_1', class_type: 'ap', course_id: 'BIO', teacher_id: 'T1',
    grades: [11], student_ids: ['S1'],
  }] },
};

test('projects the small AP group list without exposing the whole persisted state', () => {
  assert.deepEqual(listApGroups(state), [{
    id: 'SEC_AP_BIO_1', course_id: 'BIO', course_name: 'AP Biology',
    teacher_id: 'T1', teacher_name: 'Teacher One', grades: [11], student_count: 1,
  }]);
});

test('returns the selected AP roster with display identities', () => {
  const detail = apGroupDetail(state, 'SEC_AP_BIO_1');
  assert.equal(detail.section.course_name, 'AP Biology');
  assert.equal(detail.students[0].name, '学生一');
  assert.equal(detail.students[0].id, 'S1');
});
