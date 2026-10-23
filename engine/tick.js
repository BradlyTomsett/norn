// 世界 tick：玩家不动的时候，世界也在走。
// 这里只产出"事实"（事件 + 数值），叙事交给模型。
import { advanceClock } from './clock.js';
import { chance, int, pick } from './rng.js';
import { copperText, logLedger, transferCopper } from './state.js';
import { accrueDebts, ensureDebts, ensureWork, runBills, runLiving, runWages } from './ledger.js';
import { decayRelations, decayReputation } from './progress.js';

const DAY_EVENTS = [
  '路上过了一队收羊毛的商人，价压得很低',
  '南边的车辙被雨水冲坏了一段，绕路要多走半个时辰',
  '邻家丢了一只鸡，女人们在井台边说了半天',
  '管事的副手骑马经过，没停，溅了一路泥',
  '镇口来了两个不认识的年轻人，说是找活干',
  '集市上多了一个卖旧铁器的摊子',
  '夜里有狗叫了半宿，第二天谁也说不上为什么',
];

const MONTH_EVENTS = [
  '面粉涨了一点，磨坊那边说是新麦还没下来',
  '镇上的酒馆换了东家，价钱没变，量少了一点',
  '教会的小堂修了屋顶，捐钱的是磨坊主',
  '南边林子又有人不敢进了，说是看见过火光',
  '一队兵丁路过，住了一晚，吃了镇上不少东西',
  '铁匠铺的火停了三天，说是煤没跟上',
  '有人在集上卖一张旧地图，标着林子深处的一条路',
];

const NPC_EVENTS = [
  { type: 'ill', text: (n) => `${n}病了一场，躺了十来天，人瘦了一圈` },
  { type: 'marry', text: (n) => `${n}嫁了人，男方是邻镇的手艺人` },
  { type: 'move', text: (n) => `${n}搬走了，说是去郡城投亲戚` },
  { type: 'promote', text: (n) => `${n}升了，管的事情比从前多` },
  { type: 'die', text: (n) => `${n}死了，丧事办得很简单` },
];

function logEvent(state, text, level = 'local') {
  state.worldLog ||= [];
  state.worldLog.push({ year: state.clock.year, doy: state.clock.doy, level, text });
  if (state.worldLog.length > 40) state.worldLog = state.worldLog.slice(-40);
}

export function recentWorld(state, n = 4) {
  return (state.worldLog || []).slice(-n);
}

/**
 * 推进世界。返回本回合发生的事件（给叙事用）。
 */
