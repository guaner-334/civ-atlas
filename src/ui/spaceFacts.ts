/** 首页也要用,所以这里不碰世界仓库。苹果设备上 estimate 不能信:清掉世界后用量不变小,额度又跟着用量涨。 */
import { createListeners } from './createStore';

export const NEAR_FULL_BYTES = 500e6;
/** 额度本来就不到 2 GB 的设备平时就不到 NEAR_FULL_BYTES,不能一直算快满了 */
const NEAR_FULL_SHARE = 1 / 4;
const DAY_MS = 24 * 3600_000;
export const LOSE_OFF_MS = 14 * DAY_MS;
export const LOSE_AGAIN_DAYS = 14;

export type AppleDevice = 'iphone' | 'ipad' | 'safari';

interface NavFacts {
  userAgent?: string;
  maxTouchPoints?: number;
}
const navFacts = (): NavFacts => (typeof navigator === 'undefined' ? {} : navigator);

/** iPad 的浏览器会自称 Mac,没有触摸屏的 Mac 才是 Mac;苹果手机、平板上别家的浏览器内核也是 WebKit */
export function appleDevice(n: NavFacts = navFacts()): AppleDevice | null {
  const ua = n.userAgent ?? '';
  if (/iPhone|iPod/.test(ua)) return 'iphone';
  if (/iPad/.test(ua)) return 'ipad';
  if (/Macintosh/.test(ua) && (n.maxTouchPoints ?? 0) > 1 && !/Chrome\//.test(ua)) return 'ipad';
  if (/Chrome|Chromium|Edg|OPR|Firefox|Android/.test(ua)) return null;
  return /Safari/.test(ua) ? 'safari' : null;
}

export const inSmallWindow = (n: NavFacts = navFacts()): boolean => /MicroMessenger|\bQQ\/\d/i.test(n.userAgent ?? '');

export const isFirefox = (n: NavFacts = navFacts()): boolean => /firefox/i.test(n.userAgent ?? '');

export interface RoomFacts {
  usage: number;
  quota: number;
}

export async function rawRoom(): Promise<RoomFacts | null> {
  try {
    const e = await navigator.storage?.estimate?.();
    return e?.usage !== undefined && e.quota !== undefined ? { usage: e.usage, quota: e.quota } : null;
  } catch {
    return null;
  }
}

/** 给人看的:苹果设备上不问,不写假的数字 */
export const askRoom = async (): Promise<RoomFacts | null> => (appleDevice() ? null : rawRoom());

export const roomLeft = (r: RoomFacts): number => Math.max(0, r.quota - r.usage);

export const isNearFull = (r: RoomFacts): boolean => roomLeft(r) < Math.min(NEAR_FULL_BYTES, r.quota * NEAR_FULL_SHARE);

export async function askPersisted(): Promise<boolean> {
  try {
    return !!(await navigator.storage?.persisted?.());
  } catch {
    return false;
  }
}

const FILES = 'civ-atlas:file-saved';
const LOSE_OFF = 'civ-atlas:lose-off';
const NEAR_OFF = 'civ-atlas:near-off';
const FIRST_SAID = 'civ-atlas:lose-first';
/** Firefox 只问一次长期保存 */
export const PERSIST_ASKED = 'civ-atlas:persist-asked';

/** localStorage 满了时,这次打开还算数 */
const mem = new Map<string, string>();
function read(k: string): string | null {
  if (mem.has(k)) return mem.get(k)!;
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
}
function write(k: string, v: string) {
  try {
    localStorage.setItem(k, v);
    mem.delete(k);
  } catch {
    mem.set(k, v);
  }
}

/** 调用方先看过 askPersisted */
export const firefoxAsked = (): boolean => isFirefox() && read(PERSIST_ASKED) !== null;

const listeners = createListeners();
export const spaceChanged = listeners.emit;
export const onSpaceChange = listeners.subscribe;

let vaultFullNow = false;
export const vaultFullSeen = (): boolean => vaultFullNow;
export function noteVaultFull(on: boolean) {
  if (vaultFullNow === on) return;
  vaultFullNow = on;
  spaceChanged();
}

/** 只在本机,不进文件、不同步。下载只知道点了,不知道真存下没有,按点了算 */
export interface FileRecord {
  at: number;
  /** saveMark */
  mark: string;
}

export function fileRecords(): Record<string, FileRecord> {
  try {
    const v = JSON.parse(read(FILES) ?? '{}') as unknown;
    return v && typeof v === 'object' ? (v as Record<string, FileRecord>) : {};
  } catch {
    return {};
  }
}

export function noteFileSaved(rows: readonly { id: string; mark: string }[], alive: (id: string) => boolean = () => true, at = Date.now()) {
  const next: Record<string, FileRecord> = {};
  for (const [id, r] of Object.entries(fileRecords())) if (alive(id)) next[id] = r;
  for (const r of rows) next[r.id] = { at, mark: r.mark };
  write(FILES, JSON.stringify(next));
  spaceChanged();
}

/** 投影、存档时间不算改过 */
export function saveMark(s: { params: unknown; title?: string; edits: unknown; origin?: unknown }): string {
  const text = JSON.stringify([s.params, s.title ?? '', s.edits, s.origin ?? null]);
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return `${(h >>> 0).toString(36)}.${text.length.toString(36)}`;
}

export type FileStatus = { kind: 'never' } | { kind: 'same'; at: number } | { kind: 'changed'; at: number };

export function fileStatus(rec: FileRecord | undefined, mark: string): FileStatus {
  if (!rec) return { kind: 'never' };
  return { kind: rec.mark === mark ? 'same' : 'changed', at: rec.at };
}

const stamp = (k: string): number | null => {
  const n = Number(read(k));
  return read(k) !== null && Number.isFinite(n) ? n : null;
};

export const loseOffAt = (): number | null => stamp(LOSE_OFF);
export function closeLose(now = Date.now()) {
  write(LOSE_OFF, String(now));
  spaceChanged();
}

export const nearOffAt = (): number | null => stamp(NEAR_OFF);
export function closeNear(left: number) {
  write(NEAR_OFF, String(left));
  spaceChanged();
}
export function nearOver() {
  try {
    localStorage.removeItem(NEAR_OFF);
  } catch {
    /* 删不掉也只是少说一次 */
  }
  mem.delete(NEAR_OFF);
}

export const firstHintSaid = (): boolean => read(FIRST_SAID) !== null;
export const noteFirstHint = () => write(FIRST_SAID, '1');

export type SpaceBarState = { kind: 'full'; unsaved: number } | { kind: 'count' } | { kind: 'near'; left: number } | { kind: 'lose-never'; n: number; all: boolean; device: AppleDevice } | { kind: 'lose-changed'; n: number; days: number; device: AppleDevice } | { kind: 'lose-small' };

export type LoseBar = Extract<SpaceBarState, { kind: `lose-${string}` }>;

export interface LoseFacts {
  device: AppleDevice | null;
  small: boolean;
  loggedIn: boolean;
  /** null = 还没问到,先不说 */
  persisted: boolean | null;
  /** 还在新建的不算 */
  files: readonly FileStatus[];
  offAt: number | null;
  now: number;
}

/** QQ、微信的小窗口存不了文件也留不久,不分系统,换一句话 */
export function loseBar(f: LoseFacts): LoseBar | null {
  if (f.loggedIn || f.persisted !== false || (!f.device && !f.small)) return null;
  if (f.offAt !== null && f.now - f.offAt < LOSE_OFF_MS) return null;
  const never = f.files.filter((s) => s.kind === 'never').length;
  const changed = f.files.flatMap((s) => (s.kind === 'changed' ? [s.at] : []));
  if (!never && !changed.length) return null;
  if (f.small) return { kind: 'lose-small' };
  const device = f.device!;
  if (never) return { kind: 'lose-never', n: never, all: never === f.files.length, device };
  const days = Math.floor((f.now - Math.max(...changed)) / DAY_MS);
  return days >= LOSE_AGAIN_DAYS ? { kind: 'lose-changed', n: changed.length, days, device } : null;
}

/** offLeft:关掉时还能存多少,剩下的再少一半才再说 */
export function nearBar(room: RoomFacts | null, offLeft: number | null): Extract<SpaceBarState, { kind: 'near' }> | null {
  if (!room || !isNearFull(room)) return null;
  const left = roomLeft(room);
  return offLeft !== null && left >= offLeft / 2 ? null : { kind: 'near', left };
}

/** 满了 > 到上限 > 快满了 > 防丢。满了关掉后这次打开什么都不说,不接着催 */
export function pickBar(f: { full: { unsaved: number } | null; atCount: boolean; near: SpaceBarState | null; lose: LoseBar | null; off: { full: boolean; count: boolean } }): SpaceBarState | null {
  if (f.full) return f.off.full ? null : { kind: 'full', unsaved: f.full.unsaved };
  if (f.atCount && !f.off.count) return { kind: 'count' };
  return f.near ?? f.lose;
}
