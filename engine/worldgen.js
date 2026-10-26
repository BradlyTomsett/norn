// 世界与角色生成（M1：三张出生地卡，固定种子可复现）。
import { makeRng, pick, int, chance } from './rng.js';
import { rollWeather } from './clock.js';
import { defaultBills, workOf } from './ledger.js';
import { fixedSkills } from './skills.js';

export const REGIONS = [
  {
    id: 'greywater',
    name: '灰水镇',
    title: '东境郡 · 圣言王国',
    population: 3400,
    terrain: '河谷与缓丘，西边是石灰岩山，东面一条通往郡城的旧王道',
    economy: '小麦、羊毛、磨坊；一间铁匠铺、两间酒馆、一个周集',
    politics: '男爵领。男爵常年不在，管事收税；教会只有一间小堂',
    risk: '秋后常有逃兵过境；南边林子去年起不太平',
    families: ['npc_farmer', 'npc_miller', 'npc_apprentice', 'npc_orphan'],
    names: {
      male: ['阿尔诺', '哈罗德', '塞德', '托马', '埃德', '格里'],
      female: ['玛尔塔', '莉娜', '艾达', '萝丝', '汉娜', '薇拉'],
      family: ['贝克', '霍尔', '图恩', '阿什', '洛'],
    },
    professions: ['铁匠', '磨坊工', '管事', '酒馆老板'],
    metaphor: 'forge',
  },
  {
    id: 'anvilford',
    name: '铁砧渡',
    title: '黑岩山麓 · 矮人联邦边镇',
    population: 5200,
    terrain: '黑岩山脉的余脉，一条河从这里过，岸上是矿车轨道与货栈',
    economy: '铁料、煤、矮人锻造；渡船与关税',
    politics: '人类与矮人混居，镇长由行会推举，但真正说话的是矿主',
    risk: '矿洞塌方；走私；边境税吏格外苛刻',
    families: ['npc_miner', 'npc_smith_apprentice', 'npc_ferryman', 'npc_peddler'],
    names: {
      male: ['多恩', '布鲁诺', '卡尔', '奥托', '芬', '格里姆'],
      female: ['布伦', '希尔达', '英格', '薇拉', '赛拉'],
      family: ['石足', '铁手', '灰炉', '渡口', '山下'],
    },
    professions: ['矿主', '矮人锻匠', '税吏', '货栈主'],
    metaphor: 'forge',
  },
  {
    id: 'tideport',
    name: '潮汐港',
    title: '歌温城邦 · 南海口岸',
    population: 12000,
    terrain: '海湾与礁石，码头、船坞、一座旧灯塔；涨潮时半个下城泡在水里',
    economy: '海运、鱼、船具、绳索；也做一点见不得光的转运',
    politics: '商会与船长议事，市长只是他们的传话人',
    risk: '风暴季；海盗；随船来的疫病',
    families: ['npc_fisher', 'npc_docker', 'npc_clerk', 'npc_orphan'],
    names: {
      male: ['伊莱', '马可', '丹尼', '奥兰', '塔克', '雷诺'],
      female: ['妮拉', '莎拉', '伊莎', '凯特', '米拉'],
      family: ['索尔', '维拉', '卡恩', '朗', '梅'],
    },
    professions: ['船长', '商会账房', '码头管事', '鱼贩'],
    metaphor: 'sea',
  },
];

const FAMILY_INFO = {
  npc_farmer: { tag: '农户', money: 60, desc: '家里佃着别人的地，年成好时能攒下一点' },
  npc_miller: { tag: '磨坊工', money: 90, desc: '父亲在磨坊帮工，家里常年有面粉味' },
  npc_apprentice: { tag: '学徒', money: 70, desc: '家里托人把你送进铺子当学徒，指望着学门手艺' },
  npc_orphan: { tag: '孤儿', money: 12, desc: '家里只剩一个远房姑母，管你一顿饭，不管你一辈子' },
  npc_miner: { tag: '矿工', money: 55, desc: '父亲下矿，母亲在井口卖热汤' },
  npc_smith_apprentice: { tag: '锻工学徒', money: 75, desc: '父亲在矮人锻匠手下干活，手上全是烫疤' },
  npc_ferryman: { tag: '渡夫', money: 50, desc: '家里有条渡船，靠来往的货吃饭' },
  npc_peddler: { tag: '行商', money: 85, desc: '父亲挑着担子跑三镇，家里总有一股杂货味' },
  npc_fisher: { tag: '渔户', money: 45, desc: '家里有条旧渔船，天不亮就出海' },
  npc_docker: { tag: '脚夫', money: 40, desc: '父亲在码头扛包，一天一结，下雨就没钱' },
  npc_clerk: { tag: '账房学徒', money: 95, desc: '母亲识几个字，在商会里抄账，家里干净得像别人家' },
};

