// 装备/消耗品解析：把"长剑（紫）×2""药剂包（金疮药 49 / 回血 68）"这种自由文本
// 拆成引擎能记账的 { 名称, 品阶, 数量 }。

export const CN_NUM = { 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };

export function toNumber(text) {
  if (text == null) return 1;
  const s = String(text).trim();
  if (/^\d+$/.test(s)) return parseInt(s, 10);
  if (CN_NUM[s]) return CN_NUM[s];
  return 1;
}

const GRADE_RE = /（(灰|绿|蓝|紫|金)(?:[，,]\s*([^）]*))?）/;

/** "长剑（紫）×2" → { name:'长剑', grade:'紫', qty:2, label:'长剑（紫）' } */
export function parseItemEntry(raw) {
  const s = String(raw || '').trim();
  if (!s) return null;

  const m = s.match(GRADE_RE);
  const grade = m ? m[1] : '';
  const inside = m && m[2] ? m[2] : '';

  let rest = s.replace(/（(灰|绿|蓝|紫|金)(?:[，,]\s*[^）]*)?）/g, '').trim();

  let qty = 1;
  const times = rest.match(/[×xX*]\s*(\d+)/);
  if (times) {
    qty = parseInt(times[1], 10);
    rest = rest.replace(/[×xX*]\s*\d+/, '').trim();
  } else {
    const counted = rest.match(/([0-9]+|[一二两三四五六七八九十])\s*(支|把|个|瓶|张|件|枚|只|匹|头|本)/) || inside.match(/([0-9]+|[一二两三四五六七八九十])\s*(支|把|个|瓶|张|件|枚|只|匹|头|本)/);
    if (counted) {
      qty = toNumber(counted[1]);
      rest = rest.replace(counted[0], '').trim();
    }
  }

  const name = rest.replace(/[，,、]+$/, '').trim() || s;
  return { name, grade, qty, label: grade ? `${name}（${grade}）` : name };
}

/** "药剂包（金疮药 49 / 回血 68 / 磨刀石 / 店主的药盒）" → 容器 + 子项 */
export function parseContainer(raw) {
  const s = String(raw || '').trim();
  const inner = (s.match(/（([^）]*)）/) || [])[1];
  if (!inner) return [];
  return inner
    .split(/[/／、]/)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const m = part.match(/^(.+?)\s+(\d+)\s*(支|瓶|个|包|张)?$/) || part.match(/^(.+?)\s*(\d+)$/);
      if (m) return { name: m[1].trim(), qty: parseInt(m[2], 10) || 1 };
      return { name: part, qty: 1 };
    });
}

export function isContainer(name) {
  return /药剂包|药包|行囊|包裹/.test(String(name || ''));
}

/** 消耗品效果：只做能落到数值上的那几种，其余只扣数量。 */
export const CONSUMABLES = {
  金疮药: { health: 8, text: '敷上金疮药，血止住了' },
  回血药水: { health: 25, text: '灌下回血药水，脸色回来了些' },
  回血: { health: 25, text: '灌下回血药水，脸色回来了些' },
  清醒药: { text: '清醒药的苦味从舌根压下去，脑子清亮了' },
  气力: { text: '气力药下肚，胳膊又有了劲' },
  浮水: { text: '浮水药生效，可以在水面漂浮' },
  夜眼: { text: '夜眼药下去，暗处的轮廓清楚了些' },
};

export function effectOf(name) {
  const key = String(name || '').trim();
  if (CONSUMABLES[key]) return CONSUMABLES[key];
  const hit = Object.keys(CONSUMABLES).find((k) => key.includes(k));
  return hit ? CONSUMABLES[hit] : null;
}

/** 是不是药品/消耗品（用于界面归类）。 */
export function isConsumable(name) {
  const s = String(name || '');
  if (!s) return false;
  if (CONSUMABLES[s]) return true;
  if (Object.keys(CONSUMABLES).some((k) => s.includes(k))) return true;
  return /药|丹|膏|汤|散|丸|瓶|罐|烟|酸|清醒|气力|夜眼|回血|浮水/.test(s);
}

/* ---------------- 手动增减物品 ---------------- */

const GRADE_IN_NAME = /（(灰|绿|蓝|紫|金)(?:[，,]\s*[^）]*)?）/;

export function gradeOfName(name) {
  const m = String(name || '').match(GRADE_IN_NAME);
  return m ? m[1] : '';
}

/** 去掉名字里的「（紫）」这类品阶标记。 */
export function stripGrade(name) {
  return String(name || '')
    .replace(/（(灰|绿|蓝|紫|金)(?:[，,]\s*[^）]*)?）/g, '')
    .trim();
}

/** 名字 + 品阶 → 完整名；已经带品阶的原样返回。 */
export function composeName(base, grade) {
  const b = String(base || '').trim();
  if (!b) return '';
  if (!grade) return b;
  return gradeOfName(b) ? b : `${stripGrade(b)}（${grade}）`;
}

/** 加物品：带品阶的进装备；存货/牲畜按名字归位；其余进袋子。同名自动累加。 */
/** 粮食类：一律算存货。 */
export const GRAIN_RE = /小麦|大麦|麦子|大米|稻米|面粉|谷物|粮食/;

