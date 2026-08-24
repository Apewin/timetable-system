import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import test from 'node:test';
import * as XLSX from 'xlsx';

function durationWorkbook() {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
    ['', '高一', '', '高二', '', '高三', ''],
    [1, '语文', '1.5h', 'AP Psychology', '110 mins', '线性代数', '40min'],
  ]), '考试时长');
  return XLSX.write(workbook, { type: 'buffer', bookType: 'xls' });
}

test('previews an uploaded duration workbook without mutating the saved exam plan', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'timetable-exam-import-'));
  const stateFile = join(directory, 'state.json');
  const previousStateFile = process.env.STATE_FILE;
  process.env.STATE_FILE = stateFile;
  writeFileSync(stateFile, `${JSON.stringify({
    meta: { revision: 7, school: '测试学校' },
    courses: [
      { id: 'CHIN', name: '语文', type: 'required', grade: [10, 11, 12] },
      { id: 'AP_PSYCH', name: 'AP Psychology', type: 'ap', grade: [11, 12] },
      { id: 'LINEAR_ALG', name: '线性代数', type: 'required_elective', grade: 12 },
    ],
    students: [],
  })}\n`);

  const { startServer } = await import('../src/server.mjs');
  const server = startServer({ port: 0, host: '127.0.0.1' });
  await once(server, 'listening');
  t.after(() => {
    server.close();
    if (previousStateFile === undefined) delete process.env.STATE_FILE;
    else process.env.STATE_FILE = previousStateFile;
    rmSync(directory, { recursive: true, force: true });
  });

  const base = `http://127.0.0.1:${server.address().port}/api/exams`;
  const form = new FormData();
  form.append('file', new Blob([durationWorkbook()]), '各科目考试时长统计.xls');
  const response = await fetch(`${base}/import-durations`, { method: 'POST', body: form });
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(payload.data.summary.exam_count, 3);
  assert.deepEqual(payload.data.rows.map(row => row.duration_minutes), [90, 110, 40]);
  const current = await (await fetch(base)).json();
  assert.equal(current.data.revision, 7);
  assert.deepEqual(current.data.plan.exams, []);
});
