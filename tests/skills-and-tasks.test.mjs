import test from 'node:test';
import assert from 'node:assert/strict';
import { generateWorld } from '../engine/worldgen.js';
import { upgradeState } from '../engine/schema.js';
import { SKILL_NAMES, fixedSkills } from '../engine/skills.js';
import { judge } from '../engine/resolve.js';
import { makeRng } from '../engine/rng.js';
import { trainSkill } from '../engine/progress.js';
import { prepareTurn, finishTurn } from '../engine/turn.js';
import { uiState, stateBlock } from '../engine/state.js';
import { applyTasks } from '../engine/tasks.js';
import { maintainTasks } from '../engine/task-review.js';
import { VIEWS } from '../views.js';
import { decodeSave, savePackage } from '../store.js';
import { RUNTIME } from '../engine/protocol.js';

const fresh = () => {
  const { state } = generateWorld({ regionId: 'greywater', seed: 77, playerName: '测试旅人' });
  state.saveId = 'sv_six_skills'; state.clock.hour = 12;
  return upgradeState(state);
};
const roll = (state, text) => judge(state, text, makeRng(1));
const minorTexts = [
  '去北门老驿道那头摸底',
  '明晚日落前后到北关第三座仓门口碰头；凯尔先寻他舅舅，塔姆早半个时辰到城门里头等；老杜和薇拉由我去说',
  '明天问凯尔：北关第三座仓里有没有狗、几条、夜里拴在哪',
  '守夜时盯账房小窗：灯何时灭、谁进去过、出来带没带东西',
  '定下明晚若仓里真动起来，四个半人怎么站、谁喊、谁堵门',
];

test('新局自带固定六项，均为零，任何出生地都不生成杂活或识路', () => {
  for (const regionId of ['greywater', 'northpass', 'ironford']) {
    const { state } = generateWorld({ regionId, seed: 2, playerName: '测试' });
    assert.deepEqual(state.player.skills, SKILL_NAMES.map(name => ({ name, level: 0, xp: 0 })));
  }
});

test('旧存档药材等级经验完整并入炼金，取消的技能不转点，迁移与导入幂等', () => {
  const s = fresh(); s.schemaVersion = 6; s.turn = 84;
  s.player.skills = [{ name: '武技', level: 130, xp: 0 }, { name: '药材', level: 20, xp: 0.4 },
    { name: '察觉', level: 71.1, xp: 0.405 }, { name: '交涉', level: 55.3, xp: 0.401 },
    { name: '干杂活', level: 5, xp: 0.69 }, { name: '识路', level: 2, xp: 0.92 }];
  const before = structuredClone([s.player.stats, s.player.accounts, s.player.equipment, s.clock, s.turn]);
  upgradeState(s);
  assert.deepEqual(s.player.skills.map(s => s.name), SKILL_NAMES);
  assert.deepEqual(s.player.skills[2], { name: '炼金', level: 20, xp: 0.4 });
  assert.equal(s.player.skills[0].level, 130); assert.equal(s.player.skills[3].level, 0);
  assert.deepEqual([s.player.stats, s.player.accounts, s.player.equipment, s.clock, s.turn], before);
  const once = structuredClone(s); upgradeState(s); assert.deepEqual(s, once);
  assert.deepEqual(decodeSave(savePackage(s, [])).state.player.skills, s.player.skills);
  assert.deepEqual(fixedSkills([{ name: '炼金', level: 15, xp: 0.9 }, { name: '药材', level: 20, xp: 0.4 }])[2], s.player.skills[2]);
});

test('技能界面顺序固定，原始空列表也显示六项零值', () => {
  const u = uiState(fresh()); u.player.skills = [];
  const html = VIEWS.overview(u), list = html.match(/<div class="skill-list">([\s\S]*?)<h3>状态/)[1];
  assert.equal((list.match(/class="bar-row"/g) || []).length, 6);
  assert.deepEqual([...list.matchAll(/<span>([^<]+)<\/span><span>0<\/span>/g)].map(m => m[1]), SKILL_NAMES);
});

test('观察武器、交易询问说服、辨药制药、维修制作分别使用对应技能，零级参与判定', () => {
  const s = fresh(); s.player.skills = fixedSkills([]); s.player.equipment = ['短剑（灰）']; delete s.player.loadout;
  const actions = [
    ['观察对手武器是什么品级', '察觉'], ['搜索四周', '察觉'], ['偷偷潜行到门边', '察觉'],
    ['与商人交易', '交涉'], ['询问老杜消息', '交涉'], ['说服守卫放行', '交涉'],
    ['认识这些药材', '炼金'], ['辨认草药', '炼金'], ['制作药剂', '炼金'], ['练习炼金术四小时', '炼金'],
    ['维修马车', '机械'], ['制作一个木盒', '机械'], ['练习锻造四小时', '机械'],
    ['用短剑制伏窃贼', '武技'], ['练剑四小时', '武技'],
    ['施法攻击守卫', '魔法'], ['练习魔法四小时', '魔法'],
  ];
  for (const [text, skill] of actions) {
    const j = roll(s, text); assert.equal(j.skill, skill, text); assert.equal(j.skillLevel, 0, text);
    const trained = structuredClone(s); trainSkill(trained, j);
    assert.ok(trained.player.skills.find(s => s.name === skill).xp > 0, text);
    assert.ok(trained.player.skills.filter(s => s.name !== skill).every(s => s.xp === 0), text);
    assert.deepEqual(trained.player.skills.map(s => s.name), SKILL_NAMES);
  }
});

