import assert from 'node:assert/strict';
import test from 'node:test';
import { solveSchedule } from '../src/cpsat-solver.mjs';
import { validateSchedule } from '../src/schedule-validator.mjs';

test('rejects an unknown objective mode instead of silently using another objective', async () => {
  await assert.rejects(
    solveSchedule({ slots: [], rooms: [], rules: [], sections: [] }, {
      objectiveMode: 'unknown-quality-metric',
      useConstructiveSeed: false,
    }),
    /objectiveMode/,
  );
});

const slots = Array.from({ length: 10 }, (_, index) => ({ id: `D1P${index + 1}`, day: 1, period: index + 1 }));

test('solves section time and student membership without assigning rooms', async () => {
  const problem = {
    slots,
    rooms: [{ id: 'R1', capacity: 2 }, { id: 'R2', capacity: 2 }],
    rules: [
      { id: 'ap-once-a-day', type: 'max_occurrences_per_day', hard: true, scope: 'course', target_ids: ['AP'], params: { max: 1 } },
      { id: 'fixed-core', type: 'fixed_slots', hard: true, scope: 'section', target_ids: ['CORE'], params: { slots: ['D1P1'], mode: 'exact' } },
      { id: 'late-core', type: 'preferred_slots', hard: false, weight: 2, scope: 'section', target_ids: ['CORE'], params: { slots: ['D1P10'] } },
    ],
    sections: [
      { id: 'CORE', course_id: 'CORE', teacher_id: 'T1', class_id: 'C', class_type: 'teaching', weekly_hours: 1, student_ids: ['S1', 'S2'], eligible_student_ids: [], room_id: 'R1', room_candidates: ['R1', 'R2'] },
      { id: 'AP1', course_id: 'AP', teacher_id: 'T2', class_type: 'ap', weekly_hours: 1, student_ids: ['S1'], eligible_student_ids: ['S1', 'S2'], room_id: 'R1', room_candidates: ['R1', 'R2'], capacity: 2 },
      { id: 'AP2', course_id: 'AP', teacher_id: 'T3', class_type: 'ap', weekly_hours: 1, student_ids: ['S2'], eligible_student_ids: ['S1', 'S2'], room_id: 'R1', room_candidates: ['R1', 'R2'], capacity: 2 },
    ],
  };
  const solution = await solveSchedule(problem, { maxTimeSeconds: 5 });
  assert.equal(solution.ok, true);
  assert.equal(solution.meetings.length, 3);
  assert.equal(solution.assignments.length, 4);
  assert.ok(solution.meetings.every(meeting => meeting.room_id == null));
  const validation = validateSchedule(problem, solution);
  assert.equal(validation.ok, true, JSON.stringify(validation.hard_violations));
});

test('keeps students in separate solver cohorts when their AP Block sections differ', async () => {
  const problem = {
    slots,
    rooms: [],
    rules: [],
    sections: [
      {
        id: 'CORE', course_id: 'CORE', teacher_id: 'T_CORE', class_type: 'teaching', weekly_hours: 1,
        student_ids: ['S1', 'S2'], eligible_student_ids: [],
      },
      {
        id: 'BIO_BLOCK_1', course_id: 'AP_BIO', teacher_id: 'T_BIO_1', class_type: 'ap', weekly_hours: 1,
        student_ids: ['S1'], eligible_student_ids: ['S1'], ap_block_id: 'AP_BLOCK_1',
      },
      {
        id: 'BIO_BLOCK_3', course_id: 'AP_BIO', teacher_id: 'T_BIO_3', class_type: 'ap', weekly_hours: 1,
        student_ids: ['S2'], eligible_student_ids: ['S2'], ap_block_id: 'AP_BLOCK_3',
      },
    ],
  };

  const solution = await solveSchedule(problem, { maxTimeSeconds: 5, useConstructiveSeed: false });

  assert.equal(solution.ok, true, solution.reason);
  assert.deepEqual(solution.sections.find(section => section.id === 'BIO_BLOCK_1')?.student_ids, ['S1']);
  assert.deepEqual(solution.sections.find(section => section.id === 'BIO_BLOCK_3')?.student_ids, ['S2']);
});

test('keeps a locked section meeting at its locked slot', async () => {
  const problem = {
    slots,
    rooms: [{ id: 'R1', capacity: 30 }],
    rules: [],
    sections: [{ id: 'LOCKED', course_id: 'C', teacher_id: 'T', class_type: 'teaching', weekly_hours: 1, student_ids: ['S'], eligible_student_ids: [], room_id: 'R1', room_candidates: ['R1'] }],
  };
  const solution = await solveSchedule(problem, { maxTimeSeconds: 5, useConstructiveSeed: false, lockedMeetings: [{ section_id: 'LOCKED', slot_id: 'D1P7' }] });
  assert.equal(solution.ok, true);
  assert.equal(solution.meetings[0].slot_id, 'D1P7');
  assert.equal(validateSchedule(problem, { ...solution, locks: [{ section_id: 'LOCKED', slot_id: 'D1P7' }] }).ok, true);
});

test('accepts prior timetable repair hints without turning them into locks', async () => {
  const problem = {
    slots,
    rooms: [],
    rules: [],
    sections: [
      { id: 'A', course_id: 'A', teacher_id: 'T1', class_type: 'teaching', weekly_hours: 1, student_ids: ['S1'], eligible_student_ids: [] },
      { id: 'B', course_id: 'B', teacher_id: 'T2', class_type: 'teaching', weekly_hours: 1, student_ids: ['S2'], eligible_student_ids: [] },
    ],
  };
  const hintMeetings = [
    { section_id: 'A', slot_id: 'D1P7' },
    { section_id: 'B', slot_id: 'D1P8' },
  ];

  const solution = await solveSchedule(problem, {
    maxTimeSeconds: 5,
    useConstructiveSeed: false,
    hintMeetings,
    lockedMeetings: [{ section_id: 'A', slot_id: 'D1P1' }],
  });

  assert.equal(solution.ok, true);
  assert.equal(solution.hint_meeting_count, 2);
  assert.equal(solution.meetings.find(meeting => meeting.section_id === 'A').slot_id, 'D1P1');
});

test('accepts prior elective rosters as section-choice hints', async () => {
  const problem = {
    slots,
    rooms: [],
    rules: [],
    sections: [
      { id: 'AP1', course_id: 'AP', teacher_id: 'T1', class_type: 'ap', weekly_hours: 1, student_ids: ['S1'], eligible_student_ids: ['S1', 'S2'] },
      { id: 'AP2', course_id: 'AP', teacher_id: 'T2', class_type: 'ap', weekly_hours: 1, student_ids: ['S2'], eligible_student_ids: ['S1', 'S2'] },
    ],
  };

  const solution = await solveSchedule(problem, {
    maxTimeSeconds: 5,
    useConstructiveSeed: false,
    hintSections: [
      { id: 'AP1', student_ids: [] },
      { id: 'AP2', student_ids: ['S1', 'S2'] },
    ],
  });

  assert.equal(solution.ok, true);
  assert.equal(solution.hint_membership_count, 2);
});

test('applies a collision cut returned by a decomposed student subproblem', async () => {
  const problem = {
    slots,
    rooms: [],
    rules: [],
    sections: [
      { id: 'A', course_id: 'A', teacher_id: 'T1', class_type: 'teaching', weekly_hours: 1, student_ids: [], eligible_student_ids: [] },
      { id: 'B', course_id: 'B', teacher_id: 'T2', class_type: 'ap', weekly_hours: 1, student_ids: [], eligible_student_ids: [] },
    ],
  };

  const solution = await solveSchedule(problem, {
    maxTimeSeconds: 5,
    useConstructiveSeed: false,
    freezeMembership: true,
    collisionCuts: [[
      { left_section_id: 'A', left_occurrence_index: 0, right_section_id: 'B', right_occurrence_index: 0 },
    ]],
  });

  assert.equal(solution.ok, true);
  assert.notEqual(
    solution.meetings.find(meeting => meeting.section_id === 'A').slot_id,
    solution.meetings.find(meeting => meeting.section_id === 'B').slot_id,
  );
});

