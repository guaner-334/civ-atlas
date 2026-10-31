/**
 * 逐年推演里从某一年重新演绎(gen/stepwise.ts 的 rewindStepwise;界面在 src/ui/Stepwise.tsx、StepwiseDialogs.tsx):
 * seed 7 推演模式第 2650 年起,照默认推进设置(一步一年、每 25 年停一下)演绎到第 2700 年,
 * 中间加两条干预(第 2660 年那一刻最大的国家禁止分裂、第 2680 年它向一个邻国宣战;国家按条件现找);倒回第 2675 年重新演绎:
 * - 第 2675 年以后加的那条不要了,以前的那条还在;进度回到第 2675 年年初
 * - 倒回以后的历史和"带着留下的干预从第 0 年推到那一年"逐字段相等,第 2675 年以前和倒回之前一样
 * - 接着一步步演绎到第 2700 年:和带着同样干预从第 0 年一口气推完逐字段相等;不要了的那条没有生效
 * - 弹窗里"不要了的历史"列的几件(短句)
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_PARAMS, generateWorld } from '../src/gen/world';
import { generateCiv, type Civ } from '../src/gen/civ';
import { fullChronicle } from '../src/gen/civ/story/religionText';
import { playCiv, playStop, playTurn } from '../src/gen/civ/play';
import { advanceOf, playFromOf, polityKey, type Intervention, type PlayState, type WorldEdits } from '../src/gen/edits';
import { rewindStepwise, startStepwise } from '../src/gen/stepwise';
import { REVIEW_WEIGHT, nextStep, rewindBrief } from '../src/ui/stepwisePlan';
import { entryWeight } from '../src/ui/timelineLayout';
import { bigAndNeighbor, same, samePast } from './lib/stepwiseRun';

const world = generateWorld({ ...DEFAULT_PARAMS, seed: 7 });
const WORLD: WorldEdits = { names: {}, interventions: [], terrain: [] };

describe('seed 7 演绎到第 2700 年,倒回第 2675 年重新演绎', () => {
  const edits0 = startStepwise(WORLD, 2650);
  const adv = advanceOf(edits0);
  /** 照界面一步步往下走(停一下以后从停下的那年数下一段);at = 在"现在"(第 now 年年初)加的干预 */
  const walk = (civ: Civ, play: PlayState, to: number, at: (civ: Civ, now: number) => Intervention[] = () => []) => {
    let since = play.year;
    while (play.year < to) {
      const plan = nextStep(adv, since, play.year);
      const r = playTurn(world, civ, {}, play, at(civ, play.year), plan.years);
      expect(r.rejected).toEqual([]);
      civ = r.civ;
      play = r.play;
      if (plan.pause) since = play.year;
    }
    return { civ, play };
  };

  let first: { civ: Civ; play: PlayState } | null = null;
  let kept: Intervention;
  let gone: Intervention;

  it('第 2650 年起演绎到第 2700 年,第 2660、2680 年各加一条干预', () => {
    // 加干预的国家按条件现找(那一刻最大的国家和它的邻国;GENERATOR_VERSION 40 时是大霄王朝、克拉尔汗国)
    let big = -1;
    first = walk(playCiv(world, {}, edits0.play!), edits0.play!, 2700, (c, now) => {
      if (now === 2660) {
        const two = bigAndNeighbor(c, now - 0.5);
        expect(two).toBeTruthy();
        big = two!.big;
        kept = { kind: 'unity', a: polityKey(c, big), from: 2660 };
        return [kept];
      }
      if (now === 2680) {
        // 还是第 2660 年那一国(这二十年里亡了就换这一刻最大的)
        const two = bigAndNeighbor(c, now - 0.5, big) ?? bigAndNeighbor(c, now - 0.5);
        expect(two).toBeTruthy();
        gone = { kind: 'declare', a: polityKey(c, two!.big), b: polityKey(c, two!.next), from: 2680 };
        return [gone];
      }
      return [];
    });
    expect(first.play.year).toBe(2700);
    expect(first.play.commands).toEqual([kept, gone]);
    // 两条都记了一条史事
    const iv = (c: Civ, y: number) => c.annals.some((e) => e.kind === 'intervene' && Math.floor(e.year) === y);
    expect(iv(first.civ, 2660) && iv(first.civ, 2680)).toBe(true);
  }, 300_000);

  it('倒回第 2675 年:那以后加的那条不要了、以前的还在;历史和带着留下的干预从第 0 年推到那一年逐字段相等;接着演绎到第 2700 年也相等', () => {
    const f = first!;
    const r = rewindStepwise({ ...edits0, play: f.play }, 2675.6)!;
    expect(r.dropped).toEqual([gone]);
    expect(r.edits.play).toEqual({ year: 2675, commands: [kept] });
    // 起演那年、推进设置、作者的干预照旧
    expect(playFromOf(r.edits)).toBe(2650);
    expect(r.edits.interventions).toEqual(edits0.interventions);

    const back = playCiv(world, {}, r.edits.play!);
    same(back, generateCiv(world, { interventions: [kept], endYear: playStop(2675) }), '倒回以后');
    samePast(back, f.civ, 2675, '第 2675 年以前和倒回之前');

    // 接着演绎(这一段从第 2675 年数起):和一口气推完一样;宣战那条没生效
    const again = walk(back, r.edits.play!, 2700);
    expect(again.play).toEqual({ year: 2700, commands: [kept] });
    same(again.civ, generateCiv(world, { interventions: [kept], endYear: playStop(2700) }), '倒回以后演绎到第 2700 年');
    expect(again.civ.annals.some((e) => e.kind === 'intervene' && Math.floor(e.year) === 2680)).toBe(false);
    expect(again.civ.annals.some((e) => e.kind === 'intervene' && Math.floor(e.year) === 2660)).toBe(true);
  }, 300_000);

  it('弹窗里"不要了的历史"列这一段分量最重的几件,一件几个字,按先后', () => {
    const f = first!;
    const all = fullChronicle(f.civ);
    const brief = rewindBrief(f.civ, 2667, 2700, all);
    // 不钉死哪几件(历史一变就换):按这一段里分量够的大事查挑法。GENERATOR_VERSION 40 时是"埃维里亚王国王室更迭、大霄伐克拉尔、有鹰代有桂"
    // 每一件单独写成几个字(只给它一条时列的那句)
    const pool = all
      .filter((e) => e.year >= 2667 && e.year < 2700 && e.kind !== 'intervene' && e.kind !== 'upheaval' && entryWeight(e) >= REVIEW_WEIGHT)
      .map((e) => ({ e, s: rewindBrief(f.civ, 2667, 2700, [e], 1)[0] }))
      .filter((x) => x.s);
    expect(pool.length, '这一段有分量够的大事').toBeGreaterThan(0);
    const said = [...new Set(pool.map((x) => x.s))];
    expect(brief.length).toBe(Math.min(3, said.length));
    expect(new Set(brief).size).toBe(brief.length);
    // 一件几个字:仗写"甲伐乙 / 甲灭乙",亡国"甲灭乙 / 甲亡",自立、复国、改朝"新代旧"(说不成短句的取正文第一截)
    const of = (s: string) => pool.filter((x) => x.s === s);
    for (const s of brief) {
      expect(of(s).length, s).toBeGreaterThan(0);
      expect(s.length, s).toBeLessThanOrEqual(15);
      expect(s).not.toMatch(/undefined|NaN|某国/);
      for (const { e } of of(s)) {
        if (e.tag === '战' && e.polities.length >= 2) expect(s).toMatch(/^\S+(伐|灭)\S+$/);
        if (e.tag === '分') expect(s).toMatch(/自立$/);
        if (e.tag === '复') expect(s).toMatch(/复国$/);
      }
    }
    // 挑的是分量最重的(同一件事的两条只算一件);按先后排
    const weight = (s: string) => Math.max(...of(s).map((x) => entryWeight(x.e)));
    const least = Math.min(...brief.map(weight));
    for (const s of said) if (!brief.includes(s)) expect(weight(s), s).toBeLessThanOrEqual(least);
    const when = brief.map((s) => Math.min(...of(s).filter((x) => entryWeight(x.e) === weight(s)).map((x) => x.e.year)));
    expect([...when].sort((a, b) => a - b)).toEqual(when);
    // 一件也没有:空
    expect(rewindBrief(f.civ, 2699.9, 2700, all)).toEqual([]);
  });
});
