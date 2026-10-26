import { pruneEmpty, splitDelta, stripSheet } from './format.js';
import { copperText } from './engine/money.js';

const SETTLEMENT = /^(?:实际结算|结算回执|系统结算|财务变化|账户变化|物品变化|账目变化)$/;

/** The model never owns settlement sections, including while streaming. */
export function stripSettlement(text) {
  let skipping = false;
  return String(text || '').split('\n').filter(line => {
    const heading = line.trim().replace(/\*\*/g, '').match(/^【([^】]+)】/);
    if (heading) skipping = SETTLEMENT.test(heading[1]);
    return !skipping;
  }).join('\n').trim();
}

export function narrationText(raw) {
  return pruneEmpty(stripSheet(stripSettlement(splitDelta(raw).text)));
}

export function receiptText(receipt) {
  return [
    ...(receipt.accounts || []).map(a => `${a.name} ${a.change >= 0 ? '+' : '−'}${copperText(Math.abs(a.change))}；余额 ${copperText(a.after)}`),
    ...(receipt.items || []).map(i => `${i.name} ${i.change >= 0 ? '+' : '−'}${Math.abs(i.change)}`),
    ...(receipt.health?.change ? [`健康 ${receipt.health.change >= 0 ? '+' : '−'}${Math.abs(receipt.health.change)}；当前 ${receipt.health.after}`] : []),
    ...(receipt.effects || []),
  ].join('\n') || '本回合没有账户或物品变化。';
}

export function messageParts(message) {
  if (message.role !== 'assistant') return { text: message.content };
  // Older packages embedded the real receipt last. Keep that last copy for display,
  // without rewriting history or inferring money from prose.
  const legacy = [...String(message.content || '').matchAll(/【实际结算】\s*([\s\S]*?)(?=\n\s*(?:\*\*)?【|$)/g)].at(-1);
  const receipt = message.receipt;
  const valid = receipt && Array.isArray(receipt.accounts) && Array.isArray(receipt.items);
  return { text: narrationText(message.content), receipt: valid ? receiptText(receipt) : legacy?.[1]?.trim() };
}
