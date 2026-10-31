/**
 * 写实地貌风格:类似卫星图 + 地形晕渲,按"世界地图"的尺度来画:
 * - 晕渲突出大尺度(整条山脉、高原边缘),平原上的小起伏压平 —— 大陆大半看着平缓,只有几条山脉醒目
 * - 海按深浅分层上色(大陆架浅、深海平原深、洋中脊略浅、海沟最深),再叠一层很淡的海底晕渲
 * - 河流是矢量层(drawRealisticRivers):全图时细、小河不画;放大后细节层(render/detail.ts)按缩放倍数重画,主干才显出粗
 * 像素层(不含河)单独缓存一份(realisticBase),细节层放大时拿它当底图。
 */
import type { World } from '../gen/world';
import type { Raster } from '../gen/raster';
import { BIOMES, Biome, LAND_ICE_BELOW, classifyBiome } from '../gen/biomes';
import {
  bakedView,
  boxBlur,
  boxBlurWrap,
  cylinderNoise,
  drawRivers,
  riverNetworkSteps,
  hexRGB,
  hillshade,
  mix,
  ramp,
  riverLod,
  rasterRowCos,
  rowCos,
  hash2,
  wrapOf,
  type PrepStep,
  type WorkStep,
  type RGB,
  type RiverOptions,
  type RiverStyle,
  type VecView,
} from './common';
import { drawParts, type DrawPart } from './common';
import { smoothstep } from '../gen/util';
import { CREEK_FRAC, creeksOf } from '../gen/creeks';
import { reprojectImage, type Projector } from './projection';
import { boxOfCols, boxSpans, growBox, unionBox, type PixelBox } from '../gen/pixelBox';
import { WINDOW_PAD } from '../gen/rasterWindow';
import { cutRaster } from '../gen/rasterPatch';
import type { SurfaceLook } from './surface';
import { ATLAS_RIVER, ATLAS_SEA, ATLAS_SEA_EDGES, HYPSO, HYPSO_ARID, HYPSO_EDGES, HYPSO_SNOW, STIPPLE } from './atlasColors';

/**
 * 海的颜色(按海底深度):0 ~ −200 米是大陆架(浅、亮),过了坡折很快变深;
 * −2000 米上下是洋中脊顶,−3500 ~ −4500 米是深海平原,再往下是海沟。
 */
const OCEAN_CLASSIC: [number, RGB][] = [
  [-7000, hexRGB('#04112a')],
  [-5200, hexRGB('#081d3e')],
  [-4300, hexRGB('#0b2649')],
  [-3500, hexRGB('#0e2d55')],
  [-2600, hexRGB('#123a66')],
  [-1800, hexRGB('#174674')],
  [-900, hexRGB('#1c5282')],
  [-400, hexRGB('#236395')],
  [-200, hexRGB('#2f79a8')],
  [-100, hexRGB('#3b8ab3')],
  [0, hexRGB('#4a99ba')],
];
/** 简化卫星:远洋一片深蓝,只在岸边很窄一条变浅 */
const OCEAN_SIMPLE: [number, RGB][] = [
  [-7000, hexRGB('#0b2350')],
  [-2000, hexRGB('#0e2a5a')],
  [-500, hexRGB('#123366')],
  [-150, hexRGB('#15396d')],
  [-40, hexRGB('#1f4c80')],
  [0, hexRGB('#2c6593')],
];

/** 一种画法的全部参数(见 surface.ts);各项的意思见用到它的地方 */
interface Material {
  ocean: [number, RGB][];
  rock: RGB;
  /** 按海拔混裸岩:海拔从 rockE0 到 rockE1 米混到 rockEW(陡坡另算) */
  rockE0: number;
  rockE1: number;
  rockEW: number;
  lake: RGB;
  river: { color: string; minW: number; growW: number; bank: string };
  /** 河画多少:成河门槛乘这么多(全图、放大以后) */
  riverFlux: [number, number];
  detailW: number;
  macroW: number;
  seaRelief: number;
  shadowDepth: number;
  detailFlat: number;
  /** 细节晕渲的软阈值(明暗偏离平地不到 soft0 的压掉,到 soft1 全留) */
  soft0: number;
  soft1: number;
  /** 积雪 / 冰盖上的明暗减弱多少(0 = 不减) */
  snowFlat: number;
  /** 群落底色换成这一套(null = BIOMES[].real);色带的深浅压到几成 */
  biomes: Partial<Record<Biome, string>> | null;
  rampSquash: number;
  texAmpWet: number;
  texAmpDry: number;
  texGeo: number;
  texFine: number;
  texStreak: number;
  geoSharp: number;
  texCav: number;
  ecoP: number;
  valleyDark: number;
  /** 调色板模糊的半径(格;越大群落之间过渡越宽) */
  paletteBlur?: number;
  /** 细沟压暗乘这么多(默认 1) */
  veinK?: number;
  /** 白模:海陆平涂的几种颜色(不打光);null = 照常画 */
  flat: { sea: RGB; shelf: RGB; land: RGB; ice: RGB } | null;
  /** 陆地怎么上色:biome = 群落调色板(默认);photo = 按植被覆盖度连续上色(卫星照片);hypso = 按海拔分层设色(地图册) */
  model?: 'biome' | 'photo' | 'hypso';
  /** 暗面往天空冷色里混多少(默认 SHADOW_COOL;地图册的晕渲是中性灰,= 0) */
  cool?: number;
  /** 海岸描一圈线(水那一侧):颜色和浓淡 */
  coast?: [RGB, number];
  /** 分层设色的层间描一条细线(浓淡,0 = 不描) */
  bandLine?: number;
  /** 荒漠画点状符号(地图册的沙漠符号) */
  stipple?: boolean;
  /** 浅暖海(珊瑚礁、浅滩)泛青绿 */
  reef?: boolean;
  /** 干旱地方的河岸那一窄条按湿润的颜色画:乘这么多(默认 1;0 = 不画) */
  ripK?: number;
  /** 分层设色褪色多少(0–1;叠国家等填色时用,留明暗和层次,颜色让给填色) */
  mute?: number;
  /**
   * 放大后河口外的浑水(见 gen/estuary.ts):浓的地方是泥沙的黄绿(near),淡的地方偏青、混进海水(far);
   * 不给 = 不画浑水,喇叭口里也不往河水的颜色过渡(地图册只跟着变海岸形状;补到海的河道、三角洲的水道照样是河水的颜色)
   */
  plume?: { near: RGB; far: RGB };
}

const CLASSIC: Material = {
  ocean: OCEAN_CLASSIC,
  rock: hexRGB('#8a7d6c'),
  rockE0: 1600,
  rockE1: 3600,
  rockEW: 0.75,
  lake: hexRGB('#2f6690'),
  river: { color: 'rgb(58, 124, 180)', minW: 0.55, growW: 1.9, bank: 'rgba(22, 40, 30, 0.34)' },
  riverFlux: [1, 1],
  detailW: 0.85,
  macroW: 0.8,
  seaRelief: 0.45,
  shadowDepth: 0.45,
  detailFlat: 0.2,
  soft0: 0.02,
  soft1: 0.16,
  snowFlat: 0,
  biomes: null,
  rampSquash: 1,
  texAmpWet: 0.2,
  texAmpDry: 0.36,
  texGeo: 0.7,
  texFine: 0.3,
  texStreak: 0.25,
  geoSharp: 4,
  texCav: 0.14,
  ecoP: 0.15,
  valleyDark: 0.12,
  flat: null,
  plume: { near: [92, 132, 128], far: [70, 128, 150] },
};

/** 卫星(细节):远洋一片深蓝,大陆架窄窄一条渐浅(浅暖海另外泛青绿,见 Material.reef) */
const OCEAN_PHOTO: [number, RGB][] = [
  [-7000, hexRGB('#06183a')],
  [-3000, hexRGB('#091f45')],
  [-1000, hexRGB('#0b244d')],
  [-200, hexRGB('#0f2d5a')],
  [-80, hexRGB('#153f6e')],
  [-30, hexRGB('#1d5683')],
  [-10, hexRGB('#286c93')],
  [0, hexRGB('#357d9c')],
];
/** 浅暖海(珊瑚礁、浅滩)的青绿 */
const REEF_C = hexRGB('#3fa3ac');
/** 地理图:海按深度分层设色(每层一个颜色,层与层之间 5 米过渡) */
const OCEAN_ATLAS: [number, RGB][] = ATLAS_SEA.flatMap((c, i): [number, RGB][] => {
  const lo = i === 0 ? -7000 : ATLAS_SEA_EDGES[i - 1] + 5;
  const hi = i < ATLAS_SEA_EDGES.length ? ATLAS_SEA_EDGES[i] : 0;
  return [
    [lo, c],
    [hi, c],
  ];
});

/** 卫星照片的几种地面颜色:浓密植被(热带 / 温带 / 寒带)、草地(暖 / 冷)、裸地(沙、红褐岩、寒漠) */
const PH_FOREST_TROP = hexRGB('#1f3f18');
const PH_FOREST_TEMP = hexRGB('#2d4821');
const PH_FOREST_BOREAL = hexRGB('#25362a');
const PH_GRASS = hexRGB('#76703f');
const PH_GRASS_COLD = hexRGB('#62604a');
const PH_SAND = hexRGB('#d3b07e');
const PH_SAND_RED = hexRGB('#a98761');
const PH_SOIL_COLD = hexRGB('#8e8169');

/**
 * 卫星照片的地面颜色:先按 降水 ÷ 蒸发能力(随气温升高)算植被覆盖度(0–1),在 裸地 → 草地 → 森林 之间连续插值,
 * 群落不再一类一色;冷的地方植被压低(冻原、寒漠);裸地按大片的岩性纹理(rough,约 −1 ~ 1)分出几块红褐岩漠。
 * b = 0.5 上下的深浅(纹理、凹凸)
 */
function photoColor(t: number, p: number, b: number, rough: number, out: RGB) {
  const pet = Math.max(260, 360 + 55 * t);
  const fv = smoothstep(0.1, 0.95, p / pet) * smoothstep(-13, 1, t);
  const kg = smoothstep(0.02, 0.45, fv);
  const kf = smoothstep(0.4, 0.95, fv);
  const kt = t > 12 ? smoothstep(14, 23, t) : smoothstep(-3, 9, t);
  const kc = smoothstep(-6, 10, t);
  const kr = smoothstep(-0.8, -0.35, rough);
  const kb = smoothstep(-2, 12, t);
  const f0 = t > 12 ? PH_FOREST_TEMP : PH_FOREST_BOREAL;
  const f1 = t > 12 ? PH_FOREST_TROP : PH_FOREST_TEMP;
  const k = 0.8 + 0.4 * b;
  for (let i = 0; i < 3; i++) {
    const forest = f0[i] + (f1[i] - f0[i]) * kt;
    const grass = PH_GRASS_COLD[i] + (PH_GRASS[i] - PH_GRASS_COLD[i]) * kc;
    const warm = PH_SAND_RED[i] + (PH_SAND[i] - PH_SAND_RED[i]) * kr;
    const bare = PH_SOIL_COLD[i] + (warm - PH_SOIL_COLD[i]) * kb;
    const c = bare + (grass - bare) * kg;
    out[i] = (c + (forest - c) * kf) * k;
  }
}
/** 分层设色:海拔 e 在第几层(HYPSO_EDGES) */
function hypsoBand(e: number): number {
  let i = 0;
  while (i < HYPSO_EDGES.length && e >= HYPSO_EDGES[i]) i++;
  return i;
}

// 地理图:地图册的画法 —— 陆地按海拔分层设色(低处按干湿混沙黄)+ 中性灰晕渲,海按深度分层,海岸描线,荒漠打点,河蓝而多
const GEO: Material = {
  ...CLASSIC,
  model: 'hypso',
  plume: undefined,
  cool: 0,
  coast: [hexRGB('#3f6f98'), 0.7],
  bandLine: 0.1,
  stipple: true,
  ocean: OCEAN_ATLAS,
  rock: hexRGB('#a08a76'),
  rockE0: 9000,
  rockE1: 9001,
  rockEW: 0,
  lake: hexRGB('#b4daee'),
  river: { color: ATLAS_RIVER, minW: 0.55, growW: 1.9, bank: 'rgba(0, 0, 0, 0)' },
  riverFlux: [0.7, 0.9],
  detailW: 0.8,
  macroW: 0.55,
  seaRelief: 0.14,
  shadowDepth: 0.42,
  detailFlat: 0.3,
  soft0: 0.005,
  soft1: 0.08,
  snowFlat: 0.8,
  texAmpWet: 0,
  texAmpDry: 0,
  texCav: 0,
  valleyDark: 0,
  veinK: 0,
};

/** 'rgb(r, g, b)' / 'rgba(…)' → RGB(河的颜色是这样写的) */
function cssRGB(css: string): RGB {
  const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(css);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : [40, 80, 110];
}

const MATERIALS: Record<SurfaceLook, Material> = {
  classic: CLASSIC,
  // 卫星(细节):照片的颜色 —— 植被覆盖度连续上色(沙黄 → 草地 → 深林),海面安静、浅暖海泛青绿,起伏轻,只画大河
  detail: {
    ...CLASSIC,
    model: 'photo',
    reef: true,
    ocean: OCEAN_PHOTO,
    plume: { near: [84, 100, 80], far: [46, 92, 102] },
    rock: hexRGB('#7b7062'),
    rockE0: 2600,
    rockE1: 4800,
    rockEW: 0.5,
    lake: hexRGB('#16426e'),
    river: { ...CLASSIC.river, color: 'rgb(28, 64, 92)', minW: 0.45, growW: 1.6, bank: 'rgba(22, 40, 30, 0.2)' },
    riverFlux: [2.4, 1.4],
    detailW: 1.0,
    macroW: 0.3,
    seaRelief: 0.04,
    shadowDepth: 0.36,
    detailFlat: 0.35,
    soft0: 0.005,
    soft1: 0.08,
    snowFlat: 0.75,
    cool: 0.3,
    texAmpWet: 0.26,
    texAmpDry: 0.4,
    texGeo: 0.75,
    texFine: 0.34,
    texStreak: 0.18,
    geoSharp: 6,
    texCav: 0.16,
    ecoP: 0.2,
    valleyDark: 0.14,
    veinK: 0.6,
    ripK: 0.5,
  },
  geo: GEO,
  // 地理图叠国家 / 民族 / 信仰 / 时代颜色时:同一套,陆地的层色褪掉七成(留明暗和层次,颜色让给填色)
  geoMute: { ...GEO, mute: 0.7 },
  // 白模:不打光,只画大河(浅蓝细线)
  blank: {
    ...CLASSIC,
    river: { ...CLASSIC.river, color: 'rgb(150, 186, 214)' },
    riverFlux: [2.5, 1.5],
    detailW: 0,
    macroW: 0,
    seaRelief: 0,
    flat: { sea: hexRGB('#c6dbea'), shelf: hexRGB('#d6e6f1'), land: hexRGB('#efece4'), ice: hexRGB('#fbfcfd') },
    plume: undefined,
  },
  // 简化卫星:和细节同一套照片的颜色,纹理很轻、起伏淡、海面安静、雪平、河更少
  simple: {
    ...CLASSIC,
    model: 'photo',
    reef: true,
    ocean: OCEAN_SIMPLE,
    plume: { near: [84, 100, 80], far: [46, 92, 102] },
    rock: hexRGB('#9a8a74'),
    rockE0: 2800,
    rockE1: 5200,
    rockEW: 0.35,
    lake: hexRGB('#1f4f86'),
    river: { ...CLASSIC.river, color: 'rgb(38, 82, 120)', minW: 0.45, growW: 1.5 },
    riverFlux: [3, 1.6],
    veinK: 0,
    ripK: 0.5,
    detailW: 0.5,
    macroW: 0.3,
    seaRelief: 0.05,
    shadowDepth: 0.28,
    detailFlat: 0.25,
    soft0: 0.02,
    soft1: 0.14,
    snowFlat: 0.85,
    texAmpWet: 0.12,
    texAmpDry: 0.16,
    texGeo: 0.4,
    texFine: 0.24,
    texStreak: 0.08,
    geoSharp: 2,
    texCav: 0.05,
    ecoP: 0.12,
    valleyDark: 0.06,
  },
};

