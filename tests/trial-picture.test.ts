import { describe, expect, it } from 'vitest';
import {
  PANEL_AREA,
  WIN_SHARE,
  climateSpots,
  compareSquare,
  firstFilled,
  fitArea,
  inRect,
  lastFilled,
  layerSpots,
  layerWindow,
  legendOf,
  paintFilled,
  patchWindow,
  pickChange,
  pickChronicle,
  pickVs,
  pointsWindow,
  terrainSpots,
  vsText,
  type Spots,
} from '../src/plugin/trialPicture';

const W = 2048;
const H = 1024;
/** 网格上的地块:每 16 个世界单位一个,落在格子正中 */
const GX = 128;
const GY = 64;
const n = GX * GY;
const x = new Float32Array(n);
const y = new Float32Array(n);
for (let j = 0; j < GY; j++) for (let i = 0; i < GX; i++) [x[j * GX + i], y[j * GX + i]] = [8 + 16 * i, 8 + 16 * j];
const mesh = { n, width: W, height: H, x, y };
const at = (wx: number, wy: number) => Math.floor(wy / 16) * GX + Math.floor(wx / 16);

/** 在这几片矩形里的地块标上(世界坐标 [x0, x1) × [y0, y1),x 可以跨过接缝) */
function spotsIn(...boxes: [number, number, number, number][]): Spots {
  const on = new Uint8Array(n);
  for (const [x0, y0, x1, y1] of boxes)
    for (let i = 0; i < n; i++) {
      const dx = (((x[i] - x0) % W) + W) % W;
      if (dx < x1 - x0 && y[i] >= y0 && y[i] < y1) on[i] = 1;
    }
  return { has: on, hot: on };
}