test('魔法用精神与魔法判定，不借用收藏武器或所有武器精通', () => {
  const s = fresh(); s.player.equipment = ['长剑（金）']; delete s.player.loadout;
  s.player.talent = { grade: '传说', effect: '精通所有武器' };
  const j = roll(s, '施法攻击守卫');
  assert.equal(j.statName, 'spirit'); assert.equal(j.effects.weapon, null);
  assert.equal(j.effects.weaponBonus, 0); assert.equal(j.effects.masteryBonus, 0);
});

test('模型无法新增类型或改等级，未知训练标签无效，多回合训练仍只有六项', () => {
  let s = fresh(); const original = structuredClone(s.player.skills);
  const result = finishTurn(prepareTurn(s, '睡觉八小时', 'skills:inject'), {
    skills: ['飞行', '干杂活', { name: '炼金', level: 999 }, { name: '药材', level: 999 }],
  });
  s = result.state; assert.deepEqual(s.player.skills, original);
  assert.equal(trainSkill(s, { kind: 'observe', skill: '飞行', label: '飞行', minutes: 10000 }), 0);
  for (const [i, text] of ['制作药剂', '维修马车', '询问老杜消息', '观察武器品级', '练习魔法四小时', '练剑四小时'].entries()) {
    s = finishTurn(prepareTurn(s, text, `skills:turn:${i}`), {}).state;
    assert.deepEqual(s.player.skills.map(s => s.name), SKILL_NAMES);
  }
  assert.match(RUNTIME, /不允许新增技能类型/);
  assert.doesNotMatch(stateBlock(s), /干杂活|识路/);
});

test('截图中的五种小步骤加载即收起，委托、时间、钱和回合不变，历史保留且不冒充完成', () => {
  const s = fresh(); s.player.contracts = [{ id: 'warehouse', label: '北仓清点', copper: 2400000, status: 'active' }];
  s.player.unfinished = minorTexts.map((text, i) => ({ id: `small:${i}`, text, kind: 'commitment', importance: 'major' }));
  const before = structuredClone([s.clock, s.player.accounts, s.player.contracts, s.turn]);
  upgradeState(s);
  assert.deepEqual(s.player.unfinished, []); assert.equal(s.player.taskHistory.length, minorTexts.length);
  assert.ok(s.player.taskHistory.every(t => t.status === 'archived' && t.archivedKind === 'substep'));
  assert.deepEqual([s.clock, s.player.accounts, s.player.contracts, s.turn], before);
  assert.equal(maintainTasks(s), false);
  const view = VIEWS.tasks(uiState(s));
  assert.match(view, /北仓清点/); assert.match(view, /没有其他待办事项/); assert.doesNotMatch(view, /data-status="active"/);
  assert.match(stateBlock(s, '北关第三座仓碰头'), /不表示已完成或取消/);
  const restored = decodeSave(savePackage(s, [])).state;
  assert.deepEqual(restored.player.taskHistory, s.player.taskHistory);
});

test('小步骤不能被旧AI重开、改编号或标major后塞回，实际重要调查交付仍可正常完成', () => {
  const s = fresh(); s.player.unfinished = [];
  for (const [i, text] of minorTexts.entries()) applyTasks(s, [{ id: `minor:${i}`, text, kind: 'commitment', importance: 'major' }], [], 'model:one');
  assert.equal(s.player.unfinished.length, 0);
  applyTasks(s, [{ id: 'minor:0', status: 'active' }, { id: 'rewrite', text: minorTexts[0] }], [], 'model:two');
  assert.equal(s.player.unfinished.length, 0);
  applyTasks(s, [{ id: 'minor:0', status: 'active' }], [], 'player:reopen'); assert.equal(s.player.unfinished.length, 0);
  const important = ['查清西门仓库失窃原因', '明晚在北仓碰头，交付调查线索', '救出被扣押的商人', '三天内归还借款'];
  applyTasks(s, important.map((text, i) => ({ id: `major:${i}`, text })), [], 'model:three');
  assert.deepEqual(s.player.unfinished.map(t => t.text), important);
  applyTasks(s, [{ id: 'major:0', status: 'completed' }], [], 'model:done');
  assert.equal(s.player.unfinished.length, 3); assert.equal(s.player.taskHistory.find(t => t.id === 'major:0').status, 'completed');
});
