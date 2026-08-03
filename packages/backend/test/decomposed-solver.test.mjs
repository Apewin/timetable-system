import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildDynamicSchedulingLayer,
  findUnmetCoreAvailabilityRequirements,
  solveDecomposedSchedule,
} from '../src/decomposed-solver.mjs';
import { validateSchedule } from '../src/schedule-validator.mjs';

test('dynamic layer reserves daily common-free slots for recurring teaching-class courses', () => {
  const problem = {
    slots: [
      { id: 'D1P1', day: 1, period: 1 },
      { id: 'D1P2', day: 1, period: 2 },
      { id: 'D2P1', day: 2, period: 1 },
      { id: 'D2P2', day: 2, period: 2 },
    ],
    rooms: [],
    rules: [{
      id: 'once-daily', type: 'max_occurrences_per_day', hard: true, scope: 'course',
      target_ids: ['CORE'], section_target_ids: ['CORE'], params: { max: 1 },
    }],
    sections: [
      {
        id: 'CORE', course_id: 'CORE', teacher_id: 'T_CORE', class_id: 'TC1', class_type: 'teaching',
        weekly_hours: 2, student_ids: ['S1'], eligible_student_ids: [], locked_student_ids: [], grades: [11],
      },
      {
        id: 'AP1', course_id: 'AP', teacher_id: 'T_AP', class_type: 'ap', weekly_hours: 1,
        student_ids: ['S1'], eligible_student_ids: ['S1'], locked_student_ids: [], grades: [11],
      },
    ],
  };

  const layer = buildDynamicSchedulingLayer(problem);
  const dailyRequirements = layer.coreAvailabilityRequirements.filter(item =>
    item.id.startsWith('CLASS_DAY_'));
  const totalRequirement = layer.coreAvailabilityRequirements.find(item =>
    item.id === 'CLASS_TOTAL_TC1');

  assert.equal(layer.masterSectionIds.has('CORE'), false);
  assert.equal(dailyRequirements.length, 2);
  assert.deepEqual(dailyRequirements.map(item => item.required_slots), [1, 1]);
  assert.deepEqual(dailyRequirements.map(item => item.eligible_slot_ids), [
    ['D1P1', 'D1P2'],
    ['D2P1', 'D2P2'],
  ]);
  assert.equal(totalRequirement.required_slots, 2);
  assert.deepEqual(totalRequirement.student_ids, ['S1']);
});

test('dynamic layer schedules grade-wide separated administrative sections in the master problem', () => {
  const problem = {
    slots: [
      { id: 'D1P1', day: 1, period: 1 },
      { id: 'D1P2', day: 1, period: 2 },
    ],
    rooms: [],
    rules: [{
      id: 'separate', type: 'separate_class_types', hard: true, scope: 'global',
      target_ids: [], section_target_ids: ['ADMIN', 'AP1'],
      params: { left_class_types: ['admin'], right_class_types: ['ap'], grades: [11] },
    }],
    sections: [
      {
        id: 'ADMIN', course_id: 'CHIN', teacher_id: 'T_CORE', class_id: 'AC1', class_type: 'admin',
        weekly_hours: 1, student_ids: ['S1'], eligible_student_ids: [], locked_student_ids: [], grades: [11],
      },
      {
        id: 'AP1', course_id: 'AP', teacher_id: 'T_AP', class_type: 'ap', weekly_hours: 1,
        student_ids: ['S1'], eligible_student_ids: ['S1'], locked_student_ids: [], grades: [11],
      },
    ],
  };

  const layer = buildDynamicSchedulingLayer(problem);

  assert.equal(layer.masterSectionIds.has('ADMIN'), true);
  assert.equal(layer.problem.sections.find(section => section.id === 'ADMIN').weekly_hours, 1);
  assert.deepEqual(layer.assignmentGroups[0].core_section_ids, ['ADMIN']);
});

test('full dynamic layer includes every core section for an integrated feasibility pass', () => {
  const problem = {
    slots: [
      { id: 'D1P1', day: 1, period: 1 },
      { id: 'D1P2', day: 1, period: 2 },
    ],
    rooms: [], rules: [{
      id: 'prefix', type: 'no_internal_gaps', hard: true, scope: 'student',
      target_ids: ['S1'], section_target_ids: [], params: {},
    }],
    sections: [
      {
        id: 'CORE', course_id: 'CORE', teacher_id: 'T0', class_id: 'TC1', class_type: 'teaching',
        weekly_hours: 1, student_ids: ['S1'], eligible_student_ids: [], locked_student_ids: [], grades: [11],
      },
      {
        id: 'AP1', course_id: 'AP', teacher_id: 'T1', class_type: 'ap',
        weekly_hours: 1, student_ids: ['S1'], eligible_student_ids: ['S1'], locked_student_ids: [], grades: [11],
      },
    ],
  };

  const layer = buildDynamicSchedulingLayer(problem, [], {
    includeAllCore: true,
    includeStudentRules: true,
  });

  assert.deepEqual([...layer.masterSectionIds].sort(), ['AP1', 'CORE']);
  assert.deepEqual(layer.assignmentGroups[0].core_section_ids, ['CORE']);
  assert.equal(layer.problem.rules.some(rule => rule.id === 'prefix'), true);
});

