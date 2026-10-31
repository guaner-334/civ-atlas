/**
 * 乡村人口:按地块记(千人;只算养得了人的陆地块,大约三成),在政局的数表里每 POP_EVERY 年算一步(年初;规则见 stateTables.ts;control.ts 建引擎时把这里挂上)。
 * 一州的乡村人口上限按各块的宜居分摊开;人会搬家:往不挤的邻块去、逃兵灾;死伤、逃散以后几十年长回来。城自己的人口仍照 S 形曲线现算(growth.ts 的 populationAt)。
 * 州、国家的人口、钱粮、发展度读的是按州汇总的数。
 *
 * **几张表**:
 *   垦(按州,开垦了几成,0–1):这州建了第一座城起从 1 / (1 + GROWTH_A) 按 S 形曲线长,速度 = 那座城的增长速度(和原来的乡村人口一样慢,
 *     要一两千年才长满);"上限 × 垦"是太平年景这州该有多少人。上限 = 州的面积 × 宜居 × 随生产能力变的倍数(development.ts 的 ruralTargets)。
 *   兵祸(按州,0–1):上一步的 × FADE^年数 + HIT × 上一步以来本州的兵灾件数(战役、攻占、洗劫、毁城、饥荒),最多 1。
 *   地力(按地块,0–1):每年养回来缺的 LAND_REST;种得越满耗得越多(WEAR × 垦 × 脆:荒漠的地最经不住种,草原次之,
 *     流着、挨着大河的有淤泥补、减半),兵祸荒了田再耗 SCORCH × 兵祸,上一步以来所在州每件饥荒、大水、大旱扣 BLIGHT,最低 LAND_FLOOR。
 *     "该有的"乘它;按州加权的(州地力)田赋也乘它,地薄的州更容易闹饥荒(unrest.ts 读)。
 *   乡民(按地块的乡村人口):每年往"该有的"(上限 × 份 × 垦 × 地力)靠拢 1 / RECOVER(多出来的慢慢退回去),再往邻块搬:
 *     人往不挤的地方去:自己比邻块挤(人口 ÷ 该有的)多少,每年搬 MIG × 那么多成;逃兵灾:所在州兵祸比邻块的重多少,每年再搬 FLEE × 那么多成。
 *     跨国打 ABROAD 折,没人住过的州不去;块之间挨着才搬(隔着海、不毛之地过不去)。
 *   乡口(按州):各块之和。
 *
 * **事件写回**(每一步算之前,上一步以来的):洗劫、饥荒、地震时一州各块折损城里那一成的 RURAL_WAR,瘟疫 RURAL_PLAGUE、
 *   全球大疫凋敝里的复作 RURAL_SLUMP(growth.ts 的 ruralShare),毁城当作折损全部;按城表(Settlement.sacks、ended)和史事(battle、conquer)
 *   一件件看,只看这一刻以前的,接着推时按存的那一年接上。
 *   全球大疫的凋敝里(pandemic.ts)乡民不往"该有的"长回去(输入表"凋敝" = 这一步里凋敝占几成;没有全球大疫时全是 0)。
 *
 * **快照**:每 RURAL_SNAP 年存一份按州的进 Civ.development.rural(界面上州、国家的人口按前后两份线性插值,growth.ts 的 ruralPopulationAt)。
 * 随机数:不用。纯计算,不碰 DOM。
 */
import type { Year } from './types';
import { MAJOR_RIVER } from './habitat';
import { biomeColumn } from '../biomes';
import { quakeWord } from './calamity';
import type { CivSim } from './engine/sim';
import type { PolityModel } from './polities';
import { RURAL_SNAP, ruralTargets, type DevModel } from './development';
import { GROWTH_A, RURAL_WAR, SACK_RECOVER, ruralShare } from './growth';
import { pandemicModelOf, slumpIn } from './pandemicState';
import type { TableEngine } from './engine/tables';
import type { PopRuleConsts } from './stateTables';
import { fpow } from './engine/rand';

