/**
 * 「存下的世界」读出来是什么样:tests/saved-world-stable.test.ts 拿它和基准比,scripts/saved-worlds.ts 拿它写基准。
 *
 * 存下的数据是胶片,读它的代码是放映机。样本(tests/fixtures/saved-worlds/)是打包好的世界,字节和网站存世界用的一样
 * (src/gen/snapshot.ts);这里只读样本,用读取代码算出看得到的结果,**一律不重新生成世界**。
 * 所以生成算法升级时样本不用动,要看住的只是放映机有没有变。
 *
 * 读取代码按样本记的版本取(src/gen/readers/):算法改了、旧代码留了存底以后,老样本走存底,照样要读出原来的结果。
 * 比什么、不比什么,见 tests/saved-world-stable.test.ts 的文件头。
 *
 * 基准只存摘要和少量抽样:一项一个 SHA-256 判定变没变,再分段各存一小截摘要(找从哪开始不一样)、抽十几个值(看差多少)。
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ChronicleEntry } from '../../src/gen/civ/story/chronicle';
import { flagBook } from '../../src/gen/civ/story/flags';
import { fullChronicle } from '../../src/gen/civ/story/religionText';
import type { Civ, Polity } from '../../src/gen/civ/types';
import type { Upheaval } from '../../src/gen/edits';
import type { Raster } from '../../src/gen/raster';
import type { ZoomSource } from '../../src/gen/rasterWindow';
import { readersFor, type QueryReader, type ReaderVersions } from '../../src/gen/readers';
import { readPart, type SnapshotPart } from '../../src/gen/snapshot';
import type { World } from '../../src/gen/world';
import { civAtEra, eraIndex } from '../../src/ui/eras';

export const FIXTURE_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'saved-worlds');
export const SAMPLES_FILE = join(FIXTURE_DIR, 'samples.json');
/** 除编年史以外各项的基准 */
export const BASELINE_FILE = join(FIXTURE_DIR, 'baseline.json');
/** 编年史的基准(单独一个文件:只有它可以随写法更新) */
export const CHRONICLE_FILE = join(FIXTURE_DIR, 'chronicle.json');

/** 放大时要比的一块:S 倍主图上左上角在 (x0, y0) 的 256 × 256 块(和网页按屏幕要的块一样) */
export interface WindowSpec {
  name: string;
  S: number;
  x0: number;
  y0: number;
}

/** 样本清单(samples.json 里的一项) */
export interface SampleInfo {
  name: string;
  title: string;
  seed: number;
  cells: number;
  endYear: number;
  /** 存下时的生成器版本。只是记一笔:测试不比它,生成器升级了样本也不用动 */
  generator: number;
  /** 这个样本要用第几版读取代码 */
  readers: ReaderVersions;
  upheavals: Upheaval[];
  /** 比人口、归属、信仰的那几年 */
  years: number[];
  windows: WindowSpec[];
  parts: { name: string; bytes: number; sum: string; zip: string; file: string }[];
}

export const readSamples = (): SampleInfo[] => JSON.parse(readFileSync(SAMPLES_FILE, 'utf8')) as SampleInfo[];

// ---------------------------------------------------------------------------
// 打开样本

export interface OpenedWorld {
  world: World;
  /** 地形大事以后的各段世界(按先后),和网站打开时一样接上原来的网格 */
  eras: World[];
  civ: Civ;
}

/** 按网站打开存下的世界的办法读样本:各块解压、核校验、还原,各段世界接上原来的网格 */
export async function openSample(s: SampleInfo): Promise<OpenedWorld> {
  const part = (name: string): Promise<unknown> => {
    const p = s.parts.find((x) => x.name === name);
    if (!p) throw new Error(`样本 ${s.name} 缺 ${name} 那一块`);
    const b = readFileSync(join(FIXTURE_DIR, p.file));
    const data = b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
    return readPart({ name: p.name, bytes: p.bytes, sum: p.sum, zip: p.zip, data } as SnapshotPart);
  };
  const world = (await part('map')) as World;
  const e = (await part('eras')) as { eras: { world: World }[] };
  const civ = (await part('civ')) as Civ;
  return { world, eras: e.eras.map((x) => ({ ...x.world, mesh: world.mesh })), civ };
}

