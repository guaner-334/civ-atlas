/**
 * 经纬网的度数(GratLabels.tsx 摆字,这里只算):每条看得见的经线、纬线落在屏幕上哪儿、写什么、哪几条要写。
 *
 * 写在哪(照纸质地图的图廓注记):
 *   - 'out' 写在地图框外面(新建世界摊平改地形时框外有空边):上下两边写经度、左右两边写纬度,框边往外一小截刻度对着线
 *   - 'in'  写在地图里贴着边(主地图铺满屏幕、手机框左右没空):经度写在经线右边、贴着下边;纬度写在纬线上面、贴着左边
 *
 * 隔几条写一个(随缩放变):相邻两个字之间放得下才每条都写 —— 经度要隔开"字号 × 3 + 12"像素("120°W" 最宽),
 * 纬度要隔开"字号 + 6"像素;放不下就隔一条、两条写,只取整齐的倍数(LABEL_MULTS),0° 一定写。
 *
 * 投影:等距圆柱(mp = null,东西相连)、墨卡托(外轮廓是长方形)按经纬线横平竖直算;弯边投影(罗宾森、自然地球、摩尔魏德)见 layoutCurved。
 * 纯计算,不碰 DOM。
 */
import type { MapProj } from '../render/projection';
import { stageToWorld, worldToStage, windowSpan, type MapView, type StageBox } from './mapWrap';

/** 每隔几度的网格,字挤不下时隔几条写一条:只取这些倍数(10° 跳成每 20° / 30° / 60°,15° 跳成每 30° / 60° / 90°,30° 跳成每 60° / 90°) */
export const LABEL_MULTS: Record<number, number[]> = { 10: [1, 2, 3, 6], 15: [1, 2, 4, 6], 30: [1, 2, 3] };

export type Side = 'top' | 'bottom' | 'left' | 'right';

export interface GratText {
  text: string;
  /** 字的锚点(舞台坐标)和对齐:ax / ay = 字框的哪个比例对着锚点(0 左 / 上,0.5 中,1 右 / 下) */
  x: number;
  y: number;
  ax: number;
  ay: number;
  /** 0°(赤道、本初子午线):字重一点 */
  eq: boolean;
  /** 写在框外(深色空边上)还是地图里(要衬底) */
  out: boolean;
}

