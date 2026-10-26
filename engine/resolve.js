import { int } from './rng.js';
import { actionAbilities, abilityBrief } from './abilities.js';

const RULES = [
  ['labor', /打水|打饭|打酒|打柴|打扫|劈柴|挑水|喂|搬|挖|帮工|收拾|修屋|种田/],
  ['combat', /攻击|砍|刺杀|刺向|刺一|刺深|揍|搏斗|动手|打他|打人|打死|打起来|拔刀|拔剑|杀|抵挡|挡住|防御|招架|格挡|射击|射箭|投掷|掷出|投出|扔出|掷(?:飞刀|飞斧|标枪|飞镖)|投(?:矛|枪)|射(?:出|向|一箭)/],
  ['stealth', /悄悄|偷偷|溜|躲|潜行|摸过去|不让人看见/],
  ['trade', /买|卖|交易|换钱|讲价|讨价|付钱|赊/],
  ['study', /学|读|练|背书|请教|研究|琢磨/],
  ['social', /说|问|求|谈|劝|骂|告诉|请求|商量|打招呼/],
  ['observe', /看|听|找|查|观察|留意|打听|四周|盯|窥|监视|数一数/],
  ['travel', /去|走|出发|赶路|前往|上路|回城|回家|返回/],
  ['rest', /坐|躺|睡|歇|发呆|蹲|喘|什么也不做|等待|等到|等一会|吃|喝|休息/],
];
const PROFILE = {
  rest: { label: '休息与生活', stat: 'spirit', skill: '', diff: 0, minutes: [15, 45] },
  labor: { label: '体力活', stat: 'body', skill: '干杂活', diff: 22, minutes: [30, 90] },
  combat: { label: '动手', stat: 'body', skill: '武技', diff: 40, minutes: [5, 20] },
  stealth: { label: '暗中行事', stat: 'agility', skill: '潜行', diff: 32, minutes: [10, 30] },
  trade: { label: '交易', stat: 'wisdom', skill: '交涉', diff: 26, minutes: [10, 30] },
  social: { label: '说话', stat: 'wisdom', skill: '交涉', diff: 28, minutes: [10, 30] },
  study: { label: '学习', stat: 'wisdom', skill: '识字', diff: 28, minutes: [60, 180] },
  observe: { label: '观察', stat: 'wisdom', skill: '察觉', diff: 24, minutes: [10, 20] },
  travel: { label: '赶路', stat: 'body', skill: '识路', diff: 24, minutes: [120, 480] },
  meta: { label: '查看与纠错', stat: 'wisdom', skill: '', diff: 0, minutes: [0, 0] },
};
const OUTCOMES = [
  { key: 'crush', cn: '实力碾压', min: 15 }, { key: 'critical', cn: '大成功', min: 7 },
  { key: 'success', cn: '成功', min: 0 }, { key: 'partial', cn: '部分成功', min: -10 },
  { key: 'fail', cn: '失败', min: -20 }, { key: 'disaster', cn: '灾难', min: -Infinity },
];
export function isCorrection(text) {
  return /^\/(纠错|纠正|重试|撤回)/.test(text) || /账.*(不对|错|乱)|钱数.*(不对|没.*增加)|没有.*(入账|新增)|光支出|重复(扣|结算)|不仅没增加|给我.*(重新|按照.*收入).*结算/.test(text);
}
const FUTURE = /^(?:我(?:们)?(?:打算|计划|准备)?|打算|计划|准备)?(?:明天|明日|明早|明晚|后天|下周|下个月|改天|以后|稍后|待会儿?)/;
const SPEECH = /^(?:我(?:们)?(?:想|要)?|向[^，。；]{1,12})?(?:问|询问|请问|打听|说|告诉|聊|谈|劝|请求|商量|打招呼)/;

