/**
 * 地图插件关进 QuickJS 跑(src/gen/quickjs/map.ts):照接口写的三个测试插件以源码进 QuickJS,长出的地图和直接跑逐位一样、指纹钉住;
 * 每一口新开环境;QuickJS 里没有时间、随机数、eval;死循环叫停、内存用完、栈用完都报错停下;帮手递出来算,和网站这头直接算一样;
 * 一次生成的合计用时超了停下
 */
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { DEFAULT_PARAMS, generateWorld, type World } from '../src/gen/world';
import { MAP_PLUGIN_TIME, MapClock, MapPluginError, climateHooks, heightHooks, layerHooks, timedMapPlugins, type LayerFields, type MapPlugin, type MapStage } from '../src/gen/mapHooks';
import { mapHelpers } from '../src/gen/mapHelpers';
import { MapPluginLoadError, quickjsMapPlugin, type QuickJSMapPlugin, type QuickJSMapSpec } from '../src/gen/quickjs/map';
import { keyed, subSeed } from '../src/gen/util';
import { pluginScript, quickjsWasm } from '../scripts/lib/quickjsNode';
import { craters, koppen, tides, withParams } from './lib/mapPlugins';
import { MAP_PINS, MAP_SEEDS, mapDigest as digest, type MapSeed } from './lib/mapPins';

const FILE = fileURLToPath(new URL('./lib/mapPlugins.ts', import.meta.url));

const bytes = (a: ArrayBufferView) => new Uint8Array(a.buffer, a.byteOffset, a.byteLength);

/** 测试插件的 QuickJS 版:同一个文件的源码 + civAtlas.map(make) */
const boxed = (native: { id: string; key: string; stages: readonly MapStage[]; layerIds?: readonly string[] }, make: string, params: Record<string, number> = {}) =>
  quickjsMapPlugin(quickjsWasm(), {
    id: native.id,
    key: native.key,
    code: pluginScript(FILE, make, 'map'),
    setup: { stages: native.stages, ...(native.layerIds ? { layerIds: native.layerIds } : {}) },
    params,
  });

async function using<T>(made: Promise<QuickJSMapPlugin>[], run: (ps: QuickJSMapPlugin[]) => T): Promise<T> {
  const ps = await Promise.all(made);
  try {
    return run(ps);
  } finally {
    ps.forEach((p) => p.dispose());
  }
}

async function errOf(f: () => unknown): Promise<Error> {
  try {
    await f();
  } catch (e) {
    if (e instanceof Error) return e;
    throw e;
  }
  throw new Error('没有出错');
}

describe('照接口写的插件以源码进 QuickJS,和直接跑一样', () => {
  it.each(MAP_SEEDS)('seed %i 环形山、柯本、潮汐一起开:长出的地图和直接跑逐位一样,指纹钉住', async (seed) => {
    const P = { ...DEFAULT_PARAMS, seed };
    const native = generateWorld(P, undefined, undefined, undefined, undefined, [withParams(craters(), { count: 40 }), withParams(koppen()), withParams(tides())]);
    const w = await using([boxed(craters(), 'craters()', { count: 40 }), boxed(koppen(), 'koppen()'), boxed(tides(), 'tides()')], (ps) =>
      generateWorld(P, undefined, undefined, undefined, undefined, ps),
    );
    if (process.env.PRINT_FINGERPRINT) console.log(`map-quickjs seed ${seed}: ${digest(w)}`);
    expect(digest(w)).toBe(digest(native));
    expect(w.mapPlugins).toEqual(['craters@1', 'koppen@1', 'tides@1']);
    expect(w.mapLayers?.map((l) => `${l.by}/${l.id}`)).toEqual(['koppen/koppen', 'tides/tide']);
    const [kp, tide] = w.mapLayers!;
    const classes = new Set([...kp.values].filter((v) => !Number.isNaN(v)));
    expect(classes.size).toBeGreaterThan(8);
    expect([...classes].every((v) => Number.isInteger(v) && v >= 0 && v < 30)).toBe(true);
    expect([...tide.values].filter((v) => v > 0).length).toBeGreaterThan(500);
    const plain = generateWorld(P);
    expect(digest(w)).not.toBe(digest(plain));
    expect(digest(w)).toBe(MAP_PINS[seed as MapSeed]);
  }, 60_000);
});

const W = { ...DEFAULT_PARAMS, cells: 6000, seed: 7 };
let small: World | undefined;
const small7 = () => (small ??= generateWorld(W));

