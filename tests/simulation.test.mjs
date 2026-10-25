import test, { beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { generateWorld } from '../engine/worldgen.js';
import { upgradeState } from '../engine/schema.js';
import { applyDelta, uiState, stateBlock } from '../engine/state.js';
import { makeRng } from '../engine/rng.js';
import { advanceWorld } from '../engine/tick.js';
import { ensureAccounts } from '../engine/money.js';
import { ensureNpcState } from '../engine/npcs.js';
import { prepareTurn, finishTurn } from '../engine/turn.js';
import { judge, classify, isCorrection } from '../engine/resolve.js';
import { rateOf } from '../engine/economy.js';
import { VIEWS, relationColor } from '../views.js';
import { selectRelevant } from '../engine/memory.js';
import { streamChat, setKey, setSessionOnly } from '../llm.js';
import * as store from '../store.js';
import * as sync from '../sync.js';

class Storage {
  data = new Map(); fail = null;
  get length() { return this.data.size; }
  key(index) { return [...this.data.keys()][index] ?? null; }
  getItem(key) { return this.data.get(key) ?? null; }
  setItem(key, value) { if (this.fail?.(key)) throw new Error('模拟空间不足'); this.data.set(key, String(value)); }
  removeItem(key) { this.data.delete(key); }
}
const originalFetch = globalThis.fetch;
beforeEach(() => { globalThis.localStorage = new Storage(); globalThis.sessionStorage = new Storage(); });
afterEach(() => { globalThis.fetch = originalFetch; });
function fresh() {
  const { state } = generateWorld({ regionId: 'greywater', familyKey: 'npc_farmer', seed: 42 });
  state.saveId = store.newId(); upgradeState(state); ensureAccounts(state);
  state.player.accounts.forEach(a => a.copper = a.id === 'cash' ? 1000000 : 0);
  state.player.bills = []; state.player.debts = []; state.clock = { year: 222, doy: 5, hour: 12, minute: 0, weather: 'clear' };
  return state;
}
const cash = state => state.player.accounts.find(a => a.id === 'cash').copper;
const apply = (s, d, id = 'test:one') => applyDelta(s, d, makeRng(1), { eventId: id });

test('旧存档只保留健康与文字心情，关系钳制到−100～100且不删装备', () => {
  const s = fresh(); s.player.body = { health: 93, fatigue: 100, hunger: 100, injuries: ['旧数据'] };
  s.player.mind = { mood: '平静', stress: 99, morale: 12 };
  s.player.relations[0].trust = 900; s.player.relations[0].closeness = -900;
  s.player.equipment = Array.from({ length: 100 }, (_, i) => `装备${i}（金）`);
  const u = uiState(s);
  assert.deepEqual(u.player.body, { health: 93 }); assert.deepEqual(u.player.mind, { mood: '平静' });
  assert.equal(u.player.relations[0].trust, 100); assert.equal(u.player.relations[0].closeness, -100);
  apply(s, { equipment: ['新装备（灰）'] }); assert.equal(s.player.equipment.length, 101);
  assert.ok(s.player.equipment.includes('装备0（金）'));
  assert.ok(!stateBlock(s).includes('疲劳'));
});

test('关系颜色红白绿连续变化，数值、位置和可访问范围完整', () => {
  assert.equal(relationColor(-100), 'rgb(255, 0, 0)');
  assert.equal(relationColor(0), 'rgb(255, 255, 255)');
  assert.equal(relationColor(100), 'rgb(0, 255, 0)');
  assert.equal(relationColor(-50), 'rgb(255, 128, 128)');
  assert.equal(relationColor(50), 'rgb(128, 255, 128)');
  const html = VIEWS.people({ player: { relations: [{ name: '甲', trust: -100, closeness: 100 }] } });
  assert.match(html, /aria-valuemin="-100"/); assert.match(html, /aria-valuenow="100"/);
  assert.match(html, /信任/); assert.match(html, /亲近/);
});

test('120金赏金与队友分成原子提交，重试只增加55金', () => {
  const s = fresh(); const ids = s.npcs.slice(0, 3).map(n => n.id), start = cash(s);
  assert.ok(apply(s, { bounty: { id: 'nightcart', label: '夜车调查', copper: 1200000 } }, 'accept:quest').applied);
  const data = { transactions: [
    { id: 'quest:reward', kind: 'reward', contractId: 'nightcart' },
    ...[50000, 50000, 550000].map((copper, i) => ({ id: `quest:share:${i}`, kind: 'gift', to: ids[i], copper })),
  ] };
  const receipt = apply(s, data, 'turn:reward'); assert.ok(receipt.applied);
  assert.equal(cash(s) - start, 550000); assert.equal(receipt.receipt.accounts.find(a => a.id === 'cash').change, 550000);
  assert.ok(apply(s, data, 'turn:reward').duplicate); assert.equal(cash(s) - start, 550000);
  const repeat = { transactions: data.transactions.map(t => ({ ...t, id: 'another:' + t.id })) };
  assert.equal(apply(s, repeat, 'turn:another').applied, false); assert.equal(cash(s) - start, 550000);
});

test('支付失败不发物品、不扣部分钱、不推进回合', () => {
  const s = fresh(); s.player.accounts[0].copper = 100; const before = structuredClone(s);
  const result = apply(s, { transactions: [{ id: 'buy:expensive', kind: 'purchase', name: '贵重物', qty: 1, copper: 500 }] });
  assert.equal(result.applied, false); assert.deepEqual(s, before);
  const mixed = apply(s, { money: { change: [{ copper: -500 }] }, items: [{ name: '贵重物', qty: 1 }] });
  assert.equal(mixed.applied, false); assert.equal(cash(s), 100); assert.equal(s.player.bag.length, 0);
});

test('重复记账入口与重复物品移动会拒绝，不接受未知字段或原型字段', () => {
  const s = fresh();
  assert.equal(apply(s, { trade: { buy: [{ name: '面包' }] }, money: { change: [{ copper: -1 }] } }).applied, false);
  assert.equal(apply(s, { transactions: [{ id: 'buy:a', kind: 'purchase', name: '面包', copper: 1 }], items: [{ name: '面包' }] }).applied, false);
  assert.equal(apply(s, { madeUpMoney: 10 }).applied, false);
  assert.equal(apply(s, JSON.parse('{"__proto__":{"polluted":true}}')).applied, false);
  assert.equal({}.polluted, undefined);
});

test('新人物、地点、关系、事项完成与目标清空都进入存档', () => {
  const s = fresh(); s.player.unfinished = [{ id: 'old-task', text: '旧任务' }];
  const result = apply(s, { location: { siteId: 'galon', siteName: '加隆城' },
    npcs: [{ id: 'npc_new', name: '新药师', profession: '药师' }], relations: [{ npcId: 'npc_new', trust: 4, closeness: 3 }],
    goals: [], problems: [], tasks: [{ id: 'old-task', status: 'completed' }] });
  assert.ok(result.applied); assert.equal(s.player.location.siteName, '加隆城');
  assert.equal(s.player.relations.find(r => r.npcId === 'npc_new').trust, 4);
  assert.deepEqual(s.player.goals, []); assert.deepEqual(s.player.problems, []); assert.deepEqual(s.player.unfinished, []);
});

test('多份委托并存，领取一份不丢另一份', () => {
  const s = fresh();
  apply(s, { bounty: { id: 'q1', label: '第一份', copper: 10000 } }, 'accept:1');
  apply(s, { bounty: { id: 'q2', label: '第二份', copper: 20000 } }, 'accept:2');
  assert.equal(s.player.contracts.filter(c => c.status === 'active').length, 2);
  const overview = VIEWS.overview(uiState(s));
  assert.match(overview, /第一份/); assert.match(overview, /第二份/);
  apply(s, { transactions: [{ id: 'q1:reward', kind: 'reward', contractId: 'q1' }] }, 'pay:1');
  assert.equal(s.player.contract.id, 'q2'); assert.equal(s.player.contracts.find(c => c.id === 'q1').status, 'paid');
});

test('否定、复合动作、纠错、睡眠与目标强度参与判定', () => {
  assert.equal(classify('坐下拔剑攻击敌人'), 'combat');
  assert.equal(classify('我不杀他，只问一句'), 'social');
  assert.equal(classify('不买东西，只看看'), 'observe');
  assert.equal(classify('吃面包'), 'rest');
  assert.ok(isCorrection('我的钱数没有增加，你给我按照我的任务收入结算'));
  const s = fresh();
  assert.equal(judge(s, '睡一夜', makeRng(1)).minutes, 480);
  assert.equal(judge(s, '练剑三天', makeRng(1)).minutes, 4320);
  assert.equal(judge(s, '/状态', makeRng(1)).minutes, 0);
  assert.ok(judge(s, '刺深渊领主', makeRng(1)).difficulty > judge(s, '刺一只鸡', makeRng(1)).difficulty);
});

test('相同31天区间整段、逐日的固定日周月收支一致', () => {
  const a = fresh(); a.clock.doy = 30;
  a.player.bills = [{ id: 'month', label: '月钱', every: 'month', amount: 1000, to: 'home' },
    { id: 'week', label: '周钱', every: 'week', amount: 10, to: 'home' }, { id: 'day', label: '日钱', every: 'day', amount: 1, to: 'home' }];
  const b = structuredClone(a);
  advanceWorld(a, 31 * 1440, makeRng(1), { kind: 'rest' });
  for (let i = 0; i < 31; i++) advanceWorld(b, 1440, makeRng(i + 1), { kind: 'rest' });
  assert.equal(a.player.accounts[1].copper, b.player.accounts[1].copper);
  assert.ok(a.player.accounts[1].copper >= 2031);
  assert.equal(cash(a), cash(b));
});

test('NPC目标跨回合和存档持续推进，玩家选择在指定日期产生一次后果', () => {
  let s = fresh(); ensureNpcState(s);
  const npc = s.npcs[0], before = s.player.relations[0].trust;
  const data = { npcUpdates: [{ npcId: npc.id, goals: [{ id: 'coal', text: '筹齐煤款', action: '联系煤商', completion: '煤炭已经送达', days: 2 }] }],
    consequences: [{ id: 'help-coal', cause: '玩家答应帮忙并支付了煤款', text: '药师介绍了自己的朋友', days: 3,
      effects: { relations: [{ npcId: npc.id, trust: 5, observable: '主动介绍了朋友' }] } }] };
  assert.ok(apply(s, data).applied);
  s = JSON.parse(JSON.stringify(s));
  advanceWorld(s, 2 * 1440, makeRng(1), { kind: 'rest' });
  assert.equal(s.npcs[0].goals.find(g => g.id === 'coal').progress, 25);
  assert.equal(s.consequences[0].status, 'pending');
  advanceWorld(s, 1440, makeRng(1), { kind: 'rest' });
  assert.equal(s.consequences[0].status, 'resolved'); assert.equal(s.player.relations[0].trust, before + 5);
  advanceWorld(s, 1440, makeRng(1), { kind: 'rest' });
  assert.equal(s.player.relations[0].trust, before + 5);
  assert.equal(s.storyLog.filter(e => e.id === 'help-coal').length, 1);
  assert.match(VIEWS.clues(uiState(s)), /玩家答应帮忙/);
  apply(s, { npcUpdates: [{ npcId: npc.id, goals: [{ id: 'coal', status: 'completed' }] }] }, 'goal:completed');
  assert.equal(s.npcs[0].goals.find(g => g.id === 'coal').progress, 100);
});

test('相关记忆和价格可从完整历史检索，不受插入位置限制', () => {
  const s = fresh(); s.knowledge = [{ text: '瑟拉承诺三日后带来地图', source: '亲历' }, ...Array.from({ length: 80 }, (_, i) => ({ text: `日常${i}`, source: '亲历' }))];
  s.prices = Object.fromEntries(Array.from({ length: 50 }, (_, i) => [`商品${i}`, i + 1]));
  s.prices['银匕首'] = 1200; s.rates = { '向导报酬': { min: 100, max: 300 } };
  assert.match(stateBlock(s, '询问瑟拉地图并买银匕首'), /瑟拉承诺/);
  assert.match(stateBlock(s, '买银匕首'), /银匕首 1200/);
  assert.match(stateBlock(s, '向导'), /向导报酬/); assert.equal(rateOf(s, '向导报酬'), 200);
  assert.equal(s.knowledge.length, 81);
  assert.equal(selectRelevant(['旧事', '瑟拉的地图', ...Array(20).fill('别的事')], '瑟拉地图', 2).length, 2);
});

test('完整回合从副本结算、失败后重试，旧状态与原结算不被重复影响', () => {
  const s = fresh(), original = structuredClone(s);
  const plan = prepareTurn(s, '买两个黑面包', 'turn:buy');
  assert.deepEqual(s, original);
  assert.throws(() => finishTurn(plan, { transactions: [{ kind: 'purchase', name: '黑面包', copper: 90000000 }] }));
  const delta = { transactions: [{ kind: 'purchase', name: '黑面包', qty: 2, copper: 2 }] };
  const one = finishTurn(plan, delta), two = finishTurn(plan, delta);
  assert.deepEqual(one, two); assert.equal(cash(one.state), cash(s) - 2);
  assert.equal(one.state.turn, s.turn + 1); assert.deepEqual(s, original);
});

test('本地保存原子完成，容量失败后原存档、对话、修订均保持原样', () => {
  const s = fresh(); store.putSave(s, [{ role: 'assistant', content: '旧回合' }]);
  const raw = localStorage.getItem('norn.save.' + s.saveId), revision = s.revision;
  s.player.accounts[0].copper += 999;
  localStorage.fail = key => key.startsWith('norn.save.');
  assert.throws(() => store.putSave(s, [{ role: 'assistant', content: '新回合' }]));
  assert.equal(localStorage.getItem('norn.save.' + s.saveId), raw); assert.equal(s.revision, revision);
});

test('旧存档迁移、完整历史导出导入、索引失败恢复和跨页面冲突保护', async () => {
  const s = fresh(); s.player.body.hunger = 100;
  localStorage.setItem('norn.save.' + s.saveId, JSON.stringify(s));
  const messages = Array.from({ length: 90 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: `记录${i}` }));
  localStorage.setItem('norn.msgs.' + s.saveId, JSON.stringify(messages));
  const loaded = store.getSave(s.saveId); assert.deepEqual(loaded.player.body, { health: 96 });
  localStorage.fail = key => key === 'norn.index'; store.putSave(loaded, messages);
  assert.equal(store.listSaves().length, 1); assert.equal(store.getMessages(s.saveId).length, 90);
  localStorage.fail = null;
  const pkg = store.savePackage(loaded);
  const id = await store.importSave({ text: async () => JSON.stringify(pkg) });
  assert.equal(store.getMessages(id).length, 90); assert.equal(store.getSave(id).lineageId, s.saveId);
  const stale = store.getSave(id), latest = store.getSave(id);
  store.putSave(latest); assert.throws(() => store.putSave(stale), /另一个页面/);
});

