/**
 * 干预(gen/civ/interventions.ts):划州、立国、迁都、不许扩张四种一起下的确定性(按内容从 civ-interventions 分出来,好并行跑):
 * 两次推演逐字节相同;fromCiv 在干预之前 / 当年 / 之后切开接着推都和一口气推完一致
 */
import { describe, expect, it } from 'vitest';
import { generateCiv } from '../src/gen/civ';
import { CivSim } from '../src/gen/civ/sim';
import { polityModelOf } from '../src/gen/civ/polities';
import { polityKey, regionKey, settlementKey, type Intervention } from '../src/gen/edits';
import {
  world,
  base,
  bytes,
  fingerprint,
  strip,
  ownedRegion,
  borderRegion,
  bigPolityCity,
  expansion,
} from './lib/interventions';

describe('干预 · 划州 / 立国 / 迁都 / 不许扩张 · 推演', () => {
  it('确定性:四种一起下,两次推演逐字节相同;fromCiv 在干预之前 / 当年 / 之后切开接着推都和一口气推完一致', () => {
    for (const seed of [7, 2024]) {
      const w = world(seed);
      const civ = base(seed);
      const { r } = ownedRegion(civ, 1500);
      const bd = borderRegion(civ, 1800);
      const mv = bigPolityCity(civ, 2000);
      const hp = expansion(civ);
      const list: Intervention[] = [
        { kind: 'halt', a: polityKey(civ, hp.p), from: hp.a, until: hp.a + 400 },
        { kind: 'found', region: regionKey(civ, r), from: 1500 },
        { kind: 'cede', a: polityKey(civ, bd.q), region: regionKey(civ, bd.r), from: bd.y, permanent: true },
        { kind: 'move', a: polityKey(civ, mv.p), city: settlementKey(civ, mv.s), from: 2000 },
      ];
      const whole = generateCiv(w, { interventions: list });
      expect(fingerprint(generateCiv(w, { interventions: list.map((v) => ({ ...v })) }))).toBe(fingerprint(whole));
      const cuts = new Set([999, 1000, 1200, 1400, 1450, 1500, 1501, bd.y, 2000, 2400, hp.a - 1, hp.a, hp.a + 400]);
      for (const cut of [...cuts].sort((x, y) => x - y)) {
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
  }, 300_000);
});
