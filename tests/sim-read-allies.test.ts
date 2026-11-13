/**
 * 读口的盟国(SimPolity.allies)含作者下的结盟干预、推演插件用 ally 命令结的盟:生效期里两头都列,到期了不列,亡了的国不列
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_PARAMS, generateWorld, type World } from '../src/gen/world';
import { generateCiv } from '../src/gen/civ';
import { resumeCiv } from '../src/gen/civ/modules';
import { diplomacyModelOf } from '../src/gen/civ/diplomacy';
import { polityKey, type Intervention } from '../src/gen/edits';
import type { PluginNote, SimPlugin } from '../src/gen/civ/engine/plugin';
import { simRead, type SimPolity, type SimRead } from '../src/gen/civ/simRead';

const worlds = new Map<number, World>();
const world = (seed: number) => {
  let w = worlds.get(seed);
  if (!w) worlds.set(seed, (w = generateWorld({ ...DEFAULT_PARAMS, cells: 12000, seed })));
  return w;
};

type PactNote = { year: number; a: number; b: number; seen: number[][] };

/** 头一回有两国的时候让它们结盟,之后每回合记下 [年份, ...a 读到的盟国, −1, ...b 读到的盟国] */
function pact(): SimPlugin<SimRead> {
  return {
    id: 'pact',
    every: 5,
    act(turn) {
      const ps = turn.read.polities();
      const had = turn.note as unknown as PactNote | undefined;
      if (!had) {
        const alive = ps.filter((p) => p.ended === undefined && p.size > 0);
        if (alive.length < 2) return;
        const a = alive[0];
        const b = alive.find((p) => p.id !== a.id && !a.allies.includes(p.id))!;
        const note: PactNote = { year: turn.year, a: a.id, b: b.id, seen: [] };
        return { note: note as unknown as PluginNote, commands: [{ kind: 'ally', a: a.id, b: b.id }] };
      }
      const note: PactNote = { ...had, seen: [...had.seen, [turn.year, ...ps[had.a].allies, -1, ...ps[had.b].allies]] };
      return { note: note as unknown as PluginNote };
    },
  };
}

const sortedUnique = (xs: readonly number[]) => xs.every((x, i) => i === 0 || xs[i - 1] < x);

/** 盟国两头都列、编号升序不重复、不含自己、亡了的国没有盟国也不在别国的盟国里 */
function wellFormed(ps: readonly SimPolity[]) {
  for (const p of ps) {
    expect(sortedUnique(p.allies), `国 ${p.id} 的盟国`).toBe(true);
    expect(p.allies).not.toContain(p.id);
    if (p.ended !== undefined) expect(p.allies, `亡了的国 ${p.id}`).toEqual([]);
    for (const q of p.allies) {
      expect(ps[q].ended, `国 ${p.id} 的盟国 ${q} 还在`).toBeUndefined();
      expect(ps[q].allies, `${p.id} 和 ${q} 结盟是两头的`).toContain(p.id);
    }
  }
}

describe('读口的盟国含干预、插件命令结的盟', () => {
  it('插件下了 ally:下一回合起两国的盟国里都有对方', () => {
    const civ = generateCiv(world(7), { endYear: 400, plugins: [pact()] });
    const note = civ.simPlugins![0].note as unknown as PactNote;
    expect(note.year).toBeLessThan(370);
    expect(civ.interventions?.filter((v) => v.kind === 'ally' && v.plugin === 'pact').length).toBe(1);
    expect(note.seen.length).toBeGreaterThanOrEqual(5);
    for (const row of note.seen) {
      const cut = row.indexOf(-1);
      expect(row.slice(1, cut), `第 ${row[0]} 年 ${note.a} 的盟国`).toContain(note.b);
      expect(row.slice(cut + 1), `第 ${row[0]} 年 ${note.b} 的盟国`).toContain(note.a);
    }
  });

  it.each([7, 2024])('作者下的结盟:生效期里两国的盟国里都有对方(和邦交自己结的并在一起),到期以后不再列(seed %i)', (seed) => {
    const w = world(seed);
    const base = generateCiv(w, { endYear: 600 });
    const old = simRead(resumeCiv(w, base))!.polities();
    const alive = old.filter((p) => p.ended === undefined && p.size > 0 && p.founded < 580);
    const x = alive[0];
    const y = alive.find((p) => p.id !== x.id && !x.allies.includes(p.id))!;
    const order: Intervention = { kind: 'ally', a: polityKey(base, x.id), b: polityKey(base, y.id), from: 600, until: 660 };

    for (const [end, on] of [
      [620, true],
      [655, true],
      [700, false],
    ] as const) {
      const civ = generateCiv(w, { endYear: end, interventions: [order] });
      const sim = resumeCiv(w, civ);
      const ps = simRead(sim)!.polities();
      wellFormed(ps);
      const dm = diplomacyModelOf(sim)!;
      for (const [p, q] of [
        [x.id, y.id],
        [y.id, x.id],
      ]) {
        if (ps[p].ended !== undefined || ps[q].ended !== undefined) continue;
        const own = dm.alliesOf(p);
        const want = on && !own.includes(q) ? [...own, q].sort((i, j) => i - j) : own;
        expect(ps[p].allies, `第 ${end} 年 ${p} 的盟国`).toEqual(want);
      }
      expect(ps[x.id].ended === undefined && ps[y.id].ended === undefined, `第 ${end} 年两国都还在`).toBe(true);
    }
  });

  it('插件一路下 ally 命令推 3000 年:盟国两头都列、升序不重复,亡了的国不列', () => {
    const w = world(2024);
    const plugin: SimPlugin<SimRead> = {
      id: 'binder',
      every: 20,
      act(turn) {
        const ps = turn.read.polities();
        wellFormed(ps);
        const alive = ps.filter((p) => p.ended === undefined && p.size > 0);
        if (alive.length < 2) return;
        const a = alive[Math.floor(turn.rand(turn.year, 1) * alive.length)];
        const b = alive[Math.floor(turn.rand(turn.year, 2) * alive.length)];
        if (a.id === b.id) return;
        return { commands: [{ kind: 'ally', a: a.id, b: b.id }] };
      },
    };
    const civ = generateCiv(w, { plugins: [plugin] });
    expect(civ.endYear).toBe(3000);
    const pacts = civ.interventions!.filter((v) => v.kind === 'ally');
    expect(pacts.length).toBeGreaterThan(50);
    // 有盟约没到期、一方先亡了的:亡了的那国不列
    const idOf = new Map(civ.polities.map((p) => [polityKey(civ, p.id), p.id]));
    const gone = (k: string) => civ.polities[idOf.get(k) ?? -1]?.ended !== undefined;
    expect(pacts.filter((v) => gone(v.a) !== gone(v.b)).length).toBeGreaterThan(0);
    wellFormed(simRead(resumeCiv(w, civ))!.polities());
  }, 120_000);
});
