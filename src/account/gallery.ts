/**
 * 作品墙:作者投来、挑过以后放上去的世界、地图和新建参数。网页上只能看、拿来用、举报(界面在 ui/Gallery.tsx)。
 *
 *   GET  /v1/gallery              → { month, featured: [{ id, note }], challenges: [{ id, title, blurb, deadline, works }], works: [{ id, kind, title, by, blurb, version, addedAt }] }
 *   GET  /v1/gallery/:id          → 列表里那一项 + 世界、地图的 save(和存成文件同一格式,带 moment)/ 新建参数的 preset(预设链接 # 后面那段)
 *                                   撤下的 410 gallery-gone;没有 404
 *   GET  /v1/gallery/:id/cover    → 封面 JPEG(宽高 2:1;世界 = 政区图,地图 = 实景图,新建参数 = 星球)
 *   POST /v1/gallery/:id/report { reason } → 204;同一个网络一小时最多几次(429)
 *
 * 服务器没开作品墙时这几个接口都是 404:网页上什么都不出现(入口、空页面的精选都没有),和没配服务器一样。
 * 都不用登录。"同一台设备对同一个作品只能举报一次"记在这个浏览器里(localStorage;读写不了就只在这一页里记着)。
 */
import { useSyncExternalStore } from 'react';
import { ServerError, call, onServerChange, serverBase } from './server';

export type WorkKind = 'world' | 'map' | 'preset';

export const WORK_KIND_NAME: Record<WorkKind, string> = { world: '世界', map: '地图', preset: '新建参数' };

/** 作品墙上的一个作品(作品名、署名、一句话介绍都是作者投稿时给的) */
export interface GalleryWork {
  id: string;
  kind: WorkKind;
  title: string;
  by: string;
  blurb: string;
  /** 做这个作品时的生成器版本(新建参数的可能没有) */
  version: number | null;
  /** 上架时间(ISO 8601) */
  addedAt: string;
}

export interface GalleryFeatured {
  id: string;
  /** 推荐语 */
  note: string;
}

export interface GalleryChallenge {
  id: number;
  title: string;
  blurb: string;
  /** 截止日期 YYYY-MM-DD(那一天结束) */
  deadline: string;
  /** 挑战里的作品编号 */
  works: string[];
}

export interface GalleryList {
  /** 现在是哪个月的精选(YYYY-MM) */
  month: string;
  featured: GalleryFeatured[];
  challenges: GalleryChallenge[];
  /** 上架中的全部作品,新上架的在前 */
  works: GalleryWork[];
}

/** 取一个作品:列表那一项 + 内容 */
export interface GalleryItem extends GalleryWork {
  /** 世界、地图:存档(和存成文件同一格式) */
  save?: unknown;
  /** 新建参数:预设链接 # 后面那段(preset=1&…) */
  preset?: string;
}

/** 作品编号:8 位小写字母和数字(去掉了容易看错的 i、l、o、0、1) */
export const WORK_ID_RE = /^[a-hjkmnp-z2-9]{8}$/;

export function isWorkId(s: unknown): s is string {
  return typeof s === 'string' && WORK_ID_RE.test(s);
}

const KINDS: readonly WorkKind[] = ['world', 'map', 'preset'];
const str = (v: unknown, max: number): string => (typeof v === 'string' ? v.slice(0, max) : '');

function cleanWork(v: unknown): GalleryWork | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  if (!isWorkId(o.id) || !KINDS.includes(o.kind as WorkKind)) return null;
  return {
    id: o.id,
    kind: o.kind as WorkKind,
    title: str(o.title, 60),
    by: str(o.by, 40),
    blurb: str(o.blurb, 200),
    version: typeof o.version === 'number' && Number.isInteger(o.version) ? o.version : null,
    addedAt: str(o.addedAt, 40),
  };
}

