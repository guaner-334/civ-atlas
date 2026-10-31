/**
 * 极端参数压力测试:npx tsx scripts/stress.ts(出现 NaN 则退出码 1;STRESS_PART=1/3 只跑其中一份,STRESS_DRY=1 只列出怎么分,见 group)
 * 每行打印:生成 / 铺像素 / 文明(其中宜居度 + 划州、推演(民族 + 城镇 + 国家 + 战争)、回放一帧、道路)耗时,
 * 州数、民族数、占据率、国家数、城镇数、路段数,战争统计(场数、攻占、灭亡、迁都、飞地、易手频繁的州),
 * 分合统计(分裂、合并、复国、主动迁都),王朝更替(东方改朝换代 / 西幻王室更迭),信仰(大教、教派、宗教大事),
 * 最后汇总各项速度和预算(见 SPEED_BUDGET:只报告,超了写"超预算",不改退出码)。
 * 改地形(阶段 4):几组极端的地形修改(最大最强的火山 / 山脉铺满全图、两极的湖、跨 180° 经线的笔画、整片沉成海 / 抬成陆地)。
 * 草图:一片陆地也没画的"都是海"(整颗星球是海)、满图涂成山地、跨 180° 经线和两极的大杂烩(再叠上地形修改)。
 * 板块:满图横竖切开、改成最快 / 不动、陆壳洋壳来回换、四处合并;照图分到上限(60 条窄条再横切);全成陆壳又关掉造山("都是海"、再叠上地形修改)。
 * 地形大事:半路整颗星球沉入海中、整片抬成陆地、五件最大最强的火山(有同一年的、第 1 年和第 2999 年的),
 * 各段的州和那时的地形对得上,大事以后的城、国家、信仰、编年史照样合法。
 * 推演年数:推到最久(60000 年,有一组再叠一件地形大事),史事、国都、人口、信仰照样合法,名字里不冒数字。
 * 接着推:14 组随机自查(逐年推演随机推、随机下命令,和一口气推完逐字段相等,见 scripts/lib/resumeFuzz.ts);\n * 带地形大事的世界 6 组(大事那一刻接着推和一口气推完一样);不一样也退出码 1。
 */
import { generateWorld, DEFAULT_PARAMS } from '../src/gen/world';
import { rasterize } from '../src/gen/raster';
import { generateCiv, planetTempo } from '../src/gen/civ';
import { Biome } from '../src/gen/biomes';
import { ownersAt } from '../src/gen/civ/timeline';
import { HABITABLE_SUIT } from '../src/gen/civ/cultures';
import { labelImage, pixelRegions, washPixels } from '../src/render/civ/territory';
import { borderLines } from '../src/render/civ/borders';
import { CIV_SHOW_OFF } from '../src/render/civ/overlay';
import { warFront, warMarkPoints, warSpans } from '../src/render/civ/warfare';
import { capitalAt, populationAt, regionPopulationAt } from '../src/gen/civ/growth';
import { pandemicsOf } from '../src/gen/civ/story/pandemicInfo';
import { warStats } from '../src/gen/civ/wars';
import { politicsStats } from '../src/gen/civ/politics';
import { dynastyStats } from '../src/gen/civ/dynasty';
import { assimStats } from '../src/gen/civ/assimilation';
import { cityStats } from '../src/gen/civ/cities';
import { Layer } from '../src/gen/civ/types';
import { faithAt, faithFromScratch } from '../src/gen/civ/religion';
import { AVAIL_SCALE, BAD_LEVEL, CAP_COUNT, ERAS, INVENTIONS, RESOURCE_COUNT } from '../src/gen/civ/development';
import { civLabelItems, civMapLayer, labelViewExtras } from '../src/render/civ/labels';
import { placeMap } from '../src/render/labels/draw';
import { END_YEAR_MAX, settlementKey, type Intervention, type TerrainOp, type Upheaval } from '../src/gen/edits';
import { upheavalSteps } from '../src/gen/civ/upheaval';
import { buildChronicle } from '../src/gen/civ/story/chronicle';
import { LAYER_W, LAYER_H, encodeLayer, sketchGrid, type SketchEdit, type SketchKind } from '../src/gen/sketch';
import { PLATE_IMAGE_MAX, type PlateEdit, type PlateOp } from '../src/gen/plateEdits';
import { fuzzResume, fuzzUpheavalResume, type FuzzCase } from './lib/resumeFuzz';

/** 发展度:有文明就有;快照的年份递增、最后一份是结束那年,没有算坏的能力和物产;物产 0–3 档,眼下能用的不超过底子;大事的年份有序、时代、物产和国家编号在范围内 */
function devBad(civ: ReturnType<typeof generateCiv>): number {
  const dev = civ.development;
  if (!dev) return civ.viable && civ.cultures.length ? 1 : 0;
  let cn = 0;
  const R = civ.regions.count;
  if (dev.resources.length !== R * RESOURCE_COUNT || dev.resources.some((v) => v > 3)) cn++;
  if (!dev.snaps.length || dev.snaps.length !== dev.snapYears.length || dev.snapYears[dev.snapYears.length - 1] !== civ.endYear) cn++;
  dev.snapYears.forEach((y, i) => {
    if (!Number.isFinite(y) || (i && !(y > dev.snapYears[i - 1]))) cn++;
  });
  for (const s of dev.snaps) if (s.length !== R * CAP_COUNT || s.includes(BAD_LEVEL)) cn++;
  if (dev.avail.length !== dev.snaps.length || dev.found.length !== R * RESOURCE_COUNT) cn++;
  // 储量是最后一件地形大事以后的地形分的档:大事以前的快照只查不是坏数
  const lastUp = Math.max(-Infinity, ...(civ.upheavals ?? []).map((u) => u.year));
  dev.avail.forEach((a, k) => {
    if (a.length !== R * RESOURCE_COUNT) cn++;
    const capped = dev.snapYears[k] >= lastUp;
    for (let i = 0; i < a.length; i++) if (a[i] === BAD_LEVEL || (capped && a[i] > dev.resources[i] * AVAIL_SCALE)) cn++;
  });
  dev.events.forEach((e, i) => {
    const res = e.kind === 'discover' || e.kind === 'deplete';
    const inv = e.kind === 'invent';
    // 退回(全球大疫的凋敝里,regress)可以退到石器时代(第 0 个)
    const back = e.kind === 'regress';
    if (!Number.isFinite(e.year) || (i && e.year < dev.events[i - 1].year) || !(e.era >= (res || inv || back ? 0 : 1) && e.era < ERAS.length) || e.polity >= civ.polities.length || !(e.region >= 0 && e.region < R)) cn++;
    if (res && !(e.resource! >= 0 && e.resource! < RESOURCE_COUNT)) cn++;
    if (inv && !(e.invention! >= 0 && e.invention! < INVENTIONS.length)) cn++;
  });
  return cn;
}

