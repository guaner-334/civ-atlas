/**
 * 作品墙上的插件:服务器给的 plugin 整理成 WallPlugin;卡片上那排小标签;有没有新版。纯计算,单测直接测。
 *
 * 作品墙列表、取一个作品时的 plugin(取一个作品时多 runtime、why、description、author):
 *   { id, name, version, sum, bytes, role, api, requires, optional?, license, icon, updatedAt,
 *     note,                                   这一版改了什么(作者投这一版时写的)
 *     versions: [{ version, sum, at, note }], 审过的每一版,新的在前
 *     shots: number[] }                       审核时试跑截了图的种子(封面 /v1/gallery/:id/cover?seed=<种子>)
 */
import type { GalleryWork } from '../../account/gallery';
import { permissionLines, type PermissionKey } from '../../plugin/pluginCaps';
import { CAP_LABEL } from './pluginWords';

export interface WallVersion {
  version: string;
  sum: string;
  /** 审过的时间(ISO 8601) */
  at: string;
  note: string;
}

export interface WallPlugin {
  /** 插件编号(清单里的 id) */
  id: string;
  name: string;
  version: string;
  sum: string;
  bytes: number;
  requires: string[];
  optional: string[];
  license: string;
  /** 带不带图标(GET /v1/gallery/:id/icon) */
  icon: boolean;
  /** 这一版审过的时间(ISO 8601) */
  updatedAt: string;
  note: string;
  versions: WallVersion[];
  shots: number[];
  why?: Record<string, string>;
  description?: string;
  author?: string;
}

const VERSION = /^\d{1,6}\.\d{1,6}\.\d{1,6}$/;
const SUM = /^[0-9a-f]{64}$/;
const str = (v: unknown, max: number): string => (typeof v === 'string' ? v.slice(0, max) : '');
const strs = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').slice(0, 40) : []);

function cleanVersion(v: unknown): WallVersion | null {
  const o = v as Record<string, unknown> | null;
  if (!o || typeof o.version !== 'string' || !VERSION.test(o.version) || typeof o.sum !== 'string' || !SUM.test(o.sum)) return null;
  return { version: o.version, sum: o.sum, at: str(o.at, 40), note: str(o.note, 80) };
}

/** 整理服务器给的 plugin;不像样(没编号、版本、指纹)= null */
export function wallPlugin(raw: unknown): WallPlugin | null {
  const o = raw as Record<string, unknown> | null;
  if (!o || typeof o !== 'object') return null;
  if (typeof o.id !== 'string' || !o.id || typeof o.version !== 'string' || !VERSION.test(o.version) || typeof o.sum !== 'string' || !SUM.test(o.sum)) return null;
  const why: Record<string, string> = {};
  if (o.why && typeof o.why === 'object') for (const [k, v] of Object.entries(o.why)) if (typeof v === 'string') why[k] = v.slice(0, 200);
  const author = (o.author as { name?: unknown } | null)?.name;
  const versions = (Array.isArray(o.versions) ? o.versions : []).map(cleanVersion).filter((v): v is WallVersion => !!v);
  return {
    id: o.id.slice(0, 80),
    name: str(o.name, 60),
    version: o.version,
    sum: o.sum,
    bytes: typeof o.bytes === 'number' && Number.isSafeInteger(o.bytes) && o.bytes > 0 ? o.bytes : 0,
    requires: strs(o.requires),
    optional: strs(o.optional),
    license: str(o.license, 80),
    icon: o.icon === true,
    updatedAt: str(o.updatedAt, 40),
    note: str(o.note, 80),
    versions,
    shots: (Array.isArray(o.shots) ? o.shots : []).filter((s): s is number => Number.isSafeInteger(s)).slice(0, 6),
    ...(Object.keys(why).length ? { why } : {}),
    ...(typeof o.description === 'string' ? { description: o.description.slice(0, 400) } : {}),
    ...(typeof author === 'string' && author ? { author: author.slice(0, 40) } : {}),
  };
}

export interface WallPluginWork {
  w: GalleryWork;
  p: WallPlugin;
}

/** 作品墙「插件」页签上的:整理得出来的,最近一次上墙(新版审过也算)的在前 */
export function wallPlugins(works: readonly GalleryWork[]): WallPluginWork[] {
  const out: WallPluginWork[] = [];
  for (const w of works) {
    const p = wallPlugin(w.plugin);
    if (p) out.push({ w, p });
  }
  const at = (x: WallPluginWork) => Date.parse(x.p.updatedAt || x.w.addedAt) || 0;
  return out.sort((a, b) => at(b) - at(a));
}

/** 卡片上那排小标签(权限框那几行的短说法);loud = 看 / 改你写的东西,标黄 */
export function capChips(p: Pick<WallPlugin, 'requires' | 'optional'>): { key: PermissionKey; text: string; loud: boolean }[] {
  return permissionLines(p).map((l) => ({ key: l.key, text: CAP_LABEL[l.key] ?? l.key, loud: l.loud }));
}

/** 两个版本号比大小:a 新 = 1,一样 = 0,a 旧 = -1 */
export function compareVersions(a: string, b: string): number {
  const x = a.split('.').map(Number);
  const y = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return (x[i] ?? 0) > (y[i] ?? 0) ? 1 : -1;
  return 0;
}

/** 作品墙上一个插件现在那一版(查新版用) */
export interface WallLatest {
  /** 作品编号 */
  work: string;
  version: string;
  sum: string;
  note: string;
  /** 审过的时间(ISO 8601) */
  at: string;
  requires: string[];
  optional: string[];
  /** 作品墙上审过的各版的指纹 */
  sums: string[];
}

/** 按插件编号:作品墙上现在那一版 */
export function latestOf(works: readonly GalleryWork[]): Record<string, WallLatest> {
  const out: Record<string, WallLatest> = {};
  for (const { w, p } of wallPlugins(works)) {
    if (out[p.id]) continue;
    out[p.id] = { work: w.id, version: p.version, sum: p.sum, note: p.note, at: p.updatedAt, requires: p.requires, optional: p.optional, sums: [p.sum, ...p.versions.map((v) => v.sum)] };
  }
  return out;
}

/**
 * 装着的这一版在作品墙上有没有新版:只认从作品墙装的,或者装的那份和作品墙上某一版一个字不差的(按指纹,reviewed = 审过的指纹)
 */
export function newerOnWall(
  p: { id: string; current: { sum: string; work?: string; manifest: { version: string } } },
  latest: WallLatest | undefined,
  reviewed: (sum: string) => boolean,
): WallLatest | null {
  if (!latest || latest.sum === p.current.sum) return null;
  if (!p.current.work && !latest.sums.includes(p.current.sum) && !reviewed(p.current.sum)) return null;
  return compareVersions(latest.version, p.current.manifest.version) > 0 ? latest : null;
}
