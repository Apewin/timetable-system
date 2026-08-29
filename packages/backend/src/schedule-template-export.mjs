import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import ExcelJS from 'exceljs';

const execFileAsync = promisify(execFile);
const DAY_NAMES = new Map([
  ['monday', 1], ['mon', 1], ['星期一', 1], ['周一', 1],
  ['tuesday', 2], ['tue', 2], ['星期二', 2], ['周二', 2],
  ['wednesday', 3], ['wed', 3], ['星期三', 3], ['周三', 3],
  ['thursday', 4], ['thu', 4], ['星期四', 4], ['周四', 4],
  ['friday', 5], ['fri', 5], ['星期五', 5], ['周五', 5],
]);
const CHINESE_NUMBERS = new Map([['一', 1], ['二', 2], ['三', 3]]);
const RESOURCE_SHEET_PATTERN = /机房|教室|场地|room\s*(use|usage|schedule)?/i;
const COURSE_SUBJECT_ALIASES = [
  { label: '信息技术', courseIds: ['IT'] },
  { label: '语法', courseIds: ['GRAMMAR'] },
  { label: '语文', courseIds: ['CHIN'] },
  { label: '历史', courseIds: ['HIST'] },
  { label: '地理', courseIds: ['GEOG'] },
  { label: '生物', courseIds: ['BIO', 'BIO_PRE', 'AP_BIO'] },
  { label: '政治', courseIds: ['POL'] },
  { label: '美术', courseIds: ['ART'] },
  { label: '体育', courseIds: ['PE'] },
];
const DEFAULT_CLASS_TEMPLATE_FILE = fileURLToPath(new URL('../assets/export-templates/default-class-template.xlsx', import.meta.url));
const DEFAULT_TEACHER_TEMPLATE_FILE = fileURLToPath(new URL('../assets/export-templates/default-teacher-template.xlsx', import.meta.url));
const DEFAULT_CLASS_TEMPLATE_NAME = '2026-2027学年第一学期9月1日起新课表.xlsx';
const DEFAULT_TEACHER_TEMPLATE_NAME = '老师课表1-9月1日起所有老师课表.xlsx';

export async function resolveScheduleTemplateInputs({
  classTemplateBuffer,
  classTemplateName,
  teacherTemplateBuffer,
  teacherTemplateName,
} = {}) {
  const [resolvedClassBuffer, resolvedTeacherBuffer] = await Promise.all([
    classTemplateBuffer || fs.readFile(DEFAULT_CLASS_TEMPLATE_FILE),
    teacherTemplateBuffer || fs.readFile(DEFAULT_TEACHER_TEMPLATE_FILE),
  ]);
  return {
    classTemplateBuffer: resolvedClassBuffer,
    classTemplateName: classTemplateBuffer ? classTemplateName : DEFAULT_CLASS_TEMPLATE_NAME,
    teacherTemplateBuffer: resolvedTeacherBuffer,
    teacherTemplateName: teacherTemplateBuffer ? teacherTemplateName : DEFAULT_TEACHER_TEMPLATE_NAME,
    templateSources: {
      class_template: classTemplateBuffer ? 'uploaded' : 'default',
      teacher_template: teacherTemplateBuffer ? 'uploaded' : 'default',
    },
  };
}

function textValue(value) {
  if (value == null) return '';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value.richText)) return value.richText.map(item => item.text || '').join('');
  if (typeof value.text === 'string') return value.text;
  if (value.result != null) return textValue(value.result);
  if (typeof value.hyperlink === 'string') return value.text || value.hyperlink;
  return '';
}

function compactText(value) {
  return textValue(value).normalize('NFKC').replace(/\s+/g, ' ').trim();
}

function normalizedIdentity(value) {
  return compactText(value)
    .toLocaleLowerCase('zh-CN')
    .replace(/灜/g, '瀛')
    .replace(/teacher|老师|教师/g, '')
    .replace(/[\s\p{P}\p{S}_]+/gu, '');
}

function chineseRuns(value) {
  return normalizedIdentity(value).match(/[\u3400-\u9fff]{2,}/g) || [];
}

function latinTokens(value) {
  return compactText(value).toLocaleLowerCase('en-US').match(/[a-z]{2,}/g) || [];
}

function editDistance(left, right) {
  const a = [...left];
  const b = [...right];
  const row = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    let diagonal = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const above = row[j];
      row[j] = Math.min(
        row[j] + 1,
        row[j - 1] + 1,
        diagonal + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
      diagonal = above;
    }
  }
  return row[b.length];
}

function dayNumber(value) {
  const normalized = compactText(value).toLocaleLowerCase('en-US').replace(/[\s.]/g, '');
  return DAY_NAMES.get(normalized) || null;
}

function periodNumber(value) {
  const text = compactText(value);
  const english = /(?:^|\b)(\d{1,2})(?:st|nd|rd|th)?\s*period\b/i.exec(text);
  const chinese = /第\s*(\d{1,2})\s*节/.exec(text);
  const compact = /^P\s*(\d{1,2})$/i.exec(text);
  const parsed = Number(english?.[1] || chinese?.[1] || compact?.[1]);
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= 10 ? parsed : null;
}

function gradeNumber(value) {
  const text = compactText(value);
  const senior = /senior\s*([123])/i.exec(text);
  if (senior) return Number(senior[1]) + 9;
  const chinese = /高\s*([一二三123])/.exec(text);
  if (!chinese) return null;
  const number = Number(chinese[1]) || CHINESE_NUMBERS.get(chinese[1]);
  return number ? number + 9 : null;
}

