import { streamChat } from './llm.js';

/** Complete truncated output; all chunks belong to one still-uncommitted turn. */
export async function completeReply(options, { stream = streamChat, initialRaw = '', resume = false,
  onProgress, onContinuation, maxContinuations = 2 } = {}) {
  let raw = initialRaw, continuing = resume;
  for (let attempt = 0; attempt <= maxContinuations; attempt++) {
    const previous = raw;
    const fence = continuing ? raw.search(/```\s*(?:json)?/i) : -1;
    if (fence >= 0) raw = raw.slice(0, fence).trimEnd() + '\n';
    const request = continuing ? { ...options, effort: 'none', messages: [...options.messages,
      { role: 'assistant', content: previous || '（上一请求达到输出上限，尚未生成正文。）' },
      { role: 'user', content: fence >= 0
        ? '正文已生成完毕。仅补上覆盖整个本回合的完整JSON状态变化块，替换上次截断的数据块；不要再写正文，不要核对剧情。'
        : '上一回复达到长度上限。只接着已有正文的末尾补完，禁止重新开头或重复前文；不要核对、改写已经生成的剧情。最后给出覆盖整个本回合的完整JSON状态变化块。' }] } : options;
    try {
      for await (const chunk of stream(request)) { raw += chunk; await onProgress?.(raw); }
      return raw;
    } catch (error) {
      error.partialReply = raw;
      if (error.code !== 'generation_length' || attempt === maxContinuations) throw error;
      continuing = true;
      await onContinuation?.(raw);
    }
  }
}
