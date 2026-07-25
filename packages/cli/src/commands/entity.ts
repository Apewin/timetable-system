/**
 * 通用实体 CRUD 命令工厂
 */
import { defineCommand } from "citty";
import chalk from "chalk";
import Table from "cli-table3";
import {
  readState,
  writeState,
  addEntity,
  updateEntity,
  removeEntity,
  findEntity,
  projectExists,
} from "@timetable/core";
import type { TimetableState, Teacher, Room, Course, Student, AdminClass, TeachingClass, TeachingAssignment, ApSelection, Constraint } from "@timetable/core";

// 通用JSON输出
function jsonOutput(data: unknown, ok = true, errors: unknown[] = []) {
  console.log(JSON.stringify({ ok, data, errors, warnings: [] }, null, 2));
}

// 实体配置
export interface EntityConfig<T> {
  name: string;
  displayName: string;
  stateKey: keyof TimetableState;
  parseArgs: (args: Record<string, unknown>) => T;
  getDisplayFields: (entity: T) => Record<string, string>;
  getIdField?: string;
}

// 创建 add 命令
export function createAddCommand<T extends { id: string }>(config: EntityConfig<T>) {
  return defineCommand({
    meta: {
      name: "add",
      description: `添加${config.displayName}`,
    },
    args: {
      json: { type: "boolean", description: "JSON格式输出", default: false },
    },
    async run({ args }) {
      try {
        const projectPath = process.cwd();
        if (!projectExists(projectPath)) {
          if (args.json) jsonOutput(null, false, [{ code: "NO_PROJECT", msg: "项目不存在" }]);
          else console.error(chalk.red("错误: 项目不存在，请先运行 tt init"));
          process.exit(3);
        }

        const state = readState(projectPath);
        const entity = config.parseArgs(args as Record<string, unknown>);

        if (!entity.id) {
          if (args.json) jsonOutput(null, false, [{ code: "MISSING_ID", msg: "缺少 --id 参数" }]);
          else console.error(chalk.red("错误: 缺少 --id 参数"));
          process.exit(2);
        }

        const newState = addEntity(state, config.stateKey, entity);
        writeState(projectPath, newState);

        if (args.json) {
          jsonOutput(entity);
        } else {
          console.log(chalk.green(`✓ ${config.displayName} 已添加`));
          console.log(`  ID: ${entity.id}`);
        }
        process.exit(0);
      } catch (error: any) {
        if (args.json) jsonOutput(null, false, [{ code: "ADD_ERROR", msg: error.message }]);
        else console.error(chalk.red(`错误: ${error.message}`));
        process.exit(10);
      }
    },
  });
}

// 创建 list 命令
export function createListCommand<T>(config: EntityConfig<T>) {
  return defineCommand({
    meta: {
      name: "list",
      description: `列出${config.displayName}`,
    },
    args: {
      json: { type: "boolean", description: "JSON格式输出", default: false },
      grade: { type: "string", description: "按年级筛选（1/2/3）" },
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
        let list = state[config.stateKey] as T[];

        // 按年级筛选
        if (args.grade && "grade" in (list[0] || {})) {
          const grade = parseInt(args.grade);
          list = list.filter((item: any) => item.grade === grade);
        }

        if (args.json) {
          jsonOutput(list);
        } else {
          if (list.length === 0) {
            console.log(chalk.yellow(`暂无${config.displayName}`));
            return;
          }

          const table = new Table({
            head: Object.keys(config.getDisplayFields(list[0])),
          });

          list.forEach((item) => {
            table.push(Object.values(config.getDisplayFields(item)));
          });

          console.log(table.toString());
          console.log(`共 ${list.length} 条记录`);
        }
        process.exit(0);
      } catch (error: any) {
        if (args.json) jsonOutput(null, false, [{ code: "LIST_ERROR", msg: error.message }]);
        else console.error(chalk.red(`错误: ${error.message}`));
        process.exit(10);
      }
    },
  });
}

// 创建 edit 命令
export function createEditCommand<T extends { id: string }>(config: EntityConfig<T>) {
  return defineCommand({
    meta: {
      name: "edit",
      description: `编辑${config.displayName}`,
    },
    args: {
      id: { type: "string", description: `${config.displayName}ID`, required: true },
      json: { type: "boolean", description: "JSON格式输出", default: false },
    },
    async run({ args }) {
      try {
        const projectPath = process.cwd();
        if (!projectExists(projectPath)) {
          if (args.json) jsonOutput(null, false, [{ code: "NO_PROJECT", msg: "项目不存在" }]);
          else console.error(chalk.red("错误: 项目不存在，请先运行 tt init"));
          process.exit(3);
        }

        const state = readState(projectPath);
        const existing = findEntity<T>(state, config.stateKey, args.id);
        if (!existing) {
          if (args.json) jsonOutput(null, false, [{ code: "NOT_FOUND", msg: `${config.displayName} ${args.id} 不存在` }]);
          else console.error(chalk.red(`错误: ${config.displayName} ${args.id} 不存在`));
          process.exit(3);
        }

        // 解析更新参数（排除 id 和 json）
        const updates: Partial<T> = {};
        const { id, json, ...rest } = args as Record<string, unknown>;
        for (const [key, value] of Object.entries(rest)) {
          if (value !== undefined) {
            (updates as any)[key] = value;
          }
        }

        const newState = updateEntity(state, config.stateKey, args.id, updates);
        writeState(projectPath, newState);

        const updated = findEntity(newState, config.stateKey, args.id);
        if (args.json) {
          jsonOutput(updated);
        } else {
          console.log(chalk.green(`✓ ${config.displayName} 已更新`));
          console.log(`  ID: ${args.id}`);
        }
        process.exit(0);
      } catch (error: any) {
        if (args.json) jsonOutput(null, false, [{ code: "EDIT_ERROR", msg: error.message }]);
        else console.error(chalk.red(`错误: ${error.message}`));
        process.exit(10);
      }
    },
  });
}

// 创建 rm 命令
export function createRmCommand<T extends { id: string }>(config: EntityConfig<T>) {
  return defineCommand({
    meta: {
      name: "rm",
      description: `删除${config.displayName}`,
    },
    args: {
      id: { type: "string", description: `${config.displayName}ID`, required: true },
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
        const existing = findEntity(state, config.stateKey, args.id);
        if (!existing) {
          if (args.json) jsonOutput(null, false, [{ code: "NOT_FOUND", msg: `${config.displayName} ${args.id} 不存在` }]);
          else console.error(chalk.red(`错误: ${config.displayName} ${args.id} 不存在`));
          process.exit(3);
        }

        const newState = removeEntity(state, config.stateKey, args.id);
        writeState(projectPath, newState);

        if (args.json) {
          jsonOutput({ removed: args.id });
        } else {
          console.log(chalk.green(`✓ ${config.displayName} ${args.id} 已删除`));
        }
        process.exit(0);
      } catch (error: any) {
        if (args.json) jsonOutput(null, false, [{ code: "RM_ERROR", msg: error.message }]);
        else console.error(chalk.red(`错误: ${error.message}`));
        process.exit(10);
      }
    },
  });
}