const OCEAN_MIN = -7000;
const OCEAN_N = -OCEAN_MIN / 10 + 1;
const oceanCache = new Map<SurfaceLook, Float32Array>();
/** 海色查找表:−7000 ~ 0 米,每 10 米一格 */
function oceanLut(look: SurfaceLook): Float32Array {
  const hit = oceanCache.get(look);
  if (hit) return hit;
  const t = new Float32Array(OCEAN_N * 3);
  for (let i = 0; i < OCEAN_N; i++) {
    const c = ramp(MATERIALS[look].ocean, OCEAN_MIN + i * 10);
    t[i * 3] = c[0];
    t[i * 3 + 1] = c[1];
    t[i * 3 + 2] = c[2];
  }
  oceanCache.set(look, t);
  return t;
}
const SNOW = hexRGB('#f4f6f8');
const SEA_ICE = hexRGB('#dde8ee');
const ICE_PACK = hexRGB('#e8eef2');
const ICE_YOUNG = hexRGB('#a9bccb');
const SLUSH = hexRGB('#4d6b82');
/** 暗面的天空散射光:阴影往冷灰蓝里混,而不是压成黑 */
const SKY_SHADOW = hexRGB('#3c465a');

type AnyCanvas = HTMLCanvasElement | OffscreenCanvas;
function makeCanvas(w: number, h: number): AnyCanvas {
  return typeof document !== 'undefined'
    ? Object.assign(document.createElement('canvas'), { width: w, height: h })
    : new OffscreenCanvas(w, h);
}

interface Base {
  raster: Raster;
  look: SurfaceLook;
  canvas: AnyCanvas;
  raw: Uint8ClampedArray | null;
  /** 大尺度晕渲的粗网格(编辑地形后按块重画时和下一张的比,见 realisticPatchSteps) */
  grids: MacroGrids | null;
}
/**
 * 当前这张地图的像素层(不含河;realisticBase 刚给出的那一份)。
 * raw = 水陆交界抗锯齿之前的像素(放大后的细节层拼水、陆两份要用,见 realisticShoreLayers;编辑地形后按块重画时照它补一块)
 */
let base: Base | null = null;
/**
 * 同一个世界最近铺过的几张(地形大事前后各一张主图、来回换画法,不用重铺;最近的在前)。
 * 换了世界(主图的地块索引不是同一份)就都释放
 */
let bases: Base[] = [];
const BASES_KEEP = 3;

/** 像素层(地貌、海、冰、晕渲,不含河):铺进地形图,也给放大后的细节层当底图 */
export function realisticBase(r: Raster, look: SurfaceLook = 'classic'): AnyCanvas {
  if (base?.raster === r && base.look === look) return base.canvas;
  const hit = bases.find((b) => b.raster === r && b.look === look);
  if (hit) {
    base = hit;
    bases = [hit, ...bases.filter((b) => b !== hit)];
    return hit.canvas;
  }
  const cv = makeCanvas(r.w, r.h);
  // 后台线程已经画好的(新建世界随地图交来的):贴上就是
  const got = paintedOf(r, look);
  if (got) {
    adoptPainted(r, look, got, cv);
    return cv;
  }
  const ctx = cv.getContext('2d') as CanvasRenderingContext2D;
  const grids = r.win ? null : macroGrids(r);
  const raw = paintRealistic(ctx, r, undefined, true, grids ?? undefined, look);
  adoptBase({ raster: r, look, canvas: cv, raw, grids });
  return cv;
}

/** 新铺好的一张像素层放进缓存(最前);同一个世界留最近 BASES_KEEP 张,别的释放 */
function adoptBase(b: Base): void {
  const keep = bases.filter((x) => x.raster.cell === b.raster.cell && !(x.raster === b.raster && x.look === b.look)).slice(0, BASES_KEEP - 1);
  for (const x of bases) if (!keep.includes(x)) x.canvas.width = x.canvas.height = 0;
  base = b;
  bases = [b, ...keep];
}

/**
 * 地图换上了一张新的主图(新生成、编辑地形重新生成):缓存里除了 keep 这几张(新的这张;按块换上的另带它是从哪张改来的,
 * 样式缩略图照那张按块重画)以外的像素层,连同它们拉着的旧主图,现在就放掉 —— 不等下一次画写实时才挤掉
 * (那之前旧主图连同它的像素层一直占着;编辑地形连涂时一笔一张)
 */
export function dropRealisticBasesExcept(keep: readonly (Raster | null | undefined)[]): void {
  const kept = bases.filter((b) => keep.includes(b.raster));
  for (const b of bases) if (!kept.includes(b)) b.canvas.width = b.canvas.height = 0;
  bases = kept;
  if (base && !kept.includes(base)) base = null;
  if (shoreCache && !keep.includes(shoreCache.raster)) {
    shoreCache.water.width = shoreCache.water.height = shoreCache.land.width = shoreCache.land.height = 0;
    shoreCache = null;
  }
  if (landPathCache && !keep.includes(landPathCache.raster)) landPathCache = null;
  if (painted && !keep.includes(painted.raster)) painted = null;
}

/** 一条带子每步重画多少个像素(约一两帧的活) */
const PATCH_BAND_PX = 120000;
/**
 * 整张分步画(realisticFullSteps:打开世界换上之前、缩略图)一条带子多少个像素:窄一半,手机(慢四倍)上一步也在几十毫秒左右
 * (每条带子上下各多画 WINDOW_PAD 行,带子窄了多画的比例大一点)
 */
const FULL_BAND_PX = 60000;

/**
 * 编辑地形后按块重画像素层(地形、海、冰、晕渲,不含河):r1 是 r0 贴上一块主图补丁得来的,两张只在 box 里不一样
 * (gen/rasterPatch.ts 的 exactPatch;null = 一个像素也没变)。r0 这种画法的像素层还在缓存里,就复制一份,
 * 只重画受影响的那块:box 外扩 3 像素(晕渲、岸线抗锯齿看邻居,湖岸看 ±3)+ 大尺度晕渲粗网格变了的那几格管到的像素。
 * 每条带子四周再多画 WINDOW_PAD 个像素裁掉(带子边上的邻居不全;过了右边的列按整张图接回左边算)。
 * 分几步做(每步一条带子),最后一步把新的一张放进缓存:结果和整张重画逐像素相同。缓存里没有 r0 的 = null(到时候整张画)
 */
export function realisticPatchSteps(r1: Raster, r0: Raster, look: SurfaceLook, box: PixelBox | null): WorkStep[] | null {
  const b0 = bases.find((b) => b.raster === r0 && b.look === look);
  if (!b0 || r0.win || r1.win || r1.w !== r0.w || r1.h !== r0.h || r1.scale !== 1) return null;
  const W = r1.w;
  const H = r1.h;
  let g0 = b0.grids;
  let g1: MacroGrids | null = null;
  let region: PixelBox | null = null;
  let cv: AnyCanvas | null = null;
  let ctx: CanvasRenderingContext2D | null = null;
  let raw: Uint8ClampedArray | null = null;
  let y = 0;
  let band = 1;
  return [
    // 原来那张先复制下来(后面几步之间让出主线程,缓存里的那张可能被别的画法挤掉、释放)
    () => {
      cv = makeCanvas(W, H);
      ctx = cv.getContext('2d') as CanvasRenderingContext2D;
      ctx.drawImage(b0.canvas, 0, 0);
      raw = b0.raw ? b0.raw.slice() : null;
    },
    () => void (g0 ??= macroGrids(r0)),
    () => void (g1 = macroGrids(r1)),
    () => {
      region = realisticPatchRegion(box, g0!, g1!, W, H);
      y = region ? region.y0 : 0;
      band = region ? Math.max(8, Math.floor(PATCH_BAND_PX / region.w)) : 1;
    },
    () => {
      if (!region) return;
      const y1 = Math.min(region.y0 + region.h, y + band);
      for (const p of realisticBandPixels(r1, g1!, look, region, y, y1, !!raw)) {
        ctx!.putImageData(new ImageData(p.px, p.n, y1 - y), p.x, y);
        if (raw && p.raw) for (let yy = 0; yy < y1 - y; yy++) raw.set(p.raw.subarray(yy * p.n * 4, (yy + 1) * p.n * 4), ((y + yy) * W + p.x) * 4);
      }
      y = y1;
      return y < region.y0 + region.h;
    },
    () => adoptBase({ raster: r1, look, canvas: cv!, raw, grids: g1 }),
  ];
}

/**
 * 整张像素层分几步画(每步一条带子,和 realisticBase 一口气画逐像素相同),最后一步放进缓存:之后 realisticBase 直接拿。
 * 后台线程已经画好了的(takeRealisticPainted)只剩贴上、放进缓存那一步。
 * 缓存里已经有这一张的(或放大后现算的一块)= null
 */
export function realisticFullSteps(r: Raster, look: SurfaceLook): WorkStep[] | null {
  if (r.win || bases.some((b) => b.raster === r && b.look === look)) return null;
  if (paintedOf(r, look))
    return [
      () => {
        // 这之前别处已经整张画过一张(切到了写实),或者那一张已经贴进了缓存:不用再贴
        const got = paintedOf(r, look);
        if (got && !bases.some((b) => b.raster === r && b.look === look)) adoptPainted(r, look, got, makeCanvas(r.w, r.h));
      },
    ];
  const W = r.w;
  const H = r.h;
  const region: PixelBox = { x0: 0, y0: 0, w: W, h: H };
  const band = Math.max(8, Math.floor(FULL_BAND_PX / W));
  let g: MacroGrids | null = null;
  let cv: AnyCanvas | null = null;
  let ctx: CanvasRenderingContext2D | null = null;
  let raw: Uint8ClampedArray | null = null;
  let y = 0;
  return [
    () => void (g = macroGrids(r)),
    () => {
      cv = makeCanvas(W, H);
      ctx = cv.getContext('2d') as CanvasRenderingContext2D;
      raw = new Uint8ClampedArray(W * H * 4);
    },
    () => {
      const y1 = Math.min(H, y + band);
      for (const p of realisticBandPixels(r, g!, look, region, y, y1, true)) {
        ctx!.putImageData(new ImageData(p.px, p.n, y1 - y), p.x, y);
        for (let yy = 0; yy < y1 - y; yy++) raw!.set(p.raw!.subarray(yy * p.n * 4, (yy + 1) * p.n * 4), ((y + yy) * W + p.x) * 4);
      }
      y = y1;
      return y < H;
    },
    () => {
      // 这几步之间别处已经整张画过一张(切到了写实):用那张
      if (bases.some((b) => b.raster === r && b.look === look)) return void (cv!.width = cv!.height = 0);
      adoptBase({ raster: r, look, canvas: cv!, raw, grids: g });
    },
  ];
}

/** 编辑地形后要重画的那块(见 realisticPatchSteps):r0 → r1 两张主图、两张粗网格比出来;没有要重画的 = null */
export function realisticPatchRegion(box: PixelBox | null, g0: MacroGrids, g1: MacroGrids, W: number, H: number): PixelBox | null {
  return unionBox(box && growBox(box, 3, 3, W, H), gridChange(g0, g1, W, H), W);
}

/** 两张粗网格(同样大)变了的格子管到的像素的框(双线性取样用到这一格的像素,多算一点;没变 = null) */
function gridChange(a: MacroGrids, b: MacroGrids, W: number, H: number): PixelBox | null {
  const { F, mw, mh } = b;
  if (a.mw !== mw || a.mh !== mh) return { x0: 0, y0: 0, w: W, h: H };
  const col = new Uint8Array(W);
  let y0 = H;
  let y1 = -1;
  const bits = (x: Float32Array) => new Int32Array(x.buffer, x.byteOffset, x.length);
  const pairs = [
    [bits(a.SL), bits(b.SL)],
    [bits(a.SS), bits(b.SS)],
    [bits(a.P), bits(b.P)],
  ];
  const cells = new Uint8Array(mw * mh);
  for (const [p, q] of pairs) for (let j = 0; j < p.length; j++) if (p[j] !== q[j]) cells[j] = 1;
  for (let cy = 0; cy < mh; cy++) {
    for (let cx = 0; cx < mw; cx++) {
      if (!cells[cy * mw + cx]) continue;
      y0 = Math.min(y0, Math.max(0, F * cy - 2 * F));
      y1 = Math.max(y1, Math.min(H - 1, F * cy + 2 * F));
      for (let x = F * cx - 2 * F; x <= F * cx + 2 * F; x++) col[((x % W) + W) % W] = 1;
    }
  }
  return boxOfCols(col, y0, y1);
}

/**
 * 纯计算(单测用):region 里 y0..y1 − 1 这几行的像素(和整张重画的这几行逐像素相同),按 region 的列分成一两段
 * (x = 这一段从全图第几列起,n 列;px = 抗锯齿以后的 RGBA,raw = 抗锯齿之前的,wantRaw 才给)。
 * 四周多画 WINDOW_PAD 个像素再裁掉;region 加上余量够一整圈时整圈画(整圈的一块东西相连,和整张图一样)
 */
export function realisticBandPixels(r: Raster, g: MacroGrids, look: SurfaceLook, region: PixelBox, y0: number, y1: number, wantRaw: boolean): { x: number; n: number; px: Uint8ClampedArray; raw: Uint8ClampedArray | null }[] {
  const W = r.w;
  const H = r.h;
  const P = WINDOW_PAD;
  const wy0 = Math.max(0, y0 - P);
  const wy1 = Math.min(H, y1 + P);
  const whole = region.w + 2 * P >= W;
  const wx0 = whole ? 0 : (region.x0 - P + W) % W;
  const ww = whole ? W : region.w + 2 * P;
  const { px: out, raw: pre } = realisticWindowPaint(cutRaster(r, wx0, wy0, ww, wy1 - wy0), g, look, wantRaw);
  const rows = y1 - y0;
  return boxSpans(region, W).map(([s, e]) => {
    const n = e - s;
    // 这一段的第一列在这一块里是第几列(整圈画的一块就是全图的列号;不然是余量 + 在 region 里第几列)
    const wc = whole ? s : P + ((s - region.x0 + W) % W);
    const o = new Uint8ClampedArray(n * rows * 4);
    const q = pre ? new Uint8ClampedArray(n * rows * 4) : null;
    for (let yy = 0; yy < rows; yy++) {
      const src = ((y0 + yy - wy0) * ww + wc) * 4;
      o.set(out.subarray(src, src + n * 4), yy * n * 4);
      if (q) q.set(pre!.subarray(src, src + n * 4), yy * n * 4);
    }
    return { x: s, n, px: o, raw: q };
  });
}

