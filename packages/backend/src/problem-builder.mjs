import { compileRules } from './rule-compiler.mjs';
import { buildSections } from './section-builder.mjs';

function synchronizedSelectionBlockRules(state, sections) {
  return (state.selection_blocks || [])
    .filter(block => block.synchronized_time_block === true)
    .map(block => {
      const targets = sections.filter(section =>
        section.source === 'required_elective' && (block.allowed_course_ids || []).includes(section.course_id));
      // A choice roster may be imported incrementally.  Courses with no
      // selected student deliberately have no section yet; treating that as a
      // contradiction makes the whole sectioning page unavailable before the
      // last workbook arrives.  Synchronize the courses that do exist.
      if (targets.length < 2) return null;
      return {
        id: `selection_block_${block.id}_synchronized_slots`,
        name: `${block.name || block.id} 同步时间块`,
        type: 'synchronized_slots', hard: true, weight: 0, scope: 'section',
        target_ids: targets.map(section => section.id), section_target_ids: targets.map(section => section.id),
        params: {}, unmatched: false,
      };
    }).filter(Boolean);
}

function synchronizedAssignmentRules(sections) {
  const groups = new Map();
  for (const section of sections) {
    if (!section.synchronized_group_id) continue;
    const targets = groups.get(section.synchronized_group_id) || [];
    targets.push(section);
    groups.set(section.synchronized_group_id, targets);
  }
  return [...groups].filter(([, targets]) => targets.length > 1).map(([assignmentId, targets]) => ({
    id: `assignment_${assignmentId}_synchronized_slots`,
    name: `${assignmentId} 各班同步时间`,
    type: 'synchronized_slots', hard: true, weight: 0, scope: 'section',
    target_ids: targets.map(section => section.id).sort(),
    section_target_ids: targets.map(section => section.id).sort(),
    params: {}, unmatched: false,
  }));
}

/**
 * AP Block sections are distinct courses taught in parallel.  Their shared
 * time band is a hard timetable fact, not a display-only grouping.  A Block
 * may optionally carry the school's confirmed fixed weekly slots; when slots
 * are blank it remains a synchronized band for the timetable solver to place.
 */
function apBlockRules(sections) {
  const groups = new Map();
  for (const section of sections) {
    if (!section.ap_block_id) continue;
    const targets = groups.get(section.ap_block_id) || [];
    targets.push(section);
    groups.set(section.ap_block_id, targets);
  }
  const rules = [];
  for (const [blockId, targets] of groups) {
    const ids = targets.map(section => section.id).sort();
    const blockName = targets[0].ap_block_name || blockId;
    if (ids.length > 1) {
      rules.push({
        id: `ap_block_${blockId}_synchronized_slots`,
        name: `AP ${blockName} 同步时段`,
        type: 'synchronized_slots', hard: true, weight: 0, scope: 'section',
        target_ids: ids, section_target_ids: ids, params: {}, unmatched: false,
      });
    }
    const slots = targets[0].ap_block_slots || [];
    if (slots.length) {
      if (!targets.every(section => (section.ap_block_slots || []).join('|') === slots.join('|'))) {
        throw new Error(`AP ${blockName} 的 section 固定时段不一致`);
      }
      rules.push({
        id: `ap_block_${blockId}_fixed_slots`,
        name: `AP ${blockName} 固定时段`,
        type: 'fixed_slots', hard: true, weight: 0, scope: 'section',
        target_ids: ids, section_target_ids: ids,
        params: { slots, mode: 'exact' }, unmatched: false,
      });
    }
  }
  return rules;
}

/**
 * A Block is deliberately not a fixed timetable band: the school can still
 * lock a confirmed band later through `ap_block_slots`.  Until then, however,
 * treating every Block section as an unrelated elective makes a merely
 * feasible schedule scatter the three daily AP lessons across the day.
 *
 * These generated preferences make the Block layer a first-class scheduling
 * concern without turning a preferred lane into a hard constraint:
 *
 * - one representative section per synchronized Block prefers the early
 *   five-period band on every day; and
 * - all Block students prefer a continuous daily lesson prefix.
 *
 * The synchronized-slot hard rule carries the representative's choice to all
 * parallel sections.  Manual locks, teacher availability, and all configured
 * hard rules can still move a Block outside that band when necessary.
 */
