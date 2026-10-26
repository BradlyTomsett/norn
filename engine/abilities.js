import { gearState, chooseWeapon, GRADE_BONUS } from './equipment.js';

export function talentRules(player) {
  const text = String(player.talent?.effect || '');
  const affirmed = match => !/(?:不|非|没有|并无|不具备|不具有|不能|无法|未能|不会|有益)\s*$/.test(text.slice(Math.max(0, match.index - 8), match.index));
  const contains = pattern => [...text.matchAll(new RegExp(pattern.source, 'g'))].some(affirmed);
  const spans = [...text.matchAll(/免疫([^；;。\n]*?)(?=；|;|。|\n|但|不过|$)/g)].filter(affirmed).map(row => row[1]).join('；');
  const has = pattern => pattern.test(spans);
  const immunity = [];
  if (has(/物理/) || contains(/物理(?:攻击|伤害)?免疫/)) immunity.push('physical');
  if (/魔法/.test(spans.replace(/有益魔法/g, '')) || contains(/魔法免疫/)) immunity.push('magic');
  if (has(/冰|寒冷|冻结/) || contains(/冰(?:冻)?免疫/)) immunity.push('ice');
  if (has(/火|灼烧/) || contains(/火(?:焰)?免疫/)) immunity.push('fire');
  if (has(/电|雷/) || contains(/雷电免疫/)) immunity.push('lightning');
  if (has(/毒/) || contains(/毒(?:素)?免疫/)) immunity.push('poison');
  return { immunity, allWeapons: contains(/精通(?:所有|全部|一切)武器|全武器精通/),
    nightSight: contains(/夜视|黑暗视觉|暗视/), magicSense: contains(/魔法感知|魔力感知|感知魔(?:力|法)/) };
}
const TYPE_CN = { physical: '物理攻击', magic: '不利魔法', ice: '冰', fire: '火', lightning: '电', poison: '毒' };
export function talentRuleText(player) {
  const rules = talentRules(player), rows = [];
  if (rules.allWeapons) rows.push('所有武器沿用现有武技，并获得精通优势');
  if (rules.immunity.length) rows.push('免疫：' + rules.immunity.map(type => TYPE_CN[type]).join('、') + '；有益魔法可接受');
  if (rules.nightSight) rows.push('观察和潜行不受黑暗视线惩罚');
  if (rules.magicSense) rows.push('查看魔法痕迹时获得感知优势');
  return rows;
}
function incomingTypes(state, action) {
  const target = state.npcs.find(npc => action.includes(npc.name));
  const defined = target?.attackTypes || (target?.attackType ? [target.attackType] : []);
  const valid = defined.filter(type => Object.hasOwn(TYPE_CN, type));
  const defend = action.match(/(?:抵挡|挡住|承受|防御|躲避|迎接)([^，。；]{0,30})/);
  if (defend) {
    const text = defend[1], types = [];
    if (/火|灼烧/.test(text)) types.push('fire'); if (/冰|冻/.test(text)) types.push('ice');
    if (/雷|电击/.test(text)) types.push('lightning'); if (/毒/.test(text)) types.push('poison');
    if (/魔法|法术|火球|冰锥|诅咒|定身|控制/.test(text)) types.push('magic');
    if (types.length) return types;
  }
  return valid.length ? valid : ['physical'];
}
export function actionAbilities(state, action, kind) {
  const player = state.player, { inventory, loadout } = gearState(player), chosen = chooseWeapon(player, action, kind);
  const rules = talentRules(player), armor = inventory.find(row => row.key === loadout.armor), shield = inventory.find(row => row.key === loadout.shield);
  const combat = kind === 'combat', weaponAction = combat || (kind === 'study' && chosen.weapon);
  const attackTypes = combat ? incomingTypes(state, action) : [];
  const blocked = attackTypes.length > 0 && ((attackTypes.includes('magic') && rules.immunity.includes('magic')) || attackTypes.every(type => rules.immunity.includes(type)));
  const weaponBonus = weaponAction && chosen.weapon ? GRADE_BONUS[chosen.weapon.grade] : 0;
  const masteryBonus = weaponAction && chosen.weapon && rules.allWeapons ? 6 : 0;
  return { ...chosen, armor: armor || null, shield: shield || null, rules, incomingTypes: attackTypes, blocked,
    weaponBonus, masteryBonus, defenseBonus: combat && attackTypes.every(type => type === 'physical') ? Math.min(5, Math.ceil((GRADE_BONUS[armor?.grade] || 0) / 3) + (shield ? 1 : 0)) : 0 };
}
export function abilityBrief(context) {
  if (!context) return '';
  return [context.weapon ? `本次使用：${context.weapon.label}${context.temporary ? '（本回合临时替换主用武器，不增加常用栏位）' : ''}；只计算这一件武器的作用，其他武器不叠加。` : '本次没有使用武器。',
    context.armor ? `护甲：${context.armor.label}` : '', context.shield ? `盾牌：${context.shield.label}` : '',
    context.blocked ? `本次来袭的${context.incomingTypes.map(type => TYPE_CN[type]).join('、')}被免疫，不造成伤害或负面状态。行动目标的成败另按判定，不把免伤写成自动获胜。` : '',
    context.rules.allWeapons && context.weapon ? '所有武器精通已生效，不得把角色写成不会使用该武器。' : '',
  ].filter(Boolean).join('\n');
}
