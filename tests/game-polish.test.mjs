import test from 'node:test';
import assert from 'node:assert/strict';
import { generateWorld } from '../engine/worldgen.js';
import { upgradeState } from '../engine/schema.js';
import { narrativeTime } from '../engine/time.js';
import { prepareTurn, finishTurn } from '../engine/turn.js';
import { classify } from '../engine/resolve.js';
import { makeRng } from '../engine/rng.js';
import { applyDelta, uiState } from '../engine/state.js';
import { actionAbilities } from '../engine/abilities.js';
import { eventScene, selectRandomEvent, recordRandomEvent } from '../engine/random-events.js';
import { packPoints, unpackPoints } from '../checkpoints.js';
import { VIEWS } from '../views.js';

const fresh = () => { const s = generateWorld({ regionId: 'greywater', seed: 17, playerName: '测试' }).state; upgradeState(s); return s; };
test('组合时长、跨多天和明确日期准确识别，约定和引语不推进时间', () => {
  const c = { year: 222, doy: 30, hour: 21, minute: 30 };
  for (const [text, minutes] of [['本轮共经过2小时30分钟。',150], ['过了一天2小时15分钟。',1575], ['两天后凌晨3点，你回到了旅店。',1770], ['此时是222年2月1日凌晨3点。',330]]) assert.equal(narrativeTime(text,c)?.minutes, minutes, text);
  for (const text of ['他说：“两天后凌晨3点见。”', '计划两天后凌晨3点回来。', '约定本轮共经过2小时30分钟。']) assert.equal(narrativeTime(text,c),null);
});
test('观察和命令不误触发战斗；已知目标资料优先于名字，来袭类型持续有效', () => {
  assert.equal(classify('观察守卫是否拔剑'), 'observe');
  assert.equal(classify('命令同伴攻击强盗'), 'social');
  const s = fresh();
  assert.ok(applyDelta(s, { npcs: [{ id:'enemy', name:'鸡冠法师', age:30, combat:{body:50,skill:30,attackTypes:['magic']} }] }, makeRng(1), {eventId:'profile'}).applied);
  const plan = prepareTurn(s,'攻击鸡冠法师','fight'); assert.equal(plan.judged.difficulty,85);
  assert.deepEqual(actionAbilities(s,'攻击鸡冠法师','combat').incomingTypes,['magic']);
  assert.equal(s.npcs.find(n=>n.id==='enemy').combat.body,50);
});
test('森林调查保留环境，待处理事件承接，解决后才恢复抽取', () => {
  const s=fresh(); s.player.location={siteId:'forest',siteName:'森林'};
  assert.equal(eventScene(s,{kind:'observe'},'调查线索'),'wild');
  recordRandomEvent(s,{type:'road_robbery',scene:'wild',label:'强盗'},'event:1',{status:'pending',text:'强盗还等着回答'});
  const e=selectRandomEvent(s,{kind:'social',minutes:5},'回答强盗'); assert.equal(e.id,'event:1'); assert.equal(e.continuing,true);
  recordRandomEvent(s,e,'next',{status:'resolved',text:'强盗已经离开'});
  assert.equal(s.randomEvents.length,1); assert.equal(s.randomEvents[0].status,'resolved');
});
test('快照差异压缩可无损还原，兼容完整旧快照并拒绝危险路径', () => {
  const base=fresh(); base.knowledge=Array.from({length:100},(_,i)=>({text:`重要事实${i}`}));
  const old=structuredClone(base); old.turn=3; old.knowledge.pop(); old.player.body.health=20;
  const points=[{turn:3,historyCount:6,state:old}]; const packed=packPoints(base,points);
  assert.ok(JSON.stringify(packed).length < JSON.stringify(points).length);
  assert.deepEqual(unpackPoints(base,packed),points); assert.deepEqual(unpackPoints(base,points),points);
  assert.deepEqual(unpackPoints({...base,revision:99,updatedAt:'new transaction'},packed),points);
  assert.throws(()=>unpackPoints(base,[{patch:[['set',['__proto__','x'],1]]}]),/无效/);
});
test('任务内部安排、人物回顾和技能经验可见，不把小步骤加进独立清单', () => {
  const s=fresh(), npc=s.npcs[0]; s.player.contracts=[{id:'job',label:'仓库调查',status:'active',copper:100}];
  s.knowledge=[{text:'晚上九点在门口会合',taskIds:['job'],kind:'decision',npcIds:[npc.id],sourceTurn:1}];
  s.player.skills[0].xp=0.25; const u=uiState(s);
  assert.match(VIEWS.tasks(u),/任务相关安排与线索/); assert.match(VIEWS.tasks(u),/晚上九点/);
  assert.match(VIEWS.people(u),/人物回顾/); assert.match(VIEWS.overview(u),/本级经验 25%/); assert.match(VIEWS.journal(u),/晚上九点/);
});
