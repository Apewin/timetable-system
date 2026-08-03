import assert from 'node:assert/strict';
import test from 'node:test';
import {
  expandUnlimitedManualHours,
  normalizeManualPlacements,
  resolveManualPlan,
} from '../src/manual-plan.mjs';

const state = {
  courses: [
    { id: 'MATH', name: '数学', type: 'required' },
    { id: 'AP_BIO', name: 'AP Biology', type: 'ap' },
    { id: 'AP_CHEM', name: 'AP Chemistry', type: 'ap' },
  ],
  students: [],
  admin_classes: [{ id: 'AC1', name: '行政一班', grade: 11 }],
  teaching_classes: [{ id: 'TC1', name: '教学一班', grade: 11 }],
};

const problem = {
  slots: [
    { id: 'D1P1', day: 1, period: 1 },
    { id: 'D1P2', day: 1, period: 2 },
  ],
  sections: [
    {
      id: 'SEC_MATH_TC1', course_id: 'MATH', class_id: 'TC1', class_type: 'teaching',
      teacher_id: 'T_MATH', weekly_hours: 2, grades: [11], student_ids: ['S1', 'S2'],
      eligible_student_ids: [],
    },
    {
      id: 'SEC_BIO_1', course_id: 'AP_BIO', class_id: null, class_type: 'ap',
      teacher_id: 'T_BIO', weekly_hours: 1, grades: [11], student_ids: ['S1'],
      eligible_student_ids: ['S1', 'S2'],
    },
    {
      id: 'SEC_BIO_2', course_id: 'AP_BIO', class_id: null, class_type: 'ap',
      teacher_id: 'T_BIO_2', weekly_hours: 1, grades: [11], student_ids: ['S2'],
      eligible_student_ids: ['S1', 'S2'],
    },
    {
      id: 'SEC_CHEM', course_id: 'AP_CHEM', class_id: null, class_type: 'ap',
      teacher_id: 'T_CHEM', weekly_hours: 1, grades: [11], student_ids: ['S1'],
      eligible_student_ids: ['S1'],
    },
  ],
};

test('resolves a required visual cell to the exact class section', () => {
  const result = resolveManualPlan(state, problem, [{
    class_id: 'TC1',
    slot_id: 'D1P1',
    item_id: 'MATH',
    item_name: '数学',
    course_ids: ['MATH'],
    section_ids: ['SEC_MATH_TC1'],
  }]);
  assert.deepEqual(result.locks.map(({ section_id, slot_id }) => ({ section_id, slot_id })), [
    { section_id: 'SEC_MATH_TC1', slot_id: 'D1P1' },
  ]);
  assert.equal(result.issues.length, 0);
});

test('requires an explicit section card for parallel AP sections', () => {
  assert.throws(() => resolveManualPlan(state, problem, [{
    class_id: 'TC1',
    slot_id: 'D1P1',
    item_id: 'AP_BIO',
    item_name: 'AP Biology',
    course_ids: ['AP_BIO'],
  }]), /具体课程卡/);
});

test('expands a synchronized bundle and reports student collisions', () => {
  const result = resolveManualPlan(state, problem, [{
    class_id: 'TC1',
    slot_id: 'D1P1',
    item_id: 'bundle:science',
    item_name: 'AP Biology / AP Chemistry',
    course_ids: ['AP_BIO', 'AP_CHEM'],
    section_ids: ['SEC_BIO_1', 'SEC_CHEM'],
  }]);
  assert.deepEqual(result.locks.map(lock => lock.section_id).sort(), ['SEC_BIO_1', 'SEC_CHEM']);
  assert.ok(result.issues.some(issue => issue.code === 'STUDENT_OVERLAP'));
});

test('rejects a section ID that does not belong to the selected class course', () => {
  assert.throws(() => resolveManualPlan(state, problem, [{
    class_id: 'TC1',
    slot_id: 'D1P1',
    item_id: 'MATH',
    item_name: '数学',
    course_ids: ['MATH'],
    section_ids: ['SEC_CHEM'],
  }]), /不适用于该班级/);
});

test('rejects duplicate manual placements instead of silently dropping one', () => {
  const placement = {
    class_id: 'TC1', slot_id: 'D1P1', item_id: 'MATH', item_name: '数学',
    course_ids: ['MATH'], section_ids: ['SEC_MATH_TC1'],
  };
  assert.throws(() => normalizeManualPlacements([placement, placement]), /重复/);
});

test('rejects an id shared by an administrative and teaching class', () => {
  const conflictedState = {
    ...state,
    admin_classes: [{ id: 'TC1', name: '冲突行政班', grade: 11 }],
  };
  assert.throws(() => resolveManualPlan(conflictedState, problem, [{
    class_id: 'TC1', slot_id: 'D1P1', item_id: 'MATH', item_name: '数学',
    course_ids: ['MATH'], section_ids: ['SEC_MATH_TC1'],
  }]), /行政班和教学班.*重复/);
});

test('allows an unlimited manual filler course to be locked beyond its configured weekly hours', () => {
  const unlimitedState = {
    ...state,
    courses: [...state.courses, {
      id: 'SELF_STUDY', name: '自习', type: 'other', manual_unlimited: true,
    }],
  };
  const unlimitedProblem = {
    ...problem,
    slots: [...problem.slots, { id: 'D1P3', day: 1, period: 3 }],
    sections: [...problem.sections, {
      id: 'SEC_SELF_TC1', course_id: 'SELF_STUDY', class_id: 'TC1', class_type: 'teaching',
      teacher_id: null, weekly_hours: 2, grades: [11], student_ids: ['S1', 'S2'],
      eligible_student_ids: [],
    }],
  };
  const placements = ['D1P1', 'D1P2', 'D1P3'].map(slotId => ({
    class_id: 'TC1', slot_id: slotId, item_id: 'SELF_STUDY', item_name: '自习',
    course_ids: ['SELF_STUDY'], section_ids: ['SEC_SELF_TC1'],
  }));

  const result = resolveManualPlan(unlimitedState, unlimitedProblem, placements);
  assert.equal(result.locks.length, 3);
  assert.ok(!result.issues.some(issue => issue.code === 'WEEKLY_HOURS_EXCEEDED'));
});

test('expands an unlimited filler section to cover every confirmed manual lock', () => {
  const expanded = expandUnlimitedManualHours(
    { courses: [{ id: 'SELF_STUDY', manual_unlimited: true }] },
    {
      sections: [{ id: 'SEC_SELF', course_id: 'SELF_STUDY', weekly_hours: 2 }],
      diagnostics: {},
    },
    ['D1P1', 'D1P2', 'D1P3'].map(slot_id => ({ section_id: 'SEC_SELF', slot_id })),
  );

  assert.equal(expanded.sections[0].weekly_hours, 3);
});

test('schedules an unlimited filler section only as many times as it is manually locked', () => {
  const scheduled = expandUnlimitedManualHours(
    { courses: [{ id: 'SELF_STUDY', manual_unlimited: true }] },
    {
      sections: [{ id: 'SEC_SELF', course_id: 'SELF_STUDY', weekly_hours: 2 }],
      diagnostics: {},
    },
    [{ section_id: 'SEC_SELF', slot_id: 'D1P1' }],
  );

  assert.equal(scheduled.sections[0].weekly_hours, 1);
});
