// 状态的创建、增量应用、校验、序列化。
import { advanceClock, formatDate, monthOf, dayOfMonth, SEASON_CN, WEATHER_CN, seasonOf } from './clock.js';

export const RACES = ['human', 'elf', 'orc', 'dwarf'];
export const RACE_CN = { human: '人类', elf: '精灵', orc: '兽人', dwarf: '矮人', dragonkin: '龙裔', underdark: '地穴人', highland: '高原人' };

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const n = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

export function copperTotal(w) {
  return Math.round(n(w.gold) * 10000 + n(w.silver) * 100 + n(w.copper));
}

export function fromCopper(total) {
  let t = Math.max(0, Math.round(total));
  const gold = Math.floor(t / 10000);
  t -= gold * 10000;
  const silver = Math.floor(t / 100);
  t -= silver * 100;
  return { gold, silver, copper: t };
}

export function moneyText(w) {
  const g = n(w.gold), s = n(w.silver), c = n(w.copper);
  const parts = [];
  if (g) parts.push(`${g} 金`);
  if (s) parts.push(`${s} 银`);
  if (c || parts.length === 0) parts.push(`${c} 铜`);
  return parts.join(' ');
}

/** 把「A（金）、B、C（均紫）」这类合并写法拆成一条一件。 */
export function normalizeEquipment(raw) {
  const s = String(raw || '').trim();
  if (!s) return [];
  if (!/[、,，;；]/.test(s)) return [s];
  const parts = s.split(/[、,，;；]+/).map((x) => x.trim()).filter(Boolean);
  const out = [];
  const graded = /（[金紫蓝绿灰](?:\s*×\s*\d+)?）/;
  for (const p of parts) {
    const m = p.match(/^(.+?)（(均)?([金紫蓝绿灰])）$/);
    if (!m) {
      out.push(p);
      continue;
    }
    const name = m[1].trim();
    const jun = Boolean(m[2]);
    const grade = m[3];
    if (jun) {
      // 「均紫」：把它前面还没有品阶的几条一起补上
      for (let k = out.length - 1; k >= 0; k--) {
        if (graded.test(out[k])) break;
        out[k] = `${out[k]}（${grade}）`;
      }
    }
    out.push(`${name}（${grade}）`);
  }
  return out;
}

