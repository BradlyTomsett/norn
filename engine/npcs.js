import { absoluteDay, absoluteMinute, bounded, cleanText, list, closenessOf } from './schema.js';

const PURPOSES = [
  [/铁匠|锻|矿/, '备齐下一批原料，维持工坊开工', '联系原料商并整理订单', '原料和订单已经安排妥当'],
  [/商|店|账房|老板|中介|金匠|典押|放贷|酒馆|旅店/, '维持生意，结清眼前的账', '核对账本并拜访熟客', '眼前这一轮账目已经结清'],
  [/农|牧|磨坊|渔/, '照料生计，备好下一季的生活', '整理工具，安排接下来的活', '这一轮生计安排已经办妥'],
  [/冒险|佣兵|守卫/, '完成手里的工作，平安回到熟人身边', '准备装备并联系搭档', '这一轮工作已经告一段落'],
];
const knownHere = (s, n) => n.location?.siteId === s.player.location.siteId || n.following;

export function ensureNpcState(state) {
  for (const npc of state.npcs) {
    if (!Array.isArray(npc.goals)) {
      const purpose = PURPOSES.find(([re]) => re.test(npc.profession || ''))?.slice(1)
        || ['照料自己的生活与熟人', '安排近日的生活', '眼前的安排已经完成'];
      npc.goals = [{ id: `${npc.id}:daily`, text: purpose[0] + (npc.obsession ? `（在意：${npc.obsession}）` : ''), action: purpose[1], completion: purpose[2],
        progress: 0, status: 'active', nextDay: absoluteDay(state.clock) + 7, intervalDays: 7, visible: true }];
    }
    npc.memories ||= list(npc.memory).map(row => typeof row === 'string' ? { text: row } : row);
  }
}

function relationEffect(state, effect, cause) {
  const r = state.player.relations.find(r => r.npcId === effect.npcId);
  if (!r) return;
  r.closeness = bounded(r.closeness + closenessOf(effect), -100, 100);
  if (effect.observable) r.observable = cleanText(effect.observable);
  r.lastTouch = absoluteDay(state.clock);
  const npc = state.npcs.find(n => n.id === effect.npcId);
  if (npc) npc.memories.push({ cause, text: cleanText(effect.observable || cause), day: absoluteDay(state.clock) });
}

export function applyStoryDelta(state, delta, rejected, eventId) {
  ensureNpcState(state);
  if (delta.location) {
    const name = cleanText(typeof delta.location === 'string' ? delta.location : delta.location.siteName, 100);
    if (!name) rejected.push('地点需要名称');
    else {
      const siteId = cleanText(delta.location.siteId || name, 100);
      state.player.location = { siteId, siteName: name };
      const place = { ...(state.locations[siteId] || {}), id: siteId, name };
      for (const key of ['regionTitle', 'terrain', 'economy', 'politics', 'risk']) {
        if (delta.location[key]) place[key] = cleanText(delta.location[key], 300);
      }
      place.regionTitle ||= name;
      state.locations[siteId] = place;
      state.world = { ...place, priceIndex: place.priceIndex || state.world.priceIndex || 1 };
      state.storyLog.push({ id: `${eventId}:move`, day: absoluteDay(state.clock), text: `抵达${name}` });
    }
  }
  for (const row of list(delta.npcs)) {
    const id = cleanText(row?.id, 80), name = cleanText(row?.name, 60);
    if (!id || !name) { rejected.push('新人物需要固定 id 和姓名'); continue; }
    if (state.npcs.some(n => n.id === id)) { rejected.push(`人物 ${id} 已存在，请使用 npcUpdates`); continue; }
    state.npcs.push({ id, name, race: cleanText(row.race || 'human', 20), gender: cleanText(row.gender || '', 20),
      age: bounded(row.age ?? 25, 0, 2000), profession: cleanText(row.profession || '居民', 60),
      traits: list(row.traits).map(v => cleanText(v, 40)).slice(0, 5), obsession: cleanText(row.obsession),
      location: { ...state.player.location }, following: row.following === true, voice: {}, memories: [] });
    state.player.relations.push({ npcId: id, closeness: 0, observable: '初次相识', lastTouch: absoluteDay(state.clock) });
  }
  ensureNpcState(state);
  for (const row of list(delta.npcUpdates)) {
    const npc = state.npcs.find(n => n.id === row?.npcId);
    if (!npc) { rejected.push(`未知人物：${row?.npcId}`); continue; }
    if (row.profession) npc.profession = cleanText(row.profession, 60);
    if (row.location?.siteName) npc.location = { siteId: cleanText(row.location.siteId || row.location.siteName), siteName: cleanText(row.location.siteName) };
    if (typeof row.following === 'boolean') npc.following = row.following;
    for (const raw of list(row.goals)) {
      const id = cleanText(raw.id, 100);
      if (!id) { rejected.push('人物目标需要固定 id'); continue; }
      const old = npc.goals.find(g => g.id === id);
      if (!old && !raw.text) { rejected.push('新目标需要内容'); continue; }
      const goal = old || { id, progress: 0, status: 'active', intervalDays: 7, nextDay: absoluteDay(state.clock) + 7, visible: true };
      for (const field of ['text', 'action', 'completion']) if (raw[field]) goal[field] = cleanText(raw[field]);
      if (['active', 'completed', 'failed', 'cancelled'].includes(raw.status)) goal.status = raw.status;
      if (goal.status === 'completed') goal.progress = 100;
      if (raw.visible === false) goal.visible = false;
      if (raw.days != null) { goal.intervalDays = bounded(raw.days, 1, 365); goal.nextDay = absoluteDay(state.clock) + goal.intervalDays; }
      if (!old) npc.goals.push(goal);
    }
    if (row.memory) npc.memories.push({ cause: eventId, text: cleanText(row.memory), day: absoluteDay(state.clock) });
  }
  for (const row of list(delta.consequences)) {
    const id = cleanText(row?.id, 100), cause = cleanText(row?.cause), text = cleanText(row?.text);
    if (!id || !cause || !text) { rejected.push('后果需要 id、原因与结果'); continue; }
    if (state.consequences.some(e => e.id === id)) continue;
    const effects = row.effects || {};
    for (const r of list(effects.relations)) if (!state.npcs.some(n => n.id === r.npcId)) rejected.push(`后果引用未知人物：${r.npcId}`);
    for (const update of list(effects.npcUpdates)) {
      if (!state.npcs.some(n => n.id === update.npcId)) rejected.push(`后果引用未知人物：${update.npcId}`);
      for (const goal of list(update.goals)) if (!goal?.id) rejected.push('后果中的人物目标需要固定 id');
    }
    state.consequences.push({ id, cause, text, due: absoluteMinute(state.clock) + Math.round(bounded(row.days ?? 1, 0, 3650) * 1440),
      status: 'pending', visible: row.visible !== false,
      effects: { relations: list(effects.relations).map(r => ({ npcId: r.npcId, closeness: closenessOf(r), observable: r.observable })),
        reputation: list(effects.reputation), npcUpdates: list(effects.npcUpdates) } });
  }
  for (const r of list(delta.reputation)) {
    if (!r?.place) { rejected.push('声望变化需要地点'); continue; }
    state.player.reputation[cleanText(r.place)] = bounded((state.player.reputation[r.place] || 0) + bounded(r.change, -100, 100), -100, 100);
  }
  if (Array.isArray(delta.tasks)) {
    for (const t of delta.tasks) {
      const id = cleanText(t?.id, 100);
      if (!id) { rejected.push('事项需要固定 id'); continue; }
      const old = state.player.unfinished.find(x => x.id === id || x.text === t.text);
      if (['completed', 'cancelled'].includes(t.status)) state.player.unfinished = state.player.unfinished.filter(x => x !== old);
      else if (t.text) {
        if (old) Object.assign(old, { id, text: cleanText(t.text), status: 'active' });
        else state.player.unfinished.push({ id, text: cleanText(t.text), status: 'active', openedDay: absoluteDay(state.clock) });
      }
    }
  }
}

