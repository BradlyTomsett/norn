import * as store from './store.js';
import * as llm from './llm.js';
import * as sync from './sync.js';
import { REGIONS, generateWorld, openingText } from './engine/worldgen.js';
import { judge, judgeBrief } from './engine/resolve.js';
import { advanceWorld, engineDelta } from './engine/tick.js';
import { stateBlock, npcCards, uiState, applyDelta } from './engine/state.js';
import { makeRng } from './engine/rng.js';

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
   **不要输出【当前角色】块**（玩家在状态面板里能看）。也不要输出【玩家自由行动】这个小标题。
2. 另起一行输出一个 json 代码块，只写“变化”。
3. 数值都是**增量**；钱换算成铜（1 银 = 100 铜，1 金 = 10000 铜）。
4. relations 只能用下面列出的 npcId，禁止编造。
5. 叙事里不出现数值、等级、经验值。
6. 不替玩家说话或做决定。对话场景中，NPC 说完就停。
7. **装备**：玩家真把东西收进包里时写 "equipment":["长剑（灰）"]，一次最多 3 件，一条只写一种品阶。
8. **稀有度**：品阶只用于武器与护甲；药剂、工具、材料不分级。默认普通；稀少约十件一件；**珍奇是事件不是掉落**；**史诗不随机**；**传说永不自动生成**。
9. **数值上限**：其他任何人的四维上限是 100；玩家是唯一例外。
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

function turnBrief(judged, events, state) {
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
  lines.push(
    '',
    '━━━━━━━━━━',
    '【最后一步，必须做】在【你现在可以做什么】之后，再输出一个 json 代码块，只写增量：',
    '```json',
    '{"money":{"copper":-3},"skills":[{"name":"武艺","delta":0.2}],"relations":[{"npcId":"npc_mother","trust":1,"observable":"她把水接了过去"}],"knowledge":[{"text":"……","source":"听说"}],"mind":{"mood":"有点泄气"},"goals":[],"problems":[]}',
    '```',
    '**没有这个代码块，本回合的钱与关系变化就不会被记录。**',
  );
  return lines.join('\n');
}

const buildSystem = (state, judged, events) =>
  [app.rules, '', app.worldbook, '', RUNTIME, '', '【当前状态】', stateBlock(state), '', '【在场/相关人物】', npcCards(state), '', turnBrief(judged, events, state)].join('\n');

/* ---------------- 文本处理 ---------------- */

function splitDelta(text) {
  const m = text.match(/```json\s*([\s\S]*?)```\s*$/i);
  if (!m) return { text: text.trim(), delta: null };
  const head = text.slice(0, m.index).trim();
  try {
    return { text: head, delta: JSON.parse(m[1]) };
  } catch {
    return { text: head || text.trim(), delta: null };
  }
}

const EMPTY_LINE = /^(【[^】]{1,12}】\s*)?(无|没有|无变化|无进出|无明显变化|无异常|（无）)[。.！!]?$/;

function pruneEmpty(text) {
  const lines = String(text || '').split('\n');
  const out = [];
  let head = null;
  let body = [];
  const flush = () => {
    if (!head) return;
    const kept = [];
    for (const l of body) {
      if (EMPTY_LINE.test(l.trim())) continue;
      if (l.trim() === '' && (kept.length === 0 || kept[kept.length - 1].trim() === '')) continue;
      kept.push(l);
    }
    while (kept.length && kept[kept.length - 1].trim() === '') kept.pop();
    if (kept.length) out.push(head, ...kept);
    head = null;
    body = [];
  };
  for (const line of lines) {
    if (/^【[^】]{1,12}】\s*$/.test(line.trim())) {
      flush();
      head = line;
      body = [];
    } else if (head) body.push(line);
    else out.push(line);
  }
  flush();
  let t = out.join('\n');
  t = t.replace(/(?:^|\n)(?:━{4,}[ \t]*\n){2,}/g, '\n━━━━━━━━━━\n');
  return t.replace(/\n{3,}/g, '\n\n').trim();
}

