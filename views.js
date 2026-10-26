// 角色卡各标签页的渲染：纯字符串拼接，不碰 DOM，方便单独测试。
import { esc } from './format.js';
import { isConsumable, isSharpeningStone } from './engine/items.js';
import { CATS, gameReferenceRows, gamePriceEntry, priceEntryText } from './engine/economy.js';
import { gearState } from './engine/equipment.js';
import { copperText } from './engine/money.js';
import { priceBounds } from './price-input.js';
import { fixedSkills } from './engine/skills.js';
import { incidentalTask } from './engine/tasks.js';

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
    out.push(`<div class="talent mini"><div class="name">${esc(p.talent.name)}</div>
      <div class="eff">${esc(p.talent.effect)}</div>
      ${p.talent.secret ? '<div class="lock">严格保密</div>' : ''}</div>`);
    if (p.talentRules?.length) out.push(`<details class="talent-rules"><summary>生效的能力</summary>${p.talentRules.map(text => `<p class="hint">${esc(text)}</p>`).join('')}</details>`);
  }
  out.push('<h3>四维</h3><div class="stat-grid mini">');
  for (const [k, label] of [['body', '体质'], ['agility', '敏捷'], ['wisdom', '智慧'], ['spirit', '精神']]) {
    const v = p.stats[k];
    out.push(`<div class="stat-cell"><div class="k">${label}</div><div class="v">${v}</div><div class="t">${tierOf(v)}</div></div>`);
  }
  out.push('</div>');
  out.push('<h3>技能</h3><div class="skill-list">');
  for (const s of fixedSkills(p.skills)) out.push(bar(s.name, s.level));
  out.push('</div>');
  out.push('<h3>状态</h3>');
  out.push(bar('健康', p.body.health, p.body.health < 50 ? 'warn' : 'good'));
  for (const effect of p.effects || []) out.push(`<div class="item">${esc(effect.label)}<span class="hint"> · 药剂效果生效中</span></div>`);
  out.push('<h3>处境</h3><div class="rows">');
  out.push(`<div class="row"><span class="k">所在地</span><span class="v">${esc(p.location.siteName)}</span></div>`);
  out.push(`<div class="row"><span class="k">时间</span><span class="v">${esc(u.date)}</span></div>`);
  out.push(`<div class="row"><span class="k">心情</span><span class="v">${esc(p.mind.mood)}</span></div>`);
  out.push(`<div class="row"><span class="k">身份</span><span class="v">${esc(identityOf(p))}</span></div>`);
  const rep = Object.entries(p.reputation || {}).map(([k, v]) => `${k} ${v}`).join('、');
  if (rep) out.push(`<div class="row"><span class="k">声誉</span><span class="v">${esc(rep)}</span></div>`);
  out.push('</div>');
  out.push('<h3>财务</h3><div class="rows">');
  if (p.accounts && p.accounts.length) {
      for (const a of p.accounts) out.push(`<div class="row"><span class="k">${esc(a.name)}</span><span class="v">${esc(a.text)}</span></div>`);
    } else {
      out.push(`<div class="row"><span class="k">现金</span><span class="v">${esc(p.money)}</span></div>`);
    }
  if (p.work?.text) out.push(`<div class="row"><span class="k">收入</span><span class="v">${esc(p.work.text)}</span></div>`);
  if (p.bills?.length) {
    out.push(`<div class="row"><span class="k">固定收支</span><span class="v">${esc(p.bills.map((b) => `${b.label} ${b.text}`).join('、'))}</span></div>`);
  }
  if (p.debts?.length) {
    for (const d of p.debts) {
      out.push(`<div class="row"><span class="k">欠${esc(d.to)}</span><span class="v">${esc(d.text)}${d.overdueMonths ? ` · 逾期${d.overdueMonths}月` : ''}</span></div>`);
    }
  }
  for (const contract of (p.contracts || (p.contract ? [p.contract] : [])).filter(c => !c.status || c.status === 'active')) {
    const pay = `${Math.floor(contract.copper / 10000)} 金 ${Math.floor((contract.copper % 10000) / 100)} 银 ${contract.copper % 100} 铜`;
    out.push(`<div class="row"><span class="k">${contract.workStatus === 'completed' ? '待领酬' : '手上的活'}</span><span class="v">${esc(contract.label)}（${esc(pay)}）</span></div>`);
  }
  if (p.industries?.length) {
    out.push(`<div class="row"><span class="k">产业</span><span class="v">${esc(p.industries.map((i) => `${i.name}${i.text ? '（' + i.text + '）' : ''}`).join('、'))}</span></div>`);
  }
  out.push('</div>');

  // 账户之间直接转账：不经过模型，点了就生效。「其他」是外部：转出去=花掉，转进来=白得。
  const accs = p.accounts || [];
  if (accs.length >= 1) {
    const opts = (sel, pickOther = false) =>
      accs
        .map((a, i) => `<option value="${esc(a.id)}"${i === sel && !pickOther ? ' selected' : ''}>${esc(a.name)}</option>`)
        .join('') + `<option value="other"${pickOther ? ' selected' : ''}>其他（外部）</option>`;
    out.push(`<div class="tf">
      <div class="tf-row"><span class="k">从</span><select id="tf-from">${opts(0)}</select>
      <span class="k">到</span><select id="tf-to">${opts(accs.length > 1 ? 1 : 0, accs.length === 1)}</select></div>
      <div class="tf-row"><input id="tf-amount" type="number" min="0" step="any" inputmode="decimal" placeholder="金额" />
      <select id="tf-unit"><option value="10000">金</option><option value="100">银</option><option value="1">铜</option></select>
      <button id="tf-do" class="chip">转账</button></div>
      <div class="hint" id="tf-msg">转到「其他」= 直接花掉；从「其他」转进来 = 直接多一笔。</div>
    </div>`);
  }
  if (p.goals?.length) {
    out.push(`<h3>${p.goalsPending ? '旧目标 · 状态待核对' : '当前目标'}</h3>`);
    for (const g of p.goals) out.push(`<div class="item">${esc(g)}</div>`);
  }
  if (p.principles?.length) out.push(`<details><summary>持续说明</summary>${p.principles.map(p => `<div class="item">${esc(p.text)}</div>`).join('')}</details>`);
  if (p.problems?.length) {
    out.push('<h3>当前问题</h3>');
    for (const x of p.problems) out.push(`<div class="item">${esc(x)}</div>`);
  }
  if (p.unfinished?.length) {
    out.push('<h3>未完成</h3>');
    for (const x of p.unfinished.filter(x => !incidentalTask(typeof x === 'string' ? { text: x } : x))) out.push(`<div class="item">${esc(x.text || x)}</div>`);
  }
  return out.join('');
}

