/**
 * 完整分班流水线
 * 支持：行政班必修、教学班必修、分层教学、必修选修课、AP选修课
 * 支持：AI智能分班 + 手动调整
 */
import type {
  TimetableState,
  ApSection,
  TeachingTask,
  Student,
  Course,
} from "../models/types.js";

// 分班结果
export interface SectioningResult {
  teaching_tasks: TeachingTask[];
  ap_sections: ApSection[];
  elective_sections: ElectiveSection[];
  statistics: {
    required_tasks: number;
    required_elective_tasks: number;
    ap_tasks: number;
    other_tasks: number;
    total_tasks: number;
    total_sections: number;
  };
}

// 选修班（包括AP选修和必修选修）
export interface ElectiveSection {
  id: string;
  course_id: string;
  course_name: string;
  course_type: 'ap' | 'required_elective';
  section_index: number;
  student_ids: string[];
  teacher_id: string | null;
  room_id: string | null;
  capacity: number;
  weekly_hours: number;
}

/** 教务表中的“选修 2”表示必须开两个平行教学班，而不是教师人数上限。 */
function requiredSectionCount(value: unknown): number {
  if (Array.isArray(value)) return Math.max(1, ...value.filter(Number.isFinite));
  if (typeof value === 'number' && Number.isInteger(value) && value > 0) return value;
  const match = String(value ?? '').match(/(?:选修|section)?\s*(\d+)/i);
  return match ? Math.max(1, Number(match[1])) : 1;
}

// 分班配置
export interface SectioningConfig {
  max_students_per_section?: number;  // 每班最大人数
  balance_sections?: boolean;  // 是否均衡分班
  respect_student_preferences?: boolean;  // 是否尊重学生偏好
}

// Step 1: 行政班/教学班必修课分班
function generateRequiredTasks(state: TimetableState): TeachingTask[] {
  const tasks: TeachingTask[] = [];

  state.teaching_assignments.forEach(assignment => {
    const course = state.courses.find(c => c.id === assignment.course_id);
    if (!course) return;
    const classIds = assignment.class_ids?.length ? assignment.class_ids : assignment.class_id ? [assignment.class_id] : [];
    const sharedMeetingPlaceholder = assignment.course_id === 'MEETING' && assignment.class_type === 'admin' && classIds.length > 1;
    for (const classId of classIds) {
      const group = assignment.class_type === 'admin'
        ? state.admin_classes.find(item => item.id === classId)
        : state.teaching_classes.find(item => item.id === classId);
      if (!group?.student_ids.length) continue;
      tasks.push({
        id: `TASK_REQ_${assignment.id}_${classId}`,
        source: 'required',
        course_id: assignment.course_id,
        // Grade-wide “班主任” placeholders are not an actual one-person
        // resource. Treat those fixed meetings as unstaffed until individual
        // homeroom teachers are supplied.
        teacher_id: sharedMeetingPlaceholder ? null : assignment.teacher_id,
        student_ids: group.student_ids,
        weekly_hours: assignment.weekly_hours,
        room_policy: 'pinned',
        room_id: group.fixed_room_id,
        source_class_id: group.id,
      });
    }
  });

  return tasks;
}

