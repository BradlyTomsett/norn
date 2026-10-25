const KEY = 'norn.key', MODEL = 'norn.model', EFFORT = 'norn.effort', SCOPE = 'norn.credentials.session';
export const sessionOnly = () => localStorage.getItem(SCOPE) === 'true';
export function setSessionOnly(value) { localStorage.setItem(SCOPE, String(Boolean(value))); }
export const getKey = () => sessionStorage.getItem(KEY) || localStorage.getItem(KEY) || '';
export function setKey(value) {
  const target = sessionOnly() ? sessionStorage : localStorage, other = sessionOnly() ? localStorage : sessionStorage;
  target.setItem(KEY, String(value || '').trim()); other.removeItem(KEY);
}
export const getModel = () => localStorage.getItem(MODEL) || 'deepseek-flash';
export const setModel = m => localStorage.setItem(MODEL, String(m || '').trim() || 'deepseek-flash');
export const getEffort = () => localStorage.getItem(EFFORT) || 'low';
export const setEffort = e => localStorage.setItem(EFFORT, e);
export const hasKey = () => Boolean(getKey());
const ENDPOINT = 'https://api.deepseek.com/v1/chat/completions';

/** A stream is successful only after an explicit, non-truncated completion. */
export async function* streamChat({ system, messages, temperature = 0.85, maxTokens = 6000, signal, timeoutMs = 180000 }) {
  const key = getKey();
  if (!key) throw new Error('还没有填 API Key');
  const controller = new AbortController();
  const abort = () => controller.abort(signal?.reason);
  if (signal?.aborted) abort(); else signal?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(() => controller.abort(new Error('生成超时，可以重试本回合')), timeoutMs);
  let reader;
  try {
    const res = await fetch(ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({ model: getModel(), temperature, max_tokens: maxTokens, reasoning_effort: getEffort(), stream: true,
        messages: [{ role: 'system', content: system }, ...messages] }), signal: controller.signal });
    if (!res.ok || !res.body) {
      const hint = { 401: 'Key 不对或已失效', 402: '余额不足', 429: '请求太频繁，请稍后重试' }[res.status] || '服务暂时不可用';
      throw new Error(`模型返回 ${res.status}：${hint}`);
    }
    reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '', complete = false;
    const parseLine = line => {
      if (!line.startsWith('data:')) return null;
      const data = line.slice(5).trim();
      if (data === '[DONE]') { complete = true; return null; }
      if (!data) return null;
      let json; try { json = JSON.parse(data); } catch { throw new Error('回复数据损坏，本回合尚未提交'); }
      if (json.error) throw new Error('模型生成失败，本回合尚未提交');
      const choice = json.choices?.[0];
      if (choice?.finish_reason === 'length') throw new Error('回复超过长度限制，本回合尚未提交');
      if (choice?.finish_reason && choice.finish_reason !== 'stop') throw new Error('模型未能完整完成回复');
      if (choice?.finish_reason === 'stop') complete = true;
      return choice?.delta?.content || null;
    };
    while (true) {
      const { value, done } = await reader.read();
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
      let index;
      while ((index = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, index).replace(/\r$/, ''); buffer = buffer.slice(index + 1);
        const chunk = parseLine(line); if (chunk) yield chunk;
      }
      if (done) { if (buffer.trim()) { const chunk = parseLine(buffer.replace(/\r$/, '')); if (chunk) yield chunk; } break; }
      if (complete) break;
    }
    if (!complete) throw new Error('连接在回复完成前断开，本回合尚未提交');
  } finally {
    clearTimeout(timer); signal?.removeEventListener('abort', abort);
    await reader?.cancel().catch(() => {});
  }
}
