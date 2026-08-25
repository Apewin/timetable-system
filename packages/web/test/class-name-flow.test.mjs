import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const appSource = await readFile(new URL('../app.js', import.meta.url), 'utf8');

test('class management exposes a dedicated persistent rename action', () => {
  assert.match(appSource, /rename-class/);
  assert.match(appSource, /修改名称/);
  assert.match(appSource, /window\.renameClass/);
  assert.match(appSource, /id="form-rename-class"/);
  assert.match(appSource, /class-names/);
  assert.match(appSource, /expected_revision/);
});

test('the class detail editor keeps canonical Senior 1–3 grade values', () => {
  for (const formId of ['form-edit-admin-class', 'form-edit-teaching-class']) {
    const start = appSource.indexOf(`id="${formId}"`);
    const form = appSource.slice(start, appSource.indexOf('</form>', start));
    assert.ok(start > 0, `${formId} should exist`);
    for (const grade of [10, 11, 12]) {
      assert.match(form, new RegExp(`option value="${grade}"[^>]*item\\.grade === ${grade}`));
    }
  }
});
