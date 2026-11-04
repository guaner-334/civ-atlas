/**
 * 后台线程交来的编年史(src/chronicleParts.ts):一块一块收齐,等那份历史换上时记进编年史的缓存,主线程不再整段重算。
 *
 * 线程交历史之前先交这份历史的编年史(按发请求时的改名算);交历史的那条消息带着编年史的编号,对上了就按这份历史的史事数组
 * (civ.annals)记下 —— 换上时沿用州(eras.ts 的 reuseRegions)、套改名(applyNames)出来的新对象都共用这个数组。
 * 界面用的整段历史(App 的 realFull)由 namedHistory 套改名、套作者人物的名字(作者立的君主,gen/characters.ts 的 applyCharacters):
 * 改名和线程算的时候一样、也没有作者立的君主,就把这份记进缓存(线程不知道作者人物叫什么,有作者立的君主时按下面在主线程上算)。
 *
 * 线程没替它算的(改了名、AI 起名以后,线程算的时候又改了名,助手"先在地图上看看"的试推演,导出时换回原名):
 * 这份历史有线程交来的那一块(存进世界的,文字里的名字是占位符,见 gen/civ/story/nameTokens.ts)就把名字换上;没有(试推演、块还没到)或者人物卡的性别改过,
 * 在主线程上分小块算(chronicleInSlices,每块几毫秒,块与块之间让出主线程),算的时候照旧显示原来的样子,算好了再换上
 * (useNamedHistory、prepareChronicle)。几万年的历史编年史有两万多条,一口气算完要几百毫秒(手机上一两秒),界面那么久拖不动、点不动。
 */
import { useEffect, useMemo, useReducer, useRef } from 'react';
import { authorsKey, joinChronicleParts, type ChroniclePart } from '../chronicleParts';
import { buildChronicle, primeChronicle, type ChronicleEntry } from '../gen/civ/story/chronicle';
import { blockFits, inBuildChronicle, nameRestorer, restoreEntries, type ChronicleBlock } from '../gen/civ/story/nameTokens';
import { fullChronicle, fullChronicleCached, fullChronicleSteps, primeFullChronicle } from '../gen/civ/story/religionText';
import { readLocalPart, type SnapshotPart } from '../gen/snapshot';
import { applyNames } from '../gen/edits';
import { applyCharacters, type AuthorCharacter } from '../gen/characters';
import type { Civ } from '../gen/civ';

/** 作者的人物(套名字用) */
type Chars = readonly AuthorCharacter[] | undefined;

interface Ready {
  names: Record<string, string>;
  /** 套的作者人物的名字(authorsKey) */
  authors: string;
  build: ChronicleEntry[];
  full: ChronicleEntry[];
}

/** 史事数组 → 备好的编年史(线程交来的、分小块算好的;一份历史只记最近备好的那一份改名) */
const ready = new WeakMap<object, Ready>();
/** 收到了、还没等到那份历史的块 */
let inbox: ChroniclePart[] = [];
/** 第几个线程:线程换了,编年史的编号又从头数,新旧两个线程的编号不能算同一份 */
let thread = 0;
/** 编号在这个主线程上的写法 */
const keyOf = (key: number) => `${thread}.${key}`;
/** 史事数组 → 它的编年史的编号 */
const keys = new WeakMap<object, string>();
/** 线程交来的最近那份历史存进世界的那一块(压缩的字节;要改名时才解开,解开一次记下) */
let stored: { key: string; part: SnapshotPart; block?: Promise<ChronicleBlock | null> } | null = null;

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
  keys.set(civ.annals, keyOf(key));
  const got = joinChronicleParts(parts, key);
  if (got) ready.set(civ.annals, got);
}

/** 线程交来这份编年史(编号 key)存进世界的那一块 */
export function takeChronicleBlock(key: number, part: SnapshotPart) {
  stored = { key: keyOf(key), part };
}

/** 线程换了一个(旧线程交了一半的不要了;旧线程交来的那一块也不要了,新线程的编号又从头数) */
export function dropChronicleParts() {
  inbox = [];
  stored = null;
  thread++;
}

function sameNames(a: Record<string, string>, b: Record<string, string>): boolean {
  if (a === b) return true;
  const ka = Object.keys(a);
  if (ka.length !== Object.keys(b).length) return false;
  return ka.every((k) => Object.prototype.hasOwnProperty.call(b, k) && a[k] === b[k]);
}