const spec = (code: string, stages: MapStage[] = ['height'], extra: Partial<QuickJSMapSpec> = {}): QuickJSMapSpec => ({ id: 'p', key: 'p@1', code, setup: { stages }, ...extra });
const make = (code: string, stages?: MapStage[], extra?: Partial<QuickJSMapSpec>) => quickjsMapPlugin(quickjsWasm(), spec(code, stages, extra));
const heightOf = (body: string) => `civAtlas.map({ height(d) { ${body} } });`;

/** 改海拔那一口跑一次,交回改过的海拔 */
function height(pl: MapPlugin, w = small7()): Float32Array {
  const e = w.elevation.slice();
  heightHooks([pl], w.mesh, W.seed, e, w.tect.land.slice(), w.tect.plate.slice());
  return e;
}

async function heightOnce(body: string, extra?: Partial<QuickJSMapSpec>): Promise<Float32Array> {
  const pl = await make(heightOf(body), ['height'], extra);
  try {
    return height(pl);
  } finally {
    pl.dispose();
  }
}

const fieldsOf = (w: World): LayerFields => {
  const n = w.mesh.n;
  return {
    elevation: w.elevation,
    water: w.water,
    temperature: w.temperature,
    precipitation: w.precipitation,
    windX: new Float32Array(n),
    windY: new Float32Array(n),
    rainSummer: w.precipitation.slice(),
    rainWinter: w.precipitation.slice(),
    plate: w.tect.plate,
    waterLevel: w.waterLevel,
    seaIce: w.seaIce,
    biome: w.biome,
    flux: w.flux,
    riverThreshold: w.riverThreshold,
    rivers: w.rivers,
  };
};

describe('每一口一个新环境', () => {
  it('插件的全局变量带不到下一口,顶层代码每一口重跑', async () => {
    const pl = await make(
      `let calls = 0;
       civAtlas.map({
         height(d) { calls++; globalThis.seen = (globalThis.seen || 0) + 1; return { elevation: d.elevation.map(() => 100 * globalThis.seen + calls) }; },
         climate(d) { return { temperature: d.temperature.map(() => typeof globalThis.seen === 'undefined' ? 7 : -7) }; },
       });`,
      ['height', 'climate'],
    );
    try {
      expect(height(pl).every((x) => x === 101)).toBe(true);
      expect(height(pl).every((x) => x === 101)).toBe(true);
      const c = fieldsOf(small7());
      const f = { ...c, temperature: c.temperature.slice(), precipitation: c.precipitation.slice() };
      climateHooks([pl], small7().mesh, W.seed, f);
      expect(f.temperature.every((x) => x === 7)).toBe(true);
    } finally {
      pl.dispose();
    }
  });

  it('递进去的是一份拷贝,插件改了也不碰世界', async () => {
    const w = small7();
    const xyz = w.mesh.xyz.slice();
    const e0 = w.elevation.slice();
    await heightOnce('d.xyz.fill(0); d.adj.fill(0); d.elevation.fill(5); return undefined;');
    expect(w.mesh.xyz).toEqual(xyz);
    expect(w.elevation).toEqual(e0);
  });

  it('d.params 和 civAtlas.params 是同一份只读的滑条;d 上有地块数、种子、经纬度', async () => {
    const e = await heightOnce(
      `'use strict';
       let frozen = 0;
       try { d.params.count = 3; } catch (x) { frozen = 1; }
       const ok = d.params === civAtlas.params && d.params.count === 12 && frozen && Object.isFrozen(civAtlas.params) && d.seed === 7 && d.n === d.lat.length && d.lon.length === d.n && d.xyz.length === 3 * d.n;
       return { elevation: d.elevation.map(() => ok ? 1 : -1) };`,
      { params: { count: 12 } },
    );
    expect(e.every((x) => x === 1)).toBe(true);
  });

  it('console.log 交给 log(装插件时是 null,出手时是哪一口);不给 log 什么都不做', async () => {
    const got: [string, string, MapStage | null][] = [];
    const code = `console.log('装上了'); civAtlas.map({ height(d) { console.warn('改海拔', d.n); console.table([1]); return undefined; } });`;
    const pl = await make(code, ['height'], { log: (m, t, s) => got.push([m, t, s]) });
    try {
      height(pl);
    } finally {
      pl.dispose();
    }
    expect(got).toEqual([
      ['log', '装上了', null],
      ['log', '装上了', 'height'],
      ['warn', `改海拔 ${small7().mesh.n}`, 'height'],
    ]);
    await heightOnce(`console.log(1); return undefined;`);
  });
});

