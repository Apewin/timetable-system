/**
 * 课表展示命令
 */
import { defineCommand } from "citty";
import chalk from "chalk";
import Table from "cli-table3";
import { readState, projectExists } from "@timetable/core";
import type { TimetableState, Assignment, TeachingTask, SlotId } from "@timetable/core";

function jsonOutput(data: unknown, ok = true, errors: unknown[] = []) {
  console.log(JSON.stringify({ ok, data, errors, warnings: [] }, null, 2));
}

// 生成时段表头
function getSlotHeaders(): string[] {
  const headers: string[] = ["节次"];
  for (let day = 1; day <= 5; day++) {
    headers.push(`周${["一", "二", "三", "四", "五"][day - 1]}`);
  }
  return headers;
}

// 按学生生成课表
function generateStudentTimetable(state: TimetableState, studentId: string): string[][] {
  const rows: string[][] = [];
  const tasks = state.teaching_tasks || [];
  const assignments = state.assignments || [];

  // 找到学生的所有任务
  const studentTasks = tasks.filter(t => t.student_ids.includes(studentId));

  for (let period = 1; period <= 10; period++) {
    const row: string[] = [`${period}`];
    for (let day = 1; day <= 5; day++) {
      const slotId = `D${day}P${period}` as SlotId;
      const assignment = assignments.find(a =>
        a.slot_id === slotId && studentTasks.some(t => t.id === a.task_id)
      );

      if (assignment) {
        const task = tasks.find(t => t.id === assignment.task_id);
        const course = state.courses.find(c => c.id === task?.course_id);
        const teacher = state.teachers.find(t => t.id === task?.teacher_id);
        row.push(`${course?.name || "?"}\n${teacher?.name || "?"}\n${assignment.room_id}`);
      } else {
        row.push("");
      }
    }
    rows.push(row);
  }

  return rows;
}

// 按教师生成课表
function generateTeacherTimetable(state: TimetableState, teacherId: string): string[][] {
  const rows: string[][] = [];
  const tasks = state.teaching_tasks || [];
  const assignments = state.assignments || [];

  // 找到教师的所有任务
  const teacherTasks = tasks.filter(t => t.teacher_id === teacherId);

  for (let period = 1; period <= 10; period++) {
    const row: string[] = [`${period}`];
    for (let day = 1; day <= 5; day++) {
      const slotId = `D${day}P${period}` as SlotId;
      const assignment = assignments.find(a =>
        a.slot_id === slotId && teacherTasks.some(t => t.id === a.task_id)
      );

      if (assignment) {
        const task = tasks.find(t => t.id === assignment.task_id);
        const course = state.courses.find(c => c.id === task?.course_id);
        const room = state.rooms.find(r => r.id === assignment.room_id);
        row.push(`${course?.name || "?"}\n${room?.name || assignment.room_id}\n${task?.student_ids.length || 0}人`);
      } else {
        row.push("");
      }
    }
    rows.push(row);
  }

  return rows;
}

// 按班级生成课表
function generateClassTimetable(state: TimetableState, classId: string): string[][] {
  const rows: string[][] = [];
  const tasks = state.teaching_tasks || [];
  const assignments = state.assignments || [];

  // 找到班级的所有任务
  const classTasks = tasks.filter(t =>
    t.source_class_id === classId || t.student_ids.some(sId => {
      const student = state.students.find(s => s.id === sId);
      return student?.admin_class_id === classId || student?.teaching_class_id === classId;
    })
  );

  for (let period = 1; period <= 10; period++) {
    const row: string[] = [`${period}`];
    for (let day = 1; day <= 5; day++) {
      const slotId = `D${day}P${period}` as SlotId;
      const assignment = assignments.find(a =>
        a.slot_id === slotId && classTasks.some(t => t.id === a.task_id)
      );

      if (assignment) {
        const task = tasks.find(t => t.id === assignment.task_id);
        const course = state.courses.find(c => c.id === task?.course_id);
        const teacher = state.teachers.find(t => t.id === task?.teacher_id);
        row.push(`${course?.name || "?"}\n${teacher?.name || "?"}\n${assignment.room_id}`);
      } else {
        row.push("");
      }
    }
    rows.push(row);
  }

  return rows;
}

