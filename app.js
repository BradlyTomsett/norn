import * as store from './store.js';
import * as llm from './llm.js';
import * as sync from './sync.js';
import { REGIONS, generateWorld, openingText } from './engine/worldgen.js';
import { stateBlock, npcCards, uiState, transferCopper, copperText } from './engine/state.js';
import { isCorrection } from './engine/resolve.js';
import { prepareTurn } from './engine/turn.js';
import { extractChoices } from './engine/actions.js';
import { settleReply } from './engine/reply.js';
import { buildPrompt } from './engine/protocol.js';
import { esc, format, splitDelta } from './format.js';
import { messageParts, narrationText, stripSettlement } from './messages.js';
import { chronicleDue, mergeChronicle, parseChronicle } from './engine/chronicle.js';
import { addItem, removeItem, gradeOfName, stripGrade, composeName, normalizeItems } from './engine/items.js';
import { gamePriceEntry } from './engine/economy.js';
import { isRetiredPostalQuote } from './engine/retired-prices.js';
import { ensureAssets } from './engine/assets.js';
import { VIEWS } from './views.js';
import { BUILD } from './build.js';
import { ambiguousPeople, entityRefs } from './engine/entities.js';
import { recallHistory } from './engine/memory.js';
import { applyTasks } from './engine/tasks.js';
import { searchArchive } from './search.js';
import { validateLoadout, gearInventory, weaponSlots } from './engine/equipment.js';
const listOf = v => !v ? [] : Array.isArray(v) ? v : [v];
const $ = s => document.querySelector(s);
const logEl = $('#log'), inputEl = $('#input'), sendEl = $('#send'), composerEl = $('#composer'), dateEl = $('#date');
const app = { saveId: null, ui: null, messages: [], regions: REGIONS,
  picked: { regionId: null, family: null, gender: 'male' }, streaming: false, tab: 'overview', rules: '', worldbook: '', controller: null };
const busy = () => app.streaming || app.preparing;
const reportActionError = error => addMessage('error', '操作没有保存：' + (error?.message || String(error)));
const runAction = action => Promise.resolve().then(action).catch(reportActionError);
window.addEventListener('unhandledrejection', event => { event.preventDefault(); reportActionError(event.reason || new Error('操作未完成')); });
document.addEventListener('click', event => {
  if (busy() && event.target.closest('#btn-saves, #btn-save-now, #btn-panel, .turn-actions, #sheet, #saves, #wizard, #custom, #restore')) {
    event.preventDefault(); event.stopImmediatePropagation(); turnStatus('请等当前回合结束，或先停止生成。');
  }
}, true);
async function loadPrompts() {
  const read = async path => { try { const res = await fetch(path); return res.ok ? await res.text() : ''; } catch { return ''; } };
  [app.rules, app.worldbook] = await Promise.all([read('prompt/rules.md'), read('prompt/worldbook.md')]);
}
const buildSystem = (state, judged, events, opts = {}) => buildPrompt(state, judged, events,
  { rules: app.rules, worldbook: app.worldbook, ...opts });

/* ---------------- 渲染 ---------------- */

function scrollToEnd() {
  logEl.scrollTop = logEl.scrollHeight;
}

function scrollToElement(el, pad = 8) {
  if (!el) return;
  const top = el.getBoundingClientRect().top - logEl.getBoundingClientRect().top + logEl.scrollTop - pad;
  logEl.scrollTop = Math.max(0, top);
}

function renderMessageBody(el, message) {
  const parts = messageParts(message);
  el.innerHTML = format(parts.text);
  if (parts.receipt) {
    const receipt = document.createElement('section'); receipt.className = 'turn-receipt';
    receipt.setAttribute('aria-label', '实际结算');
    const title = document.createElement('p'); title.className = 'sec'; title.textContent = '【实际结算】'; receipt.append(title);
    for (const line of parts.receipt.split('\n')) {
      const row = document.createElement('p'); row.textContent = line; receipt.append(row);
    }
    el.append(receipt);
  }
}

function addMessage(role, text, receipt) {
  const el = document.createElement('div');
  el.className = 'msg ' + (role === 'user' ? 'me' : role === 'error' ? 'err' : '');
  renderMessageBody(el, { role, content: text, receipt });
  logEl.appendChild(el);
  if (role !== 'assistant') scrollToEnd();
  return el;
}

/* ---------------- 右侧快速索引 ---------------- */

function markTocActive(tick) {
  const rail = $('#toc');
  if (!rail) return;
  for (const t of rail.children) t.classList.toggle('on', t === tick);
}

function renderToc() {
  const rail = $('#toc');
  if (!rail) return;
  const msgs = Array.from(logEl.querySelectorAll('.msg'));
  rail.innerHTML = '';
  if (msgs.length < 6) {
    rail.classList.add('hidden');
    return;
  }
  rail.classList.remove('hidden');
  msgs.forEach((el, i) => {
    const tick = document.createElement('i');
    if (el.classList.contains('me')) tick.classList.add('me');
    tick.title = `第 ${i + 1} 条`;
    tick.addEventListener('click', (e) => {
      e.stopPropagation();
      scrollToElement(el);
      markTocActive(tick);
    });
    rail.appendChild(tick);
  });
  markTocActive(rail.lastElementChild);
}

let tocFrame = null;

function updateTocActive() {
  const rail = $('#toc');
  if (!rail || rail.classList.contains('hidden')) return;
  const msgs = Array.from(logEl.querySelectorAll('.msg'));
  if (!msgs.length) return;
  const top = logEl.getBoundingClientRect().top + 40;
  let idx = 0;
  msgs.forEach((el, i) => {
    if (el.getBoundingClientRect().top <= top) idx = i;
  });
  markTocActive(rail.children[idx]);
}

logEl.addEventListener(
  'scroll',
  () => {
    if (tocFrame) return;
    tocFrame = requestAnimationFrame(() => {
      tocFrame = null;
      updateTocActive();
    });
  },
  { passive: true },
);

/* ---------------- 开局 ---------------- */

const FAMILY_LABEL = {
  npc_farmer: '农户', npc_miller: '磨坊工', npc_apprentice: '学徒', npc_orphan: '孤儿',
  npc_miner: '矿工', npc_smith_apprentice: '锻工学徒', npc_ferryman: '渡夫', npc_peddler: '行商',
  npc_fisher: '渔户', npc_docker: '脚夫', npc_clerk: '账房学徒',
};

async function openWizard() {
  composerEl.classList.add('hidden');
  $('#wizard').classList.remove('hidden');
  $('#step2').classList.add('hidden');
  logEl.innerHTML = '';
  const box = $('#regions');
  box.innerHTML = '';
  for (const r of app.regions) {
    const btn = document.createElement('button');
    btn.className = 'card';
    btn.innerHTML = `<b>${esc(r.name)}</b>
      <span>${esc(r.title)} · 人口约 ${r.population.toLocaleString()}</span>
      <span>${esc(r.terrain)}</span>
      <span>${esc(r.economy)}</span>
      <span>${esc(r.politics)}</span>
      <span class="risk">风险：${esc(r.risk)}</span>`;
    btn.onclick = async () => {
      app.picked.regionId = r.id;
      [...box.children].forEach((c) => c.classList.remove('selected'));
      btn.classList.add('selected');
      renderFamilies(r);
      $('#step2').classList.remove('hidden');
      $('#step2').scrollIntoView({ behavior: 'smooth', block: 'start' });
    };
    box.appendChild(btn);
  }
}

function renderFamilies(region) {
  const box = $('#families');
  box.innerHTML = '';
  for (const f of region.families) {
    const b = document.createElement('button');
    b.className = 'chip';
    b.textContent = FAMILY_LABEL[f] || f;
    b.onclick = async () => {
      app.picked.family = f;
      [...box.children].forEach((c) => c.classList.remove('selected'));
      b.classList.add('selected');
    };
    box.appendChild(b);
  }
  app.picked.family = region.families[0];
  box.children[0]?.classList.add('selected');
}

