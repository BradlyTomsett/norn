import { moneyMentions, numberOf, NUMBER_TEXT } from './numbers.js';
import { entityRefs } from './entities.js';
import { currentAction, delegatedAction } from './resolve.js';

const kinds = { purchase: /买|购买|订购/, sale: /卖|出售/, gift: /给|赠|打赏|分给|分成|平分/, payment: /付|结账|结清|雇|聘|捐/, borrow: /借/, repay: /还|偿还/, transfer: /转账|转入|转出|调拨/,
  reward: /领(?:取)?.{0,8}(?:赏金|报酬)|交活|领赏/, income: /收到|收取|收入|赚|领工钱/ };
const rows = value => value == null ? [] : Array.isArray(value) ? value : [value];
const quantity = text => {
  const match = String(text).match(new RegExp(`(?:买|购买|订购|卖出|卖掉|出售|拿|给|收下)?\\s*(${NUMBER_TEXT})\\s*(件|瓶|把|支|条|块|袋|份|匹|个|本|张)(?!金币|银币|铜币)`));
  return match && numberOf(match[1]) > 0 ? { qty: numberOf(match[1]), item: String(text).slice(match.index + match[0].length).split(/[，。；\s]/)[0].replace(/(?:总价|一共|共|每件|每瓶|单价|最多|不超过|预算|花费|花|价格).*$/, '') } : null;
};
const quotedProse = message => String(message?.content || '').split(/【(?:你现在可以|行动方向|可选行动)】|```/)[0];
function explicitItem(part) {
  const tail = part.match(/(?:购买|订购|买|出售|卖出|卖掉)([^，。；]{1,80})/)?.[1];
  if (!tail || /点|一些|东西|吃的|用品|补给|随便|刚才|这个|这些|报价|约定|选的/.test(tail)) return '';
  return tail.replace(new RegExp(`^\\s*${NUMBER_TEXT}\\s*(?:件|瓶|把|支|条|块|袋|份|匹|个|本|张)`), '')
    .replace(new RegExp(`${NUMBER_TEXT}\\s*(?:枚|个)?\\s*(?:金|银|铜).*$`), '')
    .replace(/(?:总价|一共|单价|最多|不超过|预算|花费|价格|给我|拿来|吧).*$/, '').trim();
}

/** Explicit terms bind settlement; reference prices never impose a limit. */
export function financeTerms(plan) {
  const action = currentAction(plan.text), parts = action.parts, terms = [];
  for (const part of parts) {
    if (delegatedAction(part)) continue;
    if (/^(?:我)?(?:问|询问|请问|打听)|多少钱|是否|能否/.test(part)) continue;
    const mentions = moneyMentions(part), refs = entityRefs(plan.base, part), qty = quantity(part);
    const detected = Object.entries(kinds).filter(([, re]) => re.test(part)).map(([kind]) => kind);
    const kindsHere = detected.includes('purchase') ? ['purchase'] : detected.includes('sale') ? ['sale']
      : detected.includes('repay') ? ['repay'] : detected.includes('borrow') ? ['borrow']
        : detected.includes('transfer') ? ['transfer'] : detected;
    if (mentions.length > 1 && refs.npcIds.length > 1 && kindsHere.includes('gift')) {
      const assigned = mentions.map(m => ({ money: m, npc: plan.base.npcs.filter(n => refs.npcIds.includes(n.id) && part.lastIndexOf(n.name, m.index) >= 0)
        .sort((a, b) => part.lastIndexOf(b.name, m.index) - part.lastIndexOf(a.name, m.index))[0] }));
      if (assigned.every(a => a.npc) && new Set(assigned.map(a => a.npc.id)).size === assigned.length) {
        terms.push(...assigned.map(a => ({ text: part, kinds: ['gift'], npcIds: [a.npc.id], copper: a.money.copper, mode: 'exact' }))); continue;
      }
    }
    const m = mentions.length === 1 ? mentions[0] : null;
    if (!kindsHere.length && !qty && !mentions.length && !/最多|不超过|预算|上限/.test(part)) continue;
    terms.push({ text: part, kinds: kindsHere, npcIds: refs.npcIds, qty: qty?.qty, item: qty?.item || explicitItem(part),
      copper: m?.copper, mode: /最多|不超过|至多|预算|上限|以内/.test(part) ? 'max' : /至少|不低于/.test(part) ? 'min' : 'exact',
      unit: /每(?:件|瓶|把|支|条|块|袋|份|匹|个|本|张)|单价/.test(part), each: /各|每人|一人|\/人/.test(part) });
  }
  // A following budget/amount clause belongs to the preceding business.
  for (let i = 1; i < terms.length; i++) if (!terms[i].kinds.length && !terms[i].npcIds.length) {
    terms[i].kinds = terms[i - 1].kinds; terms[i].npcIds = terms[i - 1].npcIds;
    terms[i].qty ??= terms[i - 1].qty; terms[i].item ||= terms[i - 1].item;
  }
  const incoming = terms.find(t => t.kinds.includes('reward') && t.copper != null);
  const shared = terms.find(t => /剩|余款/.test(t.text) && /平分/.test(t.text));
  if (incoming && shared?.npcIds.length) {
    const fixed = terms.filter(t => t !== shared && t.kinds.includes('gift') && t.copper != null).reduce((sum, t) => sum + t.copper * (t.each ? Math.max(1, t.npcIds.length) : 1), 0);
    const count = shared.npcIds.length + (/自己|我|与|和/.test(shared.text) ? 1 : 0), amount = (incoming.copper - fixed) / count;
    if (Number.isSafeInteger(amount) && amount >= 0) { shared.copper = amount; shared.each = true; shared.mode = 'exact'; }
  }
  if (terms.some(t => t.kinds.some(k => ['purchase', 'sale', 'payment'].includes(k)))
    && /按(?:照)?(?:刚才|刚刚|之前|上次)?(?:说好|谈好|约定|这个价|此价|报价)|照(?:这个|刚才的)价|就(?:买|要)(?:这些|这个)|付(?:这个|刚才说的)价/.test(plan.text)
    && !terms.some(t => t.copper != null)) {
    const requestedItem = terms.find(t => t.item)?.item;
    const quotes = (plan.base.quotes || []).filter(q => (!q.expiresDay || q.expiresDay >= plan.base.clock.year * 365 + plan.base.clock.doy - 1)
      && (!requestedItem || q.item.includes(requestedItem) || requestedItem.includes(q.item)));
    const quote = quotes.at(-1);
    if (quote) {
      const requested = quantity(plan.text), qty = requested?.qty || quote.qty || 1;
      terms.push({ text: `报价 ${quote.id}`, kinds: [quote.kind || 'purchase'], copper: quote.unitCopper || quote.copper,
        qty, item: quote.item, npcIds: quote.sellerId ? [quote.sellerId] : [], unit: Boolean(quote.unitCopper), mode: 'exact', quoted: true });
      return terms;
    }
    const old = [...(plan.history || [])].reverse().find(m => m.role === 'assistant' && moneyMentions(quotedProse(m)).length && (!requestedItem || quotedProse(m).includes(requestedItem)));
    const prose = quotedProse(old), amounts = moneyMentions(prose);
    if (amounts.length === 1 && /(?:售价|总价|一共|合计|报(?:价|酬)|要价|每(?:瓶|件|把|份)|单价|需要|给你|收你)/.test(prose)) {
      const q = quantity(prose), actionKinds = Object.keys(kinds).filter(k => kinds[k].test(plan.text));
      terms.push({ text: '最近一次明确报价', kinds: actionKinds, copper: amounts[0].copper, qty: q?.qty, item: q?.item,
        npcIds: entityRefs(plan.base, prose).npcIds, unit: /每(?:瓶|件|把|份)|单价/.test(prose), mode: 'exact', quoted: true });
    }
    if (!terms.some(t => t.quoted)) throw new Error('没有找到这件物品明确且有效的报价，请在行动中写明金额或先询价');
  }
  return terms;
}

function transactions(delta, plan) {
  const outgoing = plan?.finance?.some(t => t.kinds.includes('gift')) ? 'gift' : 'payment';
  const copperOf = value => typeof value === 'number' ? value : Number(value?.copper || 0) + Number(value?.silver || 0) * 100 + Number(value?.gold || 0) * 10000;
  const bare = Object.entries(delta?.money || {}).filter(([k]) => !['gold', 'silver', 'copper', 'note', 'change', 'transfer'].includes(k)).map(([account, value]) => ({ account, amount: copperOf(value) }));
  const legacy = copperOf(delta?.money); if (legacy) bare.push({ account: 'cash', amount: legacy });
  const result = [...rows(delta?.transactions), ...rows(delta?.gift).map(t => ({ ...t, kind: 'gift' })),
    ...rows(delta?.trade?.buy).map(t => ({ ...t, kind: 'purchase' })), ...rows(delta?.trade?.sell).map(t => ({ ...t, kind: 'sale' })),
    ...rows(delta?.payDebt).map(t => ({ ...t, kind: 'repay' })), ...rows(delta?.borrow).map(t => ({ ...t, kind: 'borrow' })),
    ...rows(delta?.money?.change).map(t => ({ ...t, kind: Number(t.copper) < 0 ? outgoing : 'income', copper: Math.abs(Number(t.copper)) })),
    ...rows(delta?.money?.transfer).map(t => ({ ...t, kind: 'transfer' })),
    ...bare.filter(t => t.amount).map(t => ({ kind: t.amount < 0 ? outgoing : 'income', account: t.account, copper: Math.abs(t.amount) }))];
  return result.map(tx => tx.kind === 'reward' && tx.copper == null ? { ...tx, copper: Math.round((plan?.base.player.contracts.find(c => c.id === tx.contractId)?.copper || 0) * (/一半|half|partial/.test(tx.result) ? 0.5 : /未完成|fail|none/.test(tx.result) ? 0 : 1)) } : tx);
}
const sameItem = (term, tx) => !term.item || !tx.name || term.item.includes(tx.name) || tx.name.includes(term.item);
function matches(term, tx, onlyRecipient = true) {
  return (!term.kinds.length || term.kinds.includes(tx.kind) || (term.kinds.includes('payment') && tx.kind === 'gift'))
    && (!onlyRecipient || !term.npcIds.length || (['purchase', 'sale', 'payment'].includes(tx.kind) && !tx.to) || term.npcIds.includes(tx.to)) && sameItem(term, tx);
}
export class FinanceError extends Error { constructor(message, issues = [], invalidIndexes = []) { super(message); this.issues = issues; this.invalidIndexes = invalidIndexes; } }
export function assertFinance(plan, raw, delta) {
  const terms = plan.finance || financeTerms(plan), txs = transactions(delta, { ...plan, finance: terms }), issues = [], invalid = new Set();
  const issue = (text, affected = []) => { issues.push(text); affected.forEach(tx => invalid.add(txs.indexOf(tx))); };
  for (const term of terms) {
    const candidates = txs.filter(tx => matches(term, tx));
    if (term.npcIds.length && txs.some(tx => matches(term, tx, false)) && !candidates.length) issue('收付款对象与玩家指定人物不一致', txs.filter(tx => matches(term, tx, false)));
    if (term.item && txs.some(tx => term.kinds.includes(tx.kind)) && !candidates.length) issue('交易物品与玩家指定物品不一致', txs.filter(tx => term.kinds.includes(tx.kind)));
    if (term.qty != null) for (const tx of candidates.filter(t => ['purchase', 'sale'].includes(t.kind))) {
      if (Number(tx.qty || 1) !== term.qty) issue(`物品数量应为${term.qty}`, [tx]);
    }
    if (term.copper != null && candidates.length) {
      const totals = term.each || term.unit ? candidates.map(tx => term.unit ? Number(tx.copper) / (tx.qty || 1) : Number(tx.copper)) : [candidates.reduce((sum, tx) => sum + Number(tx.copper), 0)];
      for (const [index, amount] of totals.entries()) if (term.mode === 'max' ? amount > term.copper : term.mode === 'min' ? amount < term.copper : amount !== term.copper) issue(`金额应${term.mode === 'max' ? '不超过' : term.mode === 'min' ? '不低于' : '为'}${term.copper}铜`, term.each || term.unit ? [candidates[index]] : candidates);
    }
  }
  // Check prose only when a sentence unambiguously describes a settled transfer.
  for (const sentence of String(raw || '').split(/```/)[0].split(/[。\n]/)) {
    if (!/(?:你(?:把|向|给|付|花|交|买|卖|收)|交给|支付了|花了|实付|实收)/.test(sentence) || /(?:还没|没有|尚未|不要|未曾|报价|要价|如果|打算|计划|将要|等你|需要)/.test(sentence)) continue;
    const amounts = moneyMentions(sentence), refs = entityRefs(plan.base, sentence);
    const candidates = txs.filter(tx => (!refs.npcIds.length || refs.npcIds.includes(tx.to)) && !['reward', 'income'].includes(tx.kind));
    const settled = candidates.length === 1 && (/每(?:瓶|件|把|份)|单价/.test(sentence) ? Number(candidates[0].copper) / (candidates[0].qty || 1) : Number(candidates[0].copper));
    if (amounts.length === 1 && candidates.length === 1 && amounts[0].copper !== settled) issues.push('正文金额与实际交易金额不一致');
  }
  if (issues.length) throw new FinanceError([...new Set(issues)].join('；'), issues, [...invalid]);
}

