import { parsePriceEntry } from './engine/economy.js';

export function priceBounds(value) {
  const price = parsePriceEntry(value);
  return typeof price === 'number' ? { min: price, max: price } : { min: price?.min ?? '', max: price?.max ?? '' };
}

/** Empty bounds remove an entry; malformed bounds never mean deletion. */
export function readPriceBounds(lower, upper) {
  const read = (raw, label) => {
    const text = String(raw ?? '').trim();
    if (!text) return null;
    const value = Number(text);
    if (!/^\d+$/.test(text) || !Number.isSafeInteger(value) || value <= 0) throw new Error(`${label}请输入正整数铜币`);
    return value;
  };
  const min = read(lower, '下限'), max = read(upper, '上限');
  if (min == null && max == null) return null;
  if (min != null && max != null && min > max) throw new Error('下限不能高于上限');
  return min === max ? min : { min, max };
}
