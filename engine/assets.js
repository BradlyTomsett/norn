// 资产：产业、牲畜、存货。以前它们全挤在 player.assets 的字符串数组里，
// 引擎一件也算不了；现在分开存，产业按月出账。
//
// 产业不收维护费（按作者要求）：monthly 是月净收益，直接计入指定账户。

import { addCopper, copperText } from './money.js';
import { toNumber } from './items.js';

const isIndustry = (s) => /工坊|分厂|厂|铺|店|商号|商会|产业|庄园|矿|船队|商队/.test(s);
const isStock = (s) => /皮货|存货|存粮|库存/.test(s);
const isLivestock = (s) => /马|牛|羊|猪|鸡|鹅|鸭|牲畜|骡|驴/.test(s);

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

/** 老存档迁移：把 assets 字符串拆进 industries / livestock / stock。幂等。 */
export function ensureAssets(state) {
  const p = state.player;
  if (!Array.isArray(p.industries)) p.industries = [];
  if (!Array.isArray(p.livestock)) p.livestock = [];
  if (!Array.isArray(p.stock)) p.stock = [];
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
      for (const it of parseStockText(s)) {
        const found = p.stock.find((x) => x.name === it.name);
        if (found) found.qty += it.qty;
        else p.stock.push({ name: it.name, qty: it.qty });
      }
    } else if (isLivestock(s)) {
      for (const it of parseStockText(s)) {
        const found = p.livestock.find((x) => x.name === it.name);
        if (found) found.qty += it.qty;
        else p.livestock.push({ name: it.name, qty: it.qty });
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
  if (p.livestock?.length) parts.push(`牲畜：${p.livestock.map((i) => `${i.name}×${i.qty}`).join('、')}`);
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
    const account = ind.account || 'home';
    if (!addCopper(state, account, pay)) continue;
    out.push({ level: 'local', text: `${ind.name}结账：${copperText(pay)}，进「${account === 'home' ? '家里' : '随身'}」。` });
  }
  return out;
}