// Step 2: 必修选修课分班
function generateRequiredElectiveSections(
  state: TimetableState,
  config: SectioningConfig
): { sections: ElectiveSection[]; tasks: TeachingTask[] } {
  const sections: ElectiveSection[] = [];
  const tasks: TeachingTask[] = [];

  // 按组别收集必修选修课
  const groupCourses = new Map<string, Course[]>();
  state.courses
    .filter(c => c.type === "required_elective" && c.elective_group)
    .forEach(course => {
      const group = course.elective_group!;
      if (!groupCourses.has(group)) {
        groupCourses.set(group, []);
      }
      groupCourses.get(group)!.push(course);
    });

  // 统计每个组别的学生选择
  groupCourses.forEach((courses, group) => {
    const courseStudents = new Map<string, string[]>();
    courses.forEach(c => courseStudents.set(c.id, []));

    // 收集学生选择
    state.students.forEach(student => {
      if (!student.elective_choices) return;

      const choiceField = `group_${group.toLowerCase()}` as keyof typeof student.elective_choices;
      const chosenCourseId = student.elective_choices[choiceField];

      if (chosenCourseId && courseStudents.has(chosenCourseId)) {
        courseStudents.get(chosenCourseId)!.push(student.id);
      }
    });

    // 为每门选修课生成平行班
    courseStudents.forEach((studentIds, courseId) => {
      if (studentIds.length === 0) return;

      const course = state.courses.find(c => c.id === courseId);
      if (!course) return;

      const sectionCount = requiredSectionCount(course.section_count);
      const maxStudents = config.max_students_per_section || 30;
      const actualSectionCount = Math.max(sectionCount, Math.ceil(studentIds.length / maxStudents));

      // 智能分班：尽量均衡
      const sectionStudents: string[][] = Array.from({ length: actualSectionCount }, () => []);

      if (config.balance_sections) {
        // 均衡分班：轮询分配
        studentIds.forEach((studentId, index) => {
          sectionStudents[index % actualSectionCount].push(studentId);
        });
      } else {
        // 按顺序分班
        const studentsPerSection = Math.ceil(studentIds.length / actualSectionCount);
        for (let i = 0; i < actualSectionCount; i++) {
          const start = i * studentsPerSection;
          const end = Math.min(start + studentsPerSection, studentIds.length);
          sectionStudents[i] = studentIds.slice(start, end);
        }
      }

      // 创建分班结果
      for (let i = 0; i < actualSectionCount; i++) {
        if (sectionStudents[i].length === 0) continue;

        const sectionId = `ELECTIVE_${courseId}_${i + 1}`;

        const section: ElectiveSection = {
          id: sectionId,
          course_id: courseId,
          course_name: course.name,
          course_type: 'required_elective',
          section_index: i,
          student_ids: sectionStudents[i],
          teacher_id: null,  // 需要后续分配教师
          room_id: null,
          capacity: sectionStudents[i].length,
          weekly_hours: course.weekly_hours,
        };

        sections.push(section);

        // 创建教学任务
        const task: TeachingTask = {
          id: `TASK_ELECTIVE_${courseId}_${i + 1}`,
          source: "required_elective",
          course_id: courseId,
          teacher_id: null,
          student_ids: sectionStudents[i],
          weekly_hours: course.weekly_hours,
          room_policy: "assign",
          source_class_id: undefined,
          elective_group: group as "A" | "B" | "C",
          section_index: i,
        };

        tasks.push(task);
      }
    });
  });

  return { sections, tasks };
}

