import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { generateWorld } from '../engine/worldgen.js';
import { upgradeState, absoluteDay, absoluteMinute } from '../engine/schema.js';
import { prepareTurn, finishTurn } from '../engine/turn.js';
import { settleReply } from '../engine/reply.js';
import { applyDelta, uiState, stateBlock } from '../engine/state.js';
import { makeRng } from '../engine/rng.js';
import { judge } from '../engine/resolve.js';
import { decayRelations, trainSkill } from '../engine/progress.js';
import { ensureNpcState, advanceNpcs } from '../engine/npcs.js';
import { advanceClock } from '../engine/clock.js';
import { activeEffects } from '../engine/effects.js';
import { readPriceBounds, priceBounds } from '../price-input.js';
import { VIEWS } from '../views.js';
import { financeTerms } from '../engine/finance.js';
import { moneyMentions } from '../engine/numbers.js';
import { taskReviewInput, applyTaskReview } from '../engine/task-review.js';
import { buildPrompt, worldContext } from '../engine/protocol.js';
import { decodeSave, savePackage } from '../store.js';

function fresh() {
  const { state } = generateWorld({ regionId: 'greywater', familyKey: 'npc_farmer', seed: 991, name: '测试旅人' });
  upgradeState(state); state.saveId = 'sv_review'; state.clock = { year: 222, doy: 10, hour: 12, minute: 0, weather: 'clear' };
  state.player.accounts.forEach(a => a.copper = a.id === 'cash' ? 2000000 : 0);
  state.player.debts = []; state.player.bills = []; state.player.skills = [{ name: '武技', level: 30, xp: 0 }, { name: '药材', level: 10, xp: 0 }];
  state.player.equipment = ['短剑（灰）']; delete state.player.loadout;
  state.npcs[0].name = '老杜'; state.npcs[1].name = '薇拉'; state.player.relations.forEach(r => r.closeness = 10);
  return upgradeState(state);
}
const response = (text, delta) => text + '\n```json\n' + JSON.stringify(delta) + '\n```';
const cash = s => s.player.accounts.find(a => a.id === 'cash').copper;
const apply = (s, d, id = 'review:one') => applyDelta(s, d, makeRng(2), { eventId: id });

test('物价上下限完整往返，单边、固定价保留，非法输入不当作删除', () => {
  for (const value of [{ min: 800, max: 1500 }, { min: 800, max: null }, { min: null, max: 1500 }, 1200]) {
    const { min, max } = priceBounds(value); assert.deepEqual(readPriceBounds(min, max), value);
  }
  assert.equal(readPriceBounds('', ''), null);
  for (const [a, b] of [['错', '10'], ['1500', '800'], ['0', '1'], ['1.2', '3'], ['9007199254740992', '']]) assert.throws(() => readPriceBounds(a, b));
  const s = fresh(); s.prices = { '审阅茶匙': { min: 800, max: 1500 } };
  const html = VIEWS.prices(uiState(s)); assert.match(html, /class="px-min"/); assert.match(html, /class="px-max"/);
  assert.ok(!html.includes('class="px-input"'));
});

test('中文、混合币种金额可以核对，五金不等于五十金', async () => {
  assert.equal(moneyMentions('五金币二银币三铜币')[0].copper, 50203);
  const s = fresh(), to = s.npcs[0].id, p = prepareTurn(s, '给老杜5金币', 'review:money'), before = structuredClone(p.state);
  const wrong = { transactions: [{ id: 'a', kind: 'gift', to, copper: 500000 }] };
  await assert.rejects(settleReply(p, response('你交给老杜五枚金币。', wrong)), /金额/);
  assert.deepEqual(p.state, before);
  let attempts = 0;
  const fixed = await settleReply(p, response('你交给老杜五枚金币。', wrong), { repairFinance: async () => {
    attempts++; return response('你交给老杜五枚金币。', { transactions: [{ ...wrong.transactions[0], copper: 50000 }] });
  } });
  assert.equal(attempts, 1); assert.equal(cash(s) - cash(fixed.state), 50000);
  await assert.rejects(settleReply(p, response('你交给老杜五枚金币。', wrong), { repairFinance: async raw => raw }), /金额/);
});

