#!/usr/bin/env node
/**
 * 排课系统 CLI
 * 基于citty实现
 */
import { defineCommand, runMain } from "citty";
import chalk from "chalk";
import { initProject, projectExists, readState, writeState } from "@timetable/core";

// 导入各实体命令
import { teacherAdd, teacherList, teacherEdit, teacherRm } from "./commands/teacher.js";
import { roomAdd, roomList, roomEdit, roomRm } from "./commands/room.js";
import { courseAdd, courseList, courseEdit, courseRm } from "./commands/course.js";
import { studentAdd, studentList, studentEdit, studentRm } from "./commands/student.js";
import { adminClassAdd, adminClassList, adminClassEdit, adminClassRm } from "./commands/admin-class.js";
import { teachingClassAdd, teachingClassList, teachingClassEdit, teachingClassRm } from "./commands/teaching-class.js";
import { teachingAssignmentAdd, teachingAssignmentList, teachingAssignmentEdit, teachingAssignmentRm } from "./commands/teaching-assignment.js";
import { apSelectionAdd, apSelectionList, apSelectionEdit, apSelectionRm } from "./commands/ap-selection.js";
import { constraintAdd, constraintList, constraintEdit, constraintRm } from "./commands/constraint.js";
import { validateInput } from "./commands/validate.js";
import { buildTasks } from "./commands/build-tasks.js";
import { solveCmd, solveSectionsCmd, solveTimetableCmd } from "./commands/solve.js";
import { show } from "./commands/show.js";
import { lock, unlock, swap } from "./commands/lock.js";
import { validate } from "./commands/validate-timetable.js";
import { exportCmd } from "./commands/export.js";

// 通用JSON输出
function jsonOutput(data: unknown, ok = true, errors: unknown[] = []) {
  console.log(JSON.stringify({ ok, data, errors, warnings: [] }, null, 2));
}

// init命令
const init = defineCommand({
  meta: {
    name: "init",
    description: "初始化排课系统项目",
  },
  args: {
    name: { type: "string", description: "学校名称", required: false },
    json: { type: "boolean", description: "JSON格式输出", default: false },
  },
  run({ args }) {
    try {
      const projectPath = process.cwd();
      if (projectExists(projectPath)) {
        if (args.json) jsonOutput(null, false, [{ code: "PROJECT_EXISTS", msg: "项目已存在" }]);
        else console.error(chalk.red("错误: 项目已存在"));
        process.exit(2);
      }

      const path = initProject(projectPath, args.name);

      if (args.json) {
        jsonOutput({ project_path: path });
      } else {
        console.log(chalk.green("✓ 项目初始化成功"));
        console.log(`  路径: ${path}`);
        console.log(`  文件: timetable.json`);
        console.log("\n下一步:");
        console.log("  tt teacher add --id T1 --name 张伟 --canTeach MATH,PHYS");
        console.log("  tt course add --id MATH --name 数学 --type required --weeklyHours 4");
      }
      process.exit(0);
    } catch (error: any) {
      if (args.json) jsonOutput(null, false, [{ code: "INIT_ERROR", msg: error.message }]);
      else console.error(chalk.red(`错误: ${error.message}`));
      process.exit(10);
    }
  },
});

// status命令
const status = defineCommand({
  meta: {
    name: "status",
    description: "查看项目状态",
  },
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
      const data = {
        school: state.meta.school,
        counts: {
          teachers: state.teachers.length,
          rooms: state.rooms.length,
          courses: state.courses.length,
          students: state.students.length,
          admin_classes: state.admin_classes.length,
          teaching_classes: state.teaching_classes.length,
          teaching_assignments: state.teaching_assignments.length,
          ap_selections: state.ap_selections.length,
          constraints: state.constraints.length,
        },
        last_stage: state.assignments ? "timetable" : state.ap_sections ? "sections" : state.teaching_tasks ? "tasks" : "none",
        hard_violations: 0,
        soft_score: 0,
      };

      if (args.json) {
        jsonOutput(data);
      } else {
        console.log(chalk.bold("排课系统状态"));
        console.log(`学校: ${data.school || "(未设置)"}`);
        console.log("\n数据统计:");
        Object.entries(data.counts).forEach(([key, value]) => {
          console.log(`  ${key}: ${value}`);
        });
        console.log(`\n当前阶段: ${data.last_stage}`);
      }
      process.exit(0);
    } catch (error: any) {
      if (args.json) jsonOutput(null, false, [{ code: "STATUS_ERROR", msg: error.message }]);
      else console.error(chalk.red(`错误: ${error.message}`));
      process.exit(10);
    }
  },
});

