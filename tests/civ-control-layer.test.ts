import { describe, expect, it } from 'vitest';
import { generateWorld, DEFAULT_PARAMS } from '../src/gen/world';
import { generateCiv } from '../src/gen/civ';
import { ownersAt } from '../src/gen/civ/timeline';
import { Layer } from '../src/gen/civ/types';
import { LORD_BYTE, controlAt } from '../src/gen/civ/control';
import { controlCiv, controlBase, controlTiersAt, lordsAt, lordOf } from '../src/render/civ/control';
import { controlRows } from '../src/ui/devRows';

const civ = generateCiv(generateWorld({ ...DEFAULT_PARAMS, cells: 12000, seed: 7 }));

describe('管辖图层', () => {
  it('换进民族那一层的四档:按 civ 缓存;各年的色块和那年的快照一致', () => {
    const view = controlCiv(civ);
    expect(view.cultures.map((c) => c.name)).toEqual(['直辖', '代管', '自治', '割据']);
    expect(controlCiv(civ)).toBe(view);
    expect(controlBase(view)).toBe(civ);
    expect(controlBase(civ)).toBeNull();
    for (const y of [civ.development!.controlYears![3], 1500, civ.endYear]) {
      const own = ownersAt(view, y);
      const t = controlTiersAt(civ, y);
      for (let r = 0; r < civ.regions.count; r++) expect(own.culture[r]).toBe(t[r]);
    }
  });

  it('侧栏:四档的州数加起来是在国家里的州;现在的割据,地盘里的州在快照里都是割据、归名义上的那国', () => {
    let seen = 0;
    // 这个世界(12k 地块)第 1900、2600 年有割据
    for (const y of [1500, 1900, 2600, civ.endYear]) {
      const rows = controlRows(civ, y)!;
      const snap = controlAt(civ, y)!;
      let inside = 0;
      for (let r = 0; r < snap.length; r++) if (snap[r]) inside++;
      expect(rows.tiers.map((t) => t.name)).toEqual(['直辖', '代管', '自治', '割据']);
      expect(rows.tiers.reduce((s, t) => s + t.n, 0)).toBe(inside);
      const lords = lordsAt(civ, y);
      expect(rows.lords.length).toBe(lords.length);
      const own = ownersAt(civ, civ.development!.controlYears!.filter((x) => x <= y).pop()!);
      const all = new Set<number>();
      for (const w of lords) {
        expect(w.regions[0]).toBe(w.region);
        expect(w.start).toBeLessThanOrEqual(y);
        // 割据之后到这一年没有收回过
        expect(civ.annals.some((e) => e.kind === 'reclaim' && e.a === w.p && e.region === w.region && e.year >= w.start && e.year <= y)).toBe(false);
        // 起事的州割据以后没换过国家
        for (let i = 0; i < civ.log.size; i++)
          if (civ.log.layer[i] === Layer.Polity && civ.log.region[i] === w.region && civ.log.year[i] <= y) expect(civ.log.year[i]).toBeLessThanOrEqual(Math.fround(w.start));
        for (const r of w.regions) {
          expect(snap[r]).toBe(LORD_BYTE);
          expect(own.polity[r]).toBe(w.p);
          expect(all.has(r)).toBe(false);
          all.add(r);
          expect(lordOf(civ, y, r)).toBe(w);
        }
      }
      seen += lords.length;
    }
    expect(seen).toBeGreaterThan(0);
  });
});
