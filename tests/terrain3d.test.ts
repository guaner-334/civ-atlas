/**
 * 立体地形(框一块立起来看,render/terrain3d/):
 *   - 方框:多少公里、夹在 300–2000 公里、框上写的大小、两档像素密度(电脑细的不超过约 100 万像素、手机 8 像素一档)、默认起伏倍数
 *   - 海拔和地平线:海面按 0、湖按湖面;西边有山才有影子;按行切成几条各算各的和一次算完逐像素一样(同一块每次一样)
 *   - 网格:点数、三角形数、坡度的方向、切面;点数不超过上限
 *   - 镜头:刚打开时整块落在看得见的那一块里;北在上
 *   - 网址里的地区模式:框、哪一面、立体的角度和起伏写进去读出来一样;老网址、不像样的不进;角度 ↔ 镜头
 *   - 这一块叫什么:框里的山脉 > 湖 > 海 > 州名
 *   - 山名立在山顶:最高峰落在框里的山脉(和山脉卡片上的最高峰同一个数),钉在附近最高的那一点
 *   - 山脉卡片「看立体」:框住整条山脉、四周留一圈;太长的框最高的那一段
 *   - 手绘:一格按框的大小定(粗细两档在同一处);海岸墨线按一格的大小画;同一块每次一样
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_PARAMS, generateWorld, type World } from '../src/gen/world';
import { rasterize, type Raster } from '../src/gen/raster';
import { WINDOW_PAD, rasterizeWindow, zoomSource, type ZoomSource } from '../src/gen/rasterWindow';
import { BOX_MAX_KM, BOX_MIN_KM, autoExaggeration, boxKm, boxPixelOf, boxPixels, boxSizeText, clampBox, rangeBox, reliefScales } from '../src/render/terrain3d/box';
import { buildMesh, horizonSlopes, meshStep, peakPin, stripHeights } from '../src/render/terrain3d/relief';
import { BOX_STYLE_SPAN, boxStyle } from '../src/render/terrain3d/fantasyBox';
import { fantasyBoxPixels } from '../src/render/fantasy';
import { metersText, placeFacts } from '../src/ui/panelData';
import { KM_PER_UNIT } from '../src/gen/civ/geo';
import { PITCH_MAX, ZOOM_MAX, angleOf, camOfAngle, fitCam, mul, project, projMatrix, viewMatrix, clipPlanes, rectShift, wrapYaw } from '../src/render/terrain3d/camera';
import { readAreaLink, writeAreaLink } from '../src/ui/areaLink';
import { reliefPeaks, reliefTitle } from '../src/ui/terrain3d/region';
import type { Civ, Place } from '../src/gen/civ/types';

const H = 1024;
const W = 2048;

describe('方框', () => {
  it('赤道附近 70 × 46 个世界单位约 1330 × 900 公里;两边一样长写"见方"', () => {
    const b = { cx: 1470, cy: 440, w: 70, h: 46 };
    const km = boxKm(b, H);
    expect(Math.round(km.w / 10) * 10).toBe(1330);
    expect(Math.round(km.h / 10) * 10).toBe(900);
    expect(boxSizeText(b, H)).toBe('约 1330 × 900 公里');
    const sq = { cx: 1000, cy: 512, w: 46, h: 46 };
    expect(boxSizeText(sq, H)).toBe('约 900 公里见方');
  });

  it('每条边夹在 300–2000 公里,中心不过 75°,不出两极', () => {
    for (const b of [
      { cx: 100, cy: 500, w: 2, h: 3 },
      { cx: 100, cy: 500, w: 900, h: 400 },
      { cx: 100, cy: 3, w: 60, h: 60 },
      { cx: -40, cy: 1020, w: 300, h: 300 },
    ]) {
      const c = clampBox(b, H);
      const km = boxKm(c, H);
      expect(km.w).toBeGreaterThanOrEqual(BOX_MIN_KM - 1e-6);
      expect(km.w).toBeLessThanOrEqual(BOX_MAX_KM + 1e-6);
      expect(km.h).toBeLessThanOrEqual(BOX_MAX_KM + 1e-6);
      expect(c.cy - c.h / 2).toBeGreaterThanOrEqual(0);
      expect(c.cy + c.h / 2).toBeLessThanOrEqual(H);
      expect(Math.abs(90 - (c.cy / H) * 180)).toBeLessThanOrEqual(75 + 1e-9);
    }
  });

  it('像素密度:电脑细的一档最多 16、不超过约 100 万像素、最长边不超过 2048;手机最多 8;粗的一档约 5 万像素', () => {
    expect(reliefScales({ cx: 0, cy: 440, w: 70, h: 46 }, false)).toEqual({ fine: 16, coarse: 4 });
    const big = reliefScales({ cx: 0, cy: 512, w: 102, h: 102 }, false);
    expect(big.fine).toBe(8);
    expect(reliefScales({ cx: 0, cy: 440, w: 46, h: 46 }, true).fine).toBe(8);
    for (const b of [
      { cx: 0, cy: 512, w: 15, h: 15 },
      { cx: 0, cy: 512, w: 102, h: 102 },
      { cx: 0, cy: 200, w: 300, h: 60 },
    ])
      for (const phone of [false, true]) {
        const s = reliefScales(b, phone);
        expect(b.w * b.h * s.fine * s.fine).toBeLessThanOrEqual(phone ? 350_000 : 1_000_000);
        expect(Math.max(b.w, b.h) * s.fine).toBeLessThanOrEqual(2048);
        expect(b.w * b.h * s.coarse * s.coarse).toBeLessThanOrEqual(55_000 * 1.0001);
        expect(s.coarse).toBeLessThan(s.fine);
      }
  });

  it('默认起伏:框越大夸得越多、山越高夸得越少,夹在 1–30 倍;平地 12 倍', () => {
    const b = { cx: 1470, cy: 440, w: 70, h: 46 };
    const e = autoExaggeration(b, H, 4000);
    expect(e).toBeGreaterThanOrEqual(10);
    expect(e).toBeLessThanOrEqual(15);
    expect(autoExaggeration({ ...b, w: 100, h: 90 }, H, 4000)).toBeGreaterThan(e);
    expect(autoExaggeration(b, H, 7000)).toBeLessThan(e);
    expect(autoExaggeration(b, H, 60)).toBe(30);
    expect(autoExaggeration(b, H, 0)).toBe(12);
    expect(autoExaggeration(b, H, 9e6)).toBe(1);
  });

  it('贴图上的范围按 S 倍取整', () => {
    expect(boxPixels({ cx: 1470, cy: 440, w: 70, h: 46 }, 16)).toEqual({ x0: 22960, y0: 6672, w: 1120, h: 736 });
  });
});

describe('海拔和地平线', () => {
  it('海面按 0、陆地不低于 0、湖按湖面;裁掉多铺的一圈', () => {
    const P = 1;
    const w = 3;
    const h = 1;
    const n = w + 2 * P;
    const r = { w: n, elev: new Float32Array(n * 3), water: new Uint8Array(n * 3) };
    const row = n * 1 + P;
    r.elev.set([-300, -20, 850], row);
    r.water.set([1, 0, 2], row);
    expect([...stripHeights(r, P, w, h)]).toEqual([0, 0, 850]);
  });

  it('西边有更高的山才有影子;只看同一行', () => {
    const w = 40;
    const h = 2;
    const e = new Float32Array(w * h);
    e[5] = 2000; // 第一行西边一座山
    const hz = horizonSlopes(e, w, h, 2, 30);
    expect(hz[4]).toBe(0);
    expect(hz[5]).toBe(0);
    expect(hz[6]).toBeCloseTo(1000, 3); // 往西 1 像素(2 公里)高 2000 米
    expect(hz[10]).toBeGreaterThan(0);
    expect(hz[10]).toBeLessThan(hz[6]);
    for (let x = 0; x < w; x++) expect(hz[w + x]).toBe(0);
  });
});

describe('同一块:切成几条各算各的和一次算完一样', () => {
  let world: World;
  let whole: Raster;
  let src: ZoomSource;
  beforeAll(() => {
    world = generateWorld({ ...DEFAULT_PARAMS, seed: 7, cells: 12000 });
    whole = rasterize(world, 1);
    src = zoomSource(world, whole);
  });

  it('海拔、地平线逐像素一样,同一块算两次一样', () => {
    const box = { cx: 1470, cy: 440, w: 24, h: 16 };
    const S = 4;
    const px = boxPixels(box, S);
    const P = WINDOW_PAD;
    const kmPerPx = boxKm(box, H).w / px.w;
    const strip = (y: number, h: number) => {
      const r = rasterizeWindow(src, S, px.x0 - P, px.y0 + y - P, px.w + 2 * P, h + 2 * P);
      const elev = stripHeights(r, P, px.w, h);
      return { elev, hz: horizonSlopes(elev, px.w, h, kmPerPx, 20) };
    };
    const all = strip(0, px.h);
    const again = strip(0, px.h);
    expect(Buffer.from(again.elev.buffer).equals(Buffer.from(all.elev.buffer))).toBe(true);
    const cut = Math.round(px.h * 0.4);
    const a = strip(0, cut);
    const b = strip(cut, px.h - cut);
    const elev = new Float32Array(px.w * px.h);
    const hz = new Float32Array(px.w * px.h);
    elev.set(a.elev, 0);
    elev.set(b.elev, cut * px.w);
    hz.set(a.hz, 0);
    hz.set(b.hz, cut * px.w);
    expect(Buffer.from(elev.buffer).equals(Buffer.from(all.elev.buffer))).toBe(true);
    expect(Buffer.from(hz.buffer).equals(Buffer.from(all.hz.buffer))).toBe(true);
    let land = 0;
    for (const v of all.elev) {
      expect(Number.isFinite(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(0);
      if (v > 0) land++;
    }
    expect(land).toBeGreaterThan(0);
  });
});

describe('网格', () => {
  it('点数、三角形数;往东升高的坡坡度为正;切面四条边', () => {
    const w = 9;
    const h = 5;
    const e = new Float32Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) e[y * w + x] = x * 100;
    const m = buildMesh(e, w, h, 2, 90, 50);
    expect(m.nx).toBe(5);
    expect(m.ny).toBe(3);
    expect(m.verts.length).toBe(5 * 3 * 5);
    expect(m.index.length).toBe(4 * 2 * 6);
    expect(m.maxElev).toBeGreaterThan(600);
    // 中间那个点:往东每公里升 10 米(每像素 10 公里、100 米),往南不变
    const o = (1 * 5 + 2) * 5;
    expect(m.verts[o + 3]).toBeCloseTo(10, 5);
    expect(m.verts[o + 4]).toBeCloseTo(0, 5);
    // 四条边各 (点数 - 1) 段,每段两个三角形
    expect(m.skirt.length / 5).toBe(((5 - 1) * 2 + (3 - 1) * 2) * 6);
    // 方框中心为原点:x 从 -45 到 45 公里以内
    for (let i = 0; i < m.verts.length; i += 5) expect(Math.abs(m.verts[i])).toBeLessThanOrEqual(45);
  });

  it('网格点数不超过上限', () => {
    for (const [w, h, max] of [
      [1120, 736, 220_000],
      [1638, 1638, 220_000],
      [392, 382, 130_000],
    ]) {
      const s = meshStep(w, h, max);
      expect(Math.ceil(w / s) * Math.ceil(h / s)).toBeLessThanOrEqual(max);
    }
  });
});

describe('镜头', () => {
  it('刚打开时整块(连同最高处)落在看得见的那一块里;北在上', () => {
    const rect: [number, number, number, number] = [400, 64, 1600, 808];
    const cam = fitCam(1330, 900, 50, 1600, 900, rect);
    const [n, f] = clipPlanes(cam, 1330);
    const [sx, sy] = rectShift(1600, 900, rect);
    const m = mul(projMatrix(1600 / 900, n, f, sx, sy), viewMatrix(cam));
    for (const x of [-665, 665])
      for (const z of [-450, 450])
        for (const y of [0, 50]) {
          const p = project(m, x, y, z)!;
          const px = ((p[0] + 1) / 2) * 1600;
          const py = ((1 - p[1]) / 2) * 900;
          expect(px).toBeGreaterThanOrEqual(rect[0]);
          expect(px).toBeLessThanOrEqual(rect[2]);
          expect(py).toBeGreaterThanOrEqual(rect[1]);
          expect(py).toBeLessThanOrEqual(rect[3]);
        }
    // 朝向 0:北边(z 小)在画面上方
    const c0 = { ...cam, yaw: 0 };
    const m0 = mul(projMatrix(1600 / 900, n, f), viewMatrix(c0));
    const north = project(m0, 0, 0, -300)!;
    const south = project(m0, 0, 0, 300)!;
    expect(north[1]).toBeGreaterThan(south[1]);
    expect(north[0]).toBeCloseTo(south[0], 5);
  });
});

describe('网址里的地区模式', () => {
  const q = (s: string) => new URLSearchParams(s);
  it('框、哪一面、立体的角度和起伏写进网址再读出来一样;别的参数照留', () => {
    const link = { box: { cx: 1470.126, cy: 440, w: 70.5, h: 46 }, face: 'relief' as const, angle: { yaw: -35.04, pitch: 41.26, zoom: 1.8, px: 0.1234, pz: -0.25, h: 3.256 }, ex: 13 };
    const out = writeAreaLink(q('seed=7&map=satellite&lon=30'), link);
    expect(out.get('seed')).toBe('7');
    expect(out.get('lon')).toBe('30');
    expect(out.get('area')).toBe('1470.13,440,70.5,46');
    expect(out.get('face')).toBe('3d');
    expect(out.get('ang')).toBe('-35,41.3,1.8,0.123,-0.25,3.26');
    expect(out.get('ex')).toBe('13');
    const back = readAreaLink(out)!;
    expect(back.face).toBe('relief');
    expect(back.box).toEqual({ cx: 1470.13, cy: 440, w: 70.5, h: 46 });
    expect(back.angle).toEqual({ yaw: -35, pitch: 41.3, zoom: 1.8, px: 0.123, pz: -0.25, h: 3.26 });
    // 看点高度可以不写(照刚打开时的)
    expect(readAreaLink(q('area=1,2,3,4&face=3d&ang=10,30,1,0,0'))!.angle).toEqual({ yaw: 10, pitch: 30, zoom: 1, px: 0, pz: 0 });
    expect(back.ex).toBe(13);
    // 平面图:只写框
    const flat = writeAreaLink(out, { ...link, face: 'flat' });
    expect([...flat.keys()].sort()).toEqual(['area', 'lon', 'map', 'seed']);
    expect(readAreaLink(flat)).toEqual({ box: back.box, face: 'flat', angle: null, ex: null });
    // 离开地区模式:这几样都去掉
    expect([...writeAreaLink(out, null).keys()].sort()).toEqual(['lon', 'map', 'seed']);
  });
  it('老网址、不像样的框不进地区模式;认不出的角度、起伏不管,超出范围的夹回来', () => {
    expect(readAreaLink(q('seed=7&lon=30'))).toBeNull();
    for (const a of ['', '1,2,3', '1,2,3,x', '1,2,0,5', '1,2,-3,5', '1,,3,4', 'NaN,1,2,3']) expect(readAreaLink(q(`area=${a}`))).toBeNull();
    const r = readAreaLink(q('area=10,20,30,40&face=3d&ang=370,95,99,2,-2,-5&ex=55'))!;
    expect(r.angle).toEqual({ yaw: 10, pitch: PITCH_MAX, zoom: ZOOM_MAX, px: 0.5, pz: -0.5, h: 0 });
    expect(r.ex).toBe(30);
    const bad = readAreaLink(q('area=10,20,30,40&face=3d&ang=1,2,3&ex=abc'))!;
    expect(bad.angle).toBeNull();
    expect(bad.ex).toBeNull();
    // face 认不出 = 平面图(角度、起伏不看)
    expect(readAreaLink(q('area=10,20,30,40&face=x&ang=1,30,1,0,0&ex=5'))).toEqual({ box: { cx: 10, cy: 20, w: 30, h: 40 }, face: 'flat', angle: null, ex: null });
  });
  it('角度 → 镜头 → 角度一样;远近按刚打开时那么远算,换一块屏幕也是那么大的一块;看点高度照记下的', () => {
    const fit = fitCam(1330, 900, 50, 1600, 900, [400, 64, 1600, 808]);
    const a = { yaw: -120, pitch: 55, zoom: 2, px: 0.2, pz: -0.1, h: 7.5 };
    const cam = camOfAngle(a, fit, 1330, 900);
    expect(cam.dist).toBeCloseTo(fit.dist / 2, 6);
    expect(cam.tx).toBeCloseTo(266, 6);
    expect(cam.fov).toBe(fit.fov);
    expect(cam.ty).toBe(7.5);
    // 起伏拉过以后 fit 的看点高度变了:记下的高度照旧
    const fit2 = fitCam(1330, 900, 150, 1600, 900, [400, 64, 1600, 808]);
    expect(camOfAngle(a, fit2, 1330, 900).ty).toBe(7.5);
    expect(camOfAngle({ ...a, h: undefined }, fit2, 1330, 900).ty).toBe(fit2.ty);
    const b = angleOf(cam, fit, 1330, 900);
    for (const k of ['yaw', 'pitch', 'zoom', 'px', 'pz', 'h'] as const) expect(b[k]).toBeCloseTo(a[k], 6);
    // 朝向转了几圈也一样
    expect(angleOf({ ...cam, yaw: -120 + 720 }, fit, 1330, 900).yaw).toBeCloseTo(-120, 6);
    expect(wrapYaw(180)).toBe(180);
    expect(wrapYaw(-180)).toBe(180);
    expect(wrapYaw(-190)).toBe(170);
  });
});

describe('这一块叫什么', () => {
  const place = (kind: Place['kind'], name: string, pts: number[], rank = 1): Place => ({ kind, name, culture: 0, path: new Float32Array(pts), rank });
  const raster = { w: W, h: H, scale: 1, cell: new Int32Array(W * H).fill(3) };
  const civ = (places: Place[]) => ({ places, regions: { of: new Int32Array([0, 0, 0, 5]), name: ['', '', '', '', '', '桑州'] } }) as unknown as Civ;
  const box = { cx: 1470, cy: 440, w: 70, h: 46 };

  it('山脉优先,其次湖,再其次海;都没有用框中心的州名', () => {
    const range = place('mountains', '玉屏山', [1460, 430, 1480, 440, 1490, 450]);
    const lake = place('lake', '镜湖', [1470, 445]);
    const sea = place('sea', '南海', [1450, 455]);
    expect(reliefTitle(box, civ([sea, lake, range]), raster, W)).toBe('玉屏山一带');
    expect(reliefTitle(box, civ([sea, lake]), raster, W)).toBe('镜湖一带');
    expect(reliefTitle(box, civ([sea]), raster, W)).toBe('南海一带');
    expect(reliefTitle(box, civ([]), raster, W)).toBe('桑州一带');
    expect(reliefTitle(box, null, raster, W)).toBe('这一块地方');
  });

  it('山脊线只有一小截在框里的不算;跨过地图左右接缝的框也认得', () => {
    const far = place('mountains', '远山', [1100, 440, 1200, 440, 1300, 440, 1400, 440, 1440, 440]);
    expect(reliefTitle(box, civ([far]), raster, W)).toBe('桑州一带');
    const seam = place('mountains', '接缝山', [2040, 300, 5, 300, 20, 300]);
    expect(reliefTitle({ cx: 2047, cy: 300, w: 60, h: 40 }, civ([seam]), raster, W)).toBe('接缝山一带');
    expect(reliefTitle({ cx: -1, cy: 300, w: 60, h: 40 }, civ([seam]), raster, W)).toBe('接缝山一带');
  });
});

describe('山脉卡片「看立体」', () => {
  it('框住整条山脉,四周至少留 120 公里;短边不短于长边的三分之二', () => {
    const path = [1450, 436, 1470, 440, 1490, 446];
    const b = rangeBox(path, [1470, 440], W, H);
    const km = boxKm(b, H);
    const kx = km.w / b.w;
    expect(b.cx - b.w / 2).toBeLessThanOrEqual(1450 - 120 / kx);
    expect(b.cx + b.w / 2).toBeGreaterThanOrEqual(1490 + 120 / kx);
    expect(b.cy - b.h / 2).toBeLessThanOrEqual(436 - 120 / KM_PER_UNIT);
    expect(b.cy + b.h / 2).toBeGreaterThanOrEqual(446 + 120 / KM_PER_UNIT);
    expect(Math.min(km.w, km.h) * 1.5).toBeGreaterThanOrEqual(Math.max(km.w, km.h) - 1);
  });

  it('太长的山脉:那条边 2000 公里,以最高峰为中心、不出山脉的范围', () => {
    const path = [1000, 440, 1100, 442, 1200, 444, 1300, 446];
    const b = rangeBox(path, [1250, 445], W, H);
    expect(boxKm(b, H).w).toBeCloseTo(BOX_MAX_KM, 0);
    expect(b.cx).toBeCloseTo(1250, 0);
    // 最高峰在一头:框在留了一圈以后的范围里,最高峰还在框里
    const end = rangeBox(path, [1300, 446], W, H);
    // 留的一圈:东西长 300 个世界单位的 18%
    const pad = 0.18 * 300;
    expect(end.cx + end.w / 2).toBeLessThanOrEqual(1300 + pad + 0.5);
    expect(end.cx + end.w / 2).toBeGreaterThanOrEqual(1300);
    expect(end.cx - end.w / 2).toBeLessThanOrEqual(1300);
    // 最高峰在山脉中间以外的地方:框不越过山脉留了一圈以后的那一头
    const first = rangeBox(path, [990, 440], W, H);
    expect(first.cx - first.w / 2).toBeGreaterThanOrEqual(1000 - pad - 0.5);
  });

  it('跨过地图左右接缝的山脉按连着的那一段框', () => {
    const b = rangeBox([2030, 300, 2045, 302, 10, 304, 25, 306], [5, 303], W, H);
    const c = ((b.cx % W) + W) % W;
    expect(Math.min(c, W - c)).toBeLessThan(10);
    expect(boxKm(b, H).w).toBeLessThan(1500);
  });
});

describe('山名立在山顶', () => {
  it('钉在 R 像素以内最高的那一点;位置按公里、方框中心为原点;不在贴图里 = null', () => {
    const w = 20;
    const h = 10;
    const elev = new Float32Array(w * h);
    elev[4 * w + 12] = 3000;
    elev[4 * w + 18] = 5000; // 太远,不算
    const p = peakPin(elev, w, h, 10, 5, 3, 200, 100)!;
    expect(p.h).toBe(3000);
    expect(p.x).toBeCloseTo(((12.5 / w) - 0.5) * 200, 6);
    expect(p.z).toBeCloseTo(((4.5 / h) - 0.5) * 100, 6);
    expect(peakPin(elev, w, h, -1, 5, 3, 200, 100)).toBeNull();
    // 世界坐标 → 贴图像素:跨过接缝的框也按近的那一圈
    const b = { cx: 2047, cy: 300, w: 60, h: 40 };
    const [px, py] = boxPixelOf(b, 4, 3, 300, W);
    expect(px).toBeCloseTo((2047 + 4 - (2047 - 30)) * 4, 0);
    expect(py).toBeCloseTo(20 * 4, 0);
  });
});

describe('手绘贴图(按框的大小画)', () => {
  let world: World;
  let whole: Raster;
  let src: ZoomSource;
  beforeAll(() => {
    world = generateWorld({ ...DEFAULT_PARAMS, seed: 7, cells: 12000 });
    whole = rasterize(world, 1);
    src = zoomSource(world, whole);
  });

  it('一格按框的大小定:框越大一格越大;手机按小屏幕;细的一档一格至少 0.85 像素;东西向按纬度拉宽', () => {
    const small = boxStyle({ cx: 1470, cy: 440, w: 60, h: 40 }, H, false, 16);
    const big = boxStyle({ cx: 1470, cy: 440, w: 120, h: 80 }, H, false, 16);
    expect(big.unit / small.unit).toBeCloseTo(2, 1);
    const km = boxKm({ cx: 1470, cy: 440, w: 120, h: 80 }, H);
    expect(big.unit).toBeCloseTo(Math.max(km.w, km.h) / BOX_STYLE_SPAN.desktop / KM_PER_UNIT, 6);
    expect(boxStyle({ cx: 1470, cy: 440, w: 120, h: 80 }, H, true, 8).unit).toBeGreaterThan(big.unit * 2);
    const tiny = boxStyle({ cx: 1470, cy: 440, w: 16, h: 16 }, H, false, 16);
    expect(tiny.unit * 16).toBeCloseTo(0.85, 6);
    expect(boxStyle({ cx: 1470, cy: 170, w: 100, h: 60 }, H, false, 8).ax).toBeGreaterThan(2);
    expect(big.ax).toBeLessThan(1.1);
  });

  it('海岸墨线按一格的大小画(一格大一倍,墨线宽一倍);同一块画两次一样', () => {
    // 框住一段海岸(主图上第一个挨着陆地的海面像素)
    let at = -1;
    for (let k = whole.w * 300; k < whole.w * 700 && at < 0; k++) if (whole.water[k] === 1 && whole.water[k + 1] === 0) at = k;
    const box = { cx: at % whole.w, cy: Math.floor(at / whole.w), w: 24, h: 16 };
    const S = 4;
    const p = boxPixels(box, S);
    const P = WINDOW_PAD;
    const r = rasterizeWindow(src, S, p.x0 - P, p.y0 - P, p.w + 2 * P, p.h + 2 * P);
    const ink = (px: Uint8ClampedArray) => {
      let n = 0;
      for (let i = 0; i < px.length; i += 4) if (px[i] + px[i + 1] + px[i + 2] < 3 * 90) n++;
      return n;
    };
    const a = fantasyBoxPixels(r, 1);
    expect(Buffer.from(fantasyBoxPixels(r, 1).buffer).equals(Buffer.from(a.buffer))).toBe(true);
    const n1 = ink(a);
    const n2 = ink(fantasyBoxPixels(r, 2));
    expect(n1).toBeGreaterThan(50);
    expect(n2 / n1).toBeGreaterThan(1.5);
    expect(n2 / n1).toBeLessThan(2.6);
  });

  it('山名:最高峰落在框里的山脉,海拔和山脉卡片上的最高峰一样', () => {
    // 一条假的山脉:沿着框里最高的那一行(山名按卡片上的算法找最高峰)
    let best = 0;
    for (let y = 420; y < 460; y++) for (let x = 1440; x < 1500; x++) if (whole.elev[y * whole.w + x] > whole.elev[best]) best = y * whole.w + x;
    const bx = best % whole.w;
    const by = Math.floor(best / whole.w);
    const mk = (name: string, pts: number[], rank: number): Place => ({ kind: 'mountains', name, culture: 0, path: new Float32Array(pts), rank });
    const civ = {
      places: [mk('玉屏山', [bx - 6, by, bx, by, bx + 6, by], 2), mk('远山', [400, 300, 410, 302], 1), { ...mk('镜湖', [bx, by], 1), kind: 'lake' }],
      regions: { of: new Int32Array(world.mesh.n).fill(-1) },
    } as unknown as Civ;
    const box = { cx: bx, cy: by, w: 70, h: 46 };
    const peaks = reliefPeaks(box, civ, world, whole);
    expect(peaks.map((p) => p.name)).toEqual(['玉屏山']);
    const f = placeFacts(civ, world, whole, 0);
    expect(peaks[0].meters).toBe(metersText(f.peak!));
    expect(Math.abs(peaks[0].at[0] - bx)).toBeLessThan(10);
    expect(Math.abs(peaks[0].at[1] - by)).toBeLessThan(10);
    expect(reliefPeaks({ cx: 400, cy: 600, w: 70, h: 46 }, civ, world, whole)).toEqual([]);
    expect(reliefPeaks(box, null, world, whole)).toEqual([]);
  });

  it('山脊线的点隔得远、最高峰落在两点之间的一小块框里也立名字', () => {
    const w = whole.w;
    const h = whole.h;
    const elev = new Float32Array(w * h);
    elev[512 * w + 1050] = 3000;
    const flat = { ...whole, elev, water: new Uint8Array(w * h), cell: new Int32Array(w * h) } as Raster;
    const civ = {
      places: [{ kind: 'mountains', name: '长岭', culture: 0, path: new Float32Array([1000, 512, 1100, 512, 1200, 512]), rank: 1 }],
      regions: { of: new Int32Array(world.mesh.n).fill(-1) },
    } as unknown as Civ;
    const peaks = reliefPeaks({ cx: 1050.5, cy: 512.5, w: 16, h: 16 }, civ, world, flat);
    expect(peaks.map((p) => [p.name, p.meters])).toEqual([['长岭', '3000']]);
  });
});
