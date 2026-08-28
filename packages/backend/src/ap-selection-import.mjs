import * as XLSX from 'xlsx';
import { apBlockConfigForState } from './ap-block-sectioning.mjs';

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
    生物: 'biology',
    化学: 'chemistry',
    心理: 'psychology',
    环科: 'environmentalscience',
    环境科学: 'environmentalscience',
    宏经: 'macroeconomics',
    微经: 'microeconomics',
    艺术史: 'arthistory',
    物理c: 'physicsc',
    物理2: 'physics2',
  };
  return aliases[key] || key;
}

function courseAppliesToStudentGrade(course, grade) {
  const grades = (Array.isArray(course?.grade) ? course.grade : [course?.grade])
    .map(Number)
    .filter(Number.isFinite);
  return !grades.length || grades.includes(Number(grade));
}

function blockIdForRoster(matrix, headerRowIndex, chineseNameColumn) {
  const startColumn = Math.max(0, chineseNameColumn - 2);
  const endColumn = chineseNameColumn + 2;
  for (let rowIndex = headerRowIndex - 1; rowIndex >= 0; rowIndex -= 1) {
    for (let column = startColumn; column <= endColumn; column += 1) {
      const match = /\bblock\s*([1-6])\b/i.exec(text(matrix[rowIndex]?.[column]));
      if (match) return `AP_BLOCK_${match[1]}`;
    }
  }
  return null;
}

