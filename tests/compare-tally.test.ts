/**
 * 并排试推下面那张表(src/ui/compare/tally.ts):
 * - 拼出来的一段小历史:各行到第 N 年为止的数(含当年、互嫁算一次、大国按到过 30 州、还在的算到第 N 年、亡了的算到亡国)
 * - 推出来的历史:现存 / 历来和世界概览一样数,仗、改朝、大崩解照史事数,最大的国和世界之最「疆域最大的国家」同一个数
 * - 一格里怎么写、「差多少」怎么写
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_PARAMS, generateWorld } from '../src/gen/world';
import { generateCiv } from '../src/gen/civ';
import { Layer, type Annal, type Civ, type Polity } from '../src/gen/civ/types';
import { polityAlive } from '../src/gen/civ/growth';
import { recordBook, recordsAt } from '../src/gen/civ/story/records';
import { BIG_REGIONS, TALLY_ROWS, diffText, tallyAt, tallyOf, tallyText } from '../src/ui/compare/tally';

/** 拼一段小历史:changes = [年份, 州, 新主人] */
function fake(polities: Partial<Polity>[], changes: [number, number, number][], annals: Partial<Annal>[], regions = 80): Civ {
  const n = changes.length;
  return {
    viable: true,
    regions: { count: regions },
    polities: polities.map((p, id) => ({ id, ...p })),
    annals: annals.map((a) => ({ a: -1, b: -1, region: -1, settlement: -1, war: -1, ...a })),
    log: {
      size: n,
      year: Float32Array.from(changes.map((c) => c[0])),
      region: Int32Array.from(changes.map((c) => c[1])),
      layer: Uint8Array.from(changes.map(() => Layer.Polity)),
      value: Int16Array.from(changes.map((c) => c[2])),
      cause: new Uint8Array(n),
    },
  } as unknown as Civ;
}

/** 国家 p 在 year 年拿下 k 个州(从 from 号州起) */
const take = (year: number, p: number, from: number, k: number): [number, number, number][] => Array.from({ length: k }, (_, i) => [year, from + i, p]);

describe('并排试推的表', () => {
  it('拼出来的小历史:各行到第 N 年为止', () => {
    const civ = fake(
      [
        { founded: 10, ended: 500 },
        { founded: 100 },
        { founded: 300, ended: 400 },
      ],
      [...take(20, 0, 0, BIG_REGIONS), ...take(150, 1, 30, 12), ...take(320.5, 2, 42, 5), ...take(410, 1, 0, BIG_REGIONS), ...take(410, 1, 50, 5)],
      [
        { year: 50, kind: 'war' },
        { year: 120, kind: 'war' },
        { year: 120, kind: 'dynasty' },
        { year: 200, kind: 'marry', a: 0, b: 1 },
        { year: 200, kind: 'marry', a: 1, b: 0 },
        { year: 260, kind: 'marry', a: 1, b: 0 },
        { year: 330, kind: 'collapse' },
      ],
    );
    const t = tallyOf(civ);
    expect(tallyOf(civ)).toBe(t);
    expect(tallyAt(t, 5)).toEqual({ alive: 0, founded: 0, wars: 0, dynasties: 0, collapses: 0, marriages: 0, biggest: 0, bigLife: null });
    // 到第 120 年为止:当年的也算
    expect(tallyAt(t, 120)).toMatchObject({ alive: 2, founded: 2, wars: 2, dynasties: 1, biggest: BIG_REGIONS, bigLife: 110 });
    // 互嫁算一次
    expect(tallyAt(t, 300).marriages).toBe(2);
    expect(tallyAt(t, 400)).toMatchObject({ alive: 2, founded: 3, collapses: 1 });
    // 第 410 年国家 1 从国家 0 手里拿下 30 州、另拿 5 州:最大的国 = 12 + 30 + 5;国家 1 到过 30 州,成了大国
    const y600 = tallyAt(t, 600);
    expect(y600.biggest).toBe(BIG_REGIONS + 5 + 12);
    // 国家 0:10–500 年 = 490 年;国家 1:100 年立国、还在,算到 600 = 500 年
    expect(y600.bigLife).toBe(495);
    expect(y600.alive).toBe(1);
  });

  it('推出来的历史:现存、历来和世界概览一样数,最大的国和世界之最一样', () => {
    const civ = generateCiv(generateWorld({ ...DEFAULT_PARAMS, cells: 12000, seed: 7 }), { endYear: 1500 });
    const t = tallyOf(civ);
    const book = recordBook(civ);
    for (const y of [0, 250, 600, 999, 1500]) {
      const r = tallyAt(t, y);
      expect(r.founded, `${y}`).toBe(civ.polities.filter((p) => p.founded <= y).length);
      expect(r.alive, `${y}`).toBe(civ.polities.filter((p) => p.founded <= y && polityAlive(p, y)).length);
      expect(r.wars, `${y}`).toBe(civ.annals.filter((a) => a.kind === 'war' && a.year <= y).length);
      expect(r.dynasties, `${y}`).toBe(civ.annals.filter((a) => a.kind === 'dynasty' && a.year <= y).length);
      expect(r.biggest, `${y}`).toBe(recordsAt(book, y).get('big')?.value ?? 0);
    }
    expect(tallyAt(t, 1500).wars).toBeGreaterThan(0);
  }, 60_000);

  it('一格里怎么写、差多少怎么写', () => {
    expect(TALLY_ROWS.map((r) => r.name)).toEqual(['现存国家', '历来立过的国家', '打过的仗', '改朝换代', '大崩解', '和亲', '最大的国', '大国平均活了多久']);
    expect(tallyText('alive', 13)).toBe('13');
    expect(tallyText('biggest', 56)).toBe('56 州');
    expect(tallyText('biggest', 0)).toBe('—');
    expect(tallyText('bigLife', 640)).toBe('640 年');
    expect(tallyText('bigLife', null)).toBe('—');

    expect(diffText('alive', 13, 9)).toBe('少 4 个');
    expect(diffText('founded', 31, 44)).toBe('多 13 个');
    expect(diffText('wars', 212, 451)).toBe('×2.1');
    expect(diffText('wars', 212, 318)).toBe('×1.5');
    expect(diffText('wars', 212, 300)).toBe('多 88 场');
    expect(diffText('wars', 300, 100)).toBe('少 200 场');
    expect(diffText('wars', 4, 40)).toBe('多 36 场');
    expect(diffText('wars', 10, 30)).toBe('×3');
    expect(diffText('collapses', 1, 3)).toBe('多 2 次');
    expect(diffText('marriages', 37, 0)).toBe('没有');
    expect(diffText('marriages', 0, 0)).toBe('一样');
    expect(diffText('dynasties', 18, 18)).toBe('一样');
    expect(diffText('biggest', 56, 88)).toBe('大 32 州');
    expect(diffText('biggest', 56, 40)).toBe('小 16 州');
    expect(diffText('biggest', 56, 0)).toBe('没有');
    expect(diffText('bigLife', 640, 410)).toBe('短 230 年');
    expect(diffText('bigLife', 400, 430)).toBe('长 30 年');
    expect(diffText('bigLife', 400, 400)).toBe('一样');
    expect(diffText('bigLife', 400, null)).toBe('没有');
    expect(diffText('bigLife', null, 300)).toBe('—');
  });
});
