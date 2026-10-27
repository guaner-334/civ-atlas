/**
 * 导播"放到哪了"(src/ui/directorStore.ts):按排期推进年份、到一段事上请地图飞、字幕换件;停下等着、接着放;
 * 停着时拖到别的年份收掉;走过的略过的进列表(新的在上、不重复);下一件、全部跳过;右边按钮的三种状态。
 * 用 seed 7 真实的编年史和排期(directorPlan.ts)。
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { generateCiv } from '../src/gen/civ';
import { fullChronicle } from '../src/gen/civ/religionText';
import { DEFAULT_PARAMS, generateWorld } from '../src/gen/world';
import { directorAt, directorPlan, directorYear, type DirectorPace } from '../src/ui/directorPlan';
import { getCivTime, pausePlayback, setCivTime } from '../src/ui/civView';
import { playRate } from '../src/ui/timelineLayout';
import {
  DIRECTOR_LINGER,
  clearDirectorList,
  directorAdvance,
  directorBegin,
  directorButton,
  directorNextItem,
  directorPeek,
  directorReset,
  directorSkipAll,
  directorStopped,
  directorTimeMoved,
  getDirector,
  getDirectorFly,
  setDirectorOn,
} from '../src/ui/directorStore';

const world = generateWorld({ ...DEFAULT_PARAMS, seed: 7 });
const civ = generateCiv(world);
const end = civ.endYear;
const entries = fullChronicle(civ);
const maker = (pace: DirectorPace) => (from: number) => directorPlan(world, civ, { from, to: end, entries, pace });
const AUTO: DirectorPace = { mode: 'auto' };
const FAST: DirectorPace = { mode: 'fixed', rate: playRate(4, end) };

/** 像 DirectorEngine 一样往前放 sec 秒(每步 dt,年份写回时间轴);返回最后的年份 */
function run(sec: number, dt = 1 / 60): number | null {
  let y: number | null = getCivTime().year;
  for (let t = 0; t < sec - 1e-9; t += dt) {
    y = directorAdvance(dt);
    if (y === null) {
      setCivTime({ year: null, playing: false });
      break;
    }
    setCivTime({ year: y });
  }
  return y;
}

/** 从 from 年起放(时间轴先停在那一年、按下播放) */
function start(from: number, pace: DirectorPace, key = 'k') {
  setCivTime({ year: from, playing: true, story: false, scrubbing: false });
  directorBegin(maker(pace), key, from);
}

beforeEach(() => {
  setCivTime({ year: null, playing: false, story: false, scrubbing: false, speed: 1 });
  setDirectorOn(false);
  setDirectorOn(true);
  directorReset();
});

