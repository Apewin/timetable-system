import assert from 'node:assert/strict';
import test from 'node:test';
import { synchronizeClassMemberships } from '../src/state-integrity.mjs';

const classes = {
  admin_classes: [
    { id: 'AC1', name: '行政一班', grade: 11, student_ids: ['STALE'] },
    { id: 'AC2', name: '行政二班', grade: 11, student_ids: [] },
  ],
  teaching_classes: [
    { id: 'TC1', name: '教学一班', grade: 11, student_ids: [] },
    { id: 'TC2', name: '教学二班', grade: 11, student_ids: ['STALE'] },
  ],
};

test('derives both class rosters from canonical student class references', () => {
  const result = synchronizeClassMemberships({
    ...classes,
    students: [
      { id: 'S2', grade: 11, admin_class_id: 'AC2', teaching_class_id: 'TC1' },
      { id: 'S1', grade: 11, admin_class_id: 'AC1', teaching_class_id: 'TC2' },
    ],
  });
  assert.deepEqual(result.admin_classes.map(item => item.student_ids), [['S1'], ['S2']]);
  assert.deepEqual(result.teaching_classes.map(item => item.student_ids), [['S2'], ['S1']]);
  assert.deepEqual(result.admin_classes.map(item => item.student_count), [1, 1]);
});

test('rejects a student reference to an unknown class', () => {
  assert.throws(() => synchronizeClassMemberships({
    ...classes,
    students: [{ id: 'S1', grade: 11, admin_class_id: 'MISSING', teaching_class_id: 'TC1' }],
  }), /不存在的行政班 MISSING/);
});

test('rejects class ids duplicated across administrative and teaching classes', () => {
  assert.throws(() => synchronizeClassMemberships({
    students: [],
    admin_classes: [{ id: 'SAME', grade: 11 }],
    teaching_classes: [{ id: 'SAME', grade: 11 }],
  }), /行政班和教学班.*重复/);
});
