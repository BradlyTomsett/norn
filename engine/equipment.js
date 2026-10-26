import { parseItemEntry } from './items.js';

export const GEAR_LIMITS = { weapons: 9, shield: 1, armor: 1 };
export const GRADE_BONUS = { 灰: 0, 绿: 2, 蓝: 4, 紫: 7, 金: 11 };
const grades = { 普通: '灰', 稀少: '绿', 珍奇: '蓝', 史诗: '紫', 传说: '金' };
const stackable = /飞刀|匕首|飞斧|投斧|投矛|标枪|飞镖|手里剑|箭|弩矢|弹丸/;
export function gearKind(name) {
  if (/盾/.test(name)) return 'shield';
  if (/护甲|皮甲|轻甲|重甲|锁甲|链甲|板甲|鳞甲|铠|盔甲|法袍|战袍|胸甲/.test(name)) return 'armor';
  if (/剑|刀|斧|矛|枪|戟|锤|棍|棒|杖|弓|弩|箭|镖|铁尺|拳套|匕首|弩矢|弹丸/.test(name)) return 'weapon';
  return 'other';
}
function entry(raw) {
  const text = String(raw || '').normalize('NFKC').replace(/\(([^)]*)\)/g, '（$1）')
    .replace(/（(普通|稀少|珍奇|史诗|传说)(?=[，,）])/g, (_, g) => '（' + grades[g]);
  const parsed = parseItemEntry(text); if (!parsed) return null;
  const prefix = parsed.name.match(/^([灰绿蓝紫金])色(.+)$/);
  const grade = parsed.grade || prefix?.[1] || '灰', name = (prefix ? prefix[2] : parsed.name).trim();
  return { key: `${name}（${grade}）`, label: `${name}（${grade}）`, name, grade, qty: parsed.qty,
    kind: gearKind(name), stackable: stackable.test(name) };
}
/** Ownership remains in the original lists, with no slot or collection limit. */
export function gearInventory(player) {
  const groups = new Map();
  const add = (raw, quantity = 1) => {
    const row = entry(raw); if (!row || row.kind === 'other') return;
    row.qty *= Math.max(0, Math.floor(Number(quantity) || 0)); if (!row.qty) return;
    const old = groups.get(row.key); if (old) old.qty += row.qty; else groups.set(row.key, row);
  };
  for (const raw of player.equipment || []) add(raw);
  for (const row of player.bag || []) add(row.name, row.qty);
  return [...groups.values()];
}
export function weaponSlots(weapons, inventory) {
  return weapons.reduce((sum, row) => sum + (inventory.find(item => item.key === row.key)?.stackable ? 1 : row.qty), 0);
}
export function validateLoadout(player, value) {
  const inventory = gearInventory(player), weapons = [], seen = new Set();
  if (!Array.isArray(value?.weapons)) throw new Error('请选择常用武器。');
  for (const row of value.weapons) {
    const owned = inventory.find(item => item.key === row?.key && item.kind === 'weapon');
    if (!owned) throw new Error('只能使用收藏中已有的武器。');
    if (seen.has(row.key)) throw new Error('同名同品阶的武器请在同一行选择数量。');
    if (!Number.isSafeInteger(row.qty) || row.qty < 1 || row.qty > owned.qty) throw new Error(`「${owned.label}」的使用数量超过拥有数量。`);
    seen.add(row.key); weapons.push({ key: row.key, qty: row.qty });
  }
  if (weaponSlots(weapons, inventory) > GEAR_LIMITS.weapons) throw new Error('正在使用的武器最多占 9 栏；同名同品阶的箭矢、投掷武器和匕首可堆叠。');
  const out = { version: 1, weapons, primary: value.primary == null ? weapons[0]?.key || '' : String(value.primary), shield: '', armor: '', needsReview: false };
  if (out.primary && !weapons.some(row => row.key === out.primary)) throw new Error('主用武器必须在选中的常用武器里。');
  for (const kind of ['shield', 'armor']) {
    if (Array.isArray(value[kind])) throw new Error(kind === 'shield' ? '盾牌最多使用 1 件。' : '护甲最多使用 1 件。');
    const key = value[kind] || '';
    if (key && !inventory.some(row => row.key === key && row.kind === kind)) throw new Error('只能选择收藏中已有的' + (kind === 'shield' ? '盾牌。' : '护甲。'));
    out[kind] = key;
  }
  return out;
}
export function ensureLoadout(player) {
  const inventory = gearInventory(player), best = kind => inventory.filter(row => row.kind === kind).sort((a, b) => GRADE_BONUS[b.grade] - GRADE_BONUS[a.grade])[0];
  if (!player.loadout || player.loadout.version !== 1) {
    const weapon = best('weapon');
    player.loadout = { version: 1, weapons: weapon ? [{ key: weapon.key, qty: weapon.stackable ? weapon.qty : 1 }] : [],
      primary: weapon?.key || '', shield: best('shield')?.key || '', armor: best('armor')?.key || '', needsReview: inventory.length > 0 };
  } else {
    const cleaned = [], seen = new Set(); let slots = 0;
    for (const row of player.loadout.weapons || []) {
      const owned = inventory.find(item => item.key === row.key && item.kind === 'weapon'); if (!owned || seen.has(row.key)) continue;
      const qty = Math.min(owned.qty, Math.max(0, Math.floor(Number(row.qty) || 0)), owned.stackable ? Infinity : 9 - slots);
      if (!qty || slots >= 9) continue;
      cleaned.push({ key: row.key, qty }); slots += owned.stackable ? 1 : qty; seen.add(row.key);
    }
    player.loadout.weapons = cleaned;
    if (player.loadout.primary && !cleaned.some(row => row.key === player.loadout.primary)) player.loadout.primary = cleaned[0]?.key || '';
    for (const kind of ['shield', 'armor']) if (!inventory.some(row => row.key === player.loadout[kind] && row.kind === kind)) player.loadout[kind] = '';
  }
  return player.loadout;
}
export function gearState(player) {
  const copy = { ...player, loadout: player.loadout ? structuredClone(player.loadout) : undefined };
  const loadout = ensureLoadout(copy), inventory = gearInventory(player);
  return { inventory, loadout, slots: weaponSlots(loadout.weapons, inventory) };
}
export function chooseWeapon(player, action, kind) {
  const { inventory, loadout } = gearState(player);
  if (!['combat', 'study'].includes(kind)) return { weapon: null, temporary: false };
  const active = inventory.filter(item => loadout.weapons.some(row => row.key === item.key));
  const eligible = inventory.filter(item => item.kind === 'weapon').sort((a, b) => b.name.length - a.name.length);
  const useText = String(action).split('，').filter(part => !/不(?:用|使用|拿|拔|选)|^(?:我)?(?:问|询问|说|告诉)/.test(part)).join('，');
  const explicit = /(?:用|使用|拿|持|挥|拔|取出|换上|掷|投|射|拉开|练|以)/.test(useText);
  let named = explicit ? eligible.filter(item => useText.includes(item.name)) : [];
  if (named.length) {
    const longest = named[0].name.length; named = named.filter(item => item.name.length === longest);
    const colored = named.filter(item => useText.includes(item.label) || useText.includes(`${item.grade}色${item.name}`)
      || useText.includes(`${item.name}（${Object.keys(grades).find(key => grades[key] === item.grade)}）`));
    if (colored.length) named = colored;
    const weapon = named.find(item => item.key === loadout.primary) || named.find(item => active.some(row => row.key === item.key)) || named[0];
    return { weapon, temporary: !active.some(row => row.key === weapon.key) };
  }
  if (/徒手|空手|赤手|挥拳|用拳|一拳|踢击/.test(useText)) return { weapon: null, temporary: false };
  if (/施法|释放[^，]{0,8}(?:魔法|火球|冰|雷)|施展[^，]{0,8}(?:魔法|法术)|火球术|魔法攻击/.test(useText)) return { weapon: null, temporary: false };
  if (/(?:用|拿|取出|拔出|挥动|持|换上)[^，。；]{0,16}(?:剑|刀|斧|枪|矛|弓|弩|箭|匕首)/.test(useText)) throw new Error('没有找到这件武器。请核对收藏中的名称和品阶。');
  if (kind === 'study' && !/练剑|练刀|练枪|武器|武技|射箭|剑术|刀法|练斧/.test(useText)) return { weapon: null, temporary: false };
  const ranged = /射箭|射击|远射/.test(useText);
  const weapon = ranged ? active.find(row => /弓|弩/.test(row.name) && !/箭/.test(row.name)) : active.find(row => row.key === loadout.primary);
  if (ranged && !weapon) throw new Error('常用武器中没有弓或弩，请先在装备页选择。');
  return { weapon: weapon || null, temporary: false };
}
