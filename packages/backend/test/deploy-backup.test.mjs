import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import test from 'node:test';

test('daily production backup is private even when source permissions are too broad', t => {
  const directory = mkdtempSync(join(tmpdir(), 'timetable-deploy-backup-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const stateFile = join(directory, 'state.json');
  const backupDirectory = join(directory, 'backups');
  writeFileSync(stateFile, '{"meta":{"revision":1}}\n', { mode: 0o644 });
  chmodSync(stateFile, 0o644);

  execFileSync('sh', [resolve('../../deploy/timetable-backup.sh')], {
    env: { ...process.env, STATE_FILE: stateFile, BACKUP_DIR: backupDirectory },
  });

  assert.equal(statSync(backupDirectory).mode & 0o777, 0o700);
  const [backup] = readdirSync(backupDirectory);
  assert.equal(statSync(join(backupDirectory, backup)).mode & 0o777, 0o600);
});

test('production service accepts the office LAN address used by nginx', () => {
  const service = readFileSync(resolve('../../deploy/timetable.service'), 'utf8');
  assert.match(
    service,
    /^Environment=TIMETABLE_ALLOWED_HOSTS=.*(?:^|,)192\.168\.31\.7(?:,|$)/m,
  );
  assert.match(
    service,
    /^Environment=TIMETABLE_ALLOWED_HOSTS=.*(?:^|,)sdshiyanAP(?:,|$)/m,
  );
  assert.match(service, /^Environment=STATE_BACKUP_DIR=\/var\/backups\/timetable$/m);
  assert.match(service, /^ReadWritePaths=.*\/var\/backups\/timetable(?:\s|$)/m);
});
