import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { generateWorld } from '../engine/worldgen.js';
import { prepareTurn, finishTurn } from '../engine/turn.js';
import { extractChoices, resolveAction } from '../engine/actions.js';
import { judge, classify } from '../engine/resolve.js';
import { makeRng } from '../engine/rng.js';
import { settleReply } from '../engine/reply.js';
import { narrationText, messageParts, stripSettlement } from '../messages.js';
import { buildPrompt } from '../engine/protocol.js';
import * as store from '../store.js';

class Storage {
  data = new Map();
  get length() { return this.data.size; }
  key(index) { return [...this.data.keys()][index]; }
  getItem(key) { return this.data.get(key) ?? null; }
  setItem(key, value) { this.data.set(key, String(value)); }
  removeItem(key) { this.data.delete(key); }
}
beforeEach(() => { globalThis.localStorage = new Storage(); });
const fresh = () => {
  const { state } = generateWorld({ regionId: 'greywater', familyKey: 'npc_farmer', seed: 20261026, name: '测试旅人' });
  state.saveId = store.newId();
  return state;
};
const response = delta => '【本次行动】\n你按约定办妥了这件事。\n```json\n' + JSON.stringify(delta) + '\n```';
const choices = [{ role: 'assistant', content: '【你现在可以做什么】\n① 散了，各自歇下，明早再说\n② 问老杜三天前发生了什么\n③ 当场把三夜的班排出来\n【实际结算】\n本回合没有账户或物品变化。' }];

test('未经过界面修补的新局可从首回合跨日、跨月、跨年，并保留原钱包', () => {
  for (const text of ['休息一天', '休息一个月', '休息一年']) {
    const source = fresh(), original = structuredClone(source), copper = source.player.wallet.copper;
    store.putSave(source, []);
    const loaded = store.getSave(source.saveId);
    assert.equal(loaded.player.accounts.find(a => a.id === 'cash').copper, copper);
    const plan = prepareTurn(loaded, text, 'turn:first');
    const result = finishTurn(plan, {});
    assert.equal(result.state.turn, 1);
    assert.ok(result.state.clock.doy !== source.clock.doy || result.state.clock.year !== source.clock.year);
    assert.equal(original.player.accounts, undefined);
    assert.equal(store.getSave(source.saveId).turn, 0);
  }
});

test('旧存档的编号、多选和完整行动产生相同判定；重试不重新解释选项', () => {
  const source = fresh(); source.clock.hour = 23; source.clock.minute = 35;
  const selected = prepareTurn(source, '1', 'turn:choice', { messages: choices });
  const direct = prepareTurn(source, '散了，各自歇下，明早再说', 'turn:choice');
  assert.deepEqual(selected.judged, direct.judged);
  assert.equal(selected.judged.kind, 'rest'); assert.equal(selected.state.clock.hour, 7); assert.equal(selected.state.clock.minute, 0);
  assert.equal(selected.text, '散了，各自歇下，明早再说');
  assert.equal(resolveAction('2 3', choices).text, '问老杜三天前发生了什么；当场把三夜的班排出来');
  assert.equal(resolveAction('选择1、3', choices).selected.length, 2);
  assert.throws(() => prepareTurn(source, '9', 'bad', { messages: choices }), /编号不存在/);
  assert.throws(() => prepareTurn(source, '1', 'bad'), /没有编号选项/);
  assert.deepEqual(finishTurn(selected, {}), finishTurn(selected, {}));
});

test('编号不从过时回复借用，兼容圆圈、阿拉伯数字和粗体选项', () => {
  const text = '【行动方向】\n**1. 问候店主**\n2、买面包\n(3) 回家\n【新信息】\n1. 这不是选项';
  assert.deepEqual(extractChoices(text).map(row => row.number), [1, 2, 3]);
  assert.throws(() => resolveAction('1', [...choices, { role: 'assistant', content: '他摇摇头，等你回答。' }]), /没有编号选项/);
  assert.equal(resolveAction('买1个面包', choices).text, '买1个面包');
});

test('询问过去或未来日期不跳时间，当前睡眠不执行明天的战斗', () => {
  const source = fresh();
  for (const text of ['问他三天前发生了什么', '问他三天后在哪里碰头', '问他“昨晚谁杀了守卫”']) {
    const result = judge(source, text, makeRng(1));
    assert.equal(result.kind, 'social'); assert.ok(result.minutes < 60); assert.equal(result.outcome, 'success');
  }
  const sleep = judge(source, '我先睡觉，明天再去杀怪', makeRng(1));
  assert.equal(sleep.kind, 'rest'); assert.equal(sleep.minutes, 480);
  assert.deepEqual(sleep.futurePlans, ['明天再去杀怪']);
  assert.equal(classify('明天去北仓'), 'meta');
  assert.equal(judge(source, '明天去北仓', makeRng(1)).minutes, 0);
  assert.equal(classify('坐下拔剑攻击敌人'), 'combat');
  assert.equal(judge(source, '练剑三天', makeRng(1)).minutes, 4320);
  assert.equal(judge(source, '睡半个小时', makeRng(1)).minutes, 30);
  assert.equal(judge(source, '休息一个半小时', makeRng(1)).minutes, 90);
  assert.ok(judge(source, '查看最近三天的账本', makeRng(1)).minutes < 60);
  assert.ok(judge(source, '看看四周', makeRng(1)).minutes < 60);
  assert.equal(judge(source, '连续观察四周', makeRng(1)).minutes, 40320);
  assert.equal(classify('等三天后再走'), 'rest');
  assert.equal(judge(source, '刺一只鸡，明天攻击深渊领主', makeRng(1)).difficulty, 10);
});

