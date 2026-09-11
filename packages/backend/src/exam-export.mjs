import ExcelJS from 'exceljs';

const HEADER_FILL = 'FF1F4E78';
const HEADER_FONT = Object.freeze({ bold: true, color: { argb: 'FFFFFFFF' } });

function text(value) {
  return String(value ?? '').trim();
}

function dayDisplay(config, dayIndex, fallback) {
  if (!config?.start_date) return fallback || `第 ${dayIndex + 1} 天`;
  const date = new Date(`${config.start_date}T00:00:00`);
  if (Number.isNaN(date.getTime())) return fallback || `第 ${dayIndex + 1} 天`;
  date.setDate(date.getDate() + dayIndex);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function styleTable(worksheet, widths) {
  worksheet.views = [{ state: 'frozen', ySplit: 1 }];
  worksheet.autoFilter = { from: 'A1', to: `${worksheet.getColumn(widths.length).letter}1` };
  worksheet.getRow(1).height = 24;
  worksheet.getRow(1).eachCell(cell => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER_FILL } };
    cell.font = HEADER_FONT;
    cell.alignment = { horizontal: 'center', vertical: 'middle' };
  });
  widths.forEach((width, index) => { worksheet.getColumn(index + 1).width = width; });
  worksheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    row.alignment = { vertical: 'middle', wrapText: true };
    if (rowNumber % 2 === 0) {
      row.eachCell(cell => {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF3F6F9' } };
      });
    }
  });
}

function teacherNames(ids, teachers) {
  return (ids || []).map(id => teachers.get(id)?.name || id).join('、');
}

function gradeLabel(grade) {
  return `高${['一', '二', '三'][grade - 10]}`;
}

function seatingStudentName(student = {}, fallback) {
  const chineseName = text(student.name || student.chinese_name) || fallback;
  const englishName = text(student.english_name);
  return englishName && !chineseName.toLowerCase().includes(englishName.toLowerCase())
    ? `${chineseName}\n${englishName}`
    : chineseName;
}

