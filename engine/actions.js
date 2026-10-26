const CIRCLED = [...'①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳'];
const OPTION_HEADING = /【(?:你现在可以做什么|现在可以做什么|行动方向|可选行动|行动选项|选项)】/;

/** Read legacy numbered prose as well as choices stored by newer turns. */
export function extractChoices(content) {
  const rows = [], text = String(content || '');
  const heading = text.match(OPTION_HEADING);
  const body = heading ? text.slice(heading.index + heading[0].length) : text;
  for (const raw of body.split('\n')) {
    const line = raw.trim().replace(/^[-*]\s+/, '').replace(/\*\*/g, '');
    if (/^【/.test(line)) { if (heading || rows.length) break; continue; }
    const m = line.match(/^([①-⑳]|\d{1,2}[.、．)）]|[（(]\d{1,2}[)）])\s*(.+)$/);
    if (!m) continue;
    const number = CIRCLED.includes(m[1]) ? CIRCLED.indexOf(m[1]) + 1 : Number(m[1].replace(/\D/g, ''));
    if (number < 1 || number > 20 || rows.some(row => row.number === number)) continue;
    rows.push({ number, text: m[2].trim() });
  }
  return rows;
}

export function resolveAction(input, messages = []) {
  const text = String(input || '').trim();
  const selector = text.replace(/^选(?:择)?\s*(?:第\s*)?/, '').replace(/[项个]$/, '').trim();
  if (!/^\d{1,2}(?:\s*(?:[、,，+和及]|\s)\s*\d{1,2})*$/.test(selector)) return { text, input: text };
  const numbers = [...new Set(selector.match(/\d+/g).map(Number))];
  const last = messages.findLast(message => message.role === 'assistant');
  const choices = extractChoices(last?.content);
  if (!choices.length) throw new Error('上一条回复没有编号选项，请直接描述要做的事。');
  const selected = numbers.map(number => choices.find(choice => choice.number === number));
  if (selected.some(choice => !choice)) throw new Error('这个选项编号不存在，请按上一条回复的编号选择。');
  return { text: selected.map(choice => choice.text).join('；'), input: text, selected };
}
