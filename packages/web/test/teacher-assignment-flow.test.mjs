import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const appSource = await readFile(new URL('../app.js', import.meta.url), 'utf8');
const indexSource = await readFile(new URL('../index.html', import.meta.url), 'utf8');

test('teacher assignments expose persistent action feedback and generated-task results', () => {
  assert.match(indexSource, /id="assignment-action-feedback"/);
  assert.match(indexSource, /id="teaching-task-results"/);
  assert.match(indexSource, /教学任务生成结果/);
});

test('the add-assignment button opens and submits an actual assignment form', () => {
  assert.match(appSource, /getElementById\('btn-add-assignment'\)\.addEventListener\('click'/);
  assert.match(appSource, /id="form-add-assignment"/);
  assert.match(appSource, /api\('\/teaching_assignments', \{ method: 'POST'/);
});

test('generated tasks are rendered as records and weekly periods instead of only a toast', () => {
  assert.match(appSource, /function renderTeachingTaskResults/);
  assert.match(appSource, /个课程\/班级任务/);
  assert.match(appSource, /节\/周/);
  assert.match(appSource, /await loadAssignments\(\{ focusTaskResults: true \}\)/);
});
