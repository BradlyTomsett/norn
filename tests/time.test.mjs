import test from 'node:test';
import assert from 'node:assert/strict';
import { generateWorld } from '../engine/worldgen.js';
import { prepareTurn, finishTurn } from '../engine/turn.js';
import { targetMinutes, timePreview, narrativeTime } from '../engine/time.js';
import { judge } from '../engine/resolve.js';
import { makeRng } from '../engine/rng.js';
import { settleReply } from '../engine/reply.js';
import { buildTurnRequest } from '../engine/context.js';

const fresh = () => { const s = generateWorld({ regionId: 'greywater', familyKey: 'npc_farmer', seed: 7, name: '旅人' }).state;
  s.clock.hour = 21; s.clock.minute = 30; return s; };

test('目标时间按当前时钟和跨日计算，模糊时间按已处于时间段处理', () => {
  const s = fresh(), clock = s.clock;
  for (const [text, minutes] of [['推进到后半夜', 150], ['等到天亮', 510], ['守夜到凌晨三点', 330], ['睡到明早', 570]]) {
    assert.equal(targetMinutes(text, clock), minutes, text); assert.equal(judge(s, text, makeRng(1)).minutes, minutes, text);
  }
  assert.equal(targetMinutes('推进到后半夜', { hour: 2, minute: 30 }), 0);
  assert.equal(targetMinutes('睡到明早', { hour: 2, minute: 30 }), 270);
  assert.equal(targetMinutes('等到明天早上', { hour: 2, minute: 30 }), 1710);
  assert.equal(judge(s, '问他三天前发生什么', makeRng(1)).minutes < 60, true);
  assert.equal(judge(s, '明天再去北仓', makeRng(1)).minutes, 0);
  assert.equal(timePreview(clock, 150), '21:30 → 次日 00:00，推进 2 h 30 m');
});

test('复合行动使用前一步结束时刻，选择时间在原副本重算且原状态不变', () => {
  const s = fresh(), before = structuredClone(s), p = prepareTurn(s, '问候老杜，然后守夜到后半夜', 'time:multi');
  assert.equal(p.judged.minutes, 150); assert.equal(p.state.clock.hour, 0); assert.equal(p.state.clock.minute, 0);
  const custom = prepareTurn(s, '问候老杜，然后守夜到后半夜', 'time:multi', { minutesOverride: 330 });
  assert.equal(custom.state.clock.hour, 3); assert.equal(custom.state.clock.minute, 0);
  assert.equal(finishTurn(custom, {}).state.turn, s.turn + 1); assert.deepEqual(s, before);
});

test('只使用真实叙述的时间，不把对话中的过去、约定、否定当成当前时间', () => {
  const clock = { hour: 21, minute: 30 };
  assert.deepEqual(narrativeTime('到了次日凌晨3点，有人闯入仓库。', clock), { minutes: 330, quote: '到了次日凌晨3点，有人闯入仓库' });
  assert.equal(narrativeTime('后半夜，有人闯入仓库。', clock)?.minutes, 150);
  assert.equal(narrativeTime('此时已是次日凌晨3点，你问老杜是否听到动静。', clock)?.minutes, 330);
  assert.equal(narrativeTime('已经安静下来，现在是次日03:00。', clock)?.minutes, 330);
  assert.equal(narrativeTime('本轮共经过2小时。', clock)?.minutes, 120);
  for (const text of ['你问“现在是凌晨三点吗？”', '他约定明天凌晨三点见面。', '还没有到凌晨三点。', '大家开始守夜。\n【你现在可以做什么】\n① 等到天亮']) assert.equal(narrativeTime(text, clock), null);
});

test('正文时间自动优先于预估，原文不重写，时间和账目只从回合前结算一次', async () => {
  const s = fresh(), original = structuredClone(s), p = prepareTurn(s, '支付5铜，然后等到后半夜', 'time:auto');
  const delta = { transactions: [{ kind: 'payment', copper: 5, note: '玩家指定付款' }] };
  const raw = '此时已是次日凌晨3点，仓里仍然安静。\n```json\n' + JSON.stringify(delta) + '\n```';
  const expectedPlan = prepareTurn(s, p.text, p.id, { minutesOverride: 330 }); buildTurnRequest(expectedPlan);
  const expected = finishTurn(expectedPlan, delta);
  let checks = 0;
  const result = await settleReply(p, raw, { prepareContext: next => { next.request = buildTurnRequest(next); },
    reviewContinuity: async (text, next) => { checks++; assert.equal(text, raw); assert.equal(next.judged.minutes, 330); assert.match(next.request.system, /本次已按候选正文的330分钟/); } });
  assert.equal(checks, 1); assert.equal(result.raw, raw); assert.equal(result.repaired, false);
  assert.deepEqual(result.state, expected.state); assert.equal(result.plan.narrativeTiming.minutes, 330);
  assert.deepEqual(s, original); assert.equal(p.judged.minutes < 330, true);
});

test('修复后的最终正文重新决定时间，中途事件无需重写确认，旧草稿能直接结算', async () => {
  const s = fresh(), p = prepareTurn(s, '守夜到天亮', 'time:interrupt');
  const interrupted = '到了次日凌晨1点，有人闯入仓库。\n```json\n{}\n```';
  const result = await settleReply(p, interrupted);
  assert.equal(result.state.clock.hour, 1); assert.equal(result.state.clock.minute, 0); assert.equal(result.raw, interrupted);
  const bad = '到了次日凌晨1点。\n```json\n{"time":{"minutes":1}}\n```';
  const repaired = await settleReply(p, bad, { repair: async () => ({}) });
  assert.equal(repaired.state.clock.hour, 1);
  const revised = await settleReply(prepareTurn(s, '继续等待', 'time:revision'), '你承诺接下所有任务。\n```json\n{}\n```',
    { repairAgency: async () => '此时已是次日凌晨2点，仓里仍然安静。\n```json\n{}\n```' });
  assert.equal(revised.state.clock.hour, 2); assert.equal(revised.plan.narrativeTiming.minutes, 270);
});