/** 把一次输出的增量（LLM 提议）安全地合入状态。返回被拒绝的条目。 */
export function applyDelta(state, delta, rng, opts = {}) {
  const rejected = [];
  if (!delta || typeof delta !== 'object') return { rejected };

  // 时间
  const minutes = n(delta?.time?.minutes);
  if (minutes > 0) {
    const { clock } = advanceClock(state.clock, Math.min(minutes, 60 * 24 * 30), rng);
    state.clock = clock;
  }

  // 钱
  if (delta?.money && (delta.money.copper != null || delta.money.silver != null || delta.money.gold != null)) {
    const d =
      n(delta.money.gold) * 10000 + n(delta.money.silver) * 100 + n(delta.money.copper);
    const total = copperTotal(state.player.wallet) + Math.round(d);
    if (total < 0) {
      state.player.wallet = { gold: 0, silver: 0, copper: 0 };
      rejected.push('现金不足，已归零');
    } else {
      state.player.wallet = fromCopper(total);
    }
  }

  // 身体 / 精神
  for (const key of ['health', 'fatigue', 'hunger']) {
    const d = n(delta?.body?.[key]);
    if (d) state.player.body[key] = clamp(state.player.body[key] + d, 0, 100);
  }
  for (const key of ['stress', 'morale']) {
    const d = n(delta?.mind?.[key]);
    if (d) state.player.mind[key] = clamp(state.player.mind[key] + d, 0, 100);
  }
  if (typeof delta?.mind?.mood === 'string' && delta.mind.mood.trim()) {
    state.player.mind.mood = delta.mind.mood.trim().slice(0, 24);
  }

  // 伤
  if (Array.isArray(delta?.body?.injuries)) {
    for (const inj of delta.body.injuries.slice(0, 3)) {
      if (!inj || typeof inj.part !== 'string') continue;
      state.player.body.injuries.push({
        part: String(inj.part).slice(0, 12),
        severity: ['graze', 'light', 'heavy', 'critical', 'maimed'].includes(inj.severity) ? inj.severity : 'light',
        healDay: state.clock.doy + Math.max(1, n(inj.days) || 3),
        note: String(inj.note || '').slice(0, 40),
      });
    }
  }

  // 技能
  if (Array.isArray(delta?.skills)) {
    for (const s of delta.skills.slice(0, 5)) {
      if (!s || typeof s.name !== 'string' || !s.name.trim()) continue;
      const name = s.name.trim().slice(0, 12);
      const found = state.player.skills.find((x) => x.name === name);
      const d = n(s.delta ?? s.level);
      if (found) found.level = clamp(found.level + d, 0, 100);
      else state.player.skills.push({ name, level: clamp(Math.max(0, d), 0, 100) });
    }
  }

  // 关系（只允许已存在的 NPC）
  if (Array.isArray(delta?.relations)) {
    for (const r of delta.relations.slice(0, 6)) {
      const npc = state.npcs.find((x) => x.id === r?.npcId);
      if (!npc) {
        rejected.push(`未知 NPC：${r?.npcId}`);
        continue;
      }
      const rel = state.player.relations.find((x) => x.npcId === npc.id);
      if (!rel) continue;
      rel.trust = clamp(rel.trust + n(r.trust), -100, 100);
      rel.closeness = clamp(rel.closeness + n(r.closeness), -100, 100);
      if (typeof r.observable === 'string' && r.observable.trim()) {
        rel.observable = r.observable.trim().slice(0, 60);
      }
    }
  }

  // 装备（只增不减：丢东西需要玩家明确说）
  if (Array.isArray(delta?.equipment)) {
    let added = 0;
    for (const e of delta.equipment.slice(0, 3)) {
      const name = typeof e === 'string' ? e : e?.name;
      if (!name) continue;
      for (const item of normalizeEquipment(name)) {
        if (added >= 8) break;
        const s = String(item).slice(0, 40);
        if (state.player.equipment.includes(s)) continue;
        state.player.equipment.push(s);
        added++;
      }
    }
    if (state.player.equipment.length > 60) state.player.equipment = state.player.equipment.slice(-60);
  }

  // 知识与未完成
  const pushKnowledge = (list) => {
    for (const k of (Array.isArray(list) ? list : []).slice(0, 4)) {
      const text = typeof k === 'string' ? k : k?.text;
      if (!text) continue;
      state.knowledge.push({
        text: String(text).slice(0, 80),
        source: typeof k === 'object' && k.source ? String(k.source).slice(0, 20) : '亲历',
        day: state.clock.doy,
      });
    }
    if (state.knowledge.length > 60) state.knowledge = state.knowledge.slice(-60);
  };
  pushKnowledge(delta?.knowledge);
  pushKnowledge(delta?.newInfo);

  if (Array.isArray(delta?.unfinished)) {
    for (const u of delta.unfinished.slice(0, 3)) {
      const text = typeof u === 'string' ? u : u?.text;
      if (text) state.player.unfinished.push({ text: String(text).slice(0, 60), openedDay: state.clock.doy });
    }
    if (state.player.unfinished.length > 12) state.player.unfinished = state.player.unfinished.slice(-12);
  }

  if (Array.isArray(delta?.goals)) {
    const g = delta.goals.filter((x) => typeof x === 'string' && x.trim()).map((x) => x.slice(0, 60));
    if (g.length) state.player.goals = g.slice(0, 3);
  }
  if (Array.isArray(delta?.problems)) {
    const p = delta.problems.filter((x) => typeof x === 'string' && x.trim()).map((x) => x.slice(0, 60));
    if (p.length) state.player.problems = p.slice(0, 3);
  }

  state.turn = (state.turn || 0) + (opts.bump === false ? 0 : 1);
  return { rejected };
}

