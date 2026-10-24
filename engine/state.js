// 状态的创建、增量应用、校验、序列化。
import { advanceClock, formatDate, monthOf, dayOfMonth, SEASON_CN, WEATHER_CN, seasonOf } from './clock.js';
import {
  accountOf,
  accountsText,
  addCopper,
  copperText,
  ensureAccounts,
  fromCopper,
  moneyText,
  totalCopper,
  transferCopper,
} from './money.js';
import { priceOf, rollBounty, sellOf } from './economy.js';
import { addDebt, debtText, ensureBills, ensureDebts, ensureWork, openDebts, payDebt, workOf } from './ledger.js';
import { ensureAssets, assetsText } from './assets.js';
import { repText } from './reputation.js';
import { effectOf, isContainer, parseContainer, parseItemEntry } from './items.js';
import { chronicleText } from './chronicle.js';

export {
  accountOf,
  accountsText,
  addCopper,
  copperText,
  ensureAccounts,
  fromCopper,
  moneyText,
  totalCopper,
  transferCopper,
};

export const RACES = ['human', 'elf', 'orc', 'dwarf'];
export const RACE_CN = { human: '人类', elf: '精灵', halfelf: '半精灵', orc: '兽人', dwarf: '矮人', dragonkin: '龙裔', underdark: '地穴人', highland: '高原人' };

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const n = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

/** 把「A（金）、B、C（均紫）」这类合并写法拆成一条一件。 */
export function normalizeEquipment(raw) {
  const s = String(raw || '').trim();
  if (!s) return [];
  if (!/[、,，;；]/.test(s)) return [s];
  const parts = s.split(/[、,，;；]+/).map((x) => x.trim()).filter(Boolean);
  const out = [];
  const graded = /（[金紫蓝绿灰](?:\s*×\s*\d+)?）/;
  for (const p of parts) {
    const m = p.match(/^(.+?)（(均)?([金紫蓝绿灰])）$/);
    if (!m) {
      out.push(p);
      continue;
    }
    const name = m[1].trim();
    const jun = Boolean(m[2]);
    const grade = m[3];
    if (jun) {
      // 「均紫」：把它前面还没有品阶的几条一起补上
      for (let k = out.length - 1; k >= 0; k--) {
        if (graded.test(out[k])) break;
        out[k] = `${out[k]}（${grade}）`;
      }
    }
    out.push(`${name}（${grade}）`);
  }
  return out;
}

/* ---------------- 随身货物 ---------------- */

export function bagOf(state) {
  const p = state.player;
  if (!Array.isArray(p.bag)) p.bag = [];
  return p.bag;
}

export function bagAdd(state, name, qty) {
  const bag = bagOf(state);
  const key = String(name).slice(0, 40);
  const found = bag.find((x) => x.name === key);
  if (found) found.qty += qty;
  else bag.push({ name: key, qty });
  if (bag.length > 80) bag.splice(0, bag.length - 80);
}

export function bagTake(state, name, qty) {
  const bag = bagOf(state);
  const found = bag.find((x) => x.name === String(name));
  if (!found || found.qty < qty) return false;
  found.qty -= qty;
  if (found.qty <= 0) bag.splice(bag.indexOf(found), 1);
  return true;
}

export function bagText(state) {
  const bag = bagOf(state);
  if (!bag.length) return '';
  return bag.map((x) => `${x.name}×${x.qty}`).join('、');
}

/* ---------------- 账目日志 ---------------- */

export function logLedger(state, text) {
  state.ledgerLog ||= [];
  state.ledgerLog.push({ year: state.clock.year, doy: state.clock.doy, text: String(text).slice(0, 100) });
  if (state.ledgerLog.length > 40) state.ledgerLog = state.ledgerLog.slice(-40);
}

const toList = (v) => (!v ? [] : Array.isArray(v) ? v : [v]);

