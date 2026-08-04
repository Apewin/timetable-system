import assert from 'node:assert/strict';
import test from 'node:test';
import * as XLSX from 'xlsx';
import {
  applyElectiveSelectionChanges,
  parseElectiveSelectionWorkbook,
} from '../src/elective-selection-import.mjs';

const state = {
  courses: [
    { id: 'AP_LANG', name: 'AP Language and Composition', type: 'required_elective', grade: 12, elective_group: 'A' },
    { id: 'LINEAR_ALG', name: '线性代数', type: 'required_elective', grade: 12, elective_group: 'B' },
    { id: 'BUSINESS', name: '商业', type: 'required_elective', grade: 12, elective_group: 'B' },
    { id: 'JAPANESE', name: '日语', type: 'required_elective', grade: 12, elective_group: 'C' },
  ],
  students: [
    { id: '202301', name: '张三', english_name: 'Alex', pinyin_name: 'Zhang San', grade: 12, elective_choices: { group_a: 'AP_LANG' } },
    { id: '202302', name: '李四', english_name: 'Taylor', pinyin_name: 'Li Si', grade: 12, elective_choices: {} },
    { id: '202401', name: '高二生', grade: 11, elective_choices: {} },
  ],
};

function workbook(rows, name = '高三ABC选课') {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), name);
  return workbook;
}

test('parses a wide A/B/C choice sheet and preserves groups absent from a row', () => {
  const preview = parseElectiveSelectionWorkbook(workbook([
    ['Student ID', '中文姓名', '英文名', 'A组', 'B组', 'C组'],
    ['202301', '张三', 'Alex', '', '线性代数', '日语'],
    ['202302', '李四', 'Taylor', 'AP Language and Composition', '商业', '日语'],
  ]), state, 'choices.xlsx');
  assert.equal(preview.can_confirm, true);
  assert.deepEqual(preview.group_counts, { A: 1, B: 2, C: 2 });
  const first = preview.changes.find(change => change.student_id === '202301');
  assert.deepEqual(first.imported_groups, ['B', 'C']);
  const applied = applyElectiveSelectionChanges(state, preview.changes);
  assert.deepEqual(applied.students[0].elective_choices, {
    group_a: 'AP_LANG',
    group_b: 'LINEAR_ALG',
    group_c: 'JAPANESE',
  });
});

test('parses a long sheet and rejects a course placed in the wrong group', () => {
  const preview = parseElectiveSelectionWorkbook(workbook([
    ['学号', '姓名', '组别', '课程'],
    ['202301', '张三', 'A组', '线性代数'],
  ]), state, 'choices.xlsx');
  assert.equal(preview.can_confirm, false);
  assert.equal(preview.invalid.length, 1);
  assert.match(preview.invalid[0].reason, /不是系统高三 A 组课程/);
});

test('parses one-course roster sheets from the sheet title', () => {
  const preview = parseElectiveSelectionWorkbook(workbook([
    ['线性代数'],
    ['Student ID', 'Name (Chinese)', 'English Name'],
    ['202301', '张三', 'Alex'],
  ], '线性代数名单'), state, 'choices.xlsx');
  assert.equal(preview.can_confirm, true);
  assert.equal(preview.changes[0].choices.group_b, 'LINEAR_ALG');
});

test('accepts common Grade 12 A-group roster abbreviations after model normalization', () => {
  const aliasState = {
    ...state,
    courses: [
      ...state.courses,
      { id: 'AP_LIT', name: 'AP Literature and Composition', type: 'required_elective', grade: 12, elective_group: 'A' },
      { id: 'HONOR_LIT', name: 'Honor 英美文学史及选读', type: 'required_elective', grade: 12, elective_group: 'A' },
    ],
    students: [...state.students, { id: '202303', name: '王五', grade: 12, elective_choices: {} }],
  };
  const preview = parseElectiveSelectionWorkbook(workbook([
    ['Student ID', '中文姓名', '姓名拼音', '英文名', 'A组', 'B组', 'C组'],
    ['202301', '张三', '', '', 'AP LC', '', ''],
    ['202302', '李四', '', '', 'AP Lit.&Com.', '', ''],
    ['202303', '王五', '', '', '英美文学史及选读（20人）-416教室', '', ''],
  ]), aliasState, 'A-group-rosters.xlsx');
  assert.equal(preview.can_confirm, true);
  assert.equal(preview.changes.find(change => change.student_id === '202301').choices.group_a, 'AP_LANG');
  assert.equal(preview.changes.find(change => change.student_id === '202302').choices.group_a, 'AP_LIT');
  assert.equal(preview.changes.find(change => change.student_id === '202303').choices.group_a, 'HONOR_LIT');
});
