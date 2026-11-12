/** 细图、连续高低写成存的字符串(格式见 sketchFine.ts;只有导入图片时用) */
import { FINE_H, FINE_W, GREY_H, GREY_W } from './sketchFine';

const ROW_SAME = 3;

function pushVar(out: number[], v: number) {
  while (v >= 0x80) {
    out.push((v & 0x7f) | 0x80);
    v = Math.floor(v / 128);
  }
  out.push(v);
}

function toB64(bytes: number[]): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 4096) bin += String.fromCharCode(...bytes.slice(i, i + 4096));
  return btoa(bin);
}

export function encodeFine(grid: Uint8Array): string {
  const out: number[] = [];
  for (let y = 0; y < FINE_H; y++) {
    const row = y * FINE_W;
    let same = y > 0;
    for (let x = 0; same && x < FINE_W; x++) same = grid[row + x] === grid[row - FINE_W + x];
    if (same) {
      out.push(ROW_SAME);
      continue;
    }
    for (let x = 0; x < FINE_W; ) {
      const v = grid[row + x];
      let e = x + 1;
      while (e < FINE_W && grid[row + e] === v) e++;
      pushVar(out, ((e - x) << 2) | v);
      x = e;
    }
  }
  return toB64(out);
}

export function encodeGrey(g: Uint8Array): string {
  const out: number[] = [];
  for (let y = 0; y < GREY_H; y++) {
    let prev = 0;
    for (let x = 0; x < GREY_W; ) {
      const v = g[y * GREY_W + x];
      const d = v - prev;
      if (d === 0) {
        let e = x + 1;
        while (e < GREY_W && g[y * GREY_W + e] === v) e++;
        out.push(0);
        pushVar(out, e - x);
        x = e;
        continue;
      }
      pushVar(out, d > 0 ? 2 * d - 1 : -2 * d);
      prev = v;
      x++;
    }
  }
  return toB64(out);
}
