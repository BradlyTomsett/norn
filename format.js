// 叙事文本 → HTML。手机上每一行空行都是一屏的浪费，所以空行直接丢掉，
// 段落之间靠 CSS 的 margin 撑开；章节标题与分隔线单独成段。

export const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

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
