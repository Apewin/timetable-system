/**
 * 排课引擎
 * 实现模拟退火算法，满足硬约束H1-H8，优化软约束S1/S2/S3/S5
 */
import type {
  TimetableState,
  TeachingTask,
  Assignment,
  TimeSlot,
  SlotId,
  HardViolation,
  Room,
} from "../models/types.js";

// 排课结果
export interface TimetableResult {
  assignments: Assignment[];
  hard_violations: HardViolation[];
  soft_score: number;
  ok: boolean;
}

// Occurrence（任务的一个课时）
interface Occurrence {
  taskId: string;
  index: number;  // 第几个课时
}

// 生成所有时段
function generateTimeSlots(config: TimetableState["config"]): TimeSlot[] {
  const slots: TimeSlot[] = [];
  for (let day = 1; day <= config.time_model.days; day++) {
    for (let period = 1; period <= config.time_model.periods_per_day; period++) {
      const id = `D${day}P${period}` as SlotId;
      const session: "AM" | "PM" = period <= config.time_model.lunch_break_after_period ? "AM" : "PM";
      const is_walk_block = config.walk_blocks.includes(id);

      slots.push({ id, day: day as 1|2|3|4|5, period: period as 1|2|3|4|5|6|7|8|9|10, session, is_walk_block });
    }
  }
  return slots;
}

// 将任务拆分成多个occurrence
function splitTasksToOccurrences(tasks: TeachingTask[]): Occurrence[] {
  const occurrences: Occurrence[] = [];
  tasks.forEach(task => {
    for (let i = 0; i < task.weekly_hours; i++) {
      occurrences.push({ taskId: task.id, index: i });
    }
  });
  return occurrences;
}

