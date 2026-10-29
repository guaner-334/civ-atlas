/**
 * 信仰(gen/civ/religion.ts,推演里每 5 年算一步):编号、日志、检查点前后一致;大事、国教说得通;
 * 推演里逐步算的和推完照历史再算一遍一样(带干预、地形大事、结束年份不在整步上),推演里问得到各州信仰、各国国教;
 * 编年史里的宗教大事(religionText.ts)写得干净、编号不和史事撞;侧栏的信仰列表排得对;
 * 改名(教名、民族改名带着民间信仰改)、搜索、信仰图层、选中信仰时地图上圈哪座城。
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_PARAMS, generateWorld, type World } from '../src/gen/world';
import { generateCiv, type Civ } from '../src/gen/civ';
import { CivSim } from '../src/gen/civ/sim';
import { upheavalSteps } from '../src/gen/civ/upheaval';
import { polityAlive } from '../src/gen/civ/growth';
import { ownersAt } from '../src/gen/civ/timeline';
import { buildChronicle, chronicleDocument, reignEntries } from '../src/gen/civ/chronicle';
import { GREAT_COLORS, buildReligion, faithAt, faithCounts, faithFromScratch, faithRoot, faithSimOf, stateFaithAt, statesOfFaith } from '../src/gen/civ/religion';
import { FOLK_ROW_NAME, faithEntries, faithHistory, faithRows, fullChronicle } from '../src/gen/civ/religionText';
import { applyNames, cultureKey, faithKey, polityKey, regionKey, type Intervention } from '../src/gen/edits';
import { searchCiv } from '../src/ui/searchIndex';
import { layerDef, layerOf } from '../src/ui/mapLayers';
import { developmentEntries } from '../src/gen/civ/developmentText';
import { tradeEntries } from '../src/gen/civ/tradeText';
import { faithFocusOf, selectionOnMap } from '../src/ui/faithSelection';
import { getCivShow, pickChronicleEntry, setCivShow } from '../src/ui/civView';
import { sameInBoth } from '../src/ui/assistantStore';
import { faithLegendRows } from '../src/render/export';

const worlds = new Map<number, World>();
function world(seed: number): World {
  let w = worlds.get(seed);
  if (!w) worlds.set(seed, (w = generateWorld({ ...DEFAULT_PARAMS, cells: 12000, seed })));
  return w;
}
const civs = new Map<number, Civ>();
function civOf(seed: number): Civ {
  let c = civs.get(seed);
  if (!c) civs.set(seed, (c = generateCiv(world(seed))));
  return c;
}

const CLEAN = /undefined|NaN|null|\[object/;

describe.each([7, 2024])('信仰 · seed=%i', (seed) => {
  it('编号就是下标:先是推演前就有的各族的民间信仰(按民族编号),再按出现先后排大教、教派、分化出来的民族的民间信仰;名字不重', () => {
    const civ = civOf(seed);
    const F = civ.religion!.faiths;
    F.forEach((f, i) => {
      expect(f.id).toBe(i);
      expect(f.name.length).toBeGreaterThanOrEqual(2);
      expect(f.name).not.toMatch(CLEAN);
      expect(f.color).toHaveLength(3);
    });
    const roots = civ.cultures.filter((c) => c.parent === undefined);
    const C = roots.length;
    expect(F.slice(0, C).every((f, i) => f.kind === 'folk' && f.culture === roots[i].id)).toBe(true);
    // 每个民族正好一种民间信仰
    expect(F.filter((f) => f.kind === 'folk').map((f) => f.culture).sort((a, b) => a! - b!)).toEqual(civ.cultures.map((c) => c.id));
    const later = F.slice(C).filter((f) => f.kind !== 'folk');
    expect(new Set(F.map((f) => f.name)).size).toBe(F.length);
    const greats = F.filter((f) => f.kind === 'great');
    expect(greats.length).toBeGreaterThanOrEqual(2);
    expect(greats.length).toBeLessThanOrEqual(5);
    for (let i = 1; i < later.length; i++) expect(later[i].founded!).toBeGreaterThanOrEqual(later[i - 1].founded!);
    for (const g of greats) {
      expect(g.form).toBeDefined();
      expect(g.founder?.name.length).toBeGreaterThanOrEqual(2);
      expect(civ.settlements[g.holy!]).toBeDefined();
      expect(civ.settlements[g.holy!].founded).toBeLessThanOrEqual(g.founded!);
    }
    for (const s of F.filter((f) => f.kind === 'sect')) {
      const parent = F[s.parent!];
      expect(parent.kind).toBe('great');
      expect(s.founded!).toBeGreaterThan(parent.founded!);
      expect(s.form).toBe(parent.form);
      expect(civ.polities[s.polity!]).toBeDefined();
      expect(civ.settlements[s.seat!]).toBeDefined();
    }
    for (const g of greats) expect(F.filter((f) => f.parent === g.id).length).toBeLessThanOrEqual(2);
  });

  it('任意一年:检查点 + 补日志 = 从头翻日志;大教每 5 年传一步,民间信仰在民族换的那一刻跟着换', () => {
    const civ = civOf(seed);
    const out = new Int16Array(civ.regions.count);
    for (const y of [0, 450, 1234.5, 2000, Math.floor(civ.endYear / 2) + 0.25, civ.endYear]) {
      const a = faithAt(civ, y, out);
      expect(a).toBe(out);
      expect([...a], `${y} 年`).toEqual([...faithFromScratch(civ, y)]);
      // 两步之间只有民间信仰跟着民族变
      const step = faithAt(civ, Math.floor(y / 5) * 5);
      const F = civ.religion!.faiths;
      for (let r = 0; r < a.length; r++) if (a[r] !== step[r]) expect(a[r] < 0 || F[a[r]].kind === 'folk', `${y} 年 州 ${r}`).toBe(true);
    }
  });

  it('算到的那一步:有人住的州都有信仰,没人住的没有;民间信仰就是那州民族的;大教已经创立', () => {
    const civ = civOf(seed);
    const F = civ.religion!.faiths;
    for (const y of [0, 450, 1235, 2000, civ.endYear]) {
      const a = faithAt(civ, y);
      const own = ownersAt(civ, y);
      for (let r = 0; r < civ.regions.count; r++) {
        expect(a[r] >= 0, `${y} 年 州 ${r}`).toBe(own.culture[r] >= 0);
        if (a[r] >= 0 && F[a[r]].kind === 'folk') expect(F[a[r]].culture).toBe(own.culture[r]);
        if (a[r] >= 0 && F[a[r]].kind !== 'folk') expect(F[a[r]].founded!).toBeLessThanOrEqual(y);
      }
    }
  });

  it('大事按年份排;每个大教一件创教、每个教派一件分立,年份对得上;国教一国同时只有一个、在国家存续期间', () => {
    const civ = civOf(seed);
    const rel = civ.religion!;
    for (let i = 1; i < rel.events.length; i++) expect(rel.events[i].year).toBeGreaterThanOrEqual(rel.events[i - 1].year);
    for (const f of rel.faiths) {
      if (f.kind === 'folk') continue;
      const kind = f.kind === 'great' ? 'found' : 'schism';
      const ev = rel.events.filter((e) => e.kind === kind && e.faith === f.id);
      expect(ev, f.name).toHaveLength(1);
      expect(ev[0].year).toBe(f.founded);
    }
    for (const e of rel.events) {
      expect(rel.faiths[e.faith]).toBeDefined();
      if (e.kind !== 'found') expect(civ.polities[e.polity], `${e.kind} ${e.year}`).toBeDefined();
    }
    const byPolity = new Map<number, typeof rel.states>();
    for (const s of rel.states) {
      const p = civ.polities[s.polity];
      expect(rel.faiths[s.faith].kind).not.toBe('folk');
      expect(s.from).toBeGreaterThanOrEqual(p.founded);
      if (s.until !== undefined) expect(s.until).toBeGreaterThan(s.from);
      if (p.ended !== undefined) expect(s.until ?? Infinity).toBeLessThanOrEqual(p.ended);
      byPolity.set(s.polity, [...(byPolity.get(s.polity) ?? []), s]);
    }
    for (const list of byPolity.values()) {
      list.sort((a, b) => a.from - b.from);
      for (let i = 1; i < list.length; i++) expect(list[i].from).toBeGreaterThanOrEqual(list[i - 1].until!);
    }
    const y = civ.endYear;
    for (const p of civ.polities.filter((x) => polityAlive(x, y))) {
      const s = stateFaithAt(rel, p.id, y);
      if (s) expect(statesOfFaith(rel, s.faith, y).some((x) => x.polity === p.id)).toBe(true);
    }
  });

  it('编年史里的宗教大事:句子干净;创教、分立是大事;编号不和史事、继位撞;合进全部纪事', () => {
    const civ = civOf(seed);
    const fe = faithEntries(civ);
    expect(fe).toHaveLength(civ.religion!.events.length);
    expect(faithEntries(civ)).toBe(fe);
    for (const e of fe) {
      expect(e.kind).toBe('faith');
      expect(e.text).not.toMatch(CLEAN);
      expect(e.text).not.toMatch(/^[,，]|[,，]$|于创立|传入,/);
      expect('创皈传派圣').toContain(e.tag);
      const f = civ.religion!.faiths[e.faith!];
      expect(e.text).toContain(f.name);
      if (e.tag === '创' || e.tag === '派') expect(e.importance).toBe(3);
      else expect(e.importance === 1 || e.importance === 2).toBe(true);
    }
    const base = buildChronicle(civ);
    const ids = [...base, ...reignEntries(civ)].map((e) => e.id);
    const seen = new Set(ids);
    for (const e of fe) expect(seen.has(e.id), e.text).toBe(false);
    expect(new Set(fe.map((e) => e.id)).size).toBe(fe.length);
    const all = fullChronicle(civ).flatMap((e) => [e, ...(e.children ?? [])]);
    expect(all.filter((e) => e.kind === 'faith')).toHaveLength(fe.length);
    expect(all.length).toBe(base.flatMap((e) => [e, ...(e.children ?? [])]).length + fe.length + developmentEntries(civ).length + tradeEntries(civ).length);
  });

  it('侧栏的信仰列表:大教按(自己 + 教派)州数排,教派紧跟本教,民间信仰最后;州数加起来 = 有人住的州', () => {
    const civ = civOf(seed);
    const rel = civ.religion!;
    for (const y of [800, 1800, civ.endYear]) {
      const rows = faithRows(civ, y);
      const { total, folk } = faithCounts(civ, y);
      expect(rows.reduce((a, r) => a + r.n, 0), `${y} 年`).toBe(total);
      if (folk > 0) expect(rows[rows.length - 1]).toMatchObject({ id: -1, name: FOLK_ROW_NAME, n: folk });
      const totals: number[] = [];
      let parent = -1;
      for (const r of rows.filter((x) => x.id >= 0)) {
        expect(r.n > 0 || !r.sect).toBe(true);
        if (r.sect) {
          expect(rel.faiths[r.id].parent).toBe(parent);
          totals[totals.length - 1] += r.n;
        } else {
          expect(rel.faiths[r.id].kind).toBe('great');
          parent = r.id;
          totals.push(r.n);
        }
        expect(r.sub).not.toMatch(CLEAN);
      }
      for (let i = 1; i < totals.length; i++) expect(totals[i]).toBeLessThanOrEqual(totals[i - 1]);
    }
  });

  it('大教按创立先后取配色(中间分出的教派不占位)', () => {
    const greats = civOf(seed).religion!.faiths.filter((f) => f.kind === 'great');
    greats.forEach((g, i) => expect(g.color, g.name).toEqual(GREAT_COLORS[i % GREAT_COLORS.length]));
  });

  it('导出的图例(信仰图层):和侧栏信仰列表同样的几行、同样的颜色,右边小字是类型和州数', () => {
    const civ = civOf(seed);
    const rows = faithRows(civ, civ.endYear);
    const legend = faithLegendRows(civ, civ.endYear);
    expect(legend.map((r) => r.name)).toEqual(rows.map((r) => r.name));
    expect(legend.map((r) => r.color)).toEqual(rows.map((r) => [...r.color]));
    legend.forEach((r, i) => {
      expect(r.note).toMatch(new RegExp(`(^|· )${rows[i].n} 州$`));
      expect(r.note).not.toMatch(CLEAN);
      const f = civ.religion!.faiths[rows[i].id];
      if (f?.kind === 'great') expect(r.note.startsWith(`${f.form} · `)).toBe(true);
      if (f?.kind === 'sect') expect(r.note.startsWith('教派 · ')).toBe(true);
    });
  });

  it('信众小柱图:每 250 年一份,最后一份是结束那年;和 faithCounts 一致', () => {
    const civ = civOf(seed);
    const h = faithHistory(civ);
    expect(h.years[0]).toBe(0);
    expect(h.years[h.years.length - 1]).toBe(civ.endYear);
    const last = faithCounts(civ, civ.endYear).n;
    expect([...h.n[h.n.length - 1]]).toEqual([...last]);
  });
});

describe('信仰 · 结束年份不在整 5 年上', () => {
  it('最后补的那一步不传教:比上一个整步多出来的变化只有民间信仰跟着民族换、没人住了、这一年创的教;没有"传入"', () => {
    const civ = generateCiv(world(7), { endYear: 1873.5 });
    const rel = civ.religion!;
    const y = civ.endYear;
    const a = faithAt(civ, y);
    const b = faithAt(civ, 1870);
    const founded = new Set(rel.events.filter((e) => e.kind === 'found' && e.year === y).map((e) => e.region));
    for (let r = 0; r < civ.regions.count; r++) {
      if (a[r] === b[r]) continue;
      expect(a[r] < 0 || rel.faiths[a[r]].kind === 'folk' || founded.has(r), `州 ${r}`).toBe(true);
    }
    expect(rel.events.filter((e) => e.kind === 'enter' && e.year === y)).toEqual([]);
    const h = faithHistory(civ);
    expect(h.years[h.years.length - 1]).toBe(y);
    expect(h.years[h.years.length - 2]).toBe(1750);
  });

  it('最后补算一步:结束那年有人住的州都有信仰,民间信仰对得上那年的民族,亡了的国家国教也结束了', () => {
    const civ = generateCiv(world(7), { endYear: 1873.5 });
    const F = civ.religion!.faiths;
    const y = civ.endYear;
    const a = faithAt(civ, y);
    const own = ownersAt(civ, y);
    for (let r = 0; r < civ.regions.count; r++) {
      expect(a[r] >= 0, `州 ${r}`).toBe(own.culture[r] >= 0);
      if (a[r] >= 0 && F[a[r]].kind === 'folk') expect(F[a[r]].culture).toBe(own.culture[r]);
    }
    for (const s of civ.religion!.states) {
      const end = civ.polities[s.polity].ended;
      if (end !== undefined && end <= y) expect(s.until, civ.polities[s.polity].name).toBeDefined();
    }
  });
});

describe('信仰 · 同种子同一套', () => {
  it('同一个世界再推演一次,信仰、大事、国教、日志都一样', () => {
    const a = civOf(7).religion!;
    const b = generateCiv(world(7)).religion!;
    expect(b.faiths).toEqual(a.faiths);
    expect(b.events).toEqual(a.events);
    expect(b.states).toEqual(a.states);
    expect(b.log.size).toBe(a.log.size);
    expect([...b.log.value]).toEqual([...a.log.value]);
    expect([...b.log.region]).toEqual([...a.log.region]);
  });
});

describe('信仰 · 推演里逐步算', () => {
  it('推演里每 5 年算的一步,和推完照历史从头再算一遍(buildReligion)逐项一样:默认、结束年份不在整步上、带干预(含立国)、有地形大事', () => {
    const w = world(7);
    const base = civOf(7);
    const iv: Intervention[] = [
      { kind: 'declare', a: polityKey(base, 0), b: polityKey(base, 1), from: 900 },
      { kind: 'found', region: regionKey(base, Math.floor(base.regions.count / 3)), from: 1200 },
    ];
    const P = { ...DEFAULT_PARAMS, cells: 12000, seed: 7 };
    const ups = upheavalSteps(P, [], null, [{ year: 1600, ops: [{ kind: 'sink', pts: [1850, 520, 1930, 530, 1903, 469], r: 40, s: 1.1 }] }]);
    const cases: [string, Civ, World][] = [
      ['seed 7', base, w],
      ['seed 2024', civOf(2024), world(2024)],
      ['推到 1873.5 年', generateCiv(w, { endYear: 1873.5 }), w],
      ['干预', generateCiv(w, { interventions: iv }), w],
      ['地形大事', generateCiv(w, { upheavals: ups }), ups[0].world],
    ];
    for (const [label, civ, cw] of cases) {
      const a = civ.religion!;
      const b = buildReligion(cw, civ);
      expect(a.faiths.length, label).toBeGreaterThan(0);
      expect(b.faiths, label).toEqual(a.faiths);
      expect(b.events, label).toEqual(a.events);
      expect(b.states, label).toEqual(a.states);
      expect(b.log, label).toEqual(a.log);
      expect(b.checkpoints, label).toEqual(a.checkpoints);
    }
    expect(cases[4][1].eras?.length).toBe(1);
  }, 120_000);

  it('推演里问得到"这州眼下信什么、这国眼下的国教"(算到的最近一步),早先某一年的也问得到;和推完的结果一样', () => {
    const w = world(2024);
    const full = civOf(2024);
    const rel = full.religion!;
    const sim = CivSim.fromCiv(w, generateCiv(w, { endYear: 1502 }));
    const fs = faithSimOf(sim)!;
    const check = (y: number) => {
      expect(fs.year).toBe(y);
      expect([...fs.faith], `${y} 年`).toEqual([...faithAt(full, y)]);
      for (let p = 0; p < full.polities.length; p++) expect(fs.stateFaith(p), `${y} 年 国家 ${p}`).toBe(stateFaithAt(rel, p, y)?.faith ?? -1);
    };
    check(1500); // 接着推:照历史重放到 1502 年以前的最后一步
    sim.run(2203);
    check(2200);
    for (const y of [0, 777.5, 1234, 2200]) expect([...fs.faithAt(y)], `${y} 年`).toEqual([...faithAt(full, y)]);
    for (let p = 0; p < full.polities.length; p++) expect(fs.stateFaithAt(p, 1234), `国家 ${p}`).toBe(stateFaithAt(rel, p, 1234)?.faith ?? -1);
    for (let f = 0; f < fs.faithCount; f++) {
      expect(fs.folk(f), `信仰 ${f}`).toBe(rel.faiths[f].kind === 'folk');
      expect(fs.rootOf(f), `信仰 ${f}`).toBe(faithRoot(rel, f));
    }
  }, 60_000);
});

describe('信仰 · 改名、搜索、图层、地图上的选中', () => {
  const civ = civOf(7);
  const rel = civ.religion!;
  const great = rel.faiths.find((f) => f.kind === 'great')!;
  const folk = rel.faiths[0];

  it('改教名:新 Civ 里改了,原 Civ 不动;键找得回同一个教', () => {
    const named = applyNames(civ, { [faithKey(civ, great.id)]: '长明教' });
    expect(named.religion!.faiths[great.id].name).toBe('长明教');
    expect(rel.faiths[great.id].name).toBe(great.name);
    expect(faithKey(named, great.id)).toBe(faithKey(civ, great.id));
    expect(fullChronicle(named).some((e) => e.kind === 'faith' && e.text.includes('长明教'))).toBe(true);
  });

  it('民族改名,它的民间信仰跟着改;单独改过的民间信仰不跟', () => {
    const cu = civ.cultures[folk.culture!];
    const suffix = folk.name.slice(cu.name.length);
    const a = applyNames(civ, { [cultureKey(civ, cu.id)]: '青崖' });
    expect(a.religion!.faiths[folk.id].name).toBe(`青崖${suffix}`);
    const b = applyNames(civ, { [cultureKey(civ, cu.id)]: '青崖', [faithKey(civ, folk.id)]: '山鬼' });
    expect(b.religion!.faiths[folk.id].name).toBe('山鬼');
  });

  it('搜索教名找得到这个教', () => {
    const hits = searchCiv(civ, great.name, civ.endYear);
    const hit = hits.find((h) => h.kind === 'faith' && h.id === great.id);
    expect(hit).toBeDefined();
    expect(hit!.select).toEqual({ kind: 'faith', id: great.id });
  });

  it('信仰图层:历史图层里排在最前;带国界,不带民族色块', () => {
    expect(layerOf('fantasy', 'biomes', { polities: true, cultures: false, faiths: true })).toBe('faith');
    expect(layerOf('fantasy', 'biomes', { polities: true, cultures: true, faiths: false })).not.toBe('faith');
    expect(layerDef('faith')).toMatchObject({ polities: true, cultures: false, faiths: true });
  });

  it('点编年史:在信仰图层上点宗教大事留在信仰图层,别的情形都换到政区图层(民族色块也关掉)', () => {
    const all = fullChronicle(civ);
    const faithEv = all.find((e) => e.kind === 'faith')!;
    const other = all.find((e) => e.kind !== 'faith')!;
    const layer = () => layerOf('fantasy', 'biomes', getCivShow());
    setCivShow({ polities: true, cultures: false, faiths: true });
    pickChronicleEntry(faithEv);
    expect(layer()).toBe('faith');
    pickChronicleEntry(other);
    expect(layer()).toBe('political');
    setCivShow({ polities: false, cultures: true, faiths: false });
    pickChronicleEntry(faithEv);
    expect(layer()).toBe('political');
    expect(getCivShow()).toMatchObject({ polities: true, cultures: false, faiths: false });
  });

  it('导出的编年史给了全部纪事就带上宗教大事', () => {
    const found = fullChronicle(civ).find((e) => e.kind === 'faith')!;
    expect(chronicleDocument(civ, { format: 'txt', seed: 7, entries: fullChronicle(civ) })).toContain(found.text);
    expect(chronicleDocument(civ, { format: 'txt', seed: 7 })).not.toContain(found.text);
  });

  it('试推演里改教名:两份历史里同一个教(创立年份、民族出现年份一样)才放行', () => {
    expect(sameInBoth(civ, civ, faithKey(civ, great.id))).toBe(true);
    expect(sameInBoth(civ, civ, faithKey(civ, folk.id))).toBe(true);
    const moved: Civ = { ...civ, religion: { ...rel, faiths: rel.faiths.map((f) => (f.id === great.id ? { ...f, founded: f.founded! + 100 } : f)) } };
    expect(sameInBoth(civ, moved, faithKey(civ, great.id))).toBe(false);
  });

  it('选中信仰:大教圈圣城,教派圈分出时的国都,民间信仰不圈;别的选中照旧', () => {
    expect(selectionOnMap(civ, { kind: 'faith', id: great.id })).toEqual({ kind: 'settlement', id: great.holy });
    const sect = rel.faiths.find((f) => f.kind === 'sect');
    if (sect) expect(selectionOnMap(civ, { kind: 'faith', id: sect.id })).toEqual({ kind: 'settlement', id: sect.seat });
    expect(selectionOnMap(civ, { kind: 'faith', id: folk.id })).toBeNull();
    expect(selectionOnMap(civ, { kind: 'polity', id: 0 })).toEqual({ kind: 'polity', id: 0 });
    expect(faithFocusOf({ kind: 'faith', id: 3 })).toBe(3);
    expect(faithFocusOf({ kind: 'polity', id: 3 })).toBeNull();
    expect(faithRoot(rel, great.id)).toBe(great.id);
    if (sect) expect(faithRoot(rel, sect.id)).toBe(sect.parent);
  });
});
