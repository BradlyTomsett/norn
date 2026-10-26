import test from 'node:test';
import assert from 'node:assert/strict';
import { generateWorld } from '../engine/worldgen.js';
import { upgradeState } from '../engine/schema.js';
import { prepareTurn, finishTurn } from '../engine/turn.js';
import { settleReply } from '../engine/reply.js';
import { buildTurnRequest, recentHistory, repairMessages } from '../engine/context.js';
import { rememberCorrections, correctionText, assertContinuity, validateContextReview, ContinuityError } from '../engine/continuity.js';
import { recallHistory } from '../engine/memory.js';
import { isCorrection } from '../engine/resolve.js';
import { uiState, stateBlock, applyDelta } from '../engine/state.js';
import { makeRng } from '../engine/rng.js';
import { relevantNpcs } from '../engine/npcs.js';
import { decodeSave, savePackage } from '../store.js';

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
