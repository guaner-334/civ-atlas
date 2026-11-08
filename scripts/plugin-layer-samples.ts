/**
 * 插件图层格式第 1 版的样本:tests/fixtures/plugin-layers/ 里的几个世界文件,和 v1.json(它们该读出来的样子)。
 *
 *   npx tsx scripts/plugin-layer-samples.ts           补进 tests/fixtures/plugin-layers/
 *   npx tsx scripts/plugin-layer-samples.ts <目录>    写到别的目录试一试
 *
 * 只补还没有的样本,已有的文件和它在 v1.json 里的那一项一个字节都不动:样本就是用的人手里的老世界,
 * 重新做一份,测试是绿了,他们的文件照样可能打不开。格式出第 2 版时在这里加新样本(新文件名),第 1 版的留着。
 *
 * - v1-cells:工具插件的地块图层,一个世界存满 16 个(走网站存进世界、存成文件的那条路)
 * - v1-sim-blocks:推演插件的图层,每个图层一块(和推演插件的状态块在一起),再加工具插件的地块图层、带年份的地块图层
 * - v1-sim-civ:同一段历史,推演插件的图层放在历史那一块里(网站自己存成文件时就是这样),再加一个工具插件的地块图层
 * - v1-tool-regions:工具插件存的按州按年份图层(没有推演插件),带一件地形大事:之前的几份里大事以后才有的州是 NaN
 */
import 'fake-indexeddb/auto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { generateCiv } from '../src/gen/civ';
import type { SimPlugin } from '../src/gen/civ/engine/plugin';
import type { SimRead } from '../src/gen/civ/simRead';
import { flagBook } from '../src/gen/civ/story/flags';
import { chronicleBlock } from '../src/gen/civ/story/nameTokens';
import type { Civ } from '../src/gen/civ/types';
import { upheavalSteps } from '../src/gen/civ/upheaval';
import { BIOMES } from '../src/gen/biomes';
import { GENERATOR_VERSION, type Upheaval, type WorldEdits } from '../src/gen/edits';
import { checkLayerLook } from '../src/gen/layerLook';
import { READER_VERSIONS } from '../src/gen/readers/versions';
import { makeSave, worldCheck, type SaveFile } from '../src/gen/savefile';
import { makePart, recipeKey, recipeOfSave, sha256 } from '../src/gen/snapshot';
import { DEFAULT_PARAMS, generateWorld, type World } from '../src/gen/world';
import { buildManifest, manifestBytes, packPluginLayer, packWorldParts, zipWorld, type WorldEras } from '../src/gen/worldFile';
import { savedLayerId, type PluginLayerValue, type WorldMade, type WorldPlugin } from '../src/gen/worldFormat';
import { historyRegions } from '../src/plugin/read';
import { changePluginLayer, commitWorld, revisionFile } from '../src/worldVault';
import { FACTS_FILE, LAYER_DIR, openSample, sampleFacts, type SampleFacts } from '../tests/lib/pluginLayerFacts';

