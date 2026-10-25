import * as store from './store.js';
import * as llm from './llm.js';
import * as sync from './sync.js';
import { REGIONS, generateWorld, openingText } from './engine/worldgen.js';
import { judge, judgeBrief } from './engine/resolve.js';
import { advanceWorld, engineDelta } from './engine/tick.js';
import { stateBlock, npcCards, uiState, applyDelta, transferCopper, copperText } from './engine/state.js';
import { trainSkill } from './engine/progress.js';
import { makeRng } from './engine/rng.js';
import { esc, format, pruneEmpty, splitDelta, stripSheet } from './format.js';
import { chronicleDue, mergeChronicle, parseChronicle } from './engine/chronicle.js';
import { addItem, removeItem, gradeOfName, stripGrade, composeName, normalizeItems } from './engine/items.js';
import { ensureAssets } from './engine/assets.js';
import { VIEWS } from './views.js';

const BUILD = '2026-10-23 · r5';

const $ = (s) => document.querySelector(s);

const logEl = $('#log');
const inputEl = $('#input');
const sendEl = $('#send');
const composerEl = $('#composer');
const dateEl = $('#date');

const app = {
  saveId: null,
  ui: null,
  messages: [],
  regions: REGIONS,
  picked: { regionId: null, family: null, gender: 'male' },
  streaming: false,
  tab: 'overview',
  rules: '',
  worldbook: '',
};

/* ---------------- 提示词 ---------------- */

const RUNTIME = `
【本回合的机器协议】
1. 用中文写。**输出章节以本条为准，覆盖前面规则里的模板**：
   九段结算（【本次行动】【生活变化】【财务变化】【人物关系】【职业与技能】【当地变化】【世界动态】【新信息】【未完成事项】）
   + 【世界动态】四层摘要
   + 【你现在可以做什么】6–8 条
   + 一句「你不需要从以上选项中选择」。
   **没有变化的段落整段省略**——不要写「无。」「无变化。」来占位。
   【世界动态】只在真有新消息时才写；没有就整段不写，也不要复述【当地动态】里已经说过的事。
   **不要输出【当前角色】块**（玩家在状态面板里能看）。也不要输出【玩家自由行动】这个小标题。
2. 另起一行输出一个 json 代码块，只写“变化”。
3. 数值都是**增量**；钱换算成铜（1 银 = 100 铜，1 金 = 10000 铜）。
3b. **钱不要自己算，也不要自己定价。** 你只写"做了什么"，价格、到账、扣款全部由引擎结算：
    "trade":{"account":"cash","buy":[{"name":"黑面包","qty":2}],"sell":[{"name":"狼皮","qty":1}]}
    "bounty":{"label":"清掉林子边的狼","tier":2}          **接活**：酬劳此刻定死，引擎按威胁等级开
    "bounty":{"result":"完成"}                            **交活**：完成=全额，一半=半额，未完成=一分没有
    "earn":{"label":"替粮行送信","copper":300}          非战斗进账：你按下面的参考价自己报一个铜数，第一次定下后存档记住，以后同类按这个
    参考价（铜/次）：跑腿送信 300｜打杂帮工 150｜带路 600｜盯梢打听 500｜卖消息 800｜抄写代笔 400｜卖艺 200｜护送押运 8000｜商队长途 3 万｜赌 1000
    "prices":[{"name":"刻纹银匕首","copper":1200}]       价目表里没有的东西：你按物价水平给个铜数，引擎记进存档并一直沿用
    "payDebt":{"to":"磨坊主塞德","copper":20000}          还一笔债
    "borrow":{"from":"金匠铺","copper":50000,"months":12,"rate":0.01}   借钱（默认月息 1%）
    "gift":{"to":"npc_mother","copper":500}              送钱送东西做人情
    "items":[{"name":"狼皮","qty":2}]                    收进包里的东西（别人给的、偷到的、捡到的都算）
    "lose":[{"name":"羊皮","qty":1}]                     失去的东西（被偷、送人、掉了、上交）
    "use":[{"name":"金疮药","qty":1}]                    喝药/用道具：数量从【随身货物】里扣，扣完就没有了
    "profession":{"name":"铁匠学徒","state":"apprentice"} 转职业（state：none / apprentice / journeyman / master / guildmaster）
    "money":{"transfer":[{"from":"home","to":"cash","copper":50000}]}  账户之间调度
    **只有 prices 和 earn 可以写金额**，其余一律不要写价钱、也不要写余额：买东西的价格由引擎算，只有价目表里没有的东西才用 prices 报价；活计收入用 earn 报价。
    账户只有三个：cash（随身，在外面挣的和花的）、home（家里，家族月钱进这里）、workshop（产业，个人产业月收益进这里）。
    产业收益**不会**自动转到随身，要动用就写 transfer。家族月钱、债息、吃住开销由引擎自动结算，你不要重复记。
3c. **技能数值不要写。** 技能等级只由引擎按练习时长与难度涨；你最多只能报一个新技能的名字："skills":["商谈"]。
4. relations 只能用下面列出的 npcId，禁止编造。
5. 叙事里不出现数值、等级、经验值。
6. 不替玩家说话或做决定。对话场景中，NPC 说完就停。**也不要在正文里写“修正：”“更正：”这类关于自己格式的说明**。
7. **装备**：玩家真把东西收进包里时写 "equipment":["长剑（灰）"]，一次最多 3 件，一条只写一种品阶。
8. **稀有度**：品阶只用于武器与护甲；药剂、工具、材料不分级。默认普通；稀少约十件一件；**珍奇是事件不是掉落**；**史诗不随机**；**传说永不自动生成**。
9. **数值上限**：其他任何人的四维上限是 100；玩家是唯一例外。
10. **用词必须西幻**：不写「掌柜的、这位爷、客官、客栈、衙门、银票、江湖、门派」这类中式词；
    改写：店主 / 先生 / 旅店 / 镇公所 / 治安官 / 汇票 / 行会。人名哪国风格都行（拉丁、日耳曼、斯拉夫、北欧、凯尔特、中东、中、日、韩、印度、非洲），但要 2–4 个音节、念得出来，不堆生僻字；名字换了，用词也得是西幻。
`.trim();

