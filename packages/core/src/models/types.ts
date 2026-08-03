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
  grade?: number | number[];  // 适用年级；数组表示允许跨年级选课/混班
  applicable_class_ids?: EntityId[];  // 高二分层必修课适用的教学班；未设置表示全部
  delivery_class_type_by_grade?: Partial<Record<10 | 11 | 12, "admin" | "teaching">>;  // 固定班课程按年级使用行政班或教学班上课
  type: "required" | "required_elective" | "ap" | "other";  // 必修 / 必修选修课 / AP选修 / 其他（班会社团自习等）
  required_room_type?: RoomType;  // AP课指定学科教室类型
  weekly_hours: number;  // 默认周课时
  prefer_morning?: boolean;  // 主课优先上午（软约束）
  consecutive?: { min: number; max: number };  // 连堂需求
  elective_group?: "A" | "B" | "C";  // 必修选修课的组别
  // 平行班数量。跨年级且允许混班的课程可按年级记录多个需求，实际开班数取最大值。
  section_count?: number | number[];
  // 当不同年级不能混班，或同一门课需指定任课教师时，显式拆成独立开班要求。
  section_requirements?: Array<{
    grades: number[];
    count: number;
    teacher_id?: EntityId;
  }>;
  no_teacher?: boolean;  // 是否不需要教师（班会、社团、自习等）
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
  english_name?: string;  // 英文名，用于辅助区分中文重名学生
  pinyin_name?: string;  // 姓名拼音，供名单导入与搜索使用
  grade: 1 | 2 | 3;
  admin_class_id: EntityId;  // 行政班ID
  teaching_class_id: EntityId;  // 教学班ID
  elective_choices?: {  // 必修选修课选择
    group_a?: EntityId;  // A组选择的课程ID
    group_b?: EntityId;  // B组选择的课程ID
    group_c?: EntityId;  // C组选择的课程ID
  };
  ap_courses?: EntityId[];  // AP选课列表
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
  // 旧导入格式为单个 class_id；当前教务数据可用 class_ids 一次列出
  // 多个平行班。排课前必须展开为每班一个独立教学任务。
  class_id?: EntityId;
  class_ids?: EntityId[];
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
  source: "required" | "required_elective" | "ap" | "other";  // 必修 / 必修选修 / AP选修 / 其他
  course_id: EntityId;
  teacher_id: EntityId | null;  // null表示无教师（班会、社团等）
  student_ids: EntityId[];
  weekly_hours: number;
  room_policy: "pinned" | "assign";
  room_id?: EntityId;  // pinned时固定
  source_class_id?: EntityId;  // 必修来源班（行政班/教学班）
  source_section_id?: EntityId;  // AP来源
  target_teaching_classes?: EntityId[];  // 分层教学：仅指定教学班上
  elective_group?: "A" | "B" | "C";  // 必修选修课的组别
  section_index?: number;  // 平行班索引（第几个平行班）
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
