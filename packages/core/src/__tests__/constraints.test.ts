/**
 * 约束单测
 */
import { describe, it, expect } from "vitest";
import { checkHardConstraints, calculateSoftScore } from "../solver/timetable.js";
import type { TimetableState, TeachingTask, Assignment, SlotId } from "../models/types.js";

// 创建测试用的空状态
function createTestState(): TimetableState {
  return {
    version: "0.1",
    meta: { school: "测试学校", created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
    config: {
      time_model: { days: 5, periods_per_day: 10, lunch_break_after_period: 5 },
      walk_blocks: ["D1P6", "D1P7", "D3P6", "D3P7", "D5P6", "D5P7"] as SlotId[],
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

describe("硬约束检查", () => {
  it("H1: 老师不重叠 - 无冲突时无违规", () => {
    const state = createTestState();
    state.teachers = [{ id: "T1", name: "张伟", can_teach: [], available_slots: [], max_per_day: 8, max_per_week: 30 }];
    state.courses = [{ id: "MATH", name: "数学", type: "required", weekly_hours: 2 }];

    const tasks: TeachingTask[] = [
      { id: "TASK1", source: "required", course_id: "MATH", teacher_id: "T1", student_ids: ["S1"], weekly_hours: 2, room_policy: "pinned", room_id: "R1" },
    ];

    const assignments: Assignment[] = [
      { task_id: "TASK1", slot_id: "D1P1" as SlotId, room_id: "R1" },
      { task_id: "TASK1", slot_id: "D1P2" as SlotId, room_id: "R1" },
    ];

    const violations = checkHardConstraints(state, assignments, tasks);
    expect(violations.filter(v => v.constraint_id === "H1")).toHaveLength(0);
  });

  it("H1: 老师不重叠 - 同时段有冲突时有违规", () => {
    const state = createTestState();
    state.teachers = [{ id: "T1", name: "张伟", can_teach: [], available_slots: [], max_per_day: 8, max_per_week: 30 }];
    state.courses = [
      { id: "MATH", name: "数学", type: "required", weekly_hours: 1 },
      { id: "PHYS", name: "物理", type: "required", weekly_hours: 1 },
    ];

    const tasks: TeachingTask[] = [
      { id: "TASK1", source: "required", course_id: "MATH", teacher_id: "T1", student_ids: ["S1"], weekly_hours: 1, room_policy: "pinned", room_id: "R1" },
      { id: "TASK2", source: "required", course_id: "PHYS", teacher_id: "T1", student_ids: ["S2"], weekly_hours: 1, room_policy: "pinned", room_id: "R2" },
    ];

    const assignments: Assignment[] = [
      { task_id: "TASK1", slot_id: "D1P1" as SlotId, room_id: "R1" },
      { task_id: "TASK2", slot_id: "D1P1" as SlotId, room_id: "R2" },
    ];

    const violations = checkHardConstraints(state, assignments, tasks);
    expect(violations.filter(v => v.constraint_id === "H1")).toHaveLength(1);
  });

  it("H2: 学生不重叠 - 无冲突时无违规", () => {
    const state = createTestState();
    state.students = [
      { id: "S1", name: "李明", grade: 1, admin_class_id: "AC1", teaching_class_id: "TC1" },
      { id: "S2", name: "王磊", grade: 1, admin_class_id: "AC1", teaching_class_id: "TC1" },
    ];
    state.courses = [
      { id: "MATH", name: "数学", type: "required", weekly_hours: 1 },
      { id: "PHYS", name: "物理", type: "required", weekly_hours: 1 },
    ];

    const tasks: TeachingTask[] = [
      { id: "TASK1", source: "required", course_id: "MATH", teacher_id: "T1", student_ids: ["S1"], weekly_hours: 1, room_policy: "pinned", room_id: "R1" },
      { id: "TASK2", source: "required", course_id: "PHYS", teacher_id: "T2", student_ids: ["S2"], weekly_hours: 1, room_policy: "pinned", room_id: "R2" },
    ];

    const assignments: Assignment[] = [
      { task_id: "TASK1", slot_id: "D1P1" as SlotId, room_id: "R1" },
      { task_id: "TASK2", slot_id: "D1P1" as SlotId, room_id: "R2" },
    ];

    const violations = checkHardConstraints(state, assignments, tasks);
    expect(violations.filter(v => v.constraint_id === "H2")).toHaveLength(0);
  });

  it("H2: 学生不重叠 - 同学生同时段有冲突时有违规", () => {
    const state = createTestState();
    state.students = [
      { id: "S1", name: "李明", grade: 1, admin_class_id: "AC1", teaching_class_id: "TC1" },
    ];
    state.courses = [
      { id: "MATH", name: "数学", type: "required", weekly_hours: 1 },
      { id: "PHYS", name: "物理", type: "required", weekly_hours: 1 },
    ];

    const tasks: TeachingTask[] = [
      { id: "TASK1", source: "required", course_id: "MATH", teacher_id: "T1", student_ids: ["S1"], weekly_hours: 1, room_policy: "pinned", room_id: "R1" },
      { id: "TASK2", source: "required", course_id: "PHYS", teacher_id: "T2", student_ids: ["S1"], weekly_hours: 1, room_policy: "pinned", room_id: "R2" },
    ];

    const assignments: Assignment[] = [
      { task_id: "TASK1", slot_id: "D1P1" as SlotId, room_id: "R1" },
      { task_id: "TASK2", slot_id: "D1P1" as SlotId, room_id: "R2" },
    ];

    const violations = checkHardConstraints(state, assignments, tasks);
    expect(violations.filter(v => v.constraint_id === "H2")).toHaveLength(1);
  });

  it("H3: 教室不重叠 - 无冲突时无违规", () => {
    const state = createTestState();
    state.rooms = [
      { id: "R1", name: "教室1", type: "general", capacity: 30 },
      { id: "R2", name: "教室2", type: "general", capacity: 30 },
    ];

    const tasks: TeachingTask[] = [
      { id: "TASK1", source: "required", course_id: "MATH", teacher_id: "T1", student_ids: ["S1"], weekly_hours: 1, room_policy: "pinned", room_id: "R1" },
      { id: "TASK2", source: "required", course_id: "PHYS", teacher_id: "T2", student_ids: ["S2"], weekly_hours: 1, room_policy: "pinned", room_id: "R2" },
    ];

    const assignments: Assignment[] = [
      { task_id: "TASK1", slot_id: "D1P1" as SlotId, room_id: "R1" },
      { task_id: "TASK2", slot_id: "D1P1" as SlotId, room_id: "R2" },
    ];

    const violations = checkHardConstraints(state, assignments, tasks);
    expect(violations.filter(v => v.constraint_id === "H3")).toHaveLength(0);
  });

  it("H3: 教室不重叠 - 同教室同时段有冲突时有违规", () => {
    const state = createTestState();
    state.rooms = [
      { id: "R1", name: "教室1", type: "general", capacity: 30 },
    ];

    const tasks: TeachingTask[] = [
      { id: "TASK1", source: "required", course_id: "MATH", teacher_id: "T1", student_ids: ["S1"], weekly_hours: 1, room_policy: "pinned", room_id: "R1" },
      { id: "TASK2", source: "required", course_id: "PHYS", teacher_id: "T2", student_ids: ["S2"], weekly_hours: 1, room_policy: "pinned", room_id: "R1" },
    ];

    const assignments: Assignment[] = [
      { task_id: "TASK1", slot_id: "D1P1" as SlotId, room_id: "R1" },
      { task_id: "TASK2", slot_id: "D1P1" as SlotId, room_id: "R1" },
    ];

    const violations = checkHardConstraints(state, assignments, tasks);
    expect(violations.filter(v => v.constraint_id === "H3")).toHaveLength(1);
  });

  it("H4: 教室容量 - 学生数不超过容量时无违规", () => {
    const state = createTestState();
    state.rooms = [{ id: "R1", name: "教室1", type: "general", capacity: 30 }];
    state.students = Array.from({ length: 20 }, (_, i) => ({
      id: `S${i + 1}`,
      name: `学生${i + 1}`,
      grade: 1 as const,
      admin_class_id: "AC1",
      teaching_class_id: "TC1",
    }));

    const tasks: TeachingTask[] = [
      { id: "TASK1", source: "required", course_id: "MATH", teacher_id: "T1", student_ids: state.students.map(s => s.id), weekly_hours: 1, room_policy: "pinned", room_id: "R1" },
    ];

    const assignments: Assignment[] = [
      { task_id: "TASK1", slot_id: "D1P1" as SlotId, room_id: "R1" },
    ];

    const violations = checkHardConstraints(state, assignments, tasks);
    expect(violations.filter(v => v.constraint_id === "H4")).toHaveLength(0);
  });

  it("H4: 教室容量 - 学生数超过容量时有违规", () => {
    const state = createTestState();
    state.rooms = [{ id: "R1", name: "教室1", type: "general", capacity: 30 }];
    state.students = Array.from({ length: 40 }, (_, i) => ({
      id: `S${i + 1}`,
      name: `学生${i + 1}`,
      grade: 1 as const,
      admin_class_id: "AC1",
      teaching_class_id: "TC1",
    }));

    const tasks: TeachingTask[] = [
      { id: "TASK1", source: "required", course_id: "MATH", teacher_id: "T1", student_ids: state.students.map(s => s.id), weekly_hours: 1, room_policy: "pinned", room_id: "R1" },
    ];

    const assignments: Assignment[] = [
      { task_id: "TASK1", slot_id: "D1P1" as SlotId, room_id: "R1" },
    ];

    const violations = checkHardConstraints(state, assignments, tasks);
    expect(violations.filter(v => v.constraint_id === "H4")).toHaveLength(1);
  });

  it("H5: 课时排满 - 排满时无违规", () => {
    const state = createTestState();
    state.rooms = [{ id: "R1", name: "教室1", type: "general", capacity: 30 }];

    const tasks: TeachingTask[] = [
      { id: "TASK1", source: "required", course_id: "MATH", teacher_id: "T1", student_ids: ["S1"], weekly_hours: 2, room_policy: "pinned", room_id: "R1" },
    ];

    const assignments: Assignment[] = [
      { task_id: "TASK1", slot_id: "D1P1" as SlotId, room_id: "R1" },
      { task_id: "TASK1", slot_id: "D1P2" as SlotId, room_id: "R1" },
    ];

    const violations = checkHardConstraints(state, assignments, tasks);
    expect(violations.filter(v => v.constraint_id === "H5")).toHaveLength(0);
  });

  it("H5: 课时排满 - 未排满时有违规", () => {
    const state = createTestState();
    state.rooms = [{ id: "R1", name: "教室1", type: "general", capacity: 30 }];

    const tasks: TeachingTask[] = [
      { id: "TASK1", source: "required", course_id: "MATH", teacher_id: "T1", student_ids: ["S1"], weekly_hours: 4, room_policy: "pinned", room_id: "R1" },
    ];

    const assignments: Assignment[] = [
      { task_id: "TASK1", slot_id: "D1P1" as SlotId, room_id: "R1" },
      { task_id: "TASK1", slot_id: "D1P2" as SlotId, room_id: "R1" },
    ];

    const violations = checkHardConstraints(state, assignments, tasks);
    expect(violations.filter(v => v.constraint_id === "H5")).toHaveLength(1);
  });
});
