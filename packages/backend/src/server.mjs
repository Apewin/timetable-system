import express from 'express';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import multer from 'multer';
import * as XLSX from 'xlsx';
import { StateRepository } from './state-repository.mjs';
import { validateRules } from './rule-schema.mjs';
import { buildSchedulingProblem } from './problem-builder.mjs';
import { compileRules } from './rule-compiler.mjs';
import { solveSchedule } from './cpsat-solver.mjs';
import { solveFeasibleFirstSchedule } from './feasible-first-solver.mjs';
import { validateSchedule } from './schedule-validator.mjs';
import { approvalGatedRules, enforceApprovalGates, relaxApprovedRules } from './approval-gate.mjs';
import {
  normalizeCourseScope,
  validateCourseClassScopes,
  validateCourseGradeSelections,
  validateSelectionBlocks,
} from './section-builder.mjs';
import { apBlockConfigForState, normalizeApBlockConfig } from './ap-block-sectioning.mjs';
import { applyApSelectionChanges, parseApSelectionBuffer } from './ap-selection-import.mjs';
import {
  applyElectiveSelectionChanges,
  parseElectiveSelectionWorkbook,
} from './elective-selection-import.mjs';
import {
  AI_SCHEDULING_STRATEGY_PROMPT,
  askAiAssistant,
  assistantContextSnapshot,
  getAiConfig,
  interpretWorkbook,
  planSchedulingStrategy,
  saveAiConfig,
  testAiConnection,
} from './llm-workbook-interpreter.mjs';
import {
  emptyManualPlan,
  expandUnlimitedManualHours,
  mergedMeetingLocks,
  resolveManualPlan,
} from './manual-plan.mjs';
import { archiveSummary, createScheduleArchive, stateForScheduleArchive } from './schedule-archive.mjs';
import { synchronizeClassMemberships } from './state-integrity.mjs';
import { synchronizeCourseDeliveryAssignments } from './course-delivery.mjs';
import { applyTeacherAssignmentSwap } from './assistant-actions.mjs';
import {
  GRADUATION_CONFIRMATION,
  graduateStudents,
  graduationArchiveSummary,
  graduationPreview,
} from './graduation.mjs';

const app = express();
const defaultStateFile = fileURLToPath(new URL('../../../timetable.json', import.meta.url));
const repository = new StateRepository(
  process.env.STATE_FILE ? resolve(process.env.STATE_FILE) : defaultStateFile,
);
app.use(express.json({ limit: '2mb' }));
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

async function reply(res, action) {
  try { return res.json({ ok: true, data: await action() }); }
  catch (error) { return res.status(400).json({ ok: false, errors: [{ code: 'BACKEND_ERROR', msg: error.message }] }); }
}

function timetableGrid(state, by, id) {
  const assignments = state.schedule?.assignments || state.assignments || [];
  const field = { student: 'student_id', teacher: 'teacher_id', section: 'section_id', class: 'class_id', room: 'room_id', all: null }[by];
  if (field === undefined) throw new Error(`不支持的课表维度: ${by}`);
  const scheduleSections = state.schedule?.sections || [];
  const adminClass = (state.admin_classes || []).find(item => item.id === id);
  const teachingClass = (state.teaching_classes || []).find(item => item.id === id);
  // A class timetable must account for where its members actually are.  A
  // direct `class_id` filter only returns lessons owned by that particular
  // group and makes every administrative/AP/elective lesson look like an
  // empty period.  For a class view, aggregate each member's real lesson.
  const classMemberIds = by !== 'class' ? [] : adminClass
    ? (state.students || []).filter(student => student.admin_class_id === id).map(student => student.id)
    : teachingClass
      ? [...new Set(scheduleSections.filter(section => section.class_id === id).flatMap(section => section.student_ids || []))]
      : [];
  const selected = by === 'class' && classMemberIds.length
    ? assignments.filter(item => classMemberIds.includes(item.student_id))
    : assignments.filter(item => !field || id === 'all' || item[field] === id);
  const courses = new Map((state.courses || []).map(item => [item.id, item]));
  const teachers = new Map((state.teachers || []).map(item => [item.id, item]));
  const rooms = new Map((state.rooms || []).map(item => [item.id, item]));
  const classes = new Map([...(state.admin_classes || []), ...(state.teaching_classes || [])].map(item => [item.id, item]));
  const sectionsById = new Map(scheduleSections.map(section => [section.id, section]));
  const electiveSectionNumber = assignment => {
    const section = sectionsById.get(assignment.section_id);
    const classType = section?.class_type || assignment.class_type;
    if (classType !== 'ap' && classType !== 'elective') return null;
    const parallel = scheduleSections
      .filter(item => item.class_type === classType && item.course_id === (section?.course_id || assignment.course_id))
      .sort((left, right) => left.id.localeCompare(right.id));
    return Math.max(1, parallel.findIndex(item => item.id === assignment.section_id) + 1);
  };
  const sectionAudienceLabel = assignment => {
    const section = sectionsById.get(assignment.section_id);
    const classId = section?.class_id || assignment.class_id;
    const group = classes.get(classId);
    if (group) {
      const type = (section?.class_type || assignment.class_type) === 'admin' ? '行政班' : '教学班';
      return `${type} · ${group.name || group.id}`;
    }
    const classType = section?.class_type || assignment.class_type;
    if (classType === 'ap' || classType === 'elective') {
      const sectionNumber = electiveSectionNumber(assignment);
      return `${classType === 'ap' ? 'AP 选修班' : '非必修选修班'} · 第 ${sectionNumber} 组`;
    }
    return classId ? `班级 · ${classId}` : '未指定班级';
  };
  const rows = Array.from({ length: 10 }, (_, index) => [`P${index + 1}`, null, null, null, null, null]);
  const display = assignment => {
    const course = courses.get(assignment.course_id);
    const teacher = teachers.get(assignment.teacher_id);
    const room = rooms.get(assignment.room_id);
    return {
      ...assignment,
      course: course?.name || assignment.course_id,
      course_type: course?.type,
      teacher: teacher?.name || assignment.teacher_id || '—',
      room: room?.name || assignment.room_id || '—',
      class_label: sectionAudienceLabel(assignment),
      section_label: electiveSectionNumber(assignment) ? `Section ${electiveSectionNumber(assignment)}` : null,
    };
  };
  if (by === 'class' && classMemberIds.length) {
    const bySlot = new Map();
    for (const assignment of selected) {
      const list = bySlot.get(assignment.slot_id) || [];
      list.push(assignment); bySlot.set(assignment.slot_id, list);
    }
    for (const [slotId, atSlot] of bySlot) {
      const match = /^D(\d+)P(\d+)$/.exec(slotId || '');
      if (!match) continue;
      const day = Number(match[1]); const period = Number(match[2]);
      const bySection = new Map();
      for (const assignment of atSlot) {
        const list = bySection.get(assignment.section_id) || [];
        list.push(assignment); bySection.set(assignment.section_id, list);
      }
      if (bySection.size === 1) rows[period - 1][day] = display(atSlot[0]);
      else {
        const groups = [...bySection.values()].map(group => display(group[0]));
        const labels = [...new Set(groups.map(group => group.course))];
        const groupLabel = group => `${classes.get(group.class_id)?.name || group.class_id || '未命名班级'} ${group.course}`;
        const allAdministrative = groups.every(group => group.class_type === 'admin');
        const allAp = groups.every(group => group.class_type === 'ap');
        const allElective = groups.every(group => group.class_type === 'elective');
        const course = allAdministrative
          ? (labels.length === 1 ? labels[0] : `行政班：${groups.map(groupLabel).join(' / ')}`)
          : allAp
            ? `AP 选课分流（${groups.length} 门并行）：${labels.join(' / ')}`
            : allElective
              ? `选修课分流（${groups.length} 门并行）：${labels.join(' / ')}`
              : `多类课程去向（${groups.length} 组）：${labels.join(' / ')}`;
        rows[period - 1][day] = {
          task_id: '', slot_id: slotId, class_id: id, class_type: 'split',
          course,
          teacher: '请查看学生或 section 课表', room: '—',
          split_groups: groups.map(group => ({
            section_id: group.section_id,
            course: group.course,
            section_label: group.section_label,
            teacher: group.teacher,
            students: bySection.get(group.section_id).length,
          })),
        };
      }
    }
  } else for (const assignment of selected) {
    const match = /^D(\d+)P(\d+)$/.exec(assignment.slot_id || '');
    if (!match) continue;
    const day = Number(match[1]);
    const period = Number(match[2]);
    if (!rows[period - 1] || day < 1 || day > 5) continue;
    // Multiple raw assignments represent different students in the same
    // section.  A timetable cell shows that one shared meeting once.
    if (rows[period - 1][day]) continue;
    rows[period - 1][day] = display(assignment);
  }
  const labels = { student: '学生', teacher: '教师', section: 'section', class: '班级', room: '教室', all: '全部课表' };
  return {
    title: id === 'all' || by === 'all' ? '全部课表' : `${labels[by]} ${id} 的课表`,
    view_type: by, rows, assignments: selected,
    stale: state.solve_status !== 'valid',
  };
}

function buildTaskPlan(state) {
  const problem = buildSchedulingProblem(state, state.constraints || []);
  const teachingTasks = problem.sections.map(section => ({
    id: section.id,
    section_id: section.id,
    course_id: section.course_id,
    teacher_id: section.teacher_id,
    class_id: section.class_id,
    class_type: section.class_type,
    weekly_hours: section.weekly_hours,
    student_ids: section.student_ids,
    eligible_student_ids: section.eligible_student_ids,
    ap_block_id: section.ap_block_id || null,
    ap_block_name: section.ap_block_name || null,
  }));
  return { problem, teachingTasks };
}

function presentationSections(state) {
  // Once inputs change, a previous solve is historical output only.  The
  // sectioning page must show a fresh preview from the current input model,
  // never silently display stale students or section counts.
  const sections = state.solve_status === 'valid' && state.schedule?.sections
    ? state.schedule.sections
    : buildSchedulingProblem(state).sections;
  const courses = new Map((state.courses || []).map(course => [course.id, course]));
  const teachers = new Map((state.teachers || []).map(teacher => [teacher.id, teacher]));
  const students = new Map((state.students || []).map(student => [student.id, student]));
  return sections.filter(section => section.class_type === 'ap' || section.class_type === 'elective').map(section => ({
    ...section,
    course_name: courses.get(section.course_id)?.name || section.course_id,
    course_type: section.class_type === 'ap' ? 'ap' : 'required_elective',
    // Sectioning is often opened directly, before the separate Teachers and
    // Students pages have populated their browser-side caches.  Include the
    // display identities here so a valid teacher is never rendered as
    // "待分配", and roster chips never degrade to opaque student IDs.
    teacher_name: teachers.get(section.teacher_id)?.name || null,
    student_roster: (section.student_ids || []).map(studentId => {
      const student = students.get(studentId);
      return student ? {
        id: student.id,
        name: student.name || null,
        english_name: student.english_name || null,
        grade: student.grade ?? null,
        admin_class_id: student.admin_class_id || null,
        teaching_class_id: student.teaching_class_id || null,
      } : { id: studentId, name: null };
    }),
  }));
}