// 按教室生成课表
function generateRoomTimetable(state: TimetableState, roomId: string): string[][] {
  const rows: string[][] = [];
  const tasks = state.teaching_tasks || [];
  const assignments = state.assignments || [];

  for (let period = 1; period <= 10; period++) {
    const row: string[] = [`${period}`];
    for (let day = 1; day <= 5; day++) {
      const slotId = `D${day}P${period}` as SlotId;
      const assignment = assignments.find(a =>
        a.slot_id === slotId && a.room_id === roomId
      );

      if (assignment) {
        const task = tasks.find(t => t.id === assignment.task_id);
        const course = state.courses.find(c => c.id === task?.course_id);
        const teacher = state.teachers.find(t => t.id === task?.teacher_id);
        row.push(`${course?.name || "?"}\n${teacher?.name || "?"}\n${task?.student_ids.length || 0}人`);
      } else {
        row.push("");
      }
    }
    rows.push(row);
  }

  return rows;
}

export const show = defineCommand({
  meta: { name: "show", description: "展示课表" },
  args: {
    by: { type: "string", description: "展示维度（student/teacher/class/room）", required: true },
    id: { type: "string", description: "实体ID" },
    format: { type: "string", description: "输出格式（table/json）", default: "table" },
  },
  run({ args }) {
    try {
      const projectPath = process.cwd();
      if (!projectExists(projectPath)) {
        console.error(chalk.red("错误: 项目不存在，请先运行 tt init"));
        process.exit(3);
      }

      const state = readState(projectPath);

      if (!state.assignments || state.assignments.length === 0) {
        console.error(chalk.red("错误: 没有排课结果，请先运行 solve timetable"));
        process.exit(2);
      }

      let rows: string[][] = [];
      let title = "";

      switch (args.by) {
        case "student":
          if (!args.id) {
            // 列出所有学生
            if (args.format === "json") {
              jsonOutput(state.students.map(s => ({ id: s.id, name: s.name })));
            } else {
              console.log(chalk.bold("学生列表:"));
              state.students.forEach(s => console.log(`  ${s.id}: ${s.name}`));
              console.log("\n使用 --id <学生ID> 查看具体课表");
            }
            process.exit(0);
          }
          title = `学生 ${args.id} 的课表`;
          rows = generateStudentTimetable(state, args.id);
          break;

        case "teacher":
          if (!args.id) {
            if (args.format === "json") {
              jsonOutput(state.teachers.map(t => ({ id: t.id, name: t.name })));
            } else {
              console.log(chalk.bold("教师列表:"));
              state.teachers.forEach(t => console.log(`  ${t.id}: ${t.name}`));
              console.log("\n使用 --id <教师ID> 查看具体课表");
            }
            process.exit(0);
          }
          title = `教师 ${args.id} 的课表`;
          rows = generateTeacherTimetable(state, args.id);
          break;

        case "class":
          if (!args.id) {
            if (args.format === "json") {
              jsonOutput([
                ...state.admin_classes.map(c => ({ id: c.id, name: c.name, type: "行政班" })),
                ...state.teaching_classes.map(c => ({ id: c.id, name: c.name, type: "教学班" })),
              ]);
            } else {
              console.log(chalk.bold("班级列表:"));
              console.log("行政班:");
              state.admin_classes.forEach(c => console.log(`  ${c.id}: ${c.name}`));
              console.log("教学班:");
              state.teaching_classes.forEach(c => console.log(`  ${c.id}: ${c.name}`));
              console.log("\n使用 --id <班级ID> 查看具体课表");
            }
            process.exit(0);
          }
          title = `班级 ${args.id} 的课表`;
          rows = generateClassTimetable(state, args.id);
          break;

        case "room":
          if (!args.id) {
            if (args.format === "json") {
              jsonOutput(state.rooms.map(r => ({ id: r.id, name: r.name, type: r.type })));
            } else {
              console.log(chalk.bold("教室列表:"));
              state.rooms.forEach(r => console.log(`  ${r.id}: ${r.name} (${r.type})`));
              console.log("\n使用 --id <教室ID> 查看具体课表");
            }
            process.exit(0);
          }
          title = `教室 ${args.id} 的课表`;
          rows = generateRoomTimetable(state, args.id);
          break;

        default:
          console.error(chalk.red("错误: --by 必须是 student/teacher/class/room"));
          process.exit(2);
      }

      if (args.format === "json") {
        jsonOutput({ title, rows });
      } else {
        console.log(chalk.bold(title));
        const table = new Table({
          head: getSlotHeaders(),
          style: { head: ["cyan"] },
        });
        rows.forEach(row => table.push(row));
        console.log(table.toString());
      }

      process.exit(0);
    } catch (error: any) {
      console.error(chalk.red(`错误: ${error.message}`));
      process.exit(10);
    }
  },
});
