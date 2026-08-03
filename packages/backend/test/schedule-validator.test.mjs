import assert from 'node:assert/strict';
import test from 'node:test';
import { validateSchedule } from '../src/schedule-validator.mjs';

const slots = Array.from({ length: 10 }, (_, index) => ({ id: `D1P${index + 1}`, day: 1, period: index + 1 }));

function problem(rules = []) {
  return {
    slots,
    rooms: [{ id: 'R1', capacity: 30 }, { id: 'R2', capacity: 30 }],
    rules,
    sections: [
      { id: 'CORE', course_id: 'CORE', teacher_id: 'T1', class_id: 'C1', class_type: 'teaching', weekly_hours: 1, student_ids: ['S1'], eligible_student_ids: [], room_id: 'R1', room_candidates: ['R1', 'R2'] },
      { id: 'AP1', course_id: 'AP', teacher_id: 'T2', class_type: 'ap', weekly_hours: 1, student_ids: ['S1'], eligible_student_ids: ['S1', 'S2'], room_id: 'R1', room_candidates: ['R1', 'R2'], capacity: 30 },
      { id: 'AP2', course_id: 'AP', teacher_id: 'T3', class_type: 'ap', weekly_hours: 1, student_ids: ['S2'], eligible_student_ids: ['S1', 'S2'], room_id: 'R1', room_candidates: ['R1', 'R2'], capacity: 30 },
    ],
  };
}

test('accepts a conflict-free schedule with a valid selected-course partition', () => {
  const result = validateSchedule(problem(), { meetings: [
    { section_id: 'CORE', slot_id: 'D1P1', room_id: 'R1' },
    { section_id: 'AP1', slot_id: 'D1P2', room_id: 'R1' },
    { section_id: 'AP2', slot_id: 'D1P3', room_id: 'R1' },
  ] });
  assert.equal(result.ok, true);
  assert.equal(result.soft_score, 0);
});

test('rejects an internal gap in a student daily timetable', () => {
  const rules = [{
    id: 'student-daily-prefix',
    type: 'no_internal_gaps',
    hard: true,
    scope: 'student',
    target_ids: ['S1'],
    params: {},
  }];
  const result = validateSchedule(problem(rules), { meetings: [
    { section_id: 'CORE', slot_id: 'D1P1', room_id: 'R1' },
    { section_id: 'AP1', slot_id: 'D1P3', room_id: 'R1' },
    { section_id: 'AP2', slot_id: 'D1P2', room_id: 'R1' },
  ] });

  assert.equal(result.ok, false);
  assert.ok(result.hard_violations.some(item =>
    item.rule_id === 'student-daily-prefix'
    && item.target_id === 'S1'
    && item.day === 1));
});

test('allows configured fixed activities outside the ordinary lesson prefix', () => {
  const rules = [{
    id: 'student-daily-prefix',
    type: 'no_internal_gaps',
    hard: true,
    scope: 'student',
    target_ids: ['S1'],
    params: { ignore_course_ids: ['CORE'] },
  }];
  const result = validateSchedule(problem(rules), { meetings: [
    { section_id: 'CORE', slot_id: 'D1P10', room_id: 'R1' },
    { section_id: 'AP1', slot_id: 'D1P1', room_id: 'R1' },
    { section_id: 'AP2', slot_id: 'D1P2', room_id: 'R1' },
  ] });

  assert.equal(result.ok, true, JSON.stringify(result.hard_violations));
});

test('rejects a student collision and an invalid parallel-section membership', () => {
  const result = validateSchedule(problem(), {
    sections: [{ id: 'AP1', student_ids: ['S1', 'S2'] }, { id: 'AP2', student_ids: ['S2'] }],
    meetings: [
      { section_id: 'CORE', slot_id: 'D1P1', room_id: 'R1' },
      { section_id: 'AP1', slot_id: 'D1P1', room_id: 'R2' },
      { section_id: 'AP2', slot_id: 'D1P3', room_id: 'R1' },
    ],
  });
  assert.equal(result.ok, false);
  assert.ok(result.hard_violations.some(item => item.rule_id === 'kernel.student_no_overlap'));
  assert.ok(result.hard_violations.some(item => item.rule_id === 'kernel.selected_course_membership'));
});

