import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
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
  await page.getByRole('button', { name: '隐藏测试工具', exact: true }).click();
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

test('物价上下限不改直接保存、固定与单边价格刷新保留，非法边界不删除', async ({ page }) => {
  await open(page); await page.getByRole('button', { name: '隐藏测试工具', exact: true }).click();
  await page.getByRole('button', { name: '状态', exact: true }).click();
  await page.getByRole('button', { name: '物价', exact: true }).click();
  const lower = page.getByRole('textbox', { name: '针线包（一套）下限（铜）', exact: true });
  const upper = page.getByRole('textbox', { name: '针线包（一套）上限（铜）', exact: true });
  await expect(lower).toHaveValue('10'); await expect(upper).toHaveValue('40');
  await page.getByRole('button', { name: '保存改动', exact: true }).click();
  await expect(page.locator('#px-msg')).toContainText('已保存 0 处改动');
  await lower.fill('90'); await page.getByRole('button', { name: '保存改动', exact: true }).click();
  await expect(page.locator('#px-msg')).toContainText('针线包（一套）：下限不能高于上限');
  await page.getByRole('button', { name: '概览', exact: true }).click(); await page.getByRole('button', { name: '物价', exact: true }).click();
  await expect(lower).toHaveValue('10'); await expect(upper).toHaveValue('40');
  await page.getByRole('textbox', { name: '物品或服务名', exact: true }).fill('测试茶匙');
  await page.getByRole('textbox', { name: '新增价格下限（铜）', exact: true }).fill('1200');
  await page.getByRole('textbox', { name: '新增价格上限（铜）', exact: true }).fill('1200');
  await page.getByRole('button', { name: '＋ 加进物价表', exact: true }).click();
  await expect(page.locator('#px-msg')).toContainText('已加入物价');
  await upper.fill(''); await page.getByRole('button', { name: '保存改动', exact: true }).click();
  await expect(page.locator('#px-msg')).toContainText('已保存');
  await page.reload(); await page.locator('#input').waitFor({ state: 'visible' });
  await page.getByRole('button', { name: '隐藏测试工具', exact: true }).click(); await page.getByRole('button', { name: '状态', exact: true }).click();
  await page.getByRole('button', { name: '物价', exact: true }).click();
  await expect(lower).toHaveValue('10'); await expect(upper).toHaveValue('');
  await expect(page.getByRole('textbox', { name: '测试茶匙下限（铜）', exact: true })).toHaveValue('1200');
  await expect(page.getByRole('textbox', { name: '测试茶匙上限（铜）', exact: true })).toHaveValue('1200');
  await lower.fill(''); await page.getByRole('button', { name: '保存改动', exact: true }).click(); await expect(lower).toHaveCount(0);
});

test('输入前可查看预计动作，近距离移动不跳过半天', async ({ page }) => {
  await open(page); await page.getByRole('button', { name: '隐藏测试工具', exact: true }).click();
  await page.locator('#input').fill('走到柜台前'); await expect(page.locator('#action-preview')).toContainText('分钟');
  await expect(page.locator('#action-preview')).not.toContainText('小时');
  await page.locator('#input').fill('抓住窃贼'); await expect(page.locator('#action-preview')).toContainText('动手');
});

