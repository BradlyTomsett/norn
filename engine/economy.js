// 定价：物品价格由引擎算，模型只说"买什么、卖什么、几件"，不许写金额。
//
// 覆盖任意商品的办法是三层归并，而不是穷举商品表：
//   1. 关键词归到「类目」（约 30 个），每个类目有一个锚定价；
//   2. 名字里的材质、品阶（灰绿蓝紫金）、特殊名号（战马、庄园）乘系数；
//   3. 乘以世界物价指数。
// 表里没有的东西不会"无价"——它会被归到最接近的类目，实在认不出就进「杂物」。
//
// 模型可以给 cat 提示（必须命中 CATS），但不能给价。

import { int } from './rng.js';

export const GRADES = ['灰', '绿', '蓝', '紫', '金'];
export const GRADE_MUL = { 灰: 1, 绿: 3.5, 蓝: 12, 紫: 120, 金: 1525 };

// 锚定价单位：铜。1 金 = 100 银 = 10000 铜。
export const CATS = {
  staple: { name: '主食', base: 1, unit: '份' },
  food: { name: '熟食', base: 3, unit: '份' },
  meat: { name: '肉食', base: 15, unit: '份' },
  drink: { name: '酒水', base: 3, unit: '杯' },
  spice: { name: '香料', base: 60, unit: '两' },
  cloth: { name: '布料', base: 12, unit: '匹' },
  clothing: { name: '成衣', base: 25, unit: '件' },
  leather: { name: '皮革', base: 15, unit: '件' },
  tool: { name: '工具', base: 60, unit: '件' },
  metal: { name: '金属料', base: 25, unit: '斤' },
  weapon: { name: '武器', base: 350, unit: '件' },
  armor: { name: '护甲', base: 900, unit: '件' },
  missile: { name: '箭矢', base: 1, unit: '支' },
  medicine: { name: '药', base: 60, unit: '份' },
  potion: { name: '药剂', base: 250, unit: '瓶' },
  livestock: { name: '牲畜', base: 120, unit: '头' },
  mount: { name: '坐骑', base: 2000, unit: '匹' },
  lodging: { name: '住店', base: 3, unit: '晚' },
  travel: { name: '路费', base: 20, unit: '程' },
  service: { name: '服务', base: 8, unit: '次' },
  fuel: { name: '燃料', base: 3, unit: '捆' },
  ore: { name: '矿石', base: 10, unit: '斤' },
  jewelry: { name: '首饰', base: 900, unit: '件' },
  luxury: { name: '奢侈品', base: 300, unit: '件' },
  book: { name: '书籍', base: 150, unit: '本' },
  charm: { name: '符纸', base: 150, unit: '张' },
  property: { name: '不动产', base: 200000, unit: '处' },
  misc: { name: '杂物', base: 20, unit: '件' },
};