function findRosterHeaders(matrix) {
  for (let rowIndex = 0; rowIndex < Math.min(matrix.length, 20); rowIndex++) {
    const headers = (matrix[rowIndex] || []).map(compact);
    const chineseNameColumns = headers
      .map((header, index) => ['namechinese', '姓名', '中文名', '中文姓名'].includes(header) ? index : -1)
      .filter(index => index >= 0);
    if (!chineseNameColumns.length) continue;
    return chineseNameColumns.map(chineseName => {
      const localColumn = candidates => headers.findIndex((header, index) =>
        index > chineseName && index <= chineseName + 3 && candidates.includes(header));
      return {
        rowIndex,
        blockId: blockIdForRoster(matrix, rowIndex, chineseName),
        columns: {
          chineseName,
          pinyinName: localColumn(['namepinyin', '拼音', '姓名拼音']),
          englishName: localColumn(['englishname', '英文名', '英文姓名']),
        },
      };
    });
  }
  return [];
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

function blockIdForCourseColumn(matrix, titleRowIndex, column) {
  for (let rowIndex = titleRowIndex - 1; rowIndex >= 0; rowIndex--) {
    let nearest = null;
    for (let candidateColumn = 0; candidateColumn <= column; candidateColumn++) {
      const match = /\bblock\s*([1-6])\b/i.exec(text(matrix[rowIndex]?.[candidateColumn]));
      if (match) nearest = `AP_BLOCK_${match[1]}`;
    }
    if (nearest) return nearest;
  }
  return null;
}

function headerlessRosterGroups(matrix, sheetName, courses, students) {
  const groups = [];
  const usedColumns = new Set();
  const knownStudentNames = new Set(students.map(student => personKey(student.name)).filter(Boolean));
  for (let rowIndex = 0; rowIndex < Math.min(matrix.length, 10); rowIndex++) {
    const values = matrix[rowIndex] || [];
    for (let column = 0; column < values.length; column++) {
      const title = text(values[column]);
      const course = title ? courseForTitle(title, courses) : undefined;
      if (!course || usedColumns.has(column)) continue;
      const rows = [];
      for (let studentRowIndex = rowIndex + 1; studentRowIndex < matrix.length; studentRowIndex++) {
        const chineseName = text(matrix[studentRowIndex]?.[column]);
        const normalizedName = personKey(chineseName);
        if (!chineseName || /^\d+(?:\.0+)?$/.test(chineseName)) continue;
        if (courseForTitle(chineseName, courses)) continue;
        if (!knownStudentNames.has(normalizedName)
          && !/^[\u3400-\u9fff·]{2,8}$/.test(chineseName)) continue;
        rows.push({
          sheet_name: sheetName,
          excel_row: studentRowIndex + 1,
          course_id: course.id,
          course_name: course.name,
          block_id: blockIdForCourseColumn(matrix, rowIndex, column),
          chinese_name: chineseName,
          pinyin_name: '',
          english_name: '',
        });
      }
      if (rows.length) {
        groups.push({ title, course, rows });
        usedColumns.add(column);
      }
    }
  }
  return groups;
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
  const blockAssignmentsByStudent = new Map();
  const sheets = [];
  const unmatched = [];
  const ambiguous = [];
  const gradeMismatches = [];
  const unmappedCourseSheets = [];
  const ignoredSheets = [];
  let matchedRows = 0;

  for (const sheetName of workbook.SheetNames) {
    const matrix = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, defval: '' });
    const headers = findRosterHeaders(matrix);
    let rosterGroups;
    if (headers.length) {
      const title = sheetTitle(matrix, sheetName, headers[0].rowIndex);
      const course = courseForTitle(title, courses);
      if (!course) {
        const issue = { sheet_name: sheetName, title: title || '未识别', reason: '标题无法对应系统 AP 课程' };
        unmappedCourseSheets.push(issue);
        sheets.push({ ...issue, status: 'unmapped', rows: 0, matched: 0, unmatched: 0, ambiguous: 0 });
        continue;
      }
      const rows = headers.flatMap(header => {
        const rosterRows = [];
        for (let rowIndex = header.rowIndex + 1; rowIndex < matrix.length; rowIndex++) {
          const values = matrix[rowIndex] || [];
          const chineseName = text(values[header.columns.chineseName]);
          if (!chineseName) continue;
          rosterRows.push({
            sheet_name: sheetName,
            excel_row: rowIndex + 1,
            course_id: course.id,
            course_name: course.name,
            block_id: header.blockId,
            chinese_name: chineseName,
            pinyin_name: header.columns.pinyinName >= 0 ? text(values[header.columns.pinyinName]) : '',
            english_name: header.columns.englishName >= 0 ? text(values[header.columns.englishName]) : '',
          });
        }
        return rosterRows;
      });
      rosterGroups = [{ title, course, rows }];
    } else {
      rosterGroups = headerlessRosterGroups(matrix, sheetName, courses, students);
      if (!rosterGroups.length) {
        ignoredSheets.push({ sheet_name: sheetName, reason: '未找到中文姓名表头或可识别的课程名单列' });
        continue;
      }
    }

    let sheetMatched = 0;
    let sheetUnmatched = 0;
    let sheetAmbiguous = 0;
    let sheetGradeMismatch = 0;
    for (const group of rosterGroups) {
      for (const row of group.rows) {
        const match = matchStudent(row, students);
        if (match.status === 'matched') {
          if (!courseAppliesToStudentGrade(group.course, match.student.grade)) {
            sheetGradeMismatch++;
            gradeMismatches.push({
              ...row,
              student_id: match.student.id,
              student_grade: match.student.grade,
              course_id: group.course.id,
              course_name: group.course.name,
            });
            continue;
          }
          sheetMatched++;
          matchedRows++;
          if (!selectedByStudent.has(match.student.id)) selectedByStudent.set(match.student.id, new Set());
          selectedByStudent.get(match.student.id).add(group.course.id);
          if (row.block_id) {
            if (!blockAssignmentsByStudent.has(match.student.id)) {
              blockAssignmentsByStudent.set(match.student.id, new Map());
            }
            blockAssignmentsByStudent.get(match.student.id).set(group.course.id, row.block_id);
          }
        } else if (match.status === 'ambiguous') {
          sheetAmbiguous++;
          ambiguous.push({ ...row, candidate_ids: match.candidates.map(student => student.id) });
        } else {
          sheetUnmatched++;
          unmatched.push(row);
        }
      }
    }
    const rows = rosterGroups.flatMap(group => group.rows);
    const recognizedCourses = [...new Map(rosterGroups.map(group => [group.course.id, group.course])).values()];
    sheets.push({
      sheet_name: sheetName,
      title: rosterGroups.map(group => group.title).join('；'),
      course_id: recognizedCourses.length === 1 ? recognizedCourses[0].id : undefined,
      course_name: recognizedCourses.length === 1 ? recognizedCourses[0].name : undefined,
      course_ids: recognizedCourses.map(course => course.id),
      layout: headers.length ? 'header' : 'roster-grid',
      status: 'recognized',
      rows: rows.length,
      matched: sheetMatched,
      unmatched: sheetUnmatched,
      ambiguous: sheetAmbiguous,
      grade_mismatch: sheetGradeMismatch,
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
      grade: student.grade,
      admin_class_id: student.admin_class_id || '',
      previous_course_ids: previous,
      previous_course_names: previous.map(id => courseNameById.get(id) || id),
      course_ids: next,
      course_names: next.map(id => courseNameById.get(id) || id),
      added_course_ids: next.filter(id => !previous.includes(id)),
      removed_course_ids: previous.filter(id => !next.includes(id)),
      block_assignments: [...(blockAssignmentsByStudent.get(studentId) || [])]
        .sort(([left], [right]) => (courseOrder.get(left) ?? 9999) - (courseOrder.get(right) ?? 9999))
        .map(([course_id, block_id]) => ({ course_id, block_id })),
    };
  }).sort((left, right) => left.student_id.localeCompare(right.student_id, 'zh-CN', { numeric: true }));

  const recognizedSheets = sheets.filter(sheet => sheet.status === 'recognized');
  const blockConflicts = changes.flatMap(change => {
    const coursesByBlock = new Map();
    for (const assignment of change.block_assignments || []) {
      const courseIds = coursesByBlock.get(assignment.block_id) || [];
      courseIds.push(assignment.course_id);
      coursesByBlock.set(assignment.block_id, courseIds);
    }
    return [...coursesByBlock]
      .filter(([, courseIds]) => courseIds.length > 1)
      .map(([block_id, courseIds]) => ({
        student_id: change.student_id,
        student_name: change.student_name,
        block_id,
        course_ids: courseIds.sort((left, right) =>
          (courseOrder.get(left) ?? 9999) - (courseOrder.get(right) ?? 9999)),
      }));
  });
  const issueCount = unmatched.length + ambiguous.length + gradeMismatches.length
    + unmappedCourseSheets.length + blockConflicts.length;
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
    grade_mismatches: gradeMismatches,
    block_conflicts: blockConflicts,
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
  const courseById = new Map((state.courses || []).map(course => [course.id, course]));
  const studentById = new Map((state.students || []).map(student => [student.id, student]));
  const validBlockIds = new Set(apBlockConfigForState(state).blocks.map(block => block.id));
  const changeByStudent = new Map();
  const importedBlockAssignments = [];
  for (const change of changes) {
    if (!change?.student_id || !Array.isArray(change.course_ids)) throw new Error('AP 选课变更数据不完整');
    if (changeByStudent.has(change.student_id)) throw new Error(`学生 ${change.student_id} 在导入数据中重复`);
    const student = studentById.get(change.student_id);
    if (!student) throw new Error(`找不到学生: ${change.student_id}`);
    const unique = [...new Set(change.course_ids)];
    for (const courseId of unique) {
      if (!apCourseIds.has(courseId)) throw new Error(`${courseId} 不是系统中的 AP 课程`);
      const course = courseById.get(courseId);
      if (!courseAppliesToStudentGrade(course, student.grade)) {
        throw new Error(`${course.name || courseId} 不适用于 ${student.name || student.id}（年级 ${student.grade}）`);
      }
    }
    if (change.block_assignments !== undefined && !Array.isArray(change.block_assignments)) {
      throw new Error(`学生 ${change.student_id} 的 AP Block 分班必须是数组`);
    }
    const assignedCourses = new Set();
    const assignedBlocks = new Set();
    for (const assignment of change.block_assignments || []) {
      if (!assignment?.course_id || !assignment?.block_id) {
        throw new Error(`学生 ${change.student_id} 的 AP Block 分班数据不完整`);
      }
      if (!unique.includes(assignment.course_id)) {
        throw new Error(`学生 ${change.student_id} 的 Block 分班引用了未选择课程 ${assignment.course_id}`);
      }
      if (!validBlockIds.has(assignment.block_id)) {
        throw new Error(`学生 ${change.student_id} 的 Block 不存在: ${assignment.block_id}`);
      }
      if (assignedCourses.has(assignment.course_id)) {
        throw new Error(`学生 ${change.student_id} 的课程 ${assignment.course_id} 重复分配 Block`);
      }
      if (assignedBlocks.has(assignment.block_id)) {
        throw new Error(`学生 ${change.student_id} 在同一 Block ${assignment.block_id} 有多门 AP 课程`);
      }
      assignedCourses.add(assignment.course_id);
      assignedBlocks.add(assignment.block_id);
      importedBlockAssignments.push({
        student_id: change.student_id,
        course_id: assignment.course_id,
        block_id: assignment.block_id,
      });
    }
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
  const importedStudentIds = new Set(changeByStudent.keys());
  const previousAssignments = (state.ap_block_assignments || []).filter(assignment =>
    mode === 'merge' || !importedStudentIds.has(assignment.student_id));
  const assignmentByKey = new Map(previousAssignments.map(assignment => [
    `${assignment.student_id}\u0000${assignment.course_id}`,
    assignment,
  ]));
  for (const assignment of importedBlockAssignments) {
    assignmentByKey.set(`${assignment.student_id}\u0000${assignment.course_id}`, assignment);
  }
  const apBlockAssignments = [...assignmentByKey.values()].sort((left, right) =>
    left.student_id.localeCompare(right.student_id, 'zh-CN', { numeric: true })
      || left.course_id.localeCompare(right.course_id)
      || left.block_id.localeCompare(right.block_id));
  return { students, ap_block_assignments: apBlockAssignments, updated, mode };
}
