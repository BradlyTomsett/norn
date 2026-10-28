import test from 'node:test';
import assert from 'node:assert/strict';
import { generateWorld } from '../engine/worldgen.js';
import { prepareTurn } from '../engine/turn.js';
import { settleGeneratedReply } from '../engine/reply.js';
import { completeReply } from '../generation.js';
import { splitDelta } from '../format.js';
const fresh = () => generateWorld({ regionId: 'greywater', familyKey: 'npc_farmer', seed: 7, name: '旅人' }).state;
const lengthError = () => Object.assign(new Error('长度限制'), { code: 'generation_length' });

test('生成的正文不复核，钱、物、任务和人物关系一次更新', async () => {
  const s = fresh(); s.player.unfinished = [{ id: 'delivery', text: '交付信物' }];
  s.player.contracts = [{ id: 'delivery-contract', label: '交付信物', status: 'active', copper: 100 }];
  const id = s.npcs[0].id, p = prepareTurn(s, '问候店主', 'direct:state'), cash = p.base.player.accounts[0].copper;
  const delta = { transactions: [{ kind: 'income', copper: 20, note: '收款' }], items: [{ name: '黑面包', qty: 2 }],
    tasks: [{ id: 'delivery', status: 'completed' }], relations: [{ npcId: id, closeness: 3, observable: '交接顺利' }],
    contractUpdates: [{ id: 'delivery-contract', workStatus: 'completed' }] };
  const raw = '你答应了他的安排。\n```json\n' + JSON.stringify(delta) + '\n```';
  let reviews = 0, repairs = 0;
  const r = await settleGeneratedReply(p, raw, { reviewContinuity: () => reviews++, repairState: () => repairs++ });
  assert.equal(reviews, 0); assert.equal(repairs, 0); assert.equal(r.raw, raw);
  assert.equal(r.state.player.accounts[0].copper, cash + 20); assert.equal(r.state.player.bag.find(i => i.name === '黑面包').qty, 2);
  assert.ok(r.state.player.taskHistory.some(t => t.id === 'delivery' && t.status === 'completed'));
  assert.equal(r.state.player.contracts[0].workStatus, 'completed'); assert.equal(r.state.player.contracts[0].status, 'active');
  assert.equal(r.state.player.relations.find(n => n.npcId === id).closeness, p.state.player.relations.find(n => n.npcId === id).closeness + 3);
  assert.equal(s.turn, 0); assert.equal(r.state.turn, 1);
});

test('损坏的状态数据只整理一次，错误交易不能部分入账', async () => {
  const p = prepareTurn(fresh(), '等一会', 'direct:data'), before = structuredClone(p.state);
  const raw = '你等了一阵。\n```json\n{"transactions":[{"kind":"payment","copper":99999999}]}\n```';
  await assert.rejects(settleGeneratedReply(p, raw)); assert.deepEqual(p.state, before);
  let attempts = 0; const r = await settleGeneratedReply(p, raw, { repairState: async () => { attempts++; return {}; } });
  assert.equal(attempts, 1); assert.equal(r.raw, raw); assert.equal(r.state.turn, 1);
});

test('长度截断自动接着补完；JSON截断只补状态块，正文不重复', async () => {
  let calls = 0;
  const stream = async function* (options) {
    calls++;
    if (calls === 1) { yield '仓里安静下来。\n```json\n{"items":['; throw lengthError(); }
    assert.equal(options.effort, 'none'); assert.match(options.messages.at(-1).content, /仅补上/);
    yield '```json\n{"items":[{"name":"面包","qty":1}]}\n```';
  };
  const raw = await completeReply({ system: 'test', messages: [] }, { stream });
  assert.equal(calls, 2); assert.equal((raw.match(/仓里安静下来/g) || []).length, 1);
  assert.equal(splitDelta(raw).delta.items[0].qty, 1);
});

test('正文截断、纯思考耗尽和重新打开后都能继续，连续截断有次数上限', async () => {
  let calls = 0;
  const raw = await completeReply({ system: 'test', messages: [] }, { initialRaw: '你等了一阵，', resume: true,
    stream: async function* () { calls++; yield '仓里仍然安静。\n```json\n{}\n```'; } });
  assert.equal(raw, '你等了一阵，仓里仍然安静。\n```json\n{}\n```'); assert.equal(calls, 1);
  calls = 0;
  await assert.rejects(completeReply({ system: 'test', messages: [] }, { stream: async function* () { calls++; throw lengthError(); } }), e => e.code === 'generation_length');
  assert.equal(calls, 3);
});