/**
 * 纯计算(帮手线程里也能跑,见 gullyWorker.ts):切出来的一块(cutRaster)上色,大尺度晕渲按整张图的粗网格 g 取样。
 * px = 抗锯齿以后的 RGBA,raw = 抗锯齿之前的(wantRaw 才给);四周 WINDOW_PAD 个像素邻居不全,调用方裁掉
 */
export function realisticWindowPaint(win: Raster, g: MacroGrids, look: SurfaceLook, wantRaw: boolean): { px: Uint8ClampedArray; raw: Uint8ClampedArray | null } {
  let px: Uint8ClampedArray | null = null;
  const sink = {
    createImageData: (w: number, h: number) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }),
    putImageData: (img: { data: Uint8ClampedArray }) => {
      px = img.data;
    },
  } as unknown as CanvasRenderingContext2D;
  const raw = paintRealistic(sink, win, undefined, wantRaw, g, look);
  return { px: px as unknown as Uint8ClampedArray, raw };
}

/** 整张像素层按整行分带子画(后台线程,见 gullyPool.ts 的 paintRealistic)一条带子多少个像素:约几十毫秒的活 */
const ROWS_BAND_PX = 131072;

/** 整张像素层按整行分成的几条带子([y0, y1),从上到下) */
export function realisticRowBands(r: Pick<Raster, 'w' | 'h'>): [number, number][] {
  const band = Math.max(8, Math.floor(ROWS_BAND_PX / r.w));
  const out: [number, number][] = [];
  for (let y = 0; y < r.h; y += band) out.push([y, Math.min(r.h, y + band)]);
  return out;
}

/**
 * 第 y0..y1 − 1 行(整宽)连同上下各 WINDOW_PAD 行余量切出来的一块:上色(realisticWindowPaint)以后用
 * putRealisticRows 裁回这几行。和 realisticBandPixels 整圈画的那一块一样,拼回整张和一口气整张画逐像素相同。
 * reuse = 画完了的上一块(数组拷进它的里面,见 cutRaster)
 */
export function realisticRowsWindow(r: Raster, y0: number, y1: number, reuse?: Raster | null): Raster {
  const wy0 = Math.max(0, y0 - WINDOW_PAD);
  return cutRaster(r, 0, wy0, r.w, Math.min(r.h, y1 + WINDOW_PAD) - wy0, reuse);
}

/** 切出来的一块里的数组(后台线程和帮手之间交来交去时转移,不复制) */
export function windowTransferables(win: Raster): ArrayBuffer[] {
  const arrays = [win.elev, win.temp, win.precip, win.water, win.biome, win.ice, win.iceConc, win.iceTone, win.gully, win.bank, win.vein];
  return arrays.flatMap((a) => (a ? [a.buffer as ArrayBuffer] : []));
}

/** realisticRowsWindow(r, y0, y1) 那一块上好的色(px、raw)裁回 y0..y1 − 1 行,写进整张的 into(和主图一样大) */
export function putRealisticRows(into: { px: Uint8ClampedArray; raw: Uint8ClampedArray | null }, r: Pick<Raster, 'w'>, y0: number, y1: number, got: { px: Uint8ClampedArray; raw: Uint8ClampedArray | null }): void {
  const row = r.w * 4;
  const from = (y0 - Math.max(0, y0 - WINDOW_PAD)) * row;
  const n = (y1 - y0) * row;
  into.px.set(got.px.subarray(from, from + n), y0 * row);
  if (into.raw && got.raw) into.raw.set(got.raw.subarray(from, from + n), y0 * row);
}

/**
 * 后台线程整张画好的像素层(新建世界时随地图一起交来,见 worker.ts 的 map 和 gullyPool.ts 的 paintRealistic):
 * 每种画法一张(px = 抗锯齿以后的、raw = 之前的),和这张主图的粗网格
 */
export interface RealisticPainted {
  grids: MacroGrids;
  looks: { look: SurfaceLook; px: Uint8ClampedArray; raw: Uint8ClampedArray }[];
}

/** 交给主线程时 transfer 走的数组 */
export function realisticPaintedTransferables(p: RealisticPainted): ArrayBuffer[] {
  const g = p.grids;
  return [g.SL, g.SS, g.P, ...(g.GL ?? []), ...(g.GS ?? []), ...p.looks.flatMap((l) => [l.px, l.raw])].map((a) => a.buffer as ArrayBuffer);
}

/** 随地图交来、还没放进缓存的那几张(只留最近一张主图的;放进缓存的那种画法就从这里拿掉) */
let painted: { raster: Raster; p: RealisticPainted } | null = null;

/**
 * 主线程收到后台画好的像素层(r = 和它一起交来的主图):先记着,到 realisticFullSteps / realisticBase 要这一张时
 * 直接贴上(不再逐行上色);之前记着的别的主图的那几张放掉
 */
export function takeRealisticPainted(r: Raster, p: RealisticPainted): void {
  painted = { raster: r, p };
}

/** 记着的 r 这种画法画好的那一张(没有 = null) */
function paintedOf(r: Raster, look: SurfaceLook): RealisticPainted['looks'][number] | null {
  return painted?.raster === r ? (painted.p.looks.find((l) => l.look === look) ?? null) : null;
}

/** 画好的那一张贴进一张新画布、放进缓存(从记着的里拿掉) */
function adoptPainted(r: Raster, look: SurfaceLook, got: RealisticPainted['looks'][number], cv: AnyCanvas): void {
  (cv.getContext('2d') as CanvasRenderingContext2D).putImageData(new ImageData(got.px, r.w, r.h), 0, 0);
  const grids = painted!.p.grids;
  painted!.p.looks = painted!.p.looks.filter((l) => l !== got);
  if (!painted!.p.looks.length) painted = null;
  adoptBase({ raster: r, look, canvas: cv, raw: got.raw, grids });
}


export function renderRealistic(ctx: CanvasRenderingContext2D, world: World, r: Raster, look: SurfaceLook = 'classic') {
  ctx.drawImage(realisticBase(r, look), 0, 0);
  drawRealisticRivers(ctx, world, r, bakedView(r.scale), true, look);
}

// 等距圆柱主图(Raster.wrap)东西相连:所有邻域操作的列下标取模(左右接缝处无缝),
// 晕渲、陡坡的东西向坡度按纬度修正,纹理噪声左右首尾相接;河流跨 180° 经线时两边各画一份

/**
 * 河流的细节层级(k = 缩放倍数):
 * - 全图只画流量够大的河(小溪放大才出现);最粗的河约 2.4 个世界单位(全图约 1.5 个屏幕像素)
 * - 放大后先补齐小河,再往下是比成河门槛还小的小溪(gen/creeks.ts):放大 4 倍左右小溪都出来
 * - 放大后细水那一份宽度按 k^−0.6 收(屏幕上几乎不变粗),大河的宽度几乎按世界单位(k^−0.12,屏幕上约按 k^0.88 变粗)→ 主干越放大越显得粗
 */
export function realisticRiverStyle(k: number, threshold: number, look: SurfaceLook = 'classic'): RiverStyle {
  const kk = Math.max(1, k);
  const m = MATERIALS[look];
  return {
    color: m.river.color,
    minW: m.river.minW,
    maxW: m.river.minW + m.river.growW * Math.pow(kk, -0.12),
    fluxRef: 1400,
    thin: Math.pow(kk, -0.6),
    minFlux: threshold * (kk > 1 ? Math.max(CREEK_FRAC, 4.5 * Math.pow(kk, -2.2)) : riverLod(kk)) * m.riverFlux[kk > 1 ? 1 : 0],
  };
}

/** 河 + 小溪(放大后的细节层画;记住上一次的,河网几何也就按这个数组缓存) */
const withCreeks = new WeakMap<World, World['rivers']>();
function riversOf(world: World, k: number): World['rivers'] {
  if (k <= 1) return world.rivers;
  let r = withCreeks.get(world);
  if (!r) withCreeks.set(world, (r = [...world.rivers, ...creeksOf(world)]));
  return r;
}

/**
 * 河流(矢量层):越往下游越宽,河口张开;深色河岸让细河在浅色地面上也看得清。
 * creeks = false:放大后也不画小溪(细节层上盖着现算的块、块里画了小溪时,底下这张省掉)
 */
export function drawRealisticRivers(ctx: CanvasRenderingContext2D, world: World, r: Raster, v: VecView, creeks = true, look: SurfaceLook = 'classic') {
  const style = realisticRiverStyle(v.k, world.riverThreshold, look);
  drawRivers(ctx, creeks ? riversOf(world, v.k) : world.rivers, { ...v, wrap: wrapOf(world) }, world.riverThreshold, style, riverOpts(r, style, look));
}

function riverOpts(r: Raster, style: RiverStyle, look: SurfaceLook): RiverOptions {
  return {
    water: r.water,
    w: r.w,
    h: r.h,
    scale: r.scale,
    // 放大后现算的一块:河只留在这一块自己的陆地上
    origin: r.win ? [r.win.x0 / r.scale, r.win.y0 / r.scale] : undefined,
    bank: { color: MATERIALS[look].river.bank, width: 0.45 * (style.thin ?? 1) },
    mouthFlare: 1.5,
    widthPower: 0.65,
  };
}

/**
 * 整张图(renderRealistic)上的河先在后台分几步描好(common.ts 的 riverNetworkSteps):换上时 renderRealistic
 * 直接把描好的叠上,和当场画逐像素一样。打开世界时和像素层一起备
 */
export function realisticRiverSteps(world: World, r: Raster, look: SurfaceLook = 'classic'): WorkStep[] {
  const v = bakedView(r.scale);
  const style = realisticRiverStyle(v.k, world.riverThreshold, look);
  return riverNetworkSteps(r.w, r.h, riversOf(world, v.k), { ...v, wrap: wrapOf(world) }, world.riverThreshold, style, riverOpts(r, style, look));
}

// ---------------------------------------------------------------------------
// 放大后的岸线(细节层,见 render/detail.ts):像素层放大后水陆之间是一条好几个屏幕像素宽的模糊带,
// 改成"水那一份 + 按岸线裁出来的陆地那一份"叠起来 —— 岸线按屏幕像素画,放大多少倍都是一条清楚的边

/** 岸线两侧各一份的像素层(只留一份,换了世界、画法就释放) */
let shoreCache: { raster: Raster; look: SurfaceLook; water: AnyCanvas; land: AnyCanvas } | null = null;

/**
 * 水、陆各一份像素层(用抗锯齿之前的像素):对岸那几个像素换成离它最近的本侧颜色 ——
 * 放大后双线性插值不会把对岸的颜色带过来,两份按岸线拼起来时边上不发虚。
 * 放大到细节层时第一次用到才算(几十毫秒)
 */
export function realisticShoreLayers(r: Raster, look: SurfaceLook = 'classic'): { water: AnyCanvas; land: AnyCanvas } {
  if (shoreCache?.raster === r && shoreCache.look === look) return shoreCache;
  if (shoreCache) shoreCache.water.width = shoreCache.water.height = shoreCache.land.width = shoreCache.land.height = 0;
  realisticBase(r, look);
  const sides = shoreSides(base!.raw ?? paintRealistic(rawSink, r, undefined, true, undefined, look)!, r);
  const layer = (px: Uint8ClampedArray) => {
    const cv = makeCanvas(r.w, r.h);
    (cv.getContext('2d') as CanvasRenderingContext2D).putImageData(new ImageData(px, r.w, r.h), 0, 0);
    return cv;
  };
  shoreCache = { raster: r, look, water: layer(sides.water), land: layer(sides.land) };
  return shoreCache;
}

/**
 * 放大后的细节层(render/detail.ts 的 drawTerrainDetail)第一次画要用的缓存,拆成几步在后台分帧算(见 render/common.ts 的 PrepStep):
 * 小溪(creeks = false 时细节层不画小溪,不用算)、岸线两侧各一份的像素层。做过的再调直接返回,画面和画的时候现算的一样
 */
export function realisticDetailPrep(world: World, r: Raster, creeks = true, look: SurfaceLook = 'classic'): PrepStep[] {
  return [...(creeks ? [() => void riversOf(world, 2)] : []), () => void realisticShoreLayers(r, look)];
}

/**
 * 纯计算(单测用):抗锯齿之前的像素(RGBA)→ 水、陆两份(见 realisticShoreLayers)。
 * 只改岸边两圈:第 1 圈 = 水陆都有的 2×2 块里的像素(放大后双线性插值只用到这些),第 2 圈 = 它们的 8 邻域
 * (缩放倍数不大时,岸线抗锯齿的那一个屏幕像素可能取到隔壁一格)。每一份里,对岸的像素一圈一圈填上
 * 8 邻域里本侧(或已经填好的)像素的平均色;海和湖算一边
 */
export function shoreSides(px: Uint8ClampedArray, r: Pick<Raster, 'w' | 'h' | 'water'>): { water: Uint8ClampedArray; land: Uint8ClampedArray } {
  const { w, h, water } = r;
  const ring = new Uint8Array(w * h);
  const rings: number[][] = [[], []];
  const add = (j: number, n: number) => {
    if (ring[j]) return;
    ring[j] = n;
    rings[n - 1].push(j);
  };
  for (let y = 0; y < h; y++) {
    const r0 = y * w;
    const r1 = (y < h - 1 ? y + 1 : y) * w;
    for (let x = 0; x < w; x++) {
      const x1 = x < w - 1 ? x + 1 : 0;
      const l = water[r0 + x] === 0;
      if ((water[r0 + x1] === 0) === l && (water[r1 + x] === 0) === l && (water[r1 + x1] === 0) === l) continue;
      add(r0 + x, 1);
      add(r0 + x1, 1);
      add(r1 + x, 1);
      add(r1 + x1, 1);
    }
  }
  const nb = new Int32Array(8);
  for (const k of rings[0]) {
    const m = neighbours(k, w, h, nb);
    for (let q = 0; q < m; q++) add(nb[q], 2);
  }
  const side = (land: boolean) => {
    const out = new Uint8ClampedArray(px.length);
    out.set(px);
    // 对岸的像素:1 = 已填好(上一圈),2 = 这一圈刚填
    const done = new Uint8Array(w * h);
    for (const list of rings) {
      for (const k of list) {
        if ((water[k] === 0) === land) continue;
        let sr = 0;
        let sg = 0;
        let sb = 0;
        let n = 0;
        const m = neighbours(k, w, h, nb);
        for (let q = 0; q < m; q++) {
          const j = nb[q];
          if ((water[j] === 0) !== land && done[j] !== 1) continue;
          sr += out[j * 4];
          sg += out[j * 4 + 1];
          sb += out[j * 4 + 2];
          n++;
        }
        if (!n) continue;
        out[k * 4] = sr / n;
        out[k * 4 + 1] = sg / n;
        out[k * 4 + 2] = sb / n;
        done[k] = 2;
      }
      for (const k of list) if (done[k] === 2) done[k] = 1;
    }
    return out;
  };
  return { water: side(false), land: side(true) };
}

