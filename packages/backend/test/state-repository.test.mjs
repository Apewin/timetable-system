import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { StateRepository } from '../src/state-repository.mjs';

test('rejects a stale solve write without overwriting edits made during the solve', t => {
  const directory = mkdtempSync(join(tmpdir(), 'timetable-state-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const file = join(directory, 'state.json');
  writeFileSync(file, `${JSON.stringify({
    meta: { revision: 4 },
    courses: [{ id: 'OLD' }],
    students: [{ id: 'S1' }],
  })}\n`);
  const repository = new StateRepository(file);
  const solveSnapshot = repository.read();

  repository.write({ ...solveSnapshot, courses: [{ id: 'EDITED_DURING_SOLVE' }] });

  assert.throws(
    () => repository.write(
      { ...solveSnapshot, schedule: { version: 1 } },
      { expectedRevision: repository.revision(solveSnapshot) },
    ),
    error => error.code === 'STATE_VERSION_CONFLICT',
  );
  const saved = JSON.parse(readFileSync(file, 'utf8'));
  assert.deepEqual(saved.courses, [{ id: 'EDITED_DURING_SOLVE' }]);
  assert.equal(saved.schedule, undefined);
  assert.equal(saved.meta.revision, 5);
});

test('stores one compact schedule source and derives student assignments on read', t => {
  const directory = mkdtempSync(join(tmpdir(), 'timetable-state-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const file = join(directory, 'state.json');
  const duplicated = [{ task_id: 'OLD_DUPLICATE' }];
  writeFileSync(file, `${JSON.stringify({
    meta: { revision: 1 },
    assignments: duplicated,
    schedule: {
      sections: [{
        id: 'A', course_id: 'C', teacher_id: 'T', class_id: 'TC',
        class_type: 'teaching', student_ids: ['S1'],
      }],
      meetings: [{ section_id: 'A', slot_id: 'D1P1', room_id: null }],
      assignments: duplicated,
    },
  })}\n`);
  const repository = new StateRepository(file);

  const state = repository.read();
  assert.equal(state.schedule.assignments[0].task_id, 'A:S1:D1P1');
  assert.equal(state.assignments, state.schedule.assignments);
  assert.equal(Object.isFrozen(state), true);

  repository.write({ ...state, solve_status: 'valid' });
  const stored = JSON.parse(readFileSync(file, 'utf8'));
  assert.equal(stored.assignments, undefined);
  assert.equal(stored.schedule.assignments, undefined);
  assert.equal(repository.read().schedule.assignments[0].student_id, 'S1');
});
