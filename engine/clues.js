import { contradictedByCorrection } from './continuity.js';
import { knownStory } from './facts.js';

const CLUE_DAYS = 3;
const CLUE_TURNS = 12;
const retired = new Set(['superseded', 'disputed', 'retracted', 'resolved', 'expired']);
const durable = new Set(['agreement', 'party', 'relationship', 'decision']);
const rows = value => Array.isArray(value) ? value : [];
const nowDay = state => state.clock.year * 365 + state.clock.doy - 1;

// Preserve quantities and times: punctuation separating digits can carry meaning.
function wording(text) {
  return String(text || '').normalize('NFKC').trim()
    .replace(/^(?:(?:补充|新增|最新|再次确认|已确认|已知|线索|调查线索)(?:线索)?\s*[:：]\s*)+/, '')
    .replace(/(\d)[,，](?=\d{3}(?:\D|$))/g, '$1')
    .replace(/[\s。；、！？!?;“”「」]+|(?<!\d)[,.:]|[,.:](?!\d)/gu, '')
    .replace(/两(?=[把个人条名枚扇处])|二(?=[把个人条名枚扇处])/g, '2');
}

function duplicateKey(row) {
  return JSON.stringify([wording(row.text), row.kind === 'clue' ? '' : row.kind || '', row.status || '', Boolean(row.permanent), row.visible !== false,
    Boolean(/传闻|听说|猜测|推测|推断|怀疑|据说/.test(row.source || '')),
    ...['npcIds', 'siteIds', 'taskIds', 'uncertainNpcNames'].map(field => [...rows(row[field])].sort()),
    row.preparation?.target, row.preparation?.expiresDay, [...rows(row.preparation?.kinds)].sort()]);
}

function canMerge(first, second) {
  return (!first.key || !second.key || first.key === second.key) && duplicateKey(first) === duplicateKey(second);
}

function mergeDuplicate(first, row) {
  first.id ||= row.id;
  first.key ||= row.key;
  first.kind ||= row.kind;
  for (const field of ['aliases', 'knownBy', 'identityVerifiedNpcIds']) {
    const values = [...rows(first[field]), ...rows(row[field]), ...(field === 'aliases' && row.id && row.id !== first.id ? [row.id] : [])];
    if (values.length) first[field] = [...new Set(values)];
  }
  const evidence = [...rows(first.knownByEvidence), ...rows(row.knownByEvidence)];
  if (evidence.length) first.knownByEvidence = [...new Map(evidence.map(item => [
    JSON.stringify([item.npcId, item.quote, item.sourceTurn]), item,
  ])).values()];
}

/** Existing saves may contain the same fact more than once. Keep the first observation and all known witnesses. */
export function compactKnowledge(state) {
  const groups = new Map(), kept = [];
  for (const value of state.knowledge) {
    const row = typeof value === 'string' ? { text: value } : value;
    if (typeof row?.text !== 'string' || !row.text.trim()) continue;
    const key = duplicateKey(row);
    const group = groups.get(key) || [];
    const first = group.find(other => !row.key || !other.key || row.key === other.key);
    if (first) mergeDuplicate(first, row);
    else { kept.push(row); group.push(row); groups.set(key, group); }
  }
  state.knowledge = kept;
}

export function mergeRepeatedKnowledge(state, row) {
  const first = state.knowledge.find(other => canMerge(other, row));
  if (!first) return false;
  mergeDuplicate(first, row);
  return true;
}

function taskState(state, ids) {
  const matches = row => ids.some(id => id === row.id || rows(row.aliases).includes(id));
  const openContract = row => row.status === 'active' && row.workStatus !== 'completed';
  if (state.player.unfinished.some(matches) || state.player.contracts.some(row => matches(row) && openContract(row))) return 'active';
  const closed = state.player.taskHistory.filter(row => matches(row) && row.status !== 'archived');
  closed.push(...state.player.contracts.filter(row => matches(row) && !openContract(row)));
  return ids.every(id => closed.some(row => id === row.id || rows(row.aliases).includes(id))) ? 'closed' : 'unknown';
}

function observedDay(state, row) {
  if (Number.isSafeInteger(row.observedDay)) return row.observedDay;
  if (row.day > 365) return row.day;
  const doy = row.day ?? row.doy;
  if (!Number.isSafeInteger(doy) || doy < 1 || doy > 365) return null;
  const year = row.year ?? state.clock.year - (doy > state.clock.doy ? 1 : 0);
  return year * 365 + doy - 1;
}

function recent(state, row) {
  const turn = row.sourceTurn ?? row.turn;
  const day = observedDay(state, row);
  if (day == null && !Number.isSafeInteger(turn)) return (state.turn || 0) < CLUE_TURNS;
  return (day == null || nowDay(state) - day < CLUE_DAYS)
    && (!Number.isSafeInteger(turn) || (state.turn || 0) - turn < CLUE_TURNS);
}

export function currentClue(state, row) {
  if (row.visible === false || retired.has(row.status) || contradictedByCorrection(state, row)) return false;
  const tasks = rows(row.taskIds);
  const link = tasks.length ? taskState(state, tasks) : 'unknown';
  if (link === 'closed') return false;
  if (row.preparation?.expiresDay != null && row.preparation.expiresDay <= nowDay(state)) return false;
  if (row.status !== 'unverified' && (row.permanent || durable.has(row.kind))) return false;
  return link === 'active' || recent(state, row);
}

/** Older lead records remain recoverable as evidence, but are no longer sent as current leads. */
export function currentPromptFact(state, row) {
  return row.kind !== 'clue' || currentClue(state, row);
}

export function clueRows(state) {
  const facts = state.knowledge.filter(row => currentClue(state, row));
  const events = state.storyLog.filter(row => row.cause && knownStory(state, row) && recent(state, row));
  const seen = new Set();
  const unique = values => [...values].reverse().filter(row => {
    const scope = ['npcIds', 'siteIds', 'taskIds'].map(field => [...rows(row[field])].sort().join(',')).join('|');
    const text = wording(row.text);
    const textKey = 'text:' + text + '|' + scope;
    const topicKey = row.key && 'topic:' + row.key + '|' + scope;
    if (!text || seen.has(textKey) || topicKey && seen.has(topicKey)) return false;
    seen.add(textKey);
    if (topicKey) seen.add(topicKey);
    return true;
  }).slice(0, 12);
  // Keep the established version when the only competing update is still unverified.
  const confirmed = facts.filter(row => row.status !== 'unverified');
  const pending = facts.filter(row => row.status === 'unverified' && !confirmed.some(other => row.key && row.key === other.key));
  const knowledge = unique([...pending, ...confirmed].sort((a, b) => (a.sourceTurn ?? 0) - (b.sourceTurn ?? 0)));
  const alreadyShown = new Set(knowledge.map(row => wording(row.text)));
  const storyLog = unique(events.filter(row => !alreadyShown.has(wording(row.text)))).slice(0, 3);
  return { knowledge, storyLog };
}