describe('导播放到哪了', () => {
  it('年份按排期的时钟走;到一段事上请地图飞过去,字幕换成这一件,"后面还有几件"对', () => {
    const plan = maker(AUTO)(2650);
    expect(plan.segments.length).toBeGreaterThan(0);
    const seg = plan.segments[0];
    start(2650, AUTO);
    const fly0 = getDirectorFly()?.stamp ?? 0;
    const y = run(seg.items[0].at + 0.05);
    expect(y).not.toBeNull();
    expect(Math.abs((y as number) - directorYear(plan, seg.items[0].at + 0.05))).toBeLessThan(0.5);
    const d = getDirector();
    expect(d.shown?.cap.entry.id).toBe(seg.items[0].entry.id);
    expect(d.shown?.left).toBe(seg.items.length - 1);
    expect(d.shown?.peek).toBe(false);
    if (seg.shot) {
      expect(getDirectorFly()?.stamp).toBe(fly0 + 1);
      expect(getDirectorFly()?.focus).toEqual(seg.shot);
    }
  });

  it('停下:字幕还在就停在这件事上等着;接着放从停下那一刻接着,镜头再飞回来', () => {
    const plan = maker(AUTO)(2650);
    const seg = plan.segments[0];
    start(2650, AUTO);
    run(seg.items[0].at + 0.3);
    pausePlayback();
    directorStopped();
    expect(getDirector().held).toBe(true);
    expect(getDirector().shown?.cap.entry.id).toBe(seg.items[0].entry.id);
    const stamp = getDirectorFly()?.stamp ?? 0;
    const year = getCivTime().year as number;
    // 回到导播:同样的设置、同一年 → 接着这份排期放
    setCivTime({ playing: true });
    directorBegin(maker(AUTO), 'k', year);
    expect(getDirector().held).toBe(false);
    expect(getDirector().shown?.cap.entry.id).toBe(seg.items[0].entry.id);
    if (seg.shot) expect(getDirectorFly()?.stamp).toBe(stamp + 1);
    // 放完这一段(再加字幕多留的那一会儿)字幕收掉
    run(seg.hold + DIRECTOR_LINGER + 0.1);
    const at = directorAt(plan, seg.at + seg.hold + DIRECTOR_LINGER + 0.4);
    if (!at) expect(getDirector().shown).toBeNull();
  });

  it('停着的时候时间轴被拖到别的年份:字幕、略过的列表收掉;停下的同时跳了年份也一样', () => {
    start(2645, FAST);
    run(3);
    expect(getDirector().list.length).toBeGreaterThan(0);
    pausePlayback();
    directorStopped();
    expect(getDirector().shown).not.toBeNull();
    setCivTime({ year: 1200, scrubbing: true });
    directorTimeMoved(getCivTime());
    expect(getDirector().shown).toBeNull();
    expect(getDirector().held).toBe(false);
    expect(getDirector().list).toEqual([]);
    // 放着时点了一条纪事(停下 + 跳年份一起来)
    start(2645, FAST);
    run(1);
    setCivTime({ year: 1500, playing: false });
    directorStopped();
    expect(getDirector().shown).toBeNull();
    expect(getDirector().list).toEqual([]);
  });

  it('走过的略过的进列表:新的在上、不重复、都是排期里略过的、年份不晚于放到的那一年', () => {
    const plan = maker(FAST)(2645);
    start(2645, FAST);
    const y = run(4) as number;
    const list = getDirector().list;
    expect(list.length).toBeGreaterThan(2);
    const ids = list.map((s) => s.entry.id);
    expect(new Set(ids).size).toBe(ids.length);
    const skipped = new Set(plan.skipped.map((s) => s.entry.id));
    for (const s of list) {
      expect(skipped.has(s.entry.id)).toBe(true);
      expect(s.entry.year).toBeLessThanOrEqual(y);
    }
    for (let i = 1; i < list.length; i++) expect(list[i].entry.year).toBeLessThanOrEqual(list[i - 1].entry.year);
    // 换了设置(同一年重排):列表留着
    const n = list.length;
    directorBegin(maker(AUTO), 'k2', getCivTime().year as number);
    expect(getDirector().list.length).toBe(n);
    clearDirectorList();
    expect(getDirector().list).toEqual([]);
  });

  it('下一件跳到下一件 / 下一段;全部跳过收掉这一段的字幕', () => {
    const plan = maker(AUTO)(2600);
    expect(plan.segments.length).toBeGreaterThan(2);
    start(2600, AUTO);
    run(plan.segments[0].at + 0.7);
    const first = getDirector().shown?.cap.entry.id;
    directorNextItem();
    run(1 / 60);
    const seg0 = plan.segments[0];
    const want = seg0.items.length > 1 ? seg0.items[1] : plan.segments[1].items[0];
    expect(getDirector().shown?.cap.entry.id).toBe(want.entry.id);
    expect(getDirector().shown?.cap.entry.id).not.toBe(first);
    directorSkipAll();
    expect(getDirector().shown).toBeNull();
  });

  it('镜头还在飞时字幕不换成这一段的;一段里字幕只往后换(两件之间空着时留着刚放完的那件)', () => {
    for (const pace of [AUTO, FAST, { mode: 'fixed', rate: playRate(1, end) } as DirectorPace]) {
      const plan = maker(pace)(2400);
      start(2400, pace);
      const dt = 1 / 60;
      let t = 0;
      let seg = -1;
      let best = -1;
      for (let i = 0; i < 60 * 60; i++) {
        const y = directorAdvance(dt);
        if (y === null) break;
        setCivTime({ year: y });
        t += dt;
        const at = directorAt(plan, t);
        if (!at) continue;
        const s = plan.segments[at.seg];
        if (at.seg !== seg) [seg, best] = [at.seg, -1];
        const idx = s.items.findIndex((it) => it.entry.id === getDirector().shown?.cap.entry.id);
        if (t < s.items[0].at - 1e-3) expect(idx).toBe(-1);
        else if (t > s.items[0].at + 1e-3) {
          expect(idx).toBeGreaterThanOrEqual(best);
          best = idx;
        }
      }
      directorReset();
    }
  });

  it('点略过的一条:字幕换成它、停着等你、镜头飞过去', () => {
    start(2645, FAST);
    run(3);
    const s = getDirector().list[0];
    const stamp = getDirectorFly()?.stamp ?? 0;
    directorPeek(s);
    expect(getCivTime().playing).toBe(false);
    expect(getDirector().held).toBe(true);
    expect(getDirector().shown?.peek).toBe(true);
    expect(getDirector().shown?.cap.entry.id).toBe(s.entry.id);
    if (s.shot) expect(getDirectorFly()?.stamp).toBe(stamp + 1);
  });

  it('放到最后一年:时间轴停在结束年份,字幕收掉', () => {
    start(end - 30, AUTO);
    const y = run(120);
    expect(y).toBeNull();
    expect(getCivTime().year).toBeNull();
    expect(getDirector().shown).toBeNull();
  });

  it('右边的按钮:关着 = 打开;停着等你 = 回到导播(接着放);放着 = 关掉(字幕、列表都收掉)', () => {
    setDirectorOn(false);
    directorButton();
    expect(getDirector().on).toBe(true);
    start(2645, FAST);
    run(2);
    // 放到有字幕的那一刻再停(停下时字幕还在才"停着等你";历史变了以后第 2645 年起头两秒不一定正好有字幕)
    for (let i = 0; i < 600 && !getDirector().shown; i++) run(0.1);
    expect(getDirector().shown).not.toBeNull();
    pausePlayback();
    directorStopped();
    expect(getDirector().held).toBe(true);
    directorButton();
    expect(getDirector().held).toBe(false);
    expect(getCivTime().playing).toBe(true);
    directorButton();
    expect(getDirector().on).toBe(false);
    expect(getDirector().shown).toBeNull();
    expect(getDirector().list).toEqual([]);
  });
});