$('#genders').addEventListener('click', (e) => {
  const b = e.target.closest('.chip');
  if (!b) return;
  app.picked.gender = b.dataset.gender;
  [...$('#genders').children].forEach((c) => c.classList.remove('selected'));
  b.classList.add('selected');
});

$('#start').onclick = async () => {
  if (!app.picked.regionId) return;
  const seed = Math.floor(Math.random() * 1e9);
  const { state, family, region } = generateWorld({
    regionId: app.picked.regionId,
    familyKey: app.picked.family,
    name: $('#name').value.trim(),
    gender: app.picked.gender,
    seed,
  });
  state.saveId = store.newId();
  state.updatedAt = new Date().toISOString();
  state.prices = {};
  state.rates = {};
  const opening = openingText(state, family, region);
  await store.putSaveAsync(state, [{ role: 'assistant', content: opening }]);

  await loadGame(state.saveId);
};

/* ---------------- 字号 ---------------- */

const FONT_KEY = 'norn.font';

function currentFont() {
  const v = Number(localStorage.getItem(FONT_KEY));
  return Number.isFinite(v) && v >= 0.8 && v <= 1.6 ? v : 1;
}

function markFontChip(scale) {
  for (const b of document.querySelectorAll('#font-chips .chip')) {
    b.classList.toggle('selected', Math.abs(Number(b.dataset.font) - scale) < 0.01);
  }
}

function applyFont(v, persist = true) {
  const s = Math.min(1.6, Math.max(0.8, Number(v) || 1));
  document.documentElement.style.setProperty('--font-scale', String(s));
  if (persist) localStorage.setItem(FONT_KEY, String(s));
  markFontChip(s);
}

document.addEventListener('click', async (e) => {
  const b = e.target.closest('#font-chips .chip');
  if (!b) return;
  applyFont(b.dataset.font);
});

applyFont(currentFont(), false);

/* ---------------- 载入 / 存档 ---------------- */

async function loadGame(id, { allowDuringTurn = false, focusIndex = null } = {}) {
  if (busy() && !allowDuringTurn) { turnStatus('请等当前回合结束后再切换存档。'); return; }
  await store.loadMessages(id);
  const state = store.getSave(id);
  if (!state) return openWizard();
  app.saveId = id; app.loadedRevision = state.revision;
  app.ui = uiState(state); app.messages = store.getMessages(id);
  for (const panel of ['#menu', '#wizard', '#custom', '#saves', '#restore', '#settings', '#sheet', '#search']) $(panel).classList.add('hidden');
  $('#menu-load').disabled = false; $('#menu-load').style.opacity = '1';
  composerEl.classList.remove('hidden'); logEl.innerHTML = '';
  const end = focusIndex == null ? app.messages.length : Math.min(app.messages.length, focusIndex + 16);
  let start = Math.max(0, (focusIndex == null ? end : focusIndex) - (focusIndex == null ? 60 : 15));
  let last = null, focus = null;
  const renderRow = (m, index) => {
    const el = document.createElement('div'); el.className = 'msg ' + (m.role === 'user' ? 'me' : '');
    renderMessageBody(el, m); el.dataset.messageIndex = index;
    if (index === focusIndex) { focus = el; el.classList.add('history-focus'); }
    return el;
  };
  if (start > 0) {
    const older = document.createElement('button'); older.className = 'ghost'; older.textContent = '显示更早记录';
    older.onclick = () => {
      const next = Math.max(0, start - 60), fragment = document.createDocumentFragment();
      for (let i = next; i < start; i++) fragment.append(renderRow(app.messages[i], i));
      older.after(fragment); start = next; if (!start) older.remove(); renderToc();
    };
    logEl.append(older);
  }
  for (let i = start; i < end; i++) {
    if (!String(app.messages[i].content || '').trim()) continue;
    last = renderRow(app.messages[i], i); logEl.append(last);
  }
  if (focusIndex != null) {
    const latest = document.createElement('button'); latest.className = 'action-choice'; latest.textContent = '回到最新记录';
    latest.onclick = () => runAction(() => loadGame(id)); logEl.append(latest);
    composerEl.classList.add('hidden');
  } else {
    if (app.messages.at(-1)?.role === 'user') addMessage('error', '上一条消息没有收到回复，可以重试本回合。');
    if (last && store.getLastTurn(id)) turnButtons(last);
    if (last && app.messages.at(-1)?.role === 'assistant') renderChoices(last, app.messages.at(-1));
  }
  renderSheet(); renderToc(); showPending();
  if (focus || last) scrollToElement(focus || last); else scrollToEnd();
}

function renderChoices(bubble, message) {
  const choices = extractChoices(message.content); if (!choices.length) return;
  for (const row of bubble.querySelectorAll('p')) if (/^[①-⑳]|^\d{1,2}[.、．)）]/.test(row.textContent.trim())) row.remove();
  const box = document.createElement('div'); box.className = 'action-choices'; box.setAttribute('aria-label', '可选行动');
  for (const choice of choices) {
    const button = document.createElement('button'); button.className = 'action-choice'; button.textContent = choice.number + ' · ' + choice.text;
    button.disabled = Boolean(busy()); button.onclick = () => { inputEl.value = String(choice.number); send(); }; box.append(button);
  }
  bubble.append(box);
}

function renderSaves() {
  const list = store.listSaves();
  const box = $('#save-list');
  box.innerHTML = '';
  if (!list.length) {
    box.innerHTML = '<p class="hint">还没有存档。</p>';
    return;
  }
  for (const s of list) {
    const card = document.createElement('button');
    card.className = 'card' + (s.id === app.saveId ? ' selected' : '');
    const tag = s.label ? `<span>「${esc(s.label)}」</span>` : '';
    card.innerHTML = `<b>${esc(s.name || '无名')}${s.id === app.saveId ? ' · 当前' : ''}</b>
      <span>${esc(s.place || '')} · ${s.age ?? '?'} 岁 · 第 ${s.turn ?? 0} 回合</span>${tag}`;
    card.onclick = async () => {
      $('#saves').classList.add('hidden');
      await loadGame(s.id);
    };
    box.appendChild(card);
  }
}

$('#btn-saves').onclick = () => {
  renderSaves();
  markFontChip(currentFont());
  updateGhStatus();
  $('#saves').classList.remove('hidden');
};
$('#btn-saves-close').onclick = () => $('#saves').classList.add('hidden');

$('#btn-snap').onclick = async () => {
  if (!app.saveId) return alert('先开始一局。');
  const s = store.getSave(app.saveId);
  const copy = JSON.parse(JSON.stringify(s));
  copy.saveId = store.newId();
  copy.label = `${s.player.name} · ${s.player.age} 岁 · 第 ${s.turn} 回合`;
  copy.snapshotOf = app.saveId;
  await store.putSaveAsync(copy, store.getMessages(app.saveId));
  renderSaves();
  alert('已存快照。');
};

$('#btn-export').onclick = () => {
  if (!app.saveId) return alert('先开始一局。');
  store.exportSave(store.getSave(app.saveId));
};

$('#btn-import').onclick = () => $('#import-file').click();
$('#import-file').onchange = async (e) => {
  const f = e.target.files?.[0];
  if (!f) return;
  try {
    const id = await store.importSave(f);
    await loadGame(id);
    $('#saves').classList.add('hidden');
  } catch (err) {
    alert('导入失败：' + err.message);
  } finally {
    e.target.value = '';
  }
};

/* ---------------- 设置 ---------------- */

