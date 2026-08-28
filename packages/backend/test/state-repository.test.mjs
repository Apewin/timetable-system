import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
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

test('migrates a legacy state in memory and writes the current schema version', t => {
  const directory = mkdtempSync(join(tmpdir(), 'timetable-state-schema-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const file = join(directory, 'state.json');
  writeFileSync(file, `${JSON.stringify({ meta: { revision: 2 }, courses: [] })}\n`);
  const repository = new StateRepository(file);

  assert.equal(repository.read().schema_version, 1);
  assert.equal(JSON.parse(readFileSync(file, 'utf8')).schema_version, undefined);
  repository.write(repository.read());
  assert.equal(JSON.parse(readFileSync(file, 'utf8')).schema_version, 1);
});

test('creates a private write-before-change backup and enforces retention', t => {
  const directory = mkdtempSync(join(tmpdir(), 'timetable-state-backup-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const file = join(directory, 'state.json');
  const backups = join(directory, 'state-backups');
  writeFileSync(file, `${JSON.stringify({ meta: { revision: 0 }, value: 'original' })}\n`);
  let timestamp = Date.UTC(2026, 7, 25, 8, 0, 0);
  const repository = new StateRepository(file, {
    backupDirectory: backups,
    maxBackups: 2,
    now: () => timestamp++,
  });

  repository.write({ ...repository.read(), value: 'first' });
  repository.write({ ...repository.read(), value: 'second' });
  repository.write({ ...repository.read(), value: 'third' });

  const backupFiles = readdirSync(backups);
  assert.equal(backupFiles.length, 2);
  const values = backupFiles.map(name => JSON.parse(readFileSync(join(backups, name), 'utf8')).value);
  assert.deepEqual(values.sort(), ['first', 'second']);
  assert.equal(JSON.parse(readFileSync(file, 'utf8')).value, 'third');
});

test('backup retention keeps the newest states across double-digit revisions', t => {
  const directory = mkdtempSync(join(tmpdir(), 'timetable-state-backup-revision-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const file = join(directory, 'state.json');
  const backups = join(directory, 'state-backups');
  writeFileSync(file, `${JSON.stringify({ meta: { revision: 8 }, value: 'original' })}\n`);
  const repository = new StateRepository(file, {
    backupDirectory: backups,
    maxBackups: 2,
  });

  for (const value of ['first', 'second', 'third', 'fourth']) {
    repository.write({ ...repository.read(), value });
  }

  const values = readdirSync(backups)
    .map(name => JSON.parse(readFileSync(join(backups, name), 'utf8')).value)
    .sort();
  assert.deepEqual(values, ['second', 'third']);
});

test('lists private backups as safe metadata and restores one as a new revision', t => {
  const directory = mkdtempSync(join(tmpdir(), 'timetable-state-restore-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const file = join(directory, 'state.json');
  const backups = join(directory, 'state-backups');
  writeFileSync(file, `${JSON.stringify({
    meta: { revision: 2, updated_at: '2026-08-25T08:00:00.000Z' },
    students: [{ id: 'S1' }],
    teachers: [],
    solve_status: 'not_run',
  })}\n`);
  const repository = new StateRepository(file, { backupDirectory: backups, maxBackups: 5 });

  repository.write({ ...repository.read(), students: [{ id: 'S1' }, { id: 'S2' }] });
  repository.write({ ...repository.read(), teachers: [{ id: 'T1' }] });
  const listed = repository.listBackups();

  assert.equal(listed.length, 2);
  assert.equal(listed[0].revision, 3);
  assert.deepEqual(listed[0].counts, { students: 2, teachers: 0, courses: 0, rooms: 0 });
  assert.equal(typeof listed[0].size_bytes, 'number');
  assert.equal(Object.hasOwn(listed[0], 'path'), false);

  const restored = repository.restoreBackup(listed[1].id, { expectedRevision: 4 });
  assert.equal(restored.meta.revision, 5);
  assert.deepEqual(restored.students, [{ id: 'S1' }]);
  assert.deepEqual(restored.teachers, []);
  assert.equal(repository.listBackups().some(item => item.revision === 4), true);
});

test('lists and restores a daily production backup from the shared backup directory', t => {
  const directory = mkdtempSync(join(tmpdir(), 'timetable-state-daily-restore-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const file = join(directory, 'timetable.json');
  const backups = join(directory, 'backups');
  mkdirSync(backups, { mode: 0o700 });
  writeFileSync(file, '{"meta":{"revision":8},"value":"current"}\n');
  writeFileSync(
    join(backups, 'timetable-20260829T032000Z.json'),
    '{"meta":{"revision":6,"updated_at":"2026-08-29T03:20:00.000Z"},"value":"daily"}\n',
    { mode: 0o600 },
  );
  const repository = new StateRepository(file, { backupDirectory: backups, maxBackups: 5 });

  const [daily] = repository.listBackups();
  assert.equal(daily.id, 'timetable-20260829T032000Z.json');
  assert.equal(daily.kind, 'daily');
  assert.equal(daily.revision, 6);

  const restored = repository.restoreBackup(daily.id, { expectedRevision: 8 });
  assert.equal(restored.meta.revision, 9);
  assert.equal(restored.value, 'daily');
});

test('backup restore rejects unknown or path-like ids without changing state', t => {
  const directory = mkdtempSync(join(tmpdir(), 'timetable-state-restore-safe-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const file = join(directory, 'state.json');
  writeFileSync(file, '{"meta":{"revision":1},"value":"safe"}\n');
  const repository = new StateRepository(file);

  assert.throws(
    () => repository.restoreBackup('../state.json', { expectedRevision: 1 }),
    error => error.code === 'BACKUP_NOT_FOUND',
  );
  assert.equal(repository.read().value, 'safe');
  assert.equal(repository.revision(repository.read()), 1);
});

test('refuses a state created by a newer unsupported schema', t => {
  const directory = mkdtempSync(join(tmpdir(), 'timetable-state-newer-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const file = join(directory, 'state.json');
  writeFileSync(file, '{"schema_version":999,"meta":{"revision":1}}\n');
  const repository = new StateRepository(file);
  assert.throws(() => repository.read(), /高于当前程序支持/);
});

test('repairs state and backup permissions before exposing school data', t => {
  const directory = mkdtempSync(join(tmpdir(), 'timetable-state-permissions-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const file = join(directory, 'state.json');
  const backups = join(directory, 'backups');
  const backup = join(backups, 'state.json.r1.2026-08-29.json');
  writeFileSync(file, '{"meta":{"revision":1}}\n', { mode: 0o644 });
  mkdirSync(backups, { mode: 0o755 });
  writeFileSync(backup, '{"meta":{"revision":1}}\n', { mode: 0o644 });
  chmodSync(file, 0o644);
  chmodSync(backups, 0o755);
  chmodSync(backup, 0o644);

  const repository = new StateRepository(file, { backupDirectory: backups });
  repository.read();
  repository.listBackups();

  assert.equal(statSync(file).mode & 0o777, 0o600);
  assert.equal(statSync(backups).mode & 0o777, 0o700);
  assert.equal(statSync(backup).mode & 0o777, 0o600);
});
