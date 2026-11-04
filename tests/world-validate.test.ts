/**
 * 校验器:真实世界全过(误伤好世界比漏掉坏文件更糟);每条规则各造一个坏值,都要拦下;乱改内容不卡死,错都接得住。
 * 大世界(20 万地块、6 万年)生成太久,不进单测,由测量脚本跑校验器。
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { generateCiv } from '../src/gen/civ';
import { chronicleBlock } from '../src/gen/civ/story/nameTokens';
import { flagBook } from '../src/gen/civ/story/flags';
import { encodeFlag } from '../src/gen/civ/story/flagSpec';
import type { Civ } from '../src/gen/civ/types';
import { packValue, readPart, unpackValue, type SnapshotPart } from '../src/gen/snapshot';
import { mulberry32 } from '../src/gen/util';
import { DEFAULT_PARAMS, generateWorld, type World } from '../src/gen/world';
import type { PackInput, WorldEras } from '../src/gen/worldFile';
import { WorldFileError } from '../src/gen/worldFormat';
import { validateAuthor, validateChronicle, validateCiv, validateEras, validateFlags, validateThumb, validateWorld } from '../src/gen/worldValidate';
import { FIXTURE_DIR, readSamples } from './lib/savedWorlds';
import { makeSample, tinyJpeg } from './lib/worldFileSample';

/* eslint-disable @typescript-eslint/no-explicit-any */

let sample: PackInput & { eras: WorldEras };
let map: World;
let civ: Civ;

beforeAll(() => {
  sample = makeSample();
  map = { ...sample.map, history: [] };
  civ = sample.civ;
}, 120_000);

function expectBroken(run: () => void, label: string) {
  let err: unknown;
  try {
    run();
  } catch (e) {
    err = e;
  }
  if (!err) throw new Error(`这个坏值没拦下:${label}`);
  expect(err, `${label}:${String(err)}`).toBeInstanceOf(WorldFileError);
  expect((err as WorldFileError).kind, label).toBe('broken');
}

describe('真实世界全过', () => {
  it('带一件地形大事的小世界:各块都过', () => {
    validateWorld(map);
    validateEras(sample.eras, map);
    validateCiv(civ, map);
    validateChronicle(sample.chronicle, civ);
    validateFlags(sample.flags, civ);
    validateAuthor(sample.author);
    validateThumb(sample.thumb!);
  });

  // 这几种世界里有比结束那年还晚的年份(还没诞生的民族、到期要废的路),是好世界,不许拦
  it.each([
    ['很短的历史', { endYear: 100 }],
    ['只推了一年', { endYear: 1 }],
    ['年中停下', { endYear: 250.5 }],
    ['天灾很多', { calamity: 'many' as const }],
  ])('%s', (_, p) => {
    const world = generateWorld({ ...DEFAULT_PARAMS, seed: 5, cells: 2000 });
    const history = generateCiv(world, p);
    const m = { ...world, history: [] };
    validateWorld(m);
    validateCiv(history, m);
    validateChronicle(chronicleBlock(history), history);
    validateFlags(flagBook(world, history), history);
  }, 60_000);

  it('冻成冰的星球(没有文明):也是好世界', () => {
    const world = generateWorld({ ...DEFAULT_PARAMS, seed: 7, cells: 2000, temperature: -40 });
    const history = generateCiv(world);
    expect(history.viable).toBe(false);
    const m = { ...world, history: [] };
    validateWorld(m);
    validateCiv(history, m);
    validateChronicle(chronicleBlock(history), history);
    validateFlags(flagBook(world, history), history);
  }, 60_000);

  it('地形大事以前那几段的关隘:stands 记的是推演中途的下标,可以比史事的条数大,不能拦', () => {
    const c = structuredClone(civ) as any;
    c.eras[0].places.push({ kind: 'pass', name: '尼塞斯山口', culture: -1, path: new Float32Array(2), rank: 1, pass: { height: 1, ridge: 1, regions: [0, 1], stands: [c.annals.length + 100], named: false, since: 1 } });
    const pass = c.eras[0].places.at(-1).pass;
    validateCiv(c, map);
    pass.stands = ['x'];
    expectBroken(() => validateCiv(c, map), 'stands 不是整数');
    pass.stands = [];
    pass.regions = [1e7];
    expectBroken(() => validateCiv(c, map), '关隘两边的州越界');
  });

  it('最小的世界:参数 2000 实际不到 2000 块,不能拦', () => {
    expect(map.mesh.n).toBeLessThan(2000);
    validateWorld(map);
  });

  it.each(readSamples())('仓库里的样本世界:$title', async (s) => {
    const part = (name: string): Promise<unknown> => {
      const p = s.parts.find((x) => x.name === name)!;
      const b = readFileSync(join(FIXTURE_DIR, p.file));
      const data = b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
      return readPart({ name: p.name, bytes: p.bytes, sum: p.sum, zip: p.zip, data } as SnapshotPart);
    };
    const world = (await part('map')) as World;
    const eras = (await part('eras')) as WorldEras;
    const history = (await part('civ')) as Civ;
    validateWorld(world);
    validateEras(eras, world);
    validateCiv(history, world);
    validateChronicle(chronicleBlock(history), history);
    validateFlags(flagBook(world, history), history);
  }, 60_000);
});

