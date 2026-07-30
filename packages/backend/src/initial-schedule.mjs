import { validateSchedule } from './schedule-validator.mjs';

function byId(items) { return new Map(items.map(item => [item.id, item])); }

function roomMatching(problem, sections, meetings) {
  const rooms = byId(problem.rooms);
  const sectionById = byId(sections);
  const bySlot = new Map();
  for (const meeting of meetings) { const list = bySlot.get(meeting.slot_id) || []; list.push(meeting); bySlot.set(meeting.slot_id, list); }
  const result = [];
  for (const atSlot of bySlot.values()) {
    const candidates = new Map(atSlot.map(meeting => {
      const section = sectionById.get(meeting.section_id);
      return [meeting.section_id, section.room_candidates.filter(roomId => rooms.get(roomId)?.capacity >= section.student_ids.length).sort()];
    }));
    const owner = new Map();
    const assign = (sectionId, visited = new Set()) => {
      for (const roomId of candidates.get(sectionId)) {
        if (visited.has(roomId)) continue;
        visited.add(roomId);
        if (!owner.has(roomId) || assign(owner.get(roomId), visited)) { owner.set(roomId, sectionId); return true; }
      }
      return false;
    };
    for (const sectionId of [...candidates.keys()].sort((left, right) => candidates.get(left).length - candidates.get(right).length || left.localeCompare(right))) {
      if (!assign(sectionId)) return null;
    }
    const roomForSection = new Map([...owner].map(([roomId, sectionId]) => [sectionId, roomId]));
    result.push(...atSlot.map(meeting => ({ ...meeting, room_id: roomForSection.get(meeting.section_id) })));
  }
  return result;
}

function expandAssignments(sections, meetings) {
  const sectionById = byId(sections);
  return meetings.flatMap(meeting => {
    const section = sectionById.get(meeting.section_id);
    return section.student_ids.map(studentId => ({
      task_id: `${section.id}:${studentId}:${meeting.slot_id}`,
      section_id: section.id, student_id: studentId, slot_id: meeting.slot_id, room_id: meeting.room_id,
      teacher_id: section.teacher_id, course_id: section.course_id,
      class_id: section.class_id || section.id, class_type: section.class_type,
    }));
  });
}

function sectionIdsForRule(rule, sections) {
  if (Array.isArray(rule.section_target_ids)) return rule.section_target_ids;
  switch (rule.scope) {
    case 'section': return rule.target_ids;
    case 'course': return sections.filter(section => rule.target_ids.includes(section.course_id)).map(section => section.id);
    case 'class': return sections.filter(section => rule.target_ids.includes(section.class_id)).map(section => section.id);
    case 'teacher': return sections.filter(section => rule.target_ids.includes(section.teacher_id)).map(section => section.id);
    case 'global': return sections.map(section => section.id);
    default: return [];
  }
}

/**
 * Deterministic DSATUR construction used as a feasibility warm start.  It is
 * graph colouring, not random restart or brute-force enumeration: each step
 * chooses the most constrained remaining meeting and the least-loaded legal
 * slot.  CP-SAT remains the general fallback/refinement engine.
 */
export function constructInitialSchedule(problem) {
  const sections = problem.sections.map(section => ({ ...section, student_ids: [...section.student_ids] }));
  const nodes = [];
  const sectionNodes = new Map();
  const dailyCourseIds = new Set((problem.rules || [])
    .filter(rule => rule.hard && rule.type === 'max_occurrences_per_day' && rule.scope === 'course' && rule.params.max === 1)
    .flatMap(rule => rule.target_ids));
  const fixedBySection = new Map();
  for (const rule of problem.rules || []) if (rule.hard && rule.type === 'fixed_slots') {
    for (const sectionId of sectionIdsForRule(rule, sections)) fixedBySection.set(sectionId, rule.params.slots);
  }
  const priorityBySection = new Map();
  for (const rule of problem.rules || []) if (rule.type === 'priority') {
    for (const sectionId of sectionIdsForRule(rule, sections)) priorityBySection.set(sectionId, Math.min(priorityBySection.get(sectionId) ?? Infinity, rule.params.rank));
  }
  for (const section of sections) {
    const own = [];
    const fixed = fixedBySection.get(section.id) || [];
    if (fixed.length > section.weekly_hours) return null;
    for (let index = 0; index < section.weekly_hours; index++) {
      const node = { id: `${section.id}@${index}`, section, index, fixedSlot: fixed[index] || null, neighbours: new Set(), color: null };
      nodes.push(node); own.push(node);
    }
    sectionNodes.set(section.id, own);
  }
  const addClique = members => {
    for (let left = 0; left < members.length; left++) for (let right = left + 1; right < members.length; right++) {
      members[left].neighbours.add(members[right]); members[right].neighbours.add(members[left]);
    }
  };
  for (const own of sectionNodes.values()) addClique(own);
  const byTeacher = new Map();
  const byStudent = new Map();
  for (const section of sections) {
    const own = sectionNodes.get(section.id);
    if (section.teacher_id) { const list = byTeacher.get(section.teacher_id) || []; list.push(...own); byTeacher.set(section.teacher_id, list); }
    for (const studentId of section.student_ids) { const list = byStudent.get(studentId) || []; list.push(...own); byStudent.set(studentId, list); }
  }
  for (const list of byTeacher.values()) addClique(list);
  for (const list of byStudent.values()) addClique(list);

  const colors = new Map(problem.slots.map(slot => [slot.id, 0]));
  const slotById = byId(problem.slots);
  const dayUse = new Map();
  const legal = node => {
    const used = new Set([...node.neighbours].filter(other => other.color).map(other => other.color));
    const ownDays = dayUse.get(node.section.id) || new Set();
    const daily = dailyCourseIds.has(node.section.course_id);
    return problem.slots.filter(slot => !used.has(slot.id) && (!daily || !ownDays.has(slot.day)) && (!node.fixedSlot || node.fixedSlot === slot.id));
  };
  let remaining = new Set(nodes);
  while (remaining.size) {
    const choices = [...remaining].map(node => ({ node, slots: legal(node) }));
    choices.sort((left, right) =>
      left.slots.length - right.slots.length
      || (priorityBySection.get(left.node.section.id) ?? Infinity) - (priorityBySection.get(right.node.section.id) ?? Infinity)
      || right.node.neighbours.size - left.node.neighbours.size
      || left.node.id.localeCompare(right.node.id));
    const { node, slots } = choices[0];
    if (!slots.length) return null;
    slots.sort((left, right) => colors.get(left.id) - colors.get(right.id) || left.id.localeCompare(right.id));
    node.color = slots[0].id;
    colors.set(node.color, colors.get(node.color) + 1);
    const usedDays = dayUse.get(node.section.id) || new Set(); usedDays.add(slotById.get(node.color).day); dayUse.set(node.section.id, usedDays);
    remaining.delete(node);
  }
  const timeOnlyMeetings = nodes.map(node => ({ section_id: node.section.id, slot_id: node.color }));
  const meetings = roomMatching(problem, sections, timeOnlyMeetings);
  if (!meetings) return null;
  const solution = { sections, meetings };
  const checked = validateSchedule(problem, solution);
  return checked.ok ? { ...solution, assignments: expandAssignments(sections, meetings), soft_score: checked.soft_score } : null;
}
