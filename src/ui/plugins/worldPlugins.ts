/**
 * 打开着的世界和插件:用到了哪些插件、哪些存了自己的数据(存了的世界不能公开分享)、本机没装的;
 * 插件往世界里存自己的数据(store.world):每个世界第一次存时先问一句;去掉插件存的数据;推演插件推演时带哪几个。
 */
import { PLUGIN_DATA_PREFIX, type WorldPlugin } from '../../gen/worldFormat';
import { PluginApiError } from '../../plugin/check';
import { worldDataStore } from '../../plugin/pluginData';
import { listPlugins, pluginFileBytes, type InstalledPlugin } from '../../plugin/pluginStore';
import { pluginsInWorld, recordParams, simParamsOf, simPluginOf, simPluginsIn, type SimPluginCheck, type SimPluginFile, type WorldPluginUse } from '../../plugin/pluginWorld';
import { simPluginsReady } from '../../plugin/simPlugins';
import { approxBytes } from '../../plugin/protocol';
import type { PluginDataStore } from '../../plugin/store';
import { keptMapOf, type WorldEdits } from '../../gen/edits';
import { copyNotes } from '../../ai/library';
import { currentWorld, keepWorld, notify, saveAsNewVersion, storageFullWhy } from '../saveStore';
import { getSimNow, setSimNow } from '../world/simNow';
import { settleWorld, vaultCall } from '../worldStore';
import { askData, kbText } from './askState';
import { pluginsUiOn } from './flag';
import { subscribeVerdicts, verdictOf, type PluginVerdict } from './verdict';
import './worldData.css';

/** 世界里用到的一个插件,连同叫什么(清单里记的名字,没记看本机装的,都没有写编号) */
export interface UsedPlugin extends WorldPluginUse {
  name: string;
  installed: InstalledPlugin | null;
}

/** 这个世界用到的插件(按清单里的先后);读不了 = 空 */
export async function usedPlugins(worldId: string): Promise<UsedPlugin[]> {
  const [m, installed] = await Promise.all([vaultCall('worldPluginsOf', [worldId]).catch(() => null), listPlugins().catch(() => [] as InstalledPlugin[])]);
  if (!m) return [];
  return pluginsInWorld(m, installed).map((u) => {
    const have = installed.find((p) => p.id === u.id) ?? null;
    return { ...u, name: u.plugin?.name ?? have?.current.manifest.name ?? u.id, installed: have };
  });
}

/** 存了自己数据的插件(这几个让世界不能公开分享) */
export const withData = (list: readonly UsedPlugin[]): UsedPlugin[] => list.filter((u) => u.data);

/** 名字连起来:「城邦税赋」「起名助手」 */
export const namesText = (list: readonly { name: string }[]): string => list.map((u) => `「${u.name}」`).join('');

/** 打开世界时要说的那句:存了自己数据、本机没装的插件(只存了图层的不算);没有 = null */
export async function missingNote(worldId: string): Promise<string | null> {
  const miss = withData(await usedPlugins(worldId)).filter((u) => u.here === 'none');
  return miss.length ? `用到了你没装的插件${namesText(miss)}，它${miss.length > 1 ? '们' : ''}存的数据原样留着` : null;
}

/** 打开世界时那一句里没装的插件:作品墙上现在正是世界记的那一版的,交作品编号(给「去作品墙装同一版」);没有 = null */
export async function missingWall(worldId: string): Promise<string | null> {
  const miss = withData(await usedPlugins(worldId)).filter((u) => u.here === 'none' && u.plugin);
  const { wallWorkOf } = await import('./galleryWatch');
  for (const u of miss) {
    const w = wallWorkOf(u.id, u.plugin!.sum);
    if (w) return w;
  }
  return null;
}

/** 去掉这个世界里所有插件存的数据(先问一句);去掉了 = true */
export async function removePluginData(worldId: string, list: readonly UsedPlugin[]): Promise<boolean> {
  const data = withData(list);
  if (!data.length) return false;
  const bytes = data.reduce((n, u) => n + (u.data?.bytes ?? 0), 0);
  if (!(await askData({ kind: 'remove', plugins: data.map((u) => u.name), kb: kbText(bytes) }))) return false;
  for (const u of data) {
    const rec: WorldPlugin = u.plugin ?? { id: u.id, version: '0', sum: '0'.repeat(64), role: 'tool' };
    await vaultCall('changePluginData', [worldId, rec, null]);
  }
  return true;
}

/** 这个世界、这个插件:这次打开里点过「存进这个世界」的(不再问)、点过「这次不存」的(不再问,直接回插件不行) */
const agreed = new Set<string>();
const declined = new Set<string>();
const asking = new Map<string, Promise<boolean>>();

/** 世界还没存进「我的世界」的先存下来再写 */
async function write(st: PluginDataStore, worldId: string, pid: string, data: Parameters<PluginDataStore['set']>[1]) {
  keepWorld(worldId);
  try {
    await st.set(pid, data);
  } catch (e) {
    if (!(e instanceof PluginApiError) || e.code !== 'unavailable') throw e;
    await settleWorld(worldId);
    await st.set(pid, data);
  }
}

