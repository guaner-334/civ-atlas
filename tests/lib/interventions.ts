/**
 * 干预测试(tests/civ-interventions*.test.ts,按内容分成几个文件,好分到几台机器上同时跑)共用的准备代码:
 * 世界和不干预时的历史(每个种子推一次,同一个文件里的测试共用)、逐字节比较、按条件现找要干预的国家 / 州 / 城
 */
import { expect } from 'vitest';
import { DEFAULT_PARAMS, generateWorld, type World } from '../../src/gen/world';
import { generateCiv, type Civ } from '../../src/gen/civ';
import type { Annal } from '../../src/gen/civ/types';
import { canCross } from '../../src/gen/civ/polities';
import { ownersAt } from '../../src/gen/civ/engine/timeline';
import { buildChronicle } from '../../src/gen/civ/story/chronicle';
import { capitalAt } from '../../src/gen/civ/growth';
import { resolveKey, type Intervention } from '../../src/gen/edits';

const worlds = new Map<string, World>();
export function world(seed: number): World {
  const key = `${seed}`;
  let w = worlds.get(key);
  if (!w) worlds.set(key, (w = generateWorld({ ...DEFAULT_PARAMS, seed })));
  return w;
}
const bases = new Map<string, Civ>();
export function base(seed: number): Civ {
  const key = `${seed}`;
  let c = bases.get(key);
  if (!c) bases.set(key, (c = generateCiv(world(seed))));
  return c;
}

export function bytes(a: ArrayBufferView) {
  return Buffer.from(a.buffer, a.byteOffset, a.byteLength);
}

/** 日志里年份 < y 的前几条 */
export function logBefore(civ: Civ, y: number) {
  const L = civ.log;
  let n = 0;
  while (n < L.size && L.year[n] < y) n++;
  return {
    n,
    parts: (['year', 'region', 'layer', 'value', 'cause'] as const).map((k) => bytes(L[k].subarray(0, n))),
  };
}
export const annalsBefore = (civ: Civ, y: number) => JSON.stringify(civ.annals.filter((e) => e.year < y));

/** 同一个世界、同样的干预推两次:整份 Civ(除了名字以外的一切也都)逐字节一致 */
export function fingerprint(civ: Civ): string {
  const L = civ.log;
  return JSON.stringify({
    annals: civ.annals,
    polities: civ.polities,
    settlements: civ.settlements,
    log: (['year', 'region', 'layer', 'value', 'cause'] as const).map((k) => bytes(L[k].subarray(0, L.size)).toString('base64')),
    polity: bytes(civ.polity).toString('base64'),
    culture: bytes(civ.culture).toString('base64'),
  });
}

/** 名字、配色、国号写法在推演结束后才定:只比推演出来的部分 */
export const strip = <T extends { name: string; color?: unknown; dynasties?: { name: string }[] }>(a: T[]) =>
  a.map((x) => ({ ...x, name: '', color: 0, eastern: undefined, dynasties: x.dynasties?.map((d) => ({ ...d, name: '' })) }));

/** 一个原本亡于战争(被别国灭掉)、到过"国"一档的国家,和它亡国前的一个年份 */
export function fallenPolity(civ: Civ) {
  const falls = civ.annals.filter((a) => a.kind === 'fall' && a.b >= 0);
  for (const f of falls) {
    const p = civ.polities[f.a];
    if (!(p.titles ?? []).some((t) => t.tier >= 1)) continue;
    const from = Math.max(Math.ceil(p.founded) + 1, Math.floor(p.ended! - 80));
    if (from >= p.ended!) continue;
    return { p, from };
  }
  throw new Error('找不到亡于战争的国家');
}

/** 要用到亡于战争的国家的测试跑这两个种子(种子 2024 的历史里没有国家亡于战争) */
export const FALL_SEEDS = [7, 3];

