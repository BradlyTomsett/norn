// 叙事文本 → HTML。手机上每一行空行都是一屏的浪费，所以空行直接丢掉，
// 段落之间靠 CSS 的 margin 撑开；章节标题与分隔线单独成段。

export const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export const EMPTY_LINE =
  /^(【[^】]{1,14}】\s*)?(无|没有|暂无|暂无新消息|暂无变化|暂无动态|无事|无变化|无进出|无明显变化|无异常|无新增|无新消息|没有变化|没有新消息|没有新动态|一切如常|一如往常|如常|照旧|依旧|平静|风平浪静|（无）|\(无\))[。.！!～~]?$/;

/** 去掉空段落、重复段落；整段都是「无」的小节直接删掉。 */
export function pruneEmpty(text) {
  const lines = String(text || '').split('\n');
  const out = [];
  const seenHeads = new Set();
  const seenLines = new Set();
  let head = null;
  let body = [];
  const flush = () => {
    if (!head) return;
    const kept = [];
    for (const l of body) {
      const t = l.trim();
      if (EMPTY_LINE.test(t)) continue;
      if (t === '') {
        if (kept.length === 0 || kept[kept.length - 1].trim() === '') continue;
        kept.push(l);
        continue;
      }
      // 同一回合里前面已经说过的话（比如【世界动态】复述【当地动态】）不再重复
      if (t.length >= 8 && seenLines.has(t)) continue;
      seenLines.add(t);
      kept.push(l);
    }
    while (kept.length && kept[kept.length - 1].trim() === '') kept.pop();
    const key = head.trim();
    if (kept.length && !seenHeads.has(key)) {
      out.push(head, ...kept);
      seenHeads.add(key);
    }
    head = null;
    body = [];
  };
  for (const line of lines) {
    if (/^【[^】]{1,12}】\s*$/.test(line.trim())) {
      flush();
      head = line;
      body = [];
    } else if (head) body.push(line);
    else out.push(line);
  }
  flush();
  let t = out.join('\n');
  t = t.replace(/(?:^|\n)(?:━{4,}[ \t]*\n){2,}/g, '\n━━━━━━━━━━\n');
  return t.replace(/\n{3,}/g, '\n\n').trim();
}

export function format(raw) {
  const lines = String(raw || '').replace(/\r\n/g, '\n').split('\n');
  const out = [];
  for (const line of lines) {
    const t = line.trim();
    if (!t) continue;
    if (/^【[^】]{1,20}】$/.test(t)) out.push(`<p class="sec">${esc(t)}</p>`);
    else if (/^━+$/.test(t)) out.push('<p class="rule">────────────</p>');
    else out.push(`<p>${esc(t)}</p>`);
  }
  return out.join('');
}
