/**
 * 插件接口第 1 版的样子:插件在线程里拿到的全局对象 civAtlas,和网站递进来、收回去的数据。
 * 给写插件的人看,网站这边的实现也照它的类型写。
 *
 * 每个函数只收一个参数对象,以后加可选的字段、加函数不算改版。
 * 网站递进来的都是复制或转交的一份,插件改了不影响世界。编号(id)只在这一次打开的世界里有效;
 * 键(key)是稳定键,改名、下干预、钉标记都用它。
 */

/** 能力(清单 requires / optional 里写的「名字@大版本」;这一版网站有的见 pluginCaps.ts) */
export type CapRef =
  | 'world.read@1'
  | 'history.read@1'
  | 'author.read@1'
  | 'author.write@1'
  | 'view.read@1'
  | 'input.pick@1'
  | 'ui.panel@1'
  | 'layer.cells@1'
  | 'layer.marks@1'
  | 'store.local@1'
  | 'store.world@1';

/**
 * 出错时 Error 上的 code:
 * no-permission 清单里没要这样能力;unknown-call 没有这个调用;bad-args 参数不对;limit 超过上限;
 * unavailable 现在拿不到(比如还没有历史、网站这边没开这个功能);busy 正忙(取数太快、上一次点选还没完);
 * blocked 网站这时不让改;cancelled 用的人取消了;failed 网站这边出错
 */
export type PluginErrorCode = 'no-permission' | 'unknown-call' | 'bad-args' | 'limit' | 'unavailable' | 'busy' | 'blocked' | 'cancelled' | 'failed';

export interface PluginError extends Error {
  code: PluginErrorCode;
}

export interface HostInfo {
  /** 接口大版本 */
  api: number;
  app: string;
  /** 给了这个插件的能力 */
  caps: CapRef[];
  /** 地块数;没开世界 = 0 */
  cells: number;
}

// ---------------------------------------------------------------------------
// 地图(world.read)

export interface WorldInfo {
  title: string;
  seed: number;
  cells: number;
  /** 主图的宽高(世界坐标):x ∈ [0, width) 对应经度 −180°…180°,y ∈ [0, height] 对应纬度 90°…−90° */
  width: number;
  height: number;
  /** 一个世界单位约多少公里(赤道处) */
  kmPerUnit: number;
}

/** 每个地块一个数的几种数据 */
export interface CellArrays {
  x: Float32Array;
  y: Float32Array;
  /** 度 */
  lon: Float32Array;
  lat: Float32Array;
  /** 平方公里 */
  area: Float32Array;
  /** 米,海洋为负 */
  elevation: Float32Array;
  /** 0 陆地 / 1 海洋 / 2 湖泊 */
  water: Uint8Array;
  /** 年均温,°C */
  temperature: Float32Array;
  /** 年降水,毫米 */
  precipitation: Float32Array;
  /** 生物群落编号,名字用 world.legend({ kind: 'biome' }) 查 */
  biome: Uint8Array;
  /** 径流量(累计) */
  flux: Float32Array;
  /** 海冰 0–1 */
  seaIce: Float32Array;
}
export type CellField = keyof CellArrays;

/** 相邻表:地块 i 的邻居是 list[start[i] .. start[i + 1]) */
export interface Neighbors {
  start: Int32Array;
  list: Int32Array;
}

export interface RiverInfo {
  /** 从源头到入海 / 入湖处经过的地块 */
  cells: Int32Array;
}

export interface LegendEntry {
  value: number;
  name: string;
}

// ---------------------------------------------------------------------------
// 历史(history.read)

export interface HistorySpan {
  from: number;
  to: number;
}

/** 某一年每个地块的归属,−1 = 没有(水上、没人住) */
export interface CellOwners {
  polity: Int16Array;
  culture: Int16Array;
  faith: Int16Array;
  /** 所在的州 */
  region: Int32Array;
}
export type OwnerField = keyof CellOwners;

/** 颜色一律写成 #rrggbb */
export type Hex = string;

export interface PolityInfo {
  id: number;
  key: string;
  /** 那一年的全称(没给年份 = 最后一年的) */
  name: string;
  /** 国名词根 */
  root: string;
  color: Hex;
  founded: number;
  ended?: number;
  /** 那一年的国都(城的编号) */
  capital: number;
  culture: number;
  /** 从哪国分出来的 */
  parent?: number;
}

export interface SettlementInfo {
  id: number;
  key: string;
  name: string;
  cell: number;
  region: number;
  founded: number;
  ended?: number;
  /** 是不是港口(给了年份 = 那一年的;地形大事能改) */
  port: boolean;
  /** 那一年的人口(千人);只有给了年份才有 */
  population?: number;
  /** 那一年的等级 0 村 / 1 镇 / 2 城 / 3 大城;只有给了年份才有 */
  rank?: number;
}