/** 交易：模型只说买卖什么，价格由 economy 算，钱从指定账户走。 */
function settleTrade(state, trade, rejected) {
  ensureAccounts(state);
  const acc = accountOf(state, trade?.account || 'cash');
  if (!acc) {
    rejected.push(`没有账户「${trade?.account}」`);
    return;
  }

  for (const it of toList(trade?.sell)) {
    const name = String(it?.name || it?.item || '').trim();
    const qty = Math.max(1, Math.round(n(it?.qty) || 1));
    if (!name) continue;
    if (!bagTake(state, name, qty)) {
      rejected.push(`身上没有 ${name}`);
      continue;
    }
    const p = sellOf(state, name, { qty });
    addCopper(state, acc.id, p.total);
    logLedger(state, `卖了 ${name}×${qty}，得 ${copperText(p.total)}`);
  }

  for (const it of toList(trade?.buy)) {
    const name = String(it?.name || it?.item || '').trim();
    const qty = Math.max(1, Math.round(n(it?.qty) || 1));
    if (!name) continue;
    const p = priceOf(state, name, { qty, cat: it?.cat, grade: it?.grade });
    if (acc.copper < p.total) {
      rejected.push(`钱不够：${name}×${qty} 要 ${copperText(p.total)}`);
      continue;
    }
    addCopper(state, acc.id, -p.total);
    if (!p.noBag) bagAdd(state, name, qty);
    logLedger(state, `买了 ${name}×${qty}，花 ${copperText(p.total)}`);
  }
}

/** 赏金：金额按威胁等级由引擎开，结算档位影响实收。 */
function settleBounty(state, bounty, rng, judged, rejected) {
  const mul =
    judged?.outcome === 'crush' ? 1.2 : judged?.outcome === 'fail' ? 0.4 : judged?.outcome === 'disaster' ? 0 : 1;
  for (const b of toList(bounty).slice(0, 1)) {
    const pay = Math.round(rollBounty(state, b?.tier, rng) * mul);
    if (pay <= 0) {
      rejected.push('这趟活一分钱没拿到');
      continue;
    }
    addCopper(state, b?.account || 'cash', pay);
    logLedger(state, `赏金：${b?.label ? b.label + '，' : ''}${copperText(pay)}`);
  }
}

/** 人情：给钱的收益按"相当于对方几个月收入"折算，送穷人比送富人有用。 */
function settleGift(state, gift) {
  for (const g of toList(gift).slice(0, 3)) {
    const amount = Math.round(n(g?.copper));
    if (amount <= 0) continue;
    const acc = accountOf(state, g?.account || 'cash');
    if (!acc || acc.copper < amount) continue;
    addCopper(state, acc.id, -amount);
    const npc = state.npcs.find((x) => x.id === g?.to);
    const rel = state.player.relations.find((x) => x.npcId === g?.to);
    if (rel) {
      const income = Math.max(1, (workOf(npc?.profession || '', 'journeyman').daily || 120) * 30);
      const months = amount / income;
      rel.trust = clamp(rel.trust + Math.round(Math.log2(1 + months) * 6), -100, 100);
      rel.closeness = clamp(rel.closeness + Math.round(Math.log2(1 + months) * 3), -100, 100);
      rel.lastTouch = (state.clock.year || 0) * 365 + (state.clock.doy || 0);
    }
    logLedger(state, `送了${npc?.name || '人'}一份人情，${copperText(amount)}`);
  }
}

function settleProfession(state, prof) {
  const name = String(prof?.name || '').trim().slice(0, 20);
  if (!name) return;
  const st = ['none', 'apprentice', 'journeyman', 'master', 'guildmaster'].includes(prof?.state)
    ? prof.state
    : 'none';
  state.player.profession = name;
  state.player.professionState = st;
  const w = workOf(name, st);
  state.player.work = { ...w, profession: name, state: st };
  logLedger(state, `现在是${name}${w.type === 'bounty' ? '，靠赏金过活' : w.daily ? `，日薪 ${copperText(w.daily)}` : ''}`);
}

function settleDebts(state, delta, rejected) {
  if (delta?.payDebt) {
    for (const r of payDebt(state, delta.payDebt)) {
      if (r.ok) logLedger(state, r.text);
      else rejected.push(r.text);
    }
  }
  if (delta?.borrow) {
    for (const b of toList(delta.borrow).slice(0, 1)) {
      const amount = Math.round(n(b?.copper));
      if (amount <= 0) continue;
      const d = addDebt(state, {
        to: b?.from || b?.to,
        copper: amount,
        months: n(b?.months) || 12,
        rate: n(b?.rate) || 0.03,
        note: b?.note,
      });
      if (d) {
        addCopper(state, b?.account || 'cash', amount);
        logLedger(state, `借了${d.to} ${copperText(amount)}，月息 ${(d.rate * 100).toFixed(0)}%`);
      }
    }
  }
}

