import { hasKey, streamChat } from './llm.js';
import { DOCK_SCENARIO, MAX_SCENARIO_NPCS, MAX_SCENARIO_ITEMS, parseScenarioDraft, validateScenario, startScenario } from './engine/scenario.js';
import { PLACES, REGIONAL_PROFILES } from './engine/atlas-data.js';
import { atlasName, atlasTitle } from './engine/atlas.js';

const LIBRARY_KEY = 'norn.scenarios';
const BLANK = {
  title: '', place: '', description: '', name: '', age: 18, gender: 'male', profession: '',
  professionState: 'none', cash: 0, time: '06:30', event: '', atlasAnchor: '', npcs: [], items: [],
};
const FIELDS = {
  title: 'title', place: 'place', description: 'desc', name: 'name', age: 'age', gender: 'gender',
  profession: 'origin', professionState: 'work', cash: 'cash', time: 'time', event: 'event', atlasAnchor: 'anchor',
};

function draftPlaces(idea, available) {
  const regions = new Set(REGIONAL_PROFILES.filter(row => idea.includes(row.name)
    || row.name.endsWith('王国') && idea.includes(row.name.replace(/王国$/, ''))).map(row => row.id));
  const weight = place => (idea.includes(place.name) ? 12 : 0) + (regions.has(place.region) ? 5 : 0)
    + (idea.includes(place.kind) ? 4 : 0);
  const matches = available.filter(place => weight(place) > 0).sort((a, b) => weight(b) - weight(a));
  const defaults = available.filter(place => ['greywater', 'anvilford', 'tideport', 'rainshadow-sands', 'moth-marsh',
    'echo-vault', 'snowridge', 'gull-rock', 'southern-market', 'pinewatch'].includes(place.id));
  return [...new Set([...matches, ...defaults])].slice(0, 18)
    .map(place => `${place.name}[${place.id}]（${atlasTitle(place)} · ${place.kind}）`).join('、');
}

