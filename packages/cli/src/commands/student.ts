/**
 * 学生相关命令
 */
import { defineCommand } from "citty";
import chalk from "chalk";
import Table from "cli-table3";
import { readState, writeState, addEntity, updateEntity, removeEntity, findEntity, projectExists } from "@timetable/core";
import type { Student } from "@timetable/core";

function jsonOutput(data: unknown, ok = true, errors: unknown[] = []) {
  console.log(JSON.stringify({ ok, data, errors, warnings: [] }, null, 2));
}

export const studentAdd = defineCommand({
  meta: { name: "add", description: "添加学生" },
  args: {
    id: { type: "string", description: "学生ID", required: true },
    name: { type: "string", description: "学生姓名", required: true },
    grade: { type: "string", description: "年级（1/2/3）", required: true },
    adminClass: { type: "string", description: "行政班ID", required: true },
    teachingClass: { type: "string", description: "教学班ID", required: true },
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
      const student: Student = {
        id: args.id,
        name: args.name,
        grade: Number(args.grade) as 1 | 2 | 3,
        admin_class_id: args.adminClass,
        teaching_class_id: args.teachingClass,
      };

      const newState = addEntity(state, "students", student);
      writeState(projectPath, newState);

      if (args.json) jsonOutput(student);
      else {
        console.log(chalk.green("✓ 学生已添加"));
        console.log(`  ID: ${student.id}, 姓名: ${student.name}, 年级: ${student.grade}`);
      }
      process.exit(0);
    } catch (error: any) {
      if (args.json) jsonOutput(null, false, [{ code: "ADD_ERROR", msg: error.message }]);
      else console.error(chalk.red(`错误: ${error.message}`));
      process.exit(10);
    }
  },
});

export const studentList = defineCommand({
  meta: { name: "list", description: "列出学生" },
  args: {
    json: { type: "boolean", description: "JSON格式输出", default: false },
    grade: { type: "string", description: "按年级筛选" },
    adminClass: { type: "string", description: "按行政班筛选" },
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
      let list = state.students;
      if (args.grade) list = list.filter(s => s.grade === Number(args.grade));
      if (args.adminClass) list = list.filter(s => s.admin_class_id === args.adminClass);

      if (args.json) jsonOutput(list);
      else {
        if (list.length === 0) { console.log(chalk.yellow("暂无学生")); return; }
        const table = new Table({ head: ["ID", "姓名", "年级", "行政班", "教学班"] });
        list.forEach(s => table.push([s.id, s.name, s.grade, s.admin_class_id, s.teaching_class_id]));
        console.log(table.toString());
        console.log(`共 ${list.length} 名学生`);
      }
      process.exit(0);
    } catch (error: any) {
      if (args.json) jsonOutput(null, false, [{ code: "LIST_ERROR", msg: error.message }]);
      else console.error(chalk.red(`错误: ${error.message}`));
      process.exit(10);
    }
  },
});

export const studentEdit = defineCommand({
  meta: { name: "edit", description: "编辑学生" },
  args: {
    id: { type: "string", description: "学生ID", required: true },
    name: { type: "string", description: "姓名" },
    grade: { type: "string", description: "年级" },
    adminClass: { type: "string", description: "行政班ID" },
    teachingClass: { type: "string", description: "教学班ID" },
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
      if (!findEntity(state, "students", args.id)) {
        if (args.json) jsonOutput(null, false, [{ code: "NOT_FOUND", msg: `学生 ${args.id} 不存在` }]);
        else console.error(chalk.red(`错误: 学生 ${args.id} 不存在`));
        process.exit(3);
      }

      const updates: Partial<Student> = {};
      if (args.name) updates.name = args.name;
      if (args.grade) updates.grade = Number(args.grade) as 1 | 2 | 3;
      if (args.adminClass) updates.admin_class_id = args.adminClass;
      if (args.teachingClass) updates.teaching_class_id = args.teachingClass;

      const newState = updateEntity(state, "students", args.id, updates);
      writeState(projectPath, newState);

      if (args.json) jsonOutput(findEntity(newState, "students", args.id));
      else console.log(chalk.green(`✓ 学生 ${args.id} 已更新`));
      process.exit(0);
    } catch (error: any) {
      if (args.json) jsonOutput(null, false, [{ code: "EDIT_ERROR", msg: error.message }]);
      else console.error(chalk.red(`错误: ${error.message}`));
      process.exit(10);
    }
  },
});

export const studentRm = defineCommand({
  meta: { name: "rm", description: "删除学生" },
  args: {
    id: { type: "string", description: "学生ID", required: true },
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
      if (!findEntity(state, "students", args.id)) {
        if (args.json) jsonOutput(null, false, [{ code: "NOT_FOUND", msg: `学生 ${args.id} 不存在` }]);
        else console.error(chalk.red(`错误: 学生 ${args.id} 不存在`));
        process.exit(3);
      }

      const newState = removeEntity(state, "students", args.id);
      writeState(projectPath, newState);

      if (args.json) jsonOutput({ removed: args.id });
      else console.log(chalk.green(`✓ 学生 ${args.id} 已删除`));
      process.exit(0);
    } catch (error: any) {
      if (args.json) jsonOutput(null, false, [{ code: "RM_ERROR", msg: error.message }]);
      else console.error(chalk.red(`错误: ${error.message}`));
      process.exit(10);
    }
  },
});
