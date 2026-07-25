/**
 * 数据校验命令
 */
import { defineCommand } from "citty";
import chalk from "chalk";
import { readState, projectExists } from "@timetable/core";
import type { TimetableState } from "@timetable/core";

function jsonOutput(data: unknown, ok = true, errors: unknown[] = []) {
  console.log(JSON.stringify({ ok, data, errors, warnings: [] }, null, 2));
}

// 检查引用完整性
function checkReferences(state: TimetableState) {
  const errors: Array<{ code: string; msg: string; refs?: string[] }> = [];

  // 检查教师引用的课程是否存在
  state.teachers.forEach(t => {
    t.can_teach.forEach(courseId => {
      if (!state.courses.find(c => c.id === courseId)) {
        errors.push({ code: "MISSING_REF", msg: `教师 ${t.id} 引用的课程 ${courseId} 不存在`, refs: [t.id, courseId] });
      }
    });
    if (t.homeroom_class_id && !state.admin_classes.find(c => c.id === t.homeroom_class_id)) {
      errors.push({ code: "MISSING_REF", msg: `教师 ${t.id} 引用的行政班 ${t.homeroom_class_id} 不存在`, refs: [t.id, t.homeroom_class_id] });
    }
  });

  // 检查教室引用的班级是否存在
  state.rooms.forEach(r => {
    if (r.owner_class_id) {
      const adminClass = state.admin_classes.find(c => c.id === r.owner_class_id);
      const teachingClass = state.teaching_classes.find(c => c.id === r.owner_class_id);
      if (!adminClass && !teachingClass) {
        errors.push({ code: "MISSING_REF", msg: `教室 ${r.id} 引用的班级 ${r.owner_class_id} 不存在`, refs: [r.id, r.owner_class_id] });
      }
    }
  });

  // 检查学生引用的班级是否存在
  state.students.forEach(s => {
    if (!state.admin_classes.find(c => c.id === s.admin_class_id)) {
      errors.push({ code: "MISSING_REF", msg: `学生 ${s.id} 引用的行政班 ${s.admin_class_id} 不存在`, refs: [s.id, s.admin_class_id] });
    }
    if (!state.teaching_classes.find(c => c.id === s.teaching_class_id)) {
      errors.push({ code: "MISSING_REF", msg: `学生 ${s.id} 引用的教学班 ${s.teaching_class_id} 不存在`, refs: [s.id, s.teaching_class_id] });
    }
  });

  // 检查班级引用的教室是否存在
  state.admin_classes.forEach(c => {
    if (!state.rooms.find(r => r.id === c.fixed_room_id)) {
      errors.push({ code: "MISSING_REF", msg: `行政班 ${c.id} 引用的教室 ${c.fixed_room_id} 不存在`, refs: [c.id, c.fixed_room_id] });
    }
  });
  state.teaching_classes.forEach(c => {
    if (!state.rooms.find(r => r.id === c.fixed_room_id)) {
      errors.push({ code: "MISSING_REF", msg: `教学班 ${c.id} 引用的教室 ${c.fixed_room_id} 不存在`, refs: [c.id, c.fixed_room_id] });
    }
  });

  // 检查教师分工引用
  state.teaching_assignments.forEach(a => {
    if (!state.teachers.find(t => t.id === a.teacher_id)) {
      errors.push({ code: "MISSING_REF", msg: `分工 ${a.id} 引用的教师 ${a.teacher_id} 不存在`, refs: [a.id, a.teacher_id] });
    }
    if (!state.courses.find(c => c.id === a.course_id)) {
      errors.push({ code: "MISSING_REF", msg: `分工 ${a.id} 引用的课程 ${a.course_id} 不存在`, refs: [a.id, a.course_id] });
    }
    const adminClass = state.admin_classes.find(c => c.id === a.class_id);
    const teachingClass = state.teaching_classes.find(c => c.id === a.class_id);
    if (!adminClass && !teachingClass) {
      errors.push({ code: "MISSING_REF", msg: `分工 ${a.id} 引用的班级 ${a.class_id} 不存在`, refs: [a.id, a.class_id] });
    }
  });

  // 检查AP选课引用
  state.ap_selections.forEach(s => {
    if (!state.students.find(st => st.id === s.student_id)) {
      errors.push({ code: "MISSING_REF", msg: `选课引用的学生 ${s.student_id} 不存在`, refs: [s.student_id] });
    }
    s.course_ids.forEach(courseId => {
      if (!state.courses.find(c => c.id === courseId)) {
        errors.push({ code: "MISSING_REF", msg: `选课引用的课程 ${courseId} 不存在`, refs: [s.student_id, courseId] });
      }
    });
  });

  return errors;
}

