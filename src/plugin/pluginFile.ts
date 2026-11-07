/**
 * 插件文件(.civplugin):格式、打包、读和逐项核对。纯计算,不碰 DOM,网页、Worker、服务器(Node)共用一份。
 *
 * 文件是一个不压缩的 ZIP(zipStore.ts),里面只能有清单和清单 files 列出的文件,多一个、少一个都不认;路径只认 PLUGIN_FILES 里的:
 *
 *   manifest.json   清单(UTF-8 的 JSON,字段见 PluginManifest)
 *   main.js         插件代码,只有这一个文件
 *   README.md       说明(当纯文字显示)
 *   LICENSE         许可证全文
 *   icon.png        图标(可选,128×128 的 PNG)
 *
 * 插件的指纹 = 整个文件字节的 SHA-256(世界清单里 plugins[].sum 记的就是它):文件要原样存、原样传,不能拆开重新打包。
 *
 * 读的时候出错一律抛 PluginFileError:broken 坏了;newer 文件本身是好的,要更新网站才能用。
 * 先查坏没坏、再查认不认得;只有格式、kind、接口版本比网站新时一看到就报 newer(那时别的字段可能都变了)。
 * 加新的文件种类、改字段的意思要升 format;加可选字段不升,这一版网站认不出的字段不管。
 */
import { MANIFEST_FILE, WORLD_APP, WORLD_KIND } from '../gen/worldFormat';
import { parseZip, writeZip, type ZipInput } from '../gen/zipStore';
import { CAP_NAME, PLUGIN_CAPS } from './pluginCaps';

export const PLUGIN_FILE_EXT = '.civplugin';
/** 清单里 kind 的值 */
export const PLUGIN_KIND = 'plugin';
/** 这一版网站读写的外壳和清单版本 */
export const PLUGIN_FORMAT = 1;
/** 这一版网站给插件的接口大版本 */
export const PLUGIN_API = 1;
/** 这一版网站跑得了的插件种类(role)、跑法(runtime) */
export const PLUGIN_ROLES: readonly string[] = ['tool'];
export const PLUGIN_RUNTIMES: readonly string[] = ['worker'];

const KIB = 1024;
/** 整个文件最多多少字节 */
export const PLUGIN_MAX_BYTES = 2 * KIB * KIB;
export const PLUGIN_MANIFEST_MAX_BYTES = 64 * KIB;
/** ZIP 里最多几个条目(连清单) */
export const PLUGIN_MAX_ENTRIES = 16;
/** 插件代码的路径,清单的 entry 只能是它 */
export const PLUGIN_ENTRY = 'main.js';
export const PLUGIN_ICON = 'icon.png';
/** 图标的边长 */
export const PLUGIN_ICON_SIZE = 128;

/** 清单以外认得的文件:max 字节数上限,need = 必须有;除了图标都是 UTF-8 的文字 */
export const PLUGIN_FILES: ReadonlyMap<string, { max: number; need: boolean }> = new Map([
  [PLUGIN_ENTRY, { max: 1024 * KIB, need: true }],
  ['README.md', { max: 64 * KIB, need: true }],
  ['LICENSE', { max: 64 * KIB, need: true }],
  [PLUGIN_ICON, { max: 64 * KIB, need: false }],
]);

export interface PluginFileInfo {
  path: string;
  /** 字节的 SHA-256(十六进制) */
  sum: string;
  bytes: number;
}

