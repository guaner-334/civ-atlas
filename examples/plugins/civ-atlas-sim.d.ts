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
  /** 由头(宣战为什么打、盟约怎么断的……);没有 = 不给 */
  cause?: AnnalCause;
  /** 立约、约满、设中立地才有:约里的几国(按入约先后) */
  ps?: number[];
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

/** 史事的由头 */
export type AnnalCause =
  | 'expand'
  | 'claim'
  | 'chaos'
  | 'prey'
  | 'resource'
  | 'betray'
  | 'punish'
  | 'ally'
  | 'rescue'
  | 'lapse'
  | 'abandon'
  | 'vassal'
  | 'quell'
  | 'collapse'
  | 'great'
  | 'quake'
  | 'warlord'
  | 'broke'
  | 'heir'
  | 'slain'
  | 'captured'
  | 'withdrew'
  | 'pandemic'
  | 'breach'
  | 'peace'
  | 'renew'
  | 'deposed'
  | 'fled'
  | 'decree'
  | 'divert'
  | 'unrest'
  | 'plagued'
  | 'minor'
  | 'regent'
  | 'plunder'
  | 'trek'
  | 'spring'
  | 'revolution'
  | 'surrender';

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
  /** 盟国(编号升序;含作者的干预和插件命令结的盟) */
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
  /** 此刻是第几段(dynasties 的下标) */
  dynasty: number;
  /** 朝代和政体分段(按先后;没改朝换代过 = 只有立国那一段):from 那年起、什么政体、seat 这一段兴起的城(第一段 = 立国时的国都) */
  dynasties: { from: number; regime: Regime; seat: number }[];
  /** 议事定下的规矩 */
  rules: SimRules;
  /** 此刻照的方针;没有 = 不给 */
  policy?: SimPolicy;
}

/** 征法 0 代收、1 分成、2 直征;fief = 分封了边地;军制 −1 边镇、0 州郡征发、0.5 监军、1 禁军;官制 −1 自辟、0 荐举、0.5 参半、1 铨选 */
export interface SimRules {
  tax: number;
  fief: boolean;
  army: number;
  office: number;
}

export type PolicyPreset = 'expand' | 'hold' | 'trade' | 'peace';
export type PolicyFocus = 'production' | 'transport' | 'information' | 'administration' | 'mobilization';

/** 一国的方针 */
export interface SimPolicy {
  /** 从这一刻的下一刻起照它 */
  from: number;
  /** 一键选的哪一种(只管说法) */
  preset?: PolicyPreset;
  /** 打仗胆量、开拓、沿海(负 = 偏内陆)、和谈底线:−50…50,加在君主的倾向上;不给 = 0 */
  war?: number;
  expand?: number;
  coast?: number;
  peace?: number;
  /** 发展重点 */
  focus?: PolicyFocus;
  /** 亲国、仇国(此刻的编号;还没立国的不在) */
  friends: number[];
  foes: number[];
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
  /** 建城时的民族 */
  culture: number;
  /** 此刻的人口上限(千人;算上生产能力、国都,不算受灾的折损;毁了 = 0) */
  capacity: number;
}