// 手动增减：已有物品按类别平铺，点一下就选中；也能直接输新名字
function itemTool(kind, groups, hint) {
  const rows = (groups || [])
    .map((g) => {
      const names = Array.from(new Set((g.names || []).map((n) => String(n).trim()).filter(Boolean)));
      if (!names.length) return '';
      const chips = names
        .map(
          (n) =>
            `<button class="it-pick${g.cls ? ' g-' + g.cls : ''}" data-name="${esc(n)}">${esc(baseName(n))}</button>`,
        )
        .join('');
      return `<div class="it-group"><span class="it-lab">${esc(g.label)}</span>${chips}</div>`;
    })
    .filter(Boolean)
    .join('');
  const picks = rows || '<span class="hint">这一类还没有东西，直接输入新名字。</span>';
  const gradeSel =
    kind === 'gear'
      ? `<select id="it-grade" class="it-grade"><option value="">颜色</option>${['灰', '绿', '蓝', '紫', '金']
          .map((g) => `<option value="${g}">${g}</option>`)
          .join('')}</select>`
      : '';
  return `<div class="itool" data-kind="${kind}">
    <div class="it-picks">${picks}</div>
    <div class="it-row">
      <input id="it-name" class="it-name" placeholder="名字（点上面，或手输）" autocomplete="off" />
      ${gradeSel}
      <input id="it-qty" class="it-qty" type="number" min="1" value="1" inputmode="numeric" />
    </div>
    <div class="it-row">
      <button class="chip" data-item-act="add">＋ 增加</button>
      <button class="chip danger" data-item-act="del">－ 减少</button>
    </div>
    <div class="hint it-msg" id="it-msg">${hint}</div>
  </div>`;
}

