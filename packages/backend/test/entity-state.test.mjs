import assert from 'node:assert/strict';
import test from 'node:test';
import {
  deleteEntityFromState,
  entityDependencies,
  validateEntityInput,
} from '../src/entity-state.mjs';

function state() {
  return {
    courses: [{ id: 'AP_BIO', name: 'AP Biology' }, { id: 'AP_CHEM' }, { id: 'AP_PHYS' }],
    teachers: [{ id: 'T1', can_teach: ['AP_BIO', 'AP_CHEM'] }],
    students: [{
      id: 'S1', grade: 11, ap_courses: ['AP_BIO'],
      elective_choices: { group_a: 'AP_BIO' },
    }],
    teaching_assignments: [{ id: 'TA1', course_id: 'AP_BIO', teacher_id: 'T1', class_ids: ['TC1'] }],
    teaching_classes: [{ id: 'TC1', grade: 11 }],
    admin_classes: [],
    selection_blocks: [{
      id: 'B1', choice_key: 'group_a', grades: [11], required: false,
      allowed_course_ids: ['AP_BIO', 'AP_CHEM', 'AP_PHYS'],
    }],
    constraints: [],
    ap_block_config: {
      enabled: true,
      blocks: [{ id: 'B1', name: 'Block 1', slots: [] }, { id: 'B2', name: 'Block 2', slots: [] }],
      course_block_ids: { AP_BIO: ['B1'], AP_CHEM: ['B2'] },
      offering_block_ids: {},
    },
  };
}

test('previews every live course reference before deletion', () => {
  const dependencies = entityDependencies(state(), 'courses', 'AP_BIO');
  assert.deepEqual(dependencies.map(item => item.kind).sort(), [
    'ap_block_config',
    'selection_block',
    'student_ap_selection',
    'student_elective_choice',
    'teacher_qualification',
    'teaching_assignment',
  ]);
});

test('blocks an in-use entity unless cascade was explicitly confirmed', () => {
  assert.throws(
    () => deleteEntityFromState(state(), 'courses', 'AP_BIO'),
    error => error.code === 'ENTITY_IN_USE' && error.dependencies.length === 6,
  );
});

test('cascades a confirmed course deletion without leaving stale references', () => {
  const result = deleteEntityFromState(state(), 'courses', 'AP_BIO', { cascade: true });
  assert.deepEqual(result.state.courses.map(item => item.id), ['AP_CHEM', 'AP_PHYS']);
  assert.deepEqual(result.state.teaching_assignments, []);
  assert.deepEqual(result.state.teachers[0].can_teach, ['AP_CHEM']);
  assert.deepEqual(result.state.students[0].ap_courses, []);
  assert.deepEqual(result.state.students[0].elective_choices, {});
  assert.deepEqual(result.state.selection_blocks[0].allowed_course_ids, ['AP_CHEM', 'AP_PHYS']);
  assert.equal(result.state.ap_block_config.course_block_ids.AP_BIO, undefined);
});

test('requires teacher workload upper limits to be non-negative integers', () => {
  assert.doesNotThrow(() => validateEntityInput('teachers', {
    id: 'T1', can_teach: [], max_per_week: 0, max_per_day: 0,
  }));
  assert.throws(
    () => validateEntityInput('teachers', {
      id: 'T1', can_teach: [], max_per_week: -1, max_per_day: 1,
    }),
    /每周上限.*非负整数/,
  );
  assert.throws(
    () => validateEntityInput('teachers', {
      id: 'T1', can_teach: [], max_per_week: 5, max_per_day: 1.5,
    }),
    /每天上限.*非负整数/,
  );
});

test('requires teacher available slots to be a unique list of timetable slot ids', () => {
  assert.throws(
    () => validateEntityInput('teachers', {
      id: 'T1', can_teach: [], available_slots: 'D1P1',
    }),
    /可用时段必须是数组/,
  );
});

test('rejects duplicate teacher available slots', () => {
  assert.throws(
    () => validateEntityInput('teachers', {
      id: 'T1', can_teach: [], available_slots: ['D1P1', 'D1P1'],
    }),
    /可用时段不能重复/,
  );
});

test('rejects an unknown teacher available slot id', () => {
  assert.throws(
    () => validateEntityInput('teachers', {
      id: 'T1', can_teach: [], available_slots: ['MONDAY_MORNING'],
    }),
    /可用时段无效.*MONDAY_MORNING/,
  );
});
