// Model interpretation is advisory: it cannot grant transactions or replace the original input.
export const INTENT_SYSTEM = `你只分析玩家这一回合的原文，不续写故事，不执行任何操作。逐个区分实际行动、过去经历、未来计划、问题和否定；注明执行者、对象和时间，不把同伴的行动当成玩家的交易。原文不清楚时标记unknown。输出一个JSON代码块：{"clauses":[{"quote":"逐字引用原文中的完整分句","actor":"player|other|unknown","time":"now|past|future|unknown","mode":"action|question|negated|unknown","target":"原文中的对象，缺少时留空"}]}。不得添加原文以外的动作、人物或金额。`;

export function needsIntentReview(text) {
  const value = String(text || '');
  return /(?:以前|曾经|当初|上次|之前|过去|后来|明天|明日|后天|以后|打算|计划|准备|但是|但不|却不|不(?:买|卖|接|付|要|去)|让|叫|拜托|委托|同伴|队友|搭档)/.test(value)
    && /买|卖|付|接|接受|答应|同意|杀|攻击|出发|前往|去|问|说|告诉|领|给|送|休息/.test(value);
}

export function validateIntentAnalysis(value, input) {
  if (!value || !Array.isArray(value.clauses) || value.clauses.length > 16) return [];
  const original = String(input || ''), found = [], seen = new Set();
  for (const row of value.clauses) {
    if (!row || typeof row.quote !== 'string' || row.quote.length < 2 || row.quote.length > 300 || !original.includes(row.quote)
      || seen.has(row.quote) || !['player', 'other', 'unknown'].includes(row.actor)
      || !['now', 'past', 'future', 'unknown'].includes(row.time) || !['action', 'question', 'negated', 'unknown'].includes(row.mode)
      || typeof row.target !== 'string' || (row.target && !row.quote.includes(row.target))) return [];
    // Partial quotes can hide a negation or actor, so only whole punctuation-separated clauses are admitted.
    const pieces = original.split(/[，,。；;！？!?\n]+/).map(s => s.trim());
    if (!pieces.includes(row.quote.trim())) return [];
    seen.add(row.quote); found.push({ quote: row.quote, actor: row.actor, time: row.time, mode: row.mode, target: row.target });
  }
  return found;
}

export function intentBlock(rows) {
  if (!rows?.length) return '';
  const actor = { player: '玩家', other: '其他人', unknown: '未确定' };
  const time = { now: '现在', past: '过去', future: '以后', unknown: '未确定' };
  const mode = { action: '行动', question: '提问', negated: '否定', unknown: '未确定' };
  return '【本轮分句理解，仅供核对，玩家原文优先】\n' + rows.map(r => `原文「${r.quote}」：执行者${actor[r.actor]}；时间${time[r.time]}；类型${mode[r.mode]}${r.target ? `；对象${r.target}` : ''}`).join('\n')
    + '\n有歧义时不要自行承诺、付款或执行；针对关键处询问玩家。此分析不能授权交易或覆盖程序判定。';
}