describe('QuickJS 里没有的', () => {
  it.each([
    ['new Date()', /不能用 Date/],
    ['Date.now()', /不能用 Date\.now/],
    ['Math.random()', /不能用 Math\.random.*d\.rand/],
    ['eval("1 + 1")', /不能用 eval/],
    ['Function("return 1")()', /不能用 Function/],
    ['(function () {}).constructor("return 1")()', /不能用 Function/],
    ['(async function () {}).constructor("return 1")', /不能用 函数构造器/],
  ])('出手时用 %s 报错,说是哪个插件、哪一口', async (expr, why) => {
    const e = await errOf(() => heightOnce(`${expr}; return undefined;`));
    expect(e).toBeInstanceOf(MapPluginError);
    expect([(e as MapPluginError).plugin, (e as MapPluginError).stage]).toEqual(['p', 'height']);
    expect(e.message).toMatch(/地图插件里不能用/);
    expect(e.message).toMatch(why);
  });

  it('插件代码顶层用了也报错,装不上', async () => {
    const e = await errOf(() => make(`Date.now();\n${heightOf('return undefined;')}`));
    expect(e).toBeInstanceOf(MapPluginLoadError);
    expect(e.message).toMatch(/地图插件「p」装不上:插件代码出错.*不能用 Date\.now/);
  });
});

describe('叫停、内存、栈', () => {
  it('出手时死循环:跑到上限叫停,插件的 try 接不住', async () => {
    const e = await errOf(() => heightOnce('try { for (;;); } catch (x) {} return undefined;', { limits: { moment: 100 } }));
    expect(e).toBeInstanceOf(MapPluginError);
    expect(e.message).toMatch(/改海拔这一步出错:跑了 0\.1 秒还没跑完,叫停了/);
  });

  it('插件代码顶层死循环:装的时候叫停', async () => {
    const e = await errOf(() => make(`for (;;);\n${heightOf('return undefined;')}`, ['height'], { limits: { moment: 100 } }));
    expect(e).toBeInstanceOf(MapPluginLoadError);
    expect(e.message).toMatch(/插件代码跑了 0\.1 秒还没跑完,叫停了/);
  });

  it('内存用到上限报错停下;同一个插件下一口照常开新环境,别的插件照常跑', async () => {
    const pl = await make(heightOf('if (d.params.big) { const a = []; for (;;) a.push(new Float64Array(1 << 20)); } return { elevation: d.elevation.map(() => 3) };'), ['height'], { params: { big: 1 } });
    try {
      const e = await errOf(() => height(pl));
      expect(e).toBeInstanceOf(MapPluginError);
      expect(e.message).toMatch(/改海拔这一步出错:用的内存超过 64 MB/);
      expect((await errOf(() => height(pl))).message).toMatch(/内存超过 64 MB/);
    } finally {
      pl.dispose();
    }
    expect((await heightOnce('return { elevation: d.elevation.map(() => 3) };')).every((x) => x === 3)).toBe(true);
  });

  it('递归太深报错停下,不把生成线程的栈用完', async () => {
    const e = await errOf(() => heightOnce('const f = (n) => f(n + 1) + 1; f(0); return undefined;'));
    expect(e).toBeInstanceOf(MapPluginError);
    expect(e.message).toMatch(/栈用完了/);
  });

  it('放掉以后再用报错', async () => {
    const pl = await make(heightOf('return undefined;'));
    pl.dispose();
    expect((await errOf(() => height(pl))).message).toMatch(/已经放掉了/);
  });
});