/** 整理服务器给的列表:不像样的项去掉;精选、挑战里只留列表里有的作品 */
export function cleanGallery(raw: unknown): GalleryList {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const works: GalleryWork[] = [];
  const seen = new Set<string>();
  for (const x of Array.isArray(o.works) ? o.works : []) {
    const w = cleanWork(x);
    if (w && !seen.has(w.id)) {
      seen.add(w.id);
      works.push(w);
    }
  }
  const featured: GalleryFeatured[] = [];
  for (const x of Array.isArray(o.featured) ? o.featured : []) {
    const f = x as Record<string, unknown> | null;
    if (f && isWorkId(f.id) && seen.has(f.id) && !featured.some((y) => y.id === f.id)) featured.push({ id: f.id, note: str(f.note, 200) });
  }
  const challenges: GalleryChallenge[] = [];
  for (const x of Array.isArray(o.challenges) ? o.challenges : []) {
    const c = x as Record<string, unknown> | null;
    if (!c || typeof c.id !== 'number' || typeof c.title !== 'string') continue;
    const ids = (Array.isArray(c.works) ? c.works : []).filter((id): id is string => isWorkId(id) && seen.has(id));
    challenges.push({ id: c.id, title: str(c.title, 60), blurb: str(c.blurb, 300), deadline: str(c.deadline, 10), works: ids });
  }
  return { month: typeof o.month === 'string' && /^\d{4}-\d{2}$/.test(o.month) ? o.month : '', featured, challenges, works };
}

export async function fetchGallery(): Promise<GalleryList> {
  return cleanGallery(await call<unknown>('/v1/gallery'));
}

/** 取一个作品(撤下的:ServerError code 'gallery-gone';没有:'not-found') */
export async function fetchWork(id: string): Promise<GalleryItem> {
  const r = await call<Record<string, unknown>>(`/v1/gallery/${encodeURIComponent(id)}`);
  const w = cleanWork(r);
  if (!w || w.id !== id) throw new ServerError(200, 'bad-response', '服务器返回的内容看不懂');
  const out: GalleryItem = { ...w };
  if (w.kind === 'preset') {
    if (typeof r.preset !== 'string') throw new ServerError(200, 'bad-response', '服务器返回的内容看不懂');
    out.preset = r.preset;
  } else {
    if (!r.save || typeof r.save !== 'object') throw new ServerError(200, 'bad-response', '服务器返回的内容看不懂');
    out.save = r.save;
  }
  return out;
}

/** 撤下了(或者没有这个编号):网页上都说"这个作品已经撤下" */
export function isWorkGone(e: unknown): boolean {
  return e instanceof ServerError && (e.code === 'gallery-gone' || e.status === 410 || e.status === 404);
}

/**
 * 网址里的作品墙:?gallery = 作品墙那一页('');?gallery=<作品编号> = 打开那个作品;# 后面写的(#gallery、#gallery=<编号>)一样认。
 * 没有 = null;编号认不出的照样给(打开时说已经撤下)
 */
export function galleryOfUrl(q: URLSearchParams, hash: string): string | null {
  const v = q.get('gallery');
  if (v !== null) return v.trim().slice(0, 40);
  const m = /^#gallery(?:=([^&#]*))?$/.exec(hash);
  return m ? (m[1] ?? '').slice(0, 40) : null;
}

/**
 * 作品墙那一页(id = '')/ 一个作品在地址栏里的网址:路径 + 原来的 ?… 去掉 drop 里的几样和旧的 gallery,最后接上 gallery(=编号);
 * # 后面的不要。作品墙那一页写成不带等号的 ?gallery
 */
export function galleryHref(pathname: string, search: string, id: string, drop: readonly string[] = []): string {
  const q = new URLSearchParams(search);
  for (const k of [...drop, 'gallery']) q.delete(k);
  const rest = q.toString();
  return `${pathname}?${rest ? `${rest}&` : ''}gallery${id ? `=${encodeURIComponent(id)}` : ''}`;
}

/** 封面的地址(没有服务器 = '') */
export function coverUrl(id: string): string {
  const base = serverBase();
  return base ? `${base}/v1/gallery/${encodeURIComponent(id)}/cover` : '';
}

/** 一个作品在这个网站上的地址(出处里记的、能发给别人):网站地址/?gallery=<编号> */
export function workLink(id: string): string {
  const dir = location.pathname.replace(/[^/]*$/, '');
  return `${location.origin}${dir}?gallery=${id}`;
}

// ---------------------------------------------------------------------------
// 举报

export type ReportReason = 'illegal' | 'porn' | 'abuse' | 'privacy' | 'infringe' | 'other';