function expandedAssignments(sections, meetings) {
  const bySection = new Map(sections.map(section => [section.id, section]));
  return meetings.flatMap(meeting => {
    const section = bySection.get(meeting.section_id);
    return (section?.student_ids || []).map(studentId => ({
      task_id: `${section.id}:${studentId}:${meeting.slot_id}`,
      section_id: section.id, student_id: studentId, slot_id: meeting.slot_id, room_id: meeting.room_id,
      teacher_id: section.teacher_id, course_id: section.course_id,
      class_id: section.class_id || section.id, class_type: section.class_type,
    }));
  });
}

function slotLabel(slotId) {
  const match = /^D(\d+)P(\d+)$/.exec(String(slotId || ''));
  if (!match) return String(slotId || '未知时段');
  const weekdays = ['', '周一', '周二', '周三', '周四', '周五'];
  return `${weekdays[Number(match[1])] || `周${match[1]}`}第${match[2]}节`;
}

function classLabelForSection(state, section) {
  const group = [...(state.admin_classes || []), ...(state.teaching_classes || [])]
    .find(item => item.id === section.class_id);
  if (group) return `${section.class_type === 'admin' ? '行政班' : '教学班'} · ${group.name || group.id}`;
  if (section.class_type === 'ap') return 'AP 选修班';
  if (section.class_type === 'elective') return '非必修选修班';
  return section.class_id || '未指定班级';
}

function scheduleMoveProposal(state, { section_id: sectionId, from_slot: fromSlot, to_slot: toSlot } = {}) {
  const schedule = state.schedule;
  if (!schedule || state.solve_status !== 'valid') throw new Error('当前课表不是有效版本，请先完成排课再调整');
  const section = (schedule.sections || []).find(item => item.id === sectionId);
  if (!section) throw new Error('待调整的课程 section 已不存在，请重新请求建议');
  if (!(schedule.meetings || []).some(item => item.section_id === sectionId && item.slot_id === fromSlot)) {
    throw new Error('待调整的原时段已变化，请重新请求建议');
  }
  if ((schedule.locks || []).some(lock => lock.section_id === sectionId && lock.slot_id === fromSlot)) {
    throw new Error('该课程已被锁定为必要条件，不能自动调整');
  }
  const course = (state.courses || []).find(item => item.id === section.course_id);
  return {
    type: 'move_schedule_meeting',
    section_id: sectionId,
    from_slot: fromSlot,
    to_slot: toSlot,
    expected_revision: repository.revision(state),
    title: '调整一节课程时段',
    course_name: course?.name || section.course_id,
    class_label: classLabelForSection(state, section),
    from_label: slotLabel(fromSlot),
    to_label: slotLabel(toSlot),
    impacts: ['会移动该 section 的这一节课；其他同 section 课时不变。', '保存前已通过当前全部硬约束校验。'],
  };
}

function scheduleAfterMeetingMove(state, proposal) {
  const meetings = state.schedule.meetings.map(meeting =>
    meeting.section_id === proposal.section_id && meeting.slot_id === proposal.from_slot
      ? { ...meeting, slot_id: proposal.to_slot }
      : meeting);
  return {
    ...state.schedule,
    meetings,
    assignments: expandedAssignments(state.schedule.sections, meetings),
  };
}

function isAutomaticScheduleAdjustmentRequest(message) {
  const value = String(message || '');
  return /自动\s*(?:调整|调课)|(?:调整|调课)\s*(?:一下|看看|执行|应用)|帮我\s*(?:调整|调课)|按.*(?:方案|建议).*(?:调整|执行)/.test(value);
}

// The model may explain the alternatives conversationally, but an actual
// move is chosen deterministically from locally collision-free candidates and
// is then checked against the full validator before a confirmation card is
// returned. This prevents a natural-language answer from becoming an unsafe
// write operation.
function automaticTeacherScheduleMoveProposal(state, rawContext, message) {
  if (!isAutomaticScheduleAdjustmentRequest(message)) return null;
  const snapshot = assistantContextSnapshot(state, rawContext);
  const candidates = snapshot.selected_teacher_schedule?.move_candidates || [];
  for (const source of candidates) for (const target of source.candidate_targets || []) {
    try {
      const proposal = scheduleMoveProposal(state, {
        section_id: source.section_id,
        from_slot: source.from_slot,
        to_slot: target.slot_id,
      });
      const candidate = scheduleAfterMeetingMove(state, proposal);
      const validation = validateSchedule(problemForSchedule(state, candidate), candidate);
      if (validation.ok) return proposal;
    } catch {
      // This candidate is stale or conflicts with a hard rule. Try the next
      // locally safe target; the user never sees an unusable confirmation.
    }
  }
  return null;
}

function importText(value) { return String(value ?? '').trim(); }
function decodedUploadFilename(value) {
  const original = importText(value);
  const decoded = Buffer.from(original, 'latin1').toString('utf8');
  return decoded.includes('\uFFFD') ? original : decoded;
}
function normalizedName(value) { return importText(value).toLowerCase().replace(/[\s\-–—_+()（）.&/]/g, ''); }
function importedId(prefix, name, index) {
  const stem = importText(name).toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40);
  return `${prefix}_${stem || index + 1}`;
}
function importedGrade(value) {
  const text = importText(value);
  if (/高一|senior\s*1/i.test(text)) return 10;
  if (/高二|senior\s*2/i.test(text)) return 11;
  if (/高三|senior\s*3/i.test(text)) return 12;
  const number = Number(text);
  return Number.isInteger(number) && number >= 1 && number <= 3 ? number + 9 : number;
}
function importedCourseType(value, name = '') {
  const text = `${importText(value)} ${importText(name)}`.toLowerCase();
  if (/ap\s*选修|ap elective|ap\s*course/.test(text)) return 'ap';
  if (/必修选修|required elective/.test(text)) return 'required_elective';
  if (/^ap\b/.test(importText(name).toLowerCase())) return 'ap';
  return 'required';
}
function sectionCount(value) {
  const match = /选修\s*(\d+)|section\s*(\d+)/i.exec(importText(value));
  return match ? Number(match[1] || match[2]) : undefined;
}
function firstValue(row, keys) {
  for (const key of keys) if (row[key] !== undefined && importText(row[key])) return row[key];
  return undefined;
}

function studentGradeFromFilename(filename) {
  const text = importText(filename).toLowerCase();
  const matches = [
    { grade: 10, patterns: [/senior[\s_-]*1\b/i, /2025\s*级/i] },
    { grade: 11, patterns: [/senior[\s_-]*2\b/i, /2024\s*级/i] },
    { grade: 12, patterns: [/senior[\s_-]*3\b/i, /2023\s*级/i] },
  ].filter(item => item.patterns.some(pattern => pattern.test(text)));
  const grades = [...new Set(matches.map(item => item.grade))];
  return grades.length === 1 ? grades[0] : undefined;
}

function normalizedImportHeader(value) {
  return importText(value).toLowerCase().replace(/[\s()（）._-]/g, '');
}

function findStudentNamelistHeader(matrix) {
  for (let rowIndex = 0; rowIndex < Math.min(matrix.length, 20); rowIndex++) {
    const headers = (matrix[rowIndex] || []).map(normalizedImportHeader);
    const indexOf = candidates => headers.findIndex(header => candidates.includes(header));
    const columns = {
      studentId: indexOf(['studentid', '学号', '学生id']),
      chineseName: indexOf(['namechinese', '姓名', '中文名', '名字']),
      pinyinName: indexOf(['namepinyin', '拼音', '姓名拼音']),
      englishName: indexOf(['englishname', '英文名']),
      teachingClass: indexOf(['teachingclass', '教学班']),
      adminClass: indexOf(['class', '行政班', '班级']),
    };
    if (columns.studentId >= 0 && columns.chineseName >= 0 && columns.teachingClass >= 0 && columns.adminClass >= 0) {
      return { rowIndex, columns };
    }
  }
  return undefined;
}

function classSortKey(item) {
  const match = /(\d+)(?!.*\d)/.exec(importText(item.name));
  return match ? Number(match[1]) : Number.MAX_SAFE_INTEGER;
}

function parseStudentNamelist(matrix, filename, state, detectedHeader = findStudentNamelistHeader(matrix)) {
  const grade = studentGradeFromFilename(filename);
  if (!grade) {
    throw new Error('学生名单文件名无法识别年级；请在文件名中保留 senior 1/2/3 或 2025级/2024级/2023级');
  }
  if (!detectedHeader) throw new Error('未找到 Student ID、Name (Chinese)、Teaching Class、Class 表头');

  const { rowIndex, columns } = detectedHeader;
  const sourceRows = matrix.slice(rowIndex + 1)
    .map((row, offset) => ({ row, excelRow: rowIndex + offset + 2 }))
    .filter(({ row }) => importText(row[columns.studentId]) || importText(row[columns.chineseName]));
  const rawAdminClasses = [...new Set(sourceRows.map(({ row }) => importText(row[columns.adminClass])).filter(Boolean))]
    .sort((left, right) => left.localeCompare(right, 'zh-CN', { numeric: true }));
  const adminClasses = (state.admin_classes || []).filter(item => Number(item.grade) === grade)
    .sort((left, right) => classSortKey(left) - classSortKey(right) || left.id.localeCompare(right.id));
  if (rawAdminClasses.length > adminClasses.length) {
    throw new Error(`文件中有 ${rawAdminClasses.length} 个行政班编码，但系统高${grade - 9}只有 ${adminClasses.length} 个行政班`);
  }
  const adminClassMap = new Map(rawAdminClasses.map((raw, index) => [raw, adminClasses[index]?.id]));
  const teachingClasses = (state.teaching_classes || []).filter(item => Number(item.grade) === grade);
  const errors = [];
  const seenIds = new Set();
  const data = [];

  for (const { row, excelRow } of sourceRows) {
    const id = importText(row[columns.studentId]);
    const name = importText(row[columns.chineseName]);
    const rawTeachingClass = importText(row[columns.teachingClass]);
    const rawAdminClass = importText(row[columns.adminClass]);
    const teachingNumber = Number(rawTeachingClass);
    const teachingClass = teachingClasses.find(item =>
      item.id === rawTeachingClass ||
      (Number.isInteger(teachingNumber) && item.id === `TC_G${grade}_${teachingNumber}`),
    );
    const adminClassId = adminClasses.some(item => item.id === rawAdminClass)
      ? rawAdminClass
      : adminClassMap.get(rawAdminClass);
    const rowErrors = [];
    if (!id) rowErrors.push('缺少 Student ID');
    if (!name) rowErrors.push('缺少中文姓名');
    if (!teachingClass) rowErrors.push(`Teaching Class “${rawTeachingClass || '空'}” 无法映射到系统教学班`);
    if (!adminClassId) rowErrors.push(`Class “${rawAdminClass || '空'}” 无法映射到系统行政班`);
    if (id && seenIds.has(id)) rowErrors.push(`Student ID ${id} 在文件中重复`);
    if (rowErrors.length) {
      errors.push({ row: excelRow, msg: `第 ${excelRow} 行：${rowErrors.join('；')}` });
      continue;
    }
    seenIds.add(id);
    data.push({
      id,
      name,
      pinyin_name: columns.pinyinName >= 0 ? importText(row[columns.pinyinName]) : '',
      english_name: columns.englishName >= 0 ? importText(row[columns.englishName]) : '',
      grade,
      admin_class_id: adminClassId,
      teaching_class_id: teachingClass.id,
      source_admin_class: rawAdminClass,
      source_teaching_class: rawTeachingClass,
      courses: [],
      required_courses: [],
      elective_courses: [],
      ap_courses: [],
      elective_choices: {},
    });
  }

  return {
    type: 'students',
    data,
    errors,
    headers: ['id', 'name', 'english_name', 'pinyin_name', 'grade', 'admin_class_id', 'teaching_class_id'],
    totalRows: sourceRows.length,
    importContext: {
      grade,
      grade_source: 'filename',
      admin_class_mapping: Object.fromEntries(rawAdminClasses.map(raw => [
        raw,
        adminClasses.find(item => item.id === adminClassMap.get(raw))?.name || adminClassMap.get(raw),
      ])),
      teaching_class_mapping: Object.fromEntries(
        [...new Set(sourceRows.map(({ row }) => importText(row[columns.teachingClass])).filter(Boolean))]
          .map(raw => {
            const number = Number(raw);
            const match = teachingClasses.find(item => item.id === raw || item.id === `TC_G${grade}_${number}`);
            return [raw, match?.name || match?.id];
          }),
      ),
    },
  };
}

