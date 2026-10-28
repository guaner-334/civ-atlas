/**
 * 逐年推演一步能短到一个月、一格(ui/stepwisePlan.ts、ui/advanceText.ts、ui/stepTime.ts;推进设置见 gen/edits.ts 文件头"推进设置"):
 * - 推进设置多了单位(年 / 月 / 格)和"每一步都停";清理时按单位夹回范围
 * - 六档各走几格:一个月走到下个月初(按这个世界一年几个月),一季 64 格、半年 128 格,一年、五年和以前一样;自己填最短 1 格、最长 5 年
 * - 每隔几年从上一次停下的那一刻数(年中停下的,几年后同一个月停);每一步都停的每一步都停
 * - 一步一年时和以前一模一样(拿以前的算法逐个比)
 * - 选步长时那几句话、侧栏那一行、这一步没有大事时那一行
 * - 一个月一步走 12 步 = 一年一步走 1 步,推出来的历史逐项一样
 */
import { describe, expect, it } from 'vitest';
import { generateWorld, DEFAULT_PARAMS, type World } from '../src/gen/world';
import type { Civ } from '../src/gen/civ';
import { playCiv, playTicks, playTurn } from '../src/gen/civ/play';
import { ADVANCE_DEFAULT, END_YEAR_MAX, YEAR_TICKS, advanceOf, cleanAdvance, playAt, polityKey, type Advance, type Intervention, type PlayState } from '../src/gen/edits';
import { monthOf } from '../src/gen/era';
import { EMPTY_STOP_SECS, monthStart, nextStep, pauseYear, redrawAt, stepEnd, stepMarks, type StepPlan } from '../src/ui/stepwisePlan';
import { STEP_PICKS, advanceBrief, aboutTime, everyWhy, ownStep, stepLabel, stepPickOf, stepUnitMax, stepWhy, type Run } from '../src/ui/advanceText';
import { oneMonth, spanShort, spanText } from '../src/ui/stepTime';

const adv = (a: Partial<Advance> = {}): Advance => ({ ...ADVANCE_DEFAULT, ...a });
const MONTH = adv({ step: 1, unit: 'month' });
const text = (r: Run[]) => r.map((x) => x.t).join('');
const N12 = ['端月', '杏月', '桃月', '槐月', '蒲月', '荷月', '兰月', '桂月', '菊月', '阳月', '葭月', '冰月'];
/** 第 y 年第 k 格 */
const at = (y: number, k = 0) => y + k / YEAR_TICKS;

describe('推进设置:单位和每一步都停', () => {
  it('清理:单位只认 month / tick;按单位夹回范围;一年一步不写', () => {
    expect(cleanAdvance({ step: 1, unit: 'month' })).toEqual({ step: 1, unit: 'month' });
    expect(cleanAdvance({ step: 64, unit: 'tick' })).toEqual({ step: 64, unit: 'tick' });
    expect(cleanAdvance({ step: 9999, unit: 'tick' })).toEqual({ step: 5 * YEAR_TICKS, unit: 'tick' });
    expect(cleanAdvance({ step: 0, unit: 'tick' })).toEqual({ step: 1, unit: 'tick' });
    expect(cleanAdvance({ step: 999, unit: 'month' })).toEqual({ step: 180, unit: 'month' });
    expect(cleanAdvance({ unit: 'month' })).toEqual({ unit: 'month' });
    // 认不出的单位当年
    expect(cleanAdvance({ step: 3, unit: 'day' })).toEqual({ step: 3 });
    expect(cleanAdvance({ step: 1, unit: 'year' })).toBeUndefined();
    expect(cleanAdvance({ every: 0 })).toEqual({ every: 0 });
    const ok = { step: 3, unit: 'tick' as const, every: 0 };
    expect(cleanAdvance(ok)).toBe(ok);
    expect(advanceOf({ advance: { unit: 'month' } })).toEqual({ ...ADVANCE_DEFAULT, unit: 'month' });
  });

  it('六档:一个月 / 一季 / 半年 / 一年 / 五年,别的都算自己填;自己填最短 1 格、最长 5 年,换单位数字不变、超了夹回', () => {
    expect(STEP_PICKS.map((p) => p.label)).toEqual(['一个月', '一季', '半年', '一年', '五年', '自己填']);
    for (const p of STEP_PICKS) if (p.adv) expect(stepPickOf(p.adv)).toBe(p.v);
    expect(stepPickOf({ step: 3, unit: 'year' })).toBe('own');
    expect(stepPickOf({ step: 2, unit: 'month' })).toBe('own');
    expect(stepUnitMax('year', 12)).toBe(5);
    expect(stepUnitMax('month', 12)).toBe(60);
    expect(stepUnitMax('month', 24)).toBe(120);
    expect(stepUnitMax('month', 0)).toBe(60);
    expect(stepUnitMax('tick', 12)).toBe(1280);
    expect(ownStep(0, 'tick', 12)).toEqual({ step: 1, unit: 'tick' });
    expect(ownStep(30, 'year', 12)).toEqual({ step: 5, unit: 'year' });
    expect(ownStep(30, 'month', 12)).toEqual({ step: 30, unit: 'month' });
    expect(ownStep(99999, 'tick', 12)).toEqual({ step: 1280, unit: 'tick' });
    expect(ownStep(2.4, 'month', 12)).toEqual({ step: 2, unit: 'month' });
  });
});