function stripSheet(text) {
  let t = String(text || '');
  const i = t.indexOf('【当前角色】');
  if (i >= 0) {
    const rest = t.slice(i + 6);
    const m = rest.match(/【世界动态】|【你现在可以做什么】|【玩家自由行动】/);
    t = m ? t.slice(0, i) + rest.slice(m.index) : t.slice(0, i);
  }
  t = t.replace(/\n*(━+\s*)?【玩家自由行动】\s*$/, '');
  return t.replace(/\n{3,}/g, '\n\n').trim();
}

/* ---------------- 渲染 ---------------- */

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function format(raw) {
  return esc(raw)
    .split('\n')
    .map((line) => {
      const t = line.trim();
      if (!t) return '<p>&nbsp;</p>';
      if (/^【[^】]{1,20}】$/.test(t)) return `<p class="sec">${t}</p>`;
      if (/^━+$/.test(t)) return '<p class="rule">────────────</p>';
      return `<p>${line}</p>`;
    })
    .join('');
}

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
  for (const m of app.messages) last = addMessage(m.role === 'user' ? 'user' : 'assistant', m.content);
  renderSheet();
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
  $('#settings').classList.remove('hidden');
}

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
  const events = advanceWorld(state, judged.minutes, rng);

  const bubble = addMessage('assistant', '');
  bubble.classList.add('cursor');
  scrollToElement(bubble);

  let raw = '';
  let frame = null;
  const paint = () => {
    bubble.innerHTML = format(raw) || '<p>&nbsp;</p>';
  };

  try {
    const history = store.getMessages(app.saveId).slice(-14).map((m) => ({ role: m.role, content: m.content }));
    for await (const chunk of llm.streamChat({ system: buildSystem(state, judged, events), messages: history })) {
      raw += chunk;
      if (!frame) {
        frame = requestAnimationFrame(() => {
          frame = null;
          paint();
        });
      }
    }

    const { text: rawText, delta } = splitDelta(raw);
    const cleanText = pruneEmpty(stripSheet(rawText));

    applyDelta(state, engineDelta(judged, state), rng, { bump: false });
    const modelDelta = { ...(delta || {}) };
    delete modelDelta.time;
    delete modelDelta.body;
    applyDelta(state, modelDelta, rng, { bump: true });
    if (state.flags?.pendingAwakening) {
      state.flags.pendingAwakening = false;
      state.flags.awakeningAsked = true;
    }

    store.putSave(state);
    store.appendMessage(app.saveId, 'assistant', cleanText);
    if (sync.ghReady()) {
      sync.backupSave(state).then(() => updateGhStatus()).catch((e) => {
        const el = $('#gh-status');
        if (el) el.textContent = '自动备份失败：' + e.message;
      });
    }
    app.ui = uiState(state);

    bubble.innerHTML = format(cleanText);
    bubble.classList.remove('cursor');
    if (!delta) addMessage('error', '（这一回合模型没有输出数值块，钱与关系未结算。）');
    renderSheet();
    scrollToElement(bubble);
  } catch (err) {
    bubble.classList.remove('cursor');
    addMessage('error', '这一回合失败了：' + err.message);
  } finally {
    app.streaming = false;
    sendEl.disabled = false;
    inputEl.focus();
  }
}

sendEl.onclick = send;
inputEl.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    send();
  }
});
inputEl.addEventListener('input', () => {
  inputEl.style.height = 'auto';
  inputEl.style.height = Math.min(inputEl.scrollHeight, window.innerHeight * 0.4) + 'px';
});

/* ---------------- 角色卡 ---------------- */

const GRADE_ORDER = [
  ['金', '传说', 'legend'],
  ['紫', '史诗', 'epic'],
  ['蓝', '珍奇', 'rare'],
  ['绿', '稀少', 'uncommon'],
  ['灰', '普通', 'common'],
];

function gradeOf(item) {
  const m = item.match(/（([^（）]*)）(?:\s*×\s*\d+\s*)?$/);
  if (!m) return null;
  const tail = m[1];
  for (const [ch] of GRADE_ORDER) {
    if (new RegExp(ch + '(?=\\s|×|/|）|，|,|、|$)').test(tail)) return ch;
  }
  return null;
}

function identityOf(p) {
  const main = String(p.profession || '').split('/')[0].trim();
  const st = p.professionState;
  if (!st || st === 'none') return main || '平民';
  return `${st} 级${main}`;
}

