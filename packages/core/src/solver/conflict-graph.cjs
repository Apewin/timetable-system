/**
 * 选课冲突图。
 * 将拥有相同 AP/必修选修组合的学生压缩为一个 cohort；边权表示两个
 * cohort 不能在同一时段上课的学生数。后续分班和局部重排只处理 cohort。
 */
function selectionKey(student) {
  const ap = [...(student.ap_courses || [])].sort();
  const electives = Object.entries(student.elective_choices || {})
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([group, course]) => `${group}:${course}`);
  return `${ap.join(',')}|${electives.join(',')}`;
}

function coursesFor(student) {
  return new Set([
    ...(student.ap_courses || []),
    ...Object.values(student.elective_choices || {}).filter(Boolean),
  ]);
}

function buildCohorts(students) {
  const byKey = new Map();
  for (const student of students) {
    const key = selectionKey(student);
    if (!byKey.has(key)) byKey.set(key, { id: `COHORT_${byKey.size + 1}`, key, student_ids: [], courses: coursesFor(student) });
    byKey.get(key).student_ids.push(student.id);
  }
  return [...byKey.values()];
}

function buildConflictGraph(students) {
  const cohorts = buildCohorts(students);
  const edges = [];
  for (let left = 0; left < cohorts.length; left++) {
    for (let right = left + 1; right < cohorts.length; right++) {
      const shared = [...cohorts[left].courses].filter(course => cohorts[right].courses.has(course));
      if (!shared.length) continue;
      edges.push({ from: cohorts[left].id, to: cohorts[right].id, courses: shared, weight: Math.min(cohorts[left].student_ids.length, cohorts[right].student_ids.length) });
    }
  }
  return { cohorts, edges };
}

module.exports = { selectionKey, coursesFor, buildCohorts, buildConflictGraph };
