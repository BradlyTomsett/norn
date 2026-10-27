import test from 'node:test';
import assert from 'node:assert/strict';
import { generateWorld } from '../engine/worldgen.js';
import { upgradeState } from '../engine/schema.js';
import { prepareTurn, finishTurn } from '../engine/turn.js';
import { settleReply } from '../engine/reply.js';
import { buildTurnRequest, recentHistory, repairMessages } from '../engine/context.js';
import { rememberCorrections, correctionText, assertContinuity, validateContextReview, ContinuityError } from '../engine/continuity.js';
import { recallHistory, linkKnowledge, selectRelevant, memoryContext } from '../engine/memory.js';
import { conditionMet } from '../engine/conditions.js';
import { factEntityRefs } from '../engine/entities.js';
import { historicalIdentityHints, recentSceneEvidence, missingSceneLocation } from '../engine/scene.js';
import { isCorrection } from '../engine/resolve.js';
import { uiState, stateBlock, applyDelta } from '../engine/state.js';
import { makeRng } from '../engine/rng.js';
import { relevantNpcs } from '../engine/npcs.js';
import { decodeSave, savePackage } from '../store.js';
import { VIEWS } from '../views.js';

const fresh = () => {
  const { state } = generateWorld({ regionId: 'greywater', seed: 77, playerName: '测试旅人' });
  state.saveId = 'sv_context'; state.clock.hour = 12;
  state.npcs = [{ id: 'sera', name: '瑟拉', age: 20, profession: '冒险者（B级）', attitude: '一直与玩家一起行动的搭档', traits: [] },
    { id: 'du', name: '老杜', age: 35, profession: '冒险者（B级）', traits: [] }];
  state.player.relations = []; state.player.goals = []; state.player.unfinished = [];
  return upgradeState(state);
};
const reply = (text, delta = {}) => `${text}\n\`\`\`json\n${JSON.stringify(delta)}\n\`\`\``;
const correction = '/纠错 瑟拉一直和我一起接任务，是我的搭档。给其他人结清工钱后，我和瑟拉平分剩余赏金。';

test('近期历史按字符预算保留完整轮次，足够时不再只传14条，也不带未选选项', () => {
  const history = Array.from({ length: 40 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: `记录${i}。` }));
  const selected = recentHistory(history); assert.equal(selected.messages.length, 40); assert.equal(selected.start, 0);
  const long = [{ role: 'user', content: '要完整解释' }, { role: 'assistant', content: '正文'.repeat(1000) + '结尾约定不能丢' }];
  assert.match(recentHistory(long, 100).messages[1].content, /结尾约定不能丢/);
  const trimmed = recentHistory([...history, ...long], 2100); assert.equal(trimmed.messages[0].role, 'user');
  assert.equal(trimmed.messages.at(-1).role, 'assistant'); assert.match(trimmed.messages.at(-1).content, /结尾约定不能丢/);
});