test('keeps at least one parallel elective section compatible with a core timetable', async () => {
  const problem = {
    slots,
    rooms: [],
    rules: [{
      id: 'fixed-core', type: 'fixed_slots', hard: true, scope: 'section',
      target_ids: ['CORE'], section_target_ids: ['CORE'], params: { slots: ['D1P1'], mode: 'exact' },
    }],
    sections: [
      { id: 'CORE', course_id: 'CORE', teacher_id: 'T0', class_type: 'teaching', weekly_hours: 1, student_ids: ['S1'], eligible_student_ids: [] },
      { id: 'AP1', course_id: 'AP', teacher_id: 'T1', class_type: 'ap', weekly_hours: 1, student_ids: [], eligible_student_ids: [] },
      { id: 'AP2', course_id: 'AP', teacher_id: 'T2', class_type: 'ap', weekly_hours: 1, student_ids: [], eligible_student_ids: [] },
    ],
  };

  const solution = await solveSchedule(problem, {
    maxTimeSeconds: 5,
    useConstructiveSeed: false,
    freezeMembership: true,
    availabilityGroups: [{
      id: 'S1@AP',
      core_section_ids: ['CORE'],
      candidate_section_ids: ['AP1', 'AP2'],
    }],
  });

  assert.equal(solution.ok, true);
  const slotBySection = new Map(solution.meetings.map(meeting => [meeting.section_id, meeting.slot_id]));
  assert.ok(
    slotBySection.get('AP1') !== 'D1P1' || slotBySection.get('AP2') !== 'D1P1',
    'at least one AP section must remain available to S1',
  );
});

test('chooses dynamic sections through compact collision implications', async () => {
  const problem = {
    slots,
    rooms: [],
    rules: [
      { id: 'fixed-core', type: 'fixed_slots', hard: true, scope: 'section', target_ids: ['CORE'], section_target_ids: ['CORE'], params: { slots: ['D1P1'], mode: 'exact' } },
      { id: 'fixed-ap1', type: 'fixed_slots', hard: true, scope: 'section', target_ids: ['AP1'], section_target_ids: ['AP1'], params: { slots: ['D1P1'], mode: 'exact' } },
    ],
    sections: [
      { id: 'CORE', course_id: 'CORE', teacher_id: 'T0', class_type: 'teaching', weekly_hours: 1, student_ids: ['S1'], eligible_student_ids: [] },
      { id: 'AP1', course_id: 'AP', teacher_id: 'T1', class_type: 'ap', weekly_hours: 1, student_ids: [], eligible_student_ids: ['S1'] },
      { id: 'AP2', course_id: 'AP', teacher_id: 'T2', class_type: 'ap', weekly_hours: 1, student_ids: [], eligible_student_ids: ['S1'] },
    ],
  };

  const solution = await solveSchedule(problem, {
    maxTimeSeconds: 5,
    useConstructiveSeed: false,
    freezeMembership: true,
    assignmentGroups: [{
      id: 'G1', student_ids: ['S1'], core_section_ids: ['CORE'],
      courses: [{ course_id: 'AP', candidate_section_ids: ['AP1', 'AP2'] }],
      fixed_sections: {},
    }],
    hintSections: [
      { id: 'AP1', student_ids: ['S1'] },
      { id: 'AP2', student_ids: [] },
    ],
    randomSeed: 42,
  });

  assert.equal(solution.ok, true);
  assert.deepEqual(solution.sections.find(section => section.id === 'AP1').student_ids, []);
  assert.deepEqual(solution.sections.find(section => section.id === 'AP2').student_ids, ['S1']);
  assert.equal(solution.hint_membership_count, 2);
  assert.equal(solution.search_seed, 42);
  assert.equal(validateSchedule(problem, solution).ok, true);
});

test('channels exact assignment-group times into student prefix rules', async () => {
  const problem = {
    slots: [
      { id: 'D1P1', day: 1, period: 1 },
      { id: 'D1P2', day: 1, period: 2 },
      { id: 'D1P3', day: 1, period: 3 },
    ],
    rooms: [],
    rules: [
      {
        id: 'fixed-core', type: 'fixed_slots', hard: true, scope: 'section',
        target_ids: ['CORE'], section_target_ids: ['CORE'], params: { slots: ['D1P1'], mode: 'exact' },
      },
      {
        id: 'fixed-ap', type: 'fixed_slots', hard: true, scope: 'section',
        target_ids: ['AP1'], section_target_ids: ['AP1'], params: { slots: ['D1P3'], mode: 'exact' },
      },
      {
        id: 'student-prefix', type: 'no_internal_gaps', hard: true, scope: 'student',
        target_ids: ['S1'], params: {},
      },
    ],
    sections: [
      {
        id: 'CORE', course_id: 'CORE', teacher_id: 'T0', class_type: 'teaching', weekly_hours: 1,
        student_ids: ['S1'], eligible_student_ids: [], grades: [11],
      },
      {
        id: 'AP1', course_id: 'AP', teacher_id: 'T1', class_type: 'ap', weekly_hours: 1,
        student_ids: [], eligible_student_ids: ['S1'], grades: [11],
      },
    ],
  };

  const solution = await solveSchedule(problem, {
    maxTimeSeconds: 5,
    useConstructiveSeed: false,
    freezeMembership: true,
    channelAssignmentGroupTimes: true,
    assignmentGroups: [{
      id: 'G1', exact_student_cohort: true, student_ids: ['S1'], core_section_ids: ['CORE'],
      courses: [{ course_id: 'AP', candidate_section_ids: ['AP1'] }], fixed_sections: {},
    }],
  });

  assert.equal(solution.ok, false);
  assert.equal(solution.status, 'INFEASIBLE');
});

test('treats a soft student prefix rule as a quality score instead of blocking a complete timetable', async () => {
  const problem = {
    slots: [
      { id: 'D1P1', day: 1, period: 1 },
      { id: 'D1P2', day: 1, period: 2 },
      { id: 'D1P3', day: 1, period: 3 },
    ],
    rooms: [],
    rules: [
      {
        id: 'fixed-core', type: 'fixed_slots', hard: true, scope: 'section',
        target_ids: ['CORE'], section_target_ids: ['CORE'], params: { slots: ['D1P1'], mode: 'exact' },
      },
      {
        id: 'fixed-ap', type: 'fixed_slots', hard: true, scope: 'section',
        target_ids: ['AP'], section_target_ids: ['AP'], params: { slots: ['D1P3'], mode: 'exact' },
      },
      {
        id: 'student-prefix', type: 'no_internal_gaps', hard: false, weight: 100,
        scope: 'student', target_ids: ['S1'], params: {},
      },
    ],
    sections: [
      {
        id: 'CORE', course_id: 'CORE', teacher_id: 'T0', class_type: 'teaching', weekly_hours: 1,
        student_ids: ['S1'], eligible_student_ids: [], grades: [11],
      },
      {
        id: 'AP', course_id: 'AP', teacher_id: 'T1', class_type: 'ap', weekly_hours: 1,
        student_ids: ['S1'], eligible_student_ids: [], grades: [11],
      },
    ],
  };

  const solution = await solveSchedule(problem, {
    maxTimeSeconds: 5,
    optimizeSoft: true,
    freezeMembership: true,
    useConstructiveSeed: false,
  });

  assert.equal(solution.ok, true, solution.status);
  const validation = validateSchedule(problem, solution);
  assert.equal(validation.ok, true);
  assert.equal(validation.soft_violations.length, 1);
});

test('optimizes soft student prefixes by affected student-days instead of unique timetable shapes', async () => {
  const bigStudentIds = ['B1', 'B2', 'B3', 'B4', 'B5'];
  const problem = {
    slots: [
      { id: 'D1P1', day: 1, period: 1 },
      { id: 'D1P2', day: 1, period: 2 },
      { id: 'D1P3', day: 1, period: 3 },
    ],
    rooms: [],
    rules: [
      {
        id: 'big-core-first', type: 'fixed_slots', hard: true, scope: 'section',
        target_ids: ['BIG_CORE'], section_target_ids: ['BIG_CORE'], params: { slots: ['D1P1'], mode: 'exact' },
      },
      {
        id: 'small-core-first', type: 'fixed_slots', hard: true, scope: 'section',
        target_ids: ['SMALL_CORE'], section_target_ids: ['SMALL_CORE'], params: { slots: ['D1P1'], mode: 'exact' },
      },
      {
        id: 'student-prefix', type: 'no_internal_gaps', hard: false, weight: 10,
        scope: 'student', target_ids: [...bigStudentIds, 'S1'], params: {},
      },
      {
        id: 'prefer-big-late', type: 'preferred_slots', hard: false, weight: 1,
        scope: 'section', target_ids: ['BIG_FLEX'], section_target_ids: ['BIG_FLEX'], params: { slots: ['D1P3'] },
      },
    ],
    sections: [
      {
        id: 'BIG_CORE', course_id: 'BIG_CORE', teacher_id: 'T_BIG_CORE', class_type: 'teaching', weekly_hours: 1,
        student_ids: bigStudentIds, eligible_student_ids: [], grades: [11],
      },
      {
        id: 'BIG_FLEX', course_id: 'BIG_FLEX', teacher_id: 'T_SHARED', class_type: 'teaching', weekly_hours: 1,
        student_ids: bigStudentIds, eligible_student_ids: [], grades: [11],
      },
      {
        id: 'SMALL_CORE', course_id: 'SMALL_CORE', teacher_id: 'T_SMALL_CORE', class_type: 'teaching', weekly_hours: 1,
        student_ids: ['S1'], eligible_student_ids: [], grades: [11],
      },
      {
        id: 'SMALL_FLEX', course_id: 'SMALL_FLEX', teacher_id: 'T_SHARED', class_type: 'teaching', weekly_hours: 1,
        student_ids: ['S1'], eligible_student_ids: [], grades: [11],
      },
    ],
  };

  const solution = await solveSchedule(problem, {
    maxTimeSeconds: 5,
    optimizeSoft: true,
    freezeMembership: true,
    useConstructiveSeed: false,
  });

  assert.equal(solution.ok, true, solution.status);
  assert.equal(solution.meetings.find(item => item.section_id === 'BIG_FLEX')?.slot_id, 'D1P2');
  assert.equal(solution.meetings.find(item => item.section_id === 'SMALL_FLEX')?.slot_id, 'D1P3');
  assert.equal(validateSchedule(problem, solution).soft_score, 11);
});

