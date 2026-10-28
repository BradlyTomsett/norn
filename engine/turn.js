import { makeRng } from './rng.js';
import { judge } from './resolve.js';
import { advanceWorld, engineDelta } from './tick.js';
import { applyDelta } from './state.js';
import { trainSkill } from './progress.js';
import { upgradeState } from './schema.js';
import { resolveAction } from './actions.js';
import { advanceTasks } from './tasks.js';
import { financeTerms, assertFinance } from './finance.js';
import { entityRefs } from './entities.js';
import { absoluteDay } from './schema.js';
import { rememberCorrections } from './continuity.js';
import { narrativeTime } from './time.js';

export function prepareTurn(source, input, id, { messages = [], corrections = [], rejectedReply = '', minutesOverride = null } = {}) {
  const action = resolveAction(input, messages), text = action.text;
  const base = upgradeState(structuredClone(source));
  rememberCorrections(base, messages, corrections);
  const state = structuredClone(base);
  const rng = makeRng((state.seed || 1) + (state.turn || 0) * 7919 + 13);
  const judged = judge(state, text, rng);
  if (minutesOverride != null) {
    if (!Number.isSafeInteger(minutesOverride) || minutesOverride < 0 || minutesOverride > 3650 * 1440) throw new Error('指定时间无效');
    let remaining = minutesOverride;
    judged.segments = judged.segments.map((segment, index, all) => {
      const minutes = index === all.length - 1 ? remaining : Math.min(remaining, segment.minutes);
      remaining -= minutes; return { ...segment, minutes };
    });
    judged.minutes = minutesOverride;
  }
  const events = advanceWorld(state, judged.minutes, rng, judged);
  advanceTasks(state);
  const plan = { id, text, input: action.input, selected: action.selected, base, state, judged, events, rng, history: messages, corrections, rejectedReply };
  plan.finance = financeTerms(plan);
  return plan;
}

/** Rebuild from the uncommitted baseline, never advance the already-previewed world twice. */
export function followNarrativeTime(plan, raw) {
  const timing = narrativeTime(raw, plan.base.clock);
  if (!timing) return plan;
  const next = timing.minutes === plan.judged.minutes ? { ...plan, judged: { ...plan.judged } }
    : prepareTurn(plan.base, plan.text, plan.id, { messages: plan.history, corrections: plan.corrections,
      rejectedReply: plan.rejectedReply, minutesOverride: timing.minutes });
  for (const key of ['input', 'selected', 'intentAnalysis']) if (plan[key] != null) next[key] = plan[key];
  next.judged.timeSource = 'narrative'; next.narrativeTiming = timing;
  return next;
}
export function finishTurn(plan, delta, { enforceTerms = true } = {}) {
  const state = structuredClone(plan.state);
  const model = structuredClone(delta);
  if (Array.isArray(model.transactions)) model.transactions = model.transactions.map((tx, index) => ({ ...tx, id: `${plan.id}:tx:${index}`,
    ...(tx.kind === 'gift' && /分成|报酬|酬劳|工钱|分赏/.test(plan.text) ? { reason: tx.reason || '约定酬劳分成' } : {}) }));
  if (model.time) throw new Error('模型改写了引擎时间，请重试本回合');
  if (model.body) throw new Error('健康由引擎和物品结算，请勿额外记账');
  if (enforceTerms) assertFinance(plan, '', model);
  if (enforceTerms && /^(我(?:要|想)?|请帮我)?(?:买|购买|卖掉|卖出|出售)/.test(plan.text) && ['success', 'critical', 'crush'].includes(plan.judged.outcome)
    && !model.transactions?.length && !model.trade) throw new Error('本次买卖缺少交易记录，请重试');
  if (enforceTerms && /领取.*赏金|领赏/.test(plan.text) && !model.transactions?.some(tx => tx.kind === 'reward') && !model.bounty) throw new Error('领取赏金缺少委托结算记录，请重试');
  const rng = prepareTurn(plan.base, plan.text, plan.id, { minutesOverride: plan.judged.minutes }).rng;
  applyDelta(state, engineDelta(plan.judged, state), rng, { bump: false });
  const result = applyDelta(state, model, rng, { eventId: plan.id, judged: plan.judged });
  if (!result.applied) throw new Error(result.rejected.join('；'));
  trainSkill(state, plan.judged);
  if (['social', 'trade'].includes(plan.judged.kind)) for (const id of entityRefs(state, plan.text).npcIds) {
    const npc = state.npcs.find(n => n.id === id), name = npc.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (new RegExp(`(?:向|对|跟|和|与|问候|告诉|询问|问|请教|联系)${name}`).test(plan.text)) {
      const relation = state.player.relations.find(r => r.npcId === id); if (relation) relation.lastTouch = absoluteDay(state.clock);
    }
  }
  advanceTasks(state);
  if (state.flags.pendingAwakening) { state.flags.pendingAwakening = false; state.flags.awakeningAsked = true; }
  const before = plan.base.player.accounts || [];
  result.receipt.accounts = state.player.accounts.map(a => ({ ...a, before: before.find(b => b.id === a.id)?.copper || 0,
    change: a.copper - (before.find(b => b.id === a.id)?.copper || 0), after: a.copper })).filter(a => a.change);
  result.receipt.health = { before: plan.base.player.body.health, after: state.player.body.health,
    change: state.player.body.health - plan.base.player.body.health };
  result.receipt.effects = [];
  if (plan.judged.effects.weapon && ['combat', 'study'].includes(plan.judged.kind)) result.receipt.effects.push('使用：' + plan.judged.effects.weapon.label);
  if (plan.judged.effects.blocked) result.receipt.effects.push('天赋免疫已生效，本次来袭效果未造成伤害或负面状态。');
  return { state, receipt: result.receipt };
}
