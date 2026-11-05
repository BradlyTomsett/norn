import { ATLAS_PROFILES, PLACES, ROUTES } from './atlas-data.js';
import { OPTION_HEADING } from './actions.js';

export const MODES = { walk: '步行', horse: '骑马', ship: '乘船' };
export class AtlasNarrativeError extends Error {}
const byId = new Map(PLACES.map(place => [place.id, place]));
const byName = new Map(PLACES.map(place => [place.name, place]));
const links = new Map(PLACES.map(place => [place.id, []]));
for (const route of ROUTES) {
  links.get(route.a).push([route, route.b]);
  links.get(route.b).push([route, route.a]);
}

export const atlasPlace = id => byId.get(id);
export const atlasName = name => byName.get(name);
export const atlasTitle = place => place.approximate ? '位置待核实' : [place.district, ATLAS_PROFILES[place.region].name].filter(Boolean).join(' · ');
export const atlasVisible = (place, state) => !place.hidden || Boolean(state?.atlasDiscovered?.includes(place.id)
  || place.discoverVia && state?.locations?.[place.discoverVia]?.id === place.discoverVia);

export const PLACE_CATEGORIES = { settlements: '聚落', transport: '港口与路站', nature: '自然地形', heritage: '遗迹与废墟', landmarks: '其他地标' };
export function placeCategory(place) {
  if (['主城', '城', '镇', '边镇', '村', '营地', '集市'].includes(place.kind)) return 'settlements';
  if (['港口', '渡口', '驿站', '关口', '哨站'].includes(place.kind)) return 'transport';
  if (['遗迹', '废墟'].includes(place.kind)) return 'heritage';
  if (['森林', '丘陵', '草原', '草地', '山峰', '山岭', '峡谷', '河流', '沙漠', '海湾', '海崖', '岛屿', '湿地', '湖岸', '水源'].includes(place.kind)) return 'nature';
  return 'landmarks';
}

function knownScene(name) {
  return PLACES.find(place => name?.startsWith(place.name) &&
    (place.approximate || /^(?:[·・／/ -]|内|外|旅店|酒馆|仓库|公会|冒险者公会|城门|街|码头|郊外|广场|集市|工坊|客房|港区)/.test(name.slice(place.name.length))));
}

export function atlasLocation(state, location = state?.player?.location) {
  if (!location || location.siteId?.startsWith('atlas-road:')) return null;
  const saved = state?.locations?.[location.siteId];
  return atlasName(location.siteName) || knownScene(location.siteName) || atlasPlace(location.atlasPlaceId)
    || (saved?.name === location.siteName && atlasPlace(saved.atlasPlaceId))
    || (!location.siteName && atlasPlace(location.siteId)) || null;
}

export function atlasWorld(place) {
  const info = ATLAS_PROFILES[place.region];
  return { id: place.id, name: place.name, atlasPlaceId: place.id, regionTitle: atlasTitle(place),
    terrain: place.description, economy: info.details.生计, politics: info.details.治理, risk: info.details.往来 };
}

export function routeLegs(id, state, mode = 'walk') {
  if (!Object.hasOwn(MODES, mode)) return [];
  return (links.get(id) || []).flatMap(([road, to]) => {
    const byWater = road.sea || road.river;
    if (mode === 'ship' && !byWater) return [];
    if (road.restricted && !state?.atlasPasses?.includes(road.id)) return [];
    if (!atlasVisible(atlasPlace(to), state)) return [];
    const actualMode = byWater ? 'ship' : road.footOnly ? 'walk' : mode;
    let factor = 1;
    if (/山径|峡谷/.test(road.terrain)) factor = 1.9;
    else if (road.terrain === '山道') factor = 1.65;
    else if (/沼泽|沙砾/.test(road.terrain)) factor = 1.55;
    else if (/丘地|林道|牧道|步道/.test(road.terrain)) factor = 1.28;
    const speed = road.river ? 5 : { walk: 4, horse: 7, ship: 10 }[actualMode];
    const moving = Math.ceil(60 * road.km * factor / speed);
    const rest = actualMode === 'ship' ? 0 : Math.floor((moving - 1) / 480) * 960;
    return [{ id: road.id, from: id, to, km: road.km, terrain: road.terrain, mode: actualMode, minutes: moving + rest }];
  });
}

