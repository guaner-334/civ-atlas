/**
 * 逐年推演的底层(gen/edits.ts 的推进设置、gen/stepwise.ts、ui/stepwisePlan.ts):
 * - 推进设置:清理非法值、默认的不写、存档往返、旧存档没有这一项照默认;从第几年起跟着进度走;撤销别的修改时进度和设置照留
 * - 一步走几年、什么时候停一下:每隔几年(从上一次停下的那年数起)、一步不跨过该停的那年、到能推的最后一年;
 *   出大事也停(照导播排期的分量,干预和地形大事不算)
 * - 从推演模式第 T 年开始:带着 T 年以后的干预、不加干预时,和推演模式那条历史一模一样;去掉一条时只有那一条不发生;
 *   到时候对象不在了的说明原因
 * - 存回推演模式:不到 3000 年的也行;打开和逐年推演到"现在"一样,接着再推 N 年也对
 * 长跑(一步一年 / 一步五年推到第 1500 年)在 stepwise-run-*.test.ts。
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_PARAMS } from '../src/gen/world';
import { continueCiv, generateCiv, type Civ } from '../src/gen/civ';
import { extendCiv } from '../src/gen/civ/extend';
import { fullChronicle } from '../src/gen/civ/religionText';
import type { ChronicleEntry } from '../src/gen/civ/chronicle';
import { playCiv, playTurn } from '../src/gen/civ/play';
import {
  ADVANCE_DEFAULT,
  END_YEAR_MAX,
  advanceOf,
  cleanAdvance,
  cleanPlay,
  endYearOf,
  playFromOf,
  polityKey,
  regionKey,
  sameAdvance,
  type Advance,
  type Intervention,
  type PlayState,
  type WorldEdits,
} from '../src/gen/edits';
import { editCount, editsLost, makeSave, parseSave, saveText } from '../src/gen/savefile';
import { interventionFate, laterInterventions, startStepwise, stepwiseToNormal } from '../src/gen/stepwise';
import { revertEdits } from '../src/ui/editsStore';
import { tierOf } from '../src/ui/directorPlan';
import { bigEntries, nextStep, pauseYear, stepPause } from '../src/ui/stepwisePlan';
import { authorPlan, same, samePast, worldOf } from './lib/stepwiseRun';

const base: WorldEdits = { names: {}, interventions: [], terrain: [] };
const DEFAULT_SEED_PARAMS = { ...DEFAULT_PARAMS, seed: 7 };

describe('推进设置', () => {
  it('清理:取整、夹回范围;认不出的按默认;默认的不写;合格的原样返回', () => {
    for (const bad of [undefined, null, 'x', 3, [], {}]) expect(cleanAdvance(bad)).toBeUndefined();
    expect(cleanAdvance({ ...ADVANCE_DEFAULT })).toBeUndefined();
    expect(cleanAdvance({ step: 1, every: 25, big: false, countdown: 60 })).toBeUndefined();
    const ok = { step: 3, every: 37, big: true as const, countdown: 0 };
    expect(cleanAdvance(ok)).toBe(ok);
    // 一步:1–5 年
    expect(cleanAdvance({ step: 9 })).toEqual({ step: 5 });
    expect(cleanAdvance({ step: 2.6 })).toEqual({ step: 3 });
    expect(cleanAdvance({ step: 0 })).toBeUndefined();
    expect(cleanAdvance({ step: '2' })).toBeUndefined();
    // 每隔几年:1 年起,到能推的最后一年;自己填的数照收
    expect(cleanAdvance({ every: 10 })).toEqual({ every: 10 });
    expect(cleanAdvance({ every: 0 })).toEqual({ every: 1 });
    expect(cleanAdvance({ every: 1e9 })).toEqual({ every: END_YEAR_MAX });
    expect(cleanAdvance({ every: Number.NaN })).toBeUndefined();
    // 出大事也停:只认 true
    expect(cleanAdvance({ big: 1 })).toBeUndefined();
    // 倒计时:30 / 60 / 120 / 不倒计时
    expect(cleanAdvance({ countdown: 0 })).toEqual({ countdown: 0 });
    expect(cleanAdvance({ countdown: 30 })).toEqual({ countdown: 30 });
    expect(cleanAdvance({ countdown: 120 })).toEqual({ countdown: 120 });
    expect(cleanAdvance({ countdown: 45 })).toBeUndefined();
    expect(cleanAdvance({ countdown: -1 })).toBeUndefined();
    // 多余的字段去掉
    expect(cleanAdvance({ step: 2, foo: 1 })).toEqual({ step: 2 });
    expect(advanceOf({})).toEqual(ADVANCE_DEFAULT);
    expect(advanceOf({ advance: { step: 5, countdown: 0 } })).toEqual({ step: 5, every: 25, big: false, countdown: 0 });
    expect(sameAdvance(undefined, { step: 1, every: 25 })).toBe(true);
    expect(sameAdvance({}, { big: true })).toBe(false);
  });

  it('存档往返;旧存档没有这一项照默认;认不出的按默认、提示一句;从第几年起跟着进度走', () => {
    const edits: WorldEdits = { ...base, play: { year: 2700, commands: [] }, playFrom: 2650, advance: { step: 5, every: 50, big: true, countdown: 0 } };
    const r = parseSave(saveText(makeSave(DEFAULT_SEED_PARAMS, edits, 'x')));
    expect(r.ok && r.warnings).toEqual([]);
    expect(r.ok && r.save.edits.advance).toEqual(edits.advance);
    expect(r.ok && r.save.edits.playFrom).toBe(2650);
    expect(r.ok && advanceOf(r.save.edits)).toEqual({ step: 5, every: 50, big: true, countdown: 0 });
    // 旧存档:没有推进设置、没有从第几年起
    const old = parseSave(saveText(makeSave(DEFAULT_SEED_PARAMS, { ...base, play: { year: 300, commands: [] } }, 'x')));
    expect(old.ok && 'advance' in old.save.edits).toBe(false);
    expect(old.ok && advanceOf(old.save.edits)).toEqual(ADVANCE_DEFAULT);
    expect(old.ok && playFromOf(old.save.edits)).toBe(0);
    // 认不出的项按默认,提示一句;写明了默认值的不提示
    const raw = JSON.parse(saveText(makeSave(DEFAULT_SEED_PARAMS, base, 'x')));
    raw.edits.advance = { step: 'x', every: 10, extra: 1 };
    let back = parseSave(JSON.stringify(raw));
    expect(back.ok && back.save.edits.advance).toEqual({ every: 10 });
    expect(back.ok && back.warnings.some((w) => w.includes('推进设置'))).toBe(true);
    raw.edits.advance = { step: 1, big: false, countdown: 60 };
    back = parseSave(JSON.stringify(raw));
    expect(back.ok && back.save.edits.advance).toBeUndefined();
    expect(back.ok && back.warnings).toEqual([]);
    // 从第几年起:没在逐年推演的不要;晚于进度的夹到进度那年;0 不写
    const pf = (e: Partial<WorldEdits>) => {
      const x = parseSave(saveText(makeSave(DEFAULT_SEED_PARAMS, { ...base, ...e }, 'x')));
      return x.ok ? x.save.edits.playFrom : 'bad';
    };
    expect(pf({ playFrom: 2650 })).toBeUndefined();
    expect(pf({ play: { year: 2600, commands: [] }, playFrom: 2650 })).toBe(2600);
    expect(pf({ play: { year: 2600, commands: [] }, playFrom: 0 })).toBeUndefined();
    // 改了几处:推进设置、从第几年起不算;打开别人的链接会丢掉:推进设置算一处
    expect(editCount({ ...base, advance: { step: 5 } })).toBe(0);
    const a = makeSave(DEFAULT_SEED_PARAMS, { ...base, advance: { step: 5, big: true } }, 'x');
    const b = makeSave(DEFAULT_SEED_PARAMS, base, 'x');
    expect(editsLost(a, b)).toBe(1);
    expect(editsLost(b, a)).toBe(0);
  });

  it('进度可以停在第 0 年(从第 0 年起、还没走第一步);从那里走一步和直接推到那一年一样', () => {
    const p = { year: 0, commands: [] };
    expect(cleanPlay(p)).toBe(p);
    expect(cleanPlay({ year: -1, commands: [] })).toBeUndefined();
    const r = parseSave(saveText(makeSave(DEFAULT_SEED_PARAMS, { ...base, play: p }, 'x')));
    expect(r.ok && r.save.edits.play).toEqual(p);
    const w = worldOf(7);
    const at0 = playCiv(w, {}, p);
    for (const n of [1, 5]) same(playTurn(w, at0, {}, p, [], n).civ, playCiv(w, {}, { year: n, commands: [] }), `第 0 年走 ${n} 年`);
  }, 120_000);

  it('撤销别的修改时,逐年推演的进度、从第几年起、推进设置照现在的留着', () => {
    const play: PlayState = { year: 900, commands: [] };
    const before: WorldEdits = { ...base, play, playFrom: 800, advance: { step: 5 } };
    const after: WorldEdits = { ...before, names: { 'polity:c12#0': '昌' } };
    const undone = revertEdits(after, after, before);
    expect(undone.names).toEqual({});
    expect(undone.play).toBe(play);
    expect(undone.playFrom).toBe(800);
    expect(undone.advance).toEqual({ step: 5 });
  });
});


describe('一步走几年、什么时候停一下', () => {
  const adv = (a: Partial<Advance> = {}): Advance => ({ ...ADVANCE_DEFAULT, ...a });

  it('每隔几年:从上一次停下的那年数起;一步不跨过该停的那年;中途改了设置下一步起照新的', () => {
    expect(nextStep(adv(), 2650, 2650)).toEqual({ years: 1, to: 2651, pause: null });
    expect(nextStep(adv(), 2650, 2674)).toEqual({ years: 1, to: 2675, pause: 'every' });
    expect(nextStep(adv({ step: 5 }), 2650, 2650)).toEqual({ years: 5, to: 2655, pause: null });
    expect(nextStep(adv({ step: 5 }), 2650, 2670)).toEqual({ years: 5, to: 2675, pause: 'every' });
    // 一步三年、每十年停:2653、2656、2659,最后一步只走一年正好停在 2660
    const walk = (a: Advance, since: number, years: number) => {
      const out: number[] = [];
      let now = since;
      let s = since;
      while (now < since + years) {
        const st = nextStep(a, s, now);
        now = st.to;
        if (st.pause) {
          out.push(now);
          s = now;
        }
      }
      return out;
    };
    expect(nextStep(adv({ step: 3, every: 10 }), 2650, 2659)).toEqual({ years: 1, to: 2660, pause: 'every' });
    // 每 25 年停一次:演绎 100 年停 4 次(一步一年、一步五年都一样)
    expect(walk(adv(), 2650, 100)).toEqual([2675, 2700, 2725, 2750]);
    expect(walk(adv({ step: 5 }), 2650, 100)).toEqual([2675, 2700, 2725, 2750]);
    expect(walk(adv({ step: 4, every: 10 }), 0, 30)).toEqual([10, 20, 30]);
    // 中途把 50 年改成 10 年:从上一次停下的那年(2650)按 10 年数,下一次停 2680
    expect(pauseYear({ every: 10 }, 2650, 2670)).toBe(2680);
    expect(nextStep(adv({ every: 10 }), 2650, 2670)).toEqual({ years: 1, to: 2671, pause: null });
    expect(pauseYear({ every: 25 }, 2650, 2600)).toBe(2675);
    // 到能推的最后一年停下,不再往下走
    expect(nextStep(adv({ step: 5 }), 59990, 59998)).toEqual({ years: 2, to: END_YEAR_MAX, pause: 'end' });
    expect(nextStep(adv({ step: 5 }), 59990, END_YEAR_MAX)).toEqual({ years: 0, to: END_YEAR_MAX, pause: 'end' });
  });

  it('出大事也停:照导播排期的分量(头等大事),干预、地形大事不算;几样都碰上了按 到头 > 每隔几年 > 出大事', () => {
    const w = worldOf(7);
    const civ = generateCiv(w, { endYear: 3000 });
    const entries = fullChronicle(civ);
    const big = bigEntries(entries, 0, 3000);
    expect(big.length).toBeGreaterThan(20);
    expect(big.every((e) => tierOf(e) === 'big' && e.kind !== 'intervene' && e.kind !== 'upheaval')).toBe(true);
    const kinds = new Set(big.map((e) => e.kind));
    expect([...kinds].every((k) => ['fall', 'split', 'war', 'dynasty', 'vanish', 'collapse', 'revolt'].includes(k)), [...kinds].join()).toBe(true);
    expect(kinds.has('war') && kinds.has('dynasty')).toBe(true);
    // 干预、地形大事(分量够,但是作者自己安排的)不算
    const e0 = big[0];
    const own = [{ ...e0, kind: 'intervene' }, { ...e0, kind: 'upheaval' }] as ChronicleEntry[];
    expect(bigEntries(own, 0, 3000)).toEqual([]);
    // 年份含头不含尾
    const y = e0.year;
    expect(bigEntries([e0], y, y + 1)).toEqual([e0]);
    expect(bigEntries([e0], y - 1, y)).toEqual([]);
    const from = Math.floor(y);
    const step = { years: 1, to: from + 1, pause: null };
    expect(stepPause({ big: true }, from, step, entries).why).toBe('big');
    const off = stepPause({ big: false }, from, step, entries);
    expect(off.why).toBeNull();
    expect(off.big).toContain(e0);
    expect(stepPause({ big: true }, from, { ...step, pause: 'every' }, entries).why).toBe('every');
    expect(stepPause({ big: true }, from, { ...step, pause: 'end' }, entries).why).toBe('end');
    // 第 1000–1500 年一步一年地走,勾了"出大事也停":因为大事停下的那一步里都有大事、没停的那几步里没有;
    // 每停一下从那年重新数,两次停下最多隔 25 年;不勾的话只按每 25 年停
    const run = (a: Advance) => {
      let since = 1000;
      let now = 1000;
      const stops: [number, string][] = [];
      while (now < 1500) {
        const st = nextStep(a, since, now);
        const p = stepPause(a, now, st, entries);
        if (p.why === 'big') expect(p.big.length).toBeGreaterThan(0);
        if (!p.why && a.big) expect(p.big).toEqual([]);
        now = st.to;
        if (p.why) {
          expect(now - since).toBeLessThanOrEqual(25);
          stops.push([now, p.why]);
          since = now;
        }
      }
      return stops;
    };
    const withBig = run(adv({ big: true }));
    expect(withBig.filter((x) => x[1] === 'big').length).toBeGreaterThan(0);
    expect(withBig.length).toBeGreaterThanOrEqual(500 / 25);
    expect(run(adv()).map((x) => x[0])).toEqual(Array.from({ length: 20 }, (_, i) => 1025 + 25 * i));
  });
});

/** 照推进设置从 edits 的进度一步步推到第 to 年(不加干预);每停一下 check 一次 */
function walkTo(w: ReturnType<typeof worldOf>, edits: WorldEdits, to: number, check?: (civ: Civ, year: number) => void) {
  const a = advanceOf(edits);
  let play = edits.play!;
  let since = play.year;
  let civ = playCiv(w, { interventions: edits.interventions }, play);
  check?.(civ, play.year);
  while (play.year < to) {
    const st = nextStep(a, since, play.year);
    const r = playTurn(w, civ, { interventions: edits.interventions }, play, [], st.years);
    civ = r.civ;
    play = r.play;
    if (st.pause) {
      since = play.year;
      check?.(civ, play.year);
    }
  }
  return { civ, play };
}

