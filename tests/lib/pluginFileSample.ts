/**
 * 插件文件的样本:一个好的,每种错各一个坏的。scripts/plugin-file-samples.ts 把它们写进 tests/fixtures/plugin-file/,
 * 服务器那边拿同一批文件测;big 的几个太大,不进仓库,只在单测里现做。
 */
import { createHash } from 'node:crypto';
import { PNG } from 'pngjs';
import { parseZip, writeZip } from '../../src/gen/zipStore';
import { PLUGIN_MAX_BYTES, packPluginFile, type PluginFileErrorKind, type PluginPackInput } from '../../src/plugin/pluginFile';

/* eslint-disable @typescript-eslint/no-explicit-any */

const enc = new TextEncoder();
const text = (s: string) => enc.encode(s);
const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');

/** 纯色的 PNG 图标 */
export function iconPng(size = 128): Uint8Array {
  const png = new PNG({ width: size, height: size });
  for (let i = 0; i < png.data.length; i += 4) png.data.set([0x3a, 0x6e, 0xa5, 0xff], i);
  return new Uint8Array(PNG.sync.write(png));
}

const CODE = `// 量路程:点两个点,按地形算要走几天
civAtlas.onCall(async (req) => {
  if (req.kind !== 'measure') return null;
  const [a, b] = req.cells;
  return { from: a, to: b, days: Math.abs(a - b) };
});
`;

const README = `# 量路程

在地图上点两个点,按地形算要走几天:山难走,海不能走。
`;

const LICENSE = `MIT License

Copyright (c) 2026 示例作者

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
`;

/** 好样本的内容:每个字段、每个文件都有 */
export function goodInput(): PluginPackInput {
  return {
    manifest: {
      id: 'route-measure',
      name: '量路程',
      version: '1.0.0',
      role: 'tool',
      api: 1,
      runtime: 'worker',
      requires: ['world.read@1', 'history.read@1', 'input.pick@1', 'ui.panel@1', 'layer.marks@1'],
      optional: ['layer.cells@1'],
      why: { 'history.read@1': '按道路和国界算路程' },
      description: '点两个点,按地形算要走几天',
      license: 'MIT',
      author: { name: '示例作者' },
    },
    files: { 'main.js': CODE, 'README.md': README, LICENSE, 'icon.png': iconPng() },
  };
}

let good: Promise<Uint8Array> | undefined;
/** 好样本打成的文件 */
export const goodPlugin = (): Promise<Uint8Array> => (good ??= packPluginFile(goodInput()));

const SIM_CODE = `// 魔力:每州一个魔力浓度,浓的州城的人口上限高
civAtlas.sim({
  act(turn) {
    const m = turn.table('magic');
    const cap = turn.influence('city.capacity');
    const k = civAtlas.params.strength;
    for (let r = 0; r < cap.length; r++) cap[r] = 1 + (k * m[r]) / 100;
    return { influences: { 'city.capacity': cap } };
  },
});
`;

/** 推演插件的好样本:sim 段每一项都有,不带图标 */
export function goodSimInput(): PluginPackInput {
  return {
    manifest: {
      id: 'magic',
      name: '魔力',
      version: '1.0.0',
      role: 'sim',
      api: 1,
      runtime: 'quickjs',
      requires: ['sim.read@1', 'sim.tables@1', 'sim.events@1', 'sim.influence@1', 'sim.commands@1', 'sim.chronicle@1'],
      why: { 'sim.influence@1': '魔力浓的州,城的人口上限高' },
      sim: {
        every: 5,
        tables: [
          { id: 'magic', name: '魔力', unit: 'region', every: 5, min: 0, max: 100, init: '10', off: 0, rate: '0.1 * (nbmean(nb.magic) - magic)' },
          { id: 'unrest_in', name: '动荡', unit: 'polity', input: true, min: -100, max: 100, off: 0 },
          { id: 'awe', name: '敬畏', unit: 'polity', every: 10, min: 0, max: 1, init: 0, off: 0, rate: '0.01 * (1 - awe) - 0.001 * unrest_in' },
        ],
        inputs: { unrest_in: 'unrest' },
        listen: ['fall', 'plague'],
        layers: [{ id: 'magic', table: 'magic', title: '魔力浓度', ramp: { colors: ['#1b1036', '#a46cff'] }, keep: 50 }],
        influences: ['city.capacity'],
        commands: ['declare', 'ally'],
        params: { strength: { label: '魔力的影响', min: 0, max: 3, default: 1, step: 0.5 } },
      },
      description: '每州一个魔力浓度,浓的州城的人口上限高',
      license: 'MIT',
      author: { name: '示例作者' },
    },
    files: { 'main.js': SIM_CODE, 'README.md': '# 魔力\n\n每州一个魔力浓度,往邻州扩散;魔力浓的州,城的人口上限高。\n', LICENSE },
  };
}

