/**
 * 回归测试 — 生产引擎关键场景
 * P2-9 fix: 覆盖教师双占用、fallback 不丢课、evaluate 冲突惩罚、task_id 唯一性
 * 用法: node packages/core/src/__tests__/regression.test.cjs
 */
const { PostChecker } = require('../solver/post-check.cjs');
const { makeTaskId } = require('../constants.cjs');
const { buildSections, solveSectionTimetable, assignStudentsToSections } = require('../solver/section-cpsat-engine.cjs');

let passed = 0, failed = 0;

function assert(cond, msg) {
  if (cond) { passed++; } else { failed++; console.error('  FAIL: ' + msg); }
}

function makeState(assignments, students) {
  return {
    version: '1.0',
    meta: { school: 'test', created_at: '', updated_at: '' },
    config: { time_model: { days: 5, periods_per_day: 10, lunch_break_after_period: 5 }, walk_blocks: [] },
    teachers: [],
    rooms: [],
    courses: [],
    students: students || [],
    admin_classes: [],
    teaching_classes: [],
    teaching_assignments: [],
    ap_selections: [],
    ap_sections: [],
    teaching_tasks: [],
    constraints: [],
    assignments: assignments || [],
    locks: [],
  };
}

function makeStudent(id, grade, ap_courses, elective_choices) {
  return { id, name: 'Test ' + id, grade, admin_class_id: 'AC' + grade, teaching_class_id: 'TC_G' + grade + '_1', ap_courses, elective_choices };
}

function makeAssign(task_id, slot_id, course_id, student_id, teacher_id, class_type) {
  return { task_id, slot_id, room_id: 'R1', course_id, class_id: 'C1', class_type: class_type || 'teaching', teacher_id: teacher_id || null, student_id };
}

// ===== Test 1: PostChecker 检测教师双占用 =====
console.log('\n=== Test 1: PostChecker 教师冲突检测 ===');

const s1 = makeStudent('S1', 10, [], {});
const s2 = makeStudent('S2', 10, [], {});
const a1 = makeAssign('T1_MATH_S1_D1P1', 'D1P1', 'MATH', 'S1', 'T_TEST', 'teaching');
const a2 = makeAssign('T2_ENG_S2_D1P1', 'D1P1', 'ENG', 'S2', 'T_TEST', 'teaching'); // same teacher, same slot!

const state1 = makeState([a1, a2], [s1, s2]);
// Override _getSpecs for this test — add test courses
const origGetSpecs = PostChecker._getSpecs;
PostChecker._getSpecs = () => ({
  G10: { courses: { MATH: 1, ENG: 1 } },
  G11: {},
  G12: {},
});

const r1 = PostChecker.check(state1);
assert(r1.stats.teacherConflicts === 1, '应检测到 1 个教师冲突');
assert(r1.pass === false, '有冲突时应 pass=false');
assert(r1.violations.some(v => v.includes('T_TEST')), 'violation 应包含教师 ID');
PostChecker._getSpecs = origGetSpecs;

// ===== Test 2: PostChecker 检测日分布违规 =====
console.log('\n=== Test 2: PostChecker 日分布违规 ===');

const a3 = makeAssign('T3_AP_D1P1', 'D1P1', 'AP_PHYS1', 'S1', 'T_PHYS', 'teaching');
const a4 = makeAssign('T4_AP_D1P2', 'D1P2', 'AP_PHYS1', 'S1', 'T_PHYS', 'teaching'); // same course, same day, ≤5hr → 违规
const state2 = makeState([a3, a4], [s1]);
PostChecker._getSpecs = () => ({
  G10: { courses: { AP_PHYS1: 2 } },
  G11: {},
  G12: {},
});
const r2 = PostChecker.check(state2);
assert(r2.stats.distributionViolations >= 1, '≤5hr 课程同日2节应为分布违规');
PostChecker._getSpecs = origGetSpecs;

// ===== Test 3: PostChecker 无教师冲突和分布冲突时正确 =====
console.log('\n=== Test 3: PostChecker 无教师/分布冲突场景 ===');

const a5 = makeAssign('T5_MATH_D1P1', 'D1P1', 'MATH', 'S1', 'T_MATH', 'teaching');
const state3 = makeState([a5], [s1]);
PostChecker._getSpecs = () => ({
  G10: { courses: { MATH: 1 } },
  G11: {},
  G12: {},
});
const r3 = PostChecker.check(state3);
assert(r3.stats.teacherConflicts === 0, '单教师不应有冲突');
assert(r3.stats.distributionViolations === 0, '单课时不应有分布违规');
assert(r3.stats.duplicateViolations === 0, '不应有重复时段');
PostChecker._getSpecs = origGetSpecs;

