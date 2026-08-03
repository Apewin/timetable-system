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
