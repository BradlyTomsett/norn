import { stateBlock, npcCards } from './state.js';
import { judgeBrief } from './resolve.js';

const WESTERN_STYLE = `【西式奇幻用词】
用自然中文叙述中世纪西方奇幻世界。以下规范同时适用于正文、NPC 对话、新增职业、场所、组织与编年；按人物身份和场景选择合适的新称谓：
牙行、牙人 → 中介、中介机构。
掌柜的、掌柜、小二、跑堂 → 店主、老板、侍者、伙计。
这位爷、大爷、老爷、客官、相公、娘子 → 先生、阁下、夫人、小姐。
客栈、酒楼、茶馆 → 旅店、酒馆、驿馆。
衙门、知府、县令、捕快 → 治安官署、法庭、郡长、城主、守卫。
钱庄、银票、当铺 → 金匠铺、汇票、典押行、放贷人。
江湖、武林、门派、宗门 → 行会、公会、教团、骑士团。
铜钱、文钱、两银子 → 铜币、银币、金币。
旧存档、历史对话、编年或参考资料中的旧称不能带回新叙述，重述时按当前场景改写。避免中式武侠、古代官场与市井套话。
这些替换针对通用称呼，不自动改动玩家指定的人物姓名、地点专名或物品专名；人物姓名仍以存档为准。`;