export function findRoute(from, to, state, mode = 'walk') {
  if (!byId.has(from) || !byId.has(to) || !Object.hasOwn(MODES, mode) || !atlasVisible(atlasPlace(to), state)) return null;
  const costs = new Map([[from, 0]]), paths = new Map([[from, []]]), open = new Set([from]);
  while (open.size) {
    const current = [...open].reduce((best, id) => costs.get(id) < costs.get(best) ? id : best);
    if (current === to) {
      const legs = paths.get(current);
      return { from, to, mode, legs, minutes: costs.get(current), km: legs.reduce((sum, leg) => sum + leg.km, 0) };
    }
    open.delete(current);
    for (const leg of routeLegs(current, state, mode)) {
      const cost = costs.get(current) + leg.minutes;
      if (cost >= (costs.get(leg.to) ?? Infinity)) continue;
      costs.set(leg.to, cost);
      paths.set(leg.to, [...paths.get(current), leg]);
      open.add(leg.to);
    }
  }
  return null;
}

export const routeLabel = route => [route.from, ...route.legs.map(leg => leg.to)].map(id => atlasPlace(id).name).join(' → ');
export function durationLabel(minutes) {
  return [minutes >= 1440 && Math.floor(minutes / 1440) + '天',
    minutes % 1440 >= 60 && Math.floor(minutes % 1440 / 60) + '小时',
    minutes % 60 && minutes % 60 + '分钟'].filter(Boolean).join('') || '0分钟';
}

const departure = /^(?:我(?:们)?)?(?:现在|先|要|想|准备|马上|直接|沿路|启程|出发)*(?:(步行|徒步|骑马|骑着马|乘船|坐船)(?:出发|去|前往|返回|到|赶往|往)?|(?:去|前往|返回|回到|走到|赶往|驶往|到|往|回))\s*(.+)$/;
const resume = /^(?:我(?:们)?)?(?:现在|先|接着)?继续(?:赶路|前进|航行|上路|走|前往)(.*)$/;
const turnBack = /^(?:我(?:们)?)?(?:就地|现在|先)?(?:原路返回|掉头|折返|回到出发地)$/;
const modeOf = text => /骑/.test(text || '') ? 'horse' : /船/.test(text || '') ? 'ship' : 'walk';

export function travelIntent(state, text) {
  const ongoing = state.journey;
  const continuing = text.match(resume), returning = turnBack.test(text);
  if (ongoing && (continuing || returning)) {
    const target = continuing?.[1].trim();
    if (target && target !== atlasPlace(ongoing.route.to)?.name) return { error: '仍在途中。请继续去原目的地，或输入“原路返回”。' };
    if (!returning) return { route: ongoing.route, elapsed: ongoing.elapsed, origin: ongoing.origin };
    const legs = [];
    let remaining = ongoing.elapsed;
    for (const leg of ongoing.route.legs) {
      if (!remaining) break;
      const minutes = Math.min(remaining, leg.minutes);
      legs.unshift({ ...leg, from: leg.to, to: leg.from, minutes });
      remaining -= minutes;
    }
    const route = { ...ongoing.route, from: legs[0].from, to: ongoing.route.from, legs, minutes: ongoing.elapsed };
    return { route, elapsed: 0, origin: state.player.location };
  }
  const match = text.match(departure);
  if (!match || /^(?:哪里|哪儿|什么地方|怎么|哪条)|[吗么呢]$/.test(match[2])) return null;
  const target = match[2].replace(/^(?:到|向)/, '').trim();
  const place = atlasName(target);
  const here = atlasLocation(state);
  if (!place) {
    // Only block uncharted intercity travel, not a walk to a store or an established local scene.
    const composite = PLACES.find(row => target.startsWith(row.name) && /^(?:去|找|见|问|买|卖|办理|调查|打听)/.test(target.slice(row.name.length)));
    if (composite && composite.id !== here?.id) return { error: '请先单独发送前往该地的行动，到达后再办理其他事情。' };
    if ((here || ongoing) && (Object.values(ATLAS_PROFILES).some(region => region.name === target)
      || /(?:王国|联邦|群岛|高原|山脉|部落|龙岛|[东西南]海)$/.test(target)
      || (/^[\p{Script=Han}]{2,14}(?:城|镇|村|港|岛)$/u.test(target)
        && !knownScene(target) && !Object.values(state.locations || {}).some(row => row.name === target && atlasLocation(state, { siteId: row.id, siteName: row.name })?.id === here?.id)))) {
      return { error: '请先在地图上选择一个已标注的地点。未测绘地点需要先查明位置和通路。' };
    }
    return null;
  }
  if (ongoing) return { error: '仍在途中。请继续去原目的地，或输入“原路返回”。' };
  if (place.id === here?.id && state.player.location.siteId === place.id) return null;
  if (!here) return { error: '当前地点尚未对应到世界地图。请先核对它所属的已知地点，再规划城际路线。' };
  const route = findRoute(here.id, place.id, state, modeOf(match[1]));
  if (!route) return { error: '目前没有已知且可通行的路线通往该地点。' };
  if (!route.legs.length) return null;
  return { route, elapsed: 0, origin: state.player.location };
}

