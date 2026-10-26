import { currentAction } from './resolve.js';

const patterns = {
  purchase: /买|购买|订购/,
  sale: /出售|卖出|卖掉|卖给/,
  gift: /赠|送给|送.{0,10}(?:钱|金|银|铜)|给.{0,16}(?:钱|金|银|铜)|分给|分钱|分成|分赏金|平分|各.{0,8}(?:金|银|铜)|打赏|捐/,
  payment: /付款|付钱|支付|结账|结清|雇|聘|捐|打赏|给.{0,16}(?:钱|金|银|铜)|分钱|分成/,
  transfer: /转账|转入|转出|调钱|调拨|从.{0,12}(?:取钱|拿钱)/,
  borrow: /借钱|借款|向.{0,12}借|借我/,
  repay: /还钱|还款|还债|偿还|还给/,
  accept: /接下|接取|承接|接受|答应|同意|报名|接.{0,14}(?:单|任务|委托)/,
  romance: /表白|亲吻|告白|拥抱|求婚/,
};
const normalized = text => String(text).replace(/[\s，,。.!！?？“”「」：:；;]/g, '');

export function playerPermissions(input) {
  const parts = currentAction(input).parts.filter(part => !/^(?:我)?(?:问|询问|请问|打听|看看)/.test(part)
    && !/是否|能否|可不可以|多少钱|什么价格|(?:不|没)(?:要|想|打算|会|有)?(?:付|买|卖|给|赠|送|借|还|接|答应|同意|承诺|表白|亲吻)/.test(part));
  return Object.fromEntries(Object.entries(patterns).map(([kind, pattern]) => [kind, parts.some(part => pattern.test(part))]));
}
const amount = row => typeof row === 'number' ? row : Number(row?.copper || 0) + Number(row?.silver || 0) * 100 + Number(row?.gold || 0) * 10000;
function unauthorizedMoney(money, allow) {
  if (!money || typeof money !== 'object') return false;
  return (!allow.transfer && money.transfer) || (!allow.payment && Object.entries(money).some(([key, value]) =>
    key === 'change' || (!['transfer', 'note'].includes(key) && amount(value) < 0)));
}

export function approvedFinance(delta, input) {
  const allow = playerPermissions(input), out = structuredClone(delta || {});
  if (Array.isArray(out.transactions)) out.transactions = out.transactions.filter(tx => !patterns[tx.kind] || allow[tx.kind] || (tx.kind === 'gift' && allow.payment));
  if (out.transactions?.length === 0) delete out.transactions;
  for (const [field, kind] of [['gift', 'gift'], ['borrow', 'borrow'], ['payDebt', 'repay']]) if (!allow[kind]) delete out[field];
  if (out.trade) {
    if (!allow.purchase) delete out.trade.buy;
    if (!allow.sale) delete out.trade.sell;
    if (!out.trade.buy && !out.trade.sell) delete out.trade;
  }
  if (out.bounty && !allow.accept) {
    const rows = (Array.isArray(out.bounty) ? out.bounty : [out.bounty]).filter(row => row.result || row.status);
    if (rows.length) out.bounty = Array.isArray(out.bounty) ? rows : rows[0]; else delete out.bounty;
  }
  if (out.money) {
    if (!allow.transfer) delete out.money.transfer;
    if (!allow.payment) for (const [key, value] of Object.entries(out.money)) if (key === 'change' || amount(value) < 0) delete out.money[key];
    if (Object.keys(out.money).every(key => key === 'note')) delete out.money;
  }
  return out;
}

export class AgencyError extends Error {}

export function assertPlayerAgency(plan, raw, delta) {
  const allow = playerPermissions(plan.text), violations = [];
  for (const tx of Array.isArray(delta?.transactions) ? delta.transactions : []) {
    if (patterns[tx.kind] && !allow[tx.kind] && !(tx.kind === 'gift' && allow.payment)) violations.push(`玩家没有批准${tx.kind}交易`);
  }
  if (delta?.bounty && !allow.accept && (Array.isArray(delta.bounty) ? delta.bounty : [delta.bounty]).some(row => !row.result && !row.status)) violations.push('玩家只在了解委托，尚未答应接取');
  if (delta?.trade?.buy && !allow.purchase) violations.push('玩家尚未决定购买');
  if (delta?.trade?.sell && !allow.sale) violations.push('玩家尚未决定出售');
  if (delta?.gift && !allow.gift && !allow.payment) violations.push('玩家尚未决定赠款');
  if (delta?.borrow && !allow.borrow) violations.push('玩家尚未决定借款');
  if (delta?.payDebt && !allow.repay) violations.push('玩家尚未决定还款');
  if (unauthorizedMoney(delta?.money, allow)) violations.push('玩家尚未批准这笔扣款或转账');
  const prose = String(raw || '').split(/```/)[0];
  const quotes = [...prose.matchAll(/[“「]([^”」]+)[”」][，,。]?\s*你(?:说|问|答|道|补充|回答)/g),
    ...prose.matchAll(/你(?:说|问|答道|回答|补充)(?:道|说)?[：:，,]?\s*[“「]([^”」]+)[”」]/g)];
  for (const match of quotes) if (!normalized(plan.text).includes(normalized(match[1]))) violations.push('补写了玩家没有提供的直接台词');
  if (/你(?:向.{0,12})?(?:表白|亲吻|告白|求婚|爱上)/.test(prose) && !allow.romance) violations.push('替玩家决定了感情表达');
  if (/你(?:点头)?(?:答应|承诺|同意|接下|接受)/.test(prose) && !allow.accept && !allow.purchase && !allow.payment) violations.push('替玩家作出了重要承诺');
  if (violations.length) throw new AgencyError([...new Set(violations)].join('；'));
}