test('五金被写成五十金会自动修复一次，按明确金额扣款', async ({ page }) => {
  await open(page); await page.getByRole('button', { name: '模拟金额放大', exact: true }).click();
  await act(page, '给老杜5金币'); await expect(page.locator('#turn-status')).toContainText('已在本机保存');
  await expect(page.locator('#fixture-monitor')).toContainText('随身：950000 铜');
  await expect(page.locator('#fixture-controls')).toHaveAttribute('data-requests', '3');
  await expect(page.locator('.turn-receipt')).toContainText('5 金');
});
test('旧事项去重、归档、重新打开并在刷新后保留', async ({ page }) => {
  await open(page); await page.getByRole('button', { name: '状态', exact: true }).click();
  await page.locator('#cs-tabs').getByRole('button', { name: '事项', exact: true }).click();
  await expect(page.locator('#task-maintenance-status')).toContainText('事项已自动整理');
  await expect(page.getByRole('button', { name: '标记完成', exact: true })).toHaveCount(1);
  await page.getByRole('button', { name: '标记完成', exact: true }).click();
  await expect(page.locator('#cs-body')).toContainText('历史事项（1）');
  await page.reload(); await page.getByRole('button', { name: '状态', exact: true }).click();
  await page.locator('#cs-tabs').getByRole('button', { name: '事项', exact: true }).click();
  await expect(page.locator('#task-maintenance-status')).toContainText('事项已自动整理');
  await page.locator('#cs-body summary').filter({ hasText: '历史事项' }).click(); await page.getByRole('button', { name: '重新打开', exact: true }).click();
  await expect(page.getByRole('button', { name: '标记完成', exact: true })).toHaveCount(1);
});
test('当前委托移到状态事项，旧事项自动完成与精简，待领酬不自动付款且刷新后保持', async ({ page }) => {
  await open(page, 'tasks'); await page.getByRole('button', { name: '隐藏测试工具', exact: true }).click();
  await page.getByRole('button', { name: '存档', exact: true }).click(); await page.getByRole('button', { name: '设置', exact: true }).click();
  await expect(page.locator('#settings')).not.toContainText('当前委托'); await page.locator('#set-close').click(); await page.locator('#btn-saves-close').click();
  await page.getByRole('button', { name: '状态', exact: true }).click(); await page.locator('#cs-tabs').getByRole('button', { name: '事项', exact: true }).click();
  await expect(page.locator('#task-maintenance-status')).toContainText('事项已自动整理');
  await expect(page.locator('#current-contracts')).toContainText('北仓清点'); await expect(page.locator('#current-contracts')).not.toContainText('西门仓库调查');
  await expect(page.locator('#unpaid-contracts')).toContainText('西门仓库调查');
  await expect(page.locator('#active-tasks .task-entry')).toHaveCount(0); await expect(page.locator('#active-tasks')).not.toContainText('明晚日落');
  await expect(page.locator('#fixture-monitor')).toContainText('回合：0'); await expect(page.locator('#fixture-monitor')).toContainText('随身：1000000 铜');
  const contract = page.locator('[data-contract-id="warehouse"]'); await contract.locator('summary').click();
  await contract.getByRole('spinbutton').fill('2500000'); await contract.getByRole('button', { name: '保存酬劳', exact: true }).click();
  await expect(page.locator('#task-maintenance-status')).toContainText('委托酬劳已保存');
  await page.locator('#cs-body summary').filter({ hasText: '历史事项' }).click();
  await expect(page.locator('#cs-body')).toContainText('定下三夜守夜的班次'); await expect(page.locator('#cs-body')).toContainText('已归档');
  await expect(page.locator('#fixture-controls')).toHaveAttribute('data-reviews', '1');
  await page.reload(); await page.getByRole('button', { name: '状态', exact: true }).click(); await page.locator('#cs-tabs').getByRole('button', { name: '事项', exact: true }).click();
  await expect(page.locator('#task-maintenance-status')).toContainText('事项已自动整理');
  await expect(page.locator('#active-tasks .task-entry')).toHaveCount(0); await expect(page.locator('#current-contracts')).toContainText('250 金');
  await expect(page.locator('#fixture-controls')).not.toHaveAttribute('data-reviews', /\d/);
});

test('固定六项技能含零值，旧药材保留数值，小步骤退出清单且刷新后保持', async ({ page }) => {
  await open(page, 'skills'); await page.getByRole('button', { name: '隐藏测试工具', exact: true }).click();
  await page.getByRole('button', { name: '状态', exact: true }).click();
  const labels = page.locator('.skill-list .lab');
  await expect(labels).toHaveText(['武技130', '魔法0', '炼金20', '机械0', '察觉71.1', '交涉55.3']);
  await expect(page.locator('.skill-list')).not.toContainText('药材');
  await page.locator('#cs-tabs').getByRole('button', { name: '事项', exact: true }).click();
  await expect(page.locator('#task-maintenance-status')).toContainText('事项已自动整理');
  await expect(page.locator('#current-contracts')).toContainText('北仓清点');
  await expect(page.locator('#active-tasks .task-entry')).toHaveCount(0);
  await page.locator('#cs-body summary').filter({ hasText: '历史事项' }).click();
  await expect(page.locator('#cs-body')).toContainText('历史事项（5）');
  await expect(page.getByRole('button', { name: '重新打开', exact: true })).toHaveCount(0);
  await page.reload(); await page.getByRole('button', { name: '状态', exact: true }).click();
  await expect(labels).toHaveText(['武技130', '魔法0', '炼金20', '机械0', '察觉71.1', '交涉55.3']);
  await page.locator('#cs-tabs').getByRole('button', { name: '事项', exact: true }).click();
  await expect(page.locator('#active-tasks .task-entry')).toHaveCount(0);
});
test('同名人物在发请求前选身份，搜索定位完整历史', async ({ page }) => {
  await open(page, 'long'); await act(page, '问候凯尔');
  await expect(page.locator('#log')).toContainText('这里有同名人物');
  await expect(page.locator('#fixture-controls')).not.toHaveAttribute('data-requests', /\d/);
  await page.getByRole('button', { name: /^凯尔（30岁·佣兵/ }).click();
  await expect(page.locator('#input')).toHaveValue(/问候凯尔（30岁·佣兵/);
  await expect(page.locator('#composer #btn-search')).toHaveCount(0);
  await page.getByRole('button', { name: '状态', exact: true }).click();
  await expect(page.locator('#sheet .cs-top #btn-search')).toBeVisible();
  await page.getByRole('button', { name: '查找', exact: true }).click();
  await page.getByRole('searchbox', { name: '查找内容' }).fill('蓝色信物');
  await expect(page.locator('#search-count')).toContainText('找到 1 条');
  await page.locator('#search-results button').click();
  await expect(page.locator('.history-focus')).toContainText('蓝色信物');
  await expect(page.locator('#input')).toBeHidden();
  await page.getByRole('button', { name: '回到最新记录', exact: true }).click();
  await expect(page.locator('#input')).toBeVisible();
});

