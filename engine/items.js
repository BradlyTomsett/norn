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

/** "药剂包（金疮药 49 / 回血 68 / 磨刀石 / 吴掌柜药盒）" → 容器 + 子项 */
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
  清醒药: { stress: -15, text: '清醒药的苦味从舌根压下去，脑子清亮了' },
  气力: { fatigue: -20, text: '气力药下肚，胳膊又有了劲' },
  浮水: { fatigue: -5, text: '浮水药让身上的沉重轻了一点' },
  夜眼: { fatigue: -5, text: '夜眼药下去，暗处的轮廓清楚了些' },
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
