/**
 * 排课系统 Web 服务器
 * 提供 REST API 给前端调用
 */
import express from 'express';
import cors from 'cors';
import multer from 'multer';
import * as XLSX from 'xlsx';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { getRules, applyRules, translateRule } from './llm-bridge.js';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
app.use(cors());
app.use(express.json());

// 文件上传配置
const upload = multer({ storage: multer.memoryStorage() });

// 提供静态文件
app.use(express.static(__dirname));

// DeepSeek API 配置
global.DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY;
global.DEEPSEEK_API_URL = process.env.DEEPSEEK_API_URL || 'https://api.deepseek.com';
global.DEEPSEEK_MODEL = process.env.DEEPSEEK_MODEL || 'deepseek-v4-flash';

// 检查 API key 是否配置
if (!global.DEEPSEEK_API_KEY) {
  console.warn('⚠️  警告: DEEPSEEK_API_KEY 未配置，AI 功能将不可用');
}

// 调用 DeepSeek API
async function callDeepSeek(messages, options = {}) {
  const apiKey = global.DEEPSEEK_API_KEY;
  const baseUrl = global.DEEPSEEK_API_URL || 'https://api.deepseek.com';
  const model = global.DEEPSEEK_MODEL || 'deepseek-v4-flash';

  if (!apiKey) {
    throw new Error('DeepSeek API Key 未配置，请在设置中配置');
  }

  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: options.model || model,
      messages,
      temperature: options.temperature || 0.7,
      max_tokens: options.maxTokens || 2000,
      stream: false,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`DeepSeek API 错误: ${response.status} - ${error}`);
  }

  const data = await response.json();
  return data.choices[0]?.message?.content || '';
}

// 状态文件路径（默认在当前目录）
const STATE_FILE = process.env.STATE_FILE || resolve(process.cwd(), 'timetable.json');

// 辅助函数：读取状态
function readState() {
  if (!existsSync(STATE_FILE)) {
    throw new Error('状态文件不存在: ' + STATE_FILE);
  }
  const content = readFileSync(STATE_FILE, 'utf-8');
  return JSON.parse(content);
}

// 辅助函数：写入状态
function writeState(state) {
  state.meta.updated_at = new Date().toISOString();
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), 'utf-8');
}

// API: 获取状态
app.get('/api/status', (req, res) => {
  try {
    const state = readState();
    const data = {
      school: state.meta.school,
      counts: {
        teachers: state.teachers.length,
        rooms: state.rooms.length,
        courses: state.courses.length,
        students: state.students.length,
        admin_classes: state.admin_classes.length,
        teaching_classes: state.teaching_classes.length,
        teaching_assignments: state.teaching_assignments.length,
        ap_selections: state.ap_selections.length,
        constraints: state.constraints.length,
      },
      last_stage: state.assignments ? 'timetable' : state.ap_sections ? 'sections' : state.teaching_tasks ? 'tasks' : 'none',
      hard_violations: 0,
      soft_score: 0,
    };
    res.json({ ok: true, data });
  } catch (error) {
    res.status(500).json({ ok: false, errors: [{ code: 'ERROR', msg: error.message }] });
  }
});

// API: 获取教学任务（需要在通用路由之前）
app.get('/api/teaching_tasks', (req, res) => {
  try {
    const state = readState();
    res.json({ ok: true, data: state.teaching_tasks || [] });
  } catch (error) {
    res.status(500).json({ ok: false, errors: [{ code: 'ERROR', msg: error.message }] });
  }
});

// API: 验证排课结果（需要在通用路由之前）
app.get('/api/validate', (req, res) => {
  try {
    const state = readState();
    const tasks = state.teaching_tasks || [];
    const assignments = state.assignments || [];

    const hardViolations = [];
    let softScore = 0;

    // 检查硬约束
    // H1: 老师不重叠
    const teacherSlotMap = new Map();
    assignments.forEach(a => {
      const task = tasks.find(t => t.id === a.task_id);
      if (!task) return;

      const key = `${task.teacher_id}:${a.slot_id}`;
      if (teacherSlotMap.has(key)) {
        hardViolations.push({
          constraint_id: 'H1',
          task_ids: [teacherSlotMap.get(key), a.task_id],
          slot: a.slot_id,
          reason: `教师 ${task.teacher_id} 在时段 ${a.slot_id} 有冲突`
        });
      } else {
        teacherSlotMap.set(key, a.task_id);
      }
    });

    // H2: 学生不重叠
    const studentSlotMap = new Map();
    assignments.forEach(a => {
      const task = tasks.find(t => t.id === a.task_id);
      if (!task) return;

      task.student_ids?.forEach(studentId => {
        const key = `${studentId}:${a.slot_id}`;
        if (studentSlotMap.has(key)) {
          hardViolations.push({
            constraint_id: 'H2',
            task_ids: [studentSlotMap.get(key), a.task_id],
            slot: a.slot_id,
            reason: `学生 ${studentId} 在时段 ${a.slot_id} 有冲突`
          });
        } else {
          studentSlotMap.set(key, a.task_id);
        }
      });
    });

    // H5: 课时排满
    tasks.forEach(task => {
      const taskAssignments = assignments.filter(a => a.task_id === task.id);
      if (taskAssignments.length !== task.weekly_hours) {
        hardViolations.push({
          constraint_id: 'H5',
          task_ids: [task.id],
          reason: `任务 ${task.id} 应排 ${task.weekly_hours} 节，实际排了 ${taskAssignments.length} 节`
        });
      }
    });

    // 计算软约束得分
    // S1: 优先上午
    const morningCourses = state.courses.filter(c => c.prefer_morning);
    morningCourses.forEach(course => {
      const courseTasks = tasks.filter(t => t.course_id === course.id);
      courseTasks.forEach(task => {
        const taskAssignments = assignments.filter(a => a.task_id === task.id);
        taskAssignments.forEach(a => {
          const period = parseInt(a.slot_id.substring(3));
          if (period <= 5) {
            softScore += 5;
          }
        });
      });
    });

    // S3: AP落走班时段
    const walkBlocks = state.config?.walk_blocks || [];
    tasks.filter(t => t.source === 'ap').forEach(task => {
      const taskAssignments = assignments.filter(a => a.task_id === task.id);
      taskAssignments.forEach(a => {
        if (walkBlocks.includes(a.slot_id)) {
          softScore += 10;
        }
      });
    });

    res.json({
      ok: true,
      data: {
        ok: hardViolations.length === 0,
        hard_violations: hardViolations.length,
        hard_violations_details: hardViolations,
        soft_score: softScore,
        assignments_count: assignments.length,
        tasks_count: tasks.length
      }
    });
  } catch (error) {
    res.status(500).json({ ok: false, errors: [{ code: 'ERROR', msg: error.message }] });
  }
});

// API: 锁定任务时段（需要在通用路由之前）
app.post('/api/lock', (req, res) => {
  try {
    const state = readState();
    const { task_id, slot_id } = req.body;

    if (!task_id || !slot_id) {
      return res.status(400).json({ ok: false, errors: [{ code: 'INVALID', msg: '需要 task_id 和 slot_id' }] });
    }

    // 检查任务是否存在
    const task = state.teaching_tasks?.find(t => t.id === task_id);
    if (!task) {
      return res.status(404).json({ ok: false, errors: [{ code: 'NOT_FOUND', msg: `任务 ${task_id} 不存在` }] });
    }

    // 检查是否有该时段的排课
    const assignment = state.assignments?.find(a => a.task_id === task_id && a.slot_id === slot_id);
    if (!assignment) {
      return res.status(404).json({ ok: false, errors: [{ code: 'NOT_FOUND', msg: `任务 ${task_id} 在时段 ${slot_id} 没有排课` }] });
    }

    // 添加锁定
    if (!state.locks) state.locks = [];
    const existingLock = state.locks.find(l => l.task_id === task_id && l.slot_id === slot_id);
    if (!existingLock) {
      state.locks.push({ task_id, slot_id, locked_at: new Date().toISOString() });
      writeState(state);
    }

    res.json({ ok: true, data: { task_id, slot_id, locked: true } });
  } catch (error) {
    res.status(500).json({ ok: false, errors: [{ code: 'ERROR', msg: error.message }] });
  }
});

// API: 解锁任务时段（需要在通用路由之前）
app.post('/api/unlock', (req, res) => {
  try {
    const state = readState();
    const { task_id, slot_id } = req.body;

    if (!task_id || !slot_id) {
      return res.status(400).json({ ok: false, errors: [{ code: 'INVALID', msg: '需要 task_id 和 slot_id' }] });
    }

    // 移除锁定
    if (state.locks) {
      state.locks = state.locks.filter(l => !(l.task_id === task_id && l.slot_id === slot_id));
      writeState(state);
    }

    res.json({ ok: true, data: { task_id, slot_id, locked: false } });
  } catch (error) {
    res.status(500).json({ ok: false, errors: [{ code: 'ERROR', msg: error.message }] });
  }
});

// API: 构建教学任务（需要在通用路由之前）
app.post('/api/build-tasks', (req, res) => {
  try {
    const state = readState();

    if (state.teaching_assignments.length === 0) {
      return res.status(400).json({ ok: false, errors: [{ code: 'NO_DATA', msg: '没有教师分工数据' }] });
    }

    // 生成必修教学任务
    const requiredTasks = state.teaching_assignments.map(assignment => {
      let studentIds = [];
      let roomId;

      if (assignment.class_type === 'admin') {
        const adminClass = state.admin_classes.find(c => c.id === assignment.class_id);
        if (adminClass) {
          studentIds = adminClass.student_ids;
          roomId = adminClass.fixed_room_id;
        }
      } else {
        const teachingClass = state.teaching_classes.find(c => c.id === assignment.class_id);
        if (teachingClass) {
          studentIds = teachingClass.student_ids;
          roomId = teachingClass.fixed_room_id;
        }
      }

      return {
        id: `TASK_REQ_${assignment.id}`,
        source: 'required',
        course_id: assignment.course_id,
        teacher_id: assignment.teacher_id,
        student_ids: studentIds,
        weekly_hours: assignment.weekly_hours,
        room_policy: 'pinned',
        room_id: roomId,
        source_class_id: assignment.class_id,
      };
    });

    // 合并现有任务
    const existingApTasks = state.teaching_tasks?.filter(t => t.source === 'ap') || [];
    state.teaching_tasks = [...requiredTasks, ...existingApTasks];

    writeState(state);
    res.json({ ok: true, data: { tasks_generated: requiredTasks.length, total_tasks: state.teaching_tasks.length } });
  } catch (error) {
    res.status(500).json({ ok: false, errors: [{ code: 'ERROR', msg: error.message }] });
  }
});

