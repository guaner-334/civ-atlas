/**
 * 湿地:哪些地块是沼泽、湿地。不是"雨多"的一种颜色 —— 湿地长在水排不走的地方:
 *   先要低平:往下游最陡的坡很缓、和四邻的高差小(冻土上水渗不下去,坡稍陡一点也积水;很高的高原上渐渐没有);
 *   再要有水来,三种来路有一种就行:
 *     - 本地的水蒸发不完:年降水 ÷ 蒸散能力高(寒带的泥炭地、湿润的平原;湿热的平地大多还是雨林,这一项打折)
 *     - 上游来的大河在宽谷底上漫开,两岸的平地也漫到(当地再干也有:大河穿过草原、荒漠的那种湿地)
 *     - 湖边的平地
 * 世界里没有逐月降水和地下水位,这里按年均的量估一个"湿地适宜度"(0–1),到 WETLAND_CUT 就算湿地。
 * 地块一层(gen/world.ts,推演用)按它把群落改成湿地;铺像素(gen/raster.ts)把它插值到像素、加一点细节噪声再比门槛,
 * 两层用的是同一份适宜度。纯计算,不碰 DOM,不用随机数:同样的世界算出来总是一样。
 */
import type { Mesh } from './mesh';
import { geometryOf, sphereSpacing } from './geometry';
import { smoothstep } from './util';
import { LAND_ICE_BELOW } from './biomes';

/** 一个世界单位多少公里(赤道一圈 2048 个单位) */
const KM = 40075 / 2048;
/**
 * 门槛按这个精细度(默认的地块数)调好。更细的网格上:坡和高差先在柔化过的海拔上量(细网格的地面起伏更碎,
 * 不柔化的话同一片平原量出来陡一倍),和邻居平均、大河漫到两岸都按地面距离多走几圈 —— 同一颗星球换精细度,湿地的多少、位置差不多
 */
const REF_CELLS = 36000;

/** 适宜度到这么多就是湿地 */
export const WETLAND_CUT = 0.5;

/** 往下游最陡的坡(米 / 公里):缓过 SLOPE0 算平,陡过 SLOPE1 不积水 */
const SLOPE0 = 0.25;
const SLOPE1 = 1.1;
/** 冻土(年均温 0 °C 以下)上坡和高差的门槛放宽几倍 */
const FROST = 1.8;
/** 和四邻的平均高差(米):本地积水、湖边按 RELIEF0–RELIEF1;大河漫滩(宽谷底)按 VALLEY0–VALLEY1 */
const RELIEF0 = 30;
const RELIEF1 = 140;
const VALLEY0 = 60;
const VALLEY1 = 260;
/** 年降水 ÷ 蒸散能力:从 MOIST0 起本地开始积水,到 MOIST1 满 */
const MOIST0 = 1.4;
const MOIST1 = 3;
/** 年均温到 HOT_T 度以上,本地积水那一项乘 HOT_K(湿热的平地大多是雨林,湿地主要沿大河) */
const HOT_T = 20;
const HOT_K = 0.4;
/** 流量 ÷ 成河门槛:从 FLOW0 起漫滩,到 FLOW1 满;漫到两岸邻块打 SPREAD 折 */
const FLOW0 = 2;
const FLOW1 = 12;
const SPREAD = 0.65;
/** 湖边的平地 */
const LAKE = 0.75;
/** 海拔(米):从 HIGH0 起渐渐没有,到 HIGH1 没有 */
const HIGH0 = 1800;
const HIGH1 = 3200;
/** 本地积水、湖边那两项和陆地邻居平均一遍时自己占几成(连成片,孤零零的一块淡下去) */
const SELF = 0.55;

export interface WetlandInput {
  mesh: Mesh;
  elevation: Float32Array;
  /** 0 陆地 / 1 海洋 / 2 湖泊 */
  water: Uint8Array;
  temperature: Float32Array;
  precipitation: Float32Array;
  flux: Float32Array;
  riverThreshold: number;
}

