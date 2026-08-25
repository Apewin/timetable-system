import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const appSource = await readFile(new URL('../app.js', import.meta.url), 'utf8');
const indexSource = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const examViewSource = await readFile(new URL('../exam-planner-view.mjs', import.meta.url), 'utf8');

test('teacher management displays and edits the exam staffing group', () => {
  assert.match(appSource, /<th>考试分组<\/th>/);
  assert.match(appSource, /exam_staff_group_name/);
  assert.match(appSource, /name="exam_staff_group"/);
  assert.match(appSource, />安生教师<\/option>/);
  assert.match(appSource, />班主任<\/option>/);
  assert.match(appSource, />实验教师<\/option>/);
});

test('exam results explain that the guidance counselor remains Ansheng but is exempt from invigilation', () => {
  const start = appSource.indexOf('function renderExamSchedule(schedule)');
  const end = appSource.indexOf('async function loadExamPlanner()', start);
  const functionSource = appSource.slice(start, end);
  assert.match(indexSource, /安生教师中除升学顾问外/);
  assert.match(functionSource, /examTeacherDutyReview\(schedule\)/);
  assert.match(examViewSource, /filter\(item => item\.invigilation_eligible !== false\)/);
  assert.match(examViewSource, /invigilation_exemption_reason/);
  assert.match(appSource, /exam_staff_group_name/);
});
