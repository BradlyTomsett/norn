// 声望：数值 → 称号。称号只用于叙事与提示词，不额外加价、不抽成。

export const REP_TIERS = [
  { min: 100, label: '传奇', hint: '这座城里的传说，走到哪儿都有人认出来' },
  { min: 60, label: '名人', hint: '城里叫得上号的人物' },
  { min: 30, label: '熟面孔', hint: '常来常往，店家记得你' },
  { min: 5, label: '见过', hint: '有人知道你这个人' },
  { min: -9, label: '无名', hint: '没人特别留意你' },
  { min: -35, label: '不受欢迎', hint: '有人背后议论你' },
  { min: -Infinity, label: '通缉', hint: '官方或帮派在找你' },
];

export function repLabel(v) {
  const n = Number(v) || 0;
  return REP_TIERS.find((t) => n >= t.min) || REP_TIERS[REP_TIERS.length - 1];
}

export function repText(reputation) {
  const entries = Object.entries(reputation || {});
  if (!entries.length) return '无';
  return entries.map(([place, v]) => `${place} ${v}（${repLabel(v).label}）`).join('、');
}
