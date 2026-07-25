/**
 * 教室相关命令
 */
import { defineCommand } from "citty";
import chalk from "chalk";
import Table from "cli-table3";
import { readState, writeState, addEntity, updateEntity, removeEntity, findEntity, projectExists } from "@timetable/core";
import type { Room } from "@timetable/core";

function jsonOutput(data: unknown, ok = true, errors: unknown[] = []) {
  console.log(JSON.stringify({ ok, data, errors, warnings: [] }, null, 2));
}

export const roomAdd = defineCommand({
  meta: { name: "add", description: "添加教室" },
  args: {
    id: { type: "string", description: "教室ID", required: true },
    name: { type: "string", description: "教室名称", required: true },
    type: { type: "string", description: "教室类型（general/physics/chemistry等）", required: true },
    capacity: { type: "string", description: "容量", required: true },
    owner: { type: "string", description: "归属班级ID（固定教室）" },
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
      const room: Room = {
        id: args.id,
        name: args.name,
        type: args.type,
        capacity: Number(args.capacity),
        owner_class_id: args.owner,
      };

      const newState = addEntity(state, "rooms", room);
      writeState(projectPath, newState);

      if (args.json) jsonOutput(room);
      else {
        console.log(chalk.green("✓ 教室已添加"));
        console.log(`  ID: ${room.id}, 名称: ${room.name}, 类型: ${room.type}, 容量: ${room.capacity}`);
      }
      process.exit(0);
    } catch (error: any) {
      if (args.json) jsonOutput(null, false, [{ code: "ADD_ERROR", msg: error.message }]);
      else console.error(chalk.red(`错误: ${error.message}`));
      process.exit(10);
    }
  },
});

export const roomList = defineCommand({
  meta: { name: "list", description: "列出教室" },
  args: {
    json: { type: "boolean", description: "JSON格式输出", default: false },
    type: { type: "string", description: "按类型筛选" },
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
      let list = state.rooms;
      if (args.type) list = list.filter(r => r.type === args.type);

      if (args.json) jsonOutput(list);
      else {
        if (list.length === 0) { console.log(chalk.yellow("暂无教室")); return; }
        const table = new Table({ head: ["ID", "名称", "类型", "容量", "归属班级"] });
        list.forEach(r => table.push([r.id, r.name, r.type, r.capacity, r.owner_class_id || "-"]));
        console.log(table.toString());
        console.log(`共 ${list.length} 间教室`);
      }
      process.exit(0);
    } catch (error: any) {
      if (args.json) jsonOutput(null, false, [{ code: "LIST_ERROR", msg: error.message }]);
      else console.error(chalk.red(`错误: ${error.message}`));
      process.exit(10);
    }
  },
});

export const roomEdit = defineCommand({
  meta: { name: "edit", description: "编辑教室" },
  args: {
    id: { type: "string", description: "教室ID", required: true },
    name: { type: "string", description: "名称" },
    type: { type: "string", description: "类型" },
    capacity: { type: "string", description: "容量" },
    owner: { type: "string", description: "归属班级ID" },
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
      if (!findEntity(state, "rooms", args.id)) {
        if (args.json) jsonOutput(null, false, [{ code: "NOT_FOUND", msg: `教室 ${args.id} 不存在` }]);
        else console.error(chalk.red(`错误: 教室 ${args.id} 不存在`));
        process.exit(3);
      }

      const updates: Partial<Room> = {};
      if (args.name) updates.name = args.name;
      if (args.type) updates.type = args.type;
      if (args.capacity) updates.capacity = Number(args.capacity);
      if (args.owner !== undefined) updates.owner_class_id = args.owner || undefined;

      const newState = updateEntity(state, "rooms", args.id, updates);
      writeState(projectPath, newState);

      if (args.json) jsonOutput(findEntity(newState, "rooms", args.id));
      else console.log(chalk.green(`✓ 教室 ${args.id} 已更新`));
      process.exit(0);
    } catch (error: any) {
      if (args.json) jsonOutput(null, false, [{ code: "EDIT_ERROR", msg: error.message }]);
      else console.error(chalk.red(`错误: ${error.message}`));
      process.exit(10);
    }
  },
});

export const roomRm = defineCommand({
  meta: { name: "rm", description: "删除教室" },
  args: {
    id: { type: "string", description: "教室ID", required: true },
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
      if (!findEntity(state, "rooms", args.id)) {
        if (args.json) jsonOutput(null, false, [{ code: "NOT_FOUND", msg: `教室 ${args.id} 不存在` }]);
        else console.error(chalk.red(`错误: 教室 ${args.id} 不存在`));
        process.exit(3);
      }

      const newState = removeEntity(state, "rooms", args.id);
      writeState(projectPath, newState);

      if (args.json) jsonOutput({ removed: args.id });
      else console.log(chalk.green(`✓ 教室 ${args.id} 已删除`));
      process.exit(0);
    } catch (error: any) {
      if (args.json) jsonOutput(null, false, [{ code: "RM_ERROR", msg: error.message }]);
      else console.error(chalk.red(`错误: ${error.message}`));
      process.exit(10);
    }
  },
});
