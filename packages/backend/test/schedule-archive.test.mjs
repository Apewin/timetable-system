import assert from 'node:assert/strict';
import test from 'node:test';
import {
  archiveSummary,
  createScheduleArchive,
  restoreStateFromScheduleArchive,
  stateForScheduleArchive,
} from '../src/schedule-archive.mjs';

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
    name: '未命名课表',
    notes: '',
    saved_at: '2026-07-31T08:00:00.000Z',
    schedule_version: 4,
    solver_status: 'OPTIMAL',
    solve_duration_ms: 321,
    assignments_count: 1,
    meetings_count: 1,
    manual_lock_count: 1,
    publication_status: null,
    quality_exception_approval: null,
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

test('keeps a quality-exception approval visible in the archive audit summary', () => {
  const approvedState = structuredClone(state);
  approvedState.schedule.publication_status = 'ready_with_quality_exception';
  approvedState.schedule.quality_exception_approval = {
    approved_at: '2026-08-12T10:00:00.000Z',
    approved_by: '教务管理员',
    reason: '本学期采用当前结构下的最优课表。',
  };
  const archive = createScheduleArchive(approvedState, {
    id: 'ARCHIVE_APPROVED', savedAt: '2026-08-12T10:00:00.000Z',
  });

  const summary = archiveSummary(archive);
  assert.equal(summary.publication_status, 'ready_with_quality_exception');
  assert.equal(summary.quality_exception_approval.approved_by, '教务管理员');
});

test('keeps a staff-facing archive name and note without exposing a raw ISO timestamp as the title', () => {
  const archive = createScheduleArchive(state, {
    id: 'ARCHIVE_NAMED',
    savedAt: '2026-08-25T08:30:00.000Z',
    name: '2026–2027 学年秋季正式课表',
    notes: '教务处核对完成，8 月 31 日起执行。',
  });

  assert.equal(archive.name, '2026–2027 学年秋季正式课表');
  assert.equal(archive.notes, '教务处核对完成，8 月 31 日起执行。');
  assert.equal(archiveSummary(archive).notes, '教务处核对完成，8 月 31 日起执行。');

  const unnamed = createScheduleArchive(state, {
    id: 'ARCHIVE_UNNAMED',
    savedAt: '2026-08-25T08:30:00.000Z',
  });
  assert.equal(unnamed.name, '未命名课表');
});

test('restores an archived timetable context while retaining history and clearing incompatible drafts', () => {
  const archivedState = structuredClone(state);
  archivedState.courses[0].name = '归档数学';
  const target = createScheduleArchive(archivedState, {
    id: 'ARCHIVE_TARGET',
    name: '目标版本',
  });
  const current = structuredClone(state);
  current.courses[0].name = '当前数学';
  current.manual_plan = { status: 'draft', locks: [{ section_id: 'OTHER' }] };
  current.schedule_archives = [target];
  current.exam_plan = { version: 1, exams: [{ id: 'EXAM_1' }] };
  const safety = createScheduleArchive(current, {
    id: 'ARCHIVE_SAFETY',
    name: '恢复前自动备份',
  });

  const restored = restoreStateFromScheduleArchive(current, target, { safetyArchive: safety });

  assert.equal(restored.courses[0].name, '归档数学');
  assert.equal(restored.solve_status, 'valid');
  assert.equal(restored.schedule.version, 4);
  assert.equal(restored.manual_plan, null);
  assert.deepEqual(restored.schedule_archives.map(archive => archive.id), [
    'ARCHIVE_SAFETY',
    'ARCHIVE_TARGET',
  ]);
  assert.deepEqual(restored.exam_plan, current.exam_plan);
});
