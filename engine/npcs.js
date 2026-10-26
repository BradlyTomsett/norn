import { absoluteDay, absoluteMinute, bounded, cleanText, list, closenessOf } from './schema.js';
import { applyTasks } from './tasks.js';
import { entityRefs } from './entities.js';
import { conditionMet, validCondition } from './conditions.js';

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
    for (const goal of npc.goals) {
      if (goal.id === `${npc.id}:daily`) goal.routine = true;
      goal.phase ||= goal.routine ? 'ongoing' : 'waiting';
      goal.steps ||= [{ text: goal.action || '安排下一步行动' }, { text: '落实所需条件', condition: { type: 'memory', text: goal.completion || '事情已经办妥' } }, { text: goal.completion || '核对完成结果' }];
      goal.stepIndex ??= Math.min(goal.steps.length, Math.floor((goal.progress || 0) / 100 * goal.steps.length));
    }
    const important = npc.following || npc.memories.length > 0 || state.player.relations.some(r => r.npcId === npc.id && r.closeness >= 40);
    if (important && npc.obsession && !npc.goals.some(g => !g.routine && ['active', 'blocked'].includes(g.status)) && !npc.goals.some(g => g.id === `${npc.id}:personal`)) {
      const promotion = /晋级|爬一级|换.*牌子|凑够单数/.test(npc.obsession);
      npc.goals.push({ id: `${npc.id}:personal`, text: cleanText(npc.obsession), action: promotion ? '核对晋级条件并寻找合适的职责' : '核对眼前安排，寻找可行的下一步',
        completion: promotion ? '晋级所需成果已经得到确认' : `与“${cleanText(npc.obsession, 60)}”有关的安排已经办妥`,
        source: '人物既有动机', progress: 0, phase: 'waiting', status: 'active', nextDay: absoluteDay(state.clock) + 1, intervalDays: 1, visible: true,
        steps: [{ text: promotion ? '核对晋级条件' : '安排下一步' },
          { text: promotion ? '积累能证明能力的实际成果' : '落实所需条件', condition: { type: 'memory', text: promotion ? '完成委托' : '安排已经落实' } },
          { text: promotion ? '取得晋级确认' : '核对完成结果', condition: { type: 'memory', text: promotion ? '晋级通过' : '事情已经办妥' } }], stepIndex: 0 });
    }
  }
}

