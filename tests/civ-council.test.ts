/**
 * 议事(council.ts):直征、罢直征、削藩、改土归流、分封边地;结果改征收之法和分封,谈崩的地方割据或起兵自立。
 */
import { describe, expect, it } from 'vitest';
import { generateWorld, DEFAULT_PARAMS, type World } from '../src/gen/world';
import { generateCiv, type Civ } from '../src/gen/civ';
import { CivSim } from '../src/gen/civ/sim';
import { councilModelOf, councilStats } from '../src/gen/civ/council';
import { buildChronicle, type ChronicleEntry } from '../src/gen/civ/chronicle';

const worlds = new Map<number, World>();
function world(seed: number): World {
  let w = worlds.get(seed);
  if (!w) worlds.set(seed, (w = generateWorld({ ...DEFAULT_PARAMS, seed })));
  return w;
}
const civs = new Map<number, Civ>();
function civOf(seed: number): Civ {
  let c = civs.get(seed);
  if (!c) civs.set(seed, (c = generateCiv(world(seed))));
  return c;
}

function flat(list: readonly ChronicleEntry[]): ChronicleEntry[] {
  return list.flatMap((e) => [e, ...(e.children ?? [])]);
}

describe('议事', () => {
  it('两个种子都议过事:直征、分封都有,办成、搁置都有;谈崩后面紧跟着割据或自立', () => {
    const issues = [0, 0, 0, 0, 0];
    const outcomes = [0, 0, 0, 0];
    for (const seed of [7, 2024]) {
      const civ = civOf(seed);
      const s = councilStats(civ);
      expect(s.total, `seed ${seed}`).toBeGreaterThan(5);
      s.issues.forEach((n, i) => (issues[i] += n));
      s.outcomes.forEach((n, i) => (outcomes[i] += n));
      const A = civ.annals;
      A.forEach((e, i) => {
        if (e.kind !== 'council') return;
        expect(e.a, `seed ${seed} 第 ${i} 条`).toBeGreaterThanOrEqual(0);
        expect(e.region).toBeGreaterThanOrEqual(0);
        if (e.n !== 3) return;
        // 削藩谈崩 → 那处割据自立(split,cause = warlord);直征、改土归流谈崩 → 新起割据(warlord),同一刻、同一州
        const next = A[i + 1];
        expect(next.year).toBe(e.year);
        expect(next.region).toBe(e.region);
        if (e.war === 1) expect([next.kind, next.cause, next.b]).toEqual(['split', 'warlord', e.a]);
        else expect([next.kind, next.a]).toEqual(['warlord', e.a]);
      });
    }
    expect(issues[2]).toBeGreaterThan(0);
    expect(issues[4]).toBeGreaterThan(0);
    expect(outcomes[0]).toBeGreaterThan(0);
    expect(outcomes[2]).toBeGreaterThan(0);
  });

  it('编年史:写出议的什么、谁拦、成没成', () => {
    const texts = [7, 2024].flatMap((seed) =>
      flat(buildChronicle(civOf(seed)))
        .filter((e) => e.kind === 'council')
        .map((e) => e.text),
    );
    expect(texts.length).toBeGreaterThan(0);
    for (const t of texts) expect(t, t).toMatch(/直征|直接征税|分成|代收|削|改土归流|封授|分封|封给/);
    // 有人拦的写出拦的人;搁置、不许的写出没成
    expect(texts.some((t) => /力阻/.test(t))).toBe(true);
    expect(texts.some((t) => /事寝|不了了之|作罢|不许/.test(t))).toBe(true);
  });

  it('定下来的规矩:最后一次办成的直征 / 分封留在模型里', () => {
    const w = world(7);
    const sim = CivSim.fromCiv(w, generateCiv(w, { endYear: 1500 }));
    sim.run(3000);
    const res = sim.result();
    const cm = councilModelOf(sim)!;
    expect(cm).toBeDefined();
    // 每国按史事从头走一遍,和模型里的一样
    const want = new Map<number, { tax: number; fief: boolean }>();
    for (const e of res.annals) {
      if (e.kind !== 'council') continue;
      const r = want.get(e.a) ?? { tax: 0, fief: false };
      if (e.war === 0 && e.n === 0) r.tax = 0;
      if (e.war === 2 && (e.n === 0 || e.n === 1)) r.tax = e.n === 0 ? 2 : 1;
      if (e.war === 3 && e.n === 0) r.fief = false;
      if (e.war === 4 && e.n === 0) r.fief = true;
      want.set(e.a, r);
    }
    expect(want.size).toBeGreaterThan(0);
    for (const [p, r] of want) expect(cm.rules(p), `国家 ${p}`).toEqual(r);
  }, 60_000);

  it('fromCiv 接着推:在议事那一刻和之后切开,和一口气推完一样', () => {
    for (const seed of [7, 2024]) {
      const w = world(seed);
      const whole = civOf(seed);
      const A = whole.annals;
      const cuts = new Set<number>();
      // 直征办成、分封办成、谈崩各挑一次
      for (const f of [(e: (typeof A)[number]) => e.war === 2 && e.n === 0, (e: (typeof A)[number]) => e.war === 4 && e.n === 0, (e: (typeof A)[number]) => e.n === 3]) {
        const y = A.find((e) => e.kind === 'council' && e.year > 800 && f(e))?.year;
        if (y === undefined) continue;
        cuts.add(y);
        cuts.add(Math.floor(y) + 7);
      }
      expect(cuts.size, `seed ${seed}`).toBeGreaterThanOrEqual(2);
      for (const cut of cuts) {
        const sim = CivSim.fromCiv(w, generateCiv(w, { endYear: cut }));
        sim.run(whole.endYear);
        expect(JSON.stringify(sim.result().annals), `seed ${seed} 从第 ${cut} 年接着推`).toBe(JSON.stringify(A));
      }
    }
  }, 400_000);
});