function settleItems(state, items) {
  for (const it of toList(items).slice(0, 8)) {
    const raw = typeof it === 'string' ? it : it?.name;
    if (!raw) continue;
    if (isContainer(raw)) {
      for (const sub of parseContainer(raw)) bagAdd(state, sub.name, sub.qty);
      continue;
    }
    const parsed = parseItemEntry(raw);
    if (!parsed) continue;
    const qty = Math.max(1, Math.round(n(it?.qty) || parsed.qty || 1));
    bagAdd(state, parsed.label, qty);
  }
}

/** 用药/用道具：只扣数量，效果落到数值上（没有数值效果的只记账）。 */
function settleUse(state, use, rejected) {
  for (const it of toList(use).slice(0, 3)) {
    const name = String(it?.name || it || '').trim();
    const qty = Math.max(1, Math.round(n(it?.qty) || 1));
    if (!name) continue;
    if (!bagTake(state, name, qty)) {
      rejected.push(`身上没有 ${name}`);
      continue;
    }
    const eff = effectOf(name);
    if (!eff) {
      logLedger(state, `用了 ${name}×${qty}`);
      continue;
    }
    if (eff.health) state.player.body.health = clamp(state.player.body.health + eff.health, 0, 100);
    if (eff.fatigue) state.player.body.fatigue = clamp(state.player.body.fatigue + eff.fatigue, 0, 100);
    if (eff.stress) state.player.mind.stress = clamp(state.player.mind.stress + eff.stress, 0, 100);
    logLedger(state, `${eff.text}（${name}×${qty}）`);
  }
}

