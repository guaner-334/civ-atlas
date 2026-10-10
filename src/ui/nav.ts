/**
 * 浏览器的后退、前进:每看一个画面记一步(history.pushState),按后退回到上一个画面,前进再走回来。
 *
 *   算一步   我的世界、新建世界(换一次种子算一步)、某个世界;
 *            世界里每打开一张卡片(国家、城、人物、山河、州、信仰、标记)、世界概览、史书也算一步
 *   不算     拖地图、缩放、拖时间轴、换图层、换投影、概览里换页(照旧只改网址,见 navUrl;按后退 / 前进时图层、投影照现在的,见 NavHooks.url)
 *
 * 每一步在 history.state 里记着这是哪个画面(NavState);网址照旧由各处写,navUrl 只换网址、不动这一步记的东西。
 * 一个世界里的几步:第一步(什么都没开)的序号是 bare;卡片的 ×、Esc 收起全部 = 退回 bare 那一步(后面的几步留着,前进还能回去);
 * 只收起最上面那一层(关掉概览、卡片还在)= 退回前一步。
 *
 * 按后退 / 前进(popstate):App 登记的 route() 换到那个画面(这时不再记新的一步,navTo 只改这一步记的东西);
 * 同一个世界里只是卡片不同,不用换画面。世界生成好、历史推完(navSettled)以后,再打开这一步记着的卡片、概览、史书。
 *
 * 纯状态 + history,不碰 React;单测里换一个假的 history(tests/nav.test.ts)。
 */

export type NavPage = 'home' | 'draft' | 'world';

/** 选中的东西:种类、编号,和稳定键(重推历史以后编号变了还认得出;见 flyTo.ts 的 selectionKey) */
export interface NavSel {
  kind: string;
  id: number;
  key: string;
}

/** 世界里开着的:卡片、世界概览(哪一页;编年史只看哪一国 = 那国的稳定键)、史书(读哪一部;'' = 正在写的那部) */
export interface NavLayer {
  sel?: NavSel;
  ov?: { tab: string; polity?: string };
  book?: string;
}

export interface NavState {
  /** 这个网站记的一步(别的东西放进 history.state 的不认) */
  wf: 1;
  /** 这一步在这个页面里的序号(比较新旧看是后退还是前进) */
  idx: number;
  page: NavPage;
  /** 世界编号(新建、世界) */
  id?: string;
  /** 世界名(退回来发现删掉了,提示时用) */
  title?: string;
  /** 新建:这一步的种子 */
  seed?: number;
  /** 离开时这个世界存着(回来时不在了 = 删掉了) */
  stored?: boolean;
  layer?: NavLayer;
  /** 这个画面什么都没开的那一步的序号 */
  bare: number;
  /** 前面还有这个网站的一步(没有 = 再后退就离开网站) */
  prev: boolean;
}

export interface NavInfo {
  page: NavPage;
  id?: string;
  seed?: number;
  title?: string;
}

export interface NavHooks {
  /**
   * 按后退 / 前进到了 to 这一步:换成那个画面(同一个世界里只是卡片不同时不调)。
   * 返回 'skip' = 那一步已经不在了(新建的那颗星球已经建成了世界),接着往同一个方向走
   */
  route(to: NavState, from: NavState, dir: -1 | 1): void | 'skip';
  /** 要离开现在这个画面了(换画面、按后退 / 前进):它的名字、存没存着;没存着的世界 App 自己记下 */
  describe(): { title?: string; stored?: boolean };
  /** 现在这个世界生成好、历史推完了:它的编号(还没好 = null) */
  settled(): string | null;
  /** 打开这一步记着的卡片、概览、史书;返回实际打开了的(卡片指的东西不在了就少一样) */
  apply(layer: NavLayer): NavLayer;
  /**
   * 按后退 / 前进换到 to 这一步的网址时:返回要用的网址(from = 换之前的)。
   * 不算一步的看法(图层、投影……)照换之前的,不跟着那一步的网址变回去
   */
  url?(from: string, to: string): string;
}

const W = () => globalThis as unknown as Window;

let hooks: NavHooks | null = null;
let cur: NavState | null = null;
/** 这个页面里记过的几步(按序号;只用来认"前一步是不是它") */
const entries = new Map<number, NavState>();
/** 正在按后退 / 前进换画面(这时 navTo 只改这一步记的东西) */
let routing = false;
/** 换到的世界还没好,好了再打开的卡片 */
let pending: { id: string; layer: NavLayer } | null = null;
/** 自己调的 history.go 还没到的次数(到了只换 cur,不换画面) */
let silent = 0;
/** 自己调 history.go 的途中卡片又变了:到了再算 */
let deferred: NavLayer | null = null;
/** 现在的网址(按后退 / 前进时,浏览器换网址之前的那个) */
let here = '';

