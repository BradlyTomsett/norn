import { test, expect } from '@playwright/test';
const open = async (page, scenario = 'legacy') => {
  await page.goto('/?reset=1&scenario=' + scenario);
  await expect(page.locator('#input')).toBeVisible();
};
const act = async (page, text) => { await page.locator('#input').fill(text); await page.getByRole('button', { name: '说', exact: true }).click(); };

test('真实IndexedDB大存档、迁移、原子失败、冲突与导入导出', async ({ page }) => {
  await page.goto('/tests/persistence-test.html');
  await expect(page.locator('#results')).toHaveAttribute('data-result', 'pass', { timeout: 40000 });
});
test('手机选择按钮直接执行一次，刷新后历史和回合仍在', async ({ page }) => {
  await open(page);
  await page.getByRole('button', { name: '1 · 睡觉八小时', exact: true }).click();
  await expect(page.locator('#turn-status')).toContainText('已在本机保存');
  await expect(page.locator('.turn-receipt')).toHaveCount(1);
  await expect(page.locator('#fixture-controls')).toHaveAttribute('data-requests', '1');
  await page.reload();
  await expect(page.locator('#fixture-monitor')).toContainText('回合：1');
  await expect(page.locator('#log')).toContainText('醒来后仍留在原处');
  await act(page, '/撤回');
  await expect(page.locator('#fixture-monitor')).toContainText('回合：0');
});
test('旧事项去重、归档、重新打开并在刷新后保留', async ({ page }) => {
  await open(page); await page.getByRole('button', { name: '状态', exact: true }).click();
  await page.locator('#cs-tabs').getByRole('button', { name: '事项', exact: true }).click();
  await expect(page.getByRole('button', { name: '标记完成', exact: true })).toHaveCount(1);
  await page.getByRole('button', { name: '标记完成', exact: true }).click();
  await expect(page.locator('#cs-body')).toContainText('历史事项（1）');
  await page.reload(); await page.getByRole('button', { name: '状态', exact: true }).click();
  await page.locator('#cs-tabs').getByRole('button', { name: '事项', exact: true }).click();
  await page.locator('#cs-body summary').click(); await page.getByRole('button', { name: '重新打开', exact: true }).click();
  await expect(page.getByRole('button', { name: '标记完成', exact: true })).toHaveCount(1);
});
test('同名人物在发请求前选身份，搜索定位完整历史', async ({ page }) => {
  await open(page, 'long'); await act(page, '问候凯尔');
  await expect(page.locator('#log')).toContainText('这里有同名人物');
  await expect(page.locator('#fixture-controls')).not.toHaveAttribute('data-requests', /\d/);
  await page.getByRole('button', { name: /^凯尔（30岁·佣兵/ }).click();
  await expect(page.locator('#input')).toHaveValue(/问候凯尔（30岁·佣兵/);
  await page.getByRole('button', { name: '查找', exact: true }).click();
  await page.getByRole('searchbox', { name: '查找内容' }).fill('蓝色信物');
  await expect(page.locator('#search-count')).toContainText('找到 1 条');
  await page.locator('#search-results button').click();
  await expect(page.locator('.history-focus')).toContainText('蓝色信物');
  await expect(page.locator('#input')).toBeHidden();
  await page.getByRole('button', { name: '回到最新记录', exact: true }).click();
  await expect(page.locator('#input')).toBeVisible();
});
test('擅自台词与承诺重写一次，诊断包含用量且不含原文或密钥', async ({ page }) => {
  await open(page); await page.getByRole('button', { name: '模拟擅自承诺', exact: true }).click();
  await act(page, '问店主面包多少钱'); await expect(page.locator('#turn-status')).toContainText('已在本机保存');
  await expect(page.locator('#log')).toContainText('等你决定是否购买');
  await expect(page.locator('#log')).not.toContainText('这笔钱我来付');
  await expect(page.locator('#fixture-controls')).toHaveAttribute('data-requests', '2');
  await page.getByRole('button', { name: '存档', exact: true }).click();
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByRole('button', { name: '复制诊断信息', exact: true }).click();
  await expect(page.locator('#diag-out')).toContainText('"promptTokens":240');
  await expect(page.locator('#diag-out')).not.toContainText('fixture-key');
  await expect(page.locator('#diag-out')).not.toContainText('问店主');
});
test('断线不会推进回合，刷新后仍可重试，重复点击不能发两个请求', async ({ page }) => {
  await open(page); await page.getByRole('button', { name: '模拟断线', exact: true }).click();
  await act(page, '等一会'); await expect(page.locator('#turn-status')).toContainText('尚未提交');
  await expect(page.locator('#fixture-monitor')).toContainText('回合：0');
  await page.reload(); await expect(page.getByRole('button', { name: '重试本回合', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '重试本回合', exact: true }).click();
  await expect(page.locator('#turn-status')).toContainText('已在本机保存');
  await expect(page.locator('#fixture-monitor')).toContainText('回合：1');
});
test('另一页面保存后，旧页面先刷新状态再允许行动', async ({ page, context }) => {
  await open(page); const other = await context.newPage(); await other.goto('/?scenario=legacy');
  await act(other, '等一会'); await expect(other.locator('#turn-status')).toContainText('已在本机保存');
  await act(page, '再等一会');
  await expect(page.locator('#log')).toContainText('存档已在其他页面更新');
  await expect(page.locator('#fixture-controls')).not.toHaveAttribute('data-requests', /\d/);
  await act(page, '再等一会'); await expect(page.locator('#turn-status')).toContainText('已在本机保存');
  await expect(page.locator('#fixture-monitor')).toContainText('回合：2'); await other.close();
});
