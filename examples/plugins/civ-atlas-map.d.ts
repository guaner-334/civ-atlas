// 地图插件(role map,runtime quickjs)拿到的全局对象 civAtlas 和三个口子递进来、交回去的类型,给编辑器提示用(插件包里不用带)。
// 只靠这一个文件,拷到别处也能用;和网站的地图插件接口第 1 版一样(单测核对)

/** 插件代码里的 civAtlas:登记插件、读滑条 */
export interface CivAtlasMap {
  /** 登记插件:只能在插件代码顶层调一次;清单 map.stages 写了哪几步,这里就要有哪几个函数 */
  map(def: MapPluginDef): void;
  /** 新建世界时拨的滑条(清单 map.params 里的名字 → 拨到几),只读 */
  readonly params: Readonly<Record<string, number>>;
}

/** 每一口当场交回;什么都不交 = 这一口不改 */
export interface MapPluginDef {
  /** 改海拔:定海拔之后、湖和气候之前 */
  height?(d: HeightInput & MapParams): HeightReply | void;
  /** 改气候:气温降水算完之后、海冰河流群落之前 */
  climate?(d: ClimateInput & MapParams): ClimateReply | void;
  /** 出图层:地图长好以后,只看不改 */
  layers?(d: LayersInput & MapParams): LayersReply | void;
}

/** d.params:和 civAtlas.params 是同一份 */
export interface MapParams {
  readonly params: Readonly<Record<string, number>>;
}

export interface NoiseOptions {
  /** 起伏的尺度(公里):大约多远一个起落 */
  km: number;
  /** 叠几层(1–8,默认 1);每多一层尺度减半 */
  octaves?: number;
  /** 每多一层起伏乘多少(0–1,默认 0.5) */
  persistence?: number;
  /** 同一个插件要几张不同的噪声时各给一个 */
  salt?: string | number;
}

export interface MapHelpers {
  /** 每个地块一个 −1…1 左右的数,和官方生成用的同一套噪声 */
  noise(o: NoiseOptions): Float32Array;
  /** 和邻居平均 passes 遍(0–200);给了 mask 只在标了 1 的地块上平均、只和标了 1 的邻居平均,别的地块不变 */
  blur(field: ArrayLike<number>, passes: number, mask?: ArrayLike<number>): Float32Array;
  /** 从 from 标了 1 的地块沿邻居走,每块要走几步(到不了 = −1);给了 through 只能走进标了 1 的地块 */
  steps(from: ArrayLike<number>, through?: ArrayLike<number>): Int32Array;
  /** 离地块 cell 不超过 km 公里的地块(含它自己),按编号从小到大 */
  near(cell: number, km: number): Int32Array;
  /** 两块之间多少公里(直线穿过星球的距离,近处和沿地面走差不多) */
  km(a: number, b: number): number;
}

/** 三个口子都递的 */
export interface MapShared extends MapHelpers {
  n: number;
  /** 纬度、经度(度) */
  lat: Float32Array;
  lon: Float32Array;
  /** 单位球面上的位置,交错存 x, y, z */
  xyz: Float32Array;
  /** 邻接表:地块 i 的邻居是 adj[adjStart[i] .. adjStart[i+1]) */
  adjStart: Int32Array;
  adj: Int32Array;
  /** xyz 里的一个单位(星球半径)合多少公里 */
  kmPerUnit: number;
  /** 地图种子 */
  seed: number;
  /** [0, 1) 的随机数,只由地图种子、插件编号和 a、b、c 定 */
  rand(a?: number, b?: number, c?: number): number;
}

export interface HeightInput extends MapShared {
  /** 海拔(米) */
  elevation: Float32Array;
  /** 1 陆地 / 0 海 */
  land: Uint8Array;
  plate: Int16Array;
}
/** 不给 land:海拔改过的地块高过 0 米是陆地、不高于是海 */
export interface HeightReply {
  elevation?: ArrayLike<number>;
  land?: ArrayLike<number>;
}

export interface ClimateInput extends MapShared {
  elevation: Float32Array;
  /** 0 陆地 / 1 海 / 2 湖 */
  water: Uint8Array;
  temperature: Float32Array;
  /** 年降水(毫米) */
  precipitation: Float32Array;
  windX: Float32Array;
  windY: Float32Array;
  /** 这个地块的夏半年、冬半年按全年算的降水(毫米 / 年;年降水是两者的平均) */
  rainSummer: Float32Array;
  rainWinter: Float32Array;
}
export interface ClimateReply {
  temperature?: ArrayLike<number>;
  precipitation?: ArrayLike<number>;
}

export interface LayersInput extends ClimateInput {
  plate: Int16Array;
  /** 湖面高度(米,只有湖有意义) */
  waterLevel: Float32Array;
  seaIce: Float32Array;
  biome: Uint8Array;
  /** 群落编号 → 名字 */
  biomeNames: readonly string[];
  flux: Float32Array;
  riverThreshold: number;
  /** 河经过的地块,一条接一条;第 k 条是 riverCells[riverStart[k] .. riverStart[k+1]) */
  riverCells: Int32Array;
  riverStart: Int32Array;
}
/** 值是 NaN 的地块不画 */
export interface LayersReply {
  layers?: Readonly<Record<string, ArrayLike<number>>>;
}
