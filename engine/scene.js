import { narrationText } from '../messages.js';
import { entityRefs, factEntityRefs, npcLabel, textId } from './entities.js';
import { relevantNpcs } from './npcs.js';
import { cancelledActions, redactCorrectedHistory, redactCorrectedInput, correctionContaminates, contradictedByCorrection } from './continuity.js';

const story = message => narrationText(message?.content || '').split(/【(?:你现在可以做什么|现在可以做什么|行动方向|可选行动|行动选项|选项)】/)[0].trim();
const wholeLines = (value, limit) => {
  const result = []; let length = 0;
  for (const part of String(value).split(/(?<=[。！？\n])/).map(x => x.trim()).filter(Boolean)) {
    if (length + part.length > limit) break;
    result.push(part); length += part.length;
  }
  return result.join(' ');
};
const terms = value => { const s = String(value || '').replace(/[\s，。；、：:“”「」！？!?]/g, ''); return new Set([...s].slice(0, -1).map((_, i) => s.slice(i, i + 2))); };
const overlap = (a, b) => { const left = terms(a); return [...terms(b)].filter(word => left.has(word)).length; };

/** Infer a legacy same-name link only when identity and another participant are corroborated in the same history. */
export function historicalIdentityHints(state, history = [], guards = []) {
  const hints = new Map();
  for (const fact of state.knowledge || []) {
    if (!fact || typeof fact !== 'object' || !Number.isInteger(fact.sourceTurn) || contradictedByCorrection(state, fact)) continue;
    const refs = factEntityRefs(state, fact.text, fact);
    if (!refs.uncertainNpcNames.length) continue;
    const sourceIndex = history.findLastIndex(message => message.role === 'assistant' && message.sourceTurn === fact.sourceTurn);
    if (sourceIndex < 0) continue;
    const source = redactCorrectedHistory(story(history[sourceIndex]), sourceIndex, guards);
    const accepted = [], proofs = [];
    for (const name of refs.uncertainNpcNames) {
      const group = state.npcs.filter(npc => npc.name === name), groupIds = new Set(group.map(npc => npc.id));
      const companions = refs.npcIds.map(id => state.npcs.find(npc => npc.id === id)).filter(npc => npc && npc.name !== name);
      if (!companions.length) continue;
      const sourceSentence = source.split(/[。！？\n]/).find(text => text.includes(name)
        && companions.some(npc => text.includes(npc.name)) && overlap(text, fact.text) >= 4);
      if (!sourceSentence) continue;
      const candidates = [];
      for (let i = 0; i <= sourceIndex; i++) {
        if (history[i].role !== 'assistant') continue;
        const text = redactCorrectedHistory(story(history[i]), i, guards);
        for (const sentence of text.split(/[。！？\n]/)) {
          if (!sentence.includes(name) || !companions.some(npc => sentence.includes(npc.name)) || /如果|也许|可能是|建议|尚未确认/.test(sentence)) continue;
          const ids = entityRefs(state, sentence).npcIds.filter(id => groupIds.has(id));
          if (ids.length === 1) candidates.push({ id: ids[0], quote: sentence.trim().slice(0, 500), index: i });
        }
      }
      if (new Set(candidates.map(item => item.id)).size !== 1) continue;
      const proof = candidates.at(-1); accepted.push(proof.id); proofs.push(proof);
    }
    if (!accepted.length) continue;
    const repaired = [...refs.npcIds, ...accepted];
    const id = fact.id || `fact:${textId(`${fact.text}|${fact.source || ''}|${fact.day || ''}`)}`;
    hints.set(id, { npcIds: [...new Set(repaired)], identityVerifiedNpcIds: accepted, historicalIdentityEvidence: proofs });
  }
  return hints;
}

