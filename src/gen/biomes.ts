/**
 * 生物群落(地貌)总表:每种一条记录 —— 名字、两种画风的颜色、出现条件(按"年均温 × 年降水"查 Whittaker 图)、
 * 画图要的林块 / 地面符号和卫星色阶、图例里列不列,以及推演要的各项数(宜居、通行和修路代价、迁徙快慢、灾年、地力、物产、
 * 各条规则认的地貌标签、拓荒分组、地名语感)。
 * 加一种 = 在 Biome 末尾加一个编号、在 BIOMES 末尾加一条记录;改名、改色、改门槛、改推演的数都只改这一处。
 *
 * 编号存进了存档,各处数组也按编号索引:已有的编号不许改,新的只往后加。
 * 推演在逐地块、逐步的循环里不读记录,载入时用 biomeColumn / biomeTagged 按编号排成一张类型化数组再查。
 */

export enum Biome {
  Ocean = 0,
  Lake = 1,
  SeaIce = 2,
  Ice = 3,
  Tundra = 4,
  Taiga = 5,
  ColdDesert = 6,
  TemperateDesert = 7,
  Steppe = 8,
  TemperateForest = 9,
  TemperateRainforest = 10,
  HotDesert = 11,
  Savanna = 12,
  TropicalDryForest = 13,
  Rainforest = 14,
  Wetland = 15,
}

/** 一个量的范围:from ≤ x < below;不写的一边不设限 */
export interface BiomeRange {
  from?: number;
  below?: number;
}

/**
 * 一条出现条件:落在哪种地表上,再加温度 / 降水 / 海冰覆盖的范围(写了的都满足才算)。
 *   on   land 陆地 / sea 海洋 / lake 湖泊(classifyBiome 的 water = 0 / 1 / 2,别的值都当陆地)
 *   t    年均温(°C)
 *   p    年降水(毫米)
 *   ice  海冰覆盖 0–1(见 seaice.ts;只有海上才有)
 */
export interface BiomeRule {
  on: 'land' | 'sea' | 'lake';
  t?: BiomeRange;
  p?: BiomeRange;
  ice?: BiomeRange;
}

/** 手绘风格的林块 */
export interface BiomeForest {
  /** 画哪种树:broad 阔叶 / pine 针叶 / jungle 雨林 */
  kind: 'broad' | 'pine' | 'jungle';
  /** 低频噪声(约 0–1)超过它的地块成林:越小林子越密 */
  threshold: number;
}

/**
 * 推演里各条规则认的地貌标签(一种地貌可以有好几个;规则按标签挑地貌,不按编号):
 *   arid       开阔干地(草原、稀树草原、荒漠):国家扩张(游牧国家走得快、更想要,polities.ts)、养得了马(trade.ts)、
 *              闹旱灾而不是地震(calamity.ts)、民族善骑(story/cultureTraits.ts)、旗帜的干地图案(story/flags.ts);
 *              民族扩散、同化里开阔干地却不是 nomad 的(稀树草原)另有一档(cultures.ts、assimilation.ts)
 *   nomad      游牧之地(草原、荒漠;稀树草原不算):发源在这儿的是游牧民族、游牧民族走得快(cultures.ts),
 *              游牧民族在这儿难被同化(assimilation.ts)
 *   forest     密林(温带森林、温带雨林、热带雨林、热带季雨林、针叶林):游牧民族、游牧国家走得慢,林地民族走得快(cultures.ts、polities.ts),
 *              林地民族难被同化、游牧移民少来(assimilation.ts,连同 wetland),旗帜的林中图案(story/flags.ts)
 *   wetland    沼泽湿地:同化里和 forest 一样算林地(assimilation.ts)
 *   wilds      山林民族的家(针叶林、雨林、苔原、湿地):发源在这儿、不靠海的是林地民族(cultures.ts)
 *   cold       苦寒之地(苔原、针叶林):发源在这儿的民族遇灾年会举族迁徙(migration.ts),编年史写"苦寒"(story/chronicle.ts)
 *   bogIron    出沼铁:铁的底子加一点(development.ts)
 *   coalBasin  海拔 1000 米以下是古老的成煤盆地(development.ts)
 *   ice        冰原(陆上的冰盖、冻住的湖):路不通(routes.ts)、湖岸算冻住的湖(habitat.ts)、不起湖名(places.ts)
 *   seaIce     海冰:冻住的海,不能靠港、不能航行(habitat.ts、polities.ts、routes.ts)
 */