/** 像素 k 的 8 邻域(东西相连,上下到边为止)写进 out,返回几个 */
function neighbours(k: number, w: number, h: number, out: Int32Array): number {
  const x = k % w;
  const y = (k - x) / w;
  const lf = x > 0 ? -1 : w - 1;
  const rt = x < w - 1 ? 1 : 1 - w;
  let n = 0;
  for (let dy = y > 0 ? -1 : 0; dy <= (y < h - 1 ? 1 : 0); dy++) {
    const row = k + dy * w;
    out[n++] = row + lf;
    if (dy) out[n++] = row;
    out[n++] = row + rt;
  }
  return n;
}

/** 只借用 createImageData / putImageData(不碰画布):重算一遍抗锯齿之前的像素用 */
const rawSink = {
  createImageData: (w: number, h: number) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }),
  putImageData: () => {},
} as unknown as CanvasRenderingContext2D;

/**
 * 画路径用到的两个方法(Path2D、画布都有;单测里可以换成记录点的对象)。
 * 每一块不调 closePath:填充、裁剪时没闭合的小块自动按闭合算,而 Chromium 里 closePath 的耗时随路径里已有的块数增长
 * (几万块要几秒)
 */
export interface PathSink {
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
}

/**
 * 方格 → 画布:第 y 行方格夹在像素行 y、y + 1 的中心之间(y = −1 … h − 1;最上、最下一行把图边那半个像素也盖上),
 * 第 i 列夹在像素列 i、i + 1 的中心之间(i 展开的,取像素时取模)。
 *   at(世界 y) = 这条纬线上像素列 i(可以是小数)画在画布的 x = a + b·i,y = c(写进 out = [a, b, c])
 *   cols(y) = 第 y 行方格要走哪几列 [i0, i1](null = 这一行不在画布上)
 */
export interface CellMap {
  rows: [number, number];
  cols(y: number): [number, number] | null;
  at(wy: number, out: Float64Array): void;
}

/**
 * 陆地的范围(加进 path):逐个方格(四角是相邻四个像素的中心)取陆地那一块 —— 四角里陆地的角、水陆不同的边上的交点依次连起来
 * (两个对角是陆地的方格,两块陆地连着,和手绘风海岸墨线的走法一样)。交点:海岸按海拔过零处插值(和海岸墨线同一个位置),
 * 湖岸按模糊过的湖泊掩膜过 0.5 处(和像素层的湖岸抗锯齿一样)。整格都是陆地的,一行里连着的合成一块。
 * 所有小块都是同一个转向、只在边上相接:按非零规则填充 / 裁剪就是整块陆地,块与块之间没有缝
 */
export function addLandCells(path: PathSink, r: Raster, m: CellMap): void {
  const { w, h, water, scale: S } = r;
  const T = new Float64Array(3);
  const B = new Float64Array(3);
  const M = new Float64Array(3);
  // 一块陆地的下一个点(第一个点 moveTo)
  let first = true;
  const pt = (x: number, y: number) => {
    if (first) path.moveTo(x, y);
    else path.lineTo(x, y);
    first = false;
  };
  // 竖边上的交点:世界 y 在上下两行像素中心之间,第 i 列
  const sidePt = (wy: number, i: number) => {
    m.at(wy, M);
    pt(M[0] + M[1] * i, M[2]);
  };
  for (let y = Math.max(-1, m.rows[0]); y <= Math.min(h - 1, m.rows[1]); y++) {
    const cr = m.cols(y);
    if (!cr) continue;
    const rowA = (y < 0 ? 0 : y) * w;
    const rowB = (y + 1 > h - 1 ? h - 1 : y + 1) * w;
    const wy0 = (y + 0.5) / S;
    m.at(wy0, T);
    m.at((y + 1.5) / S, B);
    const [i0, i1] = cr;
    let x0 = i0 % w;
    if (x0 < 0) x0 += w;
    let run = NaN;
    for (let i = i0; i <= i1 + 1; i++, x0 = x0 + 1 === w ? 0 : x0 + 1) {
      const x1 = x0 + 1 === w ? 0 : x0 + 1;
      const ka = rowA + x0;
      const kb = rowA + x1;
      const kc = rowB + x1;
      const kd = rowB + x0;
      const a = water[ka] === 0;
      const b = water[kb] === 0;
      const c = water[kc] === 0;
      const d = water[kd] === 0;
      const full = i <= i1 && a && b && c && d;
      if (full) {
        if (run !== run) run = i;
        continue;
      }
      if (run === run) {
        // 连着的整格陆地:一个四边形(弯边投影里上下两条纬线长短不同)
        path.moveTo(T[0] + T[1] * run, T[2]);
        path.lineTo(T[0] + T[1] * i, T[2]);
        path.lineTo(B[0] + B[1] * i, B[2]);
        path.lineTo(B[0] + B[1] * run, B[2]);
        run = NaN;
      }
      if (i > i1 || !(a || b || c || d)) continue;
      // 水陆都有的方格:左上 → 右上 → 右下 → 左下(和整格的转向一样)
      first = true;
      if (a) pt(T[0] + T[1] * i, T[2]);
      if (a !== b) pt(T[0] + T[1] * (i + shoreT(r, ka, kb)), T[2]);
      if (b) pt(T[0] + T[1] * (i + 1), T[2]);
      if (b !== c) sidePt(wy0 + shoreT(r, kb, kc) / S, i + 1);
      if (c) pt(B[0] + B[1] * (i + 1), B[2]);
      if (c !== d) pt(B[0] + B[1] * (i + shoreT(r, kd, kc)), B[2]);
      if (d) pt(B[0] + B[1] * i, B[2]);
      if (d !== a) sidePt(wy0 + shoreT(r, ka, kd) / S, i);
    }
  }
}

/**
 * 水陆不同的两个相邻像素 ka(左 / 上)、kb(右 / 下)之间,岸线在哪(从 ka 量起的比例):
 * 海岸 = 海拔过零处(同手绘风的海岸墨线);湖岸 = 模糊过的湖泊掩膜过 0.5 处(同像素层的湖岸抗锯齿),对不上像素的归类就取中点
 */
export function shoreT(r: Raster, ka: number, kb: number): number {
  const { water, elev, w, h } = r;
  if (water[ka] === 2 || water[kb] === 2) {
    const fa = lakeField(water, w, h, ka % w, Math.floor(ka / w)) - 0.5;
    const fb = lakeField(water, w, h, kb % w, Math.floor(kb / w)) - 0.5;
    if (fa > 0 !== (water[ka] === 2) || fb > 0 !== (water[kb] === 2) || fa === fb) return 0.5;
    return Math.max(0.1, Math.min(0.9, fa / (fa - fb)));
  }
  const ea = elev[ka];
  const eb = elev[kb];
  return ea < 0 !== eb < 0 && ea !== eb ? Math.max(0.02, Math.min(0.98, ea / (ea - eb))) : 0.5;
}

/** 整张图的陆地范围(等距圆柱;只留一份,换了世界就重建) */
let landPathCache: { raster: Raster; path: Path2D } | null = null;

/**
 * 整张图的陆地范围,坐标是像素层的像素(第 i 列像素中心在 x = i + 0.5)。列取 −2 … w:细节层画布按 180° 经线
 * 分段画(ui/TerrainDetail.tsx),每一段用到的方格都在这里面
 */
function wholeLandPath(r: Raster): Path2D {
  if (landPathCache?.raster === r) return landPathCache.path;
  const path = new Path2D();
  const S = r.scale;
  addLandCells(path, r, {
    rows: [-1, r.h - 1],
    cols: () => [-2, r.w],
    at: (wy, out) => {
      out[0] = 0.5;
      out[1] = 1;
      out[2] = wy * S;
    },
  });
  landPathCache = { raster: r, path };
  return path;
}

/** 等距圆柱的细节层画布(画布 = 世界 × v.s + (v.ox, v.oy))上的方格范围 */
function flatCells(r: Raster, v: { s: number; ox: number; oy: number }, cw: number, ch: number): CellMap {
  const S = r.scale;
  const ps = v.s / S;
  const iA = Math.floor(((0 - v.ox) / v.s) * S - 1.5);
  const iB = Math.ceil(((cw - v.ox) / v.s) * S - 0.5);
  return {
    rows: [Math.floor(((0 - v.oy) / v.s) * S - 1.5), Math.ceil(((ch - v.oy) / v.s) * S - 0.5)],
    cols: () => [iA, iB],
    at: (wy, out) => {
      out[0] = v.ox + 0.5 * ps;
      out[1] = ps;
      out[2] = wy * v.s + v.oy;
    },
  };
}

/** 弯边投影的细节层画布(画布 = 地图平面 × v.s + (v.ox, v.oy))上的方格范围:每一行按这条纬线反算看得见的经度 */
function projectedCells(r: Raster, pj: Projector, v: { s: number; ox: number; oy: number }, cw: number, ch: number): CellMap {
  const { w, scale: S } = r;
  const { W } = pj;
  const lam0 = (pj.mp.lon0 * Math.PI) / 180;
  // 第 i 列像素中心的经度差(展开的):rel = i·du + r0
  const du = (2 * Math.PI) / w;
  const r0 = 0.5 * du - Math.PI - lam0;
  const mxL = (0 - v.ox) / v.s;
  const mxR = (cw - v.ox) / v.s;
  const myT = (0 - v.oy) / v.s;
  const myB = (ch - v.oy) / v.s;
  return {
    rows: [-1, r.h - 1],
    cols: (y) => {
      const wa = (y + 0.5) / S;
      const wb = (y + 1.5) / S;
      if (pj.Y(wb) < myT || pj.Y(wa) > myB) return null;
      const K = Math.min(pj.K(wa), pj.K(wb));
      const relA = K > 1e-9 ? Math.max(-Math.PI, (mxL - W / 2) / K) : -Math.PI;
      const relB = K > 1e-9 ? Math.min(Math.PI, (mxR - W / 2) / K) : Math.PI;
      if (relB < relA) return null;
      return [Math.floor((relA - r0) / du) - 1, Math.ceil((relB - r0) / du)];
    },
    at: (wy, out) => {
      const K = pj.K(wy);
      out[0] = (W / 2 + K * r0) * v.s + v.ox;
      out[1] = K * du * v.s;
      out[2] = pj.Y(wy) * v.s + v.oy;
    },
  };
}

/**
 * 一个像素层像素放大到不足这么多个画布像素时,直接铺像素层:放大插值的过渡不比岸线抗锯齿宽多少,
 * 拼两份(全图几十万个路径点)不划算
 */
const SHORE_MIN_PS = 2.5;
/** 放大后按岸线描的海岸线(地图册)有多宽(画布像素;水那一侧露出一半) */
const COAST_PX = 3;

/**
 * 放大后的实景像素层(细节层):先铺水那一份,再按陆地范围(addLandCells)裁出陆地那一份铺上 —— 岸线按屏幕像素画,不发虚。
 * 等距圆柱:像素层按视口变换放大贴上(双线性);弯边投影(v.proj):按行重投影(reprojectImage)
 */
export function drawRealisticShores(ctx: CanvasRenderingContext2D, r: Raster, v: VecView, look: SurfaceLook = 'classic'): void {
  drawParts(ctx, realisticShoreParts(r, v, look));
}

/** drawRealisticShores 分两下画:水那一份、裁出来的陆地那一份(画法状态和一口气画时一样;依次画完逐像素一样) */
export function realisticShoreParts(r: Raster, v: VecView, look: SurfaceLook = 'classic'): DrawPart[] {
  const pj = v.proj;
  const ps = v.s / r.scale;
  const put = (ctx: CanvasRenderingContext2D, img: AnyCanvas) => {
    if (pj) reprojectImage(ctx, img, r.w, r.h, pj.mp, v, 'low');
    else ctx.drawImage(img, v.ox, v.oy, r.w * ps, r.h * ps);
  };
  const begin = (ctx: CanvasRenderingContext2D) => {
    ctx.save();
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'low';
  };
  if (ps < SHORE_MIN_PS)
    return [
      (ctx) => {
        begin(ctx);
        put(ctx, realisticBase(r, look));
        ctx.restore();
      },
    ];
  return [
    (ctx) => {
      begin(ctx);
      put(ctx, realisticShoreLayers(r, look).water);
      ctx.restore();
    },
    (ctx) => {
      begin(ctx);
      const cw = ctx.canvas.width;
      const ch = ctx.canvas.height;
      const cells = pj ? projectedCells(r, pj, v, cw, ch) : flatCells(r, v, cw, ch);
      const cols = pj ? null : cells.cols(0)!;
      // 地图册的海岸线:先沿陆地范围描一道(线宽的一半在水那一侧),再铺陆地那一份盖掉陆上的一半 —— 按屏幕像素描,放大多少倍都是一条细线。
      // 陆地范围是一格一格拼起来的,格与格之间的边也会描上,都在陆地里面,被陆地那一份盖住
      const coast = MATERIALS[look].coast;
      const line = (path: Path2D, k: number) => {
        if (!coast) return;
        ctx.strokeStyle = `rgba(${coast[0].join(',')},${coast[1]})`;
        ctx.lineWidth = COAST_PX / k;
        ctx.lineJoin = 'round';
        ctx.stroke(path);
      };
      if (cols && (cols[1] - cols[0]) * (cells.rows[1] - cells.rows[0]) * 8 > r.w * r.h) {
        // 等距圆柱、视口里的方格多(放大不到三倍左右):用整张图的那一份(缓存的)按视口变换裁剪,省得每次重画重算几十万个点
        const m = ctx.getTransform();
        ctx.transform(ps, 0, 0, ps, v.ox, v.oy);
        line(wholeLandPath(r), ps);
        ctx.clip(wholeLandPath(r));
        ctx.setTransform(m);
      } else {
        const path = new Path2D();
        addLandCells(path, r, cells);
        line(path, 1);
        ctx.clip(path);
      }
      put(ctx, realisticShoreLayers(r, look).land);
      ctx.restore();
    },
  ];
}

/**
 * 地球仪用的两张图(见 realisticGlobeMaps):不打光的底色(RGBA),和每个像素的坡度(RGBA 四个通道,见 encodeSlope):
 *   - RG:细节晕渲的坡度(东、南;已乘上平原压平、软阈值那两个系数),着色器里权重 reliefWeights 的 detail
 *   - BA:大尺度晕渲的坡度(陆地是地面、海是海底;海冰按冰的多少压平),权重陆地 macro、开阔水面 sea
 *     (着色器按水面蒙版挑;蒙版挑的和这里不一样的,坡度先按两个权重的比换算好)
 * 平面主图的明暗 s = 1 + Σ 权重 × (这一样的晕渲 − 1),每样晕渲按固定的西北光算;着色器按同样的公式、只是光换成
 * "屏幕左上方"算 —— 地球仪正中、北在上时和平面主图一样,转到两极也不会光从背后来
 */
