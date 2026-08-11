import assert from 'node:assert/strict';
import test from 'node:test';
import { buildSchedulingProblem } from '../src/problem-builder.mjs';

function blockState({
  students,
  courses = ['AP_A', 'AP_B', 'AP_C'],
  slots = [],
  courseBlockIds = {},
  apBlockAssignments = [],
} = {}) {
  return {
    teachers: courses.map(courseId => ({ id: `T_${courseId}`, can_teach: [courseId] })),
    rooms: [],
    courses: courses.map(courseId => ({
      id: courseId, name: courseId, type: 'ap', grade: [11, 12], weekly_hours: 5, section_count: 2,
    })),
    students,
    admin_classes: [],
    teaching_classes: [],
    teaching_assignments: [],
    selection_blocks: [],
    constraints: [],
    ap_block_assignments: apBlockAssignments,
    ap_block_config: {
      enabled: true,
      blocks: [
        { id: 'AP_BLOCK_1', name: 'Block 1', slots },
        { id: 'AP_BLOCK_2', name: 'Block 2', slots: [] },
        { id: 'AP_BLOCK_3', name: 'Block 3', slots: [] },
      ],
      course_block_ids: courseBlockIds,
    },
  };
}

test('AP Block mode preserves exact imported student-course-block rosters', () => {
  const problem = buildSchedulingProblem(blockState({
    courses: ['AP_A', 'AP_B'],
    students: [
      { id: 'S1', grade: 11, ap_courses: ['AP_A', 'AP_B'], elective_choices: {} },
      { id: 'S2', grade: 11, ap_courses: ['AP_A', 'AP_B'], elective_choices: {} },
    ],
    apBlockAssignments: [
      { student_id: 'S1', course_id: 'AP_A', block_id: 'AP_BLOCK_2' },
      { student_id: 'S1', course_id: 'AP_B', block_id: 'AP_BLOCK_1' },
      { student_id: 'S2', course_id: 'AP_A', block_id: 'AP_BLOCK_1' },
      { student_id: 'S2', course_id: 'AP_B', block_id: 'AP_BLOCK_2' },
    ],
  }));
  const apSections = problem.sections.filter(section => section.class_type === 'ap');
  const assignedBlock = (studentId, courseId) => apSections.find(section =>
    section.course_id === courseId && section.student_ids.includes(studentId))?.ap_block_id;

  assert.equal(assignedBlock('S1', 'AP_A'), 'AP_BLOCK_2');
  assert.equal(assignedBlock('S1', 'AP_B'), 'AP_BLOCK_1');
  assert.equal(assignedBlock('S2', 'AP_A'), 'AP_BLOCK_1');
  assert.equal(assignedBlock('S2', 'AP_B'), 'AP_BLOCK_2');
});

test('AP Block mode accepts students with fewer AP selections and assigns only their selected courses', () => {
  const problem = buildSchedulingProblem(blockState({
    students: [
      { id: 'S1', grade: 11, ap_courses: ['AP_A', 'AP_B', 'AP_C'], elective_choices: {} },
      { id: 'S2', grade: 11, ap_courses: ['AP_A', 'AP_C'], elective_choices: {} },
      { id: 'S3', grade: 12, ap_courses: ['AP_A', 'AP_B'], elective_choices: {} },
      { id: 'S4', grade: 12, ap_courses: ['AP_B'], elective_choices: {} },
    ],
  }));
  const apSections = problem.sections.filter(section => section.class_type === 'ap');
  assert.ok(apSections.length >= 3);
  assert.ok(apSections.every(section => section.ap_block_id));
  assert.ok(apSections.every(section => section.student_ids.every(id => section.eligible_student_ids.includes(id))));
  for (const [studentId, expectedCount] of [['S1', 3], ['S2', 2], ['S3', 2], ['S4', 1]]) {
    const assignedBlocks = apSections
      .filter(section => section.student_ids.includes(studentId))
      .map(section => section.ap_block_id);
    assert.equal(assignedBlocks.length, expectedCount, `${studentId} must not be assigned an unselected AP`);
    assert.equal(new Set(assignedBlocks).size, assignedBlocks.length, `${studentId} has an AP Block collision`);
  }
  for (const courseId of ['AP_A', 'AP_B', 'AP_C']) {
    assert.ok(apSections.filter(section => section.course_id === courseId).length <= 2);
  }
  assert.ok(problem.rules.some(rule => rule.type === 'synchronized_slots' && rule.id.startsWith('ap_block_')));
});