// API: 排课求解（需要在通用路由之前）
app.post('/api/solve', (req, res) => {
  try {
    const state = readState();
    const { seed, timeout, keep } = req.body;

    if (!state.teaching_tasks || state.teaching_tasks.length === 0) {
      return res.status(400).json({ ok: false, errors: [{ code: 'NO_TASKS', msg: '没有教学任务，请先生成教学任务' }] });
    }

    // 简化的排课算法（实际应用中应该使用更复杂的算法）
    const tasks = state.teaching_tasks;
    const assignments = [];
    const slots = [];

    // 生成时段列表
    for (let day = 1; day <= 5; day++) {
      for (let period = 1; period <= 10; period++) {
        slots.push(`D${day}P${period}`);
      }
    }

    // 为每个任务分配时段
    tasks.forEach(task => {
      let assigned = 0;
      const course = state.courses.find(c => c.id === task.course_id);

      for (let i = 0; i < task.weekly_hours && assigned < task.weekly_hours; i++) {
        // 找一个可用的时段
        const availableSlot = slots.find(slot => {
          // 检查教师冲突
          const teacherConflict = assignments.some(a => {
            const otherTask = tasks.find(t => t.id === a.task_id);
            return otherTask?.teacher_id === task.teacher_id && a.slot_id === slot;
          });
          if (teacherConflict) return false;

          // 检查学生冲突
          const studentConflict = task.student_ids?.some(studentId =>
            assignments.some(a => {
              const otherTask = tasks.find(t => t.id === a.task_id);
              return otherTask?.student_ids?.includes(studentId) && a.slot_id === slot;
            })
          );
          if (studentConflict) return false;

          return true;
        });

        if (availableSlot) {
          // 找可用教室
          const room = state.rooms.find(r => {
            if (task.room_policy === 'assign' && course?.required_room_type && r.type !== course.required_room_type) {
              return false;
            }
            return !assignments.some(a => a.slot_id === availableSlot && a.room_id === r.id);
          });

          assignments.push({
            task_id: task.id,
            slot_id: availableSlot,
            room_id: room?.id || 'UNKNOWN'
          });
          assigned++;
        }
      }
    });

    // 计算违规和得分
    const hardViolations = [];
    let softScore = 0;

    // 检查是否所有任务都排满
    tasks.forEach(task => {
      const taskAssignments = assignments.filter(a => a.task_id === task.id);
      if (taskAssignments.length !== task.weekly_hours) {
        hardViolations.push({
          constraint_id: 'H5',
          task_ids: [task.id],
          reason: `任务 ${task.id} 应排 ${task.weekly_hours} 节，实际排了 ${taskAssignments.length} 节`
        });
      }
    });

    // 更新状态
    state.assignments = assignments;
    state.last_solve = {
      timestamp: new Date().toISOString(),
      seed: seed || Date.now(),
      assignments_count: assignments.length,
      hard_violations: hardViolations.length,
      soft_score: softScore
    };

    writeState(state);

    res.json({
      ok: true,
      data: {
        assignments,
        hard_violations: hardViolations,
        soft_score: softScore,
        ok: hardViolations.length === 0
      }
    });
  } catch (error) {
    res.status(500).json({ ok: false, errors: [{ code: 'ERROR', msg: error.message }] });
  }
});

// API: 拖拽调课 - 移动任务到新时段（需要在通用路由之前）
app.post('/api/swap', (req, res) => {
  try {
    const state = readState();
    const { task_id, from_slot, to_slot } = req.body;

    if (!task_id || !from_slot || !to_slot) {
      return res.status(400).json({
        ok: false,
        errors: [{ code: 'INVALID', msg: '需要 task_id, from_slot 和 to_slot' }]
      });
    }

    // 检查任务是否存在
    const task = state.teaching_tasks?.find(t => t.id === task_id);
    if (!task) {
      return res.status(404).json({ ok: false, errors: [{ code: 'NOT_FOUND', msg: `任务 ${task_id} 不存在` }] });
    }

    // 检查是否有锁定
    const isLocked = state.locks?.some(l => l.task_id === task_id && l.slot_id === from_slot);
    if (isLocked) {
      return res.status(400).json({
        ok: false,
        errors: [{ code: 'LOCKED', msg: `任务 ${task_id} 在时段 ${from_slot} 已锁定` }]
      });
    }

    // 检查原时段是否有排课
    const assignmentIndex = state.assignments?.findIndex(
      a => a.task_id === task_id && a.slot_id === from_slot
    );
    if (assignmentIndex === -1 || assignmentIndex === undefined) {
      return res.status(404).json({
        ok: false,
        errors: [{ code: 'NOT_FOUND', msg: `任务 ${task_id} 在时段 ${from_slot} 没有排课` }]
      });
    }

    // 检查新时段教师是否空闲
    const teacherBusy = state.assignments?.some(a => {
      if (a.task_id === task_id) return false;
      const otherTask = state.teaching_tasks?.find(t => t.id === a.task_id);
      return otherTask?.teacher_id === task.teacher_id && a.slot_id === to_slot;
    });
    if (teacherBusy) {
      return res.status(400).json({
        ok: false,
        errors: [{ code: 'CONFLICT', msg: `教师在时段 ${to_slot} 已有其他课程` }]
      });
    }

    // 检查新时段学生是否冲突
    const studentConflict = task.student_ids?.some(studentId =>
      state.assignments?.some(a => {
        if (a.task_id === task_id) return false;
        const otherTask = state.teaching_tasks?.find(t => t.id === a.task_id);
        return otherTask?.student_ids?.includes(studentId) && a.slot_id === to_slot;
      })
    );
    if (studentConflict) {
      return res.status(400).json({
        ok: false,
        errors: [{ code: 'CONFLICT', msg: `学生在时段 ${to_slot} 有其他课程冲突` }]
      });
    }

    // 找可用教室
    const course = state.courses.find(c => c.id === task.course_id);
    const availableRooms = state.rooms.filter(r => {
      // 类型匹配
      if (task.room_policy === 'assign' && course?.required_room_type && r.type !== course.required_room_type) {
        return false;
      }
      // 教室不重叠
      return !state.assignments?.some((a, i) => {
        if (i === assignmentIndex) return false;
        return a.slot_id === to_slot && a.room_id === r.id;
      });
    });

    if (availableRooms.length === 0) {
      return res.status(400).json({
        ok: false,
        errors: [{ code: 'NO_ROOM', msg: `时段 ${to_slot} 没有可用教室` }]
      });
    }

    // 执行移动
    const newRoomId = task.room_policy === 'pinned' ? task.room_id : availableRooms[0].id;
    state.assignments[assignmentIndex] = {
      ...state.assignments[assignmentIndex],
      slot_id: to_slot,
      room_id: newRoomId
    };

    writeState(state);

    res.json({
      ok: true,
      data: {
        task_id,
        from_slot,
        to_slot,
        new_room: newRoomId,
        message: `已将任务 ${task_id} 从 ${from_slot} 移动到 ${to_slot}`
      }
    });
  } catch (error) {
    res.status(500).json({ ok: false, errors: [{ code: 'ERROR', msg: error.message }] });
  }
});

// API: 运行分班引擎
app.post('/api/solve-sections', (req, res) => {
  try {
    const state = readState();
    const config = req.body || {};

    // 默认配置
    const sectioningConfig = {
      max_students_per_section: config.max_students_per_section || 30,
      balance_sections: config.balance_sections !== false,
      respect_student_preferences: config.respect_student_preferences !== false,
    };

    // 从学生的 ap_courses 字段收集AP选课数据
    const courseStudents = new Map();
    state.students.forEach(student => {
      if (!student.ap_courses || student.ap_courses.length === 0) return;
      student.ap_courses.forEach(courseId => {
        if (!courseStudents.has(courseId)) {
          courseStudents.set(courseId, []);
        }
        courseStudents.get(courseId).push(student.id);
      });
    });

    // 生成AP选修班
    const apSections = [];
    const apTasks = [];

    courseStudents.forEach((studentIds, courseId) => {
      const course = state.courses.find(c => c.id === courseId);
      if (!course) return;

      // 找能教这门课的老师
      const availableTeachers = state.teachers.filter(t =>
        t.can_teach.includes(courseId)
      );

      if (availableTeachers.length === 0) {
        console.warn(`没有能教 ${courseId} 的老师，跳过分班`);
        return;
      }

      // 计算需要多少个section
      let sectionCount = course.section_count || 1;
      // 处理 section_count 是数组的情况（跨年级课程）
      if (Array.isArray(sectionCount)) {
        sectionCount = Math.max(...sectionCount);
      }
      const maxStudents = sectioningConfig.max_students_per_section;
      const actualSectionCount = Math.max(
        Math.min(sectionCount, availableTeachers.length),
        Math.ceil(studentIds.length / maxStudents)
      );

      // 智能分班
      const sectionStudents = Array.from({ length: actualSectionCount }, () => []);

      if (sectioningConfig.balance_sections) {
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

        const sectionId = `AP_${courseId}_${i + 1}`;
        const teacher = availableTeachers[i % availableTeachers.length];

        apSections.push({
          id: sectionId,
          course_id: courseId,
          course_name: course.name,
          course_type: 'ap',
          section_index: i,
          student_ids: sectionStudents[i],
          teacher_id: teacher.id,
          room_id: null,
          capacity: sectionStudents[i].length,
          weekly_hours: course.weekly_hours,
        });

        apTasks.push({
          id: `TASK_${sectionId}`,
          source: "ap",
          course_id: courseId,
          teacher_id: teacher.id,
          student_ids: sectionStudents[i],
          weekly_hours: course.weekly_hours,
          room_policy: "assign",
          source_class_id: undefined,
          source_section_id: sectionId,
        });
      }
    });

    // 生成必修选修班
    const electiveSections = [];
    const electiveTasks = [];

    // 按组别收集必修选修课
    const groupCourses = new Map();
    state.courses
      .filter(c => c.type === "required_elective" && c.elective_group)
      .forEach(course => {
        const group = course.elective_group;
        if (!groupCourses.has(group)) {
          groupCourses.set(group, []);
        }
        groupCourses.get(group).push(course);
      });

    groupCourses.forEach((courses, group) => {
      console.log(`处理组别: ${group}, 课程数: ${courses.length}`);

      const courseStudentsMap = new Map();
      courses.forEach(c => courseStudentsMap.set(c.id, []));

      // 收集学生选择
      state.students.forEach(student => {
        if (!student.elective_choices) return;
        const choiceField = `group_${group.toLowerCase()}`;
        const chosenCourseId = student.elective_choices[choiceField];
        if (chosenCourseId && courseStudentsMap.has(chosenCourseId)) {
          courseStudentsMap.get(chosenCourseId).push(student.id);
        }
      });

      console.log(`组别 ${group} 学生分布:`, Object.fromEntries(
        [...courseStudentsMap.entries()].map(([id, students]) => [id, students.length])
      ));

      // 为每门选修课生成平行班
      courseStudentsMap.forEach((studentIds, courseId) => {
        if (studentIds.length === 0) return;

        const course = state.courses.find(c => c.id === courseId);
        if (!course) return;

        let sectionCount = course.section_count || 1;
        // 处理 section_count 是数组的情况（跨年级课程）
        if (Array.isArray(sectionCount)) {
          sectionCount = Math.max(...sectionCount);
        }
        const maxStudents = sectioningConfig.max_students_per_section;
        const actualSectionCount = Math.max(sectionCount, Math.ceil(studentIds.length / maxStudents));

        // 智能分班
        const sectionStudents = Array.from({ length: actualSectionCount }, () => []);

        if (sectioningConfig.balance_sections) {
          studentIds.forEach((studentId, index) => {
            sectionStudents[index % actualSectionCount].push(studentId);
          });
        } else {
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

          electiveSections.push({
            id: sectionId,
            course_id: courseId,
            course_name: course.name,
            course_type: 'required_elective',
            section_index: i,
            student_ids: sectionStudents[i],
            teacher_id: null,
            room_id: null,
            capacity: sectionStudents[i].length,
            weekly_hours: course.weekly_hours,
          });

          electiveTasks.push({
            id: `TASK_ELECTIVE_${courseId}_${i + 1}`,
            source: "required_elective",
            course_id: courseId,
            teacher_id: null,
            student_ids: sectionStudents[i],
            weekly_hours: course.weekly_hours,
            room_policy: "assign",
            source_class_id: undefined,
            elective_group: group,
            section_index: i,
          });
        }
      });
    });

    // 合并所有分班结果
    const allSections = [...apSections, ...electiveSections];
    const allTasks = [...apTasks, ...electiveTasks];

    // 保存到状态文件
    state.elective_sections = allSections;
    state.teaching_tasks = [...(state.teaching_tasks || []), ...allTasks];
    writeState(state);

    res.json({
      ok: true,
      data: {
        sections: allSections,
        tasks: allTasks,
        statistics: {
          ap_sections: apSections.length,
          elective_sections: electiveSections.length,
          total_sections: allSections.length,
          ap_tasks: apTasks.length,
          elective_tasks: electiveTasks.length,
          total_tasks: allTasks.length,
        }
      }
    });
  } catch (error) {
    res.status(500).json({ ok: false, errors: [{ code: 'ERROR', msg: error.message }] });
  }
});

