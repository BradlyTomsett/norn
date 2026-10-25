// 账本：固定收支（账单队列）、债务、职业收入、生活开销。
// 这些数全部由引擎算，模型只负责把事情写成文字。

import { addCopper, copperText, ensureAccounts } from './money.js';

/* ---------------- 账单（固定收支） ---------------- */

/** 默认账单：只在开局用一次。之后就是普通数据，玩家/剧情可以增删。 */
export function defaultBills() {
  return [];
}

export function ensureBills(state) {
  const p = state.player;
  if (!Array.isArray(p.bills)) p.bills = defaultBills();
  return p.bills;
}

/**
 * 按跨界次数跑账单。
 * from 有值 = 从该账户扣；to 有值 = 进该账户；两个都没有就跳过。
 */
export function runBills(state, crossed, rng) {
  ensureAccounts(state);
  const bills = ensureBills(state);
  const out = [];
  const months = Math.max(0, crossed.months || 0);
  const days = Math.max(0, crossed.days || 0);
  const years = Math.max(0, crossed.years || 0);

  for (const b of bills) {
    const times =
      b.every === 'day' ? days : b.every === 'year' ? years : b.every === 'week' ? crossed.weeks ?? Math.floor(days / 7) : months;
    if (times <= 0) continue;
    const amount = Math.round(Number(b.amount) || 0) * times;
    if (!amount) continue;

    if (b.from) {
      const acc = state.player.accounts.find((a) => a.id === b.from || a.name === b.from);
      if (!acc || acc.copper < amount) {
        out.push({ level: 'local', text: `${b.label}付不出来了：要 ${copperText(amount)}，账上不够。` });
        continue;
      }
      addCopper(state, acc.id, -amount);
      if (b.to) addCopper(state, b.to, amount);
      out.push({ level: 'local', text: `${b.label}：${copperText(amount)}出去了。` });
    } else if (b.to) {
      addCopper(state, b.to, amount);
      out.push({ level: 'local', text: `${b.label}：${copperText(amount)}进来了。` });
    }
  }
  return out;
}

/* ---------------- 债务 ---------------- */

const DEFAULT_RATE = 0.01; // 月息 1%

function legacyCopper(amount) {
  if (!amount || typeof amount !== 'object') return 0;
  return Math.round(Number(amount.gold || 0) * 10000 + Number(amount.silver || 0) * 100 + Number(amount.copper || 0));
}

/** 兼容老存档：{to, amount:{gold,silver,copper}, note} → 新结构。 */
export function ensureDebts(state) {
  const p = state.player;
  if (!Array.isArray(p.debts)) p.debts = [];
  const baseYear = state.clock?.year || 222;
  const baseDoy = state.clock?.doy || 1;
  for (let i = 0; i < p.debts.length; i++) {
    const d = p.debts[i];
    if (!d || typeof d !== 'object') continue;
    if (d.remaining == null) {
      const old = legacyCopper(d.amount);
      const principal = old || Math.round(Number(d.principal) || 0);
      d.principal = principal;
      d.remaining = principal;
      delete d.amount;
    }
    if (!Number.isFinite(d.rate)) d.rate = DEFAULT_RATE;
    if (!d.overdueMonths) d.overdueMonths = 0;
    if (!d.status) d.status = d.remaining > 0 ? 'open' : 'settled';
    if (!d.due) d.due = { year: baseYear + 1, doy: baseDoy };
    if (!d.id) d.id = `debt_${i}_${d.to || 'unknown'}`;
    if (!d.note) d.note = '到期未定';
  }
  return p.debts;
}

export function openDebts(state) {
  return ensureDebts(state).filter((d) => d.status === 'open' && d.remaining > 0);
}

export function debtText(state, d) {
  const due = d.due ? `${d.due.year} 年 ${d.due.doy} 日` : '未定';
  return `${d.to} ${copperText(d.remaining)}（月息 ${(d.rate * 100).toFixed(0)}%，${d.overdueMonths ? `已逾期 ${d.overdueMonths} 个月` : `到期 ${due}`}）`;
}

