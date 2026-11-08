/**
 * 测试里写的推演插件(gen/civ/engine/plugin.ts 的 SimPlugin,在推演线程里同步跑):tests/civ-plugins*.test.ts、tests/world-file-sim.test.ts 共用
 */
import type { PluginNote, SimPlugin } from '../../src/gen/civ/engine/plugin';
import type { SimRead } from '../../src/gen/civ/simRead';

export type Ledger = { acts: number; ticks: number; heard: number; hh: number; events: number; eh: number; magic: number; zeal: number; alive: number };

/** 每次出手时看到的:哪个插件、哪一刻、读口的年份、到这一刻为止官方记了几条史事、听到的最晚一条 */
export interface Seen {
  id: string;
  tick: boolean;
  year: number;
  readYear: number;
  annals: number;
  latestHeard: number;
  /** 接官方的输入表和读口此刻给的一样 */
  fresh: boolean;
}

const sameValues = (a: Float64Array, b: Float64Array) => a.length === b.length && a.every((x, i) => Object.is(x, b[i]));

/**
 * 记账的插件:每 every 年出手;听立国、灭亡、宣战;每次照频率出手时约一件自己的事,事到了的时候有三成再约一件;
 * 一张按州的表(读官方的乡村人口、往邻州扩散),一张按国的表(读官方的动荡、汇总本国的州),一张全世界的表(插件自己写)
 */
export function ledger(id = 'ledger', every = 20, seen?: Seen[]): SimPlugin<SimRead> {
  return {
    id,
    every,
    listen: ['found', 'fall', 'war'],
    tables: [
      { id: 'rural', name: '乡村人口', unit: 'region', input: true, min: 0, max: 1e9, off: 0 },
      { id: 'unrest', name: '动荡', unit: 'polity', input: true, min: 0, max: 10, off: 0 },
      { id: 'magic', name: '魔力', unit: 'region', every: 5, min: 0, max: 100, init: 10, off: 0, rate: '0.05 * (nbmean(nb.magic) - magic) + 0.002 * min(rural, 50) - 0.01 * magic' },
      { id: 'zeal', name: '热忱', unit: 'polity', every: 10, min: 0, max: 1, init: 0.5, off: 0, rate: '0.1 * (meanof(magic) / 100 + 0.01 * min(unrest, 1) - zeal)' },
      { id: 'tally', name: '记数', unit: 'world', input: true, min: 0, max: 1e9, off: 0 },
    ],
    inputs: { rural: 'rural', unrest: 'unrest' },
    act(turn) {
      const n = (turn.note as Ledger | undefined) ?? { acts: 0, ticks: 0, heard: 0, hh: 0, events: 0, eh: 0, magic: 0, zeal: 0, alive: 0 };
      n.acts++;
      if (turn.tick) n.ticks++;
      n.heard += turn.heard.length;
      for (const e of turn.heard) n.hh = (n.hh * 31 + e.year * 256 + e.a + 7 * e.b) % 1e9;
      n.events += turn.events.length;
      for (const e of turn.events) n.eh = (n.eh * 37 + e.year * 256 + e.kind * 1000 + e.data[0]) % 1e9;
      n.magic = Math.round(turn.table('magic').reduce((s, x) => s + x, 0) * 1000);
      n.zeal = Math.round(turn.table('zeal').reduce((s, x) => s + x, 0) * 1000);
      n.alive += turn.read.polities().filter((p) => p.ended === undefined).length;
      seen?.push({
        id,
        tick: turn.tick,
        year: turn.year,
        readYear: turn.read.year,
        annals: turn.read.annals(-Infinity).length,
        latestHeard: Math.max(-1, ...turn.heard.map((e) => e.year)),
        fresh: sameValues(turn.table('rural'), turn.read.official('rural')) && sameValues(turn.table('unrest'), turn.read.official('unrest')),
      });
      const at: { year: number; kind: number; data: number[] }[] = [];
      if (turn.tick) at.push({ year: turn.year + 0.5 + Math.floor(turn.rand(turn.year * 256, 1) * 400) / 32, kind: 1, data: [turn.year, n.acts] });
      for (const e of turn.events) if (e.kind === 1 && turn.rand(e.data[1], 2) < 0.3) at.push({ year: turn.year + 3 + 5 / 256, kind: 2, data: [e.data[0]] });
      return { note: n as unknown as PluginNote, at, tables: { tally: [n.acts + n.heard] } };
    },
  };
}

/** 不照频率出手、只靠自己约的事一件接一件的插件(间隔带小数);years 记下出手的时刻 */
export function chain(id = 'chain', years?: number[]): SimPlugin<SimRead> {
  return {
    id,
    act(turn) {
      years?.push(turn.year);
      const k = turn.events.length ? turn.events[0].data[0] + 1 : 0;
      const gap = 7 + Math.floor(turn.rand(k) * 60) / 16;
      const note = [k, turn.year, ...((turn.note as number[] | undefined) ?? []).slice(0, 6)];
      return { note, at: [{ year: turn.year + gap, kind: 9, data: [k] }] };
    },
  };
}

export const quiet = (every = 1): SimPlugin<SimRead> => ({ id: 'quiet', every, act: () => {} });