/** 城受的一次灾:sack 洗劫、famine 饥荒、plague 瘟疫、quake 地震水旱、slump 大疫以后的凋敝;loss = 当时人口折损几成,之后慢慢长回来 */
export interface SimSack {
  year: number;
  settlement: number;
  loss: number;
  cause: 'sack' | 'famine' | 'plague' | 'quake' | 'slump';
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
  | 'ideology.commons'
  | 'strife'
  | 'soil'
  | 'fiscal.land'
  | 'fiscal.craft'
  | 'fiscal.market'
  | 'fiscal.tax'
  | 'fiscal.due'
  | 'fiscal.collected'
  | 'fiscal.treasury'
  | 'fiscal.broke'
  | 'era'
  | 'res.base.grain'
  | 'res.base.livestock'
  | 'res.base.copper'
  | 'res.base.iron'
  | 'res.base.coal'
  | 'res.base.timber'
  | 'res.base.salt'
  | 'res.base.fish'
  | 'res.base.oil'
  | 'res.base.rare'
  | 'res.base.gold'
  | 'res.stock.grain'
  | 'res.stock.livestock'
  | 'res.stock.copper'
  | 'res.stock.iron'
  | 'res.stock.coal'
  | 'res.stock.timber'
  | 'res.stock.salt'
  | 'res.stock.fish'
  | 'res.stock.oil'
  | 'res.stock.rare'
  | 'res.stock.gold'
  | 'ideology.polity.mandate'
  | 'ideology.polity.law'
  | 'ideology.polity.council'
  | 'ideology.polity.craft'
  | 'ideology.polity.rights'
  | 'ideology.polity.nation'
  | 'ideology.polity.commons';

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
  /** [from, to] 年里城受的灾(按先后) */
  sacks(from: number, to?: number): SimSack[];
  /** 所有战争(打完的也在;下标 = 战争编号,和史事的 war 同一套) */
  wars(): SimWar[];
  /** 两国之间此刻还在的停战 */
  truces(): SimTruce[];
  /** 此刻还记着的仇 */
  grudges(): SimGrudge[];
  /** 各州最近一次换国家 */
  handover(): SimHandover;
  /** 盟约、藩属、约和中立地 */
  pacts(): SimPacts;
  /** 在世的各国此刻在位的那一位(按国的编号) */
  rulers(): SimRuler[];
  /** 还没废的商道(发展度每算一步跟着走一步,是最近那一步的) */
  trades(): SimTrade[];
  /** 在路上的大迁徙 */
  treks(): SimTrek[];
  /** 正在传的瘟疫;没有 = null */
  plague(): SimPlague | null;
}

/** 一场战争 */
export interface SimWar {
  id: number;
  /** 攻方、守方 */
  a: number;
  b: number;
  /** 宣战那年 */
  start: number;
  /** 议和那年;还在打 = 不给 */
  end?: number;
  /** 这场仗里易手的州(按先后;by = 拿下它的一方) */
  takes: { year: number; region: number; by: number }[];
  /**
   * 还在打的才有:攻方拿下几州就议和、最多打几年(从宣战算),照攻方此刻说了算的人的倾向和方针算。
   * 讨伐民变、宗室争位、迁来的一支开的仗不看目标(没有 goal),打得更久;攻方国力是守方好几倍的灭国之战也不看目标
   */
  goal?: number;
  length?: number;
}

/** 两国议和以后的停战:until 那年以前互不宣战 */
export interface SimTruce {
  a: number;
  b: number;
  /** 议和那年 */
  since: number;
  until: number;
}

/** 记恨:a 在上一场和 b 的仗里净丢了州,until 那年以前看邻国时更想打 b */
export interface SimGrudge {
  a: number;
  b: number;
  /** 那场仗议和那年 */
  since: number;
  until: number;
}

/** 各州最近一次换国家(按州) */
export interface SimHandover {
  /** 哪年(从来没归过国家 = −Infinity) */
  since: Float64Array;
  /** 换到现在这国以前归哪国(−1 = 无主,或没换过) */
  prev: Int16Array;
}

/** 此刻的邦交 */
export interface SimPacts {
  /** 结着的盟(两国都还在):since 结盟那年,foe 共御的强邻(没有 = −1);作者、插件下令结的有期限的 until = 到哪年 */
  alliances: { a: number; b: number; since: number; foe: number; until?: number }[];
  /** 藩属 a 向宗主 b 称臣,since 称臣那年 */
  vassals: { a: number; b: number; since: number }[];
  /** 还没废的约 */
  treaties: SimTreaty[];
  /** 此刻的中立地 */
  zones: SimZone[];
}

export interface SimTreaty {
  /** 约的编号(史事 treaty 的 war 列) */
  id: number;
  /** 此刻还在约里的几国(按入约先后) */
  members: number[];
  /** 首次立约那年、最近一次立约或续约那年 */
  start: number;
  since: number;
  /** 约满那年;一直有效 = 不给 */
  until?: number;
  /** 有限竞争(还各守今疆:不进约国旁边的无主之地、不收约国的藩属);不然是互不侵犯 */
  limited: boolean;
  /** 约期内不许背约 */
  keep: boolean;
  /** 共同的强邻(没有 = −1) */
  foe: number;
  /** 这份约的中立地(SimZone.id;没有 = −1) */
  zone: number;
}

