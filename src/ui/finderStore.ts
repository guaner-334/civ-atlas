/**
 * 照故事找世界那一页的状态(条件、搜到哪、选中哪个结果)。搜本身在后台线程(finderPool.ts),条件、判定在 gen/finder/query.ts。
 *
 * - 新建世界第 1 步点「照故事找世界」打开(App 交过来新建世界现在的样子:世界参数、地形、推演设定 = base),「‹ 新建世界」关掉;
 *   关掉时停下正在搜的(已经找到的留着:回来接着看,「用这个世界」以后「回去换一个」也回到这里)
 * - 条件:从例子改(FINDER_PRESETS),每国一组、「一起」一组;一次搜多少个、地图每个世界换一张还是都用这张
 * - 搜:从种子 1 起;「再搜 200 个」接着往后(停下时没推完的先补上)。同样的条件、同一批种子,结果谁搜都一样
 * - 结果:选中一个(地图换成那个世界开场那年,App 照 sel 生成)、点开看细节、排序、放宽一点(换门槛,不用重推)
 * 不碰 DOM(切到后台暂停用 finderPool 的 pauseWhenHidden,在浏览器里才挂上)。
 */
import { createListeners } from './createStore';
import {
  FINDER_PRESETS,
  nextSeeds,
  searchQuery,
  type FinderPreset,
  type FinderQuery,
  type FinderSetup,
  type FinderSort,
  type SeedReport,
} from '../gen/finder/query';
import { FINDER_COUNT, FinderSearch, PER_SEED_MS, estimateMs, finderThreads, pauseWhenHidden, type FinderProgress, type FinderThread } from './finderPool';
import { dropThumbUrls } from './finderThumb';

export type FinderPage = 'conds' | 'results' | 'detail';
export type FinderMapMode = 'each' | 'fixed';

/** 打开时新建世界的样子:搜的时候照它生成(每个世界换一张地图时种子换掉,都用这张时只换文明种子) */
export interface FinderBase {
  /** 认是不是同一个新建中的世界用(参数、地形、推演设定一样 = 一样) */
  key: string;
  /** 世界参数、地形、草图、推演设定(FinderSetup 去掉 map) */
  setup: Omit<FinderSetup, 'map'>;
}

/** 选中的结果:哪个种子;alt = 换一种配法里的第几种(−1 = 最合的那种) */
export interface FinderSel {
  seed: number;
  alt: number;
}

/** 一次搜(「开始找」以后;「再搜 200 个」接着往这里加) */
export interface FinderRun {
  /** 开始找时的条件(之后改了条件,结果还是按它算的;再点「开始找」才换) */
  query: FinderQuery;
  setup: FinderSetup;
  /** 照哪个新建中的世界、哪种地图搜的(FinderBase.key + 地图) */
  key: string;
  /** 推完的(按交回的先后) */
  reports: readonly SeedReport[];
  /** 这一批的进度(没在搜 = 最后一批的) */
  progress: FinderProgress | null;
  /** 这一批要推的几个种子(写"种子 1–200") */
  batch: { from: number; to: number; count: number };
}

export interface FinderUi {
  open: boolean;
  page: FinderPage;
  phone: boolean;
  /** 从哪个例子改的(改了条件就不再算是那个例子 = null) */
  preset: FinderPreset['id'] | null;
  query: FinderQuery;
  /** 一次搜几个 */
  count: number;
  map: FinderMapMode;
  base: FinderBase | null;
  run: FinderRun | null;
  sort: FinderSort;
  /** 放宽一点:relaxVariants 的下标(0 = 照写的) */
  variant: number;
  sel: FinderSel | null;
  /** 差一条的那几个展开着 */
  nearOpen: boolean;
}

const PRESET0 = FINDER_PRESETS[0];

const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

let state: FinderUi = {
  open: false,
  page: 'conds',
  phone: false,
  preset: PRESET0.id,
  query: clone(PRESET0.query),
  count: FINDER_COUNT.desktop,
  map: 'each',
  base: null,
  run: null,
  sort: 'fit',
  variant: 0,
  sel: null,
  nearOpen: false,
};
const subs = createListeners();
const emit = subs.emit;
const set = (patch: Partial<FinderUi>) => {
  state = { ...state, ...patch };
  emit();
};