test('凭据可以仅存本次会话，不写入存档包', () => {
  setSessionOnly(true); setKey('fake-session-key');
  sync.setGhConfig({ owner: 'test', repo: 'test', token: 'fake-session-token' });
  assert.equal(localStorage.getItem('norn.key'), null); assert.equal(localStorage.getItem('norn.gh'), null);
  assert.equal(sessionStorage.getItem('norn.key'), 'fake-session-key');
  assert.ok(!JSON.stringify(store.savePackage(fresh(), [])).includes('fake-session'));
});

test('SSE支持分块CRLF，断线和长度截断不视为成功', async () => {
  setKey('fake-key');
  const collect = async body => {
    globalThis.fetch = async () => new Response(body, { status: 200 });
    let text = ''; for await (const chunk of streamChat({ system: 'test', messages: [] })) text += chunk; return text;
  };
  assert.equal(await collect('data: {"choices":[{"delta":{"content":"完成"}}]}\r\n\r\ndata: [DONE]\r\n\r\n'), '完成');
  await assert.rejects(collect('data: {"choices":[{"delta":{"content":"半截"}}]}\n\n'), /断开/);
  await assert.rejects(collect('data: {"choices":[{"delta":{},"finish_reason":"length"}]}\n\ndata: [DONE]\n\n'), /长度/);
  const encoder = new TextEncoder();
  globalThis.fetch = async () => new Response(new ReadableStream({ start(c) { for (const t of ['data: {"choices":[{"delta":{"content":"分块"}}]}\r', '\n\r', '\ndata: [DONE]\r\n']) c.enqueue(encoder.encode(t)); c.close(); } }));
  let text = ''; for await (const chunk of streamChat({ system: 'test', messages: [] })) text += chunk;
  assert.equal(text, '分块');
});

