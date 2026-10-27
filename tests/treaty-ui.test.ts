/**
 * 立约与中立地的界面(卡片上的写法 ui/treatyRows.ts、约名 / 改约名、地图上的细横纹 render/civ/neutral.ts):
 * 约的稳定键能找回同一份约;改了约名,卡片、编年史都跟着变;条约卡片的大事、中立地住着谁、卒于中立地读得通;
 * 地图上这一年哪几州是中立地、横纹的覆盖算得对。
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_PARAMS, generateWorld } from '../src/gen/world';
import { generateCiv } from '../src/gen/civ';
import { treatyBook, treatyCallName, treatyName, treatyTitle, zonesAt } from '../src/gen/civ/treatyInfo';
import { applyNames, resolveKey, treatyKey } from '../src/gen/edits';
import { fullChronicle } from '../src/gen/civ/religionText';
import { diedInExile, treatyEntries, treatyPeriod, zoneOfRegionAt, zoneResidentsAt, zoneStripeCss, zonesOfAt } from '../src/ui/treatyRows';
import { neutralZones } from '../src/render/civ/neutral';
import { stripeAt } from '../src/render/civ/territory';

// 种子 31(GENERATOR_VERSION 40 的历史;种子 1–40 里三国立约、设了中立地又背约的一份也没有,分开找):
// 三国以上立约、设了中立地的一份(three),设了中立地又背约的一份(broken),有人被放逐到中立地
const world = generateWorld({ ...DEFAULT_PARAMS, seed: 31 });
const civ = generateCiv(world);
const book = treatyBook(civ);
const three = book.treaties.find((x) => x && x.parties.length >= 3 && x.zone >= 0)!;
const broken = book.treaties.find((x) => x && x.zone >= 0 && x.breaches.length > 0)!;
const exiled = (civ.people ?? []).filter((x) => x.exile);

describe('立约与中立地的界面', () => {
  it('种子 31 里有三国立约、设了中立地的约,有设了中立地又背约的约,有人被放逐到中立地', () => {
    expect(three).toBeTruthy();
    expect(broken).toBeTruthy();
    expect(exiled.length).toBeGreaterThan(0);
  });

  it('约的稳定键找得回同一份约;改约名以后卡片、编年史都用新名字,议和顺带立的约改了名也用新名字', () => {
    for (const x of book.treaties) {
      if (!x) continue;
      const k = treatyKey(civ, x.id);
      expect(k.startsWith('treaty:')).toBe(true);
      expect(resolveKey(civ, k)).toEqual({ kind: 'treaty', id: x.id });
    }
    const named = applyNames(civ, { [treatyKey(civ, broken.id)]: '弭兵之约' });
    expect(named).not.toBe(civ);
    expect(treatyName(named, broken.id)).toBe('弭兵之约');
    expect(treatyTitle(named, broken.id)).toBe('弭兵之约');
    // 没改名的照旧;原来的那份不动
    expect(treatyName(civ, broken.id)).not.toBe('弭兵之约');
    const texts = fullChronicle(named)
      .filter((e) => e.kind === 'breach')
      .map((e) => e.text)
      .join('\n');
    expect(texts).toContain('背弭兵之约');
    const peace = book.treaties.find((x) => x && x.how === 'peace');
    if (peace) {
      expect(treatyCallName(civ, peace.id)).toBe('');
      expect(treatyTitle(civ, peace.id)).toMatch(/与.+之约$/);
      const p2 = applyNames(civ, { [treatyKey(civ, peace.id)]: '城下之盟' });
      expect(treatyCallName(p2, peace.id)).toBe('城下之盟');
    }
  });

  it('条约卡片:这一期到哪年、约里的大事按先后,有立约、设中立地、背约', () => {
    const p = treatyPeriod(three, three.start + 1);
    expect(p.from).toBe(three.start);
    expect(p.until).toBe(three.start + three.term);
    expect(p.parties).toEqual(three.parties);
    const all = fullChronicle(civ);
    const es = treatyEntries(civ, three, all);
    const kinds = es.map((e) => e.kind);
    expect(kinds[0]).toBe('treaty');
    expect(kinds).toContain('neutral');
    for (let i = 1; i < es.length; i++) expect(es[i].year).toBeGreaterThanOrEqual(es[i - 1].year);
    // 背了的约:议和时划缓冲中立地、顺带立的约,头一件就是设中立地那条(写着"约若干年互不侵犯"),后面有背约
    const bs = treatyEntries(civ, broken, all).map((e) => e.kind);
    expect(bs[0]).toBe(broken.how === 'peace' ? 'neutral' : 'treaty');
    expect(bs).toContain('breach');
    for (const x of book.treaties) {
      if (!x) continue;
      for (const r of x.renewals) {
        const q = treatyPeriod(x, r.year);
        expect(q.from).toBe(r.year);
        expect(q.until).toBe(r.year + r.term);
      }
    }
  });

  it('中立地:哪国共建、这一年住着谁、卒于中立地的人对得上', () => {
    const z = book.zones[three.zone];
    const y = z.from + 1;
    expect(zoneOfRegionAt(civ, z.region, y)?.id).toBe(z.id);
    for (const p of z.founders) expect(zonesOfAt(civ, p, y).map((q) => q.id)).toContain(z.id);
    if (z.ended !== undefined) expect(zoneOfRegionAt(civ, z.region, z.ended + 1)).toBeNull();
    for (const x of exiled) {
      const zone = book.zones[x.exile!.zone];
      const mid = x.exile!.year + 0.5;
      const alive = x.died === undefined || x.died > mid;
      const open = zone.ended === undefined || zone.ended > mid;
      expect(zoneResidentsAt(civ, zone, mid).includes(x), `人物 ${x.id}`).toBe(alive && open);
      // 卒于中立地 = 中立地撤销以前去世的
      expect(diedInExile(x)).toBe(x.died !== undefined && (x.exile!.until === undefined || x.died <= x.exile!.until));
    }
    expect(zoneStripeCss([[1, 2, 3], [4, 5, 6]])).toBe('repeating-linear-gradient(180deg, rgb(1,2,3) 0px 2px, rgb(4,5,6) 2px 4px)');
  });

  it('地图:这一年哪几州是中立地(颜色是共建几国的);横纹正中盖满、两道之间不盖', () => {
    const z = book.zones[three.zone];
    const nz = neutralZones(civ, z.from + 1)!;
    expect(nz).toBeTruthy();
    const i = nz.of[z.region];
    expect(i).toBeGreaterThanOrEqual(0);
    expect(nz.colors[i].length).toBe(z.founders.length * 3);
    expect(Array.from(nz.colors[i].slice(0, 3))).toEqual(civ.polities[z.founders[0]].color);
    const shown = new Set(zonesAt(civ, z.from + 1).map((q) => q.region));
    for (let r = 0; r < nz.of.length; r++) expect(nz.of[r] >= 0).toBe(shown.has(r));
    expect(neutralZones(civ, -1)).toBeNull();
    expect(stripeAt(10, 5, 1.7, 0.1)).toEqual({ k: 2, cover: 1 });
    expect(stripeAt(12.5, 5, 1.7, 0.1).cover).toBe(0);
    const edge = stripeAt(10 + 0.85, 5, 1.7, 0.1).cover;
    expect(edge).toBeGreaterThan(0.3);
    expect(edge).toBeLessThan(0.7);
  });
});
