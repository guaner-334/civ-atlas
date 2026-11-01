/**
 * 并排试推那几段历史在后台怎么推(src/ui/compare/compareClient.ts),线程换成假的:
 * - 两个线程:一段一个;一个线程:两段放在一条消息里
 * - 交来的推到哪年、历史、推不下去照段交出去;换过规则的那段,旧编号的消息不管
 * - 换一段的规则:只给它那个线程重发,同一个线程里的另一段编号不变(接着推);线程推完了就关,换规则时另开一个
 * - 线程坏了:它手上没推完的段当推不下去(停在最后报过的那年),推完的不算;dispose 以后全关、什么也不交
 */
import { describe, expect, it } from 'vitest';
import { CompareRun, type GrowThread } from '../src/ui/compare/compareClient';
import type { GrowReply, GrowRequest } from '../src/growThread';
import type { Civ } from '../src/gen/civ/types';

class FakeThread implements GrowThread {
  sent: GrowRequest[] = [];
  closed = false;
  onmessage: ((e: { data: GrowReply }) => void) | null = null;
  onerror: ((e: unknown) => void) | null = null;
  postMessage(m: GrowRequest) {
    this.sent.push(m);
  }
  terminate() {
    this.closed = true;
  }
  say(r: GrowReply) {
    this.onmessage?.({ data: r });
  }
  last() {
    return this.sent[this.sent.length - 1];
  }
}

const civ = (endYear: number) => ({ endYear }) as Civ;
const MAP = { params: { seed: 7 } as GrowRequest['map']['params'] };

function setup(threads: number) {
  const made: FakeThread[] = [];
  const log: string[] = [];
  const run = new CompareRun({
    map: MAP,
    setup: { civSeed: 3 },
    sides: [undefined, { values: { 'war.odds': 4 }, calc: 1 }],
    threads,
    spawn: () => {
      const t = new FakeThread();
      made.push(t);
      return t;
    },
    on: {
      progress: (s, y) => log.push(`p${s}:${y}`),
      civ: (s, c, done) => log.push(`c${s}:${c.endYear}${done ? '!' : ''}`),
      failed: (s, at, c, crashed) => log.push(`f${s}:${at}:${c ? c.endYear : '-'}${crashed ? ':crash' : ''}`),
    },
  });
  return { run, made, log };
}

describe('并排试推的后台', () => {
  it('两个线程一段一个;交来的照段交出去;推完的线程关掉', () => {
    const { made, log } = setup(2);
    expect(made.length).toBe(2);
    expect(made[0].last().sides.map((s) => s.side)).toEqual([0]);
    expect(made[1].last().sides.map((s) => s.side)).toEqual([1]);
    expect(made[1].last().sides[0].tuning).toEqual({ values: { 'war.odds': 4 }, calc: 1 });
    expect(made[0].last().setup).toEqual({ civSeed: 3 });
    const k0 = made[0].last().sides[0].key;
    const k1 = made[1].last().sides[0].key;
    made[0].say({ grow: 'progress', side: 0, key: k0, year: 150 });
    made[0].say({ grow: 'civ', side: 0, key: k0, civ: civ(300), done: false });
    made[1].say({ grow: 'failed', side: 1, key: k1, at: 820, civ: civ(819) });
    expect(made[1].closed).toBe(true);
    made[0].say({ grow: 'civ', side: 0, key: k0, civ: civ(3000), done: true });
    expect(made[0].closed).toBe(true);
    expect(log).toEqual(['p0:150', 'c0:300', 'f1:820:819', 'c0:3000!']);
  });

  it('一个线程:两段在一条消息里;换一段的规则只重发、另一段编号不变;旧编号的消息不管', () => {
    const { run, made, log } = setup(1);
    expect(made.length).toBe(1);
    const first = made[0].last();
    expect(first.sides.map((s) => s.side)).toEqual([0, 1]);
    const [k0, k1] = first.sides.map((s) => s.key);
    run.restart(1, { values: { 'split.odds': 4 }, calc: 2 });
    expect(made.length).toBe(1);
    const second = made[0].last();
    expect(second.sides[0].key).toBe(k0);
    expect(second.sides[1].key).not.toBe(k1);
    expect(second.sides[1].tuning).toEqual({ values: { 'split.odds': 4 }, calc: 2 });
    made[0].say({ grow: 'civ', side: 1, key: k1, civ: civ(300), done: false });
    made[0].say({ grow: 'civ', side: 1, key: second.sides[1].key, civ: civ(300), done: false });
    expect(log).toEqual(['c1:300']);
    // 第 0 段推完了:之后换第 1 段的规则只发第 1 段
    made[0].say({ grow: 'civ', side: 0, key: k0, civ: civ(3000), done: true });
    expect(made[0].closed).toBe(false);
    run.restart(1, undefined);
    expect(made[0].last().sides.map((s) => s.side)).toEqual([1]);
    expect(made[0].last().sides[0].tuning).toBeUndefined();
  });

  it('推完关掉的线程,换规则时另开一个;线程坏了:没推完的段当推不下去,停在最后报过的那年', () => {
    const { run, made, log } = setup(2);
    const k1 = made[1].last().sides[0].key;
    made[1].say({ grow: 'civ', side: 1, key: k1, civ: civ(3000), done: true });
    expect(made[1].closed).toBe(true);
    run.restart(1, { values: { 'war.odds': 2 }, calc: 1 });
    expect(made.length).toBe(3);
    expect(made[2].last().sides.map((s) => s.side)).toEqual([1]);
    const k0 = made[0].last().sides[0].key;
    made[0].say({ grow: 'progress', side: 0, key: k0, year: 512 });
    made[0].onerror?.(new Error('内存不够'));
    expect(made[0].closed).toBe(true);
    expect(log).toEqual(['c1:3000!', 'p0:512', 'f0:512:-:crash']);
  });

  it('dispose:全关,之后什么也不交', () => {
    const { run, made, log } = setup(2);
    const k0 = made[0].last().sides[0].key;
    run.dispose();
    expect(made.every((t) => t.closed)).toBe(true);
    made[0].say({ grow: 'civ', side: 0, key: k0, civ: civ(300), done: false });
    run.restart(0, undefined);
    expect(made.length).toBe(2);
    expect(log).toEqual([]);
  });
});