export interface PluginManifest {
  app: typeof WORLD_APP;
  kind: typeof PLUGIN_KIND;
  format: number;
  /** 插件编号:小写字母开头,小写字母、数字,中间可以有单个连字符;世界里的附加数据块按它起名 */
  id: string;
  /** 给人看的名字 */
  name: string;
  /** 第几版:主.次.补丁 */
  version: string;
  /** 种类:tool 工具;以后的推演插件 sim、地图生成插件 map */
  role: string;
  /** 用第几版接口 */
  api: number;
  /** 跑法:worker;以后要逐位一致的推演插件用 quickjs */
  runtime: string;
  /** 要的能力(「名字@大版本」),这一版网站没有其中任何一样就装不了 */
  requires: string[];
  /** 有就用、没有也能跑的能力 */
  optional?: string[];
  /** 能力 → 作者写的为什么要,显示在权限框那一行下面 */
  why?: Record<string, string>;
  entry: typeof PLUGIN_ENTRY;
  /** 除清单以外的每个文件 */
  files: PluginFileInfo[];
  /** 一句话说明 */
  description?: string;
  /** 许可证的名字(MIT、GPL-3.0-or-later 这类),全文在 LICENSE */
  license: string;
  /** 作者自己填的名字,只用来显示 */
  author?: { name: string };
}

export type PluginFileErrorKind = 'broken' | 'newer';

export class PluginFileError extends Error {
  readonly kind: PluginFileErrorKind;
  constructor(kind: PluginFileErrorKind, message: string) {
    super(message);
    this.name = 'PluginFileError';
    this.kind = kind;
  }
}

function broken(message: string): never {
  throw new PluginFileError('broken', message);
}

function newer(message: string): never {
  throw new PluginFileError('newer', message);
}

/** 底下的 ZIP、JSON 抛的普通错都算文件坏了 */
function asPluginFileError(err: unknown): PluginFileError {
  if (err instanceof PluginFileError) return err;
  return new PluginFileError('broken', err instanceof Error ? err.message : String(err));
}

type Obj = Record<string, unknown>;

const ID = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;
/** 编号最长几个字:世界里存下的插件图层块叫 layer.<编号>.<图层>,块名最长 64 */
const ID_MAX = 32;
const VERSION = /^(0|[1-9][0-9]{0,5})\.(0|[1-9][0-9]{0,5})\.(0|[1-9][0-9]{0,5})$/;
const SHORT_NAME = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const SUM = /^[0-9a-f]{64}$/;
/** SPDX 那种写法:MIT、Apache-2.0、MIT OR Apache-2.0 */
const LICENSE_NAME = /^[A-Za-z0-9][A-Za-z0-9.+() -]{0,63}$/;
/** 显示的字里不许有控制字符和改写显示方向的字符(能把字倒过来,冒充别的话) */
// eslint-disable-next-line no-control-regex
const BAD_TEXT = /[\u0000-\u001f\u007f‪-‮⁦-⁩]/;
const NAME_MAX = 40;
const DESCRIPTION_MAX = 200;
const WHY_MAX = 100;
/** requires 和 optional 加起来最多几项 */
const CAPS_MAX = 32;
/** 清单的结构最深几层(查字段时要递归) */
const DEPTH_MAX = 8;

const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);

function obj(v: unknown, at: string): Obj {
  if (!isObj(v)) broken(`${at} 不是对象`);
  return v;
}

function list(v: unknown, at: string): unknown[] {
  if (!Array.isArray(v)) broken(`${at} 不是列表`);
  return v;
}

function int(v: unknown, lo: number, hi: number, at: string): number {
  if (typeof v !== 'number' || !Number.isInteger(v) || v < lo || v > hi) broken(`${at} 不对`);
  return v;
}

function matches(v: unknown, re: RegExp, max: number, at: string): string {
  if (typeof v !== 'string' || v.length > max || !re.test(v)) broken(`${at} 不合规矩`);
  return v;
}

/** 给人看的一行字:不空、不超长,没有控制字符 */
function line(v: unknown, max: number, at: string): string {
  if (typeof v !== 'string' || !v.trim()) broken(`${at} 不能空着`);
  if (v.length > max) broken(`${at} 太长`);
  if (BAD_TEXT.test(v)) broken(`${at} 里有不许用的字符`);
  return v;
}

