/**
 * 君主的在位表和倾向(gen/civ/rulers.ts)、扩张算账(polities.ts 的 wants):
 * 推演里"此刻在位的是谁、倾向是多少"和人物(people.ts)一位不差;倾向有高有低、游牧国家的君主更好战,越好战越常亲征、越容易开战;
 * 荒僻的州多留给部落,富庶的州多归国家;接着推(resumeCiv)和一口气推完一样(新君即位、迁都以后重新预约的扩张也算上)。
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_PARAMS, generateWorld, type World } from '../src/gen/world';
import { generateCiv, type Civ } from '../src/gen/civ';
import { cultureTerrain } from '../src/gen/civ/cultures';
import { LEANINGS, leaningEffect, reignAt, reignStart, rulerBase, rulerTags } from '../src/gen/civ/rulers';
import { resumeCiv } from '../src/gen/civ/modules';
import { OFFICIAL_KNOBS } from '../src/gen/civ/engine/knobs';

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
      // 新朝的第一位、废了幼主自立的摄政叔父(regents.ts)从即位的下一刻起"在位"(见 rulers.ts 文件头)
      const late = (x.rise !== 'heir' && x.from! > p.founded) || x.claim?.how === 'seize';
      const r = reignAt(OFFICIAL_KNOBS, base, tags[p.id], p, x.from! + (late ? 1 / 256 : 0));
      expect(r.from, `${p.name} ${x.name}`).toBe(x.from);
      expect(r.leanings, `${p.name} ${x.name}`).toEqual(x.leanings);
      expect(reignStart(r)).toBeGreaterThanOrEqual(x.from!);
      n++;
    }
    expect(n).toBeGreaterThan(100);
  });

  it('倾向:各项都在 0–100、平均五十上下、有高有低;游牧国家的君主更好战;亲征的君主好战都过 50,越好战越常亲征', () => {
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
    // 亲征 = 即位以后领兵(即位以前作为王子领过兵的不算)
    const led = rulers.filter((x) => x.commands?.some((c) => c.from >= x.from!));
    expect(led.length).toBeGreaterThan(0);
    for (const x of led) expect(x.leanings!.war, x.name).toBeGreaterThan(50);
    // 越好战越常亲征:亲征过的君主,好战的平均值比好战过 50 的君主(能亲征的那些)高。
    // 一个世界里亲征的君主只有十位上下:分 50–75、75 以上两档比亲征的比例,一档里常常只有一两位,
    // GENERATOR_VERSION 13 以后 20 个种子里有 6 个比反了;按平均值比只有 2 个比反了(那两个世界只有两位、四位君主亲征)
    const hot = rulers.filter((x) => x.leanings!.war > 50 && civ.polities[x.polity].lineage !== 'republic');
    const meanWar = (g: typeof rulers) => g.reduce((a, x) => a + x.leanings!.war, 0) / g.length;
    expect(meanWar(led)).toBeGreaterThan(meanWar(hot));
  });

  it('倾向怎么折算:开拓越高扩张门槛越低;越好战越容易开战、仗打得越久、越不肯称臣;发展还不影响推演', () => {
    const at = (l: Partial<Record<(typeof LEANINGS)[number], number>>) => leaningEffect({ expand: 50, war: 50, develop: 50, trade: 50, ...l });
    const mid = at({});
    expect(mid).toEqual({ worth: 1, coast: 1, declare: 1, war: 1, goal: 0, sue: 1, lead: 0 });
    expect(at({ expand: 90 }).worth).toBeLessThan(1);
    expect(at({ expand: 10 }).worth).toBeGreaterThan(1);
    expect(at({ war: 90 }).declare).toBeGreaterThan(1);
    expect(at({ war: 10 }).declare).toBeLessThan(1);
    expect(at({ war: 90 }).war).toBeGreaterThan(at({ war: 10 }).war);
    expect(at({ war: 90 }).sue).toBeLessThan(at({ war: 10 }).sue);
    expect(at({ trade: 90 }).coast).toBeLessThan(at({ trade: 90 }).worth);
    expect(at({ develop: 0 })).toEqual(mid);
    expect(at({ develop: 100 })).toEqual(mid);
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
    // 20 个种子里最多 0.54(种子 2024);GENERATOR_VERSION 13 以后最多 0.42(种子 7),富庶的州最少 0.73(种子 7、16)
    expect(poorOwned / poor).toBeLessThan(0.55);
    expect(richOwned / rich).toBeGreaterThan(0.7);
  });
});

describe('扩张算账 · 接着推', () => {
  const same = (w: World, full: Civ, cut: number) => {
    const head = generateCiv(w, { endYear: cut });
    const sim = resumeCiv(w, head);
    sim.run(full.endYear);
    const r = sim.result();
    expect(Array.from(r.polity), `断在第 ${cut} 年`).toEqual(Array.from(full.polity));
    expect(JSON.stringify(r.annals), `断在第 ${cut} 年`).toBe(JSON.stringify(full.annals));
  };

  it('resumeCiv 接着推:在改朝换代、新君即位的那一刻断开,和一口气推完一样;断在即位那一刻,人物表里也是新君在位', () => {
    const w = world(7, 12000);
    const full = generateCiv(w);
    // 断在一次改朝换代的那一刻、和一位君主即位的那一刻(这两刻的预约最容易漏)
    const dyn = full.annals.find((e) => e.kind === 'dynasty');
    const heir = full.people!.find((x) => x.role === 'ruler' && x.rise === 'heir' && x.from! > 1200 && x.from! < 2500);
    const cuts = [dyn?.year, heir?.from].filter((x): x is number => x !== undefined);
    expect(cuts.length).toBe(2);
    for (const cut of cuts) same(w, full, cut);
    // 断在新君即位的那一刻:推演里那一刻已经是新君在位,人物表里也是他在位(前一位到这一刻为止)
    const head = generateCiv(w, { endYear: heir!.from! });
    const now = head.people!.filter((x) => x.role === 'ruler' && x.polity === heir!.polity && x.until === undefined);
    expect(now.map((x) => [x.name, x.from])).toEqual([[heir!.name, heir!.from]]);
  });

  it('resumeCiv 接着推:迁都的下一刻按新国都重新预约扩张,断在迁都那一刻、迁都几年后都和一口气推完一样', () => {
    const w = world(7, 12000);
    const full = generateCiv(w);
    // 断在后期的一次迁都那一刻(重新预约还没发生)、几年后(迁都后重新预约的扩张多半还没到)
    const moves = full.polities.flatMap((p) => (p.capitals ?? []).slice(1).map((c) => c.year)).filter((y) => y > 2500 && y < 2990).sort((a, b) => a - b);
    expect(moves.length).toBeGreaterThan(0);
    for (const m of moves.slice(0, 2)) for (const cut of [m, m + 4]) same(w, full, cut);
  });
});
