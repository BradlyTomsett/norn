import test from 'node:test';
import assert from 'node:assert/strict';
import { generateWorld } from '../engine/worldgen.js';
import { upgradeState } from '../engine/schema.js';
import { prepareTurn } from '../engine/turn.js';
import { buildTurnRequest } from '../engine/context.js';
import { stateBlock } from '../engine/state.js';
import { eventPrompt } from '../engine/random-events.js';

function fresh() {
  const { state } = generateWorld({ regionId: 'greywater', seed: 23, playerName: '测试者' });
  state.saveId = 'sv_prompt'; upgradeState(state); state.clock = { year: 222, doy: 30, hour: 21, minute: 30, weather: 'clear' }; return state;
}
const request = (state, input, options = {}) => buildTurnRequest(prepareTurn(state, input, 'turn:prompt', options));

test('请求区分回合开始时间与未来预估，不将预计事件作为已发生', () => {
  const state = fresh(), req = request(state, '等待到明天早上');
  assert.match(req.system, /【回合开始时的状态】/);
  assert.match(req.system, /1 月 30 日 · 21:30/);
  assert.match(req.system, /【预计时间内可能发生的世界变化，仅为预估】/);
  assert.doesNotMatch(req.system, /【本回合已结算的世界变化】/);
  assert.match(req.messages.at(-1).content, /本回合起始时间/);
  assert.equal(req.system.includes('【本轮玩家原始输入，逐项处理】'), false);
  assert.equal(state.clock.doy, 30);
});

test('长场景保留末尾问题和事实，不把未知位置视为确定在场', () => {
  const state = fresh(), content = '前面的场景。'.repeat(180) + '最后仓头问：“今晚由谁守后半夜？”';
  const req = request(state, '回答仓头', { messages: [{ role: 'assistant', content }] });
  assert.match(req.system, /最近已发生的场景末尾/);
  assert.match(req.system, /今晚由谁守后半夜/);
  assert.match(req.system, /不等于均在场/);
});

test('仅依据来源区分有效约定与传闻，玩家原文及未来计划清楚保留', () => {
  const state = fresh(); state.knowledge = [
    { id: 'agree', text: '分成按约定对半', source: '双方当面约定', kind: 'agreement' },
    { id: 'rumor', text: '仓门附近有陌生人', source: '市集传闻' },
  ];
  const text = '问候同伴，然后明天去仓库'; const req = request(state, text);
  assert.match(req.system, /【当前有效约定、队伍关系与决定】/);
  assert.match(req.system, /【传闻与推测】/);
  assert.match(req.messages.at(-1).content, /问候同伴/);
  assert.match(req.messages.at(-1).content, /留待以后：明天去仓库/);
});

test('大量收藏按需提供，直接提及的装备和泛指库存不丢；价格按行动相关性提供', () => {
  const state = fresh(); state.player.equipment = Array.from({ length: 30 }, (_, i) => `收藏剑${i}（灰）`);
  let req = request(state, '问候老朋友');
  assert.match(req.system, /其他收藏/); assert.doesNotMatch(req.system, /收藏剑29（灰）/);
  assert.doesNotMatch(req.system, /【游戏物价】（来自 economy\.js/);
  req = request(state, '用收藏剑29攻击敌人'); assert.match(req.system, /收藏剑29（灰）/);
  req = request(state, '看看我的装备'); assert.match(req.system, /收藏剑29（灰）/);
  req = request(state, '询问面包价格'); assert.match(req.system, /【游戏物价】（来自 economy\.js/);
  assert.match(stateBlock(state), /收藏剑29（灰）/);
});

test('健康变化与死亡条件传给AI，随机事件附上场景且等待玩家决定', () => {
  const state = fresh(); state.player.body.health = 1; state.player.talent = null;
  const req = request(state, '攻击巫妖皇');
  assert.match(req.system, /【本轮引擎健康判定】起始健康1/);
  assert.match(req.system, /若没有本轮明确发生的恢复效果，结算后健康为0/);
  const prompt = eventPrompt({ label: '盗窃', scene: 'town', prompt: '可能有人偷窃' }, { state, judged: { actionText: '在集市等待' } });
  assert.match(prompt, /起始地点：灰水镇/); assert.match(prompt, /当前行动：在集市等待/); assert.match(prompt, /等待玩家选择/);
});