/** Only a financial mismatch permits one rewrite of the affected business. */
export function assertFinanceRepair(plan, original, repaired, error) {
  const terms = plan.finance || financeTerms(plan), old = transactions(original, { ...plan, finance: terms }), next = transactions(repaired, { ...plan, finance: terms });
  if (old.length !== next.length) throw new Error('金额修复不能增删交易，原进度已保留');
  old.forEach((tx, i) => {
    const affected = error?.invalidIndexes?.includes(i) || false;
    const stable = t => JSON.stringify(Object.fromEntries(Object.entries(t).filter(([k]) => k !== 'id').sort()));
    if (!affected && stable(tx) !== stable(next[i])) throw new Error('金额修复改变了其他交易');
    if (affected && (tx.kind !== next[i].kind || tx.name !== next[i].name || (tx.account || 'cash') !== (next[i].account || 'cash'))) throw new Error('金额修复改变了交易类型、物品或账户');
  });
  const rest = d => Object.fromEntries(Object.entries(d || {}).filter(([k]) => !['transactions', 'gift', 'trade', 'payDebt', 'borrow', 'money'].includes(k)));
  const canonical = v => JSON.stringify(v, (_key, row) => row && typeof row === 'object' && !Array.isArray(row) ? Object.fromEntries(Object.entries(row).sort(([a], [b]) => a.localeCompare(b))) : row);
  if (canonical(rest(original)) !== canonical(rest(repaired))) throw new Error('金额修复改变了其他剧情数据');
}

