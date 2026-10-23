// 老存档迁移：把自由文本的装备/资产洗干净，变成引擎能记账的结构。
// 幂等：重复跑不会重复搬。

import { bagAdd } from './state.js';
import { ensureAccounts } from './money.js';
import { ensureBills, ensureDebts, ensureWork } from './ledger.js';
import { ensureAssets } from './assets.js';
import { isContainer, parseContainer, parseItemEntry } from './items.js';

export const MIGRATION_VERSION = 'items-1';

/** 把 "长剑（紫）×2""药剂包（…）" 拆进 bag；单件留下并标准化名字。 */
function migrateEquipment(state, report) {
  const p = state.player;
  if (!Array.isArray(p.equipment)) return;
  const keep = [];
  for (const raw of p.equipment) {
    const s = String(raw || '').trim();
    if (!s) continue;

    if (isContainer(s)) {
      for (const sub of parseContainer(s)) {
        bagAdd(state, sub.name, sub.qty);
        report.moved.push(`${sub.name}×${sub.qty}（来自${s.slice(0, 8)}…）`);
      }
      report.containers += 1;
      continue;
    }

    const parsed = parseItemEntry(s);
    if (!parsed) {
      keep.push(s);
      continue;
    }
    if (parsed.qty > 1) {
      bagAdd(state, parsed.label, parsed.qty);
      report.moved.push(`${parsed.label}×${parsed.qty}`);
      report.stacked += 1;
    } else {
      keep.push(parsed.label);
    }
  }
  p.equipment = Array.from(new Set(keep)).slice(0, 80);
}

export function migrateSave(state) {
  const report = {
    before: { equipment: (state.player.equipment || []).length, assets: (state.player.assets || []).length },
    stacked: 0,
    containers: 0,
    moved: [],
    industries: 0,
    livestock: 0,
    stock: 0,
  };

  ensureAccounts(state);
  ensureBills(state);
  ensureDebts(state);
  ensureWork(state);

  const assetsBefore = JSON.stringify(state.player.assets || []);
  ensureAssets(state);
  report.industries = (state.player.industries || []).length;
  report.livestock = (state.player.livestock || []).length;
  report.stock = (state.player.stock || []).length;
  report.assetsChanged = assetsBefore !== JSON.stringify(state.player.assets || []);

  migrateEquipment(state, report);

  state.flags ||= {};
  state.flags.migration = MIGRATION_VERSION;
  report.after = { equipment: state.player.equipment.length, bag: (state.player.bag || []).length };
  return report;
}

export function isMigrated(state) {
  return state?.flags?.migration === MIGRATION_VERSION;
}
