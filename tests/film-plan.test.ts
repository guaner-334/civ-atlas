/**
 * 回放视频的纯计算(src/ui/filmPlan.ts):年份范围、每一帧放到哪一年、字幕排在哪几秒、竖屏下面那一栏、文字和文件名。
 * 手工造的大事测规则;再用真实世界(seed 7)核对:字幕不重叠、都在中间那一段里、没打完的战争只写开头。
 */
import { describe, expect, it } from 'vitest';
import type { ChronicleEntry } from '../src/gen/civ/chronicle';
import { filterChronicle } from '../src/gen/civ/chronicle';
import { fullChronicle } from '../src/gen/civ/religionText';
import { generateCiv } from '../src/gen/civ';
import { DEFAULT_PARAMS, generateWorld } from '../src/gen/world';
import {
  CAPTION_HOLD,
  FILM_FPS,
  FILM_INTRO,
  FILM_OUTRO,
  captionAt,
  captionSlots,
  clampRange,
  cnPunct,
  filmClock,
  filmEvents,
  filmFileName,
  filmRanges,
  frameYear,
  lengthText,
  rangeText,
  rateText,
  recentRows,
  yearFrame,
} from '../src/ui/filmPlan';
import { wrapText } from '../src/render/film';

let nextId = 1;
function entry(kind: ChronicleEntry['kind'], year: number, text: string, more: Partial<ChronicleEntry> = {}): ChronicleEntry {
  return { id: nextId++, kind, year, end: year, text, tag: '立', importance: 3, polities: [0], regions: [], settlement: -1, ...more };
}

describe('年份范围', () => {
  it('有国家以后从最早立国那年起,全部历史从 0 起', () => {
    const r = filmRanges({ polities: [{ founded: 899.4 }, { founded: 1200 }] as never, endYear: 3000 });
    expect(r.polities).toEqual({ from: 899, to: 3000 });
    expect(r.all).toEqual({ from: 0, to: 3000 });
    expect(filmRanges({ polities: [], endYear: 3000 }).polities).toEqual({ from: 0, to: 3000 });
  });

  it('拖出来的范围取整、夹在里面、至少差一年', () => {
    expect(clampRange({ from: -20, to: 4000 }, 3000)).toEqual({ from: 0, to: 3000 });
    expect(clampRange({ from: 1500.4, to: 1500.2 }, 3000)).toEqual({ from: 1500, to: 1501 });
    expect(clampRange({ from: 3000, to: 3000 }, 3000)).toEqual({ from: 2999, to: 3000 });
  });
});

describe('时间', () => {
  const c = filmClock({ from: 899, to: 3000 }, 60, true);

  it('片头片尾算在时长里,中间匀速', () => {
    expect(c.frames).toBe(60 * FILM_FPS);
    expect(c.intro).toBe(FILM_INTRO * FILM_FPS);
    expect(c.outro).toBe(FILM_OUTRO * FILM_FPS);
    expect(c.rate).toBeCloseTo(2101 / (55 * 1), 5);
    expect(filmClock({ from: 0, to: 100 }, 30, false).intro).toBe(0);
  });

  it('片头停在第一年,片尾停在最后一年,中间一帧比一帧晚', () => {
    expect(frameYear(c, 0)).toBe(899);
    expect(frameYear(c, c.intro)).toBe(899);
    expect(frameYear(c, c.frames - 1)).toBe(3000);
    expect(frameYear(c, c.intro + c.play - 1)).toBe(3000);
    for (let f = c.intro + 1; f < c.intro + c.play; f++) expect(frameYear(c, f)).toBeGreaterThan(frameYear(c, f - 1));
  });

  it('某一年在第几帧:那一帧放到的年份不早于它,前一帧早于它', () => {
    for (const y of [899, 900, 1677, 2562.5, 3000]) {
      const f = yearFrame(c, y);
      expect(frameYear(c, f)).toBeGreaterThanOrEqual(y - 1e-6);
      if (f > c.intro) expect(frameYear(c, f - 1)).toBeLessThan(y);
    }
  });
});

