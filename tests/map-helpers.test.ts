/**
 * 网站替地图插件算的帮手(gen/mapHelpers.ts):和官方生成用的同一套噪声、平滑,离某处几步、附近的地块、两块之间多少公里;
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
        seen = ['noise', 'blur', 'steps', 'near', 'km'].filter((k) => typeof (d as unknown as Record<string, unknown>)[k] === 'function');
        return { elevation: d.blur(d.elevation, 1) };
      },
    };
    const e = elevation.slice();
    heightHooks([pl], mesh, 7, e, tect.land.slice(), tect.plate.slice());
    expect(seen).toEqual(['noise', 'blur', 'steps', 'near', 'km']);
    expect(e).toEqual(blurField(mesh, elevation, 1));
  });
});