// ---------------------------------------------------------------------------
// 一项结果的摘要

type Numbers = Float32Array | Float64Array | Int8Array | Uint8Array | Int16Array | Int32Array;

/** 基准里的一项 */
export interface Digest {
  type: string;
  n: number;
  sha256: string;
  /** 分段的摘要(各取前 8 位) */
  bands: string[];
  /** 抽样:[下标, 值] */
  picks: [number, number][];
}

const sha = (b: Uint8Array): string => createHash('sha256').update(b).digest('hex');
const bytesOf = (a: Numbers): Uint8Array => new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
const PICKS = 16;

function digestOf(data: Numbers, starts: readonly number[]): Digest {
  const n = data.length;
  const picks: [number, number][] = [];
  for (let k = 0; k < PICKS && n; k++) {
    const i = Math.floor(((k + 0.5) * n) / PICKS);
    picks.push([i, data[i]]);
  }
  return {
    type: data.constructor.name,
    n,
    sha256: sha(bytesOf(data)),
    bands: starts.map((from, k) => sha(bytesOf(data.subarray(from, starts[k + 1] ?? n))).slice(0, 8)),
    picks,
  };
}

/** 要比的几组(失败时按组报) */
export const GROUPS = [
  { id: 'raster', title: '铺全图像素' },
  { id: 'zoom', title: '放大时的分块' },
  { id: 'people', title: '人口和城市等级' },
  { id: 'owners', title: '某年的归属和信仰' },
  { id: 'facts', title: '某年的史实' },
  { id: 'flags', title: '国旗' },
] as const;
export type GroupId = (typeof GROUPS)[number]['id'];

/** 读出来的一项 */
export interface ReadItem {
  id: string;
  group: GroupId;
  label: string;
  digest: Digest;
  /** 分段的起点(下标);和 digest.bands 一一对应 */
  starts: number[];
  /** 第 i 个数在世界的哪里(给人看) */
  where: (i: number) => string;
}

/** 整张主图分多少段记摘要 */
const RASTER_BANDS = 64;
/** 放大的一块分多少段记摘要 */
const WINDOW_BANDS = 8;

function pixelItems(group: GroupId, prefix: string, title: string, r: Raster, fields: readonly (readonly [keyof Raster, string])[], bands: number, unit: string): ReadItem[] {
  const starts = Array.from({ length: bands }, (_, k) => Math.floor((k * r.h) / bands) * r.w);
  const where = (i: number) => `${unit}第 ${Math.floor(i / r.w)} 行第 ${i % r.w} 列`;
  return fields.map(([f, name]) => {
    // 河口的颜色系数只有带河口的块才有:没有就是空的,也要比(本来没有的长出来了也算变了)
    const data = (r[f] as Numbers | undefined) ?? (RIVER_MOUTH_FIELDS.has(f) ? new Uint8Array(0) : undefined);
    if (!data) throw new Error(`读不出 ${title}${name}`);
    return { id: `${prefix}.${String(f)}`, group, label: `${title}${name}`, digest: digestOf(data, starts), starts, where };
  });
}

const RIVER_MOUTH_FIELDS: ReadonlySet<keyof Raster> = new Set<keyof Raster>(['plume', 'rivTint', 'rivCore']);
/** 整张主图和放大的块都有的 */
const SHARED_FIELDS = [
  ['temp', '气温'],
  ['precip', '降水'],
  ['ice', '海冰'],
  ['iceConc', '海冰的浓度'],
  ['iceTone', '浮冰的色调'],
  ['wet', '湿地'],
  ['bank', '河边'],
  ['vein', '细沟'],
] as const;
const WHOLE_FIELDS = [
  ['water', '水陆'],
  ['biome', '地貌'],
  ['elev', '海拔'],
  ['gully', '沟壑'],
  ...SHARED_FIELDS,
  ['cell', '每个像素归哪个地块'],
] as const;
const WINDOW_FIELDS = [
  ['water', '水陆'],
  ['biome', '地貌'],
  ['elev', '海拔(沟壑已算在里面)'],
  ...SHARED_FIELDS,
  ['plume', '河口外的浑水'],
  ['rivTint', '河口的河水颜色'],
  ['rivCore', '河口的河道'],
] as const;

