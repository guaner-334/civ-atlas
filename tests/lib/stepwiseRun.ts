/**
 * 逐年推演的长跑(tests/stepwise-run-*.test.ts 共用;一个种子一个文件,好让两个种子并行跑):
 * 推演模式的世界(作者在几个年份下过干预)从第 0 年开始逐年推演(gen/stepwise.ts 的 startStepwise),
 * 照推进设置一步步往下走(ui/stepwisePlan.ts 的 nextStep),每停一下、隔一阵子在"现在"加几条干预,推到第 1500 年:
 * - 一步一年、一步五年:和带着同样的干预从第 0 年一口气推完逐字段相等
 * - 走到一半存档、读回(进度、从第几年起、推进设置原样回来),按存档重新推出那一刻、接着走:最后照样相等
 * - 存回推演模式:打开(从第 0 年推到第 1500 年)和逐年推演到"现在"一样;接着再推 100 年和一口气推到第 1600 年一样
 * 用 RUN_CELLS 个地块的小一点的世界(推演规则一样;一步的耗时大头是推完以后按整段历史的整理,世界小一半多就快一半多)。
 * 默认大小的世界:stepwise.test.ts 里从第 2800 年一步五年推到第 3000 年、civ-play.test.ts 里每 25 年一步推到第 1500 年。
 */
import { describe, expect, it } from 'vitest';
import { generateWorld, DEFAULT_PARAMS, type World } from '../../src/gen/world';
import { continueCiv, generateCiv, type Civ } from '../../src/gen/civ';
import { extendCiv } from '../../src/gen/civ/extend';
import { ownersAt } from '../../src/gen/civ/timeline';
import { playCiv, playStop, playTurn } from '../../src/gen/civ/play';
import { advanceOf, cleanAdvance, endYearOf, polityKey, regionKey, settlementKey, type AdvanceSettings, type Intervention, type WorldEdits } from '../../src/gen/edits';
import { makeSave, parseSave, saveText } from '../../src/gen/savefile';
import { interventionFate, laterInterventions, startStepwise, stepwiseToNormal } from '../../src/gen/stepwise';
import { nextStep } from '../../src/ui/stepwisePlan';

/** 长跑用的世界有几个地块 */
export const RUN_CELLS = 12000;

const worlds = new Map<string, World>();
/** 种子 seed、cells 个地块(不给 = 默认大小)的世界,同一个只生成一次 */
export const worldOf = (seed: number, cells = DEFAULT_PARAMS.cells) => {
  const key = `${seed}/${cells}`;
  let w = worlds.get(key);
  if (!w) worlds.set(key, (w = generateWorld({ ...DEFAULT_PARAMS, seed, cells })));
  return w;
};

const KINDS = ['declare', 'ally', 'move', 'cede', 'found', 'halt', 'protect', 'unity'] as const;

/** 第 T 年年初给 civ 下 1–3 条干预(按种子和年份定的伪随机,挑当时还在的国家、它们的城和州;国家不到两个 = 不下) */
export function orders(civ: Civ, T: number): Intervention[] {
  let s = (T * 7919 + civ.seed * 31) >>> 0;
  const rnd = () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32;
  const alive = civ.polities.filter((p) => p.ended === undefined);
  if (alive.length < 2) return [];
  const out: Intervention[] = [];
  const n = 1 + Math.floor(rnd() * 3);
  for (let i = 0; i < n; i++) {
    const a = alive[Math.floor(rnd() * alive.length)];
    const b = alive.filter((p) => p !== a)[Math.floor(rnd() * (alive.length - 1))];
    const A = polityKey(civ, a.id);
    const B = polityKey(civ, b.id);
    const kind = KINDS[Math.floor(rnd() * KINDS.length)];
    if (kind === 'declare') out.push({ kind, a: A, b: B, from: T });
    else if (kind === 'ally') out.push({ kind, a: A, b: B, from: T, until: T + 60 });
    else if (kind === 'halt') out.push({ kind, a: A, from: T, until: T + 40 });
    else if (kind === 'protect' || kind === 'unity') out.push({ kind, a: A, from: T });
    else if (kind === 'move') {
      const c = civ.settlements.find((x) => x.ended === undefined && civ.polity[x.region] === a.id && x.id !== a.capital);
      if (c) out.push({ kind, a: A, city: settlementKey(civ, c.id), from: T });
    } else if (kind === 'cede') {
      const r = civ.polity.indexOf(b.id);
      if (r >= 0) out.push({ kind, a: A, region: regionKey(civ, r), from: T });
    } else {
      const c = civ.settlements.find((x) => x.ended === undefined && civ.polity[x.region] === b.id && !civ.polities.some((p) => p.capital === x.id));
      if (c) out.push({ kind, region: regionKey(civ, c.region), from: T });
    }
  }
  return out;
}

