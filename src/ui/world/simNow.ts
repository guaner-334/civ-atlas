/**
 * 地图上这个世界用的推演插件:新建中选上的,或者打开的世界清单里记的。推演的请求带上它们的文件(worldTarget.ts 的 setupFor)。
 * 文件从本机插件仓库取(plugins/simWorld.ts,插件界面开着才下载);这里只记着,首页不多带代码
 */
import { useSyncExternalStore } from 'react';
import type { WorldPlugin } from '../../gen/worldFormat';
import type { SimPluginCheck, SimPluginFile } from '../../plugin/pluginWorld';

export interface SimNow {
  /** 世界编号 */
  id: string;
  /** 用的推演插件(按出手的先后):编号、第几版、指纹、名字、滑条拨到几 */
  list: WorldPlugin[];
  /** 都对得上 = 推演带的文件(和 list 一一对上);有没装、只有别的版本的 = null */
  files: SimPluginFile[] | null;
  /** files 是 null 时每个插件的核对结果 */
  checks: SimPluginCheck[];
}

let now: SimNow | null = null;
const subs = new Set<() => void>();

export function getSimNow(): SimNow | null {
  return now;
}

export function setSimNow(s: SimNow | null): void {
  if (s === now) return;
  now = s && s.list.length ? s : null;
  for (const f of subs) f();
}

/** 换了世界:记着的是别的世界的就不要了 */
export function simNowFor(id: string | null): void {
  if (now && now.id !== id) setSimNow(null);
}

export function useSimNow(): SimNow | null {
  return useSyncExternalStore(
    (f) => {
      subs.add(f);
      return () => subs.delete(f);
    },
    () => now,
  );
}

/** 推演要带的文件(没用推演插件、有对不上的 = undefined) */
export function simFilesNow(): SimPluginFile[] | undefined {
  return now?.files?.length ? now.files : undefined;
}

/** 两份推演插件是不是同一套:编号、指纹、滑条一样 */
export function sameSims(a: readonly SimPluginFile[] | undefined, b: readonly SimPluginFile[] | undefined): boolean {
  const key = (l: readonly SimPluginFile[] | undefined) => JSON.stringify((l ?? []).map((p) => [p.id, p.sum, Object.entries(p.params ?? {}).sort(([x], [y]) => (x < y ? -1 : 1))]));
  return key(a) === key(b);
}

/** 页面里这个世界(id)推演带的推演插件:没用 = undefined;本机对不上 = null */
export function simsOf(id: string | undefined): SimPluginFile[] | null | undefined {
  if (!now || now.id !== id) return undefined;
  return now.files;
}