/** 每个地块的湿地适宜度 0–1(水面、冰原为 0) */
export function wetlandSuitability(w: WetlandInput): Float32Array {
  const { mesh, elevation, water, temperature: T, precipitation: P, flux, riverThreshold } = w;
  const { n, adjStart, adj } = mesh;
  const elen = geometryOf(mesh).edgeLengths();
  /** 一个默认精细度的地块面积是这张网格一个地块的几倍(默认精细度 = 1) */
  const k2 = (sphereSpacing(mesh.width, REF_CELLS) / mesh.spacing) ** 2;
  const E = k2 > 1 ? landAverage(mesh, elevation, water, k2 - 1, 0) : elevation;
  // 本地积水 / 湖边(连成片的那种)和大河漫滩分开算:前者和邻居平均,后者沿河一条线,不平均(平均了就没了)
  const pond = new Float32Array(n);
  const river = new Float32Array(n);
  const wide = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    if (water[i] !== 0 || T[i] < LAND_ICE_BELOW) continue;
    const e = E[i];
    let drop = 0;
    let mad = 0;
    let lake = 0;
    for (let k = adjStart[i]; k < adjStart[i + 1]; k++) {
      const j = adj[k];
      const ej = water[j] === 1 ? 0 : E[j];
      const s = (e - ej) / (elen[k] * KM);
      if (s > drop) drop = s;
      mad += e > ej ? e - ej : ej - e;
      if (water[j] === 2) lake = 1;
    }
    mad /= Math.max(1, adjStart[i + 1] - adjStart[i]);
    const fr = T[i] < 0 ? FROST : 1;
    const low = (1 - smoothstep(SLOPE0 * fr, SLOPE1 * fr, drop)) * (1 - smoothstep(HIGH0, HIGH1, e));
    if (low <= 0) continue;
    const flat = low * (1 - smoothstep(RELIEF0 * fr, RELIEF1 * fr, mad));
    const pet = 250 + 22 * Math.max(0, T[i]);
    const moist = smoothstep(MOIST0, MOIST1, P[i] / pet) * (T[i] >= HOT_T ? HOT_K : 1);
    pond[i] = flat * Math.max(moist, lake * LAKE);
    wide[i] = low * (1 - smoothstep(VALLEY0, VALLEY1, mad));
    river[i] = wide[i] * smoothstep(FLOW0, FLOW1, flux[i] / riverThreshold);
  }
  // 本地积水、湖边的和陆地邻居平均(默认精细度下一遍,细网格多几遍)。大河的往两岸漫,漫到的打 SPREAD 折:
  // 默认精细度下一圈,细网格按地面距离多走几圈;粗网格一圈就比默认的宽,按宽出来的倍数再打折
  const sm = landAverage(mesh, pond, water, k2, SELF);
  let reach = river;
  for (let r = Math.max(1, Math.round(Math.sqrt(k2))); r > 0; r--) reach = landMax(mesh, reach, water);
  const spread = SPREAD * Math.min(1, Math.sqrt(k2));
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    if (water[i] !== 0 || T[i] < LAND_ICE_BELOW) continue;
    out[i] = Math.max(sm[i], river[i], spread * reach[i] * wide[i]);
  }
  return out;
}

/**
 * 陆地上和邻居平均 passes 遍(水面不动、也不参与)。一遍:self > 0 时 = self × 自己 + (1 − self) × 陆地邻居的平均,
 * self = 0 时 = 自己和陆地邻居一起平均。passes 不是整数时最后一遍只走一部分(按比例混合):精细度连续变,结果也连续变
 */
function landAverage(mesh: Mesh, f: Float32Array, water: Uint8Array, passes: number, self: number): Float32Array {
  const { n, adjStart, adj } = mesh;
  let a = f;
  for (let p = 0; p < passes; p++) {
    const t = Math.min(1, passes - p);
    const b = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      if (water[i] !== 0) {
        b[i] = a[i];
        continue;
      }
      let s = 0;
      let c = 0;
      for (let k = adjStart[i]; k < adjStart[i + 1]; k++) {
        const j = adj[k];
        if (water[j] !== 0) continue;
        s += a[j];
        c++;
      }
      const v = c === 0 ? a[i] : self > 0 ? self * a[i] + (1 - self) * (s / c) : (a[i] + s) / (c + 1);
      b[i] = t === 1 ? v : a[i] + (v - a[i]) * t;
    }
    a = b;
  }
  return a;
}

/** 陆地上取自己和陆地邻居里最大的(往外漫一圈;水面为 0) */
function landMax(mesh: Mesh, f: Float32Array, water: Uint8Array): Float32Array {
  const { n, adjStart, adj } = mesh;
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    if (water[i] !== 0) continue;
    let m = f[i];
    for (let k = adjStart[i]; k < adjStart[i + 1]; k++) {
      const j = adj[k];
      if (water[j] === 0 && f[j] > m) m = f[j];
    }
    out[i] = m;
  }
  return out;
}