// API: 获取分班结果
app.get('/api/elective-sections', (req, res) => {
  try {
    const state = readState();
    res.json({ ok: true, data: state.elective_sections || [] });
  } catch (error) {
    res.status(500).json({ ok: false, errors: [{ code: 'ERROR', msg: error.message }] });
  }
});

// API: 更新分班结果（手动调整）
app.put('/api/elective-sections/:id', (req, res) => {
  try {
    const state = readState();
    const sectionId = req.params.id;
    const updates = req.body;

    if (!state.elective_sections) {
      return res.status(404).json({ ok: false, errors: [{ code: 'NOT_FOUND', msg: '分班结果不存在' }] });
    }

    const sectionIndex = state.elective_sections.findIndex(s => s.id === sectionId);
    if (sectionIndex === -1) {
      return res.status(404).json({ ok: false, errors: [{ code: 'NOT_FOUND', msg: `分班 ${sectionId} 不存在` }] });
    }

    // 更新分班结果
    state.elective_sections[sectionIndex] = {
      ...state.elective_sections[sectionIndex],
      ...updates,
    };

    // 同步更新教学任务
    const taskIndex = state.teaching_tasks?.findIndex(t => t.source_section_id === sectionId);
    if (taskIndex !== -1 && taskIndex !== undefined) {
      state.teaching_tasks[taskIndex] = {
        ...state.teaching_tasks[taskIndex],
        student_ids: state.elective_sections[sectionIndex].student_ids,
        teacher_id: state.elective_sections[sectionIndex].teacher_id,
      };
    }

    writeState(state);

    res.json({ ok: true, data: state.elective_sections[sectionIndex] });
  } catch (error) {
    res.status(500).json({ ok: false, errors: [{ code: 'ERROR', msg: error.message }] });
  }
});

// API: 移动学生到不同班级
app.post('/api/elective-sections/move-student', (req, res) => {
  try {
    const state = readState();
    const { student_id, from_section_id, to_section_id } = req.body;

    if (!student_id || !from_section_id || !to_section_id) {
      return res.status(400).json({
        ok: false,
        errors: [{ code: 'INVALID', msg: '需要 student_id, from_section_id 和 to_section_id' }]
      });
    }

    if (!state.elective_sections) {
      return res.status(404).json({ ok: false, errors: [{ code: 'NOT_FOUND', msg: '分班结果不存在' }] });
    }

    const fromSection = state.elective_sections.find(s => s.id === from_section_id);
    const toSection = state.elective_sections.find(s => s.id === to_section_id);

    if (!fromSection || !toSection) {
      return res.status(404).json({ ok: false, errors: [{ code: 'NOT_FOUND', msg: '班级不存在' }] });
    }

    // 检查学生是否在源班级中
    if (!fromSection.student_ids.includes(student_id)) {
      return res.status(400).json({ ok: false, errors: [{ code: 'INVALID', msg: '学生不在源班级中' }] });
    }

    // 移动学生
    fromSection.student_ids = fromSection.student_ids.filter(id => id !== student_id);
    toSection.student_ids.push(student_id);

    // 更新容量
    fromSection.capacity = fromSection.student_ids.length;
    toSection.capacity = toSection.student_ids.length;

    // 同步更新教学任务
    const fromTaskIndex = state.teaching_tasks?.findIndex(t => t.source_section_id === from_section_id);
    const toTaskIndex = state.teaching_tasks?.findIndex(t => t.source_section_id === to_section_id);

    if (fromTaskIndex !== -1 && fromTaskIndex !== undefined) {
      state.teaching_tasks[fromTaskIndex].student_ids = fromSection.student_ids;
    }
    if (toTaskIndex !== -1 && toTaskIndex !== undefined) {
      state.teaching_tasks[toTaskIndex].student_ids = toSection.student_ids;
    }

    writeState(state);

    res.json({ ok: true, data: { from: fromSection, to: toSection } });
  } catch (error) {
    res.status(500).json({ ok: false, errors: [{ code: 'ERROR', msg: error.message }] });
  }
});