export function isNavState(s: unknown): s is NavState {
  return !!s && typeof s === 'object' && (s as NavState).wf === 1 && Number.isInteger((s as NavState).idx);
}

function remember(s: NavState) {
  cur = s;
  entries.set(s.idx, s);
}

function replace(s: NavState) {
  W().history.replaceState(s, '', W().location.href);
  remember(s);
}

function push(s: NavState) {
  W().history.pushState(s, '', W().location.href);
  for (const k of [...entries.keys()]) if (k > s.idx) entries.delete(k);
  remember(s);
}

function go(n: number) {
  if (!n) return;
  silent++;
  W().history.go(n);
}

function pageOf(info: NavInfo, idx: number, prev: boolean): NavState {
  const s: NavState = { wf: 1, idx, page: info.page, bare: idx, prev };
  if (info.id !== undefined) s.id = info.id;
  if (info.seed !== undefined) s.seed = info.seed;
  if (info.title) s.title = info.title;
  return s;
}

/**
 * 打开网页时:这一步记成第一个画面(刷新时 history.state 还是上次记的:序号、前面还有没有接着用;开着的卡片不恢复),开始听后退、前进
 */
export function startNav(first: NavInfo, h: NavHooks): () => void {
  hooks = h;
  entries.clear();
  routing = false;
  pending = null;
  silent = 0;
  deferred = null;
  const was = W().history.state;
  replace(isNavState(was) ? pageOf(first, was.idx, was.prev) : pageOf(first, 0, false));
  here = W().location.href;
  W().addEventListener('popstate', onPop);
  return () => {
    W().removeEventListener('popstate', onPop);
    hooks = null;
    cur = null;
  };
}

/** 现在这一步(单测、App 判断用) */
export function getNav(): NavState | null {
  return cur;
}

/** 只换网址(种子、图层、投影……),这一步记的东西不动 */
export function navUrl(url: string) {
  const h = W().history;
  h.replaceState(h.state, '', url);
  here = W().location.href;
}

const sameInfo = (s: NavState, info: NavInfo) =>
  s.page === info.page && (info.page === 'home' || s.id === info.id) && (info.page !== 'draft' || info.seed === undefined || s.seed === info.seed);

/**
 * 换到一个新画面:记新的一步。还是同一个画面(重新载入这个世界、我的世界里又回我的世界)= 不多记;
 * 正在按后退 / 前进换画面时 = 改这一步记的东西
 */
export function navTo(info: NavInfo) {
  if (!cur || !hooks) return;
  if (routing) {
    const same = cur.page === info.page && cur.id === info.id;
    return replace({ ...pageOf(info, cur.idx, cur.prev), bare: same ? cur.bare : cur.idx, ...(same && cur.layer ? { layer: cur.layer } : {}) });
  }
  if (sameInfo(cur, info)) return replace({ ...cur, ...pageOf(info, cur.idx, cur.prev), bare: cur.bare, ...(cur.layer ? { layer: cur.layer } : {}) });
  // 退回来的世界还没好就又走了:那一步的卡片不用再开
  pending = null;
  leave();
  push(pageOf(info, cur.idx + 1, true));
}

/** 这一步换成另一个画面(新建的世界建好了:那几步新建以后按后退跳过,见 App 的 route) */
export function navReplace(info: NavInfo) {
  if (!cur) return;
  pending = null;
  replace(pageOf(info, cur.idx, cur.prev));
}

/** 浏览器自己记了一步(地址栏里贴了只有 # 不同的分享链接):记成新的一步 */
export function navAdopt(info: NavInfo) {
  if (!cur) return;
  const s = pageOf(info, cur.idx + 1, true);
  W().history.replaceState(s, '', W().location.href);
  here = W().location.href;
  remember(s);
}

/**
 * 左上的返回(新建 → 我的世界 / 底稿那个世界):前面就是那个画面(中间只隔着这次新建换过的几颗星球)= 退回去,不多记一步;
 * 不是 = false(照常 navTo)
 */
export function navBack(info: NavInfo): boolean {
  if (!cur || routing) return false;
  for (let i = cur.idx - 1; ; i--) {
    const s = entries.get(i);
    if (!s) return false;
    if (s.page === cur.page && s.id === cur.id) continue;
    if (!sameInfo(s, { ...info, seed: undefined })) return false;
    leave();
    W().history.go(i - cur.idx);
    return true;
  }
}

/** 要离开这个画面了:记下它的名字、存没存着 */
function leave() {
  if (!cur || !hooks || cur.page === 'home') return;
  const d = hooks.describe();
  replace({ ...cur, ...(d.title ? { title: d.title } : {}), ...(d.stored !== undefined ? { stored: d.stored } : {}) });
}

