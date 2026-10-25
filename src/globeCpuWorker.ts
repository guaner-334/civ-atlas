/// <reference lib="webworker" />
/**
 * 地球仪 CPU 兼容画法(没有 WebGL2 时)的后台线程:主线程把贴图像素(地形、文明底图、选中、回放帧)交过来留着,
 * 之后每次只发"这一帧的视角 + 画哪几行",这里用 render/globe.ts 的 renderGlobeCpu 逐像素算好交回去。
 * 几个线程分着画同一帧的不同几行(怎么分、怎么拼见 ui/globeCpu.ts),和主线程上一次画完逐像素一致,
 * 主线程不再一画就是几百毫秒。
 */
import { renderGlobeCpu, type CpuSources, type GlobeFrame, type GlobeLook, type GlobeView, type RgbaImage } from './render/globe';

/**
 * 换贴图:带了哪个槽位就换哪个(null = 清空),其余沿用上一版;ver = 这一版的编号。
 * 换贴图前已经开始画的帧照旧按它开始时那一版画完(不会半张新半张旧),keep = 还有帧在用的旧版本,其余的扔掉
 */
export interface GlobeCpuSrcMsg {
  type: 'src';
  ver: number;
  keep: number[];
  terrain?: RgbaImage | null;
  civ?: RgbaImage | null;
  sel?: RgbaImage | null;
  replay?: RgbaImage | null;
}

/** 画一帧里的 rows 行(从第 y0 行起,宽 w),按第 ver 版贴图;buf = 主线程用完还回来的缓冲(大小对得上就接着用) */
export interface GlobeCpuRowsMsg {
  type: 'rows';
  job: number;
  ver: number;
  view: GlobeView;
  f: GlobeFrame;
  /** 画布像素 / CSS 像素 */
  dpr: number;
  look: GlobeLook;
  w: number;
  y0: number;
  rows: number;
  buf?: ArrayBuffer;
}

export type GlobeCpuMsg = GlobeCpuSrcMsg | GlobeCpuRowsMsg;

/** 画好的几行(RGBA,w × rows) */
export interface GlobeCpuRows {
  job: number;
  y0: number;
  rows: number;
  buf: ArrayBuffer;
}

const SLOTS = ['terrain', 'civ', 'sel', 'replay'] as const;
const EMPTY: CpuSources = { terrain: null, civ: null, sel: null, replay: null };
/** 各版贴图(没变的槽位几版共用同一份像素) */
const vers = new Map<number, CpuSources>();
let last = -1;

self.onmessage = (e: MessageEvent<GlobeCpuMsg>) => {
  const m = e.data;
  if (m.type === 'src') {
    const next: CpuSources = { ...(vers.get(last) ?? EMPTY) };
    for (const k of SLOTS) if (k in m) next[k] = m[k] ?? null;
    vers.set(m.ver, next);
    last = m.ver;
    for (const v of [...vers.keys()]) if (v !== m.ver && !m.keep.includes(v)) vers.delete(v);
    return;
  }
  const n = m.w * m.rows * 4;
  const buf = m.buf && m.buf.byteLength === n ? m.buf : new ArrayBuffer(n);
  const src = vers.get(m.ver) ?? vers.get(last) ?? EMPTY;
  renderGlobeCpu({ w: m.w, h: m.rows, data: new Uint8ClampedArray(buf) }, m.view, m.f, m.dpr, m.look, src, m.y0);
  const res: GlobeCpuRows = { job: m.job, y0: m.y0, rows: m.rows, buf };
  self.postMessage(res, { transfer: [buf] });
};