let goodSim: Promise<Uint8Array> | undefined;
export const goodSimPlugin = (): Promise<Uint8Array> => (goodSim ??= packPluginFile(goodSimInput()));

const MAP_CODE = `// 柯本气候:季风强的地方夏天多下雨,再按气温和降水分类
civAtlas.map({
  climate(d) {
    const p = d.precipitation.slice();
    const k = civAtlas.params.monsoon;
    for (let i = 0; i < p.length; i++) p[i] *= 1 + 0.1 * k * (d.rainSummer[i] - d.rainWinter[i]);
    return { precipitation: p };
  },
  layers(d) {
    const cls = new Float32Array(d.n).fill(NaN);
    for (let i = 0; i < d.n; i++) if (d.water[i] === 0) cls[i] = d.temperature[i] > 18 ? 0 : 1;
    return { layers: { koppen: cls } };
  },
});
`;

/** 地图插件的好样本:map 段每一项都有,不带图标 */
export function goodMapInput(): PluginPackInput {
  return {
    manifest: {
      id: 'koppen',
      name: '柯本气候',
      version: '1.0.0',
      role: 'map',
      api: 1,
      runtime: 'quickjs',
      requires: ['gen.climate@1', 'gen.layers@1'],
      why: { 'gen.climate@1': '季风强的地方夏天多下雨', 'gen.layers@1': '画出柯本气候分类' },
      map: {
        stages: ['climate', 'layers'],
        layers: [
          {
            id: 'koppen',
            title: '柯本气候',
            classes: [
              { value: 0, color: '#0000fe', label: 'Af 热带雨林' },
              { value: 1, color: '#ffcc00', label: 'BWh 热带沙漠' },
            ],
            legend: '柯本 - 盖格分类',
          },
        ],
        params: { monsoon: { label: '季风强弱', min: 0, max: 2, default: 1, step: 0.1 } },
      },
      description: '季风强的地方夏天多下雨,再画出柯本气候分类',
      license: 'MIT',
      author: { name: '示例作者' },
    },
    files: { 'main.js': MAP_CODE, 'README.md': '# 柯本气候\n\n按季风加强夏雨,再把气候分成柯本 - 盖格的类。\n', LICENSE },
  };
}

let goodMap: Promise<Uint8Array> | undefined;
export const goodMapPlugin = (): Promise<Uint8Array> => (goodMap ??= packPluginFile(goodMapInput()));

/** 拆开的好样本:清单(已解析)和各文件 */
export interface PluginParts {
  m: any;
  files: Map<string, Uint8Array>;
}

/** 清单的字节和各文件装成 ZIP,不经核对 */
export async function zipPlugin(manifest: Uint8Array | null, files: ReadonlyMap<string, Uint8Array>): Promise<Uint8Array> {
  const entries = [...(manifest ? [{ name: 'manifest.json', data: manifest }] : []), ...[...files].map(([name, data]) => ({ name, data }))];
  return new Uint8Array(await (await writeZip(entries, 1e9)).arrayBuffer());
}

/** 拆开好样本(from 不给 = 工具插件那个),改一改再装回去(清单照常写成 JSON;要写不合格的清单,change 返回清单的字节) */
export async function variant(change: (p: PluginParts) => void | Uint8Array | null | Promise<void | Uint8Array | null>, from = goodPlugin): Promise<Uint8Array> {
  const entries = parseZip(await from(), PLUGIN_MAX_BYTES);
  const p: PluginParts = { m: JSON.parse(new TextDecoder().decode(entries[0].data)), files: new Map(entries.slice(1).map((e) => [e.name, e.data])) };
  const out = await change(p);
  return zipPlugin(out === undefined ? text(`${JSON.stringify(p.m, null, 2)}\n`) : out, p.files);
}