test('charges one soft prefix penalty per student-day regardless of the number of missing periods', async () => {
  const problem = {
    slots: [
      { id: 'D1P1', day: 1, period: 1 },
      { id: 'D1P2', day: 1, period: 2 },
      { id: 'D1P3', day: 1, period: 3 },
      { id: 'D1P4', day: 1, period: 4 },
    ],
    rooms: [],
    rules: [
      {
        id: 'core-first', type: 'fixed_slots', hard: true, scope: 'section',
        target_ids: ['CORE'], section_target_ids: ['CORE'], params: { slots: ['D1P1'], mode: 'exact' },
      },
      {
        id: 'flex-after-second', type: 'forbid_slots', hard: true, scope: 'section',
        target_ids: ['FLEX'], section_target_ids: ['FLEX'], params: { slots: ['D1P1', 'D1P2'] },
      },
      {
        id: 'student-prefix', type: 'no_internal_gaps', hard: false, weight: 10,
        scope: 'student', target_ids: ['S1'], params: {},
      },
      {
        id: 'prefer-fourth', type: 'preferred_slots', hard: false, weight: 1,
        scope: 'section', target_ids: ['FLEX'], section_target_ids: ['FLEX'], params: { slots: ['D1P4'] },
      },
    ],
    sections: [
      {
        id: 'CORE', course_id: 'CORE', teacher_id: 'T_CORE', class_type: 'teaching', weekly_hours: 1,
        student_ids: ['S1'], eligible_student_ids: [], grades: [11],
      },
      {
        id: 'FLEX', course_id: 'FLEX', teacher_id: 'T_FLEX', class_type: 'teaching', weekly_hours: 1,
        student_ids: ['S1'], eligible_student_ids: [], grades: [11],
      },
    ],
  };

  const solution = await solveSchedule(problem, {
    maxTimeSeconds: 5,
    optimizeSoft: true,
    freezeMembership: true,
    useConstructiveSeed: false,
  });

  assert.equal(solution.ok, true, solution.status);
  assert.equal(solution.meetings.find(item => item.section_id === 'FLEX')?.slot_id, 'D1P4');
  assert.equal(validateSchedule(problem, solution).soft_score, 10);
});

test('uses first-period occupancy as a tie-break without changing the primary gap-day score', async () => {
  const problem = {
    // Put P2 first in the raw domain so fixed search demonstrates that the
    // result comes from the objective, not the solver's lowest-value default.
    slots: [
      { id: 'D1P2', day: 1, period: 2 },
      { id: 'D1P1', day: 1, period: 1 },
      { id: 'D1P3', day: 1, period: 3 },
      { id: 'D1P4', day: 1, period: 4 },
    ],
    rooms: [],
    rules: [
      {
        id: 'last-fixed', type: 'fixed_slots', hard: true, scope: 'section',
        target_ids: ['LAST'], section_target_ids: ['LAST'], params: { slots: ['D1P4'], mode: 'exact' },
      },
      {
        id: 'student-prefix', type: 'no_internal_gaps', hard: false, weight: 10,
        scope: 'student', target_ids: ['S1'], params: {},
      },
    ],
    sections: [
      {
        id: 'LAST', course_id: 'LAST', teacher_id: 'T_LAST', class_type: 'teaching', weekly_hours: 1,
        student_ids: ['S1'], eligible_student_ids: [], grades: [11],
      },
      {
        id: 'FLEX', course_id: 'FLEX', teacher_id: 'T_FLEX', class_type: 'teaching', weekly_hours: 1,
        student_ids: ['S1'], eligible_student_ids: [], grades: [11],
      },
    ],
  };

  const solution = await solveSchedule(problem, {
    maxTimeSeconds: 5,
    optimizeSoft: true,
    freezeMembership: true,
    useConstructiveSeed: false,
    fixedSearch: true,
  });

  assert.equal(solution.ok, true, solution.status);
  assert.equal(solution.meetings.find(item => item.section_id === 'FLEX')?.slot_id, 'D1P1');
  assert.equal(validateSchedule(problem, solution).soft_score, 10);
});

test('moves optional empty time to the afternoon after preserving the primary score', async () => {
  const problem = {
    // P6 is the lowest raw value. Without an explicit morning-fill objective,
    // fixed search leaves FLEX in the afternoon even though P2 is available.
    slots: [
      { id: 'D1P6', day: 1, period: 6 },
      { id: 'D1P2', day: 1, period: 2 },
      { id: 'D1P3', day: 1, period: 3 },
      { id: 'D1P5', day: 1, period: 5 },
      { id: 'D1P1', day: 1, period: 1 },
      { id: 'D1P4', day: 1, period: 4 },
    ],
    rooms: [],
    rules: [
      {
        id: 'first-fixed', type: 'fixed_slots', hard: true, scope: 'section',
        target_ids: ['FIRST'], section_target_ids: ['FIRST'], params: { slots: ['D1P1'], mode: 'exact' },
      },
      {
        id: 'fourth-fixed', type: 'fixed_slots', hard: true, scope: 'section',
        target_ids: ['FOURTH'], section_target_ids: ['FOURTH'], params: { slots: ['D1P4'], mode: 'exact' },
      },
      {
        id: 'student-prefix', type: 'no_internal_gaps', hard: false, weight: 10,
        scope: 'student', target_ids: ['S1'], params: { preferred_morning_periods: 5 },
      },
    ],
    sections: [
      {
        id: 'FIRST', course_id: 'FIRST', teacher_id: 'T_FIRST', class_type: 'teaching', weekly_hours: 1,
        student_ids: ['S1'], eligible_student_ids: [], grades: [11],
      },
      {
        id: 'FOURTH', course_id: 'FOURTH', teacher_id: 'T_FOURTH', class_type: 'teaching', weekly_hours: 1,
        student_ids: ['S1'], eligible_student_ids: [], grades: [11],
      },
      {
        id: 'FLEX', course_id: 'FLEX', teacher_id: 'T_FLEX', class_type: 'teaching', weekly_hours: 1,
        student_ids: ['S1'], eligible_student_ids: [], grades: [11],
      },
    ],
  };

  const solution = await solveSchedule(problem, {
    maxTimeSeconds: 5,
    optimizeSoft: true,
    freezeMembership: true,
    useConstructiveSeed: false,
    fixedSearch: true,
  });

  assert.equal(solution.ok, true, solution.status);
  assert.notEqual(solution.meetings.find(item => item.section_id === 'FLEX')?.slot_id, 'D1P6');
  assert.equal(solution.morning_empty_student_periods, 2);
  assert.equal(validateSchedule(problem, solution).soft_score, 10);
});

