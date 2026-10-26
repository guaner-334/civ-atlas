/**
 * 地图上画的关隘(gen/civ/passSites.ts 挑、places.ts 起名、render/civ/passes.ts 画):
 * 名关是大路翻过去、绕开它要多翻 500 米以上的口子,每颗星球十来处、彼此隔开;打过守关战的口子从那一仗那年起画;
 * 关名东方"某某关"、西方"某某山口",不和别的地名、城名、州名重名;符号、名字什么时候出现。
 * (加关隘时同一个种子的地形、历史、别的地名一个字没变,见 determinism.test.ts、names-stable.test.ts)
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_PARAMS, generateWorld, type World } from '../src/gen/world';
import { generateCiv } from '../src/gen/civ';
import type { Civ } from '../src/gen/civ/types';
import { passSites, passSince, standCells } from '../src/gen/civ/passSites';
import { geometryOf } from '../src/gen/geometry';
import { refSpacing } from '../src/gen/civ/geo';
import { PASS_MARK_BASE, PASS_NAME_ZOOM, PASS_SYMBOL_ZOOM, passLabels, passOfMark, passesAt } from '../src/render/civ/passes';
import { passLook } from '../src/render/civ/labels';
import { markPick } from '../src/ui/mapPick';

const cases = new Map<number, { w: World; c: Civ }>();
beforeAll(() => {
  for (const seed of [555, 207]) {
    const w = generateWorld({ ...DEFAULT_PARAMS, seed });
    cases.set(seed, { w, c: generateCiv(w) });
  }
}, 120_000);

describe.each([555, 207])('关隘上地图 · seed %i', (seed) => {
  it('名关:大路翻过去、绕开要多翻 800 米以上,十来处,彼此隔开 8 个地块以上;地图上的关隘 = 名关 + 打过守关战的', () => {
    const { w, c } = cases.get(seed)!;
    const sites = passSites(w, c.regions, c.routes, c);
    const named = sites.filter((s) => s.named);
    expect(named.length).toBeGreaterThanOrEqual(8);
    expect(named.length).toBeLessThanOrEqual(14);
    const geo = geometryOf(w.mesh);
    const sp = refSpacing(w.mesh);
    for (const s of named) {
      expect(s.road, '名关都有大路').toBeDefined();
      expect((s.detour ?? Math.max(s.ridge, s.height + 500)) - s.height).toBeGreaterThanOrEqual(800);
      for (const o of named) if (o !== s) expect(geo.dist(o.cell, s.cell)).toBeGreaterThanOrEqual(8 * sp);
    }
    // 口子都在两州交界上:口子那块属于记下的某一对州里的一州
    for (const s of sites) expect(s.pairs).toContain(c.regions.of[s.cell]);
    const shown = sites.filter((s) => passSince(s) < Infinity);
    const places = c.places.filter((p) => p.kind === 'pass');
    expect(places.map((p) => p.cell)).toEqual(shown.map((s) => s.cell));
    for (const p of places) {
      const s = shown.find((x) => x.cell === p.cell)!;
      expect(p.pass!.since).toBe(passSince(s));
      expect(p.pass!.named).toBe(s.named);
      if (!s.named) expect(p.pass!.since).toBe(p.pass!.stand);
    }
  });

  it('据险断后的史事都认得出守的是哪个口子,那个口子从那一仗那年起画在地图上', () => {
    const { w, c } = cases.get(seed)!;
    const stands = c.annals.filter((a) => a.kind === 'stand');
    const cells = standCells(w, c);
    expect(cells.length).toBe(stands.length);
    const places = c.places.filter((p) => p.kind === 'pass');
    const geo = geometryOf(w.mesh);
    const sp = refSpacing(w.mesh);
    for (const { cell, year } of cells) {
      // 口子在州界上,和某个画出来的关隘是同一处(相隔 2 个地块以内)
      const p = places.find((q) => q.cell === cell) ?? places.find((q) => geo.dist(q.cell!, cell) <= 2 * sp);
      expect(p, `第 ${year} 年守的口子画在地图上`).toBeDefined();
      expect(p!.pass!.stand!).toBeLessThanOrEqual(year);
      expect(p!.pass!.since).toBeLessThanOrEqual(year);
    }
  });

  it('关名:东方"某某关"、西方"某某山口",不和别的地名、关画上地图以前就有的城重名', () => {
    const { c } = cases.get(seed)!;
    const passes = c.places.filter((p) => p.kind === 'pass');
    expect(passes.length).toBeGreaterThan(0);
    const others = new Set(c.places.filter((p) => p.kind !== 'pass').map((p) => p.name));
    const seen = new Set<string>();
    for (const p of passes) {
      expect(p.name).toMatch(/^[^之]{1,4}(关|山口)$/);
      expect(others.has(p.name), p.name).toBe(false);
      expect(c.settlements.some((s) => s.name === p.name && s.founded <= p.pass!.since), p.name).toBe(false);
      expect(seen.has(p.name), p.name).toBe(false);
      seen.add(p.name);
      if (p.latin !== undefined) expect(p.latin).toMatch(/ Pass$/);
      if (p.name.endsWith('关')) expect(p.latin).toBeUndefined();
    }
  });

  it('地图上:到了那一年才画;名关 1.5 倍出符号、2.2 倍出名字,打过守关战的总览就有符号、1.5 倍出名字;点符号 = 点这处地名', () => {
    const { w, c } = cases.get(seed)!;
    const year = 2300;
    const ids = passesAt(c, year);
    expect(ids.every((i) => c.places[i].pass!.since <= year)).toBe(true);
    expect(c.places.filter((p, i) => p.kind === 'pass' && !ids.includes(i)).every((p) => p.pass!.since > year)).toBe(true);
    const { marks, items } = passLabels(c, w, year, 'fantasy', passLook('fantasy'), 'serif');
    expect(marks.map((m) => passOfMark(m.id))).toEqual(ids);
    for (const m of marks) {
      const p = c.places[m.place!];
      const fought = p.pass!.stand !== undefined && p.pass!.stand <= year;
      expect(m.minZoom).toBe(PASS_SYMBOL_ZOOM[fought ? 1 : 0]);
      expect(m.id).toBeGreaterThanOrEqual(PASS_MARK_BASE);
      expect(markPick(m.id)).toEqual({ kind: 'place', id: m.place });
      const name = items.find((it) => it.mark === m.id)!;
      expect(name.text).toBe(p.name);
      expect(name.minZoom).toBe(PASS_NAME_ZOOM[fought ? 1 : 0]);
      expect(name.pick).toEqual({ kind: 'place', id: m.place });
    }
    // 回放、拖时间轴时只画符号
    expect(passLabels(c, w, year, 'realistic', passLook('realistic'), 'serif', true).items).toEqual([]);
    expect(markPick(3)).toEqual({ kind: 'settlement', id: 3 });
  });
});