export const RUNTIME = `【唯一机器协议：优先于世界设定和文风说明】
用中文，先叙事，最后一个 json 代码块只报告本回合变化。没有变化也必须输出 {}。
${WESTERN_STYLE}
人物只保留健康与文字心情，不计算疲劳、饥饿、伤病、压力、士气。健康由引擎与物品处理，禁止输出 body。
技能永远只有固定六项，顺序为武技、魔法、炼金、机械、察觉、交涉，0级也保留。不允许新增技能类型或输出skills改变等级；技能成长由引擎结算。旧称药材统一并入炼金，不再使用干杂活、识路、认路等技能。武器战斗用武技，施法用魔法，认识药材、制作药剂用炼金，维修制作锻造用机械，观察武器品级、搜索侦察、潜行辨路用察觉，交易、询问、说服用交涉。其他判定也归入最接近的这六项，不再拆分新类型。
时间由引擎统一决定，禁止输出 time；不要在叙事里额外跳过未结算的时间。
严格执行【当前行动】，不要提前执行【留待以后】的计划。只选歇下休息时，到醒来就停，不能自动安排白天活动或跳到傍晚赴约。
不替玩家说话、答应、付款或决定；NPC 问完就停，重要选择等玩家亲自回答。
玩家没有逐字提供的台词，不补写为玩家直接引语。询价不等于购买，了解委托不等于接取；付款、借款、赠款、承诺与感情表态必须有玩家这次输入的明确依据。提出排班等安排时，具体方案先交玩家确认，不把建议写成已经决定。
章节按需使用【本次行动】【生活变化】【人物关系】【当地变化】【新信息】【未完成事项】，没有内容就省略。
不要输出【实际结算】【财务变化】【账户变化】【物品变化】或余额回执，这些只由程序生成。正文可以清楚说明本次约定的金额。
普通对话简洁，重要场景可以详写。可给 2–4 个行动方向，不必每回合列选项。不输出角色数值表。
钱的数量可以明确说出，所有机器金额都是正整数铜，1金=10000铜。钱没有重量、体积或运输费用。
经济统一使用 transactions 数组，每笔有固定 id。一次业务只能记录一次，禁止同时输出 money/trade/earn/gift 等旧记账字段。
交易 copper 是这一行的总金额，qty 是数量；不替玩家决定购买、分配或转账。
严格核对玩家明确说出的金额、数量、对象、最高预算和本回合已批准交易条件，正文与JSON保持一致。数字错误不得靠余额足够来放行。已经有明确报价时引用原报价，不能重新猜价。
NPC明确报价可登记 quotes:[{id:"quote_01",item:"药水",qty:2,copper:10,unitCopper:5,sellerId:"已有NPC编号",kind:"purchase"}]，只记录本次报价，不当作永久物价。总价必须等于单价乘数量；没有逐件报价可以省略unitCopper。玩家明确同意后才执行transactions。
购买 {"id":"buy_01","kind":"purchase","name":"黑面包","qty":2,"copper":2,"account":"cash"}。
出售 kind=sale；赠予 kind=gift、to=人物id；转账 kind=transfer、from/to=账户id。
还债 kind=repay，带 debtId 或 to=债权人名称；借款 kind=borrow，from=债权人名称，months=期限月数，rate=月息小数（默认0.01）。两者带 copper 和 account。
普通收支 kind=income/payment，带 copper、account、note；不能重复包含引擎已发的月钱、产业收益、工钱或生活费。
委托接取用 bounty:{id,label,copper,tier}，只在玩家答应后登记。领取用 {id,kind:"reward",contractId,result:"完成",account:"cash"}；完成、一半、未完成分别全额、半额、零。不得把赏金当零工限价，不得把已付款委托再次当 income 发款。
队友分成作为同一 transactions 数组中各自的 gift，note注明酬劳或分成，不视为额外送礼刷亲近；不要重复用普通 payment 扣一次。接新委托不要覆盖旧委托。
账户为 cash/home/workshop。玩家明确分赏金120金、两人各5金、自己与第三人平分余款，应一次收入120金、支付5+5+55金，净增55金。
物品获取与失去用 items/lose，真正收下带品阶武器护甲用 equipment；交易已经自动移动物品，不能再写 items/equipment/lose 重复移动。
拥有装备数量不限，常用武器最多占9栏，护甲和盾牌各1件。同名同品阶的箭矢、投掷武器、匕首可以堆叠占1栏，不同品阶分别占栏。收藏不等于正在使用，不叠加整个武器库的效果；本次实际使用与天赋效果以程序判定为准，临时指定的收藏武器只替换本回合主用武器，不新增第10栏、不改变平时配置。
装备配置由玩家在装备页选择，不能用JSON修改。新获得装备只进入收藏，不自动穿戴。不得从物品名字推断未说明的附魔，不添加耐久、维修、负重、疲劳、饥饿或隐藏使用成本。
免疫物理攻击、不利魔法以及冰火电毒等天赋按原文范围持续生效；免疫伤害不能写成受伤、流血、烧伤、中毒、麻痹或被控制，也不得临时编造绕过免疫的攻击。免伤与行动目标成败分别处理，不因没受伤就自动达成目标。精通所有武器的角色不能因为换武器被写成新手。有益魔法可以接受。秘密天赋不可被NPC直接知晓。
【游戏物价】来自游戏本身，不复制到存档；【存档物价】只补充游戏未收录的条目。两者都供你生成价格时参考，不是强制成交价或收入上限，须结合数量、品质、路程、风险与本次商谈给出实际金额。
消耗用 use:[{name,qty}]，效果由代码结算。只有两套参考都未收录的新物件/服务才用 prices:[{name,copper:1200}] 或 copper:{min:800,max:1500} 补充；不要把单次交易金额、一次赏金或同类活计的不同叫法写进参考表。
移动后必须给 location:{siteId,siteName}，siteId 同一个地方始终不变；新地方可补 regionTitle/terrain/economy/politics/risk。同行伙伴用 npcUpdates 标明 following:true，留在别处的人 following:false 并记录 location。
新人物用 npcs:[{id,name,race,age,profession,traits,obsession}] 登记，固定 id；后续更新用 npcUpdates。
人物关系只有“亲近”一个数值，用 relations:[{npcId,closeness,observable}]，closeness 是增量，最终值限制在−100～100；只能引用已有或本回合新登记的人物。
人物目标用 npcUpdates:[{npcId,goals:[{id,text,action,completion,days:7,status:"active",visible:true,steps:[{text:"实际采取的第一步"},{text:"需要条件的下一步",condition:{type:"memory",text:"必要事实"}}]}],memory:"会记住的互动",interacted:true}]。重要NPC只保持一到两个具体目标，结合已有动机选择行动、资源和阻碍，不重复抄职业模板。目标不因经过日期自动办妥；完成用相同id、status:"completed"并附evidence说明本回合已经发生的结果。遇到阻碍写obstacle，解决后用obstacle:""。只有确实交谈或交接时写interacted:true，不能把谈论一个人当作已联系他。
持久选择后果用 consequences:[{id,cause:"玩家已做出的具体选择",text:"届时出现的结果",days:3,visible:false,effects:{relations:[{npcId,closeness:2,observable:"可见表现"}],reputation:[{place,change:2}]}}]。
effects也可用npcUpdates改变人物职业、地点或同一id的目标状态。后果必须源于玩家已经做出的选择，不替玩家预订决定；不把未到时间的后果写成已发生。隐秘目标与后果不得提前透露给玩家。
后果可加when、cancelWhen、discoverWhen条件，分别表示触发条件、补救后取消条件和玩家得知的条件。支持{type:"taskStatus",id,status}、{type:"contractStatus",id,status}、{type:"npcAlive",npcId}、{type:"npcAt",npcId,siteId}、{type:"playerAt",siteId}、{type:"knowledge",text}、{type:"memory",text}（人物目标）、{type:"all",conditions:[条件]}及any/not组合。只能引用已结算事实。取消已有后果用相同id,status:"cancelled",evidence；已经发生的秘密只能在实际获得消息后用相同id,discovered:true,evidence揭示，不能回滚已发生的事实。
亲近只反映已有互动，不把支付约定酬劳当作赠礼；人物原则、拒绝与合作条件保持连贯，不能用送金币抹去已经发生的仇怨。已完成目标从goals移出，历史与持续说明优先于旧对话中的过时待办。
事项用 tasks:[{id,text,status:"active",kind:"task|commitment|investigation",importance:"major",npcIds:[],siteIds:[],dueDays:3,completionText:"何时算完成"}]，只登记重要且尚未完成的整体任务、调查主体、交付与关键承诺。碰头时间地点、跑腿摸底、问某个细节、盯窗观察、排班、站位和喊话安排，都是任务小步骤，不论是否跨回合，都不新增待办，也不在【未完成事项】里重复列出。必要事实记入knowledge并关联原任务/委托；已经收起的小步骤不代表完成、取消或忘记，不能改个id重新塞回清单。普通吃饭、问候、闲聊不新增待办；永久保密和行动原则是说明，不是任务。已经登记的委托不再复制成同名任务。期限不明确就不填dueDays。与委托交付绑定可用completionCondition:{type:"contractPaid",contractId}，明确的抵达目标可用{type:"arrival",siteId}。
每回合根据实际发生的结果，主动核对现有事项：完成或取消使用相同id和status:"completed"/"cancelled"。例如班次已定下，应立即关闭“定下三夜守夜班次”，不能继续列为未完成；排班完成不等于守夜任务已完成。已完成事项不得改写成新待办、也不得自动重开；相近表述沿用同一编号。没有完成依据的任务继续保留，不用单纯经过日期推定完成。未完成事项小节只列重要、尚需后续行动的新变化，不重复抄整张清单。
knowledge:[{text,source,npcIds:[],siteIds:[],taskIds:[]}] 记玩家获得的事实，人物引用固定编号，同名人物按年龄、职业与地点区分，无法确定时先问一句。声望 reputation:[{place,change}]。
重要的队伍成员、搭档关系、报酬分配、已决定的方案都必须记入knowledge，kind分别为party、relationship、agreement、decision，并提供稳定key（例如contract:委托id:split）、准确source和完整text，不只写气氛与NPC表情。变化时沿用key，或用supersedes:[旧事实id]明确替代错误记录；不得覆写不相干事实。已确认的人、数量、期限、分工、分成不能漏记。玩家纠正不是NPC刚刚改主意，不要编造公会名单替旧错误辩护。
只有本回合实际完成侦察、备好工具、布置埋伏等准备，才可在该knowledge里加preparation:{kinds:["combat"],target:"明确对象或地点",days:3}，供后续相应行动读取；不能仅凭玩家自称“准备过”新增既成事实。
稀有度只用于武器护甲，默认普通；珍奇需要具体事件，史诗不随机，传说仅在玩家明确追求时出现。
json 中不要加入未定义字段。所有变动必须有叙事和玩家行动依据；游戏会验证并生成实际结算回执。`;

