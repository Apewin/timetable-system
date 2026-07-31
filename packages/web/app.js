/**
 * 排课系统 Web 前端应用
 */

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

// 工具函数
function showToast(message, type = 'success') {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.className = `toast ${type}`;
  setTimeout(() => {
    toast.className = 'toast hidden';
  }, 3000);
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
  try {
    const response = await fetch(`${API_BASE}${path}`, {
      headers: {
        'Content-Type': 'application/json',
      },
      ...options,
    });
    const data = await response.json();
    if (!data.ok) {
      throw new Error(data.errors?.[0]?.msg || '请求失败');
    }
    return data.data;
  } catch (error) {
    showToast(error.message, 'error');
    throw error;
  }
}

// 视图切换
function switchView(viewName) {
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

  // 加载视图数据
  loadViewData(viewName);
}

// 加载视图数据
async function loadViewData(viewName) {
  switch (viewName) {
    case 'welcome':
      loadWelcomePage();
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
    case 'export':
      await loadExportPage();
      break;
    case 'formal-timetable':
      await loadFormalSolvePage();
      break;
    case 'manual-timetable':
      await loadManualTimetable();
      break;
    case 'temp-timetable':
      await loadTempTimetablePage();
      break;
    case 'settings':
      await loadSettingsPage();
      break;
  }
}

const MANUAL_TIMETABLE_STORAGE_KEY = 'timetable.manual-drafts.v1';

function readManualDrafts() {
  try { return JSON.parse(localStorage.getItem(MANUAL_TIMETABLE_STORAGE_KEY) || '{}'); }
  catch { return {}; }
}

function writeManualDrafts(drafts) {
  localStorage.setItem(MANUAL_TIMETABLE_STORAGE_KEY, JSON.stringify(drafts));
}

function manualSlotId(day, period) { return `D${day}P${period}`; }

function manualCurrentClassId() {
  return document.getElementById('manual-class-select')?.value || '';
}

function manualCourseLabel(course) {
  return `${course.name || course.id}${course.weekly_hours ? ` · ${course.weekly_hours} 节/周` : ''}`;
}

function renderManualCoursePool() {
  const pool = document.getElementById('manual-course-pool');
  const count = document.getElementById('manual-course-count');
  if (!pool) return;
  const keyword = (document.getElementById('manual-course-search')?.value || '').trim().toLowerCase();
  const courses = (window._manualCourses || []).filter(course =>
    !keyword || `${course.id} ${course.name || ''}`.toLowerCase().includes(keyword));
  count.textContent = `${courses.length} 门`;
  pool.innerHTML = courses.map(course => `
    <div class="manual-course-card" draggable="true" data-course-id="${course.id}">
      <div class="manual-course-name">${course.name || course.id}</div>
      <div class="manual-course-meta">${course.id} · ${course.weekly_hours || 0} 节/周</div>
    </div>
  `).join('') || '<div class="empty-state"><p>没有匹配课程</p></div>';
  pool.querySelectorAll('.manual-course-card').forEach(card => {
    card.addEventListener('dragstart', event => {
      event.dataTransfer.effectAllowed = 'copy';
      event.dataTransfer.setData('application/x-manual-course', card.dataset.courseId);
    });
  });
}

function saveManualCourseToSlot(slotId, courseId) {
  const classId = manualCurrentClassId();
  if (!classId || !courseId) return;
  const drafts = readManualDrafts();
  drafts[classId] = { ...(drafts[classId] || {}), [slotId]: courseId };
  writeManualDrafts(drafts);
  renderManualTimetableGrid();
}

function removeManualCourseFromSlot(slotId) {
  const classId = manualCurrentClassId();
  const drafts = readManualDrafts();
  if (!drafts[classId]?.[slotId]) return;
  delete drafts[classId][slotId];
  writeManualDrafts(drafts);
  renderManualTimetableGrid();
}