function openSettings() {
  $('#set-key').value = llm.getKey();
  $('#set-session-only').checked = llm.sessionOnly();
  $('#set-model').value = llm.getModel();
  for (const b of $('#set-effort').children) b.classList.toggle('selected', b.dataset.effort === llm.getEffort());
  const gh = sync.ghConfig();
  $('#set-gh-repo').value = gh.owner && gh.repo ? `${gh.owner}/${gh.repo}` : '';
  $('#set-gh-branch').value = gh.branch || 'main';
  $('#set-gh-token').value = gh.token || '';
  $('#set-gh-msg').textContent = sync.ghReady() ? '已配置。' : '';
  showBuildInfo();
  renderContract();
  $('#settings').classList.remove('hidden');
}

/** 当前委托：显示名字与酬劳，可直接改。 */
function renderContract() {
  const box = $('#contract-box');
  if (!box) return;
  const state = store.getSave(app.saveId);
  const c = state?.player?.contract;
  if (!c) {
    box.innerHTML = '<p class="hint">现在手上没有接下的活。</p>';
    return;
  }
  box.innerHTML =
    `<div class="price-row"><span class="nm">${esc(c.label)}</span>` +
    `<input id="contract-pay" type="number" min="1" step="1" inputmode="numeric" value="${Math.round(Number(c.copper) || 0)}" /></div>` +
    `<div class="chips" style="margin-top:8px"><button id="btn-contract-save" class="chip">保存酬劳</button></div>`;
  const btn = $('#btn-contract-save');
  if (btn) {
    btn.onclick = async () => {
      const st = store.getSave(app.saveId);
      if (!st?.player?.contract) return;
      const v = Math.round(Number($('#contract-pay')?.value) || 0);
      if (v <= 0) return;
      st.player.contract.copper = v;
      const contract = st.player.contracts.find(c => c.id === st.player.contract.id);
      if (contract) contract.copper = v;
      await store.putSaveAsync(st);
      app.ui = uiState(st);
      renderContract();
    };
  }
};

/** 把看得懂的关键数据拼成一段文本，方便贴给作者排查。 */
async function buildDiagnostics() {
  const state = store.getSave(app.saveId); if (!state) return '没有打开的存档。';
  const info = store.storageInfo(app.saveId), rows = store.getDiagnostics(app.saveId);
  return [`版本 ${BUILD}｜第 ${state.turn} 回合`,
    `本机：${info.mode}｜历史消息 ${info.messages} 条｜待提交回合：${store.getPending(app.saveId) ? '有' : '无'}`,
    '最近回合（耗时/首字为毫秒；用量单位为 token）：',
    ...rows.slice(-20).map(row => JSON.stringify(row)),
    '用量以服务返回值为准，缺失表示服务未提供。诊断不含密钥、对话原文或请求内容。'].join('\n');
}

$('#btn-diag').onclick = async () => {
  const text = await buildDiagnostics();
  const box = $('#diag-out');
  if (box) {
    box.textContent = text;
    box.classList.remove('hidden');
  }
  try {
    await navigator.clipboard.writeText(text);
    if (box) box.insertAdjacentHTML('beforebegin', '<p class="hint">已复制到剪贴板，直接粘给作者即可。</p>');
  } catch {
    if (box) box.insertAdjacentHTML('beforebegin', '<p class="hint">复制失败，手动选中下面这段。</p>');
  }
};

/** 显示当前缓存的版本号（sw 的 CACHE 名）。 */
async function showBuildInfo() {
  const el = $('#build-info');
  if (!el) return;
  let ver = '';
  try {
    if ('caches' in window) {
      const keys = await caches.keys();
      ver = keys.find((k) => k.startsWith('norn-')) || '';
    }
  } catch {
    /* 忽略 */
  }
  const mode =
    window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true
      ? '桌面图标模式'
      : '浏览器标签页';
  el.textContent = `${ver || '未缓存'} · ${mode}`;
}

$('#btn-check-update').onclick = async () => {
  const el = $('#build-info');
  if (app.streaming) { if (el) el.textContent = '正在生成，本回合结束后再更新。'; return; }
  if (el) el.textContent = '检查中…';
  try {
    if ('serviceWorker' in navigator) {
      const reg = await navigator.serviceWorker.getRegistration();
      if (reg) { await reg.update(); offerUpdate(reg); }
    }
    if (el) el.textContent = `${BUILD} · 已检查更新`;
  } catch {
    if (el) el.textContent = '暂时无法检查更新，现有进度仍保存在本机。';
  }
};

$('#set-gh-test').onclick = async () => {
  saveGhFromForm();
  $('#set-gh-msg').textContent = '测试中…';
  try {
    const r = await sync.ghTest();
    $('#set-gh-msg').textContent = `连接成功：${r.full}（${r.private ? '私有' : '公开'}）`;
  } catch (e) {
    $('#set-gh-msg').textContent = '失败：' + e.message;
  }
};

function saveGhFromForm() {
  const repo = $('#set-gh-repo').value.trim();
  const [owner, name] = repo.split('/');
  sync.setGhConfig({
    owner: owner || '',
    repo: name || '',
    branch: $('#set-gh-branch').value.trim() || 'main',
    token: $('#set-gh-token').value.trim(),
  });
}

/* ---------------- 安装到桌面（PWA） ---------------- */
let installEvent = null;

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  installEvent = e;
});

window.addEventListener('appinstalled', () => {
  installEvent = null;
  const b = $('#btn-install');
  if (b) b.textContent = '已安装';
});

$('#btn-install').onclick = async () => {
  const standalone =
    window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
  if (standalone) {
    alert('已经在桌面模式下运行：从手机桌面的「诺恩」图标点进来就是这样。');
    return;
  }
  if (installEvent) {
    installEvent.prompt();
    const { outcome } = await installEvent.userChoice;
    installEvent = null;
    if (outcome === 'accepted') {
      $('#btn-install').textContent = '已安装';
      return;
    }
  }
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
  alert(
    ios
      ? '在 Safari 里点底部「分享」按钮 → 往下找「添加到主屏幕」→「添加」。桌面就会出现「诺恩」图标。'
      : '两种方式：① 右上角「⋮」→「安装应用」；② 若提示「无法打开此应用」，改用「⋮」→「添加到主屏幕」，或用 Firefox / Edge 打开后选「添加到主屏幕」。都只需一次，之后点桌面图标直接进。',
  );
};

$('#btn-settings').onclick = openSettings;
$('#set-effort').addEventListener('click', (e) => {
  const b = e.target.closest('.chip');
  if (!b) return;
  [...$('#set-effort').children].forEach((c) => c.classList.remove('selected'));
  b.classList.add('selected');
});
$('#set-save').onclick = () => {
  llm.setSessionOnly($('#set-session-only').checked);
  llm.setKey($('#set-key').value);
  llm.setModel($('#set-model').value);
  const sel = $('#set-effort').querySelector('.selected');
  if (sel) llm.setEffort(sel.dataset.effort);
  saveGhFromForm();
  $('#settings').classList.add('hidden');
  updateGhStatus();
  alert('已保存。');
};
$('#set-close').onclick = () => $('#settings').classList.add('hidden');

/* ---------------- 一回合 ---------------- */

