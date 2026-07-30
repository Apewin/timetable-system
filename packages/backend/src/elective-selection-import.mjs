import * as XLSX from 'xlsx';

function text(value) {
  return String(value ?? '').trim();
}

function key(value) {
  return text(value).normalize('NFKC').toLowerCase().replace(/[^a-z0-9\u3400-\u9fff]/g, '');
}

function groupKey(value) {
  const normalized = key(value);
  const match = /(?:group|组别|选修组)?([abc])(?:组)?$/.exec(normalized);
  return match?.[1]?.toUpperCase();
}

function headerKind(value) {
  const normalized = key(value);
  const aliases = {
    studentid: 'studentId', 学号: 'studentId', 学生id: 'studentId',
    namechinese: 'chineseName', 中文姓名: 'chineseName', 中文名: 'chineseName', 姓名: 'chineseName',
    namepinyin: 'pinyinName', 姓名拼音: 'pinyinName', 拼音: 'pinyinName',
    englishname: 'englishName', 英文姓名: 'englishName', 英文名: 'englishName',
    group: 'group', groupname: 'group', 组别: 'group', 选修组: 'group',
    course: 'course', coursename: 'course', 课程: 'course', 课程名称: 'course', 选课: 'course', 选修课: 'course',
  };
  return aliases[normalized] || (groupKey(value) ? `group${groupKey(value)}` : undefined);
}

function findHeader(matrix) {
  for (let rowIndex = 0; rowIndex < Math.min(matrix.length, 20); rowIndex++) {
    const kinds = (matrix[rowIndex] || []).map(headerKind);
    const columns = {};
    kinds.forEach((kind, index) => {
      if (kind && columns[kind] === undefined) columns[kind] = index;
    });
    const hasIdentity = columns.studentId !== undefined || columns.chineseName !== undefined;
    const hasWide = ['groupA', 'groupB', 'groupC'].some(group => columns[group] !== undefined);
    const hasLong = columns.group !== undefined && columns.course !== undefined;
    if (hasIdentity && (hasWide || hasLong)) {
      return { rowIndex, columns, layout: hasWide ? 'wide' : 'long' };
    }
  }
  return undefined;
}

function electiveCourses(state) {
  return (state.courses || []).filter(course =>
    course.type === 'required_elective'
    && Number(course.grade) === 12
    && ['A', 'B', 'C'].includes(text(course.elective_group).toUpperCase()));
}

function courseFor(value, courses, expectedGroup) {
  const normalized = key(value)
    .replace(/^ap/, '')
    .replace(/andcomposition$/, '')
    .replace(/英美文学史及选读$/, '英美文学');
  if (!normalized) return undefined;
  const aliases = {
    language: 'AP_LANG', lang: 'AP_LANG', aplanguage: 'AP_LANG',
    literature: 'AP_LIT', lit: 'AP_LIT', apliterature: 'AP_LIT',
    honorlit: 'HONOR_LIT', honor文学: 'HONOR_LIT', 英美文学: 'HONOR_LIT',
    线代: 'LINEAR_ALG', linearalgebra: 'LINEAR_ALG',
    力学: 'MECH_BASIS', mechanics: 'MECH_BASIS',
    business: 'BUSINESS',
    japanese: 'JAPANESE', french: 'FRENCH', german: 'GERMAN',
  };
  const aliasId = aliases[normalized];
  const candidates = courses.filter(course => {
    if (expectedGroup && course.elective_group !== expectedGroup) return false;
    const courseName = key(course.name)
      .replace(/^ap/, '')
      .replace(/andcomposition$/, '')
      .replace(/英美文学史及选读$/, '英美文学');
    return course.id === text(value)
      || key(course.id) === normalized
      || courseName === normalized
      || (normalized.length >= 3 && (courseName.includes(normalized) || normalized.includes(courseName)))
      || course.id === aliasId;
  });
  return candidates.length === 1 ? candidates[0] : undefined;
}

function matchStudent(row, students) {
  const studentId = text(row.student_id);
  if (studentId) {
    const exact = students.filter(student => text(student.id) === studentId);
    if (exact.length === 1) return { status: 'matched', student: exact[0], matched_by: 'Student ID' };
  }
  let candidates = row.chinese_name
    ? students.filter(student => key(student.name) === key(row.chinese_name))
    : [];
  if (candidates.length > 1 && row.english_name) {
    candidates = candidates.filter(student => key(student.english_name) === key(row.english_name));
  }
  if (candidates.length > 1 && row.pinyin_name) {
    candidates = candidates.filter(student => key(student.pinyin_name) === key(row.pinyin_name));
  }
  if (candidates.length === 1) return { status: 'matched', student: candidates[0], matched_by: '姓名' };
  if (candidates.length > 1) return { status: 'ambiguous', candidates };

  if (row.english_name && row.pinyin_name) {
    candidates = students.filter(student =>
      key(student.english_name) === key(row.english_name)
      && key(student.pinyin_name) === key(row.pinyin_name));
    if (candidates.length === 1) return { status: 'matched', student: candidates[0], matched_by: '英文名+拼音' };
    if (candidates.length > 1) return { status: 'ambiguous', candidates };
  }
  return { status: 'unmatched', candidates: [] };
}

