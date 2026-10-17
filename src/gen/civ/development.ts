/**
 * 发展度(generateCiv 的第 ⑧ 步):推演结束后,照已有的历史算各州的物产、五种能力和时代 —— 只算不改历史,
 * 国界、兴亡、战争、人物一个都不变(以后让能力反过来影响推演时,再挪进推演里)。纯计算,不碰 DOM。
 *
 * **物产**(每州一份,不随年份变):粮、牲畜(含马)、铜锡、铁、煤、木材、盐、渔获、石油、稀有矿,各 0–3 档(没有 / 少 / 中 / 多)。
 *   从地形、群落、气候、板块算一个"有多少"的分,按全世界的排名分档:每样只有一部分州有(RESOURCE_SHARE),
 *   有的里面少、中、多大约各占一半、三成、两成。矿和煤另加一点按州的随机(同一片山里也有贫有富)。
 *
 * **五种能力**(每州每 STEP 年算一次):生产、运输、信息、行政、动员。数值和时代用同一把尺子(0 = 石器时代开头,
 *   1 = 青铜时代开头,……,见 ERAS),每样能力:
 *   - 自己长(创新):速度 = 动力 ÷ 这一档要的年数(ERA_YEARS)。动力看这一样能力靠什么:
 *       生产看粮和人口,运输看道路(已修、还没废的)、大河(只有最后的地形可查)、海港(按当时那一段地形)、木材,信息看大城、国都、和多少外邦相邻,行政看有没有国家、国家多大多老、是不是国都;
 *     打仗的地方长得慢(近几十年本州的战役、攻占、洗劫越多越慢)。
 *     某一样比这个州的时代领先近一档时,自己长得很慢;领先两档以上时,向邻居学也很慢(单靠一样堆不上去)。
 *   - 向邻居学(传播):向本样能力最高的那个邻州靠拢,差得越多学得越快。同一国里快、跨国慢,翻山、过海峡、走航线更慢;
 *     行政主要在一国之内传。
 *   - 战乱折损:本州的攻占、战役、洗劫、毁城当即扣一点;之后按到过的最高值较快地恢复(技术没丢,只是要重建)。
 *   - 物产卡脖子(只卡生产的创新):要进青铜时代得有铜锡,进铁器得有铁,进工业得有煤和铁,进电气得有石油,进信息得有稀有矿 ——
 *     本州、相邻的州或者本国有就行(买得到);都没有的,到门口附近自己就长得很慢(GATE_SLOW),主要靠邻居传过来。
 *   - 动员不单独长:跟着生产和行政走(游牧民族另高一截)。
 *   - 没人住的州不长;刚有人住的州带着邻居的本事来(取最高邻居的 SETTLE_CARRY)。
 *
 * **时代** = 生产、运输、信息、行政四样的"偏短板"平均(调和平均,见 eraLevel):整数部分是哪个时代,小数部分是走到这个时代的几成。
 *
 * **大事**:世界上第一次有州进入某个时代(first,记州、民族、国家、城);各国国都所在的州第一次进入某个时代(enter;立国时已在的时代不记)。
 *   年份按上一步到这一步线性估出跨过门槛的那一刻(不早于那州归了现在的民族、国家)。
 *
 * 结果是 Civ.development:物产、每 SNAP 年一份的各州能力(加结束那年)、大事。任意年份用 developmentAt 查(前后两份线性插值)。
 * 只用加减乘除(IEEE 精确舍入)和推演里已经舍入过的人口,跨 CPU 逐位一致。
 * 随机数一律 keyed(subSeed(seed, 'civ-development'), 治所地块, …)。
 */
import type { Civ, DevEvent, Development, Year } from './types';
import type { World } from '../world';
import { AdjKind, Layer } from './types';
import { Biome } from '../biomes';
import { MAJOR_RIVER } from './habitat';
import { capitalAt, populationAt, regionCityAt, regionPopulationAt } from './growth';
import { keyed, subSeed } from './rand';