describe('一片一片的东西放大到哪', () => {
  it('有值的地块超过全图四分之一画整张,不到就用全图宽四分之一、2:1 的窗', () => {
    expect(patchWindow(mesh, spotsIn([0, 0, W, H * 0.26]))).toBeNull();
    const r = patchWindow(mesh, spotsIn([600, 400, 700, 460]))!;
    expect(r.w).toBe(W * WIN_SHARE);
    expect(r.h).toBe(r.w / 2);
    // 那一片在窗正中
    // 窗的边落在 16 一格的格子线上:差不过半格
    expect(Math.abs(r.x + r.w / 2 - 648)).toBeLessThanOrEqual(8);
    expect(Math.abs(r.y + r.h / 2 - 432)).toBeLessThanOrEqual(8);
  });

  it('取显眼的地块最多的位置;只有有值、没有显眼的按有值的找', () => {
    const s = spotsIn([100, 300, 160, 340], [1500, 500, 1700, 600]);
    const r = patchWindow(mesh, s)!;
    expect(inRect(r, 1600, 550, W)).toBe(true);
    const hotSmall = { has: s.has, hot: spotsIn([100, 300, 160, 340]).hot };
    expect(inRect(patchWindow(mesh, hotSmall), 130, 320, W)).toBe(true);
    expect(inRect(patchWindow(mesh, { has: s.has, hot: new Uint8Array(n) }), 1600, 550, W)).toBe(true);
  });

  it('并列时让这些地块最居中,再并列取最左上的', () => {
    // 一小块:好多位置都能整块框进去,取它在正中的
    const r = patchWindow(mesh, spotsIn([992, 496, 1024, 528]))!;
    expect(r.x + r.w / 2).toBeCloseTo(1008, 0);
    expect(r.y + r.h / 2).toBeCloseTo(512, 0);
    // 一样多、一样居中的两片:取左边的
    const two = patchWindow(mesh, spotsIn([400, 400, 432, 432], [1600, 400, 1632, 432]))!;
    expect(inRect(two, 416, 416, W)).toBe(true);
  });

  it('窗的中心不进最北、最南各八分之一', () => {
    const r = patchWindow(mesh, spotsIn([500, 1000, 560, 1024]))!;
    const cy = r.y + r.h / 2;
    expect(cy).toBeLessThanOrEqual(H * (7 / 8) + 1e-6);
    expect(cy).toBeGreaterThanOrEqual(H / 8 - 1e-6);
    expect(r.y + r.h).toBeLessThanOrEqual(H + 1e-6);
  });

  it('跨过东西接缝的一片也框得住', () => {
    const r = patchWindow(mesh, spotsIn([2000, 500, 2048 + 48, 540]))!;
    expect(inRect(r, 2020, 520, W)).toBe(true);
    expect(inRect(r, 30, 520, W)).toBe(true);
  });

  it('左右对比用的正方形窗直接按正方形找:分开的两片也框得住一片', () => {
    const s = spotsIn([592, 496, 608, 512], [992, 496, 1008, 512]);
    const r = patchWindow(mesh, s, true)!;
    expect(r.w).toBe(W * WIN_SHARE * 0.5);
    expect(r.h).toBe(r.w);
    expect(compareSquare(r, W, H)).toEqual(r);
    expect(inRect(r, 600, 504, W) || inRect(r, 1000, 504, W)).toBe(true);
  });

  it('一块有值的都没有 = null', () => {
    expect(patchWindow(mesh, { has: new Uint8Array(n), hot: new Uint8Array(n) })).toBeNull();
  });

  it('按州、按年份的图层占 18% 也画整张;按地块的图层占 18% 照旧放大', () => {
    const s = spotsIn([512, 256, 1248, 768]);
    expect(Math.round((s.has.reduce((a, b) => a + b, 0) / n) * 100)).toBe(18);
    const values = new Float32Array(n).fill(NaN);
    for (let i = 0; i < n; i++) if (s.has[i]) values[i] = (i % 6) + 1;
    const paint = { values, ramp: { colors: ['#c7e9b4', '#0c2c84'], min: 0, max: 6 } };
    expect(layerWindow(mesh, { kind: 'regions', years: [0, 50, 3000] }, paint)).toBeNull();
    expect(layerWindow(mesh, { unit: 'region', years: [0, 50, 3000] }, paint)).toBeNull();
    const r = layerWindow(mesh, { kind: 'cells' }, paint)!;
    expect(r.w).toBe(W * WIN_SHARE);
    expect(r.h).toBe(r.w / 2);
    expect(layerWindow(mesh, { unit: 'cell' }, paint)).toEqual(r);
    expect(layerWindow(mesh, { unit: 'cell', years: [0, 50] }, paint)).toEqual(r);
    expect(layerWindow(mesh, { title: '潮差' }, paint)).toEqual(r);
  });
});