/* ---------------- 一回合：草稿 → 验证 → 原子提交 ---------------- */
function turnStatus(text = '') {
  const el = $('#turn-status');
  el.textContent = text; el.classList.toggle('hidden', !text);
}
function showPending() {
  const pending = store.getPending(app.saveId);
  if (!pending) { turnStatus(); return; }
  const el = $('#turn-status'); el.classList.remove('hidden'); el.textContent = '有一回合尚未提交，进度保持原样。 ';
  const retry = document.createElement('button'); retry.textContent = '重试本回合'; retry.onclick = () => send({ retry: true }); el.append(retry);
}
function turnButtons(bubble) {
  const actions = document.createElement('div'); actions.className = 'turn-actions';
  for (const [label, action] of [['纠正上一回合', () => { inputEl.value = '/纠错 '; inputEl.focus(); }],
    ['从这里另开分支', async () => { const s = store.getSave(app.saveId); const oldId = s.saveId; s.snapshotOf = oldId; s.lineageId ||= oldId; s.saveId = store.newId(); s.revision = 0; s.label = '剧情分支'; await store.putSaveAsync(s, store.getMessages(oldId)); await loadGame(s.saveId); }]]) {
    const button = document.createElement('button'); button.textContent = label; button.onclick = action; actions.append(button);
  }
  bubble.append(actions);
}
async function recoverDelta(raw, plan, error = '') {
  const system = buildSystem(plan.state, plan.judged, plan.events, { query: plan.text }) +
    '\n你现在只修复变化数据，只输出一个 json 代码块。依据玩家原行动、当前状态与已写出的叙事，不能增加、删除或改变交易金额、数量、收付款对象，也不能重写剧情。没有证据的金额不能猜。已有人物必须使用原 id 和 npcUpdates，不要重复登记或覆盖不同身份。\n验证问题：' + error;
  app.metrics && app.metrics.repairs++;
  let out = '';
  for await (const chunk of trackedChat({ system, messages: [{ role: 'user', content: `原行动：${plan.text}\n待修复的本回合输出：\n${raw}` }],
    maxTokens: 3000, temperature: 0.2, signal: app.controller.signal })) out += chunk;
  const delta = splitDelta(out).delta;
  if (!delta) throw new Error('回复缺少有效变化块，请重试本回合');
  return delta;
}
async function* trackedChat(options) {
  if (app.metrics) app.metrics.requests++;
  for await (const chunk of llm.streamChat({ ...options, onUsage: usage => {
    if (app.metrics) for (const [key, value] of Object.entries(usage)) app.metrics[key] = (app.metrics[key] || 0) + value;
  } })) yield chunk;
}
async function recoverAgency(raw, plan, error) {
  if (app.metrics) app.metrics.repairs++;
  turnStatus('回复替玩家作了决定，正在重写并核对…');
  const system = buildSystem(plan.state, plan.judged, plan.events, { query: plan.text })
    + '\n你现在修复玩家自主权问题，重新输出完整正文及 json。移除玩家没有批准的付款、交易、承诺、感情表态和补写台词。NPC 可以提出要求，然后停下来等玩家决定。保留玩家已明确批准的交易原金额、数量和对象，不增删其他交易。验证问题：' + error;
  let out = '';
  for await (const chunk of trackedChat({ system, messages: [{ role: 'user', content: `原行动：${plan.text}\n待修复回复：\n${raw}` }], temperature: 0.2, signal: app.controller.signal })) out += chunk;
  return out;
}
async function recoverAbilityNarrative(raw, plan, error) {
  if (app.metrics) app.metrics.repairs++;
  turnStatus('正文与装备或天赋效果不一致，正在重写核对…');
  const system = buildSystem(plan.state, plan.judged, plan.events, { query: plan.text })
    + '\n你现在只修复本回合叙事与能力结果的矛盾。重新输出完整正文及原有JSON变化块。实际使用的武器、免疫效果与引擎健康结算不可推翻；删除无效的受伤、中毒或控制描写。不能变更原有交易、物品变化、人物、地点或行动目标结果。秘密天赋不直接透露给NPC。验证问题：' + error;
  let out = '';
  for await (const chunk of trackedChat({ system, messages: [{ role: 'user', content: `本次行动：${plan.text}\n待核对回复：\n${raw}` }], temperature: 0.2, signal: app.controller.signal })) out += chunk;
  return out;
}
async function send(options = {}) {
  if (busy() || !app.saveId) return;
  app.preparing = true; sendEl.disabled = true;
  for (const button of document.querySelectorAll('.action-choice')) button.disabled = true;
  try {
    await store.loadMessages(app.saveId);
    const latest = store.getSave(app.saveId);
    if (app.loadedRevision != null && latest.revision !== app.loadedRevision) {
      await loadGame(app.saveId, { allowDuringTurn: true });
      addMessage('error', '存档已在其他页面更新，已载入最新进度。请核对后再发送。'); return;
    }
    await sendTurn(options);
  } catch (error) { reportActionError(error); }
  finally {
    app.preparing = false; sendEl.disabled = false;
    for (const button of document.querySelectorAll('.action-choice')) button.disabled = false;
  }
}
async function sendTurn(options = {}) {
  if (app.streaming || !app.saveId) return;
  const current = store.getSave(app.saveId);
  const pending = store.getPending(app.saveId);
  const typed = inputEl.value.trim();
  if (!options.retry && !typed) return;
  if (!options.retry && /^\/状态\s*$/.test(typed)) { inputEl.value = ''; openSheet('overview'); return; }
  if (!options.retry && /^\/时间\s*$/.test(typed)) { inputEl.value = ''; addMessage('assistant', `${app.ui.date}\n${current.player.location.siteName}`); return; }
  if (!options.retry && /^\/存档\s*$/.test(typed)) { inputEl.value = ''; await store.putSaveAsync(current); app.loadedRevision = current.revision; addMessage('assistant', '已保存当前进度。'); return; }
  if (pending && /^\/重试\s*$/.test(typed)) options.retry = true;
  if (pending && !options.retry && !/^\/取消重试\s*$/.test(typed)) { showPending(); addMessage('error', '请先重试未提交的回合，或输入 /取消重试 放弃草稿。'); return; }
  if (/^\/取消重试\s*$/.test(typed)) { await store.putPendingAsync(app.saveId, null); inputEl.value = ''; turnStatus(); return; }
  if (/^\/撤回\s*$/.test(typed)) {
    const previous = store.getLastTurn(app.saveId);
    if (!previous) { addMessage('error', '还没有可撤回的回合。'); return; }
    const restored = structuredClone(previous.base); restored.saveId = app.saveId;
    await store.putSaveAsync(restored, previous.messages, { expectedRevision: current.revision, lastTurn: null, pending: null });
    inputEl.value = ''; await loadGame(app.saveId, { allowDuringTurn: true }); addMessage('assistant', '已撤回上一回合，回到结算前。'); return;
  }
  if (!llm.hasKey()) { openSettings(); return; }
  let draft;
  if (options.retry) {
    if (!pending) return;
    if (pending.baseRevision !== current.revision) { addMessage('error', '草稿之后存档已变化，请取消草稿后重新行动。'); return; }
    draft = pending;
  } else if (isCorrection(typed)) {
    const previous = store.getLastTurn(app.saveId);
    if (!previous) { addMessage('error', '这份旧存档还没有可回退的回合记录。请先核对状态；新回合完成后即可用此功能纠正。'); return; }
    if (/^\/(纠错|纠正)\s*$/.test(typed)) { addMessage('error', '在 /纠错 后写清要纠正的内容，原回合会从结算前重新处理。'); return; }
    draft = { id: previous.id, text: previous.input, correction: typed, baseState: previous.base,
      history: previous.messages, baseRevision: current.revision, createdAt: new Date().toISOString() };
  } else {
    draft = { id: `turn:${store.newId().slice(3)}`, text: typed, baseRevision: current.revision, createdAt: new Date().toISOString() };
  }
  const source = draft.baseState || current;
  const history = draft.history || store.getMessages(app.saveId);
  let plan;
  try {
    plan = prepareTurn(source, draft.text, draft.id, { messages: history });
    draft = { ...draft, input: draft.input || plan.input, text: plan.text };
  } catch (error) { addMessage('error', '这次行动还没有开始：' + error.message); return; }
  const ambiguous = ambiguousPeople(source, plan.text);
  if (ambiguous) {
    const box = addMessage('assistant', '这里有同名人物，请先选清身份，再发送行动。');
    const group = document.createElement('div'); group.className = 'action-choices';
    for (const person of ambiguous.people) {
      const button = document.createElement('button'); button.className = 'action-choice'; button.textContent = person.label;
      button.onclick = () => { inputEl.value = plan.text.replaceAll(ambiguous.name, person.label); box.remove(); inputEl.focus(); };
      group.append(button);
    }
    box.append(group); return;
  }
  try { await store.putPendingAsync(app.saveId, { ...draft, raw: '' }); }
  catch (error) { addMessage('error', '无法保存待处理回合：' + error.message + '。原进度已保留。'); return; }
  inputEl.value = ''; inputEl.style.height = 'auto';
  app.streaming = true; app.controller = new AbortController(); sendEl.disabled = true;
  $('#cancel-turn').classList.remove('hidden');
  const playerText = draft.input !== draft.text ? `${draft.input}\n${draft.text}` : draft.text;
  addMessage('user', draft.correction || playerText);
  const bubble = addMessage('assistant', ''); bubble.classList.add('cursor'); scrollToElement(bubble);
  turnStatus('正在生成，完成验证后保存…');
  let raw = '', timer = null, lastDraftAt = Date.now(), category = 'generation';
  const started = performance.now(); app.metrics = { turn: source.turn + 1, requests: 0, repairs: 0 };
  try {
    const system = buildSystem(plan.state, plan.judged, plan.events,
      { query: draft.text, chronicleDue: chronicleDue(plan.state, draft.text), recall: recallHistory(plan.state, history, draft.text) }) +
      (draft.correction ? `\n【纠正原回合】${draft.correction}\n这是原回合的替换，已经回到原结算前；只完成原行动，不额外耗时。` : '');
    for await (const chunk of trackedChat({ system, messages: [...history.slice(-14).map(m => ({ role: m.role, content: m.role === 'assistant' ? narrationText(m.content) : m.content })).filter(m => m.content.trim()),
      { role: 'user', content: draft.text }], signal: app.controller.signal })) {
      raw += chunk;
      app.metrics.firstTokenMs ??= performance.now() - started;
      if (!timer) timer = setTimeout(() => { timer = null; bubble.textContent = '正在生成并核对回复…（' + raw.length + ' 字）'; }, 100);
      if (Date.now() - lastDraftAt > 2000) { await store.putPendingAsync(app.saveId, { ...draft, raw }); lastDraftAt = Date.now(); }
    }
    clearTimeout(timer); timer = null;
    category = 'validation';
    const result = await settleReply(plan, raw, { repairAgency: recoverAgency, repairNarrative: recoverAbilityNarrative, repair: async (...args) => {
      turnStatus('正在核对回复，完成后保存…'); return recoverDelta(...args);
    } });
    const clean = narrationText(result.raw) || '这一回合的行动已经记下。';
    mergeChronicle(result.state, parseChronicle(clean));
    const messages = [...history, { role: 'user', content: playerText + (draft.correction ? `\n（本回合纠正：${draft.correction}）` : '') },
      { role: 'assistant', content: clean, sourceTurn: result.state.turn, entities: entityRefs(result.state, clean + '\n' + plan.text), turnId: draft.id, receipt: result.receipt, choices: extractChoices(clean) }];
    result.state.saveId = app.saveId;
    category = 'storage';
    await store.putSaveAsync(result.state, messages, { expectedRevision: draft.baseRevision, pending: null, replaceFrom: history.length,
      lastTurn: { id: draft.id, input: draft.text, base: plan.base, messages: history, receipt: result.receipt } });
    await store.recordDiagnostic(app.saveId, { ...app.metrics, outcome: 'saved', durationMs: performance.now() - started, outputChars: result.raw.length }).catch(() => {});
    await loadGame(app.saveId, { allowDuringTurn: true });
    turnStatus('已在本机保存。');
    if (sync.ghReady()) {
      turnStatus('已在本机保存，正在备份到云端…');
      sync.backupSave(result.state, messages).then(() => { updateGhStatus(); turnStatus('本机与云端均已保存。'); }).catch(e => {
        updateGhStatus(); turnStatus('本机已保存；云备份未完成：' + e.message);
      });
    }
  } catch (error) {
    clearTimeout(timer);
    try { await store.putPendingAsync(app.saveId, { ...draft, raw }); } catch { /* The original committed save is still intact. */ }
    bubble.textContent = '这份回复尚未通过核对，原进度已保留。';
    await store.recordDiagnostic(app.saveId, { ...app.metrics, outcome: app.controller.signal.aborted ? 'cancelled' : 'failed', category: app.controller.signal.aborted ? 'cancelled' : category, durationMs: performance.now() - started, outputChars: raw.length }).catch(() => {});
    bubble.classList.remove('cursor');
    addMessage('error', '本回合尚未提交：' + (app.controller.signal.aborted ? '生成已停止' : error.message));
    showPending();
  } finally {
    clearTimeout(timer); bubble.classList.remove('cursor');
    app.streaming = false; sendEl.disabled = false; $('#cancel-turn').classList.add('hidden');
    app.controller = null; app.metrics = null; inputEl.focus(); renderToc();
    if (app.updateWaiting) offerUpdate(app.updateWaiting);
    if (app.reloadAfterTurn) location.reload();
  }
}
$('#cancel-turn').onclick = () => app.controller?.abort();

