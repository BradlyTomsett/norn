export function textId(text) {
  let hash = 2166136261;
  for (const ch of String(text)) hash = Math.imul(hash ^ ch.codePointAt(0), 16777619);
  return (hash >>> 0).toString(36);
}

export function npcLabel(state, npc) {
  if (!state.npcs.some(other => other.id !== npc.id && other.name === npc.name)) return npc.name;
  return `${npc.name}（${npc.age}岁·${npc.profession || '居民'}${npc.location?.siteName ? '·' + npc.location.siteName : ''}）`;
}

function identityHint(value, npc) {
  const name = npc.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const age = String(npc.age ?? '');
  if (age && new RegExp(`(?:${name}[（(，、：:\\s]{0,4}${age}\\s*岁|${age}\\s*岁(?:的)?${name})`).test(value)) return true;
  const profession = String(npc.profession || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (profession && new RegExp(`(?:${name}[（(，、：:\\s]{0,4}${profession}|${profession}(?:的)?${name})`).test(value)) return true;
  const grade = String(npc.profession || '').match(/([A-Za-z])\s*级/i)?.[1];
  if (!grade) return false;
  return new RegExp(`(?:${grade}\\s*级(?:冒险者)?[，、：:\\s的（(]{0,5}${name}|${name}[（(，、：:\\s是]{0,4}${grade}\\s*级)`, 'i').test(value);
}

export function entityRefs(state, text, explicit = {}) {
  const value = String(text || '');
  const ids = new Set(explicit.npcIds || []), siteIds = new Set(explicit.siteIds || []);
  for (const npc of state.npcs || []) {
    if (value.includes(npc.id) || value.includes(npcLabel(state, npc))) ids.add(npc.id);
    else if (value.includes(npc.name)) {
      const group = state.npcs.filter(n => n.name === npc.name);
      const hints = group.filter(n => identityHint(value, n));
      if (group.length === 1 || (hints.length === 1 && hints[0].id === npc.id)) ids.add(npc.id);
    }
  }
  for (const [id, place] of Object.entries(state.locations || {})) if (value.includes(id) || (place.name && value.includes(place.name))) siteIds.add(id);
  const taskIds = (state.player.unfinished || []).filter(task => task && typeof task.text === 'string' && ((task.id && value.includes(task.id)) || (task.text.length >= 6 && value.includes(task.text)))).map(task => task.id).filter(Boolean);
  return { npcIds: [...ids], siteIds: [...siteIds], taskIds: [...new Set([...(explicit.taskIds || []), ...taskIds])] };
}

/** Do not trust an unqualified model-supplied ID for a name shared by several people. */
export function factEntityRefs(state, text, explicit = {}) {
  const value = String(text || ''), inferred = entityRefs(state, value, { ...explicit, npcIds: [] });
  const verified = new Set(Array.isArray(explicit.identityVerifiedNpcIds) ? explicit.identityVerifiedNpcIds : []);
  const uncertain = new Set(Array.isArray(explicit.uncertainNpcNames) ? explicit.uncertainNpcNames : []);
  for (const id of explicit.npcIds || []) {
    const npc = state.npcs.find(row => row.id === id);
    if (!npc) continue;
    const group = state.npcs.filter(row => row.name === npc.name);
    if (group.length > 1 && value.includes(npc.name) && !inferred.npcIds.includes(id) && !verified.has(id)) {
      uncertain.add(npc.name); continue;
    }
    inferred.npcIds.push(id);
  }
  for (const id of verified) {
    const npc = state.npcs.find(row => row.id === id);
    if (npc && value.includes(npc.name)) { inferred.npcIds.push(id); uncertain.delete(npc.name); }
  }
  return { ...inferred, npcIds: [...new Set(inferred.npcIds)], uncertainNpcNames: [...uncertain] };
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
    const hinted = people.filter(n => identityHint(text, n));
    if (hinted.length === 1) continue;
    return { name, people: people.map(n => ({ id: n.id, label: npcLabel(state, n) })) };
  }
  return null;
}