/** 物产(下标就是 Development.resources 里的第几样) */
export const RESOURCES = ['粮', '牲畜', '铜锡', '铁', '煤', '木材', '盐', '渔获', '石油', '稀有矿'] as const;
export const enum Res {
  Grain = 0,
  Livestock = 1,
  Copper = 2,
  Iron = 3,
  Coal = 4,
  Timber = 5,
  Salt = 6,
  Fish = 7,
  Oil = 8,
  Rare = 9,
}
export const RESOURCE_COUNT = 10;
/** 每样物产有的州占全部有人能住的州的比例 */
const RESOURCE_SHARE: readonly number[] = [0.7, 0.5, 0.22, 0.4, 0.2, 0.55, 0.3, 0.45, 0.15, 0.12];

/** 五种能力(下标就是快照里每州的第几样) */
export const CAPS = ['生产', '运输', '信息', '行政', '动员'] as const;
export const enum Cap {
  Production = 0,
  Transport = 1,
  Information = 2,
  Administration = 3,
  Mobilization = 4,
}
export const CAP_COUNT = 5;

/** 时代(能力、时代数值的整数部分;最后一个没有上限) */
export const ERAS = ['石器', '青铜', '铁器', '中古', '火药', '工业', '电气', '信息', '未来'] as const;
/** 动力为 1 时,自己长过一个时代要几年(按所在的时代) */
const ERA_YEARS: readonly number[] = [1000, 800, 700, 750, 3000, 1600, 1300, 1500, 2000];
/** 能力的上限(未来时代以后不再往上记) */
const LEVEL_MAX = 9;
/** 快照里一档能力存成几(Uint8:LEVEL_MAX × LEVEL_SCALE ≤ 255) */
export const LEVEL_SCALE = 28;
/** 快照里算坏了(不是数)的能力存成这个 */
export const BAD_LEVEL = 255;

/** 每多少年算一步、多少年存一份快照 */
const STEP = 20;
const SNAP = 100;
/** 向邻居学:每年追上差距的比例(生产、运输、信息、行政) */
const LEARN: readonly number[] = [0.0015, 0.0012, 0.0025, 0.001];
/** 同一国里学得快几倍;行政跨国只剩几成 */
const SAME_STATE = 2;
const ADMIN_ABROAD = 0.3;
/** 邻接边的类型 → 学得多快(航线另加运输能力的几成) */
const LINK: readonly number[] = (() => {
  const t = [1, 1, 1, 1, 1];
  t[AdjKind.River] = 1.1;
  t[AdjKind.Mountain] = 0.35;
  t[AdjKind.Strait] = 0.6;
  t[AdjKind.SeaRoute] = 0.25;
  return t;
})();
const SEA_PER_TRANSPORT = 0.08;
/** 循环里要用的枚举值(另一个文件的 const enum,先取成本地常量) */
const SEA_ROUTE: number = AdjKind.SeaRoute;
const CULTURE_LAYER: number = Layer.Culture;
/** 某样能力比时代领先 OVERSHOOT 以上时,自己长得只剩 OVERSHOOT_SLOW;领先 OVERSHOOT_LEARN 以上时,向邻居学也只剩这么多 */
const OVERSHOOT = 0.8;
const OVERSHOOT_LEARN = 2;
const OVERSHOOT_SLOW = 0.25;
/** 卡在物产门口:离下一时代还差这么多以内、又没有要的物产时,生产自己长得只剩 GATE_SLOW */
const GATE_NEAR = 0.3;
const GATE_SLOW = 0.15;
/** 跌下去以后每年按"到过的最高值 − 现在"的这个比例恢复 */
const RECOVER = 0.02;
/** 战乱:每步旧账留几成;每次扣多少(生产、运输、信息、行政) */
const WAR_KEEP = 0.8;
const HIT_CONQUER: readonly number[] = [0.08, 0.05, 0, 0.1];
const HIT_BATTLE: readonly number[] = [0.04, 0.02, 0, 0];
const HIT_SACK: readonly number[] = [0.12, 0.05, 0.08, 0.04];
const HIT_RUIN: readonly number[] = [0.2, 0.1, 0.15, 0.08];
/** 刚有人住的州:取邻居最高值的几成 */
const SETTLE_CARRY = 0.85;
/** 没人住了:每步剩几成 */
const ABANDON_KEEP = 0.98;
/** 国家有这么多州时,行政动力里「国家大」那一项到顶 */
const ADMIN_SIZE = 40;
/** 州的人口、城的人口到这么多(千人)时算一半(人口、城的规模 = 人口 ÷ (人口 + 这个数)) */
const POP_HALF = 300;
const CITY_HALF = 40;
/** 没有国家的地方行政最多长到几 */
const TRIBAL_ADMIN_MAX = 1.5;