/** 极端的地形修改:大杂烩(最大最强的火山、横贯全图的山脉、角上 / 海里的湖、画笔)、整片沉成海、整片抬成陆地 */
const rows = (kind: 'sink' | 'raise'): TerrainOp[] => [0, 200, 400, 600, 800, 1000].map((y) => ({ kind, pts: [0, y, 1024, y + 30, 2048, y], r: 160, s: 2 }));
const MIX: TerrainOp[] = [
  ...[0, 1, 2, 3, 4, 5, 6, 7].map((k): TerrainOp => ({ kind: 'volcano', pts: [k * 290, (k * 397) % 1024], r: 160, s: 2 })),
  { kind: 'volcano', pts: [2048, 1024], r: 3, s: 0.2 },
  { kind: 'range', pts: [0, 512, 700, 300, 1400, 700, 2048, 512], r: 160, s: 2 },
  { kind: 'range', pts: [1024, 0, 1024, 1024], r: 3, s: 2 },
  { kind: 'range', pts: [500, 500], r: 40, s: 1 },
  { kind: 'lake', pts: [0, 0], r: 160, s: 2 },
  { kind: 'lake', pts: [1024, 512], r: 160, s: 2 },
  { kind: 'lake', pts: [300, 300], r: 3, s: 0.2 },
  { kind: 'sink', pts: [200, 200, 1800, 800], r: 100, s: 2 },
  { kind: 'raise', pts: [1800, 200, 200, 800], r: 100, s: 2 },
  // 跨 180° 经线的笔画(x 超出地图、从负数开始)
  { kind: 'range', pts: [1990, 300, 2100, 330, 2200, 360], r: 60, s: 2 },
  { kind: 'raise', pts: [-40, 700, 60, 720], r: 50, s: 1 },
];

/** 极端的草图:满图一行行涂同一种笔(半径最大) */
const fill = (kind: SketchKind, rest: SketchEdit['rest'] = 'auto'): SketchEdit => ({
  rest,
  strokes: Array.from({ length: 5 }, (_, k) => ({ kind, r: 128, pts: [-100, k * 230, 1024, k * 230 + 40, 2148, k * 230] })),
});
const SKETCH_MIX: SketchEdit = {
  rest: 'sea',
  strokes: [
    { kind: 'land', r: 128, pts: [1900, 400, 2150, 450, 2300, 500] },
    { kind: 'mountain', r: 4, pts: [1950, 420, 2100, 470] },
    { kind: 'land', r: 100, pts: [0, 0, 2048, 0] },
    { kind: 'mountain', r: 60, pts: [500, 1024] },
    { kind: 'land', r: 4, pts: [1000, 512] },
    { kind: 'sea', r: 30, pts: [2000, 440, 2100, 460] },
    { kind: 'erase', r: 50, pts: [1024, 0] },
    { kind: 'isles', r: 160, pts: [600, 600, 900, 650] },
    { kind: 'shelf', r: 90, pts: [700, 300] },
    { kind: 'hills', r: 2, pts: [1900, 420] },
    { kind: 'plateau', r: 160, pts: [1950, 460, 2200, 480] },
    { kind: 'mountain', r: 30, pts: [2000, 470, 2050, 480], h: 2 },
    { kind: 'sea', r: 10, pts: [1950, 420, 2100, 420, 2100, 520, 1950, 520], fill: 1 },
    { kind: 'land', r: 2, pts: [0, 1024, 2048, 1024, 1024, 0], fill: 1 },
  ],
};

/** 极端的板块改动:满图横竖切十几刀(跨 180° 经线、贴着两极)、一格格改成最快 / 不动、陆壳洋壳来回换、四处合并;另一组全成陆壳又关掉造山 */
const PLATE_MIX: PlateEdit = {
  ops: [
    ...Array.from({ length: 8 }, (_, k): PlateOp => ({ kind: 'cut', pts: [-200, 60 + k * 128, 1024, 90 + k * 128, 2248, 60 + k * 128] })),
    ...Array.from({ length: 8 }, (_, k): PlateOp => ({ kind: 'cut', pts: [k * 256 + 40, 0, k * 256 + 90, 512, k * 256 + 40, 1024] })),
    ...Array.from({ length: 64 }, (_, k): PlateOp => ({ kind: 'set', pts: [(k % 8) * 256 + 128, Math.floor(k / 8) * 128 + 64], dir: k * 47, speed: k % 3 ? 16 : 0, crust: k % 2 ? 'oceanic' : 'continental' })),
    ...Array.from({ length: 20 }, (_, k): PlateOp => ({ kind: 'merge', pts: [k * 100, 500, k * 100 + 60, 520] })),
    { kind: 'set', pts: [0, 0], speed: 16 },
    { kind: 'set', pts: [2047, 1024], dir: 359 },
  ],
};
/** 照图分到上限:60 条竖着的窄条(每条一块),上面再横切几刀 */
const PLATE_STRIPES: PlateEdit = {
  ops: Array.from({ length: 4 }, (_, k): PlateOp => ({ kind: 'cut', pts: [-100, 200 + k * 200, 2148, 220 + k * 200] })),
  image: { name: 'stripes.png', cells: encodeLayer(Uint8Array.from({ length: LAYER_W * LAYER_H }, (_, i) => 1 + Math.floor(((i % LAYER_W) * PLATE_IMAGE_MAX) / LAYER_W))) },
};
const PLATE_LAND: PlateEdit = {
  ops: Array.from({ length: 128 }, (_, k): PlateOp => ({ kind: 'set', pts: [(k % 16) * 128 + 64, Math.floor(k / 16) * 128 + 64], speed: 16, crust: 'continental' })),
  orogeny: false,
};

const cases = [
  {}, { landFraction: 0.12 }, { landFraction: 0.6 }, { plates: 5 }, { plates: 30 }, { plates: 60 },
  { cells: 200000 }, { cells: 12000 }, { temperature: -12 }, { temperature: 12 }, { rainfall: 0.4 }, { mountains: 2 }, { mountains: 0.2 },
  { terrain: MIX }, { terrain: rows('sink') }, { terrain: rows('raise') },
  { sketch: { rest: 'sea', strokes: [] } }, { sketch: fill('mountain') }, { sketch: fill('land', 'sea') }, { sketch: fill('isles', 'sea') }, { sketch: fill('plateau') },
  { sketch: { rest: 'auto', strokes: [], plates: PLATE_MIX } }, { sketch: { rest: 'auto', strokes: [], plates: PLATE_STRIPES } }, { sketch: { rest: 'sea', strokes: [], plates: PLATE_LAND }, terrain: MIX },
  { sketch: { ...SKETCH_MIX, coast: 0 }, terrain: MIX }, { sketch: SKETCH_MIX, terrain: [...MIX, { kind: 'river', pts: [1950, 420, 2150, 470, 2300, 500], r: 9, s: 1 }] },
] as ({ terrain?: TerrainOp[]; sketch?: SketchEdit } & Partial<typeof DEFAULT_PARAMS>)[];
/** 打印用:改地形的只写"改地形 · 几处",草图只写"草图 · 几笔" */
const caseName = (c: (typeof cases)[number]) =>
  c.sketch
    ? `{"草图":"${c.sketch.rest === 'sea' ? '都是海' : '交给程序'} ${c.sketch.strokes.length} 笔"${c.sketch.plates ? `,"板块":"${c.sketch.plates.image ? '照图分 ' : ''}${c.sketch.plates.ops.length} 处${c.sketch.plates.orogeny === false ? ' 不造山' : ''}"` : ''}${c.terrain ? `,"改地形":"${c.terrain.length} 处"` : ''}}`
    : c.terrain
      ? `{"改地形":"${c.terrain[0].kind === 'sink' && c.terrain.length === 6 ? '整片沉成海' : c.terrain[0].kind === 'raise' ? '整片抬成陆地' : '大杂烩'} ${c.terrain.length} 处"}`
      : JSON.stringify(c);
