/**
 * 随机拼一份大纲(单测、scripts/outline-stats.ts 用):照一份没有大纲的历史挑情节 ——
 * 年份落在 [from, to](默认第 800–2900 年:多数世界第 500 年前后才有第一批国家)。约三成照那份历史里真发生过的事写(年份前后挪几年),其余随手挑当时还在的国家、它们的州和城、在位的君主。
 * 按种子定的伪随机,同样的输入拼出同样的大纲。
 */
import type { Civ } from '../../src/gen/civ/types';
import { polityAlive } from '../../src/gen/civ/growth';
import { ownersAt } from '../../src/gen/civ/engine/timeline';
import { personKey, polityKey, regionKey, settlementKey, type Plot, type PlotKind } from '../../src/gen/edits';

const KINDS: PlotKind[] = ['found', 'fall', 'hold', 'war', 'ally', 'capital', 'death', 'split', 'disaster', 'submit', 'peace', 'dynasty', 'revolt', 'collapse', 'story'];

/** 照 civ 拼 n 条情节,年份落在 [from, to] */
export function samplePlots(civ: Civ, seed: number, n: number, from = 800, to = 2900): Plot[] {
  let s = (seed * 2654435761 + n * 97) >>> 0;
  const rnd = () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32;
  const pickOf = <T>(xs: readonly T[]): T | undefined => (xs.length ? xs[Math.floor(rnd() * xs.length)] : undefined);
  const out: Plot[] = [];
  for (let tries = 0; out.length < n && tries < n * 20; tries++) {
    const id = out.length + 1;
    const year = Math.round(from + rnd() * (to - from));
    const real = rnd() < 0.3 ? fromAnnal(civ, year, rnd) : null;
    if (real) {
      out.push({ id, ...real, text: `第 ${id} 条` });
      continue;
    }
    const alive = civ.polities.filter((p) => polityAlive(p, year));
    const A = pickOf(alive);
    const B = pickOf(alive.filter((p) => p !== A));
    if (!A || !B) continue;
    const a = polityKey(civ, A.id);
    const b = polityKey(civ, B.id);
    const own = ownersAt(civ, year).polity;
    const regionsOf = (p: number) => [...own.keys()].filter((r) => own[r] === p);
    const kind = pickOf(KINDS)!;
    const base = { id, kind, year, text: `第 ${id} 条` };
    if (kind === 'found' || kind === 'split') {
      const r = pickOf(regionsOf(B.id));
      if (r === undefined) continue;
      out.push(kind === 'split' ? { ...base, region: regionKey(civ, r), a: b } : { ...base, region: regionKey(civ, r) });
    } else if (kind === 'fall') out.push(rnd() < 0.5 ? { ...base, a: b, b: a } : { ...base, a: b });
    else if (kind === 'hold') {
      const rs = regionsOf(B.id).slice(0, 1 + Math.floor(rnd() * 4));
      if (!rs.length) continue;
      out.push({ ...base, a, regions: rs.map((r) => regionKey(civ, r)) });
    } else if (kind === 'capital') {
      const c = pickOf(civ.settlements.filter((x) => x.founded <= year && (x.ended === undefined || x.ended > year) && own[x.region] === A.id));
      if (!c) continue;
      out.push({ ...base, a, city: settlementKey(civ, c.id) });
    } else if (kind === 'death') {
      const P = pickOf((civ.people ?? []).filter((p) => p.role === 'ruler' && p.polity === A.id && (p.from ?? Infinity) <= year && (p.until === undefined || p.until > year)));
      if (!P) continue;
      out.push({ ...base, person: personKey(civ, P.id), ...(rnd() < 0.3 ? { how: 'murdered' as const } : {}) });
    } else if (kind === 'disaster') {
      const t = pickOf(['plague', 'famine', 'quake'] as const)!;
      if (t === 'famine') out.push({ ...base, type: t, level: 2, a });
      else if (t === 'quake') {
        const r = pickOf(regionsOf(A.id));
        if (r === undefined) continue;
        out.push({ ...base, type: t, level: 2, region: regionKey(civ, r) });
      } else out.push({ ...base, type: t, level: 2, city: settlementKey(civ, A.capital) });
    } else if (kind === 'dynasty' || kind === 'revolt' || kind === 'collapse') out.push({ ...base, a });
    else if (kind === 'story') out.push({ id, kind, year, text: `第 ${id} 条` });
    else out.push({ ...base, a, b });
  }
  // 按年份排好,编号、作者的话照排好的先后
  return out.sort((x, y) => x.year - y.year || x.id - y.id).map((p, i) => ({ ...p, id: i + 1, text: `第 ${i + 1} 条` }));
}

