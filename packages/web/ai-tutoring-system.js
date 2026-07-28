/**
 * AI 排课助手系统
 * 包含完整的系统提示词和智能排课逻辑
 */

// 系统提示词 - 告诉 AI 如何排课
export const SCHEDULING_SYSTEM_PROMPT = `你是一个专业的排课系统 AI 助手。你的任务是帮助用户完成课程安排。

## 学校基本信息

- 学校名称：示例国际学校
- 年级：高一、高二、高三（3个年级）
- 每年级人数：约80人
- 总人数：约240人
- 每周课时：50节（5天×10节/天）
- 课程体系：双轨制（国内必修课程 + AP国际课程）

## 班级结构

### 行政班（固定学生分组）
- 高一：AC1、AC2（各40人）
- 高二：AC3、AC4（各40人）
- 高三：AC5、AC6（各40人）

### 教学班（固定学生分组，用于必修课）
- 高一：TC_G10_1、TC_G10_2、TC_G10_3（各约27人）
- 高二：TC_G11_1、TC_G11_2、TC_G11_3（各约27人）
- 高三：TC_G12_1、TC_G12_2、TC_G12_3（各约27人）

### AP选修班（动态生成，用于选修课）
- 根据学生选课动态生成
- 每门AP课程可能有1-2个平行班

## 课程结构

### 高一（50节，全部必修）
**教学班课程（37节）**：
- Comprehensive English - 中教L&S: 3节
- Comprehensive English - 中教R&W: 3节
- Comprehensive English - 外教L&S&Lit: 4节
- 英美概况: 2节
- 中方数学+Pre-Calculus: 6节
- AP Physics 1+中方物理: 5节
- 中方化学+Pre-Chemistry: 5节
- 中方生物+Pre-Biology: 5节
- 体育: 2节
- 自习: 2节

**行政班课程（13节）**：
- 语法: 2节
- 语文: 2节
- 历史: 2节
- 地理: 2节
- 美术: 1节
- 升学课堂: 1节
- 班会: 1节
- 社团: 2节

### 高二（50节，必修+AP选修）
**教学班课程（18节）**：
- Comprehensive English: 4节
- Honor LC (TC1/TC2): 2节 或 AP LC (TC3): 5节
- TOEFL (TC1/TC2): 3节
- AP Calculus BC: 5节（AP必修课）
- Pre AP-Literature and Composition: 2节
- 中方物理: 2节

**行政班课程（17节）**：
- 中方数学: 2节
- 语文: 2节
- 政治: 2节
- 体育: 2节
- 信息技术: 1节
- 升学课堂: 2节
- 自习: 2节
- 班会: 1节
- 社团: 2节
- 值日: 1节

**AP选修课（15节）**：
- 学生选3门，每门5节

### 高三（50节，必修+必修选修+AP选修）
**教学班课程（16节）**：
- AP Statistics: 5节
- English Creative Writing: 5节
- 大学申请自习课: 4节
- 自习: 2节

**行政班课程（8节）**：
- 语文: 2节
- 体育: 2节
- 班会: 1节
- 社团: 2节
- 值日: 1节

**必修选修课（11节）**：
- A组: 5节（AP Language / AP Literature / Honor英美文学）
- B组: 4节（线性代数 / 商业 / 力学基础）
- C组: 2节（日语 / 法语 / 德语）

**AP选修课（15节）**：
- 学生选3门，每门5节

## 排课约束条件

### 硬约束（不可违反）
1. **教师不重叠**：同一教师同一时段只能上一门课
2. **学生不重叠**：同一学生同一时段只能上一门课（走班核心）
3. **教室不重叠**：同一教室同一时段只能有一门课
4. **教室容量**：每个班的学生数 ≤ 教室容量
5. **课时排满**：每门课必须排满规定的周课时
6. **禁排时段**：某些课程/教师/班级禁止排在特定时段
7. **教室类型匹配**：AP课程必须排在对应类型的教室
8. **教师日上限**：每位教师每天上课节数有上限（默认8节）

### 软约束（优化目标）
1. **优先上午**：主要学术课程优先排在上午（第1-5节）
2. **连堂课**：实验课等需要连续两节，优先排相邻时段
3. **AP优先走班时段**：AP课程优先排在走班时段（下午第6-7节）
4. **课表分散均衡**：同一课程在一周内尽量不连续排
5. **教师课表连贯**：尽量减少教师"空堂"（中间跳空一节）

## 走班时段

走班时段是专门为AP选修课预留的时间窗口：
- 周一第6-7节（14:00-15:30）
- 周二第6-7节
- 周三第6-7节
- 周四第6-7节
- 周五第6-7节

共5天×2节=10个走班时段/周。

## 排课流程

1. **分班**：将学生分配到具体的AP选修班和必修选修班
2. **排必修课**：将行政班和教学班的必修课排入课表
3. **排选修课**：将AP选修课和必修选修课排入课表
4. **检查冲突**：检查教师、学生、教室是否有冲突
5. **优化调整**：根据软约束优化课表

## 输出格式

当用户要求排课时，你需要：
1. 分析用户的指令
2. 确定需要排哪些课程
3. 生成排课方案
4. 输出可执行的排课命令

排课命令格式：
\`\`\`json
{
  "action": "schedule",
  "tasks": [
    {
      "task_id": "TASK_XXX",
      "assignments": [
        {"slot_id": "D1P1", "room_id": "R1"},
        {"slot_id": "D2P1", "room_id": "R1"},
        ...
      ]
    }
  ]
}
\`\`\`

## 注意事项

1. 每个学生每天必须上满10节课
2. 每个学生每周必须上满50节课
3. 行政班课程在固定教室上课
4. 教学班课程在固定教室上课
5. AP选修课需要分配教室（按课程类型匹配）
6. 必修选修课需要分配教室
7. 无教师课程（班会、社团、自习等）不需要分配教师

## 示例对话

用户：帮我排一下高一的课表

AI：我来为您排高一的课表。高一有以下课程需要安排：

**教学班课程（37节/班）**：
- 英语相关：10节（3+3+4）
- 数学：6节
- 物理：5节
- 化学：5节
- 生物：5节
- 英美概况：2节
- 体育：2节
- 自习：2节

**行政班课程（13节/班）**：
- 语法：2节
- 语文：2节
- 历史：2节
- 地理：2节
- 美术：1节
- 升学课堂：1节
- 班会：1节
- 社团：2节

我将按照以下原则排课：
1. 主要课程排在上午
2. 体育课排在下午
3. 班会排在周一上午
4. 社团排在周五下午

是否开始排课？
`;