test('明确交易对象、数量、总价、单价和最高预算均受保护', async () => {
  const s = fresh();
  const to = s.npcs[1].id, gift = prepareTurn(s, '给老杜5金币', 'review:recipient');
  assert.throws(() => finishTurn(gift, { transactions: [{ kind: 'gift', to, copper: 50000 }] }), /对象/);
  const p = prepareTurn(s, '买两瓶药水，单价3铜，最多花6铜', 'review:qty');
  const tx = { kind: 'purchase', name: '药水', qty: 2, copper: 6 };
  assert.doesNotThrow(() => finishTurn(p, { transactions: [tx] }));
  assert.throws(() => finishTurn(p, { transactions: [{ ...tx, qty: 3 }] }), /数量/);
  assert.throws(() => finishTurn(p, { transactions: [{ ...tx, copper: 10 }] }), /金额/);
  await assert.rejects(settleReply(p, response('你付了十枚铜币。', { transactions: [tx] })), /正文金额/);
});

test('前文明确报价及版本化存档中的报价可约束购买，参考价不是限价', () => {
  const s = fresh();
  assert.ok(apply(s, { quotes: [{ id: 'q1', item: '药水', qty: 2, copper: 10, unitCopper: 5 }] }).applied);
  const restored = decodeSave(savePackage(s, [])).state, p = prepareTurn(restored, '按刚才报价买两瓶药水', 'review:quote');
  assert.ok(p.finance.some(t => t.quoted));
  assert.doesNotThrow(() => finishTurn(p, { transactions: [{ kind: 'purchase', name: '药水', qty: 2, copper: 10 }] }));
  assert.throws(() => finishTurn(p, { transactions: [{ kind: 'purchase', name: '药水', qty: 2, copper: 100 }] }), /金额/);
  const history = [{ role: 'assistant', content: '药水两瓶，总价十铜币。' }];
  const quoted = prepareTurn(fresh(), '按刚才报价买两瓶药水', 'review:oldquote', { messages: history });
  assert.equal(quoted.finance.find(t => t.quoted).copper, 10);
  const open = prepareTurn(fresh(), '买一件定制长剑', 'review:reference');
  assert.doesNotThrow(() => finishTurn(open, { transactions: [{ kind: 'purchase', name: '定制长剑', qty: 1, copper: 100000 }] }));
  assert.throws(() => prepareTurn(fresh(), '按刚才报价买一瓶药水', 'review:missing'), /没有找到.*报价/);
});

test('金额修复不能增删交易或改其他剧情和已批准业务', async () => {
  const s = fresh(), p = prepareTurn(s, '给老杜5金，给薇拉2金', 'review:repair');
  const rows = [{ kind: 'gift', to: s.npcs[0].id, copper: 500000 }, { kind: 'gift', to: s.npcs[1].id, copper: 20000 }];
  const good = rows.map((t, i) => ({ ...t, copper: i ? t.copper : 50000 }));
  await assert.rejects(settleReply(p, response('交付了钱。', { transactions: rows }), { repairFinance: async () => response('交付了钱。', { transactions: good.slice(0, 1) }) }), /增删交易/);
  await assert.rejects(settleReply(p, response('交付了钱。', { transactions: rows }), { repairFinance: async () => response('交付了钱。', { transactions: good, location: { siteId: 'x', siteName: '别处' } }) }), /其他剧情/);
  const buy = prepareTurn(s, '给老杜5金，并买一个面包', 'review:other');
  const mixed = { transactions: [rows[0], { kind: 'purchase', name: '面包', qty: 1, copper: 2 }] };
  await assert.rejects(settleReply(buy, response('交付了钱。', mixed), { repairFinance: async () => response('交付了钱。', { transactions: [good[0], { ...mixed.transactions[1], copper: 3 }] }) }), /其他交易/);
});

