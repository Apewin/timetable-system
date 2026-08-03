import assert from 'node:assert/strict';
import test from 'node:test';

import {
  manualPlacementScopeForSections,
  manualDeckSectionsForClassCourse,
  manualPoolItemTotalHours,
  manualPoolItemRemaining,
  manualSectionsForClassCourse,
  manualTeacherIdsForClassItem,
  shouldCollapseAdminSections,
} from '../manual-course-scope.mjs';

const classes = new Map([
  ['TC_G10_1', { id: 'TC_G10_1', grade: 10, class_type: 'teaching' }],
  ['TC_G10_2', { id: 'TC_G10_2', grade: 10, class_type: 'teaching' }],
  ['TC_G10_3', { id: 'TC_G10_3', grade: 10, class_type: 'teaching' }],
  ['AC1', { id: 'AC1', grade: 10, class_type: 'admin' }],
  ['AC2', { id: 'AC2', grade: 10, class_type: 'admin' }],
  ['AC3', { id: 'AC3', grade: 11, class_type: 'admin' }],
]);

const sections = [
  { id: 'TEACHING_OWN', course_id: 'ENGLISH', class_id: 'TC_G10_1', class_type: 'teaching', grades: [10] },
  { id: 'ADMIN_AC1', course_id: 'CHINESE', class_id: 'AC1', class_type: 'admin', grades: [10] },
  { id: 'ADMIN_AC2', course_id: 'CHINESE', class_id: 'AC2', class_type: 'admin', grades: [10] },
  { id: 'ADMIN_OTHER_GRADE', course_id: 'CHINESE', class_id: 'AC3', class_type: 'admin', grades: [11] },
];

test('a teaching-class timetable keeps same-grade administrative courses in its course pool', () => {
  const currentClass = classes.get('TC_G10_1');
  const visible = manualSectionsForClassCourse(sections, currentClass, 'CHINESE', classes);

  assert.deepEqual(visible.map(section => section.id), ['ADMIN_AC1', 'ADMIN_AC2']);
  assert.equal(shouldCollapseAdminSections(visible, currentClass), true);
});

test('a teaching required-course deck totals every applicable teaching class in the grade', () => {
  const currentClass = classes.get('TC_G10_1');
  const surveySections = [
    { id: 'SURVEY_1', course_id: 'SURVEY', class_id: 'TC_G10_1', class_type: 'teaching', grades: [10], weekly_hours: 2 },
    { id: 'SURVEY_2', course_id: 'SURVEY', class_id: 'TC_G10_2', class_type: 'teaching', grades: [10], weekly_hours: 2 },
    { id: 'SURVEY_3', course_id: 'SURVEY', class_id: 'TC_G10_3', class_type: 'teaching', grades: [10], weekly_hours: 2 },
  ];

  const deckSections = manualDeckSectionsForClassCourse(surveySections, currentClass, 'SURVEY', classes);
  assert.deepEqual(deckSections.map(section => section.id), ['SURVEY_1', 'SURVEY_2', 'SURVEY_3']);
  assert.equal(
    manualPoolItemTotalHours({
      kind: 'course',
      deck_scope: 'grade_teaching',
      section_ids: deckSections.map(section => section.id),
      weekly_hours: 2,
    }, new Map(deckSections.map(section => [section.id, section]))),
    6,
  );
});

test('hiding administrative timetable entry points does not broaden other class scopes', () => {
  const currentClass = classes.get('TC_G10_1');

  assert.deepEqual(
    manualSectionsForClassCourse(sections, currentClass, 'ENGLISH', classes).map(section => section.id),
    ['TEACHING_OWN'],
  );
  assert.deepEqual(
    manualSectionsForClassCourse(sections, classes.get('AC1'), 'CHINESE', classes).map(section => section.id),
    ['ADMIN_AC1'],
  );
});

test('an administrative activity uses administrative placement even when its course type is other', () => {
  const currentClass = classes.get('TC_G10_1');
  const meetingSections = [
    { id: 'MEETING_AC1', course_id: 'MEETING', class_id: 'AC1', class_type: 'admin', grades: [10] },
    { id: 'MEETING_AC2', course_id: 'MEETING', class_id: 'AC2', class_type: 'admin', grades: [10] },
  ];

  assert.equal(manualPlacementScopeForSections(meetingSections, currentClass), 'admin');
});

test('per-class staffing does not create a shared-teacher conflict in the manual draft', () => {
  const assignments = [{
    course_id: 'MEETING',
    class_ids: ['AC1', 'AC2'],
    teacher_id: 'HOMEROOM_ROLE',
    staffing_mode: 'per_class',
  }];

  assert.deepEqual(
    [...manualTeacherIdsForClassItem(assignments, 'AC1', { course_ids: ['MEETING'] })],
    [],
  );
});

test('a finite course card is exhausted after all of its weekly occurrences are drawn', () => {
  const item = {
    id: 'MATH', kind: 'course', section_ids: ['SEC_MATH'], placement_scope: 'class',
  };
  const sectionsById = new Map([['SEC_MATH', { id: 'SEC_MATH', weekly_hours: 2 }]]);

  assert.equal(manualPoolItemRemaining(item, sectionsById, new Map([['SEC_MATH', 2]])), 0);
});

test('an administrative course card displays the combined weekly capacity it draws from', () => {
  const item = {
    id: 'GUIDANCE',
    kind: 'course',
    placement_scope: 'admin',
    weekly_hours: 2,
    section_ids: ['SEC_GUIDANCE_AC1', 'SEC_GUIDANCE_AC2'],
  };
  const sectionsById = new Map([
    ['SEC_GUIDANCE_AC1', { id: 'SEC_GUIDANCE_AC1', weekly_hours: 2 }],
    ['SEC_GUIDANCE_AC2', { id: 'SEC_GUIDANCE_AC2', weekly_hours: 2 }],
  ]);

  assert.equal(manualPoolItemTotalHours(item, sectionsById), 4);
});

test('an unlimited self-study card never leaves the deck', () => {
  const item = {
    id: 'SELF_STUDY',
    section_ids: ['SEC_SELF'],
    manual_unlimited: true,
  };

  assert.equal(
    manualPoolItemRemaining(item, new Map(), new Map([['SEC_SELF', 99]])),
    Infinity,
  );
});
