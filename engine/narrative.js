import { gearInventory } from './equipment.js';

export class NarrativeError extends Error {}
/** Check new assertions about this turn; historical records are never rewritten. */
export function assertAbilityNarrative(plan, raw) {
  const effects = plan.judged.effects; if (!effects) return;
  const prose = String(raw || '').split(/```/)[0], violations = [];
  const immunity = effects.rules.immunity;
  const claimed = type => immunity.includes(type) || (effects.blocked && effects.incomingTypes.includes(type));
  const positive = pattern => [...prose.matchAll(new RegExp(pattern.source, 'g'))]
    .some(match => !/没有|并未|未曾|不会|不曾|毫无|并无|没能|未能/.test(match[0]));
  const injury = /你(?:的(?:手臂|胳膊|肩膀|胸口|皮肤|身体|腿|手))?(?:被|遭到|挨了)[^。\n]{0,25}(?:砍伤|刺伤|划伤|割伤|流血|击伤|打伤|受伤|划破|刺穿)|(?:刀锋|剑刃|箭矢|长矛)[^。\n]{0,12}(?:划破|刺穿|割开)了?你(?:的[^。\n]{0,8})?/;
  if (claimed('physical') && positive(injury)) violations.push('玩家免疫物理攻击，正文却写成被攻击受伤');
  const assertEffect = (type, pattern, name) => { if (claimed(type) && positive(pattern)) violations.push(`玩家免疫${name}，正文却写出了对应伤害或负面状态`); };
  assertEffect('fire', /你(?:的[^。\n]{0,6})?(?:被[^。\n]{0,12})?(?:烧伤|灼伤|烫伤)|火焰[^。\n]{0,12}(?:烧伤|灼伤)了?你/, '火');
  assertEffect('ice', /你(?:的[^。\n]{0,6})?(?:被[^。\n]{0,12})?(?:冻伤|冻僵|冻结)|寒冰[^。\n]{0,12}冻住了?你/, '冰');
  assertEffect('lightning', /你(?:被[^。\n]{0,12})?(?:电伤|电得[^。\n]{0,8}(?:麻痹|动弹不得))|雷电[^。\n]{0,12}(?:击伤|麻痹)了?你/, '电');
  assertEffect('poison', /你(?:已经|终于|还是|因此)?(?:中了毒|中毒了|毒发)|毒素[^。\n]{0,12}(?:侵入|麻痹|腐蚀)了?你/, '毒');
  assertEffect('magic', /你(?:被|中了|受到)[^。\n]{0,12}(?:诅咒|定身|精神控制|魔法控制|魔法伤害)(?:了|影响|生效|困住|束缚)|你被[^。\n]{0,8}(?:魔法|法术)[^。\n]{0,6}(?:控制|定住|麻痹|击伤)/, '不利魔法');
  if (effects.rules.allWeapons && effects.weapon && /你(?:从未|不会|不懂)[^。\n]{0,8}(?:使用|操纵|运用)(?:这|该)?(?:把|柄|张|件)?(?:武器|剑|刀|枪|弓|斧)/.test(prose)) violations.push('精通所有武器的角色被写成不会使用该武器');
  if (['combat', 'study'].includes(plan.judged.kind)) {
    const owned = gearInventory(plan.state.player);
    for (const match of prose.matchAll(/你(?:随即|立刻|当即|便|则|又)?(?:挥动|挥起|拔出|持着|握着|举起|拉开|掷出|投出|射出|用)([^。\n，,]{1,30})/g)) {
      const mentioned = owned.filter(row => row.kind === 'weapon' && match[1].includes(row.name)).sort((a, b) => b.name.length - a.name.length);
      const row = mentioned[0]; if (!row) continue;
      const relatedAmmo = /箭|弩矢/.test(row.name) && /弓|弩/.test(effects.weapon?.name || '');
      if (row.name !== effects.weapon?.name && !relatedAmmo) violations.push('正文使用的武器与玩家本次选择不一致');
    }
  }
  if (violations.length) throw new NarrativeError([...new Set(violations)].join('；'));
}
