// 叙事文本 → HTML。手机上每一行空行都是一屏的浪费，所以空行直接丢掉，
// 段落之间靠 CSS 的 margin 撑开；章节标题与分隔线单独成段。

export const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

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

/** 只在字符串外部替换字符，避免把正文里的中文逗号也改掉。 */
function fixOutsideStrings(s, map) {
  let out = '';
  let inStr = false;
  let esc = false;
  for (const ch of s) {
    if (inStr) {
      out += ch;
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') {
      inStr = true;
      out += ch;
      continue;
    }
    out += map[ch] || ch;
  }
  return out;
}

/** 容错解析：尾逗号、中文引号、注释、被截断的括号都尽量救回来。 */
export function parseLooseJson(input) {
  const raw = String(input || '').trim();
  if (!raw) return null;
  const tryParse = (t) => {
    try {
      return JSON.parse(t);
    } catch {
      return null;
    }
  };
  let v = tryParse(raw);
  if (v) return v;

  let t = raw
    .replace(/^[^{[]*/, '')
    .replace(/[^}\]]*$/, '')
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/,\s*([}\]])/g, '$1');
  t = fixOutsideStrings(t, { '：': ':', '，': ',', '｛': '{', '｝': '}', '【': '{', '】': '}' });
  v = tryParse(t);
  if (v) return v;

  // 可能被 max_tokens 截断：把没闭合的引号与括号补齐再试
  const stack = [];
  let inStr = false;
  let esc = false;
  for (const ch of t) {
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === '{' || ch === '[') stack.push(ch);
    else if (ch === '}' || ch === ']') stack.pop();
  }
  let fixed = t;
  if (inStr) fixed += '"';
  while (stack.length) fixed += stack.pop() === '{' ? '}' : ']';
  return tryParse(fixed);
}

/** 从 start 处的 { 找到与它配对的 }（跳过字符串里的括号）。 */
function matchBrace(s, start) {
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < s.length; i++) {
    const ch = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** 增量的常见字段，用来判断哪段 JSON 才是状态块（而不是里面某个嵌套对象）。 */
const DELTA_KEYS = [
  'money', 'trade', 'relations', 'knowledge', 'mind', 'body', 'goals', 'problems',
  'items', 'use', 'skills', 'unfinished', 'bounty', 'payDebt', 'borrow', 'gift', 'profession', 'time',
];

/** 从文本里找最像增量的那个 JSON 对象（取最外层、命中字段最多的）。 */
function lastJsonObject(src) {
  let best = null;
  for (let i = 0; i < src.length; i++) {
    if (src[i] !== '{') continue;
    const end = matchBrace(src, i);

    // 截断的情况：从这个 { 一直到结尾
    const slices = end > i ? [src.slice(i, end + 1)] : [src.slice(i)];
    for (const slice of slices) {
      const v = parseLooseJson(slice);
      if (!v || typeof v !== 'object' || Array.isArray(v)) continue;
      const hits = DELTA_KEYS.filter((k) => Object.prototype.hasOwnProperty.call(v, k)).length;
      const score = hits * 100000 + slice.length;
      if (!best || score > best.score) best = { slice, value: v, score };
    }
  }
  return best;
}

/** 把模型输出拆成「正文」和「最后一个 json 代码块」。 */
export function splitDelta(text) {
  const src = String(text || '');
  // 收尾的 ``` 可能被截断掉了，所以到「下一个 ``` 或 文本结束」都算块内容
  const stripFence = (s) =>
    s
      .replace(/`{3,}\s*(?:json|JSON)?[\s\S]*?(?:`{3,}|$)/g, '')
      .replace(/^[ \t]*`{3,}[ \t]*$/gm, '')
      .trim();

  // 1) 找代码块：允许没有收尾的 ``` （被截断的情况）
  const blocks = [...src.matchAll(/`{3,}\s*(?:json)?\s*([\s\S]*?)(?:`{3,}|$)/gi)]
    .map((m) => m[1])
    .filter((b) => b.includes('{'));

  let candidate = null;
  for (let i = blocks.length - 1; i >= 0; i--) {
    const v = parseLooseJson(blocks[i]);
    if (v) {
      candidate = { body: blocks[i], value: v };
      break;
    }
  }
  // 2) 没有代码块：正文里裸着的 JSON 也认
  if (!candidate) {
    const best = lastJsonObject(src);
    if (best) candidate = { body: best.slice, value: best.value };
  }

  if (!candidate) return { text: stripDataBlocks(stripFence(src)), delta: null };

  const idx = src.lastIndexOf(candidate.body);
  const head = idx >= 0 ? src.slice(0, idx) + src.slice(idx + candidate.body.length) : stripFence(src);
  return { text: stripDataBlocks(stripFence(head)), delta: candidate.value };
}

/**
 * 兜底：把任何看起来像数据块的东西从展示文本里删掉。
 * 不管是没解析成功的、被截断的、还是夹在中间的 JSON。
 */
export function stripDataBlocks(input) {
  let t = String(input || '');
  // 代码块（含未闭合）
  t = t.replace(/`{3,}[^\n]*\n?[\s\S]*?(?:`{3,}|$)/g, '');
  // 行首开始的一整块 JSON，直到文本结尾或下一个【小节】
  t = t.replace(/(?:^|\n)[ \t]*\{[\s\S]*?(?=\n[ \t]*【|$)/g, (m) => (m.startsWith('\n') ? '\n' : ''));
  return t.replace(/\n{3,}/g, '\n\n').trim();
}

/** 去掉模型不该输出的【当前角色】大表、结尾小标题和自言自语。 */
export function stripSheet(text) {
  let t = String(text || '');
  const i = t.indexOf('【当前角色】');
  if (i >= 0) {
    const rest = t.slice(i + 6);
    const m = rest.match(/【世界动态】|【你现在可以做什么】|【玩家自由行动】/);
    t = m ? t.slice(0, i) + rest.slice(m.index) : t.slice(0, i);
  }
  t = t.replace(/\n*(━+\s*)?【玩家自由行动】\s*$/, '');
  // 模型偶尔会自言自语「修正：……」，那不是游戏内容
  t = t
    .split('\n')
    .filter((l) => !/^(修正|更正|补充说明|说明)[：:]/.test(l.trim()))
    .join('\n');
  return t.replace(/\n{3,}/g, '\n\n').trim();
}

export function format(raw) {
  const lines = stripDataBlocks(String(raw || '')).replace(/\r\n/g, '\n').split('\n');
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
