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
  | 'layer.regions@1'
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
  /** 属于第几块板块(world.plates() 的 id) */
  plate: Int16Array;
  /** 洋流的表层流向 × 强弱(0–1):往东、往南(地图上往下)是正的;陆地、湖为 0 */
  currentX: Float32Array;
  currentY: Float32Array;
  /** 洋流让水温高了几度(°C,寒流是负的);陆地、湖为 0 */
  currentTemp: Float32Array;
}
export type CellField = keyof CellArrays;

/** 一块板块;id 是 world.cells 的 plate 里的数 */
export interface PlateInfo {
  id: number;
  /** 大陆板块 = true,大洋板块 = false */
  continental: boolean;
  /** 有几个地块 */
  cells: number;
  /** 重心(世界坐标) */
  x: number;
  y: number;
  /** 重心处往哪边漂:度,0 北、90 东 */
  dir: number;
  /** 每年漂几厘米 */
  speed: number;
}

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
  /** 父亲(人物编号;女的父辈也记在这里):君主、宗室按世系,将门、世家的将领、名臣是本国先前的一位;一朝的第一位、别的人没有 */
  parent?: number;
  /** parent 是养父 */
  adopted?: true;
  /** 母亲(人物编号):联姻嫁来的宗室女所生、临朝的太后所辅的幼主才有 */
  mom?: number;
  /** 后妃的丈夫(人物编号) */
  husband?: number;
  /** 联姻娶的宗室女(按先后):她出自哪国、她的父亲(人物编号,没有 = −1)、结亲那年、她本人(人物编号,没有 = 不给) */
  spouses?: { polity: number; father: number; year: number; person?: number }[];
  /** 君主、名臣:第几朝(history.dynasties() 的 index;没改朝换代过 = 0) */
  dynasty?: number;
  /** 复国之君出自故国哪位君主(人物编号)、是他的第几代孙(1 子、2 孙……) */
  descent?: { from: number; gen: number };
}

/**
 * 一朝(只有改朝换代过的国家才有;没改过的国家只有一朝,不列)。
 * name:东方 = 这一朝的国名词根("景");西幻 = "卡诺王朝";改制开的共和、军政府那一段 = 空串
 */
export interface DynastyInfo {
  /** 哪国 */
  polity: number;
  /** 第几朝,0 = 立国时那一朝 */
  index: number;
  key: string;
  name: string;
  from: number;
  /** 下一朝开始或亡国的年份;到最后一年还在 = 不给 */
  until?: number;
  /** 这一朝兴起的城(城的编号) */
  seat: number;
  /** 改制开的一段:republic 共和、junta 军政府;王室的那几段不给 */
  regime?: 'republic' | 'junta';
}

/**
 * 一份约(互不侵犯、有限竞争):pact 两国互不侵犯,limited 三国以上有限竞争;
 * how:self 几国自己立的、peace 议和时顺带立的、decree 用的人下令立的
 */
export interface TreatyInfo {
  id: number;
  key: string;
  /** 约名:改过的名字;没改过 = 会盟的城起的("丹枫关之约"),没有城 = "甲与乙之约" */
  name: string;
  kind: 'pact' | 'limited';
  how: 'self' | 'peace' | 'decree';
  /** 立约的几国(按入约先后) */
  parties: number[];
  start: number;
  /** 头一个期限(年);0 = 一直有效 */
  term: number;
  /** 眼下这一期到哪年(续过约的按最后一次续约算);一直有效 = 不给 */
  until?: number;
  /** 约废的年份、怎么废的(expire 约满不续、lapse 剩不到两国);还在 = 不给 */
  ended?: number;
  end?: 'expire' | 'lapse';
  /** 用的人下令立的、选了约期内不许背约 */
  keep?: true;
  /** 会盟的城、所在州(没有 = −1) */
  settlement: number;
  region: number;
  /** 居间的国家、共同的强邻(没有 = −1) */
  by: number;
  foe: number;
  renewals: { year: number; parties: number[]; term: number }[];
  /** 背约:哪年、谁背约打谁 */
  breaches: { year: number; by: number; against: number }[];
  /** 依这份约设的中立地(history.zones() 的 id;没有 = −1) */
  zone: number;
  /** 给了年份才有:那一年还在约里的几国(背约、亡国、向别国称过臣的不算) */
  members?: number[];
}

