import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const appSource = await readFile(new URL('../app.js', import.meta.url), 'utf8');
const styles = await readFile(new URL('../styles.css', import.meta.url), 'utf8');

test('first paint uses skeleton values and keeps the assistant from flashing open', () => {
  assert.match(html, /<div class="container ai-assistant-collapsed">/);
  for (const id of ['dashboard-students', 'dashboard-teachers', 'dashboard-courses', 'dashboard-constraints']) {
    assert.match(html, new RegExp(`id="${id}" class="skeleton-value"`));
  }
  assert.match(appSource, /setAiAssistantCollapsed\(shouldAutoCollapseAiAssistant\(window\.innerWidth\)\)/);
  assert.match(styles, /\.skeleton-value::after/);
});

test('status page translates system keys and stages for ordinary users', () => {
  assert.match(appSource, /const statusCountLabels =/);
  assert.match(appSource, /teachers: '教师'/);
  assert.match(appSource, /needs_resolve: '数据已变更，需重新排课'/);
  assert.match(appSource, /trusted-lan.*可信内网/);
  assert.match(appSource, /qualityAffectedStudents\(validation, students\)/);
  assert.match(appSource, /id="quality-affected-students"/);
  assert.match(appSource, /不能按普通结果发布/);
  assert.match(appSource, /保存为过往课表.*质量例外/);
  assert.match(html, /id="dashboard-release-details"/);
});
