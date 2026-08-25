import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const appSource = await readFile(new URL('../app.js', import.meta.url), 'utf8');
const indexSource = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const styleSource = await readFile(new URL('../styles.css', import.meta.url), 'utf8');

test('the manual timetable contains an independently saved classroom manager', () => {
  for (const id of [
    'manual-room-manager',
    'manual-room-list',
    'manual-room-add-form',
    'manual-room-new-id',
    'manual-room-new-name',
    'manual-room-add',
    'manual-room-save',
    'manual-room-save-status',
  ]) assert.match(indexSource, new RegExp(`id="${id}"`));
  const manualView = indexSource.indexOf('id="view-manual-timetable"');
  const manager = indexSource.indexOf('id="manual-room-manager"');
  const timetableGrid = indexSource.indexOf('id="manual-timetable-grid"');
  assert.ok(manualView < manager && manager < timetableGrid);
  assert.match(indexSource, /当前不参与教室冲突校验/);
  assert.match(indexSource, /没有教室也可以正常排课/);
  assert.match(indexSource, /门牌号 \/ 教室 ID/);
  assert.match(appSource, /changeSchedulingRooms/);
  assert.match(appSource, /newId:/);
  assert.match(appSource, /renames:/);
  assert.match(appSource, /api\('\/rooms',[\s\S]*?method: 'PUT'/);
  assert.match(styleSource, /\.manual-room-manager\s*\{/);
});
