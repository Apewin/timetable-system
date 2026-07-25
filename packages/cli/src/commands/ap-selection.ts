/**
 * AP选课相关命令
 */
import { defineCommand } from "citty";
import chalk from "chalk";
import Table from "cli-table3";
import { readState, writeState, addEntity, removeEntity, findEntity, projectExists } from "@timetable/core";
import type { ApSelection } from "@timetable/core";

function jsonOutput(data: unknown, ok = true, errors: unknown[] = []) {
  console.log(JSON.stringify({ ok, data, errors, warnings: [] }, null, 2));
}

export const apSelectionAdd = defineCommand({
  meta: { name: "add", description: "添加AP选课" },
  args: {
    student: { type: "string", description: "学生ID", required: true },
    courses: { type: "string", description: "AP课程ID列表，逗号分隔", required: true },
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

      // 检查学生是否已存在选课记录
      const existing = state.ap_selections.find(s => s.student_id === args.student);
      if (existing) {
        if (args.json) jsonOutput(null, false, [{ code: "DUPLICATE", msg: `学生 ${args.student} 已有选课记录，请用 edit 修改` }]);
        else console.error(chalk.red(`错误: 学生 ${args.student} 已有选课记录，请用 edit 修改`));
        process.exit(2);
      }

      const selection: ApSelection = {
        student_id: args.student,
        course_ids: args.courses.split(",").map(s => s.trim()).filter(Boolean),
      };

      // 使用 addEntity 但 ApSelection 没有 id 字段，需要特殊处理
      const newState = {
        ...state,
        ap_selections: [...state.ap_selections, selection],
      };
      writeState(projectPath, newState);

      if (args.json) jsonOutput(selection);
      else {
        console.log(chalk.green("✓ AP选课已添加"));
        console.log(`  学生: ${selection.student_id}, 课程: ${selection.course_ids.join(", ")}`);
      }
      process.exit(0);
    } catch (error: any) {
      if (args.json) jsonOutput(null, false, [{ code: "ADD_ERROR", msg: error.message }]);
      else console.error(chalk.red(`错误: ${error.message}`));
      process.exit(10);
    }
  },
});

export const apSelectionList = defineCommand({
  meta: { name: "list", description: "列出AP选课" },
  args: {
    json: { type: "boolean", description: "JSON格式输出", default: false },
    student: { type: "string", description: "按学生筛选" },
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
      let list = state.ap_selections;
      if (args.student) list = list.filter(s => s.student_id === args.student);

      if (args.json) jsonOutput(list);
      else {
        if (list.length === 0) { console.log(chalk.yellow("暂无AP选课")); return; }
        const table = new Table({ head: ["学生ID", "选修课程"] });
        list.forEach(s => table.push([s.student_id, s.course_ids.join(",")]));
        console.log(table.toString());
        console.log(`共 ${list.length} 条选课记录`);
      }
      process.exit(0);
    } catch (error: any) {
      if (args.json) jsonOutput(null, false, [{ code: "LIST_ERROR", msg: error.message }]);
      else console.error(chalk.red(`错误: ${error.message}`));
      process.exit(10);
    }
  },
});

export const apSelectionEdit = defineCommand({
  meta: { name: "edit", description: "编辑AP选课" },
  args: {
    student: { type: "string", description: "学生ID", required: true },
    courses: { type: "string", description: "AP课程ID列表，逗号分隔", required: true },
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
      const index = state.ap_selections.findIndex(s => s.student_id === args.student);
      if (index === -1) {
        if (args.json) jsonOutput(null, false, [{ code: "NOT_FOUND", msg: `学生 ${args.student} 无选课记录` }]);
        else console.error(chalk.red(`错误: 学生 ${args.student} 无选课记录`));
        process.exit(3);
      }

      const updatedSelections = [...state.ap_selections];
      updatedSelections[index] = {
        student_id: args.student,
        course_ids: args.courses.split(",").map(s => s.trim()).filter(Boolean),
      };

      const newState = { ...state, ap_selections: updatedSelections };
      writeState(projectPath, newState);

      if (args.json) jsonOutput(updatedSelections[index]);
      else console.log(chalk.green(`✓ 学生 ${args.student} 的选课已更新`));
      process.exit(0);
    } catch (error: any) {
      if (args.json) jsonOutput(null, false, [{ code: "EDIT_ERROR", msg: error.message }]);
      else console.error(chalk.red(`错误: ${error.message}`));
      process.exit(10);
    }
  },
});

export const apSelectionRm = defineCommand({
  meta: { name: "rm", description: "删除AP选课" },
  args: {
    student: { type: "string", description: "学生ID", required: true },
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
      const index = state.ap_selections.findIndex(s => s.student_id === args.student);
      if (index === -1) {
        if (args.json) jsonOutput(null, false, [{ code: "NOT_FOUND", msg: `学生 ${args.student} 无选课记录` }]);
        else console.error(chalk.red(`错误: 学生 ${args.student} 无选课记录`));
        process.exit(3);
      }

      const newState = {
        ...state,
        ap_selections: state.ap_selections.filter(s => s.student_id !== args.student),
      };
      writeState(projectPath, newState);

      if (args.json) jsonOutput({ removed: args.student });
      else console.log(chalk.green(`✓ 学生 ${args.student} 的选课已删除`));
      process.exit(0);
    } catch (error: any) {
      if (args.json) jsonOutput(null, false, [{ code: "RM_ERROR", msg: error.message }]);
      else console.error(chalk.red(`错误: ${error.message}`));
      process.exit(10);
    }
  },
});
