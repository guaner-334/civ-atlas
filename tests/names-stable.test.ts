/**
 * 名字、稳定键、历史"留在原地"(阶段 4 改地形):
 * - 起名不碰推演:除名字外的世界、历史钉住指纹(推演有意改了就更新,GENERATOR_VERSION 加一);同种子两次(连名字)逐字节相同
 * - 名字按位置取:放一座小火山 / 挖一个湖以后,锚点和语感都没变的地名不变;远处的海名基本不变;挖湖时远处的地名 ≥ 80% 不变
 * - 改过地形的世界照没改过时的地名(civ/index.ts 的 nameRefOf):涂一笔(加陆地、压成海、抬山)以后,远处同一处地方的名字一个不变、
 *   也不被新冒出来的海挤掉;再涂第二笔也一样。照着沿用的那一份推到第 0 年就停:地名和推到哪一年无关
 * - 涂一道又高又宽的山:远处照没改地形的同一颗星球换算海拔(world.ts 的 planetOf),不跟着变矮,山名一个不少
 * - 推演随机数按位置取(gen/civ/rand.ts):改地形后州号、国家编号错开,远处的民族、国家大多照旧
 * - 稳定键按地块定位:改地形以后指回同一块地方,或者找不到;旧 r 格式(州号)照样能读
 * - 干预用新键:改地形以后照样生效,指不到的标"未生效"
 */
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { DEFAULT_PARAMS, MAP_H, MAP_W, generateWorld, type World } from '../src/gen/world';
import { generateCiv } from '../src/gen/civ';
import type { Civ, Place } from '../src/gen/civ/types';
import { interventionOutcome } from '../src/gen/civ/chronicle';
import { applyNames, cultureKey, polityKey, regionKey, resolveKey, settlementKey, type Intervention, type TerrainOp } from '../src/gen/edits';
import { ownersAt } from '../src/gen/civ/timeline';
import { sketchGrid, type SketchStroke } from '../src/gen/sketch';

// ---------------------------------------------------------------------------
// 工具

/** 离某类地块(陆地 / 海)最远的一格(按邻接步数;只在地图中间一带找)—— 和 terrain-edits.test.ts 一样 */
function farthestFrom(w: World, wantLand: boolean): number {
  const { n, adjStart, adj, x, y } = w.mesh;
  const dist = new Int32Array(n).fill(-1);
  const q: number[] = [];
  for (let i = 0; i < n; i++) if ((w.water[i] === 0) !== wantLand) (dist[i] = 0), q.push(i);
  for (let h = 0; h < q.length; h++) {
    const i = q[h];
    for (let k = adjStart[i]; k < adjStart[i + 1]; k++) {
      const j = adj[k];
      if (dist[j] < 0) (dist[j] = dist[i] + 1), q.push(j);
    }
  }
  let best = -1;
  for (let i = 0; i < n; i++) {
    if ((w.water[i] === 0) !== wantLand || Math.abs(y[i] - MAP_H / 2) > 260 || x[i] < 200 || x[i] > MAP_W - 200) continue;
    if (best < 0 || dist[i] > dist[best]) best = i;
  }
  return best;
}

interface Case {
  w0: World;
  c0: Civ;
  w1: World;
  c1: Civ;
  op: TerrainOp;
}

const bases = new Map<number, { w: World; c: Civ }>();
function base(seed: number) {
  let b = bases.get(seed);
  if (!b) {
    const w = generateWorld({ ...DEFAULT_PARAMS, seed });
    bases.set(seed, (b = { w, c: generateCiv(w) }));
  }
  return b;
}

/** 界面上的档位(gen/terrainEdits.ts 的 TERRAIN_PRESETS):海里最开阔处放一座小火山("小"档)/ 陆上离海最远处挖一个湖("中"档:州数会变、州号错开) */
const cases = new Map<string, Case>();
function edited(seed: number, kind: 'volcano' | 'lake'): Case {
  const id = `${seed}-${kind}`;
  let c = cases.get(id);
  if (!c) {
    const { w: w0, c: c0 } = base(seed);
    const at = farthestFrom(w0, kind === 'lake');
    const pts = [Math.round(w0.mesh.x[at]), Math.round(w0.mesh.y[at])];
    const op: TerrainOp = kind === 'volcano' ? { kind, pts, r: 18, s: 0.85 } : { kind, pts, r: 16, s: 1 };
    const w1 = generateWorld({ ...DEFAULT_PARAMS, seed }, undefined, [op]);
    cases.set(id, (c = { w0, c0, w1, c1: generateCiv(w1), op }));
  }
  return c;
}

