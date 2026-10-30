import test from 'node:test';
import assert from 'node:assert/strict';
import { generateWorld } from '../engine/worldgen.js';
import { upgradeState } from '../engine/schema.js';
import { EVENT_TYPES, eventScene, selectRandomEvent } from '../engine/random-events.js';
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
  assert.equal(eventScene(state, {}, '森林里观察'), 'wild');
  for (let seed = 1; seed < 150; seed++) {
    state.seed = seed;
    const event = selectRandomEvent(state, { kind: 'travel', travelScope: 'journey', minutes: 2880 }, '赶路', 'high');
    if (event) assert.ok(EVENT_TYPES.find(row => row.id === event.type).scenes.includes('road'));
  }
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
