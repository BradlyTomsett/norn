import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { generateWorld } from '../engine/worldgen.js';
import { upgradeState } from '../engine/schema.js';
import { applyTasks, advanceTasks } from '../engine/tasks.js';
import { maintainTasks, taskEvidence, taskReviewInput, taskReviewKey, applyTaskReview } from '../engine/task-review.js';
import { uiState, stateBlock } from '../engine/state.js';
import { VIEWS } from '../views.js';
import { entityRefs, npcLabel, ambiguousPeople } from '../engine/entities.js';
import { recallHistory, memoryContext, selectRelevant, linkKnowledge } from '../engine/memory.js';
import { assertPlayerAgency, playerPermissions } from '../engine/agency.js';
import { prepareTurn } from '../engine/turn.js';
import { settleReply } from '../engine/reply.js';
import { searchArchive } from '../search.js';
import * as store from '../store.js';

class Storage {
  data = new Map(); get length() { return this.data.size; } key(i) { return [...this.data.keys()][i]; }
  getItem(k) { return this.data.get(k) ?? null; } setItem(k, v) { this.data.set(k, String(v)); } removeItem(k) { this.data.delete(k); }
}
beforeEach(() => { globalThis.localStorage = new Storage(); });
const fresh = () => { const { state } = generateWorld({ regionId: 'greywater', seed: 77, playerName: '测试' }); state.saveId = store.newId(); return upgradeState(state); };
const reply = (text, delta = {}) => text + '\n```json\n' + JSON.stringify(delta) + '\n```';

test('旧事项只合并明确重复，保留编号别名；完成后不被改写成新待办', () => {
  const s = fresh(); s.player.unfinished = [{ text: '到公会领取调查报酬' }, { text: '去公会领取调查报酬' }, { text: '去公会了解新的委托' }];
  upgradeState(s); assert.equal(s.player.unfinished.length, 2); assert.ok(s.player.unfinished.every(t => t.needsReview));
  const [task] = s.player.unfinished;
  applyTasks(s, [{ id: task.id, status: 'completed' }], [], 'turn:complete');
  assert.equal(s.player.taskHistory[0].closedBy, 'turn:complete');
  applyTasks(s, [{ id: 'rewritten', text: '去公会领取调查报酬', status: 'active' }]);
  assert.equal(s.player.unfinished.length, 1); assert.equal(s.player.taskHistory.length, 1);
  applyTasks(s, [{ id: task.id, status: 'active' }], [], 'player:task-review'); assert.equal(s.player.unfinished.length, 2); assert.equal(s.player.taskHistory.length, 0);
});
test('有明确条件的事项自动完成，截止日过后归档，旧事项不凭空关闭', () => {
  const s = fresh(); s.player.unfinished = [{ text: '旧承诺要核对' }];
  applyTasks(s, [{ id: 'due', text: '三天后拜访', dueDays: 3 }, { id: 'paid', text: '领取报酬', completionCondition: { type: 'contractPaid', contractId: 'job' } }]);
  s.player.contracts = [{ id: 'job', status: 'paid' }]; advanceTasks(s);
  assert.equal(s.player.taskHistory.find(t => t.id === 'paid').status, 'completed');
  s.clock.doy += 3; advanceTasks(s); assert.ok(s.player.unfinished.some(t => t.id === 'due'));
  s.clock.doy++; advanceTasks(s); assert.equal(s.player.taskHistory.find(t => t.id === 'due').status, 'expired');
  assert.ok(s.player.unfinished.some(t => t.text === '旧承诺要核对'));
});