/** 把一次输出的增量（LLM 提议）安全地合入状态。返回被拒绝的条目。 */
export function applyDelta(state, delta, rng, opts = {}) {
  const rejected = [];
  if (!delta || typeof delta !== 'object') return { rejected };

  // 时间
  const minutes = n(delta?.time?.minutes);
  if (minutes > 0) {
    const { clock } = advanceClock(state.clock, Math.min(minutes, 60 * 24 * 30), rng);
    state.clock = clock;
  }

  // 钱（多账户；账户之间随时可调，不计运费）
  ensureAccounts(state);
  ensureAssets(state);
  if (delta?.money && typeof delta.money === 'object') {
    const m = delta.money;
    // 旧写法 gold/silver/copper 一律算「随身」
    const legacy = n(m.gold) * 10000 + n(m.silver) * 100 + n(m.copper);
    if (legacy) addCopper(state, 'cash', legacy);

    // 新写法：{ cash: -300, home: 1800000, workshop: 2500 }（单位：铜）
    for (const [k, v] of Object.entries(m)) {
      if (['gold', 'silver', 'copper', 'transfer', 'note'].includes(k)) continue;
      const amount =
        typeof v === 'number' ? v : n(v?.copper) + n(v?.silver) * 100 + n(v?.gold) * 10000;
      if (!amount) continue;
      if (!addCopper(state, k, amount)) rejected.push(`没有账户「${k}」`);
    }

    // 账户间转账：[{from:'home', to:'cash', copper:50000}]
    const trs = m.transfer ? (Array.isArray(m.transfer) ? m.transfer : [m.transfer]) : [];
    for (const t of trs) {
      const from = t?.from;
      const to = t?.to;
      const amount = n(t?.copper) + n(t?.silver) * 100 + n(t?.gold) * 10000;
      if (!from || !to || !amount) continue;
      if (!transferCopper(state, from, to, amount)) rejected.push(`转账失败：${from} → ${to}`);
    }
  }

  // 以下都由引擎结算金额，模型只给意图
  if (delta?.trade) settleTrade(state, delta.trade, rejected);
  if (delta?.bounty) settleBounty(state, delta.bounty, rng, opts.judged, rejected);
  if (delta?.payDebt || delta?.borrow) settleDebts(state, delta, rejected);
  if (delta?.profession) settleProfession(state, delta.profession);
  if (delta?.items) settleItems(state, delta.items);
  if (delta?.use) settleUse(state, delta.use, rejected);
  if (delta?.gift) settleGift(state, delta.gift);

  // 身体 / 精神
  for (const key of ['health', 'fatigue', 'hunger']) {
    const d = n(delta?.body?.[key]);
    if (d) state.player.body[key] = clamp(state.player.body[key] + d, 0, 100);
  }
  for (const key of ['stress', 'morale']) {
    const d = n(delta?.mind?.[key]);
    if (d) state.player.mind[key] = clamp(state.player.mind[key] + d, 0, 100);
  }
  if (typeof delta?.mind?.mood === 'string' && delta.mind.mood.trim()) {
    state.player.mind.mood = delta.mind.mood.trim().slice(0, 24);
  }

  // 伤
  if (Array.isArray(delta?.body?.injuries)) {
    for (const inj of delta.body.injuries.slice(0, 3)) {
      if (!inj || typeof inj.part !== 'string') continue;
      state.player.body.injuries.push({
        part: String(inj.part).slice(0, 12),
        severity: ['graze', 'light', 'heavy', 'critical', 'maimed'].includes(inj.severity) ? inj.severity : 'light',
        healDay: state.clock.doy + Math.max(1, n(inj.days) || 3),
        note: String(inj.note || '').slice(0, 40),
      });
    }
  }

  // 技能：数值只由引擎涨（见 progress.js）。模型最多只能开一个新技能的名字。
  if (Array.isArray(delta?.skills)) {
    for (const s of delta.skills.slice(0, 3)) {
      const name = typeof s === 'string' ? s : s?.name;
      if (!name || typeof name !== 'string' || !name.trim()) continue;
      const key = name.trim().slice(0, 12);
      if (!state.player.skills.some((x) => x.name === key)) {
        state.player.skills.push({ name: key, level: 1, xp: 0 });
      }
    }
  }

  // 关系（只允许已存在的 NPC）
  if (Array.isArray(delta?.relations)) {
    for (const r of delta.relations.slice(0, 6)) {
      const npc = state.npcs.find((x) => x.id === r?.npcId);
      if (!npc) {
        rejected.push(`未知 NPC：${r?.npcId}`);
        continue;
      }
      const rel = state.player.relations.find((x) => x.npcId === npc.id);
      if (!rel) continue;
      const dTrust = n(r.trust);
      const dClose = n(r.closeness);
      const obs = typeof r.observable === 'string' ? r.observable.trim() : '';
      const obsOk = Boolean(obs) && !/^[（(]?\s*(无变化|没有变化|无|未变|不变|同上|略)\s*[）)]?$/.test(obs);
      if (!dTrust && !dClose && !obsOk) continue; // 整条都是「无变化」，直接跳过
      rel.trust = clamp(rel.trust + dTrust, -100, 100);
      rel.closeness = clamp(rel.closeness + dClose, -100, 100);
      rel.lastTouch = (state.clock.year || 0) * 365 + (state.clock.doy || 0);
      if (obsOk) rel.observable = obs.slice(0, 60);
    }
  }

  // 装备（只增不减：丢东西需要玩家明确说）
  if (Array.isArray(delta?.equipment)) {
    let added = 0;
    for (const e of delta.equipment.slice(0, 3)) {
      const name = typeof e === 'string' ? e : e?.name;
      if (!name) continue;
      for (const item of normalizeEquipment(name)) {
        if (added >= 8) break;
        const s = String(item).slice(0, 40);
        if (state.player.equipment.includes(s)) continue;
        state.player.equipment.push(s);
        added++;
      }
    }
    if (state.player.equipment.length > 60) state.player.equipment = state.player.equipment.slice(-60);
  }

  // 知识与未完成
  const pushKnowledge = (list) => {
    for (const k of (Array.isArray(list) ? list : []).slice(0, 4)) {
      const text = typeof k === 'string' ? k : k?.text;
      if (!text) continue;
      const clean = String(text).trim();
      if (!clean || /^[（(]?\s*(无变化|没有变化|无|同上|略)\s*[）)]?$/.test(clean)) continue;
      state.knowledge.push({
        text: clean.slice(0, 80),
        source: typeof k === 'object' && k.source ? String(k.source).slice(0, 20) : '亲历',
        day: state.clock.doy,
      });
    }
    if (state.knowledge.length > 60) state.knowledge = state.knowledge.slice(-60);
  };
  pushKnowledge(delta?.knowledge);
  pushKnowledge(delta?.newInfo);

  if (Array.isArray(delta?.unfinished)) {
    for (const u of delta.unfinished.slice(0, 3)) {
      const text = typeof u === 'string' ? u : u?.text;
      if (text) state.player.unfinished.push({ text: String(text).slice(0, 60), openedDay: state.clock.doy });
    }
    if (state.player.unfinished.length > 12) state.player.unfinished = state.player.unfinished.slice(-12);
  }

  if (Array.isArray(delta?.goals)) {
    const g = delta.goals.filter((x) => typeof x === 'string' && x.trim()).map((x) => x.slice(0, 60));
    if (g.length) state.player.goals = g.slice(0, 3);
  }
  if (Array.isArray(delta?.problems)) {
    const p = delta.problems.filter((x) => typeof x === 'string' && x.trim()).map((x) => x.slice(0, 60));
    if (p.length) state.player.problems = p.slice(0, 3);
  }

  state.turn = (state.turn || 0) + (opts.bump === false ? 0 : 1);
  return { rejected };
}