/** 同名合并：同一类里同名的只留一条，数量相加。 */
function dedupe(list) {
  const out = [];
  for (const row of list || []) {
    const hit = out.find((x) => x.name === row.name);
    if (hit) hit.qty += row.qty;
    else out.push({ ...row });
  }
  return out.filter((x) => x.qty > 0);
}

/**
 * 物品唯一化：一个名字在整份存档里只出现一次。
 * - 袋子里的粮食并入存货
 * - 各列表内同名合并
 */
export function normalizeItems(state) {
  const p = state.player;
  if (!Array.isArray(p.bag)) p.bag = [];
  if (!Array.isArray(p.stock)) p.stock = [];
  if (!Array.isArray(p.vehicles)) p.vehicles = [];

  for (const row of [...p.bag]) {
    if (!GRAIN_RE.test(row.name)) continue;
    const hit = p.stock.find((s) => s.name === row.name);
    if (hit) hit.qty += row.qty;
    else p.stock.push({ name: row.name, qty: row.qty });
    p.bag.splice(p.bag.indexOf(row), 1);
  }

  p.bag = dedupe(p.bag);
  p.stock = dedupe(p.stock);
  p.vehicles = dedupe(p.vehicles);
  return p;
}

export function addItem(state, name, qty = 1) {
  const p = state.player;
  const n = String(name || '').trim().slice(0, 40);
  if (!n) return { ok: false, reason: '名称是空的' };
  const count = Math.max(1, Math.round(Number(qty) || 1));

  if (gradeOfName(n)) {
    if (!Array.isArray(p.equipment)) p.equipment = [];
    for (let i = 0; i < count; i++) p.equipment.push(n);
    return { ok: true, where: 'equipment', count };
  }

  if (!Array.isArray(p.bag)) p.bag = [];

  const inStock = Array.isArray(p.stock) ? p.stock.find((s) => s.name === n) : null;
  if (inStock) {
    inStock.qty += count;
    return { ok: true, where: 'stock', count };
  }

  if (GRAIN_RE.test(n)) {
    if (!Array.isArray(p.stock)) p.stock = [];
    p.stock.push({ name: n, qty: count });
    return { ok: true, where: 'stock', count };
  }

  const inBag = p.bag.find((b) => b.name === n);
  if (inBag) {
    inBag.qty += count;
    return { ok: true, where: 'bag', count };
  }

  const inVehicle = Array.isArray(p.vehicles) ? p.vehicles.find((s) => s.name === n) : null;
  if (inVehicle) {
    inVehicle.qty += count;
    return { ok: true, where: 'vehicle', count };
  }

  // 新名字按语义归位：马/车/船 → 交通工具，猪牛羊鸡鸭 → 存货
  if (/马|车|船|舟|雪橇|驮兽|骆驼/.test(n)) {
    if (!Array.isArray(p.vehicles)) p.vehicles = [];
    p.vehicles.push({ name: n, qty: count });
    return { ok: true, where: 'vehicle', count };
  }
  if (/猪|牛|羊|鸡|鹅|鸭|牲畜|牲口/.test(n)) {
    if (!Array.isArray(p.stock)) p.stock = [];
    p.stock.push({ name: n, qty: count });
    return { ok: true, where: 'stock', count };
  }

  p.bag.push({ name: n, qty: count });
  return { ok: true, where: 'bag', count };
}

/** 减物品：袋子 → 装备 → 存货 → 牲畜。返回实际减掉多少。 */
export function removeItem(state, name, qty = 1) {
  const p = state.player;
  const n = String(name || '').trim();
  if (!n) return { ok: false, reason: '名称是空的' };
  const count = Math.max(1, Math.round(Number(qty) || 1));

  const bag = Array.isArray(p.bag) ? p.bag : [];
  const hit = bag.find((b) => b.name === n);
  if (hit) {
    const took = Math.min(hit.qty, count);
    hit.qty -= took;
    if (hit.qty <= 0) p.bag = bag.filter((b) => b !== hit);
    return { ok: true, where: 'bag', count: took };
  }

  const eq = Array.isArray(p.equipment) ? p.equipment : [];
  const idx = [];
  eq.forEach((e, i) => {
    if (e === n) idx.push(i);
  });
  if (idx.length) {
    const drop = idx.slice(0, count);
    p.equipment = eq.filter((_, i) => !drop.includes(i));
    return { ok: true, where: 'equipment', count: drop.length };
  }

  for (const [listKey, where] of [
    ['stock', 'stock'],
    ['vehicles', 'vehicle'],
    ['livestock', 'livestock'],
  ]) {
    const list = Array.isArray(p[listKey]) ? p[listKey] : [];
    const row = list.find((s) => s.name === n);
    if (!row) continue;
    const took = Math.min(row.qty, count);
    row.qty -= took;
    if (row.qty <= 0) p[listKey] = list.filter((s) => s !== row);
    return { ok: true, where, count: took };
  }

  return { ok: false, reason: `没有「${n}」` };
}
