import { REGION_IMAGES } from './atlas-regions.js';

// The world and its separately illustrated regions share the atlas drawing coordinates.
export function drawAtlasArt(map, region, bounds) {
  const namespace = 'http://www.w3.org/2000/svg';
  const background = document.createElementNS(namespace, 'rect');
  background.setAttribute('x', '-3000');
  background.setAttribute('y', '-3000');
  background.setAttribute('width', '7000');
  background.setAttribute('height', '7000');
  background.setAttribute('fill', '#123948');
  const image = document.createElementNS(namespace, 'image');
  image.setAttribute('href', './icons/norn-world.jpg');
  image.setAttribute('x', '0');
  image.setAttribute('y', '0');
  image.setAttribute('width', '1000');
  image.setAttribute('height', '650');
  image.setAttribute('preserveAspectRatio', 'none');
  image.setAttribute('pointer-events', 'none');
  image.setAttribute('aria-hidden', 'true');
  map.append(background, image);
  if (REGION_IMAGES[region] && bounds) {
    const detail = document.createElementNS(namespace, 'image');
    detail.setAttribute('href', REGION_IMAGES[region]);
    detail.setAttribute('x', bounds.x);
    detail.setAttribute('y', bounds.y);
    detail.setAttribute('width', bounds.width);
    detail.setAttribute('height', bounds.height);
    detail.setAttribute('preserveAspectRatio', 'none');
    detail.setAttribute('pointer-events', 'none');
    detail.setAttribute('aria-hidden', 'true');
    detail.addEventListener('error', () => detail.remove(), { once: true });
    map.append(detail);
  }
}