/** 离修改处够远(世界坐标)才算"远处" */
const FAR = 200;
const farFrom = (k: Case) => (cell: number) => Math.hypot(k.w0.mesh.x[cell] - k.op.pts[0], k.w0.mesh.y[cell] - k.op.pts[1]) > FAR;

/** 改地形以后同一个地理实体:同种类、锚点最近(3 个地块间距以内) */
function counterpart(k: Case, p: Place): Place | null {
  const { x, y } = k.w0.mesh;
  const sp = Math.sqrt((MAP_W * MAP_H * 0.66) / DEFAULT_PARAMS.cells);
  let best: Place | null = null;
  let bd = Infinity;
  for (const q of geoPlaces(k.c1)) {
    if (q.kind !== p.kind) continue;
    const d = Math.hypot(x[p.cell!] - x[q.cell!], y[p.cell!] - y[q.cell!]);
    if (d < bd) (bd = d), (best = q);
  }
  return bd <= 3 * sp ? best : null;
}

const styleOf = (civ: Civ, p: Place) => (p.culture >= 0 ? civ.cultures[p.culture].style : '');
/** 山海湖岛这些地理名(关隘跟着大路、守关战走,是历史的一部分,不在"改地形以后地名留在原地"里比) */
const geoPlaces = (c: Civ) => c.places.filter((p) => p.kind !== 'pass');
const ratio = (xs: boolean[]) => xs.filter(Boolean).length / Math.max(1, xs.length);

/**
 * 除名字以外的世界 + 历史的指纹(名字、语感、东方 / 西幻、拉丁原形、改名前的名字不算;人物跟着名字、性别走的几项也不算;
 * 小数按 64 位原样)
 */
const NAME_FIELDS = new Set(['name', 'style', 'eastern', 'latin', 'defaultName']);
/** 人物(有 role 的对象)上跟着名字、性别走的几项(母亲是女的,就不另记"母亲是嫁来的宗室女") */
const PERSON_NAME_FIELDS = new Set(['female', 'maleName', 'courtesy', 'art', 'title']);
const f64 = new Float64Array(1);
const f64b = new Uint8Array(f64.buffer);
function historyPrint(world: World, civ: Civ): string {
  const h = createHash('sha1');
  const feed = (v: unknown): void => {
    if (v === null || v === undefined) return void h.update(`~${v}`);
    if (ArrayBuffer.isView(v)) return void h.update(new Uint8Array(v.buffer, v.byteOffset, v.byteLength));
    if (Array.isArray(v)) {
      h.update(`[${v.length}`);
      v.forEach(feed);
      return void h.update(']');
    }
    if (typeof v === 'object') {
      const person = typeof (v as { role?: unknown }).role === 'string';
      for (const k of Object.keys(v as object).sort()) {
        if (NAME_FIELDS.has(k) || (person && PERSON_NAME_FIELDS.has(k))) continue;
        h.update(`.${k}`);
        feed((v as Record<string, unknown>)[k]);
      }
      return;
    }
    // 小数按 64 位原样比:推演里的 pow / exp / log 都舍入到 24 位(gen/civ/rand.ts),Apple 芯片的 macOS 和 x64 的 Linux(CI)上逐位一样
    if (typeof v === 'number') {
      f64[0] = v;
      return void h.update(f64b);
    }
    h.update(`${typeof v}:${String(v)}`);
  };
  feed({ elevation: world.elevation, water: world.water, flux: world.flux });
  // 发展度(推演后算的,不改历史)由 determinism.test.ts 钉住;这里不算它,期望值和加它以前一样
  // 地图上画的关隘(civ.places 里的 pass)是后加的,加它时别的一个没变:不算它,期望值和加它以前一样
  // 商道、思潮(推演里只读、不改历史)也由 determinism.test.ts 钉住;这里不算它们:期望值和加它们以前一样,就是历史一个字没变
  const { development: _dev, trade: _trade, ideology: _ideo, ...history } = civ;
  feed({ ...history, places: geoPlaces(civ) });
  return h.digest('hex').slice(0, 16);
}

// ---------------------------------------------------------------------------