/** 作者在推演模式里下的干预:base(推到这几年以后的历史)里那几年还在的国家,保护 / 结盟 / 禁止扩张(按年份轮着来) */
export function authorPlan(base: Civ, years: readonly number[]): Intervention[] {
  return years.flatMap((y, i): Intervention[] => {
    const alive = base.polities.filter((p) => p.founded <= y && (p.ended === undefined || p.ended > y));
    if (alive.length < 2) return [];
    const a = polityKey(base, alive[(i * 3) % alive.length].id);
    const b = polityKey(base, alive[(i * 3 + 1) % alive.length].id);
    if (i % 3 === 0) return [{ kind: 'protect', a, from: y }];
    if (i % 3 === 1) return [{ kind: 'ally', a, b, from: y, until: y + 80 }];
    return [{ kind: 'halt', a, from: y, until: y + 50 }];
  });
}

/**
 * 第 year 年(那一刻)的一个大国和它的一个邻国,按条件现找(历史变了不用跟着改国名):
 * 大国 = 那一刻州最多的(给了 big = 就用这一国,它那一刻还得有州);邻国 = 和它接壤的国家里州最多的。找不到 = null
 */
export function bigAndNeighbor(civ: Civ, year: number, big?: number): { big: number; next: number } | null {
  const own = ownersAt(civ, year).polity;
  const size = new Map<number, number>();
  for (const p of own) if (p >= 0) size.set(p, (size.get(p) ?? 0) + 1);
  const a = big ?? [...size].sort((x, y) => y[1] - x[1] || x[0] - y[0])[0]?.[0];
  if (a === undefined || !size.has(a)) return null;
  const R = civ.regions;
  const near = new Set<number>();
  for (let r = 0; r < own.length; r++) {
    if (own[r] !== a) continue;
    for (let k = R.adjStart[r]; k < R.adjStart[r + 1]; k++) if (own[R.adj[k]] >= 0 && own[R.adj[k]] !== a) near.add(own[R.adj[k]]);
  }
  const b = [...near].sort((x, y) => size.get(y)! - size.get(x)! || x - y)[0];
  return b === undefined ? null : { big: a, next: b };
}

/** 两份历史逐项一样 */
export function same(a: Civ, b: Civ, label: string) {
  expect(Object.keys(a).sort(), label).toEqual(Object.keys(b).sort());
  for (const k of Object.keys(b) as (keyof Civ)[]) expect(a[k], `${label} ${k}`).toEqual(b[k]);
}

/** 变化日志里第 year 年(那一刻)以前的几条,按列 */
function logBefore(civ: Civ, year: number) {
  const L = civ.log;
  let n = 0;
  while (n < L.size && L.year[n] < year) n++;
  return [L.year, L.region, L.layer, L.value, L.cause].map((c) => Array.from(c.subarray(0, n)));
}

/** 两份历史在第 year 年以前一样:变化日志、史事逐条一样;那以前立的国(名字、立国年)、建的城(名字)一样 */
export function samePast(a: Civ, b: Civ, year: number, label: string) {
  expect(logBefore(a, year), `${label} 变化日志`).toEqual(logBefore(b, year));
  expect(
    a.annals.filter((e) => e.year < year),
    `${label} 史事`,
  ).toEqual(b.annals.filter((e) => e.year < year));
  const pol = (c: Civ) => c.polities.filter((p) => p.founded < year).map((p) => [p.name, p.founded]);
  expect(pol(a), `${label} 国家`).toEqual(pol(b));
  const city = (c: Civ) => c.settlements.filter((s) => s.founded < year).map((s) => [s.name, s.founded]);
  expect(city(a), `${label} 城`).toEqual(city(b));
}

/** 存档往返:进度、从第几年起、推进设置原样回来 */
function roundTrip(w: World, edits: WorldEdits): WorldEdits {
  const r = parseSave(saveText(makeSave(w.params, edits, 'x')));
  expect(r.ok).toBe(true);
  if (!r.ok) throw new Error('读不回来');
  expect(r.warnings).toEqual([]);
  expect(r.save.edits.play).toEqual(edits.play);
  expect(r.save.edits.playFrom).toEqual(edits.playFrom);
  expect(r.save.edits.advance).toEqual(cleanAdvance(edits.advance));
  expect(r.save.edits.interventions).toEqual(edits.interventions);
  return r.save.edits;
}

/**
 * 照推进设置从 edits(逐年推演中的世界)的进度一步步推到第 to 年:每停一下、每过 100 年的第 13 年在"现在"加几条干预;
 * 推到 saveAt 那年时存档往返一次,按存档重新推出那一刻(要和一步步推过来的一样),之后从读回来的接着走
 */