function parseStandardImport(rows) {
  const headers = Object.keys(rows[0] || {});
  const headerText = headers.join(' ').toLowerCase();
  let type;
  if (/学号|学生|student/.test(headerText)) type = 'students';
  else if (/工号|教师|teacher/.test(headerText)) type = 'teachers';
  else if (/教室|room/.test(headerText)) type = 'rooms';
  else if (/课程|course/.test(headerText)) type = 'courses';
  else type = 'unknown';
  const errors = [];
  const data = rows.map((row, index) => {
    if (type === 'students') return {
      id: importText(firstValue(row, ['学号', '学生ID', 'ID', 'id'])) || importedId('S', firstValue(row, ['姓名', 'name']), index),
      name: importText(firstValue(row, ['姓名', '名字', 'name'])),
      english_name: importText(firstValue(row, ['英文名', 'English Name', 'english_name'])),
      pinyin_name: importText(firstValue(row, ['姓名拼音', '拼音', 'Name (Pinyin)', 'pinyin_name'])),
      grade: importedGrade(firstValue(row, ['年级', 'grade'])),
      admin_class_id: importText(firstValue(row, ['行政班', '班级', 'admin_class'])),
      teaching_class_id: importText(firstValue(row, ['教学班', 'teaching_class'])),
      ap_courses: [], elective_choices: {},
    };
    if (type === 'teachers') return {
      id: importText(firstValue(row, ['工号', '教师ID', 'ID', 'id'])) || importedId('T', firstValue(row, ['姓名', 'name']), index),
      name: importText(firstValue(row, ['姓名', '名字', 'name'])),
      can_teach: importText(firstValue(row, ['可教课程', '课程', 'courses'])).split(/[,，、]/).map(importText).filter(Boolean),
      max_per_day: Number(firstValue(row, ['每日上限', 'max_per_day'])) || 6,
      max_per_week: Number(firstValue(row, ['每周上限', 'max_per_week'])) || 25,
    };
    if (type === 'rooms') return {
      id: importText(firstValue(row, ['教室编号', '教室ID', 'ID', 'id'])) || importedId('R', firstValue(row, ['教室名称', 'name']), index),
      name: importText(firstValue(row, ['教室名称', '名称', 'name'])),
      type: importText(firstValue(row, ['类型', 'type'])) || 'general',
      capacity: Number(firstValue(row, ['容量', 'capacity'])) || 30,
    };
    if (type === 'courses') {
      const name = importText(firstValue(row, ['课程名称', '名称', 'name']));
      const classType = importText(firstValue(row, ['班级类型', 'section_type']));
      return {
        id: importText(firstValue(row, ['课程编号', '课程ID', 'ID', 'id'])) || importedId('C', name, index),
        name,
        type: importedCourseType(firstValue(row, ['课程类型', '类型', 'type']), name),
        weekly_hours: Number(firstValue(row, ['每周课程数', '周课时', '课时', 'weekly_hours'])) || 1,
        section_count: sectionCount(classType) || sectionCount(firstValue(row, ['选修班数', 'section_count'])),
      };
    }
    return { ...row };
  });
  for (const [index, item] of data.entries()) if (type !== 'unknown' && !item.name) errors.push({ row: index + 2, msg: '缺少名称' });
  return { type, data, errors, headers };
}

// The school's planning workbook has three side-by-side grade blocks.  Parse
// its semantic fields rather than treating merged headings as arbitrary CSV.
function parseCourseArrangement(rows) {
  const blocks = [
    { grade: 10, start: 0, width: 6 },
    { grade: 11, start: 7, width: 6 },
    { grade: 12, start: 14, width: 5 },
  ];
  const data = [];
  for (const block of blocks) {
    let carriedName = '';
    let carriedHours = 0;
    let carriedCourseType = '';
    for (let rowIndex = 2; rowIndex < rows.length; rowIndex++) {
      const row = rows[rowIndex] || [];
      const cells = row.slice(block.start, block.start + block.width).map(importText);
      const [main, detail, rawType, rawHours, classType, teacher] = block.width === 5
        ? [cells[0], '', cells[1], cells[2], cells[3], cells[4]]
        : cells;
      if (main) carriedName = main;
      if (rawType) carriedCourseType = rawType;
      const name = main || detail;
      if (!name || /^补充笔记|合计/.test(name)) continue;
      const hours = Number(rawHours) || carriedHours || (/(选修|ap)/i.test(`${rawType} ${name}`) ? 5 : 0);
      if (Number(rawHours)) carriedHours = Number(rawHours);
      if (!hours) continue;
      data.push({
        grade: block.grade,
        course_name: name,
        parent_course_name: main ? '' : carriedName,
        // In the Senior 3 sheet, the first row of an A/B/C elective group
        // names its type and following choices leave the cell blank.
        course_type: importedCourseType(rawType || carriedCourseType, name),
        weekly_hours: hours,
        class_type: classType,
        section_count: sectionCount(classType),
        teacher_name: teacher,
      });
    }
  }
  return { type: 'course_arrangement', data, errors: [], headers: ['年级', '课程名称', '课程类型', '每周课程数', '班级类型', '教师'] };
}

function applyImportedRows(state, type, rows) {
  if (!Array.isArray(rows)) throw new Error('导入数据必须是数组');
  if (type === 'course_arrangement') {
    const courses = [...(state.courses || [])];
    const courseByName = new Map(courses.map(course => [normalizedName(course.name), course]));
    const teacherByName = new Map((state.teachers || []).map(teacher => [normalizedName(teacher.name), teacher]));
    const requirements = new Map();
    const skipped = [];
    for (const row of rows) {
      if (!['ap', 'required_elective'].includes(row.course_type) || !row.section_count) continue;
      const course = courseByName.get(normalizedName(row.course_name));
      if (!course) { skipped.push(`${row.course_name}（未匹配现有课程）`); continue; }
      const teacher = teacherByName.get(normalizedName(row.teacher_name));
      if (!teacher || !(teacher.can_teach || []).includes(course.id)) { skipped.push(`${row.course_name}（未匹配可授课教师）`); continue; }
      const list = requirements.get(course.id) || [];
      list.push({ grades: [row.grade], count: row.section_count, teacher_id: teacher.id });
      requirements.set(course.id, list);
    }
    let imported = 0;
    const nextCourses = courses.map(course => {
      const sectionRequirements = requirements.get(course.id);
      if (!sectionRequirements?.length) return course;
      imported++;
      return { ...course, section_requirements: sectionRequirements, section_count: Math.max(...sectionRequirements.map(item => item.count)) };
    });
    return { next: changedState(state, 'courses', nextCourses), imported, skipped: skipped.length, notes: skipped };
  }
  if (!['students', 'teachers', 'courses', 'rooms'].includes(type)) throw new Error(`不支持导入类型: ${type}`);
  const current = state[type] || [];
  const ids = new Set(current.map(item => item.id));
  const additions = rows.filter(item => item?.id && !ids.has(item.id));
  const nextItems = [...current, ...additions];
  const next = changedState(state, type, nextItems);
  return { next, imported: additions.length, skipped: rows.length - additions.length, notes: [] };
}

// A generated schedule is allowed to refine the input section roster.  This
// helper keeps the problem model and compiled rule targets in sync with those
// saved refinements, which is essential when a section's teacher or students
// are changed from the administration UI.
function problemForSchedule(state, schedule) {
  const base = buildSchedulingProblem(state, schedule.rules || state.constraints || []);
  const overrides = new Map((schedule.sections || []).map(section => [section.id, section]));
  const sections = base.sections.map(section => {
    const override = overrides.get(section.id);
    if (!override) return section;
    return {
      ...section,
      ...override,
      id: section.id,
      student_ids: [...(override.student_ids || [])],
      eligible_student_ids: [...(override.eligible_student_ids || section.eligible_student_ids || [])],
      room_id: null,
      room_candidates: [],
      room_binding: 'disabled',
      capacity: null,
    };
  });
  const activeRules = (schedule.rules || state.constraints || []).filter(rule => rule.scope !== 'room');
  return { ...base, sections, rules: compileRules(state, activeRules, { sections }) };
}

function candidateScheduleForSections(state, nextSections) {
  if (!state.schedule) throw new Error('尚未生成课表；请先完成排课后再调整分班');
  return {
    ...state.schedule,
    sections: nextSections,
    assignments: expandedAssignments(nextSections, state.schedule.meetings),
  };
}

