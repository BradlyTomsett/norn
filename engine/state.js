// 状态的创建、增量应用、校验、序列化。
import { advanceClock, dateLine, formatDate, monthOf, dayOfMonth, SEASON_CN, WEATHER_CN, seasonOf } from './clock.js';
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
import { builtinReferenceText, gamePriceEntry, isService, learnPrice, learnRate, parsePriceEntry, priceEntryText, priceEntryValue, priceOf, rateOf, rollBounty, sellOf } from './economy.js';
import { addDebt, debtText, ensureBills, ensureDebts, ensureWork, openDebts, payDebt, workOf } from './ledger.js';
import { ensureAssets, assetsText } from './assets.js';
import { repText } from './reputation.js';
import { addItem, effectOf, isContainer, normalizeItems, parseContainer, parseItemEntry, removeItem } from './items.js';
import { chronicleText } from './chronicle.js';
import { assignState, upgradeState, absoluteDay, closenessOf } from './schema.js';
import { applyTasks } from './tasks.js';
import { textId } from './entities.js';
import { applyStoryDelta, ensureNpcState, relevantNpcs } from './npcs.js';
import { selectRelevant, memoryContext, linkKnowledge } from './memory.js';
import { npcLabel } from './entities.js';
import { gearState } from './equipment.js';
import { talentRuleText } from './abilities.js';
import { isRetiredPostalQuote } from './retired-prices.js';

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

/** Saved references contain supplements only; game prices are sent directly from economy.js. */
export function ensurePriceTable(state) {
  if (!state.prices || typeof state.prices !== 'object') state.prices = {};
  if (!state.rates || typeof state.rates !== 'object') state.rates = {};
  for (const [name, v] of Object.entries(state.prices)) {
    if (gamePriceEntry(name) != null || isRetiredPostalQuote(name, v)) { delete state.prices[name]; continue; }
    if (!isService(name)) continue;
    if (!state.rates[name]) {
      state.rates[name] = v;
    }
    delete state.prices[name];
  }
  for (const [name, value] of Object.entries(state.rates)) if (gamePriceEntry(name) != null || isRetiredPostalQuote(name, value)) delete state.rates[name];
}
export function logLedger(state, text) {
  state.ledgerLog ||= [];
  state.ledgerLog.push({ year: state.clock.year, doy: state.clock.doy, text: String(text).slice(0, 100) });
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
    const removed = removeItem(state, name, qty);
    if (!removed.ok || removed.count !== qty) {
      rejected.push(`身上没有 ${name}`);
      continue;
    }
    const quoted = Math.round(n(it?.copper ?? it?.amount) || 0);
    let total;
    if (quoted > 0) {
      total = quoted; // 模型按物价表谈定的价钱
    } else {
      const p = sellOf(state, name, { qty });
      total = p.total;
    }
    addCopper(state, acc.id, total);
    logLedger(state, `卖了 ${name}×${qty}，得 ${copperText(total)}`);
  }

  for (const it of toList(trade?.buy)) {
    const name = String(it?.name || it?.item || '').trim();
    const qty = Math.max(1, Math.round(n(it?.qty) || 1));
    if (!name) continue;
    const quoted = Math.round(n(it?.copper ?? it?.amount) || 0);
    if (isRetiredPostalQuote(name, quoted)) { rejected.push('这条寄信金额已确认为错误，不予结算'); continue; }
    let total = quoted;
    let noBag = priceOf(state, name, { qty, cat: it?.cat, grade: it?.grade }).noBag || isService(name);
    if (total <= 0) {
      const p = priceOf(state, name, { qty, cat: it?.cat, grade: it?.grade });
      total = p.total;
      noBag = p.noBag;
    }
    if (acc.copper < total) {
      rejected.push(`钱不够：${name}×${qty} 要 ${copperText(total)}`);
      continue;
    }
    addCopper(state, acc.id, -total);
    if (!noBag) addItem(state, name, qty);
    logLedger(state, `买了 ${name}×${qty}，花 ${copperText(total)}`);
  }
}

/** 赏金：金额按威胁等级由引擎开，结算档位影响实收。 */
/* 接活时定死酬劳，交活时按 100% / 50% / 0% 结算。 */
const BOUNTY_RESULT = {
  完成: 1, 做完: 1, 全: 1, full: 1, done: 1, complete: 1, completed: 1,
  一半: 0.5, 半: 0.5, half: 0.5, partial: 0.5,
  未完成: 0, 没完成: 0, 失败: 0, fail: 0, failed: 0, none: 0,
};

