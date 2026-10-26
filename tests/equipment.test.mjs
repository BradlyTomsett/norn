import test from 'node:test';
import assert from 'node:assert/strict';
import { generateWorld } from '../engine/worldgen.js';
import { upgradeState } from '../engine/schema.js';
import { gearInventory, gearState, validateLoadout, ensureLoadout } from '../engine/equipment.js';
import { talentRules } from '../engine/abilities.js';
import { judge } from '../engine/resolve.js';
import { makeRng } from '../engine/rng.js';
import { engineDelta } from '../engine/tick.js';
import { prepareTurn, finishTurn } from '../engine/turn.js';
import { settleReply } from '../engine/reply.js';
import { assertAbilityNarrative } from '../engine/narrative.js';
import { applyDelta, uiState, stateBlock } from '../engine/state.js';
import { removeItem, addItem } from '../engine/items.js';
import { receiptText } from '../messages.js';
import { VIEWS } from '../views.js';
import { decodeSave, savePackage } from '../store.js';
const fresh = (equipment = []) => {
  const { state } = generateWorld({ regionId: 'greywater', seed: 77, playerName: '装备测试' });
  state.saveId = 'test-gear'; state.clock = { year: 222, doy: 10, hour: 12, minute: 0, weather: 'clear' };
  state.player.equipment = equipment; state.player.bag = []; state.player.age = 20;
  state.player.stats = { body: 10, agility: 10, wisdom: 10, spirit: 20 }; state.player.skills = [{ name: '武技', level: 10 }];
  return upgradeState(state);
};
const pick = (s, weapons, primary, extra = {}) => s.player.loadout = validateLoadout(s.player, { weapons, primary, ...extra });
const row = (key, qty = 1) => ({ key, qty });
const roll = (s, text = '攻击守卫') => judge(s, text, makeRng(1));
const response = (text, delta = {}) => `${text}\n\`\`\`json\n${JSON.stringify(delta)}\n\`\`\``;