/** 结构的层数(还没 JSON.parse):字符串里的括号不算 */
function tooDeep(text: string): boolean {
  let depth = 0;
  let inString = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inString) {
      if (c === '\\') i++;
      else if (c === '"') inString = false;
    } else if (c === '"') inString = true;
    else if (c === '[' || c === '{') {
      if (++depth > DEPTH_MAX) return true;
    } else if (c === ']' || c === '}') depth--;
  }
  return false;
}

/** 不许当对象键的名字:读进来以后换掉对象的原型、盖掉谁都有的字段 */
function noBadKeys(v: unknown): void {
  if (Array.isArray(v)) v.forEach(noBadKeys);
  else if (v !== null && typeof v === 'object') {
    for (const k of Object.keys(v)) {
      if (k === '__proto__' || k === 'constructor' || k === 'prototype') broken(`清单里有不许用的键 ${k}`);
      noBadKeys((v as Obj)[k]);
    }
  }
}

function capList(v: unknown, at: string, seen: Set<string>): string[] {
  const caps = list(v, at);
  caps.forEach((c, i) => {
    matches(c, CAP_NAME, 64, `${at}[${i}]`);
    if (seen.has(c as string)) broken(`${at} 里 ${c} 写了两遍`);
    seen.add(c as string);
  });
  if (seen.size > CAPS_MAX) broken('要的能力太多');
  return caps as string[];
}

function checkFiles(v: unknown): void {
  const files = list(v, '清单的 files');
  if (files.length >= PLUGIN_MAX_ENTRIES) broken('清单的 files 太多');
  const paths = new Set<string>();
  files.forEach((raw, i) => {
    const at = `清单的 files[${i}]`;
    const f = obj(raw, at);
    if (typeof f.path !== 'string' || !PLUGIN_FILES.has(f.path)) broken(`插件文件里不能有 ${String(f.path).slice(0, 64)}`);
    if (paths.has(f.path)) broken(`清单里 ${f.path} 写了两遍`);
    paths.add(f.path);
    matches(f.sum, SUM, 64, `${at}.sum`);
    if (typeof f.bytes !== 'number' || !Number.isInteger(f.bytes) || f.bytes < 0) broken(`${at}.bytes 不对`);
    if (f.bytes > PLUGIN_FILES.get(f.path)!.max) broken(`${f.path} 太大`);
  });
  for (const [path, rule] of PLUGIN_FILES) if (rule.need && !paths.has(path)) broken(`插件文件里缺 ${path}`);
}

/** 只查格式;种类、跑法、能力这一版网站有没有,在 checkSupport 查 */
function parseManifest(bytes: Uint8Array): PluginManifest {
  if (bytes.length > PLUGIN_MANIFEST_MAX_BYTES) broken('清单太大');
  let raw: unknown;
  try {
    const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
    if (tooDeep(text)) broken('清单的结构层数太多');
    raw = JSON.parse(text);
  } catch (err) {
    if (err instanceof PluginFileError) throw err;
    broken('清单不是合格的 JSON');
  }
  const m = obj(raw, '清单');
  noBadKeys(m);
  if (m.app !== WORLD_APP) broken('这不是「文明与地图」的插件');
  const format = int(m.format, 1, Number.MAX_SAFE_INTEGER, '清单的 format');
  if (format > PLUGIN_FORMAT) newer(`要更新网站才能用:插件文件是第 ${format} 版格式`);
  if (m.kind === WORLD_KIND) broken('这是世界文件,不是插件');
  matches(m.kind, SHORT_NAME, 64, '清单的 kind');
  if (m.kind !== PLUGIN_KIND) newer(`要更新网站才能用:这一版网站不认得「${m.kind}」这种文件`);
  const api = int(m.api, 1, Number.MAX_SAFE_INTEGER, '清单的 api');
  if (api > PLUGIN_API) newer(`要更新网站才能用:插件用的是第 ${api} 版接口`);

  matches(m.id, ID, ID_MAX, '清单的 id');
  line(m.name, NAME_MAX, '清单的 name');
  matches(m.version, VERSION, 20, '清单的 version');
  matches(m.role, SHORT_NAME, 64, '清单的 role');
  matches(m.runtime, SHORT_NAME, 64, '清单的 runtime');
  const seen = new Set<string>();
  capList(m.requires, '清单的 requires', seen);
  if (m.optional !== undefined) capList(m.optional, '清单的 optional', seen);
  if (m.why !== undefined) {
    const why = obj(m.why, '清单的 why');
    for (const k of Object.keys(why)) {
      if (!seen.has(k)) broken(`清单的 why 里的 ${k} 不在要的能力里`);
      line(why[k], WHY_MAX, `清单的 why.${k}`);
    }
  }
  if (m.entry !== PLUGIN_ENTRY) broken(`清单的 entry 只能是 ${PLUGIN_ENTRY}`);
  checkFiles(m.files);
  if (m.description !== undefined) line(m.description, DESCRIPTION_MAX, '清单的 description');
  matches(m.license, LICENSE_NAME, 64, '清单的 license');
  if (m.author !== undefined) line(obj(m.author, '清单的 author').name, NAME_MAX, '清单的 author.name');
  return m as unknown as PluginManifest;
}

