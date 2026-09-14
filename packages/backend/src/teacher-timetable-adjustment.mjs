import { validateSchedule } from './schedule-validator.mjs';
import { expandScheduleAssignments } from './schedule-projection.mjs';

function indexById(items = []) {
  return new Map(items.map(item => [item.id, item]));
}

function synchronizedSectionClosure(problem, sectionId) {
  const result = new Set([sectionId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const rule of problem.rules || []) {
      if (!rule.hard || rule.type !== 'synchronized_slots') continue;
      const targets = rule.section_target_ids || rule.target_ids || [];
      if (!targets.some(target => result.has(target))) continue;
      for (const target of targets) if (!result.has(target)) {
        result.add(target);
        changed = true;
      }
    }
  }
  return result;
}

function meetingBundle(problem, schedule, sectionId, slotId) {
  const sectionIds = synchronizedSectionClosure(problem, sectionId);
  const meetings = (schedule.meetings || []).filter(meeting =>
    sectionIds.has(meeting.section_id) && meeting.slot_id === slotId);
  if (!meetings.some(meeting => meeting.section_id === sectionId)) {
    throw new Error('找不到要调整的原课程');
  }
  // A valid synchronized group has one meeting for every linked section at
  // this slot. Rejecting an incomplete bundle here prevents a drag operation
  // from concealing already-corrupt Block data.
  if (meetings.length !== sectionIds.size) {
    throw new Error('该课程所属同步组的数据不完整，请先重新排课');
  }
  return { sectionIds, meetings };
}

function lockedMeeting(schedule, bundle, slotId) {
  const locked = new Set((schedule.locks || []).map(lock => `${lock.section_id}@${lock.slot_id}`));
  return [...bundle.sectionIds].some(sectionId => locked.has(`${sectionId}@${slotId}`));
}

function teacherMeetingsAtSlot(schedule, sectionsById, teacherId, slotId) {
  return (schedule.meetings || []).filter(meeting =>
    meeting.slot_id === slotId && sectionsById.get(meeting.section_id)?.teacher_id === teacherId);
}

function classMemberIds(state, classId) {
  const ownedStudentIds = (state.schedule?.sections || [])
    .filter(section => section.class_id === classId)
    .flatMap(section => section.student_ids || []);
  if (ownedStudentIds.length) return [...new Set(ownedStudentIds)];
  return (state.students || [])
    .filter(student => student.teaching_class_id === classId || student.admin_class_id === classId)
    .map(student => student.id);
}

function classMeetingsAtSlot(schedule, memberIds, slotId) {
  const members = new Set(memberIds);
  const sectionIds = new Set();
  for (const assignment of schedule.assignments || []) {
    if (assignment.slot_id === slotId && members.has(assignment.student_id)) {
      sectionIds.add(assignment.section_id);
    }
  }
  return (schedule.meetings || []).filter(meeting =>
    meeting.slot_id === slotId && sectionIds.has(meeting.section_id));
}

function sourceAssignmentFromInput(schedule, {
  teacherId,
  taskId,
  sectionId,
  fromSlot,
}) {
  if (taskId) {
    const assignment = (schedule.assignments || []).find(item =>
      item.task_id === taskId && item.slot_id === fromSlot);
    if (!assignment) throw new Error('找不到要拖动的课程');
    if (teacherId && assignment.teacher_id !== teacherId) throw new Error('该课程不属于当前教师');
    return assignment;
  }
  if (sectionId) {
    const assignment = (schedule.assignments || []).find(item =>
      item.section_id === sectionId && item.slot_id === fromSlot);
    if (!assignment) throw new Error('找不到要拖动的课程');
    return assignment;
  }
  throw new Error('拖动课程缺少课程或原时段');
}

function counterpartMeetings(schedule, sectionsById, {
  scope,
  teacherId,
  memberIds,
  sourceSectionIds,
  toSlot,
}) {
  const meetings = scope === 'class'
    ? classMeetingsAtSlot(schedule, memberIds, toSlot)
    : teacherMeetingsAtSlot(schedule, sectionsById, teacherId, toSlot);
  return meetings.filter(meeting => !sourceSectionIds.has(meeting.section_id));
}

