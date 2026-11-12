/**
 * 照图原样时导入的图多存的两样(SketchImage.fine、SketchImage.grey)的存法。纯计算,不碰 DOM。
 *
 * 细图(fine):FINE_W × FINE_H 格,一格 = 世界坐标 1 × 1(和 1 倍主图的像素一样大),值 FINE_NONE 没盖到 / FINE_WATER 水 / FINE_LAND 陆地。
 *   逐行从北往南存:一行和上一行一样时记一个 3;不然从西往东记一段段连着的同一个值,每段 = (长度 << 2 | 值) 的变长整数(每字节低 7 位,最高位 1 = 后面还有)。
 *   字节再 base64。
 * 连续高低(grey):GREY_W × GREY_H 格(和导入图片的格子图一样大),0 = 没有高低(海、没盖到),1–255 由低到高。
 *   逐行存和左边一格的差:差是 0 时记 0 再记连着几个 0(变长整数),不是 0 时记差的 zigzag(变长整数,≥ 1)。字节再 base64。
 */
import { TERRAIN_H, TERRAIN_W } from './terrainOps';

export const FINE_W = TERRAIN_W;
export const FINE_H = TERRAIN_H;
export const FINE_NONE = 0;
export const FINE_WATER = 1;
export const FINE_LAND = 2;
export const GREY_W = 512;
export const GREY_H = 256;

/** 存的字符串最长多少(每个像素单独一段也放得下) */
const FINE_B64_MAX = Math.ceil((FINE_W * FINE_H) / 3) * 4 + 4096;
const GREY_B64_MAX = Math.ceil((GREY_W * GREY_H * 3) / 3) * 4 + 4096;
const ROW_SAME = 3;

function fromB64(s: string, max: number): string | null {
  if (typeof s !== 'string' || s.length > max || !/^[A-Za-z0-9+/]*={0,2}$/.test(s)) return null;
  try {
    return atob(s);
  } catch {
    return null;
  }
}

/** 读一个变长整数:[值, 下一个字节的位置];读不出来(到头了、太长)= null */
function readVar(bin: string, p: number): [number, number] | null {
  let v = 0;
  let mul = 1;
  for (let k = 0; k < 4; k++) {
    if (p >= bin.length) return null;
    const b = bin.charCodeAt(p++);
    v += (b & 0x7f) * mul;
    if (!(b & 0x80)) return [v, p];
    mul *= 128;
  }
  return null;
}

/** 读不出来、值不对、一行加起来不是正好 FINE_W 格、行数不对 = null */
export function decodeFine(s: string): Uint8Array | null {
  const bin = fromB64(s, FINE_B64_MAX);
  if (bin === null) return null;
  const out = new Uint8Array(FINE_W * FINE_H);
  let p = 0;
  for (let y = 0; y < FINE_H; y++) {
    const row = y * FINE_W;
    let x = 0;
    while (x < FINE_W) {
      const r = readVar(bin, p);
      if (!r) return null;
      p = r[1];
      const v = r[0] & 3;
      const n = Math.floor(r[0] / 4);
      if (v === ROW_SAME) {
        if (n || x || !y) return null;
        out.copyWithin(row, row - FINE_W, row);
        x = FINE_W;
        continue;
      }
      if (!n || x + n > FINE_W) return null;
      if (v) out.fill(v, row + x, row + x + n);
      x += n;
    }
  }
  return p === bin.length ? out : null;
}

/** 读不出来、值超出 0–255、一行不是正好 GREY_W 格 = null */
export function decodeGrey(s: string): Uint8Array | null {
  const bin = fromB64(s, GREY_B64_MAX);
  if (bin === null) return null;
  const out = new Uint8Array(GREY_W * GREY_H);
  let p = 0;
  for (let y = 0; y < GREY_H; y++) {
    let prev = 0;
    let x = 0;
    while (x < GREY_W) {
      const r = readVar(bin, p);
      if (!r) return null;
      p = r[1];
      if (r[0] === 0) {
        const n = readVar(bin, p);
        if (!n || !n[0] || x + n[0] > GREY_W) return null;
        p = n[1];
        out.fill(prev, y * GREY_W + x, y * GREY_W + x + n[0]);
        x += n[0];
        continue;
      }
      const d = r[0] & 1 ? (r[0] + 1) / 2 : -r[0] / 2;
      const v = prev + d;
      if (v < 0 || v > 255) return null;
      out[y * GREY_W + x++] = v;
      prev = v;
    }
  }
  return p === bin.length ? out : null;
}
