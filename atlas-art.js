// The illustration uses the same 1000 × 650 drawing area as the interactive atlas.
export function drawAtlasArt(map) {
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
}
