/**
 * 地图投影的公式和名字:等距圆柱 / 罗宾森 / 自然地球 / 摩尔威德 / 墨卡托(怎么用、坐标约定见 projection.ts 的文件头)。
 * 和 projection.ts 分开放:首页(地图投影的设置、首页那颗星球)只用得到这几样,不用跟着下载画投影图、经纬网、按投影重画的那些。
 * 纯计算,不碰 DOM。
 */
export type ProjectionId = 'equirect' | 'robinson' | 'naturalEarth' | 'mollweide' | 'mercator';

export interface ProjectionDef {
  id: ProjectionId;
  /** 界面上的名字 */
  name: string;
  /** 一句话说明("图层与投影"弹层里悬停时显示) */
  hint: string;
  /** 纬度(弧度)→ 投影平面的 y(向北为正;单位球) */
  y(phi: number): number;
  /** 投影平面的 y → 纬度(弧度);超出范围 = NaN */
  phi(y: number): number;
  /** 纬线 φ 上的横向比例:x = kx(φ) · λ(λ 为弧度) */
  kx(phi: number): number;
  /** 画到的最大纬度(弧度;墨卡托截在 ±80°,其它到极点) */
  latMax: number;
}

const HALF_PI = Math.PI / 2;
const DEG = Math.PI / 180;

const equirect: ProjectionDef = {
  id: 'equirect',
  name: '等距圆柱',
  hint: '2:1 长方形,经纬线横平竖直;高纬度横向拉宽。改地形、导出高度图都用它',
  y: (phi) => phi,
  phi: (y) => (Math.abs(y) <= HALF_PI + 1e-12 ? Math.max(-HALF_PI, Math.min(HALF_PI, y)) : NaN),
  kx: () => 1,
  latMax: HALF_PI,
};

// ---- 罗宾森:Snyder 的 5° 表,Catmull-Rom 插值成细表(每 0.05°);反投影在细表里二分找纬度 ----
const ROB_X = [1, 0.9986, 0.9954, 0.99, 0.9822, 0.973, 0.96, 0.9427, 0.9216, 0.8962, 0.8679, 0.835, 0.7986, 0.7597, 0.7186, 0.6732, 0.6213, 0.5722, 0.5322];
const ROB_Y = [0, 0.062, 0.124, 0.186, 0.248, 0.31, 0.372, 0.434, 0.4958, 0.5571, 0.6176, 0.6769, 0.7346, 0.7903, 0.8435, 0.8936, 0.9394, 0.9761, 1];
const ROB_N = 1800;
const ROB_FX = new Float64Array(ROB_N + 1);
const ROB_FY = new Float64Array(ROB_N + 1);
{
  // 表两头按对称 / 线性外推补一格,好做 Catmull-Rom
  const at = (tab: number[], i: number, odd: boolean) => (i < 0 ? (odd ? -tab[-i] : tab[-i]) : i > 18 ? 2 * tab[18] - tab[36 - i] : tab[i]);
  const cr = (tab: number[], u: number, odd: boolean) => {
    const i = Math.min(17, Math.floor(u));
    const t = u - i;
    const p0 = at(tab, i - 1, odd);
    const p1 = at(tab, i, odd);
    const p2 = at(tab, i + 1, odd);
    const p3 = at(tab, i + 2, odd);
    return 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (-p0 + 3 * p1 - 3 * p2 + p3) * t * t * t);
  };
  for (let k = 0; k <= ROB_N; k++) {
    const u = (k / ROB_N) * 18;
    ROB_FX[k] = cr(ROB_X, u, false);
    ROB_FY[k] = cr(ROB_Y, u, true);
  }
}
function robLookup(tab: Float64Array, latAbs: number): number {
  const u = Math.min(1, latAbs / HALF_PI) * ROB_N;
  const k = Math.min(ROB_N - 1, Math.floor(u));
  return tab[k] + (tab[k + 1] - tab[k]) * (u - k);
}
const ROB_KX = 0.8487;
const ROB_KY = 1.3523;
const robinson: ProjectionDef = {
  id: 'robinson',
  name: '罗宾森',
  hint: '圆角的"桶形",变形折中,最像纸质地图集',
  y: (phi) => Math.sign(phi) * ROB_KY * robLookup(ROB_FY, Math.abs(phi)),
  phi: (y) => {
    const yy = Math.abs(y) / ROB_KY;
    if (yy > 1 + 1e-12) return NaN;
    if (yy >= 1) return Math.sign(y) * HALF_PI;
    let lo = 0;
    let hi = ROB_N;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (ROB_FY[mid] <= yy) lo = mid;
      else hi = mid;
    }
    const u = lo + (yy - ROB_FY[lo]) / (ROB_FY[hi] - ROB_FY[lo] || 1);
    return Math.sign(y) * (u / ROB_N) * HALF_PI;
  },
  kx: (phi) => ROB_KX * robLookup(ROB_FX, Math.abs(phi)),
  latMax: HALF_PI,
};

