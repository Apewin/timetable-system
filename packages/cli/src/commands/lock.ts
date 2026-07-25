/**
 * 锁定/解锁/交换命令
 */
import { defineCommand } from "citty";
import chalk from "chalk";
import { readState, writeState, projectExists } from "@timetable/core";
import type { Lock, SlotId } from "@timetable/core";

function jsonOutput(data: unknown, ok = true, errors: unknown[] = []) {
  console.log(JSON.stringify({ ok, data, errors, warnings: [] }, null, 2));
}

export const lock = defineCommand({
  meta: { name: "lock", description: "锁定任务时段" },
  args: {
    task: { type: "string", description: "任务ID", required: true },
    slot: { type: "string", description: "时段ID（如 D1P2）", required: true },
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

      // 检查任务是否存在
      const task = state.teaching_tasks?.find(t => t.id === args.task);
      if (!task) {
        if (args.json) jsonOutput(null, false, [{ code: "NOT_FOUND", msg: `任务 ${args.task} 不存在` }]);
        else console.error(chalk.red(`错误: 任务 ${args.task} 不存在`));
        process.exit(3);
      }

      // 检查是否已锁定
      const existingLock = state.locks.find(l => l.task_id === args.task && l.slot_id === args.slot);
      if (existingLock) {
        if (args.json) jsonOutput({ lock: existingLock });
        else console.log(chalk.yellow(`任务 ${args.task} 在时段 ${args.slot} 已锁定`));
        process.exit(0);
      }

      // 添加锁定
      const lock: Lock = {
        task_id: args.task,
        slot_id: args.slot as SlotId,
      };

      const newState = {
        ...state,
        locks: [...state.locks, lock],
      };
      writeState(projectPath, newState);

      if (args.json) jsonOutput({ lock });
      else {
        console.log(chalk.green("✓ 已锁定"));
        console.log(`  任务: ${args.task}, 时段: ${args.slot}`);
      }
      process.exit(0);
    } catch (error: any) {
      if (args.json) jsonOutput(null, false, [{ code: "LOCK_ERROR", msg: error.message }]);
      else console.error(chalk.red(`错误: ${error.message}`));
      process.exit(10);
    }
  },
});

export const unlock = defineCommand({
  meta: { name: "unlock", description: "解锁任务时段" },
  args: {
    task: { type: "string", description: "任务ID", required: true },
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
      const lockCount = state.locks.filter(l => l.task_id === args.task).length;

      if (lockCount === 0) {
        if (args.json) jsonOutput(null, false, [{ code: "NOT_FOUND", msg: `任务 ${args.task} 没有锁定` }]);
        else console.error(chalk.red(`错误: 任务 ${args.task} 没有锁定`));
        process.exit(3);
      }

      const newState = {
        ...state,
        locks: state.locks.filter(l => l.task_id !== args.task),
      };
      writeState(projectPath, newState);

      if (args.json) jsonOutput({ removed: lockCount });
      else console.log(chalk.green(`✓ 已解锁任务 ${args.task} 的 ${lockCount} 个时段`));
      process.exit(0);
    } catch (error: any) {
      if (args.json) jsonOutput(null, false, [{ code: "UNLOCK_ERROR", msg: error.message }]);
      else console.error(chalk.red(`错误: ${error.message}`));
      process.exit(10);
    }
  },
});

export const swap = defineCommand({
  meta: { name: "swap", description: "手动交换任务时段" },
  args: {
    task: { type: "string", description: "任务ID", required: true },
    to: { type: "string", description: "目标时段ID（如 D1P2）", required: true },
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

      // 检查任务是否存在
      const task = state.teaching_tasks?.find(t => t.id === args.task);
      if (!task) {
        if (args.json) jsonOutput(null, false, [{ code: "NOT_FOUND", msg: `任务 ${args.task} 不存在` }]);
        else console.error(chalk.red(`错误: 任务 ${args.task} 不存在`));
        process.exit(3);
      }

      // 检查目标时段是否已被该任务占用
      const existingAssignment = state.assignments?.find(
        a => a.task_id === args.task && a.slot_id === args.to
      );
      if (existingAssignment) {
        if (args.json) jsonOutput({ assignment: existingAssignment });
        else console.log(chalk.yellow(`任务 ${args.task} 已经在时段 ${args.to}`));
        process.exit(0);
      }

      // 找到任务的一个assignment（未锁定的）
      const assignmentIndex = state.assignments?.findIndex(a =>
        a.task_id === args.task && !state.locks.some(l => l.task_id === a.task_id && l.slot_id === a.slot_id)
      );

      if (assignmentIndex === undefined || assignmentIndex === -1) {
        if (args.json) jsonOutput(null, false, [{ code: "NO_ASSIGNMENT", msg: `任务 ${args.task} 没有可交换的排课` }]);
        else console.error(chalk.red(`错误: 任务 ${args.task} 没有可交换的排课`));
        process.exit(3);
      }

      // 交换时段
      const newAssignments = [...(state.assignments || [])];
      newAssignments[assignmentIndex] = {
        ...newAssignments[assignmentIndex],
        slot_id: args.to as SlotId,
      };

      const newState = { ...state, assignments: newAssignments };
      writeState(projectPath, newState);

      if (args.json) jsonOutput({ assignment: newAssignments[assignmentIndex] });
      else {
        console.log(chalk.green("✓ 已交换"));
        console.log(`  任务: ${args.task}, 新时段: ${args.to}`);
      }
      process.exit(0);
    } catch (error: any) {
      if (args.json) jsonOutput(null, false, [{ code: "SWAP_ERROR", msg: error.message }]);
      else console.error(chalk.red(`错误: ${error.message}`));
      process.exit(10);
    }
  },
});