// 分析用户指令
export function analyzeUserInstruction(instruction, state) {
  const result = {
    intent: null,  // 排课、查询、调整
    target: null,  // 年级、班级、教师、课程
    parameters: {},
    confidence: 0
  };

  const lowerInstruction = instruction.toLowerCase();

  // 识别意图
  if (lowerInstruction.includes('排课') || lowerInstruction.includes('安排') || lowerInstruction.includes('生成课表')) {
    result.intent = 'schedule';
  } else if (lowerInstruction.includes('查看') || lowerInstruction.includes('查询') || lowerInstruction.includes('显示')) {
    result.intent = 'query';
  } else if (lowerInstruction.includes('调整') || lowerInstruction.includes('修改') || lowerInstruction.includes('移动')) {
    result.intent = 'adjust';
  }

  // 识别目标年级
  if (lowerInstruction.includes('高一') || lowerInstruction.includes('g10') || lowerInstruction.includes('10年级')) {
    result.target = 'grade_10';
  } else if (lowerInstruction.includes('高二') || lowerInstruction.includes('g11') || lowerInstruction.includes('11年级')) {
    result.target = 'grade_11';
  } else if (lowerInstruction.includes('高三') || lowerInstruction.includes('g12') || lowerInstruction.includes('12年级')) {
    result.target = 'grade_12';
  }

  // 识别目标班级
  const classMatch = lowerInstruction.match(/(tc|ac|教学|行政)\s*(\d+)/);
  if (classMatch) {
    result.target = 'class';
    parameters.class_id = classMatch[0].toUpperCase();
  }

  // 识别目标教师
  state.teachers?.forEach(teacher => {
    if (lowerInstruction.includes(teacher.name.toLowerCase())) {
      result.target = 'teacher';
      result.parameters.teacher_id = teacher.id;
    }
  });

  // 识别目标课程
  state.courses?.forEach(course => {
    if (lowerInstruction.includes(course.name.toLowerCase())) {
      result.target = 'course';
      result.parameters.course_id = course.id;
    }
  });

  return result;
}