test('跨回合保留取消的行动，隔离旧错误及其知识，主动重新提出时可解除', () => {
  const s = fresh(); s.turn = 3; s.player.location = { siteId: 'street', siteName: '北关仓街外' };
  s.player.contracts = [{ id: 'job', label: '北仓清点', status: 'active', copper: 2400000 }];
  s.knowledge = [{ id: 'old-key', text: '韦头儿说门锁有两把钥匙', sourceTurn: 3, source: '韦头儿当面说' },
    { id: 'old-other', text: '粮商公会委托调查北仓失窃', sourceTurn: 1, source: '公会' }];
  const history = [{ role: 'assistant', sourceTurn: 1, content: '北仓清点由粮商公会委托，报公会名号即可接洽。' },
    { role: 'user', content: '报公会名号进去查看仓里的锁（本回合纠正：/纠错 不要看锁！不要出现看锁2个字！）' },
    { role: 'assistant', sourceTurn: 3, content: '你检查仓里的锁具。\n\n仓里比外头暗。韦头儿点头请你进来。\n\n他说门锁有两把钥匙。他顿了顿，先生要看，让老周领着。' }];
  const before = JSON.stringify([history, s.knowledge]);
  const p = prepareTurn(s, '问韦头儿今晚怎么守夜', 'correction:follow', { messages: history });
  const request = buildTurnRequest(p);
  assert.match(request.system, /玩家已取消的行动/); assert.match(request.system, /近期原文已描述进入仓里/);
  assert.match(request.system, /地点记录可能过时/); assert.doesNotMatch(request.system, /韦头儿说门锁有两把钥匙/);
  assert.match(request.system, /粮商公会委托调查北仓失窃/);
  assert.doesNotMatch(request.messages.at(-2).content, /检查仓里的锁具|先生要看/); assert.match(request.messages.at(-2).content, /仓里比外头暗/);
  assert.throws(() => assertContinuity(p, reply('你查看门栓和锁具。')), ContinuityError);
  assert.throws(() => assertContinuity(p, reply('韦头儿说不要看锁。')), ContinuityError);
  assert.doesNotThrow(() => assertContinuity(p, reply('韦头儿摊开今晚的值守安排。')));
  assert.equal(JSON.stringify([history, s.knowledge]), before);
  const resumed = prepareTurn(s, '我想检查门锁', 'correction:resume', { messages: history });
  const next = buildTurnRequest(resumed); assert.doesNotMatch(next.system, /玩家已取消的行动与暂不提及的话题/);
  assert.doesNotThrow(() => assertContinuity(resumed, reply('你检查门锁。')));
  assert.doesNotMatch(next.messages.at(-2).content, /检查仓里的锁具/);
});

test('重新提出后再次纠错，会重新阻止被取消的动作', () => {
  const s = fresh(), history = [{ role: 'user', content: '进去（本回合纠正：/纠错 不要看锁！）' }, { role: 'assistant', sourceTurn: 1, content: '你进了仓。' },
    { role: 'user', content: '我想检查门锁' }, { role: 'assistant', sourceTurn: 2, content: '你检查了门锁。' },
    { role: 'user', content: '刚才（本回合纠正：/纠错 不要看锁！）' }, { role: 'assistant', sourceTurn: 3, content: '你把手放下。' }];
  const p = prepareTurn(s, '继续交谈', 'correction:again', { messages: history });
  assert.throws(() => assertContinuity(p, reply('你检查门锁。')), ContinuityError);
});

test('新纠错保存后能关联历史，主动重提一次后不会在下一回合重新禁用', async () => {
  const s = fresh(), note = '/纠错 不要看锁！不要出现看锁2个字！';
  const p = prepareTurn(s, '查看锁', 'correction:new', { corrections: [note] });
  const result = await settleReply(p, reply('你转向韦头儿。'));
  const history = [{ role: 'user', content: '查看锁（本回合纠正：' + note + '）', correction: note, corrections: [note] },
    { role: 'assistant', sourceTurn: result.state.turn, content: '你转向韦头儿。' }];
  const resumed = prepareTurn(result.state, '我现在要查看门锁', 'correction:resume-new', { messages: history });
  assert.equal(resumed.state.continuity.corrections[0].sourceMessage, 0);
  assert.doesNotThrow(() => assertContinuity(resumed, reply('你查看门锁。')));
  const laterHistory = [...history, { role: 'user', content: '我现在要查看门锁' }, { role: 'assistant', sourceTurn: result.state.turn + 1, content: '你查看门锁。' }];
  const later = prepareTurn(resumed.state, '接着聊', 'correction:after-resume', { messages: laterHistory });
  assert.doesNotThrow(() => assertContinuity(later, reply('你看到门锁没有损坏。')));
});

test('本轮进入新地点必须更新位置，自动修复不能额外移动或改变原存档', async () => {
  const s = fresh(); const before = structuredClone(s);
  const p = prepareTurn(s, '我走进仓库', 'scene:enter');
  let repairs = 0;
  const result = await settleReply(p, reply('你走进仓库。'), { repairContinuity: async () => {
    repairs++; return reply('你走进仓库。', { location: { siteId: 'warehouse_inside', siteName: '仓库内' } });
  } });
  assert.equal(repairs, 1); assert.equal(result.state.player.location.siteId, 'warehouse_inside'); assert.deepEqual(s, before);
});