export function advanceWorld(state, minutes, rng) {
  const { clock, crossed } = advanceClock(state.clock, minutes || 0, rng);
  state.clock = clock;
  const events = [];
  ensureDebts(state);
  ensureWork(state);

  const days = Math.max(0, crossed.days || 0);
  // 月数：长跨度按整月算，短跨度只跨了一次月界也要算一个月
  const months = Math.max(
    days >= 30 ? Math.floor(days / 30) : 0,
    crossed.newMonth || crossed.years > 0 ? 1 : 0,
  );

  // 日 tick
  if (days > 0) {
    const tries = Math.min(days, 20);
    let emitted = 0;
    for (let i = 0; i < tries && emitted < 2; i++) {
      if (chance(rng, 0.28)) {
        const text = pick(rng, DAY_EVENTS);
        logEvent(state, text);
        events.push({ level: 'local', text });
        emitted++;
      }
    }
  }

  // 月 tick
  if (months > 0) {
    const drift = Math.pow(1 + (rng() - 0.45) * 0.05, months);
    state.world.priceIndex = Math.min(1.5, Math.max(0.75, (state.world.priceIndex || 1) * drift));
    const emits = Math.min(3, Math.max(1, Math.round(months / 2)));
    for (let i = 0; i < emits; i++) {
      if (!chance(rng, 0.65)) continue;
      const text = pick(rng, MONTH_EVENTS);
      logEvent(state, text);
      events.push({ level: 'local', text });
    }
  }

  // 引擎结算的账目：工钱、吃住、账单、利息、衰减
  const addLedger = (list) => {
    for (const e of list || []) {
      logEvent(state, e.text, e.level);
      logLedger(state, e.text);
      events.push(e);
    }
  };
  // 按真实流逝的时间累计"整日"：零碎的短回合也能攒出一天，长跳就一次结完
  const elapsed = Math.max(0, Math.round(minutes || 0));
  state.player.accrualDays = (Number(state.player.accrualDays) || 0) + elapsed / 1440;
  const wholeDays = Math.min(3650, Math.floor(state.player.accrualDays));
  if (wholeDays > 0) {
    state.player.accrualDays -= wholeDays;
    addLedger(runWages(state, wholeDays));
    addLedger(runLiving(state, wholeDays));
  }
  if (months > 0) {
    addLedger(runBills(state, { months, days, years: crossed.years || 0 }, rng));
    addLedger(accrueDebts(state, months, rng));
    decayReputation(state, months);
    if (months >= 2) addLedger(decayRelations(state, months));
  }

  // 汽水工坊：每个月结一次账，整笔转给玩家（随身）
  if (months > 0) {
    const wk = state.player?.accounts?.find((a) => a.id === 'workshop');
    const payout = wk ? wk.copper : 0;
    if (payout > 0) {
      transferCopper(state, 'workshop', 'cash', payout);
      const t = `汽水工坊把这个月的账结了：${copperText(payout)} 已转到随身。`;
      logEvent(state, t);
      events.push({ level: 'local', text: t });
    }
  }

  // 汽水工坊：每天清一次当天的账（钱留在工坊账户里，等你自己调）
  const wd = state.player?.workshopDaily;
  if (wd && state.player.accounts?.some((a) => a.id === 'workshop')) {
    const key = `${state.clock.year}-${state.clock.doy}`;
    if (wd.key !== key) {
      if (wd.copper !== 0) {
        const t =
          wd.copper >= 0
            ? `汽水工坊当日净进 ${copperText(wd.copper)}，记在工坊账上。`
            : `汽水工坊当日净出 ${copperText(-wd.copper)}，记在工坊账上。`;
        logEvent(state, t);
        events.push({ level: 'local', text: t });
      }
      state.player.workshopDaily = { key, copper: 0 };
    }
  }

  // 年 tick
  if (crossed.years > 0) {
    state.player.age += crossed.years;
    if (state.player.age >= 16 && !state.flags?.awakeningAsked && !state.flags?.pendingAwakening) {
      state.flags ||= {};
      state.flags.pendingAwakening = true;
      const t = '你十六岁了。按规矩，这个年纪可以去郡城的觉醒塔试一次——要五枚金币。';
      logEvent(state, t);
      events.push({ level: 'local', text: t });
    }
    for (let y = 0; y < crossed.years; y++) {
      for (const npc of state.npcs) {
        npc.age += 1;
        const age = npc.age;
        if (age > 62 && chance(rng, 0.06)) {
          const t = NPC_EVENTS[4].text(npc.name);
          logEvent(state, t);
          events.push({ level: 'local', text: t });
          npc.dead = true;
          continue;
        }
        if (npc.dead) continue;
        if (age >= 18 && age <= 32 && chance(rng, 0.05)) {
          const t = NPC_EVENTS[1].text(npc.name);
          logEvent(state, t);
          events.push({ level: 'local', text: t });
        } else if (chance(rng, 0.05)) {
          const e = pick(rng, [NPC_EVENTS[0], NPC_EVENTS[2], NPC_EVENTS[3]]);
          const t = e.text(npc.name);
          logEvent(state, t);
          events.push({ level: 'local', text: t });
        }
      }
      const open = state.player.debts.filter((d) => d.status !== 'settled' && d.remaining > 0);
      if (open.length && chance(rng, 0.45)) {
        const d = open[0];
        const t = `${d.to}又来问了一次那笔钱`;
        logEvent(state, t);
        events.push({ level: 'local', text: t });
      }
    }
    state.npcs = state.npcs.filter((n) => !n.dead || n.id === 'npc_mother');
  }

  // 伤病恢复
  if (days > 0) {
    state.player.body.injuries = state.player.body.injuries.filter((inj) => {
      if (!inj.healDay) return true;
      return inj.healDay > state.clock.doy;
    });
  }

  return events;
}

/** 引擎独占的数值变化：体力、饥饿、伤。时间已由 advanceWorld 推进过，这里不再动。 */
export function engineDelta(judgeResult, state) {
  const delta = {
    body: {
      fatigue: judgeResult.fatigue,
      hunger: Math.round((judgeResult.minutes / 60) * 2.5),
      health: 0,
    },
  };
  if (judgeResult.injury) {
    delta.body.injuries = [
      { part: judgeResult.injury.part, severity: 'light', days: judgeResult.injury.days, note: '新伤' },
    ];
    delta.body.health = -6;
  }
  return delta;
}