/** Advance persistent schedules once per date; nothing depends on the number of turns. */
export function advanceNpcs(state) {
  ensureNpcState(state);
  const events = [], day = absoluteDay(state.clock);
  for (const npc of state.npcs) {
    if (npc.dead) continue;
    for (const goal of npc.goals) {
      if (goal.status !== 'active' || day < goal.nextDay) continue;
      const steps = Math.min(Math.ceil((100 - goal.progress) / 25), 1 + Math.floor((day - goal.nextDay) / Math.max(1, goal.intervalDays)));
      goal.progress = Math.min(100, goal.progress + steps * 25);
      goal.nextDay += steps * Math.max(1, goal.intervalDays);
      if (goal.progress >= 100) goal.status = 'completed';
      const text = `${npc.name}：${goal.status === 'completed' ? goal.completion || `完成了“${goal.text}”` : goal.action || `正在推进“${goal.text}”`}`;
      npc.memories.push({ cause: goal.id, text, day });
      if (goal.visible !== false && knownHere(state, npc)) events.push({ level: 'local', text, cause: goal.id });
    }
  }
  for (const event of state.consequences) {
    if (event.status !== 'pending' || event.due > absoluteMinute(state.clock)) continue;
    event.status = 'resolved'; event.resolvedDay = day;
    for (const r of event.effects.relations) relationEffect(state, r, event.cause);
    for (const r of event.effects.reputation) if (r.place) state.player.reputation[r.place] = bounded((state.player.reputation[r.place] || 0) + bounded(r.change, -100, 100), -100, 100);
    applyStoryDelta(state, { npcUpdates: event.effects.npcUpdates || [] }, [], event.id);
    const entry = { id: event.id, day, text: event.text, cause: event.cause };
    state.storyLog.push(entry);
    events.push({ level: 'local', text: `${event.text}（起因：${event.cause}）`, cause: event.id });
  }
  return events;
}

export function relevantNpcs(state, text = '') {
  return state.npcs.filter(n => !n.dead).map((n, index) => ({ n, index, score:
    (text.includes(n.name) ? 100 : 0) + (n.following ? 60 : 0) + (n.location?.siteId === state.player.location.siteId ? 40 : 0)
    + Math.max(0, state.player.relations.find(r => r.npcId === n.id)?.closeness || 0) / 10 }))
    .sort((a, b) => b.score - a.score || a.index - b.index).slice(0, 8).map(x => x.n);
}
