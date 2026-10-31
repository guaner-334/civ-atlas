/**
 * 和后台线程打交道的那一层(ui/sim/simClient.ts):用假的线程(记下发来的请求,手动回消息)检查
 *   - 发请求:没有线程先开一个;带上线程回报过的扩张节拍(回放帧、地形大事预览不带);不回音的(tell)不开线程、不记账
 *   - 记账:算一件回音的手上的活少一件(进度、先交的地图、主图补丁这些不算);都回完了"在忙什么"清掉
 *   - 生成、读档时线程手上还有活:关掉旧线程另开一个,旧线程后来的消息不管;手上只有能半路放下的生成时不关
 *   - 不是现在这个世界的请求编号:记账照记,不交给回调;半路放下的回音不交给回调
 *   - 先交的几段历史拼回去以后才交给回调;回调是收到消息当场调的(不绕异步)
 *   - 试推演:交回来给等着的那一次(编号对不上世界也给);停下、线程被换掉、页面卸下都 reject
 *   - 线程出错:关掉,还没回音的活按先后重发给新线程;重发过又出错的那件不再发,交给 lost(试推演 reject)
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { splitCiv } from '../src/civParts';
import type { Civ } from '../src/gen/civ/types';
import { SimClient, type SimHandlers, type SimWorker } from '../src/ui/sim/simClient';
import type { TempoNote, WorkerRequest, WorkerResponse } from '../src/worker';

// 问题记录:只看调了几次、记了哪个线程的错
const diag = vi.hoisted(() => ({ beats: 0, errors: [] as string[] }));
vi.mock('../src/diag/watch', () => ({
  diagBeat: () => void diag.beats++,
  recordWorkerError: (e: ErrorEvent, which: string) => void diag.errors.push(`${which}:${e.message}`),
}));
beforeEach(() => {
  diag.beats = 0;
  diag.errors = [];
});

class FakeWorker implements SimWorker {
  sent: WorkerRequest[] = [];
  terminated = false;
  onmessage: ((e: MessageEvent<WorkerResponse>) => void) | null = null;
  onerror: ((e: ErrorEvent) => void) | null = null;
  postMessage(m: WorkerRequest) {
    this.sent.push(m);
  }
  terminate() {
    this.terminated = true;
  }
  /** 线程交回一条消息 */
  reply(m: WorkerResponse) {
    this.onmessage?.({ data: m } as MessageEvent<WorkerResponse>);
  }
}

/** 开好的假线程(按开的先后)、每种消息交到回调的记录(按收到的先后)、交给 lost 的活 */
function setup(id = 1) {
  const workers: FakeWorker[] = [];
  const got: WorkerResponse[] = [];
  const lost: WorkerRequest[] = [];
  const cur = { id };
  const on = new Proxy({} as SimHandlers, { get: () => (m: WorkerResponse) => got.push(m) });
  const sim = new SimClient({
    spawn: () => {
      const w = new FakeWorker();
      workers.push(w);
      return w;
    },
    currentId: () => cur.id,
    on,
    lost: (req) => void lost.push(req),
  });
  return { sim, workers, got, cur, lost };
}

/** 线程出错(onerror) */
const fail = (w: FakeWorker, message = 'boom') => w.onerror?.({ message } as ErrorEvent);

const PARAMS = { seed: 7 } as unknown as Extract<WorkerRequest, { type: 'generate' }>['params'];
const gen = (id: number, extra: Partial<Extract<WorkerRequest, { type: 'generate' }>> = {}): WorkerRequest => ({ type: 'generate', id, scale: 1, params: PARAMS, ...extra });
const resim = (id: number, seq = 1): WorkerRequest => ({ type: 'resim', id, seq, params: PARAMS, interventions: [] });
const fakeCiv = (n = 0) => ({ endYear: 3000, people: Array.from({ length: n }, (_, i) => ({ id: i })), annals: [], settlements: [], polities: [] }) as unknown as Civ;
const civMsg = (id: number, civ: Civ, extra: object = {}): WorkerResponse => ({ type: 'civ', id, seq: 1, civ, ms: 1, baseKey: 'k', ...extra }) as WorkerResponse;
const TEMPO = { seed: 7 } as unknown as TempoNote;

