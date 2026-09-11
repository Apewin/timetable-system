import { expect, test } from '@playwright/test';

test('overview focus mode stays full width at the mobile-sidebar breakpoint', async ({ page }) => {
  await page.setViewportSize({ width: 980, height: 760 });
  await page.goto('/timetable/');
  await page.locator('#btn-sidebar-toggle').click();
  await page.getByRole('link', { name: '总课表概览' }).click();
  await page.getByRole('button', { name: '专注查看' }).click();

  const layout = await page.evaluate(() => ({
    viewport: globalThis.innerWidth,
    scrollWidth: globalThis.document.body.scrollWidth,
    mainWidth: globalThis.document.querySelector('.main')?.getBoundingClientRect().width || 0,
    sidebarVisibility: globalThis.getComputedStyle(globalThis.document.querySelector('.sidebar')).visibility,
  }));
  expect(layout.mainWidth).toBeGreaterThan(900);
  expect(layout.scrollWidth).toBe(layout.viewport);
  expect(layout.sidebarVisibility).toBe('hidden');
});

test('import readiness uses canonical student selections without failing the page', async ({ page }) => {
  await page.goto('/timetable/');
  await page.getByRole('button', { name: '导入数据' }).click();

  await expect(page.locator('#import-readiness-summary')).toContainText('核心数据 3/4 项已就绪');
  await expect(page.locator('#import-readiness-summary')).not.toContainText('暂时无法读取准备度');
  await expect(page.locator('#import-readiness-grid')).toContainText('其他选课');
});

test('sidebar becomes interactive after resizing from mobile to desktop', async ({ page }) => {
  await page.setViewportSize({ width: 768, height: 760 });
  await page.goto('/timetable/');
  await expect(page.locator('.sidebar')).toHaveAttribute('aria-hidden', 'true');

  await page.setViewportSize({ width: 1280, height: 760 });
  await expect(page.locator('.sidebar')).not.toHaveAttribute('aria-hidden', 'true');
  await expect(page.locator('.sidebar')).not.toHaveAttribute('inert', '');

  await page.locator('#sidebar-mode-switch').click();
  await expect(page.getByRole('heading', { name: '排考试与考场' })).toBeVisible();
});

test('daily timetable classrooms can be added, renamed, deleted and saved without enabling room constraints', async ({ page, request }) => {
  await page.goto('/timetable/');
  await page.getByRole('link', { name: '排课表' }).click();

  const manager = page.locator('#manual-room-manager');
  await expect(manager).toBeVisible();
  await expect(manager).toContainText('当前不参与教室冲突校验');
  await expect(page.locator('#manual-room-count')).toHaveText('1 个教室');
  await manager.locator('summary').click();
  await expect(manager).toHaveAttribute('open', '');

  await page.locator('#manual-room-new-id').fill('201');
  await page.locator('#manual-room-new-name').fill('临时教室');
  await page.locator('#manual-room-new-type').selectOption('computer');
  await page.locator('#manual-room-new-capacity').fill('28');
  await page.locator('#manual-room-add').click();
  await expect(page.locator('#manual-room-count')).toHaveText('2 个教室');

  const existingRoom = page.locator('[data-manual-room-id="R1"]');
  await existingRoom.locator('[data-manual-room-field="id"]').fill('101');
  await existingRoom.locator('[data-manual-room-field="id"]').press('Tab');
  const renamedRoom = page.locator('[data-manual-room-id="101"]');
  await renamedRoom.locator('[data-manual-room-field="name"]').fill('高一一班教室');
  await renamedRoom.locator('[data-manual-room-field="capacity"]').fill('32');
  await renamedRoom.locator('[data-manual-room-field="capacity"]').press('Tab');

  page.once('dialog', dialog => dialog.accept());
  await page.locator('[data-manual-room-delete="201"]').click();
  await expect(page.locator('#manual-room-count')).toHaveText('1 个教室');
  await expect(page.locator('#manual-room-save')).toBeEnabled();

  const saveResponsePromise = page.waitForResponse(response =>
    response.url().endsWith('/api/rooms')
      && response.request().method() === 'PUT'
  );
  await page.locator('#manual-room-save').click();
  const savePayload = await (await saveResponsePromise).json();
  expect(savePayload.ok).toBe(true);
  expect(savePayload.data.room_assignment).toBe('disabled');
  expect(savePayload.data.renamed_ids).toEqual([{ from: 'R1', to: '101' }]);
  await expect(page.locator('#manual-room-save')).toBeDisabled();
  await expect(page.locator('#manual-room-save-status')).toContainText('当前不参与教室冲突校验');

  const persisted = await (await request.get('/api/rooms')).json();
  expect(persisted.data).toEqual([{
    id: '101', name: '高一一班教室', type: 'classroom', capacity: 32,
  }]);
  const classes = await (await request.get('/api/admin_classes')).json();
  expect(classes.data[0].fixed_room_id).toBe('101');
});

