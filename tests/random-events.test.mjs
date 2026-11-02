import test from 'node:test';
import assert from 'node:assert/strict';
import { generateWorld } from '../engine/worldgen.js';
import { upgradeState } from '../engine/schema.js';
import { EVENT_TYPES, eventScene, selectRandomEvent, recordRandomEvent, leaveRandomEvent, inferEventEnd } from '../engine/random-events.js';
import { prepareTurn, followNarrativeTime } from '../engine/turn.js';
import { settleGeneratedReply } from '../engine/reply.js';
import { buildTurnRequest } from '../engine/context.js';
import * as store from '../store.js';

function fresh(seed = 1) {
  const { state } = generateWorld({ regionId: 'greywater', seed, playerName: '测试' });
  state.saveId = 'sv_random'; upgradeState(state); return state;
}

test('事件类型覆盖劫道、动物、魔法与盗窃，并结合场景选择', () => {
  for (const type of ['road_robbery', 'animal', 'magic', 'theft', 'task', 'person', 'discovery']) assert.ok(EVENT_TYPES.some(row => row.id === type));
  const state = fresh();
  assert.equal(eventScene(state, { travelScope: 'journey' }, '赶路'), 'road');
  assert.equal(eventScene(state, {}, '在仓库守夜'), 'work');
  assert.equal(eventScene(state, {}, '调查森林里的劫匪'), 'town');
  state.player.location.siteName = '森林';
  assert.equal(eventScene(state, {}, '调查线索'), 'wild');
  state.player.location.siteName = '灰水镇';
  for (let seed = 1; seed < 150; seed++) {
    state.seed = seed;
    const event = selectRandomEvent(state, { kind: 'travel', travelScope: 'journey', minutes: 2880 }, '赶路', 'high');
    if (event) assert.ok(EVENT_TYPES.find(row => row.id === event.type).scenes.includes('road'));
  }
});

test('地点取自实际位置，提到远方地点不改变场景，长途行动按路途处理', () => {
  const state = fresh(); state.player.location = { siteId: 'town', siteName: '灰水镇广场' };
  assert.equal(eventScene(state, {kind:'observe'}, '在城镇打听森林里的强盗'), 'town');
  assert.equal(eventScene(state, {travelScope:'route'}, '离开城镇前往森林'), 'road');
  state.player.location = { siteId: 'woods', siteName: '森林' };
  assert.equal(eventScene(state, {kind:'observe'}, '调查线索'), 'wild');
  assert.equal(eventScene(state, {travelScope:'journey'}, '从森林返回城镇'), 'road');
});

test('事件漏报状态保留进展，连续漏报不再阻塞新事件，相关行动仍可继续', () => {
  const state = fresh(), judged = {kind:'rest',minutes:480}; state.turn = 5;
  recordRandomEvent(state, {type:'road_robbery',scene:'road',label:'劫匪'}, 'e1', {status:'pending',text:'劫匪等候答复'});
  let event = selectRandomEvent(state, judged, '交出钱'); assert.equal(event.id, 'e1');
  state.turn++; recordRandomEvent(state, event, 'next');
  assert.equal(state.randomEvents[0].status, 'pending');
  event = selectRandomEvent(state, judged, '继续行动'); assert.equal(event.id, 'e1');
  state.turn++; recordRandomEvent(state, event, 'next');
  state.turn += 3;
  assert.notEqual(selectRandomEvent(state, judged, '在旅店睡觉', 'high')?.id, 'e1');
  assert.equal(selectRandomEvent(state, {kind:'social',minutes:5}, '回答劫匪')?.id, 'e1');
  event = selectRandomEvent(state, judged, '回答劫匪');
  recordRandomEvent(state, event, 'next', {status:'resolved',text:'劫匪离开'});
  assert.equal(state.randomEvents[0].status, 'resolved');
});