function renderManualTimetableGrid() {
  const grid = document.getElementById('manual-timetable-grid');
  const classId = manualCurrentClassId();
  if (!grid || !classId) return;
  const drafts = readManualDrafts();
  const draft = drafts[classId] || {};
  const courseById = new Map((window._manualCourses || []).map(course => [course.id, course]));
  const days = ['周一', '周二', '周三', '周四', '周五'];
  let html = '<div class="manual-grid-head">节次</div>' + days.map(day => `<div class="manual-grid-head">${day}</div>`).join('');
  for (let period = 1; period <= 10; period++) {
    html += `<div class="manual-grid-period">第 ${period} 节</div>`;
    for (let day = 1; day <= 5; day++) {
      const slotId = manualSlotId(day, period);
      const course = courseById.get(draft[slotId]);
      html += `<div class="manual-slot ${course ? 'has-course' : ''}" data-slot-id="${slotId}">
        ${course ? `<div class="manual-slot-course"><span>${manualCourseLabel(course)}</span><button type="button" class="manual-slot-remove" data-slot-id="${slotId}" aria-label="删除课程">×</button></div>` : '<span class="manual-slot-placeholder">拖入课程</span>'}
      </div>`;
    }
  }
  grid.innerHTML = html;
  grid.querySelectorAll('.manual-slot').forEach(slot => {
    slot.addEventListener('dragover', event => { event.preventDefault(); slot.classList.add('drag-over'); });
    slot.addEventListener('dragleave', () => slot.classList.remove('drag-over'));
    slot.addEventListener('drop', event => {
      event.preventDefault();
      slot.classList.remove('drag-over');
      saveManualCourseToSlot(slot.dataset.slotId, event.dataTransfer.getData('application/x-manual-course'));
    });
  });
  grid.querySelectorAll('.manual-slot-remove').forEach(button => {
    button.addEventListener('click', () => removeManualCourseFromSlot(button.dataset.slotId));
  });
}

async function loadManualTimetable() {
  const [teachingClasses, adminClasses, courses] = await Promise.all([
    api('/teaching_classes'), api('/admin_classes'), api('/courses'),
  ]);
  window._manualCourses = [...courses].sort((a, b) => (a.name || a.id).localeCompare(b.name || b.id, 'zh-CN'));
  const selector = document.getElementById('manual-class-select');
  const classes = [
    ...teachingClasses.map(item => ({ ...item, label: `教学班 · ${item.name}` })),
    ...adminClasses.map(item => ({ ...item, label: `行政班 · ${item.name}` })),
  ].sort((a, b) => a.label.localeCompare(b.label, 'zh-CN'));
  const previous = selector.value;
  selector.innerHTML = classes.map(item => `<option value="${item.id}">${item.label}</option>`).join('');
  if (classes.some(item => item.id === previous)) selector.value = previous;
  selector.onchange = renderManualTimetableGrid;
  document.getElementById('manual-course-search').oninput = renderManualCoursePool;
  document.getElementById('manual-clear-class').onclick = () => {
    const classId = manualCurrentClassId();
    if (!classId || !confirm('清空当前班级的手动课表草稿吗？')) return;
    const drafts = readManualDrafts();
    delete drafts[classId];
    writeManualDrafts(drafts);
    renderManualTimetableGrid();
  };
  renderManualCoursePool();
  renderManualTimetableGrid();
}

