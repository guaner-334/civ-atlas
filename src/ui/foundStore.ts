/**
 * 照故事找世界「用这个世界」建好的世界:谁是故事里的哪一国、隘口和交界在哪(侧栏顶上「照故事找的」一组,FoundSide.tsx)、
 * 这次的条件(「再找」带着它回去接着找)。按世界编号记着;也记在这个浏览器里(刷新以后那一组还在)。
 * 标记本身(隘口、交界)在世界的修改里(作者标记),删了标记这一组照旧在,只是那一行不再写「标记」。
 */
import { useSyncExternalStore } from 'react';
import type { WorldParams } from '../gen/params';
import { condList, judgeCond, type FinderCand, type FinderPlace, type FinderQuery } from '../gen/finder/query';
import type { FoundDetail } from './finderInfo';
import { placeTitle } from './FinderResults';
import { tenths } from './finderText';

export interface FoundRole {
  /** 故事里的叫法(帝国、山国) */
  role: string;
  /** 对上的国家 */
  polity: number;
  /** 开场那年的国名、州数 */
  name: string;
  size: number;
  /** 小字:"都霞都，和 4 国接壤" */
  note: string;
}

export interface FoundSpot {
  kind: FinderPlace['kind'];
  /** "隘口""三国交界" */
  title: string;
  /** 小字:"米里亚一带，口子 173 米，山脊约 1550 米" */
  note: string;
  cell: number;
  region: number;
  /** 加成的作者标记(编号;没加 = 不给) */
  mark?: number;
}

export interface FoundPick {
  year: number;
  /** 故事讲多少年(没写 = null) */
  span: number | null;
  query: FinderQuery;
  /** 搜的时候地图每个世界换一张 / 都用那一张 */
  map: 'each' | 'fixed';
  /** 搜的时候新建世界的参数(「再找」照它新建) */
  params: WorldParams;
  roles: FoundRole[];
  places: FoundSpot[];
}

/** 一种配法 → 记下来的那些(detail = 那个世界生成好了查到的名字;还没生成好 = null,小字少写几样) */
export function foundPickOf(q: FinderQuery, cand: FinderCand, places: readonly FinderPlace[], detail: FoundDetail | null, how: { map: 'each' | 'fixed'; params: WorldParams }): FoundPick {
  const list = condList(q);
  const fact = (role: number, kind: string) => {
    const i = list.findIndex((r) => r.role === role && r.cond.kind === kind);
    return i >= 0 ? (cand.facts[i]?.[0] ?? null) : null;
  };
  const roles = cand.roles.map((polity, i): FoundRole => {
    const d = detail?.roles[i];
    const bits: string[] = [];
    if (d?.capital) bits.push(`都${d.capital}`);
    const nb = fact(i, 'neighbors');
    const mtn = fact(i, 'mountain');
    const ports = fact(i, 'ports');
    if (nb !== null) bits.push(`和 ${nb} 国接壤`);
    else if (mtn !== null) bits.push(`边界${tenths(mtn)}是翻山`);
    else if (ports !== null) bits.push(`${ports} 个通航线的港口`);
    else if (d) bits.push(`和 ${d.neighbors.length} 国接壤`);
    return { role: q.roles[i]?.name ?? '', polity, name: cand.names[i], size: cand.sizes[i], note: bits.join('，') };
  });
  const spots = places
    .filter((p) => p.kind !== 'port')
    .map((p): FoundSpot => {
      const d = detail?.places.find((x) => x.cond === p.cond && x.cell === p.cell);
      let note = '';
      if (p.kind === 'pass') {
        // 每一处隘口量的是它自己那一条条件(故事里几对国家各有一处隘口时各写各的)
        const pf = cand.facts[p.cond] ?? null;
        const h = pf && pf[0] !== null ? Math.round(pf[0]) : null;
        const ridge = pf && pf[1] !== null ? Math.round(pf[1] / 10) * 10 : null;
        note = [d?.name ? `${d.name}一带` : '', h !== null ? `口子 ${h} 米` : '', ridge !== null ? `山脊约 ${ridge} 米` : ''].filter(Boolean).join('，');
      } else if (d) note = `${d.name}，${d.owner === null ? '无主' : `归${d.owner}`}`;
      return { kind: p.kind, title: placeTitle(q, p), note, cell: p.cell, region: p.region };
    });
  // 故事讲多少年:这个世界里真撑过了才写
  const si = list.findIndex((r) => r.cond.kind === 'span');
  const sc = si >= 0 ? list[si].cond : null;
  const span = sc && sc.kind === 'span' && judgeCond(sc, cand.facts[si] ?? null).ok ? sc.years : null;
  return { year: cand.year, span, query: q, map: how.map, params: how.params, roles, places: spots };
}

/** 「再找」:App 挂上(带着这次的条件新建一个世界、打开找世界那一页) */
let again: ((p: FoundPick) => void) | null = null;
export function setFindAgainHandler(f: ((p: FoundPick) => void) | null) {
  again = f;
}
export function findAgain(p: FoundPick) {
  again?.(p);
}

const KEY = 'finder-found:';
const mem = new Map<string, FoundPick | null>();
const subs = new Set<() => void>();
let ver = 0;

function read(id: string): FoundPick | null {
  if (mem.has(id)) return mem.get(id) ?? null;
  let v: FoundPick | null = null;
  try {
    const s = localStorage.getItem(KEY + id);
    if (s) v = JSON.parse(s) as FoundPick;
  } catch {
    v = null;
  }
  mem.set(id, v);
  return v;
}

/** 这个世界是照故事找的(没有 = null) */
export function getFound(id: string | null | undefined): FoundPick | null {
  return id ? read(id) : null;
}

/** 记下一个照故事找到、建好的世界 */
export function putFound(id: string, pick: FoundPick) {
  mem.set(id, pick);
  try {
    localStorage.setItem(KEY + id, JSON.stringify(pick));
  } catch {
    // 存不下(浏览器不让存、满了):只记在这一页里
  }
  ver++;
  for (const f of subs) f();
}

export function useFound(id: string | null | undefined): FoundPick | null {
  useSyncExternalStore(
    (f) => (subs.add(f), () => void subs.delete(f)),
    () => ver,
    () => ver,
  );
  return getFound(id);
}