export function applyQuotes(state, quotes, rejected) {
  state.quotes ||= [];
  for (const row of rows(quotes)) {
    const qty = row.qty ?? 1, copper = Number(row.copper), unit = row.unitCopper == null ? null : Number(row.unitCopper);
    if (!row.id || !row.item || !Number.isSafeInteger(qty) || qty <= 0 || !Number.isSafeInteger(copper) || copper <= 0
      || (unit != null && (!Number.isSafeInteger(unit) || unit <= 0 || unit * qty !== copper))
      || (row.sellerId && !state.npcs.some(n => n.id === row.sellerId))) { rejected.push('报价需要有效编号、物品、数量、总价与已知对象'); continue; }
    const quote = { id: String(row.id).slice(0, 100), item: String(row.item).slice(0, 100), qty, copper,
      unitCopper: unit, sellerId: row.sellerId || '', kind: ['purchase', 'sale', 'payment'].includes(row.kind) ? row.kind : 'purchase', turn: state.turn + 1 };
    if (row.expiresDay != null) {
      if (!Number.isSafeInteger(row.expiresDay)) { rejected.push('报价有效日期无效'); continue; }
      quote.expiresDay = row.expiresDay;
    }
    const old = state.quotes.find(q => q.id === quote.id);
    if (old) Object.assign(old, quote); else state.quotes.push(quote);
  }
}
