import * as XLSX from 'xlsx';

function text(value) {
  return String(value ?? '').trim();
}

function normalizedName(value) {
  return text(value)
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9\u3400-\u9fff]+/g, '');
}

function gradeFromHeader(value) {
  const normalized = normalizedName(value);
  if (normalized === '高一' || normalized === 'senior1' || normalized === 'grade10') return 10;
  if (normalized === '高二' || normalized === 'senior2' || normalized === 'grade11') return 11;
  if (normalized === '高三' || normalized === 'senior3' || normalized === 'grade12') return 12;
  return null;
}

function courseGrades(course) {
  const values = Array.isArray(course?.grade) ? course.grade : [course?.grade];
  return values.map(Number).filter(Number.isInteger);
}

function aliasKeys(value) {
  const normalized = normalizedName(value);
  const aliases = new Set();
  if (/(?:listeningandspeaking.*literaturereading|l(?:and)?s(?:and)?litreading)/.test(normalized)) aliases.add('ENGLISH_LISTENING_LITERATURE');
  if (/ap(?:languageandcomposition|lc(?:class\d+)?|lang)/.test(normalized)) aliases.add('AP_LANGUAGE_COMPOSITION');
  if (/honor(?:languageandcomposition|lc)/.test(normalized)) aliases.add('HONOR_LANGUAGE_COMPOSITION');
  if (/ap(?:literatureandcomposition|lit)/.test(normalized)) aliases.add('AP_LITERATURE_COMPOSITION');
  if (/preapbiology|prebiology/.test(normalized)) aliases.add('PRE_AP_BIOLOGY');
  if (/preapchemistry|prechemistry/.test(normalized)) aliases.add('PRE_AP_CHEMISTRY');
  if (normalized.includes('precalculus')) aliases.add('PRECALCULUS');
  if (normalized === 'apart' || normalized.includes('aparthistory')) aliases.add('AP_ART');
  if (normalized === '综英' || normalized.includes('comprehensiveenglish')) aliases.add('COMPREHENSIVE_ENGLISH');
  if (normalized === '数学' || normalized.includes('中方数学')) aliases.add('CHINESE_MATHEMATICS');
  if (normalized === '化学' || normalized.includes('中方化学')) aliases.add('CHINESE_CHEMISTRY');
  if (normalized === '物理' || normalized.includes('中方物理')) aliases.add('CHINESE_PHYSICS');
  if (normalized === '力学' || normalized.includes('力学基础')) aliases.add('MECHANICS');
  return aliases;
}

function matchingCourse(courses, grade, subjectName) {
  const subject = normalizedName(subjectName);
  const subjectAliases = aliasKeys(subjectName);
  const candidates = (courses || []).filter(course => {
    const grades = courseGrades(course);
    return !grades.length || grades.includes(grade);
  });
  const scored = candidates.map(course => {
    const courseName = normalizedName(course.name || course.id);
    const courseId = normalizedName(course.id);
    let score = courseName === subject || courseId === subject ? 100 : 0;
    const courseAliases = new Set([...aliasKeys(course.name), ...aliasKeys(course.id)]);
    if (!score && [...subjectAliases].some(alias => courseAliases.has(alias))) score = 90;
    if (!score && subject.length >= 4 && (courseName.includes(subject) || subject.includes(courseName))) score = 80;
    return { course, score };
  }).filter(item => item.score > 0).sort((left, right) => right.score - left.score);
  if (!scored.length || scored.filter(item => item.score === scored[0].score).length > 1) return null;
  return scored[0].course;
}

function durationMinutes(value) {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return Math.round(value <= 4 ? value * 60 : value);
  }
  const normalized = text(value).toLowerCase().replace(/\s+/g, '');
  if (!normalized || /^(?:na|n\/a|none|无|不考|no)$/.test(normalized)) return null;
  const hours = /^(\d+(?:\.\d+)?)(?:h|hr|hrs|hour|hours|小时)$/.exec(normalized);
  if (hours) return Math.round(Number(hours[1]) * 60);
  const minutes = /^(\d+(?:\.\d+)?)(?:m|min|mins|minute|minutes|分钟)$/.exec(normalized);
  if (minutes) return Math.round(Number(minutes[1]));
  return null;
}

function sheetLayout(workbook) {
  for (const sheetName of workbook.SheetNames || []) {
    const matrix = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, defval: '' });
    for (let rowIndex = 0; rowIndex < matrix.length; rowIndex += 1) {
      const gradeColumns = matrix[rowIndex]
        .map((value, columnIndex) => ({ grade: gradeFromHeader(value), columnIndex }))
        .filter(item => item.grade);
      if (gradeColumns.length >= 2) return { sheetName, matrix, headerRowIndex: rowIndex, gradeColumns };
    }
  }
  throw new Error('没有找到包含高一、高二、高三栏目​​的考试时长表');
}

export function parseExamDurationBuffer(buffer, state = {}, filename = '') {
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  const layout = sheetLayout(workbook);
  const rows = [];
  const skippedRows = [];
  for (let rowIndex = layout.headerRowIndex + 1; rowIndex < layout.matrix.length; rowIndex += 1) {
    for (const { grade, columnIndex } of layout.gradeColumns) {
      const subjectName = text(layout.matrix[rowIndex]?.[columnIndex]);
      if (!subjectName) continue;
      const sourceDuration = layout.matrix[rowIndex]?.[columnIndex + 1];
      const minutes = durationMinutes(sourceDuration);
      if (!minutes) {
        skippedRows.push({ grade, subject_name: subjectName, source_duration: text(sourceDuration), source_row: rowIndex + 1 });
        continue;
      }
      const course = matchingCourse(state.courses, grade, subjectName);
      rows.push({
        grade,
        subject_name: subjectName,
        source_duration: text(sourceDuration),
        duration_minutes: minutes,
        source_row: rowIndex + 1,
        course_id: course?.id || null,
        match_status: course ? 'matched' : 'unmatched',
      });
    }
  }
  return {
    source_filename: text(filename),
    source_sheet: layout.sheetName,
    rows,
    skipped_rows: skippedRows,
    summary: {
      exam_count: rows.length,
      matched_count: rows.filter(row => row.course_id).length,
      unmatched_count: rows.filter(row => !row.course_id).length,
      skipped_count: skippedRows.length,
    },
  };
}