export const BIOME_TAGS = ['arid', 'nomad', 'forest', 'wetland', 'wilds', 'cold', 'bogIron', 'coalBasin', 'ice', 'seaIce'] as const;
export type BiomeTag = (typeof BIOME_TAGS)[number];

/** 拓荒设定里"地形难走程度"的分组(frontier.ts 的 TERRAIN_GROUPS;那边另有不按群落的"高山") */
export type BiomeTerrainGroup = 'grass' | 'forest' | 'rainforest' | 'wetland' | 'desert' | 'taiga' | 'tundra';

/** 推演用的数字段(每种地貌都要填;biomeColumn 按它排成数组) */
export const BIOME_SIM_NUMBERS = ['habitability', 'travelCost', 'roadCost', 'trekPace', 'famineRisk', 'soilFragility', 'grain', 'pasture', 'timber', 'oil'] as const;
export type BiomeSimNumber = (typeof BIOME_SIM_NUMBERS)[number];

export interface BiomeInfo {
  /** 编号,等于这条记录在 BIOMES 里的位置 */
  id: Biome;
  name: string;
  /** 写实风格颜色(数据图层「生物群落」也用它) */
  real: [number, number, number];
  /** 手绘风格水彩色 */
  paint: [number, number, number];
  /**
   * 出现条件:满足其中任一条就是这种。所有记录的条件合起来要把每种地表不重不漏地分完(载入时检查,有重叠或空缺直接报错);
   * 空 = classifyBiome 从不判出这种
   */
  when: readonly BiomeRule[];
  /** 数据图层「生物群落」的图例里列不列 */
  legend: boolean;
  /** 手绘风格:长什么林子;不写 = 不长 */
  forest?: BiomeForest;
  /** 手绘风格:不在林子里的地块撒什么小符号,dune 沙丘 / tuft 草丛 / marsh 沼泽(水纹 + 草丛);不写 = 不撒 */
  ground?: 'dune' | 'tuft' | 'marsh';
  /**
   * 写实风格:同一种群落里从暗到亮的七档颜色,取自 NASA「蓝色弹珠」(Blue Marble)卫星合成图(公有领域)上真实地区的陆地像素 ——
   * 每种群落挑几块典型地区(热带荒漠:撒哈拉、阿拉伯、澳洲中部;热带雨林:亚马孙、刚果、婆罗洲……),去掉雪,
   * 按亮度排序,七个分位数段各取中位色。怎么用见 realistic.ts 的 biomeRamp;不写 = 整片一个颜色
   */
  satRamp?: readonly string[];