sendEl.onclick = () => send();
// 输入框里回车只换行，不发送；发送只认「说」按钮。
inputEl.addEventListener('input', () => {
  inputEl.style.height = 'auto';
  inputEl.style.height = Math.min(inputEl.scrollHeight, window.innerHeight * 0.4) + 'px';
});

function renderSheet(tab = app.tab) {
  const u = app.ui;
  if (!u) return;
  app.tab = tab;
  dateEl.textContent = u.dateLine || u.date.split('·').slice(0, 2).join('·').trim();
  const p = u.player;
  $('#cs-name').textContent = p.name;
  $('#cs-place').textContent = p.location.siteName;
  $('#cs-sub').textContent = `${p.age} 岁 · ${p.race} · ${p.profession}（${p.professionState}）`;
  for (const b of $('#cs-tabs').children) b.classList.toggle('active', b.dataset.tab === tab);
  $('#cs-body').innerHTML = VIEWS[tab](u);
}

$('#cs-body').addEventListener('click', event => {
  const button = event.target.closest('[data-task]'); if (!button || busy()) return;
  runAction(async () => {
    const state = store.getSave(app.saveId);
    applyTasks(state, [{ id: button.dataset.task, status: button.dataset.status }], [], 'player:task-review');
    await store.putSaveAsync(state); if (state.saveId === app.saveId) app.loadedRevision = state.revision;
    app.loadedRevision = state.revision; app.ui = uiState(state); renderSheet('tasks');
  });
});