export interface GratTick {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface GratLayout {
  texts: GratText[];
  ticks: GratTick[];
  /** 经度、纬度各隔几度写一个(测试、截图对照用) */
  lonEvery: number;
  latEvery: number;
}

export interface GratSpec {
  /** 经度写在哪几边(top / bottom) */
  lon: { side: 'top' | 'bottom'; out: boolean }[];
  /** 纬度写在哪几边(left / right) */
  lat: { side: 'left' | 'right'; out: boolean }[];
  /** 字号(CSS 像素) */
  fs: number;
  /**
   * 写字的那一块(舞台坐标:左、上、右、下):框外的字贴着它的四边往外写;地图里的字贴着它的边往里写。
   * 和地图看得见的部分再取交集;不给 = 地图看得见的部分
   */
  area?: [number, number, number, number];
  /** 地图里的经度字最右写到哪(舞台 x;右下角的按钮让开) */
  lonInRight?: number;
  /** 框外的经度字左右不出这个范围(舞台 x;手机框两边只留十几像素,贴边的字往里挪一点,刻度不动) */
  outX?: [number, number];
}

/** 经度写成 "120°E" / "60°W" / "0°" / "180°"(和悬停信息、投影面板的写法一样) */
export function lonText(lon: number): string {
  const t = (lon + 180) / 360;
  const v = (t - Math.floor(t)) * 360 - 180;
  const a = Math.round(Math.abs(v));
  if (a === 0) return '0°';
  if (a === 180) return '180°';
  return `${a}°${v > 0 ? 'E' : 'W'}`;
}

/** 纬度写成 "30°N" / "60°S" / "0°" */
export function latText(lat: number): string {
  const a = Math.round(lat);
  return a === 0 ? '0°' : `${Math.abs(a)}°${a > 0 ? 'N' : 'S'}`;
}

/** 隔几度写一个:从小到大试整齐的倍数,相邻两个字的间距(gap(度) → 像素)够 need 就用它;都不够用最大的那个 */
export function labelEvery(step: number, gap: (deg: number) => number, need: number): number {
  const ms = LABEL_MULTS[step] ?? [1, 2, 3, 6];
  for (const n of ms) if (gap(step * n) >= need) return step * n;
  return step * ms[ms.length - 1];
}

const DEG = Math.PI / 180;

/**
 * 算出要写的字和刻度。W、H = 世界大小;v、b = 地图视图和舞台;mp = 墨卡托(null = 等距圆柱);step = 每隔几度。
 * 弯边投影交给 layoutCurved
 */
export function layoutGratLabels(W: number, H: number, v: MapView, b: StageBox, mp: MapProj | null, step: number, spec: GratSpec): GratLayout | null {
  if (!(step > 0) || !b.sw || !b.sh || !b.bw || !b.bh) return null;
  if (mp && mp.def.id !== 'mercator') return mp.def.id === 'equirect' ? null : layoutCurved(W, H, v, b, mp, step, spec);
  const at = (wx: number, wy: number) => worldToStage(wx, wy, v, b, W, H);
  // 地图看得见的那一块(舞台坐标)
  let l: number, r: number, t: number, bt: number;
  /** 经度 → 舞台 x(等距圆柱东西相连,可能有好几处;墨卡托最左、最右两条边是同一条经线) */
  let lonXs: (lon: number) => number[];
  /** 纬度 → 舞台 y(画不到的纬度 = NaN) */
  let latY: (lat: number) => number;
  /** 经度每 deg 度、纬度从 0° 起每 deg 度在屏幕上隔开多少像素(纬度取最挤的那一段:墨卡托在赤道上) */
  let lonPx: (deg: number) => number;
  let latPx: (deg: number) => number;
  if (!mp) {
    [l, r] = windowSpan(v.k, b);
    t = at(0, 0)[1];
    bt = at(0, H)[1];
    const P = v.k * b.bw;
    lonXs = (lon) => {
      const t0 = (lon + 180) / 360;
      const x0 = at((t0 - Math.floor(t0)) * W, 0)[0];
      const xs: number[] = [];
      // 挪到看得见的那一段:从左边再往左一圈起,一圈一圈往右
      let x = x0 - P * Math.ceil((x0 - l) / P + 1e-9);
      for (; x <= r + 0.5; x += P) if (x >= l - 0.5) xs.push(x);
      return xs;
    };
    latY = (lat) => at(0, ((90 - lat) / 180) * H)[1];
    lonPx = (deg) => (P * deg) / 360;
    latPx = (deg) => (v.k * b.bh * deg) / 180;
  } else {
    const { def, s } = mp;
    const latMax = def.latMax / DEG;
    [l, t] = at(W / 2 - s * mp.xMax, H / 2 - s * mp.yMax);
    [r, bt] = at(W / 2 + s * mp.xMax, H / 2 + s * mp.yMax);
    const sx = (v.k * b.bw) / W;
    const sy = (v.k * b.bh) / H;
    lonXs = (lon) => {
      const t0 = (lon - mp.lon0 + 180) / 360;
      const rel = (t0 - Math.floor(t0)) * 360 - 180;
      const xs = [at(W / 2 + s * def.kx(0) * rel * DEG, 0)[0]];
      if (rel <= -180 + 1e-9) xs.push(at(W / 2 + s * def.kx(0) * Math.PI, 0)[0]);
      return xs;
    };
    latY = (lat) => (Math.abs(lat) > latMax + 1e-9 ? NaN : at(0, H / 2 - s * def.y(lat * DEG))[1]);
    lonPx = (deg) => sx * s * def.kx(0) * deg * DEG;
    latPx = (deg) => sy * s * def.y(deg * DEG);
  }
  l = Math.max(l, 0);
  r = Math.min(r, b.sw);
  t = Math.max(t, 0);
  bt = Math.min(bt, b.sh);
  if (spec.area) {
    l = Math.max(l, spec.area[0]);
    t = Math.max(t, spec.area[1]);
    r = Math.min(r, spec.area[2]);
    bt = Math.min(bt, spec.area[3]);
  }
  if (r - l < 1 || bt - t < 1) return null;

  const fs = spec.fs;
  const lonEvery = labelEvery(step, lonPx, fs * 3 + 12);
  const latEvery = labelEvery(step, latPx, fs + 6);
  const texts: GratText[] = [];
  const ticks: GratTick[] = [];
  const GAP = 7;
  const TICK = 4;

  // 经度
  const lonIn = { top: false, bottom: false };
  for (const sd of spec.lon) if (!sd.out) lonIn[sd.side] = true;
  for (let lon = -180; lon < 180; lon += lonEvery) {
    for (const x of lonXs(lon)) {
      if (x < l - 0.5 || x > r + 0.5) continue;
      const text = lonText(lon);
      const eq = Math.round(lon) === 0;
      // 框外的字(居中对着线)左右不出 outX:按字宽估一下(每个字约 0.6 个字号宽)
      const half = text.length * 0.3 * fs + 2;
      const ox = spec.outX ? Math.max(spec.outX[0] + half, Math.min(spec.outX[1] - half, x)) : x;
      for (const sd of spec.lon) {
        if (sd.out) {
          if (sd.side === 'top') {
            ticks.push({ x: x - 0.5, y: t - TICK, w: 1, h: TICK });
            texts.push({ text, x: ox, y: t - GAP, ax: 0.5, ay: 1, eq, out: true });
          } else {
            ticks.push({ x: x - 0.5, y: bt, w: 1, h: TICK });
            texts.push({ text, x: ox, y: bt + GAP, ax: 0.5, ay: 0, eq, out: true });
          }
        } else {
          // 地图里:写在经线右边;太靠右(放不下一个字,或碰到右下角的按钮)不写
          if (x + 3 + fs * 3 > Math.min(r, spec.lonInRight ?? Infinity)) continue;
          if (sd.side === 'top') texts.push({ text, x: x + 3, y: t + 4, ax: 0, ay: 0, eq, out: false });
          else texts.push({ text, x: x + 3, y: bt - 4, ax: 0, ay: 1, eq, out: false });
        }
      }
    }
  }
  // 纬度(从北往南;从 0° 起算的整倍数,隔几条写一个时赤道照样写)
  for (let lat = latEvery * Math.floor(89.999 / latEvery); lat > -90; lat -= latEvery) {
    const y = latY(lat);
    if (!Number.isFinite(y) || y < t - 0.5 || y > bt + 0.5) continue;
    const text = latText(lat);
    const eq = Math.round(lat) === 0;
    for (const sd of spec.lat) {
      if (sd.out) {
        if (sd.side === 'left') {
          ticks.push({ x: l - TICK, y: y - 0.5, w: TICK, h: 1 });
          texts.push({ text, x: l - GAP, y, ax: 1, ay: 0.5, eq, out: true });
        } else {
          ticks.push({ x: r, y: y - 0.5, w: TICK, h: 1 });
          texts.push({ text, x: r + GAP, y, ax: 0, ay: 0.5, eq, out: true });
        }
      } else {
        // 地图里:写在纬线上面一点;离上下边太近的不写(让给贴着那条边写的经度)
        if (y < t + (lonIn.top ? fs * 2 + 4 : fs + 4) || y > bt - (lonIn.bottom ? fs * 2 + 4 : 0)) continue;
        if (sd.side === 'left') texts.push({ text, x: l + 4, y: y - 2, ax: 0, ay: 1, eq, out: false });
        else texts.push({ text, x: r - 4, y: y - 2, ax: 1, ay: 1, eq, out: false });
      }
    }
  }
  return { texts, ticks, lonEvery, latEvery };
}

/**
 * 弯边投影(罗宾森、自然地球、摩尔魏德:纬线是水平直线,经线是弯的)上写在地图里:
 *   - 纬度:贴着左边写在纬线上面;这条纬线的左端(外轮廓)露在看得见的地方、外面放得下字时,写在轮廓外面紧挨着线头(纸质地图册的写法)
 *   - 经度:写在每条经线和下边相交的地方;外轮廓的下边露出来时写在下边外面(摩尔魏德的经线在极点汇成一点,改写在赤道下面)
 */
function layoutCurved(W: number, H: number, v: MapView, b: StageBox, mp: MapProj, step: number, spec: GratSpec): GratLayout | null {
  const { def, s } = mp;
  const at = (mx: number, my: number) => worldToStage(mx, my, v, b, W, H);
  const myOf = (Y: number) => stageToWorld(0, Y, v, b, W, H)[1];
  const phiAt = (Y: number) => {
    const yp = Math.max(-mp.yMax, Math.min(mp.yMax, (H / 2 - myOf(Y)) / s));
    return def.phi(yp);
  };
  const xAt = (lamDeg: number, phi: number) => at(W / 2 + s * def.kx(phi) * lamDeg * DEG, 0)[0];
  const outTop = at(0, H / 2 - s * mp.yMax)[1];
  const outBottom = at(0, H / 2 + s * mp.yMax)[1];
  let l = 0;
  let r = b.sw;
  let t = Math.max(0, outTop);
  let bt = Math.min(b.sh, outBottom);
  if (spec.area) {
    l = Math.max(l, spec.area[0]);
    t = Math.max(t, spec.area[1]);
    r = Math.min(r, spec.area[2]);
    bt = Math.min(bt, spec.area[3]);
  }
  if (r - l < 1 || bt - t < 1) return null;
  const fs = spec.fs;
  const sx = (v.k * b.bw) / W;
  const sy = (v.k * b.bh) / H;
  const texts: GratText[] = [];
  const latMax = def.latMax / DEG;
  const latEvery = labelEvery(step, (deg) => sy * s * def.y(deg * DEG), fs + 6);
  // 经度写在哪一行:外轮廓下边露出来了 → 写在下边外面(摩尔魏德:赤道下面);没露出来 → 看得见的下边
  const edgeShown = outBottom <= bt + 0.5;
  const poleLine = def.kx(def.latMax) > 0.2;
  const rowY = !edgeShown ? bt : poleLine ? outBottom : at(0, H / 2)[1];
  const rowPhi = !edgeShown ? phiAt(bt) : poleLine ? -def.latMax : 0;
  const lonEvery = labelEvery(step, (deg) => sx * s * def.kx(rowPhi) * deg * DEG, fs * 3 + 12);
  for (let lon = -180; lon < 180; lon += lonEvery) {
    const t0 = (lon - mp.lon0 + 180) / 360;
    const rel = (t0 - Math.floor(t0)) * 360 - 180;
    const rels = rel <= -180 + 1e-9 ? [-180, 180] : [rel];
    for (const rl of rels) {
      const x = xAt(rl, rowPhi);
      if (x < l - 0.5 || x > r + 0.5) continue;
      const text = lonText(lon);
      const eq = Math.round(lon) === 0;
      if (edgeShown && poleLine) {
        texts.push({ text, x, y: rowY + 7, ax: 0.5, ay: 0, eq, out: false });
        continue;
      }
      if (x + 3 + fs * 3 > Math.min(r, spec.lonInRight ?? Infinity)) continue;
      if (edgeShown) texts.push({ text, x: x + 3, y: rowY + 4, ax: 0, ay: 0, eq, out: false });
      else texts.push({ text, x: x + 3, y: rowY - 4, ax: 0, ay: 1, eq, out: false });
    }
  }
  for (let lat = latEvery * Math.floor(89.999 / latEvery); lat > -90; lat -= latEvery) {
    if (Math.abs(lat) > latMax + 1e-9) continue;
    const phi = lat * DEG;
    const y = at(0, H / 2 - s * def.y(phi))[1];
    if (y < t + fs + 4 || y > bt - (edgeShown ? 0 : fs * 2 + 4)) continue;
    const xL = xAt(-180, phi);
    const xR = xAt(180, phi);
    const text = latText(lat);
    const eq = Math.round(lat) === 0;
    const w = text.length * 0.6 * fs;
    if (xL - 7 - w >= l) texts.push({ text, x: xL - 7, y, ax: 1, ay: 0.5, eq, out: false });
    else {
      const x = Math.max(l, xL) + 4;
      if (x + w > Math.min(r, xR)) continue;
      texts.push({ text, x, y: y - 2, ax: 0, ay: 1, eq, out: false });
    }
  }
  return { texts, ticks: [], lonEvery, latEvery };
}