// 药品 / 消耗品：药、丸、瓶、罐、水、回血、清醒、气力、夜眼都算
function viewItems(u) {
  const p = u.player;
  const lines = ungradedLines(p);
  const meds = lines.filter(isConsumable);
  const others = lines.filter((l) => !isConsumable(l));
  const out = [];

  const section = (title, list) => {
    if (!list.length) return;
    out.push(`<h3>${title}</h3><div class="two-col">`);
    for (const it of list) out.push(`<div class="item">${esc(it)}</div>`);
    out.push('</div>');
  };

  section('存货', (p.stock || []).map((s) => `${s.name} ×${s.qty}`));
  section('交通工具', (p.vehicles || []).map((s) => `${s.name} ×${s.qty}`));
  section('药品 · 消耗', meds);
  section('其他物品', others);

  if (!out.length) out.push('<p class="hint">身上没带什么东西。</p>');

  const bagUngraded = (p.bag || []).filter((b) => !gradeOf(b.name) || isSharpeningStone(b.name));
  const medNames = bagUngraded.filter((b) => isConsumable(b.name)).map((b) => b.name);
  const otherNames = [
    ...bagUngraded.filter((b) => !isConsumable(b.name)).map((b) => b.name),
    ...(p.equipment || []).filter((e) => !gradeOf(e) || isSharpeningStone(e)),
  ];
  out.push(
    itemTool(
      'items',
      [
        { label: '药品', names: medNames },
        { label: '其他', names: otherNames },
        { label: '存货', names: (p.stock || []).map((s) => s.name) },
        { label: '交通', names: (p.vehicles || []).map((s) => s.name) },
      ],
      '同名会自动累加；带品阶（灰绿蓝紫金）的会进装备页。',
    ),
  );
  return out.join('');
}

// 分配原则：带品阶（灰绿蓝紫金）的进「装备」，没品阶的进「物品」。
const bagLabel = (b) => (b.qty > 1 ? `${b.name} ×${b.qty}` : b.name);

function gradedLines(p) {
  const lines = [];
  for (const e of p.equipment || []) if (gradeOf(e)) lines.push(e);
  for (const b of p.bag || []) if (gradeOf(b.name)) lines.push(bagLabel(b));
  return lines;
}

function ungradedLines(p) {
  const lines = [];
  for (const e of p.equipment || []) if (!gradeOf(e) || isSharpeningStone(e)) lines.push(e);
  for (const b of p.bag || []) if (!gradeOf(b.name) || isSharpeningStone(b.name)) lines.push(bagLabel(b));
  return lines;
}

// 装备名字去掉「（紫）」这类后缀，改用字体颜色表达品阶
const baseName = (s) => String(s || '').replace(/（(灰|绿|蓝|紫|金)(?:[，,]\s*[^）]*)?）/g, '').trim();

function viewGear(u) {
  const p = u.player;
  // 同名（含同品阶）合并成一条，后面写数量
  const counts = new Map();
  for (const e of p.equipment || []) {
    if (!gradeOf(e) || isSharpeningStone(e)) continue;
    const m = String(e).match(/[×xX]\s*(\d+)\s*$/);
    const qty = m ? parseInt(m[1], 10) || 1 : 1;
    const name = m ? String(e).replace(/[×xX]\s*\d+\s*$/, '').trim() : e;
    counts.set(name, (counts.get(name) || 0) + qty);
  }
  for (const b of p.bag || []) {
    if (!gradeOf(b.name) || isSharpeningStone(b.name)) continue;
    counts.set(b.name, (counts.get(b.name) || 0) + b.qty);
  }

  const groups = new Map();
  for (const [name, qty] of counts) {
    const ch = gradeOf(name);
    if (!groups.has(ch)) groups.set(ch, []);
    groups.get(ch).push({ name, qty });
  }

  const out = [];
  for (const [ch, label, cls] of GRADE_ORDER) {
    const list = groups.get(ch);
    if (!list?.length) continue;
    const total = list.reduce((s, x) => s + x.qty, 0);
    out.push(`<div class="gear-group"><div class="gh"><span class="badge c-${cls}">${ch}</span><b>${label}</b><span class="note">${total} 件</span></div><div class="two-col">`);
    for (const item of list) out.push(`<div class="item g-${cls}">${esc(baseName(item.name))} ×${item.qty}</div>`);
    out.push('</div></div>');
  }
  if (!out.length) out.push('<p class="hint">身上还没有带品阶的装备。</p>');
  if (p.assets?.length) {
    out.push('<h3>资产</h3>');
    for (const a of p.assets) out.push(`<div class="item">${esc(a)}</div>`);
  }

  const gearGroups = GRADE_ORDER.map(([ch, label, cls]) => ({
    label,
    cls,
    names: [...counts.keys()].filter((n) => gradeOf(n) === ch),
  }));
  out.push(itemTool('gear', gearGroups, '带品阶的装备，同名再加大一次就是多一件；没品阶的会进物品页。'));
  out.push(viewLoadout(p));
  return out.join('');
}

