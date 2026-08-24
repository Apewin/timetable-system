/**
 * 排课系统 Web 前端应用
 */

import {
  courseAppliesToManualClass,
  manualPlacementScopeForSections,
  manualDeckSectionsForClassCourse,
  manualPoolItemRemaining,
  manualPoolItemTotalHours,
  manualSectionsForClassCourse,
  manualTeacherIdsForClassItem,
  shouldCollapseAdminSections,
} from './manual-course-scope.mjs';
import { escapeHtml, safeDataAttribute } from './dom-safety.mjs';
import { manualSolvedCellsBySlot } from './manual-solved-timetable.mjs';
import { qualityMetricSummary } from './quality-analysis-view.mjs';
import {
  DEFAULT_EXAM_SOLVE_SECONDS,
  examDurationImportRowKey,
  examPlanFromEditor,
  examRestPolicySummary,
  examRowsFromDurationImport,
  examSolveRequest,
} from './exam-planner-view.mjs';
import {
  normalizeWorkspaceMode,
  workspaceModeForView,
  workspaceModePresentation,
} from './workspace-mode.mjs';
import {
  nextTeachingAssignmentId,
  teachersQualifiedForCourse,
  summarizeTeachingTasks,
} from './teacher-assignment-view.mjs';
import {
  computationProgressSnapshot,
  computationRequestDescriptor,
} from './computation-progress.mjs';

const API_BASE = '/api';

// 辅助函数：从slot中获取课程名称
function getCourseName(slot) {
  if (!slot) return '';
  if (slot.admin_courses && Object.keys(slot.admin_courses).length > 0) {
    const firstAdminCourse = Object.values(slot.admin_courses)[0];
    return firstAdminCourse.course;
  } else if (slot.teaching_course) {
    return slot.teaching_course.course;
  } else if (slot.elective_course) {
    return slot.elective_course.course;
  } else if (slot.course) {
    return slot.course;
  }
  return '';
}

// 辅助函数：从slot中获取教师名称
function getTeacherName(slot) {
  if (!slot) return '';
  if (slot.teaching_course) {
    return slot.teaching_course.teacher;
  } else if (slot.elective_course) {
    return slot.elective_course.teacher;
  } else if (slot.teacher) {
    return slot.teacher;
  }
  return '';
}

// 辅助函数：从slot中获取教室
function getRoomName(slot) {
  if (!slot) return '';
  if (slot.teaching_course) {
    return slot.teaching_course.room;
  } else if (slot.elective_course) {
    return slot.elective_course.room;
  } else if (slot.room) {
    return slot.room;
  }
  return '';
}

// Keep timetable displays aligned with the five course colors used by the
// manual timetable. API timetable rows expose both course type and class type;
// split rows are identified by their descriptive label.
function timetableCourseCategory(slot) {
  if (!slot) return 'other';
  const courseType = String(
    slot.course_type || slot.teaching_course?.course_type || slot.elective_course?.course_type || '',
  ).toLowerCase();
  const classType = String(slot.class_type || '').toLowerCase();
  const courseLabel = getCourseName(slot);
  if (courseType === 'ap' || classType === 'ap' || courseLabel.startsWith('AP 选课分流')) return 'ap';
  if (courseType === 'required_elective' || classType === 'elective' || courseLabel.startsWith('选修课分流')) return 'elective';
  if (courseLabel.startsWith('行政班：')) return 'admin-required';
  if (courseType === 'required') return classType === 'teaching' ? 'teaching-required' : 'admin-required';
  if (classType === 'teaching') return 'teaching-required';
  if (classType === 'admin' || slot.admin_courses) return 'admin-required';
  return 'other';
}

function timetableCourseCategoryLabel(category) {
  return ({
    'admin-required': '行政班必修',
    'teaching-required': '教学班必修',
    ap: 'AP 选修',
    elective: '非必修选修',
    other: '其他',
  })[category] || '其他';
}

// 工具函数
function showToast(message, type = 'success') {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.className = `toast ${type}`;
  setTimeout(() => {
    toast.className = 'toast hidden';
  }, 3000);
}

let activeComputationProgress = null;
let computationProgressSequence = 0;
let computationProgressHideTimer = null;

function renderComputationProgress(run, state = 'running', message = '') {
  if (!run || activeComputationProgress?.id !== run.id) return;

  const panel = document.getElementById('computation-progress');
  const label = document.getElementById('computation-progress-label');
  const time = document.getElementById('computation-progress-time');
  const progress = document.getElementById('computation-progress-bar');
  const note = document.getElementById('computation-progress-note');
  if (!panel || !label || !time || !progress || !note) return;

  const snapshot = computationProgressSnapshot({
    startedAt: run.startedAt,
    now: Date.now(),
    maxSeconds: run.maxSeconds,
    state,
  });
  const statusLabel = state === 'running'
    ? run.label
    : message || (state === 'success' ? run.successText : '计算未完成');

  panel.classList.remove('hidden', 'is-running', 'is-success', 'is-error');
  panel.classList.add(`is-${state}`);
  label.textContent = statusLabel;
  time.textContent = snapshot.timeText;
  progress.value = snapshot.percent;
  progress.textContent = snapshot.percentText;
  progress.setAttribute(
    'aria-valuetext',
    `${statusLabel}；${snapshot.timeText}；${snapshot.note}`,
  );
  note.textContent = state === 'running' ? snapshot.note : message || statusLabel;
}

function beginComputationProgress(descriptor) {
  clearTimeout(computationProgressHideTimer);
  if (activeComputationProgress?.timer) clearInterval(activeComputationProgress.timer);

  const run = {
    id: ++computationProgressSequence,
    startedAt: Date.now(),
    label: descriptor.label,
    successText: descriptor.successText || '计算完成',
    maxSeconds: descriptor.maxSeconds || 90,
    timer: null,
  };
  activeComputationProgress = run;
  renderComputationProgress(run);
  run.timer = setInterval(() => renderComputationProgress(run), 500);
  return run;
}

function finishComputationProgress(run, { state = 'success', message = '' } = {}) {
  if (!run || activeComputationProgress?.id !== run.id) return;
  clearInterval(run.timer);
  run.timer = null;
  renderComputationProgress(run, state, message);

  const finishedId = run.id;
  computationProgressHideTimer = setTimeout(() => {
    if (activeComputationProgress?.id !== finishedId) return;
    document.getElementById('computation-progress')?.classList.add('hidden');
    activeComputationProgress = null;
  }, state === 'error' ? 5000 : 2200);
}

let activeAiProcessingRun = 0;
let aiProcessingTimer = null;

function startAiProcessing(title) {
  const runId = ++activeAiProcessingRun;
  const overlay = document.getElementById('ai-processing-overlay');
  const titleElement = document.getElementById('ai-processing-title');
  const stageElement = document.getElementById('ai-processing-stage');
  const elapsedElement = document.getElementById('ai-processing-elapsed');
  const startedAt = Date.now();
  clearInterval(aiProcessingTimer);
  titleElement.textContent = title;
  overlay.classList.remove('hidden');
  const render = () => {
    if (runId !== activeAiProcessingRun) return;
    const elapsedSeconds = Math.floor((Date.now() - startedAt) / 1000);
    stageElement.textContent = elapsedSeconds < 2
      ? '正在上传并读取工作簿…'
      : elapsedSeconds < 6
        ? '大模型正在理解工作表、标题与字段…'
        : '大模型正在整理数据；请勿关闭此页面…';
    elapsedElement.textContent = `已运行 ${elapsedSeconds} 秒`;
  };
  render();
  aiProcessingTimer = setInterval(render, 250);
  return runId;
}

function finishAiProcessing(runId, { error = false } = {}) {
  if (runId !== activeAiProcessingRun) return;
  const overlay = document.getElementById('ai-processing-overlay');
  const stageElement = document.getElementById('ai-processing-stage');
  const elapsedElement = document.getElementById('ai-processing-elapsed');
  clearInterval(aiProcessingTimer);
  aiProcessingTimer = null;
  stageElement.textContent = error ? '整理失败，请查看错误提示。' : '整理完成，正在更新校验预览…';
  elapsedElement.textContent = error ? '可修改表格后重新尝试。' : '系统校验已完成。';
  setTimeout(() => {
    if (runId === activeAiProcessingRun) overlay.classList.add('hidden');
  }, error ? 1500 : 800);
}

function showModal(title, content) {
  const modal = document.getElementById('modal');
  const modalTitle = document.getElementById('modal-title');
  const modalBody = document.getElementById('modal-body');
  modalTitle.textContent = title;
  modalBody.innerHTML = content;
  modal.classList.remove('hidden');
}

function hideModal() {
  document.getElementById('modal').classList.add('hidden');
}

// 生成课程选择界面（下拉菜单方式）
function renderCourseSelector(selectedCourses = []) {
  const courses = window._coursesData || [];
  if (courses.length === 0) {
    return '<div style="color: var(--gray-500);">暂无课程数据</div>';
  }

  // 显示已选课程
  let html = '<div id="selected-courses" style="margin-bottom: 8px;">';
  selectedCourses.forEach(courseId => {
    const course = courses.find(c => c.id === courseId);
    if (course) {
      html += `<span class="ap-tag" style="margin: 2px 4px 2px 0;">${course.name} <span onclick="removeCourse('${courseId}')" style="cursor: pointer; margin-left: 4px;">×</span></span>`;
    }
  });
  html += '</div>';

  // 下拉选择框
  html += `<select id="course-select" style="width: 100%; padding: 8px;">`;
  html += '<option value="">选择课程...</option>';

  // 按类型分组
  const requiredCourses = courses.filter(c => c.type === 'required' || c.type === 'required_elective');
  const apCourses = courses.filter(c => c.type === 'ap');
  const otherCourses = courses.filter(c => c.type === 'other');

  if (requiredCourses.length > 0) {
    html += '<optgroup label="必修课">';
    requiredCourses.forEach(c => {
      const disabled = selectedCourses.includes(c.id) ? 'disabled' : '';
      html += `<option value="${c.id}" ${disabled}>${c.name}</option>`;
    });
    html += '</optgroup>';
  }

  if (apCourses.length > 0) {
    html += '<optgroup label="AP课程">';
    apCourses.forEach(c => {
      const disabled = selectedCourses.includes(c.id) ? 'disabled' : '';
      html += `<option value="${c.id}" ${disabled}>${c.name}</option>`;
    });
    html += '</optgroup>';
  }

  if (otherCourses.length > 0) {
    html += '<optgroup label="其他课程">';
    otherCourses.forEach(c => {
      const disabled = selectedCourses.includes(c.id) ? 'disabled' : '';
      html += `<option value="${c.id}" ${disabled}>${c.name}</option>`;
    });
    html += '</optgroup>';
  }

  html += '</select>';

  // 隐藏字段存储已选课程
  html += '<input type="hidden" name="can_teach" id="can_teach_hidden" value="' + selectedCourses.join(',') + '">';

  return html;
}

// 添加课程到选择列表
function addCourse(courseId) {
  if (!courseId) return;

  const courses = window._coursesData || [];
  const course = courses.find(c => c.id === courseId);
  if (!course) return;

  // 获取当前已选课程
  const hiddenInput = document.getElementById('can_teach_hidden');
  const selectedCourses = hiddenInput.value ? hiddenInput.value.split(',') : [];

  // 检查是否已选
  if (selectedCourses.includes(courseId)) {
    showToast('该课程已选择', 'warning');
    return;
  }

  // 添加到已选列表
  selectedCourses.push(courseId);
  hiddenInput.value = selectedCourses.join(',');

  // 更新显示
  const selectedDiv = document.getElementById('selected-courses');
  const tag = document.createElement('span');
  tag.className = 'ap-tag';
  tag.style.margin = '2px 4px 2px 0';
  tag.innerHTML = `${course.name} <span onclick="removeCourse('${courseId}')" style="cursor: pointer; margin-left: 4px;">×</span>`;
  selectedDiv.appendChild(tag);

  // 禁用下拉选项
  const select = document.getElementById('course-select');
  const option = select.querySelector(`option[value="${courseId}"]`);
  if (option) option.disabled = true;

  // 重置下拉框
  select.value = '';
}

// 从选择列表移除课程
function removeCourse(courseId) {
  const hiddenInput = document.getElementById('can_teach_hidden');
  const selectedCourses = hiddenInput.value ? hiddenInput.value.split(',') : [];

  // 移除课程
  const index = selectedCourses.indexOf(courseId);
  if (index > -1) {
    selectedCourses.splice(index, 1);
    hiddenInput.value = selectedCourses.join(',');
  }

  // 更新显示
  const selectedDiv = document.getElementById('selected-courses');
  const tags = selectedDiv.querySelectorAll('.ap-tag');
  tags.forEach(tag => {
    if (tag.textContent.includes(courseId)) {
      tag.remove();
    }
  });

  // 启用下拉选项
  const select = document.getElementById('course-select');
  const option = select.querySelector(`option[value="${courseId}"]`);
  if (option) option.disabled = false;
}

async function api(path, options = {}) {
  const { computation, ...requestOptions } = options;
  const descriptor = computation === false
    ? null
    : computation || computationRequestDescriptor(path, requestOptions);
  const progressRun = descriptor ? beginComputationProgress(descriptor) : null;
  try {
    const response = await fetch(`${API_BASE}${path}`, {
      headers: {
        'Content-Type': 'application/json',
      },
      ...requestOptions,
    });
    const data = await response.json();
    if (!data.ok) {
      throw new Error(data.errors?.[0]?.msg || '请求失败');
    }
    if (progressRun) {
      finishComputationProgress(progressRun, {
        message: descriptor.successText,
      });
    }
    return data.data;
  } catch (error) {
    if (progressRun) {
      finishComputationProgress(progressRun, {
        state: 'error',
        message: `计算失败：${error.message}`,
      });
    }
    showToast(error.message, 'error');
    throw error;
  }
}

// 视图切换
async function switchView(viewName, { syncWorkspaceMode = true } = {}) {
  const viewWorkspaceMode = workspaceModeForView(viewName);
  if (viewWorkspaceMode === 'schedule') lastScheduleView = viewName;
  if (syncWorkspaceMode && viewWorkspaceMode !== adminWorkspaceMode) {
    applyWorkspaceMode(viewWorkspaceMode);
  }

  // 隐藏所有视图
  document.querySelectorAll('.view').forEach(view => {
    view.classList.remove('active');
  });

  // 显示目标视图
  const targetView = document.getElementById(`view-${viewName}`);
  if (targetView) {
    targetView.classList.add('active');
  }

  // 更新导航高亮
  document.querySelectorAll('.nav-section a').forEach(link => {
    link.classList.remove('active');
    if (link.dataset.view === viewName) {
      link.classList.add('active');
    }
  });

  updateAdminShellContext(viewName);
  updateAiAssistantContext(viewName);

  // 加载视图数据
  return loadViewData(viewName);
}

// 加载视图数据
async function loadViewData(viewName) {
  switch (viewName) {
    case 'welcome':
      await loadWelcomePage();
      break;
    case 'exam-scheduling':
      await loadExamPlanner();
      break;
    case 'status':
      await loadStatus();
      break;
    case 'teachers':
      await loadTeachers();
      break;
    case 'rooms':
      await loadRooms();
      break;
    case 'courses':
      await loadCourses();
      break;
    case 'students':
      await loadStudents();
      break;
    case 'classes':
      await loadClasses();
      break;
    case 'assignments':
      await loadAssignments();
      break;
    case 'selections':
      await loadSelections();
      break;
    case 'elective-selections':
      await loadElectiveSelections();
      break;
    case 'constraints':
      await loadConstraints();
      break;
    case 'sectioning':
      await loadSectioning();
      break;
    case 'student-timetable':
      await loadStudentSelect();
      break;
    case 'ap-group-timetable':
      await loadApGroupSelect();
      break;
    case 'teacher-timetable':
      await loadTeacherSelect();
      break;
    case 'class-timetable':
      await loadClassSelect();
      break;
    case 'room-timetable':
      await loadRoomSelect();
      break;
    case 'overview-timetable':
      await loadOverviewTimetable();
      break;
    case 'import':
      initImportPage();
      break;
    case 'graduation-archives':
      await loadGraduationArchives();
      break;
    case 'export':
      await loadExportPage();
      break;
    case 'manual-timetable':
      await loadManualTimetable();
      break;
    case 'teacher-availability':
      await loadTeacherAvailability();
      break;
    case 'schedule-editor':
      await loadScheduleEditor();
      break;
    case 'past-timetables':
      await loadPastTimetables();
      break;
    case 'settings':
      await loadSettingsPage();
      break;
  }
}

function examPlannerState() {
  return window._examPlanner || {
    plan: null,
    schedule: null,
    courses: [],
    revision: 0,
    examRows: [],
    importPreview: null,
    importMappings: {},
  };
}

function examTypeLabel(type) {
  return { required: '必修', ap: 'AP', required_elective: '其他选修', other: '活动' }[type] || type || '课程';
}

function setExamStatus(message, type = '') {
  const status = document.getElementById('exam-plan-status');
  if (!status) return;
  status.className = `exam-status${type ? ` is-${type}` : ''}`;
  status.textContent = message;
}

function examCourseGrades(course) {
  const source = Array.isArray(course?.grade) ? course.grade : [course?.grade];
  return source.map(Number).filter(Number.isInteger);
}

function examGradeLabel(grade) {
  return ({ 10: '高一', 11: '高二', 12: '高三' })[Number(grade)] || `${grade} 年级`;
}

function examImportCourseOptions(row, selectedCourseId) {
  const courses = [...examPlannerState().courses].sort((left, right) => {
    const leftMatches = examCourseGrades(left).includes(Number(row.grade));
    const rightMatches = examCourseGrades(right).includes(Number(row.grade));
    return Number(rightMatches) - Number(leftMatches)
      || left.name.localeCompare(right.name, 'zh-CN');
  });
  return '<option value="">请选择名单来源课程</option>' + courses.map(course => {
    const grades = examCourseGrades(course);
    const scope = grades.length ? grades.map(examGradeLabel).join('、') : '全校';
    return `<option value="${safeDataAttribute(course.id)}" ${course.id === selectedCourseId ? 'selected' : ''}>${escapeHtml(course.name)} · ${escapeHtml(scope)}</option>`;
  }).join('');
}

function renderExamImportPreview() {
  const state = examPlannerState();
  const preview = state.importPreview;
  const container = document.getElementById('exam-import-preview');
  if (!container) return;
  if (!preview) {
    container.classList.add('hidden');
    return;
  }
  container.classList.remove('hidden');
  const mappings = state.importMappings || {};
  const mappedCount = preview.rows.filter(row => mappings[examDurationImportRowKey(row)] || row.course_id).length;
  document.getElementById('exam-import-summary').textContent =
    `${preview.source_filename}：读取 ${preview.summary.exam_count} 门考试，已匹配 ${mappedCount} 门；${preview.summary.skipped_count} 行因未填写有效时长而不加入。`;
  const body = document.getElementById('exam-import-preview-rows');
  body.innerHTML = preview.rows.map(row => {
    const key = examDurationImportRowKey(row);
    const selected = mappings[key] || row.course_id || '';
    return `<tr>
      <td><strong>${escapeHtml(examGradeLabel(row.grade))}</strong><small>第 ${row.source_row} 行</small></td>
      <td><strong>${escapeHtml(row.subject_name)}</strong>${row.course_id ? '<small class="exam-import-match">已自动匹配</small>' : '<small class="exam-import-unmatched">需要选择课程</small>'}</td>
      <td><strong>${row.duration_minutes} 分钟</strong><small>原表：${escapeHtml(row.source_duration || '—')}</small></td>
      <td><select class="select" data-exam-import-course="${safeDataAttribute(key)}">${examImportCourseOptions(row, selected)}</select></td>
    </tr>`;
  }).join('');
  body.querySelectorAll('[data-exam-import-course]').forEach(select => {
    select.addEventListener('change', () => {
      state.importMappings[select.dataset.examImportCourse] = select.value;
      renderExamImportPreview();
    });
  });
}

async function previewExamDurationFile(file) {
  if (!file) return;
  if (!/\.(?:xlsx|xls)$/i.test(file.name)) {
    showToast('考试时长统计表只支持 .xlsx 或 .xls 文件', 'warning');
    return;
  }
  const form = new FormData();
  form.append('file', file);
  setExamStatus('正在读取考试时长统计表…');
  const response = await fetch(`${API_BASE}/exams/import-durations`, { method: 'POST', body: form });
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload?.ok) throw new Error(payload?.errors?.[0]?.msg || '考试时长表读取失败');
  const state = examPlannerState();
  state.importPreview = payload.data;
  state.importMappings = {};
  renderExamImportPreview();
  setExamStatus(`已读取 ${payload.data.summary.exam_count} 门考试。请核对课程匹配和时长，再应用到考试列表。`, 'success');
}

function bindExamDurationImport() {
  const input = document.getElementById('exam-duration-file-input');
  if (!input || input.dataset.bound === 'true') return;
  input.dataset.bound = 'true';
  input.addEventListener('change', async () => {
    try {
      await previewExamDurationFile(input.files?.[0]);
    } catch (error) {
      setExamStatus(`导入失败：${error.message}`, 'error');
      showToast(error.message, 'error');
    } finally {
      input.value = '';
    }
  });
}

function populateExamConfig(plan) {
  const config = plan?.config || {};
  for (const grade of [10, 11, 12]) {
    document.getElementById(`exam-day-count-g${grade}`).value = String(
      config.grade_day_counts?.[grade] || config.day_count || 4,
    );
  }
  document.getElementById('exam-start-date').value = config.start_date || '';
  document.getElementById('exam-day-start').value = config.day_start || '08:00';
  document.getElementById('exam-day-end').value = config.day_end || '17:30';
  document.getElementById('exam-minimum-gap').value = String(config.minimum_exam_gap_minutes || 15);
  document.getElementById('exam-longest-gap').value = String(config.longest_exam_gap_minutes || 30);
  document.getElementById('exam-breaks').value = (config.breaks || [])
    .map(item => `${item.start}-${item.end}`).join('，');
  document.getElementById('exam-room-count').value = String(config.rooms?.length || 10);
  document.getElementById('exam-room-capacity').value = String(config.room_capacity || config.rooms?.[0]?.capacity || 30);
  document.getElementById('exam-invigilators').value = String(config.invigilators_per_room || 1);
  document.getElementById('exam-require-all-teachers').checked = config.require_every_teacher_invigilates !== false;
}

function populateExamCourseSelect() {
  const state = examPlannerState();
  const selected = new Set(state.examRows.map(exam => exam.course_id));
  const select = document.getElementById('exam-course-select');
  if (!select) return;
  select.innerHTML = '<option value="">选择课程</option>' + state.courses
    .filter(course => !selected.has(course.id))
    .sort((left, right) => left.name.localeCompare(right.name, 'zh-CN'))
    .map(course => `<option value="${safeDataAttribute(course.id)}">${escapeHtml(course.name)} · ${escapeHtml(examTypeLabel(course.type))}</option>`)
    .join('');
}

function renderExamCourseRows() {
  const state = examPlannerState();
  const courses = new Map(state.courses.map(course => [course.id, course]));
  const body = document.getElementById('exam-course-rows');
  if (!body) return;
  if (!state.examRows.length) {
    body.innerHTML = '<tr><td colspan="6" class="empty-state">尚未添加考试科目</td></tr>';
    populateExamCourseSelect();
    return;
  }
  body.innerHTML = state.examRows.map(exam => {
    const course = courses.get(exam.course_id) || { name: exam.course_name || exam.course_id, type: '' };
    const examName = exam.course_name || course.name;
    const courseScope = exam.subject_id === 'SECOND_FOREIGN_LANGUAGE'
      || /二外|second[ _-]*foreign[ _-]*language/i.test(examName)
      ? '合并考试：法语 / 日语 / 德语'
      : examName === course.name ? exam.course_id : `名单来源：${course.name}`;
    return `<tr>
      <td><strong>${escapeHtml(examName)}</strong><small>${escapeHtml(courseScope)}</small></td>
      <td>${escapeHtml(examTypeLabel(course.type))}</td>
      <td><input class="input exam-duration" type="number" min="5" max="240" step="5" value="${Number(exam.duration_minutes)}" data-exam-duration="${safeDataAttribute(exam.id)}">${exam.source_duration ? `<small>原表：${escapeHtml(exam.source_duration)} · 可调整</small>` : '<small>按分钟调整</small>'}</td>
      <td>暂不校验${exam.student_count === 0 ? '<small>当前 0 人也会排考</small>' : ''}</td>
      <td>下一阶段</td>
      <td><button class="btn btn-danger btn-sm" type="button" data-exam-remove="${safeDataAttribute(exam.id)}">移除</button></td>
    </tr>`;
  }).join('');
  body.querySelectorAll('[data-exam-duration]').forEach(select => {
    select.addEventListener('change', () => {
      const exam = state.examRows.find(item => item.id === select.dataset.examDuration);
      if (exam) exam.duration_minutes = Number(select.value);
    });
  });
  body.querySelectorAll('[data-exam-remove]').forEach(button => {
    button.addEventListener('click', () => {
      state.examRows = state.examRows.filter(exam => exam.id !== button.dataset.examRemove);
      renderExamCourseRows();
    });
  });
  populateExamCourseSelect();
}

function teacherDisplayMap(schedule) {
  return new Map((schedule?.teacher_loads || []).map(item => [item.teacher_id, item.teacher_name]));
}

function renderExamSchedule(schedule) {
  const card = document.getElementById('exam-result-card');
  const exportButton = document.getElementById('exam-export-button');
  if (!schedule?.ok || !schedule.validation?.ok) {
    card?.classList.add('hidden');
    if (exportButton) exportButton.disabled = true;
    return;
  }
  card?.classList.remove('hidden');
  if (exportButton) exportButton.disabled = false;
  const timetableOnly = schedule.plan?.config?.timetable_only === true;
  const teachers = teacherDisplayMap(schedule);
  const nameList = ids => (ids || []).map(id => teachers.get(id) || id).join('、') || '—';
  const restPolicy = examRestPolicySummary(schedule);
  document.getElementById('exam-result-summary').textContent =
    timetableOnly
      ? `已完成 ${schedule.sessions.length} 门考试，时间窗口、休息间隔和年级内顺序校验通过；可以导出三个年级考试时间表。${restPolicy}`
      : `已完成 ${schedule.sessions.length} 门考试，独立校验通过；可以导出考试总表、教师任务和考场座次。${restPolicy}`;
  const eligibleTeacherLoads = (schedule.teacher_loads || [])
    .filter(item => item.invigilation_eligible !== false);
  const loads = eligibleTeacherLoads.map(item => item.invigilation_count);
  const gradeCount = new Set(schedule.sessions.flatMap(session => session.grades || [])).size;
  document.getElementById('exam-result-metrics').innerHTML = (timetableOnly ? [
    ['使用天数', `${schedule.metrics.used_days} 天`],
    ['考试科目', `${schedule.sessions.length} 门`],
    ['年级时间表', `${gradeCount} 个`],
    ['当前阶段', '仅排时间'],
  ] : [
    ['使用天数', `${schedule.metrics.used_days} 天`],
    ['考试科目', `${schedule.sessions.length} 门`],
    ['考场场次', `${schedule.metrics.total_room_sessions} 场`],
    ['监考差值', loads.length ? `${Math.max(...loads) - Math.min(...loads)} 场` : '待安排'],
  ]).map(([label, value]) => `<div><span>${label}</span><strong>${value}</strong></div>`).join('');
  document.getElementById('exam-schedule-rows').innerHTML = schedule.sessions.map(session => `<tr>
    <td>${escapeHtml(session.day_label)}</td>
    <td><strong>${escapeHtml(session.start_time)}–${escapeHtml(session.end_time)}</strong><small>${session.duration_minutes} 分钟</small></td>
    <td><strong>${escapeHtml(session.course_name)}</strong></td>
    <td>${timetableOnly ? '暂不校验' : `${session.student_count} 人`}</td>
    <td>${timetableOnly ? '下一阶段' : session.room_allocations.map(room => `${escapeHtml(room.room_name)}（${room.student_ids.length}人）`).join('<br>')}</td>
    <td>${timetableOnly ? '下一阶段' : escapeHtml(nameList(session.chief_teacher_ids))}</td>
    <td>${timetableOnly ? '下一阶段' : session.room_allocations.map(room => `<span>${escapeHtml(room.room_name)}：${escapeHtml(nameList(room.invigilator_teacher_ids))}</span>`).join('<br>')}</td>
  </tr>`).join('');
  const loadContainer = document.getElementById('exam-teacher-loads');
  loadContainer.innerHTML = timetableOnly
    ? '<h4>教师任务</h4><div><span>将在下一阶段安排监考与巡考</span></div>'
    : '<h4>教师任务（安生教师中除升学顾问外参加监考）</h4><div>' + (schedule.teacher_loads || [])
      .map(item => {
        const groupName = item.exam_staff_group_name || '安生教师';
        const invigilationText = item.invigilation_eligible !== false
          ? `${item.invigilation_count} 场 / ${item.invigilation_minutes} 分钟`
          : (item.invigilation_exemption_reason || '不参加监考');
        return `<span><strong>${escapeHtml(item.teacher_name)}</strong><em>${escapeHtml(groupName)}</em>${invigilationText}${item.chief_exam_ids.length ? ` · 巡考 ${item.chief_exam_ids.length} 门` : ''}</span>`;
      })
      .join('') + '</div>';
}

async function loadExamPlanner() {
  const data = await api('/exams');
  window._examPlanner = {
    ...data,
    examRows: (data.plan?.exams || []).map(exam => ({ ...exam })),
    importPreview: null,
    importMappings: {},
  };
  populateExamConfig(data.plan);
  bindExamDurationImport();
  renderExamImportPreview();
  renderExamCourseRows();
  renderExamSchedule(data.solve_status === 'valid' ? data.schedule : null);
  const status = data.plan_issues?.length
    ? `考试计划有 ${data.plan_issues.length} 项需要修复：${data.plan_issues[0].message}。请移除失效科目或重新保存。`
    : data.solve_status === 'valid'
      ? '当前考试安排已生成并通过校验。'
      : data.plan?.exams?.length
        ? '考试设置已保存；点击“生成考试安排”计算三个年级的考试时间表。'
        : '先设置考试周期，再从课程目录添加本次需要考试的科目。';
  setExamStatus(status, data.plan_issues?.length ? 'error' : data.solve_status === 'valid' ? 'success' : '');
}

window.addExamCourse = function() {
  const state = examPlannerState();
  const select = document.getElementById('exam-course-select');
  const courseId = select?.value;
  if (!courseId) return showToast('请先选择考试课程', 'warning');
  if (state.examRows.some(exam => exam.course_id === courseId)) return showToast('该课程已经在考试列表中', 'warning');
  const course = state.courses.find(item => item.id === courseId);
  state.examRows.push({
    id: `EXAM_${courseId}`,
    course_id: courseId,
    course_name: course?.name || courseId,
    duration_minutes: Number(document.getElementById('exam-duration-select').value),
  });
  renderExamCourseRows();
};

window.applyExamDurationImport = function() {
  const state = examPlannerState();
  if (!state.importPreview) return showToast('请先选择考试时长统计表', 'warning');
  const imported = examRowsFromDurationImport(state.importPreview.rows, state.importMappings || {});
  if (imported.unmapped.length) {
    showToast(`还有 ${imported.unmapped.length} 门考试没有选择名单来源课程`, 'warning');
    return;
  }
  if (state.examRows.length && !window.confirm(`将用导入的 ${imported.exams.length} 门考试替换当前考试列表，是否继续？`)) return;
  state.examRows = imported.exams;
  renderExamCourseRows();
  setExamStatus(`已把 ${imported.exams.length} 门考试加入列表。分钟数仍可逐科调整；确认后请保存考试设置。`, 'success');
  showToast(`已导入 ${imported.exams.length} 门考试`, 'success');
};

function examEditorFields(timetableOnly) {
  return {
    timetable_only: timetableOnly,
    grade_day_counts: {
      10: document.getElementById('exam-day-count-g10').value,
      11: document.getElementById('exam-day-count-g11').value,
      12: document.getElementById('exam-day-count-g12').value,
    },
    start_date: document.getElementById('exam-start-date').value,
    day_start: document.getElementById('exam-day-start').value,
    day_end: document.getElementById('exam-day-end').value,
    minimum_exam_gap_minutes: document.getElementById('exam-minimum-gap').value,
    longest_exam_gap_minutes: document.getElementById('exam-longest-gap').value,
    breaks: document.getElementById('exam-breaks').value,
    room_count: document.getElementById('exam-room-count').value,
    room_capacity: document.getElementById('exam-room-capacity').value,
    invigilators_per_room: document.getElementById('exam-invigilators').value,
    require_every_teacher_invigilates: document.getElementById('exam-require-all-teachers').checked,
  };
}

window.saveExamPlan = async function({ quiet = false, timetableOnly } = {}) {
  const state = examPlannerState();
  try {
    const effectiveTimetableOnly = timetableOnly ?? state.plan?.config?.timetable_only !== false;
    const plan = examPlanFromEditor(examEditorFields(effectiveTimetableOnly), state.examRows);
    const saved = await api('/exams', {
      method: 'PUT',
      body: JSON.stringify({ plan, expected_revision: state.revision }),
    });
    window._examPlanner = { ...saved, examRows: saved.plan.exams.map(exam => ({ ...exam })) };
    populateExamConfig(saved.plan);
    renderExamCourseRows();
    renderExamSchedule(null);
    if (!quiet) {
      setExamStatus('考试设置已保存，旧的考试安排已失效。', 'success');
      showToast('考试设置已保存', 'success');
    }
    return window._examPlanner;
  } catch (error) {
    setExamStatus(`保存失败：${error.message}`, 'error');
    throw error;
  }
};

async function solveExamPhase({ timetableOnly, progressMessage, successMessage, toastMessage }) {
  try {
    setExamStatus(`${progressMessage}，最多等待 ${DEFAULT_EXAM_SOLVE_SECONDS} 秒…`);
    const saved = await window.saveExamPlan({ quiet: true, timetableOnly });
    const result = await api('/exams/solve', {
      method: 'POST',
      body: JSON.stringify(examSolveRequest(saved.revision)),
      computation: {
        label: progressMessage,
        successText: toastMessage,
        maxSeconds: DEFAULT_EXAM_SOLVE_SECONDS,
      },
    });
    window._examPlanner.schedule = result.schedule;
    window._examPlanner.revision = result.revision;
    window._examPlanner.solve_status = 'valid';
    renderExamSchedule(result.schedule);
    setExamStatus(successMessage, 'success');
    showToast(toastMessage, 'success');
  } catch (error) {
    setExamStatus(`生成失败：${error.message}`, 'error');
  }
}

window.solveExamPlan = async function() {
  return solveExamPhase({
    timetableOnly: true,
    progressMessage: '正在使用约束求解器生成三个年级考试时间表',
    successMessage: '三个年级考试时间表已生成；全部科目均在规定天数内完成，且时长、停考时段与考试间休息校验通过。',
    toastMessage: '考试时间表生成成功',
  });
};

window.staffExamPlan = async function() {
  return solveExamPhase({
    timetableOnly: false,
    progressMessage: '正在分配考场、座次、巡考和监考任务',
    successMessage: '考场、座次、巡考和监考任务已生成，并通过学生、教室与教师冲突校验。',
    toastMessage: '监考与巡考安排生成成功',
  });
};

window.exportExamPlan = async function() {
  try {
    const response = await fetch(`${API_BASE}/exams/export`);
    if (!response.ok) {
      const payload = await response.json();
      throw new Error(payload.errors?.[0]?.msg || '导出失败');
    }
    const url = URL.createObjectURL(await response.blob());
    const link = document.createElement('a');
    link.href = url;
    link.download = window._examPlanner?.schedule?.plan?.config?.timetable_only === false
      ? '考试安排与考场座次.xlsx'
      : '三个年级考试时间表.xlsx';
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    showToast('考试 Excel 已导出', 'success');
  } catch (error) {
    showToast(error.message, 'error');
  }
};

const MANUAL_TIMETABLE_STORAGE_KEY = 'timetable.manual-drafts.v1';

function readManualDrafts() {
  try { return JSON.parse(localStorage.getItem(MANUAL_TIMETABLE_STORAGE_KEY) || '{}'); }
  catch { return {}; }
}

function writeManualDrafts(drafts) {
  localStorage.setItem(MANUAL_TIMETABLE_STORAGE_KEY, JSON.stringify(drafts));
}

function manualPlanIsConfirmed() {
  return window._manualPlan?.status === 'confirmed';
}

function manualSlotId(day, period) { return `D${day}P${period}`; }

function manualCurrentClassId() {
  return document.getElementById('manual-class-select')?.value || '';
}

function manualCourseLabel(course) {
  return `${course.name || course.id}${course.weekly_hours ? ` · ${course.weekly_hours} 节/周` : ''}`;
}

function manualCoursesForCurrentClass(courses) {
  const currentClass = window._manualClassesById?.get(manualCurrentClassId());
  if (!currentClass) return [];
  return courses.filter(course => courseAppliesToManualClass(course, currentClass));
}

function manualSectionsForCourse(classInfo, courseId) {
  return manualSectionsForClassCourse(
    window._manualSections || [],
    classInfo,
    courseId,
    window._manualClassesById,
  );
}

function manualDeckSectionsForCourse(classInfo, courseId) {
  return manualDeckSectionsForClassCourse(
    window._manualSections || [],
    classInfo,
    courseId,
    window._manualClassesById,
  );
}

function manualCoursePoolItems(courses, selectionBlocks = [], classInfo = null) {
  const courseById = new Map(courses.map(course => [course.id, course]));
  const bundledCourseIds = new Set();
  const bundles = [];
  const addBundle = (id, courseIds, name) => {
    const bundleCourses = courseIds.map(courseId => courseById.get(courseId)).filter(Boolean);
    if (bundleCourses.length < 2) return;
    const sectionIds = bundleCourses.flatMap(course =>
      manualSectionsForCourse(classInfo, course.id).map(section => section.id));
    if (!sectionIds.length) return;
    bundleCourses.forEach(course => bundledCourseIds.add(course.id));
    bundles.push({
      id: `bundle:${id}`,
      kind: 'bundle',
      name: bundleCourses.map(course => course.name || course.id).join(' / '),
      group_name: name,
      course_ids: bundleCourses.map(course => course.id),
      section_ids: [...new Set(sectionIds)],
      weekly_hours: Math.max(...bundleCourses.map(course => Number(course.weekly_hours) || 0)),
      category: 'elective',
      manual_unlimited: false,
    });
  };

  for (const block of selectionBlocks) {
    if (block?.synchronized_time_block !== true) continue;
    addBundle(block.id, block.allowed_course_ids || [], block.name || '同步选课组');
  }

  const electiveGroups = new Map();
  for (const course of courses) {
    if (course.type !== 'required_elective' || !course.elective_group || bundledCourseIds.has(course.id)) continue;
    const grade = Array.isArray(course.grade) ? course.grade.join('_') : course.grade;
    const key = `${grade || 'all'}:${course.elective_group}`;
    const group = electiveGroups.get(key) || [];
    group.push(course); electiveGroups.set(key, group);
  }
  for (const [key, group] of electiveGroups) {
    addBundle(`elective_group:${key}`, group.map(course => course.id), `${group[0].elective_group} 组选修`);
  }

  const individualCourses = courses
    .filter(course => !bundledCourseIds.has(course.id))
    .flatMap(course => {
      const sections = manualSectionsForCourse(classInfo, course.id);
      if (!sections.length) return [];
      const deckSections = manualDeckSectionsForCourse(classInfo, course.id);
      const category = manualCourseCategory(course, classInfo?.id);
      const placementScope = manualPlacementScopeForSections(sections, classInfo);
      const usesGradeTeachingDeck = classInfo?.class_type === 'teaching'
        && sections.some(section => section.class_type === 'teaching'
          && section.class_id === classInfo.id)
        && deckSections.length > 1;
      // One administrative course may have one canonical section per
      // administrative class.  It must still be one draggable card: after the
      // drop the user chooses the target administrative class, at which point
      // that class resolves its own exact section.
      if (sections.length === 1 || shouldCollapseAdminSections(sections, classInfo)) return [{
        id: course.id,
        kind: 'course',
        name: course.name || course.id,
        course_ids: [course.id],
        // In a teaching-class view an administrative course is one card, but
        // that card draws from every same-grade administrative-class section.
        // Keeping all IDs here makes the deck total and remaining count use
        // exactly the same inventory.
        section_ids: shouldCollapseAdminSections(sections, classInfo)
          ? sections.map(section => section.id)
          : usesGradeTeachingDeck
            ? deckSections.map(section => section.id)
            : [sections[0].id],
        local_section_ids: sections.map(section => section.id),
        weekly_hours: Number(course.weekly_hours) || 0,
        category,
        placement_scope: placementScope,
        deck_scope: usesGradeTeachingDeck ? 'grade_teaching' : 'class',
        teacher_unassigned: sections.some(section => section.source === 'course_configuration' && !section.teacher_id),
        manual_unlimited: course.manual_unlimited === true,
      }];
      return sections.map((section, index) => ({
        id: `section:${section.id}`,
        kind: 'section',
        name: `${course.name || course.id} · Section ${index + 1}`,
        course_ids: [course.id],
        section_ids: [section.id],
        weekly_hours: Number(course.weekly_hours) || 0,
        category,
        placement_scope: placementScope,
        teacher_unassigned: !sections[0].teacher_id && sections[0].source === 'course_configuration',
        manual_unlimited: course.manual_unlimited === true,
      }));
    });
  return [...bundles, ...individualCourses].sort((left, right) =>
    left.name.localeCompare(right.name, 'zh-CN'));
}

function manualPoolItemLabel(item) {
  return `${item.name}${item.weekly_hours ? ` · ${item.weekly_hours} 节/周` : ''}`;
}

function manualStoredItem(itemId, classId = manualCurrentClassId()) {
  const items = manualItemsForClass(classId);
  const courseId = itemId?.startsWith('section:')
    ? window._manualSections?.find(section => `section:${section.id}` === itemId)?.course_id
    : itemId;
  const course = (window._manualCourses || []).find(item => item.id === courseId);
  const stored = items.find(item => item.id === itemId);
  if (stored) {
    return stored.kind === 'course' && course
      ? {
        ...stored,
        // The visible grade-wide deck must be narrowed back to the selected
        // teaching class when a card becomes an actual manual placement.
        section_ids: stored.deck_scope === 'grade_teaching'
          ? manualSectionsForCourse(window._manualClassesById?.get(classId), course.id)
            .filter(section => section.class_type === 'teaching' && section.class_id === classId)
            .map(section => section.id)
          : stored.section_ids,
        category: manualCourseCategory(course, classId),
      }
      : stored;
  }
  const classInfo = window._manualClassesById?.get(classId);
  const sections = course ? manualSectionsForCourse(classInfo, course.id) : [];
  return course ? {
      id: itemId,
      kind: 'course',
      name: course.name || itemId,
      course_ids: [course.id],
      section_ids: itemId?.startsWith('section:')
        ? [itemId.slice('section:'.length)]
        : sections.map(section => section.id),
      weekly_hours: course.weekly_hours,
      category: manualCourseCategory(course, classId),
      placement_scope: manualPlacementScopeForSections(sections, classInfo),
      manual_unlimited: course.manual_unlimited === true,
    } : null;
}

function manualItemsForClass(classId) {
  const classInfo = window._manualClassesById?.get(classId);
  if (!classInfo) return [];
  return manualCoursePoolItems(
    (window._manualCourses || []).filter(course => courseAppliesToManualClass(course, classInfo)),
    window._manualSelectionBlocks || [],
    classInfo,
  );
}

function manualAssignmentClassIds(assignment = {}) {
  return Array.isArray(assignment.class_ids)
    ? assignment.class_ids
    : assignment.class_id ? [assignment.class_id] : [];
}

function manualStudentIdsForClass(classId) {
  const currentClass = window._manualClassesById?.get(classId);
  if (!currentClass) return new Set();
  const studentField = currentClass.class_type === 'admin' ? 'admin_class_id' : 'teaching_class_id';
  const liveRoster = (window._manualStudents || [])
    .filter(student => student[studentField] === classId)
    .map(student => student.id);
  return new Set(liveRoster.length ? liveRoster : currentClass.student_ids || []);
}

function manualAdminClassIdsForTeachingClass(classId) {
  const currentClass = window._manualClassesById?.get(classId);
  if (!currentClass || currentClass.class_type !== 'teaching') return [];
  // Administrative lessons are grade-wide timetable events.  Show the same
  // administrative draft in all teaching-class views of that grade, rather
  // than only in the teaching class where the editor happened to enter it.
  const ids = [...(window._manualClassesById?.values() || [])]
    .filter(item => item.class_type === 'admin' && Number(item.grade) === Number(currentClass.grade))
    .map(item => item.id);
  return ids.sort((left, right) => {
    const leftName = window._manualClassesById?.get(left)?.name || left;
    const rightName = window._manualClassesById?.get(right)?.name || right;
    return leftName.localeCompare(rightName, 'zh-CN');
  });
}

function manualTeacherIdsForItem(classId, item) {
  return manualTeacherIdsForClassItem(
    window._manualTeachingAssignments || [],
    classId,
    item,
  );
}

function manualSetIntersects(left, right) {
  for (const value of left) if (right.has(value)) return true;
  return false;
}

function manualCoursesOverlap(left, right) {
  return manualSetIntersects(new Set(left.item.course_ids || []), new Set(right.item.course_ids || []));
}

function manualConflictMap() {
  const drafts = readManualDrafts();
  const entriesBySlot = new Map();
  const conflicts = new Map();
  const addConflict = (entry, reason) => {
    const key = `${entry.classId}:${entry.slotId}`;
    const reasons = conflicts.get(key) || new Set();
    reasons.add(reason);
    conflicts.set(key, reasons);
  };

  for (const [classId, draft] of Object.entries(drafts)) {
    if (!window._manualClassesById?.has(classId)) continue;
    for (const [slotId, itemId] of Object.entries(draft || {})) {
      const item = manualStoredItem(itemId, classId);
      if (!item) continue;
      const entry = {
        classId,
        slotId,
        item,
        studentIds: manualStudentIdsForClass(classId),
        teacherIds: manualTeacherIdsForItem(classId, item),
      };
      const slotEntries = entriesBySlot.get(slotId) || [];
      for (const other of slotEntries) {
        // The same course shown in two linked class views can be the same
        // teaching event. Student conflicts only apply to different courses.
        if (!manualCoursesOverlap(entry, other)
          && manualSetIntersects(entry.studentIds, other.studentIds)) {
          addConflict(entry, '学生课程冲突');
          addConflict(other, '学生课程冲突');
        }
        if (manualSetIntersects(entry.teacherIds, other.teacherIds)) {
          addConflict(entry, '教师冲突');
          addConflict(other, '教师冲突');
        }
      }
      slotEntries.push(entry);
      entriesBySlot.set(slotId, slotEntries);
    }
  }
  return conflicts;
}

function manualCourseCategory(course, classId = manualCurrentClassId()) {
  if (course.type === 'ap') return 'ap';
  if (course.type === 'required_elective') return 'elective';
  if (course.type !== 'required') return 'other';
  const assignments = (window._manualTeachingAssignments || [])
    .filter(assignment => assignment.course_id === course.id);
  const currentClass = window._manualClassesById?.get(classId);
  const sameGradeAssignments = currentClass ? assignments.filter(assignment => {
    const assignedIds = Array.isArray(assignment.class_ids)
      ? assignment.class_ids
      : assignment.class_id ? [assignment.class_id] : [];
    return assignedIds.some(classId =>
      Number(window._manualClassesById?.get(classId)?.grade) === Number(currentClass.grade));
  }) : assignments;
  const classTypes = new Set((sameGradeAssignments.length ? sameGradeAssignments : assignments)
    .map(assignment => assignment.class_type));
  return classTypes.has('teaching') ? 'teaching-required' : 'admin-required';
}

function manualCourseCategoryLabel(category) {
  return ({
    'admin-required': '行政班必修',
    'teaching-required': '教学班必修',
    ap: 'AP 选修',
    elective: '非必修选修',
    other: '其他',
  })[category] || '其他';
}

function manualSectionUsageCounts() {
  const usage = new Map();
  for (const [classId, draft] of Object.entries(readManualDrafts())) {
    if (!window._manualClassesById?.has(classId)) continue;
    for (const itemId of Object.values(draft || {})) {
      const item = manualStoredItem(itemId, classId);
      if (!item) continue;
      for (const sectionId of item.section_ids || []) {
        usage.set(sectionId, (usage.get(sectionId) || 0) + 1);
      }
    }
  }
  return usage;
}

function manualRemainingUses(item, usageCounts = manualSectionUsageCounts()) {
  return manualPoolItemRemaining(
    item,
    new Map((window._manualSections || []).map(section => [section.id, section])),
    usageCounts,
  );
}

function manualAdministrativeAlternatives(item, classId, usageCounts = manualSectionUsageCounts()) {
  const targetClass = window._manualClassesById?.get(classId);
  const courseId = item?.course_ids?.length === 1 ? item.course_ids[0] : null;
  if (!targetClass || targetClass.class_type !== 'admin' || !courseId) return [];
  return (window._manualSections || [])
    .filter(section => section.course_id === courseId
      && section.class_type === 'admin'
      && Number(section.grades?.[0]) === Number(targetClass.grade))
    .map(section => ({
      section,
      classInfo: window._manualClassesById?.get(section.class_id),
      remaining: Math.max(0, Number(section.weekly_hours || 0) - Number(usageCounts.get(section.id) || 0)),
    }));
}

function manualCourseExhaustedMessage(item, classId, usageCounts = manualSectionUsageCounts()) {
  const availableElsewhere = manualAdministrativeAlternatives(item, classId, usageCounts)
    .filter(candidate => candidate.remaining > 0);
  if (availableElsewhere.length) {
    const targetName = window._manualClassesById?.get(classId)?.name || classId;
    const elsewhere = availableElsewhere.map(candidate =>
      `${candidate.classInfo?.name || candidate.section.class_id} 还剩 ${candidate.remaining} 节`).join('；');
    return `${targetName}的“${item.name}”已经排完；${elsewhere}，请拖到对应行政班的分格`;
  }
  return '这门课的规定课时已经全部排完';
}

function renderManualCoursePool() {
  const pool = document.getElementById('manual-course-pool');
  const count = document.getElementById('manual-course-count');
  if (!pool) return;
  const keyword = (document.getElementById('manual-course-search')?.value || '').trim().toLowerCase();
  const usageCounts = manualSectionUsageCounts();
  const sectionsById = new Map((window._manualSections || []).map(section => [section.id, section]));
  const items = (window._manualPoolItems || [])
    .map(item => ({
      ...item,
      remaining_uses: manualPoolItemRemaining(item, sectionsById, usageCounts),
      total_hours: manualPoolItemTotalHours(item, sectionsById),
      current_class_remaining: item.deck_scope === 'grade_teaching'
        ? manualPoolItemRemaining({ ...item, section_ids: item.local_section_ids, deck_scope: 'class' }, sectionsById, usageCounts)
        : null,
      administrative_progress: item.placement_scope === 'admin' && item.kind === 'course'
        ? item.section_ids.map(sectionId => {
          const section = sectionsById.get(sectionId);
          return section ? {
            className: window._manualClassesById?.get(section.class_id)?.name || section.class_id,
            remaining: Math.max(0, Number(section.weekly_hours || 0) - Number(usageCounts.get(sectionId) || 0)),
          } : null;
        }).filter(Boolean)
        : [],
    }))
    .map(item => ({
      ...item,
      scheduled_uses: item.remaining_uses === Infinity
        ? null
        : Math.max(0, item.total_hours - item.remaining_uses),
    }))
    .filter(item => item.remaining_uses > 0)
    .filter(item => !keyword
      || `${item.name} ${item.group_name || ''} ${(item.course_ids || []).join(' ')}`.toLowerCase().includes(keyword));
  count.textContent = `${items.length} 项`;
  const locked = manualPlanIsConfirmed();
  pool.innerHTML = items.map(item => {
    const category = item.category;
    return `
    <div class="manual-course-card category-${category} ${item.kind === 'bundle' ? 'is-bundle' : ''} ${locked || item.current_class_remaining === 0 ? 'is-disabled' : ''}" draggable="${locked || item.current_class_remaining === 0 ? 'false' : 'true'}" data-manual-item-id="${item.id}" data-manual-placement-scope="${item.placement_scope || 'class'}">
      <div class="manual-course-name">${item.name}</div>
      <div class="manual-course-meta"><span class="manual-course-category-badge">${manualCourseCategoryLabel(category)}</span>${item.kind === 'bundle' ? `${item.group_name} · 同时开设 · 每组` : item.deck_scope === 'grade_teaching' ? '年级教学班合计' : item.placement_scope === 'admin' && item.kind === 'course' ? '行政班（每班）' : item.section_ids?.[0] || item.course_ids[0]}${item.teacher_unassigned ? ' · 待配教师' : ''}${item.remaining_uses === Infinity ? ' · 可重复安排' : item.placement_scope === 'admin' && item.kind === 'course' ? ` · 每班每周 ${item.total_hours} 节` : ` · 每周 ${item.total_hours} 节 · 已排 ${item.scheduled_uses}/${item.total_hours} 节`}${item.current_class_remaining === 0 ? ' · 本班已排完' : item.current_class_remaining != null ? ` · 本班剩余 ${item.current_class_remaining} 节` : ''}<span class="manual-course-remaining">${item.remaining_uses === Infinity ? '不限次数' : `年级剩余 ${item.remaining_uses} 次`}</span>${item.administrative_progress?.length ? `<span class="manual-course-admin-progress">${item.administrative_progress.map(progress => `${progress.className}：${progress.remaining ? `剩 ${progress.remaining} 节` : '已排完'}`).join(' · ')}</span>` : ''}</div>
    </div>
  `;
  }).join('') || '<div class="empty-state"><p>没有匹配课程</p></div>';
  if (locked) return;
  pool.querySelectorAll('.manual-course-card').forEach(card => {
    card.addEventListener('dragstart', event => {
      event.dataTransfer.effectAllowed = 'copy';
      event.dataTransfer.setData('application/x-manual-item', card.dataset.manualItemId);
    });
  });
}

function manualPlacementsFromDrafts() {
  const drafts = readManualDrafts();
  const placements = [];
  for (const [classId, draft] of Object.entries(drafts)) {
    for (const [slotId, itemId] of Object.entries(draft || {})) {
      const item = manualStoredItem(itemId, classId);
      if (!item) throw new Error(`${classId} 的 ${slotId} 引用了已不存在的课程项 ${itemId}`);
      placements.push({
        class_id: classId,
        slot_id: slotId,
        item_id: item.id,
        item_name: item.name,
        course_ids: item.course_ids || [],
        section_ids: item.section_ids || [],
      });
    }
  }
  return placements;
}

function hydrateManualDrafts(plan) {
  if (!(plan?.placements || []).length) return false;
  const drafts = {};
  for (const placement of plan.placements) {
    drafts[placement.class_id] = {
      ...(drafts[placement.class_id] || {}),
      [placement.slot_id]: placement.item_id,
    };
  }
  writeManualDrafts(drafts);
  return true;
}

let manualDraftSyncTimer = null;
function queueManualDraftSync() {
  if (manualPlanIsConfirmed()) return;
  clearTimeout(manualDraftSyncTimer);
  manualDraftSyncTimer = setTimeout(async () => {
    try {
      const plan = await api('/manual-plan/draft', {
        method: 'PUT',
        body: JSON.stringify({ placements: manualPlacementsFromDrafts() }),
      });
      window._manualPlan = plan;
      renderManualPlanControls();
    } catch {
      // api() already presents the backend mapping/validation error.
    }
  }, 250);
}

function manualLockedPlacementKeys() {
  if (!manualPlanIsConfirmed()) return new Set();
  return new Set((window._manualPlan.placements || []).map(placement =>
    `${placement.class_id}\u0000${placement.slot_id}\u0000${placement.item_id}`));
}

function manualPlacementIsLocked(classId, slotId, itemId) {
  return manualLockedPlacementKeys().has(`${classId}\u0000${slotId}\u0000${itemId}`);
}

function renderManualPlanControls(message = '') {
  const plan = window._manualPlan || { status: 'draft', placements: [], locks: [] };
  const confirmed = plan.status === 'confirmed';
  const placementCount = (() => {
    try { return manualPlacementsFromDrafts().length; } catch { return (plan.placements || []).length; }
  })();
  const confirmButton = document.getElementById('manual-confirm-plan');
  const unlockButton = document.getElementById('manual-unlock-plan');
  const solveButton = document.getElementById('manual-ai-solve');
  const optimizeButton = document.getElementById('manual-ai-optimize');
  const clearButton = document.getElementById('manual-clear-class');
  if (confirmButton) {
    confirmButton.disabled = confirmed || !placementCount;
    confirmButton.classList.toggle('hidden', confirmed);
  }
  if (unlockButton) unlockButton.classList.toggle('hidden', !confirmed);
  if (solveButton) solveButton.disabled = !confirmed || window._manualAiRunning === true;
  if (optimizeButton) {
    optimizeButton.disabled = !confirmed
      || window._manualScheduleAvailable !== true
      || window._manualAiRunning === true;
  }
  if (clearButton) clearButton.disabled = confirmed;
  const status = document.getElementById('manual-plan-status');
  if (!status) return;
  status.className = `manual-plan-status status-${plan.status || 'draft'}`;
  if (message) {
    status.textContent = message;
  } else if (confirmed) {
    status.textContent = window._manualScheduleAvailable === true
      ? `完整课表已生成并显示在下方：${plan.counts?.section_locks || plan.locks?.length || 0} 个金框必要条件保持锁定，其余课程标记为“AI 已排”。`
      : `已锁定：${plan.counts?.visual_placements || placementCount} 个手动格，展开为 ${plan.counts?.section_locks || plan.locks?.length || 0} 个 section 必要条件。AI 排课不会移动金框课程。`;
  } else if (plan.status === 'stale') {
    status.textContent = plan.issues?.[0]?.message || '输入数据已变化，请重新校验并确认必要条件。';
  } else {
    const base = placementCount
      ? `手动草稿：${placementCount} 个课程格，尚未锁定。确认前仍可拖动或删除。`
      : '第一步：把需要人工确定的课程拖入课表；完成后点击“确认为必要条件”。';
    status.textContent = window._manualPlan?.catalog?.warning
      ? `${base} 注意：${window._manualPlan.catalog.warning}`
      : base;
  }
}

function saveManualCourseToSlot(slotId, itemId, classId = manualCurrentClassId()) {
  if (!classId || !itemId || manualPlanIsConfirmed()) return;
  const item = manualStoredItem(itemId, classId);
  if (!item || manualRemainingUses(item) <= 0) {
    showToast(item ? manualCourseExhaustedMessage(item, classId) : '课程项已不存在，请刷新页面', 'error');
    return;
  }
  const drafts = readManualDrafts();
  drafts[classId] = { ...(drafts[classId] || {}), [slotId]: itemId };
  writeManualDrafts(drafts);
  renderManualCoursePool();
  renderManualTimetableGrid();
  renderManualPlanControls();
  queueManualDraftSync();
}

function removeManualCourseFromSlot(slotId, classId = manualCurrentClassId()) {
  if (manualPlanIsConfirmed()) return;
  const drafts = readManualDrafts();
  if (!drafts[classId]?.[slotId]) return;
  delete drafts[classId][slotId];
  writeManualDrafts(drafts);
  renderManualCoursePool();
  renderManualTimetableGrid();
  renderManualPlanControls();
  queueManualDraftSync();
}

function saveManualCourseToAdminClasses(slotId, itemId, adminClassIds) {
  if (manualPlanIsConfirmed()) return;
  const drafts = readManualDrafts();
  for (const adminClassId of adminClassIds) {
    drafts[adminClassId] = { ...(drafts[adminClassId] || {}), [slotId]: itemId };
  }
  writeManualDrafts(drafts);
  renderManualCoursePool();
  renderManualTimetableGrid();
  renderManualPlanControls();
  queueManualDraftSync();
}

function openManualAdminPlacementDialog(teachingClassId, slotId, itemId) {
  const adminClassIds = manualAdminClassIdsForTeachingClass(teachingClassId);
  const usageCounts = manualSectionUsageCounts();
  const availableClassIds = adminClassIds.filter(classId => {
    const targetItem = manualStoredItem(itemId, classId);
    return targetItem && manualRemainingUses(targetItem, usageCounts) > 0;
  });
  if (!availableClassIds.length) {
    showToast('这门行政班课程的规定课时已经全部排完', 'error');
    renderManualCoursePool();
    return;
  }
  if (availableClassIds.length === 1) {
    saveManualCourseToAdminClasses(slotId, itemId, availableClassIds);
    return;
  }
  const item = manualStoredItem(itemId, teachingClassId);
  const names = availableClassIds.map(id => window._manualClassesById?.get(id)?.name || id);
  showModal('安排行政班课程', `
    <p>将“${item?.name || itemId}”安排到哪一个行政班？选择“两个行政班同上”后，教学班课表会自动合并为一个课程格。</p>
    <div class="form-actions manual-admin-target-actions">
      ${availableClassIds.map((id, index) => `<button type="button" class="btn btn-secondary manual-admin-target-choice" data-target-class-ids="${id}">${names[index]}</button>`).join('')}
      ${availableClassIds.length === adminClassIds.length
        ? `<button type="button" class="btn btn-primary manual-admin-target-choice" data-target-class-ids="${availableClassIds.join(',')}">两个行政班同上</button>`
        : ''}
    </div>
  `);
  document.querySelectorAll('.manual-admin-target-choice').forEach(button => {
    button.addEventListener('click', () => {
      saveManualCourseToAdminClasses(slotId, itemId, button.dataset.targetClassIds.split(','));
      hideModal();
    });
  });
}

function manualCourseSlotMarkup({ item, slotId, targetClassId, conflictReasons = [], label = '', placeholder = '拖入课程' }) {
  const conflictTitle = conflictReasons.length ? `课程冲突：${conflictReasons.join('、')}` : '';
  const labelMarkup = label ? `<span class="manual-slot-lane-label">${label}</span>` : '';
  if (!item) return `${labelMarkup}<span class="manual-slot-placeholder">${placeholder}</span>`;
  const locked = manualPlacementIsLocked(targetClassId, slotId, item.id);
  return `${labelMarkup}
    <div class="manual-slot-course">
      <span>${manualPoolItemLabel(item)}</span>
      ${locked
        ? '<span class="manual-lock-badge" title="已确认为必要条件" aria-label="已锁定">🔒</span>'
        : `<button type="button" class="manual-slot-remove" data-slot-id="${slotId}" data-target-class-id="${targetClassId}" aria-label="删除课程">×</button>`}
    </div>
    ${conflictReasons.length ? `<span class="manual-slot-conflict-mark" aria-label="${conflictTitle}" title="${conflictTitle}"></span>` : ''}`;
}

function shouldShowManualGeneratedTimetable() {
  return window._manualScheduleAvailable === true && manualPlanIsConfirmed();
}

function manualGeneratedSlotMarkup(slot) {
  const groups = Array.isArray(slot.split_groups) ? slot.split_groups : [];
  const details = [slot.class_label, slot.section_label, slot.teacher, slot.room]
    .filter(value => value && value !== '—');
  const groupsMarkup = groups.length ? `
    <span class="manual-generated-groups">
      ${groups.map(group => {
        const groupMeta = [group.class_label, group.section_label, group.teacher]
          .filter(value => value && value !== '—')
          .join(' · ');
        return `<span class="manual-generated-group">${escapeHtml(group.course || group.section_id || '课程')}${groupMeta ? ` · ${escapeHtml(groupMeta)}` : ''}</span>`;
      }).join('')}
    </span>` : '';
  const badge = slot.manual_lock_state === 'all'
    ? '<span class="manual-lock-badge" title="已确认为必要条件" aria-label="已锁定">🔒</span>'
    : slot.manual_lock_state === 'partial'
      ? '<span class="manual-generated-badge partial" title="该分流时段中部分课程为必要条件">部分金框</span>'
      : '<span class="manual-generated-badge" title="由 AI 补全的课程">AI 已排</span>';
  return `
    <div class="manual-slot-course manual-generated-course">
      <span class="manual-generated-course-copy">
        <span class="manual-generated-course-name">${escapeHtml(getCourseName(slot) || '课程')}</span>
        ${groupsMarkup}
        ${!groups.length && details.length ? `<span class="manual-generated-course-meta">${escapeHtml(details.join(' · '))}</span>` : ''}
      </span>
      ${badge}
    </div>`;
}

function renderSolvedManualTimetableGrid(timetable) {
  const grid = document.getElementById('manual-timetable-grid');
  if (!grid) return;
  const cells = manualSolvedCellsBySlot(timetable, window._manualPlan?.locks || []);
  const days = ['周一', '周二', '周三', '周四', '周五'];
  let html = '<div class="manual-grid-head">节次</div>'
    + days.map(day => `<div class="manual-grid-head">${day}</div>`).join('');
  for (let period = 1; period <= 10; period++) {
    html += `<div class="manual-grid-period">第 ${period} 节</div>`;
    for (let day = 1; day <= 5; day++) {
      const slotId = manualSlotId(day, period);
      const slot = cells.get(slotId);
      if (!slot) {
        html += '<div class="manual-slot"><span class="manual-slot-placeholder">空堂</span></div>';
        continue;
      }
      const category = timetableCourseCategory(slot);
      const lockClass = slot.manual_lock_state === 'all'
        ? 'is-locked'
        : slot.manual_lock_state === 'partial'
          ? 'is-partially-locked'
          : '';
      html += `<div class="manual-slot manual-generated-slot has-course category-${category} ${lockClass}" data-slot-id="${safeDataAttribute(slotId)}" title="${safeDataAttribute(getCourseName(slot) || '课程')}">
        ${manualGeneratedSlotMarkup(slot)}
      </div>`;
    }
  }
  grid.innerHTML = html;
  renderManualPlanControls();
}

async function loadManualGeneratedTimetable(classId, { force = false } = {}) {
  if (!classId || !shouldShowManualGeneratedTimetable()) return null;
  const cache = window._manualGeneratedTimetables ||= new Map();
  const pending = window._manualGeneratedTimetableRequests ||= new Map();
  if (force) cache.delete(classId);
  if (cache.has(classId)) return cache.get(classId);
  if (pending.has(classId)) return pending.get(classId);
  const request = api(`/timetable/class/${encodeURIComponent(classId)}`)
    .then(timetable => {
      cache.set(classId, timetable);
      if (manualCurrentClassId() === classId && shouldShowManualGeneratedTimetable()) {
        renderSolvedManualTimetableGrid(timetable);
      }
      return timetable;
    })
    .catch(error => {
      if (manualCurrentClassId() === classId) {
        const grid = document.getElementById('manual-timetable-grid');
        if (grid) grid.innerHTML = `<div class="manual-generated-loading">无法读取完整课表：${escapeHtml(error.message)}</div>`;
      }
      return null;
    })
    .finally(() => pending.delete(classId));
  pending.set(classId, request);
  return request;
}

function renderManualTimetableGrid() {
  const grid = document.getElementById('manual-timetable-grid');
  const classId = manualCurrentClassId();
  if (!grid || !classId) return;
  if (shouldShowManualGeneratedTimetable()) {
    const timetable = window._manualGeneratedTimetables?.get(classId);
    if (timetable) {
      renderSolvedManualTimetableGrid(timetable);
    } else {
      grid.innerHTML = '<div class="manual-generated-loading">正在读取 AI 生成的完整课表…</div>';
      void loadManualGeneratedTimetable(classId);
    }
    return;
  }
  const drafts = readManualDrafts();
  const draft = drafts[classId] || {};
  const conflicts = manualConflictMap();
  const currentClass = window._manualClassesById?.get(classId);
  const adminClassIds = currentClass?.class_type === 'teaching'
    ? manualAdminClassIdsForTeachingClass(classId)
    : [];
  const days = ['周一', '周二', '周三', '周四', '周五'];
  let html = '<div class="manual-grid-head">节次</div>' + days.map(day => `<div class="manual-grid-head">${day}</div>`).join('');
  for (let period = 1; period <= 10; period++) {
    html += `<div class="manual-grid-period">第 ${period} 节</div>`;
    for (let day = 1; day <= 5; day++) {
      const slotId = manualSlotId(day, period);
      const item = manualStoredItem(draft[slotId], classId);
      const conflictReasons = [...(conflicts.get(`${classId}:${slotId}`) || [])];
      const adminEntries = adminClassIds.map(adminClassId => ({
        classId: adminClassId,
        classInfo: window._manualClassesById?.get(adminClassId),
        item: manualStoredItem(drafts[adminClassId]?.[slotId], adminClassId),
        conflictReasons: [...(conflicts.get(`${adminClassId}:${slotId}`) || [])],
      }));
      const hasAdminCourse = adminEntries.some(entry => entry.item);
      if (!adminClassIds.length || !hasAdminCourse) {
        const conflictTitle = conflictReasons.length ? `课程冲突：${conflictReasons.join('、')}` : '';
        const locked = item && manualPlacementIsLocked(classId, slotId, item.id);
        html += `<div class="manual-slot manual-drop-target ${item ? `has-course category-${item.category || 'other'}` : ''} ${item?.kind === 'bundle' ? 'has-bundle' : ''} ${conflictReasons.length ? 'has-conflict' : ''} ${locked ? 'is-locked' : ''}" data-slot-id="${slotId}" data-target-class-id="${classId}" data-manual-placement-mode="${adminClassIds.length ? 'teaching-or-admin' : 'class'}" title="${conflictTitle}">
          ${manualCourseSlotMarkup({ item, slotId, targetClassId: classId, conflictReasons })}
        </div>`;
        continue;
      }

      const allAdminCoursesMatch = adminEntries.length > 1
        && adminEntries.every(entry => entry.item?.id === adminEntries[0].item?.id);
      const teachingConflictTitle = conflictReasons.length ? `课程冲突：${conflictReasons.join('、')}` : '';
      const teachingLocked = item && manualPlacementIsLocked(classId, slotId, item.id);
      const teachingMarkup = item ? `
        <div class="manual-teaching-main has-course category-${item.category || 'other'} ${conflictReasons.length ? 'has-conflict' : ''} ${teachingLocked ? 'is-locked' : ''}"
          data-slot-id="${slotId}" title="${teachingConflictTitle}">
          ${manualCourseSlotMarkup({ item, slotId, targetClassId: classId, conflictReasons, label: '教学班' })}
        </div>` : '';
      if (allAdminCoursesMatch) {
        const mergedItem = adminEntries[0].item;
        const mergedConflicts = [...new Set(adminEntries.flatMap(entry => entry.conflictReasons))];
        const mergedConflictTitle = mergedConflicts.length ? `课程冲突：${mergedConflicts.join('、')}` : '';
        const labels = adminEntries.map(entry => entry.classInfo?.name || entry.classId).join('、');
        const mergedLocked = adminEntries.every(entry =>
          manualPlacementIsLocked(entry.classId, slotId, entry.item.id));
        html += `<div class="manual-slot manual-teaching-slot ${item ? `has-course category-${item.category || 'other'}` : ''}" data-slot-id="${slotId}">
          ${teachingMarkup}
          <div class="manual-admin-merged has-course category-${mergedItem.category || 'other'} ${mergedConflicts.length ? 'has-conflict' : ''} ${mergedLocked ? 'is-locked' : ''}" title="${mergedConflictTitle}">
            <span class="manual-slot-lane-label">${labels} · 同上</span>
            <div class="manual-slot-course">
              <span>${manualPoolItemLabel(mergedItem)}</span>
              ${mergedLocked
                ? '<span class="manual-lock-badge" title="已确认为必要条件" aria-label="已锁定">🔒</span>'
                : `<button type="button" class="manual-slot-remove" data-slot-id="${slotId}" data-target-class-ids="${adminEntries.map(entry => entry.classId).join(',')}" aria-label="删除两个行政班课程">×</button>`}
            </div>
            ${mergedConflicts.length ? `<span class="manual-slot-conflict-mark" aria-label="${mergedConflictTitle}" title="${mergedConflictTitle}"></span>` : ''}
          </div>
        </div>`;
        continue;
      }

      const lanes = adminEntries.map(entry => {
        const conflictTitle = entry.conflictReasons.length ? `课程冲突：${entry.conflictReasons.join('、')}` : '';
        const locked = entry.item && manualPlacementIsLocked(entry.classId, slotId, entry.item.id);
        return `<div class="manual-admin-lane manual-drop-target ${entry.item ? `has-course category-${entry.item.category || 'other'}` : ''} ${entry.conflictReasons.length ? 'has-conflict' : ''} ${locked ? 'is-locked' : ''}"
          data-slot-id="${slotId}" data-target-class-id="${entry.classId}" title="${conflictTitle}">
          ${manualCourseSlotMarkup({
            item: entry.item,
            slotId,
            targetClassId: entry.classId,
            conflictReasons: entry.conflictReasons,
            label: entry.classInfo?.name || entry.classId,
            placeholder: '拖入行政班课程',
          })}
        </div>`;
      }).join('');
      html += `<div class="manual-slot manual-teaching-slot ${item ? `has-course category-${item.category || 'other'}` : ''}" data-slot-id="${slotId}">
        ${teachingMarkup}
        <div class="manual-admin-lanes" aria-label="行政班学生去向">${lanes}</div>
      </div>`;
    }
  }
  grid.innerHTML = html;
  if (!manualPlanIsConfirmed()) grid.querySelectorAll('.manual-drop-target').forEach(target => {
    target.addEventListener('dragover', event => { event.preventDefault(); target.classList.add('drag-over'); });
    target.addEventListener('dragleave', () => target.classList.remove('drag-over'));
    target.addEventListener('drop', event => {
      event.preventDefault();
      target.classList.remove('drag-over');
      const itemId = event.dataTransfer.getData('application/x-manual-item')
        || event.dataTransfer.getData('application/x-manual-course');
      const targetClass = window._manualClassesById?.get(target.dataset.targetClassId);
      const item = manualStoredItem(itemId, target.dataset.targetClassId);
      if (target.dataset.manualPlacementMode === 'teaching-or-admin'
        && targetClass?.class_type === 'teaching'
        && item?.placement_scope === 'admin') {
        openManualAdminPlacementDialog(target.dataset.targetClassId, target.dataset.slotId, itemId);
        return;
      }
      saveManualCourseToSlot(target.dataset.slotId, itemId, target.dataset.targetClassId);
    });
  });
  grid.querySelectorAll('.manual-slot-remove').forEach(button => {
    button.addEventListener('click', () => {
      const targetIds = button.dataset.targetClassIds?.split(',') || [button.dataset.targetClassId];
      const drafts = readManualDrafts();
      targetIds.filter(Boolean).forEach(targetId => delete drafts[targetId]?.[button.dataset.slotId]);
      writeManualDrafts(drafts);
      renderManualCoursePool();
      renderManualTimetableGrid();
      renderManualPlanControls();
      queueManualDraftSync();
    });
  });
  renderManualPlanControls();
}

async function loadManualTimetable() {
  const [teachingClasses, adminClasses, courses, teachingAssignments, selectionBlocks, students, manualPlan, status] = await Promise.all([
    api('/teaching_classes'), api('/admin_classes'), api('/courses'), api('/teaching_assignments'), api('/selection_blocks'), api('/students'), api('/manual-plan'), api('/status'),
  ]);
  window._manualCourses = [...courses].sort((a, b) => (a.name || a.id).localeCompare(b.name || b.id, 'zh-CN'));
  window._manualTeachingAssignments = teachingAssignments;
  window._manualStudents = students;
  window._manualSelectionBlocks = selectionBlocks;
  window._manualSections = manualPlan.catalog?.sections || [];
  window._manualPlan = manualPlan;
  window._manualScheduleAvailable = status.solve_status === 'valid';
  window._manualHasSchedule = Number(status.counts?.assignments || 0) > 0;
  window._manualGeneratedTimetables = new Map();
  window._manualGeneratedTimetableRequests = new Map();
  applyScheduleArchiveStatus(status);
  const clearUnlockedButton = document.getElementById('manual-clear-unlocked-schedule');
  if (clearUnlockedButton) clearUnlockedButton.disabled = !window._manualHasSchedule;
  const selector = document.getElementById('manual-class-select');
  const selectableClasses = teachingClasses
    .map(item => ({ ...item, class_type: 'teaching', label: `教学班 · ${item.name}` }))
    .sort((a, b) => a.label.localeCompare(b.label, 'zh-CN'));
  // Administrative classes remain available to the teaching-class grid for
  // its split lanes, but are not scheduling entry points themselves.
  const classes = [
    ...selectableClasses,
    ...adminClasses.map(item => ({ ...item, class_type: 'admin', label: `行政班 · ${item.name}` })),
  ];
  window._manualClassesById = new Map(classes.map(item => [item.id, item]));
  const hydratedFromBackend = hydrateManualDrafts(manualPlan);
  const previous = selector.value;
  selector.innerHTML = selectableClasses.map(item => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.label)}</option>`).join('');
  if (selectableClasses.some(item => item.id === previous)) selector.value = previous;
  const refreshManualPoolItems = () => {
    // Course category depends on the currently selected class (for example,
    // a required course can be administrative in one grade and teaching in another).
    // Grade scope is also respected here so a class only sees courses that
    // its students can actually take, including valid cross-grade courses.
    window._manualPoolItems = manualItemsForClass(manualCurrentClassId());
  };
  refreshManualPoolItems();
  selector.onchange = () => {
    refreshManualPoolItems();
    renderManualCoursePool();
    renderManualTimetableGrid();
  };
  document.getElementById('manual-course-search').oninput = renderManualCoursePool;
  document.getElementById('manual-clear-class').onclick = () => {
    const classId = manualCurrentClassId();
    if (!classId || !confirm('清空当前班级的排课草稿吗？')) return;
    const drafts = readManualDrafts();
    delete drafts[classId];
    writeManualDrafts(drafts);
    renderManualTimetableGrid();
    renderManualPlanControls();
    queueManualDraftSync();
  };
  document.getElementById('manual-confirm-plan').onclick = async () => {
    try {
      const placements = manualPlacementsFromDrafts();
      if (!placements.length) return showToast('请先拖入至少一门课程', 'error');
      const conflictCount = manualConflictMap().size;
      if (conflictCount) {
        return showToast(`当前草稿还有 ${conflictCount} 个冲突格，请先处理红色叉号`, 'error');
      }
      if (!confirm(`将 ${placements.length} 个手动课程格确认为不可自动破坏的必要条件吗？确认后会显示金色锁框。`)) return;
      renderManualPlanControls('正在校验课程、教师、学生和 section 映射…');
      const plan = await api('/manual-plan/confirm', {
        method: 'POST',
        body: JSON.stringify({ placements, confirmed_by: '教务用户' }),
      });
      window._manualPlan = plan;
      // Confirming a new set of necessary conditions marks an older solved
      // timetable stale on the server, so it must not be saved as the result
      // of this new plan before AI completion runs again.
      window._manualScheduleAvailable = false;
      window._manualGeneratedTimetables = new Map();
      window._manualGeneratedTimetableRequests = new Map();
      applyScheduleArchiveStatus({ solve_status: 'stale', review_required: false });
      hydrateManualDrafts(plan);
      renderManualCoursePool();
      renderManualTimetableGrid();
      renderManualPlanControls();
      showToast(`已锁定 ${plan.counts?.section_locks || plan.locks?.length || 0} 个 section 必要条件`);
    } catch {
      renderManualPlanControls();
    }
  };
  document.getElementById('manual-unlock-plan').onclick = async () => {
    if (!confirm('解除全部手动必要条件吗？解除后金框课程可以再次拖动，下一次排课也不再强制保留这些时段。')) return;
    const plan = await api('/manual-plan/unlock', { method: 'POST', body: '{}' });
    window._manualPlan = plan;
    renderManualCoursePool();
    renderManualTimetableGrid();
    renderManualPlanControls();
    showToast('必要条件已解除，可以继续修改草稿');
  };
  const runManualAiSolve = async ({ optimize = false } = {}) => {
    const button = document.getElementById(optimize ? 'manual-ai-optimize' : 'manual-ai-solve');
    const startedAt = Date.now();
    window._manualAiRunning = true;
    renderManualPlanControls(optimize
      ? '继续优化：正在以当前有效课表为提示，在不破坏金框和硬约束的前提下降低软约束代价…'
      : '快速生成阶段 1/2：DeepSeek 正在读取锁定课程和规则，生成安全的搜索优先级…');
    const timer = setInterval(() => {
      const seconds = Math.round((Date.now() - startedAt) / 1000);
      const stage = optimize
        ? '继续优化：独立求解进程正在保留当前可行课表并寻找更好排法'
        : seconds < 45
        ? 'AI 排课阶段 1/2：DeepSeek 正在分析约束和课程优先级'
        : '快速生成阶段 2/2：已保留可行初稿，正在用剩余预算进行全局择优';
      renderManualPlanControls(`${stage}（已用 ${seconds} 秒）…`);
    }, 1000);
    try {
      const result = await solveWithRequiredApproval({
        use_ai_strategy: true,
        feasible_first: true,
        solver_strategy: optimize ? 'exact' : 'resilient_optimize',
        candidate_count: 2,
        max_time_seconds: 120,
        instruction: optimize
          ? '保留全部手动必要条件和现有可行解；只在硬约束始终成立时改善课程分布与教师负担。'
          : '保留全部手动必要条件；先快速构造完整可行课表，再优先处理跨年级教师和高约束课程。',
      }, '/manual-plan/ai-solve');
      const duration = ((result.solve_duration_ms || 0) / 1000).toFixed(1);
      if (!result.solved) {
        renderManualPlanControls(`${optimize ? '继续优化' : '快速生成'}未找到可行解：${result.reason || result.status}（求解 ${duration} 秒）。金框课程和原有效课表没有被破坏。`);
        return;
      }
      window._manualPlan.last_solve = {
        solve_duration_ms: result.solve_duration_ms,
        status: result.status,
      };
      window._manualScheduleAvailable = true;
      window._manualHasSchedule = true;
      window._manualGeneratedTimetables = new Map();
      window._manualGeneratedTimetableRequests = new Map();
      const clearUnlockedButton = document.getElementById('manual-clear-unlocked-schedule');
      if (clearUnlockedButton) clearUnlockedButton.disabled = false;
      applyScheduleArchiveStatus({
        solve_status: 'valid',
        review_required: result.publication_status === 'review_required',
      });
      await loadManualGeneratedTimetable(manualCurrentClassId(), { force: true });
      const warning = result.ai_warnings?.length ? `；${result.ai_warnings.join('；')}` : '';
      const incompleteChoices = result.incomplete_required_choices || [];
      const selectionWarning = incompleteChoices.length
        ? `；${new Set(incompleteChoices.map(item => item.student_id)).size} 名学生尚未完成选课，已暂不分配对应选修课`
        : '';
      const reviewCount = result.review_items?.length || 0;
      const gapDays = result.quality_gate?.metrics?.ap_student_gap_days || 0;
      const firstPeriodGapDays = result.quality_gate?.metrics?.ap_first_period_gap_days || 0;
      const morningEmptyPeriods = result.quality_gate?.metrics?.ap_morning_empty_student_periods || 0;
      const blockPreferredTermCount = result.ap_block_preferred_band_term_count
        ?? result.ap_block_morning_term_count
        ?? 0;
      const blockOutsidePreferredCount = result.ap_block_outside_preferred_band_occurrences
        ?? result.ap_block_afternoon_occurrences
        ?? 0;
      const blockFirstPeriodTarget = result.ap_block_first_period_target_count || 0;
      const blockFirstPeriodActual = result.ap_block_first_period_actual_count || 0;
      const blockFirstPeriodDeviation = result.ap_block_first_period_deviation || 0;
      const blockMorningSummary = blockPreferredTermCount
        ? `；AP Block 第一节 ${blockFirstPeriodActual}/${blockFirstPeriodTarget} 次（偏差 ${blockFirstPeriodDeviation}），第1–6节 ${blockPreferredTermCount - blockOutsidePreferredCount}/${blockPreferredTermCount} 个同步时段`
        : '';
      const qualityWarning = result.quality_gate?.passed === false
        ? `；质量门槛未通过：AP 学生空堂 ${gapDays} 个学生日；上午空节 ${morningEmptyPeriods} 个学生节次，其中第一节空窗 ${firstPeriodGapDays} 个学生日`
        : '';
      const policyWarning = result.policy_relaxed
        ? `；已审批降级 ${result.approved_hard_rule_relaxations?.length || 0} 条硬规则`
        : '';
      const reviewWarning = reviewCount
        ? `；有 ${reviewCount} 项待人工复核`
        : '';
      renderManualPlanControls(`${optimize ? '继续优化' : '快速生成'}完成：保留 ${result.manual_lock_count || 0} 个必要条件，求解用时 ${duration} 秒，课时、锁定、教师和学生冲突校验通过${blockMorningSummary}${reviewWarning}${qualityWarning}${policyWarning}${selectionWarning}${warning}`);
      const hasWarning = result.publication_status === 'review_required'
        || incompleteChoices.length
        || reviewCount;
      showToast(hasWarning
        ? `课表已生成但不可正式发布；${reviewCount || 1} 项问题待人工复核`
        : incompleteChoices.length
          ? `AI 排课完成；${new Set(incompleteChoices.map(item => item.student_id)).size} 名学生待补选课`
          : `AI 排课完成，用时 ${duration} 秒`, hasWarning ? 'warning' : 'success');
      if (confirm(`完整课表已生成，核心硬约束校验通过${hasWarning ? '，但当前状态为“待复核”，不能视为正式发布' : ''}。现在查看总课表吗？`)) {
        await switchView('overview-timetable');
      }
    } catch (error) {
      renderManualPlanControls(`${optimize ? '继续优化' : '快速生成'}失败：${error.message}。金框必要条件和原有效课表仍然保留，可以修正数据后重试。`);
    } finally {
      clearInterval(timer);
      window._manualAiRunning = false;
      button.disabled = !manualPlanIsConfirmed();
    }
  };
  document.getElementById('manual-ai-solve').onclick = () => runManualAiSolve();
  document.getElementById('manual-ai-optimize').onclick = () => runManualAiSolve({ optimize: true });
  renderManualCoursePool();
  renderManualTimetableGrid();
  renderManualPlanControls();
  if (shouldShowManualGeneratedTimetable()) {
    await loadManualGeneratedTimetable(manualCurrentClassId());
  }
  if (!hydratedFromBackend && manualPlacementsFromDrafts().length) queueManualDraftSync();
}

const TEACHER_AVAILABILITY_RULE_SOURCE = 'teacher_availability_paint';
const TEACHER_AVAILABILITY_RULE_PREFIX = 'teacher_unavailability_';
const TEACHER_AVAILABILITY_DAYS = ['周一', '周二', '周三', '周四', '周五'];

function teacherAvailabilityRuleId(teacherId) {
  return `${TEACHER_AVAILABILITY_RULE_PREFIX}${teacherId}`;
}

function slotSort(left, right) {
  const parse = value => {
    const match = /^D(\d+)P(\d+)$/.exec(String(value));
    return match ? [Number(match[1]), Number(match[2])] : [Infinity, Infinity];
  };
  const [leftDay, leftPeriod] = parse(left);
  const [rightDay, rightPeriod] = parse(right);
  return leftDay - rightDay || leftPeriod - rightPeriod || String(left).localeCompare(String(right));
}

function sameSlots(left = new Set(), right = new Set()) {
  return left.size === right.size && [...left].every(slot => right.has(slot));
}

function selectedTeacherAvailabilityId() {
  return document.getElementById('teacher-availability-select')?.value || '';
}

function teacherAvailabilitySlots(teacherId) {
  const state = window._teacherAvailability;
  if (!state || !teacherId) return new Set();
  if (!state.drafts.has(teacherId)) {
    state.drafts.set(teacherId, new Set(state.savedSlotsByTeacher.get(teacherId) || []));
  }
  return state.drafts.get(teacherId);
}

function teacherAvailabilityIsDirty(teacherId) {
  const state = window._teacherAvailability;
  return Boolean(teacherId && state && !sameSlots(
    teacherAvailabilitySlots(teacherId),
    state.savedSlotsByTeacher.get(teacherId) || new Set(),
  ));
}

function renderTeacherAvailabilityGrid() {
  const grid = document.getElementById('teacher-availability-grid');
  if (!grid) return;
  const teacherId = selectedTeacherAvailabilityId();
  const slots = teacherAvailabilitySlots(teacherId);
  let html = '<div class="header-cell">节次</div>';
  for (const day of TEACHER_AVAILABILITY_DAYS) html += `<div class="header-cell">${day}</div>`;
  for (let period = 1; period <= 10; period++) {
    const session = period <= 5 ? '上午' : '下午';
    html += `<div class="time-cell"><div>第${period}节</div><div style="font-size:10px;color:var(--gray-400)">${session}</div></div>`;
    for (let day = 1; day <= 5; day++) {
      const slotId = `D${day}P${period}`;
      const unavailable = slots.has(slotId);
      html += `<button type="button" class="slot-cell ${unavailable ? 'forbidden' : ''}" data-availability-slot="${slotId}" ${teacherId ? '' : 'disabled'} aria-pressed="${unavailable}" title="${teacherId ? `${unavailable ? '取消标记不可上课' : '标记为不可上课'}：${TEACHER_AVAILABILITY_DAYS[day - 1]}第${period}节` : '请先选择教师'}"></button>`;
    }
  }
  grid.innerHTML = html;
  grid.querySelectorAll('[data-availability-slot]').forEach(button => {
    button.addEventListener('click', () => {
      const selectedId = selectedTeacherAvailabilityId();
      if (!selectedId) return showToast('请先选择教师', 'warning');
      const selectedSlots = teacherAvailabilitySlots(selectedId);
      const slotId = button.dataset.availabilitySlot;
      if (selectedSlots.has(slotId)) selectedSlots.delete(slotId);
      else selectedSlots.add(slotId);
      renderTeacherAvailabilityGrid();
      renderTeacherAvailabilityStatus();
    });
  });
}

function renderTeacherAvailabilityStatus() {
  const teacherId = selectedTeacherAvailabilityId();
  const count = document.getElementById('teacher-availability-count');
  const status = document.getElementById('teacher-availability-status');
  const save = document.getElementById('teacher-availability-save');
  const clear = document.getElementById('teacher-availability-clear');
  const state = window._teacherAvailability;
  if (!count || !status || !save || !clear || !state) return;
  if (!teacherId) {
    count.textContent = '尚未选择教师';
    status.className = 'teacher-availability-status';
    status.textContent = '选择教师后，点击课表格子标记不可上课时段。保存后才会写入排课规则。';
    save.disabled = true;
    clear.disabled = true;
    return;
  }
  const teacher = state.teachers.find(item => item.id === teacherId);
  const slots = teacherAvailabilitySlots(teacherId);
  const dirty = teacherAvailabilityIsDirty(teacherId);
  count.textContent = `已标记 ${slots.size} 个时段${dirty ? ' · 尚未保存' : ''}`;
  status.className = `teacher-availability-status${dirty ? ' is-dirty' : ''}`;
  status.textContent = dirty
    ? `${teacher?.name || teacherId} 的禁排时段已修改。保存后会使现有课表与手动必要条件进入待重新校验状态。`
    : slots.size
      ? `${teacher?.name || teacherId} 当前有 ${slots.size} 个已保存的硬性禁排时段；排课引擎不会在这些格子安排其课程。`
      : `${teacher?.name || teacherId} 暂无已保存的禁排时段。`;
  save.disabled = !dirty;
  clear.disabled = slots.size === 0;
}

async function saveTeacherAvailability() {
  const teacherId = selectedTeacherAvailabilityId();
  const state = window._teacherAvailability;
  if (!teacherId || !state) return showToast('请先选择教师', 'warning');
  const teacher = state.teachers.find(item => item.id === teacherId);
  const slots = [...teacherAvailabilitySlots(teacherId)].sort(slotSort);
  const ruleId = teacherAvailabilityRuleId(teacherId);
  const existing = state.rulesByTeacher.get(teacherId);
  if (slots.length) {
    const rule = {
      id: ruleId,
      name: `${teacher?.name || teacherId} 不可上课时段`,
      type: 'forbid_slots',
      scope: 'teacher',
      target_id: teacherId,
      hard: true,
      params: { slots },
      source: TEACHER_AVAILABILITY_RULE_SOURCE,
    };
    await api(existing ? `/constraints/${encodeURIComponent(ruleId)}` : '/constraints', {
      method: existing ? 'PUT' : 'POST',
      body: JSON.stringify(rule),
    });
    state.rulesByTeacher.set(teacherId, rule);
    state.savedSlotsByTeacher.set(teacherId, new Set(slots));
  } else if (existing) {
    await api(`/constraints/${encodeURIComponent(ruleId)}`, { method: 'DELETE' });
    state.rulesByTeacher.delete(teacherId);
    state.savedSlotsByTeacher.delete(teacherId);
  }
  state.drafts.set(teacherId, new Set(slots));
  renderTeacherAvailabilityStatus();
  showToast(slots.length
    ? `已保存 ${teacher?.name || teacherId} 的 ${slots.length} 个禁排时段`
    : `已移除 ${teacher?.name || teacherId} 的禁排规则`);
}

async function loadTeacherAvailability() {
  const [teachers, constraints] = await Promise.all([api('/teachers'), api('/constraints')]);
  const previousTeacherId = selectedTeacherAvailabilityId();
  const managedRules = constraints.filter(rule =>
    rule.source === TEACHER_AVAILABILITY_RULE_SOURCE
      && rule.type === 'forbid_slots'
      && rule.scope === 'teacher'
      && rule.hard === true
      && typeof rule.target_id === 'string');
  const savedSlotsByTeacher = new Map(managedRules.map(rule => [rule.target_id, new Set(rule.params?.slots || [])]));
  const rulesByTeacher = new Map(managedRules.map(rule => [rule.target_id, rule]));
  const priorDrafts = window._teacherAvailability?.drafts || new Map();
  const teacherIds = new Set(teachers.map(teacher => teacher.id));
  const drafts = new Map([...priorDrafts]
    .filter(([teacherId]) => teacherIds.has(teacherId))
    .map(([teacherId, slots]) => [teacherId, new Set(slots)]));
  window._teacherAvailability = { teachers, savedSlotsByTeacher, rulesByTeacher, drafts };

  const selector = document.getElementById('teacher-availability-select');
  selector.innerHTML = '<option value="">选择教师</option>'
    + teachers.map(teacher => `<option value="${escapeHtml(teacher.id)}">${escapeHtml(teacher.name)} (${escapeHtml(teacher.id)})</option>`).join('');
  if (teachers.some(teacher => teacher.id === previousTeacherId)) selector.value = previousTeacherId;
  selector.onchange = () => {
    renderTeacherAvailabilityGrid();
    renderTeacherAvailabilityStatus();
  };
  document.getElementById('teacher-availability-clear').onclick = () => {
    const teacherId = selectedTeacherAvailabilityId();
    if (!teacherId) return showToast('请先选择教师', 'warning');
    const teacher = window._teacherAvailability.teachers.find(item => item.id === teacherId);
    if (!teacherAvailabilitySlots(teacherId).size || !confirm(`清空 ${teacher?.name || teacherId} 的全部禁排时段吗？点击“保存禁排时段”后才会生效。`)) return;
    window._teacherAvailability.drafts.set(teacherId, new Set());
    renderTeacherAvailabilityGrid();
    renderTeacherAvailabilityStatus();
  };
  document.getElementById('teacher-availability-save').onclick = () => saveTeacherAvailability().catch(() => {});
  renderTeacherAvailabilityGrid();
  renderTeacherAvailabilityStatus();
}

let scheduleEditorState = { classes: [], selectedClassId: '' };

function scheduleEditorSelectedClassId() {
  return document.getElementById('schedule-editor-class-select')?.value || '';
}

function updateScheduleEditorSpecialTemplate() {
  const card = document.getElementById('schedule-editor-special-template');
  const title = document.getElementById('schedule-editor-event-title')?.value.trim();
  const duration = Number(document.getElementById('schedule-editor-event-duration')?.value || 1);
  if (!card) return;
  const label = card.querySelector('span');
  if (label) label.textContent = title
    ? `${title} · 连续 ${Number.isInteger(duration) && duration > 0 ? duration : 1} 节`
    : '填写名称后拖入起始空格';
}

async function renderScheduleEditorTimetable() {
  const classId = scheduleEditorSelectedClassId();
  const grid = document.getElementById('schedule-editor-grid');
  const status = document.getElementById('schedule-editor-status');
  const teachingClass = scheduleEditorState.classes.find(item => item.id === classId);
  if (!grid || !status || !classId || !teachingClass) return;
  status.textContent = '正在载入可编辑课表…';
  try {
    const data = await api(`/timetable/class/${encodeURIComponent(classId)}`);
    renderDetailedTimetable(
      'schedule-editor-grid',
      data,
      `${teachingClass.name} · 改课表`,
      '拖动单门课程到空格会进行完整硬约束校验；分流格和上下行政班格请保留原位。',
      { editorMode: true, compact: true },
    );
    grid.querySelectorAll('[data-schedule-overlay-id]').forEach(button => {
      button.addEventListener('click', async () => {
        if (!confirm('删除这个自习或特殊事件标注吗？')) return;
        try {
          const result = await api(`/schedule-editor/overlays/${encodeURIComponent(button.dataset.scheduleOverlayId)}`, {
            method: 'DELETE',
          });
          showToast(result.message, 'success');
          await renderScheduleEditorTimetable();
        } catch {
          // api() has already shown the actionable error.
        }
      });
    });
    status.textContent = `当前正在编辑：${teachingClass.name}。已显示 ${data.overlays?.length || 0} 个自习/特殊事件标注。`;
  } catch {
    status.textContent = '课表读取失败，请检查后端状态后重试。';
  }
}

async function loadScheduleEditor() {
  const selector = document.getElementById('schedule-editor-class-select');
  const status = document.getElementById('schedule-editor-status');
  if (!selector || !status) return;
  try {
    const editor = await api('/schedule-editor');
    const classes = (editor.classes || []).sort((left, right) =>
      String(left.name || left.id).localeCompare(String(right.name || right.id), 'zh-CN'));
    scheduleEditorState = {
      classes,
      selectedClassId: classes.some(item => item.id === scheduleEditorState.selectedClassId)
        ? scheduleEditorState.selectedClassId
        : classes[0]?.id || '',
    };
    selector.innerHTML = classes.map(item =>
      `<option value="${escapeHtml(item.id)}">${escapeHtml(item.name || item.id)}</option>`).join('')
      || '<option value="">暂无教学班</option>';
    selector.value = scheduleEditorState.selectedClassId;
    selector.onchange = () => {
      scheduleEditorState.selectedClassId = selector.value;
      renderScheduleEditorTimetable();
    };
    document.getElementById('schedule-editor-event-title').oninput = updateScheduleEditorSpecialTemplate;
    document.getElementById('schedule-editor-event-duration').oninput = updateScheduleEditorSpecialTemplate;
    updateScheduleEditorSpecialTemplate();
    if (!editor.available) {
      status.textContent = '当前没有可编辑的有效课表。请先完成 AI 排课并通过校验。';
      document.getElementById('schedule-editor-grid').innerHTML = '<div class="empty-state"><p>尚无有效课表</p></div>';
      return;
    }
    await renderScheduleEditorTimetable();
  } catch {
    status.textContent = '无法读取改课表数据。';
  }
}

async function addScheduleEditorOverlay(template, startSlotId) {
  const classId = scheduleEditorSelectedClassId();
  if (!classId) return showToast('请先选择教学班', 'warning');
  const result = await api('/schedule-editor/overlays', {
    method: 'POST',
    body: JSON.stringify({ class_id: classId, start_slot_id: startSlotId, ...template }),
  });
  showToast(result.message, 'success');
  await renderScheduleEditorTimetable();
}

async function clearManualUnlockedSchedule() {
  const button = document.getElementById('manual-clear-unlocked-schedule');
  if (!button || window._manualClearUnlockedRunning === true) return;
  window._manualClearUnlockedRunning = true;
  button.disabled = true;
  renderManualPlanControls('正在核对锁定课时和可清除课时…');
  try {
    const preview = await api('/schedule/clear-unlocked/preview');
    if (!preview.cleared_unlocked_meetings) {
      const message = `当前课表没有未锁定课时；${preview.retained_locked_meetings || 0} 个锁定课时保持不变。`;
      renderManualPlanControls(message);
      showToast(message, 'info');
      return;
    }
    const confirmed = confirm(
      `一键清除当前课表中的未锁定课程吗？\n\n`
      + `将保留 ${preview.retained_locked_meetings} 个已锁定课时（金框必要条件和其他课表锁）。\n`
      + `将清除 ${preview.cleared_unlocked_meetings} 个未锁定课时。\n\n`
      + '课程、教师、学生、分班和选课数据不会改变；清除后可以重新运行 AI 补全。',
    );
    if (!confirmed) {
      renderManualPlanControls('已取消清除；当前课表没有变化。');
      return;
    }
    const result = await api('/schedule/clear-unlocked', {
      method: 'POST',
      body: JSON.stringify({
        expected_revision: preview.revision,
        confirmed_by: '教务用户',
      }),
    });
    window._manualScheduleAvailable = false;
    window._manualGeneratedTimetables = new Map();
    window._manualGeneratedTimetableRequests = new Map();
    await loadManualTimetable();
    renderManualPlanControls(result.message);
    showToast(result.message, 'success');
  } catch (error) {
    renderManualPlanControls(`清除失败：${error.message}`);
    showToast(`清除失败：${error.message}`, 'error');
  } finally {
    window._manualClearUnlockedRunning = false;
    button.disabled = window._manualHasSchedule === false;
  }
}

function formatArchiveDateTime(value) {
  if (!value || Number.isNaN(new Date(value).getTime())) return '未知时间';
  return new Intl.DateTimeFormat('zh-CN', {
    dateStyle: 'medium', timeStyle: 'medium', hour12: false,
  }).format(new Date(value));
}

function setScheduleArchiveStatus(message, tone = '') {
  for (const [id, baseClass] of [
    ['overview-archive-status', 'overview-archive-status'],
    ['manual-archive-status', 'manual-archive-status'],
  ]) {
    const status = document.getElementById(id);
    if (!status) continue;
    status.textContent = message;
    status.className = `${baseClass}${tone ? ` ${tone}` : ''}`;
  }
}

function syncScheduleArchiveControls() {
  for (const id of ['overview-save-schedule', 'manual-save-schedule']) {
    const button = document.getElementById(id);
    if (!button) continue;
    button.disabled = window._scheduleArchiveAvailable !== true
      || window._scheduleArchiveSaving === true;
  }
}

function applyScheduleArchiveStatus(status) {
  window._scheduleArchiveAvailable = status?.solve_status === 'valid';
  syncScheduleArchiveControls();
  if (!window._scheduleArchiveAvailable) {
    setScheduleArchiveStatus('当前没有通过校验的完整课表，完成排课后才能保存。');
  } else if (status.review_required) {
    setScheduleArchiveStatus('当前完整课表需要人工复核；保存时会进入质量例外审批。', 'warning');
  } else {
    setScheduleArchiveStatus('当前完整课表已通过校验，可以保存为独立历史版本。', 'success');
  }
}

async function saveCurrentScheduleArchive() {
  if (window._scheduleArchiveAvailable !== true || window._scheduleArchiveSaving === true) return;
  window._scheduleArchiveSaving = true;
  syncScheduleArchiveControls();
  setScheduleArchiveStatus('正在校验并保存当前完整课表…');
  try {
    const review = await api('/schedule-quality-review');
    let body = {};
    if (review.required) {
      if (!review.allowed) throw new Error(review.blocked_reason || '当前课表不能通过质量例外审批归档');
      const diagnosis = review.quality_gate?.diagnosis;
      const recommendations = (diagnosis?.recommendations || [])
        .filter(item => item.action !== 'approve_quality_exception')
        .map((item, index) => `${index + 1}. ${item.label}：${item.reason}`)
        .join('\n');
      const issues = (review.quality_gate?.issues || []).map(item => item.message).join('\n');
      const bounds = review.lower_bound_analysis;
      const boundSummary = bounds
        ? `\n\n已记录的单目标质量极限分析：\n- AP 空堂日：${qualityMetricSummary(bounds.ap_student_gap_days)}\n- 上午空节：${qualityMetricSummary(bounds.ap_morning_empty_student_periods)}\n- 分析范围：${bounds.analysis_scope?.note || '冻结当前分班，只优化一个指标'}`
        : '\n\n尚未运行单目标质量极限分析；建议先在“系统设置 → 排课策略”运行分析。';
      if (!confirm(`当前课表已通过全部硬约束，但质量门槛未通过：\n${issues}${boundSummary}\n\n建议先进行结构调整：\n${recommendations}\n\n如果学校本学期决定接受当前结果，可继续进入管理员质量例外审批。是否继续？`)) {
        setScheduleArchiveStatus('已取消保存；当前完整课表没有变化。');
        return;
      }
      const reason = prompt('请输入批准质量例外的具体原因（至少 10 个字符，将永久记录在课表存档中）：');
      if (reason === null) {
        setScheduleArchiveStatus('已取消保存；当前完整课表没有变化。');
        return;
      }
      const approvedBy = prompt('请输入审批人姓名或管理员账号：');
      if (approvedBy === null) {
        setScheduleArchiveStatus('已取消保存；当前完整课表没有变化。');
        return;
      }
      const confirmation = prompt(`最后请输入“${review.confirmation_phrase}”完成确认：`);
      if (confirmation === null) {
        setScheduleArchiveStatus('已取消保存；当前完整课表没有变化。');
        return;
      }
      body = {
        quality_exception: {
          reason,
          approved_by: approvedBy,
          confirmation,
        },
      };
    }
    const result = await api('/schedule-archives', {
      method: 'POST',
      body: JSON.stringify(body),
    });
    const savedAt = formatArchiveDateTime(result.archive?.saved_at);
    const exceptionNote = result.archive?.publication_status === 'ready_with_quality_exception'
      ? '，已记录管理员质量例外审批'
      : '';
    setScheduleArchiveStatus(`当前完整课表已于 ${savedAt} 保存为独立快照${exceptionNote}。`, exceptionNote ? 'warning' : 'success');
    showToast(`课表已储存（${savedAt}）${exceptionNote}`, exceptionNote ? 'warning' : 'success');
  } catch (error) {
    setScheduleArchiveStatus(`保存失败：${error.message}`, 'error');
  } finally {
    window._scheduleArchiveSaving = false;
    syncScheduleArchiveControls();
  }
}

async function deleteScheduleArchive(archiveId, button) {
  if (!archiveId || !button || button.disabled) return;
  button.disabled = true;
  try {
    const preview = await api(`/schedule-archives/${encodeURIComponent(archiveId)}/delete-preview`);
    const archive = preview.archive || {};
    const confirmed = confirm(
      `永久删除过往课表“${archive.name || archiveId}”吗？\n\n`
      + `储存时间：${formatArchiveDateTime(archive.saved_at)}\n`
      + '删除后无法恢复，但当前正在使用的课表不会变化。',
    );
    if (!confirmed) return;
    const result = await api(`/schedule-archives/${encodeURIComponent(archiveId)}`, {
      method: 'DELETE',
      body: JSON.stringify({
        expected_revision: preview.revision,
        confirmation: archive.id,
      }),
    });
    if (window._selectedScheduleArchiveId === archiveId) {
      window._selectedScheduleArchiveId = null;
    }
    showToast(result.message, 'success');
    await loadPastTimetables();
  } catch {
    // api() already displays the backend's actionable safety error.
  } finally {
    if (button.isConnected) button.disabled = false;
  }
}

async function loadPastTimetables() {
  const content = document.getElementById('past-timetables-content');
  if (!content) return;
  content.innerHTML = '<div class="loading">正在读取已储存的课表…</div>';
  try {
    const archives = await api('/schedule-archives');
    if (!archives.length) {
      content.innerHTML = '<div class="empty-state"><p>还没有储存过课表。完成 AI 排课后，在“排课表”或“总课表概览”点击“保存为过往课表”即可创建第一份记录。</p></div>';
      return;
    }
    content.innerHTML = `
      <div class="schedule-archive-list">
        ${archives.map(archive => `
          <article class="schedule-archive-card ${archive.id === window._selectedScheduleArchiveId ? 'selected' : ''}">
            <div>
              <h3>${escapeHtml(archive.name || '课表存档')}</h3>
              <p>储存时间：${formatArchiveDateTime(archive.saved_at)}</p>
              <p>${archive.assignments_count || 0} 条学生课时 · ${archive.meetings_count || 0} 个课程时段${archive.solve_duration_ms != null ? ` · 排课用时 ${(archive.solve_duration_ms / 1000).toFixed(1)} 秒` : ''}</p>
              ${archive.quality_exception_approval ? `<p class="validation-result warning">质量例外：${escapeHtml(archive.quality_exception_approval.approved_by)} 于 ${escapeHtml(formatArchiveDateTime(archive.quality_exception_approval.approved_at))} 批准；${escapeHtml(archive.quality_exception_approval.reason)}</p>` : ''}
            </div>
            <div class="schedule-archive-card-actions">
              <button class="btn btn-primary" type="button" data-open-archive="${safeDataAttribute(archive.id)}">查看课表</button>
              <button class="btn btn-danger" type="button" data-delete-archive="${safeDataAttribute(archive.id)}">删除存档</button>
            </div>
          </article>
        `).join('')}
      </div>
      <div id="past-timetable-detail" class="past-timetable-detail"></div>
    `;
    content.querySelectorAll('[data-open-archive]').forEach(button => {
      button.addEventListener('click', () => openPastTimetable(button.dataset.openArchive));
    });
    content.querySelectorAll('[data-delete-archive]').forEach(button => {
      button.addEventListener('click', () => deleteScheduleArchive(button.dataset.deleteArchive, button));
    });
    const selected = archives.find(archive => archive.id === window._selectedScheduleArchiveId);
    if (selected) await openPastTimetable(selected.id);
  } catch (error) {
    content.innerHTML = `<div class="empty-state"><p>加载过往课表失败：${error.message}</p></div>`;
  }
}

async function openPastTimetable(archiveId) {
  const detail = document.getElementById('past-timetable-detail');
  if (!detail) return;
  window._selectedScheduleArchiveId = archiveId;
  detail.innerHTML = '<div class="loading">正在载入保存时的课表…</div>';
  try {
    const archive = await api(`/schedule-archives/${encodeURIComponent(archiveId)}`);
    const classes = archive.classes || [];
    if (!classes.length) throw new Error('这份课表没有可查看的班级');
    const previousClassId = window._selectedArchivedClassId;
    const classId = classes.some(item => item.id === previousClassId) ? previousClassId : classes[0].id;
    detail.innerHTML = `
      <div class="past-timetable-toolbar">
        <div>
          <h3>${archive.name || '课表存档'}</h3>
          <p>储存于 ${formatArchiveDateTime(archive.saved_at)}；显示的是当时固定下来的数据快照。</p>
        </div>
        <label>查看班级
          <select id="past-timetable-class-select" class="select">
            ${classes.map(item => `<option value="${escapeHtml(item.id)}" ${item.id === classId ? 'selected' : ''}>${item.class_type === 'teaching' ? '教学班' : '行政班'} · ${escapeHtml(item.name || item.id)}</option>`).join('')}
          </select>
        </label>
      </div>
      <div id="past-timetable-grid"></div>
    `;
    const selector = document.getElementById('past-timetable-class-select');
    const loadClass = async () => {
      window._selectedArchivedClassId = selector.value;
      const item = classes.find(entry => entry.id === selector.value);
      const data = await api(`/schedule-archives/${encodeURIComponent(archiveId)}/timetable/class/${encodeURIComponent(selector.value)}`);
      renderDetailedTimetable(
        'past-timetable-grid', data,
        `${item?.name || selector.value} 的课表`,
        `保存于 ${formatArchiveDateTime(archive.saved_at)} · ${item?.class_type === 'teaching' ? '教学班' : '行政班'}`,
      );
    };
    selector.onchange = () => { loadClass().catch(() => {}); };
    await loadClass();
    document.querySelectorAll('.schedule-archive-card').forEach(card => {
      card.classList.toggle('selected', card.querySelector('[data-open-archive]')?.dataset.openArchive === archiveId);
    });
  } catch (error) {
    detail.innerHTML = `<div class="empty-state"><p>无法打开这份过往课表：${error.message}</p></div>`;
  }
}

// 加载欢迎页面
async function loadWelcomePage() {
  console.log('加载欢迎页面');

  // 清除旧的定时器
  if (window._dateTimeInterval) {
    clearInterval(window._dateTimeInterval);
    window._dateTimeInterval = null;
  }

  // 立即更新时间
  updateDateTime();

  // 每秒更新时间
  window._dateTimeInterval = setInterval(updateDateTime, 1000);

  try {
    const status = await api('/status');
    renderDashboardStatus(status);
  } catch (_error) {
    renderDashboardStatus(null);
  }
}

function setDashboardText(id, value) {
  const element = document.getElementById(id);
  if (element) element.textContent = value;
}

function renderDashboardStatus(status) {
  const counts = status?.counts || {};
  setDashboardText('dashboard-students', status ? String(counts.students ?? 0) : '—');
  setDashboardText('dashboard-teachers', status ? String(counts.teachers ?? 0) : '—');
  setDashboardText('dashboard-courses', status ? String(counts.courses ?? 0) : '—');
  setDashboardText('dashboard-constraints', status ? String(counts.constraints ?? 0) : '—');
  setDashboardText('dashboard-backend', status?.backend === 'rules-first-v1' ? 'Rules-first CP-SAT' : status?.backend || '未连接');

  const publicationLabels = {
    ready: '可发布',
    review_required: '需人工复核',
    not_ready: '尚未生成',
  };
  setDashboardText('dashboard-publication', status ? (publicationLabels[status.publication_status] || status.publication_status || '未生成') : '后端未连接');
  setDashboardText('dashboard-review', status ? (status.review_required ? '存在待复核项' : '无需复核') : '状态未知');

  const stage = document.getElementById('dashboard-stage');
  if (!stage) return;
  const stageLabels = {
    timetable: '课表已生成',
    needs_resolve: '数据已变更，需重排',
    sections: '分班完成，待排课',
    not_run: '尚未开始排课',
  };
  stage.textContent = status ? (stageLabels[status.last_stage] || status.last_stage || '状态未知') : '后端未连接';
  stage.className = `status-badge ${!status
    ? 'status-badge-danger'
    : status.review_required || status.last_stage === 'needs_resolve'
      ? 'status-badge-warning'
      : status.last_stage === 'timetable'
        ? 'status-badge-success'
        : 'status-badge-neutral'}`;
}

// 更新时间显示（使用浏览器本地时间）
function updateDateTime() {
  const datetimeEl = document.getElementById('current-datetime');

  if (!datetimeEl) {
    console.warn('current-datetime 元素不存在');
    return;
  }

  try {
    const now = new Date();

    // 格式化时间
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    const seconds = String(now.getSeconds()).padStart(2, '0');
    const timeStr = `${hours}:${minutes}:${seconds}`;

    // 格式化日期
    const year = now.getFullYear();
    const month = now.getMonth() + 1;
    const day = now.getDate();
    const weekdays = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];
    const weekday = weekdays[now.getDay()];
    const dateStr = `${year}年${month}月${day}日 ${weekday}`;

    datetimeEl.innerHTML = `
      <div>${timeStr}</div>
      <div class="date">${dateStr}</div>
    `;
  } catch (error) {
    console.error('更新时间失败:', error);
    datetimeEl.textContent = '时间加载失败';
  }
}

// 测试 AI 连接
window.testAIConnection = async function() {
  const resultDiv = document.getElementById('ai-test-result');
  resultDiv.className = 'ai-test-result testing';
  resultDiv.textContent = '🔄 正在测试连接...';

  try {
    const startTime = Date.now();

    const response = await fetch('/api/ai/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: '你好，请回复"连接成功"' })
    });

    const result = await response.json();
    const endTime = Date.now();
    const latency = endTime - startTime;

    if (result.ok) {
      resultDiv.className = 'ai-test-result success';
      // P1-7 fix: textContent 防 LLM 输出 XSS 注入
      resultDiv.textContent = `✅ 连接成功！响应时间: ${latency}ms AI回复: ${result.data.response}`;
    } else {
      resultDiv.className = 'ai-test-result error';
      resultDiv.textContent = `❌ 连接失败: ${result.errors?.[0]?.msg || '未知错误'}`;
    }
  } catch (error) {
    resultDiv.className = 'ai-test-result error';
    resultDiv.textContent = `❌ 连接失败: ${error.message}`;
  }
};

// 加载状态
async function loadStatus() {
  const data = await api('/status');
  const content = document.getElementById('status-content');
  content.innerHTML = `
    <div class="status-grid">
      <div class="status-card">
        <h4>学校</h4>
        <div class="value">${data.school || '未设置'}</div>
      </div>
      <div class="status-card">
        <h4>当前阶段</h4>
        <div class="value">${data.last_stage}</div>
      </div>
      ${Object.entries(data.counts).map(([key, value]) => `
        <div class="status-card">
          <h4>${key}</h4>
          <div class="value">${value}</div>
        </div>
      `).join('')}
    </div>
  `;
}

// 加载教师列表
async function loadTeachers() {
  const [teachers, assignments] = await Promise.all([
    api('/teachers'),
    api('/teaching_assignments')
  ]);

  // 统计每个老师的周课时
  const teacherHours = {};
  assignments.forEach(a => {
    if (a.teacher_id) {
      if (!teacherHours[a.teacher_id]) {
        teacherHours[a.teacher_id] = 0;
      }
      // 计算总课时：每周课时 * 班级数
      const classCount = Array.isArray(a.class_ids) ? a.class_ids.length : 1;
      teacherHours[a.teacher_id] += a.weekly_hours * classCount;
    }
  });

  // 增强教师数据，添加周课时信息
  const enhancedTeachers = teachers.map(t => ({
    ...t,
    weekly_hours: teacherHours[t.id] || 0
  }));

  window._teachersData = enhancedTeachers;
  renderTeachersList(enhancedTeachers);
  initEntitySearch('search-teachers', enhancedTeachers, renderTeachersList, (item, keyword) => {
    return item.id.toLowerCase().includes(keyword) ||
           item.name.toLowerCase().includes(keyword) ||
           item.exam_staff_group_name?.toLowerCase().includes(keyword) ||
           item.invigilation_exemption_reason?.toLowerCase().includes(keyword) ||
           item.can_teach.some(c => c.toLowerCase().includes(keyword));
  });
}

function examStaffGroupOptions(selected = 'ansheng') {
  return `
    <option value="ansheng" ${selected === 'ansheng' ? 'selected' : ''}>安生教师</option>
    <option value="director" ${selected === 'director' ? 'selected' : ''}>主任</option>
    <option value="homeroom" ${selected === 'homeroom' ? 'selected' : ''}>班主任</option>
    <option value="experimental" ${selected === 'experimental' ? 'selected' : ''}>实验教师</option>
  `;
}

function renderTeachersList(data) {
  const content = document.getElementById('teachers-list');
  if (data.length === 0) {
    content.innerHTML = '<div class="empty-state"><p>暂无教师数据</p></div>';
    return;
  }

  // 统计总课时
  const totalHours = data.reduce((sum, t) => sum + t.weekly_hours, 0);

  content.innerHTML = `
    <div style="padding: 8px 0; color: var(--gray-500); font-size: 13px;">
      共 ${data.length} 位教师，周课时总计 ${totalHours} 节
    </div>
    <div class="table-container">
      <table>
        <thead>
          <tr>
            <th>ID</th>
            <th>姓名</th>
            <th>考试分组</th>
            <th>周课时</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          ${data.map(t => `
            <tr>
              <td>${escapeHtml(t.id)}</td>
              <td>${escapeHtml(t.name)}</td>
              <td><span class="status-badge ${t.invigilation_eligible ? 'status-badge-success' : 'status-badge-warning'}">${escapeHtml(t.exam_staff_group_name || '安生教师')}</span>${t.invigilation_exemption_reason ? `<small>${escapeHtml(t.invigilation_exemption_reason)}</small>` : ''}</td>
              <td>${t.weekly_hours} 节</td>
              <td>
                ${entityActionButton('teachers', t.id, 'edit', '编辑', 'btn-primary')}
                ${entityActionButton('teachers', t.id, 'delete', '删除', 'btn-danger')}
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
  wireEntityActions(content);
}

// 加载教室列表
async function loadRooms() {
  const data = await api('/rooms');
  window._roomsData = data;
  renderRoomsList(data);
  initEntitySearch('search-rooms', data, renderRoomsList, (item, keyword) => {
    return item.id.toLowerCase().includes(keyword) ||
           item.name.toLowerCase().includes(keyword) ||
           item.type.toLowerCase().includes(keyword);
  });
}

function renderRoomsList(data) {
  const content = document.getElementById('rooms-list');
  if (data.length === 0) {
    content.innerHTML = '<div class="empty-state"><p>暂无教室数据</p></div>';
    return;
  }
  content.innerHTML = `
    <div class="table-container">
      <table>
        <thead>
          <tr>
            <th>ID</th>
            <th>名称</th>
            <th>类型</th>
            <th>容量</th>
            <th>归属班级</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          ${data.map(r => `
            <tr>
              <td>${escapeHtml(r.id)}</td>
              <td>${escapeHtml(r.name)}</td>
              <td>${escapeHtml(r.type)}</td>
              <td>${escapeHtml(r.capacity)}</td>
              <td>${escapeHtml(r.owner_class_id || '-')}</td>
              <td>
                ${entityActionButton('rooms', r.id, 'edit', '编辑', 'btn-primary')}
                ${entityActionButton('rooms', r.id, 'delete', '删除', 'btn-danger')}
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
  wireEntityActions(content);
}

// 加载课程列表
async function loadCourses() {
  const [data, adminClasses, teachingClasses, teachingAssignments] = await Promise.all([
    api('/courses'),
    api('/admin_classes'),
    api('/teaching_classes'),
    api('/teaching_assignments'),
  ]);
  window._coursesData = data;
  window._adminClassesData = adminClasses;
  window._teachingClassesData = teachingClasses;
  window._teachingAssignmentsData = teachingAssignments;
  const gradeFilter = document.getElementById('filter-course-grade');
  const classFilter = document.getElementById('filter-course-class');
  const searchInput = document.getElementById('search-courses');
  const highTwoClasses = teachingClasses
    .filter(item => Number(item.grade) === 11)
    .sort((left, right) => left.id.localeCompare(right.id));
  classFilter.innerHTML = '<option value="">全部 Senior 2 教学班</option>'
    + highTwoClasses.map(item => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.name)}</option>`).join('');
  gradeFilter.onchange = () => {
    syncCourseClassFilter();
    applyCourseFilters();
  };
  classFilter.onchange = applyCourseFilters;
  searchInput.oninput = applyCourseFilters;
  syncCourseClassFilter();
  applyCourseFilters();
}

function syncCourseClassFilter() {
  const isHighTwo = document.getElementById('filter-course-grade')?.value === '11';
  const wrap = document.getElementById('filter-course-class-wrap');
  const select = document.getElementById('filter-course-class');
  wrap?.classList.toggle('hidden', !isHighTwo);
  if (!isHighTwo && select) select.value = '';
}

function courseAppliesToGrade(course, grade) {
  const grades = Array.isArray(course.grade) ? course.grade : [course.grade];
  return grades.map(Number).includes(Number(grade));
}

function seniorGradeLabel(grade) {
  const number = Number(grade);
  return [10, 11, 12].includes(number) ? `Senior ${number - 9}` : '未设置';
}

function courseGradeLabel(course) {
  const grades = (Array.isArray(course.grade) ? course.grade : [course.grade])
    .map(Number)
    .filter(Number.isFinite)
    .sort((left, right) => left - right);
  return grades.length ? grades.map(seniorGradeLabel).join('、') : '未设置';
}

function courseGradeValues(course = {}) {
  return (Array.isArray(course.grade) ? course.grade : [course.grade])
    .map(Number)
    .filter(grade => [10, 11, 12].includes(grade));
}

function isFixedClassCourse(course = {}) {
  return course.type === 'required' || course.type === 'other';
}

function courseClassTypeLabel(classType) {
  return classType === 'admin' ? '行政班上课' : classType === 'teaching' ? '教学班上课' : '未配置';
}

function classDataById() {
  return new Map([
    ...(window._adminClassesData || []),
    ...(window._teachingClassesData || []),
  ].map(item => [item.id, item]));
}

function courseDeliveryGrades(course = {}) {
  const configured = courseGradeValues(course);
  if (configured.length) return configured;
  const classes = classDataById();
  const fromAssignments = (window._teachingAssignmentsData || [])
    .filter(assignment => assignment.course_id === course.id)
    .flatMap(assignment => (Array.isArray(assignment.class_ids) ? assignment.class_ids : [assignment.class_id]))
    .map(classId => Number(classes.get(classId)?.grade))
    .filter(grade => [10, 11, 12].includes(grade));
  return [...new Set(fromAssignments)].sort((left, right) => left - right);
}

function inferredCourseDeliveryClassType(course, grade) {
  const saved = course.delivery_class_type_by_grade?.[String(grade)];
  if (saved === 'admin' || saved === 'teaching') return saved;
  const classes = classDataById();
  const types = new Set((window._teachingAssignmentsData || [])
    .filter(assignment => assignment.course_id === course.id)
    .filter(assignment => (Array.isArray(assignment.class_ids) ? assignment.class_ids : [assignment.class_id])
      .some(classId => Number(classes.get(classId)?.grade) === Number(grade)))
    .map(assignment => assignment.class_type)
    .filter(classType => classType === 'admin' || classType === 'teaching'));
  return types.size === 1 ? [...types][0] : null;
}

function courseDeliveryLabel(course) {
  if (course.type === 'ap') return 'AP 选课分流';
  if (course.type === 'required_elective') return '必修选修分流';
  const labels = courseDeliveryGrades(course).map(grade => {
    const classType = inferredCourseDeliveryClassType(course, grade);
    return `${seniorGradeLabel(grade)}：${classType ? courseClassTypeLabel(classType) : '混合/未配置'}`;
  });
  return labels.length ? labels.join('<br>') : '未配置';
}

function renderCourseDeliveryOptions(course = { grade: [10, 11, 12], type: 'required' }) {
  const grades = [10, 11, 12];
  const fixedClass = isFixedClassCourse(course);
  return `
    <div class="course-delivery-options ${fixedClass ? '' : 'hidden'}" data-course-delivery-scope>
      ${grades.map(grade => {
        const classType = inferredCourseDeliveryClassType(course, grade) || 'teaching';
        return `
          <label class="course-delivery-option" data-delivery-grade="${grade}">
            <span>${seniorGradeLabel(grade)}</span>
            <select name="delivery_class_type_${grade}">
              <option value="admin" ${classType === 'admin' ? 'selected' : ''}>行政班上课</option>
              <option value="teaching" ${classType === 'teaching' ? 'selected' : ''}>教学班上课</option>
            </select>
          </label>
        `;
      }).join('')}
    </div>
    <div class="form-help" data-course-delivery-help data-fixed-delivery-help>
      保存时会同步该年级的教师分工与班级范围；这会使当前课表失效，需重新排课。
    </div>
    <div class="form-help ${fixedClass ? 'hidden' : ''}" data-selection-delivery-help>
      AP 选修和必修选修按学生选课分流，不能设置为行政班或教学班上课。
    </div>
  `;
}

function courseDeliveryMapFromForm(formData, grades, courseType) {
  if (!['required', 'other'].includes(courseType)) return null;
  return Object.fromEntries(grades.map(grade => [
    grade,
    formData.get(`delivery_class_type_${grade}`) || 'teaching',
  ]));
}

function syncCourseDeliveryEditor(form) {
  const type = form.querySelector('[name="type"]')?.value;
  const fixedClass = type === 'required' || type === 'other';
  const selectedGrades = new Set([...form.querySelectorAll('input[name="grade_scope"]:checked')]
    .map(input => Number(input.value)));
  form.querySelector('[data-course-delivery-scope]')?.classList.toggle('hidden', !fixedClass);
  form.querySelector('[data-fixed-delivery-help]')?.classList.toggle('hidden', !fixedClass);
  form.querySelector('[data-selection-delivery-help]')?.classList.toggle('hidden', fixedClass);
  form.querySelectorAll('[data-delivery-grade]').forEach(row => {
    row.classList.toggle('hidden', !selectedGrades.has(Number(row.dataset.deliveryGrade)) || !fixedClass);
  });
}

function renderCourseGradeOptions(course = { grade: [10, 11, 12] }) {
  const selected = new Set(courseGradeValues(course));
  return `
    <div class="grade-range-options" role="group" aria-label="课程适用年级">
      ${[
        [10, 'Senior 1'],
        [11, 'Senior 2'],
        [12, 'Senior 3'],
      ].map(([grade, label]) => `
        <label class="grade-range-option">
          <input type="checkbox" name="grade_scope" value="${grade}" ${selected.has(grade) ? 'checked' : ''}>
          <span>${label}</span>
        </label>
      `).join('')}
    </div>
    <div class="form-help">勾选多个年级表示允许跨年级选课和混班；保存后旧课表会失效，需要重新排课。</div>
  `;
}

function highTwoTeachingClasses() {
  return (window._teachingClassesData || [])
    .filter(item => Number(item.grade) === 11)
    .sort((left, right) => left.id.localeCompare(right.id));
}

function effectiveCourseClassIds(course = {}) {
  if (Array.isArray(course.applicable_class_ids)) return course.applicable_class_ids;
  const highTwoClassIds = new Set(highTwoTeachingClasses().map(item => item.id));
  const assigned = (window._teachingAssignmentsData || [])
    .filter(item => item.course_id === course.id && item.class_type === 'teaching')
    .flatMap(item => Array.isArray(item.class_ids) ? item.class_ids : item.class_id ? [item.class_id] : [])
    .filter(classId => highTwoClassIds.has(classId));
  return assigned.length ? [...new Set(assigned)] : [...highTwoClassIds];
}

function courseAppliesToClass(course, classId) {
  return !classId || effectiveCourseClassIds(course).includes(classId);
}

function courseClassLabel(course) {
  const selected = new Set(effectiveCourseClassIds(course));
  const classes = highTwoTeachingClasses().filter(item => selected.has(item.id));
  return classes.length ? classes.map(item => item.name).join('、') : '未设置';
}

function renderCourseClassOptions(course = {}) {
  const isExistingCourse = Boolean(course.id) || Array.isArray(course.applicable_class_ids);
  const selected = new Set(isExistingCourse
    ? effectiveCourseClassIds(course)
    : highTwoTeachingClasses().map(item => item.id));
  return `
    <div class="class-range-options" role="group" aria-label="Senior 2 适用教学班">
      ${highTwoTeachingClasses().map(item => `
        <label class="class-range-option">
          <input type="checkbox" name="class_scope" value="${item.id}" ${selected.has(item.id) ? 'checked' : ''}>
          <span>${item.name}</span>
        </label>
      `).join('')}
    </div>
    <div class="form-help">仅用于 Senior 2 分层必修课；未被勾选的教学班不会生成该课程的排课任务。</div>
  `;
}

function syncCourseClassEditor(form) {
  const highTwoSelected = [...form.querySelectorAll('input[name="grade_scope"]:checked')]
    .some(input => Number(input.value) === 11);
  const highTwoDelivery = form.querySelector('[name="delivery_class_type_11"]')?.value;
  const fixedClass = ['required', 'other'].includes(form.querySelector('[name="type"]')?.value);
  form.querySelector('[data-high-two-class-scope]')?.classList.toggle(
    'hidden',
    !fixedClass || !highTwoSelected || highTwoDelivery !== 'teaching',
  );
}

function courseTypeLabel(type) {
  return ({ required: '必修', ap: 'AP选修', required_elective: '必修选修', other: '活动/其他' })[type] || type || '-';
}

function applyCourseFilters() {
  const allCourses = window._coursesData || [];
  const grade = document.getElementById('filter-course-grade')?.value || '';
  const classId = grade === '11' ? document.getElementById('filter-course-class')?.value || '' : '';
  const keyword = document.getElementById('search-courses')?.value.toLowerCase().trim() || '';
  const filtered = allCourses.filter(course => {
    const gradeMatch = !grade || courseAppliesToGrade(course, grade);
    const classMatch = courseAppliesToClass(course, classId);
    const keywordMatch = !keyword
      || course.id.toLowerCase().includes(keyword)
      || course.name.toLowerCase().includes(keyword)
      || course.type.toLowerCase().includes(keyword)
      || courseGradeLabel(course).includes(keyword)
      || (grade === '11' && courseClassLabel(course).toLowerCase().includes(keyword));
    return gradeMatch && classMatch && keywordMatch;
  });
  renderCoursesList(filtered, { grade, classId, total: allCourses.length });
}

function renderCoursesList(data, { grade = '', classId = '', total = data.length } = {}) {
  const content = document.getElementById('courses-list');
  if (data.length === 0) {
    content.innerHTML = `<div class="empty-state"><p>${grade ? `${seniorGradeLabel(grade)} 暂无匹配课程` : '暂无课程数据'}</p></div>`;
    return;
  }
  content.innerHTML = `
    <div class="table-container">
      <div style="padding: 8px 0; color: var(--gray-500); font-size: 13px;">
        ${grade ? `${seniorGradeLabel(grade)} 课程` : '全部课程'}：显示 ${data.length}/${total} 门
      </div>
      <table>
        <thead>
          <tr>
            <th>ID</th>
            <th>名称</th>
            <th>适用年级</th>
            ${grade === '11' ? '<th>适用班级</th>' : ''}
            <th>类型</th>
            <th>上课班型</th>
            <th>周课时</th>
            <th>教室类型</th>
            <th>优先上午</th>
            <th>连堂</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          ${data.map(c => `
            <tr>
              <td>${escapeHtml(c.id)}</td>
              <td>${escapeHtml(c.name)}</td>
              <td>${escapeHtml(courseGradeLabel(c))}</td>
              ${grade === '11' ? `<td>${escapeHtml(courseClassLabel(c))}</td>` : ''}
              <td>${escapeHtml(courseTypeLabel(c.type))}</td>
              <td>${escapeHtml(courseDeliveryLabel(c))}</td>
              <td>${c.weekly_hours}</td>
              <td>${escapeHtml(c.required_room_type || '-')}</td>
              <td>${c.prefer_morning ? '是' : '-'}</td>
              <td>${c.consecutive ? `${c.consecutive.min}-${c.consecutive.max}` : '-'}</td>
              <td>
                ${entityActionButton('courses', c.id, 'edit', '编辑', 'btn-primary')}
                ${entityActionButton('courses', c.id, 'delete', '删除', 'btn-danger')}
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
  wireEntityActions(content);
}

// 加载学生列表
async function loadStudents() {
  const [students, courses, adminClasses, teachingClasses] = await Promise.all([
    api('/students'),
    api('/courses'),
    api('/admin_classes'),
    api('/teaching_classes')
  ]);

  // 增强学生数据，添加选课信息
  const enhancedStudents = students.map(s => {
    // AP选修课（从学生自己的 ap_courses 字段获取）
    const apCourses = (s.ap_courses || []).map(cid => {
      const course = courses.find(c => c.id === cid);
      return { id: cid, name: course?.name || cid };
    });

    // 必修选修课选择（从学生自己的 elective_choices 字段获取）
    const electiveChoices = s.elective_choices ? {
      group_a: s.elective_choices.group_a ? (() => {
        const course = courses.find(c => c.id === s.elective_choices.group_a);
        return { id: s.elective_choices.group_a, name: course?.name || s.elective_choices.group_a };
      })() : null,
      group_b: s.elective_choices.group_b ? (() => {
        const course = courses.find(c => c.id === s.elective_choices.group_b);
        return { id: s.elective_choices.group_b, name: course?.name || s.elective_choices.group_b };
      })() : null,
      group_c: s.elective_choices.group_c ? (() => {
        const course = courses.find(c => c.id === s.elective_choices.group_c);
        return { id: s.elective_choices.group_c, name: course?.name || s.elective_choices.group_c };
      })() : null
    } : null;

    return {
      ...s,
      ap_selections: apCourses,
      elective_choices_data: electiveChoices
    };
  });

  window._studentsData = enhancedStudents;
  window._adminClasses = adminClasses;
  window._teachingClasses = teachingClasses;

  // 更新学生总数
  document.getElementById('students-total').textContent = enhancedStudents.length;

  // 清空列表，显示提示
  const content = document.getElementById('students-list');
  content.innerHTML = '';

  // 初始化筛选
  initStudentFilters(enhancedStudents, adminClasses, teachingClasses);
}

function initStudentFilters(data, adminClasses, teachingClasses) {
  const gradeFilter = document.getElementById('filter-student-grade');
  const classFilter = document.getElementById('filter-student-class');
  const searchInput = document.getElementById('search-students');

  // 年级变化时更新班级选项
  gradeFilter.onchange = () => {
    const grade = gradeFilter.value;

    // 更新班级下拉框
    let classOptions = '<option value="">全部班级</option>';

    if (grade) {
      // 筛选该年级的行政班
      const gradeAdminClasses = adminClasses.filter(c => c.grade === parseInt(grade));
      const gradeTeachingClasses = teachingClasses.filter(c => c.grade === parseInt(grade));

      if (gradeAdminClasses.length > 0) {
        classOptions += '<optgroup label="行政班">';
        classOptions += gradeAdminClasses.map(c => `<option value="admin_${c.id}">${c.name}</option>`).join('');
        classOptions += '</optgroup>';
      }

      if (gradeTeachingClasses.length > 0) {
        classOptions += '<optgroup label="教学班">';
        classOptions += gradeTeachingClasses.map(c => `<option value="teaching_${c.id}">${c.name}</option>`).join('');
        classOptions += '</optgroup>';
      }
    } else {
      // 显示所有班级
      classOptions += '<optgroup label="行政班">';
      classOptions += adminClasses.map(c => `<option value="admin_${c.id}">${c.name}</option>`).join('');
      classOptions += '</optgroup>';
      classOptions += '<optgroup label="教学班">';
      classOptions += teachingClasses.map(c => `<option value="teaching_${c.id}">${c.name}</option>`).join('');
      classOptions += '</optgroup>';
    }

    classFilter.innerHTML = classOptions;

    // 触发筛选
    applyStudentFilters(data);
  };

  // 班级变化时触发筛选
  classFilter.onchange = () => applyStudentFilters(data);

  // 搜索框输入时触发筛选
  searchInput.oninput = () => applyStudentFilters(data);
}

function applyStudentFilters(data) {
  const gradeFilter = document.getElementById('filter-student-grade').value;
  const classFilter = document.getElementById('filter-student-class').value;
  const keyword = document.getElementById('search-students').value.toLowerCase().trim();
  const hint = document.getElementById('students-hint');

  let filtered = [...data];

  // 按年级筛选
  if (gradeFilter) {
    filtered = filtered.filter(s => s.grade === parseInt(gradeFilter));
  }

  // 按班级筛选
  if (classFilter) {
    // 格式: admin_AC_G1_1 或 teaching_TC_G1_1
    const isAdmin = classFilter.startsWith('admin_');
    const isTeaching = classFilter.startsWith('teaching_');

    if (isAdmin) {
      const classId = classFilter.substring(6); // 移除 "admin_" 前缀
      filtered = filtered.filter(s => s.admin_class_id === classId);
    } else if (isTeaching) {
      const classId = classFilter.substring(9); // 移除 "teaching_" 前缀
      filtered = filtered.filter(s => s.teaching_class_id === classId);
    }
  }

  // 按关键词搜索
  if (keyword) {
    filtered = filtered.filter(s => {
      // 搜索基本信息
      const matchBasic = s.id.toLowerCase().includes(keyword) ||
                         s.name.toLowerCase().includes(keyword) ||
                         (s.english_name || '').toLowerCase().includes(keyword) ||
                         (s.pinyin_name || '').toLowerCase().includes(keyword) ||
                         s.admin_class_id.toLowerCase().includes(keyword) ||
                         s.teaching_class_id.toLowerCase().includes(keyword);

      // 搜索AP选修课
      const matchAP = s.ap_selections.some(ap =>
        ap.name.toLowerCase().includes(keyword) || ap.id.toLowerCase().includes(keyword)
      );

      // 搜索必修选修课
      const matchElective = s.elective_choices_data && (
        (s.elective_choices_data.group_a && s.elective_choices_data.group_a.name.toLowerCase().includes(keyword)) ||
        (s.elective_choices_data.group_b && s.elective_choices_data.group_b.name.toLowerCase().includes(keyword)) ||
        (s.elective_choices_data.group_c && s.elective_choices_data.group_c.name.toLowerCase().includes(keyword))
      );

      return matchBasic || matchAP || matchElective;
    });
  }

  // 判断是否有筛选条件
  const hasFilter = gradeFilter || classFilter || keyword;

  if (hasFilter) {
    hint.style.display = 'none';
    renderStudentsList(filtered, true);
  } else {
    hint.style.display = 'block';
    document.getElementById('students-list').innerHTML = '';
  }
}

function renderStudentsList(data, hasFilter = false) {
  const content = document.getElementById('students-list');

  if (data.length === 0) {
    content.innerHTML = '<div class="empty-state"><p>未找到匹配的学生</p></div>';
    return;
  }

  // 如果没有筛选条件，不显示列表
  if (!hasFilter) {
    content.innerHTML = '';
    return;
  }

  // 统计选修课情况
  const apStats = {};
  data.forEach(s => {
    s.ap_selections.forEach(ap => {
      apStats[ap.name] = (apStats[ap.name] || 0) + 1;
    });
  });

  content.innerHTML = `
    <div class="table-container">
      <div style="padding: 8px 0; color: var(--gray-500); font-size: 13px; display: flex; justify-content: space-between; align-items: center;">
        <span>找到 ${data.length} 名学生</span>
        ${Object.keys(apStats).length > 0 ? `
          <span style="font-size: 12px;">
            选课统计：
            ${Object.entries(apStats).map(([name, count]) => `<strong>${escapeHtml(name)}</strong>(${count})`).join(' ')}
          </span>
        ` : ''}
      </div>
      <table>
        <thead>
          <tr>
            <th>ID</th>
            <th>中文姓名</th>
            <th>英文名</th>
            <th>年级</th>
            <th>行政班</th>
            <th>教学班</th>
            <th>AP选修课</th>
            <th>${data.length > 0 && data[0].grade === 11 ? '英语选修课' : '必修选修课'}</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          ${data.map(s => `
            <tr>
              <td>${escapeHtml(s.id)}</td>
              <td>${escapeHtml(s.name)}</td>
              <td>${escapeHtml(s.english_name || '-')}</td>
              <td>${s.grade}</td>
              <td>${escapeHtml(s.admin_class_id)}</td>
              <td>${escapeHtml(s.teaching_class_id)}</td>
              <td>
                ${s.ap_selections.length > 0
                  ? `<div class="ap-tags">${s.ap_selections.map(ap => `<span class="ap-tag">${escapeHtml(ap.name)}</span>`).join('')}</div>`
                  : '<span style="color: var(--gray-400);">无</span>'
                }
              </td>
              <td>
                ${s.grade === 11
                  ? (s.courses?.includes('HONOR_LC') || s.courses?.includes('TOEFL') || s.courses?.includes('AP_LC')
                    ? `<div class="ap-tags">
                        ${s.courses?.includes('HONOR_LC') ? '<span class="ap-tag" style="background: #e3f2fd; color: #1565c0;">Honor LC</span>' : ''}
                        ${s.courses?.includes('TOEFL') ? '<span class="ap-tag" style="background: #f3e5f5; color: #7b1fa2;">TOEFL</span>' : ''}
                        ${s.courses?.includes('AP_LC') ? '<span class="ap-tag" style="background: #e8f5e9; color: #2e7d32;">AP LC</span>' : ''}
                      </div>`
                    : '<span style="color: var(--gray-400);">无</span>')
                  : (s.elective_choices_data
                    ? `<div class="ap-tags">
                        ${s.elective_choices_data.group_a ? `<span class="ap-tag" style="background: #e3f2fd; color: #1565c0;">A:${escapeHtml(s.elective_choices_data.group_a.name)}</span>` : ''}
                        ${s.elective_choices_data.group_b ? `<span class="ap-tag" style="background: #f3e5f5; color: #7b1fa2;">B:${escapeHtml(s.elective_choices_data.group_b.name)}</span>` : ''}
                        ${s.elective_choices_data.group_c ? `<span class="ap-tag" style="background: #e8f5e9; color: #2e7d32;">C:${escapeHtml(s.elective_choices_data.group_c.name)}</span>` : ''}
                      </div>`
                    : '<span style="color: var(--gray-400);">无</span>')
                }
              </td>
              <td>
                ${entityActionButton('students', s.id, 'edit', '编辑', 'btn-primary')}
                ${entityActionButton('students', s.id, 'delete', '删除', 'btn-danger')}
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
  wireEntityActions(content);
}

// 加载班级列表
async function loadClasses() {
  const [adminClasses, teachingClasses] = await Promise.all([
    api('/admin_classes'),
    api('/teaching_classes'),
  ]);

  const allClasses = [
    ...adminClasses.map(c => ({ ...c, classType: 'admin' })),
    ...teachingClasses.map(c => ({ ...c, classType: 'teaching' }))
  ];
  window._classesData = allClasses;

  renderClassesList(adminClasses, teachingClasses);

  initEntitySearch('search-classes', allClasses, (filtered) => {
    const filteredAdmin = filtered.filter(c => c.classType === 'admin');
    const filteredTeaching = filtered.filter(c => c.classType === 'teaching');
    renderClassesList(filteredAdmin, filteredTeaching);
  }, (item, keyword) => {
    return item.id.toLowerCase().includes(keyword) ||
           item.name.toLowerCase().includes(keyword) ||
           item.grade.toString().includes(keyword);
  });
}

function renderClassesList(adminClasses, teachingClasses) {
  const content = document.getElementById('classes-list');
  content.innerHTML = `
    <h3>行政班</h3>
    ${adminClasses.length === 0 ? '<div class="empty-state"><p>暂无行政班</p></div>' : `
      <div class="table-container">
        <table>
          <thead>
            <tr>
              <th>ID</th>
              <th>名称</th>
              <th>年级</th>
              <th>固定教室</th>
              <th>学生数</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            ${adminClasses.map(c => `
              <tr>
                <td>${escapeHtml(c.id)}</td>
                <td>${escapeHtml(c.name)}</td>
                <td>${c.grade}</td>
                <td>${escapeHtml(c.fixed_room_id || '-')}</td>
                <td>${c.student_ids?.length || 0}</td>
                <td>
                  ${entityActionButton('admin_classes', c.id, 'edit', '编辑', 'btn-primary')}
                  ${entityActionButton('admin_classes', c.id, 'delete', '删除', 'btn-danger')}
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `}
    <h3 style="margin-top: 24px;">教学班</h3>
    ${teachingClasses.length === 0 ? '<div class="empty-state"><p>暂无教学班</p></div>' : `
      <div class="table-container">
        <table>
          <thead>
            <tr>
              <th>ID</th>
              <th>名称</th>
              <th>年级</th>
              <th>固定教室</th>
              <th>学生数</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            ${teachingClasses.map(c => `
              <tr>
                <td>${escapeHtml(c.id)}</td>
                <td>${escapeHtml(c.name)}</td>
                <td>${c.grade}</td>
                <td>${escapeHtml(c.fixed_room_id || '-')}</td>
                <td>${c.student_ids?.length || 0}</td>
                <td>
                  ${entityActionButton('teaching_classes', c.id, 'edit', '编辑', 'btn-primary')}
                  ${entityActionButton('teaching_classes', c.id, 'delete', '删除', 'btn-danger')}
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `}
  `;
  wireEntityActions(content);
}

function teachingTaskTypeLabel(classType) {
  return ({
    teaching: '教学班',
    admin: '行政班',
    ap: 'AP 分流',
    elective: '其他选修',
  })[classType] || '其他';
}

function showAssignmentFeedback(message, type = 'success') {
  const feedback = document.getElementById('assignment-action-feedback');
  if (!feedback) return;
  feedback.textContent = message;
  feedback.className = `assignment-action-feedback ${type}`;
}

function renderTeachingTaskRows(tasks) {
  if (!tasks.length) {
    return '<tr><td colspan="8" class="empty-cell">没有符合筛选条件的教学任务</td></tr>';
  }
  return tasks.map(task => `
    <tr class="${task.teacher_id ? '' : 'teaching-task-unassigned'}">
      <td>${escapeHtml(task.id)}</td>
      <td>${escapeHtml(task.course_name)}</td>
      <td>${escapeHtml(task.teacher_name)}</td>
      <td>${escapeHtml(task.class_name)}</td>
      <td>${escapeHtml(teachingTaskTypeLabel(task.class_type))}</td>
      <td>${task.student_ids?.length || 0}</td>
      <td>${Number(task.weekly_hours) || 0} 节</td>
      <td>${task.teacher_id ? '<span class="task-status-ready">已分工</span>' : '<span class="task-status-warning">待补教师</span>'}</td>
    </tr>
  `).join('');
}

function renderTeachingTaskResults(tasks, { teachers, courses, classes } = {}) {
  const content = document.getElementById('teaching-task-results');
  if (!content) return;
  const teacherMap = new Map((teachers || []).map(item => [item.id, item]));
  const courseMap = new Map((courses || []).map(item => [item.id, item]));
  const classMap = new Map((classes || []).map(item => [item.id, item]));
  const enhancedTasks = (tasks || []).map(task => ({
    ...task,
    course_name: courseMap.get(task.course_id)?.name || task.course_id || '未知课程',
    teacher_name: teacherMap.get(task.teacher_id)?.name || task.teacher_id || '待补教师',
    class_name: classMap.get(task.class_id)?.name
      || task.ap_block_name
      || task.class_id
      || '选课分组',
  })).sort((left, right) => {
    const staffingOrder = Number(Boolean(left.teacher_id)) - Number(Boolean(right.teacher_id));
    if (staffingOrder) return staffingOrder;
    return `${left.course_name}-${left.class_name}`.localeCompare(
      `${right.course_name}-${right.class_name}`,
      'zh-CN',
      { numeric: true },
    );
  });
  const summary = summarizeTeachingTasks(enhancedTasks);
  window._teachingTaskData = enhancedTasks;

  if (!summary.task_records) {
    content.innerHTML = `
      <div class="assignment-task-result-header">
        <div>
          <span class="page-kicker">生成结果</span>
          <h3 id="teaching-task-results-title">教学任务生成结果</h3>
        </div>
      </div>
      <div class="assignment-task-empty">
        <strong>还没有生成教学任务</strong>
        <p>完成教师分工后，点击上方“生成教学任务”；生成结果会直接保存在这里并可随时查看。</p>
      </div>
    `;
    return;
  }

  content.innerHTML = `
    <div class="assignment-task-result-header">
      <div>
        <span class="page-kicker">已保存的生成结果</span>
        <h3 id="teaching-task-results-title">教学任务生成结果</h3>
        <p>${summary.weekly_periods} 表示每周需要安排的总节次；下表实际保存了 ${summary.task_records} 条课程/班级任务。</p>
      </div>
      <span class="assignment-result-badge">结果就在这里</span>
    </div>
    <div class="assignment-task-summary" aria-label="教学任务汇总">
      <div><span>课程/班级任务</span><strong>${summary.task_records}</strong><small>条可排课记录</small></div>
      <div><span>每周总课时</span><strong>${summary.weekly_periods}</strong><small>节/周</small></div>
      <div><span>覆盖学生</span><strong>${summary.unique_students}</strong><small>名学生</small></div>
      <div class="${summary.unassigned_teacher_records ? 'has-warning' : ''}"><span>待补教师</span><strong>${summary.unassigned_teacher_records}</strong><small>条任务</small></div>
    </div>
    ${summary.unassigned_teacher_records ? `
      <div class="assignment-task-warning" role="status">
        其中 ${summary.unassigned_teacher_records} 条任务尚未指定教师，已排在明细最前面；补充分工后请重新生成。
      </div>
    ` : ''}
    <div class="assignment-task-toolbar">
      <label for="search-teaching-tasks">筛选任务明细</label>
      <input id="search-teaching-tasks" class="search-input" type="search" placeholder="搜索课程、教师、班级或任务 ID…">
      <span id="teaching-task-visible-count">显示 ${summary.task_records} / ${summary.task_records} 条</span>
    </div>
    <div class="table-container assignment-task-table-container">
      <table>
        <thead>
          <tr><th>任务 ID</th><th>课程</th><th>教师</th><th>班级 / 分组</th><th>类型</th><th>学生</th><th>周课时</th><th>状态</th></tr>
        </thead>
        <tbody id="teaching-task-rows">${renderTeachingTaskRows(enhancedTasks)}</tbody>
      </table>
    </div>
  `;

  const search = document.getElementById('search-teaching-tasks');
  search.oninput = () => {
    const keyword = search.value.toLowerCase().trim();
    const filtered = keyword ? enhancedTasks.filter(task => [
      task.id,
      task.course_id,
      task.course_name,
      task.teacher_id,
      task.teacher_name,
      task.class_id,
      task.class_name,
      task.ap_block_name,
    ].filter(Boolean).some(value => String(value).toLowerCase().includes(keyword))) : enhancedTasks;
    document.getElementById('teaching-task-rows').innerHTML = renderTeachingTaskRows(filtered);
    document.getElementById('teaching-task-visible-count').textContent = `显示 ${filtered.length} / ${summary.task_records} 条`;
  };
}

// 加载教师分工列表和最近一次生成的教学任务
async function loadAssignments({ focusTaskResults = false, focusAssignmentId = null } = {}) {
  const [data, teachers, courses, adminClasses, teachingClasses, teachingTasks] = await Promise.all([
    api('/teaching_assignments'),
    api('/teachers'),
    api('/courses'),
    api('/admin_classes'),
    api('/teaching_classes'),
    api('/teaching_tasks'),
  ]);

  const enhancedData = data.map(a => ({
    ...a,
    teacher_name: teachers.find(t => t.id === a.teacher_id)?.name || a.teacher_id || '待补教师',
    course_name: courses.find(c => c.id === a.course_id)?.name || a.course_id
  }));

  window._assignmentsData = enhancedData;
  window._assignmentTeachers = teachers;
  window._assignmentCourses = courses;
  window._assignmentAdminClasses = adminClasses;
  window._assignmentTeachingClasses = teachingClasses;

  const searchInput = document.getElementById('search-assignments');
  if (focusAssignmentId && searchInput) searchInput.value = '';
  renderTeachingTaskResults(teachingTasks, {
    teachers,
    courses,
    classes: [...adminClasses, ...teachingClasses],
  });
  renderAssignmentsList(enhancedData, { highlightId: focusAssignmentId });

  initEntitySearch('search-assignments', enhancedData, renderAssignmentsList, (item, keyword) => {
    return item.id.toLowerCase().includes(keyword) ||
           String(item.teacher_id || '').toLowerCase().includes(keyword) ||
           item.teacher_name.toLowerCase().includes(keyword) ||
           item.course_id.toLowerCase().includes(keyword) ||
           item.course_name.toLowerCase().includes(keyword) ||
           (item.class_ids || [item.class_id]).filter(Boolean)
             .some(classId => classId.toLowerCase().includes(keyword));
  });

  requestAnimationFrame(() => {
    if (focusTaskResults) {
      document.getElementById('teaching-task-results')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }
    if (!focusAssignmentId) return;
    const row = [...document.querySelectorAll('[data-assignment-id]')]
      .find(item => item.dataset.assignmentId === focusAssignmentId);
    row?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    row?.focus({ preventScroll: true });
  });
}

function renderAssignmentsList(data, { highlightId = null } = {}) {
  const content = document.getElementById('assignments-list');
  if (data.length === 0) {
    content.innerHTML = '<div class="empty-state"><p>暂无教师分工数据</p></div>';
    return;
  }
  content.innerHTML = `
    <div class="table-container">
      <table>
        <thead>
          <tr>
            <th>ID</th>
            <th>教师</th>
            <th>课程</th>
            <th>班级</th>
            <th>班级类型</th>
            <th>周课时</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          ${data.map(a => `
            <tr data-assignment-id="${safeDataAttribute(a.id)}" tabindex="-1" class="${a.id === highlightId ? 'assignment-row-highlight' : ''}">
              <td>${escapeHtml(a.id)}</td>
              <td>${escapeHtml(a.teacher_name)}</td>
              <td>${escapeHtml(a.course_name)}</td>
              <td>${escapeHtml((a.class_ids || [a.class_id]).filter(Boolean).join('、') || '-')}</td>
              <td>${a.class_type === 'admin' ? '行政班' : '教学班'}</td>
              <td>${a.weekly_hours}</td>
              <td>
                ${entityActionButton('teaching_assignments', a.id, 'delete', '删除', 'btn-danger')}
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
  wireEntityActions(content);
}

// 加载AP选课列表（以课程为主，包括选修课和AP类型的必修课）
async function loadSelections() {
  const [selections, students, courses] = await Promise.all([
    api('/ap_selections'),
    api('/students'),
    api('/courses')
  ]);

  // 按课程分组
  const courseGroups = {};

  // 初始化所有AP课程（选修课）
  courses.filter(c => c.type === 'ap').forEach(course => {
    courseGroups[course.id] = {
      course_id: course.id,
      course_name: course.name,
      course_type: 'ap',  // 选修课
      students: []
    };
  });

  // 填充选修课学生数据
  selections.forEach(sel => {
    const student = students.find(s => s.id === sel.student_id);
    sel.course_ids.forEach(courseId => {
      if (courseGroups[courseId]) {
        courseGroups[courseId].students.push({
          student_id: sel.student_id,
          student_name: student?.name || sel.student_id,
          grade: student?.grade || '-',
          admin_class: student?.admin_class_id || '-'
        });
      }
    });
  });

  // 分析每门AP课程，判断是选修还是必修
  const apCourseIds = courses.filter(c => c.type === 'ap').map(c => c.id);

  // 统计每门AP课程的学生来源
  const courseStudentSources = {};
  apCourseIds.forEach(courseId => {
    courseStudentSources[courseId] = {
      from_required: [],  // 从必修课来的学生
      from_selection: []  // 从选修课来的学生
    };
  });

  // 检查学生的必修课
  students.forEach(student => {
    (student.required_courses || []).forEach(courseId => {
      if (courseStudentSources[courseId]) {
        courseStudentSources[courseId].from_required.push(student);
      }
    });
  });

  // 检查学生的选修课
  selections.forEach(sel => {
    const student = students.find(s => s.id === sel.student_id);
    if (student) {
      sel.course_ids.forEach(courseId => {
        if (courseStudentSources[courseId]) {
          courseStudentSources[courseId].from_selection.push(student);
        }
      });
    }
  });

  // 根据学生来源确定课程类型
  Object.entries(courseStudentSources).forEach(([courseId, sources]) => {
    const course = courses.find(c => c.id === courseId);
    const hasRequiredStudents = sources.from_required.length > 0;
    const hasSelectionStudents = sources.from_selection.length > 0;

    // 确定课程类型
    let courseType;
    if (hasRequiredStudents && !hasSelectionStudents) {
      courseType = 'required_ap';  // 纯必修
    } else if (!hasRequiredStudents && hasSelectionStudents) {
      courseType = 'ap';  // 纯选修
    } else if (hasRequiredStudents && hasSelectionStudents) {
      courseType = 'mixed';  // 混合（既有必修也有选修）
    } else {
      courseType = 'ap';  // 默认选修
    }

    // 更新课程分组
    if (courseGroups[courseId]) {
      courseGroups[courseId].course_type = courseType;

      // 合并学生列表（去重）
      const allStudents = new Map();

      sources.from_required.forEach(s => {
        allStudents.set(s.id, {
          student_id: s.id,
          student_name: s.name,
          grade: s.grade || '-',
          admin_class: s.admin_class_id || '-',
          source: 'required'
        });
      });

      sources.from_selection.forEach(s => {
        if (!allStudents.has(s.id)) {
          allStudents.set(s.id, {
            student_id: s.id,
            student_name: s.name,
            grade: s.grade || '-',
            admin_class: s.admin_class_id || '-',
            source: 'selection'
          });
        }
      });

      courseGroups[courseId].students = Array.from(allStudents.values());
    }
  });

  const data = Object.values(courseGroups);
  window._selectionsData = data;
  renderSelectionsList(data);

  initEntitySearch('search-selections', data, renderSelectionsList, (item, keyword) => {
    return item.course_id.toLowerCase().includes(keyword) ||
           item.course_name.toLowerCase().includes(keyword) ||
           item.students.some(s =>
             s.student_id.toLowerCase().includes(keyword) ||
             s.student_name.toLowerCase().includes(keyword)
           );
  });
}

function renderSelectionsList(data) {
  const content = document.getElementById('selections-list');
  if (data.length === 0) {
    content.innerHTML = '<div class="empty-state"><p>暂无AP课程数据</p></div>';
    return;
  }

  // 按类型分组
  const requiredCourses = data.filter(c => c.course_type === 'required_ap');
  const mixedCourses = data.filter(c => c.course_type === 'mixed');
  const electiveCourses = data.filter(c => c.course_type === 'ap');

  let html = '';

  // 显示必修AP课程
  if (requiredCourses.length > 0) {
    html += `
      <div class="ap-section-title">
        <h3>📘 AP必修课程</h3>
        <p>这些课程是学生所在班级的必修课，系统自动分配</p>
      </div>
      <div class="ap-courses-grid">
        ${requiredCourses.map(course => renderAPCourseCard(course, true)).join('')}
      </div>
    `;
  }

  // 显示混合类型课程（既有必修也有选修）
  if (mixedCourses.length > 0) {
    html += `
      <div class="ap-section-title">
        <h3>📙 AP混合课程</h3>
        <p>这些课程既有必修学生也有选修学生</p>
      </div>
      <div class="ap-courses-grid">
        ${mixedCourses.map(course => renderAPCourseCard(course, false)).join('')}
      </div>
    `;
  }

  // 显示选修AP课程
  if (electiveCourses.length > 0) {
    html += `
      <div class="ap-section-title">
        <h3>📗 AP选修课程</h3>
        <p>这些课程是学生自主选择的选修课</p>
      </div>
      <div class="ap-courses-grid">
        ${electiveCourses.map(course => renderAPCourseCard(course, false)).join('')}
      </div>
    `;
  }

  content.innerHTML = html;
}

// 渲染AP课程卡片
function renderAPCourseCard(course, isRequired) {
  const headerStyle = isRequired
    ? 'background: linear-gradient(135deg, #1565c0, #1976D2);'
    : course.course_type === 'mixed'
      ? 'background: linear-gradient(135deg, #e65100, #f57c00);'
      : 'background: linear-gradient(135deg, #7b1fa2, #9c27b0);';

  const typeLabel = isRequired ? 'AP必修' : course.course_type === 'mixed' ? '混合' : '选修';

  return `
    <div class="ap-course-card" id="course-card-${course.course_id}">
      <div class="ap-course-header" onclick="toggleCourseExpand('${course.course_id}')" style="${headerStyle}">
        <div>
          <h4>${course.course_name}</h4>
          <span class="course-type-badge">${typeLabel}</span>
        </div>
        <div class="header-right">
          <span class="student-count">${course.students.length} 人</span>
          <span class="expand-icon" id="expand-icon-${course.course_id}">▶</span>
        </div>
      </div>
      <div class="ap-course-body hidden" id="course-body-${course.course_id}">
        ${course.students.length === 0 ? `
          <div class="empty-state" style="padding: 12px;">
            <p>暂无学生</p>
          </div>
        ` : `
          <div class="student-list">
            ${course.students.map(s => `
              <div class="student-item">
                <span class="student-name">${s.student_name}</span>
                <span class="student-info">${seniorGradeLabel(s.grade)} | ${s.admin_class}</span>
                ${s.source === 'required'
                  ? '<span class="source-badge required">必修</span>'
                  : '<span class="source-badge elective">选修</span>'
                }
                ${isRequired ? '' : `<button class="btn btn-danger btn-sm" onclick="removeStudentFromCourse('${s.student_id}', '${course.course_id}')">移除</button>`}
              </div>
            `).join('')}
          </div>
        `}
        ${isRequired ? '' : `
          <div class="ap-course-footer">
            <button class="btn btn-primary btn-sm" onclick="addStudentToCourse('${course.course_id}')">+ 添加学生</button>
          </div>
        `}
      </div>
    </div>
  `;
}

// 切换课程展开/折叠
window.toggleCourseExpand = function(courseId) {
  const body = document.getElementById(`course-body-${courseId}`);
  const icon = document.getElementById(`expand-icon-${courseId}`);

  if (body.classList.contains('hidden')) {
    body.classList.remove('hidden');
    icon.textContent = '▼';
  } else {
    body.classList.add('hidden');
    icon.textContent = '▶';
  }
};

// 从课程中移除学生
window.removeStudentFromCourse = async function(studentId, courseId) {
  if (!confirm(`确定要将学生 ${studentId} 从课程 ${courseId} 中移除吗？`)) {
    return;
  }

  try {
    // 获取当前选课数据
    const selections = await api('/ap_selections');
    const selection = selections.find(s => s.student_id === studentId);

    if (selection) {
      // 移除课程
      selection.course_ids = selection.course_ids.filter(c => c !== courseId);

      if (selection.course_ids.length === 0) {
        // 如果没有课程了，删除整个选课记录
        await api(`/ap_selections/${studentId}`, { method: 'DELETE' });
      } else {
        // 更新选课记录
        await api(`/ap_selections/${studentId}`, {
          method: 'PUT',
          body: JSON.stringify(selection)
        });
      }

      showToast('已移除', 'success');
      loadSelections();
    }
  } catch (error) {
    showToast(error.message, 'error');
  }
};

// 向课程添加学生
window.addStudentToCourse = async function(courseId) {
  try {
    const [students, selections, courses] = await Promise.all([
      api('/students'),
      api('/ap_selections'),
      api('/courses'),
    ]);
    const course = courses.find(item => item.id === courseId);

    // 找出没有选这门课的学生
    const availableStudents = students.filter(s => {
      const selection = selections.find(sel => sel.student_id === s.id);
      return courseAppliesToGrade(course || {}, s.grade)
        && (!selection || !selection.course_ids.includes(courseId));
    });

    if (availableStudents.length === 0) {
      showToast('所有学生都已选了这门课', 'info');
      return;
    }

    // 显示选择学生的模态框
    showModal('添加学生到 ' + courseId, `
      <form id="form-add-student-to-course">
        <div class="form-group">
          <label>选择学生</label>
          <select name="student_id" class="select" required>
            <option value="">选择学生</option>
            ${availableStudents.map(s => `<option value="${escapeHtml(s.id)}">${escapeHtml(s.name)} (${escapeHtml(s.id)}) - ${escapeHtml(seniorGradeLabel(s.grade))}</option>`).join('')}
          </select>
        </div>
        <div class="form-actions">
          <button type="button" class="btn btn-secondary" onclick="hideModal()">取消</button>
          <button type="submit" class="btn btn-primary">添加</button>
        </div>
      </form>
    `);

    document.getElementById('form-add-student-to-course').addEventListener('submit', async (e) => {
      e.preventDefault();
      const formData = new FormData(e.target);
      const studentId = formData.get('student_id');

      // 检查是否已有选课记录
      const existingSelection = selections.find(s => s.student_id === studentId);

      if (existingSelection) {
        // 添加课程到现有记录
        if (!existingSelection.course_ids.includes(courseId)) {
          existingSelection.course_ids.push(courseId);
          await api(`/ap_selections/${studentId}`, {
            method: 'PUT',
            body: JSON.stringify(existingSelection)
          });
        }
      } else {
        // 创建新的选课记录
        await api('/ap_selections', {
          method: 'POST',
          body: JSON.stringify({
            student_id: studentId,
            course_ids: [courseId]
          })
        });
      }

      hideModal();
      showToast('已添加', 'success');
      loadSelections();
    });
  } catch (error) {
    showToast(error.message, 'error');
  }
};

// 加载其他选课（必修选修课）
async function loadElectiveSelections() {
  const [students, courses] = await Promise.all([
    api('/students'),
    api('/courses')
  ]);

  // 获取筛选条件
  const gradeFilter = document.getElementById('filter-elective-grade').value;
  const groupFilter = document.getElementById('filter-elective-group').value;
  const keyword = document.getElementById('search-elective-selections').value.toLowerCase().trim();

  // 收集所有必修选修课选择数据
  const electiveSelections = [];

  students.forEach(student => {
    if (!student.elective_choices) return;

    const choices = student.elective_choices;
    ['group_a', 'group_b', 'group_c'].forEach(groupKey => {
      const courseId = choices[groupKey];
      if (!courseId) return;

      const course = courses.find(c => c.id === courseId);
      const group = groupKey.replace('group_', '').toUpperCase();

      electiveSelections.push({
        student_id: student.id,
        student_name: student.name,
        grade: student.grade,
        admin_class: student.admin_class_id,
        teaching_class: student.teaching_class_id,
        course_id: courseId,
        course_name: course?.name || courseId,
        group: group
      });
    });
  });

  // 应用筛选
  let filtered = [...electiveSelections];

  if (gradeFilter) {
    filtered = filtered.filter(s => s.grade === parseInt(gradeFilter));
  }

  if (groupFilter) {
    filtered = filtered.filter(s => s.group === groupFilter);
  }

  if (keyword) {
    filtered = filtered.filter(s =>
      s.student_id.toLowerCase().includes(keyword) ||
      s.student_name.toLowerCase().includes(keyword) ||
      s.course_name.toLowerCase().includes(keyword)
    );
  }

  window._electiveSelectionsData = filtered;
  renderElectiveSelectionsList(filtered);

  // 添加筛选事件监听
  document.getElementById('filter-elective-grade').onchange = () => loadElectiveSelections();
  document.getElementById('filter-elective-group').onchange = () => loadElectiveSelections();
  document.getElementById('search-elective-selections').oninput = () => loadElectiveSelections();
}

function renderElectiveSelectionsList(data) {
  const content = document.getElementById('elective-selections-list');

  if (data.length === 0) {
    content.innerHTML = '<div class="empty-state"><p>暂无其他选课数据</p></div>';
    return;
  }

  // 按组别分组统计
  const groupStats = {
    A: { name: 'A组', courses: {}, students: new Set() },
    B: { name: 'B组', courses: {}, students: new Set() },
    C: { name: 'C组', courses: {}, students: new Set() }
  };

  data.forEach(item => {
    if (!groupStats[item.group]) return;

    groupStats[item.group].students.add(item.student_id);
    if (!groupStats[item.group].courses[item.course_name]) {
      groupStats[item.group].courses[item.course_name] = 0;
    }
    groupStats[item.group].courses[item.course_name]++;
  });

  let html = `
    <div style="padding: 8px 0; color: var(--gray-500); font-size: 13px; margin-bottom: 16px;">
      共 ${data.length} 条选课记录
    </div>

    <div class="overview-grid" style="margin-bottom: 24px;">
      ${Object.entries(groupStats).map(([group, stats]) => `
        <div class="overview-card">
          <div class="overview-card-header" style="background: ${group === 'A' ? 'linear-gradient(135deg, #1565c0, #1976D2)' : group === 'B' ? 'background: linear-gradient(135deg, #7b1fa2, #9c27b0)' : 'background: linear-gradient(135deg, #2e7d32, #43a044)'};">
            <h4>${stats.name}</h4>
            <span class="badge">${stats.students.size} 人</span>
          </div>
          <div class="overview-card-body">
            ${Object.entries(stats.courses).map(([course, count]) => `
              <div style="display: flex; justify-content: space-between; padding: 4px 0; font-size: 13px;">
                <span>${course}</span>
                <span style="color: var(--gray-500);">${count} 人</span>
              </div>
            `).join('')}
          </div>
        </div>
      `).join('')}
    </div>
  `;

  // 按组别显示详细列表
  ['A', 'B', 'C'].forEach(group => {
    const groupData = data.filter(d => d.group === group);
    if (groupData.length === 0) return;

    html += `
      <div style="margin-bottom: 24px;">
        <h3 style="margin-bottom: 12px; color: var(--gray-700);">${group}组选课详情</h3>
        <div class="table-container">
          <table>
            <thead>
              <tr>
                <th>学生ID</th>
                <th>姓名</th>
                <th>年级</th>
                <th>行政班</th>
                <th>教学班</th>
                <th>选择课程</th>
              </tr>
            </thead>
            <tbody>
              ${groupData.map(s => `
                <tr>
                  <td>${s.student_id}</td>
                  <td>${s.student_name}</td>
                  <td>高${s.grade}</td>
                  <td>${s.admin_class}</td>
                  <td>${s.teaching_class}</td>
                  <td><span class="ap-tag">${s.course_name}</span></td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;
  });

  content.innerHTML = html;
}

// 加载分班管理
async function loadSectioning() {
  try {
    const [sections, apBlockData, teachers, students] = await Promise.all([
      api('/elective-sections'),
      api('/ap-block-config'),
      api('/teachers'),
      api('/students'),
    ]);
    window._sectioningData = sections;
    window._apBlockData = apBlockData;
    window._apBlockConfig = apBlockData.config;
    // 分班管理可被直接打开，不能依赖用户先访问“教师管理”或“学生管理”
    // 才能解析教师和学生 ID。
    window._teachersData = teachers;
    window._studentsData = students;
    renderSectioningMode(apBlockData);
    renderSectioningList(sections);

    // 绑定按钮事件
    document.getElementById('btn-solve-sections').onclick = solveSections;
    document.getElementById('btn-refresh-sections').onclick = loadSectioning;
    document.getElementById('btn-sectioning-suggestions').onclick = loadSectioningSuggestions;
  } catch (error) {
    console.error('加载分班数据失败:', error);
  }
}

function blockSlotLabel(slotId) {
  const match = /^D(\d+)P(\d+)$/.exec(String(slotId || ''));
  if (!match) return slotId;
  return `周${['', '一', '二', '三', '四', '五'][Number(match[1])] || match[1]}第${match[2]}节`;
}

function blockSlotsText(slots = []) {
  return slots.length ? slots.map(blockSlotLabel).join('、') : '由排课引擎安排';
}

function renderSectioningMode(data) {
  const target = document.getElementById('sectioning-mode');
  if (!target) return;
  const config = data.config;
  const enabled = config.enabled === true;
  target.innerHTML = `
    <div class="sectioning-mode-copy">
      <div class="sectioning-mode-heading">
        <h3>AP 分班模式</h3>
        <span class="sectioning-mode-badge ${enabled ? 'is-block' : ''}">${enabled ? 'Block 模式已启用' : '普通平行分班'}</span>
      </div>
      <p>${enabled
    ? '每名学生的已选 AP 会分配到不同 Block；同一 Block 的 section 使用同一组时段。'
    : '按每门课程的 Section 数量生成普通平行班。启用 Block 后会重新生成 AP section，并使已有课表失效。'}</p>
      ${enabled ? `<div class="sectioning-block-summary">${config.blocks.map(block =>
    `<span><strong>${block.name}</strong>：${blockSlotsText(block.slots)}</span>`).join('')}</div>` : ''}
    </div>
    <div class="sectioning-mode-actions">
      <label for="sectioning-mode-select">模式</label>
      <select id="sectioning-mode-select" class="select">
        <option value="standard" ${enabled ? '' : 'selected'}>普通平行分班</option>
        <option value="block" ${enabled ? 'selected' : ''}>AP Block 分班</option>
      </select>
      <button id="btn-configure-ap-blocks" class="btn btn-secondary" type="button">配置 Block</button>
    </div>
  `;
  document.getElementById('sectioning-mode-select').onchange = async event => {
    const nextEnabled = event.target.value === 'block';
    if (nextEnabled === enabled) return;
    const action = nextEnabled ? '启用 AP Block 分班' : '切回普通 AP 平行分班';
    if (!confirm(`确定${action}吗？这会重新生成 AP section，并将现有课表与手动必要条件标记为需要重新排课。`)) {
      event.target.value = enabled ? 'block' : 'standard';
      return;
    }
    try {
      const result = await api('/ap-block-config', {
        method: 'PUT',
        body: JSON.stringify({ ...config, enabled: nextEnabled }),
      });
      showToast(result.message);
      await loadSectioning();
    } catch (error) {
      event.target.value = enabled ? 'block' : 'standard';
    }
  };
  document.getElementById('btn-configure-ap-blocks').onclick = () => configureApBlocks(data);
}

function configureApBlocks(data) {
  const { config, offerings = [] } = data;
  const allBlockIds = config.blocks.map(block => block.id);
  showModal('配置 AP Block', `
    <form id="form-ap-block-config">
      <p class="form-help">候选 Block 决定某门 AP 课可以在哪些 Block 开班；引擎会结合学生已选课程，最多按该课程的 Section 数生成班级，并保证同一学生不在同一 Block 上两门 AP。</p>
      <div class="ap-block-config-grid">
        ${config.blocks.map(block => `
          <div class="ap-block-config-card">
            <label>Block 名称
              <input class="input" data-block-name="${block.id}" value="${block.name}">
            </label>
            <div class="ap-block-id">${block.id}</div>
            <label>固定时段
              <input class="input" data-block-slots="${block.id}" value="${block.slots.join(', ')}" placeholder="D1P3, D2P2, ...">
            </label>
            <small>留空则由排课引擎选择；填写后必须与该 Block 中 AP 课程的周课时一致。</small>
          </div>
        `).join('')}
      </div>
      <div class="form-group">
        <label>课程候选 Block</label>
        <div class="ap-block-course-matrix">
          <table>
            <thead><tr><th>AP 课程</th><th>周课时</th>${config.blocks.map(block => `<th>${block.name}</th>`).join('')}</tr></thead>
            <tbody>
              ${offerings.map(offering => {
    const selected = config.offering_block_ids?.[offering.id]
      || config.course_block_ids[offering.course_id]
      || allBlockIds;
    return `<tr>
                  <td>${offering.name}</td><td>${offering.weekly_hours}</td>
                  ${config.blocks.map(block => `<td><label class="block-course-check"><input type="checkbox" data-offering-id="${offering.id}" data-candidate-block-id="${block.id}" ${selected.includes(block.id) ? 'checked' : ''}> 可用</label></td>`).join('')}
                </tr>`;
  }).join('')}
            </tbody>
          </table>
        </div>
      </div>
      <div class="form-actions">
        <button type="button" class="btn btn-secondary" onclick="hideModal()">取消</button>
        <button type="submit" class="btn btn-primary">保存 Block 配置</button>
      </div>
    </form>
  `);
  document.getElementById('form-ap-block-config').addEventListener('submit', async event => {
    event.preventDefault();
    const blocks = config.blocks.map(block => ({
      id: block.id,
      name: document.querySelector(`[data-block-name="${block.id}"]`).value.trim(),
      slots: document.querySelector(`[data-block-slots="${block.id}"]`).value
        .split(/[\s,，]+/).map(value => value.trim()).filter(Boolean),
    }));
    const courseBlockIds = {};
    const offeringBlockIds = {};
    for (const offering of offerings) {
      const selected = [...document.querySelectorAll(`[data-offering-id="${offering.id}"]:checked`)]
        .map(input => input.dataset.candidateBlockId);
      if (!selected.length) {
        showToast(`${offering.name} 至少需要一个候选 Block`, 'error');
        return;
      }
      if (offering.id === offering.course_id) courseBlockIds[offering.course_id] = selected;
      else offeringBlockIds[offering.id] = selected;
    }
    try {
      const result = await api('/ap-block-config', {
        method: 'PUT',
        body: JSON.stringify({
          enabled: config.enabled,
          blocks,
          course_block_ids: courseBlockIds,
          offering_block_ids: offeringBlockIds,
        }),
      });
      hideModal();
      showToast(result.message);
      await loadSectioning();
    } catch {
      // api() has already shown the actionable backend validation message.
    }
  });
}

function renderSectioningStats(statistics) {
  const statsDiv = document.getElementById('sectioning-stats');
  statsDiv.innerHTML = `
    <div class="stat-item"><div class="stat-label">AP选修班</div><div class="stat-value">${statistics.ap_sections}</div></div>
    <div class="stat-item"><div class="stat-label">必修选修班</div><div class="stat-value">${statistics.elective_sections}</div></div>
    <div class="stat-item"><div class="stat-label">总班级数</div><div class="stat-value">${statistics.total_sections}</div></div>
    <div class="stat-item"><div class="stat-label">教学任务</div><div class="stat-value">${statistics.total_tasks}</div></div>
  `;
}

async function solveSections() {
  if (!confirm('确定要运行分班引擎吗？这将重新分配所有选修课班级。')) {
    return;
  }

  try {
    const result = await api('/solve-sections', { method: 'POST' });

    // 显示统计信息
    renderSectioningStats(result.statistics);

    showToast('分班完成！');
    loadSectioning();
  } catch (error) {
    showToast('分班失败: ' + error.message, 'error');
  }
}

async function loadSectioningSuggestions() {
  try {
    const data = await api('/elective-sections/suggestions');
    const suggestionsDiv = document.getElementById('sectioning-suggestions');

    if (data.suggestions.length === 0) {
      suggestionsDiv.innerHTML = '<div class="empty-state"><p>暂无建议</p></div>';
    } else {
      suggestionsDiv.innerHTML = `
        <div class="suggestions-list">
          ${data.suggestions.map(s => `<div class="suggestion-item">💡 ${s}</div>`).join('')}
        </div>
      `;
    }
  } catch (error) {
    showToast('获取建议失败: ' + error.message, 'error');
  }
}

function renderSectioningList(sections) {
  const content = document.getElementById('sectioning-list');

  if (!sections || sections.length === 0) {
    content.innerHTML = '<div class="empty-state"><p>暂无分班数据，请点击"运行分班引擎"</p></div>';
    return;
  }

  // 按课程类型分组
  const apSections = sections.filter(s => s.course_type === 'ap');
  const electiveSections = sections.filter(s => s.course_type === 'required_elective');

  let html = '';

  // AP选修班. In Block mode, grouping by Block makes the time-band meaning
  // visible instead of looking like unrelated parallel classes.
  if (apSections.length > 0) {
    if (window._apBlockConfig?.enabled) {
      const blocks = window._apBlockConfig.blocks || [];
      const byBlock = new Map();
      for (const section of apSections) {
        const list = byBlock.get(section.ap_block_id || 'UNASSIGNED') || [];
        list.push(section);
        byBlock.set(section.ap_block_id || 'UNASSIGNED', list);
      }
      html += `<div class="section-group"><h3>AP Block 分班 (${apSections.length}个班)</h3>`;
      for (const block of blocks) {
        const sectionsInBlock = byBlock.get(block.id) || [];
        html += `<div class="ap-block-section-group">
          <div class="ap-block-section-heading"><strong>${block.name}</strong><span>${blockSlotsText(block.slots)}</span><em>${sectionsInBlock.length} 个 section</em></div>
          <div class="sections-grid">${sectionsInBlock.map(section => renderSectionCard(section)).join('') || '<div class="empty-state">该 Block 暂无已选 AP 课程</div>'}</div>
        </div>`;
      }
      html += '</div>';
    } else {
      html += `
        <div class="section-group">
          <h3>AP选修班 (${apSections.length}个班)</h3>
          <div class="sections-grid">
            ${apSections.map(section => renderSectionCard(section)).join('')}
          </div>
        </div>
      `;
    }
  }

  // 必修选修班
  if (electiveSections.length > 0) {
    html += `
      <div class="section-group">
        <h3>必修选修班 (${electiveSections.length}个班)</h3>
        <div class="sections-grid">
          ${electiveSections.map(section => renderSectionCard(section)).join('')}
        </div>
      </div>
    `;
  }

  content.innerHTML = html;
}

function renderSectionCard(section) {
  const courses = window._coursesData || [];
  const course = courses.find(c => c.id === section.course_id);
  const teacher = window._teachersData?.find(t => t.id === section.teacher_id);
  const rosterById = new Map((section.student_roster || []).map(student => [student.id, student]));

  return `
    <div class="section-card" id="section-${section.id}">
      <div class="section-header">
        <h4>${section.course_name}</h4>
        <span class="section-badge">${section.student_ids.length}人</span>
      </div>
      <div class="section-body">
        <div class="section-info">
          <div>班级: ${section.id}</div>
          <div>教师: ${section.teacher_name || teacher?.name || '待分配'}</div>
          <div>课时: ${section.weekly_hours}节/周</div>
          ${section.ap_block_name ? `<div>Block: ${section.ap_block_name}</div>` : ''}
        </div>
        <div class="section-students">
          <div class="students-header">学生列表:</div>
          <div class="students-list">
            ${section.student_ids.slice(0, 10).map(id => {
              const student = rosterById.get(id) || window._studentsData?.find(s => s.id === id);
              return `<span class="student-tag">${student?.name || id}</span>`;
            }).join('')}
            ${section.student_ids.length > 10 ? `<span class="student-tag more">+${section.student_ids.length - 10}人</span>` : ''}
          </div>
        </div>
        <div class="section-actions">
          <button class="btn btn-primary btn-sm" onclick="editSection('${section.id}')">编辑</button>
          <button class="btn btn-secondary btn-sm" onclick="viewSectionStudents('${section.id}')">查看全部</button>
        </div>
      </div>
    </div>
  `;
}

window.editSection = function(sectionId) {
  const section = window._sectioningData?.find(s => s.id === sectionId);
  if (!section) return;

  const courses = window._coursesData || [];
  const teachers = window._teachersData || [];
  const rosterById = new Map((section.student_roster || []).map(student => [student.id, student]));

  showModal('编辑分班 - ' + section.course_name, `
    <form id="form-edit-section">
      <div class="form-group">
        <label>班级ID</label>
        <input type="text" value="${section.id}" readonly style="background-color: var(--gray-100);">
      </div>
      <div class="form-group">
        <label>课程</label>
        <input type="text" value="${section.course_name}" readonly style="background-color: var(--gray-100);">
      </div>
      <div class="form-group">
        <label>教师</label>
        <select name="teacher_id" class="select">
          <option value="">待分配</option>
          ${teachers.filter(t => t.can_teach.includes(section.course_id)).map(t =>
            `<option value="${t.id}" ${t.id === section.teacher_id ? 'selected' : ''}>${t.name}</option>`
          ).join('')}
        </select>
      </div>
      <div class="form-group">
        <label>学生 (${section.student_ids.length}人)</label>
        <div style="max-height: 200px; overflow-y: auto; border: 1px solid var(--gray-300); border-radius: var(--radius); padding: 8px;">
          ${section.student_ids.map(id => {
            const student = rosterById.get(id) || window._studentsData?.find(s => s.id === id);
            return `<div style="padding: 4px 0; display: flex; justify-content: space-between; align-items: center;">
              <span>${student?.name || id}</span>
              <button type="button" class="btn btn-secondary btn-sm" onclick="moveStudentToSection('${section.id}', '${id}')">转至平行班</button>
            </div>`;
          }).join('')}
        </div>
      </div>
      <div class="form-actions">
        <button type="button" class="btn btn-secondary" onclick="hideModal()">取消</button>
        <button type="submit" class="btn btn-primary">保存</button>
      </div>
    </form>
  `);

  document.getElementById('form-edit-section').addEventListener('submit', async (e) => {
    e.preventDefault();
    const formData = new FormData(e.target);
    const updates = {
      teacher_id: formData.get('teacher_id') || null,
    };

    try {
      await api(`/elective-sections/${sectionId}`, {
        method: 'PUT',
        body: JSON.stringify({ ...updates, replan: true })
      });
      hideModal();
      showToast('保存成功');
      loadSectioning();
    } catch (error) {
      showToast('保存失败: ' + error.message, 'error');
    }
  });
};

window.viewSectionStudents = function(sectionId) {
  const section = window._sectioningData?.find(s => s.id === sectionId);
  if (!section) return;
  const rosterById = new Map((section.student_roster || []).map(student => [student.id, student]));

  showModal('学生列表 - ' + section.course_name, `
    <div style="max-height: 400px; overflow-y: auto;">
      <table style="width: 100%;">
        <thead>
          <tr>
            <th>学生ID</th>
            <th>中文姓名</th>
            <th>英文名</th>
            <th>年级</th>
            <th>行政班</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          ${section.student_ids.map(id => {
            const student = rosterById.get(id) || window._studentsData?.find(s => s.id === id);
            return `
              <tr>
                <td>${id}</td>
                <td>${student?.name || '-'}</td>
                <td>${student?.english_name || '-'}</td>
                <td>${student?.grade || '-'}</td>
                <td>${student?.admin_class_id || '-'}</td>
                <td>
                  <button class="btn btn-secondary btn-sm" onclick="moveStudentToSection('${section.id}', '${id}')">转至平行班</button>
                </td>
              </tr>
            `;
          }).join('')}
        </tbody>
      </table>
    </div>
    <div class="form-actions" style="margin-top: 16px;">
      <button type="button" class="btn btn-secondary" onclick="hideModal()">关闭</button>
    </div>
  `);
};

window.removeStudentFromSection = async function(sectionId, studentId) {
  if (!confirm('确定要将该学生从班级中移除吗？')) {
    return;
  }

  try {
    const section = window._sectioningData?.find(s => s.id === sectionId);
    if (!section) return;

    const updatedStudentIds = section.student_ids.filter(id => id !== studentId);

    await api(`/elective-sections/${sectionId}`, {
      method: 'PUT',
      body: JSON.stringify({ student_ids: updatedStudentIds })
    });

    showToast('已移除');
    hideModal();
    loadSectioning();
  } catch (error) {
    showToast('移除失败: ' + error.message, 'error');
  }
};

// A selected course must always retain exactly one section for every student.
// Therefore the UI exposes an atomic transfer instead of a bare "remove",
// which would create an invalid timetable roster.
window.moveStudentToSection = function(sourceSectionId, studentId) {
  const source = window._sectioningData?.find(section => section.id === sourceSectionId);
  const student = window._studentsData?.find(item => item.id === studentId);
  if (!source) return;
  const targets = (window._sectioningData || []).filter(section =>
    section.id !== source.id
      && section.course_id === source.course_id
      && (section.eligible_student_ids || []).includes(studentId)
      && (!section.capacity || section.student_ids.length < section.capacity));
  if (!targets.length) {
    showToast('没有可转入的同课程平行班', 'error');
    return;
  }
  showModal(`转班 - ${student?.name || studentId}`, `
    <form id="form-move-student-section">
      <p>将 <strong>${student?.name || studentId}</strong> 从 ${source.id} 转到：</p>
      <div class="form-group">
        <label>目标平行班</label>
        <select name="target_section_id" class="select">
          ${targets.map(section => `<option value="${escapeHtml(section.id)}">${escapeHtml(section.id)}（${section.student_ids.length} 人）</option>`).join('')}
        </select>
      </div>
      <div class="form-actions">
        <button type="button" class="btn btn-secondary" onclick="hideModal()">取消</button>
        <button type="submit" class="btn btn-primary">确认转班</button>
      </div>
    </form>
  `);
  document.getElementById('form-move-student-section').addEventListener('submit', async (event) => {
    event.preventDefault();
    const targetSectionId = new FormData(event.target).get('target_section_id');
    try {
      await api(`/elective-sections/${targetSectionId}/move-student`, {
        method: 'POST',
        body: JSON.stringify({ student_id: studentId, replan: true }),
      });
      hideModal();
      showToast('已转班；系统已重新排课并通过完整硬约束校验');
      loadSectioning();
    } catch (error) {
      showToast('无法转班: ' + error.message, 'error');
    }
  });
};

// 加载约束列表
async function loadConstraints() {
  const data = await api('/constraints');
  window._constraintsData = data;
  renderConstraintsList(data);

  initEntitySearch('search-constraints', data, renderConstraintsList, (item, keyword) => {
    return item.id.toLowerCase().includes(keyword) ||
           item.type.toLowerCase().includes(keyword) ||
           item.scope.toLowerCase().includes(keyword) ||
           (item.target_id && item.target_id.toLowerCase().includes(keyword));
  });
}

const ruleTypeHints = {
  fixed_slots: '指定 section 必须出现在给定时段；exact 表示其全部课时都只能在这些时段。',
  forbid_slots: '禁止目标在给定时段上课。',
  preferred_slots: '偏好目标在给定时段上课；通常设为软规则。',
  max_occurrences_per_day: '限制同一目标每天最多出现几节。',
  no_internal_gaps: '学生每天已排课程必须从第 1 节连续向后占位，空位只能留在当天末尾；仅支持 student 硬规则。',
  max_consecutive_lessons: '限制同一目标一天中连续课时的最大长度；本校“连续不超过三节”应设为 student 范围。',
  max_consecutive_days_in_period: '限制目标连续几天出现在同一节次。',
  avoid_teacher_day_extremes: '若教师同一天既有第一节又有最后一节则计入软惩罚；仅支持 teacher 软规则。',
  priority: '仅影响求解变量的优先顺序，不改变硬约束。',
};

function constraintParamsFromForm(formData, type) {
  const selectorText = formData.get('selector_json').trim();
  let selector = {};
  if (selectorText) {
    try { selector = JSON.parse(selectorText); }
    catch { throw new Error('高级筛选必须是合法 JSON 对象'); }
    if (!selector || typeof selector !== 'object' || Array.isArray(selector)) throw new Error('高级筛选必须是 JSON 对象');
  }
  const params = Object.keys(selector).length ? { selector } : {};
  const slots = formData.get('slots').split(/[,，\s]+/).filter(Boolean);
  if (['fixed_slots', 'forbid_slots', 'preferred_slots'].includes(type)) {
    if (!slots.length) throw new Error('该规则需要至少一个时段，例如 D1P1,D2P3');
    params.slots = slots;
    if (type === 'fixed_slots') params.mode = formData.get('slot_mode');
  }
  if (['max_occurrences_per_day', 'max_consecutive_lessons'].includes(type)) {
    params.max = Number(formData.get('max'));
  }
  if (type === 'max_consecutive_days_in_period') {
    params.max = Number(formData.get('max'));
    params.period = Number(formData.get('period'));
  }
  if (type === 'avoid_teacher_day_extremes') {
    params.first_period = Number(formData.get('first_period'));
    params.last_period = Number(formData.get('last_period'));
  }
  if (type === 'priority') params.rank = Number(formData.get('rank'));
  return params;
}

window.openConstraintDialog = function(existing = null) {
  const rule = existing || {
    id: '', type: 'max_occurrences_per_day', scope: 'course', hard: true, weight: 10,
    target_id: '', params: { max: 1 },
  };
  const params = rule.params || {};
  showModal(existing ? `编辑约束 - ${rule.id}` : '添加约束', `
    <form id="form-constraint">
      <div class="form-group"><label>ID</label>
        <input name="id" value="${rule.id}" ${existing ? 'readonly' : ''} required placeholder="如 course_once_per_day"></div>
      <div class="form-group"><label>规则类型</label>
        <select name="type" class="select">${Object.entries(ruleTypeHints).map(([id, hint]) => `<option value="${id}" ${id === rule.type ? 'selected' : ''}>${id} — ${hint}</option>`).join('')}</select></div>
      <div class="form-group"><label>作用范围</label>
        <select name="scope" class="select">${['global', 'teacher', 'room', 'course', 'class', 'section', 'student'].map(scope => `<option value="${scope}" ${scope === rule.scope ? 'selected' : ''}>${scope}</option>`).join('')}</select></div>
      <div class="form-group"><label>目标 ID（可留空，表示该范围内的全部对象）</label>
        <input name="target_id" value="${rule.target_id || ''}" placeholder="如 AP_BIO 或 T_EXP_A"></div>
      <div class="form-group"><label>时段（固定、禁排、偏好规则必填）</label>
        <input name="slots" value="${(params.slots || []).join(',')}" placeholder="D1P1,D2P3"></div>
      <div class="form-group"><label>固定时段模式</label>
        <select name="slot_mode" class="select"><option value="contains" ${params.mode !== 'exact' ? 'selected' : ''}>contains（包含这些时段）</option><option value="exact" ${params.mode === 'exact' ? 'selected' : ''}>exact（全部课时恰为这些时段）</option></select></div>
      <div class="form-group"><label>最大次数/最大连续节数</label>
        <input type="number" min="1" name="max" value="${params.max || 1}"></div>
      <div class="form-group"><label>指定节次（仅“连续天同一节次”使用）</label>
        <input type="number" min="1" max="10" name="period" value="${params.period || 1}"></div>
      <div class="form-group"><label>首节/末节（仅“教师避免同日首尾课”使用）</label>
        <div style="display:flex;gap:8px;">
          <input type="number" min="1" max="10" name="first_period" value="${params.first_period || 1}" aria-label="首节">
          <input type="number" min="1" max="10" name="last_period" value="${params.last_period || 10}" aria-label="末节">
        </div></div>
      <div class="form-group"><label>优先级 rank（仅 priority 使用，数字越小越先安排）</label>
        <input type="number" name="rank" value="${params.rank ?? 0}"></div>
      <div class="form-group"><label><input type="checkbox" name="hard" ${rule.hard ? 'checked' : ''}> 硬约束（不勾选即软约束）</label></div>
      <div class="form-group"><label><input type="checkbox" name="requires_approval_to_relax" ${rule.requires_approval_to_relax ? 'checked' : ''}> 软规则仅在教务明确批准后才可破坏</label>
        <div style="font-size:12px;color:var(--gray-500);margin-top:4px;">未获批准时，系统会先把它当作硬规则；无解只会报告原因，不会自行放宽。</div></div>
      <div class="form-group"><label>软约束权重</label>
        <input type="number" min="1" name="weight" value="${rule.weight || 10}"></div>
      <div class="form-group"><label>高级筛选（可选 JSON；例：{&quot;grades&quot;:[11,12]}）</label>
        <textarea name="selector_json" rows="3" placeholder='{"teacher_ids":["T1"]}'>${params.selector ? JSON.stringify(params.selector) : ''}</textarea></div>
      <p style="font-size:12px;color:var(--gray-500);">保存后现有课表会标记为待重排；求解器与独立校验器使用同一条规则。</p>
      <div class="form-actions"><button type="button" class="btn btn-secondary" onclick="hideModal()">取消</button><button type="submit" class="btn btn-primary">保存约束</button></div>
    </form>
  `);
  document.getElementById('form-constraint').addEventListener('submit', async (event) => {
    event.preventDefault();
    try {
      const formData = new FormData(event.target);
      const type = formData.get('type');
      const hard = formData.has('hard');
      const next = {
        id: formData.get('id').trim(), type, scope: formData.get('scope'), hard,
        params: constraintParamsFromForm(formData, type),
      };
      const targetId = formData.get('target_id').trim();
      if (targetId) next.target_id = targetId;
      if (!hard) {
        next.weight = Number(formData.get('weight'));
        next.requires_approval_to_relax = formData.has('requires_approval_to_relax');
      }
      await api(existing ? `/constraints/${rule.id}` : '/constraints', {
        method: existing ? 'PUT' : 'POST', body: JSON.stringify(next),
      });
      hideModal();
      showToast('约束已保存；重新求解后生效', 'success');
      loadConstraints();
    } catch (error) {
      showToast('无法保存约束: ' + error.message, 'error');
    }
  });
};

function renderConstraintsList(data) {
  const content = document.getElementById('constraints-list');
  if (data.length === 0) {
    content.innerHTML = '<div class="empty-state"><p>暂无约束数据</p></div>';
    return;
  }
  content.innerHTML = `
    <div class="table-container">
      <table>
        <thead>
          <tr>
            <th>ID</th>
            <th>类型</th>
            <th>范围</th>
            <th>目标</th>
            <th>硬/软</th>
            <th>权重</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          ${data.map(c => `
            <tr>
              <td>${escapeHtml(c.id)}</td>
              <td>${escapeHtml(c.type)}</td>
              <td>${escapeHtml(c.scope)}</td>
              <td>${escapeHtml(c.target_id || '-')}</td>
              <td>${c.hard ? '硬' : (c.requires_approval_to_relax ? '软（需批准）' : '软')}</td>
              <td>${c.weight || '-'}</td>
              <td>
                <button class="btn btn-secondary btn-sm" type="button" data-constraint-edit-id="${escapeHtml(c.id)}">编辑</button>
                ${entityActionButton('constraints', c.id, 'delete', '删除', 'btn-danger')}
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
  wireEntityActions(content);
  content.querySelectorAll('[data-constraint-edit-id]').forEach(button => {
    button.addEventListener('click', () => window.openConstraintDialog(
      window._constraintsData.find(item => item.id === button.dataset.constraintEditId),
    ));
  });
}

// 加载学生选择框
async function loadStudentSelect() {
  const data = await api('/students');
  window._studentsData = data; // 缓存数据供搜索使用
  const select = document.getElementById('select-student');
  select.innerHTML = '<option value="">选择学生</option>' +
    data.map(s => `<option value="${escapeHtml(s.id)}">${escapeHtml(s.id)} - ${escapeHtml(s.name)}${s.english_name ? ` (${escapeHtml(s.english_name)})` : ''}</option>`).join('');

  // 初始化搜索
  initSearchFilter(
    'search-student',
    'select-student',
    data,
    (item) => `${item.id} ${item.name} ${item.english_name || ''} ${item.pinyin_name || ''}`,
    (item) => `${item.id} - ${item.name}${item.english_name ? ` (${item.english_name})` : ''}`,
  );
}

function apGroupOptionLabel(section, courses = new Map(), teachers = new Map()) {
  const course = courses.get(section.course_id);
  const teacher = teachers.get(section.teacher_id);
  const grades = (section.grades || []).map(seniorGradeLabel).join('、') || '未设置年级';
  const courseName = section.course_name || course?.name || section.course_id;
  const teacherName = section.teacher_name || teacher?.name || section.teacher_id || '待定教师';
  const sectionNumber = section.id.split('_').pop();
  return `${courseName} · Section ${sectionNumber} | ${grades} | ${teacherName} | ${section.student_count ?? section.student_ids?.length ?? 0} 人`;
}

// AP 分流组仅基于当前已排出的 section，确保列表与课表中的实际分班一致。
async function loadApGroupSelect() {
  const groups = await api('/ap-groups');

  window._apGroupSections = groups;

  const select = document.getElementById('select-ap-group');
  select.innerHTML = '<option value="">选择 AP 分流组</option>' +
    groups.map(section => `<option value="${escapeHtml(section.id)}">${escapeHtml(apGroupOptionLabel(section))}</option>`).join('');

  initSearchFilter(
    'search-ap-group',
    'select-ap-group',
    groups,
    (section) => `${section.id} ${apGroupOptionLabel(section)} ${section.course_id} ${section.teacher_id || ''}`,
    (section) => apGroupOptionLabel(section),
  );

  const content = document.getElementById('ap-group-timetable-content');
  if (!groups.length) {
    content.innerHTML = '<div class="empty-state"><p>当前课表中没有可查看的 AP 分流组。请先完成排课。</p></div>';
  }
}

async function renderApGroupTimetable(sectionId) {
  const detail = await api(`/ap-groups/${encodeURIComponent(sectionId)}`);
  const section = detail.section;
  const container = document.getElementById('ap-group-timetable-content');
  if (!section) {
    container.innerHTML = '<div class="empty-state"><p>未找到该 AP 分流组，请刷新后重新选择。</p></div>';
    return;
  }

  const courseName = section.course_name || section.course_id;
  const teacherName = section.teacher_name || section.teacher_id || '待定教师';
  const grades = (section.grades || []).map(seniorGradeLabel).join('、') || '未设置年级';
  const sectionNumber = section.id.split('_').pop();

  renderDetailedTimetable(
    'ap-group-timetable-content',
    detail.timetable,
    `${courseName} · Section ${sectionNumber}`,
    `AP 分流组 | ${grades} | 教师：${teacherName} | ${section.student_count || 0} 人`,
  );

  const roster = detail.students || [];
  container.insertAdjacentHTML('beforeend', `
    <div class="ap-group-roster">
      <h3>分流组学生名单（${roster.length} 人）</h3>
      ${roster.length ? `
        <div class="table-container">
          <table>
            <thead><tr><th>Student ID</th><th>中文姓名</th><th>英文姓名</th><th>年级</th><th>行政班</th><th>教学班</th></tr></thead>
            <tbody>${roster.map(student => `<tr>
              <td>${escapeHtml(student.id)}</td>
              <td>${escapeHtml(student.name || '-')}</td>
              <td>${escapeHtml(student.english_name || '-')}</td>
              <td>${escapeHtml(seniorGradeLabel(student.grade))}</td>
              <td>${escapeHtml(student.admin_class_id || '-')}</td>
              <td>${escapeHtml(student.teaching_class_id || '-')}</td>
            </tr>`).join('')}</tbody>
          </table>
        </div>
      ` : '<p class="empty-state">该分流组暂未分配学生。</p>'}
    </div>
  `);
}

// 加载教师选择框
async function loadTeacherSelect() {
  const data = await api('/teachers');
  window._teachersData = data; // 缓存数据供搜索使用
  const select = document.getElementById('select-teacher');
  select.innerHTML = '<option value="">选择教师</option>' +
    data.map(t => `<option value="${escapeHtml(t.id)}">${escapeHtml(t.id)} - ${escapeHtml(t.name)}</option>`).join('');

  // 初始化搜索
  initSearchFilter('search-teacher', 'select-teacher', data, (item) => `${item.id} ${item.name}`);
}

// 加载班级选择框
async function loadClassSelect() {
  // 只加载教学班，不加载行政班
  const teachingClasses = await api('/teaching_classes');

  const allClasses = teachingClasses.map(c => ({ ...c, type: 'teaching' }));
  window._classesData = allClasses; // 缓存数据供搜索使用

  const select = document.getElementById('select-class');
  select.innerHTML = '<option value="">选择教学班</option>' +
    teachingClasses.map(c => `<option value="${escapeHtml(c.id)}">${escapeHtml(c.id)} - ${escapeHtml(c.name)}</option>`).join('');

  // 初始化搜索
  initSearchFilter('search-class', 'select-class', allClasses, (item) => `${item.id} ${item.name}`);
}

// 加载教室选择框
async function loadRoomSelect() {
  const data = await api('/rooms');
  window._roomsData = data; // 缓存数据供搜索使用
  const select = document.getElementById('select-room');
  select.innerHTML = '<option value="">选择教室</option>' +
    data.map(r => `<option value="${escapeHtml(r.id)}">${escapeHtml(r.id)} - ${escapeHtml(r.name)}</option>`).join('');

  // 初始化搜索
  initSearchFilter('search-room', 'select-room', data, (item) => `${item.id} ${item.name}`);
}

// 初始化搜索过滤功能
function initSearchFilter(searchId, selectId, data, getSearchText, getOptionLabel = (item) => `${item.id} - ${item.name}`) {
  const searchInput = document.getElementById(searchId);
  const select = document.getElementById(selectId);

  if (!searchInput) return;

  // 移除旧的事件监听器
  searchInput.oninput = null;

  // 添加新的事件监听器
  searchInput.addEventListener('input', (e) => {
    const keyword = e.target.value.toLowerCase().trim();

    if (!keyword) {
      // 如果搜索框为空，显示所有选项
      select.innerHTML = '<option value="">请选择</option>' +
        data.map(item => `<option value="${escapeHtml(item.id)}">${escapeHtml(getOptionLabel(item))}</option>`).join('');
      return;
    }

    // 过滤匹配的数据
    const filtered = data.filter(item => {
      const searchText = getSearchText(item).toLowerCase();
      return searchText.includes(keyword);
    });

    // 更新下拉框选项
    select.innerHTML = '<option value="">选择匹配项</option>' +
      filtered.map(item => `<option value="${escapeHtml(item.id)}">${escapeHtml(getOptionLabel(item))}</option>`).join('');

    // 如果只有一个匹配项，自动选中
    if (filtered.length === 1) {
      select.value = filtered[0].id;
      // 触发 change 事件
      const event = new Event('change');
      select.dispatchEvent(event);
    }
  });

  // 添加回车键快捷选择
  searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const firstOption = select.querySelector('option:not(:first-child)');
      if (firstOption) {
        select.value = firstOption.value;
        const event = new Event('change');
        select.dispatchEvent(event);
        searchInput.value = '';
      }
    }
  });
}

// 通用实体搜索初始化函数
function initEntitySearch(searchId, data, renderFn, matchFn) {
  const searchInput = document.getElementById(searchId);
  if (!searchInput) return;

  // Use one replaceable handler so reloading a view does not stack filters.
  searchInput.oninput = (e) => {
    const keyword = e.target.value.toLowerCase().trim();

    if (!keyword) {
      renderFn(data);
      return;
    }

    // 过滤匹配的数据
    const filtered = data.filter(item => matchFn(item, keyword));
    renderFn(filtered);
  };
  if (searchInput.value.trim()) searchInput.oninput({ target: searchInput });
}

// 渲染课表
function renderTimetable(containerId, data) {
  const container = document.getElementById(containerId);
  if (!data || !data.rows || data.rows.length === 0) {
    container.innerHTML = '<div class="empty-state"><p>无排课结果</p></div>';
    return;
  }

  const days = ['周一', '周二', '周三', '周四', '周五'];
  let html = `
    <div class="table-container">
      <table class="timetable-table">
        <thead>
          <tr>
            <th>节次</th>
            ${days.map(d => `<th>${d}</th>`).join('')}
          </tr>
        </thead>
        <tbody>
  `;

  data.rows.forEach((row, index) => {
    html += `<tr><td>${row[0]}</td>`;
    for (let i = 1; i <= 5; i++) {
      const slot = row[i];
      if (slot) {
        html += `
          <td>
            <div class="slot">
              <div class="course">${getCourseName(slot)}</div>
              <div class="teacher">${getTeacherName(slot)}</div>
              <div class="room">${getRoomName(slot)}</div>
            </div>
          </td>
        `;
      } else {
        html += '<td></td>';
      }
    }
    html += '</tr>';
  });

  html += '</tbody></table></div>';
  container.innerHTML = html;
}

function entityActionButton(entity, id, action, label, styleClass) {
  return `<button class="btn ${styleClass} btn-sm" type="button"
    data-entity-action="${escapeHtml(action)}"
    data-entity="${escapeHtml(entity)}"
    data-entity-id="${safeDataAttribute(id)}">${escapeHtml(label)}</button>`;
}

function wireEntityActions(container) {
  container.querySelectorAll('[data-entity-action]').forEach(button => {
    button.addEventListener('click', () => {
      const { entityAction: action, entity, entityId: id } = button.dataset;
      if (action === 'edit') window.editEntity(entity, id);
      if (action === 'delete') window.deleteEntity(entity, id);
    });
  });
}

function positionScheduleOverlays(container) {
  const grid = container?.querySelector('.timetable-grid');
  if (!grid) return;
  const gridRect = grid.getBoundingClientRect();
  grid.querySelectorAll('.schedule-overlay').forEach(overlay => {
    const startSlot = overlay.dataset.overlayStartSlot;
    const endSlot = overlay.dataset.overlayEndSlot || startSlot;
    const startCell = grid.querySelector(`.slot-cell[data-slot-id="${startSlot}"]`);
    const endCell = grid.querySelector(`.slot-cell[data-slot-id="${endSlot}"]`);
    if (!startCell || !endCell) return;
    const startRect = startCell.getBoundingClientRect();
    const endRect = endCell.getBoundingClientRect();
    overlay.style.left = `${Math.round(startRect.left - gridRect.left + 3)}px`;
    overlay.style.top = `${Math.round(startRect.top - gridRect.top + 3)}px`;
    overlay.style.width = `${Math.max(0, Math.round(startRect.width - 6))}px`;
    overlay.style.height = `${Math.max(0, Math.round(endRect.bottom - startRect.top - 6))}px`;
    overlay.classList.add('is-positioned');
  });
}

function renderDetailedTimetable(containerId, data, title, subtitle, options = {}) {
  const container = document.getElementById(containerId);
  const compact = options.compact === true;
  const teacherDragEnabled = Boolean(options.teacherDrag && options.teacherId && !data?.stale);
  container.dataset.teacherDragEnabled = teacherDragEnabled ? 'true' : 'false';
  container.dataset.teacherId = teacherDragEnabled ? options.teacherId : '';
  if (!data || !data.rows || data.rows.length === 0) {
    container.innerHTML = '<div class="empty-state"><p>无排课结果</p></div>';
    return;
  }

  const days = ['周一', '周二', '周三', '周四', '周五'];
  const periods = [
    { id: 1, name: '第1节', session: '上午' },
    { id: 2, name: '第2节', session: '上午' },
    { id: 3, name: '第3节', session: '上午' },
    { id: 4, name: '第4节', session: '上午' },
    { id: 5, name: '第5节', session: '上午' },
    { id: 6, name: '第6节', session: '下午' },
    { id: 7, name: '第7节', session: '下午' },
    { id: 8, name: '第8节', session: '下午' },
    { id: 9, name: '第9节', session: '下午' },
    { id: 10, name: '第10节', session: '下午' },
  ];
  const overlays = Array.isArray(data.overlays) ? data.overlays : [];
  const overlaySlots = new Set(overlays.flatMap(overlay => overlay.slot_ids || []));

  let html = `
    <div class="timetable-detail${compact ? ' timetable-detail-compact' : ''}">
      ${compact ? '' : `
        <div class="timetable-header">
          <h3>${escapeHtml(title)}</h3>
          <p>${escapeHtml(subtitle)}</p>
          ${data.stale ? '<div class="validation-result warning">⚠️ 当前输入已修改：以下为上一版历史课表。请重新排课后再据此调整。</div>' : ''}
          ${teacherDragEnabled ? `
            <div class="teacher-drag-guide">
              拖动课程调整时段：<span class="move-guide">绿色可直接放入</span>
              <span class="swap-guide">蓝色可与现有课程安全互换</span>
              <span class="invalid-guide">红色表示存在冲突</span>
            </div>
          ` : ''}
        </div>
      `}
      <div class="timetable-grid">
        <div class="header-cell">节次</div>
        ${days.map(d => `<div class="header-cell">${d}</div>`).join('')}
  `;

  periods.forEach((period, index) => {
    const row = data.rows[index];
    html += `
      <div class="time-cell">
        <span class="period">${period.name}</span>
        <span class="session">${period.session}</span>
      </div>
    `;

    for (let day = 1; day <= 5; day++) {
      const slot = row ? row[day] : null;
      const slotId = `D${day}P${period.id}`;
      const hasOverlay = overlaySlots.has(slotId);
      const overlayClass = hasOverlay ? ' has-schedule-overlay' : '';
      const isWalkBlock = row && row[0] && row[0].includes('P') &&
        (row[0].includes('6') || row[0].includes('7') || row[0].includes('8'));

      if (slot) {
        const category = timetableCourseCategory(slot);
        if (slot.split_groups?.length) {
          const administrativeSplit = slot.split_groups.length > 1 &&
            slot.split_groups.every(group => group.class_type === 'admin');
          // A class-level split cell is a directory of simultaneous options,
          // not one common lesson.  Each student follows the one Section shown
          // in their own timetable.
          if (administrativeSplit) {
            // A teaching class can draw students from several administrative
            // classes.  Unlike AP/elective diversion, these are fixed class
            // lessons, so show each administrative class in its own vertical
            // lane instead of presenting them as a Section-choice list.
            const adminSummary = slot.split_groups
              .map(group => `${group.class_label || group.class_id || '行政班'}：${group.course}`)
              .join('；');
            html += compact ? `
              <div class="slot-cell has-class category-admin-required admin-split-cell compact-split-cell${overlayClass} ${isWalkBlock ? 'walk-block' : ''}"
                   data-slot-id="${slotId}" title="${escapeHtml(adminSummary)}">
                <div class="course-name">行政班课程（${slot.split_groups.length} 班）</div>
                <div class="compact-cell-meta">${escapeHtml(adminSummary)}</div>
              </div>
            ` : `
              <div class="slot-cell has-class category-admin-required admin-split-cell${overlayClass} ${isWalkBlock ? 'walk-block' : ''}"
                   data-slot-id="${slotId}">
                <div class="admin-split-lanes">
                  ${slot.split_groups.map(group => `
                    <div class="admin-split-lane">
                      <div class="admin-split-class">${escapeHtml(group.class_label || group.class_id || '行政班')}</div>
                      <div class="admin-split-course">${escapeHtml(group.course)}</div>
                      <div class="admin-split-meta">👨‍🏫 ${escapeHtml(group.teacher)} · ${escapeHtml(group.students)} 人</div>
                    </div>
                  `).join('')}
                </div>
              </div>
            `;
          } else {
            const splitSummary = slot.split_groups
              .map(group => `${group.course} · ${group.section_label || group.section_id} · ${group.students} 人`)
              .join('；');
            const splitCourseNames = [...new Set(slot.split_groups
              .map(group => group.course)
              .filter(Boolean))]
              .join(' / ');
            html += compact ? `
              <div class="slot-cell has-class category-${category} split-course-cell compact-split-cell${overlayClass} ${isWalkBlock ? 'walk-block' : ''}"
                   data-slot-id="${slotId}" title="${escapeHtml(splitSummary)}">
                <div class="compact-cell-meta compact-split-course-names">🧩 ${escapeHtml(splitCourseNames)}</div>
              </div>
            ` : `
              <div class="slot-cell has-class category-${category} split-course-cell${overlayClass} ${isWalkBlock ? 'walk-block' : ''}"
                   data-slot-id="${slotId}">
                <div class="course-name">🧩 ${escapeHtml(getCourseName(slot))}</div>
                <div class="split-course-hint">按个人课表前往对应 Section</div>
                <div class="split-course-list">
                  ${slot.split_groups.map(group => `
                    <div class="split-course-item">
                      <span>${escapeHtml(group.course)} · ${escapeHtml(group.section_label || group.section_id)}</span>
                      <span class="split-course-count">${escapeHtml(group.students)} 人</span>
                    </div>
                  `).join('')}
                </div>
              </div>
            `;
          }
        // 检查是否是教学班课表（包含行政班课程）
        } else if (slot.admin_courses && Object.keys(slot.admin_courses).length > 0) {
          // 教学班课表：显示行政班课程
          const adminCourseSummary = Object.entries(slot.admin_courses)
            .map(([classId, course]) => `${classId}：${course.course}`)
            .join('；');
          html += compact ? `
            <div class="slot-cell has-class category-${category} compact-split-cell${overlayClass} ${isWalkBlock ? 'walk-block' : ''}"
                 data-slot-id="${slotId}" title="${escapeHtml(adminCourseSummary)}">
              <div class="course-name">行政班课程</div>
              <div class="compact-cell-meta">${escapeHtml(adminCourseSummary)}</div>
            </div>
          ` : `
            <div class="slot-cell has-class category-${category}${overlayClass} ${isWalkBlock ? 'walk-block' : ''}"
                 data-slot-id="${slotId}">
              <div class="admin-courses">
                ${Object.entries(slot.admin_courses).map(([classId, course]) => `
                  <div class="admin-course-item">
                    <span class="class-label">${escapeHtml(classId)}:</span>
                    <span class="course-name">${escapeHtml(course.course)}</span>
                  </div>
                `).join('')}
              </div>
              ${slot.teaching_course ? `
                <div class="teaching-course">
                  <span class="course-name">${escapeHtml(slot.teaching_course.course)}</span>
                  <span class="teacher-name">👨‍🏫 ${escapeHtml(slot.teaching_course.teacher)}</span>
                </div>
              ` : ''}
              ${slot.elective_course ? `
                <div class="elective-course">
                  <span class="course-name">${escapeHtml(slot.elective_course.course)}</span>
                  <span class="teacher-name">👨‍🏫 ${escapeHtml(slot.elective_course.teacher)}</span>
                </div>
              ` : ''}
            </div>
          `;
        } else {
          // 其他课表：直接显示
          html += `
            <div class="slot-cell has-class category-${category}${overlayClass} ${isWalkBlock ? 'walk-block' : ''}"
                 draggable="${options.teacherDrag ? teacherDragEnabled : true}"
                 data-task-id="${safeDataAttribute(slot.task_id || '')}"
                 data-slot-id="${slotId}">
              <div class="course-name">
                ${escapeHtml(getCourseName(slot))}
                ${slot.course_type === 'ap' ? '<span class="course-badge ap">AP</span>' : ''}
              </div>
              ${slot.section_label ? `<div class="timetable-section-label">📍 ${escapeHtml(slot.section_label)}</div>` : ''}
              ${data.view_type === 'teacher' && slot.class_label ? `<div class="timetable-class-label">🏫 ${escapeHtml(slot.class_label)}</div>` : ''}
              ${compact ? '' : `<div class="teacher-name">👨‍🏫 ${escapeHtml(getTeacherName(slot))}</div>`}
              ${compact ? '' : `<div class="room-name">🚪 ${escapeHtml(getRoomName(slot))}</div>`}
            </div>
          `;
        }
      } else {
        html += `<div class="slot-cell${overlayClass}" data-slot-id="${slotId}"></div>`;
      }
    }
  });

  html += overlays.map(overlay => {
    const start = /^D([1-5])P([1-9]|10)$/.exec(overlay.slot_ids?.[0] || '');
    if (!start) return '';
    const duration = Math.max(1, overlay.slot_ids?.length || 1);
    const color = /^#[0-9a-f]{6}$/i.test(overlay.color || '') ? overlay.color : '#7e57c2';
    return `
      <div class="schedule-overlay kind-${escapeHtml(overlay.kind)}"
           data-overlay-start-slot="${escapeHtml(overlay.slot_ids[0])}"
           data-overlay-end-slot="${escapeHtml(overlay.slot_ids[duration - 1])}"
           style="--schedule-overlay-color:${color};">
        <div class="schedule-overlay-title">${escapeHtml(overlay.title)}</div>
        <div class="schedule-overlay-meta">${overlay.kind === 'self_study' ? '自习' : `特殊事件 · ${duration} 节`}</div>
        ${options.editorMode ? `<button type="button" class="schedule-overlay-remove" data-schedule-overlay-id="${escapeHtml(overlay.id)}" aria-label="删除${escapeHtml(overlay.title)}">×</button>` : ''}
      </div>
    `;
  }).join('');

  html += '</div></div>';
  container.innerHTML = html;
  positionScheduleOverlays(container);
}

// 加载总课表概览
async function loadOverviewTimetable() {
  const content = document.getElementById('overview-timetable-content');
  const grade = document.getElementById('select-grade').value;
  const viewType = document.getElementById('select-view-type').value;

  try {
    applyScheduleArchiveStatus(await api('/status'));
  } catch (error) {
    window._scheduleArchiveAvailable = false;
    syncScheduleArchiveControls();
    setScheduleArchiveStatus(`无法确认当前课表状态：${error.message}`, 'error');
  }

  try {
    // 获取班级或教师
    let items = [];
    if (viewType === 'class') {
      // 只显示教学班，不显示行政班
      const teachingClasses = await api('/teaching_classes');
      items = teachingClasses;
      if (grade !== 'all') {
        items = items.filter(c => c.grade === parseInt(grade));
      }
    } else {
      items = await api('/teachers');
    }

    if (items.length === 0) {
      content.innerHTML = '<div class="empty-state"><p>暂无数据</p></div>';
      return;
    }

    // 为每个班级/教师加载课表
    const timetables = await Promise.all(
      items.map(async (item) => {
        try {
          const data = await api(`/timetable/${viewType}/${item.id}`);
          return { id: item.id, name: item.name, data };
        } catch {
          return { id: item.id, name: item.name, data: null };
        }
      })
    );

    // 渲染概览网格
    const legend = viewType === 'class' ? `
      <div class="overview-course-legend" aria-label="课程颜色说明">
        ${['admin-required', 'teaching-required', 'ap', 'elective', 'other'].map(category => `
          <span class="overview-course-legend-item category-${category}"><i></i>${timetableCourseCategoryLabel(category)}</span>
        `).join('')}
      </div>
    ` : '';
    let html = `${legend}<div class="overview-grid">`;
    timetables.forEach(({ id, name, data }) => {
      html += `
        <div class="overview-card" role="button" tabindex="0"
             data-overview-type="${viewType}"
             data-overview-id="${encodeURIComponent(id)}"
             data-overview-name="${encodeURIComponent(name || '')}"
             aria-label="查看${safeDataAttribute(name)}的完整课表">
          <div class="overview-card-header">
            <h4>${escapeHtml(name)}</h4>
            <span class="badge">${escapeHtml(id)}</span>
          </div>
          <div class="overview-card-body">
            ${renderMiniTimetable(data)}
          </div>
          <div class="overview-card-action">查看完整课表 <span aria-hidden="true">→</span></div>
        </div>
      `;
    });
    html += '</div>';

    content.innerHTML = html;
    content.querySelectorAll('.overview-card[data-overview-id]').forEach(card => {
      const openTimetable = () => window.viewDetailedTimetable(
        card.dataset.overviewType,
        decodeURIComponent(card.dataset.overviewId),
        decodeURIComponent(card.dataset.overviewName),
      );
      card.addEventListener('click', openTimetable);
      card.addEventListener('keydown', event => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          openTimetable();
        }
      });
    });
  } catch (error) {
    content.innerHTML = `<div class="empty-state"><p>加载失败: ${error.message}</p></div>`;
  }
}

// 渲染迷你课表
function renderMiniTimetable(data) {
  if (!data || !data.rows || data.rows.length === 0) {
    return '<div style="text-align: center; color: var(--gray-500); padding: 20px;">无排课</div>';
  }

  const days = ['一', '二', '三', '四', '五'];
  let html = '<table class="overview-mini-timetable"><thead><tr><th>节</th>';
  days.forEach(d => html += `<th>${d}</th>`);
  html += '</tr></thead><tbody>';

  data.rows.forEach((row, index) => {
    html += `<tr><td>${index + 1}</td>`;
    for (let i = 1; i <= 5; i++) {
      const slot = row[i];
      if (slot) {
        const category = timetableCourseCategory(slot);
        html += `<td class="slot-filled category-${category}" title="${escapeHtml(timetableCourseCategoryLabel(category))}">${escapeHtml(getCourseName(slot))}</td>`;
      } else {
        html += `<td class="slot-empty">-</td>`;
      }
    }
    html += '</tr>';
  });

  html += '</tbody></table>';
  return html;
}

// 编辑实体（全局函数，供 onclick 调用）
window.editEntity = async function(entity, id) {
  try {
    // 获取实体数据
    const data = await api(`/${entity}`);
    const item = data.find(d => d.id === id);

    if (!item) {
      showToast(`未找到 ${id}`, 'error');
      return;
    }

    // 根据实体类型显示不同的编辑表单
    let formHtml = '';
    let title = '';

    switch (entity) {
      case 'teachers':
        title = '编辑教师';
        // 确保课程数据已加载
        if (!window._coursesData) {
          window._coursesData = await api('/courses');
        }
        formHtml = `
          <form id="form-edit-teacher">
            <div class="form-group">
              <label>ID</label>
              <input type="text" name="id" value="${item.id}" readonly style="background-color: var(--gray-100);">
            </div>
            <div class="form-group">
              <label>中文姓名</label>
              <input type="text" name="name" value="${item.name}" required>
            </div>
            <div class="form-group">
              <label>可教课程</label>
              ${renderCourseSelector(item.can_teach)}
            </div>
            <div class="form-group">
              <label>考试分组</label>
              <select name="exam_staff_group">
                ${examStaffGroupOptions(item.exam_staff_group || 'ansheng')}
              </select>
              <small>安生教师中除升学顾问外参加监考；其他教师仍可巡考自己实际教授的科目。</small>
            </div>
            <div class="form-group">
              <label>每天上限</label>
              <input type="number" name="max_per_day" value="${item.max_per_day}">
            </div>
            <div class="form-group">
              <label>每周上限</label>
              <input type="number" name="max_per_week" value="${item.max_per_week}">
            </div>
            <div class="form-actions">
              <button type="button" class="btn btn-secondary" onclick="hideModal()">取消</button>
              <button type="submit" class="btn btn-primary">保存</button>
            </div>
          </form>
        `;
        break;

      case 'rooms':
        title = '编辑教室';
        formHtml = `
          <form id="form-edit-room">
            <div class="form-group">
              <label>ID</label>
              <input type="text" name="id" value="${item.id}" readonly style="background-color: var(--gray-100);">
            </div>
            <div class="form-group">
              <label>名称</label>
              <input type="text" name="name" value="${item.name}" required>
            </div>
            <div class="form-group">
              <label>类型</label>
              <select name="type">
                <option value="general" ${item.type === 'general' ? 'selected' : ''}>普通</option>
                <option value="physics" ${item.type === 'physics' ? 'selected' : ''}>物理</option>
                <option value="chemistry" ${item.type === 'chemistry' ? 'selected' : ''}>化学</option>
                <option value="biology" ${item.type === 'biology' ? 'selected' : ''}>生物</option>
                <option value="computer" ${item.type === 'computer' ? 'selected' : ''}>计算机</option>
                <option value="art" ${item.type === 'art' ? 'selected' : ''}>美术</option>
                <option value="music" ${item.type === 'music' ? 'selected' : ''}>音乐</option>
              </select>
            </div>
            <div class="form-group">
              <label>容量</label>
              <input type="number" name="capacity" value="${item.capacity}">
            </div>
            <div class="form-actions">
              <button type="button" class="btn btn-secondary" onclick="hideModal()">取消</button>
              <button type="submit" class="btn btn-primary">保存</button>
            </div>
          </form>
        `;
        break;

      case 'courses':
        title = '编辑课程';
        if (!window._adminClassesData || !window._teachingClassesData || !window._teachingAssignmentsData) {
          [window._adminClassesData, window._teachingClassesData, window._teachingAssignmentsData] = await Promise.all([
            api('/admin_classes'),
            api('/teaching_classes'),
            api('/teaching_assignments'),
          ]);
        }
        formHtml = `
          <form id="form-edit-course">
            <div class="form-group">
              <label>ID</label>
              <input type="text" name="id" value="${item.id}" readonly style="background-color: var(--gray-100);">
            </div>
            <div class="form-group">
              <label>名称</label>
              <input type="text" name="name" value="${item.name}" required>
            </div>
            <div class="form-group">
              <label>类型</label>
              <select name="type">
                <option value="required" ${item.type === 'required' ? 'selected' : ''}>必修</option>
                <option value="ap" ${item.type === 'ap' ? 'selected' : ''}>AP选修</option>
                <option value="required_elective" ${item.type === 'required_elective' ? 'selected' : ''}>必修选修</option>
                <option value="other" ${item.type === 'other' ? 'selected' : ''}>活动/其他</option>
              </select>
            </div>
            <div class="form-group">
              <label>适用年级</label>
              ${renderCourseGradeOptions(item)}
            </div>
            <div class="form-group">
              <label>上课组织方式</label>
              ${renderCourseDeliveryOptions(item)}
            </div>
            <div class="form-group" data-high-two-class-scope>
              <label>适用班级（Senior 2）</label>
              ${renderCourseClassOptions(item)}
            </div>
            <div class="form-group">
              <label>每周课时</label>
              <input type="number" name="weekly_hours" value="${item.weekly_hours}">
            </div>
            <div class="form-group">
              <label>需要的教室类型（AP课用）</label>
              <input type="text" name="required_room_type" value="${item.required_room_type || ''}">
            </div>
            <div class="form-actions">
              <button type="button" class="btn btn-secondary" onclick="hideModal()">取消</button>
              <button type="submit" class="btn btn-primary">保存</button>
            </div>
          </form>
        `;
        break;

      case 'students':
        title = '编辑学生';
        formHtml = `
          <form id="form-edit-student">
            <div class="form-group">
              <label>ID</label>
              <input type="text" name="id" value="${item.id}" readonly style="background-color: var(--gray-100);">
            </div>
            <div class="form-group">
              <label>中文姓名</label>
              <input type="text" name="name" value="${item.name}" required>
            </div>
            <div class="form-group">
              <label>英文名</label>
              <input type="text" name="english_name" value="${item.english_name || ''}" placeholder="用于区分中文重名学生">
            </div>
            <div class="form-group">
              <label>年级</label>
              <select name="grade">
                <option value="10" ${item.grade === 10 ? 'selected' : ''}>高一</option>
                <option value="11" ${item.grade === 11 ? 'selected' : ''}>高二</option>
                <option value="12" ${item.grade === 12 ? 'selected' : ''}>高三</option>
              </select>
            </div>
            <div class="form-group">
              <label>行政班ID</label>
              <input type="text" name="admin_class_id" value="${item.admin_class_id}" required>
            </div>
            <div class="form-group">
              <label>教学班ID</label>
              <input type="text" name="teaching_class_id" value="${item.teaching_class_id}" required>
            </div>
            <div class="form-actions">
              <button type="button" class="btn btn-secondary" onclick="hideModal()">取消</button>
              <button type="submit" class="btn btn-primary">保存</button>
            </div>
          </form>
        `;
        break;

      case 'admin_classes':
        title = '编辑行政班';
        formHtml = `
          <form id="form-edit-admin-class">
            <div class="form-group">
              <label>ID</label>
              <input type="text" name="id" value="${item.id}" readonly style="background-color: var(--gray-100);">
            </div>
            <div class="form-group">
              <label>名称</label>
              <input type="text" name="name" value="${item.name}" required>
            </div>
            <div class="form-group">
              <label>年级</label>
              <select name="grade">
                <option value="1" ${item.grade === 1 ? 'selected' : ''}>高一</option>
                <option value="2" ${item.grade === 2 ? 'selected' : ''}>高二</option>
                <option value="3" ${item.grade === 3 ? 'selected' : ''}>高三</option>
              </select>
            </div>
            <div class="form-group">
              <label>固定教室ID</label>
              <input type="text" name="fixed_room_id" value="${item.fixed_room_id || ''}">
            </div>
            <div class="form-actions">
              <button type="button" class="btn btn-secondary" onclick="hideModal()">取消</button>
              <button type="submit" class="btn btn-primary">保存</button>
            </div>
          </form>
        `;
        break;

      case 'teaching_classes':
        title = '编辑教学班';
        formHtml = `
          <form id="form-edit-teaching-class">
            <div class="form-group">
              <label>ID</label>
              <input type="text" name="id" value="${item.id}" readonly style="background-color: var(--gray-100);">
            </div>
            <div class="form-group">
              <label>名称</label>
              <input type="text" name="name" value="${item.name}" required>
            </div>
            <div class="form-group">
              <label>年级</label>
              <select name="grade">
                <option value="1" ${item.grade === 1 ? 'selected' : ''}>高一</option>
                <option value="2" ${item.grade === 2 ? 'selected' : ''}>高二</option>
                <option value="3" ${item.grade === 3 ? 'selected' : ''}>高三</option>
              </select>
            </div>
            <div class="form-group">
              <label>固定教室ID</label>
              <input type="text" name="fixed_room_id" value="${item.fixed_room_id || ''}">
            </div>
            <div class="form-actions">
              <button type="button" class="btn btn-secondary" onclick="hideModal()">取消</button>
              <button type="submit" class="btn btn-primary">保存</button>
            </div>
          </form>
        `;
        break;

      default:
        showToast(`不支持编辑 ${entity}`, 'error');
        return;
    }

    // 显示模态框
    showModal(title, formHtml);
    const form = document.querySelector(`form[id^="form-edit-"]`);

    // 添加下拉框事件监听（教师编辑页面）
    if (entity === 'teachers') {
      const courseSelect = document.getElementById('course-select');
      if (courseSelect) {
        courseSelect.addEventListener('change', (e) => {
          addCourse(e.target.value);
        });
      }
    }
    if (entity === 'courses') {
      form.querySelectorAll('input[name="grade_scope"]').forEach(input => {
        input.addEventListener('change', () => {
          syncCourseDeliveryEditor(form);
          syncCourseClassEditor(form);
        });
      });
      form.querySelectorAll('[name^="delivery_class_type_"]').forEach(input => {
        input.addEventListener('change', () => syncCourseClassEditor(form));
      });
      form.querySelector('[name="type"]')?.addEventListener('change', () => {
        syncCourseDeliveryEditor(form);
        syncCourseClassEditor(form);
      });
      syncCourseDeliveryEditor(form);
      syncCourseClassEditor(form);
    }

    // 添加表单提交事件
    if (form) {
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const formData = new FormData(form);
        const updateData = {};

        // 处理表单数据
        for (const [key, value] of formData.entries()) {
          if (key === 'id') continue; // 跳过 ID 字段

          // 特殊处理 can_teach（复选框）
          if (key === 'can_teach' || key === 'grade_scope' || key === 'class_scope' || key.startsWith('delivery_class_type_')) {
            // 跳过，后面单独处理
            continue;
          } else if (key === 'grade' || key === 'max_per_day' || key === 'max_per_week' || key === 'weekly_hours' || key === 'capacity') {
            updateData[key] = parseInt(value);
          } else if (key === 'prefer_morning') {
            updateData[key] = value === 'true' || value === 'on';
          } else {
            updateData[key] = value;
          }
        }

        // 单独处理 can_teach（复选框多选）
        if (entity === 'teachers') {
          updateData.can_teach = formData.getAll('can_teach');
        }
        if (entity === 'courses') {
          const grades = formData.getAll('grade_scope').map(Number);
          if (!grades.length) {
            showToast('请至少选择一个适用年级', 'error');
            return;
          }
          updateData.grade = grades.length === 1 ? grades[0] : grades;
          updateData.delivery_class_type_by_grade = courseDeliveryMapFromForm(
            formData,
            grades,
            formData.get('type'),
          );
          if (grades.includes(11) && updateData.delivery_class_type_by_grade?.[11] === 'teaching') {
            const classIds = formData.getAll('class_scope');
            if (!classIds.length) {
              showToast('Senior 2 课程请至少选择一个适用教学班', 'error');
              return;
            }
            updateData.applicable_class_ids = classIds;
          } else {
            updateData.applicable_class_ids = null;
          }
        }

        try {
          await api(`/${entity}/${id}`, {
            method: 'PUT',
            body: JSON.stringify(updateData)
          });
          hideModal();
          showToast('保存成功', 'success');
          loadViewData(getCurrentView());
        } catch (error) {
          showToast(error.message, 'error');
        }
      });
    }
  } catch (error) {
    showToast(error.message, 'error');
  }
};

// 删除实体
window.deleteEntity = async function(entity, id) {
  try {
    const encodedEntity = encodeURIComponent(entity);
    const encodedId = encodeURIComponent(id);
    const dependencies = await api(`/entity-dependencies/${encodedEntity}/${encodedId}`);
    let cascade = false;
    if (dependencies.length) {
      const summary = dependencies
        .map(item => `${item.label} ${item.count} 项`)
        .join('、');
      cascade = confirm(
        `${id} 仍被以下数据引用：${summary}。\n\n继续删除会同步清理这些引用，并使当前课表失效。确定级联删除吗？`,
      );
      if (!cascade) return;
    } else if (!confirm(`确定要删除 ${id} 吗？`)) {
      return;
    }
    await api(`/${encodedEntity}/${encodedId}${cascade ? '?cascade=true' : ''}`, { method: 'DELETE' });
    showToast(cascade ? '已删除并清理相关引用' : '删除成功');
    await loadViewData(getCurrentView());
  } catch (error) {
    showToast(error.message || '删除失败', 'error');
  }
};

// 查看详细课表（供总课表概览卡片调用）
window.viewDetailedTimetable = async function(type, id, name) {
  // Wait for the destination selector to populate before selecting the card's
  // item. Previously this raced loadClassSelect(), opening an empty page.
  await switchView(`${type}-timetable`);
  const select = document.getElementById(`select-${type}`);
  if (!select) throw new Error(`未找到${type}课表选择器`);
  select.value = id;
  const data = await api(`/timetable/${type}/${id}`);
  const subject = type === 'class' ? '班级' : type === 'teacher' ? '教师' : type;
  renderDetailedTimetable(
    `${type}-timetable-content`,
    data,
    `${name || id} 的课表`,
    `${subject}ID: ${id}`,
  );
  document.getElementById(`${type}-timetable-content`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
};

// 加载 AI 助手
async function loadAIAssistant() {
  // 加载教学任务列表
  const tasks = await api('/teaching_tasks');
  const courses = await api('/courses');
  const teachers = await api('/teachers');

  const select = document.getElementById('ai-task-select');
  select.innerHTML = '<option value="">选择教学任务</option>' +
    tasks.map(t => {
      const course = courses.find(c => c.id === t.course_id);
      const teacher = teachers.find(te => te.id === t.teacher_id);
      return `<option value="${t.id}">${course?.name || t.course_id} - ${teacher?.name || t.teacher_id} (${t.student_ids?.length || 0}人)</option>`;
    }).join('');

  // 更新统计
  const state = await api('/status');
  document.getElementById('stat-locks').textContent = '0'; // 需要从实际数据获取
}

// 解析自然语言偏好
async function parsePreference() {
  const input = document.getElementById('ai-preference-input');
  const resultDiv = document.getElementById('preference-result');
  const text = input.value.trim();

  if (!text) {
    showToast('请输入偏好描述', 'warning');
    return;
  }

  try {
    resultDiv.innerHTML = '<div class="loading">解析中...</div>';
    const data = await api('/ai/parse-preference', {
      method: 'POST',
      body: JSON.stringify({ text })
    });

    // 显示解析结果
    let html = '<div style="margin-bottom: 12px;"><strong>识别的偏好：</strong></div>';
    data.parsed_preferences.forEach(pref => {
      html += `<span class="preference-tag">${pref.description}</span>`;
    });

    if (data.suggested_actions.length > 0) {
      html += '<div style="margin-top: 16px;"><strong>建议操作：</strong></div>';
      data.suggested_actions.forEach(action => {
        html += `
          <div class="action-item">
            <div class="action-desc">${action.description}</div>
          </div>
        `;
      });
    }

    resultDiv.innerHTML = html;
  } catch (error) {
    resultDiv.innerHTML = `<div style="color: var(--danger);">解析失败: ${error.message}</div>`;
  }
}

// 获取智能排课建议
async function getAISuggestions() {
  const taskSelect = document.getElementById('ai-task-select');
  const resultDiv = document.getElementById('suggestions-result');
  const taskId = taskSelect.value;

  if (!taskId) {
    showToast('请选择教学任务', 'warning');
    return;
  }

  try {
    resultDiv.innerHTML = '<div class="loading">获取建议中...</div>';
    const data = await api('/ai/suggest', {
      method: 'POST',
      body: JSON.stringify({ task_id: taskId })
    });

    let html = `
      <div style="margin-bottom: 12px;">
        <strong>${data.task_info.course}</strong> - ${data.task_info.teacher}
        <span style="color: var(--gray-500);">(${data.task_info.student_count}人, 每周${data.task_info.weekly_hours}节)</span>
      </div>
      <div style="margin-bottom: 8px;">可用时段: ${data.total_available}个</div>
    `;

    if (data.suggestions.length > 0) {
      data.suggestions.forEach(suggestion => {
        const dayNames = ['', '周一', '周二', '周三', '周四', '周五'];
        html += `
          <div class="suggestion-item" onclick="applySuggestion('${taskId}', '${suggestion.slot_id}')">
            <div class="slot-info">${dayNames[suggestion.day]} 第${suggestion.period}节</div>
            <div class="reason">${suggestion.reason}</div>
            <span class="score">推荐度: ${suggestion.score}</span>
          </div>
        `;
      });
    } else {
      html += '<div style="color: var(--gray-500);">暂无可用时段建议</div>';
    }

    resultDiv.innerHTML = html;
  } catch (error) {
    resultDiv.innerHTML = `<div style="color: var(--danger);">获取建议失败: ${error.message}</div>`;
  }
}

// 应用建议（需要先解锁已锁定的时段）
async function applySuggestion(taskId, slotId) {
  if (!confirm(`确定要将任务 ${taskId} 安排到时段 ${slotId} 吗？`)) {
    return;
  }

  try {
    // 这里可以添加实际的排课逻辑
    showToast(`已选择时段 ${slotId}，请手动调整排课`, 'info');
  } catch (error) {
    showToast(error.message, 'error');
  }
}

// ==================== AI 智能求解功能 ====================

let currentSolutions = [];
let selectedSolutionId = null;

// AI 求解
async function aiSolve() {
  const input = document.getElementById('ai-preference-input');
  const parseResult = document.getElementById('ai-parse-result');
  const solutionsSection = document.getElementById('ai-solutions-section');
  const text = input.value.trim();

  if (!text) {
    showToast('请输入排课需求', 'warning');
    return;
  }

  try {
    showToast('🤖 AI正在理解你的需求...', 'info');
    parseResult.classList.remove('hidden');
    parseResult.innerHTML = '<div class="loading">正在解析需求并生成排课方案...</div>';

    const result = await api('/ai/solve', {
      method: 'POST',
      body: JSON.stringify({ text }),
    });

    // 显示 AI 响应
    const aiResponse = result.ai_response;
    let parseHtml = '<div style="margin-bottom: 12px;"><strong>🎯 AI 响应：</strong></div>';

    if (aiResponse.action === 'schedule') {
      // 显示排课方案
      parseHtml += `
        <div style="background: var(--gray-100); padding: 12px; border-radius: var(--radius); margin-bottom: 12px;">
          <div><strong>排课方案</strong></div>
          <div>年级: ${aiResponse.grade || '未指定'}</div>
          <div>任务数: ${aiResponse.tasks?.length || 0}</div>
          <div>总课时: ${aiResponse.summary?.total_hours || 0}</div>
        </div>
      `;

      // 显示任务列表
      if (aiResponse.tasks && aiResponse.tasks.length > 0) {
        parseHtml += '<div style="margin-bottom: 12px;"><strong>教学任务：</strong></div>';
        parseHtml += '<div style="max-height: 300px; overflow-y: auto;">';
        aiResponse.tasks.forEach(task => {
          parseHtml += `
            <div style="padding: 8px; border: 1px solid var(--gray-200); margin-bottom: 4px; border-radius: var(--radius);">
              <div><strong>${task.course_id}</strong> - ${task.class_id}</div>
              <div style="font-size: 12px; color: var(--gray-500);">
                ${task.weekly_hours}节/周 | ${task.assignments?.length || 0} 个时段已分配
              </div>
            </div>
          `;
        });
        parseHtml += '</div>';
      }

      // 添加执行按钮
      parseHtml += `
        <div style="margin-top: 16px;">
          <button class="btn btn-primary" onclick="executeSchedule()">执行排课</button>
          <button class="btn btn-secondary" onclick="viewScheduleDetails()">查看详情</button>
        </div>
      `;
    } else {
      // 显示文本响应
      parseHtml += `<div style="background: var(--gray-100); padding: 12px; border-radius: var(--radius);">${aiResponse.message || result.message}</div>`;
    }

    parseResult.innerHTML = parseHtml;

    // 如果有排课方案，显示成功消息
    if (aiResponse.action === 'schedule') {
      showToast(`✅ 已生成排课方案`, 'success');
    } else {
      showToast(result.message || '请提供更具体的排课需求', 'info');
    }
  } catch (error) {
    parseResult.innerHTML = `<div style="color: var(--danger);">求解失败: ${error.message}</div>`;
    showToast(error.message, 'error');
  }
}

// A protected soft rule is never waived as a side effect of clicking solve.
// The second request is sent only after the operator explicitly confirms the
// exact rule ids the first attempt could not preserve.
async function solveWithRequiredApproval(body = {}, endpoint = '/solve') {
  const requestBody = { ...body };
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const result = await api(endpoint, {
      method: 'POST',
      body: JSON.stringify(requestBody),
    });
    if (result.solved) return result;
    const blocked = result.blocked_by || [];
    const labels = blocked
      .map(rule => `${rule.name || rule.id}（${rule.id}，${rule.scope}/${rule.type}）`)
      .join('\n');
    if (result.status === 'NEEDS_APPROVAL_TO_RELAX') {
      const confirmed = confirm(`在不破坏以下受保护软规则的前提下无法排课：\n${labels}\n\n${result.diagnostic || ''}\n\n是否明确批准本次排课放宽这些规则？`);
      if (!confirmed) return result;
      requestBody.approved_rule_relaxations = blocked.map(rule => rule.id);
      continue;
    }
    if (result.status === 'NEEDS_APPROVAL_TO_DEFER_HARD_RULE') {
      const confirmed = confirm(`严格遵守以下硬规则时无法生成课表：\n${labels}\n\n${result.diagnostic || ''}\n\n警告：批准后这些规则将仅作为质量目标，课表会标记为“待复核”，不能视为正式发布。是否批准本次降级？`);
      if (!confirmed) return result;
      requestBody.approved_hard_rule_relaxations = blocked.map(rule => rule.id);
      continue;
    }
    return result;
  }
  throw new Error('规则审批后仍未得到稳定的排课结果，请检查规则配置');
}

// 执行排课
async function executeSchedule() {
  if (!confirm('确定要执行排课吗？这将覆盖当前的排课结果。')) {
    return;
  }

  try {
    showToast('正在执行排课...', 'info');

    // 调用分班引擎
    const sectionResult = await api('/solve-sections', { method: 'POST' });

    // 调用排课引擎
    const solveResult = await solveWithRequiredApproval();
    if (!solveResult.solved) {
      showToast(solveResult.reason || '未生成课表；未自动放宽受保护规则', 'warning');
      return;
    }

    showToast('✅ 排课完成！', 'success');

    // 刷新页面
    loadViewData(getCurrentView());
  } catch (error) {
    showToast('排课失败: ' + error.message, 'error');
  }
}

// 查看排课详情
function viewScheduleDetails() {
  // 切换到分班管理页面
  switchView('sectioning');
}

// 格式化约束显示
function formatConstraint(constraint) {
  switch (constraint.type) {
    case 'spread':
      return `${constraint.course_id} 每天最多 ${constraint.max_per_day || 1} 节`;
    case 'prefer_morning':
      return `${constraint.course_id} 优先上午`;
    case 'forbidden':
      return `禁排时段: ${constraint.slots?.join(', ') || '未指定'}`;
    case 'teacher_forbidden':
      return `教师 ${constraint.teacher_id} 周${constraint.days?.join(', ')} 不排课`;
    case 'prefer_walk_blocks':
      return 'AP课程优先走班时段';
    case 'consecutive':
      return `${constraint.course_id} 连续 ${constraint.min}-${constraint.max} 节`;
    case 'max_per_day':
      return `每天最多 ${constraint.value} 节课`;
    default:
      return JSON.stringify(constraint);
  }
}

// 渲染解的列表
function renderSolutions() {
  const container = document.getElementById('ai-solutions-list');
  const days = ['', '周一', '周二', '周三', '周四', '周五'];

  container.innerHTML = currentSolutions.map(solution => {
    // 统计每个课程的分布
    const courseDistribution = {};
    solution.assignments.forEach(a => {
      const task = a.task_id;
      if (!courseDistribution[task]) {
        courseDistribution[task] = [];
      }
      const day = a.slot_id.charAt(1);
      const period = a.slot_id.substring(3);
      courseDistribution[task].push(`${days[day]}第${period}节`);
    });

    return `
      <div class="solution-card ${selectedSolutionId === solution.id ? 'selected' : ''}"
           onclick="selectSolution(${solution.id})">
        <h4>
          方案 ${solution.id}
          <span class="score">得分: ${solution.score}</span>
        </h4>
        <div class="details">
          <div>📊 排课数量: ${solution.assignments.length} 节</div>
          <div>✅ 硬约束违规: ${solution.details.hard_violations} 个</div>
          <div>⭐ 约束满足度: ${solution.details.constraint_satisfaction} 分</div>
          <div style="margin-top: 8px; font-size: 12px; color: var(--gray-500);">
            点击选择此方案
          </div>
        </div>
      </div>
    `;
  }).join('');
}

// 选择解
function selectSolution(id) {
  selectedSolutionId = id;
  renderSolutions();
}

// 重新生成解
async function regenerateSolutions() {
  await aiSolve();
}

// 应用选中的解
async function applySelectedSolution() {
  if (!selectedSolutionId) {
    showToast('请先选择一个方案', 'warning');
    return;
  }

  const solution = currentSolutions.find(s => s.id === selectedSolutionId);
  if (!solution) {
    showToast('选中的方案无效', 'error');
    return;
  }

  if (!confirm(`确定要应用方案 ${selectedSolutionId} 吗？这将覆盖当前的排课结果。`)) {
    return;
  }

  try {
    showToast('正在应用方案...', 'info');

    // 调用 API 更新排课结果
    const response = await fetch('/api/ai/apply-solution', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        assignments: solution.assignments,
        seed: solution.seed
      })
    });

    const result = await response.json();

    if (!result.ok) {
      throw new Error(result.errors?.[0]?.msg || '应用失败');
    }

    showToast(`✅ 方案 ${selectedSolutionId} 已应用`, 'success');

    // 刷新课表
    loadViewData(getCurrentView());
  } catch (error) {
    showToast(error.message, 'error');
  }
}

// 使用示例
window.useExample = function(element) {
  const text = element.textContent.replace(/^.*?：/, '').trim();
  document.getElementById('ai-preference-input').value = text;
};

// 拖拽调课功能
let draggedTask = null;
let draggedFromSlot = null;
let draggedScheduleTemplate = null;
let draggedTeacherId = null;
let draggedTeacherContainer = null;
let teacherDropCandidates = new Map();
let teacherCandidateRequestId = 0;

function clearTimetableDragState() {
  document.querySelectorAll('.slot-cell.dragging, .schedule-editor-tool.dragging').forEach(element => {
    element.classList.remove('dragging');
  });
  document.querySelectorAll('.slot-cell.drag-over, .slot-cell.teacher-move-candidate, .slot-cell.teacher-swap-candidate, .slot-cell.teacher-invalid-candidate').forEach(element => {
    element.classList.remove('drag-over', 'teacher-move-candidate', 'teacher-swap-candidate', 'teacher-invalid-candidate');
    delete element.dataset.teacherDropAction;
  });
  document.querySelectorAll('.teacher-drag-active, .teacher-drag-loading').forEach(element => {
    element.classList.remove('teacher-drag-active', 'teacher-drag-loading');
  });
  teacherCandidateRequestId += 1;
  draggedTask = null;
  draggedFromSlot = null;
  draggedScheduleTemplate = null;
  draggedTeacherId = null;
  draggedTeacherContainer = null;
  teacherDropCandidates = new Map();
}

async function loadTeacherDropCandidates() {
  const requestId = ++teacherCandidateRequestId;
  const teacherId = draggedTeacherId;
  const taskId = draggedTask;
  const fromSlot = draggedFromSlot;
  const container = draggedTeacherContainer;
  if (!teacherId || !taskId || !fromSlot || !container) return;
  container.classList.add('teacher-drag-active', 'teacher-drag-loading');
  try {
    const result = await api('/teacher-timetable/drag-candidates', {
      method: 'POST',
      body: JSON.stringify({ teacher_id: teacherId, task_id: taskId, from_slot: fromSlot }),
    });
    if (requestId !== teacherCandidateRequestId || container !== draggedTeacherContainer) return;
    teacherDropCandidates = new Map((result.candidates || []).map(candidate => [candidate.slot_id, candidate]));
    container.querySelectorAll('.slot-cell[data-slot-id]').forEach(cell => {
      if (cell.dataset.slotId !== fromSlot) cell.classList.add('teacher-invalid-candidate');
    });
    for (const [slotId, candidate] of teacherDropCandidates) {
      const cell = container.querySelector(`.slot-cell[data-slot-id="${slotId}"]`);
      if (!cell) continue;
      cell.classList.remove('teacher-invalid-candidate');
      cell.classList.add(candidate.action === 'swap' ? 'teacher-swap-candidate' : 'teacher-move-candidate');
      cell.dataset.teacherDropAction = candidate.action;
    }
  } catch {
    // api() already presents the backend reason. The course remains in place.
  } finally {
    if (requestId === teacherCandidateRequestId) container.classList.remove('teacher-drag-loading');
  }
}

function scheduleEditorTemplateFromCard(card) {
  const kind = card.dataset.scheduleTemplate;
  if (kind === 'self_study') return { kind, title: '自习', duration: 1 };
  if (kind !== 'special_event') return null;
  const title = document.getElementById('schedule-editor-event-title')?.value.trim() || '';
  const duration = Number(document.getElementById('schedule-editor-event-duration')?.value || 0);
  const color = document.getElementById('schedule-editor-event-color')?.value || '#7e57c2';
  if (!title) throw new Error('请先填写特殊事件名称');
  if (!Number.isInteger(duration) || duration < 1 || duration > 10) {
    throw new Error('特殊事件的连续节数必须在 1 到 10 之间');
  }
  return { kind, title, duration, color };
}

function canDropOnTimetableSlot(slotCell) {
  if (!slotCell) return false;
  if (draggedScheduleTemplate) return Boolean(slotCell.closest('#view-schedule-editor'));
  if (draggedTeacherId) return teacherDropCandidates.has(slotCell.dataset.slotId);
  if (slotCell.classList.contains('has-class') || slotCell.classList.contains('has-schedule-overlay')) return false;
  return Boolean(draggedTask && draggedFromSlot);
}

function initDragAndDrop() {
  // One document-level set of handlers serves all re-rendered timetable grids.
  // Keeping dragend here (rather than inside a successful refresh callback)
  // guarantees that cancelled or rejected drops restore the course color.
  document.addEventListener('dragstart', (e) => {
    const templateCard = e.target.closest('.schedule-editor-tool[data-schedule-template]');
    if (templateCard) {
      try {
        draggedScheduleTemplate = scheduleEditorTemplateFromCard(templateCard);
      } catch (error) {
        e.preventDefault();
        showToast(error.message, 'warning');
        return;
      }
      draggedTask = null;
      draggedFromSlot = null;
      draggedTeacherId = null;
      draggedTeacherContainer = null;
      teacherDropCandidates = new Map();
      templateCard.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'copy';
      e.dataTransfer.setData('application/x-schedule-editor-template', JSON.stringify(draggedScheduleTemplate));
      return;
    }
    const slotCell = e.target.closest('.slot-cell.has-class');
    if (!slotCell || !slotCell.dataset.taskId) return;

    draggedTask = slotCell.dataset.taskId;
    draggedFromSlot = slotCell.dataset.slotId;
    draggedScheduleTemplate = null;
    const teacherContainer = slotCell.closest('[data-teacher-drag-enabled="true"]');
    draggedTeacherId = teacherContainer?.dataset.teacherId || null;
    draggedTeacherContainer = draggedTeacherId ? teacherContainer : null;
    teacherDropCandidates = new Map();
    slotCell.classList.add('dragging');

    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', draggedTask);
    if (draggedTeacherId) void loadTeacherDropCandidates();
  });

  document.addEventListener('dragover', (e) => {
    const slotCell = e.target.closest('.slot-cell');
    if (canDropOnTimetableSlot(slotCell)) {
      e.preventDefault();
      slotCell.classList.add('drag-over');
    }
  });

  document.addEventListener('dragleave', (e) => {
    const slotCell = e.target.closest('.slot-cell');
    if (slotCell) {
      slotCell.classList.remove('drag-over');
    }
  });

  document.addEventListener('drop', async (e) => {
    e.preventDefault();
    const slotCell = e.target.closest('.slot-cell');
    if (!slotCell) return;

    slotCell.classList.remove('drag-over');
    const toSlot = slotCell.dataset.slotId;
    if (!toSlot || !canDropOnTimetableSlot(slotCell)) return;

    // Capture the drag operation before dragend clears the visual state while
    // the commit request is still in flight.
    const taskId = draggedTask;
    const fromSlot = draggedFromSlot;
    const teacherId = draggedTeacherId;
    const teacherCandidate = teacherDropCandidates.get(toSlot) || null;

    try {
      if (draggedScheduleTemplate) {
        await addScheduleEditorOverlay(draggedScheduleTemplate, toSlot);
        return;
      }
      if (!taskId || !fromSlot || toSlot === fromSlot) return;
      const result = teacherId && teacherCandidate
        ? await api('/teacher-timetable/adjust', {
          method: 'POST',
          body: JSON.stringify({
            teacher_id: teacherId,
            task_id: taskId,
            from_slot: fromSlot,
            to_slot: toSlot,
            action: teacherCandidate.action,
          }),
        })
        : await api('/swap', {
        method: 'POST',
        body: JSON.stringify({
          task_id: taskId,
          from_slot: fromSlot,
          to_slot: toSlot
        }),
      });

      showToast(result.message, 'success');

      // 刷新当前课表视图
      await refreshCurrentTimetable();
    } catch (error) {
      // 错误已由 api 函数处理
    } finally {
      clearTimetableDragState();
    }
  });

  document.addEventListener('dragend', clearTimetableDragState);
}

// 刷新当前课表视图
async function refreshCurrentTimetable() {
  const currentView = getCurrentView();

  // 根据当前视图类型重新加载课表
  switch (currentView) {
    case 'class-timetable': {
      const classSelect = document.getElementById('select-class');
      if (classSelect.value) {
        const data = await api(`/timetable/class/${classSelect.value}`);
        renderDetailedTimetable(
          'class-timetable-content',
          data,
          `${classSelect.value} 的课表`,
          `班级ID: ${classSelect.value}`
        );
      }
      break;
    }
    case 'teacher-timetable': {
      const teacherSelect = document.getElementById('select-teacher');
      if (teacherSelect.value) {
        const data = await api(`/timetable/teacher/${teacherSelect.value}`);
        const teacher = await api(`/teachers`).then(t => t.find(t => t.id === teacherSelect.value));
        renderDetailedTimetable(
          'teacher-timetable-content',
          data,
          `${teacher?.name || teacherSelect.value} 的课表`,
          `教师ID: ${teacherSelect.value} | 可教课程: ${teacher?.can_teach?.join(', ') || '-'}`,
          { teacherDrag: true, teacherId: teacherSelect.value },
        );
      }
      break;
    }
    case 'student-timetable': {
      const studentSelect = document.getElementById('select-student');
      if (studentSelect.value) {
        const data = await api(`/timetable/student/${studentSelect.value}`);
        const student = await api(`/students`).then(s => s.find(s => s.id === studentSelect.value));
        renderDetailedTimetable(
          'student-timetable-content',
          data,
          `${student?.name || studentSelect.value}${student?.english_name ? ` (${student.english_name})` : ''} 的课表`,
          `学生ID: ${studentSelect.value} | 英文名: ${student?.english_name || '-'} | 年级: ${student?.grade || '-'}`
        );
      }
      break;
    }
    case 'ap-group-timetable': {
      const groupSelect = document.getElementById('select-ap-group');
      if (groupSelect.value) await renderApGroupTimetable(groupSelect.value);
      break;
    }
    case 'room-timetable': {
      const roomSelect = document.getElementById('select-room');
      if (roomSelect.value) {
        const data = await api(`/timetable/room/${roomSelect.value}`);
        const room = await api(`/rooms`).then(r => r.find(r => r.id === roomSelect.value));
        renderDetailedTimetable(
          'room-timetable-content',
          data,
          `${room?.name || roomSelect.value} 的课表`,
          `教室ID: ${roomSelect.value} | 类型: ${room?.type || '-'} | 容量: ${room?.capacity || '-'}`
        );
      }
      break;
    }
    case 'overview-timetable':
      await loadOverviewTimetable();
      break;
    case 'schedule-editor':
      await renderScheduleEditorTimetable();
      break;
  }
}

// 锁定/解锁课程
async function toggleLock(taskId, slotId) {
  try {
    const state = await api('/status');
    const isLocked = false; // 需要从实际数据获取

    if (isLocked) {
      await api('/unlock', {
        method: 'POST',
        body: JSON.stringify({ task_id: taskId, slot_id: slotId })
      });
      showToast('已解锁', 'success');
    } else {
      await api('/lock', {
        method: 'POST',
        body: JSON.stringify({ task_id: taskId, slot_id: slotId })
      });
      showToast('已锁定', 'success');
    }

    // 刷新视图
    const currentView = getCurrentView();
    if (currentView.includes('timetable')) {
      loadViewData(currentView);
    }
  } catch (error) {
    showToast(error.message, 'error');
  }
}

// 获取当前视图
function getCurrentView() {
  const activeView = document.querySelector('.view.active');
  return activeView ? activeView.id.replace('view-', '') : 'status';
}

const ADMIN_SHELL_VIEW_META = {
  welcome: { title: '概览', section: '教务工作台' },
  'exam-scheduling': { title: '排考试', section: '考试周工作台' },
  'manual-timetable': { title: '排课表', section: '排课工作台' },
  'teacher-availability': { title: '涂课表', section: '排课工作台' },
  'schedule-editor': { title: '改课表', section: '排课工作台' },
  'past-timetables': { title: '过往课表', section: '排课工作台' },
  'overview-timetable': { title: '总课表概览', section: '课表查看' },
  'class-timetable': { title: '按班级查看', section: '课表查看' },
  'teacher-timetable': { title: '按教师查看', section: '课表查看' },
  'student-timetable': { title: '按学生查看', section: '课表查看' },
  'ap-group-timetable': { title: 'AP 分流组查看', section: '课表查看' },
  'room-timetable': { title: '按教室查看', section: '课表查看' },
  students: { title: '学生管理', section: '数据管理' },
  teachers: { title: '教师管理', section: '数据管理' },
  classes: { title: '班级管理', section: '数据管理' },
  courses: { title: '课程管理', section: '数据管理' },
  rooms: { title: '教室管理', section: '数据管理' },
  assignments: { title: '教师分工', section: '数据管理' },
  selections: { title: 'AP 选课', section: '数据管理' },
  'elective-selections': { title: '其他选课', section: '数据管理' },
  sectioning: { title: '分班管理', section: '数据管理' },
  constraints: { title: '约束管理', section: '数据管理' },
  import: { title: '数据导入', section: '系统工具' },
  'graduation-archives': { title: '毕业学生选课信息', section: '系统工具' },
  export: { title: '导出课表', section: '系统工具' },
  settings: { title: '系统设置', section: '系统工具' },
  status: { title: '系统状态', section: '系统工具' },
};

const AI_ASSISTANT_VIEW_LABELS = Object.fromEntries(
  Object.entries(ADMIN_SHELL_VIEW_META).map(([view, meta]) => [view, meta.title]),
);

const ADMIN_THEME_STORAGE_KEY = 'timetable.admin-theme.v1';
const ADMIN_SIDEBAR_STORAGE_KEY = 'timetable.admin-sidebar-collapsed.v1';
const ADMIN_WORKSPACE_MODE_STORAGE_KEY = 'timetable.admin-workspace-mode.v1';
let adminWorkspaceMode = 'schedule';
let lastScheduleView = 'welcome';
let commandResultButtons = [];
let selectedCommandIndex = 0;

function applyWorkspaceMode(mode, { persist = true } = {}) {
  const resolvedMode = normalizeWorkspaceMode(mode);
  const presentation = workspaceModePresentation(resolvedMode);
  const app = document.querySelector('.app');
  const switchButton = document.getElementById('sidebar-mode-switch');
  const scheduleNavigation = document.getElementById('schedule-sidebar-navigation');
  const examNavigation = document.getElementById('exam-sidebar-navigation');

  adminWorkspaceMode = resolvedMode;
  if (app) app.dataset.workspaceMode = resolvedMode;
  scheduleNavigation?.classList.toggle('hidden', resolvedMode !== 'schedule');
  examNavigation?.classList.toggle('hidden', resolvedMode !== 'exam');
  if (scheduleNavigation) scheduleNavigation.hidden = resolvedMode !== 'schedule';
  if (examNavigation) examNavigation.hidden = resolvedMode !== 'exam';
  if (switchButton) {
    switchButton.setAttribute('aria-checked', resolvedMode === 'exam' ? 'true' : 'false');
    switchButton.setAttribute('aria-label', presentation.switchLabel);
  }

  setDashboardText('sidebar-brand-mark', presentation.mark);
  setDashboardText('sidebar-brand-title', presentation.title);
  setDashboardText('sidebar-brand-subtitle', presentation.subtitle);
  setDashboardText('sidebar-footer-title', presentation.footerTitle);
  setDashboardText('sidebar-footer-subtitle', presentation.footerSubtitle);
  setDashboardText('btn-solve', presentation.primaryAction);

  if (persist) localStorage.setItem(ADMIN_WORKSPACE_MODE_STORAGE_KEY, resolvedMode);
}

async function toggleWorkspaceMode() {
  if (adminWorkspaceMode === 'schedule') {
    const currentView = getCurrentView();
    if (workspaceModeForView(currentView) === 'schedule') lastScheduleView = currentView;
    applyWorkspaceMode('exam');
    await switchView('exam-scheduling', { syncWorkspaceMode: false });
    return;
  }

  applyWorkspaceMode('schedule');
  await switchView(lastScheduleView || 'welcome', { syncWorkspaceMode: false });
}

function setMobileSidebarOpen(open) {
  const app = document.querySelector('.app');
  const sidebar = document.querySelector('.sidebar');
  const sidebarToggle = document.getElementById('btn-sidebar-toggle');
  const isMobile = window.matchMedia('(max-width: 980px)').matches;
  if (!isMobile) {
    app?.classList.remove('sidebar-mobile-open');
    if (sidebar) sidebar.inert = false;
    sidebar?.removeAttribute('aria-hidden');
    return;
  }
  const resolvedOpen = Boolean(open);
  app?.classList.toggle('sidebar-mobile-open', resolvedOpen);
  if (sidebar) sidebar.inert = !resolvedOpen;
  sidebar?.setAttribute('aria-hidden', resolvedOpen ? 'false' : 'true');
  sidebarToggle?.setAttribute('aria-expanded', resolvedOpen ? 'true' : 'false');
  sidebarToggle?.setAttribute('aria-label', resolvedOpen ? '关闭侧栏' : '打开侧栏');
}

function updateAdminShellContext(viewName = getCurrentView()) {
  const meta = ADMIN_SHELL_VIEW_META[viewName] || { title: '排课系统', section: '教务工作台' };
  setDashboardText('page-title', meta.title);
  setDashboardText('page-section', meta.section);
  document.title = `${meta.title} · 排课系统`;
  if (window.matchMedia('(max-width: 980px)').matches) {
    setMobileSidebarOpen(false);
  }
}

function applyAdminTheme(theme) {
  const resolvedTheme = theme === 'dark' ? 'dark' : 'light';
  document.documentElement.dataset.theme = resolvedTheme;
  const themeButton = document.getElementById('btn-theme-toggle');
  const icon = themeButton?.querySelector('.theme-icon');
  if (icon) icon.textContent = resolvedTheme === 'dark' ? '☀' : '☾';
  if (themeButton) themeButton.setAttribute('aria-label', resolvedTheme === 'dark' ? '切换浅色模式' : '切换深色模式');
  const themeColor = document.querySelector('meta[name="theme-color"]');
  if (themeColor) themeColor.setAttribute('content', resolvedTheme === 'dark' ? '#101012' : '#ffffff');
}

function commandNavigationItems() {
  return [...document.querySelectorAll('.sidebar-mode-navigation:not(.hidden) .nav-section a[data-view]')].map(link => ({
    view: link.dataset.view,
    label: link.querySelector('.nav-label')?.textContent?.trim() || link.textContent.trim(),
    icon: link.querySelector('.nav-icon')?.textContent?.trim() || '·',
    section: link.closest('.nav-section')?.querySelector('h3')?.textContent?.trim() || '页面',
  }));
}

function selectCommandResult(index) {
  if (!commandResultButtons.length) return;
  selectedCommandIndex = (index + commandResultButtons.length) % commandResultButtons.length;
  commandResultButtons.forEach((button, buttonIndex) => {
    button.classList.toggle('is-selected', buttonIndex === selectedCommandIndex);
    button.setAttribute('aria-selected', buttonIndex === selectedCommandIndex ? 'true' : 'false');
  });
  commandResultButtons[selectedCommandIndex]?.scrollIntoView({ block: 'nearest' });
}

function renderCommandResults(query = '') {
  const results = document.getElementById('command-results');
  if (!results) return;
  const keyword = query.trim().toLocaleLowerCase('zh-CN');
  const items = commandNavigationItems().filter(item =>
    !keyword || `${item.label} ${item.section} ${item.view}`.toLocaleLowerCase('zh-CN').includes(keyword));
  results.replaceChildren();
  commandResultButtons = [];
  selectedCommandIndex = 0;

  if (!items.length) {
    const empty = document.createElement('div');
    empty.className = 'command-empty';
    empty.textContent = '没有找到匹配的页面';
    results.append(empty);
    return;
  }

  let currentSection = '';
  for (const item of items) {
    if (item.section !== currentSection) {
      currentSection = item.section;
      const group = document.createElement('div');
      group.className = 'command-result-group';
      group.textContent = currentSection;
      results.append(group);
    }
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'command-result';
    button.setAttribute('role', 'option');
    button.dataset.commandView = item.view;

    const icon = document.createElement('span');
    icon.className = 'nav-icon nav-icon-text';
    icon.setAttribute('aria-hidden', 'true');
    icon.textContent = item.icon;
    const copy = document.createElement('span');
    copy.className = 'command-result-copy';
    const title = document.createElement('strong');
    title.textContent = item.label;
    const section = document.createElement('small');
    section.textContent = item.section;
    copy.append(title, section);
    const shortcut = document.createElement('span');
    shortcut.setAttribute('aria-hidden', 'true');
    shortcut.textContent = '→';
    button.append(icon, copy, shortcut);
    button.addEventListener('mouseenter', () => selectCommandResult(commandResultButtons.indexOf(button)));
    button.addEventListener('click', async () => {
      closeCommandPalette();
      await switchView(item.view);
    });
    results.append(button);
    commandResultButtons.push(button);
  }
  selectCommandResult(0);
}

function openCommandPalette() {
  const palette = document.getElementById('command-palette');
  const input = document.getElementById('command-search-input');
  if (!palette || !input) return;
  palette.classList.remove('hidden');
  input.value = '';
  renderCommandResults();
  requestAnimationFrame(() => input.focus());
}

function closeCommandPalette() {
  document.getElementById('command-palette')?.classList.add('hidden');
  document.getElementById('btn-command-search')?.focus();
}

function initAdminShell() {
  const app = document.querySelector('.app');
  const sidebarToggle = document.getElementById('btn-sidebar-toggle');
  const sidebarClose = document.getElementById('btn-sidebar-close');
  const themeButton = document.getElementById('btn-theme-toggle');
  const commandTrigger = document.getElementById('btn-command-search');
  const commandPalette = document.getElementById('command-palette');
  const commandInput = document.getElementById('command-search-input');
  const workspaceModeSwitch = document.getElementById('sidebar-mode-switch');
  const storedTheme = localStorage.getItem(ADMIN_THEME_STORAGE_KEY);
  const initialTheme = storedTheme || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  applyAdminTheme(initialTheme);
  applyWorkspaceMode(localStorage.getItem(ADMIN_WORKSPACE_MODE_STORAGE_KEY), { persist: false });
  setMobileSidebarOpen(false);

  if (!window.matchMedia('(max-width: 980px)').matches && localStorage.getItem(ADMIN_SIDEBAR_STORAGE_KEY) === 'true') {
    app?.classList.add('sidebar-collapsed');
    sidebarToggle?.setAttribute('aria-expanded', 'false');
    sidebarToggle?.setAttribute('aria-label', '展开侧栏');
  }

  sidebarToggle?.addEventListener('click', () => {
    if (window.matchMedia('(max-width: 980px)').matches) {
      setMobileSidebarOpen(!app?.classList.contains('sidebar-mobile-open'));
      return;
    }
    const collapsed = app?.classList.toggle('sidebar-collapsed') === true;
    localStorage.setItem(ADMIN_SIDEBAR_STORAGE_KEY, String(collapsed));
    sidebarToggle.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
    sidebarToggle.setAttribute('aria-label', collapsed ? '展开侧栏' : '收起侧栏');
  });

  sidebarClose?.addEventListener('click', () => {
    setMobileSidebarOpen(false);
    sidebarToggle?.focus();
  });

  themeButton?.addEventListener('click', () => {
    const nextTheme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    localStorage.setItem(ADMIN_THEME_STORAGE_KEY, nextTheme);
    applyAdminTheme(nextTheme);
  });

  workspaceModeSwitch?.addEventListener('click', toggleWorkspaceMode);

  commandTrigger?.addEventListener('click', openCommandPalette);
  commandInput?.addEventListener('input', event => renderCommandResults(event.target.value));
  commandPalette?.addEventListener('click', event => {
    if (event.target === commandPalette) closeCommandPalette();
  });

  document.addEventListener('keydown', event => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLocaleLowerCase() === 'k') {
      event.preventDefault();
      if (commandPalette?.classList.contains('hidden')) openCommandPalette();
      else closeCommandPalette();
      return;
    }
    if (commandPalette?.classList.contains('hidden')) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      closeCommandPalette();
    } else if (event.key === 'ArrowDown') {
      event.preventDefault();
      selectCommandResult(selectedCommandIndex + 1);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      selectCommandResult(selectedCommandIndex - 1);
    } else if (event.key === 'Enter' && document.activeElement === commandInput) {
      event.preventDefault();
      commandResultButtons[selectedCommandIndex]?.click();
    }
  });

  document.querySelectorAll('[data-shell-view]').forEach(button => {
    button.addEventListener('click', () => switchView(button.dataset.shellView));
  });

  updateAdminShellContext();
}

let aiAssistantConversation = [];
let aiAssistantBusy = false;
let aiAssistantActiveView = '';
let aiAssistantRequestId = 0;

function aiAssistantViewLabel(viewName = getCurrentView()) {
  return AI_ASSISTANT_VIEW_LABELS[viewName] || '当前页面';
}

function aiAssistantIntroduction(viewName = getCurrentView()) {
  return `我是排课助手。当前在${aiAssistantViewLabel(viewName)}，可以解释数据、排查问题，也能使用受控 CLI 查询状态，或把明确的修改需求整理成待确认操作。任何数据修改都必须点击确认后才会执行。`;
}

function aiAssistantContext(viewName = getCurrentView()) {
  const selected = {};
  const view = document.getElementById(`view-${viewName}`);
  if (view) {
    view.querySelectorAll('select').forEach(select => {
      if (!select.value) return;
      // Student IDs/names should never be included in the external model
      // context. The server gets aggregate student statistics instead.
      if (select.id === 'select-student') {
        selected.student_selected = '已选择一名学生（隐私标识未发送）';
        return;
      }
      // The teacher timetable needs its stable identifier so the backend can
      // provide a concrete, privacy-safe weekly schedule analysis rather than
      // a generic answer based on aggregate data alone.
      if (select.id === 'select-teacher') {
        selected.teacher_id = select.value;
        return;
      }
      const option = select.selectedOptions?.[0];
      const label = (option?.textContent || select.value).trim();
      if (label) selected[select.id || 'selected_filter'] = label.slice(0, 160);
    });
  }
  if (viewName === 'manual-timetable') {
    const classId = manualCurrentClassId();
    if (classId) selected.manual_teaching_class = classId;
  }
  return { view: viewName, selected };
}

function aiAssistantContextKey(context = aiAssistantContext()) {
  return JSON.stringify(context);
}

function updateAiAssistantContext(viewName = getCurrentView()) {
  const label = document.getElementById('ai-assistant-context-label');
  if (label) label.textContent = `当前页面：${aiAssistantViewLabel(viewName)}`;
  const changedView = Boolean(aiAssistantActiveView && aiAssistantActiveView !== viewName);
  aiAssistantActiveView = viewName;
  if (!changedView) return;

  aiAssistantConversation = [];
  aiAssistantRequestId += 1;
  aiAssistantBusy = false;
  const messages = document.getElementById('ai-assistant-messages');
  if (messages) messages.replaceChildren();
  const status = document.getElementById('ai-assistant-status');
  if (status) status.textContent = '';
  const sendButton = document.getElementById('btn-ai-assistant-send');
  if (sendButton) sendButton.disabled = false;
  renderAiAssistantMessage('assistant', aiAssistantIntroduction(viewName));
}

function renderAiAssistantMessage(role, content) {
  const messages = document.getElementById('ai-assistant-messages');
  if (!messages) return;
  const message = document.createElement('div');
  message.className = `ai-assistant-message ${role}`;
  message.textContent = content;
  messages.appendChild(message);
  while (messages.children.length > 16) messages.removeChild(messages.firstChild);
  messages.scrollTop = messages.scrollHeight;
}

function appendAiAssistantActionLine(container, text) {
  const line = document.createElement('p');
  line.textContent = text;
  container.appendChild(line);
}

async function executeAiAssistantAction(action, card, confirmButton) {
  const isTeacherSwap = action.type === 'swap_teaching_assignments';
  const isScheduleMove = action.type === 'move_schedule_meeting';
  const isCliOperation = action.type === 'cli_operation';
  const isClearUnlocked = isCliOperation && action.operation === 'schedule.clear-unlocked';
  if (!isTeacherSwap && !isScheduleMove && !isCliOperation) return;
  const confirmation = isTeacherSwap
    ? '确认调换这两项课程的授课教师吗？当前课表会标记为待重排。'
    : isScheduleMove
      ? `确认将“${action.course_name}”从${action.from_label}调整到${action.to_label}吗？`
      : isClearUnlocked
        ? '确认清除全部未锁定课时吗？系统会原位保留金框必要条件及其他已锁定课时。'
        : `确认通过 CLI 执行“${action.title || action.operation}”吗？`;
  if (!confirm(confirmation)) return;
  confirmButton.disabled = true;
  setAiAssistantStatus(isTeacherSwap
    ? '正在执行已确认的教师调换…'
    : isScheduleMove ? '正在校验并调整课程时段…' : '正在通过 CLI 执行已确认操作…');
  try {
    const endpoint = isTeacherSwap
      ? '/assistant/actions/swap-teaching-assignments'
      : isScheduleMove
        ? '/assistant/actions/move-schedule-meeting'
        : '/assistant/actions/execute-cli-operation';
    const result = await api(endpoint, {
      method: 'POST',
      body: JSON.stringify(isTeacherSwap
        ? { assignment_ids: action.assignment_ids, expected_revision: action.expected_revision }
        : isScheduleMove ? {
          section_id: action.section_id,
          from_slot: action.from_slot,
          to_slot: action.to_slot,
          expected_revision: action.expected_revision,
        } : {
          operation: action.operation,
          params: action.params || {},
          body: action.body ?? null,
          expected_revision: action.expected_revision,
        }),
    });
    card.classList.add('ai-assistant-action-complete');
    card.replaceChildren();
    const title = document.createElement('h3');
    title.textContent = isTeacherSwap
      ? '✓ 已执行教师调换'
      : isScheduleMove ? '✓ 已调整课程时段' : '✓ CLI 操作已执行';
    card.appendChild(title);
    appendAiAssistantActionLine(card, result.message || '操作已执行。');
    renderAiAssistantMessage('assistant', isTeacherSwap
      ? '教师分工已更新。现有课表已标记为待重排，请重新确认必要条件后再运行 AI 排课。'
      : isScheduleMove
        ? '课程时段已调整并通过硬约束校验，当前课表已刷新。'
        : isClearUnlocked
          ? (result.message || '未锁定课时已清除，所有金框和其他已锁定课时均已保留。')
          : `CLI 操作 ${action.operation} 已执行，页面数据已刷新。`);
    setAiAssistantStatus('操作已完成，页面数据已刷新。');
    await loadViewData(getCurrentView());
    updateAiAssistantContext();
  } catch (error) {
    confirmButton.disabled = false;
    setAiAssistantStatus('操作未执行，请重新核对后再试。');
  }
}

function renderAiAssistantActionProposal(action) {
  if (!action || !['swap_teaching_assignments', 'move_schedule_meeting', 'cli_operation'].includes(action.type)) return;
  const messages = document.getElementById('ai-assistant-messages');
  if (!messages) return;
  const card = document.createElement('section');
  card.className = 'ai-assistant-action';
  const title = document.createElement('h3');
  title.textContent = `待确认：${action.title || (action.type === 'swap_teaching_assignments' ? '调换授课教师' : '调整课程时段')}`;
  card.appendChild(title);
  if (action.type === 'swap_teaching_assignments') {
    if (!Array.isArray(action.assignments) || action.assignments.length !== 2) return;
    const [left, right] = action.assignments;
    appendAiAssistantActionLine(card, `“${left.course_name}”目前由 ${left.teacher_name} 负责，确认后改由 ${right.teacher_name} 负责。`);
    appendAiAssistantActionLine(card, `“${right.course_name}”目前由 ${right.teacher_name} 负责，确认后改由 ${left.teacher_name} 负责。`);
  } else if (action.type === 'move_schedule_meeting') {
    appendAiAssistantActionLine(card, `“${action.course_name}”（${action.class_label}）：${action.from_label} → ${action.to_label}`);
  } else {
    appendAiAssistantActionLine(card, `CLI 操作：${action.operation}`);
    const parameters = JSON.stringify({ params: action.params || {}, body: action.body ?? null });
    appendAiAssistantActionLine(card, `参数：${parameters.length > 600 ? `${parameters.slice(0, 600)}…` : parameters}`);
  }
  if (Array.isArray(action.impacts) && action.impacts.length) {
    const impactTitle = document.createElement('p');
    impactTitle.textContent = '影响：';
    card.appendChild(impactTitle);
    const list = document.createElement('ul');
    action.impacts.forEach(impact => {
      const item = document.createElement('li');
      item.textContent = impact;
      list.appendChild(item);
    });
    card.appendChild(list);
  }
  const actions = document.createElement('div');
  actions.className = 'ai-assistant-action-actions';
  const confirmButton = document.createElement('button');
  confirmButton.type = 'button';
  confirmButton.className = 'btn btn-warning';
  confirmButton.textContent = action.type === 'swap_teaching_assignments'
    ? '确认调换'
    : action.type === 'move_schedule_meeting' ? '确认调整' : '确认执行 CLI';
  const dismissButton = document.createElement('button');
  dismissButton.type = 'button';
  dismissButton.className = 'btn btn-secondary';
  dismissButton.textContent = '取消';
  confirmButton.addEventListener('click', () => executeAiAssistantAction(action, card, confirmButton));
  dismissButton.addEventListener('click', () => {
    card.classList.add('hidden');
    setAiAssistantStatus('已取消该操作建议。');
  });
  actions.append(confirmButton, dismissButton);
  card.appendChild(actions);
  messages.appendChild(card);
  messages.scrollTop = messages.scrollHeight;
}

function setAiAssistantStatus(message = '') {
  const status = document.getElementById('ai-assistant-status');
  if (status) status.textContent = message;
}

function setAiAssistantCollapsed(collapsed) {
  const container = document.querySelector('.container');
  const toggle = document.getElementById('btn-ai-assistant-toggle');
  const open = document.getElementById('btn-ai-assistant-open');
  if (!container || !toggle || !open) return;
  container.classList.toggle('ai-assistant-collapsed', collapsed);
  toggle.setAttribute('aria-expanded', String(!collapsed));
  toggle.setAttribute('aria-label', collapsed ? '展开 AI 助手' : '收起 AI 助手');
  toggle.textContent = collapsed ? '‹' : '›';
  open.classList.toggle('hidden', !collapsed);
}

async function sendAiAssistantMessage(rawMessage) {
  const message = String(rawMessage || '').trim();
  if (!message || aiAssistantBusy) return;
  const input = document.getElementById('ai-assistant-input');
  const sendButton = document.getElementById('btn-ai-assistant-send');
  const context = aiAssistantContext();
  const contextKey = aiAssistantContextKey(context);
  const history = aiAssistantConversation
    .filter(item => item.context_key === contextKey)
    .slice(-6)
    .map(({ role, content }) => ({ role, content }));
  aiAssistantConversation.push({ role: 'user', content: message, context_key: contextKey });
  renderAiAssistantMessage('user', message);
  if (input) input.value = '';
  aiAssistantBusy = true;
  const requestId = ++aiAssistantRequestId;
  if (sendButton) sendButton.disabled = true;
  setAiAssistantStatus('DeepSeek 正在分析当前页面…');
  try {
    const result = await api('/assistant/chat', {
      method: 'POST',
      body: JSON.stringify({ message, context, history }),
    });
    if (requestId !== aiAssistantRequestId || contextKey !== aiAssistantContextKey()) return;
    const response = String(result?.response || '').trim() || '没有收到可显示的回答，请稍后重试。';
    aiAssistantConversation.push({ role: 'assistant', content: response, context_key: contextKey });
    renderAiAssistantMessage('assistant', response);
    if (result?.action) renderAiAssistantActionProposal(result.action);
    if (result?.action_error) renderAiAssistantMessage('error', result.action_error);
    const cliUsage = Array.isArray(result?.cli_usage) ? result.cli_usage : [];
    setAiAssistantStatus(cliUsage.length
      ? `已使用 ${result?.model || '当前模型'}，并通过 CLI 查询 ${cliUsage.map(item => item.operation).join('、')}`
      : `已使用 ${result?.model || '当前模型'} 分析`);
  } catch (error) {
    if (requestId !== aiAssistantRequestId || contextKey !== aiAssistantContextKey()) return;
    const response = `暂时无法分析：${error.message || '请求失败'}`;
    aiAssistantConversation.push({ role: 'assistant', content: response, context_key: contextKey });
    renderAiAssistantMessage('error', response);
    setAiAssistantStatus('请求失败，可检查系统设置中的 API 配置。');
  } finally {
    if (requestId === aiAssistantRequestId) {
      aiAssistantBusy = false;
      if (sendButton) sendButton.disabled = false;
    }
  }
}

function initAiAssistant() {
  const input = document.getElementById('ai-assistant-input');
  const sendButton = document.getElementById('btn-ai-assistant-send');
  const toggle = document.getElementById('btn-ai-assistant-toggle');
  const open = document.getElementById('btn-ai-assistant-open');
  if (!input || !sendButton || !toggle || !open) return;
  updateAiAssistantContext();
  renderAiAssistantMessage('assistant', aiAssistantIntroduction());
  sendButton.addEventListener('click', () => sendAiAssistantMessage(input.value));
  input.addEventListener('keydown', event => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      sendAiAssistantMessage(input.value);
    }
  });
  document.querySelectorAll('.ai-assistant-prompt').forEach(button => {
    button.addEventListener('click', () => sendAiAssistantMessage(button.dataset.aiPrompt));
  });
  toggle.addEventListener('click', () => setAiAssistantCollapsed(true));
  open.addEventListener('click', () => setAiAssistantCollapsed(false));
  if (window.matchMedia('(max-width: 768px)').matches) setAiAssistantCollapsed(true);
}

// 初始化应用
function init() {
  initAdminShell();
  initAiAssistant();
  // 导航点击事件
  document.querySelectorAll('.nav-section a').forEach(link => {
    link.addEventListener('click', async (e) => {
      e.preventDefault();
      const view = link.dataset.view;
      if (view) {
        await switchView(view);
        return;
      }

      const examTarget = link.dataset.examTarget;
      if (examTarget) {
        await switchView('exam-scheduling');
        const target = document.getElementById(examTarget);
        if (!target || target.classList.contains('hidden')) {
          showToast(examTarget === 'exam-result-card' ? '请先生成排考方案' : '暂时无法定位这一部分', 'error');
          return;
        }
        document.querySelectorAll('#exam-sidebar-navigation a').forEach(item => item.classList.remove('active'));
        link.classList.add('active');
        target.scrollIntoView({ behavior: 'smooth', block: 'start' });
        return;
      }

      if (link.dataset.examAction === 'export') {
        const exportButton = document.getElementById('exam-export-button');
        if (exportButton?.disabled) {
          showToast('请先生成排考方案，再导出考试时间表', 'error');
          return;
        }
        await window.exportExamPlan?.();
      }
    });
  });

  // 关闭模态框
  document.getElementById('btn-close-modal').addEventListener('click', hideModal);
  document.getElementById('modal').addEventListener('click', (e) => {
    if (e.target === document.getElementById('modal')) {
      hideModal();
    }
  });

  // 查看状态按钮
  document.getElementById('btn-status').addEventListener('click', () => {
    switchView('status');
  });

  // 顶部主操作只进入排课工作区；实际求解仍由排课页发起，避免误触即修改课表。
  document.getElementById('btn-solve').addEventListener('click', () => {
    switchView(adminWorkspaceMode === 'exam' ? 'exam-scheduling' : 'manual-timetable');
  });

  // 课表选择框事件
  document.getElementById('select-student').addEventListener('change', async (e) => {
    if (e.target.value) {
      const data = await api(`/timetable/student/${e.target.value}`);
      const student = await api(`/students`).then(s => s.find(s => s.id === e.target.value));
      renderDetailedTimetable(
        'student-timetable-content',
        data,
        `${student?.name || e.target.value}${student?.english_name ? ` (${student.english_name})` : ''} 的课表`,
        `学生ID: ${e.target.value} | 英文名: ${student?.english_name || '-'} | 年级: ${student?.grade || '-'}`
      );
    }
  });

  document.getElementById('select-ap-group').addEventListener('change', async (e) => {
    if (e.target.value) await renderApGroupTimetable(e.target.value);
  });

  document.getElementById('select-teacher').addEventListener('change', async (e) => {
    if (e.target.value) {
      const data = await api(`/timetable/teacher/${e.target.value}`);
      const teacher = await api(`/teachers`).then(t => t.find(t => t.id === e.target.value));
      renderDetailedTimetable(
        'teacher-timetable-content',
        data,
        `${teacher?.name || e.target.value} 的课表`,
        `教师ID: ${e.target.value} | 可教课程: ${teacher?.can_teach?.join(', ') || '-'}`,
        { teacherDrag: true, teacherId: e.target.value },
      );
    }
  });

  document.getElementById('select-class').addEventListener('change', async (e) => {
    if (e.target.value) {
      const data = await api(`/timetable/class/${e.target.value}`);
      renderDetailedTimetable(
        'class-timetable-content',
        data,
        `${e.target.value} 的课表`,
        `班级ID: ${e.target.value}`
      );
    }
  });

  document.getElementById('select-room').addEventListener('change', async (e) => {
    if (e.target.value) {
      const data = await api(`/timetable/room/${e.target.value}`);
      const room = await api(`/rooms`).then(r => r.find(r => r.id === e.target.value));
      renderDetailedTimetable(
        'room-timetable-content',
        data,
        `${room?.name || e.target.value} 的课表`,
        `教室ID: ${e.target.value} | 类型: ${room?.type || '-'} | 容量: ${room?.capacity || '-'}`
      );
    }
  });

  // 总课表控制事件
  document.getElementById('select-grade').addEventListener('change', loadOverviewTimetable);
  document.getElementById('select-view-type').addEventListener('change', loadOverviewTimetable);
  document.getElementById('overview-save-schedule').addEventListener('click', saveCurrentScheduleArchive);
  document.getElementById('overview-open-archives').addEventListener('click', () => switchView('past-timetables'));
  document.getElementById('manual-save-schedule').addEventListener('click', saveCurrentScheduleArchive);
  document.getElementById('manual-open-archives').addEventListener('click', () => switchView('past-timetables'));
  document.getElementById('manual-clear-unlocked-schedule').addEventListener('click', clearManualUnlockedSchedule);

  // 校验按钮
  document.getElementById('btn-validate-input').addEventListener('click', async () => {
    const data = await api('/validate-input');
    const content = document.getElementById('validate-content');
    if (data.ok) {
      content.innerHTML = '<div class="validation-result success">✓ 数据校验通过</div>';
    } else {
      content.innerHTML = `
        <div class="validation-result error">✗ 数据校验失败</div>
        <ul class="violations-list">
          ${data.errors.map(e => `<li>${e.msg}</li>`).join('')}
        </ul>
      `;
    }
  });

  // 添加教师分工
  document.getElementById('btn-add-assignment').addEventListener('click', async () => {
    const [teachers, courses, adminClasses, teachingClasses, assignments] = await Promise.all([
      api('/teachers'),
      api('/courses'),
      api('/admin_classes'),
      api('/teaching_classes'),
      api('/teaching_assignments'),
    ]);
    const teacherOptions = [...teachers]
      .sort((left, right) => String(left.name || left.id).localeCompare(String(right.name || right.id), 'zh-CN'))
      .map(teacher => `<option value="${safeDataAttribute(teacher.id)}">${escapeHtml(teacher.name || teacher.id)} · ${escapeHtml(teacher.id)}</option>`)
      .join('');
    const courseOptions = [...courses]
      .sort((left, right) => String(left.name || left.id).localeCompare(String(right.name || right.id), 'zh-CN'))
      .map(course => `<option value="${safeDataAttribute(course.id)}">${escapeHtml(course.name || course.id)} · ${escapeHtml(course.id)}</option>`)
      .join('');
    const renderClassChoices = (items, classType) => items
      .sort((left, right) => String(left.id).localeCompare(String(right.id), 'zh-CN', { numeric: true }))
      .map(item => `
        <label class="assignment-class-choice">
          <input type="checkbox" name="class_ids" value="${safeDataAttribute(item.id)}" data-assignment-class-type="${classType}">
          <span><strong>${escapeHtml(item.name || item.id)}</strong><small>${escapeHtml(item.id)} · Senior ${Number(item.grade) - 9}</small></span>
        </label>
      `).join('');

    showModal('添加教师分工', `
      <form id="form-add-assignment">
        <div class="assignment-form-grid">
          <label class="form-group">
            <span>教师</span>
            <select name="teacher_id" required>
              <option value="">请选择教师</option>
              ${teacherOptions}
            </select>
            <small id="assignment-teacher-qualification-note">选择课程后，只显示可教授该课程的教师。</small>
          </label>
          <label class="form-group">
            <span>课程</span>
            <select name="course_id" required>
              <option value="">请选择课程</option>
              ${courseOptions}
            </select>
          </label>
          <label class="form-group">
            <span>班级类型</span>
            <select name="class_type">
              <option value="admin">行政班</option>
              <option value="teaching">教学班</option>
            </select>
          </label>
          <label class="form-group">
            <span>每周课时</span>
            <input type="number" name="weekly_hours" min="0" max="50" step="1" value="1" required>
          </label>
        </div>
        <fieldset class="assignment-class-fieldset">
          <legend>选择一个或多个班级</legend>
          <div class="assignment-class-options" data-assignment-class-group="admin">
            ${renderClassChoices(adminClasses, 'admin')}
          </div>
          <div class="assignment-class-options hidden" data-assignment-class-group="teaching">
            ${renderClassChoices(teachingClasses, 'teaching')}
          </div>
        </fieldset>
        <label class="form-group">
          <span>分工 ID <small>系统已自动生成，也可以修改</small></span>
          <input type="text" name="id" required>
        </label>
        <p class="assignment-form-note">保存后会自动定位到新增行。已有教学任务不会自动改写，请保存后重新生成。</p>
        <div class="form-actions">
          <button type="button" class="btn btn-secondary" id="btn-cancel-add-assignment">取消</button>
          <button type="submit" class="btn btn-primary">保存分工</button>
        </div>
      </form>
    `);

    const form = document.getElementById('form-add-assignment');
    const teacherSelect = form.elements.teacher_id;
    const courseSelect = form.elements.course_id;
    const classTypeSelect = form.elements.class_type;
    const weeklyHoursInput = form.elements.weekly_hours;
    const idInput = form.elements.id;
    const teacherQualificationNote = document.getElementById('assignment-teacher-qualification-note');
    let idIsAutomatic = true;

    const syncSuggestedId = () => {
      if (!idIsAutomatic) return;
      idInput.value = nextTeachingAssignmentId({
        courseId: courseSelect.value,
        teacherId: teacherSelect.value,
        classType: classTypeSelect.value,
        existingIds: assignments.map(item => item.id),
      });
    };
    const syncClassChoices = () => {
      const selectedType = classTypeSelect.value;
      form.querySelectorAll('[data-assignment-class-group]').forEach(group => {
        const active = group.dataset.assignmentClassGroup === selectedType;
        group.classList.toggle('hidden', !active);
        group.querySelectorAll('input').forEach(input => { input.disabled = !active; });
      });
      syncSuggestedId();
    };
    const syncQualifiedTeachers = () => {
      const qualified = teachersQualifiedForCourse(teachers, courseSelect.value);
      const qualifiedIds = new Set(qualified.map(teacher => teacher.id));
      [...teacherSelect.options].forEach(option => {
        if (option.value) option.disabled = Boolean(courseSelect.value) && !qualifiedIds.has(option.value);
      });
      if (teacherSelect.value && !qualifiedIds.has(teacherSelect.value)) teacherSelect.value = '';
      if (courseSelect.value && qualified.length === 1) teacherSelect.value = qualified[0].id;
      teacherQualificationNote.textContent = !courseSelect.value
        ? '选择课程后，只显示可教授该课程的教师。'
        : qualified.length
          ? `找到 ${qualified.length} 位可授教师${qualified.length === 1 ? '，已自动选中' : ''}。`
          : '没有教师配置了这门课程，请先到“教师管理”补充可授课程。';
      teacherQualificationNote.classList.toggle('warning', Boolean(courseSelect.value) && !qualified.length);
      syncSuggestedId();
    };
    teacherSelect.addEventListener('change', syncSuggestedId);
    courseSelect.addEventListener('change', () => {
      const selectedCourse = courses.find(course => course.id === courseSelect.value);
      if (selectedCourse) weeklyHoursInput.value = Number(selectedCourse.weekly_hours) || 0;
      syncQualifiedTeachers();
    });
    classTypeSelect.addEventListener('change', syncClassChoices);
    idInput.addEventListener('input', () => { idIsAutomatic = false; });
    document.getElementById('btn-cancel-add-assignment').addEventListener('click', hideModal);
    syncClassChoices();
    syncQualifiedTeachers();

    form.addEventListener('submit', async event => {
      event.preventDefault();
      const submitButton = form.querySelector('button[type="submit"]');
      const formData = new FormData(form);
      const classIds = formData.getAll('class_ids').map(String);
      if (!classIds.length) {
        showToast('请至少选择一个班级', 'warning');
        return;
      }
      submitButton.disabled = true;
      try {
        const saved = await api('/teaching_assignments', { method: 'POST', body: JSON.stringify({
          id: String(formData.get('id') || '').trim(),
          teacher_id: String(formData.get('teacher_id') || ''),
          course_id: String(formData.get('course_id') || ''),
          class_type: String(formData.get('class_type') || 'admin'),
          class_ids: classIds,
          weekly_hours: Number(formData.get('weekly_hours')),
        }) });
        hideModal();
        await loadAssignments({ focusAssignmentId: saved.id });
        const teacher = teachers.find(item => item.id === saved.teacher_id);
        const course = courses.find(item => item.id === saved.course_id);
        showAssignmentFeedback(
          `已添加分工 ${saved.id}：${teacher?.name || saved.teacher_id} · ${course?.name || saved.course_id} · ${saved.class_ids.join('、')}。新增行已定位；请重新生成教学任务。`,
          'success',
        );
        showToast('教师分工已添加并定位');
      } catch {
        submitButton.disabled = false;
      }
    });
  });

  // 构建任务按钮：生成后直接刷新本页的持久结果区域。
  document.getElementById('btn-build-tasks').addEventListener('click', async () => {
    const button = document.getElementById('btn-build-tasks');
    const originalLabel = button.textContent;
    button.disabled = true;
    button.textContent = '正在生成…';
    try {
      const data = await api('/build-tasks', { method: 'POST' });
      const summary = summarizeTeachingTasks(data.teaching_tasks || []);
      await loadAssignments({ focusTaskResults: true });
      showAssignmentFeedback(
        `生成完成：${summary.task_records} 个课程/班级任务，共 ${summary.weekly_periods} 节/周。完整明细已显示在本页“教学任务生成结果”。`,
        summary.unassigned_teacher_records ? 'warning' : 'success',
      );
      showToast(`已生成 ${summary.task_records} 条任务，共 ${summary.weekly_periods} 节/周`);
    } catch (error) {
      showAssignmentFeedback(`教学任务生成失败：${error.message}`, 'error');
    } finally {
      button.disabled = false;
      button.textContent = originalLabel;
    }
  });

  document.getElementById('btn-add-constraint').addEventListener('click', () => window.openConstraintDialog());

  // 添加教师按钮
  document.getElementById('btn-add-teacher').addEventListener('click', async () => {
    // 确保课程数据已加载
    if (!window._coursesData) {
      window._coursesData = await api('/courses');
    }

    showModal('添加教师', `
      <form id="form-add-teacher">
        <div class="form-group">
          <label>ID</label>
          <input type="text" name="id" required>
        </div>
        <div class="form-group">
          <label>姓名</label>
          <input type="text" name="name" required>
        </div>
        <div class="form-group">
          <label>可教课程</label>
          ${renderCourseSelector([])}
        </div>
        <div class="form-group">
          <label>考试分组</label>
          <select name="exam_staff_group">
            ${examStaffGroupOptions('ansheng')}
          </select>
        </div>
        <div class="form-group">
          <label>每天上限</label>
          <input type="number" name="max_per_day" value="8">
        </div>
        <div class="form-group">
          <label>每周上限</label>
          <input type="number" name="max_per_week" value="30">
        </div>
        <div class="form-actions">
          <button type="button" class="btn btn-secondary" onclick="hideModal()">取消</button>
          <button type="submit" class="btn btn-primary">添加</button>
        </div>
      </form>
    `);

    // 添加下拉框事件监听
    document.getElementById('course-select').addEventListener('change', (e) => {
      addCourse(e.target.value);
    });

    document.getElementById('form-add-teacher').addEventListener('submit', async (e) => {
      e.preventDefault();
      const formData = new FormData(e.target);
      const data = {
        id: formData.get('id'),
        name: formData.get('name'),
        can_teach: formData.get('can_teach') ? formData.get('can_teach').split(',').filter(Boolean) : [],
        exam_staff_group: formData.get('exam_staff_group') || 'ansheng',
        available_slots: [],
        max_per_day: parseInt(formData.get('max_per_day')),
        max_per_week: parseInt(formData.get('max_per_week')),
      };
      await api('/teachers', { method: 'POST', body: JSON.stringify(data) });
      hideModal();
      showToast('教师添加成功');
      loadTeachers();
    });
  });

  // 添加教室按钮
  document.getElementById('btn-add-room').addEventListener('click', () => {
    showModal('添加教室', `
      <form id="form-add-room">
        <div class="form-group">
          <label>ID</label>
          <input type="text" name="id" required>
        </div>
        <div class="form-group">
          <label>名称</label>
          <input type="text" name="name" required>
        </div>
        <div class="form-group">
          <label>类型</label>
          <select name="type">
            <option value="general">普通</option>
            <option value="physics">物理</option>
            <option value="chemistry">化学</option>
            <option value="biology">生物</option>
            <option value="computer">计算机</option>
            <option value="art">美术</option>
            <option value="music">音乐</option>
          </select>
        </div>
        <div class="form-group">
          <label>容量</label>
          <input type="number" name="capacity" value="30">
        </div>
        <div class="form-actions">
          <button type="button" class="btn btn-secondary" onclick="hideModal()">取消</button>
          <button type="submit" class="btn btn-primary">添加</button>
        </div>
      </form>
    `);

    document.getElementById('form-add-room').addEventListener('submit', async (e) => {
      e.preventDefault();
      const formData = new FormData(e.target);
      const data = {
        id: formData.get('id'),
        name: formData.get('name'),
        type: formData.get('type'),
        capacity: parseInt(formData.get('capacity')),
      };
      await api('/rooms', { method: 'POST', body: JSON.stringify(data) });
      hideModal();
      showToast('教室添加成功');
      loadRooms();
    });
  });

  // 添加课程按钮
  document.getElementById('btn-add-course').addEventListener('click', () => {
    showModal('添加课程', `
      <form id="form-add-course">
        <div class="form-group">
          <label>ID</label>
          <input type="text" name="id" required>
        </div>
        <div class="form-group">
          <label>名称</label>
          <input type="text" name="name" required>
        </div>
        <div class="form-group">
          <label>类型</label>
          <select name="type">
            <option value="required">必修</option>
            <option value="ap">AP选修</option>
            <option value="required_elective">必修选修</option>
            <option value="other">活动/其他</option>
          </select>
        </div>
        <div class="form-group">
          <label>适用年级</label>
          ${renderCourseGradeOptions()}
        </div>
        <div class="form-group">
          <label>上课组织方式</label>
          ${renderCourseDeliveryOptions()}
        </div>
        <div class="form-group" data-high-two-class-scope>
          <label>适用班级（Senior 2）</label>
          ${renderCourseClassOptions()}
        </div>
        <div class="form-group">
          <label>每周课时</label>
          <input type="number" name="weekly_hours" value="4">
        </div>
        <div class="form-group">
          <label>需要的教室类型（AP课用）</label>
          <input type="text" name="required_room_type">
        </div>
        <div class="form-actions">
          <button type="button" class="btn btn-secondary" onclick="hideModal()">取消</button>
          <button type="submit" class="btn btn-primary">添加</button>
        </div>
      </form>
    `);

    const addCourseForm = document.getElementById('form-add-course');
    addCourseForm.querySelectorAll('input[name="grade_scope"]').forEach(input => {
      input.addEventListener('change', () => {
        syncCourseDeliveryEditor(addCourseForm);
        syncCourseClassEditor(addCourseForm);
      });
    });
    addCourseForm.querySelectorAll('[name^="delivery_class_type_"]').forEach(input => {
      input.addEventListener('change', () => syncCourseClassEditor(addCourseForm));
    });
    addCourseForm.querySelector('[name="type"]')?.addEventListener('change', () => {
      syncCourseDeliveryEditor(addCourseForm);
      syncCourseClassEditor(addCourseForm);
    });
    syncCourseDeliveryEditor(addCourseForm);
    syncCourseClassEditor(addCourseForm);
    addCourseForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const formData = new FormData(e.target);
      const grades = formData.getAll('grade_scope').map(Number);
      if (!grades.length) {
        showToast('请至少选择一个适用年级', 'error');
        return;
      }
      const classIds = formData.getAll('class_scope');
      const deliveryClassTypes = courseDeliveryMapFromForm(formData, grades, formData.get('type'));
      if (grades.includes(11) && deliveryClassTypes?.[11] === 'teaching' && !classIds.length) {
        showToast('Senior 2 课程请至少选择一个适用教学班', 'error');
        return;
      }
      const data = {
        id: formData.get('id'),
        name: formData.get('name'),
        type: formData.get('type'),
        grade: grades.length === 1 ? grades[0] : grades,
        delivery_class_type_by_grade: deliveryClassTypes,
        applicable_class_ids: grades.includes(11) && deliveryClassTypes?.[11] === 'teaching' ? classIds : undefined,
        weekly_hours: parseInt(formData.get('weekly_hours')),
        required_room_type: formData.get('required_room_type') || undefined,
        prefer_morning: false,
      };
      await api('/courses', { method: 'POST', body: JSON.stringify(data) });
      hideModal();
      showToast('课程添加成功');
      loadCourses();
    });
  });

  // 添加学生按钮
  document.getElementById('btn-add-student').addEventListener('click', () => {
    showModal('添加学生', `
      <form id="form-add-student">
        <div class="form-group">
          <label>ID</label>
          <input type="text" name="id" required>
        </div>
        <div class="form-group">
          <label>中文姓名</label>
          <input type="text" name="name" required>
        </div>
        <div class="form-group">
          <label>英文名</label>
          <input type="text" name="english_name" placeholder="用于区分中文重名学生">
        </div>
        <div class="form-group">
          <label>年级</label>
          <select name="grade">
            <option value="10">高一</option>
            <option value="11">高二</option>
            <option value="12">高三</option>
          </select>
        </div>
        <div class="form-group">
          <label>行政班ID</label>
          <input type="text" name="admin_class_id" required>
        </div>
        <div class="form-group">
          <label>教学班ID</label>
          <input type="text" name="teaching_class_id" required>
        </div>
        <div class="form-actions">
          <button type="button" class="btn btn-secondary" onclick="hideModal()">取消</button>
          <button type="submit" class="btn btn-primary">添加</button>
        </div>
      </form>
    `);

    document.getElementById('form-add-student').addEventListener('submit', async (e) => {
      e.preventDefault();
      const formData = new FormData(e.target);
      const data = {
        id: formData.get('id'),
        name: formData.get('name'),
        english_name: formData.get('english_name')?.trim() || '',
        grade: parseInt(formData.get('grade')),
        admin_class_id: formData.get('admin_class_id'),
        teaching_class_id: formData.get('teaching_class_id'),
      };
      await api('/students', { method: 'POST', body: JSON.stringify(data) });
      hideModal();
      showToast('学生添加成功');
      loadStudents();
    });
  });

  // 初始化导入功能
  initImportHandlers();
  initStudentImportHandlers();
  initApSelectionImportHandlers();
  initElectiveSelectionImportHandlers();

  // 初始化拖拽功能
  initDragAndDrop();

  // 恢复上一次使用的工作模式；考试周与日常排课使用彼此独立的工作区。
  switchView(adminWorkspaceMode === 'exam' ? 'exam-scheduling' : 'welcome');
}

// 页面加载完成后初始化
document.addEventListener('DOMContentLoaded', init);

// ==================== 高三 A/B/C 其他选课导入 ====================

let pendingElectiveSelectionImport = null;
let pendingElectiveSelectionUploadFile = null;

function initElectiveSelectionImportHandlers() {
  const uploadArea = document.getElementById('elective-selection-upload-area');
  const fileInput = document.getElementById('elective-selection-file-input');
  const selectButton = document.getElementById('btn-select-elective-selection-file');
  const clearButton = document.getElementById('btn-clear-elective-selection-upload');
  if (!uploadArea || !fileInput || !selectButton || !clearButton || uploadArea.dataset.initialized === 'true') return;
  uploadArea.dataset.initialized = 'true';
  selectButton.addEventListener('click', event => {
    event.stopPropagation();
    fileInput.click();
  });
  clearButton.addEventListener('click', event => {
    event.stopPropagation();
    window.clearElectiveSelectionImport();
  });
  uploadArea.addEventListener('click', event => {
    if (!event.target.closest('button')) fileInput.click();
  });
  fileInput.addEventListener('change', event => {
    handleElectiveSelectionImportFile(event.target.files?.[0]);
    fileInput.value = '';
  });
  uploadArea.addEventListener('dragover', event => {
    event.preventDefault();
    uploadArea.classList.add('drag-over');
  });
  uploadArea.addEventListener('dragleave', event => {
    if (!uploadArea.contains(event.relatedTarget)) uploadArea.classList.remove('drag-over');
  });
  uploadArea.addEventListener('drop', event => {
    event.preventDefault();
    uploadArea.classList.remove('drag-over');
    handleElectiveSelectionImportFile(event.dataTransfer.files?.[0]);
  });
}

function updateElectiveSelectionClearButton() {
  const clearButton = document.getElementById('btn-clear-elective-selection-upload');
  if (clearButton) clearButton.disabled = !pendingElectiveSelectionUploadFile && !pendingElectiveSelectionImport;
}

async function handleElectiveSelectionImportFile(file) {
  if (!file) return;
  const extension = file.name.split('.').pop()?.toLowerCase();
  if (!['xlsx', 'xls'].includes(extension)) {
    showToast('高三 A/B/C 选课表只支持 .xlsx 或 .xls 文件', 'warning');
    return;
  }
  pendingElectiveSelectionUploadFile = file;
  updateElectiveSelectionClearButton();
  showToast('正在识别高三 A/B/C 选课并核对学生...', 'info');
  try {
    const formData = new FormData();
    formData.append('file', file);
    const response = await fetch('/api/elective-selections/import/preview', { method: 'POST', body: formData });
    const result = await response.json();
    if (!result.ok) throw new Error(result.errors?.[0]?.msg || '高三选课表识别失败');
    pendingElectiveSelectionImport = result.data;
    renderElectiveSelectionImportPreview();
    showToast(
      result.data.can_confirm
        ? `已识别 ${result.data.unique_students} 名学生的 A/B/C 选课`
        : `识别完成，但有 ${result.data.issue_count} 个问题需要处理`,
      result.data.can_confirm ? 'success' : 'warning',
    );
  } catch (error) {
    pendingElectiveSelectionImport = null;
    renderElectiveSelectionImportPreview();
    showToast(error.message, 'error');
  }
}

function electiveChoiceSummary(names) {
  return ['A', 'B', 'C']
    .map(group => `${group}：${names?.[group] || '—'}`)
    .join('；');
}

function renderElectiveSelectionImportPreview() {
  const container = document.getElementById('elective-selection-import-preview');
  if (!container) return;
  const data = pendingElectiveSelectionImport;
  if (!data) {
    container.classList.add('hidden');
    container.innerHTML = '';
    return;
  }
  const issues = [
    ...(data.invalid || []).map(item => ({
      location: `${item.sheet_name} 第 ${item.excel_row || '-'} 行`,
      student: item.chinese_name || item.student_id || '-',
      detail: item.reason,
    })),
    ...(data.unmatched || []).map(item => ({
      location: `${item.sheet_name} 第 ${item.excel_row || '-'} 行`,
      student: item.chinese_name || item.student_id || '-',
      detail: '学生数据库中没有找到对应的高三学生',
    })),
    ...(data.ambiguous || []).map(item => ({
      location: `${item.sheet_name} 第 ${item.excel_row || '-'} 行`,
      student: item.chinese_name || item.student_id || '-',
      detail: `匹配到多个学生：${(item.candidate_ids || []).join('、')}`,
    })),
  ];
  const usedAi = data.recognition_method === 'ai';
  container.classList.remove('hidden');
  container.innerHTML = `
    <div class="student-import-summary">
      <span>文件：${escapeImportHtml(data.filename)}</span>
      <span>工作表：${data.total_sheets}</span>
      <span>A 组：${data.group_counts?.A || 0}</span>
      <span>B 组：${data.group_counts?.B || 0}</span>
      <span>C 组：${data.group_counts?.C || 0}</span>
      <span>涉及学生：${data.unique_students}</span>
      <span>需处理：${data.issue_count}</span>
      <span class="${usedAi ? 'ai-recognition-badge' : ''}">${usedAi ? `模型辅助：${escapeImportHtml(data.ai?.model || '已启用')}` : '规则直接识别'}</span>
    </div>
    ${usedAi ? `
      <div class="ai-recognition-notice">
        模型只负责把非标准表格转换成候选结构；以下结果仍经过学生、年级、课程组硬校验，并需要人工确认。
        ${data.ai?.confidence !== undefined ? `模型结构置信度：${Math.round(data.ai.confidence * 100)}%。` : ''}
      </div>
    ` : ''}
    <div class="student-import-file">
      <div class="student-import-file-header">
        <strong>工作表识别结果</strong>
        <span class="${data.can_confirm ? 'ap-import-status-ok' : 'ap-import-status-warning'}">
          ${data.can_confirm ? '✓ 校验通过，可以更新' : '⚠ 存在问题，暂不能更新'}
        </span>
      </div>
      <div class="student-import-preview-table">
        <table>
          <thead><tr><th>工作表</th><th>识别格式</th><th>数据行</th><th>已匹配</th><th>问题</th><th>状态</th></tr></thead>
          <tbody>
            ${(data.sheets || []).map(sheet => `
              <tr>
                <td>${escapeImportHtml(sheet.sheet_name)}</td>
                <td>${escapeImportHtml(({ wide: 'A/B/C 三列表', long: '组别长表', roster: '课程名单' })[sheet.layout] || '未识别')}</td>
                <td>${sheet.rows || 0}</td>
                <td>${sheet.matched || 0}</td>
                <td>${sheet.issues || 0}</td>
                <td>${sheet.status === 'recognized' ? '已识别' : escapeImportHtml(sheet.reason || '已忽略')}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </div>
    ${issues.length ? `
      <div class="student-import-file">
        <strong>需要修正的问题</strong>
        <div class="student-import-errors">确认更新已锁定。请修正表格后重新上传，系统不会猜测学生或课程。</div>
        <div class="student-import-preview-table">
          <table>
            <thead><tr><th>位置</th><th>学生</th><th>问题</th></tr></thead>
            <tbody>${issues.map(issue => `
              <tr>
                <td>${escapeImportHtml(issue.location)}</td>
                <td>${escapeImportHtml(issue.student)}</td>
                <td>${escapeImportHtml(issue.detail)}</td>
              </tr>
            `).join('')}</tbody>
          </table>
        </div>
      </div>
    ` : ''}
    <div class="student-import-file">
      <div class="student-import-file-header">
        <strong>完整更新预览（${data.changes.length} 人，可向下滚动核对）</strong>
        <span>文件未出现的组别保持原值</span>
      </div>
      <div class="student-import-preview-table">
        <table>
          <thead><tr><th>Student ID</th><th>中文姓名</th><th>英文名</th><th>本次组别</th><th>当前选课</th><th>导入后选课</th></tr></thead>
          <tbody>${data.changes.map(change => `
            <tr>
              <td>${escapeImportHtml(change.student_id)}</td>
              <td>${escapeImportHtml(change.student_name)}</td>
              <td>${escapeImportHtml(change.english_name || '—')}</td>
              <td>${escapeImportHtml((change.imported_groups || []).join('、'))}</td>
              <td>${escapeImportHtml(electiveChoiceSummary(change.previous_choice_names))}</td>
              <td>${escapeImportHtml(electiveChoiceSummary(change.choice_names))}</td>
            </tr>
          `).join('')}</tbody>
        </table>
      </div>
    </div>
    <div class="student-import-preview-actions">
      <button type="button" class="btn btn-primary" onclick="organizeElectiveSelectionImportWithAi()">
        ✨ 大模型整理
      </button>
      <button type="button" class="btn btn-secondary" onclick="clearElectiveSelectionImport()">清空上传</button>
      <button type="button" class="btn btn-primary" onclick="confirmElectiveSelectionImport()" ${data.can_confirm ? '' : 'disabled'}>
        确认更新 ${data.unique_students} 名学生
      </button>
    </div>
  `;
}

window.clearElectiveSelectionImport = function() {
  pendingElectiveSelectionImport = null;
  pendingElectiveSelectionUploadFile = null;
  const fileInput = document.getElementById('elective-selection-file-input');
  if (fileInput) fileInput.value = '';
  renderElectiveSelectionImportPreview();
  updateElectiveSelectionClearButton();
  showToast('已清空待识别的上传文件和预览', 'info');
};

window.organizeElectiveSelectionImportWithAi = async function() {
  if (!pendingElectiveSelectionUploadFile) return;
  const aiRun = startAiProcessing('大模型正在整理高三 A/B/C 选课表');
  try {
    const formData = new FormData();
    formData.append('file', pendingElectiveSelectionUploadFile);
    formData.append('ai_organize', 'true');
    const response = await fetch('/api/elective-selections/import/preview', { method: 'POST', body: formData });
    const result = await response.json();
    if (!result.ok) throw new Error(result.errors?.[0]?.msg || '大模型整理失败');
    pendingElectiveSelectionImport = result.data;
    renderElectiveSelectionImportPreview();
    finishAiProcessing(aiRun);
    showToast('大模型已整理完成，请核对预览后确认', 'success');
  } catch (error) {
    finishAiProcessing(aiRun, { error: true });
    showToast(error.message, 'error');
  }
};

window.confirmElectiveSelectionImport = async function() {
  const data = pendingElectiveSelectionImport;
  if (!data?.can_confirm) {
    showToast('选课表仍有未通过校验的问题，不能更新', 'warning');
    return;
  }
  if (!confirm(`确定更新 ${data.unique_students} 名高三学生的 A/B/C 选课吗？文件中没有出现的组别会保持原值。`)) return;
  try {
    const result = await api('/elective-selections/import/confirm', {
      method: 'POST',
      body: JSON.stringify({
        changes: data.changes.map(change => ({
          student_id: change.student_id,
          imported_groups: change.imported_groups,
          choices: change.choices,
        })),
      }),
    });
    pendingElectiveSelectionImport = null;
    renderElectiveSelectionImportPreview();
    updateElectiveSelectionClearButton();
    showToast(`已更新 ${result.updated_students} 名学生的 A/B/C 选课`, 'success');
    await loadElectiveSelections();
  } catch (error) {
    showToast(error.message, 'error');
  }
};

// ==================== AP 选课表多工作表导入 ====================

let pendingApSelectionImport = null;
let pendingApSelectionUploadFile = null;

function initApSelectionImportHandlers() {
  const uploadArea = document.getElementById('ap-selection-upload-area');
  const fileInput = document.getElementById('ap-selection-file-input');
  const selectButton = document.getElementById('btn-select-ap-selection-file');
  if (!uploadArea || !fileInput || !selectButton || uploadArea.dataset.initialized === 'true') return;
  uploadArea.dataset.initialized = 'true';

  selectButton.addEventListener('click', event => {
    event.stopPropagation();
    fileInput.click();
  });
  uploadArea.addEventListener('click', event => {
    if (!event.target.closest('button')) fileInput.click();
  });
  fileInput.addEventListener('change', event => {
    handleApSelectionImportFile(event.target.files?.[0]);
    fileInput.value = '';
  });
  uploadArea.addEventListener('dragover', event => {
    event.preventDefault();
    uploadArea.classList.add('drag-over');
  });
  uploadArea.addEventListener('dragleave', event => {
    if (!uploadArea.contains(event.relatedTarget)) uploadArea.classList.remove('drag-over');
  });
  uploadArea.addEventListener('drop', event => {
    event.preventDefault();
    uploadArea.classList.remove('drag-over');
    handleApSelectionImportFile(event.dataTransfer.files?.[0]);
  });
}

async function handleApSelectionImportFile(file) {
  if (!file) return;
  const extension = file.name.split('.').pop()?.toLowerCase();
  if (!['xlsx', 'xls'].includes(extension)) {
    showToast('AP 选课表只支持 .xlsx 或 .xls 文件', 'warning');
    return;
  }
  pendingApSelectionUploadFile = file;
  showToast('正在读取所有工作表并匹配学生...', 'info');
  try {
    const formData = new FormData();
    formData.append('file', file);
    const response = await fetch('/api/ap-selections/import/preview', { method: 'POST', body: formData });
    const result = await response.json();
    if (!result.ok) throw new Error(result.errors?.[0]?.msg || 'AP 选课表识别失败');
    pendingApSelectionImport = result.data;
    renderApSelectionImportPreview();
    showToast(
      result.data.can_confirm
        ? `已匹配 ${result.data.matched_rows} 条选课记录`
        : `识别完成，但有 ${result.data.issue_count} 个问题需要处理`,
      result.data.can_confirm ? 'success' : 'warning',
    );
  } catch (error) {
    pendingApSelectionImport = null;
    renderApSelectionImportPreview();
    showToast(error.message, 'error');
  }
}

function renderApSelectionImportPreview() {
  const container = document.getElementById('ap-selection-import-preview');
  if (!container) return;
  const data = pendingApSelectionImport;
  if (!data) {
    container.classList.add('hidden');
    container.innerHTML = '';
    return;
  }

  const issues = [
    ...(data.unmapped_course_sheets || []).map(item => ({
      location: item.sheet_name,
      name: item.title || '-',
      detail: item.reason,
    })),
    ...(data.unmatched || []).map(item => ({
      location: `${item.sheet_name} 第 ${item.excel_row} 行`,
      name: `${item.chinese_name}${item.english_name ? ` (${item.english_name})` : ''}`,
      detail: '学生数据库中未找到唯一对应学生',
    })),
    ...(data.ambiguous || []).map(item => ({
      location: `${item.sheet_name} 第 ${item.excel_row} 行`,
      name: `${item.chinese_name}${item.english_name ? ` (${item.english_name})` : ''}`,
      detail: `匹配到多个学生：${(item.candidate_ids || []).join(', ')}`,
    })),
    ...(data.grade_mismatches || []).map(item => ({
      location: `${item.sheet_name} 第 ${item.excel_row} 行`,
      name: `${item.chinese_name} (${seniorGradeLabel(item.student_grade)})`,
      detail: `${item.course_name} 不适用于该学生年级`,
    })),
    ...(data.block_conflicts || []).map(item => ({
      location: item.block_id,
      name: `${item.student_name} (${item.student_id})`,
      detail: `同一 Block 有多门同步课程：${(item.course_ids || []).join('、')}`,
    })),
  ];

  const usedAi = data.recognition_method === 'ai';
  container.classList.remove('hidden');
  container.innerHTML = `
    <div class="student-import-summary">
      <span>文件：${escapeImportHtml(data.filename)}</span>
      <span>工作表：${data.total_sheets}</span>
      <span>课程名单页：${data.recognized_sheet_count}</span>
      <span>选课记录：${data.matched_rows}</span>
      <span>涉及学生：${data.unique_students}</span>
      <span>需处理：${data.issue_count}</span>
      <span class="${usedAi ? 'ai-recognition-badge' : ''}">${usedAi ? `模型辅助：${escapeImportHtml(data.ai?.model || '已启用')}` : '规则直接识别'}</span>
    </div>
    ${usedAi ? `
      <div class="ai-recognition-notice">
        原表格式未通过常规识别，模型已转换为候选结构；课程与学生仍经过系统硬校验，并需要人工确认。
      </div>
    ` : ''}

    <div class="student-import-file">
      <div class="student-import-file-header">
        <strong>工作表与课程标题识别结果</strong>
        <span class="${data.can_confirm ? 'ap-import-status-ok' : 'ap-import-status-warning'}">
          ${data.can_confirm ? '✓ 全部匹配，可以更新' : '⚠ 存在未匹配项，暂不能更新'}
        </span>
      </div>
      <div class="student-import-preview-table">
        <table>
          <thead>
            <tr><th>工作表</th><th>识别标题</th><th>系统课程</th><th>名单人数</th><th>匹配</th><th>状态</th></tr>
          </thead>
          <tbody>
            ${(data.sheets || []).map(sheet => `
              <tr>
                <td>${escapeImportHtml(sheet.sheet_name)}</td>
                <td>${escapeImportHtml(sheet.title || '-')}</td>
                <td>${escapeImportHtml(sheet.course_name || '-')}</td>
                <td>${sheet.rows || 0}</td>
                <td>${sheet.matched || 0}</td>
                <td class="${sheet.status === 'recognized' && !sheet.unmatched && !sheet.ambiguous && !sheet.grade_mismatch ? 'ap-import-status-ok' : 'ap-import-status-warning'}">
                  ${sheet.status === 'recognized'
                    ? (sheet.unmatched || sheet.ambiguous || sheet.grade_mismatch ? `${sheet.unmatched || 0} 未匹配 / ${sheet.ambiguous || 0} 有歧义 / ${sheet.grade_mismatch || 0} 年级不符` : '已匹配')
                    : '课程未识别'}
                </td>
              </tr>
            `).join('')}
            ${(data.ignored_sheets || []).map(sheet => `
              <tr>
                <td>${escapeImportHtml(sheet.sheet_name)}</td>
                <td>-</td><td>-</td><td>-</td><td>-</td>
                <td>${escapeImportHtml(sheet.reason)}（已忽略）</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </div>

    ${issues.length ? `
      <div class="student-import-file">
        <strong>需要处理的问题</strong>
        <div class="student-import-errors">
          确认更新已锁定。请先修正表格中的姓名/标题，或补全学生数据库后重新上传。
        </div>
        <div class="student-import-preview-table">
          <table>
            <thead><tr><th>位置</th><th>姓名/标题</th><th>问题</th></tr></thead>
            <tbody>
              ${issues.map(issue => `
                <tr>
                  <td>${escapeImportHtml(issue.location)}</td>
                  <td>${escapeImportHtml(issue.name)}</td>
                  <td>${escapeImportHtml(issue.detail)}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    ` : ''}

    <div class="student-import-file">
      <div class="student-import-file-header">
        <strong>学生选课更新预览（${data.changes.length} 人）</strong>
        <span>仅更新本文件名单中出现的学生</span>
      </div>
      <div class="student-import-preview-table">
        <table>
          <thead><tr><th>Student ID</th><th>中文姓名</th><th>英文名</th><th>年级</th><th>当前 AP 选课</th><th>导入后 AP 选课</th><th>精确 Block</th></tr></thead>
          <tbody>
            ${data.changes.map(change => `
              <tr>
                <td>${escapeImportHtml(change.student_id)}</td>
                <td>${escapeImportHtml(change.student_name)}</td>
                <td>${escapeImportHtml(change.english_name || '-')}</td>
                <td>${escapeImportHtml(seniorGradeLabel(change.grade))}</td>
                <td>${escapeImportHtml((change.previous_course_names || []).join('、') || '无')}</td>
                <td>${escapeImportHtml((change.course_names || []).join('、') || '无')}</td>
                <td>${escapeImportHtml((change.block_assignments || [])
                  .map(item => `${item.course_id} → ${item.block_id}`)
                  .join('、') || '未提供')}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </div>

    <div class="student-import-preview-actions">
      <label class="ap-import-mode">
        更新方式
        <select id="ap-selection-import-mode" class="select">
          <option value="replace">覆盖名单内学生的现有 AP 选课</option>
          <option value="merge">只添加本次选课，保留原有 AP 选课</option>
        </select>
      </label>
      <button type="button" class="btn btn-primary" onclick="organizeApSelectionImportWithAi()">✨ 大模型整理</button>
      <button type="button" class="btn btn-secondary" onclick="clearApSelectionImport()">清空预览</button>
      <button type="button" class="btn btn-primary" onclick="confirmApSelectionImport()" ${data.can_confirm ? '' : 'disabled'}>
        确认更新 ${data.unique_students} 名学生
      </button>
    </div>
  `;
}

window.clearApSelectionImport = function() {
  pendingApSelectionImport = null;
  pendingApSelectionUploadFile = null;
  renderApSelectionImportPreview();
};

window.organizeApSelectionImportWithAi = async function() {
  if (!pendingApSelectionUploadFile) return;
  const aiRun = startAiProcessing('大模型正在整理 AP 选课表');
  try {
    const formData = new FormData();
    formData.append('file', pendingApSelectionUploadFile);
    formData.append('ai_organize', 'true');
    const response = await fetch('/api/ap-selections/import/preview', { method: 'POST', body: formData });
    const result = await response.json();
    if (!result.ok) throw new Error(result.errors?.[0]?.msg || '大模型整理失败');
    pendingApSelectionImport = result.data;
    renderApSelectionImportPreview();
    finishAiProcessing(aiRun);
    showToast('大模型已整理完成，请核对预览后确认', 'success');
  } catch (error) {
    finishAiProcessing(aiRun, { error: true });
    showToast(error.message, 'error');
  }
};

window.confirmApSelectionImport = async function() {
  const data = pendingApSelectionImport;
  if (!data?.can_confirm) {
    showToast('仍有未匹配的课程或学生，不能更新', 'warning');
    return;
  }
  const mode = document.getElementById('ap-selection-import-mode')?.value || 'replace';
  const description = mode === 'replace'
    ? '覆盖文件中这些学生当前的 AP 选课'
    : '把本次课程合并到这些学生当前的 AP 选课';
  if (!confirm(`确定要${description}吗？共涉及 ${data.unique_students} 名学生。`)) return;
  try {
    const result = await api('/ap-selections/import/confirm', {
      method: 'POST',
      body: JSON.stringify({
        mode,
        changes: data.changes.map(change => ({
          student_id: change.student_id,
          course_ids: change.course_ids,
          block_assignments: change.block_assignments || [],
        })),
      }),
    });
    pendingApSelectionImport = null;
    renderApSelectionImportPreview();
    showToast(`已更新 ${result.updated_students} 名学生的 AP 选课`, 'success');
    await loadSelections();
  } catch (error) {
    showToast(error.message, 'error');
  }
};

// ==================== 学生名单快捷导入 ====================

let pendingStudentImports = [];

function escapeImportHtml(value) {
  return escapeHtml(value);
}

function initStudentImportHandlers() {
  const uploadArea = document.getElementById('student-upload-area');
  const fileInput = document.getElementById('student-file-input');
  const selectButton = document.getElementById('btn-select-student-files');
  if (!uploadArea || !fileInput || !selectButton) return;

  selectButton.addEventListener('click', event => {
    event.stopPropagation();
    fileInput.click();
  });
  uploadArea.addEventListener('click', event => {
    if (!event.target.closest('button')) fileInput.click();
  });
  fileInput.addEventListener('change', event => {
    handleStudentImportFiles(event.target.files);
    fileInput.value = '';
  });
  uploadArea.addEventListener('dragover', event => {
    event.preventDefault();
    uploadArea.classList.add('drag-over');
  });
  uploadArea.addEventListener('dragleave', event => {
    if (!uploadArea.contains(event.relatedTarget)) uploadArea.classList.remove('drag-over');
  });
  uploadArea.addEventListener('drop', event => {
    event.preventDefault();
    uploadArea.classList.remove('drag-over');
    handleStudentImportFiles(event.dataTransfer.files);
  });
}

async function handleStudentImportFiles(fileList) {
  const files = [...(fileList || [])];
  if (!files.length) return;
  showToast(`正在识别 ${files.length} 份学生名单...`, 'info');

  for (const file of files) {
    const extension = file.name.split('.').pop()?.toLowerCase();
    if (!['xlsx', 'xls', 'csv'].includes(extension)) {
      showToast(`不支持的文件格式：${file.name}`, 'warning');
      continue;
    }
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('expected_type', 'students');
      const response = await fetch('/api/import/excel', { method: 'POST', body: formData });
      const result = await response.json();
      if (!result.ok) throw new Error(result.errors?.[0]?.msg || '名单识别失败');
      if (result.data.type !== 'students') throw new Error('该文件不是学生名单');

      const existingIndex = pendingStudentImports.findIndex(item => item.data.filename === result.data.filename);
      const nextItem = { file, data: result.data };
      if (existingIndex >= 0) pendingStudentImports[existingIndex] = nextItem;
      else pendingStudentImports.push(nextItem);
    } catch (error) {
      showToast(`${file.name}：${error.message}`, 'error');
    }
  }

  renderStudentImportPreview();
}

function renderStudentImportPreview() {
  const container = document.getElementById('student-import-preview');
  if (!pendingStudentImports.length) {
    container.classList.add('hidden');
    container.innerHTML = '';
    return;
  }

  const total = pendingStudentImports.reduce((sum, item) => sum + item.data.parsed_count, 0);
  const totalErrors = pendingStudentImports.reduce((sum, item) => sum + item.data.errors.length, 0);
  container.classList.remove('hidden');
  container.innerHTML = `
    <div class="student-import-summary">
      <span>文件：${pendingStudentImports.length} 份</span>
      <span>可导入：${total} 人</span>
      <span>需注意：${totalErrors} 行</span>
    </div>
    ${pendingStudentImports.map((item, index) => {
      const data = item.data;
      const context = data.import_context || {};
      const gradeLabel = ({ 10: '高一', 11: '高二', 12: '高三' })[context.grade] || '未识别';
      const adminMapping = Object.entries(context.admin_class_mapping || {})
        .map(([source, target]) => `Class ${source} → ${target}`).join('；');
      const teachingMapping = Object.entries(context.teaching_class_mapping || {})
        .map(([source, target]) => `Teaching Class ${source} → ${target}`).join('；');
      return `
        <div class="student-import-file">
          <div class="student-import-file-header">
            <strong>${escapeImportHtml(data.filename)}</strong>
            <div class="student-import-file-actions">
              <button type="button" class="btn btn-primary btn-sm" onclick="organizeStudentImportWithAi(${index})" ${item.aiOrganizing ? 'disabled' : ''}>
                ${item.aiOrganizing ? '大模型整理中…' : '✨ 大模型整理'}
              </button>
              <button type="button" class="btn btn-danger btn-sm" onclick="removeStudentImport(${index})">移除</button>
            </div>
          </div>
          <div class="student-import-mapping">
            文件名识别：${gradeLabel}；有效学生 ${data.parsed_count}/${data.total_rows} 人；
            ${data.recognition_method === 'ai' ? '<span class="ai-recognition-badge">模型辅助识别</span>' : '规则直接识别'}<br>
            ${escapeImportHtml(adminMapping)}<br>${escapeImportHtml(teachingMapping)}
          </div>
          ${data.errors.length ? `
            <div class="student-import-errors">
              ${data.errors.slice(0, 5).map(error => `<div>${escapeImportHtml(error.msg)}</div>`).join('')}
              ${data.errors.length > 5 ? `<div>另有 ${data.errors.length - 5} 行未显示</div>` : ''}
            </div>
          ` : ''}
          <div class="student-import-table-caption">
            完整名单（共 ${data.parsed_data.length} 人，可在表格内向下滚动核对）
          </div>
          <div class="student-import-preview-table">
            <table>
              <thead><tr><th>Student ID</th><th>中文姓名</th><th>英文名</th><th>年级</th><th>行政班</th><th>教学班</th></tr></thead>
              <tbody>
                ${data.parsed_data.map(student => `
                  <tr>
                    <td>${escapeImportHtml(student.id)}</td>
                    <td>${escapeImportHtml(student.name)}</td>
                    <td>${escapeImportHtml(student.english_name || '-')}</td>
                    <td>${student.grade}</td>
                    <td>${escapeImportHtml(student.admin_class_id)}</td>
                    <td>${escapeImportHtml(student.teaching_class_id)}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </div>
      `;
    }).join('')}
    <div class="student-import-preview-actions">
      <button type="button" class="btn btn-secondary" onclick="clearStudentImports()">清空待导入名单</button>
      <button type="button" class="btn btn-primary" onclick="confirmStudentImports()">确认导入 ${total} 名学生</button>
    </div>
  `;
}

window.organizeStudentImportWithAi = async function(index) {
  const item = pendingStudentImports[index];
  if (!item?.file || item.aiOrganizing) return;
  item.aiOrganizing = true;
  renderStudentImportPreview();
  const aiRun = startAiProcessing(`大模型正在整理 ${item.data.filename}`);
  try {
    const formData = new FormData();
    formData.append('file', item.file);
    formData.append('expected_type', 'students');
    formData.append('ai_organize', 'true');
    const response = await fetch('/api/import/excel', { method: 'POST', body: formData });
    const result = await response.json();
    if (!result.ok) throw new Error(result.errors?.[0]?.msg || '大模型整理失败');
    if (result.data.type !== 'students') throw new Error('大模型整理后仍不是可导入的学生名单');
    pendingStudentImports[index] = { ...item, data: result.data, aiOrganizing: false };
    renderStudentImportPreview();
    finishAiProcessing(aiRun);
    showToast('大模型已整理完成，请核对完整名单后再确认导入', 'success');
  } catch (error) {
    item.aiOrganizing = false;
    renderStudentImportPreview();
    finishAiProcessing(aiRun, { error: true });
    showToast(error.message, 'error');
  }
};

window.removeStudentImport = function(index) {
  pendingStudentImports.splice(index, 1);
  renderStudentImportPreview();
};

window.clearStudentImports = function() {
  pendingStudentImports = [];
  renderStudentImportPreview();
};

window.confirmStudentImports = async function() {
  if (!pendingStudentImports.length) return;
  const total = pendingStudentImports.reduce((sum, item) => sum + item.data.parsed_count, 0);
  if (!confirm(`确认导入 ${pendingStudentImports.length} 份名单，共 ${total} 名学生吗？`)) return;

  let imported = 0;
  let skipped = 0;
  try {
    for (const item of pendingStudentImports) {
      const response = await fetch('/api/import/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'students', data: item.data.parsed_data }),
      });
      const result = await response.json();
      if (!result.ok) throw new Error(`${item.data.filename}：${result.errors?.[0]?.msg || '导入失败'}`);
      imported += result.data.imported;
      skipped += result.data.skipped;
    }
    pendingStudentImports = [];
    renderStudentImportPreview();
    await loadStudents();
    showToast(`成功导入 ${imported} 名学生${skipped ? `，跳过 ${skipped} 条重复记录` : ''}`, 'success');
  } catch (error) {
    showToast(error.message, 'error');
  }
};

// ==================== 数据导入功能 ====================

let currentImportData = null;

// 初始化导入页面
function initImportPage() {
  // 重置状态
  currentImportData = null;
  pendingFiles = [];
  document.getElementById('import-files-list').classList.add('hidden');
  document.getElementById('file-input').value = '';
}

// 待导入文件列表
let pendingFiles = [];

// 初始化导入事件处理
function initImportHandlers() {
  const uploadArea = document.getElementById('upload-area');
  const fileInput = document.getElementById('file-input');

  // 点击上传区域触发文件选择
  uploadArea.addEventListener('click', (e) => {
    if (e.target.tagName !== 'BUTTON') {
      fileInput.click();
    }
  });

  // 文件选择变化（支持多文件）
  fileInput.addEventListener('change', handleFileSelect);

  // 拖拽事件
  uploadArea.addEventListener('dragover', (e) => {
    e.preventDefault();
    uploadArea.classList.add('drag-over');
  });

  uploadArea.addEventListener('dragleave', () => {
    uploadArea.classList.remove('drag-over');
  });

  uploadArea.addEventListener('drop', (e) => {
    e.preventDefault();
    uploadArea.classList.remove('drag-over');

    const files = e.dataTransfer.files;
    if (files.length > 0) {
      handleMultipleFiles(files);
    }
  });
}

// 处理文件选择（多文件）
function handleFileSelect(e) {
  const files = e.target.files;
  if (files.length > 0) {
    handleMultipleFiles(files);
  }
}

// 处理多个文件
async function handleMultipleFiles(files) {
  showToast(`正在解析 ${files.length} 个文件...`, 'info');

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const ext = file.name.split('.').pop().toLowerCase();

    if (!['xlsx', 'xls', 'csv'].includes(ext)) {
      showToast(`跳过不支持的文件: ${file.name}`, 'warning');
      continue;
    }

    try {
      const formData = new FormData();
      formData.append('file', file);

      const response = await fetch('/api/import/excel', {
        method: 'POST',
        body: formData
      });

      const result = await response.json();

      if (result.ok) {
        pendingFiles.push({
          id: Date.now() + i,
          file: file,
          data: result.data,
          status: 'pending'
        });
      } else {
        showToast(`解析 ${file.name} 失败: ${result.errors?.[0]?.msg}`, 'error');
      }
    } catch (error) {
      showToast(`解析 ${file.name} 失败: ${error.message}`, 'error');
    }
  }

  if (pendingFiles.length > 0) {
    showFilesList();
    showToast(`成功解析 ${pendingFiles.length} 个文件`, 'success');
  }
}

// 显示文件列表
function showFilesList() {
  const filesList = document.getElementById('import-files-list');
  const container = document.getElementById('files-container');

  filesList.classList.remove('hidden');

  container.innerHTML = pendingFiles.map((item, index) => {
    const data = item.data;
    const hasAI = data.recognition_method === 'ai';

    return `
      <div class="file-item" id="file-${item.id}">
        <div class="file-item-header">
          <h4>${data.filename}</h4>
          <div>
            <span class="file-type ${hasAI ? 'ai' : ''}">
              ${hasAI ? '🤖 AI识别' : ''} ${getTypeName(data.type)}
            </span>
            <button class="btn-remove" onclick="removeFile(${index})">✕</button>
          </div>
        </div>
        <div class="file-item-stats">
          <span class="stat">总行数: <strong>${data.total_rows}</strong></span>
          <span class="stat">有效数据: <strong>${data.parsed_count}</strong></span>
          <span class="stat">表头: <strong>${data.headers.join(', ')}</strong></span>
        </div>
        ${data.errors.length > 0 ? `
          <div class="file-item-errors">
            ${data.errors.map(e => `<div class="error">${e.msg}</div>`).join('')}
          </div>
        ` : ''}
        <div class="file-item-preview">
          <table>
            <thead>
              <tr>${data.headers.map(h => `<th>${h}</th>`).join('')}</tr>
            </thead>
            <tbody>
              ${data.preview.slice(0, 5).map(row =>
                `<tr>${data.headers.map(h => `<td>${row[h] || ''}</td>`).join('')}</tr>`
              ).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;
  }).join('');
}

// 移除单个文件（全局函数，供 onclick 调用）
window.removeFile = function(index) {
  pendingFiles.splice(index, 1);
  if (pendingFiles.length === 0) {
    document.getElementById('import-files-list').classList.add('hidden');
  } else {
    showFilesList();
  }
};

// 清空所有文件（全局函数，供 onclick 调用）
window.cancelAllImports = function() {
  pendingFiles = [];
  document.getElementById('import-files-list').classList.add('hidden');
  document.getElementById('file-input').value = '';
};

// 批量导入所有文件（全局函数，供 onclick 调用）
window.confirmAllImports = async function() {
  if (pendingFiles.length === 0) {
    showToast('没有待导入的文件', 'error');
    return;
  }

  const totalItems = pendingFiles.reduce((sum, item) => sum + item.data.parsed_count, 0);

  if (!confirm(`确定要导入 ${pendingFiles.length} 个文件，共 ${totalItems} 条数据吗？`)) {
    return;
  }

  let totalImported = 0;
  let totalSkipped = 0;
  let failedFiles = [];

  for (const item of pendingFiles) {
    try {
      const response = await fetch('/api/import/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: item.data.type,
          data: item.data.parsed_data
        })
      });

      const result = await response.json();

      if (result.ok) {
        totalImported += result.data.imported;
        totalSkipped += result.data.skipped;
      } else {
        failedFiles.push(item.data.filename);
      }
    } catch (error) {
      failedFiles.push(item.data.filename);
    }
  }

  // 显示结果
  if (failedFiles.length === 0) {
    showToast(`成功导入 ${totalImported} 条数据${totalSkipped > 0 ? `，跳过 ${totalSkipped} 条重复数据` : ''}`, 'success');
  } else {
    showToast(`导入完成，但 ${failedFiles.length} 个文件失败: ${failedFiles.join(', ')}`, 'warning');
  }

  window.cancelAllImports();
  loadViewData(getCurrentView());
}

// 获取类型名称
function getTypeName(type) {
  const names = {
    students: '学生名单',
    teachers: '教师名单',
    courses: '课程列表',
    rooms: '教室列表',
    course_arrangement: '课程安排表（仅更新已匹配课程的 section 要求）',
    unknown: '未识别'
  };
  return names[type] || type;
}

// 取消导入
function cancelImport() {
  currentImportData = null;
  document.getElementById('import-preview').classList.add('hidden');
  document.getElementById('file-input').value = '';
}

// 确认导入
async function confirmImport() {
  if (!currentImportData) {
    showToast('没有待导入的数据', 'error');
    return;
  }

  if (currentImportData.type === 'unknown') {
    showToast('请先选择数据类型', 'error');
    return;
  }

  if (!confirm(`确定要导入 ${currentImportData.parsed_count} 条${getTypeName(currentImportData.type)}数据吗？`)) {
    return;
  }

  try {
    const response = await fetch('/api/import/confirm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
          type: currentImportData.type,
          data: currentImportData.parsed_data // 使用全部解析后的数据，而非仅预览行
      })
    });

    const result = await response.json();

    if (!result.ok) {
      throw new Error(result.errors?.[0]?.msg || '导入失败');
    }

    showToast(`成功导入 ${result.data.imported} 条数据`, 'success');
    cancelImport();

    // 刷新相关视图
    loadViewData(getCurrentView());
  } catch (error) {
    showToast(error.message, 'error');
  }
}

// ==================== 导出功能 ====================

let templateExportState = {
  classFile: null,
  teacherFile: null,
  preview: null,
};

function setTemplateExportStatus(message, type = '') {
  const status = document.getElementById('template-export-status');
  if (!status) return;
  status.textContent = message;
  status.className = `template-export-status${type ? ` is-${type}` : ''}`;
}

function syncTemplateExportFiles() {
  const classInput = document.getElementById('class-template-input');
  const teacherInput = document.getElementById('teacher-template-input');
  templateExportState = {
    classFile: classInput?.files?.[0] || null,
    teacherFile: teacherInput?.files?.[0] || null,
    preview: null,
  };
  const className = document.getElementById('class-template-filename');
  const teacherName = document.getElementById('teacher-template-filename');
  if (className) className.textContent = templateExportState.classFile?.name || '默认：2026-2027 学年三个年级课表';
  if (teacherName) teacherName.textContent = templateExportState.teacherFile?.name || '默认：9 月 1 日起全部教师课表';
  classInput?.closest('.template-upload-card')?.classList.toggle('has-file', Boolean(templateExportState.classFile));
  teacherInput?.closest('.template-upload-card')?.classList.toggle('has-file', Boolean(templateExportState.teacherFile));
  classInput?.closest('.template-upload-card')?.querySelector('.template-upload-action')
    ?.replaceChildren(document.createTextNode(templateExportState.classFile ? '更换文件' : '替换默认'));
  teacherInput?.closest('.template-upload-card')?.querySelector('.template-upload-action')
    ?.replaceChildren(document.createTextNode(templateExportState.teacherFile ? '更换文件' : '替换默认'));
  const previewButton = document.getElementById('btn-template-preview');
  const aiButton = document.getElementById('btn-template-ai-match');
  const generateButton = document.getElementById('btn-template-generate');
  if (previewButton) previewButton.disabled = false;
  if (aiButton) aiButton.disabled = true;
  if (generateButton) generateButton.disabled = false;
  document.getElementById('template-export-preview')?.classList.add('hidden');
  const customCount = Number(Boolean(templateExportState.classFile)) + Number(Boolean(templateExportState.teacherFile));
  setTemplateExportStatus(customCount === 0
    ? '内置默认模板已就绪，无需上传文件。'
    : customCount === 2
      ? '两个模板均使用自定义文件，可以开始识别。'
      : '一个模板使用自定义文件，另一个继续使用内置默认模板。');
}

function templateExportFormData({ includeMappings = false } = {}) {
  const formData = new FormData();
  if (templateExportState.classFile) {
    formData.append('class_template', templateExportState.classFile, templateExportState.classFile.name);
  }
  if (templateExportState.teacherFile) {
    formData.append('teacher_template', templateExportState.teacherFile, templateExportState.teacherFile.name);
  }
  if (includeMappings) {
    const mappings = {};
    document.querySelectorAll('[data-template-teacher-sheet]').forEach(select => {
      mappings[decodeURIComponent(select.dataset.templateTeacherSheet)] = select.value || '__skip__';
    });
    formData.append('teacher_mappings', JSON.stringify(mappings));
  }
  return formData;
}

async function templateExportRequest(path, formData) {
  const response = await fetch(`/api${path}`, { method: 'POST', body: formData });
  const result = await response.json().catch(() => null);
  if (!response.ok || !result?.ok) {
    throw new Error(result?.errors?.[0]?.msg || `模板处理失败（HTTP ${response.status}）`);
  }
  return result.data;
}

function mappingStatusLabel(mapping) {
  if (mapping.status === 'matched' && mapping.match_method === 'course_assignment') return '课程分工匹配';
  if (mapping.status === 'matched' && mapping.match_method === 'teacher_name') return '姓名自动匹配';
  return ({
    matched: '自动匹配',
    llm_suggested: 'AI 建议（请确认）',
    unmatched: '需要选择',
    ambiguous: '匹配不唯一',
    resource: '资源表保留',
  })[mapping.status] || mapping.status;
}

function renderTemplateExportPreview(preview) {
  const container = document.getElementById('template-export-preview');
  if (!container) return;
  const classTemplate = preview.class_template;
  const teacherTemplate = preview.teacher_template;
  const teacherOptions = (selectedId = '') => `
    <option value="__skip__" ${selectedId ? '' : 'selected'}>保留空白（跳过）</option>
    ${preview.teachers.map(teacher => `
      <option value="${escapeHtml(teacher.id)}" ${teacher.id === selectedId ? 'selected' : ''}>${escapeHtml(teacher.name)} · ${escapeHtml(teacher.id)}</option>
    `).join('')}
  `;
  const classRows = classTemplate.mapped_sheets.map(sheet => `
    <div class="template-class-mapping">
      <strong>${escapeHtml(sheet.sheet_name)} · 高${sheet.grade === 10 ? '一' : sheet.grade === 11 ? '二' : '三'}</strong>
      <span>${sheet.classes.map(item => `Class ${item.template_class_number} → ${escapeHtml(item.class_name || '未匹配')}`).join(' · ')}</span>
    </div>
  `).join('');
  const teacherRows = teacherTemplate.mappings.map(mapping => {
    if (mapping.status === 'resource') {
      return `
        <tr>
          <td>${escapeHtml(mapping.sheet_name)}</td>
          <td class="mapping-status resource">${mappingStatusLabel(mapping)}</td>
          <td>不会覆盖其中现有内容</td>
        </tr>
      `;
    }
    return `
      <tr>
        <td>${escapeHtml(mapping.sheet_name)}</td>
        <td class="mapping-status ${escapeHtml(mapping.status)}">${mappingStatusLabel(mapping)}</td>
        <td>
          <select data-template-teacher-sheet="${encodeURIComponent(mapping.sheet_name)}" aria-label="${escapeHtml(mapping.sheet_name)} 对应教师">
            ${teacherOptions(mapping.teacher_id || '')}
          </select>
          ${mapping.match_reason ? `<div class="template-mapping-reason">${escapeHtml(mapping.match_reason)}${mapping.ai_review?.confidence ? ` · 置信度 ${Math.round(mapping.ai_review.confidence * 100)}%` : ''}</div>` : ''}
          ${mapping.ai_review?.reviewed && !mapping.ai_review.teacher_id ? `<div class="template-mapping-reason is-muted">AI 已复核：${escapeHtml(mapping.ai_review.reason || '证据不足，保留人工选择')}</div>` : ''}
        </td>
      </tr>
    `;
  }).join('');
  container.innerHTML = `
    <div class="template-export-summary">
      <div><span>年级工作表</span><strong>${classTemplate.mapped_sheets.length} / ${classTemplate.sheet_count}</strong></div>
      <div><span>匹配教学班</span><strong>${classTemplate.mapped_class_count} / 9</strong></div>
      <div><span>自动匹配教师</span><strong>${teacherTemplate.matched_count} / ${teacherTemplate.sheet_count - teacherTemplate.resource_count}</strong><small>其中课程分工 ${teacherTemplate.course_matched_count || 0} 张</small></div>
      <div><span>AI 建议 / 仍待选择</span><strong>${teacherTemplate.suggested_count || 0} / ${teacherTemplate.unmatched_count}</strong></div>
    </div>
    <div class="template-mapping-list">
      <h4>年级与班级识别</h4>
      ${classRows || '<div class="empty-state">没有识别到年级课表</div>'}
      <h4>教师工作表识别</h4>
      <div class="table-container">
        <table class="teacher-mapping-table">
          <thead><tr><th>工作表</th><th>识别状态</th><th>系统教师</th></tr></thead>
          <tbody>${teacherRows}</tbody>
        </table>
      </div>
    </div>
    ${preview.warnings?.length ? `<ul class="template-warning-list">${preview.warnings.map(item => `<li>${escapeHtml(item)}</li>`).join('')}</ul>` : ''}
  `;
  container.classList.remove('hidden');
}

function base64WorkbookBlob(data, mimeType) {
  const binary = atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return new Blob([bytes], { type: mimeType });
}

function downloadTemplateFile(file) {
  const url = URL.createObjectURL(base64WorkbookBlob(file.data_base64, file.mime_type));
  const link = document.createElement('a');
  link.href = url;
  link.download = file.filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

async function previewScheduleTemplates() {
  const previewButton = document.getElementById('btn-template-preview');
  const aiButton = document.getElementById('btn-template-ai-match');
  const generateButton = document.getElementById('btn-template-generate');
  previewButton.disabled = true;
  aiButton.disabled = true;
  generateButton.disabled = true;
  setTemplateExportStatus(templateExportState.classFile?.name.toLocaleLowerCase().endsWith('.xls')
    ? '正在转换旧版 .xls 并识别全部工作表…'
    : '正在识别内置模板与所选自定义模板的全部工作表…');
  try {
    const preview = await templateExportRequest('/export/templates/preview', templateExportFormData());
    templateExportState.preview = preview;
    renderTemplateExportPreview(preview);
    generateButton.disabled = false;
    const teacherTemplate = preview.teacher_template;
    aiButton.disabled = !(teacherTemplate.ai_review?.configured && teacherTemplate.ai_review?.candidate_count);
    const statusParts = [
      `课程分工自动匹配 ${teacherTemplate.course_matched_count || 0} 张`,
      teacherTemplate.suggested_count ? `AI 给出 ${teacherTemplate.suggested_count} 张建议` : '',
      teacherTemplate.unmatched_count ? `仍有 ${teacherTemplate.unmatched_count} 张需要人工选择` : '没有未匹配工作表',
    ].filter(Boolean);
    setTemplateExportStatus(`${statusParts.join('；')}。`, teacherTemplate.unmatched_count ? '' : 'success');
  } catch (error) {
    setTemplateExportStatus(error.message, 'error');
    showToast(error.message, 'error');
  } finally {
    previewButton.disabled = false;
  }
}

async function aiMatchScheduleTemplates() {
  const previewButton = document.getElementById('btn-template-preview');
  const aiButton = document.getElementById('btn-template-ai-match');
  const generateButton = document.getElementById('btn-template-generate');
  if (!templateExportState.preview) return;
  previewButton.disabled = true;
  aiButton.disabled = true;
  generateButton.disabled = true;
  setTemplateExportStatus('正在把工作表标题、课程、年级和受限候选交给已配置模型判断…');
  try {
    const preview = await templateExportRequest('/export/templates/ai-match', templateExportFormData());
    templateExportState.preview = preview;
    renderTemplateExportPreview(preview);
    generateButton.disabled = false;
    const teacherTemplate = preview.teacher_template;
    setTemplateExportStatus(
      `AI 已复核 ${teacherTemplate.ai_review?.reviewed_count || 0} 张候选表，给出 ${teacherTemplate.suggested_count || 0} 张建议；仍有 ${teacherTemplate.unmatched_count} 张需要人工选择。`,
      teacherTemplate.unmatched_count ? '' : 'success',
    );
  } catch (error) {
    setTemplateExportStatus(error.message, 'error');
    showToast(error.message, 'error');
    aiButton.disabled = false;
  } finally {
    previewButton.disabled = false;
    generateButton.disabled = !templateExportState.preview;
  }
}

async function generateScheduleTemplateFiles() {
  const previewButton = document.getElementById('btn-template-preview');
  const aiButton = document.getElementById('btn-template-ai-match');
  const generateButton = document.getElementById('btn-template-generate');
  previewButton.disabled = true;
  aiButton.disabled = true;
  generateButton.disabled = true;
  try {
    if (!templateExportState.preview) {
      setTemplateExportStatus(templateExportState.classFile?.name.toLocaleLowerCase().endsWith('.xls')
        ? '正在先转换旧版 .xls 并识别工作表…'
        : '正在先识别工作表，随后会自动生成两份 Excel…');
      const preview = await templateExportRequest('/export/templates/preview', templateExportFormData());
      templateExportState.preview = preview;
      renderTemplateExportPreview(preview);
    }
    setTemplateExportStatus('正在把当前有效课表写入两个模板副本…');
    const result = await templateExportRequest('/export/templates/generate', templateExportFormData({ includeMappings: true }));
    for (let index = 0; index < result.files.length; index += 1) {
      downloadTemplateFile(result.files[index]);
      if (index < result.files.length - 1) await new Promise(resolve => setTimeout(resolve, 180));
    }
    const warningCount = result.summary.warnings?.length || 0;
    setTemplateExportStatus(
      `已生成 ${result.files.length} 个文件：填入 ${result.summary.class_filled_cells} 个班级课表格、${result.summary.teacher_filled_cells} 个教师课表格${warningCount ? `；另有 ${warningCount} 项保留空白` : ''}。`,
      warningCount ? '' : 'success',
    );
    showToast('正式 Excel 课表已生成', 'success');
  } catch (error) {
    setTemplateExportStatus(error.message, 'error');
    showToast(error.message, 'error');
  } finally {
    previewButton.disabled = false;
    const teacherTemplate = templateExportState.preview?.teacher_template;
    aiButton.disabled = !(teacherTemplate?.ai_review?.configured && teacherTemplate?.ai_review?.candidate_count);
    generateButton.disabled = false;
  }
}

function initTemplateExport() {
  const classInput = document.getElementById('class-template-input');
  const teacherInput = document.getElementById('teacher-template-input');
  const previewButton = document.getElementById('btn-template-preview');
  const aiButton = document.getElementById('btn-template-ai-match');
  const generateButton = document.getElementById('btn-template-generate');
  if (!classInput || !teacherInput || !previewButton || !aiButton || !generateButton
    || classInput.dataset.initialized === 'true') return;
  classInput.dataset.initialized = 'true';
  classInput.addEventListener('change', syncTemplateExportFiles);
  teacherInput.addEventListener('change', syncTemplateExportFiles);
  previewButton.addEventListener('click', previewScheduleTemplates);
  aiButton.addEventListener('click', aiMatchScheduleTemplates);
  generateButton.addEventListener('click', generateScheduleTemplateFiles);
  syncTemplateExportFiles();
}

// 加载导出页面
async function loadExportPage() {
  initTemplateExport();
  const dimension = document.getElementById('export-dimension');
  const target = document.getElementById('export-target');

  // 维度变化时更新目标列表
  dimension.onchange = async () => {
    await updateExportTargets();
  };

  // 初始化目标列表
  await updateExportTargets();
}

// 更新导出目标列表
async function updateExportTargets() {
  const dimension = document.getElementById('export-dimension').value;
  const target = document.getElementById('export-target');

  let options = '<option value="">选择对象</option>';

  switch (dimension) {
    case 'class': {
      const [adminClasses, teachingClasses] = await Promise.all([
        api('/admin_classes'),
        api('/teaching_classes'),
      ]);
      options += '<optgroup label="行政班">';
      options += adminClasses.map(c => `<option value="${c.id}">${c.name}</option>`).join('');
      options += '</optgroup>';
      options += '<optgroup label="教学班">';
      options += teachingClasses.map(c => `<option value="${c.id}">${c.name}</option>`).join('');
      options += '</optgroup>';
      break;
    }

    case 'teacher': {
      const teachers = await api('/teachers');
      options += teachers.map(t => `<option value="${t.id}">${t.name}</option>`).join('');
      break;
    }

    case 'student': {
      const students = await api('/students');
      options += students.map(s => `<option value="${s.id}">${s.name}${s.english_name ? ` (${s.english_name})` : ''}</option>`).join('');
      break;
    }

    case 'room': {
      const rooms = await api('/rooms');
      options += rooms.map(r => `<option value="${r.id}">${r.name}</option>`).join('');
      break;
    }

    case 'all': {
      options = '<option value="all">全部课表</option>';
      break;
    }
  }

  target.innerHTML = options;
}

// 预览导出内容
window.previewExport = async function() {
  const dimension = document.getElementById('export-dimension').value;
  const target = document.getElementById('export-target').value;
  const previewDiv = document.getElementById('export-preview');
  const contentDiv = document.getElementById('export-preview-content');

  if (dimension !== 'all' && !target) {
    showToast('请选择要导出的对象', 'warning');
    return;
  }

  try {
    showToast('正在生成预览...', 'info');

    const days = ['周一', '周二', '周三', '周四', '周五'];
    const periods = ['第1节', '第2节', '第3节', '第4节', '第5节', '第6节', '第7节', '第8节', '第9节', '第10节'];

    // 如果是全部课表，按班级分组显示
    if (dimension === 'all') {
      const [adminClasses, teachingClasses] = await Promise.all([
        api('/admin_classes'),
        api('/teaching_classes')
      ]);

      let html = `
        <div style="margin-bottom: 12px; color: var(--gray-600);">
          全部课表预览 | 共 ${adminClasses.length + teachingClasses.length} 个班级
        </div>
      `;

      // 行政班预览
      for (const cls of adminClasses) {
        const classData = await api(`/timetable/class/${cls.id}`);
        if (classData.rows && classData.rows.length > 0) {
          html += generateClassPreview(cls.name, '行政班', classData, days, periods);
        }
      }

      // 教学班预览
      for (const cls of teachingClasses) {
        const classData = await api(`/timetable/class/${cls.id}`);
        if (classData.rows && classData.rows.length > 0) {
          html += generateClassPreview(cls.name, '教学班', classData, days, periods);
        }
      }

      contentDiv.innerHTML = html;
      previewDiv.classList.remove('hidden');
      previewDiv.scrollIntoView({ behavior: 'smooth' });
      showToast('预览生成成功', 'success');
      return;
    }

    // 单个课表预览
    const data = await api(`/timetable/${dimension}/${target || 'all'}`);

    if (!data || !data.rows || data.rows.length === 0) {
      contentDiv.innerHTML = '<div class="empty-state"><p>无排课数据</p></div>';
      previewDiv.classList.remove('hidden');
      return;
    }

    let html = `
      <div style="margin-bottom: 12px; color: var(--gray-600);">
        ${data.title} | 共 ${data.rows.length} 节课
      </div>
      <div class="export-preview-content">
        <table>
          <thead>
            <tr>
              <th>节次</th>
              ${days.map(d => `<th>${d}</th>`).join('')}
            </tr>
          </thead>
          <tbody>
    `;

    data.rows.forEach((row, index) => {
      html += `<tr><td><strong>${periods[index] || `第${index + 1}节`}</strong></td>`;

      for (let i = 1; i <= 5; i++) {
        const slot = row[i];
        if (slot) {
          html += `<td class="has-class">
            <div><strong>${getCourseName(slot)}</strong></div>
            <div style="font-size: 12px; color: var(--gray-600);">${getTeacherName(slot)}</div>
            <div style="font-size: 11px; color: var(--gray-500);">${getRoomName(slot)}</div>
          </td>`;
        } else {
          html += `<td class="empty-slot">-</td>`;
        }
      }

      html += '</tr>';
    });

    html += '</tbody></table></div>';

    contentDiv.innerHTML = html;
    previewDiv.classList.remove('hidden');
    previewDiv.scrollIntoView({ behavior: 'smooth' });

    showToast('预览生成成功', 'success');
  } catch (error) {
    showToast(error.message, 'error');
  }
};

// 生成班级预览 HTML
function generateClassPreview(className, classType, data, days, periods) {
  let html = `
    <div style="margin-top: 24px; margin-bottom: 8px;">
      <h4 style="color: #1976D2; border-bottom: 2px solid #1976D2; padding-bottom: 4px;">
        ${className} (${classType})
      </h4>
    </div>
    <div class="export-preview-content">
      <table>
        <thead>
          <tr>
            <th>节次</th>
            ${days.map(d => `<th>${d}</th>`).join('')}
          </tr>
        </thead>
        <tbody>
  `;

  data.rows.forEach((row, index) => {
    html += `<tr><td><strong>${periods[index] || `第${index + 1}节`}</strong></td>`;

    for (let i = 1; i <= 5; i++) {
      const slot = row[i];
      if (slot) {
        html += `<td class="has-class">
          <div><strong>${getCourseName(slot)}</strong></div>
          <div style="font-size: 12px; color: var(--gray-600);">${getTeacherName(slot)}</div>
          <div style="font-size: 11px; color: var(--gray-500);">${getRoomName(slot)}</div>
        </td>`;
      } else {
        html += `<td class="empty-slot">-</td>`;
      }
    }

    html += '</tr>';
  });

  html += '</tbody></table></div>';
  return html;
}

// 导出课表
window.exportTimetable = async function() {
  const dimension = document.getElementById('export-dimension').value;
  const target = document.getElementById('export-target').value;
  const format = document.getElementById('export-format').value;

  if (dimension !== 'all' && !target) {
    showToast('请选择要导出的对象', 'warning');
    return;
  }

  try {
    showToast('正在生成导出文件...', 'info');

    // 获取课表数据
    const data = await api(`/timetable/${dimension}/${target || 'all'}`);

    if (!data || !data.rows || data.rows.length === 0) {
      showToast('无排课数据可导出', 'warning');
      return;
    }

    // 根据格式生成文件
    let content = '';
    let filename = `${data.title}_${new Date().toISOString().slice(0, 10)}`;
    let mimeType = '';

    switch (format) {
      case 'html':
        content = await generateHTML(data);
        filename += '.html';
        mimeType = 'text/html';
        break;

      case 'csv':
        content = await generateCSV(data);
        filename += '.csv';
        mimeType = 'text/csv';
        break;

      case 'json':
        content = JSON.stringify(data, null, 2);
        filename += '.json';
        mimeType = 'application/json';
        break;
    }

    // 下载文件
    const blob = new Blob([content], { type: mimeType + ';charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    showToast(`导出成功: ${filename}`, 'success');
  } catch (error) {
    showToast(error.message, 'error');
  }
};

// 生成 HTML 格式
async function generateHTML(data) {
  const days = ['周一', '周二', '周三', '周四', '周五'];

  // 如果是全部课表，按班级分组显示
  if (data.title.includes('全部课表')) {
    // 获取所有班级
    const [adminClasses, teachingClasses] = await Promise.all([
      api('/admin_classes'),
      api('/teaching_classes')
    ]);

    let classSections = '';

    // 生成行政班课表
    for (const cls of adminClasses) {
      const classData = await api(`/timetable/class/${cls.id}`);
      if (classData.rows && classData.rows.length > 0) {
        classSections += generateClassTableHTML(cls.name, '行政班', classData, days);
      }
    }

    // 生成教学班课表
    for (const cls of teachingClasses) {
      const classData = await api(`/timetable/class/${cls.id}`);
      if (classData.rows && classData.rows.length > 0) {
        classSections += generateClassTableHTML(cls.name, '教学班', classData, days);
      }
    }

    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <title>${data.title}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; padding: 20px; }
    h1 { color: #333; text-align: center; }
    .class-section { margin-bottom: 40px; page-break-inside: avoid; }
    h2 { color: #1976D2; border-bottom: 2px solid #1976D2; padding-bottom: 8px; margin-top: 30px; }
    table { border-collapse: collapse; width: 100%; margin-top: 10px; }
    th, td { border: 1px solid #ddd; padding: 8px; text-align: center; }
    th { background-color: #f5f5f5; font-weight: 600; font-size: 13px; }
    .has-class { background-color: #e8f5e9; }
    .course { font-weight: 600; color: #2e7d32; font-size: 13px; }
    .teacher { font-size: 12px; color: #666; }
    .room { font-size: 11px; color: #999; }
    @media print {
      .class-section { page-break-after: always; }
      .class-section:last-child { page-break-after: auto; }
    }
  </style>
</head>
<body>
  <h1>${data.title}</h1>
  ${classSections}
  <p style="margin-top: 30px; color: #999; font-size: 12px; text-align: center;">
    导出时间: ${new Date().toLocaleString('zh-CN')} | 共 ${adminClasses.length + teachingClasses.length} 个班级
  </p>
</body>
</html>`;
  }

  // 单个课表的 HTML
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <title>${data.title}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; padding: 20px; }
    h1 { color: #333; }
    table { border-collapse: collapse; width: 100%; margin-top: 20px; }
    th, td { border: 1px solid #ddd; padding: 10px; text-align: center; }
    th { background-color: #f5f5f5; font-weight: 600; }
    .has-class { background-color: #e8f5e9; }
    .course { font-weight: 600; color: #2e7d32; }
    .teacher { font-size: 13px; color: #666; }
    .room { font-size: 12px; color: #999; }
  </style>
</head>
<body>
  <h1>${data.title}</h1>
  <table>
    <thead>
      <tr>
        <th>节次</th>
        ${days.map(d => `<th>${d}</th>`).join('')}
      </tr>
    </thead>
    <tbody>
      ${data.rows.map((row, index) => `
        <tr>
          <td><strong>第${index + 1}节</strong></td>
          ${[1, 2, 3, 4, 5].map(i => {
            const slot = row[i];
            return slot ?
              `<td class="has-class">
                <div class="course">${getCourseName(slot)}</div>
                <div class="teacher">${getTeacherName(slot)}</div>
                <div class="room">${getRoomName(slot)}</div>
              </td>` :
              '<td>-</td>';
          }).join('')}
        </tr>
      `).join('')}
    </tbody>
  </table>
  <p style="margin-top: 20px; color: #999; font-size: 12px;">
    导出时间: ${new Date().toLocaleString('zh-CN')}
  </p>
</body>
</html>`;
}

// 生成单个班级的课表 HTML
function generateClassTableHTML(className, classType, data, days) {
  return `
    <div class="class-section">
      <h2>${className} (${classType})</h2>
      <table>
        <thead>
          <tr>
            <th>节次</th>
            ${days.map(d => `<th>${d}</th>`).join('')}
          </tr>
        </thead>
        <tbody>
          ${data.rows.map((row, index) => `
            <tr>
              <td><strong>第${index + 1}节</strong></td>
              ${[1, 2, 3, 4, 5].map(i => {
                const slot = row[i];
                return slot ?
                  `<td class="has-class">
                    <div class="course">${getCourseName(slot)}</div>
                    <div class="teacher">${getTeacherName(slot)}</div>
                    <div class="room">${getRoomName(slot)}</div>
                  </td>` :
                  '<td>-</td>';
              }).join('')}
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
}

// 生成 CSV 格式
async function generateCSV(data) {
  const days = ['周一', '周二', '周三', '周四', '周五'];
  let csv = '﻿'; // BOM for Excel

  // 如果是全部课表，按班级分组
  if (data.title.includes('全部课表')) {
    const [adminClasses, teachingClasses] = await Promise.all([
      api('/admin_classes'),
      api('/teaching_classes')
    ]);

    // 行政班
    for (const cls of adminClasses) {
      const classData = await api(`/timetable/class/${cls.id}`);
      if (classData.rows && classData.rows.length > 0) {
        csv += `\n"${cls.name} (行政班)"\n`;
        csv += generateClassCSV(classData, days);
      }
    }

    // 教学班
    for (const cls of teachingClasses) {
      const classData = await api(`/timetable/class/${cls.id}`);
      if (classData.rows && classData.rows.length > 0) {
        csv += `\n"${cls.name} (教学班)"\n`;
        csv += generateClassCSV(classData, days);
      }
    }

    return csv;
  }

  // 单个课表
  csv += '节次,' + days.join(',') + '\n';
  data.rows.forEach((row, index) => {
    csv += `第${index + 1}节,`;
    csv += [1, 2, 3, 4, 5].map(i => {
      const slot = row[i];
      return slot ? `"${getCourseName(slot)} ${getTeacherName(slot)} ${getRoomName(slot)}"` : '';
    }).join(',');
    csv += '\n';
  });

  return csv;
}

// 生成单个班级的 CSV
function generateClassCSV(data, days) {
  let csv = '节次,' + days.join(',') + '\n';
  data.rows.forEach((row, index) => {
    csv += `第${index + 1}节,`;
    csv += [1, 2, 3, 4, 5].map(i => {
      const slot = row[i];
      return slot ? `"${getCourseName(slot)} ${getTeacherName(slot)} ${getRoomName(slot)}"` : '';
    }).join(',');
    csv += '\n';
  });
  return csv;
}

// ==================== 排课表功能 ====================

// 存储解析后的约束
let formalConstraints = [];

// 老师禁排时段数据（全局共享）
window._teacherForbiddenSlots = {};

// 加载正式课表页面
async function loadFormalSolvePage() {
  try {
    const [status, tasks, teachers] = await Promise.all([
      api('/status'),
      api('/teaching_tasks'),
      api('/teachers')
    ]);

    // 更新状态显示
    document.getElementById('formal-tasks-count').textContent = tasks.length;
    document.getElementById('formal-assignments-count').textContent = status.last_stage === 'timetable' ? '已排课' : '未排课';

    // 检查是否有排课结果
    if (status.last_stage === 'timetable') {
      const violations = await api('/validate');
      document.getElementById('formal-violations-count').textContent = violations.hard_violations || 0;
      document.getElementById('formal-score').textContent = violations.soft_score || 0;
    } else {
      document.getElementById('formal-violations-count').textContent = '-';
      document.getElementById('formal-score').textContent = '-';
    }

    // 加载老师列表到下拉框
    const select = document.getElementById('formal-teacher-select');
    select.innerHTML = '<option value="">选择老师</option>' +
      teachers.map(t => `<option value="${t.id}">${t.name} (${t.id})</option>`).join('');

    // 初始化课表网格
    renderTeacherScheduleGrid('formal-teacher-schedule', 'formal');

    // 更新统计
    updateTeacherScheduleStats('formal');

    // 重置
    formalConstraints = [];
    document.getElementById('formal-parse-result').classList.add('hidden');
    document.getElementById('formal-suggestions').classList.add('hidden');
  } catch (error) {
    console.error('加载排课状态失败:', error);
  }
}

// 渲染老师课表网格
function renderTeacherScheduleGrid(containerId, prefix) {
  const container = document.getElementById(containerId);
  const days = ['周一', '周二', '周三', '周四', '周五'];

  let html = '<div class="header-cell">节次</div>';
  days.forEach(d => html += `<div class="header-cell">${d}</div>`);

  for (let period = 1; period <= 10; period++) {
    const session = period <= 5 ? '上午' : '下午';
    html += `<div class="time-cell"><div>第${period}节</div><div style="font-size:10px;color:var(--gray-400)">${session}</div></div>`;

    for (let day = 1; day <= 5; day++) {
      const slotId = `D${day}P${period}`;
      html += `<div class="slot-cell" data-slot="${slotId}" onclick="toggleTeacherSlot('${slotId}', '${prefix}')"></div>`;
    }
  }

  container.innerHTML = html;
}

// 切换老师时段状态
window.toggleTeacherSlot = function(slotId, prefix) {
  const select = document.getElementById(`${prefix}-teacher-select`);
  const teacherId = select.value;

  if (!teacherId) {
    showToast('请先选择老师', 'warning');
    return;
  }

  // 初始化老师的禁排时段
  if (!window._teacherForbiddenSlots[teacherId]) {
    window._teacherForbiddenSlots[teacherId] = new Set();
  }

  const slots = window._teacherForbiddenSlots[teacherId];

  // 切换状态
  if (slots.has(slotId)) {
    slots.delete(slotId);
  } else {
    slots.add(slotId);
  }

  // 更新UI
  updateTeacherScheduleUI(teacherId, prefix);
  updateTeacherScheduleStats(prefix);
};

// 更新老师课表UI
function updateTeacherScheduleUI(teacherId, prefix) {
  const container = document.getElementById(`${prefix}-teacher-schedule`);
  const slots = window._teacherForbiddenSlots[teacherId] || new Set();

  container.querySelectorAll('.slot-cell').forEach(cell => {
    const slotId = cell.dataset.slot;
    if (slots.has(slotId)) {
      cell.classList.add('forbidden');
    } else {
      cell.classList.remove('forbidden');
    }
  });
}

// 加载老师的课表（切换老师时）
window.loadTeacherSchedule = function() {
  const select = document.getElementById('formal-teacher-select');
  const teacherId = select.value;

  if (!teacherId) {
    // 清空显示
    document.querySelectorAll('#formal-teacher-schedule .slot-cell').forEach(cell => {
      cell.classList.remove('forbidden');
    });
    document.getElementById('formal-marked-count').textContent = '0';
    return;
  }

  // 加载该老师的禁排时段
  updateTeacherScheduleUI(teacherId, 'formal');
  updateTeacherScheduleStats('formal');
};

// 清空选中老师的禁排时段
window.clearTeacherSchedule = function() {
  const select = document.getElementById('formal-teacher-select');
  const teacherId = select.value;

  if (!teacherId) {
    showToast('请先选择老师', 'warning');
    return;
  }

  if (confirm(`确定要清空 ${teacherId} 的所有禁排时段吗？`)) {
    window._teacherForbiddenSlots[teacherId] = new Set();
    updateTeacherScheduleUI(teacherId, 'formal');
    updateTeacherScheduleStats('formal');
    showToast('已清空', 'success');
  }
};

// 清空所有老师的禁排时段
window.clearAllTeacherSchedules = function() {
  if (confirm('确定要清空所有老师的禁排时段吗？')) {
    window._teacherForbiddenSlots = {};
    document.querySelectorAll('#formal-teacher-schedule .slot-cell').forEach(cell => {
      cell.classList.remove('forbidden');
    });
    updateTeacherScheduleStats('formal');
    showToast('已清空所有', 'success');
  }
};

// 更新统计
function updateTeacherScheduleStats(prefix) {
  const select = document.getElementById(`${prefix}-teacher-select`);
  const teacherId = select.value;

  // 当前老师的标记数
  const currentSlots = teacherId ? (window._teacherForbiddenSlots[teacherId] || new Set()) : new Set();
  document.getElementById(`${prefix}-marked-count`).textContent = currentSlots.size;

  // 已保存的老师数
  const savedCount = Object.keys(window._teacherForbiddenSlots).filter(k => window._teacherForbiddenSlots[k].size > 0).length;
  document.getElementById(`${prefix}-saved-count`).textContent = savedCount;
}

// ==================== 临时课表的涂课功能 ====================

// 加载临时课表页面
async function loadTempTimetablePage() {
  try {
    const teachers = await api('/teachers');

    // 加载老师列表到下拉框
    const select = document.getElementById('temp-teacher-select');
    select.innerHTML = '<option value="">选择老师</option>' +
      teachers.map(t => `<option value="${t.id}">${t.name} (${t.id})</option>`).join('');

    // 初始化课表网格
    renderTeacherScheduleGrid('temp-teacher-schedule', 'temp');

    // 更新统计
    updateTeacherScheduleStats('temp');

    // 设置默认日期
    const today = new Date();
    const todayStr = today.toISOString().split('T')[0];
    const nextWeekStr = new Date(today.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    document.getElementById('temp-start-date').value = todayStr;
    document.getElementById('temp-end-date').value = nextWeekStr;

    // 清空之前的结果
    document.getElementById('temp-parse-result').classList.add('hidden');
    document.getElementById('temp-adjustments-section').classList.add('hidden');
    document.getElementById('temp-result').classList.add('hidden');

    tempAdjustments = [];
  } catch (error) {
    console.error('加载临时课表页面失败:', error);
  }
}

// 加载老师的课表（临时课表）
window.loadTeacherScheduleTemp = function() {
  const select = document.getElementById('temp-teacher-select');
  const teacherId = select.value;

  if (!teacherId) {
    document.querySelectorAll('#temp-teacher-schedule .slot-cell').forEach(cell => {
      cell.classList.remove('forbidden');
    });
    document.getElementById('temp-marked-count').textContent = '0';
    return;
  }

  updateTeacherScheduleUI(teacherId, 'temp');
  updateTeacherScheduleStats('temp');
};

// 清空选中老师的禁排时段（临时课表）
window.clearTeacherScheduleTemp = function() {
  const select = document.getElementById('temp-teacher-select');
  const teacherId = select.value;

  if (!teacherId) {
    showToast('请先选择老师', 'warning');
    return;
  }

  if (confirm(`确定要清空 ${teacherId} 的所有禁排时段吗？`)) {
    window._teacherForbiddenSlots[teacherId] = new Set();
    updateTeacherScheduleUI(teacherId, 'temp');
    updateTeacherScheduleStats('temp');
    showToast('已清空', 'success');
  }
};

// 清空所有老师的禁排时段（临时课表）
window.clearAllTeacherSchedulesTemp = function() {
  if (confirm('确定要清空所有老师的禁排时段吗？')) {
    window._teacherForbiddenSlots = {};
    document.querySelectorAll('#temp-teacher-schedule .slot-cell').forEach(cell => {
      cell.classList.remove('forbidden');
    });
    updateTeacherScheduleStats('temp');
    showToast('已清空所有', 'success');
  }
};

// 解析自然语言排课需求
window.parseFormalDescription = async function() {
  const description = document.getElementById('formal-description').value.trim();

  if (!description) {
    showToast('请输入排课需求', 'warning');
    return;
  }

  try {
    showToast('🤖 AI 正在解析...', 'info');

    const resultDiv = document.getElementById('formal-parse-result');
    resultDiv.classList.remove('hidden');
    resultDiv.innerHTML = '<div class="loading">正在解析您的需求...</div>';

    // 调用 AI 解析
    const result = await api('/ai/parse-preference', {
      method: 'POST',
      body: JSON.stringify({ text: description })
    });

    formalConstraints = result.parsed_preferences || [];

    // 显示解析结果
    let html = `
      <div style="margin-bottom: 12px;">
        <strong>🤖 AI 理解的需求：</strong>
      </div>
      <div style="display: flex; flex-wrap: wrap; gap: 8px;">
    `;

    formalConstraints.forEach(c => {
      html += `<span class="preference-tag">${c.description || JSON.stringify(c)}</span>`;
    });

    html += `
      </div>
      <div style="margin-top: 12px; font-size: 13px; color: var(--gray-500);">
        这是对自然语言的审阅结果；请将确认后的硬/软规则保存到“约束管理”页，再执行排课。
      </div>
    `;

    resultDiv.innerHTML = html;

    showToast('✅ 需求解析完成', 'success');
  } catch (error) {
    showToast(error.message, 'error');
  }
};

// 生成多个方案
window.generateMultipleSolutions = async function() {
  const description = document.getElementById('formal-description').value.trim();

  if (!description) {
    showToast('请先输入排课需求', 'warning');
    return;
  }

  try {
    showToast('🤖 AI 正在生成多个方案...', 'info');

    const solutionsDiv = document.getElementById('formal-solutions');
    solutionsDiv.classList.remove('hidden');
    solutionsDiv.innerHTML = '<div class="loading">AI 正在分析需求并生成多个最优解...</div>';

    // 调用 AI 求解
    const result = await api('/ai/solve', {
      method: 'POST',
      body: JSON.stringify({ text: description })
    });

    const solutions = result.solutions || [];

    if (solutions.length === 0) {
      solutionsDiv.innerHTML = '<div class="empty-state"><p>未能生成有效方案，请调整需求</p></div>';
      return;
    }

    // 显示方案列表
    let html = `
      <div style="margin-bottom: 16px;">
        <strong>🎯 AI 生成了 ${solutions.length} 个方案，请选择：</strong>
      </div>
    `;

    solutions.forEach((solution, index) => {
      html += `
        <div class="solution-card" id="solution-${index}" onclick="selectFormalSolution(${index})">
          <div class="solution-header">
            <h4>方案 ${index + 1}</h4>
            <span class="score">得分: ${solution.score || 0}</span>
          </div>
          <div class="solution-details">
            <div>📊 排课数量: ${solution.assignments?.length || 0} 节</div>
            <div>✅ 硬约束违规: ${solution.details?.hard_violations || 0} 个</div>
            <div>⭐ 约束满足度: ${solution.details?.constraint_satisfaction || 0} 分</div>
          </div>
        </div>
      `;
    });

    html += `
      <div style="margin-top: 16px;">
        <button class="btn btn-primary" onclick="applySelectedFormalSolution()">✅ 应用选中方案</button>
        <button class="btn btn-secondary" onclick="generateMultipleSolutions()">🔄 重新生成</button>
      </div>
    `;

    solutionsDiv.innerHTML = html;

    // 保存方案数据
    window._formalSolutions = solutions;
    window._selectedFormalSolution = null;

    showToast('✅ 方案生成完成', 'success');
  } catch (error) {
    showToast(error.message, 'error');
  }
};

// 选择方案
window.selectFormalSolution = function(index) {
  // 取消之前的选中
  document.querySelectorAll('.solution-card').forEach(card => {
    card.classList.remove('selected');
  });

  // 选中当前
  const card = document.getElementById(`solution-${index}`);
  if (card) {
    card.classList.add('selected');
  }

  window._selectedFormalSolution = index;
};

// 应用选中的方案
window.applySelectedFormalSolution = async function() {
  if (window._selectedFormalSolution === null || window._selectedFormalSolution === undefined) {
    showToast('请先选择一个方案', 'warning');
    return;
  }

  const solution = window._formalSolutions[window._selectedFormalSolution];
  if (!solution) {
    showToast('选中的方案无效', 'error');
    return;
  }

  if (!confirm(`确定要应用方案 ${window._selectedFormalSolution + 1} 吗？这将覆盖当前的排课结果。`)) {
    return;
  }

  try {
    showToast('正在应用方案...', 'info');

    // 调用 API 应用方案
    await api('/ai/apply-solution', {
      method: 'POST',
      body: JSON.stringify({
        assignments: solution.assignments,
        seed: solution.seed
      })
    });

    showToast('✅ 方案已应用', 'success');

    // 刷新状态
    await loadFormalSolvePage();

    // 显示成功消息
    const resultDiv = document.getElementById('formal-result');
    const contentDiv = document.getElementById('formal-result-content');
    resultDiv.classList.remove('hidden');
    contentDiv.innerHTML = `
      <div class="validation-result success">
        ✅ 方案 ${window._selectedFormalSolution + 1} 已成功应用！
      </div>
      <div style="margin-top: 16px;">
        <button class="btn btn-primary" onclick="switchView('overview-timetable')">查看总课表</button>
        <button class="btn btn-secondary" onclick="switchView('export')">导出课表</button>
      </div>
    `;
  } catch (error) {
    showToast(error.message, 'error');
  }
};

// 开始正式排课
window.startFormalSolve = async function() {
  const mode = document.getElementById('formal-mode').value;
  const seed = document.getElementById('formal-seed').value;
  const timeout = document.getElementById('formal-timeout').value;
  const keep = document.getElementById('formal-keep').checked;
  const description = document.getElementById('formal-description').value;

  // 确认操作
  let confirmMsg = '';
  switch (mode) {
    case 'all':
      confirmMsg = '确定要生成正式课表吗？这将生成完整的教学任务并排课。';
      break;
    case 'sections':
      confirmMsg = '确定要执行分班吗？这将生成教学任务。';
      break;
    case 'timetable':
      confirmMsg = '确定要执行排课吗？这将在现有教学任务基础上排课。';
      break;
  }

  if (!confirm(confirmMsg)) {
    return;
  }

  try {
    showToast('正在生成正式课表，请稍候...', 'info');

    const resultDiv = document.getElementById('formal-result');
    const contentDiv = document.getElementById('formal-result-content');
    const suggestionsDiv = document.getElementById('formal-suggestions');

    let result;

    if (mode === 'all') {
      // 完整求解：先生成任务，再排课
      await api('/build-tasks', { method: 'POST' });
      result = await solveWithRequiredApproval({
          seed: seed ? parseInt(seed) : undefined,
          timeout: parseInt(timeout) * 1000,
          keep,
          constraints: formalConstraints,
          description
      });
    } else if (mode === 'sections') {
      // 仅分班
      result = await api('/build-tasks', { method: 'POST' });
    } else {
      // 仅排课
      result = await solveWithRequiredApproval({
          seed: seed ? parseInt(seed) : undefined,
          timeout: parseInt(timeout) * 1000,
          keep,
          constraints: formalConstraints,
          description
      });
    }

    // 显示结果
    resultDiv.classList.remove('hidden');

    if (mode === 'sections') {
      contentDiv.innerHTML = `
        <div class="validation-result success">
          ✅ 分班完成！已生成 ${result.tasks_generated} 个教学任务
        </div>
        <div style="margin-top: 12px;">
          <button class="btn btn-primary" onclick="switchView('class-timetable')">查看班级课表</button>
          <button class="btn btn-secondary" onclick="switchView('overview-timetable')">查看总课表</button>
        </div>
      `;
    } else if (!result.solved) {
      contentDiv.innerHTML = `<div class="validation-result warning">⚠️ 未生成课表：${result.reason || '未获批准放宽受保护规则'}</div>`;
    } else {
      const hasViolations = result.hard_violations && result.hard_violations.length > 0;
      const needsReview = result.publication_status === 'review_required';

      if (hasViolations) {
        // 有违规，显示违规详情和AI建议
        contentDiv.innerHTML = `
          <div class="validation-result warning">
            ⚠️ 排课完成，但有 ${result.hard_violations.length} 个硬约束违规
          </div>
          <div style="margin-top: 16px;">
            <h4>违规详情：</h4>
            ${result.hard_violations.map(v => `
              <div class="violation-item">
                <div class="constraint-id">${v.constraint_id || 'H?'}</div>
                <div class="reason">${v.reason}</div>
              </div>
            `).join('')}
          </div>
          <div style="margin-top: 16px;">
            <p>软约束得分: <strong>${result.soft_score || 0}</strong></p>
            <p>排课数量: <strong>${result.assignments?.length || 0}</strong> 节</p>
          </div>
          <div style="margin-top: 16px;">
            <button class="btn btn-primary" onclick="requestAISuggestions()">🤖 请求 AI 优化建议</button>
            <button class="btn btn-secondary" onclick="switchView('overview-timetable')">查看当前课表</button>
          </div>
        `;

        // 自动请求AI建议
        await window.requestAISuggestions();
      } else if (needsReview) {
        const qualityIssues = result.quality_gate?.issues || [];
        contentDiv.innerHTML = `
          <div class="validation-result warning">
            ⚠️ 课表已生成并通过物理硬约束校验，但质量或规则降级状态需要人工复核，当前不能视为正式发布
          </div>
          <div style="margin-top: 16px;">
            ${result.policy_relaxed ? `<p><strong>硬规则降级：</strong>${(result.approved_hard_rule_relaxations || []).join('、') || '已审批'}</p>` : ''}
            ${qualityIssues.map(item => `<p><strong>质量门槛：</strong>${item.message}</p>`).join('')}
            <p>AP Block 第一节目标: <strong>${result.ap_block_first_period_actual_count || 0} / ${result.ap_block_first_period_target_count || 0}</strong>（偏差 ${result.ap_block_first_period_deviation || 0}）</p>
            <p>AP Block 第1–6节: <strong>${Math.max(0, (result.ap_block_preferred_band_term_count ?? result.ap_block_morning_term_count ?? 0) - (result.ap_block_outside_preferred_band_occurrences ?? result.ap_block_afternoon_occurrences ?? 0))} / ${result.ap_block_preferred_band_term_count ?? result.ap_block_morning_term_count ?? 0}</strong></p>
            <p>AP 上午空节: <strong>${result.quality_gate?.metrics?.ap_morning_empty_student_periods || 0}</strong> 个学生节次</p>
            <p>AP 第一节空窗: <strong>${result.quality_gate?.metrics?.ap_first_period_gap_days || 0}</strong> 个学生日</p>
            <p>软约束得分: <strong>${result.soft_score || 0}</strong></p>
            <p>排课数量: <strong>${result.assignments?.length || 0}</strong> 节</p>
          </div>
          <div style="margin-top: 16px;">
            <button class="btn btn-secondary" onclick="switchView('overview-timetable')">查看待复核课表</button>
          </div>
        `;
      } else {
        contentDiv.innerHTML = `
          <div class="validation-result success">
            ✅ 正式课表生成成功！所有硬约束满足
          </div>
          <div style="margin-top: 12px;">
            <p>AP Block 第一节目标: <strong>${result.ap_block_first_period_actual_count || 0} / ${result.ap_block_first_period_target_count || 0}</strong>（偏差 ${result.ap_block_first_period_deviation || 0}）</p>
            <p>AP Block 第1–6节: <strong>${Math.max(0, (result.ap_block_preferred_band_term_count ?? result.ap_block_morning_term_count ?? 0) - (result.ap_block_outside_preferred_band_occurrences ?? result.ap_block_afternoon_occurrences ?? 0))} / ${result.ap_block_preferred_band_term_count ?? result.ap_block_morning_term_count ?? 0}</strong></p>
            <p>软约束得分: <strong>${result.soft_score || 0}</strong></p>
            <p>排课数量: <strong>${result.assignments?.length || 0}</strong> 节</p>
          </div>
          <div style="margin-top: 16px;">
            <button class="btn btn-primary" onclick="switchView('overview-timetable')">查看总课表</button>
            <button class="btn btn-secondary" onclick="switchView('export')">导出课表</button>
          </div>
        `;
      }
    }

    // 更新状态
    await loadFormalSolvePage();

    showToast(
      result.publication_status === 'review_required'
        ? '课表已生成，但质量或规则降级状态待人工复核'
        : '正式课表生成完成！',
      result.publication_status === 'review_required' ? 'warning' : 'success',
    );
  } catch (error) {
    showToast(error.message, 'error');
  }
};

// 请求AI优化建议
window.requestAISuggestions = async function() {
  try {
    showToast('🤖 AI 正在分析优化方案...', 'info');

    const suggestionsDiv = document.getElementById('formal-suggestions');
    const contentDiv = document.getElementById('formal-suggestions-content');

    suggestionsDiv.classList.remove('hidden');
    contentDiv.innerHTML = '<div class="loading">AI 正在分析约束冲突并生成优化建议...</div>';

    // 获取当前状态
    const [validation, tasks, courses, teachers, rooms] = await Promise.all([
      api('/validate'),
      api('/teaching_tasks'),
      api('/courses'),
      api('/teachers'),
      api('/rooms')
    ]);

    // 调用 AI 生成建议
    const result = await api('/ai/suggest-fixes', {
      method: 'POST',
      body: JSON.stringify({
        violations: validation.hard_violations_details || [],
        tasks,
        courses,
        teachers,
        rooms,
        constraints: formalConstraints
      })
    });

    // 显示分析
    let html = '';

    if (result.analysis) {
      html += `
        <div style="background-color: #e3f2fd; border-radius: var(--radius); padding: 16px; margin-bottom: 20px;">
          <h4 style="margin: 0 0 8px 0; color: #1565c0;">🔍 问题分析</h4>
          <p style="margin: 0; color: var(--gray-700); line-height: 1.6;">${result.analysis}</p>
        </div>
      `;
    }

    // 显示建议
    if (result.suggestions && result.suggestions.length > 0) {
      html += `
        <div style="margin-bottom: 16px; color: var(--gray-600);">
          AI 生成了 ${result.suggestions.length} 条优化建议，选择接受或拒绝：
        </div>
      `;

      result.suggestions.forEach((suggestion, index) => {
        html += `
          <div class="suggestion-item" id="suggestion-${index}">
            <div class="suggestion-header">
              <h4>${suggestion.title || `方案 ${index + 1}`}</h4>
              <span class="badge" style="background-color: #f3e5f5; color: #7b1fa2;">${suggestion.type || '优化方案'}</span>
            </div>
            <div class="suggestion-body">
              <p style="margin: 0 0 12px 0;">${suggestion.description || ''}</p>

              ${suggestion.steps && suggestion.steps.length > 0 ? `
                <div style="margin-bottom: 12px;">
                  <strong style="font-size: 13px;">实施步骤：</strong>
                  <ol style="margin: 8px 0 0 0; padding-left: 20px; font-size: 13px;">
                    ${suggestion.steps.map(step => `<li>${step}</li>`).join('')}
                  </ol>
                </div>
              ` : ''}

              <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px; font-size: 13px;">
                ${suggestion.pros && suggestion.pros.length > 0 ? `
                  <div>
                    <strong style="color: #2e7d32;">✅ 优点：</strong>
                    <ul style="margin: 4px 0 0 0; padding-left: 16px;">
                      ${suggestion.pros.map(pro => `<li>${pro}</li>`).join('')}
                    </ul>
                  </div>
                ` : ''}

                ${suggestion.cons && suggestion.cons.length > 0 ? `
                  <div>
                    <strong style="color: #c62828;">⚠️ 缺点：</strong>
                    <ul style="margin: 4px 0 0 0; padding-left: 16px;">
                      ${suggestion.cons.map(con => `<li>${con}</li>`).join('')}
                    </ul>
                  </div>
                ` : ''}
              </div>

              ${suggestion.impact ? `
                <div style="margin-top: 12px; padding: 8px 12px; background-color: #fff3e0; border-radius: 4px; font-size: 13px;">
                  <strong>💡 连锁影响：</strong> ${suggestion.impact}
                </div>
              ` : ''}

              ${suggestion.confidence ? `
                <div style="margin-top: 8px; font-size: 12px; color: var(--gray-500);">
                  AI 置信度：${Math.round(suggestion.confidence * 100)}%
                </div>
              ` : ''}
            </div>
            <div class="suggestion-actions">
              <button class="btn btn-primary btn-sm" onclick="acceptSuggestion(${index})">✅ 接受此方案</button>
              <button class="btn btn-secondary btn-sm" onclick="rejectSuggestion(${index})">❌ 拒绝</button>
            </div>
          </div>
        `;
      });

      contentDiv.innerHTML = html;
    } else {
      contentDiv.innerHTML = `
        <div class="empty-state">
          <p>AI 未能生成优化建议，可能需要手动调整约束条件</p>
        </div>
      `;
    }

    showToast('✅ AI 建议生成完成', 'success');
  } catch (error) {
    showToast(error.message, 'error');
  }
};

// 接受建议
window.acceptSuggestion = async function(index) {
  try {
    showToast('正在应用建议...', 'info');

    // 这里可以调用 API 应用建议
    // await api('/ai/apply-suggestion', { method: 'POST', body: JSON.stringify({ index }) });

    // 更新UI
    const item = document.getElementById(`suggestion-${index}`);
    if (item) {
      item.classList.add('accepted');
      item.querySelector('.suggestion-actions').innerHTML = '<span style="color: #2e7d32; font-weight: 600;">✅ 已接受</span>';
    }

    showToast('建议已接受', 'success');
  } catch (error) {
    showToast(error.message, 'error');
  }
};

// 拒绝建议
window.rejectSuggestion = function(index) {
  const item = document.getElementById(`suggestion-${index}`);
  if (item) {
    item.classList.add('rejected');
    item.querySelector('.suggestion-actions').innerHTML = '<span style="color: #c62828; font-weight: 600;">❌ 已拒绝</span>';
  }
};

// 重置正式排课
window.resetFormalSolve = async function() {
  if (!confirm('确定要重置正式课表吗？这将清除所有已排课程。')) {
    return;
  }

  try {
    showToast('重置功能待实现', 'info');
  } catch (error) {
    showToast(error.message, 'error');
  }
};

// ==================== 临时课表功能 ====================

// 临时课表数据
let tempAdjustments = [];

// AI 解析临时调课描述
window.parseTempDescription = async function() {
  const description = document.getElementById('temp-description').value.trim();

  if (!description) {
    showToast('请输入临时调课描述', 'warning');
    return;
  }

  try {
    showToast('🤖 AI 正在解析...', 'info');

    const resultDiv = document.getElementById('temp-parse-result');
    resultDiv.classList.remove('hidden');
    resultDiv.innerHTML = '<div class="loading">正在解析您的描述...</div>';

    // 调用 AI 解析
    const result = await fetch('/api/ai/parse-temp-timetable', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ description })
    }).then(r => r.json());

    if (!result.ok) {
      throw new Error(result.errors?.[0]?.msg || '解析失败');
    }

    // 显示解析结果
    tempAdjustments = result.data.adjustments || [];

    renderTempParseResult(result.data);
    renderTempAdjustments();

    showToast(`✅ 解析完成，共 ${tempAdjustments.length} 项调整`, 'success');
  } catch (error) {
    showToast(error.message, 'error');
    document.getElementById('temp-parse-result').innerHTML =
      `<div style="color: var(--danger);">解析失败: ${error.message}</div>`;
  }
};

// 渲染解析结果
function renderTempParseResult(data) {
  const resultDiv = document.getElementById('temp-parse-result');

  let html = `
    <div style="margin-bottom: 12px;">
      <strong>🤖 AI 理解：</strong>
    </div>
    <div style="background-color: var(--white); padding: 12px; border-radius: var(--radius); margin-bottom: 12px;">
      ${data.summary || '已完成解析'}
    </div>
    <div style="font-size: 13px; color: var(--gray-500);">
      共解析出 ${data.adjustments?.length || 0} 项调整
    </div>
  `;

  resultDiv.innerHTML = html;
}

// 渲染调整项
function renderTempAdjustments() {
  const section = document.getElementById('temp-adjustments-section');
  const container = document.getElementById('temp-adjustments');

  section.classList.remove('hidden');

  if (tempAdjustments.length === 0) {
    container.innerHTML = '<div class="empty-state"><p>暂无调整项</p></div>';
    return;
  }

  container.innerHTML = tempAdjustments.map((adj, index) => {
    const typeClass = adj.action;
    const typeLabel = adj.action === 'cancel' ? '取消' : adj.action === 'move' ? '移动' : '交换';

    return `
      <div class="temp-adjustment-card ${typeClass}">
        <div class="temp-adjustment-header">
          <h4>${adj.course_name || adj.task_id}</h4>
          <div>
            <span class="badge ${typeClass}">${typeLabel}</span>
            <button class="btn btn-danger btn-sm" onclick="removeTempAdjustmentByIndex(${index})" style="margin-left: 8px;">✕</button>
          </div>
        </div>
        <div class="temp-adjustment-body">
          <div><span class="label">教师：</span>${adj.teacher_name || '-'}</div>
          <div><span class="label">原时段：</span>${adj.original_slot || '-'}</div>
          ${adj.new_slot ? `<div><span class="label">新时段：</span>${adj.new_slot}</div>` : ''}
          ${adj.target_course_name ? `<div><span class="label">交换对象：</span>${adj.target_course_name}</div>` : ''}
          ${adj.reason ? `<div><span class="label">原因：</span>${adj.reason}</div>` : ''}
        </div>
      </div>
    `;
  }).join('');
}

// 删除调整项
window.removeTempAdjustmentByIndex = function(index) {
  tempAdjustments.splice(index, 1);
  renderTempAdjustments();
};

// 手动添加调整项
window.addTempAdjustment = function() {
  // 获取当前任务列表
  api('/teaching_tasks').then(tasks => {
    api('/courses').then(courses => {
      api('/teachers').then(teachers => {
        const options = tasks.map(t => {
          const course = courses.find(c => c.id === t.course_id);
          const teacher = teachers.find(te => te.id === t.teacher_id);
          return `<option value="${t.id}">${course?.name || t.course_id} - ${teacher?.name || t.teacher_id}</option>`;
        }).join('');

        showModal('手动添加调整', `
          <form id="form-add-temp-adjustment">
            <div class="form-group">
              <label>选择课程</label>
              <select name="task_id" class="select" required>
                <option value="">选择课程</option>
                ${options}
              </select>
            </div>
            <div class="form-group">
              <label>操作类型</label>
              <select name="action" class="select" required>
                <option value="cancel">取消</option>
                <option value="move">移动到</option>
                <option value="swap">与...交换</option>
              </select>
            </div>
            <div class="form-group">
              <label>目标时段（移动/交换时填写）</label>
              <input type="text" name="target" class="input" placeholder="如 D3P6">
            </div>
            <div class="form-group">
              <label>原因</label>
              <input type="text" name="reason" class="input" placeholder="可选">
            </div>
            <div class="form-actions">
              <button type="button" class="btn btn-secondary" onclick="hideModal()">取消</button>
              <button type="submit" class="btn btn-primary">添加</button>
            </div>
          </form>
        `);

        document.getElementById('form-add-temp-adjustment').addEventListener('submit', async (e) => {
          e.preventDefault();
          const formData = new FormData(e.target);
          const taskId = formData.get('task_id');
          const action = formData.get('action');
          const target = formData.get('target');
          const reason = formData.get('reason');

          const task = tasks.find(t => t.id === taskId);
          const course = courses.find(c => c.id === task?.course_id);
          const teacher = teachers.find(t => t.id === task?.teacher_id);

          tempAdjustments.push({
            task_id: taskId,
            action,
            target,
            reason,
            course_name: course?.name || taskId,
            teacher_name: teacher?.name || '-',
            original_slot: '-',
            new_slot: target || '-'
          });

          hideModal();
          renderTempAdjustments();
        });
      });
    });
  });
};

// 清空描述
window.clearTempDescription = function() {
  document.getElementById('temp-description').value = '';
  document.getElementById('temp-parse-result').classList.add('hidden');
  tempAdjustments = [];
  renderTempAdjustments();
};

// 生成临时课表
window.generateTempTimetable = async function() {
  const startDate = document.getElementById('temp-start-date').value;
  const endDate = document.getElementById('temp-end-date').value;
  const description = document.getElementById('temp-description').value;

  if (!startDate || !endDate) {
    showToast('请选择生效日期和截止日期', 'warning');
    return;
  }

  if (tempAdjustments.length === 0) {
    showToast('请先解析或添加调整项', 'warning');
    return;
  }

  try {
    showToast('正在生成临时课表...', 'info');

    const resultDiv = document.getElementById('temp-result');
    const contentDiv = document.getElementById('temp-result-content');

    resultDiv.classList.remove('hidden');

    let html = `
      <div style="margin-bottom: 16px; padding: 12px; background-color: var(--gray-100); border-radius: var(--radius);">
        <p><strong>生效日期：</strong>${startDate}</p>
        <p><strong>截止日期：</strong>${endDate}</p>
        <p><strong>调整数量：</strong>${tempAdjustments.length} 项</p>
        ${description ? `<p><strong>描述：</strong>${description}</p>` : ''}
      </div>
      <div class="temp-changes">
    `;

    tempAdjustments.forEach(change => {
      const typeClass = change.action;
      const typeLabel = change.action === 'cancel' ? '取消' : change.action === 'move' ? '移动' : '交换';

      html += `
        <div class="temp-change-item ${typeClass}">
          <div class="change-type">【${typeLabel}】${change.course_name}</div>
          <div class="change-detail">
      `;

      if (change.action === 'cancel') {
        html += `教师：${change.teacher_name} | 原时段：${change.original_slot || '-'}`;
      } else if (change.action === 'move') {
        html += `教师：${change.teacher_name} | ${change.original_slot || '-'} → ${change.new_slot || '-'}`;
      } else if (change.action === 'swap') {
        html += `与 ${change.target_course_name || '未知课程'} 交换时段`;
      }

      if (change.reason) {
        html += ` | 原因：${change.reason}`;
      }

      html += `
          </div>
        </div>
      `;
    });

    html += '</div>';

    // 添加导出按钮
    html += `
      <div class="export-temp-section">
        <button class="btn btn-primary" onclick="exportTempTimetable()">📤 导出临时课表</button>
        <button class="btn btn-secondary" onclick="printTempTimetable()">🖨️ 打印</button>
      </div>
    `;

    contentDiv.innerHTML = html;

    showToast('临时课表生成成功！', 'success');
  } catch (error) {
    showToast(error.message, 'error');
  }
};

// 导出临时课表
window.exportTempTimetable = function() {
  const startDate = document.getElementById('temp-start-date').value;
  const endDate = document.getElementById('temp-end-date').value;
  const description = document.getElementById('temp-description').value;

  // 获取变化内容
  const changesHtml = document.querySelector('.temp-changes')?.innerHTML || '';

  const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <title>临时课表 ${startDate} - ${endDate}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; padding: 20px; }
    h1 { color: #333; text-align: center; }
    .info { margin: 20px 0; padding: 15px; background-color: #f5f5f5; border-radius: 8px; }
    .info p { margin: 5px 0; }
    .change-item { padding: 12px; margin: 10px 0; border-radius: 8px; border: 1px solid #ddd; }
    .change-item.cancel { background-color: #ffebee; border-color: #ef9a9a; }
    .change-item.move { background-color: #e3f2fd; border-color: #90caf9; }
    .change-item.swap { background-color: #e8f5e9; border-color: #a5d6a7; }
    .change-type { font-weight: bold; margin-bottom: 5px; }
    .change-detail { font-size: 14px; color: #666; }
  </style>
</head>
<body>
  <h1>📙 临时课表</h1>
  <div class="info">
    <p><strong>生效日期：</strong>${startDate}</p>
    <p><strong>截止日期：</strong>${endDate}</p>
    ${description ? `<p><strong>描述：</strong>${description}</p>` : ''}
  </div>
  <div class="changes">
    ${changesHtml}
  </div>
  <p style="margin-top: 30px; color: #999; font-size: 12px; text-align: center;">
    生成时间: ${new Date().toLocaleString('zh-CN')}
  </p>
</body>
</html>`;

  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `临时课表_${startDate}_${endDate}.html`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
};

// 打印临时课表
window.printTempTimetable = function() {
  window.print();
};

// ==================== 设置功能 ====================

// 加载设置页面
async function loadSettingsPage() {
  try {
    // 加载当前设置
    await Promise.all([loadSettings(), window.loadSchedulingPolicy()]);

    // 加载系统信息
    const [status, tasks] = await Promise.all([
      api('/status'),
      api('/teaching_tasks')
    ]);

    document.getElementById('settings-student-count').textContent = status.counts?.students || 0;
    document.getElementById('settings-task-count').textContent = tasks.length || 0;

    // 检查 AI 状态
    checkAIStatus();
  } catch (error) {
    console.error('加载设置页面失败:', error);
  }
}

function graduationEscapeHtml(value) {
  return escapeHtml(value);
}

function graduationCourseName(courseId, coursesById) {
  return coursesById.get(courseId)?.name || courseId || '—';
}

function graduationCourseList(courseIds, coursesById) {
  const names = (courseIds || []).filter(Boolean).map(courseId => graduationCourseName(courseId, coursesById));
  return names.length ? names.join('、') : '—';
}

function graduationElectiveChoices(choices, coursesById) {
  const entries = Object.entries(choices || {}).filter(([, courseId]) => courseId);
  if (!entries.length) return '—';
  return entries.map(([group, courseId]) => {
    const label = group.replace(/^group_/i, '').toUpperCase() || group;
    return `${label} 组：${graduationCourseName(courseId, coursesById)}`;
  }).join('；');
}

function graduationMatches(student, coursesById, keyword) {
  if (!keyword) return true;
  const searchable = [
    student.student_id,
    student.chinese_name,
    student.english_name,
    student.pinyin_name,
    student.admin_class_id,
    student.teaching_class_id,
    graduationCourseList(student.ap_courses, coursesById),
    graduationCourseList(student.elective_courses, coursesById),
    graduationElectiveChoices(student.elective_choices, coursesById),
  ].join(' ').toLowerCase();
  return searchable.includes(keyword.toLowerCase());
}

function renderGraduationArchive() {
  const content = document.getElementById('graduation-archives-content');
  const detail = window._graduationArchiveDetail;
  const keyword = document.getElementById('search-graduation-students')?.value.trim() || '';
  if (!detail) {
    content.textContent = '请选择一份毕业归档。';
    return;
  }
  const summary = detail.summary || {};
  const coursesById = new Map((detail.course_catalog || []).map(course => [course.id, course]));
  const students = (detail.students || [])
    .filter(student => graduationMatches(student, coursesById, keyword))
    .sort((left, right) => String(left.student_id).localeCompare(String(right.student_id), 'zh-CN', { numeric: true }));
  const rows = students.map(student => `
    <tr>
      <td>${graduationEscapeHtml(student.student_id)}</td>
      <td>${graduationEscapeHtml(student.chinese_name)}</td>
      <td>${graduationEscapeHtml(student.english_name || '—')}</td>
      <td>${graduationEscapeHtml(student.admin_class_id || '—')}<br><span class="graduation-muted">${graduationEscapeHtml(student.teaching_class_id || '—')}</span></td>
      <td>${graduationEscapeHtml(graduationCourseList(student.ap_courses, coursesById))}</td>
      <td>${graduationEscapeHtml(graduationCourseList(student.elective_courses, coursesById))}</td>
      <td>${graduationEscapeHtml(graduationElectiveChoices(student.elective_choices, coursesById))}</td>
    </tr>`).join('');
  content.innerHTML = `
    <div class="graduation-summary-grid">
      <div class="graduation-summary-card"><span>毕业学生</span><strong>${Number(summary.graduate_count) || 0} 人</strong></div>
      <div class="graduation-summary-card"><span>AP 选课记录</span><strong>${Number(summary.ap_course_entries) || 0} 条</strong></div>
      <div class="graduation-summary-card"><span>其他选修记录</span><strong>${Number(summary.elective_course_entries) || 0} 条</strong></div>
      <div class="graduation-summary-card"><span>高三选修选择</span><strong>${Number(summary.elective_choice_entries) || 0} 条</strong></div>
      <div class="graduation-summary-card"><span>归档时间</span><strong>${graduationEscapeHtml(String(summary.graduated_at || '').replace('T', ' ').slice(0, 19) || '—')}</strong></div>
    </div>
    <p class="graduation-archive-note">确认人：${graduationEscapeHtml(summary.confirmed_by || '管理员')}。当前显示 ${students.length}/${(detail.students || []).length} 名毕业学生；当时在校学生的 ${Number(summary.cleared_active_selection_entries) || 0} 条选修信息已按新学年规则清空。</p>
    <div class="table-container graduation-table-container">
      <table class="graduation-table">
        <thead><tr><th>Student ID</th><th>中文姓名</th><th>英文名</th><th>毕业时班级<br><span>行政班 / 教学班</span></th><th>AP 选课</th><th>其他选修</th><th>高三选修</th></tr></thead>
        <tbody>${rows || '<tr><td colspan="7" class="empty-cell">没有匹配的毕业学生</td></tr>'}</tbody>
      </table>
    </div>
    `;
}

async function loadGraduationArchiveDetail(archiveId) {
  if (!archiveId) {
    window._graduationArchiveDetail = null;
    renderGraduationArchive();
    return;
  }
  document.getElementById('graduation-archives-content').textContent = '正在加载毕业学生选课快照…';
  window._graduationArchiveDetail = await api(`/graduation-archives/${encodeURIComponent(archiveId)}`);
  renderGraduationArchive();
}

async function loadGraduationArchives() {
  const [archives] = await Promise.all([api('/graduation-archives')]);
  const selector = document.getElementById('select-graduation-archive');
  const search = document.getElementById('search-graduation-students');
  const previous = selector.value;
  selector.innerHTML = archives.length
    ? archives.map(archive => `<option value="${graduationEscapeHtml(archive.id)}">${graduationEscapeHtml(archive.name)} · ${archive.graduate_count || 0} 人</option>`).join('')
    : '<option value="">暂无毕业归档</option>';
  selector.disabled = !archives.length;
  search.disabled = !archives.length;
  search.value = '';
  selector.onchange = () => loadGraduationArchiveDetail(selector.value);
  search.oninput = renderGraduationArchive;
  if (!archives.length) {
    window._graduationArchiveDetail = null;
    document.getElementById('graduation-archives-content').innerHTML = '<div class="empty-state">暂无毕业学生选课信息。完成“系统设置 → 学生毕业”后，原 Senior 3 学生的选课快照会出现在这里。</div>';
    return;
  }
  const selected = archives.some(archive => archive.id === previous) ? previous : archives[0].id;
  selector.value = selected;
  await loadGraduationArchiveDetail(selected);
}

window.openStudentGraduationConfirmation = async function() {
  const button = document.getElementById('btn-student-graduation');
  button.disabled = true;
  try {
    const preview = await api('/graduation/preview');
    const selectionTotals = preview.preserved_graduate_selection_totals || {};
    const activeSelectionTotals = preview.active_selection_totals_to_clear || {};
    const resets = (preview.resets || []).map(item => `<li>${graduationEscapeHtml(item)}</li>`).join('');
    showModal('确认学生毕业', `
      <div class="graduation-confirmation">
        <p class="graduation-danger-copy"><strong>请管理员确认：</strong>这是每学年一次的操作，确认后会立即变更当前学生库。</p>
        <div class="graduation-confirmation-counts">
          <span>归档 Senior 3：<strong>${Number(preview.graduating_students) || 0} 人</strong></span>
          <span>Senior 1 → Senior 2：<strong>${Number(preview.promoted_students?.senior_1_to_senior_2) || 0} 人</strong></span>
          <span>Senior 2 → Senior 3：<strong>${Number(preview.promoted_students?.senior_2_to_senior_3) || 0} 人</strong></span>
        </div>
        <p>毕业学生选课会保存 ${Number(selectionTotals.ap_course_entries) || 0} 条 AP 记录、${Number(selectionTotals.elective_course_entries) || 0} 条其他选修记录和 ${Number(selectionTotals.elective_choice_entries) || 0} 条高三选修选择。</p>
        <p class="graduation-danger-copy"><strong>新学年重新选课：</strong>继续在校学生的全部选修信息将清空（${Number(activeSelectionTotals.ap_course_entries) || 0} 条 AP、${Number(activeSelectionTotals.elective_course_entries) || 0} 条其他选修、${Number(activeSelectionTotals.elective_choice_entries) || 0} 条 A/B/C 选课组）。</p>
        <ul class="graduation-reset-list">${resets}</ul>
        <label class="form-group">管理员姓名（选填）<input id="graduation-confirmed-by" class="input" maxlength="80" placeholder="例如：教务处管理员"></label>
        <label class="form-group">请输入 <strong>${graduationEscapeHtml(preview.confirmation_phrase)}</strong> 以确认<input id="graduation-confirmation-input" class="input" autocomplete="off" placeholder="${graduationEscapeHtml(preview.confirmation_phrase)}"></label>
        <div class="form-actions">
          <button type="button" class="btn btn-secondary" id="btn-cancel-graduation">取消</button>
          <button type="button" class="btn btn-danger" id="btn-confirm-graduation" disabled>确认学生毕业</button>
        </div>
      </div>`);
    const confirmationInput = document.getElementById('graduation-confirmation-input');
    const confirmButton = document.getElementById('btn-confirm-graduation');
    document.getElementById('btn-cancel-graduation').onclick = hideModal;
    confirmationInput.oninput = () => {
      confirmButton.disabled = confirmationInput.value.trim() !== preview.confirmation_phrase;
    };
    confirmButton.onclick = async () => {
      confirmButton.disabled = true;
      try {
        const result = await api('/graduation/confirm', {
          method: 'POST',
          body: JSON.stringify({
            confirmation: confirmationInput.value.trim(),
            confirmed_by: document.getElementById('graduation-confirmed-by').value.trim() || '管理员',
            expected_revision: preview.expected_revision,
          }),
        });
        hideModal();
        showToast(`${result.message} 已保留 ${result.incoming_senior_1_slots?.admin || 0} 个 Senior 1 行政班槽位和 ${result.incoming_senior_1_slots?.teaching || 0} 个教学班槽位。`, 'success');
        await switchView('graduation-archives');
      } catch {
        confirmButton.disabled = false;
      }
    };
    confirmationInput.focus();
  } finally {
    button.disabled = false;
  }
};

// 加载设置
async function loadSettings() {
  try {
    const response = await fetch('/api/settings');
    const result = await response.json();

    if (result.ok && result.data) {
      document.getElementById('settings-api-key').value = result.data.apiKey || '';
      document.getElementById('settings-api-url').value = result.data.apiUrl || 'https://api.deepseek.com';
      document.getElementById('settings-model').value = result.data.model || 'deepseek-v4-flash';
    }
  } catch (error) {
    console.error('加载设置失败:', error);
  }
}

window.loadSchedulingPolicy = async function() {
  try {
    const policy = await api('/scheduling-policy');
    document.getElementById('policy-ap-periods').value = policy.ap_block.preferred_periods.join(',');
    document.getElementById('policy-ap-first-target').value = policy.ap_block.first_period_target;
    document.getElementById('policy-ap-band-weight').value = policy.ap_block.preferred_band_weight;
    document.getElementById('policy-ap-first-weight').value = policy.ap_block.first_period_weight;
    document.getElementById('policy-ap-compact-weight').value = policy.ap_block.student_compactness_weight;
    document.getElementById('policy-max-gap-days').value = policy.quality_limits.max_ap_student_gap_days;
    document.getElementById('policy-max-morning-empty').value = policy.quality_limits.max_ap_morning_empty_student_periods;
    const status = document.getElementById('policy-save-status');
    if (status) status.textContent = '当前显示的是后端实际生效值。';
  } catch (error) {
    const status = document.getElementById('policy-save-status');
    if (status) status.textContent = `读取失败：${error.message}`;
  }
};

window.saveSchedulingPolicy = async function() {
  const periods = document.getElementById('policy-ap-periods').value
    .split(/[,，\s]+/).filter(Boolean).map(Number);
  const policy = {
    ap_block: {
      preferred_periods: periods,
      first_period_target: Number(document.getElementById('policy-ap-first-target').value),
      preferred_band_weight: Number(document.getElementById('policy-ap-band-weight').value),
      first_period_weight: Number(document.getElementById('policy-ap-first-weight').value),
      student_compactness_weight: Number(document.getElementById('policy-ap-compact-weight').value),
    },
    quality_limits: {
      max_ap_student_gap_days: Number(document.getElementById('policy-max-gap-days').value),
      max_ap_morning_empty_student_periods: Number(document.getElementById('policy-max-morning-empty').value),
    },
  };
  try {
    await api('/scheduling-policy', { method: 'PUT', body: JSON.stringify(policy) });
    document.getElementById('policy-save-status').textContent = '已保存；下一次排课按新策略执行，现有课表已标记为需要重排。';
    showToast('排课策略已保存', 'success');
  } catch (error) {
    document.getElementById('policy-save-status').textContent = `保存失败：${error.message}`;
  }
};

window.analyzeQualityLowerBounds = async function() {
  const button = document.getElementById('policy-analyze-bounds');
  const output = document.getElementById('policy-lower-bound-result');
  const budget = Number(document.getElementById('policy-analysis-budget').value || 120);
  button.disabled = true;
  output.className = 'settings-test-result testing';
  output.textContent = `正在冻结当前 Section 分班，分别最小化 AP 学生空堂日和上午空节；总预算约 ${budget} 秒。即使完成，也可能只能得到未证明的最好已知值…`;
  try {
    const result = await api('/schedule-quality-lower-bounds', {
      method: 'POST',
      body: JSON.stringify({ max_time_seconds: budget }),
    });
    const gap = result.ap_student_gap_days;
    const morning = result.ap_morning_empty_student_periods;
    const scope = result.analysis_scope || {};
    output.className = 'settings-test-result success';
    output.innerHTML = `
      <strong>质量极限分析完成</strong>
      <p>AP 学生空堂日：${escapeHtml(qualityMetricSummary(gap))}</p>
      <p>AP 上午空节学生节次：${escapeHtml(qualityMetricSummary(morning))}</p>
      <p><strong>分析范围：</strong>${escapeHtml(scope.note || '冻结当前 Section 分班；保留金框；硬约束不变；一次只优化一个指标。')}</p>
      <p>${escapeHtml(result.interpretation)}</p>
      <p>${escapeHtml(result.budget?.note || '未证明的数字仅供决策参考。')}</p>
      <p>用时 ${(Number(result.solve_duration_ms || 0) / 1000).toFixed(1)} 秒；结果已与当前课表版本一起记录。</p>
    `;
  } catch (error) {
    output.className = 'settings-test-result error';
    output.textContent = `分析失败：${error.message}`;
  } finally {
    button.disabled = false;
  }
};

// 保存设置
window.saveSettings = async function() {
  const apiKey = document.getElementById('settings-api-key').value.trim();
  const apiUrl = document.getElementById('settings-api-url').value.trim();
  const model = document.getElementById('settings-model').value;

  if (!apiKey) {
    showToast('请输入 API 密钥', 'warning');
    return;
  }

  try {
    showToast('正在保存设置...', 'info');

    const response = await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ apiKey, apiUrl, model })
    });

    const result = await response.json();

    if (result.ok) {
      showToast('✅ 设置已保存', 'success');
      checkAIStatus();
    } else {
      showToast('保存失败: ' + (result.errors?.[0]?.msg || '未知错误'), 'error');
    }
  } catch (error) {
    showToast('保存失败: ' + error.message, 'error');
  }
}

// 测试连接
window.testSettingsConnection = async function() {
  const resultDiv = document.getElementById('settings-test-result');
  resultDiv.className = 'settings-test-result testing';
  resultDiv.textContent = '🔄 正在测试连接...';

  try {
    const startTime = Date.now();

    const response = await fetch('/api/ai/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: '你好，请回复"连接成功"' })
    });

    const result = await response.json();
    const endTime = Date.now();
    const latency = endTime - startTime;

    if (result.ok) {
      resultDiv.className = 'settings-test-result success';
      // P1-7 fix: textContent 防 LLM 输出 XSS 注入
      resultDiv.textContent = `✅ 连接成功！响应时间: ${latency}ms AI回复: ${result.data.response}`;
      document.getElementById('settings-ai-status').textContent = '✅ 正常';
      document.getElementById('settings-ai-status').style.color = '#2e7d32';
    } else {
      resultDiv.className = 'settings-test-result error';
      resultDiv.textContent = `❌ 连接失败: ${result.errors?.[0]?.msg || '未知错误'}`;
      document.getElementById('settings-ai-status').textContent = '❌ 异常';
      document.getElementById('settings-ai-status').style.color = '#c62828';
    }
  } catch (error) {
    resultDiv.className = 'settings-test-result error';
    resultDiv.textContent = `❌ 连接失败: ${error.message}`;
    document.getElementById('settings-ai-status').textContent = '❌ 异常';
    document.getElementById('settings-ai-status').style.color = '#c62828';
  }
}

// 检查 AI 状态
async function checkAIStatus() {
  const statusEl = document.getElementById('settings-ai-status');
  statusEl.textContent = '检查中...';
  statusEl.style.color = 'var(--gray-500)';

  try {
    const response = await fetch('/api/ai/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'test' })
    });

    const result = await response.json();

    if (result.ok) {
      statusEl.textContent = '✅ 正常';
      statusEl.style.color = '#2e7d32';
    } else {
      statusEl.textContent = '❌ 异常';
      statusEl.style.color = '#c62828';
    }
  } catch (error) {
    statusEl.textContent = '❌ 未连接';
    statusEl.style.color = '#c62828';
  }
}

// 切换 API Key 可见性
window.toggleApiKeyVisibility = function() {
  const input = document.getElementById('settings-api-key');
  if (input.type === 'password') {
    input.type = 'text';
  } else {
    input.type = 'password';
  }
}
