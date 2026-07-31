import assert from 'node:assert/strict';
import test from 'node:test';
import * as XLSX from 'xlsx';
import {
  interpretWorkbook,
  workbookFromInterpretation,
  workbookSnapshot,
} from '../src/llm-workbook-interpreter.mjs';

test('bounds workbook data sent to the model', () => {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(
    Array.from({ length: 20 }, (_, row) => Array.from({ length: 20 }, (_, column) => `${row}:${column}`)),
  ), 'Sheet1');
  const snapshot = workbookSnapshot(workbook, { maxRowsPerSheet: 3, maxColumns: 4, maxCells: 12 });
  assert.equal(snapshot.sheets[0].rows.length, 3);
  assert.equal(snapshot.sheets[0].rows[0].length, 4);
});

test('turns validated model output into a canonical workbook', () => {
  const workbook = workbookFromInterpretation({
    sheets: [{
      name: 'ABC',
      headers: ['Student ID', '中文姓名', 'A组'],
      rows: [{ 'Student ID': '202301', 中文姓名: '张三', A组: 'AP Language' }],
    }],
  });
  const rows = XLSX.utils.sheet_to_json(workbook.Sheets.ABC, { header: 1, defval: '' });
  assert.deepEqual(rows[0], ['Student ID', '中文姓名', 'A组']);
  assert.deepEqual(rows[1], ['202301', '张三', 'AP Language']);
});

test('calls the model once and validates its JSON response', async () => {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([['odd'], ['layout']]), 'Raw');
  let calls = 0;
  const fetchImpl = async (_url, options) => {
    calls++;
    const request = JSON.parse(options.body);
    assert.equal(request.messages.length, 2);
    assert.deepEqual(request.response_format, { type: 'json_object' });
    assert.match(request.messages[0].content, /不推测、不补全/);
    assert.match(request.messages[0].content, /不确定字段保留空值/);
    assert.match(request.messages[0].content, /并排放置多份纵向课程名单/);
    assert.match(request.messages[0].content, /德语名单/);
    assert.match(request.messages[0].content, /并排的多列区块/);
    assert.match(request.messages[0].content, /力学基础学生名单/);
    assert.match(request.messages[0].content, /只有姓名、没有课程标题的汇总工作表/);
    assert.match(request.messages[0].content, /GERMAN（德语）/);
    return {
      ok: true,
      json: async () => ({
        choices: [{
          message: {
            content: JSON.stringify({
              document_type: 'elective_selections',
              confidence: 0.95,
              sheets: [{
                name: 'ABC',
                headers: ['Student ID', '中文姓名', 'A组', 'B组', 'C组'],
                rows: [['202301', '张三', '', '线性代数', '日语']],
              }],
            }),
          },
        }],
      }),
    };
  };
  const result = await interpretWorkbook(workbook, {
    expectedType: 'elective_selections',
    courseCatalog: [{ id: 'GERMAN', name: '德语', type: 'required_elective', grade: 12, elective_group: 'C' }],
    fetchImpl,
    config: { apiKey: 'test-key', apiUrl: 'https://example.test/v1', model: 'test-model' },
  });
  assert.equal(calls, 1);
  assert.equal(result.interpretation.confidence, 0.95);
});

test('retries once when JSON mode returns an empty model response', async () => {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([['名单']]), 'Raw');
  let calls = 0;
  const fetchImpl = async () => {
    calls++;
    return {
      ok: true,
      json: async () => calls === 1
        ? { choices: [{ finish_reason: 'stop', message: { content: '' } }] }
        : {
          choices: [{
            finish_reason: 'stop',
            message: {
              content: JSON.stringify({
                document_type: 'elective_selections',
                sheets: [{ name: 'ABC', headers: ['中文姓名', 'B组'], rows: [['张三', '商业']] }],
              }),
            },
          }],
        },
    };
  };
  const result = await interpretWorkbook(workbook, {
    expectedType: 'elective_selections',
    fetchImpl,
    config: { apiKey: 'test-key', apiUrl: 'https://example.test/v1', model: 'test-model' },
  });
  assert.equal(calls, 2);
  assert.equal(result.interpretation.sheets[0].rows[0][0], '张三');
});