  // ---- 推演用的数(按地块或州的主导群落查;水面、冰的那几格多半用不上,也照样填) ----
  /**
   * 宜居底分(0–100,温带森林 100;habitat.ts):地块宜居分从它起算,再加淡水、海岸,减海拔、坡度;0 = 不可居。
   * 按开垦以后养得活多少人排:温带森林(砍了林子就是良田)最高,热带季雨林(雨季种稻)次之,温带雨林多在迎风的山坡上;
   * 草原、稀树草原雨水不够,不靠河只能放牧;热带雨林土薄、多病、难开垦,比季雨林低得多
   */
  habitability: number;
  /**
   * 通行代价(温带森林 70;水面 0,由各自规则另算):民族扩散(cultures.ts,(代价 / 70)^0.9)、
   * 国家扩张(polities.ts,(max(1, 代价) / 70)^0.6)换算成群落系数;拓荒设定的地形难走程度乘在它换算出的系数上
   */
  travelCost: number;
  /** 修路难度(倍数,1 = 平常;routes.ts:一段路两头地块的平均值乘在代价上) */
  roadCost: number;
  /** 大迁徙走一州的地形系数(倍数,乘在走一州的年数上;trekRoute.ts,界面上估迁徙路线也用):草原荒漠快,林地、湿地慢 */
  trekPace: number;
  /** 闹灾年的倍数(1 = 平常;unrest.ts,按州的主导群落):干旱、寒冷的地方更容易闹 */
  famineRisk: number;
  /**
   * 地经不经得住种(population.ts):种满了每年耗地力的倍数,越大越不经种;流着、挨着大河的地块另有淤泥补
   */
  soilFragility: number;
  /** 物产・粮(development.ts):乘在地块的宜居分上累加(草原、荒漠不靠河种不了多少) */
  grain: number;
  /** 物产・牧(development.ts):逐地块累加 */
  pasture: number;
  /** 物产・木材(development.ts):逐地块累加 */
  timber: number;
  /** 物产・石油(development.ts):海拔 600 米以下的地块累加 */
  oil: number;
  /** 推演各条规则认的标签,见 BiomeTag;没有就写空 */
  tags: readonly BiomeTag[];
  /**
   * 荒漠的冷热:写了就是荒漠 —— 荒漠地名的连通片按它圈,后缀看哪种占多(热的叫沙漠、冷的叫荒原、其余叫荒漠;places.ts),
   * 荒漠盆地出盐(development.ts);不写 = 不是荒漠
   */
  desert?: 'hot' | 'temperate' | 'cold';
  /** 拓荒设定里归哪一组地形(frontier.ts);不写 = 不归哪组(水面、冰) */
  frontier?: BiomeTerrainGroup;
  /** 地名语感(names 里语感的 id):发源在这种群落的民族挑这几种语感时加分(naming.ts);没有就写空 */
  nameStyles: readonly string[];
}

const hex = (s: string): [number, number, number] => [
  parseInt(s.slice(1, 3), 16),
  parseInt(s.slice(3, 5), 16),
  parseInt(s.slice(5, 7), 16),
];

