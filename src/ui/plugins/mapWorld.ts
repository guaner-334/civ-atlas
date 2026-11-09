/**
 * 地图上这个世界用的地图插件(world/mapNow.ts 记着):打开的世界从世界清单读、和本机插件仓库核对(被网站停用的不跑);
 * 新建中选上的从插件仓库取现在那一版的文件。只在世界用了地图插件、或者新建时选地图插件时 import()。
 * 网站关了插件(插件界面关着)时一个都不跑:不读插件文件,本机装着同一版的也只带编号和指纹
 */
import type { WorldPlugin } from '../../gen/worldFormat';
import { mapPluginsReady } from '../../plugin/mapPlugins';
import { listPlugins, pluginFileBytes, type InstalledPlugin } from '../../plugin/pluginStore';
import { checkMapPlugins, mapPluginIds, mapPluginKey, mapPluginOf, mapPluginsIn, recordParams, simParamsOf, type MapPluginCheck, type MapPluginFile } from '../../plugin/pluginWorld';
import { vaultCall } from '../worldStore';
import { currentWorld } from '../saveStore';
import { getMapNow, rememberMaps, setMapNow, type MapNow } from '../world/mapNow';
import { pluginsUiOn } from './flag';
import { subscribeVerdicts, verdictOf } from './verdict';
import { versionLabel } from './pluginWords';
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
  // 以它为底稿带过来、刚建好还没存进仓库的:底稿是哪个世界照旧记着
  const was = getMapNow();
  const from = was?.id === id && was.from && sameRecords(was.list, list) ? { from: was.from } : {};
  await setChecked(id, list, live, { stored: true, ...from });
}

/** 两串地图插件记录是不是同一套(编号、指纹、滑条、先后) */
const sameRecords = (a: readonly WorldPlugin[], b: readonly WorldPlugin[]): boolean => JSON.stringify(mapPluginIds(a).map(mapPluginKey)) === JSON.stringify(mapPluginIds(b).map(mapPluginKey));

/** 网站关了插件时的核对:只看装没装、停没停用,不读插件文件;装着同一版的照旧记 ready(只是这时不跑) */
async function offChecks(list: readonly WorldPlugin[]): Promise<MapPluginCheck[]> {
  const checks = checkMapPlugins(list, await listPlugins().catch(() => [] as InstalledPlugin[]));
  return blockedChecks(list, checks, verdictOf) ?? checks;
}

/** 和本机核对这一串:都有同一版、没被网站停用的带上文件;不然只带编号、指纹、滑条和每个的核对结果 */
async function setChecked(id: string, list: readonly WorldPlugin[], live: () => boolean, more: Pick<MapNow, 'stored' | 'from'>): Promise<void> {
  if (!pluginsUiOn()) {
    const checks = await offChecks(list);
    if (live()) setMapNow({ id, list: [...list], files: mapPluginIds(list), ready: false, checks, ...more });
    return;
  }
  const r = await mapPluginsReady(list).catch(() => null);
  if (!live()) return;
  const missing = (): MapPluginCheck[] => list.map((plugin) => ({ id: plugin.id, plugin, status: 'missing' }));
  const checks = r ? (r.ok ? null : r.checks) : missing();
  const blocked = blockedChecks(list, checks, verdictOf);
  if (r?.ok && !blocked) return setMapNow({ id, list: [...list], files: r.files, ready: true, checks: [], ...more });
  setMapNow({ id, list: [...list], files: mapPluginIds(list), ready: false, checks: blocked ?? checks ?? [], ...more });
}

/** 选上的一个地图插件:编号、滑条拨到几(没拨过的按默认) */
export interface MapChoice {
  id: string;
  params?: Readonly<Record<string, number>>;
}

let chooseSeq = 0;

/**
 * 新建中选上的地图插件(按出手的先后)交给生成:各用本机现在的那一版,滑条照它的清单补齐;
 * 被网站停用的、没装的、不是地图插件的、文件没了的不算。以它为底稿带过来、本机对不上的照旧列着(不带字节,长不出地图),移出才不带;
 * swap 里的几个换成本机现在那一版(滑条照旧)。still() = 读完插件仓库时还在这个世界上。记下了 = true
 */
