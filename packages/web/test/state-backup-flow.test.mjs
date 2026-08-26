import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const appSource = await readFile(new URL('../app.js', import.meta.url), 'utf8');

test('settings exposes automatic state versions with comparison and safe restore', () => {
  for (const id of ['settings-backup-status', 'settings-backup-list']) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  assert.match(html, /自动备份与版本恢复/);
  assert.match(appSource, /api\('\/state-backups'/);
  assert.match(appSource, /function renderStateBackups/);
  assert.match(appSource, /与当前相比/);
  assert.match(appSource, /id="form-restore-state-backup"/);
  assert.match(appSource, /确认词尚未匹配，系统不会执行恢复/);
  assert.match(appSource, /正在创建当前版本备份并恢复所选数据/);
  assert.doesNotMatch(appSource, /prompt\(/);
  assert.match(appSource, /confirmation: '恢复此版本'/);
  assert.match(appSource, /expected_revision: revision/);
});