/** 给模型的紧凑状态块（也是 UI 的数据源之一）。 */
export function stateBlock(state) {
  ensureAssets(state);
  const p = state.player;
  const lines = [];
  lines.push(`【时间】${formatDate(state.clock)}`);
  lines.push(`【地点】${p.location.siteName}（${state.world.regionTitle}）｜物价指数 ${(state.world.priceIndex || 1).toFixed(2)}`);
  lines.push(
    `【角色】${p.name}｜${p.age} 岁｜${RACE_CN[p.race] || p.race}｜${p.profession}（${p.professionState}）`,
  );
  lines.push(`【四维】体质 ${p.stats.body} 敏捷 ${p.stats.agility} 智慧 ${p.stats.wisdom} 精神 ${p.stats.spirit}`);
  const inj = p.body.injuries.length
    ? '｜' + p.body.injuries.map((i) => `${i.part}${i.note ? '(' + i.note + ')' : ''}`).join('、')
    : '';
  lines.push(`【身体】健康 ${p.body.health} 疲劳 ${p.body.fatigue} 饥饿 ${p.body.hunger}${inj}`);
  lines.push(`【精神】${p.mind.mood}｜压力 ${p.mind.stress}｜士气 ${p.mind.morale}`);
  if (p.talent) {
    const t = p.talent;
    lines.push(`【天赋】${t.name}（${t.grade}）：${t.effect}${t.secret ? '｜**必须严格保密**' : ''}`);
  }
  lines.push(`【账户】${accountsText(state)}`);
  const work = ensureWork(state);
  if (work.type === 'wage' && work.daily) {
    lines.push(`【收入】${work.label}：日薪 ${copperText(work.daily)}（约 ${copperText(work.daily * 30)}/月，由引擎发放）`);
  } else if (work.type === 'bounty') {
    lines.push('【收入】没有固定收入，全靠赏金；赏金数额由引擎按威胁等级开，你只写事情办没办成。');
  } else {
    lines.push('【收入】现在没有固定收入。');
  }
  const bills = ensureBills(state);
  if (bills.length) {
    const every = { day: '每天', week: '每周', month: '每月', year: '每年' };
    lines.push(`【固定收支】${bills.map((b) => `${b.label} ${copperText(b.amount)}／${every[b.every] || '每月'}`).join('；')}`);
  }
  const debts = openDebts(state);
  if (debts.length) lines.push(`【债务】${debts.map((d) => debtText(state, d)).join('；')}`);
  const bagAll = bagText(state);
  if (bagAll) lines.push(`【随身货物】${bagAll}`);
  const assetsAll = assetsText(state);
  if (assetsAll) lines.push(`【资产】${assetsAll}`);
  if (p.equipment?.length) lines.push(`【装备】${p.equipment.join('、')}`);
  if (p.skills.length) lines.push(`【技能】${p.skills.map((s) => `${s.name} ${s.level}`).join('、')}`);
  lines.push(`【身份】${p.socialClass}｜声誉：${repText(p.reputation)}`);
  if (p.relations.length) {
    lines.push('【关系】');
    for (const r of p.relations) {
      const npc = state.npcs.find((x) => x.id === r.npcId);
      lines.push(`  · ${npc?.name || r.npcId}（${npc?.profession || ''}）：${r.observable || '点头之交'}`);
    }
  }
  if (p.goals.length) lines.push(`【当前目标】${p.goals.join('；')}`);
  if (p.problems.length) lines.push(`【当前问题】${p.problems.join('；')}`);
  if (p.unfinished.length) lines.push(`【未完成】${p.unfinished.map((u) => u.text).join('；')}`);
  if (state.ledgerLog?.length) {
    lines.push('【最近账目】（引擎结算，叙事以这些为准，不要改数）');
    for (const l of state.ledgerLog.slice(-6)) lines.push(`  · ${l.text}`);
  }
  const chron = chronicleText(state, 6);
  if (chron) {
    lines.push('【编年】（更早发生的事，回忆优先按这个来）');
    for (const l of chron.split('\n')) lines.push(`  · ${l}`);
  }
  if (state.knowledge.length) {
    lines.push('【玩家已知】（只能用这些）');
    for (const k of state.knowledge.slice(-12)) lines.push(`  · ${k.text}（${k.source}）`);
  }
  return lines.join('\n');
}