describe('每条规则:地图', () => {
  const CASES: [string, (w: any) => void][] = [
    ['不是对象', (w) => (w.mesh = 1)],
    ['地块太少', (w) => (w.mesh.n = 100)],
    ['地块太多', (w) => (w.mesh.n = 200001)],
    ['地块数不是整数', (w) => (w.mesh.n = 1000.5)],
    ['地块数和数组对不上', (w) => (w.mesh.n += 1)],
    ['地图尺寸不对', (w) => (w.width = 1 << 30)],
    ['网格尺寸不对', (w) => (w.mesh.height = 1 << 30)],
    ['spacing 不对', (w) => (w.mesh.spacing = 0)],
    ['spacing 太小(找最近地块的循环走不到头)', (w) => (w.mesh.spacing = Number.MIN_VALUE)],
    ['spacing 太大(铺像素刷不完)', (w) => (w.mesh.spacing = 1e30)],
    ['球面坐标不在球面上', (w) => (w.mesh.xyz[3] = 1e30)],
    ['地块数参数太大(重新生成会卡死)', (w) => (w.params.cells = 1e12)],
    ['参数超范围', (w) => (w.params.landFraction = 2)],
    ['坐标不是数', (w) => (w.mesh.x[3] = NaN)],
    ['坐标出了地图', (w) => (w.mesh.y[3] = 1e6)],
    ['球面坐标不是数', (w) => (w.mesh.xyz[3] = Infinity)],
    ['邻接起点不对', (w) => (w.mesh.adjStart[0] = 1)],
    ['邻接起点没排好', (w) => (w.mesh.adjStart[5] = w.mesh.adjStart[4] - 1)],
    ['邻接终点不对', (w) => (w.mesh.adjStart[w.mesh.n] += 1)],
    ['邻接编号越界', (w) => (w.mesh.adj[10] = w.mesh.n)],
    ['邻接编号是负数', (w) => (w.mesh.adj[10] = -1)],
    ['三角形不是三个一组', (w) => (w.mesh.triangles = w.mesh.triangles.subarray(1).slice())],
    ['三角形编号越界', (w) => (w.mesh.triangles[10] = w.mesh.n)],
    ['海拔是非数', (w) => (w.elevation[7] = NaN)],
    ['海拔是无穷大', (w) => (w.elevation[7] = Infinity)],
    ['气温是非数', (w) => (w.temperature[7] = NaN)],
    ['降水是非数', (w) => (w.precipitation[7] = NaN)],
    ['海冰是非数', (w) => (w.seaIce[7] = NaN)],
    ['径流是非数', (w) => (w.flux[7] = NaN)],
    ['海拔太离谱(等值线走不到头)', (w) => (w.elevation[7] = 1e30)],
    ['气温太离谱', (w) => (w.temperature[7] = -1e30)],
    ['降水太离谱', (w) => (w.precipitation[7] = 1e30)],
    ['最高海拔太离谱', (w) => (w.maxElevation = 1e30)],
    ['水域种类认不出', (w) => (w.water[7] = 3)],
    ['地貌种类认不出', (w) => (w.biome[7] = 250)],
    ['数组种类不对', (w) => (w.elevation = new Float64Array(w.mesh.n))],
    ['参数不是数', (w) => (w.params.seed = 'x')],
    ['气候参数不是数', (w) => (w.climate.temperature = NaN)],
    ['最高海拔不是数', (w) => (w.maxElevation = NaN)],
    ['河流门槛不是数', (w) => (w.riverThreshold = '1')],
    ['板块数不对', (w) => (w.tect.plateCount = -1)],
    ['板块编号越界', (w) => (w.tect.plate[3] = 30000)],
    ['河的地块越界', (w) => (w.rivers[0].cells[0] = w.mesh.n)],
    ['河的点数和地块对不上', (w) => (w.rivers[0].pts = w.rivers[0].pts.subarray(1).slice())],
    ['河的点不是数', (w) => (w.rivers[0].pts[0] = NaN)],
    ['河的点太离谱(按长度细分分不完)', (w) => (w.rivers[0].pts[3] = 1e20)],
    ['河的笔宽长度不对', (w) => (w.rivers[0].drawn = new Uint8Array(1 + w.rivers[0].cells.length))],
    ['火山的地块越界', (w) => (w.volcanoes = [w.mesh.n])],
    ['带了回放快照', (w) => (w.history = [new Float32Array(1)])],
    ['回放快照不是列表', (w) => (w.history = 1)],
    ['地形修改认不出', (w) => (w.terrain = [{ kind: 'evil' }])],
    ['地形修改的坐标太离谱', (w) => (w.terrain = [{ kind: 'volcano', pts: [1e30, 1], r: 28, s: 1 }])],
    ['地形修改太多', (w) => (w.terrain = Array.from({ length: 201 }, () => ({ kind: 'volcano', pts: [1, 1], r: 28, s: 1 })))],
    ['草图格子图不对', (w) => (w.sketch = { grid: new Uint8Array(3), coast: 0 })],
    ['字太长', (w) => (w.note = 'x'.repeat(5000))],
  ];
  it.each(CASES)('%s', (label, change) => {
    const w = structuredClone(map) as any;
    change(w);
    expectBroken(() => validateWorld(w), label);
  });

  it('所有按地块的数组:长度不等于地块数都拦下', () => {
    const n = map.mesh.n;
    const short = (a: any) => a.subarray(1).slice();
    const paths: string[][] = [
      ...['x', 'y'].map((k) => ['mesh', k]),
      ...['elevation', 'water', 'waterLevel', 'temperature', 'precipitation', 'seaIce', 'biome', 'flux'].map((k) => [k]),
      ...['plate', 'convergence', 'distConv', 'strengthConv', 'distDiv', 'strengthDiv', 'land', 'oceanDepth', 'uplift', 'plateau'].map((k) => ['tect', k]),
      ...['sst', 'u', 'v'].map((k) => ['currents', k]),
    ];
    for (const p of paths) {
      const w = structuredClone(map) as any;
      const o = p.length === 1 ? w : w[p[0]];
      const k = p[p.length - 1];
      expect(o[k].length, p.join('.')).toBe(n);
      o[k] = short(o[k]);
      expectBroken(() => validateWorld(w), p.join('.'));
    }
  });

  it('各段世界的键可以很长(画了草图的世界,键里带着整张草图)', () => {
    validateEras({ ...sample.eras, baseKey: 'x'.repeat(4e6) }, map);
  });

  it('地形大事以后的各段:同样查,还不许带网格、段数有上限', () => {
    const era = (change: (w: any) => void) => {
      const e = structuredClone(sample.eras) as any;
      change(e.eras[0].world);
      return e;
    };
    expectBroken(() => validateEras(era((w) => (w.mesh = map.mesh)), map), '带网格');
    expectBroken(() => validateEras(era((w) => (w.elevation = new Float32Array(3))), map), '长度不对');
    expectBroken(() => validateEras(era((w) => (w.temperature[0] = NaN)), map), '非数');
    expectBroken(() => validateEras({ eras: [] }, map), '缺键');
    expectBroken(() => validateEras({ baseKey: 'x', eras: Array.from({ length: 65 }, () => sample.eras.eras[0]) }, map), '段太多');
  });
});

