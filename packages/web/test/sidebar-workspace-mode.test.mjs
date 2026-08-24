import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const indexSource = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const appSource = await readFile(new URL('../app.js', import.meta.url), 'utf8');
const stylesSource = await readFile(new URL('../styles.css', import.meta.url), 'utf8');

test('the top-left brand switches between separate scheduling and exam sidebars', () => {
  assert.match(indexSource, /id="sidebar-mode-switch"[^>]*role="switch"[^>]*aria-checked="false"/);
  assert.match(indexSource, /id="schedule-sidebar-navigation"[^>]*data-workspace-navigation="schedule"/);
  assert.match(indexSource, /id="exam-sidebar-navigation"[^>]*data-workspace-navigation="exam"[^>]*hidden/);

  const scheduleNavigation = indexSource.match(/id="schedule-sidebar-navigation"[\s\S]*?<\/div>\s*<div id="exam-sidebar-navigation"/)?.[0] || '';
  assert.doesNotMatch(scheduleNavigation, /data-view="exam-scheduling"/);
  assert.match(indexSource, /data-view="exam-scheduling"/);
  assert.match(indexSource, /data-exam-target="exam-config-card"/);
  assert.match(indexSource, /data-exam-target="exam-subjects-card"/);
  assert.match(indexSource, /data-exam-target="exam-result-card"/);
});

test('the mobile sidebar has its own reachable close control', () => {
  assert.match(indexSource, /id="btn-sidebar-close"[^>]*aria-label="关闭侧栏"/);
  assert.match(appSource, /function setMobileSidebarOpen\([\s\S]*?sidebar-mobile-open/);
  assert.match(appSource, /sidebar\.inert\s*=\s*!resolvedOpen/);
  assert.match(appSource, /sidebarClose\?\.addEventListener\('click',[\s\S]*?setMobileSidebarOpen\(false\)/);
  assert.match(stylesSource, /\.sidebar-mobile-close\s*\{[\s\S]*?display:\s*none/);
  assert.match(stylesSource, /@media \(max-width:\s*980px\)[\s\S]*?\.sidebar-mobile-close\s*\{[\s\S]*?display:\s*inline-flex/);
});

test('the compact command-search button keeps an accessible name', () => {
  assert.match(indexSource, /id="btn-command-search"[^>]*aria-label="搜索页面与功能"/);
});
