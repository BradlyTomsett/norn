import { entityRefs, factEntityRefs, textId } from './entities.js';
import { narrationText } from '../messages.js';
import { contradictedByCorrection, cancelledActions, redactCorrectedHistory, redactCorrectedInput } from './continuity.js';

/** Local relevance retrieval: retain the source history, budget only the prompt. */
export function selectRelevant(rows, query = '', limit = 16, textOf = x => typeof x === 'string' ? x : x.text || '', context = {}) {
  const words = new Set(String(query).match(/[A-Za-z0-9_]+|[\u4e00-\u9fff]{2}/g) || []);
  for (const run of String(query).match(/[\u4e00-\u9fff]+/g) || []) for (let i = 0; i < run.length - 1; i++) words.add(run.slice(i, i + 2));
  return rows.filter(row => !row?.uncertainNpcNames?.some(name => context.ambiguousNames?.includes(name))
    && (!row?.npcIds?.some(id => context.excludeNpcIds?.includes(id)) || row.npcIds.some(id => context.npcIds?.includes(id)))
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
    ...factEntityRefs(state, value.text, value) };
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

export function recallHistory(state, messages, query, limit = 5, { before = Math.max(0, messages.length - 14), budget = 14000 } = {}) {
  const context = memoryContext(state, query);
  const guards = cancelledActions(state);
  const candidates = messages.slice(0, before).map((message, index) => {
    const raw = (message.role === 'assistant' ? narrationText(message.content) : message.content)
      .split(/【(?:你现在可以做什么|行动方向|可选行动)】/)[0].trim();
    const text = message.role === 'assistant' ? redactCorrectedHistory(raw, index, guards) : redactCorrectedInput(raw, index, guards);
    return { text, index, role: message.role, turn: message.sourceTurn, ...entityRefs(state, text, message.entities || {}), uncertainNpcNames: message.entities?.uncertainNpcNames || [] };
  }).filter(row => row.text && !contradictedByCorrection(state, row.text) && !/^(?:\/纠错|我的钱数没有增加|光支出了)/.test(row.text));
  const selected = selectRelevant(candidates, query, limit, row => row.text, context)
    .filter(row => row.npcIds.some(id => context.npcIds.includes(id)) || row.siteIds.some(id => context.siteIds.includes(id))
      || (String(query).match(/[\u4e00-\u9fff]+/g) || []).some(word => [...word].some((_, i) => i < word.length - 1 && row.text.includes(word.slice(i, i + 2)))));
  const paired = new Map();
  for (const row of selected) {
    paired.set(row.index, row);
    const other = row.role === 'assistant' ? row.index - 1 : row.index + 1;
    const partner = candidates.find(candidate => candidate.index === other && candidate.role !== row.role);
    if (partner && !partner.npcIds.some(id => context.excludeNpcIds.includes(id))) paired.set(other, partner);
  }
  const included = []; let chars = 0;
  // Preserve complete source passages. An oversized optional source is omitted, never silently cut in half.
  for (const row of [...paired.values()].sort((a, b) => b.index - a.index)) {
    const text = `[history:${row.index}] ${row.turn != null ? `第${row.turn}回合` : `原记录${row.index + 1}`} ${row.role === 'user' ? '玩家输入（不自动代表已执行）' : '历史叙述'}${row.uncertainNpcNames?.length ? `（同名人物${row.uncertainNpcNames.join('、')}身份待核对）` : ''}：${row.text}`;
    if (chars + text.length > budget) continue;
    included.unshift(text); chars += text.length;
  }
  return included.join('\n\n');
}