function viewLoadout(player) {
  const { inventory: owned, loadout, slots } = player.gear || gearState(player);
  const rank = row => GRADE_ORDER.findIndex(([ch]) => ch === row.grade);
  const inventory = [...owned].sort((a, b) => rank(a) - rank(b));
  const weapons = inventory.filter(row => row.kind === 'weapon');
  const selectedWeapons = weapons.filter(row => loadout.weapons.some(selected => selected.key === row.key));
  const color = row => GRADE_ORDER.find(([ch]) => ch === row.grade)?.[2] || 'common';
  const current = selectedWeapons.map(row => {
    const selected = loadout.weapons.find(item => item.key === row.key);
    return `<div class="item g-${color(row)}">${esc(baseName(row.label))} ×${selected.qty}${row.key === loadout.primary ? '<small class="in-use-primary">主用</small>' : ''}</div>`;
  }).join('');
  const worn = (kind, title) => {
    const row = inventory.find(item => item.key === loadout[kind]);
    return `<div class="in-use-worn"><span class="hint">${title}</span>${row ? `<span class="item g-${color(row)}">${esc(baseName(row.label))}</span>` : '<span class="hint">未使用</span>'}</div>`;
  };
  const weaponRows = weapons.map(row => {
    const selected = loadout.weapons.find(item => item.key === row.key);
    return `<div class="loadout-row"><label class="gear-pick"><input type="checkbox" data-gear-weapon="${esc(row.key)}" ${selected ? 'checked' : ''}><span class="g-${color(row)}">${esc(baseName(row.label))}<small>×${row.qty}</small></span></label><label class="gear-qty${selected && row.qty > 1 ? '' : ' hidden'}"><input type="number" data-gear-qty="${esc(row.key)}" aria-label="${esc(row.label)}使用数量" min="1" max="${row.qty}" value="${selected?.qty || (row.stackable ? row.qty : 1)}" inputmode="numeric"></label></div>`;
  }).join('');
  const single = (kind, title) => `<fieldset class="loadout-section"><legend>${title}（最多 1 件）</legend><div class="loadout-choices"><label class="gear-pick"><input type="radio" name="gear-${kind}" value="" ${loadout[kind] ? '' : 'checked'}>不使用</label>${inventory.filter(row => row.kind === kind).map(row => `<label class="gear-pick"><input type="radio" name="gear-${kind}" value="${esc(row.key)}" ${loadout[kind] === row.key ? 'checked' : ''}><span class="g-${color(row)}">${esc(baseName(row.label))}</span></label>`).join('')}</div></fieldset>`;
  return `<section id="gear-in-use"><h3>使用中</h3><p class="hint">武器 ${slots}/9 栏 · 护甲 ${loadout.armor ? 1 : 0}/1 · 盾牌 ${loadout.shield ? 1 : 0}/1</p><div id="gear-current-weapons" class="two-col">${current || '<p class="hint">未使用武器</p>'}</div>${worn('armor', '护甲')}${worn('shield', '盾牌')}<details id="gear-edit"><summary>修改使用装备</summary><div id="loadout-editor"><p class="hint">勾选使用，取消勾选则不使用。同名同品阶的箭矢、投掷武器、匕首可堆叠占一栏；不同品阶分开计数。</p><p id="gear-slot-count" role="status">武器：${slots}/9 栏</p><fieldset class="loadout-section"><legend>武器</legend><div class="loadout-choices">${weaponRows || '<p class="hint">还没有可选择的武器。</p>'}</div></fieldset><label class="gear-primary">主用武器<select id="gear-primary"><option value="">徒手 / 未指定</option>${selectedWeapons.map(row => `<option value="${esc(row.key)}" ${loadout.primary === row.key ? 'selected' : ''}>${esc(row.key)}</option>`).join('')}</select></label>${single('armor', '护甲')}${single('shield', '盾牌')}<button id="gear-save" class="primary">保存常用装备</button></div></details><p id="gear-message" class="hint" role="status"></p></section>`;
}

