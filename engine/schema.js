export const SCHEMA_VERSION = 2;
export const bounded = (v, lo, hi) => Math.max(lo, Math.min(hi, Number(v) || 0));
export const absoluteDay = (clock) => (Number(clock.year) || 0) * 365 + (Number(clock.doy) || 1) - 1;
export const absoluteMinute = (clock) => absoluteDay(clock) * 1440 + clock.hour * 60 + clock.minute;
export const cleanText = (v, max = 160) => String(v ?? '').trim().slice(0, max);
export const list = (v) => v == null ? [] : Array.isArray(v) ? v : [v];

/** Idempotent, lossless compatibility upgrade. Removed mechanics never influence new turns. */
export function upgradeState(state) {
  if (!state?.player || !state.clock) throw new Error('存档缺少人物或日历');
  const p = state.player;
  p.body = { health: bounded(p.body?.health ?? 100, 0, 100) };
  p.mind = { mood: cleanText(p.mind?.mood || '平静', 80) };
  for (const key of ['skills', 'relations', 'bag', 'equipment', 'assets', 'goals', 'problems', 'unfinished']) {
    if (!Array.isArray(p[key])) p[key] = [];
  }
  p.stats ||= { body: 10, agility: 10, wisdom: 10, spirit: 20 };
  for (const key of ['body', 'agility', 'wisdom', 'spirit', 'trainingCap']) {
    if (key in p.stats) p.stats[key] = Math.max(0, Number.isFinite(Number(p.stats[key])) ? Number(p.stats[key]) : 0);
  }
  for (const skill of p.skills) { skill.level = Math.max(0, Number(skill.level) || 0); skill.xp = Math.max(0, Number(skill.xp) || 0); }
  for (const key of ['bag', 'stock', 'vehicles']) for (const row of p[key] || []) row.qty = Math.max(0, Math.round(Number(row.qty) || 0));
  p.reputation ||= {};
  p.location ||= { siteId: state.world?.id || 'unknown', siteName: state.world?.name || '无名之地' };
  state.locations ||= {};
  if (state.world?.id && !state.locations[state.world.id]) state.locations[state.world.id] = { ...state.world };
  for (const r of p.relations) {
    r.trust = Math.round(bounded(r.trust, -100, 100) * 10) / 10;
    r.closeness = Math.round(bounded(r.closeness, -100, 100) * 10) / 10;
  }
  p.unfinished = p.unfinished.filter((row, index, rows) => rows.findIndex(x => x.text === row.text) === index);
  if (!Array.isArray(p.contracts)) p.contracts = [];
  if (p.contract && !p.contracts.some(c => c.id === p.contract.id || c.label === p.contract.label)) {
    p.contracts.push({ ...p.contract, id: p.contract.id || 'legacy-contract', status: 'active' });
  }
  const active = p.contracts.find(c => c.status === 'active');
  p.contract = active ? { ...active } : null;
  for (const key of ['npcs', 'knowledge', 'history', 'signals', 'worldLog', 'chronicle', 'consequences', 'storyLog']) {
    if (!Array.isArray(state[key])) state[key] = [];
  }
  state.processedEvents ||= {};
  state.flags ||= {};
  state.version = 'm2';
  state.schemaVersion = SCHEMA_VERSION;
  state.revision = Number(state.revision) || 0;
  state.lineageId ||= state.snapshotOf || state.saveId;
  return state;
}

/** Preserve callers' references while committing an already-validated copy. */
export function assignState(target, source) {
  for (const key of Object.keys(target)) if (!(key in source)) delete target[key];
  for (const [key, value] of Object.entries(source)) {
    if (value && typeof value === 'object') {
      if (!target[key] || typeof target[key] !== 'object' || Array.isArray(value) !== Array.isArray(target[key])) {
        target[key] = structuredClone(value);
      } else {
        assignState(target[key], value);
        if (Array.isArray(value)) target[key].length = value.length;
      }
    } else target[key] = value;
  }
  return target;
}