function firstViolationMessage(validation) {
  const raw = validation?.hard_violations?.[0]?.message || '移动会违反硬约束';
  const teacherClash = /^teacher@([^@]+)@(\S+)/.exec(raw);
  if (teacherClash) return `教师 ${teacherClash[1]} 在 ${teacherClash[2]} 已有其他课程`;
  const studentClash = /^学生 (\S+) 在 (\S+) 有/.exec(raw);
  if (studentClash) return `学生 ${studentClash[1]} 在 ${studentClash[2]} 已有其他课程`;
  return raw;
}

function affectedTeachingClassIds(state, sectionsById, sectionIds) {
  const teachingClassIds = new Set((state.teaching_classes || []).map(item => item.id));
  const studentTeachingClass = new Map((state.students || [])
    .map(student => [student.id, student.teaching_class_id]));
  const affected = new Set();
  for (const sectionId of sectionIds) {
    const section = sectionsById.get(sectionId);
    if (!section) continue;
    if (teachingClassIds.has(section.class_id)) affected.add(section.class_id);
    for (const studentId of section.student_ids || []) {
      const classId = studentTeachingClass.get(studentId);
      if (classId) affected.add(classId);
    }
  }
  return affected;
}

function overlayImpact(state, sectionsById, moves) {
  const displacedSelfStudyIds = new Set();
  for (const move of moves) {
    const classIds = affectedTeachingClassIds(state, sectionsById, move.sectionIds);
    for (const overlay of state.schedule?.overlays || []) {
      if (!classIds.has(overlay.class_id) || !(overlay.slot_ids || []).includes(move.toSlot)) continue;
      if (overlay.kind !== 'self_study') return { blocked: true, displacedSelfStudyIds: [] };
      displacedSelfStudyIds.add(overlay.id);
    }
  }
  return { blocked: false, displacedSelfStudyIds: [...displacedSelfStudyIds] };
}

export const ADJUSTMENT_BUFFER_SLOT = '__buffer__';

function bufferItems(schedule) {
  return [...(schedule?.adjustment_buffer || [])];
}

function nextBufferId(items) {
  const ids = new Set(items.map(item => item.id));
  let suffix = 1;
  let id = `BUF_${suffix}`;
  while (ids.has(id)) id = `BUF_${++suffix}`;
  return id;
}

function parkedMeetingsFrom(schedule) {
  return bufferItems(schedule).flatMap(item => item.meetings || []);
}

function assertScheduleAdjustable(state) {
  if (!state.schedule) throw new Error('当前课表不是有效版本，请先完成排课再调整');
  if (state.solve_status === 'valid') return;
  if (state.solve_status === 'editing' && bufferItems(state.schedule).length) return;
  throw new Error('当前课表不是有效版本，请先完成排课再调整');
}

function validateAdjustedSchedule(problem, candidateSchedule) {
  const parkedMeetings = parkedMeetingsFrom(candidateSchedule);
  return validateSchedule(problem, candidateSchedule, {
    parkedMeetings,
    allowIncomplete: parkedMeetings.length > 0,
  });
}

function withBufferValidation(schedule, validation) {
  const count = bufferItems(schedule).length;
  if (!count) return { ...schedule, validation };
  return {
    ...schedule,
    validation: {
      ...validation,
      ok: false,
      hard_violations: [
        ...(validation.hard_violations || []),
        { rule_id: 'kernel.adjustment_buffer', message: `改课表缓冲区还有 ${count} 门课未放回` },
      ],
    },
  };
}

function parkBundle(schedule, bundle, fromSlot) {
  const parkedKeys = new Set(bundle.meetings.map(meeting => `${meeting.section_id}@${meeting.slot_id}`));
  const meetings = (schedule.meetings || []).filter(meeting =>
    !parkedKeys.has(`${meeting.section_id}@${meeting.slot_id}`));
  const buffer = bufferItems(schedule);
  return {
    ...schedule,
    meetings,
    assignments: expandScheduleAssignments(schedule.sections || [], meetings),
    adjustment_buffer: [...buffer, {
      id: nextBufferId(buffer),
      from_slot: fromSlot,
      meetings: bundle.meetings.map(meeting => ({ ...meeting })),
    }],
  };
}

