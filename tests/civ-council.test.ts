/**
 * 议事(council.ts):直征、罢直征、削藩、改土归流、分封边地;收兵权、放兵权、收任免、放任免、改组(分镇)、脱离;
 * 结果改征收之法、分封、军制、官制、割据的地盘,谈崩的地方割据或起兵自立,脱离的地方转投邻国。
 */
import { describe, expect, it } from 'vitest';
import { generateWorld, DEFAULT_PARAMS, type World } from '../src/gen/world';
import { generateCiv, type Civ } from '../src/gen/civ';
import { CivSim } from '../src/gen/civ/sim';
import { councilModelOf, councilStats } from '../src/gen/civ/council';
import { buildChronicle, type ChronicleEntry } from '../src/gen/civ/story/chronicle';
import { ownersAt } from '../src/gen/civ/timeline';

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
    const issues = new Array<number>(11).fill(0);
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
        // 脱离记着想转投的邻国,别的议题没有
        expect(e.b >= 0, `seed ${seed} 第 ${i} 条`).toBe(e.war === 10);
        if (e.war === 10 && e.n === 0) {
          // 脱离转投:那州从此归邻国
          const own = ownersAt(civ, e.year + 0.01);
          expect(own.polity[e.region], `seed ${seed} 第 ${i} 条`).toBe(e.b);
        }
        if (e.n !== 3) return;
        // 削藩、改组、脱离谈崩 → 那处割据自立(split,cause = warlord);直征、改土归流、收兵权、收任免谈崩 → 新起割据(warlord),同一刻、同一州
        const next = A[i + 1];
        expect(next.year).toBe(e.year);
        if (e.war < 11) expect(next.region).toBe(e.region);
        if (e.war === 1 || e.war === 9 || e.war === 10) expect([next.kind, next.cause, next.b]).toEqual(['split', 'warlord', e.a]);
        // 改制(议立宪、废君)谈崩 → 起兵:打进国都 = 革命(reform),打不进 = 据地自立(split,cause = revolution)
        else if (e.war >= 11) expect(next.kind === 'reform' ? [next.kind, next.n, next.a] : [next.kind, next.cause, next.b]).toEqual(next.kind === 'reform' ? ['reform', 0, e.a] : ['split', 'revolution', e.a]);
        else expect([next.kind, next.a]).toEqual(['warlord', e.a]);
      });
    }
    expect(issues[2]).toBeGreaterThan(0);
    expect(issues[4]).toBeGreaterThan(0);
    // 第二批:改军制、改官制两个种子里都议过
    expect(issues[5] + issues[6]).toBeGreaterThan(0);
    expect(issues[7] + issues[8]).toBeGreaterThan(0);
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
    for (const t of texts) expect(t, t).toMatch(/直征|直接征税|分成|代收|削|改土归流|封授|分封|封给|兵权|禁军|常备军|边镇|军镇|铨选|考选|户籍|辟署|自辟|任命|自选官员|之镇|拆分|归附|改投|立宪|宪章|议事会|议会|议院|废王位|废帝制|废帝位|废汗位|王位|还政/);
    // 第二批的几种都写得出来
    expect(texts.some((t) => /兵权|禁军|常备军|边镇|军镇/.test(t))).toBe(true);
    expect(texts.some((t) => /铨选|辟署|自辟|任命|自选官员/.test(t))).toBe(true);
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
    const want = new Map<number, { tax: number; fief: boolean; army: number; office: number }>();
    for (const e of res.annals) {
      if (e.kind !== 'council') continue;
      const r = want.get(e.a) ?? { tax: 0, fief: false, army: 0, office: 0 };
      if (e.war === 0 && e.n === 0) r.tax = 0;
      if (e.war === 2 && (e.n === 0 || e.n === 1)) r.tax = e.n === 0 ? 2 : 1;
      if (e.war === 3 && e.n === 0) r.fief = false;
      if (e.war === 4 && e.n === 0) r.fief = true;
      // 收兵权 / 收任免:让了权的(−1)收回到 0,不然办成 1、妥协 0.5;放兵权 / 放任免:收着权的放回 0,不然 −1
      if (e.war === 5 && (e.n === 0 || e.n === 1)) r.army = r.army < 0 ? 0 : e.n === 0 ? 1 : 0.5;
      if (e.war === 6 && e.n === 0) r.army = r.army > 0 ? 0 : -1;
      if (e.war === 7 && (e.n === 0 || e.n === 1)) r.office = r.office < 0 ? 0 : e.n === 0 ? 1 : 0.5;
      if (e.war === 8 && e.n === 0) r.office = r.office > 0 ? 0 : -1;
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
      // 直征办成、分封办成、谈崩、收兵权 / 收任免办成、改组(分镇)办成或妥协、脱离各挑一次
      type E = (typeof A)[number];
      for (const f of [
        (e: E) => e.war === 2 && e.n === 0,
        (e: E) => e.war === 4 && e.n === 0,
        (e: E) => e.n === 3,
        (e: E) => (e.war === 5 || e.war === 7) && e.n === 0,
        (e: E) => e.war === 9 && (e.n === 0 || e.n === 1),
        (e: E) => e.war === 10,
      ]) {
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
