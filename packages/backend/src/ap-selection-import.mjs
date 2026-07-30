import * as XLSX from 'xlsx';

function text(value) {
  return String(value ?? '').trim();
}

function compact(value) {
  return text(value).normalize('NFKC').toLowerCase().replace(/[\s()（）._\-/\\&]+/g, '');
}

function personKey(value) {
  return text(value).normalize('NFKC').toLowerCase().replace(/[^a-z0-9\u3400-\u9fff]/g, '');
}

function courseKey(value) {
  let key = compact(value)
    .replace(/\d+$/, '')
    .replace(/^advancedplacement/, '')
    .replace(/^ap/, '')
    .replace(/enviromental/g, 'environmental')
    .replace(/psycholoy/g, 'psychology');
  const aliases = {
    es: 'environmentalscience',
    envscience: 'environmentalscience',
    environmentalstudies: 'environmentalscience',
    cs: 'computerscience',
    computersci: 'computerscience',
    psych: 'psychology',
    macro: 'macroeconomics',
    micro: 'microeconomics',
    art: 'arthistory',
    physicscmechanics: 'physicsc',
  };
  return aliases[key] || key;
}

function findRosterHeader(matrix) {
  for (let rowIndex = 0; rowIndex < Math.min(matrix.length, 20); rowIndex++) {
    const headers = (matrix[rowIndex] || []).map(compact);
    const find = candidates => headers.findIndex(header => candidates.includes(header));
    const columns = {
      chineseName: find(['namechinese', '姓名', '中文名', '中文姓名']),
      pinyinName: find(['namepinyin', '拼音', '姓名拼音']),
      englishName: find(['englishname', '英文名', '英文姓名']),
    };
    if (columns.chineseName >= 0) return { rowIndex, columns };
  }
  return undefined;
}

function sheetTitle(matrix, sheetName, headerRowIndex) {
  const candidates = matrix.slice(0, Math.max(1, headerRowIndex)).flat().map(text).filter(Boolean);
  return candidates.find(value => /\bAP\b/i.test(value))
    || (/\bAP\b/i.test(sheetName) ? text(sheetName).replace(/\s+\d+\s*$/, '') : '');
}

function courseForTitle(title, courses) {
  const key = courseKey(title);
  if (!key) return undefined;
  const apCourses = courses.filter(course => course.type === 'ap');
  const exact = apCourses.filter(course => courseKey(course.name) === key || courseKey(course.id) === key);
  if (exact.length === 1) return exact[0];
  const contains = apCourses.filter(course => {
    const candidate = courseKey(course.name);
    return candidate && (candidate.includes(key) || key.includes(candidate));
  });
  return contains.length === 1 ? contains[0] : undefined;
}

function matchStudent(row, students) {
  const chineseKey = personKey(row.chinese_name);
  const englishKey = personKey(row.english_name);
  const pinyinKey = personKey(row.pinyin_name);
  let candidates = chineseKey ? students.filter(student => personKey(student.name) === chineseKey) : [];
  if (candidates.length === 1) return { status: 'matched', student: candidates[0], matched_by: '中文名' };
  if (candidates.length > 1) {
    if (englishKey) candidates = candidates.filter(student => personKey(student.english_name) === englishKey);
    if (candidates.length > 1 && pinyinKey) candidates = candidates.filter(student => personKey(student.pinyin_name) === pinyinKey);
    if (candidates.length === 1) return { status: 'matched', student: candidates[0], matched_by: '中文名+英文名/拼音' };
    return { status: 'ambiguous', candidates };
  }

  if (englishKey && pinyinKey) {
    candidates = students.filter(student =>
      personKey(student.english_name) === englishKey && personKey(student.pinyin_name) === pinyinKey);
    if (candidates.length === 1) return { status: 'matched', student: candidates[0], matched_by: '英文名+拼音' };
    if (candidates.length > 1) return { status: 'ambiguous', candidates };
  }
  return { status: 'unmatched', candidates: [] };
}

