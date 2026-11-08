/**
 * 插件接口第 1 版(网站这边):能力表、线程里的 civAtlas、读世界、面板和图层的检查、回调用。
 * 沙箱换成假的(真沙箱在 scripts/sandbox-check.ts 里三个浏览器各跑一遍同样的插件)。
 */
import vm from 'node:vm';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { DEFAULT_PARAMS, generateWorld, type World } from '../src/gen/world';
import { generateCiv } from '../src/gen/civ';
import type { Civ } from '../src/gen/civ/types';
import { buildChronicle } from '../src/gen/civ/story/chronicle';
import { ownersAt } from '../src/gen/civ/engine/timeline';
import { EMPTY_EDITS, resolveKey, type Intervention, type WorldEdits } from '../src/gen/edits';
import { checkCaps, PLUGIN_EVENTS, PLUGIN_METHODS } from '../src/plugin/caps';
import { PLUGIN_CAPS } from '../src/plugin/pluginCaps';
import { checkCellLayer, checkMarkLayer, checkPanel, panelValue, PluginApiError, PANEL_NODES_MAX } from '../src/plugin/check';
import { approxBytes, MESSAGE_MAX_BYTES, PROTOCOL, readFrameMessage, workerSource } from '../src/plugin/protocol';
import * as read from '../src/plugin/read';
import type { PluginResponse } from '../src/plugin/protocol';
import type { SandboxOptions } from '../src/plugin/sandbox';
import type { InterventionInfo, PanelNode, ViewInfo } from '../src/plugin/types';

const v = PROTOCOL;

/** 抛的 PluginApiError 的 code */
function codeOf(f: () => unknown): string {
  try {
    f();
  } catch (e) {
    if (e instanceof PluginApiError) return e.code;
    throw e;
  }
  return 'no error';
}

describe('能力表', () => {
  it('每个调用、事件要的能力都在能力名表里;能力名表里的每样都有调用用它', () => {
    const used = new Set<string>();
    for (const [name, caps] of Object.entries(PLUGIN_METHODS)) for (const c of caps) expect(PLUGIN_CAPS.has(c), name).toBe(true), used.add(c);
    for (const c of Object.values(PLUGIN_EVENTS)) expect(PLUGIN_CAPS.has(c)).toBe(true);
    expect([...PLUGIN_CAPS.keys()].filter((c) => !used.has(c))).toEqual([]);
  });

  it('认得的给;写法不对、写了两遍 = broken;网站没有的 = newer;optional 里网站没有的不给', () => {
    expect(checkCaps(['world.read@1', 'ui.panel@1'], ['layer.cells@1', 'sim.run@1'])).toEqual({
      ok: true,
      requires: ['world.read@1', 'ui.panel@1'],
      optional: ['layer.cells@1'],
    });
    expect(checkCaps([])).toEqual({ ok: true, requires: [], optional: [] });
    expect(checkCaps(undefined)).toMatchObject({ ok: false, kind: 'broken' });
    expect(checkCaps(['world.read'])).toMatchObject({ ok: false, kind: 'broken' });
    expect(checkCaps('world.read@1')).toMatchObject({ ok: false, kind: 'broken' });
    expect(checkCaps([1])).toMatchObject({ ok: false, kind: 'broken' });
    expect(checkCaps(['World.read@1'])).toMatchObject({ ok: false, kind: 'broken' });
    expect(checkCaps(['world.read@1', 'world.read@1'])).toMatchObject({ ok: false, kind: 'broken' });
    expect(checkCaps(['world.read@1'], ['world.read@1'])).toMatchObject({ ok: false, kind: 'broken' });
    expect(checkCaps(Array.from({ length: 33 }, (_, i) => `x.y${i}@1`))).toMatchObject({ ok: false, kind: 'broken' });
    expect(checkCaps(['world.read@2'])).toMatchObject({ ok: false, kind: 'newer' });
    expect(checkCaps(['net.fetch@1'])).toMatchObject({ ok: false, kind: 'newer' });
    expect(checkCaps(['world.read@1'], ['x'])).toMatchObject({ ok: false, kind: 'broken' });
  });
});

describe('传话', () => {
  it('认得插件的调用;写法不对的当乱发话', () => {
    const plugin = (data: unknown) => readFrameMessage({ from: 'plugin', data });
    expect(plugin({ v, kind: 'req', id: 1, call: 'world.cells', args: { fields: ['x'] } })).toEqual({
      from: 'plugin',
      msg: { kind: 'req', id: 1, call: 'world.cells', args: { fields: ['x'] } },
    });
    expect(plugin({ v, kind: 'req', id: 2, call: 'no.such.call' })).toMatchObject({ msg: { kind: 'req', call: 'no.such.call' } });
    for (const bad of [{ v, kind: 'req', call: 'log' }, { v, kind: 'req', id: 0, call: 'log' }, { v, kind: 'req', id: 1 }, { v, kind: 'req', id: 1, call: '__proto__' }, { v, kind: 'req', id: 1, call: 'a'.repeat(40) }, { v, kind: 'req', id: 1, call: 'a..b' }])
      expect(plugin(bad), JSON.stringify(bad)).toBeNull();
  });

  it('估大小:字、数组、套着的对象;同一个对象只算一次;值太多直接算超', () => {
    expect(approxBytes('ab', 1e9)).toBe(12);
    expect(approxBytes(new Float32Array(1000), 1e9)).toBe(4000);
    const shared = new Uint8Array(1000);
    expect(approxBytes({ a: shared, b: shared }, 1e9)).toBeLessThan(1100);
    const loop: Record<string, unknown> = {};
    loop.self = loop;
    expect(approxBytes(loop, 1e9)).toBeLessThan(100);
    expect(approxBytes(new Array(10_000_000), 1e12)).toBe(Infinity);
    expect(approxBytes({ s: 'x'.repeat(5000) }, 1000)).toBeGreaterThan(1000);
    expect(approxBytes(new Map([[1, 'x'.repeat(100)]]), 1e9)).toBeGreaterThan(200);
  });

  it('Error 的 message、stack、cause 也算;估不了的东西一律算太大', () => {
    expect(approxBytes(new Error('small', { cause: new Uint8Array(1_000_000) }), 1e9)).toBeGreaterThanOrEqual(1_000_000);
    expect(approxBytes(new Error('x'.repeat(10_000)), 1e9)).toBeGreaterThanOrEqual(20_000);
    expect(approxBytes(new RegExp('x'.repeat(10_000)), 1e9)).toBeGreaterThanOrEqual(20_000);
    expect(approxBytes(new String('x'.repeat(10_000)), 1e9)).toBeGreaterThanOrEqual(20_000);
    expect(approxBytes({ d: new Date(), n: new Number(1) }, 1e9)).toBeLessThan(100);
    expect(approxBytes(new (class Thing {})(), 1e9)).toBe(Infinity);
  });

  it('数组带着别的键也算', () => {
    const a: number[] & { extra?: string } = [1, 2];
    a.extra = 'x'.repeat(10_000);
    expect(approxBytes(a, 1e9)).toBeGreaterThanOrEqual(20_000);
  });

  it('小视图后面挂着大缓冲区,按整个缓冲区算', () => {
    expect(approxBytes(new Uint8Array(new ArrayBuffer(1_000_000), 0, 1), 1e9)).toBeGreaterThanOrEqual(1_000_000);
    const buf = new ArrayBuffer(1000);
    expect(approxBytes([new Uint8Array(buf), new Float32Array(buf)], 1e9)).toBeLessThan(1100);
  });

  it('合规矩的最大的话(20 万个点的标注图层、20 万地块的图层写成普通数组)不算太大', () => {
    expect(approxBytes({ id: 'a', title: 'a', items: [{ kind: 'line', points: Array(400_000).fill(1.5) }] }, MESSAGE_MAX_BYTES)).toBeLessThanOrEqual(MESSAGE_MAX_BYTES);
    expect(approxBytes({ id: 'a', title: 'a', values: Array(200_000).fill(1.5), ramp: { colors: ['#000000', '#ffffff'] } }, MESSAGE_MAX_BYTES)).toBeLessThanOrEqual(MESSAGE_MAX_BYTES);
  });
});

