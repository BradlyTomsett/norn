// 角色卡各标签页的渲染：纯字符串拼接，不碰 DOM，方便单独测试。
import { esc } from './format.js';

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
  }
  out.push('<h3>四维</h3><div class="stat-grid mini">');
  for (const [k, label] of [['body', '体质'], ['agility', '敏捷'], ['wisdom', '智慧'], ['spirit', '精神']]) {
    const v = p.stats[k];
    out.push(`<div class="stat-cell"><div class="k">${label}</div><div class="v">${v}</div><div class="t">${tierOf(v)}</div></div>`);
  }
  out.push('</div>');
  if (p.skills?.length) {
    out.push('<h3>技能</h3>');
    for (const s of p.skills) out.push(bar(s.name, s.level));
  }
  if (p.body.injuries?.length) {
    out.push('<h3>伤</h3>');
    for (const i of p.body.injuries) out.push(`<div class="item">${esc(i.part)}</div>`);
  }
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
  if (p.industries?.length) {
    out.push(`<div class="row"><span class="k">产业</span><span class="v">${esc(p.industries.map((i) => `${i.name}${i.text ? '（' + i.text + '）' : ''}`).join('、'))}</span></div>`);
  }
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

// 药品 / 消耗品：药、丸、瓶、罐、水都算
const MED_RE = /药|丹|膏|汤|散|丸|瓶|罐|水/;

function viewItems(u) {
  const p = u.player;
  const bag = p.bag || [];
  const meds = bag.filter((b) => MED_RE.test(b.name));
  const others = bag.filter((b) => !MED_RE.test(b.name));
  const out = [];

  const section = (title, list) => {
    if (!list.length) return;
    out.push(`<h3>${title}</h3><div class="two-col">`);
    for (const it of list) out.push(`<div class="item">${esc(it)}</div>`);
    out.push('</div>');
  };

  section('存货', (p.stock || []).map((s) => `${s.name} ×${s.qty}`));
  section('牲畜', (p.livestock || []).map((s) => `${s.name} ×${s.qty}`));
  section('药品 · 消耗', meds.map((b) => `${b.name} ×${b.qty}`));
  section('其他物品', others.map((b) => `${b.name} ×${b.qty}`));

  if (!out.length) out.push('<p class="hint">身上没带什么东西。</p>');
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

const VIEWS = { overview: viewOverview, items: viewItems, gear: viewGear, people: viewPeople, clues: viewClues };


export { VIEWS, viewOverview, viewItems, viewGear, viewPeople, viewClues };
