import { entityRefs, textId } from './entities.js';

export function incidentalTask(task) {
  const text = String(task.text || '').trim();
  if (task.kind === 'note' || task.category === 'note' || /天赋.{0,8}(?:保密|秘密)|严格保密|(?:这单|这趟|本次|这次).{0,8}不动刀|撞上人就抓住/.test(task.text || '')) return 'note';
  if (task.kind === 'routine' || task.category === 'routine' || /^(?:先|去|回去|回房|现在)?(?:吃饭|喝水|喝酒|吃早饭|洗漱|洗脸|睡觉|休息一下|回房休息|问候|打招呼)(?:[，,。！!].*)?$/.test(task.text || '')) return 'routine';
  if (['substep', 'detail'].includes(task.kind) || ['substep', 'detail'].includes(task.category) || task.importance === 'minor') return 'substep';
  // Actual delivery, rescue, debt, and contractual obligations remain important even if they mention a meeting.
  const obligation = task.contractId || task.completionCondition?.type === 'contractPaid'
    || /交付|交货|归还|偿还|还债|欠款|报酬|救出|救援|护送|谈判|审判|婚礼|委托|任务/.test(text);
  if (obligation) return null;
  if (/碰头|会合|集合|见个面|见一面/.test(text)
    || /^(?:(?:明天|明早|明晚|稍后|待会儿?|下次|今天|今晚)(?:再)?)?(?:去)?(?:问|询问|找.{1,12}问|打听)/.test(text)
    || /^(?:去|到|前往).*(?:摸底|踩点|看一眼|看看|打听一下)/.test(text)
    || /(?:守夜时|值班时|盯|观察|留意).*(?:小窗|灯何时|谁进出|谁进去|拴在哪)/.test(text)
    || /^(?:定下|安排|商定|确定|敲定|排好).*(?:班次|排班|轮班|站位|怎么站|谁喊|谁堵门)/.test(text)) return 'substep';
  return null;
}

const day = state => state.clock.year * 365 + state.clock.doy - 1;
const textKey = text => String(text || '').trim().replace(/^(?:前往|去|到)/, '').replace(/[\s，,。；;、：:！？!?·]/g, '');
const sameTask = (a, b) => {
  if (a.id && (a.id === b.id || b.aliases?.includes(a.id))) return true;
  if (a.dueDay != null && b.dueDay != null && a.dueDay !== b.dueDay) return false;
  if (a.siteId && b.siteId && a.siteId !== b.siteId) return false;
  const x = textKey(a.text), y = textKey(b.text);
  return Boolean(x && y && (x === y || (Math.min(x.length, y.length) >= 14 && (x.includes(y) || y.includes(x)))));
};

export function upgradeTasks(state) {
  const p = state.player;
  p.taskHistory = Array.isArray(p.taskHistory) ? p.taskHistory : [];
  const active = [];
  for (const raw of p.unfinished || []) {
    const row = typeof raw === 'string' ? { text: raw } : raw;
    if (!row?.text) continue;
    const task = { ...row, id: row.id || `task:${textId(textKey(row.text))}`, status: 'active',
      sourceTurn: row.sourceTurn ?? state.turn ?? 0, needsReview: row.needsReview ?? !row.id,
      ...entityRefs(state, row.text, row), aliases: [...new Set(row.aliases || [])] };
    const old = active.find(other => sameTask(task, other));
    if (!old) active.push(task);
    else {
      old.aliases = [...new Set([...old.aliases, task.id, ...task.aliases])].filter(id => id !== old.id);
      if (task.text.length > old.text.length) old.text = task.text;
      old.npcIds = [...new Set([...old.npcIds, ...task.npcIds])];
    }
  }
  p.unfinished = active;
  for (const task of [...active]) {
    const kind = incidentalTask(task);
    if (kind) closeTask(state, task, 'archived', 'engine:task-scope', { archivedKind: kind,
      reason: kind === 'note' ? '持续说明，移出事项清单' : '日常小事或任务小步骤，仅收起，不表示已完成或取消' });
  }
  return p.unfinished;
}

export function closeTask(state, task, status, eventId, extra = {}) {
  state.player.unfinished = state.player.unfinished.filter(row => row.id !== task.id);
  const previous = state.player.taskHistory.find(row => row.id === task.id);
  const closed = { ...task, status, closedDay: day(state), closedTurn: state.turn, closedBy: eventId, needsReview: false, ...extra };
  if (previous) Object.assign(previous, closed); else state.player.taskHistory.push(closed);
}

export function applyTasks(state, changes, rejected = [], eventId = '') {
  upgradeTasks(state);
  for (const row of changes || []) {
    if (!row?.id) { rejected.push('事项需要固定 id'); continue; }
    const task = state.player.unfinished.find(old => sameTask(row, old));
    const closed = state.player.taskHistory.find(old => sameTask(row, old));
    if (['completed', 'cancelled', 'expired'].includes(row.status)) {
      if (task) closeTask(state, task, row.status, eventId);
      else if (!closed) rejected.push(`找不到事项：${row.id}`);
      continue;
    }
    if (row.status === 'active' && closed && !incidentalTask(closed) && !row.text && eventId.startsWith('player:')) {
      state.player.taskHistory = state.player.taskHistory.filter(old => old !== closed);
      state.player.unfinished.push({ ...closed, status: 'active', dueDay: undefined, closedDay: undefined });
      continue;
    }
    if (closed) continue;
    if (!row.text) { if (!task) rejected.push('新事项需要内容'); continue; }
    const next = { ...task, ...row, id: task?.id || String(row.id), text: String(row.text).trim().slice(0, 500), status: 'active',
      openedDay: task?.openedDay ?? day(state), sourceTurn: task?.sourceTurn ?? state.turn,
      sourceEvent: task?.sourceEvent || eventId, needsReview: false, ...entityRefs(state, row.text, row) };
    if (row.dueDays != null) {
      if (!Number.isFinite(Number(row.dueDays)) || Number(row.dueDays) < 0) { rejected.push('事项期限无效'); continue; }
      next.dueDay = day(state) + Math.round(Number(row.dueDays));
    }
    if (row.dueDay != null && !Number.isSafeInteger(row.dueDay)) { rejected.push('事项截止日期无效'); continue; }
    if (task) Object.assign(task, next); else state.player.unfinished.push(next);
  }
  upgradeTasks(state);
}

export function advanceTasks(state) {
  upgradeTasks(state);
  for (const task of [...state.player.unfinished]) {
    const condition = task.completionCondition;
    const completed = condition?.type === 'contractPaid' && state.player.contracts?.some(c => c.id === condition.contractId && c.status === 'paid')
      || condition?.type === 'arrival' && condition.siteId === state.player.location.siteId;
    if (completed) closeTask(state, task, 'completed', 'engine:condition');
    else if (Number.isSafeInteger(task.dueDay) && day(state) > task.dueDay) closeTask(state, task, 'expired', 'engine:deadline');
  }
}
