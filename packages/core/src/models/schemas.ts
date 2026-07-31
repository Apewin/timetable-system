/**
 * 实体Zod Schema定义
 * 用于数据验证
 */
import { z } from "zod";

// 基础类型
export const entityIdSchema = z.string().min(1);
export const slotIdSchema = z.string().regex(/^D[1-5]P(10|[1-9])$/);
export const roomTypeSchema = z.string().min(1);

// 教师
export const teacherSchema = z.object({
  id: entityIdSchema,
  name: z.string().min(1),
  grade: z.union([z.literal(1), z.literal(2), z.literal(3)]).optional(),
  can_teach: z.array(entityIdSchema),
  available_slots: z.array(slotIdSchema),
  max_per_day: z.number().int().positive().default(8),
  max_per_week: z.number().int().positive().default(30),
  homeroom_class_id: entityIdSchema.optional(),
});

// 课程
export const courseSchema = z.object({
  id: entityIdSchema,
  name: z.string().min(1),
  grade: z.union([
    z.number().int().min(10).max(12),
    z.array(z.number().int().min(10).max(12)).min(1),
  ]).optional(),
  type: z.enum(["required", "required_elective", "ap", "other"]),
  required_room_type: roomTypeSchema.optional(),
  weekly_hours: z.number().int().positive(),
  prefer_morning: z.boolean().optional(),
  consecutive: z.object({
    min: z.number().int().positive(),
    max: z.number().int().positive(),
  }).optional(),
  elective_group: z.enum(["A", "B", "C"]).optional(),
  section_count: z.union([
    z.number().int().positive(),
    z.array(z.number().int().positive()).min(1),
  ]).optional(),
  section_requirements: z.array(z.object({
    grades: z.array(z.number().int().positive()).min(1),
    count: z.number().int().positive(),
    teacher_id: entityIdSchema.optional(),
  })).min(1).optional(),
  no_teacher: z.boolean().optional(),
});

// 教室
export const roomSchema = z.object({
  id: entityIdSchema,
  name: z.string().min(1),
  type: roomTypeSchema,
  capacity: z.number().int().positive(),
  owner_class_id: entityIdSchema.optional(),
});

// 学生
export const studentSchema = z.object({
  id: entityIdSchema,
  name: z.string().min(1),
  english_name: z.string().optional(),
  pinyin_name: z.string().optional(),
  grade: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  admin_class_id: entityIdSchema,
  teaching_class_id: entityIdSchema,
  elective_choices: z.object({
    group_a: entityIdSchema.optional(),
    group_b: entityIdSchema.optional(),
    group_c: entityIdSchema.optional(),
  }).optional(),
  ap_courses: z.array(entityIdSchema).optional(),
});

// 行政班
export const adminClassSchema = z.object({
  id: entityIdSchema,
  name: z.string().min(1),
  grade: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  fixed_room_id: entityIdSchema,
  student_ids: z.array(entityIdSchema),
});

// 教学班
export const teachingClassSchema = z.object({
  id: entityIdSchema,
  name: z.string().min(1),
  grade: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  fixed_room_id: entityIdSchema,
  student_ids: z.array(entityIdSchema),
});

// 教师分工
export const teachingAssignmentSchema = z.object({
  id: entityIdSchema,
  teacher_id: entityIdSchema,
  course_id: entityIdSchema,
  class_id: entityIdSchema.optional(),
  class_ids: z.array(entityIdSchema).min(1).optional(),
  class_type: z.enum(["admin", "teaching"]),
  weekly_hours: z.number().int().positive(),
}).refine(value => Boolean(value.class_id || value.class_ids?.length), {
  message: "教学分工必须指定 class_id 或 class_ids",
});

// AP选课
export const apSelectionSchema = z.object({
  student_id: entityIdSchema,
  course_ids: z.array(entityIdSchema),
});

// AP分班结果
export const apSectionSchema = z.object({
  id: entityIdSchema,
  course_id: entityIdSchema,
  teacher_id: entityIdSchema,
  student_ids: z.array(entityIdSchema),
  room_type: roomTypeSchema,
  capacity: z.number().int().positive(),
});