const absDay = (c) => (c.year || 0) * 365 + (c.doy || 0);

export function addDebt(state, { to, copper, months = 12, rate = DEFAULT_RATE, note = '' }) {
  const p = state.player;
  ensureDebts(state);
  const clock = state.clock || { year: 222, doy: 1 };
  const principal = Math.max(0, Math.round(Number(copper) || 0));
  if (!to || !principal) return null;
  const d = {
    id: `debt_${Date.now().toString(36)}_${p.debts.length}`,
    to: String(to).slice(0, 20),
    principal,
    remaining: principal,
    rate: Math.max(0, Math.min(0.2, Number(rate) || DEFAULT_RATE)),
    due: { year: clock.year, doy: clock.doy + Math.max(1, Math.round(months)) * 30 },
    note: String(note || '借钱时说的是周转').slice(0, 40),
    overdueMonths: 0,
    status: 'open',
  };
  // 到期日可能跨年
  while (d.due.doy > 365) {
    d.due.doy -= 365;
    d.due.year += 1;
  }
  p.debts.push(d);
  return d;
}

/** 逐月计息 + 逾期处理。 */
export function accrueDebts(state, months, rng) {
  const out = [];
  const list = openDebts(state);
  if (!list.length || months <= 0) return out;
  const now = absDay(state.clock || {});
  for (const d of list) {
    for (let m = 0; m < months; m++) {
      d.remaining = Math.round(d.remaining * (1 + d.rate));
    }
    if (now > absDay(d.due)) {
      d.overdueMonths += months;
      out.push({ level: 'local', text: `${d.to}催了一次：${copperText(d.remaining)}，已经拖了 ${d.overdueMonths} 个月。` });
      if (d.overdueMonths >= 3 && rng() < 0.5) {
        const p = state.player;
        const first = p.reputation && Object.keys(p.reputation)[0];
        if (first) p.reputation[first] = (p.reputation[first] || 0) - 1;
        d.remaining = Math.round(d.remaining * 1.1);
        out.push({ level: 'local', text: `${d.to}把话放出去了：${p.name}家欠钱不还。利滚利，又多了一成。` });
      }
    }
  }
  return out;
}

/** 还债。返回实际还掉的铜数。 */
export function payDebt(state, payments) {
  const list = Array.isArray(payments) ? payments : [payments];
  const out = [];
  ensureDebts(state);
  for (const pay of list) {
    if (!pay || typeof pay !== 'object') continue;
    const open = openDebts(state);
    const d = pay.to || pay.id ? open.find(x => (pay.to && x.to === pay.to) || (pay.id && x.id === pay.id)) : open.length === 1 ? open[0] : null;
    if (!d) {
      out.push({ ok: false, text: '没有这笔债。' });
      continue;
    }
    const account = pay.account || 'cash';
    const acc = state.player.accounts.find((a) => a.id === account || a.name === account);
    const want = Math.round(Number(pay.copper) || d.remaining);
    if (!acc || acc.copper < Math.min(want, d.remaining)) {
      out.push({ ok: false, text: `账上不够支付这笔还款，尚未扣款。` });
      continue;
    }
    const amt = Math.min(want, d.remaining, acc ? acc.copper : 0);
    if (amt <= 0) {
      out.push({ ok: false, text: `账上没钱还${d.to}。` });
      continue;
    }
    addCopper(state, acc.id, -amt);
    d.remaining -= amt;
    if (d.remaining <= 0) {
      d.remaining = 0;
      d.status = 'settled';
      state.player.debts = state.player.debts.filter((x) => x !== d);
      out.push({ ok: true, text: `把${d.to}的债还清了：${copperText(amt)}。` });
    } else {
      out.push({ ok: true, text: `还了${d.to} ${copperText(amt)}，还剩 ${copperText(d.remaining)}。` });
    }
  }
  return out;
}

