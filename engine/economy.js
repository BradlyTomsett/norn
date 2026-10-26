// 游戏物价：AI 生成报价的公共参考。存档物价只补充这里未收录的条目。
// 实际成交按 AI 与玩家谈定并提交的金额结算；以下算法用于没有报价时的兜底。
//
// 覆盖任意商品的办法是三层归并，而不是穷举商品表：
//   1. 关键词归到「类目」，每个类目有一个锚定价；
//   2. 名字里的材质、品阶（灰绿蓝紫金）、特殊名号乘系数；
//   3. 乘以世界物价指数。
// 表里没有的东西不会"无价"——它会被归到最接近的类目，实在认不出就进「杂物」。
//
// 少数日常物价差得太远的物件（药水、战马、皮革）走 NAMED 精确价，命中就直接用，
// 不再叠材质/品阶，避免"金疮药被当成药剂乘品阶"这种事。
//
// 类目、材质和品阶提供估价依据，不把参考区间自动变成固定成交价。

import { int } from './rng.js';
import { isRetiredPostalQuote } from './retired-prices.js';

export const GRADES = ['灰', '绿', '蓝', '紫', '金'];
// 灰：老百姓都用；绿：普通人能见到的顶配；蓝：城主级，一个城里没几件；
// 紫：S 级冒险者、国王、公爵才可能有一件；金：传说，多数人没听说过。
export const GRADE_MUL = { 灰: 1, 绿:4, 蓝: 82, 紫: 1120, 金: 21525 };

// 锚定价单位：铜。1 金 = 100 银 = 10000 铜。
export const CATS = {
  staple: { name: '主食', base: 1, unit: '份' },
  food: { name: '熟食', base: 3, unit: '份' },
  meat: { name: '肉食', base: 15, unit: '份' },
  drink: { name: '酒水', base: 3, unit: '杯' },
  spice: { name: '香料', base: 60, unit: '两' },
  cloth: { name: '布料', base: 12, unit: '匹' },
  clothing: { name: '成衣', base: 25, unit: '件' },
  hide: { name: '生皮', base: 8, unit: '张' },
  leather: { name: '熟皮', base: 25, unit: '张' },
  tool: { name: '工具', base: 60, unit: '件' },
  metal: { name: '金属料', base: 25, unit: '斤' },
  weapon: { name: '武器', base: 350, unit: '件' },
  armor: { name: '护甲', base: 900, unit: '件' },
  missile: { name: '箭矢', base: 1, unit: '支' },
  medicine: { name: '药', base: 60, unit: '份' },
  potion: { name: '药剂', base: 250, unit: '瓶' },
  poultry: { name: '家禽', base: 30, unit: '只' },
  pig: { name: '猪', base: 700, unit: '头' },
  sheep: { name: '羊', base: 900, unit: '只' },
  cattle: { name: '牛', base: 12000, unit: '头' },
  horse: { name: '马', base: 6000, unit: '匹' },
  mount: { name: '驮畜', base: 3000, unit: '匹' },
  livestock: { name: '牲畜', base: 800, unit: '头' },
  lodging: { name: '住店', base: 3, unit: '晚' },
  travel: { name: '路费', base: 20, unit: '程' },
  service: { name: '服务', base: 8, unit: '次' },
  fuel: { name: '燃料', base: 3, unit: '捆' },
  ore: { name: '矿石', base: 10, unit: '斤' },
  jewelry: { name: '首饰', base: 900, unit: '件' },
  luxury: { name: '奢侈品', base: 300, unit: '件' },
  book: { name: '书籍', base: 150, unit: '本' },
  charm: { name: '符纸', base: 150, unit: '张' },
  field: { name: '田地', base: 5000, unit: '亩' },
  house_rural: { name: '乡村住宅', base: 40000, unit: '处' },
  house_city: { name: '城市住宅', base: 250000, unit: '处' },
  shop: { name: '商铺', base: 500000, unit: '间' },
  villa: { name: '别墅', base: 1500000, unit: '处' },
  manor: { name: '庄园', base: 8000000, unit: '处' },
  property: { name: '不动产', base: 250000, unit: '处' },
  misc: { name: '杂物', base: 20, unit: '件' },
};

