// 推演插件(runtime quickjs)拿到的全局对象 civAtlas 和一回合、回话的类型,给编辑器提示用(插件包里不用带)。
// 只靠这一个文件,拷到别处也能用;和网站的推演插件接口第 1 版一样(单测核对)

/** 插件代码里的 civAtlas:登记插件、读滑条 */
export interface CivAtlasSim {
  /** 登记插件:只能在插件代码顶层调一次 */
  sim(def: SimPluginDef): void;
  /** 新建世界时拨的滑条(清单 sim.params 里的名字 → 拨到几),只读 */
  readonly params: Readonly<Record<string, number>>;
}

export interface SimPluginDef {
  /** 每到插件出手的那一刻调一次;交回回话,或什么都不交 */
  act(turn: SimTurn): PluginReply | void;
}

/** 推演插件拿到的一回合 */
export type SimTurn = PluginTurn<SimRead>;

/** 插件听到的一条史事:a、b 按种类是国、民族或城的编号,region、settlement、war 没有 = −1 */
export interface PluginAnnal {
  year: number;
  kind: AnnalKind;
  a: number;
  b: number;
  region: number;
  settlement: number;
  war: number;
}

/** 插件自己约的一件事 */
export interface PluginEvent {
  year: number;
  kind: number;
  data: number[];
}

/** 小本子:只放数(数、数组、对象,一层层套) */
export type PluginNote = number | PluginNote[] | { [key: string]: PluginNote };

/** 下了没办的一条命令:回话 commands 里的第 index 条(种类 kind),被作者的哪种干预(why)挡下 */
export interface PluginRefused {
  kind: string;
  index: number;
  why: string;
}

/** 交给插件的一回合 */
export interface PluginTurn<V> {
  /** 此刻(这一刻官方的都办完了) */
  readonly year: number;
  /** 照频率该出手的一刻(第 0 年那一次也算) */
  readonly tick: boolean;
  /** 这一刻到了的、自己约的事(按约的先后) */
  readonly events: readonly PluginEvent[];
  /** 上次出手以后官方记下的、listen 里那几种史事(按发生先后,第 0 年那一次是第 0 年的) */
  readonly heard: readonly PluginAnnal[];
  /** 小本子(复制的一份;要改就在回话里交回整本) */
  readonly note: PluginNote | undefined;
  /** 上一回合下的命令里没办的(按回话里的先后;都办了 = 不给) */
  readonly refused?: readonly PluginRefused[];
  /** 读口 */
  readonly read: V;
  /** 自己的表此刻的值(复制的一份,格 × 栏) */
  table(id: string): Float64Array;
  /** 自己交给影响口 id 的那栏此刻的值(复制的一份,格 × 栏;还没交 = 全是不影响的数) */
  influence(id: string): Float64Array;
  /** 自己的随机数:[0, 1),按键直接算,和先后无关(键当整数用) */
  rand(a: number, b?: number, c?: number, d?: number): number;
}

/** 插件写进编年史的一句 */
export interface PluginChronicle {
  text: string;
  /** 模板里的指代 → 这一次推演里的编号(国、州、城、族) */
  refs?: Readonly<Record<string, number>>;
}

/** 插件的回话;什么都不交 = 什么都不改 */
export interface PluginReply {
  /** 换上的小本子 */
  note?: PluginNote;
  /** 约以后的事(时刻要比此刻晚) */
  at?: readonly { year: number; kind: number; data?: readonly number[] }[];
  /** 换掉自己几张表的值(格 × 栏,个数要对;压回上下限) */
  tables?: Readonly<Record<string, ArrayLike<number>>>;
  /** 换掉交给影响口的几栏(口名 → 格 × 栏,个数要对;压回口的上下限) */
  influences?: Readonly<Record<string, ArrayLike<number>>>;
  /** 下命令(SimCommand 的写法):此刻的下一格生效 */
  commands?: readonly unknown[];
  /** 写进编年史的几句(记在此刻) */
  chronicle?: readonly PluginChronicle[];
}

