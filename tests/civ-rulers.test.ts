/**
 * 君主的在位表和倾向(gen/civ/rulers.ts)、扩张算账(polities.ts 的 wants):
 * 推演里"此刻在位的是谁、倾向是多少"和人物(people.ts)一位不差;倾向有高有低、游牧国家的君主更好战,越好战越常亲征;
 * 荒僻的州多留给部落,富庶的州多归国家;接着推(fromCiv)和一口气推完一样(新君即位、迁都以后重新预约的扩张也算上)。
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_PARAMS, generateWorld, type World } from '../src/gen/world';
import { generateCiv, type Civ } from '../src/gen/civ';
import { CivSim } from '../src/gen/civ/sim';
import { cultureTerrain } from '../src/gen/civ/cultures';
import { LEANINGS, reignAt, reignStart, rulerBase, rulerTags } from '../src/gen/civ/rulers';

const worlds = new Map<string, World>();
function world(seed: number, cells = DEFAULT_PARAMS.cells): World {
  const key = `${seed}|${cells}`;
  let w = worlds.get(key);
  if (!w) worlds.set(key, (w = generateWorld({ ...DEFAULT_PARAMS, cells, seed })));
  return w;
}
const civs = new Map<number, Civ>();
function civOf(seed: number): Civ {
  let c = civs.get(seed);
  if (!c) civs.set(seed, (c = generateCiv(world(seed))));
  return c;
}

describe.each([7, 2024])('君主 · seed=%i', (seed) => {
  it('推演里的在位表和人物一致:每一位即位的年份、倾向都对得上', () => {
    const civ = civOf(seed);
    const base = rulerBase(civ.seed);
    const tags = rulerTags(civ.polities, (sid) => civ.settlements[sid]?.cell ?? -1);
    let n = 0;
    for (const x of civ.people!) {
      if (x.role !== 'ruler') continue;
      const p = civ.polities[x.polity];
      // 新朝的第一位从改朝换代的下一刻起"在位"(见 rulers.ts 文件头)
      const r = reignAt(base, tags[p.id], p, x.from! + (x.rise !== 'heir' && x.from! > p.founded ? 1 / 256 : 0));
      expect(r.from, `${p.name} ${x.name}`).toBe(x.from);
      expect(r.leanings, `${p.name} ${x.name}`).toEqual(x.leanings);
      expect(reignStart(r)).toBeGreaterThanOrEqual(x.from!);
      n++;
    }
    expect(n).toBeGreaterThan(100);
  });

  it('倾向:三项都在 0–100、平均五十上下、有高有低;游牧国家的君主更好战;亲征的君主好战都过 50,越好战越常亲征', () => {
    const civ = civOf(seed);
    const rulers = civ.people!.filter((x) => x.role === 'ruler');
    for (const key of LEANINGS) {
      const v = rulers.map((x) => x.leanings![key]);
      const mean = v.reduce((a, b) => a + b, 0) / v.length;
      expect(Math.min(...v), key).toBeGreaterThanOrEqual(0);
      expect(Math.max(...v), key).toBeLessThanOrEqual(100);
      expect(mean, key).toBeGreaterThan(40);
      expect(mean, key).toBeLessThan(62);
      // 三成多以上的君主偏离寻常(低于 35 或高于 65)
      expect(v.filter((x) => x < 35 || x > 65).length / v.length, key).toBeGreaterThan(0.3);
    }
    const warOf = (nomad: boolean) => {
      const v = rulers
        .filter((x) => (civ.polities[x.polity].kind === 'nomad') === nomad && civ.polities[x.polity].kind !== 'sea' && civ.polities[x.polity].lineage !== 'republic')
        .map((x) => x.leanings!.war);
      return v.reduce((a, b) => a + b, 0) / v.length;
    };
    if (rulers.some((x) => civ.polities[x.polity].kind === 'nomad')) expect(warOf(true)).toBeGreaterThan(warOf(false));
    const led = rulers.filter((x) => x.commands?.length);
    expect(led.length).toBeGreaterThan(0);
    for (const x of led) expect(x.leanings!.war, x.name).toBeGreaterThan(50);
    // 好战 75 以上的君主亲征的比例比 50–75 的高
    const share = (lo: number, hi: number) => {
      const g = rulers.filter((x) => x.leanings!.war > lo && x.leanings!.war <= hi && civ.polities[x.polity].lineage !== 'republic');
      return g.filter((x) => x.commands?.length).length / Math.max(1, g.length);
    };
    expect(share(75, 100)).toBeGreaterThan(share(50, 75));
  });

  it('扩张算账:荒僻的州(平均宜居分低)多半留给部落,富庶的州多半归了国家', () => {
    const civ = civOf(seed);
    const T = cultureTerrain(world(seed), civ.habitat, civ.regions);
    let poor = 0;
    let poorOwned = 0;
    let rich = 0;
    let richOwned = 0;
    for (let r = 0; r < T.R; r++) {
      if (civ.culture[r] < 0) continue;
      if (T.meanSuit[r] < 5) {
        poor++;
        if (civ.polity[r] >= 0) poorOwned++;
      } else if (T.meanSuit[r] >= 12) {
        rich++;
        if (civ.polity[r] >= 0) richOwned++;
      }
    }
    expect(poor).toBeGreaterThan(20);
    // 20 个种子里最多 0.54(种子 2024)
    expect(poorOwned / poor).toBeLessThan(0.55);
    expect(richOwned / rich).toBeGreaterThan(0.7);
  });
});

describe('扩张算账 · 接着推', () => {
  const same = (w: World, full: Civ, cut: number) => {
    const head = generateCiv(w, { endYear: cut });
    const sim = CivSim.fromCiv(w, head);
    sim.run(full.endYear);
    const r = sim.result();
    expect(Array.from(r.polity), `断在第 ${cut} 年`).toEqual(Array.from(full.polity));
    expect(JSON.stringify(r.annals), `断在第 ${cut} 年`).toBe(JSON.stringify(full.annals));
  };

  it('fromCiv 接着推:在改朝换代、新君即位的那一刻断开,和一口气推完一样', () => {
    const w = world(7, 12000);
    const full = generateCiv(w);
    // 断在一次改朝换代的那一刻、和一位君主即位的那一刻(这两刻的预约最容易漏)
    const dyn = full.annals.find((e) => e.kind === 'dynasty');
    const heir = full.people!.find((x) => x.role === 'ruler' && x.rise === 'heir' && x.from! > 1200 && x.from! < 2500);
    const cuts = [dyn?.year, heir?.from].filter((x): x is number => x !== undefined);
    expect(cuts.length).toBe(2);
    for (const cut of cuts) same(w, full, cut);
  });

  it('fromCiv 接着推:迁都的下一刻按新国都重新预约扩张,断在迁都那一刻、迁都几年后都和一口气推完一样', () => {
    const w = world(9, 12000);
    const full = generateCiv(w);
    // 这个世界 2255 年前后有一次迁都,迁都后重新预约的扩张到断开时还没到:断在迁都那一刻(重新预约还没发生)、几年后
    const moves = full.polities.flatMap((p) => (p.capitals ?? []).slice(1).map((c) => c.year)).filter((y) => y > 2250 && y < 2260);
    expect(moves.length).toBeGreaterThan(0);
    for (const m of moves) for (const cut of [m, m + 4]) same(w, full, cut);
  });
});
