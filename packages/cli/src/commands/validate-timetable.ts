/**
 * 验证排课结果命令
 */
import { defineCommand } from "citty";
import chalk from "chalk";
import { readState, projectExists } from "@timetable/core";
import type { TimetableState, HardViolation, SlotId } from "@timetable/core";

function jsonOutput(data: unknown, ok = true, errors: unknown[] = []) {
  console.log(JSON.stringify({ ok, data, errors, warnings: [] }, null, 2));
}

// 检查硬约束（复用solver中的逻辑）
function checkHardConstraints(state: TimetableState): HardViolation[] {
  const violations: HardViolation[] = [];
  const tasks = state.teaching_tasks || [];
  const assignments = state.assignments || [];
  const taskMap = new Map(tasks.map(t => [t.id, t]));

  // H1: 老师不重叠
  const teacherSlotMap = new Map<string, Map<string, string[]>>();
  assignments.forEach(a => {
    const task = taskMap.get(a.task_id);
    if (!task) return;
    if (!teacherSlotMap.has(task.teacher_id)) teacherSlotMap.set(task.teacher_id, new Map());
    const slotMap = teacherSlotMap.get(task.teacher_id)!;
    if (!slotMap.has(a.slot_id)) slotMap.set(a.slot_id, []);
    slotMap.get(a.slot_id)!.push(a.task_id);
  });
  teacherSlotMap.forEach((slotMap, teacherId) => {
    slotMap.forEach((taskIds, slotId) => {
      if (taskIds.length > 1) {
        violations.push({ constraint_id: "H1", type: "forbidden_slot", task_ids: taskIds, slot: slotId as SlotId, reason: `教师 ${teacherId} 在时段 ${slotId} 有 ${taskIds.length} 节课冲突` });
      }
    });
  });

  // H2: 学生不重叠
  const studentSlotMap = new Map<string, Map<string, string[]>>();
  assignments.forEach(a => {
    const task = taskMap.get(a.task_id);
    if (!task) return;
    task.student_ids.forEach(studentId => {
      if (!studentSlotMap.has(studentId)) studentSlotMap.set(studentId, new Map());
      const slotMap = studentSlotMap.get(studentId)!;
      if (!slotMap.has(a.slot_id)) slotMap.set(a.slot_id, []);
      slotMap.get(a.slot_id)!.push(a.task_id);
    });
  });
  studentSlotMap.forEach((slotMap, studentId) => {
    slotMap.forEach((taskIds, slotId) => {
      if (taskIds.length > 1) {
        violations.push({ constraint_id: "H2", type: "forbidden_slot", task_ids: [...new Set(taskIds)], slot: slotId as SlotId, reason: `学生 ${studentId} 在时段 ${slotId} 有 ${taskIds.length} 节课冲突` });
      }
    });
  });

  // H3: 教室不重叠
  const roomSlotMap = new Map<string, Map<string, string[]>>();
  assignments.forEach(a => {
    if (!roomSlotMap.has(a.room_id)) roomSlotMap.set(a.room_id, new Map());
    const slotMap = roomSlotMap.get(a.room_id)!;
    if (!slotMap.has(a.slot_id)) slotMap.set(a.slot_id, []);
    slotMap.get(a.slot_id)!.push(a.task_id);
  });
  roomSlotMap.forEach((slotMap, roomId) => {
    slotMap.forEach((taskIds, slotId) => {
      if (taskIds.length > 1) {
        violations.push({ constraint_id: "H3", type: "forbidden_slot", task_ids: taskIds, slot: slotId as SlotId, reason: `教室 ${roomId} 在时段 ${slotId} 有 ${taskIds.length} 节课冲突` });
      }
    });
  });

  // H4: 教室容量
  assignments.forEach(a => {
    const task = taskMap.get(a.task_id);
    const room = state.rooms.find(r => r.id === a.room_id);
    if (task && room && task.student_ids.length > room.capacity) {
      violations.push({ constraint_id: "H4", type: "forbidden_slot", task_ids: [a.task_id], slot: a.slot_id, reason: `任务 ${a.task_id} 学生数(${task.student_ids.length})超过教室容量(${room.capacity})` });
    }
  });

  // H5: 课时排满
  tasks.forEach(task => {
    const taskAssignments = assignments.filter(a => a.task_id === task.id);
    if (taskAssignments.length !== task.weekly_hours) {
      violations.push({ constraint_id: "H5", type: "forbidden_slot", task_ids: [task.id], reason: `任务 ${task.id} 应排 ${task.weekly_hours} 节，实际 ${taskAssignments.length} 节` });
    }
  });

  // H7: 教室类型匹配
  assignments.forEach(a => {
    const task = taskMap.get(a.task_id);
    const room = state.rooms.find(r => r.id === a.room_id);
    const course = task ? state.courses.find(c => c.id === task.course_id) : undefined;
    if (task && room && course?.required_room_type && room.type !== course.required_room_type) {
      violations.push({ constraint_id: "H7", type: "forbidden_slot", task_ids: [a.task_id], slot: a.slot_id, reason: `任务 ${a.task_id} 教室类型不匹配: 需要 ${course.required_room_type}，实际 ${room.type}` });
    }
  });

  // H8: 教师日上限
  const teacherDayCount = new Map<string, Map<number, number>>();
  assignments.forEach(a => {
    const task = taskMap.get(a.task_id);
    if (!task) return;
    const day = parseInt(a.slot_id.substring(1, 2));
    if (!teacherDayCount.has(task.teacher_id)) teacherDayCount.set(task.teacher_id, new Map());
    const dayMap = teacherDayCount.get(task.teacher_id)!;
    dayMap.set(day, (dayMap.get(day) || 0) + 1);
  });
  teacherDayCount.forEach((dayMap, teacherId) => {
    const teacher = state.teachers.find(t => t.id === teacherId);
    const maxPerDay = teacher?.max_per_day || 8;
    dayMap.forEach((count, day) => {
      if (count > maxPerDay) {
        violations.push({ constraint_id: "H8", type: "teacher_max_per_day", task_ids: [], reason: `教师 ${teacherId} 第 ${day} 天排了 ${count} 节，超过上限 ${maxPerDay}` });
      }
    });
  });

  return violations;
}

export const validate = defineCommand({
  meta: { name: "validate", description: "验证排课结果" },
  args: {
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
        if (args.json) jsonOutput({ legal: true, hard_violations: [], soft_score: 0 });
        else console.log(chalk.yellow("没有排课结果，请先运行 solve timetable"));
        process.exit(0);
      }

      const violations = checkHardConstraints(state);
      const legal = violations.length === 0;

      if (args.json) {
        jsonOutput({ legal, hard_violations: violations, soft_score: 0 });
      } else {
        if (legal) {
          console.log(chalk.green("✓ 课表合法，无硬约束违规"));
        } else {
          console.log(chalk.red(`✗ 课表存在 ${violations.length} 条硬约束违规`));
          violations.forEach(v => console.log(`  - [${v.constraint_id}] ${v.reason}`));
        }
      }

      process.exit(legal ? 0 : 1);
    } catch (error: any) {
      if (args.json) jsonOutput(null, false, [{ code: "VALIDATE_ERROR", msg: error.message }]);
      else console.error(chalk.red(`错误: ${error.message}`));
      process.exit(10);
    }
  },
});
