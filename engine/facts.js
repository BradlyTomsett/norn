import { textId } from './entities.js';

const key = text => String(text || '').replace(/[\s，。；、：：“”「」]/g, '');
export function ensureFacts(state) {
  const p = state.player;
  p.goalHistory ||= []; p.principles ||= [];
  for (const task of p.taskHistory || []) {
    if (task.status !== 'archived' || !/保密|秘密|原则|不动刀|撞上人就抓住/.test(task.text)) continue;
    const id = `principle:${task.id}`;
    if (!p.principles.some(n => n.id === id)) p.principles.push({ id, text: task.text, source: task.id,
      ...(p.contracts.find(c => task.text.startsWith(c.label.slice(0, 2))) ? { contractId: p.contracts.find(c => task.text.startsWith(c.label.slice(0, 2))).id } : {}) });
  }
}
export function archiveGoal(state, text, evidence, eventId = '') {
  ensureFacts(state);
  state.player.goals = state.player.goals.filter(g => g !== text);
  if (!state.player.goals.length) state.player.goalReviewPending = false;
  if (!state.player.goalHistory.some(g => g.text === text && g.status === 'completed')) state.player.goalHistory.push({ id: `goal:${textId(text)}`, text,
    status: 'completed', evidence, sourceEvent: eventId, closedTurn: state.turn });
}
export function reconcileGoals(state) {
  ensureFacts(state);
  for (const goal of [...state.player.goals]) {
    const finished = state.player.taskHistory.find(task => task.status === 'completed' && key(task.text) === key(goal));
    if (finished) archiveGoal(state, goal, finished.evidence || { taskId: finished.id }, 'engine:current-facts');
  }
}
export const knownStory = (state, row) => row.discovered !== false && row.visible !== false
  || row.discovered === true || (row.discovered == null && row.visible == null && !state.consequences.some(e => e.id === row.id && e.visible === false && !e.discovered));
export function activePrinciples(state) {
  ensureFacts(state);
  return state.player.principles.filter(p => !p.contractId || state.player.contracts.some(c => c.id === p.contractId && c.status === 'active'));
}