test('detects a daily core-availability requirement violated by the current dynamic roster', () => {
  const problem = {
    slots: [
      { id: 'D1P1', day: 1, period: 1 },
      { id: 'D1P2', day: 1, period: 2 },
    ],
    sections: [{ id: 'AP1', class_type: 'ap', student_ids: [], eligible_student_ids: ['S1'] }],
  };
  const requirements = [{
    id: 'CLASS_DAY_TC1_1', required_slots: 2, student_ids: ['S1'],
    eligible_slot_ids: ['D1P1', 'D1P2'], unconditional_blocking_section_ids: [],
  }];
  const solution = {
    sections: [{ id: 'AP1', class_type: 'ap', student_ids: ['S1'] }],
    meetings: [{ section_id: 'AP1', slot_id: 'D1P1' }],
  };

  assert.deepEqual(
    findUnmetCoreAvailabilityRequirements(problem, requirements, solution)
      .map(item => ({ id: item.id, available_slots: item.available_slots })),
    [{ id: 'CLASS_DAY_TC1_1', available_slots: 1 }],
  );
});

test('aggregates section choices by shared core class while preserving each course roster', () => {
  const problem = {
    slots: [
      { id: 'D1P1', day: 1, period: 1 },
      { id: 'D1P2', day: 1, period: 2 },
    ],
    rooms: [], rules: [],
    sections: [
      {
        id: 'CORE', course_id: 'CORE', teacher_id: 'T0', class_id: 'TC1', class_type: 'teaching',
        weekly_hours: 1, student_ids: ['S1', 'S2'], eligible_student_ids: [], locked_student_ids: [], grades: [11],
      },
      {
        id: 'AP_A', course_id: 'A', teacher_id: 'TA', class_type: 'ap', weekly_hours: 1,
        student_ids: ['S1'], eligible_student_ids: ['S1'], locked_student_ids: [], grades: [11],
      },
      {
        id: 'AP_B', course_id: 'B', teacher_id: 'TB', class_type: 'ap', weekly_hours: 1,
        student_ids: ['S2'], eligible_student_ids: ['S2'], locked_student_ids: [], grades: [11],
      },
    ],
  };

  const layer = buildDynamicSchedulingLayer(problem, [{ section_id: 'CORE', slot_id: 'D1P1' }]);
  const exactLayer = buildDynamicSchedulingLayer(
    problem,
    [{ section_id: 'CORE', slot_id: 'D1P1' }],
    { assignmentMode: 'detailed' },
  );

  assert.equal(layer.assignmentGroups.length, 1);
  assert.deepEqual(layer.assignmentGroups[0].courses.map(course => ({
    course_id: course.course_id,
    student_ids: course.student_ids,
  })), [
    { course_id: 'A', student_ids: ['S1'] },
    { course_id: 'B', student_ids: ['S2'] },
  ]);
  assert.equal(exactLayer.assignmentGroups.length, 2);
});

test('schedules dynamic sections first and fills fixed core lessons around them', async () => {
  const problem = {
    slots: [
      { id: 'D1P1', day: 1, period: 1 },
      { id: 'D1P2', day: 1, period: 2 },
    ],
    rooms: [],
    rules: [],
    sections: [
      {
        id: 'CORE', course_id: 'CORE', teacher_id: 'T_CORE', class_id: 'TC1', class_type: 'teaching',
        weekly_hours: 1, student_ids: ['S1'], eligible_student_ids: [], locked_student_ids: [], grades: [11],
      },
      {
        id: 'AP1', course_id: 'AP', teacher_id: 'T_AP1', class_type: 'ap',
        weekly_hours: 1, student_ids: ['S1'], eligible_student_ids: ['S1'], locked_student_ids: [], grades: [11],
      },
      {
        id: 'AP2', course_id: 'AP', teacher_id: 'T_AP2', class_type: 'ap',
        weekly_hours: 1, student_ids: [], eligible_student_ids: ['S1'], locked_student_ids: [], grades: [11],
      },
    ],
  };
  const locks = [{ section_id: 'CORE', slot_id: 'D1P1', origin: 'manual' }];

  const solution = await solveDecomposedSchedule(problem, {
    lockedMeetings: locks,
    maxTimeSeconds: 5,
    maxIterations: 5,
  });

  assert.equal(solution.ok, true, solution.reason || solution.status);
  assert.equal(solution.algorithm, 'dynamic-first-benders');
  assert.equal(solution.sections.filter(section =>
    section.course_id === 'AP' && section.student_ids.includes('S1')).length, 1);
  assert.equal(validateSchedule(problem, { ...solution, locks }).ok, true);
});
