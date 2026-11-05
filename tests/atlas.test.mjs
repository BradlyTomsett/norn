import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { ATLAS_PROFILES, PLACES, ROUTES, REGIONAL_PROFILES } from '../engine/atlas-data.js';
import { atlasLocation, atlasVisible, atlasPlace, findRoute } from '../engine/atlas.js';
import { generateWorld } from '../engine/worldgen.js';
import { DOCK_SCENARIO, startScenario } from '../engine/scenario.js';
import { prepareTurn, finishTurn, followNarrativeTime } from '../engine/turn.js';
import { buildTurnRequest } from '../engine/context.js';
import { absoluteMinute } from '../engine/schema.js';
import { projectPoint } from '../atlas-projection.js';
import { REGION_IMAGES } from '../atlas-regions.js';

const start = (regionId = 'greywater', seed = 82) => generateWorld({ regionId, seed }).state;
const prepare = (state, input, extra = {}) => prepareTurn(state, input, `atlas:${state.turn + 1}`, { randomEventOverride: null, ...extra });

test('每个已有区域都有独立的地图图像', () => {
  for (const region of REGIONAL_PROFILES) {
    assert.ok(REGION_IMAGES[region.id], region.name);
    assert.ok(existsSync(new URL('../' + REGION_IMAGES[region.id].replace(/^\.\//, ''), import.meta.url)), region.name);
  }
});

test('插画定位只改变地图显示，所有已登记地点仍有可用的显示坐标', () => {
  for (const place of PLACES) {
    const point = projectPoint(place.x, place.y);
    assert.ok(Number.isFinite(point.x) && Number.isFinite(point.y), place.name);
    assert.ok(point.x >= 0 && point.x <= 1000 && point.y >= 0 && point.y <= 650, place.name);
  }
  assert.ok(projectPoint(228, 145).x > 228, '森岭巨湖与插画森林对齐');
  assert.ok(projectPoint(534, 130).y < 130, '高原靠近插画北方雪山');
});

test('图册与原有主城、地理方位、开局地点一致，所有公开道路连通', () => {
  const worldbook = readFileSync(new URL('../prompt/worldbook.md', import.meta.url), 'utf8');
  const cityNames = { shengyan: '圣洁白塔', haoming: '鎏金宫殿', weituo: '城堡要塞', gewen: '临水城邦', selens: '隐林城邦', andreia: '滨海城邦' };
  for (const [id, name] of Object.entries(cityNames)) {
    assert.ok(worldbook.includes(name));
    assert.equal(PLACES.find(place => place.region === id && place.kind === '主城')?.name, name);
    assert.ok(Object.values(ATLAS_PROFILES[id].details).every(value => value.length >= 12));
  }
  assert.ok(ATLAS_PROFILES.forest.x < ATLAS_PROFILES.dwarves.x && ATLAS_PROFILES.forest.y < ATLAS_PROFILES.orcs.y);
  assert.ok(ATLAS_PROFILES.dragon.x < ATLAS_PROFILES.shengyan.x);
  assert.ok(ATLAS_PROFILES.plateau.y < ATLAS_PROFILES.shengyan.y);
  assert.ok(atlasPlace('eastern-seat').x > atlasPlace('greywater').x);
  assert.equal(atlasPlace('tideport').region, 'gewen');
  assert.equal(atlasPlace('anvilford').region, 'dwarves');
  assert.equal(atlasPlace('linhe-city').name, '临河城');
  assert.equal(atlasPlace('linhe-city').approximate, true);
  assert.equal(new Set(PLACES.map(place => place.id)).size, PLACES.length);
  assert.equal(new Set(PLACES.map(place => place.name)).size, PLACES.length);
  assert.equal(new Set(ROUTES.map(route => [route.a, route.b].sort().join('|'))).size, ROUTES.length);
  for (const route of ROUTES) {
    assert.ok(atlasPlace(route.a) && atlasPlace(route.b) && route.a !== route.b && route.km > 0, route.id);
  }
  for (const place of PLACES.filter(place => !place.hidden && !place.approximate)) assert.ok(findRoute('greywater', place.id));
});

test('新增的河运、岛间航线、沙海与遗址支路由同一地图结算', () => {
  const state = start();
  const river = findRoute('greywater-quay', 'eastern-quay', state, 'ship');
  assert.deepEqual(river.legs.map(leg => [leg.mode, leg.terrain]), [['ship', '灰水河航线']]);
  assert.equal(river.minutes, 348);
  assert.ok(findRoute('tideport', 'pearl-shoal', state, 'ship').legs.every(leg => leg.mode === 'ship'));
  assert.ok(findRoute('wind-quay', 'gull-rock', state, 'ship'));
  assert.ok(findRoute('east-reef', 'river-mouth', state, 'ship'));
  assert.ok(findRoute('northwind', 'rainshadow-sands', state).legs.some(leg => leg.terrain === '沙砾道'));
  assert.ok(findRoute('blackrock-pass', 'echo-vault', state, 'horse').legs.every(leg => leg.mode === 'walk'));
  assert.equal(findRoute('gull-rock', 'dragon', state, 'ship'), null);
  const request = buildTurnRequest(prepare(state, '步行前往灰烬礼拜堂'));
  assert.match(request.system, /灰烬礼拜堂（废墟/);
  assert.match(request.system, /屋顶已塌/);
});

test('进入屏障后才会发现镜湖新地点，旧通行许可仍然有效', () => {
  const { state } = startScenario({ ...DOCK_SCENARIO, place: '松影边镇' });
  state.atlasPasses = ['pinewatch~lake-haven'];
  state.atlasDiscovered = ['lake-haven'];
  assert.equal(findRoute('pinewatch', 'lake-reeds', state), null);
  const lake = finishTurn(prepare(state, '前往镜湖聚落'), {}).state;
  assert.ok(findRoute('lake-haven', 'lake-reeds', lake));
  assert.ok(findRoute('lake-haven', 'mirror-spring', lake));
});

test('不同存档用同一路程；分别核对步行、骑马、乘船和本地移动', () => {
  const a = start(), b = start('greywater', 17);
  const walk = prepare(a, '步行前往东境郡城', { minutesOverride: 2 });
  const second = prepare(b, '前往东境郡城');
  assert.deepEqual(walk.judged.trip.route, second.judged.trip.route);
  assert.equal(walk.judged.minutes, 465);
  assert.ok(prepare(a, '骑马前往东境郡城').judged.minutes < 465);
  assert.equal(prepare(start('tideport'), '乘船前往临水城邦').judged.trip.route.legs[0].mode, 'ship');
  assert.throws(() => prepare(a, '乘船前往东境郡城'), /可通行/);
  assert.equal(prepare(a, '走到柜台前').judged.trip, undefined);
  assert.equal(prepare(a, '明天去东境郡城').judged.trip, undefined);
  assert.throws(() => prepare(a, '去东境郡城，然后找旅店'), /单独发送/);
  assert.match(buildTurnRequest(walk).system, /灰水镇 → 东境郡城/);
});

test('途中停留、读档、休息和继续前行，地图位置与时间按已走路程结算', () => {
  const state = start();
  state.npcs[0].following = true;
  const event = { type: 'road_encounter', label: '路遇商旅', scene: 'road' };
  const plan = prepare(state, '前往东境郡城', { randomEventOverride: event });
  assert.throws(() => followNarrativeTime(plan, '你已经抵达东境郡城。'), /途中停留/);
  assert.throws(() => followNarrativeTime(plan, '本轮耗时10分钟。'), /时间与固定路线/);
  assert.throws(() => finishTurn(plan, { location: { siteId: 'eastern-seat', siteName: '东境郡城' } }), /位置与路线不符/);
  const stopped = finishTurn(plan, { eventUpdate: { status: 'pending', text: '路遇商旅' } }).state;
  assert.equal(state.player.location.siteId, 'greywater');
  assert.match(stopped.player.location.siteName, /途中$/);
  assert.equal(stopped.journey.elapsed, plan.judged.minutes);
  assert.deepEqual(stopped.npcs[0].location, stopped.player.location);
  const reloaded = JSON.parse(JSON.stringify(stopped));
  const resting = finishTurn(prepare(reloaded, '坐下休息半小时'), {}).state;
  assert.equal(resting.journey.elapsed, stopped.journey.elapsed);
  assert.equal(prepare(reloaded, '原路返回').judged.minutes, stopped.journey.elapsed);
  const next = prepare(reloaded, '继续赶路');
  const arrived = finishTurn(next, {}).state;
  assert.equal(arrived.player.location.siteId, 'eastern-seat');
  assert.equal(arrived.journey, null);
  assert.equal(absoluteMinute(arrived.clock) - absoluteMinute(state.clock), 465);
});

test('旧场景可定位，未知场景保留，自定义锚点不进入共用地图', () => {
  const state = start();
  assert.equal(atlasLocation(state, { siteId: 'legacy-inn', siteName: '灰水镇旅店' }).id, 'greywater');
  assert.equal(atlasLocation(state, { siteId: 'legacy-city', siteName: '尚未测绘的地方' }), null);
  assert.equal(atlasLocation(state, { siteId: 'jialong_guild_hall', siteName: '加隆城冒险者公会大厅' }).name, '加隆城');
  assert.equal(atlasLocation(state, { siteId: 'greywater', siteName: '旧自定义开局' }), null);
  assert.throws(() => finishTurn(prepare(state, '观察街道'), { location: { siteId: 'tideport', siteName: '潮汐港' } }), /城际移动/);
  const { state: custom } = startScenario({ ...DOCK_SCENARIO, place: '北崖渡口', atlasAnchor: 'tideport' });
  assert.equal(atlasLocation(custom).id, 'tideport');
  assert.equal(atlasPlace(custom.player.location.siteId), undefined);
  assert.equal(prepare(custom, '前往临水城邦').judged.trip.route.from, 'tideport');
});

test('隐蔽地名及受限通路在许可前不会显示，许可也不会自动移动角色', () => {
  const { state } = startScenario({ ...DOCK_SCENARIO, place: '松影边镇' });
  const hidden = atlasPlace('lake-haven');
  assert.ok(!atlasVisible(hidden, state));
  assert.equal(findRoute('pinewatch', hidden.id, state), null);
  assert.doesNotMatch(buildTurnRequest(prepare(state, '看看附近')).system, /镜湖聚落/);
  assert.throws(() => finishTurn(prepare(state, '看看附近'), { atlasAccess: 'pinewatch~lake-haven' }), /通行许可/);
  const admitted = finishTurn(prepare(state, '请求向导许可进入巨湖'), { atlasAccess: 'pinewatch~lake-haven' }).state;
  assert.equal(admitted.player.location.siteId, 'pinewatch');
  assert.ok(atlasVisible(hidden, admitted));
  assert.ok(findRoute('pinewatch', hidden.id, admitted));
});