// API: 获取分班建议
app.get('/api/elective-sections/suggestions', (req, res) => {
  try {
    const state = readState();
    const suggestions = [];

    if (!state.elective_sections || state.elective_sections.length === 0) {
      return res.json({ ok: true, data: { suggestions: ['尚未运行分班引擎'] } });
    }

    // 检查班级人数均衡性
    const courseGroups = new Map();
    state.elective_sections.forEach(section => {
      if (!courseGroups.has(section.course_id)) {
        courseGroups.set(section.course_id, []);
      }
      courseGroups.get(section.course_id).push(section);
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
    const assignedStudentIds = new Set(state.elective_sections.flatMap(s => s.student_ids));
    const unassignedStudents = state.students.filter(s =>
      !assignedStudentIds.has(s.id) &&
      ((s.ap_courses && s.ap_courses.length > 0) || s.elective_choices)
    );

    if (unassignedStudents.length > 0) {
      suggestions.push(`有 ${unassignedStudents.length} 名学生未被分配到选修班`);
    }

    res.json({ ok: true, data: { suggestions } });
  } catch (error) {
    res.status(500).json({ ok: false, errors: [{ code: 'ERROR', msg: error.message }] });
  }
});

// API: 规则管理 (必须在通用路由之前)
app.get('/api/rules', (req, res) => {
  try { res.json({ ok: true, data: getRules() }); }
  catch (e) { res.status(500).json({ ok: false, errors: [{ msg: e.message }] }); }
});
app.post('/api/rules', (req, res) => {
  try { const result = applyRules(req.body.rules || []); res.json({ ok: true, data: result }); }
  catch (e) { res.status(500).json({ ok: false, errors: [{ msg: e.message }] }); }
});
app.post('/api/rules/suggest', async (req, res) => {
  try {
    const { text } = req.body;
    if (!text) return res.status(400).json({ ok: false, errors: [{ msg: '请输入规则描述' }] });
    if (!global.DEEPSEEK_API_KEY) return res.json({ ok: true, data: { suggestions: [], message: 'API Key未配置' } });
    const suggestions = await translateRule(text, global.DEEPSEEK_API_KEY);
    res.json({ ok: true, data: { text, suggestions } });
  } catch (e) { res.status(500).json({ ok: false, errors: [{ msg: e.message }] }); }
});
app.post('/api/rules/apply', async (req, res) => {
  try {
    const { text } = req.body;
    if (!text) return res.status(400).json({ ok: false, errors: [{ msg: '请输入规则描述' }] });
    if (!global.DEEPSEEK_API_KEY) return res.status(503).json({ ok: false, errors: [{ msg: 'API Key未配置' }] });
    const suggestions = await translateRule(text, global.DEEPSEEK_API_KEY);
    if (!suggestions.length) return res.json({ ok: false, errors: [{ msg: 'LLM未能解析出规则' }] });
    res.json({ ok: true, data: { suggestions, applied: applyRules(suggestions) } });
  } catch (e) { res.status(500).json({ ok: false, errors: [{ msg: e.message }] }); }
});

// API: 一键排课+验证 (必须在catch-all前)
app.post('/api/solve-all', async (req, res) => {
  try {
    const { execSync } = await import('child_process');
    const root = resolve(__dirname, '../..');
    let output = '';
    output += execSync('node ' + root + '/search-all.cjs 2000 10', { timeout: 300000, encoding: 'utf-8' });
    output += execSync('node ' + root + '/search-all.cjs 3000 11', { timeout: 300000, encoding: 'utf-8' });
    output += execSync('node ' + root + '/search-all.cjs 3000 12', { timeout: 300000, encoding: 'utf-8' });
    const state = readState();
    res.json({ ok: true, data: { output: output.slice(-500), counts: { g10: state.students.filter(s => s.grade === 10).length, g11: state.students.filter(s => s.grade === 11).length, g12: state.students.filter(s => s.grade === 12).length } } });
  } catch (e) { res.status(500).json({ ok: false, errors: [{ msg: e.message }] }); }
});
app.get('/api/validate-all', (req, res) => {
  try {
    const state = readState();
    const issues = [];
    [10, 11, 12].forEach(grade => {
      const gStudents = state.students.filter(s => s.grade === grade);
      const sample = gStudents[0];
      if (!sample) { issues.push('高' + grade + ': 无学生'); return; }
      const daily = [0, 0, 0, 0, 0];
      state.assignments.filter(a => a.student_id === sample.id).forEach(a => daily[a.slot_id.charAt(1) - 1]++);
      if (daily.some(d => d !== 10)) issues.push('高' + grade + ': 日课时≠10 (' + daily.join(',') + ')');
      const ssAM = state.assignments.filter(a => a.student_id === sample.id && a.course_id === 'SELF_STUDY' && parseInt(a.slot_id.substring(3)) <= 5).length;
      if (ssAM > 0) issues.push('高' + grade + ': 上午自习 ' + ssAM + '节');
      const dutyAt10 = state.assignments.filter(a => a.student_id === sample.id && a.course_id === 'DUTY' && a.slot_id === 'D1P10');
      if (dutyAt10.length === 0 && gStudents.some(s => s.admin_class_id && state.assignments.some(a => a.student_id === s.id && a.course_id === 'DUTY'))) issues.push('高' + grade + ': sample 值日不在D1P10');
      const meeting = state.assignments.filter(a => a.student_id === sample.id && a.course_id === 'MEETING' && a.slot_id !== 'D1P9');
      if (meeting.length > 0) issues.push('高' + grade + ': 班会不在D1P9');
    });
    res.json({ ok: issues.length === 0, data: { issues, pass: issues.length === 0 } });
  } catch (e) { res.status(500).json({ ok: false, errors: [{ msg: e.message }] }); }
});

// API: 获取实体列表
app.get('/api/:entity', (req, res) => {
  try {
    const state = readState();
    const entity = req.params.entity;

    const entityMap = {
      teachers: state.teachers,
      rooms: state.rooms,
      courses: state.courses,
      students: state.students,
      admin_classes: state.admin_classes,
      teaching_classes: state.teaching_classes,
      teaching_assignments: state.teaching_assignments,
      ap_selections: state.ap_selections,
      constraints: state.constraints,
    };

    const list = entityMap[entity];
    if (!list) {
      return res.status(404).json({ ok: false, errors: [{ code: 'NOT_FOUND', msg: `实体类型 ${entity} 不存在` }] });
    }

    res.json({ ok: true, data: list });
  } catch (error) {
    res.status(500).json({ ok: false, errors: [{ code: 'ERROR', msg: error.message }] });
  }
});

// API: 添加实体
app.post('/api/:entity', (req, res) => {
  try {
    const state = readState();
    const entity = req.params.entity;
    const body = req.body;

    const entityMap = {
      teachers: 'teachers',
      rooms: 'rooms',
      courses: 'courses',
      students: 'students',
      admin_classes: 'admin_classes',
      teaching_classes: 'teaching_classes',
      teaching_assignments: 'teaching_assignments',
      constraints: 'constraints',
      ap_selections: 'ap_selections',
    };

    const key = entityMap[entity];
    if (!key) {
      return res.status(404).json({ ok: false, errors: [{ code: 'NOT_FOUND', msg: `实体类型 ${entity} 不存在` }] });
    }

    // 特殊处理 ap_selections
    if (entity === 'ap_selections') {
      state.ap_selections.push(body);
      writeState(state);
      return res.json({ ok: true, data: body });
    }

    // 特殊处理学生：自动添加必修课
    if (entity === 'students') {
      // 根据行政班和教学班获取必修课
      const requiredCourses = getRequiredCoursesForStudent(state, body);
      body.required_courses = requiredCourses;
    }

    // 检查ID是否重复
    if (state[key].some(item => item.id === body.id)) {
      return res.status(400).json({ ok: false, errors: [{ code: 'DUPLICATE', msg: `ID ${body.id} 已存在` }] });
    }

    state[key].push(body);
    writeState(state);
    res.json({ ok: true, data: body });
  } catch (error) {
    res.status(500).json({ ok: false, errors: [{ code: 'ERROR', msg: error.message }] });
  }
});

// 获取学生的必修课
function getRequiredCoursesForStudent(state, student) {
  const requiredCourses = new Set();

  // 从行政班获取必修课
  if (student.admin_class_id) {
    const adminAssignments = state.teaching_assignments.filter(
      a => a.class_id === student.admin_class_id && a.class_type === 'admin'
    );
    adminAssignments.forEach(a => requiredCourses.add(a.course_id));
  }

  // 从教学班获取必修课
  if (student.teaching_class_id) {
    const teachingAssignments = state.teaching_assignments.filter(
      a => a.class_id === student.teaching_class_id && a.class_type === 'teaching'
    );
    teachingAssignments.forEach(a => requiredCourses.add(a.course_id));
  }

  return Array.from(requiredCourses);
}

// API: 更新实体
app.put('/api/:entity/:id', (req, res) => {
  try {
    const state = readState();
    const entity = req.params.entity;
    const id = req.params.id;
    const body = req.body;

    const entityMap = {
      teachers: 'teachers',
      rooms: 'rooms',
      courses: 'courses',
      students: 'students',
      admin_classes: 'admin_classes',
      teaching_classes: 'teaching_classes',
      teaching_assignments: 'teaching_assignments',
      constraints: 'constraints',
    };

    const key = entityMap[entity];
    if (!key) {
      return res.status(404).json({ ok: false, errors: [{ code: 'NOT_FOUND', msg: `实体类型 ${entity} 不存在` }] });
    }

    const index = state[key].findIndex(item => item.id === id);
    if (index === -1) {
      return res.status(404).json({ ok: false, errors: [{ code: 'NOT_FOUND', msg: `实体 ${id} 不存在` }] });
    }

    state[key][index] = { ...state[key][index], ...body };
    writeState(state);
    res.json({ ok: true, data: state[key][index] });
  } catch (error) {
    res.status(500).json({ ok: false, errors: [{ code: 'ERROR', msg: error.message }] });
  }
});

// API: 删除实体
app.delete('/api/:entity/:id', (req, res) => {
  try {
    const state = readState();
    const entity = req.params.entity;
    const id = req.params.id;

    const entityMap = {
      teachers: 'teachers',
      rooms: 'rooms',
      courses: 'courses',
      students: 'students',
      admin_classes: 'admin_classes',
      teaching_classes: 'teaching_classes',
      teaching_assignments: 'teaching_assignments',
      ap_selections: 'ap_selections',
      constraints: 'constraints',
    };

    const key = entityMap[entity];
    if (!key) {
      return res.status(404).json({ ok: false, errors: [{ code: 'NOT_FOUND', msg: `实体类型 ${entity} 不存在` }] });
    }

    // 特殊处理 ap_selections
    if (entity === 'ap_selections') {
      state.ap_selections = state.ap_selections.filter(s => s.student_id !== id);
      writeState(state);
      return res.json({ ok: true, data: { removed: id } });
    }

    const index = state[key].findIndex(item => item.id === id);
    if (index === -1) {
      return res.status(404).json({ ok: false, errors: [{ code: 'NOT_FOUND', msg: `实体 ${id} 不存在` }] });
    }

    state[key].splice(index, 1);
    writeState(state);
    res.json({ ok: true, data: { removed: id } });
  } catch (error) {
    res.status(500).json({ ok: false, errors: [{ code: 'ERROR', msg: error.message }] });
  }
});

// API: 校验输入
app.get('/api/validate-input', (req, res) => {
  try {
    const state = readState();
    const errors = [];

    // 检查引用完整性
    state.teachers.forEach(t => {
      t.can_teach.forEach(courseId => {
        if (!state.courses.find(c => c.id === courseId)) {
          errors.push({ code: 'MISSING_REF', msg: `教师 ${t.id} 引用的课程 ${courseId} 不存在` });
        }
      });
    });

    state.students.forEach(s => {
      if (!state.admin_classes.find(c => c.id === s.admin_class_id)) {
        errors.push({ code: 'MISSING_REF', msg: `学生 ${s.id} 引用的行政班 ${s.admin_class_id} 不存在` });
      }
      if (!state.teaching_classes.find(c => c.id === s.teaching_class_id)) {
        errors.push({ code: 'MISSING_REF', msg: `学生 ${s.id} 引用的教学班 ${s.teaching_class_id} 不存在` });
      }
    });

    res.json({ ok: errors.length === 0, data: { ok: errors.length === 0, errors } });
  } catch (error) {
    res.status(500).json({ ok: false, errors: [{ code: 'ERROR', msg: error.message }] });
  }
});

// API: 获取课表
app.get('/api/timetable/:by/:id', (req, res) => {
  try {
    const state = readState();
    const { by, id } = req.params;

    if (!state.assignments || state.assignments.length === 0) {
      return res.json({ ok: true, data: { title: '无排课结果', rows: [] } });
    }

    const assignments = state.assignments;
    const rows = [];

    // 根据维度获取相关排课
    let relatedAssignments = [];
    let title = '';

    switch (by) {
      case 'student':
        // 学生课表：找到该学生所在班级的所有排课
        const student = state.students.find(s => s.id === id);
        if (student) {
          relatedAssignments = assignments.filter(a =>
            a.class_id === student.teaching_class_id ||
            a.class_id === student.admin_class_id ||
            a.class_id === id ||
            a.task_id?.includes(student.teaching_class_id) ||
            a.task_id?.includes(student.admin_class_id)
          );
        }
        title = `学生 ${id} 的课表`;
        break;

      case 'teacher':
        // 教师课表：找到该教师的所有排课
        relatedAssignments = assignments.filter(a => {
          const task = state.teaching_tasks?.find(t => t.id === a.task_id);
          return task?.teacher_id === id;
        });
        // 如果没有 teaching_tasks，尝试从 assignments 中直接查找
        if (relatedAssignments.length === 0) {
          relatedAssignments = assignments.filter(a =>
            a.teacher_id === id
          );
        }
        title = `教师 ${id} 的课表`;
        break;

      case 'class':
        // 班级课表：找到该班级学生的所有排课（包括行政班课程）
        const classStudents = state.students.filter(s =>
          s.teaching_class_id === id || s.admin_class_id === id
        );
        const classStudentIds = new Set(classStudents.map(s => s.id));

        // 获取该教学班学生所属的行政班
        const adminClasses = [...new Set(classStudents.map(s => s.admin_class_id))];

        relatedAssignments = assignments.filter(a => {
          // 教学班课程
          if (a.class_id === id || a.task_id?.includes(id)) return true;
          // 行政班课程（学生也在这个教学班）
          if (classStudents.some(s => s.admin_class_id === a.class_id)) return true;
          // 学生个人选修课
          if (classStudentIds.has(a.class_id)) return true;
          return false;
        });

        // 保存行政班信息，用于前端显示
        title = `班级 ${id} 的课表`;
        // 将行政班信息附加到响应中
        res.locals = { adminClasses };
        break;

      case 'room':
        // 教室课表：找到使用该教室的所有排课
        relatedAssignments = assignments.filter(a => a.room_id === id);
        title = `教室 ${id} 的课表`;
        break;

      case 'all':
        relatedAssignments = assignments;
        title = `${state.meta?.school || '学校'}全部课表`;
        break;

      default:
        return res.status(400).json({ ok: false, errors: [{ code: 'INVALID', msg: '无效的维度' }] });
    }

    // 生成课表行
    for (let period = 1; period <= 10; period++) {
      const row = [`${period}`];
      for (let day = 1; day <= 5; day++) {
        const slotId = `D${day}P${period}`;
        const slotAssignments = relatedAssignments.filter(a => a.slot_id === slotId);

        if (slotAssignments.length > 0) {
          // 如果是教学班课表，需要区分不同行政班的课程
          if (by === 'class' && id.startsWith('TC_')) {
            // 教学班课表：区分行政班课程
            const adminClassAssignments = slotAssignments.filter(a => a.class_type === 'admin');
            const teachingClassAssignments = slotAssignments.filter(a => a.class_type === 'teaching' || a.class_type === 'filler');
            const electiveAssignments = slotAssignments.filter(a => a.class_type?.startsWith('elective') || a.class_type === 'ap');

            const slotData = {
              slot_id: slotId,
              admin_courses: {},
              teaching_course: null,
              elective_course: null
            };

            // 行政班课程（可能有多个）
            adminClassAssignments.forEach(a => {
              const course = state.courses.find(c => c.id === a.course_id);
              const teacher = state.teachers.find(t => t.id === a.teacher_id);
              slotData.admin_courses[a.class_id] = {
                course: course?.name || a.course_id || '?',
                course_type: course?.type || 'required',
                teacher: teacher?.name || a.teacher_id || '?',
                room: a.room_id,
              };
            });

            // 教学班课程（只有一个）
            if (teachingClassAssignments.length > 0) {
              const a = teachingClassAssignments[0];
              const course = state.courses.find(c => c.id === a.course_id);
              const teacher = state.teachers.find(t => t.id === a.teacher_id);
              slotData.teaching_course = {
                course: course?.name || a.course_id || '?',
                course_type: course?.type || 'required',
                teacher: teacher?.name || a.teacher_id || '?',
                room: a.room_id,
              };
            }

            // 选修课（只有一个）
            if (electiveAssignments.length > 0) {
              const a = electiveAssignments[0];
              const course = state.courses.find(c => c.id === a.course_id);
              const teacher = state.teachers.find(t => t.id === a.teacher_id);
              slotData.elective_course = {
                course: course?.name || a.course_id || '?',
                course_type: course?.type || 'required',
                teacher: teacher?.name || a.teacher_id || '?',
                room: a.room_id,
              };
            }

            row.push(slotData);
          } else {
            // 其他课表：直接显示第一个排课
            const assignment = slotAssignments[0];
            const course = state.courses.find(c => c.id === assignment.course_id);
            const teacher = state.teachers.find(t => t.id === assignment.teacher_id);
            row.push({
              task_id: assignment.task_id,
              course: course?.name || assignment.course_id || '?',
              course_type: course?.type || 'required',
              teacher: teacher?.name || assignment.teacher_id || '?',
              room: assignment.room_id,
            });
          }
        } else {
          row.push(null);
        }
      }
      rows.push(row);
    }

    res.json({
      ok: true,
      data: {
        title,
        rows,
        adminClasses: res.locals?.adminClasses || []
      }
    });
  } catch (error) {
    res.status(500).json({ ok: false, errors: [{ code: 'ERROR', msg: error.message }] });
  }
});

// API: LLM 智能排课建议（使用 DeepSeek）
app.post('/api/ai/suggest', async (req, res) => {
  try {
    const state = readState();
    const { task_id, preference } = req.body;

    // 获取任务信息
    const task = state.teaching_tasks?.find(t => t.id === task_id);
    if (!task) {
      return res.status(404).json({ ok: false, errors: [{ code: 'NOT_FOUND', msg: `任务 ${task_id} 不存在` }] });
    }

    const course = state.courses.find(c => c.id === task.course_id);
    const teacher = state.teachers.find(t => t.id === task.teacher_id);

    // 分析当前课表状态
    const currentAssignments = state.assignments?.filter(a => a.task_id === task_id) || [];
    const occupiedSlots = new Set(currentAssignments.map(a => a.slot_id));

    // 找出可用时段
    const availableSlots = [];
    for (let day = 1; day <= 5; day++) {
      for (let period = 1; period <= 10; period++) {
        const slotId = `D${day}P${period}`;
        if (!occupiedSlots.has(slotId)) {
          // 检查教师是否空闲
          const teacherBusy = state.assignments?.some(a => {
            const otherTask = state.teaching_tasks?.find(t => t.id === a.task_id);
            return otherTask?.teacher_id === task.teacher_id && a.slot_id === slotId;
          });

          // 检查学生是否冲突
          const studentConflict = task.student_ids?.some(studentId =>
            state.assignments?.some(a => {
              const otherTask = state.teaching_tasks?.find(t => t.id === a.task_id);
              return otherTask?.student_ids?.includes(studentId) && a.slot_id === slotId;
            })
          );

          if (!teacherBusy && !studentConflict) {
            availableSlots.push({
              slot_id: slotId,
              day,
              period,
              is_walk_block: state.config.walk_blocks.includes(slotId),
              is_morning: period <= state.config.time_model.lunch_break_after_period
            });
          }
        }
      }
    }

    // 使用 DeepSeek 生成智能建议
    const systemPrompt = `你是一个排课系统的智能助手。根据以下信息，为教学任务推荐最佳的排课时段。

课程信息：
- 课程名称：${course?.name || '未知'}
- 课程类型：${task.source === 'ap' ? 'AP选修' : '必修'}
- 教师：${teacher?.name || '未知'}
- 学生人数：${task.student_ids?.length || 0}
- 每周课时：${task.weekly_hours}
- 课程特性：${course?.prefer_morning ? '优先上午' : ''} ${course?.consecutive ? '需要连堂' : ''}

可用时段（共${availableSlots.length}个）：
${availableSlots.map(s => `- ${s.slot_id} (周${s.day}第${s.period}节, ${s.is_morning ? '上午' : '下午'}${s.is_walk_block ? ', 走班时段' : ''})`).join('\n')}

用户偏好：${preference || '无特殊偏好'}

请推荐5个最佳时段，按推荐度从高到低排序。输出JSON格式：
[
  {"slot_id": "D1P1", "reason": "推荐原因", "score": 95}
]

只输出JSON数组，不要有其他内容。`;

    let suggestions = [];

    try {
      const response = await callDeepSeek([
        { role: 'system', content: systemPrompt },
        { role: 'user', content: '请推荐最佳排课时段' }
      ], { temperature: 0.5 });

      // 解析 JSON 响应
      const jsonMatch = response.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        const aiSuggestions = JSON.parse(jsonMatch[0]);
        suggestions = aiSuggestions.map(s => ({
          ...s,
          day: parseInt(s.slot_id.charAt(1)),
          period: parseInt(s.slot_id.substring(3)),
          ai_powered: true
        }));
      }
    } catch (e) {
      console.error('DeepSeek 建议生成失败，使用规则引擎:', e);
    }

    // 如果 AI 建议失败，使用规则引擎
    if (suggestions.length === 0) {
      let scoredSlots = availableSlots.map(slot => {
        let score = 50; // 基础分

        // 上午优先
        if (slot.is_morning && course?.prefer_morning) score += 20;

        // 走班时段优先（AP课程）
        if (slot.is_walk_block && task.source === 'ap') score += 30;

        // 连堂需求
        if (course?.consecutive) {
          const adjacentSlots = availableSlots.filter(s =>
            s.day === slot.day && Math.abs(s.period - slot.period) === 1
          );
          if (adjacentSlots.length > 0) score += 15;
        }

        // 分散均衡
        const sameDayCount = state.assignments?.filter(a => {
          const t = state.teaching_tasks?.find(t => t.id === a.task_id);
          return t?.course_id === task.course_id && a.slot_id.startsWith(`D${slot.day}`);
        }).length || 0;
        score -= sameDayCount * 5;

        return { ...slot, score };
      });

      // 按分数排序
      scoredSlots.sort((a, b) => b.score - a.score);

      suggestions = scoredSlots.slice(0, 5).map(slot => ({
        slot_id: slot.slot_id,
        day: slot.day,
        period: slot.period,
        score: slot.score,
        reason: generateSuggestionReason(slot, task, course),
        ai_powered: false
      }));
    }

    res.json({
      ok: true,
      data: {
        task_id,
        task_info: {
          course: course?.name,
          teacher: teacher?.name,
          student_count: task.student_ids?.length || 0,
          weekly_hours: task.weekly_hours
        },
        suggestions,
        total_available: availableSlots.length,
        ai_powered: suggestions[0]?.ai_powered || false
      }
    });
  } catch (error) {
    res.status(500).json({ ok: false, errors: [{ code: 'ERROR', msg: error.message }] });
  }
});

// 生成建议原因
function generateSuggestionReason(slot, task, course) {
  const reasons = [];

  if (slot.is_morning && course?.prefer_morning) {
    reasons.push('优先上午时段');
  }

  if (slot.is_walk_block && task.source === 'ap') {
    reasons.push('走班时段，适合AP课程');
  }

  if (slot.period <= 5) {
    reasons.push('上午时段');
  } else {
    reasons.push('下午时段');
  }

  if (slot.is_walk_block) {
    reasons.push('走班时段');
  }

  return reasons.join('，') || '可用时段';
}

// API: AI 智能求解（生成多个最优解）
app.post('/api/ai/solve', async (req, res) => {
  try {
    const state = readState();
    const { text } = req.body;

    if (!text) {
      return res.status(400).json({ ok: false, errors: [{ code: 'INVALID', msg: '请输入排课需求' }] });
    }

    // 完整的系统提示词
    const systemPrompt = `你是一个专业的排课系统 AI 助手。你的任务是帮助用户完成课程安排。

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
2. **学生不重叠**：同一学生同一时段只能上一门课
3. **教室不重叠**：同一教室同一时段只能有一门课
4. **教室容量**：每个班的学生数 ≤ 教室容量
5. **课时排满**：每门课必须排满规定的周课时
6. **教师日上限**：每位教师每天上课节数有上限（默认8节）

### 软约束（优化目标）
1. **优先上午**：主要学术课程优先排在上午（第1-5节）
2. **连堂课**：实验课等需要连续两节，优先排相邻时段
3. **AP优先走班时段**：AP课程优先排在走班时段（下午第6-7节）
4. **课表分散均衡**：同一课程在一周内尽量不连续排

## 走班时段

走班时段是专门为AP选修课预留的时间窗口：
- 周一第6-7节（14:00-15:30）
- 周二第6-7节
- 周三第6-7节
- 周四第6-7节
- 周五第6-7节

共5天×2节=10个走班时段/周。

## 当前数据状态

### 教师列表
${state.teachers.map(t => `- ${t.id}: ${t.name}（可教课程: ${t.can_teach.join(', ')}）`).join('\n')}

### 课程列表
${state.courses.map(c => `- ${c.id}: ${c.name}（${c.type === 'ap' ? 'AP选修' : c.type === 'required_elective' ? '必修选修' : '必修'}，${c.weekly_hours}节/周）`).join('\n')}

### 教室列表
${state.rooms.map(r => `- ${r.id}: ${r.name}（${r.type}，容量${r.capacity}）`).join('\n')}

### 学生选课情况
- 高二学生AP选课：${state.students.filter(s => s.grade === 11 && s.ap_courses?.length > 0).length}人
- 高三学生AP选课：${state.students.filter(s => s.grade === 12 && s.ap_courses?.length > 0).length}人
- 高三学生必修选修课选择：${state.students.filter(s => s.grade === 12 && s.elective_choices).length}人

## 输出要求

当用户要求排课时，你需要：
1. 分析用户的指令，确定需要排哪些课程
2. 生成完整的排课方案
3. 输出可执行的排课命令

排课命令格式：
\`\`\`json
{
  "action": "schedule",
  "grade": "10",
  "tasks": [
    {
      "task_id": "TASK_XXX",
      "course_id": "ENG_LS",
      "class_id": "TC_G10_1",
      "class_type": "teaching",
      "weekly_hours": 3,
      "assignments": [
        {"slot_id": "D1P1", "room_id": "R1"},
        {"slot_id": "D2P1", "room_id": "R1"},
        {"slot_id": "D3P1", "room_id": "R1"}
      ]
    }
  ],
  "summary": {
    "total_tasks": 18,
    "total_hours": 50,
    "conflicts": 0
  }
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
`;

    // 调用 AI 生成排课方案
    const response = await callDeepSeek([
      { role: 'system', content: systemPrompt },
      { role: 'user', content: text }
    ], { temperature: 0.7 });

    // 解析响应
    let result;
    try {
      // 尝试解析 JSON
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        result = JSON.parse(jsonMatch[0]);
      } else {
        // 如果不是 JSON，返回文本响应
        result = {
          action: 'text',
          message: response
        };
      }
    } catch (e) {
      result = {
        action: 'text',
        message: response
      };
    }

    // 如果是排课命令，执行排课
    if (result.action === 'schedule' && result.tasks) {
      // 保存排课结果
      state.scheduled_tasks = result.tasks;
      writeState(state);

      res.json({
        ok: true,
        data: {
          user_input: text,
          ai_response: result,
          message: `已生成 ${result.tasks.length} 个教学任务的排课方案`,
          summary: result.summary
        }
      });
    } else {
      res.json({
        ok: true,
        data: {
          user_input: text,
          ai_response: result,
          message: result.message || '请提供更具体的排课需求'
        }
      });
    }
  } catch (error) {
    console.error('AI 求解失败:', error);
    res.status(500).json({ ok: false, errors: [{ code: 'ERROR', msg: error.message }] });
  }
});

