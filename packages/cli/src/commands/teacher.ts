/**
 * 教师相关命令
 */
import { defineCommand } from "citty";
import chalk from "chalk";
import Table from "cli-table3";
import { readState, writeState, addEntity, updateEntity, removeEntity, findEntity, projectExists } from "@timetable/core";
import type { Teacher } from "@timetable/core";

function jsonOutput(data: unknown, ok = true, errors: unknown[] = []) {
  console.log(JSON.stringify({ ok, data, errors, warnings: [] }, null, 2));
}

export const teacherAdd = defineCommand({
  meta: { name: "add", description: "添加教师" },
  args: {
    id: { type: "string", description: "教师ID", required: true },
    name: { type: "string", description: "教师姓名", required: true },
    grade: { type: "string", description: "主要任教年级（1/2/3）" },
    canTeach: { type: "string", description: "可教课程ID，逗号分隔" },
    maxPerDay: { type: "string", description: "每天课时上限，默认8" },
    maxPerWeek: { type: "string", description: "每周课时上限，默认30" },
    homeroom: { type: "string", description: "班主任行政班ID" },
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
      const teacher: Teacher = {
        id: args.id,
        name: args.name,
        grade: args.grade ? Number(args.grade) as 1 | 2 | 3 : undefined,
        can_teach: args.canTeach ? args.canTeach.split(",").map(s => s.trim()) : [],
        available_slots: [],
        max_per_day: args.maxPerDay ? Number(args.maxPerDay) : 8,
        max_per_week: args.maxPerWeek ? Number(args.maxPerWeek) : 30,
        homeroom_class_id: args.homeroom,
      };

      const newState = addEntity(state, "teachers", teacher);
      writeState(projectPath, newState);

      if (args.json) jsonOutput(teacher);
      else {
        console.log(chalk.green("✓ 教师已添加"));
        console.log(`  ID: ${teacher.id}, 姓名: ${teacher.name}`);
      }
      process.exit(0);
    } catch (error: any) {
      if (args.json) jsonOutput(null, false, [{ code: "ADD_ERROR", msg: error.message }]);
      else console.error(chalk.red(`错误: ${error.message}`));
      process.exit(10);
    }
  },
});

export const teacherList = defineCommand({
  meta: { name: "list", description: "列出教师" },
  args: {
    json: { type: "boolean", description: "JSON格式输出", default: false },
    grade: { type: "string", description: "按年级筛选" },
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
      let list = state.teachers;
      if (args.grade) {
        list = list.filter(t => t.grade === Number(args.grade));
      }

      if (args.json) jsonOutput(list);
      else {
        if (list.length === 0) { console.log(chalk.yellow("暂无教师")); return; }
        const table = new Table({ head: ["ID", "姓名", "年级", "可教课程", "日上限", "周上限", "班主任"] });
        list.forEach(t => table.push([t.id, t.name, t.grade || "-", t.can_teach.join(","), t.max_per_day, t.max_per_week, t.homeroom_class_id || "-"]));
        console.log(table.toString());
        console.log(`共 ${list.length} 名教师`);
      }
      process.exit(0);
    } catch (error: any) {
      if (args.json) jsonOutput(null, false, [{ code: "LIST_ERROR", msg: error.message }]);
      else console.error(chalk.red(`错误: ${error.message}`));
      process.exit(10);
    }
  },
});

export const teacherEdit = defineCommand({
  meta: { name: "edit", description: "编辑教师" },
  args: {
    id: { type: "string", description: "教师ID", required: true },
    name: { type: "string", description: "教师姓名" },
    grade: { type: "string", description: "年级" },
    canTeach: { type: "string", description: "可教课程" },
    maxPerDay: { type: "string", description: "日上限" },
    maxPerWeek: { type: "string", description: "周上限" },
    homeroom: { type: "string", description: "班主任班ID" },
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
      const existing = findEntity<Teacher>(state, "teachers", args.id);
      if (!existing) {
        if (args.json) jsonOutput(null, false, [{ code: "NOT_FOUND", msg: `教师 ${args.id} 不存在` }]);
        else console.error(chalk.red(`错误: 教师 ${args.id} 不存在`));
        process.exit(3);
      }

      const updates: Partial<Teacher> = {};
      if (args.name) updates.name = args.name;
      if (args.grade) updates.grade = Number(args.grade) as 1 | 2 | 3;
      if (args.canTeach) updates.can_teach = args.canTeach.split(",").map(s => s.trim());
      if (args.maxPerDay) updates.max_per_day = Number(args.maxPerDay);
      if (args.maxPerWeek) updates.max_per_week = Number(args.maxPerWeek);
      if (args.homeroom !== undefined) updates.homeroom_class_id = args.homeroom || undefined;

      const newState = updateEntity(state, "teachers", args.id, updates);
      writeState(projectPath, newState);

      if (args.json) jsonOutput(findEntity(newState, "teachers", args.id));
      else console.log(chalk.green(`✓ 教师 ${args.id} 已更新`));
      process.exit(0);
    } catch (error: any) {
      if (args.json) jsonOutput(null, false, [{ code: "EDIT_ERROR", msg: error.message }]);
      else console.error(chalk.red(`错误: ${error.message}`));
      process.exit(10);
    }
  },
});

export const teacherRm = defineCommand({
  meta: { name: "rm", description: "删除教师" },
  args: {
    id: { type: "string", description: "教师ID", required: true },
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
      if (!findEntity(state, "teachers", args.id)) {
        if (args.json) jsonOutput(null, false, [{ code: "NOT_FOUND", msg: `教师 ${args.id} 不存在` }]);
        else console.error(chalk.red(`错误: 教师 ${args.id} 不存在`));
        process.exit(3);
      }

      const newState = removeEntity(state, "teachers", args.id);
      writeState(projectPath, newState);

      if (args.json) jsonOutput({ removed: args.id });
      else console.log(chalk.green(`✓ 教师 ${args.id} 已删除`));
      process.exit(0);
    } catch (error: any) {
      if (args.json) jsonOutput(null, false, [{ code: "RM_ERROR", msg: error.message }]);
      else console.error(chalk.red(`错误: ${error.message}`));
      process.exit(10);
    }
  },
});