test('排班和盯窗小步骤收起，不会完成三夜守夜委托或移动账目时间', () => {
  const s = fresh(); s.player.unfinished = [{ id: 'roster', text: '定下三夜守夜的班次，谁头半夜谁后半夜' }, { id: 'clue', text: '守夜时盯账房小窗，查清谁进出' }];
  s.player.contracts = [{ id: 'warehouse', label: '北仓清点', status: 'active', copper: 2400000 }];
  const before = JSON.stringify([s.player.accounts, s.clock, s.turn, s.player.contracts]);
  const history = [{ role: 'assistant', content: '三夜守夜怎么排班，还没定。\n【你现在可以做什么】\n② 当场把三夜的班排出来' },
    { role: 'assistant', content: '三夜的班定下来了：头两夜你带塔姆守头半夜，老杜带凯尔守后半夜，第三夜对调。' }];
  assert.equal(maintainTasks(s, history), true);
  assert.deepEqual(s.player.unfinished, []);
  assert.ok(s.player.taskHistory.every(t => t.status === 'archived')); assert.equal(s.player.taskHistory.length, 2);
  assert.equal(JSON.stringify([s.player.accounts, s.clock, s.turn, s.player.contracts]), before);
  assert.equal(maintainTasks(s, history), false);
});

test('未定、建议、选项、待办和不相关排班均不能冒充已完成证据', () => {
  for (const content of ['三夜的班还没排好。', '三夜的班已经准备排好了。', '建议三夜的班排好了再出发。', '商队的轮班已经排好。', '【未完成事项】\n三夜的班排好了再出发。', '【你现在可以做什么】\n② 把三夜的班排好了再走']) {
    const s = fresh(); s.player.unfinished = [{ id: 'roster', text: '定下三夜守夜的班次' }];
    maintainTasks(s, [{ role: 'assistant', content }]); assert.equal(s.player.unfinished.length, 0, content);
    assert.equal(s.player.taskHistory[0].status, 'archived'); assert.equal(s.player.taskHistory[0].evidence, undefined);
  }
});

test('日常小事和长期规则退出待办，重要承诺继续保留，新日常条目不堆积', () => {
  const s = fresh(); s.player.unfinished = [{ id: 'food', text: '吃饭' }, { id: 'secret', text: '传说级天赋严格保密' }, { id: 'principle', text: '北仓这单不动刀，撞上人就抓住报治安官署' }, { id: 'promise', text: '明晚在北仓碰头，交付调查线索' }];
  maintainTasks(s); assert.deepEqual(s.player.unfinished.map(t => t.id), ['promise']);
  assert.ok(s.player.taskHistory.every(t => t.status === 'archived'));
  applyTasks(s, [{ id: 'meal', text: '吃早饭', kind: 'routine' }, { id: 'note', text: '保密说明', kind: 'note' }, { id: 'small', text: '问好', importance: 'minor' }, { id: 'old-model-meal', text: '吃饭' }]);
  assert.equal(s.player.unfinished.length, 1);
  applyTaskReview(s, { decisions: [{ id: 'promise', status: 'archived', kind: 'routine' }], contracts: [] }, []);
  assert.equal(s.player.unfinished.length, 1);
});

test('历史语义核对必须引用相关原文，不能用猜测、否定片段或用户计划关闭事项', () => {
  const s = fresh(); s.player.unfinished = [{ id: 'investigation', text: '查清西门仓库失窃原因' }];
  const history = [{ role: 'user', content: '西门仓库失窃原因已经查清了' }, { role: 'assistant', content: '西门仓库失窃原因已经调查清楚，证物交给治安官。\n【未完成事项】\n查清东门失窃原因' }];
  const input = taskReviewInput(s, history), source = input.sources.find(row => row.text.includes('证物'));
  assert.ok(source); assert.ok(!taskEvidence(s, history).some(row => row.text.includes('东门')));
  for (const decision of [{ quote: '编造的完成证据' }, { confidence: 'likely' }, { evidenceId: 'missing' }, { id: 'unknown' }]) {
    applyTaskReview(s, { decisions: [{ id: 'investigation', status: 'completed', confidence: 'certain', evidenceId: source.id, quote: source.text, ...decision }], contracts: [] }, input.sources);
    assert.equal(s.player.unfinished.length, 1);
  }
  const negative = { id: 'message:2:0', text: '没有证据表明西门仓库失窃原因已经调查清楚' };
  applyTaskReview(s, { decisions: [{ id: 'investigation', status: 'completed', confidence: 'certain', evidenceId: negative.id, quote: '西门仓库失窃原因已经调查清楚' }], contracts: [] }, [negative]);
  assert.equal(s.player.unfinished.length, 1);
  const before = taskReviewKey(s, history);
  applyTaskReview(s, { decisions: [{ id: 'investigation', status: 'completed', confidence: 'certain', evidenceId: source.id, quote: source.text }], contracts: [] }, input.sources);
  assert.equal(s.player.unfinished.length, 0); assert.notEqual(taskReviewKey(s, history), before);
  applyTasks(s, [{ id: 'investigation', status: 'active' }], [], 'model:turn'); assert.equal(s.player.unfinished.length, 0);
});