/** 不是按地块、年份排的一串数(河道、细沟的线):等分成几段记摘要 */
const ARRAY_BANDS = 16;

function arrayItem(id: string, group: GroupId, label: string, data: Numbers): ReadItem {
  const starts = Array.from({ length: ARRAY_BANDS }, (_, k) => Math.floor((k * data.length) / ARRAY_BANDS));
  return { id, group, label, digest: digestOf(data, starts), starts, where: (i) => `第 ${i} 个数` };
}

/** 一份结构(数组、对象)里的数按固定的次序排成一串;空的记 NaN,有没有这一项也算在内 */
function flatNumbers(v: unknown, out: number[] = []): number[] {
  if (typeof v === 'number') out.push(v);
  else if (typeof v === 'boolean') out.push(v ? 1 : 0);
  else if (v === null || v === undefined) out.push(NaN);
  else if (Array.isArray(v) || ArrayBuffer.isView(v)) for (const x of v as unknown as Iterable<unknown>) flatNumbers(x, out);
  else if (typeof v === 'object') for (const k of Object.keys(v).sort()) flatNumbers((v as Record<string, unknown>)[k], out);
  else throw new Error(`不是数:${String(v)}`);
  return out;
}

/**
 * 放大现算要用的线:河和小溪的河道(刻谷用)、河口、细沟。
 * 河道和河口按单精度比:算河宽用了非整数幂,双精度的最后一位在不同的操作系统上不一样;铺成像素时都是单精度,结果逐位一样
 */
function lineItems(prefix: string, title: string, src: ZoomSource): ReadItem[] {
  const beds = src.lines.map(({ x, y, w, f, mouth }) => ({ x, y, w, f, mouth }));
  const v = src.veins;
  return [
    arrayItem(`${prefix}lines.valley`, 'zoom', `${title}河和小溪的河道`, Float32Array.from(flatNumbers(beds))),
    arrayItem(`${prefix}lines.mouths`, 'zoom', `${title}河口`, Float32Array.from(flatNumbers(src.mouths))),
    arrayItem(`${prefix}lines.veinOff`, 'zoom', `${title}细沟的线(每条的起点)`, v.off),
    arrayItem(`${prefix}lines.veinX`, 'zoom', `${title}细沟的线(x)`, v.x),
    arrayItem(`${prefix}lines.veinY`, 'zoom', `${title}细沟的线(y)`, v.y),
    arrayItem(`${prefix}lines.veinA`, 'zoom', `${title}细沟的线(集水面积)`, v.a),
  ];
}

/** 把逐年的结果接成一个数组:lens[k] = 第 k 年有多少个数 */
function yearlyItem(id: string, group: GroupId, label: string, data: Numbers, years: readonly number[], lens: readonly number[], noun: string): ReadItem {
  const starts: number[] = [];
  let at = 0;
  for (const n of lens) {
    starts.push(at);
    at += n;
  }
  const where = (i: number) => {
    let k = years.length - 1;
    while (k > 0 && starts[k] > i) k--;
    return `第 ${years[k]} 年第 ${i - starts[k]} ${noun}`;
  };
  return { id, group, label, digest: digestOf(data, starts), starts, where };
}

