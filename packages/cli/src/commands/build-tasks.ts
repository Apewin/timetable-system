/**
 * 生成教学任务命令
 */
import { defineCommand } from "citty";
import chalk from "chalk";
import { readState, writeState, projectExists } from "@timetable/core";
import type { TimetableState, TeachingTask } from "@timetable/core";

function jsonOutput(data: unknown, ok = true, errors: unknown[] = []) {
  console.log(JSON.stringify({ ok, data, errors, warnings: [] }, null, 2));
}

// 从教师分工生成必修教学任务
function generateRequiredTasks(state: TimetableState): TeachingTask[] {
  const tasks: TeachingTask[] = [];

  state.teaching_assignments.forEach((assignment, index) => {
    // 获取班级学生名单
    let studentIds: string[] = [];
    let roomId: string | undefined;

    if (assignment.class_type === "admin") {
      const adminClass = state.admin_classes.find(c => c.id === assignment.class_id);
      if (adminClass) {
        studentIds = adminClass.student_ids;
        roomId = adminClass.fixed_room_id;
      }
    } else {
      const teachingClass = state.teaching_classes.find(c => c.id === assignment.class_id);
      if (teachingClass) {
        studentIds = teachingClass.student_ids;
        roomId = teachingClass.fixed_room_id;
      }
    }

    const task: TeachingTask = {
      id: `TASK_REQ_${assignment.id}`,
      source: "required",
      course_id: assignment.course_id,
      teacher_id: assignment.teacher_id,
      student_ids: studentIds,
      weekly_hours: assignment.weekly_hours,
      room_policy: "pinned",
      room_id: roomId,
      source_class_id: assignment.class_id,
    };

    tasks.push(task);
  });

  return tasks;
}

export const buildTasks = defineCommand({
  meta: { name: "build-tasks", description: "从教师分工生成必修教学任务" },
  args: {
    json: { type: "boolean", description: "JSON格式输出", default: false },
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

      // 检查是否有教师分工数据
      if (state.teaching_assignments.length === 0) {
        if (args.json) jsonOutput(null, false, [{ code: "NO_DATA", msg: "没有教师分工数据，请先添加 teaching-assignment" }]);
        else console.error(chalk.red("错误: 没有教师分工数据，请先添加 teaching-assignment"));
        process.exit(2);
      }

      // 生成必修教学任务
      const requiredTasks = generateRequiredTasks(state);

      // 合并现有任务（如果有AP任务则保留）
      const existingApTasks = state.teaching_tasks?.filter(t => t.source === "ap") || [];
      const allTasks = [...requiredTasks, ...existingApTasks];

      // 更新状态
      const newState = { ...state, teaching_tasks: allTasks };
      writeState(projectPath, newState);

      if (args.json) {
        jsonOutput({
          tasks_generated: requiredTasks.length,
          total_tasks: allTasks.length,
          tasks: requiredTasks,
        });
      } else {
        console.log(chalk.green(`✓ 已生成 ${requiredTasks.length} 个必修教学任务`));
        console.log(`  总任务数: ${allTasks.length}`);
        requiredTasks.forEach(t => {
          console.log(`  - ${t.id}: ${t.course_id} (${t.teacher_id}) → ${t.student_ids.length} 学生`);
        });
      }

      process.exit(0);
    } catch (error: any) {
      if (args.json) jsonOutput(null, false, [{ code: "BUILD_ERROR", msg: error.message }]);
      else console.error(chalk.red(`错误: ${error.message}`));
      process.exit(10);
    }
  },
});
