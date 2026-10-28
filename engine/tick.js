// 世界 tick：玩家不动的时候，世界也在走。
// 这里只产出"事实"（事件 + 数值），叙事交给模型。
import { advanceClock } from './clock.js';
import { chance, int, pick } from './rng.js';
import { addCopper, copperText, logLedger } from './state.js';
import { accrueDebts, ensureDebts, ensureWork, runBills, runLiving, runWages } from './ledger.js';
import { ensureAssets, runIndustries } from './assets.js';
import { decayRelations, decayReputation, advanceAttributes } from './progress.js';
import { upgradeState, absoluteDay } from './schema.js';
import { advanceNpcs, ensureNpcState } from './npcs.js';
import { actionAbilities } from './abilities.js';
import { expireEffects } from './effects.js';

const DAY_EVENTS = [
  '路上过了一队收羊毛的商人，价压得很低',
  '南边的车辙被雨水冲坏了一段，绕路要多走一个小时',
  '邻家丢了一只鸡，女人们在井台边说了半天',
  '管事的副手骑马经过，没停，溅了一路泥',
  '镇口来了两个不认识的年轻人，说是找活干',
  '集市上多了一个卖旧铁器的摊子',
  '夜里有狗叫了半宿，第二天谁也说不上为什么',
];

const MONTH_EVENTS = [
  '面粉涨了一点，磨坊那边说是新麦还没下来',
  '镇上的酒馆换了店主，价钱没变，量少了一点',
  '教会的小堂修了屋顶，捐钱的是磨坊主',
  '南边林子又有人不敢进了，说是看见过火光',
  '一队士兵路过，住了一晚，吃了镇上不少东西',
  '铁匠铺的火停了三天，说是煤没跟上',
  '有人在集上卖一张旧地图，标着林子深处的一条路',
];

const NPC_EVENTS = [
  { type: 'ill', text: (n) => `${n}病了一场，躺了十来天，人瘦了一圈` },
  { type: 'marry', text: (n) => `${n}与邻镇的一位手艺人成了婚` },
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
export function advanceWorld(state, minutes, rng, judged) {
  upgradeState(state);
  ensureNpcState(state);
  const growthEvents = advanceAttributes(state, minutes, rng);
  const beforeDay = absoluteDay(state.clock);
  const { clock, crossed } = advanceClock(state.clock, minutes || 0, rng);
  state.clock = clock;
  expireEffects(state);
  const events = [...growthEvents];
  for (const event of growthEvents) logEvent(state, event.text, event.level);
  ensureDebts(state);
  ensureWork(state);

  const days = Math.max(0, crossed.days || 0);
  // 月数：长跨度按整月算，短跨度只跨了一次月界也要算一个月
  const months = crossed.months;

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

  // 赶路：只算吃喝，1 天 2 铜的干粮钱
  if (judged?.kind === 'travel' && ['journey', 'route'].includes(judged.travelScope)) {
    const fee = Math.max(1, Math.round((elapsed / 1440) * 2));
    const cash = state.player.accounts.find((a) => a.id === 'cash');
    if (cash && cash.copper >= fee) {
      addCopper(state, 'cash', -fee);
      addLedger([{ level: 'local', text: `路上买干粮花了 ${copperText(fee)}。` }]);
    }
  }

  ensureAssets(state);
  addLedger(runBills(state, { months, days, weeks: Math.floor(absoluteDay(state.clock) / 7) - Math.floor(beforeDay / 7), years: crossed.years || 0 }, rng));
  if (months > 0) {
    addLedger(runIndustries(state, months));
    addLedger(accrueDebts(state, months, rng));
    decayReputation(state, months);
    addLedger(decayRelations(state, months));
  }

  // 「汽水工坊」现在是一个正常账户：产业月收益直接进它，不再每月自动转随身。
  // 要动用里面的钱，由玩家自己写 transfer。

  // 年 tick
  if (crossed.years > 0) {
    state.player.age += crossed.years;
    for (let y = 0; y < crossed.years; y++) {
      for (const npc of state.npcs) {
        npc.age += 1;
        if (npc.dead) continue;
        const age = npc.age;
        const lifespan = { human: 90, elf: 800, halfelf: 350, orc: 90, dwarf: 150, dragonkin: 400, underdark: 150, highland: 150 }[npc.race] || 90;
        if (age > lifespan && chance(rng, 0.06)) {
          const t = NPC_EVENTS[4].text(npc.name);
          logEvent(state, t);
          events.push({ level: 'local', text: t });
          npc.dead = true;
          continue;
        }
        if (npc.dead) continue;
        if (!npc.married && age >= 18 && age <= 32 && chance(rng, 0.05)) {
          const t = NPC_EVENTS[1].text(npc.name);
          logEvent(state, t);
          events.push({ level: 'local', text: t });
          npc.married = true;
        } else if (chance(rng, 0.05)) {
          const e = pick(rng, [NPC_EVENTS[2], NPC_EVENTS[3]]);
          const t = e.text(npc.name);
          logEvent(state, t);
          events.push({ level: 'local', text: t });
          if (e.type === 'move') npc.location = { siteId: 'county', siteName: '郡城' };
          if (e.type === 'promote') npc.rank = (Number(npc.rank) || 0) + 1;
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
  }

  for (const e of advanceNpcs(state)) { logEvent(state, e.text, e.level); events.push(e); }

  return events;
}

/** The engine owns combat health changes; time has already advanced exactly once. */
export function engineDelta(judgeResult, state) {
  const effects = judgeResult.effects || actionAbilities(state, judgeResult.actionText || '', judgeResult.kind);
  const immune = effects.blocked;
  const damage = judgeResult.kind === 'combat' && ['fail', 'disaster'].includes(judgeResult.outcome) && !immune ? -Math.max(1, 6 - (effects?.defenseBonus || 0)) : 0;
  const restMinutes = judgeResult.segments ? judgeResult.segments.filter(s => s.kind === 'rest').reduce((sum, s) => sum + s.minutes, 0) : judgeResult.kind === 'rest' ? judgeResult.minutes : 0;
  const recovery = restMinutes >= 360 ? 10 : 0;
  return { body: { health: damage + recovery } };
}