const FALLBACK_RULES = `你是「西幻人生模拟器」的运行时。你运行一个已经存在的世界，叙述一个真实的人在其中生活。
世界先于玩家存在，玩家不是中心；世界不为玩家暂停；不替玩家做决定或说话；只用玩家可知的信息；
重大事件必须有原因；失败与死亡必须合理；时间只前进；已发生的事必须记住；展示不告知；对话像人说话；
场景首次详写、重复只写变化；叙事里不出现数值与系统语。
每回合输出：九段结算 + 【世界动态】+【你现在可以做什么】+ 末尾 json 增量块。`.trim();

async function loadPrompts() {
  try {
    app.rules = await (await fetch('prompt/rules.md')).text();
  } catch {
    app.rules = '';
  }
  try {
    app.worldbook = await (await fetch('prompt/worldbook.md')).text();
  } catch {
    app.worldbook = '';
  }
  if (!app.rules) app.rules = FALLBACK_RULES;
}

function turnBrief(judged, events, state, opts = {}) {
  const injuryLine = judged.injury
    ? `- 引擎判定本回合受伤：${judged.injury.part}，约 ${judged.injury.days} 天。叙事里要写出来。`
    : '- 本回合**没有**受伤。叙事里不要出现流血、骨折、伤口这类需要记录的伤；疼、淤青、擦破皮可以写。';
  const lines = [
    '【本回合判定（引擎计算，不得更改）】',
    judgeBrief(judged),
    '',
    '【本回合世界事件（引擎生成，择要写进叙事与【当地动态】）】',
    events.length ? events.map((e) => `· ${e.text}`).join('\n') : '· 无',
    '',
    '【写作要求】',
    `- 这一回合的结果是「${judged.outcomeCn}」，叙事必须体现它。`,
    '- 时间、体力、饥饿、伤已由引擎结算，你**不要**在 json 里写 time 或 body。',
    injuryLine,
    `- 角色姓名固定为「${state.player.name}」，不得改名、不得加称谓。`,
    '- **不要输出【当前角色】块**。九段之后直接接【世界动态】和【你现在可以做什么】。',
  ];
  if (state.flags?.pendingAwakening) {
    lines.push('', '【本回合必须处理】角色刚满十六岁。叙事里必须有人提起觉醒塔（五枚金币，约三成失败），并问玩家去不去、钱从哪来。不要替玩家回答。');
  }
  if (judged.outcome === 'crush') {
    lines.push('', '【碾压局】实力远超眼前这件事。直接写成干净利落办成，不要硬造失败。张力放在旁人怎么看他、这件事牵出什么。');
  }
  if (opts.chronicleDue) {
    lines.push(
      '',
      '【本回合要做编年】在【你现在可以做什么】之前，单独输出一段：',
      '【编年 · 截至 复兴历 X 年 Y 季】',
      '下面列 8–15 条，每条一行，以「· 」开头，只写会影响未来的事（去向、职业、关系变化、欠债、伤病、大事），',
      '不写日常琐碎，不写没发生的计划。这段会被存进存档长期保留。',
    );
  }
  lines.push(
    '',
    '━━━━━━━━━━',
    '【最后一步，必须做】在【你现在可以做什么】之后，再输出一个 json 代码块，只写增量：',
    '```json',
    '{"trade":{"account":"cash","buy":[{"name":"黑面包","qty":2}]},"items":[{"name":"狼皮","qty":1}],"relations":[{"npcId":"npc_mother","trust":1,"observable":"她把水接了过去"}],"knowledge":[{"text":"……","source":"听说"}],"mind":{"mood":"有点泄气"},"goals":[],"problems":[]}',
    '```',
    '**没有这个代码块，本回合的钱与关系变化就不会被记录。**',
  );
  return lines.join('\n');
}

