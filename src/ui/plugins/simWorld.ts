/**
 * 地图上这个世界用的推演插件(world/simNow.ts 记着):打开的世界从世界清单读、和本机插件仓库核对;新建中选上的从插件仓库取文件
 */
import type { WorldPlugin } from '../../gen/worldFormat';
import { listPlugins, pluginFileBytes, type InstalledPlugin } from '../../plugin/pluginStore';
import { recordParams, simParamsOf, simPluginOf, simPluginsIn, type SimPluginFile } from '../../plugin/pluginWorld';
import { simPluginsReady } from '../../plugin/simPlugins';
import { getSimNow, setSimNow } from '../world/simNow';
import type { WorldEdits } from '../../gen/edits';
import { copyNotes } from '../../ai/library';
import { notify, saveAsNewVersion, storageFullWhy } from '../saveStore';
import { vaultCall } from '../worldStore';
import './simWorld.css';

/** 世界仓库里这个世界记的推演插件读进来、和本机核对;仓库里还没有这个世界 = 不动(新建中选的、另存的那一份记着) */
export async function loadSimNow(id: string): Promise<void> {
  const m = await vaultCall('worldPluginsOf', [id]).catch(() => null);
  if (!m) return;
  const list = simPluginsIn(m.plugins);
  if (!list.length) return setSimNow(null);
  const r = await simPluginsReady(m.plugins).catch(() => null);
  setSimNow({ id, list, files: r?.ok ? r.files : null, checks: r && !r.ok ? r.checks : [], stored: true });
}

/** 装了、删了插件以后:地图上这个世界的推演插件本机对不上的,再核对一遍(新建中选的不动) */
export async function refreshSimNow(): Promise<void> {
  const s = getSimNow();
  if (s && (s.stored || !s.files)) await loadSimNow(s.id);
}

/** 删了一个插件:地图上这个世界用着它的,再核对一遍(推演不再带它的文件) */
export async function forgetSim(id: string): Promise<void> {
  const s = getSimNow();
  if (s?.list.some((p) => p.id === id)) await loadSimNow(s.id);
}

/** 选上的一个推演插件:编号、滑条拨到几(没拨过的按默认) */
export interface SimChoice {
  id: string;
  params?: Readonly<Record<string, number>>;
}

const bytesOf = new Map<string, Promise<Uint8Array | null>>();
const fileOf = (sum: string) => {
  let b = bytesOf.get(sum);
  if (!b) bytesOf.set(sum, (b = pluginFileBytes(sum).catch(() => null)));
  return b;
};

/** 选上的推演插件(按出手的先后)交给推演:各用本机现在的那一版;没装、文件没了的不算 */
export async function chooseSims(worldId: string, picks: readonly SimChoice[], installed?: readonly InstalledPlugin[]): Promise<void> {
  const have = installed ?? (await listPlugins().catch(() => [] as InstalledPlugin[]));
  const list: WorldPlugin[] = [];
  const files: SimPluginFile[] = [];
  for (const c of picks) {
    const p = have.find((x) => x.id === c.id && x.current.manifest.role === 'sim');
    const bytes = p && (await fileOf(p.current.sum));
    if (!p || !bytes) continue;
    const params = simParamsOf(p.current.manifest.sim?.params, c.params);
    list.push(simPluginOf(p.current, params));
    files.push({ id: p.id, sum: p.current.sum, bytes, ...(Object.keys(params).length ? { params } : {}) });
  }
  setSimNow(list.length ? { id: worldId, list, files, checks: [] } : null);
}

/** 新建中选上的(没选、记着的是别的世界的 = 空) */
export function chosenSims(worldId: string | undefined): SimChoice[] {
  const s = getSimNow();
  if (!s || s.id !== worldId) return [];
  return s.list.map((p) => {
    const params = recordParams(p);
    return { id: p.id, ...(params ? { params } : {}) };
  });
}

/** 只装了推演插件别的版本:另存一份(带着 next 这次的修改),按本机现在那一版从第 0 年重推(滑条照原来的);存好交新编号、AI 写的史书跟过去没有 */
export async function copyWithSims(from: string, next: WorldEdits, open: (id: string, notes: boolean) => void): Promise<void> {
  const id = saveAsNewVersion(from, next);
  if (!id) return void notify({ kind: 'error', text: '没能另存', more: [storageFullWhy()] });
  const notes = copyNotes(from, id);
  await chooseSims(id, chosenSims(getSimNow()?.id));
  open(id, notes);
}