interface GlobeCapture {
  albedo: Uint8ClampedArray;
  slope: Uint8Array;
}

/** 坡度编码到 0–255 的上限(再陡按它算) */
export const SLOPE_MAX = 12;
/** 着色器里几样晕渲的权重、暗面压暗多少、往天空冷色里混多少(和这种画法的平面主图一样) */
export function reliefWeights(look: SurfaceLook = 'classic'): { detail: number; macro: number; sea: number; shadow: number; cool: number } {
  const m = MATERIALS[look];
  return { detail: m.detailW, macro: m.macroW, sea: m.seaRelief, shadow: m.shadowDepth, cool: m.cool ?? SHADOW_COOL };
}

/** 坡度 → 一个字节:128 = 平;按平方根压缩(缓坡的精度高,陡坡粗一点) */
function encodeSlope(g: number): number {
  const v = g >= 0 ? Math.sqrt(Math.min(1, g / SLOPE_MAX)) : -Math.sqrt(Math.min(1, -g / SLOPE_MAX));
  return Math.round(127.5 + 127.5 * v);
}

/** 字节 → 坡度(单测、CPU 画法用;着色器里是同样的公式) */
export function decodeSlope(b: number): number {
  const v = (b / 255) * 2 - 1;
  return (v < 0 ? -v * v : v * v) * SLOPE_MAX;
}

/** 平面图的光:西北来(x 东、y 南、z 上),和 hillshade 一样 */
const LIGHT_XY = Math.SQRT2 / Math.hypot(1, 1, 1.3);
const LIGHT_Z = 1.3 / Math.hypot(1, 1, 1.3);

/**
 * 地球仪的写实贴图:不打光的底色(含河流)+ 坡度(RGBA,和像素图一样大,见 GlobeCapture)。
 * 着色器按屏幕方向(光从左上)重新打光,明暗的曲线和平面主图一样(见 render/globe.ts 的 relief)。
 * 要把整张图的明暗重算一遍(主图那么大约 0.3 秒),在后台线程里画(globeWorker.ts)
 */
export function realisticGlobeMaps(world: World, r: Raster, look: SurfaceLook = 'classic'): { albedo: AnyCanvas; slope: Uint8Array } {
  const cv = makeCanvas(r.w, r.h);
  const ctx = cv.getContext('2d') as CanvasRenderingContext2D;
  const px = realisticGlobePixels(r, look);
  ctx.putImageData(new ImageData(px.albedo, r.w, r.h), 0, 0);
  drawRealisticRivers(ctx, world, r, bakedView(r.scale), true, look);
  return { albedo: cv, slope: px.slope };
}

/** 纯计算(单测用):整张像素层的像素(和 realisticBase 一样)和水陆交界抗锯齿之前的那一份 */
export function realisticPixels(r: Raster, look: SurfaceLook = 'classic'): { px: Uint8ClampedArray; raw: Uint8ClampedArray } {
  let px: Uint8ClampedArray | null = null;
  const sink = {
    createImageData: (w: number, h: number) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }),
    putImageData: (img: { data: Uint8ClampedArray }) => {
      px = img.data;
    },
  } as unknown as CanvasRenderingContext2D;
  const raw = paintRealistic(sink, r, undefined, true, r.win ? undefined : macroGrids(r), look)!;
  return { px: px!, raw };
}

/**
 * 纯计算(Node 里也能跑,单测用):平面主图的像素(打好光的,和 realisticBase 一样)、地球仪的不打光底色、坡度(RGBA 交错,见 GlobeCapture)
 */
export function realisticGlobePixels(r: Raster, look: SurfaceLook = 'classic'): { shaded: Uint8ClampedArray; albedo: Uint8ClampedArray; slope: Uint8Array } {
  let shaded: Uint8ClampedArray | null = null;
  // 只借用 createImageData / putImageData 两个方法(不碰画布)
  const sink = {
    createImageData: (w: number, h: number) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }),
    putImageData: (img: { data: Uint8ClampedArray }) => {
      shaded = img.data;
    },
  } as unknown as CanvasRenderingContext2D;
  const cap: GlobeCapture = { albedo: new Uint8ClampedArray(r.w * r.h * 4), slope: new Uint8Array(r.w * r.h * 4) };
  paintRealistic(sink, r, cap, false, undefined, look);
  antialiasShores(cap.albedo, r);
  return { shaded: shaded!, albedo: cap.albedo, slope: cap.slope };
}

/**
 * 放大后现算的一块(gen/rasterWindow.ts)上色:和整张图同一套画法(不含河),大尺度晕渲按整张图的粗网格(macroGrids)取样。
 * 返回 RGBA 像素(已做水陆交界抗锯齿);四周 WINDOW_PAD 个像素邻居不全,调用方裁掉
 */
export function realisticWindowPixels(r: Raster, grids: MacroGrids, look: SurfaceLook = 'classic'): Uint8ClampedArray {
  let out: Uint8ClampedArray | null = null;
  const sink = {
    createImageData: (w: number, h: number) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }),
    putImageData: (img: { data: Uint8ClampedArray }) => {
      out = img.data;
    },
  } as unknown as CanvasRenderingContext2D;
  paintRealistic(sink, r, undefined, false, grids, look);
  return out!;
}

/**
 * cap:地球仪要的底色和等效坡度也顺手记下来(不给 = 只画平面主图,画出来的一样)。
 * keepRaw:返回水陆交界抗锯齿之前的像素(一份拷贝)
 */
