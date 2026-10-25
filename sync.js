import { decodeSave, savePackage, getSave, getLastTurn } from './store.js';
import { sessionOnly } from './llm.js';
import { uiState } from './engine/state.js';
const CFG = 'norn.gh';
export function ghConfig() {
  try { return JSON.parse(sessionStorage.getItem(CFG) || localStorage.getItem(CFG) || 'null') || { owner: '', repo: '', branch: 'main', token: '' }; }
  catch { return { owner: '', repo: '', branch: 'main', token: '' }; }
}
export function setGhConfig(cfg) {
  const target = sessionOnly() ? sessionStorage : localStorage, other = sessionOnly() ? localStorage : sessionStorage;
  target.setItem(CFG, JSON.stringify({ owner: String(cfg.owner || '').trim(), repo: String(cfg.repo || '').trim(),
    branch: String(cfg.branch || 'main').trim(), token: String(cfg.token || '').trim() }));
  other.removeItem(CFG);
}
export const ghReady = () => { const c = ghConfig(); return Boolean(c.owner && c.repo && c.token); };
const api = (c, path = '') => `https://api.github.com/repos/${encodeURIComponent(c.owner)}/${encodeURIComponent(c.repo)}/contents/${path.split('/').map(encodeURIComponent).join('/')}`;
const headers = c => ({ Authorization: `Bearer ${c.token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' });
function b64encode(str) {
  const bytes = new TextEncoder().encode(str); let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
const b64decode = b64 => new TextDecoder().decode(Uint8Array.from(atob(String(b64).replace(/\s/g, '')), ch => ch.charCodeAt(0)));
async function request(url, options = {}) {
  const response = await fetch(url, { ...options, signal: AbortSignal.timeout(30000) });
  return response;
}
async function fail(res) {
  const hint = { 401: '令牌无效', 403: '权限不足或请求过多', 404: '找不到仓库或路径', 409: '云端进度已变化，请恢复或另存分支', 422: '云端版本不一致，请恢复或另存分支' }[res.status];
  return new Error(`${res.status} ${hint || '云端暂时不可用，稍后可重试'}`);
}
export async function ghTest() {
  const c = ghConfig(); if (!ghReady()) throw new Error('还没填完 GitHub 配置');
  const res = await request(`https://api.github.com/repos/${encodeURIComponent(c.owner)}/${encodeURIComponent(c.repo)}`, { headers: headers(c) });
  if (!res.ok) throw await fail(res);
  const j = await res.json(); return { full: j.full_name, private: j.private, defaultBranch: j.default_branch };
}
export async function ghGet(path, config = ghConfig()) {
  const res = await request(`${api(config, path)}?ref=${encodeURIComponent(config.branch)}`, { headers: headers(config) });
  if (res.status === 404) return null;
  if (!res.ok) throw await fail(res);
  const j = await res.json(); return { text: b64decode(j.content), sha: j.sha };
}
export async function ghPut(path, text, message, expectedSha = null, config = ghConfig()) {
  const body = { message: message || `存档 ${path}`, content: b64encode(text), branch: config.branch };
  if (expectedSha) body.sha = expectedSha;
  const res = await request(api(config, path), { method: 'PUT', headers: { ...headers(config), 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!res.ok) throw await fail(res);
  return res.json();
}
export async function ghList(dir) {
  const c = ghConfig(); const res = await request(`${api(c, dir)}?ref=${encodeURIComponent(c.branch)}`, { headers: headers(c) });
  if (res.status === 404) return [];
  if (!res.ok) throw await fail(res);
  const j = await res.json(); return Array.isArray(j) ? j.filter(x => x.type === 'file') : [];
}
export async function ghDelete(path, message) {
  const c = ghConfig(), head = await ghGet(path, c);
  if (!head) throw new Error('文件已不存在');
  const res = await request(api(c, path), { method: 'DELETE', headers: { ...headers(c), 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: message || `删除 ${path}`, sha: head.sha, branch: c.branch }) });
  if (!res.ok) throw await fail(res); return res.json();
}
const queues = new Map();
const baselineKey = (c, id) => `norn.gh.base.${c.owner}/${c.repo}/${c.branch}/${id}`;
function sameProgress(left, right) {
  try {
    const a = structuredClone(left), b = structuredClone(right); uiState(a); uiState(b);
    const stable = value => {
      if (Array.isArray(value)) return value.map(stable);
      if (!value || typeof value !== 'object') return value;
      return Object.fromEntries(Object.keys(value).filter(k => !['updatedAt', 'revision'].includes(k)).sort().map(k => [k, stable(value[k])]));
    };
    return JSON.stringify(stable(a)) === JSON.stringify(stable(b));
  } catch { return false; }
}
export function backupSave(state, messages) {
  const snapshot = structuredClone(state), c = ghConfig();
  const path = `saves/${snapshot.saveId}.json`, key = baselineKey(c, snapshot.saveId);
  const payload = JSON.stringify(savePackage(snapshot, messages || []), null, 2);
  const checkpoint = getSave(snapshot.saveId)?.revision === snapshot.revision ? getLastTurn(snapshot.saveId) : null;
  const run = async () => {
    const head = await ghGet(path, c), expected = localStorage.getItem(key);
    if (head?.text === payload) { localStorage.setItem(key, head.sha); return path; }
    if (head && !expected) {
      let remote;
      try { remote = decodeSave(JSON.parse(head.text)).state; } catch { /* Unknown data must not be overwritten. */ }
      if (!remote || (!sameProgress(remote, snapshot) && !sameProgress(remote, checkpoint?.base))) throw new Error('云端有另一份进度，已保留双方数据。请从云端恢复，或存一个快照后备份该分支。');
    } else if (head && head.sha !== expected) throw new Error('云端有另一份进度，已保留双方数据。请从云端恢复，或存一个快照后备份该分支。');
    if (!head && expected) throw new Error('云端原存档已变化或被删除，请另存分支后备份');
    const result = await ghPut(path, payload, `存档 ${snapshot.player.name} · 第 ${snapshot.turn} 回合`, head?.sha || null, c);
    localStorage.setItem(key, result.content.sha);
    localStorage.setItem('norn.gh.last', new Date().toISOString());
    localStorage.setItem(`norn.gh.last.${snapshot.saveId}`, new Date().toISOString());
    return path;
  };
  const next = (queues.get(key) || Promise.resolve()).catch(() => {}).then(run);
  queues.set(key, next);
  next.finally(() => { if (queues.get(key) === next) queues.delete(key); }).catch(() => {});
  return next;
}
export async function restoreSave(path) {
  const file = await ghGet(path); if (!file) throw new Error('文件不在了');
  const { state, messages } = decodeSave(JSON.parse(file.text));
  return { ...state, messages };
}
