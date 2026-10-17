/**
 * 图层(界面骨架的"图层与投影"弹层):六张缩略图 + 五个小字按钮。
 *
 * 一个图层 = 画风(手绘 / 写实 / 数据图层)+ 数据图层(数据图层时)+ 文明层开不开国家 / 民族 / 信仰:
 *   政区 = 手绘 + 国家      民族 = 手绘 + 民族      信仰 = 手绘 + 信仰(留国界、国名)
 *   地形 = 手绘,不叠文明   生态 = 数据图层"群落"   实景 = 写实地貌,不叠文明
 *   高程 / 板块 / 气温 / 降水 / 洋流 = 对应的数据图层
 * 反过来,任意一组(画风, 数据图层, 国家 / 民族 / 信仰开关)都能认出它算哪个图层(旧链接 style=、layer=、civ= 照样认)。
 * 主题:高程、实景、降水底色深,界面换深色;其余浅色。
 */
import type { LayerId as DataLayer } from '../render/layers';
import type { SurfaceLook } from '../render/surface';

export type Style = 'realistic' | 'fantasy' | 'data';

export type MapLayer =
  | 'political'
  | 'cultures'
  | 'faith'
  | 'terrain'
  | 'biomes'
  | 'elevation'
  | 'realistic'
  | 'plates'
  | 'temperature'
  | 'precipitation'
  | 'currents'
  | 'climate';

export interface LayerDef {
  id: MapLayer;
  name: string;
  style: Style;
  /** 数据图层时画哪一层 */
  data?: DataLayer;
  /** 文明层:国家 / 民族 / 信仰开不开 */
  polities: boolean;
  cultures: boolean;
  faiths: boolean;
  dark: boolean;
  /** 六张缩略图里的(false = 下面一行小字按钮) */
  main: boolean;
}

export const MAP_LAYERS: LayerDef[] = [
  { id: 'political', name: '政区', style: 'fantasy', polities: true, cultures: false, faiths: false, dark: false, main: true },
  { id: 'cultures', name: '民族', style: 'fantasy', polities: false, cultures: true, faiths: false, dark: false, main: true },
  { id: 'faith', name: '信仰', style: 'fantasy', polities: true, cultures: false, faiths: true, dark: false, main: true },
  { id: 'terrain', name: '地形', style: 'fantasy', polities: false, cultures: false, faiths: false, dark: false, main: true },
  { id: 'biomes', name: '生态', style: 'data', data: 'biomes', polities: false, cultures: false, faiths: false, dark: false, main: true },
  { id: 'realistic', name: '实景', style: 'realistic', polities: false, cultures: false, faiths: false, dark: true, main: true },
  { id: 'elevation', name: '高程', style: 'data', data: 'elevation', polities: false, cultures: false, faiths: false, dark: true, main: false },
  { id: 'plates', name: '板块', style: 'data', data: 'plates', polities: false, cultures: false, faiths: false, dark: false, main: false },
  { id: 'temperature', name: '气温', style: 'data', data: 'temperature', polities: false, cultures: false, faiths: false, dark: false, main: false },
  { id: 'precipitation', name: '降水', style: 'data', data: 'precipitation', polities: false, cultures: false, faiths: false, dark: true, main: false },
  { id: 'climate', name: '气候', style: 'data', data: 'climate', polities: false, cultures: false, faiths: false, dark: false, main: false },
  { id: 'currents', name: '洋流', style: 'data', data: 'currents', polities: false, cultures: false, faiths: false, dark: false, main: false },
];

const BY_ID = new Map(MAP_LAYERS.map((l) => [l.id, l]));

export function layerDef(id: MapLayer): LayerDef {
  return BY_ID.get(id) ?? MAP_LAYERS[0];
}

export function isMapLayer(x: unknown): x is MapLayer {
  return typeof x === 'string' && BY_ID.has(x as MapLayer);
}

/** 这组设置算哪个图层(写实 + 国家也算"实景";手绘时先看信仰、再看国家、再看民族) */
export function layerOf(style: Style, data: DataLayer, show: { polities: boolean; cultures: boolean; faiths?: boolean }): MapLayer {
  if (style === 'realistic') return 'realistic';
  if (style === 'data') return isMapLayer(data) ? data : 'biomes';
  if (show.faiths) return 'faith';
  if (show.polities) return 'political';
  if (show.cultures) return 'cultures';
  return 'terrain';
}

/** 图层用深色界面 */
export function layerDark(id: MapLayer): boolean {
  return layerDef(id).dark;
}

/**
 * 网址里的图层:带 style= 的旧链接照旧(style + layer + civ);没有 style 时 layer= 是新的图层名;
 * 都没有:civ= 开了国家 / 民族 / 信仰就按它(手绘),否则默认"政区"。
 * 返回 null = 按网址原样(不去改文明层的开关)
 */
