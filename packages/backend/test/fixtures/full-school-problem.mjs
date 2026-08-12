function slots() {
  return Array.from({ length: 50 }, (_, index) => ({
    id: `D${Math.floor(index / 10) + 1}P${index % 10 + 1}`,
    day: Math.floor(index / 10) + 1,
    period: index % 10 + 1,
  }));
}

function studentsForGrade(grade) {
  return Array.from({ length: 12 }, (_, index) => `ANON_G${grade}_${index + 1}`);
}

function section({ id, courseId, teacherId, hours, studentIds, grades, classType = 'teaching' }) {
  return {
    id,
    course_id: courseId,
    teacher_id: teacherId,
    class_type: classType,
    weekly_hours: hours,
    student_ids: studentIds,
    eligible_student_ids: [],
    locked_student_ids: [],
    grades,
  };
}

/**
 * Deterministic, anonymous whole-school regression input.  It contains all
 * three grades, administrative and teaching cohorts, cross-grade staffing,
 * three synchronized AP Blocks, and a manual lock without storing real names
 * or selections in Git.
 */
export function fullSchoolProblemFixture() {
  const sections = [];
  const rules = [];
  for (const grade of [10, 11, 12]) {
    const gradeStudents = studentsForGrade(grade);
    const teachingClasses = [0, 1, 2].map(index => gradeStudents.slice(index * 4, index * 4 + 4));
    const adminClasses = [gradeStudents.slice(0, 6), gradeStudents.slice(6)];
    for (const [index, roster] of teachingClasses.entries()) {
      const mathId = `G${grade}_MATH_TC${index + 1}`;
      const englishId = `G${grade}_ENGLISH_TC${index + 1}`;
      sections.push(section({
        id: mathId,
        courseId: `G${grade}_MATH`,
        teacherId: index === 0 && grade >= 11 ? 'T_SHARED_MATH' : `T_G${grade}_MATH_${index + 1}`,
        hours: 6,
        studentIds: roster,
        grades: [grade],
      }));
      sections.push(section({
        id: englishId,
        courseId: `G${grade}_ENGLISH`,
        teacherId: `T_G${grade}_ENGLISH_${index + 1}`,
        hours: 5,
        studentIds: roster,
        grades: [grade],
      }));
    }
    for (const [index, roster] of adminClasses.entries()) {
      sections.push(section({
        id: `G${grade}_CHINESE_AC${index + 1}`,
        courseId: `G${grade}_CHINESE`,
        teacherId: `T_G${grade}_CHINESE_${index + 1}`,
        hours: 4,
        studentIds: roster,
        grades: [grade],
        classType: 'admin',
      }));
      sections.push(section({
        id: `G${grade}_SPORT_AC${index + 1}`,
        courseId: `G${grade}_SPORT`,
        teacherId: `T_G${grade}_SPORT`,
        hours: 2,
        studentIds: roster,
        grades: [grade],
        classType: 'admin',
      }));
    }
    for (const courseId of [`G${grade}_MATH`, `G${grade}_ENGLISH`, `G${grade}_CHINESE`]) {
      rules.push({
        id: `daily_${courseId}`,
        type: 'max_occurrences_per_day',
        hard: true,
        weight: 0,
        scope: 'course',
        target_ids: [courseId],
        params: { max: courseId.endsWith('MATH') ? 2 : 1 },
      });
    }
  }

  const apStudents = [...studentsForGrade(11), ...studentsForGrade(12)];
  for (let blockIndex = 0; blockIndex < 3; blockIndex += 1) {
    const targets = [];
    for (let courseIndex = 0; courseIndex < 3; courseIndex += 1) {
      const id = `AP_BLOCK_${blockIndex + 1}_COURSE_${courseIndex + 1}`;
      const roster = apStudents.filter((_, index) => index % 3 === courseIndex);
      sections.push(section({
        id,
        courseId: `AP_COURSE_${blockIndex + 1}_${courseIndex + 1}`,
        teacherId: `T_AP_${blockIndex + 1}_${courseIndex + 1}`,
        hours: 3,
        studentIds: roster,
        grades: [11, 12],
        classType: 'ap',
      }));
      targets.push(id);
    }
    rules.push({
      id: `sync_ap_block_${blockIndex + 1}`,
      type: 'synchronized_slots',
      hard: true,
      weight: 0,
      scope: 'section',
      target_ids: targets,
      section_target_ids: targets,
      params: {},
    });
  }

  rules.push({
    id: 'teacher_shared_math_unavailable',
    type: 'forbid_slots',
    hard: true,
    weight: 0,
    scope: 'teacher',
    target_ids: ['T_SHARED_MATH'],
    params: { slots: ['D1P1', 'D2P1'] },
  });
  rules.push({
    id: 'prefer_sport_late',
    type: 'preferred_slots',
    hard: false,
    weight: 20,
    scope: 'course',
    target_ids: ['G10_SPORT', 'G11_SPORT', 'G12_SPORT'],
    params: { slots: slots().filter(item => item.period >= 6).map(item => item.id) },
  });

  return {
    slots: slots(),
    rooms: [],
    sections,
    rules,
    locks: [{ section_id: 'G10_CHINESE_AC1', slot_id: 'D1P2', origin: 'manual' }],
  };
}