/** y 年前后两国接壤(按攻方能走的边) */
export function bordering(civ: Civ, a: number, b: number, y: number): boolean {
  const own = ownersAt(civ, y).polity;
  const reg = civ.regions;
  const A = civ.polities[a];
  for (let r = 0; r < reg.count; r++) {
    if (own[r] !== a) continue;
    for (let k = reg.adjStart[r]; k < reg.adjStart[r + 1]; k++) if (own[reg.adj[k]] === b && canCross(civ, A, reg.adjKind[k], y)) return true;
  }
  return false;
}

/** 一对会打仗的国家(结盟测试用):[a, b, 结盟的年份 = 那场仗之前 20 年, 那场仗的年份]。两国在结盟那年都已立国、没亡 */
export function rivals(civ: Civ, nth = 0): [number, number, number, number] {
  let n = 0;
  for (const w of civ.annals) {
    if (w.kind !== 'war' || w.settlement >= 0) continue;
    const from = Math.floor(w.year) - 20;
    const A = civ.polities[w.a];
    const B = civ.polities[w.b];
    if (A.founded >= from - 1 || B.founded >= from - 1 || (A.ended ?? Infinity) <= from || (B.ended ?? Infinity) <= from) continue;
    if (n++ < nth) continue;
    return [w.a, w.b, from, w.year];
  }
  throw new Error('找不到一对会打仗的国家');
}

export const warsBetween = (civ: Civ, a: number, b: number, from: number): Annal[] =>
  civ.annals.filter((e) => e.kind === 'war' && e.year >= from && ((e.a === a && e.b === b) || (e.a === b && e.b === a)));

/** 键 → 这个历史里的国家编号(−1 = 没有) */
export const idOf = (civ: Civ, key: string) => {
  const r = resolveKey(civ, key);
  return r && r.kind === 'polity' ? r.id : -1;
};

// ---------------------------------------------------------------------------
// 划州、立国、迁都、不许扩张

/** y 年某国的州数 */
export const sizeAt = (civ: Civ, p: number, y: number) => ownersAt(civ, y).polity.reduce((n, x) => n + (x === p ? 1 : 0), 0);

/** y 年(之前一刻)有人住、属某国、不是国都的一州,和它的主人(国家立国满 100 年、那年之后还在) */
export function ownedRegion(civ: Civ, y: number): { r: number; o: number } {
  const own = ownersAt(civ, y - 0.01);
  for (let r = 0; r < civ.regions.count; r++) {
    const o = own.polity[r];
    if (o < 0 || own.culture[r] < 0) continue;
    const P = civ.polities[o];
    if (P.founded > y - 100 || (P.ended ?? Infinity) <= y + 1 || civ.settlements[capitalAt(P, y)].region === r) continue;
    return { r, o };
  }
  throw new Error('找不到有主的州');
}

/** y 年有人住、不属任何国家(部落地带)的一州 */
export function tribalRegion(civ: Civ, y: number): number {
  const own = ownersAt(civ, y - 0.01);
  for (let r = 0; r < civ.regions.count; r++) if (own.culture[r] >= 0 && own.polity[r] < 0) return r;
  throw new Error('找不到部落地带');
}

/** y 年没人住的州 */
export function emptyRegion(civ: Civ, y: number): number {
  const own = ownersAt(civ, y - 0.01);
  for (let r = 0; r < civ.regions.count; r++) if (own.culture[r] < 0) return r;
  throw new Error('找不到没人住的州');
}

/**
 * y 年某国的一个边境州(不是国都),和挨着它的另一国(到第 3000 年仍在);原本到第 3000 年不归那一国。
 * y 年没有这样的州,就往前后每隔 100 年找(y − 100、y + 100、y − 200……),返回找到的那一年
 */
