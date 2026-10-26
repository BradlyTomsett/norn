import { upgradeState, SCHEMA_VERSION } from './engine/schema.js';
import { cleanRetiredMessages } from './engine/retired-prices.js';
import { ArchiveStore } from './persistence.js';
import { textId } from './engine/entities.js';

const IDX = 'norn.index';
const SAVE = id => `norn.save.${id}`;
const MSGS = id => `norn.msgs.${id}`;
const parse = (text, fallback) => { try { return JSON.parse(text) ?? fallback; } catch { return fallback; } };
let archive = null, initialization;
const records = new Map(), histories = new Map(), queues = new Map();
const queued = (id, run) => {
  const next = (queues.get(id) || Promise.resolve()).catch(() => {}).then(run);
  queues.set(id, next);
  next.finally(() => { if (queues.get(id) === next) queues.delete(id); }).catch(() => {});
  return next;
};

function compact(record, messages) {
  const out = { ...record }; delete out.messages;
  for (const key of ['pending', 'lastTurn']) {
    const field = key === 'pending' ? 'history' : 'messages', row = out[key] && { ...out[key] };
    if (!row || !Array.isArray(row[field])) continue;
    out[key] = row;
    const source = row[field];
    if (source.every((message, index) => JSON.stringify(message) === JSON.stringify(messages[index]))) {
      row.historyCount = source.length; delete row[field];
    }
  }
  return structuredClone(out);
}

function cacheRecord(id, record) {
  const old = records.get(id);
  if (old && (old.state?.revision !== record.state?.revision || old.messageCount !== record.messageCount)) histories.delete(id);
  records.set(id, record);
}

async function ensureMessages(id) {
  if (!archive) return;
  const latest = await archive.get(id); if (latest) cacheRecord(id, latest);
  if (!histories.has(id)) histories.set(id, cleanRetiredMessages(await archive.messages(id)));
}

export async function initStorage() {
  if (initialization) return initialization;
  if (!globalThis.indexedDB) return { mode: 'compatibility' };
  initialization = (async () => {
    const db = await new ArchiveStore().open();
    const existing = new Map((await db.list()).map(row => [row.id, row]));
    for (const id of readIndex()) {
      const legacy = readRecord(id), raw = localStorage.getItem(SAVE(id));
      if (!legacy || !raw || existing.get(id)?.deleted) continue;
      const fingerprint = textId(raw), old = existing.get(id);
      if (old?.legacyFingerprint === fingerprint) continue;
      const state = upgradeState(structuredClone(legacy.state)), messages = cleanRetiredMessages(legacy.messages || []);
      let targetId = id;
      if (old) {
        targetId = newId(); state.snapshotOf = id; state.lineageId ||= id;
        state.saveId = targetId; state.revision = 0; state.label = '旧页面产生的进度分支';
      }
      const record = await db.commit(targetId, { state, migration: true, expectedRevision: 0,
        patch: { ...compact(legacy, messages), legacyFingerprint: old ? undefined : fingerprint }, tail: { start: 0, messages } });
      existing.set(targetId, record); histories.set(targetId, messages);
      if (old) existing.set(id, await db.commit(id, { patch: { legacyFingerprint: fingerprint } }));
    }
    archive = db;
    records.clear(); for (const [id, row] of existing) records.set(id, row);
    return { mode: 'expanded' };
  })().catch(error => { initialization = null; throw error; });
  return initialization;
}

export async function loadMessages(id) {
  await ensureMessages(id);
  return getMessages(id);
}
export function storageInfo(id) { return { mode: archive ? '扩展存储' : '兼容存储', messages: archive ? records.get(id)?.messageCount || 0 : getMessages(id).length }; }

