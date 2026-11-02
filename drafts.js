const key = id => `norn.input.${id}`;
export function readDraft(id) { try { return id ? localStorage.getItem(key(id)) || '' : ''; } catch { return ''; } }
export function writeDraft(id, text) {
  if (!id) return;
  try { if (text) localStorage.setItem(key(id), text); else localStorage.removeItem(key(id)); } catch { /* Keep the text in the input if storage is full. */ }
}
