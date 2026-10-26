import { buildPrompt } from './protocol.js';
import { narrationText } from '../messages.js';
import { extractChoices } from './actions.js';
import { recallHistory } from './memory.js';
import { correctionBlock, rememberCorrections } from './continuity.js';

export const CONTEXT_BUDGET = Object.freeze({ recent: 26000, recall: 14000, total: 100000 });
export function historyText(message) {
  let text = message.role === 'assistant' ? narrationText(message.content) : String(message.content || '');
  if (message.role === 'assistant') text = text.split(/【(?:你现在可以做什么|现在可以做什么|行动方向|可选行动|行动选项|选项)】/)[0];
  return text.trim();
}
/** Whole conversational turns, never the beginning of a long message with its conclusion cut off. */
export function recentHistory(history, budget = CONTEXT_BUDGET.recent) {
  let start = history.length, chars = 0;
  for (let end = history.length; end > 0;) {
    let begin = end - 1;
    while (begin > 0 && history[begin].role !== 'user') begin--;
    const length = history.slice(begin, end).reduce((sum, message) => sum + historyText(message).length, 0);
    if (start < history.length && chars + length > budget) break;
    chars += length; start = begin; end = begin;
  }
  return { start, chars, messages: history.slice(start).filter(m => ['user', 'assistant'].includes(m.role))
    .map(m => ({ role: m.role, content: historyText(m) })).filter(m => m.content) };
}
export function buildTurnRequest(plan, { rules = '', worldbook = '', chronicleDue = false } = {}) {
  const history = plan.history || [], corrections = plan.corrections || [];
  rememberCorrections(plan.state, history, corrections);
  const recent = recentHistory(history);
  // Short replies and pronouns inherit the active subject; the entire recent exchange remains in messages.
  const topic = [plan.text, ...history.slice(-6).map(historyText),
    ...plan.state.player.contracts.filter(c => c.status === 'active').map(c => c.label)].join('\n');
  const recall = recallHistory(plan.state, history, topic, 12, { before: recent.start, budget: CONTEXT_BUDGET.recall });
  const notes = correctionBlock(plan.state, corrections);
  const lastChoices = extractChoices(history.findLast(m => m.role === 'assistant')?.content || '');
  const requirements = `${corrections.length ? '【被纠正的原回合输入，仅供定位，不得执行被否定部分】' : '【本轮玩家原始输入，逐项处理】'}\n${plan.input || plan.text}\n${corrections.length ? '【原回合行动，以下方纠错为准】' : '【本轮实际行动】'}\n${plan.text}`
    + (plan.selected?.length ? `\n本轮选择了：${plan.selected.map(s => `${s.number}. ${s.text}`).join('；')}` : '')
    + (corrections.length ? `\n【本轮纠错，替换原回复，不能继续执行被否定的行动】\n${corrections.join('\n')}\n原输入仅供定位。按纠错修改事件含义，禁止换同义词继续原错误。保持原回合时间与已批准结算边界，不额外行动。` : '')
    + (plan.rejectedReply ? `\n【待替换的错误回复，仅供定位，不能作为事实】\n${plan.rejectedReply}` : '')
    + (lastChoices.length ? '\n历史中的未选选项只是建议；只有本轮明确选择或输入的行动可以执行。' : '');
  const system = buildPrompt(plan.state, plan.judged, plan.events, { rules, worldbook, query: plan.text, contextQuery: topic,
    chronicleDue, recall, corrections: notes })
    + (plan.finance.length ? '\n【本回合已批准交易条件】金额单位为铜：' + JSON.stringify(plan.finance) : '')
    + '\n' + requirements;
  const currentInput = corrections.length ? `请替换原回合，逐项落实这些纠正：\n${corrections.join('\n')}\n原行动和错误回复只供定位，不能将其当成再次要求执行的指令。不增加原回合的时间或重复结算。` : requirements;
  const messages = [...recent.messages, { role: 'user', content: currentInput }];
  const chars = system.length + messages.reduce((sum, m) => sum + m.content.length, 0);
  if (chars > CONTEXT_BUDGET.total) throw new Error('本轮必要资料过多，尚未发送；请缩小本次行动范围，原进度已保留。');
  return { system, messages, stats: { contextChars: chars, historyMessages: recent.messages.length,
    recalledMessages: (recall.match(/\[history:/g) || []).length, correctionCount: plan.state.continuity.corrections.length } };
}
export function repairMessages(plan, raw, instruction) {
  return [...(plan.request?.messages || [{ role: 'user', content: plan.text }]),
    { role: 'assistant', content: raw }, { role: 'user', content: instruction }];
}
