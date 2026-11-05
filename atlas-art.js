import { SURVEY_LAND, SURVEY_WATERWAYS } from './engine/atlas-expansion.js';

// Artwork is drawn in the same coordinate system as the fixed atlas and routes.
const coastPoints = [[170,290],[154,204],[215,145],[306,151],[360,87],[492,43],[671,77],[731,153],[809,191],
  [891,285],[873,386],[889,470],[813,552],[724,587],[674,557],[618,531],[530,539],[470,513],[374,531],
  [296,523],[245,512],[193,473],[180,397],[151,350]];
function roundedCoast(points) {
  const corner = (a, b, amount) => [a[0] + (b[0] - a[0]) * amount, a[1] + (b[1] - a[1]) * amount];
  const start = corner(points[0], points.at(-1), .08);
  return `M${start.join(' ')}` + points.map((point, i) => {
    const next = corner(point, points[(i + 1) % points.length], .08);
    const before = corner(point, points[(i + points.length - 1) % points.length], .08);
    return `L${before.join(' ')} Q${point.join(' ')} ${next.join(' ')}`;
  }).join(' ') + 'Z';
}
const coast = roundedCoast(coastPoints) + ' M350 555l27 -19 28 24 -27 19z M421 550l29 -19 32 14 -10 28 -41 7z M469 582l22 -15 21 15 -12 17z';
const svg = (name, attrs = {}, value = '') => {
  const element = document.createElementNS('http://www.w3.org/2000/svg', name);
  for (const [key, item] of Object.entries(attrs)) element.setAttribute(key, item);
  if (value) element.textContent = value;
  return element;
};

function grove(layer, x, y, columns, rows, seed) {
  for (let row = 0; row < rows; row++) for (let col = 0; col < columns; col++) {
    const n = Math.sin((seed + row * 37 + col * 19) * 13.7) * 43758.5453;
    const jitter = (n - Math.floor(n)) * 10;
    const px = x + col * 11 + (row % 2) * 5 + jitter - 5;
    const py = y + row * 11 + Math.sin(n) * 4;
    const size = 4.5 + jitter / 5;
    layer.append(svg('path', { d: `M${px} ${py + 3}v5m-${size} -5  ${size} -${size * 1.7} ${size} ${size * 1.7}z`, class: 'atlas-tree' }));
  }
}

function mountains(layer, x, y, count, dx, dy, scale = 1) {
  for (let i = 0; i < count; i++) {
    const px = x + dx * i, py = y + dy * i, s = scale * (1 + (i % 3) * .18);
    layer.append(svg('path', { d: `M${px - 13 * s} ${py + 7 * s}l${13 * s} -${24 * s} ${14 * s} ${24 * s}z`, class: 'atlas-mountain' }));
    layer.append(svg('path', { d: `M${px} ${py - 17 * s}l${3 * s} ${10 * s}-${2 * s} ${3 * s} ${5 * s} ${11 * s}`, class: 'atlas-ridge' }));
    layer.append(svg('path', { d: `M${px} ${py - 17 * s}l${5 * s} ${9 * s}-${4 * s} -${2 * s}-${3 * s} 3z`, class: 'atlas-snow' }));
  }
}

