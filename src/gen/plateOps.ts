/**
 * 板块改动(PlateOp、照图分的 PlateImage,合起来是草图里的 plates)的格式、上限,存档里读出来时的整理(clean…)、比较,
 * 面板上写的罗盘方向、漂移快慢。改动是什么意思见 plateEdits.ts 的文件头;生成时怎么套上也在那边。
 * 和它分开放:读存档(首页上也要读)只用得到这里的,不用跟着下载生成地形用的几何。纯计算,不碰 DOM。
 */
import { round24 } from './civ/engine/rand';
import { clamp } from './util';
import { TERRAIN_H, nearLon, wrapLon } from './terrainOps';
import { SKETCH_IMAGE_NAME_MAX, decodeLayer } from './sketch';

/** 板块的一处改动 */
export type PlateOp =
  | { kind: 'set'; pts: number[]; dir?: number; speed?: number; crust?: PlateCrust }
  | { kind: 'cut'; pts: number[] }
  | { kind: 'merge'; pts: number[] };

/** 地壳:陆壳 / 洋壳 */
export type PlateCrust = 'continental' | 'oceanic';

/** 照一张图分的板块:图片的文件名(只用来显示)+ 认出来的分块格子图(编码同草图的 SketchImage.cells) */
export interface PlateImage {
  name: string;
  cells: string;
}

export interface PlateEdit {
  /** 改动,按先后 */
  ops: PlateOp[];
  /** 照一张图分的板块(最先套上) */
  image?: PlateImage;
  /** false = 板块相撞时不造山(只长草图画的山);不给 = 造山 */
  orogeny?: false;
}

/** 最多多少处改动、切开的线最多几个点 */
export const PLATE_MAX_OPS = 300;
export const PLATE_MAX_PTS = 400;
/** 漂移速度:生成里的速度 1 = 每年这么多厘米(随机分的板块是 0.3–1,也就是每年 2–8 厘米) */
export const PLATE_CM = 8;
/** 照图分最多分几块(和新建世界的板块数上限一样) */
export const PLATE_IMAGE_MAX = 60;
/** 能改到的速度范围(每年厘米) */
export const PLATE_SPEED: readonly [number, number] = [0, 16];

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** 清理点:x 照改地形的折线(第一个点取模,之后挪到离上一个点最近的那一圈),y 夹在两极之间,都取整;坐标不是有限数 = null */
function cleanPts(raw: unknown, min: number, max: number): number[] | null {
  if (!Array.isArray(raw) || raw.length < min * 2) return null;
  const take = Math.min(raw.length, max * 2) & ~1;
  const pts: number[] = [];
  for (let i = 0; i < take; i += 2) {
    const px = num(raw[i]);
    const py = num(raw[i + 1]);
    if (px === null || py === null) return null;
    pts.push(i ? nearLon(px, pts[i - 2]) : wrapLon(px), Math.round(clamp(py, 0, TERRAIN_H)));
  }
  return pts;
}

/**
 * 清理一处改动:种类不认识、点不对的 = null。set 只有一个点(多的不要),dir 取整到 [0, 360),speed 夹到 PLATE_SPEED 取到半厘米,
 * crust 只认陆壳 / 洋壳,三样一样也没有 = null;merge 正好两个点;cut 至少两个点,最多 PLATE_MAX_PTS 个。本来就合格的原样返回
 */
export function cleanPlateOp(x: unknown): PlateOp | null {
  if (!x || typeof x !== 'object') return null;
  const o = x as Record<string, unknown>;
  let out: PlateOp;
  if (o.kind === 'set') {
    const pts = cleanPts(o.pts, 1, 1);
    if (!pts) return null;
    const d = num(o.dir);
    const s = num(o.speed);
    const crust = o.crust === 'continental' || o.crust === 'oceanic' ? o.crust : undefined;
    const set: PlateOp = { kind: 'set', pts };
    if (d !== null) set.dir = ((Math.round(d) % 360) + 360) % 360;
    if (s !== null) set.speed = Math.round(clamp(s, PLATE_SPEED[0], PLATE_SPEED[1]) * 2) / 2;
    if (crust) set.crust = crust;
    if (set.dir === undefined && set.speed === undefined && !set.crust) return null;
    out = set;
  } else if (o.kind === 'merge') {
    const pts = cleanPts(o.pts, 2, 2);
    if (!pts) return null;
    out = { kind: 'merge', pts };
  } else if (o.kind === 'cut') {
    const pts = cleanPts(o.pts, 2, PLATE_MAX_PTS);
    if (!pts) return null;
    out = { kind: 'cut', pts };
  } else return null;
  return JSON.stringify(out) === JSON.stringify(x) ? (x as PlateOp) : out;
}

