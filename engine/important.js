// A deliberately conservative index for the short review; full history remains untouched.
export function importantEvent(value) {
  const text = String(typeof value === 'string' ? value : value?.text || '').trim();
  if (!text || /(?:打算|准备|计划|希望|有望|尚未|未能|还没|如果|可能|是否|能否|争取|距离).{0,18}(?:晋升|晋级|通过|死亡|结婚|完成)/.test(text)
    || /(?:晋升|晋级|考核).{0,18}(?:失败|未通过|未成功)/.test(text)) return false;
  return /(?:晋升|晋级|升为|成为|获得|取得|通过|授予|获授).{0,14}(?:[SABCDE]级|[SABCDE]阶|等级|爵位|骑士|会长|大师|宗师|执照|资格)/i.test(text)
    || /(?:[SABCDE]级|[SABCDE]阶).{0,8}(?:晋升|晋级|考核)(?:已经|已)?(?:成功|通过)/i.test(text)
    || /(?:加入|退出|成立|解散).{0,10}(?:公会|行会|骑士团|教会|冒险队|队伍)/.test(text)
    || /(?:身亡|死亡|牺牲|被杀|复活|成婚|结婚|离婚|觉醒|继承王位|登基|政变|战争爆发|战争结束)/.test(text)
    || /(?:完成|解决|终结|击败|摧毁|揭露|挫败|夺回|救出).{0,24}(?:委托|任务|案件|阴谋|灾难|危机|首领|领主|家人|亲人|同伴|伙伴)/.test(text);
}
const normalized = value => String(typeof value === 'string' ? value : value?.text || '').normalize('NFKC').toLowerCase()
  .replace(/(?:复兴历)?\d+年(?:春|夏|秋|冬)?/g, '').replace(/[\s，。；、：:！!？?“”「」·,.]/g, '')
  .replace(/(?:正式|已经|成功|终于)(?=晋升|晋级|升为|成为)/g, '')
  .replace(/晋级为|晋升为|晋级至|晋升至|晋级到|晋升到|升到了|升为|晋级|晋升/g, '晋升');
function milestone(value) {
  const text = normalized(value), rank = text.match(/([sabcde])级/);
  if (!rank || !/晋升|通过|成为/.test(text)) return '';
  const actor = text.match(/([^，。]{1,12}?)(?:和|与)([^，。]{1,12}?)(?:晋升|通过|成为)/);
  return `rank:${rank[1]}:${actor ? [actor[1],actor[2]].sort().join('+') : (text.match(/(?:你|玩家|我|[\u4e00-\u9fff]{2,5})(?=晋升|通过|成为)/)?.[0] || '')}`;
}
export function uniqueImportant(rows) {
  const out = [], seen = new Set();
  for (const row of rows || []) {
    if (!importantEvent(row)) continue;
    const key = normalized(row), rank = milestone(row);
    if (!key || seen.has(key) || rank && seen.has(rank)) continue;
    if (out.some(old => { const other = normalized(old); return Math.min(key.length, other.length) >= 12 && (key.includes(other) || other.includes(key)); })) continue;
    seen.add(key); if (rank) seen.add(rank); out.push(row);
  }
  return out;
}