// ---- 调参(以 20 个种子的统计为准,见 scripts/control-stats.ts) ----
/** 几年算一步(搬家要算每条邻边,每年算太慢;钱粮每 10 年读一次、快照每 10 年一份,都对得齐) */
const POP_EVERY = 5;
/** 往"该有的"靠拢:每年缺口(或多出来的)的 1 / RECOVER(和城被洗劫后长回来一样快) */
const RECOVER = SACK_RECOVER;
/** 人往不挤的地方去:挤的差每年搬几成 */
const MIG = 0.01;
/** 逃兵灾:兵祸的差每年搬几成(分给有人住的邻州) */
const FLEE = 0.05;
/** 兵祸:每件兵灾加几成;每年留几成 */
const HIT = 0.5;
const FADE = 0.7;
/** 跨国、翻山、过海峡打的折 */
const ABROAD = 0.3;
const MOUNTAIN_W = 0.5;
const STRAIT_W = 0.3;
/** 地力:每年养回来缺的几成;种满了每年耗几成(再乘 脆);兵祸每年耗几成;一件饥荒、大水、大旱扣几成;最低多少 */
const LAND_REST = 0.01;
const WEAR = 0.0035;
const SCORCH = 0.01;
const BLIGHT = 0.05;
const LAND_FLOOR = 0.5;
/** 全球大疫的凋敝里乡民往"该有的"长回去的少几成(无人收拾,几乎不长;复作的折损见 pandemic.ts) */
const SLUMP_HOLD = 0.7;
/** 地经不经得住种(按地块的生物群落,见地貌表的 soilFragility;表外的编号 FRAGILE_ELSE);流着、挨着大河的有淤泥补,乘 RIVER_SILT */
const FRAGILE = biomeColumn('soilFragility');
const FRAGILE_ELSE = 0.2;
const RIVER_SILT = 0.5;

/** 乡村人口的常数(见 stateTables.ts) */
export const POP_CONSTS: PopRuleConsts = {
  GROWTH_A,
  POP_EVERY,
  RECOVER,
  MIG,
  FLEE,
  HIT,
  FADE,
  FADE_STEP: fpow(FADE, POP_EVERY),
  ABROAD,
  MOUNTAIN_W,
  STRAIT_W,
  LAND_REST,
  WEAR,
  SCORCH,
  BLIGHT,
  LAND_FLOOR,
};

/** 存档要存的表(接着推时填回) */
export const POP_TABLES = ['垦', '兵祸', '地力', '乡民', '乡口', '州地力'] as const;

/** 按地块的表:哪些块(养得了人的陆地,按州排好)、块之间怎么挨着、各块归哪州 */
export interface PopTiles {
  count: number;
  /** 第 k 块是世界上的哪个地块 */
  cell: Int32Array;
  adjStart: Int32Array;
  adj: Int32Array;
  /** 块 → 州;州里的块(CSR,块已按州排好,cells 就是 0、1、2……) */
  of: Int32Array;
  cellStart: Int32Array;
  cells: Int32Array;
}

/** 按地块的表(存档里按世界上的地块存,地形改了也对得上) */
export const POP_TILE_TABLES = ['地力', '乡民'] as const;

const tilesMemo = new WeakMap<DevModel, PopTiles>();

/** 乡村人口、地力只算养得了人的陆地块(宜居度 > 0,大约三成):海、冰原、不毛之地不进表 */
export function popTiles(dev: DevModel): PopTiles {
  const hit = tilesMemo.get(dev);
  if (hit) return hit;
  const reg = dev.pm.terrain.regions;
  const R = dev.R;
  const mesh = dev.world.mesh;
  const cap = dev.habitat.capacity;
  const index = new Int32Array(mesh.n).fill(-1);
  const list: number[] = [];
  const cellStart = new Int32Array(R + 1);
  for (let r = 0; r < R; r++) {
    for (let k = reg.cellStart[r]; k < reg.cellStart[r + 1]; k++) {
      const i = reg.cells[k];
      if (cap[i] > 0) (index[i] = list.length), list.push(i);
    }
    cellStart[r + 1] = list.length;
  }
  const count = list.length;
  const cell = Int32Array.from(list);
  const of = new Int32Array(count);
  for (let r = 0; r < R; r++) of.fill(r, cellStart[r], cellStart[r + 1]);
  const adjStart = new Int32Array(count + 1);
  const nbs: number[] = [];
  for (let k = 0; k < count; k++) {
    const i = cell[k];
    for (let q = mesh.adjStart[i]; q < mesh.adjStart[i + 1]; q++) if (index[mesh.adj[q]] >= 0) nbs.push(index[mesh.adj[q]]);
    adjStart[k + 1] = nbs.length;
  }
  // 引擎要邻居按编号升序
  const adj = Int32Array.from(nbs);
  for (let k = 0; k < count; k++) adj.subarray(adjStart[k], adjStart[k + 1]).sort();
  const cells = new Int32Array(count);
  for (let k = 0; k < count; k++) cells[k] = k;
  const out = { count, cell, adjStart, adj, of, cellStart, cells };
  tilesMemo.set(dev, out);
  return out;
}