// ===== Test 4: task_id 唯一性（P1-4 回归，Follow-up #4: 共用 constants.cjs 实现）=====
console.log('\n=== Test 4: task_id 唯一性验证（共用 constants.cjs makeTaskId）===');

const t1 = makeTaskId('TC1', 'MATH', 'S1', 'D1P1');
const t2 = makeTaskId('TC1', 'MATH', 'S1', 'D1P2'); // same course/student, different slot
assert(t1 !== t2, 'task_id 拼 slot 后不同时段应唯一: ' + t1 + ' vs ' + t2);
const t3 = makeTaskId('TC1', 'MATH', 'S1', 'D1P1');
assert(t1 === t3, '相同参数应生成相同 task_id: ' + t1);
assert(typeof makeTaskId('X', 'Y', 'Z', 'W') === 'string', 'makeTaskId 应返回字符串');

// ===== Test 5: 空堂检测 =====
console.log('\n=== Test 5: 空堂检测 ===');

const state5 = makeState([], [s1]); // no assignments, 50 empty slots
PostChecker._getSpecs = () => ({ G10: { courses: {} }, G11: {}, G12: {} });
const r5 = PostChecker.check(state5);
assert(r5.stats.emptySlotViolations >= 5, '无 assignment 应检测到空堂（每天10空位）');
PostChecker._getSpecs = origGetSpecs;

// ===== Test 6: 重复时段检测 =====
console.log('\n=== Test 6: 重复时段检测 ===');

const a6a = makeAssign('T6_MATH_D1P1', 'D1P1', 'MATH', 'S1', 'T_MATH', 'teaching');
const a6b = makeAssign('T7_PHYS_D1P1', 'D1P1', 'PHYS', 'S1', 'T_PHYS', 'teaching'); // same student, same slot
const state6 = makeState([a6a, a6b], [s1]);
PostChecker._getSpecs = () => ({ G10: { courses: { MATH: 2, PHYS: 2 } }, G11: {}, G12: {} });
const r6 = PostChecker.check(state6);
assert(r6.stats.duplicateViolations >= 1, '同学生同时段应检测到重复');
PostChecker._getSpecs = origGetSpecs;

// ===== Test 7: 跨年级 AP 选课必须形成共同 section =====
console.log('\n=== Test 7: 跨年级 AP section 构建 ===');

const sectionState = makeState([], [
  makeStudent('S11_A', 11, ['AP_BIO'], {}),
  makeStudent('S12_A', 12, ['AP_BIO'], {}),
]);
sectionState.courses = [{ id: 'AP_BIO', type: 'ap', weekly_hours: 5, section_count: 1 }];
sectionState.teachers = [{ id: 'T_BIO', can_teach: ['AP_BIO'] }];
sectionState.rooms = [{ id: 'R_BIO', type: 'biology', capacity: 30 }];

const crossGradeSections = buildSections(sectionState).filter(s => s.course_id === 'AP_BIO');
assert(crossGradeSections.length === 1, '同一容量内的跨年级 AP 学生应进入同一个 section');
assert(crossGradeSections[0].student_ids.length === 2, 'section 应包含 G11 与 G12 两名学生');
assert(crossGradeSections[0].student_ids.includes('S11_A') && crossGradeSections[0].student_ids.includes('S12_A'), 'section 不应按年级拆分');
assert(crossGradeSections[0].teacher_id === 'T_BIO', 'section 应分配可教授该课程的教师');

// ===== Test 8: 行政班与教学班均应成为 section 成员关系 =====
console.log('\n=== Test 8: 行政班与教学班 section 构建 ===');

const membershipState = makeState([], [makeStudent('S_MEMBER', 11, [], {})]);
membershipState.admin_classes = [{ id: 'AC11', student_ids: ['S_MEMBER'], fixed_room_id: 'R1' }];
membershipState.teaching_classes = [{ id: 'TC11', student_ids: ['S_MEMBER'], fixed_room_id: 'R2' }];
membershipState.courses = [
  { id: 'ADMIN_COURSE', type: 'required', weekly_hours: 1 },
  { id: 'TEACH_COURSE', type: 'required', weekly_hours: 1 },
];
membershipState.teachers = [{ id: 'T_ADMIN', can_teach: ['ADMIN_COURSE'] }, { id: 'T_TEACH', can_teach: ['TEACH_COURSE'] }];
membershipState.rooms = [{ id: 'R1', type: 'general', capacity: 30 }, { id: 'R2', type: 'general', capacity: 30 }];
membershipState.teaching_assignments = [
  { id: 'TA_ADMIN', teacher_id: 'T_ADMIN', course_id: 'ADMIN_COURSE', class_ids: ['AC11'], class_type: 'admin', weekly_hours: 1 },
  { id: 'TA_TEACH', teacher_id: 'T_TEACH', course_id: 'TEACH_COURSE', class_ids: ['TC11'], class_type: 'teaching', weekly_hours: 1 },
];
const membershipSections = buildSections(membershipState);
assert(membershipSections.some(section => section.class_type === 'admin' && section.student_ids.includes('S_MEMBER')), '行政班课程应生成 section');
assert(membershipSections.some(section => section.class_type === 'teaching' && section.student_ids.includes('S_MEMBER')), '教学班课程应生成 section');

