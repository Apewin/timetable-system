import assert from 'node:assert/strict';
import test from 'node:test';
import * as XLSX from 'xlsx';
import { applyApSelectionChanges, parseApSelectionWorkbook } from '../src/ap-selection-import.mjs';

function workbookWithSheets() {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
    ['AP Biology'],
    ['Senior 2&Senior 3 Class 1'],
    ['No.', 'Name (Chinese)', 'Name (Pin Yin)', 'English Name'],
    [1, '张三', 'Zhang San', 'Alex'],
  ]), 'AP Biology 1');
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
    ['AP Computer Science'],
    [],
    [null, 'No.', 'Name (Chinese)', 'Name (Pin Yin)', 'English Name'],
    [null, 1, '李四', 'Li Si', 'Taylor'],
  ]), 'AP CS 1');
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([['helper'], ['张三']]), 'Sheet1');
  return workbook;
}

const state = {
  courses: [
    { id: 'AP_BIO', name: 'AP Biology', type: 'ap' },
    { id: 'AP_CS', name: 'AP Computer Science', type: 'ap' },
  ],
  students: [
    { id: 'S1', name: '张三', pinyin_name: 'Zhang San', english_name: 'Alex', grade: 11, ap_courses: ['AP_CS'] },
    { id: 'S2', name: '李四', pinyin_name: 'Li Si', english_name: 'Taylor', grade: 11, ap_courses: [] },
  ],
};

test('parses AP rosters across worksheets and ignores helper sheets', () => {
  const preview = parseApSelectionWorkbook(workbookWithSheets(), state, 'choices.xlsx');
  assert.equal(preview.recognized_sheet_count, 2);
  assert.equal(preview.ignored_sheets.length, 1);
  assert.equal(preview.matched_rows, 2);
  assert.equal(preview.unique_students, 2);
  assert.equal(preview.can_confirm, true);
  assert.equal(preview.changes.find(change => change.student_id === 'S1').grade, 11);
  assert.deepEqual(preview.changes.find(change => change.student_id === 'S1').course_ids, ['AP_BIO']);
});

test('replace mode updates only students present in the imported workbook', () => {
  const preview = parseApSelectionWorkbook(workbookWithSheets(), state, 'choices.xlsx');
  const applied = applyApSelectionChanges(state, preview.changes, 'replace');
  assert.deepEqual(applied.students.find(student => student.id === 'S1').ap_courses, ['AP_BIO']);
  assert.deepEqual(applied.students.find(student => student.id === 'S2').ap_courses, ['AP_CS']);
  assert.equal(applied.updated, 2);
});

test('rejects an AP course imported for a student outside its grade scope', () => {
  const scopedState = {
    courses: [{ id: 'AP_PHYSC', name: 'AP Physics C', type: 'ap', grade: 12 }],
    students: [{ id: 'S1', name: '张三', grade: 11, ap_courses: [] }],
  };
  assert.throws(
    () => applyApSelectionChanges(scopedState, [{ student_id: 'S1', course_ids: ['AP_PHYSC'] }]),
    /不适用于/,
  );
});
