/**
 * 网站替地图插件算的帮手(gen/mapHelpers.ts):和官方生成用的同一套噪声、平滑,离某处几步、附近的地块、两块之间多少公里;
 * 山脊噪声、水往哪流、多少公里、连成几片、坡度、按经纬度找地块、两点连线、沿纬线多远、群落;
 * 按种子定、两遍一样;参数写错报是哪个帮手哪一项;经三个口子递给插件
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_PARAMS, generateWorld, type World } from '../src/gen/world';
import { BLUR_PASSES_MAX, mapHelpers } from '../src/gen/mapHelpers';
import { heightHooks, type MapPlugin } from '../src/gen/mapHooks';
import { blurField } from '../src/gen/mesh';
import { geometryOf } from '../src/gen/geometry';
import { subSeed } from '../src/gen/util';
import { KM_PER_UNIT } from '../src/gen/civ/scale';
import { accumulate, drainage } from '../src/gen/erosion';
import { Biome, classifyBiome } from '../src/gen/biomes';

const P = { ...DEFAULT_PARAMS, cells: 6000, seed: 7 };
let w0: World | undefined;
const world = () => (w0 ??= generateWorld(P));

describe('帮手', () => {
  it('噪声:和官方生成的同一套(种子按插件编号和 salt 分开),两遍一样', () => {
    const { mesh } = world();
    const h = mapHelpers(mesh, 7, 'p');
    const a = h.noise({ km: 900, octaves: 5, salt: 'hills' });
    const nz = geometryOf(mesh).fbm(subSeed(7, 'map:p:hills'), 5, 0.5);
    expect(a).toEqual(Float32Array.from({ length: mesh.n }, (_, i) => nz.atScale(i, 900 / KM_PER_UNIT)));
    expect(h.noise({ km: 900, octaves: 5, salt: 'hills' })).toEqual(a);
    expect(mapHelpers(mesh, 7, 'q').noise({ km: 900, octaves: 5, salt: 'hills' })).not.toEqual(a);
    expect(h.noise({ km: 900, octaves: 5, salt: 'x' })).not.toEqual(a);
    expect(h.noise({ km: 900 })).toEqual(Float32Array.from({ length: mesh.n }, (_, i) => geometryOf(mesh).fbm(subSeed(7, 'map:p:'), 1, 0.5).atScale(i, 900 / KM_PER_UNIT)));
    const lo = Math.min(...a);
    const hi = Math.max(...a);
    expect(lo).toBeLessThan(-0.3);
    expect(hi).toBeGreaterThan(0.3);
    expect(lo).toBeGreaterThanOrEqual(-1);
    expect(hi).toBeLessThanOrEqual(1);
  });

  it('平滑:不给 mask 和官方的 blurField 一样;给了只在 mask 上平均,别处不变', () => {
    const { mesh, elevation, water } = world();
    const h = mapHelpers(mesh, 7, 'p');
    expect(h.blur(elevation, 20)).toEqual(blurField(mesh, elevation, 20));
    expect(h.blur(Array.from(elevation), 3)).toEqual(blurField(mesh, elevation, 3));
    expect(h.blur(elevation, 0)).toEqual(elevation);
    const land = Uint8Array.from(water, (x) => (x === 0 ? 1 : 0));
    const got = h.blur(elevation, 2, land);
    // 照定义一遍一遍算
    let a = Float64Array.from(elevation);
    for (let p = 0; p < 2; p++) {
      const b = a.slice();
      for (let i = 0; i < mesh.n; i++) {
        if (!land[i]) continue;
        let s = a[i];
        let c = 1;
        for (let k = mesh.adjStart[i]; k < mesh.adjStart[i + 1]; k++) if (land[mesh.adj[k]]) (s += a[mesh.adj[k]]), c++;
        b[i] = Math.fround(s / c);
      }
      a = b;
    }
    expect(got).toEqual(Float32Array.from(a));
    for (let i = 0; i < mesh.n; i++) if (!land[i]) expect(got[i]).toBe(elevation[i]);
    expect(elevation).toEqual(world().elevation);
  });

  it('离某处几步:从标了 1 的地块沿邻居走,through 挡路,到不了是 −1', () => {
    const { mesh, water } = world();
    const h = mapHelpers(mesh, 7, 'p');
    const d = h.steps(water);
    for (let i = 0; i < mesh.n; i++) {
      if (water[i] === 1) {
        expect(d[i]).toBe(0);
        continue;
      }
      // 不是起点的:比最近的邻居多一步
      let best = Infinity;
      for (let k = mesh.adjStart[i]; k < mesh.adjStart[i + 1]; k++) if (d[mesh.adj[k]] >= 0) best = Math.min(best, d[mesh.adj[k]]);
      expect(d[i]).toBe(best + 1);
    }
    expect(Math.max(...d)).toBeGreaterThan(3);
    // 只能走海:陆地到不了
    const sea = Uint8Array.from(water, (x) => (x === 1 ? 1 : 0));
    const one = new Uint8Array(mesh.n);
    one[sea.indexOf(1)] = 1;
    const s = h.steps(one, sea);
    for (let i = 0; i < mesh.n; i++) if (!sea[i]) expect(s[i]).toBe(-1);
    expect(h.steps(new Uint8Array(mesh.n)).every((x) => x === -1)).toBe(true);
  });

  it('附近的地块、两块之间多少公里', () => {
    const { mesh } = world();
    const h = mapHelpers(mesh, 7, 'p');
    const c = 123;
    const near = h.near(c, 700);
    expect(near).toEqual(geometryOf(mesh).cellsNear(c, 700 / KM_PER_UNIT));
    expect(near.includes(c)).toBe(true);
    expect(near.length).toBeGreaterThan(5);
    const inside = new Set(near);
    for (let i = 0; i < mesh.n; i++) {
      if (inside.has(i)) expect(h.km(c, i)).toBeLessThanOrEqual(700 * (1 + 1e-6));
      else expect(h.km(c, i)).toBeGreaterThanOrEqual(700 * (1 - 1e-6));
    }
    expect(h.near(c, 0)).toEqual(Int32Array.of(c));
    expect(h.km(c, c)).toBe(0);
    expect(h.km(3, 9)).toBe(h.km(9, 3));
    // 星球周长约 4 万公里:最远的两块(直线穿过星球)约 4 万 / π
    let far = 0;
    for (let i = 0; i < mesh.n; i++) far = Math.max(far, h.km(0, i));
    expect(far).toBeGreaterThan(12600);
    expect(far).toBeLessThan(12800);
  });

  it('参数写错报是哪个帮手、哪一项', () => {
    const { mesh } = world();
    const h = mapHelpers(mesh, 7, 'p') as unknown as Record<string, (...a: unknown[]) => unknown>;
    const n = mesh.n;
    const cases: [() => unknown, RegExp][] = [
      [() => h.noise(5), /d\.noise 要给一个对象/],
      [() => h.noise({ km: 0 }), /d\.noise 的 km/],
      [() => h.noise({ km: Infinity }), /d\.noise 的 km/],
      [() => h.noise({ km: 5, octaves: 9 }), /octaves 要是 1 到 8/],
      [() => h.noise({ km: 5, octaves: 1.5 }), /octaves/],
      [() => h.noise({ km: 5, persistence: 2 }), /persistence/],
      [() => h.noise({ km: 5, salt: 'x'.repeat(65) }), /salt/],
      [() => h.blur(new Float32Array(n - 1), 1), /d\.blur 的 field 要是一个长度等于地块数/],
      [() => h.blur(Array(n).fill('1'), 1), /d\.blur 的 field\[0\] 不是数/],
      [() => h.blur(new Float32Array(n), BLUR_PASSES_MAX + 1), /遍数要是 0 到 200/],
      [() => h.blur(new Float32Array(n), 1, [1]), /d\.blur 的 mask/],
      [() => h.steps(null), /d\.steps 的 from/],
      [() => h.steps(new Uint8Array(n), new Uint8Array(2)), /d\.steps 的 through/],
      [() => h.near(n, 5), /d\.near 的第一项/],
      [() => h.near(0.5, 5), /d\.near 的第一项/],
      [() => h.near(0, -1), /d\.near 的 km/],
      [() => h.km(0, n), /d\.km/],
      [() => h.km('0', 1), /d\.km/],
    ];
    for (const [f, why] of cases) expect(f).toThrow(why);
  });

  it('经口子递给照接口写的插件:d 上有这几样', () => {
    const { mesh, elevation, tect } = world();
    let seen: string[] = [];
    const pl: MapPlugin = {
      id: 'p',
      key: 'p@1',
      stages: ['height'],
      height(d) {
        seen = HELPERS.filter((k) => typeof (d as unknown as Record<string, unknown>)[k] === 'function');
        return { elevation: d.blur(d.elevation, 1) };
      },
    };
    const e = elevation.slice();
    heightHooks([pl], mesh, 7, e, tect.land.slice(), tect.plate.slice());
    expect(seen).toEqual(HELPERS);
    expect(e).toEqual(blurField(mesh, elevation, 1));
  });
});

const HELPERS = ['noise', 'blur', 'steps', 'near', 'km', 'ridged', 'flow', 'distance', 'components', 'slope', 'cellAt', 'line', 'westEast', 'biomeOf'];

describe('第二批帮手', () => {
  it('每一样两遍一样', () => {
    const { mesh, elevation, water, temperature, precipitation } = world();
    const land = Uint8Array.from(water, (x) => (x === 1 ? 0 : 1));
    const run = () => {
      const h = mapHelpers(mesh, 7, 'p');
      return [
        h.ridged({ km: 700, octaves: 3, salt: 1 }),
        h.flow(elevation, land),
        h.distance(water),
        h.components(land),
        h.slope(elevation),
        h.cellAt(12.5, -40),
        h.line(5, 4000),
        h.westEast(land),
        h.biomeOf(temperature, precipitation, water),
      ];
    };
    expect(run()).toEqual(run());
  });

  it('山脊噪声:和官方长山用的同一套,0 到 1;种子按插件编号和 salt 分开,和 d.noise 不相干', () => {
    const { mesh } = world();
    const h = mapHelpers(mesh, 7, 'p');
    const a = h.ridged({ km: 900, octaves: 5, salt: 'r' });
    const nz = geometryOf(mesh).ridged(subSeed(7, 'map-ridged:p:r'), 5, 0.5);
    expect(a).toEqual(Float32Array.from({ length: mesh.n }, (_, i) => nz.atScale(i, 900 / KM_PER_UNIT)));
    expect(Math.min(...a)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...a)).toBeLessThanOrEqual(1);
    expect(Math.max(...a)).toBeGreaterThan(0.5);
    expect(mapHelpers(mesh, 7, 'q').ridged({ km: 900, octaves: 5, salt: 'r' })).not.toEqual(a);
    expect(h.ridged({ km: 900, octaves: 5, salt: 's' })).not.toEqual(a);
    expect(() => h.ridged({ km: 0 })).toThrow(/d\.ridged 的 km/);
  });

  it('水往哪流:流向、灌满的水面、汇流量和官方算湖、算河的同一套', () => {
    const w = world();
    const { mesh, elevation, water } = w;
    const h = mapHelpers(mesh, 7, 'p');
    const land = Uint8Array.from(water, (x) => (x === 1 ? 0 : 1));
    const f = h.flow(elevation, land);
    const route = drainage(mesh, land, elevation, 1e-3);
    expect(f.downstream).toEqual(route.receiver);
    expect(f.fillLevel).toEqual(drainage(mesh, land, elevation, 0).filled);
    expect(f.flux).toEqual(accumulate(route, land, Float32Array.from(land), new Float32Array(mesh.n)));
    let outlets = 0;
    for (let i = 0; i < mesh.n; i++) {
      if (!land[i]) {
        expect(f.downstream[i]).toBe(-1);
        continue;
      }
      expect(f.fillLevel[i]).toBeGreaterThanOrEqual(elevation[i]);
      const r = f.downstream[i];
      expect(r).toBeGreaterThanOrEqual(0);
      let isNb = false;
      for (let k = mesh.adjStart[i]; k < mesh.adjStart[i + 1]; k++) if (mesh.adj[k] === r) isNb = true;
      expect(isNb).toBe(true);
      if (!land[r]) outlets += f.flux[i];
    }
    // 陆地上每块 1 份水,全从入海口流出去
    expect(outlets).toBeCloseTo(land.reduce((s, x) => s + x, 0), 0);
    // 给了 rain 按它加;湖照样是陆地(水穿过湖往下流)
    const rain = Float32Array.from(land, (x, i) => x * (1 + (i % 3)));
    expect(h.flow(elevation, land, rain).flux).toEqual(accumulate(route, land, rain, new Float32Array(mesh.n)));
    // 整片陆地挨不着海:没处流,也不积水
    const all = h.flow(elevation, new Uint8Array(mesh.n).fill(1));
    expect(all.downstream.every((x) => x === -1)).toBe(true);
    expect(all.fillLevel).toEqual(elevation);
  });

  it('多少公里、最近的起点:沿邻居走的最短路,through 挡路', () => {
    const { mesh, water } = world();
    const h = mapHelpers(mesh, 7, 'p');
    const from = new Uint8Array(mesh.n);
    from[10] = 1;
    from[3000] = 1;
    const { km, nearest } = h.distance(from);
    expect(km[10]).toBe(0);
    expect(nearest[10]).toBe(10);
    expect(nearest[3000]).toBe(3000);
    for (let i = 0; i < mesh.n; i++) {
      expect([10, 3000]).toContain(nearest[i]);
      // 不是起点的:等于经某个邻居过来的最短的那条
      if (from[i]) continue;
      let best = Infinity;
      for (let k = mesh.adjStart[i]; k < mesh.adjStart[i + 1]; k++) best = Math.min(best, km[mesh.adj[k]] + h.km(i, mesh.adj[k]));
      expect(km[i]).toBeCloseTo(best, 0);
      // 沿地面走不会比直线穿过星球近
      expect(km[i]).toBeGreaterThanOrEqual(h.km(i, nearest[i]) * (1 - 1e-6));
    }
    const sea = Uint8Array.from(water, (x) => (x === 1 ? 1 : 0));
    const one = new Uint8Array(mesh.n);
    one[sea.indexOf(1)] = 1;
    const s = h.distance(one, sea);
    const steps = h.steps(one, sea);
    for (let i = 0; i < mesh.n; i++) {
      expect(s.km[i] < 0).toBe(steps[i] < 0);
      expect(s.nearest[i]).toBe(steps[i] < 0 ? -1 : sea.indexOf(1));
    }
    expect(s.km.some((x) => x < 0)).toBe(true);
    const none = h.distance(new Uint8Array(mesh.n));
    expect(none.km.every((x) => x === -1)).toBe(true);
    expect(none.nearest.every((x) => x === -1)).toBe(true);
  });

  it('连成几片:每片按最小的地块编号排,片里沿邻居连着,片和片不挨着', () => {
    const { mesh, water } = world();
    const h = mapHelpers(mesh, 7, 'p');
    const land = Uint8Array.from(water, (x) => (x === 0 ? 1 : 0));
    const { group, size } = h.components(land);
    expect(size.length).toBeGreaterThan(3);
    const first: number[] = [];
    const cnt = new Int32Array(size.length);
    for (let i = 0; i < mesh.n; i++) {
      if (!land[i]) {
        expect(group[i]).toBe(-1);
        continue;
      }
      const g = group[i];
      cnt[g]++;
      if (first[g] === undefined) first[g] = i;
      for (let k = mesh.adjStart[i]; k < mesh.adjStart[i + 1]; k++) if (land[mesh.adj[k]]) expect(group[mesh.adj[k]]).toBe(g);
    }
    expect(cnt).toEqual(size);
    expect(first).toEqual([...first].sort((a, b) => a - b));
    // 一片里的都走得到
    const one = new Uint8Array(mesh.n);
    one[first[0]] = 1;
    const st = h.steps(one, land);
    for (let i = 0; i < mesh.n; i++) expect(st[i] >= 0).toBe(group[i] === 0);
    expect(h.components(new Uint8Array(mesh.n)).size.length).toBe(0);
  });

  it('坡度:和邻居比最陡的那一下,每公里升降多少', () => {
    const { mesh, elevation } = world();
    const h = mapHelpers(mesh, 7, 'p');
    const s = h.slope(elevation);
    for (let i = 0; i < mesh.n; i += 37) {
      let best = 0;
      for (let k = mesh.adjStart[i]; k < mesh.adjStart[i + 1]; k++) best = Math.max(best, Math.abs(elevation[i] - elevation[mesh.adj[k]]) / h.km(i, mesh.adj[k]));
      expect(s[i]).toBeCloseTo(best, 3);
    }
    expect(h.slope(new Float32Array(mesh.n).fill(5)).every((x) => x === 0)).toBe(true);
    expect(() => h.slope(Array(mesh.n).fill(NaN))).toThrow(/d\.slope 的 height\[0\] 不是有限的数/);
  });

  it('按经纬度找地块:地块中心找回它自己;经度绕一圈一样', () => {
    const { mesh } = world();
    const h = mapHelpers(mesh, 7, 'p');
    for (let i = 0; i < mesh.n; i += 97) {
      const lat = 90 - (180 * mesh.y[i]) / mesh.height;
      const lon = (360 * mesh.x[i]) / mesh.width - 180;
      expect(h.cellAt(lat, lon)).toBe(i);
      expect(h.cellAt(lat, lon + 360)).toBe(i);
      expect(h.cellAt(lat, lon - 720)).toBe(i);
    }
    expect(h.cellAt(90, 0)).toBe(h.cellAt(90, 123));
    expect(() => h.cellAt(91, 0)).toThrow(/d\.cellAt 的 lat/);
    expect(() => h.cellAt(0, NaN)).toThrow(/d\.cellAt 的 lon/);
  });

  it('两点连线:从 a 走到 b,一块挨一块,长短和直线差不多', () => {
    const { mesh } = world();
    const h = mapHelpers(mesh, 7, 'p');
    for (const [a, b] of [
      [5, 4000],
      [100, 101],
      [0, mesh.n - 1],
      [2500, 2500],
    ]) {
      const l = h.line(a, b);
      expect(l[0]).toBe(a);
      expect(l[l.length - 1]).toBe(b);
      expect(new Set(l).size).toBe(l.length);
      for (let k = 1; k < l.length; k++) {
        let nb = false;
        for (let q = mesh.adjStart[l[k - 1]]; q < mesh.adjStart[l[k - 1] + 1]; q++) if (mesh.adj[q] === l[k]) nb = true;
        expect(nb).toBe(true);
      }
      // 每一步约一个地块间距
      const step = mesh.spacing * KM_PER_UNIT;
      if (a !== b) expect(l.length).toBeLessThan((h.km(a, b) / step) * 2 + 3);
    }
    expect(h.line(2500, 2500)).toEqual(Int32Array.of(2500));
    expect(() => h.line(0, mesh.n)).toThrow(/d\.line\(a, b\) 的 a、b/);
  });

  it('沿纬线往西、往东到最近的标了 1 的地块:和官方算洋流的同一套;一整圈都没有是 −1', () => {
    const { mesh, water } = world();
    const h = mapHelpers(mesh, 7, 'p');
    const land = Uint8Array.from(water, (x) => (x === 0 ? 1 : 0));
    const { west, east } = h.westEast(land);
    const z = geometryOf(mesh).zonalLand(land, 4);
    for (let i = 0; i < mesh.n; i++) {
      if (west[i] < 0) {
        expect(z.west[i]).toBeGreaterThan(2 * mesh.width);
        continue;
      }
      expect(west[i]).toBeCloseTo(z.west[i] * KM_PER_UNIT, 0);
      expect(east[i]).toBeCloseTo(z.east[i] * KM_PER_UNIT, 0);
      expect(west[i]).toBeLessThanOrEqual(40100);
    }
    expect(west.some((x) => x > 1000)).toBe(true);
    const none = h.westEast(new Uint8Array(mesh.n));
    expect(none.west.every((x) => x === -1) && none.east.every((x) => x === -1)).toBe(true);
  });

  it('气温降水对应的群落:和官方判的一样(湿地另算,海不看海冰)', () => {
    const { mesh, temperature, precipitation, water, biome, seaIce } = world();
    const h = mapHelpers(mesh, 7, 'p');
    const got = h.biomeOf(temperature, precipitation, water);
    let checked = 0;
    for (let i = 0; i < mesh.n; i++) {
      if (biome[i] === Biome.Wetland || (water[i] === 1 && seaIce[i] > 0)) continue;
      expect(got[i]).toBe(biome[i]);
      checked++;
    }
    expect(checked).toBeGreaterThan(mesh.n * 0.8);
    const dry = h.biomeOf(temperature, precipitation);
    for (let i = 0; i < mesh.n; i++) expect(dry[i]).toBe(classifyBiome(temperature[i], precipitation[i], 0));
    expect(() => h.biomeOf(temperature, precipitation, new Uint8Array(mesh.n).fill(3))).toThrow(/d\.biomeOf 的 water\[0\] 要是 0、1 或 2/);
  });

  it('参数写错报是哪个帮手、哪一项', () => {
    const { mesh } = world();
    const h = mapHelpers(mesh, 7, 'p') as unknown as Record<string, (...a: unknown[]) => unknown>;
    const n = mesh.n;
    const cases: [() => unknown, RegExp][] = [
      [() => h.ridged(5), /d\.ridged 要给一个对象/],
      [() => h.flow(new Float32Array(n)), /d\.flow 的 land 要是一个长度等于地块数/],
      [() => h.flow(Array(n).fill(Infinity), new Uint8Array(n)), /d\.flow 的 height\[0\] 不是有限的数/],
      [() => h.flow(new Float32Array(n), new Uint8Array(n), [1]), /d\.flow 的 rain/],
      [() => h.distance(null), /d\.distance 的 from/],
      [() => h.distance(new Uint8Array(n), new Uint8Array(1)), /d\.distance 的 through/],
      [() => h.components('x'), /d\.components 的 mask/],
      [() => h.slope([]), /d\.slope 的 height/],
      [() => h.cellAt('1', 2), /d\.cellAt 的 lat/],
      [() => h.line(-1, 0), /d\.line/],
      [() => h.westEast({}), /d\.westEast 的 mask/],
      [() => h.biomeOf(new Float32Array(n), null), /d\.biomeOf 的 precipitation/],
    ];
    for (const [f, why] of cases) expect(f).toThrow(why);
  });
});
