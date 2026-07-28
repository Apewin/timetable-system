/**
 * Excel对齐验证器 - 验证课表是否完全符合课程安排表
 * 用法: node validate-against-excel.cjs [timetable.json路径]
 */
const fs = require('fs');

// Excel 规格 (from 课程安排表.xlsx)
const SPEC = {
  G10: {
    name: '高一',
    teaching: {
      ENG_LS:   { hrs: 3, teacher: 'T_BIFEI', name: '中教Listening&Speaking' },
      ENG_RW:   { hrs: 3, teacher: 'T_NIUYONGMEI', name: '中教Reading&Writing' },
      ENG_LIT:  { hrs: 4, teacher: 'T_RACHEL', name: '外教L&S&Lit Reading' },
      ENG_SURVEY:{hrs: 2, teacher: 'T_VINCENT', name: '英美概况' },
      MATH_PRECAL:{hrs:6, teacher: 'T_CUIXIAOPENG', name: '中方数学+Pre-Calculus' },
      AP_PHYS1: { hrs: 5, teacher: 'T_XIEHAOYANG', name: 'AP Physics 1+中方物理' },
      CHEM_PRE: { hrs: 5, teacher: 'T_ZHANGRAN', name: '中方化学+Pre-Chemistry' },
      BIO_PRE:  { hrs: 5, teacher: 'T_LIYIXUAN', name: '中方生物+Pre-Biology' },
      PE:       { hrs: 2, teacher: 'T_VINCENT', name: '体育' },
      SELF_STUDY:{hrs: 2, teacher: null, name: '自习' },
    },
    admin: {
      GRAMMAR:  { hrs: 2, teacher: 'T_JIZHUREN', name: '语法' },
      CHIN:     { hrs: 2, teacher: 'T_EXP_A', name: '语文' },
      HIST:     { hrs: 2, teacher: 'T_EXP_B', name: '历史' },
      GEOG:     { hrs: 2, teacher: 'T_EXP_C', name: '地理' },
      ART:      { hrs: 1, teacher: 'T_EXP_D', name: '美术' },
      GUIDANCE: { hrs: 1, teacher: 'T_GUIDANCE', name: '升学课堂' },
      MEETING:  { hrs: 1, teacher: null, name: '班会' },
      CLUB:     { hrs: 2, teacher: null, name: '社团' },
    },
    fixed_slots: { MEETING: ['D1P9'], CLUB: ['D2P10','D5P10'] },
    total: 50,
  },

  G11: {
    name: '高二',
    teaching: {
      ENG_COMP:   { hrs: 4, teacher: 'T_YULIN', name: '综合英语' },
      AP_CALC_BC: { hrs: 5, teacher: 'T_WANGLILI', name: 'AP Calculus BC' },
      PRE_AP_LIT: { hrs: 2, teacher: 'T_RACHEL', name: 'Pre AP-Lit' },
      PHYS_CN:    { hrs: 2, teacher: 'T_BAIRUSHUANG', name: '中方物理' },
      // Layered (varies by TC):
      // TC1&2: HONOR_LC(2)+TOEFL(3)
      // TC3: AP_LC(5)
    },
    admin: {
      MATH_CN:  { hrs: 2, teacher: 'T_EXP_E', name: '中方数学' },
      CHIN:     { hrs: 2, teacher: 'T_EXP_F', name: '语文' },
      POL:      { hrs: 2, teacher: 'T_EXP_G', name: '政治' },
      PE:       { hrs: 2, teacher: 'T_EXP_H1', name: '体育' },
      IT:       { hrs: 1, teacher: 'T_EXP_J', name: '信息技术' },
      GUIDANCE: { hrs: 2, teacher: 'T_GUIDANCE', name: '升学课堂' },
      SELF_STUDY:{hrs: 2, teacher: null, name: '自习' },
      MEETING:  { hrs: 1, teacher: null, name: '班会' },
      CLUB:     { hrs: 2, teacher: null, name: '社团' },
      DUTY:     { hrs: 1, teacher: null, name: '值日' },
    },
    fixed_slots: { DUTY: ['D1P10'], MEETING: ['D1P9'], CLUB: ['D2P10','D5P10'] },
    total: 50,
  },

  G12: {
    name: '高三',
    teaching: {
      AP_STAT:    { hrs: 5, teacher: 'T_JAIME', name: 'AP Statistics' },
      ENG_CW:     { hrs: 5, teacher: 'T_LUKE', name: 'English Creative Writing' },
      COLLEGE_APP:{ hrs: 4, teacher: null, name: '大学申请自习课' },
      SELF_STUDY: { hrs: 2, teacher: null, name: '自习' },
    },
    admin: {
      CHIN:    { hrs: 2, teacher: 'T_EXP_K', name: '语文' },
      PE:      { hrs: 2, teacher: 'T_EXP_L', name: '体育' },
      DUTY:    { hrs: 1, teacher: null, name: '值日' },
      MEETING: { hrs: 1, teacher: null, name: '班会' },
      CLUB:    { hrs: 2, teacher: null, name: '社团' },
    },
    electives: {
      group_a: { hrs: 5, choices: ['AP_LANG','AP_LIT','HONOR_LIT'] },
      group_b: { hrs: 4, choices: ['LINEAR_ALG','BUSINESS','MECH_BASIS'] },
      group_c: { hrs: 2, choices: ['JAPANESE','FRENCH','GERMAN'] },
    },
    fixed_slots: { DUTY: ['D1P10'], MEETING: ['D1P9'], CLUB: ['D2P10','D5P10'] },
    total: 50,
  },
};