function paintRealistic(ctx: CanvasRenderingContext2D, r: Raster, cap?: GlobeCapture, keepRaw = false, grids?: MacroGrids, look: SurfaceLook = 'classic'): Uint8ClampedArray | null {
  const { w, h, elev, water, temp, precip, ice: iceCover, iceConc, iceTone } = r;
  const m = MATERIALS[look];
  const { rock: ROCK, lake: LAKE, rockE0: ROCK_E0, rockE1: ROCK_E1, rockEW: ROCK_EW, detailW: DETAIL_W, macroW: MACRO_W, seaRelief: SEA_RELIEF, shadowDepth: SHADOW_DEPTH } = m;
  const { detailFlat: DETAIL_FLAT, soft0: SOFT0, soft1: SOFT1, snowFlat: SNOW_FLAT, flat: FLAT } = m;
  const { texAmpWet: TEX_AMP_WET, texAmpDry: TEX_AMP_DRY, texGeo: TEX_GEO, texFine: TEX_FINE, texStreak: TEX_STREAK, geoSharp: GEO_SHARP } = m;
  const { texCav: TEX_CAV, ecoP: ECO_P, valleyDark: VALLEY_DARK } = m;
  const MODEL = m.model ?? 'biome';
  const COOL = m.cool ?? SHADOW_COOL;
  const BAND_LINE = m.bandLine ?? 0;
  const STIP = !!m.stipple;
  const REEF = !!m.reef;
  const MUTE = m.mute ?? 0;
  // 海色在相邻两档之间按深度插值(浅海几米里颜色变得最快,取整档会一圈圈);地图册的海本来就是分层的,不插值
  const OCEAN_LERP = MODEL !== 'hypso';
  // 放大后的河口(见 gen/estuary.ts):浑水、喇叭口里往河水的颜色过渡;
  // 地图册不画这两样,只给补到海的那一段河道、三角洲的水道上河水的颜色(不然是一道海色的沟)
  const PLUME_C = m.plume && !FLAT ? m.plume : null;
  const PLUME = PLUME_C ? r.plume : undefined;
  const RIVT = FLAT ? undefined : PLUME_C ? r.rivTint : r.rivCore;
  const RIVER_C = RIVT ? cssRGB(m.river.color) : null;
  const RIP_K = m.ripK ?? 1;
  // 打光用的地面:海拔 + 山坡上的沟和山脊(只管明暗,见 Raster.gully)
  const relief = reliefOf(r);
  // 细节晕渲(沟壑纹理)+ 大尺度晕渲(整条山脉的明暗面)+ 海底晕渲
  const shade = hillshade(relief === elev ? r : { ...r, elev: relief }, 0.012, 0);
  // 放大后现算的一块(r.win):大尺度晕渲按整张图的那一份取样,纹理按整张图上的位置取(和整张图、相邻的块都接得上)
  const win = r.win;
  const { shade: macro, level, gx: mgx, gy: mgy } = grids ? macroUpsample(grids, r) : macroShade(r, !!cap);
  const zd = 0.012 * r.scale;
  const alb = cap?.albedo;
  const slo = cap?.slope;
  const lut = biomePalette(look);
  const ocean = oceanLut(look);
  const slopeZ = 0.5 * 0.012 * r.scale; // 中心差分 / 2,与细节晕渲同一夸张系数
  // 整张图的宽高(像素)和这张图的像素 → 整张图像素的换算:x' = (x + x0 + 0.5) × fx − 0.5
  const W0 = win ? grids!.w : w;
  const fx = win ? W0 / win.W : 1;
  const fy = win ? grids!.h / win.H : 1;
  const wx0 = win ? win.x0 : 0;
  const wy0 = win ? win.y0 : 0;
  // 同样大小的一块(编辑地形后按块重画,见 realisticPatch):过了右边的列按整张图接回左边算,和整张图那一列逐位相同
  const colOf = win && win.W === W0 ? (px: number) => (wx0 + px >= W0 ? wx0 + px - W0 : wx0 + px) : (px: number) => wx0 + px;
  // 地面纹理、群落交界打散:按世界坐标取(整张图、放大现算的块接得上),细的几层放大后才叠
  const pxW = 1 / r.scale;
  const Ww = (win ? win.W : w) / r.scale;
  const wxOf = (px: number) => (colOf(px) + 0.5) / r.scale;
  const bank = r.bank;
  const vein = r.vein;
  const geo = new RowNoise(GEO_OCT, 101, w, wxOf, Ww, pxW);
  const fine = new RowNoise(FINE_OCT, 201, w, wxOf, Ww, pxW, 1, TEX_BIG_PX);
  const streak = new RowNoise(STREAK_OCT, 301, w, wxOf, Ww, pxW, STREAK_SX, TEX_BIG_PX);
  // 雪线的抖动:平滑噪声(高纬度大片地方气温都在雪线附近,值噪声会露出一格一格)
  const snowN = win ? cylinderNoise(11, W0, 5, Float64Array.from({ length: w }, (_, px) => (colOf(px) + 0.5) * fx)) : cylinderNoise(11, w, 5);

  const col: RGB = [0, 0, 0];
  // 陆地像素:颜色写进 col,返回打光的明暗 s;地球仪的细节坡度写进 dg[0..1],积雪上明暗减弱的系数写进 dg[2]。
  // 单独一个函数(主循环太大,引擎第一次画时优化得慢)
  const dg = new Float64Array(3);
  const land = (k: number, px: number, py: number, e: number, s: number, gxk: number, ty: number): number => {
    const kr = px < w - 1 ? k + 1 : k - w + 1;
    const kl = px > 0 ? k - 1 : k + w - 1;
    const kd = py < h - 1 ? k + w : k;
    const ku = py > 0 ? k - w : k;
    const pk = precip[k];
    // 地面纹理(约 −1 ~ 1):大片的岩性(压出边界)+ 细层
    const fn = fine.v[px];
    const dry = smoothstep(RIP_P1, RIP_P0, pk);
    // 干旱地方岩石裸露,斑块边界更硬、更碎(像石漠里一块块的露头);有植被的地方软一些
    const tx = TEX_GEO * softClip((GEO_SHARP + GEO_SHARP_DRY * dry) * (geo.v[px] + (GEO_ROUGH + GEO_ROUGH_DRY * dry) * fn)) + TEX_FINE * fn + (dry > 0 ? TEX_STREAK * dry * streak.v[px] : 0);
    // 离河多近:谷底压暗;干旱地方的河岸那一窄条按湿润的颜色画(像沙漠里的尼罗河)
    const bk = bank ? bank[k] / 255 : 0;
    // 离河远的(大多数地方)bk = 0,下面几项都是 0,跳过不算
    const rip = bk > 0 && dry > 0 && RIP_K > 0 ? smoothstep(RIP_B0 + RIP_JAG * fn, RIP_B1, bk) * dry * RIP_K : 0;
    // 1. 生物群落底色:按 温度 × 降水 查连续调色板,群落之间自然渐变;交界按纹理打散成一片片(亮处当作干一点)
    const ex = -ECO_P * tx;
    let pp = pk * (1 + ex * (1 + ex * (0.5 + ex / 6))); // e^ex(|ex| 不到 0.3,展开到三次就够)
    // 细沟:干旱地方沟里湿一点(带点绿)
    const vn = vein && vein[k] > 0 ? (vein[k] / 255) * (1 - smoothstep(VEIN_E0, VEIN_E1, level[k])) : 0;
    const vc = vn > 0 ? smoothstep(VEIN_C0 + RIP_JAG * fn, VEIN_C1, vn) : 0;
    if (vc > 0 && dry > 0) pp *= 1 + (VEIN_WET - 1) * vc * dry;
    if (rip > 0 && pp < RIP_WET) pp *= Math.pow(RIP_WET / pp, rip);
    // 2. 在这一格的色带上挑深浅:纹理(干旱地方对比更强),再加上凹处(谷)亮、凸处(脊)暗
    const cav = (relief[kl] + relief[kr] + relief[ku] + relief[kd]) * 0.25 - relief[k];
    const tb = 0.5 + (TEX_AMP_WET + (TEX_AMP_DRY - TEX_AMP_WET) * dry) * tx + TEX_CAV * Math.max(-1, Math.min(1, cav / (CAV_REF * pxW))) + (bk > ALLU_B0 ? ALLU_LIGHT * smoothstep(ALLU_B0, ALLU_B1, bk) : 0) + (vn > 0 ? VEIN_LIGHT * smoothstep(0.02, 0.3, vn) * (1 - vc) : 0);
    if (MODEL === 'hypso') {
      // 分层设色:按海拔挑层;和右、下邻格不在一层的描一条细线(陆地上)
      const b = hypsoBand(e);
      const hc = HYPSO[b];
      const ln = BAND_LINE > 0 && ((water[kr] === 0 && hypsoBand(elev[kr]) !== b) || (water[kd] === 0 && hypsoBand(elev[kd]) !== b)) ? 1 - BAND_LINE : 1;
      // 低处按干湿混色(Natural Earth 的 cross-blended hypso):干旱的平原、低高原偏沙黄,湿润的照绿;1000 米以上渐渐只看海拔
      const ak = 0.85 * smoothstep(0.35, 0.95, dry) * (1 - smoothstep(900, 2200, e));
      col[0] = (hc[0] + (HYPSO_ARID[0] - hc[0]) * ak) * ln;
      col[1] = (hc[1] + (HYPSO_ARID[1] - hc[1]) * ak) * ln;
      col[2] = (hc[2] + (HYPSO_ARID[2] - hc[2]) * ak) * ln;
      if (MUTE > 0) {
        // 叠填色时褪色:换成按亮度的暖灰(留明暗和层次,颜色让给填色)
        const yl = 0.3 * col[0] + 0.59 * col[1] + 0.11 * col[2];
        const g = 120 + yl * 0.55;
        col[0] += (g - col[0]) * MUTE;
        col[1] += (g - col[1]) * MUTE;
        col[2] += (g * 0.97 - col[2]) * MUTE;
      }
    } else if (MODEL === 'photo') photoColor(temp[k] + ECO_T * tx, pp, tb, geo.v[px], col);
    else paletteColor(lut, temp[k] + ECO_T * tx, pp, tb, col);
    // 降水多更深;谷底压暗
    const low = level[k] - relief[k];
    const v = MODEL === 'hypso' ? 1 : (1.03 - Math.min(0.12, pk / 25000)) * (low > VALLEY_E0 ? 1 - VALLEY_DARK * smoothstep(VALLEY_E0, VALLEY_E1, low) : 1) * (1 - VEIN_DARK * (m.veinK ?? 1) * vc);
    let cr = col[0] * v;
    let cg = col[1] * v;
    let cb = col[2] * v;
    // 高山 / 陡坡:裸岩。坡度直接按海拔梯度算(和光照方向无关),
    // 不再用"明暗偏离平地多少"来估计 —— 那样背光面一律被当成陡坡,暗面会发灰
    const gx = (relief[kr] - relief[kl]) * gxk;
    const gy = relief[kd] - relief[ku];
    const steep = Math.sqrt(gx * gx + gy * gy) * slopeZ;
    const rock = MODEL === 'hypso' ? 0 : Math.min(0.85, smoothstep(ROCK_E0, ROCK_E1, e) * ROCK_EW + smoothstep(0.9, 2.2, steep) * 0.45);
    cr += (ROCK[0] - cr) * rock;
    cg += (ROCK[1] - cg) * rock;
    cb += (ROCK[2] - cb) * rock;
    // 积雪:按像素温度(已含海拔递减)
    const sn = 0.5 + 0.5 * snowN(px, ty);
    const snow = smoothstep(-2, -7, temp[k] + 3 * (sn - 0.5));
    const SN = MODEL === 'hypso' ? HYPSO_SNOW : SNOW;
    cr += (SN[0] - cr) * snow;
    cg += (SN[1] - cg) * snow;
    cb += (SN[2] - cb) * snow;
    // 地图册的沙漠符号:每 5×5 像素一格里随机一个点(按这张图的像素取,放大后点的大小、疏密在屏幕上不变)
    if (STIP && dry > 0.45 && snow < 0.5) {
      const gxp = colOf(px);
      const gyp = wy0 + py;
      const cx = Math.floor(gxp / 5);
      const cy = Math.floor(gyp / 5);
      const ox = gxp - cx * 5 - ((hash2(cx, cy, 77) * 5) | 0);
      const oy = gyp - cy * 5 - ((hash2(cx, cy, 78) * 5) | 0);
      if (ox === 0 && oy === 0 && hash2(cx, cy, 79) < smoothstep(0.45, 0.9, dry)) {
        cr += (STIPPLE[0] - cr) * 0.65;
        cg += (STIPPLE[1] - cg) * 0.65;
        cb += (STIPPLE[2] - cb) * 0.65;
      }
    }
    col[0] = cr;
    col[1] = cg;
    col[2] = cb;
    // 细节晕渲:平原上的小起伏压平(按大范围平均海拔:低地只留一成多,山地全留),
    // 再把很小的明暗起伏软阈值掉(平原上的"皱纹"),陡坡的沟壑照样清楚
    const dd = s - 1;
    const ad = dd < 0 ? -dd : dd;
    const keep = DETAIL_FLAT + (1 - DETAIL_FLAT) * smoothstep(DETAIL_E0, DETAIL_E1, level[k]);
    let s2 = 1 + dd * DETAIL_W * keep * smoothstep(SOFT0, SOFT1, ad) + (macro[k] - 1) * MACRO_W;
    // 积雪 / 冰盖上的明暗减弱(冰原不出大块的灰色拼块)
    const snowK = SNOW_FLAT > 0 ? 1 - SNOW_FLAT * snow : 1;
    if (SNOW_FLAT > 0) s2 = 1 + (s2 - 1) * snowK;
    if (slo) {
      // 细节晕渲的坡度(和 hillshade 同一个算法),乘上平原压平、软阈值两个系数(软阈值按坡度大小算,和光从哪边来无关)
      const dx = gx * 0.5 * zd;
      const dy = gy * 0.5 * zd;
      const wd = keep * smoothstep(SOFT0, SOFT1, (Math.sqrt(dx * dx + dy * dy) * LIGHT_XY) / LIGHT_Z);
      // 地球仪的坡度也按积雪减弱,雪山在地球仪上和平面图一样平
      dg[0] = dx * wd * snowK;
      dg[1] = dy * wd * snowK;
      dg[2] = snowK;
    }
    return s2;
  };

  const img = ctx.createImageData(w, h);
  const d = img.data;
  // 每行的陆地一段段([起, 止) 成对):纹理只在这些像素上一层层算好
  const runs = new Int32Array(w + 2);
  for (let py = 0; py < h; py++) {
    // 东西向坡度按纬度修正
    const gxk = 1 / Math.max(rasterRowCos(r, py), 0.01);
    // 纹理按整张图的行取
    const ty = win ? (wy0 + py + 0.5) * fy - 0.5 : py;
    const wy = (wy0 + py + 0.5) / r.scale;
    let nr = 0;
    for (let x = 0, row = py * w; x < w; ) {
      while (x < w && water[row + x] !== 0) x++;
      if (x >= w) break;
      runs[nr++] = x;
      while (x < w && water[row + x] === 0) x++;
      runs[nr++] = x;
    }
    geo.row(wy, runs, nr);
    fine.row(wy, runs, nr);
    streak.row(wy, runs, nr);
    for (let px = 0; px < w; px++) {
      const k = py * w + px;
      const e = elev[k];
      let c: RGB;
      let s = shade[k];
      // 地球仪:这个像素的细节坡度、大尺度坡度(东、南两个方向;见 GlobeCapture)
      let dgx = 0;
      let dgy = 0;
      let mgxk = 0;
      let mgyk = 0;
      if (water[k] === 1) {
        // 海色查表(每 10 米一格;相邻两格之间按深度插值,浅海不出一圈圈色阶)
        if (OCEAN_LERP && e > OCEAN_MIN && e < 0) {
          const u = (e - OCEAN_MIN) / 10;
          const i0 = u | 0;
          const t = u - i0;
          const i1 = i0 + 1 < OCEAN_N ? i0 + 1 : i0;
          col[0] = ocean[i0 * 3] + (ocean[i1 * 3] - ocean[i0 * 3]) * t;
          col[1] = ocean[i0 * 3 + 1] + (ocean[i1 * 3 + 1] - ocean[i0 * 3 + 1]) * t;
          col[2] = ocean[i0 * 3 + 2] + (ocean[i1 * 3 + 2] - ocean[i0 * 3 + 2]) * t;
        } else {
          const oi = e <= OCEAN_MIN ? 0 : e >= 0 ? OCEAN_N - 1 : ((e - OCEAN_MIN) / 10 + 0.5) | 0;
          col[0] = ocean[oi * 3];
          col[1] = ocean[oi * 3 + 1];
          col[2] = ocean[oi * 3 + 2];
        }
        // 浅暖海(珊瑚礁、浅滩):不到 40 米深、水暖的地方泛青绿(像巴哈马、大堡礁)
        if (REEF && e > -40 && temp[k] > 20) {
          const a = 0.42 * smoothstep(-36, -6, e) * smoothstep(20, 26, temp[k]);
          col[0] += (REEF_C[0] - col[0]) * a;
          col[1] += (REEF_C[1] - col[1]) * a;
          col[2] += (REEF_C[2] - col[2]) * a;
        }
        // 放大后的河口:浑水、河水的颜色往外淡开(见 gen/estuary.ts)
        if (PLUME && PLUME_C) {
          const pa = PLUME[k] / 255;
          if (pa > 0) {
            // 淡的地方偏青(浑水散开、混进海水),浓的地方是泥沙的黄绿
            const q = Math.min(1, pa * 1.6);
            const { near: PN, far: PF } = PLUME_C;
            col[0] += (PF[0] + (PN[0] - PF[0]) * q - col[0]) * pa;
            col[1] += (PF[1] + (PN[1] - PF[1]) * q - col[1]) * pa;
            col[2] += (PF[2] + (PN[2] - PF[2]) * q - col[2]) * pa;
          }
        }
        if (RIVT && RIVER_C) {
          const ta = RIVT[k] / 255;
          if (ta > 0) {
            col[0] += (RIVER_C[0] - col[0]) * ta;
            col[1] += (RIVER_C[1] - col[1]) * ta;
            col[2] += (RIVER_C[2] - col[2]) * ta;
          }
        }
        c = col;
        // 海底晕渲:只看大尺度(洋中脊、海沟、大陆坡),很淡
        s = 1 + (macro[k] - 1) * SEA_RELIEF;
        if (slo) {
          mgxk = mgx![k];
          mgyk = mgy![k];
        }
        // 海冰:铺像素时算好的(和群落分类同一份),画成冰的地方悬停也是"海冰"
        const conc = iceConc[k] / 255;
        if (conc > 0) {
          // 冰区里的开阔水面:碎冰、冰泥让海面发灰
          c = mix(c, SLUSH, 0.5 * smoothstep(0.03, 0.9, conc));
          const ice = iceCover[k];
          if (ice > 0) {
            // 越靠冰缘越是薄薄的新冰(灰蓝),冰盖深处是厚冰(白)
            const tex = 0.955 + 0.06 * (iceTone[k] / 255);
            const ic = mix(ICE_YOUNG, ICE_PACK, smoothstep(0.05, 0.7, conc));
            c = mix(c, [ic[0] * tex, ic[1] * tex, ic[2] * tex], ice);
            s = 1 + (s - 1) * (1 - ice);
            mgxk *= 1 - ice;
            mgyk *= 1 - ice;
          }
        }
        // 着色器按水面蒙版(有冰的一半以上算陆地)挑权重:挑成陆地的,坡度按两个权重的比换算
        if (slo && iceCover[k] >= 0.5) {
          mgxk *= SEA_RELIEF / MACRO_W;
          mgyk *= SEA_RELIEF / MACRO_W;
        }
      } else if (water[k] === 2) {
        c = temp[k] < -6 ? SEA_ICE : LAKE;
        s = 1;
      } else {
        s = land(k, px, py, e, s, gxk, ty);
        c = col;
        if (slo) {
          dgx = dg[0];
          dgy = dg[1];
          mgxk = mgx![k] * dg[2];
          mgyk = mgy![k] * dg[2];
        }
      }
      if (FLAT) {
        // 白模:海按离岸远近两档浅蓝(大陆架浅一些),陆地近白,冰雪纯白;不打光
        const icy = water[k] === 1 ? iceCover[k] >= 0.5 : water[k] === 2 ? temp[k] < -6 : temp[k] < -4;
        c = icy ? FLAT.ice : water[k] === 0 ? FLAT.land : water[k] === 2 ? FLAT.sea : e > -200 ? FLAT.shelf : FLAT.sea;
        s = 1;
        dgx = dgy = mgxk = mgyk = 0;
      }
      if (alb) {
        const o = k * 4;
        alb[o] = c[0];
        alb[o + 1] = c[1];
        alb[o + 2] = c[2];
        alb[o + 3] = 255;
        slo![o] = encodeSlope(dgx);
        slo![o + 1] = encodeSlope(dgy);
        slo![o + 2] = encodeSlope(mgxk);
        slo![o + 3] = encodeSlope(mgyk);
      }
      // 2. 晕渲:亮面提亮;暗面柔和压暗(下限约 0.55)并混入天空的冷色,不发黑
      let f: number;
      let cool = 0;
      if (s >= 1) {
        f = Math.min(1.4, 1 + (s - 1) * 0.7);
      } else {
        const a = 1 - Math.exp((s - 1) / SHADOW_DEPTH); // 0..1,软过渡到下限
        f = 1 - SHADOW_DEPTH * a;
        cool = COOL * a;
      }
      const o = k * 4;
      d[o] = c[0] * f + (SKY_SHADOW[0] - c[0] * f) * cool;
      d[o + 1] = c[1] * f + (SKY_SHADOW[1] - c[1] * f) * cool;
      d[o + 2] = c[2] * f + (SKY_SHADOW[2] - c[2] * f) * cool;
      d[o + 3] = 255;
    }
  }
  // 抗锯齿之前的那一份不描海岸线:放大后的细节层拿它拼水、陆两份,海岸线另按岸线描(不然放大后是一条发虚的宽带,见 realisticShoreParts)
  const raw = keepRaw ? d.slice() : null;
  if (m.coast) {
    coastLine(d, r, m.coast);
    if (alb) coastLine(alb, r, m.coast);
  }
  // 3. 水陆交界抗锯齿
  antialiasShores(d, r);
  ctx.putImageData(img, 0, 0);
  return raw;
}

/** 地图册的海岸线:水那一侧挨着陆地的像素描深一圈(湖也描) */
function coastLine(d: Uint8ClampedArray, r: Raster, [cc, ca]: [RGB, number]): void {
  const { w, h, water } = r;
  for (let py = 0; py < h; py++) {
    for (let px = 0; px < w; px++) {
      const k = py * w + px;
      if (water[k] === 0) continue;
      const kr = px < w - 1 ? k + 1 : k - w + 1;
      const kl = px > 0 ? k - 1 : k + w - 1;
      const kd = py < h - 1 ? k + w : k;
      const ku = py > 0 ? k - w : k;
      if (water[kr] !== 0 && water[kl] !== 0 && water[kd] !== 0 && water[ku] !== 0) continue;
      const o = k * 4;
      d[o] += (cc[0] - d[o]) * ca;
      d[o + 1] += (cc[1] - d[o + 1]) * ca;
      d[o + 2] += (cc[2] - d[o + 2]) * ca;
    }
  }
}

/** 打光用的地面高度:海拔加上沟和山脊(没有就是海拔本身) */
function reliefOf(r: Raster): Float32Array {
  const g = r.gully;
  if (!g) return r.elev;
  const out = new Float32Array(r.elev);
  for (let k = 0; k < out.length; k++) out[k] += g[k];
  return out;
}

// 暗面最多压暗多少(1 - 下限)、细节晕渲 / 大尺度晕渲 / 海底晕渲的权重:见 Material 的 shadowDepth、detailW、macroW、seaRelief
/** 最暗处往天空冷色里混多少 */
const SHADOW_COOL = 0.4;
/** 细节晕渲按大范围平均海拔保留多少:低于 DETAIL_E0 米只留 detailFlat,高过 DETAIL_E1 米全留 */
const DETAIL_E0 = 300;
const DETAIL_E1 = 1400;

// ---------------------------------------------------------------------------
// 群落连续调色板:温度 × 降水(对数)二维查找表,每格是一条暗 → 亮的色带(RK 档)
// 从 BIOMES[].real 出发,按 classifyBiome 的阈值铺满 Whittaker 图,再做高斯模糊,
// 这样群落交界处是连续渐变;每条色带的中间那档仍是 BIOMES 表里的颜色,和数据图层的分区对得上。