function classNumber(value) {
  const text = compactText(value);
  const english = /class\s*([123])/i.exec(text);
  if (english) return Number(english[1]);
  const chinese = /([一二三123])\s*班/.exec(text);
  if (!chinese) return null;
  return Number(chinese[1]) || CHINESE_NUMBERS.get(chinese[1]) || null;
}

function worksheetGrid(worksheet) {
  const maxHeaderRow = Math.min(Math.max(worksheet.rowCount, 1), 6);
  for (let rowNumber = 1; rowNumber <= maxHeaderRow; rowNumber += 1) {
    const dayColumns = [];
    for (let columnNumber = 1; columnNumber <= worksheet.columnCount; columnNumber += 1) {
      const day = dayNumber(worksheet.getCell(rowNumber, columnNumber).value);
      if (day) dayColumns.push({ day, column: columnNumber });
    }
    if (new Set(dayColumns.map(item => item.day)).size < 5) continue;
    const orderedDays = [...dayColumns]
      .filter((item, index, all) => all.findIndex(candidate => candidate.day === item.day) === index)
      .sort((left, right) => left.day - right.day);
    const labelColumn = Math.max(1, Math.min(...orderedDays.map(item => item.column)) - 1);
    const periodRows = new Map();
    for (let periodRow = rowNumber + 1; periodRow <= worksheet.rowCount; periodRow += 1) {
      const period = periodNumber(worksheet.getCell(periodRow, labelColumn).value);
      if (period && !periodRows.has(period)) periodRows.set(period, periodRow);
    }
    if (periodRows.size >= 9) return { headerRow: rowNumber, labelColumn, dayColumns: orderedDays, periodRows };
  }
  return null;
}

function classSheetBlocks(worksheet) {
  const grade = gradeNumber(worksheet.name);
  if (!grade) return [];
  const blocks = [];
  for (let rowNumber = 1; rowNumber <= Math.min(worksheet.rowCount, 4); rowNumber += 1) {
    for (let columnNumber = 1; columnNumber <= worksheet.columnCount; columnNumber += 1) {
      const header = compactText(worksheet.getCell(rowNumber, columnNumber).value);
      const templateClassNumber = classNumber(header);
      const headerGrade = gradeNumber(header);
      if (!templateClassNumber || (headerGrade && headerGrade !== grade)) continue;
      const dayColumns = [];
      for (let candidateColumn = columnNumber + 1; candidateColumn <= Math.min(columnNumber + 7, worksheet.columnCount); candidateColumn += 1) {
        const day = dayNumber(worksheet.getCell(rowNumber, candidateColumn).value);
        if (day) dayColumns.push({ day, column: candidateColumn });
      }
      if (new Set(dayColumns.map(item => item.day)).size < 5) continue;
      const periodRows = new Map();
      for (let periodRow = rowNumber + 1; periodRow <= worksheet.rowCount; periodRow += 1) {
        const period = periodNumber(worksheet.getCell(periodRow, columnNumber).value);
        if (period && !periodRows.has(period)) periodRows.set(period, periodRow);
      }
      if (periodRows.size < 9) continue;
      blocks.push({
        grade,
        templateClassNumber,
        headerRow: rowNumber,
        labelColumn: columnNumber,
        dayColumns: dayColumns.sort((left, right) => left.day - right.day),
        periodRows,
      });
    }
  }
  return blocks.filter((block, index, all) =>
    all.findIndex(candidate => candidate.templateClassNumber === block.templateClassNumber) === index);
}

function classOrder(item) {
  return classNumber(item.name) || Number(/(?:_|\b)([123])$/.exec(item.id || '')?.[1]) || 99;
}

function classesForGrade(state, grade) {
  return (state.teaching_classes || [])
    .filter(item => Number(item.grade) === Number(grade))
    .sort((left, right) => classOrder(left) - classOrder(right) || String(left.id).localeCompare(String(right.id)));
}

function teacherSheetIdentityTexts(worksheet) {
  const values = [worksheet.name];
  for (let rowNumber = 1; rowNumber <= Math.min(worksheet.rowCount, 5); rowNumber += 1) {
    let teacherRow = false;
    for (let columnNumber = 1; columnNumber <= worksheet.columnCount; columnNumber += 1) {
      const value = compactText(worksheet.getCell(rowNumber, columnNumber).value);
      if (/^(teacher|教师)$/i.test(value)) teacherRow = true;
    }
    if (!teacherRow) continue;
    for (let columnNumber = 1; columnNumber <= worksheet.columnCount; columnNumber += 1) {
      const value = compactText(worksheet.getCell(rowNumber, columnNumber).value);
      if (value && !/^(teacher|教师)$/i.test(value)) values.push(value);
    }
  }
  return [...new Set(values.filter(Boolean))];
}

function teacherAliases(teacher) {
  const idAlias = String(teacher.id || '').replace(/^T_/i, '').replace(/_/g, ' ');
  return [...new Set([
    teacher.name,
    teacher.english_name,
    ...(Array.isArray(teacher.aliases) ? teacher.aliases : []),
    idAlias,
  ].map(compactText).filter(Boolean))];
}