describe('起名不碰推演', () => {
  it('没有改地形时,除名字外的世界、历史钉住指纹;同种子两次连名字都一样', () => {
    // 期望值是 GENERATOR_VERSION 20(球面世界 + 人物、战役 + 洋流 + 君主世系 + 邦交 + 君主倾向和扩张算账(好战影响开战;迁都后按新国都重新看边地;同一刻的即位、到达排定次序) + 名臣 + 按养得活多少人算的宜居度和城的人口上限 + 封闭内海、贴海的湖、湖心小块地的处理 + 立国更早、边缘立国、民族分化 + 航线和航海时代 + 发展度反过来影响人口、打仗和远航 + 仗短而狠、乘胜连下、前线拉锯 + 饥荒、民变、大崩解,加上推演后贴上去的信仰)(GENERATOR_VERSION 22 起还有称霸大陆的大国盛极而衰;24 起走过的航线不通到遗址;27 起中央管到几成、割据;29 起管到几成和动荡每年算一次;35 起议事;36 起君主有了诸子、王子领兵、争储,宗室据地自立;37 起据险断后;38 起议事第二批:改军制、改官制、分镇、脱离;39 起立约与中立地;40 起有了掌实权的人和两国宗室联姻;41 起开战看内政;43 起战争节奏:议和了还会再打、仗打得密、罢兵割地;44 起亡国之君出奔邻国;46 起大迁徙;47 起季节进推演:出兵避冬、春荒;48 起大迁徙的方位按整条路线定,只有 migrations 里的方位变了;49 起时代做法:直征、禁军、铨选要等国中有了户籍、常备军、文官考选;50 起一部分人物换成女的,人物的性别、原来的男名、字、号、称号、母亲那一项不再算进来(期望值换成不算它们的;第 49、50 版代码算出来一样);51 起将门世家、复国之君接上故国世系:人物多了父子、补出来的宗室,将领名臣的籍贯跟着父亲;52 起嫁来的宗室女、临朝的太后成了人物(人物多了、编号挪了,名臣辅政有一部分换成太后,历史不变))算的。推演、地形有意改了的话更新它,并把 GENERATOR_VERSION 加一
    const expected: Record<number, string> = { 7: '59a0a64b2817a4a3', 2024: '7b0b946887cecd3f' };
    for (const seed of [7, 2024]) {
      const P = { ...DEFAULT_PARAMS, cells: 12000, seed };
      const w = generateWorld(P);
      const a = generateCiv(w);
      if (process.env.PRINT_FINGERPRINT) console.log(`names-stable seed ${seed}: ${historyPrint(w, a)}`);
      expect(historyPrint(w, a), `seed ${seed}`).toBe(expected[seed]);
      const b = generateCiv(generateWorld(P));
      const names = (c: Civ) =>
        JSON.stringify([c.cultures.map((x) => [x.name, x.style]), c.regions.name, c.settlements.map((x) => x.name), c.polities.map((p) => [p.name, p.eastern, p.dynasties?.map((d) => d.name)]), c.places.map((p) => [p.name, p.latin])]);
      expect(names(b)).toBe(names(a));
    }
  }, 60_000);
});

describe.each([7, 2024])('改地形以后名字留在原地 · seed=%i', (seed) => {
  it('放一座小火山:锚点和语感都没变的地名不变(≥ 95%);远处的海名不变 ≥ 80%', () => {
    const k = edited(seed, 'volcano');
    const far = farFrom(k);
    const kept: boolean[] = [];
    const seas: boolean[] = [];
    for (const p of geoPlaces(k.c0)) {
      if (!far(p.cell!)) continue;
      const q = counterpart(k, p);
      if (p.kind === 'sea') seas.push(q?.name === p.name);
      if (q && q.cell === p.cell && styleOf(k.c1, q) === styleOf(k.c0, p)) kept.push(q.name === p.name);
    }
    expect(kept.length, '锚点、语感都没变的地名够多').toBeGreaterThan(10);
    expect(ratio(kept), `seed ${seed} 锚点、语感没变的地名不变的比例`).toBeGreaterThanOrEqual(0.95);
    expect(seas.length).toBeGreaterThan(3);
    expect(ratio(seas), `seed ${seed} 远处海名不变的比例`).toBeGreaterThanOrEqual(0.8);
  }, 60_000);

  it('挖一个湖:远处的地名(海、山、河、湖、岛、荒漠)不变 ≥ 80%;同一处的城锚点、语感都没变的,城名不变', () => {
    const k = edited(seed, 'lake');
    const far = farFrom(k);
    const same = geoPlaces(k.c0).filter((p) => far(p.cell!)).map((p) => counterpart(k, p)?.name === p.name);
    expect(same.length).toBeGreaterThan(20);
    expect(ratio(same), `seed ${seed} 远处地名不变的比例`).toBeGreaterThanOrEqual(0.8);
    // 城:同一地块上的第一座城,民族的语感也没变的,名字不变
    const first1 = new Map<number, number>();
    for (const s of k.c1.settlements) if (!first1.has(s.cell)) first1.set(s.cell, s.id);
    const seen = new Set<number>();
    const cities: boolean[] = [];
    for (const s of k.c0.settlements) {
      if (seen.has(s.cell) || !far(s.cell)) continue;
      seen.add(s.cell);
      const t = k.c1.settlements[first1.get(s.cell) ?? -1];
      if (t && k.c1.cultures[t.culture]?.style === k.c0.cultures[s.culture]?.style) cities.push(t.name === s.name);
    }
    expect(cities.length).toBeGreaterThan(100);
    // 挖湖以后远处的历史会错开一些,城名跟着换:GENERATOR_VERSION 18 量的是 seed 7 0.92、seed 2024 0.91
    expect(ratio(cities), `seed ${seed} 同一处、语感没变的城名不变的比例`).toBeGreaterThanOrEqual(0.88);
  }, 60_000);
});