export function routePosition(trip, minutes) {
  let remaining = trip.elapsed + minutes;
  for (const leg of trip.route.legs) {
    if (remaining >= leg.minutes) { remaining -= leg.minutes; continue; }
    return { leg, remaining, label: `${atlasPlace(leg.from).name} → ${atlasPlace(leg.to).name}途中` };
  }
  const place = atlasPlace(trip.route.to);
  return { place, label: place.name };
}

export function travelLocation(trip, minutes) {
  const end = routePosition(trip, minutes);
  if (end.place) return { siteId: end.place.id, siteName: end.place.name, atlasPlaceId: end.place.id };
  return { siteId: 'atlas-road:' + end.leg.id, siteName: end.label };
}

export function checkTravelNarrative(trip, minutes, raw) {
  if (routePosition(trip, minutes).place) return;
  const prose = String(raw).split('```')[0].split(OPTION_HEADING)[0]
    .replace(/“[^”]*”|「[^」]*」|『[^』]*』|"[^"\n]*"/g, '');
  const destination = atlasPlace(trip.route.to).name;
  const arrival = new RegExp(`(?:你们?|一行人)(?:终于|已经|随后|这时|此时|便|就|都)*\\s*(?:到达|抵达|进入|到了|走进|驶入|回到)${destination}`);
  if (prose.split(/[。！？；，\n]/).some(clause =>
    arrival.test(clause) && !/还未|尚未|没有|并未|即将|等到|若|如果|预计/.test(clause))) {
    throw new AtlasNarrativeError('正文把途中停留写成了已经抵达。请重新生成本回合，原进度已保留。');
  }
}

