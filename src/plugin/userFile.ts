/**
 * 插件交来让用的人存的文件、请用的人选的文件:网站这边的检查。纯计算,不碰 DOM。
 */
import { argsOf, bad, over, PluginApiError } from './check';

export const SAVE_MAX = 2 * 1024 * 1024;
export const OPEN_MAX = 16 * 1024 * 1024;
export const FILE_NAME_MAX = 80;
export const ACCEPT_MAX = 16;

/** 能存的种类。网页、svg、脚本这类双击打开会跑代码的不收;图片要对得上文件头 */
const SAVE_TYPES: Readonly<Record<string, { mime: string; kind: string; text?: boolean; bom?: boolean; head?: (b: Uint8Array) => boolean }>> = {
  csv: { mime: 'text/csv', kind: '表格', text: true, bom: true },
  tsv: { mime: 'text/tab-separated-values', kind: '表格', text: true, bom: true },
  txt: { mime: 'text/plain', kind: '文字', text: true },
  json: { mime: 'application/json', kind: '数据', text: true },
  geojson: { mime: 'application/geo+json', kind: '地图数据', text: true },
  png: { mime: 'image/png', kind: '图片', head: (b) => starts(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) },
  jpg: { mime: 'image/jpeg', kind: '图片', head: (b) => starts(b, [0xff, 0xd8, 0xff]) },
  jpeg: { mime: 'image/jpeg', kind: '图片', head: (b) => starts(b, [0xff, 0xd8, 0xff]) },
  webp: { mime: 'image/webp', kind: '图片', head: (b) => starts(b, [0x52, 0x49, 0x46, 0x46]) && starts(b.subarray(8), [0x57, 0x45, 0x42, 0x50]) },
};

export const SAVE_EXTS: readonly string[] = Object.keys(SAVE_TYPES);

const starts = (b: Uint8Array, head: number[]) => b.length >= head.length && head.every((x, i) => b[i] === x);

/** 插件交来、查过的文件 */
export interface SaveOffer {
  name: string;
  /** 下载用的类型 */
  mime: string;
  /** 给人看的种类:表格、图片…… */
  kind: string;
  bytes: Uint8Array;
}

/** 请用的人选文件:只收哪几种扩展名(小写、不带点;空 = 都收)、最大多少字节 */
export interface OpenRequest {
  accept: string[];
  max: number;
}

/** 用的人选好交给插件的 */
export interface PickedFile {
  name: string;
  bytes: Uint8Array;
}

// eslint-disable-next-line no-control-regex
const NAME_STRIP = /[\u0000-\u001f\u007f-\u009f\u00ad\u061c\u180e\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff\ufff9-\ufffb<>:"|?*]/g;
const strip = (s: string) => s.replace(NAME_STRIP, '').replace(/[\ud800-\udbff][\udc00-\udfff]|[\ud800-\udfff]/g, (m) => (m.length === 2 ? m : ''));
const RESERVED = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/i;

/** 文件名只留最后一段,去掉控制字符、改书写方向和看不见的字、系统不许有的字,头尾的点和空白 */
export function cleanFileName(raw: string): string {
  const last = raw.slice(Math.max(raw.lastIndexOf('/'), raw.lastIndexOf('\\')) + 1);
  const s = strip(last)
    .replace(/\s+/g, ' ')
    .replace(/^[\s.]+|[\s.]+$/g, '');
  const dot = s.indexOf('.');
  return RESERVED.test(dot < 0 ? s : s.slice(0, dot)) ? `_${s}` : s;
}

/** 扩展名(小写,不带点);没有 = '' */
export function extOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot <= 0 ? '' : name.slice(dot + 1).toLowerCase();
}

/** file.save 的参数:{ name, content }。content 是字(只给文字类)或 Uint8Array / ArrayBuffer */
export function checkSaveFile(raw: unknown): SaveOffer {
  const a = argsOf(raw);
  if (typeof a.name !== 'string') return bad('name 要是字');
  const cleaned = cleanFileName(a.name);
  const ext = extOf(cleaned);
  const type = Object.prototype.hasOwnProperty.call(SAVE_TYPES, ext) ? SAVE_TYPES[ext] : null;
  if (!type) return bad(`不能存${ext ? ` .${ext} ` : '没有扩展名的'}文件,能存的只有 ${SAVE_EXTS.join('、')}`);
  const base = cleaned.slice(0, -ext.length - 1);
  if (!base) return bad('文件名只有扩展名');
  const name = `${base}.${ext}`;
  if ([...name].length > FILE_NAME_MAX) return over(`文件名最多 ${FILE_NAME_MAX} 个字`);
  let bytes: Uint8Array;
  const c = a.content;
  if (typeof c === 'string') {
    if (!type.text) return bad(`.${ext} 要交 Uint8Array`);
    if (c.length > SAVE_MAX) return over(`一个文件最多 ${SAVE_MAX / 1024 / 1024} MB`);
    const body = new TextEncoder().encode(c);
    if (type.bom) {
      bytes = new Uint8Array(body.length + 3);
      bytes.set([0xef, 0xbb, 0xbf]);
      bytes.set(body, 3);
    } else bytes = body;
  } else if (c instanceof Uint8Array) bytes = c;
  else if (c instanceof ArrayBuffer) bytes = new Uint8Array(c);
  else return bad('content 要是字、Uint8Array 或 ArrayBuffer');
  if (bytes.length > SAVE_MAX) return over(`一个文件最多 ${SAVE_MAX / 1024 / 1024} MB`);
  if (type.head && !type.head(bytes)) return bad(`content 不是 .${ext} 图片`);
  return { name, mime: type.mime, kind: type.kind, bytes };
}

/** file.open 的参数:{ accept?, max? } */
export function checkOpenFile(raw: unknown): OpenRequest {
  const a = argsOf(raw);
  const accept: string[] = [];
  if (a.accept !== undefined) {
    if (!Array.isArray(a.accept)) return bad('accept 要是数组');
    if (a.accept.length > ACCEPT_MAX) return over(`accept 最多 ${ACCEPT_MAX} 种`);
    for (const x of a.accept) {
      if (typeof x !== 'string' || !/^\.?[a-z0-9]{1,12}$/i.test(x)) return bad(`accept 里的 ${String(x).slice(0, 20)} 要写成扩展名,比如 "csv"`);
      const e = x.replace(/^\./, '').toLowerCase();
      if (!accept.includes(e)) accept.push(e);
    }
  }
  let max = OPEN_MAX;
  if (a.max !== undefined) {
    if (typeof a.max !== 'number' || !Number.isInteger(a.max) || a.max < 1) return bad('max 要是正整数(字节)');
    if (a.max > OPEN_MAX) return over(`max 最大 ${OPEN_MAX / 1024 / 1024} MB`);
    max = a.max;
  }
  return { accept, max };
}

/** 用的人选的文件这个请求收不收:种类不对 = type,太大 = big */
export function openRefusal(req: OpenRequest, name: string, size: number): 'type' | 'big' | null {
  if (req.accept.length && !req.accept.includes(extOf(name))) return 'type';
  return size > req.max ? 'big' : null;
}

/** 交给插件的:网站再对一遍(界面那边已经挡过) */
export function pickedOut(req: OpenRequest, f: PickedFile): PickedFile {
  if (!(f.bytes instanceof Uint8Array) || openRefusal(req, f.name, f.bytes.length)) throw new PluginApiError('failed', '选的文件不合这次的要求');
  return { name: strip(f.name).slice(0, 255), bytes: f.bytes };
}