// ---------------------------------------------------------------------------
// 涂一笔(编辑地形「形状」页的笔,和界面上一样:陆地 / 海 / 山地,半径 40,程序补全"只补细节")

/** 涂了这几笔的世界和历史 */
function painted(seed: number, strokes: SketchStroke[]): { w: World; c: Civ } {
  const w = generateWorld({ ...DEFAULT_PARAMS, seed }, undefined, [], sketchGrid({ rest: 'auto', coast: 0.6, fill: 'detail', strokes }));
  return { w, c: generateCiv(w) };
}

/** 三笔:最开阔的海里涂一笔陆地、离海最远的陆地上涂一笔海、另一块陆地上(离第二笔 500 以外)涂一道山 */
function threeStrokes(w: World): { label: string; s: SketchStroke }[] {
  const sea = farthestFrom(w, false);
  const land = farthestFrom(w, true);
  const [sx, sy, lx, ly] = [w.mesh.x[sea], w.mesh.y[sea], w.mesh.x[land], w.mesh.y[land]].map(Math.round);
  // 另一块陆地:离第二笔 500 以外、离海最远(按邻接步数)的一格
  const { n, adjStart, adj, x, y } = w.mesh;
  const step = new Int32Array(n).fill(-1);
  const q: number[] = [];
  for (let i = 0; i < n; i++) if (w.water[i] !== 0) (step[i] = 0), q.push(i);
  for (let h = 0; h < q.length; h++) for (let k = adjStart[q[h]]; k < adjStart[q[h] + 1]; k++) if (step[adj[k]] < 0) (step[adj[k]] = step[q[h]] + 1), q.push(adj[k]);
  let m = -1;
  for (let i = 0; i < n; i++) {
    if (w.water[i] !== 0 || Math.abs(y[i] - MAP_H / 2) > 260 || Math.hypot(x[i] - lx, y[i] - ly) < 500) continue;
    if (m < 0 || step[i] > step[m]) m = i;
  }
  const [mx, my] = [Math.round(x[m]), Math.round(y[m])];
  return [
    { label: '加陆地', s: { kind: 'land', r: 40, pts: [sx - 30, sy, sx, sy + 10, sx + 30, sy] } },
    { label: '压成海', s: { kind: 'sea', r: 40, pts: [lx - 30, ly, lx, ly - 10, lx + 30, ly] } },
    { label: '抬山', s: { kind: 'mountain', h: 1, r: 40, pts: [mx - 50, my - 20, mx, my, mx + 50, my + 20] } },
  ];
}

/** 离这几笔(笔宽以外)都超过 FAR 的地块 */
const farFromStrokes = (w: World, strokes: SketchStroke[]) => (cell: number) =>
  strokes.every((s) => {
    let d = Infinity;
    for (let k = 0; k + 1 < s.pts.length; k += 2) {
      let dx = Math.abs(w.mesh.x[cell] - s.pts[k]);
      if (dx > MAP_W / 2) dx = MAP_W - dx;
      d = Math.min(d, Math.hypot(dx, w.mesh.y[cell] - s.pts[k + 1]));
    }
    return d - s.r > FAR;
  });