function titleBeforeHeader(matrix, headerRowIndex, sheetName) {
  return [
    ...matrix.slice(0, headerRowIndex).flat().map(text).filter(Boolean),
    text(sheetName),
  ].join(' ');
}

function rosterCourse(matrix, sheetName, headerRowIndex, courses) {
  const title = titleBeforeHeader(matrix, headerRowIndex, sheetName);
  const matches = courses.filter(course => {
    const titleKey = key(title);
    const nameKey = key(course.name);
    return titleKey.includes(key(course.id)) || titleKey.includes(nameKey);
  });
  return matches.length === 1 ? matches[0] : undefined;
}

function rosterHeader(matrix) {
  for (let rowIndex = 0; rowIndex < Math.min(matrix.length, 20); rowIndex++) {
    const columns = {};
    (matrix[rowIndex] || []).forEach((value, index) => {
      const kind = headerKind(value);
      if (kind && columns[kind] === undefined) columns[kind] = index;
    });
    if (columns.studentId !== undefined || columns.chineseName !== undefined) return { rowIndex, columns };
  }
  return undefined;
}

function identity(values, columns) {
  return {
    student_id: columns.studentId === undefined ? '' : text(values[columns.studentId]),
    chinese_name: columns.chineseName === undefined ? '' : text(values[columns.chineseName]),
    english_name: columns.englishName === undefined ? '' : text(values[columns.englishName]),
    pinyin_name: columns.pinyinName === undefined ? '' : text(values[columns.pinyinName]),
  };
}

function rowsForSheet(matrix, sheetName, courses) {
  const header = findHeader(matrix);
  const rows = [];
  if (header) {
    for (let rowIndex = header.rowIndex + 1; rowIndex < matrix.length; rowIndex++) {
      const values = matrix[rowIndex] || [];
      const person = identity(values, header.columns);
      if (!person.student_id && !person.chinese_name) continue;
      if (header.layout === 'wide') {
        for (const group of ['A', 'B', 'C']) {
          const column = header.columns[`group${group}`];
          const courseTitle = column === undefined ? '' : text(values[column]);
          if (courseTitle) rows.push({ ...person, group, course_title: courseTitle, excel_row: rowIndex + 1 });
        }
      } else {
        const group = groupKey(values[header.columns.group]);
        const courseTitle = text(values[header.columns.course]);
        if (group || courseTitle) rows.push({ ...person, group, course_title: courseTitle, excel_row: rowIndex + 1 });
      }
    }
    return { status: 'recognized', layout: header.layout, rows, header_row: header.rowIndex + 1 };
  }

  const roster = rosterHeader(matrix);
  const course = roster && rosterCourse(matrix, sheetName, roster.rowIndex, courses);
  if (!roster || !course) return { status: 'ignored', layout: 'unknown', rows: [], reason: '未找到 A/B/C 选课表头或可识别的课程名单标题' };
  for (let rowIndex = roster.rowIndex + 1; rowIndex < matrix.length; rowIndex++) {
    const values = matrix[rowIndex] || [];
    const person = identity(values, roster.columns);
    if (!person.student_id && !person.chinese_name) continue;
    rows.push({
      ...person,
      group: course.elective_group,
      course_title: course.name,
      excel_row: rowIndex + 1,
    });
  }
  return { status: 'recognized', layout: 'roster', rows, header_row: roster.rowIndex + 1 };
}

