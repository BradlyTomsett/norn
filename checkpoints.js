// Each checkpoint either stores its state or a smaller reversible patch against the current save.
const json = value => JSON.parse(JSON.stringify(value));
const safe = key => !['__proto__','prototype','constructor'].includes(String(key));
function diff(from, to, path = [], out = []) {
  if (JSON.stringify(from) === JSON.stringify(to)) return out;
  if (from && to && typeof from === 'object' && typeof to === 'object' && Array.isArray(from) === Array.isArray(to)) {
    for (const key of Object.keys(from)) if (!Object.hasOwn(to, key)) out.push(['del', [...path, key]]);
    for (const key of Object.keys(to)) {
      if (!safe(key)) throw new Error('回档记录含无效字段');
      if (Object.hasOwn(from, key)) diff(from[key], to[key], [...path, key], out);
      else out.push(['set', [...path, key], to[key]]);
    }
    if (Array.isArray(to) && from.length !== to.length) out.push(['length', path, to.length]);
  } else out.push(['set', path, to]);
  return out;
}
export function packPoints(state, points) {
  const base = json(state);
  return points.map(point => {
    const target = json(point.state), patch = diff(base, target);
    // The storage transaction stamps the current save after packing, so anchor metadata cannot be assumed equal.
    for (const key of ['revision','updatedAt']) patch.push(Object.hasOwn(target,key) ? ['set',[key],target[key]] : ['del',[key]]);
    const packed = { turn: point.turn, historyCount: point.historyCount, patch };
    return JSON.stringify(packed).length < JSON.stringify(point).length ? packed : json(point);
  });
}
export function unpackPoints(state, points) {
  return points.map(point => {
    if (point.state) return structuredClone(point);
    if (!Array.isArray(point.patch)) throw new Error('回档记录无效');
    let result = json(state);
    for (const [op, path, value] of point.patch) {
      if (!Array.isArray(path) || path.some(key => !safe(key))) throw new Error('回档记录无效');
      if (!path.length && op === 'set') { result = json(value); continue; }
      let parent = result;
      for (const key of path.slice(0, -1)) { if (!parent || !Object.hasOwn(parent, key)) throw new Error('回档记录无效'); parent = parent[key]; }
      if (op === 'length') {
        const array = path.length ? parent?.[path.at(-1)] : result;
        if (!Array.isArray(array) || !Number.isSafeInteger(value) || value < 0 || value > 1000000) throw new Error('回档记录无效');
        array.length = value;
      } else if (parent && path.length && op === 'set') parent[path.at(-1)] = json(value);
      else if (parent && path.length && op === 'del') delete parent[path.at(-1)];
      else throw new Error('回档记录无效');
    }
    return { turn: point.turn, historyCount: point.historyCount, state: result };
  });
}