describe('一步走几格', () => {
  it('一个月走到下个月初(和写到月对得上);一季 64 格、半年 128 格;一年从年中走到明年同一格;最长 5 年', () => {
    const t = (y: number, k = 0) => y * YEAR_TICKS + k;
    // 一年 12 个月:月初在 0、22、43、64、86……格
    expect([1, 2, 3, 4].map((m) => monthStart(1552 * 12 + m, 12) - t(1552))).toEqual([22, 43, 64, 86]);
    expect(stepEnd(MONTH, 12, t(1552))).toBe(t(1552, 22));
    expect(stepEnd(MONTH, 12, t(1552, 22))).toBe(t(1552, 43));
    expect(stepEnd(MONTH, 12, t(1552, 235))).toBe(t(1553));
    // 停在月中:先走到下个月初
    expect(stepEnd(MONTH, 12, t(1552, 30))).toBe(t(1552, 43));
    // 一年 24 个月的世界:一步是一年的 1/24
    expect(stepEnd(MONTH, 24, t(1552))).toBe(t(1552, 11));
    // 只写年的世界照 12 个月
    expect(stepEnd(MONTH, 0, t(1552))).toBe(t(1552, 22));
    // 每一步停下的那一刻写出来正好是下一个月
    let x = t(1552);
    for (let m = 2; m <= 12; m++) {
      x = stepEnd(MONTH, 12, x);
      expect(monthOf(x / YEAR_TICKS, 12)).toBe(m);
    }
    expect(stepEnd(adv({ step: 64, unit: 'tick' }), 12, t(1552, 10))).toBe(t(1552, 74));
    expect(stepEnd(adv({ step: 128, unit: 'tick' }), 12, t(1552))).toBe(t(1552, 128));
    expect(stepEnd(adv({ step: 1, unit: 'tick' }), 12, t(1552, 255))).toBe(t(1553));
    expect(stepEnd(adv(), 12, t(1549, 171))).toBe(t(1550, 171));
    expect(stepEnd(adv({ step: 5 }), 12, t(1549, 171))).toBe(t(1554, 171));
    // 最长 5 年
    expect(stepEnd(adv({ step: 180, unit: 'month' }), 12, t(1552))).toBe(t(1557));
    expect(stepEnd(adv({ step: 9, unit: 'year' }), 12, t(1552))).toBe(t(1557));
  });

  it('一个月一步走一年 = 12 步,每一步不停;每隔 25 年从年中停下的那一刻数,25 年后同一个月停', () => {
    const walk = (a: Advance, since: number, until: number, months = 12) => {
      const stops: number[] = [];
      let now = since;
      let s = since;
      let n = 0;
      while (now < until - 1e-9) {
        const st = nextStep(a, s, now, months);
        expect(st.ticks).toBeGreaterThan(0);
        expect(st.years).toBe(st.ticks / YEAR_TICKS);
        now = st.to;
        n++;
        if (st.pause) {
          stops.push(now);
          s = now;
        }
      }
      return { stops, n };
    };
    expect(walk(MONTH, 1552, 1553)).toEqual({ stops: [], n: 12 });
    expect(walk(MONTH, 1552, 1553, 24).n).toBe(24);
    expect(walk(adv({ step: 64, unit: 'tick' }), 1552, 1553).n).toBe(4);
    expect(walk(adv({ step: 128, unit: 'tick' }), 1552, 1553).n).toBe(2);
    expect(walk(adv({ step: 1, unit: 'tick' }), 1552, 1553).n).toBe(256);
    // 第 1549 年菊月初停下,一个月一步:下一次停在第 1574 年菊月初
    const ju = at(1549, 171);
    expect(monthOf(ju, 12)).toBe(9);
    expect(walk(MONTH, ju, at(1600)).stops).toEqual([at(1574, 171), at(1599, 171)]);
    expect(pauseYear({ every: 25 }, ju, ju)).toBe(at(1574, 171));
    // 一步 3 格:最后一步只走到该停的那一格
    const r = walk(adv({ step: 3, unit: 'tick', every: 1 }), 1552, 1553);
    expect(r.stops).toEqual([1553]);
    // 到能推的最后一年停下
    expect(nextStep(MONTH, END_YEAR_MAX - 1, at(END_YEAR_MAX - 1, 250))).toEqual({ ticks: 6, years: 6 / YEAR_TICKS, to: END_YEAR_MAX, pause: 'end' });
  });

  it('每一步都停(every = 0):每一步走完都停;小旗就在这一步的尽头', () => {
    const e = adv({ step: 1, unit: 'month', every: 0 });
    const st = nextStep(e, 1552, 1552);
    expect(st).toEqual({ ticks: 22, years: 22 / YEAR_TICKS, to: at(1552, 22), pause: 'every' });
    expect(nextStep(e, st.to, st.to)).toEqual({ ticks: 21, years: 21 / YEAR_TICKS, to: at(1552, 43), pause: 'every' });
    expect(pauseYear(e, 1552, 1552)).toBe(at(1552, 22));
    expect(nextStep(adv({ every: 0 }), 1552, 1552)).toEqual({ ticks: 256, years: 1, to: 1553, pause: 'every' });
    // 中途从每 25 年改成每一步(上一次停在很早):从现在走一步就停
    expect(nextStep(e, 1500, 1552).pause).toBe('every');
  });

  it('一步一年时和以前一模一样(以前的算法逐个比)', () => {
    // 以前的 pauseYear / nextStep(一步整年,时刻都是年初)
    const oldPause = (every: number, since: number, now: number) => {
      const e = Math.max(1, Math.round(every));
      const k = now < since ? 1 : Math.floor((now - since) / e) + 1;
      return Math.min(END_YEAR_MAX, since + k * e);
    };
    const oldNext = (step: number, every: number, since: number, now: number) => {
      const a = Math.round(now);
      if (a >= END_YEAR_MAX) return { years: 0, to: a, pause: 'end' };
      const stop = oldPause(every, Math.round(since), a);
      const years = Math.max(1, Math.min(Math.round(step), stop - a, END_YEAR_MAX - a));
      const to = a + years;
      return { years, to, pause: to >= END_YEAR_MAX ? 'end' : to === stop ? 'every' : null };
    };
    let s = 12345;
    const rnd = (n: number) => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) % n;
    for (let i = 0; i < 3000; i++) {
      const step = 1 + rnd(5);
      const every = [1, 3, 10, 25, 50, 100, 777][rnd(7)];
      const since = rnd(3) === 0 ? END_YEAR_MAX - rnd(200) : rnd(4000);
      const now = Math.min(END_YEAR_MAX, since + rnd(300));
      const a = adv({ step, every });
      const want = oldNext(step, every, since, now);
      const got: StepPlan = nextStep(a, since, now);
      expect({ years: got.years, to: got.to, pause: got.pause }, `${step} ${every} ${since} ${now}`).toEqual(want);
      expect(got.ticks).toBe(got.years * YEAR_TICKS);
      expect(pauseYear(a, since, now)).toBe(oldPause(every, since, now));
      // 地图照旧一年重画一次
      expect(redrawAt(a, 12, now + 0.7)).toBe(Math.floor(now + 0.7));
    }
  });

  it('地图在哪一刻重画:一步短于一年的一步一次(按月的每个月初);时间轴上的小刻度放得下才画', () => {
    expect(redrawAt(MONTH, 12, at(1552, 30))).toBe(at(1552, 22));
    expect(redrawAt(MONTH, 12, at(1552, 21))).toBe(1552);
    expect(redrawAt(adv({ step: 64, unit: 'tick' }), 12, at(1552, 130))).toBe(at(1552, 128));
    expect(redrawAt(adv({ step: 300, unit: 'tick' }), 12, at(1552, 130))).toBe(1552);
    // 25 年一段里一个月一格挤不下(4 像素,段宽 1000 像素);出大事停下的那 8 个月一个月一格
    expect(stepMarks(MONTH, 12, at(1549, 171), at(1574, 171), 4 / 1000)).toEqual([]);
    const m = stepMarks(MONTH, 12, 1549, at(1549, 171), 4 / 1000);
    expect(m.map((y) => Math.round((y - 1549) * YEAR_TICKS))).toEqual([22, 43, 64, 86, 107, 128, 150]);
    expect(stepMarks(adv({ step: 5 }), 12, 2650, 2675, 4 / 1000)).toEqual([2655, 2660, 2665, 2670]);
  });
});