/** 时代 = 生产、运输、信息、行政的调和平均(各加 1 再减 1,0 也能算;偏向短板) */
const ERA_WEIGHT: readonly number[] = [0.35, 0.2, 0.25, 0.2];

/** 州 r 的时代数值(整数部分 = 第几个时代,小数 = 走了几成);lv = R × CAP_COUNT 的能力 */
export function eraLevel(lv: ArrayLike<number>, r: number): number {
  const o = r * CAP_COUNT;
  let s = 0;
  for (let c = 0; c < 4; c++) s += ERA_WEIGHT[c] / (lv[o + c] + 1);
  return 1 / s - 1;
}

/** 时代数值 → 第几个时代和走了几成(0–1) */
export function eraOf(level: number): { era: number; progress: number } {
  const era = Math.max(0, Math.min(ERAS.length - 1, Math.floor(level)));
  return { era, progress: Math.max(0, Math.min(1, level - era)) };
}

/** 任意年份各州的五种能力(R × CAP_COUNT;前后两份快照线性插值)。out 可复用 */
export function developmentAt(dev: Development, year: Year, out?: Float32Array): Float32Array {
  const ys = dev.snapYears;
  const len = dev.snaps[0]?.length ?? 0;
  if (!out || out.length !== len) out = new Float32Array(len);
  if (!ys.length) return out;
  let lo = 0;
  let hi = ys.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (ys[mid] <= year) lo = mid + 1;
    else hi = mid;
  }
  const a = dev.snaps[Math.max(0, lo - 1)];
  const b = dev.snaps[Math.min(ys.length - 1, lo)];
  const t = lo <= 0 || lo >= ys.length ? 0 : (year - ys[lo - 1]) / (ys[lo] - ys[lo - 1]);
  for (let i = 0; i < len; i++) out[i] = (a[i] + (b[i] - a[i]) * t) / LEVEL_SCALE;
  return out;
}

