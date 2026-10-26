/**
 * 逐年推演里从某一年重新演绎(gen/stepwise.ts 的 rewindStepwise;界面在 src/ui/Stepwise.tsx、StepwiseDialogs.tsx):
 * seed 7 推演模式第 2650 年起,照默认推进设置(一步一年、每 25 年停一下)演绎到第 2700 年,
 * 中间加两条干预(第 2660 年大霄王朝禁止分裂、第 2680 年大霄王朝向克拉尔汗国宣战);倒回第 2675 年重新演绎:
 * - 第 2675 年以后加的那条不要了,以前的那条还在;进度回到第 2675 年年初
 * - 倒回以后的历史和"带着留下的干预从第 0 年推到那一年"逐字段相等,第 2675 年以前和倒回之前一样
 * - 接着一步步演绎到第 2700 年:和带着同样干预从第 0 年一口气推完逐字段相等;不要了的那条没有生效
 * - 弹窗里"不要了的历史"列的几件(短句)
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_PARAMS, generateWorld } from '../src/gen/world';
import { generateCiv, type Civ } from '../src/gen/civ';
import { fullChronicle } from '../src/gen/civ/religionText';
import { polityName } from '../src/gen/civ/growth';
import { playCiv, playStop, playTurn } from '../src/gen/civ/play';
import { advanceOf, playFromOf, polityKey, type Intervention, type PlayState, type WorldEdits } from '../src/gen/edits';
import { rewindStepwise, startStepwise } from '../src/gen/stepwise';
import { nextStep, rewindBrief } from '../src/ui/stepwisePlan';
import { same, samePast } from './lib/stepwiseRun';

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
    const name = (c: Civ, id: number, y: number) => polityName(c.polities[id], y);
    first = walk(playCiv(world, {}, edits0.play!), edits0.play!, 2700, (c, now) => {
      const find = (s: string) => c.polities.find((p) => p.ended === undefined && name(c, p.id, now - 0.5).includes(s));
      if (now === 2660) {
        const xiao = find('大霄');
        expect(xiao).toBeTruthy();
        kept = { kind: 'unity', a: polityKey(c, xiao!.id), from: 2660 };
        return [kept];
      }
      if (now === 2680) {
        const xiao = find('大霄');
        const kang = find('克拉尔');
        expect(xiao && kang).toBeTruthy();
        gone = { kind: 'declare', a: polityKey(c, xiao!.id), b: polityKey(c, kang!.id), from: 2680 };
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
    const brief = rewindBrief(f.civ, 2667, 2700, fullChronicle(f.civ));
    // 大霄王朝伐克拉尔汗国、有鹰代有桂、纳西亚王国讨平苏尔斯坦国(GENERATOR_VERSION 39 的历史)
    expect(brief).toEqual(['大霄伐克拉尔', '有鹰代有桂', '纳西亚王国讨平苏尔斯坦国']);
    // 一件也没有:空
    expect(rewindBrief(f.civ, 2699.9, 2700, fullChronicle(f.civ))).toEqual([]);
  });
});
