/**
 * 时代做法(src/gen/civ/practices.ts 的做法表):前提取发明表的档位;数表里的"做法"和事件层按同一行前提现算的一样;
 * 议事里直征、收兵权、收任免要有了户籍、常备军、文官考选才办得成;编年史头一回换说法;铁路、电报接在进新时代那条后面;
 * 朝政页还议不了的几档。
 */
import { describe, expect, it } from 'vitest';
import { generateWorld, DEFAULT_PARAMS, type World } from '../src/gen/world';
import { generateCiv, type Civ } from '../src/gen/civ';
import { councilModelOf } from '../src/gen/civ/council';
import { controlModelOf } from '../src/gen/civ/control';
import { CAP_COUNT, INVENTIONS, LEVEL_SCALE, eraLevel } from '../src/gen/civ/development';
import { ERA_COL, PRACTICES, Practice, hasPractice, practiceCards, practiceMask, practiceNeed } from '../src/gen/civ/practices';
import { farRegion, practicesAt } from '../src/gen/civ/story/practiceInfo';
import { buildChronicle, type ChronicleEntry } from '../src/gen/civ/story/chronicle';
import { developmentEntries } from '../src/gen/civ/story/developmentText';
import { polityName } from '../src/gen/civ/growth';
import { courtLocks, courtView } from '../src/ui/courtInfo';
import { resumeCiv } from '../src/gen/civ/modules';

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
const flat = (list: readonly ChronicleEntry[]) => list.flatMap((e) => [e, ...(e.children ?? [])]);