test('收藏无数量上限，迁移不改原列表，只初始化一套常用装备', () => {
  const equipment = [...Array.from({ length: 200 }, (_, i) => `长剑${i}（灰）`), '定制长剑（金）', '皮甲（紫）', '鸢形盾（蓝）'];
  const s = fresh(equipment), before = structuredClone(s.player.equipment);
  assert.equal(gearInventory(s.player).length, 203); assert.equal(gearState(s.player).slots, 1);
  assert.equal(s.player.loadout.primary, '定制长剑（金）'); assert.equal(s.player.loadout.armor, '皮甲（紫）');
  upgradeState(s); assert.deepEqual(s.player.equipment, before); assert.equal(s.player.loadout.needsReview, true);
});
test('同名同品阶堆叠，箭矢匕首飞刀飞斧标枪分别一栏，颜色不同占两栏', () => {
  const s = fresh(['弓箭（灰）×500', '弓箭（灰）', '弓箭（绿）×40', '飞刀（蓝）×30', '匕首（紫）×20', '飞斧（灰）×50', '标枪（绿）×50']);
  const inventory = gearInventory(s.player); assert.equal(inventory.find(item => item.key === '弓箭（灰）').qty, 501);
  const weapons = inventory.map(item => row(item.key, item.qty)); pick(s, weapons, weapons[0].key);
  assert.equal(gearState(s.player).slots, 6); assert.equal(s.player.equipment.length, 7);
  const aliases = fresh(['灰色弓箭×30', '弓箭（灰）×20', '绿色弓箭×10']);
  assert.equal(gearInventory(aliases.player).length, 2); assert.equal(gearInventory(aliases.player).find(item => item.grade === '灰').qty, 50);
});
test('非堆叠武器每件占一栏，第10栏拒绝；盾和护甲各只能一件', () => {
  const s = fresh(['长剑（金）×10', '木盾（灰）', '铁盾（蓝）', '皮甲（灰）', '板甲（紫）']);
  pick(s, [row('长剑（金）', 9)], '长剑（金）', { shield: '木盾（灰）', armor: '皮甲（灰）' });
  assert.equal(gearState(s.player).slots, 9);
  assert.throws(() => pick(s, [row('长剑（金）', 10)], '长剑（金）'), /最多占 9/);
  assert.throws(() => pick(s, [], '', { shield: ['木盾（灰）', '铁盾（蓝）'] }), /最多使用 1/);
  assert.throws(() => pick(s, [], '', { armor: ['皮甲（灰）', '板甲（紫）'] }), /最多使用 1/);
  assert.throws(() => pick(s, [row('不存在的剑（金）')], ''), /收藏中已有/);
});
test('拥有9种传说武器不叠加，本回合只计实际使用的一件，交谈不加战力', () => {
  const s = fresh(['长剑（金）', '大枪（紫）', ...Array.from({ length: 7 }, (_, i) => `战斧${i}（金）`)]);
  const all = gearInventory(s.player).map(item => row(item.key)); pick(s, all, '长剑（金）');
  const many = roll(s), single = structuredClone(s); pick(single, [row('长剑（金）')], '长剑（金）');
  assert.equal(many.ability, roll(single).ability);
  assert.equal(roll(s, '用大枪攻击守卫').effects.weapon.label, '大枪（紫）');
  const bare = structuredClone(s); pick(bare, [], '');
  assert.equal(roll(s, '问候店主').ability, roll(bare, '问候店主').ability);
  assert.equal(roll(s).ability - roll(bare).ability, 11);
});
test('临时明确指定收藏武器替换本次主用，不增加第10栏，不改变平时配置', () => {
  const s = fresh([...Array.from({ length: 9 }, (_, i) => `长剑${i}（金）`), '大枪（紫）']);
  const weapons = gearInventory(s.player).filter(item => item.name.startsWith('长剑')).map(item => row(item.key)); pick(s, weapons, weapons[0].key);
  const before = structuredClone(s.player.loadout), plan = prepareTurn(s, '用大枪攻击守卫', 'turn:temporary');
  assert.equal(plan.judged.effects.weapon.label, '大枪（紫）'); assert.equal(plan.judged.effects.temporary, true);
  const result = finishTurn(plan, {}); assert.deepEqual(result.state.player.loadout, before); assert.equal(gearState(result.state.player).slots, 9);
  assert.match(receiptText(result.receipt), /使用：大枪（紫）/);
});
test('徒手、否定使用、引语、未来计划和施法不偷偷使用收藏武器', () => {
  const s = fresh(['长剑（金）', '大枪（紫）']);
  assert.equal(roll(s, '徒手攻击守卫').effects.weapon, null);
  assert.equal(roll(s, '不用大枪，徒手攻击守卫').effects.weapon, null);
  assert.equal(roll(s, '问他“用大枪攻击如何”').effects.weapon, null);
  assert.equal(roll(s, '明天用大枪攻击守卫').effects.weapon, null);
  assert.equal(roll(s, '释放火球术攻击守卫').effects.weapon, null);
  assert.throws(() => roll(s, '用不存在的神剑攻击守卫'), /没有找到/);
});
test('相同名称不同颜色可明确选择，普通武器与传说武器产生不同判定依据', () => {
  const s = fresh(['弓箭（灰）×30', '弓箭（绿）×5', '长剑（灰）', '长剑（金）']);
  assert.equal(roll(s, '用灰色弓箭攻击守卫').effects.weapon.key, '弓箭（灰）');
  assert.equal(roll(s, '用弓箭（绿）攻击守卫').effects.weapon.key, '弓箭（绿）');
  assert.ok(roll(s, '用长剑（金）攻击守卫').ability > roll(s, '用长剑（灰）攻击守卫').ability);
  const throwing = fresh(['飞刀（灰）×20']); assert.equal(roll(throwing, '掷飞刀').kind, 'combat');
});
test('精通所有武器在换武器与练武时生效，读书和交易不受武器加成', () => {
  const s = fresh(['长剑（金）', '大枪（紫）']); s.player.talent = { effect: '精通所有武器' };
  const plan = roll(s, '用大枪攻击守卫'); assert.equal(plan.effects.masteryBonus, 6); assert.equal(plan.skillLevel, 10);
  const study = roll(s, '用大枪练习武技'); assert.equal(study.skill, '武技'); assert.equal(study.effects.masteryBonus, 6);
  assert.equal(roll(s, '读书识字').effects.masteryBonus, 0); assert.equal(roll(s, '和商人讨价还价').effects.masteryBonus, 0);
});
test('现有天赋各项解析，魔法免疫不会错算为物理免疫，名字不编造效果', () => {
  const s = fresh(); s.player.talent = { name: '暗金剑纹', effect: '精通所有武器；免疫不利魔法与物理攻击；免疫冰、火、电、毒' };
  assert.deepEqual(talentRules(s.player).immunity.sort(), ['physical', 'magic', 'ice', 'fire', 'lightning', 'poison'].sort());
  s.player.talent.effect = '免疫魔法攻击'; assert.deepEqual(talentRules(s.player).immunity, ['magic']);
  s.player.talent.effect = '不免疫物理攻击'; assert.deepEqual(talentRules(s.player).immunity, []);
  s.player.talent.effect = '不能免疫物理攻击；没有夜视；无法感知魔法';
  assert.deepEqual(talentRules(s.player).immunity, []); assert.equal(talentRules(s.player).nightSight, false); assert.equal(talentRules(s.player).magicSense, false);
  s.player.talent = { name: '火之神眷', effect: '' }; assert.deepEqual(talentRules(s.player).immunity, []);
});
test('物理、魔法与元素免疫在对应来袭时阻止伤害，不自动判胜，有益治疗有效', () => {
  for (const [type, text] of [['physical', '物理攻击'], ['magic', '不利魔法'], ['ice', '冰'], ['fire', '火'], ['lightning', '电'], ['poison', '毒']]) {
    const s = fresh(); s.player.talent = { effect: '免疫' + text }; s.npcs = [{ id: 'enemy', name: '强敌', stats: { body: 1000 }, attackTypes: [type] }];
    const d = roll(s, '攻击强敌'); assert.equal(d.effects.blocked, true, type); assert.equal(d.outcome, 'disaster'); assert.equal(engineDelta(d, s).body.health, 0);
    s.player.talent = null; assert.equal(engineDelta(roll(s, '攻击强敌'), s).body.health, -6);
  }
  const s = fresh(); s.player.talent = { effect: '免疫不利魔法' }; s.player.body.health = 50;
  assert.equal(engineDelta(roll(s, '休息八小时'), s).body.health, 10);
});
test('护甲与盾只减对应物理伤害，收藏中的其他护甲不叠加', () => {
  const s = fresh(['板甲（金）', '皮甲（紫）', '铁盾（蓝）']); s.npcs = [{ name: '强敌', stats: { body: 1000 }, attackTypes: ['physical'] }];
  const armored = engineDelta(roll(s, '攻击强敌'), s).body.health;
  pick(s, [], '', { armor: '皮甲（紫）' }); assert.ok(engineDelta(roll(s, '攻击强敌'), s).body.health < armored);
  s.npcs[0].attackTypes = ['magic']; assert.equal(engineDelta(roll(s, '攻击强敌'), s).body.health, -6);
});
test('不利魔法免疫覆盖魔法元素攻击，但不把自然火焰当作魔法', () => {
  const s = fresh(); s.player.talent = { effect: '免疫不利魔法' };
  assert.equal(roll(s, '抵挡火球术').effects.blocked, true);
  assert.equal(roll(s, '抵挡火焰').effects.blocked, false);
  s.npcs = [{ name: '法师', attackTypes: ['magic', 'fire'], stats: { body: 1000 } }];
  assert.equal(engineDelta(roll(s, '攻击法师'), s).body.health, 0);
  const plan = prepareTurn(s, '抵挡火球术', 'turn:spell'); assert.throws(() => assertAbilityNarrative(plan, '你被火球烧伤。'));
});
test('减少堆叠数量与失去武器后，使用配置按实际拥有量同步', () => {
  const s = fresh(['飞刀（蓝）×30', '长剑（金）']); pick(s, [row('飞刀（蓝）', 30), row('长剑（金）')], '飞刀（蓝）');
  assert.equal(removeItem(s, '飞刀（蓝）', 20).count, 20); ensureLoadout(s.player); assert.equal(s.player.loadout.weapons[0].qty, 10);
  removeItem(s, '飞刀（蓝）', 10); ensureLoadout(s.player); assert.equal(s.player.loadout.primary, '长剑（金）');
  assert.equal(gearState(s.player).slots, 1);
});
test('磨刀石从旧装备迁入其他物品，数量不丢失、不重复，也不能作为武器使用', () => {
  const s = fresh(['磨刀石（灰）×3', '磨刀石', '磨刀石', '长剑（金）']);
  assert.equal(s.player.bag.find(row => row.name === '磨刀石（灰）').qty, 3);
  assert.equal(s.player.bag.find(row => row.name === '磨刀石').qty, 2);
  assert.deepEqual(gearInventory(s.player).map(row => row.key), ['长剑（金）']);
  const before = structuredClone(s.player.bag); upgradeState(s); assert.deepEqual(s.player.bag, before);
  addItem(s, '磨刀石（绿）', 4); assert.equal(s.player.bag.find(row => row.name === '磨刀石（绿）').qty, 4);
  assert.throws(() => pick(s, [row('磨刀石（绿）')], '磨刀石（绿）'), /收藏中已有的武器/);
  const ui = uiState(s); assert.match(VIEWS.items(ui), /其他物品[\s\S]*磨刀石/); assert.ok(!VIEWS.gear(ui).includes('磨刀石'));
  const result = applyDelta(s, { equipment: ['磨刀石（蓝）'] }, makeRng(1), { eventId: 'turn:stone' });
  assert.equal(result.applied, true); assert.ok(s.player.bag.some(row => row.name === '磨刀石（蓝）'));
  assert.ok(!s.player.equipment.some(name => name.includes('磨刀石')));
});
test('新获得大量装备不被截断，也不自动穿上或因同名丢数量', () => {
  const s = fresh(['长剑（金）']), before = structuredClone(s.player.loadout);
  const result = applyDelta(s, { equipment: [...Array.from({ length: 20 }, (_, i) => `长剑${i}（灰）`), { name: '弓箭（灰）', qty: 100 }, '长剑（金）'] }, makeRng(1), { eventId: 'turn:many-gear' });
  assert.equal(result.applied, true); assert.equal(gearInventory(s.player).find(item => item.key === '弓箭（灰）').qty, 100);
  assert.equal(gearInventory(s.player).find(item => item.key === '长剑（金）').qty, 2); assert.deepEqual(s.player.loadout, before);
  assert.ok(result.receipt.items.some(row => row.name === '弓箭（灰）' && row.change === 100));
});
test('正文中的免疫伤害与错误武器可重写一次，不能改交易或物品，失败不提交', async () => {
  const s = fresh(['长剑（金）', '大枪（紫）']); s.player.talent = { effect: '精通所有武器；免疫物理攻击；免疫火、冰、电、毒与不利魔法' };
  const plan = prepareTurn(s, '用大枪攻击守卫', 'turn:narration'), before = structuredClone(plan.state);
  for (const text of ['你被守卫砍伤了。', '你的手臂被火焰烧伤。', '你中毒了。', '你被魔法控制。', '你挥起长剑。']) assert.throws(() => assertAbilityNarrative(plan, text));
  assert.doesNotThrow(() => assertAbilityNarrative(plan, '你被砍中，却没有受伤。刀锋没能刺穿你的皮肤。'));
  let attempts = 0;
  const result = await settleReply(plan, response('你被守卫砍伤了。'), { repairNarrative: async () => { attempts++; return response('你用大枪抵开攻击，身体没有受伤。'); } });
  assert.equal(attempts, 1); assert.match(result.raw, /没有受伤/); assert.deepEqual(plan.state, before);
  await assert.rejects(settleReply(plan, response('你被砍伤。'), { repairNarrative: async raw => raw }), /免疫/);
  await assert.rejects(settleReply(plan, response('你被砍伤。'), { repairNarrative: async () => response('你没有受伤。', { items: [{ name: '额外物品', qty: 1 }] }) }), /变化数据/);
});
test('能力配置随完整导出导入保留，装备页可操作，提示明确收藏不叠加', () => {
  const s = fresh(['长剑（金）', '飞刀（蓝）×30', '木盾（灰）', '皮甲（紫）']); pick(s, [row('长剑（金）'), row('飞刀（蓝）', 30)], '长剑（金）', { shield: '木盾（灰）', armor: '皮甲（紫）' });
  const imported = decodeSave(JSON.parse(JSON.stringify(savePackage(s, [])))); assert.deepEqual(imported.state.player.loadout, s.player.loadout);
  const html = VIEWS.gear(uiState(s)); assert.match(html, /gear-save/); assert.match(html, /2\/9/);
  assert.match(stateBlock(s), /拥有的装备，仅为收藏/);
  assert.equal(s.player.body.fatigue, undefined); assert.equal(s.player.body.durability, undefined);
});
