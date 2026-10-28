import { OPTION_HEADING } from './actions.js';
const dayMinute = clock => clock.hour * 60 + clock.minute;
const numeral = text => {
  if (/^\d+$/.test(text)) return Number(text);
  const digits = { 零: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
  const parts = text.split('十');
  return parts.length > 1 ? (parts[0] ? digits[parts[0]] || 0 : 1) * 10 + (digits[parts[1]] || 0) : digits[text];
};

/** An explicit endpoint; null means the text does not specify one. */
export function targetMinutes(text, clock) {
  if (!clock) return null;
  const value = String(text || ''), now = dayMinute(clock);
  if (/^(?:问|询问|请问|打听|告诉)/.test(value) || /(?:不要|不用|不必|别|不再)(?:等|守|睡|推进|到)/.test(value)) return null;
  if (!/(?:到|等|守|睡|推进|等候|直至|直到|持续|继续)/.test(value)) return null;
  const tomorrow = /明天|明日|明早|明晚/.test(value), later = /后天/.test(value);
  let target, isPeriod = false;
  if (/后半夜/.test(value)) { target = 0; isPeriod = true; if (!tomorrow && !later && now < 360) return 0; }
  else if (/天亮|黎明|清晨/.test(value)) { target = 360; isPeriod = true; }
  else if (/明早|明日早上|明天早上/.test(value)) { target = 420; isPeriod = true; if (/明早/.test(value) && now < 420) return target - now; }
  else {
    const m = value.match(/(?:到|直至|直到|等到|守到|推进到)\s*(?:(明天|明日|后天|今天|今晚|明晚)\s*)?(凌晨|半夜|夜里|晚上|下午|中午|早上|上午)?\s*(\d{1,2}|[零一二两三四五六七八九十]{1,3})\s*(?::|点|时)(?:(\d{1,2}|[零一二两三四五六七八九十]{1,3})(?:分)?)?(半)?/);
    if (!m) return null;
    let hour = numeral(m[3]), minute = m[5] ? 30 : m[4] ? numeral(m[4]) : 0;
    if (!Number.isInteger(hour) || hour > 23 || !Number.isInteger(minute) || minute > 59) return null;
    if (/下午|晚上|明晚/.test((m[1] || '') + (m[2] || '')) && hour < 12) hour += 12;
    if (/凌晨|半夜/.test(m[2] || '') && hour === 12) hour = 0;
    target = hour * 60 + minute;
  }
  if (later) return 2880 + target - now;
  if (tomorrow) return 1440 + target - now;
  if (target >= now) return target - now;
  if (isPeriod && target === 360 && now < 420) return 0;
  return 1440 + target - now;
}

export function timePreview(clock, minutes) {
  const pad = n => String(n).padStart(2, '0'), start = dayMinute(clock), end = start + minutes;
  const days = Math.floor(end / 1440), hour = Math.floor(end / 60) % 24, minute = end % 60;
  const duration = `${Math.floor(minutes / 60) ? Math.floor(minutes / 60) + ' h' : ''}${Math.floor(minutes / 60) && minutes % 60 ? ' ' : ''}${minutes % 60 || !minutes ? minutes % 60 + ' m' : ''}`;
  return `${pad(clock.hour)}:${pad(clock.minute)} → ${days === 1 ? '次日 ' : days > 1 ? `${days}日后 ` : ''}${pad(hour)}:${pad(minute)}，推进 ${duration}`;
}

/** Only the narrated player's present timeline may contradict the engine. */
export function narrativeTime(raw, clock) {
  const prose = String(raw || '').split('```')[0].split(OPTION_HEADING)[0].replace(/“[^”]*”|「[^」]*」|『[^』]*』|"[^"\n]*"/g, '');
  const sentences = prose.split(/[。！？\n]+/).map(x => x.trim()).filter(Boolean);
  for (const sentence of sentences.reverse()) {
    const clauses = sentence.split(/[，,；;]/).map(x => x.trim());
    for (const clause of clauses.reverse()) {
      if (/尚未|还没|不是|未到|如果|将会|预计|明天再|约定|询问|你问|他说|她说|听说|上次|以前|曾经|打算|计划|准备|可以|将要/.test(clause)) continue;
      const marker = '(?:已经|此时|现在|这时|到了|来到|时间来到|夜已|直至|直到|转眼|守到|等到)';
      const day = '(?:次日|第二天|翌日|明日|明天|今天|当天)?';
      const period = '(?:凌晨|后半夜|天亮|黎明|清晨|早上|上午|中午|下午|晚上|夜里)?';
      const point = '(?:\\d{1,2}|[零一二两三四五六七八九十]{1,3})(?::\\d{2}|点(?:半|\\d{1,2}分?)?|时)';
      const matches = [...clause.matchAll(new RegExp(`(?:${marker}(?:(?:已经|已)?是|已经|已|了|到)?\\s*|^)(${day}\\s*${period}\\s*(?:${point})?|后半夜|天亮|黎明|清晨)`, 'g'))];
      for (const match of matches.reverse()) {
        const fragment = match[1].trim().replace(/次日|第二天|翌日/g, '明天');
        if (!fragment || !/后半夜|天亮|黎明|清晨|\d{1,2}:\d{2}|[零一二两三四五六七八九十\d]+(?:点|时)/.test(fragment)) continue;
        const minutes = targetMinutes('等到' + fragment, clock);
        if (minutes != null && minutes <= 3650 * 1440) return { minutes, quote: sentence };
      }
      const duration = clause.match(/(?:本轮(?:共|总共)?(?:经过|耗时)|总共(?:经过|耗时)?|共(?:经过|耗时)|已经过了|过了)(\d+|[零一二两三四五六七八九十]+)(?:个)?(分钟|小时|天|日)/);
      if (duration) {
        const minutes = numeral(duration[1]) * ({ 分钟: 1, 小时: 60, 天: 1440, 日: 1440 }[duration[2]]);
        if (Number.isSafeInteger(minutes) && minutes >= 0 && minutes <= 3650 * 1440) return { minutes, quote: sentence };
      }
    }
  }
  return null;
}