test('完整上下文含旧约定，事实冲突自动重写；连续纠错保留全部要求且不多走回合', async ({ page }) => {
  await open(page, 'context'); await page.getByRole('button', { name: '模拟事实冲突', exact: true }).click();
  await act(page, '说清今晚队伍和分配约定'); await expect(page.locator('#turn-status')).toContainText('已在本机保存');
  await expect(page.locator('#fixture-controls')).toHaveAttribute('data-has-agreement', 'true');
  await expect(page.locator('#fixture-controls')).toHaveAttribute('data-has-correction', 'true');
  await expect(page.locator('#fixture-controls')).toHaveAttribute('data-context-reviews', '1');
  await expect(page.locator('#log')).toContainText('六名成员都在'); await expect(page.locator('#fixture-monitor')).toContainText('回合：1');
  await act(page, '/纠错 不要出现巡锁2个字！'); await expect(page.locator('#turn-status')).toContainText('已在本机保存');
  await act(page, '/纠错 不要出现查锁2个字！'); await expect(page.locator('#turn-status')).toContainText('已在本机保存');
  await expect(page.locator('#fixture-controls')).toHaveAttribute('data-has-both-corrections', 'true');
  await expect(page.locator('#fixture-monitor')).toContainText('回合：1');
  await page.reload(); await act(page, '继续说明安排'); await expect(page.locator('#turn-status')).toContainText('已在本机保存');
  await expect(page.locator('#fixture-controls')).toHaveAttribute('data-has-correction', 'true');
});

test('没有回退快照的旧存档仍可保存事实纠正，不推进时间或请求生成', async ({ page }) => {
  await open(page, 'context'); await act(page, '/纠错 瑟拉一直是我的搭档');
  await expect(page.locator('#log')).toContainText('已保存这条纠正');
  await expect(page.locator('#fixture-monitor')).toContainText('回合：0');
  await expect(page.locator('#fixture-controls')).not.toHaveAttribute('data-requests', /\d/);
});