function readLoadoutForm() {
  return { weapons: [...document.querySelectorAll('[data-gear-weapon]:checked')].map(input => ({ key: input.dataset.gearWeapon,
    qty: Number([...document.querySelectorAll('[data-gear-qty]')].find(row => row.dataset.gearQty === input.dataset.gearWeapon)?.value) })),
    primary: $('#gear-primary').value, armor: document.querySelector('[name="gear-armor"]:checked')?.value || '',
    shield: document.querySelector('[name="gear-shield"]:checked')?.value || '' };
}
$('#cs-body').addEventListener('change', event => {
  if (!event.target.closest('#loadout-editor')) return;
  const draft = readLoadoutForm(), primary = $('#gear-primary'), previous = primary.value;
  for (const input of document.querySelectorAll('[data-gear-weapon]')) {
    const quantity = input.closest('.loadout-row').querySelector('.gear-qty');
    const field = quantity.querySelector('input'); quantity.classList.toggle('hidden', !input.checked || Number(field.max) <= 1);
  }
  primary.replaceChildren();
  const empty = document.createElement('option'); empty.value = ''; empty.textContent = '徒手 / 未指定'; primary.append(empty);
  for (const row of draft.weapons) { const option = document.createElement('option'); option.value = row.key; option.textContent = row.key; primary.append(option); }
  primary.value = previous === '' || draft.weapons.some(row => row.key === previous) ? previous : draft.weapons[0]?.key || '';
  const state = store.getSave(app.saveId), slots = weaponSlots(draft.weapons, gearInventory(state.player));
  $('#gear-slot-count').textContent = `武器：${slots}/9 栏`;
  $('#gear-slot-count').classList.toggle('err', slots > 9);
  try { validateLoadout(state.player, readLoadoutForm()); $('#gear-message').textContent = ''; $('#gear-save').disabled = false; }
  catch (error) { $('#gear-message').textContent = error.message; $('#gear-save').disabled = true; }
});
$('#cs-body').addEventListener('click', event => {
  if (!event.target.closest('#gear-save') || busy()) return;
  runAction(async () => {
    if (store.getPending(app.saveId)) { $('#gear-message').textContent = '请先重试未提交的回合，或输入 /取消重试 后再调整装备。'; return; }
    const state = store.getSave(app.saveId);
    try { state.player.loadout = validateLoadout(state.player, readLoadoutForm()); }
    catch (error) { $('#gear-message').textContent = error.message; return; }
    await store.putSaveAsync(state); app.loadedRevision = state.revision; app.ui = uiState(state); renderSheet('gear');
    $('#gear-message').textContent = '常用装备已保存。';
    if (sync.ghReady()) sync.backupSave(state, store.getMessages(app.saveId)).catch(() => {});
  });
});

let searchKind = 'all', searchLimit = 50, searchVersion = 0, searchTimer;
async function renderSearch() {
  const version = ++searchVersion, id = app.saveId;
  const query = $('#search-query').value;
  $('#search-count').textContent = query.trim() ? '正在查找…' : '在当前存档的完整记录中查找。';
  const { results, total } = await searchArchive(store.getSave(id), app.messages, query, {
    kind: searchKind, limit: searchLimit, cancelled: () => version !== searchVersion || id !== app.saveId,
  });
  if (version !== searchVersion || id !== app.saveId) return;
  const box = $('#search-results'); box.replaceChildren();
  const labels = { people: '人物', places: '地点', tasks: '事项', history: '历史' };
  for (const result of results) {
    const card = document.createElement('button'); card.className = 'card';
    const title = document.createElement('b'); title.textContent = labels[result.kind] + ' · ' + result.title;
    const text = document.createElement('span');
    const position = result.text.toLocaleLowerCase().indexOf(query.trim().split(/\s+/)[0].toLocaleLowerCase());
    const start = Math.max(0, position - 60); text.textContent = (start ? '…' : '') + result.text.slice(start, start + 220) + (result.text.length > start + 220 ? '…' : '');
    card.append(title, text); card.onclick = () => runAction(async () => {
      if (busy()) { $('#search-count').textContent = '请等当前回合结束后再跳转。'; return; }
      $('#search').classList.add('hidden');
      if (result.kind === 'history') await loadGame(id, { focusIndex: result.index });
      else openSheet(result.kind === 'tasks' ? 'tasks' : result.kind === 'people' ? 'people' : 'clues');
    }); box.append(card);
  }
  if (query.trim()) $('#search-count').textContent = `找到 ${total} 条，显示 ${results.length} 条。`;
  $('#search-more').classList.toggle('hidden', total <= results.length);
}
$('#btn-search').onclick = () => { if (!app.saveId) return; $('#search').classList.remove('hidden'); $('#search-query').focus(); runAction(renderSearch); };
$('#search-close').onclick = () => { searchVersion++; $('#search').classList.add('hidden'); };
$('#search-query').oninput = () => { clearTimeout(searchTimer); searchVersion++; searchLimit = 50; searchTimer = setTimeout(() => runAction(renderSearch), 180); };
$('#search-filters').onclick = event => {
  const button = event.target.closest('[data-kind]'); if (!button) return;
  searchKind = button.dataset.kind; searchLimit = 50;
  for (const child of $('#search-filters').children) child.classList.toggle('active', child === button);
  runAction(renderSearch);
};
$('#search-more').onclick = () => { searchLimit += 50; runAction(renderSearch); };

/* ---------------- 物价表（状态页） ---------------- */

function parsePriceInput(str) {
  const s = String(str || '').trim().replace(/[,，]/g, '');
  if (!s) return null;
  if (/^\d+$/.test(s)) return Number(s) > 0 ? Number(s) : null;
  const m = s.match(/^(\d*)\s*[-~～至到]\s*(\d*)$/);
  if (m) {
    const min = m[1] ? Number(m[1]) : null;
    const max = m[2] ? Number(m[2]) : null;
    if ((min == null || min > 0) && (max == null || max > 0) && (min != null || max != null)) return { min, max };
    return null;
  }
  const v = Math.round(Number(s));
  return Number.isFinite(v) && v > 0 ? v : null;
}

document.addEventListener('click', async (e) => {
  const save = e.target.closest('#px-save');
  const add = e.target.closest('#px-add');
  if (!save && !add) return;

  const state = store.getSave(app.saveId);
  if (!state) return;
  state.prices ||= {};
  state.rates ||= {};

  if (save) {
    let n = 0;
    for (const el of document.querySelectorAll('#cs-body .px-input')) {
      const name = el.dataset.name;
      const target = el.dataset.kind === 'rates' ? state.rates : state.prices;
      const v = parsePriceInput(el.value);
      if (v == null) {
        if (target[name] !== undefined) {
          delete target[name];
          n += 1;
        }
      } else if (JSON.stringify(target[name]) !== JSON.stringify(v)) {
        target[name] = v;
        n += 1;
      }
    }
    await store.putSaveAsync(state); if (state.saveId === app.saveId) app.loadedRevision = state.revision;
    app.ui = uiState(state);
    renderSheet('prices');
    const m1 = document.querySelector('#px-msg');
    if (m1) m1.textContent = `已保存 ${n} 处改动。`;
    return;
  }

  const name = $('#px-name')?.value.trim();
  const v = parsePriceInput($('#px-value')?.value);
  const m2 = document.querySelector('#px-msg');
  if (!name || v == null) {
    if (m2) m2.textContent = '名字和价格都要填（价格可写 800-1500）。';
    return;
  }
  if (gamePriceEntry(name) != null) {
    if (m2) m2.textContent = '该条目已有游戏物价，AI 会直接参考，无需重复加入存档。';
    return;
  }
  if (isRetiredPostalQuote(name, v)) { if (m2) m2.textContent = '这条错误邮资已经废弃，不能重新加入。'; return; }
  const kind = $('#px-kind')?.value === 'rates' ? 'rates' : 'prices';
  const target = kind === 'rates' ? state.rates : state.prices;
  target[name] = v;
  await store.putSaveAsync(state); if (state.saveId === app.saveId) app.loadedRevision = state.revision;
  app.ui = uiState(state);
  renderSheet('prices');
  const m3 = document.querySelector('#px-msg');
  if (m3) m3.textContent = `已加入${kind === 'rates' ? '活计' : '物价'}：${name}`;
});


$('#cs-tabs').addEventListener('click', (e) => {
  const b = e.target.closest('.tab');
  if (b) renderSheet(b.dataset.tab);
});

