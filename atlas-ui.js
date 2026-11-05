import { PLACES, REGIONAL_PROFILES, ATLAS_PROFILES, TERRAIN, ROUTES } from './engine/atlas-data.js';
import { atlasLocation, atlasPlace, atlasTitle, atlasVisible, findRoute, routePosition, MODES, routeLabel, durationLabel } from './engine/atlas.js';

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

export function setupAtlas({ onPlan, onLocate }) {
  const $ = id => document.getElementById('atlas-' + id);
  const sheet = $('sheet'), close = $('close'), region = $('region'), search = $('search');
  const map = $('map'), places = $('places'), info = $('info');
  let state, selected, mode = 'walk', lastFocus;
  region.replaceChildren(new Option('大陆总览', ''), ...REGIONAL_PROFILES.map(row => new Option(row.name, row.id)));
  const visiblePlaces = () => PLACES.filter(place => atlasVisible(place, state));
  function hide() {
    sheet.classList.add('hidden');
    lastFocus?.focus();
  }
  close.onclick = hide;
  sheet.addEventListener('keydown', event => { if (event.key === 'Escape') hide(); });
  function selectPlace(place) {
    selected = place;
    region.value = place.region;
    search.value = '';
    render();
  }
  function drawMap() {
    const visible = visiblePlaces();
    const focus = ATLAS_PROFILES[region.value], local = visible.filter(place => place.region === region.value);
    const points = local.length ? local : focus ? [focus] : [];
    if (points.length) {
      const xs = points.map(p => p.x), ys = points.map(p => p.y);
      const x = Math.min(...xs) - 100, y = Math.min(...ys) - 68;
      map.setAttribute('viewBox', [x, y, Math.max(220, Math.max(...xs) - x + 105), Math.max(152, Math.max(...ys) - y + 75)].join(' '));
    } else map.setAttribute('viewBox', '0 0 1000 650');
    map.replaceChildren(svgNode('path', { d: 'M170 290L154 204 215 145 306 151 360 87 492 43 671 77 731 153 809 191 891 285 873 386 889 470 813 552 724 587 674 557 618 531 530 539 470 513 374 531 296 523 245 512 193 473 180 397 151 350Z M350 555l27 -19 28 24 -27 19z M421 550l29 -19 32 14 -10 28 -41 7z M469 582l22 -15 21 15 -12 17z', class: 'atlas-land' }));
    for (const feature of TERRAIN) {
      map.append(svgNode('text', { x: feature.x, y: feature.y, class: 'atlas-terrain ' + feature.type }, feature.name));
    }
    const ids = new Set(visible.map(place => place.id));
    const active = new Set(state?.journey?.route.legs.map(leg => leg.id));
    for (const route of ROUTES) {
      if (!ids.has(route.a) || !ids.has(route.b) || route.restricted && !state?.atlasPasses?.includes(route.id)) continue;
      const a = atlasPlace(route.a), b = atlasPlace(route.b);
      map.append(svgNode('line', { x1: a.x, y1: a.y, x2: b.x, y2: b.y,
        class: ['atlas-link', route.sea && 'sea', active.has(route.id) && 'active'].filter(Boolean).join(' ') }));
    }
    if (!focus) for (const row of REGIONAL_PROFILES) {
      const label = svgNode('text', { x: row.x, y: row.y - 15, class: 'atlas-region-label' }, row.name);
      label.onclick = () => { region.value = row.id; selected = null; render(); };
      map.append(label);
    }
    for (const place of visible) {
      const localLabel = Boolean(focus && place.region === focus.id);
      const mark = place.kind === '主城' ? svgNode('path', { d: `M${place.x} ${place.y - 6}l6 10h-12z` })
        : svgNode('circle', { cx: place.x, cy: place.y, r: localLabel ? 4.3 : 3.5 });
      const group = svgNode('g', { class: 'atlas-mark' + (selected?.id === place.id ? ' selected' : '') });
      group.append(mark);
      if (localLabel) group.append(svgNode('text', { x: place.x + 7, y: place.y + 4 }, place.name));
      group.onclick = () => selectPlace(place);
      map.append(group);
    }
    const here = atlasLocation(state);
    const traveling = state?.journey && routePosition(state.journey, 0);
    let point = here;
    if (traveling?.leg) {
      const { leg, remaining } = traveling, a = atlasPlace(leg.from), b = atlasPlace(leg.to), t = remaining / leg.minutes;
      point = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
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
      const here = atlasLocation(state);
      if (here && here.id !== selected.id) {
        const label = node('label', '出行方式');
        const select = node('select', '', 'name-input');
        select.replaceChildren(...Object.entries(MODES).map(([id, name]) => new Option(name, id)));
        select.value = mode;
        select.onchange = () => { mode = select.value; drawInfo(); info.querySelector('select')?.focus(); };
        label.append(select);
        info.append(label);
        const route = findRoute(here.id, selected.id, state, mode);
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
    const term = search.value.trim();
    const filtered = visiblePlaces().filter(place => term ? (place.name + atlasTitle(place)).includes(term) : !region.value || place.region === region.value);
    places.replaceChildren(...filtered.map(place => {
      const button = node('button', place.name, 'ghost');
      button.type = 'button';
      button.setAttribute('aria-pressed', String(place.id === selected?.id));
      button.onclick = () => { selectPlace(place); info.querySelector('button, summary')?.focus(); };
      return button;
    }));
    if (!filtered.length) places.append(node('p', term ? '没有找到这个地点。' : '本区暂无公开城镇。', 'hint'));
  }
  function render() { drawMap(); drawPlaces(); drawInfo(); }
  region.onchange = () => { selected = null; search.value = ''; render(); };
  search.oninput = drawPlaces;
  return current => {
    state = current;
    selected = null;
    region.value = search.value = '';
    lastFocus = document.activeElement;
    $('current').textContent = state ? `当前位置 · ${state.player.location.siteName}` + (!state.journey && !atlasLocation(state) ? '（未定位到共用地图）' : '') : '大陆总览';
    sheet.classList.remove('hidden');
    render();
    close.focus();
    sheet.scrollTop = 0;
  };
}
