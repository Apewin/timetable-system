/**
 * 高二排课搜索
 */
const fs = require('fs');
const { G11Engine } = require('./packages/core/src/g11-engine.cjs');

const engine = new G11Engine(__dirname + '/rules.json', __dirname + '/timetable.json');
const ITER = parseInt(process.argv[2]) || 5000;

console.log(`=== 高二模拟退火 ===`);
console.log(`迭代: ${ITER} | 学生: ${engine.students.length}人`);

const initial = engine.generateInitial();
console.log(`初始分: ${engine.evaluate(initial)}`);
const result = engine.anneal(initial, ITER);
console.log(`最终分: ${result.score}`);

// Save
const data = JSON.parse(fs.readFileSync(__dirname + '/timetable.json', 'utf-8'));
const g10As = (data.assignments || []).filter(a => {
  const s = data.students.find(x => x.id === a.student_id);
  return s?.grade !== 11;
});
data.assignments = [...g10As, ...result.assignments];
fs.writeFileSync(__dirname + '/timetable.json', JSON.stringify(data, null, 2));

// Verify
const g11 = data.students.filter(s => s.grade === 11);
const tcIds = ['TC_G11_1','TC_G11_2','TC_G11_3'];
tcIds.forEach(tid => {
  const stu = g11.filter(s => s.teaching_class_id === tid)[0];
  if (!stu) return;
  const daily = [0,0,0,0,0];
  result.assignments.filter(a => a.student_id === stu.id).forEach(a => daily[a.slot_id.charAt(1)-1]++);
  const total = daily.reduce((a,b)=>a+b,0);
  const tcType = tid === 'TC_G11_3' ? 'TC3' : 'TC1/2';
  console.log(`${tid}(${tcType}): daily=${daily.join(',')} total=${total} ${total===50?'✅':'❌'}`);

  // Check key courses
  const engComp = result.assignments.filter(a => a.student_id === stu.id && a.course_id === 'ENG_COMP').length;
  const apCalc = result.assignments.filter(a => a.student_id === stu.id && a.course_id === 'AP_CALC_BC').length;
  const apTotal = (stu.ap_courses || []).reduce((s, cid) => s + result.assignments.filter(a => a.student_id === stu.id && a.course_id === cid).length, 0);
  console.log(`  ENG_COMP=${engComp}/4 AP_CALC=${apCalc}/5 AP选=${apTotal}/15`);
});
console.log(`Done! ${result.assignments.length} assignments`);