describe('登记和交回', () => {
  it('没有登记、登记两次、出手时才登记、清单写了的那一步没有函数:装不上或报错', async () => {
    expect((await errOf(() => make('const x = 1;'))).message).toMatch(/没有用 civAtlas\.map/);
    expect((await errOf(() => make(`${heightOf('')}\n${heightOf('')}`))).message).toMatch(/只能调用一次/);
    expect((await errOf(() => make('civAtlas.map(3);'))).message).toMatch(/要给一个对象/);
    expect((await errOf(() => make(heightOf('return undefined;'), ['height', 'climate']))).message).toMatch(/没有 climate 函数/);
    const e = await errOf(() => heightOnce('civAtlas.map({}); return undefined;'));
    expect(e).toBeInstanceOf(MapPluginError);
    expect(e.message).toMatch(/只能在插件代码的顶层调用/);
  });

  it('交回坏数:mapHooks 照样核对,报哪个插件、哪一口', async () => {
    const e = await errOf(() => heightOnce('const e = d.elevation.slice(); e[0] = NaN; return { elevation: e };'));
    expect(e).toBeInstanceOf(MapPluginError);
    expect(e.message).toMatch(/地图插件「p」在改海拔这一步出错:elevation\[0\] 不是有限的数/);
    expect((await errOf(() => heightOnce('return { elevation: () => 1 };'))).message).toMatch(/不能有函数/);
    expect((await errOf(() => heightOnce('return Promise.resolve({});'))).message).toMatch(/当场交回/);
    expect((await errOf(() => heightOnce('throw new RangeError("坏了");'))).message).toMatch(/改海拔这一步出错:坏了$/);
  });

  it('交回普通数组、-0、Float64Array 都收', async () => {
    expect((await heightOnce('return { elevation: Array.from(d.elevation, (x, i) => (i === 0 ? -0 : 2)) };')).slice(1).every((x) => x === 2)).toBe(true);
    expect((await heightOnce('return { elevation: Float64Array.from(d.elevation, () => 4.5) };')).every((x) => x === 4.5)).toBe(true);
  });

  it('d.rand 和网站这头算的逐位一样(种子按插件编号分开)', async () => {
    const pl = await make('civAtlas.map({ layers(d) { const r = new Float64Array(d.n); for (let i = 0; i < d.n; i++) r[i] = d.rand(i, 2, 3); return { layers: { r: new Float32Array(r) } }; } });', ['layers'], {
      setup: { stages: ['layers'], layerIds: ['r'] },
    });
    try {
      const w = small7();
      const [l] = layerHooks([pl], w.mesh, W.seed, fieldsOf(w));
      const base = subSeed(W.seed, 'map:p');
      expect([...l.values]).toEqual(Array.from({ length: w.mesh.n }, (_, i) => Math.fround(keyed(base, i, 2, 3))));
    } finally {
      pl.dispose();
    }
  });
});

describe('帮手递出来算', () => {
  it('噪声、平滑、离海几步、附近的地块和网站这头直接算逐位一样;两遍一样', async () => {
    const code = `civAtlas.map({ layers(d) {
      const land = d.water.map((x) => (x === 0 ? 1 : 0));
      const near = new Float32Array(d.n);
      const around = d.near(0, 800);
      for (let q = 0; q < around.length; q++) near[around[q]] = d.km(0, around[q]);
      return { layers: { noise: d.noise({ km: 600, octaves: 4, persistence: 0.6, salt: 'x' }), blur: d.blur(d.elevation, 12, land), steps: new Float32Array(d.steps(d.water)), near } };
    } });`;
    const pl = await make(code, ['layers'], { setup: { stages: ['layers'], layerIds: ['noise', 'blur', 'steps', 'near'] } });
    try {
      const w = small7();
      const a = layerHooks([pl], w.mesh, W.seed, fieldsOf(w));
      const b = layerHooks([pl], w.mesh, W.seed, fieldsOf(w));
      expect(a).toEqual(b);
      const h = mapHelpers(w.mesh, W.seed, 'p');
      const land = w.water.map((x) => (x === 0 ? 1 : 0));
      const near = new Float32Array(w.mesh.n);
      for (const i of h.near(0, 800)) near[i] = h.km(0, i);
      expect(a.map((l) => l.id)).toEqual(['noise', 'blur', 'steps', 'near']);
      expect(bytes(a[0].values)).toEqual(bytes(h.noise({ km: 600, octaves: 4, persistence: 0.6, salt: 'x' })));
      expect(bytes(a[1].values)).toEqual(bytes(h.blur(w.elevation, 12, land)));
      expect(bytes(a[2].values)).toEqual(bytes(new Float32Array(h.steps(w.water))));
      expect(bytes(a[3].values)).toEqual(bytes(near));
      expect(near.filter((x) => x > 0).length).toBeGreaterThan(3);
    } finally {
      pl.dispose();
    }
  });

  it('帮手的参数写错:插件没接住报这一口出错,接住了照常跑', async () => {
    const e = await errOf(() => heightOnce('d.noise({ km: -1 }); return undefined;'));
    expect(e).toBeInstanceOf(MapPluginError);
    expect(e.message).toMatch(/改海拔这一步出错:d\.noise 的 km 要是大于 0 的数/);
    expect((await errOf(() => heightOnce('d.blur(new Float32Array(3), 1); return undefined;'))).message).toMatch(/d\.blur 的 field 要是一个长度等于地块数/);
    expect((await errOf(() => heightOnce('d.blur(d.elevation, () => 1); return undefined;'))).message).toMatch(/参数里只能放.*不能有函数/);
    expect((await errOf(() => heightOnce('d.km(0, 1.5); return undefined;'))).message).toMatch(/d\.km\(a, b\) 的 a、b 要是地块编号/);
    const ok = await heightOnce(`let msg = ''; try { d.near(-1, 5); } catch (x) { msg = x.message; } return { elevation: d.elevation.map(() => (/d\\.near/.test(msg) ? 1 : -1)) };`);
    expect(ok.every((x) => x === 1)).toBe(true);
  });
});