// 生成多个最优解
async function generateMultipleSolutions(state, constraints) {
  const solutions = [];
  const tasks = state.teaching_tasks || [];

  if (tasks.length === 0) {
    return solutions;
  }

  // 使用不同的随机种子生成多个解
  for (let i = 0; i < 3; i++) {
    const seed = Date.now() + i * 1000;
    const assignments = generateSolution(state, tasks, constraints, seed);

    // 评估解的质量
    const score = evaluateSolution(state, assignments, tasks, constraints);

    solutions.push({
      id: i + 1,
      seed: seed,
      score: score.total,
      assignments: assignments,
      details: {
        hard_violations: score.hard_violations,
        soft_score: score.soft_score,
        constraint_satisfaction: score.constraint_satisfaction
      }
    });
  }

  // 按分数排序
  solutions.sort((a, b) => b.score - a.score);

  return solutions;
}

// 生成单个解
function generateSolution(state, tasks, constraints, seed) {
  const assignments = [];
  const slots = generateTimeSlots(state.config);

  // 简单的贪心算法（带约束）
  tasks.forEach(task => {
    const course = state.courses.find(c => c.id === task.course_id);
    let remaining = task.weekly_hours;

    for (let i = 0; i < remaining; i++) {
      // 找最佳时段
      let bestSlot = null;
      let bestScore = -1;

      slots.forEach(slot => {
        // 检查是否已分配
        if (assignments.some(a => a.task_id === task.id && a.slot_id === slot.id)) {
          return;
        }

        // 检查教师冲突
        const teacherConflict = assignments.some(a => {
          const otherTask = tasks.find(t => t.id === a.task_id);
          return otherTask?.teacher_id === task.teacher_id && a.slot_id === slot.id;
        });
        if (teacherConflict) return;

        // 检查学生冲突
        const studentConflict = task.student_ids?.some(studentId =>
          assignments.some(a => {
            const otherTask = tasks.find(t => t.id === a.task_id);
            return otherTask?.student_ids?.includes(studentId) && a.slot_id === slot.id;
          })
        );
        if (studentConflict) return;

        // 计算这个时段的分数
        let score = 50;

        // 应用约束
        constraints.forEach(constraint => {
          if (constraint.type === 'spread' && constraint.course_id === task.course_id) {
            // 分散约束：同课程同日扣分
            const sameDayCount = assignments.filter(a => {
              const t = tasks.find(t => t.id === a.task_id);
              return t?.course_id === task.course_id && a.slot_id.startsWith(`D${slot.day}`);
            }).length;
            score -= sameDayCount * 20;
          }

          if (constraint.type === 'prefer_morning' && constraint.course_id === task.course_id) {
            // 上午优先
            if (slot.is_morning) score += 30;
          }

          if (constraint.type === 'forbidden') {
            // 禁排时段
            if (constraint.slots?.includes(slot.id)) score -= 100;
          }

          if (constraint.type === 'prefer_walk_blocks' && task.source === 'ap') {
            // 走班优先
            if (slot.is_walk_block) score += 25;
          }
        });

        if (score > bestScore) {
          bestScore = score;
          bestSlot = slot;
        }
      });

      if (bestSlot) {
        // 找可用教室
        const room = findAvailableRoom(state, task, bestSlot, assignments);
        assignments.push({
          task_id: task.id,
          slot_id: bestSlot.id,
          room_id: room?.id || 'UNKNOWN'
        });
      }
    }
  });

  return assignments;
}