// 生成排课方案
export function generateSchedulingPlan(state, target) {
  const plan = {
    tasks: [],
    constraints: [],
    suggestions: []
  };

  // 根据目标生成排课方案
  if (target === 'grade_10') {
    plan.tasks = generateGrade10Schedule(state);
  } else if (target === 'grade_11') {
    plan.tasks = generateGrade11Schedule(state);
  } else if (target === 'grade_12') {
    plan.tasks = generateGrade12Schedule(state);
  }

  return plan;
}

// 生成高一课表
function generateGrade10Schedule(state) {
  const tasks = [];
  const slots = generateTimeSlots();

  // 教学班课程
  const teachingCourses = [
    { id: 'ENG_LS', hours: 3, prefer_morning: true },
    { id: 'ENG_RW', hours: 3, prefer_morning: true },
    { id: 'ENG_LIT', hours: 4, prefer_morning: true },
    { id: 'ENG_SURVEY', hours: 2, prefer_morning: true },
    { id: 'MATH_PRECAL', hours: 6, prefer_morning: true },
    { id: 'AP_PHYS1', hours: 5, prefer_morning: true },
    { id: 'CHEM_PRE', hours: 5, prefer_morning: true },
    { id: 'BIO_PRE', hours: 5, prefer_morning: true },
    { id: 'PE', hours: 2, prefer_morning: false },
    { id: 'SELF_STUDY', hours: 2, prefer_morning: false }
  ];

  // 行政班课程
  const adminCourses = [
    { id: 'GRAMMAR', hours: 2, prefer_morning: true },
    { id: 'CHIN', hours: 2, prefer_morning: true },
    { id: 'HIST', hours: 2, prefer_morning: true },
    { id: 'GEOG', hours: 2, prefer_morning: true },
    { id: 'ART', hours: 1, prefer_morning: false },
    { id: 'GUIDANCE', hours: 1, prefer_morning: true },
    { id: 'MEETING', hours: 1, prefer_morning: true },
    { id: 'CLUB', hours: 2, prefer_morning: false }
  ];

  // 为每个教学班生成课表
  ['TC_G10_1', 'TC_G10_2', 'TC_G10_3'].forEach(tcId => {
    teachingCourses.forEach(course => {
      const task = {
        task_id: `TASK_${tcId}_${course.id}`,
        course_id: course.id,
        class_id: tcId,
        class_type: 'teaching',
        weekly_hours: course.hours,
        assignments: distributeHoursToSlots(course.hours, slots, course.prefer_morning)
      };
      tasks.push(task);
    });
  });

  // 为每个行政班生成课表
  ['AC1', 'AC2'].forEach(acId => {
    adminCourses.forEach(course => {
      const task = {
        task_id: `TASK_${acId}_${course.id}`,
        course_id: course.id,
        class_id: acId,
        class_type: 'admin',
        weekly_hours: course.hours,
        assignments: distributeHoursToSlots(course.hours, slots, course.prefer_morning)
      };
      tasks.push(task);
    });
  });

  return tasks;
}

// 生成时段列表
function generateTimeSlots() {
  const slots = [];
  for (let day = 1; day <= 5; day++) {
    for (let period = 1; period <= 10; period++) {
      slots.push({
        id: `D${day}P${period}`,
        day,
        period,
        is_morning: period <= 5,
        is_walk_block: period === 6 || period === 7
      });
    }
  }
  return slots;
}

// 将课时分配到时段
function distributeHoursToSlots(hours, slots, preferMorning) {
  const assignments = [];
  const availableSlots = preferMorning
    ? slots.filter(s => s.is_morning)
    : slots;

  for (let i = 0; i < hours && i < availableSlots.length; i++) {
    assignments.push({
      slot_id: availableSlots[i].id,
      room_id: null  // 需要后续分配
    });
  }

  return assignments;
}

// 调用 CLI 命令
export function generateCLICommand(action, params) {
  switch (action) {
    case 'solve-sections':
      return {
        command: 'tt solve sections',
        args: {
          seed: params.seed || 42,
          candidates: params.candidates || 1
        }
      };

    case 'solve-timetable':
      return {
        command: 'tt solve timetable',
        args: {
          timeout: params.timeout || 5000,
          seed: params.seed || 42,
          keep: params.keep || false
        }
      };

    case 'solve':
      return {
        command: 'tt solve',
        args: {
          seed: params.seed || 42,
          timeout: params.timeout || 5000
        }
      };

    case 'show':
      return {
        command: `tt show --by ${params.by} --id ${params.id}`,
        args: {}
      };

    case 'validate':
      return {
        command: 'tt validate',
        args: {}
      };

    case 'export':
      return {
        command: `tt export --format ${params.format} --output ${params.output}`,
        args: {}
      };

    default:
      return null;
  }
}

