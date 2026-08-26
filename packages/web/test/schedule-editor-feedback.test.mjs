import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const appSource = await readFile(new URL('../app.js', import.meta.url), 'utf8');
const styles = await readFile(new URL('../styles.css', import.meta.url), 'utf8');

test('schedule editor supports click and keyboard placement alongside drag and drop', () => {
  assert.match(html, /先点击卡片再点击目标空格/);
  assert.match(html, /role="button" tabindex="0" aria-pressed="false" draggable="true" data-schedule-template="self_study"/);
  assert.match(appSource, /async function handleScheduleEditorClick/);
  assert.match(appSource, /请先选择一门课程、自习或特殊事件，再点击目标空格/);
  assert.match(appSource, /await moveScheduleEditorCourse/);
  assert.match(appSource, /event\.key !== 'Enter' && event\.key !== ' '/);
  assert.match(styles, /\.schedule-editor-tool\.is-click-selected/);
});

test('schedule editor click moves still use the validated swap API', () => {
  const start = appSource.indexOf('async function moveScheduleEditorCourse');
  const end = appSource.indexOf('\nasync function handleScheduleEditorClick', start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  const source = appSource.slice(start, end);

  assert.match(source, /api\('\/swap'/);
  assert.match(source, /from_slot: fromSlot/);
  assert.match(source, /to_slot: toSlot/);
  assert.match(source, /await refreshCurrentTimetable\(\)/);
});