function placeFromBuffer(schedule, bufferItem, toSlot, targetBundle, displacedSelfStudyIds = []) {
  const remaining = bufferItems(schedule).filter(item => item.id !== bufferItem.id);
  const targetKeys = new Set((targetBundle?.meetings || []).map(meeting => `${meeting.section_id}@${meeting.slot_id}`));
  let meetings = (schedule.meetings || []).filter(meeting =>
    !targetKeys.has(`${meeting.section_id}@${meeting.slot_id}`));
  if (targetBundle) {
    remaining.push({
      id: nextBufferId(remaining),
      from_slot: toSlot,
      meetings: targetBundle.meetings.map(meeting => ({ ...meeting })),
    });
  }
  meetings = [
    ...meetings,
    ...bufferItem.meetings.map(meeting => ({ ...meeting, slot_id: toSlot, room_id: null })),
  ];
  const displaced = new Set(displacedSelfStudyIds);
  return {
    ...schedule,
    meetings,
    assignments: expandScheduleAssignments(schedule.sections || [], meetings),
    overlays: (schedule.overlays || []).filter(overlay => !displaced.has(overlay.id)),
    adjustment_buffer: remaining,
  };
}

function scheduleAfterMoves(schedule, moves, displacedSelfStudyIds) {
  const replacements = new Map();
  for (const move of moves) for (const sectionId of move.sectionIds) {
    replacements.set(`${sectionId}@${move.fromSlot}`, move.toSlot);
  }
  const meetings = (schedule.meetings || []).map(meeting => {
    const toSlot = replacements.get(`${meeting.section_id}@${meeting.slot_id}`);
    return toSlot ? { ...meeting, slot_id: toSlot, room_id: null } : meeting;
  });
  const displaced = new Set(displacedSelfStudyIds);
  return {
    ...schedule,
    meetings,
    assignments: expandScheduleAssignments(schedule.sections || [], meetings),
    overlays: (schedule.overlays || []).filter(overlay => !displaced.has(overlay.id)),
    adjustment_buffer: bufferItems(schedule),
  };
}

export function publicAdjustmentBuffer(state) {
  const sectionsById = indexById(state.schedule?.sections || []);
  const coursesById = indexById(state.courses || []);
  const teachersById = indexById(state.teachers || []);
  return bufferItems(state.schedule).map(item => {
    const primary = item.meetings?.[0] || {};
    const section = sectionsById.get(primary.section_id) || {};
    const course = coursesById.get(section.course_id);
    const teacher = teachersById.get(section.teacher_id);
    return {
      id: item.id,
      from_slot: item.from_slot,
      section_id: primary.section_id || null,
      linked_section_count: (item.meetings || []).length,
      title: course?.name || section.course_id || primary.section_id || '课程',
      subtitle: [teacher?.name || section.teacher_id, item.from_slot ? `原 ${item.from_slot}` : '']
        .filter(Boolean)
        .join(' · '),
      class_id: section.class_id || null,
    };
  });
}

function publicCandidate(candidate) {
  return {
    slot_id: candidate.slot_id,
    action: candidate.action,
    target_section_id: candidate.target_section_id || null,
    linked_section_count: candidate.linked_section_count,
    displaced_self_study_count: candidate.displaced_self_study_ids.length,
  };
}

/**
 * Classify every destination using the exact same full hard validator that
 * guards a saved timetable. Green destinations are one-way moves; blue
 * destinations atomically swap the two synchronized bundles.
 *
 * Teacher grids pair against the same teacher's other meeting. Class grids
 * pair against the other meeting shown in that class, so dragging one
 * required course onto another becomes a swap instead of a colliding move.
 */
