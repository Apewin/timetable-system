import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const appSource = await readFile(new URL('../app.js', import.meta.url), 'utf8');

const canonicalRuleTypes = [
  'fixed_slots',
  'forbid_slots',
  'preferred_slots',
  'target_occurrences_in_slots',
  'max_occurrences_per_day',
  'min_occurrence_days',
  'no_internal_gaps',
  'preferred_consecutive_pairs',
  'max_consecutive_lessons',
  'max_consecutive_days_in_period',
  'avoid_teacher_day_extremes',
  'synchronized_slots',
  'separate_class_types',
  'priority',
];

test('every backend rule type has staff-facing copy in the constraint editor', () => {
  for (const type of canonicalRuleTypes) {
    assert.match(appSource, new RegExp(`${type}: '[^']+'`), `${type} needs a Chinese label and hint`);
  }
  assert.match(appSource, /<label>规则名称<\/label>/);
  assert.match(appSource, /name: formData\.get\('name'\)\.trim\(\)/);
});

test('editing a rule preserves every canonical parameter family', () => {
  assert.match(appSource, /type === 'target_occurrences_in_slots'/);
  assert.match(appSource, /params\.target = Number\(formData\.get\('target'\)\)/);
  assert.match(appSource, /type === 'min_occurrence_days'/);
  assert.match(appSource, /params\.min = Number\(formData\.get\('min'\)\)/);
  assert.match(appSource, /type === 'preferred_consecutive_pairs'/);
  assert.match(appSource, /params\.target_pairs/);
  assert.match(appSource, /type === 'no_internal_gaps'/);
  assert.match(appSource, /params\.ignore_course_ids/);
  assert.match(appSource, /type === 'separate_class_types'/);
  assert.match(appSource, /params\.left_class_types/);
  assert.match(appSource, /params\.right_class_types/);
  assert.match(appSource, /data-constraint-types=/);
});

test('technical constraint fields stay behind an advanced section with a plain-language preview', () => {
  assert.match(appSource, /const generatedRuleId = `RULE_\$\{Date\.now\(\)\}`/);
  assert.match(appSource, /<details class="constraint-advanced-settings">/);
  assert.match(appSource, /<summary>高级设置（系统编号、权重与筛选）<\/summary>/);
  assert.match(appSource, /id="constraint-rule-preview"/);
  assert.match(appSource, /function updateConstraintPreview|const updateConstraintPreview/);
});
