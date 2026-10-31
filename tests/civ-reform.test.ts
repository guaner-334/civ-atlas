/**
 * 改制(reform.ts):立宪、废君立共和、革命、政变、复辟、还政。
 * 每件改制在国家表里开一段(Polity.dynasties)、国号只在君主没了 / 回来了的时候变、旗跟着换、编年史写得出来;
 * 接着推(fromCiv)在改制那一刻以后切开,和一口气推完一样。例子按条件现找(历史重排以后国家会变)。
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_PARAMS, generateWorld, type World } from '../src/gen/world';
import { continueCiv, generateCiv, type Civ } from '../src/gen/civ';
import { packValue, unpackValue } from '../src/gen/snapshot';
import type { Annal } from '../src/gen/civ/types';
import { dynastyIndexAt, polityName } from '../src/gen/civ/growth';
import { Issue, Outcome, REFORM_COUP, REFORM_RESTORE, REFORM_REVOLUTION } from '../src/gen/civ/councilRules';
import { lineageAt, opensSeg, regimeAt } from '../src/gen/civ/regime';
import { polityFormAt } from '../src/gen/civ/polityForm';
import { buildChronicle, type ChronicleEntry } from '../src/gen/civ/chronicle';
import { evLabel, evType } from '../src/ui/timelineLayout';
import { flagAt, flagBook } from '../src/gen/civ/flags';
import { flagNote } from '../src/gen/civ/flagText';

// 种子 2 是 GENERATOR_VERSION 56 以后补的(以前是 13):滚雪球以后复辟少见了,种子 1–13、2024 里只有 2 号有
const SEEDS = [7, 2, 2024];
const worlds = new Map<number, World>();
const world = (seed: number) => {
  let w = worlds.get(seed);
  if (!w) worlds.set(seed, (w = generateWorld({ ...DEFAULT_PARAMS, seed })));
  return w;
};
const civs = new Map<number, Civ>();
const civOf = (seed: number) => {
  let c = civs.get(seed);
  if (!c) civs.set(seed, (c = generateCiv(world(seed))));
  return c;
};
const EPS = 1 / 512;
const flat = (es: ChronicleEntry[]) => es.flatMap((e) => [e, ...(e.children ?? [])]);

/** 各种子开了一段的改制史事 */
const opened = (civ: Civ) => civ.annals.filter(opensSeg);

