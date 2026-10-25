// A withdrawn postal quote, not a game price or a reference offered to the model.
const withdrawnPostalAmount = 568_437;
const postal = /寄信|送信|邮差|邮资|邮费|专人专送|信使/;
export function isRetiredPostalQuote(name, entry) {
  if (!postal.test(String(name || ''))) return false;
  const value = entry?.copper ?? entry?.price ?? entry;
  return [value, value?.min, value?.max].some(v => Number(v) === withdrawnPostalAmount);
}
export function isRetiredPostalText(text) {
  const s = String(text || '');
  return postal.test(s) && /568[\s,，]?437|56\s*金\s*84\s*银\s*37\s*铜|五十六金八十四银三十七铜/.test(s);
}
export function cleanRetiredMessages(messages) {
  return (messages || []).map(m => ({ ...m, content: String(m.content || '').split('\n').filter(line => !isRetiredPostalText(line)).join('\n') }))
    .filter(m => m.content.trim());
}
export function removeRetiredPostalData(state) {
  for (const key of ['prices', 'rates']) {
    for (const [name, value] of Object.entries(state[key] || {})) if (isRetiredPostalQuote(name, value)) delete state[key][name];
  }
  for (const key of ['ledgerLog', 'knowledge', 'worldLog', 'storyLog', 'chronicle']) {
    if (Array.isArray(state[key])) state[key] = state[key].filter(row => !isRetiredPostalText(typeof row === 'string' ? row : row?.text));
  }
  if (Array.isArray(state.messages)) state.messages = cleanRetiredMessages(state.messages);
  return state;
}