describe('选步长时那几句话', () => {
  it('一个月、自己填 1 格(电脑、手机);一年照原来的说法;五年', () => {
    expect(text(stepWhy(MONTH, 12, 0.4, false))).toBe(
      '一个月：推得慢，演绎 100 年要算 1200 步，这台电脑上约 8 分钟（一步一年约 40 秒），放的时候 1×、4× 一样快；大事少，约 96% 的月份全世界没有大事。好处是干预下个月初就生效，出了大事当月就停。',
    );
    expect(text(stepWhy(MONTH, 12, 1, true))).toBe('一个月：推得慢，演绎 100 年要算 1200 步，这台手机上约 20 分钟；大事少，约 96% 的月份全世界没有大事。干预下个月初就生效，出了大事当月就停。');
    const tick = adv({ step: 1, unit: 'tick' });
    expect(text(stepWhy(tick, 12, 0.42, false))).toBe(
      '1 格（一年分 256 格，一格约一天半，推演能分到的最细一刻）：推得很慢，演绎 100 年要算 25600 步，这台电脑上约 3 小时；几乎每一步都没有大事；同一个月里的几步，编年史上记的是同一个月。',
    );
    expect(text(stepWhy(tick, 12, 1, true))).toBe('1 格（一年 256 格，一格约一天半）：推得很慢，演绎 100 年要算 25600 步，这台手机上约 7 小时；几乎每一步都没有大事；同一个月里的几步，编年史上记的是同一个月。');
    expect(text(stepWhy(adv(), 12, 0.4, false))).toBe('一年：约七成的步子全世界没有大事，导播一闪而过；干预最晚一年后生效。');
    expect(text(stepWhy(adv({ step: 5 }), 12, 0.4, false))).toBe('五年：每一步事多，但干预最多要等五年才生效。');
    expect(text(stepWhy(adv({ step: 64, unit: 'tick' }), 12, 0.4, false))).toContain('约九成的季度全世界没有大事');
    expect(text(stepWhy(adv({ step: 128, unit: 'tick' }), 12, 0.4, false))).toContain('约八成的半年全世界没有大事');
    // 还不知道这台设备多快:不写约多久
    expect(text(stepWhy(MONTH, 12, null, false))).toBe('一个月：推得慢，演绎 100 年要算 1200 步；大事少，约 96% 的月份全世界没有大事。好处是干预下个月初就生效，出了大事当月就停。');
    // 一年 24 个月:一步是 1/24 年;只写年的世界多半句
    expect(text(stepWhy(MONTH, 24, null, false))).toContain('演绎 100 年要算 2400 步');
    expect(text(stepWhy(MONTH, 0, null, false))).toMatch(/这个世界只写年，看不出月份。$/);
    // 加粗的几段
    expect(stepWhy(MONTH, 12, 0.4, false).filter((r) => r.b).map((r) => r.t)).toEqual(['一个月', '推得慢', '大事少']);
    expect(aboutTime(90)).toBe('约 1 分半');
    expect(aboutTime(9000)).toBe('约 2 个半小时');
  });

  it('停一下多一档「每一步」;侧栏那一行', () => {
    const e = adv({ step: 1, unit: 'month', every: 0 });
    expect(text(everyWhy(e, 12, false))).toBe(
      `每一步停一次：现在一步一个月，演绎 100 年停 1200 次。这一步没有大事的只停 ${EMPTY_STOP_SECS} 秒，写一句“全世界没有大事”；有大事的照下面的倒计时停。`,
    );
    expect(text(everyWhy(e, 12, true))).toBe('每一步停一次：一步一个月就是每月停，演绎 100 年停 1200 次；没有大事的月只停 3 秒。');
    expect(text(everyWhy(adv(), 12, true))).toBe('每 25 年停一次：演绎 100 年停 4 次。隔得越短、开了「出大事也停」，停得越勤。');
    expect(advanceBrief(adv())).toBe('一步一年，每 25 年停一下');
    expect(advanceBrief(MONTH)).toBe('一步一个月，每 25 年停一下');
    expect(advanceBrief(e)).toBe('一步一个月，每一步都停');
    expect(advanceBrief(adv({ step: 3, unit: 'tick' }))).toBe('一步 3 格，每 25 年停一下');
    expect(advanceBrief(adv({ step: 2 }))).toBe('一步两年，每 25 年停一下');
    expect(stepLabel(adv({ step: 64, unit: 'tick' }))).toBe('一季');
  });
});