function walk(w: World, edits: WorldEdits, to: number, saveAt: number) {
  const adv = advanceOf(edits);
  let play = edits.play!;
  let since = play.year;
  let civ = playCiv(w, { interventions: edits.interventions }, play);
  let saved = false;
  let pauses = 0;
  while (play.year < to) {
    if (!saved && play.year >= saveAt) {
      saved = true;
      const back = roundTrip(w, { ...edits, play });
      const again = playCiv(w, { interventions: back.interventions }, back.play!);
      same(again, civ, `第 ${play.year} 年按存档重推`);
      civ = again;
      play = back.play!;
    }
    const step = nextStep(adv, since, play.year);
    expect(step.years, `第 ${play.year} 年`).toBeGreaterThan(0);
    expect(step.years).toBeLessThanOrEqual(adv.step);
    const now = play.year;
    const cmds = now === since || now % 100 === 13 ? orders(civ, now) : [];
    const r = playTurn(w, civ, { interventions: edits.interventions }, play, cmds, step.years);
    expect(r.rejected, `第 ${now} 年`).toEqual([]);
    expect(r.play.year).toBe(step.to);
    civ = r.civ;
    play = r.play;
    if (step.pause) {
      expect((step.to - since) % adv.every, `第 ${step.to} 年停`).toBe(0);
      since = step.to;
      pauses++;
    }
  }
  expect(saved).toBe(true);
  return { civ, play, pauses };
}

export function stepwiseRun(seed: number) {
  describe(`逐年推演长跑(seed ${seed},${RUN_CELLS} 个地块)`, () => {
    // 推演模式的世界:作者在第 700、1000、1300 年下过干预(挑那几年还在的国家;第一次用到时才推)
    let made: { w: World; author: Intervention[]; world: WorldEdits } | null = null;
    const setup = () => {
      if (made) return made;
      const w = worldOf(seed, RUN_CELLS);
      const author = authorPlan(generateCiv(w, { endYear: 1500 }), [700, 1000, 1300]);
      return (made = { w, author, world: { names: {}, interventions: author, terrain: [], endYear: 3000 } });
    };

    const run = (advance: AdvanceSettings | undefined, saveAt: number) => {
      const { w, author, world } = setup();
      const edits: WorldEdits = { ...startStepwise(world, 0), ...(advance ? { advance } : {}) };
      expect(edits.play).toEqual({ year: 0, commands: [] });
      expect(laterInterventions(world, 0).map((x) => x.v)).toEqual(author);
      const got = walk(w, edits, 1500, saveAt);
      expect(got.play.year).toBe(1500);
      expect(got.civ.endYear).toBe(playStop(1500));
      expect(got.pauses).toBe(1500 / advanceOf(edits).every);
      // 一路加的干预都收下了,每条在它那一年记了一条史事(对象指不到的除外,和推演模式一样)
      expect(got.play.commands.length).toBeGreaterThan(50);
      const all = [...author, ...got.play.commands];
      same(got.civ, generateCiv(w, { endYear: playStop(1500), interventions: all }), '一口气推完');
      return { w, author, edits, ...got, all };
    };

    it('一步一年推到第 1500 年:和带着同样的干预一口气推完逐字段相等;走到一半存档往返照样相等;存回推演模式、再推 100 年也对', async () => {
      // 推进设置照默认(一步一年、每 25 年停一下)
      const { w, author, edits, civ, play, all } = run(undefined, 750);
      // 作者带进来的干预到了那一年都有着落:生效了,或者说得出为什么没生效
      for (let i = 0; i < author.length; i++) {
        const f = interventionFate(civ, i);
        expect(f.state, `第 ${i} 条`).not.toBe('later');
        if (f.state === 'void') expect(f.why.length).toBeGreaterThan(0);
      }

      // 存回推演模式:普通世界,推到第 1500 年;打开和逐年推演到"现在"一样
      const normal = stepwiseToNormal({ ...edits, play })!;
      expect(normal.play).toBeUndefined();
      expect(normal.playFrom).toBeUndefined();
      expect(endYearOf(normal)).toBe(1500);
      expect(normal.interventions).toEqual(all);
      const back = parseSave(saveText(makeSave(w.params, normal, 'x')));
      expect(back.ok && endYearOf(back.save.edits)).toBe(1500);
      const opened = generateCiv(w, { interventions: normal.interventions, endYear: 1500 });
      samePast(opened, civ, 1500, '存回推演模式');
      same(continueCiv(w, civ, { interventions: normal.interventions, endYear: 1500 }), opened, '从逐年推演的结果接着推到第 1500 年');
      // 接着再推 100 年 = 一口气推到第 1600 年
      const more = await extendCiv(w, opened, { interventions: normal.interventions, endYear: 1600 });
      expect(more).not.toBeNull();
      same(more!, generateCiv(w, { interventions: normal.interventions, endYear: 1600 }), '再推 100 年');
    }, 900_000);

    it('一步五年推到第 1500 年:和一口气推完逐字段相等;存档往返照样相等', () => {
      run({ step: 5 }, 800);
    }, 600_000);
  });
}