test('prioritizes AP morning occupancy ahead of ordinary soft preferences', async () => {
  const problem = {
    slots: [
      { id: 'D1P6', day: 1, period: 6 },
      { id: 'D1P2', day: 1, period: 2 },
      { id: 'D1P3', day: 1, period: 3 },
      { id: 'D1P5', day: 1, period: 5 },
      { id: 'D1P1', day: 1, period: 1 },
      { id: 'D1P4', day: 1, period: 4 },
    ],
    rooms: [],
    rules: [
      {
        id: 'first-fixed', type: 'fixed_slots', hard: true, scope: 'section',
        target_ids: ['FIRST'], section_target_ids: ['FIRST'], params: { slots: ['D1P1'], mode: 'exact' },
      },
      {
        id: 'fourth-fixed', type: 'fixed_slots', hard: true, scope: 'section',
        target_ids: ['FOURTH'], section_target_ids: ['FOURTH'], params: { slots: ['D1P4'], mode: 'exact' },
      },
      {
        id: 'student-prefix', type: 'no_internal_gaps', hard: false, weight: 10,
        scope: 'student', target_ids: ['S1'], params: { preferred_morning_periods: 5 },
      },
      {
        id: 'prefer-afternoon', type: 'preferred_slots', hard: false, weight: 100,
        scope: 'section', target_ids: ['FLEX'], section_target_ids: ['FLEX'], params: { slots: ['D1P6'] },
      },
    ],
    sections: [
      {
        id: 'FIRST', course_id: 'FIRST', teacher_id: 'T_FIRST', class_type: 'teaching', weekly_hours: 1,
        student_ids: ['S1'], eligible_student_ids: [], grades: [11],
      },
      {
        id: 'FOURTH', course_id: 'FOURTH', teacher_id: 'T_FOURTH', class_type: 'teaching', weekly_hours: 1,
        student_ids: ['S1'], eligible_student_ids: [], grades: [11],
      },
      {
        id: 'FLEX', course_id: 'FLEX', teacher_id: 'T_FLEX', class_type: 'teaching', weekly_hours: 1,
        student_ids: ['S1'], eligible_student_ids: [], grades: [11],
      },
    ],
  };

  const solution = await solveSchedule(problem, {
    maxTimeSeconds: 5,
    optimizeSoft: true,
    freezeMembership: true,
    useConstructiveSeed: false,
    fixedSearch: true,
  });

  assert.equal(solution.ok, true, solution.status);
  assert.notEqual(solution.meetings.find(item => item.section_id === 'FLEX')?.slot_id, 'D1P6');
  assert.equal(solution.morning_empty_student_periods, 2);
  assert.equal(validateSchedule(problem, solution).soft_score, 110);
});

test('keeps the AP Block preferred band ahead of competing ordinary soft weights', async () => {
  const problem = {
    slots: [
      { id: 'D1P1', day: 1, period: 1 },
      { id: 'D1P6', day: 1, period: 6 },
    ],
    rooms: [],
    rules: [
      {
        id: 'ap_block_AP_BLOCK_1_compact_band',
        type: 'preferred_slots', hard: false, weight: 2_000,
        scope: 'section', target_ids: ['AP'], section_target_ids: ['AP'],
        params: { slots: ['D1P1'] },
        generated_by: 'ap_block_compactness',
      },
      {
        id: 'ordinary-core-morning-preference',
        type: 'preferred_slots', hard: false, weight: 10_000,
        scope: 'section', target_ids: ['CORE'], section_target_ids: ['CORE'],
        params: { slots: ['D1P1'] },
      },
    ],
    sections: [
      {
        id: 'AP', course_id: 'AP', teacher_id: 'T_AP', class_type: 'ap', ap_block_id: 'AP_BLOCK_1',
        weekly_hours: 1, student_ids: ['S1'], eligible_student_ids: [], grades: [11],
      },
      {
        id: 'CORE', course_id: 'CORE', teacher_id: 'T_CORE', class_type: 'teaching',
        weekly_hours: 1, student_ids: ['S1'], eligible_student_ids: [], grades: [11],
      },
    ],
  };

  const solution = await solveSchedule(problem, {
    maxTimeSeconds: 5,
    optimizeSoft: true,
    freezeMembership: true,
    useConstructiveSeed: false,
    fixedSearch: true,
  });

  assert.equal(solution.ok, true, solution.status);
  assert.equal(solution.meetings.find(item => item.section_id === 'AP')?.slot_id, 'D1P1');
  assert.equal(solution.ap_block_afternoon_occurrences, 0);
});

test('uses the calibrated AP Block weight when the competing preference is weaker', async () => {
  const problem = {
    slots: [
      { id: 'D1P1', day: 1, period: 1 },
      { id: 'D1P6', day: 1, period: 6 },
    ],
    rooms: [],
    rules: [
      {
        id: 'ap_block_AP_BLOCK_1_compact_band',
        type: 'preferred_slots', hard: false, weight: 2_000,
        scope: 'section', target_ids: ['AP'], section_target_ids: ['AP'],
        params: { slots: ['D1P1'] }, generated_by: 'ap_block_compactness',
      },
      {
        id: 'ordinary-core-morning-preference',
        type: 'preferred_slots', hard: false, weight: 1_000,
        scope: 'section', target_ids: ['CORE'], section_target_ids: ['CORE'],
        params: { slots: ['D1P1'] },
      },
    ],
    sections: [
      {
        id: 'AP', course_id: 'AP', teacher_id: 'T_AP', class_type: 'ap', ap_block_id: 'AP_BLOCK_1',
        weekly_hours: 1, student_ids: ['S1'], eligible_student_ids: [], grades: [11],
      },
      {
        id: 'CORE', course_id: 'CORE', teacher_id: 'T_CORE', class_type: 'teaching',
        weekly_hours: 1, student_ids: ['S1'], eligible_student_ids: [], grades: [11],
      },
    ],
  };

  const solution = await solveSchedule(problem, {
    maxTimeSeconds: 5,
    optimizeSoft: true,
    freezeMembership: true,
    useConstructiveSeed: false,
    fixedSearch: true,
  });

  assert.equal(solution.ok, true, solution.status);
  assert.equal(solution.meetings.find(item => item.section_id === 'AP')?.slot_id, 'D1P1');
  assert.equal(solution.ap_block_afternoon_occurrences, 0);
});

test('allows an AP Block meeting in the afternoon when a hard rule requires it', async () => {
  const problem = {
    slots: [
      { id: 'D1P1', day: 1, period: 1 },
      { id: 'D1P6', day: 1, period: 6 },
    ],
    rooms: [],
    rules: [
      {
        id: 'ap-block-fixed-afternoon', type: 'fixed_slots', hard: true,
        scope: 'section', target_ids: ['AP'], section_target_ids: ['AP'],
        params: { slots: ['D1P6'], mode: 'exact' },
      },
      {
        id: 'ap_block_AP_BLOCK_1_compact_band',
        type: 'preferred_slots', hard: false, weight: 2_000,
        scope: 'section', target_ids: ['AP'], section_target_ids: ['AP'],
        params: { slots: ['D1P1'] },
        generated_by: 'ap_block_compactness',
      },
    ],
    sections: [{
      id: 'AP', course_id: 'AP', teacher_id: 'T_AP', class_type: 'ap', ap_block_id: 'AP_BLOCK_1',
      weekly_hours: 1, student_ids: ['S1'], eligible_student_ids: [], grades: [11],
    }],
  };

  const solution = await solveSchedule(problem, {
    maxTimeSeconds: 5,
    optimizeSoft: true,
    freezeMembership: true,
    useConstructiveSeed: false,
  });

  assert.equal(solution.ok, true, solution.status);
  assert.equal(solution.meetings[0]?.slot_id, 'D1P6');
  assert.equal(solution.ap_block_afternoon_occurrences, 1);
});

