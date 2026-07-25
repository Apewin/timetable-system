/**
 * 导出命令
 */
import { defineCommand } from "citty";
import chalk from "chalk";
import { readState, projectExists } from "@timetable/core";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

function jsonOutput(data: unknown, ok = true, errors: unknown[] = []) {
  console.log(JSON.stringify({ ok, data, errors, warnings: [] }, null, 2));
}

// 导出为CSV
function exportCsv(state: any, by: string): string {
  const tasks = state.teaching_tasks || [];
  const assignments = state.assignments || [];
  const lines: string[] = ["任务ID,课程,教师,学生数,时段,教室"];

  assignments.forEach((a: any) => {
    const task = tasks.find((t: any) => t.id === a.task_id);
    if (task) {
      const course = state.courses.find((c: any) => c.id === task.course_id);
      const teacher = state.teachers.find((t: any) => t.id === task.teacher_id);
      lines.push(`${task.id},${course?.name || ""},${teacher?.name || ""},${task.student_ids.length},${a.slot_id},${a.room_id}`);
    }
  });

  return lines.join("\n");
}

// 导出为HTML
function exportHtml(state: any, by: string): string {
  const tasks = state.teaching_tasks || [];
  const assignments = state.assignments || [];

  let html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>排课结果</title>
  <style>
    body { font-family: sans-serif; padding: 20px; }
    table { border-collapse: collapse; width: 100%; }
    th, td { border: 1px solid #ddd; padding: 8px; text-align: center; }
    th { background-color: #4CAF50; color: white; }
    tr:nth-child(even) { background-color: #f2f2f2; }
    .task { font-size: 12px; }
    .course { font-weight: bold; }
    .teacher { color: #666; }
    .room { color: #999; font-size: 11px; }
  </style>
</head>
<body>
  <h1>排课结果</h1>
  <table>
    <tr>
      <th>节次</th>
      <th>周一</th>
      <th>周二</th>
      <th>周三</th>
      <th>周四</th>
      <th>周五</th>
    </tr>`;

  for (let period = 1; period <= 10; period++) {
    html += `\n    <tr>\n      <td>${period}</td>`;
    for (let day = 1; day <= 5; day++) {
      const slotId = `D${day}P${period}`;
      const assignment = assignments.find((a: any) => a.slot_id === slotId);
      if (assignment) {
        const task = tasks.find((t: any) => t.id === assignment.task_id);
        const course = state.courses.find((c: any) => c.id === task?.course_id);
        const teacher = state.teachers.find((t: any) => t.id === task?.teacher_id);
        html += `\n      <td class="task">
          <div class="course">${course?.name || ""}</div>
          <div class="teacher">${teacher?.name || ""}</div>
          <div class="room">${assignment.room_id}</div>
        </td>`;
      } else {
        html += `\n      <td></td>`;
      }
    }
    html += `\n    </tr>`;
  }

  html += `
  </table>
</body>
</html>`;

  return html;
}

export const exportCmd = defineCommand({
  meta: { name: "export", description: "导出排课结果" },
  args: {
    format: { type: "string", description: "导出格式（csv/html）", required: true },
    by: { type: "string", description: "导出维度（student/teacher/class/room）" },
    output: { type: "string", description: "输出文件路径", required: true },
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

      if (!state.assignments || state.assignments.length === 0) {
        if (args.json) jsonOutput(null, false, [{ code: "NO_DATA", msg: "没有排课结果，请先运行 solve timetable" }]);
        else console.error(chalk.red("错误: 没有排课结果，请先运行 solve timetable"));
        process.exit(2);
      }

      let content = "";
      const outputPath = resolve(projectPath, args.output);

      switch (args.format) {
        case "csv":
          content = exportCsv(state, args.by || "all");
          break;
        case "html":
          content = exportHtml(state, args.by || "all");
          break;
        default:
          if (args.json) jsonOutput(null, false, [{ code: "INVALID_FORMAT", msg: "不支持的格式，请使用 csv 或 html" }]);
          else console.error(chalk.red("错误: 不支持的格式，请使用 csv 或 html"));
          process.exit(2);
      }

      writeFileSync(outputPath, content, "utf-8");

      if (args.json) jsonOutput({ path: outputPath });
      else {
        console.log(chalk.green("✓ 导出成功"));
        console.log(`  文件: ${outputPath}`);
      }
      process.exit(0);
    } catch (error: any) {
      if (args.json) jsonOutput(null, false, [{ code: "EXPORT_ERROR", msg: error.message }]);
      else console.error(chalk.red(`错误: ${error.message}`));
      process.exit(10);
    }
  },
});