/** 色带档数(中间那档 = 群落颜色) */
const RK = 7;
/** 每档和中间那档的比值最多偏多少(卫星图很暗的地方比值会很极端) */
const RAMP_LO = 0.45;
const RAMP_HI = 1.7;

/**
 * 群落 b 的色带(RK 档 RGB);地理图换一套底色、深浅压扁(主要靠底色分地区)。
 * 色带的形状取自 BIOMES[].satRamp(卫星图上从暗到亮的七档)。卫星图整体偏暗,只用它的"形状":每档除以中间那档,
 * 再乘到群落颜色上 —— 群落的平均色不变,暗处偏什么色(荒漠的暗处是红褐的岩石、亮处是浅色的沙)照卫星图
 */
function biomeRamp(b: Biome, m: Material): RGB[] {
  const own = m.biomes?.[b];
  const base = own ? hexRGB(own) : BIOMES[b].real;
  const sat = BIOMES[b].satRamp;
  if (!sat) return Array.from({ length: RK }, () => base);
  const mid = hexRGB(sat[(RK - 1) >> 1]);
  const sq = m.rampSquash;
  return sat.map((c) => {
    const q = hexRGB(c);
    return [0, 1, 2].map((i) => {
      const f = Math.min(RAMP_HI, Math.max(RAMP_LO, q[i] / Math.max(1, mid[i])));
      return base[i] * (sq === 1 ? f : 1 + (f - 1) * sq);
    }) as RGB;
  });
}

const PT0 = -16; // °C
const PT1 = 34;
const PNT = 51; // 每格 1°C
const PP0 = Math.log(60); // mm(对数刻度:群落阈值大致按倍数分布)
const PP1 = Math.log(6000);
const PNP = 47; // 每格 ln 0.1(约 10%)
const paletteCache = new Map<SurfaceLook, Float32Array>();

/** 查找表:第 (j, i) 格(降水、温度)第 q 档的颜色在 ((j × PNT + i) × RK + q) × 3 */
function biomePalette(look: SurfaceLook): Float32Array {
  const hit = paletteCache.get(look);
  if (hit) return hit;
  const n = PNT * PNP;
  const m = MATERIALS[look];
  const ramps = BIOMES.map((_, b) => biomeRamp(b, m));
  const ch = Array.from({ length: RK * 3 }, () => new Float32Array(n));
  for (let j = 0; j < PNP; j++) {
    const p = Math.exp(PP0 + (j / (PNP - 1)) * (PP1 - PP0));
    for (let i = 0; i < PNT; i++) {
      const t = PT0 + (i / (PNT - 1)) * (PT1 - PT0);
      // 冰原的白色交给积雪层(按像素温度),表里按苔原 / 寒漠处理(温度夹到冰原门槛上面一点),免得白色被模糊进苔原带
      const r = ramps[classifyBiome(Math.max(t, LAND_ICE_BELOW + 0.1), p, 0)];
      for (let q = 0; q < RK; q++) for (let c = 0; c < 3; c++) ch[q * 3 + c][j * PNT + i] = r[q][c];
    }
  }
  // 三次盒式模糊 ≈ 高斯(σ ≈ 3 格:温度 ±3°C、降水 ±30% 的过渡带)
  for (const a of ch) for (let it = 0; it < 3; it++) boxBlur(a, PNT, PNP, m.paletteBlur ?? 2);
  const lut = new Float32Array(n * RK * 3);
  for (let i = 0; i < n; i++) for (let q = 0; q < RK; q++) for (let c = 0; c < 3; c++) lut[(i * RK + q) * 3 + c] = ch[q * 3 + c][i];
  paletteCache.set(look, lut);
  return lut;
}

/** 双线性查表,色带上取第 b(0 暗 ~ 1 亮,0.5 = 群落颜色)处,结果写进 out */
function paletteColor(lut: Float32Array, t: number, p: number, b: number, out: RGB) {
  let fx = ((t - PT0) / (PT1 - PT0)) * (PNT - 1);
  let fy = ((Math.log(p) - PP0) / (PP1 - PP0)) * (PNP - 1);
  let fb = b * (RK - 1);
  // !(x > 0) 同时挡住 NaN / -Infinity
  fx = !(fx > 0) ? 0 : fx > PNT - 1.0001 ? PNT - 1.0001 : fx;
  fy = !(fy > 0) ? 0 : fy > PNP - 1.0001 ? PNP - 1.0001 : fy;
  fb = !(fb > 0) ? 0 : fb > RK - 1.0001 ? RK - 1.0001 : fb;
  const ix = fx | 0;
  const iy = fy | 0;
  const ib = fb | 0;
  const ax = fx - ix;
  const ay = fy - iy;
  const ab = fb - ib;
  const i00 = ((iy * PNT + ix) * RK + ib) * 3;
  const i10 = i00 + RK * 3;
  const i01 = i00 + PNT * RK * 3;
  const i11 = i01 + RK * 3;
  const w00 = (1 - ax) * (1 - ay);
  const w10 = ax * (1 - ay);
  const w01 = (1 - ax) * ay;
  const w11 = ax * ay;
  for (let c = 0; c < 3; c++) {
    const lo = lut[i00 + c] * w00 + lut[i10 + c] * w10 + lut[i01 + c] * w01 + lut[i11 + c] * w11;
    const hi = lut[i00 + 3 + c] * w00 + lut[i10 + 3 + c] * w10 + lut[i01 + 3 + c] * w01 + lut[i11 + 3 + c] * w11;
    out[c] = lo + (hi - lo) * ab;
  }
}

// ---------------------------------------------------------------------------
// 地面纹理:同一种群落里的深浅斑驳(像卫星照片,而不是一片喷枪色)。
// 位置按世界坐标(世界单位;整张图和放大现算的一块取同一个点得同一个值),东西方向按整圈取整,左右无缝。
// 一层层波长减半往细里叠;一层的波长不到 TEX_MIN_PX 个像素就渐渐不叠(再细就是噪点)—— 放大后细的几层才出来

/**
 * 大尺度的"岩性"那几层(波长按世界单位,1 ≈ 赤道上 20 公里;幅度):大片大片的深浅,再按 S 形曲线压出边界 ——
 * 像石漠和沙海、不同岩层那样一块一块,而不是一片均匀的渐变
 */
const GEO_OCT: [number, number][] = [
  [48, 1],
  [24, 0.6],
  [12, 0.35],
];
/** 往细里的几层(放大后更细的才出来) */
const FINE_OCT: [number, number][] = [
  [6, 1],
  [3, 0.75],
  [1.5, 0.55],
  [0.75, 0.42],
  [0.375, 0.32],
  [0.19, 0.25],
];
/** 顺着东西方向拉长的条纹(像风吹出来的沙垄,只在干旱地方):波长、东西拉长几倍 */
const STREAK_OCT: [number, number][] = [
  [3, 1],
  [1.5, 0.7],
  [0.75, 0.5],
];
const STREAK_SX = 4;
/** 波长在这么多个像素以下的一层渐渐不叠 */
const TEX_MIN_PX = 0.9;
const TEX_FULL_PX = 1.8;
/**
 * 细层在屏幕上超过这么多个像素的波长就按比例减弱:放大以后细层变成一团团的"棉絮",
 * 减弱后看上去始终是细颗粒,大的深浅交给大尺度那几层
 */
const TEX_BIG_PX = 8;

/**
 * 按世界坐标取的值噪声(几层叠起来,约 −1 ~ 1),一行一行往下取(铺像素是逐行的):格点值按行缓存,换格子时才算哈希,
 * 每个像素只查表、插值。一圈(东西)取整成整数格,左右无缝;波长不到 TEX_MIN_PX 个像素的层不叠。
 * 幅度按整组的总量归一(不管叠了几层):放大后多出来的细层只添细节,粗层的深浅不变
 */
class RowNoise {
  private layers: {
    lam: number;
    amp: number;
    seed: number;
    period: number;
    off: number;
    /** 每列在第几格(相对 x0)、格内位置(已平滑) */
    ix: Int32Array;
    ux: Float32Array;
    x0: number;
    /** 当前格子上下两条格线上的值 */
    A: Float32Array;
    C: Float32Array;
    yi: number;
    uy: number;
  }[] = [];

  /**
   * wx(px) = 第 px 列像素中心的世界 x;Ww = 一圈多宽(世界单位);pxW = 一个像素多少世界单位;
   * sx = 东西方向拉长几倍;big > 0:波长超过 big 个像素的层按比例减弱(见 TEX_BIG_PX)
   */
  constructor(oct: [number, number][], seed0: number, w: number, wx: (px: number) => number, Ww: number, pxW: number, sx = 1, big = 0) {
    this.v = new Float64Array(w);
    const norm = Math.sqrt(oct.reduce((t, [, a]) => t + a * a, 0));
    oct.forEach(([lam, a], q) => {
      const lp = lam / pxW;
      const amp = ((2 * a) / norm) * smoothstep(TEX_MIN_PX, TEX_FULL_PX, lp) * (big > 0 && lp > big ? big / lp : 1);
      if (!(amp > 0)) return;
      const period = Math.max(1, Math.round(Ww / (lam * sx)));
      const fx = Float64Array.from({ length: w }, (_, px) => (wx(px) / Ww) * period);
      let x0 = Infinity;
      for (const f of fx) x0 = Math.min(x0, Math.floor(f));
      const ix = new Int32Array(w);
      const ux = new Float32Array(w);
      let n = 0;
      for (let px = 0; px < w; px++) {
        const xi = Math.floor(fx[px]);
        const t = fx[px] - xi;
        ix[px] = xi - x0;
        ux[px] = t * t * (3 - 2 * t);
        n = Math.max(n, xi - x0 + 2);
      }
      this.layers.push({ lam, amp, seed: seed0 + q, period, off: 0.37 * q, ix, ux, x0, A: new Float32Array(n), C: new Float32Array(n), yi: NaN, uy: 0 });
    });
  }

  /** 这一行各列的值(row 给的那几段上) */
  readonly v: Float64Array;

  /** 换到世界 y = wy 那一行,把 runs 前 nr 个数([起, 止) 成对的几段列)上的值算进 v */
  row(wy: number, runs: Int32Array, nr: number): void {
    const v = this.v;
    for (let r = 0; r < nr; r += 2) v.fill(0, runs[r], runs[r + 1]);
    for (const L of this.layers) {
      const fy = wy / L.lam + L.off;
      const yi = Math.floor(fy);
      const t = fy - yi;
      L.uy = t * t * (3 - 2 * t);
      if (yi === L.yi) continue;
      if (yi === L.yi + 1) {
        const a = L.A;
        L.A = L.C;
        L.C = a;
        this.line(L, yi + 1, L.C);
      } else {
        this.line(L, yi, L.A);
        this.line(L, yi + 1, L.C);
      }
      L.yi = yi;
    }
    // 一层层加(每层一个紧凑的循环,比逐像素再挨层取快)
    for (const L of this.layers) {
      const { ix, ux, A, C, uy, amp } = L;
      for (let r = 0; r < nr; r += 2) {
        for (let px = runs[r], e = runs[r + 1]; px < e; px++) {
          const i = ix[px];
          const u = ux[px];
          const a = A[i] + (A[i + 1] - A[i]) * u;
          const c = C[i] + (C[i + 1] - C[i]) * u;
          v[px] += amp * (a + (c - a) * uy);
        }
      }
    }
  }

  private line(L: RowNoise['layers'][number], yi: number, out: Float32Array): void {
    for (let i = 0; i < out.length; i++) {
      let x = (L.x0 + i) % L.period;
      if (x < 0) x += L.period;
      out[i] = hash2(x, yi, L.seed) - 0.5;
    }
  }
}

/** 像 tanh 的 S 形(−1 ~ 1;有理式,比 Math.tanh 快,哪个平台算出来都一样) */
function softClip(x: number): number {
  if (x >= 3) return 1;
  if (x <= -3) return -1;
  const x2 = x * x;
  return (x * (27 + x2)) / (27 + 9 * x2);
}

// 地面纹理在色带上挪多少(0.5 ± 这么多 × 纹理,湿润地方 texAmpWet、干旱地方 texAmpDry);
// 纹理里大尺度那几层、细层、条纹(只在干旱地方)各占多少(texGeo、texFine、texStreak);大尺度压出边界的 S 形曲线有多陡(geoSharp):见 Material
/** 干旱地方 S 形再陡多少(岩石露头的边更硬) */
const GEO_SHARP_DRY = 4;
/** 压边界之前往大尺度里掺多少细层(边界弯弯曲曲,不是光滑的曲线);干旱地方再多掺多少(边更碎) */
const GEO_ROUGH = 0.35;
const GEO_ROUGH_DRY = 0.15;
/**
 * 山谷(凹处)发亮、山脊发暗:按 4 邻域平均比这里高多少米,高 CAV_REF × 像素宽(世界单位)米时挪满 texCav
 * (像素越细,同样的地形相邻像素的高差越小)
 */
const CAV_REF = 30;
/** 群落交界按纹理打散:亮的地方当作干一点、暖一点(温度 + ECO_T 度,降水 × e^−ecoP) */
const ECO_T = 1;
/** 谷底压暗:比周围大范围的平均海拔低这么多米时压满 valleyDark(大的河谷、盆地底) */
const VALLEY_E0 = 80;
const VALLEY_E1 = 700;
/** 河边:离河多近(见 Raster.bank)在这一段里冲积地发亮;更近的那一窄条(RIP_B0 ~ 1)干旱地方变绿 */
const ALLU_B0 = 0.35;
const ALLU_B1 = 0.85;
const ALLU_LIGHT = 0.08;
const RIP_B0 = 0.78;
const RIP_B1 = 0.97;
/** 河岸绿带的边按纹理忽宽忽窄 */
const RIP_JAG = 0.1;
/** 干旱地方河两岸变绿:降水这么少(毫米)以下全绿、这么多以上不变 */
const RIP_P0 = 300;
const RIP_P1 = 1000;
/** 河岸按"降水有这么多"的颜色画 */
const RIP_WET = 1100;
/** 细沟(见 Raster.vein):沟心在 VEIN_C0 ~ VEIN_C1 之间长满(边按纹理忽宽忽窄),压暗多少;干旱地方沟心的降水按几倍算(带点绿) */
const VEIN_C0 = 0.3;
const VEIN_C1 = 0.85;
const VEIN_DARK = 0.1;
/** 山地里(大范围平均海拔从 VEIN_E0 到 VEIN_E1 米)细沟渐渐不画:山上的沟壑交给晕渲 */
const VEIN_E0 = 700;
const VEIN_E1 = 1500;
const VEIN_WET = 2.6;
/** 沟两侧的谷地(冲下来的细土)在色带上亮多少 */
const VEIN_LIGHT = 0.07;

// ---------------------------------------------------------------------------

