/**
 * 插件图层存进这个世界、从这个世界里拿掉、打开世界时读出存着的。
 * 存的是点的那一刻插件交来的样子(网站认得的格式,块见 gen/worldFormat.ts 的 PLUGIN_LAYER_PREFIX),之后插件怎么变都不跟着变。
 */
import { pluginLayerPart, type PluginLayerData } from '../../../gen/worldFormat';
import type { CellLayer } from '../../../plugin/check';
import { currentWorld, keepWorld } from '../../saveStore';
import { showToast } from '../../toastStore';
import { errKind, settleWorld, vaultCall } from '../../worldStore';
import { layerKey, pluginLayers, setSavedLayers, type LiveLayer, type SavedLayer } from '../layerState';

/** 读出这个世界存着的插件图层;读不了就当没有 */
export async function loadSavedLayers(worldId: string): Promise<void> {
  let list: Awaited<ReturnType<typeof vaultCall<'readPluginLayers'>>> = [];
  try {
    list = await vaultCall('readPluginLayers', [worldId]);
  } catch {
    list = [];
  }
  if (currentWorld()?.id !== worldId) return;
  setSavedLayers(worldId, new Map(list.map((r) => [layerKey(r.by, r.data.id), { pluginId: r.by, name: r.name, data: r.data, record: r.plugin }])));
}

/** 开着的插件交来的这一份存成什么 */
export function layerData(live: LiveLayer): PluginLayerData {
  const l = live.layer as CellLayer;
  return {
    id: l.id,
    title: l.title,
    plugin: { name: live.plugin, version: live.record.version },
    values: l.values,
    ...(l.ramp ? { ramp: l.ramp } : { classes: l.classes }),
    ...(l.legend !== undefined ? { legend: l.legend } : {}),
    ...(l.opacity !== undefined ? { opacity: l.opacity } : {}),
  };
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
  if (hit?.saved === saved.data) return hit.same;
  const a = layerData(live);
  const b = saved.data;
  const head = (d: PluginLayerData) => JSON.stringify([d.title, d.ramp ?? null, d.classes ?? null, d.legend ?? null, d.opacity ?? null]);
  const same = head(a) === head(b) && sameValues(a.values, b.values);
  sameCache.set(live.layer, { saved: b, same });
  return same;
}

type Wrote = Awaited<ReturnType<typeof vaultCall<'changePluginLayer'>>>;

/** 写进去;世界还没存进「我的世界」的先存下来再写 */
async function write(worldId: string, live: Pick<LiveLayer, 'record'>, name: string, data: PluginLayerData | null): Promise<Wrote> {
  keepWorld(worldId);
  let r = await vaultCall('changePluginLayer', [worldId, live.record, name, data]);
  if (r.status === 'nobase') {
    await settleWorld(worldId);
    r = await vaultCall('changePluginLayer', [worldId, live.record, name, data]);
  }
  return r;
}

function failed(text: string, e: unknown) {
  const full = errKind(e) === 'full';
  showToast({ id: 'plugin-layer', kind: 'error', text, more: [full ? '浏览器的存储满了，腾出地方再试' : '这次没写进去，世界没变'] });
}

/** 把开着的插件交来的这个地块图层存进这个世界(同一个图层存过就换成这一份) */
export async function saveLayer(live: LiveLayer): Promise<void> {
  const worldId = currentWorld()?.id;
  if (!worldId) return;
  const data = layerData(live);
  const name = pluginLayerPart(live.pluginId, data.id);
  const text = `没能把「${data.title}」存进这个世界`;
  try {
    const r = await write(worldId, live, name, data);
    if (r.status === 'nobase' || r.status === 'big') {
      showToast({ id: 'plugin-layer', kind: 'error', text, more: [r.status === 'big' ? '图层太大了' : '这个世界还没存下来，等它存好再试'] });
      return;
    }
  } catch (e) {
    return failed(text, e);
  }
  if (currentWorld()?.id !== worldId) return;
  const s = pluginLayers.get();
  const before = s.saved.get(layerKey(live.pluginId, data.id)) ?? null;
  const saved = new Map(s.saved);
  saved.set(layerKey(live.pluginId, data.id), { pluginId: live.pluginId, name, data, record: live.record });
  setSavedLayers(worldId, saved);
  showToast({
    id: 'plugin-layer',
    kind: 'ok',
    text: `「${data.title}」这个图层存进了这个世界`,
    more: ['别人打开，没装这个插件也看得到；存成文件、分享都带着'],
    action: { label: '撤销', act: 'plugin-layer-undo', onClick: () => void undoSave(worldId, live, name, data, before) },
  });
}

/** 撤销刚才那次存:换回存之前的那一份(之前没存过就拿掉) */
async function undoSave(worldId: string, live: LiveLayer, name: string, data: PluginLayerData, before: SavedLayer | null) {
  try {
    await write(worldId, live, name, before?.data ?? null);
  } catch (e) {
    return failed('没能撤销', e);
  }
  if (currentWorld()?.id !== worldId) return;
  const saved = new Map(pluginLayers.get().saved);
  const key = layerKey(live.pluginId, data.id);
  if (before) saved.set(key, before);
  else saved.delete(key);
  setSavedLayers(worldId, saved);
  showToast({ id: 'plugin-layer', kind: 'ok', text: `已撤销，「${data.title}」${before ? '换回了原来存的那一份' : '没存进这个世界'}`, ttl: 4000 });
}

/** 从这个世界里拿掉存着的这个图层(撤销时连清单里的插件记录一起放回去) */
export async function removeLayer(saved: SavedLayer): Promise<void> {
  const worldId = currentWorld()?.id;
  if (!worldId) return;
  // 没记插件的(别处写的文件)拿掉时用不着记录里的版本和指纹;撤销时也就照样不记
  const rec = saved.record ?? { id: saved.pluginId, version: saved.data.plugin.version, sum: '', role: 'tool' };
  const title = saved.data.title;
  try {
    await write(worldId, { record: rec }, saved.name, null);
  } catch (e) {
    return failed(`没能从这个世界里拿掉「${title}」`, e);
  }
  if (currentWorld()?.id !== worldId) return;
  const next = new Map(pluginLayers.get().saved);
  next.delete(layerKey(saved.pluginId, saved.data.id));
  setSavedLayers(worldId, next);
  showToast({
    id: 'plugin-layer',
    kind: 'ok',
    text: `已从这个世界里拿掉「${title}」`,
    action: {
      label: '撤销',
      act: 'plugin-layer-undo',
      onClick: () =>
        void write(worldId, { record: rec }, saved.name, saved.data).then(
          () => {
            if (currentWorld()?.id !== worldId) return;
            const back = new Map(pluginLayers.get().saved);
            back.set(layerKey(saved.pluginId, saved.data.id), saved);
            setSavedLayers(worldId, back);
            showToast({ id: 'plugin-layer', kind: 'ok', text: `已撤销，「${title}」还在这个世界里`, ttl: 4000 });
          },
          (e: unknown) => failed('没能撤销', e),
        ),
    },
  });
}