/** A conservative legacy hint; it never changes the saved location. */
export function recentSceneEvidence(history = [], guards = []) {
  for (let i = history.length - 1; i >= Math.max(0, history.length - 16); i--) {
    const message = history[i]; if (message.role !== 'assistant') continue;
    const text = redactCorrectedHistory(story(message), i, guards);
    const previous = history[i - 1]?.role === 'user' ? redactCorrectedInput(history[i - 1].content, i - 1, guards) : '';
    if (/(?:你|你们|一行人).{0,12}(?:离开|走出|出了|返回|回到)/.test(text)) return null;
    const direct = /(?:你们?|一行人).{0,10}(?:走进|进入|走入|进了|入内|进仓)/.test(text)
      && !/(?:没有|没|并未|尚未|未能|不曾|如果|明天|以后).{0,12}(?:走进|进入|走入|进了|入内|进仓)/.test(text);
    const chosen = /(?:进去|进入|走进|进了|入内|进仓)/.test(previous)
      && !/(?:能否|是否|能不能|要不要|如果|明天|以后|打算|计划|准备|不要|不许|别).{0,12}(?:进去|进入|走进|进了|入内|进仓)/.test(previous);
    if (!direct && !chosen) continue;
    const place = text.match(/(?:^|\n)(仓里|屋里|店里|酒馆里|大厅里|院里)(?:比|一|有|是|很|显得|暗|亮|人|静|摆|站|坐|堆)/);
    if (place) return { place: place[1], index: i, quote: wholeLines(text.slice(place.index), 220) };
  }
  return null;
}

export function sceneLocationUncertain(state, evidence) {
  if (!evidence) return false;
  const location = state.player.location.siteName;
  return !(evidence.place === '仓里' ? /(?:仓库?|库房|仓房)(?:内|里)/.test(location)
    : location.includes(evidence.place) || location.includes(evidence.place.replace(/里$/, '内')));
}

export function sceneEvidenceFor(state, history = [], guards = []) {
  const recent = recentSceneEvidence(history, guards); if (recent) return recent;
  const saved = state.continuity?.sceneEvidence;
  if (!saved || saved.locationId !== state.player.location.siteId || !Number.isInteger(saved.index) || !history[saved.index]) return null;
  if (history.slice(saved.index + 1).some(message => message.role === 'assistant'
    && /(?:你|你们|一行人).{0,12}(?:离开|走出|出了|返回|回到)/.test(story(message)))) return null;
  const evidence = recentSceneEvidence(history.slice(0, saved.index + 1), guards);
  return evidence?.index === saved.index && evidence.place === saved.place ? evidence : null;
}

export function rememberSceneEvidence(state, plan) {
  state.continuity ||= {};
  if (state.player.location.siteId !== plan.state.player.location.siteId) { delete state.continuity.sceneEvidence; return; }
  const evidence = sceneEvidenceFor(plan.state, plan.history, plan.request?.allCorrectionGuards || cancelledActions(plan.state));
  if (sceneLocationUncertain(state, evidence)) state.continuity.sceneEvidence = { index: evidence.index, place: evidence.place, locationId: state.player.location.siteId };
  else delete state.continuity.sceneEvidence;
}

/** Require an explicit location update only for a plainly narrated move into a new interior. */
export function missingSceneLocation(plan, raw, delta) {
  const text = narrationText(raw), input = String(plan.text || '');
  if (/(?:没有|没|并未|尚未|未能|不曾|如果|明天|以后|打算|计划).{0,12}(?:进去|进入|走进|进仓)/.test(text)) return false;
  const direct = /(?:你们?|一行人).{0,10}(?:走进|进入|走入|进了)(仓库|仓房|仓里|屋里|店里|酒馆|大厅|院里)/.test(text);
  const intent = /(?:进去|进入|走进|进仓|进了|入内)/.test(input)
    && !/(?:让|叫|请|命令).{0,8}(?:他|她|他们|她们).{0,5}(?:进去|进入|走进|进仓)/.test(input)
    && !/(?:能否|是否|能不能|要不要|如果|明天|以后|打算|计划|准备|不要|不许|别).{0,12}(?:进去|进入|走进|进仓|进了|入内)/.test(input);
  const describedInterior = /(?:^|\n)(仓里|屋里|店里|酒馆里|大厅里|院里)(?:比|一|有|是|很|显得|暗|亮|人|静|摆|站|坐|堆)/.test(text);
  if (!direct && !(intent && describedInterior)) return false;
  const place = text.match(/(?:仓库|仓房|仓里|屋里|店里|酒馆|大厅|院里)/)?.[0];
  if (!place) return false;
  const isInside = place.startsWith('仓') ? /(?:仓库?|库房|仓房)(?:内|里)/.test(plan.state.player.location.siteName)
    : plan.state.player.location.siteName.includes(place.replace(/里$/, ''));
  if (isInside) return false;
  return !delta?.location?.siteId || !delta.location.siteName || delta.location.siteId === plan.state.player.location.siteId;
}