function teacherMatchScore(identityTexts, teacher) {
  const aliases = teacherAliases(teacher);
  let score = 0;
  for (const identityText of identityTexts) {
    const identity = normalizedIdentity(identityText);
    const identityChinese = chineseRuns(identityText);
    const identityLatin = latinTokens(identityText);
    for (const aliasText of aliases) {
      const alias = normalizedIdentity(aliasText);
      if (!alias) continue;
      if (identity === alias) score = Math.max(score, 110);
      if (alias.length >= 2 && identity.includes(alias)) score = Math.max(score, 104);
      if (identity.length >= 2 && alias.includes(identity)) score = Math.max(score, 98);
      for (const aliasChinese of chineseRuns(aliasText)) {
        for (const candidateChinese of identityChinese) {
          if (candidateChinese === aliasChinese) score = Math.max(score, 106);
          else if (candidateChinese.length === aliasChinese.length && candidateChinese.length >= 3
            && editDistance(candidateChinese, aliasChinese) === 1) score = Math.max(score, 84);
        }
      }
      const aliasLatin = latinTokens(aliasText);
      if (aliasLatin.some(token => identityLatin.includes(token))) score = Math.max(score, 92);
    }
  }
  return score;
}

function courseIdentityScore(identityText, course) {
  const identity = normalizedIdentity(identityText);
  const courseIdentity = normalizedIdentity(course.name);
  let score = courseIdentity.length >= 2 && identity.includes(courseIdentity) ? 100 : 0;
  for (const token of chineseRuns(course.name)) {
    if (token.length >= 2 && identity.includes(token)) score = Math.max(score, 96);
  }
  for (const alias of COURSE_SUBJECT_ALIASES) {
    if (alias.courseIds.includes(course.id) && identity.includes(normalizedIdentity(alias.label))) {
      score = Math.max(score, 92);
    }
  }
  return score;
}

function courseAssignmentContext(identityTexts, state) {
  const identityText = identityTexts.join(' ');
  const sheetGrade = gradeNumber(identityText);
  const teachersById = new Map((state.teachers || []).map(item => [item.id, item]));
  const coursesById = new Map((state.courses || []).map(item => [item.id, item]));
  const classesById = new Map([
    ...(state.admin_classes || []),
    ...(state.teaching_classes || []),
    ...(state.classes || []),
  ].map(item => [item.id, item]));
  const courseMatches = (state.courses || [])
    .map(course => ({ course, score: courseIdentityScore(identityText, course) }))
    .filter(item => item.score > 0);
  const matchedCourseIds = new Set(courseMatches.map(item => item.course.id));
  const assignments = (state.teaching_assignments || [])
    .filter(item => item.teacher_id && matchedCourseIds.has(item.course_id))
    .map(item => {
      const course = coursesById.get(item.course_id);
      const classGrades = [...new Set((item.class_ids || [])
        .map(classId => Number(classesById.get(classId)?.grade))
        .filter(Number.isFinite))];
      const courseGrades = (Array.isArray(course?.grade) ? course.grade : [course?.grade])
        .map(Number)
        .filter(Number.isFinite);
      const grades = classGrades.length ? classGrades : [...new Set(courseGrades)];
      return {
        assignment: item,
        course,
        teacher: teachersById.get(item.teacher_id),
        grades,
        sameGrade: !sheetGrade || grades.includes(sheetGrade),
      };
    })
    .filter(item => item.teacher);

  const candidates = sourceAssignments => {
    const grouped = new Map();
    for (const item of sourceAssignments) {
      const current = grouped.get(item.teacher.id) || {
        teacher_id: item.teacher.id,
        teacher_name: item.teacher.name,
        score: item.sameGrade ? 78 : 58,
        assignment_ids: [],
        course_ids: [],
        course_names: [],
        grades: [],
        same_grade: item.sameGrade,
      };
      current.assignment_ids.push(item.assignment.id);
      current.course_ids.push(item.assignment.course_id);
      current.course_names.push(item.course?.name || item.assignment.course_id);
      current.grades.push(...item.grades);
      current.same_grade ||= item.sameGrade;
      current.score = Math.max(current.score, item.sameGrade ? 78 : 58);
      grouped.set(item.teacher.id, current);
    }
    return [...grouped.values()].map(item => ({
      ...item,
      assignment_ids: [...new Set(item.assignment_ids)],
      course_ids: [...new Set(item.course_ids)],
      course_names: [...new Set(item.course_names)],
      grades: [...new Set(item.grades)].sort((left, right) => left - right),
    })).sort((left, right) => right.score - left.score || left.teacher_name.localeCompare(right.teacher_name, 'zh-CN'));
  };

  return {
    sheet_grade: sheetGrade,
    course_ids: courseMatches.map(item => item.course.id),
    course_names: courseMatches.map(item => item.course.name),
    same_grade_candidates: candidates(assignments.filter(item => item.sameGrade)),
    all_grade_candidates: candidates(assignments),
  };
}

