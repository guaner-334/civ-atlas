/**
 * 时代图层、物产图层的侧栏列表(宽屏侧栏、手机世界卡片共用):
 * - 时代:这一年有州在的时代,新的在上;每行"某年首见于某地(某国)"和州数(只数有人住的州)。
 * - 物产:十一样,每行"N 州有 / M 州在用(矿:在采)";这一年哪州都还没发现的灰掉,写"都还没发现"。
 * - 管辖:四档各几州;现在的割据,每行"某州等几州 / 名义上属某国,某年起 / 割据了几年"。
 */
import type { Civ, Year } from '../gen/civ/types';
import { ERAS, RESOURCES, RESOURCE_COUNT, resourcesAt } from '../gen/civ/development';
import { polityName } from '../gen/civ/growth';
import { regionLabel } from '../gen/civ/display';
import { yearAt, type Era } from '../gen/era';
import { ERA_COLORS, eraLevelsAt, eraName } from '../render/civ/era';
import { RESOURCE_COLORS, RESOURCE_GLYPHS, resourceTier } from '../render/civ/resources';
import { CONTROL_TIERS } from '../gen/civ/control';
import { cnNumber } from '../gen/civ/chronicle';
import { CONTROL_COLORS, controlTiersAt, lordsAt } from '../render/civ/control';

export interface EraRow {
  era: number;
  name: string;
  color: readonly [number, number, number];
  sub: string;
  /** 这一年几个州 */
  n: number;
}

let levels: Float32Array | undefined;

/** 这一年的时代列表(新的在上;没有州在的时代不列) */
export function eraRows(civ: Civ, year: Year, era?: Era | null): EraRow[] {
  const dev = civ.development;
  if (!dev) return [];
  levels = eraLevelsAt(civ, year, undefined, levels);
  const n = new Array<number>(ERAS.length).fill(0);
  for (let r = 0; r < levels.length; r++) if (levels[r] >= 0) n[Math.min(ERAS.length - 1, Math.floor(levels[r]))]++;
  const rows: EraRow[] = [];
  for (let k = ERAS.length - 1; k >= 0; k--) {
    if (!n[k]) continue;
    let sub = '还没用上金属';
    const first = dev.events.find((e) => e.kind === 'first' && e.era === k);
    if (k > 0 && first) {
      const place = (first.settlement >= 0 && civ.settlements[first.settlement]?.name) || regionLabel(civ, first.region);
      const pol = first.polity >= 0 && civ.polities[first.polity] ? polityName(civ.polities[first.polity], first.year) : '';
      const folk = first.culture >= 0 && civ.cultures[first.culture]?.name ? `${civ.cultures[first.culture].name}人` : '';
      const who = pol || folk;
      sub = `${yearAt(first.year, era)}首见于${place}${who ? `（${who}）` : ''}`;
    } else if (k > 0) sub = '';
    rows.push({ era: k, name: eraName(k), color: ERA_COLORS[k], sub, n: n[k] });
  }
  return rows;
}

/** 物产一行的小字(哪儿有、什么时候发现、会不会空) */
export const RESOURCE_NOTES: readonly string[] = [
  '平原、河谷的田；人太多会把地种薄',
  '草原、牧场',
  '山里的矿；快进青铜时代时发现',
  '丘陵、沼泽；快进铁器时代时发现',
  '快进工业时代时发现',
  '森林；人多的地方会砍光',
  '海边、盐湖',
  '近海、湖泊；火药以后会捕空',
  '快进电气时代时发现，一两千年就采空',
  '快进信息时代时发现',
  '矿脉和沙金；不卡时代，最早认出的矿',
];

/** 矿(右边写"在采");别的写"在用" */
const MINES = new Set([2, 3, 4, 8, 9, 10]);

export interface ResourceRow {
  k: number;
  name: string;
  glyph: string;
  color: string;
  note: string;
  /** 几州有储量 */
  has: number;
  /** 这一年几州能用 */
  using: number;
  /** 这一年有没有哪州发现了 */
  found: boolean;
  /** "在采" / "在用" */
  verb: string;
}

let avail: Float32Array | undefined;

/** 这一年的物产列表(十一样,按 RESOURCES 的顺序) */
export function resourceRows(civ: Civ, year: Year): ResourceRow[] {
  const dev = civ.development;
  if (!dev) return [];
  avail = resourcesAt(dev, year, avail);
  const R = civ.regions.count;
  return RESOURCES.map((name, k) => {
    let has = 0;
    let using = 0;
    let found = false;
    for (let r = 0; r < R; r++) {
      const i = r * RESOURCE_COUNT + k;
      if (!dev.resources[i]) continue;
      has++;
      if (dev.found[i] <= year) found = true;
      if (resourceTier(avail![i])) using++;
    }
    return { k, name, glyph: RESOURCE_GLYPHS[k], color: RESOURCE_COLORS[k], note: RESOURCE_NOTES[k], has, using, found, verb: MINES.has(k) ? '在采' : '在用' };
  });
}

/** 四档的一行小字(手机上割据那一行短一点) */
const CONTROL_NOTES: readonly string[] = ['中央派官、收税、征兵都管得到', '交给当地人管，出兵打折扣', '名义上归属，实际自己说了算', '拥兵自重，打仗不出兵，迟早可能自立'];
const LORD_NOTE_SHORT = '拥兵自重，打仗不出兵';

export interface ControlRow {
  tier: number;
  name: string;
  color: readonly [number, number, number];
  sub: string;
  /** 这一年几个州 */
  n: number;
}

export interface LordRow {
  /** 起事的那座城所在的州(点一行跳过去) */
  region: number;
  /** 地盘里的州 */
  regions: number[];
  name: string;
  sub: string;
  /** 割据了几年 */
  years: number;
}

let tiers: Int16Array | undefined;

/** 这一年的管辖:四档各几州(都列,没有的写 0 州)、现在的割据(先起的在上);没有快照 = null */
export function controlRows(civ: Civ, year: Year, era?: Era | null, narrow = false): { tiers: ControlRow[]; lords: LordRow[] } | null {
  if (!civ.development?.controlYears?.length) return null;
  tiers = controlTiersAt(civ, year, tiers);
  const n = new Array<number>(CONTROL_TIERS.length).fill(0);
  for (let r = 0; r < tiers.length; r++) if (tiers[r] >= 0) n[tiers[r]]++;
  const rows = CONTROL_TIERS.map((name, k): ControlRow => ({ tier: k, name, color: CONTROL_COLORS[k], sub: narrow && k === 3 ? LORD_NOTE_SHORT : CONTROL_NOTES[k], n: n[k] }));
  const lords = lordsAt(civ, year).map((w): LordRow => {
    const k = w.regions.length;
    const place = regionLabel(civ, w.region);
    const pol = civ.polities[w.p];
    return {
      region: w.region,
      regions: w.regions,
      name: k > 1 ? `${place}等${k === 2 ? '两' : cnNumber(k)}州` : place,
      sub: `名义上属${pol ? polityName(pol, year) : ''}，${yearAt(w.start, era)}起`,
      years: Math.max(0, Math.floor(year) - Math.floor(w.start)),
    };
  });
  return { tiers: rows, lords };
}