/** 历史 raw 里会写到哪些作者人物的名字、性别(没有作者立的君主 = ''):人物卡改了别的(颜色、经历……)不用重套 */
export function authorNamesKey(raw: Civ | null, chars: Chars): string {
  return raw ? authorsKey(applyCharacters({ ...raw, people: undefined }, chars)) : '';
}

/**
 * 整段历史套上改名(同 applyNames)和作者人物的名字(applyCharacters);线程按同样的改名算好了编年史的(或分小块算好了的),
 * 套的作者人物名字也一样,记进缓存。loose = 作者人物的名字不一样也先用着(照旧显示的那一份:编年史里作者人物的名字晚一点换上)
 */
export function namedHistory(raw: Civ, names: Record<string, string>, chars?: Chars, loose = false): Civ {
  const out = applyCharacters(applyNames(raw, names), chars);
  const r = ready.get(raw.annals);
  if (r && sameNames(r.names, names) && (loose || r.authors === authorsKey(out))) {
    primeChronicle(out, r.build);
    primeFullChronicle(out, r.full);
  }
  return out;
}

/** 每一小块最多占主线程多久(毫秒) */
const SLICE_MS = 8;
/** 换名字时看一次时间之间换几条 */
const RESTORE_BATCH = 64;

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
 * 这份历史有存的那一块:把名字换上,记进编年史的缓存(也分小块,每块约 SLICE_MS 毫秒)。换上了 = true;
 * 没有那一块、解不开、人物卡的性别改过、叫停了 = false
 */
async function chronicleFromBlock(civ: Civ, signal?: AbortSignal): Promise<boolean> {
  const c = civ.history ?? civ;
  const s = stored;
  if (!s || keys.get(c.annals) !== s.key) return false;
  s.block ??= readLocalPart(s.part).then(
    (v) => v as ChronicleBlock,
    () => null,
  );
  const block = await s.block;
  if (!block || !Array.isArray(block.entries) || !blockFits(block, c)) return false;
  try {
    const restore = nameRestorer(c);
    const out: ChronicleEntry[] = [];
    for (let i = 0; i < block.entries.length; ) {
      if (signal?.aborted) return false;
      const t0 = performance.now();
      for (; i < block.entries.length && performance.now() - t0 < SLICE_MS; i += RESTORE_BATCH) out.push(...restoreEntries(block.entries.slice(i, i + RESTORE_BATCH), c, restore));
      if (i < block.entries.length) await breathe();
    }
    primeChronicle(c, out.filter(inBuildChronicle));
    primeFullChronicle(c, out);
    return true;
  } catch {
    return false;
  }
}

/**
 * 备好 civ 的编年史:有存的那一块就换上名字;没有就在主线程上分小块算(religionText.ts 的 fullChronicleSteps:fullChronicle 连同其中的 buildChronicle,
 * 记进各自的缓存,和一口气算的逐条一样):每块约 SLICE_MS 毫秒,块与块之间让出主线程。算完(或早就算过)= true;signal 叫停了 = false(算了一半的扔掉)
 */
export async function chronicleInSlices(civ: Civ, signal?: AbortSignal): Promise<boolean> {
  if (fullChronicleCached(civ)) return true;
  if (await chronicleFromBlock(civ, signal)) return true;
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
  ready.set(raw.annals, { names, authors: authorsKey(full), build: buildChronicle(full), full: fullChronicle(full) });
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
export function useNamedHistory(raw: Civ | null, names: Record<string, string>, chars?: Chars): NamedHistory | null {
  const [tick, bump] = useReducer((x: number) => x + 1, 0);
  const last = useRef<NamedHistory | null>(null);
  // 作者人物只看会写进历史的名字、性别:改了人物卡上别的,历史不用重套
  const authors = useMemo(() => authorNamesKey(raw, chars), [raw, chars]);
  const charsRef = useRef(chars);
  charsRef.current = chars;
  // eslint-disable-next-line react-hooks/exhaustive-deps -- authors:写进历史的名字、性别变了才重套
  const want = useMemo(() => (raw ? namedHistory(raw, names, charsRef.current) : null), [raw, names, authors]);
  const shown = useMemo((): NamedHistory | null => {
    if (!raw || !want) return null;
    if (fullChronicleCached(want)) return { raw, full: want, names };
    const prev = last.current;
    if (prev && prev.raw === raw) return prev;
    const r = ready.get(raw.annals);
    if (r) return { raw, full: namedHistory(raw, r.names, charsRef.current, true), names: r.names };
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