function relationEffect(state, effect, cause, visible = true, eventId = '') {
  const r = state.player.relations.find(r => r.npcId === effect.npcId);
  if (!r) return;
  r.closeness = bounded(r.closeness + closenessOf(effect), -100, 100);
  if (effect.observable && visible) r.observable = cleanText(effect.observable);
  if (visible) r.lastTouch = absoluteDay(state.clock);
  const npc = state.npcs.find(n => n.id === effect.npcId);
  if (npc) npc.memories.push({ cause, eventId, text: cleanText(effect.observable || cause), day: absoluteDay(state.clock), visible });
}
function revealEvent(state, event, evidence = '') {
  event.discovered = true;
  const entry = state.storyLog.find(e => e.id === event.id); if (entry) { entry.discovered = true; if (evidence) entry.discovery = cleanText(evidence); }
  for (const npc of state.npcs) for (const memory of npc.memories) if (memory.eventId === event.id || memory.cause === event.id) memory.visible = true;
  for (const effect of event.effects.relations || []) {
    const relation = state.player.relations.find(r => r.npcId === effect.npcId);
    if (relation && effect.observable) relation.observable = cleanText(effect.observable);
  }
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
      if (raw.requires != null && !validCondition(raw.requires)) { rejected.push('人物目标的前置条件无效'); continue; }
      if (raw.requires != null) goal.requires = structuredClone(raw.requires);
      if (raw.steps != null) {
        if (!Array.isArray(raw.steps) || !raw.steps.length || raw.steps.some(s => !s.text || (s.condition && !validCondition(s.condition)))) { rejected.push('目标步骤需要内容与有效条件'); continue; }
        goal.steps = raw.steps.map(s => ({ text: cleanText(s.text), ...(s.condition ? { condition: structuredClone(s.condition) } : {}) }));
        goal.stepIndex = Math.min(goal.stepIndex || 0, goal.steps.length);
      }
      if (raw.status === 'completed' && !raw.evidence && !row.memory && !conditionMet(state, goal.completionCondition || { type: 'memory', text: goal.completion || '事情已经办妥' }, npc)) { rejected.push('人物目标完成需要本回合结果或既有事实依据'); continue; }
      if (['active', 'completed', 'failed', 'cancelled'].includes(raw.status)) goal.status = raw.status;
      if (raw.evidence) goal.evidence = cleanText(raw.evidence, 300);
      if (raw.completionCondition != null) {
        if (!validCondition(raw.completionCondition)) { rejected.push('人物目标完成条件无效'); continue; }
        goal.completionCondition = structuredClone(raw.completionCondition);
      }
      if (raw.obstacle) { goal.obstacle = cleanText(raw.obstacle); goal.phase = 'blocked'; }
      if (raw.obstacle === '') { delete goal.obstacle; goal.phase = 'waiting'; }
      if (goal.status === 'completed') goal.progress = 100;
      if (raw.visible === false) goal.visible = false;
      if (raw.days != null) { goal.intervalDays = bounded(raw.days, 1, 365); goal.nextDay = absoluteDay(state.clock) + goal.intervalDays; }
      if (!old) npc.goals.push(goal);
    }
    if (row.memory) npc.memories.push({ cause: eventId, text: cleanText(row.memory), day: absoluteDay(state.clock),
      ...(state.consequences.some(e => e.id === eventId && e.visible === false && !e.discovered) ? { visible: false } : {}) });
    if (row.interacted === true && !state.consequences.some(e => e.id === eventId)) {
      const relation = state.player.relations.find(r => r.npcId === npc.id);
      if (relation) relation.lastTouch = absoluteDay(state.clock);
    }
  }
  for (const row of list(delta.consequences)) {
    const id = cleanText(row?.id, 100), cause = cleanText(row?.cause), text = cleanText(row?.text);
    const existing = state.consequences.find(e => e.id === id);
    if (existing) {
      if (row.status === 'cancelled' && existing.status === 'pending' && row.evidence) { existing.status = 'cancelled'; existing.cancelEvidence = cleanText(row.evidence); }
      if (row.discovered === true && existing.status === 'resolved' && row.evidence) {
        revealEvent(state, existing, row.evidence);
      }
      continue;
    }
    if (!id || !cause || !text) { rejected.push('后果需要 id、原因与结果'); continue; }
    for (const key of ['when', 'cancelWhen', 'discoverWhen']) if (row[key] && !validCondition(row[key])) rejected.push(`后果的${key}条件无效`);
    const effects = row.effects || {};
    for (const r of list(effects.relations)) if (!state.npcs.some(n => n.id === r.npcId)) rejected.push(`后果引用未知人物：${r.npcId}`);
    for (const update of list(effects.npcUpdates)) {
      if (!state.npcs.some(n => n.id === update.npcId)) rejected.push(`后果引用未知人物：${update.npcId}`);
      for (const goal of list(update.goals)) {
        if (!goal?.id) rejected.push('后果中的人物目标需要固定 id');
        for (const key of ['requires', 'completionCondition']) if (goal[key] && !validCondition(goal[key])) rejected.push('后果中的目标条件无效');
        if (goal.steps && (!Array.isArray(goal.steps) || !goal.steps.length || goal.steps.some(s => !s.text || (s.condition && !validCondition(s.condition))))) rejected.push('后果中的目标步骤无效');
      }
    }
    state.consequences.push({ id, cause, text, due: absoluteMinute(state.clock) + Math.round(bounded(row.days ?? 1, 0, 3650) * 1440),
      status: 'pending', visible: row.visible !== false, discovered: row.visible !== false,
      ...(row.when ? { when: structuredClone(row.when) } : {}), ...(row.cancelWhen ? { cancelWhen: structuredClone(row.cancelWhen) } : {}),
      ...(row.discoverWhen ? { discoverWhen: structuredClone(row.discoverWhen) } : {}),
      effects: { relations: list(effects.relations).map(r => ({ npcId: r.npcId, closeness: closenessOf(r), observable: r.observable })),
        reputation: list(effects.reputation), npcUpdates: list(effects.npcUpdates) } });
  }
  for (const r of list(delta.reputation)) {
    if (!r?.place) { rejected.push('声望变化需要地点'); continue; }
    state.player.reputation[cleanText(r.place)] = bounded((state.player.reputation[r.place] || 0) + bounded(r.change, -100, 100), -100, 100);
  }
  if (Array.isArray(delta.tasks)) applyTasks(state, delta.tasks, rejected, eventId);
}

