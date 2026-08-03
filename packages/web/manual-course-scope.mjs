function sameGrade(section, currentClass, classesById) {
  const declaredGrades = (section.grades || []).map(Number).filter(Number.isFinite);
  if (declaredGrades.length) return declaredGrades.includes(Number(currentClass.grade));
  const sectionClass = classesById?.get(section.class_id);
  return sectionClass && Number(sectionClass.grade) === Number(currentClass.grade);
}

/**
 * Returns the canonical sections that may be placed while viewing one class.
 * Administrative timetables are not selectable views, but their lessons must
 * remain available from every teaching-class view in the same grade.
 */
export function manualSectionsForClassCourse(sections, currentClass, courseId, classesById) {
  if (!currentClass) return [];
  return (sections || []).filter(section => {
    if (section.course_id !== courseId) return false;
    if (['ap', 'elective'].includes(section.class_type)) {
      return sameGrade(section, currentClass, classesById);
    }
    if (section.class_id === currentClass.id && section.class_type === currentClass.class_type) {
      return true;
    }
    return currentClass.class_type === 'teaching'
      && section.class_type === 'admin'
      && sameGrade(section, currentClass, classesById);
  });
}

/**
 * Sections represented by one course card in the manual deck.
 *
 * Required teaching courses are planned per teaching class, but their card is
 * a grade-level deck: three Senior 1 teaching classes with two periods each
 * are six cards in total.  The caller still resolves a drop to the current
 * teaching class's own section before it is saved.
 */
export function manualDeckSectionsForClassCourse(sections, currentClass, courseId, classesById) {
  const visibleSections = manualSectionsForClassCourse(sections, currentClass, courseId, classesById);
  const hasCurrentTeachingSection = currentClass?.class_type === 'teaching'
    && visibleSections.some(section => section.class_type === 'teaching'
      && section.class_id === currentClass.id);
  if (!hasCurrentTeachingSection) return visibleSections;
  return (sections || []).filter(section => section.course_id === courseId
    && section.class_type === 'teaching'
    && sameGrade(section, currentClass, classesById));
}

export function shouldCollapseAdminSections(sections, currentClass) {
  return currentClass?.class_type === 'teaching'
    && sections.length > 0
    && sections.every(section => section.class_type === 'admin');
}

export function manualPlacementScopeForSections(sections, currentClass) {
  return shouldCollapseAdminSections(sections, currentClass) ? 'admin' : 'class';
}

export function manualTeacherIdsForClassItem(assignments, classId, item) {
  const courseIds = new Set(item?.course_ids || []);
  return new Set((assignments || [])
    .filter(assignment => assignment.staffing_mode !== 'per_class')
    .filter(assignment => courseIds.has(assignment.course_id))
    .filter(assignment => {
      const classIds = Array.isArray(assignment.class_ids)
        ? assignment.class_ids
        : assignment.class_id ? [assignment.class_id] : [];
      return classIds.includes(classId);
    })
    .map(assignment => assignment.teacher_id)
    .filter(Boolean));
}

export function manualPoolItemRemaining(item, sectionsById, usageCounts = new Map()) {
  if (item?.manual_unlimited === true) return Infinity;
  const remainingBySection = (item?.section_ids || [])
    .map(sectionId => sectionsById.get(sectionId))
    .filter(Boolean)
    .map(section => Math.max(0,
      Number(section.weekly_hours || 0) - Number(usageCounts.get(section.id) || 0)));
  if (!remainingBySection.length) return 0;
  // A teaching-class card representing several administrative classes may be
  // drawn for any one of those class sections, so its deck is their combined
  // remaining inventory. Bundles consume all member sections together and are
  // therefore limited by the first section that runs out.
  return ((item.placement_scope === 'admin' && item.kind === 'course')
      || item.deck_scope === 'grade_teaching')
    ? remainingBySection.reduce((total, count) => total + count, 0)
    : Math.min(...remainingBySection);
}

/**
 * Weekly capacity represented by a card in the manual course deck.
 *
 * A generic administrative-course card is a shared deck for all eligible
 * administrative classes, so its capacity must be the sum of those sections.
 * Every other card keeps its per-section / synchronized-group capacity.
 */
export function manualPoolItemTotalHours(item, sectionsById) {
  if (!item) return 0;
  const isCombinedDeck = (item.placement_scope === 'admin' && item.kind === 'course')
    || item.deck_scope === 'grade_teaching';
  if (!isCombinedDeck) {
    return Number(item.weekly_hours || 0);
  }
  const sectionHours = (item.section_ids || [])
    .map(sectionId => sectionsById.get(sectionId))
    .filter(Boolean)
    .map(section => Number(section.weekly_hours || 0));
  return sectionHours.length
    ? sectionHours.reduce((total, hours) => total + hours, 0)
    : Number(item.weekly_hours || 0);
}
