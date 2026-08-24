import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const indexSource = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const appSource = await readFile(new URL('../app.js', import.meta.url), 'utf8');
const stylesSource = await readFile(new URL('../styles.css', import.meta.url), 'utf8');

test('the scheduling workspace can reveal more room for the timetable', () => {
  assert.match(indexSource, /id="manual-course-panel-toggle"[^>]*aria-expanded="true"/);
  assert.match(indexSource, /id="manual-focus-mode"[^>]*aria-pressed="false"/);
  assert.match(appSource, /function setManualCoursePanelExpanded\(/);
  assert.match(appSource, /function setManualFocusMode\(/);
  assert.match(stylesSource, /#view-manual-timetable\.course-panel-collapsed \.manual-course-panel\s*\{\s*display:\s*none/);
  assert.match(stylesSource, /\.app\.manual-focus-mode\s*\{\s*grid-template-columns:\s*0 minmax\(0, 1fr\) 0/);
});

test('the course pool supports human-readable search and filters', () => {
  assert.match(indexSource, /id="manual-course-search"[^>]*placeholder="搜索课程名称"/);
  assert.match(indexSource, /id="manual-course-category-filter"/);
  assert.match(indexSource, /id="manual-course-status-filter"/);
  assert.match(indexSource, /<details class="manual-course-help">/);
  assert.match(appSource, /categoryFilter === 'all' \|\| item\.category === categoryFilter/);
  assert.match(appSource, /statusFilter === 'unassigned' && item\.teacher_unassigned/);
  assert.match(appSource, /manual-course-progress-track/);
});

test('manual drag and drop actions expose feedback and undo', () => {
  assert.match(indexSource, /id="manual-action-feedback"[^>]*role="status"[^>]*aria-live="polite"/);
  assert.match(indexSource, /id="manual-undo-action"/);
  assert.match(appSource, /function commitManualDraftChange\(/);
  assert.match(appSource, /function undoManualDraftChange\(/);
  assert.match(appSource, /MANUAL_DRAFT_UNDO_LIMIT = 20/);
  assert.match(appSource, /classList\.add\('manual-drag-active'\)/);
});

test('the workspace switch names both scheduling modes', () => {
  assert.match(indexSource, /sidebar-mode-option-schedule">排课</);
  assert.match(indexSource, /sidebar-mode-option-exam">排考试</);
});