/** 按州的乡村人口按宜居分摊到各块(读以前按州存的存档) */
export function spreadRural(dev: DevModel, T: PopTiles, perRegion: Float64Array): Float64Array {
  const reg = dev.pm.terrain.regions;
  const cap = dev.habitat.capacity;
  const out = new Float64Array(T.count);
  for (let k = 0; k < T.count; k++) {
    const r = T.of[k];
    const total = reg.capacity[r];
    out[k] = total > 0 && r < perRegion.length ? (perRegion[r] * cap[T.cell[k]]) / total : 0;
  }
  return out;
}

/** 存档:按块的值摊回世界上的地块(没进表的地块 = off) */
export function tilesToCells(T: PopTiles, n: number, v: Float64Array, off: number): Float64Array {
  const out = new Float64Array(n).fill(off);
  for (let k = 0; k < T.count; k++) out[T.cell[k]] = v[k];
  return out;
}

/** 读档:世界上的地块 → 按块的值;长度对不上(旧版本按州存的)= null */
export function cellsToTiles(T: PopTiles, n: number, v: Float64Array): Float64Array | null {
  if (v.length !== n) return null;
  const out = new Float64Array(T.count);
  for (let k = 0; k < T.count; k++) out[k] = v[T.cell[k]];
  return out;
}

export interface PopLayer {
  /** 第 t 年要算乡村人口的话:填输入(乡村人口上限、长得多快、上一步以来的兵灾),把上一步以来的折损写回乡口(引擎 start 之后、step 之前) */
  prepare(t: Year): void;
  /** 引擎算完第 t 年:算了乡村人口、又在整 RURAL_SNAP 年上的,存一份快照 */
  done(t: Year): void;
}

/**
 * 挂到政局的数表上。resumed:接着推时存档里政局的数表算到的年份(从头推 = null):
 * 乡村人口最后一步(不晚于它的整 POP_EVERY 年)以前的折损、兵灾算过了(一步只看那一刻以前的),之后的接着看
 */
