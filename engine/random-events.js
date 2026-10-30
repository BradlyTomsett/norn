import { makeRng } from './rng.js';

// Directions, not pre-written facts: the model builds a scene from the actual context.
export const EVENT_TYPES = [
  { id: 'road_robbery', label: '道路劫持或拦路', scenes: ['road'], weight: 3, prompt: '有人出于具体目的拦路，可能交涉、欺骗或威胁；先呈现局面，让玩家决定如何应对。' },
  { id: 'road_encounter', label: '旅途相遇或求助', scenes: ['road'], weight: 5, prompt: '旅途中遇到商队、旅人、求助或道路变故，人物目的与地点相符。' },
  { id: 'animal', label: '动物或魔兽遭遇', scenes: ['road', 'wild'], weight: 5, prompt: '依据地形出现动物或魔兽的踪迹、接近或袭击；考虑护幼、饥饿、受惊，也可避开冲突。' },
  { id: 'theft', label: '盗窃、诈骗或可疑行为', scenes: ['town', 'work'], weight: 4, prompt: '出现偷窃、诈骗或可疑行为，可针对现场其他人；不要预设成功，丢失只记录实际发生的结果。' },
  { id: 'magic', label: '魔法事故或奇异现象', scenes: ['town', 'work', 'wild', 'road'], weight: 2, prompt: '出现符合世界与场所的法术失控、奇异痕迹或魔法现象，遵守玩家天赋及免疫范围。' },
  { id: 'task', label: '当前委托的新动静', scenes: ['work'], weight: 6, prompt: '结合当前有效委托与已知事实，出现合理的新线索、人员动向或工作变数；不推翻已办妥的事。' },
  { id: 'person', label: '人物互动或消息', scenes: ['town', 'work', 'road', 'wild', 'home'], weight: 5, prompt: '在场人物或能够合理联系到的人带来消息、谈论计划或提出请求；关系和知情范围沿用已有记录。' },
  { id: 'town', label: '城镇生活与机会', scenes: ['town'], weight: 5, prompt: '出现集市、招聘、行会、工坊、节庆或治安方面的合理变化，可以平静也可以有选择。' },
  { id: 'environment', label: '天气或环境变化', scenes: ['road', 'wild', 'town', 'work'], weight: 4, prompt: '根据季节、天气和地点出现环境变化或自然线索，不凭空改变地形。' },
  { id: 'discovery', label: '线索、旧址或遗落物', scenes: ['road', 'wild', 'work'], weight: 3, prompt: '发现值得留意的痕迹、旧址或物件，不自动取得或认定价值、主人及真相。' },
  { id: 'opportunity', label: '偶遇或有利机会', scenes: ['road', 'wild', 'town', 'work', 'home'], weight: 4, prompt: '出现友善相遇、学习机会、实际帮助或值得考虑的提议；是否接受由玩家决定。' },
  { id: 'incident', label: '事故或紧急情况', scenes: ['town', 'work', 'road'], weight: 3, prompt: '出现与场景相符的事故或紧急状况，有具体原因，不强迫玩家承担义务。' },
];

export function eventScene(state, judged, input) {
  const text = `${state.player.location?.siteName || ''} ${input || ''}`;
  if (judged.travelScope === 'journey' || judged.travelScope === 'route' || /赶路|旅途|荒野|野外|山路/.test(text)) return /荒野|野外|森林|树林|山林/.test(text) ? 'wild' : 'road';
  if (/仓|守夜|值守|调查|委托|工作|工坊|货栈/.test(text)) return 'work';
  if (/森林|树林|山林|野外|荒野|山洞|矿洞/.test(text)) return 'wild';
  if (/家中|卧室|自己家|家里/.test(text)) return 'home';
  return 'town';
}

export function selectRandomEvent(state, judged, input, frequency = 'medium') {
  const minutes = Math.max(0, Number(judged.minutes) || 0);
  if (minutes < 30 || ['meta', 'combat', 'social', 'trade'].includes(judged.kind)) return null;
  const last = state.randomEvents?.at(-1);
  if (last && Number(state.turn) - Number(last.turn) < 2) return null;
  const factor = { low: 0.04, medium: 0.09, high: 0.18 }[frequency] ?? 0.09;
  const rng = makeRng(((state.seed || 1) ^ Math.imul((state.turn || 0) + 1, 0x9e3779b1) ^ 0x5ad41) >>> 0);
  if (rng() >= 1 - Math.exp(-factor * Math.min(minutes / 60, 48))) return null;
  const scene = eventScene(state, judged, input);
  const recent = new Set((state.randomEvents || []).slice(-4).map(row => row.type));
  let pool = EVENT_TYPES.filter(row => row.scenes.includes(scene) && (row.id !== 'task' || state.player.contracts?.some(c => c.status === 'active') || state.player.unfinished?.length));
  const fresh = pool.filter(row => !recent.has(row.id)); if (fresh.length) pool = fresh;
  const total = pool.reduce((sum, row) => sum + row.weight, 0);
  let roll = rng() * total;
  const selected = pool.find(row => (roll -= row.weight) < 0) || pool.at(-1);
  return selected ? { type: selected.id, label: selected.label, prompt: selected.prompt, scene } : null;
}

export function eventPrompt(event) {
  if (!event) return '';
  return `【引擎触发的随机事件】类型：${event.label}。${event.prompt}\n根据本轮开始时刻、行动、地点、天气、人物关系、当前任务和相关历史，生成具体经过；发生时刻由你选择，并写清准确的游戏时间。事件发生在正文实际经过的时间内，不得把不在场的人写成在场。需要玩家决定的危机在发生时停下，正文以此时刻结束，等待玩家选择；普通背景变化可继续。不要替玩家付款、交易、接受委托、攻击或决定，不强加新的任务；只把实际发生的状态变化记入JSON，遵守现有装备与天赋。`;
}

export function recordRandomEvent(state, event, id) {
  if (!event) return;
  state.randomEvents = [...(state.randomEvents || []).filter(row => row.id !== id), { id, type: event.type, turn: state.turn }].slice(-20);
}