describe('从推演模式第 T 年开始', () => {
  const T = 2800;
  for (const seed of [7, 2024]) {
    // 推演模式的世界(第一次用到时才推):作者第 2500 年下过一条(保护到第 2900 年,跨过 T),T 以后三条;再加一条保护一个 T 以前就亡了的国家
    let made: { w: ReturnType<typeof worldOf>; later: Intervention[]; edits: WorldEdits; orig: Civ } | null = null;
    const setup = () => {
      if (made) return made;
      const w = worldOf(seed);
      const plain = generateCiv(w, { endYear: 3000 });
      const dead = plain.polities.find((p) => p.ended !== undefined && p.ended < 2400)!;
      const pre: Intervention = { ...authorPlan(plain, [2500])[0], until: 2900 } as Intervention;
      const later = authorPlan(plain, [2820, 2860, 2900]);
      const gone: Intervention = { kind: 'protect', a: polityKey(plain, dead.id), from: 2850 };
      const edits: WorldEdits = { ...base, interventions: [pre, ...later, gone], endYear: 3000, advance: { step: 5, every: 50 } };
      return (made = { w, later, edits, orig: generateCiv(w, { interventions: edits.interventions, endYear: 3000 }) });
    };

    it(`seed ${seed}:带着 T 年以后的干预、不加干预时,和推演模式那条历史一模一样;对象不在了的说明原因`, () => {
      const { w, later, edits, orig } = setup();
      expect(later).toHaveLength(3);
      expect(laterInterventions(edits, T).map((x) => x.index)).toEqual([1, 2, 3, 4]);
      const se = startStepwise(edits, T);
      expect(se.play).toEqual({ year: T, commands: [] });
      expect(se.playFrom).toBe(T);
      expect(se.endYear).toBeUndefined();
      expect(se.interventions).toEqual(edits.interventions);
      expect(se.advance).toEqual(edits.advance);
      expect(edits.play).toBeUndefined(); // 原来的不改
      let first = true;
      const { civ, play } = walkTo(w, se, 3000, (c, year) => {
        samePast(c, orig, year, `seed ${seed} 第 ${year} 年`);
        if (first) {
          // 刚开始:T 年以后的那几条都还没到
          first = false;
          for (const i of [1, 2, 3, 4]) expect(interventionFate(c, i).state).toBe('later');
        }
      });
      expect(play.year).toBe(3000);
      // 存回推演模式 = 原来那个世界(干预一样、推到第 3000 年);打开和原来那条历史逐字段相等
      const normal = stepwiseToNormal({ ...se, play });
      expect(normal.interventions).toEqual(edits.interventions);
      expect(endYearOf(normal)).toBe(3000);
      same(continueCiv(w, civ, { interventions: normal.interventions, endYear: 3000 }), orig, `seed ${seed}`);
      // 带着的几条都有着落;那个早就亡了的国家:没生效,说得出原因
      for (const i of [1, 2, 3]) expect(interventionFate(civ, i).state).not.toBe('later');
      const f = interventionFate(civ, 4);
      expect(f.state).toBe('void');
      expect(f.state === 'void' && f.why).toMatch(/已亡/);
    }, 300_000);

    it(`seed ${seed}:去掉 T 年以后的一条,只有那一条不发生;T 年以前的去不掉`, () => {
      const { w, later, edits, orig } = setup();
      expect(startStepwise(edits, T, [0]).interventions).toEqual(edits.interventions);
      const se = startStepwise(edits, T, [1]);
      const kept = edits.interventions.filter((_, i) => i !== 1);
      expect(se.interventions).toEqual(kept);
      const { civ, play } = walkTo(w, se, 3000);
      const opened = continueCiv(w, civ, { interventions: stepwiseToNormal({ ...se, play }).interventions, endYear: 3000 });
      same(opened, generateCiv(w, { interventions: kept, endYear: 3000 }), `seed ${seed} 去掉一条`);
      // 去掉的那条那一年以前和原来一模一样;那一年它的史事没了,别的干预照样各有着落
      samePast(opened, orig, later[0].from, `seed ${seed}`);
      const iv = (c: Civ) => c.annals.filter((e) => e.kind === 'intervene');
      const had = iv(orig).some((e) => e.war === 1);
      expect(iv(opened).length).toBe(iv(orig).length - (had ? 1 : 0));
      expect(iv(opened).some((e) => e.year === later[0].from && e.war === 1 && opened.interventions![1] === later[0])).toBe(false);
      for (const i of [1, 2]) expect(interventionFate(opened, i).state).not.toBe('later');
    }, 300_000);
  }
});

