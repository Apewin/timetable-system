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
  assert.match(appSource, /prompt\('请输入“恢复此版本”/);
  assert.match(appSource, /confirmation: '恢复此版本'/);
  assert.match(appSource, /expected_revision: revision/);
});
