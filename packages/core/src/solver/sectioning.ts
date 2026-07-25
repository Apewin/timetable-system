/**
 * AP分班引擎
 * 实现贪心初分 + 模拟退火优化
 */
import type {
  TimetableState,
  ApSection,
  ApSelection,
  TeachingTask,
  Teacher,
  Course,
  Room,
  SlotId,
} from "../models/types.js";

// 冲突图节点（AP Section）
interface ConflictNode {
  sectionId: string;
  studentIds: string[];
}

// 冲突图边
interface ConflictEdge {
  from: string;
  to: string;
}

// 分班结果
export interface SectioningResult {
  ap_sections: ApSection[];
  teaching_tasks: TeachingTask[];
  color_number: number;
  walk_slot_count: number;
  overflow_expected: boolean;
}

// 构建冲突图
function buildConflictGraph(sections: ApSection[]): { nodes: ConflictNode[]; edges: ConflictEdge[] } {
  const nodes: ConflictNode[] = sections.map(s => ({
    sectionId: s.id,
    studentIds: s.student_ids,
  }));

  const edges: ConflictEdge[] = [];
  for (let i = 0; i < sections.length; i++) {
    for (let j = i + 1; j < sections.length; j++) {
      const sharedStudents = sections[i].student_ids.filter(s =>
        sections[j].student_ids.includes(s)
      );
      if (sharedStudents.length > 0) {
        edges.push({ from: sections[i].id, to: sections[j].id });
      }
    }
  }

  return { nodes, edges };
}

// 贪心着色算法（计算色数近似）
function greedyColoring(sections: ApSection[], edges: ConflictEdge[]): number {
  const colorMap = new Map<string, number>();
  const sectionIds = sections.map(s => s.id);

  // 按度数排序（度数高的先着色）
  const degree = new Map<string, number>();
  sectionIds.forEach(id => degree.set(id, 0));
  edges.forEach(e => {
    degree.set(e.from, (degree.get(e.from) || 0) + 1);
    degree.set(e.to, (degree.get(e.to) || 0) + 1);
  });

  const sorted = [...sectionIds].sort((a, b) => (degree.get(b) || 0) - (degree.get(a) || 0));

  let maxColor = 0;
  sorted.forEach(sectionId => {
    const usedColors = new Set<number>();

    // 找相邻节点已用的颜色
    edges.forEach(e => {
      if (e.from === sectionId && colorMap.has(e.to)) {
        usedColors.add(colorMap.get(e.to)!);
      }
      if (e.to === sectionId && colorMap.has(e.from)) {
        usedColors.add(colorMap.get(e.from)!);
      }
    });

    // 找最小可用颜色
    let color = 0;
    while (usedColors.has(color)) color++;
    colorMap.set(sectionId, color);
    maxColor = Math.max(maxColor, color);
  });

  return maxColor + 1; // 色数
}

// 贪心初分算法
function greedyInitialAssignment(
  state: TimetableState,
  seed: number
): { sections: ApSection[]; teacherAssignments: Map<string, string> } {
  const sections: ApSection[] = [];
  const teacherAssignments = new Map<string, string>();

  // 按课程分组选课数据
  const courseStudents = new Map<string, string[]>();
  state.ap_selections.forEach(selection => {
    selection.course_ids.forEach(courseId => {
      if (!courseStudents.has(courseId)) {
        courseStudents.set(courseId, []);
      }
      courseStudents.get(courseId)!.push(selection.student_id);
    });
  });

  // 为每门AP课程创建section
  courseStudents.forEach((studentIds, courseId) => {
    const course = state.courses.find(c => c.id === courseId);
    if (!course) return;

    // 找能教这门课的老师
    const availableTeachers = state.teachers.filter(t =>
      t.can_teach.includes(courseId)
    );

    if (availableTeachers.length === 0) {
      throw new Error(`没有能教 ${courseId} 的老师`);
    }

    // 计算需要多少个section
    // 找该类型教室的最小容量
    const availableRooms = state.rooms.filter(r =>
      !course.required_room_type || r.type === course.required_room_type
    );
    const minCapacity = availableRooms.length > 0
      ? Math.min(...availableRooms.map(r => r.capacity))
      : 30;

    const sectionCount = Math.ceil(studentIds.length / minCapacity);
    const actualSectionCount = Math.min(sectionCount, availableTeachers.length);

    // 按行政班分组，尽量保持同班学生在一起
    const studentByAdminClass = new Map<string, string[]>();
    studentIds.forEach(studentId => {
      const student = state.students.find(s => s.id === studentId);
      if (student) {
        if (!studentByAdminClass.has(student.admin_class_id)) {
          studentByAdminClass.set(student.admin_class_id, []);
        }
        studentByAdminClass.get(student.admin_class_id)!.push(studentId);
      }
    });

    // 创建section并分配学生
    const sectionStudents: string[][] = Array.from({ length: actualSectionCount }, () => []);

    // 轮询分配学生（保持班级均衡）
    let sectionIndex = 0;
    const sortedClasses = [...studentByAdminClass.entries()].sort((a, b) => b[1].length - a[1].length);

    sortedClasses.forEach(([, students]) => {
      students.forEach(studentId => {
        sectionStudents[sectionIndex].push(studentId);
        sectionIndex = (sectionIndex + 1) % actualSectionCount;
      });
    });

    // 创建ApSection对象
    for (let i = 0; i < actualSectionCount; i++) {
      const sectionId = `AP_${courseId}_${i + 1}`;
      const teacher = availableTeachers[i % availableTeachers.length];

      const section: ApSection = {
        id: sectionId,
        course_id: courseId,
        teacher_id: teacher.id,
        student_ids: sectionStudents[i],
        room_type: course.required_room_type || "general",
        capacity: minCapacity,
      };

      sections.push(section);
      teacherAssignments.set(sectionId, teacher.id);
    }
  });

  return { sections, teacherAssignments };
}