function seatingWorksheetName(workbook, courseName) {
  const base = `座次-${text(courseName) || '考试'}`
    .replace(/[\\/*?:[\]]/g, '-')
    .slice(0, 31);
  let candidate = base;
  let suffix = 2;
  while (workbook.getWorksheet(candidate)) {
    const marker = `-${suffix}`;
    candidate = `${base.slice(0, 31 - marker.length)}${marker}`;
    suffix += 1;
  }
  return candidate;
}

function thinBorder() {
  const edge = { style: 'thin', color: { argb: 'FF000000' } };
  return { top: edge, left: edge, bottom: edge, right: edge };
}

const PROCTOR_HEADER_FILL = 'FFBFBFBF';
const PROCTOR_UNUSED_FILL = 'FFD9D9D9';
const PROCTOR_PENDING_FILL = 'FFFFF2CC';
const PROCTOR_FONT = 'Arial Unicode MS';

function dateForExamDay(config, dayIndex) {
  if (!config?.start_date) return null;
  const date = new Date(`${config.start_date}T00:00:00`);
  if (Number.isNaN(date.getTime())) return null;
  date.setDate(date.getDate() + dayIndex);
  return date;
}

function proctorTitle(config) {
  const date = dateForExamDay(config, 0) || new Date();
  return `Proctor List ${date.getFullYear()}.${date.getMonth() + 1}`;
}

function proctorDateDisplay(config, dayIndex, fallback) {
  const date = dateForExamDay(config, dayIndex);
  if (!date) return fallback || `Day ${dayIndex + 1}`;
  const months = ['Jan.', 'Feb.', 'Mar.', 'Apr.', 'May.', 'Jun.', 'Jul.', 'Aug.', 'Sep.', 'Oct.', 'Nov.', 'Dec.'];
  const weekdays = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  return `${months[date.getMonth()]}${date.getDate()}\n${weekdays[date.getDay()]}`;
}

function proctorRoomKey(room = {}) {
  return text(room.id || room.room_id || room.name || room.room_name);
}

function proctorRoomCatalog(config, sessions) {
  const catalog = [];
  const known = new Set();
  const addRoom = raw => {
    const key = proctorRoomKey(raw);
    if (!key || known.has(key)) return;
    known.add(key);
    catalog.push({
      key,
      id: text(raw.id || raw.room_id),
      name: text(raw.name || raw.room_name) || key,
      capacity: Number.isFinite(Number(raw.capacity)) ? Number(raw.capacity) : null,
    });
  };
  for (const room of config?.rooms || []) addRoom(room);
  for (const session of sessions || []) {
    for (const room of session.room_allocations || []) addRoom(room);
  }
  return catalog;
}

function roomsUsedBySessions(catalog, sessions) {
  const usedKeys = new Set();
  const usedNames = new Set();
  for (const session of sessions) for (const room of session.room_allocations || []) {
    usedKeys.add(proctorRoomKey(room));
    usedNames.add(text(room.room_name || room.name));
  }
  return catalog.filter(room => usedKeys.has(room.key) || usedNames.has(room.name));
}

function proctorRoomHeader(room) {
  return room.capacity ? `${room.name}(${room.capacity})` : room.name;
}

function proctorCellStyle(cell, { fill = null, bold = false, size = 12 } = {}) {
  cell.font = { name: PROCTOR_FONT, size, bold };
  cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
  cell.border = thinBorder();
  if (fill) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: fill } };
}

function sessionRoomAllocation(session, room) {
  return (session.room_allocations || []).find(allocation => (
    proctorRoomKey(allocation) === room.key
    || text(allocation.room_name || allocation.name) === room.name
  ));
}

function addPrintableProctorWorksheet(workbook, schedule, teachers) {
  const worksheet = workbook.addWorksheet('监考表');
  const config = schedule.plan.config;
  const gradeSections = [10, 11, 12].map(grade => {
    const sessions = sessionsForGrade(schedule, grade);
    return {
      grade,
      sessions,
      rooms: roomsUsedBySessions(proctorRoomCatalog(config, schedule.sessions), sessions),
    };
  });
  const roomColumnCount = Math.max(1, ...gradeSections.map(section => section.rooms.length));
  const lastColumn = 4 + roomColumnCount;

  worksheet.mergeCells(1, 1, 1, lastColumn);
  const title = worksheet.getCell(1, 1);
  title.value = proctorTitle(config);
  proctorCellStyle(title, { bold: true, size: 16 });
  worksheet.getRow(1).height = 34;

  let rowNumber = 2;
  for (const [sectionIndex, section] of gradeSections.entries()) {
    if (sectionIndex > 0) worksheet.getRow(rowNumber - 1).addPageBreak(1, lastColumn);
    const headerRow = rowNumber;
    const headers = [`Senior ${section.grade - 9}`, 'Date', 'Time', 'Subject'];
    for (let column = 1; column <= lastColumn; column += 1) {
      const cell = worksheet.getCell(headerRow, column);
      cell.value = column <= headers.length
        ? headers[column - 1]
        : proctorRoomHeader(section.rooms[column - 5] || { name: '' });
      proctorCellStyle(cell, { fill: PROCTOR_HEADER_FILL, bold: true, size: column === 1 ? 14 : 12 });
    }
    worksheet.getCell(headerRow, 1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFFFF' } };
    worksheet.getRow(headerRow).height = 32;
    rowNumber += 1;

    const firstDataRow = rowNumber;
    if (!section.sessions.length) {
      worksheet.getCell(rowNumber, 4).value = 'No exams';
      for (let column = 2; column <= lastColumn; column += 1) {
        const cell = worksheet.getCell(rowNumber, column);
        proctorCellStyle(cell, { fill: column >= 5 ? PROCTOR_UNUSED_FILL : null });
      }
      worksheet.getRow(rowNumber).height = 30;
      rowNumber += 1;
    } else {
      for (const session of section.sessions) {
        const chiefNames = teacherNames(session.chief_teacher_ids, teachers);
        worksheet.getCell(rowNumber, 2).value = proctorDateDisplay(config, session.day_index, session.day_label);
        worksheet.getCell(rowNumber, 3).value = `${session.start_time}-${session.end_time}`;
        worksheet.getCell(rowNumber, 4).value = chiefNames
          ? `${session.course_name}\n巡考：${chiefNames}`
          : session.course_name;

        for (let column = 2; column <= lastColumn; column += 1) {
          const cell = worksheet.getCell(rowNumber, column);
          if (column < 5) {
            proctorCellStyle(cell, { bold: column === 4, size: column === 4 ? 11 : 12 });
            continue;
          }
          const room = section.rooms[column - 5];
          const allocation = room ? sessionRoomAllocation(session, room) : null;
          if (!allocation) {
            proctorCellStyle(cell, { fill: PROCTOR_UNUSED_FILL });
            continue;
          }
          const invigilators = teacherNames(allocation.invigilator_teacher_ids, teachers);
          cell.value = invigilators || '待安排';
          proctorCellStyle(cell, { fill: invigilators ? null : PROCTOR_PENDING_FILL, bold: !invigilators });
        }
        worksheet.getRow(rowNumber).height = chiefNames ? 42 : 32;
        rowNumber += 1;
      }

      let dayStartRow = firstDataRow;
      while (dayStartRow < rowNumber) {
        const dayIndex = section.sessions[dayStartRow - firstDataRow].day_index;
        let dayEndRow = dayStartRow;
        while (
          dayEndRow + 1 < rowNumber
          && section.sessions[dayEndRow + 1 - firstDataRow].day_index === dayIndex
        ) dayEndRow += 1;
        if (dayEndRow > dayStartRow) worksheet.mergeCells(dayStartRow, 2, dayEndRow, 2);
        dayStartRow = dayEndRow + 1;
      }
    }

    const lastDataRow = rowNumber - 1;
    worksheet.mergeCells(headerRow, 1, lastDataRow, 1);
    const gradeCell = worksheet.getCell(headerRow, 1);
    gradeCell.value = `Senior ${section.grade - 9}`;
    proctorCellStyle(gradeCell, { bold: true, size: 14 });
    for (let column = 1; column <= lastColumn; column += 1) {
      worksheet.getCell(lastDataRow, column).border = {
        ...thinBorder(),
        bottom: { style: 'medium', color: { argb: 'FF000000' } },
      };
    }
  }

  worksheet.getColumn(1).width = 11;
  worksheet.getColumn(2).width = 14;
  worksheet.getColumn(3).width = 16;
  worksheet.getColumn(4).width = 34;
  for (let column = 5; column <= lastColumn; column += 1) worksheet.getColumn(column).width = 18;
  worksheet.views = [{ state: 'frozen', ySplit: 1, showGridLines: false }];
  worksheet.pageSetup = {
    paperSize: 9,
    orientation: 'landscape',
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: 0,
    horizontalCentered: true,
    margins: { left: 0.25, right: 0.25, top: 0.35, bottom: 0.35, header: 0.15, footer: 0.15 },
    printArea: `A1:${worksheet.getColumn(lastColumn).letter}${rowNumber - 1}`,
  };
}

function addPrintableSeatingWorksheets(workbook, schedule, students) {
  for (const session of schedule.sessions || []) {
    const worksheet = workbook.addWorksheet(seatingWorksheetName(workbook, session.course_name));
    const rooms = session.room_allocations || [];
    let bandStartRow = 1;
    for (let roomIndex = 0; roomIndex < rooms.length; roomIndex += 3) {
      const bandRooms = rooms.slice(roomIndex, roomIndex + 3);
      const bandSeatRowCount = Math.max(1, ...bandRooms.map(room => {
        const columnCount = (room.seats || []).length === 30 ? 5 : 4;
        return Math.ceil((room.seats || []).length / columnCount);
      }));
      let startColumn = 1;
      for (const room of bandRooms) {
        const seats = room.seats || [];
        const columnCount = seats.length === 30 ? 5 : 4;
        const endColumn = startColumn + columnCount - 1;
        worksheet.mergeCells(bandStartRow, startColumn, bandStartRow, endColumn);
        const title = worksheet.getCell(bandStartRow, startColumn);
        title.value = `${session.course_name}\n${dayDisplay(schedule.plan.config, session.day_index, session.day_label)} ${session.start_time}-${session.end_time}`;
        title.font = { name: 'Times New Roman', bold: true, size: 14 };
        title.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
        title.border = thinBorder();

        worksheet.mergeCells(bandStartRow + 1, startColumn, bandStartRow + 1, endColumn);
        const lectern = worksheet.getCell(bandStartRow + 1, startColumn);
        lectern.value = `${room.room_name} 讲台（${seats.length}人）`;
        lectern.font = { name: '宋体', size: 12 };
        lectern.alignment = { horizontal: 'center', vertical: 'middle' };
        lectern.border = thinBorder();

        const fullSeatCount = Math.floor(seats.length / columnCount) * columnCount;
        const finalRowSeatCount = seats.length % columnCount;
        const seatRowCount = Math.ceil(seats.length / columnCount);
        for (let row = bandStartRow + 2; row < bandStartRow + 2 + seatRowCount; row += 1) {
          worksheet.getRow(row).height = 42;
          for (let column = startColumn; column <= endColumn; column += 1) {
            const cell = worksheet.getCell(row, column);
            cell.font = { name: '宋体', size: 11 };
            cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
            cell.border = thinBorder();
          }
        }
        for (const [index, seat] of seats.entries()) {
          const inFinalRow = finalRowSeatCount > 0 && index >= fullSeatCount;
          const row = bandStartRow + 2
            + (inFinalRow ? Math.floor(seats.length / columnCount) : Math.floor(index / columnCount));
          const centeredOffset = inFinalRow ? Math.floor((columnCount - finalRowSeatCount) / 2) : 0;
          const column = startColumn + centeredOffset + (index % columnCount);
          const student = students.get(seat.student_id) || {};
          const cell = worksheet.getCell(row, column);
          cell.value = seatingStudentName(student, seat.student_id);
        }
        for (let column = startColumn; column <= endColumn; column += 1) {
          worksheet.getColumn(column).width = 15;
        }
        startColumn = endColumn + 2;
      }
      worksheet.getRow(bandStartRow).height = 42;
      worksheet.getRow(bandStartRow + 1).height = 28;
      bandStartRow += 2 + bandSeatRowCount + 2;
    }
    worksheet.views = [{ showGridLines: false }];
    worksheet.pageSetup = { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 };
  }
}

function sessionsForGrade(schedule, grade) {
  return (schedule.sessions || [])
    .filter(session => (session.grades || []).includes(grade))
    .sort((left, right) => left.global_start_unit - right.global_start_unit
      || left.course_name.localeCompare(right.course_name, 'zh-CN'));
}

function styleTimetableTitle(worksheet, range, value) {
  worksheet.mergeCells(range);
  const cell = worksheet.getCell(range.split(':')[0]);
  cell.value = value;
  cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER_FILL } };
  cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 16 };
  cell.alignment = { horizontal: 'center', vertical: 'middle' };
  worksheet.getRow(cell.row).height = 30;
}

function styleTimetableHeader(worksheet, rowNumber, startColumn, endColumn) {
  for (let column = startColumn; column <= endColumn; column += 1) {
    const cell = worksheet.getRow(rowNumber).getCell(column);
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDCE6F1' } };
    cell.font = { bold: true, color: { argb: 'FF1F2937' } };
    cell.alignment = { horizontal: 'center', vertical: 'middle' };
    cell.border = { bottom: { style: 'medium', color: { argb: 'FF7A8A99' } } };
  }
}

function styleTimetableBody(worksheet, startRow, endRow, startColumn, endColumn) {
  if (endRow < startRow) return;
  for (let rowNumber = startRow; rowNumber <= endRow; rowNumber += 1) {
    const row = worksheet.getRow(rowNumber);
    row.height = 24;
    for (let column = startColumn; column <= endColumn; column += 1) {
      const cell = row.getCell(column);
      cell.alignment = { horizontal: column === startColumn ? 'center' : 'left', vertical: 'middle', wrapText: true };
      cell.border = { bottom: { style: 'thin', color: { argb: 'FFD6DEE6' } } };
    }
  }
}

function addCombinedGradeTimetable(workbook, schedule) {
  const worksheet = workbook.addWorksheet('三年级考试时间表');
  styleTimetableTitle(worksheet, 'A1:K1', '三个年级考试时间表');
  const starts = [1, 5, 9];
  for (const [index, grade] of [10, 11, 12].entries()) {
    const start = starts[index];
    worksheet.mergeCells(2, start, 2, start + 2);
    const heading = worksheet.getCell(2, start);
    heading.value = gradeLabel(grade);
    heading.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFB4C7E7' } };
    heading.font = { bold: true, color: { argb: 'FF17365D' }, size: 13 };
    heading.alignment = { horizontal: 'center', vertical: 'middle' };
    worksheet.getRow(3).getCell(start).value = '日期';
    worksheet.getRow(3).getCell(start + 1).value = '时间';
    worksheet.getRow(3).getCell(start + 2).value = '考试科目';
    styleTimetableHeader(worksheet, 3, start, start + 2);
  }
  worksheet.getRow(2).height = 26;
  worksheet.getRow(3).height = 24;

  const byGrade = new Map([10, 11, 12].map(grade => [grade, sessionsForGrade(schedule, grade)]));
  let rowNumber = 4;
  for (let dayIndex = 0; dayIndex < schedule.plan.config.day_count; dayIndex += 1) {
    const daily = new Map([10, 11, 12].map(grade => [
      grade,
      byGrade.get(grade).filter(session => session.day_index === dayIndex),
    ]));
    const rowCount = Math.max(1, ...[...daily.values()].map(items => items.length));
    for (const [gradeIndex, grade] of [10, 11, 12].entries()) {
      const start = starts[gradeIndex];
      const sessions = daily.get(grade);
      sessions.forEach((session, index) => {
        const row = worksheet.getRow(rowNumber + index);
        if (index === 0) row.getCell(start).value = dayDisplay(schedule.plan.config, dayIndex, session.day_label);
        row.getCell(start + 1).value = `${session.start_time}-${session.end_time}`;
        row.getCell(start + 2).value = session.course_name;
      });
      if (sessions.length > 1) worksheet.mergeCells(rowNumber, start, rowNumber + sessions.length - 1, start);
    }
    styleTimetableBody(worksheet, rowNumber, rowNumber + rowCount - 1, 1, 11);
    rowNumber += rowCount + 1;
  }

  [14, 16, 28, 3, 14, 16, 28, 3, 14, 16, 28]
    .forEach((width, index) => { worksheet.getColumn(index + 1).width = width; });
  worksheet.views = [{ state: 'frozen', ySplit: 3, showGridLines: false }];
  worksheet.pageSetup = { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 };
}

function addSingleGradeTimetable(workbook, schedule, grade) {
  const label = gradeLabel(grade);
  const worksheet = workbook.addWorksheet(`${label}考试时间表`);
  styleTimetableTitle(worksheet, 'A1:D1', `${label}考试时间表`);
  worksheet.mergeCells('A2:D2');
  worksheet.getCell('A2').value = schedule.plan.config.start_date
    ? `考试周期：${dayDisplay(schedule.plan.config, 0)} 至 ${dayDisplay(schedule.plan.config, schedule.plan.config.day_count - 1)}`
    : `考试周期：${schedule.plan.config.day_count} 天`;
  worksheet.getCell('A2').font = { color: { argb: 'FF5B6573' }, italic: true };
  worksheet.getCell('A2').alignment = { horizontal: 'center', vertical: 'middle' };
  worksheet.addRow(['日期', '时间', '考试科目', '时长（分钟）']);
  styleTimetableHeader(worksheet, 3, 1, 4);

  let rowNumber = 4;
  const sessions = sessionsForGrade(schedule, grade);
  for (let dayIndex = 0; dayIndex < schedule.plan.config.day_count; dayIndex += 1) {
    const daily = sessions.filter(session => session.day_index === dayIndex);
    if (!daily.length) continue;
    const firstRow = rowNumber;
    for (const [index, session] of daily.entries()) {
      worksheet.addRow([
        index === 0 ? dayDisplay(schedule.plan.config, dayIndex, session.day_label) : '',
        `${session.start_time}-${session.end_time}`,
        session.course_name,
        session.duration_minutes,
      ]);
      rowNumber += 1;
    }
    if (daily.length > 1) worksheet.mergeCells(firstRow, 1, rowNumber - 1, 1);
  }
  if (!sessions.length) {
    worksheet.addRow(['', '', '暂无考试', '']);
    rowNumber += 1;
  }
  styleTimetableBody(worksheet, 4, rowNumber - 1, 1, 4);
  worksheet.getColumn(1).width = 18;
  worksheet.getColumn(2).width = 18;
  worksheet.getColumn(3).width = 34;
  worksheet.getColumn(4).width = 15;
  worksheet.getColumn(4).alignment = { horizontal: 'right', vertical: 'middle' };
  worksheet.views = [{ state: 'frozen', ySplit: 3, showGridLines: false }];
  worksheet.autoFilter = { from: 'A3', to: 'D3' };
  worksheet.pageSetup = { orientation: 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0 };
}

/**
 * Produces the stable default workbook. A future school-provided template can
 * consume the same schedule object without changing solver or API contracts.
 */
export async function exportExamScheduleWorkbook({ state = {}, schedule = {} } = {}) {
  if (!schedule?.ok || !Array.isArray(schedule.sessions) || !schedule.plan) {
    throw new Error('请先生成有效的考试安排再导出');
  }
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'AP 排课系统';
  workbook.created = new Date();
  workbook.subject = '考试安排与考场座次';
  const teachers = new Map((state.teachers || []).map(teacher => [teacher.id, teacher]));
  const students = new Map((state.students || []).map(student => [student.id, student]));
  const config = schedule.plan.config;

  if (config.timetable_only) {
    addCombinedGradeTimetable(workbook, schedule);
    for (const grade of [10, 11, 12]) addSingleGradeTimetable(workbook, schedule, grade);
    return Buffer.from(await workbook.xlsx.writeBuffer());
  }

  const scheduleSheet = workbook.addWorksheet('考试安排');
  scheduleSheet.addRow([
    '日期/考试日', '开始时间', '结束时间', '考试科目', '时长（分钟）',
    '考生人数', '考场', '巡考/主考', '监考教师',
  ]);
  for (const session of schedule.sessions) {
    scheduleSheet.addRow([
      dayDisplay(config, session.day_index, session.day_label),
      session.start_time,
      session.end_time,
      session.course_name,
      session.duration_minutes,
      session.student_count,
      session.room_allocations.map(room => room.room_name).join('、'),
      teacherNames(session.chief_teacher_ids, teachers),
      session.room_allocations
        .map(room => `${room.room_name}：${teacherNames(room.invigilator_teacher_ids, teachers) || '待安排'}`)
        .join('\n'),
    ]);
  }
  styleTable(scheduleSheet, [16, 12, 12, 24, 14, 12, 24, 24, 42]);
  addPrintableProctorWorksheet(workbook, schedule, teachers);

  const teacherSheet = workbook.addWorksheet('教师任务');
  teacherSheet.addRow(['教师', '监考场次', '监考分钟数', '巡考/主考科目', '监考明细']);
  for (const load of schedule.teacher_loads || []) {
    const dutyLines = [];
    for (const session of schedule.sessions) for (const room of session.room_allocations) {
      if (!(room.invigilator_teacher_ids || []).includes(load.teacher_id)) continue;
      dutyLines.push(`${dayDisplay(config, session.day_index, session.day_label)} ${session.start_time} ${session.course_name} · ${room.room_name}`);
    }
    const chiefNames = (load.chief_exam_ids || []).map(examId =>
      schedule.sessions.find(session => session.exam_id === examId)?.course_name || examId);
    teacherSheet.addRow([
      load.teacher_name,
      load.invigilation_count,
      load.invigilation_minutes,
      chiefNames.join('、'),
      dutyLines.join('\n'),
    ]);
  }
  styleTable(teacherSheet, [18, 12, 14, 32, 55]);

  const seatSheet = workbook.addWorksheet('考场座次');
  seatSheet.addRow([
    '日期/考试日', '开始时间', '考试科目', '考场', '座号',
    '学号', '姓名', '英文名', '年级', '行政班', '教学班',
  ]);
  for (const session of schedule.sessions) for (const room of session.room_allocations) {
    for (const seat of room.seats || []) {
      const student = students.get(seat.student_id) || {};
      seatSheet.addRow([
        dayDisplay(config, session.day_index, session.day_label),
        session.start_time,
        session.course_name,
        room.room_name,
        seat.seat_number,
        seat.student_id,
        text(student.name || student.chinese_name) || seat.student_id,
        text(student.english_name),
        student.grade ?? '',
        student.admin_class_id || '',
        student.teaching_class_id || '',
      ]);
    }
  }
  styleTable(seatSheet, [16, 12, 24, 14, 9, 16, 16, 16, 9, 16, 16]);
  addPrintableSeatingWorksheets(workbook, schedule, students);

  return Buffer.from(await workbook.xlsx.writeBuffer());
}