function tierOf(v) {
  if (v >= 100) return '传说';
  if (v >= 80) return '殿堂';
  if (v >= 60) return '宗师';
  if (v >= 50) return '高阶';
  if (v >= 40) return '中阶';
  if (v >= 30) return '初阶';
  if (v >= 20) return '学徒';
  return '平民';
}

const bar = (label, value, cls = '') => `
  <div class="bar-row">
    <div class="lab"><span>${esc(label)}</span><span>${value}</span></div>
    <div class="bar ${cls}"><i style="width:${Math.max(0, Math.min(100, value))}%"></i></div>
  </div>`;

function viewOverview(u) {
  const p = u.player;
  const out = [];
  if (p.talent) {
    out.push(`<div class="talent"><div class="name">${esc(p.talent.name)}</div>
      <div class="eff">${esc(p.talent.effect)}</div>
      ${p.talent.secret ? '<div class="lock">严格保密</div>' : ''}</div>`);
  }
  out.push('<h3>四维</h3><div class="stat-grid">');
  for (const [k, label] of [['body', '体质'], ['agility', '敏捷'], ['wisdom', '智慧'], ['spirit', '精神']]) {
    const v = p.stats[k];
    out.push(`<div class="stat-cell"><div class="k">${label}</div><div class="v">${v}</div><div class="t">${tierOf(v)}</div></div>`);
  }
  out.push('</div>');
  out.push('<h3>状态</h3>');
  out.push(bar('健康', p.body.health, p.body.health < 50 ? 'warn' : 'good'));
  out.push('<h3>处境</h3><div class="rows">');
  out.push(`<div class="row"><span class="k">所在地</span><span class="v">${esc(p.location.siteName)}</span></div>`);
  out.push(`<div class="row"><span class="k">时间</span><span class="v">${esc(u.date)}</span></div>`);
  out.push(`<div class="row"><span class="k">心情</span><span class="v">${esc(p.mind.mood)}</span></div>`);
  out.push(`<div class="row"><span class="k">身份</span><span class="v">${esc(identityOf(p))}</span></div>`);
  const rep = Object.entries(p.reputation || {}).map(([k, v]) => `${k} ${v}`).join('、');
  if (rep) out.push(`<div class="row"><span class="k">声誉</span><span class="v">${esc(rep)}</span></div>`);
  out.push('</div>');
  out.push('<h3>财务</h3><div class="rows">');
  out.push(`<div class="row"><span class="k">现金</span><span class="v">${esc(p.money)}</span></div>`);
  if (p.incomeMonthly) out.push(`<div class="row"><span class="k">月净利</span><span class="v">${p.incomeMonthly.toLocaleString()} 金</span></div>`);
  if (p.debts?.length) out.push(`<div class="row"><span class="k">债务</span><span class="v">${esc(p.debts.map((d) => d.to).join('、'))}</span></div>`);
  out.push('</div>');
  if (p.goals?.length) {
    out.push('<h3>当前目标</h3>');
    for (const g of p.goals) out.push(`<div class="item">${esc(g)}</div>`);
  }
  if (p.problems?.length) {
    out.push('<h3>当前问题</h3>');
    for (const x of p.problems) out.push(`<div class="item">${esc(x)}</div>`);
  }
  if (p.unfinished?.length) {
    out.push('<h3>未完成</h3>');
    for (const x of p.unfinished) out.push(`<div class="item">${esc(x.text || x)}</div>`);
  }
  return out.join('');
}

function viewStats(u) {
  const p = u.player;
  const out = ['<h3>四维</h3><div class="stat-grid">'];
  for (const [k, label] of [['body', '体质'], ['agility', '敏捷'], ['wisdom', '智慧'], ['spirit', '精神']]) {
    const v = p.stats[k];
    out.push(`<div class="stat-cell"><div class="k">${label}</div><div class="v">${v}</div><div class="t">${tierOf(v)}</div></div>`);
  }
  out.push('</div><h3>技能</h3>');
  for (const s of p.skills || []) out.push(bar(s.name, s.level));
  if (p.body.injuries?.length) {
    out.push('<h3>伤</h3>');
    for (const i of p.body.injuries) out.push(`<div class="item">${esc(i.part)}</div>`);
  }
  return out.join('');
}

