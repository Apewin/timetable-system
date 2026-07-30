/**
 * 各实体的命令配置
 */
import type { EntityConfig } from "./entity.js";
import type { Teacher, Room, Course, Student, AdminClass, TeachingClass, TeachingAssignment, ApSelection, Constraint } from "@timetable/core";

// 解析逗号分隔的列表
function parseList(value: unknown): string[] {
  if (typeof value !== "string") return [];
  return value.split(",").map(s => s.trim()).filter(Boolean);
}

// 解析数字
function parseNumber(value: unknown, defaultVal?: number): number {
  const num = Number(value);
  return isNaN(num) ? (defaultVal ?? 0) : num;
}

// 解析布尔值
function parseBool(value: unknown): boolean {
  if (value === "true" || value === true) return true;
  if (value === "false" || value === false) return false;
  return false;
}

// Teacher 配置
export const teacherConfig: EntityConfig<Teacher> = {
  name: "teacher",
  displayName: "教师",
  stateKey: "teachers",
  parseArgs: (args) => ({
    id: String(args.id || ""),
    name: String(args.name || ""),
    grade: args.grade ? Number(args.grade) as 1 | 2 | 3 : undefined,
    can_teach: parseList(args.canTeach),
    available_slots: parseList(args.availableSlots) as any[],
    max_per_day: parseNumber(args.maxPerDay, 8),
    max_per_week: parseNumber(args.maxPerWeek, 30),
    homeroom_class_id: args.homeroom ? String(args.homeroom) : undefined,
  }),
  getDisplayFields: (t) => ({
    "ID": t.id,
    "姓名": t.name,
    "年级": t.grade ? String(t.grade) : "-",
    "可教课程": t.can_teach.join(","),
    "日上限": String(t.max_per_day),
    "周上限": String(t.max_per_week),
    "班主任": t.homeroom_class_id || "-",
  }),
};

// Room 配置
export const roomConfig: EntityConfig<Room> = {
  name: "room",
  displayName: "教室",
  stateKey: "rooms",
  parseArgs: (args) => ({
    id: String(args.id || ""),
    name: String(args.name || ""),
    type: String(args.type || "general"),
    capacity: parseNumber(args.capacity, 30),
    owner_class_id: args.owner ? String(args.owner) : undefined,
  }),
  getDisplayFields: (r) => ({
    "ID": r.id,
    "名称": r.name,
    "类型": r.type,
    "容量": String(r.capacity),
    "归属班级": r.owner_class_id || "-",
  }),
};

// Course 配置
export const courseConfig: EntityConfig<Course> = {
  name: "course",
  displayName: "课程",
  stateKey: "courses",
  parseArgs: (args) => ({
    id: String(args.id || ""),
    name: String(args.name || ""),
    type: (args.type as "required" | "ap") || "required",
    required_room_type: args.requiredRoomType ? String(args.requiredRoomType) : undefined,
    weekly_hours: parseNumber(args.weeklyHours, 4),
    prefer_morning: parseBool(args.preferMorning),
    consecutive: args.consecutiveMin && args.consecutiveMax
      ? { min: parseNumber(args.consecutiveMin), max: parseNumber(args.consecutiveMax) }
      : undefined,
  }),
  getDisplayFields: (c) => ({
    "ID": c.id,
    "名称": c.name,
    "类型": c.type === "ap" ? "AP选修" : "必修",
    "周课时": String(c.weekly_hours),
    "教室类型": c.required_room_type || "-",
    "优先上午": c.prefer_morning ? "是" : "-",
    "连堂": c.consecutive ? `${c.consecutive.min}-${c.consecutive.max}` : "-",
  }),
};

// Student 配置
export const studentConfig: EntityConfig<Student> = {
  name: "student",
  displayName: "学生",
  stateKey: "students",
  parseArgs: (args) => ({
    id: String(args.id || ""),
    name: String(args.name || ""),
    grade: Number(args.grade) as 1 | 2 | 3,
    admin_class_id: String(args.adminClass || ""),
    teaching_class_id: String(args.teachingClass || ""),
  }),
  getDisplayFields: (s) => ({
    "ID": s.id,
    "姓名": s.name,
    "年级": String(s.grade),
    "行政班": s.admin_class_id,
    "教学班": s.teaching_class_id,
  }),
};

