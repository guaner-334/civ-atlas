/**
 * 插件图层:开着的插件交来的(工具、只交图层的插件、开发者模式载入的)、这个世界里存着的、推演插件推的时候存进历史的
 * (按州、按年份,跟着时间轴换),图层面板里选了哪一个。
 * 这里只放数据和几个小函数;开只交图层的插件、画、存进世界的代码(layers/)用到才下载。
 *
 * 图层面板「插件图层」一个地块图层一个按钮,同一时间只显示一个(再点一下收起);标注图层(路线、框、点)交来就画,不进面板。
 * 同一个插件的同一个图层,开着的插件交来的盖过存着的;插件停了它交的都拿掉,存着的照旧在。
 */
import type { SimLayer } from '../../gen/civ/engine/pluginLayers';
import type { CellLayer, MarkLayer } from '../../plugin/check';
import { savedLayerId, type PluginLayerValue, type WorldPlugin } from '../../gen/worldFormat';
import { frameAt, framePaint, regionsToCells, type CellPaint } from '../../render/pluginLayer';
import { getCivTime } from '../civView';
import { createStore } from '../createStore';

/** 开着的插件交来的一个图层 */
export interface LiveLayer {
  pluginId: string;
  /** 插件叫什么 */
  plugin: string;
  /** 存进世界时清单里记的这个插件(编号、第几版、文件指纹、种类) */
  record: WorldPlugin;
  /** 开发者模式载入的 */
  dev: boolean;
  layer: CellLayer | MarkLayer;
}

/** 这个世界里存着的一个地块图层 */
export interface SavedLayer {
  pluginId: string;
  /** 块名里的图层编号(savedLayerId) */
  layer: string;
  data: PluginLayerValue;
  /** 世界清单里记的这个插件(没记 = null) */
  record: WorldPlugin | null;
}

/** 地图上这段历史里推演插件存下的一个图层 */
export interface SimLayerOn {
  key: string;
  pluginId: string;
  layer: SimLayer;
}

/** 地图上这段历史里推演插件存下的图层,连同铺到地块上要的州表、推到哪年 */
export interface SimLayers {
  list: readonly SimLayerOn[];
  /** 每个地块在哪个州(时间轴那一段的) */
  of: ArrayLike<number>;
  end: number;
}

export interface PluginLayers {
  /** 键 = 插件编号/存进世界时的图层编号(layerKey):同一个图层开着的和存着的对得上 */
  live: ReadonlyMap<string, LiveLayer>;
  saved: ReadonlyMap<string, SavedLayer>;
  /** saved 是哪个世界的 */
  savedFor: string | null;
  sim: SimLayers | null;
  /** 装着的、只交图层的插件(图层面板里点了才开) */
  runnable: readonly { id: string; name: string }[];
  /** 选中的图层的键;run:<插件编号> = 点了只交图层的插件,还没交来 */
  shown: string | null;
}

export const pluginLayers = createStore<PluginLayers>({ live: new Map(), saved: new Map(), savedFor: null, sim: null, runnable: [], shown: null });

/** 插件交的图层编号 → 键 */
export const layerKey = (pluginId: string, layerId: string): string => `${pluginId}/${savedLayerId(layerId)}`;
/** 存着的图层(块名里的编号已经换过)→ 键 */
export const savedKey = (pluginId: string, layer: string): string => `${pluginId}/${layer}`;
/** 推演插件存进历史的图层 → 键(和工具插件的分开:同一个编号也不混) */
export const simKey = (pluginId: string, layerId: string): string => `sim:${pluginId}/${layerId}`;
const RUN = 'run:';

/** 图层面板里的一个按钮 */
export interface LayerChip {
  key: string;
  label: string;
  /** 推演插件的图层(按钮上带「推演」小标) */
  sim?: boolean;
}

const simOf = (s: PluginLayers, key: string | null): SimLayerOn | null => (key && s.sim?.list.find((l) => l.key === key)) || null;

