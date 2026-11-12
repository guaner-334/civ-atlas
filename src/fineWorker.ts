/// <reference lib="webworker" />
/**
 * 照图原样认细图的后台线程(界面那边在 ui/ImportImage.tsx):收一张图的像素(只留最近一张),
 * 按当时的认法认出 2048 × 1024 的海陆、编码好交回。认法、放法和界面上认的那张小图一样。
 */
import { levelsFrom, preparePicture, seaFromClicks, type Picture, type Placement } from './gen/sketchImage';
import { FINE_PICTURE_W, placeOnFine } from './gen/sketchImageFine';
import { encodeFine } from './gen/sketchFineWrite';

export type FineHow = { mode: 'wand'; clicks: [number, number][]; range: number } | { mode: 'level'; sea: number; dark: boolean };

export type FineRequest =
  | { type: 'image'; id: string; data: Uint8ClampedArray; width: number; height: number }
  | { type: 'fine'; id: string; key: string; how: FineHow; place: Placement }
  | { type: 'drop' };

/** 认出来的(图不是那一张了 = null) */
export interface FineReply {
  key: string;
  fine: string | null;
}

let cur: { id: string; pic: Picture } | null = null;

self.onmessage = (e: MessageEvent<FineRequest>) => {
  const m = e.data;
  if (m.type === 'drop') {
    cur = null;
    return;
  }
  if (m.type === 'image') {
    cur = { id: m.id, pic: preparePicture({ data: m.data, width: m.width, height: m.height }, FINE_PICTURE_W) };
    return;
  }
  if (cur?.id !== m.id) return void self.postMessage({ key: m.key, fine: null } satisfies FineReply);
  const p = cur.pic;
  const values = m.how.mode === 'wand' ? seaFromClicks(p, m.how.clicks, m.how.range) : levelsFrom(p, { sea: m.how.sea, dark: m.how.dark, sharp: true });
  self.postMessage({ key: m.key, fine: encodeFine(placeOnFine(values, p.w, p.h, m.place)) } satisfies FineReply);
};
