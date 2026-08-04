import assert from 'node:assert/strict';
import test from 'node:test';
import { compileRules } from '../src/rule-compiler.mjs';

test('can target only students with all required selection blocks completed', () => {
  const state = {
    students: [
      { id: 'COMPLETE', grade: 12, elective_choices: { group_b: 'BUSINESS' } },
      { id: 'INCOMPLETE', grade: 12, elective_choices: {} },
    ],
    selection_blocks: [{
      id: 'G12_B',
      grades: [12],
      required: true,
      choice_key: 'group_b',
    }],
  };
  const rules = [{
    id: 'student-daily-prefix',
    type: 'no_internal_gaps',
    hard: true,
    scope: 'student',
    params: { selector: { require_complete_required_choices: true } },
  }];

  const [compiled] = compileRules(state, rules);

  assert.deepEqual(compiled.target_ids, ['COMPLETE']);
});

test('can target students by their modeled weekly course load', () => {
  const state = {
    students: [{ id: 'FULL' }, { id: 'SHORT' }],
  };
  const sections = [
    { id: 'FULL_LOAD', student_ids: ['FULL'], weekly_hours: 5 },
    { id: 'SHORT_LOAD', student_ids: ['SHORT'], weekly_hours: 2 },
  ];
  const rules = [{
    id: 'student-daily-prefix',
    type: 'no_internal_gaps',
    hard: true,
    scope: 'student',
    params: { selector: { min_weekly_hours: 4 } },
  }];

  const [compiled] = compileRules(state, rules, { sections });

  assert.deepEqual(compiled.target_ids, ['FULL']);
});

test('compiles a teacher unavailable-slot rule onto every section taught by that teacher', () => {
  const state = {
    teachers: [{ id: 'T1' }, { id: 'T2' }],
  };
  const sections = [
    { id: 'T1_A', teacher_id: 'T1', class_type: 'teaching', student_ids: [] },
    { id: 'T1_B', teacher_id: 'T1', class_type: 'ap', student_ids: [] },
    { id: 'T2_A', teacher_id: 'T2', class_type: 'teaching', student_ids: [] },
  ];
  const [compiled] = compileRules(state, [{
    id: 'teacher_unavailability_T1',
    type: 'forbid_slots',
    hard: true,
    scope: 'teacher',
    target_id: 'T1',
    params: { slots: ['D2P3'] },
  }], { sections });

  assert.deepEqual(compiled.target_ids, ['T1']);
  assert.deepEqual(compiled.section_target_ids.sort(), ['T1_A', 'T1_B']);
});