describe('哪些地块算显眼', () => {
  it('数值图层:落在色带上面三分之一的;分类图层:值对得上某一类的;全是空的当没有', () => {
    const v = new Float32Array([0, 50, 66, 67, 100, NaN]);
    const s = layerSpots({ values: v, ramp: { colors: ['#000000', '#ffffff'], min: 0, max: 100 } });
    expect([...s.has]).toEqual([1, 1, 1, 1, 1, 0]);
    expect([...s.hot]).toEqual([0, 0, 0, 1, 1, 0]);
    const c = layerSpots({ values: new Float32Array([0, 1, 2, NaN]), classes: [{ value: 1, color: '#ff0000', label: 'a' }, { value: 2, color: '#00ff00', label: 'b' }] });
    expect([...c.hot]).toEqual([0, 1, 1, 0]);
    expect(paintFilled({ values: new Float32Array([NaN, NaN]), ramp: { colors: ['#000000', '#ffffff'] } })).toBe(false);
    expect(paintFilled({ values: new Float32Array([5]), classes: [{ value: 1, color: '#ff0000', label: 'a' }] })).toBe(false);
  });

  it('改地形:陆地上海拔差 100 米以上或海陆湖变了(海底变深不算);改气候:降水差 100 毫米以上而且过两成', () => {
    const a = { elevation: new Float32Array([0, 100, 200, 300, -2000]), water: new Uint8Array([0, 0, 0, 0, 1]), precipitation: new Float32Array([1000, 1000, 100, 2000, 0]) };
    const b = { elevation: new Float32Array([50, 250, 200, 300, -3000]), water: new Uint8Array([0, 0, 0, 1, 1]), precipitation: new Float32Array([1050, 1300, 250, 2300, 0]) };
    expect([...terrainSpots(a, b).hot]).toEqual([0, 1, 0, 1, 0]);
    expect([...climateSpots(a, b).hot]).toEqual([0, 1, 1, 0, 0]);
  });

  it('比哪样:地形真改了比地形图;清单写了改地形但地形没改、降水改了的比降水图;都没改 = null', () => {
    const a = { elevation: new Float32Array([100, 200]), water: new Uint8Array([0, 0]), precipitation: new Float32Array([1000, 1000]) };
    const terrain = { ...a, elevation: new Float32Array([400, 200]) };
    const rain = { ...a, precipitation: new Float32Array([1000, 1500]) };
    expect(pickChange(['height', 'climate'], a, terrain)?.view).toBe('terrain');
    expect(pickChange(['height', 'climate'], a, rain)?.view).toBe('precipitation');
    expect(pickChange(['height'], a, rain)).toBeNull();
    expect(pickChange(['layers'], a, terrain)).toBeNull();
  });
});

describe('有确切位置的东西放大到哪', () => {
  it('外接框四周留 15%,撑成 2:1,不小于全图宽四分之一', () => {
    const r = pointsWindow(
      [
        [700, 400],
        [1100, 450],
      ],
      W,
      H,
    )!;
    expect(r.w).toBeCloseTo(400 / 0.7, 5);
    expect(r.h).toBeCloseTo(r.w / 2, 5);
    expect(r.x + r.w / 2).toBeCloseTo(900, 5);
    expect(r.y + r.h / 2).toBeCloseTo(425, 5);
    // 一个点:全图宽四分之一
    expect(pointsWindow([[1000, 500]], W, H)!.w).toBe(W * WIN_SHARE);
    // 竖着排开的:按高撑宽
    const tall = pointsWindow(
      [
        [1000, 400],
        [1000, 600],
      ],
      W,
      H,
    )!;
    expect(tall.h).toBeCloseTo(200 / 0.7, 5);
  });

  it('超过全图一半画整张;上下不出图', () => {
    expect(
      pointsWindow(
        [
          [100, 500],
          [900, 500],
        ],
        W,
        H,
      ),
    ).toBeNull();
    const r = pointsWindow([[1000, 1010]], W, H)!;
    expect(r.y + r.h).toBeCloseTo(H, 5);
  });

  it('跨过东西接缝的取最窄的一段', () => {
    const r = pointsWindow(
      [
        [2000, 500],
        [40, 500],
      ],
      W,
      H,
    )!;
    expect(r.w).toBe(W * WIN_SHARE);
    expect(inRect(r, 2000, 500, W) && inRect(r, 40, 500, W)).toBe(true);
  });

  it('有面板时看的东西落在面板左边;字幕那条让开', () => {
    const pts: [number, number][] = [
      [900, 500],
      [1000, 520],
    ];
    const card = pointsWindow(pts, W, H, PANEL_AREA.card)!;
    const map = pointsWindow(pts, W, H, PANEL_AREA.map)!;
    for (const [r, area] of [
      [card, PANEL_AREA.card],
      [map, PANEL_AREA.map],
    ] as const) {
      for (const [px] of pts) expect((px - r.x) / r.w).toBeLessThanOrEqual(area.x1 + 1e-9);
    }
    expect(map.w).toBeGreaterThanOrEqual(card.w);
    const sub = pointsWindow(pts, W, H, { x0: 0, y0: 0, x1: 1, y1: 0.8 })!;
    for (const [, py] of pts) expect((py - sub.y) / sub.h).toBeLessThan(0.8);
  });

  it('要框的超过一半、又有面板时:画整张,但转到它对着面板左边那块的正中', () => {
    const pts: [number, number][] = [
      [1500, 300],
      [2048 + 300, 600],
    ];
    expect(pointsWindow(pts, W, H)).toBeNull();
    const r = pointsWindow(pts, W, H, PANEL_AREA.map)!;
    expect(r.w).toBe(W);
    expect(r.h).toBe(H);
    // 两点正中(x = 1924)在画面上落在面板左边那块的正中
    expect((((1924 - r.x) % W) + W) % W).toBeCloseTo(((PANEL_AREA.map.x0 + PANEL_AREA.map.x1) / 2) * W, 5);
  });

  it('fitArea:一片放进画面的一块,不改它的大小比例', () => {
    const r = fitArea({ x: 100, y: 200, w: 512, h: 256 }, W, H)!;
    expect(r).toEqual({ x: 100, y: 200, w: 512, h: 256 });
    const half = fitArea({ x: 100, y: 200, w: 512, h: 256 }, W, H, { x0: 0, y0: 0, x1: 0.5, y1: 1 })!;
    expect(half.w).toBe(1024);
    expect(half.x).toBe(100);
  });
});

