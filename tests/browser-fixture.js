// Synthetic browser integration fixture; never loaded by the normal game.
import { generateWorld } from '../engine/worldgen.js';
import { upgradeState } from '../engine/schema.js';
import { ensureAccounts } from '../engine/money.js';
import { uiState } from '../engine/state.js';
import * as store from '../store.js';
import { setKey } from '../llm.js';
localStorage.clear(); sessionStorage.clear();
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
  state.player.relations[i].trust = [-100, 0, 100][i]; state.player.relations[i].closeness = [100, 0, -100][i];
}
state.player.relations = state.player.relations.slice(0, 3);
state.player.contracts = [{ id: 'nightcart', label: '柳洼夜车调查', copper: 1200000, status: 'active', tier: 3 }];
store.putSave(state, [{ role: 'assistant', content: '这是独立测试存档。柳洼夜车调查已经办妥，可以领取120金币赏金。' }]);
let mode = 'normal';
const controls = document.createElement('div'); controls.id = 'fixture-controls';
controls.style.cssText = 'position:fixed;top:45px;left:3px;z-index:200;font:11px sans-serif;max-width:230px;background:#111;color:white;padding:6px';
for (const [value, name] of [['normal', '正常回复'], ['disconnect', '模拟断线'], ['invalid', '模拟金额错误']]) {
  const b = document.createElement('button'); b.textContent = name; b.onclick = () => { mode = value; }; controls.append(b);
}
const hide = document.createElement('button'); hide.textContent = '隐藏测试工具'; hide.onclick = () => { controls.hidden = true; }; controls.append(hide);
const monitor = document.createElement('pre'); monitor.id = 'fixture-monitor'; controls.append(monitor); document.body.append(controls);
const refresh = () => {
  const s = store.getSave(state.saveId); if (!s) return;
  monitor.textContent = `测试模式：${mode}\n回合：${s.turn}\n随身：${s.player.accounts[0].copper} 铜\n待提交：${store.getPending(s.saveId) ? '有' : '无'}\n地点：${s.player.location.siteName}\n后果：${s.consequences.map(e => e.status).join(',')}`;
};
setInterval(refresh, 200); refresh();
const original = window.fetch.bind(window);
window.fetch = async (url, options = {}) => {
  if (String(url).startsWith('https://api.github.com')) throw new Error('Fixture blocks cloud writes');
  if (!String(url).startsWith('https://api.deepseek.com')) return original(url, options);
  const request = JSON.parse(options.body), system = request.messages[0].content;
  const input = request.messages.at(-1).content;
  let delta = {}, text = '【本次行动】\n你等了一阵，街上的人继续忙着各自的事。';
  if (/领取|赏金|分钱/.test(input)) {
    delta = { transactions: [{ id: 'reward', kind: 'reward', contractId: 'nightcart' }], location: { siteId: 'galon', siteName: '加隆城 · 公会' } };
    if (!system.includes('不用分钱')) delta.transactions.push(...[50000, 50000, 550000].map((copper, i) => ({ id: `share${i}`, kind: 'gift', to: state.npcs[i].id, copper })));
    delta.npcUpdates = [{ npcId: state.npcs[0].id, goals: [{ id: 'supplies', text: '备齐下一趟远行的补给', action: '去了熟悉的杂货店准备补给', completion: '补给已经备好', days: 2 }] }];
    delta.consequences = [{ id: 'guild-introduction', cause: '你们完成了柳洼调查并交清线索', text: '公会介绍了一位可靠的向导', days: 1, effects: { reputation: [{ place: '加隆城', change: 2 }] } }];
    text = '【本次行动】\n公会付清了一百二十金币，账房把收据递来。你要求的分配已交给账本核对。';
  }
  if (mode === 'invalid') delta = { transactions: [{ id: 'bad', kind: 'payment', copper: 99999999999, note: '错误金额' }] };
  const output = `${text}\n\n\`\`\`json\n${JSON.stringify(delta)}\n\`\`\``;
  const frame = `data: ${JSON.stringify({ choices: [{ delta: { content: output } }] })}\r\n\r\n`;
  return new Response(frame + (mode === 'disconnect' ? '' : 'data: [DONE]\r\n\r\n'), { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
};
await import('../app.js');
