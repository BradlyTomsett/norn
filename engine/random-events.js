import { makeRng } from './rng.js';
import { OPTION_HEADING } from './actions.js';
import { atlasLocation, placeCategory } from './atlas.js';

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
  { id: 'town_bullying', label: '街头欺凌与求助', scenes: ['town'], weight: 3, prompt: '在街道、集市等公开场所，有恶霸仗势欺负行人，被欺负的人在合理注意到玩家后向玩家求助。交代眼前局面和各方动机，让玩家决定是帮助、劝阻、找守卫还是离开；不得替玩家出手或预设事件结果。' },
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
  const fixed = atlasLocation(state);
  if (fixed && ['nature', 'heritage'].includes(placeCategory(fixed))) return 'wild';
  return 'town';
}

const activeEvent = row => ['pending', 'introduced'].includes(row.status);
export function declinesRandomEvent(input) {
  const text = String(input || '').replace(/“[^”]*”|「[^」]*」|『[^』]*』|"[^"\n]*"/g, '');
  return text.split(/[，,。；;！!\n]/).some(part => {
    const clause = part.trim();
    if (!clause || /如果|假如|要是|是否|要不要|能否|能不能|会不会|怎么办|[？?]|计划|以后|明天/.test(clause)) return false;
    if (/^(?:(?:我|我们)\s*)?(?:让|叫|请|命令|告诉|提醒)[^，。；]{0,18}(?:不(?:参与|插手|介入|管)|退出|撤出)/.test(clause) && !/我(?:不|中途|半途)/.test(clause)) return false;
    if (/^(?:他|她|他们|她们|恶霸|受害者|同伴)(?:选择|决定|先)?(?:不|退出|撤出|离开)/.test(clause)) return false;
    if (/(?:不|没|未|别|不要|不再|不想|不能|不会)(?:再|想|要)?(?:退出|撤出|离开|走开|离去|撤离|撤退|走了|撤了)/.test(clause)) return false;
    if (/(?:打算|准备)/.test(clause) && !/不打算(?:介入|插手|掺和|参与|理会|帮忙|救人|管)/.test(clause)) return false;
    if (/(?:不(?:再|想|愿意|愿|要|打算)?(?:介入|插手|掺和|参与|理会|理睬|帮助|帮忙|帮他|帮她|帮这个人|帮那个人|救人|管)|别管(?:了|他们|这事|闲事)|无视(?:他|她|他们|求助)|置之不理|视而不见|袖手旁观|(?:放弃|停止)(?:介入|插手|参与|帮助|救助|救人)|(?:半途|半道|半路|中途)(?:退出|撤出|离开|推出)|(?:退出|撤出)(?:这件事|这场|本次|此次|当前|事件|冲突|纠纷|行动|救助|战斗|了|$))/.test(clause)) return true;
    return /^(?:(?:我|我们|咱们)(?:决定|选择|就|先|直接)?)?(?:转身|扭头|直接|先|立刻)?(?:离开|走开|离去|撤离|撤退|离场|走了|撤了)(?:这里|现场|此地|了|吧|去|回|，|$)/.test(clause);
  });
}

export function selectRandomEvent(state, judged, input, frequency = 'medium') {
  if (judged.kind === 'meta') return null;
  const ongoing = state.randomEvents?.findLast(activeEvent);
  if (ongoing) {
    const type = EVENT_TYPES.find(e => e.id === ongoing.type);
    return { ...(type || { id: ongoing.type, label: '先前遭遇', prompt: '承接此前尚未结束的遭遇。' }), type: ongoing.type, id: ongoing.id,
      scene: ongoing.scene, continuing: true, summary: ongoing.text || type?.label || '先前遭遇', leaveRequested: declinesRandomEvent(input) };
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
  const place = state.player.location?.siteName || '';
  const outdoors = /(?:街道|街上|巷|广场|市集|市场|门口|门外|城门|码头)/.test(place) && !/(?:室内|屋内|房间|客房|大厅内)/.test(place);
  const indoors = (!outdoors && /家中|卧室|自己家|家里|室内|屋内|房间|客房|旅店|酒馆|公会|教堂|仓库|工坊|店内|铺内/.test(place))
    || /(?:在|进入|走进|回到)[^，。；]{0,8}(?:家里|卧室|屋内|房间|客房|旅店|酒馆|公会大厅|教堂内|仓库|工坊|店内)/.test(input);
  let pool = EVENT_TYPES.filter(row => (row.scenes.includes(scene) || row.id === 'task' && hasTask && /调查|守夜|工作|委托/.test(input)) && (row.id !== 'task' || hasTask))
    .filter(row => row.id !== 'town_bullying' || !indoors)
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
  const direction = event.leaveRequested ? `承接此前事件：${event.summary}。玩家已明确选择不介入或中途退出，尊重这一决定并结束此事件；不要替玩家继续介入，也不要因此宣称其他人的困境已经解决。`
    : `${event.prompt}${event.continuing ? `\n承接同一事件：${event.summary}。不要重演开端或另起一次遭遇。` : ''}`;
  return `【引擎触发的随机事件】类型：${event.label}。${direction}\n本回合最多只有这一件随机事件，不要另起其他随机遭遇。场景分类：${event.scene}；起始地点：${state?.player?.location?.siteName || '未知'}；当前行动：${judged?.actionText || '依玩家原文'}；现有委托：${contracts.join('、') || '无已登记委托'}。仅在确实相关时联系这些委托，不制造已有事实之外的关联。${event.leaveRequested ? '' : '先描述迹象或眼前局面；普通背景变化可以结束或继续，必须立即决定的危机停在发生时刻，等待玩家选择。'}根据本轮开始时刻、天气、人物关系和历史生成具体经过，选择并写清实际经过时间内的发生时刻，不得把不在场的人写成在场。不要替玩家付款、交易、接受委托、攻击或决定，不强加新的任务；只把实际发生的状态变化记入JSON，遵守现有装备与天赋。结尾JSON用eventUpdate:{status:"pending|resolved|left",text:"本次事件当前局面简记"}报告阶段：等待选择为pending，实际解决为resolved，玩家不介入或退出为left。`;
}

export function recordRandomEvent(state, event, id, update) {
  if (!event) return;
  const eventId = event.id || id;
  const current = (state.randomEvents || []).findLast(activeEvent);
  if (current && current.id !== eventId) return;
  const previous = (state.randomEvents || []).find(row => row.id === eventId);
  const validStatus = ['pending','resolved','left'].includes(update?.status);
  const status = validStatus ? update.status : previous?.status || 'introduced';
  const text = typeof update?.text === 'string' ? update.text.slice(0, 600) : event.summary || event.label;
  const missingUpdates = validStatus ? 0 : (previous?.missingUpdates || 0) + 1;
  state.randomEvents = [...(state.randomEvents || []).filter(row => row.id !== eventId).map(row => activeEvent(row) ? { ...row, status: 'superseded' } : row), { ...previous, id: eventId, type: event.type, scene: event.scene, text, status, missingUpdates, turn: state.turn }].slice(-20);
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