test('询问和未来计划不冒充已经进入新场所', () => {
  const history = [{ role: 'user', content: '问他今晚能不能进去' }, { role: 'assistant', content: '他说可以。\n仓里比外头暗。' }];
  assert.equal(recentSceneEvidence(history), null);
  const p = prepareTurn(fresh(), '明天进入仓库', 'scene:future');
  assert.equal(missingSceneLocation(p, reply('明天你进入仓库。'), {}), false);
});

test('旧存档场景线索在多轮后仍可追溯，位置确认后不再保留旧线索', async () => {
  const s = fresh(); s.player.location = { siteId: 'street', siteName: '北关仓街外' };
  const history = [{ role: 'user', content: '报公会名号进去' }, { role: 'assistant', sourceTurn: 1, content: '仓里比外头暗。韦头儿点头。' }];
  const first = prepareTurn(s, '商量今晚的安排', 'scene:remember', { messages: history }); first.request = buildTurnRequest(first);
  const result = await settleReply(first, reply('韦头儿点头听你说。'));
  assert.equal(result.state.continuity.sceneEvidence.place, '仓里');
  const later = [...history, ...Array.from({ length: 20 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: '继续商量。' }))];
  const next = prepareTurn(result.state, '接着说', 'scene:later', { messages: later }); const request = buildTurnRequest(next);
  assert.match(request.system, /近期原文已描述进入仓里/); assert.match(request.system, /地点记录可能过时/);
  next.request = request;
  const corrected = await settleReply(next, reply('韦头儿继续说明。', { location: { siteId: 'warehouse', siteName: '北关仓库内' } }));
  assert.equal(corrected.state.continuity.sceneEvidence, undefined); assert.equal(corrected.state.player.location.siteId, 'warehouse');
});

test('场景资料保留委托来源和知情边界，不因委托自动抹去合理冲突', () => {
  const s = fresh(); s.player.contracts = [{ id: 'job', label: '北仓清点', status: 'active', copper: 10000 }];
  const history = [{ role: 'user', content: '接下北仓的委托' }, { role: 'assistant', content: '北仓清点由粮商公会委托，仓头说报公会名号就成。' }];
  const req = buildTurnRequest(prepareTurn(s, '我去和仓头交接', 'scene:contract', { messages: history }));
  assert.match(req.system, /粮商公会委托/); assert.match(req.system, /先按已有合作关系正常交接/);
  assert.match(req.system, /不预设真凶或强制所有人友好/); assert.match(req.system, /不自动成为每个NPC的知识/);
});

test('只有有原文证据的人才获得知情记录，其他人不会被自动写成知情', async () => {
  const s = fresh(), p = prepareTurn(s, '我告诉瑟拉今晚在北仓集合', 'knowledge:told');
  const fact = { text: '今晚在北仓集合', source: '玩家告知', knownBy: ['du'], knownByEvidence: [
    { npcId: 'sera', quote: '我告诉瑟拉今晚在北仓集合' }, { npcId: 'du', quote: '我告诉老杜今晚在北仓集合' }] };
  const result = await settleReply(p, reply('瑟拉点头，记下了约定。', { knowledge: [fact] }));
  const recorded = result.state.knowledge.find(row => row.text === fact.text);
  assert.deepEqual(recorded.knownBy, ['sera']); assert.equal(recorded.knownByEvidence.length, 1);
  const history = [{ role: 'user', content: p.input }, { role: 'assistant', sourceTurn: result.state.turn, content: '瑟拉点头，记下了约定。' }];
  const next = buildTurnRequest(prepareTurn(result.state, '问瑟拉今晚怎么办', 'knowledge:recall', { messages: history }));
  assert.match(next.system, /\[sera\] 有原文依据、已明确告知或听到的事实：今晚在北仓集合/);
  assert.doesNotMatch(next.system, /\[du\] 有原文依据、已明确告知或听到的事实：今晚在北仓集合/);
});

