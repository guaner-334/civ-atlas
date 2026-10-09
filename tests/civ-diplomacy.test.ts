/**
 * 邦交(gen/civ/diplomacy.ts):称臣纳贡、结盟、背盟。
 * - 真实世界(默认参数 seed 7 / 2024):有结盟、有称臣;关系不自相矛盾(一国只有一个宗主、藩属不收藩属、藩属不结盟,
 *   盟国之间要先背盟才打仗,宗藩之间要先自立才打仗);史事里的国家当时都在
 * - relationsAt(某一年的关系)和推演里的模型一致
 * - fromCiv 接着推:在刚称臣、刚结盟、援盟的仗打到一半时切开,和一口气推完逐字节一样
 * - 确定性:同一个种子推两次,邦交史事一样
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_PARAMS, generateWorld, type World, type WorldParams } from '../src/gen/world';
import { generateCiv, type Civ } from '../src/gen/civ';
import type { Annal } from '../src/gen/civ/types';
import { CivSim } from '../src/gen/civ/sim';
import { polityAlive } from '../src/gen/civ/growth';
import { diplomacyModelOf, diplomacyStats, relationsAt } from '../src/gen/civ/diplomacy';

const worlds = new Map<string, World>();
function world(p: WorldParams): World {
  const key = JSON.stringify(p);
  let w = worlds.get(key);
  if (!w) worlds.set(key, (w = generateWorld(p)));
  return w;
}
const civs = new Map<string, Civ>();
function civOf(p: WorldParams): Civ {
  const key = JSON.stringify(p);
  let c = civs.get(key);
  if (!c) civs.set(key, (c = generateCiv(world(p))));
  return c;
}

const DIP = new Set<string>(['alliance', 'unally', 'submit', 'defect']);
const pair = (a: number, b: number) => `${Math.min(a, b)}-${Math.max(a, b)}`;

/**
 * 按史事重放关系,一条条检查不自相矛盾;返回检查过的称臣、结盟、宣战条数。
 * 关系在任一方亡国 / 被并时自动断(和推演里一样)
 */
function checkRelations(civ: Civ, tag: string) {
  const alive = (p: number, y: number) => p >= 0 && polityAlive(civ.polities[p], y);
  const liege = new Map<number, number>();
  const pacts = new Set<string>();
  const betrayed = new Set<string>();
  const defected = new Set<string>();
  const liegeOf = (p: number, y: number) => {
    const l = liege.get(p);
    return l !== undefined && alive(l, y) && alive(p, y) ? l : -1;
  };
  const allied = (a: number, b: number, y: number) => pacts.has(pair(a, b)) && alive(a, y) && alive(b, y);
  let submits = 0;
  let alliances = 0;
  let wars = 0;
  civ.annals.forEach((e: Annal, i) => {
    const at = `${tag} 第 ${i} 条 ${e.kind} 第 ${e.year} 年`;
    const y = e.year;
    if (DIP.has(e.kind)) {
      expect(alive(e.a, y), `${at}:a 在世`).toBe(true);
      expect(alive(e.b, y), `${at}:b 在世`).toBe(true);
    }
    switch (e.kind) {
      case 'submit':
        submits++;
        // 一国只有一个宗主;藩属不收藩属;有藩属的不称臣
        expect(liegeOf(e.a, y), `${at}:已经是藩属`).toBe(-1);
        expect(liegeOf(e.b, y), `${at}:宗主自己是藩属`).toBe(-1);
        expect([...liege.keys()].some((v) => liegeOf(v, y) === e.a), `${at}:称臣的国家有藩属`).toBe(false);
        liege.set(e.a, e.b);
        break;
      case 'defect':
        expect(liegeOf(e.a, y), `${at}:自立的是那个宗主的藩属`).toBe(e.b);
        liege.delete(e.a);
        defected.add(`${e.b}>${e.a}`);
        break;
      case 'alliance':
        alliances++;
        expect(allied(e.a, e.b, y), `${at}:已经结着盟`).toBe(false);
        // 藩属不另外结盟
        expect(liegeOf(e.a, y), at).toBe(-1);
        expect(liegeOf(e.b, y), at).toBe(-1);
        expect(e.foe === undefined || e.foe < 0 || alive(e.foe, y), `${at}:共御的强邻在世`).toBe(true);
        pacts.add(pair(e.a, e.b));
        break;
      case 'unally':
        expect(e.cause, at).toBeDefined();
        expect(allied(e.a, e.b, y), `${at}:断的是结着的盟`).toBe(true);
        if (e.cause === 'vassal') expect(liegeOf(e.a, y), `${at}:称臣以后盟约作废`).toBeGreaterThanOrEqual(0);
        if (e.cause === 'betray') betrayed.add(`${e.a}>${e.b}@${y}`);
        pacts.delete(pair(e.a, e.b));
        break;
      case 'war':
        wars++;
        // 盟国之间不打仗(除非刚背盟);宗主和藩属、同一宗主的藩属之间不打仗(讨伐自立的藩属除外)
        if (allied(e.a, e.b, y)) throw new Error(`${at}:盟国之间开战`);
        if (e.cause === 'betray') expect(betrayed.has(`${e.a}>${e.b}@${y}`), `${at}:背盟来攻,先记背盟`).toBe(true);
        if (e.cause === 'punish') expect(defected.has(`${e.a}>${e.b}`), `${at}:讨伐的是自立的藩属`).toBe(true);
        {
          const la = liegeOf(e.a, y);
          const lb = liegeOf(e.b, y);
          expect(la === e.b || lb === e.a || (la >= 0 && la === lb), `${at}:宗藩之间开战`).toBe(false);
        }
        break;
    }
  });
  // 这些年的关系:relationsAt 和重放的一样;盟约、宗藩都只在在世国家之间,藩属不同时是宗主,也不结盟
  for (let y = 1000; y <= civ.endYear; y += 250) {
    const r = relationsAt(civ, y);
    for (const [v, x] of r.liege) {
      expect(alive(v, y) && alive(x.liege, y), `${tag} 第 ${y} 年`).toBe(true);
      expect(r.liege.has(x.liege), `${tag} 第 ${y} 年:藩属的藩属`).toBe(false);
    }
    for (const x of r.pacts) {
      expect(alive(x.a, y) && alive(x.b, y), `${tag} 第 ${y} 年`).toBe(true);
      expect(r.liege.has(x.a) || r.liege.has(x.b), `${tag} 第 ${y} 年:藩属结着盟`).toBe(false);
    }
  }
  return { submits, alliances, wars };
}