test('多人物金额与赏金分成逐笔核对，旧写法也不能绕过限制', async () => {
  const s = fresh(); s.npcs[2].name = '瑟拉'; s.player.contracts = [{ id: 'reward', label: '调查', copper: 1200000, status: 'active' }];
  const p = prepareTurn(s, '领取120金赏金，给老杜和薇拉各5金，剩下与瑟拉平分', 'review:split');
  const txs = [{ kind: 'reward', contractId: 'reward' }, ...[50000, 50000, 550000].map((copper, i) => ({ kind: 'gift', to: s.npcs[i].id, copper }))];
  assert.equal(cash(finishTurn(p, { transactions: txs }).state) - cash(s), 550000);
  assert.throws(() => finishTurn(p, { transactions: txs.map((t, i) => i === 3 ? { ...t, copper: 500000 } : t) }), /金额/);
  const many = prepareTurn(s, '给老杜5金和薇拉2金', 'review:many');
  assert.throws(() => finishTurn(many, { transactions: [{ kind: 'gift', to: s.npcs[0].id, copper: 500000 }, { kind: 'gift', to: s.npcs[1].id, copper: 20000 }] }), /金额/);
  const legacy = prepareTurn(s, '给老杜5金币', 'review:legacy');
  assert.throws(() => finishTurn(legacy, { money: { cash: -500000 } }), /金额|对象/);
  const perItem = prepareTurn(s, '买两瓶药水，每瓶3铜', 'review:unit');
  assert.doesNotThrow(() => finishTurn(perItem, { transactions: [{ kind: 'purchase', name: '药水', qty: 2, copper: 6 }] }));
});

test('近距离移动不算长途，抓人制伏用武技，复合睡眠顺序结算', () => {
  const s = fresh(), walk = prepareTurn(s, '走到柜台前', 'review:walk');
  assert.ok(walk.judged.minutes <= 3); assert.equal(cash(walk.state), cash(s));
  assert.equal(judge(s, '去找凯尔', makeRng(1)).kind, 'travel');
  for (const text of ['抓住窃贼', '用短剑制伏窃贼']) { const j = judge(s, text, makeRng(1)); assert.equal(j.kind, 'combat'); assert.equal(j.skill, '武技'); }
  assert.equal(judge(s, '不杀人只制伏窃贼', makeRng(1)).kind, 'combat');
  assert.equal(judge(s, '不要去旅店', makeRng(1)).minutes, 0);
  s.player.body.health = 50;
  const p = prepareTurn(s, '跟老杜说晚安，然后睡觉八小时', 'review:sleep');
  assert.deepEqual(p.judged.segments.map(s => s.kind), ['social', 'rest']);
  assert.ok(p.judged.minutes >= 480 && p.judged.minutes <= 510);
  assert.equal(finishTurn(p, {}).state.player.body.health, 60);
});

test('自称准备过不白加优势，有来源和适用对象的准备才生效', () => {
  const s = fresh(), plain = judge(s, '攻击守卫', makeRng(1)), claimed = judge(s, '提前准备攻击守卫', makeRng(1));
  assert.equal(plain.ability, claimed.ability);
  s.player.preparations = [{ status: 'ready', kinds: ['combat'], evidence: '上一回合侦察记录', target: '守卫' }];
  assert.equal(judge(s, '攻击守卫', makeRng(1)).ability, plain.ability + 5);
});

test('学习按实际技能成长，三天多于四小时，睡眠不训练八小时交涉', () => {
  const s = fresh(); assert.equal(judge(s, '练习炼金术四小时', makeRng(1)).skill, '药材');
  const a = structuredClone(s), b = structuredClone(s);
  trainSkill(a, judge(a, '练剑四小时', makeRng(1))); trainSkill(b, judge(b, '练剑三天', makeRng(1)));
  assert.ok(b.player.skills[0].level + b.player.skills[0].xp > a.player.skills[0].level + a.player.skills[0].xp);
  const p = prepareTurn(s, '跟老杜说晚安，然后睡觉八小时', 'review:train');
  const out = finishTurn(p, {}).state;
  assert.ok(out.player.skills.find(s => s.name === '交涉').xp < 0.15);
});