// 检查硬约束
export function checkHardConstraints(
  state: TimetableState,
  assignments: Assignment[],
  tasks: TeachingTask[]
): HardViolation[] {
  const violations: HardViolation[] = [];

  // 构建查找索引
  const taskMap = new Map(tasks.map(t => [t.id, t]));
  const assignmentBySlot = new Map<string, Assignment[]>();
  const assignmentByTask = new Map<string, Assignment[]>();

  assignments.forEach(a => {
    // 按slot分组
    if (!assignmentBySlot.has(a.slot_id)) {
      assignmentBySlot.set(a.slot_id, []);
    }
    assignmentBySlot.get(a.slot_id)!.push(a);

    // 按task分组
    if (!assignmentByTask.has(a.task_id)) {
      assignmentByTask.set(a.task_id, []);
    }
    assignmentByTask.get(a.task_id)!.push(a);
  });

  // H1: 老师不重叠 - 同老师同时段只一课（跳过无教师课程）
  const teacherSlotMap = new Map<string, Map<string, string[]>>();
  assignments.forEach(a => {
    const task = taskMap.get(a.task_id);
    if (!task || !task.teacher_id) return;  // 跳过无教师课程

    if (!teacherSlotMap.has(task.teacher_id)) {
      teacherSlotMap.set(task.teacher_id, new Map());
    }
    const slotMap = teacherSlotMap.get(task.teacher_id)!;
    if (!slotMap.has(a.slot_id)) {
      slotMap.set(a.slot_id, []);
    }
    slotMap.get(a.slot_id)!.push(a.task_id);
  });

  teacherSlotMap.forEach((slotMap, teacherId) => {
    slotMap.forEach((taskIds, slotId) => {
      if (taskIds.length > 1) {
        violations.push({
          constraint_id: "H1",
          type: "forbidden_slot",
          task_ids: taskIds,
          slot: slotId as SlotId,
          reason: `教师 ${teacherId} 在时段 ${slotId} 有 ${taskIds.length} 节课冲突`,
        });
      }
    });
  });

  // H2: 学生不重叠 - 同学生同时段只一任务
  const studentSlotMap = new Map<string, Map<string, string[]>>();
  assignments.forEach(a => {
    const task = taskMap.get(a.task_id);
    if (!task) return;

    task.student_ids.forEach(studentId => {
      if (!studentSlotMap.has(studentId)) {
        studentSlotMap.set(studentId, new Map());
      }
      const slotMap = studentSlotMap.get(studentId)!;
      if (!slotMap.has(a.slot_id)) {
        slotMap.set(a.slot_id, []);
      }
      slotMap.get(a.slot_id)!.push(a.task_id);
    });
  });

  studentSlotMap.forEach((slotMap, studentId) => {
    slotMap.forEach((taskIds, slotId) => {
      if (taskIds.length > 1) {
        violations.push({
          constraint_id: "H2",
          type: "forbidden_slot",
          task_ids: [...new Set(taskIds)],
          slot: slotId as SlotId,
          reason: `学生 ${studentId} 在时段 ${slotId} 有 ${taskIds.length} 节课冲突`,
        });
      }
    });
  });

  // H3: 教室不重叠 - 同教室同时段只一课
  const roomSlotMap = new Map<string, Map<string, string[]>>();
  assignments.forEach(a => {
    if (!roomSlotMap.has(a.room_id)) {
      roomSlotMap.set(a.room_id, new Map());
    }
    const slotMap = roomSlotMap.get(a.room_id)!;
    if (!slotMap.has(a.slot_id)) {
      slotMap.set(a.slot_id, []);
    }
    slotMap.get(a.slot_id)!.push(a.task_id);
  });

  roomSlotMap.forEach((slotMap, roomId) => {
    slotMap.forEach((taskIds, slotId) => {
      if (taskIds.length > 1) {
        violations.push({
          constraint_id: "H3",
          type: "forbidden_slot",
          task_ids: taskIds,
          slot: slotId as SlotId,
          reason: `教室 ${roomId} 在时段 ${slotId} 有 ${taskIds.length} 节课冲突`,
        });
      }
    });
  });

  // H4: 教室容量
  assignments.forEach(a => {
    const task = taskMap.get(a.task_id);
    const room = state.rooms.find(r => r.id === a.room_id);
    if (task && room && task.student_ids.length > room.capacity) {
      violations.push({
        constraint_id: "H4",
        type: "forbidden_slot",
        task_ids: [a.task_id],
        slot: a.slot_id,
        reason: `任务 ${a.task_id} 学生数(${task.student_ids.length})超过教室 ${room.id} 容量(${room.capacity})`,
      });
    }
  });

  // H5: 课时排满 - 每个task的assignment数 = weekly_hours
  tasks.forEach(task => {
    const taskAssignments = assignmentByTask.get(task.id) || [];
    if (taskAssignments.length !== task.weekly_hours) {
      violations.push({
        constraint_id: "H5",
        type: "forbidden_slot",
        task_ids: [task.id],
        reason: `任务 ${task.id} 应排 ${task.weekly_hours} 节，实际排了 ${taskAssignments.length} 节`,
      });
    }
  });

  // H6: 禁排 forbidden_slot
  state.constraints
    .filter(c => c.type === "forbidden_slot" && c.hard)
    .forEach(constraint => {
      const forbiddenSlots = (constraint.params.slots || []) as SlotId[];
      const targetTasks = constraint.scope === "task"
        ? [constraint.target_id]
        : constraint.scope === "teacher"
          ? tasks.filter(t => t.teacher_id === constraint.target_id).map(t => t.id)
          : constraint.scope === "course"
            ? tasks.filter(t => t.course_id === constraint.target_id).map(t => t.id)
            : [];

      targetTasks.forEach(taskId => {
        if (!taskId) return;
        const taskAssignments = assignmentByTask.get(taskId) || [];
        taskAssignments.forEach(a => {
          if (forbiddenSlots.includes(a.slot_id)) {
            violations.push({
              constraint_id: constraint.id,
              type: "forbidden_slot",
              task_ids: [taskId],
              slot: a.slot_id,
              reason: `任务 ${taskId} 被安排在禁排时段 ${a.slot_id}`,
            });
          }
        });
      });
    });

  // H7: 教室类型匹配
  assignments.forEach(a => {
    const task = taskMap.get(a.task_id);
    const room = state.rooms.find(r => r.id === a.room_id);
    const course = task ? state.courses.find(c => c.id === task.course_id) : undefined;

    if (task && room && course?.required_room_type && room.type !== course.required_room_type) {
      violations.push({
        constraint_id: "H7",
        type: "forbidden_slot",
        task_ids: [a.task_id],
        slot: a.slot_id,
        reason: `任务 ${a.task_id} 教室类型不匹配: 需要 ${course.required_room_type}，实际 ${room.type}`,
      });
    }
  });

  // H8: 教师日上限（跳过无教师课程）
  const teacherDayCount = new Map<string, Map<number, number>>();
  assignments.forEach(a => {
    const task = taskMap.get(a.task_id);
    if (!task || !task.teacher_id) return;  // 跳过无教师课程

    const day = parseInt(a.slot_id.substring(1, 2));
    if (!teacherDayCount.has(task.teacher_id)) {
      teacherDayCount.set(task.teacher_id, new Map());
    }
    const dayMap = teacherDayCount.get(task.teacher_id)!;
    dayMap.set(day, (dayMap.get(day) || 0) + 1);
  });

  teacherDayCount.forEach((dayMap, teacherId) => {
    const teacher = state.teachers.find(t => t.id === teacherId);
    const maxPerDay = teacher?.max_per_day || 8;

    dayMap.forEach((count, day) => {
      if (count > maxPerDay) {
        violations.push({
          constraint_id: "H8",
          type: "teacher_max_per_day",
          task_ids: tasks.filter(t => t.teacher_id === teacherId).map(t => t.id),
          reason: `教师 ${teacherId} 在第 ${day} 天排了 ${count} 节课，超过上限 ${maxPerDay}`,
        });
      }
    });
  });

  return violations;
}