export async function chooseMaps(worldId: string, picks: readonly MapChoice[], installed?: readonly InstalledPlugin[], still: () => boolean = () => true, swap: readonly string[] = []): Promise<boolean> {
  // 文件还在读时又改了选的:只认最后一次
  const seq = ++chooseSeq;
  const prev = getMapNow();
  // 网站关了插件:不取插件文件,带过来的照旧列着(装着同一版的也不跑),别的选不上
  const shut = !pluginsUiOn();
  const carried = prev && prev.id === worldId && !prev.ready ? prev.checks.filter((c) => (shut || c.status !== 'ready') && !swap.includes(c.id)) : [];
  const have = shut ? [] : (installed ?? (await listPlugins().catch(() => [] as InstalledPlugin[])));
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
 * 以别的世界为底稿(base)、记着的就是底稿那一套:照原样带着(本机对不上的照旧对不上,地图照底稿存着的放)。
 * 交回去掉了的那几个的名字;still() = 取完时还在打开这个世界(不在了就不记)
 */
export async function restoreMaps(worldId: string, records: readonly WorldPlugin[], still: () => boolean = () => true, base?: string): Promise<string[]> {
  const had = base ? await vaultCall('worldPluginsOf', [base]).catch(() => null) : null;
  if (base && had && sameRecords(mapPluginsIn(had.plugins), records)) {
    const seq = ++loadSeq;
    await setChecked(worldId, records, () => seq === loadSeq && still(), { stored: false, from: base });
    return [];
  }
  // 网站关了插件:这次照不带它们的长,记着的不动(插件开回来再打开照它取回)
  if (!pluginsUiOn()) {
    if (still()) setMapNow(null);
    return records.map((r) => r.name ?? r.id);
  }
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

/** 以它为底稿带过来、本机只有别的版本的那几个换成本机这一版(地图要重新长)。换好了 = true */
export function swapMaps(worldId: string, ids: readonly string[]): Promise<boolean> {
  return chooseMaps(worldId, chosenMaps(worldId), undefined, () => getMapNow()?.id === worldId, ids);
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
  // 刚建好、仓库里还没记上的:和打开的世界一样核对(删了插件,改地形要先问)
  const cur = currentWorld();
  if (cur?.id === s.id && cur.kind !== 'draft') return loadMapNow(s.id, s.list, () => getMapNow()?.id === s.id);
  if (!s.ready) {
    if (!pluginsUiOn()) {
      const checks = await offChecks(s.list);
      if (getMapNow() === s) setMapNow({ ...s, checks });
      return;
    }
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

/** 存着的一个世界用的地图插件和本机核对的结果:files = 都有同一版、没被停用(能带着长这张地图);不然 off 写哪里对不上 */
export interface StoredMaps {
  files: MapPluginFile[] | null;
  off: string | null;
}

const offText = (c: MapPluginCheck): string => {
  const name = `「${c.plugin.name ?? c.id}」`;
  if (c.status === 'other') return `${name}你装的是${versionLabel(c.installed.version)}`;
  if (c.status === 'blocked') return `${name}网站停用了`;
  return `你没装${name}`;
};

/** 网站关了插件、本机都装着同一版时那一句 */
export const MAPS_OFF = '网站暂时关了插件';

/** 这几个世界(编号)里用了地图插件的:世界清单读出来和本机核对;没用的不在结果里。网站关了插件时都长不了,不读插件文件 */
export async function storedMapsOf(ids: readonly string[]): Promise<Map<string, StoredMaps>> {
  const out = new Map<string, StoredMaps>();
  const shut = !pluginsUiOn();
  await Promise.all(
    ids.map(async (id) => {
      const m = await vaultCall('worldPluginsOf', [id]).catch(() => null);
      const list = m ? mapPluginsIn(m.plugins) : [];
      if (!m || !list.length) return;
      if (shut) return void out.set(id, { files: null, off: (await offChecks(list)).filter((c) => c.status !== 'ready').map(offText).join('、') || MAPS_OFF });
      const r = await mapPluginsReady(m.plugins).catch(() => null);
      const checks = r ? (r.ok ? null : r.checks) : list.map((plugin): MapPluginCheck => ({ id: plugin.id, plugin, status: 'missing' }));
      const blocked = blockedChecks(list, checks, verdictOf);
      if (r?.ok && !blocked) return void out.set(id, { files: r.files, off: null });
      out.set(id, { files: null, off: (blocked ?? checks ?? []).filter((c) => c.status !== 'ready').map(offText).join('、') || '地图插件对不上' });
    }),
  );
  return out;
}
