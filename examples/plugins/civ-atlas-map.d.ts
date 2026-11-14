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
  /** 山脊噪声:每个地块一个 0…1 的数,山脊处接近 1,和官方长老山脉用的同一套 */
  ridged(o: NoiseOptions): Float32Array;
  /** 水往哪流:land 标了 1 的是陆地,水从高往低流到不是陆地的地块为止,洼地先灌满;rain = 每块自己产多少水(不给 = 陆地每块 1) */
  flow(height: ArrayLike<number>, land: ArrayLike<number>, rain?: ArrayLike<number>): FlowResult;
  /** 从 from 标了 1 的地块沿邻居走,每块要走多少公里、最近的是哪个起点;给了 through 只能走进标了 1 的地块 */
  distance(from: ArrayLike<number>, through?: ArrayLike<number>): DistanceResult;
  /** mask 标了 1 的地块连成几片、每片多大 */
  components(mask: ArrayLike<number>): ComponentsResult;
  /** 每块和邻居比,最陡的那一下每公里升降多少(height 的单位 / 公里,不分上下) */
  slope(height: ArrayLike<number>): Float32Array;
  /** 纬度 lat、经度 lon(度)处是哪个地块 */
  cellAt(lat: number, lon: number): number;
  /** 从地块 a 沿最短的路(大圆)走到地块 b 经过的地块,含两头,按先后 */
  line(a: number, b: number): Int32Array;
  /** 每块沿纬线往西、往东到最近的标了 1 的地块多少公里;这一圈纬线上一块都没有 = −1 */
  westEast(mask: ArrayLike<number>): WestEastResult;
  /** 按气温(°C)、年降水(毫米)判群落编号(和 d.biomeNames 对得上);给了 water(0 陆地 / 1 海 / 2 湖)海、湖照水面判 */
  biomeOf(temperature: ArrayLike<number>, precipitation: ArrayLike<number>, water?: ArrayLike<number>): Uint8Array;
}

export interface FlowResult {
  /** 水往哪块流(−1 = 不是陆地,或者流不到不是陆地的地块) */
  downstream: Int32Array;
  /** 洼地灌满以后的水面(和 height 同一个单位;比 height 高的地方积着水) */
  fillLevel: Float32Array;
  /** 汇流量:自己的 rain 加上游流来的 */
  flux: Float32Array;
}

export interface DistanceResult {
  /** 沿邻居走过来多少公里;走不到 = −1 */
  km: Float32Array;
  /** 最近的是哪个起点(地块编号);走不到 = −1 */
  nearest: Int32Array;
}

export interface ComponentsResult {
  /** 每块属于第几片(没标 1 的 = −1);片按里面最小的地块编号排 */
  group: Int32Array;
  /** 第几片有几块 */
  size: Int32Array;
}

export interface WestEastResult {
  /** 往西多少公里 */
  west: Float32Array;
  /** 往东多少公里 */
  east: Float32Array;
}

/** 新建世界时的参数(滑条上的那些数) */
export interface MapWorldParams {
  seed: number;
  /** 要的地块数(实际是 n) */
  cells: number;
  /** 陆地占几成 */
  landFraction: number;
  /** 板块几块 */
  plates: number;
  /** 山多高(1 = 原样) */
  mountains: number;
  /** 整体冷暖(0 = 原样) */
  temperature: number;
  /** 雨多少(1 = 原样) */
  rainfall: number;
  /** 主要大陆几块(0 = 自动) */
  continents: number;
  /** 大陆聚在一起的程度(0–1) */
  gather: number;
  /** 破碎度(1 = 原样) */
  rugged: number;
  /** 板块硬度(1 = 原样) */
  hardness: number;
  /** 陆地偏向哪个半球(−1 南 … 1 北) */
  north: number;
}

/** 三个口子都递的;带 ? 的是清单 map.reads 写了才递的 */
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
  /** 每个板块在自己质心处的漂移速度(东、南分量;没有单位,大小 0.3–1) */
  plateVx?: Float32Array;
  plateVy?: Float32Array;
  /** 每个板块绕转轴转动的角速度向量,交错存 x, y, z(和 xyz 同一套坐标):板块在某处的速度 = ω × 那处的位置 */
  plateOmega?: Float32Array;
  /** 每个板块:1 大陆板块 / 0 大洋板块 */
  plateContinental?: Uint8Array;
  /** 板块边界上的汇聚强度:正 = 相撞,负 = 张裂,0 = 不在边界 */
  convergence?: Float32Array;
  /** 离最近的相撞边界(汇聚强度大于 0.25)多少公里;一处都没有 = −1 */
  convergentKm?: Float32Array;
  /** 最近的那段相撞边界撞得多猛(0–1) */
  convergentStrength?: Float32Array;
  /** 离最近的张裂边界(汇聚强度小于 −0.25)多少公里;一处都没有 = −1 */
  divergentKm?: Float32Array;
  /** 最近的那段张裂边界裂得多猛(0–1) */
  divergentStrength?: Float32Array;
  /** 陆地抬升得多快(没有单位;雨水冲刷之前定的,山是从它冲出来的) */
  uplift?: Float32Array;
  /** 高原底座(米;海里是 0) */
  plateau?: Float32Array;
  /** 海底深度(米,负数;陆地是 0;雨水冲刷之前定的) */
  oceanDepth?: Float32Array;
  /** 每个地块的面积(平方公里) */
  cellArea?: Float32Array;
  /** 新建世界时的参数 */
  worldParams?: MapWorldParams;
  /** 1 = 作者在地形编辑里改过的地块 */
  edited?: Uint8Array;
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
  /** 洋流的表层流向(东、南分量,长短 = 强弱 0–1);陆地、湖是 0 */
  currentU?: Float32Array;
  currentV?: Float32Array;
  /** 洋流让海面比同纬度的平均暖多少(°C,负 = 冷);陆地、湖是 0 */
  currentTemp?: Float32Array;
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
  /** 水往哪块流(−1 = 海,或者流不到海) */
  downstream?: Int32Array;
  /** 洼地灌满以后的水面(米):比海拔高 3 米以上的积成了湖(太大的湖后来填平了) */
  fillLevel?: Float32Array;
  /** 每块自己产多少水(米 / 年,只有陆地有);flux 是它沿 downstream 一路加起来的 */
  runoff?: Float32Array;
  /** 湿地适宜度(0–1):陆地上到 0.5 的成了湿地 */
  wetland?: Float32Array;
  /** 最高海拔(米),山名、山峰符号的门槛按它定;改过地形的世界照没改时的 */
  maxElevation?: number;
}
/** 值是 NaN 的地块不画 */
export interface LayersReply {
  layers?: Readonly<Record<string, ArrayLike<number>>>;
}
