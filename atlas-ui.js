import { PLACES, REGIONAL_PROFILES, ATLAS_PROFILES, TERRAIN, ROUTES } from './engine/atlas-data.js';
import { SEA_BENDS } from './engine/atlas-expansion.js';
import { drawAtlasArt } from './atlas-art.js';
import { atlasLocation, atlasPlace, atlasTitle, atlasVisible, findRoute, routeLegs, routePosition, MODES, PLACE_CATEGORIES, placeCategory, routeLabel, durationLabel } from './engine/atlas.js';

const svgNode = (tag, attrs, text) => {
  const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
  if (text) node.textContent = text;
  return node;
};
const node = (tag, text, cls) => {
  const el = document.createElement(tag);
  if (text) el.textContent = text;
  if (cls) el.className = cls;
  return el;
};
const roads = new Map(ROUTES.map(road => [road.id, road]));
function routePoints(road) {
  const a = atlasPlace(road.a), b = atlasPlace(road.b);
  const bends = (SEA_BENDS[road.id] || '').split(' ').filter(Boolean).map(point => point.split(',').map(Number));
  return [[a.x, a.y], ...bends, [b.x, b.y]];
}

function positionAlong(leg, fraction) {
  const road = roads.get(leg.id);
  if (!road) return atlasPlace(leg.from);
  const points = routePoints(road);
  if (leg.from !== road.a) points.reverse();
  const lengths = points.slice(1).map(([x, y], i) => Math.hypot(x - points[i][0], y - points[i][1]));
  let remaining = Math.min(1, Math.max(0, fraction)) * lengths.reduce((total, length) => total + length, 0);
  for (const [i, length] of lengths.entries()) {
    if (remaining > length) { remaining -= length; continue; }
    const [x, y] = points[i], [nextX, nextY] = points[i + 1];
    const part = length ? remaining / length : 0;
    return { x: x + (nextX - x) * part, y: y + (nextY - y) * part };
  }
  return atlasPlace(leg.to);
}