/** 一处中立地:how = treaty 几国立约时共建、peace 两国议和时划的缓冲 */
export interface ZoneInfo {
  id: number;
  region: number;
  /** 州里的城(没有 = −1) */
  settlement: number;
  /** 依的那份约(没有 = −1) */
  treaty: number;
  how: 'treaty' | 'peace';
  /** 共建的几国 */
  founders: number[];
  /** 让出那州的国家(−1 = 原是无主之地) */
  owner: number;
  from: number;
  /** 撤销的年份、还给了谁(−1 = 没还,成了无主之地);还在 = 不给 */
  ended?: number;
  back?: number;
  /** 放逐、出奔到这里的人物(人物编号,按先后) */
  residents: number[];
}

/** 某一年的盟约和宗藩;亡了的国家不算 */
export interface RelationsInfo {
  /** 结着的盟:两国、结盟的年份、共御的强邻(−1 = 没有);decree = 用的人下令结的 */
  alliances: { a: number; b: number; since: number; foe: number; decree?: true }[];
  /** 藩属:哪国、宗主、称臣的年份 */
  vassals: { polity: number; liege: number; since: number }[];
}

/** 物产(和推演插件官方表 res.* 的后半一样):粮、牲畜、铜锡、铁、煤、木材、盐、渔获、石油、稀有矿、金银 */
export type ResourceName = 'grain' | 'livestock' | 'copper' | 'iron' | 'coal' | 'timber' | 'salt' | 'fish' | 'oil' | 'rare' | 'gold';

/** 一条商道:要紧的货从产地州运到买方国都 */
export interface TradeInfo {
  id: number;
  key: string;
  name: string;
  /** 买方国家 */
  buyer: number;
  /** 产地州 */
  from: number;
  /** 运过的货:从哪年运到哪年(还在运 = until 不给);按开始运的先后 */
  goods: { resource: ResourceName; from: number; until?: number }[];
  /**
   * 通断(按年份):open 通、break 断(foe = 和哪国交兵)、reopen 复通、end 废
   * (why:fall 买方亡了、gain 本国采得到了、need 用不着了、gone 产地不产了或另找了产地、fade 商旅渐稀)
   */
  events: { year: number; kind: 'open' | 'break' | 'reopen' | 'end'; foe?: number; why?: 'fall' | 'gain' | 'need' | 'gone' | 'fade' }[];
  /** 路线:从哪年起经过哪些州(产地 → 买方国都所在州);路线变了另起一段 */
  paths: { year: number; regions: number[] }[];
}

/**
 * 一次大迁徙:一个民族分出一支举族远走,到了落脚地立国、开战。
 * push 为什么走(crowd 老家挤、famine 灾年、scatter 本族的国刚散了、亡了);pull 冲着什么去(chaos 那边大乱、plague 疫后空了、rich 富庶、tribal 部落地带);
 * outcome:found 立了国、conquer 入主、rout 败散
 */
export interface MigrationInfo {
  id: number;
  /** 迁徙的民族 */
  culture: number;
  /** 动身那年 */
  year: number;
  /** 依次走过的州:第一个是出发的州,最后一个是落脚的州 */
  route: number[];
  /** 到 route 里每一州的年份(和 route 一样长) */
  years: number[];
  /** 一路往哪边走 */
  dir: 'east' | 'south' | 'west' | 'north';
  /** 到了能占几州 */
  size: number;
  push: 'crowd' | 'famine' | 'scatter';
  pull: 'chaos' | 'plague' | 'rich' | 'tribal';
  /** 动身时冲着哪国去(−1 = 部落地带) */
  target: number;
  /** 落脚那年;还在路上 = 不给 */
  settled?: number;
  outcome?: 'found' | 'conquer' | 'rout';
  outcomeYear?: number;
  /** 立的国(没立成 = 不给) */
  polity?: number;
}