/**
 * 只跑其中一份:STRESS_PART=1/3 跑第 1 份、2/3 跑第 2 份、3/3 跑第 3 份(PR 检查上分三台机器同时跑);不设就全跑。
 * 下面每一组(参数组合 + 种子)先用 group 登记,各带一个估的耗时(秒);全部登记完再分(在速度汇总前面):
 * 从估时最长的组往下,每组给当前累计最少的那份(各份跑同一段代码,分得一样),三份合起来正好是全部,长短差不多;
 * 每份里各组仍按登记的先后跑。
 * 估时是 GitHub 常见那一档机器上的秒数,照 2026 年 10 月下旬 15 轮检查算:GitHub 的机器有快有慢(快的那档同一组只要六成多的时间),
 * 先把每台机器的快慢和每组本身的长短分开,再取各组的中位数 —— 直接拿各轮的秒数取中位数,哪份碰巧多分到快机器,那份的组就显得短。
 * 每份跑完最后写一行:估多少秒、实际多少秒、这台机器是估时的几倍,以及按这个倍数折算后和估时差得最多的几组;某一份总是偏长,照这行改估时。
 * STRESS_DRY=1 空跑:只列出每组分到第几份、估多少秒和各份合计,什么都不算(改了估时或加了组,先用它看分得匀不匀)。
 */
const [PART, PARTS] = (process.env.STRESS_PART ?? '1/1').split('/').map(Number);
if (!(Number.isInteger(PART) && Number.isInteger(PARTS) && PART >= 1 && PART <= PARTS)) {
  throw new Error(`STRESS_PART 要写成"第几份/共几份",比如 1/3;现在是 ${process.env.STRESS_PART}`);
}
const DRY = process.env.STRESS_DRY === '1';
if (PARTS > 1 && !DRY) console.log(`只跑第 ${PART} 份(共 ${PARTS} 份)
`);
/** 登记的各组:名字(和这组打印的那行开头一样)、估的耗时(秒)、要跑的检查 */
const groups: { name: string; sec: number; run: () => void }[] = [];
/** 登记一组;分份、跑本份的各组在速度汇总前面 */
const group = (name: string, sec: number, run: () => void) => {
  groups.push({ name, sec, run });
};

/**
 * 速度预算:只报告(超了在汇总那行写"超预算"),不改退出码 —— 同一段代码在 CI 的虚拟机上快慢能差三成以上,
 * 拿计时卡合并误报多;NaN、和一口气推完对不上这类功能检查照旧退出码 1。
 * 产品的标准(用的人的电脑、浏览器里):默认精细度(36k 地块)的地图 2 秒内先出来;历史只要算得比播放快,
 * 每秒至少推 80 年(时间轴 4 倍速,3000 年约 40 秒内推完)。
 * 下面的数是 CI 机器(GitHub 的 ubuntu-latest)上的预算:照 2026 年 10 月下旬 CI 上 10 轮压力测试量出的基线(每轮两份里最慢的),
 * 在最慢的那轮之上留约两成五的余量:
 * - map:默认精细度下 生成 + 铺像素。Node 里一个线程从头铺到尾(含沟壑;浏览器里沟壑分给几个帮手线程同时算),
 *   CI 上每轮最慢 3.4–4.4 秒(陆地 60% 的世界最慢,铺像素 3.3 秒),开发用的电脑上同样几组约 2.0–2.6 秒。
 *   CI 上量不出浏览器里的 2 秒,这里只看有没有比现在明显变慢 → 5500ms
 * - yearsPerSec:推到的年数 ÷ 文明这一步的耗时(宜居度、划州、推演、起名、道路都算上),所有参数、地形大事、推到 60000 年的都算,
 *   取最慢的。CI 上最慢约 250 年/秒(推到 60000 年的那组;200k 地块推 3000 年约 280 年/秒),比标准快三倍 → 就用标准 80 年/秒
 * - habReg:默认精细度下 宜居度 + 划州,CI 上每轮最慢 144–201ms → 250ms
 * - routes:默认精细度下 道路(含航线),CI 上每轮最慢 624–880ms → 1100ms
 * - frame:回放一帧(归属 + 国界 + 半分辨率色块,Node 里),所有参数下 CI 上每轮最慢 42–59ms → 75ms
 */
const SPEED_BUDGET = { map: 5500, yearsPerSec: 80, habReg: 250, routes: 1100, frame: 75 };