describe('这一步、这一段怎么写', () => {
  it('一个月里的写到月;正好一年写年;整年的照旧;年中的两头写到月;只写年的世界只写年', () => {
    expect(oneMonth(at(1552, 22), at(1552, 43), 12)).toBe(2);
    expect(oneMonth(at(1552, 22), at(1552, 64), 12)).toBe(0);
    expect(spanText(at(1552, 22), at(1552, 43), 12, null, N12)).toBe('第 1552 年杏月');
    expect(spanShort(at(1552, 22), at(1552, 43), 12, null, N12)).toBe('杏月');
    expect(spanText(1552, at(1552, 22), 12, null, N12)).toBe('第 1552 年端月');
    expect(spanText(at(1552, 22), at(1552, 43), 12)).toBe('第 1552 年 2 月');
    expect(spanText(1552, 1553, 12)).toBe('第 1552 年');
    expect(spanText(2650, 2675, 12)).toBe('第 2650–2675 年');
    expect(spanText(at(1549, 171), at(1574, 171), 12, null, N12)).toBe('第 1549 年菊月–1574 年菊月');
    expect(spanText(at(1552, 22), at(1552, 43), 0)).toBe('第 1552 年');
    expect(spanShort(at(1552, 22), at(1552, 43), 0)).toBe('第 1552 年');
  });
});

