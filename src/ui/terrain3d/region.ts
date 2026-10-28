/**
 * 立起来的那一块叫什么("玉屏山一带"):框里最显眼的地名 —— 先找山脉(山脊线大半在框里的),再找湖、荒漠、岛,再找海;
 * 都没有就用框中心所在的州名;还没有就叫"这一块地方"。
 * 框里有哪几座山的最高峰(reliefPeaks):山名和海拔立在山顶上。
 */
import type { Civ, Place } from '../../gen/civ/types';
import type { Raster } from '../../gen/raster';
import type { World } from '../../gen/world';
import { regionLabel, regionNamed } from '../../gen/civ/display';
import type { ReliefBox } from '../../render/terrain3d/box';
import { metersText, placeFacts } from '../panelData';

/** 一块里最多立几座山的名字 */
const MAX_PEAKS = 3;

/** 立在山顶上的山名:名字、最高峰海拔(米,和山脉卡片上写的一样)、最高峰在哪(世界坐标) */
export interface ReliefPeak {
  id: number;
  name: string;
  meters: string;
  at: [number, number];
}

/**
 * 最高峰落在框里的山脉(按重要度、再按多高,最多 MAX_PEAKS 座)。最高峰和山脉卡片上的"最高峰"是同一个数、同一处
 */
export function reliefPeaks(box: ReliefBox, civ: Civ | null, world: World, raster: Raster): ReliefPeak[] {
  if (!civ) return [];
  const W = world.width;
  const inBox = (x: number, y: number, m = 0) => {
    let dx = x - box.cx;
    dx -= W * Math.round(dx / W);
    return Math.abs(dx) <= box.w / 2 + m && Math.abs(y - box.cy) <= box.h / 2 + m;
  };
  const out: (ReliefPeak & { rank: number; h: number })[] = [];
  civ.places.forEach((p, id) => {
    if (p.kind !== 'mountains') return;
    // 山脊线离框太远的不用算(最高峰在山脊线两旁一个地块宽以内)
    let near = false;
    for (let i = 0; i + 1 < p.path.length && !near; i += 2) near = inBox(p.path[i], p.path[i + 1], 12);
    if (!near) return;
    const f = placeFacts(civ, world, raster, id);
    if (f.peak === undefined || !f.peakAt || !inBox(f.peakAt[0], f.peakAt[1])) return;
    out.push({ id, name: p.name, meters: metersText(f.peak), at: f.peakAt, rank: p.rank, h: f.peak });
  });
  out.sort((a, b) => a.rank - b.rank || b.h - a.h);
  return out.slice(0, MAX_PEAKS).map(({ id, name, meters, at }) => ({ id, name, meters, at }));
}

const TIER: Partial<Record<Place['kind'], number>> = { mountains: 3, lake: 2, desert: 2, island: 2, sea: 1 };

export function reliefTitle(box: ReliefBox, civ: Civ | null, raster: Pick<Raster, 'w' | 'h' | 'scale' | 'cell'>, W: number): string {
  if (!civ) return '这一块地方';
  const inBox = (x: number, y: number) => {
    let dx = x - box.cx;
    dx -= W * Math.round(dx / W);
    return Math.abs(dx) <= box.w / 2 && Math.abs(y - box.cy) <= box.h / 2;
  };
  let best: { p: Place; tier: number; frac: number } | null = null;
  for (const p of civ.places) {
    const tier = TIER[p.kind];
    if (!tier) continue;
    const n = p.path.length >> 1;
    if (!n) continue;
    let inside = 0;
    for (let i = 0; i < n; i++) if (inBox(p.path[2 * i], p.path[2 * i + 1])) inside++;
    const frac = inside / n;
    // 山脉:山脊线至少四分之一在框里;别的:锚点大半在框里
    if (!inside || frac < (p.kind === 'mountains' ? 0.25 : 0.5)) continue;
    if (!best || tier > best.tier || (tier === best.tier && (p.rank < best.p.rank || (p.rank === best.p.rank && frac > best.frac)))) best = { p, tier, frac };
  }
  if (best) return `${best.p.name}一带`;
  // 框中心所在的州
  const sc = raster.scale;
  const x = Math.floor((((box.cx % W) + W) % W) * sc);
  const y = Math.floor(box.cy * sc);
  const c = x >= 0 && y >= 0 && x < raster.w && y < raster.h ? raster.cell[y * raster.w + x] : -1;
  const r = c >= 0 && c < civ.regions.of.length ? civ.regions.of[c] : -1;
  if (r >= 0 && regionNamed(civ, r)) return `${regionLabel(civ, r)}一带`;
  return '这一块地方';
}