describe('每条规则:历史', () => {
  /** 一条合格的商道 */
  const ROUTE = { id: 0, name: 'x', buyer: 0, from: 0, goods: [{ res: 0, from: 0 }], events: [{ year: 1, kind: 'open' }], paths: [{ year: 1, regions: [0] }] };
  const CASES: [string, (c: any) => void][] = [
    ['种子不是数', (c) => (c.seed = 'x')],
    ['推演年数不是数', (c) => (c.endYear = NaN)],
    ['推演年数是负数', (c) => (c.endYear = -1)],
    ['推演年数太大', (c) => (c.endYear = 60001)],
    ['viable 不对', (c) => (c.viable = 1)],
    ['带了界面临时挂的 history', (c) => (c.history = {})],
    ['宜居度长度不对', (c) => (c.habitat.suitability = new Float32Array(3))],
    ['宜居度种类不对', (c) => (c.habitat.coastDist = new Uint8Array(c.habitat.coastDist.length))],
    // 州
    ['州数不对', (c) => (c.regions.count = -1)],
    ['州数比地块多', (c) => (c.regions.count = 1e7)],
    ['地块 → 州长度不对', (c) => (c.regions.of = new Int32Array(3))],
    ['地块 → 州越界', (c) => (c.regions.of[0] = c.regions.count)],
    ['治所越界', (c) => (c.regions.seat[0] = 1e7)],
    ['州的地块起点不对', (c) => (c.regions.cellStart[0] = 1)],
    ['州的地块起点没排好', (c) => (c.regions.cellStart[3] = c.regions.cellStart[2] - 1)],
    ['州的地块越界', (c) => (c.regions.cells[0] = 1e7)],
    ['州的邻接越界', (c) => (c.regions.adj[0] = c.regions.count)],
    ['州的邻接种类认不出', (c) => (c.regions.adjKind[0] = 9)],
    ['州的邻接长度不对', (c) => (c.regions.adjLen = new Float32Array(1))],
    ['州的出海口越界', (c) => (c.regions.adjCoast[0] = 1e7)],
    ['州名长度不对', (c) => (c.regions.name = ['一个'])],
    ['州名不是字符串', (c) => (c.regions.name[0] = { toString: 1 })],
    ['州的地貌认不出', (c) => (c.regions.biome[0] = 250)],
    // 归属
    ['各州的民族长度不对', (c) => (c.culture = new Int16Array(3))],
    ['各州的民族越界', (c) => (c.culture[0] = c.cultures.length)],
    ['各州的国家越界', (c) => (c.polity[0] = c.polities.length)],
    ['各州的国家小于 −1', (c) => (c.polity[0] = -2)],
    // 民族
    ['民族编号对不上', (c) => (c.cultures[1].id = 0)],
    ['民族名不是字符串', (c) => (c.cultures[0].name = 1)],
    ['民族种类认不出', (c) => (c.cultures[0].kind = 'evil')],
    ['民族发源地越界', (c) => (c.cultures[0].hearth = 1e7)],
    ['民族的颜色是字符串', (c) => (c.cultures[0].color = ['url(x)', 0, 0])],
    ['民族的颜色不是三个数', (c) => (c.cultures[0].color = [1, 2])],
    ['民族的颜色超范围', (c) => (c.cultures[0].color = [1, 2, 300])],
    ['民族的颜色是非数', (c) => (c.cultures[0].color = [1, 2, NaN])],
    ['母族越界', (c) => (c.cultures[0].parent = 1e7)],
    ['母族绕成圈', (c) => ((c.cultures[0].parent = 1), (c.cultures[1].parent = 0))],
    ['母族指自己', (c) => (c.cultures[0].parent = 0)],
    // 城
    ['城编号对不上', (c) => (c.settlements[1].id = 0)],
    ['城的地块越界', (c) => (c.settlements[0].cell = 1e7)],
    ['城的州越界', (c) => (c.settlements[0].region = 1e7)],
    ['城的民族越界', (c) => (c.settlements[0].culture = 1e7)],
    ['城名太长', (c) => (c.settlements[0].name = 'x'.repeat(5000))],
    ['城的年份不是数', (c) => (c.settlements[0].founded = NaN)],
    ['重建的旧城绕成圈', (c) => ((c.settlements[0].rebuilds = 1), (c.settlements[1].rebuilds = 0))],
    ['国都段的国家越界', (c) => (c.settlements[0].capitalSpans = [{ from: 0, polity: 1e7 }])],
    // 国家
    ['国家编号对不上', (c) => (c.polities[1].id = 0)],
    ['国家的民族越界', (c) => (c.polities[0].culture = 1e7)],
    ['国都越界', (c) => (c.polities[0].capital = 1e7)],
    ['国家的颜色是字符串', (c) => (c.polities[0].color = 'red')],
    ['国家种类认不出', (c) => (c.polities[0].kind = 'evil')],
    ['上级越界', (c) => (c.polities[0].parent = 1e7)],
    ['上级绕成圈', (c) => ((c.polities[0].parent = 1), (c.polities[1].parent = 0))],
    ['三国绕成圈', (c) => ((c.polities[0].parent = 1), (c.polities[1].parent = 2), (c.polities[2].parent = 0))],
    ['复国绕成圈', (c) => ((c.polities[0].restores = 1), (c.polities[1].restores = 0))],
    ['受影响绕成圈', (c) => ((c.polities[0].mentor = 1), (c.polities[1].mentor = 0))],
    ['迁都没按先后排', (c) => (c.polities[0].capitals = [{ year: 5, settlement: 0 }, { year: 1, settlement: 0 }])],
    ['迁都的城越界', (c) => (c.polities[0].capitals = [{ year: 5, settlement: 1e7 }])],
    ['王朝的城越界', (c) => (c.polities[0].dynasties = [{ year: 5, name: 'x', seat: 1e7 }])],
    ['王朝名不是字符串', (c) => (c.polities[0].dynasties = [{ year: 5, name: 1, seat: 0 }])],
    ['复辟的王朝越界', (c) => (c.polities[0].dynasties = [{ year: 5, name: 'x', seat: 0, house: 3 }])],
    // 路、地名
    ['路的种类认不出', (c) => (c.routes[0].kind = 'evil')],
    ['路的地块越界', (c) => (c.routes[0].cells[0] = 1e7)],
    ['地名种类认不出', (c) => (c.places[0].kind = 'evil')],
    ['地名名字不是字符串', (c) => (c.places[0].name = {})],
    ['地名原形不是字符串', (c) => (c.places[0].latin = {})],
    ['作者的人物名不是字符串', (c) => (c.authorNames = { 1: {} })],
    ['改过的约名不是字符串', (c) => (c.treatyNames = { 1: {} })],
    ['改过的州名不是字符串', (c) => (c.regionNames = [{}])],
    ['改过的州名比州多', (c) => (c.regionNames = Array.from({ length: c.regions.count + 1 }, () => ''))],
    ['国号档位不是数', (c) => (c.polities[0].titles = [{ year: 1, tier: 'x' }])],
    ['国号一系不是字符串', (c) => (c.polities[0].lineage = {})],
    ['民族的语感不是字符串', (c) => (c.cultures[0].style = {})],
    ['战争的由头不是字符串', (c) => (c.annals[0].cause = {})],
    ['地名路径是非数', (c) => (c.places[0].path = new Float32Array([NaN, 1]))],
    ['地名路径太离谱', (c) => (c.places[0].path = new Float32Array([1e20, 1]))],
    ['地名的地块越界', (c) => (c.places[0].cell = 1e7)],
    ['地名的民族越界', (c) => (c.places[0].culture = 1e7)],
    // 史事
    ['史事没按年份排', (c) => ([c.annals[0], c.annals[c.annals.length - 1]] = [c.annals[c.annals.length - 1], c.annals[0]])],
    ['史事的年份是负数', (c) => (c.annals[0].year = -1)],
    ['史事的年份超过推演年数', (c) => (c.annals.at(-1).year = c.endYear + 1)],
    ['史事的年份是非数', (c) => (c.annals[0].year = NaN)],
    ['史事的国家越界', (c) => (c.annals[0] = { ...c.annals[0], kind: 'found', a: 1e7 })],
    ['史事的民族越界', (c) => (c.annals[0] = { ...c.annals[0], kind: 'migrate', a: 1e7 })],
    ['史事的州越界', (c) => (c.annals[0] = { ...c.annals[0], kind: 'found', region: 1e7 })],
    ['史事的城越界', (c) => (c.annals[0] = { ...c.annals[0], kind: 'found', settlement: 1e7 })],
    ['援盟的国家越界', (c) => (c.annals[0] = { ...c.annals[0], kind: 'war', settlement: 1e7 })],
    ['立约各国越界', (c) => (c.annals[0].ps = [1e7])],
    ['种类太长', (c) => (c.annals[0].kind = 'x'.repeat(40))],
    ['种类认不出', (c) => (c.annals[0].kind = 'evil')],
    ['b 列不是整数', (c) => (c.annals[0].b = 'x')],
    ['war 列不是整数', (c) => (c.annals[0].war = 0.5)],
    // 日志
    ['日志长度对不上', (c) => (c.log.region = new Int32Array(1))],
    ['日志条数比数组多', (c) => (c.log.size = c.log.year.length + 1)],
    ['日志没按年份排', (c) => (c.log.year[0] = c.log.year[1] + 1)],
    ['日志的州越界', (c) => (c.log.region[0] = 1e7)],
    ['日志的层认不出', (c) => (c.log.layer[0] = 2)],
    ['日志的值越界', (c) => ((c.log.layer[0] = 1), (c.log.value[0] = c.polities.length))],
    ['日志的年份超过推演年数', (c) => (c.log.year[c.log.size - 1] = c.endYear + 1)],
    // 检查点
    ['检查点没按年份排', (c) => (c.checkpoints[0].year = 1e6)],
    ['检查点长度不对', (c) => (c.checkpoints[0].polity = new Int16Array(1))],
    ['检查点的国家越界', (c) => (c.checkpoints[0].polity[0] = 30000)],
    // 地形大事的各段
    ['各段和大事对不上', (c) => (c.eras = [])],
    ['有大事没有各段', (c) => delete c.eras],
    ['有各段没有大事', (c) => delete c.upheavals],
    ['那一段的州不对', (c) => (c.eras[0].regions.of = new Int32Array(1))],
    ['那一段的路不对', (c) => (c.eras[0].routes = [{ kind: 'road', cells: new Int32Array([1e7]), built: 0 }])],
    ['那一段的地名不对', (c) => (c.eras[0].places = [{ kind: 'evil' }])],
    ['那一段的宜居度不对', (c) => (c.eras[0].habitat = {})],
    // 大迁徙
    ['迁徙的民族越界', (c) => (c.migrations = [{ culture: 1e7, year: 1, route: [], years: [], target: -1 }])],
    ['迁徙的路线越界', (c) => (c.migrations = [{ culture: 0, year: 1, route: [1e7], years: [1], target: -1 }])],
    ['迁徙的路线和年份对不上', (c) => (c.migrations = [{ culture: 0, year: 1, route: [0], years: [], target: -1 }])],
    ['迁徙的目标越界', (c) => (c.migrations = [{ culture: 0, year: 1, route: [], years: [], target: 1e7 }])],
    ['迁徙立的国越界', (c) => (c.migrations = [{ culture: 0, year: 1, route: [], years: [], target: -1, polity: 1e7 }])],
    // 人物
    ['人物编号对不上', (c) => (c.people[1].id = 0)],
    ['人物的身份认不出', (c) => (c.people[0].role = 'evil')],
    ['人物的国家越界', (c) => (c.people[0].polity = 1e7)],
    ['人物名不是字符串', (c) => (c.people[0].name = 1)],
    ['称号不是字符串', (c) => (c.people[0].title = { a: 1 })],
    ['字不是字符串', (c) => (c.people[0].courtesy = {})],
    ['官名不是字符串', (c) => (c.people[0].posts = [{ title: {}, from: 0 }])],
    ['结局不是字符串', (c) => (c.people[0].fate = {})],
    ['结局认不出', (c) => (c.people[0].fate = 'evil')],
    ['即位认不出', (c) => (c.people[0].rise = 'evil')],
    ['争储没写怎么争的', (c) => (c.people[0].claim = { rivals: [] })],
    ['掌权的种类认不出', (c) => (c.people[0].regencies = [{ kind: 'evil', from: 0, ruler: 0, annal: 0 }])],
    ['掌权的结局认不出', (c) => (c.people[0].regencies = [{ kind: 'heir', end: 'evil', from: 0, ruler: 0, annal: 0 }])],
    ['放逐的种类认不出', (c) => (c.people[0].exile = { how: 'evil', annal: 0, zone: -1, region: -1, year: 0 })],
    ['投奔的缘由认不出', (c) => (c.people[0].exile = { how: 'fled', tie: 'evil', annal: 0, zone: -1, region: -1, year: 0 })],
    ['经手的事认不出', (c) => (c.people[0].deeds = [{ kind: 'evil', year: 0 }])],
    ['人物的生年是非数', (c) => (c.people[0].born = NaN)],
    ['父亲越界', (c) => (c.people[0].parent = 1e7)],
    ['父子绕成圈', (c) => ((c.people[0].parent = 1), (c.people[1].parent = 0))],
    ['母亲越界', (c) => (c.people[0].mom = 1e7)],
    ['丈夫越界', (c) => (c.people[0].husband = 1e7)],
    ['对手越界', (c) => (c.people[0].rival = 1e7)],
    ['籍贯越界', (c) => (c.people[0].home = 1e7)],
    ['争储的对手越界', (c) => (c.people[0].claim = { how: 'coup', rivals: [1e7] })],
    ['领兵的史事越界', (c) => (c.people[0].commands = [{ war: 0, side: 0, from: 0, until: 1, first: 1e7, last: 0 }])],
    ['掌权的史事越界', (c) => (c.people[0].regencies = [{ kind: 'heir', from: 0, ruler: 0, annal: 1e7 }])],
    ['结亲的国家越界', (c) => (c.people[0].spouses = [{ polity: 1e7, father: -1, name: '', year: 0, annal: 0 }])],
    ['放逐的史事越界', (c) => (c.people[0].exile = { how: 'fled', annal: 1e7, zone: -1, region: -1, year: 0 })],
    ['经手的事越界', (c) => (c.people[0].deeds = [{ kind: 'war', year: 0, annal: 1e7 }])],
    // 信仰
    ['信仰编号对不上', (c) => (c.religion.faiths[1].id = 0)],
    ['信仰种类认不出', (c) => (c.religion.faiths[0].kind = 'evil')],
    ['创教者的名字不是字符串', (c) => (c.religion.faiths[0].founder = { name: {} })],
    ['教的类型不是字符串', (c) => (c.religion.faiths[0].form = {})],
    ['信仰的颜色是字符串', (c) => (c.religion.faiths[0].color = 'red')],
    ['信仰的民族越界', (c) => (c.religion.faiths[0].culture = 1e7)],
    ['教派绕成圈', (c) => ((c.religion.faiths[0].parent = 1), (c.religion.faiths[1].parent = 0))],
    ['圣城越界', (c) => (c.religion.faiths[0].holy = 1e7)],
    ['信仰大事没按年份排', (c) => (c.religion.events = [{ year: 5, kind: 'found', faith: 0, polity: -1, region: -1, settlement: -1 }, { year: 1, kind: 'found', faith: 0, polity: -1, region: -1, settlement: -1 }])],
    ['信仰大事的信仰越界', (c) => (c.religion.events = [{ year: 5, kind: 'found', faith: 1e7, polity: -1, region: -1, settlement: -1 }])],
    ['信仰大事的种类认不出', (c) => (c.religion.events = [{ year: 5, kind: 'evil', faith: 0, polity: -1, region: -1, settlement: -1 }])],
    ['国教的国家越界', (c) => (c.religion.states = [{ polity: 1e7, faith: 0, from: 0 }])],
    ['信仰日志越界', (c) => (c.religion.log.value[0] = 30000)],
    ['信仰检查点长度不对', (c) => (c.religion.checkpoints[0].faith = new Int16Array(1))],
    // 发展度
    ['物产长度不对', (c) => (c.development.resources = new Uint8Array(1))],
    ['发现年份长度不对', (c) => (c.development.found = new Float64Array(1))],
    ['能力快照长度不对', (c) => (c.development.snaps[0] = new Uint8Array(1))],
    ['快照和年份对不上', (c) => (c.development.snapYears = [])],
    ['快照年份是非数', (c) => (c.development.snapYears[0] = NaN)],
    ['实控快照长度不对', (c) => (c.development.control[0] = new Uint8Array(1))],
    ['乡村人口快照长度不对', (c) => (c.development.rural[0] = new Float32Array(1))],
    ['账本的国家越界', (c) => (c.development.fiscal.polity[0] = 1e7)],
    ['账本的数不够', (c) => (c.development.fiscal.data = new Float32Array(1))],
    ['发展大事的种类认不出', (c) => (c.development.events = [{ year: 1, kind: 'evil', era: 0, region: 0, culture: -1, polity: -1, settlement: -1 }])],
    ['发展大事的州越界', (c) => (c.development.events = [{ year: 1, kind: 'first', era: 0, region: 1e7, culture: -1, polity: -1, settlement: -1 }])],
    ['接着推的状态长度不对', (c) => (c.development.state.cur = new Float64Array(1))],
    // 思潮
    ['思潮快照长度不对', (c) => (c.ideology.snaps[0] = new Uint8Array(1))],
    ['思潮的国家列表长度不对', (c) => (c.ideology.polities = [])],
    ['思潮的国家不是对象', (c) => (c.ideology.polities[0] = 1)],
    ['传入年份长度不对', (c) => (c.ideology.arrive = new Float64Array(1))],
    ['思潮大事的说越界', (c) => (c.ideology.events = [{ year: 1, kind: 'origin', thought: 1e7, region: -1, settlement: -1, culture: -1, polity: -1 }])],
    // 商道
    ['商道没有事', (c) => (c.trade.routes = [{ ...ROUTE, events: [] }])],
    ['商道的事是空的', (c) => (c.trade.routes = [{ ...ROUTE, events: [null] }])],
    ['商道的事认不出', (c) => (c.trade.routes = [{ ...ROUTE, events: [{ year: 1, kind: 'evil' }] }])],
    ['商道的事没按年份排', (c) => (c.trade.routes = [{ ...ROUTE, events: [{ year: 5, kind: 'open' }, { year: 1, kind: 'end' }] }])],
    ['商道没有货', (c) => (c.trade.routes = [{ ...ROUTE, goods: [] }])],
    ['商道没有路线', (c) => (c.trade.routes = [{ ...ROUTE, paths: [] }])],
    ['商道编号对不上', (c) => (c.trade.routes = [{ ...ROUTE, id: 3 }])],
    ['商道的买方越界', (c) => (c.trade.routes = [{ ...ROUTE, buyer: 1e7 }])],
    ['商道的产地越界', (c) => (c.trade.routes = [{ ...ROUTE, from: 1e7 }])],
    ['商道的货认不出', (c) => (c.trade.routes = [{ ...ROUTE, goods: [{ res: 1e7, from: 0 }] }])],
    ['商道的路线越界', (c) => (c.trade.routes = [{ ...ROUTE, paths: [{ year: 0, regions: [1e7] }] }])],
    // 年份太离谱(界面按年份走的循环加上步长还是它,就卡死了)
    ['人物的卒年太离谱', (c) => (c.people[0].died = 1e300)],
    ['君主在位到的年份太离谱', (c) => (c.people[0].until = 1e300)],
    ['亡国的年份太离谱', (c) => (c.polities[0].ended = 1e300)],
    ['城毁的年份太离谱', (c) => (c.settlements[0].ended = 1e300)],
    ['废路的年份太离谱', (c) => (c.routes[0].abandoned = 1e300)],
    ['民族消亡的年份太离谱', (c) => (c.cultures[0].ended = 1e300)],
    ['快照的年份太离谱', (c) => (c.development.snapYears[c.development.snapYears.length - 1] = 1e300)],
    ['领兵的年份太离谱', (c) => (c.people[0].commands = [{ war: 0, side: 0, from: 0, until: 1e300, first: 0, last: 0 }])],
    ['国教的年份太离谱', (c) => (c.religion.states = [{ polity: 0, faith: 0, from: 0, until: 1e300 }])],
    // 字
    ['哪儿都不许有太长的字', (c) => (c.spare = { deep: ['x'.repeat(300 * 1024)] })],
    ['字段名太长', (c) => (c.spare = { ['x'.repeat(300 * 1024)]: 1 })],
    ['Map 里也算', (c) => (c.spare = new Map([['x'.repeat(300 * 1024), 1]]))],
  ];
  it.each(CASES)('%s', (label, change) => {
    const c = structuredClone(civ) as any;
    change(c);
    expectBroken(() => validateCiv(c, map), label);
  });

  it('样本里这些要试的字段都有(不然上面的测试白跑)', () => {
    expect(civ.polities.length).toBeGreaterThan(3);
    expect(civ.people?.length).toBeGreaterThan(3);
    expect(civ.eras?.length).toBe(1);
    expect(civ.religion?.faiths.length).toBeGreaterThan(1);
    expect(civ.development?.control?.length).toBeGreaterThan(0);
    expect(civ.development?.rural?.length).toBeGreaterThan(0);
    expect(civ.development?.fiscal?.size).toBeGreaterThan(0);
    expect(civ.log.size).toBeGreaterThan(1);
  });

  it('约定的写法不算坏:ideology.arrive 里的 NaN、development.found 里的 Infinity、sailFrom 的 Infinity', () => {
    expect(civ.ideology!.arrive.some(Number.isNaN)).toBe(true);
    expect(civ.development!.found.some((x) => x === Infinity)).toBe(true);
    validateCiv(structuredClone(civ), map);
  });
});