/** 推演结束后算发展度(见文件头) */
export function buildDevelopment(world: World, civ: Civ): Development {
  const seed = subSeed(civ.seed, 'civ-development');
  const R = civ.regions.count;
  const eras = civ.eras ?? [];
  let era = 0;
  let reg = eras.length ? eras[0].regions : civ.regions;
  const resources = computeResources(world, civ, seed);
  const S = civ.settlements;
  const P = civ.polities.length;

  // 地形大事以前的每一段各有一份州、海港、路网;最后一段用 civ 本身的
  const segs = [...eras.map((e) => ({ regions: e.regions, habitat: e.habitat, routes: e.routes })), { regions: civ.regions, habitat: civ.habitat, routes: civ.routes }];
  // 每条路经过哪些州(道路、小路、航线经过的陆地);有路 = 那一段里有一条已修、还没废的路经过
  const routeRegions = segs.map((g) =>
    g.routes.map((rt) => {
      const on = new Set<number>();
      for (const cell of rt.cells) {
        const r = g.regions.of[cell];
        if (r >= 0 && r < R) on.add(r);
      }
      return Int32Array.from(on);
    }),
  );
  // 各段各州有没有海港;大河只有最后的地形可查,各段都用它
  const ports = segs.map((g) => {
    const port = new Uint8Array(R);
    const { cellStart, cells } = g.regions;
    for (let r = 0; r < Math.min(R, g.regions.count); r++) {
      for (let k = cellStart[r]; k < cellStart[r + 1]; k++) if (g.habitat.harbor[cells[k]] > 0) port[r] = 1;
    }
    return port;
  });
  const river = new Uint8Array(R);
  {
    const { cellStart, cells } = civ.regions;
    const major = MAJOR_RIVER * world.riverThreshold;
    for (let r = 0; r < R; r++) {
      for (let k = cellStart[r]; k < cellStart[r + 1]; k++) if (world.flux[cells[k]] >= major) river[r] = 1;
    }
  }
  const road = new Uint8Array(R);
  // 战乱:史事按步分桶(攻占、战役、洗劫、毁城)
  const years: Year[] = [];
  for (let y = 0; y <= civ.endYear; y += STEP) years.push(y);
  if (years[years.length - 1] < civ.endYear) years.push(civ.endYear);
  const hits: { region: number; hit: readonly number[] }[][] = years.map(() => []);
  for (const a of civ.annals) {
    const hit = a.kind === 'conquer' ? HIT_CONQUER : a.kind === 'battle' ? HIT_BATTLE : a.kind === 'sack' ? HIT_SACK : a.kind === 'ruin' ? HIT_RUIN : null;
    if (!hit || !(a.region >= 0 && a.region < R)) continue;
    // 落在 (上一步, 这一步] 里
    const k = Math.min(years.length - 1, Math.max(0, Math.ceil(a.year / STEP)));
    hits[k].push({ region: a.region, hit });
  }

  const cur = new Float64Array(R * CAP_COUNT);
  const next = new Float64Array(R * CAP_COUNT);
  const best = new Float64Array(R * CAP_COUNT);
  const war = new Float64Array(R);
  const settled = new Uint8Array(R);
  /** 住过人、后来空了的州(再有人住时按刚有人住算) */
  const left = new Uint8Array(R);
  const E = new Float64Array(R);
  const Eprev = new Float64Array(R);
  /** 各州归了现在的民族、国家是哪一刻 */
  const sinceC = new Float64Array(R);
  const sinceP = new Float64Array(R);
  // 归属:按年份往后翻日志(和 ownersAt 同一个结果)
  const ownC = new Int16Array(R).fill(-1);
  const ownP = new Int16Array(R).fill(-1);
  const L = civ.log;
  let li = 0;
  /** 各国这一步:州数、国都所在的州、有哪些物产(按位) */
  const size = new Int32Array(P);
  const capR = new Int32Array(P);
  const has = new Int32Array(P);
  /** 各国到过的时代(−1 = 还没看过;立国时已在的不记大事) */
  const polityEra = new Int8Array(P).fill(-1);
  let worldEra = 0;
  const events: DevEvent[] = [];
  const snaps: Uint8Array[] = [];
  const snapYears: Year[] = [];
  const resBits = new Int32Array(R);
  for (let r = 0; r < R; r++) for (let k = 0; k < RESOURCE_COUNT; k++) if (resources[r * RESOURCE_COUNT + k] > 0) resBits[r] |= 1 << k;
  /** 各州人口、城的规模(0–1,每 SNAP 年更新) */
  const popOf = new Float64Array(R);
  const cityOf = new Float64Array(R);
  const drive = new Float64Array(4);
  const learn = new Float64Array(4);
  const needBits = (lvP: number): number => {
    const target = Math.floor(lvP) + 1;
    return target === 1 ? 1 << Res.Copper : target === 2 ? 1 << Res.Iron : target === 5 ? (1 << Res.Coal) | (1 << Res.Iron) : target === 6 ? 1 << Res.Oil : target === 7 ? 1 << Res.Rare : 0;
  };

  for (let step = 0; step < years.length; step++) {
    const y = years[step];
    const dt = step ? y - years[step - 1] : 0;
    while (era < eras.length && y >= eras[era].until) reg = ++era < eras.length ? eras[era].regions : civ.regions;
    for (; li < L.size && L.year[li] <= y; li++) {
      if (L.layer[li] === CULTURE_LAYER) {
        ownC[L.region[li]] = L.value[li];
        sinceC[L.region[li]] = L.year[li];
      } else {
        ownP[L.region[li]] = L.value[li];
        sinceP[L.region[li]] = L.year[li];
      }
    }
    size.fill(0);
    has.fill(0);
    capR.fill(-1);
    for (let r = 0; r < R; r++) {
      const p = ownP[r];
      if (p < 0) continue;
      size[p]++;
      has[p] |= resBits[r];
    }
    for (let p = 0; p < P; p++) {
      if (!size[p]) continue;
      const cap = S[capitalAt(civ.polities[p], y)];
      if (cap && cap.region < R && ownP[cap.region] === p) capR[p] = cap.region;
    }
    const { adjStart, adj, adjKind } = reg;
    const port = ports[era];
    road.fill(0);
    {
      const rts = segs[era].routes;
      for (let i = 0; i < rts.length; i++) {
        const rt = rts[i];
        if (rt.built > y || (rt.abandoned !== undefined && rt.abandoned <= y)) continue;
        for (const r of routeRegions[era][i]) road[r] = 1;
      }
    }
    const Rn = reg.count;
    // 人口、城每 SNAP 年看一次(变得慢,逐步现算太费时)
    if (y % SNAP === 0) {
      for (let r = 0; r < Rn; r++) {
        if (ownC[r] < 0) continue;
        const pop = regionPopulationAt(civ, r, y);
        const city = regionCityAt(civ, r, y);
        const cityPop = city ? populationAt(city, y) : 0;
        popOf[r] = pop / (pop + POP_HALF);
        cityOf[r] = cityPop / (cityPop + CITY_HALF);
      }
    }
    next.set(cur);
    if (dt > 0) {
      for (let r = 0; r < Rn; r++) {
        const o = r * CAP_COUNT;
        if (ownC[r] < 0) {
          if (settled[r]) {
            left[r] = 1;
            for (let c = 0; c < CAP_COUNT; c++) next[o + c] = cur[o + c] * ABANDON_KEEP;
          }
          continue;
        }
        const p = ownP[r];
        if (!settled[r] || left[r]) {
          // 刚有人住(或空了以后又有人来):带着邻居的本事来,和本州留下的取高的
          settled[r] = 1;
          left[r] = 0;
          for (let k = adjStart[r]; k < adjStart[r + 1]; k++) {
            const n = adj[k];
            if (n >= R || ownC[n] < 0) continue;
            for (let c = 0; c < CAP_COUNT; c++) next[o + c] = Math.max(next[o + c], cur[n * CAP_COUNT + c] * SETTLE_CARRY);
          }
          continue;
        }
        const popF = popOf[r];
        const cityF = cityOf[r];
        const ro = r * RESOURCE_COUNT;
        const isCap = p >= 0 && capR[p] === r;
        // 和几个外邦(别国、部落地带)相邻;本国 / 本州附近能不能买到物产
        let foreign = 0;
        let near = resBits[r] | (p >= 0 ? has[p] : 0);
        for (let k = adjStart[r]; k < adjStart[r + 1]; k++) {
          const n = adj[k];
          if (n >= R || ownC[n] < 0) continue;
          near |= resBits[n];
          if (ownP[n] !== p && foreign < 4) foreign++;
        }
        const peace = 1 / (1 + war[r]);
        drive[0] = 0.15 + 0.1 * resources[ro + Res.Grain] + 1.2 * popF;
        drive[1] = 0.1 + 0.3 * road[r] + 0.2 * river[r] + 0.3 * port[r] + 0.05 * resources[ro + Res.Timber] + 0.6 * popF;
        drive[2] = 0.1 + 1.2 * cityF + (isCap ? 0.3 : 0) + 0.08 * foreign + 0.2 * road[r];
        drive[3] = p < 0 ? 0.15 : 0.3 + 0.15 * tierAt(civ.polities[p].titles, y) + 0.2 * Math.min(1, size[p] / ADMIN_SIZE) + (isCap ? 0.4 : 0) + 0.3 * Math.min(1, (y - civ.polities[p].founded) / 400);
        // 向每样能力最高的邻居学(一遍邻居,四样一起看)
        learn.fill(0);
        for (let k = adjStart[r]; k < adjStart[r + 1]; k++) {
          const n = adj[k];
          if (n >= R || ownC[n] < 0) continue;
          const kind = adjKind[k];
          let link = LINK[kind] ?? 1;
          if (kind === SEA_ROUTE) link += SEA_PER_TRANSPORT * cur[o + Cap.Transport];
          const same = p >= 0 && ownP[n] === p;
          if (same) link *= SAME_STATE;
          const no = n * CAP_COUNT;
          for (let c = 0; c < 4; c++) {
            const gap = cur[no + c] - cur[o + c];
            if (gap <= 0) continue;
            const g = gap * LEARN[c] * (c === Cap.Administration && !same ? link * ADMIN_ABROAD : link);
            if (g > learn[c]) learn[c] = g;
          }
        }
        const e = E[r];
        for (let c = 0; c < 4; c++) {
          const v = cur[o + c];
          const lvl = Math.min(ERA_YEARS.length - 1, Math.floor(v));
          let grow = (drive[c] * peace) / ERA_YEARS[lvl];
          let got = learn[c];
          if (v > e + OVERSHOOT) grow *= OVERSHOOT_SLOW;
          if (v > e + OVERSHOOT_LEARN) got *= OVERSHOOT_SLOW;
          if (c === Cap.Production) {
            const need = needBits(v);
            if (need && (near & need) !== need && v > Math.floor(v) + 1 - GATE_NEAR) grow *= GATE_SLOW;
          }
          const recover = (best[o + c] - v) * RECOVER;
          let nv = v + dt * (grow + got + (recover > 0 ? recover : 0));
          if (c === Cap.Administration && p < 0 && nv > TRIBAL_ADMIN_MAX) nv = Math.max(v, TRIBAL_ADMIN_MAX);
          next[o + c] = Math.min(LEVEL_MAX, nv);
        }
        // 动员:跟着生产和行政走
        const nomad = civ.cultures[ownC[r]]?.kind === 'nomad';
        const target = 0.5 * (next[o + Cap.Production] + next[o + Cap.Administration]) + (nomad ? 0.7 : 0) + (p >= 0 ? 0.15 : 0);
        const m = cur[o + Cap.Mobilization];
        next[o + Cap.Mobilization] = Math.min(LEVEL_MAX, m + (target - m) * Math.min(1, 0.01 * dt));
      }
    }
    // 战乱折损
    for (let r = 0; r < R; r++) war[r] *= WAR_KEEP;
    for (const h of hits[step]) {
      const o = h.region * CAP_COUNT;
      war[h.region] += 1;
      for (let c = 0; c < 4; c++) next[o + c] = Math.max(0, next[o + c] - h.hit[c]);
    }
    cur.set(next);
    for (let i = 0; i < cur.length; i++) if (cur[i] > best[i]) best[i] = cur[i];
    Eprev.set(E);
    for (let r = 0; r < R; r++) E[r] = ownC[r] >= 0 ? eraLevel(cur, r) : 0;
    /** 州 r 的时代数值在这一步里哪一刻过了 k(按上一步到这一步线性估;不早于这州归了现在的民族 / 国家那一刻) */
    const crossed = (r: number, k: number, since: number): Year => {
      const a = Eprev[r];
      const b = E[r];
      const t = b > a ? Math.min(1, Math.max(0, (k - a) / (b - a))) : 1;
      return Math.min(y, Math.max(since, y - dt + dt * t));
    };

    // 大事:世界第一次进入某个时代;各国国都所在的州第一次进入某个时代
    let top = -1;
    let topLv = 0;
    for (let r = 0; r < R; r++) if (ownC[r] >= 0 && E[r] > topLv) (topLv = E[r]), (top = r);
    const topEra = eraOf(topLv).era;
    if (top >= 0 && topEra > worldEra) {
      for (let k = worldEra + 1; k <= topEra; k++) {
        const city = regionCityAt(civ, top, y);
        events.push({ year: crossed(top, k, Math.max(sinceC[top], sinceP[top])), kind: 'first', era: k, region: top, culture: ownC[top], polity: ownP[top], settlement: city ? city.id : -1 });
      }
      worldEra = topEra;
    }
    for (let p = 0; p < P; p++) {
      const r = capR[p];
      if (r < 0) continue;
      const e = eraOf(E[r]).era;
      if (polityEra[p] < 0) polityEra[p] = e;
      else if (e > polityEra[p]) {
        // 一步跨了几个时代(例如迁都到先进得多的州)就每个都记
        const city = regionCityAt(civ, r, y);
        for (let k = polityEra[p] + 1; k <= e; k++) {
          events.push({ year: crossed(r, k, Math.max(sinceC[r], sinceP[r])), kind: 'enter', era: k, region: r, culture: ownC[r], polity: p, settlement: city ? city.id : -1 });
        }
        polityEra[p] = e;
      }
    }

    if (y % SNAP === 0 || step === years.length - 1) {
      const snap = new Uint8Array(R * CAP_COUNT);
      // 算坏了(NaN)存成 BAD_LEVEL,压力测试查得出来;正常最多 LEVEL_MAX × LEVEL_SCALE
      for (let i = 0; i < snap.length; i++) snap[i] = cur[i] >= 0 ? Math.min(LEVEL_MAX * LEVEL_SCALE, Math.round(cur[i] * LEVEL_SCALE)) : BAD_LEVEL;
      snaps.push(snap);
      snapYears.push(y);
    }
  }
  // 同一步里的几件按估出来的那一刻排(排序是稳定的)
  events.sort((a, b) => a.year - b.year);
  return { resources, snaps, snapYears, events };
}