/**
 * history.regionStats 能取的:每州一个数。
 * population 人口(千人);control 中央管得到几成(0–1,割据 = 0,不在国家里 = NaN);era 时代(整数部分是第几个时代:0 石器、1 青铜、2 铁器、3 中古、4 火药、5 工业、6 电气、7 信息、8 未来,小数是走到了几成);
 * dev.* 五种能力(和时代同一把尺子);res.* 物产眼下能用多少(0–3 档,没发现 = 0);ideology.* 各说的接受度(0–1):天命、律法、共治、技艺、民权、国族、均产
 */
export type RegionStat =
  | 'population'
  | 'control'
  | 'era'
  | 'dev.production'
  | 'dev.transport'
  | 'dev.information'
  | 'dev.administration'
  | 'dev.mobilization'
  | `res.${ResourceName}`
  | 'ideology.mandate'
  | 'ideology.law'
  | 'ideology.council'
  | 'ideology.craft'
  | 'ideology.rights'
  | 'ideology.nation'
  | 'ideology.commons';

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

/** 你的标记的颜色:六种,或 none(不画图钉、不铺色,名字像地图上的地名) */
export type AuthorMarkColor = 'red' | 'orange' | 'green' | 'blue' | 'purple' | 'teal' | 'none';

export interface AuthorMarkInfo {
  id: number;
  /** 最长 40 字;空的叫「新标记」 */
  title: string;
  /** 可以分行,最长 2000 字 */
  note?: string;
  color: AuthorMarkColor;
  /** 名字的字号:小 / 大 / 特大;不给 = 中 */
  size?: 's' | 'l' | 'xl';
  /** 时间轴在 [from, to] 这些年里(两头都算)地图上才画它;整数年,to 不给 = 一直在 */
  from: number;
  to?: number;
  /** 一个点(世界坐标);和 regions 只给一个 */
  at?: [number, number];
  /** 几个州的键,最多 500 个 */
  regions?: string[];
}

export interface AuthorNoteInfo {
  key: string;
  kind: string;
  title: string;
  text: string;
  createdAt: string;
}

/**
 * 一处地形修改(格式同世界文件,每种的意思见 src/gen/edits.ts 开头「地形修改」那一节的表):
 * pts 是世界坐标的一个点 [x, y] 或折线 [x0, y0, x1, y1, …];r 大小(世界坐标);s 强度(1 = 普通)
 */
export interface TerrainOpInfo {
  kind: 'volcano' | 'range' | 'lake' | 'raise' | 'sink' | 'river' | 'wet' | 'dry' | 'warm' | 'cold' | 'lift' | 'lower' | 'smooth' | 'flatten' | 'setHeight' | 'delWater';
  pts: number[];
  r: number;
  s: number;
  /** 湖岸曲折程度 0–1 */
  e?: number;
  /** 1 = 圈起来填满(气候四种) */
  f?: 1;
  /** 定高的海拔(米) */
  h?: number;
  /** 定高的边缘:0 硬 / 1 适中 / 2 软 */
  edge?: 0 | 1 | 2;
}

/** 用的人改的地形:地形修改(从第 0 年起就那样)、地形大事(那一年发生)、新建世界时涂的草图(格式同世界文件;没画 = 不给) */
export interface AuthorTerrainInfo {
  terrain: TerrainOpInfo[];
  upheavals: { year: number; ops: TerrainOpInfo[] }[];
  sketch?: unknown;
}

/** 君主、掌权的人的倾向:开拓、好战、发展、重商,各 0–100 的整数 */
export interface Leanings {
  expand: number;
  war: number;
  develop: number;
  trade: number;
}

/**
 * 一条命令(干预),和世界文件里的一个格式;每种的意思见 src/gen/edits.ts 开头「干预」那一节的表。
 * a、b、ps、foes、friends、by 是国家键,region、regions、zone、to 是州键,city 是城键,person 是人物键,folk 是民族键;
 * char、lead、author 是用的人放进世界的人物的编号;from、until、born、died 是整数年份。
 * fromTick:在 from 那一年的第几格(1–255,一年 256 格;不给 = 年初)。
 * plot、guide 和方针的 power、unrest、look 是照大纲推演自己记的(author.interventions 读得到),plugin 是推演插件在推演里下的(插件编号):
 * author.apply 交上来的这几样会去掉;别的字段网站不替插件改,不合规矩回 bad-args
 */
