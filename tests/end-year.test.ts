/**
 * 推演年数(gen/edits.ts 文件头"推演年数"):清理、存档、推得更久的世界
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_PARAMS, generateWorld } from '../src/gen/world';
import { generateCiv } from '../src/gen/civ';
import { END_YEAR_DEFAULT, END_YEAR_MAX, cleanEndYear, endYearOf, extendedEndYear, type WorldEdits } from '../src/gen/edits';
import { editCount, editsLost, makeSave, parseSave, saveText } from '../src/gen/savefile';
import { clearEdits, getEdits, revertEdits, setEdits, setEndYear } from '../src/ui/editsStore';
import { playRate, replayStart, rulerOf } from '../src/ui/timelineLayout';

describe('清理', () => {
  it('取整到年、夹在 1–60000(不到 3000 年的是逐年推演存回来的);3000 = 不写;整千年和以前一样', () => {
    expect(cleanEndYear(undefined)).toBeUndefined();
    expect(cleanEndYear('12000')).toBeUndefined();
    expect(cleanEndYear(Number.NaN)).toBeUndefined();
    expect(cleanEndYear(END_YEAR_DEFAULT)).toBeUndefined();
    expect(cleanEndYear(1000)).toBe(1000);
    expect(cleanEndYear(2675)).toBe(2675);
    expect(cleanEndYear(0)).toBe(1);
    expect(cleanEndYear(-50)).toBe(1);
    expect(cleanEndYear(3000.4)).toBeUndefined();
    expect(cleanEndYear(3000.6)).toBe(3001);
    expect(cleanEndYear(3250)).toBe(3250);
    expect(cleanEndYear(3500)).toBe(3500);
    expect(cleanEndYear(12000)).toBe(12000);
    expect(cleanEndYear(12345)).toBe(12345);
    expect(cleanEndYear(99999)).toBe(END_YEAR_MAX);
    for (let y = 4000; y <= END_YEAR_MAX; y += 1000) expect(cleanEndYear(y)).toBe(y);
    expect(endYearOf({})).toBe(3000);
    expect(endYearOf({ endYear: 3500 })).toBe(3500);
    expect(endYearOf({ endYear: 60000 })).toBe(60000);
  });

  it('再推 N 年推到第几年:至少 1 年,到 60000 为止', () => {
    expect(extendedEndYear(3000, 500)).toBe(3500);
    expect(extendedEndYear(3500, 250.4)).toBe(3750);
    expect(extendedEndYear(3000, 0)).toBe(3001);
    expect(extendedEndYear(3000, -50)).toBe(3001);
    expect(extendedEndYear(59900, 1000)).toBe(END_YEAR_MAX);
    expect(extendedEndYear(END_YEAR_MAX, 100)).toBe(END_YEAR_MAX);
    expect(extendedEndYear(3000, Number.NaN)).toBe(3000);
    expect(extendedEndYear(2675, 100)).toBe(2775);
  });
});

describe('存档', () => {
  const base: WorldEdits = { names: {}, interventions: [], terrain: [] };

  it('原样存、原样读回;3000 年不写;不是整千年的也原样', () => {
    const back = parseSave(saveText(makeSave(DEFAULT_PARAMS, { ...base, endYear: 20000 }, 'abc')));
    expect(back.ok && back.save.edits.endYear).toBe(20000);
    expect(back.ok && back.warnings).toEqual([]);
    for (const y of [3250, 3500, 12345]) {
      const b = parseSave(saveText(makeSave(DEFAULT_PARAMS, { ...base, endYear: y }, 'abc')));
      expect(b.ok && b.save.edits.endYear, `${y}`).toBe(y);
      expect(b.ok && b.warnings, `${y}`).toEqual([]);
    }
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

describe('新建界面里的开关', () => {
  it('开了记年数,拖到 3000 年还开着(存档里不写),关了去掉', () => {
    clearEdits();
    setEndYear(10000);
    expect(getEdits().endYear).toBe(10000);
    setEndYear(3000);
    expect(getEdits().endYear).toBe(3000);
    expect(makeSave(DEFAULT_PARAMS, getEdits(), 'abc').edits.endYear).toBeUndefined();
    setEndYear(70000);
    expect(getEdits().endYear).toBe(END_YEAR_MAX);
    setEndYear(undefined);
    expect('endYear' in getEdits()).toBe(false);
    clearEdits();
  });

  it('撤销别的修改时推演年数照现在的留着', () => {
    const from: WorldEdits = { names: { a: '甲' }, interventions: [], terrain: [] };
    const to: WorldEdits = { names: {}, interventions: [], terrain: [] };
    setEdits({ ...from, endYear: 20000 });
    expect(revertEdits(getEdits(), from, to).endYear).toBe(20000);
    clearEdits();
  });
});

describe('时间轴', () => {
  it('3000 年的世界刻度、速度、自动播放和原来一样', () => {
    const r = rulerOf(3000);
    expect([r.minor, r.mid, r.major]).toEqual([100, 500, 1000]);
    expect(r.labels).toEqual([0, 1000, 2000, 3000]);
    expect([playRate(1, 3000), playRate(4, 3000)]).toEqual([20, 80]);
    expect(replayStart(3000)).toBe(2600);
  });

  it('60000 年:每 1000 年一小格、5000 年一中格、10000 年写字;1× 放完还是两分半', () => {
    const r = rulerOf(60000);
    expect([r.minor, r.mid, r.major]).toEqual([1000, 5000, 10000]);
    expect(r.labels).toEqual([0, 10000, 20000, 30000, 40000, 50000, 60000]);
    expect(60000 / playRate(1, 60000)).toBe(150);
    expect(replayStart(60000)).toBe(52000);
  });

  it('每种年数写的字不超过七个,最后一个总是结束年份,字和字不挤', () => {
    for (let end = 3000; end <= END_YEAR_MAX; end += 1000) {
      const { labels, major } = rulerOf(end);
      expect(labels.length, `${end}`).toBeLessThanOrEqual(7);
      expect(labels[0]).toBe(0);
      expect(labels[labels.length - 1]).toBe(end);
      for (let i = 1; i < labels.length; i++) expect(labels[i] - labels[i - 1], `${end}`).toBeGreaterThan(major / 2);
    }
  });
});
