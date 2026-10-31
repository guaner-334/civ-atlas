/**
 * 作者下令「大迁徙」「不许迁」(干预 trek / stay;推演规则见 gen/civ/migration.ts)在界面上要算的东西和说法:
 *   填写页(TrekPage.tsx):那一年这一族住哪几州、从哪州出发;指定一州时哪些州能选(陆路走得到、有城、不是本族的)、
 *     几州远、地图上那条预估的虚线(和推演同一套找路,trekRoute.ts:草原快,林地、山地慢,不过海)
 *   地图上的预估虚线(TrekPlanLayer.tsx 画):这里存着要画的那一条(planStore)
 *   推完的提示条:"克拉尔族一支西徙，1911 年在瑶渊之野立萨热汗国""……，尚在途中""……，没立成国，散居瑶渊之野等三州";
 *     没生效的黄色写原因
 */
import { useSyncExternalStore } from 'react';
import type { Civ } from '../gen/civ/types';
import { regionLabel } from '../gen/civ/story/display';
import { polityName } from '../gen/civ/growth';
import { ownersAt } from '../gen/civ/timeline';
import { searchTrek, trekPaths, trekRouteTo, type TrekPaths } from '../gen/civ/trekRoute';
import { interventionFate } from '../gen/stepwise';
import { cnNumber } from '../gen/civ/story/chronicle';
import { eraText, spaced, yearAt, type Era } from '../gen/era';
import type { Intervention, TrekReach } from '../gen/edits';

export type TrekIv = Extract<Intervention, { kind: 'trek' }>;
export type StayIv = Extract<Intervention, { kind: 'stay' }>;

/** 推演挑时走多远的几档 */
export const TREK_REACH_NAMES: Record<TrekReach, string> = { near: '近', mid: '中', far: '远' };

/** 那一年住着民族 c 的州(州号升序) */
export function folkRegions(civ: Civ, c: number, y: number): number[] {
  const cu = ownersAt(civ, y).culture;
  const out: number[] = [];
  for (let r = 0; r < civ.regions.count; r++) if (cu[r] === c) out.push(r);
  return out;
}

/** 州 r 那一年住着人的城(一州同一时刻最多一座;没有 = −1) */
export function livingCityIn(civ: Civ, r: number, y: number): number {
  for (const s of civ.settlements) if (s.region === r && s.founded <= y && (s.ended === undefined || s.ended > y)) return s.id;
  return -1;
}

let scratch: { R: number; P: TrekPaths } | null = null;
function pathsFor(R: number): TrekPaths {
  if (!scratch || scratch.R !== R) scratch = { R, P: trekPaths(R) };
  return scratch.P;
}

/**
 * 民族 c 在 y 年往外找路(start ≥ 0 = 只从那一州出发,和推演里作者给了出发的州一样;不然从本族各州一起往外),
 * 多远都找。返回各州几州远(走不到 = −1)和从哪一州走进来;同一份历史、同一年、同一族、同一个起点只算一次
 */
let lastSearch: { civ: Civ; y: number; c: number; start: number; hops: Int32Array; from: Int32Array } | null = null;
export function trekReach(civ: Civ, y: number, c: number, start: number): { hops: Int32Array; from: Int32Array } {
  if (lastSearch && lastSearch.civ === civ && lastSearch.y === y && lastSearch.c === c && lastSearch.start === start) return lastSearch;
  const R = civ.regions.count;
  const P = pathsFor(R);
  searchTrek(civ.regions, R, ownersAt(civ, y).culture, c, start, Infinity, P);
  lastSearch = { civ, y, c, start, hops: P.hops.slice(), from: P.from.slice() };
  return lastSearch;
}

/** 走到 target 的路线(起点 … target;走不到 / 就是本族的州 = null) */
export function trekRoute(civ: Civ, y: number, c: number, start: number, target: number): number[] | null {
  const { hops, from } = trekReach(civ, y, c, start);
  if (!(hops[target] > 0)) return null;
  return trekRouteTo({ from } as TrekPaths, target);
}

/** 指定一州时能选的州:y 年陆路走得到、有住人的城、不是本族住的 */
export function trekTargets(civ: Civ, y: number, c: number, start: number): Set<number> {
  const { hops } = trekReach(civ, y, c, start);
  const cu = ownersAt(civ, y).culture;
  const out = new Set<number>();
  for (const s of civ.settlements) {
    const r = s.region;
    if (r < 0 || r >= hops.length || !(hops[r] > 0) || cu[r] < 0 || cu[r] === c) continue;
    if (s.founded <= y && (s.ended === undefined || s.ended > y)) out.add(r);
  }
  return out;
}

// ---- 地图上的预估虚线(TrekPlanLayer.tsx 画;填写页开着时有,离开收起) ----

export interface TrekPlan {
  /** 路线上依次经过的州(起点 … 目的地) */
  route: number[];
  /** 线和字的颜色(这一族的颜色) */
  color: [number, number, number];
  /** 目的地旁边写的州名 */
  dest: string;
}

let plan: TrekPlan | null = null;
const subs = new Set<() => void>();

export function setTrekPlan(p: TrekPlan | null) {
  if (p === plan) return;
  plan = p;
  for (const f of subs) f();
}

export function getTrekPlan(): TrekPlan | null {
  return plan;
}

export function useTrekPlan(): TrekPlan | null {
  return useSyncExternalStore(
    (f) => {
      subs.add(f);
      return () => subs.delete(f);
    },
    getTrekPlan,
  );
}

// ---- 推完的提示条 ----

/**
 * 推完的提示条(后面由调用方接"；已从……起重新推演"):
 *   "克拉尔族一支西徙，1911 年在瑶渊之野立萨热汗国" / "……，1911 年到瑶渊之野，没立成国" / "……，往瑶渊之野，尚在途中"
 *   没生效:"克拉尔族大迁徙没生效：陆路走不到瑶渊之野"。F = 族名
 */
export function trekDoneText(civ: Civ, v: TrekIv, i: number, F: string, era: Era | undefined): { ok: boolean; text: string } {
  const f = i >= 0 ? interventionFate(civ, i) : null;
  if (f?.state === 'void') {
    const why = f.why.startsWith('那一年') ? `第 ${v.from} 年${f.why.slice(3)}` : f.why;
    return { ok: false, text: `${F}大迁徙没生效：${eraText(why, era)}` };
  }
  const M = i >= 0 ? civ.migrations?.find((x) => x.iv === i) : undefined;
  if (!M) return { ok: true, text: `${F}一支举族远徙` };
  const head = `${F}一支${M.dir}徙`;
  const dest = M.route[M.route.length - 1];
  const D = regionLabel(civ, dest);
  if (M.settled === undefined) return { ok: true, text: `${head}，往${D}，尚在途中` };
  const at = spaced(yearAt(Math.floor(M.settled), era));
  const P = M.polity !== undefined ? civ.polities[M.polity] : undefined;
  if (P) return { ok: true, text: `${head}，${at}在${D}立${polityName(P, M.settled) || P.name}` };
  const n = M.lands?.length ?? 0;
  return { ok: true, text: `${head}，${at}到${D}，没立成国${n ? `，散居${cnNumber(n)}州` : ''}` };
}
