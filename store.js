// 浏览器本地存档：localStorage。没有服务器，数据就在这台手机里。
const IDX = 'norn.index';
const SAVE = (id) => `norn.save.${id}`;
const MSGS = (id) => `norn.msgs.${id}`;

function readIndex() {
  try {
    return JSON.parse(localStorage.getItem(IDX) || '[]');
  } catch {
    return [];
  }
}

function writeIndex(list) {
  localStorage.setItem(IDX, JSON.stringify(list));
}

export function listSaves() {
  return readIndex()
    .map((id) => {
      const s = getSave(id);
      if (!s) return null;
      return {
        id,
        name: s.player?.name,
        age: s.player?.age,
        turn: s.turn,
        place: s.player?.location?.siteName,
        label: s.label || null,
        updatedAt: s.updatedAt || s.createdAt,
      };
    })
    .filter(Boolean)
    .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
}

export function getSave(id) {
  try {
    return JSON.parse(localStorage.getItem(SAVE(id)) || 'null');
  } catch {
    return null;
  }
}

export function putSave(state, messages) {
  state.updatedAt = new Date().toISOString();
  localStorage.setItem(SAVE(state.saveId), JSON.stringify(state));
  if (messages) localStorage.setItem(MSGS(state.saveId), JSON.stringify(messages.slice(-40)));
  const list = readIndex();
  if (!list.includes(state.saveId)) {
    list.unshift(state.saveId);
    writeIndex(list);
  }
}

export function getMessages(id) {
  try {
    return JSON.parse(localStorage.getItem(MSGS(id)) || '[]');
  } catch {
    return [];
  }
}

export function appendMessage(id, role, content) {
  const list = getMessages(id);
  list.push({ role, content });
  localStorage.setItem(MSGS(id), JSON.stringify(list.slice(-40)));
}

export function deleteSave(id) {
  localStorage.removeItem(SAVE(id));
  localStorage.removeItem(MSGS(id));
  writeIndex(readIndex().filter((x) => x !== id));
}

export function newId() {
  return 'sv_' + Math.random().toString(36).slice(2, 10);
}

/** 导出成文件 */
export function exportSave(state) {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `norn-${state.player?.name || 'save'}-${state.saveId}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

/** 从文件导入 */
export async function importSave(file) {
  const text = await file.text();
  const state = JSON.parse(text);
  if (!state?.player?.name || !state?.clock) throw new Error('不是有效的存档');
  state.saveId = newId();
  state.createdAt = new Date().toISOString();
  state.label = state.label || '导入的存档';
  putSave(state, []);
  return state.saveId;
}