export const BIOMES: readonly BiomeInfo[] = [
  {
    id: Biome.Ocean,
    name: '海洋',
    real: hex('#1d4e74'),
    paint: hex('#a9c1c0'),
    when: [{ on: 'sea', ice: { below: 0.5 } }],
    legend: false,
    habitability: 0, travelCost: 0, roadCost: 1, trekPace: 1, famineRisk: 1, soilFragility: 0.2,
    grain: 0, pasture: 0, timber: 0, oil: 0,
    tags: [],
    nameStyles: [],
  },
  {
    id: Biome.Lake,
    name: '湖泊',
    real: hex('#3b739a'),
    paint: hex('#9fbcc0'),
    when: [{ on: 'lake', t: { from: -6 } }],
    legend: true,
    habitability: 0, travelCost: 0, roadCost: 1, trekPace: 1, famineRisk: 1, soilFragility: 0.2,
    grain: 0, pasture: 0, timber: 0, oil: 0,
    tags: [],
    nameStyles: [],
  },
  {
    id: Biome.SeaIce,
    name: '海冰',
    real: hex('#e9eff3'),
    paint: hex('#eef0ea'),
    // 海冰覆盖过半
    when: [{ on: 'sea', ice: { from: 0.5 } }],
    legend: true,
    habitability: 0, travelCost: 5000, roadCost: 1, trekPace: 1, famineRisk: 1, soilFragility: 0.2,
    grain: 0, pasture: 0, timber: 0, oil: 0,
    tags: ['seaIce'],
    nameStyles: [],
  },
  {
    id: Biome.Ice,
    name: '冰原',
    real: hex('#f3f6f8'),
    /** 雪:像羊皮纸上的留白,略带一点冷调(和纸色混合后接近山丘符号的底色) */
    paint: hex('#ebe6d8'),
    when: [
      { on: 'land', t: { below: -9 } },
      { on: 'lake', t: { below: -6 } },
    ],
    legend: true,
    habitability: 0, travelCost: 5000, roadCost: 1, trekPace: 1, famineRisk: 1, soilFragility: 0.2,
    grain: 0, pasture: 0, timber: 0, oil: 0,
    tags: ['ice'],
    nameStyles: [],
  },
  {
    id: Biome.Tundra,
    name: '苔原',
    real: hex('#8b8a70'),
    paint: hex('#cfc9ad'),
    when: [{ on: 'land', t: { from: -9, below: -2 }, p: { from: 150 } }],
    legend: true,
    ground: 'tuft',
    satRamp: ['#272312', '#332f19', '#3c3520', '#413b24', '#494129', '#616058', '#7f7d7a'],
    habitability: 4, travelCost: 1000, roadCost: 1.25, trekPace: 1.2, famineRisk: 1.3, soilFragility: 0.4,
    grain: 0, pasture: 0.3, timber: 0, oil: 0.4,
    tags: ['wilds', 'cold'],
    frontier: 'tundra',
    nameStyles: ['nordic'],
  },
  {
    id: Biome.Taiga,
    name: '针叶林',
    real: hex('#2e4a37'),
    paint: hex('#9fae8a'),
    when: [{ on: 'land', t: { from: -2, below: 5 }, p: { from: 280 } }],
    legend: true,
    forest: { kind: 'pine', threshold: 0.44 },
    satRamp: ['#161a09', '#1c1e0d', '#202311', '#262818', '#2e3021', '#3b3e30', '#515348'],
    habitability: 12, travelCost: 200, roadCost: 1.2, trekPace: 1.5, famineRisk: 1.3, soilFragility: 0.4,
    grain: 0.3, pasture: 0, timber: 1, oil: 0.2,
    tags: ['forest', 'wilds', 'cold', 'bogIron', 'coalBasin'],
    frontier: 'taiga',
    nameStyles: ['nordic', 'slavic'],
  },
  {
    id: Biome.ColdDesert,
    name: '寒漠',
    real: hex('#a49c84'),
    paint: hex('#d9cfae'),
    when: [
      { on: 'land', t: { from: -9, below: -2 }, p: { below: 150 } },
      { on: 'land', t: { from: -2, below: 5 }, p: { below: 280 } },
    ],
    legend: true,
    satRamp: ['#735e3d', '#7e6746', '#856e4d', '#8b7554', '#917b5b', '#978363', '#a08e71'],
    habitability: 10, travelCost: 150, roadCost: 1.15, trekPace: 0.7, famineRisk: 1.7, soilFragility: 1,
    grain: 0.2, pasture: 0.5, timber: 0, oil: 0.6,
    tags: ['arid', 'nomad'],
    desert: 'cold',
    frontier: 'desert',
    nameStyles: ['nordic', 'desert', 'steppe', 'frontier'],
  },
  {
    id: Biome.TemperateDesert,
    name: '温带荒漠',
    real: hex('#c6b089'),
    paint: hex('#e6d3a4'),
    when: [{ on: 'land', t: { from: 5, below: 18 }, p: { below: 250 } }],
    legend: true,
    ground: 'dune',
    satRamp: ['#664d31', '#745b3e', '#816a4b', '#8d785c', '#97846a', '#a49373', '#ab9b7b'],
    habitability: 7, travelCost: 170, roadCost: 1.15, trekPace: 0.7, famineRisk: 1.7, soilFragility: 1,
    grain: 0.3, pasture: 0.4, timber: 0, oil: 0.9,
    tags: ['arid', 'nomad'],
    desert: 'temperate',
    frontier: 'desert',
    nameStyles: ['desert', 'steppe', 'frontier'],
  },
  {
    id: Biome.Steppe,
    name: '草原',
    real: hex('#9f9c62'),
    paint: hex('#d8d09a'),
    when: [{ on: 'land', t: { from: 5, below: 18 }, p: { from: 250, below: 600 } }],
    legend: true,
    ground: 'tuft',
    satRamp: ['#4d4326', '#56482b', '#5b4c2e', '#624f31', '#6b5436', '#785b3c', '#876544'],
    habitability: 35, travelCost: 50, roadCost: 1, trekPace: 0.7, famineRisk: 1.4, soilFragility: 0.7,
    grain: 0.5, pasture: 1, timber: 0, oil: 0.5,
    tags: ['arid', 'nomad', 'coalBasin'],
    frontier: 'grass',
    nameStyles: ['kingdom', 'desert', 'steppe', 'central', 'frontier'],
  },
  {
    id: Biome.TemperateForest,
    name: '温带森林',
    real: hex('#46683a'),
    paint: hex('#b3bd8b'),
    when: [{ on: 'land', t: { from: 5, below: 18 }, p: { from: 600, below: 2300 } }],
    legend: true,
    forest: { kind: 'broad', threshold: 0.43 },
    satRamp: ['#1c230b', '#21270f', '#252b12', '#293015', '#2f3518', '#373b1d', '#464526'],
    habitability: 100, travelCost: 70, roadCost: 1.1, trekPace: 1.2, famineRisk: 1, soilFragility: 0.2,
    grain: 1, pasture: 0.2, timber: 1, oil: 0,
    tags: ['forest', 'coalBasin'],
    frontier: 'forest',
    nameStyles: ['imperial', 'kingdom', 'slavic', 'hellenic', 'elven', 'central'],
  },
  {
    id: Biome.TemperateRainforest,
    name: '温带雨林',
    real: hex('#2c5634'),
    paint: hex('#9fb488'),
    when: [{ on: 'land', t: { from: 5, below: 18 }, p: { from: 2300 } }],
    legend: true,
    forest: { kind: 'pine', threshold: 0.36 },
    satRamp: ['#0d1405', '#111909', '#151e0d', '#1a2513', '#222e1b', '#323a27', '#55584d'],
    habitability: 60, travelCost: 90, roadCost: 1.25, trekPace: 1.5, famineRisk: 0.8, soilFragility: 0.2,
    grain: 0.7, pasture: 0, timber: 1, oil: 0,
    tags: ['forest', 'wilds', 'coalBasin'],
    frontier: 'rainforest',
    nameStyles: ['kingdom', 'elven', 'central', 'xianxia', 'mythic'],
  },
  {
    id: Biome.HotDesert,
    name: '热带荒漠',
    real: hex('#d9bd8c'),
    paint: hex('#ecd5a0'),
    when: [{ on: 'land', t: { from: 18 }, p: { below: 320 } }],
    legend: true,
    ground: 'dune',
    satRamp: ['#7c5134', '#9f7e59', '#b39067', '#bb986c', '#c09e72', '#c5a577', '#cbad81'],
    habitability: 4, travelCost: 200, roadCost: 1.3, trekPace: 0.7, famineRisk: 1.7, soilFragility: 1,
    grain: 0.3, pasture: 0.1, timber: 0, oil: 1,
    tags: ['arid', 'nomad'],
    desert: 'hot',
    frontier: 'desert',
    nameStyles: ['desert', 'frontier'],
  },
  {
    id: Biome.Savanna,
    name: '稀树草原',
    real: hex('#ab9c5c'),
    paint: hex('#dccd92'),
    when: [{ on: 'land', t: { from: 18 }, p: { from: 320, below: 950 } }],
    legend: true,
    ground: 'tuft',
    satRamp: ['#3f3f1e', '#564a2b', '#615031', '#695637', '#745e3e', '#856c49', '#a0825a'],
    habitability: 30, travelCost: 60, roadCost: 1, trekPace: 0.7, famineRisk: 1.4, soilFragility: 0.7,
    grain: 0.6, pasture: 0.8, timber: 0.2, oil: 0.3,
    tags: ['arid'],
    frontier: 'grass',
    nameStyles: ['hellenic', 'desert', 'frontier'],
  },
  {
    id: Biome.TropicalDryForest,
    name: '热带季雨林',
    real: hex('#607a36'),
    paint: hex('#bcc38a'),
    when: [{ on: 'land', t: { from: 18 }, p: { from: 950, below: 1800 } }],
    legend: true,
    forest: { kind: 'broad', threshold: 0.52 },
    satRamp: ['#2c3313', '#353a1a', '#3c3e1e', '#424222', '#474526', '#50492b', '#605133'],
    habitability: 75, travelCost: 70, roadCost: 1.1, trekPace: 1.2, famineRisk: 1.1, soilFragility: 0.5,
    grain: 1, pasture: 0.2, timber: 0.7, oil: 0,
    tags: ['forest'],
    frontier: 'forest',
    nameStyles: ['imperial', 'hellenic', 'elven', 'xianxia', 'mythic'],
  },
  {
    id: Biome.Rainforest,
    name: '热带雨林',
    real: hex('#224c27'),
    paint: hex('#9db482'),
    when: [{ on: 'land', t: { from: 18 }, p: { from: 1800 } }],
    legend: true,
    forest: { kind: 'jungle', threshold: 0.32 },
    satRamp: ['#142208', '#16250a', '#18270a', '#19280c', '#1a2a0c', '#1c2c0d', '#1f2f10'],
    habitability: 35, travelCost: 80, roadCost: 1.4, trekPace: 1.5, famineRisk: 0.8, soilFragility: 0.5,
    grain: 0.5, pasture: 0, timber: 0.8, oil: 0,
    tags: ['forest', 'wilds'],
    frontier: 'rainforest',
    nameStyles: ['elven', 'xianxia', 'mythic'],
  },
  {
    id: Biome.Wetland,
    name: '湿地',
    real: hex('#5c9c8e'),
    paint: hex('#a9bca6'),
    // 不按温度、降水查:按地势、排水、水的来路另算(gen/wetland.ts),盖在上面那些陆地群落上
    when: [],
    legend: true,
    ground: 'marsh',
    // 宜居和草原、热带雨林一档:能渔猎、种稻,但要排水,远不如良田;难走、难修路
    habitability: 35, travelCost: 150, roadCost: 1.5, trekPace: 1.5, famineRisk: 0.8, soilFragility: 0.2,
    grain: 0.5, pasture: 0, timber: 0.3, oil: 0.8,
    tags: ['wetland', 'wilds', 'bogIron', 'coalBasin'],
    frontier: 'wetland',
    nameStyles: [],
  },
];