/** a 里远处的每个地名,在 b 里找同一处(同一类、锚点够近,和 places.ts 认同一处的规矩一样;一对一,近的先配):改了名的、找不到的 */
function farNames(w: World, a: Civ, b: Civ, far: (cell: number) => boolean): { n: number; renamed: string[]; gone: string[]; lowered: string[] } {
  const { x, y } = w.mesh;
  const dist = (p: Place, q: Place) => {
    let dx = Math.abs(x[p.cell!] - x[q.cell!]);
    if (dx > MAP_W / 2) dx = MAP_W - dx;
    return Math.hypot(dx, y[p.cell!] - y[q.cell!]);
  };
  const pairs: [number, number, number][] = [];
  const A = geoPlaces(a);
  const B = geoPlaces(b);
  A.forEach((p, i) =>
    B.forEach((q, j) => {
      const lim = p.kind === 'mountains' || p.kind === 'river' ? 40 : Math.max(20, 1.2 * Math.max(p.size ?? 0, q.size ?? 0));
      if (p.kind === q.kind && dist(p, q) <= lim) pairs.push([dist(p, q), i, j]);
    }),
  );
  pairs.sort((s, t) => s[0] - t[0] || s[1] - t[1] || s[2] - t[2]);
  const to = new Map<number, number>();
  const taken = new Set<number>();
  for (const [, i, j] of pairs) if (!to.has(i) && !taken.has(j)) to.set(i, j), taken.add(j);
  const out = { n: 0, renamed: [] as string[], gone: [] as string[], lowered: [] as string[] };
  A.forEach((p, i) => {
    if (!far(p.cell!)) return;
    out.n++;
    const j = to.get(i);
    if (j === undefined) out.gone.push(p.name);
    else if (B[j].name !== p.name) out.renamed.push(`${p.name} → ${B[j].name}`);
    if (j !== undefined && B[j].rank > p.rank) out.lowered.push(`${p.name} 显示档 ${p.rank} → ${B[j].rank}`);
  });
  return out;
}

describe.each([7, 2024])('涂一笔以后远处的地名不变 · seed=%i', (seed) => {
  it('加陆地、压成海、抬山各涂一笔:远处的地名一个不改、一个不少,显示档不降', () => {
    const { w: w0, c: c0 } = base(seed);
    for (const { label, s } of threeStrokes(w0)) {
      const { w, c } = painted(seed, [s]);
      expect(w.sketch, `${label}:涂上了`).toBeTruthy();
      const r = farNames(w0, c0, c, farFromStrokes(w0, [s]));
      expect(r.n, `seed ${seed} ${label}:远处的地名够多`).toBeGreaterThan(30);
      expect(r.renamed, `seed ${seed} ${label}:改了名的`).toEqual([]);
      expect(r.gone, `seed ${seed} ${label}:找不到的`).toEqual([]);
      expect(r.lowered, `seed ${seed} ${label}:总览里退下去的`).toEqual([]);
    }
  }, 120_000);

  it('涂了第一笔再涂第二笔:离两笔都远的地名不变', () => {
    const { w: w0 } = base(seed);
    const [a, b] = threeStrokes(w0);
    const one = painted(seed, [a.s]);
    const two = painted(seed, [a.s, b.s]);
    const r = farNames(w0, one.c, two.c, farFromStrokes(w0, [a.s, b.s]));
    expect(r.n).toBeGreaterThan(30);
    expect(r.renamed, `seed ${seed}:改了名的`).toEqual([]);
    expect(r.gone, `seed ${seed}:找不到的`).toEqual([]);
    expect(r.lowered, `seed ${seed}:总览里退下去的`).toEqual([]);
  }, 120_000);
});

describe.each([7, 2024])('涂一道高山以后远处的山不跟着变矮 · seed=%i', (seed) => {
  it('又高又宽的一道山:远处陆地的海拔 99% 以上不变(差不到 1 米),山名的门槛(最高海拔)不变,远处的地名一个不少、显示档不降;涂的山不高得离谱', () => {
    const { w: w0, c: c0 } = base(seed);
    const s: SketchStroke = { ...threeStrokes(w0)[2].s, h: 2, r: 80 };
    const { w, c } = painted(seed, [s]);
    const far = farFromStrokes(w0, [s]);
    let farLand = 0;
    let moved = 0;
    /** 笔涂到的地块(离笔画的点不到半径) */
    const inStroke = (cell: number) => {
      for (let k = 0; k + 1 < s.pts.length; k += 2) {
        let dx = Math.abs(w0.mesh.x[cell] - s.pts[k]);
        if (dx > MAP_W / 2) dx = MAP_W - dx;
        if (Math.hypot(dx, w0.mesh.y[cell] - s.pts[k + 1]) <= s.r) return true;
      }
      return false;
    };
    let top = 0;
    for (let i = 0; i < w0.mesh.n; i++) {
      if (w.water[i] === 0 && inStroke(i)) top = Math.max(top, w.elevation[i]);
      if (!far(i) || w0.water[i] !== 0) continue;
      farLand++;
      if (w.water[i] !== 0 || Math.abs(w.elevation[i] - w0.elevation[i]) >= 1) moved++;
    }
    expect(farLand).toBeGreaterThan(5000);
    // GENERATOR_VERSION 26 以前:全图按涂上的高山换算,远处 99% 以上的陆地变矮(1500 米以上的中位矮了 10%–46%),远处的山名消失 7–8 个
    expect(moved / farLand, `seed ${seed} 远处海拔变了的陆地块`).toBeLessThan(0.01);
    expect(w.maxElevation, `seed ${seed} 最高海拔`).toBe(w0.maxElevation);
    const r = farNames(w0, c0, c, far);
    expect(r.n).toBeGreaterThan(30);
    expect(r.gone, `seed ${seed}:找不到的`).toEqual([]);
    expect(r.lowered, `seed ${seed}:总览里退下去的`).toEqual([]);
    // 涂的地方照这个世界自己的"最高峰"换算(和以前一样):最高处几千米,不到万米
    expect(top, `seed ${seed} 涂的山最高处`).toBeGreaterThan(4000);
    expect(top, `seed ${seed} 涂的山最高处`).toBeLessThan(7000);
  }, 120_000);
});