function saveValidatedScheduleEdit(
  state,
  nextSections,
  sectionOverrides = state.section_overrides,
  expectedRevision = repository.revision(state),
) {
  const schedule = candidateScheduleForSections(state, nextSections);
  const validation = validateSchedule(problemForSchedule(state, schedule), schedule);
  if (!validation.ok) {
    const first = validation.hard_violations[0];
    throw new Error(`此次调整不会保存：${first?.message || '违反硬约束'}`);
  }
  const saved = { ...schedule, validation };
  repository.write(
    { ...state, section_overrides: sectionOverrides, assignments: saved.assignments, schedule: saved, solve_status: 'valid' },
    { expectedRevision },
  );
  return { validation, sections: presentationSections({ ...state, schedule: saved }) };
}

async function saveOrReplanSectionEdit(state, nextSections, sectionOverrides, { replan = false } = {}) {
  const expectedRevision = repository.revision(state);
  const candidate = candidateScheduleForSections(state, nextSections);
  const directValidation = validateSchedule(problemForSchedule({ ...state, section_overrides: sectionOverrides }, candidate), candidate);
  if (directValidation.ok) return {
    ...saveValidatedScheduleEdit(state, nextSections, sectionOverrides, expectedRevision),
    replanned: false,
  };
  if (!replan) {
    const first = directValidation.hard_violations[0];
    throw new Error(`此次调整会与当前课表冲突：${first?.message || '违反硬约束'}；可选择“重新排课后保存”`);
  }
  // Preserve the administrative intent in the input model, then solve the
  // entire coupled timetable before writing anything.  If no feasible result
  // exists, the repository remains untouched.
  const preparedState = { ...state, section_overrides: sectionOverrides };
  const rules = state.schedule.rules || state.constraints || [];
  const problem = buildSchedulingProblem(preparedState, rules);
  const solution = await solveSchedule(problem, {
    maxTimeSeconds: 120,
    optimizeSoft: true,
    lockedMeetings: state.schedule.locks || [],
  });
  if (!solution.ok) throw new Error(`重新排课失败：${solution.reason || solution.status}`);
  const validation = validateSchedule(problem, { ...solution, locks: state.schedule.locks || [] });
  if (!validation.ok) throw new Error(`重新排课结果未通过校验：${validation.hard_violations[0]?.message || '未知错误'}`);
  const schedule = {
    version: state.schedule.version || 1,
    created_at: new Date().toISOString(),
    solver_status: solution.status,
    rules,
    sections: solution.sections,
    meetings: solution.meetings,
    assignments: solution.assignments,
    validation,
    locks: state.schedule.locks || [],
  };
  repository.write(
    { ...preparedState, assignments: solution.assignments, schedule, solve_status: 'valid' },
    { expectedRevision },
  );
  return { validation, sections: presentationSections({ ...preparedState, schedule }), replanned: true };
}

app.get('/api/status', (_req, res) => reply(res, () => {
  const state = repository.read();
  return {
    backend: 'rules-first-v1',
    school: state.meta?.school,
    last_stage: state.solve_status === 'stale' ? 'needs_resolve' : state.solve_status === 'valid' ? 'timetable' : state.section_plan ? 'sections' : 'not_run',
      counts: Object.fromEntries(['teachers', 'rooms', 'courses', 'students', 'admin_classes', 'teaching_classes', 'selection_blocks', 'constraints']
      .map(key => [key, state[key]?.length || 0]).concat([
        ['assignments', state.schedule?.assignments?.length || state.assignments?.length || 0],
        ['schedule_archives', state.schedule_archives?.length || 0],
      ])),
    solve_status: state.solve_status || 'not_run',
  };
}));

app.get('/api/state', (_req, res) => reply(res, () => repository.read()));
app.get('/api/rules', (_req, res) => reply(res, () => repository.read().constraints || []));

app.put('/api/rules', (req, res) => reply(res, () => {
  validateRules(req.body?.rules);
  const state = repository.read();
  return repository.write(changedState(state, 'constraints', req.body.rules)).constraints;
}));
app.post('/api/rules/compile', (req, res) => reply(res, () => {
  const state = repository.read();
  const rules = req.body?.rules ?? state.constraints ?? [];
  validateRules(rules);
  return buildSchedulingProblem(state, rules).rules;
}));
app.post('/api/solve/preview', (req, res) => reply(res, () => {
  const state = repository.read();
  const rules = req.body?.rules ?? state.constraints ?? [];
  validateRules(rules);
  const lockedMeetings = activeMeetingLocks(state);
  const problem = expandUnlimitedManualHours(
    state,
    buildSchedulingProblem(state, rules),
    lockedMeetings,
  );
  return { diagnostics: problem.diagnostics, rules: problem.rules };
}));

app.post('/api/build-tasks', (_req, res) => reply(res, () => {
  const state = repository.read();
  const { problem, teachingTasks } = buildTaskPlan(state);
  repository.write({ ...state, teaching_tasks: teachingTasks, section_plan: { sections: problem.sections, diagnostics: problem.diagnostics } });
  return { tasks_generated: problem.diagnostics.meetings, sections_generated: problem.sections.length, teaching_tasks: teachingTasks };
}));

app.post('/api/solve-sections', (_req, res) => reply(res, () => {
  const state = repository.read();
  const { problem, teachingTasks } = buildTaskPlan(state);
  repository.write({ ...state, teaching_tasks: teachingTasks, section_plan: { sections: problem.sections, diagnostics: problem.diagnostics } });
  const sections = presentationSections({ ...state, section_plan: { sections: problem.sections } });
  return {
    sections,
    statistics: {
      ap_sections: sections.filter(section => section.course_type === 'ap').length,
      elective_sections: sections.filter(section => section.course_type === 'required_elective').length,
      total_sections: sections.length,
      total_tasks: problem.diagnostics.meetings,
    },
  };
}));

app.get('/api/validate-input', (_req, res) => reply(res, () => {
  const state = repository.read();
  validateRules(state.constraints || []);
  const problem = buildSchedulingProblem(state, state.constraints || []);
  return { ok: true, errors: [], diagnostics: problem.diagnostics };
}));

app.get('/api/elective-sections', (_req, res) => reply(res, () => {
  const state = repository.read();
  return presentationSections(state);
}));

app.get('/api/ap-block-config', (_req, res) => reply(res, () => {
  const state = repository.read();
  const courses = (state.courses || []).filter(course => course.type === 'ap').map(course => ({
    id: course.id,
    name: course.name || course.id,
    grade: course.grade,
    weekly_hours: course.weekly_hours,
    section_count: course.section_count,
  }));
  const offerings = courses.flatMap(course => {
    const source = (state.courses || []).find(item => item.id === course.id);
    if (!(source.section_requirements || []).length) {
      return [{ id: course.id, course_id: course.id, name: course.name, weekly_hours: course.weekly_hours }];
    }
    return source.section_requirements.map(requirement => {
      const grades = [...new Set((requirement.grades || []).map(Number))].sort((left, right) => left - right);
      const label = grades.map(grade => `Senior ${grade - 9}`).join(' / ');
      return {
        id: `${course.id}:G${grades.join('_G')}`,
        course_id: course.id,
        name: `${course.name} · ${label}`,
        weekly_hours: course.weekly_hours,
      };
    });
  });
  return { config: apBlockConfigForState(state), courses, offerings };
}));

app.put('/api/ap-block-config', (req, res) => reply(res, () => {
  const state = repository.read();
  const config = normalizeApBlockConfig(req.body, state.courses || []);
  // Section IDs in Block mode encode the Block itself.  AP roster overrides
  // created in normal parallel-section mode would therefore point at a
  // different cohort and must not be carried across this explicit mode change.
  const sectionOverrides = Object.fromEntries(Object.entries(state.section_overrides || {})
    .filter(([sectionId]) => !sectionId.startsWith('SEC_AP_')));
  const saved = repository.write(changedState(state, 'ap_block_config', config, { section_overrides: sectionOverrides }));
  return {
    config: apBlockConfigForState(saved),
    message: config.enabled
      ? '已启用 AP Block 模式；AP 分班和课表已标记为需要重新生成'
      : '已切回普通 AP 平行分班模式；AP 分班和课表已标记为需要重新生成',
  };
}));

app.get('/api/elective-sections/suggestions', (_req, res) => reply(res, () => ({ suggestions: [] })));

app.put('/api/elective-sections/:id', (req, res) => reply(res, async () => {
  const state = repository.read();
  if (!state.schedule) throw new Error('尚未生成课表；请先完成排课后再编辑 section');
  if (state.solve_status !== 'valid') throw new Error('当前输入已变更，旧课表已过期；请先重新排课再编辑 section');
  const sectionId = req.params.id;
  const current = state.schedule.sections.find(section => section.id === sectionId);
  if (!current || !['ap', 'elective'].includes(current.class_type)) throw new Error(`找不到可编辑的选修 section: ${sectionId}`);
  const changes = req.body || {};
  const allowed = new Set(['teacher_id', 'student_ids', 'replan']);
  for (const key of Object.keys(changes)) if (!allowed.has(key)) throw new Error(`不支持编辑字段: ${key}`);
  if (!Object.keys(changes).length) throw new Error('没有提供要修改的内容');
  const updated = { ...current };
  if (Object.hasOwn(changes, 'teacher_id')) {
    const teacher = (state.teachers || []).find(item => item.id === changes.teacher_id);
    if (!teacher || !(teacher.can_teach || []).includes(current.course_id)) {
      throw new Error('必须选择一位能教授本课程的教师');
    }
    updated.teacher_id = teacher.id;
  }
  if (Object.hasOwn(changes, 'student_ids')) {
    throw new Error('学生不能从选修课程中直接移除；请使用“转至平行班”以保持选课归属完整');
  }
  const sections = state.schedule.sections.map(section => section.id === sectionId ? updated : section);
  const sectionOverrides = structuredClone(state.section_overrides || {});
  sectionOverrides[sectionId] = { ...sectionOverrides[sectionId], teacher_id: updated.teacher_id };
  const result = await saveOrReplanSectionEdit(state, sections, sectionOverrides, { replan: changes.replan === true });
  return {
    message: result.replanned ? 'section 已更新；已重新排课并通过完整硬约束校验' : 'section 已更新并通过完整硬约束校验',
    section: result.sections.find(section => section.id === sectionId), validation: result.validation, replanned: result.replanned,
  };
}));

