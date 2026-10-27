/**
 * 接着推和一口气推完一样(随机自查,scripts/lib/resumeFuzz.ts):
 * - 逐年推演一步随机推 1–60 年、每停一下随机下各种命令(宣战、结盟、迁都、划州、立国、不许扩张、不许灭、禁止分裂、即位),
 *   推到第 2000 年:和带着同样的命令一口气推完逐字段相等。这里跑 3 个种子,更多的种子在 scripts/stress.ts 里跑。
 *   这 3 个种子碰得上:同一刻撞上的两件事(两处看重建、看内政和看邦交、两国看邻国),
 *   立国干预在没人住的州当场建的城没几年就被毁、到了定居时预约的年份又建一座新城
 * - seed 37 的一个例子(种子 1–36 里没有这种立国):停在一次立国以前二三十年、接着推,那次立国照样有(立国的城早年当过别国的国都,
 *   那国亡了、那一州散回部落以后到了原定的年份立国;按条件现找;GENERATOR_VERSION 43 以前是种子 1 第 1700 年停下、第 1722 年那次)
 * - 带地形大事的世界:大事那一刻(推到前一刻、套上新地形接着推)也用同一套接法。随机几年各放一件不改海陆的大事,
 *   带着作者的干预和随机命令推完,日志、史事(大事那几条除外)、归属、检查点和没有大事时一样。
 *   种子 17、30 各放 15 件(比界面上的上限多,多停几次):大事那一刻还用旧接法时,这两个种子在第 1525、2067 年对不上
 */
import { describe, expect, it } from 'vitest';
import { generateCiv, type Civ } from '../src/gen/civ';
import { playCiv, playStop, playTurn } from '../src/gen/civ/play';
import type { Intervention, PlayState } from '../src/gen/edits';
import { fuzzResume, fuzzUpheavalResume, fuzzWorld } from '../scripts/lib/resumeFuzz';

/** 带地形大事的随机自查跑这几个[种子, 几件大事](更多的在 scripts/stress.ts 里跑) */
const UPHEAVAL_CASES: [number, number][] = [
  [3, 5],
  [6, 5],
  [7, 5],
  [17, 15],
  [30, 15],
];

/** 两份历史逐项一样 */
function same(a: Civ, b: Civ, label: string) {
  expect(Object.keys(a).sort(), label).toEqual(Object.keys(b).sort());
  for (const k of Object.keys(b) as (keyof Civ)[]) expect(a[k], `${label} ${k}`).toEqual(b[k]);
}

describe('接着推和一口气推完一样(随机自查)', () => {
  it.each([11, 28, 29])('seed %i:逐年推演随机推、随机下命令到第 2000 年,和一口气推完逐字段相等', (seed) => {
    const r = fuzzResume({ seed, to: 2000 });
    expect(r.diff, `seed ${seed}`).toBeNull();
    // 各种命令都下过
    expect(Object.keys(r.kinds).sort(), `seed ${seed}`).toEqual(['ally', 'boost', 'cede', 'crown', 'death', 'declare', 'destroy', 'disaster', 'found', 'halt', 'move', 'neutral', 'policy', 'protect', 'temper', 'treaty', 'unity']);
  }, 300_000);

  it.each(UPHEAVAL_CASES)('带地形大事 seed %i:随机 %i 个年份各发生一件不改海陆的大事,大事那一刻接着推和没有大事、一口气推完一样', (seed, count) => {
    const r = fuzzUpheavalResume(seed, count);
    expect(r.years.length, `seed ${seed}`).toBeGreaterThan(1);
    expect(r.diff, `seed ${seed} 大事在 ${r.years.join('、')} 年`).toBeNull();
  }, 300_000);

  it('seed 37:停在一次"早年当过别国国都的城照原定的年份立国"以前、接着推 50 年,和一口气推完一样', () => {
    const w = fuzzWorld(37);
    // 按条件现找(历史变了不用跟着改):一口气推完里第 1200 年以后的一次立国,立国的城以前当过别的国家的国都;停在它前面二三十年
    const full = generateCiv(w);
    const hit = full.annals.find((e) => e.kind === 'found' && e.year > 1200 && full.settlements[e.settlement]?.capitalSpans?.[0]?.polity !== e.a);
    expect(hit, '一口气推完里有这样一次立国').toBeDefined();
    const stop = Math.floor(hit!.year / 10) * 10 - 20;
    const play: PlayState = { year: stop, commands: [] };
    const civ = playCiv(w, {}, play);
    const cmds: Intervention[] = [];
    const r = playTurn(w, civ, {}, play, cmds, 50);
    expect(r.rejected).toEqual([]);
    const one = generateCiv(w, { interventions: r.play.commands, endYear: playStop(stop + 50) });
    const found = one.annals.filter((e) => e.kind === 'found' && e.year > stop && one.settlements[e.settlement]?.capitalSpans?.[0]?.polity !== e.a);
    expect(found.length).toBeGreaterThan(0);
    same(r.civ, one, `seed 37 第 ${stop} 年`);
  }, 120_000);
});
