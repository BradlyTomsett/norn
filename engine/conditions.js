/** Conditions inspect settled facts only; they never execute an action. */
export function conditionMet(state, condition, npc = null) {
  if (!condition) return true;
  if (Array.isArray(condition)) return condition.every(row => conditionMet(state, row, npc));
  switch (condition.type) {
    case 'all': return (condition.conditions || []).every(row => conditionMet(state, row, npc));
    case 'any': return (condition.conditions || []).some(row => conditionMet(state, row, npc));
    case 'not': return !conditionMet(state, condition.condition, npc);
    case 'taskStatus': return [...state.player.unfinished, ...state.player.taskHistory].some(t => (t.id === condition.id || t.aliases?.includes(condition.id)) && t.status === condition.status);
    case 'contractStatus': return state.player.contracts.some(c => c.id === condition.id && c.status === condition.status);
    case 'goalStatus': return state.npcs.find(n => n.id === (condition.npcId || npc?.id))?.goals?.some(g => g.id === condition.id && g.status === condition.status) || false;
    case 'npcAlive': return Boolean(state.npcs.find(n => n.id === condition.npcId && !n.dead));
    case 'npcAt': return state.npcs.find(n => n.id === (condition.npcId || npc?.id))?.location?.siteId === condition.siteId;
    case 'playerAt': return state.player.location.siteId === condition.siteId;
    case 'knowledge': return state.knowledge.some(k => !['unverified', 'superseded', 'disputed', 'retracted'].includes(k.status)
      && (condition.id ? k.id === condition.id : condition.text && k.text.includes(condition.text)));
    case 'memory': return Boolean(npc && condition.text && npc.memories.some(m => m.text.includes(condition.text)));
    case 'item': return (state.player.bag || []).some(i => i.name === condition.name && i.qty >= (condition.qty || 1));
    case 'flag': return Object.hasOwn(state.flags, condition.key) && state.flags[condition.key] === condition.value;
    default: return false;
  }
}
export function validCondition(value) {
  if (Array.isArray(value)) return value.length > 0 && value.every(validCondition);
  if (!value || typeof value !== 'object') return false;
  if (['all', 'any'].includes(value.type)) return Array.isArray(value.conditions) && value.conditions.length > 0 && value.conditions.every(validCondition);
  if (value.type === 'not') return validCondition(value.condition);
  const fields = { taskStatus: ['id', 'status'], contractStatus: ['id', 'status'], goalStatus: ['id', 'status'], npcAlive: ['npcId'], npcAt: ['siteId'], playerAt: ['siteId'], item: ['name'], flag: ['key'] };
  if (value.type === 'knowledge') return Boolean(value.id || value.text);
  if (value.type === 'memory') return typeof value.text === 'string' && Boolean(value.text.trim());
  return Boolean(fields[value.type]?.every(key => typeof value[key] === 'string' && value[key]));
}
