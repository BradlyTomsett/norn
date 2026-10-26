export const NUMBER_TEXT = '[0-9０-９零〇一二两三四五六七八九十百千万亿壹贰叁肆伍陆柒捌玖拾佰仟点.]+';
const digits = { 零: 0, 〇: 0, 一: 1, 壹: 1, 二: 2, 两: 2, 贰: 2, 三: 3, 叁: 3, 四: 4, 肆: 4, 五: 5, 伍: 5, 六: 6, 陆: 6, 七: 7, 柒: 7, 八: 8, 捌: 8, 九: 9, 玖: 9 };
export function numberOf(raw) {
  const text = String(raw ?? '').replace(/[０-９]/g, ch => String(ch.charCodeAt(0) - 65296));
  if (/^\d+(?:\.\d+)?$/.test(text)) return Number(text);
  if (/^[\d.]+[万亿]$/.test(text)) return Number(text.slice(0, -1)) * (text.endsWith('万') ? 10000 : 100000000);
  if ([...text].every(ch => ch in digits)) return Number([...text].map(ch => digits[ch]).join(''));
  if (text === '半') return 0.5;
  if (text.includes('点')) { const [a, b] = text.split('点'); return numberOf(a) + Number('0.' + [...b].map(ch => digits[ch] ?? ch).join('')); }
  let total = 0, section = 0, digit = 0;
  for (const ch of text) {
    if (/\d/.test(ch)) digit = digit * 10 + Number(ch);
    else if (ch in digits) digit = digits[ch];
    else if (/[十拾百佰千仟]/.test(ch)) { section += (digit || 1) * ({ 十: 10, 拾: 10, 百: 100, 佰: 100, 千: 1000, 仟: 1000 }[ch]); digit = 0; }
    else if (ch === '万' || ch === '亿') { section += digit; digit = 0; total = (total + section) * (ch === '万' ? 10000 : 100000000); section = 0; }
    else return NaN;
  }
  return total + section + digit;
}
export function moneyMentions(text) {
  const pattern = new RegExp(`(${NUMBER_TEXT})\\s*(?:枚|个)?\\s*(金币?|银币?|铜币?)`, 'g');
  const rows = [];
  for (const match of String(text || '').matchAll(pattern)) {
    const copper = Math.round(numberOf(match[1]) * ({ 金: 10000, 银: 100, 铜: 1 }[match[2][0]]));
    if (Number.isSafeInteger(copper) && copper >= 0) {
      const previous = rows.at(-1), gap = previous && String(text).slice(previous.end, match.index);
      if (previous && /^\s*(?:又|零|和)?\s*$/.test(gap) && previous.units.at(-1) !== match[2][0]) {
        previous.copper += copper; previous.end = match.index + match[0].length; previous.units.push(match[2][0]);
      } else rows.push({ copper, index: match.index, end: match.index + match[0].length, units: [match[2][0]] });
    }
  }
  return rows;
}
