/**
 * 工具插件替用的人翻年份、移地图、圈出国家和州(view.control@1):网站这边查参数、算飞到哪、限次;
 * 界面那一半在用的人按着地图、时间轴时让给他,插件停了拿掉圈的。沙箱换成假的。
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_PARAMS, generateWorld, type World } from '../src/gen/world';
import { generateCiv } from '../src/gen/civ';
import type { Civ } from '../src/gen/civ/types';
import { ownersAt } from '../src/gen/civ/engine/timeline';
import { EMPTY_EDITS, polityKey, regionKey, settlementKey } from '../src/gen/edits';
import { PLUGIN_METHODS } from '../src/plugin/caps';
import { PERMISSIONS, PLUGIN_CAPS, permissionLines } from '../src/plugin/pluginCaps';
import type { PluginResponse } from '../src/plugin/protocol';
import type { PluginSource } from '../src/plugin/host';
import type { SandboxOptions } from '../src/plugin/sandbox';
import type { ViewInfo } from '../src/plugin/types';
import { STEER_PER_SECOND, type ViewFocus, type ViewHighlight } from '../src/plugin/viewControl';
import { getCivHighlight, getCivTime, setCivHighlight, setCivTime } from '../src/ui/civView';
import { getDirectorFly } from '../src/ui/directorStore';
import { HANDS_BUSY, toolSteer } from '../src/ui/plugins/tools/toolSteer';

interface FakeSandbox {
  opts: SandboxOptions;
  sent: { id: number; res: PluginResponse }[];
  stopped: string | null;
}
const fakes: FakeSandbox[] = [];
vi.mock('../src/plugin/sandbox', () => ({
  startPluginSandbox: async (_code: string, opts: SandboxOptions) => {
    const f: FakeSandbox = { opts, sent: [], stopped: null };
    fakes.push(f);
    return {
      get stopped() {
        return f.stopped;
      },
      send() {},
      call: async () => undefined,
      ping: async () => {},
      respond(id: number, res: PluginResponse) {
        if (!f.stopped) f.sent.push({ id, res });
      },
      emit() {},
      stop() {
        if (f.stopped) return;
        f.stopped = 'stopped';
        opts.onStop?.('stopped', '');
      },
    };
  },
}));

const { startPluginHost } = await import('../src/plugin/host');

let world: World;
let civ: Civ;
beforeAll(() => {
  world = generateWorld({ ...DEFAULT_PARAMS, seed: 7, cells: 3000 });
  civ = generateCiv(world, { endYear: 800 });
});

// 限次按 performance.now() 算:钟停着,要过一秒就 tick()
beforeEach(() => void vi.useFakeTimers({ toFake: ['performance'] }));
afterEach(() => void vi.useRealTimers());
const tick = () => vi.advanceTimersByTime(1001);

const CAPS = ['history.read@1', 'view.control@1'];

async function open(extra: Partial<PluginSource> = {}, caps = CAPS) {
  const view: ViewInfo = { year: 100, selected: null, visible: null, layer: 'polities' };
  const did = { seek: [] as number[], fly: [] as ViewFocus[], highlight: [] as (ViewHighlight | null)[] };
  const host = await startPluginHost({
    plugin: { id: 'test', requires: caps },
    code: '',
    source: {
      world: () => world,
      civ: () => civ,
      edits: () => EMPTY_EDITS,
      view: () => view,
      seek: (y) => (did.seek.push(y), null),
      fly: (f) => (did.fly.push(f), null),
      highlight: (h) => void did.highlight.push(h),
      ...extra,
    },
  });
  const f = fakes.at(-1)!;
  let seq = 0;
  const call = async (name: string, args?: unknown) => {
    const id = ++seq;
    f.opts.onRequest!(id, name, args);
    for (let i = 0; i < 50; i++) {
      const got = f.sent.find((s) => s.id === id);
      if (got) return got.res;
      await new Promise((r) => setTimeout(r, 0));
    }
    return undefined;
  };
  const code = async (name: string, args?: unknown) => {
    const r = await call(name, args);
    return r?.ok ? 'ok' : (r?.error.code ?? '?');
  };
  return { host, call, code, did, view };
}

/** 点在框里(x 按框的中心绕回来) */
function inBox(f: ViewFocus, px: number, py: number): boolean {
  const [x0, y0, x1, y1] = f.box;
  const v = px - world.width * Math.round((px - (x0 + x1) / 2) / world.width);
  return v >= x0 - 1e-6 && v <= x1 + 1e-6 && py >= y0 - 1e-6 && py <= y1 + 1e-6;
}

