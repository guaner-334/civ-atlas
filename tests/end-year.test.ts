/**
 * 推演年数(gen/edits.ts 文件头"推演年数"):清理、存档、推得更久的世界
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_PARAMS, generateWorld } from '../src/gen/world';
import { generateCiv } from '../src/gen/civ';
import { END_YEAR_DEFAULT, END_YEAR_MAX, cleanEndYear, endYearOf, type WorldEdits } from '../src/gen/edits';
import { editCount, editsLost, makeSave, parseSave, saveText } from '../src/gen/savefile';

describe('清理', () => {
  it('夹在 3000–60000、取整到千年;3000 = 不写', () => {
    expect(cleanEndYear(undefined)).toBeUndefined();
    expect(cleanEndYear('12000')).toBeUndefined();
    expect(cleanEndYear(Number.NaN)).toBeUndefined();
    expect(cleanEndYear(END_YEAR_DEFAULT)).toBeUndefined();
    expect(cleanEndYear(1000)).toBeUndefined();
    expect(cleanEndYear(12000)).toBe(12000);
    expect(cleanEndYear(12345)).toBe(12000);
    expect(cleanEndYear(99999)).toBe(END_YEAR_MAX);
    expect(endYearOf({})).toBe(3000);
    expect(endYearOf({ endYear: 60000 })).toBe(60000);
  });
});

describe('存档', () => {
  const base: WorldEdits = { names: {}, interventions: [], terrain: [] };

  it('原样存、原样读回;3000 年不写', () => {
    const back = parseSave(saveText(makeSave(DEFAULT_PARAMS, { ...base, endYear: 20000 }, 'abc')));
    expect(back.ok && back.save.edits.endYear).toBe(20000);
    expect(back.ok && back.warnings).toEqual([]);
    expect('endYear' in makeSave(DEFAULT_PARAMS, base, 'abc').edits).toBe(false);
    expect('endYear' in makeSave(DEFAULT_PARAMS, { ...base, endYear: 3000 }, 'abc').edits).toBe(false);
  });

  it('超出范围的夹回来;认不出的按 3000 年,提示一句', () => {
    const save = JSON.parse(saveText(makeSave(DEFAULT_PARAMS, base, 'abc')));
    save.edits.endYear = 1e9;
    let back = parseSave(JSON.stringify(save));
    expect(back.ok && back.save.edits.endYear).toBe(END_YEAR_MAX);
    save.edits.endYear = 'long';
    back = parseSave(JSON.stringify(save));
    expect(back.ok && back.save.edits.endYear).toBeUndefined();
    expect(back.ok && back.warnings.some((w) => w.includes('推演年数'))).toBe(true);
  });

  it('改了几处、打开别人的链接会丢掉的改动:推演年数算一处', () => {
    expect(editCount({ ...base, endYear: 10000 })).toBe(1);
    const a = makeSave(DEFAULT_PARAMS, { ...base, endYear: 10000 }, 'abc');
    const b = makeSave(DEFAULT_PARAMS, base, 'abc');
    expect(editsLost(a, b)).toBe(1);
    expect(editsLost(b, a)).toBe(0);
  });
});

describe('推得更久', () => {
  const world = generateWorld({ ...DEFAULT_PARAMS, seed: 7, cells: 12000 });
  const short = generateCiv(world);
  const long = generateCiv(world, { endYear: 9000 });

  it('推到给的年份;前 3000 年的州归属和推 3000 年的一样', () => {
    expect(short.endYear).toBe(3000);
    expect(long.endYear).toBe(9000);
    const at = (c: typeof short) => c.checkpoints.filter((k) => k.year <= 3000).map((k) => [...k.polity].join(','));
    expect(at(long)).toEqual(at(short));
    expect(long.polities.length).toBeGreaterThan(short.polities.length);
  });

  it('名字里不冒出数字、undefined', () => {
    const bad = (s: string | undefined) => !!s && /\d|undefined|NaN/.test(s);
    for (const p of long.polities) {
      expect(bad(p.name)).toBe(false);
      for (const d of p.dynasties ?? []) expect(bad(d.name)).toBe(false);
    }
    for (const x of long.people ?? []) {
      expect(bad(x.name)).toBe(false);
      expect(bad(x.title)).toBe(false);
    }
  });
});
