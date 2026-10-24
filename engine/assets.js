// 资产：产业、牲畜、存货。以前它们全挤在 player.assets 的字符串数组里，
// 引擎一件也算不了；现在分开存，产业按月出账。
//
// 产业不收维护费（按作者要求）：monthly 是月净收益，单位铜，直接计入指定账户。
// 这些是玩家个人财产，默认进「随身」（cash），不进家族账户。

import { addCopper, copperText } from './money.js';
import { toNumber } from './items.js';

const isIndustry = (s) => /工坊|分厂|厂|铺|店|商号|商会|产业|庄园|矿|船队|商队/.test(s);
const isStock = (s) => /皮货|存货|存粮|库存/.test(s);
const isLivestock = (s) => /马|牛|羊|猪|鸡|鹅|鸭|牲畜|骡|驴/.test(s);

/** 交通工具：马、车、船这类代步的。 */
export const isVehicle = (s) => /马|马车|车|船|舟|雪橇|驮兽|骆驼/.test(String(s || ''));

/** 存货旧名 → 新名。 */
const STOCK_ALIASES = { 家中存粮: '小麦', 存粮: '小麦' };

/** "皮货：牛皮 10、羊皮 7" / "枣红马一匹" → [{name, qty}] */
function parseStockText(text) {
  const s = String(text || '');
  const body = s.includes('：') ? s.slice(s.indexOf('：') + 1) : s;
  const out = [];
  for (const part of body.split(/[、,，]/)) {
    const p = part.trim();
    if (!p) continue;
    const m = p.match(/^(.+?)\s*([0-9]+|[一二两三四五六七八九十])\s*(张|匹|石|袋|件|头|只|批|份|些)?$/) || p.match(/^(.+)$/);
    if (!m) continue;
    const name = m[1].trim();
    const qty = m[2] ? toNumber(m[2]) : 1;
    out.push({ name, qty });
  }
  return out;
}

/** 老存档迁移：把 assets 字符串拆进 industries / vehicles / stock。幂等。 */
export function ensureAssets(state) {
  const p = state.player;
  if (!Array.isArray(p.industries)) p.industries = [];
  if (!Array.isArray(p.vehicles)) p.vehicles = [];
  if (!Array.isArray(p.livestock)) p.livestock = [];
  if (!Array.isArray(p.stock)) p.stock = [];

  const pushTo = (list, name, qty) => {
    const found = list.find((x) => x.name === name);
    if (found) found.qty += qty;
    else list.push({ name, qty });
  };
  const pushStock = (name, qty) => pushTo(p.stock, STOCK_ALIASES[name] || name, qty);

  // 旧的「牲畜」拆开：马/车/船 → 交通工具，其余（猪牛羊鸡鸭）→ 存货
  if (p.livestock.length) {
    const left = [];
    for (const row of p.livestock) {
      if (isVehicle(row.name)) pushTo(p.vehicles, row.name, row.qty);
      else pushStock(row.name, row.qty);
    }
    p.livestock = left;
  }

  // 存货旧名统一：家中存粮 → 小麦（重名就合并数量）
  if (p.stock.length) {
    const merged = [];
    for (const row of p.stock) {
      const name = STOCK_ALIASES[row.name] || row.name;
      const hit = merged.find((x) => x.name === name);
      if (hit) hit.qty += row.qty;
      else merged.push({ name, qty: row.qty });
    }
    p.stock = merged;
  }

  if (!Array.isArray(p.assets) || p.assets.length === 0) return p;

  const rest = [];
  for (const raw of p.assets) {
    const s = String(raw || '').trim();
    if (!s) continue;
    if (isIndustry(s)) {
      const name = s.replace(/（[^）]*）/g, '').trim();
      if (!p.industries.some((x) => x.name === name)) {
        p.industries.push({ id: `ind_${p.industries.length}`, name, monthly: 0, account: 'home' });
      }
    } else if (isStock(s)) {
      for (const it of parseStockText(s)) pushStock(it.name, it.qty);
    } else if (isLivestock(s)) {
      for (const it of parseStockText(s)) {
        if (isVehicle(it.name)) pushTo(p.vehicles, it.name, it.qty);
        else pushStock(it.name, it.qty);
      }
    } else {
      rest.push(s);
    }
  }
  p.assets = rest;
  return p;
}

export function assetsText(state) {
  const p = state.player;
  const parts = [];
  if (p.industries?.length) parts.push(`产业：${p.industries.map((i) => i.name).join('、')}`);
  if (p.vehicles?.length) parts.push(`交通工具：${p.vehicles.map((i) => `${i.name}×${i.qty}`).join('、')}`);
  if (p.stock?.length) parts.push(`存货：${p.stock.map((i) => `${i.name}×${i.qty}`).join('、')}`);
  if (p.assets?.length) parts.push(`其他：${p.assets.join('、')}`);
  return parts.join(' ｜ ');
}

/** 产业按月结算（没有维护费）。 */
export function runIndustries(state, months) {
  const out = [];
  const list = state.player.industries || [];
  if (!months || months <= 0 || !list.length) return out;
  for (const ind of list) {
    const monthly = Math.round(Number(ind.monthly) || 0);
    if (!monthly) continue;
    const pay = monthly * months;
    const account = ind.account || 'workshop';
    if (!addCopper(state, account, pay)) continue;
    const acc = (state.player.accounts || []).find((a) => a.id === account || a.name === account);
    out.push({ level: 'local', text: `${ind.name}结账：${copperText(pay)}，进「${acc ? acc.name : account}」。` });
  }
  return out;
}