/** 给模型的 NPC 卡（含 id，方便它写 relations）。 */
export function npcCards(state) {
  return state.npcs
    .map((npc) => {
      const v = npc.voice || {};
      return [
        `· [${npc.id}] ${npc.name}｜${npc.age} 岁｜${RACE_CN[npc.race] || npc.race}｜${npc.profession}`,
        `  说话：词汇 ${v.vocabulary || 2}/5，${v.sentence || 'short'} 句，礼貌 ${v.politeness ?? 1}/3，口癖「${(v.tics || []).join('、') || '无'}」，比喻取自${v.metaphor || '日常'}`,
        `  在意：${npc.obsession || '无'}｜性格：${(npc.traits || []).join('、') || '普通'}`,
        npc.loadout?.length ? `  惯用：${npc.loadout.join('、')}` : null,
      ]
        .filter(Boolean)
        .join('\n');
    })
    .join('\n');
}

export function uiState(state) {
  ensureAccounts(state); // 老存档读的时候就把 wallet 迁成 cash
  ensureAssets(state);
  const p = state.player;
  return {
    saveId: state.saveId,
    turn: state.turn,
    date: formatDate(state.clock),
    calendar: {
      year: state.clock.year,
      month: monthOf(state.clock.doy),
      day: dayOfMonth(state.clock.doy),
      season: SEASON_CN[seasonOf(state.clock.doy)],
      weather: WEATHER_CN[state.clock.weather],
    },
    world: state.world,
    player: {
      name: p.name,
      age: p.age,
      race: RACE_CN[p.race] || p.race,
      profession: p.profession,
      professionState: p.professionState,
      stats: p.stats,
      body: p.body,
      mind: p.mind,
      money: moneyText(p.wallet),
      accounts: (p.accounts || []).map((a) => ({
        id: a.id,
        name: a.name,
        copper: a.copper,
        text: moneyText(fromCopper(a.copper)),
      })),
      wallet: p.wallet,
      debts: openDebts(state).map((d) => ({
        to: d.to,
        remaining: d.remaining,
        text: copperText(d.remaining),
        rate: d.rate,
        due: d.due,
        overdueMonths: d.overdueMonths,
      })),
      bag: bagOf(state),
      work: (() => {
        const w = ensureWork(state);
        const text =
          w.type === 'wage' && w.daily
            ? `日薪 ${copperText(w.daily)}`
            : w.type === 'bounty'
              ? '靠赏金，无固定收入'
              : '无固定收入';
        return { ...w, text };
      })(),
      bills: ensureBills(state).map((b) => ({
        ...b,
        text: `${copperText(b.amount)}／${{ day: '天', week: '周', month: '月', year: '年' }[b.every] || '月'}`,
      })),
      assets: p.assets,
      industries: (p.industries || []).map((i) => ({
        ...i,
        text: i.monthly ? `${copperText(i.monthly)}／月` : '未定',
      })),
      livestock: p.livestock,
      stock: p.stock,
      skills: p.skills,
      socialClass: p.socialClass,
      reputation: p.reputation,
      reputationText: repText(p.reputation),
      talent: p.talent || null,
      equipment: p.equipment || [],
      incomeMonthly: p.incomeMonthly || 0,
      location: p.location,
      goals: p.goals,
      problems: p.problems,
      unfinished: p.unfinished,
      relations: p.relations.map((r) => {
        const npc = state.npcs.find((x) => x.id === r.npcId);
        return {
          name: npc?.name || r.npcId,
          race: RACE_CN[npc?.race] || npc?.race || '',
          profession: npc?.profession || '',
          loadout: npc?.loadout || [],
          observable: r.observable,
          trust: r.trust,
          closeness: r.closeness,
        };
      }),
    },
    knowledge: state.knowledge.slice(-10),
    ledgerLog: (state.ledgerLog || []).slice(-6),
    worldLog: (state.worldLog || []).slice(-8),
    priceIndex: state.world.priceIndex || 1,
  };
}