test('旧设备不能覆盖较新云存档，自动备份按同一存档串行并核对基线', async () => {
  sync.setGhConfig({ owner: 'test', repo: 'saves', branch: 'main', token: 'fake-token' });
  const s = fresh(); let remote = { turn: 20 }, sha = 'remote20', writes = 0;
  globalThis.fetch = async (_url, opts = {}) => {
    if (opts.method === 'PUT') { writes++; const body = JSON.parse(opts.body); remote = JSON.parse(Buffer.from(body.content, 'base64').toString()); sha = `sha${writes}`; return Response.json({ content: { sha } }); }
    return remote ? Response.json({ content: Buffer.from(JSON.stringify(remote)).toString('base64'), sha }) : new Response('', { status: 404 });
  };
  s.turn = 10; await assert.rejects(sync.backupSave(s, []), /另一份进度/); assert.equal(writes, 0);
  remote = null;
  const a = sync.backupSave(s, []); s.turn = 11; const b = sync.backupSave(s, []);
  await Promise.all([a, b]); assert.equal(writes, 2); assert.equal(remote.state.turn, 11);
  sha = 'changed-by-another-device'; s.turn = 12;
  await assert.rejects(sync.backupSave(s, []), /另一份进度/); assert.equal(writes, 2);
});

test('动态名称不会突破HTML属性', () => {
  const html = VIEWS.prices({ prices: { 'x" onfocus="attack()': 10 }, rates: {} });
  assert.ok(!html.includes('data-name="x" onfocus=')); assert.match(html, /&quot; onfocus=/);
});