// 生成时段列表
function generateTimeSlots(config) {
  const slots = [];
  for (let day = 1; day <= config.time_model.days; day++) {
    for (let period = 1; period <= config.time_model.periods_per_day; period++) {
      const id = `D${day}P${period}`;
      const session = period <= config.time_model.lunch_break_after_period ? 'AM' : 'PM';
      const is_walk_block = config.walk_blocks?.includes(id) || false;
      slots.push({ id, day, period, session, is_walk_block, is_morning: session === 'AM' });
    }
  }
  return slots;
}

// 找可用教室
function findAvailableRoom(state, task, slot, assignments) {
  const course = state.courses.find(c => c.id === task.course_id);

  return state.rooms.find(room => {
    // 类型匹配
    if (task.room_policy === 'assign' && course?.required_room_type && room.type !== course.required_room_type) {
      return false;
    }
    // 容量检查
    if (task.student_ids?.length > room.capacity) {
      return false;
    }
    // 不重叠
    return !assignments.some(a => a.slot_id === slot.id && a.room_id === room.id);
  });
}

// 评估解的质量
function evaluateSolution(state, assignments, tasks, constraints) {
  let hard_violations = 0;
  let soft_score = 0;
  let constraint_satisfaction = 0;

  // 检查硬约束
  tasks.forEach(task => {
    const taskAssignments = assignments.filter(a => a.task_id === task.id);
    if (taskAssignments.length !== task.weekly_hours) {
      hard_violations++;
    }
  });

  // 评估软约束满足度
  constraints.forEach(constraint => {
    if (constraint.type === 'spread') {
      const courseAssignments = assignments.filter(a => {
        const task = tasks.find(t => t.id === a.task_id);
        return task?.course_id === constraint.course_id;
      });

      const dayCounts = {};
      courseAssignments.forEach(a => {
        const day = a.slot_id.charAt(1);
        dayCounts[day] = (dayCounts[day] || 0) + 1;
      });

      const maxPerDay = Math.max(...Object.values(dayCounts), 0);
      if (maxPerDay <= (constraint.max_per_day || 1)) {
        constraint_satisfaction += 20;
      }
    }

    if (constraint.type === 'prefer_morning') {
      const courseAssignments = assignments.filter(a => {
        const task = tasks.find(t => t.id === a.task_id);
        return task?.course_id === constraint.course_id;
      });

      const morningCount = courseAssignments.filter(a => {
        const period = parseInt(a.slot_id.substring(3));
        return period <= 5;
      }).length;

      constraint_satisfaction += morningCount * 5;
    }
  });

  return {
    total: constraint_satisfaction - hard_violations * 100,
    hard_violations,
    soft_score: soft_score,
    constraint_satisfaction
  };
}

// API: 批量更新学生的必修课
app.post('/api/students/update-required-courses', (req, res) => {
  try {
    const state = readState();
    let updatedCount = 0;

    state.students.forEach(student => {
      const requiredCourses = getRequiredCoursesForStudent(state, student);
      student.required_courses = requiredCourses;
      updatedCount++;
    });

    writeState(state);

    res.json({
      ok: true,
      data: {
        updated: updatedCount,
        message: `已更新 ${updatedCount} 名学生的必修课`
      }
    });
  } catch (error) {
    res.status(500).json({ ok: false, errors: [{ code: 'ERROR', msg: error.message }] });
  }
});

// API: 获取设置
app.get('/api/settings', (req, res) => {
  try {
    // 从环境变量或配置文件读取设置
    const settings = {
      apiKey: process.env.DEEPSEEK_API_KEY ? '***已配置***' : '',
      apiUrl: process.env.DEEPSEEK_API_URL || 'https://api.deepseek.com',
      model: process.env.DEEPSEEK_MODEL || 'deepseek-v4-flash'
    };

    res.json({ ok: true, data: settings });
  } catch (error) {
    res.status(500).json({ ok: false, errors: [{ code: 'ERROR', msg: error.message }] });
  }
});

// API: 保存设置
app.post('/api/settings', (req, res) => {
  try {
    const { apiKey, apiUrl, model } = req.body;

    // 更新环境变量（重启后失效，需要持久化到文件）
    if (apiKey) {
      process.env.DEEPSEEK_API_KEY = apiKey;
      // 同时更新全局变量
      global.DEEPSEEK_API_KEY = apiKey;
    }
    if (apiUrl) {
      process.env.DEEPSEEK_API_URL = apiUrl;
      global.DEEPSEEK_API_URL = apiUrl;
    }
    if (model) {
      process.env.DEEPSEEK_MODEL = model;
      global.DEEPSEEK_MODEL = model;
    }

    // 保存到配置文件（持久化）
    const configPath = resolve(__dirname, '.env.local');
    let config = {};

    try {
      if (existsSync(configPath)) {
        const content = readFileSync(configPath, 'utf-8');
        content.split('\n').forEach(line => {
          const [key, value] = line.split('=');
          if (key && value) {
            config[key.trim()] = value.trim();
          }
        });
      }
    } catch (e) {
      // 忽略读取错误
    }

    // 更新配置
    if (apiKey) config.DEEPSEEK_API_KEY = apiKey;
    if (apiUrl) config.DEEPSEEK_API_URL = apiUrl;
    if (model) config.DEEPSEEK_MODEL = model;

    // 写入配置文件
    const configContent = Object.entries(config)
      .map(([key, value]) => `${key}=${value}`)
      .join('\n');
    writeFileSync(configPath, configContent, 'utf-8');

    res.json({
      ok: true,
      data: {
        message: '设置已保存，重启服务器后生效'
      }
    });
  } catch (error) {
    res.status(500).json({ ok: false, errors: [{ code: 'ERROR', msg: error.message }] });
  }
});

// API: 测试 AI 连接
app.post('/api/ai/test', async (req, res) => {
  try {
    const { message } = req.body;

    if (!DEEPSEEK_API_KEY) {
      return res.json({
        ok: false,
        errors: [{ code: 'NO_API_KEY', msg: 'DeepSeek API Key 未配置' }]
      });
    }

    const startTime = Date.now();

    const response = await callDeepSeek([
      { role: 'system', content: '你是一个测试助手。用户会发送测试消息，你需要简短回复。' },
      { role: 'user', content: message || '你好，请回复"连接成功"' }
    ], { temperature: 0.3, maxTokens: 100 });

    const endTime = Date.now();

    res.json({
      ok: true,
      data: {
        response: response.trim(),
        latency: endTime - startTime,
        model: 'deepseek-v4-flash'
      }
    });
  } catch (error) {
    console.error('AI 连接测试失败:', error);
    res.json({
      ok: false,
      errors: [{ code: 'CONNECTION_ERROR', msg: error.message }]
    });
  }
});

// API: 解析临时调课描述
app.post('/api/ai/parse-temp-timetable', async (req, res) => {
  try {
    const state = readState();
    const { description } = req.body;

    if (!description) {
      return res.status(400).json({ ok: false, errors: [{ code: 'INVALID', msg: '请输入描述' }] });
    }

    // 获取课程和教师信息
    const tasks = state.teaching_tasks || [];
    const courses = state.courses || [];
    const teachers = state.teachers || [];
    const assignments = state.assignments || [];

    // 构建课程信息字符串
    const taskInfo = tasks.map(t => {
      const course = courses.find(c => c.id === t.course_id);
      const teacher = teachers.find(te => te.id === t.teacher_id);
      const taskAssignments = assignments.filter(a => a.task_id === t.id);
      const slots = taskAssignments.map(a => a.slot_id).join(', ');
      return `- ${t.id}: ${course?.name || t.course_id} (${teacher?.name || t.teacher_id}) 时段: ${slots || '未排'}`;
    }).join('\n');

    // 使用 DeepSeek 解析
    const systemPrompt = `你是一个排课系统的临时调课解析器。用户会用自然语言描述临时调课需求，你需要解析成结构化的调整方案。

当前课程安排：
${taskInfo}

时段格式说明：
- D1P1 = 周一第1节
- D2P6 = 周二第6节
- 上午：P1-P5
- 下午：P6-P10

支持的操作：
1. cancel - 取消课程
2. move - 移动课程到新时段
3. swap - 两个课程交换时段

输出JSON格式：
{
  "summary": "对用户描述的理解总结",
  "adjustments": [
    {
      "task_id": "任务ID",
      "course_name": "课程名称",
      "teacher_name": "教师姓名",
      "action": "cancel|move|swap",
      "original_slot": "原时段",
      "new_slot": "新时段（move/swap时）",
      "target_task_id": "交换对象ID（swap时）",
      "target_course_name": "交换对象课程名（swap时）",
      "reason": "原因"
    }
  ]
}

注意：
- 如果用户提到教师姓名，找到对应的课程
- 如果用户提到"所有AP课"，列出所有AP课程
- 如果用户提到时间段（周三到周五），为该时间段的课程生成调整
- 只输出JSON，不要有其他内容`;

    const response = await callDeepSeek([
      { role: 'system', content: systemPrompt },
      { role: 'user', content: description }
    ], { temperature: 0.3 });

    // 解析响应
    let result;
    try {
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      result = jsonMatch ? JSON.parse(jsonMatch[0]) : { summary: '解析失败', adjustments: [] };
    } catch (e) {
      console.error('JSON解析失败:', response);
      result = { summary: '解析失败', adjustments: [] };
    }

    // 补充缺失的信息
    result.adjustments = (result.adjustments || []).map(adj => {
      const task = tasks.find(t => t.id === adj.task_id);
      const course = courses.find(c => c.id === task?.course_id);
      const teacher = teachers.find(t => t.id === task?.teacher_id);
      const taskAssignments = assignments.filter(a => a.task_id === adj.task_id);

      return {
        ...adj,
        course_name: adj.course_name || course?.name || adj.task_id,
        teacher_name: adj.teacher_name || teacher?.name || '-',
        original_slot: adj.original_slot || taskAssignments[0]?.slot_id || '-'
      };
    });

    res.json({
      ok: true,
      data: result
    });
  } catch (error) {
    console.error('解析临时调课失败:', error);
    res.status(500).json({ ok: false, errors: [{ code: 'ERROR', msg: error.message }] });
  }
});

// API: 应用选中的方案
app.post('/api/ai/apply-solution', async (req, res) => {
  try {
    const state = readState();
    const { assignments, seed } = req.body;

    if (!assignments || !Array.isArray(assignments)) {
      return res.status(400).json({ ok: false, errors: [{ code: 'INVALID', msg: '无效的排课数据' }] });
    }

    // 更新排课结果
    state.assignments = assignments;

    // 保存种子以便复现
    if (seed) {
      state.last_seed = seed;
    }

    writeState(state);

    res.json({
      ok: true,
      data: {
        assignments_count: assignments.length,
        message: '排课方案已应用'
      }
    });
  } catch (error) {
    res.status(500).json({ ok: false, errors: [{ code: 'ERROR', msg: error.message }] });
  }
});