describe('一次生成的合计用时', () => {
  const plugin = (id: string, stages: MapStage[]): MapPlugin => ({ id, key: `${id}@1`, stages, height: () => undefined, climate: () => undefined, layers: () => undefined });
  it('一口超过 5 秒、合计超过 15 秒报错;合计超了说是用得最多的那个', () => {
    const c1 = new MapClock();
    c1.spend('a', 'height', 4000);
    expect(() => c1.spend('a', 'climate', MAP_PLUGIN_TIME.stage + 1)).toThrow(/地图插件「a」在改气候这一步出错:用了 5\.0 秒,超过 5\.0 秒/);
    const c2 = new MapClock();
    c2.spend('a', 'height', 4900);
    c2.spend('b', 'height', 1000);
    c2.spend('a', 'climate', 4900);
    c2.spend('b', 'climate', 1000);
    let e: unknown;
    try {
      c2.spend('b', 'layers', 3500);
    } catch (x) {
      e = x;
    }
    expect(e).toBeInstanceOf(MapPluginError);
    expect([(e as MapPluginError).plugin, (e as MapPluginError).stage]).toEqual(['a', 'layers']);
    expect((e as Error).message).toMatch(/一共用了 15\.3 秒,超过 15\.0 秒\(它用得最多,9\.8 秒\)/);
    // 界面上列各用了多久:哪个插件、哪一口、多少毫秒(按先后,超时的那一口在最后)
    expect((e as MapPluginError).kind).toBe('total');
    expect((e as MapPluginError).spent).toEqual([
      { id: 'a', stage: 'height', ms: 4900 },
      { id: 'b', stage: 'height', ms: 1000 },
      { id: 'a', stage: 'climate', ms: 4900 },
      { id: 'b', stage: 'climate', ms: 1000 },
      { id: 'b', stage: 'layers', ms: 3500 },
    ]);
    let slow: unknown;
    try {
      new MapClock().spend('a', 'height', MAP_PLUGIN_TIME.stage + 1);
    } catch (x) {
      slow = x;
    }
    expect((slow as MapPluginError).kind).toBe('slow');
  });

  it('包上计时的插件照常跑,每一口记进钟;生成里超了停在那一口', () => {
    const spent: [string, MapStage, number][] = [];
    const clock = new MapClock();
    const orig = clock.spend.bind(clock);
    clock.spend = (id, stage, ms) => {
      spent.push([id, stage, ms]);
      orig(id, stage, ms);
    };
    const [a] = timedMapPlugins([{ ...plugin('a', ['height', 'layers']), layerIds: ['x'] }], clock);
    expect([a.id, a.key, a.stages, a.layerIds]).toEqual(['a', 'a@1', ['height', 'layers'], ['x']]);
    expect(a.climate).toBeUndefined();
    generateWorld(W, undefined, undefined, undefined, undefined, [a]);
    expect(spent.map(([id, s]) => `${id}/${s}`)).toEqual(['a/height', 'a/layers']);
    expect(spent.every(([, , ms]) => ms >= 0 && ms < 1000)).toBe(true);

    let t = 0;
    const slow = new MapClock(() => (t += 3000));
    const ps = timedMapPlugins([plugin('a', ['height', 'climate', 'layers']), plugin('b', ['height', 'climate', 'layers'])], slow);
    const e = (() => {
      try {
        generateWorld(W, undefined, undefined, undefined, undefined, ps);
      } catch (x) {
        return x;
      }
    })();
    expect(e).toBeInstanceOf(MapPluginError);
    expect((e as Error).message).toMatch(/所有地图插件一共用了 18\.0 秒,超过 15\.0 秒/);
  });
});