// 精确价：命中就用这个数（再乘物价指数），不叠材质与品阶。
const NAMED = [
  // 粮食（按袋）
  [/小麦|大米|稻米/, 40],
  // 药与炼金
  [/金疮药/, 5],
  [/回血药水|回血药/, 200],
  [/清醒药/, 300],
  [/浮水/, 500],
  [/气力/, 500],
  [/夜眼药|夜眼/, 500],
  [/火油罐/, 40],
  [/烟丸/, 25],
  [/酸液瓶/, 80],
  // 马与大型牲口
  [/战马|军马/, 80000],
  [/骏马|良驹/, 25000],
  [/耕牛/, 15000],
  [/奶牛/, 15000],
  [/牛犊|小牛/, 4000],
  [/羊羔|羔羊/, 300],
  [/猪崽|小猪/, 150],
  [/雏鸡|小鸡|鸡雏|雏鸭|雏鹅|幼禽/, 2],
  // 皮革（按来源分价）
  [/生皮|毛皮/, 8],
  [/牛皮/, 60],
  [/鹿皮/, 40],
  [/羊皮/, 25],
  [/狼皮/, 40],
  [/野猪皮/, 60],
  [/鳄鱼皮/, 200],
  [/熊皮/, 300],
  [/虎皮/, 1500],
  [/狐皮|貂皮/, 100],
];

const NAMED_NO_BAG = new Set(['property']);

// 先匹配的赢。顺序从"最具体"到"最泛"。
const CAT_RULES = [
  ['missile', /箭|矢|弩矢|弹丸|投石/],
  ['potion', /药剂|药水|灵药|魔药|丹|膏药/],
  ['medicine', /药|草药|药材|绷带/],
  ['armor', /甲|盔|盾|护腕|护腿|锁子|板甲|胸甲|头盔/],
  ['weapon', /剑|刀|斧|锤|矛|枪|戟|匕首|长弓|弓|弩|棍|杖|镰|镖|鞭/],
  ['meat', /肉|鱼|禽/],
  ['horse', /马/],
  ['cattle', /牛/],
  ['sheep', /羊/],
  ['pig', /猪/],
  ['poultry', /鸡|鸭|鹅/],
  ['mount', /骡|驴|骆驼|驮兽/],
  ['livestock', /牲畜|牲口/],
  ['jewelry', /戒指|项链|耳环|手镯|宝石|珠|翡翠|玛瑙/],
  ['luxury', /丝|绸|香水|地毯|瓷器|象牙|珊瑚|琉璃/],
  ['spice', /盐|胡椒|桂皮|香料|豆蔻|丁香/],
  ['cloth', /布|麻|羊毛|纱|绒/],
  ['clothing', /衣|袍|裤|裙|鞋|靴|帽|斗篷|披风|手套|围巾/],
  ['hide', /生皮|毛皮|兽皮/],
  ['leather', /皮革|鞣皮|熟皮|皮料/],
  ['tool', /锯|钳|铲|锄|工具|凿|锉|秤/],
  ['metal', /铁锭|钢锭|铜锭|银锭|金锭|金属|铁料|钢料|锭/],
  ['ore', /矿石|矿|煤|石料/],
  ['fuel', /柴|炭|薪|油灯|灯油/],
  ['book', /书|卷|图|地图|册/],
  ['charm', /符|护符|圣徽|念珠/],
  ['manor', /庄园|城堡/],
  ['villa', /别墅|别院|宅邸/],
  ['shop', /铺|店面|商铺|作坊/],
  ['house_rural', /乡村住宅|农村住宅|农舍|土屋|茅屋|木屋/],
  ['house_city', /住宅|宅|公寓|楼房|院子|房产|地产/],
  ['field', /田|地契|土地|亩|耕地/],
  ['property', /不动产/],
  ['lodging', /住店|通铺|客房|房钱|宿/],
  ['travel', /车|船|渡|路费|脚钱|驮/],
  ['service', /工钱|雇|请人|服务|杂役/],
  ['drink', /酒|麦酒|葡萄酒|烈酒|陈酿|茶/],
  ['food', /汤|粥|炖|饭|菜|食|饼|馒头|包子/],
  ['staple', /面包|面|麦|米|粮|谷/],
];

const MATERIAL_MUL = [
  [/秘银|精金|星辰铁/, 60],
  [/陨铁|玄铁/, 25],
  [/精钢|百炼/, 4],
  [/钢/, 2.5],
  [/银/, 6],
  [/金/, 20],
  [/铁/, 1.2],
  [/铜|青铜/, 0.8],
  [/橡木|硬木|榆木/, 0.8],
  [/木/, 0.6],
  [/皮|革/, 1],
  [/丝/, 4],
  [/布|麻/, 0.5],
  [/陶|瓷/, 1.4],
];