describe('左右对比的正方形', () => {
  it('放大那一片正中、边长等于它的高;画整张时取图正中', () => {
    expect(compareSquare({ x: 100, y: 200, w: 512, h: 256 }, W, H)).toEqual({ x: 228, y: 200, w: 256, h: 256 });
    expect(compareSquare(null, W, H)).toEqual({ x: 512, y: 0, w: 1024, h: 1024 });
  });
});

describe('挑哪个', () => {
  it('工具取最后加上的、地图推演取最前面的;画不出东西的当没有', () => {
    const list = [{ id: 'a', ok: true }, { id: 'b', ok: true }, { id: 'c', ok: false }];
    expect(lastFilled(list, (l) => l.ok)?.id).toBe('b');
    expect(firstFilled(list, (l) => l.ok)?.id).toBe('a');
    expect(firstFilled(list, () => false)).toBeNull();
  });

  it('编年史:提到的国家那一年都在的里取最早的;一条都不行 = null', () => {
    const alive: Record<number, [number, number]> = { 1: [0, 3000], 2: [0, 1000], 3: [1200, 3000] };
    const here = (p: number, year: number) => !!alive[p] && year >= alive[p][0] && year < alive[p][1];
    const entries = [
      { year: 900, text: '没提到国家', polities: [] },
      { year: 1500, text: '1 和 3', polities: [1, 3] },
      { year: 1100, text: '2 已经没了', polities: [1, 2] },
      { year: 1300, text: '1 和 3 早一点', polities: [3, 1] },
      { year: 1300, text: '同一年后写的', polities: [1] },
    ];
    expect(pickChronicle(entries, here)?.text).toBe('1 和 3 早一点');
    expect(pickChronicle(entries.slice(0, 1), here)).toBeNull();
    expect(pickChronicle([{ year: 1100, text: 'x', polities: [2] }], here)).toBeNull();
  });

  it('和不装比:只比清单碰得到的,取相差最大的;不到一成或不到 3 次不写', () => {
    const off = { wars: 246, fallen: 40, splits: 20, dynasties: 30, plagues: 98 };
    // 厌战:只碰仗
    expect(pickVs(off, { ...off, wars: 173, plagues: 60 }, ['war.odds', 'treaty'])).toEqual({ key: 'wars', from: 246, to: 173 });
    // 只碰仗、差不到一成:不写(瘟疫差得多也不算它的)
    expect(pickVs(off, { ...off, wars: 249, plagues: 86 }, ['unrest.add', 'assim.rate', 'war.odds', 'declare', 'ally'])).toBeNull();
    // 碰好几项,取相差(按不装的比)最大的
    expect(pickVs(off, { ...off, wars: 300, fallen: 60 }, ['declare', 'destroy'])).toEqual({ key: 'fallen', from: 40, to: 60 });
    // 并列按先后:仗在灭国前面
    expect(pickVs({ ...off, wars: 10, fallen: 10 }, { ...off, wars: 15, fallen: 15 }, ['war.power', 'cede'])?.key).toBe('wars');
    // 不到 3 次
    expect(pickVs({ ...off, dynasties: 1 }, { ...off, dynasties: 3 }, ['dynasty.odds'])).toBeNull();
    // 不装是 0 的按 1 算
    expect(pickVs({ ...off, splits: 0 }, { ...off, splits: 3 }, ['found'])).toEqual({ key: 'splits', from: 0, to: 3 });
    expect(vsText({ key: 'wars', from: 246, to: 173 }, 3000)).toBe('和不装比：3000 年里 仗 246 → 173 场');
    expect(vsText({ key: 'plagues', from: 98, to: 86 }, 3000)).toBe('和不装比：3000 年里 瘟疫 98 → 86 回');
  });
});