// API: 生成优化建议（当有约束违规时）
app.post('/api/ai/suggest-fixes', async (req, res) => {
  try {
    const { violations, tasks, courses, teachers, rooms, constraints } = req.body;

    if (!violations || violations.length === 0) {
      return res.json({ ok: true, data: { suggestions: [] } });
    }

    // 构建违规信息
    const violationInfo = violations.map(v => {
      const task = tasks?.find(t => t.id === v.task_ids?.[0]);
      const course = courses?.find(c => c.id === task?.course_id);
      const teacher = teachers?.find(t => t.id === task?.teacher_id);
      return {
        constraint: v.constraint_id,
        reason: v.reason,
        task_id: v.task_ids?.[0],
        course_name: course?.name || task?.course_id,
        teacher_name: teacher?.name || task?.teacher_id,
        slot: v.slot
      };
    });

    // 构建资源信息
    const resourceInfo = {
      rooms: rooms?.map(r => `${r.id}(${r.name}, ${r.type}, 容量${r.capacity})`).join(', ') || '',
      teachers: teachers?.map(t => `${t.id}(${t.name}, 可教${t.can_teach?.join('/')})`).join(', ') || ''
    };

    // 使用 DeepSeek 生成建议
    const systemPrompt = `你是一个排课系统的优化顾问，拥有丰富的教育排课经验。

当前出现了约束违规，需要你分析问题根源并提出创新性的解决方案。

## 违规情况
${violationInfo.map(v => `- [${v.constraint}] ${v.reason}（课程：${v.course_name}，教师：${v.teacher_name}）`).join('\n')}

## 可用资源
- 教室：${resourceInfo.rooms}
- 教师：${resourceInfo.teachers}

## 你的任务

请深入分析这些违规的根本原因，然后提出多种可能的解决方案。

**不要局限于简单的替换**，请思考：
1. 这个违规的根本原因是什么？
2. 有哪些可能的解决路径？
3. 每种方案的优缺点是什么？
4. 会不会引发新的问题？
5. 有没有创造性的解决方案？

## 输出要求

请输出JSON格式，包含你的思考过程和具体建议：

{
  "analysis": "你对违规原因的分析",
  "suggestions": [
    {
      "id": 1,
      "title": "方案标题",
      "type": "方案类型（如：资源调整、时间重组、人员调配、课程整合等）",
      "description": "详细说明这个方案",
      "steps": ["步骤1", "步骤2", ...],
      "pros": ["优点1", "优点2", ...],
      "cons": ["缺点1", "缺点2", ...],
      "impact": "这个方案可能带来的连锁影响",
      "confidence": 0.8
    }
  ]
}

## 思考方向（仅供参考，不限于此）

你可以考虑但不限于：
- 资源重新分配（教室、设备）
- 时间调整（时段、日期）
- 人员调配（教师、助教）
- 课程整合或拆分
- 临时场地借用
- 课程形式调整（如大班课、小班课、线上课）
- 与其他班级/年级协调
- 调整课程优先级
- 分阶段实施
- 等等...

**重要**：请充分发挥你的专业知识和创造力，提出真正有价值的解决方案，而不仅仅是机械的替换操作。

只输出JSON，不要有其他内容。`;

    const response = await callDeepSeek([
      { role: 'system', content: systemPrompt },
      { role: 'user', content: '请分析违规并给出优化建议' }
    ], { temperature: 0.5 });

    // 解析响应
    let result;
    try {
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      result = jsonMatch ? JSON.parse(jsonMatch[0]) : { suggestions: [] };
    } catch (e) {
      console.error('JSON解析失败:', response);
      result = { suggestions: [] };
    }

    res.json({
      ok: true,
      data: result
    });
  } catch (error) {
    console.error('生成优化建议失败:', error);
    res.status(500).json({ ok: false, errors: [{ code: 'ERROR', msg: error.message }] });
  }
});

// API: 自然语言偏好解析（使用 DeepSeek）
app.post('/api/ai/parse-preference', async (req, res) => {
  try {
    const { text } = req.body;

    if (!text) {
      return res.status(400).json({ ok: false, errors: [{ code: 'INVALID', msg: '请输入偏好描述' }] });
    }

    // 使用 DeepSeek 解析自然语言偏好
    const systemPrompt = `你是一个排课系统的偏好解析助手。用户的排课偏好描述，你需要解析成结构化的 JSON 格式。

输出格式要求（JSON数组）：
[
  {
    "type": "时间偏好|连堂|分散|走班|禁排|教师|教室|其他",
    "value": "具体的值",
    "description": "中文描述"
  }
]

支持的偏好类型：
1. 时间偏好：上午/下午/特定时段
2. 连堂：课程需要连续排课
3. 分散：课程分散在不同天
4. 走班：AP课程优先走班时段
5. 禁排：某些时段不排课（格式：周X第Y节）
6. 教师：偏好特定教师
7. 教室：偏好特定教室类型

请只输出JSON，不要有其他内容。`;

    const userMessage = `请解析以下排课偏好：${text}`;

    const response = await callDeepSeek([
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userMessage }
    ], { temperature: 0.3 });

    // 解析 JSON 响应
    let preferences;
    try {
      // 提取 JSON 部分（处理可能的 markdown 代码块）
      const jsonMatch = response.match(/\[[\s\S]*\]/);
      preferences = jsonMatch ? JSON.parse(jsonMatch[0]) : [];
    } catch (e) {
      console.error('JSON解析失败:', response);
      preferences = parseNaturalLanguagePreference(text); // 回退到简单解析
    }

    // 生成建议操作
    const suggested_actions = preferences.map(pref => {
      switch (pref.type) {
        case '时间偏好':
          return {
            action: 'set_prefer_morning',
            value: pref.value.includes('上午'),
            description: `设置课程${pref.value}`
          };
        case '连堂':
          return {
            action: 'set_consecutive',
            value: true,
            description: '设置课程需要连堂'
          };
        case '禁排':
          return {
            action: 'add_constraint',
            type: 'forbidden_slot',
            description: `添加禁排约束: ${pref.description}`
          };
        default:
          return {
            action: 'set_preference',
            type: pref.type,
            description: pref.description
          };
      }
    });

    res.json({
      ok: true,
      data: {
        original_text: text,
        parsed_preferences: preferences,
        suggested_actions,
        ai_powered: true
      }
    });
  } catch (error) {
    console.error('DeepSeek API 错误:', error);
    // 回退到简单解析
    const preferences = parseNaturalLanguagePreference(text);
    res.json({
      ok: true,
      data: {
        original_text: text,
        parsed_preferences: preferences,
        suggested_actions: generateSuggestedActions(preferences),
        ai_powered: false,
        fallback_reason: error.message
      }
    });
  }
});

// 解析自然语言偏好
function parseNaturalLanguagePreference(text) {
  const preferences = [];

  // 检测时间偏好
  if (text.includes('上午') || text.includes('早上')) {
    preferences.push({ type: 'time', value: 'morning', description: '优先安排在上午' });
  }
  if (text.includes('下午')) {
    preferences.push({ type: 'time', value: 'afternoon', description: '优先安排在下午' });
  }

  // 检测连堂需求
  if (text.includes('连堂') || text.includes('连续')) {
    preferences.push({ type: 'consecutive', value: true, description: '需要连堂排课' });
  }

  // 检测分散需求
  if (text.includes('分散') || text.includes('均衡')) {
    preferences.push({ type: 'spread', value: true, description: '课时分散在不同天' });
  }

  // 检测走班时段
  if (text.includes('走班')) {
    preferences.push({ type: 'walk_block', value: true, description: '优先安排在走班时段' });
  }

  // 检测禁排时段
  const forbiddenMatch = text.match(/周([一二三四五])(第?(\d+)节?)?\s*(不排|禁排|避免)/);
  if (forbiddenMatch) {
    const dayMap = { '一': 1, '二': 2, '三': 3, '四': 4, '五': 5 };
    const day = dayMap[forbiddenMatch[1]];
    const period = forbiddenMatch[3] ? parseInt(forbiddenMatch[3]) : null;
    preferences.push({
      type: 'forbidden',
      day,
      period,
      description: period ? `周${forbiddenMatch[1]}第${period}节不排` : `周${forbiddenMatch[1]}不排`
    });
  }

  // 检测教师偏好
  if (text.includes('张老师')) {
    preferences.push({ type: 'teacher', value: 'T1', description: '优先安排张老师' });
  }
  if (text.includes('李老师')) {
    preferences.push({ type: 'teacher', value: 'T2', description: '优先安排李老师' });
  }

  // 默认偏好
  if (preferences.length === 0) {
    preferences.push({ type: 'general', value: 'balanced', description: '均衡排课' });
  }

  return preferences;
}

// 生成建议操作
function generateSuggestedActions(preferences) {
  const actions = [];

  preferences.forEach(pref => {
    switch (pref.type) {
      case 'time':
        actions.push({
          action: 'set_prefer_morning',
          value: pref.value === 'morning',
          description: `设置课程${pref.value === 'morning' ? '优先上午' : '优先下午'}`
        });
        break;
      case 'consecutive':
        actions.push({
          action: 'set_consecutive',
          value: true,
          description: '设置课程需要连堂'
        });
        break;
      case 'forbidden':
        actions.push({
          action: 'add_constraint',
          type: 'forbidden_slot',
          day: pref.day,
          period: pref.period,
          description: `添加禁排约束: ${pref.description}`
        });
        break;
    }
  });

  return actions;
}

// API: 上传并解析 Excel 文件
app.post('/api/import/excel', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ ok: false, errors: [{ code: 'NO_FILE', msg: '请上传文件' }] });
    }

    let { type } = req.body; // students, teachers, courses, etc.

    // 解析 Excel 文件
    const workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const data = XLSX.utils.sheet_to_json(sheet);

    if (data.length === 0) {
      return res.status(400).json({ ok: false, errors: [{ code: 'EMPTY', msg: 'Excel 文件为空' }] });
    }

    // 根据类型解析数据
    let parsedData = [];
    let errors = [];

    switch (type) {
      case 'students':
        parsedData = parseStudentData(data, errors);
        break;
      case 'teachers':
        parsedData = parseTeacherData(data, errors);
        break;
      case 'courses':
        parsedData = parseCourseData(data, errors);
        break;
      case 'rooms':
        parsedData = parseRoomData(data, errors);
        break;
      default:
        // 自动检测类型
        const detected = await detectAndParseData(data, errors);
        parsedData = detected.data;
        type = detected.type;
    }

    res.json({
      ok: true,
      data: {
        filename: req.file.originalname,
        type,
        total_rows: data.length,
        parsed_count: parsedData.length,
        errors,
        preview: data.slice(0, 10), // 预览原始 Excel 数据（中文字段）
        preview_parsed: parsedData.slice(0, 10), // 解析后的数据（用于导入）
        headers: Object.keys(data[0] || {})
      }
    });
  } catch (error) {
    res.status(500).json({ ok: false, errors: [{ code: 'ERROR', msg: error.message }] });
  }
});