const SPECIAL_MUL = [
  [/古董|传家|祖传/, 2],
  [/秘制|大师/, 3],
];

const NO_BAG = new Set([
  'lodging',
  'travel',
  'service',
  'property',
  'field',
  'house_rural',
  'house_city',
  'shop',
  'villa',
  'manor',
]);

export function detectGrade(name) {
  const m = String(name || '').match(/（(灰|绿|蓝|紫|金)）|\((灰|绿|蓝|紫|金)\)/);
  return m ? m[1] || m[2] : '';
}

function mulOf(table, name) {
  for (const [re, mul] of table) if (re.test(name)) return mul;
  return 1;
}

function namedPrice(name) {
  for (const [re, price] of NAMED) if (re.test(name)) return price;
  return null;
}

/** 这件东西在 economy.js 里已经钉死了价（固定价），存档表里不该再出现。 */
export function fixedPriceOf(name) {
  return namedPrice(String(name || '')) || 0;
}

export function classify(name, hint) {
  const s = String(name || '');
  if (hint && CATS[hint]) return hint;
  for (const [cat, re] of CAT_RULES) if (re.test(s)) return cat;
  return 'misc';
}

/**
 * 算一件（一份）东西的价格。
 * @returns {{cat:string, unit:number, total:number, grade:string, noBag:boolean}}
 */
export function priceOf(state, name, opts = {}) {
  const qty = Math.max(1, Math.round(Number(opts.qty) || 1));
  const key = String(name || '').trim();
  const cat = classify(name, opts.cat);
  const info = CATS[cat] || CATS.misc;
  const grade = detectGrade(name) || (GRADES.includes(opts.grade) ? opts.grade : '');
  const priceIndex = Number(state?.world?.priceIndex) || 1;

  const game = gamePriceEntry(key);
  // A save supplements game references; it never duplicates a known game entry.
  const saved = game == null && !isRetiredPostalQuote(key, state?.prices?.[key]) ? priceEntryValue(state?.prices?.[key]) : 0;
  if (saved > 0) {
    return { cat, unit: saved, total: saved * qty, grade, noBag: NO_BAG.has(cat), custom: true, source: 'saved' };
  }

  const named = namedPrice(name);
  if (named) {
    // NAMED 是作者钉死的绝对价（金疮药 5 铜就是 5 铜），不随物价指数浮动
    const unit = Math.max(1, Math.round(named));
    return { cat, unit, total: unit * qty, grade, noBag: NO_BAG.has(cat) || NAMED_NO_BAG.has(cat), source: 'named' };
  }
  if (game != null) {
    const unit = Math.max(1, Math.round(priceEntryValue(game) * priceIndex));
    return { cat, unit, total: unit * qty, grade, noBag: NO_BAG.has(cat), source: 'game' };
  }

  // 品阶只用于武器与护甲（见 rules.md 第八条）；工具、首饰、奢侈品只按材质定价
  const gradeMul = grade && ['weapon', 'armor'].includes(cat) ? GRADE_MUL[grade] : 1;
  const matMul = ['weapon', 'armor', 'tool', 'metal', 'jewelry', 'missile'].includes(cat)
    ? mulOf(MATERIAL_MUL, name)
    : 1;
  const specialMul = mulOf(SPECIAL_MUL, name);
  const unit = Math.max(1, Math.round(info.base * gradeMul * matMul * specialMul * priceIndex));
  return { cat, unit, total: unit * qty, grade, noBag: NO_BAG.has(cat), source: 'table' };
}

/* ---------------- 存档内的自定价表 ---------------- */

export const PRICE_MIN = 1;
export const PRICE_MAX = 500000000;

/** 价格条目：数字（固定价）或 {min,max}（范围，任一端可为 null 表示无下限/无上限）。 */
export function parsePriceEntry(entry) {
  if (entry == null) return null;
  if (typeof entry === 'number') return Number.isFinite(entry) && entry > 0 ? Math.round(entry) : null;
  if (typeof entry === 'string') {
    const v = Number(entry);
    return Number.isFinite(v) && v > 0 ? Math.round(v) : null;
  }
  if (typeof entry === 'object') {
    const min = entry.min == null || entry.min === '' ? null : Math.round(Number(entry.min));
    const max = entry.max == null || entry.max === '' ? null : Math.round(Number(entry.max));
    const lo = min != null && Number.isFinite(min) && min > 0 ? min : null;
    const hi = max != null && Number.isFinite(max) && max > 0 ? max : null;
    if (lo == null && hi == null) return null;
    return { min: lo, max: hi };
  }
  return null;
}