describe('每条规则:编年史', () => {
  const CASES: [string, (e: any[]) => void][] = [
    ['条目不是对象', (e) => (e[0] = 1)],
    ['编号不是整数', (e) => (e[0].id = 'x')],
    ['种类认不出', (e) => (e[0].kind = 'evil')],
    ['年份是负数', (e) => (e[0].year = -1)],
    ['年份超过推演年数', (e) => (e[0].end = civ.endYear + 1)],
    ['年份是非数', (e) => (e[0].year = NaN)],
    ['正文不是字符串', (e) => (e[0].text = 1)],
    ['正文太长', (e) => (e[0].text = 'x'.repeat(300 * 1024))],
    ['印章太长', (e) => (e[0].tag = 'x'.repeat(9))],
    ['重要度认不出', (e) => (e[0].importance = 4)],
    ['相关国家越界', (e) => (e[0].polities = [1e7])],
    ['事发的州越界', (e) => (e[0].regions = [1e7])],
    ['相关的城越界', (e) => (e[0].settlement = 1e7)],
    ['写到的人物越界', (e) => (e[0].people = [1e7])],
    ['折叠的条目也查', (e) => (e[0].children = [{ ...e[0], year: -1, children: undefined }])],
    ['折叠得太深', (e) => (e[0].children = Array.from({ length: 20 }).reduce<any[]>((inner) => [{ ...e[0], children: inner }], []))],
  ];
  it.each(CASES)('%s', (label, change) => {
    const e = structuredClone(sample.chronicle.entries) as any[];
    change(e);
    expectBroken(() => validateChronicle({ entries: e }, civ), label);
  });
  it('不是列表', () => {
    expectBroken(() => validateChronicle({}, civ), '没有条目');
    expectBroken(() => validateChronicle([], civ), '第 1 版的样子没转过');
    expectBroken(() => validateChronicle({ entries: [], authorFemale: ['x'] }, civ), '人物编号不是整数');
  });
});