// Moving a student is atomic: removing from one parallel section and adding
// to another happens in one write, so an accidental transient "unassigned"
// roster can never reach the saved timetable.
app.post('/api/elective-sections/:id/move-student', (req, res) => reply(res, async () => {
  const state = repository.read();
  if (!state.schedule) throw new Error('尚未生成课表；请先完成排课后再调整学生分班');
  if (state.solve_status !== 'valid') throw new Error('当前输入已变更，旧课表已过期；请先重新排课再调整学生分班');
  const target = state.schedule.sections.find(section => section.id === req.params.id);
  const studentId = req.body?.student_id;
  if (!target || !['ap', 'elective'].includes(target.class_type)) throw new Error('目标必须是一个选修 section');
  if (typeof studentId !== 'string') throw new Error('必须提供 student_id');
  if (!(target.eligible_student_ids || []).includes(studentId)) throw new Error('该学生没有选择目标课程，不能转入');
  const parallel = state.schedule.sections.filter(section => section.course_id === target.course_id && section.class_type === target.class_type);
  const source = parallel.find(section => section.id !== target.id && (section.student_ids || []).includes(studentId));
  if (!source) throw new Error('该学生当前不在此课程的其他平行 section 中');
  if ((target.student_ids || []).includes(studentId)) throw new Error('该学生已在目标 section 中');
  const sections = state.schedule.sections.map(section => {
    if (section.id === source.id) return { ...section, student_ids: section.student_ids.filter(id => id !== studentId) };
    if (section.id === target.id) return { ...section, student_ids: [...section.student_ids, studentId] };
    return section;
  });
  const sectionOverrides = structuredClone(state.section_overrides || {});
  for (const section of parallel) {
    const override = sectionOverrides[section.id];
    if (!override) continue;
    const locked = (override.locked_student_ids || []).filter(id => id !== studentId);
    if (locked.length) sectionOverrides[section.id] = { ...override, locked_student_ids: locked };
    else {
      const remaining = { ...override };
      delete remaining.locked_student_ids;
      if (Object.keys(remaining).length) sectionOverrides[section.id] = remaining;
      else delete sectionOverrides[section.id];
    }
  }
  const targetOverride = sectionOverrides[target.id] || {};
  sectionOverrides[target.id] = {
    ...targetOverride,
    locked_student_ids: [...new Set([...(targetOverride.locked_student_ids || []), studentId])],
  };
  const result = await saveOrReplanSectionEdit(state, sections, sectionOverrides, { replan: req.body?.replan === true });
  return {
    message: result.replanned ? '学生已转班；系统已重新排课并通过完整硬约束校验' : '学生已转入目标 section，并通过完整硬约束校验',
    from_section_id: source.id, to_section_id: target.id, validation: result.validation, replanned: result.replanned,
  };
}));

function activeMeetingLocks(state, extraLocks = []) {
  const manualPlan = state.manual_plan || emptyManualPlan();
  const savedScheduleLocks = (state.schedule?.locks || [])
    .filter(lock => lock.origin !== 'manual' || manualPlan.status === 'confirmed');
  const confirmedManualLocks = manualPlan.status === 'confirmed' ? manualPlan.locks || [] : [];
  return mergedMeetingLocks(savedScheduleLocks, confirmedManualLocks, extraLocks);
}

function problemWithAiStrategy(problem, strategy) {
  if (!strategy) return problem;
  const weightOverrides = strategy.soft_rule_weight_overrides || {};
  const rules = (problem.rules || []).map(rule => (
    !rule.hard && Object.hasOwn(weightOverrides, rule.id)
      ? { ...rule, weight: weightOverrides[rule.id] }
      : rule
  ));
  for (const [index, sectionId] of (strategy.priority_section_ids || []).entries()) {
    rules.push({
      id: `ai_priority_${index + 1}_${sectionId}`,
      name: `AI 搜索优先级 ${index + 1}`,
      type: 'priority',
      hard: false,
      weight: 0,
      scope: 'section',
      target_ids: [sectionId],
      section_target_ids: [sectionId],
      params: { rank: index + 1 },
      unmatched: false,
    });
  }
  return { ...problem, rules };
}

async function solveAndPersist(state, body = {}, { strategy = null, strategyWarnings = [] } = {}) {
  const expectedRevision = repository.revision(state);
  const rules = body.rules ?? body.constraints ?? state.constraints ?? [];
  validateRules(rules);
  const lockedMeetings = activeMeetingLocks(state);
  const problem = expandUnlimitedManualHours(
    state,
    buildSchedulingProblem(state, rules),
    lockedMeetings,
  );
  const approvedRuleIds = body.approved_rule_relaxations || [];
  if (!Array.isArray(approvedRuleIds) || !approvedRuleIds.every(id => typeof id === 'string')) {
    throw new Error('approved_rule_relaxations 必须是规则 ID 数组');
  }
  const waitingForApproval = approvalGatedRules(problem, approvedRuleIds);
  // AI may influence decision order and temporary soft weights only. Approval
  // gates and manual locks remain executable solver constraints.
  const guardedProblem = problemWithAiStrategy(
    enforceApprovalGates(relaxApprovedRules(problem, approvedRuleIds)),
    strategy,
  );
  const requestedSeconds = Number(body.max_time_seconds ?? (body.timeout ? Number(body.timeout) / 1000 : 120));
  const maxTimeSeconds = Math.min(
    600,
    Math.max(5, Number.isFinite(requestedSeconds) ? requestedSeconds : 120),
  );
  const requestedCandidateCount = Number(body.candidate_count ?? 1);
  const candidateCount = Number.isFinite(requestedCandidateCount)
    ? Math.min(5, Math.max(1, Math.floor(requestedCandidateCount)))
    : 1;
  // A previous timetable is a useful repair hint for ordinary incremental
  // changes.  In Block mode, though, it can preserve an already scattered AP
  // layer and prevent the compact-band objective from exploring a new global
  // arrangement.  Manual gold-frame locks remain hard in either case.
  const preservePriorTimetableAsHint = problem.diagnostics?.ap_block_mode?.enabled !== true;
  const priorMeetings = preservePriorTimetableAsHint && state.solve_status === 'valid'
    ? state.schedule?.meetings || []
    : [];
  const priorSections = preservePriorTimetableAsHint && state.solve_status === 'valid'
    ? state.schedule?.sections || []
    : [];
  const solveStartedAt = performance.now();
  const feasibleFirst = body.feasible_first !== false;
  const solution = feasibleFirst
    ? await solveFeasibleFirstSchedule(guardedProblem, {
      maxTimeSeconds,
      candidateCount,
      randomSeed: Number.isInteger(body.random_seed) ? body.random_seed : 20260803,
      freezeMembership: body.lock_section_rosters === true,
      lockedMeetings,
      hintMeetings: priorMeetings,
      hintSections: priorSections,
    })
    : await solveSchedule(guardedProblem, {
      maxTimeSeconds,
      optimizeSoft: body.optimize_soft !== false,
      freezeMembership: body.lock_section_rosters === true,
      lockedMeetings,
    });
  const solveDurationMs = Math.round(performance.now() - solveStartedAt);
  const diagnosticFields = {
    solve_duration_ms: solveDurationMs,
    manual_lock_count: lockedMeetings.filter(lock => lock.origin === 'manual').length,
    ai_strategy: strategy,
    ai_warnings: strategyWarnings,
    incomplete_required_choices: problem.diagnostics.incomplete_required_choices || [],
  };
  if (!solution.ok) {
    if (waitingForApproval.length) return {
      solved: false,
      status: 'NEEDS_APPROVAL_TO_RELAX',
      reason: '在不破坏受保护软规则的前提下无解；系统没有自动放宽规则。',
      blocked_by: waitingForApproval.map(rule => ({ id: rule.id, name: rule.name || rule.id, type: rule.type, scope: rule.scope })),
      diagnostic: solution.reason || solution.status,
      ...diagnosticFields,
    };
    return {
      solved: false,
      status: solution.status,
      reason: solution.reason || '未在时限内找到满足硬约束的课表',
      ...diagnosticFields,
    };
  }
  const validationProblem = solution.effective_rules
    ? { ...guardedProblem, rules: solution.effective_rules }
    : problem;
  const validation = validateSchedule(validationProblem, { ...solution, locks: lockedMeetings });
  if (!validation.ok) throw new Error(`求解器结果未通过独立校验: ${validation.hard_violations[0]?.message || '未知错误'}`);
  const deferredRuleIds = new Set(solution.deferred_rule_ids || []);
  const savedRules = deferredRuleIds.size
    ? rules.map(rule => deferredRuleIds.has(rule.id)
      ? {
        ...rule,
        hard: false,
        weight: Math.max(1, Number(
          solution.effective_rules.find(item => item.id === rule.id)?.weight || 100,
        )),
      }
      : rule)
    : rules;
  const schedule = {
    version: (state.schedule?.version || 0) + 1,
    created_at: new Date().toISOString(),
    solver_status: solution.status,
    solve_duration_ms: solveDurationMs,
    rules: savedRules,
    sections: solution.sections,
    meetings: solution.meetings,
    assignments: solution.assignments,
    validation,
    algorithm: solution.algorithm || 'exact-cp-sat',
    deferred_rule_ids: [...deferredRuleIds],
    review_required: solution.review_required === true,
    review_items: solution.review_items || [],
    quality_score: solution.quality_score ?? validation.soft_score,
    candidate_count: solution.candidate_count || 1,
    relaxation_approvals: approvedRuleIds.filter(id =>
      (problem.rules || []).some(rule => rule.id === id && rule.requires_approval_to_relax === true))
      .map(rule_id => ({ rule_id, approved_at: new Date().toISOString() })),
    locks: lockedMeetings,
    ai_strategy: strategy,
    ai_warnings: strategyWarnings,
  };
  const manualPlan = state.manual_plan?.status === 'confirmed'
    ? {
      ...state.manual_plan,
      last_solve: {
        solved_at: schedule.created_at,
        schedule_version: schedule.version,
        solve_duration_ms: solveDurationMs,
        status: solution.status,
      },
    }
    : state.manual_plan;
  try {
    repository.write({
      ...state,
      ...(manualPlan ? { manual_plan: manualPlan } : {}),
      assignments: solution.assignments,
      schedule,
      solve_status: 'valid',
    }, { expectedRevision });
  } catch (error) {
    if (error.code !== 'STATE_VERSION_CONFLICT') throw error;
    return {
      solved: false,
      status: 'STATE_CHANGED_DURING_SOLVE',
      reason: '排课期间学生、课程、规则或手动条件已被修改；系统已保留最新修改且没有保存旧快照结果，请重新排课。',
      ...diagnosticFields,
    };
  }
  return {
    solved: true,
    status: solution.status,
    assignments: solution.assignments,
    validation,
    hard_violations: validation.hard_violations,
    soft_violations: validation.soft_violations,
    soft_score: validation.soft_score,
    algorithm: schedule.algorithm,
    review_required: schedule.review_required,
    review_items: schedule.review_items,
    deferred_rule_ids: schedule.deferred_rule_ids,
    quality_score: schedule.quality_score,
    candidate_count: schedule.candidate_count,
    approved_rule_relaxations: schedule.relaxation_approvals.map(item => item.rule_id),
    ...diagnosticFields,
  };
}

app.post('/api/solve', (req, res) => reply(res, async () =>
  solveAndPersist(repository.read(), req.body || {})));