let worstHabReg = 0;
let worstRoutes = 0;
let worstMap = 0;
let worstFrame = 0;
let worstLabels = 0;
/** 推演最慢的那组:每秒推几年、是哪组 */
let slowestRate = Infinity;
let slowestRateCase = '';
/** 记下推演速度:years 年用了 ms 毫秒 */
const noteRate = (years: number, ms: number, name: string) => {
  if (!(years > 0 && ms > 0)) return;
  const rate = years / (ms / 1000);
  if (rate < slowestRate) {
    slowestRate = rate;
    slowestRateCase = `${name} 推 ${years} 年用 ${Math.round(ms)}ms`;
  }
};
/** 一个参数组合一组的估时(秒):20 万地块、6 成陆地、整片抬成陆地、草图叠改地形的最慢;整颗星球是海、满图涂山的几乎不推演 */
const caseSec = (c: (typeof cases)[number]) => {
  const sk = c.sketch;
  const op = c.terrain?.[0]?.kind;
  if (c.cells === 200000) return 19;
  if (c.landFraction === 0.6 || op === 'raise') return 11;
  if (c.cells === 12000 || c.landFraction === 0.12) return 5;
  if (sk) {
    if (c.terrain) return 10.5;
    if (sk.plates) return 9;
    if (!sk.strokes.length) return 2.5;
    // 满图涂同一种笔:涂成群岛的有文明可推,其余几乎没有
    return sk.strokes[0].kind === 'isles' ? 8.5 : 4;
  }
  return op === 'sink' ? 3.5 : c.terrain ? 8.5 : 7;
};
for (const c of cases) {
  for (const seed of [3, 99]) group(`${caseName(c)} seed ${seed}`, caseSec(c), () => {
    const { terrain, sketch, ...pc } = c;
    const grid = sketchGrid(sketch);
    // 改过地形的世界要原来星球(参数 + 草图)的扩张节拍:和 worker 一样事先记下(新建时先生成的就是没改的星球),不算进耗时
    const tempo = terrain ? (planetTempo({ ...DEFAULT_PARAMS, ...pc, seed }, undefined, grid) ?? null) : undefined;
    // 改过地形 / 画过草图的世界,山海湖岛的地名照没改过的星球起(gen/civ/index.ts 的 nameRefOf):worker 里新建时先推的就是没改的星球,
    // 那时已经记下了;这里也先推一遍没改的星球(推到第 0 年就够),不算进耗时
    if (terrain || grid) generateCiv(generateWorld({ ...DEFAULT_PARAMS, ...pc, seed }), { endYear: 0 });
    const t0 = performance.now();
    const w = generateWorld({ ...DEFAULT_PARAMS, ...pc, seed }, undefined, terrain, grid);
    const t1 = performance.now();
    const r = rasterize(w, 1);
    const t2 = performance.now();
    // 文明:按 progress 回调的时间点拆出"宜居度 + 划州"两步
    const marks: [string, number][] = [];
    const civ = generateCiv(w, { tempo }, (stage) => marks.push([stage, performance.now()]));
    const t3 = performance.now();
    const civMs = t3 - t2;
    const habReg = (marks.find((m) => m[0] === '文明')?.[1] ?? t3) - t2;
    // 推演 = 定民族 + 按年推演(民族 + 城镇 + 国家,同一个引擎;从"文明"到"起名"两个进度点之间)
    const simMs = (marks.find((m) => m[0] === '起名')?.[1] ?? t3) - (marks.find((m) => m[0] === '文明')?.[1] ?? t2);
    // 回放一帧:任意年份的归属 + 半分辨率铺色块(不含浏览器贴图)
    const pix = pixelRegions(w.mesh, r, civ.regions.of);
    const colors = new Uint8Array(Math.max(1, civ.cultures.length) * 3);
    civ.cultures.forEach((cu, i) => colors.set(cu.color, i * 3));
    const buf = new Uint8ClampedArray(Math.ceil(r.w / 2) * Math.ceil(r.h / 2) * 4);
    let frameMs = 0;
    washPixels({ w: r.w, h: r.h, f: 2, pixRegion: pix, owner: civ.culture, colors, style: 'fantasy', wrap: true }, buf); // 热身
    for (const y of [civ.endYear * 0.4, civ.endYear * 0.7, civ.endYear]) {
      const f0 = performance.now();
      const own = ownersAt(civ, y);
      washPixels({ w: r.w, h: r.h, f: 2, pixRegion: pix, owner: own.culture, colors, style: 'fantasy', wrap: true }, buf);
      frameMs = Math.max(frameMs, performance.now() - f0);
    }
    // 国家视图回放一帧:国界(平滑 + 抖动)+ 按国界改判的归属图 + 半分辨率国土
    const pcolors = new Uint8Array(Math.max(1, civ.polities.length) * 3);
    civ.polities.forEach((p, i) => pcolors.set(p.color, i * 3));
    const lab = new Int16Array(Math.ceil(r.w / 2) * Math.ceil(r.h / 2));
    const fp = (y: number) => ({ world: w, raster: r, civ, style: 'fantasy' as const, year: y, show: { ...CIV_SHOW_OFF, polities: true }, fast: true });
    borderLines(fp(civ.endYear * 0.3), Layer.Polity); // 热身:州界的链每个世界只描一次(首次绘制时算)
    for (const y of [civ.endYear * 0.5, civ.endYear * 0.8, civ.endYear]) {
      const f0 = performance.now();
      const own = ownersAt(civ, y);
      const lines = borderLines(fp(y), Layer.Polity);
      labelImage(r.w, r.h, 2, r.scale, pix, own.polity, lines, lab, w.width);
      washPixels({ w: r.w, h: r.h, f: 2, pixRegion: pix, owner: own.polity, colors: pcolors, style: 'fantasy', label: lab, polity: true, wrap: true }, buf);
      frameMs = Math.max(frameMs, performance.now() - f0);
    }
    // 道路:从 '道路' 这一步开始,到下一个不是道路 / 航线的步骤(或结束)为止
    const ri = marks.findIndex((m) => m[0] === '道路');
    let routesMs = 0;
    if (ri >= 0) {
      let end = ri;
      while (end + 1 < marks.length && (marks[end + 1][0] === '道路' || marks[end + 1][0] === '航线')) end++;
      routesMs = (marks[end + 1]?.[1] ?? t3) - marks[ri][1];
    }
    let land = 0, nan = 0;
    for (let i = 0; i < w.mesh.n; i++) { if (w.water[i] === 0) land++; if (!Number.isFinite(w.elevation[i]) || !Number.isFinite(w.precipitation[i])) nan++; }
    let rn = 0;
    for (let k = 0; k < r.elev.length; k++) if (!Number.isFinite(r.elev[k]) || !Number.isFinite(r.temp[k]) || !Number.isFinite(r.precip[k]) || !Number.isFinite(r.ice[k])) rn++;
    // 文明:宜居度、州的各项数值不能有 NaN,每块陆地都要有州
    let cn = 0;
    const { habitat: hb, regions: R } = civ;
    for (let i = 0; i < w.mesh.n; i++) {
      if (!Number.isFinite(hb.suitability[i]) || !Number.isFinite(hb.capacity[i])) cn++;
      if ((w.water[i] === 0) !== (R.of[i] >= 0)) cn++;
    }
    for (let q = 0; q < R.count; q++) if (!Number.isFinite(R.area[q]) || !Number.isFinite(R.capacity[q]) || !Number.isFinite(R.elevation[q])) cn++;
    for (let k = 0; k < R.adjLen.length; k++) if (!Number.isFinite(R.adjLen[k])) cn++;
    // 民族:日志年份有限且有序、归属编号在范围内、颜色和扩张性不是 NaN
    let hab = 0, occ = 0;
    for (let q = 0; q < R.count; q++) {
      const cu = civ.culture[q];
      if (cu < -1 || cu >= civ.cultures.length) cn++;
      if (hb.suitability[R.seat[q]] >= HABITABLE_SUIT) { hab++; if (cu >= 0) occ++; }
    }
    for (let i = 0; i < civ.log.size; i++) if (!Number.isFinite(civ.log.year[i]) || (i && civ.log.year[i] < civ.log.year[i - 1])) cn++;
    for (const cu of civ.cultures) if (!Number.isFinite(cu.expansionism) || !Number.isFinite(cu.born) || cu.color.some((v) => !Number.isFinite(v))) cn++;
    // 道路:地块编号合法;陆路不下水、不穿冰原
    for (const rt of civ.routes) {
      for (let t = 0; t < rt.cells.length; t++) {
        const c = rt.cells[t];
        if (!(c >= 0 && c < w.mesh.n)) cn++;
        else if (rt.kind !== 'sea' && (w.water[c] !== 0 || w.biome[c] === Biome.Ice)) cn++;
      }
    }
    // 城镇、国家:人口、年份不是 NaN;国家归属编号在范围内;在世的国家,国都(迁都后按新国都)在本国;灭亡的国家一州不剩
    for (const st of civ.settlements) if (!Number.isFinite(st.founded) || !Number.isFinite(st.capacity) || !Number.isFinite(populationAt(st, civ.endYear)) || !st.name) cn++;
    for (const po of civ.polities) {
      if (!Number.isFinite(po.founded) || !po.name || po.color.some((v) => !Number.isFinite(v))) cn++;
      if (po.ended === undefined) {
        if (civ.polity[civ.settlements[capitalAt(po, civ.endYear)].region] !== po.id) cn++;
      } else if (!Number.isFinite(po.ended) || civ.polity.includes(po.id)) cn++;
    }
    // 战争(阶段 3):史事的年份有限且有序、编号在范围内(同化与迁徙的史事 a、b 是民族,war 列是国家)
    for (let i = 0; i < civ.annals.length; i++) {
      const e = civ.annals[i];
      if (!Number.isFinite(e.year) || (i && e.year < civ.annals[i - 1].year)) cn++;
      if (e.kind === 'migrate' || e.kind === 'assimilate' || e.kind === 'vanish') {
        if (e.a < 0 || e.a >= civ.cultures.length || e.b >= civ.cultures.length || e.war >= civ.polities.length || !(e.region >= 0 && e.region < R.count)) cn++;
      } else if (e.a >= civ.polities.length || e.b >= civ.polities.length) cn++;
    }
    // 同化与迁徙(阶段 3):消亡的民族一州不剩、消亡年份有限;迁徙记录的方位合法
    const asm = assimStats(civ);
    for (const cu of civ.cultures) {
      if (cu.ended !== undefined && (!Number.isFinite(cu.ended) || civ.culture.includes(cu.id))) cn++;
      for (const mg of cu.migrations ?? []) if (!Number.isFinite(mg.year) || !'东南西北'.includes(mg.dir)) cn++;
    }
    if (!Number.isFinite(asm.changedShare) || !Number.isFinite(asm.rulingShare) || asm.flippy > 0) cn++;
    const ws = warStats(civ);
    if (![ws.tribalShare, ws.exclaveShare].every(Number.isFinite)) cn++;
    // 分合(阶段 3):分出来的国家,从哪国分出、复的是哪国,编号都在范围内、比自己早;被并掉的国家有灭亡年份
    const ps = politicsStats(civ);
    for (const po of civ.polities) {
      if (po.parent !== undefined && !(po.parent >= 0 && po.parent < po.id)) cn++;
      if (po.restores !== undefined && !(po.restores >= 0 && po.restores < po.id && civ.polities[po.restores].ended !== undefined)) cn++;
      if (!po.titles?.length || !po.capitals?.length || po.capitals[0].settlement !== po.capital) cn++;
    }
    for (const e of civ.annals) if (e.kind === 'merge' && civ.polities[e.b]?.ended !== e.year) cn++;
    // 王朝更替(阶段 3):历朝的年份有限、按先后、第一条是立国那年;王室根据地是城;推演结束后都起了名
    const ds = dynastyStats(civ);
    for (const po of civ.polities) {
      const d = po.dynasties;
      if (!d) continue;
      if (d[0].year !== po.founded) cn++;
      d.forEach((x, i) => {
        if (!Number.isFinite(x.year) || (i && !(x.year > d[i - 1].year)) || !civ.settlements[x.seat] || !x.name) cn++;
      });
    }
    if (![ds.meanEastern, ds.meanWestern].every(Number.isFinite)) cn++;
    // 城市兴衰:洗劫的折损在 0–1 之间、被毁 / 立都年份有限;重建的城在被毁的城故址上;人口任何年份有限、非负,被毁后为 0
    const cs = cityStats(civ);
    for (const st of civ.settlements) {
      for (const k of st.sacks ?? []) if (!Number.isFinite(k.year) || !(k.loss > 0 && k.loss < 1)) cn++;
      if (st.ended !== undefined && !(st.ended >= st.founded && st.ended <= civ.endYear)) cn++;
      for (const sp of st.capitalSpans ?? []) if (!Number.isFinite(sp.from) || (sp.until !== undefined && !(sp.until >= sp.from)) || !civ.polities[sp.polity]) cn++;
      if (st.rebuilds !== undefined) {
        const old = civ.settlements[st.rebuilds];
        if (!old || old.region !== st.region || !(old.ended! < st.founded)) cn++;
      }
      for (const y of [st.founded, (st.founded + civ.endYear) / 2, st.ended ?? civ.endYear, civ.endYear]) {
        const pop = populationAt(st, y);
        if (!Number.isFinite(pop) || pop < 0 || (st.ended !== undefined && y >= st.ended && pop !== 0)) cn++;
      }
    }
    for (const e of civ.annals) {
      if ((e.kind === 'sack' || e.kind === 'ruin' || e.kind === 'rebuild' || e.kind === 'decline') && civ.settlements[e.settlement]?.region !== e.region) cn++;
    }
    for (let q = 0; q < R.count; q++) if (civ.polity[q] < -1 || civ.polity[q] >= civ.polities.length || (civ.polity[q] >= 0 && civ.culture[q] < 0)) cn++;
    // 地理名:路径不能有 NaN,名字不能为空
    for (const pl of civ.places) {
      if (!pl.name) cn++;
      for (let k = 0; k < pl.path.length; k++) if (!Number.isFinite(pl.path[k])) cn++;
    }
    // 信仰:编号在范围内、年份有限且有序;检查点 + 补日志和从头翻日志一样;有文明就有信仰
    const rel = civ.religion;
    if (civ.viable && civ.cultures.length && !rel) cn++;
    if (rel) {
      const F = rel.faiths.length;
      rel.faiths.forEach((f, i) => {
        if (f.id !== i || !f.name || f.color.some((v) => !Number.isFinite(v))) cn++;
        if (f.kind !== 'folk' && !Number.isFinite(f.founded)) cn++;
        if (f.kind === 'great' && !civ.settlements[f.holy ?? -1]) cn++;
        if (f.kind === 'sect' && !(f.parent !== undefined && rel.faiths[f.parent]?.kind === 'great')) cn++;
      });
      for (let i = 0; i < rel.log.size; i++) {
        if (!Number.isFinite(rel.log.year[i]) || (i && rel.log.year[i] < rel.log.year[i - 1])) cn++;
        if (rel.log.value[i] < -1 || rel.log.value[i] >= F || !(rel.log.region[i] >= 0 && rel.log.region[i] < R.count)) cn++;
      }
      for (let i = 0; i < rel.events.length; i++) {
        const e = rel.events[i];
        if (!Number.isFinite(e.year) || (i && e.year < rel.events[i - 1].year) || !(e.faith >= 0 && e.faith < F) || e.polity >= civ.polities.length) cn++;
      }
      for (const st of rel.states) if (!civ.polities[st.polity] || !rel.faiths[st.faith] || (st.until !== undefined && !(st.until >= st.from))) cn++;
      const a = faithAt(civ, civ.endYear * 0.55);
      const b = faithFromScratch(civ, civ.endYear * 0.55);
      for (let q = 0; q < R.count; q++) if (a[q] !== b[q]) cn++;
    }
    cn += devBad(civ);
    // 国名、城名、城镇符号:国名的路径、字号不能有 NaN;排版 + 避让一帧的耗时(缩放 1 倍,Node 里,不含画)
    let labelMs = 0;
    for (const y of [civ.endYear * 0.6, civ.endYear]) {
      const l0 = performance.now();
      const lp = { world: w, raster: r, civ, style: 'fantasy' as const, year: y, show: { ...CIV_SHOW_OFF, labels: true, polities: true, routes: true } };
      const layer = civMapLayer(lp);
      const view = { ...labelViewExtras(lp), scale: 1326 / w.width, ox: 0, oy: 0, dpr: 1, k: 1, mapCss: 1326 };
      const placed = placeMap(civLabelItems(lp).concat(layer.items), layer.marks, view);
      labelMs = Math.max(labelMs, performance.now() - l0);
      for (const it of layer.items) {
        if (it.sizeWorld !== undefined && !(it.sizeWorld > 0)) cn++;
        for (let k = 0; k < it.path.length; k++) if (!Number.isFinite(it.path[k])) cn++;
      }
      for (const pl of placed.labels) for (const g of pl.glyphs) if (!Number.isFinite(g.x) || !Number.isFinite(g.y) || !Number.isFinite(g.a)) cn++;
    }
    worstLabels = Math.max(worstLabels, labelMs);
    // 战事:每场仗打完不早于开打;战线、双剑的坐标、浓淡不能有 NaN
    for (const s of warSpans(civ)) if (!(s.end >= s.start)) cn++;
    for (const y of [civ.endYear * 0.5, civ.endYear * 0.8, civ.endYear]) {
      const wp = { world: w, raster: r, civ, style: 'fantasy' as const, year: y, show: { ...CIV_SHOW_OFF, polities: true, wars: true } };
      for (const l of warFront(wp)) for (let k = 0; k < l.pts.length; k++) if (!Number.isFinite(l.pts[k])) cn++;
      for (const m of warMarkPoints(wp, true)) if (!Number.isFinite(m.x) || !Number.isFinite(m.y) || !(m.alpha > 0 && m.alpha <= 1)) cn++;
    }
    if (nan || rn || cn) process.exitCode = 1;
    const isDefaultCells = !('cells' in c) && !terrain;
    if (isDefaultCells) {
      worstHabReg = Math.max(worstHabReg, habReg);
      worstRoutes = Math.max(worstRoutes, routesMs);
      worstMap = Math.max(worstMap, t2 - t0);
    }
    if (civ.viable) noteRate(civ.endYear, civMs, `${caseName(c)} seed ${seed}`);
    worstFrame = Math.max(worstFrame, frameMs);
    console.log(
      caseName(c), 'seed', seed,
      `gen ${Math.round(t1 - t0)}ms raster ${Math.round(t2 - t1)}ms 文明 ${Math.round(civMs)}ms(宜居度+划州 ${Math.round(habReg)}ms · 推演 ${simMs.toFixed(1)}ms · 回放一帧 ${frameMs.toFixed(1)}ms · 道路 ${Math.round(routesMs)}ms · 国名城名排版 ${labelMs.toFixed(1)}ms)`,
      'land', (land / w.mesh.n).toFixed(2), 'rivers', w.rivers.length, 'max', Math.round(w.maxElevation),
      `州 ${R.count}${civ.viable ? '' : '(无文明)'} 民族 ${civ.cultures.length} 占据 ${hab ? Math.round((occ / hab) * 100) : 0}% 国家 ${civ.polities.length}(在世 ${ws.alive})城镇 ${civ.settlements.length} 路段 ${civ.routes.length} 地名 ${civ.places.length}`,
      `战争 ${ws.wars} 攻占 ${ws.conquests} 灭亡 ${ws.falls} 迁都 ${ws.capitalMoves} 飞地 ${(ws.exclaveShare * 100).toFixed(1)}% 易手频繁 ${ws.flippy}`,
      `分裂 ${ps.splits} 合并 ${ps.merges} 复国 ${ps.restorations} 主动迁都 ${ps.capitalMoves}`,
      `改朝换代 ${ds.eastern} 王室更迭 ${ds.western}`,
      `同化 ${asm.assimilated} 迁徙 ${asm.migrations} 波 ${asm.migrated} 州 改换过民族 ${(asm.changedShare * 100).toFixed(1)}% 消亡 ${asm.vanished}`,
      `洗劫 ${cs.sacks} 毁城 ${cs.ruins} 重建 ${cs.rebuilds} 遗址 ${cs.ruinsAtEnd} 旧都渐衰 ${cs.declines}`,
      `大教 ${rel?.faiths.filter((f) => f.kind === 'great').length ?? 0} 教派 ${rel?.faiths.filter((f) => f.kind === 'sect').length ?? 0} 宗教大事 ${rel?.events.length ?? 0}`,
      nan || rn || cn ? `NaN! ${nan}/${rn}/${cn}` : '',
    );
  });
}
// ---- 地形大事:极端的几种(整颗星球沉入海中、整片抬成陆地、五件最大最强的火山) ----
const UPHEAVAL_CASES: [string, Upheaval[]][] = [
  ['整颗星球沉入海中', [{ year: 1500, ops: rows('sink') }]],
  ['整片抬成陆地', [{ year: 300, ops: rows('raise') }]],
  [
    '五件火山(有同一年的)',
    [1, 1500, 1500, 2999, 1200].map((year, k): Upheaval => ({ year, ops: [{ kind: 'volcano', pts: [k * 410 + 100, (k * 397 + 200) % 1024], r: 160, s: 2 }] })),
  ],
];
for (const [name, list] of UPHEAVAL_CASES) {
  // 估的耗时(秒):整颗星球沉入海中的那组,第 1500 年以后没有陆地可推,最快
  const sec = list[0].ops[0].kind === 'sink' ? 5.5 : list[0].ops[0].kind === 'raise' ? 10.5 : 14;
  for (const seed of [3, 99]) group(`{"地形大事":"${name}"} seed ${seed}`, sec, () => {
    const params = { ...DEFAULT_PARAMS, seed };
    const t0 = performance.now();
    const w = generateWorld(params);
    const steps = upheavalSteps(params, [], null, list);
    const t1 = performance.now();
    const civ = generateCiv(w, { upheavals: steps });
    const t2 = performance.now();
    if (civ.viable) noteRate(civ.endYear, t2 - t1, `{"地形大事":"${name}"} seed ${seed}`);
    let cn = 0;
    const worlds = [w, ...steps.map((s) => s.world)];
    for (const x of worlds) for (let i = 0; i < x.mesh.n; i++) if (!Number.isFinite(x.elevation[i]) || !Number.isFinite(x.precipitation[i])) cn++;
    // 各段的州和那时的地形对得上(陆地都在州里、水不在);州的各项数值不是 NaN
    const eraRegions = [...(civ.eras ?? []).map((e) => e.regions), civ.regions];
    if (civ.viable && eraRegions.length !== worlds.length) cn++;
    eraRegions.forEach((R, k) => {
      const x = worlds[Math.min(k, worlds.length - 1)];
      for (let i = 0; i < x.mesh.n; i++) if ((x.water[i] === 0) !== (R.of[i] >= 0)) cn++;
      for (let q = 0; q < R.count; q++) if (!Number.isFinite(R.area[q]) || !Number.isFinite(R.capacity[q]) || !Number.isFinite(R.elevation[q])) cn++;
      if (k && R.count < eraRegions[k - 1].count) cn++;
    });
    const last = worlds[worlds.length - 1];
    // 史事有序;结束时还在的城在陆地上;在世的国家国都在本国,亡了的一州不剩
    for (let i = 1; i < civ.annals.length; i++) if (civ.annals[i].year < civ.annals[i - 1].year) cn++;
    for (const st of civ.settlements) {
      if (st.ended === undefined && last.water[st.cell] !== 0) cn++;
      if (!Number.isFinite(populationAt(st, civ.endYear)) || !st.name) cn++;
    }
    for (const po of civ.polities) {
      if (po.ended === undefined) {
        if (civ.polity[civ.settlements[capitalAt(po, civ.endYear)].region] !== po.id) cn++;
      } else if (civ.polity.includes(po.id)) cn++;
    }
    for (let q = 0; q < civ.regions.count; q++) if (civ.regions.cellStart[q + 1] === civ.regions.cellStart[q] && (civ.polity[q] >= 0 || civ.culture[q] >= 0)) cn++;
    const rel = civ.religion;
    if (rel) {
      const a = faithAt(civ, civ.endYear * 0.55);
      const b = faithFromScratch(civ, civ.endYear * 0.55);
      for (let q = 0; q < civ.regions.count; q++) if (a[q] !== b[q]) cn++;
    }
    cn += devBad(civ);
    const ch = buildChronicle(civ).filter((e) => e.kind === 'upheaval');
    if (civ.viable && civ.cultures.length && ch.length !== (civ.upheavals?.length ?? 0)) cn++;
    for (const e of ch) if (!e.text) cn++;
    if (cn) process.exitCode = 1;
    console.log(
      `{"地形大事":"${name}"}`, 'seed', seed,
      `生成各段地形 ${Math.round(t1 - t0)}ms 文明 ${Math.round(t2 - t1)}ms`,
      `段 ${worlds.length} 州 ${civ.regions.count} 国家 ${civ.polities.length}(在世 ${civ.polities.filter((p) => p.ended === undefined).length})城镇 ${civ.settlements.length}`,
      `大事 ${ch.map((e) => `${Math.floor(e.year)} ${e.text}`).join(' | ')}`,
      cn ? `NaN! ${cn}` : '',
    );
  });
}