function peopleItems(civ: Civ, years: readonly number[], q: QueryReader): ReadItem[] {
  const shown = years.map((y) => civAtEra(civ, eraIndex(civ, y)));
  const S = civ.settlements;
  const city = new Float64Array(years.length * S.length);
  const rank = new Int8Array(city.length);
  const stateLens = shown.map((c) => c.regions.count);
  const states = new Float64Array(stateLens.reduce((a, b) => a + b, 0));
  let o = 0;
  years.forEach((y, k) => {
    S.forEach((s, i) => {
      const pop = q.populationAt(s, y);
      city[k * S.length + i] = pop;
      rank[k * S.length + i] = q.settlementRank(pop);
    });
    for (let r = 0; r < stateLens[k]; r++) states[o++] = q.regionPopulationAt(shown[k], r, y);
  });
  const cityLens = years.map(() => S.length);
  return [
    yearlyItem('people.city', 'people', '城市人口', city, years, cityLens, '座城'),
    yearlyItem('people.rank', 'people', '城市等级', rank, years, cityLens, '座城'),
    yearlyItem('people.state', 'people', '州人口', states, years, stateLens, '个州'),
  ];
}

function ownerItems(civ: Civ, years: readonly number[], q: QueryReader): ReadItem[] {
  const shown = years.map((y) => civAtEra(civ, eraIndex(civ, y)));
  const lens = shown.map((c) => c.regions.count);
  const total = lens.reduce((a, b) => a + b, 0);
  const polity = new Int16Array(total);
  const culture = new Int16Array(total);
  const faith = new Int16Array(total);
  let o = 0;
  years.forEach((y, k) => {
    const own = q.ownersAt(shown[k], y);
    polity.set(own.polity, o);
    culture.set(own.culture, o);
    faith.set(q.faithAt(shown[k], y), o);
    o += lens[k];
  });
  return [
    yearlyItem('owners.polity', 'owners', '各州归属的国家', polity, years, lens, '个州'),
    yearlyItem('owners.culture', 'owners', '各州的主体民族', culture, years, lens, '个州'),
    yearlyItem('owners.faith', 'owners', '各州的信仰', faith, years, lens, '个州'),
  ];
}

/** 名字变成一个数,好和别的项一样比 */
function nameCode(name: string): number {
  return Buffer.from(createHash('sha256').update(name).digest()).readInt32LE(0);
}

/** 某年的史实:每个国家的国都、国号、存亡、君主,每座城是不是港口、是不是遗址,各州的开发度、物产、实控、思潮 */
function factItems(civ: Civ, years: readonly number[], q: QueryReader): ReadItem[] {
  const P = civ.polities;
  const S = civ.settlements;
  const polityLens = years.map(() => P.length);
  const cityLens = years.map(() => S.length);
  const eachPolity = (f: (p: Polity, y: number) => number) => Int32Array.from(years.flatMap((y) => P.map((p) => f(p, y))));
  const eachRegion = (id: string, label: string, at: (c: Civ, y: number) => ArrayLike<number> | null) => {
    const parts = years.map((y) => Float32Array.from(at(civAtEra(civ, eraIndex(civ, y)), y) ?? []));
    const all = new Float32Array(parts.reduce((n, a) => n + a.length, 0));
    let o = 0;
    for (const a of parts) {
      all.set(a, o);
      o += a.length;
    }
    return yearlyItem(id, 'facts', label, all, years, parts.map((a) => a.length), '个数');
  };
  const ruins = Int8Array.from(
    years.flatMap((y) => {
      const rank = new Map(q.ruinSites(civ, y).map((s) => [s.id, q.ruinRank(s) + 1]));
      return S.map((s) => rank.get(s.id) ?? 0);
    }),
  );
  return [
    yearlyItem('facts.capital', 'facts', '国都', eachPolity((p, y) => q.capitalAt(p, y)), years, polityLens, '个国家'),
    yearlyItem('facts.name', 'facts', '国号(名字的散列)', eachPolity((p, y) => nameCode(q.polityName(p, y))), years, polityLens, '个国家'),
    yearlyItem('facts.tier', 'facts', '国号的档位', eachPolity((p, y) => q.polityTierAt(p, y)), years, polityLens, '个国家'),
    yearlyItem('facts.alive', 'facts', '国家在不在', eachPolity((p, y) => (q.polityAlive(p, y) ? 1 : 0)), years, polityLens, '个国家'),
    yearlyItem('facts.ruler', 'facts', '在位的君主', eachPolity((p, y) => q.rulerAt(civ, p.id, y)?.id ?? -1), years, polityLens, '个国家'),
    yearlyItem('facts.port', 'facts', '是不是港口', Int8Array.from(years.flatMap((y) => S.map((s) => (q.portAt(s, y) ? 1 : 0)))), years, cityLens, '座城'),
    yearlyItem('facts.ruin', 'facts', '遗址(0 = 不是遗址)', ruins, years, cityLens, '座城'),
    eachRegion('facts.development', '各州的开发度', (c, y) => (c.development ? q.developmentAt(c.development, y) : null)),
    eachRegion('facts.resources', '各州的物产', (c, y) => (c.development ? q.resourcesAt(c.development, y) : null)),
    eachRegion('facts.control', '各州的实控', (c, y) => q.controlAt(c, y)),
    eachRegion('facts.ideology', '各州的思潮', (c, y) => (c.ideology ? q.ideologyAt(c.ideology, y) : null)),
  ];
}

