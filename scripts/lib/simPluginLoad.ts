/**
 * 压力测试用的推演插件:往插件能用的上限那头写的一个重插件(在推演线程里同步跑,量插件那一段本身要多花多少时间):
 * 每年出手一次,每次读全部的国家和城、按州算一遍、整张换掉自己的一张按州的表;两张公式表每年算(一张往邻州扩散),
 * 接官方的乡村人口、动荡;听几种史事,隔几年约一件自己的事。只读不改官方的东西,装了它官方历史一位不变
 */
import type { PluginNote, SimPlugin } from '../../src/gen/civ/engine/plugin';
import type { SimRead } from '../../src/gen/civ/simRead';

type Note = { acts: number; heard: number; alive: number; towns: number; heat: number };

export function loadPlugin(id = 'load'): SimPlugin<SimRead> {
  return {
    id,
    every: 1,
    listen: ['found', 'fall', 'war', 'split', 'plague'],
    tables: [
      { id: 'rural', name: '乡村人口', unit: 'region', input: true, min: 0, max: 1e9, off: 0 },
      { id: 'unrest', name: '动荡', unit: 'polity', input: true, min: 0, max: 10, off: 0 },
      { id: 'mana', name: '魔力', unit: 'region', every: 1, min: 0, max: 100, init: 10, off: 0, rate: '0.1 * (nbmean(nb.mana) - mana) + 0.002 * min(rural, 50) - 0.01 * mana' },
      { id: 'zeal', name: '热忱', unit: 'polity', every: 1, min: 0, max: 1, init: 0.5, off: 0, rate: '0.1 * (meanof(mana) / 100 + 0.01 * min(unrest, 1) - zeal)' },
      { id: 'heat', name: '热度', unit: 'region', input: true, min: 0, max: 1, off: 0 },
    ],
    inputs: { rural: 'rural', unrest: 'unrest' },
    act(turn) {
      const n = (turn.note as Note | undefined) ?? { acts: 0, heard: 0, alive: 0, towns: 0, heat: 0 };
      n.acts++;
      n.heard += turn.heard.length;
      const read = turn.read;
      n.alive = read.polities().filter((p) => p.ended === undefined).length;
      const pop = new Float64Array(read.regions().count);
      for (const s of read.settlements()) if (s.ended === undefined) pop[s.region] += s.population;
      n.towns = read.settlements().length;
      const mana = turn.table('mana');
      const rural = read.official('rural');
      const heat = new Float64Array(mana.length);
      let sum = 0;
      for (let r = 0; r < heat.length; r++) {
        heat[r] = Math.min(1, (mana[r] / 100) * (0.5 + Math.min(rural[r] + pop[r], 200) / 400) * (0.5 + turn.rand(r, Math.round(turn.year))));
        sum += heat[r];
      }
      n.heat = Math.round(sum * 1000);
      const at = turn.tick && turn.year % 7 === 0 ? [{ year: turn.year + 3.5, kind: 1, data: [turn.year] }] : [];
      return { note: n as unknown as PluginNote, tables: { heat }, at };
    },
  };
}
