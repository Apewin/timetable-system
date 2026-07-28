/**
 * 排课后全量检查器 - 验证分布规则、课时、冲突、每日课时
 * 用法: const result = PostChecker.check(state);
 */
class PostChecker {
  /**
   * @param {Object} state - timetable.json 的完整状态
   * @returns {{pass: boolean, violations: string[], stats: Object}}
   */
  static check(state) {
    const A = state.assignments;
    const students = state.students;
    const violations = [];
    const stats = { studentsChecked: 0, coursesChecked: 0, distributionViolations: 0, hourViolations: 0, dailyViolations: 0, duplicateViolations: 0, teacherConflicts: 0 };

    // Per-grade course specs
    const specs = PostChecker._getSpecs();

    for (const grade of [10, 11, 12]) {
      const gStudents = students.filter(s => s.grade === grade);
      const spec = specs['G' + grade];
      if (!spec) continue;

      gStudents.forEach(stu => {
        stats.studentsChecked++;
        const stuA = A.filter(a => a.student_id === stu.id);

        // 1. Daily = 10
        const daily = [0,0,0,0,0];
        stuA.forEach(a => daily[parseInt(a.slot_id.charAt(1))-1]++);
        if (daily.some(d => d !== 10)) {
          violations.push('G'+grade+' '+stu.id+': daily=' + daily.join(',') + ' (not all 10)');
          stats.dailyViolations++;
        }

        // 2. No duplicate slots
        const seen = new Set();
        stuA.forEach(a => {
          if (seen.has(a.slot_id)) {
            violations.push('G'+grade+' '+stu.id+': duplicate slot ' + a.slot_id);
            stats.duplicateViolations++;
          }
          seen.add(a.slot_id);
        });

        // 3. Course hours match spec
        if (spec.courses) {
          const courseHours = {};
          stuA.forEach(a => { courseHours[a.course_id] = (courseHours[a.course_id]||0) + 1; });
          Object.entries(spec.courses).forEach(([cid, hrs]) => {
            stats.coursesChecked++;
            const actual = courseHours[cid] || 0;
            if (actual !== hrs) {
              violations.push('G'+grade+' '+stu.id+': ' + cid + '=' + actual + '≠' + hrs);
              stats.hourViolations++;
            }
          });
          // AP courses (per-student)
          (stu.ap_courses || []).forEach(cid => {
            const actual = courseHours[cid] || 0;
            if (actual !== 5) {
              violations.push('G'+grade+' '+stu.id+': AP ' + cid + '=' + actual + '≠5');
              stats.hourViolations++;
            }
          });
          // Electives (per-student)
          const ec = stu.elective_choices || {};
          if (ec.group_a) { const a = courseHours[ec.group_a]||0; if (a !== 5) { violations.push('G'+grade+' '+stu.id+': elective ' + ec.group_a + '=' + a + '≠5'); stats.hourViolations++; } }
          if (ec.group_b) { const a = courseHours[ec.group_b]||0; if (a !== 4) { violations.push('G'+grade+' '+stu.id+': elective ' + ec.group_b + '=' + a + '≠4'); stats.hourViolations++; } }
          if (ec.group_c) { const a = courseHours[ec.group_c]||0; if (a !== 2) { violations.push('G'+grade+' '+stu.id+': elective ' + ec.group_c + '=' + a + '≠2'); stats.hourViolations++; } }
        }

        // 4. Distribution rules
        const byCourse = {};
        stuA.forEach(a => {
          if (!byCourse[a.course_id]) byCourse[a.course_id] = {};
          const d = parseInt(a.slot_id.charAt(1));
          if (!byCourse[a.course_id][d]) byCourse[a.course_id][d] = [];
          byCourse[a.course_id][d].push(parseInt(a.slot_id.substring(3)));
        });
        Object.entries(byCourse).forEach(([cid, days]) => {
          const hrs = (stuA.filter(a => a.course_id === cid).length);
          Object.entries(days).forEach(([d, periods]) => {
            periods.sort((a,b) => a-b);
            if (periods.length >= 3) {
              violations.push('G'+grade+' '+stu.id+': ' + cid + '('+hrs+'hrs) D'+d+'='+periods.length+' sessions (max 2)');
              stats.distributionViolations++;
            } else if (periods.length === 2) {
              if (hrs <= 5) {
                violations.push('G'+grade+' '+stu.id+': ' + cid + '('+hrs+'hrs) D'+d+'=2 sessions (≤5hr max 1/day)');
                stats.distributionViolations++;
              } else if (Math.abs(periods[1] - periods[0]) !== 1) {
                violations.push('G'+grade+' '+stu.id+': ' + cid + '('+hrs+'hrs) D'+d+'=P'+periods[0]+'+P'+periods[1]+' not consecutive');
                stats.distributionViolations++;
              }
            }
          });
        });
      });
    }

    // 5. Teacher conflicts (same teacher, same slot, DIFFERENT course)
    const tMap = {};
    A.forEach(a => {
      if (!a.teacher_id) return;
      const key = a.teacher_id + '@' + a.slot_id;
      if (!tMap[key]) tMap[key] = new Set();
      tMap[key].add(a.course_id);
    });
    Object.entries(tMap).forEach(([key, courses]) => {
      if (courses.size > 1) {
        violations.push('Teacher conflict: ' + key + ' courses=' + [...courses].join(','));
        stats.teacherConflicts++;
      }
    });

    const pass = violations.length === 0;
    return { pass, violations, stats };
  }

