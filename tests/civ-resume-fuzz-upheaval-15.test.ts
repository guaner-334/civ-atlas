/**
 * 接着推和一口气推完一样(随机自查,scripts/lib/resumeFuzz.ts),带地形大事的世界(从 civ-resume-fuzz 分出来,好并行跑):
 * 大事那一刻(推到前一刻、套上新地形接着推)也用同一套接法。随机几年各放一件不改海陆的大事,
 * 带着作者的干预和随机命令推完,日志、史事(大事那几条除外)、归属、检查点和没有大事时一样。
 * 种子 17、30 各放 15 件(比界面上的上限多,多停几次):大事那一刻还用旧接法时,这两个种子在第 1525、2067 年对不上。
 * 各放 5 件的在 civ-resume-fuzz-upheaval
 */
import { describe, expect, it } from 'vitest';
import { fuzzUpheavalResume } from '../scripts/lib/resumeFuzz';

/** 带地形大事的随机自查跑这几个[种子, 几件大事](各放 5 件的在 civ-resume-fuzz-upheaval,更多的在 scripts/stress.ts 里跑) */
const UPHEAVAL_CASES: [number, number][] = [
  [17, 15],
  [30, 15],
];

describe('接着推和一口气推完一样(随机自查)', () => {
  it.each(UPHEAVAL_CASES)('带地形大事 seed %i:随机 %i 个年份各发生一件不改海陆的大事,大事那一刻接着推和没有大事、一口气推完一样', (seed, count) => {
    const r = fuzzUpheavalResume(seed, count);
    expect(r.years.length, `seed ${seed}`).toBeGreaterThan(1);
    expect(r.diff, `seed ${seed} 大事在 ${r.years.join('、')} 年`).toBeNull();
  }, 300_000);
});