const buildSystem = (state, judged, events, opts = {}) =>
  [app.rules, '', app.worldbook, '', ...(state.customSetting ? ['【玩家自定义的世界补充（以此为准，不得推翻）】', state.customSetting, ''] : []), RUNTIME, '', '【当前状态】', stateBlock(state), '', '【在场/相关人物】', npcCards(state), '', turnBrief(judged, events, state, opts)].join('\n');

/* ---------------- 文本处理 ---------------- */

/* ---------------- 渲染 ---------------- */

function scrollToEnd() {
  logEl.scrollTop = logEl.scrollHeight;
}

function scrollToElement(el, pad = 8) {
  if (!el) return;
  const top = el.getBoundingClientRect().top - logEl.getBoundingClientRect().top + logEl.scrollTop - pad;
  logEl.scrollTop = Math.max(0, top);
}

function addMessage(role, text) {
  const el = document.createElement('div');
  el.className = 'msg ' + (role === 'user' ? 'me' : role === 'error' ? 'err' : '');
  el.innerHTML = format(text);
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
    btn.onclick = () => {
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
    b.onclick = () => {
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

$('#start').onclick = () => {
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
  const opening = openingText(state, family, region);
  store.putSave(state, [{ role: 'assistant', content: opening }]);

  app.saveId = state.saveId;
  app.ui = uiState(state);
  app.messages = [{ role: 'assistant', content: opening }];
  $('#wizard').classList.add('hidden');
  composerEl.classList.remove('hidden');
  logEl.innerHTML = '';
  const first = addMessage('assistant', opening);
  renderSheet();
  scrollToElement(first);
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

document.addEventListener('click', (e) => {
  const b = e.target.closest('#font-chips .chip');
  if (!b) return;
  applyFont(b.dataset.font);
});

applyFont(currentFont(), false);

/* ---------------- 载入 / 存档 ---------------- */

function loadGame(id) {
  const state = store.getSave(id);
  if (!state) return openWizard();
  app.saveId = id;
  app.ui = uiState(state);
  app.messages = store.getMessages(id);
  $('#wizard').classList.add('hidden');
  composerEl.classList.remove('hidden');
  logEl.innerHTML = '';
  let last = null;
  for (const m of app.messages) {
    if (!String(m.content || '').trim()) continue; // 空的回复不渲染
    last = addMessage(m.role === 'user' ? 'user' : 'assistant', m.content);
  }
  const tail = app.messages[app.messages.length - 1];
  if (tail && tail.role === 'user') {
    addMessage('error', '上一条消息没有收到回复——多半是回复写到一半断线了。可以再发一次。');
  }
  renderSheet();
  renderToc();
  if (last) scrollToElement(last);
  else scrollToEnd();
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
    card.onclick = () => {
      $('#saves').classList.add('hidden');
      loadGame(s.id);
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

$('#btn-snap').onclick = () => {
  if (!app.saveId) return alert('先开始一局。');
  const s = store.getSave(app.saveId);
  const copy = JSON.parse(JSON.stringify(s));
  copy.saveId = store.newId();
  copy.label = `${s.player.name} · ${s.player.age} 岁 · 第 ${s.turn} 回合`;
  copy.snapshotOf = app.saveId;
  store.putSave(copy, store.getMessages(app.saveId));
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
    loadGame(id);
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
  $('#set-model').value = llm.getModel();
  for (const b of $('#set-effort').children) b.classList.toggle('selected', b.dataset.effort === llm.getEffort());
  const gh = sync.ghConfig();
  $('#set-gh-repo').value = gh.owner && gh.repo ? `${gh.owner}/${gh.repo}` : '';
  $('#set-gh-branch').value = gh.branch || 'main';
  $('#set-gh-token').value = gh.token || '';
  $('#set-gh-msg').textContent = sync.ghReady() ? '已配置。' : '';
  showBuildInfo();
  renderPrices();
  renderRates();
  $('#settings').classList.remove('hidden');
}

/** 设置里的物价表：列出存档内自定价，可直接改。 */
function renderPrices() {
  const box = $('#price-list');
  if (!box) return;
  const state = store.getSave(app.saveId);
  const prices = state?.prices && typeof state.prices === 'object' ? state.prices : {};
  const rows = Object.entries(prices).sort((a, b) => a[0].localeCompare(b[0], 'zh'));
  if (!rows.length) {
    box.innerHTML = '<p class="hint">还没有自定价。表里没有的东西第一次买卖时会自动记一个价。</p>';
    return;
  }
  box.innerHTML = rows
    .map(
      ([name, copper]) =>
        `<div class="price-row"><span class="nm">${esc(name)}</span>` +
        `<input class="price-input" data-name="${esc(name)}" type="number" min="1" step="1" inputmode="numeric" value="${Number(copper) || 0}" /></div>`,
    )
    .join('');
}

$('#btn-price-save').onclick = () => {
  const state = store.getSave(app.saveId);
  if (!state) return;
  if (!state.prices) state.prices = {};
  let changed = 0;
  for (const el of document.querySelectorAll('#price-list .price-input')) {
    const name = el.dataset.name;
    const v = Math.round(Number(el.value));
    if (!Number.isFinite(v) || v <= 0) {
      delete state.prices[name];
      changed += 1;
    } else if (state.prices[name] !== v) {
      state.prices[name] = v;
      changed += 1;
    }
  }
  store.putSave(state);
  app.ui = uiState(state);
  renderPrices();
  const tip = $('#price-list');
  if (tip) tip.insertAdjacentHTML('afterbegin', `<p class="hint">已保存 ${changed} 处改动。</p>`);
};

/** 活计收入表，结构与物价表一样。 */
function renderRates() {
  const box = $('#rate-list');
  if (!box) return;
  const state = store.getSave(app.saveId);
  const rates = state?.rates && typeof state.rates === 'object' ? state.rates : {};
  const rows = Object.entries(rates).sort((a, b) => a[0].localeCompare(b[0], 'zh'));
  if (!rows.length) {
    box.innerHTML = '<p class="hint">还没有记录。第一次遇到跑腿、护送这类活时会自动定一个数。</p>';
    return;
  }
  box.innerHTML = rows
    .map(
      ([name, copper]) =>
        `<div class="price-row"><span class="nm">${esc(name)}</span>` +
        `<input class="rate-input" data-name="${esc(name)}" type="number" min="1" step="1" inputmode="numeric" value="${Number(copper) || 0}" /></div>`,
    )
    .join('');
}

$('#btn-rate-save').onclick = () => {
  const state = store.getSave(app.saveId);
  if (!state) return;
  if (!state.rates) state.rates = {};
  let changed = 0;
  for (const el of document.querySelectorAll('#rate-list .rate-input')) {
    const name = el.dataset.name;
    const v = Math.round(Number(el.value));
    if (!Number.isFinite(v) || v <= 0) {
      delete state.rates[name];
      changed += 1;
    } else if (state.rates[name] !== v) {
      state.rates[name] = v;
      changed += 1;
    }
  }
  store.putSave(state);
  app.ui = uiState(state);
  renderRates();
  const tip = $('#rate-list');
  if (tip) tip.insertAdjacentHTML('afterbegin', `<p class="hint">已保存 ${changed} 处改动。</p>`);
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
  if (el) el.textContent = '检查中…';
  try {
    if ('serviceWorker' in navigator) {
      const reg = await navigator.serviceWorker.getRegistration();
      if (reg) await reg.update();
    }
    if ('caches' in window) {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
    }
    location.reload();
  } catch {
    location.reload();
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

/** 模型漏了数值块时，单独再要一次 JSON（便宜、短）。 */
async function recoverDelta(raw) {
  try {
    const system =
      '你是数据抽取器。只输出一个 JSON 代码块，内容是本回合的状态增量（money / trade / relations / knowledge / mind / goals / problems / items / use 等），不要解释、不要叙事、不要省略。';
    const messages = [
      { role: 'user', content: '从下面这段本回合输出里，补出 JSON 增量：\n\n' + String(raw).slice(-6000) },
    ];
    let out = '';
    for await (const chunk of llm.streamChat({ system, messages, maxTokens: 1500, temperature: 0.2 })) out += chunk;
    return splitDelta(out).delta;
  } catch {
    return null;
  }
}

async function send() {
  const text = inputEl.value.trim();
  if (!text || app.streaming) return;
  inputEl.value = '';
  inputEl.style.height = 'auto';

  app.streaming = true;
  sendEl.disabled = true;
  addMessage('user', text);

  const state = store.getSave(app.saveId);
  if (!state) {
    app.streaming = false;
    sendEl.disabled = false;
    return;
  }
  store.appendMessage(app.saveId, 'user', text);

  const rng = makeRng((state.seed || 1) + (state.turn || 0) * 7919 + 13);
  const judged = judge(state, text, rng);
  const events = advanceWorld(state, judged.minutes, rng, judged);
  const wantChronicle = chronicleDue(state, text);

  const bubble = addMessage('assistant', '');
  bubble.classList.add('cursor');
  scrollToElement(bubble);

  let raw = '';
  let cleanText = '';
  let assistantSaved = false;
  const saveAssistant = (text) => {
    if (assistantSaved || !text) return;
    assistantSaved = true;
    try {
      store.appendMessage(app.saveId, 'assistant', text);
    } catch {
      /* 存不下也别把这一回合整个搞崩 */
    }
  };
  let frame = null;
  const paint = () => {
    bubble.innerHTML = format(raw) || '<p>&nbsp;</p>';
  };

  try {
    const history = store.getMessages(app.saveId).slice(-14).map((m) => ({ role: m.role, content: m.content }));
    for await (const chunk of llm.streamChat({ system: buildSystem(state, judged, events, { chronicleDue: wantChronicle }), messages: history })) {
      raw += chunk;
      if (!frame) {
        frame = requestAnimationFrame(() => {
          frame = null;
          paint();
        });
      }
    }

    const parsed = splitDelta(raw);
    let rawText = parsed.text;
    let delta = parsed.delta;
    // 没有增量块时补一次「只输出 JSON」的短请求，救回钱与关系结算
    if (!delta) {
      delta = await recoverDelta(raw);
      if (delta) rawText = splitDelta(raw).text;
    }
    const cleanText2 =
      pruneEmpty(stripSheet(rawText)) || '（这一回合只见动作，没有留下文字。）';
    cleanText = cleanText2;

    // 编年：模型这回合写了就存进状态，否则几回合后会被挤出上下文
    mergeChronicle(state, parseChronicle(cleanText));

    applyDelta(state, engineDelta(judged, state), rng, { bump: false, judged });
    const modelDelta = { ...(delta || {}) };
    delete modelDelta.time;
    delete modelDelta.body;
    applyDelta(state, modelDelta, rng, { bump: true, judged });
    trainSkill(state, judged);
    if (state.flags?.pendingAwakening) {
      state.flags.pendingAwakening = false;
      state.flags.awakeningAsked = true;
    }

    store.putSave(state);
    saveAssistant(cleanText);
    if (sync.ghReady()) {
      sync.backupSave(state, store.getMessages(app.saveId)).then(() => updateGhStatus()).catch((e) => {
        const el = $('#gh-status');
        if (el) el.textContent = '自动备份失败：' + e.message;
      });
    }
    app.ui = uiState(state);

    bubble.innerHTML = format(cleanText);
    bubble.classList.remove('cursor');
    if (!delta) addMessage('error', '（这一回合没有可用的数值块，钱与关系未结算；已自动重试一次补数据。）');
    renderSheet();
    scrollToElement(bubble);
  } catch (err) {
    bubble.classList.remove('cursor');
    // 断线也把已经写出来的部分存下，避免「我记得说过、回复却没了」
    const partial = raw ? pruneEmpty(stripSheet(splitDelta(raw).text)) : '';
    if (partial) {
      cleanText = cleanText || partial;
      saveAssistant(`${partial}\n\n（这条回复中途断了，可以再说一次。）`);
    }
    if (cleanText) bubble.innerHTML = format(cleanText);
    addMessage('error', '这一回合失败了：' + err.message);
  } finally {
    app.streaming = false;
    sendEl.disabled = false;
    inputEl.focus();
    renderToc();
  }
}

sendEl.onclick = send;
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
  store.putSave(state);
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

function doTransfer() {
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

  store.putSave(state);
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

document.addEventListener('click', (e) => {
  if (e.target.closest('#tf-do')) doTransfer();
});

// 密钥类输入框：禁止复制/剪切走（配合 type=password，屏幕上只显示圆点）
for (const ev of ['copy', 'cut']) {
  document.addEventListener(ev, (e) => {
    const el = e.target;
    if (el && el.tagName === 'INPUT' && el.classList.contains('secret')) e.preventDefault();
  });
}

/* ---------------- 物品 / 装备 手动增减 ---------------- */

document.addEventListener('click', (e) => {
  // 点已有的物品名 → 填进输入框
  const pick = e.target.closest('.it-pick');
  if (pick) {
    const full = pick.dataset.name || '';
    const g = gradeOfName(full);
    const input = $('#it-name');
    if (input) {
      input.value = g ? stripGrade(full) : full;
      input.focus();
    }
    const sel = $('#it-grade');
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

  store.putSave(state);
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

$('#btn-del').onclick = () => {
  if (!app.saveId) {
    alert('现在没有打开的存档。先在「存档」里选一份进来，再删。');
    return;
  }
  if (!confirm('删掉这一局？删了就找不回来（云端备份还在的话可以恢复）。')) return;
  store.deleteSave(app.saveId);
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
  const last = localStorage.getItem('norn.gh.last');
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
          b.onclick = () => {
            try {
              const carried = Array.isArray(state.messages) ? state.messages : [];
              delete state.messages;
              state.saveId = store.newId();
              state.createdAt = new Date().toISOString();
              state.label = '来自 GitHub';
              store.putSave(state, carried);
              $('#restore').classList.add('hidden');
              loadGame(state.saveId);
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
  await loadPrompts();

  if (!llm.hasKey()) {
    $('#gate').classList.remove('hidden');
    $('#gate-go').onclick = () => {
      llm.setKey($('#gate-key').value);
      llm.setModel($('#gate-model').value);
      if (!llm.hasKey()) return alert('需要填一个 Key。');
      $('#gate').classList.add('hidden');
      boot2();
    };
    return;
  }
  boot2();
}

function boot2() {
  const list = store.listSaves();
  if (list.length) loadGame(list[0].id);
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
  btn.disabled = !has;
  btn.style.opacity = has ? '1' : '.4';
  const b = $('#build');
  if (b) b.textContent = '版本 ' + BUILD + ' · 存档在 GitHub 备份过就不用怕清缓存';
  $('#menu').classList.remove('hidden');
}

$('#menu-load').onclick = () => {
  if (!store.listSaves().length) return alert('还没有存档。');
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

$('#cu-start').onclick = () => {
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

  const opening = [
    `你十二岁。家在${place}。`,
    desc ? desc : '',
    origin ? `你是${origin}。` : '',
    '今天要做点什么？',
  ].filter(Boolean).join('\n\n');

  store.putSave(state, [{ role: 'assistant', content: opening }]);
  app.saveId = state.saveId;
  app.ui = uiState(state);
  app.messages = [{ role: 'assistant', content: opening }];
  $('#custom').classList.add('hidden');
  composerEl.classList.remove('hidden');
  logEl.innerHTML = '';
  const first = addMessage('assistant', opening);
  renderSheet();
  scrollToElement(first);
};

boot();

// 注册 service worker（离线打开用）。
// 新版本接管时自动刷新一次，免得手机上一直看到旧文件。
if ('serviceWorker' in navigator) {
  const hadController = Boolean(navigator.serviceWorker.controller);
  let reloaded = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || reloaded) return;
    reloaded = true;
    location.reload();
  });
  window.addEventListener('load', async () => {
    try {
      const reg = await navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' });
      reg.update().catch(() => {});
    } catch {
      /* 不支持就算了，不影响玩 */
    }
  });
}
