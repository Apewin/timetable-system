import assert from 'node:assert/strict';
import test from 'node:test';

import { countElectiveSelections, importReadinessModel, importTemplateCsv } from '../import-readiness-view.mjs';

test('distinguishes core readiness from optional selection imports', () => {
  const model = importReadinessModel({
    students: 219, teachers: 43, courses: 51, teaching_tasks: 403,
    ap_selections: 180, elective_selections: 0, exams: 27,
  });
  assert.equal(model.core_ready, true);
  assert.equal(model.core_ready_count, 4);
  assert.equal(model.items.find(item => item.key === 'elective_selections').status, 'attention');
  assert.equal(model.items.find(item => item.key === 'exams').label, '考试科目与时长');
});

test('download templates use fields accepted by the standard importer', () => {
  assert.match(importTemplateCsv('students'), /^\uFEFF学号,姓名,英文名,姓名拼音,年级,行政班,教学班/m);
  assert.match(importTemplateCsv('teachers'), /^\uFEFF工号,姓名,可教课程,每日上限,每周上限/m);
  assert.match(importTemplateCsv('courses'), /^\uFEFF课程编号,课程名称,类型,年级,班级类型,周课时/m);
});

test('counts other elective choices from the canonical student records', () => {
  assert.equal(countElectiveSelections([
    { elective_choices: { group_a: 'C_A', group_b: 'C_B', group_c: null } },
    { elective_choices: { group_a: '', group_b: 'C_C' } },
    { elective_choices: null },
  ]), 3);
});