const VOICE_BY_PROFESSION = {
  铁匠: { vocabulary: 2, sentence: 'short', politeness: 1, tics: ['说句实在的', '娘的'], metaphor: '炉火和铁' },
  磨坊工: { vocabulary: 2, sentence: 'short', politeness: 1, tics: ['唉', '行了行了'], metaphor: '麦子和风' },
  管事: { vocabulary: 3, sentence: 'medium', politeness: 2, tics: ['按规矩'], metaphor: '账本和地契' },
  酒馆老板: { vocabulary: 2, sentence: 'medium', politeness: 2, tics: ['坐下说'], metaphor: '酒和客人' },
  矿主: { vocabulary: 3, sentence: 'short', politeness: 1, tics: ['数目说话'], metaphor: '矿脉和塌方' },
  矮人锻匠: { vocabulary: 2, sentence: 'short', politeness: 1, tics: ['锤子不会骗人'], metaphor: '钢和火' },
  税吏: { vocabulary: 4, sentence: 'long', politeness: 3, tics: ['依律'], metaphor: '条文和印' },
  货栈主: { vocabulary: 3, sentence: 'medium', politeness: 2, tics: ['货在人在'], metaphor: '货和账' },
  船长: { vocabulary: 2, sentence: 'short', politeness: 1, tics: ['起锚'], metaphor: '海和风' },
  商会账房: { vocabulary: 4, sentence: 'medium', politeness: 3, tics: ['这笔不对'], metaphor: '数字和印章' },
  码头管事: { vocabulary: 2, sentence: 'short', politeness: 1, tics: ['扛得动吗'], metaphor: '绳和包' },
  鱼贩: { vocabulary: 2, sentence: 'short', politeness: 2, tics: ['新鲜着呢'], metaphor: '鱼和冰' },
};

const DEFAULT_VOICE = { vocabulary: 2, sentence: 'short', politeness: 1, tics: ['嗯'], metaphor: '日常' };

function makeNpc(rng, { id, name, age, gender, race, profession, traits, obsession, attitude }) {
  return {
    id,
    name,
    age,
    gender,
    race,
    profession,
    voice: { ...(VOICE_BY_PROFESSION[profession] || DEFAULT_VOICE), tics: [...(VOICE_BY_PROFESSION[profession] || DEFAULT_VOICE).tics] },
    traits,
    obsession,
    attitude,
    memory: [],
  };
}

