/**
 * 一份插件文件审没审过、停没停用:网站联网时取停用名单(GET /v1/plugins/verdicts),存在这个浏览器里,过了 maxAge 才再取;取不到照用上次存的。
 *
 *   → { reviewed: [{ sum, id, version }],                        审过的每一份(换下来的旧版、停用了的也在)
 *       blocked: [{ id, why, at } | { sum, why, at }],            按插件编号停这个插件所有版本,按指纹只停那一份;有停用以停用为准
 *       maxAge }                                                   秒
 */
import { call, serverBase } from '../../account/server';
import { createListeners } from '../createStore';

export interface PluginVerdict {
  reviewed: boolean;
  /** 网站停用了这一版:why 写为什么,day 哪天停的(「11 月 6 日」) */
  blocked: { why: string; day: string } | null;
}

interface Block {
  id?: string;
  sum?: string;
  why: string;
  at: string;
}

interface Saved {
  /** 取到的时间 */
  at: number;
  maxAge: number;
  reviewed: { sum: string; id: string }[];
  blocked: Block[];
}

const KEY = 'civ-atlas:plugin-verdicts';
const NONE: PluginVerdict = { reviewed: false, blocked: null };
const changed = createListeners();

function clean(raw: unknown, at: number): Saved | null {
  const o = raw as Record<string, unknown> | null;
  if (!o || typeof o !== 'object' || !Array.isArray(o.reviewed) || !Array.isArray(o.blocked)) return null;
  const s = (v: unknown, max = 200) => (typeof v === 'string' ? v.slice(0, max) : '');
  const reviewed = o.reviewed.flatMap((r: { sum?: unknown; id?: unknown }) => (r && typeof r.sum === 'string' ? [{ sum: r.sum, id: s(r.id, 80) }] : []));
  const blocked = o.blocked.flatMap((b: { id?: unknown; sum?: unknown; why?: unknown; at?: unknown }): Block[] => {
    if (!b || (typeof b.id !== 'string' && typeof b.sum !== 'string')) return [];
    return [{ ...(typeof b.id === 'string' ? { id: b.id } : { sum: b.sum as string }), why: s(b.why), at: s(b.at, 40) }];
  });
  const maxAge = typeof o.maxAge === 'number' && o.maxAge > 0 ? Math.min(o.maxAge, 7 * 86400) : 86400;
  return { at, maxAge, reviewed, blocked };
}

function read(): Saved | null {
  try {
    const raw = localStorage.getItem(KEY);
    const v = raw ? (JSON.parse(raw) as Saved) : null;
    return v && typeof v.at === 'number' ? clean(v, v.at) : null;
  } catch {
    return null;
  }
}

let saved: Saved | null = typeof localStorage === 'undefined' ? null : read();
let reviewedSums = new Set(saved?.reviewed.map((r) => r.sum));

function dayOf(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const year = d.getFullYear() === new Date().getFullYear() ? '' : `${d.getFullYear()} 年 `;
  return `${year}${d.getMonth() + 1} 月 ${d.getDate()} 日`;
}

/** 这一份(指纹 sum、插件编号 id)审没审过、停没停用 */
export function verdictOf(sum: string, id?: string): PluginVerdict {
  // 开发时截图用:window.__pluginVerdicts = { 指纹: { reviewed, blocked } }
  if (import.meta.env?.DEV) {
    const fake = (globalThis as { __pluginVerdicts?: Record<string, PluginVerdict> }).__pluginVerdicts?.[sum];
    if (fake) return fake;
  }
  if (!saved) return NONE;
  const b = saved.blocked.find((x) => (x.sum !== undefined && x.sum === sum) || (x.id !== undefined && x.id === id));
  return { reviewed: reviewedSums.has(sum), blocked: b ? { why: b.why, day: dayOf(b.at) } : null };
}

/** 停用了的那一条的键:同一次停用只提示一次 */
export function blockKey(sum: string, id: string): string | null {
  const b = saved?.blocked.find((x) => (x.sum !== undefined && x.sum === sum) || (x.id !== undefined && x.id === id));
  return b ? `${b.id ?? b.sum}@${b.at}` : null;
}

/** 从作品墙装的就是审过的那一份:名单下次取到之前先记上 */
export function markReviewed(sum: string, id: string): void {
  if (reviewedSums.has(sum)) return;
  saved = { at: saved?.at ?? 0, maxAge: saved?.maxAge ?? 86400, reviewed: [...(saved?.reviewed ?? []), { sum, id }], blocked: saved?.blocked ?? [] };
  reviewedSums = new Set(saved.reviewed.map((r) => r.sum));
  try {
    localStorage.setItem(KEY, JSON.stringify(saved));
  } catch {
    /* 存不下:这一页里用着 */
  }
  changed.emit();
}

/** 名单变了(取到新的)就调 f;返回取消订阅 */
export const subscribeVerdicts = changed.subscribe;

/** 名单的版本:组件里用它跟着名单重画 */
export const useVerdicts = (): Saved | null => changed.use(() => saved);

let trying: Promise<boolean> | null = null;
let triedAt = 0;
/** 取不到时多久再试(取到了照 maxAge) */
const RETRY_MS = 10 * 60_000;

/** 过期了(或 force)就去取;取到了 = true。没有服务器、取不到照用上次存的 */
export function refreshVerdicts(force = false): Promise<boolean> {
  if (!serverBase()) return Promise.resolve(false);
  const now = Date.now();
  if (!force && saved && now - saved.at < saved.maxAge * 1000) return Promise.resolve(false);
  if (trying) return trying;
  if (!force && now - triedAt < RETRY_MS) return Promise.resolve(false);
  trying = call<unknown>('/v1/plugins/verdicts')
    .then((raw) => {
      const next = clean(raw, Date.now());
      if (!next) throw new Error('bad-response');
      triedAt = 0;
      saved = next;
      reviewedSums = new Set(next.reviewed.map((r) => r.sum));
      try {
        localStorage.setItem(KEY, JSON.stringify(next));
      } catch {
        /* 存不下:这一页里用着 */
      }
      changed.emit();
      return true;
    })
    .catch(() => {
      triedAt = Date.now();
      return false;
    })
    .finally(() => {
      trying = null;
    });
  return trying;
}

/** 单测用:清空 */
export function _resetVerdicts(): void {
  saved = null;
  reviewedSums = new Set();
  trying = null;
  triedAt = 0;
  changed.emit();
}
