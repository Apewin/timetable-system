import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applyClassTimetableAdjustment,
  applyTeacherTimetableAdjustment,
  evaluateClassTimetableAdjustments,
  evaluateTeacherTimetableAdjustments,
} from '../src/teacher-timetable-adjustment.mjs';

const slots = Array.from({ length: 4 }, (_, index) => ({
  id: `D1P${index + 1}`,
  day: 1,
  period: index + 1,
}));

function assignment(section, studentId, slotId) {
  return {
    task_id: `${section.id}:${studentId}:${slotId}`,
    section_id: section.id,
    student_id: studentId,
    slot_id: slotId,
    teacher_id: section.teacher_id,
    course_id: section.course_id,
    class_id: section.class_id,
    class_type: section.class_type,
  };
}

function fixture({ locks = [], overlays = [], synchronized = false } = {}) {
  const sections = [
    { id: 'A', course_id: 'A', teacher_id: 'T1', class_id: 'TC1', class_type: 'teaching', weekly_hours: 1, student_ids: ['S1'], eligible_student_ids: [] },
    { id: 'B', course_id: 'B', teacher_id: 'T1', class_id: 'TC2', class_type: 'teaching', weekly_hours: 1, student_ids: ['S2'], eligible_student_ids: [] },
    { id: 'C', course_id: 'C', teacher_id: 'T2', class_id: 'TC1', class_type: 'teaching', weekly_hours: 1, student_ids: ['S1'], eligible_student_ids: [] },
  ];
  if (synchronized) sections.push({
    id: 'A_LINK', course_id: 'A_LINK', teacher_id: 'T3', class_id: 'TC3', class_type: 'ap',
    weekly_hours: 1, student_ids: ['S3'], eligible_student_ids: [],
  });
  const meetings = [
    { section_id: 'A', slot_id: 'D1P1' },
    { section_id: 'B', slot_id: 'D1P2' },
    { section_id: 'C', slot_id: 'D1P3' },
    ...(synchronized ? [{ section_id: 'A_LINK', slot_id: 'D1P1' }] : []),
  ];
  const assignments = meetings.flatMap(meeting => {
    const section = sections.find(item => item.id === meeting.section_id);
    return section.student_ids.map(studentId => assignment(section, studentId, meeting.slot_id));
  });
  const state = {
    solve_status: 'valid',
    students: [
      { id: 'S1', teaching_class_id: 'TC1' },
      { id: 'S2', teaching_class_id: 'TC2' },
      { id: 'S3', teaching_class_id: 'TC3' },
    ],
    teaching_classes: [{ id: 'TC1' }, { id: 'TC2' }, { id: 'TC3' }],
    schedule: { sections, meetings, assignments, locks, overlays },
  };
  const rules = synchronized ? [{
    id: 'sync-a', type: 'synchronized_slots', hard: true, scope: 'section',
    target_ids: ['A', 'A_LINK'], section_target_ids: ['A', 'A_LINK'], params: {},
  }] : [];
  return { state, problem: { slots, sections, rooms: [], rules } };
}

test('marks a conflict-free empty slot as move and a safe occupied slot as swap', () => {
  const { state, problem } = fixture();
  const result = evaluateTeacherTimetableAdjustments(state, problem, {
    teacher_id: 'T1', task_id: 'A:S1:D1P1', from_slot: 'D1P1',
  });
  const candidates = new Map(result.public_candidates.map(item => [item.slot_id, item.action]));

  assert.equal(candidates.get('D1P2'), 'swap');
  assert.equal(candidates.get('D1P4'), 'move');
  assert.equal(candidates.has('D1P3'), false, 'S1 already has section C in period 3');
});

test('a drop is re-evaluated and committed atomically as a swap', () => {
  const { state, problem } = fixture();
  const result = applyTeacherTimetableAdjustment(state, problem, {
    teacher_id: 'T1', task_id: 'A:S1:D1P1', from_slot: 'D1P1', to_slot: 'D1P2', action: 'swap',
  });

  assert.equal(result.action, 'swap');
  assert.ok(result.schedule.meetings.some(item => item.section_id === 'A' && item.slot_id === 'D1P2'));
  assert.ok(result.schedule.meetings.some(item => item.section_id === 'B' && item.slot_id === 'D1P1'));
  assert.equal(result.schedule.validation.ok, true);
});

test('self-study is replaceable, while a special event and a lock are not', () => {
  const selfStudy = { id: 'SELF', class_id: 'TC1', kind: 'self_study', slot_ids: ['D1P4'] };
  const selfStudyFixture = fixture({ overlays: [selfStudy] });
  const moved = applyTeacherTimetableAdjustment(selfStudyFixture.state, selfStudyFixture.problem, {
    teacher_id: 'T1', task_id: 'A:S1:D1P1', from_slot: 'D1P1', to_slot: 'D1P4', action: 'move',
  });
  assert.equal(moved.displaced_self_study_count, 1);
  assert.deepEqual(moved.schedule.overlays, []);

  const eventFixture = fixture({ overlays: [{ ...selfStudy, id: 'EVENT', kind: 'special_event' }] });
  const eventCandidates = evaluateTeacherTimetableAdjustments(eventFixture.state, eventFixture.problem, {
    teacher_id: 'T1', task_id: 'A:S1:D1P1', from_slot: 'D1P1',
  }).public_candidates;
  assert.equal(eventCandidates.some(item => item.slot_id === 'D1P4'), false);

  const lockFixture = fixture({ locks: [{ section_id: 'B', slot_id: 'D1P2' }] });
  const lockCandidates = evaluateTeacherTimetableAdjustments(lockFixture.state, lockFixture.problem, {
    teacher_id: 'T1', task_id: 'A:S1:D1P1', from_slot: 'D1P1',
  }).public_candidates;
  assert.equal(lockCandidates.some(item => item.slot_id === 'D1P2'), false);
});