describe('时代做法', () => {
  it('做法表:前提就是发明表的档位(火药、工业两行看国都的时代);按位算得对;数表的规则由表生成', () => {
    for (let i = 0; i < PRACTICES.length; i++) {
      const row = PRACTICES[i];
      const need = practiceNeed(i as Practice);
      if ('era' in row.need) expect(need).toEqual({ col: ERA_COL, level: row.need.era });
      else {
        const name = row.need.invention;
        const inv = INVENTIONS.find((x) => x.name === name)!;
        expect(need, name).toEqual({ col: inv.cap, level: inv.level });
      }
    }
    expect(practiceNeed(Practice.Register)).toEqual({ col: 3, level: 1.8 });
    expect(practiceNeed(Practice.Army)).toEqual({ col: 4, level: 3 });
    // 一州的五种能力:行政 2、动员 3.2 → 户籍、常备军有,考选没有
    const lv = new Float64Array(2 * CAP_COUNT);
    lv.set([1, 1, 1, 2, 3.2], CAP_COUNT);
    const m = practiceMask(lv, 1, eraLevel(lv, 1));
    expect([Practice.Register, Practice.Exam, Practice.Army, Practice.Census, Practice.Rail, Practice.FiefLess].map((x) => hasPractice(m, x))).toEqual([true, false, true, false, false, false]);
    // 不是数的当作没有
    lv[CAP_COUNT + 3] = NaN;
    expect(hasPractice(practiceMask(lv, 1, NaN), Practice.Register)).toBe(false);
    const [input, card] = practiceCards();
    expect(input.input).toBe(true);
    expect(card.cols).toEqual(PRACTICES.map((r) => r.id));
  });

  it('推演里:数表的"做法"和事件层现算的一样;直征、禁军和监军、铨选和参半都是有了前提才办成的', () => {
    const seed = 7;
    const half = generateCiv(world(seed), { endYear: 1500 });
    const sim = resumeCiv(world(seed), half);
    const cm = controlModelOf(sim)!;
    const council = councilModelOf(sim)!;
    const checked = [0, 0, 0];
    const record = sim.record.bind(sim);
    sim.record = (kind, f = {}) => {
      if (kind === 'council' && f.a !== undefined && (f.n === 0 || f.n === 1)) {
        const p = f.a;
        const m = cm.practices(p, sim.now);
        const r = council.rules(p);
        const tag = `第 ${sim.now} 年 国家 ${p} 议题 ${f.war} 结果 ${f.n}`;
        if (f.war === 2 && r.tax === 2) {
          expect(hasPractice(m, Practice.Register), tag).toBe(true);
          checked[0]++;
        }
        if (f.war === 5 && r.army > 0) {
          expect(hasPractice(m, Practice.Army), tag).toBe(true);
          checked[1]++;
        }
        if (f.war === 7 && r.office > 0) {
          expect(hasPractice(m, Practice.Exam), tag).toBe(true);
          checked[2]++;
        }
      }
      record(kind, f);
    };
    sim.run(3000);
    // 三样都碰上过
    expect(checked.every((n) => n > 0), JSON.stringify(checked)).toBe(true);
    // 数表"做法"(这一年年初按国都能力算的)和现算的一样(这一年迁过都的不比)
    const table = cm.eng.get('做法');
    const W = PRACTICES.length;
    let n = 0;
    for (let p = 0; p < cm.pm.polities.length; p++) {
      if (!(cm.pm.size[p] > 0)) continue;
      const P = cm.pm.polities[p];
      if ((P.capitals ?? []).some((c) => c.year > 2999)) continue;
      const m = cm.practices(p, sim.now);
      for (let i = 0; i < W; i++) expect(table[p * W + i], `国家 ${p} 第 ${i} 样`).toBe(hasPractice(m, i as Practice) ? 1 : 0);
      n++;
    }
    expect(n).toBeGreaterThan(5);
  }, 120_000);

  it('编年史:一国头一回直征、收兵权、收任免办成换个说法,以后照旧;不另加条目', () => {
    let firsts = 0;
    for (const seed of [7, 2024]) {
      const civ = civOf(seed);
      const entries = flat(buildChronicle(civ));
      const text = new Map(entries.filter((e) => e.kind === 'council').map((e) => [e.id, e.text]));
      const seen = new Set<string>();
      civ.annals.forEach((e, i) => {
        if (e.kind !== 'council' || e.n !== 0 || ![2, 5, 7].includes(e.war)) return;
        const t = text.get(i);
        if (!t) return;
        const fresh = /编定户籍|始置常备之军|始行考选/.test(t);
        // 罢边镇、收回辟署不算
        if (/罢边镇|边境军镇|辟署|自选官员/.test(t)) return expect(fresh).toBe(false);
        const key = `${e.a}:${e.war}`;
        expect(fresh, `${seed} ${t}`).toBe(!seen.has(key));
        if (fresh) firsts++;
        seen.add(key);
      });
    }
    expect(firsts).toBeGreaterThan(3);
  }, 120_000);

  it('铁路、电报:接在这国有了以后头一条进新时代的后面,只写一回;离国都最远的州', () => {
    const civ = civOf(7);
    const dev = civ.development!;
    // 挑第 3000 年州最多的国家,把它国都那州从第 2500 年起的运输、信息改到铁路、电报那一档(只改快照,看编年史怎么写)
    const P = civ.polities.find((q) => polityName(q, 3000) === '埃维里亚帝国')!;
    const enters = dev.events.filter((e) => e.kind === 'enter' && e.polity === P.id && e.year >= 2500);
    const snaps = dev.snaps.map((s, k) => {
      if (dev.snapYears[k] < 2500) return s;
      const out = s.slice();
      for (let r = 0; r < civ.regions.count; r++) {
        out[r * CAP_COUNT + 1] = Math.max(out[r * CAP_COUNT + 1], Math.ceil(5.5 * LEVEL_SCALE));
        out[r * CAP_COUNT + 2] = Math.max(out[r * CAP_COUNT + 2], Math.ceil(5.7 * LEVEL_SCALE));
      }
      return out;
    });
    const fake: Civ = { ...civ, development: { ...dev, snaps } };
    expect(hasPractice(practicesAt(fake, P.id, 2600)!, Practice.Rail)).toBe(true);
    expect(hasPractice(practicesAt(civ, P.id, 2600)!, Practice.Rail)).toBe(false);
    const far = farRegion(civ, P.id, 2600);
    expect(far).toBeGreaterThanOrEqual(0);
    const lines = developmentEntries(fake).filter((e) => e.polities.includes(P.id) && /铁路|电报/.test(e.text));
    if (!enters.length) return expect(lines).toEqual([]);
    expect(lines.length).toBe(1);
    expect(lines[0].text).toMatch(/始入.+时代(,为天下之先)?,铁路(成|建成).+,电报(通|接通)/);
    expect(lines[0].year).toBeGreaterThanOrEqual(2500);
    // 没改过的照旧
    expect(developmentEntries(civ).some((e) => /铁路|电报/.test(e.text))).toBe(false);
  }, 120_000);

  it('朝政页:还没有常备军、文官考选时,监军禁军、参半铨选画斜纹,下面一句写要等什么;都有了就不画', () => {
    const civ = civOf(7);
    const P = civ.polities.find((q) => polityName(q, 3000) === '博戈维纳王国')!;
    const at = (y: number) => courtLocks(civ, P.id, y, courtView(civ, P.id, y).rules);
    expect(at(1850)).toEqual({
      tax: [],
      army: [2, 3],
      office: [2, 3],
      note: '禁军、监军要等国中有了常备军；铨选要等国中有了文官考选（斜纹的那几档现在还议不了）',
    });
    expect(at(3000)).toEqual({ tax: [], army: [], office: [], note: '' });
    // 只画比现在那档高的
    const l = courtLocks(civ, P.id, 1850, { tax: 0, army: 0.5, office: -1 });
    expect([l.army, l.office]).toEqual([[3], [2, 3]]);
    expect(l.note).toMatch(/^禁军要等国中有了常备军；/);
  }, 120_000);
});