export function popLayer(sim: CivSim, pm: PolityModel, dev: DevModel, eng: TableEngine, resumed: Year | null): PopLayer {
  const R = dev.R;
  const from = resumed === null ? null : Math.floor(resumed / POP_EVERY) * POP_EVERY;
  /** 各城看到第几次折损、毁城看过没有;史事看到第几条 */
  let seen = new Int32Array(0);
  let ended = new Uint8Array(0);
  let annal = 0;
  const grow = (n: number) => {
    if (seen.length >= n) return;
    const a = new Int32Array(Math.max(n, 2 * seen.length));
    a.set(seen);
    seen = a;
    const b = new Uint8Array(a.length);
    b.set(ended);
    ended = b;
  };
  if (from !== null) {
    const S = pm.settlements;
    grow(S.length);
    for (let i = 0; i < S.length; i++) {
      const sk = S[i].sacks;
      let k = 0;
      if (sk) while (k < sk.length && sk[k].year < from) k++;
      seen[i] = k;
      const e = S[i].ended;
      ended[i] = e !== undefined && e < from ? 1 : 0;
    }
    while (annal < sim.annalCount && sim.annal(annal).year < from) annal++;
  }
  let last = from ?? -Infinity;
  dev.ruralNow = () => ({ year: last, data: eng.get('乡口') });
  dev.soilNow = () => eng.get('州地力');

  const reg = pm.terrain.regions;
  const T = popTiles(dev);
  const { of, cellStart, cells } = T;
  /** 哪些州有人住过(乡村人口上限 > 0):变了才重数有人邻块 */
  const lived = new Uint8Array(R);
  let counted = false;
  let filled = false;
  const prepare = (t: Year): void => {
    if (t % POP_EVERY) return;
    if (!filled) {
      // 各块分到一州上限的几成(按宜居分)、地经不经得住种(按地块的群落;挨着、流着大河的有淤泥补):地形不变,填一次
      const share = eng.input('份');
      const fr = eng.input('脆');
      const { mesh, biome, flux, riverThreshold, water } = dev.world;
      const cap = dev.habitat.capacity;
      const major = MAJOR_RIVER * riverThreshold;
      for (let k = 0; k < T.count; k++) {
        const i = T.cell[k];
        const total = reg.capacity[of[k]];
        share[k] = total > 0 ? cap[i] / total : 0;
        let river = water[i] === 0 && flux[i] >= major;
        for (let q = mesh.adjStart[i]; !river && q < mesh.adjStart[i + 1]; q++) {
          const j = mesh.adj[q];
          if (water[j] === 0 && flux[j] >= major) river = true;
        }
        fr[k] = (FRAGILE[biome[i]] ?? FRAGILE_ELSE) * (river ? RIVER_SILT : 1);
      }
      filled = true;
    }
    const cap = eng.input('乡容');
    ruralTargets(dev, t, cap, eng.input('乡速'));
    // 逃兵灾分给有人住过的邻块
    let changed = !counted;
    for (let r = 0; r < R; r++) {
      const on = cap[r] > 0 ? 1 : 0;
      if (lived[r] !== on) (lived[r] = on), (changed = true);
    }
    if (changed) {
      const nbs = eng.input('有人邻块');
      for (let k = 0; k < T.count; k++) {
        let n = 0;
        for (let q = T.adjStart[k]; q < T.adjStart[k + 1]; q++) n += lived[of[T.adj[q]]];
        nbs[k] = n;
      }
      counted = true;
    }
    const hit = eng.input('新祸').fill(0);
    const blight = eng.input('新荒').fill(0);
    // 全球大疫(pandemic.ts):上一步以来各州凋敝占了几成(没有全球大疫的世界全是 0)
    const slump = eng.input('凋敝').fill(0);
    const pan = pandemicModelOf(sim);
    if (pan?.list.length) {
      for (let r = 0; r < R; r++) {
        const s = slumpIn(pan, r, t - POP_EVERY, t);
        if (s) slump[r] = SLUMP_HOLD * Math.min(1, s.years / POP_EVERY);
      }
    }
    const S = pm.settlements;
    grow(S.length);
    // 折损一州:州里各块一样折
    const cut = (r: number, f: number) => {
      for (let k = cellStart[r]; k < cellStart[r + 1]; k++) {
        const i = cells[k];
        eng.write('乡民', i, 0, eng.value('乡民', i) * (1 - f));
      }
    };
    for (let i = 0; i < S.length; i++) {
      const s = S[i];
      const r = s.region;
      const sk = s.sacks;
      if (sk && seen[i] < sk.length) {
        for (; seen[i] < sk.length && sk[seen[i]].year < t; seen[i]++) {
          const k = sk[seen[i]];
          if (r >= R) continue;
          cut(r, ruralShare(k.cause) * k.loss);
          // 瘟疫、疫后凋敝、地震水旱不算兵灾(不逃);饥荒、大水、大旱伤地力
          if (k.cause !== 'plague' && k.cause !== 'quake' && k.cause !== 'slump') hit[r]++;
          if (k.cause === 'famine' || (k.cause === 'quake' && quakeWord(reg, k.from ?? r) !== '地震')) blight[r]++;
        }
      }
      if (!ended[i] && s.ended !== undefined && s.ended < t) {
        ended[i] = 1;
        if (r >= R) continue;
        cut(r, RURAL_WAR);
        hit[r]++;
      }
    }
    for (; annal < sim.annalCount; annal++) {
      const a = sim.annal(annal);
      if (!(a.year < t)) break;
      if ((a.kind === 'battle' || a.kind === 'conquer') && a.region >= 0 && a.region < R) hit[a.region]++;
    }
  };

  const done = (t: Year): void => {
    if (t % POP_EVERY) return;
    last = t;
    if (t % RURAL_SNAP) return;
    const ys = dev.ruralYears;
    // 同一年的、更晚的先去掉(接着推时最后一份可能和这一份同年)
    while (ys.length && ys[ys.length - 1] >= t) {
      ys.pop();
      dev.rural.pop();
    }
    ys.push(t);
    dev.rural.push(Float32Array.from(eng.get('乡口')));
  };
  return { prepare, done };
}
