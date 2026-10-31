/**
 * 回放视频的纯计算(src/ui/filmPlan.ts、src/render/filmFrames.ts):年份范围、每一帧放到哪一年、字幕排在哪几秒、竖屏下面那一栏、文字和文件名。
 * 手工造的大事测规则;再用真实世界(seed 7)核对:字幕不重叠、都在中间那一段里、没打完的战争只写开头。
 */
import { describe, expect, it } from 'vitest';
import type { ChronicleEntry } from '../src/gen/civ/story/chronicle';
import { filterChronicle } from '../src/gen/civ/story/chronicle';
import { fullChronicle } from '../src/gen/civ/story/religionText';
import { generateCiv } from '../src/gen/civ';
import { DEFAULT_PARAMS, generateWorld } from '../src/gen/world';
import {
  CAPTION_HOLD,
  FILM_FPS,
  FILM_INTRO,
  FILM_OUTRO,
  captionSlots,
  clampRange,
  cnPunct,
  filmClock,
  filmEvents,
  filmFileName,
  filmMegabytes,
  filmRanges,
  lengthText,
  rangeText,
  rateText,
  FILM_PLOT_WEIGHT,
  OUTLINE_KEEP_WEIGHT,
  outlineEvents,
  outlineRange,
} from '../src/ui/filmPlan';
import { captionAt, frameYear, recentRows, yearFrame } from '../src/render/filmFrames';
import { wrapText } from '../src/render/film';
import type { Era } from '../src/gen/era';

/** 公元,第 0 年是公元前 1500 年(第 1500 年 = 公元元年) */
const ERA: Era = { name: '公元', epoch: 1500 };
import { setFilmSource, whenFilmReady, type FilmSource } from '../src/ui/filmSource';
import { regionKeep } from '../src/ui/filmRun';

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

  it('设了纪年:字幕、竖屏一栏的年份和正文里的"第 N 年"都照纪年写', () => {
    const a = entry('found', 1200, '甲建国(第 1100 年迁来)');
    const w = entry('war', 1500, '丙伐丁,得某州', { end: 1530, head: '丙伐丁' });
    const ev = filmEvents([a, w], { from: 1000, to: 2000 }, undefined, ERA);
    expect(ev[0].text).toBe('甲建国（公元前 400 年迁来）');
    const slots = captionSlots(ev, c, ERA);
    expect(slots.map((s) => s.label)).toEqual(['公元前 300 年', '公元元年起']);
    expect(recentRows(ev, c, yearFrame(c, 1510), 5, ERA).map((r) => r.label)).toEqual(['元年 起', '前 300']);
    expect(recentRows(ev, c, yearFrame(c, 1600), 5, ERA)[0].label).toBe('元年—31');
  });
});

