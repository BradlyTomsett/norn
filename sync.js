// 用 GitHub 仓库当存档云盘：浏览器直接调 Contents API。
// 需要的令牌权限：该仓库的 Contents = Read and write。
const CFG = 'norn.gh';

export function ghConfig() {
  try {
    return JSON.parse(localStorage.getItem(CFG) || 'null') || { owner: '', repo: '', branch: 'main', token: '' };
  } catch {
    return { owner: '', repo: '', branch: 'main', token: '' };
  }
}

export function setGhConfig(cfg) {
  localStorage.setItem(CFG, JSON.stringify({
    owner: String(cfg.owner || '').trim(),
    repo: String(cfg.repo || '').trim(),
    branch: String(cfg.branch || 'main').trim() || 'main',
    token: String(cfg.token || '').trim(),
  }));
}

export const ghReady = () => {
  const c = ghConfig();
  return Boolean(c.owner && c.repo && c.token);
};

const api = (c, path) => `https://api.github.com/repos/${c.owner}/${c.repo}/contents/${path}`;
const headers = (c) => ({
  Authorization: `Bearer ${c.token}`,
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
});

/* base64 与 UTF-8 互转 */
function b64encode(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}
function b64decode(b64) {
  const bin = atob(String(b64).replace(/\s/g, ''));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

async function fail(res) {
  let msg = '';
  try {
    msg = (await res.json())?.message || '';
  } catch {}
  if (res.status === 401) msg = msg || '令牌无效';
  if (res.status === 403) msg = msg || '没有权限（检查 Contents 权限）';
  if (res.status === 404) msg = msg || '找不到仓库或路径';
  return new Error(`${res.status} ${msg}`);
}

/** 测试连接 */
export async function ghTest() {
  const c = ghConfig();
  if (!ghReady()) throw new Error('还没填完 GitHub 配置');
  const res = await fetch(`https://api.github.com/repos/${c.owner}/${c.repo}`, { headers: headers(c) });
  if (!res.ok) throw await fail(res);
  const j = await res.json();
  return { full: j.full_name, private: j.private, defaultBranch: j.default_branch };
}

/** 读一个文件，返回 {text, sha} 或 null */
export async function ghGet(path) {
  const c = ghConfig();
  const res = await fetch(`${api(c, path)}?ref=${encodeURIComponent(c.branch)}`, { headers: headers(c) });
  if (res.status === 404) return null;
  if (!res.ok) throw await fail(res);
  const j = await res.json();
  return { text: b64decode(j.content), sha: j.sha };
}

/** 写一个文件（存在就更新） */
export async function ghPut(path, text, message) {
  const c = ghConfig();
  let sha = null;
  const head = await fetch(`${api(c, path)}?ref=${encodeURIComponent(c.branch)}`, { headers: headers(c) });
  if (head.ok) sha = (await head.json()).sha;
  else if (head.status !== 404) throw await fail(head);

  const body = { message: message || `存档 ${path}`, content: b64encode(text), branch: c.branch };
  if (sha) body.sha = sha;

  const res = await fetch(api(c, path), {
    method: 'PUT',
    headers: { ...headers(c), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw await fail(res);
  return res.json();
}

/** 列目录 */
export async function ghList(dir) {
  const c = ghConfig();
  const res = await fetch(`${api(c, dir)}?ref=${encodeURIComponent(c.branch)}`, { headers: headers(c) });
  if (res.status === 404) return [];
  if (!res.ok) throw await fail(res);
  const j = await res.json();
  return Array.isArray(j) ? j.filter((x) => x.type === 'file') : [];
}

/** 备份一份存档 */
export async function backupSave(state) {
  const path = `saves/${state.saveId}.json`;
  await ghPut(path, JSON.stringify(state, null, 2), `存档 ${state.player.name} · 第 ${state.turn} 回合`);
  localStorage.setItem('norn.gh.last', new Date().toISOString());
  return path;
}

/** 恢复：读回一个存档 */
export async function restoreSave(path) {
  const f = await ghGet(path);
  if (!f) throw new Error('文件不在了');
  return JSON.parse(f.text);
}