/** 在 Node 里照线程的样子跑一遍 workerSource */
function runWorker(code: string) {
  const sent: Record<string, unknown>[] = [];
  const handlers: ((e: { data: unknown }) => void)[] = [];
  const ctx: Record<string, unknown> = {
    postMessage: (m: Record<string, unknown>) => sent.push(m),
    addEventListener: (type: string, fn: (e: { data: unknown }) => void) => type === 'message' && handlers.push(fn),
    Promise,
    queueMicrotask,
    setTimeout,
  };
  ctx.self = ctx;
  vm.createContext(ctx);
  vm.runInContext(workerSource(code), ctx);
  const deliver = async (data: unknown) => {
    handlers.forEach((h) => h({ data }));
    await new Promise((r) => setTimeout(r, 0));
  };
  return { sent, deliver, ctx };
}

describe('线程里的 civAtlas', () => {
  it('照调用表长出函数;顶层里调接口排在 hello 后面', async () => {
    const w = runWorker('self.shape = [typeof civAtlas.world.cells, typeof civAtlas.store.world.set, typeof civAtlas.request, typeof civAtlas.log]; civAtlas.world.info();');
    expect(w.ctx.shape).toEqual(['function', 'function', 'function', 'function']);
    await w.deliver('junk');
    expect(w.sent).toEqual([
      { v, kind: 'hello' },
      { v, kind: 'req', id: 1, call: 'world.info', args: undefined },
    ]);
  });

  it('回话按 id 对上:成功给数据,失败的 Error 带 code;事件交给 on 的函数,取消了就不再交', async () => {
    const w = runWorker(`
      self.got = [];
      civAtlas.history.span().then((d) => got.push(['ok', d]));
      civAtlas.world.cells({ fields: ['x'] }).catch((e) => got.push(['err', e.code, e.message]));
      const off = civAtlas.on('view.year', (d) => got.push(['year', d.year]));
      self.off = off;
    `);
    await w.deliver('x');
    await w.deliver({ v, kind: 'res', id: 2, ok: false, error: { code: 'no-permission', text: '没要' } });
    await w.deliver({ v, kind: 'res', id: 1, ok: true, data: { from: 0, to: 9 } });
    await w.deliver({ v, kind: 'res', id: 1, ok: true, data: 'again' });
    await w.deliver({ v, kind: 'event', name: 'view.year', data: { year: 5 } });
    (w.ctx.off as () => void)();
    await w.deliver({ v, kind: 'event', name: 'view.year', data: { year: 6 } });
    expect(w.ctx.got).toEqual([
      ['err', 'no-permission', '没要'],
      ['ok', { from: 0, to: 9 }],
      ['year', 5],
    ]);
  });

  it('log 把几样东西拼成一句发出去,不等回话', async () => {
    const w = runWorker("civAtlas.log('a', 1, { b: 2 }, [3]);");
    await w.deliver('x');
    expect(w.sent[1]).toEqual({ v, kind: 'req', id: 1, call: 'log', args: { text: 'a 1 {"b":2} [3]' } });
  });

  it('civAtlas 改不了', () => {
    const w = runWorker("try { civAtlas.world.cells = 1; } catch (e) {} try { civAtlas.world = 1; } catch (e) {} self.t = typeof civAtlas.world.cells;");
    expect(w.ctx.t).toBe('function');
  });
});

describe('面板', () => {
  const ok: unknown[] = [
    { type: 'heading', text: '框选合计' },
    { type: 'number', label: '面积', value: 12.5, unit: '万平方公里' },
    { type: 'table', columns: ['国家', '州'], rows: [['大昌', 3], ['索拉', 1]] },
    { type: 'group', title: '设置', children: [{ type: 'slider', id: 'speed', label: '速度', min: 0, max: 10, value: 3 }, { type: 'toggle', id: 'sea', label: '走海路', value: false }] },
    { type: 'select', id: 'mode', label: '方式', options: [{ value: 'a', label: '甲' }, { value: 'b', label: '乙' }], value: 'b' },
    { type: 'button', id: 'go', label: '开始' },
    { type: 'legend', items: [{ color: '#FFAA00', label: '近' }] },
    { type: 'progress', value: 0.5 },
    { type: 'divider' },
    { type: 'list', items: ['一', '二'] },
    { type: 'text', text: '第一行\r\n第二行‮' },
  ];

  it('合格的原样留下(字去掉控制字符,颜色换成小写)', () => {
    const p = checkPanel(ok);
    expect(p).toHaveLength(ok.length);
    expect(p[6]).toEqual({ type: 'legend', items: [{ color: '#ffaa00', label: '近' }] });
    expect(p[10]).toEqual({ type: 'text', text: '第一行\n第二行' });
  });

  it('不合格的报 bad-args,超上限的报 limit', () => {
    expect(codeOf(() => checkPanel('x'))).toBe('bad-args');
    expect(codeOf(() => checkPanel([{ type: 'html', html: '<b>' }]))).toBe('bad-args');
    expect(codeOf(() => checkPanel([{ type: 'button', id: 'a b', label: 'x' }]))).toBe('bad-args');
    expect(codeOf(() => checkPanel([{ type: 'button', id: 'a', label: 'x' }, { type: 'toggle', id: 'a', label: 'y', value: true }]))).toBe('bad-args');
    expect(codeOf(() => checkPanel([{ type: 'select', id: 'a', label: 'x', options: [{ value: 'a', label: 'a' }], value: 'z' }]))).toBe('bad-args');
    expect(codeOf(() => checkPanel([{ type: 'slider', id: 'a', label: 'x', min: 0, max: 1, value: 2 }]))).toBe('bad-args');
    expect(codeOf(() => checkPanel([{ type: 'number', label: 'x', value: NaN }]))).toBe('bad-args');
    expect(codeOf(() => checkPanel([{ type: 'legend', items: [{ color: 'red', label: 'x' }] }]))).toBe('bad-args');
    expect(codeOf(() => checkPanel(Array(PANEL_NODES_MAX + 1).fill({ type: 'divider' })))).toBe('limit');
    expect(codeOf(() => checkPanel([{ type: 'text', text: 'x'.repeat(4001) }]))).toBe('limit');
    expect(codeOf(() => checkPanel(Array(5).fill({ type: 'text', text: 'x'.repeat(900) })))).toBe('limit');
    expect(codeOf(() => checkPanel([{ type: 'table', columns: ['a'], rows: Array(501).fill([1]) }]))).toBe('limit');
    let deep: unknown = [{ type: 'divider' }];
    for (let i = 0; i < 5; i++) deep = [{ type: 'group', children: deep }];
    expect(codeOf(() => checkPanel(deep))).toBe('limit');
  });

  it('同一份表格引用很多次也按展开以后数,很快就报超上限', () => {
    const row = Array(20).fill(1);
    const table = { type: 'table', columns: ['a'], rows: Array(500).fill(row) };
    const t0 = performance.now();
    expect(codeOf(() => checkPanel(Array(2000).fill(table)))).toBe('limit');
    expect(codeOf(() => checkPanel(Array(2000).fill({ type: 'table', columns: [], rows: Array(500).fill([]) })))).toBe('limit');
    expect(performance.now() - t0).toBeLessThan(500);
  });

  it('用的人动了控件:值要合那个控件', () => {
    const p = checkPanel(ok) as PanelNode[];
    expect(panelValue(p, 'go', undefined)).toEqual({ id: 'go' });
    expect(panelValue(p, 'speed', 4)).toEqual({ id: 'speed', value: 4 });
    expect(panelValue(p, 'speed', 40)).toBeNull();
    expect(panelValue(p, 'sea', true)).toEqual({ id: 'sea', value: true });
    expect(panelValue(p, 'mode', 'a')).toEqual({ id: 'mode', value: 'a' });
    expect(panelValue(p, 'mode', 'z')).toBeNull();
    expect(panelValue(p, 'nope', 1)).toBeNull();
  });
});

