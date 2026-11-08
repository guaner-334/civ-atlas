/**
 * 地图上这个世界用的地图插件(world/mapNow.ts 记着):打开的世界从世界清单读、和本机插件仓库核对(被网站停用的不跑);
 * 新建中选上的从插件仓库取现在那一版的文件。只在世界用了地图插件、或者新建时选地图插件时 import()
 */
import type { WorldPlugin } from '../../gen/worldFormat';
import { mapPluginsReady } from '../../plugin/mapPlugins';
import { listPlugins, pluginFileBytes, type InstalledPlugin } from '../../plugin/pluginStore';
import { mapPluginIds, mapPluginOf, mapPluginsIn, recordParams, simParamsOf, type MapPluginCheck, type MapPluginFile } from '../../plugin/pluginWorld';
import { vaultCall } from '../worldStore';
import { getMapNow, rememberMaps, setMapNow } from '../world/mapNow';
import { subscribeVerdicts, verdictOf } from './verdict';
import { blockedChecks } from './worldPlugins';

let loadSeq = 0;

/**
 * 这个世界记的地图插件和本机核对:都有同一版、没被网站停用的带上文件;不然只带编号、指纹、滑条,交回每个插件的核对结果。
 * plugins 不给 = 读世界仓库里最新的一份(还没有这个世界 = 不动)。still() = 核对完时还在这个世界上(换了世界、又核对了一次的不算)
 */
export async function loadMapNow(id: string, plugins?: readonly WorldPlugin[], still: () => boolean = () => true): Promise<void> {
  const seq = ++loadSeq;
  const live = () => seq === loadSeq && still();
  const m = plugins ? { plugins } : await vaultCall('worldPluginsOf', [id]).catch(() => null);
  if (!m || !live()) return;
  const list = mapPluginsIn(m.plugins);
  if (!list.length) return setMapNow(null);
  const r = await mapPluginsReady(m.plugins).catch(() => null);
  if (!live()) return;
  const missing = (): MapPluginCheck[] => list.map((plugin) => ({ id: plugin.id, plugin, status: 'missing' }));
  const checks = r ? (r.ok ? null : r.checks) : missing();
  const blocked = blockedChecks(list, checks, verdictOf);
  if (r?.ok && !blocked) return setMapNow({ id, list, files: r.files, ready: true, checks: [], stored: true });
  setMapNow({ id, list, files: mapPluginIds(m.plugins), ready: false, checks: blocked ?? checks ?? [], stored: true });
}

/** 选上的一个地图插件:编号、滑条拨到几(没拨过的按默认) */
export interface MapChoice {
  id: string;
  params?: Readonly<Record<string, number>>;
}

let chooseSeq = 0;

/**
 * 新建中选上的地图插件(按出手的先后)交给生成:各用本机现在的那一版,滑条照它的清单补齐;
 * 被网站停用的、没装的、不是地图插件的、文件没了的不算。以它为底稿带过来、本机对不上的照旧列着(不带字节,长不出地图),移出才不带。
 * still() = 读完插件仓库时还在这个世界上。记下了 = true
 */
export async function chooseMaps(worldId: string, picks: readonly MapChoice[], installed?: readonly InstalledPlugin[], still: () => boolean = () => true): Promise<boolean> {
  // 文件还在读时又改了选的:只认最后一次
  const seq = ++chooseSeq;
  const prev = getMapNow();
  const carried = prev && prev.id === worldId && !prev.ready ? prev.checks.filter((c) => c.status !== 'ready') : [];
  const have = installed ?? (await listPlugins().catch(() => [] as InstalledPlugin[]));
  const list: WorldPlugin[] = [];
  const files: MapPluginFile[] = [];
  const off: MapPluginCheck[] = [];
  for (const c of picks) {
    const was = carried.find((x) => x.id === c.id);
    if (was) {
      list.push(was.plugin);
      files.push(...mapPluginIds([was.plugin]));
      off.push(was);
      continue;
    }
    const p = have.find((x) => x.id === c.id && x.current.manifest.role === 'map' && !verdictOf(x.current.sum, x.id).blocked);
    const bytes = p && (await pluginFileBytes(p.current.sum).catch(() => null));
    if (!p || !bytes) continue;
    const params = simParamsOf(p.current.manifest.map?.params, c.params);
    list.push(mapPluginOf(p.current, params));
    files.push({ id: p.id, sum: p.current.sum, bytes, ...(Object.keys(params).length ? { params } : {}) });
  }
  if (seq !== chooseSeq || !still()) return false;
  setMapNow(list.length ? { id: worldId, list, files, ready: !off.length, checks: off } : null);
  rememberMaps(worldId, list.length ? list : null);
  return true;
}

/**
 * 刷新、从「我的世界」再打开新建中的世界:照记着的选上(用本机现在那一版);没装了、被停用的去掉。
 * 交回去掉了的那几个的名字;still() = 取完时还在打开这个世界(不在了就不记)
 */
export async function restoreMaps(worldId: string, records: readonly WorldPlugin[], still: () => boolean = () => true): Promise<string[]> {
  const ok = await chooseMaps(
    worldId,
    records.map((r) => {
      const params = recordParams(r);
      return { id: r.id, ...(params ? { params } : {}) };
    }),
    undefined,
    still,
  );
  if (!ok) return [];
  const kept = getMapNow()?.id === worldId ? getMapNow()!.list.map((p) => p.id) : [];
  return records.filter((r) => !kept.includes(r.id)).map((r) => r.name ?? r.id);
}

/** 新建中选上的(没选、记着的是别的世界的 = 空) */
export function chosenMaps(worldId: string | undefined): MapChoice[] {
  const s = getMapNow();
  if (!s || s.id !== worldId) return [];
  return s.list.map((p) => {
    const params = recordParams(p);
    return { id: p.id, ...(params ? { params } : {}) };
  });
}

/**
 * 装了、删了插件、停用名单变了以后:打开的世界重新核对;以它为底稿带过来、本机对不上的再核对(装上同一版就带上);
 * 新建中选的照选的重新取(停用的去掉)
 */
export async function refreshMapNow(): Promise<void> {
  const s = getMapNow();
  if (!s) return;
  if (s.stored) return loadMapNow(s.id, undefined, () => getMapNow()?.id === s.id);
  if (!s.ready) {
    const r = await mapPluginsReady(s.list).catch(() => null);
    if (getMapNow() !== s) return;
    const blocked = blockedChecks(s.list, r && !r.ok ? r.checks : null);
    if (r?.ok && !blocked) setMapNow({ ...s, files: r.files, ready: true, checks: [] });
    else setMapNow({ ...s, checks: (blocked ?? (r && !r.ok ? r.checks : s.checks)).filter((c) => c.status !== 'ready') });
    return;
  }
  if (s.list.some((p) => verdictOf(p.sum, p.id).blocked)) await chooseMaps(s.id, chosenMaps(s.id));
}
subscribeVerdicts(() => void refreshMapNow().catch(() => {}));