// ===== Test 9: 教学班应在共享固定教室过载时自动换教室 =====
console.log('\n=== Test 9: 教学班教室负载均衡 ===');

const roomState = makeState([], [
  { ...makeStudent('S_R1', 11, [], {}), teaching_class_id: 'TC_R1' },
  { ...makeStudent('S_R2', 11, [], {}), teaching_class_id: 'TC_R2' },
]);
roomState.teaching_classes = [
  { id: 'TC_R1', student_ids: ['S_R1'], fixed_room_id: 'R1' },
  { id: 'TC_R2', student_ids: ['S_R2'], fixed_room_id: 'R1' },
];
roomState.courses = [{ id: 'ROOM_TEST', type: 'required', weekly_hours: 30 }];
roomState.teachers = [{ id: 'T_ROOM_1', can_teach: ['ROOM_TEST'] }, { id: 'T_ROOM_2', can_teach: ['ROOM_TEST'] }];
roomState.rooms = [{ id: 'R1', type: 'general', capacity: 30 }, { id: 'R2', type: 'general', capacity: 30 }];
roomState.teaching_assignments = [{ id: 'TA_ROOM', teacher_id: 'T_ROOM_1', course_id: 'ROOM_TEST', class_ids: ['TC_R1', 'TC_R2'], class_type: 'teaching', weekly_hours: 30 }];
const roomSections = buildSections(roomState).filter(section => section.course_id === 'ROOM_TEST');
assert(new Set(roomSections.map(section => section.room_id)).size === 2, '共享固定教室会超载时，教学班应自动分配不同教室');

// ===== Test 10: 班会占位班主任不得制造固定时段教师冲突 =====
console.log('\n=== Test 10: 班会班主任占位兼容 ===');

const meetingState = makeState([], [
  { ...makeStudent('S_M1', 11, [], {}), admin_class_id: 'AC_M1' },
  { ...makeStudent('S_M2', 11, [], {}), admin_class_id: 'AC_M2' },
]);
meetingState.admin_classes = [
  { id: 'AC_M1', student_ids: ['S_M1'], fixed_room_id: 'R1' },
  { id: 'AC_M2', student_ids: ['S_M2'], fixed_room_id: 'R2' },
];
meetingState.courses = [{ id: 'MEETING', type: 'other', weekly_hours: 1 }];
meetingState.teachers = [{ id: 'T_G11_HOMEROOM', can_teach: ['MEETING'], note: '高二班主任' }];
meetingState.rooms = [{ id: 'R1', type: 'general', capacity: 30 }, { id: 'R2', type: 'general', capacity: 30 }];
meetingState.teaching_assignments = [{ id: 'TA_MEETING', teacher_id: 'T_G11_HOMEROOM', course_id: 'MEETING', class_ids: ['AC_M1', 'AC_M2'], class_type: 'admin', weekly_hours: 1 }];
const meetingSections = buildSections(meetingState);
assert(meetingSections.every(section => section.teacher_id === null), '跨多个行政班的班会占位教师应标记为待补充，而非制造假冲突');

// ===== Test 11: section 求解器协调共享教师并展开个人课表 =====
console.log('\n=== Test 11: section 求解器教师协调与个人课表展开 ===');

const solverState = makeState([], [
  makeStudent('S_A', 11, ['AP_A'], {}),
  makeStudent('S_B', 12, ['AP_B'], {}),
]);
solverState.courses = [
  { id: 'AP_A', type: 'ap', weekly_hours: 5, section_count: 1 },
  { id: 'AP_B', type: 'ap', weekly_hours: 5, section_count: 1 },
];
solverState.teachers = [{ id: 'T_SHARED', can_teach: ['AP_A', 'AP_B'] }];
solverState.rooms = [{ id: 'R1', type: 'general', capacity: 30 }, { id: 'R2', type: 'general', capacity: 30 }];