export type InterventionInfo = (
  | { kind: 'protect'; a: string; from: number; until?: number }
  | { kind: 'ally'; a: string; b: string; from: number; until?: number }
  | { kind: 'declare'; a: string; b: string; from: number; lead?: number }
  | { kind: 'unity'; a: string; from: number }
  | { kind: 'cede'; a: string; region: string; from: number; permanent?: true }
  | { kind: 'found'; region: string; from: number; name?: string }
  | { kind: 'move'; a: string; city: string; from: number }
  | { kind: 'halt'; a: string; from: number; until?: number }
  | { kind: 'crown'; a: string; char: number; from: number; born: number; until?: number; abdicate?: true; after?: true; keep?: true; leanings: Leanings }
  | { kind: 'keep'; a: string; from: number; until?: number }
  | { kind: 'destroy'; a: string; from: number; b?: string }
  | { kind: 'death'; a: string; person: string; from: number }
  | { kind: 'temper'; a: string; person: string; from: number; leanings: Leanings }
  | {
      kind: 'disaster';
      type: 'plague' | 'famine' | 'quake' | 'pandemic';
      level: 1 | 2 | 3;
      from: number;
      city?: string;
      a?: string;
      regions?: string[];
      region?: string;
      slump?: number;
    }
  | { kind: 'treaty'; a: string; ps: string[]; from: number; term?: number; limited?: true; keep?: true; by?: string; zone?: string; ask?: true }
  | { kind: 'neutral'; a: string; region: string; ps: string[]; from: number; quiet?: true; lasting?: true; until?: number; ask?: true }
  | {
      kind: 'regent';
      a: string;
      person: string;
      char?: undefined;
      from: number;
      how: 'march' | 'heir' | 'uncle' | 'chancellor' | 'general';
      end: 'succeed' | 'return' | 'usurp';
      years?: number;
      leanings?: Leanings;
    }
  | { kind: 'regent'; a: string; person?: undefined; char: number; born: number; died?: number; from: number; how: 'chancellor' | 'general'; end: 'return'; years?: number; leanings: Leanings }
  | { kind: 'marry'; a: string; person: string; b: string; from: number; how?: 'give' | 'mutual' }
  | { kind: 'appoint'; a: string; char: number; role: 'general' | 'minister'; born: number; died?: number; from: number; until?: number; skill?: 'good' | 'great' }
  | { kind: 'boost'; a: string; from: number; mul?: 3 | 10; until?: number; regions?: string[] }
  | { kind: 'trek'; folk: string; from: number; region?: string; to?: string; reach?: 'near' | 'far'; dir?: 'east' | 'south' | 'west' | 'north' }
  | { kind: 'stay'; folk: string; from: number; until?: number }
  | {
      kind: 'policy';
      a: string;
      from: number;
      preset?: 'expand' | 'hold' | 'trade' | 'peace';
      /** 打仗胆量、开拓、沿海、和谈底线:各 −50…50 的整数 */
      war?: number;
      expand?: number;
      coast?: number;
      peace?: number;
      /** 各最多 3 国 */
      foes?: string[];
      friends?: string[];
      focus?: 'production' | 'transport' | 'information' | 'administration' | 'mobilization';
      power?: number;
      unrest?: number;
      look?: { kind: 'war' | 'politics' | 'dynasty'; years: number[] };
    }
) & { fromTick?: number; author?: number; plot?: number; guide?: true; plugin?: string };

/**
 * 改你写的东西(author.write)的一条:
 * name 改名(null 或空的 = 恢复原名;国名末尾的「国」「王朝」这类先去掉,剩下的最长 16 字);
 * mark 加一个标记(不用给 id);intervention 下一条命令
 */
export type AuthorChange =
  | { kind: 'name'; key: string; name: string | null }
  | { kind: 'mark'; mark: Omit<AuthorMarkInfo, 'id'> }
  | { kind: 'intervention'; v: InterventionInfo };

