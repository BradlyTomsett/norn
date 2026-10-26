import { npcLabel } from './engine/entities.js';
import { narrationText } from './messages.js';

/** Search the complete local archive; yield between batches on long games. */
export async function searchArchive(state, messages, query, { kind = 'all', limit = 50, cancelled = () => false } = {}) {
  const terms = String(query).trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return { results: [], total: 0 };
  const results = []; let total = 0;
  const add = row => {
    if (kind !== 'all' && row.kind !== kind) return;
    const haystack = `${row.title}\n${row.text}`.toLocaleLowerCase();
    if (!terms.every(term => haystack.includes(term))) return;
    total++; if (results.length < limit) results.push(row);
  };
  for (const npc of state.npcs) add({ kind: 'people', id: npc.id, title: npcLabel(state, npc), text: `${npc.age}岁 · ${npc.profession || ''} · ${npc.location?.siteName || ''}\n${(Array.isArray(npc.memory) ? npc.memory : [npc.memory || '']).map(m => typeof m === 'string' ? m : m.text || '').join('；')}` });
  for (const [id, place] of Object.entries(state.locations || {})) add({ kind: 'places', id, title: place.name || id, text: [place.regionTitle, place.terrain, place.economy].filter(Boolean).join(' · ') });
  const status = { active: '进行中', completed: '已完成', cancelled: '已取消', expired: '已过期' };
  for (const task of [...state.player.unfinished, ...state.player.taskHistory]) add({ kind: 'tasks', id: task.id, title: task.text, text: `${status[task.status] || '进行中'}${task.completionText ? ' · ' + task.completionText : ''}${task.needsReview ? ' · 旧事项待核对' : ''}` });
  for (let index = messages.length - 1; index >= 0; index--) {
    if (cancelled()) return { results: [], total: 0 };
    const message = messages[index], text = message.role === 'assistant' ? narrationText(message.content) : message.content;
    add({ kind: 'history', index, title: `第${index + 1}条 · ${message.role === 'user' ? '玩家输入' : '历史叙述'}`, text });
    if (index % 250 === 0) await new Promise(resolve => setTimeout(resolve, 0));
  }
  return { results, total };
}
