/**
 * 经纬网的度数(src/ui/gratLabels.ts):写法、隔几条写一个随缩放变、字和刻度对着线、东西相连时转一圈还是同一套。
 */
import { describe, expect, it } from 'vitest';
import { latText, layoutGratLabels, lonText, type GratSpec } from '../src/ui/gratLabels';
import { mapProj } from '../src/render/projection';
import { worldToStage, type StageBox } from '../src/ui/mapWrap';

const W = 2048;
const H = 1024;
/** 新建世界摊平改地形的框:电脑 944 × 472、手机 362 × 181(舞台就是框) */
const desk: StageBox = { sw: 944, sh: 472, bw: 944, bh: 472 };
const phone: StageBox = { sw: 362, sh: 181, bw: 362, bh: 181 };
const four: GratSpec = { fs: 11, lon: [{ side: 'top', out: true }, { side: 'bottom', out: true }], lat: [{ side: 'left', out: true }, { side: 'right', out: true }] };
const phoneSpec: GratSpec = { fs: 10, lon: [{ side: 'bottom', out: true }], lat: [{ side: 'left', out: false }] };

describe('度数写法', () => {
  it('经度 120°E / 60°W / 0° / 180°,纬度 30°N / 60°S / 0°', () => {
    expect(lonText(120)).toBe('120°E');
    expect(lonText(-60)).toBe('60°W');
    expect(lonText(0)).toBe('0°');
    expect(lonText(-180)).toBe('180°');
    expect(lonText(240)).toBe('120°W');
    expect(latText(30)).toBe('30°N');
    expect(latText(-60)).toBe('60°S');
    expect(latText(0)).toBe('0°');
  });
});

describe('隔几条写一个(和设计稿的表一致)', () => {
  const every = (b: StageBox, k: number, step: number, spec: GratSpec) => {
    const g = layoutGratLabels(W, H, { k, x: (b.sw * (1 - k)) / 2, y: (b.sh * (1 - k)) / 2 }, b, null, step, spec)!;
    return [g.lonEvery, g.latEvery];
  };
  it('电脑放大 1 倍:30° 每条都写,15° 经度每 30°,10° 经度每 20°;纬度每条都写', () => {
    expect(every(desk, 1, 30, four)).toEqual([30, 30]);
    expect(every(desk, 1, 15, four)).toEqual([30, 15]);
    expect(every(desk, 1, 10, four)).toEqual([20, 10]);
  });
  it('电脑放大 2 倍:每条都写', () => {
    expect(every(desk, 2, 30, four)).toEqual([30, 30]);
    expect(every(desk, 2, 15, four)).toEqual([15, 15]);
    expect(every(desk, 2, 10, four)).toEqual([10, 10]);
  });
  it('手机放大 1 倍:经度每 60°;纬度 30° 每条、15° 每 30°、10° 每 20°', () => {
    expect(every(phone, 1, 30, phoneSpec)).toEqual([60, 30]);
    expect(every(phone, 1, 15, phoneSpec)).toEqual([60, 30]);
    expect(every(phone, 1, 10, phoneSpec)).toEqual([60, 20]);
  });
  it('手机放大 3 倍:30°、15° 每条都写,10° 经度每 20°', () => {
    expect(every(phone, 3, 30, phoneSpec)).toEqual([30, 30]);
    expect(every(phone, 3, 15, phoneSpec)).toEqual([15, 15]);
    expect(every(phone, 3, 10, phoneSpec)).toEqual([20, 10]);
  });
});

