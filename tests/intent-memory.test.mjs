import test from 'node:test';
import assert from 'node:assert/strict';
import { generateWorld } from '../engine/worldgen.js';
import { prepareTurn } from '../engine/turn.js';
import { currentAction, judge } from '../engine/resolve.js';
import { playerPermissions, assertPlayerAgency } from '../engine/agency.js';
import { makeRng } from '../engine/rng.js';
import { recallHistory } from '../engine/memory.js';
import { buildTurnRequest } from '../engine/context.js';
import { needsIntentReview, validateIntentAnalysis, intentBlock } from '../engine/intent.js';

const fresh = () => generateWorld({ regionId: 'greywater', familyKey: 'npc_farmer', seed: 7, name: '旅人' }).state;

test('过去买卖、同伴购买和明确拒绝不会变成玩家本轮交易', () => {
  const s = fresh();
  const old = prepareTurn(s, '我以前买过剑，现在问他吃饭了吗', 'intent:past');
  assert.equal(old.judged.kind, 'social'); assert.ok(old.judged.minutes < 60); assert.equal(old.finance.length, 0);
  assert.equal(playerPermissions(old.text).purchase, false);
  const delegated = prepareTurn(s, '让同伴买药水，我不买', 'intent:other');
  assert.equal(delegated.judged.kind, 'social'); assert.equal(delegated.finance.length, 0);
  assert.equal(playerPermissions(delegated.text).purchase, false);
  assert.throws(() => assertPlayerAgency(delegated, '同伴去买药。', { transactions: [{ kind: 'purchase', name: '药水', copper: 10 }] }), /没有批准/);
  const invite = prepareTurn(s, '我答应邀请，但不接委托', 'intent:invite');
  assert.equal(playerPermissions(invite.text).accept, false);
  assert.doesNotThrow(() => assertPlayerAgency(invite, '你接受邀请，委托仍待决定。', {}));
  assert.throws(() => assertPlayerAgency(invite, '你应邀赴宴。', { bounty: { label: '守夜', copper: 100 } }), /尚未答应/);
  assert.equal(playerPermissions('我接下守夜委托').accept, true);
  assert.equal(playerPermissions('我买一瓶药水').purchase, true);
  assert.equal(judge(s, '不杀人只制伏窃贼', makeRng(1)).kind, 'combat');
  assert.deepEqual(currentAction('我先睡觉，明天再去杀怪').future, ['明天再去杀怪']);
});

test('同义约定检索保留原文和来源，对话不虚构分配比例', () => {
  const s = fresh(); s.npcs.push({ id: 'partner', name: '薇拉', profession: '冒险者', age: 25 });
  const history = [{ role: 'user', content: '和薇拉商量这单酬金。' },
    { role: 'assistant', sourceTurn: 12, content: '薇拉说：“扣除工钱后我们平分剩余赏金。”' },
    ...Array.from({ length: 30 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: '日常走动。' }))];
  const text = recallHistory(s, history, '她当初答应分多少', 5, { before: history.length - 2 });
  assert.match(text, /第12回合/); assert.match(text, /扣除工钱后我们平分剩余赏金/);
  assert.match(text, /和薇拉商量这单酬金/);
  assert.doesNotMatch(recallHistory(s, history, '她答应什么时候到港口', 2, { before: 2 }), /三成/);
});

test('模型意图只接受完整原文分句，不能通过局部引用掩盖否定、伪造对象或授权交易', () => {
  const input = '让同伴买药水，我不买';
  const good = { clauses: [{ quote: '让同伴买药水', actor: 'other', time: 'now', mode: 'action', target: '药水' },
    { quote: '我不买', actor: 'player', time: 'now', mode: 'negated', target: '' }] };
  assert.equal(needsIntentReview(input), true); assert.equal(needsIntentReview('问候店主'), false);
  const rows = validateIntentAnalysis(good, input); assert.equal(rows.length, 2); assert.match(intentBlock(rows), /不能授权交易/);
  assert.deepEqual(validateIntentAnalysis({ clauses: [{ ...good.clauses[1], quote: '买' }] }, input), []);
  assert.deepEqual(validateIntentAnalysis({ clauses: [{ ...good.clauses[0], target: '长剑' }] }, input), []);
  assert.deepEqual(validateIntentAnalysis({ clauses: [{ ...good.clauses[0], quote: '同伴买药水' }] }, input), []);
  const plan = prepareTurn(fresh(), input, 'intent:context'); plan.intentAnalysis = rows;
  const req = buildTurnRequest(plan); assert.match(req.system, /执行者其他人/); assert.match(req.system, /玩家原文优先/);
  assert.equal(playerPermissions(plan.text).purchase, false);
});

test('对话指导使用关系和现场，保持角色自主且不安排每人轮流发言', () => {
  const req = buildTurnRequest(prepareTurn(fresh(), '和搭档讨论守夜', 'dialogue:style'));
  assert.match(req.system, /熟悉的搭档自然接续话题/);
  assert.match(req.system, /不强迫所有人轮流开口/);
  assert.match(req.system, /人物可以有真实顾虑、拒绝和各自利益/);
});
