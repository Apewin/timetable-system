/**
 * 状态管理模块
 * 负责读写timetable.json，带文件锁
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { TimetableState, SlotId } from "../models/types.js";
import { timetableStateSchema } from "../models/schemas.js";

const STATE_FILE = "timetable.json";

// 默认空状态
export function createEmptyState(): TimetableState {
  const now = new Date().toISOString();
  const walkBlocks: SlotId[] = ["D1P6", "D1P7", "D3P6", "D3P7", "D5P6", "D5P7"];
  return {
    version: "0.1",
    meta: {
      school: "",
      created_at: now,
      updated_at: now,
    },
    config: {
      time_model: {
        days: 5,
        periods_per_day: 10,
        lunch_break_after_period: 5,
      },
      walk_blocks: walkBlocks,
    },
    teachers: [],
    rooms: [],
    courses: [],
    students: [],
    admin_classes: [],
    teaching_classes: [],
    teaching_assignments: [],
    ap_selections: [],
    constraints: [],
    ap_sections: null,
    teaching_tasks: null,
    assignments: null,
    locks: [],
  };
}

// 读取状态
export function readState(projectPath: string): TimetableState {
  const filePath = `${projectPath}/${STATE_FILE}`;

  if (!existsSync(filePath)) {
    throw new Error(`状态文件不存在: ${filePath}`);
  }

  const content = readFileSync(filePath, "utf-8");
  const data = JSON.parse(content);

  // 验证数据
  const result = timetableStateSchema.safeParse(data);
  if (!result.success) {
    throw new Error(`状态文件格式错误: ${result.error.message}`);
  }

  return result.data as TimetableState;
}

// 写入状态（简单实现，后续加文件锁）
export function writeState(projectPath: string, state: TimetableState): void {
  const filePath = `${projectPath}/${STATE_FILE}`;

  // 更新时间戳
  state.meta.updated_at = new Date().toISOString();

  // 确保目录存在
  const dir = dirname(filePath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  // 写入文件
  const content = JSON.stringify(state, null, 2);
  writeFileSync(filePath, content, "utf-8");
}

// 检查项目是否存在
export function projectExists(projectPath: string): boolean {
  return existsSync(`${projectPath}/${STATE_FILE}`);
}

// 初始化项目
export function initProject(projectPath: string, schoolName?: string): string {
  if (projectExists(projectPath)) {
    throw new Error(`项目已存在: ${projectPath}`);
  }

  const state = createEmptyState();
  if (schoolName) {
    state.meta.school = schoolName;
  }

  writeState(projectPath, state);
  return projectPath;
}

// 更新实体列表
export function addEntity<T extends { id: string }>(
  state: TimetableState,
  entityType: keyof TimetableState,
  entity: T
): TimetableState {
  const list = state[entityType];
  if (!Array.isArray(list)) {
    throw new Error(`${entityType} 不是数组`);
  }

  // 检查ID是否重复
  if (list.some((item: any) => item.id === entity.id)) {
    throw new Error(`ID ${entity.id} 已存在于 ${entityType}`);
  }

  return {
    ...state,
    [entityType]: [...list, entity],
  };
}

// 更新实体
export function updateEntity<T extends { id: string }>(
  state: TimetableState,
  entityType: keyof TimetableState,
  id: string,
  updates: Partial<T>
): TimetableState {
  const list = state[entityType];
  if (!Array.isArray(list)) {
    throw new Error(`${entityType} 不是数组`);
  }

  const index = list.findIndex((item: any) => item.id === id);
  if (index === -1) {
    throw new Error(`实体 ${id} 不存在于 ${entityType}`);
  }

  const updated = [...list];
  updated[index] = { ...updated[index], ...updates };

  return {
    ...state,
    [entityType]: updated,
  };
}

// 删除实体
export function removeEntity(
  state: TimetableState,
  entityType: keyof TimetableState,
  id: string
): TimetableState {
  const list = state[entityType];
  if (!Array.isArray(list)) {
    throw new Error(`${entityType} 不是数组`);
  }

  const index = list.findIndex((item: any) => item.id === id);
  if (index === -1) {
    throw new Error(`实体 ${id} 不存在于 ${entityType}`);
  }

  return {
    ...state,
    [entityType]: list.filter((item: any) => item.id !== id),
  };
}

// 查找实体
export function findEntity<T extends { id: string }>(
  state: TimetableState,
  entityType: keyof TimetableState,
  id: string
): T | undefined {
  const list = state[entityType];
  if (!Array.isArray(list)) {
    return undefined;
  }
  return list.find((item: any) => item.id === id) as T | undefined;
}
