// 成长与衰减：技能只由引擎涨；关系与声望会随时间回落。
// 原则：数字不给模型，模型只写"他练了很久"这类话。
import { canonicalSkill, fixedSkills } from './skills.js';

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

const YEAR_MINUTES = 365 * 1440;
const GROWTH_RATE = { 珍奇: 2, 史诗: 3, 传说: 4 };
const AWAKENING = [
  { grade: '珍奇', name: '夜行者', effect: '拥有夜视能力' },
  { grade: '史诗', name: '魔力感知', effect: '拥有魔法感知能力' },
  { grade: '传说', name: '武器大师', effect: '精通所有武器' },
];
const SKILL_ATTRIBUTES = { 武技: ['body', 'agility'], 魔法: ['spirit', 'wisdom'], 炼金: ['wisdom'],
  机械: ['wisdom'], 察觉: ['wisdom'], 交涉: ['wisdom', 'spirit'] };
function actionAttributes(segment) {
  if (['rest', 'meta'].includes(segment.kind)) return [];
  if (segment.kind === 'travel') return ['body', 'agility'];
  if (segment.kind === 'stealth') return ['agility'];
  if (segment.kind === 'labor') return ['body'];
  return SKILL_ATTRIBUTES[canonicalSkill(segment.skill)] || [];
}

/** Accumulate integer minute-units, splitting at birthdays so short and long advances agree. */
export function advanceAttributes(state, minutes, rng, judged = null) {
  const player = state.player, stats = player.stats;
  player.attributeGrowth ||= {};
  let remaining = Math.max(0, Math.round(minutes || 0));
  let age = player.age;
  let offset = (state.clock.doy - 1) * 1440 + state.clock.hour * 60 + state.clock.minute;
  const events = [];
  const segments = judged?.segments?.length ? judged.segments : judged ? [{ ...judged, minutes: remaining }] : [];
  let segmentOffset = 0;
  const spans = segments.map(segment => {
    const start = segmentOffset; segmentOffset += Math.max(0, Math.round(Number(segment.minutes) || 0));
    return { start, end: segmentOffset, attributes: actionAttributes(segment) };
  });
  let progressed = 0;
  while (remaining > 0) {
    const elapsed = Math.min(remaining, YEAR_MINUTES - offset);
    if (age >= 12) {
      const rate = age < 16 ? 2 : GROWTH_RATE[player.talent?.grade] || 1;
      const cap = skillCap(state);
      for (const key of ['body', 'agility', 'wisdom', 'spirit']) {
        const actionMinutes = spans.reduce((sum, span) => sum + (span.attributes.includes(key)
          ? Math.max(0, Math.min(progressed + elapsed, span.end) - Math.max(progressed, span.start)) : 0), 0);
        const units = (Number(player.attributeGrowth[key]) || 0) + (elapsed + actionMinutes) * rate;
        const points = Math.floor(units / YEAR_MINUTES);
        const before = Number(stats[key]) || 0;
        stats[key] = Math.max(before, Math.min(cap, before + points));
        player.attributeGrowth[key] = stats[key] >= cap ? 0 : units % YEAR_MINUTES;
      }
    }
    remaining -= elapsed; offset += elapsed; progressed += elapsed;
    if (offset === YEAR_MINUTES) {
      age++; offset = 0;
      if (age === 16 && !player.talent) {
        const roll = rng();
        player.talent = { ...AWAKENING[roll < 0.5 ? 0 : roll < 0.9 ? 1 : 2] };
        state.flags ||= {}; state.flags.awakeningAsked = true; state.flags.pendingAwakening = false;
        events.push({ level: 'local', text: `你年满十六岁，觉醒了${player.talent.grade}天赋「${player.talent.name}」：${player.talent.effect}。` });
      }
    }
  }
  return events;
}

/** 技能上限：默认 100；传说天赋的那位，四维与技能都放到 200。 */
export function skillCap(state) {
  const grade = state?.player?.talent?.grade;
  if (grade === '传说') return 200;
  if (grade === '史诗') return 150;
  if (grade === '珍奇') return 130;
  return 100;
}

/** 只训练判定所用的固定技能，不根据动作标签创建新类型。 */
export function skillNameFor(judged) {
  if (!judged) return '';
  if (judged.kind === 'rest' || judged.kind === 'meta') return '';
  return canonicalSkill(judged.skill);
}

/**
 * 技能成长：时间越长、难度越高、余量越大，长得越多；等级越高越慢。
 * 返回实际涨的点数（可能是 0）。
 */
export function trainSkill(state, judged) {
  if (judged?.segments?.length > 1) return judged.segments.reduce((sum, segment) => sum + trainSkill(state, { ...judged, ...segment, segments: null }), 0);
  const name = skillNameFor(judged);
  const p = state.player;
  if (!name || !p.skills) return 0;

  p.skills = fixedSkills(p.skills);
  const sk = p.skills.find((x) => x.name === name);

  const minutes = Math.max(1, Number(judged.minutes) || 10);
  const margin = Number(judged.margin) || 0;
  const level = Number(sk.level) || 0;

  // 基础量：一次一小时的动作约 0.12 点
  const days = minutes / 1440;
  const base = 0.02 + Math.min(0.35, minutes / 480) + Math.log2(Math.max(1, minutes / 480)) * 0.35
    + Math.max(0, days - 1) * 0.08;
  const quality = 1 + Math.max(-0.5, Math.min(0.8, margin / 60));
  const slowdown = 1 / (1 + level / 25);
  const gain = base * quality * slowdown;

  sk.xp = (Number(sk.xp) || 0) + gain;
  const before = level;
  const cap = skillCap(state);
  while (sk.xp >= 1) {
    sk.xp -= 1;
    const cur = Number(sk.level) || 0;
    // 只增不减：存档里已经超上限的老号（比如武技 130）不会被这一行砍回去
    sk.level = Math.max(cur, Math.min(cap, cur + 1));
    if (cur >= cap) {
      sk.xp = 0;
      break;
    }
  }
  return Math.max(0, (Number(sk.level) || 0) - before);
}

/**
 * 关系衰减：一个月没打过交道的，亲近回落一点。
 * months 是这段跨度里过去的月数。
 */
export function decayRelations(state, months) {
  if (!months || months <= 0) return [];
  const out = [];
  const now = (state.clock?.year || 0) * 365 + (state.clock?.doy || 1) - 1;
  const p = state.player;
  for (const r of p.relations || []) {
    const last = Number(r.lastTouch) || 0;
    if (!last) {
      // 老存档没有这个字段：从这一次开始算，不追溯扣分
      r.lastTouch = now;
      continue;
    }
    if (now - last < 30) continue;
    const steps = Math.min(6, months);
    const before = r.closeness;
    if (r.closeness > 0) r.closeness = Math.max(0, Math.round((r.closeness - steps * 0.65) * 10) / 10);
    if (Math.round(before) !== Math.round(r.closeness)) {
      const npc = state.npcs.find((x) => x.id === r.npcId);
      out.push({ level: 'local', text: `${npc?.name || r.npcId}那边，来往少了些。` });
    }
  }
  return out;
}

/** 声望回落：长时间没有新事迹，名声会淡。 */
export function decayReputation(state, months) {
  if (!months || months <= 0) return;
  const steps = Math.min(6, months);
  for (const key of Object.keys(state.player.reputation || {})) {
    const v = state.player.reputation[key];
    if (v > 0) state.player.reputation[key] = Math.max(0, v - Math.ceil(steps / 2));
    else if (v < 0) state.player.reputation[key] = Math.min(0, v + Math.ceil(steps / 3));
  }
}
