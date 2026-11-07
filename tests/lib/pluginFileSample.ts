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

/** 拆开好样本,改一改再装回去(清单照常写成 JSON;要写不合格的清单,change 返回清单的字节) */
export async function variant(change: (p: PluginParts) => void | Uint8Array | null | Promise<void | Uint8Array | null>): Promise<Uint8Array> {
  const entries = parseZip(await goodPlugin(), PLUGIN_MAX_BYTES);
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
  field('role-newer', 'newer', 'role 是这一版网站跑不了的(推演插件)', 'sim', (m) => (m.role = 'sim')),
  field('runtime-bad', 'broken', 'runtime 不合规矩', 'runtime', (m) => (m.runtime = 42)),
  field('runtime-newer', 'newer', 'runtime 是这一版网站没有的', 'quickjs', (m) => (m.runtime = 'quickjs')),
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
