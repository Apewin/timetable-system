/**
 * 约束相关命令
 */
import { defineCommand } from "citty";
import chalk from "chalk";
import Table from "cli-table3";
import { readState, writeState, addEntity, updateEntity, removeEntity, findEntity, projectExists } from "@timetable/core";
import type { Constraint } from "@timetable/core";

function jsonOutput(data: unknown, ok = true, errors: unknown[] = []) {
  console.log(JSON.stringify({ ok, data, errors, warnings: [] }, null, 2));
}

export const constraintAdd = defineCommand({
  meta: { name: "add", description: "添加约束" },
  args: {
    id: { type: "string", description: "约束ID", required: true },
    type: { type: "string", description: "约束类型", required: true },
    scope: { type: "string", description: "范围（teacher/course/class/student/task/global）", required: true },
    target: { type: "string", description: "目标ID" },
    params: { type: "string", description: "参数JSON" },
    hard: { type: "boolean", description: "是否硬约束" },
    weight: { type: "string", description: "权重（软约束用）" },
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
      let params = {};
      try {
        params = args.params ? JSON.parse(args.params) : {};
      } catch {
        if (args.json) jsonOutput(null, false, [{ code: "INVALID_PARAMS", msg: "params 必须是有效的 JSON" }]);
        else console.error(chalk.red("错误: params 必须是有效的 JSON"));
        process.exit(2);
      }

      const constraint: Constraint = {
        id: args.id,
        type: args.type as any,
        scope: args.scope as any,
        target_id: args.target,
        params,
        hard: args.hard || false,
        weight: args.weight ? Number(args.weight) : undefined,
      };

      const newState = addEntity(state, "constraints", constraint);
      writeState(projectPath, newState);

      if (args.json) jsonOutput(constraint);
      else {
        console.log(chalk.green("✓ 约束已添加"));
        console.log(`  ID: ${constraint.id}, 类型: ${constraint.type}, 范围: ${constraint.scope}, ${constraint.hard ? "硬约束" : "软约束"}`);
      }
      process.exit(0);
    } catch (error: any) {
      if (args.json) jsonOutput(null, false, [{ code: "ADD_ERROR", msg: error.message }]);
      else console.error(chalk.red(`错误: ${error.message}`));
      process.exit(10);
    }
  },
});

export const constraintList = defineCommand({
  meta: { name: "list", description: "列出约束" },
  args: {
    json: { type: "boolean", description: "JSON格式输出", default: false },
    type: { type: "string", description: "按类型筛选" },
    scope: { type: "string", description: "按范围筛选" },
    hard: { type: "boolean", description: "只显示硬约束" },
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
      let list = state.constraints;
      if (args.type) list = list.filter(c => c.type === args.type);
      if (args.scope) list = list.filter(c => c.scope === args.scope);
      if (args.hard) list = list.filter(c => c.hard);

      if (args.json) jsonOutput(list);
      else {
        if (list.length === 0) { console.log(chalk.yellow("暂无约束")); return; }
        const table = new Table({ head: ["ID", "类型", "范围", "目标", "硬/软", "权重"] });
        list.forEach(c => table.push([
          c.id, c.type, c.scope, c.target_id || "-",
          c.hard ? "硬" : "软", c.weight ? String(c.weight) : "-"
        ]));
        console.log(table.toString());
        console.log(`共 ${list.length} 条约束`);
      }
      process.exit(0);
    } catch (error: any) {
      if (args.json) jsonOutput(null, false, [{ code: "LIST_ERROR", msg: error.message }]);
      else console.error(chalk.red(`错误: ${error.message}`));
      process.exit(10);
    }
  },
});

export const constraintEdit = defineCommand({
  meta: { name: "edit", description: "编辑约束" },
  args: {
    id: { type: "string", description: "约束ID", required: true },
    type: { type: "string", description: "约束类型" },
    scope: { type: "string", description: "范围" },
    target: { type: "string", description: "目标ID" },
    params: { type: "string", description: "参数JSON" },
    hard: { type: "boolean", description: "是否硬约束" },
    weight: { type: "string", description: "权重" },
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
      if (!findEntity(state, "constraints", args.id)) {
        if (args.json) jsonOutput(null, false, [{ code: "NOT_FOUND", msg: `约束 ${args.id} 不存在` }]);
        else console.error(chalk.red(`错误: 约束 ${args.id} 不存在`));
        process.exit(3);
      }

      const updates: Partial<Constraint> = {};
      if (args.type) updates.type = args.type as any;
      if (args.scope) updates.scope = args.scope as any;
      if (args.target !== undefined) updates.target_id = args.target || undefined;
      if (args.params) {
        try { updates.params = JSON.parse(args.params); }
        catch { if (args.json) jsonOutput(null, false, [{ code: "INVALID_PARAMS", msg: "params JSON 格式错误" }]); else console.error(chalk.red("错误: params JSON 格式错误")); process.exit(2); }
      }
      if (args.hard !== undefined) updates.hard = args.hard;
      if (args.weight) updates.weight = Number(args.weight);

      const newState = updateEntity(state, "constraints", args.id, updates);
      writeState(projectPath, newState);

      if (args.json) jsonOutput(findEntity(newState, "constraints", args.id));
      else console.log(chalk.green(`✓ 约束 ${args.id} 已更新`));
      process.exit(0);
    } catch (error: any) {
      if (args.json) jsonOutput(null, false, [{ code: "EDIT_ERROR", msg: error.message }]);
      else console.error(chalk.red(`错误: ${error.message}`));
      process.exit(10);
    }
  },
});

export const constraintRm = defineCommand({
  meta: { name: "rm", description: "删除约束" },
  args: {
    id: { type: "string", description: "约束ID", required: true },
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
      if (!findEntity(state, "constraints", args.id)) {
        if (args.json) jsonOutput(null, false, [{ code: "NOT_FOUND", msg: `约束 ${args.id} 不存在` }]);
        else console.error(chalk.red(`错误: 约束 ${args.id} 不存在`));
        process.exit(3);
      }

      const newState = removeEntity(state, "constraints", args.id);
      writeState(projectPath, newState);

      if (args.json) jsonOutput({ removed: args.id });
      else console.log(chalk.green(`✓ 约束 ${args.id} 已删除`));
      process.exit(0);
    } catch (error: any) {
      if (args.json) jsonOutput(null, false, [{ code: "RM_ERROR", msg: error.message }]);
      else console.error(chalk.red(`错误: ${error.message}`));
      process.exit(10);
    }
  },
});
