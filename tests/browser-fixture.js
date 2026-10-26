// Synthetic browser integration fixture; never loaded by the normal game.
import { generateWorld } from '../engine/worldgen.js';
import { upgradeState } from '../engine/schema.js';
import { ensureAccounts } from '../engine/money.js';
import { uiState } from '../engine/state.js';
import * as store from '../store.js';
import { setKey } from '../llm.js';
const params = new URLSearchParams(location.search), scenario = params.get('scenario');
if (params.has('reset')) {
  localStorage.clear(); sessionStorage.clear();
  await new Promise((resolve, reject) => { const request = indexedDB.deleteDatabase('norn.archive'); request.onsuccess = resolve; request.onerror = reject; });
  params.delete('reset'); history.replaceState(null, '', '?' + params);
}
setKey('fixture-key-no-network');
const { state } = generateWorld({ regionId: 'greywater', seed: 77, playerName: '测试旅人' });
state.saveId = 'sv_browser_fixture'; upgradeState(state); ensureAccounts(state);
state.clock = { year: 222, doy: 10, hour: 12, minute: 0, weather: 'clear' };
state.player.accounts.forEach(a => a.copper = a.id === 'cash' ? 1000000 : 0);
state.player.debts = []; state.player.equipment = ['旧传说剑（金）'];
state.prices = { '针线包（一套）': { min: 10, max: 40 }, '墨水（一小瓶）': { min: 20, max: 80 } };
state.rates = { '配钥匙（每把）': { min: 15, max: 80 } };
state.npcs = state.npcs.slice(0, 3);
for (const [i, name] of ['老杜', '薇拉', '瑟拉'].entries()) {
  state.npcs[i].name = name; state.npcs[i].profession = '冒险者';
  state.player.relations[i].closeness = [-100, 0, 100][i];
}
state.player.relations = state.player.relations.slice(0, 3);
state.player.contracts = [{ id: 'nightcart', label: '柳洼夜车调查', copper: 1200000, status: 'active', tier: 3 }];
state.player.unfinished = [{ text: '到公会领取柳洼调查的报酬' }, { text: '去公会领取柳洼调查的报酬' }];
let initial = [{ role: 'assistant', content: '这是独立测试存档。柳洼夜车调查已经办妥，可以领取120金币赏金。\n【你现在可以做什么】\n① 睡觉八小时\n② 领取赏金并按约定分钱' }];
if (scenario === 'gear') {
  state.player.equipment = ['长剑（金）', '大枪（紫）', '长弓（紫）', '弓箭（灰）×500', '弓箭（绿）×30', '飞刀（蓝）×20', '匕首（紫）×20', '飞斧（灰）×10', '标枪（绿）×20', '战斧（紫）', '木盾（灰）', '铁盾（蓝）', '皮甲（紫）', '板甲（金）'];
  state.player.equipment.push('磨刀石（绿）×3');
  state.player.talent = { name: '暗金剑纹', grade: '传说', effect: '精通所有武器；免疫不利魔法与物理攻击；免疫冰、火、电、毒', secret: true };
  delete state.player.loadout; upgradeState(state);
}
if (scenario === 'long') {
  state.npcs[0].name = '凯尔'; state.npcs[0].age = 30; state.npcs[0].profession = '佣兵';
  state.npcs[1].name = '凯尔'; state.npcs[1].age = 22; state.npcs[1].profession = '冒险者';
  initial = [{ role: 'assistant', content: '凯尔（30岁·佣兵）约定明天在北门交付蓝色信物。', entities: { npcIds: [state.npcs[0].id] } },
    ...Array.from({ length: 1000 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: `这是第${i}段日常生活记录。` + '城中的生活照常继续。'.repeat(45) })), ...initial];
}
if (scenario === 'tasks') {
  state.player.contracts = [{ id: 'warehouse', label: '北仓清点', copper: 2400000, status: 'active' }, { id: 'west', label: '西门仓库调查', copper: 30000, status: 'active' }, { id: 'paid', label: '旧护送', copper: 1000, status: 'paid', paidCopper: 1000 }];
  state.player.unfinished = [{ id: 'roster', text: '定下三夜守夜的班次，谁头半夜谁后半夜' }, { id: 'investigation', text: '查清西门仓库失窃原因' }, { id: 'promise', text: '明晚日落前后到北关第三座仓门口碰头' }, { id: 'food', text: '吃饭' }, { id: 'secret', text: '传说级天赋严格保密' }];
  initial = [{ role: 'assistant', content: '三夜的班定下来了：头两夜你带塔姆守头半夜，老杜带凯尔守后半夜，第三夜对调。\n西门仓库失窃原因已经调查清楚，西门仓库调查已经完成，证物交给治安官。' }];
}
if (scenario === 'skills') {
  state.schemaVersion = 6;
  state.player.skills = [{ name: '武技', level: 130, xp: 0 }, { name: '察觉', level: 71.1, xp: 0.405 }, { name: '交涉', level: 55.3, xp: 0.401 },
    { name: '药材', level: 20, xp: 0 }, { name: '干杂活', level: 5, xp: 0.69 }, { name: '识路', level: 2, xp: 0.92 }];
  state.player.contracts = [{ id: 'warehouse', label: '北仓清点', copper: 2400000, status: 'active' }];
  state.player.unfinished = [
    '去北门老驿道那头摸底', '明晚日落前后到北关第三座仓门口碰头',
    '明天问凯尔：北关第三座仓里有没有狗、几条、夜里拴在哪',
    '守夜时盯账房小窗：灯何时灭、谁进去过、出来带没带东西',
    '定下明晚若仓里真动起来，四个半人怎么站、谁喊、谁堵门',
  ].map((text, i) => ({ id: `small:${i}`, text, kind: 'commitment', importance: 'major' }));
  initial = [{ role: 'assistant', content: '这是独立测试存档，展示固定六项技能和精简后的事项。' }];
}
if (scenario === 'context') {
  state.npcs = [{ id: 'sera', name: '瑟拉', age: 20, race: 'human', profession: '冒险者（B级）', attitude: '玩家的搭档', traits: [] }];
  state.player.relations = [{ npcId: 'sera', closeness: 50 }];
  state.knowledge = [{ id: 'old-membership', text: '瑟拉不在这单名单上', source: '旧叙述' }];
  state.player.unfinished = [{ id: 'sera-decision', text: '定下瑟拉是否加入这单' }];
  initial = [{ role: 'user', content: '搭档分成确认：给其他人结工钱后，剩余赏金与瑟拉平分。' },
    { role: 'assistant', content: '这项约定已确认。' },
    ...Array.from({ length: 20 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: `普通交流${i}。` })),
    { role: 'user', content: '重新说清人数\n（本回合纠正：/纠错 瑟拉一直是我的搭档，我们明明是6个人。）' },
    { role: 'assistant', content: '你们继续谈论今晚的安排。' }];
}
if (scenario === 'legacy' && !localStorage.getItem('norn.index')) store.putSave(state, initial);
await store.initStorage();
if (scenario !== 'empty' && !store.listSaves().length) await store.putSaveAsync(state, initial);
let mode = 'normal';
const controls = document.createElement('div'); controls.id = 'fixture-controls';
controls.style.cssText = 'position:fixed;top:45px;left:3px;z-index:200;font:11px sans-serif;max-width:230px;background:#111;color:white;padding:6px';
for (const [value, name] of [['normal', '正常回复'], ['disconnect', '模拟断线'], ['invalid', '模拟金额错误'], ['finance', '模拟金额放大'], ['duplicate', '模拟重复人物'], ['repair', '模拟回复修复'], ['agency', '模拟擅自承诺'], ['ability', '模拟无视免疫'], ['continuity', '模拟事实冲突']]) {
  const b = document.createElement('button'); b.textContent = name; b.onclick = () => { mode = value; }; controls.append(b);
}
const hide = document.createElement('button'); hide.textContent = '隐藏测试工具'; hide.onclick = () => { controls.hidden = true; }; controls.append(hide);
const monitor = document.createElement('pre'); monitor.id = 'fixture-monitor'; controls.append(monitor); document.body.append(controls);
const refresh = () => {
  const active = store.listSaves()[0]; const s = active && store.getSave(active.id); if (!s) return;
  monitor.textContent = `测试模式：${mode}\n回合：${s.turn}\n随身：${s.player.accounts[0].copper} 铜\n待提交：${store.getPending(s.saveId) ? '有' : '无'}\n地点：${s.player.location.siteName}\n后果：${s.consequences.map(e => e.status).join(',')}`;
};
setInterval(refresh, 200); refresh();
const original = window.fetch.bind(window);
let requests = 0;
window.fetch = async (url, options = {}) => {
  if (String(url).startsWith('https://api.github.com')) throw new Error('Fixture blocks cloud writes');
  if (!String(url).startsWith('https://api.deepseek.com')) return original(url, options);
  const request = JSON.parse(options.body), system = request.messages[0].content;
  requests++; controls.dataset.requests = requests;
  if (scenario === 'context') {
    controls.dataset.hasAgreement = String(request.messages.some(m => m.content.includes('剩余赏金与瑟拉平分')) || system.includes('剩余赏金与瑟拉平分'));
    controls.dataset.hasCorrection = String(system.includes('瑟拉一直是我的搭档'));
    controls.dataset.hasBothCorrections = String(system.includes('不要出现巡锁2个字') && system.includes('不要出现查锁2个字'));
  }
  const input = [...request.messages].reverse().find(m => m.role === 'user' && m.content.includes('【本轮实际行动】'))?.content || request.messages.at(-1).content;
  if (system.includes('你现在只核对回复的一致性与完整性')) {
    controls.dataset.contextReviews = String(Number(controls.dataset.contextReviews || 0) + 1);
    const output = '```json\n' + JSON.stringify({ ok: true, issues: [] }) + '\n```';
    const usage = { choices: [], usage: { prompt_tokens: 120, completion_tokens: 40, prompt_cache_hit_tokens: 50 } };
    return new Response(`data: ${JSON.stringify({ choices: [{ delta: { content: output } }] })}\n\ndata: ${JSON.stringify(usage)}\n\ndata: [DONE]\n\n`, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
  }
  const repairing = system.includes('你现在只修复变化数据');
  const reviewing = system.includes('你只整理这份游戏存档的事项');
  if (reviewing) {
    const review = { decisions: [], contracts: [] }, payload = JSON.parse(input);
    if (scenario === 'tasks') {
      const source = payload.sources.find(row => row.text.includes('西门仓库失窃原因已经调查清楚'));
      if (source) {
        review.decisions.push({ id: 'investigation', status: 'completed', confidence: 'certain', evidenceId: source.id, quote: source.text });
        review.contracts.push({ id: 'west', workStatus: 'completed', confidence: 'certain', evidenceId: source.id, quote: source.text });
      }
    }
    controls.dataset.reviews = String(Number(controls.dataset.reviews || 0) + 1);
    const output = '```json\n' + JSON.stringify(review) + '\n```';
    return new Response(`data: ${JSON.stringify({ choices: [{ delta: { content: output } }] })}\n\ndata: [DONE]\n\n`, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
  }
  let delta = {}, text = '【本次行动】\n你等了一阵，街上的人继续忙着各自的事。';
  if (mode === 'finance') {
    text = '你交给老杜五枚金币。';
    delta = { transactions: [{ id: 'gift', kind: 'gift', to: state.npcs[0].id, account: 'cash', copper: system.includes('你现在只修复本次交易') ? 50000 : 500000 }] };
  }
  if (/领取|赏金|分钱/.test(input)) {
    delta = { transactions: [{ id: 'reward', kind: 'reward', contractId: 'nightcart' }], location: { siteId: 'galon', siteName: '加隆城 · 公会' } };
    if (!system.includes('不用分钱')) delta.transactions.push(...[50000, 50000, 550000].map((copper, i) => ({ id: `share${i}`, kind: 'gift', to: state.npcs[i].id, copper })));
    delta.npcUpdates = [{ npcId: state.npcs[0].id, goals: [{ id: 'supplies', text: '备齐下一趟远行的补给', action: '去了熟悉的杂货店准备补给', completion: '补给已经备好', days: 2 }] }];
    delta.consequences = [{ id: 'guild-introduction', cause: '你们完成了柳洼调查并交清线索', text: '公会介绍了一位可靠的向导', days: 1, effects: { reputation: [{ place: '加隆城', change: 2 }] } }];
    text = '【本次行动】\n公会付清了一百二十金币，账房把收据递来。你要求的分配已交给账本核对。';
  }
  if (mode === 'invalid') delta = { transactions: [{ id: 'bad', kind: 'payment', copper: 99999999999, note: '错误金额' }] };
  if (mode === 'duplicate') delta = { npcs: [{ id: state.npcs[0].id, name: state.npcs[0].name, profession: '冒险者' }] };
  if (mode === 'repair') delta = repairing ? {} : { time: { minutes: 999 } };
  if (mode === 'agency') {
    delta = {}; text = system.includes('你现在修复玩家自主权问题') ? '商人报了价格，等你决定是否购买。' : '你答应买下货物。你说：“这笔钱我来付。”';
  }
  if (mode === 'ability') {
    delta = {}; text = system.includes('你现在只修复本回合叙事与能力结果的矛盾') ? '你用大枪抵开攻击，身体没有受伤。守卫后退了一步。' : '你被守卫砍伤了，鲜血流了下来。';
  }
  if (mode === 'continuity') {
    text = system.includes('你现在只修复回复的事实一致性与完整性')
      ? '瑟拉一直与你同行。六名成员都在，战力按各自等级评估。按既定约定，结清其他人的工钱后，你与瑟拉平分剩余赏金。'
      : '瑟拉不在这次任务名单里，你们只有五个半人。';
  }
  if (/睡|歇|休息/.test(input) && !repairing) text = '【生活变化】\n你在旅店休息，醒来后仍留在原处。\n【你现在可以做什么】\n① 问候老杜\n② 等一会';
  const output = `${text}\n\n【实际结算】\n模型写的错误余额999金币，不应显示。\n\n\`\`\`json\n${JSON.stringify(delta)}\n\`\`\``;
  const frame = `data: ${JSON.stringify({ choices: [{ delta: { content: output } }] })}\r\n\r\n`;
  const usage = `data: ${JSON.stringify({ choices: [], usage: { prompt_tokens: 120, completion_tokens: 40, prompt_cache_hit_tokens: 50 } })}\r\n\r\n`;
  return new Response(frame + (mode === 'disconnect' ? '' : usage + 'data: [DONE]\r\n\r\n'), { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
};
await import('../app.js');