// 计算软约束得分
export function calculateSoftScore(
  state: TimetableState,
  assignments: Assignment[],
  tasks: TeachingTask[]
): number {
  let score = 0;
  const taskMap = new Map(tasks.map(t => [t.id, t]));

  // S1: 优先排上午 (权重5)
  state.courses
    .filter(c => c.prefer_morning)
    .forEach(course => {
      const courseTasks = tasks.filter(t => t.course_id === course.id);
      courseTasks.forEach(task => {
        const taskAssignments = assignments.filter(a => a.task_id === task.id);
        taskAssignments.forEach(a => {
          if (a.slot_id.includes("P6") || a.slot_id.includes("P7") ||
              a.slot_id.includes("P8") || a.slot_id.includes("P9") || a.slot_id.includes("P10")) {
            score += 5;
          }
        });
      });
    });

  // S2: 连堂 (权重8)
  state.courses
    .filter(c => c.consecutive)
    .forEach(course => {
      const courseTasks = tasks.filter(t => t.course_id === course.id);
      courseTasks.forEach(task => {
        const taskAssignments = assignments
          .filter(a => a.task_id === task.id)
          .sort((a, b) => a.slot_id.localeCompare(b.slot_id));

        // 检查是否形成连续块
        for (let i = 0; i < taskAssignments.length - 1; i++) {
          const current = taskAssignments[i];
          const next = taskAssignments[i + 1];
          const currentDay = parseInt(current.slot_id.substring(1, 2));
          const currentPeriod = parseInt(current.slot_id.substring(3));
          const nextDay = parseInt(next.slot_id.substring(1, 2));
          const nextPeriod = parseInt(next.slot_id.substring(3));

          if (currentDay !== nextDay || nextPeriod !== currentPeriod + 1) {
            score += 8; // 不连续，罚分
          }
        }
      });
    });

  // S3: AP落走班时段 (权重10)
  tasks
    .filter(t => t.source === "ap")
    .forEach(task => {
      const taskAssignments = assignments.filter(a => a.task_id === task.id);
      taskAssignments.forEach(a => {
        if (!state.config.walk_blocks.includes(a.slot_id)) {
          score += 10; // AP课不在走班时段，罚分
        }
      });
    });

  // S5: 课表分散均衡 (权重3)
  const courseDayCount = new Map<string, Map<number, number>>();
  assignments.forEach(a => {
    const task = taskMap.get(a.task_id);
    if (!task) return;

    if (!courseDayCount.has(task.course_id)) {
      courseDayCount.set(task.course_id, new Map());
    }
    const dayMap = courseDayCount.get(task.course_id)!;
    const day = parseInt(a.slot_id.substring(1, 2));
    dayMap.set(day, (dayMap.get(day) || 0) + 1);
  });

  courseDayCount.forEach((dayMap, courseId) => {
    // 同课同日>1次，罚分
    dayMap.forEach((count) => {
      if (count > 1) {
        score += 3 * (count - 1);
      }
    });
  });

  return score;
}