export function getFinder(): FinderUi {
  return state;
}

export function useFinder(): FinderUi {
  return subs.use(() => state);
}

export function subscribeFinder(f: () => void): () => void {
  return subs.subscribe(f);
}

// ---- 后台在搜的这一批 ----
let search: FinderSearch | null = null;
let unhide: (() => void) | null = null;
/** 开线程(测试里换成假的;不给 = 浏览器的 Worker) */
let spawn: (() => FinderThread) | undefined;
export function setFinderSpawn(f: (() => FinderThread) | undefined) {
  spawn = f;
}

const cores = () => (typeof navigator !== 'undefined' && navigator.hardwareConcurrency) || 4;
export const finderThreadsNow = (phone: boolean) => finderThreads(cores(), phone);
/** 搜 n 个大约多久(毫秒;开搜前估,按这台机器的线程数) */
export const finderEstimate = (n: number, phone: boolean) => estimateMs(n, finderThreadsNow(phone), phone);

/** 打开找世界那一页。新建世界的样子和上次不同(换了种子、参数、地形):上次的结果作废,条件留着 */
export function openFinder(base: FinderBase, phone: boolean) {
  const same = !!state.base && state.base.key === base.key;
  const keep = same && !!state.run;
  if (!keep && state.run) {
    stopFinder();
    dropThumbUrls();
  }
  set({
    open: true,
    phone,
    base,
    page: keep ? state.page : 'conds',
    run: keep ? state.run : null,
    sel: keep ? state.sel : null,
    variant: keep ? state.variant : 0,
    count: state.base ? state.count : phone ? FINDER_COUNT.phone : FINDER_COUNT.desktop,
  });
}

/** 关掉找世界那一页(停下正在搜的;结果留着) */
export function closeFinder() {
  stopFinder();
  set({ open: false });
}

/** 换到结果 / 条件 / 一个结果的细节 */
export function setFinderPage(page: FinderPage) {
  set({ page });
}

/** 从例子改:条件换成例子的 */
export function pickPreset(id: FinderPreset['id']) {
  const p = FINDER_PRESETS.find((x) => x.id === id);
  if (p) set({ preset: id, query: presetFor(p.query, state.query) });
}

/**
 * 例子的条件套到现在的几国上:从大纲页来的几国(带 ref)按先后接过例子里每国的条件(叫法、ref 还是大纲里的);
 * 例子里多出来的国家照例子的叫法加上,大纲里多出来的几国留着(没有条件,最多 3 国)。没有从大纲来的国家 = 就是例子
 */
export function presetFor(pq: FinderQuery, cur: FinderQuery, max = 3): FinderQuery {
  const from = cur.roles.filter((r) => r.ref !== undefined);
  const q = clone(pq);
  if (!from.length) return q;
  const roles = q.roles.map((r, i) => (from[i] ? { ...r, name: from[i].name, ref: from[i].ref } : r));
  for (const r of from.slice(q.roles.length)) if (roles.length < max) roles.push({ name: r.name, ref: r.ref, conds: [] });
  return { ...q, roles };
}

/** 改了条件(改了就不再算是那个例子) */
export function setQuery(q: FinderQuery) {
  set({ query: q, preset: null });
}

export function setFinderCount(n: number) {
  set({ count: Math.max(1, Math.min(5000, Math.floor(n) || 1)) });
}

export function setFinderMap(m: FinderMapMode) {
  set({ map: m });
}

export function setFinderSort(s: FinderSort) {
  set({ sort: s });
}

/** 放宽一点:换成第 v 种门槛(再点一次换回照写的) */
export function setFinderVariant(v: number) {
  set({ variant: state.variant === v ? 0 : v, sel: null });
}

export function toggleFinderNear() {
  set({ nearOpen: !state.nearOpen });
}