export function layerFromUrl(q: URLSearchParams): MapLayer | null {
  if (q.get('style')) return null;
  const l = q.get('layer');
  if (isMapLayer(l)) return l;
  if (q.get('civ')) return null;
  return 'political';
}

// ---- 底图 × 填色(图层面板):任何底图都能配任何填色 ----
//   底图 = 手绘 / 卫星(经典 | 细节两种画法)/ 地理图 / 白模,或一种数据底图(生态、高程……);
//   填色 = 不填 / 国家 / 民族 / 信仰(就是文明层的国家 / 民族 / 信仰开关)。
//   旧图层的对应:政区 = 手绘 + 国家,民族 = 手绘 + 民族,信仰 = 手绘 + 信仰,地形 = 手绘 + 不填,
//   实景 = 卫星(经典)+ 不填,生态 / 高程…… = 对应数据底图 + 不填。

/** 写实画法的名字(卫星的两种画法、地理图、白模) */
export const LOOK_NAMES: Record<SurfaceLook, string> = { classic: '经典卫星', detail: '卫星', geo: '地理图', blank: '白模' };

/** 卫星的两种画法 */
export type SatLook = 'classic' | 'detail';
export function isSatLook(x: unknown): x is SatLook {
  return x === 'classic' || x === 'detail';
}

/** 四张缩略图的底图 */
export type MainBase = 'fantasy' | 'satellite' | 'geo' | 'blank';
/** 底图:四张缩略图之一,或一种数据底图 */
export type BaseId = MainBase | DataLayer;

export const MAIN_BASES: { id: MainBase; name: string; hint: string }[] = [
  { id: 'fantasy', name: '手绘', hint: '手绘地图的画法' },
  { id: 'satellite', name: '卫星', hint: '像从太空看：海面安静，陆地是自然色' },
  { id: 'geo', name: '地理图', hint: '地区颜色分明，山脉、河流、海盆好认' },
  { id: 'blank', name: '白模', hint: '海陆平涂、不画起伏，像一张世界地图' },
];
/** 数据底图(两行,四个一行) */
export const DATA_BASES: DataLayer[] = ['biomes', 'elevation', 'plates', 'temperature', 'precipitation', 'climate', 'currents'];
export const CLASSIC_HINT = '以前的实景画法，原样保留';

export function isMainBase(x: unknown): x is MainBase {
  return x === 'fantasy' || x === 'satellite' || x === 'geo' || x === 'blank';
}
export function isBaseId(x: unknown): x is BaseId {
  return isMainBase(x) || DATA_BASES.includes(x as DataLayer);
}

/** 这组设置是哪种底图 */
export function baseOf(style: Style, data: DataLayer, look: SurfaceLook): BaseId {
  if (style === 'fantasy') return 'fantasy';
  if (style === 'data') return DATA_BASES.includes(data) ? data : 'biomes';
  return look === 'geo' || look === 'blank' ? look : 'satellite';
}

/** 底图的名字(顶栏底图按钮上写的;卫星按画法写「经典卫星」或「卫星」) */
export function baseName(base: BaseId, sat: SatLook): string {
  if (base === 'satellite') return LOOK_NAMES[sat];
  const m = MAIN_BASES.find((b) => b.id === base);
  return m ? m.name : layerDef(base as MapLayer).name;
}

/** 底图下面那行说明 */
export function baseHint(base: BaseId, sat: SatLook): string {
  if (base === 'satellite' && sat === 'classic') return CLASSIC_HINT;
  const m = MAIN_BASES.find((b) => b.id === base);
  return m ? m.hint : `看一种数据：${layerDef(base as MapLayer).name}；国家颜色照样能叠上去`;
}

/** 底图用深色界面:卫星、地理图;数据底图里的高程、降水 */
export function baseDark(base: BaseId): boolean {
  if (base === 'satellite' || base === 'geo') return true;
  if (base === 'fantasy' || base === 'blank') return false;
  return layerDef(base as MapLayer).dark;
}

/** 换到这种底图:画风、数据图层、写实画法(卫星用 sat 记着的那种) */
export function baseLook(base: BaseId, sat: SatLook): { style: Style; data?: DataLayer; look?: SurfaceLook } {
  if (base === 'fantasy') return { style: 'fantasy' };
  if (base === 'satellite') return { style: 'realistic', look: sat };
  if (base === 'geo' || base === 'blank') return { style: 'realistic', look: base };
  return { style: 'data', data: base };
}

export type FillId = 'none' | 'polities' | 'cultures' | 'faiths';

