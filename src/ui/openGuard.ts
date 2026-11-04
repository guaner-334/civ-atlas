/**
 * 打开存下的世界时的几道保险:新路出了什么事,这个世界都还能走旧的路打开。
 *
 * 1. 后台线程卡住(watchLoad):读块、校验、铺像素都在线程里,一段时间(LOAD_STALL_MS)既没进度也没结果,就当它卡住了,叫 onStall(退回旧的路,发下一个请求时线程被关掉)
 * 2. 主线程卡死、页面崩了(opening*、checkCrashes):线程关得掉,主线程上的循环杀不掉。打开之前在 localStorage 记一笔「这个页面在打开哪个世界」,
 *    画面出来、又过了一会儿(SETTLE_MS)才划掉。下次打开页面看到有记录、记录它的页面又不在了,就是卡死、崩在这个世界上了。
 *    正常关页面不算(页面藏起来、要关的时候划掉;卡死的页面走不到这一步);别的标签页还开着不算(打开的这一会儿页面拿着一把自己的锁,navigator.locks 查得到它还在不在)
 * 3. 打开以后界面抛错(reportOpenCrash):抛错的时候开着的世界是新路读的,就记下来,调用方刷新页面重开
 *
 * 记下来以后,这个世界在这一版软件里不再走新路(vaultAllowed = false);出一版新软件再试一次(出了问题的代码可能已经修了)。
 * 1、2 要连着出两次事才算:只出一次多半不是世界的问题(手机太慢、系统把页面杀了、浏览器被强退),这时候退回旧的路,
 * 世界要是没有原件又是旧版本的,就按新算法生成了,代价太大。下一次还走新路,打开成了就清零。3 是确实抛错了,一次就算。
 * 这里只记状态,不提示。localStorage 用不了就少一层保险。
 */
import { APP_VERSION } from './version';

/** 线程多久没动静算卡住(毫秒):最大的世界在低端手机上慢 6 倍,一段(读取、铺像素、算沟壑)也用不了这么久 */
const LOAD_STALL_MS = 90_000;
/** 画面出来以后再过多久算打开成了(毫秒) */
const SETTLE_MS = 8000;
/** 这个页面在打开哪个世界 */
const OPENING_KEY = 'civ-atlas:opening';
/** 走新路出过事的世界(世界编号 → 软件版本、出了几次事) */
const BAD_KEY = 'civ-atlas:open-bad';
/** 连着出几次事不再走新路 */
const STRIKES = 2;
const PAGE_LOCK = 'civ-atlas:page:';
/** 没有 navigator.locks 的浏览器:记录超过这么久(毫秒)才算记它的页面不在了 */
const NO_LOCK_AGE = 60_000;
/** 查有没有崩过最多等多久(毫秒) */
const CHECK_WAIT = 1000;
const BAD_MAX = 200;

/** 几个时间(毫秒);检查脚本、单测调短 */
const timing = { stall: LOAD_STALL_MS, settle: SETTLE_MS };

interface OpeningRow {
  page: string;
  at: number;
}

const page = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;

function readJson<T extends object>(key: string): T {
  try {
    const v = JSON.parse(localStorage.getItem(key) ?? '{}') as unknown;
    return v && typeof v === 'object' ? (v as T) : ({} as T);
  } catch {
    return {} as T;
  }
}
function writeJson(key: string, v: object) {
  try {
    if (Object.keys(v).length) localStorage.setItem(key, JSON.stringify(v));
    else localStorage.removeItem(key);
  } catch {
    /* 记不下就少一层保险 */
  }
}

// ---------------------------------------------------------------------------
// 走新路出过事的世界

interface BadRow {
  app: string;
  n: number;
}

/** 这个世界这一版可以走新路 */
export function vaultAllowed(id: string): boolean {
  const r = readJson<Record<string, BadRow>>(BAD_KEY)[id];
  return !(r && r.app === APP_VERSION && r.n >= STRIKES);
}

function writeBad(id: string, n: number) {
  const bad = readJson<Record<string, BadRow>>(BAD_KEY);
  delete bad[id];
  bad[id] = { app: APP_VERSION, n };
  const ids = Object.keys(bad);
  for (const k of ids.slice(0, Math.max(0, ids.length - BAD_MAX))) delete bad[k];
  writeJson(BAD_KEY, bad);
}

/** 这个世界这一版不再走新路 */
export function markOpenBad(id: string): void {
  writeBad(id, STRIKES);
}

/** 这个世界走新路又出了一次事(线程卡住、主线程卡死、页面崩了):连着两次才不再走新路 */
export function noteOpenTrouble(id: string): void {
  const r = readJson<Record<string, BadRow>>(BAD_KEY)[id];
  writeBad(id, r?.app === APP_VERSION ? r.n + 1 : 1);
}

/** 打开成了:出过的事清零 */
function clearTrouble(id: string) {
  const bad = readJson<Record<string, BadRow>>(BAD_KEY);
  if (!bad[id] || !vaultAllowed(id)) return;
  delete bad[id];
  writeJson(BAD_KEY, bad);
}

// ---------------------------------------------------------------------------
// 主线程卡死、页面崩了

