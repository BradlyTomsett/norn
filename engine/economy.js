// 定价：物品价格由引擎算，模型只说"买什么、卖什么、几件"，不许写金额。
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
// 模型可以给 cat 提示（必须命中 CATS），但不能给价。

import { int } from './rng.js';

export const GRADES = ['灰', '绿', '蓝', '紫', '金'];
// 灰：老百姓都用；绿：普通人能见到的顶配；蓝：城主级，一个城里没几件；
// 紫：S 级冒险者、国王、公爵才可能有一件；金：传说，多数人没听说过。
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
  hide: { name: '生皮', base: 8, unit: '张' },
  leather: { name: '熟皮', base: 25, unit: '张' },
  tool: { name: '工具', base: 60, unit: '件' },
  metal: { name: '金属料', base: 25, unit: '斤' },
  weapon: { name: '武器', base: 350, unit: '件' },
  armor: { name: '护甲', base: 900, unit: '件' },
  missile: { name: '箭矢', base: 1, unit: '支' },
  medicine: { name: '药', base: 60, unit: '份' },
  potion: { name: '药剂', base: 250, unit: '瓶' },
  poultry: { name: '家禽', base: 15, unit: '只' },
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
  [/驮马|挽马|运货马/, 6000],
  [/耕牛/, 15000],
  [/奶牛/, 15000],
  [/牛犊|小牛/, 4000],
  [/羊羔|羔羊/, 300],
  [/猪崽|小猪/, 150],
  [/雏鸡|小鸡|鸡雏/, 5],
  // 皮革（按来源分价）
  [/生皮|毛皮/, 8],
  [/牛皮/, 60],
  [/鹿皮/, 80],
  [/羊皮/, 25],
  [/狼皮/, 40],
  [/熊皮/, 300],
  [/狐皮|貂皮/, 400],
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
  const priceIndex = Number(state?.world?.priceIndex) || 1;

  const named = namedPrice(name);
  if (named) {
    const unit = Math.max(1, Math.round(named * priceIndex));
    return { cat, unit, total: unit * qty, grade, noBag: NO_BAG.has(cat) || NAMED_NO_BAG.has(cat) };
  }

  // 品阶只用于武器与护甲（见 rules.md 第八条）；工具、首饰、奢侈品只按材质定价
  const gradeMul = grade && ['weapon', 'armor'].includes(cat) ? GRADE_MUL[grade] : 1;
  const matMul = ['weapon', 'armor', 'tool', 'metal', 'jewelry', 'missile'].includes(cat)
    ? mulOf(MATERIAL_MUL, name)
    : 1;
  const specialMul = mulOf(SPECIAL_MUL, name);
  const unit = Math.max(1, Math.round(info.base * gradeMul * matMul * specialMul * priceIndex));
  return { cat, unit, total: unit * qty, grade, noBag: NO_BAG.has(cat) };
}

/**
 * 卖出价：商人要赚差价，所以不是原价。
 * 用人物能力里的「交涉」；没有这个技能时按智慧折算，跟判定那边的兜底一致。
 */
export function sellRatio(state) {
  const skills = state?.player?.skills || [];
  const skill = skills.find((s) => s.name === '交涉');
  const wisdom = Number(state?.player?.stats?.wisdom) || 10;
  const lv = skill ? Number(skill.level) || 0 : Math.max(0, (wisdom - 10) * 0.4);
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