function readIndex() {
  const ids = new Set(parse(localStorage.getItem(IDX), []));
  // A failed index write cannot orphan an otherwise successfully saved game.
  for (let i = 0; i < (localStorage.length || 0); i++) {
    const key = localStorage.key(i);
    if (key?.startsWith('norn.save.')) ids.add(key.slice('norn.save.'.length));
  }
  return [...ids];
}
function readRecord(id) {
  if (archive) {
    const raw = records.get(id); if (!raw || raw.deleted) return null;
    const record = structuredClone(raw); record.messages = histories.get(id) || [];
    return record;
  }
  const raw = parse(localStorage.getItem(SAVE(id)), null);
  if (!raw) return null;
  if (raw.format === 'norn-save') return raw;
  return { format: 'norn-save', schemaVersion: SCHEMA_VERSION, state: raw,
    messages: Array.isArray(raw.messages) ? raw.messages : parse(localStorage.getItem(MSGS(id)), []), pending: null, lastTurn: null };
}
function writeRecord(id, record) {
  record.messages = cleanRetiredMessages(record.messages);
  // State, narration, checkpoint and pending status are ONE atomic storage value.
  localStorage.setItem(SAVE(id), JSON.stringify(record));
  try { localStorage.removeItem(MSGS(id)); } catch { /* Legacy duplicate cleanup is optional. */ }
  try { localStorage.setItem(IDX, JSON.stringify([...new Set([id, ...readIndex()])])); } catch { /* Discoverable through the key scan. */ }
}
export function listSaves() {
  return (archive ? [...records.keys()] : readIndex()).map(id => {
    const s = getSave(id);
    return s ? { id, name: s.player.name, age: s.player.age, turn: s.turn, place: s.player.location.siteName,
      label: s.label || null, updatedAt: s.updatedAt || s.createdAt } : null;
  }).filter(Boolean).sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
}
export function getSave(id) {
  const record = readRecord(id);
  if (!record) return null;
  return upgradeState(record.state);
}
export function getMessages(id, { offset = 0, limit = Infinity } = {}) {
  const rows = archive ? histories.get(id) || [] : cleanRetiredMessages(readRecord(id)?.messages || []);
  return structuredClone(rows.slice(offset, offset + limit));
}
export function getPending(id) {
  const pending = readRecord(id)?.pending || null;
  if (pending?.history) pending.history = cleanRetiredMessages(pending.history);
  if (pending?.historyCount != null) pending.history = getMessages(id, { limit: pending.historyCount });
  return pending;
}
export function getLastTurn(id) {
  const turn = readRecord(id)?.lastTurn || null;
  if (turn) { turn.base = upgradeState(turn.base); turn.messages = cleanRetiredMessages(turn.messages); }
  if (turn?.historyCount != null) turn.messages = getMessages(id, { limit: turn.historyCount });
  return turn;
}
export function putPending(id, pending) {
  const record = readRecord(id);
  if (!record) throw new Error('找不到存档');
  record.pending = pending;
  writeRecord(id, record);
}
export function putSave(state, messages, options = {}) {
  if (archive) throw new Error('请使用可确认完成的异步保存。');
  upgradeState(state);
  const old = readRecord(state.saveId);
  const expected = options.expectedRevision ?? state.revision;
  if (old && (Number(old.state.revision) || 0) !== expected) throw new Error('这份存档已在另一个页面更新，请重新载入或另存分支');
  const next = structuredClone(state);
  next.updatedAt = new Date().toISOString();
  next.revision = (Number(old?.state.revision) || 0) + 1;
  delete next.messages;
  const record = { format: 'norn-save', schemaVersion: SCHEMA_VERSION, state: next,
    diagnostics: old?.diagnostics || [],
    messages: messages ?? old?.messages ?? [], pending: options.pending === undefined ? old?.pending || null : options.pending,
    lastTurn: options.lastTurn === undefined ? old?.lastTurn || null : options.lastTurn };
  writeRecord(next.saveId, record);
  state.updatedAt = next.updatedAt; state.revision = next.revision;
}

export async function putSaveAsync(state, messages, options = {}) {
  if (!archive) return putSave(state, messages, options);
  const snapshot = upgradeState(structuredClone(state)), id = snapshot.saveId;
  const expectedRevision = options.expectedRevision ?? snapshot.revision;
  return queued(id, async () => {
    await ensureMessages(id);
    const old = records.get(id), previous = histories.get(id) || [];
    const nextMessages = messages === undefined ? previous : options.replaceFrom != null
      ? [...previous.slice(0, options.replaceFrom), ...cleanRetiredMessages(messages.slice(options.replaceFrom))] : cleanRetiredMessages(messages);
    let start = options.replaceFrom ?? 0;
    if (messages !== undefined && options.replaceFrom == null) while (start < previous.length && start < nextMessages.length
      && JSON.stringify(previous[start]) === JSON.stringify(nextMessages[start])) start++;
    const patch = compact({
      pending: options.pending === undefined ? old?.pending || null : options.pending,
      lastTurn: options.lastTurn === undefined ? old?.lastTurn || null : options.lastTurn,
    }, nextMessages);
    const record = await archive.commit(id, { state: snapshot, expectedRevision, patch,
      tail: messages === undefined ? undefined : { start, messages: nextMessages.slice(start) } });
    records.set(id, record); histories.set(id, nextMessages);
    state.updatedAt = record.state.updatedAt; state.revision = record.state.revision;
  });
}