/** 清理板块改动:改动逐处过 cleanPlateOp(不合格的丢掉,最多 PLATE_MAX_OPS 处);orogeny 只认 false。一处没有、又造山 = null。本来就合格的原样返回 */
export function cleanPlates(x: unknown): PlateEdit | null {
  if (!x || typeof x !== 'object') return null;
  const o = x as Record<string, unknown>;
  const list = Array.isArray(o.ops) ? (o.ops as unknown[]) : [];
  const ops: PlateOp[] = [];
  let same = list === o.ops && list.length <= PLATE_MAX_OPS;
  for (const v of list) {
    if (ops.length >= PLATE_MAX_OPS) break;
    const c = cleanPlateOp(v);
    if (c) ops.push(c);
    if (c !== v) same = false;
  }
  const off = o.orogeny === false;
  const image = o.image === undefined ? null : cleanPlateImage(o.image);
  if (!ops.length && !off && !image) return null;
  same = same && (image ? image === o.image : !('image' in o)) && Object.keys(o).length === 1 + (off ? 1 : 0) + (image ? 1 : 0);
  if (same) return x as PlateEdit;
  return { ops, ...(image ? { image } : {}), ...(off ? { orogeny: false as const } : {}) };
}

/** 清理照图分的格子:格子解不开、分出来不到两块、块号超过 PLATE_IMAGE_MAX 的 = null;名字去掉控制字符、截到 SKETCH_IMAGE_NAME_MAX 个字。本来就合格的原样返回 */
export function cleanPlateImage(x: unknown): PlateImage | null {
  if (!x || typeof x !== 'object') return null;
  const o = x as Record<string, unknown>;
  if (typeof o.cells !== 'string') return null;
  const layer = decodeLayer(o.cells, PLATE_IMAGE_MAX);
  if (!layer) return null;
  const seen = new Set<number>();
  for (const v of layer) if (v) seen.add(v);
  if (seen.size < 2) return null;
  // eslint-disable-next-line no-control-regex
  const name0 = typeof o.name === 'string' ? o.name.replace(/[\u0000-\u001f\u007f]/g, '').trim() : '';
  const name = [...name0].slice(0, SKETCH_IMAGE_NAME_MAX).join('');
  return name === o.name && Object.keys(o).length === 2 ? (x as PlateImage) : { name, cells: o.cells };
}

/** 照图分的格子分出几块 */
export function plateImageCount(img: PlateImage): number {
  const layer = decodeLayer(img.cells, PLATE_IMAGE_MAX);
  return layer ? new Set(layer.filter((v) => v > 0)).size : 0;
}

/** 两份板块改动是不是一样(都清理过;都没有也算一样) */
export function samePlates(a: PlateEdit | null | undefined, b: PlateEdit | null | undefined): boolean {
  if (a === b) return true;
  if (!a || !b) return !a && !b;
  return JSON.stringify(a) === JSON.stringify(b);
}

/** 罗盘方向:dir(度,0 = 北、90 = 东)→ 八个方向的名字 */
const COMPASS = ['北', '东北', '东', '东南', '南', '西南', '西', '西北'];
export function compassName(dir: number): string {
  return COMPASS[Math.round((((dir % 360) + 360) % 360) / 45) % 8];
}

/** 漂移速度(东、南分量,生成里的单位)→ 往哪边(度,0 = 北、90 = 东)、每年几厘米 */
export function driftOf(ve: number, vs: number): { dir: number; speed: number } {
  // 生成里也用它(只改了快慢、没改方向时取现在的方向):开方是精确舍入的,反正切舍入到 24 位,任何电脑上一样
  const speed = Math.sqrt(ve * ve + vs * vs) * PLATE_CM;
  const dir = speed > 0 ? ((((round24(Math.atan2(ve, -vs)) * 180) / Math.PI) % 360) + 360) % 360 : 0;
  return { dir, speed };
}

/** 面板、地图上写的一句:"每年 4 厘米，往东北"(取到半厘米,和拖箭头改的一样);不到半厘米 = "几乎不动" */
export function driftText(dir: number, speed: number): string {
  const cm = Math.round(speed * 2) / 2;
  return cm < 0.5 ? '几乎不动' : `每年 ${cm} 厘米，往${compassName(dir)}`;
}
