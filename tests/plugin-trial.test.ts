import { describe, expect, it } from 'vitest';
import { DEFAULT_PARAMS, generateWorld } from '../src/gen/world';
import { generateCiv } from '../src/gen/civ';
import { historyAt, historyPolities, historySettlements } from '../src/plugin/read';
import { PluginApiError } from '../src/plugin/check';
import { EMPTY_EDITS } from '../src/gen/edits';
import { TRIAL_LINE_MAX, TRIAL_LOG_LINES, TrialRecorder, cellsInTrialBox, landFrom, trialLine, trialPicks, wrapSpan } from '../src/plugin/trial';

const world = generateWorld({ ...DEFAULT_PARAMS, seed: 7, cells: 3000 });
const civ = generateCiv(world, { endYear: 800 });
const year = civ.endYear;

/** 试跑的记录:钟由测试拨 */
function recorder() {
  let t = 1000;
  const rec = new TrialRecorder({ world, civ, year, now: () => t });
  return { rec, src: rec.source(), sink: rec.sink(), at: (ms: number) => void (t = ms) };
}
const flush = () => new Promise((r) => setTimeout(r, 0));

/** 那一年有人的城,人口从多到少 */
const townsBySize = () =>
  historySettlements(civ, { year })
    .filter((s) => (s.population ?? 0) > 0)
    .sort((a, b) => (b.population ?? 0) - (a.population ?? 0) || a.id - b.id);

describe('替插件点的:最大的城和同一块陆地上的另一座、最大的那一国', () => {
  it('东西相连时盖住几个 x 的最窄一段', () => {
    expect(wrapSpan([10, 50, 30], 100)).toEqual({ x0: 10, w: 40 });
    // 跨过东西接缝:从 90 盖到 110(= 10)
    expect(wrapSpan([95, 5, 90, 10], 100)).toEqual({ x0: 90, w: 20 });
    expect(wrapSpan([42], 100)).toEqual({ x0: 42, w: 0 });
  });

  it('走陆路连得到的地块:都是陆地,连着的陆地一块不漏;起点在水上就是空的', () => {
    const { water } = world;
    const { n, adjStart, adj } = world.mesh;
    const start = townsBySize()[0].cell;
    const on = landFrom(world, start);
    expect(on[start]).toBe(1);
    for (let i = 0; i < n; i++) {
      if (!on[i]) continue;
      expect(water[i]).toBe(0);
      for (let k = adjStart[i]; k < adjStart[i + 1]; k++) if (water[adj[k]] === 0) expect(on[adj[k]]).toBe(1);
    }
    expect(on.reduce((a, b) => a + b, 0)).toBeLessThan(n);
    const sea = water.findIndex((w) => w !== 0);
    expect(landFrom(world, sea).every((x) => x === 0)).toBe(true);
  });

  it('点一处:先给那一年人口最多的城,再给和它同一块陆地上人口最多的另一座', () => {
    const p = trialPicks(world, civ, year);
    const towns = townsBySize();
    const on = landFrom(world, towns[0].cell);
    const near = towns.slice(1).find((s) => on[s.cell] === 1)!;
    expect(near).toBeDefined();
    expect(p.sameLand).toBe(true);
    expect(p.cities).toEqual([towns[0], near].map((s) => ({ cell: s.cell, name: s.name })));
  });

  it('最大的城那块陆地上没有别的城:第二座退回第二大的城,说清楚隔着水', async () => {
    const towns = townsBySize();
    const water = world.water.slice();
    const c = towns[0].cell;
    for (let k = world.mesh.adjStart[c]; k < world.mesh.adjStart[c + 1]; k++) water[world.mesh.adj[k]] = 1;
    const island = { ...world, water };
    const p = trialPicks(island, civ, year);
    expect(p.sameLand).toBe(false);
    expect(p.cities).toEqual(towns.slice(0, 2).map((s) => ({ cell: s.cell, name: s.name })));
    const rec = new TrialRecorder({ world: island, civ, year, now: () => 0 });
    const signal = new AbortController().signal;
    await rec.source().pick!({ kind: 'cell', hint: '' }, signal);
    await rec.source().pick!({ kind: 'cell', hint: '' }, signal);
    expect(rec.did().picked).toBe(`${towns[0].name}、${towns[1].name}（最大的两座城：最大的城那块陆地上没有别的城，第二座隔着水）`);
  });

  it('框一片给的是地块最多的那一国的外接框:它的地块都在框里,框里的照网站框选那样列', () => {
    const p = trialPicks(world, civ, year);
    const own = historyAt(world, civ, { year, fields: ['polity'] }, (a) => a).polity!;
    const count = new Map<number, number>();
    for (const o of own) if (o >= 0) count.set(o, (count.get(o) ?? 0) + 1);
    const most = Math.max(...count.values());
    const b = p.box!;
    const id = historyPolities(civ, { year }).find((x) => x.name === b.name)!.id;
    expect(count.get(id)).toBe(most);
    const inBox = new Set(b.cells);
    for (let i = 0; i < own.length; i++) if (own[i] === id) expect(inBox.has(i)).toBe(true);
    expect(b.x0).toBeGreaterThanOrEqual(0);
    expect(b.x0).toBeLessThan(world.width);
    expect(b.x1).toBeGreaterThan(b.x0);
    expect(Array.from(cellsInTrialBox(world, b.x0, b.x1 - b.x0, b.y0, b.y1))).toEqual(Array.from(b.cells));
  });

  it('没长出文明:不点', () => {
    expect(trialPicks(world, null, 0)).toEqual({ cities: [], sameLand: false, box: null });
  });
});