// 检查容量问题
function checkCapacity(state: TimetableState) {
  const issues: Array<{ code: string; msg: string; refs?: string[] }> = [];

  // 检查行政班学生数是否超过教室容量
  state.admin_classes.forEach(c => {
    const room = state.rooms.find(r => r.id === c.fixed_room_id);
    if (room && c.student_ids.length > room.capacity) {
      issues.push({ code: "CAPACITY_EXCEEDED", msg: `行政班 ${c.id} 学生数(${c.student_ids.length})超过教室 ${room.id} 容量(${room.capacity})`, refs: [c.id, room.id] });
    }
  });

  // 检查教学班学生数是否超过教室容量
  state.teaching_classes.forEach(c => {
    const room = state.rooms.find(r => r.id === c.fixed_room_id);
    if (room && c.student_ids.length > room.capacity) {
      issues.push({ code: "CAPACITY_EXCEEDED", msg: `教学班 ${c.id} 学生数(${c.student_ids.length})超过教室 ${room.id} 容量(${room.capacity})`, refs: [c.id, room.id] });
    }
  });

  return issues;
}

// 检查教师超载
function checkTeacherOverload(state: TimetableState) {
  const overloads: Array<{ code: string; msg: string; refs?: string[] }> = [];

  // 计算每个教师的总周课时
  const teacherHours = new Map<string, number>();
  state.teaching_assignments.forEach(a => {
    const current = teacherHours.get(a.teacher_id) || 0;
    teacherHours.set(a.teacher_id, current + a.weekly_hours);
  });

  teacherHours.forEach((hours, teacherId) => {
    const teacher = state.teachers.find(t => t.id === teacherId);
    if (teacher && hours > teacher.max_per_week) {
      overloads.push({ code: "TEACHER_OVERLOAD", msg: `教师 ${teacherId} 周课时(${hours})超过上限(${teacher.max_per_week})`, refs: [teacherId] });
    }
  });

  return overloads;
}

export const validateInput = defineCommand({
  meta: { name: "validate-input", description: "校验输入数据完整性" },
  args: {
    json: { type: "boolean", description: "JSON格式输出", default: false },
  },
  run({ args }) {
    try {
      const projectPath = process.cwd();
      if (!projectExists(projectPath)) {
        if (args.json) jsonOutput(null, false, [{ code: "NO_PROJECT", msg: "项目不存在，请先运行 tt init" }]);
        else console.error(chalk.red("错误: 项目不存在，请先运行 tt init"));
        process.exit(3);
      }

      const state = readState(projectPath);
      const missingRefs = checkReferences(state);
      const capacityIssues = checkCapacity(state);
      const teacherOverloads = checkTeacherOverload(state);

      const allIssues = [...missingRefs, ...capacityIssues, ...teacherOverloads];
      const ok = allIssues.length === 0;

      if (args.json) {
        jsonOutput({
          ok,
          missing_refs: missingRefs,
          capacity_issues: capacityIssues,
          teacher_overloads: teacherOverloads,
        }, ok);
      } else {
        if (ok) {
          console.log(chalk.green("✓ 数据校验通过"));
        } else {
          console.log(chalk.red("✗ 数据校验失败"));
          if (missingRefs.length > 0) {
            console.log(chalk.yellow(`\n引用完整性问题 (${missingRefs.length}):`));
            missingRefs.forEach(e => console.log(`  - ${e.msg}`));
          }
          if (capacityIssues.length > 0) {
            console.log(chalk.yellow(`\n容量问题 (${capacityIssues.length}):`));
            capacityIssues.forEach(e => console.log(`  - ${e.msg}`));
          }
          if (teacherOverloads.length > 0) {
            console.log(chalk.yellow(`\n教师超载 (${teacherOverloads.length}):`));
            teacherOverloads.forEach(e => console.log(`  - ${e.msg}`));
          }
        }
      }

      process.exit(ok ? 0 : 2);
    } catch (error: any) {
      if (args.json) jsonOutput(null, false, [{ code: "VALIDATE_ERROR", msg: error.message }]);
      else console.error(chalk.red(`错误: ${error.message}`));
      process.exit(10);
    }
  },
});