test('AP Block mode targets one first period per week and otherwise prefers periods 2 through 6', () => {
  const problem = buildSchedulingProblem(blockState({
    students: [
      { id: 'S1', grade: 11, ap_courses: ['AP_A', 'AP_B', 'AP_C'], elective_choices: {} },
      { id: 'S2', grade: 11, ap_courses: ['AP_A', 'AP_B'], elective_choices: {} },
    ],
  }));

  const compactBands = problem.rules.filter(rule => rule.id.startsWith('ap_block_')
    && rule.id.endsWith('_compact_band'));
  assert.ok(compactBands.length >= 2, 'each open Block should prefer a compact early band');
  assert.ok(compactBands.every(rule => rule.type === 'preferred_slots' && rule.hard === false));
  assert.ok(compactBands.every(rule => rule.weight === 2_000));
  assert.ok(compactBands.every(rule => !Object.hasOwn(rule.params, 'objective_tier')));
  assert.ok(compactBands.every(rule => rule.params.slots.includes('D1P1')));
  assert.ok(compactBands.every(rule => rule.params.slots.includes('D5P6')));
  assert.ok(compactBands.every(rule => !rule.params.slots.includes('D1P7')));
  assert.ok(compactBands.every(rule => !problem.rules.some(other =>
    other.id === rule.id.replace('_compact_band', '_fixed_slots'))));

  const firstPeriodTargets = problem.rules.filter(rule => rule.id.startsWith('ap_block_')
    && rule.id.endsWith('_one_first_period'));
  assert.equal(firstPeriodTargets.length, compactBands.length);
  assert.ok(firstPeriodTargets.every(rule => rule.type === 'target_occurrences_in_slots'));
  assert.ok(firstPeriodTargets.every(rule => rule.hard === false && rule.weight === 5_000));
  assert.ok(firstPeriodTargets.every(rule => rule.params.target === 1));
  assert.ok(firstPeriodTargets.every(rule => rule.params.objective_tier === 'ap_block_first_period_pattern'));
  assert.ok(firstPeriodTargets.every(rule => rule.params.slots.length === 5));
  assert.ok(firstPeriodTargets.every(rule => rule.params.slots.every(slot => slot.endsWith('P1'))));

  const studentCompactness = problem.rules.find(rule => rule.id === 'ap_block_students_compact_daily_schedule');
  assert.deepEqual(studentCompactness && {
    type: studentCompactness.type,
    hard: studentCompactness.hard,
    weight: studentCompactness.weight,
    target_ids: [...studentCompactness.target_ids].sort(),
  }, {
    type: 'no_internal_gaps',
    hard: false,
    weight: 1000,
    target_ids: ['S1', 'S2'],
  });
});

test('AP Block mode emits an exact fixed-slot rule for a configured time band', () => {
  const problem = buildSchedulingProblem(blockState({
    students: [
      { id: 'S1', grade: 11, ap_courses: ['AP_A'], elective_choices: {} },
    ],
    courses: ['AP_A'],
    slots: ['D1P3', 'D2P2', 'D2P3', 'D4P5', 'D5P4'],
    courseBlockIds: { AP_A: ['AP_BLOCK_1'] },
  }));
  const rule = problem.rules.find(item => item.id === 'ap_block_AP_BLOCK_1_fixed_slots');
  assert.deepEqual(rule?.params, {
    slots: ['D1P3', 'D2P2', 'D2P3', 'D4P5', 'D5P4'], mode: 'exact',
  });
});

test('AP Block mode gives an actionable error when a student selects more APs than Blocks', () => {
  assert.throws(() => buildSchedulingProblem(blockState({
    students: [{ id: 'S1', grade: 11, ap_courses: ['AP_A', 'AP_B', 'AP_C', 'AP_D'], elective_choices: {} }],
    courses: ['AP_A', 'AP_B', 'AP_C', 'AP_D'],
  })), /选择了 4 门 AP，但当前只有 3 个 Block/);
});

test('AP Block mode retains per-grade AP offerings with their assigned teachers', () => {
  const state = blockState({
    courses: ['AP_MACRO', 'AP_CHEM'],
    students: [
      { id: 'G11', grade: 11, ap_courses: ['AP_MACRO', 'AP_CHEM'], elective_choices: {} },
      { id: 'G12', grade: 12, ap_courses: ['AP_MACRO', 'AP_CHEM'], elective_choices: {} },
    ],
  });
  state.courses = [
    {
      id: 'AP_MACRO', name: 'AP Macroeconomics', type: 'ap', grade: [11, 12], weekly_hours: 5, section_count: 2,
      section_requirements: [
        { grades: [11], count: 1, teacher_id: 'T_AP_MACRO_G11' },
        { grades: [12], count: 2, teacher_id: 'T_AP_MACRO_G12' },
      ],
    },
    { id: 'AP_CHEM', name: 'AP Chemistry', type: 'ap', grade: [11, 12], weekly_hours: 5, section_count: 2 },
  ];
  state.teachers = [
    { id: 'T_AP_MACRO_G11', can_teach: ['AP_MACRO'] },
    { id: 'T_AP_MACRO_G12', can_teach: ['AP_MACRO'] },
    { id: 'T_AP_CHEM', can_teach: ['AP_CHEM'] },
  ];
  const sections = buildSchedulingProblem(state).sections.filter(section => section.course_id === 'AP_MACRO');
  assert.equal(sections.length, 2);
  assert.deepEqual(sections.map(section => section.teacher_id).sort(), ['T_AP_MACRO_G11', 'T_AP_MACRO_G12']);
  assert.ok(sections.some(section => section.cohort_id.includes('G11') && section.student_ids.includes('G11')));
  assert.ok(sections.some(section => section.cohort_id.includes('G12') && section.student_ids.includes('G12')));
});