export function generateWorld({ regionId, race = 'human', familyKey, seed, playerName, name: nameIn, gender = 'male' }) {
  const region = REGIONS.find((r) => r.id === regionId) || REGIONS[0];
  const rng = makeRng(seed || Date.now());
  const family = FAMILY_INFO[familyKey] ? familyKey : region.families[0];
  const fam = FAMILY_INFO[family];

  const surname = pick(rng, region.names.family);
  const name = (playerName || nameIn || '').trim() || `${pick(rng, region.names[gender])}·${surname}`;

  // 避免 NPC 与玩家重名
  const used = new Set([name.split('·')[0]]);
  const given = (pool) => {
    for (let i = 0; i < 10; i++) {
      const cand = pick(rng, pool);
      if (!used.has(cand)) {
        used.add(cand);
        return cand;
      }
    }
    return pool[0];
  };

  const motherName = `${given(region.names.female)}·${surname}`;
  const fatherName = `${given(region.names.male)}·${surname}`;
  const siblingName = `${given(region.names[gender === 'male' ? 'female' : 'male'])}·${surname}`;

  const isOrphan = family === 'npc_orphan';
  const npcs = [];

  npcs.push(
    makeNpc(rng, {
      id: 'npc_mother',
      name: motherName,
      age: int(rng, 31, 44),
      gender: 'female',
      race,
      profession: isOrphan ? '帮佣' : '农妇',
      traits: ['能忍', '嘴硬心软', '算得清账'],
      obsession: isOrphan ? '下个月的房租' : '欠下的那点债',
      attitude: '她把最后一块面包推到你手边，说自己不饿',
    }),
  );

  if (!isOrphan) {
    npcs.push(
      makeNpc(rng, {
        id: 'npc_father',
        name: fatherName,
        age: int(rng, 34, 50),
        gender: 'male',
        race,
        profession: fam.tag === '农户' ? '佃农' : fam.tag,
        traits: ['沉默', '手上有劲', '不爱欠人情'],
        obsession: '今年的收成',
        attitude: '他很少跟你说话，但出门前会看你一眼',
      }),
    );
  }

  npcs.push(
    makeNpc(rng, {
      id: 'npc_sibling',
      name: siblingName,
      age: Math.max(4, 12 - int(rng, 3, 6)),
      gender: gender === 'male' ? 'female' : 'male',
      race,
      profession: '孩子',
      traits: ['黏人', '爱哭', '记性好'],
      obsession: '想让你带他出去玩',
      attitude: '他总跟在你后面三步远的地方',
    }),
  );

  const localProfession = pick(rng, region.professions);
  const localGender = chance(rng, 0.7) ? 'male' : 'female';
  npcs.push(
    makeNpc(rng, {
      id: 'npc_local',
      name: `${given(region.names[localGender])}·${pick(rng, region.names.family)}`,
      age: int(rng, 40, 62),
      gender: localGender,
      race: region.id === 'anvilford' && chance(rng, 0.5) ? 'dwarf' : 'human',
      profession: localProfession,
      traits: ['精明', '话少', '记仇'],
      obsession: pick(rng, ['价钱', '名声', '欠账', '天气']),
      attitude: '他认得你家的门，但还没记住你的名字',
    }),
  );

  const neighborProfession = region.id === 'tideport' ? '鱼贩' : region.id === 'anvilford' ? '货栈主' : '磨坊工';
  const neighborGender = gender === 'male' ? 'female' : 'male';
  npcs.push(
    makeNpc(rng, {
      id: 'npc_neighbor',
      name: `${given(region.names[neighborGender])}·${pick(rng, region.names.family)}`,
      age: int(rng, 28, 55),
      gender: neighborGender,
      race: 'human',
      profession: neighborProfession,
      traits: ['爱说话', '心不坏', '爱打听'],
      obsession: '别人家的事',
      attitude: '她/他见了你会点点头，然后顺口问一句你家里最近怎么样',
    }),
  );

  const base = race === 'dwarf' ? { body: 9, agility: 9, wisdom: 8 } : race === 'elf' ? { body: 7, agility: 9, wisdom: 10 } : race === 'orc' ? { body: 10, agility: 9, wisdom: 7 } : { body: 8, agility: 8, wisdom: 8 };

  const debts = [];
  if (!isOrphan && chance(rng, 0.6)) {
    debts.push({
      to: '磨坊主塞德',
      amount: { gold: 0, silver: int(rng, 8, 20), copper: 0 },
      note: '秋后到期',
    });
  }

  const weather = rollWeather(rng, 300 + int(rng, 0, 30));

  const state = {
    version: 'm1',
    saveId: null,
    createdAt: new Date().toISOString(),
    seed: seed || 0,
    world: {
      id: region.id,
      name: region.name,
      regionTitle: region.title,
      population: region.population,
      terrain: region.terrain,
      economy: region.economy,
      politics: region.politics,
      risk: region.risk,
      priceIndex: 1,
    },
    clock: { year: 222, doy: 300 + int(rng, 0, 20), hour: 6, minute: 30, weather },
    turn: 0,
    player: {
      name,
      age: 12,
      gender,
      race,
      profession: '孩子',
      professionState: 'none',
      stats: {
        body: base.body + int(rng, 0, 2),
        agility: base.agility + int(rng, 0, 2),
        wisdom: base.wisdom + int(rng, 0, 2),
        spirit: 20,
        trainingCap: race === 'dwarf' ? 80 : 100,
      },
      body: { health: 96 },
      mind: { mood: '有点茫然' },
      wallet: { gold: 0, silver: 0, copper: fam.money },
      bag: [],
      bills: [],
      work: { ...workOf('孩子', 'none'), profession: '孩子', state: 'none' },
      debts,
      assets: isOrphan ? ['一件旧外套'] : ['一间土屋的居住权'],
      skills: fixedSkills([]),
      relations: npcs.map((n) => ({
        npcId: n.id,
        closeness: n.id === 'npc_mother' ? 81.5 : n.id === 'npc_father' ? 52.5 : n.id === 'npc_sibling' ? 65 : 7.5,
        observable: n.attitude,
      })),
      socialClass: isOrphan ? 'commoner' : 'commoner',
      reputation: { [region.name]: 0 },
      location: { siteId: region.id, siteName: region.name },
      goals: ['活下去，别给家里添麻烦'],
      problems: debts.length ? [`家里欠着${debts[0].to}的钱`] : ['家里不太宽裕'],
      unfinished: [],
    },
    npcs,
    knowledge: [
      { text: `${region.name}在东境一带算是能活下去的地方`, source: '亲历', day: 300 },
      { text: `家里${fam.tag === '孤儿' ? '没有大人撑着' : '靠' + fam.tag + '吃饭'}`, source: '亲历', day: 300 },
    ],
    history: [],
    signals: [],
    worldLog: [],
    flags: { awakeningAsked: false, pendingAwakening: false },
  };

  for (const npc of state.npcs) npc.location = { ...state.player.location };
  return { state, family: fam, region };
}