function manualEditingProblem(state) {
  try {
    return {
      problem: buildSchedulingProblem(state, state.constraints || []),
      catalog_warning: null,
    };
  } catch (error) {
    if (!(state.schedule?.sections || []).length) throw error;
    // Manual planning is intentionally the first scheduling step, so the page
    // must still open while other inputs are incomplete. A stale generated
    // section catalog is safe for drafting because any later input edit marks
    // confirmed locks stale and requires explicit re-confirmation.
    return {
      problem: {
        slots: Array.from({ length: 50 }, (_, index) => ({
          id: `D${Math.floor(index / 10) + 1}P${index % 10 + 1}`,
          day: Math.floor(index / 10) + 1,
          period: index % 10 + 1,
        })),
        sections: state.schedule.sections.map(section => ({
          ...section,
          room_id: null,
          room_candidates: [],
          room_binding: 'disabled',
          capacity: null,
        })),
        rooms: [],
        rules: [],
      },
      catalog_warning: `当前输入尚未通过完整建模校验，手动草稿暂用上一次 section 目录：${error.message}`,
    };
  }
}

function manualPlanData(state) {
  const { problem, catalog_warning: catalogWarning } = manualEditingProblem(state);
  return {
    ...(state.manual_plan || emptyManualPlan()),
    ai: {
      configured: getAiConfig().configured,
      prompt_version: 'manual-lock-strategy-v1',
      prompt: AI_SCHEDULING_STRATEGY_PROMPT,
    },
    catalog: {
      warning: catalogWarning,
      sections: problem.sections.map(section => ({
        id: section.id,
        course_id: section.course_id,
        class_id: section.class_id,
        class_type: section.class_type,
        grades: section.grades,
        weekly_hours: section.weekly_hours,
        teacher_id: section.teacher_id,
      })),
    },
  };
}

app.get('/api/manual-plan', (_req, res) => reply(res, () =>
  manualPlanData(repository.read())));

app.put('/api/manual-plan/draft', (req, res) => reply(res, () => {
  const state = repository.read();
  const current = state.manual_plan || emptyManualPlan();
  if (current.status === 'confirmed') {
    throw new Error('必要条件已经确认；如需修改，请先点击“解除必要条件”');
  }
  const { problem } = manualEditingProblem(state);
  const resolved = resolveManualPlan(state, problem, req.body?.placements || []);
  const manualPlan = {
    ...current,
    status: 'draft',
    draft_revision: (current.draft_revision || 0) + 1,
    updated_at: new Date().toISOString(),
    placements: resolved.placements,
    locks: [],
    issues: resolved.issues,
    counts: resolved.counts,
  };
  repository.write({ ...state, manual_plan: manualPlan });
  return manualPlanData({ ...state, manual_plan: manualPlan });
}));

app.post('/api/manual-plan/confirm', (req, res) => reply(res, () => {
  const state = repository.read();
  const current = state.manual_plan || emptyManualPlan();
  const rawPlacements = req.body?.placements ?? current.placements;
  const { problem } = manualEditingProblem(state);
  const resolved = resolveManualPlan(state, problem, rawPlacements);
  if (!resolved.placements.length) throw new Error('手动课表还是空的，没有可确认为必要条件的课程');
  if (resolved.issues.length) {
    const details = resolved.issues.slice(0, 3).map(issue => issue.message).join('；');
    throw new Error(`手动课表存在 ${resolved.issues.length} 项直接冲突，不能锁定：${details}`);
  }
  const confirmedAt = new Date().toISOString();
  const manualPlan = {
    ...current,
    version: (current.version || 0) + 1,
    draft_revision: (current.draft_revision || 0) + 1,
    status: 'confirmed',
    placements: resolved.placements,
    locks: resolved.locks,
    issues: [],
    counts: resolved.counts,
    confirmed_at: confirmedAt,
    confirmed_by: importText(req.body?.confirmed_by) || '教务用户',
    last_solve: null,
  };
  repository.write({
    ...state,
    manual_plan: manualPlan,
    ...(state.schedule ? { solve_status: 'stale' } : {}),
  });
  return manualPlanData({ ...state, manual_plan: manualPlan });
}));

app.post('/api/manual-plan/unlock', (req, res) => reply(res, () => {
  const state = repository.read();
  const current = state.manual_plan || emptyManualPlan();
  if (current.status !== 'confirmed') return manualPlanData(state);
  const manualKeys = new Set((current.locks || []).map(lock => `${lock.section_id}\u0000${lock.slot_id}`));
  const schedule = state.schedule
    ? {
      ...state.schedule,
      locks: (state.schedule.locks || []).filter(lock =>
        lock.origin !== 'manual' && !manualKeys.has(`${lock.section_id}\u0000${lock.slot_id}`)),
    }
    : state.schedule;
  const manualPlan = {
    ...current,
    status: 'draft',
    locks: [],
    issues: [],
    confirmed_at: null,
    confirmed_by: null,
    last_solve: null,
    updated_at: new Date().toISOString(),
  };
  repository.write({ ...state, manual_plan: manualPlan, ...(schedule ? { schedule } : {}) });
  return manualPlanData({ ...state, manual_plan: manualPlan, ...(schedule ? { schedule } : {}) });
}));

app.post('/api/manual-plan/ai-solve', (req, res) => reply(res, async () => {
  const state = repository.read();
  const manualPlan = state.manual_plan || emptyManualPlan();
  if (manualPlan.status !== 'confirmed' || !(manualPlan.locks || []).length) {
    throw new Error('请先点击“确认为必要条件”，成功出现金色锁框后再进行 AI 补全排课');
  }
  const problem = buildSchedulingProblem(state, state.constraints || []);
  let strategy = null;
  const strategyWarnings = [];
  if (req.body?.use_ai_strategy !== false) {
    try {
      strategy = await planSchedulingStrategy(problem, {
        locks: manualPlan.locks,
        instruction: req.body?.instruction || '在不移动手动锁定课程的前提下补全全部课程，并优先处理高约束和跨年级教师课程。',
      });
    } catch (error) {
      strategyWarnings.push(`大模型策略阶段未采用：${error.message}；已自动使用确定性约束求解器继续排课。`);
    }
  }
  return solveAndPersist(state, req.body || {}, { strategy, strategyWarnings });
}));

app.get('/api/validate', (_req, res) => reply(res, () => {
  const state = repository.read();
  if (!state.schedule) return { pass: false, hard_violations: [{ rule_id: 'schedule_missing', message: '尚未生成新课表' }], soft_score: 0 };
  if (state.solve_status !== 'valid') {
    return {
      pass: false,
      stale: true,
      hard_violations: [{ rule_id: 'schedule_stale', message: '输入数据或规则已变更，必须重新排课后才能校验当前课表' }],
      soft_violations: [], soft_score: 0,
    };
  }
  const problem = buildSchedulingProblem(state, state.schedule.rules || state.constraints || []);
  const result = validateSchedule(problem, state.schedule);
  return { pass: result.ok, ...result };
}));

app.post('/api/lock', (req, res) => reply(res, () => {
  const state = repository.read();
  if (!state.schedule) throw new Error('尚未生成可锁定的课表');
  if (state.solve_status !== 'valid') throw new Error('当前输入已变更，旧课表已过期；请先重新排课再锁定');
  const assignment = state.schedule.assignments.find(item => item.task_id === req.body?.task_id && item.slot_id === req.body?.slot_id);
  if (!assignment) throw new Error('找不到要锁定的课时');
  const locks = state.schedule.locks || [];
  const lock = { section_id: assignment.section_id, slot_id: assignment.slot_id, origin: 'schedule' };
  if (!locks.some(item => item.section_id === lock.section_id && item.slot_id === lock.slot_id)) locks.push(lock);
  const schedule = { ...state.schedule, locks };
  const problem = buildSchedulingProblem(state, schedule.rules || state.constraints || []);
  const validation = validateSchedule(problem, schedule);
  repository.write({ ...state, schedule: { ...schedule, validation }, solve_status: validation.ok ? 'valid' : 'stale' });
  return { message: '已锁定整个 section 的该节课', lock };
}));

app.post('/api/unlock', (req, res) => reply(res, () => {
  const state = repository.read();
  if (!state.schedule) throw new Error('尚未生成课表');
  if (state.solve_status !== 'valid') throw new Error('当前输入已变更，旧课表已过期；请先重新排课再解锁');
  const assignment = state.schedule.assignments.find(item => item.task_id === req.body?.task_id && item.slot_id === req.body?.slot_id);
  if (!assignment) throw new Error('找不到要解锁的课时');
  if ((state.manual_plan?.locks || []).some(lock =>
    lock.section_id === assignment.section_id && lock.slot_id === assignment.slot_id)) {
    throw new Error('该课时属于手动课表必要条件；请在“手动课表”中解除必要条件');
  }
  const locks = (state.schedule.locks || []).filter(lock => !(lock.section_id === assignment.section_id && lock.slot_id === assignment.slot_id));
  repository.write({ ...state, schedule: { ...state.schedule, locks } });
  return { message: '已解锁', section_id: assignment.section_id, slot_id: assignment.slot_id };
}));

app.post('/api/swap', (req, res) => reply(res, () => {
  const state = repository.read();
  if (!state.schedule) throw new Error('尚未生成课表');
  if (state.solve_status !== 'valid') throw new Error('当前输入已变更，旧课表已过期；请先重新排课再调整时段');
  const { task_id, from_slot, to_slot } = req.body || {};
  const assignment = state.schedule.assignments.find(item => item.task_id === task_id && item.slot_id === from_slot);
  if (!assignment) throw new Error('找不到要移动的课时');
  if ((state.schedule.locks || []).some(lock => lock.section_id === assignment.section_id && lock.slot_id === from_slot)) throw new Error('该 section 已锁定，不能移动');
  const meetings = state.schedule.meetings.map(meeting =>
    meeting.section_id === assignment.section_id && meeting.slot_id === from_slot ? { ...meeting, slot_id: to_slot } : meeting);
  const schedule = { ...state.schedule, meetings, assignments: expandedAssignments(state.schedule.sections, meetings) };
  const problem = buildSchedulingProblem(state, schedule.rules || state.constraints || []);
  const validation = validateSchedule(problem, schedule);
  if (!validation.ok) throw new Error(`移动会违反硬约束: ${validation.hard_violations[0].message}`);
  repository.write({ ...state, assignments: schedule.assignments, schedule: { ...schedule, validation }, solve_status: 'valid' });
  return { message: '已移动整个 section 的该节课', validation };
}));

app.get('/api/timetable/:by/:id', (req, res) => reply(res, () => {
  const state = repository.read();
  return timetableGrid(state, req.params.by, req.params.id);
}));

function nextScheduleArchiveId(archives, savedAt) {
  const base = `ARCHIVE_${savedAt.replace(/[^0-9]/g, '')}`;
  const ids = new Set(archives.map(archive => archive.id));
  let id = base;
  let suffix = 2;
  while (ids.has(id)) id = `${base}_${suffix++}`;
  return id;
}