/** Advance persistent schedules once per date; nothing depends on the number of turns. */
export function advanceNpcs(state) {
  ensureNpcState(state);
  const events = [], day = absoluteDay(state.clock);
  for (const npc of state.npcs) {
    if (npc.dead) continue;
    for (const goal of npc.goals) {
      if (goal.status !== 'active' || day < goal.nextDay) continue;
      goal.nextDay = day + Math.max(1, goal.intervalDays);
      if (goal.routine) continue;
      const step = goal.steps[goal.stepIndex || 0];
      if (!conditionMet(state, goal.requires, npc) || (step?.condition && !conditionMet(state, step.condition, npc)) || goal.obstacle) {
        goal.phase = 'blocked'; goal.blockedOn = goal.obstacle || step?.text || '等待前置条件'; continue;
      }
      if (step) goal.stepIndex = (goal.stepIndex || 0) + 1;
      goal.progress = Math.min(95, Math.round(goal.stepIndex / goal.steps.length * 100));
      goal.phase = 'acting'; delete goal.blockedOn;
      if (goal.stepIndex >= goal.steps.length) {
        const proven = goal.evidence || (goal.completionCondition && conditionMet(state, goal.completionCondition, npc))
          || goal.steps.some(s => s.condition && conditionMet(state, s.condition, npc));
        if (proven) { goal.status = 'completed'; goal.progress = 100; goal.phase = 'completed'; }
        else { goal.phase = 'blocked'; goal.blockedOn = '等待完成结果的实际依据'; }
      }
      const text = `${npc.name}：${goal.status === 'completed' ? goal.completion || `完成了“${goal.text}”` : step?.text || goal.action}`;
      npc.memories.push({ cause: goal.id, text, day, visible: goal.visible !== false && Boolean(knownHere(state, npc)) });
      if (goal.visible !== false && knownHere(state, npc)) events.push({ level: 'local', text, cause: goal.id });
    }
  }
  for (const event of state.consequences) {
    if (event.cancelWhen && event.status === 'pending' && conditionMet(state, event.cancelWhen)) { event.status = 'cancelled'; event.cancelEvidence = '既定补救条件已达成'; continue; }
    if (event.status === 'resolved' && !event.discovered && event.discoverWhen && conditionMet(state, event.discoverWhen)) {
      revealEvent(state, event, '发现条件已由既有事实达成');
      events.push({ level: 'local', text: event.text, cause: event.id });
    }
    if (event.status !== 'pending' || event.due > absoluteMinute(state.clock)) continue;
    if (event.when && !conditionMet(state, event.when)) continue;
    event.status = 'resolved'; event.resolvedDay = day;
    for (const r of event.effects.relations) relationEffect(state, r, event.cause, event.visible !== false, event.id);
    for (const r of event.effects.reputation) if (r.place) state.player.reputation[r.place] = bounded((state.player.reputation[r.place] || 0) + bounded(r.change, -100, 100), -100, 100);
    applyStoryDelta(state, { npcUpdates: (event.effects.npcUpdates || []).map(update => ({ ...update,
      goals: list(update.goals).map(g => g.status === 'completed' ? { ...g, evidence: g.evidence || event.text } : g) })) }, [], event.id);
    const entry = { id: event.id, day, text: event.text, cause: event.cause, visible: event.visible, discovered: event.visible !== false };
    state.storyLog.push(entry);
    event.discovered = entry.discovered;
    if (entry.discovered) events.push({ level: 'local', text: `${event.text}（起因：${event.cause}）`, cause: event.id });
  }
  return events;
}

export function relevantNpcs(state, text = '') {
  const refs = entityRefs(state, text);
  return state.npcs.filter(n => !n.dead).map((n, index) => ({ n, index, score:
    (refs.npcIds.includes(n.id) ? 200 : text.includes(n.name) ? 100 : 0) + (n.following ? 60 : 0) + (n.location?.siteId === state.player.location.siteId ? 40 : 0)
    + Math.max(0, state.player.relations.find(r => r.npcId === n.id)?.closeness || 0) / 10 }))
    .sort((a, b) => b.score - a.score || a.index - b.index).slice(0, 8).map(x => x.n);
}