export function relationColor(value) {
  const v = Math.max(-100, Math.min(100, Number(value) || 0));
  const fade = Math.round(255 * (1 - Math.abs(v) / 100));
  return v < 0 ? `rgb(255, ${fade}, ${fade})` : `rgb(${fade}, 255, ${fade})`;
}
function relationValue(raw) {
  const value = Math.max(-100, Math.min(100, Number(raw) || 0));
  const text = `${value > 0 ? '+' : ''}${value}`;
  return `<div class="relation-stat"><span>亲近</span><output class="relation-value" aria-label="亲近 ${text}" style="color:${relationColor(value)}">${text}</output></div>`;
}
function viewPeople(u) {
  const list = [...(u.player.relations || [])].sort((a, b) => (b.closeness ?? 0) - (a.closeness ?? 0));
  if (!list.length) return '<p class="hint">还没有记下来的人。</p>';
  const out = [`<p class="hint">共 ${list.length} 人，按亲近程度排。</p><div class="two-col people">`];
  for (const r of list) {
    const who = [r.race, r.profession].filter(Boolean).join(' · ');
    out.push(
      `<div class="person"><div class="nm">${esc(r.name)}<span>${esc(who)}</span></div>` +
        (r.loadout?.length ? `<div class="ob">惯用：${esc(r.loadout.join('、'))}</div>` : '') +
        relationValue(r.closeness) +
        ((r.goals || []).some(g => g.status === 'active' && !g.routine) ? `<div class="ob npc-goal">在忙：${esc(r.goals.filter(g => g.status === 'active' && !g.routine).map(g => `${g.text}${g.blockedOn ? `（等待：${g.blockedOn}）` : ''}`).join('；'))}</div>` : '') +
        `<div class="ob">${esc(r.observable || '')}</div></div>`,
    );
  }
  out.push('</div>');
  return out.join('');
}