describe('试跑时记下插件做了什么', () => {
  it('点一处:依次给两座城,再请就当不点了;框一片给一次;一次点好几块照网站说还不会', async () => {
    const { rec, src } = recorder();
    const [a, b] = rec.picks.cities;
    const signal = new AbortController().signal;
    expect(await src.pick!({ kind: 'cell', hint: '' }, signal)).toEqual({ cell: a.cell });
    expect(await src.pick!({ kind: 'cell', hint: '' }, signal)).toEqual({ cell: b.cell });
    expect(await src.pick!({ kind: 'cell', hint: '' }, signal)).toBeNull();
    const box = (await src.pick!({ kind: 'box', hint: '' }, signal)) as { cells: Int32Array };
    expect(Array.from(box.cells)).toEqual(Array.from(rec.picks.box!.cells));
    expect(await src.pick!({ kind: 'box', hint: '' }, signal)).toBeNull();
    await expect(src.pick!({ kind: 'cells', hint: '' }, signal)).rejects.toBeInstanceOf(PluginApiError);
    expect(rec.did().picked).toBe(`${a.name}、${b.name}（最大的城，和同一块陆地上最大的另一座）；框了「${rec.picks.box!.name}」那一片（最大的那一国）；之后又请点 2 次，当作不点了；要一次点好几块 1 次，网站这一版还不会`);
  });

  it('没请点、没画、没改、没发话', () => {
    const { rec } = recorder();
    expect(rec.did()).toEqual({ got: '没拿', picked: '没请点', drew: '没画', wrote: '没有', said: '没发话' });
  });

  it('编年史照这个世界现算(和打开世界看到的一样);没有笔记', () => {
    const { src } = recorder();
    expect(src.chronicle!()?.length).toBeGreaterThan(0);
    expect(src.notes!()).toEqual([]);
  });

  it('插件线程忙着算、没交东西:算完那一刻也算动静', () => {
    const { rec, at } = recorder();
    at(5000);
    rec.busyUntil(4200);
    expect(rec.last).toBe(4200);
    rec.busyUntil(3000);
    expect(rec.last).toBe(4200);
  });

  it('试跑的世界里没有你写的东西;要改的一律拦下,记几次、碰了哪些', () => {
    const { rec, src, sink } = recorder();
    expect(src.edits()).toBe(EMPTY_EDITS);
    expect(src.commit!(EMPTY_EDITS, ['polity:c1#0'])).toBeTruthy();
    expect(src.commit!(EMPTY_EDITS, ['polity:c1#0', 'mark:3'])).toBeTruthy();
    sink.refused!({}, new PluginApiError('bad-args', 'x'));
    expect(rec.did().wrote).toBe('想改 2 次，都拦下了（polity:c1#0、mark:3）；交来的修改不对 1 次');
  });

  it('拿了什么按地图、历史、你写的……分组,取地块数据写取了几种;改东西、画东西不算拿', () => {
    const { rec, sink } = recorder();
    sink.called!('world.info', {});
    sink.called!('world.cells', { fields: ['height', 'water', 'height'] });
    sink.called!('world.cells', { fields: ['biome'] });
    sink.called!('history.settlements', { year: 1 });
    sink.called!('author.names', {});
    sink.called!('author.apply', {});
    sink.called!('panel.set', {});
    sink.called!('view.get', {});
    sink.called!('store.local.get', {});
    sink.called!('store.local.set', {});
    expect(rec.did().got).toBe('地图 3 次（info、cells 2 种数）、历史 1 次（settlements）、你写的 1 次（names）、看的状态 1 次（get）、它存的数据 1 次（local.get）');
  });

  it('发话:调用和 post 都算,一秒最多几条', () => {
    const { rec, sink, at } = recorder();
    for (const t of [0, 100, 200, 900, 1500, 1600, 3000]) {
      at(t);
      if (t === 1500) rec.posted();
      else sink.called!('log', {});
    }
    expect(rec.did().said).toBe('7 条，一秒最多 4 条');
  });

  it('画了什么照最后留着的图层:地块图层涂了几块,标注按线、点、字、圈数', () => {
    const { rec, sink } = recorder();
    const values = new Float32Array(world.mesh.n).fill(NaN);
    values[0] = values[1] = 3;
    sink.layer!('a', { kind: 'cells', id: 'a', title: '离海多远', values });
    sink.layer!('r', { kind: 'marks', id: 'r', title: '路线', items: [{ kind: 'line', cells: Int32Array.from([1, 2]) }, { kind: 'label', cells: Int32Array.from([1]), text: '起点' }, { kind: 'label', cells: Int32Array.from([2]), text: '终点' }] });
    expect(rec.did().drew).toBe('地块图层「离海多远」涂了 2 块；1 条线、2 处字');
    expect(rec.cellLayer()?.id).toBe('a');
    expect(rec.markLayers().map((l) => l.id)).toEqual(['r']);
  });

  it('沙箱停下时先替插件拿掉的面板和图层不算(截图要停下前的);插件自己拿掉的照记', async () => {
    const { rec, sink } = recorder();
    const nodes = [{ type: 'text' as const, text: '请输入密码' }];
    sink.panel!(nodes);
    sink.layer!('r', { kind: 'marks', id: 'r', title: '路线', items: [] });
    sink.panel!(null);
    sink.layer!('r', null);
    rec.stopped('crashed', 'Uncaught Error: 故意出错');
    await flush();
    expect(rec.panel).toBe(nodes);
    expect(rec.layers.has('r')).toBe(true);
    expect(rec.error).toBe('它出错停下了：故意出错');

    const b = recorder();
    b.sink.panel!(nodes);
    b.sink.panel!(null);
    await flush();
    expect(b.rec.panel).toBeNull();
    b.sink.panel!(nodes);
    b.rec.freeze();
    b.sink.panel!(null);
    await flush();
    expect(b.rec.panel).toBe(nodes);
  });

  it('错:只记第一个;我们自己叫停的不算;没接住的 Promise 也算', () => {
    const { rec, sink } = recorder();
    rec.stopped('stopped', '');
    expect(rec.error).toBeNull();
    sink.log!('Unhandled: 拿不到', 'error');
    rec.stopped('unresponsive', 'ping took over 2000 ms');
    expect(rec.error).toBe('Unhandled: 拿不到');
    expect(rec.logLines()).toEqual(['出错：Unhandled: 拿不到']);
    const b = recorder();
    b.rec.stopped('flood', '');
    expect(b.rec.error).toMatch(/太多/);
  });

  it('日志:插件写的、调用没成的(用的人不点了、改你写的被拦下除外);最多 50 条、每条 300 字', () => {
    const { rec, sink } = recorder();
    sink.log!('起点终点用城名');
    sink.failed!('pick.cell', 'cancelled', '用的人取消了');
    sink.failed!('author.apply', 'blocked', '试跑的时候不改你写的东西');
    sink.failed!('history.people', 'no-permission', '清单里没要 history.read@1');
    sink.log!('长'.repeat(400));
    expect(rec.logLines()[0]).toBe('起点终点用城名');
    expect(rec.logLines()[1]).toBe('调用 history.people 没成（no-permission）：清单里没要 history.read@1');
    expect([...rec.logLines()[2]]).toHaveLength(TRIAL_LINE_MAX);
    for (let i = 0; i < 80; i++) sink.log!(`第 ${i} 条`);
    expect(rec.logLines()).toHaveLength(TRIAL_LOG_LINES);
    expect(trialLine('a\nb\u0007c')).toBe('a b c');
  });
});