describe('图例', () => {
  it('渐变:两头的数,数据超出的写「以上」「以下」', () => {
    const l = legendOf({ title: '各国人口密度', legend: '人/平方公里' }, { values: new Float32Array([0, 3, 9, NaN]), ramp: { colors: ['#ffffff', '#000000'], min: 0, max: 6 } });
    expect(l).toEqual({ title: '各国人口密度', sub: '人/平方公里', ramp: { colors: ['#ffffff', '#000000'], lo: '0', hi: '6 以上' } });
    const t = legendOf({ title: '潮差', legend: '米' }, { values: new Float32Array([0.6, 1.5]), ramp: { colors: ['#ffffff', '#000000'], min: 0.5, max: 2 } });
    // 一两个字的说明当单位,写在数后面
    expect(t).toEqual({ title: '潮差', sub: '', ramp: { colors: ['#ffffff', '#000000'], lo: '0.5 米', hi: '2 米' } });
  });

  it('分类:不多于 8 类照写;多了列这一片里占地最多的 8 类', () => {
    const few = legendOf({ title: '离海多远', legend: '走陆路到海边' }, { values: new Float32Array([0, 1]), classes: [{ value: 0, color: '#111111', label: '100 公里以内' }, { value: 1, color: '#222222', label: '100–250 公里' }] });
    expect(few.sub).toBe('走陆路到海边');
    expect(few.rows?.map((r) => r.label)).toEqual(['100 公里以内', '100–250 公里']);
    const classes = Array.from({ length: 12 }, (_, k) => ({ value: k, color: '#000000', label: `第 ${k} 类` }));
    // 第 k 类有 k 块;第 11 类的地块都不在这一片里
    const values: number[] = [];
    for (let k = 0; k < 12; k++) for (let i = 0; i < k; i++) values.push(k);
    const shown = (c: number) => values[c] !== 11;
    const many = legendOf({ title: '柯本气候', legend: '分类' }, { values: new Float32Array(values), classes }, shown);
    expect(many.sub).toBe('12 类，这里是占地最多的 8 类');
    expect(many.rows?.map((r) => r.label)).toEqual(['第 3 类', '第 4 类', '第 5 类', '第 6 类', '第 7 类', '第 8 类', '第 9 类', '第 10 类']);
  });
});

describe('在不在这一片里', () => {
  it('东西照接缝', () => {
    const r = { x: 1900, y: 100, w: 300, h: 150 };
    expect(inRect(r, 2000, 150, W)).toBe(true);
    expect(inRect(r, 100, 150, W)).toBe(true);
    expect(inRect(r, 200, 150, W)).toBe(false);
    expect(inRect(r, 2000, 300, W)).toBe(false);
    expect(inRect(null, 5, 5, W)).toBe(true);
  });
});

void at;