/**
 * 大尺度晕渲:把海拔模糊掉十几个像素再算明暗,只保留山脉 / 高原的整体形状,
 * 让整条山脉有向光面、背光面的体积感。陆地、海底各算一份(同一遍降采样):
 * - 陆地:海面按 0 米算,海岸只剩平缓的坡;海拔先"加重"(emphasize),山里的坡显得陡、平原上的缓坡几乎看不出
 * - 海底:陆地按 0 米算,只看大陆坡、洋中脊、海沟的整体起伏(更平滑、更淡)
 * 返回:shade(陆地像素是陆地的、海面像素是海底的明暗,平地 = 1)、level(陆地的大范围平均海拔,细节晕渲按它决定平原压多少)。
 * 只要低频信息,所以在 1/4 分辨率上算,再双线性放大回来(省时间)。
 */
function macroShade(r: Raster, grad = false): { shade: Float32Array; level: Float32Array; gx?: Float32Array; gy?: Float32Array } {
  return macroUpsample(macroGrids(r, grad), r);
}

/** 大尺度晕渲的粗网格(1/F 分辨率;见 macroShade):放大后现算的一块也按整张图的这一份取样(各块接得上) */
export interface MacroGrids {
  F: number;
  mw: number;
  mh: number;
  /** 整张主图的宽(像素) */
  w: number;
  h: number;
  /** 陆地、海底的明暗;陆地的大范围平均海拔 */
  SL: Float32Array;
  SS: Float32Array;
  P: Float32Array;
  /** 地球仪要的坡度(陆地、海底各东、南两份) */
  GL: [Float32Array, Float32Array] | null;
  GS: [Float32Array, Float32Array] | null;
}

/** 整张主图(不能是放大现算的一块)的大尺度晕渲粗网格 */
export function macroGrids(r: Raster, grad = false): MacroGrids {
  const { w, h, elev, water } = r;
  const F = 4;
  const mw = Math.ceil(w / F);
  const mh = Math.ceil(h / F);
  const M = mw * mh;
  // 1) 降采样:每 F×F 块取平均(陆地海拔、海底深度分开累加)
  const P = new Float32Array(M); // 陆地平均海拔(水面按 0)
  const D = new Float32Array(M); // 海底平均深度(负数;陆地按 0)
  const cnt = new Float32Array(M);
  for (let py = 0; py < h; py++) {
    const row = ((py / F) | 0) * mw;
    for (let px = 0; px < w; px++) {
      const k = py * w + px;
      const j = row + ((px / F) | 0);
      const e = elev[k];
      if (water[k] === 1) {
        if (e < 0) D[j] += e;
      } else if (e > 0) P[j] += e;
      cnt[j]++;
    }
  }
  const E = new Float32Array(M);
  for (let j = 0; j < M; j++) {
    P[j] /= cnt[j];
    D[j] /= cnt[j];
    E[j] = emphasize(P[j]);
  }
  // 2) 模糊:两次盒式 ≈ 帐篷形(随分辨率缩放);海底更平滑。
  //    东西相连:列下标取模,东西向半径按纬度放宽(同样的地面宽度,高纬度占更多像素)
  const RL = Math.max(1, Math.round((7 * r.scale) / F));
  const RS = Math.max(1, Math.round((12 * r.scale) / F));
  const stretch = Float32Array.from({ length: mh }, (_, y) => 1 / Math.max(rowCos(y, mh), 1e-3));
  for (let it = 0; it < 2; it++) {
    boxBlurWrap(E, mw, mh, RL, stretch);
    boxBlurWrap(P, mw, mh, RL, stretch);
    boxBlurWrap(D, mw, mh, RS, stretch);
  }
  // 3) 晕渲(和 hillshade 同一个西北来光,平地 = 1)
  const SL = lowShade(E, mw, mh, (MACRO_EXAG * r.scale) / F, stretch);
  const SS = lowShade(D, mw, mh, (SEA_EXAG * r.scale) / F, stretch);
  // 地球仪:同样的坡度也放大回来(见 GlobeCapture)
  const GL = grad ? lowGrad(E, mw, mh, (MACRO_EXAG * r.scale) / F, stretch) : null;
  const GS = grad ? lowGrad(D, mw, mh, (SEA_EXAG * r.scale) / F, stretch) : null;
  return { F, mw, mh, w, h, SL, SS, P, GL, GS };
}

/**
 * 4) 双线性放大回 r 的分辨率:海面像素取海底的明暗,其余取陆地的。
 * r 是放大现算的一块(r.win)时,按它在整张图上的位置取样(列取模,行夹在上下边之内)
 */
function macroUpsample(g: MacroGrids, r: Raster): { shade: Float32Array; level: Float32Array; gx?: Float32Array; gy?: Float32Array } {
  const { w, h, water } = r;
  const { F, mw, mh, SL, SS, P, GL, GS } = g;
  const win = r.win;
  // 这张图的像素 → 整张图的像素:x' = (x + 0.5) × fx − 0.5
  const fx = win ? g.w / win.W : 1;
  const fy = win ? g.h / win.H : 1;
  const ox = win ? win.x0 : 0;
  const oy = win ? win.y0 : 0;
  const gx = GL ? new Float32Array(w * h) : undefined;
  const gy = GL ? new Float32Array(w * h) : undefined;
  const shade = new Float32Array(w * h);
  const level = new Float32Array(w * h);
  const cx0 = new Int32Array(w);
  const cx1 = new Int32Array(w);
  const cax = new Float32Array(w);
  // 同样大小的一块(编辑地形后按块重画):过了右边的列按整张图接回左边算
  const same = !!win && win.W === g.w;
  for (let px = 0; px < w; px++) {
    const fx0 = win ? ((same && ox + px >= g.w ? ox + px - g.w : ox + px) + 0.5) * fx / F - 0.5 : (px + 0.5) / F - 0.5;
    // 左右边的像素插在最后一格和第一格之间
    const x0 = Math.floor(fx0);
    cax[px] = fx0 - x0;
    let a = x0 % mw;
    if (a < 0) a += mw;
    cx0[px] = a;
    cx1[px] = a + 1 >= mw ? a + 1 - mw : a + 1;
  }
  for (let py = 0; py < h; py++) {
    let fy0 = win ? ((oy + py + 0.5) * fy) / F - 0.5 : (py + 0.5) / F - 0.5;
    fy0 = fy0 < 0 ? 0 : fy0 > mh - 1 ? mh - 1 : fy0;
    const y0 = Math.max(0, Math.min(mh - 2, fy0 | 0));
    const ay = mh > 1 ? fy0 - y0 : 0;
    const r0 = y0 * mw;
    const r1 = Math.min(mh - 1, y0 + 1) * mw;
    for (let px = 0; px < w; px++) {
      const k = py * w + px;
      const a = r0 + cx0[px];
      const b = r0 + cx1[px];
      const c = r1 + cx0[px];
      const d = r1 + cx1[px];
      const ax = cax[px];
      const w00 = (1 - ax) * (1 - ay);
      const w10 = ax * (1 - ay);
      const w01 = (1 - ax) * ay;
      const w11 = ax * ay;
      const src = water[k] === 1 ? SS : SL;
      shade[k] = src[a] * w00 + src[b] * w10 + src[c] * w01 + src[d] * w11;
      level[k] = P[a] * w00 + P[b] * w10 + P[c] * w01 + P[d] * w11;
      if (gx) {
        const G = water[k] === 1 ? GS! : GL!;
        gx[k] = G[0][a] * w00 + G[0][b] * w10 + G[0][c] * w01 + G[0][d] * w11;
        gy![k] = G[1][a] * w00 + G[1][b] * w10 + G[1][c] * w01 + G[1][d] * w11;
      }
    }
  }
  return { shade, level, gx, gy };
}

/** 粗网格上的坡度(东、南两个方向;和 lowShade 同一个算法,只是不打光):地球仪按屏幕方向重新打光用 */
function lowGrad(E: Float32Array, mw: number, mh: number, z: number, stretch: Float32Array): [Float32Array, Float32Array] {
  const GX = new Float32Array(mw * mh);
  const GY = new Float32Array(mw * mh);
  for (let y = 0; y < mh; y++) {
    const up = y > 0 ? y - 1 : y;
    const dn = y < mh - 1 ? y + 1 : y;
    const zx = z * stretch[y];
    for (let x = 0; x < mw; x++) {
      const lf = x > 0 ? x - 1 : mw - 1;
      const rt = x < mw - 1 ? x + 1 : 0;
      GX[y * mw + x] = ((E[y * mw + rt] - E[y * mw + lf]) / 2) * zx;
      GY[y * mw + x] = ((E[dn * mw + x] - E[up * mw + x]) / (dn - up || 1)) * z;
    }
  }
  return [GX, GY];
}

/**
 * 粗网格上的晕渲(西北来光,平地 = 1);z = 每格的高度夸张系数。
 * stretch:每行东西向坡度的放大倍数 1 / cos(纬度),左右邻居列下标取模(主图东西相连)
 */
function lowShade(E: Float32Array, mw: number, mh: number, z: number, stretch: Float32Array): Float32Array {
  let lx = -1;
  let ly = -1;
  let lz = 1.3;
  const ll = Math.hypot(lx, ly, lz);
  lx /= ll;
  ly /= ll;
  lz /= ll;
  const S = new Float32Array(mw * mh);
  for (let y = 0; y < mh; y++) {
    const up = y > 0 ? y - 1 : y;
    const dn = y < mh - 1 ? y + 1 : y;
    const zx = z * stretch[y];
    for (let x = 0; x < mw; x++) {
      const lf = x > 0 ? x - 1 : mw - 1;
      const rt = x < mw - 1 ? x + 1 : 0;
      const dx = ((E[y * mw + rt] - E[y * mw + lf]) / 2) * zx;
      const dy = ((E[dn * mw + x] - E[up * mw + x]) / (dn - up || 1)) * z;
      S[y * mw + x] = (-dx * lx - dy * ly + lz) / Math.sqrt(dx * dx + dy * dy + 1) / lz;
    }
  }
  return S;
}
const MACRO_EXAG = 0.018;
const SEA_EXAG = 0.02;

/**
 * 陆地晕渲用的"加重"海拔:e × (e / 1500)^EMPH_POW。高处的坡被放大、低处的坡被压小 ——
 * 同样的高差,在山里显得陡、在平原上几乎看不出(世界地图上平原的缓坡本来就看不见)。
 */
function emphasize(e: number): number {
  return e > 0 ? e * Math.pow(e / EMPH_REF, EMPH_POW) : 0;
}
const EMPH_REF = 1500;
const EMPH_POW = 1.1;

/** 5×5 帐篷核(两次 3×3 盒式模糊)下的湖泊占比:湖岸的平滑场 */
const TENT5 = [1, 2, 3, 2, 1];
function lakeField(water: Uint8Array, w: number, h: number, px: number, py: number): number {
  let s = 0;
  for (let dy = -2; dy <= 2; dy++) {
    const y = Math.max(0, Math.min(h - 1, py + dy));
    for (let dx = -2; dx <= 2; dx++) {
      const xx = px + dx;
      const x = xx < 0 ? xx + w : xx >= w ? xx - w : xx;
      if (water[y * w + x] === 2) s += TENT5[dy + 2] * TENT5[dx + 2];
    }
  }
  return s / 81;
}

/**
 * 水陆交界抗锯齿:只处理紧挨着另一类的像素,按"这个像素里有多少是陆地"把两边的颜色混合。
 * - 海岸:海拔过零点就是岸线,亚像素距离 sd = 海拔 / |海拔梯度|(同手绘风的墨线)
 * - 湖岸:没有连续的场,用模糊过的湖泊掩膜代替,0.5 等值线当岸线
 * 先算出所有要改的像素,最后一起写回,读到的邻居颜色都是改之前的。
 */
function antialiasShores(d: Uint8ClampedArray, r: Raster) {
  const { w, h, elev, water } = r;
  const upd: number[] = [];
  for (let py = 0; py < h; py++) {
    const up = py > 0 ? -w : 0;
    const dn = py < h - 1 ? w : 0;
    for (let px = 0; px < w; px++) {
      const k = py * w + px;
      // 左右邻居的偏移:东西相连,图边上取另一头
      const lf = px > 0 ? -1 : w - 1;
      const rt = px < w - 1 ? 1 : 1 - w;
      const hx = 2;
      const wk = water[k];
      // 四邻域都是同一类:不在交界上
      if (water[k + lf] === wk && water[k + rt] === wk && water[k + up] === wk && water[k + dn] === wk) continue;

      // 这个像素属于哪种交界、对面是哪一类(湖海相接的少见情况不管)
      let other: number;
      if (wk !== 0) other = 0;
      else {
        const hasSea = water[k + lf] === 1 || water[k + rt] === 1 || water[k + up] === 1 || water[k + dn] === 1;
        other = hasSea ? 1 : 2;
      }
      const lakeEdge = wk === 2 || other === 2;

      // 对面一类的颜色:8 邻域里同类像素取平均
      let sr = 0;
      let sg = 0;
      let sb = 0;
      let cnt = 0;
      for (let dy = up; dy <= dn; dy += w) {
        for (let i = 0; i < 3; i++) {
          // 左、中、右三列
          const dx = i === 0 ? lf : i === 1 ? 0 : rt;
          const j = k + dy + dx;
          if (water[j] !== other) continue;
          sr += d[j * 4];
          sg += d[j * 4 + 1];
          sb += d[j * 4 + 2];
          cnt++;
        }
      }
      if (cnt === 0) continue;

      // 亚像素距离(像素为单位):场的正侧 —— 海岸是陆地,湖岸是湖泊
      let sd: number;
      if (lakeEdge) {
        const m = lakeField(water, w, h, px, py);
        const gx = (lakeField(water, w, h, px + rt, py) - lakeField(water, w, h, px + lf, py)) / hx;
        const gy = (lakeField(water, w, h, px, py + dn / w) - lakeField(water, w, h, px, py + up / w)) / ((dn - up) / w || 1);
        sd = (m - 0.5) / (Math.sqrt(gx * gx + gy * gy) || 1e-6);
      } else {
        const gx = (elev[k + rt] - elev[k + lf]) / hx;
        const gy = (elev[k + dn] - elev[k + up]) / ((dn - up) / w || 1);
        sd = elev[k] / (Math.sqrt(gx * gx + gy * gy) || 1e-6);
      }
      const cov = Math.max(0, Math.min(1, 0.5 + sd)); // 正侧占这个像素的比例
      const ownPositive = lakeEdge ? wk === 2 : wk === 0;
      // 对面一类占的比例;最多一半,保证像素本身的归类不变(一两个像素的小湖不会被抹掉)
      const a = Math.min(0.5, ownPositive ? 1 - cov : cov);
      if (a <= 0) continue;
      const o = k * 4;
      upd.push(
        k,
        d[o] + (sr / cnt - d[o]) * a,
        d[o + 1] + (sg / cnt - d[o + 1]) * a,
        d[o + 2] + (sb / cnt - d[o + 2]) * a,
      );
    }
  }
  for (let i = 0; i < upd.length; i += 4) {
    const o = upd[i] * 4;
    d[o] = upd[i + 1];
    d[o + 1] = upd[i + 2];
    d[o + 2] = upd[i + 3];
  }
}