/** 图层面板「插件图层」的按钮:推演插件存进历史的、存着的、开着的插件交来的地块图层,再加上还没交过图层的、只交图层的插件 */
export function layerChips(s: PluginLayers): LayerChip[] {
  const out: LayerChip[] = (s.sim?.list ?? []).map((l) => ({ key: l.key, label: l.layer.title, sim: true }));
  const seen = new Set<string>();
  const plugins = new Set<string>();
  for (const [key, l] of s.saved) {
    out.push({ key, label: s.live.get(key)?.layer.title ?? l.data.title });
    seen.add(key);
    plugins.add(l.pluginId);
  }
  for (const [key, l] of s.live) {
    if (l.layer.kind !== 'cells' || seen.has(key)) continue;
    out.push({ key, label: l.layer.title });
    plugins.add(l.pluginId);
  }
  for (const p of s.runnable) if (!plugins.has(p.id)) out.push({ key: RUN + p.id, label: p.name });
  return out;
}

/** 正显示的地块图层 */
export interface ShownLayer {
  key: string;
  /** 画的这一份:开着的插件交来的,没有就是存着的;推演插件的是存下的几份(画哪一份见 shownPaint) */
  cells: CellLayer | PluginLayerValue;
  plugin: string;
  pluginId: string;
  dev: boolean;
  live: LiveLayer | null;
  saved: SavedLayer | null;
  sim: SimLayerOn | null;
}

/** 选中的按钮现在画哪一份;点了只交图层的插件、还没交来 = 它存着的(没有 = null) */
export function shownLayer(s: PluginLayers): ShownLayer | null {
  let key = s.shown;
  if (!key) return null;
  const sim = simOf(s, key);
  if (sim) return { key, cells: sim.layer, plugin: sim.pluginId, pluginId: sim.pluginId, dev: false, live: null, saved: null, sim };
  if (key.startsWith(RUN)) {
    const pid = key.slice(RUN.length);
    key = [...s.live].find(([, l]) => l.pluginId === pid && l.layer.kind === 'cells')?.[0] ?? [...s.saved].find(([, l]) => l.pluginId === pid)?.[0] ?? null;
    if (!key) return null;
  }
  const live = s.live.get(key);
  const saved = s.saved.get(key) ?? null;
  const liveCells = live?.layer.kind === 'cells' ? live : null;
  if (liveCells) return { key, cells: liveCells.layer as CellLayer, plugin: liveCells.plugin, pluginId: liveCells.pluginId, dev: liveCells.dev, live: liveCells, saved, sim: null };
  if (saved) return { key, cells: saved.data, plugin: saved.record?.name ?? saved.pluginId, pluginId: saved.pluginId, dev: false, live: null, saved, sim: null };
  return null;
}

let memo: { s: PluginLayers; v: ShownLayer | null } | null = null;
/** 现在显示的地块图层(同一份状态交回同一个对象,组件里能直接拿来订阅) */
export function currentShown(): ShownLayer | null {
  const s = pluginLayers.get();
  if (memo?.s !== s) memo = { s, v: shownLayer(s) };
  return memo.v;
}

/** 画在地图上的一份:每个地块一个数,连同图例上写的名字、单位;推演插件的写着是第几年的(year) */
export type ShownPaint = CellPaint & { title: string; legend?: string; year?: number };

let frameMemo: { layer: SimLayer; of: ArrayLike<number>; k: number; paint: ShownPaint } | null = null;

/** 推演插件的图层第 year 年那一份铺到地块上(year = null:推到的那一年;比第一份早 = null);同一份交回同一个对象 */
export function simPaint(sim: SimLayers, on: SimLayerOn, year: number | null): ShownPaint | null {
  const l = on.layer;
  const k = frameAt(l.years, year ?? sim.end);
  if (k < 0) return null;
  const m = frameMemo;
  if (m && m.layer === l && m.of === sim.of && m.k === k) return m.paint;
  const frame = framePaint(l, l.years[k])!;
  const paint: ShownPaint = { ...regionsToCells(frame, sim.of), title: l.title, year: l.years[k], ...(l.legend !== undefined ? { legend: l.legend } : {}) };
  frameMemo = { layer: l, of: sim.of, k, paint };
  return paint;
}

/** 现在画在地图上的那一份(year 不给 = 时间轴停的那年);没有 = null */
export function shownPaint(year: number | null = getCivTime().year): ShownPaint | null {
  const shown = currentShown();
  if (!shown) return null;
  const sim = pluginLayers.get().sim;
  if (shown.sim) return sim && simPaint(sim, shown.sim, year);
  return 'years' in shown.cells && shown.cells.years !== undefined ? null : shown.cells;
}