test('gives each AP Block one first period before optimizing ordinary soft weights', async () => {
  const problem = {
    slots: [
      { id: 'D1P1', day: 1, period: 1 },
      { id: 'D1P2', day: 1, period: 2 },
      { id: 'D1P6', day: 1, period: 6 },
      { id: 'D2P1', day: 2, period: 1 },
      { id: 'D2P2', day: 2, period: 2 },
      { id: 'D2P6', day: 2, period: 6 },
      { id: 'D2P7', day: 2, period: 7 },
    ],
    rooms: [],
    rules: [
      {
        id: 'ap_block_AP_BLOCK_1_one_first_period',
        type: 'target_occurrences_in_slots', hard: false, weight: 5_000,
        scope: 'section', target_ids: ['AP'], section_target_ids: ['AP'],
        params: {
          slots: ['D1P1', 'D2P1'], target: 1,
          objective_tier: 'ap_block_first_period_pattern',
        },
        generated_by: 'ap_block_compactness',
      },
      {
        id: 'ap_block_AP_BLOCK_1_compact_band',
        type: 'preferred_slots', hard: false, weight: 2_000,
        scope: 'section', target_ids: ['AP'], section_target_ids: ['AP'],
        params: { slots: ['D1P1', 'D1P2', 'D1P6', 'D2P1', 'D2P2', 'D2P6'] },
        generated_by: 'ap_block_compactness',
      },
      {
        id: 'strong-ordinary-first-period-preference',
        type: 'preferred_slots', hard: false, weight: 100_000,
        scope: 'section', target_ids: ['AP'], section_target_ids: ['AP'],
        params: { slots: ['D1P1', 'D2P1'] },
      },
    ],
    sections: [{
      id: 'AP', course_id: 'AP', teacher_id: 'T_AP', class_type: 'ap', ap_block_id: 'AP_BLOCK_1',
      weekly_hours: 3, student_ids: [], eligible_student_ids: [], grades: [11],
    }],
  };

  const solution = await solveSchedule(problem, {
    maxTimeSeconds: 5,
    optimizeSoft: true,
    freezeMembership: true,
    useConstructiveSeed: false,
    fixedSearch: true,
  });

  assert.equal(solution.ok, true, solution.status);
  assert.equal(solution.meetings.filter(item => item.slot_id.endsWith('P1')).length, 1);
  assert.ok(solution.meetings.every(item => Number(item.slot_id.split('P')[1]) <= 6));
  assert.equal(solution.ap_block_first_period_deviation, 0);
  assert.equal(solution.ap_block_first_period_actual_count, 1);
  assert.equal(solution.ap_block_first_period_target_count, 1);
});

test('keeps hard locks even when they force an AP Block away from its first-period target', async () => {
  const problem = {
    slots: [
      { id: 'D1P1', day: 1, period: 1 },
      { id: 'D1P2', day: 1, period: 2 },
      { id: 'D2P1', day: 2, period: 1 },
      { id: 'D2P2', day: 2, period: 2 },
    ],
    rooms: [],
    rules: [{
      id: 'ap_block_AP_BLOCK_1_one_first_period',
      type: 'target_occurrences_in_slots', hard: false, weight: 5_000,
      scope: 'section', target_ids: ['AP'], section_target_ids: ['AP'],
      params: {
        slots: ['D1P1', 'D2P1'], target: 1,
        objective_tier: 'ap_block_first_period_pattern',
      },
      generated_by: 'ap_block_compactness',
    }],
    sections: [{
      id: 'AP', course_id: 'AP', teacher_id: 'T_AP', class_type: 'ap', ap_block_id: 'AP_BLOCK_1',
      weekly_hours: 2, student_ids: [], eligible_student_ids: [], grades: [11],
    }],
  };
  const locks = [
    { section_id: 'AP', slot_id: 'D1P1' },
    { section_id: 'AP', slot_id: 'D2P1' },
  ];

  const solution = await solveSchedule(problem, {
    maxTimeSeconds: 5,
    optimizeSoft: true,
    freezeMembership: true,
    useConstructiveSeed: false,
    lockedMeetings: locks,
  });

  assert.equal(solution.ok, true, solution.status);
  assert.deepEqual(solution.meetings.map(item => item.slot_id).sort(), ['D1P1', 'D2P1']);
  assert.equal(solution.ap_block_first_period_actual_count, 2);
  assert.equal(solution.ap_block_first_period_target_count, 1);
  assert.equal(solution.ap_block_first_period_deviation, 1);
  assert.equal(validateSchedule(problem, { ...solution, locks }).ok, true);
});

test('returns the core timetable assumptions responsible for infeasibility', async () => {
  const problem = {
    slots,
    rooms: [],
    rules: [{
      id: 'fixed-a', type: 'fixed_slots', hard: true, scope: 'section',
      target_ids: ['A'], section_target_ids: ['A'], params: { slots: ['D1P1'], mode: 'exact' },
    }],
    sections: [
      { id: 'A', course_id: 'A', teacher_id: 'T1', class_type: 'teaching', weekly_hours: 1, student_ids: [], eligible_student_ids: [] },
    ],
  };

  const solution = await solveSchedule(problem, {
    maxTimeSeconds: 5,
    useConstructiveSeed: false,
    freezeMembership: true,
    assumptionMeetings: [{ section_id: 'A', occurrence_index: 0, slot_id: 'D1P2' }],
  });

  assert.equal(solution.ok, false);
  assert.equal(solution.status, 'INFEASIBLE');
  assert.deepEqual(solution.infeasible_assumption_meetings, [
    { section_id: 'A', occurrence_index: 0, slot_id: 'D1P2' },
  ]);
});

test('applies a timetable no-good cut from an infeasible assumption core', async () => {
  const problem = {
    slots,
    rooms: [],
    rules: [],
    sections: [
      { id: 'A', course_id: 'A', teacher_id: 'T1', class_type: 'teaching', weekly_hours: 1, student_ids: [], eligible_student_ids: [] },
      { id: 'B', course_id: 'B', teacher_id: 'T2', class_type: 'teaching', weekly_hours: 1, student_ids: [], eligible_student_ids: [] },
    ],
  };

  const solution = await solveSchedule(problem, {
    maxTimeSeconds: 5,
    useConstructiveSeed: false,
    freezeMembership: true,
    timetableCuts: [[
      { section_id: 'A', occurrence_index: 0, slot_id: 'D1P1' },
      { section_id: 'B', occurrence_index: 0, slot_id: 'D1P1' },
    ]],
  });

  assert.equal(solution.ok, true);
  assert.ok(solution.meetings.some(meeting => meeting.slot_id !== 'D1P1'));
});

test('bounds the number of distinct slots used by a grade elective layer', async () => {
  const problem = {
    slots,
    rooms: [],
    rules: [
      { id: 'fixed-a', type: 'fixed_slots', hard: true, scope: 'section', target_ids: ['A'], section_target_ids: ['A'], params: { slots: ['D1P1'], mode: 'exact' } },
      { id: 'fixed-b', type: 'fixed_slots', hard: true, scope: 'section', target_ids: ['B'], section_target_ids: ['B'], params: { slots: ['D1P2'], mode: 'exact' } },
    ],
    sections: [
      { id: 'A', course_id: 'A', teacher_id: 'T1', class_type: 'ap', weekly_hours: 1, student_ids: [], eligible_student_ids: [] },
      { id: 'B', course_id: 'B', teacher_id: 'T2', class_type: 'ap', weekly_hours: 1, student_ids: [], eligible_student_ids: [] },
    ],
  };

  const solution = await solveSchedule(problem, {
    maxTimeSeconds: 5,
    useConstructiveSeed: false,
    freezeMembership: true,
    slotUnionBounds: [{ id: 'G11_SELECTED', section_ids: ['A', 'B'], max_distinct_slots: 1 }],
  });

  assert.equal(solution.ok, false);
  assert.equal(solution.status, 'INFEASIBLE');
});

test('keeps co-selected courses apart before assigning parallel sections', async () => {
  const problem = {
    slots: slots.slice(0, 2),
    rooms: [],
    rules: [
      { id: 'fixed-a', type: 'fixed_slots', hard: true, scope: 'section', target_ids: ['A1'], section_target_ids: ['A1'], params: { slots: ['D1P1'], mode: 'exact' } },
      { id: 'fixed-b', type: 'fixed_slots', hard: true, scope: 'section', target_ids: ['B1'], section_target_ids: ['B1'], params: { slots: ['D1P1'], mode: 'exact' } },
    ],
    sections: [
      { id: 'A1', course_id: 'A', teacher_id: 'TA', class_type: 'ap', weekly_hours: 1, student_ids: [], eligible_student_ids: ['S1'] },
      { id: 'B1', course_id: 'B', teacher_id: 'TB', class_type: 'ap', weekly_hours: 1, student_ids: [], eligible_student_ids: ['S1'] },
    ],
  };

  const solution = await solveSchedule(problem, {
    maxTimeSeconds: 5,
    useConstructiveSeed: false,
    freezeMembership: true,
    courseConflictPairs: [{ left_course_id: 'A', right_course_id: 'B' }],
  });

  assert.equal(solution.ok, false);
  assert.equal(solution.status, 'INFEASIBLE');
});