describe('字幕按大纲', () => {
  it('每条情节一条字幕写作者写的那句,先排;对上情节的那件不另放,情节之间只留头等大事', () => {
    const big = entry('dynasty', 1200, '改朝');
    const mid = entry('rank', 1210, '升格', { tag: '升' });
    const hit = entry('dynasty', 1500, '对上情节的那件');
    const range = { from: 1000, to: 2000 };
    const evs = filmEvents([big, mid, hit], range);
    expect(evs.find((e) => e.id === big.id)!.weight).toBeGreaterThanOrEqual(OUTLINE_KEEP_WEIGHT);
    expect(evs.find((e) => e.id === mid.id)!.weight).toBeLessThan(OUTLINE_KEEP_WEIGHT);
    const out = outlineEvents(
      evs,
      [
        { id: 3, year: 1500.6, text: '大定挥师西进,奥利亚举国震动。', entry: hit, cell: -1 },
        { id: 4, year: 2500, text: '范围外的', entry: null, cell: -1 },
      ],
      range,
    );
    expect(out.map((e) => e.id)).toEqual([big.id, -2]);
    const p = out[1];
    expect(p).toMatchObject({ plot: true, year: 1500, end: 1500, ongoing: false, weight: FILM_PLOT_WEIGHT, text: '大定挥师西进，奥利亚举国震动。' });
    // 和一件大事撞在一起:情节先排,大事往后挪或不放
    const clock = filmClock(range, 60, true);
    const same = filmEvents([entry('dynasty', 1500, '同一年的大事')], range);
    const slots = captionSlots(outlineEvents(same, [{ id: 3, year: 1500, text: '情节', entry: null, cell: -1 }], range), clock);
    const ps = slots.find((x) => x.ev.plot)!;
    expect(slots.find((x) => !x.ev.plot)?.f0 ?? Infinity).toBeGreaterThan(ps.f0);
    expect(ps.f0).toBe(yearFrame(clock, 1500));
    expect(ps.label).toBe('第 1500 年');
    expect(ps.text).toBe('情节');
  });
  it('挨得很近的几条情节一条不丢:撞了往后挪到放得下', () => {
    const range = { from: 980, to: 1021 };
    const clock = filmClock(range, 30, true);
    const plots = [1000, 1001, 1002].map((year, i) => ({ id: i + 1, year, text: `第 ${i + 1} 条`, entry: null, cell: -1 }));
    const slots = captionSlots(outlineEvents([], plots, range), clock);
    expect(slots.map((x) => x.text)).toEqual(['第 1 条', '第 2 条', '第 3 条']);
    for (let i = 1; i < slots.length; i++) expect(slots[i].f0).toBeGreaterThanOrEqual(slots[i - 1].f1);
  });
  it('情节在这一段外面:对上它的那件照样放', () => {
    const range = { from: 999, to: 1002 };
    const w = entry('war', 1000, '打了五年', { end: 1005, importance: 3 });
    const evs = filmEvents([w], range).map((e) => ({ ...e, weight: OUTLINE_KEEP_WEIGHT }));
    const out = outlineEvents(evs, [{ id: 1, year: 1005, text: '讲和', entry: w, cell: -1 }], range);
    expect(out.map((e) => e.id)).toEqual([w.id]);
  });
  it('同一年的几条照大纲的先后放(不看情节编号)', () => {
    const range = { from: 980, to: 1021 };
    const plots = [5, 2, 9].map((id, i) => ({ id, year: 1000, text: `第 ${i + 1} 条`, entry: null, cell: -1 }));
    expect(outlineEvents([], plots, range).map((e) => e.text)).toEqual(['第 1 条', '第 2 条', '第 3 条']);
    const slots = captionSlots(outlineEvents([], plots, range), filmClock(range, 30, true));
    expect(slots.map((x) => x.text)).toEqual(['第 1 条', '第 2 条', '第 3 条']);
  });
  it('年份:第一条情节前 20 年到最后一条后 20 年,夹在世界的年份里', () => {
    expect(outlineRange([{ year: 1378 }, { year: 1940.5 }], 3000)).toEqual({ from: 1358, to: 1960 });
    expect(outlineRange([{ year: 5 }, { year: 2995 }], 3000)).toEqual({ from: 0, to: 3000 });
    expect(outlineRange([], 3000)).toBeNull();
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
    expect(rangeText({ from: 899, to: 3000 }, ERA)).toBe('公元前 601 年到公元 1501 年');
    expect(filmFileName('文明与地图-九州大陆', { from: 899, to: 3000 }, 'land', ERA)).toBe('文明与地图-九州大陆-公元前601年—公元1501年.mp4');
  });

  it('估的文件大小照实测(30 秒约 9 MB、1 分钟约 15 MB)', () => {
    expect(filmMegabytes(5_000_000, 30)).toBeGreaterThan(7);
    expect(filmMegabytes(5_000_000, 30)).toBeLessThan(11);
    expect(filmMegabytes(5_000_000, 60)).toBeGreaterThan(13);
    expect(filmMegabytes(5_000_000, 60)).toBeLessThan(19);
  });

  it('折行:中文按字断,数字不拆开,标点不放行首', () => {
    const measure = (s: string) => Array.from(s).length * 10;
    const lines = wrapText(measure, '大霄享国 365 年而亡，夜珩瑶起于流叶原', 60, Infinity);
    expect(lines.join('').replace(/\s/g, '')).toBe('大霄享国365年而亡，夜珩瑶起于流叶原');
    for (const l of lines) expect(l).not.toMatch(/^[，。]/);
    expect(lines.some((l) => /\b36$|^5\b/.test(l))).toBe(false);
    expect(wrapText(measure, '一二三四五六七八九十', 40, 2)[1].endsWith('…')).toBe(true);
  });

  it('折行:一截外文比一行还宽(很长的名字、网址)就按字拆,每行都放得下', () => {
    const measure = (s: string) => Array.from(s).length * 10;
    const long = 'Abcdefghijklmnopqrstuvwxyz0123456789';
    const lines = wrapText(measure, `九州${long}`, 60, Infinity);
    expect(lines.join('')).toBe(`九州${long}`);
    for (const l of lines) expect(measure(l)).toBeLessThanOrEqual(60);
    const one = wrapText(measure, long, 60, 1);
    expect(one).toHaveLength(1);
    expect(one[0].endsWith('…')).toBe(true);
    expect(measure(one[0])).toBeLessThanOrEqual(60);
  });
});

