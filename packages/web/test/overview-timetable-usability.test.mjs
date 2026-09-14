import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const appSource = await readFile(new URL('../app.js', import.meta.url), 'utf8');
const styles = await readFile(new URL('../styles.css', import.meta.url), 'utf8');

test('overview controls are labelled and support focus and compact-grid modes', () => {
  assert.match(html, /<label for="select-grade">选择年级<\/label>/);
  assert.match(html, /<label for="select-view-type">选择视图<\/label>/);
  assert.match(html, /id="overview-focus-mode"[^>]*aria-pressed="false"/);
  assert.match(html, /id="overview-layout-toggle"[^>]*aria-pressed="false">紧凑多列/);
  assert.match(appSource, /function setOverviewFocusMode/);
  assert.match(appSource, /function setOverviewCompactGrid/);
  assert.match(styles, /\.app\.overview-focus-mode\s*\{/);
  assert.match(styles, /\.app\.overview-focus-mode \.main\s*\{[^}]*grid-column:\s*2/);
  assert.match(styles, /#view-overview-timetable \.overview-grid\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\)/);
  assert.match(styles, /#view-overview-timetable\.overview-compact-grid \.overview-grid\s*\{[^}]*grid-template-columns:\s*repeat\(auto-fill, minmax\(300px, 1fr\)\)/);
  assert.match(styles, /@media \(max-width: 1100px\)[\s\S]*#view-overview-timetable \.overview-grid\s*\{[^}]*grid-template-columns:\s*1fr/);
});

test('overview cards show a human workload summary instead of a raw id badge', () => {
  const source = appSource.slice(
    appSource.indexOf('// 加载总课表概览'),
    appSource.indexOf('// 渲染迷你课表'),
  );
  assert.match(source, /overviewCardSummary/);
  assert.match(source, /overview-card-summary/);
  assert.doesNotMatch(source, /<span class="badge">\$\{escapeHtml\(id\)\}<\/span>/);
});