/**
 * 插件存进打开着的世界的数据:每个世界第一次存(世界里还没有它的数据)时先问用的人;点「这次不存」回插件 cancelled,
 * 这次打开里不再问。record = 世界清单里记的这个插件,name = 框上写的名字
 */
export function askingWorldStore(record: WorldPlugin, name: string): PluginDataStore {
  const store = (worldId: string) => worldDataStore(vaultCall, worldId, record);
  const world = () => currentWorld()?.id ?? null;
  return {
    get: (pid) => {
      const w = world();
      if (!w) throw new PluginApiError('unavailable', '还没有打开世界');
      return store(w).get(pid);
    },
    set: async (pid, data) => {
      const w = world();
      if (!w) throw new PluginApiError('unavailable', '还没有打开世界');
      const key = `${w}\n${pid}`;
      // 去掉:不用问;世界还没存下来就本来没有
      if (!data)
        return void (await Promise.resolve(store(w).set(pid, null)).catch((e: unknown) => {
          if (!(e instanceof PluginApiError && e.code === 'unavailable')) throw e;
        }));
      if (!agreed.has(key)) {
        const m = await vaultCall('worldPluginsOf', [w]).catch(() => null);
        if (!m?.parts.some((p) => p.name === `${PLUGIN_DATA_PREFIX}${pid}`)) {
          if (declined.has(key)) throw new PluginApiError('cancelled', '用的人这次没让存进这个世界');
          let q = asking.get(key);
          if (!q) {
            q = askData({ kind: 'store', plugin: name, pluginId: pid, sum: record.sum, kb: kbText(approxBytes(data.value, Infinity)) });
            asking.set(key, q);
            void q.finally(() => asking.delete(key));
          }
          if (!(await q)) {
            declined.add(key);
            throw new PluginApiError('cancelled', '用的人这次没让存进这个世界');
          }
        }
        agreed.add(key);
      }
      await write(store(w), w, pid, data);
    },
  };
}

// ---------------------------------------------------------------------------
// 推演插件:地图上这个世界用的(world/simNow.ts 记着);打开的世界从世界清单读、和本机插件仓库核对,新建中选上的从插件仓库取文件

/**
 * 世界记的推演插件里被网站停用的(按编号或世界记的那一版的指纹)换成 blocked,其余照 checks(没给 = 都对得上);
 * 一个都没停用 = null。verdict 默认看停用名单(单测换掉)
 */
export function blockedChecks(list: readonly WorldPlugin[], checks: readonly SimPluginCheck[] | null, verdict: (sum: string, id: string) => PluginVerdict = verdictOf): SimPluginCheck[] | null {
  let any = false;
  const out = list.map((plugin): SimPluginCheck => {
    const b = verdict(plugin.sum, plugin.id).blocked;
    if (!b) return checks?.find((c) => c.id === plugin.id) ?? { id: plugin.id, plugin, status: 'ready', which: 'current' };
    any = true;
    return { id: plugin.id, plugin, status: 'blocked', why: b.why, day: b.day };
  });
  return any ? out : null;
}

/**
 * 世界仓库里这个世界记的推演插件读进来、和本机核对(被网站停用的不跑);仓库里还没有这个世界 = 不动(新建中选的、另存的那一份记着)。
 * 网站关了插件(插件界面关着)时本机装着的也不跑:都当作对不上,要接着推先问
 */