describe('字幕', () => {
  const c = filmClock({ from: 1000, to: 2000 }, 30, true);

  it('一次一条、停两秒,撞了往后挪,挤不下的不放,分量重的先排', () => {
    const a = entry('found', 1500, '甲建国');
    const b = entry('dynasty', 1501, '乙改朝', { importance: 2 });
    const d = entry('war', 1502, '丙伐丁,得某州', { importance: 3 });
    const ev = filmEvents([a, b, d], { from: 1000, to: 2000 });
    const slots = captionSlots(ev, c);
    for (let i = 1; i < slots.length; i++) expect(slots[i].f0).toBeGreaterThanOrEqual(slots[i - 1].f1);
    for (const s of slots) expect(s.f1 - s.f0).toBeLessThanOrEqual(CAPTION_HOLD * FILM_FPS);
    // 三条挤在三年里(每秒约 40 年):只放得下一条,放分量最重的
    expect(slots.length).toBe(1);
    expect(['甲建国', '丙伐丁，得某州']).toContain(slots[0].text);
  });

  it('多年的战争出字幕时还没打完:写"起"和开头一句', () => {
    const w = entry('war', 1500, '丙伐丁,得某州', { end: 1530, head: '丙伐丁' });
    const [s] = captionSlots(filmEvents([w], { from: 1000, to: 2000 }), c);
    expect(s.label).toBe('第 1500 年起');
    expect(s.text).toBe('丙伐丁');
  });

  it('淡入淡出:第一帧不是全亮,中间全亮,停完就没有', () => {
    const [s] = captionSlots(filmEvents([entry('found', 1500, '甲建国')], { from: 1000, to: 2000 }), c);
    expect(captionAt([s], s.f0)!.alpha).toBeLessThan(1);
    expect(captionAt([s], s.f0 + 20)!.alpha).toBe(1);
    expect(captionAt([s], s.f1)).toBeNull();
  });

  it('竖屏一栏:新的在上;战争打完以前写"起",打完了写起止年份和全文', () => {
    const a = entry('found', 1200, '甲建国');
    const w = entry('war', 1500, '丙伐丁,得某州', { end: 1530, head: '丙伐丁' });
    const ev = filmEvents([a, w], { from: 1000, to: 2000 });
    const mid = recentRows(ev, c, yearFrame(c, 1510), 5);
    expect(mid.map((r) => r.label)).toEqual(['1500 起', '1200']);
    expect(mid[0].text).toBe('丙伐丁');
    const done = recentRows(ev, c, yearFrame(c, 1600), 5);
    expect(done[0].label).toBe('1500—1530');
    expect(done[0].text).toBe('丙伐丁，得某州');
    expect(recentRows(ev, c, yearFrame(c, 1600), 1)).toHaveLength(1);
  });
});

describe('文字', () => {
  it('中文标点、片长、速度、范围、文件名', () => {
    expect(cnPunct('甲伐乙,得某州(旧称丙);完')).toBe('甲伐乙，得某州（旧称丙）；完');
    expect(lengthText(30)).toBe('0:30');
    expect(lengthText(120)).toBe('2:00');
    expect(rateText(38.2, 3000)).toMatch(/^每秒约 38 年（屏幕上 1× 是每秒 \d+ 年）$/);
    expect(rangeText({ from: 899, to: 3000 })).toBe('第 899 年到第 3000 年');
    expect(filmFileName('文明与地图-九州大陆', { from: 899, to: 3000 }, 'land')).toBe('文明与地图-九州大陆-第899—3000年.mp4');
    expect(filmFileName('文明与地图-九州大陆', { from: 899, to: 3000 }, 'port')).toBe('文明与地图-九州大陆-第899—3000年-竖屏.mp4');
  });

  it('折行:中文按字断,数字不拆开,标点不放行首', () => {
    const measure = (s: string) => Array.from(s).length * 10;
    const lines = wrapText(measure, '大霄享国 365 年而亡，夜珩瑶起于流叶原', 60, Infinity);
    expect(lines.join('').replace(/\s/g, '')).toBe('大霄享国365年而亡，夜珩瑶起于流叶原');
    for (const l of lines) expect(l).not.toMatch(/^[，。]/);
    expect(lines.some((l) => /\b36$|^5\b/.test(l))).toBe(false);
    expect(wrapText(measure, '一二三四五六七八九十', 40, 2)[1].endsWith('…')).toBe(true);
  });
});

describe('真实世界(seed 7)', () => {
  const civ = generateCiv(generateWorld({ ...DEFAULT_PARAMS, seed: 7 }));
  const majors = filterChronicle(fullChronicle(civ), { major: true });
  const range = filmRanges(civ).polities;

  it('字幕不重叠、都在中间那一段里;战争的开头是全文的开头(不算国名后的来历)', () => {
    for (const seconds of [30, 60, 120]) {
      const c = filmClock(range, seconds, true);
      const ev = filmEvents(majors, range);
      const slots = captionSlots(ev, c);
      expect(slots.length).toBeGreaterThan(5);
      for (let i = 0; i < slots.length; i++) {
        expect(slots[i].f0).toBeGreaterThanOrEqual(c.intro);
        expect(slots[i].f1).toBeLessThanOrEqual(c.intro + c.play);
        if (i) expect(slots[i].f0).toBeGreaterThanOrEqual(slots[i - 1].f1);
      }
    }
    // 全文里国名后面会补上来历"(第 N 年立国)",开头那一句没有
    const bare = (s: string) => s.replace(/\([^)]*\)/g, '');
    for (const e of majors.filter((m) => m.kind === 'war' && m.head)) expect(bare(e.text).startsWith(bare(e.head!))).toBe(true);
  });
});
