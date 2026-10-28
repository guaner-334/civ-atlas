/**
 * 干预(阶段 4,gen/civ/interventions.ts):带着干预从第 0 年整段重推。按内容分在几个文件里,好分到几台机器上同时跑:
 * 这里是不许灭和确定性(种子 7、3);数据格式和结盟、宣战、禁止分裂在 civ-interventions-war,
 * 划州、立国、迁都、不许扩张在 civ-interventions-land,四种一起下的确定性在 civ-interventions-land-resume;共用的准备代码在 lib/interventions.ts
 * - 干预年份之前的日志、史事、国家表、城镇表和不干预时逐字节一致
 * - 不许灭:原本亡于战争的国家到第 3000 年仍在;保护到某一年的,那之前不亡
 * - 确定性:同样的干预两次推演逐字节相同;fromCiv 接着推(切在干预之前 / 之后)和一口气推完一致
 * - 改名按稳定键照样套得上;键指不到时不报错
 */
import { describe, expect, it } from 'vitest';
import { generateCiv } from '../src/gen/civ';
import { CivSim } from '../src/gen/civ/sim';
import { polityModelOf } from '../src/gen/civ/polities';
import { InterventionModel } from '../src/gen/civ/interventions';
import { buildChronicle } from '../src/gen/civ/chronicle';
import { polityName } from '../src/gen/civ/growth';
import { applyNames, polityKey, type Intervention } from '../src/gen/edits';
import {
  world,
  base,
  bytes,
  logBefore,
  annalsBefore,
  fingerprint,
  strip,
  fallenPolity,
  FALL_SEEDS,
  rivals,
  idOf,
} from './lib/interventions';

