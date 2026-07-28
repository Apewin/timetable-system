/**
 * 全年级排课 - 先G10+G11（共用教师），再G12（引用G10/G11的教师课表）
 */
const fs = require('fs');
const R = __dirname + '/rules.json';
const D = __dirname + '/timetable.json';

// Read data once
const data = JSON.parse(fs.readFileSync(D, 'utf-8'));
const iter = parseInt(process.argv[2]) || 3000;
const grades = process.argv[3] ? [parseInt(process.argv[3])] : [10, 11, 12];

grades.forEach(grade => {
  console.log(`\n=== 排课: 高${grade === 10 ? '一' : grade === 11 ? '二' : '三'} ===`);
  let engine, prefix;
  if (grade === 10) {
    const { SchedulingEngine } = require('./packages/core/src/engine.cjs');
    engine = new SchedulingEngine(R, D);
    prefix = '';
  } else if (grade === 11) {
    const { G11Engine } = require('./packages/core/src/g11-engine.cjs');
    // Update data with existing G10 assignments (cross-grade)
    data.assignments = (data.assignments || []).filter(a => {
      const s = data.students.find(x => x.id === a.student_id);
      return s?.grade !== 11;
    });
    engine = new G11Engine(R, D);
    prefix = 'G11';
  } else {
    const { G12Engine } = require('./packages/core/src/g12-engine.cjs');
    data.assignments = (data.assignments || []).filter(a => {
      const s = data.students.find(x => x.id === a.student_id);
      return s?.grade !== 12;
    });
    engine = new G12Engine(R, D);
    prefix = 'G12';
  }

  const initial = engine.generateInitial();
  const initS = engine.evaluate(initial);
  console.log(`初始分: ${initS}`);
  const result = engine.anneal(initial, iter);
  console.log(`最终分: ${result.score} (改善 ${initS - result.score})`);

  // Merge with existing assignments
  const gStudents = data.students.filter(s => s.grade === grade);
  const gIds = new Set(gStudents.map(s => s.id));
  data.assignments = [...(data.assignments || []).filter(a => !gIds.has(a.student_id)), ...result.assignments];
  fs.writeFileSync(D, JSON.stringify(data, null, 2));

  // Quick verify
  const sample = gStudents.filter(s => s.teaching_class_id?.includes('_' + grade + '_1'))[0];
  if (sample) {
    const daily = [0, 0, 0, 0, 0];
    result.assignments.filter(a => a.student_id === sample.id).forEach(a => daily[a.slot_id.charAt(1) - 1]++);
    console.log(`${sample.teaching_class_id}: daily=${daily.join(',')} total=${daily.reduce((a, b) => a + b, 0)}`);
  }
});

console.log('\n✅ 全年级排课完成');