describe('每条规则:旗', () => {
  const first = (b: any) => b.eras.find((x: any[]) => x.length)[0];
  const CASES: [string, (b: any) => void][] = [
    ['列表和国家对不上', (b) => (b.eras = [])],
    ['年份不是数', (b) => (first(b).year = 'x')],
    ['键不是字符串', (b) => (first(b).key = 1)],
    ['颜色混进网页代码', (b) => (first(b).spec.c = ['"><script>alert(1)</script>'])],
    ['颜色认不出', (b) => (first(b).spec.c = ['Z'])],
    ['形认不出', (b) => (first(b).spec.shape = 'evil')],
    ['样式认不出', (b) => (first(b).spec.layout = '<svg onload=alert(1)>')],
    ['图案认不出', (b) => (first(b).spec.charge = { sym: '<script>', t: 'W', at: 'center' })],
    ['烙印不是数', (b) => (first(b).spec.charge = { sym: 'star', t: 'W', at: 'center', tamga: '1"><x' })],
    ['纹样认不出', (b) => (first(b).spec.mark = '<img src=x onerror=alert(1)>')],
    ['镶边认不出', (b) => (first(b).spec.trim = 'url(x)')],
    ['多了认不出的字段', (b) => (first(b).spec.onload = 'alert(1)')],
    ['旗不是对象', (b) => (first(b).spec = 'b/plain/W')],
    ['怎么来的认不出', (b) => (first(b).how = 'evil')],
    ['种类认不出', (b) => (first(b).why.kind = 'evil')],
    ['兴起的城越界', (b) => (first(b).why.city = 1e7)],
    ['分出的国越界', (b) => (first(b).why.parent = 1e7)],
    ['用回的故国越界', (b) => (first(b).why.restores = 1e7)],
    ['改制前的那面越界', (b) => (first(b).why.prior = 1e7)],
    ['改制前的那面指自己(讲旗的意思时走不到头)', (b) => (first(b).why.prior = 0)],
    ['第几朝不是整数', (b) => (first(b).dyn = 0.5)],
  ];
  it.each(CASES)('%s', (label, change) => {
    const b = structuredClone(sample.flags) as any;
    change(b);
    expectBroken(() => validateFlags(b, civ), label);
  });

  it('所有真实的旗都能原样过存档写法', () => {
    for (const eras of sample.flags.eras) for (const e of eras) expect(encodeFlag(e.spec).length).toBeLessThanOrEqual(80);
  });
});