test('同一约定分两次告诉不同人时保留各自的来源与知情记录', async () => {
  const s = fresh(), first = prepareTurn(s, '我告诉瑟拉今晚在北仓集合', 'knowledge:first');
  const firstFact = { key: 'warehouse:meeting', kind: 'agreement', text: '今晚在北仓集合', source: '玩家告知',
    knownByEvidence: [{ npcId: 'sera', quote: '我告诉瑟拉今晚在北仓集合' }] };
  const one = await settleReply(first, reply('瑟拉点头，记下了约定。', { knowledge: [firstFact] }));
  const history = [{ role: 'user', content: first.input }, { role: 'assistant', sourceTurn: one.state.turn, content: '瑟拉点头，记下了约定。' }];
  const second = prepareTurn(one.state, '我告诉老杜今晚在北仓集合', 'knowledge:second', { messages: history });
  const secondFact = { ...firstFact, knownByEvidence: [{ npcId: 'du', quote: '我告诉老杜今晚在北仓集合' }] };
  const two = await settleReply(second, reply('老杜点头，记下了约定。', { knowledge: [secondFact] }));
  const active = two.state.knowledge.filter(row => row.key === 'warehouse:meeting' && row.status !== 'superseded');
  assert.equal(active.length, 1); assert.deepEqual(new Set(active[0].knownBy), new Set(['sera', 'du']));
  const later = [...history, { role: 'user', content: second.input }, { role: 'assistant', sourceTurn: two.state.turn, content: '老杜点头，记下了约定。' }];
  const request = buildTurnRequest(prepareTurn(two.state, '和瑟拉、老杜商量', 'knowledge:both', { messages: later }));
  assert.match(request.system, /\[sera\] 有原文依据、已明确告知或听到的事实：今晚在北仓集合/);
  assert.match(request.system, /\[du\] 有原文依据、已明确告知或听到的事实：今晚在北仓集合/);
});

test('否定和问题中的局部引用不能冒充已经告知或确认', async () => {
  const s = fresh(), p = prepareTurn(s, '我没有告诉瑟拉今晚在北仓集合', 'knowledge:not-told');
  const fact = { text: '今晚在北仓集合', knownByEvidence: [{ npcId: 'sera', quote: '告诉瑟拉今晚在北仓集合' }] };
  const result = await settleReply(p, reply('瑟拉仍在等你说明。', { knowledge: [fact] }));
  assert.equal(result.state.knowledge.find(row => row.text === fact.text).knownBy, undefined);
  const questioned = prepareTurn(s, '我问瑟拉今晚在北仓集合吗？', 'knowledge:question');
  const q = await settleReply(questioned, reply('瑟拉等你确定。', { knowledge: [{ text: fact.text, knownByEvidence: [{ npcId: 'sera', quote: '我问瑟拉今晚在北仓集合吗' }] }] }));
  assert.equal(q.state.knowledge.find(row => row.text === fact.text).knownBy, undefined);
});

test('同名人物不盲信旧编号，身份原文可确认时才关联', () => {
  const s = fresh(); s.npcs.push({ id: 'kyle', name: '凯尔', age: 30, profession: '佣兵' }, { id: 'kell', name: '凯尔', age: 22, profession: '冒险者（C级）' }, { id: 'tam', name: '塔姆', age: 19, profession: '冒险者（D级）' });
  const old = { id: 'guard', text: '凯尔与塔姆守后墙', npcIds: ['kyle', 'tam'], source: '旧记录' };
  const safe = linkKnowledge(s, old); assert.ok(!safe.npcIds.includes('kyle')); assert.ok(safe.npcIds.includes('tam')); assert.deepEqual(safe.uncertainNpcNames, ['凯尔']);
  for (const query of ['凯尔（22岁·冒险者（C级））', '凯尔（30岁·佣兵）']) assert.equal(selectRelevant([safe], query, 5, row => row.text, memoryContext(s, query)).length, 0);
  assert.deepEqual(old.npcIds, ['kyle', 'tam']);
  assert.ok(factEntityRefs(s, 'C级凯尔守后墙', { npcIds: ['kell'] }).npcIds.includes('kell'));
});

