const DEFINITIONS = Object.freeze([
  { key: 'students', label: '学生名单', core: true, unit: '人', view: 'students' },
  { key: 'teachers', label: '教师名单', core: true, unit: '人', view: 'teachers' },
  { key: 'courses', label: '课程目录', core: true, unit: '门', view: 'courses' },
  { key: 'teaching_tasks', label: '教学任务', core: true, unit: '条', view: 'assignments' },
  { key: 'ap_selections', label: 'AP 选课', core: false, unit: '条', view: 'selections' },
  { key: 'elective_selections', label: '其他选课', core: false, unit: '条', view: 'elective-selections' },
  { key: 'exams', label: '考试科目与时长', core: false, unit: '门', view: 'exam-scheduling' },
]);

export function importReadinessModel(counts = {}) {
  const items = DEFINITIONS.map(definition => {
    const count = Math.max(0, Number(counts[definition.key]) || 0);
    return {
      ...definition,
      count,
      status: count > 0 ? 'ready' : 'attention',
      status_label: count > 0 ? `已保存 ${count} ${definition.unit}` : '尚无数据',
    };
  });
  const coreItems = items.filter(item => item.core);
  const coreReadyCount = coreItems.filter(item => item.status === 'ready').length;
  return {
    items,
    core_ready_count: coreReadyCount,
    core_total: coreItems.length,
    core_ready: coreReadyCount === coreItems.length,
  };
}

/** Count canonical A/B/C elective choices without depending on a synthetic API entity. */
export function countElectiveSelections(students = []) {
  return (Array.isArray(students) ? students : []).reduce((total, student) =>
    total + Object.values(student?.elective_choices || {}).filter(Boolean).length, 0);
}

const TEMPLATES = Object.freeze({
  students: [
    '学号,姓名,英文名,姓名拼音,年级,行政班,教学班',
    'S001,张三,San Zhang,Zhang San,10,AC_G10_1,TC_G10_1',
  ],
  teachers: [
    '工号,姓名,可教课程,每日上限,每周上限',
    'T001,李老师,"MATH,PHYS",6,25',
  ],
  courses: [
    '课程编号,课程名称,类型,年级,班级类型,周课时',
    'MATH,数学,required,10,teaching,5',
  ],
});

export function importTemplateCsv(type) {
  const rows = TEMPLATES[type];
  if (!rows) throw new Error('不支持的导入模板');
  return `\uFEFF${rows.join('\r\n')}\r\n`;
}
