import { upgradeState, SCHEMA_VERSION } from './engine/schema.js';
import { cleanRetiredMessages } from './engine/retired-prices.js';

const IDX = 'norn.index';
const SAVE = id => `norn.save.${id}`;
const MSGS = id => `norn.msgs.${id}`;
const parse = (text, fallback) => { try { return JSON.parse(text) ?? fallback; } catch { return fallback; } };

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
  return readIndex().map(id => {
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
export function getMessages(id) { return cleanRetiredMessages(readRecord(id)?.messages || []); }
export function getPending(id) {
  const pending = readRecord(id)?.pending || null;
  if (pending?.history) pending.history = cleanRetiredMessages(pending.history);
  return pending;
}
export function getLastTurn(id) {
  const turn = readRecord(id)?.lastTurn || null;
  if (turn) { turn.base = upgradeState(turn.base); turn.messages = cleanRetiredMessages(turn.messages); }
  return turn;
}
export function putPending(id, pending) {
  const record = readRecord(id);
  if (!record) throw new Error('找不到存档');
  record.pending = pending;
  writeRecord(id, record);
}
export function putSave(state, messages, options = {}) {
  upgradeState(state);
  const old = readRecord(state.saveId);
  const expected = options.expectedRevision ?? state.revision;
  if (old && (Number(old.state.revision) || 0) !== expected) throw new Error('这份存档已在另一个页面更新，请重新载入或另存分支');
  const next = structuredClone(state);
  next.updatedAt = new Date().toISOString();
  next.revision = (Number(old?.state.revision) || 0) + 1;
  delete next.messages;
  const record = { format: 'norn-save', schemaVersion: SCHEMA_VERSION, state: next,
    messages: messages ?? old?.messages ?? [], pending: options.pending === undefined ? old?.pending || null : options.pending,
    lastTurn: options.lastTurn === undefined ? old?.lastTurn || null : options.lastTurn };
  writeRecord(next.saveId, record);
  state.updatedAt = next.updatedAt; state.revision = next.revision;
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
  putSave(state, messages);
  return state.saveId;
}