/** 引擎兜底时用的单价：固定价直接取，范围取中间值。 */
export function priceEntryValue(entry) {
  const p = parsePriceEntry(entry);
  if (p == null) return 0;
  if (typeof p === 'number') return p;
  if (p.min != null && p.max != null) return Math.round((p.min + p.max) / 2);
  return p.min ?? p.max ?? 0;
}

/** 给界面/提示词看的写法：1200 / 800–1500 / 800 起 / 1500 以内 */
export function priceEntryText(entry) {
  const p = parsePriceEntry(entry);
  if (p == null) return '';
  if (typeof p === 'number') return String(p);
  if (p.min != null && p.max != null) return `${p.min}–${p.max}`;
  if (p.min != null) return `${p.min} 起`;
  return `${p.max} 以内`;
}

/** 把一件东西的价格记进存档（已有就不覆盖，除非 force）。 */
export function learnPrice(state, name, copper, { force = false } = {}) {
  // Public game references are shown directly, never copied into a save.
  const key = String(name || '').trim().slice(0, 40);
  const v = Math.round(Number(copper));
  if (!key || !Number.isFinite(v) || v < PRICE_MIN || v > PRICE_MAX) return false;
  if (isRetiredPostalQuote(key, v)) return false;
  if (gamePriceEntry(key) != null) return false;
  if (!state.prices || typeof state.prices !== 'object') state.prices = {};
  if (state.prices[key] && !force) return false;
  state.prices[key] = v;
  return true;
}

/** 玩家手动改价。 */
export function setPrice(state, name, copper) {
  return learnPrice(state, name, copper, { force: true });
}



/* ---------------- 给 AI 看的自带价参考 ---------------- */

/** 引擎自带价 + 类目基准，塞进提示词让 AI 报价时有个准头。 */
export function builtinReferenceText(query = '') {
  const cats = Object.values(CATS)
    .map((c) => `${c.name} ${c.base}/${c.unit}`)
    .join(' ');
  let references = gameReferenceRows();
  if (query) {
    const words = new Set(String(query).match(/[A-Za-z0-9]+|[\u4e00-\u9fff]{2}/g) || []);
    for (const run of String(query).match(/[\u4e00-\u9fff]+/g) || []) for (let i = 0; i < run.length - 1; i++) words.add(run.slice(i, i + 2));
    const ranked = references.map(row => ({ row, score: [...words].reduce((n, word) => n + (row.name.includes(word) ? 1 : 0), 0) })).filter(r => r.score > 0).sort((a, b) => b.score - a.score);
    references = [...new Map([...references.filter(r => /黑面包|熟食|单间|通铺|干粮/.test(r.name)), ...ranked.slice(0, 16).map(r => r.row)].map(row => [row.name, row])).values()];
  }
  return [
    '【游戏物价】（来自 economy.js，供 AI 生成价格参考；不重复写入存档。以下均为铜。）',
    ...references.map(row => `  · ${row.kind}：${row.name} ${priceEntryText(row.entry)} 铜`),
    `【类目基准】（没有具体条目时估价，按所列单位，再参考材质与品阶）${cats}`,
    `【材质倍率】${MATERIAL_MUL.map(([re, value]) => `${re.source.replaceAll('|', '/')}×${value}`).join('；')}`,
    `【特殊名号倍率】${SPECIAL_MUL.map(([re, value]) => `${re.source.replaceAll('|', '/')}×${value}`).join('；')}`,
    `【品阶倍率】灰1 绿4 蓝82 紫1120 金21525（只作用于武器与护甲）`,
  ].join('\n');
}
/* ---------------- 游戏内常见物价与活计参考：不自动复制到存档 ---------------- */