export function parseApSelectionWorkbook(workbook, state, filename = '') {
  const students = state.students || [];
  const courses = state.courses || [];
  const courseOrder = new Map(courses.map((course, index) => [course.id, index]));
  const selectedByStudent = new Map();
  const sheets = [];
  const unmatched = [];
  const ambiguous = [];
  const unmappedCourseSheets = [];
  const ignoredSheets = [];
  let matchedRows = 0;

  for (const sheetName of workbook.SheetNames) {
    const matrix = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, defval: '' });
    const header = findRosterHeader(matrix);
    if (!header) {
      ignoredSheets.push({ sheet_name: sheetName, reason: '未找到中文姓名表头' });
      continue;
    }
    const title = sheetTitle(matrix, sheetName, header.rowIndex);
    const course = courseForTitle(title, courses);
    if (!course) {
      const issue = { sheet_name: sheetName, title: title || '未识别', reason: '标题无法对应系统 AP 课程' };
      unmappedCourseSheets.push(issue);
      sheets.push({ ...issue, status: 'unmapped', rows: 0, matched: 0, unmatched: 0, ambiguous: 0 });
      continue;
    }

    const rows = [];
    for (let rowIndex = header.rowIndex + 1; rowIndex < matrix.length; rowIndex++) {
      const values = matrix[rowIndex] || [];
      const chineseName = text(values[header.columns.chineseName]);
      if (!chineseName) continue;
      rows.push({
        sheet_name: sheetName,
        excel_row: rowIndex + 1,
        course_id: course.id,
        course_name: course.name,
        chinese_name: chineseName,
        pinyin_name: header.columns.pinyinName >= 0 ? text(values[header.columns.pinyinName]) : '',
        english_name: header.columns.englishName >= 0 ? text(values[header.columns.englishName]) : '',
      });
    }

    let sheetMatched = 0;
    let sheetUnmatched = 0;
    let sheetAmbiguous = 0;
    for (const row of rows) {
      const match = matchStudent(row, students);
      if (match.status === 'matched') {
        sheetMatched++;
        matchedRows++;
        if (!selectedByStudent.has(match.student.id)) selectedByStudent.set(match.student.id, new Set());
        selectedByStudent.get(match.student.id).add(course.id);
      } else if (match.status === 'ambiguous') {
        sheetAmbiguous++;
        ambiguous.push({ ...row, candidate_ids: match.candidates.map(student => student.id) });
      } else {
        sheetUnmatched++;
        unmatched.push(row);
      }
    }
    sheets.push({
      sheet_name: sheetName,
      title,
      course_id: course.id,
      course_name: course.name,
      status: 'recognized',
      rows: rows.length,
      matched: sheetMatched,
      unmatched: sheetUnmatched,
      ambiguous: sheetAmbiguous,
    });
  }

  const courseNameById = new Map(courses.map(course => [course.id, course.name]));
  const changes = [...selectedByStudent.entries()].map(([studentId, selected]) => {
    const student = students.find(item => item.id === studentId);
    const previous = [...(student.ap_courses || [])];
    const next = [...selected].sort((left, right) => (courseOrder.get(left) ?? 9999) - (courseOrder.get(right) ?? 9999));
    return {
      student_id: studentId,
      student_name: student.name,
      english_name: student.english_name || '',
      previous_course_ids: previous,
      previous_course_names: previous.map(id => courseNameById.get(id) || id),
      course_ids: next,
      course_names: next.map(id => courseNameById.get(id) || id),
      added_course_ids: next.filter(id => !previous.includes(id)),
      removed_course_ids: previous.filter(id => !next.includes(id)),
    };
  }).sort((left, right) => left.student_id.localeCompare(right.student_id, 'zh-CN', { numeric: true }));

  const recognizedSheets = sheets.filter(sheet => sheet.status === 'recognized');
  const issueCount = unmatched.length + ambiguous.length + unmappedCourseSheets.length;
  return {
    filename,
    total_sheets: workbook.SheetNames.length,
    recognized_sheet_count: recognizedSheets.length,
    ignored_sheets: ignoredSheets,
    sheets,
    matched_rows: matchedRows,
    unique_students: changes.length,
    unmatched,
    ambiguous,
    unmapped_course_sheets: unmappedCourseSheets,
    issue_count: issueCount,
    can_confirm: recognizedSheets.length > 0 && changes.length > 0 && issueCount === 0,
    changes,
  };
}

export function parseApSelectionBuffer(buffer, state, filename = '') {
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  return parseApSelectionWorkbook(workbook, state, filename);
}

export function applyApSelectionChanges(state, changes, mode = 'replace') {
  if (!Array.isArray(changes) || changes.length === 0) throw new Error('没有可更新的 AP 选课数据');
  if (!['replace', 'merge'].includes(mode)) throw new Error('导入模式必须是 replace 或 merge');
  const apCourseIds = new Set((state.courses || []).filter(course => course.type === 'ap').map(course => course.id));
  const changeByStudent = new Map();
  for (const change of changes) {
    if (!change?.student_id || !Array.isArray(change.course_ids)) throw new Error('AP 选课变更数据不完整');
    if (changeByStudent.has(change.student_id)) throw new Error(`学生 ${change.student_id} 在导入数据中重复`);
    const unique = [...new Set(change.course_ids)];
    for (const courseId of unique) if (!apCourseIds.has(courseId)) throw new Error(`${courseId} 不是系统中的 AP 课程`);
    changeByStudent.set(change.student_id, unique);
  }
  let updated = 0;
  const students = (state.students || []).map(student => {
    const imported = changeByStudent.get(student.id);
    if (!imported) return student;
    updated++;
    const courseIds = mode === 'merge' ? [...new Set([...(student.ap_courses || []), ...imported])] : imported;
    return { ...student, ap_courses: courseIds };
  });
  const missing = [...changeByStudent.keys()].filter(id => !students.some(student => student.id === id));
  if (missing.length) throw new Error(`找不到学生: ${missing.join(', ')}`);
  return { students, updated, mode };
}