/** 按钮亮不亮:选中的就是它,或者选中的是它这个插件、交来的正是它 */
export function chipOn(s: PluginLayers, key: string): boolean {
  if (s.shown === key) return true;
  return !!s.shown?.startsWith(RUN) && shownLayer(s)?.key === key;
}

let runner: Promise<typeof import('./layers/layerRun')> | null = null;
const loadRunner = () => (runner ??= import('./layers/layerRun'));

/** 重新列一遍装着的只交图层的插件(图层面板打开时) */
export function refreshLayerPlugins(): void {
  void loadRunner().then(
    (m) => m.refreshRunnable(),
    () => {},
  );
}

/** 存着的图层是装着的、只交图层的插件的:让它再算一遍(交来以前先照旧显示存着的) */
export function rerunLayerPlugin(pluginId: string): void {
  pluginLayers.set({ ...pluginLayers.get(), shown: RUN + pluginId });
  void loadRunner().then(
    (m) => m.startLayerPlugin(pluginId),
    () => {},
  );
}

/** 点了图层面板里的一个按钮:选中它(只交图层的插件这时才开),再点一下收起 */
export function pickPluginLayer(key: string): void {
  const s = pluginLayers.get();
  const off = chipOn(s, key);
  pluginLayers.set({ ...s, shown: off ? null : key });
  const run = key.startsWith(RUN);
  const pid = run ? key.slice(RUN.length) : key.slice(0, key.indexOf('/'));
  // 开着的只交图层的插件只为显示它交的图层:收起、换成别的插件的图层就停
  void loadRunner().then(
    (m) => {
      if (!off && run) void m.startLayerPlugin(pid);
      else m.keepLayerPlugin(off ? null : pid);
    },
    () => {},
  );
}

/** 开着的插件交来(layer = null:拿掉)一个图层。第一次交来的地块图层,没有选中的就显示它;点了它这个插件、正等着的,换成它 */
export function setLiveLayer(who: Omit<LiveLayer, 'layer'>, id: string, layer: CellLayer | MarkLayer | null): void {
  const s = pluginLayers.get();
  const key = layerKey(who.pluginId, id);
  const live = new Map(s.live);
  let shown = s.shown;
  if (layer) {
    const fresh = !live.has(key);
    live.set(key, { ...who, layer });
    if (layer.kind === 'cells' && (shown === RUN + who.pluginId || (fresh && shown === null))) shown = key;
  } else {
    if (!live.delete(key)) return;
    if (shown === key && !s.saved.has(key)) shown = null;
  }
  pluginLayers.set({ ...s, live, shown });
}

/** 换了世界:存着的换成这个世界的(读的代码在 layers/) */
export function setSavedLayers(worldId: string | null, saved: ReadonlyMap<string, SavedLayer>): void {
  const s = pluginLayers.get();
  let shown = s.shown;
  if (shown && !shown.startsWith(RUN) && !s.live.has(shown) && !saved.has(shown) && !simOf(s, shown)) shown = null;
  pluginLayers.set({ ...s, saved, savedFor: worldId, shown });
}

/** 地图上的历史换了(推完、换了一段、换了世界):推演插件存进历史的图层换成它的;选着的那个没了就收起 */
export function setSimLayers(civ: { simLayers?: readonly SimLayer[]; regions: { of: ArrayLike<number> }; endYear: number } | null): void {
  const s = pluginLayers.get();
  const layers = civ?.simLayers ?? [];
  const sim: SimLayers | null = civ && layers.length ? { list: layers.map((layer) => ({ key: simKey(layer.by, layer.id), pluginId: layer.by, layer })), of: civ.regions.of, end: civ.endYear } : null;
  if (!sim && !s.sim) return;
  let shown = s.shown;
  if (shown && simOf(s, shown) && !sim?.list.some((l) => l.key === shown)) shown = null;
  pluginLayers.set({ ...s, sim, shown });
}

/** 导出地图图片时带上的:正显示的地块图层(推演插件的取 year 那一年的)、开着的插件交来的标注图层(没有 = 不带) */
export function pluginExport(year?: number): { plugin?: CellPaint; pluginMarks?: MarkLayer[] } {
  const s = pluginLayers.get();
  const paint = shownPaint(year);
  const marks = [...s.live.values()].filter((l) => l.layer.kind === 'marks').map((l) => l.layer as MarkLayer);
  return { ...(paint ? { plugin: paint } : {}), ...(marks.length ? { pluginMarks: marks } : {}) };
}