test('administrative and teaching class names can change without changing their ids or memberships', async ({ page, request }) => {
  await page.goto('/timetable/');
  await page.getByRole('link', { name: '班级管理' }).click();
  await expect(page.locator('#view-classes').getByRole('heading', { name: '班级管理' })).toBeVisible();

  const adminRow = page.locator('#classes-list tr').filter({ hasText: '高一行政班' });
  await adminRow.getByRole('button', { name: '修改名称' }).click();
  const renameForm = page.locator('#form-rename-class');
  await expect(renameForm).toContainText('G10A');
  await renameForm.locator('[name="name"]').fill('高一博雅班');
  const adminResponsePromise = page.waitForResponse(response =>
    response.url().includes('/api/class-names/admin_classes/G10A')
      && response.request().method() === 'PUT'
  );
  await renameForm.getByRole('button', { name: '保存新名称' }).click();
  const adminPayload = await (await adminResponsePromise).json();
  expect(adminPayload.data.class.id).toBe('G10A');
  expect(adminPayload.data.class.name).toBe('高一博雅班');
  await expect(page.locator('#classes-list')).toContainText('高一博雅班');

  const teachingRow = page.locator('#classes-list tr').filter({ hasText: '高一教学班' });
  await teachingRow.getByRole('button', { name: '修改名称' }).click();
  await page.locator('#class-rename-name').fill('高一数学 A 班');
  const teachingResponsePromise = page.waitForResponse(response =>
    response.url().includes('/api/class-names/teaching_classes/G10T')
      && response.request().method() === 'PUT'
  );
  await page.getByRole('button', { name: '保存新名称' }).click();
  const teachingPayload = await (await teachingResponsePromise).json();
  expect(teachingPayload.data.class.id).toBe('G10T');
  expect(teachingPayload.data.class.name).toBe('高一数学 A 班');
  await expect(page.locator('#classes-list')).toContainText('高一数学 A 班');

  const students = await (await request.get('/api/students')).json();
  expect(students.data[0].admin_class_id).toBe('G10A');
  expect(students.data[0].teaching_class_id).toBe('G10T');
});

test('manual scheduling discards browser drafts that no longer belong to current school data', async ({ page }) => {
  await page.addInitScript(() => {
    globalThis.localStorage.setItem('timetable.manual-drafts.v1', JSON.stringify({
      STALE_CLASS: { D1P1: 'STALE_COURSE' },
    }));
  });
  await page.goto('/timetable/');
  await page.getByRole('link', { name: '排课表', exact: true }).click();

  await expect(page.locator('#manual-action-feedback-text')).toContainText('已移除 1 个');
  expect(await page.evaluate(() => JSON.parse(globalThis.localStorage.getItem('timetable.manual-drafts.v1')))).toEqual({});
  await expect(page.locator('#manual-plan-status')).not.toContainText('不存在');
});

