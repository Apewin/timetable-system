import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const appSource = await readFile(new URL('../app.js', import.meta.url), 'utf8');

function sourceBetween(startMarker, endMarker) {
  const start = appSource.indexOf(startMarker);
  const end = appSource.indexOf(endMarker, start);
  assert.notEqual(start, -1, `missing ${startMarker}`);
  assert.notEqual(end, -1, `missing ${endMarker}`);
  return appSource.slice(start, end);
}

test('export summaries count scheduled cells instead of timetable rows', () => {
  const helperSource = sourceBetween(
    'function timetableScheduledCellCount',
    '\n// 预览导出内容',
  );
  const timetableScheduledCellCount = new Function(
    `${helperSource}; return timetableScheduledCellCount;`,
  )();

  assert.equal(timetableScheduledCellCount({
    rows: [
      ['P1', null, null, null, null, null],
      ['P2', null, { course_id: 'MATH' }, null, { course_id: 'ENG' }, null],
    ],
  }), 2);
  assert.equal(timetableScheduledCellCount({
    rows: Array.from({ length: 10 }, (_, index) => [`P${index + 1}`, null, null, null, null, null]),
  }), 0);
  assert.match(appSource, /已排 \$\{scheduledCount\} 节课/);
});

test('export refuses to download an empty timetable framework', () => {
  const exportSource = sourceBetween(
    'window.exportTimetable = async function()',
    '\n// 生成 HTML 格式',
  );

  assert.match(exportSource, /data\.stale \|\| timetableScheduledCellCount\(data\) === 0/);
  assert.match(exportSource, /当前没有有效排课结果，请先完成排课再导出/);
});
