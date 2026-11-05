import { REGIONS, createInitialState, startingStats } from './worldgen.js';
import { makeRng, pick } from './rng.js';
import { dateLine, rollWeather } from './clock.js';
import { textId } from './entities.js';
import { workOf } from './ledger.js';
import { fromCopper } from './money.js';
import { addItem } from './items.js';
import { upgradeState } from './schema.js';
import { atlasName, atlasPlace, atlasTitle, atlasWorld, atlasVisible } from './atlas.js';

export const MAX_SCENARIO_NPCS = 6;
export const MAX_SCENARIO_ITEMS = 10;
export const PROFESSION_STATES = ['none', 'apprentice', 'journeyman', 'master', 'guildmaster'];
export const DOCK_SCENARIO = {
  title: '潮汐港成年码头工',
  place: '潮汐港',
  description: '南海口岸。涨潮时半个下城泡在水里，装卸工在第一班船到岸前清点货物。',
  name: '',
  age: 24,
  gender: 'male',
  profession: '码头工',
  professionState: 'journeyman',
  cash: 200,
  time: '06:30',
  event: '第一班渡船就要离岸。码头主管莉娜拦在跳板边，指着一只铅封破损的木箱，请你看看箱上的印记。',
  npcs: [{ name: '莉娜', age: 35, profession: '码头主管' }],
  items: [{ name: '麻绳', qty: 1 }],
};

function cardText(value, label, max, optional = false) {
  if (value == null && optional) return '';
  if (typeof value !== 'string') throw new Error(`请填写${label}`);
  const text = value.trim();
  if (!text && !optional) throw new Error(`请填写${label}`);
  if (text.length > max) throw new Error(`${label}最多 ${max} 字`);
  return text;
}

function cardNumber(value, label, min, max) {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new Error(`${label}须为 ${min} 到 ${max} 的整数`);
  }
  return value;
}

function cardRows(value, label, max) {
  if (!Array.isArray(value) || value.length > max) throw new Error(`${label}最多 ${max} 条`);
  return value;
}

// Read only supported starting fields. A card never supplies raw save data or game rules.
export function validateScenario(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('缺少剧本资料');
  if (!['male', 'female'].includes(raw.gender)) throw new Error('请选择角色性别');
  if (!PROFESSION_STATES.includes(raw.professionState)) throw new Error('请选择职业阶段');
  if (typeof raw.time !== 'string' || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(raw.time)) throw new Error('请选择有效的开局时间');
  const card = {
    title: cardText(raw.title, '剧本名称', 48),
    place: cardText(raw.place, '起始地点', 48),
    description: cardText(raw.description, '地方设定', 800, true),
    name: cardText(raw.name, '角色姓名', 40, true),
    age: cardNumber(raw.age, '角色年龄', 1, 120),
    gender: raw.gender,
    profession: cardText(raw.profession, '职业或身份', 48),
    professionState: raw.professionState,
    cash: cardNumber(raw.cash, '随身钱数', 0, 10000000),
    time: raw.time,
    event: cardText(raw.event, '开局事件', 800),
    atlasAnchor: cardText(raw.atlasAnchor, '地图锚点', 48, true),
    npcs: cardRows(raw.npcs, '初始人物', MAX_SCENARIO_NPCS).map(row => ({
      name: cardText(row?.name, '人物姓名', 40),
      age: cardNumber(row?.age, '人物年龄', 1, 300),
      profession: cardText(row?.profession, '人物身份', 48),
    })),
    items: cardRows(raw.items, '随身物品', MAX_SCENARIO_ITEMS).map(row => ({
      name: cardText(row?.name, '物品名称', 40),
      qty: cardNumber(row?.qty, '物品数量', 1, 100),
    })),
  };
  const names = [card.name, ...card.npcs.map(npc => npc.name)].filter(Boolean);
  if (new Set(names).size !== names.length) throw new Error('请为角色和初始人物使用不同的姓名');
  return card;
}

export function parseScenarioDraft(reply) {
  const text = reply.trim().replace(/^```(?:json)?\s*([\s\S]*?)\s*```$/i, '$1');
  let raw;
  try { raw = JSON.parse(text); }
  catch { throw new Error('模型没有返回完整的剧本，请重试或手动填写'); }
  return validateScenario(raw);
}

export function startScenario(raw, { seed = Date.now() } = {}) {
  const card = validateScenario(raw);
  const rng = makeRng(seed);
  const place = atlasName(card.place);
  const anchor = place || atlasPlace(card.atlasAnchor);
  if (anchor && !atlasVisible(anchor)) throw new Error('请选择一个公开的开局地点。');
  if (card.atlasAnchor && !anchor) throw new Error('自定义地点的地图锚点无效。');
  const region = REGIONS.find(row => row.id === anchor?.id);
  const names = (region || REGIONS[0]).names;
  const namePool = names[card.gender].flatMap(name => names.family.map(family => `${name}·${family}`));
  const name = card.name || pick(rng, namePool.filter(value => !card.npcs.some(npc => npc.name === value)));
  const location = { siteId: place?.id || `site-scenario-${textId(card.place)}`, siteName: card.place,
    ...(anchor && !place ? { atlasPlaceId: anchor.id } : {}) };
  const [hour, minute] = card.time.split(':').map(Number);
  const doy = 300;
  const geography = anchor ? atlasWorld(anchor) : {};
  const clock = { year: 222, doy, hour, minute, weather: rollWeather(rng, doy) };
  const npcs = card.npcs.map((npc, index) => ({
    ...npc, id: `npc_scenario_${index + 1}`, race: 'human', location: { ...location }, memory: [],
  }));
  const state = createInitialState({
    seed,
    world: {
      ...geography, id: location.siteId, name: card.place,
      regionTitle: anchor ? atlasTitle(anchor) : '自定义',
      population: region?.population, terrain: place ? region?.terrain || place.description : card.description || '尚待探索',
      economy: region?.economy || geography.economy || '尚待了解',
      politics: region?.politics || geography.politics || '尚待了解',
      risk: region?.risk || geography.risk || '尚待了解', priceIndex: 1,
    },
    clock,
    player: {
      name, age: card.age, gender: card.gender, race: 'human', socialClass: 'commoner',
      profession: card.profession, professionState: card.professionState, location,
      stats: startingStats(rng, 'human'), wallet: fromCopper(card.cash),
      work: { ...workOf(card.profession, card.professionState), profession: card.profession, state: card.professionState },
      relations: npcs.map(npc => ({ npcId: npc.id, closeness: 0 })),
      reputation: { [card.place]: 0 },
    },
    npcs,
    knowledge: [{ text: card.event, source: '亲历', day: doy, siteIds: [location.siteId] }],
  });
  if (card.description) state.customSetting = `${card.place}：${card.description}`;
  for (const item of card.items) addItem(state, item.name, item.qty);
  upgradeState(state);
  const opening = [
    `${card.place} · ${dateLine(clock)}`,
    `你是${name}，${card.age}岁，身份是${card.profession}。`,
    card.description,
    card.event,
    '你接下来要做什么？',
  ].filter(Boolean).join('\n\n');
  return { state, opening };
}