/** 换掉(或加上)一个文件,清单里的指纹、大小跟着改:只让这个文件本身不对 */
export function put(p: PluginParts, path: string, data: Uint8Array): void {
  p.files.set(path, data);
  const info = { path, sum: sha(data), bytes: data.length };
  const i = p.m.files.findIndex((f: any) => f.path === path);
  if (i >= 0) p.m.files[i] = info;
  else p.m.files.push(info);
}

/** 去掉一个文件,清单里也去掉 */
function drop(p: PluginParts, path: string): void {
  p.files.delete(path);
  p.m.files = p.m.files.filter((f: any) => f.path !== path);
}

export interface PluginSample {
  /** 文件名(不带后缀) */
  name: string;
  kind: PluginFileErrorKind;
  /** 错在哪 */
  why: string;
  /** 报错的话里有这几个字:错是错在了该错的地方,不是前面别的检查拦下的 */
  says: string;
  build: () => Promise<Uint8Array>;
  /** 太大,不进仓库 */
  big?: true;
}

const field = (name: string, kind: PluginFileErrorKind, why: string, says: string, change: (m: any) => void): PluginSample => ({ name, kind, why, says, build: () => variant(({ m }) => void change(m)) });
/** 改地图插件好样本的清单 */
const map = (name: string, kind: PluginFileErrorKind, why: string, says: string, change: (m: any) => void): PluginSample => ({ name, kind, why, says, build: () => variant(({ m }) => void change(m), goodMapPlugin) });
/** 改推演插件好样本的清单 */
const sim = (name: string, kind: PluginFileErrorKind, why: string, says: string, change: (m: any) => void): PluginSample => ({ name, kind, why, says, build: () => variant(({ m }) => void change(m), goodSimPlugin) });

