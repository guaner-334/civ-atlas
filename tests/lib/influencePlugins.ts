/**
 * 测试里写的、往影响口交数的推演插件(在推演线程里同步跑):tests/civ-influence.test.ts 用
 */
import type { SimPlugin } from '../../src/gen/civ/engine/plugin';
import type { SimRead } from '../../src/gen/civ/simRead';

export type Point =
  | 'city.capacity'
  | 'rural.capacity'
  | 'unrest.add'
  | 'dev.rate'
  | 'assim.rate'
  | 'control.reach'
  | 'war.odds'
  | 'war.power'
  | 'split.odds'
  | 'dynasty.odds'
  | 'plague.odds'
  | 'plague.loss';

/** 交不影响的数(乘的 1、加的 0) */
export const NEUTRAL: Record<Point, number> = {
  'city.capacity': 1,
  'rural.capacity': 1,
  'unrest.add': 0,
  'dev.rate': 1,
  'assim.rate': 1,
  'control.reach': 1,
  'war.odds': 1,
  'war.power': 1,
  'split.odds': 1,
  'dynasty.odds': 1,
  'plague.odds': 1,
  'plague.loss': 1,
};

/** 每 every 年往一个按国的口交数:双号国 even 倍、单号国 odd 倍 */
export function parity(id: string, point: Point, even: number, odd: number, every = 20): SimPlugin<SimRead> {
  return {
    id,
    every,
    outputs: [point],
    act(turn) {
      const v = turn.output(point);
      for (let p = 0; p < v.length; p++) v[p] = p % 2 ? odd : even;
      return { outputs: { [point]: v } };
    },
  };
}

/** 每 every 年往给的几个口交同一个数(每格都一样) */
export function steady(id: string, vals: Partial<Record<Point, number>>, every = 20): SimPlugin<SimRead> {
  const outputs = Object.keys(vals) as Point[];
  return {
    id,
    every,
    outputs,
    act(turn) {
      const out: Record<string, Float64Array> = {};
      for (const k of outputs) out[k] = turn.output(k).fill(vals[k]!);
      return { outputs: out };
    },
  };
}

/**
 * 随时间、随地方变的:一张按州的「魔力」表(开头随机、往邻州扩散),每 20 年和自己约的事(带小数的时刻)到了时,
 * 照魔力、随机数往十二个口交数:魔力高的地方城大、乡村人多、发展快、同化快、起疫少,魔力低的动荡、疫病死得多;
 * 各国管得到的远近、宣战、国力、分裂、改朝换代随机
 */
export function sway(id = 'sway'): SimPlugin<SimRead> {
  return {
    id,
    every: 20,
    outputs: ['city.capacity', 'rural.capacity', 'unrest.add', 'dev.rate', 'assim.rate', 'control.reach', 'war.odds', 'war.power', 'split.odds', 'dynasty.odds', 'plague.odds', 'plague.loss'],
    tables: [{ id: 'magic', name: '魔力', unit: 'region', every: 5, min: 0, max: 100, init: '100 * rand()', off: 0, rate: '0.02 * (nbmean(nb.magic) - magic) + 0.002 * (50 - magic)' }],
    act(turn) {
      const m = turn.table('magic');
      const R = m.length;
      const city = turn.output('city.capacity');
      const rural = turn.output('rural.capacity');
      const unrest = turn.output('unrest.add');
      const dev = turn.output('dev.rate');
      const assim = turn.output('assim.rate');
      const reach = turn.output('control.reach');
      const plague = turn.output('plague.odds');
      const loss = turn.output('plague.loss');
      const byPolity = (['war.odds', 'war.power', 'split.odds', 'dynasty.odds'] as const).map((k) => turn.output(k));
      for (let r = 0; r < R; r++) {
        const x = Math.min(1, Math.max(0, m[r] / 100 + (turn.rand(r, turn.year * 256, 2) - 0.5) / 5));
        city[r] = 0.6 + 2 * x;
        rural[r] = 0.8 + x;
        unrest[r] = (0.5 - x) / 2;
        dev[r * 5] = 1 + x;
        dev[r * 5 + 2] = 1 + turn.rand(r, turn.year * 256) / 2;
        dev[r * 5 + 4] = 0.5 + x;
        assim[r] = 0.5 + 2.5 * x;
        plague[r] = 1.5 - x;
        loss[r] = 1.6 - x;
      }
      for (let p = 0; p < reach.length; p++) reach[p] = 0.7 + turn.rand(p, turn.year * 256, 1);
      byPolity.forEach((v, i) => {
        for (let p = 0; p < v.length; p++) v[p] = 0.6 + turn.rand(p, turn.year * 256, 3 + i);
      });
      const at = turn.tick ? [{ year: turn.year + 7 + 37 / 256, kind: 1 }] : [];
      const [odds, power, split, dynasty] = byPolity;
      return {
        outputs: {
          'city.capacity': city,
          'rural.capacity': rural,
          'unrest.add': unrest,
          'dev.rate': dev,
          'assim.rate': assim,
          'control.reach': reach,
          'war.odds': odds,
          'war.power': power,
          'split.odds': split,
          'dynasty.odds': dynasty,
          'plague.odds': plague,
          'plague.loss': loss,
        },
        at,
      };
    },
  };
}
