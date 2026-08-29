import assert from 'node:assert/strict';
import test from 'node:test';
import ExcelJS from 'exceljs';
import {
  applyTeacherTemplateSuggestions,
  analyzeScheduleTemplates,
  exportScheduleTemplates,
  matchTeacherWorksheet,
  resolveScheduleTemplateInputs,
} from '../src/schedule-template-export.mjs';

const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];

function timetableRows(worksheet, labelColumn, startRow) {
  let row = startRow;
  for (let period = 1; period <= 10; period += 1) {
    worksheet.getCell(row, labelColumn).value = `${period}${period === 1 ? 'st' : period === 2 ? 'nd' : period === 3 ? 'rd' : 'th'} period`;
    row += 1;
  }
}

async function classTemplateBuffer() {
  const workbook = new ExcelJS.Workbook();
  for (const definition of [
    { sheetName: 'Senior1', gradeLabel: 'Senior 1' },
    { sheetName: 'Senior2', gradeLabel: '2025级' },
    { sheetName: 'Senior3', gradeLabel: '2024级' },
  ]) {
    const worksheet = workbook.addWorksheet(definition.sheetName);
    for (let classIndex = 1; classIndex <= 3; classIndex += 1) {
      const labelColumn = 1 + (classIndex - 1) * 7;
      worksheet.getCell(1, labelColumn).value = `Class ${classIndex}, ${definition.gradeLabel}`;
      days.forEach((day, index) => { worksheet.getCell(1, labelColumn + index + 1).value = day; });
      timetableRows(worksheet, labelColumn, 2);
    }
  }
  const worksheet = workbook.getWorksheet('Senior1');
  worksheet.getCell('B2').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFF00' } };
  worksheet.getCell('B2').border = { bottom: { style: 'thin', color: { argb: '000000' } } };
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

async function teacherTemplateBuffer() {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet('Haman 韩鹏');
  days.forEach((day, index) => { worksheet.getCell(1, index + 2).value = day; });
  worksheet.getCell('A2').value = 'Teacher';
  days.forEach((_, index) => { worksheet.getCell(2, index + 2).value = 'Haman'; });
  timetableRows(worksheet, 1, 3);
  worksheet.getCell('B3').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: '00FF00' } };
  const resource = workbook.addWorksheet('机房使用');
  days.forEach((day, index) => { resource.getCell(1, index + 2).value = day; });
  timetableRows(resource, 1, 2);
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

function stateFixture() {
  return {
    solve_status: 'valid',
    teachers: [
      { id: 'T_HANPENG', name: '韩鹏' },
      { id: 'T_QINXINXUAN', name: '秦心瑄' },
    ],
    courses: [
      { id: 'ENG', name: '英语' },
      { id: 'AP_PHY', name: 'AP 物理' },
    ],
    rooms: [],
    students: [
      { id: 'S1', teaching_class_id: 'TC_G10_1' },
      { id: 'S2', teaching_class_id: 'TC_G10_2' },
      { id: 'S3', teaching_class_id: 'TC_G10_3' },
    ],
    admin_classes: [],
    teaching_classes: [
      { id: 'TC_G10_1', name: '高一教学1班', grade: 10, student_ids: ['S1'] },
      { id: 'TC_G10_2', name: '高一教学2班', grade: 10, student_ids: ['S2'] },
      { id: 'TC_G10_3', name: '高一教学3班', grade: 10, student_ids: ['S3'] },
      { id: 'TC_G11_1', name: '高二教学1班', grade: 11, student_ids: [] },
      { id: 'TC_G11_2', name: '高二教学2班', grade: 11, student_ids: [] },
      { id: 'TC_G11_3', name: '高二教学3班', grade: 11, student_ids: [] },
      { id: 'TC_G12_1', name: '高三教学1班', grade: 12, student_ids: [] },
      { id: 'TC_G12_2', name: '高三教学2班', grade: 12, student_ids: [] },
      { id: 'TC_G12_3', name: '高三教学3班', grade: 12, student_ids: [] },
    ],
    schedule: {
      sections: [
        { id: 'SEC_ENG', course_id: 'ENG', teacher_id: 'T_HANPENG', class_id: 'TC_G10_1', class_type: 'teaching', student_ids: ['S1'] },
        { id: 'SEC_AP', course_id: 'AP_PHY', teacher_id: 'T_QINXINXUAN', class_type: 'ap', ap_block_id: 'B1', ap_block_name: 'Block 1', student_ids: ['S1'] },
      ],
      assignments: [
        { section_id: 'SEC_ENG', course_id: 'ENG', teacher_id: 'T_HANPENG', class_id: 'TC_G10_1', class_type: 'teaching', student_id: 'S1', slot_id: 'D1P1' },
        { section_id: 'SEC_AP', course_id: 'AP_PHY', teacher_id: 'T_QINXINXUAN', class_type: 'ap', student_id: 'S1', slot_id: 'D2P2' },
      ],
    },
  };
}