describe('邦交:称臣纳贡、结盟、背盟', () => {
  it('默认参数 seed 7 / 2024:有结盟、有称臣;关系一条条重放都不自相矛盾', () => {
    for (const seed of [7, 2024]) {
      const civ = civOf({ ...DEFAULT_PARAMS, seed });
      const s = diplomacyStats(civ);
      const tag = `seed ${seed}`;
      // 20 个种子(1–20)里结盟 3–20 次、称臣 2–11 次,每个世界都有;有一半左右的世界有背盟
      expect(s.pacts, tag).toBeGreaterThanOrEqual(3);
      expect(s.submits, tag).toBeGreaterThanOrEqual(2);
      expect(s.submits, tag).toBeLessThanOrEqual(15);
      expect(s.pacts, tag).toBeLessThanOrEqual(25);
      // 断了的盟不多于结过的盟;自立的不多于称过臣的
      expect(s.lapses + s.abandons + s.betrayals, tag).toBeLessThanOrEqual(s.pacts);
      expect(s.defects, tag).toBeLessThanOrEqual(s.submits);
      expect(s.punishments, tag).toBeLessThanOrEqual(s.defects);
      const n = checkRelations(civ, tag);
      expect(n.submits, tag).toBe(s.submits);
    }
  }, 120_000);

  it('推演结束时的模型和 relationsAt(结束那一年)一致', () => {
    const w = world({ ...DEFAULT_PARAMS, seed: 2024 });
    const civ = civOf({ ...DEFAULT_PARAMS, seed: 2024 });
    const sim = CivSim.fromCiv(w, civ);
    const dm = diplomacyModelOf(sim)!;
    expect(dm).toBeDefined();
    const r = relationsAt(civ, civ.endYear);
    const live = civ.polities.filter((p) => p.ended === undefined).map((p) => p.id);
    for (const p of live) {
      expect(dm.liegeOf(p), `${p}`).toBe(r.liege.get(p)?.liege ?? -1);
      const allies = r.pacts.filter((x) => x.a === p || x.b === p).map((x) => (x.a === p ? x.b : x.a));
      expect(dm.alliesOf(p), `${p}`).toEqual(allies.sort((a, b) => a - b));
    }
  }, 60_000);

  it('fromCiv 接着推:在刚称臣、刚结盟、援盟的仗打到一半、藩属刚自立时切开,和一口气推完逐字节一样', () => {
    for (const seed of [7, 2024]) {
      const p = { ...DEFAULT_PARAMS, cells: 12000, seed };
      const w = world(p);
      const whole = civOf(p);
      const A = whole.annals;
      const pick = (f: (e: Annal) => boolean) => A.find((e) => f(e) && e.year > 600)?.year;
      const splits = new Set<number>();
      for (const y of [
        pick((e) => e.kind === 'submit'),
        pick((e) => e.kind === 'submit' && e.war >= 0),
        pick((e) => e.kind === 'alliance'),
        pick((e) => e.kind === 'defect'),
        pick((e) => e.kind === 'unally'),
      ])
        if (y !== undefined) splits.add(y);
      // 援盟、救藩的仗打到一半
      const join = A.find((e) => e.kind === 'war' && (e.cause === 'ally' || e.cause === 'rescue'));
      if (join) {
        const end = A.find((e) => e.kind === 'peace' && e.war === join.war)?.year ?? whole.endYear;
        splits.add(Math.floor((join.year + end) / 2));
      }
      expect(splits.size, `seed ${seed} 小世界也要有邦交`).toBeGreaterThanOrEqual(3);
      for (const split of [...splits].sort((a, b) => a - b)) {
        const half = generateCiv(w, { endYear: split });
        const sim = CivSim.fromCiv(w, half);
        sim.run(whole.endYear);
        const res = sim.result();
        const tag = `seed ${seed} 从第 ${split} 年接着推`;
        expect(JSON.stringify(res.annals), tag).toBe(JSON.stringify(whole.annals));
        expect(Buffer.from(res.polity.buffer).equals(Buffer.from(whole.polity.buffer)), tag).toBe(true);
      }
    }
  }, 300_000);
});
