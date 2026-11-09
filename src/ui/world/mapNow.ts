/**
 * 地图上这个世界用的地图插件:新建中选上的,或者打开的世界清单里记的。长地图的请求都带上它们(worldTarget.ts 的 setupFor);
 * 本机没有同一版、被网站停用的只带编号和指纹(线程认得出是哪张地图,长不出来),改地形先核对(checks)。
 * 文件从本机插件仓库取(plugins/mapWorld.ts,用到才下载);这里只记着,首页不多带代码
 */
import { useSyncExternalStore } from 'react';
import type { WorldPlugin } from '../../gen/worldFormat';
import type { MapPluginCheck, MapPluginFile } from '../../plugin/pluginWorld';

export interface MapNow {
  /** 世界编号 */
  id: string;
  /** 用的地图插件(按出手的先后):编号、第几版、指纹、名字、滑条拨到几 */
  list: WorldPlugin[];
  /** 长地图的请求带的(和 list 一一对上);ready 才带着字节 */
  files: MapPluginFile[];
  /** 都有同一版、没被停用 */
  ready: boolean;
  /** 不 ready 时每个插件的核对结果(ready 时空着) */
  checks: MapPluginCheck[];
  /** 从世界清单读的(不是新建中选的):本机装了、删了插件、停用名单变了要重新核对 */
  stored?: boolean;
  /** 以它为底稿新建、照原样带过来的:底稿那个世界的编号(地图照它存着的放,头一回存进仓库时它的图层、星球参照跟着带过来) */
  from?: string;
}

let now: MapNow | null = null;
const subs = new Set<() => void>();

export function getMapNow(): MapNow | null {
  return now;
}

export function setMapNow(s: MapNow | null): void {
  if (s === now) return;
  now = s && s.list.length ? s : null;
  for (const f of subs) f();
}

/** 以它为底稿新建:原来那个世界的地图插件照原样带到新建的世界(id)上(同一版、同样的滑条;本机对不上的照旧对不上) */
export function carryMaps(from: string, id: string): void {
  if (!now || now.id !== from) return;
  setMapNow({ ...now, id, stored: false, from });
  rememberMaps(id, now.list);
}

/** 这个世界(id)用的地图插件本机对不上(没装、只有别的版本、被网站停用):要重新长地图的几样改不了 */
export function mapsOff(id: string | undefined): boolean {
  return !!now && now.id === id && !now.ready;
}

/** 新建中的世界选的地图插件不进世界仓库:记在这个浏览器里,刷新、从「我的世界」再打开时照它重新长 */
const DRAFT_KEY = 'civ-atlas:draft-maps:';

export function rememberMaps(id: string, list: readonly WorldPlugin[] | null): void {
  try {
    if (list?.length) localStorage.setItem(DRAFT_KEY + id, JSON.stringify(list));
    else localStorage.removeItem(DRAFT_KEY + id);
  } catch {
    // 存不下(无痕模式、满了):刷新以后照不带插件的长
  }
}

/** 记着的这个新建中的世界的地图插件(没记、读不了 = null) */
export function rememberedMaps(id: string): WorldPlugin[] | null {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(DRAFT_KEY + id) ?? 'null');
    if (!Array.isArray(v)) return null;
    const ok = v.filter((p): p is WorldPlugin => !!p && typeof p === 'object' && typeof p.id === 'string' && typeof p.sum === 'string' && p.role === 'map');
    return ok.length ? ok : null;
  } catch {
    return null;
  }
}

/** 换了世界:记着的是别的世界的就不要了 */
export function mapNowFor(id: string | null): void {
  if (now && now.id !== id) setMapNow(null);
}

/** 记着的变了就调 f;返回取消的函数 */
export function subscribeMapNow(f: () => void): () => void {
  subs.add(f);
  return () => subs.delete(f);
}

export function useMapNow(): MapNow | null {
  return useSyncExternalStore(subscribeMapNow, () => now);
}

/** 长地图要带的(没用地图插件 = undefined) */
export function mapFilesNow(): MapPluginFile[] | undefined {
  return now?.files.length ? now.files : undefined;
}

/** 两份地图插件是不是同一套(编号、指纹、滑条一样;带没带字节不算) */
export function sameMaps(a: readonly MapPluginFile[] | undefined, b: readonly MapPluginFile[] | undefined): boolean {
  const key = (l: readonly MapPluginFile[] | undefined) => JSON.stringify((l ?? []).map((p) => [p.id, p.sum, Object.entries(p.params ?? {}).sort(([x], [y]) => (x < y ? -1 : 1))]));
  return key(a) === key(b);
}

/** 页面里这个世界(id)长地图带的地图插件:没用 = undefined;本机对不上、被停用 = null */
export function mapFilesOf(id: string | undefined): MapPluginFile[] | null | undefined {
  if (!now || now.id !== id) return undefined;
  return now.ready ? now.files : null;
}

/** 这个世界(id)用了地图插件:配方链接不给(配方里没有插件,别人点开长出来是另一张图) */
export function usesMaps(id: string | undefined): boolean {
  return !!now && now.id === id;
}
