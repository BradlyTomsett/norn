import { splitDelta } from '../format.js';
import { finishTurn } from './turn.js';

const rows = value => value == null ? [] : Array.isArray(value) ? value : [value];

/** Only an unambiguous existing identity may be converted from create to update. */
export function normalizeNpcDelta(delta, state) {
  if (!delta || typeof delta !== 'object' || Array.isArray(delta)) return delta;
  const out = structuredClone(delta), created = [], updates = [];
  for (const row of rows(out.npcs)) {
    const old = state.npcs.find(npc => npc.id === row?.id);
    if (!old) { created.push(row); continue; }
    const same = String(row.name || '').trim() === old.name
      && ['race', 'gender', 'age'].every(key => row[key] == null || String(row[key]) === String(old[key]));
    if (!same) throw new Error(`人物 ${row.id} 的编号与身份不一致，请核对现有人物，不要另建或覆盖。`);
    const update = { npcId: old.id };
    for (const key of ['profession', 'location', 'following', 'goals', 'memory']) if (row[key] != null) update[key] = row[key];
    if (Object.keys(update).length > 1) updates.push(update);
  }
  if ('npcs' in out) out.npcs = created;
  if (updates.length) out.npcUpdates = [...updates, ...rows(out.npcUpdates)];
  return out;
}

function financeSignature(delta) {
  const financial = ['transactions', 'money', 'trade', 'bounty', 'earn', 'gift', 'payDebt', 'borrow'];
  const stable = (value, path = '') => {
    if (Array.isArray(value)) return value.map(row => stable(row, path + '[]'));
    if (typeof value === 'string' && /\.(?:copper|amount|qty|gold|silver|rate|months|cash|home|workshop)$/.test(path)
      && /^-?\d+(?:\.\d+)?$/.test(value)) return Number(value);
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(Object.keys(value).filter(key => !(path === '.transactions[]' && key === 'id')).sort().map(key => [key, stable(value[key], path + '.' + key)]));
  };
  return JSON.stringify(stable(Object.fromEntries(financial.filter(key => delta?.[key] != null).map(key => [key, delta[key]]))));
}

/** Validation may request one data-only repair; neither attempt mutates the plan. */
export async function settleReply(plan, raw, { repair } = {}) {
  const original = splitDelta(raw).delta;
  try {
    if (!original) throw new Error('回复缺少有效变化块');
    return { ...finishTurn(plan, normalizeNpcDelta(original, plan.state)), repaired: false };
  } catch (error) {
    if (!repair) throw error;
    const repaired = await repair(raw, plan, error.message);
    if (original && financeSignature(original) !== financeSignature(repaired)) throw new Error('回复修复改变了原有交易，请重试本回合，原进度已保留。');
    return { ...finishTurn(plan, normalizeNpcDelta(repaired, plan.state)), repaired: true };
  }
}