export function matchTeacherWorksheet(worksheet, teachers, state = {}) {
  const identityTexts = teacherSheetIdentityTexts(worksheet);
  if (RESOURCE_SHEET_PATTERN.test(worksheet.name)) {
    return { sheet_name: worksheet.name, status: 'resource', identity_texts: identityTexts, teacher_id: null, candidates: [] };
  }
  const candidates = (teachers || [])
    .map(teacher => ({ teacher_id: teacher.id, teacher_name: teacher.name, score: teacherMatchScore(identityTexts, teacher) }))
    .filter(item => item.score > 0)
    .sort((left, right) => right.score - left.score || left.teacher_name.localeCompare(right.teacher_name))
    .slice(0, 5);
  const best = candidates[0];
  const ambiguous = best && candidates[1] && candidates[1].score === best.score;
  const matched = best && best.score >= 80 && !ambiguous;
  if (matched) {
    return {
      sheet_name: worksheet.name,
      status: 'matched',
      identity_texts: identityTexts,
      teacher_id: best.teacher_id,
      teacher_name: best.teacher_name,
      score: best.score,
      candidates,
      ai_candidates: [],
      match_method: 'teacher_name',
      match_reason: `工作表姓名与系统教师“${best.teacher_name}”一致`,
    };
  }

  const assignmentContext = courseAssignmentContext(identityTexts, {
    ...state,
    teachers: state.teachers || teachers || [],
  });
  const assignmentCandidates = assignmentContext.same_grade_candidates;
  if (assignmentCandidates.length === 1) {
    const courseMatch = assignmentCandidates[0];
    const gradeLabel = assignmentContext.sheet_grade ? `高${assignmentContext.sheet_grade === 10 ? '一' : assignmentContext.sheet_grade === 11 ? '二' : '三'} · ` : '';
    return {
      sheet_name: worksheet.name,
      status: 'matched',
      identity_texts: identityTexts,
      teacher_id: courseMatch.teacher_id,
      teacher_name: courseMatch.teacher_name,
      score: courseMatch.score,
      candidates: assignmentCandidates,
      ai_candidates: [],
      match_method: 'course_assignment',
      match_reason: `${gradeLabel}${courseMatch.course_names.join(' / ')}对应系统教师分工`,
      detected_grade: assignmentContext.sheet_grade,
      detected_course_ids: assignmentContext.course_ids,
      detected_course_names: assignmentContext.course_names,
    };
  }

  const aiCandidates = assignmentCandidates.length
    ? assignmentCandidates
    : assignmentContext.all_grade_candidates;
  return {
    sheet_name: worksheet.name,
    status: ambiguous || assignmentCandidates.length > 1 ? 'ambiguous' : 'unmatched',
    identity_texts: identityTexts,
    teacher_id: null,
    teacher_name: null,
    score: null,
    candidates: assignmentCandidates.length > 1 ? assignmentCandidates : candidates,
    ai_candidates: aiCandidates,
    match_method: null,
    match_reason: assignmentContext.course_names.length
      ? `${assignmentContext.course_names.join(' / ')}存在${assignmentCandidates.length > 1 ? '多个同年级教师分工' : '课程分工，但缺少同年级唯一对应关系'}`
      : '',
    detected_grade: assignmentContext.sheet_grade,
    detected_course_ids: assignmentContext.course_ids,
    detected_course_names: assignmentContext.course_names,
  };
}

function isLegacyXls(buffer, filename) {
  const extension = path.extname(filename || '').toLocaleLowerCase();
  const isZip = buffer?.[0] === 0x50 && buffer?.[1] === 0x4b;
  return extension === '.xls' && !isZip;
}

async function convertLegacyXls(buffer) {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'timetable-template-'));
  try {
    const sourcePath = path.join(tempDir, 'template.xls');
    const profilePath = path.join(tempDir, 'libreoffice-profile');
    await fs.writeFile(sourcePath, buffer);
    const soffice = process.env.SOFFICE_PATH || 'soffice';
    try {
      await execFileAsync(soffice, [
        `-env:UserInstallation=${pathToFileURL(profilePath).href}`,
        '--headless',
        '--convert-to', 'xlsx',
        '--outdir', tempDir,
        sourcePath,
      ], { timeout: 45_000, maxBuffer: 2 * 1024 * 1024 });
    } catch (error) {
      throw new Error(`旧版 .xls 模板转换失败；请安装 LibreOffice，或先把模板另存为 .xlsx 后重试（${error.message}）`, { cause: error });
    }
    const convertedPath = path.join(tempDir, 'template.xlsx');
    return await fs.readFile(convertedPath);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

export async function loadTemplateWorkbook(buffer, filename) {
  if (!buffer?.length) throw new Error(`模板 ${filename || ''} 为空`);
  const source = isLegacyXls(buffer, filename) ? await convertLegacyXls(buffer) : buffer;
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(source);
  } catch (error) {
    throw new Error(`无法读取模板 ${filename || ''}：${error.message}`, { cause: error });
  }
  return workbook;
}

function analyzeClassWorkbook(workbook, state) {
  const mappedSheets = [];
  const ignoredSheets = [];
  for (const worksheet of workbook.worksheets) {
    const blocks = classSheetBlocks(worksheet);
    if (!blocks.length) {
      ignoredSheets.push(worksheet.name);
      continue;
    }
    const grade = blocks[0].grade;
    const classes = classesForGrade(state, grade);
    mappedSheets.push({
      sheet_name: worksheet.name,
      grade,
      classes: blocks.map(block => {
        const matchedClass = classes.find(item => classOrder(item) === block.templateClassNumber)
          || classes[block.templateClassNumber - 1];
        return {
          template_class_number: block.templateClassNumber,
          class_id: matchedClass?.id || null,
          class_name: matchedClass?.name || null,
          period_count: block.periodRows.size,
        };
      }),
    });
  }
  return {
    sheet_count: workbook.worksheets.length,
    mapped_sheets: mappedSheets,
    ignored_sheets: ignoredSheets,
    mapped_class_count: mappedSheets.flatMap(item => item.classes).filter(item => item.class_id).length,
  };
}

function analyzeTeacherWorkbook(workbook, state) {
  const mappings = workbook.worksheets.map(worksheet => {
    const mapping = matchTeacherWorksheet(worksheet, state.teachers || [], state);
    return { ...mapping, grid_detected: Boolean(worksheetGrid(worksheet)) };
  });
  return {
    sheet_count: workbook.worksheets.length,
    mappings,
    matched_count: mappings.filter(item => item.status === 'matched').length,
    course_matched_count: mappings.filter(item => item.match_method === 'course_assignment').length,
    suggested_count: mappings.filter(item => item.status === 'llm_suggested').length,
    unmatched_count: mappings.filter(item => item.status === 'unmatched' || item.status === 'ambiguous').length,
    resource_count: mappings.filter(item => item.status === 'resource').length,
  };
}

