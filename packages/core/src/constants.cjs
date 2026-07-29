/**
 * 排课系统共享常量
 * P2-7 fix: 集中定义 CLASS_TYPES，消除字面量散落
 */

const CLASS_TYPES = Object.freeze({
  ADMIN: 'admin',
  TEACHING: 'teaching',
  AP: 'ap',
  BATCH: 'batch',
  FILLER: 'filler',
});

const FIXED_COURSES = Object.freeze(['DUTY', 'MEETING', 'CLUB']);

const GRADE_NAMES = Object.freeze({ 10: '高一', 11: '高二', 12: '高三' });

const DAYS_PER_WEEK = 5;
const PERIODS_PER_DAY = 10;
const TOTAL_SLOTS = 50;

/**
 * Follow-up #4: 统一 task_id 生成逻辑，引擎与测试共享同一实现
 * @param {string} cls - class_id
 * @param {string} cid - course_id
 * @param {string} studentId - student.id
 * @param {string} slotId - slot_id (e.g. 'D1P3')
 * @returns {string} unique task_id
 */
function makeTaskId(cls, cid, studentId, slotId) {
  return cls + '_' + cid + '_' + studentId + '_' + slotId;
}

module.exports = { CLASS_TYPES, FIXED_COURSES, GRADE_NAMES, DAYS_PER_WEEK, PERIODS_PER_DAY, TOTAL_SLOTS, makeTaskId };