/** 某年的国号档位(0 部 … 3 帝国;没升过格 = 0) */
function tierAt(titles: { year: Year; tier: number }[] | undefined, y: Year): number {
  let t = 0;
  if (titles) for (const x of titles) if (x.year <= y) t = Math.max(0, x.tier);
  return t;
}

/**
 * 各州的物产(R × RESOURCE_COUNT,0–3 档):先按地块算"有多少"的分、州里取平均,再按全世界排名分档(见文件头)。
 * 按最后一段的地形和州算(地形大事以前也用它)
 */
export function computeResources(world: World, civ: Pick<Civ, 'regions' | 'habitat'>, seed: number): Uint8Array {
  const { regions, habitat } = civ;
  const R = regions.count;
  const { cellStart, cells } = regions;
  const { biome, elevation, temperature, precipitation, flux, riverThreshold, tect, water } = world;
  const { adjStart: mStart, adj: mAdj } = world.mesh;
  const score = Array.from({ length: RESOURCE_COUNT }, () => new Float64Array(R));
  const livable = new Uint8Array(R);
  const major = MAJOR_RIVER * riverThreshold;
  for (let r = 0; r < R; r++) {
    const a = cellStart[r];
    const b = cellStart[r + 1];
    if (b <= a) continue;
    let grain = 0;
    let stock = 0;
    let ore = 0;
    let hills = 0;
    let bog = 0;
    let basin = 0;
    let wood = 0;
    let salt = 0;
    let fish = 0;
    let oil = 0;
    let rare = 0;
    let suit = 0;
    for (let k = a; k < b; k++) {
      const i = cells[k];
      const bi = biome[i];
      const s = habitat.suitability[i];
      suit += s;
      const h = elevation[i];
      // 粮:能种地的群落上的宜居分(草原、荒漠不靠河种不了多少)
      grain += s * FARM[bi];
      stock += GRAZE[bi];
      // 铜锡:板块碰撞带、高山
      const conv = tect.convergence[i];
      ore += (conv > 0 ? Math.min(1, conv) : 0) + (h > 1500 ? 0.6 : h > 800 ? 0.3 : 0);
      // 铁:丘陵山地常见,沼泽、针叶林里的沼铁也算
      hills += h > 400 ? Math.min(1, (h - 400) / 1200) : 0;
      bog += bi === Biome.Wetland || bi === Biome.Taiga ? 0.5 : 0;
      // 煤:古老的低地盆地(森林、温带,海拔不高)
      basin += h < 1000 && (bi === Biome.TemperateForest || bi === Biome.Taiga || bi === Biome.TemperateRainforest || bi === Biome.Wetland || bi === Biome.Steppe) ? 1 : 0;
      wood += WOOD[bi];
      // 盐:暖而干的海岸(晒盐)、荒漠盆地(盐湖)
      const coast = habitat.coastDist[i] === 1;
      if (coast && temperature[i] > 14 && precipitation[i] < 1000) salt += 1;
      if (bi === Biome.HotDesert || bi === Biome.TemperateDesert || bi === Biome.ColdDesert) salt += h < 1500 ? 0.6 : 0.2;
      // 石油:低地的沉积盆地(荒漠、沼泽、草原、海边)
      if (h < 600) oil += OIL[bi] + (coast ? 0.4 : 0);
      // 稀有矿:板块剧烈碰撞带(火山弧)、张裂带
      rare += conv > 0.3 ? Math.min(1, conv) : conv < -0.3 ? 0.7 * Math.min(1, -conv) : 0;
      // 渔获:海岸(冷水更多)、湖岸、大河
      if (coast) fish += temperature[i] < 12 ? 1.4 : 1;
      if (flux[i] >= major) fish += 0.5;
      for (let j = mStart[i]; j < mStart[i + 1]; j++) {
        if (water[mAdj[j]] === 2) {
          fish += 0.6;
          break;
        }
      }
    }
    const m = b - a;
    if (suit > 0) livable[r] = 1;
    const at = regions.seat[r];
    const key = regions.keySeat?.[r] ?? at;
    // 矿和煤:同一片山里也有贫有富
    const luck = (k: number) => 0.4 + 1.2 * keyed(seed, key, k);
    score[Res.Grain][r] = grain / m;
    score[Res.Livestock][r] = stock / m;
    score[Res.Copper][r] = (ore / m) * luck(Res.Copper);
    score[Res.Iron][r] = (hills / m + bog / m + 0.15) * luck(Res.Iron);
    score[Res.Coal][r] = (basin / m) * luck(Res.Coal) * (0.3 + keyed(seed, key, 100));
    score[Res.Timber][r] = wood / m;
    score[Res.Salt][r] = (salt / m) * luck(Res.Salt);
    score[Res.Fish][r] = fish / m;
    // 油田、稀有矿比煤还更成片:一大半地方即使地形对也没有
    score[Res.Oil][r] = (oil / m) * luck(Res.Oil) * (0.15 + keyed(seed, key, 101));
    score[Res.Rare][r] = (rare / m) * luck(Res.Rare) * (0.15 + keyed(seed, key, 102));
  }
  const out = new Uint8Array(R * RESOURCE_COUNT);
  const ids: number[] = [];
  for (let r = 0; r < R; r++) if (livable[r]) ids.push(r);
  for (let k = 0; k < RESOURCE_COUNT; k++) {
    const sc = score[k];
    const order = ids.filter((r) => sc[r] > 0).sort((x, y) => sc[y] - sc[x] || x - y);
    const n = Math.min(order.length, Math.round(ids.length * RESOURCE_SHARE[k]));
    for (let i = 0; i < n; i++) out[order[i] * RESOURCE_COUNT + k] = i < n * 0.2 ? 3 : i < n * 0.5 ? 2 : 1;
  }
  return out;
}