export function applyTeacherTemplateSuggestions(analysis, aiResult) {
  const suggestions = new Map((aiResult?.suggestions || []).map(item => [item.sheet_name, item]));
  const mappings = analysis.teacher_template.mappings.map(mapping => {
    const suggestion = suggestions.get(mapping.sheet_name);
    if (!suggestion) return mapping;
    const candidate = (mapping.ai_candidates || []).find(item => item.teacher_id === suggestion.teacher_id);
    if (!candidate || Number(suggestion.confidence) < 0.6) {
      return {
        ...mapping,
        ai_review: {
          reviewed: true,
          teacher_id: null,
          confidence: Number(suggestion.confidence) || 0,
          reason: suggestion.reason || '模型认为现有信息不足，保留人工选择',
        },
      };
    }
    return {
      ...mapping,
      status: 'llm_suggested',
      teacher_id: candidate.teacher_id,
      teacher_name: candidate.teacher_name,
      score: Math.round(Number(suggestion.confidence) * 100),
      candidates: mapping.ai_candidates,
      match_method: 'llm',
      match_reason: suggestion.reason,
      requires_confirmation: true,
      ai_review: {
        reviewed: true,
        teacher_id: candidate.teacher_id,
        confidence: Number(suggestion.confidence),
        reason: suggestion.reason,
      },
    };
  });
  const matchedCount = mappings.filter(item => item.status === 'matched').length;
  const suggestedCount = mappings.filter(item => item.status === 'llm_suggested').length;
  const unmatchedCount = mappings.filter(item => item.status === 'unmatched' || item.status === 'ambiguous').length;
  const warnings = (analysis.warnings || []).filter(item => !/张教师表无法唯一匹配/.test(item));
  if (suggestedCount) warnings.push(`${suggestedCount} 张教师表由模型给出候选，导出前仍需人工确认`);
  if (unmatchedCount) warnings.push(`${unmatchedCount} 张教师表仍无法唯一匹配，请在导出前人工选择`);
  return {
    ...analysis,
    teacher_template: {
      ...analysis.teacher_template,
      mappings,
      matched_count: matchedCount,
      course_matched_count: mappings.filter(item => item.match_method === 'course_assignment').length,
      suggested_count: suggestedCount,
      unmatched_count: unmatchedCount,
      ai_review: {
        attempted: true,
        model: aiResult?.model,
        reviewed_count: suggestions.size,
      },
    },
    warnings,
  };
}

export async function analyzeScheduleTemplates({
  classTemplateBuffer,
  classTemplateName,
  teacherTemplateBuffer,
  teacherTemplateName,
  state,
}) {
  const [classWorkbook, teacherWorkbook] = await Promise.all([
    loadTemplateWorkbook(classTemplateBuffer, classTemplateName),
    loadTemplateWorkbook(teacherTemplateBuffer, teacherTemplateName),
  ]);
  const classTemplate = analyzeClassWorkbook(classWorkbook, state);
  const teacherTemplate = analyzeTeacherWorkbook(teacherWorkbook, state);
  const warnings = [];
  if (classTemplate.mapped_sheets.length < 3) warnings.push('年级模板未完整识别 Senior1、Senior2、Senior3 三张课表');
  if (classTemplate.mapped_class_count < 9) warnings.push(`年级模板只匹配到 ${classTemplate.mapped_class_count}/9 个教学班`);
  if (teacherTemplate.unmatched_count) warnings.push(`${teacherTemplate.unmatched_count} 张教师表无法唯一匹配，请在导出前人工选择`);
  return {
    class_template: classTemplate,
    teacher_template: teacherTemplate,
    teachers: (state.teachers || []).map(item => ({ id: item.id, name: item.name })),
    warnings,
  };
}

function scheduleMeetings(state) {
  const sections = new Map((state.schedule?.sections || []).map(item => [item.id, item]));
  const meetings = new Map();
  for (const assignment of state.schedule?.assignments || []) {
    const match = /^D([1-5])P(10|[1-9])$/.exec(assignment.slot_id || '');
    if (!match) continue;
    const key = `${assignment.section_id}|${assignment.slot_id}`;
    if (meetings.has(key)) continue;
    const section = sections.get(assignment.section_id) || {};
    meetings.set(key, {
      ...assignment,
      ...section,
      teacher_id: assignment.teacher_id || section.teacher_id || null,
      room_id: assignment.room_id || section.room_id || null,
      day: Number(match[1]),
      period: Number(match[2]),
      slot_id: assignment.slot_id,
      section_id: assignment.section_id,
      student_ids: section.student_ids || [],
    });
  }
  return [...meetings.values()];
}

function scheduleLookups(state) {
  return {
    courses: new Map((state.courses || []).map(item => [item.id, item])),
    teachers: new Map((state.teachers || []).map(item => [item.id, item])),
    rooms: new Map((state.rooms || []).map(item => [item.id, item])),
    classes: new Map([...(state.admin_classes || []), ...(state.teaching_classes || [])].map(item => [item.id, item])),
  };
}

function courseName(meeting, lookups) {
  return lookups.courses.get(meeting.course_id)?.name || meeting.course_id || '未命名课程';
}

function teacherName(meeting, lookups) {
  return lookups.teachers.get(meeting.teacher_id)?.name || meeting.teacher_id || '';
}