function settleBounty(state, bounty, rng, judged, rejected) {
  const p = state.player;
  for (const b of toList(bounty)) {
    const result = String(b?.result || b?.status || '').trim();

    // 交活
    if (result) {
      const candidates = p.contracts.filter(c => c.status === 'active');
      const c = b.id || b.contractId ? p.contracts.find(c => c.id === (b.id || b.contractId)) : candidates.length === 1 ? candidates[0] : null;
      if (c?.status === 'paid' || c?.status === 'failed') { rejected.push('这份委托已经结算，不能再次领赏或分配'); continue; }
      if (!c) {
        rejected.push('手上没有接下的活');
        continue;
      }
      const mul = BOUNTY_RESULT[result];
      if (mul == null) { rejected.push('委托结果只能是完成、一半或未完成'); continue; }
      if (!accountOf(state, b.account || 'cash')) { rejected.push('委托收款账户不存在'); continue; }
      const pay = Math.max(0, Math.round(c.copper * mul));
      if (pay > 0) {
        addCopper(state, b?.account || 'cash', pay);
        logLedger(state, `交活：${c.label}，${result}，得 ${copperText(pay)}`);
      } else {
        logLedger(state, `交活：${c.label}，${result}，一分钱没拿到`);
      }
      c.status = pay > 0 ? 'paid' : 'failed';
      c.paidCopper = pay;
      p.contract = p.contracts.find(c => c.status === 'active') || null;
      continue;
    }

    // 接活：酬劳当场定死。委托生成时 AI 报的价优先，没报才按威胁等级掷
    const tier = Math.min(5, Math.max(1, Math.round(n(b?.tier) || 1)));
    const quoted = Math.round(n(b?.copper ?? b?.price) || 0);
    if (b?.copper != null && (!Number.isSafeInteger(Number(b.copper)) || Number(b.copper) <= 0)) { rejected.push('委托报酬必须是正整数铜币'); continue; }
    const pay = quoted > 0 ? quoted : rollBounty(state, tier, rng);
    const id = String(b.id || `contract:${String(b.label || '一桩活').trim()}`);
    const existing = p.contracts.find(c => c.id === id);
    if (existing) { if (existing.label !== String(b.label || '一桩活').slice(0, 100) || existing.copper !== pay) rejected.push('委托编号已用于另一份约定'); continue; }
    p.contract = { id, label: String(b?.label || '一桩活').slice(0, 100), copper: pay, tier, status: 'active' };
    p.contracts.push(p.contract);
    logLedger(
      state,
      `接了活：${p.contract.label}，酬劳 ${copperText(pay)}——做完拿全款，做一半拿一半，没做完一分没有。`,
    );
  }
}

/* The actual quote settles this job; it does not become a permanent reference. */
function settleEarn(state, earn, rng, rejected) {
  for (const e of toList(earn).slice(0, 2)) {
    const label = String(e?.label || '帮工').trim().slice(0, 100);
    if (!label) continue;
    if (isRetiredPostalQuote(label, e?.copper ?? e?.amount)) { rejected.push('错误邮资不能作为报酬引用'); continue; }
    if (/赏金|委托|任务报酬|公会结/.test(label)) { rejected.push('任务报酬请用 bounty 并关联委托 id'); continue; }
    const pay = Math.round(n(e?.copper ?? e?.amount)) || rateOf(state, label);
    if (pay <= 0) { rejected.push(`活计“${label}”需要谈定报酬`); continue; }
    if (!addCopper(state, e?.account || 'cash', pay)) { rejected.push('活计收款账户不存在'); continue; }
    logLedger(state, `进账：${label}，${copperText(pay)}`);
  }
}