/** 有国土的一国在 year 年的州 */
function livePolity(year: number): { id: number; regions: number[] } {
  const own = ownersAt(civ, year).polity;
  const by = new Map<number, number[]>();
  for (let r = 0; r < civ.regions.count; r++) if (own[r] >= 0) by.set(own[r], [...(by.get(own[r]) ?? []), r]);
  const [id, regions] = [...by].sort((a, b) => b[1].length - a[1].length)[1];
  return { id, regions };
}

describe('能力和权限框', () => {
  it('四个调用都要 view.control@1;权限框上单列一行,不显眼', async () => {
    for (const c of ['view.seek', 'view.fly', 'view.highlight', 'view.unhighlight']) expect(PLUGIN_METHODS[c], c).toEqual(['view.control@1']);
    expect(PLUGIN_CAPS.get('view.control@1')).toBe('viewSteer');
    expect(PERMISSIONS.viewSteer).toEqual({ text: '会替你翻年份、移地图', loud: false, note: '你正拖着地图、时间轴的时候，它不抢' });
    expect(permissionLines({ requires: ['view.read@1', 'view.control@1'] }).map((l) => l.key)).toEqual(['view', 'viewSteer']);
    const { code } = await open({}, ['history.read@1']);
    for (const c of ['view.seek', 'view.fly', 'view.highlight', 'view.unhighlight']) expect(await code(c, {}), c).toBe('no-permission');
  });

  it('网站这边没接上(只交图层的插件)= unavailable;拿掉圈的照样能调', async () => {
    const { code } = await open({ seek: undefined, fly: undefined, highlight: undefined });
    expect(await code('view.seek', { year: 10 })).toBe('unavailable');
    expect(await code('view.fly', { cells: [1] })).toBe('unavailable');
    expect(await code('view.highlight', { regions: [1] })).toBe('unavailable');
    expect(await code('view.unhighlight')).toBe('ok');
  });
});

describe('翻年份', () => {
  it('整数年、在历史里;没有历史回 unavailable', async () => {
    const { code, did } = await open();
    expect(await code('view.seek', { year: 420 })).toBe('ok');
    expect(did.seek).toEqual([420]);
    for (const bad of [{}, { year: -1 }, { year: 801 }, { year: 1.5 }, { year: '3' }]) expect(await code('view.seek', bad), JSON.stringify(bad)).toBe('bad-args');
    const none = await open({ civ: () => null });
    expect(await none.code('view.seek', { year: 1 })).toBe('unavailable');
  });

  it('一秒最多 4 次;网站让给用的人(回 busy)的不算次数', async () => {
    {
      let hands = true;
      const { code, did } = await open({ seek: (y) => (hands ? '用的人正按着' : (did.seek.push(y), null)) });
      expect(await code('view.seek', { year: 1 })).toBe('busy');
      expect(did.seek).toEqual([]);
      hands = false;
      const codes: string[] = [];
      for (let i = 0; i < 5; i++) codes.push(await code('view.seek', { year: i }));
      expect(codes).toEqual(['ok', 'ok', 'ok', 'ok', 'busy']);
      expect(STEER_PER_SECOND['view.seek']).toBe(4);
      tick();
      expect(await code('view.seek', { year: 9 })).toBe('ok');
    }
  });
});

