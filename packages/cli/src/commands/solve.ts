/**
 * 求解命令
 */
import { defineCommand } from "citty";
import chalk from "chalk";
import { readState, writeState, projectExists } from "@timetable/core";
import { solveSections } from "@timetable/core/solver/sectioning.js";
import { solveTimetable } from "@timetable/core/solver/timetable.js";

function jsonOutput(data: unknown, ok = true, errors: unknown[] = []) {
  console.log(JSON.stringify({ ok, data, errors, warnings: [] }, null, 2));
}

export const solveSectionsCmd = defineCommand({
  meta: { name: "sections", description: "执行AP分班" },
  args: {
    json: { type: "boolean", description: "JSON格式输出", default: false },
    seed: { type: "string", description: "随机种子" },
    candidates: { type: "string", description: "候选方案数量", default: "1" },
  },
  run({ args }) {
    try {
      const projectPath = process.cwd();
      if (!projectExists(projectPath)) {
        if (args.json) jsonOutput(null, false, [{ code: "NO_PROJECT", msg: "项目不存在，请先运行 tt init" }]);
        else console.error(chalk.red("错误: 项目不存在，请先运行 tt init"));
        process.exit(3);
      }

      const state = readState(projectPath);

      if (state.ap_selections.length === 0) {
        if (args.json) jsonOutput(null, false, [{ code: "NO_DATA", msg: "没有AP选课数据，请先添加 ap-selection" }]);
        else console.error(chalk.red("错误: 没有AP选课数据，请先添加 ap-selection"));
        process.exit(2);
      }

      const result = solveSections(state, {
        seed: args.seed ? Number(args.seed) : undefined,
        candidates: Number(args.candidates) || 1,
      });

      // 更新状态
      const newState = {
        ...state,
        ap_sections: result.ap_sections,
        teaching_tasks: [
          ...(state.teaching_tasks?.filter(t => t.source === "required") || []),
          ...result.teaching_tasks,
        ],
      };
      writeState(projectPath, newState);

      if (args.json) {
        jsonOutput({
          ap_sections: result.ap_sections,
          color_number: result.color_number,
          walk_slot_count: result.walk_slot_count,
          overflow_expected: result.overflow_expected,
          tasks_generated: result.teaching_tasks.length,
        });
      } else {
        console.log(chalk.green("✓ AP分班完成"));
        console.log(`  生成 ${result.ap_sections.length} 个AP教学班`);
        console.log(`  冲突图色数: ${result.color_number}`);
        console.log(`  走班时段数: ${result.walk_slot_count}`);
        console.log(`  预计溢出: ${result.overflow_expected ? "是" : "否"}`);

        if (result.overflow_expected) {
          console.log(chalk.yellow("\n⚠ 警告: 冲突图色数超过走班时段数，部分AP课可能需要排到普通时段"));
        }
      }

      process.exit(result.overflow_expected ? 1 : 0);
    } catch (error: any) {
      if (args.json) jsonOutput(null, false, [{ code: "SOLVE_ERROR", msg: error.message }]);
      else console.error(chalk.red(`错误: ${error.message}`));
      process.exit(10);
    }
  },
});

export const solveTimetableCmd = defineCommand({
  meta: { name: "timetable", description: "执行排课" },
  args: {
    json: { type: "boolean", description: "JSON格式输出", default: false },
    timeout: { type: "string", description: "超时时间（毫秒）", default: "5000" },
    seed: { type: "string", description: "随机种子" },
    keep: { type: "boolean", description: "保留现有排课（仅排未锁定部分）" },
    respectLocks: { type: "boolean", description: "尊重锁定", default: true },
  },
  run({ args }) {
    try {
      const projectPath = process.cwd();
      if (!projectExists(projectPath)) {
        if (args.json) jsonOutput(null, false, [{ code: "NO_PROJECT", msg: "项目不存在，请先运行 tt init" }]);
        else console.error(chalk.red("错误: 项目不存在，请先运行 tt init"));
        process.exit(3);
      }

      const state = readState(projectPath);

      if (!state.teaching_tasks || state.teaching_tasks.length === 0) {
        if (args.json) jsonOutput(null, false, [{ code: "NO_TASKS", msg: "没有教学任务，请先运行 build-tasks 或 solve sections" }]);
        else console.error(chalk.red("错误: 没有教学任务，请先运行 build-tasks 或 solve sections"));
        process.exit(2);
      }

      const result = solveTimetable(state, {
        timeout: Number(args.timeout) || 5000,
        seed: args.seed ? Number(args.seed) : undefined,
        keep: args.keep,
        respectLocks: args.respectLocks,
      });

      // 更新状态
      const newState = { ...state, assignments: result.assignments };
      writeState(projectPath, newState);

      if (args.json) {
        jsonOutput({
          ok: result.ok,
          hard_violations: result.hard_violations,
          soft_score: result.soft_score,
          assignments_count: result.assignments.length,
        });
      } else {
        if (result.ok) {
          console.log(chalk.green("✓ 排课完成"));
        } else {
          console.log(chalk.yellow("⚠ 排课完成，但存在硬约束违规"));
        }
        console.log(`  分配数: ${result.assignments.length}`);
        console.log(`  硬约束违规: ${result.hard_violations.length}`);
        console.log(`  软约束得分: ${result.soft_score}`);

        if (result.hard_violations.length > 0) {
          console.log(chalk.yellow("\n硬约束违规:"));
          result.hard_violations.slice(0, 10).forEach(v => {
            console.log(`  - ${v.reason}`);
          });
          if (result.hard_violations.length > 10) {
            console.log(`  ... 还有 ${result.hard_violations.length - 10} 条违规`);
          }
        }
      }

      process.exit(result.ok ? 0 : 1);
    } catch (error: any) {
      if (args.json) jsonOutput(null, false, [{ code: "SOLVE_ERROR", msg: error.message }]);
      else console.error(chalk.red(`错误: ${error.message}`));
      process.exit(10);
    }
  },
});