function sameSel(a: NavSel | undefined, b: NavSel | undefined): boolean {
  if (!a || !b) return a === b;
  return a.kind === b.kind && (a.key && b.key ? a.key === b.key : a.id === b.id);
}

export function sameLayer(a: NavLayer = {}, b: NavLayer = {}): boolean {
  return sameSel(a.sel, b.sel) && a.ov?.tab === b.ov?.tab && a.ov?.polity === b.ov?.polity && a.book === b.book;
}

const emptyLayer = (l: NavLayer) => !l.sel && !l.ov && l.book === undefined;

/** 比 was 多打开了东西:换了卡片、打开了概览、打开(或换了一部)史书;正在写的那部写完了(有了键)还是同一部 */
function opens(next: NavLayer, was: NavLayer): boolean {
  return (!!next.sel && !sameSel(next.sel, was.sel)) || (!!next.ov && !was.ov) || (next.book !== undefined && next.book !== was.book && was.book !== '');
}

/**
 * 世界里开着的东西变了(App 在画完以后报):多打开了 = 记一步;全收起 = 退回什么都没开的那一步;
 * 收起最上面那层、正好是前一步的样子 = 退回前一步;别的(概览换页、重推后编号变了)= 改这一步记的东西
 */
export function navLayer(next: NavLayer) {
  if (!cur || cur.page !== 'world' || routing || pending) return;
  if (silent) {
    deferred = next;
    return;
  }
  const was = cur.layer ?? {};
  if (sameLayer(next, was)) {
    if (JSON.stringify(next) !== JSON.stringify(was)) replace(withLayer(cur, next));
    return;
  }
  if (emptyLayer(next)) {
    if (cur.idx > cur.bare) go(cur.bare - cur.idx);
    else replace(withLayer(cur, next));
    return;
  }
  const back = entries.get(cur.idx - 1);
  if (back && cur.idx - 1 >= cur.bare && back.page === 'world' && back.id === cur.id && sameLayer(back.layer, next)) return go(-1);
  if (opens(next, was)) push({ ...withLayer(cur, next), idx: cur.idx + 1, prev: true });
  else replace(withLayer(cur, next));
}

function withLayer(s: NavState, layer: NavLayer): NavState {
  const { layer: _, ...rest } = s;
  return emptyLayer(layer) ? rest : { ...rest, layer };
}

/** 这个世界生成好、历史推完了:打开这一步记着的卡片 */
export function navSettled(id: string | null) {
  if (!pending || !hooks || id === null || pending.id !== id) return;
  const want = pending.layer;
  pending = null;
  const got = hooks.apply(want);
  if (cur && !sameLayer(got, cur.layer)) replace(withLayer(cur, got));
}

function onPop(e: PopStateEvent) {
  const s = e.state;
  // 不是这个网站记的(地址栏里只改了 #):交给 hashchange
  if (!isNavState(s) || !hooks || !cur) return;
  entries.set(s.idx, s);
  // 图层、投影这些看法不算一步:照换之前的
  const now = W().location.href;
  if (hooks.url && here && here !== now) {
    const u = hooks.url(here, now);
    if (u !== now) W().history.replaceState(s, '', u);
  }
  here = W().location.href;
  if (silent) {
    silent--;
    cur = s;
    const d = deferred;
    deferred = null;
    if (d && !silent) navLayer(d);
    return;
  }
  const from = cur;
  cur = s;
  const dir: -1 | 1 = s.idx < from.idx ? -1 : 1;
  pending = null;
  deferred = null;
  // 同一个世界里只是卡片不同:不用换画面
  const same = s.page === 'world' && from.page === 'world' && s.id === from.id;
  if (!same) {
    // 要离开的这个画面:让 App 记下没存着的世界(再前进回来时照原样打开);浏览器已经换到了 to 这一步,离开的那一步记的东西不改
    if (from.page !== 'home') hooks.describe();
    routing = true;
    let r: void | 'skip';
    try {
      r = hooks.route(s, from, dir);
    } finally {
      routing = false;
    }
    if (r === 'skip') {
      W().history.go(dir);
      return;
    }
  }
  // 世界:打开这一步记着的卡片(没开的收起);世界还没好就等 navSettled
  if (cur.page === 'world' && cur.id !== undefined) {
    pending = { id: cur.id, layer: cur.layer ?? {} };
    navSettled(hooks.settled());
  }
}

/** 单测用:回到刚加载的样子 */
export function _resetNav() {
  W().removeEventListener?.('popstate', onPop);
  hooks = null;
  cur = null;
  entries.clear();
  routing = false;
  pending = null;
  silent = 0;
  deferred = null;
  here = '';
}