function viewGear(u) {
  const p = u.player;
  const groups = new Map();
  const others = [];
  for (const e of p.equipment || []) {
    const ch = gradeOf(e);
    if (!ch) {
      others.push(e);
      continue;
    }
    if (!groups.has(ch)) groups.set(ch, []);
    groups.get(ch).push(e);
  }
  const out = [];
  for (const [ch, label, cls] of GRADE_ORDER) {
    const list = groups.get(ch);
    if (!list?.length) continue;
    out.push(`<div class="gear-group"><div class="gh"><span class="badge c-${cls}">${ch}</span><b>${label}</b><span class="note">${list.length} 件</span></div><div class="two-col">`);
    for (const item of list) out.push(`<div class="item">${esc(item)}</div>`);
    out.push('</div></div>');
  }
  if (others.length) {
    out.push(`<div class="gear-group"><div class="gh"><b style="color:var(--ink-dim)">其他物品</b><span class="note">不分品阶 · ${others.length} 件</span></div><div class="two-col">`);
    for (const item of others) out.push(`<div class="item">${esc(item)}</div>`);
    out.push('</div></div>');
  }
  if (!out.length) out.push('<p class="hint">身上没有记下来的东西。</p>');
  if (p.assets?.length) {
    out.push('<h3>资产</h3>');
    for (const a of p.assets) out.push(`<div class="item">${esc(a)}</div>`);
  }
  return out.join('');
}

function viewPeople(u) {
  const list = [...(u.player.relations || [])].sort((a, b) => (b.closeness ?? 0) - (a.closeness ?? 0));
  if (!list.length) return '<p class="hint">还没有记下来的人。</p>';
  const out = [`<p class="hint">共 ${list.length} 人，按亲近程度排。</p><div class="two-col people">`];
  for (const r of list) {
    out.push(`<div class="person"><div class="nm">${esc(r.name)}<span>${esc(r.profession || '')}</span></div><div class="ob">${esc(r.observable || '')}</div></div>`);
  }
  out.push('</div>');
  return out.join('');
}

function viewClues(u) {
  const out = [];
  if (u.knowledge?.length) {
    out.push('<h3>已知</h3>');
    for (const k of [...u.knowledge].reverse()) out.push(`<div class="item">${esc(k.text)}<span class="hint"> — ${esc(k.source || '')}</span></div>`);
  }
  if (u.worldLog?.length) {
    out.push('<h3>世界动态</h3>');
    for (const e of [...u.worldLog].reverse()) out.push(`<div class="item">${esc(e.text)}</div>`);
  }
  if (!out.length) out.push('<p class="hint">还没有什么线索。</p>');
  return out.join('');
}

const VIEWS = { overview: viewOverview, stats: viewStats, gear: viewGear, people: viewPeople, clues: viewClues };

function renderSheet(tab = app.tab) {
  const u = app.ui;
  if (!u) return;
  app.tab = tab;
  dateEl.textContent = u.date.split('·').slice(0, 2).join('·').trim();
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

$('#btn-new').onclick = () => {
  $('#sheet').classList.add('hidden');
  if (!confirm('开新的一局？当前这局不会被删除，可以在存档里找回来。')) return;
  app.saveId = null;
  app.ui = null;
  openWizard();
};

$('#btn-del').onclick = () => {
  if (!app.saveId) return;
  if (!confirm('删掉这一局？无法恢复。')) return;
  store.deleteSave(app.saveId);
  app.saveId = null;
  app.ui = null;
  $('#sheet').classList.add('hidden');
  location.reload();
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
    const path = await sync.backupSave(store.getSave(app.saveId));
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
      const b = document.createElement('button');
      b.className = 'card';
      b.innerHTML = `<b>${esc(f.name)}</b><span>${Math.round(f.size / 1024)} KB</span>`;
      b.onclick = async () => {
        try {
          const state = await sync.restoreSave(f.path);
          state.saveId = store.newId();
          state.createdAt = new Date().toISOString();
          state.label = '来自 GitHub';
          store.putSave(state, []);
          $('#restore').classList.add('hidden');
          loadGame(state.saveId);
          alert('已恢复：' + state.player.name);
        } catch (e) {
          alert('恢复失败：' + e.message);
        }
      };
      box.appendChild(b);
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
  else openWizard();
}

boot();

// 注册 service worker（离线打开用）
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}
