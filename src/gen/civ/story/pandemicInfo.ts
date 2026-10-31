/**
 * 全球大疫(pandemic.ts)的整理:只读 Civ(史事 pandemic / plague / desolate、城镇表里带 pan 的折损、乡村人口和发展度的快照),
 * 不碰推演引擎。界面(国家卡片、时间轴)、地图(荒地、疫区)、编年史、统计都用它;起过哪几场(pandemicsOf)和推完以后断路(breakRoads)是推演那一侧的,在 pandemicRoads.ts。纯计算,不碰 DOM。
 *
 * 给界面和地图的数据:
 *   pandemicsOf(civ)        起过的全球大疫:哪年起、凋敝到哪年、起疫的城、疫前天下人口、染了哪些州(哪一刻、死几成)、疫后荒废了哪些城
 *   slumpAt(civ, 年)        那年各州凋敝的程度(0–1;染了疫、凋敝还没结束的州 = 轻重)
 *   wasteAt(civ, 年)        那年各州荒了几成(荒地,0–1:乡下比疫前少了 WASTE_FROM 以上的,少得越多越大;人长回来就淡掉)
 *   peakEraAt(civ, 州, 年)  州到那年为止到过的最高时代数值(国家卡片"时代写曾到哪")
 *   城荒废:Settlement.ended + 史事 desolate;路断:Route.abandoned / 修回的那一段(breakRoads)
 */
import type { Civ, Year } from '../types';
import { SEV_REF, pandemicsOf } from '../pandemicRoads';
import { ruralPopulationAt } from '../growth';
import { CAP_COUNT, LEVEL_SCALE, developmentAt, eraLevel } from '../development';

/** 起过的全球大疫(定义在 pandemicRoads.ts,推完以后断路也用;原来从这里 import 的照旧能用) */
export { pandemicsOf, type PandemicInfo } from '../pandemicRoads';

/** 第 year 年各州凋敝的程度(0–1:染了疫、凋敝还没结束的州 = 城里死几成 ÷ 0.4,最多 1;几场叠着的取重的);这年没有凋敝 = null */
export function slumpAt(civ: Civ, year: Year): Float32Array | null {
  let out: Float32Array | null = null;
  for (const p of pandemicsOf(civ)) {
    if (!(p.year <= year && year < p.end)) continue;
    for (const h of p.hits) {
      if (!(h.year <= year)) continue;
      out ??= new Float32Array(civ.regions.count);
      out[h.region] = Math.max(out[h.region], Math.min(1, h.loss / SEV_REF));
    }
  }
  return out;
}

/** 荒地:乡下比疫前少了这么多才算荒;再少 WASTE_SPAN 就是最荒(1) */
export const WASTE_FROM = 0.12;
const WASTE_SPAN = 0.3;
/** 凋敝结束后这么多年还在看荒不荒(人早长回来了) */
const WASTE_AFTER = 250;

/**
 * 第 year 年各州荒了几成(0–1;荒地):染过全球大疫的州,乡下人口比疫前(起疫那一刻)少了 WASTE_FROM 以上的,少得越多越大,
 * 人长回来就淡掉。几场叠着的取荒的;这年哪里都不荒 = null
 */
export function wasteAt(civ: Civ, year: Year): Float32Array | null {
  let out: Float32Array | null = null;
  for (const p of pandemicsOf(civ)) {
    if (!(p.year <= year && year < p.end + WASTE_AFTER)) continue;
    for (const h of p.hits) {
      if (!(h.year <= year)) continue;
      const before = ruralPopulationAt(civ, h.region, p.year);
      if (!(before > 0)) continue;
      const v = 1 - ruralPopulationAt(civ, h.region, year) / before;
      if (!(v > WASTE_FROM)) continue;
      out ??= new Float32Array(civ.regions.count);
      out[h.region] = Math.max(out[h.region], Math.min(1, (v - WASTE_FROM) / WASTE_SPAN));
    }
  }
  return out;
}

/** 州 r 到第 year 年为止到过的最高时代数值(按发展度的快照,和那一年的;没有发展度 = 0) */
export function peakEraAt(civ: Civ, r: number, year: Year): number {
  const dev = civ.development;
  if (!dev) return 0;
  let best = eraLevel(developmentAt(dev, year), r);
  const ys = dev.snapYears;
  const v = new Float32Array(CAP_COUNT);
  for (let i = 0; i < ys.length && ys[i] <= year; i++) {
    const lv = dev.snaps[i];
    for (let c = 0; c < CAP_COUNT; c++) v[c] = lv[r * CAP_COUNT + c] / LEVEL_SCALE;
    const e = eraLevel(v, 0);
    if (e > best) best = e;
  }
  return best;
}
