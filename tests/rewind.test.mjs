import test from 'node:test';
import assert from 'node:assert/strict';
import { generateWorld } from '../engine/worldgen.js';
import { upgradeState } from '../engine/schema.js';
import * as store from '../store.js';

class Storage {
  data = new Map();
  get length() { return this.data.size; }
  key(i) { return [...this.data.keys()][i]; }
  getItem(k) { return this.data.get(k) ?? null; }
  setItem(k, v) { this.data.set(k, String(v)); }
  removeItem(k) { this.data.delete(k); }
}
test('最多保存20个完整状态恢复点，回档同步还原对话、金钱及时间并删除后续分支', async () => {
  globalThis.localStorage = new Storage();
  const { state } = generateWorld({ regionId: 'greywater', seed: 17, playerName: '测试' });
  state.saveId = 'sv_rewind'; upgradeState(state);
  let messages = [{ role: 'assistant', content: '开局' }]; await store.putSaveAsync(state, messages);
  for (let i = 1; i <= 25; i++) {
    const base = structuredClone(state), history = structuredClone(messages);
    state.turn = i; state.clock.minute = i; state.player.accounts[0].copper = 1000 + i;
    if (i === 25) state.player.body.health = 0;
    messages = [...messages, { role: 'user', content: `行动${i}` }, { role: 'assistant', content: `结果${i}` }];
    await store.putSaveAsync(state, messages, { rewindPoint: { turn: base.turn, state: base, historyCount: history.length },
      lastTurn: { id: `turn:${i}`, input: `行动${i}`, base, messages: history } });
  }
  const points = store.getRewindPoints(state.saveId);
  assert.equal(points.length, 20); assert.equal(points[0].turn, 5); assert.equal(points.at(-1).turn, 24);
  const data = store.savePackage(state, messages, { lastTurn: store.getLastTurn(state.saveId), rewindPoints: points });
  assert.equal(store.decodeSave(data).rewindPoints.length, 20);
  assert.throws(() => store.decodeSave({ ...data, rewindPoints: [{ ...points[0], historyCount: 9999 }] }), /回档记录无效/);
  await assert.rejects(store.rewindTurns(state.saveId, 21), /1 到 20/);
  const restored = await store.rewindTurns(state.saveId, 20);
  assert.equal(restored.turn, 5); assert.equal(restored.clock.minute, 5); assert.equal(restored.player.accounts[0].copper, 1005);
  assert.equal(restored.player.body.health > 0, true);
  assert.equal(store.getMessages(state.saveId).length, 11);
  assert.equal(store.getRewindPoints(state.saveId).length, 0);
  assert.equal(store.getLastTurn(state.saveId), null);
});