describe('字和刻度对着线', () => {
  it('框外四边:经度上下各一份、纬度左右各一份,刻度在框边外面,0° 一定写', () => {
    const v = { k: 1, x: -249, y: 0 };
    const g = layoutGratLabels(W, H, v, desk, null, 30, four)!;
    const lon = g.texts.filter((t) => t.text.endsWith('E') || t.text.endsWith('W') || t.text === '180°');
    const lat = g.texts.filter((t) => t.text.endsWith('N') || t.text.endsWith('S'));
    expect(g.texts.filter((t) => t.text === '0°' && t.eq)).toHaveLength(4);
    expect(g.texts.every((t) => t.out)).toBe(true);
    // 每条经线上下各写一次:字的 x 就是那条经线在屏幕上的 x
    for (const t of lon) {
      const lonDeg = t.text === '180°' ? 180 : Number(t.text.slice(0, -2)) * (t.text.endsWith('W') ? -1 : 1);
      const wx = ((lonDeg + 180) / 360) * W;
      const xs = [-1, 0, 1].map((n) => worldToStage(wx + n * W, 0, v, desk, W, H)[0]);
      expect(xs.some((x) => Math.abs(x - t.x) < 1e-6)).toBe(true);
      expect(t.y < 0 || t.y > desk.sh).toBe(true);
    }
    expect(lat.length).toBe(4 * 2);
    for (const k of g.ticks) expect(k.x + k.w <= 0 || k.x >= desk.sw || k.y + k.h <= 0 || k.y >= desk.sh).toBe(true);
  });
  it('左右拖一整圈:写的字和位置不变', () => {
    const v = { k: 2, x: -500, y: -100 };
    const a = layoutGratLabels(W, H, v, desk, null, 15, four)!;
    const b = layoutGratLabels(W, H, { ...v, x: v.x - 2 * desk.bw }, desk, null, 15, four)!;
    const key = (g: typeof a) => g.texts.map((t) => `${t.text}@${t.x.toFixed(3)},${t.y.toFixed(3)}`).sort();
    expect(key(b)).toEqual(key(a));
  });
  it('手机:纬度写在地图里贴着左边,离上边太近的不写', () => {
    const g = layoutGratLabels(W, H, { k: 1, x: 0, y: 0 }, phone, null, 30, phoneSpec)!;
    const lat = g.texts.filter((t) => !t.out);
    expect(lat.map((t) => t.text)).toEqual(['60°N', '30°N', '0°', '30°S', '60°S']);
    for (const t of lat) expect(t.x).toBe(4);
  });
  it('隔一条写一个时从 0° 起算:每隔 10° 的网格写成 60°N、40°N、20°N、0°……', () => {
    const g = layoutGratLabels(W, H, { k: 1, x: 0, y: 0 }, phone, null, 10, phoneSpec)!;
    expect(g.latEvery).toBe(20);
    expect(g.texts.filter((t) => !t.out).map((t) => t.text)).toEqual(['60°N', '40°N', '20°N', '0°', '20°S', '40°S', '60°S', '80°S']);
  });
  it('框外的字不出窗口:贴边的字往里挪,刻度照样对着线', () => {
    const v = { k: 1, x: 0, y: 0 };
    const spec = { ...phoneSpec, outX: [-14, 376] as [number, number] };
    const g = layoutGratLabels(W, H, v, phone, null, 30, spec)!;
    for (const t of g.texts.filter((t) => t.out)) {
      const half = t.text.length * 0.3 * 10;
      expect(t.x - half).toBeGreaterThanOrEqual(-14);
      expect(t.x + half).toBeLessThanOrEqual(376);
    }
  });
});

