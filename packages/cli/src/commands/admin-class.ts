/**
 * 行政班相关命令
 */
import { defineCommand } from "citty";
import chalk from "chalk";
import Table from "cli-table3";
import { readState, writeState, addEntity, updateEntity, removeEntity, findEntity, projectExists } from "@timetable/core";
import type { AdminClass } from "@timetable/core";

function jsonOutput(data: unknown, ok = true, errors: unknown[] = []) {
  console.log(JSON.stringify({ ok, data, errors, warnings: [] }, null, 2));
}

export const adminClassAdd = defineCommand({
  meta: { name: "add", description: "添加行政班" },
  args: {
    id: { type: "string", description: "行政班ID", required: true },
    name: { type: "string", description: "班级名称", required: true },
    grade: { type: "string", description: "年级（1/2/3）", required: true },
    fixedRoom: { type: "string", description: "固定教室ID", required: true },
    students: { type: "string", description: "学生ID列表，逗号分隔" },
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
      const cls: AdminClass = {
        id: args.id,
        name: args.name,
        grade: Number(args.grade) as 1 | 2 | 3,
        fixed_room_id: args.fixedRoom,
        student_ids: args.students ? args.students.split(",").map(s => s.trim()).filter(Boolean) : [],
      };

      const newState = addEntity(state, "admin_classes", cls);
      writeState(projectPath, newState);

      if (args.json) jsonOutput(cls);
      else {
        console.log(chalk.green("✓ 行政班已添加"));
        console.log(`  ID: ${cls.id}, 名称: ${cls.name}, 年级: ${cls.grade}, 学生数: ${cls.student_ids.length}`);
      }
      process.exit(0);
    } catch (error: any) {
      if (args.json) jsonOutput(null, false, [{ code: "ADD_ERROR", msg: error.message }]);
      else console.error(chalk.red(`错误: ${error.message}`));
      process.exit(10);
    }
  },
});

export const adminClassList = defineCommand({
  meta: { name: "list", description: "列出行政班" },
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
      let list = state.admin_classes;
      if (args.grade) list = list.filter(c => c.grade === Number(args.grade));

      if (args.json) jsonOutput(list);
      else {
        if (list.length === 0) { console.log(chalk.yellow("暂无行政班")); return; }
        const table = new Table({ head: ["ID", "名称", "年级", "固定教室", "学生数"] });
        list.forEach(c => table.push([c.id, c.name, c.grade, c.fixed_room_id, c.student_ids.length]));
        console.log(table.toString());
        console.log(`共 ${list.length} 个行政班`);
      }
      process.exit(0);
    } catch (error: any) {
      if (args.json) jsonOutput(null, false, [{ code: "LIST_ERROR", msg: error.message }]);
      else console.error(chalk.red(`错误: ${error.message}`));
      process.exit(10);
    }
  },
});

export const adminClassEdit = defineCommand({
  meta: { name: "edit", description: "编辑行政班" },
  args: {
    id: { type: "string", description: "行政班ID", required: true },
    name: { type: "string", description: "名称" },
    grade: { type: "string", description: "年级" },
    fixedRoom: { type: "string", description: "固定教室ID" },
    students: { type: "string", description: "学生ID列表" },
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
      if (!findEntity(state, "admin_classes", args.id)) {
        if (args.json) jsonOutput(null, false, [{ code: "NOT_FOUND", msg: `行政班 ${args.id} 不存在` }]);
        else console.error(chalk.red(`错误: 行政班 ${args.id} 不存在`));
        process.exit(3);
      }

      const updates: Partial<AdminClass> = {};
      if (args.name) updates.name = args.name;
      if (args.grade) updates.grade = Number(args.grade) as 1 | 2 | 3;
      if (args.fixedRoom) updates.fixed_room_id = args.fixedRoom;
      if (args.students !== undefined) updates.student_ids = args.students.split(",").map(s => s.trim()).filter(Boolean);

      const newState = updateEntity(state, "admin_classes", args.id, updates);
      writeState(projectPath, newState);

      if (args.json) jsonOutput(findEntity(newState, "admin_classes", args.id));
      else console.log(chalk.green(`✓ 行政班 ${args.id} 已更新`));
      process.exit(0);
    } catch (error: any) {
      if (args.json) jsonOutput(null, false, [{ code: "EDIT_ERROR", msg: error.message }]);
      else console.error(chalk.red(`错误: ${error.message}`));
      process.exit(10);
    }
  },
});

export const adminClassRm = defineCommand({
  meta: { name: "rm", description: "删除行政班" },
  args: {
    id: { type: "string", description: "行政班ID", required: true },
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
      if (!findEntity(state, "admin_classes", args.id)) {
        if (args.json) jsonOutput(null, false, [{ code: "NOT_FOUND", msg: `行政班 ${args.id} 不存在` }]);
        else console.error(chalk.red(`错误: 行政班 ${args.id} 不存在`));
        process.exit(3);
      }

      const newState = removeEntity(state, "admin_classes", args.id);
      writeState(projectPath, newState);

      if (args.json) jsonOutput({ removed: args.id });
      else console.log(chalk.green(`✓ 行政班 ${args.id} 已删除`));
      process.exit(0);
    } catch (error: any) {
      if (args.json) jsonOutput(null, false, [{ code: "RM_ERROR", msg: error.message }]);
      else console.error(chalk.red(`错误: ${error.message}`));
      process.exit(10);
    }
  },
});