describe('改过地形的世界照着沿用的地名推到第 0 年就停', () => {
  it('地名和推到哪一年无关(第 0 年、第 3000 年起的一样)', () => {
    for (const seed of [7, 2024]) {
      for (const names of [undefined, { central: 1, hellenic: 2 }]) {
        const w = generateWorld({ ...DEFAULT_PARAMS, cells: 12000, seed });
        const sig = (c: Civ) => geoPlaces(c).map((p) => [p.kind, p.cell, p.name, p.latin, p.culture < 0 ? '' : c.cultures[p.culture].style]);
        expect(sig(generateCiv(w, { endYear: 0, ...(names ? { names } : {}) })), `seed ${seed}`).toEqual(sig(generateCiv(w, names ? { names } : {})));
      }
    }
  }, 120_000);
});

describe.each([7, 2024])('改地形以后远处的历史大多照旧 · seed=%i', (seed) => {
  /** 远处(离修改处 > FAR)、改前改后都是陆地的地块上,这一年的民族 / 国家没变(按稳定键配对:同一处发源的民族、同一处立的国)的比例 */
  function kept(k: Case, year: number): { culture: number; polity: number } {
    const far = farFrom(k);
    const { c0, c1 } = k;
    const cu = c0.cultures.map((_, i) => resolveKey(c1, cultureKey(c0, i))?.id ?? -2);
    const po = c0.polities.map((_, i) => resolveKey(c1, polityKey(c0, i))?.id ?? -2);
    const a = ownersAt(c0, year);
    const a0 = { culture: a.culture.slice(), polity: a.polity.slice() };
    const b = ownersAt(c1, year);
    const same = (x: number, y: number, map: number[]) => (x < 0 ? y < 0 : map[x] === y);
    let n = 0;
    let c = 0;
    let p = 0;
    for (let i = 0; i < k.w0.mesh.n; i++) {
      const r0 = c0.regions.of[i];
      const r1 = c1.regions.of[i];
      if (r0 < 0 || r1 < 0 || !far(i)) continue;
      n++;
      if (same(a0.culture[r0], b.culture[r1], cu)) c++;
      if (same(a0.polity[r0], b.polity[r1], po)) p++;
    }
    return { culture: c / n, polity: p / n };
  }

  it('挖一个湖(州数变了、州号错开):远处陆地到第 3000 年民族没变 ≥ 64%、国家没变 ≥ 44%', () => {
    const k = edited(seed, 'lake');
    expect(k.c1.regions.count, '州数变了(州号错开)').not.toBe(k.c0.regions.count);
    const r = kept(k, k.c0.endYear);
    // GENERATOR_VERSION 10(邦交:盟国援战、宗主救藩,远处的国家也会卷进来)以后 seed 7 的民族没变 79.9%(以前 80.3%),下限放宽到 78%
    // GENERATOR_VERSION 20(饥荒、民变、大崩解:一处的变故波及更远)以后种子 1、2、3、7、2024 的民族 / 国家没变 75–98% / 75–98%
    // (2024 号 75% / 75%,以前 80% / 87%;7 号 88% / 92%,以前 86% / 82%):下限放到 74% / 72%
    // GENERATOR_VERSION 22(称霸大陆的大国盛极而衰,崩了又被重新统一)以后 2024 号的国家没变 71.7%:国家的下限放到 70%
    // GENERATOR_VERSION 39(立约与中立地:约国之间不打、中立地那州归属空出来,一处改了远处的约也跟着变)以后 2024 号的国家没变 69.6%:
    // 民族、国家的下限放到 73% / 69%
    // GENERATOR_VERSION 43(议和了还会再打、看邻国更勤:一处改了,远处的冤家什么时候再打也跟着变)以后 7 号、2024 号的国家没变 67.2% / 63.9%:
    // 国家的下限放到 62%
    // GENERATOR_VERSION 46(大迁徙:一族分出一支走十几州、在远处落脚立国,一处改了,哪一族什么时候走、落在哪、打进哪国也跟着变)以后
    // 7 号、2024 号的民族没变 78.9% / 67.5%,国家没变 65.8% / 60.7%:民族、国家的下限放到 64% / 57%
    // GENERATOR_VERSION 47(季节进推演:冬天顿兵、春荒,一仗挪几个月,远处的仗跟着错开)以后 7 号、2024 号的国家没变 50.7% / 62.5%;
    // 种子 1–20 挖同样的湖,国家没变 44.1%–90.8%(改前 47.3%–79.4%,整体差不多):国家的下限按 20 个种子的最小值放到 44%
    expect(r.culture, `seed ${seed} 民族`).toBeGreaterThanOrEqual(0.64);
    expect(r.polity, `seed ${seed} 国家`).toBeGreaterThanOrEqual(0.44);
  }, 60_000);

  it('海里放一座小火山:远处的地形不变(99% 以上);远处陆地到第 3000 年民族没变 ≥ 85%、国家没变 ≥ 41%;远处海、山、河的名字没变 ≥ 80%', () => {
    const k = edited(seed, 'volcano');
    // 地形里的随机小洼地按地块取(world.ts):远处的海陆、群落和不放火山时一样,海拔只差风带里水汽的一点点(< 1 米)
    const far = farFrom(k);
    let farLand = 0;
    let moved = 0;
    for (let i = 0; i < k.w0.mesh.n; i++) {
      if (!far(i) || k.w0.water[i] !== 0) continue;
      farLand++;
      if (k.w1.water[i] !== 0 || k.w1.biome[i] !== k.w0.biome[i] || Math.abs(k.w1.elevation[i] - k.w0.elevation[i]) >= 1) moved++;
    }
    expect(farLand).toBeGreaterThan(5000);
    expect(moved / farLand, `seed ${seed} 远处地形变了的陆地块`).toBeLessThan(0.01);
    const r = kept(k, k.c0.endYear);
    // GENERATOR_VERSION 49(时代做法:议事的先后跟着国都的能力走,一处改了远处的议事、割据也跟着错开)以后 7 号的国家没变 67.5%(以前 88.1%);
    // 种子 1–20 放同样的火山,国家没变 41.8%–100%(改前 41.3%–100%,整体差不多):国家的下限按 20 个种子的最小值放到 41%
    expect(r.culture, `seed ${seed} 民族`).toBeGreaterThanOrEqual(0.85);
    expect(r.polity, `seed ${seed} 国家`).toBeGreaterThanOrEqual(0.41);
    const shr = k.c0.places.filter((p) => far(p.cell!) && (p.kind === 'sea' || p.kind === 'mountains' || p.kind === 'river'));
    expect(ratio(shr.map((p) => counterpart(k, p)?.name === p.name)), `seed ${seed} 海山河`).toBeGreaterThanOrEqual(0.8);
  }, 60_000);
});