/* ---------------- 职业收入 ---------------- */

// 日薪（铜）。锚点来自世界设定：普通劳力年入 5 金 ≈ 日薪 167 铜。
const WORK_RULES = [
  [/冒险|佣兵|赏金|游侠|猎人|盗贼|刺客|探险|旅团/, { type: 'bounty', base: 0 }],
  [/铁匠|锻|铸|矿/, { type: 'wage', base: 220 }],
  [/磨坊|木匠|石匠|皮匠|裁缝|面包|屠|陶/, { type: 'wage', base: 180 }],
  [/商|货|账房|店主|老板|中介|金匠|典押|放贷|掌柜|贩|钱庄/, { type: 'wage', base: 260 }],
  [/兵|卫|巡逻|骑士|守/, { type: 'wage', base: 200 }],
  [/书|学|教|抄|医|药/, { type: 'wage', base: 200 }],
  [/船|码头|渔/, { type: 'wage', base: 150 }],
  [/农|佃|帮工|杂役|帮佣|仆|牧/, { type: 'wage', base: 120 }],
  [/学徒|杂工|跑腿/, { type: 'wage', base: 90 }],
  [/孩子|无业|流浪/, { type: 'none', base: 0 }],
];

const STATE_MUL = { none: 0.6, apprentice: 0.5, journeyman: 1, master: 1.8, guildmaster: 3 };

export function workOf(profession, professionState) {
  const s = String(profession || '');
  const rule = WORK_RULES.find(([re]) => re.test(s));
  if (!rule) return { type: 'none', daily: 0, label: '无固定收入' };
  const { type, base } = rule[1];
  const mul = STATE_MUL[professionState] ?? 0.7;
  if (type === 'bounty') return { type: 'bounty', daily: 0, label: '靠赏金吃饭' };
  return { type, daily: Math.round(base * mul), label: `${s}的工钱` };
}

export function ensureWork(state) {
  const p = state.player;
  const w = workOf(p.profession, p.professionState);
  if (!p.work || p.work.profession !== p.profession || p.work.state !== p.professionState) {
    p.work = { ...w, profession: p.profession, state: p.professionState };
  }
  return p.work;
}

/** 逐日结算工钱。赏金型职业在这里拿不到钱。 */
export function runWages(state, days) {
  const out = [];
  const w = ensureWork(state);
  if (days <= 0 || w.type !== 'wage' || !w.daily) return out;
  const pay = w.daily * days;
  if (!addCopper(state, 'cash', pay)) return out;
  out.push({ level: 'local', text: `${days} 天的工钱结了：${copperText(pay)}，进随身。` });
  return out;
}

/* ---------------- 生活开销 ---------------- */

const LIVING = { poor: 4, commoner: 6, merchant: 15, noble: 60, royalty: 200 };

export function livingPerDay(state) {
  return LIVING[state?.player?.socialClass] || LIVING.commoner;
}

/** 逐日吃饭住店的底价。钱不够就从「家里」补，补不上就饿着。 */
export function runLiving(state, days) {
  const out = [];
  if (days <= 0) return out;
  const cost = livingPerDay(state) * days;
  const cash = state.player.accounts.find((a) => a.id === 'cash');
  const home = state.player.accounts.find((a) => a.id === 'home');
  let paid = 0;
  if (cash && cash.copper > 0) {
    paid = Math.min(cash.copper, cost);
    addCopper(state, 'cash', -paid);
  }
  if (paid < cost && home && home.copper > 0) {
    const rest = Math.min(home.copper, cost - paid);
    addCopper(state, 'home', -rest);
    paid += rest;
  }
  if (paid >= cost) {
    out.push({ level: 'local', text: `${days} 天吃住花掉 ${copperText(cost)}。` });
  } else {
    out.push({ level: 'local', text: `生活费还差 ${copperText(cost - paid)}，本次只支付了账上可用的部分。` });
  }
  return out;
}