test('委托工作完成只改变事项状态，不发酬劳；进行中与待领酬在新位置均可调整金额', () => {
  const s = fresh(); s.player.unfinished = [];
  s.player.contracts = [{ id: 'a', label: '西门仓库调查', copper: 1000, status: 'active' }, { id: 'b', label: '北仓清点', copper: 2000, status: 'active' }, { id: 'old', label: '旧护送', copper: 300, status: 'paid', paidCopper: 300 }];
  const source = { id: 'message:1:0', text: '西门仓库调查已经完成，证物交给治安官' };
  const before = JSON.stringify([s.player.accounts, s.clock, s.turn]);
  applyTaskReview(s, { decisions: [], contracts: [{ id: 'a', workStatus: 'completed', confidence: 'certain', evidenceId: source.id, quote: source.text }], transactions: [{ kind: 'reward', contractId: 'a' }] }, [source]);
  assert.equal(s.player.contracts[0].workStatus, 'completed'); assert.equal(s.player.contracts[0].status, 'active');
  assert.equal(s.player.contracts[1].workStatus, undefined); assert.equal(JSON.stringify([s.player.accounts, s.clock, s.turn]), before);
  const html = VIEWS.tasks(uiState(s)); assert.match(html, /id="unpaid-contracts"/); assert.match(html, /data-contract-save="a"/); assert.match(html, /data-contract-save="b"/); assert.ok(!html.includes('data-contract-save="old"'));
  assert.match(stateBlock(s), /工作已完成，酬劳尚未领取/);
});
test('同名人物按编号与身份关联，长期检索不混淆两个凯尔', () => {
  const s = fresh(); s.npcs = [{ id: 'kyle', name: '凯尔', age: 30, profession: '佣兵' }, { id: 'kell', name: '凯尔', age: 22, profession: '冒险者' }];
  assert.equal(ambiguousPeople(s, '问候凯尔').people.length, 2);
  assert.equal(ambiguousPeople(s, '问候凯尔（30岁·佣兵）'), null);
  assert.deepEqual(entityRefs(s, '凯尔（30岁·佣兵）').npcIds, ['kyle']);
  const old = [{ role: 'assistant', content: '凯尔约定北门交付蓝色信物。', entities: { npcIds: ['kyle'] } }, { role: 'assistant', content: '凯尔约定南门交付红色信物。', entities: { npcIds: ['kell'] } }, { role: 'assistant', content: '凯尔身份不明，约定去东门。' }, ...Array.from({ length: 50 }, () => ({ role: 'assistant', content: '日常生活。' }))];
  const recalled = recallHistory(s, old, '问凯尔（30岁·佣兵）以前的约定');
  assert.match(recalled, /蓝色信物/); assert.ok(!recalled.includes('红色信物'));
  assert.ok(!recalled.includes('东门'));
  const facts = [linkKnowledge(s, { text: '蓝色信物', npcIds: ['kyle'] }, 'turn:1'), linkKnowledge(s, { text: '红色信物', npcIds: ['kell'] }, 'turn:2')];
  assert.deepEqual(selectRelevant(facts, '凯尔（30岁·佣兵）', 10, r => r.text, memoryContext(s, '凯尔（30岁·佣兵）')).map(r => r.text), ['蓝色信物']);
  assert.equal(npcLabel(s, s.npcs[1]), '凯尔（22岁·冒险者）');
});
test('询价、了解委托、未来计划和否定付款都不能被当作批准', () => {
  for (const text of ['问店主面包多少钱', '了解委托的内容', '明天再付钱', '不要付款', '我没有答应接任务']) {
    const plan = prepareTurn(fresh(), text, 'turn:agency');
    assert.throws(() => assertPlayerAgency(plan, reply('你答应接下。'), { transactions: [{ kind: 'payment', copper: 10 }] }));
  }
  assert.equal(playerPermissions('买黑面包').purchase, true);
  const plan = prepareTurn(fresh(), '问候店主', 'turn:quotes');
  assert.throws(() => assertPlayerAgency(plan, reply('你说：“我全包了。”'), {}), /台词/);
  assert.throws(() => assertPlayerAgency(plan, reply('你向她表白。'), {}), /感情/);
  assert.throws(() => assertPlayerAgency(plan, reply('付了钱。'), { money: { cash: -10 } }), /扣款/);
  assert.doesNotThrow(() => assertPlayerAgency(prepareTurn(fresh(), '我说“早安”', 'turn:q'), reply('你说：“早安”'), {}));
});
test('自主权问题只重写一次，失败保留原状态，不能借修复篡改已批准交易', async () => {
  const plan = prepareTurn(fresh(), '问店主面包多少钱', 'turn:rewrite'), before = structuredClone(plan.state); let attempts = 0;
  const result = await settleReply(plan, reply('你答应购买。', { transactions: [{ id: 'bad', kind: 'purchase', name: '面包', copper: 2 }] }), { repairAgency: async () => { attempts++; return reply('店主报了价，等你决定。'); } });
  assert.equal(attempts, 1); assert.match(result.raw, /等你决定/); assert.equal(result.state.player.accounts[0].copper, plan.state.player.accounts[0].copper);
  await assert.rejects(settleReply(plan, reply('你说：“我买了。”'), { repairAgency: async raw => raw }), /台词/);
  assert.deepEqual(plan.state, before);
  const paid = prepareTurn(fresh(), '付款买黑面包', 'turn:buy');
  await assert.rejects(settleReply(paid, reply('你说：“我喜欢你。”', { transactions: [{ id: 'buy', kind: 'purchase', name: '黑面包', copper: 2 }] }), { repairAgency: async () => reply('收下了面包。', { transactions: [{ id: 'buy', kind: 'purchase', name: '黑面包', copper: 3 }] }) }), /改变了原有交易/);
});
test('本地搜索覆盖完整历史、事项历史和同名人物，结果有原文位置', async () => {
  const s = fresh(); s.npcs = [{ id: 'k1', name: '凯尔', age: 30, profession: '佣兵' }, { id: 'k2', name: '凯尔', age: 22, profession: '冒险者' }];
  applyTasks(s, [{ id: 'promise', text: '在北门交付蓝色信物' }, { id: 'promise', status: 'completed' }]);
  const messages = [{ role: 'assistant', content: '北门的蓝色信物约定。' }, ...Array.from({ length: 2000 }, () => ({ role: 'assistant', content: '日常记录。' }))];
  const result = await searchArchive(s, messages, '蓝色信物'); assert.equal(result.total, 2); assert.equal(result.results.find(r => r.kind === 'history').index, 0);
  assert.equal((await searchArchive(s, messages, '凯尔', { kind: 'people' })).total, 2);
  assert.equal((await searchArchive(s, messages, '日常', { limit: 3 })).results.length, 3);
  assert.equal((await searchArchive(s, messages, '日常', { cancelled: () => true })).total, 0);
});
test('诊断只保存数字和允许的状态，不携带原文、密钥或任意错误文本', async () => {
  const s = fresh(); store.putSave(s, []);
  await store.recordDiagnostic(s.saveId, { turn: 1, requests: 2, durationMs: 100.8, outcome: 'failed', category: 'validation', raw: '秘密剧情', key: 'sk-secret', error: 'sk-secret', promptTokens: 120, outputChars: 55, completionTokens: NaN });
  const text = JSON.stringify(store.getDiagnostics(s.saveId)); assert.ok(!/secret|秘密|NaN/.test(text)); assert.match(text, /validation/); assert.match(text, /101/);
});