export interface RouteInfo {
  kind: 'road' | 'trail' | 'sea';
  cells: Int32Array;
  built: number;
  abandoned?: number;
}

export interface PlaceInfo {
  id: number;
  key: string;
  kind: 'sea' | 'mountains' | 'river' | 'lake' | 'island' | 'desert' | 'pass';
  name: string;
  cell?: number;
  rank: number;
}

export interface CultureInfo {
  id: number;
  key: string;
  name: string;
  kind: string;
  /** 发源的州 */
  hearth: number;
  born: number;
  ended?: number;
  color: Hex;
  parent?: number;
}

export interface FaithInfo {
  id: number;
  key: string;
  name: string;
  kind: string;
  form?: string;
  culture?: number;
  parent?: number;
  founded?: number;
  /** 圣城(城的编号) */
  holy?: number;
  color: Hex;
}

/** 给了年份 = 那一年那一段地形的州(地形大事前后州的编号、键不变,治所、面积可能变) */
export interface RegionInfo {
  id: number;
  key: string;
  /** 没人住过的州是空串 */
  name: string;
  /** 治所地块 */
  seat: number;
  /** 平方公里 */
  area: number;
  /** 那一年的人口(千人);只有给了年份才有 */
  population?: number;
}

export interface PersonInfo {
  id: number;
  key: string;
  name: string;
  role: 'ruler' | 'general' | 'prince' | 'minister' | 'consort';
  polity: number;
  born: number;
  died?: number;
  /** 君主:即位;名臣:入仕 */
  from?: number;
  until?: number;
  title?: string;
  female?: true;
}

export interface EventInfo {
  id: number;
  year: number;
  end: number;
  /** 一个字的标签(立、战、亡……) */
  tag: string;
  text: string;
  /** 1–3,3 是大事 */
  importance: number;
  polities: number[];
  regions: number[];
  /** 相关的城;没有 = −1 */
  settlement: number;
  people?: number[];
}

/** 分页取的结果:next 是下一页的 offset,取完了 = null */
export interface Page<T> {
  items: T[];
  total: number;
  next: number | null;
}

// ---------------------------------------------------------------------------
// 你写的东西(author.read / author.write)

export interface AuthorMarkInfo {
  id: number;
  title: string;
  note?: string;
  color: string;
  size?: string;
  from: number;
  to?: number;
  at?: [number, number];
  regions?: string[];
}

export interface AuthorNoteInfo {
  key: string;
  kind: string;
  title: string;
  text: string;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// 你在干什么(view.read)

export interface ViewInfo {
  year: number;
  /** 选中的东西;没选 = null */
  selected: { kind: string; key?: string; id?: number; cell?: number } | null;
  /** 看得见的范围(世界坐标);不知道 = null */
  visible: { x0: number; y0: number; x1: number; y1: number } | null;
  /** 现在的填色或数据图层 */
  layer: string | null;
}

// ---------------------------------------------------------------------------
// 点选(input.pick)

export interface BoxPick {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  cells: Int32Array;
}

// ---------------------------------------------------------------------------
// 插件面板(ui.panel):插件只说放什么,长什么样由网站画

/** 按钮、下拉、滑块、开关的 id:字母数字、- 和 _,最长 32 */
export type PanelNode =
  | { type: 'heading'; text: string }
  | { type: 'text'; text: string }
  | { type: 'number'; label: string; value: number; unit?: string }
  | { type: 'table'; columns: string[]; rows: (string | number)[][] }
  | { type: 'list'; items: string[] }
  | { type: 'button'; id: string; label: string; disabled?: boolean }
  | { type: 'select'; id: string; label: string; options: { value: string; label: string }[]; value?: string }
  | { type: 'slider'; id: string; label: string; min: number; max: number; step?: number; value: number }
  | { type: 'toggle'; id: string; label: string; value: boolean }
  | { type: 'legend'; items: { color: Hex; label: string }[] }
  | { type: 'divider' }
  /** value 0–1 */
  | { type: 'progress'; value: number; label?: string }
  | { type: 'group'; title?: string; children: PanelNode[] };

/** 用的人动了面板上的东西:按钮没有 value */
export interface PanelAction {
  id: string;
  value?: string | number | boolean;
}

// ---------------------------------------------------------------------------
// 图层(layer.cells / layer.marks):插件交数据,网站来画

/** 图层 id:字母数字、- 和 _,最长 32 */
export interface CellLayerSpec {
  id: string;
  title: string;
  /** 每个地块一个数,个数等于地块数;NaN = 这块不画 */
  values: ArrayLike<number>;
  /** 渐变:2–16 个颜色,从 min 到 max(不给 = 按数据的最小最大) */
  ramp?: { colors: Hex[]; min?: number; max?: number };
  /** 分类:值等于 value 的地块涂这种颜色,1–32 类 */
  classes?: { value: number; color: Hex; label: string }[];
  /** 图例的单位或说明 */
  legend?: string;
  /** 0–1,不给 = 网站定 */
  opacity?: number;
}

export type MarkColor = 'red' | 'orange' | 'green' | 'blue' | 'purple' | 'teal' | 'black' | 'white';

export interface MarkStyle {
  color?: MarkColor;
  line?: 'solid' | 'dashed';
  size?: 's' | 'm' | 'l';
}

/**
 * 一项标注:point 一个点;label 一个点加文字;line 一条线(按先后连);area 圈出几个地块。
 * 位置给 cells(地块编号)或 points(世界坐标 x0, y0, x1, y1, …),area 只认 cells
 */
export interface MarkItem {
  kind: 'point' | 'label' | 'line' | 'area';
  cells?: ArrayLike<number>;
  points?: ArrayLike<number>;
  /** 最长 40 字;label 必须有 */
  text?: string;
  style?: MarkStyle;
}

export interface MarkLayerSpec {
  id: string;
  title: string;
  items: MarkItem[];
}

// ---------------------------------------------------------------------------
// civAtlas

type Call<A, R> = (args: A) => Promise<R>;
type Call0<R> = (args?: Record<string, never>) => Promise<R>;

export interface CivAtlas {
  readonly protocol: number;
  /** 照名字调用(和下面那些函数一样) */
  request<T = unknown>(call: string, args?: unknown): Promise<T>;
  /** 听网站发来的事件;返回取消的函数 */
  on(event: 'view.year', fn: (d: { year: number }) => void): () => void;
  on(event: 'view.select', fn: (d: ViewInfo['selected']) => void): () => void;
  on(event: 'panel.action', fn: (d: PanelAction) => void): () => void;
  /** 开发者模式的日志 */
  log(...parts: unknown[]): void;
  /** 网站问插件的话(工具模式里用) */
  onCall(fn: ((data: unknown) => unknown) | null): void;
  onMessage(fn: ((data: unknown) => void) | null): void;
  post(data: unknown): void;

