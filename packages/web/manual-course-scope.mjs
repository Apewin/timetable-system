function sameGrade(section, currentClass, classesById) {
  const declaredGrades = (section.grades || []).map(Number).filter(Number.isFinite);
  if (declaredGrades.length) return declaredGrades.includes(Number(currentClass.grade));
  const sectionClass = classesById?.get(section.class_id);
  return sectionClass && Number(sectionClass.grade) === Number(currentClass.grade);
}

/**
 * Whether a course belongs in a particular manual-timetable course pool.
 *
 * The course editor is the source of truth for its grade range. A manual
 * timetable must not offer a card merely because an older assignment or draft
 * still happens to reference the course.
 */
export function courseAppliesToManualClass(course, currentClass) {
  if (!course || !currentClass) return false;
  const grade = Number(currentClass.grade);
  const courseGrades = (Array.isArray(course.grade) ? course.grade : [course.grade])
    .map(Number)
    .filter(Number.isFinite);
  if (!courseGrades.includes(grade)) return false;

  return true;
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
  // An administrative-course card represents the course's weekly timetable
  // slots, not the sum of every administrative class's physical lessons. For
  // example, PE configured as two lessons a week remains a two-card course
  // even when Senior 1 has two administrative classes. Individual class
  // progress is shown separately and a card only disappears once every class
  // has completed its own required lessons.
  if (item.placement_scope === 'admin' && item.kind === 'course') {
    return Math.max(...remainingBySection);
  }
  // Teaching-class required courses are a grade-wide deck: three teaching
  // classes with two lessons each are six independent cards.
  if (item.deck_scope === 'grade_teaching') {
    return remainingBySection.reduce((total, count) => total + count, 0);
  }
  // Synchronized bundles consume every member section at once, therefore the
  // first section that runs out determines the remaining capacity.
  return Math.min(...remainingBySection);
}

/**
 * Weekly capacity represented by a card in the manual course deck.
 *
 * An administrative-course card follows the course manager's weekly hours
 * (one shared card per weekly timetable slot). Its individual administrative
 * class sections remain independently validated elsewhere. Grade-wide
 * teaching decks still sum the sections because those are independent cards.
 */
export function manualPoolItemTotalHours(item, sectionsById) {
  if (!item) return 0;
  const sectionHours = (item.section_ids || [])
    .map(sectionId => sectionsById.get(sectionId))
    .filter(Boolean)
    .map(section => Number(section.weekly_hours || 0));
  if (item.placement_scope === 'admin' && item.kind === 'course') {
    return sectionHours.length
      ? Math.max(...sectionHours)
      : Number(item.weekly_hours || 0);
  }
  if (item.deck_scope === 'grade_teaching') {
    return sectionHours.length
      ? sectionHours.reduce((total, hours) => total + hours, 0)
      : Number(item.weekly_hours || 0);
  }
  return Number(item.weekly_hours || 0);
}