function openSheet(tab) {
  if (!app.ui) return;
  renderSheet(tab || app.tab);
  $('#sheet').classList.remove('hidden');
}

$('#btn-panel').onclick = () => openSheet();
$('#btn-close').onclick = () => $('#sheet').classList.add('hidden');

// 手动保存：写一次本地，能云备份就顺手备份
$('#btn-save-now').onclick = async () => {
  const btn = $('#btn-save-now');
  const state = store.getSave(app.saveId);
  if (!state) {
    btn.textContent = '没有存档';
    setTimeout(() => (btn.textContent = '保存'), 1200);
    return;
  }
  await store.putSaveAsync(state); if (state.saveId === app.saveId) app.loadedRevision = state.revision;
  btn.disabled = true;
  btn.textContent = '已保存';
  if (sync.ghReady()) {
    try {
      await sync.backupSave(state, store.getMessages(app.saveId));
      btn.textContent = '已备份';
      updateGhStatus();
    } catch {
      btn.textContent = '备份失败';
    }
  }
  setTimeout(() => {
    btn.textContent = '保存';
    btn.disabled = false;
  }, 1400);
};

/* ---------------- 账户间转账（不经过模型） ---------------- */

async function doTransfer() {
  const msg = $('#tf-msg');
  const say = (t, cls = '') => {
    if (!msg) return;
    msg.textContent = t;
    msg.className = 'hint ' + cls;
  };

  const state = store.getSave(app.saveId);
  if (!state) return say('没有打开的存档。', 'err');

  const from = $('#tf-from')?.value;
  const to = $('#tf-to')?.value;
  const raw = Number($('#tf-amount')?.value);
  const unit = Number($('#tf-unit')?.value) || 10000;

  if (!from || !to) return say('先选两个账户。', 'err');
  if (from === to) return say('同一个账户，不用转。', 'err');
  if (!(raw > 0)) return say('先填个金额。', 'err');

  const copper = Math.round(raw * unit);
  const fromOther = from === 'other';
  const toOther = to === 'other';
  const acc = (state.player.accounts || []).find((a) => a.id === from || a.name === from);
  if (!fromOther && (!acc || acc.copper < copper)) return say('那边钱不够。', 'err');
  if (!transferCopper(state, from, to, copper)) return say('转账失败。', 'err');

  await store.putSaveAsync(state); if (state.saveId === app.saveId) app.loadedRevision = state.revision;
  app.ui = uiState(state);
  renderSheet(app.tab);
  const after = $('#tf-msg');
  if (after) {
    after.textContent = fromOther
      ? `从「其他」转入 ${copperText(copper)}。`
      : toOther
        ? `转出 ${copperText(copper)} 到「其他」。`
        : `已转 ${copperText(copper)}。`;
    after.className = 'hint ok';
  }
  if (sync.ghReady()) sync.backupSave(state, store.getMessages(app.saveId)).catch(() => {});
}

document.addEventListener('click', async (e) => {
  if (e.target.closest('#tf-do')) await doTransfer();
});

// 密钥类输入框：禁止复制/剪切走（配合 type=password，屏幕上只显示圆点）
for (const ev of ['copy', 'cut']) {
  document.addEventListener(ev, (e) => {
    const el = e.target;
    if (el && el.tagName === 'INPUT' && el.classList.contains('secret')) e.preventDefault();
  });
}

/* ---------------- 物品 / 装备 手动增减 ---------------- */

document.addEventListener('click', async (e) => {
  // 点已有的物品名 → 填进输入框
  const pick = e.target.closest('.it-pick');
  if (pick) {
    const full = pick.dataset.name || '';
    const g = gradeOfName(full);
    const sel = $('#it-grade');
    const input = $('#it-name');
    if (input) {
      input.value = g && sel ? stripGrade(full) : full;
      input.focus();
    }
    if (sel) sel.value = g || '';
    return;
  }

  const btn = e.target.closest('[data-item-act]');
  if (!btn) return;

  const msg = $('#it-msg');
  const say = (t, cls = '') => {
    if (!msg) return;
    msg.textContent = t;
    msg.className = 'hint it-msg ' + cls;
  };

  const state = store.getSave(app.saveId);
  if (!state) return say('没有打开的存档。', 'err');
  ensureAssets(state);
  normalizeItems(state);

  const raw = ($('#it-name')?.value || '').trim();
  const grade = $('#it-grade')?.value || '';
  const name = composeName(raw, grade);
  const qty = Math.max(1, Math.round(Number($('#it-qty')?.value) || 1));
  const adding = btn.dataset.itemAct === 'add';
  const res = adding ? addItem(state, name, qty) : removeItem(state, name, qty);
  if (!res.ok) return say(res.reason || '没成功', 'err');

  await store.putSaveAsync(state); if (state.saveId === app.saveId) app.loadedRevision = state.revision;
  app.ui = uiState(state);
  renderSheet(app.tab);

  const after = $('#it-msg');
  if (after) {
    const unit = { equipment: '件装备', bag: '个物品', stock: '份存货', vehicle: '件交通工具', livestock: '头牲畜' }[res.where] || '个';
    after.textContent = `${adding ? '增加' : '减少'} ${res.count} ${unit}：${name}`;
    after.className = 'hint it-msg ok';
  }
  if (sync.ghReady()) sync.backupSave(state, store.getMessages(app.saveId)).catch(() => {});
});

$('#btn-new').onclick = () => {
  if (!confirm('开新的一局？当前这局不会被删除，可以在存档里找回来。')) return;
  app.saveId = null;
  app.ui = null;
  app.messages = [];
  showMenu();
};

$('#btn-del').onclick = async () => {
  if (!app.saveId) {
    alert('现在没有打开的存档。先在「存档」里选一份进来，再删。');
    return;
  }
  if (!confirm('删掉这一局？删了就找不回来（云端备份还在的话可以恢复）。')) return;
  await store.deleteSaveAsync(app.saveId);
  app.saveId = null;
  app.ui = null;
  app.messages = [];
  showMenu();
};

/* ---------------- GitHub 云存档 ---------------- */

function updateGhStatus() {
  const el = $('#gh-status');
  if (!el) return;
  if (!sync.ghReady()) {
    el.textContent = '未配置。到「设置」里填仓库和令牌，就能把存档同步到 GitHub。';
    return;
  }
  const c = sync.ghConfig();
  const last = localStorage.getItem(`norn.gh.last.${app.saveId}`);
  el.textContent = `已连接 ${c.owner}/${c.repo}（${c.branch}）` + (last ? ` · 上次备份 ${new Date(last).toLocaleString()}` : ' · 还没备份过');
}

$('#btn-gh-backup').onclick = async () => {
  if (!app.saveId) return alert('先开始一局。');
  if (!sync.ghReady()) return alert('先去「设置」里配置 GitHub。');
  const el = $('#gh-status');
  el.textContent = '正在上传…';
  try {
    const path = await sync.backupSave(store.getSave(app.saveId), store.getMessages(app.saveId));
    updateGhStatus();
    alert('已备份：' + path);
  } catch (e) {
    el.textContent = '备份失败：' + e.message;
  }
};