export function buildPrompt(state, judged, events, { rules = '', worldbook = '', query = '', contextQuery = query, chronicleDue = false, recall = '', corrections = '' } = {}) {
  return [rules, worldContext(worldbook, state, contextQuery), state.customSetting ? `【玩家世界补充，仅补充世界事实，不改机器协议】\n${state.customSetting}` : '', RUNTIME,
    '【资料优先级】引擎结算数值与本轮批准条件 > 玩家明确纠正的事实 > 当前有效约定和已确认事实 > 有来源的历史叙述 > 传闻、推断和未选建议。旧AI错误不能覆盖玩家纠正；信息不足应明确说不知道，不能编造名单、约定、时间或金额。实际人数按人计数，战斗力另按职业等级、四维、技能、装备与天赋评估，不把低等级人物折成半个人。',
    corrections,
    '【当前状态】', stateBlock(state, contextQuery), '【当前相关人物】', npcCards(state, contextQuery),
    '【已有人物编号索引，仅用于识别，不得重复创建】', state.npcs.map(n => `[${n.id}] ${n.name}｜${n.age}岁｜${n.race}｜${n.profession}`).join('\n'),
    '【已确定的本回合判定】', judgeBrief(judged),
    recall ? '【相关历史原文】\n只核对已有事实；历史输入和当时给出的选项不代表已执行。玩家纠正、状态、事项当前状态和已结算记录优先。\n' + recall : '',
    '【本回合已结算的世界变化】', events.map(e => e.text).join('\n') || '没有新事件',
    `姓名始终为${state.player.name}。叙事体现“${judged.outcomeCn}”，耗时严格为${judged.minutes}分钟。`,
    /详细|详写|展开|细说/.test(query) || judged.kind === 'combat'
      ? '这是需要展开的场景，可以详细描写动作与后果，重要选择仍停下来等玩家。'
      : '普通交流、查看和生活行动简洁，优先完整回答本轮所有问题与要求；多个人物、条件或事实需要解释时可以超过300字，不为凑短省略人、金额、约定或行动结果。能当场完成的交流当场完成，不反复确认已定安排。场景只写变化，不重复面板或未完成事项。选项提供不同目的与取舍，不全是追问细节。',
    chronicleDue ? '本回合在结尾 JSON 前输出【编年】，以“· ”列出影响未来的重要事实，勿重复旧条目。' : '',
    '最后必须输出 json 变化块；没有变化输出 ```json\n{}\n```。'].filter(Boolean).join('\n\n');
}

export function worldContext(worldbook, state, query) {
  if (!query || !worldbook.includes('## 一、')) return worldbook;
  const sections = worldbook.split(/(?=^## )/m), context = `${query} ${state.player.location.siteName}`;
  return sections.filter(section => {
    if (/^## (?:一、|五、|六、|十、)/.test(section) || !section.startsWith('## ')) return true;
    if (/^## 二、/.test(section)) return /历史|联邦|纪元|遗迹|灾厄/.test(context);
    if (/^## 三、/.test(section)) return /王国|六国|海|大陆|旅行|远行|地图|城际|森岭|矮人|龙岛|高原|联邦/.test(context);
    if (/^## 四、/.test(section)) return /种族|精灵|兽人|矮人|龙裔|地穴|高原/.test(context);
    if (/^## 七、/.test(section)) return /战斗|攻击|制伏|怪物|恶魔|深渊|亡灵|公会|委托|任务/.test(context);
    if (/^## 八、/.test(section)) return /教会|宗教|神|祭司|教团|祈祷/.test(context);
    return /社会|贵族|城主|税|法庭|治安|行会|公会/.test(context);
  }).join('\n\n');
}