export type AnnalKind =
  | 'found'
  | 'rank'
  | 'war'
  | 'conquer'
  | 'peace'
  | 'fall'
  | 'capital'
  | 'split'
  | 'merge'
  | 'dynasty'
  | 'migrate'
  | 'assimilate'
  | 'vanish'
  | 'sack'
  | 'ruin'
  | 'rebuild'
  | 'decline'
  | 'intervene'
  | 'battle'
  | 'upheaval'
  | 'sunk'
  | 'alliance'
  | 'unally'
  | 'submit'
  | 'defect'
  | 'diverge'
  | 'famine'
  | 'revolt'
  | 'collapse'
  | 'plague'
  | 'warlord'
  | 'reclaim'
  | 'defy'
  | 'fiscal'
  | 'council'
  | 'stand'
  | 'regent'
  | 'marry'
  | 'pandemic'
  | 'desolate'
  | 'treaty'
  | 'breach'
  | 'expire'
  | 'neutral'
  | 'exile'
  | 'keep'
  | 'trek'
  | 'winter'
  | 'reform';

// ---- 读口(sim.read@1) ----

export interface SimRegions {
  count: number;
  /** 平方公里 */
  area: Float64Array;
  /** 治所地块 */
  seat: Int32Array;
  /** 主导地貌(生物群落编号,和地图的 biome 同一套) */
  biome: Uint8Array;
  /** 1 = 临海 */
  coastal: Uint8Array;
  /** 平均宜居分 */
  habitability: Float32Array;
  /** 州 r 的邻居是 list[start[r] .. start[r + 1]),含海峡、航线 */
  neighbors: { start: Int32Array; list: Int32Array };
}

export type SimOwnerField = 'polity' | 'culture' | 'faith';

export type Regime = 'crown' | 'republic' | 'junta';

export interface SimPolity {
  id: number;
  founded: number;
  ended?: number;
  /** 此刻的国都(城的编号) */
  capital: number;
  culture: number;
  /** 从哪国分出来的 */
  parent?: number;
  /** 此刻有几州 */
  size: number;
  /** 国号档位 */
  tier: number;
  /** 国力(最近一次算的;这一年里才立的国还没算 = 0) */
  power: number;
  /** 国库攒到该有的几成(0–1) */
  treasury: number;
  /** 国用不足(0–1) */
  broke: number;
  /** 正和哪几国打仗(编号升序) */
  wars: number[];
  /** 盟国(编号升序) */
  allies: number[];
  /** 宗主;不是藩属 = −1 */
  liege: number;
  /** 国教(信仰编号;没有 = −1;信仰每隔几年才算一步,是最近那一步的) */
  faith: number;
  /** 此刻的政体:王室 / 共和 / 军政府 */
  regime: Regime;
  /** 共和、军政府是改出来的(本国原来有君主) */
  reformed: boolean;
  /** 议政:0 君主独断、1 设了议事会、2 设了议会 */
  charter: number;
}

export interface SimSettlement {
  id: number;
  cell: number;
  region: number;
  founded: number;
  ended?: number;
  port: boolean;
  /** 此刻的人口(千人) */
  population: number;
  /** 此刻的等级 0 村 / 1 镇 / 2 城 / 3 大城 */
  rank: number;
}

export type CultureKind = 'farm' | 'nomad' | 'sea' | 'highland' | 'river' | 'lake' | 'forest';

export interface SimCulture {
  id: number;
  kind: CultureKind;
  /** 发源的州 */
  hearth: number;
  born: number;
  ended?: number;
  parent?: number;
}

export type FaithKind = 'folk' | 'great' | 'sect';

export interface SimFaith {
  id: number;
  /** 民间信仰 / 大教 / 教派 */
  kind: FaithKind;
  /** 民间信仰:哪个民族的 */
  culture?: number;
  /** 教派:从哪个大教分出来 */
  parent?: number;
  /** 大教 / 教派:创立(分出)的年份 */
  founded?: number;
  /** 大教:圣城(城的编号) */
  holy?: number;
}

