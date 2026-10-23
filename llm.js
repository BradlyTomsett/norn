// 浏览器直连 DeepSeek（已确认对方允许跨域）。Key 存在这台手机上。
const KEY = 'norn.key';
const MODEL = 'norn.model';
const EFFORT = 'norn.effort';

export const getKey = () => localStorage.getItem(KEY) || '';
export const setKey = (k) => localStorage.setItem(KEY, String(k || '').trim());
export const getModel = () => localStorage.getItem(MODEL) || 'deepseek-flash';
export const setModel = (m) => localStorage.setItem(MODEL, String(m || '').trim() || 'deepseek-flash');
export const getEffort = () => localStorage.getItem(EFFORT) || 'low';
export const setEffort = (e) => localStorage.setItem(EFFORT, e);

export const hasKey = () => Boolean(getKey());

const ENDPOINT = 'https://api.deepseek.com/v1/chat/completions';

/** 流式对话：yield 文本片段。 */
export async function* streamChat({ system, messages, temperature = 0.95, maxTokens = 4000, signal }) {
  const key = getKey();
  if (!key) throw new Error('还没有填 API Key');

  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      model: getModel(),
      temperature,
      max_tokens: maxTokens,
      reasoning_effort: getEffort(),
      stream: true,
      messages: [{ role: 'system', content: system }, ...messages],
    }),
    signal,
  });

  if (!res.ok || !res.body) {
    const t = await res.text().catch(() => '');
    const hint =
      res.status === 401
        ? '（Key 不对或已失效）'
        : res.status === 402
          ? '（余额不足）'
          : res.status === 429
            ? '（请求太频繁，等几秒再试）'
            : '';
    throw new Error(`模型返回 ${res.status} ${hint} ${t.slice(0, 160)}`);
  }

  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const parts = buf.split('\n\n');
    buf = parts.pop() || '';
    for (const part of parts) {
      for (const line of part.split('\n')) {
        const t = line.trim();
        if (!t.startsWith('data:')) continue;
        const data = t.slice(5).trim();
        if (data === '[DONE]') return;
        try {
          const json = JSON.parse(data);
          const delta = json.choices?.[0]?.delta?.content;
          if (delta) yield delta;
        } catch {
          /* 心跳与坏包 */
        }
      }
    }
  }
}