describe('图层', () => {
  const world = { cells: 10, width: 2048, height: 1024 };

  it('地块图层:值换成 Float32Array,不是有限数的换成 NaN;渐变和分类给且只给一个', () => {
    const l = checkCellLayer({ id: 'dist', title: '离海多远', values: [0, 1, 2, Infinity, 4, 5, 6, 7, 8, 9], ramp: { colors: ['#000000', '#FFFFFF'] }, opacity: 0.6 }, 10);
    expect(l.values).toBeInstanceOf(Float32Array);
    expect(Number.isNaN(l.values[3])).toBe(true);
    expect(l.ramp).toEqual({ colors: ['#000000', '#ffffff'] });
    const c = checkCellLayer({ id: 'k', title: 'k', values: new Uint8Array(10), classes: [{ value: 0, color: '#123456', label: '零' }] }, 10);
    expect(c.classes).toHaveLength(1);
    expect(codeOf(() => checkCellLayer({ id: 'k', title: 'k', values: new Float32Array(9), ramp: { colors: ['#000000', '#ffffff'] } }, 10))).toBe('bad-args');
    expect(codeOf(() => checkCellLayer({ id: 'k', title: 'k', values: new Float32Array(11), ramp: { colors: ['#000000', '#ffffff'] } }, 10))).toBe('limit');
    expect(codeOf(() => checkCellLayer({ id: 'k', title: 'k', values: new Float32Array(10) }, 10))).toBe('bad-args');
    expect(codeOf(() => checkCellLayer({ id: 'k', title: 'k', values: new Float32Array(10), ramp: { colors: ['#000000'] } }, 10))).toBe('bad-args');
    expect(codeOf(() => checkCellLayer({ id: 'k', title: 'k', values: new BigInt64Array(10), ramp: { colors: ['#000000', '#ffffff'] } }, 10))).toBe('bad-args');
    expect(codeOf(() => checkCellLayer({ id: 'k', title: 'k', values: new Float32Array(10), classes: [{ value: 1, color: '#000000', label: 'a' }, { value: 1, color: '#000000', label: 'b' }] }, 10))).toBe('bad-args');
  });

  it('标注图层:位置个数要合种类;点的 x 规整到地图宽里;地块编号要在范围里', () => {
    const l = checkMarkLayer(
      {
        id: 'route',
        title: '路线',
        items: [
          { kind: 'line', cells: [1, 2, 3], style: { color: 'red', line: 'dashed' } },
          { kind: 'label', points: [-10, 5], text: '起点' },
          { kind: 'area', cells: new Int32Array([4, 5]) },
          { kind: 'point', cells: [9] },
        ],
      },
      world,
    );
    expect(l.items[1].points![0]).toBeCloseTo(2038);
    expect(l.items[0].cells).toEqual(new Int32Array([1, 2, 3]));
    const one = (it: unknown) => codeOf(() => checkMarkLayer({ id: 'a', title: 'a', items: [it] }, world));
    expect(one({ kind: 'point', cells: [1, 2] })).toBe('bad-args');
    expect(one({ kind: 'label', cells: [1] })).toBe('bad-args');
    expect(one({ kind: 'line', cells: [1] })).toBe('bad-args');
    expect(one({ kind: 'area', points: [1, 1] })).toBe('bad-args');
    expect(one({ kind: 'point', cells: [10] })).toBe('bad-args');
    expect(one({ kind: 'point', points: [1, 2000] })).toBe('bad-args');
    expect(one({ kind: 'point', cells: [1], style: { color: 'pink' } })).toBe('bad-args');
    expect(one({ kind: 'point', cells: [1], text: 'x'.repeat(41) })).toBe('limit');
    expect(one({ kind: 'circle', cells: [1] })).toBe('bad-args');
    expect(codeOf(() => checkMarkLayer({ id: 'a', title: 'a', items: Array(5001).fill({ kind: 'point', cells: [1] }) }, world))).toBe('limit');
    expect(codeOf(() => checkMarkLayer({ id: 'a', title: 'a', items: Array(5).fill({ kind: 'area', cells: new Int32Array(50_000) }) }, { ...world, cells: 1e6 }))).toBe('limit');
  });
});

// ---------------------------------------------------------------------------
// 读世界:一个小世界

let world: World;
let civ: Civ;
const noGive: read.Give = (a) => a;

beforeAll(() => {
  world = generateWorld({ ...DEFAULT_PARAMS, seed: 7, cells: 3000 });
  civ = generateCiv(world, { endYear: 800 });
});

describe('读地图', () => {
  it('取的几种都是新的一份,改了不影响世界;经纬度、面积对得上', () => {
    const given: ArrayBufferView[] = [];
    const out = read.worldCells(world, { fields: ['elevation', 'lon', 'lat', 'area', 'water', 'elevation'] }, (a) => (given.push(a), a));
    expect(given).toHaveLength(5);
    expect(out.elevation).toEqual(world.elevation);
    expect(out.elevation!.buffer).not.toBe(world.elevation.buffer);
    out.elevation![0] = 1e9;
    expect(world.elevation[0]).not.toBe(1e9);
    expect(Math.min(...out.lon!)).toBeGreaterThanOrEqual(-180);
    expect(Math.max(...out.lat!)).toBeLessThanOrEqual(90);
    // 整颗球(赤道一圈 4 万公里)约 5.1 亿平方公里
    const total = out.area!.reduce((s, x) => s + x, 0);
    expect(total / 5.09e8).toBeGreaterThan(0.97);
    expect(total / 5.09e8).toBeLessThan(1.03);
    expect(codeOf(() => read.worldCells(world, { fields: ['secret'] }, noGive))).toBe('bad-args');
    expect(codeOf(() => read.worldCells(world, { fields: Array(17).fill('x') }, noGive))).toBe('limit');
    expect(codeOf(() => read.worldCells(world, {}, noGive))).toBe('bad-args');
  });

  it('相邻表、河、图例', () => {
    const nb = read.worldNeighbors(world, noGive);
    expect(nb.start.length).toBe(world.mesh.n + 1);
    expect(nb.list.buffer).not.toBe(world.mesh.adj.buffer);
    expect(read.worldRivers(world, noGive)).toHaveLength(world.rivers.length);
    expect(read.worldLegend({ kind: 'biome' })[0]).toMatchObject({ value: 0 });
    expect(codeOf(() => read.worldLegend({ kind: 'x' }))).toBe('bad-args');
  });
});