test('药剂效果参与后续判定、跨存档保留、到期失效且不改天赋', () => {
  const s = fresh(); s.clock.hour = 23; s.player.bag.push({ name: '夜眼', qty: 1 });
  const out = finishTurn(prepareTurn(s, '喝一瓶夜眼药水', 'review:potion'), { use: [{ name: '夜眼', qty: 1 }] }).state;
  const loaded = decodeSave(savePackage(out, [])).state;
  assert.equal(judge(loaded, '观察黑暗房间', makeRng(1)).effects.rules.nightSight, true);
  assert.equal(loaded.player.talent, s.player.talent);
  loaded.clock = advanceClock(loaded.clock, 241, makeRng(1)).clock;
  assert.equal(activeEffects(loaded).length, 0); assert.equal(judge(loaded, '观察黑暗房间', makeRng(1)).effects.rules.nightSight, false);
});

test('中立不生敌意，敌意不随断联加深，交谈不改亲近也刷新联系', () => {
  const s = fresh(), r = s.player.relations[0]; r.lastTouch = absoluteDay(s.clock) - 60;
  for (const [before, after] of [[0, 0], [-20, -20], [0.2, 0]]) { r.closeness = before; decayRelations(s, 1); assert.equal(r.closeness, after); }
  const out = finishTurn(prepareTurn(s, '问候老杜', 'review:contact'), {}).state;
  assert.equal(out.player.relations[0].lastTouch, absoluteDay(out.clock));
});

test('约定酬劳不刷亲近，重复赠礼收益递减且不消除敌意', () => {
  const s = fresh(), id = s.npcs[0].id, before = s.player.relations[0].closeness;
  const paid = finishTurn(prepareTurn(s, '给老杜5金酬劳', 'review:pay'), { transactions: [{ kind: 'gift', to: id, copper: 50000 }] }).state;
  assert.equal(paid.player.relations[0].closeness, before);
  const first = finishTurn(prepareTurn(s, '送给老杜5金币', 'review:g1'), { transactions: [{ kind: 'gift', to: id, copper: 50000 }] }).state;
  const second = finishTurn(prepareTurn(first, '再送给老杜5金币', 'review:g2'), { transactions: [{ kind: 'gift', to: id, copper: 50000 }] }).state;
  assert.ok(second.player.relations[0].closeness - first.player.relations[0].closeness < first.player.relations[0].closeness - before);
  s.npcs[0].traits.push('不收赠礼');
  const declined = finishTurn(prepareTurn(s, '给老杜5金', 'review:declined'), { transactions: [{ kind: 'gift', to: id, copper: 50000 }] }).state;
  assert.equal(cash(declined), cash(s)); assert.equal(declined.player.relations[0].closeness, before);
});

test('日程不会自动完成全部人物目标，具体目标等待真实条件', () => {
  const s = fresh(); ensureNpcState(s); const id = s.npcs[0].id;
  assert.ok(apply(s, { npcUpdates: [{ npcId: id, goals: [{ id: 'goal', text: '取得地图', action: '联系制图师', completion: '地图到手', days: 1,
    steps: [{ text: '询问制图师' }, { text: '领取地图', condition: { type: 'knowledge', text: '地图已备好' } }] }] }] }).applied);
  s.clock.doy++; advanceNpcs(s); const g = s.npcs[0].goals.find(g => g.id === 'goal'); assert.equal(g.stepIndex, 1);
  s.clock = advanceClock(s.clock, 90 * 1440, makeRng(1)).clock; advanceNpcs(s);
  assert.equal(g.phase, 'blocked'); assert.equal(g.status, 'active');
  assert.ok(s.npcs.every(n => n.goals.find(g => g.routine)?.status === 'active'));
  s.knowledge.push({ text: '地图已备好' }); s.clock.doy++; advanceNpcs(s); assert.equal(g.status, 'completed');
});