export function evaluateTimetableAdjustments(state, problem, input = {}) {
  assertScheduleAdjustable(state);
  const schedule = state.schedule;
  const teacherId = input.teacher_id || null;
  const classId = input.class_id || null;
  const fromSlot = input.from_slot;
  const scope = classId ? 'class' : 'teacher';
  if (scope === 'teacher' && (!teacherId || !(input.task_id || input.section_id || input.buffer_id) || !fromSlot)) {
    throw new Error('拖动课程缺少教师、课程或原时段');
  }
  if (scope === 'class' && (!classId || !(input.task_id || input.section_id || input.buffer_id) || !fromSlot)) {
    throw new Error('拖动课程缺少班级、课程或原时段');
  }

  const sectionsById = indexById(schedule.sections || []);
  const fromBuffer = fromSlot === ADJUSTMENT_BUFFER_SLOT || Boolean(input.buffer_id);
  let sourceAssignment;
  let sourceBundle;
  if (fromBuffer) {
    const item = bufferItems(schedule).find(entry => entry.id === input.buffer_id)
      || bufferItems(schedule).find(entry =>
        (entry.meetings || []).some(meeting => meeting.section_id === input.section_id));
    if (!item) throw new Error('缓冲区里找不到这门课');
    const primary = item.meetings?.[0];
    const section = sectionsById.get(primary?.section_id);
    if (!section) throw new Error('缓冲区课程数据不完整');
    sourceAssignment = {
      section_id: section.id,
      student_id: section.student_ids?.[0],
      teacher_id: section.teacher_id,
      slot_id: ADJUSTMENT_BUFFER_SLOT,
    };
    sourceBundle = {
      sectionIds: new Set((item.meetings || []).map(meeting => meeting.section_id)),
      meetings: item.meetings || [],
      bufferItem: item,
    };
  } else {
    sourceAssignment = sourceAssignmentFromInput(schedule, {
      teacherId,
      taskId: input.task_id,
      sectionId: input.section_id,
      fromSlot,
    });
    sourceBundle = meetingBundle(problem, schedule, sourceAssignment.section_id, fromSlot);
  }
  const memberIds = scope === 'class' ? classMemberIds(state, classId) : [];
  if (scope === 'class') {
    const students = sectionsById.get(sourceAssignment.section_id)?.student_ids || [];
    if (!students.some(studentId => memberIds.includes(studentId))) {
      throw new Error('该课程不属于当前班级课表');
    }
  }
  if (!fromBuffer && lockedMeeting(schedule, sourceBundle, fromSlot)) {
    throw new Error('该课程或其同步 Block 已锁定为必要条件，不能拖动');
  }

  const candidates = [];
  const unavailable = [];
  const considerPark = !fromBuffer;
  const destinations = [
    ...(problem.slots || []).map(slot => slot.id),
    ...(considerPark ? [ADJUSTMENT_BUFFER_SLOT] : []),
  ];
  for (const toSlot of destinations) {
    if (toSlot === fromSlot) continue;
    if (toSlot === ADJUSTMENT_BUFFER_SLOT) {
      const parkedSchedule = parkBundle(schedule, sourceBundle, fromSlot);
      const validation = validateAdjustedSchedule(problem, parkedSchedule);
      if (!validation.ok) {
        unavailable.push({ slot_id: toSlot, reason: firstViolationMessage(validation) });
        continue;
      }
      candidates.push({
        slot_id: toSlot,
        action: 'park',
        target_section_id: null,
        linked_section_count: sourceBundle.sectionIds.size,
        displaced_self_study_ids: [],
        schedule: withBufferValidation(parkedSchedule, validation),
      });
      continue;
    }

    const counterparts = counterpartMeetings(schedule, sectionsById, {
      scope,
      teacherId,
      memberIds,
      sourceSectionIds: sourceBundle.sectionIds,
      toSlot,
    });
    if (scope === 'teacher' && counterparts.length > 1) {
      unavailable.push({ slot_id: toSlot, reason: '该教师此时已有多节课，不能互换' });
      continue;
    }

    let action = 'move';
    let targetBundle = null;
    const moves = fromBuffer
      ? []
      : [{ sectionIds: sourceBundle.sectionIds, fromSlot, toSlot }];
    if (counterparts.length > 0) {
      try {
        targetBundle = meetingBundle(problem, schedule, counterparts[0].section_id, toSlot);
      } catch (error) {
        unavailable.push({ slot_id: toSlot, reason: error.message });
        continue;
      }
      if (counterparts.some(meeting => !targetBundle.sectionIds.has(meeting.section_id))) {
        unavailable.push({ slot_id: toSlot, reason: '该时段有多门并行课程，不能整格互换' });
        continue;
      }
      if ([...targetBundle.sectionIds].some(sectionId => sourceBundle.sectionIds.has(sectionId))) {
        unavailable.push({ slot_id: toSlot, reason: '目标课程与当前课程属于同一同步组，不能互换' });
        continue;
      }
      if (lockedMeeting(schedule, targetBundle, toSlot)) {
        unavailable.push({ slot_id: toSlot, reason: '目标课程已锁定为必要条件，不能互换' });
        continue;
      }
      action = 'swap';
      if (!fromBuffer) {
        moves.push({ sectionIds: targetBundle.sectionIds, fromSlot: toSlot, toSlot: fromSlot });
      }
    }

    const impact = overlayImpact(state, sectionsById, fromBuffer
      ? [{ sectionIds: sourceBundle.sectionIds, fromSlot: toSlot, toSlot }]
      : moves);
    if (impact.blocked) {
      unavailable.push({ slot_id: toSlot, reason: '该时段已有特殊事件标注，不能覆盖' });
      continue;
    }
    const candidateSchedule = fromBuffer
      ? placeFromBuffer(schedule, sourceBundle.bufferItem, toSlot, targetBundle, impact.displacedSelfStudyIds)
      : scheduleAfterMoves(schedule, moves, impact.displacedSelfStudyIds);
    const validation = validateAdjustedSchedule(problem, candidateSchedule);
    if (!validation.ok) {
      unavailable.push({ slot_id: toSlot, reason: firstViolationMessage(validation) });
      continue;
    }
    candidates.push({
      slot_id: toSlot,
      action,
      target_section_id: counterparts[0]?.section_id || null,
      linked_section_count: sourceBundle.sectionIds.size + (targetBundle?.sectionIds.size || 0),
      displaced_self_study_ids: impact.displacedSelfStudyIds,
      schedule: withBufferValidation(candidateSchedule, validation),
    });
  }

  return {
    source: {
      section_id: sourceAssignment.section_id,
      slot_id: fromSlot,
      linked_section_count: sourceBundle.sectionIds.size,
      buffer_id: sourceBundle.bufferItem?.id || null,
    },
    candidates,
    public_candidates: candidates.map(publicCandidate),
    unavailable,
  };
}

