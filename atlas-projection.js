// Visual registration of the fixed atlas against the approved illustration.
// These adjustments affect drawing only. Route distances and saved locations stay in the atlas.
const anchors = [
  [228, 145, 95, 25], [282, 251, 55, 0], [534, 130, 5, -52],
  [650, 170, 180, -65], [758, 260, 0, -55],
  [230, 345, -38, -60], [404, 402, -20, -75], [545, 361, -75, -55],
  [530, 469, -90, -65], [270, 497, -150, -85], [326, 478, -100, -60],
  [370, 559, -155, -35], [442, 556, -65, -25], [486, 580, -55, -20],
  [737, 456, 10, -25], [847, 466, 55, -30],
  [94, 286, -25, -55], [157, 480, -55, -100], [900, 340, 25, -60],
];

export function projectPoint(x, y) {
  let total = .22, dx = 0, dy = 0;
  for (const [ax, ay, shiftX, shiftY] of anchors) {
    const distance = Math.hypot(x - ax, y - ay);
    const weight = Math.exp(-(distance * distance) / (2 * 95 * 95));
    dx += shiftX * weight;
    dy += shiftY * weight;
    total += weight;
  }
  return { x: x + dx / total, y: y + dy / total };
}

export const projectPlace = place => ({ ...place, ...projectPoint(place.x, place.y) });
