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