test('moves every section in a synchronized AP Block as one bundle', () => {
  const { state, problem } = fixture({ synchronized: true });
  const evaluated = evaluateTeacherTimetableAdjustments(state, problem, {
    teacher_id: 'T1', task_id: 'A:S1:D1P1', from_slot: 'D1P1',
  });
  const move = evaluated.public_candidates.find(item => item.slot_id === 'D1P4');
  assert.equal(move?.action, 'move');
  assert.equal(move?.linked_section_count, 2);

  const applied = applyTeacherTimetableAdjustment(state, problem, {
    teacher_id: 'T1', task_id: 'A:S1:D1P1', from_slot: 'D1P1', to_slot: 'D1P4', action: 'move',
  });
  assert.ok(applied.schedule.meetings.some(item => item.section_id === 'A_LINK' && item.slot_id === 'D1P4'));
  assert.equal(applied.schedule.validation.ok, true);
});

test('class grid swaps two whole-class courses instead of colliding a one-way move', () => {
  const { state, problem } = fixture();
  const result = evaluateClassTimetableAdjustments(state, problem, {
    class_id: 'TC1', task_id: 'A:S1:D1P1', from_slot: 'D1P1',
  });
  const candidates = new Map(result.public_candidates.map(item => [item.slot_id, item.action]));

  assert.equal(candidates.get('D1P3'), 'swap');
  assert.equal(candidates.get('D1P4'), 'move');
  assert.equal(candidates.has('D1P2'), false, 'S2 already occupies T1 in period 2, so A cannot move there');

  const swapped = applyClassTimetableAdjustment(state, problem, {
    class_id: 'TC1', task_id: 'A:S1:D1P1', from_slot: 'D1P1', to_slot: 'D1P3', action: 'swap',
  });
  assert.equal(swapped.action, 'swap');
  assert.ok(swapped.schedule.meetings.some(item => item.section_id === 'A' && item.slot_id === 'D1P3'));
  assert.ok(swapped.schedule.meetings.some(item => item.section_id === 'C' && item.slot_id === 'D1P1'));
  assert.equal(swapped.schedule.validation.ok, true);
});

test('parking a course frees its slot so another course can rotate through it', () => {
  const { state, problem } = fixture();
  const evaluated = evaluateClassTimetableAdjustments(state, problem, {
    class_id: 'TC1', task_id: 'A:S1:D1P1', from_slot: 'D1P1',
  });
  assert.equal(evaluated.public_candidates.find(item => item.slot_id === '__buffer__')?.action, 'park');

  const parked = applyClassTimetableAdjustment(state, problem, {
    class_id: 'TC1', task_id: 'A:S1:D1P1', from_slot: 'D1P1', to_slot: '__buffer__', action: 'park',
  });
  assert.equal(parked.action, 'park');
  assert.equal(parked.schedule.adjustment_buffer.length, 1);
  assert.equal(parked.schedule.meetings.some(item => item.section_id === 'A' && item.slot_id === 'D1P1'), false);
  assert.equal(parked.schedule.validation.ok, false);

  const editing = { ...state, solve_status: 'editing', schedule: parked.schedule };
  const moved = applyClassTimetableAdjustment(editing, problem, {
    class_id: 'TC1', task_id: 'C:S1:D1P3', from_slot: 'D1P3', to_slot: 'D1P1', action: 'move',
  });
  assert.ok(moved.schedule.meetings.some(item => item.section_id === 'C' && item.slot_id === 'D1P1'));

  const restored = applyClassTimetableAdjustment({ ...state, solve_status: 'editing', schedule: moved.schedule }, problem, {
    class_id: 'TC1',
    section_id: 'A',
    from_slot: '__buffer__',
    to_slot: 'D1P3',
    action: 'move',
    buffer_id: moved.schedule.adjustment_buffer[0].id,
  });
  assert.equal((restored.schedule.adjustment_buffer || []).length, 0);
  assert.equal(restored.schedule.validation.ok, true);
  assert.ok(restored.schedule.meetings.some(item => item.section_id === 'A' && item.slot_id === 'D1P3'));
});

test('a locked course cannot be parked in the adjustment buffer', () => {
  const { state, problem } = fixture({ locks: [{ section_id: 'A', slot_id: 'D1P1' }] });
  assert.throws(
    () => applyClassTimetableAdjustment(state, problem, {
      class_id: 'TC1', task_id: 'A:S1:D1P1', from_slot: 'D1P1', to_slot: '__buffer__', action: 'park',
    }),
    /锁定/,
  );
});

test('class grid explains why a conflicting drop is rejected', () => {
  const { state, problem } = fixture();
  const result = evaluateClassTimetableAdjustments(state, problem, {
    class_id: 'TC1', task_id: 'A:S1:D1P1', from_slot: 'D1P1',
  });
  const busy = result.unavailable.find(item => item.slot_id === 'D1P2');
  assert.ok(busy?.reason);

  assert.throws(
    () => applyClassTimetableAdjustment(state, problem, {
      class_id: 'TC1', task_id: 'A:S1:D1P1', from_slot: 'D1P1', to_slot: 'D1P2',
    }),
    /教师 T1 在 D1P2 已有其他课程/,
  );
});