/**
 * 国旗:每个国家历代的旗,和界面上一样按第一件地形大事以前的地形配。
 * 只比旗本身(从哪年起、第几朝、什么样);why 是旗帜详情里讲意思用的,属于解说,不比
 */
function flagItem(world: World, civ: Civ): ReadItem {
  const enc = new TextEncoder();
  const each = flagBook(world, civAtEra(civ, 0)).eras.map((list) => enc.encode(canon(list.map(({ year, dyn, key, spec, how }) => ({ year, dyn, key, spec, how })))));
  const data = new Uint8Array(each.reduce((n, a) => n + a.length, 0));
  const starts: number[] = [];
  let o = 0;
  for (const a of each) {
    starts.push(o);
    data.set(a, o);
    o += a.length;
  }
  const where = (i: number) => {
    let k = starts.length - 1;
    while (k > 0 && starts[k] > i) k--;
    return `第 ${k} 个国家的旗`;
  };
  return { id: 'flags.book', group: 'flags', label: '国旗', digest: digestOf(data, starts), starts, where };
}

// ---------------------------------------------------------------------------
// 编年史

/** 编年史的基准:整份的摘要、每条的一小截摘要、抽几条原文 */
export interface ChronicleDigest {
  sha256: string;
  n: number;
  entries: string[];
  picks: { i: number; year: number; text: string }[];
}

