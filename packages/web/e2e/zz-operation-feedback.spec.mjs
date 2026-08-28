import { expect, test } from '@playwright/test';

test('manual placement, native drag, solving, timetable adjustment and overlays all respond in Chrome', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('link', { name: '教师分工' }).click();
  await page.locator('#btn-build-tasks').click();
  await expect(page.locator('#assignment-action-feedback')).toContainText('生成完成');

  await page.getByRole('link', { name: '排课表' }).click();
  const courseCard = page.locator('[data-manual-item-id="MATH"]');
  const manualTarget = page.locator('.manual-drop-target[data-slot-id="D2P1"]');
  await expect(courseCard).toBeVisible();

  await courseCard.dragTo(manualTarget);
  await expect(manualTarget).toContainText('数学');
  await expect(page.locator('#manual-plan-status')).toContainText('手动草稿：1 个课程格');

  await page.locator('#manual-undo-action').click();
  await expect(manualTarget).toContainText('拖入课程');
  await courseCard.click();
  await expect(page.locator('#manual-plan-status')).toContainText('现在点击课表中的目标时段');
  await manualTarget.click();
  await expect(manualTarget).toContainText('数学');

  page.on('dialog', dialog => {
    if (dialog.message().includes('现在查看总课表')) return dialog.dismiss();
    return dialog.accept();
  });
  await page.locator('#manual-confirm-plan').click();
  await expect(page.locator('#manual-plan-status')).toContainText('已锁定 1 个手动课程格');
  await expect(page.locator('#manual-ai-solve')).toBeEnabled();

  await page.locator('#manual-ai-solve').click();
  await expect(page.locator('#computation-progress')).toBeVisible();
  await expect(page.locator('#manual-plan-status')).toContainText('快速生成完成', { timeout: 30_000 });
  await expect(page.locator('#manual-ai-optimize')).toBeEnabled();

  await page.locator('details.manual-more-actions summary').click();
  await page.locator('#manual-unlock-plan').click();
  await expect(page.locator('#manual-plan-status')).toContainText('尚未锁定');

  await page.getByRole('link', { name: '改课表' }).click();
  const source = page.locator('.slot-cell.has-class[data-slot-id="D2P1"]');
  const target = page.locator('.slot-cell[data-slot-id="D3P1"]');
  const dragResponse = page.waitForResponse(response =>
    response.url().endsWith('/api/swap') && response.request().method() === 'POST');
  await source.dragTo(target);
  expect((await dragResponse).ok()).toBe(true);
  await expect(target).toContainText('数学');

  const clickMoveResponse = page.waitForResponse(response =>
    response.url().endsWith('/api/swap') && response.request().method() === 'POST');
  await target.click();
  await expect(page.locator('#schedule-editor-status')).toContainText('现在点击一个目标空格');
  await page.locator('.slot-cell[data-slot-id="D2P1"]').click();
  expect((await clickMoveResponse).ok()).toBe(true);
  await expect(page.locator('.slot-cell[data-slot-id="D2P1"]')).toContainText('数学');
  await expect(page.locator('#schedule-editor-status')).toContainText('可以继续选择课程或编辑工具');

  await page.locator('[data-schedule-template="self_study"]').click();
  await expect(page.locator('#schedule-editor-status')).toContainText('已选择“自习”');
  await page.locator('.slot-cell[data-slot-id="D3P2"]').click();
  await expect(page.locator('#schedule-editor-status')).toContainText('已显示 1 个自习/特殊事件标注');
  await expect(page.locator('[data-schedule-overlay-id]')).toHaveCount(1);
  await page.locator('[data-schedule-overlay-id]').click();
  await expect(page.locator('[data-schedule-overlay-id]')).toHaveCount(0);
});

test('state restore and stale export controls explain every step', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('link', { name: '系统设置' }).click();
  await page.locator('#policy-max-gap-days').fill('1');
  await page.getByRole('button', { name: '💾 保存排课策略' }).click();
  await expect(page.locator('#policy-save-status')).toContainText('已保存');
  await page.getByRole('button', { name: '刷新版本' }).click();
  await expect(page.locator('[data-restore-backup-id]').first()).toBeVisible();

  await page.locator('[data-restore-backup-id]').first().click();
  await expect(page.locator('#modal-title')).toHaveText('恢复数据版本');
  await expect(page.locator('#state-backup-restore-submit')).toBeDisabled();
  await page.locator('#state-backup-confirmation').fill('错误确认词');
  await expect(page.locator('#state-backup-restore-feedback')).toContainText('确认词尚未匹配');
  await page.locator('#state-backup-confirmation').fill('恢复此版本');
  await expect(page.locator('#state-backup-restore-submit')).toBeEnabled();
  await page.locator('#state-backup-restore-cancel').click();
  await expect(page.locator('#settings-backup-status')).toContainText('已取消恢复');

  await page.getByRole('link', { name: '导出课表' }).click();
  await page.locator('#export-target').selectOption('G10A');
  await page.getByRole('button', { name: '👁️ 预览' }).click();
  await expect(page.locator('#export-preview-content')).toContainText(/已排 \d+ 节课 · 当前课表需要重排/);
  await page.getByRole('button', { name: '📥 导出' }).click();
  await expect(page.getByText('当前没有有效排课结果，请先完成排课再导出')).toBeVisible();
});

test('AI assistant gives feedback for empty input and a controlled connection failure', async ({ page }) => {
  await page.goto('/');
  await page.locator('#btn-ai-assistant-open').click();
  const sendButton = page.locator('#btn-ai-assistant-send');
  await expect(sendButton).toBeInViewport();
  await sendButton.click();
  await expect(page.locator('#ai-assistant-status')).toContainText('请先输入问题');
  await expect(page.locator('#ai-assistant-input')).toBeFocused();

  const failedRequest = page.waitForResponse(response =>
    response.url().endsWith('/api/assistant/chat') && response.status() === 400);
  await page.locator('[data-ai-prompt]').first().click();
  await failedRequest;
  await expect(page.locator('#ai-assistant-status')).toContainText('请求失败', { timeout: 10_000 });
  await expect(page.locator('#ai-assistant-messages')).toContainText('暂时无法分析');
  await expect(sendButton).toBeEnabled();
});