app.get('/api/schedule-archives', (_req, res) => reply(res, () => {
  const archives = repository.read().schedule_archives || [];
  return archives
    .map(archiveSummary)
    .sort((left, right) => String(right.saved_at).localeCompare(String(left.saved_at)));
}));

app.post('/api/schedule-archives', (_req, res) => reply(res, () => {
  const state = repository.read();
  if (!state.schedule || state.solve_status !== 'valid') {
    throw new Error('当前没有通过校验的完整课表；请完成 AI 排课后再储存');
  }
  const validation = validateSchedule(problemForSchedule(state, state.schedule), state.schedule);
  if (!validation.ok) {
    throw new Error(`当前课表未通过硬约束校验：${validation.hard_violations[0]?.message || '未知错误'}`);
  }
  const savedAt = new Date().toISOString();
  const archives = state.schedule_archives || [];
  const schedule = { ...state.schedule, validation };
  const archive = createScheduleArchive({ ...state, schedule }, {
    id: nextScheduleArchiveId(archives, savedAt),
    savedAt,
  });
  repository.write({ ...state, schedule_archives: [archive, ...archives] });
  return { message: '课表已储存到过往课表', archive: archiveSummary(archive) };
}));

app.get('/api/schedule-archives/:archiveId', (req, res) => reply(res, () => {
  const archive = (repository.read().schedule_archives || [])
    .find(item => item.id === req.params.archiveId);
  if (!archive) throw new Error('未找到该过往课表');
  const classes = [
    ...(archive.context?.teaching_classes || []).map(item => ({ ...item, class_type: 'teaching' })),
    ...(archive.context?.admin_classes || []).map(item => ({ ...item, class_type: 'admin' })),
  ].sort((left, right) => String(left.name || left.id).localeCompare(String(right.name || right.id), 'zh-CN'));
  return { ...archiveSummary(archive), classes };
}));

app.get('/api/schedule-archives/:archiveId/timetable/:by/:id', (req, res) => reply(res, () => {
  const archive = (repository.read().schedule_archives || [])
    .find(item => item.id === req.params.archiveId);
  if (!archive) throw new Error('未找到该过往课表');
  const data = timetableGrid(stateForScheduleArchive(archive), req.params.by, req.params.id);
  return { ...data, archived: true, archive: archiveSummary(archive) };
}));

// Student graduation is a once-per-year, irreversible active-roster change.
// The preview is intentionally read-only; the confirmed write below also
// checks the state revision so a stale browser dialog cannot delete a newer
// import or timetable edit.
app.get('/api/graduation/preview', (_req, res) => reply(res, () =>
  graduationPreview(repository.read())));

app.post('/api/graduation/confirm', (req, res) => reply(res, () => {
  if (importText(req.body?.confirmation) !== GRADUATION_CONFIRMATION) {
    throw new Error(`为防止误操作，请输入“${GRADUATION_CONFIRMATION}”后再确认学生毕业`);
  }
  const expectedRevision = Number(req.body?.expected_revision);
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) {
    throw new Error('毕业确认缺少有效的数据版本，请重新打开确认窗口');
  }
  const state = repository.read();
  const result = graduateStudents(state, { confirmedBy: importText(req.body?.confirmed_by) || '管理员' });
  const next = {
    ...result.next,
    // A timetable and its manual locks describe the previous school year.
    // Keeping either active after cohort rollover would make the new data look
    // valid while it still points at last year's students and sections.
    assignments: [],
    teaching_tasks: [],
    section_plan: null,
    section_overrides: {},
    schedule: null,
    manual_plan: emptyManualPlan(),
    solve_status: 'not_run',
  };
  validateCourseGradeSelections(next);
  validateCourseClassScopes(next);
  const saved = repository.write(next, { expectedRevision });
  return {
    message: `已完成学生毕业：${result.archive.graduate_count} 名 Senior 3 学生已归档，当前学生已升入下一年级，所有在校学生的选修信息已清空。请导入新 Senior 1 名单和新学年选课后重新排课。`,
    archive: graduationArchiveSummary(result.archive),
    students: Object.fromEntries([10, 11, 12].map(grade => [
      grade,
      (saved.students || []).filter(student => Number(student.grade) === grade).length,
    ])),
    incoming_senior_1_slots: {
      admin: (saved.admin_classes || []).filter(item => Number(item.grade) === 10).length,
      teaching: (saved.teaching_classes || []).filter(item => Number(item.grade) === 10).length,
    },
    solve_status: saved.solve_status,
  };
}));

app.get('/api/graduation-archives', (_req, res) => reply(res, () =>
  (repository.read().graduation_archives || [])
    .map(graduationArchiveSummary)
    .sort((left, right) => String(right.graduated_at).localeCompare(String(left.graduated_at)))));

app.get('/api/graduation-archives/:archiveId', (req, res) => reply(res, () => {
  const archive = (repository.read().graduation_archives || [])
    .find(item => item.id === req.params.archiveId);
  if (!archive) throw new Error('未找到该批毕业学生选课信息');
  return { ...structuredClone(archive), summary: graduationArchiveSummary(archive) };
}));

function parseUploadedWorkbook(workbook, filename, state) {
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) throw new Error('工作簿没有工作表');
  const sheet = workbook.Sheets[sheetName];
  const matrix = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
  const objectRows = XLSX.utils.sheet_to_json(sheet, { defval: '' });
  if (!matrix.length || !objectRows.length) throw new Error('文件中没有可读取的数据行');
  const studentHeader = findStudentNamelistHeader(matrix);
  const isCourseArrangement = (matrix[0] || []).some(cell => /^Senior\s*[123]$/i.test(importText(cell)));
  const parsed = studentHeader
    ? parseStudentNamelist(matrix, filename, state, studentHeader)
    : isCourseArrangement
      ? parseCourseArrangement(matrix)
      : parseStandardImport(objectRows);
  return { parsed, matrix, objectRows, studentHeader, isCourseArrangement };
}

function importPreviewResponse(result, filename, { recognitionMethod = 'rules', ai } = {}) {
  const { parsed, objectRows, studentHeader, isCourseArrangement } = result;
  return {
    filename,
    type: parsed.type,
    total_rows: parsed.totalRows ?? parsed.data.length,
    parsed_count: parsed.data.length,
    errors: parsed.errors,
    headers: parsed.headers,
    preview: (studentHeader || isCourseArrangement ? parsed.data : objectRows).slice(0, 10),
    parsed_data: parsed.data,
    import_context: parsed.importContext,
    recognition_method: recognitionMethod,
    ai: ai ? {
      model: ai.model,
      confidence: ai.interpretation.confidence,
      notes: ai.interpretation.notes,
    } : undefined,
  };
}

app.post('/api/import/excel', upload.single('file'), (req, res) => reply(res, async () => {
  if (!req.file) throw new Error('请选择要导入的 Excel 或 CSV 文件');
  const filename = decodedUploadFilename(req.file.originalname);
  const state = repository.read();
  const sourceWorkbook = XLSX.read(req.file.buffer, { type: 'buffer' });
  const expectedType = req.body?.expected_type === 'students' ? 'students' : 'generic';
  const aiRequested = req.body?.ai_organize === 'true';
  let result = parseUploadedWorkbook(sourceWorkbook, filename, state);
  if (aiRequested) {
    const ai = await interpretWorkbook(sourceWorkbook, {
      expectedType: expectedType === 'students' || studentGradeFromFilename(filename) ? 'students' : 'generic',
      filename,
      reason: '用户点击“大模型整理”请求按系统标准整理该工作簿',
    });
    result = parseUploadedWorkbook(ai.workbook, filename, state);
    if (result.parsed.type === 'unknown') throw new Error('模型整理后仍无法识别学生、教师、课程或教室数据类型');
    return importPreviewResponse(result, filename, { recognitionMethod: 'ai', ai });
  }
  if (result.parsed.type === 'unknown' && expectedType === 'students') {
    return {
      ...importPreviewResponse({
        ...result,
        parsed: {
          type: 'students', data: [], errors: [{ row: 0, msg: '未识别到标准学生名单表头；可点击“大模型整理”尝试转换' }],
          headers: [], importContext: { grade: studentGradeFromFilename(filename) },
        },
      }, filename),
      needs_ai_organize: true,
    };
  }
  if (result.parsed.type === 'unknown') throw new Error('未能从表头识别学生、教师、课程或教室数据类型；可使用“大模型整理”尝试转换');
  return importPreviewResponse(result, filename);
}));

app.post('/api/import/confirm', (req, res) => reply(res, () => {
  const state = repository.read();
  const result = applyImportedRows(state, req.body?.type, req.body?.data);
  repository.write(result.next);
  return { type: req.body.type, imported: result.imported, skipped: result.skipped, total: req.body.data.length, notes: result.notes };
}));

// The original web UI stores AP choices as one record per student, while the
// rules-first model stores the canonical choices on the student itself.  Keep
// the old endpoint as a lossless view/edit adapter rather than maintaining two
// divergent sources of truth.
function apSelectionRecords(state) {
  return (state.students || [])
    .filter(student => (student.ap_courses || []).length)
    .map(student => ({
      id: student.id,
      student_id: student.id,
      grade: student.grade,
      admin_class_id: student.admin_class_id,
      teaching_class_id: student.teaching_class_id,
      course_ids: [...student.ap_courses],
    }));
}

function courseAppliesToStudentGrade(course, grade) {
  const grades = (Array.isArray(course?.grade) ? course.grade : [course?.grade])
    .map(Number)
    .filter(Number.isFinite);
  return !grades.length || grades.includes(Number(grade));
}

app.post('/api/ap-selections/import/preview', upload.single('file'), (req, res) => reply(res, async () => {
  if (!req.file) throw new Error('请选择 AP 选课 Excel 文件');
  const filename = decodedUploadFilename(req.file.originalname);
  const state = repository.read();
  let preview = parseApSelectionBuffer(req.file.buffer, state, filename);
  if (req.body?.ai_organize === 'true') {
    const sourceWorkbook = XLSX.read(req.file.buffer, { type: 'buffer' });
    const ai = await interpretWorkbook(sourceWorkbook, {
      expectedType: 'ap_selections',
      filename,
      reason: '用户点击“大模型整理”请求按系统标准整理 AP 多工作表、并排 Block 名单选课文件',
    });
    preview = parseApSelectionBuffer(
      XLSX.write(ai.workbook, { type: 'buffer', bookType: 'xlsx' }),
      state,
      filename,
    );
    return {
      ...preview,
      recognition_method: 'ai',
      ai: { model: ai.model, confidence: ai.interpretation.confidence, notes: ai.interpretation.notes },
    };
  }
  return { ...preview, recognition_method: 'rules' };
}));