export async function loadSimNow(id: string): Promise<void> {
  const m = await vaultCall('worldPluginsOf', [id]).catch(() => null);
  if (!m) return;
  const list = simPluginsIn(m.plugins);
  if (!list.length) return setSimNow(null);
  if (!pluginsUiOn()) return setSimNow({ id, list, files: null, checks: list.map((plugin): Missing => ({ id: plugin.id, plugin, status: 'missing' })), stored: true });
  const r = await simPluginsReady(m.plugins).catch(() => null);
  const blocked = blockedChecks(list, r && !r.ok ? r.checks : null);
  setSimNow({ id, list, files: r?.ok && !blocked ? r.files : null, checks: blocked ?? (r && !r.ok ? r.checks : []), stored: true });
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

type Missing = Extract<SimPluginCheck, { status: 'missing' }>;

/** 以它为底稿带过来、本机没装的(装上或移出以前不能开始推演) */
export function carriedMissing(worldId: string | undefined): Missing[] {
  const s = getSimNow();
  return s && s.id === worldId ? s.checks.filter((c): c is Missing => c.status === 'missing') : [];
}

/**
 * 选上的推演插件(按出手的先后)交给推演:各用本机现在的那一版;被网站停用的、没装的、文件没了的不算。
 * 以它为底稿带过来、还没装的照旧列着(推演不带文件,装上或移出以前不能开始推演)
 */
let chooseSeq = 0;
export async function chooseSims(worldId: string, picks: readonly SimChoice[], installed?: readonly InstalledPlugin[], still: () => boolean = () => true): Promise<void> {
  // 文件还在读时又改了选的:只认最后一次
  const seq = ++chooseSeq;
  const carried = carriedMissing(worldId);
  const have = installed ?? (await listPlugins().catch(() => [] as InstalledPlugin[]));
  const list: WorldPlugin[] = [];
  const files: SimPluginFile[] = [];
  const missing: Missing[] = [];
  for (const c of picks) {
    const p = have.find((x) => x.id === c.id && x.current.manifest.role === 'sim' && !verdictOf(x.current.sum, x.id).blocked);
    const bytes = p && (await fileOf(p.current.sum));
    if (!p || !bytes) {
      const was = carried.find((x) => x.id === c.id);
      if (was) {
        list.push(was.plugin);
        missing.push(was);
      }
      continue;
    }
    const params = simParamsOf(p.current.manifest.sim?.params, c.params);
    list.push(simPluginOf(p.current, params));
    files.push({ id: p.id, sum: p.current.sum, bytes, ...(Object.keys(params).length ? { params } : {}) });
  }
  if (seq === chooseSeq && still()) setSimNow(list.length ? { id: worldId, list, files: missing.length ? null : files, checks: missing } : null);
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

/**
 * 以一个世界为底稿新建:带上它用的推演插件和滑条(from = 那个世界记的,按出手的先后)。本机装着的用现在那一版;
 * 没装的列在选上的里、标没装;被网站停用的不带
 */
export async function carrySims(worldId: string, from: readonly WorldPlugin[]): Promise<void> {
  const keep = from.filter((r) => !verdictOf(r.sum, r.id).blocked);
  if (!keep.length) return;
  const have = await listPlugins().catch(() => [] as InstalledPlugin[]);
  // 读插件仓库的时候已经离开了那个新建的世界:不带了
  const here = () => currentWorld()?.id === worldId;
  if (!here()) return;
  const usable = (r: WorldPlugin) => have.some((p) => p.id === r.id && p.current.manifest.role === 'sim' && !verdictOf(p.current.sum, p.id).blocked);
  const missing = keep.filter((r) => !usable(r)).map((plugin): Missing => ({ id: plugin.id, plugin, status: 'missing' }));
  setSimNow({ id: worldId, list: [...keep], files: missing.length ? null : [], checks: missing });
  await chooseSims(
    worldId,
    keep.map((r) => {
      const params = recordParams(r);
      return { id: r.id, ...(params ? { params } : {}) };
    }),
    have,
    here,
  );
}

/** 刚建好的世界停用前带的文件(又不停用了换回来) */
let unblock: { id: string; files: SimPluginFile[] } | null = null;

/** 装了、删了插件、停用名单变了以后:地图上这个世界的推演插件本机对不上的,再核对一遍;新建中选的只看带过来没装的、停用的 */
export async function refreshSimNow(): Promise<void> {
  const s = getSimNow();
  if (!s) return;
  if (s.stored) return loadSimNow(s.id);
  const cur = currentWorld();
  // 刚建好、仓库里还没记上的:停用了就不再跑,和打开的世界一样先问;又不停用了就换回原来的文件
  if (cur?.id === s.id && cur.kind !== 'draft') {
    const blocked = blockedChecks(s.list, null);
    if (blocked) {
      if (s.files) unblock = { id: s.id, files: s.files };
      setSimNow({ ...s, files: null, checks: blocked });
    } else if (!s.files && unblock?.id === s.id && s.checks.some((c) => c.status === 'blocked')) setSimNow({ ...s, files: unblock.files, checks: [] });
    return;
  }
  if (!s.files || s.list.some((p) => verdictOf(p.sum, p.id).blocked)) await chooseSims(s.id, chosenSims(s.id));
}
subscribeVerdicts(() => void refreshSimNow().catch(() => {}));

/** 删了一个插件:地图上这个世界用着它的,再核对一遍(推演不再带它的文件) */
export async function forgetSim(id: string): Promise<void> {
  const s = getSimNow();
  if (s?.list.some((p) => p.id === id)) await loadSimNow(s.id);
}

/**
 * 本机对不上:另存一份(带着 next 这次的修改)从第 0 年重推:只装了别的版本的按本机现在那一版(滑条照原来的),
 * drop 里的(被网站停用的)不带。存好交新编号、AI 写的史书跟过去没有
 */
export async function copyWithSims(from: string, next: WorldEdits, open: (id: string, notes: boolean) => void, drop: readonly string[] = []): Promise<void> {
  // 地图留着的世界另存出来要按存下的地图重算,那一步只认世界清单里记的插件,这里选的带不过去
  if (keptMapOf(next)) return void notify({ kind: 'warn', text: drop.length ? `这个世界另存不了不带${pluginsUiOn() ? '停用' : ''}插件重推的一份` : '这个世界另存不了按新版插件重推的一份', more: [drop.length ? '它的地图是从别的世界留下来的，只能照原样看' : '它的地图是从别的世界留下来的。要照原样接着推，得装回原来那一版'] });
  const id = saveAsNewVersion(from, next);
  if (!id) return void notify({ kind: 'error', text: '没能另存', more: [storageFullWhy()] });
  const notes = copyNotes(from, id);
  await chooseSims(
    id,
    chosenSims(getSimNow()?.id).filter((c) => !drop.includes(c.id)),
  );
  open(id, notes);
}
