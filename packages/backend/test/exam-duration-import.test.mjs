import assert from 'node:assert/strict';
import test from 'node:test';
import * as XLSX from 'xlsx';

import { parseExamDurationBuffer } from '../src/exam-duration-import.mjs';

function workbookBuffer(rows, bookType = 'xls') {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), '时长收集');
  return XLSX.write(workbook, { type: 'buffer', bookType });
}

test('imports three grade columns and normalizes flexible duration formats from an old .xls workbook', () => {
  const preview = parseExamDurationBuffer(workbookBuffer([
    ['', '高一', '', '高二', '', '高三', ''],
    [1, '语文', '1.5h', 'AP Psychology', '110 mins', '二外', '30min'],
    [2, '体育', 'NA', '信息技术', '', '线性代数', '40min'],
  ]), {
    courses: [
      { id: 'CHIN', name: '语文', grade: [10, 11, 12], type: 'required' },
      { id: 'AP_PSYCH', name: 'AP Psychology', grade: [11, 12], type: 'ap' },
      { id: 'LINEAR_ALG', name: '线性代数', grade: 12, type: 'required_elective' },
    ],
  }, '各科目考试时长统计.xls');

  assert.deepEqual(preview.rows.map(row => ({
    grade: row.grade,
    subject_name: row.subject_name,
    duration_minutes: row.duration_minutes,
    course_id: row.course_id,
  })), [
    { grade: 10, subject_name: '语文', duration_minutes: 90, course_id: 'CHIN' },
    { grade: 11, subject_name: 'AP Psychology', duration_minutes: 110, course_id: 'AP_PSYCH' },
    { grade: 12, subject_name: '二外', duration_minutes: 30, course_id: null },
    { grade: 12, subject_name: '线性代数', duration_minutes: 40, course_id: 'LINEAR_ALG' },
  ]);
  assert.equal(preview.summary.exam_count, 4);
  assert.equal(preview.summary.skipped_count, 2);
});

test('matches common duration-sheet names to grade-compatible course aliases', () => {
  const preview = parseExamDurationBuffer(workbookBuffer([
    ['', '高一', '', '高二', '', '高三', ''],
    [1, 'AP-Precalculus', '1h', 'AP Language&Composition', '1.5h', 'AP Art', '1.5h'],
  ]), {
    courses: [
      { id: 'MATH_PRECAL', name: '中方数学 + Pre-Calculus', grade: 10, type: 'required' },
      { id: 'AP_LC', name: 'AP LC (Class 3)', grade: 11, type: 'required' },
      { id: 'AP_ARTHIST', name: 'AP Art History', grade: [11, 12], type: 'ap' },
    ],
  }, '时长.xlsx');

  assert.deepEqual(preview.rows.map(row => row.course_id), [
    'MATH_PRECAL',
    'AP_LC',
    'AP_ARTHIST',
  ]);
});

test('matches Chinese shorthand and pre-AP component names used by the real collection sheet', () => {
  const preview = parseExamDurationBuffer(workbookBuffer([
    ['', '高一', '', '高二', '', '高三', ''],
    [1, '数学', '1.5h', '综英', '1h', '力学', '40min'],
    [2, 'Pre AP Biology', '1h', '', '', '', ''],
    [3, '化学', '1h', '', '', '', ''],
    [4, 'Pre AP Chemistry', '1h', '', '', '', ''],
    [5, '物理', '1h', '', '', '', ''],
    [6, 'Listening&Speaking&Literature Reading', '1h', '', '', '', ''],
  ]), {
    courses: [
      { id: 'MATH_PRECAL', name: '中方数学 + Pre-Calculus', grade: 10 },
      { id: 'BIO_PRE', name: 'Pre-Biology', grade: 10 },
      { id: 'CHEM_PRE', name: '中方化学+Pre-Chemistry', grade: 10 },
      { id: 'AP_PHYS1', name: 'AP Physics 1 + 中方物理', grade: 10 },
      { id: 'ENG_LIT', name: 'Comprehensive English - 外教L&S&Lit Reading', grade: 10 },
      { id: 'ENG_COMP', name: 'Comprehensive English', grade: 11 },
      { id: 'MECH_BASIS', name: '力学基础', grade: 12 },
    ],
  }, '时长.xls');

  assert.deepEqual(preview.rows.map(row => row.course_id), [
    'MATH_PRECAL', 'ENG_COMP', 'MECH_BASIS', 'BIO_PRE', 'CHEM_PRE',
    'CHEM_PRE', 'AP_PHYS1', 'ENG_LIT',
  ]);
});