test('teacher worksheet matching tolerates one-character Chinese name variants', () => {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet('Chris 秦心蕴');
  days.forEach((day, index) => { worksheet.getCell(1, index + 2).value = day; });
  worksheet.getCell('A2').value = 'Teacher';
  days.forEach((_, index) => { worksheet.getCell(2, index + 2).value = 'Chris'; });
  timetableRows(worksheet, 1, 3);
  const match = matchTeacherWorksheet(worksheet, [
    { id: 'T_QINXINXUAN', name: '秦心瑄' },
    { id: 'T_ZHANGHUIHUI', name: '张慧慧' },
  ]);
  assert.equal(match.status, 'matched');
  assert.equal(match.teacher_id, 'T_QINXINXUAN');
});

test('teacher worksheet matching uses grade and course teaching assignments', () => {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet('高一历史');
  days.forEach((day, index) => { worksheet.getCell(1, index + 2).value = day; });
  timetableRows(worksheet, 1, 2);
  const state = {
    teachers: [{ id: 'T_HISTORY', name: '历史任课教师' }],
    courses: [{ id: 'HIST', name: '历史', grade: 10 }],
    admin_classes: [{ id: 'AC1', name: '高一(1)班', grade: 10 }],
    teaching_assignments: [{ id: 'TA_HIST', teacher_id: 'T_HISTORY', course_id: 'HIST', class_ids: ['AC1'] }],
  };
  const match = matchTeacherWorksheet(worksheet, state.teachers, state);
  assert.equal(match.status, 'matched');
  assert.equal(match.teacher_id, 'T_HISTORY');
  assert.equal(match.match_method, 'course_assignment');
  assert.match(match.match_reason, /高一.*历史.*教师分工/);
});

test('LLM teacher suggestions remain visibly confirmable and candidate-bounded', () => {
  const analysis = {
    warnings: ['1 张教师表无法唯一匹配，请在导出前人工选择'],
    teacher_template: {
      mappings: [{
        sheet_name: '高二体育宋老师',
        status: 'ambiguous',
        ai_candidates: [
          { teacher_id: 'T_PE_1', teacher_name: '体育教师一' },
          { teacher_id: 'T_PE_2', teacher_name: '体育教师二' },
        ],
      }],
    },
  };
  const result = applyTeacherTemplateSuggestions(analysis, {
    model: 'test-model',
    suggestions: [{ sheet_name: '高二体育宋老师', teacher_id: 'T_PE_2', confidence: 0.82, reason: '课程与年级候选一致' }],
  });
  const mapping = result.teacher_template.mappings[0];
  assert.equal(mapping.status, 'llm_suggested');
  assert.equal(mapping.teacher_id, 'T_PE_2');
  assert.equal(mapping.requires_confirmation, true);
  assert.equal(result.teacher_template.suggested_count, 1);
});

test('template analysis detects class blocks, teachers, and resource sheets', async () => {
  const result = await analyzeScheduleTemplates({
    classTemplateBuffer: await classTemplateBuffer(),
    classTemplateName: 'classes.xlsx',
    teacherTemplateBuffer: await teacherTemplateBuffer(),
    teacherTemplateName: 'teachers.xlsx',
    state: stateFixture(),
  });
  assert.equal(result.class_template.mapped_class_count, 9);
  assert.equal(result.teacher_template.matched_count, 1);
  assert.equal(result.teacher_template.resource_count, 1);
});

test('bundled school templates are used independently when uploads are omitted', async () => {
  const defaults = await resolveScheduleTemplateInputs();
  assert.deepEqual(defaults.templateSources, {
    class_template: 'default',
    teacher_template: 'default',
  });
  const result = await analyzeScheduleTemplates({ ...defaults, state: stateFixture() });
  assert.equal(result.class_template.sheet_count, 4);
  assert.equal(result.class_template.mapped_class_count, 9);
  assert.equal(result.teacher_template.sheet_count, 41);

  const customClass = await classTemplateBuffer();
  const partial = await resolveScheduleTemplateInputs({
    classTemplateBuffer: customClass,
    classTemplateName: 'custom-classes.xlsx',
  });
  assert.equal(partial.classTemplateBuffer, customClass);
  assert.equal(partial.classTemplateName, 'custom-classes.xlsx');
  assert.deepEqual(partial.templateSources, {
    class_template: 'uploaded',
    teacher_template: 'default',
  });
});

