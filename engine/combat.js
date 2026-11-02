import { entityRefs } from './entities.js';

export const ATTACK_TYPES = ['physical', 'magic', 'ice', 'fire', 'lightning', 'poison'];
export function combatTargets(state, action) {
  const direct = [...String(action).matchAll(/(?:攻击|砍向|刺向|射向|制服|制伏|抵挡|挡住|防御|对付)\s*([^，。；]+)/g)].map(m => m[1]).join('；');
  const refs = entityRefs(state, direct || action);
  return state.npcs.filter(n => !n.dead && refs.npcIds.includes(n.id));
}
/** Profiles are explicit world facts, never inferred from a name or the player's strength. */
export function applyCombatProfile(npc, profile) {
  if (!profile || typeof profile !== 'object') return;
  const out = { ...npc.combat };
  for (const key of ['body', 'skill', 'count']) if (Number.isFinite(profile[key])) out[key] = Math.max(key === 'count' ? 1 : 0, Math.min(key === 'count' ? 100 : 1000, Math.round(profile[key])));
  if (Array.isArray(profile.attackTypes)) out.attackTypes = [...new Set(profile.attackTypes.filter(t => ATTACK_TYPES.includes(t)))];
  if (typeof profile.weapon === 'string') out.weapon = profile.weapon.slice(0, 100);
  npc.combat = out;
}
export function targetDifficulty(state, action) {
  const known = combatTargets(state, action).filter(n => n.combat?.body != null || n.stats?.body != null);
  if (!known.length) return null;
  const difficulty = known.map(n => (n.combat?.body ?? n.stats.body) * 0.8 + (n.combat?.skill ?? n.combatSkill ?? 0) * 1.5);
  const count = known.reduce((sum, n) => sum + (n.combat?.count || 1), 0);
  return Math.max(10, ...difficulty) + Math.round(Math.log2(count) * 5);
}
