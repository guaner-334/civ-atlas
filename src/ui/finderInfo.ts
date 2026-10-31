/**
 * 照故事找世界:一个结果打开以后(那个世界在地图上生成好了),补上搜的时候没带回来的名字 ——
 * 国都叫什么、和谁接壤、隘口在哪一带、交界那州叫什么、有没有主、港口叫什么,和"后来怎样"的一句总结。
 * 搜的时候(后台线程)只交回量出来的数,不留整个世界;这些名字按打开的那个世界现查。纯计算,不碰 DOM。
 */
import type { Civ } from '../gen/civ/types';
import { AdjKind } from '../gen/civ/types';
import type { World } from '../gen/world';
import { ownersAt } from '../gen/civ/timeline';
import { capitalAt, polityName } from '../gen/civ/growth';
import { regionLabel } from '../gen/civ/story/display';
import { condList, type FinderCand, type FinderPlace, type FinderQuery } from '../gen/finder/query';

export interface FoundRole {
  /** 那年的国名 */
  name: string;
  /** 国都(城名;找不到 = '') */
  capital: string;
  /** 那年陆上接壤的国家(国名;故事里的别的国家不算在里面) */
  neighbors: string[];
  /** 那年几州 */
  size: number;
}

export interface FoundPlace extends FinderPlace {
  /** 州名(隘口:口子所在那州;交界:那州;港口:城名) */
  name: string;
  /** 那年那州的主人(国名;无主 = null) */
  owner: string | null;
  /** 交界:除了故事里的国家,还有谁在这里碰头(国名) */
  others: string[];
  /** 世界坐标 */
  x: number;
  y: number;
}

export interface FoundDetail {
  roles: FoundRole[];
  places: FoundPlace[];
}

/** 那年一国的州 */
function regionsOf(own: Int16Array, p: number): number[] {
  const out: number[] = [];
  for (let r = 0; r < own.length; r++) if (own[r] === p) out.push(r);
  return out;
}

/** 那年和 p 陆上接壤的国家(按共同边界上的州数多的在前) */
function neighborsOf(civ: Civ, own: Int16Array, p: number): number[] {
  const reg = civ.regions;
  const n = new Map<number, number>();
  for (let r = 0; r < own.length; r++) {
    if (own[r] !== p) continue;
    for (let k = reg.adjStart[r]; k < reg.adjStart[r + 1]; k++) {
      const kind = reg.adjKind[k];
      if (kind === AdjKind.SeaRoute || kind === AdjKind.Strait) continue;
      const o = own[reg.adj[k]];
      if (o >= 0 && o !== p) n.set(o, (n.get(o) ?? 0) + 1);
    }
  }
  return [...n.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0]).map(([o]) => o);
}

/** 打开的那个世界里,一种配法的名字(places = 按那种门槛挑好的地方,FinderRow.places) */
export function foundDetail(world: World, civ: Civ, cand: FinderCand, places: readonly FinderPlace[]): FoundDetail {
  const Y = cand.year;
  const own = ownersAt(civ, Y).polity;
  const pname = (p: number) => (civ.polities[p] ? polityName(civ.polities[p], Y) : '');
  const roles = cand.roles.map((p): FoundRole => {
    const pol = civ.polities[p];
    const cap = pol ? civ.settlements[capitalAt(pol, Y)] : undefined;
    const nb = neighborsOf(civ, own, p).filter((o) => !cand.roles.includes(o));
    return { name: pname(p), capital: cap?.name ?? '', neighbors: nb.map(pname), size: regionsOf(own, p).length };
  });
  const out = places.map((pl): FoundPlace => {
    const o = pl.region >= 0 && pl.region < own.length ? own[pl.region] : -1;
    const name = pl.kind === 'port' && pl.settlement !== undefined ? (civ.settlements[pl.settlement]?.name ?? '') : pl.region >= 0 ? regionLabel(civ, pl.region) : '';
    const others = pl.kind === 'junction' ? pl.polities.filter((x) => !cand.roles.includes(x)).map(pname) : [];
    return { ...pl, name, owner: o >= 0 ? pname(o) : null, others, x: world.mesh.x[pl.cell], y: world.mesh.y[pl.cell] };
  });
  return { roles, places: out };
}