describe('干预 · 推演', () => {
  it('没有干预时和原来一样;干预年份之前的日志、史事、国家表、城镇表和不干预时逐字节一致', () => {
    for (const seed of FALL_SEEDS) {
      const w = world(seed);
      const civ = base(seed);
      expect(generateCiv(w, { interventions: [] }).interventions).toBeUndefined();
      const { p, from } = fallenPolity(civ);
      const [a, b, allyFrom] = rivals(civ);
      const list: Intervention[] = [
        { kind: 'protect', a: polityKey(civ, p.id), from },
        { kind: 'ally', a: polityKey(civ, a), b: polityKey(civ, b), from: allyFrom },
      ];
      for (const v of list) {
        const y = v.from;
        const c = generateCiv(w, { interventions: [v] });
        expect(c.interventions).toEqual([v]);
        // 整段重推:y 年之前的史事、日志和不干预时逐字节一致
        const la = logBefore(c, y);
        const lb = logBefore(civ, y);
        expect(la.n, `seed ${seed} ${v.kind}:日志条数`).toBe(lb.n);
        la.parts.forEach((x, i) => expect(x.equals(lb.parts[i]), `seed ${seed} ${v.kind}:日志`).toBe(true));
        expect(annalsBefore(c, y), `seed ${seed} ${v.kind}:史事`).toBe(annalsBefore(civ, y));
        // 推到干预那一刻之前为止:整张国家表、城镇表、检查点、归属都一样
        const cut = y - 1 / 256;
        const x0 = generateCiv(w, { endYear: cut });
        const x1 = generateCiv(w, { endYear: cut, interventions: [v] });
        expect(JSON.stringify(x1.polities), `seed ${seed} ${v.kind}:国家表`).toBe(JSON.stringify(x0.polities));
        expect(JSON.stringify(x1.settlements), `seed ${seed} ${v.kind}:城镇表`).toBe(JSON.stringify(x0.settlements));
        expect(bytes(x1.polity).equals(bytes(x0.polity))).toBe(true);
        expect(x1.checkpoints.length).toBe(x0.checkpoints.length);
        x1.checkpoints.forEach((k, i) => expect(bytes(k.polity).equals(bytes(x0.checkpoints[i].polity))).toBe(true));
        // 干预确实改变了之后的历史
        expect(JSON.stringify(c.annals)).not.toBe(JSON.stringify(civ.annals));
      }
    }
  }, 120_000);

  it('不许灭:原本亡于战争的国家(seed 7、3 各一个)加上后到第 3000 年仍在;编年史里记一条干预', () => {
    for (const seed of FALL_SEEDS) {
      const civ = base(seed);
      const { p, from } = fallenPolity(civ);
      const key = polityKey(civ, p.id);
      const c = generateCiv(world(seed), { interventions: [{ kind: 'protect', a: key, from }] });
      const id = idOf(c, key);
      expect(id, `seed ${seed}:${polityName(p, p.ended! - 1)} 还在新历史里`).toBeGreaterThanOrEqual(0);
      const q = c.polities[id];
      expect(q.ended, `seed ${seed}:${polityName(p, p.ended! - 1)}(原本亡于第 ${Math.floor(p.ended!)} 年)到第 3000 年仍在`).toBeUndefined();
      expect([...c.polity].filter((x) => x === id).length).toBeGreaterThan(0);
      expect(c.annals.some((e) => (e.kind === 'fall' && e.a === id) || (e.kind === 'merge' && e.b === id))).toBe(false);
      const iv = buildChronicle(c).filter((e) => e.kind === 'intervene');
      expect(iv.length).toBe(1);
      expect(iv[0].text).toMatch(/^【干预】.+自此不亡$/);
      expect(Math.floor(iv[0].year)).toBe(from);
      expect(iv[0].importance).toBe(3);
    }
  }, 120_000);

  it('保护到某一年:那之前不亡;之后照常(亡也亡在截止年份以后);编年史写"自此不亡,至第 N 年"', () => {
    for (const seed of FALL_SEEDS) {
      const civ = base(seed);
      const { p, from } = fallenPolity(civ);
      const key = polityKey(civ, p.id);
      const until = Math.floor(p.ended!) + 100;
      const v: Intervention = { kind: 'protect', a: key, from, until };
      // 做决定时现查:from 起护着,until 那一刻起不再护着
      const im = new InterventionModel([v], seed);
      im.pm = { polities: civ.polities, settlements: civ.settlements, terrain: { regions: civ.regions } } as never;
      expect([from - 0.5, from, until - 0.01, until, until + 50].map((t) => im.protects(p.id, t))).toEqual([false, true, true, false, false]);
      const c = generateCiv(world(seed), { interventions: [v] });
      const id = idOf(c, key);
      expect(id).toBeGreaterThanOrEqual(0);
      const q = c.polities[id];
      expect(q.ended === undefined || q.ended >= until, `seed ${seed}:到第 ${until} 年之前不亡(新历史亡于 ${q.ended})`).toBe(true);
      expect(c.annals.some((e) => e.year < until && ((e.kind === 'fall' && e.a === id) || (e.kind === 'merge' && e.b === id)))).toBe(false);
      const iv = buildChronicle(c).filter((e) => e.kind === 'intervene');
      expect(iv[0].text).toMatch(new RegExp(`^【干预】.+自此不亡,至第 ${until} 年$`));
      // 年份之前和不干预时逐字节一致
      expect(annalsBefore(c, from)).toBe(annalsBefore(civ, from));
    }
  }, 120_000);

  it('确定性:同样的干预两次推演逐字节相同;fromCiv 接着推(切在干预之前 / 之后)和一口气推完一致', () => {
    for (const seed of FALL_SEEDS) {
      const w = world(seed);
      const civ = base(seed);
      const { p, from } = fallenPolity(civ);
      const [a, b, allyFrom] = rivals(civ);
      const list: Intervention[] = [
        { kind: 'ally', a: polityKey(civ, a), b: polityKey(civ, b), from: allyFrom, until: 2400 },
        { kind: 'protect', a: polityKey(civ, p.id), from },
        { kind: 'declare', a: polityKey(civ, b), b: polityKey(civ, a), from: 2500 },
      ];
      const whole = generateCiv(w, { interventions: list });
      expect(fingerprint(generateCiv(w, { interventions: list.map((v) => ({ ...v })) }))).toBe(fingerprint(whole));
      for (const cut of [allyFrom - 1, allyFrom, Math.floor((from + allyFrom) / 2), 2450, 2500, 2700]) {
        const half = generateCiv(w, { endYear: cut, interventions: list });
        const sim = CivSim.fromCiv(w, half);
        sim.run(whole.endYear);
        const res = sim.result();
        const tag = `seed ${seed} 从第 ${cut} 年接着推`;
        expect(res.log.size, tag).toBe(whole.log.size);
        for (const k of ['year', 'region', 'layer', 'value', 'cause'] as const) {
          expect(bytes(res.log[k]).equals(bytes(whole.log[k].subarray(0, whole.log.size))), `${tag}:日志 ${k}`).toBe(true);
        }
        expect(JSON.stringify(res.annals), `${tag}:史事`).toBe(JSON.stringify(whole.annals));
        const m = polityModelOf(sim)!;
        expect(JSON.stringify(strip(m.polities)), `${tag}:国家表`).toBe(JSON.stringify(strip(whole.polities)));
        expect(JSON.stringify(strip(m.settlements)), `${tag}:城镇表`).toBe(JSON.stringify(strip(whole.settlements)));
      }
    }
  }, 240_000);

  it('改名按稳定键照样套得上;键指不到(新历史里没有这国)时不报错', () => {
    const seed = 7;
    const civ = base(seed);
    const { p, from } = fallenPolity(civ);
    const key = polityKey(civ, p.id);
    const c = generateCiv(world(seed), { interventions: [{ kind: 'protect', a: key, from }] });
    // 新历史里没有的国家:原来在 from 以后才立的、新历史里键指不到的
    const lost = civ.polities.map((q) => polityKey(civ, q.id)).filter((k) => idOf(c, k) < 0);
    const names: Record<string, string> = { [key]: '饕餮', 'polity:r99999#0': '不存在', ...(lost[0] ? { [lost[0]]: '失落' } : {}) };
    const named = applyNames(c, names);
    const id = idOf(c, key);
    expect(named.polities[id].name).toBe('饕餮');
    // 东方改朝换代以后国号换成新朝的(GENERATOR_VERSION 22 种子 7 这国后来改了朝),看改朝以前的
    const renamed = named.polities[id];
    expect(polityName(renamed, Math.min(named.endYear, (renamed.dynasties?.[1]?.year ?? Infinity) - 1))).toContain('饕餮');
    expect(named.polities.some((q) => q.name === '失落' || q.name === '不存在')).toBe(false);
    // 编年史里的干预条目也用新名字
    expect(buildChronicle(named).find((e) => e.kind === 'intervene')!.text).toContain('饕餮');
    // 干预里的键指不到:不报错,不记干预
    const none = generateCiv(world(seed), { interventions: [{ kind: 'protect', a: 'polity:r99999#0', from: 1000 }] });
    expect(none.annals.some((e) => e.kind === 'intervene')).toBe(false);
    expect(fingerprint(none)).toBe(fingerprint(civ));
  }, 120_000);
});
