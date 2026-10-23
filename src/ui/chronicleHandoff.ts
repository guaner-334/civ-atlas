/**
 * 后台线程交来的编年史(src/chronicleParts.ts):一块一块收齐,等那份历史换上时记进编年史的缓存,主线程不再整段重算。
 *
 * 线程交历史之前先交这份历史的编年史(按发请求时的改名算);交历史的那条消息带着编年史的编号,对上了就按这份历史的史事数组
 * (civ.annals)记下 —— 换上时沿用州(eras.ts 的 reuseRegions)、套改名(applyNames)出来的新对象都共用这个数组。
 * 界面用的整段历史(App 的 realFull)由 namedHistory 套改名:改名和线程算的时候一样,就把这份记进缓存。
 *
 * 线程没替它算的(改了名、AI 起名以后,线程算的时候又改了名,助手"先在地图上看看"的试推演,导出时换回原名):
 * 在主线程上分小块算(chronicleInSlices,每块几毫秒,块与块之间让出主线程),算的时候照旧显示原来的样子,算好了再换上
 * (useNamedHistory、prepareChronicle)。几万年的历史编年史有两万多条,一口气算完要几百毫秒(手机上一两秒),界面那么久拖不动、点不动。
 */
import { useEffect, useMemo, useReducer, useRef } from 'react';
import { joinChronicleParts, type ChroniclePart } from '../chronicleParts';
import { buildChronicle, primeChronicle, type ChronicleEntry } from '../gen/civ/chronicle';
import { fullChronicle, fullChronicleCached, fullChronicleSteps, primeFullChronicle } from '../gen/civ/religionText';
import { applyNames } from '../gen/edits';
import type { Civ } from '../gen/civ';

interface Ready {
  names: Record<string, string>;
  build: ChronicleEntry[];
  full: ChronicleEntry[];
}

/** 史事数组 → 备好的编年史(线程交来的、分小块算好的;一份历史只记最近备好的那一份改名) */
const ready = new WeakMap<object, Ready>();
/** 收到了、还没等到那份历史的块 */
let inbox: ChroniclePart[] = [];

/** 线程交来一块(第一块到了,之前没收齐的作废) */
export function takeChroniclePart(p: ChroniclePart) {
  if (p.part === 0) inbox = [];
  inbox.push(p);
}

/** 线程交来一份历史(key = 它的编年史的编号;没有 = 线程没算):收齐了就记下 */
export function adoptChronicle(civ: Civ | null | undefined, key: number | undefined) {
  const parts = inbox;
  inbox = [];
  if (!civ || key === undefined) return;
  const got = joinChronicleParts(parts, key);
  if (got) ready.set(civ.annals, got);
}

/** 线程换了一个(旧线程交了一半的不要了) */
export function dropChronicleParts() {
  inbox = [];
}

function sameNames(a: Record<string, string>, b: Record<string, string>): boolean {
  if (a === b) return true;
  const ka = Object.keys(a);
  if (ka.length !== Object.keys(b).length) return false;
  return ka.every((k) => Object.prototype.hasOwnProperty.call(b, k) && a[k] === b[k]);
}

/** 整段历史套上改名(同 applyNames);线程按同样的改名算好了编年史的(或分小块算好了的),记进缓存 */
export function namedHistory(raw: Civ, names: Record<string, string>): Civ {
  const out = applyNames(raw, names);
  const r = ready.get(raw.annals);
  if (r && sameNames(r.names, names)) {
    primeChronicle(out, r.build);
    primeFullChronicle(out, r.full);
  }
  return out;
}

/** 每一小块最多占主线程多久(毫秒) */
const SLICE_MS = 8;

/** 让出主线程一下:这期间界面照样画、照样响应点击拖动(用消息通道,不像 setTimeout 那样连着用会被拖到每次至少 4 毫秒) */
function breathe(): Promise<void> {
  if (typeof MessageChannel === 'undefined') return new Promise((r) => setTimeout(r, 0));
  return new Promise((r) => {
    const ch = new MessageChannel();
    ch.port1.onmessage = () => {
      ch.port1.close();
      r();
    };
    ch.port2.postMessage(null);
  });
}

/**
 * 在主线程上分小块算 civ 的编年史(religionText.ts 的 fullChronicleSteps:fullChronicle 连同其中的 buildChronicle,记进各自的缓存,
 * 和一口气算的逐条一样):每块约 SLICE_MS 毫秒,块与块之间让出主线程。算完(或早就算过)= true;signal 叫停了 = false(算了一半的扔掉)
 */
export async function chronicleInSlices(civ: Civ, signal?: AbortSignal): Promise<boolean> {
  const steps = fullChronicleSteps(civ);
  for (;;) {
    if (signal?.aborted) return false;
    const t0 = performance.now();
    while (performance.now() - t0 < SLICE_MS) if (steps.next().done) return true;
    await breathe();
  }
}

/**
 * full(= namedHistory(raw, names))的编年史备好:没有就分小块算,算好按史事数组记下(之后套同样改名的新对象直接用,
 * 同 namedHistory)。备好了 = true;叫停了 = false
 */
export async function prepareChronicle(raw: Civ, names: Record<string, string>, full: Civ, signal?: AbortSignal): Promise<boolean> {
  if (!(await chronicleInSlices(full, signal))) return false;
  ready.set(raw.annals, { names, build: buildChronicle(full), full: fullChronicle(full) });
  return true;
}

/** 界面用的整段历史:full = 套上 names 的 raw */
export interface NamedHistory {
  raw: Civ;
  full: Civ;
  names: Record<string, string>;
}

/**
 * 界面用的整段历史(namedHistory 套上改名)和它套的是哪份改名。这份改名的编年史已经有了(线程交来的、算过的)就直接用;
 * 还没有、而这份历史手上有套别的改名的(改名以前显示的那份、线程按发请求时的改名算好的那份),就先照旧显示那份(名字也照旧),
 * 在主线程上分小块算好再换上。都没有就照旧(用到时在主线程上算)
 */
export function useNamedHistory(raw: Civ | null, names: Record<string, string>): NamedHistory | null {
  const [tick, bump] = useReducer((x: number) => x + 1, 0);
  const last = useRef<NamedHistory | null>(null);
  const want = useMemo(() => (raw ? namedHistory(raw, names) : null), [raw, names]);
  const shown = useMemo((): NamedHistory | null => {
    if (!raw || !want) return null;
    if (fullChronicleCached(want)) return { raw, full: want, names };
    const prev = last.current;
    if (prev && prev.raw === raw) return prev;
    const r = ready.get(raw.annals);
    if (r) return { raw, full: namedHistory(raw, r.names), names: r.names };
    return { raw, full: want, names };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- tick:分小块算好了,换上
  }, [raw, want, names, tick]);
  last.current = shown;
  useEffect(() => {
    if (!raw || !want || !shown || shown.full === want) return;
    const stop = new AbortController();
    void prepareChronicle(raw, names, want, stop.signal).then((ok) => ok && bump());
    return () => stop.abort();
  }, [raw, want, names, shown]);
  return shown;
}