// ---------------------------------------------------------------------------
// 推演查表:载入时按编号排成类型化数组,逐地块、逐步的循环里查它,不逐次读记录

/**
 * 地貌表的一个数字段按编号排成一张数组。type = 要的数组类型(默认 Float64Array:和普通数组里的数逐位一样;
 * 原来按 Float32Array、Uint8Array 存的表照原类型建,舍入才不变)
 */
export function biomeColumn(key: BiomeSimNumber): Float64Array;
export function biomeColumn<A>(key: BiomeSimNumber, type: { from(src: ArrayLike<number>): A }): A;
export function biomeColumn(key: BiomeSimNumber, type: { from(src: ArrayLike<number>): unknown } = Float64Array): unknown {
  return type.from(BIOMES.map((b) => b[key]));
}

/** 满足条件的地貌 = 1、别的 = 0(按编号) */
export function biomeMask(test: (b: BiomeInfo) => boolean): Uint8Array {
  return Uint8Array.from(BIOMES, (b) => (test(b) ? 1 : 0));
}

/** 带这几个标签之一的地貌 = 1、别的 = 0(按编号) */
export function biomeTagged(...tags: BiomeTag[]): Uint8Array {
  return biomeMask((b) => tags.some((t) => b.tags.includes(t)));
}

/** 编号 b 的地貌带不带这个标签(不在表里的编号,比如 −1,算不带);只在不常调的地方用,循环里用 biomeTagged 的表 */
export function biomeHas(b: number, tag: BiomeTag): boolean {
  return BIOMES[b]?.tags.includes(tag) ?? false;
}