// ---- 推演年数:推到最久(60000 年;再叠一件第 2999 年的地形大事):史事有序、国都在本国、人口不是 NaN、名字里不冒数字和 undefined ----
// 估的耗时(秒):带一件地形大事的那组最长,三分多钟
for (const [seed, ups] of [
  [7, []],
  [99, [{ year: 2999, ops: [{ kind: 'volcano', pts: [900, 400], r: 160, s: 2 }] }]],
] as [number, Upheaval[]][]) group(`{"推演年数":${END_YEAR_MAX}} seed ${seed}`, seed === 7 ? 120 : 205, () => {
  const params = { ...DEFAULT_PARAMS, seed };
  const w = generateWorld(params);
  const steps = upheavalSteps(params, [], null, ups);
  const t0 = performance.now();
  const civ = generateCiv(w, { endYear: END_YEAR_MAX, ...(steps.length ? { upheavals: steps } : {}) });
  const ms = performance.now() - t0;
  if (civ.viable) noteRate(civ.endYear, ms, `{"推演年数":${END_YEAR_MAX}} seed ${seed}`);
  let cn = 0;
  const bad =(s: string | undefined) => !!s && /\d|undefined|NaN/.test(s);
  for (let i = 1; i < civ.annals.length; i++) if (civ.annals[i].year < civ.annals[i - 1].year) cn++;
  for (const st of civ.settlements) if (!Number.isFinite(populationAt(st, civ.endYear)) || !st.name || bad(st.name)) cn++;
  for (const po of civ.polities) {
    if (bad(po.name) || (po.dynasties ?? []).some((d) => bad(d.name))) cn++;
    if (po.ended === undefined) {
      if (civ.polity[civ.settlements[capitalAt(po, civ.endYear)].region] !== po.id) cn++;
    } else if (civ.polity.includes(po.id)) cn++;
  }
  for (const x of civ.people ?? []) if (bad(x.name) || bad(x.title)) cn++;
  if (civ.religion) {
    const a = faithAt(civ, civ.endYear * 0.55);
    const b = faithFromScratch(civ, civ.endYear * 0.55);
    for (let q = 0; q < civ.regions.count; q++) if (a[q] !== b[q]) cn++;
  }
  cn += devBad(civ);
  const ch = buildChronicle(civ);
  for (const e of ch) if (!e.text || /undefined|NaN/.test(e.text)) cn++;
  if (civ.endYear !== END_YEAR_MAX) cn++;
  if (cn) process.exitCode = 1;
  console.log(
    `{"推演年数":${END_YEAR_MAX}}`, 'seed', seed, ups.length ? '带一件地形大事' : '',
    `文明 ${Math.round(ms)}ms 国家 ${civ.polities.length}(在世 ${civ.polities.filter((p) => p.ended === undefined).length})城镇 ${civ.settlements.length} 人物 ${civ.people?.length ?? 0} 纪事 ${ch.length}`,
    cn ? `NaN! ${cn}` : '',
  );
});