/** 规范成字符串:键按名字排(只换了字段先后不算变) */
function canon(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canon).join(',')}]`;
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    const keys = Object.keys(o)
      .filter((k) => o[k] !== undefined)
      .sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canon(o[k])}`).join(',')}}`;
  }
  return JSON.stringify(v);
}

const CHRONICLE_PICKS = 12;

function chronicleDigest(list: readonly ChronicleEntry[]): ChronicleDigest {
  const text = list.map(canon);
  const n = list.length;
  const at = new Set<number>();
  for (let k = 0; k < CHRONICLE_PICKS && n; k++) at.add(Math.floor(((k + 0.5) * n) / CHRONICLE_PICKS));
  return {
    sha256: sha(new TextEncoder().encode(text.join('\n'))),
    n,
    entries: text.map((t) => sha(new TextEncoder().encode(t)).slice(0, 8)),
    picks: [...at].map((i) => ({ i, year: list[i].year, text: list[i].text })),
  };
}

/** 现在的编年史和基准哪里不一样(一样 = null) */
export function chronicleChange(base: ChronicleDigest, now: readonly ChronicleEntry[]): string | null {
  const d = chronicleDigest(now);
  if (d.sha256 === base.sha256) return null;
  const n = Math.min(base.entries.length, d.entries.length);
  let first = 0;
  while (first < n && base.entries[first] === d.entries[first]) first++;
  const had = new Map<string, number>();
  for (const e of base.entries) had.set(e, (had.get(e) ?? 0) + 1);
  let same = 0;
  for (const e of d.entries) {
    const k = had.get(e) ?? 0;
    if (k) {
      same++;
      had.set(e, k - 1);
    }
  }
  const lines = [`基准 ${base.n} 条,现在 ${d.n} 条,一字不差的 ${same} 条。从第 ${first} 条开始不一样。`];
  if (first < now.length) lines.push(`现在的第 ${first} 条(第 ${Math.floor(now[first].year)} 年):${now[first].text}`);
  const pick = base.picks.find((p) => p.i >= first);
  if (pick) lines.push(`基准抽样的第 ${pick.i} 条(第 ${Math.floor(pick.year)} 年):${pick.text}`);
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// 读一个样本

export interface SampleReading {
  items: ReadItem[];
  chronicle: readonly ChronicleEntry[];
  chronicleDigest: ChronicleDigest;
}

/** 用样本记的那一版读取代码把样本读一遍:每一项的摘要和编年史。不重新生成世界 */
export async function readSample(s: SampleInfo): Promise<SampleReading> {
  const { terrain, query } = await readersFor(s.readers);
  const { world, eras, civ } = await openSample(s);
  // 铺全图最费时间。带地形大事的样本只铺最后一段:原来那段的读法普通样本已经比了,这个种子的地形也只差大事附近那一块
  const k = eras.length;
  const w = k ? eras[k - 1] : world;
  const prefix = k ? `era${k}.` : '';
  const title = k ? '地形大事以后的' : '';
  const whole = terrain.rasterize(w, 1);
  const items = pixelItems('raster', `${prefix}whole`, title, whole, WHOLE_FIELDS, RASTER_BANDS, '');
  if (k) {
    // 地形大事以后界面上看到的主图,是原来的主图贴上变了的那一块(框外小到看不出来的差别沿用原来的)
    let shown = terrain.rasterize(world, 1);
    eras.forEach((e, i) => {
      const patch = terrain.diffRaster(shown, i === k - 1 ? whole : terrain.rasterize(e, 1));
      if (patch) shown = terrain.composeRaster(shown, [patch]);
    });
    items.push(...pixelItems('raster', `${prefix}shown`, '地形大事以后拼出来的', shown, WHOLE_FIELDS, RASTER_BANDS, ''));
  }
  const src = terrain.zoomSource(w, whole);
  items.push(...lineItems(prefix, title, src));
  for (const win of s.windows) {
    const n = 256 + 2 * terrain.WINDOW_PAD;
    const r = terrain.rasterizeWindow(src, win.S, win.x0 - terrain.WINDOW_PAD, win.y0 - terrain.WINDOW_PAD, n, n);
    items.push(...pixelItems('zoom', `${prefix}zoom.${win.name}`, `${title}放大 ${win.S} 倍「${win.name}」那一块的`, r, WINDOW_FIELDS, WINDOW_BANDS, '这一块'));
  }
  items.push(...peopleItems(civ, s.years, query), ...ownerItems(civ, s.years, query), ...factItems(civ, s.years, query), flagItem(world, civ));
  const chronicle = fullChronicle(civ);
  return { items, chronicle, chronicleDigest: chronicleDigest(chronicle) };
}

/** 这一项和基准哪里不一样(一样 = null) */
export function itemChange(base: Digest, it: ReadItem): string | null {
  const now = it.digest;
  if (base.sha256 === now.sha256) return null;
  if (base.type !== now.type || base.n !== now.n) return `${it.label}:基准是 ${base.n} 个 ${base.type},现在是 ${now.n} 个 ${now.type}`;
  const changed = base.bands.flatMap((b, k) => (b === now.bands[k] ? [] : [k]));
  const from = changed.length ? `从「${it.where(it.starts[changed[0]])}」所在的那一段开始不一样,${base.bands.length} 段里变了 ${changed.length} 段` : '分段摘要都一样(变得极少)';
  const moved = base.picks.flatMap(([i, v], k) => (v === now.picks[k][1] ? [] : [{ i, was: v, is: now.picks[k][1] }]));
  const eg = moved.length ? `抽样 ${base.picks.length} 处变了 ${moved.length} 处,比如${it.where(moved[0].i)}:基准 ${moved[0].was},现在 ${moved[0].is}` : `抽样 ${base.picks.length} 处都没变`;
  return `${it.label}:${from};${eg}`;
}
