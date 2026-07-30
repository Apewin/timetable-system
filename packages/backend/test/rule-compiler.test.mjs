import assert from 'node:assert/strict';
import test from 'node:test';
import { compileRules } from '../src/rule-compiler.mjs';

test('selects cross-grade teachers through section data, without naming a course', () => {
  const state = {
    teachers: [{ id: 'T_CROSS' }, { id: 'T_SINGLE' }],
    students: [{ id: 'S11', grade: 11 }, { id: 'S12', grade: 12 }],
  };
  const sections = [
    { id: 'G11_AP', teacher_id: 'T_CROSS', class_type: 'ap', eligible_student_ids: ['S11'] },
    { id: 'G12_AP', teacher_id: 'T_CROSS', class_type: 'ap', eligible_student_ids: ['S12'] },
    { id: 'CORE', teacher_id: 'T_CROSS', class_type: 'teaching', student_ids: ['S11'] },
    { id: 'SINGLE', teacher_id: 'T_SINGLE', class_type: 'ap', eligible_student_ids: ['S11'] },
  ];
  const [rule] = compileRules(state, [{
    id: 'cross-grade', type: 'priority', hard: false, weight: 1, scope: 'teacher',
    params: { selector: { teaches_grades: [11, 12], section_class_types: ['ap'] }, rank: 1 },
  }], { sections });
  assert.deepEqual(rule.target_ids, ['T_CROSS']);
  assert.deepEqual(rule.section_target_ids, ['G11_AP', 'G12_AP']);
});