export function evaluateTeacherTimetableAdjustments(state, problem, input = {}) {
  return evaluateTimetableAdjustments(state, problem, input);
}

export function evaluateClassTimetableAdjustments(state, problem, input = {}) {
  return evaluateTimetableAdjustments(state, problem, input);
}

function applyEvaluatedAdjustment(evaluated, input = {}) {
  const requestedAction = String(input.action || '');
  const candidate = evaluated.candidates.find(item =>
    item.slot_id === input.to_slot && (!requestedAction || item.action === requestedAction));
  if (!candidate) {
    const reason = evaluated.unavailable.find(item => item.slot_id === input.to_slot)?.reason;
    throw new Error(reason || '目标时段已不可用，课表可能已变化；请重新拖动后再试');
  }
  return {
    action: candidate.action,
    schedule: candidate.schedule,
    displaced_self_study_count: candidate.displaced_self_study_ids.length,
    linked_section_count: candidate.linked_section_count,
  };
}

export function applyTeacherTimetableAdjustment(state, problem, input = {}) {
  return applyEvaluatedAdjustment(evaluateTeacherTimetableAdjustments(state, problem, input), input);
}

export function applyClassTimetableAdjustment(state, problem, input = {}) {
  return applyEvaluatedAdjustment(evaluateClassTimetableAdjustments(state, problem, input), input);
}
