import { ArchiveStore } from '../persistence.js';
import { generateWorld } from '../engine/worldgen.js';
import * as store from '../store.js';
const out = document.querySelector('#results'), passed = [];
const check = (condition, name) => { if (!condition) throw new Error(name); passed.push(name); out.textContent = passed.join('\n'); };
let db, second;
try {
  const name = 'norn-test-' + crypto.randomUUID(); db = await new ArchiveStore(indexedDB, name).open();
  const state = { saveId: 'long', revision: 0, turn: 0 };
  const history = Array.from({ length: 6000 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: `第${i}条` + '完整历史不能丢失。'.repeat(100) }));
  let record = await db.commit('long', { state, expectedRevision: 0, tail: { start: 0, messages: history } });
  check(record.messageCount === 6000 && JSON.stringify(history).length > 5_000_000, '超过旧容量的6000条历史完整写入');
  second = await new ArchiveStore(indexedDB, name).open();
  record = await second.commit('long', { state: { ...record.state, turn: 1 }, expectedRevision: 1, tail: { start: 6000, messages: [{ role: 'assistant', content: '新增尾部' }] }, patch: { pending: null, lastTurn: { historyCount: 6000 } } });
  check((await db.messages('long')).length === 6001 && record.state.revision === 2, '第二个连接追加历史并原子写入回退点');
  let conflict = false; try { await db.commit('long', { state, expectedRevision: 1, tail: { start: 0, messages: [] } }); } catch { conflict = true; }
  check(conflict && (await second.messages('long')).length === 6001, '过期页面无法覆盖新进度');
  let aborted = false; try { await db.commit('long', { state: { ...record.state, turn: 999 }, expectedRevision: 2, tail: { start: 6001, messages: [{ content: () => {} }] } }); } catch { aborted = true; }
  check(aborted && (await db.get('long')).state.turn === 1 && (await db.messages('long')).length === 6001, '事务中途失败时状态与消息一起回滚');
  await db.commit('long', { state: { ...record.state, turn: 0 }, expectedRevision: 2, tail: { start: 6000, messages: [] } });
  check((await db.messages('long')).length === 6000, '撤回只截断本回合历史');
  db.close(); second.close();
  const { state: legacy } = generateWorld({ regionId: 'greywater', seed: 77, playerName: '迁移测试' }); legacy.saveId = 'migration-' + crypto.randomUUID();
  store.putSave(legacy, history.slice(0, 1200));
  await store.initStorage(); await store.loadMessages(legacy.saveId);
  check(store.storageInfo(legacy.saveId).mode === '扩展存储' && store.getMessages(legacy.saveId).length === 1200, '旧版完整历史迁移到扩展存储');
  const current = store.getSave(legacy.saveId), before = current.revision;
  await store.putPendingAsync(current.saveId, { text: '等一会', history: store.getMessages(current.saveId), baseRevision: before });
  await store.putSaveAsync(current, [...store.getMessages(current.saveId), { role: 'assistant', content: '新回合' }], { pending: null, replaceFrom: 1200, lastTurn: { base: structuredClone(current), messages: store.getMessages(current.saveId) } });
  check(current.revision === before + 1 && store.getLastTurn(current.saveId).messages.length === 1200 && store.getPending(current.saveId) === null, '应用保存与回退历史引用一致');
  const rawDb = await new ArchiveStore().open(), raw = await rawDb.get(current.saveId); rawDb.close();
  check(!raw.lastTurn.messages && raw.lastTurn.historyCount === 1200, '回退点不重复存放整份历史');
  const imported = await store.importSave({ text: async () => JSON.stringify(store.savePackage(current)) });
  check(store.getMessages(imported).length === 1201 && imported !== current.saveId, '长存档导出导入保留全部历史且另存分支');
  await store.recordDiagnostic(current.saveId, { turn: 1, requests: 1, promptTokens: 123, outcome: 'saved', raw: 'sk-secret', key: 'sk-secret' });
  check(!JSON.stringify(store.getDiagnostics(current.saveId)).includes('secret'), '诊断不保存密钥与原文');
  const count = store.listSaves().length;
  const reloadStore = await import('../store.js?reload-test'); await reloadStore.initStorage();
  check(reloadStore.listSaves().length === count, '重新载入不会把保留的旧版副本重复导入');
  const legacyKey = 'norn.save.' + legacy.saveId, legacyRaw = JSON.parse(localStorage.getItem(legacyKey));
  legacyRaw.state.turn = 8; localStorage.setItem(legacyKey, JSON.stringify(legacyRaw));
  const changedStore = await import('../store.js?old-tab-test'); await changedStore.initStorage();
  check(changedStore.getSave(current.saveId).turn !== 8 && changedStore.listSaves().some(row => row.label === '旧页面产生的进度分支' && row.turn === 8), '旧版本页面产生的新进度另存分支，不覆盖升级后的进度');
  await changedStore.deleteSaveAsync(current.saveId); localStorage.setItem(legacyKey, JSON.stringify(legacyRaw));
  const deletedStore = await import('../store.js?tombstone-test'); await deletedStore.initStorage();
  check(deletedStore.getSave(current.saveId) === null, '删除标记阻止旧页面恢复已删除的进度');
  out.textContent = 'PASS ' + passed.length + '\n' + passed.join('\n'); out.dataset.result = 'pass';
} catch (error) { out.textContent = 'FAIL\n' + error.stack + '\n' + passed.join('\n'); out.dataset.result = 'fail'; }
finally { db?.close(); second?.close(); }