/** 开局文本（本地生成，不依赖模型）。 */
export function openingText(state, fam, region) {
  const p = state.player;
  const mother = state.npcs.find((n) => n.id === 'npc_mother');
  const sib = state.npcs.find((n) => n.id === 'npc_sibling');
  const w = state.clock.weather;

  const weatherLine = {
    clear: '天刚亮，光从门缝里横着切进来，把屋里的灰照得清清楚楚。',
    overcast: '天是灰的，像没洗干净的布，压得很低。',
    rain: '雨下了一夜还没停，屋檐下积了一小片泥水。',
    storm: '风把门板拍得直响，雨是横着扫进来的。',
    snow: '外面白了一层，屋子里冷得像地窖。',
    fog: '雾浓得看不见对街，声音都像裹了棉花。',
    drought: '天旱了有些日子，井绳一放到底才听见水声。',
  }[w] || '天亮了。';

  const lines = [];
  lines.push(weatherLine);
  lines.push('');
  if (fam.tag === '孤儿') {
    lines.push(
      `你十二岁。${region.name}的人大多知道你——不是因为你做过什么，是因为你没有大人。姑母隔三天给你留一碗饭，剩下的时间你自己想办法。`,
    );
  } else {
    lines.push(
      `你十二岁。家在${region.name}，${fam.desc}。母亲${mother?.name || '——'}已经在灶前忙了一阵，锅里是稀的，能照见人影。`,
    );
  }
  lines.push('');
  lines.push(
    `镇子的样子你闭着眼也能走：${region.terrain}。${region.economy}。${region.politics}。`,
  );
  lines.push('');
  lines.push(`大人说过：${region.risk}。你当时没当回事，但记住了。`);
  lines.push('');
  if (sib) {
    const ta = sib.gender === 'female' ? '她' : '他';
    lines.push(
      `${sib.name}蹲在门槛上，手指头在泥里画圈，看见你出来就抬起头："你去哪儿？"——${ta}每天都这么问，每天都跟着走三步。`,
    );
  }
  lines.push('');
  lines.push(`今天要做点什么？`);
  return lines.join('\n');
}