app.post('/api/ap-selections/import/confirm', (req, res) => reply(res, () => {
  const state = repository.read();
  const result = applyApSelectionChanges(state, req.body?.changes, req.body?.mode || 'replace');
  repository.write(changedState(state, 'students', result.students));
  return { updated_students: result.updated, mode: result.mode };
}));

app.post('/api/elective-selections/import/preview', upload.single('file'), (req, res) => reply(res, async () => {
  if (!req.file) throw new Error('请选择高三 A/B/C 选课 Excel 文件');
  const filename = decodedUploadFilename(req.file.originalname);
  const state = repository.read();
  const sourceWorkbook = XLSX.read(req.file.buffer, { type: 'buffer' });
  let preview = parseElectiveSelectionWorkbook(sourceWorkbook, state, filename);
  if (req.body?.ai_organize === 'true') {
    const ai = await interpretWorkbook(sourceWorkbook, {
      expectedType: 'elective_selections',
      filename,
      reason: '用户点击“大模型整理”请求按系统标准整理高三 A/B/C 选课文件',
      courseCatalog: state.courses || [],
    });
    preview = parseElectiveSelectionWorkbook(ai.workbook, state, filename);
    return {
      ...preview,
      recognition_method: 'ai',
      ai: { model: ai.model, confidence: ai.interpretation.confidence, notes: ai.interpretation.notes },
    };
  }
  return { ...preview, recognition_method: 'rules' };
}));

app.post('/api/elective-selections/import/confirm', (req, res) => reply(res, () => {
  const state = repository.read();
  const result = applyElectiveSelectionChanges(state, req.body?.changes);
  repository.write(changedState(state, 'students', result.students));
  return { updated_students: result.updated };
}));

app.get('/api/settings', (_req, res) => reply(res, () => {
  const config = getAiConfig();
  return {
    apiKey: config.configured ? '***已配置***' : '',
    apiUrl: config.apiUrl,
    model: config.model,
    configured: config.configured,
  };
}));

app.post('/api/settings', (req, res) => reply(res, () => {
  const config = saveAiConfig(req.body || {});
  return {
    message: '设置已保存并立即生效',
    apiUrl: config.apiUrl,
    model: config.model,
    configured: config.configured,
  };
}));

app.post('/api/ai/test', (req, res) => reply(res, () =>
  testAiConnection(req.body?.message)));

// The chat request itself is read-only. A natural-language request to apply a
// timetable balancing suggestion can additionally return one separately
// validated, confirmable move; no state changes until its action endpoint is
// clicked by the user.
app.post('/api/assistant/chat', (req, res) => reply(res, async () => {
  const state = repository.read();
  const result = await askAiAssistant({
    message: req.body?.message,
    context: req.body?.context,
    history: req.body?.history,
    state,
  });
  if (!result.action) result.action = automaticTeacherScheduleMoveProposal(state, req.body?.context, req.body?.message);
  return result;
}));

app.post('/api/assistant/actions/swap-teaching-assignments', (req, res) => reply(res, () => {
  const expectedRevision = Number(req.body?.expected_revision);
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) {
    throw new Error('待确认操作缺少有效的数据版本，请重新向 AI 发起请求');
  }
  const state = repository.read();
  const { proposal, teachingAssignments } = applyTeacherAssignmentSwap(state, req.body?.assignment_ids);
  const saved = repository.write(
    changedState(state, 'teaching_assignments', teachingAssignments),
    { expectedRevision },
  );
  return {
    message: '已调换两项课程的授课教师；请重新确认必要条件并重新排课。',
    action: proposal,
    solve_status: saved.solve_status,
    revision: saved.meta?.revision,
  };
}));

app.post('/api/assistant/actions/move-schedule-meeting', (req, res) => reply(res, () => {
  const expectedRevision = Number(req.body?.expected_revision);
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) {
    throw new Error('待确认操作缺少有效的数据版本，请重新向 AI 发起请求');
  }
  const state = repository.read();
  const proposal = scheduleMoveProposal(state, req.body);
  const candidate = scheduleAfterMeetingMove(state, proposal);
  const validation = validateSchedule(problemForSchedule(state, candidate), candidate);
  if (!validation.ok) {
    throw new Error(`调整未执行：${validation.hard_violations[0]?.message || '违反硬约束'}`);
  }
  repository.write(
    { ...state, assignments: candidate.assignments, schedule: { ...candidate, validation }, solve_status: 'valid' },
    { expectedRevision },
  );
  return {
    message: `已将 ${proposal.course_name}（${proposal.class_label}）从${proposal.from_label}调整到${proposal.to_label}`,
    validation,
  };
}));

function updateStudentApSelection(state, studentId, courseIds) {
  if (!Array.isArray(courseIds) || !courseIds.every(courseId => typeof courseId === 'string')) {
    throw new Error('course_ids 必须是课程 ID 数组');
  }
  if (new Set(courseIds).size !== courseIds.length) throw new Error('AP 选课不能重复');
  const courses = new Map((state.courses || []).map(course => [course.id, course]));
  for (const courseId of courseIds) {
    const course = courses.get(courseId);
    if (!course || course.type !== 'ap') throw new Error(`${courseId} 不是可选的 AP 课程`);
  }
  const index = (state.students || []).findIndex(student => student.id === studentId);
  if (index < 0) throw new Error(`学生不存在: ${studentId}`);
  const student = state.students[index];
  for (const courseId of courseIds) {
    const course = courses.get(courseId);
    if (!courseAppliesToStudentGrade(course, student.grade)) {
      throw new Error(`${course.name || courseId} 不适用于 ${student.name || studentId}（年级 ${student.grade}）`);
    }
  }
  const students = [...state.students];
  students[index] = { ...students[index], ap_courses: [...courseIds] };
  return students[index];
}

app.get('/api/ap_selections', (_req, res) => reply(res, () => apSelectionRecords(repository.read())));
app.post('/api/ap_selections', (req, res) => reply(res, () => {
  const state = repository.read();
  const studentId = req.body?.student_id;
  if (typeof studentId !== 'string') throw new Error('必须提供 student_id');
  const student = updateStudentApSelection(state, studentId, req.body?.course_ids || []);
  repository.write(changedState(state, 'students', state.students.map(item => item.id === student.id ? student : item)));
  return { id: student.id, student_id: student.id, course_ids: student.ap_courses };
}));
app.put('/api/ap_selections/:studentId', (req, res) => reply(res, () => {
  const state = repository.read();
  const student = updateStudentApSelection(state, req.params.studentId, req.body?.course_ids || []);
  repository.write(changedState(state, 'students', state.students.map(item => item.id === student.id ? student : item)));
  return { id: student.id, student_id: student.id, course_ids: student.ap_courses };
}));
app.delete('/api/ap_selections/:studentId', (req, res) => reply(res, () => {
  const state = repository.read();
  const student = updateStudentApSelection(state, req.params.studentId, []);
  repository.write(changedState(state, 'students', state.students.map(item => item.id === student.id ? student : item)));
  return { removed: student.id };
}));

const editableEntities = new Set([
  'teachers', 'rooms', 'courses', 'students', 'admin_classes',
  'teaching_classes', 'teaching_assignments', 'selection_blocks', 'constraints',
]);

function changedState(state, entity, items, extra = {}) {
  const normalizedItems = entity === 'courses'
    ? items.map(normalizeCourseScope)
    : entity === 'ap_block_config'
      ? normalizeApBlockConfig(items, state.courses || [])
    : items;
  let next = { ...state, ...extra, [entity]: normalizedItems };
  if (entity === 'students' || entity === 'admin_classes' || entity === 'teaching_classes') {
    next = synchronizeClassMemberships(next);
  }
  if (entity === 'constraints') validateRules(items);
  if (entity === 'selection_blocks') validateSelectionBlocks(next);
  if (entity === 'courses' || entity === 'students' || entity === 'selection_blocks') {
    validateCourseGradeSelections(next);
  }
  if (entity === 'ap_block_config') buildSchedulingProblem(next, next.constraints || []);
  if (entity === 'courses' || entity === 'teaching_classes' || entity === 'teaching_assignments') {
    validateCourseClassScopes(next);
  }
  if (state.schedule) next.solve_status = 'stale';
  if (state.manual_plan?.status === 'confirmed') {
    next.manual_plan = {
      ...state.manual_plan,
      status: 'stale',
      issues: [{
        code: 'INPUT_CHANGED',
        message: `${entity} 数据已变更，原必要条件必须重新校验并确认`,
      }],
      locks: [],
      confirmed_at: null,
      confirmed_by: null,
      last_solve: null,
    };
  }
  return next;
}

app.post('/api/:entity', (req, res) => reply(res, () => {
  const entity = req.params.entity;
  if (!editableEntities.has(entity)) throw new Error(`不支持写入实体: ${entity}`);
  const item = req.body;
  if (!item?.id || typeof item.id !== 'string') throw new Error('新实体必须有字符串 id');
  const state = repository.read();
  const current = state[entity] || [];
  if (current.some(existing => existing.id === item.id)) throw new Error(`ID 已存在: ${item.id}`);
  repository.write(changedState(state, entity, [...current, item]));
  return item;
}));

app.put('/api/:entity/:id', (req, res) => reply(res, () => {
  const entity = req.params.entity;
  if (!editableEntities.has(entity)) throw new Error(`不支持写入实体: ${entity}`);
  const state = repository.read();
  const current = state[entity] || [];
  const index = current.findIndex(item => item.id === req.params.id);
  if (index < 0) throw new Error(`实体不存在: ${req.params.id}`);
  const updated = { ...current[index], ...req.body, id: current[index].id };
  const items = [...current]; items[index] = updated;
  if (entity === 'courses') {
    const normalized = normalizeCourseScope(updated);
    items[index] = normalized;
    const teachingAssignments = synchronizeCourseDeliveryAssignments(state, current[index], normalized);
    repository.write(changedState(state, entity, items, { teaching_assignments: teachingAssignments }));
    return normalized;
  }
  repository.write(changedState(state, entity, items));
  return updated;
}));

app.delete('/api/:entity/:id', (req, res) => reply(res, () => {
  const entity = req.params.entity;
  if (!editableEntities.has(entity)) throw new Error(`不支持写入实体: ${entity}`);
  const state = repository.read();
  const current = state[entity] || [];
  if (!current.some(item => item.id === req.params.id)) throw new Error(`实体不存在: ${req.params.id}`);
  repository.write(changedState(state, entity, current.filter(item => item.id !== req.params.id)));
  return { removed: req.params.id };
}));

// Compatibility CRUD endpoint used by the current web UI. Solver and
// validation endpoints will be attached only to the new kernel.
app.get('/api/:entity', (req, res) => reply(res, () => {
  const value = repository.read()[req.params.entity];
  if (!Array.isArray(value)) throw new Error(`不支持的实体: ${req.params.entity}`);
  return value;
}));

const port = Number(process.env.PORT || 3001);
app.listen(port, () => console.log(`rules-first backend listening on :${port}`));
