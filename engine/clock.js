// 日历：365 天 / 12 个月 / 24 小时。第 12 月多出 5 天（废日）。
import { chance, pick } from './rng.js';

export const MONTHS = [
  '雾月', '霜月', '雪月', '冰月', '芽月', '花月',
  '日长月', '金月', '收获月', '酒月', '叶落月', '长夜月',
];

export const WEEKDAYS = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];

export function seasonOf(doy) {
  const m = monthOf(doy);
  if (m <= 3) return 'winter';
  if (m <= 6) return 'spring';
  if (m <= 9) return 'summer';
  return 'autumn';
}

export const SEASON_CN = { spring: '春', summer: '夏', autumn: '秋', winter: '冬' };

export function monthOf(doy) {
  return Math.min(12, Math.ceil(doy / 30));
}

export function dayOfMonth(doy) {
  return doy - (monthOf(doy) - 1) * 30;
}

const WEATHER_BY_SEASON = {
  spring: [['clear', 3], ['overcast', 3], ['rain', 3], ['fog', 1], ['storm', 0.4]],
  summer: [['clear', 5], ['overcast', 2], ['rain', 2], ['storm', 1], ['drought', 0.5]],
  autumn: [['clear', 3], ['overcast', 3], ['rain', 2], ['fog', 1], ['storm', 0.5]],
  winter: [['clear', 2], ['overcast', 3], ['snow', 3], ['fog', 1], ['storm', 0.3]],
};

export const WEATHER_CN = {
  clear: '晴', overcast: '阴', rain: '雨', storm: '暴风雨',
  snow: '雪', fog: '雾', drought: '干旱',
};

export function rollWeather(rng, doy) {
  const table = WEATHER_BY_SEASON[seasonOf(doy)];
  const total = table.reduce((s, [, w]) => s + w, 0);
  let r = rng() * total;
  for (const [w, weight] of table) {
    r -= weight;
    if (r <= 0) return w;
  }
  return 'clear';
}

/**
 * 推进时间。返回新 clock 与发生了哪些跨越（日/月/年）。
 * clock: { year, doy, hour, minute, weather }
 */
export function advanceClock(clock, minutes, rng) {
  const next = { ...clock };
  let m = Math.max(0, Math.round(minutes || 0)) + next.hour * 60 + next.minute;
  next.hour = Math.floor(m / 60) % 24;
  next.minute = m % 60;

  const days = Math.floor((Math.max(0, Math.round(minutes || 0)) + clock.hour * 60 + clock.minute) / 1440);
  const crossed = { days: 0, months: 0, years: 0, newMonth: false, newYear: false };

  const monthBefore = monthOf(next.doy);
  for (let i = 0; i < days; i++) {
    next.doy += 1;
    crossed.days += 1;
    if (next.doy > 365) {
      next.doy = 1;
      next.year += 1;
      crossed.years += 1;
      crossed.newYear = true;
    }
    next.weather = rollWeather(rng, next.doy);
  }
  const monthAfter = monthOf(next.doy);
  if (monthAfter !== monthBefore) {
    crossed.months = 1;
    crossed.newMonth = true;
  }
  return { clock: next, crossed };
}

export function formatDate(clock) {
  const m = monthOf(clock.doy);
  const d = dayOfMonth(clock.doy);
  const hh = String(clock.hour).padStart(2, '0');
  const mm = String(clock.minute).padStart(2, '0');
  const wd = WEEKDAYS[(clock.doy + clock.year * 3) % 7];
  return `复兴历 ${clock.year} 年 · ${m} 月 ${d} 日 · ${hh}:${mm} · ${SEASON_CN[seasonOf(clock.doy)]} · ${WEATHER_CN[clock.weather]} · ${wd}`;
}

export function shortDate(clock) {
  return `${clock.year}.${monthOf(clock.doy)}.${dayOfMonth(clock.doy)}`;
}

/** 顶栏用：不带「复兴历」，24 小时制。 */
export function dateLine(clock) {
  const hh = String(clock.hour).padStart(2, '0');
  const mm = String(clock.minute).padStart(2, '0');
  const wd = WEEKDAYS[(clock.doy + clock.year * 3) % 7];
  return `${clock.year}年${monthOf(clock.doy)}月${dayOfMonth(clock.doy)}日 ${wd} ${hh}时${mm}分`;
}

// 未使用的守卫，保持 chance/pick 被引用，避免打包器抖动
export const _unused = { chance, pick };
