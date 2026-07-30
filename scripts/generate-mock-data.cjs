/**
 * 生成模拟排课数据 (timetable.json + rules.json)
 * 用法: node scripts/generate-mock-data.cjs
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

// === 模拟学生生成 ===
const students = [];
let sid = 1;

// G10: 3 个教学班 (TC_G10_1/2/3), 2 个行政班 (AC1/AC2), 每班约 25 人
const g10Configs = [
  { ac: 'AC1', tc: 'TC_G10_1' },
  { ac: 'AC2', tc: 'TC_G10_1' },
  { ac: 'AC1', tc: 'TC_G10_2' },
  { ac: 'AC2', tc: 'TC_G10_2' },
  { ac: 'AC1', tc: 'TC_G10_3' },
  { ac: 'AC2', tc: 'TC_G10_3' },
];
// 每 grade 80 人 = 6 组: 4 组各 13 + 2 组各 14 = 52 + 28 = 80
g10Configs.forEach(({ ac, tc }, gi) => {
  const n = gi < 2 ? 14 : 13;
  for (let i = 0; i < n; i++) {
    students.push({ id: `S${sid}`, name: `G10学生${sid}`, grade: 10, admin_class_id: ac, teaching_class_id: tc });
    sid++;
  }
});

// G11: 3 个教学班, 2 个行政班 (AC3/AC4)
const g11Configs = [
  { ac: 'AC3', tc: 'TC_G11_1' },
  { ac: 'AC4', tc: 'TC_G11_1' },
  { ac: 'AC3', tc: 'TC_G11_2' },
  { ac: 'AC4', tc: 'TC_G11_2' },
  { ac: 'AC3', tc: 'TC_G11_3' },
  { ac: 'AC4', tc: 'TC_G11_3' },
];
g11Configs.forEach(({ ac, tc }, gi) => {
  const n = gi < 2 ? 14 : 13;
  for (let i = 0; i < n; i++) {
    const s = { id: `S${sid}`, name: `G11学生${sid}`, grade: 11, admin_class_id: ac, teaching_class_id: tc };
    // TC_G11_3 学生已选 AP_LC(5hrs)，额外 AP 减量；TC1/2 约 25% 选 AP
    if (tc !== 'TC_G11_3') {
      if (i % 4 === 0) s.ap_courses = ['AP_PHYS2'];  // ~25% of students
      else if (i % 5 === 0) s.ap_courses = ['AP_CHEM']; // ~20%
      else if (i % 7 === 0) s.ap_courses = ['AP_BIO'];  // ~14%
      else if (i % 9 === 0) s.ap_courses = ['AP_CS'];   // ~11%
    } else {
      if (i % 5 === 0) s.ap_courses = ['AP_PSYCH'];  // ~20% of TC3
      else if (i % 7 === 0) s.ap_courses = ['AP_ENVSCI'];
    }
    students.push(s);
    sid++;
  }
});

// G12: 3 个教学班, 2 个行政班 (AC5/AC6)
const g12Configs = [
  { ac: 'AC5', tc: 'TC_G12_1' },
  { ac: 'AC6', tc: 'TC_G12_1' },
  { ac: 'AC5', tc: 'TC_G12_2' },
  { ac: 'AC6', tc: 'TC_G12_2' },
  { ac: 'AC5', tc: 'TC_G12_3' },
  { ac: 'AC6', tc: 'TC_G12_3' },
];
const groupA = ['AP_LANG', 'AP_LIT', 'HONOR_LIT'];
const groupB = ['LINEAR_ALG', 'BUSINESS', 'MECH_BASIS'];
const groupC = ['JAPANESE', 'FRENCH', 'GERMAN'];

g12Configs.forEach(({ ac, tc }, ci) => {
  const n = ci < 2 ? 14 : 13;
  for (let i = 0; i < n; i++) {
    const s = {
      id: `S${sid}`, name: `G12学生${sid}`, grade: 12,
      admin_class_id: ac, teaching_class_id: tc,
      elective_choices: {
        group_a: groupA[(ci + i) % 3],
        group_b: groupB[(ci + i + 1) % 3],
        group_c: groupC[(ci + i + 2) % 3],
      },
    };
    // G12 AP: 约 20-25% 学生选额外 AP（教学班已含 AP_STAT/ENG_CW）
    if (i % 4 === 0) s.ap_courses = ['AP_PHYSC'];
    else if (i % 7 === 0) s.ap_courses = ['AP_CHEM'];
    else if (i % 9 === 0) s.ap_courses = ['AP_MACRO'];
    students.push(s);
    sid++;
  }
});

console.log(`生成了 ${students.length} 名学生 (G10: ${students.filter(s=>s.grade===10).length}, G11: ${students.filter(s=>s.grade===11).length}, G12: ${students.filter(s=>s.grade===12).length})`);

// === timetable.json ===
const timetable = {
  version: '1.0',
  meta: { school: '模拟学校', created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
  config: { time_model: { days: 5, periods_per_day: 10, lunch_break_after_period: 5 }, walk_blocks: [] },
  teachers: [
    // G10 teachers
    { id: 'T_CUIXIAOPENG', name: '崔晓鹏', can_teach: [], available_slots: [], max_per_day: 8, max_per_week: 30 },
    { id: 'T_XIEHAOYANG', name: '谢昊洋', can_teach: [], available_slots: [], max_per_day: 8, max_per_week: 30 },
    { id: 'T_ZHANGRAN', name: '张冉', can_teach: [], available_slots: [], max_per_day: 8, max_per_week: 30 },
    { id: 'T_LIYIXUAN', name: '李熠萱', can_teach: [], available_slots: [], max_per_day: 8, max_per_week: 30 },
    { id: 'T_BIFEI', name: '毕飞', can_teach: [], available_slots: [], max_per_day: 8, max_per_week: 30 },
    { id: 'T_NIUYONGMEI', name: '牛永梅', can_teach: [], available_slots: [], max_per_day: 8, max_per_week: 30 },
    { id: 'T_RACHEL', name: 'Rachel', can_teach: [], available_slots: [], max_per_day: 8, max_per_week: 30 },
    { id: 'T_VINCENT', name: 'Vincent', can_teach: [], available_slots: [], max_per_day: 8, max_per_week: 30 },
    { id: 'T_JIZHUREN', name: '季主任', can_teach: [], available_slots: [], max_per_day: 8, max_per_week: 30 },
    { id: 'T_EXP_A', name: '实验教师A', can_teach: [], available_slots: [], max_per_day: 8, max_per_week: 30 },
    { id: 'T_EXP_B', name: '实验教师B', can_teach: [], available_slots: [], max_per_day: 8, max_per_week: 30 },
    { id: 'T_EXP_C', name: '实验教师C', can_teach: [], available_slots: [], max_per_day: 8, max_per_week: 30 },
    { id: 'T_EXP_D', name: '实验教师D', can_teach: [], available_slots: [], max_per_day: 8, max_per_week: 30 },
    { id: 'T_GUIDANCE', name: '升学指导教师', can_teach: [], available_slots: [], max_per_day: 8, max_per_week: 30 },
    // G11 teachers
    { id: 'T_WANGLILI', name: '王丽丽', can_teach: [], available_slots: [], max_per_day: 8, max_per_week: 30 },
    { id: 'T_YULIN', name: '于林', can_teach: [], available_slots: [], max_per_day: 8, max_per_week: 30 },
    { id: 'T_BAIRUSHUANG', name: '白瑞双', can_teach: [], available_slots: [], max_per_day: 8, max_per_week: 30 },
    { id: 'T_WEIWEI', name: '韦唯', can_teach: [], available_slots: [], max_per_day: 8, max_per_week: 30 },
    { id: 'T_LUKE', name: 'Luke', can_teach: [], available_slots: [], max_per_day: 8, max_per_week: 30 },
    { id: 'T_HANPENG', name: '韩鹏', can_teach: [], available_slots: [], max_per_day: 8, max_per_week: 30 },
    { id: 'T_EXP_E', name: '实验教师E', can_teach: [], available_slots: [], max_per_day: 8, max_per_week: 30 },
    { id: 'T_EXP_F', name: '实验教师F', can_teach: [], available_slots: [], max_per_day: 8, max_per_week: 30 },
    { id: 'T_EXP_G', name: '实验教师G', can_teach: [], available_slots: [], max_per_day: 8, max_per_week: 30 },
    { id: 'T_EXP_H1', name: '实验教师H1', can_teach: [], available_slots: [], max_per_day: 8, max_per_week: 30 },
    { id: 'T_EXP_H2', name: '实验教师H2', can_teach: [], available_slots: [], max_per_day: 8, max_per_week: 30 },
    { id: 'T_EXP_J', name: '实验教师J', can_teach: [], available_slots: [], max_per_day: 8, max_per_week: 30 },
    { id: 'T_ZHANGZUOPING', name: '张作平', can_teach: [], available_slots: [], max_per_day: 8, max_per_week: 30 },
    { id: 'T_YANGHONGXU', name: '杨宏旭', can_teach: [], available_slots: [], max_per_day: 8, max_per_week: 30 },
    { id: 'T_FANZHENGWEI', name: '范正伟', can_teach: [], available_slots: [], max_per_day: 8, max_per_week: 30 },
    { id: 'T_SUNHUA', name: '孙华', can_teach: [], available_slots: [], max_per_day: 8, max_per_week: 30 },
    { id: 'T_FUXIAOMENG', name: '付晓萌', can_teach: [], available_slots: [], max_per_day: 8, max_per_week: 30 },
    { id: 'T_ZHUJIE', name: '朱洁', can_teach: [], available_slots: [], max_per_day: 8, max_per_week: 30 },
    { id: 'T_QINXINXUAN', name: '秦新轩', can_teach: [], available_slots: [], max_per_day: 8, max_per_week: 30 },
    { id: 'T_ZHANGHUIHUI', name: '张慧慧', can_teach: [], available_slots: [], max_per_day: 8, max_per_week: 30 },
    { id: 'T_GLENN', name: 'Glenn', can_teach: [], available_slots: [], max_per_day: 8, max_per_week: 30 },
    // G12 teachers
    { id: 'T_JAIME', name: 'Jaime', can_teach: [], available_slots: [], max_per_day: 8, max_per_week: 30 },
    { id: 'T_EXP_K', name: '实验教师K', can_teach: [], available_slots: [], max_per_day: 8, max_per_week: 30 },
    { id: 'T_EXP_L', name: '实验教师L', can_teach: [], available_slots: [], max_per_day: 8, max_per_week: 30 },
    { id: 'T_YUYUANYING', name: '于元英', can_teach: [], available_slots: [], max_per_day: 8, max_per_week: 30 },
  ],
  rooms: [
    { id: 'R1', name: 'TC_G10_1教室', type: 'general', capacity: 30 },
    { id: 'R2', name: 'TC_G10_2/3教室', type: 'general', capacity: 30 },
    { id: 'R5', name: 'TC_G11_1/2教室', type: 'general', capacity: 30 },
    { id: 'R6', name: 'TC_G11_3/AC4教室', type: 'general', capacity: 30 },
    { id: 'R9', name: 'G12 AC5教室', type: 'general', capacity: 30 },
    { id: 'R10', name: 'G12 AC6教室', type: 'general', capacity: 30 },
  ],
  // 课程名称按 Excel 课程安排表
  courses: [
    // === G10 (Senior 1) ===
    { id: 'ENG_LS', name: '中教Listening&Speaking', type: 'required', weekly_hours: 3 },
    { id: 'ENG_RW', name: '中教Reading&Writing', type: 'required', weekly_hours: 3 },
    { id: 'ENG_LIT', name: '外教Listening&Speaking&Literature Reading', type: 'required', weekly_hours: 4 },
    { id: 'ENG_SURVEY', name: '英美概况', type: 'required', weekly_hours: 2 },
    { id: 'MATH_PRECAL', name: '中方数学+Pre-Calculus', type: 'required', weekly_hours: 6 },
    { id: 'AP_PHYS1', name: 'AP Physics 1+中方物理', type: 'required', weekly_hours: 5 },
    { id: 'CHEM_PRE', name: '中方化学+Pre-Chemistry', type: 'required', weekly_hours: 5 },
    { id: 'BIO_PRE', name: '中方生物+Pre-Biology', type: 'required', weekly_hours: 5 },
    { id: 'GRAMMAR', name: '语法', type: 'required', weekly_hours: 2 },
    { id: 'CHIN', name: '语文', type: 'required', weekly_hours: 2 },
    { id: 'HIST', name: '历史', type: 'required', weekly_hours: 2 },
    { id: 'GEOG', name: '地理', type: 'required', weekly_hours: 2 },
    { id: 'ART', name: '美术', type: 'required', weekly_hours: 1 },
    { id: 'GUIDANCE', name: '升学课堂', type: 'required', weekly_hours: 1 },
    // === G11 (Senior 2) ===
    { id: 'ENG_COMP', name: 'Comprehensive English', type: 'required', weekly_hours: 4 },
    { id: 'HONOR_LC', name: 'Honor LC (C1&C2)', type: 'required', weekly_hours: 2 },
    { id: 'AP_LC', name: 'AP LC (Class 3)', type: 'required', weekly_hours: 5 },
    { id: 'TOEFL', name: 'TOEFL (C1&C2)', type: 'required', weekly_hours: 3 },
    { id: 'AP_CALC_BC', name: 'AP Calculus BC', type: 'required', weekly_hours: 5 },
    { id: 'PRE_AP_LIT', name: 'Pre AP-Literature and Composition', type: 'required', weekly_hours: 2 },
    { id: 'PHYS_CN', name: '中方物理', type: 'required', weekly_hours: 2 },
    { id: 'MATH_CN', name: '中方数学', type: 'required', weekly_hours: 2 },
    { id: 'POL', name: '政治', type: 'required', weekly_hours: 2 },
    { id: 'IT', name: '信息技术', type: 'required', weekly_hours: 1 },
    // AP G11
    { id: 'AP_PHYS2', name: 'AP Physics 2', type: 'ap', weekly_hours: 5 },
    { id: 'AP_CHEM', name: 'AP Chemistry', type: 'ap', weekly_hours: 5 },
    { id: 'AP_BIO', name: 'AP Biology', type: 'ap', weekly_hours: 5 },
    { id: 'AP_CS', name: 'AP Computer Science', type: 'ap', weekly_hours: 5 },
    { id: 'AP_PSYCH', name: 'AP Psychology', type: 'ap', weekly_hours: 5 },
    { id: 'AP_ENVSCI', name: 'AP Environmental Science', type: 'ap', weekly_hours: 5 },
    { id: 'AP_MACRO', name: 'AP Macroeconomics', type: 'ap', weekly_hours: 5 },
    { id: 'AP_ARTHIST', name: 'AP Art History', type: 'ap', weekly_hours: 5 },
    { id: 'AP_MICRO', name: 'AP Microeconomics', type: 'ap', weekly_hours: 5 },
    // === G12 (Senior 3) ===
    { id: 'AP_STAT', name: 'AP Statistics', type: 'required', weekly_hours: 5 },
    { id: 'ENG_CW', name: 'English Creative Writing', type: 'required', weekly_hours: 5 },
    { id: 'COLLEGE_APP', name: '大学申请自习课', type: 'required', weekly_hours: 4 },
    { id: 'AP_LANG', name: 'AP Language and Composition', type: 'required_elective', weekly_hours: 5, elective_group: 'A' },
    { id: 'AP_LIT', name: 'AP Literature and Composition', type: 'required_elective', weekly_hours: 5, elective_group: 'A' },
    { id: 'HONOR_LIT', name: 'Honor 英美文学史及选读', type: 'required_elective', weekly_hours: 5, elective_group: 'A' },
    { id: 'AP_PHYSC', name: 'AP Physics C', type: 'ap', weekly_hours: 5 },
    { id: 'LINEAR_ALG', name: '线性代数', type: 'required_elective', weekly_hours: 4, elective_group: 'B' },
    { id: 'BUSINESS', name: '商业', type: 'required_elective', weekly_hours: 4, elective_group: 'B' },
    { id: 'MECH_BASIS', name: '力学基础', type: 'required_elective', weekly_hours: 4, elective_group: 'B' },
    { id: 'JAPANESE', name: '日语', type: 'required_elective', weekly_hours: 2, elective_group: 'C' },
    { id: 'FRENCH', name: '法语', type: 'required_elective', weekly_hours: 2, elective_group: 'C' },
    { id: 'GERMAN', name: '德语', type: 'required_elective', weekly_hours: 2, elective_group: 'C' },
    // === 通用 ===
    { id: 'PE', name: '体育', type: 'required', weekly_hours: 2 },
    { id: 'DUTY', name: '值日', type: 'other', weekly_hours: 1 },
    { id: 'MEETING', name: '班会', type: 'other', weekly_hours: 1 },
    { id: 'CLUB', name: '社团', type: 'other', weekly_hours: 2 },
    { id: 'SELF_STUDY', name: '自习', type: 'other', weekly_hours: 2 },
  ],
  students,
  admin_classes: [
    { id: 'AC1', name: 'G10-1班', grade: 1, fixed_room_id: 'R1', student_ids: students.filter(s => s.admin_class_id === 'AC1').map(s => s.id) },
    { id: 'AC2', name: 'G10-2班', grade: 1, fixed_room_id: 'R2', student_ids: students.filter(s => s.admin_class_id === 'AC2').map(s => s.id) },
    { id: 'AC3', name: 'G11-1班', grade: 2, fixed_room_id: 'R5', student_ids: students.filter(s => s.admin_class_id === 'AC3').map(s => s.id) },
    { id: 'AC4', name: 'G11-2班', grade: 2, fixed_room_id: 'R6', student_ids: students.filter(s => s.admin_class_id === 'AC4').map(s => s.id) },
    { id: 'AC5', name: 'G12-1班', grade: 3, fixed_room_id: 'R9', student_ids: students.filter(s => s.admin_class_id === 'AC5').map(s => s.id) },
    { id: 'AC6', name: 'G12-2班', grade: 3, fixed_room_id: 'R10', student_ids: students.filter(s => s.admin_class_id === 'AC6').map(s => s.id) },
  ],
  teaching_classes: [
    { id: 'TC_G10_1', name: 'G10教学1班', grade: 1, fixed_room_id: 'R1', student_ids: students.filter(s => s.teaching_class_id === 'TC_G10_1').map(s => s.id) },
    { id: 'TC_G10_2', name: 'G10教学2班', grade: 1, fixed_room_id: 'R2', student_ids: students.filter(s => s.teaching_class_id === 'TC_G10_2').map(s => s.id) },
    { id: 'TC_G10_3', name: 'G10教学3班', grade: 1, fixed_room_id: 'R2', student_ids: students.filter(s => s.teaching_class_id === 'TC_G10_3').map(s => s.id) },
    { id: 'TC_G11_1', name: 'G11教学1班', grade: 2, fixed_room_id: 'R5', student_ids: students.filter(s => s.teaching_class_id === 'TC_G11_1').map(s => s.id) },
    { id: 'TC_G11_2', name: 'G11教学2班', grade: 2, fixed_room_id: 'R5', student_ids: students.filter(s => s.teaching_class_id === 'TC_G11_2').map(s => s.id) },
    { id: 'TC_G11_3', name: 'G11教学3班', grade: 2, fixed_room_id: 'R6', student_ids: students.filter(s => s.teaching_class_id === 'TC_G11_3').map(s => s.id) },
    { id: 'TC_G12_1', name: 'G12教学1班', grade: 3, fixed_room_id: 'R9', student_ids: students.filter(s => s.teaching_class_id === 'TC_G12_1').map(s => s.id) },
    { id: 'TC_G12_2', name: 'G12教学2班', grade: 3, fixed_room_id: 'R10', student_ids: students.filter(s => s.teaching_class_id === 'TC_G12_2').map(s => s.id) },
    { id: 'TC_G12_3', name: 'G12教学3班', grade: 3, fixed_room_id: 'R10', student_ids: students.filter(s => s.teaching_class_id === 'TC_G12_3').map(s => s.id) },
  ],
  teaching_assignments: [],
  ap_selections: [],
  ap_sections: [],
  teaching_tasks: [],
  constraints: [],
  assignments: [],
  locks: [],
};

// === rules.json ===
const rules = {
  version: '1.0',
  rules: [
    { id: 'fixed_duty', type: 'hard', description: '值日固定在周一第10节', course: 'DUTY', fixed_slot: 'D1P10', grades: [11, 12] },
    { id: 'fixed_meeting', type: 'hard', description: '班会固定在周一第9节', course: 'MEETING', fixed_slot: 'D1P9' },
    { id: 'fixed_club_tue', type: 'hard', description: '社团固定在周二第10节', course: 'CLUB', fixed_slot: 'D2P10' },
    { id: 'fixed_club_fri', type: 'hard', description: '社团固定在周五第10节', course: 'CLUB', fixed_slot: 'D5P10' },
    { id: 'ss_afternoon', type: 'soft', description: '自习优先排下午', condition: "course=='SELF_STUDY'&&period<=5", penalty: 10 },
    { id: 'no_cluster', type: 'soft', description: '避免连续同槽', condition: 'no_cluster', penalty: 3 },
    { id: 'teacher_p1_limit', type: 'hard', description: '教师P1不超过3次/周', scope: 'teacher', condition: 'teacher_p1_limit' },
  ],
  // Admin pairs (cross-class slot assignments)
  admin_pairs: {
    slots: [
      // GRAMMAR/CHIN 互换: 各2节
      { slot: 'D1P2', ac1: 'GRAMMAR', ac2: 'CHIN' },
      { slot: 'D1P3', ac1: 'CHIN', ac2: 'GRAMMAR' },
      { slot: 'D3P2', ac1: 'GRAMMAR', ac2: 'CHIN' },
      { slot: 'D3P3', ac1: 'CHIN', ac2: 'GRAMMAR' },
      // HIST/GEOG 互换: 各2节
      { slot: 'D1P4', ac1: 'HIST', ac2: 'GEOG' },
      { slot: 'D2P2', ac1: 'GEOG', ac2: 'HIST' },
      { slot: 'D3P4', ac1: 'HIST', ac2: 'GEOG' },
      { slot: 'D4P2', ac1: 'GEOG', ac2: 'HIST' },
      // ART/GUIDANCE 互换: 各1节（交叉配对确保每人1节ART+1节GUIDANCE）
      { slot: 'D2P3', ac1: 'ART', ac2: 'GUIDANCE' },
      { slot: 'D4P7', ac1: 'GUIDANCE', ac2: 'ART' },
    ],
  },
};

fs.writeFileSync(path.join(ROOT, 'timetable.json'), JSON.stringify(timetable, null, 2));
console.log('✅ timetable.json 已生成');
fs.writeFileSync(path.join(ROOT, 'rules.json'), JSON.stringify(rules, null, 2));
console.log('✅ rules.json 已生成');
console.log(`\n总计: ${students.length} 名学生, ${timetable.teachers.length} 名教师, ${timetable.rooms.length} 间教室`);