function checkSupport(m: PluginManifest): void {
  if (!PLUGIN_ROLES.includes(m.role)) newer(`要更新网站才能用:这一版网站跑不了「${m.role}」这种插件`);
  if (!PLUGIN_RUNTIMES.includes(m.runtime)) newer(`要更新网站才能用:这一版网站没有「${m.runtime}」这种跑法`);
  for (const c of m.requires) if (!PLUGIN_CAPS.has(c)) newer(`要更新网站才能用:插件要的 ${c} 这一版网站还没有`);
}

async function sha256(data: Uint8Array): Promise<string> {
  const h = new Uint8Array(await crypto.subtle.digest('SHA-256', data));
  let s = '';
  for (const b of h) s += b.toString(16).padStart(2, '0');
  return s;
}

function textOf(data: Uint8Array, path: string): string {
  let s = '';
  try {
    s = new TextDecoder('utf-8', { fatal: true }).decode(data);
  } catch {
    broken(`${path} 不是 UTF-8 的文字`);
  }
  if (s.includes('\u0000')) broken(`${path} 不是文字`);
  return s;
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const PNG_IHDR = 0x49484452;

/** 只看 PNG 的开头和尺寸;画不出来的图浏览器自己不显示,碍不着别的 */
function checkIcon(data: Uint8Array): void {
  if (data.length < 24 || PNG_SIGNATURE.some((b, i) => data[i] !== b)) broken(`${PLUGIN_ICON} 不是 PNG`);
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  if (dv.getUint32(8) !== 13 || dv.getUint32(12) !== PNG_IHDR) broken(`${PLUGIN_ICON} 不是 PNG`);
  if (dv.getUint32(16) !== PLUGIN_ICON_SIZE || dv.getUint32(20) !== PLUGIN_ICON_SIZE) broken(`${PLUGIN_ICON} 要 ${PLUGIN_ICON_SIZE}×${PLUGIN_ICON_SIZE}`);
}

export interface OpenedPlugin {
  manifest: PluginManifest;
  /** 整个文件的 SHA-256:插件的指纹 */
  sum: string;
  bytes: number;
  /** 路径 → 字节(清单以外的各文件,和传进来的字节共用) */
  files: ReadonlyMap<string, Uint8Array>;
  /** 插件代码 */
  code: string;
}

/** 打开、核对插件文件。坏的抛 PluginFileError(broken),要新网站的抛 PluginFileError(newer) */
export async function openPluginFile(file: Blob | Uint8Array): Promise<OpenedPlugin> {
  try {
    if ((file instanceof Blob ? file.size : file.length) > PLUGIN_MAX_BYTES) broken('插件文件太大');
    const bytes = file instanceof Blob ? new Uint8Array(await file.arrayBuffer()) : file;
    const entries = parseZip(bytes, PLUGIN_MAX_BYTES);
    if (entries.length > PLUGIN_MAX_ENTRIES) broken('插件文件里的东西太多');
    const inZip = new Map(entries.map((e) => [e.name, e.data]));
    const manifestBytes = inZip.get(MANIFEST_FILE);
    if (!manifestBytes) broken('插件文件里没有清单');
    const manifest = parseManifest(manifestBytes);
    const files = new Map<string, Uint8Array>();
    for (const f of manifest.files) {
      const data = inZip.get(f.path);
      if (!data) broken(`插件文件里缺 ${f.path}`);
      if (data.length !== f.bytes || (await sha256(data)) !== f.sum) broken(`${f.path} 和清单对不上`);
      files.set(f.path, data);
    }
    for (const name of inZip.keys()) if (name !== MANIFEST_FILE && !files.has(name)) broken(`插件文件里多了清单没列的 ${name}`);
    let code = '';
    for (const [path, data] of files) {
      if (path === PLUGIN_ICON) checkIcon(data);
      else if (path === PLUGIN_ENTRY) code = textOf(data, path);
      else textOf(data, path);
    }
    checkSupport(manifest);
    return { manifest, sum: await sha256(bytes), bytes: bytes.length, files, code };
  } catch (err) {
    throw asPluginFileError(err);
  }
}

/** 打包要给的:清单里由打包填的几项以外的字段,和各文件(路径 → 内容,字符串按 UTF-8 存) */
export interface PluginPackInput {
  manifest: Omit<PluginManifest, 'app' | 'kind' | 'format' | 'entry' | 'files'>;
  files: Readonly<Record<string, Uint8Array | string>>;
}

/** 打成插件文件。字段、文件的先后固定,同样的内容打出同样的字节;打出来先照读的规矩核对一遍,读不回来的抛错 */
export async function packPluginFile(input: PluginPackInput): Promise<Uint8Array> {
  try {
    for (const path of Object.keys(input.files)) if (!PLUGIN_FILES.has(path)) broken(`插件文件里不能有 ${path}`);
    const enc = new TextEncoder();
    const entries: ZipInput[] = [];
    const files: PluginFileInfo[] = [];
    for (const path of PLUGIN_FILES.keys()) {
      const v = Object.prototype.hasOwnProperty.call(input.files, path) ? input.files[path] : undefined;
      if (v === undefined) continue;
      const data = typeof v === 'string' ? enc.encode(v) : v;
      files.push({ path, sum: await sha256(data), bytes: data.length });
      entries.push({ name: path, data });
    }
    const m = input.manifest;
    const manifest: PluginManifest = {
      app: WORLD_APP,
      kind: PLUGIN_KIND,
      format: PLUGIN_FORMAT,
      id: m.id,
      name: m.name,
      version: m.version,
      role: m.role,
      api: m.api,
      runtime: m.runtime,
      requires: m.requires,
      ...(m.optional ? { optional: m.optional } : {}),
      ...(m.why ? { why: m.why } : {}),
      entry: PLUGIN_ENTRY,
      files,
      ...(m.description !== undefined ? { description: m.description } : {}),
      license: m.license,
      ...(m.author ? { author: m.author } : {}),
    };
    const head = enc.encode(`${JSON.stringify(manifest, null, 2)}\n`);
    const zip = await writeZip([{ name: MANIFEST_FILE, data: head }, ...entries], PLUGIN_MAX_BYTES);
    const bytes = new Uint8Array(await zip.arrayBuffer());
    await openPluginFile(bytes);
    return bytes;
  } catch (err) {
    throw asPluginFileError(err);
  }
}