// ---- 「天灾 很多」推 12000 年,第 600 年再下一场最重、无人收拾 60 年的全球大疫:史事有序、人口和发展度不是 NaN、
// 全球大疫里一城最多死六成、天下人口不低于疫前一半、还有国家在、纪事里不冒 undefined / NaN ----
for (const seed of [7, 99]) group(`{"天灾":"很多","推演年数":12000} seed ${seed}`, 23.5, () => {
  const w = generateWorld({ ...DEFAULT_PARAMS, seed });
  const probe = generateCiv(w, { endYear: 600 });
  const town = probe.settlements.filter((s) => s.ended === undefined).sort((a, b) => populationAt(b, 600) - populationAt(a, 600))[0];
  const iv: Intervention[] = town ? [{ kind: 'disaster', type: 'pandemic', level: 3, from: 600, city: settlementKey(probe, town.id), slump: 60 }] : [];
  const t0 = performance.now();
  const civ = generateCiv(w, { endYear: 12000, calamity: 'many', interventions: iv });
  const ms = performance.now() - t0;
  let cn = 0;
  for (let i = 1; i < civ.annals.length; i++) if (civ.annals[i].year < civ.annals[i - 1].year) cn++;
  for (const st of civ.settlements) for (const y of [civ.endYear * 0.3, civ.endYear]) if (!Number.isFinite(populationAt(st, y))) cn++;
  cn += devBad(civ);
  const list = pandemicsOf(civ);
  for (const p of list) {
    for (const h of p.hits) if (!(h.loss > 0 && h.loss <= 0.6)) cn++;
    let pop = 0;
    for (let r = 0; r < civ.regions.count; r++) pop += regionPopulationAt(civ, r, Math.min(civ.endYear, p.end));
    if (!(pop > 0.5 * p.pre)) cn++;
  }
  if (!civ.polities.some((q) => q.ended === undefined)) cn++;
  const ch = buildChronicle(civ);
  for (const e of ch) if (!e.text || /undefined|NaN/.test(e.text)) cn++;
  if (cn) process.exitCode = 1;
  console.log(
    '{"天灾":"很多","推演年数":12000}', 'seed', seed, iv.length ? '第 600 年最重的全球大疫' : '',
    `文明 ${Math.round(ms)}ms(每秒 ${Math.round(civ.endYear / (ms / 1000))} 年)全球大疫 ${list.length} 场 国家在世 ${civ.polities.filter((p) => p.ended === undefined).length} 纪事 ${ch.length}`,
    cn ? `NaN! ${cn}` : '',
  );
});