test('旧纠正加载后写入持久存档，立即导出和刷新都保留纠正及冲突标记', async ({ page }) => {
  await open(page, 'context');
  await page.getByRole('button', { name: '存档', exact: true }).click();
  const download = page.waitForEvent('download'); await page.getByRole('button', { name: '导出', exact: true }).click();
  const payload = JSON.parse(await readFile(await (await download).path(), 'utf8'));
  expect(payload.state.continuity.corrections).toHaveLength(1);
  expect(payload.state.continuity.corrections[0].text).toContain('瑟拉一直是我的搭档');
  expect(payload.state.knowledge.find(k => k.id === 'old-membership').status).toBe('disputed');
  expect(payload.state.player.unfinished).toHaveLength(0); expect(payload.state.turn).toBe(0); expect(payload.messages).toHaveLength(24);
  await page.reload(); await page.getByRole('button', { name: '状态', exact: true }).click();
  await expect(page.locator('#cs-body')).not.toContainText('定下瑟拉是否加入');
});
test('擅自台词与承诺重写一次，诊断包含用量且不含原文或密钥', async ({ page }) => {
  await open(page); await page.getByRole('button', { name: '模拟擅自承诺', exact: true }).click();
  await act(page, '问店主面包多少钱'); await expect(page.locator('#turn-status')).toContainText('已在本机保存');
  await expect(page.locator('#log')).toContainText('等你决定是否购买');
  await expect(page.locator('#log')).not.toContainText('这笔钱我来付');
  await expect(page.locator('#fixture-controls')).toHaveAttribute('data-requests', '3');
  await page.getByRole('button', { name: '存档', exact: true }).click();
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByRole('button', { name: '复制诊断信息', exact: true }).click();
  await expect(page.locator('#diag-out')).toContainText('"promptTokens":360');
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
test('手机常用装备最多9栏，箭矢分颜色堆叠，护甲盾牌单选，刷新保持配置', async ({ page }) => {
  await open(page, 'gear'); await page.getByRole('button', { name: '隐藏测试工具', exact: true }).click();
  await page.getByRole('button', { name: '状态', exact: true }).click();
  await page.locator('#cs-tabs').getByRole('button', { name: '装备', exact: true }).click();
  await expect(page.locator('#cs-body > .gear-group').first()).toBeVisible();
  await expect(page.locator('#cs-body')).not.toContainText('磨刀石');
  await expect(page.locator('#loadout-editor')).toBeHidden();
  await expect(page.locator('#gear-current-weapons')).toContainText('长剑');
  await page.locator('#gear-edit > summary').click();
  await expect(page.locator('#gear-slot-count')).toContainText('1/9');
  const choices = page.locator('[data-gear-weapon]'); await expect(choices).toHaveCount(10);
  for (let i = 0; i < 9; i++) await choices.nth(i).check();
  await expect(page.locator('#gear-slot-count')).toContainText('9/9'); await expect(page.locator('#gear-save')).toBeEnabled();
  await choices.nth(9).check(); await expect(page.locator('#gear-message')).toContainText('最多占 9'); await expect(page.locator('#gear-save')).toBeDisabled();
  await choices.nth(9).uncheck();
  await expect(page.getByRole('spinbutton', { name: '弓箭（灰）使用数量', exact: true })).toHaveValue('500');
  await page.locator('[name="gear-shield"][value="木盾（灰）"]').check(); await page.locator('[name="gear-shield"][value="铁盾（蓝）"]').check();
  await expect(page.locator('[name="gear-shield"]:checked')).toHaveCount(1);
  await page.locator('[name="gear-armor"][value="皮甲（紫）"]').check();
  await page.locator('#gear-primary').selectOption('大枪（紫）'); await page.locator('#gear-save').click();
  await expect(page.locator('#gear-message')).toContainText('已保存');
  await expect(page.locator('#loadout-editor')).toBeHidden();
  await expect(page.locator('#gear-current-weapons')).toContainText('弓箭 ×500');
  await page.reload(); await page.getByRole('button', { name: '隐藏测试工具', exact: true }).click();
  await page.getByRole('button', { name: '状态', exact: true }).click(); await page.locator('#cs-tabs').getByRole('button', { name: '装备', exact: true }).click();
  await page.locator('#gear-edit > summary').click();
  await expect(page.locator('#gear-slot-count')).toContainText('9/9'); await expect(page.locator('#gear-primary')).toHaveValue('大枪（紫）');
  await expect(page.locator('[name="gear-armor"]:checked')).toHaveValue('皮甲（紫）');
  await expect(page.locator('[name="gear-shield"]:checked')).toHaveValue('铁盾（蓝）');
  await page.locator('#cs-tabs').getByRole('button', { name: '物品', exact: true }).click();
  await expect(page.locator('#cs-body').getByText('磨刀石（绿） ×3', { exact: true })).toBeVisible();
  await page.locator('.it-pick[data-name="磨刀石（绿）"]').click();
  await expect(page.locator('#it-name')).toHaveValue('磨刀石（绿）');
  await page.locator('[data-item-act="del"]').click();
  await expect(page.locator('#cs-body').getByText('磨刀石（绿） ×2', { exact: true })).toBeVisible();
});
test('免疫矛盾正文自动重写一次，本回合武器和生效能力进入结算', async ({ page }) => {
  await open(page, 'gear'); await page.getByRole('button', { name: '模拟无视免疫', exact: true }).click();
  await page.getByRole('button', { name: '隐藏测试工具', exact: true }).click();
  await act(page, '用大枪攻击守卫'); await expect(page.locator('#turn-status')).toContainText('已在本机保存');
  await expect(page.locator('#log')).not.toContainText('鲜血流了下来');
  await expect(page.locator('.turn-receipt')).toContainText('使用：大枪（紫）');
  await expect(page.locator('.turn-receipt')).toContainText('天赋免疫已生效');
  await expect(page.locator('#fixture-controls')).toHaveAttribute('data-requests', '3');
});