export function parseElectiveSelectionWorkbook(workbook, state, filename = '') {
  const courses = electiveCourses(state);
  const grade12Students = (state.students || []).filter(student => Number(student.grade) === 12);
  const selections = new Map();
  const sheets = [];
  const unmatched = [];
  const ambiguous = [];
  const invalid = [];
  let matchedRows = 0;

  for (const sheetName of workbook.SheetNames) {
    const matrix = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, defval: '' });
    const parsed = rowsForSheet(matrix, sheetName, courses);
    let sheetMatched = 0;
    let sheetIssues = 0;
    if (parsed.status === 'recognized') {
      for (const row of parsed.rows) {
        const group = row.group;
        const course = courseFor(row.course_title, courses, group);
        if (!group || !course) {
          invalid.push({
            ...row, sheet_name: sheetName,
            reason: !group ? '组别必须是 A、B 或 C' : `“${row.course_title || '空'}”不是系统高三 ${group} 组课程`,
          });
          sheetIssues++;
          continue;
        }
        const match = matchStudent(row, grade12Students);
        if (match.status === 'unmatched') {
          unmatched.push({ ...row, sheet_name: sheetName }); sheetIssues++; continue;
        }
        if (match.status === 'ambiguous') {
          ambiguous.push({ ...row, sheet_name: sheetName, candidate_ids: match.candidates.map(student => student.id) });
          sheetIssues++; continue;
        }
        const selectionKey = `${match.student.id}:${group}`;
        const previous = selections.get(selectionKey);
        if (previous && previous.course_id !== course.id) {
          invalid.push({
            ...row, sheet_name: sheetName,
            reason: `${match.student.name} 的 ${group} 组同时出现 ${previous.course_name} 和 ${course.name}`,
          });
          sheetIssues++;
          continue;
        }
        selections.set(selectionKey, {
          student: match.student,
          group,
          course_id: course.id,
          course_name: course.name,
        });
        matchedRows++;
        sheetMatched++;
      }
    }
    sheets.push({
      sheet_name: sheetName,
      status: parsed.status,
      layout: parsed.layout,
      header_row: parsed.header_row,
      rows: parsed.rows.length,
      matched: sheetMatched,
      issues: sheetIssues,
      reason: parsed.reason,
    });
  }

  const courseNames = new Map(courses.map(course => [course.id, course.name]));
  const byStudent = new Map();
  for (const selection of selections.values()) {
    const entry = byStudent.get(selection.student.id) || {
      student_id: selection.student.id,
      student_name: selection.student.name,
      english_name: selection.student.english_name || '',
      previous_choices: { ...(selection.student.elective_choices || {}) },
      choices: { ...(selection.student.elective_choices || {}) },
      imported_groups: [],
    };
    entry.choices[`group_${selection.group.toLowerCase()}`] = selection.course_id;
    entry.imported_groups.push(selection.group);
    byStudent.set(selection.student.id, entry);
  }
  const changes = [...byStudent.values()].map(change => ({
    ...change,
    imported_groups: [...new Set(change.imported_groups)].sort(),
    previous_choice_names: Object.fromEntries(['A', 'B', 'C'].map(group => {
      const id = change.previous_choices[`group_${group.toLowerCase()}`];
      return [group, id ? courseNames.get(id) || id : ''];
    })),
    choice_names: Object.fromEntries(['A', 'B', 'C'].map(group => {
      const id = change.choices[`group_${group.toLowerCase()}`];
      return [group, id ? courseNames.get(id) || id : ''];
    })),
  })).sort((left, right) => left.student_id.localeCompare(right.student_id, 'zh-CN', { numeric: true }));

  const recognized = sheets.filter(sheet => sheet.status === 'recognized');
  const issueCount = unmatched.length + ambiguous.length + invalid.length;
  const groupCounts = Object.fromEntries(['A', 'B', 'C'].map(group => [
    group,
    [...selections.values()].filter(selection => selection.group === group).length,
  ]));
  return {
    filename,
    total_sheets: workbook.SheetNames.length,
    recognized_sheet_count: recognized.length,
    sheets,
    matched_rows: matchedRows,
    unique_students: changes.length,
    group_counts: groupCounts,
    unmatched,
    ambiguous,
    invalid,
    issue_count: issueCount,
    can_confirm: recognized.length > 0 && changes.length > 0 && issueCount === 0,
    changes,
  };
}

export function parseElectiveSelectionBuffer(buffer, state, filename = '') {
  return parseElectiveSelectionWorkbook(XLSX.read(buffer, { type: 'buffer' }), state, filename);
}

export function applyElectiveSelectionChanges(state, changes) {
  if (!Array.isArray(changes) || !changes.length) throw new Error('没有可更新的其他选课数据');
  const students = new Map((state.students || []).map(student => [student.id, student]));
  const allowedCourses = new Map(electiveCourses(state).map(course => [course.id, course]));
  const seen = new Set();
  for (const change of changes) {
    if (!change?.student_id || !change.choices || typeof change.choices !== 'object') throw new Error('选课变更数据不完整');
    if (seen.has(change.student_id)) throw new Error(`学生 ${change.student_id} 在导入数据中重复`);
    seen.add(change.student_id);
    const student = students.get(change.student_id);
    if (!student || Number(student.grade) !== 12) throw new Error(`找不到高三学生: ${change.student_id}`);
    const importedGroups = Array.isArray(change.imported_groups) ? change.imported_groups : ['A', 'B', 'C'];
    const nextChoices = { ...(student.elective_choices || {}) };
    for (const group of importedGroups) {
      if (!['A', 'B', 'C'].includes(group)) throw new Error(`不支持的选课组: ${group}`);
      const courseId = change.choices[`group_${group.toLowerCase()}`];
      const course = allowedCourses.get(courseId);
      if (!course || course.elective_group !== group) throw new Error(`${courseId || '空'} 不是高三 ${group} 组课程`);
      nextChoices[`group_${group.toLowerCase()}`] = courseId;
    }
    students.set(student.id, { ...student, elective_choices: nextChoices });
  }
  return {
    students: (state.students || []).map(student => students.get(student.id)),
    updated: seen.size,
  };
}
