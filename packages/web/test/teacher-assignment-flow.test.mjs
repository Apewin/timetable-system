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

test('the assignment form asks for course before teacher and keeps system ids advanced', () => {
  const modalSource = appSource.slice(
    appSource.indexOf("showModal('添加教师分工'"),
    appSource.indexOf("// 构建任务按钮"),
  );
  assert.ok(modalSource.indexOf('<span>课程</span>') < modalSource.indexOf('<span>教师</span>'));
  assert.match(modalSource, /class="assignment-advanced"/);
  assert.match(modalSource, /系统信息/);
  assert.doesNotMatch(modalSource, /teacher\.name \|\| teacher\.id\)} · \$\{escapeHtml\(teacher\.id\)/);
});

test('generated task records show no-teacher-needed separately and hide raw ids from the main table', () => {
  const renderSource = appSource.slice(
    appSource.indexOf('function renderTeachingTaskRows'),
    appSource.indexOf('// 加载教师分工列表'),
  );
  assert.match(renderSource, /teachingTaskStaffing\(task\)/);
  assert.match(renderSource, /无需教师/);
  assert.doesNotMatch(renderSource, /<th>任务 ID<\/th>/);
});

test('generated tasks are rendered as records and weekly periods instead of only a toast', () => {
  assert.match(appSource, /function renderTeachingTaskResults/);
  assert.match(appSource, /个课程\/班级任务/);
  assert.match(appSource, /节\/周/);
  assert.match(appSource, /await loadAssignments\(\{ focusTaskResults: true \}\)/);
});

test('teacher management can filter actual workload anomalies and explains the upper limit', () => {
  assert.match(indexSource, /id="teacher-workload-filter"/);
  assert.match(indexSource, /超过周上限/);
  assert.match(appSource, /teacherMatchesWorkloadFilter/);
  assert.match(appSource, /与固定分工相差/);
  assert.match(appSource, /上限，不要求排满/);
  assert.match(appSource, /没有符合当前搜索或课时筛选条件的教师/);
});
