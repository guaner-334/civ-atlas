/**
 * 只交图层的插件(没要面板、点选,不在「工具」里):图层面板里点了它才开,顶层代码从头跑,交来的图层画在地图上;
 * 收起、换成别的插件的图层就停。同一时间开一个,和「工具」里开着的那个互不相干。
 */
import { fullChronicle, fullChronicleCached } from '../../../gen/civ/story/religionText';
import { exportNotes } from '../../../ai/library';
import { cleanNoteList } from '../../../authorNotes';
import { startPluginHost, type PluginHost } from '../../../plugin/host';
import { localDataStore } from '../../../plugin/pluginData';
import { getPlugin, listPlugins, loadPlugin, type InstalledPlugin } from '../../../plugin/pluginStore';
import { worldPluginOf } from '../../../plugin/pluginWorld';
import { getEdits } from '../../editsStore';
import { currentWorld } from '../../saveStore';
import { showToast } from '../../toastStore';
import { pluginWorld } from '../devSlot';
import { subscribePluginsOpen } from '../entry';
import { pluginLayers, setLiveLayer } from '../layerState';
import { isTool } from '../pluginText';
import { viewOf, watchView } from '../pluginView';
import { verdictOf } from '../verdict';
import { askingWorldStore } from '../worldPlugins';
import './layers.css';

/** 图层面板里列的:开着的、没被网站停用、只交图层的插件 */
export function layerOnly(p: InstalledPlugin): boolean {
  const m = p.current.manifest;
  const caps = [...m.requires, ...(m.optional ?? [])];
  return p.on && !isTool(m) && !verdictOf(p.current.sum, p.id).blocked && (caps.includes('layer.cells@1') || caps.includes('layer.regions@1') || caps.includes('layer.marks@1'));
}

/** 重新列一遍装着的只交图层的插件(图层面板打开时) */
export async function refreshRunnable(): Promise<void> {
  let list: InstalledPlugin[];
  try {
    list = await listPlugins();
  } catch {
    return;
  }
  const runnable = list.filter(layerOnly).map((p) => ({ id: p.id, name: p.current.manifest.name }));
  const s = pluginLayers.get();
  if (JSON.stringify(runnable) !== JSON.stringify(s.runnable)) pluginLayers.set({ ...s, runnable });
}

let running: { id: string; seq: number; sum: string } | null = null;
let host: PluginHost | null = null;
let seq = 0;

/** 停掉开着的只交图层的插件(它交的图层跟着拿掉) */
export function stopLayerPlugin(): void {
  seq++;
  running = null;
  const h = host;
  host = null;
  h?.stop();
}

/** 开着的不是这个插件就停掉(null = 都停) */
export function keepLayerPlugin(id: string | null): void {
  if (running && running.id !== id) stopLayerPlugin();
}

let watching = false;
/** 插件页关上时:开着的插件被关掉、删掉、换了版本的停下;重新列一遍图层面板里的插件 */
function watchManager() {
  if (watching) return;
  watching = true;
  subscribePluginsOpen((on) => {
    if (on) return;
    void refreshRunnable();
    const r = running;
    if (!r) return;
    void getPlugin(r.id).then(
      (pl) => {
        if (running !== r) return;
        if (!pl || !pl.on || (r.sum && pl.current.sum !== r.sum) || verdictOf(pl.current.sum, pl.id).blocked) {
          stopLayerPlugin();
          const s = pluginLayers.get();
          if (s.shown === `run:${r.id}`) pluginLayers.set({ ...s, shown: null });
        }
      },
      () => {},
    );
  });
}

/** 开一个只交图层的插件(先停掉开着的;已经开着这个就不动) */
export async function startLayerPlugin(id: string): Promise<void> {
  if (running?.id === id) return;
  stopLayerPlugin();
  const my = ++seq;
  running = { id, seq: my, sum: '' };
  watchManager();
  const live = () => seq === my;
  let name = id;
  const failed = (text: string) => {
    if (!live()) return;
    running = null;
    host = null;
    const s = pluginLayers.get();
    if (s.shown === `run:${id}`) pluginLayers.set({ ...s, shown: null });
    showToast({ id: 'plugin-layer', kind: 'error', text: `插件「${name}」没能画出图层`, more: [text] });
  };
  try {
    const opened = await loadPlugin(id);
    if (!live()) return;
    name = opened.manifest.name;
    running.sum = opened.sum;
    const blocked = verdictOf(opened.sum, opened.manifest.id).blocked;
    if (blocked) return failed(`网站停用了这一版：${blocked.why}`);
    const who = { pluginId: id, plugin: name, record: worldPluginOf(opened), dev: false };
    const h = await startPluginHost({
      plugin: opened.manifest,
      code: opened.code,
      source: {
        world: () => pluginWorld.world,
        civ: () => pluginWorld.civ,
        edits: getEdits,
        title: () => currentWorld()?.title ?? '',
        chronicle: () => {
          const c = pluginWorld.civ;
          return c && fullChronicleCached(c) ? fullChronicle(c) : null;
        },
        notes: () => {
          const wid = currentWorld()?.id;
          return wid ? cleanNoteList(exportNotes(wid)) : [];
        },
        view: () => viewOf(pluginWorld),
        watchView,
      },
      sink: {
        layer: (lid, layer) => {
          if (!layer || live()) setLiveLayer(who, lid, layer);
        },
      },
      stores: { local: localDataStore, world: askingWorldStore(who.record, name) },
      onStop: (reason, detail) => {
        if (reason === 'stopped' || !live()) return;
        failed(reason === 'crashed' ? detail.replace(/^Uncaught /, '').replace(/^Error: /, '') || '它出错了' : reason === 'start-timeout' || reason === 'unresponsive' ? '它没有反应，已经停下了' : '它发了网站不认得的话，已经停下了');
      },
    });
    if (!live()) return h.stop();
    host = h;
  } catch (e) {
    failed(e instanceof Error && e.name === 'PluginRefused' ? e.message : '没能打开它');
  }
}
