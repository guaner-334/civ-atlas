/**
 * 地球仪 CPU 兼容画法的分段画(ui/globeCpu.ts):用假的后台线程(按顺序手动处理消息)检查
 *   - 一帧切成几段分给几个线程,所有行回来了才交出去,拼起来和整帧一次画完逐像素一致
 *   - 停下以后的全分辨率帧,又动起来时作废;排着的请求只留最新的,交出去的帧编号只增不减
 *   - 缓冲还回去以后下一帧接着用;线程出错 → failed,调用方改回当场画
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { globeFrame, renderGlobeCpu, type CpuSources, type GlobeLook, type GlobeView } from '../src/render/globe';
import { GlobeCpuPool, type CpuFrame } from '../src/ui/globeCpu';
import type { GlobeCpuMsg } from '../src/globeCpuWorker';

class FakeWorker {
  static all: FakeWorker[] = [];
  onmessage: ((e: { data: unknown }) => void) | null = null;
  onerror: ((e: { preventDefault(): void }) => void) | null = null;
  onmessageerror: (() => void) | null = null;
  queue: GlobeCpuMsg[] = [];
  vers = new Map<number, CpuSources>();
  last = -1;
  /** 每段按第几版贴图画的 */
  drawn: { job: number; ver: number }[] = [];
  /** 收到的缓冲是不是还回来的(大小对得上) */
  reused = 0;
  constructor() {
    FakeWorker.all.push(this);
  }
  postMessage(m: GlobeCpuMsg) {
    this.queue.push(m);
  }
  terminate() {
    this.queue = [];
  }
  /** 处理排着的下一条消息(和 globeCpuWorker.ts 做的一样);没有 = false */
  step(): boolean {
    const m = this.queue.shift();
    if (!m) return false;
    if (m.type === 'src') {
      const next: CpuSources = { terrain: null, ...this.vers.get(this.last) };
      for (const k of ['terrain', 'civ', 'sel', 'replay'] as const) if (k in m) next[k] = m[k] ?? null;
      this.vers.set(m.ver, next);
      this.last = m.ver;
      for (const v of [...this.vers.keys()]) if (v !== m.ver && !m.keep.includes(v)) this.vers.delete(v);
      return true;
    }
    this.drawn.push({ job: m.job, ver: this.vers.has(m.ver) ? m.ver : -1 });
    const n = m.w * m.rows * 4;
    if (m.buf && m.buf.byteLength === n) this.reused++;
    const buf = m.buf && m.buf.byteLength === n ? m.buf : new ArrayBuffer(n);
    renderGlobeCpu({ w: m.w, h: m.rows, data: new Uint8ClampedArray(buf) }, m.view, m.f, m.dpr, m.look, this.vers.get(m.ver)!, m.y0);
    this.onmessage?.({ data: { job: m.job, y0: m.y0, rows: m.rows, buf } });
    return true;
  }
}

/** 轮流让每个线程处理一条,直到都空了(最多 limit 条) */
function drain(limit = 1e4) {
  let any = true;
  while (any && limit-- > 0) {
    any = false;
    for (const w of FakeWorker.all) any = w.step() || any;
  }
}

const tw = 64;
const th = 32;
const tex = new Uint8ClampedArray(tw * th * 4).map((_, i) => (i % 4 === 3 ? 255 : (i * 29) % 256));
const terrain = { w: tw, h: th, data: tex };
const look: GlobeLook = { style: 'realistic', graticule: 0, hl: 0, replay: 0 };

function spec(lon: number, idle: boolean, w = 300, h = 200) {
  const view: GlobeView = { lon, lat: 0.2, k: 1.2 };
  return { view, f: globeFrame(view, w, h), dpr: 2, look, w, h, idle, tag: lon };
}

function joined(fr: CpuFrame<number>): Uint8ClampedArray {
  const out = new Uint8ClampedArray(fr.w * fr.h * 4);
  for (const b of fr.bands) out.set(new Uint8ClampedArray(b.buf), b.y0 * fr.w * 4);
  return out;
}