test('template export fills timetable cells while preserving template styles', async () => {
  const result = await exportScheduleTemplates({
    classTemplateBuffer: await classTemplateBuffer(),
    classTemplateName: 'classes.xlsx',
    teacherTemplateBuffer: await teacherTemplateBuffer(),
    teacherTemplateName: 'teachers.xlsx',
    state: stateFixture(),
    now: new Date('2026-08-10T00:00:00Z'),
  });
  assert.equal(result.files.length, 2);
  assert.equal(result.summary.class_filled_cells, 2);
  assert.equal(result.summary.teacher_filled_cells, 2);
  assert.equal(result.summary.teacher_sheet_count, 2);
  assert.equal(result.summary.generated_teacher_sheets, 1);

  const classWorkbook = new ExcelJS.Workbook();
  await classWorkbook.xlsx.load(result.files.find(item => item.kind === 'class').buffer);
  const classSheet = classWorkbook.getWorksheet('Senior1');
  assert.equal(classSheet.getCell('B2').value, '英语\n韩鹏');
  assert.equal(classSheet.getCell('C3').value, 'AP 物理\n秦心瑄');
  assert.equal(classSheet.getCell('B2').fill.fgColor.argb, 'FFFF00');
  assert.equal(classSheet.getCell('B2').border.bottom.style, 'thin');

  const teacherWorkbook = new ExcelJS.Workbook();
  await teacherWorkbook.xlsx.load(result.files.find(item => item.kind === 'teacher').buffer);
  const teacherSheet = teacherWorkbook.getWorksheet('Haman 韩鹏');
  assert.equal(teacherSheet.getCell('B3').value, '英语\n高一教学1班');
  assert.equal(teacherSheet.getCell('B3').fill.fgColor.argb, '00FF00');
  const generatedTeacherSheet = teacherWorkbook.getWorksheet('秦心瑄');
  assert.ok(generatedTeacherSheet, '模板缺少的现任教师也必须出现在全部教师课表中');
  assert.equal(generatedTeacherSheet.getCell('C4').value, 'AP 物理\nBlock 1');
  assert.equal(teacherWorkbook.getWorksheet('机房使用').getCell('B2').value, null);
});

test('a teacher missing from the template inherits the existing school worksheet style', async () => {
  const state = stateFixture();
  state.teachers.push({ id: 'T_NEW', name: '全新测试教师' });
  state.courses.push({ id: 'NEW_COURSE', name: '新教师课程' });
  state.schedule.sections.push({
    id: 'SEC_NEW',
    course_id: 'NEW_COURSE',
    teacher_id: 'T_NEW',
    class_id: 'TC_G10_1',
    class_type: 'teaching',
    student_ids: ['S1'],
  });
  state.schedule.assignments.push({
    section_id: 'SEC_NEW',
    course_id: 'NEW_COURSE',
    teacher_id: 'T_NEW',
    class_id: 'TC_G10_1',
    class_type: 'teaching',
    student_id: 'S1',
    slot_id: 'D1P2',
  });
  const defaults = await resolveScheduleTemplateInputs();

  const result = await exportScheduleTemplates({
    classTemplateBuffer: await classTemplateBuffer(),
    classTemplateName: 'classes.xlsx',
    teacherTemplateBuffer: defaults.teacherTemplateBuffer,
    teacherTemplateName: defaults.teacherTemplateName,
    state,
    now: new Date('2026-08-29T00:00:00Z'),
  });

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(result.files.find(item => item.kind === 'teacher').buffer);
  const source = workbook.getWorksheet('Haman 韩鹏');
  const generated = workbook.getWorksheet('全新测试教师');
  assert.ok(source);
  assert.ok(generated);
  assert.equal(result.summary.generated_teacher_sheets, 1);
  assert.equal(
    source.getCell('A1').value,
    'Notes:This schedule  will be  in effect  from August 29,2026.',
  );
  assert.equal(generated.getCell('A1').value, source.getCell('A1').value);
  assert.equal(generated.getCell('A1').fill?.fgColor?.argb, source.getCell('A1').fill?.fgColor?.argb);
  assert.equal(generated.getCell('B2').value, 'Monday');
  assert.equal(generated.getCell('A3').value, 'Teacher');
  assert.equal(generated.getCell('B3').value, '全新测试教师');
  assert.equal(generated.getCell('B6').value, '新教师课程\n高一教学1班');
  assert.ok(generated.model.merges.includes('A1:F1'));
  assert.deepEqual(generated.getCell('B2').style, source.getCell('B2').style);
  assert.equal(generated.getRow(1).height, source.getRow(1).height);
  assert.equal(generated.getColumn(2).width, source.getColumn(2).width);
  assert.equal(generated.pageSetup.orientation, source.pageSetup.orientation);
});