/** 一条史事;a、b 按种类是国、民族或城的编号,region、settlement、war 没有 = −1 */
export type SimAnnal = PluginAnnal;

/** 能读的官方表(按州或按国一个数) */
export type OfficialName =
  | 'rural'
  | 'control'
  | 'unrest'
  | 'dev.production'
  | 'dev.transport'
  | 'dev.information'
  | 'dev.administration'
  | 'dev.mobilization'
  | 'res.grain'
  | 'res.livestock'
  | 'res.copper'
  | 'res.iron'
  | 'res.coal'
  | 'res.timber'
  | 'res.salt'
  | 'res.fish'
  | 'res.oil'
  | 'res.rare'
  | 'res.gold'
  | 'ideology.mandate'
  | 'ideology.law'
  | 'ideology.council'
  | 'ideology.craft'
  | 'ideology.rights'
  | 'ideology.nation'
  | 'ideology.commons';

export interface SimRead {
  /** 此刻(年) */
  readonly year: number;
  regions(): SimRegions;
  /** 此刻各州归属;没有 = −1。信仰每隔几年才算一步,是最近那一步的 */
  owners(field: SimOwnerField): Int16Array;
  /** 所有国家(亡了的也在) */
  polities(): SimPolity[];
  /** 所有城(毁了的也在) */
  settlements(): SimSettlement[];
  cultures(): SimCulture[];
  /** 到此刻有过的信仰(下标 = 信仰编号,和 owners('faith')、SimPolity.faith 同一套) */
  faiths(): SimFaith[];
  /** 官方表此刻的值(最近一次算的),个数 = 州数或国数;这一组还没装 = 全是 0 */
  official(name: OfficialName): Float64Array;
  /** [from, to] 年里的史事(按发生先后) */
  annals(from: number, to?: number): SimAnnal[];
}

// ---- 影响口和命令 ----

/** 影响口的名字 */
export type InfluenceName =
  | 'city.capacity'
  | 'rural.capacity'
  | 'unrest.add'
  | 'dev.rate'
  | 'assim.rate'
  | 'control.reach'
  | 'war.odds'
  | 'war.power'
  | 'split.odds'
  | 'dynasty.odds'
  | 'plague.odds'
  | 'plague.loss';

/** 命令里指一国、一州、一城、一族:读口里的编号(只在这一刻有效),或稳定键 */
export type SimRef = number | string;

export type DisasterLevel = 1 | 2 | 3;
export type TrekReach = 'near' | 'mid' | 'far';
export type TrekDir = 'east' | 'south' | 'west' | 'north';

/** 插件能下的命令(PluginReply.commands 里的一条) */
export type SimCommand =
  | { kind: 'declare'; a: SimRef; b: SimRef }
  | { kind: 'ally'; a: SimRef; b: SimRef; until?: number }
  | { kind: 'treaty'; a: SimRef; ps: SimRef[]; term?: number; limited?: true; keep?: true; by?: SimRef; zone?: SimRef; ask?: true }
  | { kind: 'cede'; a: SimRef; region: SimRef; permanent?: true }
  | { kind: 'found'; region: SimRef; name?: string }
  | { kind: 'move'; a: SimRef; city: SimRef }
  | { kind: 'destroy'; a: SimRef; b?: SimRef }
  | { kind: 'disaster'; type: 'plague'; level: DisasterLevel; city: SimRef }
  | { kind: 'disaster'; type: 'famine'; level: DisasterLevel; a?: SimRef; regions?: SimRef[] }
  | { kind: 'disaster'; type: 'quake'; level: DisasterLevel; region: SimRef }
  | { kind: 'trek'; folk: SimRef; region?: SimRef; to?: SimRef; reach?: Exclude<TrekReach, 'mid'>; dir?: TrekDir };
