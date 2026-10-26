import { entityRefs, textId } from './entities.js';
import { narrationText } from '../messages.js';

/** Local relevance retrieval: retain the source history, budget only the prompt. */
export function selectRelevant(rows, query = '', limit = 16, textOf = x => typeof x === 'string' ? x : x.text || '', context = {}) {
  const words = new Set(String(query).match(/[A-Za-z0-9_]+|[\u4e00-\u9fff]{2}/g) || []);
  for (const run of String(query).match(/[\u4e00-\u9fff]+/g) || []) for (let i = 0; i < run.length - 1; i++) words.add(run.slice(i, i + 2));
  return rows.filter(row => (!row?.npcIds?.some(id => context.excludeNpcIds?.includes(id)) || row.npcIds.some(id => context.npcIds?.includes(id)))
    && !(!row?.npcIds?.length && context.ambiguousNames?.some(name => textOf(row).includes(name)))).map((row, index) => {
    const text = textOf(row);
    let score = row?.permanent ? 100 : 0;
    for (const word of words) if (text.includes(word)) score += 10;
    for (const key of ['npcIds', 'siteIds', 'taskIds']) if (row?.[key]?.some(id => context[key]?.includes(id))) score += key === 'npcIds' ? 200 : 120;
    return { row, index, score: score + (rows.length ? index / rows.length : 0) };
  }).sort((a, b) => b.score - a.score).slice(0, limit).sort((a, b) => a.index - b.index).map(x => x.row);
}

export function linkKnowledge(state, row, eventId = '') {
  const value = typeof row === 'string' ? { text: row } : row;
  return { ...value, id: value.id || `fact:${textId(`${value.text}|${value.source || ''}|${value.day || ''}`)}`,
    sourceTurn: value.sourceTurn ?? (eventId ? (state.turn || 0) + 1 : null), sourceEvent: value.sourceEvent || eventId,
    ...entityRefs(state, value.text, value) };
}

export function memoryContext(state, query) {
  const context = entityRefs(state, query);
  const names = state.npcs.filter(n => context.npcIds.includes(n.id)).map(n => n.name);
  context.excludeNpcIds = state.npcs.filter(n => names.includes(n.name) && !context.npcIds.includes(n.id)).map(n => n.id);
  context.ambiguousNames = state.npcs.filter(n => context.excludeNpcIds.includes(n.id)).map(n => n.name);
  if (!context.npcIds.length) context.npcIds = state.npcs.filter(n => n.following).map(n => n.id);
  if (!context.siteIds.length && state.player.location?.siteId) context.siteIds = [state.player.location.siteId];
  return context;
}

export function recallHistory(state, messages, query, limit = 5) {
  const context = memoryContext(state, query);
  const candidates = messages.slice(0, -14).map((message, index) => {
    const text = (message.role === 'assistant' ? narrationText(message.content) : message.content)
      .split(/【(?:你现在可以做什么|行动方向|可选行动)】/)[0].trim();
    return { text, index, role: message.role, turn: message.sourceTurn, ...entityRefs(state, text, message.entities || {}) };
  }).filter(row => row.text && !/^(?:\/纠错|我的钱数没有增加|光支出了)/.test(row.text));
  const selected = selectRelevant(candidates, query, limit, row => row.text, context)
    .filter(row => row.npcIds.some(id => context.npcIds.includes(id)) || row.siteIds.some(id => context.siteIds.includes(id))
      || (String(query).match(/[\u4e00-\u9fff]+/g) || []).some(word => [...word].some((_, i) => i < word.length - 1 && row.text.includes(word.slice(i, i + 2)))));
  return selected.map(row => `第${row.turn ?? row.index + 1}条${row.role === 'user' ? '玩家输入' : '历史叙述'}：${row.text.slice(0, 1100)}`).join('\n\n');
}
