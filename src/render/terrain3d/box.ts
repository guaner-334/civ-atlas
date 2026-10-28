/**
 * 立体地形(地图上框一块立起来看)的方框:世界坐标里的一块(中心、宽高,世界单位 = 1 倍主图像素),
 * 和它有多少公里、按几倍像素铺、起伏默认夸大几倍。纯计算,主线程和后台线程都用。
 *
 * 公里按方框中心那条纬线算(东西方向 × cos 纬度):立起来的那一块按这个比例摆,高纬度的一块不会横着拉宽。
 */
import { KM_PER_UNIT } from '../../gen/civ/geo';

/** 方框最小、最大多少公里(每条边);再大贴图太大、起伏也要夸得更离谱才看得出 */
export const BOX_MIN_KM = 300;
export const BOX_MAX_KM = 2000;
/** 方框中心最多到多高的纬度(再往极地去,东西方向一个世界单位只剩几公里,一块地要铺的像素太多) */
const MAX_LAT = 75;

/** 世界坐标里的一块:中心 (cx, cy),宽 w、高 h(世界单位;cx 可以出 [0, 世界宽),东西相连) */
export interface ReliefBox {
  cx: number;
  cy: number;
  w: number;
  h: number;
}

/** 主图 y → 纬度(度,北正) */
export function latOfY(y: number, H: number): number {
  return 90 - (y / H) * 180;
}

/** 这一纬度上东西方向一个世界单位多少公里 */
export function kmPerUnitX(cy: number, H: number): number {
  return KM_PER_UNIT * Math.max(0.05, Math.cos((latOfY(cy, H) * Math.PI) / 180));
}

/** 方框多少公里(宽、高) */
export function boxKm(b: ReliefBox, H: number): { w: number; h: number } {
  return { w: b.w * kmPerUnitX(b.cy, H), h: b.h * KM_PER_UNIT };
}

/** 夹在能立起来的范围里:每条边 300–2000 公里,中心不过南北纬 75°,上下不出两极 */
export function clampBox(b: ReliefBox, H: number): ReliefBox {
  const yMin = ((90 - MAX_LAT) / 180) * H;
  const cy = Math.min(H - yMin, Math.max(yMin, b.cy));
  const kx = kmPerUnitX(cy, H);
  const clampKm = (u: number, k: number) => Math.min(BOX_MAX_KM, Math.max(BOX_MIN_KM, u * k)) / k;
  const w = clampKm(b.w, kx);
  const h = Math.min(clampKm(b.h, KM_PER_UNIT), 2 * Math.min(cy, H - cy));
  return { cx: b.cx, cy, w, h };
}

/** 方框上写的大小:"约 1330 × 900 公里";两边一样长 = "约 900 公里见方"(取整到 10 公里) */
export function boxSizeText(b: ReliefBox, H: number): string {
  const km = boxKm(b, H);
  const w = Math.round(km.w / 10) * 10;
  const h = Math.round(km.h / 10) * 10;
  return w === h ? `约 ${w} 公里见方` : `约 ${w} × ${h} 公里`;
}

/** 贴图每世界单位几个像素:细的一档(像素总数、最长边有上限)和先出来的粗的一档 */
export interface ReliefScales {
  fine: number;
  coarse: number;
}

/**
 * 按方框大小定两档的像素密度。细的:电脑最多每单位 16 像素(和地图放大到最大时一样细)、总共不超过约 100 万像素;
 * 手机最多 8 像素、约 35 万像素;最长边都不超过 2048(手机显卡的贴图上限)。粗的:约 5 万像素,几个后台线程分着算不到 0.1 秒
 */
export function reliefScales(b: ReliefBox, phone: boolean): ReliefScales {
  const area = b.w * b.h;
  const side = Math.max(b.w, b.h);
  const fits = (S: number, budget: number) => area * S * S <= budget && side * S <= 2048;
  const fine = (phone ? [8, 6, 4, 3, 2] : [16, 12, 8, 6, 4, 3, 2]).find((S) => fits(S, phone ? 350_000 : 1_000_000)) ?? 2;
  const coarse = [4, 3, 2, 1.5, 1].find((S) => S <= fine / 2 && fits(S, 55_000)) ?? 1;
  return { fine, coarse };
}

/**
 * 起伏默认夸大几倍:让这一块最高处(高出海面的米数)立起来约占方框边长(东西、南北取平均)的 4.5%,夹在 1–30 倍。
 * 框得越大夸得越多;同样大的框,山越高夸得越少(种子 7 玉屏山一带约 13 倍,种子 2024 踏星岭一带约 10 倍)。
 * 一块平地(最高不到 50 米)按 12 倍
 */
export function autoExaggeration(b: ReliefBox, H: number, maxElev: number): number {
  if (!(maxElev > 50)) return 12;
  const km = boxKm(b, H);
  const want = 0.045 * ((km.w + km.h) / 2);
  return Math.min(30, Math.max(1, Math.round(want / (maxElev / 1000))));
}

/** 贴图上的范围:S 倍主图里从 (x0, y0) 开始的 w × h 像素 */
export function boxPixels(b: ReliefBox, S: number): { x0: number; y0: number; w: number; h: number } {
  const x0 = Math.round((b.cx - b.w / 2) * S);
  const y0 = Math.round((b.cy - b.h / 2) * S);
  return { x0, y0, w: Math.max(2, Math.round(b.w * S)), h: Math.max(2, Math.round(b.h * S)) };
}