// 贪心初始解
function greedyInitialSolution(
  state: TimetableState,
  tasks: TeachingTask[],
  slots: TimeSlot[],
  lockedAssignments: Assignment[]
): Assignment[] {
  const assignments: Assignment[] = [...lockedAssignments];
  const lockedTaskSlots = new Set(lockedAssignments.map(a => `${a.task_id}:${a.slot_id}`));
  const lockedSlotRooms = new Map<string, string>();
  lockedAssignments.forEach(a => lockedSlotRooms.set(`${a.slot_id}`, a.room_id));

  // 按约束强度排序任务（AP/连堂/禁排多的先排）
  const taskPriority = tasks.map(task => {
    let priority = 0;
    const teacher = state.teachers.find(item => item.id === task.teacher_id);
    // 教务排课优先级：实验教师课程先安排，再处理 AP/连堂等一般约束。
    if (task.teacher_id?.startsWith("T_EXP_") || /实验教师/.test(teacher?.name || "")) priority += 1000;
    if (task.source === "ap") priority += 10;
    const course = state.courses.find(c => c.id === task.course_id);
    if (course?.consecutive) priority += 5;
    const forbiddenCount = state.constraints.filter(
      c => c.type === "forbidden_slot" &&
      ((c.scope === "task" && c.target_id === task.id) ||
       (c.scope === "teacher" && c.target_id === task.teacher_id) ||
       (c.scope === "course" && c.target_id === task.course_id))
    ).length;
    priority += forbiddenCount * 2;
    return { task, priority };
  }).sort((a, b) => b.priority - a.priority);

  // 逐任务分配
  taskPriority.forEach(({ task }) => {
    // 跳过已锁定的任务
    if (lockedAssignments.some(a => a.task_id === task.id)) return;

    const course = state.courses.find(c => c.id === task.course_id);
    let remaining = task.weekly_hours - (assignments.filter(a => a.task_id === task.id).length);

    for (let i = 0; i < remaining; i++) {
      // 找最早可用的slot
      let assigned = false;
      for (const slot of slots) {
        if (lockedTaskSlots.has(`${task.id}:${slot.id}`)) continue;

        // 检查该时段老师是否已有课（跳过无教师课程）
        const teacherBusy = task.teacher_id ? assignments.some(a => {
          const otherTask = tasks.find(t => t.id === a.task_id);
          return otherTask?.teacher_id && otherTask.teacher_id === task.teacher_id && a.slot_id === slot.id;
        }) : false;
        if (teacherBusy) continue;

        // 检查该时段学生是否冲突
        const studentConflict = task.student_ids.some(studentId =>
          assignments.some(a => {
            const otherTask = tasks.find(t => t.id === a.task_id);
            return otherTask?.student_ids.includes(studentId) && a.slot_id === slot.id;
          })
        );
        if (studentConflict) continue;

        // 找可用教室
        let roomId: string | undefined;
        if (task.room_policy === "pinned") {
          roomId = task.room_id;
        } else {
          // 找同类型可用教室
          const availableRooms = state.rooms.filter(r => {
            if (task.room_policy === "assign" && course?.required_room_type && r.type !== course.required_room_type) {
              return false;
            }
            // 检查教室是否在该时段已被占用
            return !assignments.some(a => a.slot_id === slot.id && a.room_id === r.id);
          });
          if (availableRooms.length > 0) {
            roomId = availableRooms[0].id;
          }
        }

        if (roomId) {
          // 检查教室容量
          const room = state.rooms.find(r => r.id === roomId);
          if (room && task.student_ids.length <= room.capacity) {
            assignments.push({
              task_id: task.id,
              slot_id: slot.id,
              room_id: roomId,
            });
            assigned = true;
            break;
          }
        }
      }

      if (!assigned) {
        // 无法找到无冲突的slot，强制放到第一个可用slot（会产生违规）
        const firstAvailable = slots.find(s => !lockedTaskSlots.has(`${task.id}:${s.id}`));
        if (firstAvailable) {
          const roomId = task.room_id || state.rooms[0]?.id || "UNKNOWN";
          assignments.push({
            task_id: task.id,
            slot_id: firstAvailable.id,
            room_id: roomId,
          });
        }
      }
    }
  });

  return assignments;
}