export const DEFAULT_PRICES = {
  // 吃食
  黑面包: 1,
  白面包: { min: 3, max: 6 },
  '熟食（汤/炖菜）': { min: 2, max: 4 },
  '麦酒（一杯）': { min: 2, max: 4 },
  '葡萄酒（一杯）': { min: 4, max: 8 },
  咸肉: { min: 5, max: 15 },
  奶酪: { min: 3, max: 8 },
  '鸡蛋（十个）': { min: 2, max: 5 },
  '面粉（一袋）': { min: 60, max: 90 },
  '盐（一斤）': { min: 8, max: 20 },
  '蜂蜜（一罐）': { min: 50, max: 200 },
  '根菜（一筐）': { min: 1, max: 4 },
  '干粮（一天）': 2,
  // 住店与杂项
  '通铺一晚': { min: 2, max: 3 },
  '单间一晚': { min: 6, max: 20 },
  '马厩一晚': { min: 4, max: 8 },
  洗澡: { min: 2, max: 5 },
  洗衣: { min: 1, max: 3 },
  '渡船（一次）': { min: 2, max: 10 },
  '驿车（一站）': { min: 50, max: 200 },
  // 工具与杂物
  火把: { min: 1, max: 3 },
  火石: { min: 5, max: 15 },
  油灯: { min: 20, max: 60 },
  灯油: { min: 5, max: 12 },
  水囊: { min: 8, max: 25 },
  背包: { min: 30, max: 80 },
  毯子: { min: 20, max: 60 },
  铁锅: { min: 15, max: 40 },
  磨刀石: { min: 5, max: 15 },
  '绳索（十米）': { min: 10, max: 30 },
  // 衣物
  粗布衣: 10,
  '羊毛外套': { min: 60, max: 150 },
  '皮靴': { min: 80, max: 200 },
  斗篷: { min: 50, max: 120 },
  // 武器护甲（普通品阶）
  '匕首（灰）': { min: 200, max: 600 },
  '长剑（灰）': { min: 600, max: 1500 },
  '手斧（灰）': { min: 400, max: 900 },
  '皮甲（灰）': { min: 800, max: 2000 },
  '圆盾（灰）': { min: 500, max: 1200 },
  // 皮货与牲口
  '马车': { min: 8000, max: 35000 },
  '鸡（只）': { min: 20, max: 60 },
  '羊（只）': { min: 800, max: 2000 },
  '猪（头）': { min: 600, max: 1500 },
  '牛（头）': { min: 8000, max: 15000 },
};

export const DEFAULT_RATES = {
  '跑腿 / 捎话 / 送信': { min: 1, max: 300 },
  '打杂 / 帮工（一天）': { min: 50, max: 300 },
  '带路 / 向导': { min: 50, max: 600 },
  '盯梢 / 打听消息': { min: 80, max: 1500 },
  '卖消息 / 情报': { min: 80, max: 1800 },
  '抄写 / 代笔': { min: 4, max: 80 },
  '卖艺 / 表演': { min: 1, max: 200 },
  '护送 / 押运': { min: 200, max: 80000 },
  '赌桌': { min: 1, max: 5000 },
  // 以下是我补的常见活计
  '修补衣物 / 补鞋': { min: 5, max: 300 },
  '打井 / 修屋顶': { min: 100, max: 3000 },
  '夜里守夜（一晚）': { min: 30, max: 400 },
  '教书 / 代写契约': { min: 10, max: 300 },
  '中介抽成': { min: 20, max: 2000 },
  '说媒 / 操办婚丧': { min: 100, max: 5000 },
  '看病 / 抓药': { min: 50, max: 800 },
  '喂马 / 刷马（一天）': { min: 20, max: 150 },
};

