/**
 * 排课系统核心实体类型定义
 * 基于《排课系统构建规格 v0.1》§1
 */

// 基础类型
export type EntityId = string;
export type SlotId = `D${number}P${number}`;
export type RoomType = "general" | "physics" | "chemistry" | "biology" | "computer" | "art" | "music" | string;

// 教师
export interface Teacher {
  id: EntityId;
  name: string;
  grade?: 1 | 2 | 3;  // 主要任教年级
  can_teach: EntityId[];  // 能教的课程ID列表
  available_slots: SlotId[];  // 可排时段，默认全部50槽
  max_per_day: number;  // 每天上限，默认8
  max_per_week: number;  // 每周上限，默认30
  homeroom_class_id?: EntityId;  // 是否班主任（行政班ID）
}

// 课程
export interface Course {
  id: EntityId;
  name: string;
  type: "required" | "ap";  // 必修 / AP选修
  required_room_type?: RoomType;  // AP课指定学科教室类型
  weekly_hours: number;  // 默认周课时
  prefer_morning?: boolean;  // 主课优先上午（软约束）
  consecutive?: { min: number; max: number };  // 连堂需求
}

// 教室
export interface Room {
  id: EntityId;
  name: string;
  type: RoomType;
  capacity: number;
  owner_class_id?: EntityId;  // 固定归属（行政班/教学班的固定教室）
}

// 学生
export interface Student {
  id: EntityId;
  name: string;
  grade: 1 | 2 | 3;
  admin_class_id: EntityId;  // 行政班ID
  teaching_class_id: EntityId;  // 教学班ID
}

// 行政班（固定学生分组）
export interface AdminClass {
  id: EntityId;
  name: string;
  grade: 1 | 2 | 3;
  fixed_room_id: EntityId;  // 固定教室
  student_ids: EntityId[];  // 学生ID列表
}

// 教学班（固定学生分组，非按AP）
export interface TeachingClass {
  id: EntityId;
  name: string;
  grade: 1 | 2 | 3;
  fixed_room_id: EntityId;
  student_ids: EntityId[];
}

// 教师分工（必修课数据入口）
export interface TeachingAssignment {
  id: EntityId;
  teacher_id: EntityId;
  course_id: EntityId;
  class_id: EntityId;
  class_type: "admin" | "teaching";
  weekly_hours: number;
}

// AP选课数据（分班引擎输入）
export interface ApSelection {
  student_id: EntityId;
  course_ids: EntityId[];  // 该生选的AP课程ID列表
}

// AP分班结果（分班引擎产出）
export interface ApSection {
  id: EntityId;
  course_id: EntityId;
  teacher_id: EntityId;
  student_ids: EntityId[];
  room_type: RoomType;
  capacity: number;
}

// 教学任务（排课单位）
export interface TeachingTask {
  id: EntityId;
  source: "required" | "ap";
  course_id: EntityId;
  teacher_id: EntityId;
  student_ids: EntityId[];
  weekly_hours: number;
  room_policy: "pinned" | "assign";
  room_id?: EntityId;  // pinned时固定
  source_class_id?: EntityId;  // 必修来源班
  source_section_id?: EntityId;  // AP来源
}

// 时段
export interface TimeSlot {
  id: SlotId;
  day: 1 | 2 | 3 | 4 | 5;
  period: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10;
  session: "AM" | "PM";
  is_walk_block: boolean;
}

// 约束类型
export type ConstraintType =
  | "forbidden_slot"
  | "avoid_slot"
  | "prefer_morning"
  | "consecutive"
  | "teacher_max_per_day"
  | "spread_balance"
  | "teacher_mutual_exclusive"
  | "require_slot"
  | "research_activity_block";

// 约束
export interface Constraint {
  id: EntityId;
  type: ConstraintType;
  scope: "teacher" | "course" | "class" | "student" | "task" | "global";
  target_id?: EntityId;
  params: Record<string, unknown>;
  weight?: number;  // 软约束权重，默认1
  hard: boolean;  // true=硬约束，false=软约束
}

// 排课结果
export interface Assignment {
  task_id: EntityId;
  slot_id: SlotId;
  room_id: EntityId;
}

// 锁定（排课不改动）
export interface Lock {
  task_id: EntityId;
  slot_id: SlotId;
}

// 硬违反
export interface HardViolation {
  constraint_id: EntityId;
  type: ConstraintType;
  task_ids: EntityId[];
  slot?: SlotId;
  reason: string;
}

// 系统配置
export interface TimetableConfig {
  time_model: {
    days: number;  // 默认5
    periods_per_day: number;  // 默认10
    lunch_break_after_period: number;  // 默认5（第5节课后午休）
  };
  walk_blocks: SlotId[];  // 走班时段列表
}

// 项目元数据
export interface ProjectMeta {
  school: string;
  created_at: string;
  updated_at: string;
}

// 完整状态（单一事实源）
export interface TimetableState {
  version: string;
  meta: ProjectMeta;
  config: TimetableConfig;
  teachers: Teacher[];
  rooms: Room[];
  courses: Course[];
  students: Student[];
  admin_classes: AdminClass[];
  teaching_classes: TeachingClass[];
  teaching_assignments: TeachingAssignment[];
  ap_selections: ApSelection[];
  constraints: Constraint[];
  ap_sections: ApSection[] | null;
  teaching_tasks: TeachingTask[] | null;
  assignments: Assignment[] | null;
  locks: Lock[];
}

// CLI JSON输出信封
export interface CliResponse<T = unknown> {
  ok: boolean;
  data: T | null;
  errors: Array<{ code: string; msg: string; refs?: string[] }> | null;
  warnings: Array<{ code: string; msg: string }> | null;
}
