import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applyTeacherAssignmentSwap,
  inferTeacherAssignmentSwap,
  teacherAssignmentSwapProposal,
} from '../src/assistant-actions.mjs';

const state = {
  meta: { revision: 8 },
  schedule: { assignments: [] },
  manual_plan: { status: 'confirmed' },
  teachers: [
    { id: 'T_A', name: '甲老师', can_teach: ['C_A', 'C_B'] },
    { id: 'T_B', name: '乙老师', can_teach: ['C_A', 'C_B'] },
  ],
  courses: [
    { id: 'C_A', name: '课程甲' },
    { id: 'C_B', name: '课程乙' },
  ],
  teaching_assignments: [
    { id: 'TA_A', teacher_id: 'T_A', course_id: 'C_A', class_ids: ['TC1'], class_type: 'teaching', weekly_hours: 2 },
    { id: 'TA_B', teacher_id: 'T_B', course_id: 'C_B', class_ids: ['TC2'], class_type: 'teaching', weekly_hours: 3 },
  ],
};

test('builds a confirmable teacher-assignment swap only for mutually qualified teachers', () => {
  const proposal = teacherAssignmentSwapProposal(state, ['TA_A', 'TA_B']);
  assert.equal(proposal.expected_revision, 8);
  assert.equal(proposal.assignments[0].teacher_name, '甲老师');
  assert.match(proposal.impacts.join('\n'), /待重排/);
  assert.match(proposal.impacts.join('\n'), /待重新确认/);
  const applied = applyTeacherAssignmentSwap(state, ['TA_A', 'TA_B']);
  assert.equal(applied.teachingAssignments.find(item => item.id === 'TA_A').teacher_id, 'T_B');
  assert.equal(applied.teachingAssignments.find(item => item.id === 'TA_B').teacher_id, 'T_A');
});

test('rejects a teacher exchange that would violate teacher qualification', () => {
  const invalid = structuredClone(state);
  invalid.teachers[1].can_teach = ['C_B'];
  assert.throws(
    () => teacherAssignmentSwapProposal(invalid, ['TA_A', 'TA_B']),
    /授课资格/,
  );
});

test('resolves an explicit two-teacher, two-grade request only when it is unique', () => {
  const graded = structuredClone(state);
  graded.teaching_classes = [{ id: 'TC1', grade: 10 }, { id: 'TC2', grade: 11 }];
  assert.deepEqual(
    inferTeacherAssignmentSwap(graded, '请将甲老师负责的高一课程甲与乙老师负责的高二课程乙调换'),
    ['TA_A', 'TA_B'],
  );
  assert.deepEqual(
    inferTeacherAssignmentSwap(graded, '请将甲老师负责的高 10课程甲与乙老师负责的高 11课程乙调换'),
    ['TA_A', 'TA_B'],
  );
  const ambiguous = structuredClone(graded);
  ambiguous.teaching_assignments.push({
    id: 'TA_A_ALT', teacher_id: 'T_A', course_id: 'C_B', class_ids: ['TC1'], class_type: 'teaching', weekly_hours: 1,
  });
  assert.equal(inferTeacherAssignmentSwap(ambiguous, '请调换甲老师和乙老师的课'), null);
});