export interface SimZone {
  id: number;
  region: number;
  /** 依的那份约 */
  treaty: number;
  from: number;
  /** 让出那州的国家(原是无主之地 = −1) */
  owner: number;
  /** 定了哪年撤;不给 = 跟着约走 */
  until?: number;
}

/** 君主、掌权的人的倾向:开拓、好战、发展、重商,各 0–100 */
export interface Leanings {
  expand: number;
  war: number;
  develop: number;
  trade: number;
}

/** 掌实权的:march 引兵入朝、heir 太子监国、uncle 宗室摄政、minister 名臣辅政、chancellor 大臣专权、general 大将专权 */
export type SimRegencyKind = 'march' | 'heir' | 'uncle' | 'minister' | 'chancellor' | 'general';

/** 一国此刻在位的那一位 */
export interface SimRuler {
  polity: number;
  /** 全国第几位(0 起,跨朝连续) */
  k: number;
  /** 第几段(SimPolity.dynasties 的下标) */
  dynasty: number;
  born: number;
  /** 即位那年 */
  from: number;
  /** 此刻的倾向(作者、插件改过的按改过的) */
  leanings: Leanings;
  /** 有人掌着实权(推演照他的倾向):哪一种、掌权那年、生年;没有 = 不给 */
  regent?: { kind: SimRegencyKind; since: number; born: number; leanings: Leanings };
  /** 此刻在世的儿子(按生年;heir = 预定的继承人);共和、军政府的执政和作者立的君主没有 */
  sons: { born: number; heir: boolean }[];
  /** 他此刻寿终的话会据地争位的儿子(生年,按长幼) */
  claimants: number[];
}

/** 物产(和官方表 res.* 的后缀同一套) */
export type SimResource = 'grain' | 'livestock' | 'copper' | 'iron' | 'coal' | 'timber' | 'salt' | 'fish' | 'oil' | 'rare' | 'gold';

/** 一条还没废的商道 */
export interface SimTrade {
  /** 商道的编号(按开通先后) */
  id: number;
  /** 买方国家、产地(州) */
  buyer: number;
  from: number;
  /** 开通那年 */
  opened: number;
  /** 此刻运的货 */
  goods: SimResource[];
  /** 断着(打仗挡着) */
  broken: boolean;
  /** 此刻的路线:经过的州,产地 → 买方国都所在的州 */
  path: number[];
}

/** 一支在路上的大迁徙 */
export interface SimTrek {
  /** 第几次大迁徙(按动身先后) */
  id: number;
  culture: number;
  /** 动身那年 */
  start: number;
  /** 路线:依次走过的州(出发的州 … 落脚的州)、到每一州的时刻(动身时就定了) */
  route: number[];
  years: number[];
  /** 此刻走到 route 的第几州 */
  at: number;
  /** 总体朝哪个方位走 */
  dir: TrekDir;
  /** 到了能占几州 */
  size: number;
  /** 为什么走:crowd 老家挤、famine 灾年、scatter 本族的国散了或亡了 */
  push: 'crowd' | 'famine' | 'scatter';
  /** 冲着什么去:chaos 那边大乱、plague 疫后空了、rich 富庶、tribal 部落地带 */
  pull: 'chaos' | 'plague' | 'rich' | 'tribal';
  /** 冲着哪国去(−1 = 部落地带) */
  target: number;
}

/** 正在传的那一场瘟疫 */
export interface SimPlague {
  /** 第几场(史事 plague 的 war 列) */
  id: number;
  /** 起疫那年 */
  start: number;
  /** 大瘟疫(传得远、死得多)、全球大疫 */
  great: boolean;
  pandemic: boolean;
  /** 作者、插件下的瘟疫和全球大疫的轻重(1–3);自己起的 = 0 */
  level: number;
  /** 这一场染过的州、上一年刚染上的州(下一年从这几州往外传);都是升序 */
  regions: number[];
  front: number[];
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