test('validates the teacher recorded in the saved schedule section', () => {
  const result = validateSchedule(problem(), {
    // AP1 is reassigned to T3, who already teaches AP2.  The different rooms
    // make this specifically a teacher-overlap test rather than a room clash.
    sections: [{ id: 'AP1', teacher_id: 'T3' }],
    meetings: [
      { section_id: 'CORE', slot_id: 'D1P1', room_id: 'R1' },
      { section_id: 'AP1', slot_id: 'D1P2', room_id: 'R1' },
      { section_id: 'AP2', slot_id: 'D1P2', room_id: 'R2' },
    ],
  });
  assert.equal(result.ok, false);
  assert.ok(result.hard_violations.some(item => item.rule_id === 'kernel.resource_no_overlap' && item.message.includes('teacher@T3')));
});

test('separates hard rule failures from weighted soft rule penalties', () => {
  const rules = [
    { id: 'fixed-core', type: 'fixed_slots', hard: true, scope: 'section', target_ids: ['CORE'], params: { slots: ['D1P2'], mode: 'exact' } },
    { id: 'prefer-ap-late', type: 'preferred_slots', hard: false, weight: 7, scope: 'course', target_ids: ['AP'], params: { slots: ['D1P10'] } },
  ];
  const result = validateSchedule(problem(rules), { meetings: [
    { section_id: 'CORE', slot_id: 'D1P1', room_id: 'R1' },
    { section_id: 'AP1', slot_id: 'D1P2', room_id: 'R1' },
    { section_id: 'AP2', slot_id: 'D1P3', room_id: 'R1' },
  ] });
  assert.equal(result.ok, false);
  assert.equal(result.hard_violations.filter(item => item.rule_id === 'fixed-core').length, 1);
  assert.equal(result.soft_score, 14);
});

test('treats an administrative lock as a hard invariant', () => {
  const result = validateSchedule(problem(), {
    locks: [{ section_id: 'CORE', slot_id: 'D1P2' }],
    meetings: [
      { section_id: 'CORE', slot_id: 'D1P1', room_id: 'R1' },
      { section_id: 'AP1', slot_id: 'D1P2', room_id: 'R1' },
      { section_id: 'AP2', slot_id: 'D1P3', room_id: 'R1' },
    ],
  });
  assert.equal(result.ok, false);
  assert.ok(result.hard_violations.some(item => item.rule_id === 'kernel.lock_preserved'));
});

test('ignores room-derived section capacity during timetable validation', () => {
  const result = validateSchedule(problem(), {
    sections: [{ id: 'AP1', student_ids: ['S1', 'S2'], capacity: 1 }],
    meetings: [
      { section_id: 'CORE', slot_id: 'D1P1', room_id: 'R1' },
      { section_id: 'AP1', slot_id: 'D1P2', room_id: 'R1' },
      { section_id: 'AP2', slot_id: 'D1P3', room_id: 'R1' },
    ],
  });
  assert.equal(
    result.hard_violations.filter(item => item.rule_id === 'kernel.section_capacity').length,
    0,
  );
  assert.equal(result.hard_violations.some(item => item.rule_id.startsWith('kernel.room_')), false);
});

test('tracks selected-course membership across a malformed section with an empty eligible roster', () => {
  const result = validateSchedule(problem(), {
    sections: [
      { id: 'AP1', student_ids: ['S1'], eligible_student_ids: [] },
      { id: 'AP2', student_ids: ['S2'] },
    ],
    meetings: [
      { section_id: 'CORE', slot_id: 'D1P1', room_id: 'R1' },
      { section_id: 'AP1', slot_id: 'D1P2', room_id: 'R1' },
      { section_id: 'AP2', slot_id: 'D1P3', room_id: 'R1' },
    ],
  });
  assert.equal(result.ok, false);
  assert.ok(result.hard_violations.some(item =>
    item.rule_id === 'kernel.eligible_membership' && item.student_id === 'S1'));
  assert.ok(!result.hard_violations.some(item =>
    item.rule_id === 'kernel.selected_course_membership' && item.student_id === 'S1'));
});