export function mapSettlement(state, model, trip, minutes, input) {
  if (model.atlasAccess != null) {
    if (trip || model.atlasAccess !== 'pinewatch~lake-haven' || atlasLocation(state)?.id !== 'pinewatch'
      || !/(?:询问|问|请|请求|申请|请求引路).*(?:进入|入林|通行|引路|向导|巨湖|屏障)/.test(input)) {
      throw new Error('没有可核对的地图通行许可。');
    }
    state.atlasPasses = [...new Set([...(state.atlasPasses || []), model.atlasAccess])];
    state.atlasDiscovered = [...new Set([...(state.atlasDiscovered || []), 'lake-haven'])];
    delete model.atlasAccess;
  }
  if (trip) {
    const location = travelLocation(trip, minutes);
    if (model.location && (model.location.siteId !== location.siteId || model.location.siteName !== location.siteName)) {
      throw new Error(`地图位置与路线不符，本轮结束于${location.siteName}。请移除 location。`);
    }
    model.location = location;
    state.journey = location.atlasPlaceId ? null : { ...trip, elapsed: trip.elapsed + minutes };
    return;
  }
  if (!model.location) return;
  const location = typeof model.location === 'string' ? { siteName: model.location } : model.location;
  if (location.siteId === state.player.location.siteId && location.siteName === state.player.location.siteName) {
    delete model.location;
    return;
  }
  const here = atlasLocation(state);
  const named = atlasName(location.siteName) || knownScene(location.siteName);
  const identified = atlasPlace(location.siteId);
  const recorded = atlasLocation(state, { siteId: location.siteId, siteName: location.siteName });
  if (identified && !named) throw new Error('世界地图地点不能改名。');
  if (identified && named && identified.id !== named.id) throw new Error('世界地图地点名称和编号不一致。');
  if (state.journey || location.siteId?.startsWith('atlas-road:')) throw new Error('途中需要明确选择继续赶路或返回，当前地点不能跳转。');
  if (recorded && here?.id !== recorded.id) throw new Error('城际移动必须先规划固定地图路线。');
  if (here && !named && !state.locations[location.siteId] && /^[\p{Script=Han}]{2,14}(?:城|镇|村|港|岛)$/u.test(location.siteName)) {
    throw new Error('新城镇需要在世界地图中有依据。');
  }
  if (here) {
    model.location = atlasName(location.siteName) ? { siteId: here.id, siteName: here.name, atlasPlaceId: here.id }
      : { siteId: location.siteId || location.siteName, siteName: location.siteName, atlasPlaceId: here.id };
  } else if (typeof model.location === 'object') delete model.location.atlasPlaceId;
}

export function routeContext(state, query, trip, minutes = 0) {
  const end = trip ? routePosition(trip, minutes) : null;
  const current = atlasLocation(state) || (state.journey && atlasPlace(routePosition(state.journey, 0).leg?.from));
  const mentioned = PLACES.filter(place => atlasVisible(place, state) && query.includes(place.name));
  const regions = new Set([current?.region, end?.place?.region, ...mentioned.map(place => place.region),
    ...Object.values(ATLAS_PROFILES).filter(row => query.includes(row.name)).map(row => row.id)].filter(Boolean));
  const lines = ['【固定世界地图】地名、方位和道路以此为准。可写地点内或附近的局部场景，不能新增或改写固定地点或地点之间的路线。标注遗址入口、山脚或岸边不代表可进入遗址、登顶或穿过未测绘区域。'];
  if (current) {
    lines.push(`地图锚点：[${current.id}] ${current.name}（${atlasTitle(current)}）。${current.description}`);
    lines.push('相邻可通行地点：' + routeLegs(current.id, state).map(leg =>
      `[${leg.to}] ${atlasPlace(leg.to).name}，${leg.terrain} ${leg.km} 公里`).join('；'));
    if (current.id === 'pinewatch' && !state.atlasPasses?.includes('pinewatch~lake-haven')) {
      lines.push('只有玩家明确向有权引路的人请求入林、且正文中已获得具体许可时，输出 atlasAccess:"pinewatch~lake-haven"。此字段仅开放通路，不移动玩家。');
    }
  }
  const named = [...new Set([...mentioned, end?.place])].filter(place => place && place.id !== current?.id).slice(0, 8);
  if (named.length) lines.push('相关地点：' + named.map(place => `[${place.id}] ${place.name}（${place.kind} · ${atlasTitle(place)}）${place.description}`).join('；'));
  for (const id of [...regions].slice(0, 5)) {
    const region = ATLAS_PROFILES[id];
    lines.push(`${region.name}：${region.canon}` + Object.entries(region.details).map(([key, value]) => `${key}：${value}`).join(' '));
  }
  if (trip) {
    lines.push(`本轮引擎路线：${routeLabel(trip.route)}。各段方式：${trip.route.legs.map(leg => `${MODES[leg.mode]}·${leg.terrain}`).join(' → ')}。本轮耗时 ${minutes} 分钟，结束地点是${end.label}。`);
    lines.push('按引擎给定的时间和地点写正文。仅写本轮走过的路；如果还在途中，不写已经抵达。玩家位置由引擎更新，本轮不输出 location，也不擅自增加费用。');
  } else if (state.journey) lines.push(`玩家仍在${state.player.location.siteName}；交谈或休息不自动增加路程。可输入“继续赶路”或“原路返回”。`);
  return lines.join('\n');
}