test('明确结束或成功离开现场才收起相应事件，其他事件与未知结果保留', () => {
  const event = {id:'e1',type:'road_robbery',scene:'road',label:'劫匪'};
  assert.equal(inferEventEnd(event, '劫匪逃走了。\n```json\n{}\n```')?.status, 'resolved');
  for (const text of ['劫匪没有逃走了。', '如果劫匪逃走了，再追上去。', '他说：“劫匪逃走了。”', '【可执行任务】\n劫匪逃走了。']) assert.equal(inferEventEnd(event, text), null);
  const base = fresh(); base.turn=10; base.player.location={siteId:'road',siteName:'道路'};
  recordRandomEvent(base,event,'e1',{status:'pending',text:'劫匪挡路'});
  const state=structuredClone(base); state.player.location={siteId:'town',siteName:'城镇'};
  recordRandomEvent(state,{type:'town',scene:'town',label:'市集'},'new',{status:'pending',text:'市集开张'});
  leaveRandomEvent(state,base,{travelScope:'route'},'逃回城镇',{type:'town'}, {status:'pending'});
  assert.equal(state.randomEvents.find(e=>e.id==='e1').status,'left');
  assert.equal(state.randomEvents.find(e=>e.id==='new').status,'pending');
  const unchanged=structuredClone(base); leaveRandomEvent(unchanged,base,{travelScope:'route'},'尝试逃走',event,null);
  assert.equal(unchanged.randomEvents[0].status,'pending');
  const followed=structuredClone(base); followed.player.location={siteId:'town',siteName:'城镇'};
  leaveRandomEvent(followed,base,{travelScope:'route'},'逃回城镇',event,{status:'pending'});
  assert.equal(followed.randomEvents[0].status,'pending');
});

test('实际回合漏写状态时根据明确结束语句更新事件，不增加模型请求', async () => {
  const state=fresh(); state.turn=8;
  recordRandomEvent(state,{type:'road_robbery',scene:'road',label:'劫匪'},'e1',{status:'pending',text:'劫匪挡路'});
  const plan=prepareTurn(state,'回答劫匪','turn:next');
  assert.equal(plan.randomEvent.id,'e1');
  const result=await settleGeneratedReply(plan,'劫匪逃走了。\n```json\n{}\n```');
  assert.equal(result.state.randomEvents.find(e=>e.id==='e1').status,'resolved');
  assert.equal(state.randomEvents[0].status,'pending');
});

test('频率档位、短对话、间隔与近期类型排重', () => {
  const count = { low: 0, medium: 0, high: 0 };
  for (let seed = 1; seed <= 500; seed++) {
    const state = fresh(seed), judged = { kind: 'rest', minutes: 480 };
    for (const level of Object.keys(count)) if (selectRandomEvent(state, judged, '等八小时', level)) count[level]++;
    assert.equal(selectRandomEvent(state, { kind: 'social', minutes: 120 }, '说话', 'high'), null);
    assert.equal(selectRandomEvent(state, { kind: 'observe', minutes: 10 }, '观察', 'high'), null);
  }
  assert.ok(count.low < count.medium && count.medium < count.high);
  const state = fresh(1); state.turn = 8; state.randomEvents = [{ id: 'old', turn: 8, type: 'magic' }];
  assert.equal(selectRandomEvent(state, { kind: 'rest', minutes: 10000 }, '等候', 'high'), null);
});

test('触发结果在正文时间重算、重试与提交中保持一致且不改变原状态', async () => {
  let state, plan;
  for (let seed = 1; seed < 100; seed++) {
    state = fresh(seed); state.clock.hour = 21; state.clock.minute = 30;
    plan = prepareTurn(state, '在仓库守夜八小时', 'turn:test', { eventFrequency: 'high' });
    if (plan.randomEvent) break;
  }
  assert.ok(plan.randomEvent);
  const before = structuredClone(state), request = buildTurnRequest(plan);
  assert.match(request.system, /引擎触发的随机事件/);
  assert.match(request.system, /等待玩家选择/);
  const raw = '到了次日凌晨3点，仓库外传来动静，你停下观察。\n```json\n{}\n```';
  const adjusted = followNarrativeTime(plan, raw);
  assert.deepEqual(adjusted.randomEvent, plan.randomEvent);
  assert.equal(adjusted.judged.minutes, 330);
  const result = await settleGeneratedReply(plan, raw);
  assert.deepEqual(state, before);
  assert.equal(result.state.randomEvents.length, 1);
  assert.equal(result.state.randomEvents[0].type, plan.randomEvent.type);
  const retry = prepareTurn(state, plan.text, plan.id, { eventFrequency: 'low', randomEventOverride: plan.randomEvent });
  assert.deepEqual(retry.randomEvent, plan.randomEvent);
  const checkpoint = { id: plan.id, input: plan.text, base: state, messages: [], eventFrequency: 'high', randomEvent: plan.randomEvent };
  const payload = store.savePackage(result.state, [{ role: 'user', content: plan.text }, { role: 'assistant', content: raw }], { lastTurn: checkpoint });
  assert.deepEqual(store.decodeSave(payload).lastTurn.randomEvent, plan.randomEvent);
});