test('旧记录可由同一任务的身份和同行原文核对，证据冲突时不猜', () => {
  const s = fresh(); s.turn = 2;
  s.npcs.push({ id: 'kyle', name: '凯尔', age: 30, profession: '佣兵' }, { id: 'kell', name: '凯尔', age: 22, profession: '冒险者（C级）' }, { id: 'tam', name: '塔姆', age: 19, profession: '冒险者（D级）' });
  const fact = { id: 'guard', text: '凯尔与塔姆守住后墙', npcIds: ['kyle', 'tam'], source: '任务记录', sourceTurn: 2 }; s.knowledge.push(fact);
  const history = [{ role: 'assistant', sourceTurn: 1, content: '随行二人，凯尔，C级；塔姆，D级。' }, { role: 'assistant', sourceTurn: 2, content: '凯尔和塔姆守住后墙。' }];
  const hints = historicalIdentityHints(s, history), hint = hints.get('guard');
  assert.ok(hint.npcIds.includes('kell')); assert.ok(!hint.npcIds.includes('kyle')); assert.match(hint.historicalIdentityEvidence[0].quote, /凯尔，C级/);
  const req = buildTurnRequest(prepareTurn(s, '凯尔（22岁·冒险者（C级））后墙怎么安排', 'identity:history', { messages: history }));
  assert.match(req.system, /凯尔与塔姆守住后墙/); assert.match(req.system, /同名身份参考/); assert.deepEqual(fact.npcIds, ['kyle', 'tam']);
  const conflicting = [history[0], { role: 'assistant', sourceTurn: 1, content: '随行二人，凯尔（30岁·佣兵）与塔姆。' }, history[1]];
  assert.equal(historicalIdentityHints(s, conflicting).has('guard'), false);
});

test('模型引用可靠身份原文时可纠正编号，编造证据不会被信任', async () => {
  const s = fresh(); s.npcs.push({ id: 'kyle', name: '凯尔', age: 30, profession: '佣兵' }, { id: 'kell', name: '凯尔', age: 22, profession: '冒险者（C级）' }, { id: 'tam', name: '塔姆', age: 19, profession: '冒险者（D级）' });
  const history = [{ role: 'assistant', content: '随行二人，凯尔，C级；塔姆，D级。' }];
  const p = prepareTurn(s, '问塔姆后墙如何安排', 'identity:evidence', { messages: history });
  const facts = [{ text: '凯尔和塔姆守后墙', npcIds: ['kyle', 'tam'], identityVerifiedNpcIds: ['kyle'], identityEvidence: [{ npcId: 'kell', quote: '凯尔，C级' }] },
    { text: '凯尔拿着蓝色信物', npcIds: ['kyle'], identityEvidence: [{ npcId: 'kyle', quote: '凯尔（30岁·佣兵）' }] }];
  const result = await settleReply(p, reply('塔姆说后墙有人看守。', { knowledge: facts }));
  const trusted = linkKnowledge(result.state, result.state.knowledge.find(row => row.text === facts[0].text));
  assert.ok(trusted.npcIds.includes('kell')); assert.ok(!trusted.npcIds.includes('kyle'));
  const uncertain = linkKnowledge(result.state, result.state.knowledge.find(row => row.text === facts[1].text));
  assert.ok(!uncertain.npcIds.includes('kyle')); assert.deepEqual(uncertain.uncertainNpcNames, ['凯尔']);
});

test('约定被更新必须有本回合原文证据，JSON自带的假引文不能覆盖旧约定', async () => {
  const s = fresh(); s.knowledge = [{ id: 'old', key: 'split', kind: 'agreement', text: '瑟拉和玩家平分赏金', source: '先前约定' }];
  const next = { key: 'split', kind: 'agreement', text: '瑟拉和玩家按三成分赏金', sourceQuote: '瑟拉和玩家按三成分赏金' };
  const p = prepareTurn(s, '问候瑟拉', 'agreement:unproven');
  const unproven = await settleReply(p, reply('瑟拉点头问候。', { knowledge: [next] }));
  assert.notEqual(unproven.state.knowledge.find(k => k.id === 'old').status, 'superseded');
  const pending = unproven.state.knowledge.find(k => k.key === 'split' && k.id !== 'old');
  assert.equal(pending.status, 'unverified'); assert.match(stateBlock(unproven.state), /待核实的说法/);
  assert.match(VIEWS.clues(uiState(unproven.state)), /待核实/);
  assert.equal(conditionMet(unproven.state, { type: 'knowledge', id: pending.id }), false);
  const agreed = prepareTurn(s, '我同意和瑟拉改变分配', 'agreement:confirmed');
  const updated = await settleReply(agreed, reply('瑟拉说：瑟拉和玩家按三成分赏金。', { knowledge: [next] }));
  assert.equal(updated.state.knowledge.find(k => k.id === 'old').status, 'superseded');
});

