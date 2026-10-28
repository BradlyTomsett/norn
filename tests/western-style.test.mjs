import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { generateWorld, openingText } from '../engine/worldgen.js';
import { upgradeState } from '../engine/schema.js';
import { judge } from '../engine/resolve.js';
import { makeRng } from '../engine/rng.js';
import { buildPrompt } from '../engine/protocol.js';
import { gamePriceEntry } from '../engine/economy.js';
import { streamChat } from '../llm.js';

test('新人物模板和开场用西方奇幻职业称呼，家族编号和指定姓名保持兼容', () => {
  for (const [familyKey, profession] of [['npc_docker', '码头工人'], ['npc_clerk', '记账员学徒'], ['npc_peddler', '旅行商人']]) {
    const { state, family, region } = generateWorld({ regionId: 'tideport', familyKey, seed: 41, playerName: '王大爷' });
    assert.equal(state.player.name, '王大爷'); assert.equal(state.npcs.find(n => n.id === 'npc_father').profession, profession);
    assert.doesNotMatch(openingText(state, family, region), /脚夫|账房学徒|挑着担子/);
  }
});

test('每次实际API请求均携带西式文风，原始输入与辅助任务指令保持不变', async () => {
  const oldFetch = globalThis.fetch, oldLocal = globalThis.localStorage, oldSession = globalThis.sessionStorage;
  const storage = values => ({ getItem: key => values[key] ?? null, setItem: (key, value) => { values[key] = value; }, removeItem: key => { delete values[key]; } });
  globalThis.localStorage = storage({ 'norn.key': 'fixture-key' }); globalThis.sessionStorage = storage({});
  const sent = [];
  globalThis.fetch = async (_url, options) => { sent.push(JSON.parse(options.body)); return new Response('data: [DONE]\n\n'); };
  try {
    for (const system of ['普通剧情生成', '只核对事项并逐字引用来源', '只分析玩家行动', '纠错并保留原JSON']) {
      for await (const _chunk of streamChat({ system, messages: [{ role: 'user', content: '去牙行，找王大爷' }] })) { /* consume */ }
    }
    assert.equal(sent.length, 4);
    for (const request of sent) {
      assert.match(request.messages[0].content, /【西式奇幻用词】/);
      assert.match(request.messages[0].content, /逐字引用玩家输入或历史证据时保留原文/);
      assert.equal(request.messages[1].content, '去牙行，找王大爷');
    }
    assert.match(sent[1].messages[0].content, /只核对事项并逐字引用来源/);
  } finally { globalThis.fetch = oldFetch; globalThis.localStorage = oldLocal; globalThis.sessionStorage = oldSession; }
});
test('实际发送的提示要求西化叙事，同时保留指定专名和旧称输入兼容', async () => {
  const { state } = generateWorld({ regionId: 'greywater', seed: 1, playerName: '王大爷' }); upgradeState(state);
  const rules = await readFile(new URL('../prompt/rules.md', import.meta.url), 'utf8');
  const worldbook = await readFile(new URL('../prompt/worldbook.md', import.meta.url), 'utf8');
  const prompt = buildPrompt(state, judge(state, '向中介询问', makeRng(3)), [], { rules, worldbook, query: '向中介询问' });
  for (const text of ['时间', '小时', '码头工人', '税务官', '中介', '不自动改动玩家指定的人物姓名']) assert.ok(prompt.includes(text), text);
  assert.ok(prompt.includes('王大爷')); assert.deepEqual(gamePriceEntry('牙行'), gamePriceEntry('中介抽成'));
});