function apBlockCompactnessRules(sections, ignoredCourseIds = []) {
  const groups = new Map();
  const studentIds = new Set();
  for (const section of sections) {
    if (!section.ap_block_id) continue;
    const targets = groups.get(section.ap_block_id) || [];
    targets.push(section);
    groups.set(section.ap_block_id, targets);
    for (const studentId of section.student_ids || []) studentIds.add(studentId);
  }
  if (!groups.size) return [];

  // Three Blocks normally occupy three adjacent lanes.  Five flexible early
  // periods leave two recovery lanes for teacher/lock conflicts, while still
  // keeping AP before the administrative-course layer whenever possible.
  const compactSlots = Array.from({ length: 5 }, (_, dayIndex) =>
    Array.from({ length: 5 }, (_, periodIndex) => `D${dayIndex + 1}P${periodIndex + 1}`),
  ).flat();
  const rules = [];
  for (const [blockId, targets] of groups) {
    const slots = targets[0].ap_block_slots || [];
    // A configured exact band is an administrator's decision, so do not add
    // a competing preference to it.
    if (slots.length) continue;
    const representative = [...targets].sort((left, right) => left.id.localeCompare(right.id))[0];
    const blockName = representative.ap_block_name || blockId;
    rules.push({
      id: `ap_block_${blockId}_compact_band`,
      name: `AP ${blockName} 优先紧凑时段`,
      type: 'preferred_slots', hard: false, weight: 400, scope: 'section',
      target_ids: [representative.id], section_target_ids: [representative.id],
      params: { slots: compactSlots }, unmatched: false,
      generated_by: 'ap_block_compactness',
    });
  }
  if (studentIds.size) rules.push({
    id: 'ap_block_students_compact_daily_schedule',
    name: 'AP Block 学生当天课程尽量连续',
    type: 'no_internal_gaps', hard: false, weight: 300, scope: 'student',
    target_ids: [...studentIds].sort(), section_target_ids: [],
    params: { ignore_course_ids: [...ignoredCourseIds].sort() }, unmatched: false,
    generated_by: 'ap_block_compactness',
  });
  return rules;
}

function incompleteRequiredChoices(state) {
  const missing = [];
  for (const block of state.selection_blocks || []) {
    if (block.required === false) continue;
    for (const student of state.students || []) {
      if (!(block.grades || []).includes(student.grade)) continue;
      if (student.elective_choices?.[block.choice_key]) continue;
      missing.push({
        student_id: student.id,
        student_name: student.name || student.id,
        block_id: block.id,
        block_name: block.name || block.id,
        choice_key: block.choice_key,
      });
    }
  }
  return missing.sort((left, right) =>
    left.block_id.localeCompare(right.block_id) || left.student_id.localeCompare(right.student_id));
}

export function buildSchedulingProblem(state, rules = state.constraints || []) {
  const students = state.students || [];
  const manualFillerCourseIds = new Set((state.courses || [])
    .filter(course => course.manual_unlimited === true)
    .map(course => course.id));
  const gradeByStudentId = new Map(students.map(student => [student.id, student.grade]));
  if (gradeByStudentId.size !== students.length) throw new Error('学生数据库存在重复 ID，不能构建排课问题');
  const rawSections = buildSections(state);
  for (const section of rawSections) for (const field of [
    'student_ids', 'eligible_student_ids', 'locked_student_ids',
  ]) for (const studentId of section[field] || []) {
    if (!gradeByStudentId.has(studentId)) {
      throw new Error(`section ${section.id} 的 ${field} 引用了不存在的学生 ${studentId}`);
    }
  }
  const sections = rawSections.map(section => ({
    id: section.id, course_id: section.course_id, teacher_id: section.teacher_id,
    room_id: null, class_type: section.class_type,
    weekly_hours: manualFillerCourseIds.has(section.course_id) ? 0 : section.weekly_hours,
    class_id: section.class_id, cohort_id: section.cohort_id, source: section.source,
    student_ids: section.student_ids || [], eligible_student_ids: section.eligible_student_ids || [],
    locked_student_ids: section.locked_student_ids || [],
    grades: [...new Set([...(section.student_ids || []), ...(section.eligible_student_ids || [])]
      .map(studentId => gradeByStudentId.get(studentId)).filter(grade => grade !== undefined))].sort((a, b) => a - b),
    room_candidates: [], room_binding: 'disabled',
    capacity: null, warnings: section.warnings || [],
    source_assignment_id: section.source_assignment_id,
    synchronized_group_id: section.synchronized_group_id,
    ap_block_id: section.ap_block_id,
    ap_block_name: section.ap_block_name,
    ap_block_slots: section.ap_block_slots || [],
  }));
  const studentHours = new Map(students.map(student => [student.id, 0]));
  for (const section of sections) for (const studentId of section.student_ids) {
    studentHours.set(studentId, (studentHours.get(studentId) || 0) + section.weekly_hours);
  }
  const compiledRules = compileRules(state, rules.filter(rule => rule.scope !== 'room'), { sections });
  return {
    slots: Array.from({ length: 50 }, (_, index) => ({ id: `D${Math.floor(index / 10) + 1}P${index % 10 + 1}`, day: Math.floor(index / 10) + 1, period: index % 10 + 1 })),
    sections,
    rooms: [],
    rules: [
      ...compiledRules,
      ...synchronizedSelectionBlockRules(state, sections),
      ...synchronizedAssignmentRules(sections),
      ...apBlockRules(sections),
      ...apBlockCompactnessRules(sections, manualFillerCourseIds),
    ],
    diagnostics: {
      sections: sections.length,
      meetings: sections.reduce((total, section) => total + section.weekly_hours, 0),
      student_weekly_hours: Object.fromEntries(studentHours),
      students_not_at_50_hours: [...studentHours].filter(([, hours]) => hours !== 50).map(([id, hours]) => ({ id, hours })),
      incomplete_required_choices: incompleteRequiredChoices(state),
      room_assignment: 'disabled',
      ignored_room_rule_ids: rules.filter(rule => rule.scope === 'room').map(rule => rule.id),
      ap_block_mode: {
        enabled: sections.some(section => section.ap_block_id),
        blocks: [...new Set(sections.map(section => section.ap_block_id).filter(Boolean))],
      },
    },
  };
}