export function setupAtlas({ onPlan, onLocate }) {
  const $ = id => document.getElementById('atlas-' + id);
  const sheet = $('sheet'), close = $('close'), region = $('region'), category = $('category'), search = $('search');
  const map = $('map'), places = $('places'), info = $('info');
  let state, selected, mode = 'walk', lastFocus, view = null, homeView = null, drag = null, pinch = null, suppressClick = false;
  const pointers = new Map();
  const setView = next => {
    view = next;
    map.setAttribute('viewBox', [view.x, view.y, view.width, view.height].join(' '));
  };
  const svgPoint = (clientX, clientY) => {
    const matrix = map.getScreenCTM();
    if (!matrix) return { x: view.x + view.width / 2, y: view.y + view.height / 2 };
    const point = map.createSVGPoint();
    point.x = clientX; point.y = clientY;
    return point.matrixTransform(matrix.inverse());
  };
  const zoom = (factor, clientX, clientY) => {
    if (!view) return;
    const anchor = clientX == null ? { x: view.x + view.width / 2, y: view.y + view.height / 2 } : svgPoint(clientX, clientY);
    const width = Math.max(65, Math.min(1400, view.width * factor));
    const ratio = width / view.width, height = view.height * ratio;
    setView({ x: anchor.x - (anchor.x - view.x) * ratio, y: anchor.y - (anchor.y - view.y) * ratio, width, height });
  };
  $('zoom-in').onclick = () => zoom(.7);
  $('zoom-out').onclick = () => zoom(1 / .7);
  $('reset').onclick = () => { if (homeView) setView({ ...homeView }); };
  map.addEventListener('wheel', event => {
    event.preventDefault();
    zoom(event.deltaY < 0 ? .85 : 1 / .85, event.clientX, event.clientY);
  }, { passive: false });
  map.addEventListener('pointerdown', event => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.size === 1) {
      drag = { x: event.clientX, y: event.clientY, view: { ...view }, moved: false };
      suppressClick = false;
    } else if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinch = { distance: Math.hypot(a.x - b.x, a.y - b.y) };
      drag = null; suppressClick = true;
    }
  });
  map.addEventListener('pointermove', event => {
    if (!pointers.has(event.pointerId)) return;
    const previous = pointers.get(event.pointerId);
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.size === 2 && pinch) {
      const [a, b] = [...pointers.values()], distance = Math.hypot(a.x - b.x, a.y - b.y);
      if (distance > 0 && pinch.distance > 0) zoom(pinch.distance / distance, (a.x + b.x) / 2, (a.y + b.y) / 2);
      pinch.distance = distance;
    } else if (drag && pointers.size === 1) {
      const dx = event.clientX - drag.x, dy = event.clientY - drag.y;
      if (Math.hypot(dx, dy) > 4) drag.moved = true;
      if (drag.moved) {
        if (!map.hasPointerCapture(event.pointerId)) map.setPointerCapture(event.pointerId);
        const before = svgPoint(previous.x, previous.y), after = svgPoint(event.clientX, event.clientY);
        setView({ ...view, x: view.x + before.x - after.x, y: view.y + before.y - after.y });
        suppressClick = true;
      }
    }
  });
  const endPointer = event => {
    pointers.delete(event.pointerId);
    if (pointers.size < 2) pinch = null;
    if (!pointers.size) drag = null;
  };
  map.addEventListener('pointerup', endPointer);
  map.addEventListener('pointercancel', endPointer);
  map.addEventListener('click', event => {
    if (suppressClick) { event.preventDefault(); event.stopImmediatePropagation(); suppressClick = false; }
  }, true);
  region.replaceChildren(new Option('大陆总览', ''), ...REGIONAL_PROFILES.map(row => new Option(row.name, row.id)));
  category.replaceChildren(new Option('全部类型', ''), ...Object.entries(PLACE_CATEGORIES).map(([id, name]) => new Option(name, id)));
  const visiblePlaces = () => PLACES.filter(place => atlasVisible(place, state));
  const matchesCategory = place => !category.value || placeCategory(place) === category.value;
  const mainPlace = place => ['主城', '城', '边镇', '港口'].includes(place.kind);
  const plannedRoute = () => {
    const here = atlasLocation(state);
    return here && selected && here.id !== selected.id ? findRoute(here.id, selected.id, state, mode) : null;
  };
  function hide() {
    sheet.classList.add('hidden');
    lastFocus?.focus();
  }
  close.onclick = hide;
  sheet.addEventListener('keydown', event => { if (event.key === 'Escape') hide(); });
  function selectPlace(place) {
    const changedRegion = region.value !== place.region;
    selected = place;
    region.value = place.region;
    if (!matchesCategory(place)) category.value = '';
    search.value = '';
    render(changedRegion);
  }
  function drawMap(reset = false) {
    const visible = visiblePlaces();
    const focus = ATLAS_PROFILES[region.value], local = visible.filter(place => place.region === region.value);
    const points = local.length ? local : focus ? [focus] : [];
    if (points.length) {
      const xs = points.map(p => p.x), ys = points.map(p => p.y);
      const x = Math.min(...xs) - 100, y = Math.min(...ys) - 68;
      homeView = { x, y, width: Math.max(220, Math.max(...xs) - x + 105), height: Math.max(152, Math.max(...ys) - y + 75) };
    } else homeView = { x: 0, y: 0, width: 1000, height: 650 };
    if (reset || !view) setView({ ...homeView });
    map.replaceChildren();
    drawAtlasArt(map);
    for (const feature of TERRAIN) {
      map.append(svgNode('text', { x: feature.x, y: feature.y, class: 'atlas-terrain ' + feature.type }, feature.name));
    }
    const ids = new Set(visible.map(place => place.id));
    const active = new Set((state?.journey?.route || plannedRoute())?.legs.map(leg => leg.id));
    const shown = visible.filter(place => matchesCategory(place) && (focus ? place.region === focus.id : Boolean(category.value) || mainPlace(place)));
    const shownIds = new Set(shown.map(place => place.id));
    for (const route of ROUTES) {
      if (!ids.has(route.a) || !ids.has(route.b) || route.restricted && !state?.atlasPasses?.includes(route.id)) continue;
      if (!active.has(route.id) && !shownIds.has(route.a) && !shownIds.has(route.b)) continue;
      if (!active.has(route.id) && !focus && !category.value && !(route.sea || route.river || shownIds.has(route.a) && shownIds.has(route.b))) continue;
      const points = routePoints(route).map(point => point.join(',')).join(' ');
      map.append(svgNode('polyline', { points,
        class: ['atlas-link', (route.sea || route.river) && 'sea', route.river && 'river', route.footOnly && 'foot-only', active.has(route.id) && 'active'].filter(Boolean).join(' ') }));
    }
    if (!focus) for (const row of REGIONAL_PROFILES) {
      const label = svgNode('text', { x: row.x, y: row.y - 15, class: 'atlas-region-label' }, row.name);
      label.onclick = () => { region.value = row.id; selected = null; render(true); };
      map.append(label);
    }
    const here = atlasLocation(state);
    const priority = [...new Set([selected, here, ...shown].filter(Boolean))];
    const labels = [];
    for (const place of priority) {
      const type = placeCategory(place);
      const wantedLabel = focus && (category.value || mainPlace(place) || place === selected || place === here);
      const mark = place.kind === '主城' ? svgNode('path', { d: `M${place.x - 7} ${place.y + 4}v-8h3v-4h3v4h3v-4h3v4h3v8z` })
        : ['城', '镇', '边镇', '村'].includes(place.kind) ? svgNode('path', { d: `M${place.x - 5} ${place.y}l5-5 5 5v5h-10z` })
        : type === 'heritage' ? svgNode('path', { d: `M${place.x} ${place.y - 5}l5 5-5 5-5-5z` })
          : svgNode('circle', { cx: place.x, cy: place.y, r: focus ? 4.3 : 3.5 });
      const group = svgNode('g', { class: 'atlas-mark ' + type + (selected?.id === place.id ? ' selected' : '') });
      group.append(mark);
      group.append(svgNode('title', {}, place.name));
      const label = { x: place.x + 7, y: place.y + 4, width: place.name.length * 12 };
      if (wantedLabel && !labels.some(other => Math.abs(other.y - label.y) < 13
        && other.x < label.x + label.width && label.x < other.x + other.width)) {
        group.append(svgNode('text', { x: label.x, y: label.y }, place.name));
        labels.push(label);
      }
      group.onclick = () => selectPlace(place);
      map.append(group);
    }
    const traveling = state?.journey && routePosition(state.journey, 0);
    let point = here;
    if (traveling?.leg) {
      const { leg, remaining } = traveling;
      point = positionAlong(leg, remaining / leg.minutes);
    }
    if (point) map.append(svgNode('circle', { cx: point.x, cy: point.y, r: 10, class: 'atlas-you' }));
  }
  function action(label, value) {
    const button = node('button', label, 'ghost');
    button.type = 'button';
    button.onclick = () => { hide(); onPlan(value); };
    return button;
  }
  function drawInfo() {
    info.replaceChildren();
    const row = ATLAS_PROFILES[selected?.region || region.value];
    if (selected) {
      info.append(node('h2', selected.name), node('p', `${selected.kind} · ${atlasTitle(selected)}`, 'hint'), node('p', selected.description));
      const nearby = routeLegs(selected.id, state);
      if (nearby.length) {
        const details = node('details');
        details.append(node('summary', '相邻地点与道路'));
        for (const leg of nearby) {
          const destination = atlasPlace(leg.to);
          const button = node('button', `${destination.name} · ${leg.terrain} · ${leg.km} 公里`, 'ghost atlas-neighbor');
          button.type = 'button';
          button.onclick = () => { selectPlace(destination); info.querySelector('summary')?.focus(); };
          details.append(button);
        }
        info.append(details);
      }
      const here = atlasLocation(state);
      if (here && here.id !== selected.id) {
        const label = node('label', '出行方式');
        const select = node('select', '', 'name-input');
        select.replaceChildren(...Object.entries(MODES).map(([id, name]) => new Option(name, id)));
        select.value = mode;
        select.onchange = () => { mode = select.value; drawMap(); drawInfo(); info.querySelector('select')?.focus(); };
        label.append(select);
        info.append(label);
        const route = plannedRoute();
        if (route) {
          const modes = [...new Set(route.legs.map(leg => MODES[leg.mode]))].join('、');
          info.append(node('p', routeLabel(route)), node('p', `${route.km} 公里 · ${durationLabel(route.minutes)} · ${modes}`, 'hint'),
            action('规划前往', `${MODES[mode]}前往${selected.name}`));
        } else info.append(node('p', '暂无可通行的地图路线。', 'hint'));
      }
    }
    if (state?.journey) {
      info.append(node('p', `仍在途中 · 剩余约 ${durationLabel(state.journey.route.minutes - state.journey.elapsed)}`, 'hint'),
        action('继续赶路', '继续赶路'), action('原路返回', '原路返回'));
    } else if (state && !atlasLocation(state) && selected) {
      const label = node('label', '确认所选地点是当前场景附近已知的地图地点');
      const locate = node('button', '关联到' + selected.name, 'ghost');
      locate.type = 'button';
      locate.onclick = async () => {
        locate.disabled = true;
        try {
          state = await onLocate(selected, state);
          $('current').textContent = `当前位置 · ${state.player.location.siteName}（靠近${selected.name}）`;
          render();
        } catch (error) { label.append(node('p', error.message, 'hint')); }
        finally { locate.disabled = false; }
      };
      label.append(locate);
      info.append(label);
    }
    if (row) {
      const details = node('details');
      details.open = !selected;
      details.append(node('summary', `${row.name}设定`), node('p', row.canon));
      const terms = node('dl');
      for (const [label, value] of Object.entries(row.details)) terms.append(node('dt', label), node('dd', value));
      details.append(terms);
      info.append(details);
    } else info.append(node('p', '选择一个区域或地点查看设定。', 'hint'));
  }
  function drawPlaces() {
    const terms = search.value.trim().split(/\s+/).filter(Boolean);
    const filtered = visiblePlaces().filter(place => matchesCategory(place) && (terms.length
      ? terms.every(term => [place.name, place.kind, atlasTitle(place), place.description].some(value => value.includes(term)))
      : region.value ? place.region === region.value : category.value || mainPlace(place)));
    $('count').textContent = `${filtered.length} 个地点` + (!region.value && !category.value && !terms.length ? ' · 总览列出主要城镇和港口' : '');
    places.replaceChildren(...filtered.map(place => {
      const button = node('button', place.name, 'ghost');
      button.type = 'button';
      button.setAttribute('aria-pressed', String(place.id === selected?.id));
      button.onclick = () => { selectPlace(place); info.querySelector('button, summary')?.focus(); };
      return button;
    }));
    if (!filtered.length) places.append(node('p', terms.length ? '没有找到符合条件的地点。' : '这里暂无这类公开地点。', 'hint'));
  }
  function render(reset = false) { drawMap(reset); drawPlaces(); drawInfo(); }
  region.onchange = () => { selected = null; search.value = ''; render(true); };
  category.onchange = () => { if (selected && !matchesCategory(selected)) selected = null; render(); };
  search.oninput = drawPlaces;
  return current => {
    state = current;
    selected = null;
    region.value = category.value = search.value = '';
    lastFocus = document.activeElement;
    $('current').textContent = state ? `当前位置 · ${state.player.location.siteName}` + (!state.journey && !atlasLocation(state) ? '（未定位到共用地图）' : '') : '大陆总览';
    sheet.classList.remove('hidden');
    render(true);
    close.focus();
    sheet.scrollTop = 0;
  };
}
