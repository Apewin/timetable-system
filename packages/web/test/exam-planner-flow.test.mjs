import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const appSource = await readFile(new URL('../app.js', import.meta.url), 'utf8');
const indexSource = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const styleSource = await readFile(new URL('../styles.css', import.meta.url), 'utf8');

test('exam scheduling is exposed as a complete workspace view', () => {
  assert.match(indexSource, /data-view="exam-scheduling"/);
  assert.match(indexSource, /id="view-exam-scheduling"/);
  assert.match(indexSource, /id="exam-course-rows"/);
  assert.match(indexSource, /id="exam-schedule-rows"/);
  assert.match(indexSource, /id="exam-teacher-loads"/);
});

test('exam planner saves, solves, and exports through the public API', () => {
  assert.match(appSource, /api\('\/exams'/);
  assert.match(appSource, /api\('\/exams\/solve'/);
  assert.match(appSource, /fetch\(`\$\{API_BASE\}\/exams\/export`\)/);
  assert.match(appSource, /'三个年级考试时间表\.xlsx'/);
  assert.match(appSource, /'考试安排与考场座次\.xlsx'/);
});

test('exam planner exposes a separate room and teacher staffing action', () => {
  assert.match(indexSource, /id="exam-staff-button"[^>]*onclick="staffExamPlan\(\)"[^>]*>安排监考与巡考</);
  for (const id of ['exam-room-count', 'exam-room-capacity', 'exam-invigilators', 'exam-require-all-teachers']) {
    assert.doesNotMatch(indexSource, new RegExp(`id="${id}"[^>]*disabled`));
  }
  assert.match(appSource, /window\.staffExamPlan = async function/);
});

test('a stale exam result is hidden until it is solved again', () => {
  assert.match(
    appSource,
    /renderExamSchedule\(data\.solve_status === 'valid' \? data\.schedule : null\)/,
  );
});

test('a stale exam plan remains editable and explains the first repair needed', () => {
  assert.match(appSource, /data\.plan_issues\?\.length/);
  assert.match(appSource, /考试计划有.*项需要修复/);
});

test('exam planner explains the timetable and staffing stages', () => {
  assert.match(indexSource, /同时可用考场上限/);
  assert.match(indexSource, /单考场容量上限/);
  assert.match(indexSource, /先生成三个年级考试时间表，再进入考场与教师任务阶段/);
  assert.match(indexSource, /每门考试只安排 1 位实际任课教师巡考；安生教师中除升学顾问外参加监考/);
  assert.match(indexSource, /严格读取具体课程的教师分工，不按相近学科或授课资格推断/);
  assert.match(indexSource, /30 人考场使用 5 列座位，不足 30 人使用 4 列座位/);
  assert.match(indexSource, /id="exam-export-button"[^>]*>导出考试安排与座次 Excel<\/button>/);
  assert.match(indexSource, /<th>预计考场<\/th>/);
});

test('exam planner exposes a separate exam-day selector for every grade', () => {
  for (const id of ['exam-day-count-g10', 'exam-day-count-g11', 'exam-day-count-g12']) {
    assert.match(indexSource, new RegExp(`id="${id}"`));
  }
  assert.doesNotMatch(indexSource, /id="exam-day-count"/);
  assert.match(indexSource, /每个年级的考试只会安排在自己设置的天数范围内/);
  assert.match(appSource, /grade_day_counts:\s*\{[\s\S]*10:[\s\S]*exam-day-count-g10[\s\S]*11:[\s\S]*exam-day-count-g11[\s\S]*12:[\s\S]*exam-day-count-g12/);
});

test('exam planner imports a duration workbook into a reviewable and still-editable exam list', () => {
  assert.match(indexSource, /id="exam-duration-file-input"[^>]*accept="\.xlsx,\.xls"/);
  assert.match(indexSource, /id="exam-import-preview"/);
  assert.match(indexSource, /排考试与日常排课属于不同时间段/);
  assert.match(appSource, /\/exams\/import-durations/);
  assert.match(appSource, /new FormData\(\)/);
  assert.match(appSource, /examRowsFromDurationImport/);
  assert.match(appSource, /type="number" min="5" max="240" step="5"/);
});

test('exam planner explains the special 二外 course and teacher rule', () => {
  assert.match(indexSource, /“二外”按法语、日语、德语合并识别/);
  assert.match(indexSource, /同一名具备监考资格的安生语言任课教师同时担任巡考和监考/);
});

test('exam planner exposes ordinary and longest-exam rest times', () => {
  assert.match(indexSource, /id="exam-minimum-gap"[^>]*min="10"[^>]*value="15"/);
  assert.match(indexSource, /id="exam-longest-gap"[^>]*min="10"[^>]*value="30"/);
  assert.match(indexSource, /普通考试后休息 15 分钟；系统自动识别本批次最长考试，结束后休息 30 分钟/);
  assert.match(appSource, /minimum_exam_gap_minutes: document\.getElementById\('exam-minimum-gap'\)\.value/);
  assert.match(appSource, /longest_exam_gap_minutes: document\.getElementById\('exam-longest-gap'\)\.value/);
  assert.match(appSource, /examRestPolicySummary\(schedule\)/);
});

test('exam planner has dedicated desktop and responsive presentation', () => {
  for (const selector of [
    '.exam-page-header',
    '.exam-layout',
    '.exam-config-grid',
    '.exam-result-card',
    '.exam-teacher-loads',
  ]) {
    assert.ok(styleSource.includes(selector), `missing exam planner style ${selector}`);
  }
  assert.match(styleSource, /@media \(max-width: 820px\)[\s\S]*\.exam-layout/);
});

test('exam resource fields adapt to the card width so the full date remains visible', () => {
  assert.match(styleSource, /\.exam-card\s*\{[^}]*container-type:\s*inline-size/s);
  assert.match(
    styleSource,
    /@container\s*\(max-width:\s*700px\)[\s\S]*\.exam-config-grid\s*\{[^}]*grid-template-columns:\s*repeat\(2,/,
  );
});
