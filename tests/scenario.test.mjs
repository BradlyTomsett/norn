import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DOCK_SCENARIO, parseScenarioDraft, startScenario } from '../engine/scenario.js';
import { prepareTurn } from '../engine/turn.js';
import { buildTurnRequest } from '../engine/context.js';

test('a custom scenario supplies the live starting location, time, player and finances', () => {
  const card = { ...DOCK_SCENARIO, place: '北崖渡口', name: '索尔·朗', time: '17:45' };
  const { state, opening } = startScenario(card, { seed: 7 });
  const { player } = state;
  assert.equal(player.location.siteName, '北崖渡口');
  assert.notEqual(player.location.siteId, 'greywater');
  assert.equal(state.locations[player.location.siteId].name, '北崖渡口');
  assert.deepEqual(state.npcs.map(npc => npc.name), ['莉娜']);
  assert.deepEqual(state.npcs[0].location, player.location);
  assert.equal(player.age, 24);
  assert.equal(player.work.daily, 150);
  assert.equal(player.accounts.find(account => account.id === 'cash').copper, 200);
  assert.deepEqual(player.bag, [{ name: '麻绳', qty: 1 }]);
  assert.deepEqual(player.debts, []);
  assert.match(opening, /北崖渡口.*17时45分/);
  assert.ok(opening.includes(card.event));

  const plan = prepareTurn(state, '问莉娜箱上是什么印记', 'turn:1', { messages: [{ role: 'assistant', content: opening }] });
  const request = buildTurnRequest(plan);
  assert.match(request.system, /北崖渡口/);
  assert.match(request.system, /24岁/);
  assert.match(request.system, /莉娜/);
  assert.equal(plan.base.clock.hour, 17);
  assert.equal(plan.base.clock.minute, 45);
});

test('an AI draft is validated as a card and each game receives independent state', () => {
  const card = parseScenarioDraft(JSON.stringify({ ...DOCK_SCENARIO, flags: { awakeningAsked: true } }));
  const first = startScenario(card, { seed: 7 }).state;
  const second = startScenario(card, { seed: 7 }).state;
  assert.equal(first.player.name, second.player.name);
  assert.equal(first.flags.awakeningAsked, false);
  first.npcs[0].location.siteName = '别处';
  first.player.bag[0].qty = 5;
  assert.equal(second.npcs[0].location.siteName, '潮汐港');
  assert.equal(second.player.bag[0].qty, 1);
  assert.equal(card.items[0].qty, 1);
  assert.throws(() => parseScenarioDraft(JSON.stringify({ ...card, time: '25:00' })), /有效的开局时间/);
  assert.throws(() => parseScenarioDraft(JSON.stringify({ ...card, cash: -1 })), /随身钱数/);
  assert.throws(() => parseScenarioDraft(JSON.stringify({ ...card, name: card.npcs[0].name })), /不同的姓名/);
});