// ---- 接着推和一口气推完一样(随机自查,scripts/lib/resumeFuzz.ts):逐年推演一步随机推 1–60 年、每停一下随机下各种命令,
// 推到第 3000 年,和带着同样的命令一口气推完逐字段比(默认参数 10 个种子、自定义参数 2 个、小世界 2 个、「天灾 很多」2 个;单测里另跑 3 个推到第 2000 年) ----
const FUZZ: FuzzCase[] = [
  ...[1, 3, 5, 7, 11, 12, 31, 42, 99, 2024].map((seed) => ({ seed, to: 3000 })),
  ...[6, 23].map((seed) => ({ seed, to: 3000, params: { polities: 12, cultures: 8, pace: 1.3 } })),
  ...[8, 77].map((seed) => ({ seed, to: 3000, cells: 12000 })),
  ...[13, 2025].map((seed) => ({ seed, to: 3000, params: { calamity: 'many' as const } })),
];
for (const c of FUZZ) {
  const label = `{"接着推随机自查":${JSON.stringify({ ...(c.params ?? {}), ...(c.cells ? { cells: c.cells } : {}) })}}`;
  // 估的耗时(秒):小世界最快,「天灾 很多」最慢
  group(`${label} seed ${c.seed}`, c.cells ? 25 : c.params?.calamity ? 50 : c.params ? 42 : 46, () => {
    const t0 = performance.now();
    const r = fuzzResume(c);
    if (r.diff) process.exitCode = 1;
    console.log(
      label, 'seed', c.seed,
      `${Math.round(performance.now() - t0)}ms 推了 ${r.steps} 步 命令 ${r.commands} 条 作者的干预 ${r.author} 条`,
      r.diff ? `和一口气推完不一样!\n${r.diff}` : '逐字段一致',
    );
  });
}

