/**
 * 教师分工相关命令
 */
import { defineCommand } from "citty";
import chalk from "chalk";
import Table from "cli-table3";
import { readState, writeState, addEntity, updateEntity, removeEntity, findEntity, projectExists } from "@timetable/core";
import type { TeachingAssignment } from "@timetable/core";

function jsonOutput(data: unknown, ok = true, errors: unknown[] = []) {
  console.log(JSON.stringify({ ok, data, errors, warnings: [] }, null, 2));
}

export const teachingAssignmentAdd = defineCommand({
  meta: { name: "add", description: "添加教师分工" },
  args: {
    id: { type: "string", description: "分工ID", required: true },
    teacher: { type: "string", description: "教师ID", required: true },
    course: { type: "string", description: "课程ID", required: true },
    class: { type: "string", description: "班级ID", required: true },
    classType: { type: "string", description: "班级类型（admin/teaching）", required: true },
    hours: { type: "string", description: "每周课时", required: true },
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
      const assignment: TeachingAssignment = {
        id: args.id,
        teacher_id: args.teacher,
        course_id: args.course,
        class_id: args.class,
        class_type: args.classType as "admin" | "teaching",
        weekly_hours: Number(args.hours),
      };

      const newState = addEntity(state, "teaching_assignments", assignment);
      writeState(projectPath, newState);

      if (args.json) jsonOutput(assignment);
      else {
        console.log(chalk.green("✓ 教师分工已添加"));
        console.log(`  ID: ${assignment.id}, 教师: ${assignment.teacher_id}, 课程: ${assignment.course_id}, 班级: ${assignment.class_id}`);
      }
      process.exit(0);
    } catch (error: any) {
      if (args.json) jsonOutput(null, false, [{ code: "ADD_ERROR", msg: error.message }]);
      else console.error(chalk.red(`错误: ${error.message}`));
      process.exit(10);
    }
  },
});

export const teachingAssignmentList = defineCommand({
  meta: { name: "list", description: "列出教师分工" },
  args: {
    json: { type: "boolean", description: "JSON格式输出", default: false },
    teacher: { type: "string", description: "按教师筛选" },
    course: { type: "string", description: "按课程筛选" },
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
      let list = state.teaching_assignments;
      if (args.teacher) list = list.filter(a => a.teacher_id === args.teacher);
      if (args.course) list = list.filter(a => a.course_id === args.course);

      if (args.json) jsonOutput(list);
      else {
        if (list.length === 0) { console.log(chalk.yellow("暂无教师分工")); return; }
        const table = new Table({ head: ["ID", "教师", "课程", "班级", "班级类型", "周课时"] });
        list.forEach(a => table.push([
          a.id, a.teacher_id, a.course_id, a.class_id,
          a.class_type === "admin" ? "行政班" : "教学班", a.weekly_hours
        ]));
        console.log(table.toString());
        console.log(`共 ${list.length} 条分工记录`);
      }
      process.exit(0);
    } catch (error: any) {
      if (args.json) jsonOutput(null, false, [{ code: "LIST_ERROR", msg: error.message }]);
      else console.error(chalk.red(`错误: ${error.message}`));
      process.exit(10);
    }
  },
});

export const teachingAssignmentEdit = defineCommand({
  meta: { name: "edit", description: "编辑教师分工" },
  args: {
    id: { type: "string", description: "分工ID", required: true },
    teacher: { type: "string", description: "教师ID" },
    course: { type: "string", description: "课程ID" },
    class: { type: "string", description: "班级ID" },
    classType: { type: "string", description: "班级类型" },
    hours: { type: "string", description: "周课时" },
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
      if (!findEntity(state, "teaching_assignments", args.id)) {
        if (args.json) jsonOutput(null, false, [{ code: "NOT_FOUND", msg: `分工 ${args.id} 不存在` }]);
        else console.error(chalk.red(`错误: 分工 ${args.id} 不存在`));
        process.exit(3);
      }

      const updates: Partial<TeachingAssignment> = {};
      if (args.teacher) updates.teacher_id = args.teacher;
      if (args.course) updates.course_id = args.course;
      if (args.class) updates.class_id = args.class;
      if (args.classType) updates.class_type = args.classType as "admin" | "teaching";
      if (args.hours) updates.weekly_hours = Number(args.hours);

      const newState = updateEntity(state, "teaching_assignments", args.id, updates);
      writeState(projectPath, newState);

      if (args.json) jsonOutput(findEntity(newState, "teaching_assignments", args.id));
      else console.log(chalk.green(`✓ 分工 ${args.id} 已更新`));
      process.exit(0);
    } catch (error: any) {
      if (args.json) jsonOutput(null, false, [{ code: "EDIT_ERROR", msg: error.message }]);
      else console.error(chalk.red(`错误: ${error.message}`));
      process.exit(10);
    }
  },
});

export const teachingAssignmentRm = defineCommand({
  meta: { name: "rm", description: "删除教师分工" },
  args: {
    id: { type: "string", description: "分工ID", required: true },
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
      if (!findEntity(state, "teaching_assignments", args.id)) {
        if (args.json) jsonOutput(null, false, [{ code: "NOT_FOUND", msg: `分工 ${args.id} 不存在` }]);
        else console.error(chalk.red(`错误: 分工 ${args.id} 不存在`));
        process.exit(3);
      }

      const newState = removeEntity(state, "teaching_assignments", args.id);
      writeState(projectPath, newState);

      if (args.json) jsonOutput({ removed: args.id });
      else console.log(chalk.green(`✓ 分工 ${args.id} 已删除`));
      process.exit(0);
    } catch (error: any) {
      if (args.json) jsonOutput(null, false, [{ code: "RM_ERROR", msg: error.message }]);
      else console.error(chalk.red(`错误: ${error.message}`));
      process.exit(10);
    }
  },
});
