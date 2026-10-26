export function textId(text) {
  let hash = 2166136261;
  for (const ch of String(text)) hash = Math.imul(hash ^ ch.codePointAt(0), 16777619);
  return (hash >>> 0).toString(36);
}

export function npcLabel(state, npc) {
  if (!state.npcs.some(other => other.id !== npc.id && other.name === npc.name)) return npc.name;
  return `${npc.name}（${npc.age}岁·${npc.profession || '居民'}${npc.location?.siteName ? '·' + npc.location.siteName : ''}）`;
}

export function entityRefs(state, text, explicit = {}) {
  const value = String(text || '');
  const ids = new Set(explicit.npcIds || []), siteIds = new Set(explicit.siteIds || []);
  for (const npc of state.npcs || []) {
    if (value.includes(npc.id) || value.includes(npcLabel(state, npc))) ids.add(npc.id);
    else if (value.includes(npc.name)) {
      const group = state.npcs.filter(n => n.name === npc.name);
      const hints = group.filter(n => value.includes(`${n.age}岁`) || (n.profession && value.includes(n.profession)));
      if (group.length === 1 || (hints.length === 1 && hints[0].id === npc.id)) ids.add(npc.id);
    }
  }
  for (const [id, place] of Object.entries(state.locations || {})) if (value.includes(id) || (place.name && value.includes(place.name))) siteIds.add(id);
  const taskIds = (state.player.unfinished || []).filter(task => task && typeof task.text === 'string' && ((task.id && value.includes(task.id)) || (task.text.length >= 6 && value.includes(task.text)))).map(task => task.id).filter(Boolean);
  return { npcIds: [...ids], siteIds: [...siteIds], taskIds: [...new Set([...(explicit.taskIds || []), ...taskIds])] };
}

export function ambiguousPeople(state, text) {
  const groups = new Map();
  for (const npc of state.npcs || []) if (String(text).includes(npc.name)) {
    if (!groups.has(npc.name)) groups.set(npc.name, []);
    groups.get(npc.name).push(npc);
  }
  for (const [name, people] of groups) if (people.length > 1) {
    const exact = people.filter(n => text.includes(n.id) || text.includes(npcLabel(state, n)));
    if (exact.length) continue;
    const hinted = people.filter(n => (n.profession && text.includes(n.profession)) || text.includes(`${n.age}岁`));
    if (hinted.length === 1) continue;
    return { name, people: people.map(n => ({ id: n.id, label: npcLabel(state, n) })) };
  }
  return null;
}
