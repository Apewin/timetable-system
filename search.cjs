/**
 * 搜索层 v2 - 模拟退火
 */
const fs = require('fs');
const { SchedulingEngine } = require('./packages/core/src/engine.cjs');

const RULES = __dirname + '/rules.json';
const DATA = __dirname + '/timetable.json';
const OUT = __dirname + '/timetable.json';
const ITERATIONS = parseInt(process.argv[2]) || 5000;

const engine = new SchedulingEngine(RULES, DATA);
console.log(`=== 模拟退火排课 ===`);
console.log(`退火迭代: ${ITERATIONS} | 规则: ${engine.rules.rules.length} 条`);

// Generate initial
console.log('生成初始解...');
const initial = engine.generateInitial();
const initScore = engine.evaluate(initial);
console.log(`初始分: ${initScore}`);

// Anneal
console.log(`退火优化中...`);
const result = engine.anneal(initial, ITERATIONS);
console.log(`最终分: ${result.score} (改善 ${initScore - result.score})`);

// Save
const data = JSON.parse(fs.readFileSync(DATA, 'utf-8'));
data.assignments = result.assignments;
fs.writeFileSync(OUT, JSON.stringify(data, null, 2));

// Quick check
const g = data.students.filter(s => s.grade === 10);
const tc1s = g.filter(s => s.teaching_class_id === 'TC_G10_1')[0];
const daily = [0, 0, 0, 0, 0];
result.assignments.filter(a => a.student_id === tc1s.id).forEach(a => daily[a.slot_id.charAt(1) - 1]++);
const exp = { MATH_PRECAL: 6, AP_PHYS1: 5, CHEM_PRE: 5, BIO_PRE: 5, ENG_LS: 3, ENG_RW: 3, ENG_LIT: 4, ENG_SURVEY: 2, PE: 2 };
const errs = Object.entries(exp).filter(([cid, hrs]) => result.assignments.filter(a => a.student_id === tc1s.id && a.course_id === cid).length !== hrs);
console.log(`课时: daily=${daily.join(',')} errors=${errs.length}`);
console.log(`Done! ${result.assignments.length} assignments`);