describe('存回推演模式', () => {
  it('不到 3000 年也行:从第 0 年起一步一年推到第 60 年(第 30 年立了个国),存回成普通世界;打开和逐年推演到"现在"一样;再推 100 年也对', async () => {
    const w = worldOf(7);
    const se = startStepwise(base, 0);
    expect(se.play).toEqual({ year: 0, commands: [] });
    expect('playFrom' in se).toBe(false);
    let play = se.play!;
    let civ = playCiv(w, {}, play);
    while (play.year < 60) {
      let cmds: Intervention[] = [];
      if (play.year === 30) {
        const r = civ.culture.findIndex((c, i) => c >= 0 && i < civ.regions.count);
        expect(r).toBeGreaterThanOrEqual(0);
        cmds = [{ kind: 'found', region: regionKey(civ, r), from: 30, name: '昌' }];
      }
      const st = nextStep(advanceOf(se), 0, play.year);
      const out = playTurn(w, civ, {}, play, cmds, st.years);
      expect(out.rejected).toEqual([]);
      civ = out.civ;
      play = out.play;
    }
    expect(play.commands).toHaveLength(1);
    expect(civ.polities.length).toBeGreaterThan(0);
    const normal = stepwiseToNormal({ ...se, play });
    expect(endYearOf(normal)).toBe(60);
    expect(normal.interventions).toEqual(play.commands);
    expect(normal.play).toBeUndefined();
    const back = parseSave(saveText(makeSave(w.params, normal, 'x')));
    expect(back.ok && back.save.edits.endYear).toBe(60);
    const opened = generateCiv(w, { interventions: normal.interventions, endYear: endYearOf(normal) });
    samePast(opened, civ, 60, '第 60 年存回');
    same(continueCiv(w, civ, { interventions: normal.interventions, endYear: 60 }), opened, '接着推到第 60 年');
    const more = await extendCiv(w, opened, { interventions: normal.interventions, endYear: 160 });
    same(more!, generateCiv(w, { interventions: normal.interventions, endYear: 160 }), '再推 100 年');
    // 已经在逐年推演的世界再从第 40 年开始:命令串先并进干预
    const again = startStepwise({ ...se, play }, 40);
    expect(again.interventions).toEqual(play.commands);
    expect(again.play).toEqual({ year: 40, commands: [] });
    expect(again.playFrom).toBe(40);
  }, 120_000);

  it('在第 0 年存回推到第 1 年;没在逐年推演的原样返回', () => {
    expect(endYearOf(stepwiseToNormal({ ...base, play: { year: 0, commands: [] } }))).toBe(1);
    const normal: WorldEdits = { ...base, endYear: 5000 };
    expect(stepwiseToNormal(normal)).toBe(normal);
    expect(stepwiseToNormal({ ...normal, playFrom: 20 })).toEqual(normal);
  });
});
