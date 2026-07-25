/**
 * 课程相关命令
 */
import { defineCommand } from "citty";
import chalk from "chalk";
import Table from "cli-table3";
import { readState, writeState, addEntity, updateEntity, removeEntity, findEntity, projectExists } from "@timetable/core";
import type { Course } from "@timetable/core";

function jsonOutput(data: unknown, ok = true, errors: unknown[] = []) {
  console.log(JSON.stringify({ ok, data, errors, warnings: [] }, null, 2));
}

export const courseAdd = defineCommand({
  meta: { name: "add", description: "添加课程" },
  args: {
    id: { type: "string", description: "课程ID", required: true },
    name: { type: "string", description: "课程名称", required: true },
    type: { type: "string", description: "课程类型（required/ap）", required: true },
    weeklyHours: { type: "string", description: "每周课时", required: true },
    requiredRoomType: { type: "string", description: "需要的教室类型（AP课用）" },
    preferMorning: { type: "boolean", description: "优先上午排课" },
    consecutiveMin: { type: "string", description: "连堂最小节数" },
    consecutiveMax: { type: "string", description: "连堂最大节数" },
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
      const course: Course = {
        id: args.id,
        name: args.name,
        type: args.type as "required" | "ap",
        weekly_hours: Number(args.weeklyHours),
        required_room_type: args.requiredRoomType,
        prefer_morning: args.preferMorning || false,
        consecutive: args.consecutiveMin && args.consecutiveMax
          ? { min: Number(args.consecutiveMin), max: Number(args.consecutiveMax) }
          : undefined,
      };

      const newState = addEntity(state, "courses", course);
      writeState(projectPath, newState);

      if (args.json) jsonOutput(course);
      else {
        console.log(chalk.green("✓ 课程已添加"));
        console.log(`  ID: ${course.id}, 名称: ${course.name}, 类型: ${course.type === "ap" ? "AP选修" : "必修"}, 周课时: ${course.weekly_hours}`);
      }
      process.exit(0);
    } catch (error: any) {
      if (args.json) jsonOutput(null, false, [{ code: "ADD_ERROR", msg: error.message }]);
      else console.error(chalk.red(`错误: ${error.message}`));
      process.exit(10);
    }
  },
});

export const courseList = defineCommand({
  meta: { name: "list", description: "列出课程" },
  args: {
    json: { type: "boolean", description: "JSON格式输出", default: false },
    type: { type: "string", description: "按类型筛选（required/ap）" },
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
      let list = state.courses;
      if (args.type) list = list.filter(c => c.type === args.type);

      if (args.json) jsonOutput(list);
      else {
        if (list.length === 0) { console.log(chalk.yellow("暂无课程")); return; }
        const table = new Table({ head: ["ID", "名称", "类型", "周课时", "教室类型", "优先上午", "连堂"] });
        list.forEach(c => table.push([
          c.id, c.name, c.type === "ap" ? "AP选修" : "必修", c.weekly_hours,
          c.required_room_type || "-", c.prefer_morning ? "是" : "-",
          c.consecutive ? `${c.consecutive.min}-${c.consecutive.max}` : "-"
        ]));
        console.log(table.toString());
        console.log(`共 ${list.length} 门课程`);
      }
      process.exit(0);
    } catch (error: any) {
      if (args.json) jsonOutput(null, false, [{ code: "LIST_ERROR", msg: error.message }]);
      else console.error(chalk.red(`错误: ${error.message}`));
      process.exit(10);
    }
  },
});

export const courseEdit = defineCommand({
  meta: { name: "edit", description: "编辑课程" },
  args: {
    id: { type: "string", description: "课程ID", required: true },
    name: { type: "string", description: "名称" },
    type: { type: "string", description: "类型" },
    weeklyHours: { type: "string", description: "周课时" },
    requiredRoomType: { type: "string", description: "教室类型" },
    preferMorning: { type: "boolean", description: "优先上午" },
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
      if (!findEntity(state, "courses", args.id)) {
        if (args.json) jsonOutput(null, false, [{ code: "NOT_FOUND", msg: `课程 ${args.id} 不存在` }]);
        else console.error(chalk.red(`错误: 课程 ${args.id} 不存在`));
        process.exit(3);
      }

      const updates: Partial<Course> = {};
      if (args.name) updates.name = args.name;
      if (args.type) updates.type = args.type as "required" | "ap";
      if (args.weeklyHours) updates.weekly_hours = Number(args.weeklyHours);
      if (args.requiredRoomType !== undefined) updates.required_room_type = args.requiredRoomType || undefined;
      if (args.preferMorning !== undefined) updates.prefer_morning = args.preferMorning;

      const newState = updateEntity(state, "courses", args.id, updates);
      writeState(projectPath, newState);

      if (args.json) jsonOutput(findEntity(newState, "courses", args.id));
      else console.log(chalk.green(`✓ 课程 ${args.id} 已更新`));
      process.exit(0);
    } catch (error: any) {
      if (args.json) jsonOutput(null, false, [{ code: "EDIT_ERROR", msg: error.message }]);
      else console.error(chalk.red(`错误: ${error.message}`));
      process.exit(10);
    }
  },
});

export const courseRm = defineCommand({
  meta: { name: "rm", description: "删除课程" },
  args: {
    id: { type: "string", description: "课程ID", required: true },
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
      if (!findEntity(state, "courses", args.id)) {
        if (args.json) jsonOutput(null, false, [{ code: "NOT_FOUND", msg: `课程 ${args.id} 不存在` }]);
        else console.error(chalk.red(`错误: 课程 ${args.id} 不存在`));
        process.exit(3);
      }

      const newState = removeEntity(state, "courses", args.id);
      writeState(projectPath, newState);

      if (args.json) jsonOutput({ removed: args.id });
      else console.log(chalk.green(`✓ 课程 ${args.id} 已删除`));
      process.exit(0);
    } catch (error: any) {
      if (args.json) jsonOutput(null, false, [{ code: "RM_ERROR", msg: error.message }]);
      else console.error(chalk.red(`错误: ${error.message}`));
      process.exit(10);
    }
  },
});