/** 给模型的紧凑状态块（也是 UI 的数据源之一）。 */
export function stateBlock(state) {
  const p = state.player;
  const lines = [];
  lines.push(`【时间】${formatDate(state.clock)}`);
  lines.push(`【地点】${p.location.siteName}（${state.world.regionTitle}）｜物价指数 ${(state.world.priceIndex || 1).toFixed(2)}`);
  lines.push(
    `【角色】${p.name}｜${p.age} 岁｜${RACE_CN[p.race] || p.race}｜${p.profession}（${p.professionState}）`,
  );
  lines.push(`【四维】体质 ${p.stats.body} 敏捷 ${p.stats.agility} 智慧 ${p.stats.wisdom} 精神 ${p.stats.spirit}`);
  const inj = p.body.injuries.length
    ? '｜' + p.body.injuries.map((i) => `${i.part}${i.note ? '(' + i.note + ')' : ''}`).join('、')
    : '';
  lines.push(`【身体】健康 ${p.body.health} 疲劳 ${p.body.fatigue} 饥饿 ${p.body.hunger}${inj}`);
  lines.push(`【精神】${p.mind.mood}｜压力 ${p.mind.stress}｜士气 ${p.mind.morale}`);
  if (p.talent) {
    const t = p.talent;
    lines.push(`【天赋】${t.name}（${t.grade}）：${t.effect}${t.secret ? '｜**必须严格保密**' : ''}`);
  }
  if (p.incomeMonthly) lines.push(`【月净利】约 ${p.incomeMonthly.toLocaleString()} 金`);
  lines.push(`【现金】${moneyText(p.wallet)}`);
  if (p.debts.length) lines.push(`【债务】${p.debts.map((d) => `${d.to} ${moneyText(d.amount)}（${d.note || '到期未定'}）`).join('；')}`);
  if (p.assets.length) lines.push(`【资产】${p.assets.join('、')}`);
  if (p.equipment?.length) lines.push(`【装备】${p.equipment.join('、')}`);
  if (p.skills.length) lines.push(`【技能】${p.skills.map((s) => `${s.name} ${s.level}`).join('、')}`);
  lines.push(`【身份】${p.socialClass}｜声誉：${Object.entries(p.reputation).map(([k, v]) => `${k} ${v}`).join('、') || '无'}`);
  if (p.relations.length) {
    lines.push('【关系】');
    for (const r of p.relations) {
      const npc = state.npcs.find((x) => x.id === r.npcId);
      lines.push(`  · ${npc?.name || r.npcId}（${npc?.profession || ''}）：${r.observable || '点头之交'}`);
    }
  }
  if (p.goals.length) lines.push(`【当前目标】${p.goals.join('；')}`);
  if (p.problems.length) lines.push(`【当前问题】${p.problems.join('；')}`);
  if (p.unfinished.length) lines.push(`【未完成】${p.unfinished.map((u) => u.text).join('；')}`);
  if (state.knowledge.length) {
    lines.push('【玩家已知】（只能用这些）');
    for (const k of state.knowledge.slice(-12)) lines.push(`  · ${k.text}（${k.source}）`);
  }
  return lines.join('\n');
}

/** 给模型的 NPC 卡（含 id，方便它写 relations）。 */
export function npcCards(state) {
  return state.npcs
    .map((npc) => {
      const v = npc.voice || {};
      return [
        `· [${npc.id}] ${npc.name}｜${npc.age} 岁｜${RACE_CN[npc.race] || npc.race}｜${npc.profession}`,
        `  说话：词汇 ${v.vocabulary || 2}/5，${v.sentence || 'short'} 句，礼貌 ${v.politeness ?? 1}/3，口癖「${(v.tics || []).join('、') || '无'}」，比喻取自${v.metaphor || '日常'}`,
        `  在意：${npc.obsession || '无'}｜性格：${(npc.traits || []).join('、') || '普通'}`,
      ].join('\n');
    })
    .join('\n');
}

export function uiState(state) {
  const p = state.player;
  return {
    saveId: state.saveId,
    turn: state.turn,
    date: formatDate(state.clock),
    calendar: {
      year: state.clock.year,
      month: monthOf(state.clock.doy),
      day: dayOfMonth(state.clock.doy),
      season: SEASON_CN[seasonOf(state.clock.doy)],
      weather: WEATHER_CN[state.clock.weather],
    },
    world: state.world,
    player: {
      name: p.name,
      age: p.age,
      race: RACE_CN[p.race] || p.race,
      profession: p.profession,
      professionState: p.professionState,
      stats: p.stats,
      body: p.body,
      mind: p.mind,
      money: moneyText(p.wallet),
      wallet: p.wallet,
      debts: p.debts,
      assets: p.assets,
      skills: p.skills,
      socialClass: p.socialClass,
      reputation: p.reputation,
      talent: p.talent || null,
      equipment: p.equipment || [],
      incomeMonthly: p.incomeMonthly || 0,
      location: p.location,
      goals: p.goals,
      problems: p.problems,
      unfinished: p.unfinished,
      relations: p.relations.map((r) => {
        const npc = state.npcs.find((x) => x.id === r.npcId);
        return {
          name: npc?.name || r.npcId,
          profession: npc?.profession || '',
          observable: r.observable,
          trust: r.trust,
          closeness: r.closeness,
        };
      }),
    },
    knowledge: state.knowledge.slice(-10),
    worldLog: (state.worldLog || []).slice(-8),
    priceIndex: state.world.priceIndex || 1,
  };
}