describe('每条规则:作者内容、封面', () => {
  const note = { key: 'k', kind: '史书', title: 't', text: '正文', createdAt: '2026-11-04', provider: 'p', model: 'm' };
  it('作者内容', () => {
    validateAuthor({ notes: [note, { ...note, text: '换行\n和<b>标签</b>都只是字' }] });
    expectBroken(() => validateAuthor(1), '不是对象');
    expectBroken(() => validateAuthor({}), '没有 notes');
    expectBroken(() => validateAuthor({ notes: [1] }), '条目不是对象');
    expectBroken(() => validateAuthor({ notes: [{ ...note, text: 1 }] }), '正文不是字符串');
    expectBroken(() => validateAuthor({ notes: [{ ...note, text: 'x'.repeat(4e6 + 1) }] }), '正文太长');
    expectBroken(() => validateAuthor({ notes: [{ ...note, title: 'x'.repeat(5000) }] }), '标题太长');
    expectBroken(() => validateAuthor({ notes: Array.from({ length: 1e5 + 1 }, () => note) }), '太多');
  });

  it('封面', () => {
    validateThumb(tinyJpeg());
    validateThumb(tinyJpeg(480, 240));
    expectBroken(() => validateThumb(new TextEncoder().encode('<svg onload=alert(1)>')), '不是 JPEG');
    expectBroken(() => validateThumb(new Uint8Array(0)), '空的');
    expectBroken(() => validateThumb(tinyJpeg().subarray(0, 10)), '不完整');
    expectBroken(() => validateThumb(tinyJpeg(65535, 65535)), '尺寸太大(解开撑爆内存)');
    expectBroken(() => validateThumb(tinyJpeg(0, 10)), '尺寸是 0');
    expectBroken(() => validateThumb(new Uint8Array([0xff, 0xd8, 0xff, 0xd9])), '没有尺寸');
    expectBroken(() => validateThumb(new Uint8Array([0xff, 0xd8, 0xff, 0xc0, 0xff, 0xff, 0xff, 0xd9])), '段长超出文件');
    expectBroken(() => validateThumb(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x00, 0xff, 0xd9])), '段长不对');
  });
});