  host: { info: Call0<HostInfo> };
  world: {
    info: Call0<WorldInfo>;
    /** 一次最多 16 种 */
    cells<F extends CellField>(args: { fields: F[] }): Promise<Pick<CellArrays, F>>;
    neighbors: Call0<Neighbors>;
    rivers: Call0<RiverInfo[]>;
    legend: Call<{ kind: 'biome' | 'water' }, LegendEntry[]>;
  };
  history: {
    span: Call0<HistorySpan>;
    at<F extends OwnerField>(args: { year: number; fields: F[] }): Promise<Pick<CellOwners, F>>;
    /** 给了年份 = 只列那一年在的 */
    polities: Call<{ year?: number }, PolityInfo[]>;
    settlements: Call<{ year?: number }, SettlementInfo[]>;
    routes: Call<{ year?: number }, RouteInfo[]>;
    places: Call0<PlaceInfo[]>;
    cultures: Call0<CultureInfo[]>;
    faiths: Call0<FaithInfo[]>;
    regions: Call<{ year?: number }, RegionInfo[]>;
    /** 一次最多 2000 个 */
    people: Call<{ offset?: number; limit?: number; polity?: number; role?: PersonInfo['role'] }, Page<PersonInfo>>;
    /** 编年史 [from, to] 年里的条目,字已经换好名字;一次最多 2000 条 */
    events: Call<{ from?: number; to?: number; offset?: number; limit?: number }, Page<EventInfo>>;
  };
  author: {
    marks: Call0<AuthorMarkInfo[]>;
    /** 改过的名字:稳定键 → 名字 */
    names: Call0<Record<string, string>>;
    characters: Call0<unknown[]>;
    interventions: Call0<unknown[]>;
    /** AI 写的正文;一次最多 100 篇 */
    notes: Call<{ offset?: number; limit?: number }, Page<AuthorNoteInfo>>;
  };
  view: { get: Call0<ViewInfo> };
  pick: {
    cell: Call<{ hint?: string }, { cell: number }>;
    cells: Call<{ hint?: string; max?: number }, { cells: Int32Array }>;
    box: Call<{ hint?: string }, BoxPick>;
  };
  panel: {
    /** 整个换掉;一个面板最多 2000 个节点、4000 字,表格最多 500 行 */
    set: Call<{ nodes: PanelNode[] }, void>;
    clear: Call0<void>;
  };
  layer: {
    /** 同 id 的换掉;一个插件最多 4 个 */
    cells: Call<CellLayerSpec, void>;
    /** 同 id 的换掉;一个插件最多 4 个,每个最多 5000 项 */
    marks: Call<MarkLayerSpec, void>;
    remove: Call<{ id: string }, void>;
  };
}
