import assert from 'node:assert/strict';
import test from 'node:test';
import { validateSelectionBlocks } from '../src/section-builder.mjs';

const courses = [
  { id: 'J', type: 'required_elective' },
  { id: 'F', type: 'required_elective' },
  { id: 'G', type: 'required_elective' },
  { id: 'X', type: 'required_elective' },
];
const block = { id: 'language', grades: [12], choice_key: 'language', allowed_course_ids: ['J', 'F', 'G'], required: true };

test('selection block accepts exactly one permitted course for each student', () => {
  assert.doesNotThrow(() => validateSelectionBlocks({ courses, selection_blocks: [block], students: [
    { id: 'S1', grade: 12, elective_choices: { language: 'J' } },
    { id: 'S2', grade: 12, elective_choices: { language: 'F' } },
  ] }));
});

test('selection block rejects a fourth course outside its allowed set', () => {
  assert.throws(() => validateSelectionBlocks({ courses, selection_blocks: [block], students: [
    { id: 'S1', grade: 12, elective_choices: { language: 'X' } },
  ] }), /不允许的课程 X/);
});