// AdminClass 配置
export const adminClassConfig: EntityConfig<AdminClass> = {
  name: "admin-class",
  displayName: "行政班",
  stateKey: "admin_classes",
  parseArgs: (args) => ({
    id: String(args.id || ""),
    name: String(args.name || ""),
    grade: Number(args.grade) as 1 | 2 | 3,
    fixed_room_id: String(args.fixedRoom || ""),
    student_ids: parseList(args.students),
  }),
  getDisplayFields: (c) => ({
    "ID": c.id,
    "名称": c.name,
    "年级": String(c.grade),
    "固定教室": c.fixed_room_id,
    "学生数": String(c.student_ids.length),
  }),
};

// TeachingClass 配置
export const teachingClassConfig: EntityConfig<TeachingClass> = {
  name: "teaching-class",
  displayName: "教学班",
  stateKey: "teaching_classes",
  parseArgs: (args) => ({
    id: String(args.id || ""),
    name: String(args.name || ""),
    grade: Number(args.grade) as 1 | 2 | 3,
    fixed_room_id: String(args.fixedRoom || ""),
    student_ids: parseList(args.students),
  }),
  getDisplayFields: (c) => ({
    "ID": c.id,
    "名称": c.name,
    "年级": String(c.grade),
    "固定教室": c.fixed_room_id,
    "学生数": String(c.student_ids.length),
  }),
};

// TeachingAssignment 配置
export const teachingAssignmentConfig: EntityConfig<TeachingAssignment> = {
  name: "teaching-assignment",
  displayName: "教师分工",
  stateKey: "teaching_assignments",
  parseArgs: (args) => ({
    id: String(args.id || ""),
    teacher_id: String(args.teacher || ""),
    course_id: String(args.course || ""),
    class_id: String(args.class || ""),
    class_type: (args.classType as "admin" | "teaching") || "admin",
    weekly_hours: parseNumber(args.hours, 4),
  }),
  getDisplayFields: (a) => ({
    "ID": a.id,
    "教师": a.teacher_id,
    "课程": a.course_id,
    "班级": a.class_id || (a.class_ids || []).join(", "),
    "班级类型": a.class_type === "admin" ? "行政班" : "教学班",
    "周课时": String(a.weekly_hours),
  }),
};

// ApSelection 配置
export const apSelectionConfig: EntityConfig<ApSelection> = {
  name: "ap-selection",
  displayName: "AP选课",
  stateKey: "ap_selections",
  parseArgs: (args) => ({
    student_id: String(args.student || ""),
    course_ids: parseList(args.courses),
  }),
  getDisplayFields: (s) => ({
    "学生ID": s.student_id,
    "选修课程": s.course_ids.join(","),
  }),
};

// Constraint 配置
export const constraintConfig: EntityConfig<Constraint> = {
  name: "constraint",
  displayName: "约束",
  stateKey: "constraints",
  parseArgs: (args) => {
    let params = {};
    try {
      params = args.params ? JSON.parse(String(args.params)) : {};
    } catch {
      throw new Error("params 必须是有效的 JSON");
    }
    return {
      id: String(args.id || ""),
      type: String(args.type || "") as any,
      scope: String(args.scope || "global") as any,
      target_id: args.target ? String(args.target) : undefined,
      params,
      weight: args.weight ? parseNumber(args.weight) : undefined,
      hard: parseBool(args.hard),
    };
  },
  getDisplayFields: (c) => ({
    "ID": c.id,
    "类型": c.type,
    "范围": c.scope,
    "目标": c.target_id || "-",
    "硬/软": c.hard ? "硬" : "软",
    "权重": c.weight ? String(c.weight) : "-",
  }),
};
