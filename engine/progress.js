// 成长与衰减：技能只由引擎涨；关系与声望会随时间回落。
// 原则：数字不给模型，模型只写"他练了很久"这类话。

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/** 技能上限：默认 100；传说天赋的那位，四维与技能都放到 200。 */
export function skillCap(state) {
  const grade = state?.player?.talent?.grade;
  if (grade === '传说') return 200;
  if (grade === '史诗') return 150;
  if (grade === '珍奇') return 130;
  return 100;
}

/** 这次行动用到哪个技能，由判定给出；没有技能名就用动作标签。 */
export function skillNameFor(judged) {
  if (!judged) return '';
  if (judged.kind === 'rest' || judged.kind === 'meta') return '';
  const s = judged.skill && judged.skill !== '—' ? judged.skill : judged.label;
  return String(s || '').slice(0, 12);
}

/**
 * 技能成长：时间越长、难度越高、余量越大，长得越多；等级越高越慢。
 * 返回实际涨的点数（可能是 0）。
 */
export function trainSkill(state, judged) {
  const name = skillNameFor(judged);
  const p = state.player;
  if (!name || !p.skills) return 0;

  let sk = p.skills.find((x) => x.name === name);
  if (!sk) {
    sk = { name, level: 1, xp: 0 };
    p.skills.push(sk);
  }

  const minutes = Math.max(1, Number(judged.minutes) || 10);
  const margin = Number(judged.margin) || 0;
  const level = Number(sk.level) || 0;

  // 基础量：一次一小时的动作约 0.12 点
  const base = 0.02 + Math.min(0.35, minutes / 480);
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
  const now = (state.clock?.year || 0) * 365 + (state.clock?.doy || 0);
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
    r.closeness = clamp(r.closeness - steps * 0.65, -100, 100);
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
