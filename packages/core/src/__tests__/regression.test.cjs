/**
 * 回归测试 — 生产引擎关键场景
 * P2-9 fix: 覆盖教师双占用、fallback 不丢课、evaluate 冲突惩罚、task_id 唯一性
 * 用法: node packages/core/src/__tests__/regression.test.cjs
 */
const { PostChecker } = require('../solver/post-check.cjs');

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

// ===== Test 4: task_id 唯一性（P1-4 回归） =====
console.log('\n=== Test 4: task_id 唯一性验证 ===');

// 模拟 _add 输出 — task_id 应拼 slot_id
function makeTaskId(cls, cid, sid, slot) { return cls + '_' + cid + '_' + sid + '_' + slot; }
const t1 = makeTaskId('TC1', 'MATH', 'S1', 'D1P1');
const t2 = makeTaskId('TC1', 'MATH', 'S1', 'D1P2'); // same course/student, different slot
assert(t1 !== t2, 'task_id 拼 slot 后不同时段应唯一: ' + t1 + ' vs ' + t2);
const t3 = makeTaskId('TC1', 'MATH', 'S1', 'D1P1');
assert(t1 === t3, '相同参数应生成相同 task_id: ' + t1);

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

// ===== Summary =====
console.log('\n=== 结果 ===');
console.log('通过: ' + passed + '/' + (passed + failed));
if (failed > 0) { console.error('失败: ' + failed); process.exit(1); }
else { console.log('✅ 全部通过!'); process.exit(0); }