test('人数是会变化的当前状态，较新的纠正替代旧数值，重新纠正仍可生效', () => {
  const s = fresh(), history = [{ role: 'user', content: '为什么说四个半，我们现在明明是6个人' }, { role: 'assistant', sourceTurn: 1, content: '你们是六个人。' },
    { role: 'user', content: '队员离开后，我们现在明明是5个人' }, { role: 'assistant', sourceTurn: 2, content: '现在五个人。' }];
  const p = prepareTurn(s, '继续商量', 'count:latest', { messages: history }); const text = buildTurnRequest(p).system;
  assert.match(text, /现在明明是5个人/); assert.doesNotMatch(text, /现在明明是6个人/);
  const again = [...history, { role: 'user', content: '为什么说四个半，我们现在明明是6个人' }, { role: 'assistant', sourceTurn: 3, content: '你们恢复为六个人。' }];
  const next = prepareTurn(p.state, '继续商量', 'count:again', { messages: again }); const updated = buildTurnRequest(next).system;
  assert.match(updated, /现在明明是6个人/); assert.doesNotMatch(updated, /现在明明是5个人/);
});

test('早期重要原文的尾部不再截成1100字，历史同时包含对应玩家输入', () => {
  const s = fresh(), history = [{ role: 'user', content: '北仓分配怎么约定？' },
    { role: 'assistant', sourceTurn: 7, content: '北仓约定：' + '说明细节。'.repeat(300) + '最后扣除固定工钱后，搭档均分剩余赏金。' },
    ...Array.from({ length: 30 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: '日常。' }))];
  const recalled = recallHistory(s, history, '北仓分配约定');
  assert.match(recalled, /最后扣除固定工钱后，搭档均分剩余赏金/); assert.match(recalled, /北仓分配怎么约定/);
  assert.match(recalled, /第7回合/); assert.doesNotMatch(recalled, /第2条/);
});

test('旧纠错原文自动恢复并持久保留，旧名单错误退出事实和待办，不动钱款或时间', () => {
  const s = fresh(); s.knowledge.push({ id: 'wrong', text: '瑟拉不在这单名单上' });
  s.player.unfinished = [{ id: 'wrong-task', text: '定下瑟拉是否加入，以及酬劳怎么算' }];
  const history = [{ role: 'user', content: `重新数人数\n（本回合纠正：${correction}）` }, { role: 'assistant', sourceTurn: 86, content: '你们又商议起来。' }];
  const before = JSON.stringify([s.clock, s.turn, s.player.accounts]);
  rememberCorrections(s, history); assert.equal(s.continuity.corrections.length, 1);
  assert.equal(s.knowledge.find(k => k.id === 'wrong').status, 'disputed'); assert.equal(s.player.unfinished.length, 0);
  assert.equal(s.player.taskHistory[0].status, 'archived'); assert.equal(JSON.stringify([s.clock, s.turn, s.player.accounts]), before);
  const restored = decodeSave(savePackage(s, history)).state;
  rememberCorrections(restored, history); assert.deepEqual(restored.continuity, s.continuity);
  assert.doesNotMatch(stateBlock(restored), /瑟拉不在这单名单上/);
});

test('短回复继承当前话题，已记录的重要约定不受18条旧上限挤掉', () => {
  const s = fresh(); s.player.contracts = [{ id: 'warehouse', label: '北仓守夜', status: 'active', copper: 100000 }];
  s.knowledge = [{ id: 'split', text: '北仓守夜扣除固定工钱后搭档均分', kind: 'agreement', key: 'warehouse:split', source: '玩家确认' },
    ...Array.from({ length: 100 }, (_, i) => ({ id: `other:${i}`, text: '城里的无关旧事。'.repeat(40) }))];
  const p = prepareTurn(s, '好', 'context:short', { messages: [{ role: 'user', content: '今晚北仓的分配照旧。' }, { role: 'assistant', content: '搭档留下。\n【你现在可以做什么】\n① 未选择的额外送礼' }] });
  const request = buildTurnRequest(p);
  assert.match(request.system, /北仓守夜扣除固定工钱后搭档均分/);
  assert.match(request.system, /冒险者（B级）/); assert.match(request.system, /一直与玩家一起行动的搭档/);
  assert.ok(request.messages.every(m => !m.content.includes('未选择的额外送礼')));
});