describe('乱改内容反复试(固定种子):不卡死,错都接得住', () => {
  const HOSTILE: unknown[] = [NaN, Infinity, -Infinity, -1, 0, 1e9, 1.5, '', 'x', '<script>', null, undefined, true, [], {}, [1, 2], { a: 1 }, new Float32Array(1), new Map(), new Set([1])];

  /** 跑一下,抛的只能是 WorldFileError */
  function attempt(run: () => void, kinds: Record<string, number>) {
    try {
      run();
      kinds.ok = (kinds.ok ?? 0) + 1;
    } catch (e) {
      if (!(e instanceof WorldFileError)) throw e;
      kinds[e.kind] = (kinds[e.kind] ?? 0) + 1;
    }
  }

  /** 走一遍值,收集每个能改的位置:[对象, 键];数字数组收集成 [数组, 下标](抽几个) */
  function slots(root: unknown): [any, string | number][] {
    const out: [any, string | number][] = [];
    const seen = new Set<object>();
    const walk = (v: any) => {
      if (v === null || typeof v !== 'object' || seen.has(v)) return;
      seen.add(v);
      if (ArrayBuffer.isView(v)) return;
      if (Array.isArray(v)) {
        v.forEach((x, i) => {
          out.push([v, i]);
          walk(x);
        });
      } else if (!(v instanceof Map) && !(v instanceof Set)) {
        for (const k of Object.keys(v)) {
          out.push([v, k]);
          walk(v[k]);
        }
      }
    };
    walk(root);
    return out;
  }

  it('按结构改:任选一处换成捣乱的值', () => {
    const rng = mulberry32(0x5eed03);
    const kinds: Record<string, number> = {};
    const targets: [string, unknown, () => void][] = [
      ['civ', structuredClone(civ), () => undefined],
      ['map', structuredClone(map), () => undefined],
      ['chronicle', structuredClone(sample.chronicle), () => undefined],
      ['flags', structuredClone(sample.flags), () => undefined],
    ];
    const run: Record<string, (v: any) => void> = {
      civ: (v) => validateCiv(v, map),
      map: (v) => validateWorld(v),
      chronicle: (v) => validateChronicle(v, civ),
      flags: (v) => validateFlags(v, civ),
    };
    for (const [name, value] of targets) {
      const places = slots(value);
      for (let i = 0; i < 150; i++) {
        const [o, k] = places[Math.floor(rng() * places.length)];
        const old = o[k];
        o[k] = HOSTILE[Math.floor(rng() * HOSTILE.length)];
        attempt(() => run[name](value), kinds);
        o[k] = old;
      }
    }
    expect(kinds.broken).toBeGreaterThan(300);
  }, 30_000);

  it('按字节改:块的字节改完照样读、照样校验', () => {
    const rng = mulberry32(0x5eed04);
    const kinds: Record<string, number> = {};
    const raw = packValue(civ);
    const headLen = new DataView(raw.buffer, raw.byteOffset).getUint32(8, true);
    for (let i = 0; i < 80; i++) {
      const b = raw.slice();
      for (let k = 0; k < 4; k++) {
        // 一半改结构(JSON),一半改数组的字节
        const at = i % 2 ? 12 + Math.floor(rng() * headLen) : 12 + headLen + Math.floor(rng() * (b.length - 12 - headLen));
        b[at] = i % 2 ? '0123456789-",:{}[]e.'.charCodeAt(Math.floor(rng() * 20)) : Math.floor(rng() * 256);
      }
      attempt(() => {
        let v: unknown;
        try {
          v = unpackValue(b);
        } catch {
          throw new WorldFileError('broken', '读包函数拦下了');
        }
        validateCiv(v, map);
      }, kinds);
    }
    expect(kinds.broken).toBeGreaterThan(20);
  }, 30_000);

  it('绕成圈、很长的链:线性走完,不卡', () => {
    const c = structuredClone(civ) as any;
    const n = c.polities.length;
    for (let i = 0; i < n; i++) c.polities[i].parent = (i + 1) % n;
    const t = performance.now();
    expectBroken(() => validateCiv(c, map), '一个大圈');
    for (let i = 0; i < n; i++) c.polities[i].parent = i + 1 < n ? i + 1 : undefined;
    validateCiv(c, map);
    expect(performance.now() - t).toBeLessThan(5000);
  });
});