// 加载欢迎页面
function loadWelcomePage() {
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
           item.can_teach.some(c => c.toLowerCase().includes(keyword));
  });
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
            <th>周课时</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          ${data.map(t => `
            <tr>
              <td>${t.id}</td>
              <td>${t.name}</td>
              <td>${t.weekly_hours} 节</td>
              <td>
                <button class="btn btn-primary btn-sm" onclick="editEntity('teachers', '${t.id}')">编辑</button>
                <button class="btn btn-danger btn-sm" onclick="deleteEntity('teachers', '${t.id}')">删除</button>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
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
              <td>${r.id}</td>
              <td>${r.name}</td>
              <td>${r.type}</td>
              <td>${r.capacity}</td>
              <td>${r.owner_class_id || '-'}</td>
              <td>
                <button class="btn btn-primary btn-sm" onclick="editEntity('rooms', '${r.id}')">编辑</button>
                <button class="btn btn-danger btn-sm" onclick="deleteEntity('rooms', '${r.id}')">删除</button>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
}

// 加载课程列表
async function loadCourses() {
  const data = await api('/courses');
  window._coursesData = data;
  const gradeFilter = document.getElementById('filter-course-grade');
  const searchInput = document.getElementById('search-courses');
  gradeFilter.onchange = applyCourseFilters;
  searchInput.oninput = applyCourseFilters;
  applyCourseFilters();
}

function courseAppliesToGrade(course, grade) {
  const grades = Array.isArray(course.grade) ? course.grade : [course.grade];
  return grades.map(Number).includes(Number(grade));
}

function courseGradeLabel(course) {
  const grades = (Array.isArray(course.grade) ? course.grade : [course.grade])
    .map(Number)
    .filter(Number.isFinite)
    .sort((left, right) => left - right);
  return grades.length ? grades.map(grade => `高${grade - 9}`).join('、') : '未设置';
}

function courseTypeLabel(type) {
  return ({ required: '必修', ap: 'AP选修', required_elective: '必修选修', other: '活动/其他' })[type] || type || '-';
}

function applyCourseFilters() {
  const allCourses = window._coursesData || [];
  const grade = document.getElementById('filter-course-grade')?.value || '';
  const keyword = document.getElementById('search-courses')?.value.toLowerCase().trim() || '';
  const filtered = allCourses.filter(course => {
    const gradeMatch = !grade || courseAppliesToGrade(course, grade);
    const keywordMatch = !keyword
      || course.id.toLowerCase().includes(keyword)
      || course.name.toLowerCase().includes(keyword)
      || course.type.toLowerCase().includes(keyword)
      || courseGradeLabel(course).includes(keyword);
    return gradeMatch && keywordMatch;
  });
  renderCoursesList(filtered, { grade, total: allCourses.length });
}

function renderCoursesList(data, { grade = '', total = data.length } = {}) {
  const content = document.getElementById('courses-list');
  if (data.length === 0) {
    content.innerHTML = `<div class="empty-state"><p>${grade ? `高${Number(grade) - 9}暂无匹配课程` : '暂无课程数据'}</p></div>`;
    return;
  }
  content.innerHTML = `
    <div class="table-container">
      <div style="padding: 8px 0; color: var(--gray-500); font-size: 13px;">
        ${grade ? `高${Number(grade) - 9}课程` : '全部课程'}：显示 ${data.length}/${total} 门
      </div>
      <table>
        <thead>
          <tr>
            <th>ID</th>
            <th>名称</th>
            <th>适用年级</th>
            <th>类型</th>
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
              <td>${c.id}</td>
              <td>${c.name}</td>
              <td>${courseGradeLabel(c)}</td>
              <td>${courseTypeLabel(c.type)}</td>
              <td>${c.weekly_hours}</td>
              <td>${c.required_room_type || '-'}</td>
              <td>${c.prefer_morning ? '是' : '-'}</td>
              <td>${c.consecutive ? `${c.consecutive.min}-${c.consecutive.max}` : '-'}</td>
              <td>
                <button class="btn btn-primary btn-sm" onclick="editEntity('courses', '${c.id}')">编辑</button>
                <button class="btn btn-danger btn-sm" onclick="deleteEntity('courses', '${c.id}')">删除</button>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
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
            ${Object.entries(apStats).map(([name, count]) => `<strong>${name}</strong>(${count})`).join(' ')}
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
              <td>${s.id}</td>
              <td>${s.name}</td>
              <td>${s.english_name || '-'}</td>
              <td>${s.grade}</td>
              <td>${s.admin_class_id}</td>
              <td>${s.teaching_class_id}</td>
              <td>
                ${s.ap_selections.length > 0
                  ? `<div class="ap-tags">${s.ap_selections.map(ap => `<span class="ap-tag">${ap.name}</span>`).join('')}</div>`
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
                        ${s.elective_choices_data.group_a ? `<span class="ap-tag" style="background: #e3f2fd; color: #1565c0;">A:${s.elective_choices_data.group_a.name}</span>` : ''}
                        ${s.elective_choices_data.group_b ? `<span class="ap-tag" style="background: #f3e5f5; color: #7b1fa2;">B:${s.elective_choices_data.group_b.name}</span>` : ''}
                        ${s.elective_choices_data.group_c ? `<span class="ap-tag" style="background: #e8f5e9; color: #2e7d32;">C:${s.elective_choices_data.group_c.name}</span>` : ''}
                      </div>`
                    : '<span style="color: var(--gray-400);">无</span>')
                }
              </td>
              <td>
                <button class="btn btn-primary btn-sm" onclick="editEntity('students', '${s.id}')">编辑</button>
                <button class="btn btn-danger btn-sm" onclick="deleteEntity('students', '${s.id}')">删除</button>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
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
                <td>${c.id}</td>
                <td>${c.name}</td>
                <td>${c.grade}</td>
                <td>${c.fixed_room_id}</td>
                <td>${c.student_ids.length}</td>
                <td>
                  <button class="btn btn-primary btn-sm" onclick="editEntity('admin_classes', '${c.id}')">编辑</button>
                  <button class="btn btn-danger btn-sm" onclick="deleteEntity('admin_classes', '${c.id}')">删除</button>
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
                <td>${c.id}</td>
                <td>${c.name}</td>
                <td>${c.grade}</td>
                <td>${c.fixed_room_id}</td>
                <td>${c.student_ids.length}</td>
                <td>
                  <button class="btn btn-primary btn-sm" onclick="editEntity('teaching_classes', '${c.id}')">编辑</button>
                  <button class="btn btn-danger btn-sm" onclick="deleteEntity('teaching_classes', '${c.id}')">删除</button>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `}
  `;
}

// 加载教师分工列表
async function loadAssignments() {
  const data = await api('/teaching_assignments');
  const teachers = await api('/teachers');
  const courses = await api('/courses');

  // 增强数据，添加教师和课程名称
  const enhancedData = data.map(a => ({
    ...a,
    teacher_name: teachers.find(t => t.id === a.teacher_id)?.name || a.teacher_id,
    course_name: courses.find(c => c.id === a.course_id)?.name || a.course_id
  }));

  window._assignmentsData = enhancedData;
  renderAssignmentsList(enhancedData);

  initEntitySearch('search-assignments', enhancedData, renderAssignmentsList, (item, keyword) => {
    return item.id.toLowerCase().includes(keyword) ||
           item.teacher_id.toLowerCase().includes(keyword) ||
           item.teacher_name.toLowerCase().includes(keyword) ||
           item.course_id.toLowerCase().includes(keyword) ||
           item.course_name.toLowerCase().includes(keyword) ||
           item.class_id.toLowerCase().includes(keyword);
  });
}

function renderAssignmentsList(data) {
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
            <tr>
              <td>${a.id}</td>
              <td>${a.teacher_name}</td>
              <td>${a.course_name}</td>
              <td>${a.class_id}</td>
              <td>${a.class_type === 'admin' ? '行政班' : '教学班'}</td>
              <td>${a.weekly_hours}</td>
              <td>
                <button class="btn btn-danger btn-sm" onclick="deleteEntity('teaching_assignments', '${a.id}')">删除</button>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
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
                <span class="student-info">高${s.grade} | ${s.admin_class}</span>
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
    const [students, selections] = await Promise.all([
      api('/students'),
      api('/ap_selections')
    ]);

    // 找出没有选这门课的学生
    const availableStudents = students.filter(s => {
      const selection = selections.find(sel => sel.student_id === s.id);
      return !selection || !selection.course_ids.includes(courseId);
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
            ${availableStudents.map(s => `<option value="${s.id}">${s.name} (${s.id}) - 高${s.grade}</option>`).join('')}
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
    const sections = await api('/elective-sections');
    window._sectioningData = sections;
    renderSectioningList(sections);

    // 绑定按钮事件
    document.getElementById('btn-solve-sections').onclick = solveSections;
    document.getElementById('btn-refresh-sections').onclick = loadSectioning;
    document.getElementById('btn-sectioning-suggestions').onclick = loadSectioningSuggestions;
  } catch (error) {
    console.error('加载分班数据失败:', error);
  }
}

async function solveSections() {
  if (!confirm('确定要运行分班引擎吗？这将重新分配所有选修课班级。')) {
    return;
  }

  try {
    const result = await api('/solve-sections', { method: 'POST' });

    // 显示统计信息
    const statsDiv = document.getElementById('sectioning-stats');
    statsDiv.innerHTML = `
      <div class="stat-item">
        <div class="stat-label">AP选修班</div>
        <div class="stat-value">${result.statistics.ap_sections}</div>
      </div>
      <div class="stat-item">
        <div class="stat-label">必修选修班</div>
        <div class="stat-value">${result.statistics.elective_sections}</div>
      </div>
      <div class="stat-item">
        <div class="stat-label">总班级数</div>
        <div class="stat-value">${result.statistics.total_sections}</div>
      </div>
      <div class="stat-item">
        <div class="stat-label">教学任务</div>
        <div class="stat-value">${result.statistics.total_tasks}</div>
      </div>
    `;

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

  // AP选修班
  if (apSections.length > 0) {
    html += `
      <div class="section-group">
        <h3>AP选修班 (${apSections.length}个班)</h3>
        <div class="sections-grid">
          ${apSections.map(section => renderSectionCard(section)).join('')}
        </div>
      </div>
    `;
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

  return `
    <div class="section-card" id="section-${section.id}">
      <div class="section-header">
        <h4>${section.course_name}</h4>
        <span class="section-badge">${section.student_ids.length}人</span>
      </div>
      <div class="section-body">
        <div class="section-info">
          <div>班级: ${section.id}</div>
          <div>教师: ${teacher?.name || '待分配'}</div>
          <div>课时: ${section.weekly_hours}节/周</div>
        </div>
        <div class="section-students">
          <div class="students-header">学生列表:</div>
          <div class="students-list">
            ${section.student_ids.slice(0, 10).map(id => {
              const student = window._studentsData?.find(s => s.id === id);
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
            const student = window._studentsData?.find(s => s.id === id);
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
            const student = window._studentsData?.find(s => s.id === id);
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
          ${targets.map(section => `<option value="${section.id}">${section.id}（${section.student_ids.length} 人）</option>`).join('')}
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
  max_consecutive_lessons: '限制同一目标一天中连续课时的最大长度；本校“连续不超过三节”应设为 student 范围。',
  max_consecutive_days_in_period: '限制目标连续几天出现在同一节次。',
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
              <td>${c.id}</td>
              <td>${c.type}</td>
              <td>${c.scope}</td>
              <td>${c.target_id || '-'}</td>
              <td>${c.hard ? '硬' : (c.requires_approval_to_relax ? '软（需批准）' : '软')}</td>
              <td>${c.weight || '-'}</td>
              <td>
                <button class="btn btn-secondary btn-sm" onclick="openConstraintDialog(window._constraintsData.find(item => item.id === '${c.id}'))">编辑</button>
                <button class="btn btn-danger btn-sm" onclick="deleteEntity('constraints', '${c.id}')">删除</button>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
}

// 加载学生选择框
async function loadStudentSelect() {
  const data = await api('/students');
  window._studentsData = data; // 缓存数据供搜索使用
  const select = document.getElementById('select-student');
  select.innerHTML = '<option value="">选择学生</option>' +
    data.map(s => `<option value="${s.id}">${s.id} - ${s.name}${s.english_name ? ` (${s.english_name})` : ''}</option>`).join('');

  // 初始化搜索
  initSearchFilter(
    'search-student',
    'select-student',
    data,
    (item) => `${item.id} ${item.name} ${item.english_name || ''} ${item.pinyin_name || ''}`,
    (item) => `${item.id} - ${item.name}${item.english_name ? ` (${item.english_name})` : ''}`,
  );
}

// 加载教师选择框
async function loadTeacherSelect() {
  const data = await api('/teachers');
  window._teachersData = data; // 缓存数据供搜索使用
  const select = document.getElementById('select-teacher');
  select.innerHTML = '<option value="">选择教师</option>' +
    data.map(t => `<option value="${t.id}">${t.id} - ${t.name}</option>`).join('');

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
    teachingClasses.map(c => `<option value="${c.id}">${c.id} - ${c.name}</option>`).join('');

  // 初始化搜索
  initSearchFilter('search-class', 'select-class', allClasses, (item) => `${item.id} ${item.name}`);
}

// 加载教室选择框
async function loadRoomSelect() {
  const data = await api('/rooms');
  window._roomsData = data; // 缓存数据供搜索使用
  const select = document.getElementById('select-room');
  select.innerHTML = '<option value="">选择教室</option>' +
    data.map(r => `<option value="${r.id}">${r.id} - ${r.name}</option>`).join('');

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
        data.map(item => `<option value="${item.id}">${getOptionLabel(item)}</option>`).join('');
      return;
    }

    // 过滤匹配的数据
    const filtered = data.filter(item => {
      const searchText = getSearchText(item).toLowerCase();
      return searchText.includes(keyword);
    });

    // 更新下拉框选项
    select.innerHTML = '<option value="">选择匹配项</option>' +
      filtered.map(item => `<option value="${item.id}">${getOptionLabel(item)}</option>`).join('');

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

  // 移除旧的事件监听器
  searchInput.oninput = null;

  // 添加新的事件监听器
  searchInput.addEventListener('input', (e) => {
    const keyword = e.target.value.toLowerCase().trim();

    if (!keyword) {
      renderFn(data);
      return;
    }

    // 过滤匹配的数据
    const filtered = data.filter(item => matchFn(item, keyword));
    renderFn(filtered);
  });
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

// 渲染详细课表视图
function renderDetailedTimetable(containerId, data, title, subtitle) {
  const container = document.getElementById(containerId);
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

  let html = `
    <div class="timetable-detail">
      <div class="timetable-header">
        <h3>${title}</h3>
        <p>${subtitle}</p>
        ${data.stale ? '<div class="validation-result warning">⚠️ 当前输入已修改：以下为上一版历史课表。请重新排课后再据此调整。</div>' : ''}
      </div>
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
      const isWalkBlock = row && row[0] && row[0].includes('P') &&
        (row[0].includes('6') || row[0].includes('7') || row[0].includes('8'));

      if (slot) {
        // 检查是否是教学班课表（包含行政班课程）
        if (slot.admin_courses && Object.keys(slot.admin_courses).length > 0) {
          // 教学班课表：显示行政班课程
          html += `
            <div class="slot-cell has-class ${isWalkBlock ? 'walk-block' : ''}"
                 data-slot-id="D${day}P${period.id}">
              <div class="admin-courses">
                ${Object.entries(slot.admin_courses).map(([classId, course]) => `
                  <div class="admin-course-item">
                    <span class="class-label">${classId}:</span>
                    <span class="course-name">${course.course}</span>
                  </div>
                `).join('')}
              </div>
              ${slot.teaching_course ? `
                <div class="teaching-course">
                  <span class="course-name">${slot.teaching_course.course}</span>
                  <span class="teacher-name">👨‍🏫 ${slot.teaching_course.teacher}</span>
                </div>
              ` : ''}
              ${slot.elective_course ? `
                <div class="elective-course">
                  <span class="course-name">${slot.elective_course.course}</span>
                  <span class="teacher-name">👨‍🏫 ${slot.elective_course.teacher}</span>
                </div>
              ` : ''}
            </div>
          `;
        } else {
          // 其他课表：直接显示
          html += `
            <div class="slot-cell has-class ${isWalkBlock ? 'walk-block' : ''}"
                 draggable="true"
                 data-task-id="${slot.task_id || ''}"
                 data-slot-id="D${day}P${period.id}">
              <div class="course-name">
                ${getCourseName(slot)}
                ${slot.course_type === 'ap' ? '<span class="course-badge ap">AP</span>' : ''}
              </div>
              <div class="teacher-name">👨‍🏫 ${getTeacherName(slot)}</div>
              <div class="room-name">🚪 ${getRoomName(slot)}</div>
            </div>
          `;
        }
      } else {
        html += `<div class="slot-cell" data-slot-id="D${day}P${period.id}"></div>`;
      }
    }
  });

  html += '</div></div>';
  container.innerHTML = html;
}

// 加载总课表概览
async function loadOverviewTimetable() {
  const content = document.getElementById('overview-timetable-content');
  const grade = document.getElementById('select-grade').value;
  const viewType = document.getElementById('select-view-type').value;

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
    let html = '<div class="overview-grid">';
    timetables.forEach(({ id, name, data }) => {
      html += `
        <div class="overview-card" onclick="viewDetailedTimetable('${viewType}', '${id}', '${name}')">
          <div class="overview-card-header">
            <h4>${name}</h4>
            <span class="badge">${id}</span>
          </div>
          <div class="overview-card-body">
            ${renderMiniTimetable(data)}
          </div>
        </div>
      `;
    });
    html += '</div>';

    content.innerHTML = html;
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
        html += `<td class="slot-filled">${getCourseName(slot)}</td>`;
      } else {
        html += `<td class="slot-empty">-</td>`;
      }
    }
    html += '</tr>';
  });

  html += '</tbody></table>';
  return html;
}

// 查看详细课表
async function viewDetailedTimetable(type, id, name) {
  // 切换到对应的详细视图
  switchView(`${type}-timetable`);

  // 设置下拉框并加载数据
  const select = document.getElementById(`select-${type}`);
  select.value = id;

  // 触发change事件
  const event = new Event('change');
  select.dispatchEvent(event);
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
              </select>
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

    // 添加下拉框事件监听（教师编辑页面）
    if (entity === 'teachers') {
      const courseSelect = document.getElementById('course-select');
      if (courseSelect) {
        courseSelect.addEventListener('change', (e) => {
          addCourse(e.target.value);
        });
      }
    }

    // 添加表单提交事件
    const form = document.querySelector(`form[id^="form-edit-"]`);
    if (form) {
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const formData = new FormData(form);
        const updateData = {};

        // 处理表单数据
        for (const [key, value] of formData.entries()) {
          if (key === 'id') continue; // 跳过 ID 字段

          // 特殊处理 can_teach（复选框）
          if (key === 'can_teach') {
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
async function deleteEntity(entity, id) {
  if (!confirm(`确定要删除 ${id} 吗？`)) {
    return;
  }
  await api(`/${entity}/${id}`, { method: 'DELETE' });
  showToast('删除成功');
  loadViewData(getCurrentView());
}

// 查看详细课表（全局函数，供 onclick 调用）
window.viewDetailedTimetable = async function(type, id, name) {
  // 切换到对应的详细视图
  switchView(`${type}-timetable`);

  // 设置下拉框并加载数据
  const select = document.getElementById(`select-${type}`);
  select.value = id;

  // 触发change事件
  const event = new Event('change');
  select.dispatchEvent(event);
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

    const response = await fetch('/api/ai/solve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text })
    });

    const result = await response.json();

    if (!result.ok) {
      throw new Error(result.errors?.[0]?.msg || '求解失败');
    }

    // 显示 AI 响应
    const aiResponse = result.data.ai_response;
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
      parseHtml += `<div style="background: var(--gray-100); padding: 12px; border-radius: var(--radius);">${aiResponse.message || result.data.message}</div>`;
    }

    parseResult.innerHTML = parseHtml;

    // 如果有排课方案，显示成功消息
    if (aiResponse.action === 'schedule') {
      showToast(`✅ 已生成排课方案`, 'success');
    } else {
      showToast(result.data.message || '请提供更具体的排课需求', 'info');
    }
  } catch (error) {
    parseResult.innerHTML = `<div style="color: var(--danger);">求解失败: ${error.message}</div>`;
    showToast(error.message, 'error');
  }
}

// A protected soft rule is never waived as a side effect of clicking solve.
// The second request is sent only after the operator explicitly confirms the
// exact rule ids the first attempt could not preserve.
async function solveWithRequiredApproval(body = {}) {
  let result = await api('/solve', { method: 'POST', body: JSON.stringify(body) });
  if (result.solved || result.status !== 'NEEDS_APPROVAL_TO_RELAX') return result;
  const blocked = result.blocked_by || [];
  const labels = blocked.map(rule => `${rule.id}（${rule.scope}/${rule.type}）`).join('\n');
  const confirmed = confirm(`在不破坏以下受保护软规则的前提下无法排课：\n${labels}\n\n${result.diagnostic || ''}\n\n是否明确批准本次排课放宽这些规则？`);
  if (!confirmed) return result;
  result = await api('/solve', {
    method: 'POST',
    body: JSON.stringify({ ...body, approved_rule_relaxations: blocked.map(rule => rule.id) }),
  });
  return result;
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

function initDragAndDrop() {
  // 在课表渲染后调用此函数
  document.addEventListener('dragstart', (e) => {
    const slotCell = e.target.closest('.slot-cell.has-class');
    if (!slotCell) return;

    draggedTask = slotCell.dataset.taskId;
    draggedFromSlot = slotCell.dataset.slotId;
    slotCell.classList.add('dragging');

    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', draggedTask);
  });

  document.addEventListener('dragover', (e) => {
    e.preventDefault();
    const slotCell = e.target.closest('.slot-cell');
    if (slotCell && !slotCell.classList.contains('has-class')) {
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

    if (!draggedTask || !draggedFromSlot) return;

    const toSlot = slotCell.dataset.slotId;
    if (!toSlot || toSlot === draggedFromSlot) return;

    try {
      const result = await api('/swap', {
        method: 'POST',
        body: JSON.stringify({
          task_id: draggedTask,
          from_slot: draggedFromSlot,
          to_slot: toSlot
        })
      });

      showToast(result.message, 'success');

      // 刷新当前课表视图
      await refreshCurrentTimetable();
    } catch (error) {
      // 错误已由 api 函数处理
    }
  });
}

// 刷新当前课表视图
async function refreshCurrentTimetable() {
  const currentView = getCurrentView();

  // 根据当前视图类型重新加载课表
  switch (currentView) {
    case 'class-timetable':
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
    case 'teacher-timetable':
      const teacherSelect = document.getElementById('select-teacher');
      if (teacherSelect.value) {
        const data = await api(`/timetable/teacher/${teacherSelect.value}`);
        const teacher = await api(`/teachers`).then(t => t.find(t => t.id === teacherSelect.value));
        renderDetailedTimetable(
          'teacher-timetable-content',
          data,
          `${teacher?.name || teacherSelect.value} 的课表`,
          `教师ID: ${teacherSelect.value} | 可教课程: ${teacher?.can_teach?.join(', ') || '-'}`
        );
      }
      break;
    case 'student-timetable':
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
    case 'room-timetable':
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
    case 'overview-timetable':
      await loadOverviewTimetable();
      break;
  }

  document.addEventListener('dragend', (e) => {
    document.querySelectorAll('.slot-cell.dragging').forEach(el => {
      el.classList.remove('dragging');
    });
    draggedTask = null;
    draggedFromSlot = null;
  });
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

// 初始化应用
function init() {
  // 导航点击事件
  document.querySelectorAll('.nav-section a').forEach(link => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      const view = link.dataset.view;
      if (view) {
        switchView(view);
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

  // 求解按钮
  document.getElementById('btn-solve').addEventListener('click', async () => {
    if (!confirm('确定要执行求解吗？这将覆盖现有的排课结果。')) {
      return;
    }
    try {
      await api('/build-tasks', { method: 'POST' });
      showToast('教学任务已生成');
    } catch (error) {
      // 错误已由 api 函数处理
    }
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

  document.getElementById('select-teacher').addEventListener('change', async (e) => {
    if (e.target.value) {
      const data = await api(`/timetable/teacher/${e.target.value}`);
      const teacher = await api(`/teachers`).then(t => t.find(t => t.id === e.target.value));
      renderDetailedTimetable(
        'teacher-timetable-content',
        data,
        `${teacher?.name || e.target.value} 的课表`,
        `教师ID: ${e.target.value} | 可教课程: ${teacher?.can_teach?.join(', ') || '-'}`
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

  // 构建任务按钮
  document.getElementById('btn-build-tasks').addEventListener('click', async () => {
    const data = await api('/build-tasks', { method: 'POST' });
    showToast(`已生成 ${data.tasks_generated} 个教学任务`);
  });

  document.getElementById('btn-add-constraint').addEventListener('click', () => openConstraintDialog());

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
          </select>
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

    document.getElementById('form-add-course').addEventListener('submit', async (e) => {
      e.preventDefault();
      const formData = new FormData(e.target);
      const data = {
        id: formData.get('id'),
        name: formData.get('name'),
        type: formData.get('type'),
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

  // 默认加载欢迎页面
  switchView('welcome');
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

async function handleElectiveSelectionImportFile(file) {
  if (!file) return;
  const extension = file.name.split('.').pop()?.toLowerCase();
  if (!['xlsx', 'xls'].includes(extension)) {
    showToast('高三 A/B/C 选课表只支持 .xlsx 或 .xls 文件', 'warning');
    return;
  }
  pendingElectiveSelectionUploadFile = file;
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
      <button type="button" class="btn btn-secondary" onclick="clearElectiveSelectionImport()">清空预览</button>
      <button type="button" class="btn btn-primary" onclick="confirmElectiveSelectionImport()" ${data.can_confirm ? '' : 'disabled'}>
        确认更新 ${data.unique_students} 名学生
      </button>
    </div>
  `;
}

window.clearElectiveSelectionImport = function() {
  pendingElectiveSelectionImport = null;
  pendingElectiveSelectionUploadFile = null;
  renderElectiveSelectionImportPreview();
};

window.organizeElectiveSelectionImportWithAi = async function() {
  if (!pendingElectiveSelectionUploadFile) return;
  showToast('正在请求大模型整理高三 A/B/C 选课表…', 'info');
  try {
    const formData = new FormData();
    formData.append('file', pendingElectiveSelectionUploadFile);
    formData.append('ai_organize', 'true');
    const response = await fetch('/api/elective-selections/import/preview', { method: 'POST', body: formData });
    const result = await response.json();
    if (!result.ok) throw new Error(result.errors?.[0]?.msg || '大模型整理失败');
    pendingElectiveSelectionImport = result.data;
    renderElectiveSelectionImportPreview();
    showToast('大模型已整理完成，请核对预览后确认', 'success');
  } catch (error) {
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
                <td class="${sheet.status === 'recognized' && !sheet.unmatched && !sheet.ambiguous ? 'ap-import-status-ok' : 'ap-import-status-warning'}">
                  ${sheet.status === 'recognized'
                    ? (sheet.unmatched || sheet.ambiguous ? `${sheet.unmatched || 0} 未匹配 / ${sheet.ambiguous || 0} 有歧义` : '已匹配')
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
          <thead><tr><th>Student ID</th><th>中文姓名</th><th>英文名</th><th>当前 AP 选课</th><th>导入后 AP 选课</th></tr></thead>
          <tbody>
            ${data.changes.map(change => `
              <tr>
                <td>${escapeImportHtml(change.student_id)}</td>
                <td>${escapeImportHtml(change.student_name)}</td>
                <td>${escapeImportHtml(change.english_name || '-')}</td>
                <td>${escapeImportHtml((change.previous_course_names || []).join('、') || '无')}</td>
                <td>${escapeImportHtml((change.course_names || []).join('、') || '无')}</td>
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
  showToast('正在请求大模型整理 AP 选课表…', 'info');
  try {
    const formData = new FormData();
    formData.append('file', pendingApSelectionUploadFile);
    formData.append('ai_organize', 'true');
    const response = await fetch('/api/ap-selections/import/preview', { method: 'POST', body: formData });
    const result = await response.json();
    if (!result.ok) throw new Error(result.errors?.[0]?.msg || '大模型整理失败');
    pendingApSelectionImport = result.data;
    renderApSelectionImportPreview();
    showToast('大模型已整理完成，请核对预览后确认', 'success');
  } catch (error) {
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
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
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
  showToast(`正在请求大模型整理 ${item.data.filename}…`, 'info');
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
    showToast('大模型已整理完成，请核对完整名单后再确认导入', 'success');
  } catch (error) {
    item.aiOrganizing = false;
    renderStudentImportPreview();
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

  cancelAllImports();
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

// 加载导出页面
async function loadExportPage() {
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
    case 'class':
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

    case 'teacher':
      const teachers = await api('/teachers');
      options += teachers.map(t => `<option value="${t.id}">${t.name}</option>`).join('');
      break;

    case 'student':
      const students = await api('/students');
      options += students.map(s => `<option value="${s.id}">${s.name}${s.english_name ? ` (${s.english_name})` : ''}</option>`).join('');
      break;

    case 'room':
      const rooms = await api('/rooms');
      options += rooms.map(r => `<option value="${r.id}">${r.name}</option>`).join('');
      break;

    case 'all':
      options = '<option value="all">全部课表</option>';
      break;
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

    if (!result.ok) {
      throw new Error(result.errors?.[0]?.msg || '求解失败');
    }

    const solutions = result.data.solutions || [];

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
        await requestAISuggestions();
      } else {
        contentDiv.innerHTML = `
          <div class="validation-result success">
            ✅ 正式课表生成成功！所有硬约束满足
          </div>
          <div style="margin-top: 12px;">
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

    showToast('正式课表生成完成！', 'success');
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
    await loadSettings();

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
