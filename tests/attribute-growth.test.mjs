import test from 'node:test';
import assert from 'node:assert/strict';
import { generateWorld } from '../engine/worldgen.js';
import { upgradeState } from '../engine/schema.js';
import { advanceWorld } from '../engine/tick.js';
import { makeRng } from '../engine/rng.js';
import { savePackage, decodeSave } from '../store.js';
import { readFile } from 'node:fs/promises';

const year = 365 * 1440;
function fresh(age = 12, talent = null) {
  const { state } = generateWorld({ regionId: 'greywater', seed: 77, playerName: '测试' });
  upgradeState(state); state.player.age = age; state.player.talent = talent; state.clock = { year: 222, doy: 1, hour: 0, minute: 0, weather: 'clear' };
  state.player.stats = { body: 10, agility: 10, wisdom: 10, spirit: 10 }; state.npcs = []; state.player.relations = [];
  return state;
}
const advance = (s, minutes, random = () => 0.5) => advanceWorld(s, minutes, random, { kind: 'rest' });

test('12岁前不成长，12至16岁按时间累计，觉醒等级只从三种高品阶产生', () => {
  for (const [roll, grade] of [[0, '珍奇'], [0.499999, '珍奇'], [0.5, '史诗'], [0.899999, '史诗'], [0.9, '传说'], [0.99, '传说']]) {
    const s = fresh(11); advance(s, year, () => roll); assert.equal(s.player.stats.body, 10); assert.equal(s.player.age, 12);
    advance(s, year * 4, () => roll); assert.equal(s.player.stats.body, 18); assert.equal(s.player.age, 16);
    assert.equal(s.player.talent.grade, grade); assert.equal(s.flags.awakeningAsked, true);
    assert.deepEqual(['body', 'agility', 'wisdom', 'spirit'].map(k => s.player.stats[k]), [18, 18, 18, 18]);
  }
});

test('同样经过一年，实际武技训练只额外增长体质和敏捷，天赋越强增长越快', () => {
  const values = [];
  for (const grade of ['珍奇', '史诗', '传说']) {
    const s = fresh(16, { grade, name: '天赋', effect: '' });
    advanceWorld(s, year, () => 0.5, { kind: 'study', skill: '武技', segments: [{ kind: 'study', skill: '武技', minutes: year }] });
    values.push(s.player.stats.body);
    assert.equal(s.player.stats.body, s.player.stats.agility); assert.equal(s.player.stats.wisdom, s.player.stats.spirit);
    assert.ok(s.player.stats.body > s.player.stats.wisdom);
  }
  assert.deepEqual(values, [14, 16, 18]);
});
test('复合行动只计算各自的实际时长，休息不带来训练增长', () => {
  const s = fresh(16, { grade: '珍奇' }), t = structuredClone(s);
  const segments = [{ kind: 'study', skill: '魔法', minutes: year / 2 }, { kind: 'rest', skill: '', minutes: year / 2 }];
  advanceWorld(s, year, () => 0.5, { kind: 'study', segments });
  advanceWorld(t, year, () => 0.5, { kind: 'rest' });
  assert.equal(s.player.stats.spirit, 13); assert.equal(s.player.stats.wisdom, 13);
  assert.equal(s.player.stats.body, t.player.stats.body); assert.equal(t.player.stats.spirit, 12);
});
test('16岁以后天赋越强成长越快，分段推进与整段一致，存档往返保留余量', () => {
  const values = [];
  for (const grade of ['珍奇', '史诗', '传说']) {
    const a = fresh(16, { grade, name: '已有天赋', effect: '原效果', secret: true }), b = structuredClone(a);
    advance(a, year); for (let i = 0; i < 12; i++) advance(b, year / 12);
    assert.deepEqual(a.player.stats, b.player.stats); assert.deepEqual(a.player.attributeGrowth, b.player.attributeGrowth);
    const loaded = decodeSave(savePackage(a, [])).state; assert.deepEqual(loaded.player.attributeGrowth, a.player.attributeGrowth);
    assert.equal(loaded.player.talent.effect, '原效果'); values.push(a.player.stats.body);
  }
  assert.deepEqual(values, [12, 13, 14]);
});
test('越过16岁时不重复觉醒，旧存档高属性不被降低，NPC规则不修改', async () => {
  const s = fresh(15, { grade: '传说', name: '既有', effect: '已有能力', secret: true });
  s.player.stats.body = 240; advance(s, year * 2); assert.equal(s.player.stats.body, 240); assert.equal(s.player.talent.name, '既有');
  const worldbook = await readFile(new URL('../prompt/worldbook.md', import.meta.url), 'utf8');
  assert.match(worldbook, /约三成失败不退钱/); assert.match(worldbook, /城镇 5–10%、乡村 1–3%/); assert.match(worldbook, /90%/); assert.match(worldbook, /9\.9%/);
});