/** 六个理由(只能选,不能写字):键、说法、补一句举例 */
export const REPORT_REASONS: readonly { key: ReportReason; title: string; sub?: string }[] = [
  { key: 'illegal', title: '违法违规', sub: '危害国家安全、暴恐、赌博、毒品等' },
  { key: 'porn', title: '色情低俗' },
  { key: 'abuse', title: '辱骂、歧视、人身攻击' },
  { key: 'privacy', title: '写了真人的隐私', sub: '真实的姓名、电话、住址、照片等' },
  { key: 'infringe', title: '侵权', sub: '抄了别人的作品，或者冒用别人的署名' },
  { key: 'other', title: '其他不适合公开展示的内容' },
];

const REPORTED_KEY = 'civ-atlas:gallery-reported';
/** 读写不了浏览器存储时,这一页里记着 */
const reportedHere = new Set<string>();

function readReported(): string[] {
  try {
    const raw = localStorage.getItem(REPORTED_KEY);
    const v: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(v) ? v.filter(isWorkId) : [];
  } catch {
    return [];
  }
}

/** 这台设备举报过这个作品 */
export function wasReported(id: string): boolean {
  return reportedHere.has(id) || readReported().includes(id);
}

/** 记下举报过(最多记 500 个,多了扔掉最早的) */
export function rememberReport(id: string): void {
  reportedHere.add(id);
  try {
    const list = readReported().filter((x) => x !== id);
    list.push(id);
    localStorage.setItem(REPORTED_KEY, JSON.stringify(list.slice(-500)));
  } catch {
    /* 存不下:这一页里记着 */
  }
  emit();
}

/** 举报一个作品;这台设备举报过的不再发(当成功) */
export async function reportWork(id: string, reason: ReportReason): Promise<void> {
  if (wasReported(id)) return;
  await call(`/v1/gallery/${encodeURIComponent(id)}/report`, { method: 'POST', body: { reason } });
  rememberReport(id);
}

// ---------------------------------------------------------------------------
// 列表:取一次大家共用(我的世界的入口、空页面的精选、作品墙那一页)

export type GalleryStatus = 'idle' | 'loading' | 'off' | 'error' | 'ok';

export interface GalleryState {
  /**
   * idle 还没取 / loading 正在取 / off 没有作品墙(没配服务器、服务器没开)/ error 取不到(网络、服务器出错)/ ok 取到了。
   * 重新取的时候 list 留着上一次的
   */
  status: GalleryStatus;
  list: GalleryList | null;
  /** 取到的时间(Date.now()) */
  at: number;
  /** 举报过的作品变了(界面跟着换「已举报」) */
  rev: number;
}

let state: GalleryState = { status: 'idle', list: null, at: 0, rev: 0 };
const subs = new Set<() => void>();
let seq = 0;

function set(next: Partial<GalleryState>) {
  state = { ...state, ...next };
  for (const f of subs) f();
}
function emit() {
  set({ rev: state.rev + 1 });
}

export function getGallery(): GalleryState {
  return state;
}

export function useGallery(): GalleryState {
  return useSyncExternalStore(
    (f) => (subs.add(f), () => void subs.delete(f)),
    () => state,
    () => state,
  );
}

/** 取过以后多久内不再取(回到我的世界、进作品墙那一页时看一眼) */
const FRESH_MS = 5 * 60_000;

/**
 * 取列表。force = 不管刚取过没有(作品墙那一页的「再试一次」、进那一页时)。
 * 没配服务器 = off;404 = 服务器没开作品墙 = off;别的错 = error(列表留着上一次的)
 */
export function loadGallery(force = false): void {
  if (!serverBase()) {
    if (state.status !== 'off') set({ status: 'off', list: null });
    return;
  }
  if (state.status === 'loading') return;
  if (!force && (state.status === 'ok' || state.status === 'off') && Date.now() - state.at < FRESH_MS) return;
  const my = ++seq;
  set({ status: 'loading' });
  fetchGallery().then(
    (list) => {
      if (my === seq) set({ status: 'ok', list, at: Date.now() });
    },
    (e: unknown) => {
      if (my !== seq) return;
      if (e instanceof ServerError && e.status === 404) set({ status: 'off', list: null, at: Date.now() });
      else set({ status: 'error', at: Date.now() });
    },
  );
}

/** 单测用:清空 */
export function resetGalleryForTest(): void {
  seq++;
  reportedHere.clear();
  state = { status: 'idle', list: null, at: 0, rev: 0 };
  for (const f of subs) f();
}

onServerChange(() => {
  seq++;
  state = { ...state, status: 'idle', list: null, at: 0 };
  for (const f of subs) f();
});