/** 选中一个结果(地图换成那个世界);null = 不选 */
export function selectFinder(sel: FinderSel | null) {
  set({ sel });
}

/** 这次搜要用的生成设定 */
function setupOf(base: FinderBase, map: FinderMapMode): FinderSetup {
  return map === 'fixed' ? { ...base.setup, map: 'fixed' } : { world: base.setup.world, ...(base.setup.civ ? { civ: base.setup.civ } : {}), map: 'each' };
}

/** 开一批:推 seeds 这几个种子,结果接着加进 run */
function launch(seeds: number[]) {
  const run = state.run;
  if (!run || !seeds.length) return;
  stopFinder();
  const phone = state.phone;
  // 线程池一开就会报一次进度(还没赋给 s):那一次不收,下面开好以后自己记
  let me: FinderSearch | null = null;
  const s = new FinderSearch({
    query: run.query,
    setup: run.setup,
    seeds,
    threads: finderThreadsNow(phone),
    perSeedMs: phone ? PER_SEED_MS.phone : PER_SEED_MS.desktop,
    ...(spawn ? { spawn } : {}),
    onReport: (r) => {
      if (!me || search !== me || !state.run) return;
      set({ run: { ...state.run, reports: [...state.run.reports, r] } });
    },
    onProgress: (p) => {
      if (!me || search !== me || !state.run) return;
      set({ run: { ...state.run, progress: p } });
    },
  });
  me = s;
  search = s;
  if (typeof document !== 'undefined') unhide = pauseWhenHidden(s);
  const now = state.run ?? run;
  set({ run: { ...now, batch: { from: seeds[0], to: seeds[seeds.length - 1], count: seeds.length }, progress: s.progress() } });
}

/** 「开始找」:按现在的条件从种子 1 起搜 count 个(条件、地图和上次一样就接着上次的结果,不重推推过的) */
export function startFinder() {
  const base = state.base;
  if (!base) return;
  // 还在搜的那一批先停下(要的种子都推过了、不再开新的一批时,旧的也不能接着往这里交)
  stopFinder();
  const setup = setupOf(base, state.map);
  const key = `${base.key}|${state.map}`;
  // 从大纲页来、没加条件的几国找的时候不管它(searchQuery 去掉)
  const query = searchQuery(state.query);
  const same = state.run && JSON.stringify(state.run.query) === JSON.stringify(query) && state.run.key === key;
  const reports = same ? state.run!.reports : [];
  // 结果作废了:小图占的内存放掉
  if (!same && state.run) dropThumbUrls();
  set({
    page: 'results',
    sel: same ? state.sel : null,
    variant: 0,
    nearOpen: false,
    run: { query: clone(query), setup, key, reports, progress: null, batch: { from: 1, to: state.count, count: state.count } },
  });
  const done = new Set(reports.map((r) => r.seed));
  // 从 1 起数 count 个,推过的不再推
  const want: number[] = [];
  for (let s = 1; s <= state.count; s++) if (!done.has(s)) want.push(s);
  if (want.length) launch(want);
  else set({ run: { ...state.run!, progress: null } });
}

/** 「再搜 200 个」:接着往后(停下时没推完的先补上) */
export function moreFinder() {
  const run = state.run;
  if (!run) return;
  launch(nextSeeds(new Set(run.reports.map((r) => r.seed)), state.count, 1));
}

/** 「停下」:推了一半的作废,已经找到的留着 */
export function stopFinder() {
  const s = search;
  search = null;
  unhide?.();
  unhide = null;
  if (s) {
    s.stop();
    if (state.run) set({ run: { ...state.run, progress: s.progress() } });
  }
}

/** 正在搜(没停、没推完) */
export function finderBusy(u: FinderUi = state): boolean {
  const st = u.run?.progress?.state;
  return st === 'running' || st === 'paused';
}

/** 换了新建世界(离开新建、换了别的世界):这一页的东西都不要了 */
export function resetFinder() {
  stopFinder();
  dropThumbUrls();
  set({ open: false, base: null, run: null, sel: null, page: 'conds', variant: 0 });
}
