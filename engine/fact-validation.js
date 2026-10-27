import { entityRefs } from './entities.js';
import { narrationText } from '../messages.js';
import { cancelledActions, redactCorrectedHistory, redactCorrectedInput } from './continuity.js';

const rows = value => Array.isArray(value) ? value : [];
const bigrams = text => {
  const s = String(text || '').replace(/[\s，。；、：:“”「」！？!?]/g, '');
  return new Set([...s].slice(0, -1).map((_, i) => s.slice(i, i + 2)));
};
const overlap = (a, b) => { const left = bigrams(a); return [...bigrams(b)].filter(word => left.has(word)).length; };
const quoted = (quote, sources) => typeof quote === 'string' && quote.trim().length >= 5 && sources.some(text => text.includes(quote.trim()));
function positiveQuote(quote, sources, { rejectQuestion = false } = {}) {
  if (!quoted(quote, sources)) return false;
  for (const source of sources) {
    const at = source.indexOf(quote.trim()); if (at < 0) continue;
    const start = Math.max(source.lastIndexOf('。', at), source.lastIndexOf('！', at), source.lastIndexOf('？', at), source.lastIndexOf('\n', at)) + 1;
    const before = source.slice(start, at), rest = source.slice(at), end = rest.search(/[。！\n]/);
    const sentence = before + (end < 0 ? rest : rest.slice(0, end));
    if (/(?:没有|没|并未|尚未|未曾|不曾|不会|不要|拒绝|不|未|如果|打算|计划|以前|过去|上次|曾经|当时).{0,4}$/.test(before)) return false;
    if (rejectQuestion && /[？?]|(?:是否|能否|会不会|有没有|是不是|吗\s*$)/.test(sentence)) return false;
    return true;
  }
  return false;
}

/** Preserve old agreements unless the new version has a current-turn source and the same subject. */
export function validateFactChanges(plan, delta, raw) {
  const result = structuredClone(delta), currentSources = [...(plan.corrections?.length ? plan.corrections : [plan.input || '', plan.text || '']), narrationText(raw)];
  const guards = cancelledActions(plan.state);
  const allSources = [...currentSources, ...(plan.history || []).map((message, index) => message.role === 'assistant'
    ? redactCorrectedHistory(narrationText(message.content || ''), index, guards) : redactCorrectedInput(message.content || '', index, guards))];
  for (const field of ['knowledge', 'newInfo']) {
    if (!Array.isArray(result[field])) continue;
    result[field] = result[field].map(row => {
      if (!row || typeof row !== 'object' || Array.isArray(row)) return row;
      const fact = { ...row }; delete fact.identityVerifiedNpcIds; delete fact.knownBy; delete fact.uncertainNpcNames;
      const checked = [];
      for (const evidence of rows(fact.identityEvidence)) {
        if (typeof evidence?.npcId !== 'string' || !quoted(evidence.quote, allSources)) continue;
        if (entityRefs(plan.state, evidence.quote).npcIds.includes(evidence.npcId)) checked.push(evidence.npcId);
      }
      if (checked.length) fact.identityVerifiedNpcIds = [...new Set(checked)];
      const knowledgeEvidence = [];
      for (const evidence of rows(fact.knownByEvidence)) {
        const quote = evidence?.quote, npc = plan.state.npcs.find(row => row.id === evidence?.npcId);
        if (!npc || !positiveQuote(quote, currentSources, { rejectQuestion: true }) || quote.length > 500 || !entityRefs(plan.state, quote).npcIds.includes(npc.id)) continue;
        if (!/告诉|告知|说|讲|交代|解释|说明|听见|听到|答复|回答/.test(quote)
          || /没有告诉|没告诉|未告诉|不告诉|没有听到|没听到|不知道|隐瞒/.test(quote)) continue;
        const terms = bigrams(fact.text).size;
        if (!terms || overlap(quote, fact.text) / terms < 0.4) continue;
        knowledgeEvidence.push({ npcId: npc.id, quote, sourceTurn: (plan.state.turn || 0) + 1 });
      }
      fact.knownByEvidence = knowledgeEvidence;
      if (knowledgeEvidence.length) fact.knownBy = [...new Set(knowledgeEvidence.map(item => item.npcId))];
      const old = plan.state.knowledge.filter(item => !['unverified', 'superseded', 'disputed', 'retracted'].includes(item.status)
        && ((fact.key && item.key === fact.key) || rows(fact.supersedes).includes(item.id)));
      if (!old.length) return fact;
      const repeated = old.find(item => fact.key && item.key === fact.key && item.text === fact.text);
      if (repeated && knowledgeEvidence.length) {
        fact.knownByEvidence = [...rows(repeated.knownByEvidence).map(item => ({ ...item, sourceTurn: item.sourceTurn ?? repeated.sourceTurn })), ...knowledgeEvidence];
        fact.knownBy = [...new Set([...rows(repeated.knownBy), ...knowledgeEvidence.map(item => item.npcId)])];
      } else if (repeated && !fact.sourceQuote && !fact.evidenceQuote && !checked.length) return null;
      const evidence = fact.sourceQuote || fact.evidenceQuote || (repeated ? knowledgeEvidence[0]?.quote : '');
      const sameSubject = old.every(item => overlap(item.text, fact.text) > 0);
      const terms = bigrams(fact.text).size;
      if (!positiveQuote(evidence, currentSources, { rejectQuestion: true }) || !sameSubject || !terms || overlap(evidence, fact.text) / terms < 0.6) {
        fact.status = 'unverified'; fact.disputeReason = '新的约定缺少本回合可核对的依据，旧约定仍然有效';
      }
      return fact;
    });
  }
  return result;
}