(async () => {
  const solved = await solveSectionTimetable(solverState, { maxTimeSeconds: 5 });
  assert(solved.ok, 'section 求解器应找到可行解');
  assert(solved.assignments.length === 10, '两名学生各 5 节 AP 应展开为 10 条个人课表记录');
  const teacherSlots = solved.assignments
    .filter(a => a.teacher_id === 'T_SHARED')
    .reduce((map, a) => {
      const sections = map.get(a.slot_id) || new Set();
      sections.add(a.class_id);
      map.set(a.slot_id, sections);
      return map;
    }, new Map());
  assert([...teacherSlots.values()].every(sections => sections.size === 1), '同一教师同一时段只能教授一个 section');
  assert(solved.assignments.filter(a => a.student_id === 'S_A').length === 5, '学生 A 应有完整的个人选修课表');
  assert(solved.assignments.filter(a => a.student_id === 'S_B').length === 5, '学生 B 应有完整的个人选修课表');

  // ===== Test 10: 固定课冲突必须被模型判为无解 =====
  console.log('\n=== Test 10: 固定课时约束 ===');
  const fixedState = makeState([], [makeStudent('S_FIXED', 11, [], {})]);
  const fixedResult = await solveSectionTimetable(fixedState, {
    maxTimeSeconds: 5,
    sections: [
      { id: 'SEC_MEETING', course_id: 'MEETING', teacher_id: null, student_ids: ['S_FIXED'], weekly_hours: 1, room_id: 'R1', class_type: 'admin', fixed_slots: ['D1P9'] },
      { id: 'SEC_DUTY', course_id: 'DUTY', teacher_id: null, student_ids: ['S_FIXED'], weekly_hours: 1, room_id: 'R1', class_type: 'admin', fixed_slots: ['D1P9'] },
    ],
  });
  assert(fixedResult.ok === false, '同一学生的两门固定课占同一时段时必须无解');

  // ===== Test 11: 六课时课程同日双课必须连堂 =====
  console.log('\n=== Test 11: 连堂分布约束 ===');
  const doublePeriodResult = await solveSectionTimetable(fixedState, {
    maxTimeSeconds: 5,
    sections: [{
      id: 'SEC_SIX_HOURS', course_id: 'MATH', teacher_id: 'T_MATH', student_ids: ['S_FIXED'], weekly_hours: 6,
      room_id: 'R1', class_type: 'teaching', fixed_slots: ['D1P1', 'D1P3', 'D2P1', 'D3P1', 'D4P1', 'D5P1'],
    }],
  });
  assert(doublePeriodResult.ok === false, '六课时课程同日两节不连堂时必须无解');

  // ===== Test 12: 既定双班的学生归属必须避开个人冲突 =====
  console.log('\n=== Test 12: 多 section 学生分班归属 ===');
  const allocationState = makeState([], [
    makeStudent('S_ALLOC_1', 11, ['AP_ALLOC'], {}),
    makeStudent('S_ALLOC_2', 12, ['AP_ALLOC'], {}),
  ]);
  const allocation = await assignStudentsToSections(allocationState, [
    { id: 'REQ', course_id: 'REQUIRED', class_type: 'teaching', student_ids: ['S_ALLOC_1'], weekly_hours: 1 },
    { id: 'AP_ALLOC_1', course_id: 'AP_ALLOC', class_type: 'ap', student_ids: [], eligible_student_ids: ['S_ALLOC_1', 'S_ALLOC_2'], weekly_hours: 1, capacity: 1 },
    { id: 'AP_ALLOC_2', course_id: 'AP_ALLOC', class_type: 'ap', student_ids: [], eligible_student_ids: ['S_ALLOC_1', 'S_ALLOC_2'], weekly_hours: 1, capacity: 1 },
  ], [
    { section_id: 'REQ', slot_id: 'D1P1' },
    { section_id: 'AP_ALLOC_1', slot_id: 'D1P1' },
    { section_id: 'AP_ALLOC_2', slot_id: 'D1P2' },
  ]);
  assert(allocation.ok, '分班归属应存在可行解');
  const allocatedFirst = allocation.sections.find(section => section.id === 'AP_ALLOC_1');
  const allocatedSecond = allocation.sections.find(section => section.id === 'AP_ALLOC_2');
  assert(allocatedFirst.student_ids.includes('S_ALLOC_2'), '与必修课冲突的学生不得被分入冲突 section');
  assert(allocatedSecond.student_ids.includes('S_ALLOC_1'), '学生应被分入不冲突的既定 section');

  // ===== Summary =====
  console.log('\n=== 结果 ===');
  console.log('通过: ' + passed + '/' + (passed + failed));
  if (failed > 0) { console.error('失败: ' + failed); process.exit(1); }
  else { console.log('✅ 全部通过!'); process.exit(0); }
})().catch(error => { console.error(error.stack); process.exit(1); });