const ROOT = join(LAYER_DIR, '..', '..', '..');
const APP = (JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as { version: string }).version;
const COMMIT = execFileSync('git', ['rev-parse', '--short=7', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim();
const MADE: WorldMade = { app: APP, generator: GENERATOR_VERSION, commit: COMMIT, at: '2026-11-08T12:00:00.000Z' };
const SAVED_AT = '2026-11-08T12:00:00.000Z';
const F32_MAX = 3.4028234663852886e38;
const params = { ...DEFAULT_PARAMS, seed: 7, cells: 2000 };

type Look = Parameters<typeof checkLayerLook>[0];

async function plugin(id: string, version: string, role: string, name: string): Promise<WorldPlugin> {
  return { id, version, sum: await sha256(new TextEncoder().encode(`${id}@${version}`)), role, name };
}

/** 网站存进世界的那一份:样子照网站查完的(和存进世界时一样),一格一个数 */
function cellLayer(look: Look, values: Float32Array, years?: number[]): PluginLayerValue {
  return { ...checkLayerLook(look), unit: 'cell', ...(years ? { years } : {}), values };
}

const perCell = (w: World, f: (i: number) => number) => Float32Array.from({ length: w.mesh.n }, (_, i) => f(i));
const land = (w: World, i: number) => w.water[i] === 0;

function recipeOf(world: World, title: string, edits: Partial<WorldEdits>): SaveFile {
  return makeSave(params, { names: {}, interventions: [], terrain: [], upheavals: [], ...edits }, worldCheck(world), title, SAVED_AT, { projection: 'robinson', center: 120 });
}

/** 走网站存世界的那条路:存进本机仓库(看世界的几块),再一个个存进工具插件的图层,最后存成文件 */
async function viaVault(id: string, recipe: SaveFile, world: World, civ: Civ, eras: WorldEras | null, sims: WorldPlugin[], layers: [WorldPlugin, string, PluginLayerValue][]): Promise<Uint8Array> {
  const parts = [
    await makePart('map', { ...world, history: [] }),
    ...(eras ? [await makePart('eras', eras)] : []),
    await makePart('civ', civ),
    await makePart('chronicle', chronicleBlock(civ)),
    await makePart('flags', flagBook(world, civ)),
  ];
  const key = await recipeKey(recipeOfSave(recipe));
  const done = await commitWorld({ id, recipe, recipeKey: key, parts, made: MADE, readers: { ...READER_VERSIONS }, ...(sims.length ? { simPlugins: sims } : {}) });
  if (done.status !== 'saved') throw new Error(`${id} 没存进仓库:${done.status}`);
  for (const [rec, layerId, data] of layers) {
    const r = await changePluginLayer(id, rec, savedLayerId(layerId), data);
    if (r.status !== 'saved') throw new Error(`${id} 的图层 ${layerId} 没存进去:${r.status}`);
  }
  const blob = await revisionFile(id, undefined, true);
  return new Uint8Array(await blob!.arrayBuffer());
}

// ---------------------------------------------------------------------------
// 工具插件的地块图层

async function cellsSample(world: World): Promise<Uint8Array> {
  const SEA = await plugin('sea-ruler', '1.2.0', 'tool', '离海多远');
  const LAND = await plugin('land-use', '0.3.1', 'tool', '土地用途');
  const LONG = await plugin('long-plugin-name-for-format-test', '2.0.0', 'tool', '名字最长的插件');
  const w = world;
  const biomes = BIOMES.slice(0, 8);
  const palette = ['#1f78b4', '#a6cee3', '#33a02c', '#b2df8a', '#e31a1c', '#fb9a99', '#ff7f00', '#fdbf6f'];
  const long40 = '长'.repeat(38) + '🌋';
  const districts = [{ value: -(2 ** 31), color: '#000000', label: '最小的整数' }, ...Array.from({ length: 31 }, (_, k) => ({ value: k - 15, color: `#${(((k * 0x2f1b3d) & 0xffffff) | 0x101010).toString(16).padStart(6, '0')}`, label: `第${k - 15}区`.padEnd(40, '区') }))];
  const extremes = [F32_MAX, -F32_MAX, -0, 1e-45, 1, NaN, 0.1];
  const layers: [WorldPlugin, string, PluginLayerValue][] = [
    [SEA, 'coast-km', cellLayer({ title: '离海多远', ramp: { colors: ['#FFFFFF', '#08306B'], min: 0, max: 3000 }, legend: '公里' }, perCell(w, (i) => (land(w, i) ? w.elevation[i] : NaN)))],
    [SEA, 'Sea_Distance', cellLayer({ title: '海拔（范围按数据）', ramp: { colors: ['#f7fbff', '#6baed6', '#08306b'] }, legend: '米' }, perCell(w, (i) => w.elevation[i]))],
    [SEA, 'warmth', cellLayer({ title: '气温', ramp: { colors: ['#313695', '#ffffbf', '#a50026'], min: -30 }, opacity: 0.8, legend: '°C' }, perCell(w, (i) => w.temperature[i]))],
    [SEA, 'rain', cellLayer({ title: '降水', ramp: { colors: ['#ffffcc', '#a1dab4', '#41b6c4', '#225ea8'], max: 3000 }, legend: '毫米' }, perCell(w, (i) => w.precipitation[i]))],
    [LAND, 'biome', cellLayer({ title: '地貌', classes: biomes.map((b, k) => ({ value: b.id, color: palette[k], label: b.name })), opacity: 0.5, legend: '前八种' }, perCell(w, (i) => w.biome[i]))],
    [LAND, 'farmland', cellLayer({ title: '耕地', classes: [{ value: 1, color: '#E6AB02', label: '耕地' }], opacity: 1 }, perCell(w, (i) => (land(w, i) && w.temperature[i] > 5 ? 1 : 0)))],
    [LAND, 'districts-32', cellLayer({ title: long40, classes: districts, legend: '说'.repeat(40) }, perCell(w, (i) => (i % 101 === 0 ? -(2 ** 31) : (i % 37) - 18)))],
    [
      LAND,
      'ramp-16',
      cellLayer(
        { title: '十六色', ramp: { colors: Array.from({ length: 16 }, (_, k) => `#${(k * 17).toString(16).padStart(2, '0')}40${(255 - k * 17).toString(16).padStart(2, '0')}`), min: -1, max: 1 } },
        perCell(w, (i) => (i % 13 === 0 ? NaN : (((i * 37) % 201) - 100) / (i % 17 === 0 ? 50 : 100))),
      ),
    ],
    [LAND, 'extremes', cellLayer({ title: '极端的数', ramp: { colors: ['#000000', '#ffffff'] } }, perCell(w, (i) => extremes[i % extremes.length]))],
    [LAND, 'hidden', cellLayer({ title: '全透明', classes: [{ value: 0, color: '#000000', label: '零' }, { value: 1, color: '#ffffff', label: '一' }], opacity: 0 }, perCell(w, (i) => i % 2))],
    [LAND, 'flat', cellLayer({ title: '处处一样', ramp: { colors: ['#fee8c8', '#e34a33'] } }, perCell(w, (i) => (land(w, i) ? 5 : NaN)))],
    [LAND, 'empty', cellLayer({ title: '一格都不画', ramp: { colors: ['#ffffff', '#000000'] } }, perCell(w, () => NaN))],
    [LONG, 'max-length-layer-id-25-ch', cellLayer({ title: '块名正好 64 个字', classes: [{ value: 0, color: '#66c2a5', label: '单' }, { value: 1, color: '#fc8d62', label: '双' }], legend: '' }, perCell(w, (i) => i % 2))],
    [LONG, 'thin', cellLayer({ title: '很淡', ramp: { colors: ['#000000', '#ff0000'], min: 0, max: 1 }, opacity: 0.05 }, perCell(w, (i) => (i % 100) / 100))],
    [LONG, 'controls', cellLayer({ title: '第一行\n第二行‮反过来', classes: [{ value: 0, color: '#8dd3c7', label: '甲\t乙' }, { value: 1, color: '#bebada', label: '丙' }], legend: '\u0007响铃' }, perCell(w, (i) => i % 3))],
    [LONG, 'bands', cellLayer({ title: '五色带', ramp: { colors: ['#d7191c', '#fdae61', '#ffffbf', '#abd9e9', '#2c7bb6'], min: 0, max: 100 }, opacity: 0.65, legend: '分' }, perCell(w, (i) => ((i * 7919) % 1000) / 10))],
  ];
  const civ = generateCiv(world, { endYear: 300 });
  return viaVault('wlayers-cells', recipeOf(world, '工具插件的图层', { endYear: 300 }), world, civ, null, [], layers);
}

// ---------------------------------------------------------------------------
// 推演插件的图层

const UPHEAVALS: Upheaval[] = [{ year: 300, ops: [{ kind: 'volcano', pts: [812, 403], r: 60, s: 1.5 }] }];
const END_YEAR = 600;

/** 魔力:四个图层(一个插件最多四个),渐变给全范围 / 不给范围 / 只给上限,分类;存的间隔各不相同 */
const magic = (): SimPlugin<SimRead> => ({
  id: 'sample-magic',
  every: 10,
  tables: [
    { id: 'magic', name: '魔力', unit: 'region', every: 5, min: 0, max: 100, init: 10, off: 0, rate: '0.05 * (nbmean(nb.magic) - magic) + 0.3 - 0.01 * magic' },
    { id: 'mark', name: '标记', unit: 'region', cols: ['甲', '乙'], input: true, min: 0, max: 9, off: 0 },
    { id: 'heat', name: '热度', unit: 'region', input: true, min: -50, max: 50, off: 0 },
  ],
  layers: [
    { id: 'magic', table: 'magic', keep: 50, title: '魔力浓度', ramp: { colors: ['#1b1036', '#5b2a9e', '#a46cff', '#f2e6ff'], min: 0, max: 60 }, legend: '魔力（0–100）' },
    { id: 'magic-auto', table: 'magic', keep: 13, title: '魔力（范围按数据）', ramp: { colors: ['#fff7ec', '#7f0000'] }, opacity: 0.8 },
    { id: 'mark-b', table: 'mark', col: '乙', keep: 30, title: '标记', classes: [0, 1, 2].map((v) => ({ value: v, color: ['#cccccc', '#d95f02', '#1b9e77'][v], label: `第 ${v} 类` })), legend: '类' },
    { id: 'heat', table: 'heat', keep: 1000, title: '热度', ramp: { colors: ['#2166ac', '#f7f7f7', '#b2182b'], max: 40 }, opacity: 1 },
  ],
  act(turn) {
    const n = turn.read.regions().count;
    const mark = new Float64Array(n * 2);
    const heat = new Float64Array(n);
    for (let r = 0; r < n; r++) {
      mark[r * 2] = Math.floor(turn.rand(r, turn.year) * 3);
      mark[r * 2 + 1] = (r + Math.floor(turn.year / 10)) % 3;
      heat[r] = ((r * 7 + Math.floor(turn.year)) % 100) - 50;
    }
    return { tables: { mark, heat } };
  },
});

/** 虔诚:一个分类图层,半透明 */
const faith = (): SimPlugin<SimRead> => ({
  id: 'sample-faith',
  every: 20,
  tables: [{ id: 'zeal', name: '虔诚', unit: 'region', input: true, min: 0, max: 4, off: 0 }],
  layers: [{ id: 'zeal', table: 'zeal', keep: 100, title: '虔诚', classes: ['淡', '平', '笃', '狂', '圣'].map((label, v) => ({ value: v, color: ['#f2f0f7', '#cbc9e2', '#9e9ac8', '#756bb1', '#54278f'][v], label })), opacity: 0.4, legend: '五级' }],
  act(turn) {
    const n = turn.read.regions().count;
    const zeal = new Float64Array(n);
    for (let r = 0; r < n; r++) zeal[r] = (r * 3 + Math.floor(turn.year / 20)) % 5;
    return { tables: { zeal } };
  },
});

interface SimWorld {
  world: World;
  civ: Civ;
  eras: WorldEras;
  recipe: SaveFile;
  sims: WorldPlugin[];
  tool: [WorldPlugin, string, PluginLayerValue];
}

async function simWorld(world: World): Promise<SimWorld> {
  const steps = upheavalSteps(params, [], null, UPHEAVALS);
  const civ = generateCiv(world, { endYear: END_YEAR, upheavals: steps, plugins: [magic(), faith()] });
  const eras: WorldEras = {
    baseKey: 'base',
    eras: steps.map((s, i) => {
      const { mesh: _mesh, history: _history, ...rest } = s.world;
      void _mesh, _history;
      return { key: `era${i}`, world: { ...rest, history: [] } };
    }),
  };
  const sims = [await plugin('sample-magic', '1.0.0', 'sim', '魔力'), await plugin('sample-faith', '0.9.0', 'sim', '虔诚')];
  const SEA = await plugin('sea-ruler', '1.2.0', 'tool', '离海多远');
  const tool: SimWorld['tool'] = [SEA, 'coast-km', cellLayer({ title: '离海多远', ramp: { colors: ['#ffffff', '#08306b'], min: 0, max: 3000 }, legend: '公里' }, perCell(world, (i) => (land(world, i) ? world.elevation[i] : NaN)))];
  return { world, civ, eras, recipe: recipeOf(world, '推演插件的图层', { upheavals: UPHEAVALS, endYear: END_YEAR }), sims, tool };
}

/** 每个图层一块:网站打包世界文件的那一份,再接上工具插件的地块图层(带年份的两个只能这样放进去,网站存进世界时还不收) */
async function simBlocksSample(s: SimWorld): Promise<Uint8Array> {
  const LAND = await plugin('land-use', '0.3.1', 'tool', '土地用途');
  const { world: w } = s;
  const input = { id: 'wlayers-sim', title: '推演插件的图层', made: MADE, readers: { ...READER_VERSIONS }, recipe: s.recipe, map: w, eras: s.eras, civ: s.civ, chronicle: chronicleBlock(s.civ), flags: flagBook(w, s.civ), plugins: [...s.sims, s.tool[0], LAND] };
  const packed = await packWorldParts(input);
  const growth = cellLayer({ title: '开垦', ramp: { colors: ['#f7fcf5', '#00441b'], min: 0, max: 100 }, legend: '%' }, Float32Array.from({ length: 3 * w.mesh.n }, (_, j) => (land(w, j % w.mesh.n) ? ((j % w.mesh.n) % 50) * (1 + Math.floor(j / w.mesh.n)) : NaN)), [0, 400, 2400]);
  const zones = cellLayer({ title: '大事以后的分区', classes: [0, 1, 2].map((v) => ({ value: v, color: ['#e41a1c', '#377eb8', '#4daf4a'][v], label: `${v} 区` })), opacity: 0.6 }, perCell(w, (i) => i % 4), [300]);
  const parts = [...packed.parts, await packPluginLayer(s.tool[0].id, savedLayerId(s.tool[1]), s.tool[2]), await packPluginLayer(LAND.id, 'growth', growth), await packPluginLayer(LAND.id, 'era-zones', zones)];
  const blob = await zipWorld(manifestBytes(buildManifest(input, parts.map((p) => p.info))), parts);
  return new Uint8Array(await blob.arrayBuffer());
}

/** 推演插件的图层在历史那一块里:网站推完存进本机仓库、存成文件的那一份 */
function simCivSample(s: SimWorld): Promise<Uint8Array> {
  return viaVault('wlayers-sim-civ', s.recipe, s.world, s.civ, s.eras, s.sims, [s.tool]);
}

// ---------------------------------------------------------------------------
// 工具插件的按州按年份图层

/** 网站存进世界的那一份:按州,几份接在一起 */
function regionLayer(look: Look, years: number[], values: Float32Array): PluginLayerValue {
  return { ...checkLayerLook(look), unit: 'region', years, values };
}

async function toolRegionsSample(world: World): Promise<Uint8Array> {
  const steps = upheavalSteps(params, [], null, UPHEAVALS);
  const civ = generateCiv(world, { endYear: END_YEAR, upheavals: steps });
  const eras: WorldEras = {
    baseKey: 'base',
    eras: steps.map((s, i) => {
      const { mesh: _mesh, history: _history, ...rest } = s.world;
      void _mesh, _history;
      return { key: `era${i}`, world: { ...rest, history: [] } };
    }),
  };
  const POP = await plugin('pop-density', '1.0.0', 'tool', '人口密度');
  const count = civ.regions.count;
  // 那一年还没有的州(地形大事以后才有)是 NaN
  const frames = (years: number[], f: (r: number, y: number) => number) => {
    const v = new Float32Array(years.length * count).fill(NaN);
    years.forEach((y, k) => {
      const had = historyRegions(civ, { year: y }).length;
      for (let r = 0; r < had; r++) v[k * count + r] = f(r, y);
    });
    return v;
  };
  const every50 = Array.from({ length: END_YEAR / 50 + 1 }, (_, k) => k * 50);
  const uneven = [0, 120, 333, END_YEAR];
  const layers: [WorldPlugin, string, PluginLayerValue][] = [
    [POP, 'density', regionLayer({ title: '各国人口密度', ramp: { colors: ['#c7e9b4', '#41b6c4', '#225ea8', '#0c2c84'], min: 0, max: 6 }, legend: '人/平方公里' }, every50, frames(every50, (r, y) => ((r * 13 + y / 50) % 60) / 10))],
    [POP, 'Region_Kind', regionLayer({ title: '州的类别', classes: [0, 1, 2].map((v) => ({ value: v, color: ['#1b9e77', '#d95f02', '#7570b3'][v], label: `第 ${v} 类` })), opacity: 0.5 }, uneven, frames(uneven, (r, y) => (r + Math.floor(y / 100)) % 3))],
    [POP, 'late', regionLayer({ title: '后来才有', ramp: { colors: ['#fff7ec', '#7f0000'] } }, [450], frames([450], (r) => r % 10))],
  ];
  return viaVault('wlayers-tool-regions', recipeOf(world, '工具插件的按州图层', { upheavals: UPHEAVALS, endYear: END_YEAR }), world, civ, eras, [], layers);
}

// ---------------------------------------------------------------------------

/** 给了目录 = 写到那里试一试(不碰测试的样本) */
async function main(dir = LAYER_DIR) {
  mkdirSync(dir, { recursive: true });
  const factsFile = join(dir, basename(FACTS_FILE));
  const facts: Record<string, SampleFacts> = existsSync(factsFile) ? JSON.parse(readFileSync(factsFile, 'utf8')) : {};
  const world = generateWorld(params);
  let sim: SimWorld | null = null;
  const simOnce = async () => (sim ??= await simWorld(world));
  const makers: Record<string, () => Promise<Uint8Array>> = {
    'v1-cells.civworld': () => cellsSample(world),
    'v1-sim-blocks.civworld': async () => simBlocksSample(await simOnce()),
    'v1-sim-civ.civworld': async () => simCivSample(await simOnce()),
    'v1-tool-regions.civworld': () => toolRegionsSample(world),
  };
  for (const [name, make] of Object.entries(makers)) {
    const path = join(dir, name);
    if (existsSync(path)) {
      console.log(`${name} 已经有了,不动`);
      continue;
    }
    const file = await make();
    const { opened, content, layers } = await openSample(file);
    if (opened.kept.length || content.skipped.length) throw new Error(`${name} 有块没读进来:${[...opened.kept.map((p) => p.name), ...content.skipped].join('、')}`);
    writeFileSync(path, file);
    facts[name] = await sampleFacts(file);
    console.log(`${name}:${(file.length / 1024).toFixed(0)} KB,${layers.length} 个图层(${layers.map((l) => `${l.at}${l.value.years ? ` ${l.value.years.length} 份` : ''}`).join('、')})`);
  }
  // 只有数和颜色的数组写在一行(里面套着的先收)
  let text = JSON.stringify(facts, null, 1);
  for (let before = ''; before !== text; ) {
    before = text;
    text = text.replace(/\[\s+((?:[-0-9.e+,\s]|null|\[[^[\]]*\])*|(?:\s*"#[0-9a-f]{6}",?)+)\s+\]/g, (_, body: string) => `[${body.replace(/\s+/g, ' ').trim()}]`);
  }
  if (!isDeepStrictEqual(JSON.parse(text), facts)) throw new Error('v1.json 写错了');
  writeFileSync(factsFile, `${text}\n`);
}

await main(process.argv[2]);