/** 群落 → 能种多少粮(乘在宜居分上)、能放多少牧、有多少木材 */
const FARM: readonly number[] = biomeTable({ TemperateForest: 1, TropicalDryForest: 1, TemperateRainforest: 0.7, Savanna: 0.6, Steppe: 0.5, Rainforest: 0.5, Wetland: 0.5, Taiga: 0.3, TemperateDesert: 0.3, HotDesert: 0.3, ColdDesert: 0.2 });
const GRAZE: readonly number[] = biomeTable({ Steppe: 1, Savanna: 0.8, ColdDesert: 0.5, TemperateDesert: 0.4, Tundra: 0.3, TemperateForest: 0.2, TropicalDryForest: 0.2, HotDesert: 0.1 });
const OIL: readonly number[] = biomeTable({ HotDesert: 1, TemperateDesert: 0.9, ColdDesert: 0.6, Wetland: 0.8, Steppe: 0.5, Tundra: 0.4, Savanna: 0.3, Taiga: 0.2 });
const WOOD: readonly number[] = biomeTable({ Taiga: 1, TemperateForest: 1, TemperateRainforest: 1, Rainforest: 0.8, TropicalDryForest: 0.7, Wetland: 0.3, Savanna: 0.2 });

function biomeTable(v: Partial<Record<keyof typeof Biome, number>>): number[] {
  const t = new Array<number>(16).fill(0);
  for (const [k, x] of Object.entries(v)) t[Biome[k as keyof typeof Biome]] = x!;
  return t;
}