// ---- 带地形大事的世界:大事那一刻接着推和一口气推完一样(scripts/lib/resumeFuzz.ts 的 fuzzUpheavalResume):
// 随机几年各放一件不改海陆的大事,带着作者的干预和随机命令,和没有大事时逐项比(单测里另跑几个种子) ----
for (const seed of [2, 4, 9, 13, 27, 64]) group(`{"大事那一刻接着推随机自查":{}} seed ${seed}`, 27, () => {
  const t0 = performance.now();
  const r = fuzzUpheavalResume(seed);
  if (r.diff) process.exitCode = 1;
  console.log(
    '{"大事那一刻接着推随机自查":{}}', 'seed', seed,
    `${Math.round(performance.now() - t0)}ms 大事 ${r.years.join('、')} 年 命令 ${r.commands} 条`,
    r.diff ? `和一口气推完不一样!\n${r.diff}` : '逐项一致',
  );
});

// ---- 分份(见 group):从估时最长的组往下,每组给当前累计最少的那份 ----
/** 各份已分到的估计耗时(秒) */
const load: number[] = new Array(PARTS).fill(0);
/** 每组分到第几份(从 0 数) */
const partOf: number[] = [];
for (const i of groups.map((_, i) => i).sort((a, b) => groups[b].sec - groups[a].sec || a - b)) {
  let k = 0;
  for (let p = 1; p < PARTS; p++) if (load[p] < load[k]) k = p;
  load[k] += groups[i].sec;
  partOf[i] = k;
}
if (DRY) {
  groups.forEach((g, i) => console.log(`第 ${partOf[i] + 1} 份 估 ${g.sec} 秒 ${g.name}`));
  console.log(`共 ${groups.length} 组;${load.map((sec, k) => `第 ${k + 1} 份 ${partOf.filter((p) => p === k).length} 组 估 ${sec} 秒`).join(',')}`);
} else {
  /** 本份各组:名字、估时、实际用了几秒 */
  const spent: { name: string; sec: number; real: number }[] = [];
  groups.forEach((g, i) => {
    if (partOf[i] !== PART - 1) return;
    const t0 = performance.now();
    g.run();
    spent.push({ name: g.name, sec: g.sec, real: (performance.now() - t0) / 1000 });
  });

  // ---- 速度汇总:只报告,不改退出码(预算和来历见 SPEED_BUDGET) ----
  const over: string[] = [];
  /** 一项最慢的耗时和预算;超了记下,后面写"超预算" */
  const vsBudget = (label: string, ms: number, budget: number, digits = 0) => {
    if (ms > budget) over.push(label);
    return `${label}最慢 ${ms.toFixed(digits)}ms(预算 ${budget}ms${ms > budget ? ',超预算' : ''})`;
  };
  console.log('\n速度(只报告,超预算不影响检查结果):');
  console.log(
    `默认精细度下:${vsBudget('地图(生成 + 铺像素)', worstMap, SPEED_BUDGET.map)};${vsBudget('宜居度+划州', worstHabReg, SPEED_BUDGET.habReg)};${vsBudget('道路', worstRoutes, SPEED_BUDGET.routes)}`,
  );
  if (Number.isFinite(slowestRate)) {
    const slow = slowestRate < SPEED_BUDGET.yearsPerSec;
    if (slow) over.push('推演速度');
    console.log(
      `推演速度(推到的年数 ÷ 文明这一步的耗时)最慢 ${Math.round(slowestRate)} 年/秒(预算至少 ${SPEED_BUDGET.yearsPerSec} 年/秒${slow ? ',超预算' : ''}),是 ${slowestRateCase}`,
    );
  }
  console.log(
    `所有参数下:${vsBudget('回放一帧(归属 + 国界 + 半分辨率色块,Node 里)', worstFrame, SPEED_BUDGET.frame, 1)};国名、城名、城镇符号排版 + 避让(缩放 1 倍,含国土栅格首次计算)最慢 ${worstLabels.toFixed(1)}ms`,
  );
  if (over.length) {
    console.log(`${over.length} 项超预算:${over.join('、')}`);
    // GitHub 的检查页上挂一条提醒(不算失败)
    if (process.env.GITHUB_ACTIONS) console.log(`::warning title=压力测试速度::${over.join('、')} 超预算(只报告,不影响检查结果)`);
  }
  // ---- 本份估时和实际:机器快慢不一,先按整份的倍数折算,再看哪几组和估时差得最多 ----
  if (spent.length) {
    const est = spent.reduce((a, x) => a + x.sec, 0);
    const real = spent.reduce((a, x) => a + x.real, 0);
    const k = real / est;
    const off = [...spent].sort((a, b) => Math.abs(b.real - b.sec * k) - Math.abs(a.real - a.sec * k)).slice(0, 3);
    console.log(
      `\n这一份 ${spent.length} 组:估 ${Math.round(est)} 秒,实际 ${Math.round(real)} 秒,这台机器约是估时的 ${k.toFixed(2)} 倍;` +
        `按这个倍数折算后和估时差得最多的:${off.map((x) => `${x.name} 估 ${x.sec} 秒(折算 ${(x.sec * k).toFixed(1)} 秒)实际 ${x.real.toFixed(1)} 秒`).join(';')}`,
    );
  }
}