test('已有同一身份的人物可安全更新，不新增人物和关系，也不覆盖异名身份', async () => {
  const plan = prepareTurn(fresh(), '问候母亲', 'turn:npc'), old = plan.state.npcs[0];
  const original = structuredClone(plan.base);
  const result = await settleReply(plan, response({ npcs: [{ id: old.id, name: old.name, age: old.age, profession: '药师' }] }));
  assert.equal(result.state.npcs.length, plan.state.npcs.length);
  assert.equal(result.state.player.relations.length, plan.state.player.relations.length);
  assert.equal(result.state.npcs[0].profession, '药师');
  await assert.rejects(settleReply(plan, response({ npcs: [{ id: old.id, name: '另一个人' }] })), /身份不一致/);
  assert.deepEqual(plan.base, original);
});

test('有效JSON但无法结算时只修复一次，失败不提交，不偷偷更改钱款', async () => {
  const plan = prepareTurn(fresh(), '问候母亲', 'turn:repair'), original = structuredClone(plan.state);
  let attempts = 0;
  const result = await settleReply(plan, response({ time: { minutes: 90 } }), { repair: async (_raw, _plan, error) => {
    attempts++; assert.match(error, /引擎时间/); return {};
  } });
  assert.equal(attempts, 1); assert.equal(result.repaired, true); assert.equal(result.state.turn, 1);
  attempts = 0;
  await assert.rejects(settleReply(plan, response({ time: { minutes: 90 } }), { repair: async () => { attempts++; return { time: { minutes: 10 } }; } }));
  assert.equal(attempts, 1); assert.deepEqual(plan.state, original);
  const payment = { transactions: [{ id: 'bad', kind: 'payment', copper: 999999, note: '约定付款' }] };
  await assert.rejects(settleReply(prepareTurn(fresh(), '按约定付款', 'turn:pay'), response(payment), { repair: async () => ({}) }), /改变了原有交易/);
  await assert.rejects(settleReply(prepareTurn(fresh(), '答应接下委托', 'turn:accept'), response({ bounty: { id: 'q1', label: '约定', copper: -1 } }), {
    repair: async () => ({ bounty: { id: 'q2', label: '约定', copper: -1 } }),
  }), /改变了原有交易/);
  assert.deepEqual(plan.state, original);
});

test('修复可以纠正数量类型，但不能改数量或收款人', async () => {
  const source = fresh(); source.player.wallet = { copper: 100 };
  const plan = prepareTurn(source, '买两个黑面包', 'turn:qty');
  const tx = { id: 'bread', kind: 'purchase', name: '黑面包', qty: '2', copper: 2 };
  const result = await settleReply(plan, response({ transactions: [tx] }), { repair: async () => ({ transactions: [{ ...tx, qty: 2 }] }) });
  assert.equal(result.state.player.accounts[0].copper, 98);
  await assert.rejects(settleReply(plan, response({ transactions: [tx] }), { repair: async () => ({ transactions: [{ ...tx, qty: 3 }] }) }), /改变了原有交易/);
});

test('没有变化块时可请求一次修复，真实回执与导出包保存在一起', async () => {
  const source = fresh(); store.putSave(source, []);
  const plan = prepareTurn(source, '休息一天', 'turn:save');
  let attempts = 0;
  const result = await settleReply(plan, '你在家歇了一天。', { repair: async () => { attempts++; return {}; } });
  assert.equal(attempts, 1);
  store.putSave(result.state, [{ role: 'assistant', content: '你在家歇了一天。', receipt: result.receipt }]);
  const decoded = store.decodeSave(JSON.parse(JSON.stringify(store.savePackage(result.state))));
  assert.deepEqual(decoded.messages[0].receipt, result.receipt);
  assert.match(messageParts(decoded.messages[0]).receipt, /随身/);
});

test('模型结算在流式与最终正文均被移除，旧回执只显示最后一份', () => {
  const raw = '【本次行动】\n你睡到清晨。\n【财务变化】\n钱没有减少。\n【未完成事项】\n今晚碰头。\n【实际结算】\n本回合没有账户变化。';
  assert.ok(!stripSettlement(raw).includes('钱没有减少'));
  assert.match(narrationText(raw), /今晚碰头/);
  const msg = { role: 'assistant', content: raw, receipt: { accounts: [{ name: '随身', change: -60, after: 100 }], items: [] } };
  const parts = messageParts(msg);
  assert.ok(!parts.text.includes('结算')); assert.match(parts.receipt, /−60 铜/);
  const legacy = messageParts({ role: 'assistant', content: raw + '\n【实际结算】\n随身 −60 铜；余额 1 银' });
  assert.equal(legacy.receipt, '随身 −60 铜；余额 1 银');
  assert.ok(!legacy.text.includes('钱没有减少'));
  assert.equal(messageParts({ role: 'user', content: '【实际结算】请核对' }).text, '【实际结算】请核对');
});

test('每轮携带现有人物编号及当前行动边界，结算段明确归程序生成', () => {
  const plan = prepareTurn(fresh(), '我先睡觉，明天再去杀怪', 'turn:prompt');
  const prompt = buildPrompt(plan.state, plan.judged, plan.events);
  assert.match(prompt, /这回合不得执行：明天再去杀怪/);
  assert.match(prompt, /不要输出【实际结算】/);
  for (const npc of plan.state.npcs) assert.ok(prompt.includes(`[${npc.id}] ${npc.name}`));
});
