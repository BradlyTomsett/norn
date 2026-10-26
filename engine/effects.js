const now = state => state.clock.year * 365 * 1440 + (state.clock.doy - 1) * 1440 + state.clock.hour * 60 + state.clock.minute;
export function activeEffects(state) {
  return (state.player.effects || []).filter(effect => effect.expiresAt > now(state));
}
export function expireEffects(state) { state.player.effects = activeEffects(state); }
export function addEffect(state, effect, source) {
  const expiresAt = now(state) + effect.minutes, key = effect.key;
  state.player.effects ||= [];
  const old = state.player.effects.find(e => e.key === key);
  if (old) old.expiresAt = Math.max(old.expiresAt, expiresAt);
  else state.player.effects.push({ key, label: effect.label, source, expiresAt });
}