describe('读历史', () => {
  it('某一年每个地块的归属照州的归属铺开,水上是 −1', () => {
    const year = 600;
    const at = read.historyAt(world, civ, { year, fields: ['polity', 'culture', 'region', 'faith'] }, noGive);
    const own = ownersAt(civ, year);
    for (let i = 0; i < world.mesh.n; i++) {
      const r = civ.regions.of[i];
      expect(at.polity![i]).toBe(r >= 0 ? own.polity[r] : -1);
      expect(at.region![i]).toBe(r);
    }
    expect(codeOf(() => read.historyAt(world, civ, { year: civ.endYear + 1, fields: ['polity'] }, noGive))).toBe('bad-args');
    expect(codeOf(() => read.historyAt(world, civ, { year: 1, fields: ['people'] }, noGive))).toBe('bad-args');
  });

  it('国家、城、民族、信仰、州、地名、人物的键都找得回自己', () => {
    const year = 600;
    const ps = read.historyPolities(civ, { year });
    expect(ps.length).toBeGreaterThan(0);
    for (const p of ps) expect(resolveKey(civ, p.key)).toEqual({ kind: 'polity', id: p.id });
    expect(ps[0].color).toMatch(/^#[0-9a-f]{6}$/);
    expect(read.historyPolities(civ, {}).length).toBe(civ.polities.length);
    const ss = read.historySettlements(civ, { year });
    for (const s of ss.slice(0, 50)) {
      expect(resolveKey(civ, s.key)).toEqual({ kind: 'settlement', id: s.id });
      expect(s.population).toBeGreaterThanOrEqual(0);
    }
    for (const c of read.historyCultures(civ)) expect(resolveKey(civ, c.key)).toEqual({ kind: 'culture', id: c.id });
    for (const f of read.historyFaiths(civ)) expect(resolveKey(civ, f.key)).toEqual({ kind: 'faith', id: f.id });
    const rs = read.historyRegions(civ, { year });
    expect(rs).toHaveLength(civ.regions.count);
    for (const r of rs.slice(0, 50)) expect(resolveKey(civ, r.key)).toEqual({ kind: 'region', id: r.id });
    for (const p of read.historyPlaces(civ).slice(0, 20)) expect(resolveKey(civ, p.key)).toEqual({ kind: 'place', id: p.id });
    const people = read.historyPeople(civ, { limit: 30 });
    for (const p of people.items) expect(resolveKey(civ, p.key)).toEqual({ kind: 'person', id: p.id });
    const routes = read.historyRoutes(civ, { year }, noGive);
    expect(routes.every((r) => r.built <= year)).toBe(true);
  });

  it('有地形大事的历史:某一年的归属按那一段的州铺开;界面手里是更早一段时也按整段历史读', () => {
    const fake = {
      endYear: 1000,
      upheavals: [{ year: 500 }],
      eras: [{ until: 500, habitat: {}, regions: { count: 3, of: new Int32Array([0, 1, 2]), seat: new Int32Array([0, 1, 2]) }, places: [], routes: [] }],
      regions: { count: 3, of: new Int32Array([0, -1, 2]), seat: new Int32Array([0, 2, 2]) },
      places: [],
      routes: [],
    } as unknown as Civ;
    const w3 = { mesh: { n: 3 } } as unknown as World;
    expect(read.historyAt(w3, fake, { year: 400, fields: ['region'] }, noGive).region).toEqual(new Int32Array([0, 1, 2]));
    expect(read.historyAt(w3, fake, { year: 500, fields: ['region'] }, noGive).region).toEqual(new Int32Array([0, -1, 2]));
    expect(read.needCiv({ history: fake } as unknown as Civ)).toBe(fake);
  });

  it('城是不是港口按那一年(地形大事能改)', () => {
    const i = civ.settlements.findIndex((s) => s.ended === undefined && s.founded < 300);
    const s0 = civ.settlements[i];
    const c2 = { ...civ, settlements: civ.settlements.map((s, j) => (j === i ? { ...s, port: false, reshaped: [{ year: s0.founded + 100, capacity: s.capacity, port: true }] } : s)) };
    const at = (y: number) => read.historySettlements(c2, { year: y }).find((s) => s.id === s0.id)!.port;
    expect(at(s0.founded + 50)).toBe(false);
    expect(at(s0.founded + 150)).toBe(true);
  });

  it('人物、编年史分页取;一次最多 2000;编年史的字照原样', () => {
    const all = civ.people!.length;
    const first = read.historyPeople(civ, { limit: 10 });
    expect(first).toMatchObject({ total: all, next: 10 });
    const last = read.historyPeople(civ, { offset: all - 3, limit: 10 });
    expect(last.items).toHaveLength(3);
    expect(last.next).toBeNull();
    expect(read.historyPeople(civ, { role: 'ruler' }).items.every((p) => p.role === 'ruler')).toBe(true);
    expect(codeOf(() => read.historyPeople(civ, { limit: 2001 }))).toBe('limit');
    expect(codeOf(() => read.historyPeople(civ, { role: 'king' }))).toBe('bad-args');
    const chron = buildChronicle(civ);
    const ev = read.historyEvents(civ, chron, { from: 100, to: 500 });
    expect(ev.items.length).toBeGreaterThan(0);
    expect(ev.items.every((e) => e.year >= 100 && e.year <= 500)).toBe(true);
    expect(ev.items[0].text).toBe(chron.find((e) => e.id === ev.items[0].id)!.text);
    expect(codeOf(() => read.historyEvents(civ, null, {}))).toBe('unavailable');
    expect(codeOf(() => read.historyEvents(civ, chron, { from: 500, to: 100 }))).toBe('bad-args');
  });
});

describe('读你写的东西', () => {
  it('复制一份;正文分页', () => {
    const edits: WorldEdits = { ...EMPTY_EDITS, names: { 'polity:c1#0': '甲' }, marks: [{ id: 1, title: '故乡', color: 'red', from: 0, at: [10, 20] }] };
    const marks = read.authorMarks(edits);
    marks[0].title = '改了';
    expect(edits.marks![0].title).toBe('故乡');
    expect(read.authorNames(edits)).toEqual({ 'polity:c1#0': '甲' });
    const notes = Array.from({ length: 120 }, (_, i) => ({ key: `k${i}`, kind: 'book', title: `第${i}篇`, text: 't', createdAt: '', provider: 'p', model: 'm' }));
    const pg = read.authorNotes(notes, {});
    expect(pg).toMatchObject({ total: 120, next: 100 });
    expect(pg.items[0]).toEqual({ key: 'k0', kind: 'book', title: '第0篇', text: 't', createdAt: '' });
  });
});

// ---------------------------------------------------------------------------
// 回调用:沙箱换成假的

interface FakeSandbox {
  opts: SandboxOptions;
  sent: { id: number; res: PluginResponse; transfer?: Transferable[] }[];
  events: { name: string; data: unknown }[];
  stopped: string | null;
}
const fakes: FakeSandbox[] = [];
vi.mock('../src/plugin/sandbox', () => ({
  startPluginSandbox: async (_code: string, opts: SandboxOptions) => {
    const f: FakeSandbox = { opts, sent: [], events: [], stopped: null };
    fakes.push(f);
    return {
      get stopped() {
        return f.stopped;
      },
      send() {},
      call: async () => undefined,
      ping: async () => {},
      respond(id: number, res: PluginResponse, transfer?: Transferable[]) {
        if (!f.stopped) f.sent.push({ id, res, transfer });
      },
      emit(name: string, data: unknown) {
        if (!f.stopped) f.events.push({ name, data });
      },
      stop() {
        if (f.stopped) return;
        f.stopped = 'stopped';
        opts.onStop?.('stopped', '');
      },
    };
  },
}));

const { startPluginHost, PluginRefused, OUT_BYTES_PER_SECOND, LOG_MAX } = await import('../src/plugin/host');

async function open(requires: string[], extra: Partial<Parameters<typeof startPluginHost>[0]> = {}) {
  const view: ViewInfo = { year: 100, selected: null, visible: null, layer: 'polities' };
  const watchers = new Set<() => void>();
  const sink = { panel: vi.fn(), layer: vi.fn(), log: vi.fn(), failed: vi.fn() };
  const host = await startPluginHost({
    plugin: { id: 'test', requires },
    code: '',
    source: {
      world: () => world,
      civ: () => civ,
      edits: () => EMPTY_EDITS,
      title: () => '测试世界',
      chronicle: () => buildChronicle(civ),
      view: () => view,
      watchView: (fn) => (watchers.add(fn), () => watchers.delete(fn)),
    },
    sink,
    ...extra,
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
  const setView = (next: Partial<ViewInfo>) => {
    Object.assign(view, next);
    watchers.forEach((w) => w());
  };
  return { host, f, call, sink, setView, watchers };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('回调用', () => {
  it('清单要的能力不对就不开沙箱', async () => {
    const before = fakes.length;
    await expect(startPluginHost({ plugin: { id: 'x', requires: ['world.read@9'] }, code: '', source: { world: () => null, civ: () => null, edits: () => EMPTY_EDITS } })).rejects.toBeInstanceOf(PluginRefused);
    expect(fakes.length).toBe(before);
  });

  it('握手:host.info 报给了哪些能力;没要的能力一律拒,没有的调用回 unknown-call', async () => {
    const { call } = await open(['world.read@1', 'ui.panel@1']);
    expect(await call('host.info')).toEqual({ ok: true, data: { api: 1, app: '文明与地图', caps: ['world.read@1', 'ui.panel@1'], cells: world.mesh.n } });
    for (const name of Object.keys(PLUGIN_METHODS)) {
      const need = PLUGIN_METHODS[name];
      if (!need.length || need.some((c) => c === 'world.read@1' || c === 'ui.panel@1')) continue;
      expect(await call(name, {}), name).toMatchObject({ ok: false, error: { code: 'no-permission' } });
    }
    expect(await call('net.fetch', {})).toMatchObject({ ok: false, error: { code: 'unknown-call' } });
    expect(await call('toString')).toMatchObject({ ok: false, error: { code: 'unknown-call' } });
  });

  it('可选的能力只给用的人给了的', async () => {
    const { host } = await open(['world.read@1'], { plugin: { id: 't', requires: ['world.read@1'], optional: ['view.read@1', 'layer.cells@1'] }, grant: ['layer.cells@1'] });
    expect(host.caps).toEqual(['world.read@1', 'layer.cells@1']);
  });

  it('大数组转交(新做的一份),出错带 code', async () => {
    const { call, f } = await open(['world.read@1', 'history.read@1']);
    const r = await call('world.cells', { fields: ['elevation', 'biome'] });
    expect(r).toMatchObject({ ok: true });
    const sent = f.sent.at(-1)!;
    expect(sent.transfer).toHaveLength(2);
    expect(sent.transfer).not.toContain(world.elevation.buffer);
    expect(await call('world.cells', { fields: ['nope'] })).toMatchObject({ ok: false, error: { code: 'bad-args' } });
    expect(await call('world.cells', 'x')).toMatchObject({ ok: false, error: { code: 'bad-args' } });
    expect(await call('history.at', { year: 10, fields: ['polity'] })).toMatchObject({ ok: true });
    expect(await call('history.events', { from: 0, to: 300, limit: 5 })).toMatchObject({ ok: true, data: { items: expect.any(Array) } });
  });

  it('没打开世界、没有历史时回 unavailable;网站这边没接上改修改的也是', async () => {
    await startPluginHost({ plugin: { id: 'x', requires: ['world.read@1', 'history.read@1', 'author.write@1', 'store.world@1'] }, code: '', source: { world: () => null, civ: () => null, edits: () => EMPTY_EDITS } });
    const f = fakes.at(-1)!;
    f.opts.onRequest!(1, 'world.info', {});
    f.opts.onRequest!(2, 'history.span', {});
    f.opts.onRequest!(3, 'author.apply', {});
    f.opts.onRequest!(4, 'store.world.get', {});
    expect(f.sent.map((s) => (s.res.ok ? 'ok' : s.res.error.code))).toEqual(['unavailable', 'unavailable', 'unavailable', 'unavailable']);
  });

  it('取数太快回 busy', async () => {
    const { call } = await open(['world.read@1']);
    const fields = ['x', 'y', 'lon', 'lat', 'area', 'elevation', 'temperature', 'precipitation', 'flux', 'seaIce'];
    const per = world.mesh.n * 4 * fields.length;
    let busy = 0;
    for (let i = 0; i < Math.ceil(OUT_BYTES_PER_SECOND / per) + 2; i++) {
      const r = await call('world.cells', { fields });
      if (r && !r.ok && r.error.code === 'busy') busy++;
    }
    expect(busy).toBeGreaterThan(0);
  });

  it('面板、图层交给画的那一边;超过 4 个图层回 limit;停了全拿掉', async () => {
    const { host, call, sink } = await open(['ui.panel@1', 'layer.cells@1', 'layer.marks@1']);
    expect(await call('panel.set', { nodes: [{ type: 'button', id: 'go', label: '开始' }] })).toMatchObject({ ok: true });
    expect(sink.panel).toHaveBeenLastCalledWith([{ type: 'button', id: 'go', label: '开始' }]);
    expect(await call('panel.set', { nodes: [{ type: 'script' }] })).toMatchObject({ ok: false, error: { code: 'bad-args' } });
    const layer = (lid: string) => ({ id: lid, title: lid, values: new Float32Array(world.mesh.n), ramp: { colors: ['#000000', '#ffffff'] } });
    for (const lid of ['a', 'b', 'c', 'd']) expect(await call('layer.cells', layer(lid))).toMatchObject({ ok: true });
    expect(await call('layer.cells', layer('e'))).toMatchObject({ ok: false, error: { code: 'limit' } });
    expect(await call('layer.cells', layer('a'))).toMatchObject({ ok: true });
    expect(await call('layer.marks', { id: 'a', title: 'a', items: [] })).toMatchObject({ ok: false, error: { code: 'bad-args' } });
    expect(await call('layer.marks', { id: 'm', title: 'm', items: [{ kind: 'point', cells: [0] }] })).toMatchObject({ ok: true });
    expect(await call('layer.remove', { id: 'b' })).toMatchObject({ ok: true });
    expect(sink.layer).toHaveBeenLastCalledWith('b', null);
    sink.layer.mockClear();
    host.stop();
    expect(sink.panel).toHaveBeenLastCalledWith(null);
    expect(sink.layer.mock.calls.map((c) => c[0]).sort()).toEqual(['a', 'c', 'd', 'm']);
    expect(sink.layer.mock.calls.every((c) => c[1] === null)).toBe(true);
  });

  it('面板上的控件动了转给插件(值不合控件的不转);没要 ui.panel 收不到', async () => {
    const { host, call, f } = await open(['ui.panel@1']);
    await call('panel.set', { nodes: [{ type: 'slider', id: 's', label: 's', min: 0, max: 1, value: 0 }] });
    host.panelAction('s', 0.5);
    host.panelAction('s', 5);
    host.panelAction('x', 1);
    expect(f.events).toEqual([{ name: 'panel.action', data: { id: 's', value: 0.5 } }]);
  });

  it('看的年份、选中的东西变了发事件,合并着发,每种最快 250 毫秒一次;没要 view.read 不发', async () => {
    vi.useFakeTimers();
    const { f, setView } = await open(['view.read@1']);
    setView({ year: 101 });
    setView({ year: 102 });
    setView({ year: 103 });
    setView({ selected: { kind: 'polity', key: 'polity:c1#0' } });
    expect(f.events).toEqual([
      { name: 'view.year', data: { year: 101 } },
      { name: 'view.select', data: { kind: 'polity', key: 'polity:c1#0' } },
    ]);
    vi.advanceTimersByTime(300);
    expect(f.events.at(-1)).toEqual({ name: 'view.year', data: { year: 103 } });
    expect(f.events).toHaveLength(3);
    const other = await open(['world.read@1']);
    expect(other.watchers.size).toBe(0);
  });

  it('点选:网站这边不能点选 = unavailable;一次一个;取消;插件停了就收起', async () => {
    const none = await open(['input.pick@1']);
    expect(await none.call('pick.cell', {})).toMatchObject({ ok: false, error: { code: 'unavailable' } });
    let answer: (v: unknown) => void = () => {};
    let signal: AbortSignal | null = null;
    const { call, f, host } = await open(['input.pick@1'], {
      source: {
        world: () => world,
        civ: () => civ,
        edits: () => EMPTY_EDITS,
        pick: (_req, s) => ((signal = s), new Promise((r) => (answer = r as (v: unknown) => void))),
      },
    });
    const first = call('pick.cells', { max: 3, hint: '框一片' });
    expect(await call('pick.cell', {})).toMatchObject({ ok: false, error: { code: 'busy' } });
    answer({ cells: [1, 2] });
    expect(await first).toMatchObject({ ok: true, data: { cells: new Int32Array([1, 2]) } });
    const tooMany = call('pick.cells', { max: 1 });
    answer({ cells: [1, 2] });
    expect(await tooMany).toMatchObject({ ok: false, error: { code: 'limit' } });
    const cancelled = call('pick.box', {});
    answer(null);
    expect(await cancelled).toMatchObject({ ok: false, error: { code: 'cancelled' } });
    void call('pick.cell', {});
    host.stop();
    expect(signal!.aborted).toBe(true);
    expect(f.stopped).toBe('stopped');
  });

  it('log 交给开发者模式', async () => {
    const { call, sink } = await open([]);
    expect(await call('log', { text: 'hi\u0007' })).toMatchObject({ ok: true });
    expect(sink.log).toHaveBeenCalledWith('hi');
  });

  it('沙箱记的没接住的出错带 level: error;别的 level 不认', async () => {
    const { call, sink } = await open([]);
    await call('log', { text: 'Uncaught (in promise) Error: x', level: 'error' });
    expect(sink.log).toHaveBeenLastCalledWith('Uncaught (in promise) Error: x', 'error');
    await call('log', { text: 'y', level: 'shout' });
    expect(sink.log.mock.lastCall).toEqual(['y']);
  });

  it('没成的调用告诉开发者模式:哪个调用、出错码、说明', async () => {
    const { call, sink } = await open(['world.read@1']);
    await call('history.span');
    expect(sink.failed).toHaveBeenLastCalledWith('history.span', 'no-permission', expect.stringContaining('history.read@1'));
    await call('world.cells', { fields: ['nope'] });
    expect(sink.failed.mock.lastCall?.slice(0, 2)).toEqual(['world.cells', 'bad-args']);
    await call('nothing.here');
    expect(sink.failed.mock.lastCall?.slice(0, 2)).toEqual(['nothing.here', 'unknown-call']);
    sink.failed.mockClear();
    await call('world.info');
    expect(sink.failed).not.toHaveBeenCalled();
  });

  it('太长的日志只记前面,末尾说截掉了多少;不拆开两格的字', async () => {
    const { call, sink } = await open([]);
    await call('log', { text: 'x'.repeat(LOG_MAX) });
    expect(sink.log).toHaveBeenLastCalledWith('x'.repeat(LOG_MAX));
    await call('log', { text: 'x'.repeat(LOG_MAX + 500) });
    expect(sink.log).toHaveBeenLastCalledWith(`${'x'.repeat(LOG_MAX)}…(截掉了后面 500 个字)`);
    await call('log', { text: `${'x'.repeat(LOG_MAX - 1)}😀yz` });
    expect(sink.log).toHaveBeenLastCalledWith(`${'x'.repeat(LOG_MAX - 1)}…(截掉了后面 4 个字)`);
  });
});

// ---------------------------------------------------------------------------
// 改你写的东西、插件自己的数据

const { planChanges: planRaw, CHANGES_MAX } = await import('../src/plugin/edit');
const planChanges = (e: WorldEdits, h: Civ | null, raw: unknown) => planRaw(e, h, raw, world.params);
const { commitPluginEdits } = await import('../src/plugin/editsCommit');
const { getEdits, setEdits, setHistoryGate } = await import('../src/ui/editsStore');
const { undoLastEdit, redoLastEdit } = await import('../src/ui/undo');
const { checkStored, memoryStore, STORE_LOCAL_MAX } = await import('../src/plugin/store');
const { polityKey, regionKey, MARKS_MAX, MARK_REGIONS_MAX, MARK_TITLE_MAX, MARK_NOTE_MAX, NAME_MAX } = await import('../src/gen/edits');

describe('改你写的东西', () => {
  const pk = () => polityKey(civ, read.historyPolities(civ, { year: 600 })[0].id);

  it('改名、加标记、下干预一起算好;国名末尾的「国」去掉;同样的不算', () => {
    const key = pk();
    const rk = regionKey(civ, 3);
    const plan = planChanges(EMPTY_EDITS, civ, {
      changes: [
        { kind: 'name', key, name: '大燕国' },
        { kind: 'mark', mark: { title: '插件标的', color: 'blue', from: 0, regions: [rk] } },
        { kind: 'mark', mark: { title: '第二个', color: 'red', from: 10, at: [100, 200] } },
        { kind: 'intervention', v: { kind: 'protect', a: key, from: 100 } },
        { kind: 'intervention', v: { kind: 'protect', a: key, from: 100 } },
      ],
    });
    expect(plan.result).toEqual({ applied: 4, skipped: 1, marks: [1, 2] });
    expect(plan.next.names[key]).toBe('大燕');
    expect(plan.next.marks!.map((m) => m.title)).toEqual(['插件标的', '第二个']);
    expect(plan.next.interventions).toEqual([{ kind: 'protect', a: key, from: 100 }]);
    expect(plan.keys).toContain(key);
    expect(EMPTY_EDITS.names).toEqual({});
    const back = planChanges(plan.next, civ, { changes: [{ kind: 'name', key, name: null }, { kind: 'name', key: regionKey(civ, 1), name: null }] });
    expect(back.result).toEqual({ applied: 1, skipped: 1, marks: [] });
    expect(key in back.next.names).toBe(false);
  });

  it('插件下的干预就是作者自己下的:照大纲推演记的 plot、guide 不留', () => {
    const key = pk();
    const plan = planChanges(EMPTY_EDITS, civ, { changes: [{ kind: 'intervention', v: { kind: 'policy', a: key, from: 50, preset: 'peace', plot: 2, guide: true } }] });
    expect(plan.next.interventions).toEqual([{ kind: 'policy', a: key, from: 50, preset: 'peace' }]);
  });

  it('改了 AI 起的名字,那一笔 AI 记号去掉', () => {
    const key = pk();
    const e: WorldEdits = { ...EMPTY_EDITS, names: { [key]: '甲' }, aiNames: { [key]: { name: '甲' } } };
    expect(planChanges(e, civ, { changes: [{ kind: 'name', key, name: '乙' }] }).next.aiNames).toBeUndefined();
  });

  it('有一条不合格整批不改;没有历史时改名、下干预回 unavailable,标记照样能加', () => {
    const key = pk();
    const bad = (changes: unknown[], e: WorldEdits = EMPTY_EDITS, h: Civ | null = civ) => codeOf(() => planChanges(e, h, { changes }));
    expect(bad([{ kind: 'name', key, name: '甲' }, { kind: 'name', key: 'polity:c999999#0', name: '乙' }])).toBe('bad-args');
    expect(bad([{ kind: 'name', key, name: 5 }])).toBe('bad-args');
    expect(bad([{ kind: 'mark', mark: { title: 'x', color: 'red', from: 0 } }])).toBe('bad-args');
    expect(bad([{ kind: 'intervention', v: { kind: 'protect', a: 'nope', from: 1 } }])).toBe('bad-args');
    expect(bad([{ kind: 'rewrite-history' }])).toBe('bad-args');
    expect(bad(Array(CHANGES_MAX + 1).fill({ kind: 'name', key, name: '甲' }))).toBe('limit');
    const huge = Array(400_000).fill(regionKey(civ, 1));
    const t0 = performance.now();
    expect(bad(Array(CHANGES_MAX).fill({ kind: 'mark', mark: { title: 'x', color: 'red', from: 0, regions: huge } }))).toBe('limit');
    expect(performance.now() - t0).toBeLessThan(200);
    const full: WorldEdits = { ...EMPTY_EDITS, marks: Array.from({ length: MARKS_MAX }, (_, i) => ({ id: i + 1, title: 't', color: 'red' as const, from: 0, at: [1, 1] as [number, number] })) };
    expect(bad([{ kind: 'mark', mark: { title: 'x', color: 'red', from: 0, at: [1, 1] } }], full)).toBe('limit');
    expect(bad([{ kind: 'name', key, name: '甲' }], EMPTY_EDITS, null)).toBe('unavailable');
    expect(bad([{ kind: 'intervention', v: { kind: 'protect', a: key, from: 1 } }], EMPTY_EDITS, null)).toBe('unavailable');
    expect(planChanges(EMPTY_EDITS, null, { changes: [{ kind: 'mark', mark: { title: 'x', color: 'red', from: 0, at: [1, 1] } }] }).result.applied).toBe(1);
  });

  it('标记、改名不合规回 bad-args、超上限回 limit,不替插件改', () => {
    const key = pk();
    const mark = (m: Record<string, unknown>) => ({ kind: 'mark', mark: { title: 'x', color: 'red', from: 0, at: [1, 1], ...m } });
    const code = (...changes: unknown[]) => codeOf(() => planChanges(EMPTY_EDITS, civ, { changes: [{ kind: 'name', key, name: '甲' }, ...changes] }));
    const ok = (...changes: unknown[]) => planChanges(EMPTY_EDITS, civ, { changes });
    expect(code(mark({ color: 'pink' }))).toBe('bad-args');
    expect(code(mark({ color: undefined }))).toBe('bad-args');
    expect(code(mark({ color: 'black' }))).toBe('bad-args');
    expect(code(mark({ size: 'm' }))).toBe('bad-args');
    expect(code(mark({ title: 5 }))).toBe('bad-args');
    expect(code(mark({ title: '字'.repeat(MARK_TITLE_MAX + 1) }))).toBe('limit');
    expect(code(mark({ note: '字'.repeat(MARK_NOTE_MAX + 1) }))).toBe('limit');
    expect(code(mark({ from: 1.5 }))).toBe('bad-args');
    expect(code(mark({ from: -1 }))).toBe('bad-args');
    expect(code(mark({ from: 10, to: 9 }))).toBe('bad-args');
    expect(code(mark({ at: [1, 2000] }))).toBe('bad-args');
    expect(code(mark({ at: undefined }))).toBe('bad-args');
    expect(code(mark({ regions: [regionKey(civ, 1)] }))).toBe('bad-args');
    expect(code(mark({ at: undefined, regions: [] }))).toBe('bad-args');
    expect(code(mark({ at: undefined, regions: [regionKey(civ, 1), 'region:乱写'] }))).toBe('bad-args');
    expect(code(mark({ at: undefined, regions: Array(MARK_REGIONS_MAX + 1).fill(regionKey(civ, 1)) }))).toBe('limit');
    expect(code({ kind: 'name', key, name: '字'.repeat(NAME_MAX + 1) })).toBe('limit');

    const m = ok(
      mark({ title: ` ${'字'.repeat(MARK_TITLE_MAX)} `, color: 'none', size: 'xl', from: 10, to: 10, at: [2049, 3] }),
      mark({ title: '', at: undefined, regions: [regionKey(civ, 1), regionKey(civ, 1), regionKey(civ, 2)] }),
    ).next.marks!;
    expect(m[0]).toEqual({ id: 1, title: '字'.repeat(MARK_TITLE_MAX), color: 'none', size: 'xl', from: 10, to: 10, at: [1, 3] });
    expect(m[1]).toEqual({ id: 2, title: '新标记', color: 'red', from: 0, regions: [regionKey(civ, 1), regionKey(civ, 2)] });
    const polity = read.historyPolities(civ, { year: 600 }).find((p) => !civ.polities[p.id].eastern)!;
    const pkey = polityKey(civ, polity.id);
    expect(ok({ kind: 'name', key: pkey, name: `${'安'.repeat(NAME_MAX)}王国` }).next.names[pkey]).toBe('安'.repeat(NAME_MAX));
    expect(ok({ kind: 'name', key, name: '' }).result).toEqual({ applied: 0, skipped: 1, marks: [] });
  });

  it('下命令不合规回 bad-args、国名超长回 limit,不替插件改;取 0、false 的、国名末尾的「国」照收;推演插件的记号去掉', () => {
    const key = pk();
    const other = polityKey(civ, read.historyPolities(civ, { year: 600 })[1].id);
    const rk = regionKey(civ, 3);
    const iv = (v: Record<string, unknown>) => ({ kind: 'intervention', v });
    const code = (v: Record<string, unknown>) => codeOf(() => planChanges(EMPTY_EDITS, civ, { changes: [{ kind: 'name', key, name: '甲' }, iv(v)] }));
    const ok = (v: Record<string, unknown>) => planChanges(EMPTY_EDITS, civ, { changes: [iv(v)] }).next.interventions[0];
    expect(code({ kind: 'found', region: rk, from: 10, name: '字'.repeat(NAME_MAX + 1) })).toBe('limit');
    expect(code({ kind: 'protect', a: key, from: 10.5 })).toBe('bad-args');
    expect(code({ kind: 'protect', a: key, from: 100, until: 100 })).toBe('bad-args');
    expect(code({ kind: 'protect', a: key, from: 100, extra: 1 })).toBe('bad-args');
    expect(code({ kind: 'destroy', a: key, from: 100, b: key })).toBe('bad-args');
    expect(code({ kind: 'disaster', type: 'famine', level: 1, from: 100, regions: [rk, rk] })).toBe('bad-args');
    expect(code({ kind: 'disaster', type: 'plague', level: 1, from: 100, city: 'settlement:c1#0', region: rk })).toBe('bad-args');
    expect(code({ kind: 'policy', a: key, from: 100, war: 60 })).toBe('bad-args');
    expect(code({ kind: 'treaty', a: key, ps: [other], from: 100, term: 600 })).toBe('bad-args');
    expect(code({ kind: 'boost', a: key, from: 100, mul: 5 })).toBe('bad-args');
    expect(ok({ kind: 'found', region: rk, from: 10, name: '秦国' })).toEqual({ kind: 'found', region: rk, from: 10, name: '秦' });
    expect(ok({ kind: 'policy', a: key, from: 100, war: 0, expand: 20 })).toEqual({ kind: 'policy', a: key, from: 100, expand: 20 });
    expect(ok({ kind: 'cede', a: key, region: rk, from: 100, permanent: false })).toEqual({ kind: 'cede', a: key, region: rk, from: 100 });
    expect(ok({ from: 100, b: other, a: key, kind: 'ally', plugin: 'magic' })).toEqual({ kind: 'ally', a: key, b: other, from: 100 });
    expect(Object.keys(ok({ from: 100, b: other, a: key, kind: 'ally' }))).toEqual(['kind', 'a', 'b', 'from']);
  });

  it('下命令的类型和世界文件里的干预一致', () => {
    const toSite = (x: InterventionInfo): Intervention => x;
    const toPlugin = (x: Intervention): InterventionInfo => x;
    expect([toSite, toPlugin]).toHaveLength(2);
  });

  it('改完以后存档存不下的(超过存档文件的上限)整批不改', () => {
    const key = pk();
    const regions = Array.from({ length: 64 }, (_, i) => regionKey(civ, i));
    const many = Array.from({ length: 7000 }, (_, i) => ({ kind: 'disaster', type: 'famine', level: 2, from: i, regions }) as unknown as WorldEdits['interventions'][number]);
    const e: WorldEdits = { ...EMPTY_EDITS, interventions: many };
    expect(codeOf(() => planChanges(e, civ, { changes: Array.from({ length: 200 }, (_, i) => ({ kind: 'intervention', v: { kind: 'disaster', type: 'famine', level: 2, from: 9000 + i, regions } })) }))).toBe('limit');
    expect(planChanges(EMPTY_EDITS, civ, { changes: [{ kind: 'name', key, name: '甲' }] }).result.applied).toBe(1);
  });

  it('记进网站的修改:整批一步撤销、一步重做', () => {
    setEdits(EMPTY_EDITS);
    const key = pk();
    const plan = planChanges(getEdits(), civ, {
      changes: [
        { kind: 'name', key, name: '甲' },
        { kind: 'mark', mark: { title: 'm', color: 'red', from: 0, at: [5, 5] } },
      ],
    });
    expect(commitPluginEdits(plan.next, plan.keys)).toBeNull();
    expect(getEdits().names[key]).toBe('甲');
    expect(getEdits().marks).toHaveLength(1);
    expect(undoLastEdit()).toBe(true);
    expect(getEdits().names[key]).toBeUndefined();
    expect(getEdits().marks ?? []).toHaveLength(0);
    expect(redoLastEdit()).toBe(true);
    expect(getEdits().names[key]).toBe('甲');
    expect(getEdits().marks).toHaveLength(1);
    setEdits(EMPTY_EDITS);
  });

  it('照原样打开的旧世界:同一个插件这一次打开,改历史只问一次,之后直接回原因', () => {
    setEdits(EMPTY_EDITS);
    const key = pk();
    let askedTimes = 0;
    setHistoryGate(() => (askedTimes++, true));
    const asked = { history: false };
    const iv = (from: number) => planChanges(getEdits(), civ, { changes: [{ kind: 'intervention', v: { kind: 'protect', a: key, from } }] });
    expect(commitPluginEdits(iv(100).next, [key], asked)).toMatch(/另存/);
    expect(commitPluginEdits(iv(200).next, [key], asked)).toMatch(/另存/);
    expect(askedTimes).toBe(1);
    // 不改历史的(改名)照常记进去;另一个插件(另一份记号)还会问
    expect(commitPluginEdits(planChanges(getEdits(), civ, { changes: [{ kind: 'name', key, name: '甲' }] }).next, [key], asked)).toBeNull();
    expect(commitPluginEdits(iv(300).next, [key], { history: false })).toMatch(/另存/);
    expect(askedTimes).toBe(2);
    setHistoryGate(null);
    setEdits(EMPTY_EDITS);
  });

  it('不合格式的一批:回 bad-args / limit,同时交给网站说哪几处不对(一处都没改)', async () => {
    const key = pk();
    const commits: WorldEdits[] = [];
    const refused = vi.fn();
    const { call } = await open(['author.write@1'], {
      source: { world: () => world, civ: () => civ, edits: () => EMPTY_EDITS, commit: (next) => (commits.push(next), null) },
      sink: { refused },
    });
    const changes = [
      { kind: 'name', key, name: '甲' },
      { kind: 'name', key, name: '一二三四五六七八九十一二三四五六七' },
    ];
    expect(await call('author.apply', { changes })).toMatchObject({ ok: false, error: { code: 'limit' } });
    expect(commits).toHaveLength(0);
    expect(refused).toHaveBeenCalledTimes(1);
    expect(refused.mock.calls[0][0]).toEqual({ changes });
    expect(refused.mock.calls[0][1]).toMatchObject({ code: 'limit' });
    // 网站这时不让改(blocked)、太快(busy)不算格式不对
    expect(await call('author.apply', { changes: [] })).toMatchObject({ ok: true });
    expect(refused).toHaveBeenCalledTimes(1);
  });

  it('回调用:照办回结果;网站不让改回 blocked;网站没接上回 unavailable', async () => {
    const key = pk();
    const commits: WorldEdits[] = [];
    let refuse: string | null = null;
    const base = { world: () => world, civ: () => civ, edits: () => EMPTY_EDITS };
    const { call } = await open(['author.write@1'], { source: { ...base, commit: (next) => (commits.push(next), refuse) } });
    expect(await call('author.apply', { changes: [{ kind: 'name', key, name: '甲' }] })).toEqual({ ok: true, data: { applied: 1, skipped: 0, marks: [] } });
    expect(commits).toHaveLength(1);
    refuse = '照原样打开着';
    expect(await call('author.apply', { changes: [{ kind: 'name', key, name: '乙' }] })).toMatchObject({ ok: false, error: { code: 'blocked', text: '照原样打开着' } });
    expect(await call('author.apply', { changes: [{ kind: 'name', key: 'x', name: '乙' }] })).toMatchObject({ ok: false, error: { code: 'bad-args' } });
    expect(commits).toHaveLength(2);
    const none = await open(['author.write@1'], { source: base });
    expect(await none.call('author.apply', { changes: [] })).toMatchObject({ ok: false, error: { code: 'unavailable' } });
  });

  it('一秒最多提 10 次修改,多了回 busy', async () => {
    const { call } = await open(['author.write@1'], { source: { world: () => world, civ: () => civ, edits: () => EMPTY_EDITS, commit: () => null } });
    const codes: string[] = [];
    for (let i = 0; i < 12; i++) {
      const r = await call('author.apply', { changes: [] });
      codes.push(r && r.ok ? 'ok' : (r?.error.code ?? '?'));
    }
    expect(codes.filter((c) => c === 'ok')).toHaveLength(10);
    expect(codes.slice(10)).toEqual(['busy', 'busy']);
  });
});

describe('插件自己的数据', () => {
  it('只认数据:数、字、数组、普通对象、数值数组;大小、层数有上限', () => {
    expect(checkStored({ schema: 2, value: { a: [1, 'x', null, true], b: new Float32Array(3) } }, STORE_LOCAL_MAX)).toMatchObject({ schema: 2 });
    const code = (raw: unknown, max = STORE_LOCAL_MAX) => codeOf(() => checkStored(raw, max));
    expect(code({ schema: 0, value: 1 })).toBe('bad-args');
    expect(code({ schema: 1.5, value: 1 })).toBe('bad-args');
    expect(code({ schema: 1 })).toBe('bad-args');
    expect(code({ schema: 1, value: NaN })).toBe('bad-args');
    expect(code({ schema: 1, value: new Map() })).toBe('bad-args');
    expect(code({ schema: 1, value: new Date() })).toBe('bad-args');
    expect(code({ schema: 1, value: new BigInt64Array(2) })).toBe('bad-args');
    expect(code({ schema: 1, value: JSON.parse('{"__proto__": 1}') })).toBe('bad-args');
    const loop: unknown[] = [];
    loop.push(loop);
    expect(code({ schema: 1, value: loop })).toBe('bad-args');
    expect(code({ schema: 1, value: 'x'.repeat(STORE_LOCAL_MAX) })).toBe('limit');
    let deep: unknown = 1;
    for (let i = 0; i < 40; i++) deep = [deep];
    expect(code({ schema: 1, value: deep })).toBe('limit');
    const extra: unknown[] & { big?: string } = [1];
    extra.big = 'x';
    expect(code({ schema: 1, value: extra })).toBe('bad-args');
    expect(code({ schema: 1, value: [1, , 3] })).toBe('bad-args');
    const shared = { a: 1 };
    expect(code({ schema: 1, value: [shared, shared] })).toBe('no error');
    // 一层套一层、每层引用下一层两次:展开有 2^30 个,查过的不再查
    let dag: unknown = [1];
    for (let i = 0; i < 30; i++) dag = [dag, dag];
    const t0 = performance.now();
    expect(code({ schema: 1, value: dag })).toBe('no error');
    expect(performance.now() - t0).toBeLessThan(200);
  });

  it('存、取、删;世界的数据没开世界时回 unavailable;存到哪可以换成别的(异步的也行)', async () => {
    const { call } = await open(['store.local@1', 'store.world@1']);
    expect(await call('store.local.get')).toEqual({ ok: true, data: null });
    expect(await call('store.local.set', { schema: 1, value: { speed: 3 } })).toEqual({ ok: true, data: null });
    expect(await call('store.local.get')).toEqual({ ok: true, data: { schema: 1, value: { speed: 3 } } });
    expect(await call('store.world.set', { schema: 3, value: [1, 2] })).toMatchObject({ ok: true });
    expect(await call('store.world.set', { schema: 3, value: 'x'.repeat(600_000) })).toMatchObject({ ok: false, error: { code: 'limit' } });
    expect(await call('store.world.get')).toEqual({ ok: true, data: { schema: 3, value: [1, 2] } });
    // 同一个世界里再开一次,数据还在
    const again = await open(['store.world@1']);
    expect(await again.call('store.world.get')).toEqual({ ok: true, data: { schema: 3, value: [1, 2] } });
    expect(await again.call('store.world.clear')).toMatchObject({ ok: true });
    expect(await again.call('store.world.get')).toEqual({ ok: true, data: null });
    await startPluginHost({ plugin: { id: 'x', requires: ['store.world@1'] }, code: '', source: { world: () => null, civ: () => null, edits: () => EMPTY_EDITS } });
    const f = fakes.at(-1)!;
    f.opts.onRequest!(1, 'store.world.get', {});
    await new Promise((r) => setTimeout(r, 0));
    expect(f.sent[0].res).toMatchObject({ ok: false, error: { code: 'unavailable' } });
    const mem = memoryStore();
    const slow = { get: async (pid: string) => mem.get(pid), set: async (pid: string, d: Parameters<typeof mem.set>[1]) => mem.set(pid, d) };
    const custom = await open(['store.local@1'], { stores: { local: slow } });
    await custom.call('store.local.set', { schema: 1, value: 'v' });
    expect(mem.get('test')).toEqual({ schema: 1, value: 'v' });
  });
});