/** 照真发生过的一件事写一条(年份挪几年);附近没有合适的 = null */
function fromAnnal(civ: Civ, year: number, rnd: () => number): Omit<Plot, 'id'> | null {
  const near = civ.annals.filter((e) => Math.abs(e.year - year) < 40 && e.a >= 0 && ['war', 'fall', 'alliance', 'split', 'capital', 'submit', 'peace', 'dynasty'].includes(e.kind));
  if (!near.length) return null;
  const e = near[Math.floor(rnd() * near.length)];
  const y = Math.max(0, Math.floor(e.year) + Math.round((rnd() - 0.5) * 12));
  const a = polityKey(civ, e.a);
  const b = e.b >= 0 ? polityKey(civ, e.b) : undefined;
  switch (e.kind) {
    case 'war':
      return b ? { kind: 'war', year: y, a, b } : null;
    case 'alliance':
      return b ? { kind: 'ally', year: y, a, b } : null;
    case 'peace':
      return b ? { kind: 'peace', year: y, a, b } : null;
    case 'submit':
      return b ? { kind: 'submit', year: y, a, b } : null;
    case 'fall':
      return { kind: 'fall', year: y, a, ...(b ? { b } : {}) };
    case 'split':
      return { kind: 'split', year: y, region: regionKey(civ, e.region), ...(b ? { a: b } : {}) };
    case 'capital':
      return e.settlement >= 0 ? { kind: 'capital', year: y, a, city: settlementKey(civ, e.settlement) } : null;
    case 'dynasty':
      return { kind: 'dynasty', year: y, a };
    default:
      return null;
  }
}

/**
 * 拼一份"像样的"大纲(scripts/outline-stats.ts 的 plausible):每条都是那一年照理可能、但前后 15 年里没发生的事 ——
 * 接壤的两国开战、大国吞掉接壤的小国(大三倍以上)、占邻国挨着的一两州、称臣,立国一百五十年以上的大国分裂(某一州自立)、
 * 大崩解、改朝换代、民变;最多 n 条,年份落在第 900–2800 年、彼此隔开 60 年。按种子定的伪随机
 */
export function samplePlausible(civ: Civ, seed: number, n: number): Plot[] {
  let s = (seed * 2654435761) >>> 0;
  const rnd = () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32;
  const plots: Plot[] = [];
  const { adjStart, adj } = civ.regions;
  for (let k = 0; k < 400 && plots.length < n; k++) {
    const year = Math.round(900 + rnd() * 1900);
    if (plots.some((p) => Math.abs(p.year - year) < 60)) continue;
    const own = ownersAt(civ, year).polity;
    const size = new Map<number, number>();
    const pairs = new Set<string>();
    own.forEach((o, r) => {
      if (o < 0) return;
      size.set(o, (size.get(o) ?? 0) + 1);
      for (let j = adjStart[r]; j < adjStart[r + 1]; j++) {
        const q = own[adj[j]];
        if (q >= 0 && q !== o) pairs.add(`${o},${q}`);
      }
    });
    const kinds: PlotKind[] = ['war', 'fall', 'hold', 'split', 'collapse', 'dynasty', 'submit', 'revolt'];
    const kind = kinds[Math.floor(rnd() * kinds.length)];
    const ps = [...pairs].map((x) => x.split(',').map(Number));
    const id = plots.length + 1;
    const text = `第 ${id} 条`;
    const near = (pred: (e: Civ['annals'][number]) => boolean) => civ.annals.some((e) => Math.abs(e.year - year) <= 15 && pred(e));
    const any = <T>(xs: readonly T[]) => xs[Math.floor(rnd() * xs.length)];
    if (kind === 'war' || kind === 'submit') {
      // 称臣写成 b 向 a 称臣:查的方向跟着反过来
      const c = ps.filter(([a, b]) => !near((e) => e.kind === kind && (kind === 'war' ? e.a === a && e.b === b : e.a === b && e.b === a)));
      if (!c.length) continue;
      const [a, b] = any(c);
      plots.push(kind === 'war' ? { id, kind, year, a: polityKey(civ, a), b: polityKey(civ, b), text } : { id, kind, year, a: polityKey(civ, b), b: polityKey(civ, a), text });
    } else if (kind === 'hold') {
      const c = ps.filter(([a, b]) => size.get(a)! >= size.get(b)!);
      if (!c.length) continue;
      const [a, b] = any(c);
      const touching = (r: number) => {
        for (let j = adjStart[r]; j < adjStart[r + 1]; j++) if (own[adj[j]] === a) return true;
        return false;
      };
      const rs = [...own.keys()].filter((r) => own[r] === b && touching(r)).slice(0, 2);
      if (!rs.length) continue;
      plots.push({ id, kind, year, a: polityKey(civ, a), regions: rs.map((r) => regionKey(civ, r)), text });
    } else if (kind === 'fall') {
      const c = ps.filter(([a, b]) => size.get(a)! >= 3 * size.get(b)! && !near((e) => e.kind === 'fall' && e.a === b));
      if (!c.length) continue;
      const [a, b] = any(c);
      plots.push({ id, kind, year, a: polityKey(civ, b), b: polityKey(civ, a), text });
    } else {
      const big = [...size].filter(([p, m]) => m >= (kind === 'split' ? 15 : kind === 'revolt' ? 8 : 30) && year - civ.polities[p].founded > 150 && polityAlive(civ.polities[p], year));
      if (!big.length) continue;
      const [p] = any(big);
      if (near((e) => e.kind === kind && (kind === 'split' || kind === 'revolt' ? e.b === p : e.a === p))) continue;
      if (kind === 'split') {
        const rs = [...own.keys()].filter((r) => own[r] === p && civ.polities[p].capital !== r);
        plots.push({ id, kind, year, a: polityKey(civ, p), region: regionKey(civ, any(rs)), text });
      } else plots.push({ id, kind, year, a: polityKey(civ, p), text });
    }
  }
  return plots.sort((x, y) => x.year - y.year).map((p, i) => ({ ...p, id: i + 1, text: `第 ${i + 1} 条` }));
}
