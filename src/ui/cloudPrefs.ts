/**
 * 地球仪上的云:开不开、飘不飘(图层面板「云层」一行)。只是看的人自己的偏好,记在浏览器里,不进存档和分享链接。
 * 默认都开:云画在写实风地球仪上,放大或铺了国家、民族这类色块时自己淡一些(见 Globe.tsx)。
 */
import { useSyncExternalStore } from 'react';

export interface CloudPrefs {
  on: boolean;
  drift: boolean;
}

const KEY = 'wf-clouds';
let cur: CloudPrefs = { on: true, drift: true };
try {
  const raw = localStorage.getItem(KEY);
  if (raw) {
    const o = JSON.parse(raw) as Partial<CloudPrefs>;
    cur = { on: o.on !== false, drift: o.drift !== false };
  }
} catch {
  /* 读不到就用默认 */
}
// 网址 clouds=1:开着、不飘(一帧固定,截图对比用);clouds=2:开着、飘;clouds=0:关。自动化浏览器(检查脚本)里没写时默认关:
// 云要后台画一秒、还会飘,会让逐像素对比的检查不稳
try {
  const q = new URLSearchParams(location.search).get('clouds');
  if (q === '1' || q === '2') cur = { on: true, drift: q === '2' };
  else if (q === '0' || (q === null && navigator.webdriver)) cur = { on: false, drift: false };
} catch {
  /* 没有 location(单测) */
}
const subs = new Set<() => void>();

export const getCloudPrefs = (): CloudPrefs => cur;

export function setCloudPrefs(patch: Partial<CloudPrefs>): void {
  const next = { ...cur, ...patch };
  if (next.on === cur.on && next.drift === cur.drift) return;
  cur = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(cur));
  } catch {
    /* 存不了就只在这次打开里有效 */
  }
  for (const f of subs) f();
}

/** 地球仪这会儿能不能画云:没有 WebGL2、退回 CPU 画法时不能(图层面板的「云层」一行跟着变灰) */
let gpu = true;
const getCloudGpu = () => gpu;

export function setCloudGpu(v: boolean): void {
  if (v === gpu) return;
  gpu = v;
  for (const f of subs) f();
}

export function useCloudGpu(): boolean {
  return useSyncExternalStore(
    (f) => {
      subs.add(f);
      return () => subs.delete(f);
    },
    getCloudGpu,
    getCloudGpu,
  );
}

export function useCloudPrefs(): CloudPrefs {
  return useSyncExternalStore(
    (f) => {
      subs.add(f);
      return () => subs.delete(f);
    },
    getCloudPrefs,
    getCloudPrefs,
  );
}
