/** IndexedDB commits the state, message tail, checkpoint and draft together. */
export class ArchiveStore {
  constructor(factory = globalThis.indexedDB, name = 'norn.archive') { this.factory = factory; this.name = name; }
  async open() {
    this.db = await new Promise((resolve, reject) => {
      const request = this.factory.open(this.name, 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        db.createObjectStore('games', { keyPath: 'id' });
        db.createObjectStore('messages', { keyPath: ['saveId', 'index'] }).createIndex('saveId', 'saveId');
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error('请关闭旧的游戏页面后重试读取存档。'));
    });
    this.db.onversionchange = () => this.db.close();
    return this;
  }
  list() { return this.read('games', store => store.getAll()); }
  get(id) { return this.read('games', store => store.get(id)); }
  messages(id) { return this.read('messages', store => store.index('saveId').getAll(id)).then(rows => rows.map(row => row.message)); }
  read(name, makeRequest) {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(name, 'readonly'), request = makeRequest(tx.objectStore(name));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }
  commit(id, { state, expectedRevision, patch = {}, tail, migration = false, remove = false } = {}) {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(['games', 'messages'], 'readwrite'), games = tx.objectStore('games');
      let result, failure;
      tx.oncomplete = () => resolve(result);
      tx.onabort = tx.onerror = () => reject(failure || tx.error || new Error('本机保存未完成，原进度已保留。'));
      const request = games.get(id);
      request.onsuccess = () => {
        try {
          const old = request.result;
          if (old?.deleted && !remove) throw new Error('这份存档已被删除，请重新载入存档列表。');
          if (expectedRevision != null && (Number(old?.state?.revision) || 0) !== expectedRevision) throw new Error('这份存档已在另一个页面更新，请重新载入或另存分支');
          result = { ...old, ...structuredClone(patch), id };
          if (state) {
            result.state = structuredClone(state);
            result.state.revision = migration ? Number(state.revision) || 0 : (Number(old?.state?.revision) || 0) + 1;
            result.state.updatedAt = migration ? state.updatedAt : new Date().toISOString();
          }
          const messages = tx.objectStore('messages');
          if (tail) {
            messages.delete(IDBKeyRange.bound([id, tail.start], [id, Number.MAX_SAFE_INTEGER]));
            tail.messages.forEach((message, offset) => messages.put({ saveId: id, index: tail.start + offset, message }));
            result.messageCount = tail.start + tail.messages.length;
          }
          if (remove) {
            messages.delete(IDBKeyRange.bound([id, 0], [id, Number.MAX_SAFE_INTEGER]));
            result = { id, deleted: true };
          }
          games.put(result);
        } catch (error) { failure = error; tx.abort(); }
      };
    });
  }
  close() { this.db?.close(); }
}