// 模拟退火优化
function simulatedAnnealing(
  state: TimetableState,
  tasks: TeachingTask[],
  slots: TimeSlot[],
  initialAssignments: Assignment[],
  options: { timeout?: number; seed?: number; respectLocks?: boolean } = {}
): Assignment[] {
  const timeout = options.timeout || 5000; // 默认5秒
  const seed = options.seed || Date.now();
  const respectLocks = options.respectLocks !== false;

  let current = [...initialAssignments];
  let best = [...current];
  let bestScore = evaluateSolution(state, current, tasks);

  let temperature = 1000;
  const coolingRate = 0.9995;
  const startTime = Date.now();

  // 伪随机数生成器
  let rng = seed;
  const random = () => {
    rng = (rng * 1664525 + 1013904223) % 4294967296;
    return rng / 4294967296;
  };

  let iterations = 0;
  const maxIterations = 100000;

  while (iterations < maxIterations && Date.now() - startTime < timeout) {
    temperature *= coolingRate;
    iterations++;

    // 随机选择邻域操作
    const operation = Math.floor(random() * 3);

    if (operation === 0) {
      // 操作1：重assign一个occurrence到另一slot
      const idx = Math.floor(random() * current.length);
      const assignment = current[idx];

      // 跳过锁定的assignment
      if (respectLocks && state.locks.some(l => l.task_id === assignment.task_id && l.slot_id === assignment.slot_id)) {
        continue;
      }

      const task = tasks.find(t => t.id === assignment.task_id);
      if (!task) continue;

      const newSlot = slots[Math.floor(random() * slots.length)];

      // 检查新slot是否可行（跳过无教师课程）
      const teacherBusy = task.teacher_id ? current.some((a, i) => {
        if (i === idx) return false;
        const otherTask = tasks.find(t => t.id === a.task_id);
        return otherTask?.teacher_id && otherTask.teacher_id === task.teacher_id && a.slot_id === newSlot.id;
      }) : false;

      if (!teacherBusy) {
        const newAssignments = [...current];
        newAssignments[idx] = { ...assignment, slot_id: newSlot.id };

        const newScore = evaluateSolution(state, newAssignments, tasks);
        const delta = newScore - bestScore;

        if (delta < 0 || random() < Math.exp(-delta / temperature)) {
          current = newAssignments;
          if (newScore < bestScore) {
            best = newAssignments;
            bestScore = newScore;
          }
        }
      }
    } else if (operation === 1) {
      // 操作2：swap两occurrence的slot
      if (current.length < 2) continue;

      const idx1 = Math.floor(random() * current.length);
      let idx2 = Math.floor(random() * current.length);
      while (idx2 === idx1) idx2 = Math.floor(random() * current.length);

      const a1 = current[idx1];
      const a2 = current[idx2];

      // 跳过锁定的assignment
      if (respectLocks && (
        state.locks.some(l => l.task_id === a1.task_id && l.slot_id === a1.slot_id) ||
        state.locks.some(l => l.task_id === a2.task_id && l.slot_id === a2.slot_id)
      )) {
        continue;
      }

      const newAssignments = [...current];
      newAssignments[idx1] = { ...a1, slot_id: a2.slot_id };
      newAssignments[idx2] = { ...a2, slot_id: a1.slot_id };

      const newScore = evaluateSolution(state, newAssignments, tasks);
      const delta = newScore - bestScore;

      if (delta < 0 || random() < Math.exp(-delta / temperature)) {
        current = newAssignments;
        if (newScore < bestScore) {
          best = newAssignments;
          bestScore = newScore;
        }
      }
    } else {
      // 操作3：改assign任务的room
      const assignTasks = tasks.filter(t => t.room_policy === "assign");
      if (assignTasks.length === 0) continue;

      const task = assignTasks[Math.floor(random() * assignTasks.length)];
      const taskAssignments = current.filter(a => a.task_id === task.id);
      if (taskAssignments.length === 0) continue;

      const a = taskAssignments[Math.floor(random() * taskAssignments.length)];
      const idx = current.indexOf(a);

      // 跳过锁定的assignment
      if (respectLocks && state.locks.some(l => l.task_id === a.task_id && l.slot_id === a.slot_id)) {
        continue;
      }

      const course = state.courses.find(c => c.id === task.course_id);
      const availableRooms = state.rooms.filter(r => {
        if (course?.required_room_type && r.type !== course.required_room_type) return false;
        return !current.some((ca, i) => i !== idx && ca.slot_id === a.slot_id && ca.room_id === r.id);
      });

      if (availableRooms.length > 0) {
        const newRoom = availableRooms[Math.floor(random() * availableRooms.length)];
        const newAssignments = [...current];
        newAssignments[idx] = { ...a, room_id: newRoom.id };

        const newScore = evaluateSolution(state, newAssignments, tasks);
        const delta = newScore - bestScore;

        if (delta < 0 || random() < Math.exp(-delta / temperature)) {
          current = newAssignments;
          if (newScore < bestScore) {
            best = newAssignments;
            bestScore = newScore;
          }
        }
      }
    }
  }

  return best;
}