describe('真实世界(seed 7)', () => {
  const world = generateWorld({ ...DEFAULT_PARAMS, seed: 7 });
  const civ = generateCiv(world);
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

  it('拍框里一块:州有一块地在框里就算,治所在不在框里都一样', () => {
    const { of, seat } = civ.regions;
    const { x, y } = world.mesh;
    // 东西两边是接着的
    const dx = (a: number, b: number) => Math.min(Math.abs(a - b), world.width - Math.abs(a - b));
    // 框只框住某个州离治所最远的那块地附近,治所在框外
    let c0 = -1;
    let d0 = 0;
    for (let c = 0; c < of.length; c++) {
      if (of[c] < 0) continue;
      const d = Math.hypot(dx(x[c], x[seat[of[c]]]), y[c] - y[seat[of[c]]]);
      if (d > d0) [c0, d0] = [c, d];
    }
    const h = d0 / 4;
    const box = { x0: x[c0] - h, y0: y[c0] - h, x1: x[c0] + h, y1: y[c0] + h, k: 1, mapCss: 1, mp: null };
    const keep = regionKeep(civ, world, box);
    const i = of[c0];
    expect(keep(entry('fall', 1000, '框里', { polities: [], regions: [i] }))).toBe(true);
    const far = [...seat.keys()].find((j) => {
      for (let c = 0; c < of.length; c++) if (of[c] === j && dx(x[c], x[c0]) < 4 * h && Math.abs(y[c] - y[c0]) < 4 * h) return false;
      return true;
    })!;
    expect(keep(entry('fall', 1000, '框外', { polities: [], regions: [far] }))).toBe(false);
  });
});

describe('有地形大事的世界:等各段的主图铺好再导出', () => {
  it('还没铺好时一直等,换上铺好的那一份才往下走;已经铺好的不用等', async () => {
    const a = { full: null, at: () => null, ready: false } as unknown as FilmSource;
    const b = { ...a, ready: true } as FilmSource;
    setFilmSource(a);
    let got: FilmSource | null | 'pending' = 'pending';
    const p = whenFilmReady().then((s) => (got = s));
    await new Promise((r) => setTimeout(r, 10));
    expect(got).toBe('pending');
    setFilmSource({ ...a } as FilmSource);
    await new Promise((r) => setTimeout(r, 10));
    expect(got).toBe('pending');
    setFilmSource(b);
    await p;
    expect(got).toBe(b);
    expect(await whenFilmReady()).toBe(b);
    setFilmSource(null);
  });
});
