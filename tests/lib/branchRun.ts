/**
 * 逐年推演的支线,真的推(tests/stepwise-branches-run-*.test.ts 共用;一个种子一个文件,好并行跑):
 * 推演模式的世界(作者在第 1050、1220 年下过干预)从第 1000 年起逐年推演,每 50 年一步、隔一阵子在"现在"下几条命令:
 * - 第 1 支:第 1000 年走到第 1300 年
 * - 从第 1 支第 1150 年另开第 2 支,切过去(照新的进度从第 0 年重推)走到第 1350 年
 * - 从第 2 支第 1200 年另开第 3 支,切过去走到第 1300 年
 * - 从第 3 支第 1050 年另开第 4 支(比前几支分出的都早),切过去走到第 1200 年
 * 然后存档往返一次,在几支之间来回切:每次切过去进度都和那一支走的时候一样,
 * 照它从第 0 年推出来的和当初一步步走出来的逐字段相等(就是"带着它那串命令从第 0 年一口气推到那一年")。
 * 用 RUN_CELLS 个地块的小一点的世界(推演规则一样,快一半多)。
 */
import { describe, expect, it } from 'vitest';
import type { World } from '../../src/gen/world';
import { generateCiv, type Civ } from '../../src/gen/civ';
import { playCiv, playStop, playTurn } from '../../src/gen/civ/play';
import { playFromOf, type Intervention, type PlayState, type WorldEdits } from '../../src/gen/edits';
import { makeSave, parseSave, saveText } from '../../src/gen/savefile';
import { branchList, forkBranch, startStepwise, switchBranch } from '../../src/gen/stepwise';
import { RUN_CELLS, authorPlan, orders, same, samePast, worldOf } from './stepwiseRun';

/** 一步走几年 */
const STEP = 50;

export function branchRun(seed: number) {
  describe(`支线(seed ${seed},${RUN_CELLS} 个地块)`, () => {
    it('分出三支、各下几条命令;存档往返;切回每一支 = 带它那串命令从第 0 年推到那一年,逐字段相等', () => {
      const w: World = worldOf(seed, RUN_CELLS);
      const author = authorPlan(generateCiv(w, { endYear: 1300 }), [1050, 1220]);
      expect(author.length).toBeGreaterThan(0);
      const world: WorldEdits = { names: {}, interventions: author, terrain: [] };
      const params = { interventions: author };
      /** 照当前这一支一步步走到第 to 年,走到 at 里的年份时在"现在"下几条命令(按种子和年份定的,见 orders) */
      const walk = (civ: Civ, play: PlayState, to: number, at: readonly number[]) => {
        while (play.year < to) {
          const now = play.year;
          const cmds: Intervention[] = at.includes(now) ? orders(civ, now) : [];
          const r = playTurn(w, civ, params, play, cmds, Math.min(STEP, to - now));
          expect(r.rejected, `第 ${now} 年`).toEqual([]);
          civ = r.civ;
          play = r.play;
        }
        return { civ, play };
      };
      /** 每一支走完时记下的:进度、从第几年起、一步步走出来的历史 */
      const rec = new Map<number, { play: PlayState; playFrom: number; civ: Civ }>();

      // 第 1 支:第 1000 年起演,走到第 1300 年
      let e = startStepwise(world, 1000);
      let civ = playCiv(w, params, e.play!);
      let got = walk(civ, e.play!, 1300, [1000, 1100, 1200]);
      e = { ...e, play: got.play };
      rec.set(1, { play: got.play, playFrom: 1000, civ: got.civ });
      let last = got.civ;

      /** 从当前这一支第 T 年另开一支、切过去(照新的进度从第 0 年重推:第 T 年以前和原来那一支一样),走到第 to 年 */
      const branch = (T: number, to: number, at: readonly number[]) => {
        const f = forkBranch(e, T)!;
        expect(f).not.toBeNull();
        e = switchBranch(f.edits, f.id, `第 ${f.id} 支以前`)!;
        expect(e.play!.year).toBe(T);
        expect(e.play!.commands.every((v) => v.from < T)).toBe(true);
        civ = playCiv(w, params, e.play!);
        samePast(civ, last, T, `第 ${f.id} 支分出来时`);
        got = walk(civ, e.play!, to, at);
        e = { ...e, play: got.play };
        rec.set(f.id, { play: got.play, playFrom: playFromOf(e), civ: got.civ });
        last = got.civ;
        return f.id;
      };
      expect(branch(1150, 1350, [1150, 1250])).toBe(2);
      expect(branch(1200, 1300, [1200, 1250])).toBe(3);
      expect(branch(1050, 1200, [1050, 1150])).toBe(4);

      // 几支都各下过自己的命令(分出来以后),彼此不一样
      for (const [id, T] of [[1, 1000], [2, 1150], [3, 1200], [4, 1050]]) expect(rec.get(id)!.play.commands.some((v) => v.from >= T), `第 ${id} 支`).toBe(true);
      const plays = [1, 2, 3, 4].map((id) => JSON.stringify(rec.get(id)!.play));
      expect(new Set(plays).size).toBe(4);
      // 列表:四支,当前是第 4 支;每一支完整的进度和它走完时一样
      expect(branchList(e).map((b) => [b.id, b.current])).toEqual([[1, false], [2, false], [3, false], [4, true]]);
      for (const b of branchList(e)) expect(b.play, `第 ${b.id} 支`).toEqual(rec.get(b.id)!.play);
      // 另开的几支只记和当前这一支(第 1050 年分出的第 4 支)分开以后的命令;存档多出来的不到几 KB
      for (const b of e.branches!.list) {
        expect(b.from, `第 ${b.id} 支`).toBe(1050);
        expect(b.commands, `第 ${b.id} 支`).toEqual(rec.get(b.id)!.play.commands.filter((v) => v.from >= 1050));
      }
      const { branches: _branches, ...one } = e;
      const extra = saveText(makeSave(w.params, e, 'x')).length - saveText(makeSave(w.params, one, 'x')).length;
      expect(extra).toBeLessThan(6 * 1024);

      // 存档往返:原样回来,接着用读回来的
      const r = parseSave(saveText(makeSave(w.params, e, 'x')));
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.warnings).toEqual([]);
      expect(r.save.edits.branches).toEqual(e.branches);
      expect(r.save.edits.play).toEqual(e.play);
      e = r.save.edits;

      // 来回切:每次进度、起演那年和那一支走的时候一样;推出来的(从第 0 年)和一步步走出来的逐字段相等
      const checked = new Set<number>();
      for (const id of [1, 3, 2, 4, 2, 1, 4]) {
        e = switchBranch(e, id)!;
        const want = rec.get(id)!;
        expect(e.play, `切到第 ${id} 支`).toEqual(want.play);
        expect(playFromOf(e), `切到第 ${id} 支 起演`).toBe(want.playFrom);
        expect(e.branches!.id).toBe(id);
        if (checked.has(id)) continue;
        checked.add(id);
        const again = playCiv(w, params, e.play!);
        same(again, want.civ, `切回第 ${id} 支`);
        expect(again.endYear).toBe(playStop(want.play.year));
      }
    }, 600_000);
  });
}