export function borderRegion(civ: Civ, y0: number): { r: number; o: number; q: number; y: number } {
  const reg = civ.regions;
  for (const d of [0, -100, 100, -200, 200, -300, 300]) {
    const y = y0 + d;
    const own = ownersAt(civ, y - 0.01).polity;
    for (let r = 0; r < reg.count; r++) {
      const o = own[r];
      if (o < 0 || civ.settlements[capitalAt(civ.polities[o], y)].region === r) continue;
      for (let k = reg.adjStart[r]; k < reg.adjStart[r + 1]; k++) {
        const q = own[reg.adj[k]];
        if (q >= 0 && q !== o && civ.polities[q].ended === undefined && civ.polity[r] !== q) return { r, o, q, y };
      }
    }
  }
  throw new Error('找不到边境州');
}

/** y 年最大的国家,和它国土里另一座城(不是国都) */
export function bigPolityCity(civ: Civ, y: number): { p: number; s: number } {
  const own = ownersAt(civ, y - 0.01).polity;
  const alive = civ.polities.filter((p) => p.founded < y - 1 && (p.ended ?? Infinity) > y + 1);
  alive.sort((a, b) => sizeAt(civ, b.id, y) - sizeAt(civ, a.id, y) || a.id - b.id);
  const P = alive[0];
  const cap = capitalAt(P, y);
  const s = civ.settlements.filter((x) => x.id !== cap && own[x.region] === P.id && x.founded < y && (x.ended ?? Infinity) > y).pop()!;
  return { p: P.id, s: s.id };
}

/** a 到 b 年间扩张最多的国家 */
function expander(civ: Civ, a: number, b: number): number {
  let best = -1;
  let gain = 0;
  for (const p of civ.polities) {
    // 开头至少 3 州:只有一州的部落不许扩张,多半撑不到禁令到期就被吞了
    if (!(p.founded < a && (p.ended ?? Infinity) > b) || sizeAt(civ, p.id, a) < 3) continue;
    const g = sizeAt(civ, p.id, b) - sizeAt(civ, p.id, a);
    if (g > gain) {
      gain = g;
      best = p.id;
    }
  }
  return best;
}

/**
 * 找一段"有国家在扩张"的 600 年:先看第 1000–1600 年,没有(这个世界的国家立得晚、或那几百年里谁都没长)再往后挪。
 * 返回起止年份和扩张得最多的国家
 */
export function expansion(civ: Civ): { a: number; b: number; p: number } {
  for (const a of [1000, 1200, 1400, 1600, 800]) {
    const b = a + 600;
    const p = expander(civ, a, b);
    if (p >= 0 && sizeAt(civ, p, b) - sizeAt(civ, p, a) > 5) return { a, b, p };
  }
  return { a: 1000, b: 1600, p: expander(civ, 1000, 1600) };
}

/** 干预年份之前逐字节一致:日志、史事;推到干预那一刻之前为止,国家表、城镇表、归属也一样 */
export function samePast(seed: number, v: Intervention, c: Civ) {
  const w = world(seed);
  const civ = base(seed);
  const y = v.from;
  const la = logBefore(c, y);
  const lb = logBefore(civ, y);
  expect(la.n, `seed ${seed} ${v.kind}:日志条数`).toBe(lb.n);
  la.parts.forEach((x, i) => expect(x.equals(lb.parts[i]), `seed ${seed} ${v.kind}:日志`).toBe(true));
  expect(annalsBefore(c, y), `seed ${seed} ${v.kind}:史事`).toBe(annalsBefore(civ, y));
  const cut = y - 1 / 256;
  const x0 = generateCiv(w, { endYear: cut });
  const x1 = generateCiv(w, { endYear: cut, interventions: [v] });
  expect(JSON.stringify(x1.polities), `seed ${seed} ${v.kind}:国家表`).toBe(JSON.stringify(x0.polities));
  expect(JSON.stringify(x1.settlements), `seed ${seed} ${v.kind}:城镇表`).toBe(JSON.stringify(x0.settlements));
  expect(bytes(x1.polity).equals(bytes(x0.polity))).toBe(true);
}

export const ivText = (c: Civ) => buildChronicle(c).filter((e) => e.kind === 'intervene').map((e) => e.text);