export const PLUGIN_SAMPLES: readonly PluginSample[] = [
  // 外壳
  { name: 'not-zip', kind: 'broken', why: '不是 ZIP', says: 'ZIP', build: async () => text('这不是插件') },
  {
    name: 'zip-bad-crc',
    kind: 'broken',
    why: 'ZIP 里一个文件的字节被改过,对不上 CRC',
    says: '对不上校验',
    build: async () => {
      const b = (await goodPlugin()).slice();
      const at = Buffer.from(b).indexOf('civAtlas.onCall');
      b[at] ^= 0x20;
      return b;
    },
  },
  {
    name: 'too-many-entries',
    kind: 'broken',
    why: 'ZIP 里超过 16 个条目',
    says: '东西太多',
    build: () => variant((p) => void Array.from({ length: 13 }, (_, i) => p.files.set(`x${i}.txt`, text('x')))),
  },
  { name: 'no-manifest', kind: 'broken', why: '没有 manifest.json', says: '没有清单', build: () => variant(() => null) },
  { name: 'extra-file', kind: 'broken', why: 'ZIP 里有清单没列的文件', says: '多了清单没列的 notes.txt', build: () => variant((p) => void p.files.set('notes.txt', text('x'))) },
  { name: 'missing-file', kind: 'broken', why: '清单列了、ZIP 里没有', says: '缺 icon.png', build: () => variant((p) => void p.files.delete('icon.png')) },
  { name: 'unknown-path', kind: 'broken', why: '不认得的文件路径', says: '不能有 lib/util.js', build: () => variant((p) => put(p, 'lib/util.js', text('export {};\n'))) },
  { name: 'nested-zip', kind: 'broken', why: '里面套 ZIP', says: '不能有 inner.zip', build: () => variant(async (p) => put(p, 'inner.zip', await goodPlugin())) },
  { name: 'sum-mismatch', kind: 'broken', why: '文件和清单里的指纹对不上', says: 'main.js 和清单对不上', build: () => variant((p) => void p.files.set('main.js', text('civAtlas.onCall(() => 1);\n'))) },
  { name: 'bytes-mismatch', kind: 'broken', why: '清单里写的大小不对', says: 'main.js 和清单对不上', build: () => variant(({ m }) => void (m.files[0].bytes += 1)) },
  { name: 'duplicate-file', kind: 'broken', why: '清单里同一个文件写了两遍', says: 'README.md 写了两遍', build: () => variant(({ m }) => void m.files.push({ ...m.files[1] })) },
  { name: 'no-license', kind: 'broken', why: '缺 LICENSE', says: '缺 LICENSE', build: () => variant((p) => drop(p, 'LICENSE')) },
  { name: 'no-readme', kind: 'broken', why: '缺 README.md', says: '缺 README.md', build: () => variant((p) => drop(p, 'README.md')) },
  { name: 'no-code', kind: 'broken', why: '缺 main.js', says: '缺 main.js', build: () => variant((p) => drop(p, 'main.js')) },
  // 清单本身
  { name: 'manifest-not-json', kind: 'broken', why: '清单不是 JSON', says: '不是合格的 JSON', build: () => variant(() => text('{"app": "文明与地图",')) },
  { name: 'manifest-not-utf8', kind: 'broken', why: '清单不是 UTF-8', says: '不是合格的 JSON', build: () => variant(() => new Uint8Array([0x7b, 0xff, 0xfe, 0x7d])) },
  { name: 'manifest-not-object', kind: 'broken', why: '清单不是对象', says: '不是对象', build: () => variant(() => text('[]')) },
  { name: 'manifest-too-deep', kind: 'broken', why: '清单的结构层数太多', says: '层数太多', build: () => variant(({ m }) => void (m.extra = [[[[[[[[[1]]]]]]]]])) },
  { name: 'manifest-bad-key', kind: 'broken', why: '清单里有 constructor 这种键', says: '不许用的键 constructor', build: () => variant(({ m }) => void (m.author.constructor = 'x')) },
  // 清单的各字段
  field('wrong-app', 'broken', 'app 不是「文明与地图」', '不是「文明与地图」', (m) => (m.app = 'other')),
  field('format-bad', 'broken', 'format 不是正整数', 'format', (m) => (m.format = 0)),
  field('format-newer', 'newer', 'format 比网站新', '第 2 版格式', (m) => (m.format = 2)),
  field('world-file', 'broken', 'kind 是 world:世界文件改了后缀', '世界文件', (m) => (m.kind = 'world')),
  field('kind-bad', 'broken', 'kind 不合规矩', 'kind', (m) => (m.kind = 'Plug In')),
  field('kind-newer', 'newer', 'kind 这一版网站不认得', 'theme', (m) => (m.kind = 'theme')),
  field('api-bad', 'broken', 'api 不是正整数', 'api', (m) => (m.api = '1')),
  field('api-newer', 'newer', '接口版本比网站新', '第 2 版接口', (m) => (m.api = 2)),
  field('id-bad', 'broken', 'id 不合规矩(大写、下划线)', 'id', (m) => (m.id = 'Route_Measure')),
  field('id-too-long', 'broken', 'id 太长', 'id', (m) => (m.id = 'a'.repeat(33))),
  field('name-empty', 'broken', 'name 空着', 'name 不能空着', (m) => (m.name = '  ')),
  field('name-too-long', 'broken', 'name 太长', 'name 太长', (m) => (m.name = '量'.repeat(41))),
  field('name-bidi', 'broken', 'name 里有改写显示方向的字符', 'name 里有不许用的字符', (m) => (m.name = '量路程‮')),
  field('version-bad', 'broken', 'version 不是 主.次.补丁', 'version', (m) => (m.version = 'v1')),
  field('role-bad', 'broken', 'role 不合规矩', 'role', (m) => (m.role = '')),
  field('role-newer', 'newer', 'role 是这一版网站跑不了的(没有这种插件)', 'dream', (m) => (m.role = 'dream')),
  field('runtime-bad', 'broken', 'runtime 不合规矩', 'runtime', (m) => (m.runtime = 42)),
  field('runtime-newer', 'newer', 'runtime 是这一版网站没有的', 'wasm', (m) => (m.runtime = 'wasm')),
  field('runtime-wrong', 'broken', '工具插件的 runtime 写成推演插件的 quickjs', '工具插件要写 worker', (m) => (m.runtime = 'quickjs')),
  field('tool-sim-cap', 'broken', '工具插件要了推演插件的能力', '工具插件不能要 sim.read@1', (m) => m.requires.push('sim.read@1')),
  field('tool-sim-section', 'broken', '工具插件的清单里有 sim 段', '工具插件的清单不能有 sim 段', (m) => (m.sim = {})),
  field('tool-map-cap', 'broken', '工具插件要了地图插件的能力', '工具插件不能要 gen.climate@1', (m) => m.requires.push('gen.climate@1')),
  field('tool-map-section', 'broken', '工具插件的清单里有 map 段', '工具插件的清单不能有 map 段', (m) => (m.map = { stages: ['climate'] })),
  field('requires-not-list', 'broken', 'requires 不是列表', 'requires 不是列表', (m) => (m.requires = 'world.read@1')),
  field('cap-bad', 'broken', '能力名不合规矩(没写版本)', 'requires[5]', (m) => m.requires.push('world.read')),
  field('cap-twice', 'broken', '同一样能力写了两遍', 'requires 里 world.read@1 写了两遍', (m) => m.requires.push('world.read@1')),
  field('cap-both', 'broken', '同一样能力既在 requires 又在 optional', 'optional 里 world.read@1 写了两遍', (m) => m.optional.push('world.read@1')),
  field('cap-too-many', 'broken', '要的能力太多', '能力太多', (m) => (m.optional = Array.from({ length: 30 }, (_, i) => `x.y${i}@1`))),
  field('cap-unknown', 'newer', 'requires 里有这一版网站没有的能力', 'sim.run@1', (m) => m.requires.push('sim.run@1')),
  field('cap-higher', 'newer', 'requires 里能力的版本比网站新', 'world.read@2', (m) => (m.requires[0] = 'world.read@2')),
  field('optional-bad', 'broken', 'optional 里的能力名不合规矩', 'optional[0]', (m) => (m.optional = ['Layer.Cells@1'])),
  field('why-unknown', 'broken', 'why 里写了没要的能力', 'author.read@1 不在要的能力里', (m) => (m.why['author.read@1'] = '看笔记')),
  field('why-too-long', 'broken', 'why 的理由太长', 'why.history.read@1 太长', (m) => (m.why['history.read@1'] = '路'.repeat(101))),
  field('entry-bad', 'broken', 'entry 不是 main.js', 'entry', (m) => (m.entry = 'index.js')),
  field('files-not-list', 'broken', 'files 不是列表', 'files 不是列表', (m) => (m.files = {})),
  field('file-sum-bad', 'broken', 'files 里的指纹不是 SHA-256', 'files[0].sum', (m) => (m.files[0].sum = 'abc')),
  field('description-too-long', 'broken', 'description 太长', 'description 太长', (m) => (m.description = '路'.repeat(201))),
  field('description-control', 'broken', 'description 里有控制字符', 'description 里有不许用的字符', (m) => (m.description = '第一行\n第二行')),
  field('license-bad', 'broken', 'license 不合规矩', 'license', (m) => (m.license = '')),
  field('author-bad', 'broken', 'author 不是对象', 'author 不是对象', (m) => (m.author = '示例作者')),
  field('author-name-empty', 'broken', 'author.name 空着', 'author.name', (m) => (m.author = {})),
  // 推演插件:种类、跑法、能力配不配
  sim('sim-runtime-wrong', 'broken', '推演插件的 runtime 写成 worker', '推演插件要写 quickjs', (m) => (m.runtime = 'worker')),
  sim('sim-tool-cap', 'broken', '推演插件要了工具插件的能力', '推演插件不能要 world.read@1', (m) => (m.optional = ['world.read@1'])),
  sim('sim-no-section', 'broken', '推演插件的清单没有 sim 段', '要有 sim 段', (m) => delete m.sim),
  sim('sim-not-object', 'broken', 'sim 段不是对象', 'sim 不是对象', (m) => (m.sim = [])),
  sim('sim-cap-newer', 'newer', '要的推演能力版本比网站新(sim 段用到它也不算没要)', 'sim.influence@2', (m) => (m.requires[3] = 'sim.influence@2', delete m.why)),
  // 推演插件:sim 段和 requires 对不对得上
  sim('sim-every-no-cap', 'broken', '写了 every,requires 里没有 sim.events@1', 'sim.every 要在 requires 里写上 sim.events@1', (m) => m.requires.splice(2, 1)),
  sim('sim-influence-no-cap', 'broken', '写了 influences,requires 里没有 sim.influence@1', 'sim.influences 要在 requires 里写上 sim.influence@1', (m) => (m.requires.splice(3, 1), delete m.why)),
  sim('sim-commands-no-cap', 'broken', '写了会下哪几种命令,requires 里没有 sim.commands@1', 'sim.commands 要在 requires 里写上 sim.commands@1', (m) => m.requires.splice(4, 1)),
  sim('sim-commands-missing', 'broken', '要了 sim.commands@1,没写会下哪几种命令', '要在 sim.commands 里写会下哪几种命令', (m) => delete m.sim.commands),
  // 推演插件:sim 段各项
  sim('sim-every-bad', 'broken', 'every 不在频率菜单里', 'sim.every 只能从', (m) => (m.sim.every = 3)),
  sim('sim-table-tile', 'broken', '表按地块记', 'sim.tables[0] 不能按地块记', (m) => (m.sim.tables[0].unit = 'tile')),
  sim('sim-table-owner', 'broken', '表叫「国」(按国记的表对州用的就是这个名字)', 'sim.tables[1].id 不能叫 国', (m) => (m.sim.tables[1].id = '国')),
  sim('sim-table-builtin', 'broken', '表写了 builtin(会跳过护栏)', 'sim.tables[0] 不能写 builtin', (m) => (m.sim.tables[0].builtin = true)),
  sim('sim-table-type', 'broken', '表的上限不是数', 'sim.tables[0].max 要是数', (m) => (m.sim.tables[0].max = '100')),
  sim('sim-table-formula', 'broken', '表的公式读了没有的表', 'mana', (m) => (m.sim.tables[0].rate = '0.1 * (nbmean(nb.mana) - magic)')),
  sim('sim-table-card', 'broken', '输入表写了规则(登记卡本身不对)', '是输入表,不能有规则', (m) => (m.sim.tables[1].rate = '0')),
  sim('sim-tables-too-many', 'broken', '表超过 16 张', 'sim.tables 最多 16 项', (m) => m.sim.tables.push(...Array.from({ length: 14 }, (_, i) => ({ id: `t${i}`, name: `表${i}`, unit: 'world', min: 0, max: 1, off: 0, rule: '0' })))),
  sim('sim-table-cols', 'broken', '表的栏加起来超过 64', '最多 64 栏', (m) => (m.sim.tables[2].cols = Array.from({ length: 63 }, (_, i) => `c${i}`))),
  sim('sim-inputs-not-input', 'broken', '接官方表的不是输入表', '接官方表的 magic 要是自己的一栏的输入表', (m) => (m.sim.inputs = { magic: 'rural' })),
  sim('sim-inputs-unit', 'broken', '按国的输入表接按州的官方表', 'unrest_in 和官方表 rural 的单位不一样', (m) => (m.sim.inputs.unrest_in = 'rural')),
  sim('sim-inputs-newer', 'newer', '接的官方表这一版网站没有', '官方表 pop.total', (m) => (m.sim.inputs.unrest_in = 'pop.total')),
  sim('sim-listen-twice', 'broken', 'listen 里同一种史事写了两遍', 'sim.listen 里 fall 写了两遍', (m) => m.sim.listen.push('fall')),
  sim('sim-listen-newer', 'newer', '要听的史事种类这一版网站没有', '史事种类 meteor', (m) => m.sim.listen.push('meteor')),
  sim('sim-layer-keep', 'broken', '图层 keep 不是 1 到 1000 的整数', 'keep 要是 1 到 1000 的整数', (m) => (m.sim.layers[0].keep = 0)),
  sim('sim-layer-table', 'broken', '图层标的是按国记的表', '要按州记数', (m) => (m.sim.layers[0].table = 'awe')),
  sim('sim-layer-look', 'broken', '图层没给颜色(ramp、classes 都没有)', 'ramp 和 classes 给且只给一个', (m) => delete m.sim.layers[0].ramp),
  sim('sim-influence-newer', 'newer', '交数的影响口这一版网站没有', '影响口 war.pair', (m) => m.sim.influences.push('war.pair')),
  sim('sim-command-newer', 'newer', '会下的命令这一版网站没有', '命令 tax', (m) => m.sim.commands.push('tax')),
  sim('sim-command-bad', 'broken', '命令的种类不合规矩', 'sim.commands[0] 不合规矩', (m) => (m.sim.commands[0] = 'Declare War')),
  sim('sim-params-too-many', 'broken', '滑条超过 8 个', 'sim.params 最多 8 个', (m) => Array.from({ length: 8 }, (_, i) => (m.sim.params[`p${i}`] = { label: `滑条${i}`, min: 0, max: 1, default: 0 }))),
  sim('sim-param-label', 'broken', '滑条名字超过 12 个字', 'sim.params.strength.label 太长', (m) => (m.sim.params.strength.label = '魔'.repeat(13))),
  sim('sim-param-default', 'broken', '滑条的默认值不在上下限里', 'sim.params.strength.default 要在 min 和 max 之间', (m) => (m.sim.params.strength.default = 4)),
  sim('sim-param-key', 'broken', '滑条的名字不能当变量名', '只能用字母、数字和下划线', (m) => (m.sim.params['1x'] = { label: '一', min: 0, max: 1, default: 0 })),
  sim('sim-map-section', 'broken', '推演插件的清单里有 map 段', '推演插件的清单不能有 map 段', (m) => (m.map = { stages: ['climate'] })),
  // 地图插件:种类、跑法、能力配不配
  map('map-runtime-wrong', 'broken', '地图插件的 runtime 写成 worker', '地图插件要写 quickjs', (m) => (m.runtime = 'worker')),
  map('map-tool-cap', 'broken', '地图插件要了工具插件的能力', '地图插件不能要 world.read@1', (m) => (m.optional = ['world.read@1'])),
  map('map-sim-cap', 'broken', '地图插件要了推演插件的能力', '地图插件不能要 sim.read@1', (m) => (m.optional = ['sim.read@1'])),
  map('map-no-section', 'broken', '地图插件的清单没有 map 段', '要有 map 段', (m) => delete m.map),
  map('map-not-object', 'broken', 'map 段不是对象', 'map 不是对象', (m) => (m.map = [])),
  map('map-cap-newer', 'newer', '要的地图能力版本比网站新', 'gen.climate@2', (m) => (m.requires[0] = 'gen.climate@2', delete m.why['gen.climate@1'])),
  map('map-stage-no-cap', 'broken', 'stages 里写了 climate,requires 里没有 gen.climate@1', 'map.stages 写了 climate,要在 requires 里写上 gen.climate@1', (m) => (m.requires.splice(0, 1), delete m.why['gen.climate@1'])),
  // 地图插件:map 段各项
  map('map-stages-missing', 'broken', 'map 段没写 stages', 'map.stages 不是列表', (m) => delete m.map.stages),
  map('map-stages-empty', 'broken', 'stages 是空的', 'map.stages 不能空着', (m) => (m.map.stages = [])),
  map('map-stages-twice', 'broken', 'stages 里同一步写了两遍', 'map.stages 里 climate 写了两遍', (m) => m.map.stages.push('climate')),
  map('map-stages-bad', 'broken', 'stages 里的名字不合规矩', 'map.stages[0] 不合规矩', (m) => (m.map.stages[0] = 'Climate')),
  map('map-stages-newer', 'newer', 'stages 里有这一版网站没有的一步', '生成的一步 rivers', (m) => m.map.stages.push('rivers')),
  map('map-stage-no-layers', 'broken', '写了 layers 这一步,没登记交哪几张图层', '要在 map.layers 里登记', (m) => delete m.map.layers),
  map('map-layers-no-stage', 'broken', '登记了图层,stages 里没有 layers', 'map.layers 要在 map.stages 里写上 layers', (m) => ((m.map.stages = ['climate']), (m.requires = ['gen.climate@1']), delete m.why['gen.layers@1'])),
  map('map-layers-too-many', 'broken', '图层超过 4 张', 'map.layers 最多 4 项', (m) => m.map.layers.push(...Array.from({ length: 4 }, (_, i) => ({ ...m.map.layers[0], id: `l${i}` })))),
  map('map-layer-twice', 'broken', '两张图层编号一样', '图层 koppen 写了两次', (m) => m.map.layers.push({ ...m.map.layers[0] })),
  map('map-layer-id', 'broken', '图层编号不合规矩', 'map.layers[0].id 只能用小写字母', (m) => (m.map.layers[0].id = 'Koppen')),
  map('map-layer-look', 'broken', '图层没给颜色(ramp、classes 都没有)', 'ramp 和 classes 给且只给一个', (m) => delete m.map.layers[0].classes),
  map('map-layer-title', 'broken', '图层标题太长', 'title 最多', (m) => (m.map.layers[0].title = '柯'.repeat(41))),
  map('map-params-too-many', 'broken', '滑条超过 8 个', 'map.params 最多 8 个', (m) => Array.from({ length: 8 }, (_, i) => (m.map.params[`p${i}`] = { label: `滑条${i}`, min: 0, max: 1, default: 0 }))),
  map('map-param-label', 'broken', '滑条名字超过 12 个字', 'map.params.monsoon.label 太长', (m) => (m.map.params.monsoon.label = '季'.repeat(13))),
  map('map-param-default', 'broken', '滑条的默认值不在上下限里', 'map.params.monsoon.default 要在 min 和 max 之间', (m) => (m.map.params.monsoon.default = 5)),
  map('map-param-key', 'broken', '滑条的名字不能当变量名', '只能用字母、数字和下划线', (m) => (m.map.params['1x'] = { label: '一', min: 0, max: 1, default: 0 })),
  // 各文件的内容
  { name: 'code-not-utf8', kind: 'broken', why: 'main.js 不是 UTF-8', says: 'main.js 不是 UTF-8', build: () => variant((p) => put(p, 'main.js', new Uint8Array([0x2f, 0x2f, 0xc3, 0x28]))) },
  { name: 'code-nul', kind: 'broken', why: 'main.js 里有 NUL(不是文字)', says: 'main.js 不是文字', build: () => variant((p) => put(p, 'main.js', text('civAtlas;\u0000\n'))) },
  { name: 'readme-not-utf8', kind: 'broken', why: 'README.md 不是 UTF-8', says: 'README.md 不是 UTF-8', build: () => variant((p) => put(p, 'README.md', new Uint8Array([0xff]))) },
  { name: 'icon-not-png', kind: 'broken', why: 'icon.png 不是 PNG', says: '不是 PNG', build: () => variant((p) => put(p, 'icon.png', text('<svg xmlns="http://www.w3.org/2000/svg"/>'))) },
  { name: 'icon-wrong-size', kind: 'broken', why: 'icon.png 不是 128×128', says: '128×128', build: () => variant((p) => put(p, 'icon.png', iconPng(64))) },
  // 太大的
  { name: 'too-big', kind: 'broken', why: '整个文件超过 2 MB', says: '插件文件太大', big: true, build: () => variant((p) => put(p, 'main.js', new Uint8Array(PLUGIN_MAX_BYTES).fill(0x20))) },
  { name: 'code-too-big', kind: 'broken', why: 'main.js 超过 1 MB', says: 'main.js 太大', big: true, build: () => variant((p) => put(p, 'main.js', new Uint8Array(1024 * 1024 + 1).fill(0x20))) },
  { name: 'readme-too-big', kind: 'broken', why: 'README.md 超过 64 KB', says: 'README.md 太大', big: true, build: () => variant((p) => put(p, 'README.md', new Uint8Array(64 * 1024 + 1).fill(0x20))) },
  { name: 'icon-too-big', kind: 'broken', why: 'icon.png 超过 64 KB', says: 'icon.png 太大', big: true, build: () => variant((p) => put(p, 'icon.png', new Uint8Array(64 * 1024 + 1))) },
  { name: 'manifest-too-big', kind: 'broken', why: '清单超过 64 KB', says: '清单太大', big: true, build: () => variant(({ m }) => void (m.padding = ' '.repeat(64 * 1024))) },
];