describe('移地图', () => {
  it('地块、框:看全给的;东西接缝两边的连成一片;只有一个点也框开一点', async () => {
    const { code, did } = await open();
    const W = world.width;
    const { x, y } = world.mesh;
    let west = -1;
    let east = -1;
    for (let i = 0; i < world.mesh.n; i++) {
      if (x[i] < 30 && (west < 0 || Math.abs(y[i] - W / 4) < Math.abs(y[west] - W / 4))) west = i;
      if (x[i] > W - 30 && (east < 0 || Math.abs(y[i] - W / 4) < Math.abs(y[east] - W / 4))) east = i;
    }
    expect(await code('view.fly', { cells: [west, east] })).toBe('ok');
    const seam = did.fly.at(-1)!;
    expect(seam.box[2] - seam.box[0]).toBeLessThan(80);
    expect(inBox(seam, x[west], y[west]) && inBox(seam, x[east], y[east])).toBe(true);
    expect(seam.x).toBeGreaterThanOrEqual(0);
    expect(seam.x).toBeLessThan(W);

    tick();
    expect(await code('view.fly', { cells: new Int32Array([7]) })).toBe('ok');
    const one = did.fly.at(-1)!;
    expect(one.box[2] - one.box[0]).toBeCloseTo(2);
    expect(inBox(one, x[7], y[7])).toBe(true);

    tick();
    expect(await code('view.fly', { box: { x0: 2000, y0: 100, x1: 2100, y1: 200 } })).toBe('ok');
    const box = did.fly.at(-1)!;
    expect(box.box).toEqual([2000, 100, 2100, 200]);
    expect(box.x).toBeCloseTo(2050 - W);
    expect(box.lat).toBeCloseTo(90 - (150 / world.height) * 180);

    // 比半圈宽的框、整圈的框照原样
    for (const [x0, x1] of [
      [0, W * 0.75],
      [0, W],
    ]) {
      tick();
      expect(await code('view.fly', { box: { x0, y0: 100, x1, y1: 200 } })).toBe('ok');
      expect(did.fly.at(-1)!.box).toEqual([x0, 100, x1, 200]);
    }
  });

  it('国家看全那一年的国土(编号、键一样);州、城;不给年份按时间轴停的那一年', async () => {
    const { code, did, view } = await open();
    const p = livePolity(500);
    view.year = 500;
    expect(await code('view.fly', { polities: [p.id] })).toBe('ok');
    const byId = did.fly.at(-1)!;
    for (const r of p.regions)
      for (let k = civ.regions.cellStart[r]; k < civ.regions.cellStart[r + 1]; k++) {
        const c = civ.regions.cells[k];
        expect(inBox(byId, world.mesh.x[c], world.mesh.y[c])).toBe(true);
      }
    view.year = 0;
    expect(await code('view.fly', { polities: [polityKey(civ, p.id)], year: 500 })).toBe('ok');
    expect(did.fly.at(-1)).toEqual(byId);

    const r = p.regions[0];
    const s = civ.settlements.find((x) => x.region !== r)!;
    tick();
    expect(await code('view.fly', { regions: [regionKey(civ, r)], settlements: [settlementKey(civ, s.id)] })).toBe('ok');
    const both = did.fly.at(-1)!;
    expect(inBox(both, world.mesh.x[s.cell], world.mesh.y[s.cell])).toBe(true);
    expect(inBox(both, world.mesh.x[civ.regions.seat[r]], world.mesh.y[civ.regions.seat[r]])).toBe(true);
  });

  it('什么都没给、键找不到、编号超出、框不对回 bad-args;给了国城州但没有历史回 unavailable', async () => {
    const { code } = await open();
    for (const bad of [
      {},
      { cells: [] },
      { cells: [world.mesh.n] },
      { polities: [civ.polities.length] },
      { polities: ['polity:c1#99'] },
      { regions: [polityKey(civ, 0)] },
      { box: { x0: 0, y0: 0, x1: 10 } },
      { box: { x0: 0, y0: -5, x1: 10, y1: 10 } },
      { box: { x0: 10, y0: 0, x1: 5, y1: 10 } },
      { polities: [0], year: 9999 },
    ])
      expect(await code('view.fly', bad), JSON.stringify(bad)).toBe('bad-args');
    const none = await open({ civ: () => null });
    expect(await none.code('view.fly', { cells: [3] })).toBe('ok');
    expect(await none.code('view.fly', { regions: [3] })).toBe('unavailable');
  });

  it('一秒最多 2 次', async () => {
    const { code } = await open();
    const codes: string[] = [];
    for (let i = 0; i < 3; i++) codes.push(await code('view.fly', { cells: [i] }));
    expect(codes).toEqual(['ok', 'ok', 'busy']);
  });
});