test('class timetable export lists every AP course instead of block placeholders or summaries', async () => {
  const state = stateFixture();
  const apCourses = [
    ['AP_PHY', 'AP 物理', 'T_QINXINXUAN', '秦心瑄'],
    ['AP_CHEM', 'AP 化学', 'T_CHEM', '化学教师'],
    ['AP_BIO', 'AP 生物', 'T_BIO', '生物教师'],
    ['AP_MICRO', 'AP 微观经济学', 'T_MICRO', '经济教师'],
    ['AP_ART', 'AP 艺术史', 'T_ART', '艺术教师'],
  ];
  state.courses = apCourses.map(([id, name]) => ({ id, name }));
  state.teachers = apCourses.map(([, , id, name]) => ({ id, name }));
  state.schedule = {
    sections: apCourses.map(([courseId, , teacherId], index) => ({
      id: `SEC_AP_${index + 1}`,
      course_id: courseId,
      teacher_id: teacherId,
      class_type: 'ap',
      ap_block_id: 'B1',
      ap_block_name: 'Block 1',
      student_ids: ['S1'],
    })),
    assignments: apCourses.map(([courseId, , teacherId], index) => ({
      section_id: `SEC_AP_${index + 1}`,
      course_id: courseId,
      teacher_id: teacherId,
      class_type: 'ap',
      student_id: 'S1',
      slot_id: 'D2P2',
    })),
  };

  const result = await exportScheduleTemplates({
    classTemplateBuffer: await classTemplateBuffer(),
    classTemplateName: 'classes.xlsx',
    teacherTemplateBuffer: await teacherTemplateBuffer(),
    teacherTemplateName: 'teachers.xlsx',
    state,
    now: new Date('2026-08-29T00:00:00Z'),
  });

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(result.files.find(item => item.kind === 'class').buffer);
  const worksheet = workbook.getWorksheet('Senior1');
  const cell = worksheet.getCell('C3');
  const lines = String(cell.value).split('\n');
  assert.equal(lines.length, apCourses.length);
  for (const [, courseNameValue] of apCourses) {
    assert.ok(lines.some(line => line.includes(courseNameValue)), `${courseNameValue} 必须完整显示`);
  }
  assert.doesNotMatch(String(cell.value), /Block|AP 分流|等\s*\d+\s*门/);
  assert.ok(cell.font.size <= 9, '课程较多时应缩小字号');
  assert.ok(worksheet.getRow(cell.row).height >= 60, '课程较多时应保证足够行高');
});

test('course-matched legacy teacher sheets are relabelled for the current teacher', async () => {
  const legacyTemplate = new ExcelJS.Workbook();
  const legacySheet = legacyTemplate.addWorksheet('高一生物原园');
  days.forEach((day, index) => { legacySheet.getCell(1, index + 2).value = day; });
  legacySheet.getCell('A2').value = 'Teacher';
  days.forEach((_, index) => { legacySheet.getCell(2, index + 2).value = '原园'; });
  timetableRows(legacySheet, 1, 3);

  const state = {
    ...stateFixture(),
    teachers: [{ id: 'T_BIO', name: '匿名生物教师' }],
    courses: [{ id: 'BIO', name: '生物', grade: 10 }],
    teaching_assignments: [{
      id: 'TA_BIO', teacher_id: 'T_BIO', course_id: 'BIO',
      class_id: 'TC_G10_1', class_ids: ['TC_G10_1'], class_type: 'teaching', weekly_hours: 1,
    }],
    schedule: {
      sections: [{
        id: 'SEC_BIO', course_id: 'BIO', teacher_id: 'T_BIO',
        class_id: 'TC_G10_1', class_type: 'teaching', student_ids: ['S1'],
      }],
      assignments: [{
        section_id: 'SEC_BIO', course_id: 'BIO', teacher_id: 'T_BIO',
        class_id: 'TC_G10_1', class_type: 'teaching', student_id: 'S1', slot_id: 'D1P1',
      }],
    },
  };
  const result = await exportScheduleTemplates({
    classTemplateBuffer: await classTemplateBuffer(),
    classTemplateName: 'classes.xlsx',
    teacherTemplateBuffer: Buffer.from(await legacyTemplate.xlsx.writeBuffer()),
    teacherTemplateName: 'legacy-teachers.xlsx',
    state,
    now: new Date('2026-08-29T00:00:00Z'),
  });

  const exported = new ExcelJS.Workbook();
  await exported.xlsx.load(result.files.find(item => item.kind === 'teacher').buffer);
  assert.equal(exported.getWorksheet('高一生物原园'), undefined);
  const currentSheet = exported.getWorksheet('匿名生物教师');
  assert.ok(currentSheet, '旧模板页应保留版式，但必须使用现任教师姓名');
  for (let column = 2; column <= 6; column += 1) {
    assert.equal(currentSheet.getCell(2, column).value, '匿名生物教师');
  }
  assert.equal(currentSheet.getCell('B3').value, '生物\n高一教学1班');
});