/** 打开的这一会儿拿着这把锁:别的页面查得到这个页面还在。放掉 = 这个函数 */
let releaseLock: (() => void) | null = null;
function holdPageLock() {
  if (releaseLock) return;
  try {
    const locks = navigator.locks;
    if (!locks?.request) return;
    const held = new Promise<void>((r) => (releaseLock = r));
    void locks.request(PAGE_LOCK + page, () => held).catch(() => {});
  } catch {
    /* 没有锁就按时间算 */
  }
}

let hooked = false;
/** 这个页面记的那一笔划掉 */
function clearMine() {
  releaseLock?.();
  releaseLock = null;
  const rows = readJson<Record<string, OpeningRow>>(OPENING_KEY);
  let changed = false;
  for (const [id, r] of Object.entries(rows)) {
    if (r.page === page) {
      delete rows[id];
      changed = true;
    }
  }
  if (changed) writeJson(OPENING_KEY, rows);
}

/** 正要打开这个世界(走新路):记一笔。一个页面同时只打开一个 */
export function openingStart(id: string): void {
  clearTimeout(settle);
  if (!hooked && typeof window !== 'undefined') {
    hooked = true;
    window.addEventListener('pagehide', clearMine);
    // 手机上页面藏起来以后可能不打招呼就被关掉
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') clearMine();
    });
  }
  clearMine();
  holdPageLock();
  fromVault = id;
  const rows = readJson<Record<string, OpeningRow>>(OPENING_KEY);
  rows[id] = { page, at: Date.now() };
  writeJson(OPENING_KEY, rows);
}

/** 这次不走新路了(换了世界、退回旧的路) */
export function openingClear(): void {
  clearTimeout(settle);
  fromVault = null;
  clearMine();
}

let settle: ReturnType<typeof setTimeout> | undefined;
/** 世界换上了:再过一会儿没事就算打开成了(卡死的话定时器不走,记录留着) */
export function openingShown(): void {
  clearTimeout(settle);
  const id = fromVault;
  settle = setTimeout(() => {
    clearMine();
    if (id) clearTrouble(id);
  }, timing.settle);
}

/** 记录它的页面已经不在了的世界 */
async function deadRows(rows: Record<string, OpeningRow>): Promise<string[]> {
  const now = Date.now();
  const mine = (r: OpeningRow) => r.page === page;
  const locks = typeof navigator === 'undefined' ? undefined : navigator.locks;
  let held: Set<string> | null = null;
  if (locks?.query) {
    try {
      const q = await locks.query();
      held = new Set([...(q.held ?? []), ...(q.pending ?? [])].map((l) => l.name ?? ''));
    } catch {
      held = null;
    }
  }
  return Object.entries(rows)
    .filter(([, r]) => !mine(r) && (held ? !held.has(PAGE_LOCK + r.page) : now - r.at > NO_LOCK_AGE))
    .map(([id]) => id);
}

/** 上次打开时卡死、崩了的世界记下来(见文件头) */
async function checkCrashes(): Promise<void> {
  const rows = readJson<Record<string, OpeningRow>>(OPENING_KEY);
  if (!Object.keys(rows).length) return;
  const dead = await deadRows(rows);
  if (!dead.length) return;
  // 查的这一会儿可能写了新的,重新读一遍再改
  const now = readJson<Record<string, OpeningRow>>(OPENING_KEY);
  for (const id of dead) {
    if (now[id]?.page === rows[id].page) {
      delete now[id];
      noteOpenTrouble(id);
    }
  }
  writeJson(OPENING_KEY, now);
}

let checked: Promise<void> | null = null;
/** 查过有没有崩过(整个页面只查一次,最多等一小会儿);打开世界之前等它 */
export function openGuardReady(): Promise<void> {
  checked ??= Promise.race([checkCrashes().catch(() => {}), new Promise<void>((r) => setTimeout(r, CHECK_WAIT))]);
  return checked;
}

// ---------------------------------------------------------------------------
// 界面抛错

/** 现在开着的世界是新路读的:世界编号 */
let fromVault: string | null = null;

/** 界面抛错了:开着的世界是新路读的就记下来,返回 true(调用方刷新页面重开,这次走旧的路);别的错 = false */
export function reportOpenCrash(): boolean {
  const id = fromVault;
  if (!id) return false;
  fromVault = null;
  markOpenBad(id);
  clearMine();
  return true;
}

// ---------------------------------------------------------------------------
// 后台线程卡住

let stallTimer: ReturnType<typeof setTimeout> | undefined;
let onStall: (() => void) | null = null;

/** 开始看着线程:一段时间没动静(kickLoadWatch)就叫 stalled */
export function watchLoad(stalled: () => void): void {
  onStall = stalled;
  kickLoadWatch();
}

/** 线程有动静了 */
export function kickLoadWatch(): void {
  clearTimeout(stallTimer);
  if (!onStall) return;
  stallTimer = setTimeout(() => {
    const f = onStall;
    onStall = null;
    f?.();
  }, timing.stall);
}

/** 不用看了(读完了、读不了、换了世界) */
export function endLoadWatch(): void {
  clearTimeout(stallTimer);
  onStall = null;
}

/** 单测、检查脚本用:调时间 */
export function _setOpenGuard(o: { timing?: Partial<typeof timing>; reset?: boolean }): void {
  Object.assign(timing, o.timing);
  if (o.reset) {
    checked = null;
    fromVault = null;
    endLoadWatch();
    clearTimeout(settle);
  }
}