// ---- 自然地球(Natural Earth I,Šavrič 等 2011):多项式,反投影牛顿迭代 ----
const neKx = (phi: number) => {
  const p2 = phi * phi;
  const p4 = p2 * p2;
  return 0.8707 - 0.131979 * p2 - 0.013791 * p4 + p4 * p4 * p2 * (0.003971 - 0.001529 * p2);
};
const neY = (phi: number) => {
  const p2 = phi * phi;
  return phi * (1.007226 + p2 * (0.015085 + p2 * p2 * (-0.044475 + 0.028874 * p2 - 0.005916 * p2 * p2)));
};
const NE_YMAX = neY(HALF_PI);
const naturalEarth: ProjectionDef = {
  id: 'naturalEarth',
  name: '自然地球',
  hint: '和罗宾森很像,两极更圆润',
  y: neY,
  phi: (y) => {
    if (Math.abs(y) > NE_YMAX + 1e-12) return NaN;
    let phi = y;
    for (let i = 0; i < 25; i++) {
      const p2 = phi * phi;
      const f = neY(phi) - y;
      const d = 1.007226 + p2 * (3 * 0.015085 + p2 * p2 * (-7 * 0.044475 + 9 * 0.028874 * p2 - 11 * 0.005916 * p2 * p2));
      const dp = f / d;
      phi -= dp;
      if (Math.abs(dp) < 1e-12) break;
    }
    return Math.max(-HALF_PI, Math.min(HALF_PI, phi));
  },
  kx: neKx,
  latMax: HALF_PI,
};

// ---- 摩尔威德:椭圆,面积准确。2θ + sin2θ = π sinφ(牛顿迭代) ----
function mollTheta(phi: number): number {
  if (Math.abs(phi) >= HALF_PI - 1e-12) return Math.sign(phi) * HALF_PI;
  const k = Math.PI * Math.sin(phi);
  let t = phi;
  for (let i = 0; i < 40; i++) {
    const d = 2 + 2 * Math.cos(2 * t);
    if (d < 1e-12) break;
    const dt = (2 * t + Math.sin(2 * t) - k) / d;
    t -= dt;
    if (Math.abs(dt) < 1e-13) break;
  }
  return t;
}
const mollweide: ProjectionDef = {
  id: 'mollweide',
  name: '摩尔威德',
  hint: '椭圆,面积准确 —— 比较大陆、国家的真实大小',
  y: (phi) => Math.SQRT2 * Math.sin(mollTheta(phi)),
  phi: (y) => {
    if (Math.abs(y) > Math.SQRT2 + 1e-12) return NaN;
    const t = Math.asin(Math.max(-1, Math.min(1, y / Math.SQRT2)));
    return Math.asin(Math.max(-1, Math.min(1, (2 * t + Math.sin(2 * t)) / Math.PI)));
  },
  kx: (phi) => ((2 * Math.SQRT2) / Math.PI) * Math.cos(mollTheta(phi)),
  latMax: HALF_PI,
};

// ---- 墨卡托:局部形状准,高纬度面积放大;两极画不出来,截在 ±80° ----
const MERC_LAT = 80 * DEG;
const mercY = (phi: number) => Math.log(Math.tan(Math.PI / 4 + phi / 2));
const MERC_YMAX = mercY(MERC_LAT);
const mercator: ProjectionDef = {
  id: 'mercator',
  name: '墨卡托',
  hint: '网页地图常用;局部形状准,高纬度面积严重放大,两极截在 ±80°',
  y: (phi) => mercY(Math.max(-MERC_LAT, Math.min(MERC_LAT, phi))),
  phi: (y) => (Math.abs(y) > MERC_YMAX + 1e-12 ? NaN : 2 * Math.atan(Math.exp(y)) - HALF_PI),
  kx: () => 1,
  latMax: MERC_LAT,
};

export const PROJECTIONS: Record<ProjectionId, ProjectionDef> = { equirect, robinson, naturalEarth, mollweide, mercator };
/** "图层与投影"弹层里的顺序 */
export const PROJECTION_IDS: ProjectionId[] = ['equirect', 'robinson', 'naturalEarth', 'mollweide', 'mercator'];

export function isProjectionId(x: unknown): x is ProjectionId {
  return typeof x === 'string' && Object.prototype.hasOwnProperty.call(PROJECTIONS, x);
}

/** 弯边投影在地图平面里四周留的边(占高度的比例):放外框、罗盘 */
export const PROJ_PAD = 0.035;