// 先匹配的赢。顺序从"最具体"到"最泛"。
const CAT_RULES = [
  ['missile', /箭|矢|弩矢|弹丸|投石/],
  ['potion', /药剂|药水|灵药|魔药|丹|膏药/],
  ['medicine', /药|草药|药材|绷带|金创/],
  ['armor', /甲|盔|盾|护腕|护腿|锁子|板甲|胸甲|头盔/],
  ['weapon', /剑|刀|斧|锤|矛|枪|戟|匕首|长弓|弓|弩|棍|杖|镰|镖|鞭/],
  ['mount', /马|骡|坐骑|骆驼/],
  ['livestock', /牛|羊|猪|鸡|鹅|鸭|牲畜|牲口/],
  ['jewelry', /戒指|项链|耳环|手镯|宝石|珠|翡翠|玛瑙/],
  ['luxury', /丝|绸|香水|地毯|瓷器|象牙|珊瑚|琉璃/],
  ['spice', /盐|胡椒|桂皮|香料|豆蔻|丁香/],
  ['cloth', /布|麻|羊毛|纱|绒/],
  ['clothing', /衣|袍|裤|裙|鞋|靴|帽|斗篷|披风|手套|围巾/],
  ['leather', /皮革|鞣皮|生皮|皮料/],
  ['tool', /锤|锯|钳|铲|锄|工具|凿|锉|秤/],
  ['metal', /铁锭|钢锭|铜锭|银锭|金锭|金属|铁料|钢料|锭/],
  ['ore', /矿石|矿|煤|石料/],
  ['fuel', /柴|炭|薪|油灯|灯油/],
  ['book', /书|卷|图|地图|册/],
  ['charm', /符|护符|圣徽|念珠/],
  ['property', /宅|屋|地产|庄园|铺面|田|地契|土地|院子/],
  ['lodging', /住店|通铺|客房|房钱|宿/],
  ['travel', /车|船|渡|路费|脚钱|驮/],
  ['service', /工钱|雇|请人|服务|杂役/],
  ['meat', /肉|鱼|禽/],
  ['drink', /酒|麦酒|葡萄酒|烈酒|陈酿|茶/],
  ['food', /汤|粥|炖|饭|菜|食|饼|馒头|包子/],
  ['staple', /面包|面|麦|米|粮|谷|盐巴/],
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
  [/战马|军马/, 4],
  [/骏马|良驹/, 2],
  [/庄园|城堡/, 3],
  [/宅邸|宅院|大院/, 1.5],
  [/田|地契|土地|铺面/, 0.3],
  [/古董|传家|祖传/, 2],
  [/秘制|大师/, 3],
];

const NO_BAG = new Set(['lodging', 'travel', 'service', 'property']);

export function detectGrade(name) {
  const m = String(name || '').match(/（(灰|绿|蓝|紫|金)）|\((灰|绿|蓝|紫|金)\)/);
  return m ? m[1] || m[2] : '';
}

function mulOf(table, name) {
  for (const [re, mul] of table) if (re.test(name)) return mul;
  return 1;
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
  const cat = classify(name, opts.cat);
  const info = CATS[cat] || CATS.misc;
  const grade = detectGrade(name) || (GRADES.includes(opts.grade) ? opts.grade : '');
  // 品阶只用于武器与护甲（见 rules.md 第八条）；工具、首饰、奢侈品只按材质定价
  const gradeMul = grade && ['weapon', 'armor'].includes(cat) ? GRADE_MUL[grade] : 1;
  const matMul = ['weapon', 'armor', 'tool', 'metal', 'jewelry', 'missile'].includes(cat) ? mulOf(MATERIAL_MUL, name) : 1;
  const specialMul = mulOf(SPECIAL_MUL, name);
  const priceIndex = Number(state?.world?.priceIndex) || 1;
  const unit = Math.max(1, Math.round(info.base * gradeMul * matMul * specialMul * priceIndex));
  return { cat, unit, total: unit * qty, grade, noBag: NO_BAG.has(cat) };
}

/** 卖出价：商人要赚差价，所以不是原价。商谈技能能把这个比例抬一点。 */
export function sellRatio(state) {
  const skill = (state?.player?.skills || []).find((s) => s.name === '商谈');
  const lv = skill ? skill.level : 0;
  return Math.min(0.65, 0.45 + lv * 0.002);
}

export function sellOf(state, name, opts = {}) {
  const p = priceOf(state, name, opts);
  return { ...p, total: Math.max(1, Math.round(p.total * sellRatio(state))) };
}

/** 赏金：冒险者没有固定收入，报酬按威胁等级由引擎开。 */
export const BOUNTY_RANGE = {
  1: [3000, 8000],
  2: [10000, 25000],
  3: [40000, 90000],
  4: [150000, 350000],
  5: [600000, 1500000],
};

export function rollBounty(state, tier, rng) {
  const key = Math.min(5, Math.max(1, Math.round(Number(tier) || 1)));
  const [lo, hi] = BOUNTY_RANGE[key];
  const priceIndex = Number(state?.world?.priceIndex) || 1;
  return Math.round(int(rng, lo, hi) * priceIndex);
}