describe('后台线程客户端(SimClient)', () => {
  it('发请求:没有线程先开一个,记一件活;交回来以后少一件、"在忙什么"清掉', () => {
    const { sim, workers, got } = setup();
    expect(workers.length).toBe(0);
    sim.send(resim(1));
    expect(workers.length).toBe(1);
    expect(workers[0].sent.map((m) => m.type)).toEqual(['resim']);
    expect(sim.busy).toBe(1);
    expect(sim.label).toBe('推演历史');
    // 进度、先交的地图、主图补丁、原件不算回音
    workers[0].reply({ type: 'progress', id: 1, stage: '文明', pct: 0.5 });
    workers[0].reply({ type: 'eraPatch', id: 1, key: 'a', prev: 'b', patch: null });
    expect(sim.busy).toBe(1);
    expect(sim.label).toBe('推演历史');
    workers[0].reply(civMsg(1, fakeCiv()));
    expect(sim.busy).toBe(0);
    expect(sim.label).toBeNull();
    expect(got.map((m) => m.type)).toEqual(['progress', 'eraPatch', 'civ']);
    // 回音多了也不会记成负的
    workers[0].reply({ type: 'extendStopped', id: 1, xid: 1 });
    expect(sim.busy).toBe(0);
  });

  it('不回音的(tell):有线程就直接发,不记账;没有线程不开', () => {
    const { sim, workers } = setup();
    sim.tell({ type: 'release', id: 0 });
    expect(workers.length).toBe(0);
    sim.send(resim(1));
    sim.tell({ type: 'renames', id: 1, names: {} });
    expect(workers[0].sent.map((m) => m.type)).toEqual(['resim', 'renames']);
    expect(sim.busy).toBe(1);
  });

  it('线程回报过扩张节拍以后的请求带上它;回放帧、地形大事预览不带', () => {
    const { sim, workers } = setup();
    sim.send(resim(1));
    expect('tempo' in workers[0].sent[0]).toBe(false);
    workers[0].reply(civMsg(1, fakeCiv(), { tempo: TEMPO }));
    sim.send(resim(1, 2));
    sim.send({ type: 'history', id: 1, params: PARAMS });
    expect((workers[0].sent[1] as { tempo?: TempoNote }).tempo).toBe(TEMPO);
    expect('tempo' in workers[0].sent[2]).toBe(false);
  });

  it('生成、读档时线程手上还有活:关掉旧线程另开一个,旧线程后来的消息不管、不记账', () => {
    const { sim, workers, got, cur } = setup();
    sim.send(gen(1));
    sim.send(resim(1));
    cur.id = 2;
    sim.send(gen(2));
    expect(workers.length).toBe(2);
    expect(workers[0].terminated).toBe(true);
    expect(sim.busy).toBe(1);
    workers[0].reply(civMsg(1, fakeCiv()));
    expect(got).toEqual([]);
    expect(sim.busy).toBe(1);
    // 新线程的照常收
    workers[1].reply({ type: 'progress', id: 2, stage: '生成', pct: 0.1 });
    expect(got.map((m) => m.type)).toEqual(['progress']);
    // 回放帧这类不换世界的请求不关线程
    sim.send({ type: 'history', id: 2, params: PARAMS });
    expect(workers.length).toBe(2);
  });

  it('线程闲着、或手上只有能半路放下的生成(编辑地形不推历史)时,生成不关线程', () => {
    const { sim, workers } = setup();
    sim.send(gen(1));
    workers[0].reply({ type: 'aborted', id: 1 });
    sim.send(gen(2, { skipCiv: true }));
    sim.send(gen(3, { skipCiv: true }));
    expect(workers.length).toBe(1);
    expect(sim.busy).toBe(2);
    // 半路放下的那件回 aborted:记账、不再算能放下的
    workers[0].reply({ type: 'aborted', id: 2 });
    expect(sim.busy).toBe(1);
    // 手上剩下的那件(id 3)能放下:再来一笔生成照样不关
    sim.send(gen(4));
    expect(workers.length).toBe(1);
    // 这时手上有一件不能放下的(id 4):读档要关掉重开
    sim.send({ type: 'load', id: 5, scale: 1, parts: [], params: PARAMS });
    expect(workers.length).toBe(2);
    expect(workers[0].terminated).toBe(true);
  });

  it('请求编号不是现在这个世界的:记账照记,不交给回调;半路放下的回音也不交', () => {
    const { sim, workers, got, cur } = setup(1);
    sim.send(resim(1));
    sim.send(resim(1, 2));
    cur.id = 2;
    workers[0].reply(civMsg(1, fakeCiv()));
    workers[0].reply({ type: 'aborted', id: 2 });
    expect(got).toEqual([]);
    expect(sim.busy).toBe(0);
  });

  it('先交的几段历史拼回去以后才交给回调;回调是收到消息当场调的', () => {
    const { sim, workers, got } = setup();
    sim.send(resim(1));
    const civ = fakeCiv(25);
    const { parts, civ: rest } = splitCiv(civ, 4, { people: 10, annals: 10, settlements: 10 });
    expect(parts.length).toBe(3);
    for (const p of parts) workers[0].reply({ type: 'civPart', id: 1, ...p });
    // 几段不算回音,也不交给回调
    expect(sim.busy).toBe(1);
    expect(got).toEqual([]);
    workers[0].reply(civMsg(1, rest, { split: { key: 4, parts: parts.length } }));
    expect(got.length).toBe(1);
    expect((got[0] as { civ: Civ }).civ.people).toEqual(civ.people);
  });

  it('试推演:交回来给等着的那一次(世界编号对不上也给),不交给回调', async () => {
    const { sim, workers, got, cur } = setup();
    let civ: Civ | null = null;
    const tid = sim.trial(undefined, (c) => (civ = c), () => {})!;
    expect(tid).toBeGreaterThan(0);
    sim.send({ type: 'trial', id: 1, tid, params: PARAMS, interventions: [] });
    expect(sim.label).toBe('助手试推演');
    cur.id = 9;
    const c = fakeCiv();
    workers[0].reply({ type: 'trial', id: 1, tid, civ: c, ms: 1, tempo: TEMPO });
    expect(civ).toBe(c);
    expect(got).toEqual([]);
    expect(sim.busy).toBe(0);
    // 试推演回报的扩张节拍也记下
    sim.send(resim(9));
    expect((workers[0].sent[1] as { tempo?: TempoNote }).tempo).toBe(TEMPO);
  });

  it('试推演:停下 = reject「已停下」、交回来也不再给;已经停了的不登记;线程被换掉 = reject', () => {
    const { sim, workers } = setup();
    const errs: string[] = [];
    const ok: Civ[] = [];
    const ac = new AbortController();
    const tid = sim.trial(ac.signal, (c) => ok.push(c), (e) => errs.push(e.message))!;
    sim.send({ type: 'trial', id: 1, tid, params: PARAMS, interventions: [] });
    ac.abort();
    expect(errs).toEqual(['已停下']);
    workers[0].reply({ type: 'trial', id: 1, tid, civ: fakeCiv(), ms: 1 });
    expect(ok).toEqual([]);

    const done = new AbortController();
    done.abort();
    expect(sim.trial(done.signal, (c) => ok.push(c), (e) => errs.push(e.message))).toBeNull();
    expect(errs).toEqual(['已停下', '已停下']);

    const tid2 = sim.trial(undefined, (c) => ok.push(c), (e) => errs.push(e.message))!;
    expect(tid2).toBeGreaterThan(tid);
    sim.send({ type: 'trial', id: 1, tid: tid2, params: PARAMS, interventions: [] });
    sim.send(gen(2));
    expect(workers[0].terminated).toBe(true);
    expect(errs).toEqual(['已停下', '已停下', '世界换了,试推演作废']);
  });

  it('ensure(true):手上的活都不能放下时关掉重开;dispose 关掉线程,下次发请求另开', () => {
    const { sim, workers } = setup();
    sim.send({ type: 'extend', id: 1, xid: 1, to: 4000, params: PARAMS });
    expect(sim.busy).toBe(1);
    sim.ensure(true);
    expect(workers.length).toBe(2);
    expect(workers[0].terminated).toBe(true);
    expect(sim.busy).toBe(0);
    sim.dispose();
    expect(workers[1].terminated).toBe(true);
    sim.tell({ type: 'release', id: 0 });
    expect(workers.length).toBe(2);
    sim.send(resim(1));
    expect(workers.length).toBe(3);
  });

  it('"在忙什么":读档、逐年推演、再推、照大纲推演都有说法;关掉重开(叫停再推)时清掉', () => {
    const { sim } = setup();
    const labels: (string | null)[] = [];
    for (const req of [
      { type: 'load', id: 1, scale: 1, parts: [], params: PARAMS },
      { type: 'turn', id: 1, play: {}, commands: [], years: 1, params: PARAMS },
      { type: 'extend', id: 1, xid: 1, to: 4000, params: PARAMS },
      { type: 'outline', id: 1, oid: 1, plots: [], params: PARAMS },
    ] as unknown as WorkerRequest[]) {
      sim.send(req);
      labels.push(sim.label);
    }
    expect(labels).toEqual(['打开世界', '逐年推演', '再推', '照大纲推演']);
    sim.ensure(true);
    expect(sim.label).toBeNull();
  });

  it('线程出错:关掉,还没回音的活按先后重发给新线程(带上扩张节拍),旧线程后来的消息不管', () => {
    const { sim, workers, got, lost } = setup();
    sim.send(resim(1));
    workers[0].reply(civMsg(1, fakeCiv(), { tempo: TEMPO }));
    sim.send(resim(1, 2));
    sim.send({ type: 'extend', id: 1, xid: 1, to: 4000, params: PARAMS });
    fail(workers[0]);
    expect(diag.errors).toEqual(['生成世界的线程:boom']);
    expect(workers[0].terminated).toBe(true);
    expect(workers.length).toBe(2);
    expect(workers[1].sent.map((m) => m.type)).toEqual(['resim', 'extend']);
    expect((workers[1].sent[0] as { seq: number; tempo?: TempoNote }).seq).toBe(2);
    expect((workers[1].sent[0] as { tempo?: TempoNote }).tempo).toBe(TEMPO);
    expect(sim.busy).toBe(2);
    expect(sim.label).toBe('再推');
    expect(lost).toEqual([]);
    // 换下来的线程后来的消息不管
    workers[0].reply(civMsg(1, fakeCiv()));
    expect(got.length).toBe(1);
    expect(sim.busy).toBe(2);
    workers[1].reply(civMsg(1, fakeCiv(), { seq: 2 }));
    workers[1].reply({ type: 'extended', id: 1, xid: 1, civ: fakeCiv(), to: 4000, ms: 1, baseKey: 'k' });
    expect(got.map((m) => m.type)).toEqual(['civ', 'civ', 'extended']);
    expect(sim.busy).toBe(0);
    expect(sim.label).toBeNull();
    // 闲着时出错:关掉,下次发请求另开
    fail(workers[1]);
    expect(workers[1].terminated).toBe(true);
    expect(workers.length).toBe(2);
    sim.send(resim(1, 3));
    expect(workers.length).toBe(3);
  });

  it('线程出错:重发过的那件又出错就不再发,交给 lost(只交现在这个世界的),后面的照旧再发;试推演 reject', () => {
    const { sim, workers, lost, cur } = setup();
    sim.send(resim(1));
    sim.send({ type: 'turn', id: 1, play: {}, commands: [], years: 1, params: PARAMS } as unknown as WorkerRequest);
    fail(workers[0]);
    fail(workers[1]);
    // 正在做的那件(重推)重发过、又出错:交给 lost;逐年推演那件再发一次
    expect(lost.map((m) => m.type)).toEqual(['resim']);
    expect(workers[2].sent.map((m) => m.type)).toEqual(['turn']);
    fail(workers[2]);
    expect(lost.map((m) => m.type)).toEqual(['resim', 'turn']);
    expect(workers.length).toBe(3);
    expect(sim.busy).toBe(0);
    expect(sim.label).toBeNull();

    // 别的世界的活不交给 lost;试推演 reject
    const errs: string[] = [];
    const tid = sim.trial(undefined, () => {}, (e) => errs.push(e.message))!;
    sim.send({ type: 'trial', id: 1, tid, params: PARAMS, interventions: [] });
    sim.send(resim(1, 2));
    cur.id = 2;
    fail(workers[3]);
    fail(workers[4]);
    expect(errs).toEqual(['后台线程出错,试推演没算成']);
    expect(workers[5].sent.map((m) => m.type)).toEqual(['resim']);
    fail(workers[5]);
    expect(lost.map((m) => m.type)).toEqual(['resim', 'turn']);
  });

  it('页面卸下(dispose):排着的试推演 reject', () => {
    const { sim } = setup();
    const errs: string[] = [];
    const tid = sim.trial(undefined, () => {}, (e) => errs.push(e.message))!;
    sim.send({ type: 'trial', id: 1, tid, params: PARAMS, interventions: [] });
    sim.dispose();
    expect(errs).toEqual(['页面关了,试推演作废']);
    expect(sim.busy).toBe(0);
    expect(sim.label).toBeNull();
  });

  it('问题记录:发请求、活都回完了各写一次记号;只记现在这个线程出的错', () => {
    const { sim, workers } = setup();
    sim.send(gen(1));
    sim.send(resim(1));
    expect(diag.beats).toBe(2);
    workers[0].reply({ type: 'progress', id: 1, stage: '生成', pct: 0.1 });
    workers[0].reply({ type: 'aborted', id: 1 });
    expect(diag.beats).toBe(2);
    workers[0].reply(civMsg(1, fakeCiv()));
    expect(diag.beats).toBe(3);
    sim.send(resim(1, 2));
    sim.send(gen(2));
    expect(workers.length).toBe(2);
    workers[0].onerror?.({ message: 'old' } as ErrorEvent);
    workers[1].onerror?.({ message: 'new' } as ErrorEvent);
    expect(diag.errors).toEqual(['生成世界的线程:new']);
  });
});
