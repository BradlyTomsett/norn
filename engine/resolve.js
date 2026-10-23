// 判定：由代码算，模型只负责把这个结果写成文字。
import { int, pick } from './rng.js';

const RULES = [
  { kind: 'rest', re: /坐下|坐着|坐|躺|睡|歇|发呆|蹲|喘|什么也不做|等一会儿/ },
  { kind: 'labor', re: /打水|打饭|打酒|打柴|打扫|打盹|劈柴|挑水|喂/ },
  { kind: 'combat', re: /攻击|砍|刺|揍|搏斗|动手|打他|打人|打死|打起来|拔刀|拔剑|杀/ },
  { kind: 'stealth', re: /悄悄|偷偷|溜|躲|潜行|摸过去|不让人看见/ },
  { kind: 'trade', re: /买|卖|换|讲价|讨价|付钱|赊/ },
  { kind: 'study', re: /学|读|练|背|请教|研究|琢磨/ },
  { kind: 'social', re: /说|问|求|谈|劝|骂|告诉|请求|商量|打招呼/ },
  { kind: 'observe', re: /看|听|找|查|观察|留意|打听|四周|盯|窥|监视|数一数/ },
  { kind: 'labor', re: /干|搬|挖|劈|挑|帮工|收拾|扫|修|种/ },
  { kind: 'travel', re: /去|走|出发|赶路|前往|上路|回/ },
];

const PROFILE = {
  rest: { label: '歇着', stat: 'spirit', skill: '', diff: 6, minutes: [15, 45], fatigue: [-8, -3] },
  labor: { label: '体力活', stat: 'body', skill: '干杂活', diff: 22, minutes: [30, 90], fatigue: [6, 12] },
  combat: { label: '动手', stat: 'body', skill: '武技', diff: 40, minutes: [5, 20], fatigue: [10, 18] },
  stealth: { label: '暗中行事', stat: 'agility', skill: '潜行', diff: 32, minutes: [10, 30], fatigue: [4, 8] },
  trade: { label: '交易', stat: 'wisdom', skill: '交涉', diff: 26, minutes: [10, 30], fatigue: [1, 3] },
  social: { label: '说话', stat: 'wisdom', skill: '交涉', diff: 28, minutes: [10, 30], fatigue: [1, 4] },
  study: { label: '学习', stat: 'wisdom', skill: '识字', diff: 28, minutes: [60, 180], fatigue: [4, 8] },
  observe: { label: '观察', stat: 'wisdom', skill: '察觉', diff: 24, minutes: [10, 20], fatigue: [2, 5] },
  travel: { label: '赶路', stat: 'body', skill: '识路', diff: 24, minutes: [120, 480], fatigue: [10, 20] },
};

const OUTCOMES = [
  { key: 'crush', cn: '实力碾压', min: 15 },
  { key: 'critical', cn: '大成功', min: 7 },
  { key: 'success', cn: '成功', min: 0 },
  { key: 'partial', cn: '部分成功', min: -10 },
  { key: 'fail', cn: '失败', min: -20 },
  { key: 'disaster', cn: '灾难', min: -Infinity },
];

export function classify(text) {
  const t = String(text || '');
  for (const r of RULES) if (r.re.test(t)) return r.kind;
  return 'labor';
}

function skillLevel(state, name, statValue = 10) {
  const v = state.player.skills.find((s) => s.name === name);
  if (v) return v.level;
  // 技能表简化后可能没有这一项：按主属性折算，避免"传奇人物不会赶路"
  return Math.max(0, (statValue - 10) * 0.4);
}