test('reserves enough student-free slots for an unscheduled core section', async () => {
  const twoSlots = slots.slice(0, 2);
  const problem = {
    slots: twoSlots,
    rooms: [],
    rules: [{
      id: 'fixed-ap', type: 'fixed_slots', hard: true, scope: 'section',
      target_ids: ['AP1'], section_target_ids: ['AP1'], params: { slots: ['D1P1'], mode: 'exact' },
    }],
    sections: [
      {
        id: 'AP1', course_id: 'AP', teacher_id: 'T_AP', class_type: 'ap', weekly_hours: 1,
        student_ids: [], eligible_student_ids: ['S1'], grades: [11],
      },
    ],
  };

  const solution = await solveSchedule(problem, {
    maxTimeSeconds: 5,
    useConstructiveSeed: false,
    freezeMembership: true,
    assignmentGroups: [{
      id: 'G1', student_ids: ['S1'], core_section_ids: [],
      courses: [{ course_id: 'AP', candidate_section_ids: ['AP1'] }],
      fixed_sections: {},
    }],
    coreAvailabilityRequirements: [{
      id: 'CORE',
      required_slots: 2,
      student_ids: ['S1'],
      unconditional_blocking_section_ids: [],
    }],
  });

  assert.equal(solution.ok, false);
  assert.equal(solution.status, 'INFEASIBLE');
});

test('reserves core availability inside the required day instead of elsewhere in the week', async () => {
  const problem = {
    slots: [
      { id: 'D1P1', day: 1, period: 1 },
      { id: 'D2P1', day: 2, period: 1 },
    ],
    rooms: [],
    rules: [{
      id: 'fixed-ap', type: 'fixed_slots', hard: true, scope: 'section',
      target_ids: ['AP1'], section_target_ids: ['AP1'], params: { slots: ['D1P1'], mode: 'exact' },
    }],
    sections: [{
      id: 'AP1', course_id: 'AP', teacher_id: 'T_AP', class_type: 'ap', weekly_hours: 1,
      student_ids: [], eligible_student_ids: ['S1'], grades: [11],
    }],
  };

  const solution = await solveSchedule(problem, {
    maxTimeSeconds: 5,
    useConstructiveSeed: false,
    freezeMembership: true,
    assignmentGroups: [{
      id: 'G1', student_ids: ['S1'], core_section_ids: [],
      courses: [{ course_id: 'AP', candidate_section_ids: ['AP1'] }],
      fixed_sections: {},
    }],
    coreAvailabilityRequirements: [{
      id: 'CORE_DAY_1', required_slots: 1, student_ids: ['S1'],
      eligible_slot_ids: ['D1P1'], unconditional_blocking_section_ids: [],
    }],
  });

  assert.equal(solution.ok, false);
  assert.equal(solution.status, 'INFEASIBLE');
});

test('rejects a locked lesson that would leave an internal student timetable gap', async () => {
  const problem = {
    slots,
    rooms: [],
    rules: [{
      id: 'student-daily-prefix',
      type: 'no_internal_gaps',
      hard: true,
      scope: 'student',
      target_ids: ['S1'],
      params: {},
    }],
    sections: [
      { id: 'A', course_id: 'A', teacher_id: 'T1', class_type: 'teaching', weekly_hours: 1, student_ids: ['S1'], eligible_student_ids: [] },
      { id: 'B', course_id: 'B', teacher_id: 'T2', class_type: 'teaching', weekly_hours: 1, student_ids: ['S1'], eligible_student_ids: [] },
    ],
  };

  const solution = await solveSchedule(problem, {
    maxTimeSeconds: 5,
    useConstructiveSeed: false,
    lockedMeetings: [{ section_id: 'B', slot_id: 'D1P3' }],
  });

  assert.equal(solution.ok, false, 'two daily lessons cannot occupy P1 and P3 while P2 is empty');
});

test('fills earlier periods when a later student lesson is locked', async () => {
  const problem = {
    slots,
    rooms: [],
    rules: [{
      id: 'student-daily-prefix',
      type: 'no_internal_gaps',
      hard: true,
      scope: 'student',
      target_ids: ['S1'],
      params: {},
    }],
    sections: [
      { id: 'A', course_id: 'A', teacher_id: 'T1', class_type: 'teaching', weekly_hours: 1, student_ids: ['S1'], eligible_student_ids: [] },
      { id: 'B', course_id: 'B', teacher_id: 'T2', class_type: 'teaching', weekly_hours: 1, student_ids: ['S1'], eligible_student_ids: [] },
    ],
  };

  const solution = await solveSchedule(problem, {
    maxTimeSeconds: 5,
    useConstructiveSeed: false,
    lockedMeetings: [{ section_id: 'B', slot_id: 'D1P2' }],
  });

  assert.equal(solution.ok, true, solution.status);
  assert.deepEqual(
    solution.meetings.map(meeting => meeting.slot_id).sort(),
    ['D1P1', 'D1P2'],
  );
  assert.equal(validateSchedule(problem, solution).ok, true);
});

test('keeps configured fixed activities outside the ordinary lesson prefix', async () => {
  const problem = {
    slots,
    rooms: [],
    rules: [{
      id: 'student-daily-prefix',
      type: 'no_internal_gaps',
      hard: true,
      scope: 'student',
      target_ids: ['S1'],
      params: { ignore_course_ids: ['ACTIVITY'] },
    }],
    sections: [
      { id: 'A', course_id: 'A', teacher_id: 'T1', class_type: 'teaching', weekly_hours: 1, student_ids: ['S1'], eligible_student_ids: [] },
      { id: 'ACTIVITY', course_id: 'ACTIVITY', teacher_id: 'T2', class_type: 'admin', weekly_hours: 1, student_ids: ['S1'], eligible_student_ids: [] },
    ],
  };

  const solution = await solveSchedule(problem, {
    maxTimeSeconds: 5,
    useConstructiveSeed: false,
    lockedMeetings: [{ section_id: 'ACTIVITY', slot_id: 'D1P10' }],
  });

  assert.equal(solution.ok, true, solution.status);
  assert.equal(solution.meetings.find(meeting => meeting.section_id === 'A').slot_id, 'D1P1');
  assert.equal(validateSchedule(problem, solution).ok, true);
});

test('constructive schedule honors locked meetings instead of disabling the fast path', async () => {
  const problem = {
    slots,
    rooms: [{ id: 'R1', capacity: 30 }],
    rules: [],
    sections: [{
      id: 'LOCKED_FAST', course_id: 'C', teacher_id: 'T', class_type: 'teaching',
      weekly_hours: 2, student_ids: ['S'], eligible_student_ids: [],
      room_id: 'R1', room_candidates: ['R1'],
    }],
  };
  const locks = [{ section_id: 'LOCKED_FAST', slot_id: 'D1P7' }];
  const solution = await solveSchedule(problem, { maxTimeSeconds: 5, lockedMeetings: locks });
  assert.equal(solution.ok, true);
  assert.equal(solution.status, 'CONSTRUCTIVE_FEASIBLE');
  assert.ok(solution.meetings.some(meeting => meeting.slot_id === 'D1P7'));
  assert.equal(validateSchedule(problem, { ...solution, locks }).ok, true);
});

test('keeps an administrator-locked student in the selected parallel section', async () => {
  const problem = {
    slots,
    rooms: [{ id: 'R1', capacity: 2 }, { id: 'R2', capacity: 2 }],
    rules: [],
    sections: [
      { id: 'CORE', course_id: 'CORE', teacher_id: 'T1', class_type: 'teaching', weekly_hours: 1, student_ids: ['S1', 'S2'], eligible_student_ids: [], room_id: 'R1', room_candidates: ['R1', 'R2'] },
      { id: 'AP1', course_id: 'AP', teacher_id: 'T2', class_type: 'ap', weekly_hours: 1, student_ids: ['S1'], eligible_student_ids: ['S1', 'S2'], locked_student_ids: [], room_id: 'R1', room_candidates: ['R1', 'R2'], capacity: 2 },
      { id: 'AP2', course_id: 'AP', teacher_id: 'T3', class_type: 'ap', weekly_hours: 1, student_ids: ['S2'], eligible_student_ids: ['S1', 'S2'], locked_student_ids: ['S1'], room_id: 'R1', room_candidates: ['R1', 'R2'], capacity: 2 },
    ],
  };
  const solution = await solveSchedule(problem, { maxTimeSeconds: 5 });
  assert.equal(solution.ok, true);
  assert.ok(solution.sections.find(section => section.id === 'AP2').student_ids.includes('S1'));
  assert.ok(!solution.sections.find(section => section.id === 'AP1').student_ids.includes('S1'));
  assert.equal(validateSchedule(problem, solution).ok, true);
});

