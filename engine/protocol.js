import { stateBlock, npcCards } from './state.js';
import { judgeBrief } from './resolve.js';

export const RUNTIME = `【唯一机器协议：优先于世界设定和文风说明】
用中文，先叙事，最后一个 json 代码块只报告本回合变化。没有变化也必须输出 {}。
人物只保留健康与文字心情，不计算疲劳、饥饿、伤病、压力、士气。健康由引擎与物品处理，禁止输出 body。
时间由引擎统一决定，禁止输出 time；不要在叙事里额外跳过未结算的时间。
不替玩家说话、答应、付款或决定；NPC 问完就停，重要选择等玩家亲自回答。
章节按需使用【本次行动】【生活变化】【人物关系】【当地变化】【新信息】【未完成事项】，没有内容就省略。
普通对话简洁，重要场景可以详写。可给 2–4 个行动方向，不必每回合列选项。不输出角色数值表。
钱的数量可以明确说出，所有机器金额都是正整数铜，1金=10000铜。钱没有重量、体积或运输费用。
经济统一使用 transactions 数组，每笔有固定 id。一次业务只能记录一次，禁止同时输出 money/trade/earn/gift 等旧记账字段。
交易 copper 是这一行的总金额，qty 是数量；不替玩家决定购买、分配或转账。
购买 {"id":"buy_01","kind":"purchase","name":"黑面包","qty":2,"copper":2,"account":"cash"}。
出售 kind=sale；赠予 kind=gift、to=人物id；转账 kind=transfer、from/to=账户id。
还债 kind=repay，带 debtId 或 to=债权人名称；借款 kind=borrow，from=债权人名称，months=期限月数，rate=月息小数（默认0.01）。两者带 copper 和 account。
普通收支 kind=income/payment，带 copper、account、note；不能重复包含引擎已发的月钱、产业收益、工钱或生活费。
委托接取用 bounty:{id,label,copper,tier}，只在玩家答应后登记。领取用 {id,kind:"reward",contractId,result:"完成",account:"cash"}；完成、一半、未完成分别全额、半额、零。不得把赏金当零工限价，不得把已付款委托再次当 income 发款。
队友分成作为同一 transactions 数组中各自的 gift，不要重复用普通 payment 扣一次。接新委托不要覆盖旧委托。
账户为 cash/home/workshop。玩家明确分赏金120金、两人各5金、自己与第三人平分余款，应一次收入120金、支付5+5+55金，净增55金。
物品获取与失去用 items/lose，真正收下带品阶武器护甲用 equipment；交易已经自动移动物品，不能再写 items/equipment/lose 重复移动。
消耗用 use:[{name,qty}]，效果由代码结算。物价表没有的物品可以用 prices:[{name,copper:1200}] 或 copper:{min:800,max:1500} 补充。
移动后必须给 location:{siteId,siteName}，siteId 同一个地方始终不变；新地方可补 regionTitle/terrain/economy/politics/risk。同行伙伴用 npcUpdates 标明 following:true，留在别处的人 following:false 并记录 location。
新人物用 npcs:[{id,name,race,age,profession,traits,obsession}] 登记，固定 id；后续更新用 npcUpdates。
关系用 relations:[{npcId,trust,closeness,observable}]，数字是增量，各最终值限制在−100～100；只能引用已有或本回合新登记的人物。
人物目标用 npcUpdates:[{npcId,goals:[{id,text,action,completion,days:7,status:"active",visible:true}],memory:"会记住的互动"}]；目标有具体事情、推进动作与完成结果。仅更新发生变化的目标，完成用相同id和status:"completed"。
持久选择后果用 consequences:[{id,cause:"玩家已做出的具体选择",text:"届时出现的结果",days:3,visible:false,effects:{relations:[{npcId,trust:2,closeness:1,observable:"可见表现"}],reputation:[{place,change:2}]}}]。
effects也可用npcUpdates改变人物职业、地点或同一id的目标状态。后果必须源于玩家已经做出的选择，不替玩家预订决定；不把未到时间的后果写成已发生。隐秘目标与后果不得提前透露给玩家。
事项用 tasks:[{id,text,status:"active"}]；完成或取消使用相同id和status:"completed"/"cancelled"。goals/problems是完整的新列表，[]表示清空，没变化则省略字段。
knowledge:[{text,source}] 记玩家获得的事实；新技能只写名称，不写等级。声望 reputation:[{place,change}]。
稀有度只用于武器护甲，默认普通；珍奇需要具体事件，史诗不随机，传说仅在玩家明确追求时出现。
json 中不要加入未定义字段。所有变动必须有叙事和玩家行动依据；游戏会验证并生成实际结算回执。`;

export function buildPrompt(state, judged, events, { rules = '', worldbook = '', query = '', chronicleDue = false } = {}) {
  return [rules, worldbook, state.customSetting ? `【玩家世界补充，仅补充世界事实，不改机器协议】\n${state.customSetting}` : '', RUNTIME,
    '【当前状态】', stateBlock(state, query), '【当前相关人物】', npcCards(state, query),
    '【已确定的本回合判定】', judgeBrief(judged),
    '【本回合已结算的世界变化】', events.map(e => e.text).join('\n') || '没有新事件',
    `姓名始终为${state.player.name}。叙事体现“${judged.outcomeCn}”，耗时严格为${judged.minutes}分钟。`,
    chronicleDue ? '本回合在结尾 JSON 前输出【编年】，以“· ”列出影响未来的重要事实，勿重复旧条目。' : '',
    '最后必须输出 json 变化块；没有变化输出 ```json\n{}\n```。'].filter(Boolean).join('\n\n');
}