/** 人情：给钱的收益按"相当于对方几个月收入"折算，送穷人比送富人有用。 */
function settleGift(state, gift, rejected) {
  for (const g of toList(gift).slice(0, 3)) {
    const amount = Math.round(n(g?.copper));
    if (amount <= 0) continue;
    if (!state.npcs.some(npc => npc.id === g?.to)) { rejected.push('赠予需要已知人物'); continue; }
    const acc = accountOf(state, g?.account || 'cash');
    if (!acc || acc.copper < amount) { rejected.push('赠予金额超过可用余额'); continue; }
    addCopper(state, acc.id, -amount);
    const npc = state.npcs.find((x) => x.id === g?.to);
    const rel = state.player.relations.find((x) => x.npcId === g?.to);
    if (rel) {
      const income = Math.max(1, (workOf(npc?.profession || '', 'journeyman').daily || 120) * 30);
      const months = amount / income;
      const gain = (Math.round(Math.log2(1 + months) * 6) + Math.round(Math.log2(1 + months) * 3)) / 2;
      rel.closeness = clamp(rel.closeness + gain, -100, 100);
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
      if (!accountOf(state, b?.account || 'cash')) { rejected.push('借款收款账户不存在'); continue; }
      const amount = Math.round(n(b?.copper));
      if (amount <= 0) continue;
      const d = addDebt(state, {
        to: b?.from || b?.to,
        copper: amount,
        months: n(b?.months) || 12,
        rate: n(b?.rate) || 0.01,
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
    addItem(state, parsed.label, qty);
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
    if (eff.health) state.player.body.health = clamp(state.player.body.health + eff.health * qty, 0, 100);
    logLedger(state, `${eff.text}（${name}×${qty}）`);
  }
}

/** 丢东西：被偷、送人、掉了、上交——从袋子/装备/存货/交通工具里扣。 */
function settleLose(state, lose, rejected) {
  for (const it of toList(lose).slice(0, 8)) {
    const raw = typeof it === 'string' ? it : it?.name;
    if (!raw) continue;
    const name = String(raw).trim();
    const qty = Math.max(1, Math.round(n(it?.qty) || 1));
    const res = removeItem(state, name, qty);
    if (!res.ok) {
      rejected.push(`身上没有 ${name}`);
      continue;
    }
    logLedger(state, `失去 ${name}×${res.count}`);
  }
}

/** 模型直接记的一笔钱的进出（买卖、打赏、路费、罚金都走这里）。 */
function settleMoneyChange(state, change, rejected) {
  for (const m of toList(change).slice(0, 8)) {
    const acc = accountOf(state, m?.account || 'cash');
    const want = Math.round(n(m?.copper ?? m?.amount));
    if (isRetiredPostalQuote(m?.note || m?.label, Math.abs(want))) { rejected.push('这条寄信金额已确认为错误，不予结算'); continue; }
    if (!acc) { rejected.push('收支账户不存在'); continue; }
    if (!want) continue;
    if (want < 0 && acc.copper < -want) { rejected.push(`${acc.name}余额不足，需要 ${copperText(-want)}`); continue; }
    const delta = want;
    if (!delta) {
      rejected.push(`${acc.name}不够`);
      continue;
    }
    addCopper(state, acc.id, delta);
    const note = String(m?.note || m?.label || '零用').slice(0, 24);
    logLedger(state, `${delta > 0 ? '进账' : '支出'}：${note} ${copperText(Math.abs(delta))}`);
  }
}

/** 把一次输出的增量（LLM 提议）安全地合入状态。返回被拒绝的条目。 */
function applyUnsafe(state, delta, rng, opts = {}) {
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
    if (legacy && !addCopper(state, 'cash', legacy)) rejected.push('随身账户金额不足或无效');

    // 新写法：{ cash: -300, home: 1800000, workshop: 2500 }（单位：铜）
    for (const [k, v] of Object.entries(m)) {
      if (['gold', 'silver', 'copper', 'transfer', 'note', 'change'].includes(k)) continue;
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
  if (delta?.earn) settleEarn(state, delta.earn, rng, rejected);
  if (delta?.money?.change) settleMoneyChange(state, delta.money.change, rejected);
  if (Array.isArray(delta?.prices)) {
    for (const pr of delta.prices.slice(0, 8)) {
      const nm = String(pr?.name || '').trim();
      const entry = parsePriceEntry(pr?.copper ?? pr?.price);
      const v = priceEntryValue(entry);
      if (isRetiredPostalQuote(nm, entry)) { rejected.push('这条错误邮资已经废弃，不能恢复为参考价'); continue; }
      if (!nm || !entry || gamePriceEntry(nm) != null) continue;
      // 送信、跑腿、护送这类是「活计」，记进 rates，不混进物品价表
      const ok = isService(nm) ? learnRate(state, nm, v) : learnPrice(state, nm, Math.min(v, 5000000));
      if (ok && typeof entry === 'object') (isService(nm) ? state.rates : state.prices)[nm] = entry;
      if (ok) logLedger(state, `记下价：${nm} ` + copperText(v));
    }
  }
  if (delta?.payDebt || delta?.borrow) settleDebts(state, delta, rejected);
  if (delta?.profession) settleProfession(state, delta.profession);
  if (delta?.items) settleItems(state, delta.items);
  if (delta?.use) settleUse(state, delta.use, rejected);
  if (delta?.lose) settleLose(state, delta.lose, rejected);
  if (delta?.gift) settleGift(state, delta.gift, rejected);

  // 身体 / 精神
  for (const key of ['health']) {
    const d = n(delta?.body?.[key]);
    if (d) state.player.body[key] = clamp(state.player.body[key] + d, 0, 100);
  }
  if (typeof delta?.mind?.mood === 'string' && delta.mind.mood.trim()) {
    state.player.mind.mood = delta.mind.mood.trim().slice(0, 24);
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
      const dClose = closenessOf(r);
      const obs = typeof r.observable === 'string' ? r.observable.trim() : '';
      const obsOk = Boolean(obs) && !/^[（(]?\s*(无变化|没有变化|无|未变|不变|同上|略)\s*[）)]?$/.test(obs);
      if (!dClose && !obsOk) continue; // 整条都是「无变化」，直接跳过
      rel.closeness = clamp(rel.closeness + dClose, -100, 100);
      rel.lastTouch = (state.clock.year || 0) * 365 + (state.clock.doy || 0);
      if (obsOk) rel.observable = obs.slice(0, 60);
      if (obsOk) npc.memories.push({ cause: opts.eventId || `turn:${state.turn}`, text: obs.slice(0, 160), day: absoluteDay(state.clock) });
    }
  }

  // 装备（只增不减：丢东西需要玩家明确说）
  if (Array.isArray(delta?.equipment)) {
    for (const e of delta.equipment) {
      const name = typeof e === 'string' ? e : e?.name;
      if (!name) continue;
      for (const item of normalizeEquipment(name)) {
        const count = String(item).match(/[×xX]\s*(\d+)\s*$/);
        const label = count ? String(item).slice(0, count.index).trim() : String(item);
        const qty = (count ? Number(count[1]) : 1) * (typeof e === 'object' && e.qty != null ? Number(e.qty) : 1);
        if (!Number.isSafeInteger(qty) || qty < 1) { rejected.push('装备数量必须为正整数'); continue; }
        addItem(state, label, qty);
      }
    }
  }

  // 知识与未完成
  const pushKnowledge = (list) => {
    for (const k of (Array.isArray(list) ? list : []).slice(0, 4)) {
      const text = typeof k === 'string' ? k : k?.text;
      if (!text) continue;
      const clean = String(text).trim();
      if (!clean || /^[（(]?\s*(无变化|没有变化|无|同上|略)\s*[）)]?$/.test(clean)) continue;
      state.knowledge.push(linkKnowledge(state, {
        ...(typeof k === 'object' ? k : {}),
        text: clean.slice(0, 80),
        source: typeof k === 'object' && k.source ? String(k.source).slice(0, 20) : '亲历',
        day: state.clock.doy,
      }, opts.eventId));
    }
  };
  pushKnowledge(delta?.knowledge);
  pushKnowledge(delta?.newInfo);

  if (Array.isArray(delta?.unfinished)) {
    for (const u of delta.unfinished.slice(0, 3)) {
      const text = typeof u === 'string' ? u : u?.text;
      if (text) applyTasks(state, [{ id: `task:${textId(text)}`, text: String(text).slice(0, 160) }], rejected, opts.eventId);
    }
  }

  if (Array.isArray(delta?.goals)) {
    const g = delta.goals.filter((x) => typeof x === 'string' && x.trim()).map((x) => x.slice(0, 60));
    state.player.goals = g.slice(0, 10);
  }
  if (Array.isArray(delta?.problems)) {
    const p = delta.problems.filter((x) => typeof x === 'string' && x.trim()).map((x) => x.slice(0, 60));
    state.player.problems = p.slice(0, 10);
  }

  state.turn = (state.turn || 0) + (opts.bump === false ? 0 : 1);
  return { rejected };
}

const DELTA_FIELDS = new Set(['time', 'money', 'trade', 'bounty', 'earn', 'prices', 'payDebt', 'borrow', 'profession', 'items', 'use', 'lose', 'gift', 'body', 'mind', 'skills', 'relations', 'equipment', 'knowledge', 'newInfo', 'unfinished', 'goals', 'problems', 'location', 'npcs', 'npcUpdates', 'consequences', 'reputation', 'tasks', 'transactions', 'eventId']);
function validateTree(value, path = '') {
  if (typeof value === 'number' && !Number.isFinite(value)) throw new Error(`无效数值：${path}`);
  if (value && typeof value === 'object') for (const [key, child] of Object.entries(value)) {
    if (['__proto__', 'constructor', 'prototype'].includes(key)) throw new Error('数据包含保留字段');
    validateTree(child, `${path}.${key}`);
  }
}
function inventory(state) {
  const out = {};
  for (const key of ['bag', 'stock', 'vehicles']) for (const row of state.player[key] || []) out[row.name] = (out[row.name] || 0) + row.qty;
  for (const raw of state.player.equipment || []) {
    const match = String(raw).match(/[×xX]\s*(\d+)\s*$/), name = match ? String(raw).slice(0, match.index).trim() : raw;
    out[name] = (out[name] || 0) + (match ? Number(match[1]) : 1);
  }
  return out;
}

/** Validate on a copy, then commit the complete event exactly once. */
export function applyDelta(state, delta, rng, opts = {}) {
  upgradeState(state);
  const rejected = [];
  if (!delta || typeof delta !== 'object' || Array.isArray(delta)) return { applied: false, rejected: ['回合需要一个 JSON 对象'] };
  try { validateTree(delta); } catch (e) { return { applied: false, rejected: [e.message] }; }
  for (const key of Object.keys(delta)) if (!DELTA_FIELDS.has(key)) rejected.push(`不支持的变化字段：${key}`);
  const id = opts.eventId || delta.eventId;
  const fingerprint = JSON.stringify(delta);
  if (id && Object.hasOwn(state.processedEvents, id)) {
    const old = state.processedEvents[id];
    return old.fingerprint === fingerprint ? { applied: true, duplicate: true, rejected: [], receipt: old.receipt }
      : { applied: false, rejected: ['同一回合编号对应了不同内容，请恢复原回合或创建分支'] };
  }
  if (id && !/^[a-zA-Z0-9_.:-]{1,160}$/.test(id)) rejected.push('回合编号无效');
  const legacyFinance = ['trade', 'bounty', 'earn', 'gift', 'payDebt', 'borrow'].some(k => delta[k]);
  if (delta.money?.change && legacyFinance) rejected.push('money.change 与交易、赏金等不能重复记账；请统一使用 transactions');
  if (delta.transactions && (legacyFinance || delta.money)) rejected.push('transactions 不能再附加旧格式记账');
  if (rejected.length) return { applied: false, rejected };
  const draft = structuredClone(state), beforeItems = inventory(state);
  ensureAccounts(draft);
  const before = Object.fromEntries(draft.player.accounts.map(a => [a.id, a.copper]));
  const changes = { ...delta }; delete changes.transactions; delete changes.eventId;
  applyStoryDelta(draft, changes, rejected, id || `turn:${state.turn}`);
  const txs = Array.isArray(delta.transactions) ? delta.transactions : [];
  if (delta.transactions && !Array.isArray(delta.transactions)) rejected.push('transactions 必须是数组');
  for (let index = 0; index < txs.length; index++) {
    const tx = txs[index], txId = tx?.id || (id ? `${id}:tx:${index}` : null);
    if (!txId || !/^[a-zA-Z0-9_.:-]{1,160}$/.test(txId)) { rejected.push('每笔交易需要固定 id'); continue; }
    const signature = JSON.stringify(tx);
    if (Object.hasOwn(draft.processedEvents, txId)) {
      if (draft.processedEvents[txId].fingerprint !== signature) rejected.push('交易编号已用于不同内容');
      continue;
    }
    const amount = Math.round(Number(tx.copper) || 0);
    if (tx.kind !== 'reward' && (!Number.isSafeInteger(amount) || amount <= 0)) { rejected.push('交易金额必须是正整数铜币'); continue; }
    let part;
    const account = tx.account || 'cash';
    if (['purchase', 'sale'].includes(tx.kind)) {
      if (typeof tx.name !== 'string' || !tx.name.trim() || (tx.qty != null && (!Number.isSafeInteger(tx.qty) || tx.qty <= 0))) { rejected.push('买卖需要物品名称与正整数数量'); continue; }
      const repeated = [...toList(delta.items), ...toList(delta.lose), ...toList(delta.equipment)].some(row => (typeof row === 'string' ? row : row?.name) === tx.name);
      if (repeated) { rejected.push('交易已经移动物品，不能再次发放或移除同一物品'); continue; }
      part = { trade: { account, [tx.kind === 'purchase' ? 'buy' : 'sell']: [{ name: tx.name, qty: tx.qty || 1, copper: amount }] } };
    }
    else if (tx.kind === 'reward') {
      if (!tx.contractId) { rejected.push('赏金必须关联委托 id'); continue; }
      part = { bounty: { id: tx.contractId, result: tx.result || '完成', account } };
    } else if (tx.kind === 'gift') {
      if (!draft.npcs.some(npc => npc.id === tx.to)) { rejected.push('赠予需要已知人物'); continue; }
      part = { gift: { to: tx.to, copper: amount, account } };
    } else if (tx.kind === 'transfer') part = { money: { transfer: [{ from: tx.from, to: tx.to, copper: amount }] } };
    else if (tx.kind === 'repay') part = { payDebt: { id: tx.debtId, to: tx.to, copper: amount, account } };
    else if (tx.kind === 'borrow') {
      if (!tx.from) { rejected.push('借款需要债权人名称'); continue; }
      part = { borrow: { from: tx.from, copper: amount, months: tx.months, rate: tx.rate, account } };
    }
    else if (tx.kind === 'income' || tx.kind === 'payment') {
      if (tx.kind === 'income' && /赏金|委托|任务报酬/.test(tx.note || '')) { rejected.push('任务收入需要使用 reward 并关联委托'); continue; }
      part = { money: { change: [{ account, copper: tx.kind === 'income' ? amount : -amount, note: tx.note }] } };
    }
    else { rejected.push(`未知交易类型：${tx.kind}`); continue; }
    rejected.push(...applyUnsafe(draft, part, rng, { ...opts, bump: false }).rejected);
    draft.processedEvents[txId] = { fingerprint: signature };
  }
  rejected.push(...applyUnsafe(draft, changes, rng, opts).rejected);
  if (draft.player.accounts.some(a => !Number.isSafeInteger(a.copper) || a.copper < 0)) rejected.push('账户金额无效');
  if (rejected.length) return { applied: false, rejected };
  upgradeState(draft);
  const afterItems = inventory(draft);
  const receipt = {
    accounts: draft.player.accounts.map(a => ({ id: a.id, name: a.name, before: before[a.id] || 0, change: a.copper - (before[a.id] || 0), after: a.copper })).filter(a => a.change),
    items: [...new Set([...Object.keys(beforeItems), ...Object.keys(afterItems)])].map(name => ({ name, change: (afterItems[name] || 0) - (beforeItems[name] || 0) })).filter(i => i.change),
  };
  if (id) draft.processedEvents[id] = { fingerprint, receipt };
  assignState(state, draft);
  return { applied: true, rejected: [], receipt };
}

/** 给模型的紧凑状态块（也是 UI 的数据源之一）。 */
export function stateBlock(state, query = '') {
  upgradeState(state);
  ensureNpcState(state);
  ensureAssets(state);
  ensurePriceTable(state);
  const p = state.player;
  const lines = [];
  const context = memoryContext(state, query);
  lines.push(`【时间】${formatDate(state.clock)}`);
  lines.push(`【地点】${p.location.siteName}（${state.world.regionTitle}）｜物价指数 ${(state.world.priceIndex || 1).toFixed(2)}`);
  lines.push(
    `【角色】${p.name}｜${p.age} 岁｜${RACE_CN[p.race] || p.race}｜${p.profession}（${p.professionState}）`,
  );
  lines.push(`【四维】体质 ${p.stats.body} 敏捷 ${p.stats.agility} 智慧 ${p.stats.wisdom} 精神 ${p.stats.spirit}`);
  lines.push(`【身体】健康 ${p.body.health}`);
  lines.push(`【心情】${p.mind.mood}`);
  if (p.talent) {
    const t = p.talent;
    lines.push(`【天赋】${t.name}（${t.grade}）：${t.effect}${t.secret ? '｜**必须严格保密**' : ''}`);
  }
  lines.push(`【账户】${accountsText(state)}`);
  const work = ensureWork(state);
  if (work.type === 'wage' && work.daily) {
    lines.push(`【收入】${work.label}：日薪 ${copperText(work.daily)}（约 ${copperText(work.daily * 30)}/月，由引擎发放）`);
  } else if (work.type === 'bounty') {
    lines.push('【收入】靠赏金，无固定收入；接委托时谈定金额，完成后按委托 id 付款。');
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
  for (const c of p.contracts) lines.push(`【委托 ${c.id}】${c.label}｜${c.status}｜${copperText(c.copper)}${c.paidCopper != null ? `｜已付 ${copperText(c.paidCopper)}` : ''}`);
  const bagAll = bagText(state);
  if (bagAll) lines.push(`【随身货物】${bagAll}`);
  const assetsAll = assetsText(state);
  if (assetsAll) lines.push(`【资产】${assetsAll}`);
  const gear = gearState(p);
  lines.push(`【常用武器 ${gear.slots}/9 栏】${gear.loadout.weapons.map(row => `${row.key}×${row.qty}`).join('、') || '无'}；主用：${gear.loadout.primary || '徒手'}；护甲：${gear.loadout.armor || '无'}；盾牌：${gear.loadout.shield || '无'}`);
  if (p.equipment?.length) lines.push(`【拥有的装备，仅为收藏，不叠加判定】${p.equipment.join('、')}`);
  if (p.talent) lines.push('【已明确的天赋规则】' + talentRuleText(p).join('；'));
  if (p.skills.length) lines.push(`【技能】${p.skills.map((s) => `${s.name} ${s.level}`).join('、')}`);
  lines.push(`【身份】${p.socialClass}｜声誉：${repText(p.reputation)}`);
  if (p.relations.length) {
    lines.push('【关系】');
    for (const r of p.relations.filter(r => relevantNpcs(state, query).some(n => n.id === r.npcId))) {
      const npc = state.npcs.find((x) => x.id === r.npcId);
      lines.push(`  · ${npc?.name || r.npcId}（${npc?.profession || ''}）：亲近 ${r.closeness}；${r.observable || '点头之交'}`);
    }
  }
  if (p.goals.length) lines.push(`【当前目标】${p.goals.join('；')}`);
  if (p.problems.length) lines.push(`【当前问题】${p.problems.join('；')}`);
  if (p.unfinished.length) lines.push('【未完成事项，完成后按相同编号关闭】', ...p.unfinished.map(u => `[${u.id}] ${u.text}${u.dueDay != null ? `｜截止绝对日${u.dueDay}` : ''}${u.needsReview ? '｜旧事项，状态待核对' : ''}`));
  if (p.taskHistory?.length) lines.push('【相关已结束事项，不得当成仍未完成】', ...selectRelevant(p.taskHistory, query, 5, row => row.text, context).map(row => `[${row.id}] ${row.text}｜${row.status}`));
  lines.push(builtinReferenceText());
  const priceRows = selectRelevant(Object.entries(state.prices || {}), query, 18, x => x[0]);
  if (priceRows.length) {
    lines.push('【存档物价·物品与服务】（补充游戏物价未收录的条目，供 AI 报价参考，不锁定成交金额）');
    for (const [n2, v] of priceRows) lines.push(`  · ${n2} ${priceEntryText(v)} 铜`);
  }
  const rates = selectRelevant(Object.entries(state.rates || {}), query, 12, x => x[0]);
  if (rates.length) lines.push('【存档物价·活计】（供 AI 报价参考，不锁定本次报酬）', ...rates.map(([name, v]) => `  · ${name} ${priceEntryText(v)} 铜`));
  if (state.ledgerLog?.length) {
    lines.push('【最近账目】（引擎结算，叙事以这些为准，不要改数）');
    for (const l of state.ledgerLog.slice(-6)) lines.push(`  · ${l.text}`);
  }
  const chron = selectRelevant(state.chronicle.map(row => linkKnowledge(state, row)), query, 12, row => row.text, context).map(row => row.text).join('\n');
  if (chron) {
    lines.push('【编年】（更早发生的事，回忆优先按这个来）');
    for (const l of chron.split('\n')) lines.push(`  · ${l}`);
  }
  if (state.knowledge.length) {
    lines.push('【玩家已知】（只能用这些）');
    for (const k of selectRelevant(state.knowledge.map(row => linkKnowledge(state, row)), query, 18, row => row.text, context)) lines.push(`  · [${k.id}] ${k.text}（${k.source}${k.sourceTurn != null ? `；来源回合${k.sourceTurn}` : ''}）`);
  }
  if (state.storyLog.length) lines.push('【已经发生的后果】', ...selectRelevant(state.storyLog, query, 6).map(e => `  · ${e.text}${e.cause ? `（起因：${e.cause}）` : ''}`));
  for (const e of state.consequences.filter(e => e.status === 'pending' && e.visible)) lines.push(`【待发生 ${e.id}】${e.text}；起因：${e.cause}`);
  return lines.join('\n');
}

/** 给模型的 NPC 卡（含 id，方便它写 relations）。 */
export function npcCards(state, query = '') {
  ensureNpcState(state);
  return relevantNpcs(state, query)
    .map((npc) => {
      const v = npc.voice || {};
      return [
        `· [${npc.id}] ${npcLabel(state, npc)}｜${npc.age} 岁｜${RACE_CN[npc.race] || npc.race}｜${npc.profession}`,
        `  说话：词汇 ${v.vocabulary || 2}/5，${v.sentence || 'short'} 句，礼貌 ${v.politeness ?? 1}/3，口癖「${(v.tics || []).join('、') || '无'}」，比喻取自${v.metaphor || '日常'}`,
        `  在意：${npc.obsession || '无'}｜性格：${(npc.traits || []).join('、') || '普通'}`,
        npc.loadout?.length ? `  惯用：${npc.loadout.join('、')}` : null,
        `  目标：${npc.goals.filter(g => g.visible !== false).map(g => `[${g.id}] ${g.text}（${g.status}，进展 ${g.progress}%）`).join('；') || '尚未得知'}`,
        `  记得：${selectRelevant(npc.memories, query, 3).map(m => m.text).join('；') || '初次相识'}`,
      ]
        .filter(Boolean)
        .join('\n');
    })
    .join('\n');
}

export function uiState(state) {
  upgradeState(state);
  ensureNpcState(state);
  ensureAccounts(state); // 老存档读的时候就把 wallet 迁成 cash
  ensureAssets(state);
  ensurePriceTable(state);
  normalizeItems(state);
  const p = state.player;
  return {
    saveId: state.saveId,
    turn: state.turn,
    date: formatDate(state.clock),
    dateLine: dateLine(state.clock),
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
      contract: p.contract || null,
      contracts: p.contracts,
      prices: state.prices || {},
      rates: state.rates || {},
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
      vehicles: p.vehicles,
      stock: p.stock,
      skills: p.skills,
      socialClass: p.socialClass,
      reputation: p.reputation,
      reputationText: repText(p.reputation),
      talent: p.talent || null,
      equipment: p.equipment || [],
      gear: gearState(p),
      talentRules: talentRuleText(p),
      incomeMonthly: p.incomeMonthly || 0,
      location: p.location,
      goals: p.goals,
      problems: p.problems,
      unfinished: p.unfinished,
      taskHistory: p.taskHistory,
      relations: p.relations.map((r) => {
        const npc = state.npcs.find((x) => x.id === r.npcId);
        return {
          name: npc ? npcLabel(state, npc) : r.npcId,
          npcId: r.npcId,
          race: RACE_CN[npc?.race] || npc?.race || '',
          profession: npc?.profession || '',
          loadout: npc?.loadout || [],
          observable: r.observable,
          closeness: r.closeness,
          goals: (npc?.goals || []).filter(g => g.visible !== false),
          memories: (npc?.memories || []).slice(-3),
        };
      }),
    },
    knowledge: state.knowledge.slice(-10),
    ledgerLog: (state.ledgerLog || []).slice(-6),
    worldLog: (state.worldLog || []).slice(-8),
    storyLog: state.storyLog.slice(-10),
    prices: state.prices || {},
    rates: state.rates || {},
    priceIndex: state.world.priceIndex || 1,
  };
}