test('同一回合连续纠错累计全部要求，修复和核对继承同一份上下文', () => {
  const s = fresh(), corrections = [correction, '/纠错 不要出现巡锁2个字！'];
  const p = prepareTurn(s, '报公会名号后巡锁', 'context:replace', { corrections, rejectedReply: '错误名单与错误行为。' });
  p.request = buildTurnRequest(p);
  assert.match(p.request.system, /我和瑟拉平分剩余赏金/); assert.match(p.request.system, /不要出现巡锁2个字/);
  assert.match(p.request.system, /待替换的错误回复，仅供定位/);
  assert.doesNotMatch(p.request.messages.at(-1).content, /报公会名号后巡锁/);
  const repaired = repairMessages(p, reply('候选回复'), '重新核对');
  assert.deepEqual(repaired.slice(0, p.request.messages.length), p.request.messages);
  const history = [{ role: 'user', content: '原行动', correction: corrections.join('\n'), corrections }, { role: 'assistant', sourceTurn: 8, content: '修正后的回复' }];
  rememberCorrections(p.state, history); assert.equal(p.state.continuity.corrections.length, 2);
  assert.match(buildTurnRequest(prepareTurn(p.state, '继续交谈', 'context:next', { messages: history })).system, /我和瑟拉平分剩余赏金/);
});

test('实际六人不能折算半个人，明确禁用文字被检查，事实纠正优先于旧叙述', () => {
  const p = prepareTurn(fresh(), '说清队伍', 'context:guard', { corrections: [correction, '/纠错 我们现在明明是6个人', '/纠错 不要出现巡锁2个字！'] });
  for (const text of ['你们五个半人。', '塔姆算半个。', '瑟拉不在这次任务中。', '你先巡锁。']) assert.throws(() => assertContinuity(p, reply(text)), ContinuityError, text);
  assert.doesNotThrow(() => assertContinuity(p, reply('瑟拉与你一起行动。六名成员均在，战斗能力按各自等级评估。')));
  assert.equal(isCorrection('为什么说四个半，我们现在明明是6个人'), true);
  assert.equal(correctionText({ role: 'user', content: '为什么说四个半，我们现在明明是6个人' }), '为什么说四个半，我们现在明明是6个人');
});

test('一致性核对必须有可验证证据，可发现同义词绕过与漏答，坏结果不视为通过', () => {
  const raw = reply('你仍逐一检查门上的锁具。'), sources = '玩家：不要再检查门锁，直接说明是来守仓的。';
  assert.throws(() => validateContextReview({ ok: false, issues: [{ kind: 'correction', problem: '只是换了说法，仍在检查锁具', sourceQuote: '不要再检查门锁', replyQuote: '检查门上的锁具' }] }, raw, sources), ContinuityError);
  assert.throws(() => validateContextReview({ ok: false, issues: [{ kind: 'omission', problem: '遗漏来意', sourceQuote: '直接说明是来守仓的' }] }, raw, sources), ContinuityError);
  assert.doesNotThrow(() => validateContextReview({ ok: true, issues: [] }, raw, sources));
  for (const review of [null, { ok: true }, { ok: false, issues: [] }, { ok: false, issues: [{ kind: 'correction', problem: '错误', sourceQuote: '编造的证据', replyQuote: '锁具' }] }]) assert.throws(() => validateContextReview(review, raw, sources));
});