// 教学任务
export const teachingTaskSchema = z.object({
  id: entityIdSchema,
  source: z.enum(["required", "required_elective", "ap", "other"]),
  course_id: entityIdSchema,
  teacher_id: entityIdSchema.nullable(),  // null表示无教师
  student_ids: z.array(entityIdSchema),
  weekly_hours: z.number().int().positive(),
  room_policy: z.enum(["pinned", "assign"]),
  room_id: entityIdSchema.optional(),
  source_class_id: entityIdSchema.optional(),
  source_section_id: entityIdSchema.optional(),
  target_teaching_classes: z.array(entityIdSchema).optional(),
  elective_group: z.enum(["A", "B", "C"]).optional(),
  section_index: z.number().int().optional(),
});

// 时段
export const timeSlotSchema = z.object({
  id: slotIdSchema,
  day: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5)]),
  period: z.union([
    z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5),
    z.literal(6), z.literal(7), z.literal(8), z.literal(9), z.literal(10),
  ]),
  session: z.enum(["AM", "PM"]),
  is_walk_block: z.boolean(),
});

// 约束
export const constraintTypeSchema = z.enum([
  "forbidden_slot",
  "avoid_slot",
  "prefer_morning",
  "consecutive",
  "teacher_max_per_day",
  "spread_balance",
  "teacher_mutual_exclusive",
  "require_slot",
  "research_activity_block",
]);

export const constraintSchema = z.object({
  id: entityIdSchema,
  type: constraintTypeSchema,
  scope: z.enum(["teacher", "course", "class", "student", "task", "global"]),
  target_id: entityIdSchema.optional(),
  params: z.record(z.unknown()),
  weight: z.number().positive().optional(),
  hard: z.boolean(),
});

// 排课结果
export const assignmentSchema = z.object({
  task_id: entityIdSchema,
  slot_id: slotIdSchema,
  room_id: entityIdSchema,
});

// 锁定
export const lockSchema = z.object({
  task_id: entityIdSchema,
  slot_id: slotIdSchema,
});

// 系统配置
export const timetableConfigSchema = z.object({
  time_model: z.object({
    days: z.literal(5),
    periods_per_day: z.literal(10),
    lunch_break_after_period: z.literal(5),
  }),
  walk_blocks: z.array(slotIdSchema),
});

// 项目元数据
export const projectMetaSchema = z.object({
  school: z.string().default(""),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
});

// 完整状态
export const timetableStateSchema = z.object({
  version: z.string(),
  meta: projectMetaSchema,
  config: timetableConfigSchema,
  teachers: z.array(teacherSchema),
  rooms: z.array(roomSchema),
  courses: z.array(courseSchema),
  students: z.array(studentSchema),
  admin_classes: z.array(adminClassSchema),
  teaching_classes: z.array(teachingClassSchema),
  teaching_assignments: z.array(teachingAssignmentSchema),
  ap_selections: z.array(apSelectionSchema),
  constraints: z.array(constraintSchema),
  ap_sections: z.array(apSectionSchema).nullable(),
  teaching_tasks: z.array(teachingTaskSchema).nullable(),
  assignments: z.array(assignmentSchema).nullable(),
  locks: z.array(lockSchema),
});

// 导出类型推断
export type TeacherInput = z.infer<typeof teacherSchema>;
export type CourseInput = z.infer<typeof courseSchema>;
export type RoomInput = z.infer<typeof roomSchema>;
export type StudentInput = z.infer<typeof studentSchema>;
export type AdminClassInput = z.infer<typeof adminClassSchema>;
export type TeachingClassInput = z.infer<typeof teachingClassSchema>;
export type TeachingAssignmentInput = z.infer<typeof teachingAssignmentSchema>;
export type ApSelectionInput = z.infer<typeof apSelectionSchema>;
export type ConstraintInput = z.infer<typeof constraintSchema>;
