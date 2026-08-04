import { validateSchedule } from './schedule-validator.mjs';

function indexById(items = []) {
  return new Map(items.map(item => [item.id, item]));
}

function expandedAssignments(sections, meetings) {
  const bySection = indexById(sections);
  return meetings.flatMap(meeting => {
    const section = bySection.get(meeting.section_id);
    return (section?.student_ids || []).map(studentId => ({
      task_id: `${section.id}:${studentId}:${meeting.slot_id}`,
      section_id: section.id,
      student_id: studentId,
      slot_id: meeting.slot_id,
      room_id: null,
      teacher_id: section.teacher_id,
      course_id: section.course_id,
      class_id: section.class_id || section.id,
      class_type: section.class_type,
    }));
  });
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
    assignments: expandedAssignments(schedule.sections || [], meetings),
    overlays: (schedule.overlays || []).filter(overlay => !displaced.has(overlay.id)),
  };
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
 * Classify every teacher-grid destination using the exact same full hard
 * validator that guards a saved timetable.  Green destinations are one-way
 * moves; blue destinations atomically swap the two synchronized bundles.
 */
export function evaluateTeacherTimetableAdjustments(
  state,
  problem,
  { teacher_id: teacherId, task_id: taskId, from_slot: fromSlot } = {},
) {
  const schedule = state.schedule;
  if (!schedule || state.solve_status !== 'valid') {
    throw new Error('当前课表不是有效版本，请先完成排课再调整');
  }
  if (!teacherId || !taskId || !fromSlot) throw new Error('拖动课程缺少教师、课程或原时段');
  const sourceAssignment = (schedule.assignments || []).find(item =>
    item.task_id === taskId && item.slot_id === fromSlot);
  if (!sourceAssignment) throw new Error('找不到要拖动的课程');
  if (sourceAssignment.teacher_id !== teacherId) throw new Error('该课程不属于当前教师');

  const sectionsById = indexById(schedule.sections || []);
  const sourceBundle = meetingBundle(problem, schedule, sourceAssignment.section_id, fromSlot);
  if (lockedMeeting(schedule, sourceBundle, fromSlot)) {
    throw new Error('该课程或其同步 Block 已锁定为必要条件，不能拖动');
  }

  const candidates = [];
  for (const slot of problem.slots || []) {
    const toSlot = slot.id;
    if (toSlot === fromSlot) continue;
    const targetTeacherMeetings = teacherMeetingsAtSlot(schedule, sectionsById, teacherId, toSlot);
    if (targetTeacherMeetings.length > 1) continue;

    let action = 'move';
    let targetBundle = null;
    const moves = [{ sectionIds: sourceBundle.sectionIds, fromSlot, toSlot }];
    if (targetTeacherMeetings.length === 1) {
      const targetMeeting = targetTeacherMeetings[0];
      if (sourceBundle.sectionIds.has(targetMeeting.section_id)) continue;
      targetBundle = meetingBundle(problem, schedule, targetMeeting.section_id, toSlot);
      if ([...targetBundle.sectionIds].some(sectionId => sourceBundle.sectionIds.has(sectionId))) continue;
      if (lockedMeeting(schedule, targetBundle, toSlot)) continue;
      action = 'swap';
      moves.push({ sectionIds: targetBundle.sectionIds, fromSlot: toSlot, toSlot: fromSlot });
    }

    const impact = overlayImpact(state, sectionsById, moves);
    if (impact.blocked) continue;
    const candidateSchedule = scheduleAfterMoves(schedule, moves, impact.displacedSelfStudyIds);
    const validation = validateSchedule(problem, candidateSchedule);
    if (!validation.ok) continue;
    candidates.push({
      slot_id: toSlot,
      action,
      target_section_id: targetTeacherMeetings[0]?.section_id || null,
      linked_section_count: sourceBundle.sectionIds.size + (targetBundle?.sectionIds.size || 0),
      displaced_self_study_ids: impact.displacedSelfStudyIds,
      schedule: { ...candidateSchedule, validation },
    });
  }

  return {
    source: {
      section_id: sourceAssignment.section_id,
      slot_id: fromSlot,
      linked_section_count: sourceBundle.sectionIds.size,
    },
    candidates,
    public_candidates: candidates.map(publicCandidate),
  };
}

export function applyTeacherTimetableAdjustment(state, problem, input = {}) {
  const evaluated = evaluateTeacherTimetableAdjustments(state, problem, input);
  const requestedAction = String(input.action || '');
  const candidate = evaluated.candidates.find(item =>
    item.slot_id === input.to_slot && (!requestedAction || item.action === requestedAction));
  if (!candidate) {
    throw new Error('目标时段已不可用，课表可能已变化；请重新拖动后再试');
  }
  return {
    action: candidate.action,
    schedule: candidate.schedule,
    displaced_self_study_count: candidate.displaced_self_study_ids.length,
    linked_section_count: candidate.linked_section_count,
  };
}
