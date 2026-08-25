import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const appSource = await readFile(new URL('../app.js', import.meta.url), 'utf8');

test('import page exposes readiness, templates, and field mapping before upload', () => {
  for (const id of ['import-readiness-summary', 'import-readiness-grid', 'import-template-students', 'import-template-teachers', 'import-template-courses']) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  assert.match(html, /<details class="import-field-mapping">/);
  assert.match(appSource, /importReadinessModel/);
  assert.match(appSource, /downloadImportTemplate/);
  assert.match(appSource, /await initImportPage\(\)/);
  assert.match(appSource, /Promise\.allSettled/);
  assert.match(appSource, /api\('\/students'\)/);
  assert.doesNotMatch(appSource, /api\('\/elective_selections'\)/);
});