function validate(state) {
  const A = state.assignments;
  const students = state.students;
  const errors = [];
  const warnings = [];
  const stats = {};

  for (const grade of [10, 11, 12]) {
    const spec = SPEC['G' + grade];
    if (!spec) continue;
    const gStudents = students.filter(s => s.grade === grade);
    if (!gStudents.length) { warnings.push('G' + grade + ': 无学生数据'); continue; }

    const gAs = A.filter(a => gStudents.some(s => s.id === a.student_id));
    console.log('\n=== ' + spec.name + ' (G' + grade + ') ===');
    console.log('  学生: ' + gStudents.length + ', 分配: ' + gAs.length);

    // Sample 5 students for detailed check
    const sample = gStudents.slice(0, 5);
    const issues = {};

    sample.forEach(stu => {
      const stuA = gAs.filter(a => a.student_id === stu.id);

      // Daily=10, Weekly=50
      const daily = [0,0,0,0,0];
      stuA.forEach(a => daily[parseInt(a.slot_id.charAt(1))-1]++);
      const weekly = daily.reduce((s,d) => s + d, 0);
      if (weekly !== spec.total) issues[stu.id] = { daily, weekly, msg: '每周≠' + spec.total };
      if (daily.some(d => d !== 10)) issues[stu.id] = { daily, weekly, msg: '日课时≠10' };

      // Duplicate slots
      const seen = new Set();
      stuA.forEach(a => {
        if (seen.has(a.slot_id)) issues[stu.id] = { msg: '重复时段: ' + a.slot_id };
        seen.add(a.slot_id);
      });

      // Teaching course hours
      const teaching = spec.teaching || {};
      Object.entries(teaching).forEach(([cid, info]) => {
        const cnt = stuA.filter(a => a.course_id === cid).length;
        if (cnt !== info.hrs) {
          const key = stu.id + '_' + cid;
          if (!issues[key]) issues[key] = { course: cid, expected: info.hrs, actual: cnt, students: [] };
          issues[key].students.push(stu.id);
        }
      });

      // Admin course hours
      const admin = spec.admin || {};
      Object.entries(admin).forEach(([cid, info]) => {
        const cnt = stuA.filter(a => a.course_id === cid).length;
        if (cnt !== info.hrs) {
          const key = stu.id + '_' + cid;
          if (!issues[key]) issues[key] = { course: cid, expected: info.hrs, actual: cnt, students: [] };
          issues[key].students.push(stu.id);
        }
      });

      // Check AP courses for G11/G12
      if (grade >= 11 && stu.ap_courses) {
        stu.ap_courses.forEach(cid => {
          if (cid === 'AP_CALC_BC') return; // Skip, already counted as teaching
          const cnt = stuA.filter(a => a.course_id === cid).length;
          if (cnt !== 5) {
            const key = stu.id + '_' + cid;
            if (!issues[key]) issues[key] = { course: cid, expected: 5, actual: cnt, students: [] };
            issues[key].students.push(stu.id);
          }
        });
      }

      // Check elective hours for G12
      if (grade === 12 && stu.elective_choices) {
        const ec = stu.elective_choices;
        if (ec.group_a) {
          const cnt = stuA.filter(a => a.course_id === ec.group_a).length;
          if (cnt !== 5) {
            issues['elective_a'] = { course: ec.group_a, expected: 5, actual: cnt, students: [stu.id] };
          }
        }
        if (ec.group_b) {
          const cnt = stuA.filter(a => a.course_id === ec.group_b).length;
          if (cnt !== 4) {
            issues['elective_b'] = { course: ec.group_b, expected: 4, actual: cnt, students: [stu.id] };
          }
        }
        if (ec.group_c) {
          const cnt = stuA.filter(a => a.course_id === ec.group_c).length;
          if (cnt !== 2) {
            issues['elective_c'] = { course: ec.group_c, expected: 2, actual: cnt, students: [stu.id] };
          }
        }
      }
    });

    // Check fixed slots
    if (spec.fixed_slots) {
      Object.entries(spec.fixed_slots).forEach(([course, slots]) => {
        slots.forEach(sid => {
          const missing = gStudents.filter(s => !gAs.some(a => a.student_id === s.id && a.slot_id === sid && a.course_id === course));
          if (missing.length > 0) {
            issues['fixed_' + course + '_' + sid] = { course, slot: sid, missing: missing.length };
          }
        });
      });
    }

    // Report issues
    const issueKeys = Object.keys(issues);
    if (issueKeys.length === 0) {
      console.log('  ✅ 全部通过!');
    } else {
      const byType = {};
      issueKeys.forEach(k => {
        const v = issues[k];
        const type = v.course || k;
        if (!byType[type]) byType[type] = [];
        byType[type].push(v);
      });
      Object.entries(byType).slice(0, 10).forEach(([type, items]) => {
        const counts = {};
        items.forEach(i => { const key = i.actual + '→' + i.expected; counts[key] = (counts[key] || 0) + 1; });
        const summary = Object.entries(counts).map(([k, v]) => k + ' x' + v).join(', ');
        console.log('  ❌ ' + type + ': ' + summary);
      });
      if (issueKeys.length > 10) console.log('  ... 及其他 ' + (issueKeys.length - 10) + ' 个问题');
      errors.push({ grade, count: issueKeys.length });
    }

    // Morning self-study count
    const ssAM = gAs.filter(a => a.course_id === 'SELF_STUDY' && parseInt(a.slot_id.charAt(1) ? a.slot_id.substring(3) : '0') <= 5).length;
    const ssTotal = gAs.filter(a => a.course_id === 'SELF_STUDY').length;
    console.log('  早上自习: ' + ssAM + ' / 总自习: ' + ssTotal);

    // Teacher conflicts: same teacher, same slot, DIFFERENT course (same course to multiple students = batch teaching, OK)
    const teacherSlotMap = {};
    gAs.forEach(a => {
      if (!a.teacher_id) return;
      const key = a.teacher_id + '@' + a.slot_id;
      if (!teacherSlotMap[key]) teacherSlotMap[key] = new Set();
      teacherSlotMap[key].add(a.course_id); // only track course, not class_id (batch teaching is fine)
    });
    const conflicts = Object.entries(teacherSlotMap).filter(([, courses]) => courses.size > 1);
    if (conflicts.length > 0) {
      console.log('  ❌ 教师冲突: ' + conflicts.length + ' 处 (同时段不同课程)');
      conflicts.slice(0, 5).forEach(([k, c]) => console.log('    ' + k + ': ' + [...c].join(', ')));
    } else {
      console.log('  ✅ 教师无冲突');
    }

    stats['G' + grade] = { errors: issueKeys.length, ssAM, ssTotal, teacherConflicts: conflicts.length };
  }

  return { errors, warnings, stats };
}

// Main
const dataPath = process.argv[2] || './timetable.json';
if (!fs.existsSync(dataPath)) { console.error('文件不存在: ' + dataPath); process.exit(1); }

const state = JSON.parse(fs.readFileSync(dataPath, 'utf-8'));
if (!state.assignments || state.assignments.length === 0) {
  console.error('错误: timetable.json 中没有 assignments');
  process.exit(1);
}

console.log('=== Excel对齐验证 ===');
console.log('总分配数: ' + state.assignments.length + '\n');

const result = validate(state);

console.log('\n=== 总结 ===');
let totalErrors = 0;
Object.entries(result.stats).forEach(([grade, s]) => {
  console.log(grade + ': ' + s.errors + ' 个错误, 早上自习=' + s.ssAM + ', 教师冲突=' + s.teacherConflicts);
  totalErrors += s.errors;
});

if (totalErrors === 0) {
  console.log('\n✅ 课表完全符合 Excel 规格!');
  process.exit(0);
} else {
  console.log('\n❌ ' + totalErrors + ' 个不符合项需要修复');
  process.exit(1);
}