/** 那年故事里各国所有州的治所(世界坐标;地图飞过去看全它们)、再加上几处地方 */
export function foundPoints(world: World, civ: Civ, cand: FinderCand, places: readonly FinderPlace[]): [number, number][] {
  const own = ownersAt(civ, cand.year).polity;
  const pts: [number, number][] = [];
  const seat = civ.regions.seat;
  for (const p of cand.roles) for (const r of regionsOf(own, p)) pts.push([world.mesh.x[seat[r]], world.mesh.y[seat[r]]]);
  for (const pl of places) pts.push([world.mesh.x[pl.cell], world.mesh.y[pl.cell]]);
  return pts;
}

/**
 * 地图飞过去要看全的那一块:故事里各国的国都、几处地方,加上各国离它们不远的州(大国隔海的属地、远处的飞地不算,
 * 不然一飞就是整张图)
 */
export function storyPoints(world: World, civ: Civ, cand: FinderCand, places: readonly FinderPlace[]): [number, number][] {
  const W = world.width;
  const X = world.mesh.x;
  const Y = world.mesh.y;
  const core: [number, number][] = [...cand.capitals.map((c) => [X[c.cell], Y[c.cell]] as [number, number]), ...places.map((p) => [X[p.cell], Y[p.cell]] as [number, number])];
  const all = foundPoints(world, civ, cand, places);
  if (!core.length) return all;
  // 中心:按圆周平均(左右接着的世界);半径:最远的那一处
  let sx = 0;
  let sy = 0;
  let yy = 0;
  for (const [x, y] of core) {
    const a = (x / W) * Math.PI * 2;
    sx += Math.cos(a);
    sy += Math.sin(a);
    yy += y;
  }
  const cx = ((Math.atan2(sy, sx) / (Math.PI * 2) + 1) % 1) * W;
  const cy = yy / core.length;
  const dist = (x: number, y: number) => {
    let dx = Math.abs(x - cx) % W;
    if (dx > W / 2) dx = W - dx;
    return Math.hypot(dx, y - cy);
  };
  const r = Math.max(...core.map(([x, y]) => dist(x, y)));
  // 各国的州离中心多远:大多数(八成五)都算进来,再远的零星几块(隔海的属地、飞地)不算
  const ds = all.map(([x, y]) => dist(x, y)).sort((a, b) => a - b);
  const most = ds.length ? ds[Math.floor((ds.length - 1) * 0.85)] * 1.2 : 0;
  const reach = Math.max(r * 1.6, W * 0.06, most);
  return [...core, ...all.filter(([x, y]) => dist(x, y) <= reach)];
}

/**
 * 后来怎样的一句总结:"130 年里山国从 29 州变成 16 州，一直没亡；帝国中途改朝，后来叫有桑皇朝。"
 * years = 故事讲多少年(没写 = 100)
 */
export function laterSummary(civ: Civ, q: FinderQuery, cand: FinderCand, years: number): string {
  const Y = cand.year;
  const end = Math.min(civ.endYear, Y + years);
  const span = Math.round(end - Y);
  if (span <= 0 || !cand.roles.length) return '';
  const own0 = ownersAt(civ, Y).polity;
  const own1 = ownersAt(civ, end).polity;
  const parts = cand.roles.map((p, i) => {
    const pol = civ.polities[p];
    const who = q.roles[i]?.name ?? '';
    if (!pol) return '';
    const a = regionsOf(own0, p).length;
    const b = regionsOf(own1, p).length;
    const died = pol.ended !== undefined && pol.ended <= end;
    const was = polityName(pol, Y);
    const now = polityName(pol, died ? pol.ended! : end);
    const renamed = now !== was ? `，后来叫${now}` : '';
    if (died) return `${who}第 ${Math.floor(pol.ended!)} 年亡了${renamed}`;
    const size = a === b ? `一直是 ${a} 州上下` : `从 ${a} 州${b > a ? '长到' : '缩到'} ${b} 州`;
    return `${who}${size}，一直没亡${renamed}`;
  });
  const body = parts.filter(Boolean).join('；');
  return body ? `${span} 年里${body}。` : '';
}

/** 故事讲多少年(「一起」里写的;没写 = 交界那条的撑过几年;再没有 = 100) */
export function storyYears(q: FinderQuery): number {
  for (const r of condList(q)) {
    const c = r.cond;
    if (c.kind === 'span') return c.years;
  }
  for (const r of condList(q)) {
    const c = r.cond;
    if (c.kind === 'junction' && 'lasting' in c && c.lasting) return c.lasting;
  }
  return 100;
}