function viewClues(u) {
  const out = [];
  if (u.storyLog?.length) {
    out.push('<h3>选择留下的后果</h3>');
    for (const e of [...u.storyLog].reverse()) out.push(`<div class="item">${esc(e.text)}${e.cause ? `<span class="hint"> — 起因：${esc(e.cause)}</span>` : ''}</div>`);
  }
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

// 物价表：这份存档自定，AI 报价照它来。可改、可删、可加；价格可以是固定值或范围。
function viewPrices(u) {
  const supplements = map => Object.fromEntries(Object.entries(map || {}).filter(([name]) => gamePriceEntry(name) == null));
  const prices = supplements(u?.prices ?? u?.player?.prices);
  const rates = supplements(u?.rates ?? u?.player?.rates);
  const list = (map, kind) => {
    const rows = Object.entries(map);
    if (!rows.length) return '<p class="hint">还没有条目。</p>';
    return (
      '<div class="price-list">' +
      rows
        .map(
          ([name, val]) => {
            const bounds = priceBounds(val);
            return `<div class="price-row price-bounds" data-price-row data-kind="${kind}" data-name="${esc(name)}"><span class="nm">${esc(name)}</span>`
              + `<label>下限<input class="px-min" type="text" inputmode="numeric" aria-label="${esc(name)}下限（铜）" value="${esc(bounds.min)}" /></label>`
              + `<label>上限<input class="px-max" type="text" inputmode="numeric" aria-label="${esc(name)}上限（铜）" value="${esc(bounds.max)}" /></label></div>`;
          },
        )
        .join('') +
      '</div>'
    );
  };
  const out = [
    '<p class="hint">游戏物价与存档物价都供 AI 生成价格时参考，实际成交以本次谈定金额为准。游戏已有的条目直接参考，不重复存进这份存档。</p>',
    `<details class="game-prices"><summary>游戏物价（内置参考，点击查看）</summary><div class="price-list">${gameReferenceRows().map(row => `<div class="game-price-row"><span>${esc(row.name)}</span><span>${esc(priceEntryText(row.entry))} 铜</span></div>`).join('')}</div>
    <h3>类目估价基准</h3><div class="price-list">${Object.values(CATS).map(row => `<div class="game-price-row"><span>${esc(row.name)} / ${esc(row.unit)}</span><span>${row.base} 铜</span></div>`).join('')}</div></details>`,
    '<h3>存档物价</h3>',
    '<p class="hint">金额单位为铜币。固定价把上下限填成同一个数；只填一边表示仅设下限或上限。两边都清空才会删除该条。</p>',
    '<h3>物品与服务</h3>',
    list(prices, 'prices'),
    '<h3 style="margin-top:18px">服务与活计参考</h3>',
    list(rates, 'rates'),
    '<div class="chips" style="margin-top:10px"><button id="px-save" class="chip">保存改动</button></div>',
    `<h3 style="margin-top:18px">新增一条</h3>
    <div class="price-row price-bounds" style="margin-top:8px">
      <input id="px-name" class="name-input" placeholder="物品或服务名" aria-label="物品或服务名" />
      <label>下限<input id="px-min" class="name-input" inputmode="numeric" aria-label="新增价格下限（铜）" /></label>
      <label>上限<input id="px-max" class="name-input" inputmode="numeric" aria-label="新增价格上限（铜）" /></label>
    </div>
    <div class="chips" style="margin-top:8px">
      <select id="px-kind" class="it-grade" style="flex:0 0 110px">
        <option value="prices">物品/服务</option>
        <option value="rates">活计</option>
      </select>
      <button id="px-add" class="chip">＋ 加进物价表</button>
    </div>
    <div class="hint" id="px-msg"></div>`,
  ];
  return out.join('');
}
function viewTasks(u) {
  const p = u.player, contracts = p.contracts || [], status = { completed: '已完成', cancelled: '已取消', expired: '已过期', archived: '已归档' };
  const contractRow = contract => `<article class="task-entry" data-contract-id="${esc(contract.id)}"><p>${esc(contract.label)}</p><p class="hint">${contract.workStatus === 'completed' ? '已完成，待领酬' : '进行中'} · 约定酬劳 ${esc(copperText(contract.copper))}</p><details><summary>调整酬劳</summary><div class="price-row"><label>铜币<input type="number" min="1" step="1" inputmode="numeric" data-contract-pay="${esc(contract.id)}" aria-label="${esc(contract.label)}酬劳（铜）" value="${Math.round(contract.copper)}"></label><button class="chip" data-contract-save="${esc(contract.id)}">保存酬劳</button></div></details></article>`;
  const active = contracts.filter(row => row.status === 'active' && row.workStatus !== 'completed'), unpaid = contracts.filter(row => row.status === 'active' && row.workStatus === 'completed');
  const row = (task, active) => `<article class="task-entry"><p>${esc(task.text)}</p><p class="hint">${active ? '进行中' : status[task.status] || task.status}${task.dueDay != null ? ` · 截止：${Math.floor(task.dueDay / 365)}年 第${task.dueDay % 365 + 1}天` : ''}${task.completionText ? ` · ${esc(task.completionText)}` : ''}${!active && task.reason ? ` · ${esc(task.reason)}` : ''}</p><div class="chips">${active ? `<button class="chip" data-task="${esc(task.id)}" data-status="completed">标记完成</button><button class="chip" data-task="${esc(task.id)}" data-status="cancelled">取消事项</button>` : incidentalTask(task) ? '' : `<button class="chip" data-task="${esc(task.id)}" data-status="active">重新打开</button>`}</div></article>`;
  const past = contracts.filter(row => row.status !== 'active');
  return '<p class="hint">只保留主要任务、重要调查和关键承诺。碰头、问话、排班等小步骤收进历史，不代表已完成。</p><p id="task-maintenance-status" class="hint" role="status"></p><section id="current-contracts"><h3>当前委托</h3>'
    + (active.map(contractRow).join('') || '<p class="hint">没有进行中的委托。</p>') + '</section>'
    + (unpaid.length ? `<section id="unpaid-contracts"><h3>已完成，待领酬</h3>${unpaid.map(contractRow).join('')}</section>` : '')
    + '<section id="active-tasks"><h3>其他进行中的事项</h3>' + (p.unfinished.filter(task => !incidentalTask(task)).map(task => row(task, true)).join('') || '<p class="hint">没有其他待办事项。</p>') + '</section>'
    + `<details><summary>历史事项（${p.taskHistory.length}）</summary>${[...p.taskHistory].reverse().map(task => row(task, false)).join('')}</details>`
    + (past.length ? `<details><summary>委托记录（${past.length}）</summary>${past.map(contract => `<article class="task-entry"><p>${esc(contract.label)}</p><p class="hint">${contract.status === 'paid' ? '已完成、已结算' : '已结束'}${contract.paidCopper != null ? ` · 实收 ${esc(copperText(contract.paidCopper))}` : ''}</p></article>`).join('')}</details>` : '');
}
const VIEWS = { overview: viewOverview, items: viewItems, gear: viewGear, people: viewPeople, clues: viewClues, prices: viewPrices, tasks: viewTasks };


export { VIEWS, viewOverview, viewItems, viewGear, viewPeople, viewClues, viewPrices };