/** 返回本回合的判定结果；时间与体力由引擎写死，模型不得更改。 */
export function judge(state, text, rng) {
  const kind = classify(text);
  const prof = PROFILE[kind];
  const p = state.player;

  // 歇着不算挑战：一定成功，只回体力
  if (kind === 'rest') {
    const minutes = int(rng, prof.minutes[0], prof.minutes[1]);
    return {
      kind,
      label: prof.label,
      skill: prof.skill || '—',
      statName: '精神',
      stat: p.stats.spirit,
      skillLevel: 0,
      ability: 0,
      difficulty: prof.diff,
      score: 0,
      outcome: 'success',
      outcomeCn: '成功',
      modifiers: [],
      minutes,
      fatigue: int(rng, prof.fatigue[0], prof.fatigue[1]),
      injury: null,
    };
  }

  const stat = p.stats[prof.stat] || 10;
  const skill = skillLevel(state, prof.skill, stat);
  let ability = 15 + stat * 0.8 + skill * 1.5;

  const mods = [];
  if (p.body.fatigue > 55) {
    ability -= 6;
    mods.push('疲乏');
  }
  if (p.body.hunger > 60) {
    ability -= 5;
    mods.push('饥饿');
  }
  if (p.body.health < 60) {
    ability -= 8;
    mods.push('带伤');
  }
  if (p.body.injuries?.length) {
    ability -= Math.min(12, p.body.injuries.length * 5);
    mods.push('旧伤');
  }
  const hour = state.clock.hour;
  const night = hour < 6 || hour > 20;
  if (night) {
    ability -= kind === 'observe' || kind === 'stealth' ? 8 : 3;
    mods.push('天黑夜');
  }
  if (state.clock.weather === 'storm' || state.clock.weather === 'snow') {
    ability -= 5;
    mods.push('天候恶劣');
  } else if (state.clock.weather === 'rain') {
    ability -= 2;
    mods.push('下雨');
  }
  // 年龄：12 岁的孩子做什么都吃亏
  if (p.age < 15) {
    ability -= 4;
    mods.push('年纪小');
  }

  // 难度是世界的固有难度，不随角色变强而上浮。
  // 强者碾压普通事，是应该的；要给他压力，得靠世界里真有更强的东西，不能偷偷调高难度。
  const noise = (rng() - 0.5) * 20;
  const difficulty = prof.diff;
  const baseMargin = ability - difficulty;
  const score = baseMargin + noise;
  let outcome = OUTCOMES.find((o) => score >= o.min);
  // 碾压必须"底子就强"，不能靠一次好运摇出来
  if (outcome.key === 'crush' && baseMargin < 12) outcome = OUTCOMES[1];

  const minutes = int(rng, prof.minutes[0], prof.minutes[1]);
  const fatigue = int(rng, prof.fatigue[0], prof.fatigue[1]);

  const detail = {
    kind,
    label: prof.label,
    skill: prof.skill,
    statName: prof.stat,
    stat,
    skillLevel: Number(skill.toFixed(1)),
    ability: Math.round(ability),
    difficulty: Math.round(difficulty),
    margin: Math.round(baseMargin),
    score: Math.round(score),
    outcome: outcome.key,
    outcomeCn: outcome.cn,
    modifiers: mods,
    minutes,
    fatigue,
    injury: null,
  };

  // 动手失败、或任何"灾难"，都会留下需要记录的伤
  if (kind === 'combat' && (outcome.key === 'fail' || outcome.key === 'disaster')) {
    detail.injury = { part: pick(rng, ['左臂', '右肩', '肋下', '额头', '左腿']), days: int(rng, 4, 14) };
  } else if (outcome.key === 'disaster') {
    detail.injury = { part: pick(rng, ['左脚踝', '膝盖', '手腕', '额头']), days: int(rng, 3, 10) };
  }

  return detail;
}

/** 把判定写成人话，塞进提示词。 */
export function judgeBrief(d) {
  const mod = d.modifiers.length ? `（受${d.modifiers.join('、')}影响）` : '';
  return [
    `判定：${d.label}｜${d.outcomeCn}${mod}`,
    `依据：${d.statName} ${d.stat} + ${d.skill} ${d.skillLevel}，难度 ${d.difficulty}`,
    `本回合耗时：${d.minutes} 分钟；体力消耗：约 ${d.fatigue}`,
    d.injury ? `受伤：${d.injury.part}，约 ${d.injury.days} 天` : null,
  ]
    .filter(Boolean)
    .join('\n');
}