/** applied 照办了几条;skipped 本来就是这样、没变的几条;marks 新标记的编号 */
export interface ApplyResult {
  applied: number;
  skipped: number;
  marks: number[];
}

// ---------------------------------------------------------------------------
// 插件自己的数据(store.local / store.world)

/** value 只能是 null、true / false、有限的数、字、数组、普通对象和数值数组(TypedArray),最多套 32 层 */
export interface StoredData {
  /** 插件自己的结构版本,正整数 */
  schema: number;
  value: unknown;
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
// 图层(layer.cells / layer.regions / layer.marks):插件交数据,网站来画

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

/** 按州按年份的图层:样子同 CellLayerSpec */
export interface RegionLayerSpec extends Omit<CellLayerSpec, 'values'> {
  /** 每一份是哪一年的:整数,从小到大、不重复,在 0 到 history.span() 的 to 之间 */
  years: ArrayLike<number>;
  /** 份数 × 州数(州数 = history.regions() 的个数),第 k 份接在第 k − 1 份后面;NaN = 这个州不画 */
  values: ArrayLike<number>;
}

/** 标注图层的颜色(和你的标记的颜色不是一套) */
export type LayerMarkColor = 'red' | 'orange' | 'green' | 'blue' | 'purple' | 'teal' | 'black' | 'white';

export interface MarkStyle {
  color?: LayerMarkColor;
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
    plates: Call0<PlateInfo[]>;
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
    /** 改朝换代过的国家的各朝;一次最多 2000 个 */
    dynasties: Call<{ polity?: number; offset?: number; limit?: number }, Page<DynastyInfo>>;
    /** 给了年份 = 只列那一年在的;一次最多 2000 份 */
    treaties: Call<{ year?: number; offset?: number; limit?: number }, Page<TreatyInfo>>;
    zones: Call<{ year?: number; offset?: number; limit?: number }, Page<ZoneInfo>>;
    /** 那一年的盟约和宗藩 */
    relations: Call<{ year: number }, RelationsInfo>;
    /** 给了年份 = 只列那一年在的(通着、断着都算);一次最多 2000 条 */
    trade: Call<{ year?: number; offset?: number; limit?: number }, Page<TradeInfo>>;
    /** 一次最多 2000 次 */
    migrations: Call<{ offset?: number; limit?: number }, Page<MigrationInfo>>;
    /** 那一年每州一个数(数组长 = history.regions() 的个数);一次最多取 32 种 */
    regionStats<F extends RegionStat>(args: { year: number; fields: F[] }): Promise<Record<F, Float32Array>>;
  };
  author: {
    marks: Call0<AuthorMarkInfo[]>;
    /** 改过的名字:稳定键 → 名字 */
    names: Call0<Record<string, string>>;
    characters: Call0<unknown[]>;
    interventions: Call0<InterventionInfo[]>;
    /** AI 写的正文;一次最多 100 篇 */
    notes: Call<{ offset?: number; limit?: number }, Page<AuthorNoteInfo>>;
    /** 改过的地形:地形修改、地形大事、草图 */
    terrain: Call0<AuthorTerrainInfo>;
    /** 提一批修改(最多 200 条):有一条不合格整批不改;照办的整批记一步撤销 */
    apply: Call<{ changes: AuthorChange[] }, ApplyResult>;
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
    /** 同 id 的换掉;和地块图层合起来一个插件最多 4 个;份数 × 州数 × 4 字节最多 3.5 MB */
    regions: Call<RegionLayerSpec, void>;
    /** 同 id 的换掉;一个插件最多 4 个,每个最多 5000 项 */
    marks: Call<MarkLayerSpec, void>;
    remove: Call<{ id: string }, void>;
  };
  store: {
    /** 插件自己的设置,不在世界里;最多 64 KB */
    local: { get: Call0<StoredData | null>; set: Call<StoredData, void>; clear: Call0<void> };
    /** 存进这个世界(带了它的世界不能公开分享);最多 1 MB */
    world: { get: Call0<StoredData | null>; set: Call<StoredData, void>; clear: Call0<void> };
  };
}