describe('地球仪 CPU 画法分段画', () => {
  beforeEach(() => {
    FakeWorker.all = [];
    vi.stubGlobal('Worker', FakeWorker);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('几个线程分着画一帧,所有行回来才交出去,拼起来和一次画完一样;缓冲还回去下一帧接着用', () => {
    const frames: CpuFrame<number>[] = [];
    const pool = new GlobeCpuPool<number>(3, (f) => frames.push(f), () => {});
    expect(pool.failed).toBe(false);
    expect(pool.size).toBe(3);
    pool.setSources({ terrain });
    const s = spec(0.5, false, 1600, 300);
    pool.request(s);
    expect(pool.busy).toBe(true);
    drain();
    expect(frames.length).toBe(1);
    expect(pool.busy).toBe(false);
    const fr = frames[0];
    expect(fr.bands.length).toBeGreaterThan(3);
    const whole = new Uint8ClampedArray(fr.w * fr.h * 4);
    renderGlobeCpu({ w: fr.w, h: fr.h, data: whole }, s.view, s.f, s.dpr, look, { terrain });
    expect(joined(fr)).toEqual(whole);
    // 换上以后还回去:下一帧同样大小的段接着用这些缓冲
    pool.recycle(fr);
    pool.request(spec(0.6, false, 1600, 300));
    drain();
    expect(frames.length).toBe(2);
    expect(FakeWorker.all.reduce((n, w) => n + w.reused, 0)).toBeGreaterThan(0);
  });

  it('停下以后的全分辨率帧,又动起来时作废;排着的只留最新的,交出去的编号只增不减', () => {
    const frames: CpuFrame<number>[] = [];
    const pool = new GlobeCpuPool<number>(2, (f) => frames.push(f), () => {});
    pool.setSources({ terrain });
    pool.request(spec(1, true, 800, 600));
    // 画了两段就又动起来了
    for (const w of FakeWorker.all) w.step();
    for (const w of FakeWorker.all) w.step();
    pool.request(spec(2, false));
    pool.request(spec(3, false));
    pool.request(spec(4, false));
    drain();
    const tags = frames.map((f) => f.tag);
    expect(tags).not.toContain(1);
    expect(tags[tags.length - 1]).toBe(4);
    for (let i = 1; i < frames.length; i++) expect(frames[i].id).toBeGreaterThan(frames[i - 1].id);
    for (const f of frames) expect(f.bands.reduce((n, b) => n + b.rows, 0)).toBe(f.h);
  });

  it('画到一半换了贴图(时间轴在走):这一帧照旧按开始时那一版画完,下一帧按新的', () => {
    const frames: CpuFrame<number>[] = [];
    const pool = new GlobeCpuPool<number>(2, (f) => frames.push(f), () => {});
    pool.setSources({ terrain });
    const a = spec(1, false, 1600, 300);
    pool.request(a);
    for (const w of FakeWorker.all) w.step();
    for (const w of FakeWorker.all) w.step();
    // 换一张颜色完全不同的地形,接着请求下一帧
    const other = { w: tw, h: th, data: new Uint8ClampedArray(tw * th * 4).fill(255) };
    pool.setSources({ terrain: other });
    const b = spec(2, false, 1600, 300);
    pool.request(b);
    drain();
    const fa = frames.find((f) => f.tag === 1)!;
    const fb = frames.find((f) => f.tag === 2)!;
    const ref = (s: typeof a, t: typeof terrain) => {
      const out = new Uint8ClampedArray(s.w * s.h * 4);
      renderGlobeCpu({ w: s.w, h: s.h, data: out }, s.view, s.f, s.dpr, look, { terrain: t });
      return out;
    };
    expect(joined(fa)).toEqual(ref(a, terrain));
    expect(joined(fb)).toEqual(ref(b, other));
    for (const w of FakeWorker.all) expect(w.drawn.every((d) => d.ver >= 0)).toBe(true);
  });

  it('线程出错:failed,通知调用方(改回当场画),之后的请求不再发', () => {
    let failed = 0;
    const pool = new GlobeCpuPool<number>(2, () => {}, () => failed++);
    FakeWorker.all[0].onerror?.({ preventDefault() {} });
    expect(pool.failed).toBe(true);
    expect(failed).toBe(1);
    pool.request(spec(0, false));
    expect(FakeWorker.all.every((w) => w.queue.length === 0)).toBe(true);
  });

  it('起不来线程(没有 Worker):failed', () => {
    vi.stubGlobal('Worker', undefined);
    let failed = 0;
    const pool = new GlobeCpuPool<number>(2, () => {}, () => failed++);
    expect(pool.failed).toBe(true);
    expect(failed).toBe(1);
  });
});