export function drawAtlasArt(map) {
  const defs = svg('defs');
  const clip = svg('clipPath', { id: 'atlas-land-clip' });
  clip.append(svg('path', { d: coast }), ...SURVEY_LAND.map(d => svg('path', { d })));
  const grain = svg('pattern', { id: 'atlas-grain', width: 30, height: 30, patternUnits: 'userSpaceOnUse' });
  grain.append(svg('circle', { cx: 4, cy: 7, r: .7 }), svg('circle', { cx: 21, cy: 19, r: .6 }),
    svg('path', { d: 'M10 23l3 -1 M23 5l3 1', stroke: 'currentColor', 'stroke-width': '.55' }));
  const water = svg('pattern', { id: 'atlas-waves', width: 46, height: 32, patternUnits: 'userSpaceOnUse' });
  water.append(svg('path', { d: 'M4 8q5 -3 10 0t10 0 M23 23q5 -3 10 0t10 0', fill: 'none', stroke: '#a5c3bf', 'stroke-width': '.8', opacity: '.25' }));
  defs.append(clip, grain, water);
  map.append(defs, svg('rect', { x: -3000, y: -3000, width: 7000, height: 7000, class: 'atlas-ocean' }),
    svg('rect', { x: -200, y: -200, width: 1400, height: 1050, fill: 'url(#atlas-waves)' }));
  map.append(svg('path', { d: coast, class: 'atlas-coast-shadow' }),
    svg('path', { d: coast, class: 'atlas-land' }));
  for (const d of SURVEY_LAND) map.append(svg('path', { d, class: 'atlas-land' }));
  const land = svg('g', { 'clip-path': 'url(#atlas-land-clip)', 'aria-hidden': 'true' });
  land.append(svg('path', { d: 'M130 130 Q210 100 306 169 L340 237 298 290 225 280 153 240Z', class: 'atlas-forest-wash' }),
    svg('path', { d: 'M463 430 Q525 419 594 459 L612 533 500 545 453 502Z', class: 'atlas-forest-wash' }),
    svg('path', { d: 'M682 408 Q746 376 816 405 L873 480 817 557 725 585 677 531Z', class: 'atlas-forest-wash' }),
    svg('path', { d: 'M575 102 Q625 95 693 146 L707 186 676 208 615 188 590 161Z', class: 'atlas-sand-wash' }),
    svg('path', { d: 'M395 71 Q505 37 666 78 L687 126 636 143 540 122 476 144 411 120Z', class: 'atlas-snow-wash' }),
    svg('path', { d: 'M305 382 Q379 365 475 390 L477 450 403 466 322 443Z', class: 'atlas-meadow-wash' }));
  grove(land, 172, 162, 12, 7, 4);
  grove(land, 277, 219, 5, 5, 7);
  grove(land, 487, 452, 10, 7, 11);
  grove(land, 707, 429, 13, 10, 22);
  mountains(land, 694, 190, 10, 13, 12, .75);
  mountains(land, 458, 90, 9, 20, 2, .68);
  mountains(land, 235, 302, 5, 10, 4, .48);
  for (let i = 0; i < 17; i++) {
    const x = 610 + (i % 6) * 13, y = 131 + Math.floor(i / 6) * 13;
    land.append(svg('path', { d: `M${x} ${y}q6 -5 12 0`, class: 'atlas-dune' }));
  }
  for (let i = 0; i < 22; i++) {
    const x = 340 + (i % 7) * 16, y = 397 + Math.floor(i / 7) * 14;
    land.append(svg('path', { d: `M${x} ${y}l-2 -4m2 4 3 -5m-1 5 4 -3`, class: 'atlas-grass' }));
  }
  land.append(svg('rect', { x: 100, y: 0, width: 850, height: 650, fill: 'url(#atlas-grain)', class: 'atlas-grain' }));
  map.append(land);
  map.append(svg('ellipse', { cx: 228, cy: 145, rx: 25, ry: 12, class: 'atlas-lake' }));
  for (const d of SURVEY_WATERWAYS) map.append(svg('path', { d, class: 'atlas-river' }));
  const compass = svg('g', { transform: 'translate(91 92)', class: 'atlas-compass', 'aria-hidden': 'true' });
  compass.append(svg('circle', { r: 30 }), svg('circle', { r: 24 }),
    svg('path', { d: 'M0 -24L5 -5 24 0 5 5 0 24 -5 5 -24 0 -5 -5Z' }),
    svg('path', { d: 'M0 -24L0 24 M-24 0L24 0' }), svg('text', { x: 0, y: -35 }, '北'));
  map.append(compass);
  const title = svg('g', { class: 'atlas-cartouche', 'aria-hidden': 'true' });
  title.append(svg('path', { d: 'M42 565h185l9 9-9 9H42l-9-9z' }),
    svg('text', { x: 134, y: 576 }, '诺 恩 · 已 测 之 地'),
    svg('text', { x: 134, y: 595, class: 'atlas-cartouche-sub' }, '陆路 · 水道 · 海路'));
  map.append(title);
}
