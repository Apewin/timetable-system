const fs = require('fs');
const path = require('path');
const raw = require('../timetable.json');
const rules = require('../rules.json');
const { buildSections, solveSelectionsOnCore, solveCoreThenSelections } = require('../packages/core/src/solver/section-cpsat-engine.cjs');
const { solveIntegerSections } = require('../packages/core/src/solver/integer-section-cpsat-engine.cjs');

function gradeState(grade) {
  const state = structuredClone(raw);
  state.students = state.students.filter(student => student.grade === grade);
  const studentIds = new Set(state.students.map(student => student.id));
  state.admin_classes = state.admin_classes.filter(group => {
    group.student_ids = group.student_ids.filter(id => studentIds.has(id));
    return group.student_ids.length;
  });
  state.teaching_classes = state.teaching_classes.filter(group => {
    group.student_ids = group.student_ids.filter(id => studentIds.has(id));
    return group.student_ids.length;
  });
  const classIds = new Set([...state.admin_classes, ...state.teaching_classes].map(group => group.id));
  state.teaching_assignments = state.teaching_assignments
    .map(assignment => ({ ...assignment, class_ids: (assignment.class_ids || [assignment.class_id]).filter(id => classIds.has(id)) }))
    .filter(assignment => assignment.class_ids.length);
  return state;
}

async function main() {
  const grade = Number(process.env.GRADE || 11);
  const state = gradeState(grade);
  const mode = process.env.MODE || 'full';
  const hintFiles = (process.env.HINT_FILES || '').split(',').map(value => value.trim()).filter(Boolean);
  const hintParts = hintFiles.map(file => JSON.parse(fs.readFileSync(path.resolve(file), 'utf8')));
  const hint = hintParts.length ? {
    meetings: hintParts.flatMap(part => part.meetings || []),
    sections: hintParts.flatMap(part => part.sections || []),
  } : undefined;
  const lockedMembershipPart = process.env.LOCK_MEMBERSHIP_FILE
    ? JSON.parse(fs.readFileSync(path.resolve(process.env.LOCK_MEMBERSHIP_FILE), 'utf8'))
    : null;
  const lockedMembership = lockedMembershipPart ? Object.fromEntries(
    (lockedMembershipPart.sections || [])
      .filter(section => section.class_type === 'ap' || section.class_type === 'elective')
      .map(section => [section.id, new Set(section.student_ids || [])]),
  ) : undefined;
  const allSections = buildSections(state);
  if (mode === 'core-then-selection') {
    const result = await solveCoreThenSelections(state, {
      rules,
      attempts: 1,
      coreMaxTimeSeconds: Number(process.env.CORE_SECONDS || 30),
      selectionMaxTimeSeconds: Number(process.env.MAX_SECONDS || 120),
      seed: 20260730,
    });
    const output = path.resolve(__dirname, `../grade-${grade}-${mode}.json`);
    fs.writeFileSync(output, JSON.stringify(result, null, 2));
    console.log(JSON.stringify({ grade, mode, ok: result.ok, status: result.status, attempts: result.attempts, assignments: result.assignments?.length || 0, output }));
    return;
  }
  if (mode === 'on-core') {
    if (!process.env.CORE_FILE) throw new Error('MODE=on-core 需要 CORE_FILE');
    const core = JSON.parse(fs.readFileSync(path.resolve(process.env.CORE_FILE), 'utf8'));
    const candidates = allSections.filter(section => section.class_type === 'ap' || section.class_type === 'elective');
    const result = await solveSelectionsOnCore(state, core, candidates, {
      rules,
      maxTimeSeconds: Number(process.env.MAX_SECONDS || 120),
      seed: 20260730,
    });
    const output = path.resolve(__dirname, `../grade-${grade}-${mode}.json`);
    fs.writeFileSync(output, JSON.stringify(result, null, 2));
    console.log(JSON.stringify({ grade, mode, sections: candidates.length, ok: result.ok, status: result.status, output }));
    return;
  }
  const sections = mode === 'candidate'
    ? allSections.filter(section => section.class_type === 'ap' || section.class_type === 'elective')
    : mode === 'core'
      ? allSections.filter(section => section.class_type !== 'ap' && section.class_type !== 'elective')
      : allSections;
  const result = await solveIntegerSections(state, {
    rules,
    sections,
    maxTimeSeconds: Number(process.env.MAX_SECONDS || 120),
    seed: 20260730,
    prioritySearch: process.env.PRIORITY_SEARCH === '1',
    hint,
    lockedMembership,
    ignoreTeacherConflicts: process.env.IGNORE_TEACHERS === '1',
    ignoreRoomConflicts: process.env.IGNORE_ROOMS === '1',
    logSearch: process.env.LOG_SEARCH === '1',
    preserveAllDifferent: process.env.PRESERVE_ALLDIFF === '1',
    softDailyFiveHourCourses: process.env.SOFT_DAILY_AP === '1',
  });
  const output = path.resolve(__dirname, `../grade-${grade}-${mode}.json`);
  fs.writeFileSync(output, JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ grade, mode, sections: sections.length, ok: result.ok, status: result.status, assignments: result.assignments.length, output }));
}
main().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