// Step 3: AP 选修课分班
function generateApSections(
  state: TimetableState,
  config: SectioningConfig
): { sections: ElectiveSection[]; tasks: TeachingTask[] } {
  const sections: ElectiveSection[] = [];
  const tasks: TeachingTask[] = [];

  // 从学生的 ap_courses 字段收集AP选课数据
  const courseStudents = new Map<string, string[]>();

  state.students.forEach(student => {
    if (!student.ap_courses || student.ap_courses.length === 0) return;

    student.ap_courses.forEach(courseId => {
      if (!courseStudents.has(courseId)) {
        courseStudents.set(courseId, []);
      }
      courseStudents.get(courseId)!.push(student.id);
    });
  });

  const studentsById = new Map(state.students.map(student => [student.id, student]));

  // 为每门AP课程创建section
  courseStudents.forEach((studentIds, courseId) => {
    const course = state.courses.find(c => c.id === courseId);
    if (!course) return;
    const requirements = course.section_requirements?.length
      ? course.section_requirements
      : [{ grades: null, count: requiredSectionCount(course.section_count), teacher_id: undefined }];
    const claimedStudents = new Set<string>();

    for (const requirement of requirements) {
      const cohortStudentIds = studentIds.filter(studentId => {
        const student = studentsById.get(studentId);
        return !requirement.grades || requirement.grades.includes(student?.grade || -1);
      });
      if (!cohortStudentIds.length) continue;
      cohortStudentIds.forEach(studentId => {
        if (claimedStudents.has(studentId)) throw new Error(`课程 ${courseId} 的开班要求重复包含学生 ${studentId}`);
        claimedStudents.add(studentId);
      });
      const availableTeachers = state.teachers.filter(teacher =>
        teacher.can_teach.includes(courseId) && (!requirement.teacher_id || teacher.id === requirement.teacher_id)
      );
      if (availableTeachers.length === 0) throw new Error(`课程 ${courseId} 没有符合年级组要求的教师`);
      const maxStudents = config.max_students_per_section || 25;
      const actualSectionCount = Math.max(requirement.count, Math.ceil(cohortStudentIds.length / maxStudents));
      const sectionStudents: string[][] = Array.from({ length: actualSectionCount }, () => []);
      if (config.balance_sections) {
        cohortStudentIds.forEach((studentId, index) => sectionStudents[index % actualSectionCount].push(studentId));
      } else {
        const studentsPerSection = Math.ceil(cohortStudentIds.length / actualSectionCount);
        for (let i = 0; i < actualSectionCount; i++) sectionStudents[i] = cohortStudentIds.slice(i * studentsPerSection, (i + 1) * studentsPerSection);
      }
      const cohortKey = requirement.grades ? `_G${[...requirement.grades].sort((a, b) => a - b).join('_G')}` : '';
      for (let i = 0; i < actualSectionCount; i++) {
        if (!sectionStudents[i].length) continue;
        // 同一名老师可以承担多个 section；排课阶段负责保证时段不重叠。
        const teacher = availableTeachers[i % availableTeachers.length];
        const sectionId = `AP_${courseId}${cohortKey}_${i + 1}`;
        sections.push({ id: sectionId, course_id: courseId, course_name: course.name, course_type: 'ap', section_index: i,
          student_ids: sectionStudents[i], teacher_id: teacher.id, room_id: null, capacity: sectionStudents[i].length, weekly_hours: course.weekly_hours });
        tasks.push({ id: `TASK_${sectionId}`, source: 'ap', course_id: courseId, teacher_id: teacher.id,
          student_ids: sectionStudents[i], weekly_hours: course.weekly_hours, room_policy: 'assign', source_class_id: undefined, source_section_id: sectionId });
      }
    }
    if (claimedStudents.size !== studentIds.length) throw new Error(`课程 ${courseId} 的开班要求未覆盖全部学生`);
  });

  return { sections, tasks };
}

// 主函数：执行完整分班流水线
export function solveSections(
  state: TimetableState,
  config: SectioningConfig = {}
): SectioningResult {
  // 默认配置
  const defaultConfig: SectioningConfig = {
    max_students_per_section: 30,
    balance_sections: true,
    respect_student_preferences: true,
  };

  const finalConfig = { ...defaultConfig, ...config };

  console.log("开始分班流水线...");
  console.log("配置:", finalConfig);

  // Step 1: 行政班/教学班必修课分班
  console.log("Step 1: 生成必修课教学任务...");
  const requiredTasks = generateRequiredTasks(state);
  console.log(`  生成 ${requiredTasks.length} 个必修课任务`);

  // Step 2: 必修选修课分班
  console.log("Step 2: 生成必修选修课任务...");
  const { sections: electiveSections, tasks: electiveTasks } = generateRequiredElectiveSections(state, finalConfig);
  console.log(`  生成 ${electiveTasks.length} 个必修选修课任务，${electiveSections.length} 个班级`);

  // Step 3: AP 选修课分班
  console.log("Step 3: 生成 AP 选修课任务...");
  const { sections: apSections, tasks: apTasks } = generateApSections(state, finalConfig);
  console.log(`  生成 ${apTasks.length} 个 AP 选修课任务，${apSections.length} 个班级`);

  // 合并所有任务和分班结果
  const allTasks = [...requiredTasks, ...electiveTasks, ...apTasks];
  const allSections = [...electiveSections, ...apSections];

  // 统计
  const statistics = {
    required_tasks: requiredTasks.length,
    required_elective_tasks: electiveTasks.length,
    ap_tasks: apTasks.length,
    other_tasks: 0,
    total_tasks: allTasks.length,
    total_sections: allSections.length,
  };

  console.log("分班完成！");
  console.log("统计:", statistics);

  return {
    teaching_tasks: allTasks,
    ap_sections: apSections.map(s => ({
      id: s.id,
      course_id: s.course_id,
      teacher_id: s.teacher_id || '',
      student_ids: s.student_ids,
      room_type: 'general',
      capacity: s.capacity,
    })),
    elective_sections: allSections,
    statistics,
  };
}