describe('一个月一步走 12 步 = 一年一步走 1 步', () => {
  const worlds = new Map<number, World>();
  const world = (seed: number) => {
    let w = worlds.get(seed);
    if (!w) worlds.set(seed, (w = generateWorld({ ...DEFAULT_PARAMS, seed })));
    return w;
  };
  /** 两份历史逐项一样 */
  const same = (a: Civ, b: Civ, label: string) => {
    expect(Object.keys(a).sort(), label).toEqual(Object.keys(b).sort());
    for (const k of Object.keys(b) as (keyof Civ)[]) expect(a[k], `${label} ${k}`).toEqual(b[k]);
  };
  for (const seed of [7, 2024])
    it(`seed ${seed}:第 1549 年起,开头下一条命令;照界面的算法一个月一步走到第 1550 年,和一步一年逐项一样`, () => {
      const w = world(seed);
      const start: PlayState = { year: 1549, commands: [] };
      const civ0 = playCiv(w, {}, start);
      const alive = civ0.polities.filter((p) => p.ended === undefined);
      const cmd: Intervention[] = [{ kind: 'declare', a: polityKey(civ0, alive[0].id), b: polityKey(civ0, alive[1].id), from: 1549 }];
      const year = playTurn(w, civ0, {}, start, cmd, 1);
      let civ = civ0;
      let play = start;
      let n = 0;
      while (playAt(play) < 1550 * YEAR_TICKS) {
        const now = playAt(play) / YEAR_TICKS;
        const st = nextStep(MONTH, 1549, now, 12);
        const r = playTicks(w, civ, {}, play, n === 0 ? cmd : [], st.ticks);
        expect(r.rejected).toEqual([]);
        expect(playAt(r.play) / YEAR_TICKS).toBe(st.to);
        civ = r.civ;
        play = r.play;
        n++;
      }
      expect(n).toBe(12);
      expect(play).toEqual(year.play);
      same(civ, year.civ, `seed ${seed}`);
    }, 120000);
});