describe('稳定键按地块定位', () => {
  it.each(['volcano', 'lake'] as const)('%s:州、城、国家的键指回同一块地方,或者找不到;旧 r 格式按州号解析(改地形后多半指到别处)', (kind) => {
    const k = edited(7, kind);
    const { c0, c1 } = k;
    const seat0 = c0.regions.seat;
    const seat1 = c1.regions.seat;
    const of1 = c1.regions.of;
    // 州:指"现在包含治所那块地的州";大多数州的治所没变,就是同一州
    let sameNew = 0;
    let sameOld = 0;
    for (let r = 0; r < c0.regions.count; r++) {
      const a = resolveKey(c1, regionKey(c0, r));
      if (of1[seat0[r]] < 0) expect(a).toBeNull();
      else expect(a).toEqual({ kind: 'region', id: of1[seat0[r]] });
      if (a && seat1[a.id] === seat0[r]) sameNew++;
      const b = resolveKey(c1, `region:r${r}`);
      if (b && seat1[b.id] === seat0[r]) sameOld++;
    }
    expect(sameNew / c0.regions.count, '新键指回同一治所的州').toBeGreaterThan(0.9);
    // GENERATOR_VERSION 26 起改过地形的世界远处照没改地形的同一颗星球换算海拔,放一座小火山只动了附近:
    // 新冒出来的州排在中间,它前面的旧 r 格式还指得对(7 号小火山 488 / 896),新键仍然好得多
    expect(sameNew).toBeGreaterThan(sameOld * 1.5);
    // 城:找不到,或者是现在包含那块地的州里的城;大多数就是同一地块上的城
    let cityHere = 0;
    for (const s of c0.settlements) {
      const a = resolveKey(c1, settlementKey(c0, s.id));
      if (!a) continue;
      expect(a.kind).toBe('settlement');
      expect(c1.settlements[a.id].region).toBe(of1[s.cell]);
      if (c1.settlements[a.id].cell === s.cell) cityHere++;
    }
    expect(cityHere / c0.settlements.length, '新键指回同一地块的城').toBeGreaterThan(0.85);
    // 国家:找不到(那里没有立过第几个国),或者是立国时国都在那块地所在州的国家
    for (const p of c0.polities) {
      const a = resolveKey(c1, polityKey(c0, p.id));
      if (!a) continue;
      const q = c1.polities[a.id];
      expect(c1.settlements[q.capital].region).toBe(of1[c0.settlements[p.capital].cell]);
    }
  }, 60_000);

  it('改名按新键套上:改地形以后改过名的城、州还在原地;那块地方成了水就找不到(改名先留着,不套到别处)', () => {
    const k = edited(7, 'volcano');
    const { c0, c1 } = k;
    const far = farFrom(k);
    const s = c0.settlements.find((x) => far(x.cell) && resolveKey(c1, settlementKey(c0, x.id)))!;
    const r = c0.regions.seat.findIndex((cell, i) => far(cell) && i > 100 && c1.regions.of[cell] >= 0);
    const named = applyNames(c1, { [settlementKey(c0, s.id)]: '饕餮城', [regionKey(c0, r)]: '九嶷州' });
    const t = named.settlements.find((x) => x.name === '饕餮城')!;
    expect(t.cell).toBe(s.cell);
    const r1 = c1.regions.of[c0.regions.seat[r]];
    expect(named.regionNames?.[r1]).toBe('九嶷州');
    // 在治所上挖个湖:这州的键找不到了
    const w0 = k.w0;
    const seat = c0.regions.seat[r];
    const lake: TerrainOp = { kind: 'lake', pts: [Math.round(w0.mesh.x[seat]), Math.round(w0.mesh.y[seat])], r: 10, s: 0.7 };
    const w2 = generateWorld({ ...DEFAULT_PARAMS, seed: 7 }, undefined, [lake]);
    expect(w2.water[seat], '治所成了湖').not.toBe(0);
    const c2 = generateCiv(w2);
    expect(resolveKey(c2, regionKey(c0, r))).toBeNull();
    expect(applyNames(c2, { [regionKey(c0, r)]: '九嶷州' })).toBe(c2);
  }, 60_000);

  it('干预用新键:改地形以后照样生效(同一处立的国);指不到的标"未生效"', () => {
    const k = edited(7, 'lake');
    const { c0, c1, w1 } = k;
    const far = farFrom(k);
    // 一个改地形前后都在同一处立国、干预那年还在的国家:不许灭
    const Y = 1500;
    const p = c0.polities.find((x) => {
      const a = resolveKey(c1, polityKey(c0, x.id));
      if (!a || !far(c0.settlements[x.capital].cell)) return false;
      const q = c1.polities[a.id];
      return q.founded < Y && (q.ended ?? Infinity) > Y;
    })!;
    expect(p, '找得到改地形前后都在的国家').toBeTruthy();
    const key = polityKey(c0, p.id);
    const ok: Intervention = { kind: 'protect', a: key, from: Y };
    // 指不到的国家(那块地方没立过第 9 个国)、成了水的州
    const lost: Intervention = { kind: 'unity', a: key.replace(/#\d+$/, '#9'), from: Y };
    const sea = c1.regions.of.findIndex((r) => r < 0);
    const nowhere: Intervention = { kind: 'found', region: `region:c${sea}`, from: Y };
    const c = generateCiv(w1, { interventions: [ok, lost, nowhere] });
    const id = resolveKey(c, key)!.id;
    expect(interventionOutcome(c, 0)).toMatchObject({ ok: true });
    expect(c.annals[interventionOutcome(c, 0).annal].a).toBe(id);
    expect(c.polities[id].ended, '不许灭:到最后还在').toBeUndefined();
    expect(interventionOutcome(c, 1).ok).toBe(false);
    expect(interventionOutcome(c, 2)).toMatchObject({ ok: false, why: expect.stringMatching(/没有这个州/) });
  }, 120_000);
});