function referenceKey(name) {
  return String(name || '').trim().replace(/\s+/g, '')
    .replace(/[（(]([^）)]*)[）)]/g, (_, inner) => /^[灰绿蓝紫金]$/.test(inner) ? `（${inner}）` : '');
}
function tableReference(table, name) {
  const key = referenceKey(name);
  for (const [label, entry] of Object.entries(table)) {
    const aliases = referenceKey(label).split(/[\/／]/);
    if (referenceKey(label) === key || aliases.includes(key)) return entry;
  }
  return null;
}
/** Exact named entries and grouped aliases; broad category keywords are only estimation anchors. */
export function gamePriceEntry(name) {
  const named = namedPrice(String(name || ''));
  if (named) return named;
  const category = Object.values(CATS).find(c => referenceKey(c.name) === referenceKey(name));
  if (category) return category.base;
  const legacyRate = { '牙人': '中介抽成', '牙行': '中介抽成', '牙人/中介抽成': '中介抽成' };
  return tableReference(DEFAULT_PRICES, name) ?? tableReference(DEFAULT_RATES, legacyRate[referenceKey(name)] || name);
}
export function gameReferenceRows() {
  const rows = NAMED.map(([re, entry]) => ({ name: re.source.replaceAll('|', ' / '), entry, kind: '物品' }));
  for (const [name, entry] of Object.entries(DEFAULT_PRICES)) {
    if (namedPrice(name)) continue;
    const category = Object.values(CATS).find(c => referenceKey(c.name) === referenceKey(name));
    if (category) continue;
    rows.push({ name, entry, kind: '物品或服务' });
  }
  for (const [name, entry] of Object.entries(DEFAULT_RATES)) rows.push({ name, entry, kind: '活计' });
  return rows;
}
/* ---------------- 活计参考价（AI 报价的依据，也可被玩家改） ---------------- */

export const EARN_REF = [
  [/跑腿|捎话|送信|传话/, 300],
  [/打杂|帮工|做工|干一天/, 150],
  [/带路|向导|引路/, 600],
  [/盯梢|打听|探听|探消息/, 500],
  [/卖消息|情报|告密/, 800],
  [/抄写|代笔|写信|记账/, 400],
  [/卖艺|弹唱|表演|说书/, 200],
  [/商队|长途|远行|跨城/, 30000],
  [/护送|押运|保镖|护卫/, 8000],
  [/赌|押注|骰|牌局/, 1000],
];

/** 这一类活计的参考价。 */
export function earnRef(label) {
  const s = String(label || '');
  const hit = EARN_REF.find(([re]) => re.test(s));
  return hit ? hit[1] : 300;
}

/** References inform the AI; a supplied positive quote remains the agreed amount. */
export function earnAmount(state, label, copper) {
  const ref = rateOf(state, label) || earnRef(label);
  const v = Math.round(Number(copper) || 0);
  if (v <= 0) return { copper: ref, ref, clamped: false };
  return { copper: v, ref, clamped: false };
}

/** 记下这类活计的价（存档内，之后都按这个来）。 */
export function learnRate(state, label, copper, { force = false } = {}) {
  const key = String(label || '').trim().slice(0, 100);
  const v = Math.round(Number(copper));
  if (!key || !Number.isFinite(v) || v < PRICE_MIN || v > PRICE_MAX) return false;
  if (isRetiredPostalQuote(key, v)) return false;
  if (gamePriceEntry(key) != null) return false;
  if (!state.rates || typeof state.rates !== 'object') state.rates = {};
  if (state.rates[key] && !force) return false;
  state.rates[key] = v;
  return true;
}

export const SERVICE_RE = /送信|跑腿|打杂|帮工|带路|向导|盯梢|打听|卖消息|护送|押运|邮差|邮资|邮费|雇人|代笔|抄写/;

export const isService = (name) => SERVICE_RE.test(String(name || ''));

export function rateOf(state, label) {
  const saved = state?.rates?.[String(label || '').trim()];
  return priceEntryValue(gamePriceEntry(label) ?? (isRetiredPostalQuote(label, saved) ? null : saved));
}

export function priceText(state, name) {
  const p = priceOf(state, name);
  return { ...p, saved: Boolean(state?.prices?.[String(name || '').trim()]) };
}

/**
 * 卖出价：按作者要求，卖战利品与正常价目表同价，不折价。
 * 交涉技能仍保留在人物里，留给以后做"讨价还价"用。
 */
export function sellRatio() {
  return 1;
}

export function sellOf(state, name, opts = {}) {
  const p = priceOf(state, name, opts);
  return { ...p, total: Math.max(1, Math.round(p.total)) };
}

/** 赏金：冒险者没有固定收入，报酬按威胁等级由引擎开。 */
export const BOUNTY_RANGE = {
  1: [3000, 8000],
  2: [10000, 25000],
  3: [40000, 140000],
  4: [150000, 850000],
  5: [1600000, 5500000],
};

export function rollBounty(state, tier, rng) {
  const key = Math.min(5, Math.max(1, Math.round(Number(tier) || 1)));
  const [lo, hi] = BOUNTY_RANGE[key];
  const priceIndex = Number(state?.world?.priceIndex) || 1;
  return Math.round(int(rng, lo, hi) * priceIndex);
}