// config命令
const configSetWalkBlocks = defineCommand({
  meta: { name: "set-walk-blocks", description: "设置走班时段" },
  args: {
    slots: { type: "string", description: "时段列表，逗号分隔（如 D1P6,D1P7）", required: true },
    json: { type: "boolean", description: "JSON格式输出", default: false },
  },
  run({ args }) {
    try {
      const projectPath = process.cwd();
      if (!projectExists(projectPath)) {
        if (args.json) jsonOutput(null, false, [{ code: "NO_PROJECT", msg: "项目不存在" }]);
        else console.error(chalk.red("错误: 项目不存在，请先运行 tt init"));
        process.exit(3);
      }

      const state = readState(projectPath);
      const slots = String(args.slots).split(",").map(s => s.trim()).filter(Boolean);
      state.config.walk_blocks = slots as any[];
      writeState(projectPath, state);

      if (args.json) jsonOutput({ walk_blocks: slots });
      else {
        console.log(chalk.green("✓ 走班时段已更新"));
        console.log(`  时段: ${slots.join(", ")}`);
      }
      process.exit(0);
    } catch (error: any) {
      if (args.json) jsonOutput(null, false, [{ code: "CONFIG_ERROR", msg: error.message }]);
      else console.error(chalk.red(`错误: ${error.message}`));
      process.exit(10);
    }
  },
});

const config = defineCommand({
  meta: { name: "config", description: "配置管理" },
  subCommands: { "set-walk-blocks": configSetWalkBlocks },
});

// 主命令
const main = defineCommand({
  meta: {
    name: "tt",
    description: "AP课程排课系统 CLI",
    version: "0.1.0",
  },
  subCommands: {
    init,
    status,
    config,
    teacher: defineCommand({
      meta: { name: "teacher", description: "教师管理" },
      subCommands: { add: teacherAdd, list: teacherList, edit: teacherEdit, rm: teacherRm },
    }),
    room: defineCommand({
      meta: { name: "room", description: "教室管理" },
      subCommands: { add: roomAdd, list: roomList, edit: roomEdit, rm: roomRm },
    }),
    course: defineCommand({
      meta: { name: "course", description: "课程管理" },
      subCommands: { add: courseAdd, list: courseList, edit: courseEdit, rm: courseRm },
    }),
    student: defineCommand({
      meta: { name: "student", description: "学生管理" },
      subCommands: { add: studentAdd, list: studentList, edit: studentEdit, rm: studentRm },
    }),
    "admin-class": defineCommand({
      meta: { name: "admin-class", description: "行政班管理" },
      subCommands: { add: adminClassAdd, list: adminClassList, edit: adminClassEdit, rm: adminClassRm },
    }),
    "teaching-class": defineCommand({
      meta: { name: "teaching-class", description: "教学班管理" },
      subCommands: { add: teachingClassAdd, list: teachingClassList, edit: teachingClassEdit, rm: teachingClassRm },
    }),
    "teaching-assignment": defineCommand({
      meta: { name: "teaching-assignment", description: "教师分工管理" },
      subCommands: { add: teachingAssignmentAdd, list: teachingAssignmentList, edit: teachingAssignmentEdit, rm: teachingAssignmentRm },
    }),
    "ap-selection": defineCommand({
      meta: { name: "ap-selection", description: "AP选课管理" },
      subCommands: { add: apSelectionAdd, list: apSelectionList, edit: apSelectionEdit, rm: apSelectionRm },
    }),
    constraint: defineCommand({
      meta: { name: "constraint", description: "约束管理" },
      subCommands: { add: constraintAdd, list: constraintList, edit: constraintEdit, rm: constraintRm },
    }),
    "validate-input": validateInput,
    "build-tasks": buildTasks,
    solve: defineCommand({
      meta: { name: "solve", description: "执行求解" },
      subCommands: {
        sections: solveSectionsCmd,
        timetable: solveTimetableCmd,
      },
    }),
    "solve-sections": solveSectionsCmd,
    "solve-timetable": solveTimetableCmd,
    show,
    lock,
    unlock,
    swap,
    validate,
    export: exportCmd,
  },
});

runMain(main);
