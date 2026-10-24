/**
 * 播放画面(「更多」菜单「播放画面」一行):播放历史时地图每一帧都画全,还是少画几次换流畅。
 * 只是看的人自己的偏好,记在浏览器里,不进存档和分享链接。
 *
 *   auto    默认:画布没用上显卡加速(device.ts 的 noGpu)时按 smooth,用上了按 sharp
 *   smooth  播放时文明底图、地名、细节层画的那一年每隔 SMOOTH_MS 才换一次(时间轴、年份照常每帧走,拖地图照常跟手),
 *           停下当场画到停的那一年 —— 没有显卡加速时整张底图、地名重画一次要几十毫秒,每帧都画就一卡一卡
 *   sharp   播放时每一帧都画全
 *
 * 网址 playq=auto / smooth / sharp:这一次打开按它(测试、量速度用),不改记下的
 */
import { useRef, useSyncExternalStore } from 'react';
import { noGpu } from './device';

export type PlayQuality = 'auto' | 'smooth' | 'sharp';

/** 流畅优先时画的那一年最快多久换一次(毫秒):每秒最多 10 次 */
export const SMOOTH_MS = 100;

const KEY = 'wf-play-quality';
const isQuality = (v: unknown): v is PlayQuality => v === 'auto' || v === 'smooth' || v === 'sharp';

let cur: PlayQuality = 'auto';
try {
  const v = localStorage.getItem(KEY);
  if (isQuality(v)) cur = v;
} catch {
  /* 读不到就用默认 */
}
try {
  const q = new URLSearchParams(location.search).get('playq');
  if (isQuality(q)) cur = q;
} catch {
  /* 没有 location(单测) */
}
const subs = new Set<() => void>();
const subscribe = (f: () => void) => {
  subs.add(f);
  return () => {
    subs.delete(f);
  };
};

export const getPlayQuality = (): PlayQuality => cur;

export function setPlayQuality(q: PlayQuality): void {
  if (q === cur) return;
  cur = q;
  try {
    localStorage.setItem(KEY, q);
  } catch {
    /* 存不了就只在这次打开里有效 */
  }
  for (const f of subs) f();
}

export function usePlayQuality(): PlayQuality {
  return useSyncExternalStore(subscribe, getPlayQuality, getPlayQuality);
}

/** 照设置,播放时要不要少画几次(自动 = 看这台设备有没有用上显卡加速) */
export function playSmooth(q: PlayQuality): boolean {
  return q === 'smooth' || (q === 'auto' && noGpu());
}

/** 画的那一年和它是什么时候换上的 */
export interface Drawn<T> {
  year: T;
  at: number;
}

/**
 * 地图画哪一年:slow(流畅优先地在播放)时上一次换年份不到 SMOOTH_MS 就还画上一次的那年,不然换成 year。
 * 播放时年份每帧都变、每帧都会算一次,所以停下(slow 变 false)、隔够了时间都当场换上
 */
export function nextDrawn<T>(last: Drawn<T> | null, year: T, slow: boolean, now: number): Drawn<T> {
  return !slow || !last || now - last.at >= SMOOTH_MS ? { year, at: now } : last;
}

export function useDrawnYear<T>(year: T, slow: boolean): T {
  const last = useRef<Drawn<T> | null>(null);
  last.current = nextDrawn(last.current, year, slow, performance.now());
  return last.current.year;
}