/** Separate what is being done now from quoted speech and future plans. */
export function currentAction(text) {
  const raw = String(text || '');
  const withoutQuotes = raw.replace(/“[^”]*”|「[^」]*」|『[^』]*』|"[^"\n]*"/g, '（引语）');
  const active = [], future = [];
  for (const part of withoutQuotes.split(/[，,。；;！？!?\n]+/).map(s => s.trim()).filter(Boolean)) {
    if (FUTURE.test(part)) future.push(part);
    else active.push(part);
  }
  const execution = active.join('，').replace(/不(?:要|想|打算|会)?(?:杀|砍|攻击|买|卖|交易)[^，。；,!！]*[，。；,!！]?/g, '');
  return { text: execution, parts: execution.split('，').filter(Boolean), future };
}

export function classify(text) {
  const raw = String(text || '');
  if (isCorrection(raw) || /^\/(状态|时间|存档|整理记忆|编年)/.test(raw)) return 'meta';
  const action = currentAction(raw);
  if (!action.text) return 'meta';
  const kinds = action.parts.map(part => SPEECH.test(part) ? 'social'
    : /^(?:我)?(?:先)?等(?:待|到|一会|\d|[一二两三四五六七八九十])/u.test(part) ? 'rest'
      : RULES.find(([, re]) => re.test(part))?.[0]).filter(Boolean);
  return RULES.find(([kind]) => kinds.includes(kind))?.[0] || (/^(好的?|可以|同意|答应|行|不行|不用|不了|谢谢)[。！!]?$/u.test(raw) ? 'social' : 'observe');
}
function numeral(s) {
  if (/^\d+(?:\.\d+)?$/.test(s)) return Number(s);
  if (s === '半') return 0.5;
  const digits = { 零: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
  let total = 0, current = 0;
  for (const ch of s) {
    if (ch === '百' || ch === '十') { total += (current || 1) * (ch === '百' ? 100 : 10); current = 0; }
    else if (ch in digits) current = digits[ch];
  }
  return total + current;
}
export function actionMinutes(text, kind, fallback, clock = null) {
  if (kind === 'meta') return 0;
  const execution = currentAction(text).text;
  const duration = /(?<number>\d+(?:\.\d+)?|[一二两三四五六七八九十百半]+)(?:整|个)?(?<halfBefore>半)?(?<unit>分钟|小时|天|日|周|星期|个月|月|年)(?<halfAfter>半)?/g;
  for (const m of execution.matchAll(duration)) {
    const after = execution.slice(m.index + m[0].length), before = execution.slice(0, m.index);
    const { number, unit, halfBefore, halfAfter } = m.groups;
    if (number === '四' && unit === '周'
      && /(?:看看?|查看|观察|打量|环顾|环视|留意)$/.test(before)
      && !/连续|持续|整整/.test(before) && !/^(?:时间|之久)/.test(after)) continue;
    if (/^(?:(?:以|之)?前|之内|内|的|以来|期间)/.test(after) || /(?:过去|最近|近|此前|之前|以前|上次)\s*$/.test(before)) continue;
    if (/^(?:以|之)?后/.test(after) && !/(?:等|睡|歇|休息|练|学习|工作|赶路|守夜)[^，]{0,8}$/.test(before)) continue;
    return Math.max(1, Math.min(3650 * 1440, Math.round((numeral(number) + (halfBefore || halfAfter ? 0.5 : 0)) * ({ 分钟: 1, 小时: 60, 天: 1440, 日: 1440, 周: 10080, 星期: 10080, 个月: 43200, 月: 43200, 年: 525600 }[unit]))));
  }
  if (kind === 'rest') {
    const morning = /睡到天亮|睡到(?:早上|清晨)|(?:睡|歇下|歇息).*(?:明早|明日早上)/.test(text);
    if (morning && clock) {
      const hour = /天亮|清晨/.test(text) ? 6 : 7;
      return (hour * 60 - clock.hour * 60 - clock.minute + 1440) % 1440 || 1440;
    }
    if (/睡.*(觉|夜)|歇下|休息一夜/.test(execution)) return 480;
    if (/一整天|整日/.test(execution)) return 1440;
  }
  return fallback;
}
function difficultyFor(state, text, kind, fallback) {
  if (kind !== 'combat') return fallback;
  if (/巫妖皇|区域灾难|上位深渊|传说神异/.test(text)) return 270;
  if (/深渊领主|地狱公爵|T5/.test(text)) return 190;
  if (/炎魔|亡灵骑士|T4/.test(text)) return 130;
  if (/尸巫|大恶魔|地狱伯爵|T3/.test(text)) return 95;
  if (/角魔|双头犬|幽灵|T2/.test(text)) return 65;
  if (/鸡|小鼠|稻草人/.test(text)) return 10;
  const target = state.npcs.find(n => text.includes(n.name) && n.stats);
  return target ? Math.max(10, (target.stats.body || 10) * 0.8 + (target.combatSkill || 0) * 1.5) : fallback;
}
export function judge(state, text, rng) {
  const kind = classify(text), prof = PROFILE[kind], p = state.player;
  const intent = currentAction(text);
  const effects = actionAbilities(state, intent.text, kind);
  const minutes = actionMinutes(text, kind, int(rng, ...prof.minutes), state.clock);
  const weaponStudy = kind === 'study' && effects.weapon;
  const statName = weaponStudy ? 'body' : prof.stat, skillName = weaponStudy ? '武技' : prof.skill;
  const stat = p.stats[statName] || 10;
  const skill = p.skills.find(s => s.name === skillName)?.level ?? Math.max(0, (stat - 10) * 0.4);
  const mods = [];
  let ability = 15 + stat * 0.8 + skill * 1.5;
  ability += effects.weaponBonus + effects.masteryBonus;
  if (effects.weapon && ['combat', 'study'].includes(kind)) mods.push(`使用${effects.weapon.label}`);
  if (effects.masteryBonus) mods.push('所有武器精通');
  if (effects.rules.magicSense && kind === 'observe' && /魔法|魔力|灵气|法术/.test(intent.text)) { ability += 6; mods.push('魔法感知'); }
  if (p.body.health < 60) { ability -= 8; mods.push('健康欠佳'); }
  if (state.clock.hour < 6 || state.clock.hour > 20) {
    if (effects.rules.nightSight && ['observe', 'stealth'].includes(kind)) mods.push('夜视');
    else { ability -= ['observe', 'stealth'].includes(kind) ? 8 : 3; mods.push('天黑'); }
  }
  if (['storm', 'snow'].includes(state.clock.weather)) { ability -= 5; mods.push('天气恶劣'); }
  if (p.age < 15) { ability -= 4; mods.push('年纪小'); }
  if (/提前准备|备好|侦察过|事先查清|设好埋伏/.test(intent.text)) { ability += 5; mods.push('准备充分'); }
  const difficulty = difficultyFor(state, intent.text, kind, prof.diff);
  const margin = ability - difficulty, score = margin + (rng() - 0.5) * 20;
  let outcome = OUTCOMES.find(o => score >= o.min);
  if (outcome.key === 'crush' && margin < 12) outcome = OUTCOMES[1];
  if (kind === 'rest' || kind === 'meta' || (kind === 'social' && !/说服|劝服|欺骗|威胁|撒谎|谈判|交涉|请求|劝|求/.test(intent.text))) outcome = OUTCOMES[2];
  return { kind, label: prof.label, skill: skillName, statName, stat, skillLevel: Number(skill.toFixed(1)), effects,
    ability: Math.round(ability), difficulty: Math.round(difficulty), margin, score: Math.round(score),
    outcome: outcome.key, outcomeCn: outcome.cn, modifiers: mods, minutes, actionText: intent.text, futurePlans: intent.future };
}
export function judgeBrief(d) {
  return `当前行动：${d.actionText || '只作计划，不执行未来行动'}\n判定：${d.label}｜${d.outcomeCn}${d.modifiers.length ? `（${d.modifiers.join('、')}）` : ''}\n依据：${d.statName} ${d.stat} + ${d.skill || '生活行动'} ${d.skillLevel}，难度 ${d.difficulty}\n${abilityBrief(d.effects)}\n本回合耗时：${d.minutes} 分钟（由引擎统一推进）${d.futurePlans?.length ? `\n留待以后、这回合不得执行：${d.futurePlans.join('；')}` : ''}`;
}
