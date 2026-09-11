import { expect, test } from '@playwright/test';

test('a user completes the four-stage exam workflow in real Chrome and recovers the job result after refresh', async ({ page }) => {
  await page.goto('/timetable/');
  await expect(page.getByRole('heading', { name: '概览' })).toBeVisible();
  await expect(page.locator('#ai-assistant-sidebar')).toBeHidden();
  const mainBox = await page.locator('#main-content').boundingBox();
  expect(mainBox.width).toBeGreaterThan(900);

  await page.locator('#sidebar-mode-switch').click();
  await expect(page.getByRole('heading', { name: '排考试与考场' })).toBeVisible();
  await expect(page.locator('[data-exam-workflow-stage]')).toHaveCount(4);
  await expect(page.locator('[data-exam-workflow-stage="subjects"]')).toHaveAttribute('aria-current', 'step');

  const examRoomRows = page.locator('#exam-room-list [data-exam-room-row]');
  await expect(examRoomRows).toHaveCount(0);
  await page.locator('#exam-new-room-name').fill('临时考场');
  await page.locator('#exam-add-room').click();
  await expect(examRoomRows).toHaveCount(1);
  const addedRoom = examRoomRows.first();
  await addedRoom.locator('[data-exam-room-name]').fill('报告厅');
  await addedRoom.locator('[data-exam-room-name]').press('Tab');
  await page.locator('#exam-new-room-name').fill('考场 B');
  await page.locator('#exam-add-room').click();
  await expect(examRoomRows).toHaveCount(2);
  page.once('dialog', dialog => dialog.accept());
  await examRoomRows.nth(1).getByRole('button', { name: '删除' }).click();
  await expect(examRoomRows).toHaveCount(1);
  await page.locator('#exam-save-rooms').click();
  await expect(page.locator('#exam-room-save-status')).toContainText('已保存 1 个考场');
  const savedRoomCatalog = await (await page.request.get('/api/exam-rooms')).json();
  expect(savedRoomCatalog.data.rooms.map(room => room.name)).toEqual(['报告厅']);
  expect((await (await page.request.get('/api/exams')).json()).data.plan.exams).toHaveLength(0);

  await page.locator('#exam-course-select').selectOption('MATH');
  await page.getByRole('button', { name: '添加考试' }).click();
  await page.locator('#exam-course-select').selectOption('BIO');
  await page.getByRole('button', { name: '添加考试' }).click();
  await expect(page.locator('[data-exam-workflow-status="subjects"]')).toContainText('2 门已添加');
  const mathDuration = page.locator('[data-exam-course-row="EXAM_MATH"] [data-exam-duration]');
  await mathDuration.fill('65');
  await mathDuration.press('Tab');
  await expect(mathDuration).toHaveValue('65');
  const mathPriority = page.locator('[data-exam-course-row="EXAM_MATH"] [data-exam-marking-priority]');
  const biologyPriority = page.locator('[data-exam-course-row="EXAM_BIO"] [data-exam-marking-priority]');
  await expect(mathPriority).toHaveValue('normal');
  await expect(biologyPriority).toHaveValue('high');
  await biologyPriority.selectOption('normal');
  await expect(page.locator('#exam-plan-status')).toContainText('恢复为普通顺序');
  await biologyPriority.selectOption('high');
  await expect(page.locator('#exam-plan-status')).toContainText('设为阅卷优先');
  await page.getByRole('button', { name: '继续设置考试窗口' }).click();
  await expect(page.locator('[data-exam-workflow-stage="config"]')).toHaveAttribute('aria-current', 'step');

  await page.locator('#exam-start-date').fill('2027-01-21');
  await page.locator('#exam-day-end').fill('09:30');
  await page.locator('#exam-breaks').fill('');
  await page.locator('#exam-require-all-teachers').uncheck();
  await page.getByRole('button', { name: '保存并进入第 3 步' }).click();
  await expect(page.locator('[data-exam-workflow-stage="timetable"]')).toHaveAttribute('aria-current', 'step');
  const savedExamPlan = await (await page.request.get('/api/exams')).json();
  expect(savedExamPlan.data.plan.config.rooms.map(room => room.name)).toContain('报告厅');
  expect(savedExamPlan.data.plan.config.rooms.map(room => room.name)).toEqual(['报告厅']);
  expect(savedExamPlan.data.plan.config.breaks).toEqual([]);
  expect(savedExamPlan.data.plan.exams.find(exam => exam.course_id === 'MATH').duration_minutes).toBe(65);
  const timetableAccepted = page.waitForResponse(response =>
    response.url().endsWith('/api/exams/solve') && response.status() === 202);
  await page.getByRole('button', { name: '生成考试时间表' }).click();
  await timetableAccepted;
  await expect(page.locator('#computation-progress')).toBeVisible();
  await expect(page.locator('#exam-result-card')).toBeVisible({ timeout: 120_000 });
  await expect(page.locator('#exam-schedule-rows')).toContainText('数学');
  await expect(page.locator('#exam-schedule-rows')).toContainText('生物');
  await expect(page.locator('#exam-schedule-rows')).toContainText('阅卷优先科目');
  const scheduleRows = page.locator('#exam-schedule-rows tr:not(.exam-session-group)');
  await expect(scheduleRows.first()).toContainText('生物');
  await expect(scheduleRows.nth(1)).toContainText('数学');
  await expect(page.locator('#exam-review-validation')).toContainText('校验通过');
  await expect(page.locator('#exam-review-validation')).toContainText('学生冲突将在第 4 步');
  await expect(scheduleRows.first().locator('td').nth(7)).toContainText('第 4 步校验');
  await expect(page.locator('#computation-progress-note')).toContainText('结果位置：排考试 → 安排结果');

  await page.getByRole('button', { name: '审核通过，继续安排考场' }).click();
  await expect(page.locator('#exam-staff-button')).toBeEnabled();
  const staffingAccepted = page.waitForResponse(response =>
    response.url().endsWith('/api/exams/solve') && response.status() === 202);
  await page.locator('#exam-staff-button').click();
  await staffingAccepted;
  await expect(page.locator('#exam-staffing-status')).toContainText('均已生成并通过校验', { timeout: 120_000 });
  await expect(page.locator('#exam-session-duty-rows')).toContainText('数学任课教师');
  await expect(page.locator('#exam-session-duty-rows')).toContainText('安生监考教师');
  await expect(page.locator('#exam-teacher-duty-summary')).toContainText('可监考教师');
  await page.locator('#exam-show-export-button').click();
  await expect(page.locator('#exam-export-panel')).toBeVisible();
  await expect(page.locator('#exam-export-button')).toHaveText('导出考试安排与座次 Excel');

  const download = page.waitForEvent('download');
  await page.locator('#exam-export-button').click();
  expect((await download).suggestedFilename()).toBe('考试安排与考场座次.xlsx');

  await page.reload();
  await expect(page.getByRole('heading', { name: '排考试与考场' })).toBeVisible();
  await expect(page.locator('[data-exam-workflow-stage="staffing"]')).toHaveAttribute('aria-current', 'step');
  await expect(page.locator('#computation-progress')).toBeVisible();
  await expect(page.locator('#computation-progress-result')).toBeVisible();
  await expect(page.locator('#computation-progress-note')).toContainText('结果位置：排考试 → 安排结果');
});
