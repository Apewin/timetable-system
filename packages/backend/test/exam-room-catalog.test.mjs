import assert from 'node:assert/strict';
import test from 'node:test';
import {
  examPlanUsingRoomCatalog,
  examRoomCatalogForState,
  normalizeExamRoomCatalog,
  stateWithExamRoomCatalog,
} from '../src/exam-room-catalog.mjs';

test('reads the room catalog from a legacy exam plan without needing a migration step first', () => {
  assert.deepEqual(examRoomCatalogForState({
    exam_plan: {
      config: {
        room_capacity: 36,
        rooms: [{ id: 'LEGACY_HALL', name: '旧报告厅', capacity: 36 }],
      },
      exams: [],
    },
  }), [{ id: 'LEGACY_HALL', name: '旧报告厅', capacity: 36 }]);
});

test('saving an independent room catalog synchronizes an existing plan and invalidates its result', () => {
  const next = stateWithExamRoomCatalog({
    exam_plan: { config: { rooms: [{ id: 'OLD', name: '旧考场', capacity: 30 }] }, exams: [] },
    exam_schedule: { ok: true },
    exam_solve_status: 'valid',
  }, [{ id: 'NEW', name: '新考场', capacity: 40 }]);
  assert.deepEqual(next.exam_rooms, [{ id: 'NEW', name: '新考场', capacity: 40 }]);
  assert.deepEqual(next.exam_plan.config.rooms, next.exam_rooms);
  assert.equal(next.exam_schedule, null);
  assert.equal(next.exam_solve_status, 'not_run');
});

test('the catalog rejects duplicate display names after Unicode normalization', () => {
  assert.throws(() => normalizeExamRoomCatalog([
    { id: 'A', name: 'ROOM A', capacity: 30 },
    { id: 'B', name: 'ＲＯＯＭ　Ａ', capacity: 30 },
  ]), /考场名称不能重复/);
});

test('an independent catalog overrides stale rooms embedded in a plan', () => {
  const catalog = [{ id: 'HALL', name: '报告厅', capacity: 60 }];
  const plan = examPlanUsingRoomCatalog({
    config: { rooms: [{ id: 'OLD', name: '旧考场', capacity: 30 }] },
    exams: [],
  }, catalog);
  assert.deepEqual(plan.config.rooms, catalog);
  assert.equal(plan.config.room_count, 1);
});