describe('改制', () => {
  it('几个种子里改制的几种都有:废君或革命改共和、政变、复辟', () => {
    const all = SEEDS.flatMap((s) => civOf(s).annals);
    const has = (f: (e: Annal) => boolean) => all.some(f);
    expect(has((e) => e.kind === 'council' && e.war === Issue.Abolish && e.n === Outcome.Done) || has((e) => e.kind === 'reform' && e.n === REFORM_REVOLUTION)).toBe(true);
    expect(has((e) => e.kind === 'reform' && e.n === REFORM_RESTORE)).toBe(true);
    expect(has((e) => e.kind === 'council' && e.war >= Issue.Charter)).toBe(true);
  }, 120_000);

  it('每件改制开一段:共和、军政府、复辟;国号只在君主没了 / 回来了的时候变', () => {
    let n = 0;
    for (const seed of SEEDS) {
      const civ = civOf(seed);
      for (const e of opened(civ)) {
        const P = civ.polities[e.a];
        const tag = `seed ${seed} ${P.name} 第 ${e.year} 年`;
        const i = dynastyIndexAt(P, e.year);
        expect(P.dynasties![i].year, tag).toBe(e.year);
        const before = polityName(P, e.year - EPS);
        const after = polityName(P, e.year);
        const was = regimeAt(P, e.year - EPS);
        const now = regimeAt(P, e.year);
        if (e.kind === 'council') {
          // 废君立共和 / 还政:改成共和
          expect(now, tag).toBe('republic');
          if (e.war === Issue.Abolish) {
            expect(was, tag).toBe('crown');
            expect(after, tag).toMatch(/共和国$/);
            expect(after, tag).not.toBe(before);
          } else expect([was, after], tag).toEqual(['junta', before]);
        } else if (e.n === REFORM_REVOLUTION) {
          expect([was, now], tag).toEqual(['crown', 'republic']);
          expect(after, tag).toMatch(/共和国$/);
          // 紧跟在议立宪 / 废君谈崩那一条后面
          const c = civ.annals[civ.annals.indexOf(e) - 1];
          expect([c.kind, c.n, c.a], tag).toEqual(['council', Outcome.Break, e.a]);
        } else if (e.n === REFORM_COUP) {
          // 政变:国号不变
          expect([was, now, after], tag).toEqual(['republic', 'junta', before]);
        } else {
          // 复辟:有君主了;迎回旧王室的用回改制前的国号
          expect(now, tag).toBe('crown');
          expect(lineageAt(P, e.year), tag).not.toBe('republic');
          if (e.b >= 0) {
            const k = P.dynasties!.findIndex((d, j) => j > e.b && d.regime);
            expect(after, tag).toBe(polityName(P, P.dynasties![k].year - EPS));
            expect(P.dynasties![i].house, tag).toBe(e.b);
          }
        }
        // 政体名跟着变(立宪、复辟按当时的制度重推,不一定变)
        const form = polityFormAt(civ, e.a, e.year)!.name;
        if (now === 'junta') expect(form, tag).toBe('军政府');
        if (now === 'republic' && P.lineage !== 'republic') expect(form, tag).toMatch(/共和国$/);
        n++;
      }
    }
    expect(n).toBeGreaterThan(3);
  }, 120_000);

  it('旗:废君、革命换一面(西幻共和国的样式、不用王冠和剑;东方方旗、纹样),政变不换,复辟迎回旧王室用回改制前那面', () => {
    for (const seed of SEEDS) {
      const civ = civOf(seed);
      const book = flagBook(world(seed), civ);
      for (const e of opened(civ)) {
        const P = civ.polities[e.a];
        const tag = `seed ${seed} ${P.name} 第 ${e.year} 年`;
        const eras = book.eras[e.a];
        const was = flagAt(eras, e.year - EPS);
        const now = flagAt(eras, e.year);
        expect(eras.length, tag).toBe(P.dynasties!.length);
        expect(now.year, tag).toBe(e.year);
        expect(flagNote(now, civ, book, e.a), tag).toMatch(/改制|政变|还政|复辟|共和/);
        const regime = regimeAt(P, e.year);
        if (regime === 'junta' || (regime === 'republic' && regimeAt(P, e.year - EPS) === 'junta')) {
          expect(now.why.reform, tag).toBe('keep');
          expect(now.spec, tag).toEqual(was.spec);
        } else if (regime === 'republic') {
          expect(now.why.reform, tag).toBe('republic');
          if (now.spec.mark) expect([now.spec.shape, ['long', 'feng', 'baihu', 'gui', 'hu', 'yao', 'bifang', 'taotie'].includes(now.spec.mark)], tag).toEqual(['rect', false]);
          else expect(['crown', 'sword', 'tamga']).not.toContain(now.spec.charge?.sym);
        } else if (e.b >= 0) {
          expect(now.why.reform, tag).toBe('restore');
          expect(now.spec, tag).toEqual(eras[now.why.prior!].spec);
          expect(P.dynasties![now.why.prior! + 1].regime, tag).toBeTruthy();
        }
      }
    }
  }, 120_000);

  it('编年史:立宪、改制、复辟是蓝的(改朝那一类),革命、政变是红的(战争那一类);革命把谈崩的议事并进来', () => {
    let n = 0;
    for (const seed of SEEDS) {
      const civ = civOf(seed);
      const es = flat(buildChronicle(civ));
      for (const x of es) {
        const label = evLabel(x);
        if (!['立宪', '改制', '革命', '政变', '复辟'].includes(label)) continue;
        n++;
        expect(evType(x), x.text).toBe(label === '革命' || label === '政变' ? 'war' : 'dynasty');
        expect(x.text.length, x.text).toBeGreaterThan(10);
        if (label === '革命') expect(x.text, x.text).toMatch(/不成;/);
        if (label === '改制' && x.text.includes('议废')) expect(x.text).toMatch(/国号改称.+共和国$/);
        if (label === '复辟') expect(x.text).toMatch(/(复称|改称)/);
      }
      // 并进革命的那条议事不再单列
      const ids = new Set(es.map((x) => x.id));
      civ.annals.forEach((e, i) => {
        if (e.kind === 'reform' && e.n === REFORM_REVOLUTION) expect(ids.has(i - 1), `seed ${seed} 第 ${e.year} 年`).toBe(false);
      });
    }
    expect(n).toBeGreaterThan(3);
  }, 120_000);

  it('接着推:在改制那一刻以后切开、存档读回、接着推,和一口气推完一样', () => {
    for (const seed of [7, 13]) {
      const w = world(seed);
      const full = civOf(seed);
      const e = full.annals.find((x) => x.kind === 'reform');
      expect(e, `seed ${seed}`).toBeTruthy();
      const cut = Math.floor(e!.year) + 1;
      const a = generateCiv(w, { endYear: cut });
      const b = continueCiv(w, unpackValue(packValue(a)) as Civ, { endYear: full.endYear });
      expect(b.annals, `seed ${seed} 史事`).toEqual(full.annals);
      expect(b.polities.map((p) => p.dynasties ?? null), `seed ${seed} 历朝`).toEqual(full.polities.map((p) => p.dynasties ?? null));
    }
  }, 240_000);
});