test('mobile actions do not overlap and temporary drawers close with Escape', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/timetable/');

  await page.locator('#btn-sidebar-toggle').click();
  await page.locator('#sidebar-mode-switch').click();
  await expect(page.getByRole('heading', { name: '排考试与考场' })).toBeVisible();
  await page.locator('[data-exam-workflow-stage="subjects"]').click();
  await expect(page.locator('#exam-subjects-card')).toBeVisible();
  const roomManager = page.locator('#exam-room-manager');
  if (!(await roomManager.evaluate(element => element.open))) {
    await roomManager.locator('summary').click();
  }
  for (const target of [
    page.locator('#exam-add-room'),
    page.locator('#exam-save-rooms'),
    page.getByRole('button', { name: '选择时长表' }),
    page.getByRole('button', { name: '添加考试' }),
    page.getByRole('button', { name: '继续设置考试窗口' }),
  ]) {
    await expect(target).toBeVisible();
    expect((await target.boundingBox()).height).toBeGreaterThanOrEqual(44);
  }
  const saveRooms = page.locator('#exam-save-rooms');
  const openAssistant = page.locator('#btn-ai-assistant-open');
  await saveRooms.scrollIntoViewIfNeeded();
  await expect(openAssistant).toBeVisible();
  const [saveBox, assistantBox] = await Promise.all([saveRooms.boundingBox(), openAssistant.boundingBox()]);
  const overlapWidth = Math.max(0, Math.min(saveBox.x + saveBox.width, assistantBox.x + assistantBox.width)
    - Math.max(saveBox.x, assistantBox.x));
  const overlapHeight = Math.max(0, Math.min(saveBox.y + saveBox.height, assistantBox.y + assistantBox.height)
    - Math.max(saveBox.y, assistantBox.y));
  expect(overlapWidth * overlapHeight).toBe(0);
  expect(assistantBox.height).toBeGreaterThanOrEqual(44);

  await page.setViewportSize({ width: 768, height: 844 });
  await page.locator('#btn-sidebar-toggle').click();
  await expect(page.locator('.sidebar')).toHaveAttribute('aria-hidden', 'false');
  await page.keyboard.press('Escape');
  await expect(page.locator('.sidebar')).toHaveAttribute('aria-hidden', 'true');
  await expect(page.locator('#btn-sidebar-toggle')).toBeFocused();

  await openAssistant.click();
  await expect(page.locator('#ai-assistant-sidebar')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('#ai-assistant-sidebar')).toBeHidden();
  await expect(openAssistant).toBeFocused();
});

test('high-frequency selectors expose names and command search has dialog semantics', async ({ page }) => {
  await page.goto('/timetable/');
  const expectNames = async entries => {
    for (const [selector, name] of entries) {
      await expect(page.locator(selector)).toBeVisible();
      await expect(page.locator(selector)).toHaveAccessibleName(name);
    }
  };

  await page.locator('#sidebar-mode-switch').click();
  await page.getByRole('link', { name: '考试科目与时长', exact: true }).click();
  await expectNames([
    ['#exam-course-select', '考试课程'],
    ['#exam-duration-select', '考试时长'],
  ]);
  await page.locator('#sidebar-mode-switch').click();

  const pages = [
    ['排课表', [['#manual-course-search', '搜索待排课程']]],
    ['按班级', [['#select-class', '选择班级课表']]],
    ['按教师', [['#select-teacher', '选择教师课表']]],
    ['按学生', [['#select-student', '选择学生课表']]],
    ['AP 分流组', [['#select-ap-group', '选择 AP 分流组']]],
    ['按教室', [['#select-room', '选择教室课表']]],
    ['学生管理', [
      ['#filter-student-grade', '按年级筛选学生'],
      ['#filter-student-class', '按班级筛选学生'],
    ]],
    ['其他选课', [
      ['#filter-elective-grade', '按年级筛选其他选课'],
      ['#filter-elective-group', '按选课组筛选其他选课'],
    ]],
    ['导出课表', [
      ['#export-dimension', '导出课表维度'],
      ['#export-target', '导出对象'],
      ['#export-format', '导出格式'],
    ]],
  ];
  for (const [linkName, controls] of pages) {
    await page.getByRole('link', { name: linkName, exact: true }).click();
    await expectNames(controls);
  }

  await page.locator('#btn-command-search').click();
  await expect(page.getByRole('dialog', { name: '搜索页面与功能' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: '搜索页面与功能' })).toBeHidden();
});