// 手动调整分班：将学生从一个班级移到另一个班级
export function moveStudentBetweenSections(
  sections: ElectiveSection[],
  studentId: string,
  fromSectionId: string,
  toSectionId: string
): ElectiveSection[] {
  return sections.map(section => {
    if (section.id === fromSectionId) {
      // 从源班级移除学生
      return {
        ...section,
        student_ids: section.student_ids.filter(id => id !== studentId),
        capacity: section.student_ids.length - 1,
      };
    }
    if (section.id === toSectionId) {
      // 将学生添加到目标班级
      return {
        ...section,
        student_ids: [...section.student_ids, studentId],
        capacity: section.student_ids.length + 1,
      };
    }
    return section;
  });
}

// 手动调整分班：交换两个学生
export function swapStudentsBetweenSections(
  sections: ElectiveSection[],
  student1Id: string,
  section1Id: string,
  student2Id: string,
  section2Id: string
): ElectiveSection[] {
  return sections.map(section => {
    if (section.id === section1Id) {
      return {
        ...section,
        student_ids: section.student_ids.map(id => id === student1Id ? student2Id : id),
      };
    }
    if (section.id === section2Id) {
      return {
        ...section,
        student_ids: section.student_ids.map(id => id === student2Id ? student1Id : id),
      };
    }
    return section;
  });
}

// 获取分班建议（AI辅助）
export function getSectioningSuggestions(
  state: TimetableState,
  sections: ElectiveSection[]
): string[] {
  const suggestions: string[] = [];

  // 检查班级人数均衡性
  const courseGroups = new Map<string, ElectiveSection[]>();
  sections.forEach(section => {
    if (!courseGroups.has(section.course_id)) {
      courseGroups.set(section.course_id, []);
    }
    courseGroups.get(section.course_id)!.push(section);
  });

  courseGroups.forEach((courseSections, courseId) => {
    if (courseSections.length <= 1) return;

    const sizes = courseSections.map(s => s.student_ids.length);
    const maxSize = Math.max(...sizes);
    const minSize = Math.min(...sizes);
    const diff = maxSize - minSize;

    if (diff > 5) {
      const course = state.courses.find(c => c.id === courseId);
      suggestions.push(`${course?.name || courseId} 的班级人数不均衡（${minSize}-${maxSize}人），建议调整`);
    }
  });

  // 检查是否有学生没有被分配
  const assignedStudentIds = new Set(sections.flatMap(s => s.student_ids));
  const unassignedStudents = state.students.filter(s =>
    !assignedStudentIds.has(s.id) &&
    ((s.ap_courses && s.ap_courses.length > 0) || s.elective_choices)
  );

  if (unassignedStudents.length > 0) {
    suggestions.push(`有 ${unassignedStudents.length} 名学生未被分配到选修班`);
  }

  return suggestions;
}
