/**
 * 问题记录的"耳朵"(记录本身在 ./log.ts):页面出错、没接住的 Promise、后台线程出错都记一条;
 * 每次打开网页留一个"还开着"的记号,下次打开时发现上次没正常关、而且当时开在前台,就记一条"意外关闭"(手机卡退、浏览器崩溃都是这样)。
 *
 * 意外关闭怎么认:
 * - 开着的时候每 BEAT_MS 写一次记号(时间、在做什么、在不在前台、内存),切前后台、换"在做什么"时马上写
 * - 正常关掉(pagehide)删掉记号;从浏览器的往返缓存里回来(pageshow)再写上
 * - 新打开的页面看到别的记号:先记下它们的时间,CHECK_MS 以后再看 —— 还开着的页面早该又写过了;没动、最后一次在前台的才算意外关闭
 *   (手机 Safari 卡退后会马上重新打开,所以不能看"多久没写";另开着的标签页在后台时浏览器会放慢计时,所以只认前台的)
 * - 在后台被系统收掉的不算,记号放久了(STALE_MS)直接删
 */
import { cleanCtx, recordDiag, recordError, type DiagContext, type DiagCrashEntry } from './log';

export const LIVE_KEY = 'civ-atlas-diag-live';
const BEAT_MS = 5_000;
const CHECK_MS = 15_000;
const STALE_MS = 24 * 3600_000;

/** 一个开着的页面的记号 */
export interface LiveMark extends DiagContext {
  started: string;
  /** 最后一次写的时间(毫秒) */
  seen: number;
  visible: boolean;
  heapMB?: number;
}

type Marks = Record<string, LiveMark>;

/** 在做什么(生成世界、推演历史、导出视频……);同时只记最近设的那件,结束时设回 null */
let doing: string | null = null;
/** 年份、世界、图层:App 接上,写记号、记出错时问一下 */
let context: () => DiagContext = () => ({});

export function setDiagContext(f: () => DiagContext): void {
  context = f;
}

let beat: () => void = () => {};
/** 马上写一次记号(App 换了线程上的活时调) */
export const diagBeat = (): void => beat();

/** 开始做一件事;返回"做完了"(做完时只在还是这件事时清掉) */
export function diagDoing(label: string): () => void {
  doing = label;
  beat();
  return () => {
    if (doing !== label) return;
    doing = null;
    beat();
  };
}

function ctxNow(): DiagContext {
  let c: DiagContext = {};
  try {
    c = context();
  } catch {
    // 拿不到就不带
  }
  return cleanCtx({ ...c, ...(doing ? { doing } : {}) });
}

function readMarks(s: Storage): Marks {
  try {
    const v = JSON.parse(s.getItem(LIVE_KEY) ?? '{}') as unknown;
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Marks) : {};
  } catch {
    return {};
  }
}

function writeMarks(s: Storage, m: Marks) {
  try {
    if (Object.keys(m).length) s.setItem(LIVE_KEY, JSON.stringify(m));
    else s.removeItem(LIVE_KEY);
  } catch {
    // 存不下就算了
  }
}

/** 上次的记号里,哪些是意外关闭的:before = 打开时读到的,after = 过一会儿再读的 */
export function findCrashed(before: Marks, after: Marks, self: string): string[] {
  const out: string[] = [];
  for (const [id, m] of Object.entries(before)) {
    if (id === self || !m.visible) continue;
    const now = after[id];
    // 正常关掉的已经删了;还开着的又写过了(时间变了)
    if (now && now.seen === m.seen) out.push(id);
  }
  return out;
}

/** 意外关闭的那一条 */
export function crashEntry(m: LiveMark): Omit<DiagCrashEntry, 'kind'> & { kind: 'crash' } {
  return {
    kind: 'crash',
    at: new Date(m.seen).toISOString(),
    started: m.started,
    ...cleanCtx(m),
    ...(m.heapMB ? { heapMB: m.heapMB } : {}),
  };
}

function heapMB(): number | undefined {
  const mem = (performance as { memory?: { usedJSHeapSize?: number } }).memory;
  return mem?.usedJSHeapSize ? Math.round(mem.usedJSHeapSize / 1048576) : undefined;
}

let installed = false;

/** 启动时调一次(浏览器里) */
export function installDiagWatch(): void {
  if (installed || typeof window === 'undefined') return;
  installed = true;

  window.addEventListener('error', (e: ErrorEvent) => {
    // 图片、脚本下载失败也会冒到这里(没有 message),不算
    if (!e.message && !e.error) return;
    const err = e.error as Error | undefined;
    recordError('window', err?.message || e.message, err?.stack ?? (e.filename ? `${e.filename}:${e.lineno}:${e.colno}` : undefined), ctxNow());
  });
  window.addEventListener('unhandledrejection', (e: PromiseRejectionEvent) => {
    const r = e.reason as { name?: string; message?: string; stack?: string; code?: string } | undefined;
    // 用户自己停下的不算
    if (r && (r.name === 'AbortError' || r.code === 'aborted')) return;
    recordError('promise', r?.message ?? String(r), r?.stack, ctxNow());
  });

  let s: Storage;
  try {
    s = localStorage;
    s.getItem(LIVE_KEY);
  } catch {
    return; // 浏览器不让存:认不了意外关闭
  }
  const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const started = new Date().toISOString();
  let alive = true;
  beat = () => {
    if (!alive) return;
    const m = readMarks(s);
    const h = heapMB();
    m[id] = { started, seen: Date.now(), visible: document.visibilityState === 'visible', ...ctxNow(), ...(h ? { heapMB: h } : {}) };
    writeMarks(s, m);
  };

  const before = readMarks(s);
  // 放太久的记号直接删(在后台被系统收掉的)
  for (const [k, m] of Object.entries(before)) if (!(m?.seen > Date.now() - STALE_MS)) delete before[k];
  beat();
  window.setInterval(beat, BEAT_MS);
  window.setTimeout(() => {
    const crashed = findCrashed(before, readMarks(s), id).sort((a, b) => before[a].seen - before[b].seen);
    for (const k of crashed) recordDiag(crashEntry(before[k]));
    // 记过的、放太久的删掉
    const m = readMarks(s);
    for (const k of crashed) delete m[k];
    for (const [k, v] of Object.entries(m)) if (!(v?.seen > Date.now() - STALE_MS)) delete m[k];
    writeMarks(s, m);
  }, CHECK_MS);

  document.addEventListener('visibilitychange', beat);
  window.addEventListener('pagehide', () => {
    alive = false;
    const m = readMarks(s);
    delete m[id];
    writeMarks(s, m);
  });
  window.addEventListener('pageshow', (e) => {
    if (!e.persisted) return;
    alive = true;
    beat();
  });
}

/** 后台线程出错(new Worker 的 onerror) */
export function recordWorkerError(e: ErrorEvent | Event, which: string): void {
  const ev = e as ErrorEvent;
  recordError('worker', `${which}:${ev.message || '后台线程出错'}`, ev.filename ? `${ev.filename}:${ev.lineno}:${ev.colno}` : undefined, ctxNow());
}