export const FILLS: { id: FillId; name: string; hint: string }[] = [
  { id: 'none', name: '不填', hint: '只看底图，不铺颜色' },
  { id: 'polities', name: '国家', hint: '国家的颜色铺在底图上，国界、国名跟着显示' },
  { id: 'cultures', name: '民族', hint: '各民族的颜色铺在底图上' },
  { id: 'faiths', name: '信仰', hint: '各信仰的颜色铺在底图上，留着国界' },
];

/** 数字键 1–4 换的填色(和以前的政区、民族、信仰同一个键;4 = 不填) */
export const FILL_KEYS: FillId[] = ['polities', 'cultures', 'faiths', 'none'];

export function isFillId(x: unknown): x is FillId {
  return x === 'none' || x === 'polities' || x === 'cultures' || x === 'faiths';
}

/** 文明层开关算哪种填色(先看信仰、再看国家、再看民族) */
export function fillOf(show: { polities: boolean; cultures: boolean; faiths?: boolean }): FillId {
  if (show.faiths) return 'faiths';
  if (show.polities) return 'polities';
  if (show.cultures) return 'cultures';
  return 'none';
}

/** 填色对应的文明层开关(信仰留着国界) */
export function fillShow(id: FillId): { polities: boolean; cultures: boolean; faiths: boolean } {
  return { polities: id === 'polities' || id === 'faiths', cultures: id === 'cultures', faiths: id === 'faiths' };
}

/** 旧图层名 → 底图 + 填色(实景按经典卫星) */
export function layerParts(id: MapLayer): { base: BaseId; fill: FillId; sat?: SatLook } {
  const d = layerDef(id);
  const fill = fillOf(d);
  if (d.style === 'realistic') return { base: 'satellite', fill, sat: 'classic' };
  if (d.style === 'data') return { base: d.data!, fill };
  return { base: 'fantasy', fill };
}

/** 网址里的底图 / 填色 / 卫星画法 */
export interface MapView {
  base: BaseId;
  fill: FillId;
  /** 卫星画法:网址里写了(或旧链接认得出)才有 */
  sat?: SatLook;
}

/**
 * 读网址:新链接是 map=(底图;不写 = 手绘)、fill=(填色;不写 = 国家)、sat=(卫星画法;不写 = 经典);
 * 没有 map= / fill= 的旧链接按旧图层认(style=、layer=、civ=,见 layerFromUrl;实景 = 经典卫星)。
 * 返回 null = 旧链接带了 style= 或只有 civ=:按网址原样(不去改文明层的开关;写实按经典卫星)
 */
export function mapViewFromUrl(q: URLSearchParams): MapView | null {
  const m = q.get('map');
  const f = q.get('fill');
  if (m !== null || f !== null) {
    const base = isBaseId(m) ? m : 'fantasy';
    const sq = q.get('sat');
    return { base, fill: isFillId(f) ? f : 'polities', sat: base === 'satellite' ? (isSatLook(sq) ? sq : 'classic') : isSatLook(sq) ? sq : undefined };
  }
  const l = layerFromUrl(q);
  return l ? layerParts(l) : null;
}

/** 写网址:map= / fill= / sat=(默认的手绘、国家省掉;卫星才写画法),去掉旧的 style=、layer= 和 civ= 里的国家 / 民族 / 信仰 */
export function writeMapView(q: URLSearchParams, v: { base: BaseId; fill: FillId; sat: SatLook }): URLSearchParams {
  const o = new URLSearchParams(q);
  o.delete('style');
  o.delete('layer');
  const civ = o.get('civ');
  if (civ !== null) {
    const rest = civ.split(/[,+ ]/).filter((k) => k && !/^-?(polities|cultures|faiths)$/.test(k));
    if (rest.length) o.set('civ', rest.join(','));
    else o.delete('civ');
  }
  if (v.base === 'fantasy') o.delete('map');
  else o.set('map', v.base);
  // 默认的「国家」可以省掉;只剩 civ= 的网址会按旧链接读(不写填色就成了不填),这时照写
  if (v.fill === 'polities' && (v.base !== 'fantasy' || !o.has('civ'))) o.delete('fill');
  else o.set('fill', v.fill);
  if (v.base === 'satellite') o.set('sat', v.sat);
  else o.delete('sat');
  return o;
}

/** 缩略图:旧图层名(新建界面、数据底图),或某种写实画法的底图(不叠填色;realistic = 经典卫星) */
export type ThumbId = MapLayer | `realistic:${Exclude<SurfaceLook, 'classic'>}`;

/** 某种底图的缩略图(不叠填色) */
export function baseThumb(base: BaseId, sat: SatLook): ThumbId {
  if (base === 'fantasy') return 'terrain';
  if (base === 'satellite') return sat === 'classic' ? 'realistic' : 'realistic:detail';
  if (base === 'geo' || base === 'blank') return `realistic:${base}`;
  return base as MapLayer;
}