$('#btn-gh-restore').onclick = async () => {
  if (!sync.ghReady()) return alert('先去「设置」里配置 GitHub。');
  const box = $('#gh-list');
  box.innerHTML = '<p class="hint">读取中…</p>';
  $('#restore').classList.remove('hidden');
  try {
    const files = await sync.ghList('saves');
    box.innerHTML = '';
    if (!files.length) {
      box.innerHTML = '<p class="hint">云端还没有存档。</p>';
      return;
    }
    for (const f of files) {
      const row = document.createElement('div');
      row.className = 'cloud-row';

      const b = document.createElement('button');
      b.className = 'card cloud';
      b.innerHTML = `<b>${esc(f.name)}</b><span>读取中…</span>`;

      const del = document.createElement('button');
      del.className = 'cloud-del';
      del.textContent = '删';
      del.title = '删除云端存档';

      row.append(b, del);
      box.appendChild(row);

      // 先把云端文件读出来看元信息，免得点了才发现拿错版本
      sync
        .restoreSave(f.path)
        .then((state) => {
          const who = `${state.player?.name || f.name} · 第 ${state.turn ?? 0} 回合`;
          const when = state.updatedAt ? new Date(state.updatedAt).toLocaleString() : '';
          b.innerHTML = `<b>${esc(who)}</b><span>${esc(
            state.player?.location?.siteName || '',
          )}${when ? ' · ' + esc(when) : ''}</span>`;
          b.onclick = async () => {
            try {
              const carried = Array.isArray(state.messages) ? state.messages : [];
              delete state.messages;
              state.snapshotOf = state.saveId;
              state.lineageId ||= state.saveId;
              state.saveId = store.newId();
              state.revision = 0;
              state.createdAt = new Date().toISOString();
              state.label = '来自 GitHub';
              await store.putSaveAsync(state, carried);
              $('#restore').classList.add('hidden');
              await loadGame(state.saveId);
              alert(`已恢复：${state.player.name} · 第 ${state.turn ?? 0} 回合`);
            } catch (e) {
              alert('恢复失败：' + e.message);
            }
          };
          del.onclick = async (ev) => {
            ev.stopPropagation();
            if (!confirm(`删除云端存档？\n\n${who}\n\n删掉之后找不回来。本机的那份不受影响。`)) return;
            del.disabled = true;
            del.textContent = '…';
            try {
              await sync.ghDelete(f.path, `删除云端存档 ${who}`);
              row.remove();
              if (!box.querySelector('.cloud-row')) box.innerHTML = '<p class="hint">云端还没有存档。</p>';
            } catch (err) {
              alert('删除失败：' + err.message);
              del.disabled = false;
              del.textContent = '删';
            }
          };
        })
        .catch(() => {
          b.innerHTML = `<b>${esc(f.name)}</b><span>读不到（${Math.round(f.size / 1024)} KB）</span>`;
          b.onclick = () => alert('这个存档读不出来，检查令牌权限。');
          del.onclick = () => alert('读不到这个存档，没法删。');
        });
    }
  } catch (e) {
    box.innerHTML = `<p class="hint">读取失败：${esc(e.message)}</p>`;
  }
};

$('#btn-restore-close').onclick = () => $('#restore').classList.add('hidden');

/* ---------------- 启动 ---------------- */

async function boot() {
  await store.initStorage();
  await loadPrompts();

  if (!llm.hasKey() && !store.listSaves().length) {
    $('#gate').classList.remove('hidden');
    $('#gate-go').onclick = async () => {
      llm.setKey($('#gate-key').value);
      llm.setModel($('#gate-model').value);
      if (!llm.hasKey()) return alert('需要填一个 Key。');
      $('#gate').classList.add('hidden');
      await boot2();
    };
    return;
  }
  await boot2();
}

async function boot2() {
  const list = store.listSaves();
  if (list.length) await loadGame(list[0].id);
  else showMenu();
}

/* ---------------- 起始菜单 ---------------- */

function showMenu() {
  composerEl.classList.add('hidden');
  logEl.innerHTML = '';
  $('#toc').classList.add('hidden');
  $('#toc').innerHTML = '';
  for (const id of ['#wizard', '#custom', '#saves', '#settings', '#sheet']) {
    const el = $(id);
    if (el) el.classList.add('hidden');
  }
  const has = store.listSaves().length > 0;
  const btn = $('#menu-load');
  btn.disabled = false;
  btn.style.opacity = '1';
  btn.querySelector('b').textContent = has ? '载入存档' : '导入存档';
  btn.querySelector('span').textContent = has ? '接着之前那一局玩' : '从备份文件或云端接着玩';
  const b = $('#build');
  if (b) b.textContent = '版本 ' + BUILD + ' · 存档在 GitHub 备份过就不用怕清缓存';
  $('#menu').classList.remove('hidden');
}

$('#menu-load').onclick = () => {
  renderSaves();
  updateGhStatus();
  $('#menu').classList.add('hidden');
  $('#saves').classList.remove('hidden');
};

$('#menu-new').onclick = () => {
  $('#menu').classList.add('hidden');
  openWizard();
};

$('#menu-custom').onclick = () => {
  $('#menu').classList.add('hidden');
  app.customGender = 'male';
  for (const b of $('#cu-genders').children) b.classList.toggle('selected', b.dataset.gender === 'male');
  $('#custom').classList.remove('hidden');
};

$('#cu-back').onclick = () => {
  $('#custom').classList.add('hidden');
  showMenu();
};

$('#cu-genders').addEventListener('click', (e) => {
  const b = e.target.closest('.chip');
  if (!b) return;
  app.customGender = b.dataset.gender;
  [...$('#cu-genders').children].forEach((c) => c.classList.remove('selected'));
  b.classList.add('selected');
});

$('#cu-start').onclick = async () => {
  const place = $('#cu-place').value.trim() || '无名之地';
  const desc = $('#cu-desc').value.trim();
  const origin = $('#cu-origin').value.trim();
  const name = $('#cu-name').value.trim();
  const gender = app.customGender || 'male';
  const seed = Math.floor(Math.random() * 1e9);

  const { state } = generateWorld({ regionId: 'greywater', familyKey: 'npc_farmer', name, gender, seed });
  state.world.name = place;
  state.world.regionTitle = '自定义';
  if (desc) {
    state.world.terrain = desc;
    state.world.economy = '（玩家设定）';
    state.world.politics = '（玩家设定）';
    state.world.risk = '（玩家设定）';
  }
  state.customSetting = [desc && `地方：${desc}`, origin && `玩家出身：${origin}`].filter(Boolean).join('\n');
  state.player.location.siteName = place;
  if (origin) state.player.profession = origin;
  state.saveId = store.newId();
  state.updatedAt = new Date().toISOString();
  state.prices ||= {};
  state.rates ||= {};

  const opening = [
    `你十二岁。家在${place}。`,
    desc ? desc : '',
    origin ? `你是${origin}。` : '',
    '今天要做点什么？',
  ].filter(Boolean).join('\n\n');

  await store.putSaveAsync(state, [{ role: 'assistant', content: opening }]);
  await loadGame(state.saveId);
};

boot().catch(error => { addMessage('error', '本机存档暂时无法读取：' + error.message); });

// 注册 service worker（离线打开用）。
// 新版本接管时自动刷新一次，免得手机上一直看到旧文件。
function offerUpdate(reg) {
  if (!reg?.waiting) return;
  if (app.streaming) { app.updateWaiting = reg; return; }
  app.updateWaiting = null;
  reg.waiting.postMessage({ type: 'ACTIVATE_UPDATE' });
}
if ('serviceWorker' in navigator) {
  const hadController = Boolean(navigator.serviceWorker.controller);
  let reloaded = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || reloaded) return;
    if (app.streaming) { app.reloadAfterTurn = true; return; }
    reloaded = true;
    location.reload();
  });
  window.addEventListener('load', async () => {
    try {
      const reg = await navigator.serviceWorker.register('sw.js', { type: 'module', updateViaCache: 'none' });
      offerUpdate(reg);
      reg.addEventListener('updatefound', () => {
        const worker = reg.installing;
        worker?.addEventListener('statechange', () => { if (worker.state === 'installed') offerUpdate(reg); });
      });
      reg.update().catch(() => {});
    } catch {
      /* 不支持就算了，不影响玩 */
    }
  });
}
