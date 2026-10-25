// 钱的底层：账户、铜的换算。所有模块都从这里拿，避免互相引用。

export const n = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

export function copperTotal(w) {
  return Math.round(n(w?.gold) * 10000 + n(w?.silver) * 100 + n(w?.copper));
}

export function fromCopper(total) {
  let t = Math.max(0, Math.round(total));
  const gold = Math.floor(t / 10000);
  t -= gold * 10000;
  const silver = Math.floor(t / 100);
  t -= silver * 100;
  return { gold, silver, copper: t };
}

export function moneyText(w) {
  const g = n(w?.gold), s = n(w?.silver), c = n(w?.copper);
  const parts = [];
  if (g) parts.push(`${g} 金`);
  if (s) parts.push(`${s} 银`);
  if (c || parts.length === 0) parts.push(`${c} 铜`);
  return parts.join(' ');
}

export function copperText(c) {
  return moneyText(fromCopper(Math.round(c)));
}

export const DEFAULT_ACCOUNTS = [
  { id: 'cash', name: '随身', copper: 0 },
  { id: 'home', name: '家里', copper: 0 },
  { id: 'workshop', name: '产业', copper: 0 },
];

/** 老存档只有 wallet：迁移成 cash，其余账户从 0 起。 */
export function ensureAccounts(state) {
  const p = state.player;
  if (!Array.isArray(p.accounts) || p.accounts.length === 0) {
    const cash = p.wallet ? copperTotal(p.wallet) : 0;
    p.accounts = DEFAULT_ACCOUNTS.map((a) => ({ ...a, copper: a.id === 'cash' ? cash : 0 }));
  }
  const cash = p.accounts.find((a) => a.id === 'cash');
  p.wallet = fromCopper(cash ? cash.copper : 0);
  // 老存档里的「汽水工坊」账户统一改叫「产业」（id 不变，仍是 workshop）
  const ws = p.accounts.find((a) => a.id === 'workshop');
  if (ws && ws.name !== '产业') ws.name = '产业';
  return p.accounts;
}

/** 也接受中文账户名。 */
export function accountOf(state, key) {
  const list = ensureAccounts(state);
  const k = String(key || '').trim();
  return list.find((a) => a.id === k || a.name === k) || null;
}

export function addCopper(state, key, deltaCopper) {
  const a = accountOf(state, key);
  if (!a) return false;
  const d = Math.round(deltaCopper);
  a.copper = Math.max(0, a.copper + d);
  if (a.id === 'cash') state.player.wallet = fromCopper(a.copper);
  return true;
}

/** 「其他」是虚拟账户：转出去等于花掉，转进来等于白得一笔。 */
export const EXTERNAL = { id: 'other', name: '其他' };

function syncWallet(state) {
  const cash = state.player.accounts.find((x) => x.id === 'cash');
  if (cash) state.player.wallet = fromCopper(cash.copper);
}

/** 账户之间调钱：立刻完成，没有运输与手续费。 */
export function transferCopper(state, from, to, amount) {
  const want = Math.round(Number(amount) || 0);
  if (want <= 0 || from === to) return false;

  // 从「其他」进来：直接加钱
  if (from === EXTERNAL.id) {
    const b = accountOf(state, to);
    if (!b) return false;
    b.copper += want;
    syncWallet(state);
    return true;
  }

  // 转去「其他」：直接少钱
  if (to === EXTERNAL.id) {
    const a = accountOf(state, from);
    if (!a) return false;
    const amt = Math.min(a.copper, want);
    if (amt <= 0) return false;
    a.copper -= amt;
    syncWallet(state);
    return true;
  }

  const a = accountOf(state, from);
  const b = accountOf(state, to);
  if (!a || !b || a === b) return false;
  const amt = Math.min(a.copper, want);
  if (amt <= 0) return false;
  a.copper -= amt;
  b.copper += amt;
  syncWallet(state);
  return true;
}

export function accountsText(state) {
  const list = ensureAccounts(state);
  return list.map((a) => `${a.name} ${moneyText(fromCopper(a.copper))}`).join(' ｜ ');
}

export function totalCopper(state) {
  return ensureAccounts(state).reduce((s, a) => s + a.copper, 0);
}