// 评估解的质量（硬约束违规 + 软约束得分）
function evaluateSolution(
  state: TimetableState,
  assignments: Assignment[],
  tasks: TeachingTask[]
): number {
  const M = 1000; // 大常数，使硬约束优先
  const hardViolations = checkHardConstraints(state, assignments, tasks);
  const softScore = calculateSoftScore(state, assignments, tasks);
  return M * hardViolations.length + softScore;
}

// 验证周课时总计是否为50节
export function validateWeeklyHours(
  state: TimetableState,
  tasks: TeachingTask[]
): { ok: boolean; errors: string[] } {
  const errors: string[] = [];
  const EXPECTED_HOURS = 50;

  // 按行政班统计
  state.admin_classes.forEach(ac => {
    const classTasks = tasks.filter(t =>
      t.source_class_id === ac.id ||
      t.student_ids.some(sId => ac.student_ids.includes(sId))
    );
    const totalHours = classTasks.reduce((sum, t) => sum + t.weekly_hours, 0);
    if (totalHours !== EXPECTED_HOURS) {
      errors.push(`行政班 ${ac.name} (${ac.id}) 周课时为 ${totalHours}，应为 ${EXPECTED_HOURS}`);
    }
  });

  // 按教学班统计
  state.teaching_classes.forEach(tc => {
    const classTasks = tasks.filter(t =>
      t.source_class_id === tc.id ||
      t.student_ids.some(sId => tc.student_ids.includes(sId))
    );
    const totalHours = classTasks.reduce((sum, t) => sum + t.weekly_hours, 0);
    if (totalHours !== EXPECTED_HOURS) {
      errors.push(`教学班 ${tc.name} (${tc.id}) 周课时为 ${totalHours}，应为 ${EXPECTED_HOURS}`);
    }
  });

  return { ok: errors.length === 0, errors };
}

// 主函数：执行排课
export function solveTimetable(
  state: TimetableState,
  options: {
    timeout?: number;
    seed?: number;
    keep?: boolean;
    respectLocks?: boolean;
  } = {}
): TimetableResult {
  const tasks = state.teaching_tasks;
  if (!tasks || tasks.length === 0) {
    throw new Error("没有教学任务，请先运行 build-tasks 或 solve sections");
  }

  // 验证周课时
  const hourValidation = validateWeeklyHours(state, tasks);
  if (!hourValidation.ok) {
    console.warn("周课时验证警告:", hourValidation.errors);
  }

  const slots = generateTimeSlots(state.config);

  // 处理锁定的assignments
  const lockedAssignments = options.keep && state.assignments
    ? state.assignments.filter(a =>
        state.locks.some(l => l.task_id === a.task_id && l.slot_id === a.slot_id)
      )
    : [];

  // 贪心初始解
  const initialAssignments = greedyInitialSolution(state, tasks, slots, lockedAssignments);

  // 模拟退火优化
  const optimizedAssignments = simulatedAnnealing(state, tasks, slots, initialAssignments, options);

  // 检查硬约束
  const hardViolations = checkHardConstraints(state, optimizedAssignments, tasks);
  const softScore = calculateSoftScore(state, optimizedAssignments, tasks);

  return {
    assignments: optimizedAssignments,
    hard_violations: hardViolations,
    soft_score: softScore,
    ok: hardViolations.length === 0,
  };
}