test('选择后果检查补救和触发条件，秘密发生后仍需实际得知', () => {
  const s = fresh(), secret = '远处的证据被烧毁';
  assert.ok(apply(s, { consequences: [{ id: 'secret', cause: '拒绝提供藏身处', text: secret, days: 0, visible: false,
    discoverWhen: { type: 'knowledge', text: '收到目击者来信' }, effects: {} }, { id: 'remedy', cause: '欠下人情', text: '合作中止', days: 1,
    cancelWhen: { type: 'knowledge', text: '已经补救' }, effects: {} }] }).applied);
  assert.equal(advanceNpcs(s).some(e => e.text.includes(secret)), false);
  assert.ok(!VIEWS.clues(uiState(s)).includes(secret)); assert.ok(!stateBlock(s).includes(secret));
  s.knowledge.push({ text: '已经补救' }, { text: '收到目击者来信' });
  assert.ok(advanceNpcs(s).some(e => e.text.includes(secret))); assert.ok(VIEWS.clues(uiState(s)).includes(secret));
  assert.equal(s.consequences.find(c => c.id === 'remedy').status, 'cancelled');
  assert.equal(advanceNpcs(s).filter(e => e.text.includes(secret)).length, 0);
});

test('批量获得与失去完整结算，第九件与末项失败均有正确结果', () => {
  const s = fresh(), items = Array.from({ length: 30 }, (_, i) => ({ name: `材料${i}`, qty: 2 }));
  assert.ok(apply(s, { items }).applied); assert.equal(s.player.bag.filter(i => i.name.startsWith('材料')).length, 30);
  const before = structuredClone(s); assert.equal(apply(s, { lose: [...items, { name: '不存在', qty: 1 }] }, 'review:fail').applied, false); assert.deepEqual(s, before);
  assert.ok(apply(s, { lose: items }, 'review:lose').applied); assert.equal(s.player.bag.filter(i => i.name.startsWith('材料')).length, 0);
});

test('过期目标有原文依据才关闭，长期原则保留，装备提示压缩不丢库存', () => {
  const s = fresh(); s.player.goals = ['查清西门仓库失窃原因'];
  const history = [{ role: 'assistant', content: '西门仓库失窃原因已经调查清楚，证物交给治安官。' }], input = taskReviewInput(s, history);
  const source = input.sources[0];
  applyTaskReview(s, { decisions: [], contracts: [], goals: [{ id: input.goals[0].id, status: 'completed', confidence: 'certain', evidenceId: source.id, quote: source.text }] }, input.sources);
  assert.equal(s.player.goals.length, 0); assert.equal(s.player.goalHistory.length, 1);
  s.player.taskHistory.push({ id: 'secret-note', text: '天赋严格保密', status: 'archived' });
  s.player.equipment.push(...Array(99).fill('弓箭（灰）'));
  const text = stateBlock(s, '问候老杜'); assert.match(text, /弓箭（灰）×99/); assert.match(text, /天赋严格保密/); assert.equal(s.player.equipment.length, 100);
});

test('提示保留强者能力、当前事实和选择后果，日常无需整本世界设定', async () => {
  const s = fresh(), worldbook = await readFile(new URL('../prompt/worldbook.md', import.meta.url), 'utf8');
  const rules = await readFile(new URL('../prompt/rules.md', import.meta.url), 'utf8');
  const p = prepareTurn(s, '问候老杜', 'review:prompt'), prompt = buildPrompt(p.state, p.judged, p.events, { query: p.text, worldbook, rules });
  assert.ok(worldContext(worldbook, s, p.text).length < worldbook.length);
  assert.ok(!worldbook.includes('| 麦酒、葡萄酒（一杯） | 2 铜 |'));
  assert.match(prompt, /证据公开方式|合作对象/); assert.match(prompt, /不得.*绕过免疫/);
  assert.match(prompt, /不同目的与取舍/);
});