describe('圈出国家和州', () => {
  it('编号、键都行,重复的只留一个;不给年份按时间轴停的那一年;什么都没给回 bad-args', async () => {
    const { code, did, view } = await open();
    view.year = 321;
    expect(await code('view.highlight', { polities: [3, polityKey(civ, 3)], regions: [regionKey(civ, 5)] })).toBe('ok');
    expect(did.highlight.at(-1)).toEqual({ polities: [3], regions: [5], year: 321 });
    expect(await code('view.highlight', { regions: [5], year: 12 })).toBe('ok');
    expect(did.highlight.at(-1)).toEqual({ polities: [], regions: [5], year: 12 });
    for (const bad of [{}, { polities: [] }, { regions: [-1] }, { regions: ['nope'] }, { regions: [1], year: 801 }, { polities: 3 }]) expect(await code('view.highlight', bad), JSON.stringify(bad)).toBe('bad-args');
    const none = await open({ civ: () => null });
    expect(await none.code('view.highlight', { regions: [1] })).toBe('unavailable');
  });

  it('拿掉:圈过才告诉网站;插件停了自动拿掉,没圈过的不动', async () => {
    const a = await open();
    expect(await a.code('view.unhighlight')).toBe('ok');
    expect(a.did.highlight).toEqual([]);
    await a.code('view.highlight', { regions: [1] });
    expect(await a.code('view.unhighlight')).toBe('ok');
    expect(a.did.highlight.at(-1)).toBeNull();
    await a.code('view.highlight', { regions: [2] });
    a.host.stop();
    expect(a.did.highlight.at(-1)).toBeNull();
    expect(a.did.seek).toEqual([]);

    const b = await open();
    await b.code('view.seek', { year: 5 });
    b.host.stop();
    expect(b.did.highlight).toEqual([]);
  });

  it('一秒最多 10 次', async () => {
    const { code } = await open();
    const codes: string[] = [];
    for (let i = 0; i < 11; i++) codes.push(await code('view.highlight', { regions: [i] }));
    expect(codes.filter((c) => c === 'ok')).toHaveLength(10);
    expect(codes.at(-1)).toBe('busy');
  });
});

describe('界面那一半', () => {
  const hands = new EventTarget();
  const press = (type: string, id: number, buttons = 1) => hands.dispatchEvent(Object.assign(new Event(type), { pointerId: id, buttons }));

  it('用的人按着(任何地方)、拖着时间轴:翻年份、移地图回原因,年份、地图不动;松手就照办,播放停下', () => {
    vi.stubGlobal('window', hands);
    let s: ReturnType<typeof toolSteer>;
    try {
      s = toolSteer(() => true);
    } finally {
      vi.unstubAllGlobals();
    }
    {
      const focus: ViewFocus = { box: [0, 0, 10, 10], x: 5, y: 5, lon: 0, lat: 0 };
      setCivTime({ year: 50, playing: true, scrubbing: false });
      press('pointerdown', 1);
      expect(s.seek(300)).toBe(HANDS_BUSY);
      const flown = getDirectorFly()?.stamp ?? 0;
      expect(s.fly(focus)).toBe(HANDS_BUSY);
      expect(getDirectorFly()?.stamp ?? 0).toBe(flown);
      expect(getCivTime()).toMatchObject({ year: 50, playing: true });
      press('pointerup', 1);
      expect(s.seek(300)).toBeNull();
      expect(getCivTime()).toMatchObject({ year: 300, playing: false });
      expect(s.fly(focus)).toBeNull();
      expect(getDirectorFly()).toMatchObject({ focus, stamp: flown + 1 });
      // 在窗口外面松的手:之后一动、没按着就算松了
      press('pointerdown', 2);
      expect(s.seek(1)).toBe(HANDS_BUSY);
      press('pointermove', 2, 0);
      expect(s.seek(1)).toBeNull();
      setCivTime({ scrubbing: true });
      expect(s.seek(2)).toBe(HANDS_BUSY);
      setCivTime({ scrubbing: false });
    }
  });

  it('圈的一直亮着、不挪地图;拿掉只拿自己圈的;插件停了照样拿得掉', () => {
    let live = true;
    const s = toolSteer(() => live);
    s.highlight({ polities: [1], regions: [2], year: 30 });
    expect(getCivHighlight()).toMatchObject({ polities: [1], regions: [2], year: 30, steady: true, still: true });
    setCivHighlight({ regions: [9], polities: [], year: 1 });
    s.highlight(null);
    expect(getCivHighlight()).toMatchObject({ regions: [9] });
    s.highlight({ polities: [], regions: [4], year: 3 });
    live = false;
    expect(s.seek(1)).not.toBeNull();
    s.highlight({ polities: [], regions: [5], year: 3 });
    expect(getCivHighlight()).toMatchObject({ regions: [4] });
    s.highlight(null);
    expect(getCivHighlight()).toBeNull();
  });
});
