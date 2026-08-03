import assert from 'node:assert/strict';
import test from 'node:test';
import { archiveSummary, createScheduleArchive, stateForScheduleArchive } from '../src/schedule-archive.mjs';

const state = {
  meta: { school: '测试学校' },
  courses: [{ id: 'MATH', name: '数学' }],
  teachers: [{ id: 'T1', name: '王老师' }],
  rooms: [{ id: 'R1', name: '101' }],
  students: [{ id: 'S1', name: '学生甲', admin_class_id: 'AC1' }],
  admin_classes: [{ id: 'AC1', name: '行政一班' }],
  teaching_classes: [{ id: 'TC1', name: '教学一班' }],
  constraints: [{ id: 'R1', hard: true }],
  schedule: {
    version: 4,
    solver_status: 'OPTIMAL',
    solve_duration_ms: 321,
    sections: [{
      id: 'SEC1', course_id: 'MATH', teacher_id: 'T1', room_id: 'R1',
      class_id: 'TC1', class_type: 'teaching', student_ids: ['S1'],
    }],
    assignments: [{
      task_id: 'SEC1:S1:D1P1', section_id: 'SEC1', student_id: 'S1',
      slot_id: 'D1P1', room_id: 'R1', teacher_id: 'T1', course_id: 'MATH',
      class_id: 'TC1', class_type: 'teaching',
    }],
    meetings: [{ section_id: 'SEC1', slot_id: 'D1P1', room_id: 'R1' }],
    locks: [{ section_id: 'SEC1', slot_id: 'D1P1', origin: 'manual' }],
    validation: { ok: true, hard_violations: [] },
  },
};

test('creates an immutable schedule snapshot with the display context', () => {
  const archive = createScheduleArchive(state, {
    id: 'ARCHIVE_20260731T080000000Z',
    savedAt: '2026-07-31T08:00:00.000Z',
  });
  state.courses[0].name = '已修改课程';
  state.schedule.assignments[0].slot_id = 'D2P2';

  assert.equal(archive.schedule.assignments, undefined);
  assert.equal(archive.assignments_count, 1);
  assert.equal(archive.context.courses[0].name, '数学');
  assert.deepEqual(archiveSummary(archive), {
    id: 'ARCHIVE_20260731T080000000Z',
    name: '课表存档 · 2026-07-31T08:00:00.000Z',
    saved_at: '2026-07-31T08:00:00.000Z',
    schedule_version: 4,
    solver_status: 'OPTIMAL',
    solve_duration_ms: 321,
    assignments_count: 1,
    meetings_count: 1,
    manual_lock_count: 1,
    validation: { ok: true, hard_violations: [] },
  });
  state.courses[0].name = '数学';
  state.schedule.assignments[0].slot_id = 'D1P1';
});

test('builds an archived state that remains viewable after current data changes', () => {
  const archive = createScheduleArchive(state, {
    id: 'ARCHIVE_2', savedAt: '2026-07-31T08:00:00.000Z',
  });
  const archivedState = stateForScheduleArchive(archive);
  assert.equal(archivedState.solve_status, 'valid');
  assert.equal(archivedState.students[0].id, 'S1');
  assert.equal(archivedState.schedule.version, 4);
  assert.deepEqual(archivedState.schedule.assignments, state.schedule.assignments);
  assert.deepEqual(archivedState.assignments, state.schedule.assignments);
});
