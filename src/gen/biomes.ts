/**
 * 生物群落(地貌)总表:每种一条记录 —— 名字、两种画风的颜色、出现条件(按"年均温 × 年降水"查 Whittaker 图)、
 * 画图要的林块 / 地面符号和卫星色阶、图例里列不列。
 * 加一种 = 在 Biome 末尾加一个编号、在 BIOMES 末尾加一条记录;改名、改色、改门槛都只改这一处。
 *
 * 编号存进了存档,各处数组也按编号索引:已有的编号不许改,新的只往后加。
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
  /** 手绘风格:不在林子里的地块撒什么小符号,dune 沙丘 / tuft 草丛;不写 = 不撒 */
  ground?: 'dune' | 'tuft';
  /**
   * 写实风格:同一种群落里从暗到亮的七档颜色,取自 NASA「蓝色弹珠」(Blue Marble)卫星合成图(公有领域)上真实地区的陆地像素 ——
   * 每种群落挑几块典型地区(热带荒漠:撒哈拉、阿拉伯、澳洲中部;热带雨林:亚马孙、刚果、婆罗洲……),去掉雪,
   * 按亮度排序,七个分位数段各取中位色。怎么用见 realistic.ts 的 biomeRamp;不写 = 整片一个颜色
   */
  satRamp?: readonly string[];
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
  },
  {
    id: Biome.Lake,
    name: '湖泊',
    real: hex('#3b739a'),
    paint: hex('#9fbcc0'),
    when: [{ on: 'lake', t: { from: -6 } }],
    legend: true,
  },
  {
    id: Biome.SeaIce,
    name: '海冰',
    real: hex('#e9eff3'),
    paint: hex('#eef0ea'),
    // 海冰覆盖过半
    when: [{ on: 'sea', ice: { from: 0.5 } }],
    legend: true,
  },
  {
    id: Biome.Ice,
    name: '冰原',
    real: hex('#f3f6f8'),
    paint: hex('#f4f2ea'),
    when: [
      { on: 'land', t: { below: -9 } },
      { on: 'lake', t: { below: -6 } },
    ],
    legend: true,
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
  },
  {
    id: Biome.Wetland,
    name: '湿地',
    real: hex('#4b6647'),
    paint: hex('#b2bd98'),
    // 还没有出现条件:目前不会生成
    when: [],
    legend: false,
  },
];

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