describe('主地图(写在地图里)', () => {
  const main: StageBox = { sw: 1600, sh: 900, bw: 1800, bh: 900 };
  const spec: GratSpec = { fs: 11, area: [386, 64, 1600, 796], lonInRight: 1504, lon: [{ side: 'bottom', out: false }], lat: [{ side: 'left', out: false }] };
  it('纬度贴着侧栏右边、经度贴着时间轴上面,右下角的按钮让开', () => {
    const g = layoutGratLabels(W, H, { k: 1, x: 0, y: 0 }, main, null, 30, spec)!;
    const lat = g.texts.filter((t) => /[NS]$/.test(t.text) || (t.text === '0°' && t.x === 390));
    expect(lat.length).toBeGreaterThan(0);
    for (const t of lat) expect(t.x).toBe(390);
    const lon = g.texts.filter((t) => !lat.includes(t));
    expect(lon.length).toBeGreaterThan(0);
    for (const t of lon) {
      expect(t.y).toBe(792);
      expect(t.x + 33).toBeLessThanOrEqual(1504);
    }
    expect(g.ticks).toHaveLength(0);
  });
  it('墨卡托:纬线按投影摆,画不到的高纬度不写', () => {
    const mp = mapProj('mercator', 0, W, H);
    const g = layoutGratLabels(W, H, { k: 1, x: (main.sw * 0) / 2, y: 0 }, main, mp, 30, spec)!;
    expect(g).not.toBeNull();
    const lat = g.texts.filter((t) => /[NS]$/.test(t.text));
    expect(lat.map((t) => t.text)).not.toContain('90°N');
  });
});

describe('弯边投影(罗宾森、自然地球、摩尔魏德)', () => {
  const main: StageBox = { sw: 1600, sh: 900, bw: 1800, bh: 900 };
  const spec: GratSpec = { fs: 11, area: [386, 64, 1600, 796], lonInRight: 1504, lon: [{ side: 'bottom', out: false }], lat: [{ side: 'left', out: false }] };
  const lonDeg = (t: string) => (t === '180°' ? 180 : t === '0°' ? 0 : Number(t.slice(0, -2)) * (t.endsWith('W') ? -1 : 1));
  for (const id of ['robinson', 'naturalEarth', 'mollweide'] as const) {
    it(`${id}:轮廓藏在侧栏和时间轴底下时,纬度贴着侧栏右边、经度写在弯的经线和下边相交的地方`, () => {
      const mp = mapProj(id, 0, W, H);
      const v = { k: 1, x: (main.sw * (1 - 1)) / 2 - (main.bw - main.sw) / 2, y: 0 };
      const g = layoutGratLabels(W, H, v, main, mp, 30, spec)!;
      expect(g).not.toBeNull();
      const lat = g.texts.filter((t) => t.x === 390);
      expect(lat.length).toBeGreaterThan(0);
      const lon = g.texts.filter((t) => t.y === 792);
      expect(lon.length).toBeGreaterThan(0);
      // 经度字的左边紧挨着那条经线在下边那一行的位置
      const my = ((792 + 4 - v.y) / v.k - (main.sh - main.bh) / 2) / main.bh * H;
      const phi = mp.def.phi((H / 2 - my) / mp.s);
      for (const t of lon) {
        const x = worldToStage(W / 2 + mp.s * mp.def.kx(phi) * lonDeg(t.text) * (Math.PI / 180), 0, v, main, W, H)[0];
        expect(Math.abs(t.x - 3 - x)).toBeLessThan(1e-6);
      }
    });
  }
  it('很宽的窗口、侧栏收起:轮廓左端露出来,纬度写在轮廓外面紧挨着线头', () => {
    const wide: StageBox = { sw: 2200, sh: 900, bw: 2200, bh: 1100 };
    const mp = mapProj('robinson', 0, W, H);
    const v = { k: 1, x: 0, y: 0 };
    const g = layoutGratLabels(W, H, v, wide, mp, 30, { ...spec, area: [0, 64, 2200, 796] })!;
    const outside = g.texts.filter((t) => t.ax === 1 && t.ay === 0.5);
    expect(outside.map((t) => t.text)).toContain('0°');
    for (const t of outside) {
      const lat = t.text === '0°' ? 0 : Number(t.text.slice(0, -2)) * (t.text.endsWith('S') ? -1 : 1);
      const xL = worldToStage(W / 2 - mp.s * mp.def.kx(lat * (Math.PI / 180)) * Math.PI, 0, v, wide, W, H)[0];
      expect(t.x).toBeCloseTo(xL - 7, 6);
    }
  });
});
