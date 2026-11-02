import { makeRng } from './rng.js';
import { OPTION_HEADING } from './actions.js';

// Directions, not pre-written facts: the model builds a scene from the actual context.
export const EVENT_TYPES = [
  { id: 'road_robbery', label: '道路劫持或拦路', scenes: ['road', 'wild'], weight: 3, prompt: '有人出于具体目的拦路，可能交涉、欺骗或威胁；先呈现局面，让玩家决定如何应对。' },
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
  const place = state.player.location?.siteName || '', action = String(input || '');
  if (judged.travelScope === 'journey' || judged.travelScope === 'route') return 'road';
  if (/森林|树林|山林|野外|荒野|山洞|矿洞/.test(place)) return 'wild';
  if (/家中|卧室|自己家|家里|旅店客房/.test(place)) return 'home';
  if (/仓库|库房|工坊|货栈/.test(place) || /(?:在|于)(?:仓库|库房|工坊|货栈)(?:里|内)?(?:守夜|值守|工作)/.test(action)) return 'work';
  return 'town';
}

const activeEvent = row => ['pending', 'introduced'].includes(row.status);
function addressesEvent(row, input) {
  const text = String(input || '');
  const common = /(?:回应|回答|拒绝|接受)(?:他|她|它|他们|对方|强盗|劫匪|那人|这件事)|(?:交出|交给)(?:钱|财物|货物)|逃跑|逃走|反击|投降|求饶/;
  const keywords = { road_robbery: /劫匪|强盗|拦路/, animal: /野兽|魔兽|动物/, theft: /小偷|盗贼|盗窃/, magic: /法术|魔法|失控/, incident: /事故|伤者/ };
  return common.test(text) || Boolean(keywords[row.type]?.test(text));
}

export function selectRandomEvent(state, judged, input, frequency = 'medium') {
  if (judged.kind === 'meta') return null;
  const ongoing = state.randomEvents?.findLast(e => activeEvent(e) && ((e.missingUpdates || 0) < 2 || addressesEvent(e, input)));
  if (ongoing) {
    const type = EVENT_TYPES.find(e => e.id === ongoing.type);
    if (type) return { ...type, type: type.id, id: ongoing.id, scene: ongoing.scene, continuing: true, summary: ongoing.text || type.label };
  }
  const minutes = Math.max(0, Number(judged.minutes) || 0);
  if (minutes < 30 || ['meta', 'combat', 'social', 'trade'].includes(judged.kind)) return null;
  const last = state.randomEvents?.at(-1);
  if (last && Number(state.turn) - Number(last.turn) < 2) return null;
  const scene = eventScene(state, judged, input);
  const safe = scene === 'home' || /旅店|教堂|公会大厅/.test(state.player.location?.siteName || '');
  const factor = ({ low: 0.04, medium: 0.09, high: 0.18 }[frequency] ?? 0.09) * (safe ? 0.5 : 1);
  const rng = makeRng(((state.seed || 1) ^ Math.imul((state.turn || 0) + 1, 0x9e3779b1) ^ 0x5ad41) >>> 0);
  if (rng() >= 1 - Math.exp(-factor * Math.min(minutes / 60, 48))) return null;
  const recent = new Set((state.randomEvents || []).slice(-4).map(row => row.type));
  const hasTask = state.player.contracts?.some(c => c.status === 'active') || state.player.unfinished?.length;
  let pool = EVENT_TYPES.filter(row => (row.scenes.includes(scene) || row.id === 'task' && hasTask && /调查|守夜|工作|委托/.test(input)) && (row.id !== 'task' || hasTask))
    .map(row => ({ ...row, weight: row.weight * (safe && ['theft','magic','incident','road_robbery'].includes(row.id) ? 0.2 : 1) }));
  const fresh = pool.filter(row => !recent.has(row.id)); if (fresh.length) pool = fresh;
  const total = pool.reduce((sum, row) => sum + row.weight, 0);
  let roll = rng() * total;
  const selected = pool.find(row => (roll -= row.weight) < 0) || pool.at(-1);
  return selected ? { type: selected.id, label: selected.label, prompt: selected.prompt, scene } : null;
}