// ---------------------------------------------------------------------------
// 出现条件编成三层查找表(逐像素调用,不能在热路径上遍历记录):
// 先按地表分(陆地 / 海洋 / 湖泊各一个根),再依次按海冰、温度、降水切。每层的每个格子把下一层的门槛平铺在一起:
// 第 k 格的门槛是 THR[OFF[k] .. OFF[k+1]),落在第 b 档就进下一层的第 OFF[k] + k + b 格;最后一层的格子直接是群落编号。

/** 三个根的顺序(classifyBiome 按 water 挑根:0 陆地 / 1 海洋 / 2 湖泊) */
const SURFACE = ['land', 'sea', 'lake'] as const;
const AXES = ['ice', 't', 'p'] as const;

export interface BiomeLookup {
  /** 三层(海冰、温度、降水)各自平铺的门槛 */
  thr: [Float64Array, Float64Array, Float64Array];
  /** 三层各格门槛的起点(多一个收尾) */
  off: [Int32Array, Int32Array, Int32Array];
  /** 最后一层每一档的群落编号 */
  out: Uint8Array;
}

type Clause = { biome: Biome; rule: BiomeRule };

const rangeLo = (r: BiomeRange | undefined) => r?.from ?? -Infinity;
const rangeHi = (r: BiomeRange | undefined) => r?.below ?? Infinity;