  /** Print a formatted report */
  static report(result) {
    console.log('\n=== 排课后全量检查 ===');
    console.log('学生数: ' + result.stats.studentsChecked);
    console.log('课时检查: ' + result.stats.coursesChecked + ' 项');

    if (result.pass) {
      console.log('\n✅ 全部通过! 无任何违规');
      return;
    }

    console.log('\n❌ 发现 ' + result.violations.length + ' 个违规:');
    console.log('  分布违规: ' + result.stats.distributionViolations);
    console.log('  课时违规: ' + result.stats.hourViolations);
    console.log('  每日课时: ' + result.stats.dailyViolations);
    console.log('  重复时段: ' + result.stats.duplicateViolations);
    console.log('  教师冲突: ' + result.stats.teacherConflicts);

    // Show first 20 violations grouped by type
    const byType = {};
    result.violations.forEach(v => {
      const type = v.includes('sessions') ? '分布' : v.includes('≠') ? '课时' : v.includes('daily') ? '每日' : v.includes('duplicate') ? '重复' : '教师';
      if (!byType[type]) byType[type] = [];
      if (byType[type].length < 10) byType[type].push(v);
    });
    Object.entries(byType).forEach(([type, vs]) => {
      console.log('\n  [' + type + '] ' + vs.length + '个 (显示前10):');
      vs.forEach(v => console.log('    ' + v));
    });
  }

  static _getSpecs() {
    return {
      G10: {
        courses: {
          ENG_LS:3,ENG_RW:3,ENG_LIT:4,ENG_SURVEY:2,MATH_PRECAL:6,AP_PHYS1:5,CHEM_PRE:5,BIO_PRE:5,
          PE:2,GRAMMAR:2,CHIN:2,HIST:2,GEOG:2,ART:1,GUIDANCE:1,MEETING:1,CLUB:2,SELF_STUDY:2,
        }
      },
      G11: {
        courses: {
          DUTY:1,MEETING:1,CLUB:2,MATH_CN:2,CHIN:2,POL:2,PE:2,IT:1,GUIDANCE:2,SELF_STUDY:2,
        }
      },
      G12: {
        courses: {
          DUTY:1,MEETING:1,CLUB:2,CHIN:2,PE:2,AP_STAT:5,ENG_CW:5,COLLEGE_APP:4,SELF_STUDY:2,
        }
      }
    };
  }
}

module.exports = { PostChecker };