test('一致性错误只重写一次，复核失败或修复改了物品时原进度不提交', async () => {
  const s = fresh(), p = prepareTurn(s, '谈谈队伍', 'context:atomic', { corrections: [correction] });
  const original = structuredClone(p.state), bad = reply('瑟拉不在这单上。'); let attempts = 0, reviewed = 0;
  const result = await settleReply(p, bad, { repairContinuity: async () => { attempts++; return reply('瑟拉是你的搭档，照旧一起行动。'); }, reviewContinuity: async () => { reviewed++; } });
  assert.equal(attempts, 1); assert.equal(reviewed, 1); assert.equal(result.state.turn, s.turn + 1); assert.deepEqual(p.state, original);
  await assert.rejects(settleReply(p, bad, { repairContinuity: async () => bad }), ContinuityError);
  await assert.rejects(settleReply(p, bad, { repairContinuity: async () => reply('瑟拉与你同行。', { items: [{ name: '凭空多出的药水', qty: 1 }] }) }), /受保护/);
  const error = Object.assign(new Error('核对连接中断'), { contextReviewFailed: true }); let dataRepairs = 0;
  await assert.rejects(settleReply(p, reply('瑟拉与你同行。'), { reviewContinuity: async () => { throw error; }, repair: async () => { dataRepairs++; return {}; } }), /核对连接中断/);
  assert.equal(dataRepairs, 0); assert.deepEqual(p.state, original);
});

test('同一重要约定变更后旧版本保留但不再传作现行事实', () => {
  const s = fresh(); s.knowledge = [{ id: 'old', key: 'split', kind: 'agreement', text: '搭档原先按三成分', source: '旧约定' }];
  assert.ok(applyDelta(s, { knowledge: [{ key: 'split', kind: 'agreement', text: '搭档确认改为对半分', source: '双方已确认' }] }, makeRng(1), { eventId: 'context:fact' }).applied);
  assert.equal(s.knowledge[0].status, 'superseded'); assert.match(stateBlock(s), /搭档确认改为对半分/); assert.doesNotMatch(stateBlock(s), /搭档原先按三成分/);
});

test('导出和云备份可携带上一回合快照，恢复后继续累计纠错，坏快照不能回退', () => {
  const s = fresh(), history = [{ role: 'assistant', content: '你们准备出发。' }];
  const p = prepareTurn(s, '谈谈安排', 'context:checkpoint', { messages: history, corrections: [correction] });
  const result = finishTurn(p, {}).state;
  const messages = [...history, { role: 'user', content: '谈谈安排', correction, corrections: [correction] },
    { role: 'assistant', sourceTurn: result.turn, turnId: p.id, content: '瑟拉是你的搭档。' }];
  const lastTurn = { id: p.id, input: p.text, base: p.base, messages: history, corrections: p.corrections };
  const pack = savePackage(result, messages, { lastTurn });
  assert.equal(pack.lastTurn.historyCount, 1); assert.equal(pack.lastTurn.messages, undefined);
  const restored = decodeSave(JSON.parse(JSON.stringify(pack)));
  assert.deepEqual(restored.lastTurn.messages, history); assert.deepEqual(restored.lastTurn.corrections, [correction]);
  const next = prepareTurn(restored.lastTurn.base, restored.lastTurn.input, restored.lastTurn.id,
    { messages: restored.lastTurn.messages, corrections: [...restored.lastTurn.corrections, '/纠错 这回不增加其他行动'] });
  assert.equal(finishTurn(next, {}).state.turn, result.turn);
  assert.throws(() => decodeSave({ ...pack, lastTurn: { ...pack.lastTurn, historyCount: 10000 } }), /快照无效/);
  assert.throws(() => decodeSave({ ...pack, lastTurn: { ...pack.lastTurn, base: { ...pack.lastTurn.base, turn: result.turn - 5 } } }), /快照无效/);
  assert.equal(decodeSave(savePackage(result, messages)).lastTurn, undefined);
});

test('被明确提到的人物超过八名也完整传递，新知识不会截断最后的约定', () => {
  const s = fresh(); s.npcs = Array.from({ length: 10 }, (_, i) => ({ id: `p${i}`, name: `成员${i}`, age: 20, profession: '冒险者', traits: [] }));
  const query = s.npcs.map(n => n.id).join('、'); assert.equal(relevantNpcs(s, query).length, 10);
  const text = '具体条款。'.repeat(120) + '最后条件是扣工钱后由搭档对半分。';
  assert.ok(applyDelta(s, { knowledge: [{ kind: 'agreement', key: 'long-split', text, source: '当面确认' }] }, makeRng(1), { eventId: 'context:complete' }).applied);
  assert.equal(s.knowledge.at(-1).text, text); assert.match(stateBlock(s), /最后条件是扣工钱后由搭档对半分/);
});
