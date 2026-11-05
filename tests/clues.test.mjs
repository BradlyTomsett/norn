import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateWorld } from '../engine/worldgen.js';
import { absoluteDay, upgradeState } from '../engine/schema.js';
import { conditionMet } from '../engine/conditions.js';
import { stateBlock, uiState } from '../engine/state.js';
import { prepareTurn } from '../engine/turn.js';
import { settleGeneratedReply } from '../engine/reply.js';
import { VIEWS } from '../views.js';

function fresh() {
  const state = generateWorld({ seed: 17 }).state;
  state.turn = 30;
  state.knowledge = [];
  return upgradeState(state);
}
function live(state, id, prose, delta) {
  const plan = prepareTurn(state, '核对线索', id, { randomEventOverride: null });
  return settleGeneratedReply(plan, prose + '\n```json\n' + JSON.stringify(delta) + '\n```');
}

test('既有存档的重复线索合并，保留编号与知情证据，金额和时间不会误合并', () => {
  const state = fresh();
  state.knowledge = [
    { id: 'first', text: '库门有两把钥匙。', sourceTurn: 20, knownBy: ['a'] },
    { id: 'duplicate', text: '再次确认：库门有2把钥匙！', sourceTurn: 30, knownBy: ['b'],
      knownByEvidence: [{ npcId: 'b', quote: '我告诉他库门有两把钥匙', sourceTurn: 30 }] },
    { text: '会面时间是2:30' }, { text: '会面时间是230' },
    { text: '钱款是1.20银币' }, { text: '钱款是120银币' },
  ];
  upgradeState(state);
  assert.equal(state.knowledge.length, 5);
  assert.deepEqual(state.knowledge[0].knownBy, ['a', 'b']);
  assert.equal(state.knowledge[0].sourceTurn, 20);
  assert.equal(state.knowledge[0].knownByEvidence.length, 1);
  assert.ok(conditionMet(state, { type: 'knowledge', id: 'duplicate' }));
});

test('新回合重复的 knowledge 和 newInfo 只保留一条，复述不延长线索期限', async () => {
  const state = fresh();
  const note = { kind: 'clue', text: '库门有两把钥匙' };
  const { state: first } = await live(state, 'clue:first', '库门有两把钥匙。', { knowledge: [note], newInfo: [note] });
  assert.equal(first.knowledge.length, 1);
  first.turn += 10;
  const { state: repeated } = await live(first, 'clue:repeat', '你重提库门的事。', { knowledge: [note] });
  assert.equal(repeated.knowledge.length, 1);
  assert.equal(repeated.knowledge[0].sourceTurn, first.knowledge[0].sourceTurn);
  assert.equal(repeated.knowledge[0].aliases, undefined);
  assert.equal(uiState(repeated).knowledge.length, 1);
  repeated.turn++;
  assert.equal(uiState(repeated).knowledge.length, 0);
  assert.doesNotMatch(stateBlock(repeated), /库门有两把钥匙/);
});

test('任务关闭、到期和旧世界流水及时退出线索页；活动任务证据与原始事件仍可查', () => {
  const state = fresh();
  const today = absoluteDay(state.clock);
  state.player.contracts = [{ id: 'work', label: '调查库门', status: 'active' },
    { id: 'paid', label: '已交付委托', status: 'paid' }];
  state.knowledge = [
    { kind: 'clue', text: '库门尚待核对', observedDay: today - 5, taskIds: ['work'] },
    { kind: 'clue', text: '送到城外的货箱', observedDay: today, taskIds: ['paid'] },
    { text: '车辙只留到昨天', observedDay: today - 3 },
    { kind: 'agreement', text: '两人平分报酬', observedDay: today },
  ];
  state.storyLog = [{ text: '库门尚待核对', cause: '旧约', day: today },
    { text: '守卫过去曾扣住货物', cause: '街口争执', day: today - 4 }];
  state.worldLog = [{ text: '路上买干粮花了 1 铜。' }, { text: '路上买干粮花了 1 铜。' }];
  const ui = uiState(state);
  const clues = VIEWS.clues(ui);
  assert.equal((clues.match(/库门尚待核对/g) || []).length, 1);
  assert.doesNotMatch(clues, /城外的货箱|车辙|平分报酬|扣住货物|干粮/);
  assert.match(VIEWS.journal(ui), /扣住货物|平分报酬/);
  state.player.contracts.find(row => row.id === 'work').workStatus = 'completed';
  assert.equal(uiState(state).knowledge.length, 0);
});

test('同一线索有新证据才替换，明确查清后立刻退出列表', async () => {
  const state = fresh();
  state.knowledge = [{ key: 'warehouse:keys', text: '库门有两把钥匙', kind: 'clue', sourceTurn: state.turn }];
  const next = { key: 'warehouse:keys', kind: 'clue', text: '库门有三把钥匙' };
  const unproven = await live(state, 'clue:unproven', '守卫没有回答。', { knowledge: [next] });
  assert.deepEqual(uiState(unproven.state).knowledge.map(k => k.text), ['库门有两把钥匙']);
  const updated = await live(unproven.state, 'clue:confirmed', '守卫确认库门有三把钥匙。', {
    knowledge: [{ ...next, sourceQuote: '库门有三把钥匙' }],
  });
  assert.deepEqual(uiState(updated.state).knowledge.map(k => k.text), ['库门有三把钥匙']);
  const resolved = await live(updated.state, 'clue:resolved', '库门有三把钥匙，均已收齐，问题已经查清。', {
    knowledge: [{ ...next, status: 'resolved', sourceQuote: '库门有三把钥匙，均已收齐' }],
  });
  assert.equal(uiState(resolved.state).knowledge.length, 0);
});