/** 把出现条件编成查找表;有重叠、有空缺(某种地表上某一段谁都不是)、范围写反了就报错 */
export function compileBiomeRules(table: readonly BiomeInfo[]): BiomeLookup {
  const clauses: Clause[] = [];
  table.forEach((b, i) => {
    if (b.id !== i) throw new Error(`地貌表:第 ${i} 条的编号是 ${b.id}`);
    for (const rule of b.when) {
      for (const axis of AXES) {
        const r = rule[axis];
        if (r && !(rangeLo(r) < rangeHi(r))) throw new Error(`地貌表:${b.name}的 ${axis} 范围是空的`);
      }
      clauses.push({ biome: b.id, rule });
    }
  });
  type Cell = { where: string; clauses: Clause[] };
  let cells: Cell[] = SURFACE.map((s) => ({ where: s, clauses: clauses.filter((c) => c.rule.on === s) }));
  const thr: number[][] = [];
  const off: number[][] = [];
  for (const axis of AXES) {
    const t: number[] = [];
    const o: number[] = [0];
    const next: Cell[] = [];
    for (const cell of cells) {
      const cuts = new Set<number>();
      for (const c of cell.clauses) for (const v of [rangeLo(c.rule[axis]), rangeHi(c.rule[axis])]) if (Number.isFinite(v)) cuts.add(v);
      const sorted = [...cuts].sort((a, b) => a - b);
      t.push(...sorted);
      o.push(t.length);
      const edges = [-Infinity, ...sorted, Infinity];
      for (let b = 0; b + 1 < edges.length; b++) {
        const lo = edges[b];
        const hi = edges[b + 1];
        // 门槛把每条条件的边界都切到了,一条条件要么整档都含、要么整档不含
        const inside = cell.clauses.filter((c) => rangeLo(c.rule[axis]) <= lo && hi <= rangeHi(c.rule[axis]));
        next.push({ where: `${cell.where} ${axis}∈[${lo}, ${hi})`, clauses: inside });
      }
    }
    thr.push(t);
    off.push(o);
    cells = next;
  }
  const out = new Uint8Array(cells.length);
  cells.forEach((cell, i) => {
    if (cell.clauses.length !== 1) {
      const who = cell.clauses.map((c) => table[c.biome].name).join('、') || '没有群落';
      throw new Error(`地貌表:${cell.where} 是${who}`);
    }
    out[i] = cell.clauses[0].biome;
  });
  return {
    thr: [Float64Array.from(thr[0]), Float64Array.from(thr[1]), Float64Array.from(thr[2])],
    off: [Int32Array.from(off[0]), Int32Array.from(off[1]), Int32Array.from(off[2])],
    out,
  };
}

const {
  thr: [ICE_THR, T_THR, P_THR],
  off: [ICE_OFF, T_OFF, P_OFF],
  out: OUT,
} = compileBiomeRules(BIOMES);

/**
 * 按 BIOMES 的出现条件判群落。water:0 陆地 / 1 海洋 / 2 湖泊;ice:海冰覆盖 0–1(见 seaice.ts),只对海洋有意义。
 * 数据缺失(NaN)时温度、降水落最高一档,海冰按没有冰算。
 */
/** 陆上冰原的年均温门槛(°C;低于它是冰原,见地貌表冰原那一条) */
export const LAND_ICE_BELOW: number = (() => {
  const t = BIOMES.find((b) => b.id === Biome.Ice)?.when.find((w) => w.on === 'land')?.t;
  if (t?.below === undefined) throw new Error('地貌表里冰原没有陆上的温度门槛');
  return t.below;
})();

export function classifyBiome(t: number, p: number, water: number, ice = 0): Biome {
  let k = water === 1 ? 1 : water === 2 ? 2 : 0;
  let i = ICE_OFF[k];
  let e = ICE_OFF[k + 1];
  while (i < e && ice >= ICE_THR[i]) i++;
  k += i;
  i = T_OFF[k];
  e = T_OFF[k + 1];
  while (i < e && !(t < T_THR[i])) i++;
  k += i;
  i = P_OFF[k];
  e = P_OFF[k + 1];
  while (i < e && !(p < P_THR[i])) i++;
  return OUT[k + i];
}