// 模拟退火优化
function simulatedAnnealing(
  state: TimetableState,
  initialSections: ApSection[],
  iterations: number,
  seed: number
): ApSection[] {
  let current = [...initialSections];
  let best = [...current];
  let bestScore = evaluateSectioning(state, current);

  let temperature = 100;
  const coolingRate = 0.995;

  // 简单的伪随机数生成器
  let rng = seed;
  const random = () => {
    rng = (rng * 1664525 + 1013904223) % 4294967296;
    return rng / 4294967296;
  };

  for (let iter = 0; iter < iterations; iter++) {
    temperature *= coolingRate;

    // 随机选择邻域操作
    const operation = Math.floor(random() * 3);

    if (operation === 0 && current.length > 0) {
      // 操作1：把一个学生换到同课另一section
      const sectionIndex = Math.floor(random() * current.length);
      const section = current[sectionIndex];

      if (section.student_ids.length > 0) {
        const studentIndex = Math.floor(random() * section.student_ids.length);
        const studentId = section.student_ids[studentIndex];

        // 找同课程的其他section
        const sameCourseSections = current.filter(
          (s, i) => i !== sectionIndex && s.course_id === section.course_id
        );

        if (sameCourseSections.length > 0) {
          const targetSection = sameCourseSections[Math.floor(random() * sameCourseSections.length)];

          // 交换学生
          const newSections = current.map((s, i) => {
            if (i === sectionIndex) {
              return { ...s, student_ids: s.student_ids.filter(id => id !== studentId) };
            }
            if (s.id === targetSection.id) {
              return { ...s, student_ids: [...s.student_ids, studentId] };
            }
            return s;
          });

          const newScore = evaluateSectioning(state, newSections);
          const delta = newScore - bestScore;

          if (delta < 0 || random() < Math.exp(-delta / temperature)) {
            current = newSections;
            if (newScore < bestScore) {
              best = newSections;
              bestScore = newScore;
            }
          }
        }
      }
    }
  }

  return best;
}

// 评估分班质量
function evaluateSectioning(state: TimetableState, sections: ApSection[]): number {
  let score = 0;

  // 1. 均衡性：同门AP各section人数方差
  const courseSections = new Map<string, number[]>();
  sections.forEach(s => {
    if (!courseSections.has(s.course_id)) {
      courseSections.set(s.course_id, []);
    }
    courseSections.get(s.course_id)!.push(s.student_ids.length);
  });

  courseSections.forEach((sizes) => {
    const avg = sizes.reduce((a, b) => a + b, 0) / sizes.length;
    const variance = sizes.reduce((sum, size) => sum + Math.pow(size - avg, 2), 0) / sizes.length;
    score += variance;
  });

  // 2. 冲突压力：色数代理
  const { edges } = buildConflictGraph(sections);
  const colorNumber = greedyColoring(sections, edges);
  score += colorNumber * 10;

  // 3. 教师负载均衡
  const teacherLoad = new Map<string, number>();
  sections.forEach(s => {
    const current = teacherLoad.get(s.teacher_id) || 0;
    teacherLoad.set(s.teacher_id, current + s.student_ids.length);
  });

  const loads = [...teacherLoad.values()];
  if (loads.length > 0) {
    const avgLoad = loads.reduce((a, b) => a + b, 0) / loads.length;
    const loadVariance = loads.reduce((sum, load) => sum + Math.pow(load - avgLoad, 2), 0) / loads.length;
    score += loadVariance;
  }

  return score;
}

// 主函数：执行分班
export function solveSections(
  state: TimetableState,
  options: { seed?: number; candidates?: number } = {}
): SectioningResult {
  const seed = options.seed || Date.now();
  const candidates = options.candidates || 1;

  // 检查是否有AP选课数据
  if (state.ap_selections.length === 0) {
    throw new Error("没有AP选课数据，请先添加 ap-selection");
  }

  // 贪心初分
  const { sections: initialSections } = greedyInitialAssignment(state, seed);

  // 如果需要多组候选，运行多次
  let bestSections = initialSections;
  let bestScore = evaluateSectioning(state, initialSections);

  for (let i = 0; i < candidates; i++) {
    const candidateSeed = seed + i * 1000;
    const optimized = simulatedAnnealing(state, initialSections, 1000, candidateSeed);
    const score = evaluateSectioning(state, optimized);

    if (score < bestScore) {
      bestSections = optimized;
      bestScore = score;
    }
  }

  // 计算冲突图色数
  const { edges } = buildConflictGraph(bestSections);
  const colorNumber = greedyColoring(bestSections, edges);

  // 计算走班时段数
  const walkSlotCount = state.config.walk_blocks.length;

  // 判断是否溢出
  const overflowExpected = colorNumber > walkSlotCount;

  // 生成AP教学任务
  const apTasks: TeachingTask[] = bestSections.map(section => {
    const course = state.courses.find(c => c.id === section.course_id);
    return {
      id: `TASK_AP_${section.id}`,
      source: "ap",
      course_id: section.course_id,
      teacher_id: section.teacher_id,
      student_ids: section.student_ids,
      weekly_hours: course?.weekly_hours || 2,
      room_policy: "assign",
      room_id: undefined,
      source_section_id: section.id,
    };
  });

  return {
    ap_sections: bestSections,
    teaching_tasks: apTasks,
    color_number: colorNumber,
    walk_slot_count: walkSlotCount,
    overflow_expected: overflowExpected,
  };
}