export function eventPrompt(event, { state, judged } = {}) {
  if (!event) return '';
  const contracts = state?.player?.contracts?.filter(c => c.status === 'active').map(c => c.label) || [];
  return `【引擎触发的随机事件】类型：${event.label}。${event.prompt}${event.continuing ? `\n承接同一事件：${event.summary}。优先处理眼前情况，不另起一次遭遇。` : ''}\n场景分类：${event.scene}；起始地点：${state?.player?.location?.siteName || '未知'}；当前行动：${judged?.actionText || '依玩家原文'}；现有委托：${contracts.join('、') || '无已登记委托'}。仅在确实相关时联系这些委托，不制造已有事实之外的关联。先描述迹象或眼前局面；普通背景变化可以结束或继续，必须立即决定的危机停在发生时刻，等待玩家选择。根据本轮开始时刻、天气、人物关系和历史生成具体经过，选择并写清实际经过时间内的发生时刻，不得把不在场的人写成在场。不要替玩家付款、交易、接受委托、攻击或决定，不强加新的任务；只把实际发生的状态变化记入JSON，遵守现有装备与天赋。结尾JSON用eventUpdate:{status:"pending|resolved|left",text:"本次事件当前局面简记"}报告阶段：等待选择为pending，实际解决为resolved，玩家已离开为left。`;
}

export function recordRandomEvent(state, event, id, update) {
  if (!event) return;
  const eventId = event.id || id;
  const previous = (state.randomEvents || []).find(row => row.id === eventId);
  const validStatus = ['pending','resolved','left'].includes(update?.status);
  const status = validStatus ? update.status : previous?.status || 'introduced';
  const text = typeof update?.text === 'string' ? update.text.slice(0, 600) : event.summary || event.label;
  const missingUpdates = validStatus ? 0 : (previous?.missingUpdates || 0) + 1;
  state.randomEvents = [...(state.randomEvents || []).filter(row => row.id !== eventId), { ...previous, id: eventId, type: event.type, scene: event.scene, text, status, missingUpdates, turn: state.turn }].slice(-20);
}

// Confirmed travel to a different location ends the encounter, unless the same reply explicitly continues it.
export function leaveRandomEvent(state, base, judged, input, event, update) {
  const before = base.player.location, after = state.player.location;
  const moved = before?.siteId && after?.siteId && before.siteId !== after.siteId;
  const departure = judged.travelScope === 'route' || judged.travelScope === 'journey' || /(?:离开|逃离|逃出|返回|回到)/.test(input);
  if (!moved || !departure) return;
  const old = base.randomEvents?.findLast(activeEvent);
  if (!old || (event?.id === old.id && ['pending', 'resolved', 'left'].includes(update?.status))) return;
  const row = state.randomEvents?.find(e => e.id === old.id && activeEvent(e));
  if (row) { row.status = 'left'; row.turn = state.turn; }
}

// Only unmistakable, type-specific completed events serve as a fallback when status is missing.
export function inferEventEnd(event, raw) {
  if (!event) return null;
  const patterns = {
    road_robbery: /(?:劫匪|强盗|拦路者)(?:们)?(?:已经|已|都|被)?(?:逃走了|逃跑了|离开了|击退了|制服了)/,
    animal: /(?:野兽|魔兽|动物)(?:们)?(?:已经|已|都|被)?(?:逃走了|逃跑了|离开了|击退了|制服了)/,
    magic: /(?:失控的魔法|魔法失控|失控的法术)(?:已经|已)?(?:平息了|消散了|停止了)/,
    theft: /(?:小偷|盗贼)(?:已经|已|被)?(?:抓住了|制服了|逃走了|离开了)/,
  };
  const pattern = patterns[event.type]; if (!pattern) return null;
  const prose = String(raw || '').split('```')[0].split(OPTION_HEADING)[0].replace(/“[^”]*”|「[^」]*」|『[^』]*』|"[^"\n]*"/g, '');
  const clear = prose.split(/[。！？；\n]/).some(part => !/如果|假如|可能|也许|似乎|打算|准备|希望|没有|并未|尚未|还没|未曾|不会|不要/.test(part) && pattern.test(part.replace(/\s/g, '')));
  return clear ? { status: 'resolved', text: event.summary || event.label } : null;
}