export const solveCmd = defineCommand({
  meta: { name: "solve", description: "执行求解（两阶段）" },
  args: {
    json: { type: "boolean", description: "JSON格式输出", default: false },
    seed: { type: "string", description: "随机种子" },
    timeout: { type: "string", description: "排课超时时间（毫秒）", default: "5000" },
  },
  run({ args }) {
    try {
      const projectPath = process.cwd();
      if (!projectExists(projectPath)) {
        if (args.json) jsonOutput(null, false, [{ code: "NO_PROJECT", msg: "项目不存在，请先运行 tt init" }]);
        else console.error(chalk.red("错误: 项目不存在，请先运行 tt init"));
        process.exit(3);
      }

      const state = readState(projectPath);

      // 第一阶段：分班
      let sectionResult = null;
      if (state.ap_selections.length > 0) {
        sectionResult = solveSections(state, {
          seed: args.seed ? Number(args.seed) : undefined,
        });

        // 更新状态
        state.ap_sections = sectionResult.ap_sections;
        state.teaching_tasks = [
          ...(state.teaching_tasks?.filter(t => t.source === "required") || []),
          ...sectionResult.teaching_tasks,
        ];
      }

      // 第二阶段：排课
      if (!state.teaching_tasks || state.teaching_tasks.length === 0) {
        if (args.json) jsonOutput(null, false, [{ code: "NO_TASKS", msg: "没有教学任务" }]);
        else console.error(chalk.red("错误: 没有教学任务"));
        process.exit(2);
      }

      const timetableResult = solveTimetable(state, {
        timeout: Number(args.timeout) || 5000,
        seed: args.seed ? Number(args.seed) : undefined,
      });

      // 更新状态
      state.assignments = timetableResult.assignments;
      writeState(projectPath, state);

      if (args.json) {
        jsonOutput({
          sections: sectionResult ? {
            ap_sections: sectionResult.ap_sections.length,
            color_number: sectionResult.color_number,
            walk_slot_count: sectionResult.walk_slot_count,
            overflow_expected: sectionResult.overflow_expected,
          } : null,
          timetable: {
            ok: timetableResult.ok,
            hard_violations: timetableResult.hard_violations,
            soft_score: timetableResult.soft_score,
            assignments_count: timetableResult.assignments.length,
          },
        });
      } else {
        console.log(chalk.bold("求解结果"));
        if (sectionResult) {
          console.log(chalk.green("\n✓ AP分班完成"));
          console.log(`  AP教学班: ${sectionResult.ap_sections.length}`);
          console.log(`  冲突图色数: ${sectionResult.color_number}`);
          console.log(`  走班时段数: ${sectionResult.walk_slot_count}`);
        }

        console.log(timetableResult.ok
          ? chalk.green("\n✓ 排课完成")
          : chalk.yellow("\n⚠ 排课完成，但存在硬约束违规")
        );
        console.log(`  分配数: ${timetableResult.assignments.length}`);
        console.log(`  硬约束违规: ${timetableResult.hard_violations.length}`);
        console.log(`  软约束得分: ${timetableResult.soft_score}`);

        if (timetableResult.hard_violations.length > 0) {
          console.log(chalk.yellow("\n硬约束违规:"));
          timetableResult.hard_violations.slice(0, 5).forEach(v => {
            console.log(`  - ${v.reason}`);
          });
        }
      }

      process.exit(timetableResult.ok ? 0 : 1);
    } catch (error: any) {
      if (args.json) jsonOutput(null, false, [{ code: "SOLVE_ERROR", msg: error.message }]);
      else console.error(chalk.red(`错误: ${error.message}`));
      process.exit(10);
    }
  },
});