export function sceneContext(state, history = [], input = '', guards = []) {
  const lastIndex = history.findLastIndex(m => m.role === 'assistant');
  const latest = lastIndex < 0 ? '' : redactCorrectedHistory(story(history[lastIndex]), lastIndex, guards);
  const evidence = sceneEvidenceFor(state, history, guards);
  const selected = relevantNpcs(state, [input, latest].join('\n'));
  const refs = entityRefs(state, [input, latest].join('\n'));
  const people = selected.filter(n => refs.npcIds.includes(n.id) || n.following || n.location?.siteId === state.player.location.siteId);
  const contracts = state.player.contracts.filter(c => c.status === 'active');
  const contractEvidence = [];
  for (const contract of contracts) {
    for (let i = history.length - 1; i >= 0 && contractEvidence.filter(row => row.id === contract.id).length < 2; i--) {
      if (history[i].role !== 'assistant') continue;
      const text = redactCorrectedHistory(story(history[i]), i, guards);
      for (const para of text.split(/\n\s*\n/)) {
        if (!para.includes(contract.label) || !/委托|公会|行会|仓头|雇|负责|名号|接洽|期限/.test(para)) continue;
        contractEvidence.push({ id: contract.id, index: i, text: wholeLines(para, 500) }); break;
      }
    }
  }
  const lines = ['【当前场景承接】', `记录地点：${state.player.location.siteName}。`];
  if (sceneLocationUncertain(state, evidence)) {
    lines.push(`近期原文已描述进入${evidence.place}：[history:${evidence.index}] ${evidence.quote}。地点字段可能落后，按已发生的场景承接，不要凭旧地点说玩家退回；如果依据充分，在变化数据中更新地点，不额外增加移动。`);
  }
  if (latest) lines.push(`最近已发生的场景 [history:${lastIndex}]：${wholeLines(latest, 1100)}`);
  if (people.length) lines.push('相关人物（仅标识已有记录；提到某人不等于确认在场）：' + people.map(n => `[${n.id}] ${npcLabel(state, n)}｜${n.following ? '记录为同行' : n.location?.siteName ? `记录位置 ${n.location.siteName}，可能过时` : '是否在场待核对'}`).join('；'));
  if (contractEvidence.length) lines.push('委托与接洽原文：' + contractEvidence.map(row => `[history:${row.index}] ${row.text}`).join('；'));
  lines.push('态度依据各自身份、委托关系、已知的经历与眼前行为。已确认来完成委托并获准接洽时，先按已有合作关系正常交接；不要凭空写成敌视、拒绝或忘记委托。若有具体冲突依据，仍可按人物动机合理表达顾虑，不预设真凶或强制所有人友好。');
  lines.push('人物只能依据本人亲历、明确被告知或有来源的传闻行动。玩家资料、其他人的秘密和全局事实不自动成为每个NPC的知识；不确定谁在场或谁知情时，不要擅自断定。');
  for (const npc of people) {
    const uniqueName = state.npcs.filter(n => n.name === npc.name).length === 1;
    const spoken = state.knowledge.filter(row => uniqueName && !contradictedByCorrection(state, row) && !correctionContaminates(row, guards)
      && String(row.source || '').includes(npc.name) && /当面|亲口|说|讲|告知|交代/.test(String(row.source || ''))).slice(-3);
    if (spoken.length) lines.push(`[${npc.id}] 来源声称与本人有关的记录，需结合原文核对：${spoken.map(row => row.text).join('；')}`);
    const known = state.knowledge.filter(row => !contradictedByCorrection(state, row) && row.status !== 'unverified'
      && !correctionContaminates(row, guards) && Array.isArray(row.knownBy) && row.knownBy.includes(npc.id) && Array.isArray(row.knownByEvidence) && row.knownByEvidence.some(item => {
        if (item.npcId !== npc.id || typeof item.quote !== 'string') return false;
        const index = history.findLastIndex(message => message.role === 'assistant' && message.sourceTurn === (item.sourceTurn ?? row.sourceTurn));
        if (index < 0) return false;
        const prior = history[index - 1]?.role === 'user' ? redactCorrectedInput(history[index - 1].content, index - 1, guards) : '';
        return (prior + '\n' + redactCorrectedHistory(story(history[index]), index, guards)).includes(item.quote);
      })).slice(-6);
    if (known.length) lines.push(`[${npc.id}] 有原文依据、已明确告知或听到的事实：${known.map(row => row.text).join('；')}`);
  }
  return lines.join('\n');
}