test('enforces a rule targeting one student even when elective students would otherwise share a cohort', async () => {
  const problem = {
    slots,
    rooms: [{ id: 'R1', capacity: 2 }, { id: 'R2', capacity: 2 }],
    rules: [
      { id: 'fixed-core', type: 'fixed_slots', hard: true, scope: 'section', target_ids: ['CORE'], section_target_ids: ['CORE'], params: { slots: ['D1P1', 'D1P2'], mode: 'exact' } },
      { id: 'fixed-ap', type: 'fixed_slots', hard: true, scope: 'course', target_ids: ['AP'], section_target_ids: ['AP1', 'AP2'], params: { slots: ['D1P3'], mode: 'exact' } },
      { id: 's1-no-three-in-a-row', type: 'max_consecutive_lessons', hard: true, scope: 'student', target_ids: ['S1'], params: { max: 2 } },
    ],
    sections: [
      { id: 'CORE', course_id: 'CORE', teacher_id: 'T1', class_type: 'teaching', weekly_hours: 2, student_ids: ['S1', 'S2'], eligible_student_ids: [], room_id: 'R1', room_candidates: ['R1', 'R2'] },
      { id: 'AP1', course_id: 'AP', teacher_id: 'T2', class_type: 'ap', weekly_hours: 1, student_ids: ['S1'], eligible_student_ids: ['S1', 'S2'], room_id: 'R1', room_candidates: ['R1', 'R2'], capacity: 2 },
      { id: 'AP2', course_id: 'AP', teacher_id: 'T3', class_type: 'ap', weekly_hours: 1, student_ids: ['S2'], eligible_student_ids: ['S1', 'S2'], room_id: 'R1', room_candidates: ['R1', 'R2'], capacity: 2 },
    ],
  };
  const solution = await solveSchedule(problem, { maxTimeSeconds: 5, useConstructiveSeed: false });
  assert.equal(solution.ok, false, 'S1 would have fixed lessons in D1P1, D1P2 and D1P3');
});

test('explains a full-week student workload that contradicts a consecutive-lesson hard rule', async () => {
  const problem = {
    slots,
    rooms: [{ id: 'R1', capacity: 30 }],
    rules: [{ id: 'all-courses-no-four-in-a-row', type: 'max_consecutive_lessons', hard: true, scope: 'student', target_ids: ['S1'], params: { max: 3 } }],
    sections: [{ id: 'FULL', course_id: 'FULL', teacher_id: 'T1', class_type: 'teaching', weekly_hours: 10, student_ids: ['S1'], eligible_student_ids: [], room_id: 'R1', room_candidates: ['R1'] }],
  };
  const solution = await solveSchedule(problem, { maxTimeSeconds: 5 });
  assert.equal(solution.ok, false);
  assert.equal(solution.status, 'INFEASIBLE_BY_WORKLOAD');
  assert.match(solution.reason, /占满全部/);
});

test('rejects a teacher workload above the configured weekly upper limit', async () => {
  const problem = {
    slots,
    rooms: [],
    rules: [],
    teacher_limits: [{ teacher_id: 'T1', max_per_week: 1 }],
    sections: [{
      id: 'MATH', course_id: 'MATH', teacher_id: 'T1', class_type: 'teaching',
      weekly_hours: 2, student_ids: [], eligible_student_ids: [],
    }],
  };

  const solution = await solveSchedule(problem, { maxTimeSeconds: 5 });

  assert.equal(solution.ok, false);
  assert.equal(solution.status, 'INFEASIBLE_BY_TEACHER_WEEKLY_LIMIT');
  assert.match(solution.reason, /教师 T1.*2.*上限 1/);
});

test('does not fill a teacher workload up to the weekly upper limit', async () => {
  const problem = {
    slots,
    rooms: [],
    rules: [],
    teacher_limits: [{ teacher_id: 'T1', max_per_week: 5 }],
    sections: [{
      id: 'MATH', course_id: 'MATH', teacher_id: 'T1', class_type: 'teaching',
      weekly_hours: 2, student_ids: [], eligible_student_ids: [],
    }],
  };

  const solution = await solveSchedule(problem, { maxTimeSeconds: 5 });

  assert.equal(solution.ok, true, solution.reason || solution.status);
  assert.equal(solution.meetings.length, 2);
});

test('ignores daily and availability limits for a teacher with no scheduled lessons', async () => {
  const problem = {
    slots,
    rooms: [],
    rules: [],
    teacher_limits: [{
      teacher_id: 'T_UNUSED',
      teacher_name: '本周无课教师',
      max_per_day: 6,
      max_per_week: 25,
      available_slot_ids: ['D1P1'],
    }],
    sections: [{
      id: 'MATH', course_id: 'MATH', teacher_id: 'T1', class_type: 'teaching',
      weekly_hours: 1, student_ids: [], eligible_student_ids: [],
    }],
  };

  const solution = await solveSchedule(problem, {
    maxTimeSeconds: 5,
    useConstructiveSeed: false,
  });

  assert.equal(solution.ok, true, solution.reason || solution.status);
  assert.equal(solution.meetings.length, 1);
});

test('rejects a teacher day above the configured daily upper limit', async () => {
  const problem = {
    slots,
    rooms: [],
    rules: [{
      id: 'monday-double',
      type: 'fixed_slots',
      hard: true,
      scope: 'section',
      target_ids: ['MATH'],
      section_target_ids: ['MATH'],
      params: { slots: ['D1P1', 'D1P2'], mode: 'exact' },
    }],
    teacher_limits: [{ teacher_id: 'T1', teacher_name: '数学教师', max_per_day: 1 }],
    sections: [{
      id: 'MATH', course_id: 'MATH', teacher_id: 'T1', class_type: 'teaching',
      weekly_hours: 2, student_ids: [], eligible_student_ids: [],
    }],
  };

  const solution = await solveSchedule(problem, { maxTimeSeconds: 5 });

  assert.equal(solution.ok, false);
  assert.equal(solution.status, 'INFEASIBLE_BY_TEACHER_DAILY_LIMIT');
});

test('explains when a teacher daily upper limit cannot cover the weekly workload', async () => {
  const weekSlots = Array.from({ length: 50 }, (_, index) => ({
    id: `D${Math.floor(index / 10) + 1}P${index % 10 + 1}`,
    day: Math.floor(index / 10) + 1,
    period: index % 10 + 1,
  }));
  const problem = {
    slots: weekSlots,
    rooms: [],
    rules: [],
    teacher_limits: [{ teacher_id: 'T1', teacher_name: '数学教师', max_per_day: 1 }],
    sections: [{
      id: 'MATH', course_id: 'MATH', teacher_id: 'T1', class_type: 'teaching',
      weekly_hours: 6, student_ids: [], eligible_student_ids: [],
    }],
  };

  const solution = await solveSchedule(problem, { maxTimeSeconds: 5 });

  assert.equal(solution.ok, false);
  assert.equal(solution.status, 'INFEASIBLE_BY_TEACHER_DAILY_LIMIT');
  assert.match(solution.reason, /数学教师.*6.*每天上限 1.*最多.*5/);
});

test('rejects a lesson outside the teacher configured available slots', async () => {
  const problem = {
    slots,
    rooms: [],
    rules: [{
      id: 'fixed-unavailable-time',
      type: 'fixed_slots',
      hard: true,
      scope: 'section',
      target_ids: ['MATH'],
      section_target_ids: ['MATH'],
      params: { slots: ['D1P2'], mode: 'exact' },
    }],
    teacher_limits: [{
      teacher_id: 'T1', teacher_name: '数学教师', available_slot_ids: ['D1P1'],
    }],
    sections: [{
      id: 'MATH', course_id: 'MATH', teacher_id: 'T1', class_type: 'teaching',
      weekly_hours: 1, student_ids: [], eligible_student_ids: [],
    }],
  };

  const solution = await solveSchedule(problem, { maxTimeSeconds: 5 });

  assert.equal(solution.ok, false);
  assert.equal(solution.status, 'INFEASIBLE');
});

test('explains when teacher availability cannot cover the weekly workload', async () => {
  const problem = {
    slots,
    rooms: [],
    rules: [],
    teacher_limits: [{
      teacher_id: 'T1', teacher_name: '数学教师', available_slot_ids: ['D1P1'],
    }],
    sections: [{
      id: 'MATH', course_id: 'MATH', teacher_id: 'T1', class_type: 'teaching',
      weekly_hours: 2, student_ids: [], eligible_student_ids: [],
    }],
  };

  const solution = await solveSchedule(problem, { maxTimeSeconds: 5 });

  assert.equal(solution.ok, false);
  assert.equal(solution.status, 'INFEASIBLE_BY_TEACHER_AVAILABILITY');
  assert.match(solution.reason, /数学教师.*2.*可用时段.*1/);
});