export async function putPendingAsync(id, pending) {
  if (!archive) return putPending(id, pending);
  const snapshot = structuredClone(pending);
  return queued(id, async () => {
    const patch = compact({ pending: snapshot }, histories.get(id) || []);
    const record = await archive.commit(id, { expectedRevision: snapshot?.baseRevision, patch });
    cacheRecord(id, record);
  });
}

export async function deleteSaveAsync(id) {
  if (!archive) return deleteSave(id);
  return queued(id, async () => {
    records.set(id, await archive.commit(id, { remove: true })); histories.delete(id);
    try { localStorage.removeItem(SAVE(id)); localStorage.removeItem(MSGS(id)); } catch { /* The tombstone prevents remigration. */ }
  });
}

export function getDiagnostics(id) { return structuredClone(readRecord(id)?.diagnostics || []); }
export async function recordDiagnostic(id, entry) {
  const safe = Object.fromEntries(['turn', 'durationMs', 'firstTokenMs', 'requests', 'repairs', 'promptTokens', 'completionTokens', 'cachedTokens', 'outputChars']
    .filter(key => Number.isFinite(entry[key]) && entry[key] >= 0).map(key => [key, Math.round(entry[key])]));
  if (['saved', 'failed', 'cancelled'].includes(entry.outcome)) safe.outcome = entry.outcome;
  if (['generation', 'validation', 'storage', 'cancelled', 'cloud'].includes(entry.category)) safe.category = entry.category;
  safe.savedAt = new Date().toISOString();
  if (!archive) {
    const record = readRecord(id); if (!record) return;
    record.diagnostics = [...record.diagnostics || [], safe].slice(-100); writeRecord(id, record); return;
  }
  return queued(id, async () => {
    const latest = await archive.get(id); if (!latest || latest.deleted) return;
    const record = await archive.commit(id, { patch: { diagnostics: [...latest.diagnostics || [], safe].slice(-100) } });
    cacheRecord(id, record);
  });
}
export function appendMessage(id, role, content) {
  const record = readRecord(id);
  if (!record) throw new Error('找不到存档');
  record.messages.push({ role, content });
  writeRecord(id, record);
}
export function deleteSave(id) {
  localStorage.removeItem(SAVE(id)); localStorage.removeItem(MSGS(id));
  localStorage.setItem(IDX, JSON.stringify(readIndex().filter(x => x !== id)));
}
export function newId() {
  return 'sv_' + (globalThis.crypto?.randomUUID?.().replaceAll('-', '') || Math.random().toString(36).slice(2));
}
export function savePackage(state, messages = getMessages(state.saveId)) {
  return { format: 'norn-save', schemaVersion: SCHEMA_VERSION, state: upgradeState(structuredClone(state)), messages: cleanRetiredMessages(messages) };
}
export function exportSave(state) {
  const blob = new Blob([JSON.stringify(savePackage(state), null, 2)], { type: 'application/json' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
  a.download = `norn-${state.player.name}-${state.saveId}.json`; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
export function decodeSave(payload) {
  if (payload.schemaVersion > SCHEMA_VERSION) throw new Error('存档版本较新，请先更新游戏');
  const state = structuredClone(payload.format === 'norn-save' ? payload.state : payload);
  if (typeof state?.player?.name !== 'string' || !state.player.name.trim() || !state.clock) throw new Error('不是有效的存档');
  const c = state.clock;
  if (![c.year, c.doy, c.hour, c.minute].every(Number.isInteger) || c.doy < 1 || c.doy > 365 || c.hour < 0 || c.hour > 23 || c.minute < 0 || c.minute > 59) throw new Error('存档的日历无效');
  const messages = payload.messages || state.messages || [];
  if (!Array.isArray(messages) || messages.some(m => !['user', 'assistant', 'system'].includes(m.role) || typeof m.content !== 'string')) throw new Error('存档的对话记录无效');
  delete state.messages;
  return { state: upgradeState(state), messages: cleanRetiredMessages(messages) };
}
export async function importSave(file) {
  const { state, messages } = decodeSave(JSON.parse(await file.text()));
  state.snapshotOf = state.saveId; state.lineageId ||= state.saveId;
  state.saveId = newId(); state.revision = 0;
  state.createdAt = new Date().toISOString(); state.label ||= '导入的存档';
  await putSaveAsync(state, messages);
  return state.saveId;
}
