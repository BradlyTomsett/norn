import { makeRng } from './rng.js';
import { judge } from './resolve.js';
import { advanceWorld, engineDelta } from './tick.js';
import { applyDelta } from './state.js';
import { trainSkill } from './progress.js';
import { upgradeState } from './schema.js';
import { resolveAction } from './actions.js';

export function prepareTurn(source, input, id, { messages = [] } = {}) {
  const action = resolveAction(input, messages), text = action.text;
  const base = upgradeState(structuredClone(source));
  const state = structuredClone(base);
  const rng = makeRng((state.seed || 1) + (state.turn || 0) * 7919 + 13);
  const judged = judge(state, text, rng);
  const events = advanceWorld(state, judged.minutes, rng, judged);
  return { id, text, input: action.input, selected: action.selected, base, state, judged, events, rng };
}
export function finishTurn(plan, delta) {
  const state = structuredClone(plan.state);
  const model = structuredClone(delta);
  if (Array.isArray(model.transactions)) model.transactions = model.transactions.map((tx, index) => ({ ...tx, id: `${plan.id}:tx:${index}` }));
  if (model.time) throw new Error('模型改写了引擎时间，请重试本回合');
  if (model.body) throw new Error('健康由引擎和物品结算，请勿额外记账');
  if (/^(我(?:要|想)?|请帮我)?(?:买|购买|卖掉|卖出|出售)/.test(plan.text) && ['success', 'critical', 'crush'].includes(plan.judged.outcome)
    && !model.transactions?.length && !model.trade) throw new Error('本次买卖缺少交易记录，请重试');
  if (/领取.*赏金|领赏/.test(plan.text) && !model.transactions?.some(tx => tx.kind === 'reward') && !model.bounty) throw new Error('领取赏金缺少委托结算记录，请重试');
  const rng = prepareTurn(plan.base, plan.text, plan.id).rng;
  applyDelta(state, engineDelta(plan.judged, state), rng, { bump: false });
  const result = applyDelta(state, model, rng, { eventId: plan.id, judged: plan.judged });
  if (!result.applied) throw new Error(result.rejected.join('；'));
  trainSkill(state, plan.judged);
  if (state.flags.pendingAwakening) { state.flags.pendingAwakening = false; state.flags.awakeningAsked = true; }
  const before = plan.base.player.accounts || [];
  result.receipt.accounts = state.player.accounts.map(a => ({ ...a, before: before.find(b => b.id === a.id)?.copper || 0,
    change: a.copper - (before.find(b => b.id === a.id)?.copper || 0), after: a.copper })).filter(a => a.change);
  return { state, receipt: result.receipt };
}