// API: 确认导入数据
app.post('/api/import/confirm', async (req, res) => {
  try {
    const state = readState();
    const { type, data } = req.body;

    if (!type || !data || !Array.isArray(data)) {
      return res.status(400).json({ ok: false, errors: [{ code: 'INVALID', msg: '无效的导入数据' }] });
    }

    let importedCount = 0;
    let skippedCount = 0;

    switch (type) {
      case 'students':
        data.forEach(student => {
          if (!state.students.find(s => s.id === student.id)) {
            state.students.push(student);
            importedCount++;
          } else {
            skippedCount++;
          }
        });
        break;
      case 'teachers':
        data.forEach(teacher => {
          if (!state.teachers.find(t => t.id === teacher.id)) {
            state.teachers.push(teacher);
            importedCount++;
          } else {
            skippedCount++;
          }
        });
        break;
      case 'courses':
        data.forEach(course => {
          if (!state.courses.find(c => c.id === course.id)) {
            state.courses.push(course);
            importedCount++;
          } else {
            skippedCount++;
          }
        });
        break;
      case 'rooms':
        data.forEach(room => {
          if (!state.rooms.find(r => r.id === room.id)) {
            state.rooms.push(room);
            importedCount++;
          } else {
            skippedCount++;
          }
        });
        break;
      default:
        return res.status(400).json({ ok: false, errors: [{ code: 'INVALID_TYPE', msg: `不支持的类型: ${type}` }] });
    }

    writeState(state);

    res.json({
      ok: true,
      data: {
        type,
        imported: importedCount,
        skipped: skippedCount,
        total: data.length
      }
    });
  } catch (error) {
    res.status(500).json({ ok: false, errors: [{ code: 'ERROR', msg: error.message }] });
  }
});

// 解析学生数据
function parseStudentData(data, errors) {
  return data.map((row, index) => {
    const student = {
      id: row['学号'] || row['ID'] || row['id'] || `S${index + 1}`,
      name: row['姓名'] || row['名字'] || row['name'] || '',
      grade: parseInt(row['年级'] || row['grade'] || 1),
      admin_class_id: row['行政班'] || row['班级'] || row['admin_class'] || '',
      teaching_class_id: row['教学班'] || row['teaching_class'] || '',
      // 保留原始字段用于预览显示
      _原始数据: row
    };

    if (!student.name) {
      errors.push({ row: index + 1, msg: '缺少姓名' });
    }

    return student;
  });
}

// 解析教师数据
function parseTeacherData(data, errors) {
  return data.map((row, index) => {
    const teacher = {
      id: row['工号'] || row['ID'] || row['id'] || `T${index + 1}`,
      name: row['姓名'] || row['名字'] || row['name'] || '',
      can_teach: (row['可教课程'] || row['课程'] || '').split(/[,，、]/).filter(Boolean),
      max_per_day: parseInt(row['每日上限'] || 6),
      max_per_week: parseInt(row['每周上限'] || 25)
    };

    if (!teacher.name) {
      errors.push({ row: index + 1, msg: '缺少姓名' });
    }

    return teacher;
  });
}

// 解析课程数据
function parseCourseData(data, errors) {
  return data.map((row, index) => {
    const course = {
      id: row['课程编号'] || row['ID'] || row['id'] || `C${index + 1}`,
      name: row['课程名称'] || row['名称'] || row['name'] || '',
      type: (row['类型'] || row['type'] || 'required').toLowerCase() === 'ap' ? 'ap' : 'required',
      weekly_hours: parseInt(row['周课时'] || row['课时'] || 5),
      required_room_type: row['教室类型'] || row['room_type'] || undefined,
      prefer_morning: (row['优先上午'] || '').toString().toLowerCase() === '是' ||
                       (row['优先上午'] || '').toString().toLowerCase() === 'yes'
    };

    if (!course.name) {
      errors.push({ row: index + 1, msg: '缺少课程名称' });
    }

    return course;
  });
}

// 解析教室数据
function parseRoomData(data, errors) {
  return data.map((row, index) => {
    const room = {
      id: row['教室编号'] || row['ID'] || row['id'] || `R${index + 1}`,
      name: row['教室名称'] || row['名称'] || row['name'] || '',
      type: row['类型'] || row['type'] || 'general',
      capacity: parseInt(row['容量'] || row['capacity'] || 30)
    };

    if (!room.name) {
      errors.push({ row: index + 1, msg: '缺少教室名称' });
    }

    return room;
  });
}

// 自动检测并解析数据
async function detectAndParseData(data, errors) {
  const headers = Object.keys(data[0] || {});
  const headerStr = headers.join(' ').toLowerCase();

  // 首先尝试关键词匹配
  if (headerStr.includes('学号') || headerStr.includes('学生') || headerStr.includes('student')) {
    return { type: 'students', data: parseStudentData(data, errors) };
  } else if (headerStr.includes('工号') || headerStr.includes('教师') || headerStr.includes('teacher')) {
    return { type: 'teachers', data: parseTeacherData(data, errors) };
  } else if (headerStr.includes('课程') || headerStr.includes('course')) {
    return { type: 'courses', data: parseCourseData(data, errors) };
  } else if (headerStr.includes('教室') || headerStr.includes('room')) {
    return { type: 'rooms', data: parseRoomData(data, errors) };
  }

  // 如果关键词匹配失败，使用 AI 智能分析
  try {
    const aiResult = await analyzeWithAI(headers, data.slice(0, 3));
    if (aiResult.type && aiResult.type !== 'unknown') {
      errors.push({ row: 0, msg: `AI 识别为${getTypeName(aiResult.type)}，字段映射: ${aiResult.mapping}` });
      return { type: aiResult.type, data: parseWithMapping(data, aiResult.type, aiResult.fieldMapping, errors) };
    }
  } catch (e) {
    console.error('AI 分析失败:', e);
  }

  errors.push({ row: 0, msg: '无法自动识别数据类型，请手动选择' });
  return { type: 'unknown', data: [] };
}

// 使用 AI 分析表头和数据
async function analyzeWithAI(headers, sampleData) {
  const systemPrompt = `你是一个数据分析师。用户上传了一个 Excel 文件，你需要分析表头和示例数据，判断这是什么类型的数据。

支持的数据类型：
1. students - 学生名单（需要字段：学号/ID、姓名、年级、行政班、教学班）
2. teachers - 教师名单（需要字段：工号/ID、姓名、可教课程、每日上限、每周上限）
3. courses - 课程列表（需要字段：课程编号/ID、课程名称、类型、周课时）
4. rooms - 教室列表（需要字段：教室编号/ID、教室名称、类型、容量）

输出 JSON 格式：
{
  "type": "students|teachers|courses|rooms|unknown",
  "confidence": 0.95,
  "fieldMapping": {
    "系统字段名": "Excel列名"
  },
  "mapping": "映射说明"
}

只输出JSON，不要有其他内容。`;

  const userMessage = `表头: ${headers.join(', ')}

示例数据（前3行）:
${sampleData.map((row, i) => `第${i+1}行: ${JSON.stringify(row)}`).join('\n')}

请分析这是什么类型的数据，并给出字段映射。`;

  const response = await callDeepSeek([
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userMessage }
  ], { temperature: 0.3 });

  try {
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    return jsonMatch ? JSON.parse(jsonMatch[0]) : { type: 'unknown' };
  } catch (e) {
    return { type: 'unknown' };
  }
}

// 根据 AI 映射解析数据
function parseWithMapping(data, type, fieldMapping, errors) {
  return data.map((row, index) => {
    switch (type) {
      case 'students':
        return {
          id: row[fieldMapping['id']] || row[fieldMapping['学号']] || `S${index + 1}`,
          name: row[fieldMapping['name']] || row[fieldMapping['姓名']] || '',
          grade: parseInt(row[fieldMapping['grade']] || row[fieldMapping['年级']] || 1),
          admin_class_id: row[fieldMapping['admin_class_id']] || row[fieldMapping['行政班']] || '',
          teaching_class_id: row[fieldMapping['teaching_class_id']] || row[fieldMapping['教学班']] || '',
          _原始数据: row
        };
      case 'teachers':
        return {
          id: row[fieldMapping['id']] || row[fieldMapping['工号']] || `T${index + 1}`,
          name: row[fieldMapping['name']] || row[fieldMapping['姓名']] || '',
          can_teach: (row[fieldMapping['can_teach']] || row[fieldMapping['可教课程']] || '').split(/[,，、]/).filter(Boolean),
          max_per_day: parseInt(row[fieldMapping['max_per_day']] || row[fieldMapping['每日上限']] || 6),
          max_per_week: parseInt(row[fieldMapping['max_per_week']] || row[fieldMapping['每周上限']] || 25),
          _原始数据: row
        };
      case 'courses':
        return {
          id: row[fieldMapping['id']] || row[fieldMapping['课程编号']] || `C${index + 1}`,
          name: row[fieldMapping['name']] || row[fieldMapping['课程名称']] || '',
          type: (row[fieldMapping['type']] || row[fieldMapping['类型']] || 'required').toLowerCase() === 'ap' ? 'ap' : 'required',
          weekly_hours: parseInt(row[fieldMapping['weekly_hours']] || row[fieldMapping['周课时']] || 5),
          _原始数据: row
        };
      case 'rooms':
        return {
          id: row[fieldMapping['id']] || row[fieldMapping['教室编号']] || `R${index + 1}`,
          name: row[fieldMapping['name']] || row[fieldMapping['教室名称']] || '',
          type: row[fieldMapping['type']] || row[fieldMapping['类型']] || 'general',
          capacity: parseInt(row[fieldMapping['capacity']] || row[fieldMapping['容量']] || 30),
          _原始数据: row
        };
      default:
        return row;
    }
  });
}

// 获取类型名称（用于显示）
function getTypeName(type) {
  const names = {
    students: '学生名单',
    teachers: '教师名单',
    courses: '课程列表',
    rooms: '教室列表',
    unknown: '未知类型'
  };
  return names[type] || type;
}

// API: 一键排课(所有年级)
app.post('/api/solve-all', async (req, res) => {
  try {
    const { execSync } = await import('child_process');
    const result = execSync('node ' + resolve(__dirname, '../../search-all.cjs') + ' 3000 10 && node ' + resolve(__dirname, '../../search-all.cjs') + ' 5000 11 && node ' + resolve(__dirname, '../../search-all.cjs') + ' 5000 12', { timeout: 600000, encoding: 'utf-8' });
    // Reload state after scheduling
    const state = readState();
    res.json({ ok: true, data: { result, summary: { g10: state.students.filter(s=>s.grade===10).length, g11: state.students.filter(s=>s.grade===11).length, g12: state.students.filter(s=>s.grade===12).length } } });
  } catch (e) { res.status(500).json({ ok: false, errors: [{ msg: e.message }] }); }
});

// API: 验证当前课表
app.get('/api/validate-all', (req, res) => {
  try {
    const state = readState();
    const issues = [];
    [10,11,12].forEach(grade => {
      const gStudents = state.students.filter(s => s.grade === grade);
      const sample = gStudents[0];
      if (!sample) return;
      // Check daily
      const daily = [0,0,0,0,0];
      state.assignments.filter(a => a.student_id === sample.id).forEach(a => daily[a.slot_id.charAt(1)-1]++);
      if (daily.some(d => d !== 10)) issues.push(`高${grade} sample daily≠10: ${daily.join(',')}`);
      // Check self-study position
      const ssAM = state.assignments.filter(a => a.student_id === sample.id && a.course_id === 'SELF_STUDY' && parseInt(a.slot_id.substring(3)) <= 5).length;
      if (ssAM > 0) issues.push(`高${grade} sample 上午自习: ${ssAM}`);
      // Check duty/meeting position
      const duty = state.assignments.filter(a => a.student_id === sample.id && a.course_id === 'DUTY');
      if (duty.length > 0 && !duty.every(a => a.slot_id === 'D1P10')) issues.push(`高${grade} 值日不在D1P10`);
      const meeting = state.assignments.filter(a => a.student_id === sample.id && a.course_id === 'MEETING');
      if (meeting.length > 0 && !meeting.every(a => a.slot_id === 'D1P9')) issues.push(`高${grade} 班会不在D1P9`);
    });
    res.json({ ok: issues.length === 0, data: { issues, count: issues.length } });
  } catch (e) { res.status(500).json({ ok: false, errors: [{ msg: e.message }] }); }
});

// 启动服务器
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`排课系统 API 服务器运行在 http://localhost:${PORT}`);
  console.log(`状态文件: ${STATE_FILE}`);
});
