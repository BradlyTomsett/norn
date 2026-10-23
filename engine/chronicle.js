// 编年：长局唯一的长期记忆。
// 模型按规则每 12 回合输出一次【编年】，这里把它截下来存进状态，
// 否则它只是聊天里的一条消息，几回合后就被挤出上下文窗口。

const BULLET = /^[·•\-*—]\s*/;

export function parseChronicle(text) {
  const src = String(text || '');
  const m = src.match(/【编年[^】]*】([\s\S]*?)(?=\n\s*【|$)/);
  if (!m) return [];
  const body = m[1];
  const bulleted = body
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => BULLET.test(l))
    .map((l) => l.replace(BULLET, '').trim());
  const lines = bulleted.length
    ? bulleted
    : body
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean);
  return lines.filter((l) => l.length > 3 && l.length < 120).slice(0, 20);
}

export function ensureChronicle(state) {
  if (!Array.isArray(state.chronicle)) state.chronicle = [];
  return state.chronicle;
}

/** 合并进状态：去重、封顶 60 条。返回新增条数。 */
export function mergeChronicle(state, entries) {
  const list = ensureChronicle(state);
  let added = 0;
  for (const raw of entries || []) {
    const text = String(raw || '').trim();
    if (!text) continue;
    if (list.includes(text)) continue;
    list.push(text);
    added += 1;
  }
  if (list.length > 60) state.chronicle = list.slice(-60);
  return added;
}

export function chronicleText(state, n = 6) {
  const list = ensureChronicle(state);
  if (!list.length) return '';
  return list.slice(-n).join('\n');
}

/** 该不该这回合要求模型整理编年。 */
export function chronicleDue(state, userText) {
  if (/整理记忆|编年/.test(String(userText || ''))) return true;
  const next = (Number(state?.turn) || 0) + 1;
  return next % 12 === 0;
}
