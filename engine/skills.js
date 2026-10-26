// All entry points share the same six skills. Legacy aliases never create a seventh row.
export const SKILL_NAMES = Object.freeze(['武技', '魔法', '炼金', '机械', '察觉', '交涉']);
const aliases = new Map([
  ['药材', '炼金'], ['炼金术', '炼金'], ['草药', '炼金'], ['制药', '炼金'],
  ['锻造', '机械'], ['修理', '机械'], ['制作', '机械'], ['烹饪', '机械'],
  ['潜行', '察觉'], ['识字', '察觉'], ['商谈', '交涉'], ['说服', '交涉'],
  ['剑术', '武技'], ['弓术', '武技'], ['格斗', '武技'], ['法术', '魔法'], ['符文', '魔法'],
]);
export function canonicalSkill(name) {
  const text = String(name || '').trim();
  return SKILL_NAMES.includes(text) ? text : aliases.get(text) || '';
}
const nonnegative = value => Number.isFinite(Number(value)) ? Math.max(0, Number(value)) : 0;

/** Keep the strongest existing record rather than adding duplicate/renamed levels together. */
export function fixedSkills(rows) {
  const skills = SKILL_NAMES.map(name => ({ name, level: 0, xp: 0 }));
  for (const row of Array.isArray(rows) ? rows : []) {
    const name = canonicalSkill(row?.name);
    if (!name) continue; // 干杂活、识路、认路 are deliberately retired, with no transferred points.
    const current = skills.find(skill => skill.name === name), level = nonnegative(row.level), xp = nonnegative(row.xp);
    if (level > current.level || (level === current.level && xp > current.xp)) Object.assign(current, { level, xp });
  }
  return skills;
}

/** Classify the actual action, not the name of an object mentioned in conversation. */
export function actionSkill(kind, text = '') {
  if (['rest', 'meta'].includes(kind)) return '';
  if (['trade', 'social'].includes(kind)) return '交涉';
  if (kind === 'combat') return /施法|法术|魔法|魔力|念咒|火球|冰箭|闪电术/.test(text) ? '魔法' : '武技';
  if (['travel', 'stealth'].includes(kind)) return '察觉';
  if (/炼金|药材|草药|药剂|制药|辨药|配药|配制.*药/.test(text)) return '炼金';
  if (kind === 'craft') return '机械';
  if (kind === 'study') {
    if (/武技|剑|刀|枪|矛|弓|斧|锤|武器|格斗|练武/.test(text)) return '武技';
    if (/法术|魔法|施法|魔力|符文/.test(text)) return '魔法';
    if (/机械|维修|修理|制作|锻造|打铁|烹饪|做饭/.test(text)) return '机械';
    if (/交涉|说服|谈判|交易/.test(text)) return '交涉';
  }
  if (kind === 'labor') return '机械';
  return '察觉';
}