function roomName(meeting, lookups) {
  return lookups.rooms.get(meeting.room_id)?.name || meeting.room_id || '';
}

function classCellText(meetings, lookups) {
  if (!meetings.length) return '';
  const unique = [];
  const seen = new Set();
  for (const meeting of meetings) {
    const course = courseName(meeting, lookups);
    const teacher = teacherName(meeting, lookups);
    const key = `${course}|${teacher}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push({ course, teacher, room: roomName(meeting, lookups) });
  }
  if (unique.length === 1) {
    return [unique[0].course, unique[0].teacher, unique[0].room].filter(Boolean).join('\n');
  }
  return unique.map(item => `${item.course}${item.teacher ? ` · ${item.teacher}` : ''}`).join('\n');
}

function teacherCellText(meetings, lookups) {
  const lines = [];
  const seen = new Set();
  for (const meeting of meetings) {
    const course = courseName(meeting, lookups);
    const audience = lookups.classes.get(meeting.class_id)?.name
      || meeting.ap_block_name
      || meeting.ap_block_id
      || meeting.class_id
      || '';
    const room = roomName(meeting, lookups);
    const text = [course, audience, room].filter(Boolean).join('\n');
    if (seen.has(text)) continue;
    seen.add(text);
    lines.push(text);
  }
  return lines.join('\n');
}

function setTimetableCell(cell, value) {
  cell.value = value || null;
  cell.alignment = {
    ...(cell.alignment || {}),
    horizontal: 'center',
    vertical: 'middle',
    wrapText: true,
    shrinkToFit: true,
  };
  const lineCount = value ? String(value).split('\n').length : 0;
  const compactFontSize = lineCount >= 9 ? 7
    : lineCount >= 7 ? 8
      : lineCount >= 5 ? 9
        : lineCount >= 4 ? 10
          : null;
  if (!compactFontSize) return;

  const currentFontSize = Number(cell.font?.size) || 12;
  const fontSize = Math.min(currentFontSize, compactFontSize);
  cell.font = { ...(cell.font || {}), size: fontSize };

  const row = cell.worksheet.getRow(cell.row);
  const currentHeight = Number(row.height)
    || Number(cell.worksheet.properties.defaultRowHeight)
    || 15;
  const minimumHeight = 8 + lineCount * (fontSize + 3);
  row.height = Math.max(currentHeight, minimumHeight);
}

function fillClassWorkbook(workbook, state, meetings, lookups) {
  let filledCells = 0;
  const warnings = [];
  for (const worksheet of workbook.worksheets) {
    const blocks = classSheetBlocks(worksheet);
    if (!blocks.length) continue;
    const gradeClasses = classesForGrade(state, blocks[0].grade);
    for (const block of blocks) {
      const targetClass = gradeClasses.find(item => classOrder(item) === block.templateClassNumber)
        || gradeClasses[block.templateClassNumber - 1];
      if (!targetClass) {
        warnings.push(`${worksheet.name} 的 Class ${block.templateClassNumber} 未匹配到系统教学班`);
        continue;
      }
      const studentIds = new Set(targetClass.student_ids?.length
        ? targetClass.student_ids
        : (state.students || []).filter(item => item.teaching_class_id === targetClass.id).map(item => item.id));
      const classMeetings = meetings.filter(meeting => meeting.class_id === targetClass.id
        || (meeting.student_ids || []).some(studentId => studentIds.has(studentId)));
      for (const { day, column } of block.dayColumns) {
        for (const [period, row] of block.periodRows.entries()) {
          const atSlot = classMeetings.filter(item => item.day === day && item.period === period);
          const text = classCellText(atSlot, lookups);
          setTimetableCell(worksheet.getCell(row, column), text);
          if (text) filledCells += 1;
        }
      }
    }
  }
  return { filled_cells: filledCells, warnings };
}

function resolvedTeacherId(mapping, overrides, teachers) {
  const override = overrides?.[mapping.sheet_name];
  if (override === '__skip__' || override === '') return null;
  if (override) return teachers.some(item => item.id === override) ? override : null;
  return mapping.teacher_id || null;
}

function safeTeacherWorksheetName(workbook, teacher, currentWorksheet = null) {
  const fallback = compactText(teacher?.id) || '未命名教师';
  const base = (compactText(teacher?.name) || fallback)
    .replace(/[\\/*?:[\]]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 31) || '未命名教师';
  const nameIsAvailable = candidate => {
    const existing = workbook.getWorksheet(candidate);
    return !existing || existing.id === currentWorksheet?.id;
  };
  if (nameIsAvailable(base)) return base;
  for (let sequence = 2; sequence < 1_000; sequence += 1) {
    const suffix = ` ${sequence}`;
    const candidate = `${base.slice(0, 31 - suffix.length)}${suffix}`;
    if (nameIsAvailable(candidate)) return candidate;
  }
  throw new Error(`无法为教师 ${teacher?.name || teacher?.id || ''} 生成唯一工作表名称`);
}

function relabelTeacherWorksheet(workbook, worksheet, teacher) {
  const currentName = compactText(teacher?.name) || compactText(teacher?.id);
  if (!currentName) return false;
  let changed = false;
  if (!normalizedIdentity(worksheet.name).includes(normalizedIdentity(currentName))) {
    worksheet.name = safeTeacherWorksheetName(workbook, teacher, worksheet);
    changed = true;
  }
  for (let rowNumber = 1; rowNumber <= Math.min(worksheet.rowCount, 5); rowNumber += 1) {
    const hasTeacherLabel = Array.from({ length: worksheet.columnCount }, (_, index) => (
      compactText(worksheet.getCell(rowNumber, index + 1).value)
    )).some(value => /^(teacher|教师)$/i.test(value));
    if (!hasTeacherLabel) continue;
    for (let columnNumber = 1; columnNumber <= worksheet.columnCount; columnNumber += 1) {
      const cell = worksheet.getCell(rowNumber, columnNumber);
      const value = compactText(cell.value);
      if (!value || /^(teacher|教师)$/i.test(value) || value === currentName) continue;
      cell.value = currentName;
      changed = true;
    }
  }
  return changed;
}

function cloneWorksheetValue(value) {
  return value == null ? value : structuredClone(value);
}

function captureTeacherWorksheetTemplate(worksheet) {
  const rows = [];
  for (let rowNumber = 1; rowNumber <= worksheet.rowCount; rowNumber += 1) {
    const sourceRow = worksheet.getRow(rowNumber);
    const cells = [];
    for (let columnNumber = 1; columnNumber <= worksheet.columnCount; columnNumber += 1) {
      const sourceCell = sourceRow.getCell(columnNumber);
      const isMergedChild = sourceCell.isMerged && sourceCell.master.address !== sourceCell.address;
      cells.push({
        value: isMergedChild ? undefined : cloneWorksheetValue(sourceCell.value),
        style: cloneWorksheetValue(sourceCell.style),
        note: cloneWorksheetValue(sourceCell.note),
        dataValidation: cloneWorksheetValue(sourceCell.dataValidation),
      });
    }
    rows.push({
      height: sourceRow.height,
      hidden: sourceRow.hidden,
      outlineLevel: sourceRow.outlineLevel,
      style: cloneWorksheetValue(sourceRow.style),
      cells,
    });
  }
  const columns = Array.from({ length: worksheet.columnCount }, (_, index) => {
    const sourceColumn = worksheet.getColumn(index + 1);
    return {
      width: sourceColumn.width,
      hidden: sourceColumn.hidden,
      outlineLevel: sourceColumn.outlineLevel,
      style: cloneWorksheetValue(sourceColumn.style),
    };
  });
  return {
    properties: cloneWorksheetValue(worksheet.properties),
    pageSetup: cloneWorksheetValue(worksheet.pageSetup),
    views: cloneWorksheetValue(worksheet.views),
    headerFooter: cloneWorksheetValue(worksheet.headerFooter),
    autoFilter: cloneWorksheetValue(worksheet.autoFilter),
    merges: [...(worksheet.model.merges || [])],
    rows,
    columns,
  };
}

function createGeneratedTeacherWorksheet(workbook, teacher, template) {
  if (!template) throw new Error('教师模板中没有可复用的教师课表页，无法为缺失教师补充同样式课表');
  const worksheet = workbook.addWorksheet(safeTeacherWorksheetName(workbook, teacher), {
    properties: cloneWorksheetValue(template.properties),
    pageSetup: cloneWorksheetValue(template.pageSetup),
    views: cloneWorksheetValue(template.views),
    headerFooter: cloneWorksheetValue(template.headerFooter),
  });
  template.columns.forEach((sourceColumn, index) => {
    const targetColumn = worksheet.getColumn(index + 1);
    if (sourceColumn.width != null) targetColumn.width = sourceColumn.width;
    targetColumn.hidden = sourceColumn.hidden;
    targetColumn.outlineLevel = sourceColumn.outlineLevel;
    targetColumn.style = cloneWorksheetValue(sourceColumn.style) || {};
  });
  template.rows.forEach((sourceRow, rowIndex) => {
    const targetRow = worksheet.getRow(rowIndex + 1);
    if (sourceRow.height != null) targetRow.height = sourceRow.height;
    targetRow.hidden = sourceRow.hidden;
    targetRow.outlineLevel = sourceRow.outlineLevel;
    targetRow.style = cloneWorksheetValue(sourceRow.style) || {};
    sourceRow.cells.forEach((sourceCell, columnIndex) => {
      const targetCell = targetRow.getCell(columnIndex + 1);
      if (sourceCell.value !== undefined) targetCell.value = cloneWorksheetValue(sourceCell.value);
      targetCell.style = cloneWorksheetValue(sourceCell.style) || {};
      if (sourceCell.note != null) targetCell.note = cloneWorksheetValue(sourceCell.note);
      if (sourceCell.dataValidation != null) {
        targetCell.dataValidation = cloneWorksheetValue(sourceCell.dataValidation);
      }
    });
  });
  for (const range of template.merges) worksheet.mergeCells(range);
  if (template.autoFilter) worksheet.autoFilter = cloneWorksheetValue(template.autoFilter);
  relabelTeacherWorksheet(workbook, worksheet, teacher);
  return worksheet;
}

function fillOneTeacherWorksheet(worksheet, teacherId, meetings, lookups) {
  const grid = worksheetGrid(worksheet);
  if (!grid) return 0;
  const teacherMeetings = meetings.filter(item => item.teacher_id === teacherId);
  let filledCells = 0;
  for (const { day, column } of grid.dayColumns) {
    for (const [period, row] of grid.periodRows.entries()) {
      const value = teacherCellText(
        teacherMeetings.filter(item => item.day === day && item.period === period),
        lookups,
      );
      setTimetableCell(worksheet.getCell(row, column), value);
      if (value) filledCells += 1;
    }
  }
  return filledCells;
}

function fillTeacherWorkbook(workbook, state, meetings, lookups, teacherMappings = {}) {
  let filledCells = 0;
  const warnings = [];
  const mappings = analyzeTeacherWorkbook(workbook, state).mappings;
  const styleSource = mappings
    .map(mapping => ({ mapping, worksheet: workbook.getWorksheet(mapping.sheet_name) }))
    .find(item => item.worksheet && item.mapping.status === 'matched' && worksheetGrid(item.worksheet))
    || mappings
      .map(mapping => ({ mapping, worksheet: workbook.getWorksheet(mapping.sheet_name) }))
      .find(item => item.worksheet && item.mapping.status !== 'resource' && worksheetGrid(item.worksheet));
  const teacherWorksheetTemplate = styleSource
    ? captureTeacherWorksheetTemplate(styleSource.worksheet)
    : null;
  const teachersById = new Map((state.teachers || []).map(teacher => [teacher.id, teacher]));
  const exportedTeacherIds = new Set();
  const omittedWorksheetIds = [];
  for (const mapping of mappings) {
    const worksheet = workbook.getWorksheet(mapping.sheet_name);
    const grid = worksheet && worksheetGrid(worksheet);
    if (!worksheet || !grid || mapping.status === 'resource') continue;
    const teacherId = resolvedTeacherId(mapping, teacherMappings, state.teachers || []);
    if (!teacherId) {
      warnings.push(`${mapping.sheet_name} 未匹配现任教师，已从“全部教师课表”中省略`);
      omittedWorksheetIds.push(worksheet.id);
      continue;
    }
    if (exportedTeacherIds.has(teacherId)) {
      warnings.push(`${mapping.sheet_name} 与另一张教师表重复，已省略重复页`);
      omittedWorksheetIds.push(worksheet.id);
      continue;
    }
    const teacher = teachersById.get(teacherId);
    if (teacher && relabelTeacherWorksheet(workbook, worksheet, teacher)) {
      warnings.push(`${mapping.sheet_name} 已更新为现任教师“${teacher.name || teacher.id}”`);
    }
    exportedTeacherIds.add(teacherId);
    filledCells += fillOneTeacherWorksheet(worksheet, teacherId, meetings, lookups);
  }
  for (const worksheetId of omittedWorksheetIds) workbook.removeWorksheet(worksheetId);

  let generatedSheets = 0;
  for (const teacher of state.teachers || []) {
    if (exportedTeacherIds.has(teacher.id)) continue;
    const worksheet = createGeneratedTeacherWorksheet(workbook, teacher, teacherWorksheetTemplate);
    filledCells += fillOneTeacherWorksheet(worksheet, teacher.id, meetings, lookups);
    exportedTeacherIds.add(teacher.id);
    generatedSheets += 1;
  }
  if (generatedSheets) warnings.push(`模板缺少的 ${generatedSheets} 位现任教师已按学校模板样式补充课表页`);
  return {
    filled_cells: filledCells,
    warnings,
    mappings,
    generated_sheets: generatedSheets,
    exported_teacher_count: exportedTeacherIds.size,
  };
}

const ENGLISH_MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

function updateTeacherEffectiveDates(workbook, now) {
  const dateLabel = `${ENGLISH_MONTH_NAMES[now.getMonth()]} ${now.getDate()},${now.getFullYear()}`;
  const note = `Notes:This schedule  will be  in effect  from ${dateLabel}.`;
  for (const worksheet of workbook.worksheets) {
    for (let column = 1; column <= Math.max(worksheet.columnCount, 1); column += 1) {
      const cell = worksheet.getCell(1, column);
      if (!/^Notes:\s*This schedule\s+will be\s+in effect\s+from\b/i.test(compactText(cell.value))) continue;
      const target = cell.isMerged ? cell.master : cell;
      target.value = note;
      break;
    }
  }
}

function safeDateStamp(now = new Date()) {
  const pad = value => String(value).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export async function exportScheduleTemplates({
  classTemplateBuffer,
  classTemplateName,
  teacherTemplateBuffer,
  teacherTemplateName,
  teacherMappings,
  state,
  now = new Date(),
}) {
  if (!state.schedule || state.solve_status !== 'valid') throw new Error('当前没有有效课表，请先完成排课再导出模板文件');
  const [classWorkbook, teacherWorkbook] = await Promise.all([
    loadTemplateWorkbook(classTemplateBuffer, classTemplateName),
    loadTemplateWorkbook(teacherTemplateBuffer, teacherTemplateName),
  ]);
  const meetings = scheduleMeetings(state);
  const lookups = scheduleLookups(state);
  const classResult = fillClassWorkbook(classWorkbook, state, meetings, lookups);
  const teacherResult = fillTeacherWorkbook(teacherWorkbook, state, meetings, lookups, teacherMappings);
  updateTeacherEffectiveDates(teacherWorkbook, now);
  const [classBuffer, teacherBuffer] = await Promise.all([
    classWorkbook.xlsx.writeBuffer(),
    teacherWorkbook.xlsx.writeBuffer(),
  ]);
  const dateStamp = safeDateStamp(now);
  return {
    files: [
      {
        kind: 'class',
        filename: `三个年级课表_${dateStamp}.xlsx`,
        mime_type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        buffer: Buffer.from(classBuffer),
      },
      {
        kind: 'teacher',
        filename: `全部教师课表_${dateStamp}.xlsx`,
        mime_type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        buffer: Buffer.from(teacherBuffer),
      },
    ],
    summary: {
      class_filled_cells: classResult.filled_cells,
      teacher_filled_cells: teacherResult.filled_cells,
      teacher_sheet_count: teacherResult.exported_teacher_count,
      generated_teacher_sheets: teacherResult.generated_sheets,
      warnings: [...classResult.warnings, ...teacherResult.warnings],
    },
  };
}