test('首次升级可以安全衔接同一旧存档，另一份进度仍受到保护', async () => {
  sync.setGhConfig({ owner: 'test', repo: 'legacy', branch: 'main', token: 'fake-token' });
  const s = fresh(); store.putSave(s, [{ role: 'assistant', content: '旧叙事' }]);
  const remote = structuredClone(s); remote.player.body.hunger = 90; remote.player.mind.stress = 80;
  let writes = 0;
  globalThis.fetch = async (_url, opts = {}) => opts.method === 'PUT' ? (writes++, Response.json({ content: { sha: 'm2-sha' } }))
    : Response.json({ sha: 'm1-sha', content: Buffer.from(JSON.stringify(remote)).toString('base64') });
  await sync.backupSave(s, store.getMessages(s.saveId)); assert.equal(writes, 1);
});

test('借还款使用统一交易，余额不足或债权人不符时不部分还款', () => {
  const s = fresh(), start = cash(s);
  assert.ok(apply(s, { transactions: [{ id: 'loan', kind: 'borrow', from: '金匠铺', copper: 10000, months: 12 }] }, 'loan:turn').applied);
  const debtId = s.player.debts[0].id;
  assert.equal(cash(s), start + 10000);
  assert.equal(apply(s, { transactions: [{ id: 'wrong', kind: 'repay', to: '另一个债主', copper: 1000 }] }, 'repay:wrong').applied, false);
  s.player.accounts[0].copper = 100;
  assert.equal(apply(s, { transactions: [{ id: 'poor', kind: 'repay', debtId, copper: 1000 }] }, 'repay:poor').applied, false);
  assert.equal(cash(s), 100); assert.equal(s.player.debts[0].remaining, 10000);
});