// 生成排课建议
export function generateSchedulingSuggestions(state) {
  const suggestions = [];

  // 检查是否有未排课的课程
  const unassignedCourses = checkUnassignedCourses(state);
  if (unassignedCourses.length > 0) {
    suggestions.push({
      type: 'warning',
      message: `有 ${unassignedCourses.length} 门课程尚未排课`,
      details: unassignedCourses
    });
  }

  // 检查教师冲突
  const teacherConflicts = checkTeacherConflicts(state);
  if (teacherConflicts.length > 0) {
    suggestions.push({
      type: 'error',
      message: `发现 ${teacherConflicts.length} 个教师冲突`,
      details: teacherConflicts
    });
  }

  // 检查学生冲突
  const studentConflicts = checkStudentConflicts(state);
  if (studentConflicts.length > 0) {
    suggestions.push({
      type: 'error',
      message: `发现 ${studentConflicts.length} 个学生冲突`,
      details: studentConflicts
    });
  }

  // 检查教室冲突
  const roomConflicts = checkRoomConflicts(state);
  if (roomConflicts.length > 0) {
    suggestions.push({
      type: 'error',
      message: `发现 ${roomConflicts.length} 个教室冲突`,
      details: roomConflicts
    });
  }

  return suggestions;
}

// 检查未排课的课程
function checkUnassignedCourses(state) {
  const unassigned = [];

  if (!state.teaching_tasks || !state.assignments) {
    return unassigned;
  }

  state.teaching_tasks.forEach(task => {
    const assignmentCount = state.assignments.filter(a => a.task_id === task.id).length;
    if (assignmentCount < task.weekly_hours) {
      unassigned.push({
        task_id: task.id,
        course_id: task.course_id,
        required: task.weekly_hours,
        assigned: assignmentCount
      });
    }
  });

  return unassigned;
}

// 检查教师冲突
function checkTeacherConflicts(state) {
  const conflicts = [];

  if (!state.teaching_tasks || !state.assignments) {
    return conflicts;
  }

  const teacherSlotMap = new Map();

  state.assignments.forEach(a => {
    const task = state.teaching_tasks.find(t => t.id === a.task_id);
    if (!task || !task.teacher_id) return;

    const key = `${task.teacher_id}:${a.slot_id}`;
    if (teacherSlotMap.has(key)) {
      conflicts.push({
        teacher_id: task.teacher_id,
        slot_id: a.slot_id,
        task_ids: [teacherSlotMap.get(key), a.task_id]
      });
    } else {
      teacherSlotMap.set(key, a.task_id);
    }
  });

  return conflicts;
}

// 检查学生冲突
function checkStudentConflicts(state) {
  const conflicts = [];

  if (!state.teaching_tasks || !state.assignments) {
    return conflicts;
  }

  const studentSlotMap = new Map();

  state.assignments.forEach(a => {
    const task = state.teaching_tasks.find(t => t.id === a.task_id);
    if (!task) return;

    task.student_ids?.forEach(studentId => {
      const key = `${studentId}:${a.slot_id}`;
      if (studentSlotMap.has(key)) {
        conflicts.push({
          student_id: studentId,
          slot_id: a.slot_id,
          task_ids: [studentSlotMap.get(key), a.task_id]
        });
      } else {
        studentSlotMap.set(key, a.task_id);
      }
    });
  });

  return conflicts;
}

// 检查教室冲突
function checkRoomConflicts(state) {
  const conflicts = [];

  if (!state.assignments) {
    return conflicts;
  }

  const roomSlotMap = new Map();

  state.assignments.forEach(a => {
    if (!a.room_id) return;

    const key = `${a.room_id}:${a.slot_id}`;
    if (roomSlotMap.has(key)) {
      conflicts.push({
        room_id: a.room_id,
        slot_id: a.slot_id,
        task_ids: [roomSlotMap.get(key), a.task_id]
      });
    } else {
      roomSlotMap.set(key, a.task_id);
    }
  });

  return conflicts;
}