export function setupScenarioEditor({ onStart, onBack }) {
  const field = id => document.getElementById('cu-' + id);
  const library = field('library'), fields = field('fields'), back = field('back');
  const cancel = field('cancel-draft');
  const rows = [
    { key: 'npcs', kind: 'npc', max: MAX_SCENARIO_NPCS, defaults: { age: 30 } },
    { key: 'items', kind: 'item', max: MAX_SCENARIO_ITEMS, defaults: { qty: 1 } },
  ];
  let saved = [], drafting = null, starting = false;
  const publicPlaces = PLACES.filter(place => !place.hidden);
  field('atlas-places').replaceChildren(...publicPlaces.map(place => new Option(atlasTitle(place), place.name)));
  const groups = REGIONAL_PROFILES.flatMap(region => {
    const places = publicPlaces.filter(place => place.region === region.id);
    if (!places.length) return [];
    const group = document.createElement('optgroup');
    group.label = region.name;
    group.append(...places.map(place => new Option(place.name, place.id)));
    return [group];
  });
  field('anchor').replaceChildren(new Option('请选择附近的地图地点', ''), ...groups);
  const updateAnchor = () => field('anchor-row').classList.toggle('hidden', Boolean(atlasName(field('place').value.trim())));
  field('place').oninput = updateAnchor;

  function status(text = '', error = false, reveal = false) {
    field('status').textContent = text;
    field('status').classList.toggle('scenario-error', error);
    if (reveal) field('status').scrollIntoView({ block: 'nearest' });
  }

  function readLibrary() {
    const cards = JSON.parse(localStorage.getItem(LIBRARY_KEY) || '[]');
    if (!Array.isArray(cards)) throw new Error('本机剧本库无法读取');
    return cards.map(validateScenario);
  }

  function showLibrary(selection = '') {
    library.replaceChildren(new Option('空白剧本', ''), new Option('内置 · ' + DOCK_SCENARIO.title, 'dock'));
    saved.forEach(card => library.add(new Option(card.title, 'saved:' + card.title)));
    if ([...library.options].some(option => option.value === selection)) library.value = selection;
  }

  function addRow({ key, kind, max, defaults }, data = defaults) {
    const list = field(key), add = field('add-' + kind);
    if (list.childElementCount >= max) return;
    const row = field(kind + '-row').content.firstElementChild.cloneNode(true);
    for (const input of row.querySelectorAll('input')) input.value = data[input.dataset.field] ?? '';
    row.querySelector('[data-remove]').onclick = () => {
      row.remove();
      add.disabled = false;
      add.focus();
    };
    list.append(row);
    add.disabled = list.childElementCount >= max;
    return row;
  }

  function fill(card) {
    for (const [key, id] of Object.entries(FIELDS)) field(id).value = card[key] ?? '';
    updateAnchor();
    for (const group of rows) {
      field(group.key).replaceChildren();
      field('add-' + group.kind).disabled = false;
      card[group.key].forEach(data => addRow(group, data));
    }
  }

  function readCard() {
    const valueOf = input => input.type === 'number' ? input.valueAsNumber : input.value;
    const card = Object.fromEntries(Object.entries(FIELDS).map(([key, id]) => [key, valueOf(field(id))]));
    if (atlasName(card.place.trim())) card.atlasAnchor = '';
    else if (card.place.trim() && !card.atlasAnchor) throw new Error('请为原创地点选择一个附近的地图地点。');
    for (const { key } of rows) card[key] = [...field(key).children].map(row =>
      Object.fromEntries([...row.querySelectorAll('input')].map(input => [input.dataset.field, valueOf(input)])));
    return validateScenario(card);
  }

  for (const group of rows) field('add-' + group.kind).onclick = () => addRow(group)?.querySelector('input').focus();
  fill(BLANK);
  library.onchange = () => {
    fill(library.value === 'dock' ? DOCK_SCENARIO : saved.find(card => 'saved:' + card.title === library.value) || BLANK);
    status();
  };

  field('save').onclick = () => {
    try {
      const card = readCard();
      const cards = readLibrary();
      let index = cards.findIndex(old => old.title === card.title);
      if (index >= 0 && library.value !== 'saved:' + card.title) {
        throw new Error('已有同名剧本。请先选中它，或换一个名称');
      }
      if (index < 0) index = cards.length;
      cards[index] = card;
      localStorage.setItem(LIBRARY_KEY, JSON.stringify(cards));
      saved = cards;
      showLibrary('saved:' + card.title);
      status('已保存到本机。以后可以再用这张剧本开局。', false, true);
    } catch (error) { status(error.message, true, true); }
  };

  field('draft').onclick = async () => {
    const idea = field('idea').value.trim();
    if (!idea) return status('先写一句你想怎样开局。', true, true);
    if (!hasKey()) return status('AI 草拟需要 API Key。可以先手动填写，或到游戏的「设置」里配置。', true, true);
    const request = new AbortController();
    drafting = request;
    fields.disabled = true;
    cancel.classList.remove('hidden');
    status('正在草拟开场…', false, true);
    try {
      let reply = '';
      for await (const chunk of streamChat({
        system: [
          '为诺恩的西式奇幻人生模拟草拟一份开局剧本。只返回一个 JSON 对象，使用以下样例的字段与数据类型，内容根据玩家想法改写。',
          JSON.stringify(DOCK_SCENARIO),
          '优先选用与玩家构想相符的公开地图地点。地点与编号参考：' + draftPlaces(idea, publicPlaces)
            + '。玩家要求原创地点时，用 atlasAnchor 字段填写附近的地图地点编号。地方描写仅补充开场环境，不能改写地图地理。',
          '以诺恩原有日历、金银铜、职业和技能为准。只写一个起始地点和一件当下发生的事，保留玩家决定下一步的权利。地点和时间由对应字段给出，事件里不另定日期或地点。人物与物品用数组，没有就填空数组。',
          '角色年龄 1–120，人物年龄 1–300，随身钱以铜为单位，须为 0–10000000 的整数。时间使用 HH:mm。职业阶段取 none、apprentice、journeyman、master 或 guildmaster。各人的姓名不能重复，玩家姓名可以留空。',
          `最多 ${MAX_SCENARIO_NPCS} 个人物和 ${MAX_SCENARIO_ITEMS} 种物品，每种物品数量 1–100。剧本名称、地点、职业与身份至多 48 字，人名和物品名至多 40 字，地方设定和开局事件至多 800 字。`,
        ].join('\n'),
        messages: [{ role: 'user', content: idea }], maxTokens: 4096, temperature: 0.65,
        timeoutMs: 90000, signal: request.signal,
      })) reply += chunk;
      if (drafting !== request) return;
      const card = parseScenarioDraft(reply);
      library.value = '';
      fill(card);
      status('草稿已填入下方。检查并修改后，可以保存剧本或开始这局。');
    } catch (error) {
      if (drafting === request) status(`草拟未完成：${error.message}`, true);
    } finally {
      if (drafting === request) {
        drafting = null;
        fields.disabled = false;
        cancel.classList.add('hidden');
      }
    }
  };

  field('start').onclick = async () => {
    if (starting) return;
    starting = true;
    fields.disabled = true;
    back.disabled = true;
    try {
      const seed = Math.floor(Math.random() * 1e9);
      const result = startScenario(readCard(), { seed });
      status('正在创建存档…');
      await onStart(result);
      status();
    } catch (error) { status(error.message, true, true); }
    finally { starting = fields.disabled = back.disabled = false; }
  };

  cancel.onclick = () => {
    const request = drafting;
    drafting = null;
    request?.abort();
    fields.disabled = false;
    cancel.classList.add('hidden');
    status('已取消草拟。', false, true);
  };
  back.onclick = () => drafting ? cancel.click() : onBack();

  return () => {
    const selected = library.value;
    try {
      saved = readLibrary();
      showLibrary(selected);
      status();
    } catch (error) {
      status(`无法读取本机剧本：${error.message}`, true);
    }
  };
}
