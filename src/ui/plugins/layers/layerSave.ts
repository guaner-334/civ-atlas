/**
 * 插件图层存进这个世界、从这个世界里拿掉、打开世界时读出存着的。
 * 存的是点的那一刻插件交来的样子(网站认得的格式,块见 gen/worldFormat.ts 的 PLUGIN_LAYER_PREFIX),之后插件怎么变都不跟着变。
 */
import { checkLayerLook, sameLayerLook } from '../../../gen/layerLook';
import { savedLayerId, type PluginLayerValue, type WorldPlugin } from '../../../gen/worldFormat';
import type { CellLayer } from '../../../plugin/check';
import { currentWorld, keepWorld } from '../../saveStore';
import { showToast } from '../../toastStore';
import { errKind, settleWorld, vaultCall } from '../../worldStore';
import { pluginLayers, savedKey, setSavedLayers, type LiveLayer, type SavedLayer } from '../layerState';

/** 读出这个世界存着的插件图层(cells = 地图有几个地块);读不了就当没有 */
export async function loadSavedLayers(worldId: string, cells: number): Promise<void> {
  let list: Awaited<ReturnType<typeof vaultCall<'readPluginLayers'>>> = [];
  try {
    list = await vaultCall('readPluginLayers', [worldId, cells]);
  } catch {
    list = [];
  }
  if (currentWorld()?.id !== worldId) return;
  setSavedLayers(worldId, new Map(list.map((r) => [savedKey(r.by, r.layer), { pluginId: r.by, layer: r.layer, data: r.data, record: r.plugin }])));
}

/** 开着的插件交来的这一份存成什么(样子照网站查完的那一份) */
export function layerData(live: LiveLayer): PluginLayerValue {
  const l = live.layer as CellLayer;
  return { ...checkLayerLook(l), unit: 'cell', values: l.values };
}

const sameValues = (a: Float32Array, b: Float32Array) => {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i] && !(Number.isNaN(a[i]) && Number.isNaN(b[i]))) return false;
  return true;
};

const sameCache = new WeakMap<object, { saved: object; same: boolean }>();
/** 开着的插件交来的和存着的一样(一样就不再显示「存进这个世界」) */
export function sameAsSaved(live: LiveLayer, saved: SavedLayer): boolean {
  const hit = sameCache.get(live.layer);
  if (hit && hit.saved === saved.data) return hit.same;
  const a = layerData(live);
  const same = sameLayerLook(saved.data as unknown as Record<string, unknown>, a) && sameValues(a.values, saved.data.values);
  sameCache.set(live.layer, { saved: saved.data, same });
  return same;
}

type Wrote = Awaited<ReturnType<typeof vaultCall<'changePluginLayer'>>>;

/** 写进去;世界还没存进「我的世界」的先存下来再写 */
async function write(worldId: string, record: WorldPlugin, layer: string, data: PluginLayerValue | null): Promise<Wrote> {
  keepWorld(worldId);
  let r = await vaultCall('changePluginLayer', [worldId, record, layer, data]);
  if (r.status === 'nobase') {
    await settleWorld(worldId);
    r = await vaultCall('changePluginLayer', [worldId, record, layer, data]);
  }
  return r;
}

function failed(text: string, e: unknown) {
  const full = errKind(e) === 'full';
  showToast({ id: 'plugin-layer', kind: 'error', text, more: [full ? '浏览器的存储满了，腾出地方再试' : '这次没写进去，世界没变'] });
}

/** 写的结果是没写成的那几种:顶上说为什么,交回 true */
function refused(r: Wrote, text: string): boolean {
  if (r.status === 'saved' || r.status === 'same') return false;
  const why = r.status === 'many' ? '一个世界最多存 16 个插件图层，先拿掉一个' : r.status === 'big' ? '图层太大了' : '这个世界还没存下来，等它存好再试';
  showToast({ id: 'plugin-layer', kind: 'error', text, more: [why] });
  return true;
}

function putSaved(worldId: string, key: string, next: SavedLayer | null) {
  if (currentWorld()?.id !== worldId) return;
  const saved = new Map(pluginLayers.get().saved);
  if (next) saved.set(key, next);
  else saved.delete(key);
  setSavedLayers(worldId, saved);
}

/** 把开着的插件交来的这个地块图层存进这个世界(同一个图层存过就换成这一份) */
export async function saveLayer(live: LiveLayer): Promise<void> {
  const worldId = currentWorld()?.id;
  if (!worldId) return;
  const data = layerData(live);
  const layer = savedLayerId(live.layer.id);
  const key = savedKey(live.pluginId, layer);
  const text = `没能把「${data.title}」存进这个世界`;
  try {
    if (refused(await write(worldId, live.record, layer, data), text)) return;
  } catch (e) {
    return failed(text, e);
  }
  const before = pluginLayers.get().saved.get(key) ?? null;
  putSaved(worldId, key, { pluginId: live.pluginId, layer, data, record: live.record });
  showToast({
    id: 'plugin-layer',
    kind: 'ok',
    text: `「${data.title}」这个图层存进了这个世界`,
    more: ['别人打开，没装这个插件也看得到；存成文件、分享都带着'],
    action: { label: '撤销', act: 'plugin-layer-undo', onClick: () => void undoSave(worldId, live.record, key, layer, data.title, before) },
  });
}

/** 撤销刚才那次存:换回存之前的那一份(之前没存过就拿掉) */
async function undoSave(worldId: string, record: WorldPlugin, key: string, layer: string, title: string, before: SavedLayer | null) {
  try {
    await write(worldId, before?.record ?? record, layer, before?.data ?? null);
  } catch (e) {
    return failed('没能撤销', e);
  }
  putSaved(worldId, key, before);
  showToast({ id: 'plugin-layer', kind: 'ok', text: `已撤销，「${title}」${before ? '换回了原来存的那一份' : '没存进这个世界'}`, ttl: 4000 });
}

/** 从这个世界里拿掉存着的这个图层(撤销时连清单里的插件记录一起放回去) */
export async function removeLayer(saved: SavedLayer): Promise<void> {
  const worldId = currentWorld()?.id;
  if (!worldId) return;
  // 清单里没记这个插件的(别处写的文件):拿掉、放回都不动清单的记录
  const rec: WorldPlugin = saved.record ?? { id: saved.pluginId, version: '0', sum: '', role: 'tool' };
  const key = savedKey(saved.pluginId, saved.layer);
  const title = saved.data.title;
  try {
    await write(worldId, rec, saved.layer, null);
  } catch (e) {
    return failed(`没能从这个世界里拿掉「${title}」`, e);
  }
  putSaved(worldId, key, null);
  const undo = async () => {
    try {
      if (refused(await write(worldId, rec, saved.layer, saved.data), '没能撤销')) return;
    } catch (e) {
      return failed('没能撤销', e);
    }
    putSaved(worldId, key, saved);
    showToast({ id: 'plugin-layer', kind: 'ok', text: `已撤销，「${title}」还在这个世界里`, ttl: 4000 });
  };
  showToast({ id: 'plugin-layer', kind: 'ok', text: `已从这个世界里拿掉「${title}」`, action: { label: '撤销', act: 'plugin-layer-undo', onClick: () => void undo() } });
}