test('independently validates a teacher weekly upper limit', () => {
  const problem = {
    slots,
    rooms: [],
    rules: [],
    teacher_limits: [{ teacher_id: 'T1', teacher_name: '数学教师', max_per_week: 1 }],
    sections: [{
      id: 'MATH', course_id: 'MATH', teacher_id: 'T1', class_type: 'teaching',
      weekly_hours: 2, student_ids: [], eligible_student_ids: [],
    }],
  };
  const candidate = {
    sections: problem.sections,
    meetings: [
      { section_id: 'MATH', slot_id: 'D1P1' },
      { section_id: 'MATH', slot_id: 'D1P2' },
    ],
  };

  const validation = validateSchedule(problem, candidate);

  assert.equal(validation.ok, false);
  assert.equal(validation.hard_violations[0]?.rule_id, 'kernel.teacher_max_per_week');
  assert.match(validation.hard_violations[0]?.message || '', /数学教师.*2.*上限 1/);
});

test('independently validates a teacher daily upper limit', () => {
  const problem = {
    slots,
    rooms: [],
    rules: [],
    teacher_limits: [{ teacher_id: 'T1', teacher_name: '数学教师', max_per_day: 1 }],
    sections: [{
      id: 'MATH', course_id: 'MATH', teacher_id: 'T1', class_type: 'teaching',
      weekly_hours: 2, student_ids: [], eligible_student_ids: [],
    }],
  };
  const candidate = {
    sections: problem.sections,
    meetings: [
      { section_id: 'MATH', slot_id: 'D1P1' },
      { section_id: 'MATH', slot_id: 'D1P2' },
    ],
  };

  const validation = validateSchedule(problem, candidate);

  assert.equal(validation.ok, false);
  assert.equal(validation.hard_violations[0]?.rule_id, 'kernel.teacher_max_per_day');
  assert.match(validation.hard_violations[0]?.message || '', /数学教师.*第 1 天.*2.*上限 1/);
});

test('independently validates a teacher available-slot list', () => {
  const problem = {
    slots,
    rooms: [],
    rules: [],
    teacher_limits: [{
      teacher_id: 'T1', teacher_name: '数学教师', available_slot_ids: ['D1P1'],
    }],
    sections: [{
      id: 'MATH', course_id: 'MATH', teacher_id: 'T1', class_type: 'teaching',
      weekly_hours: 1, student_ids: [], eligible_student_ids: [],
    }],
  };
  const candidate = {
    sections: problem.sections,
    meetings: [{ section_id: 'MATH', slot_id: 'D1P2' }],
  };

  const validation = validateSchedule(problem, candidate);

  assert.equal(validation.ok, false);
  assert.equal(validation.hard_violations[0]?.rule_id, 'kernel.teacher_available_slots');
  assert.match(validation.hard_violations[0]?.message || '', /数学教师.*D1P2/);
});

test('optimizes a soft time preference after satisfying hard constraints', async () => {
  const problem = {
    slots,
    rooms: [{ id: 'R1', capacity: 30 }],
    rules: [{ id: 'prefer-last', type: 'preferred_slots', hard: false, weight: 5, scope: 'section', target_ids: ['PREFERRED'], params: { slots: ['D1P10'] } }],
    sections: [{ id: 'PREFERRED', course_id: 'C', teacher_id: 'T', class_type: 'teaching', weekly_hours: 1, student_ids: ['S'], eligible_student_ids: [], room_id: 'R1', room_candidates: ['R1'] }],
  };
  const solution = await solveSchedule(problem, { maxTimeSeconds: 5, optimizeSoft: true });
  const validation = validateSchedule(problem, solution);
  assert.equal(solution.ok, true);
  assert.equal(solution.meetings[0].slot_id, 'D1P10');
  assert.equal(validation.soft_score, 0);
});

test('strongly avoids giving a teacher both the first and last period of one day', async () => {
  const problem = {
    slots,
    rooms: [],
    rules: [
      { id: 'fix-first', type: 'fixed_slots', hard: true, scope: 'section', target_ids: ['FIRST'], section_target_ids: ['FIRST'], params: { slots: ['D1P1'], mode: 'exact' } },
      { id: 'prefer-last', type: 'preferred_slots', hard: false, weight: 10, scope: 'section', target_ids: ['FLEX'], section_target_ids: ['FLEX'], params: { slots: ['D1P10'] } },
      { id: 'teacher-day-extremes', type: 'avoid_teacher_day_extremes', hard: false, weight: 1000, scope: 'teacher', target_ids: ['T1'], section_target_ids: ['FIRST', 'FLEX'], params: { first_period: 1, last_period: 10 } },
    ],
    sections: [
      { id: 'FIRST', course_id: 'A', teacher_id: 'T1', class_type: 'teaching', weekly_hours: 1, student_ids: ['S1'], eligible_student_ids: [] },
      { id: 'FLEX', course_id: 'B', teacher_id: 'T1', class_type: 'teaching', weekly_hours: 1, student_ids: ['S2'], eligible_student_ids: [] },
    ],
  };
  const solution = await solveSchedule(problem, { maxTimeSeconds: 5, optimizeSoft: true, useConstructiveSeed: false });
  const validation = validateSchedule(problem, solution);

  assert.equal(solution.ok, true, solution.reason);
  assert.notEqual(solution.meetings.find(item => item.section_id === 'FLEX')?.slot_id, 'D1P10');
  assert.equal(validation.soft_violations.some(item => item.rule_id === 'teacher-day-extremes'), false);
  assert.equal(validation.soft_score, 10);
});

test('prioritizes one requested consecutive pair for a teaching section', async () => {
  const problem = {
    slots,
    rooms: [],
    rules: [{
      id: 'teaching-double-periods', type: 'preferred_consecutive_pairs', hard: false, weight: 100,
      scope: 'section', target_ids: ['PAIRED'], section_target_ids: ['PAIRED'], params: { target_pairs: 1 },
    }],
    sections: [{ id: 'PAIRED', course_id: 'MATH', teacher_id: 'T1', class_type: 'teaching', weekly_hours: 4, student_ids: ['S1'], eligible_student_ids: [] }],
  };
  const solution = await solveSchedule(problem, { maxTimeSeconds: 5, optimizeSoft: true, useConstructiveSeed: false });
  const validation = validateSchedule(problem, solution);
  assert.equal(solution.ok, true);
  assert.equal(validation.soft_score, 0, JSON.stringify(validation.soft_violations));
});

test('spreads a section across the configured minimum number of days', async () => {
  const problem = {
    slots: [
      { id: 'D1P1', day: 1, period: 1 },
      { id: 'D2P1', day: 2, period: 1 },
      { id: 'D3P1', day: 3, period: 1 },
    ],
    rooms: [],
    rules: [{
      id: 'spread-core', type: 'min_occurrence_days', hard: true,
      scope: 'section', target_ids: ['SPREAD'], section_target_ids: ['SPREAD'], params: { min: 3 },
    }],
    sections: [{ id: 'SPREAD', course_id: 'CORE', teacher_id: 'T1', class_type: 'teaching', weekly_hours: 3, student_ids: ['S1'], eligible_student_ids: [] }],
  };
  const solution = await solveSchedule(problem, { maxTimeSeconds: 5, useConstructiveSeed: false });
  assert.equal(solution.ok, true, solution.reason || solution.status);
  assert.equal(new Set(solution.meetings.map(meeting => meeting.slot_id.slice(0, 2))).size, 3);
});

test('allows concurrent sections without room or capacity constraints', async () => {
  const problem = {
    slots: [{ id: 'D1P1', day: 1, period: 1 }],
    rooms: [{ id: 'R1', capacity: 1 }],
    rules: [{
      id: 'all-at-one', type: 'fixed_slots', hard: true, scope: 'section',
      target_ids: ['A', 'B', 'C'], section_target_ids: ['A', 'B', 'C'],
      params: { slots: ['D1P1'], mode: 'exact' },
    }],
    sections: ['A', 'B', 'C'].map((id, index) => ({
      id,
      course_id: id,
      teacher_id: `T${index + 1}`,
      class_type: 'teaching',
      weekly_hours: 1,
      student_ids: [`S${index + 1}`],
      eligible_student_ids: [],
      room_id: 'R1',
      room_candidates: ['R1'],
    })),
  };
  const solution = await solveSchedule(problem, {
    maxTimeSeconds: 5,
    useConstructiveSeed: false,
  });
  assert.equal(solution.ok, true, solution.reason || solution.status);
  assert.deepEqual(solution.meetings.map(meeting => meeting.slot_id), ['D1P1', 'D1P1', 'D1P1']);
  assert.ok(solution.meetings.every(meeting => meeting.room_id == null));
  assert.equal(validateSchedule(problem, solution).ok, true);
});
