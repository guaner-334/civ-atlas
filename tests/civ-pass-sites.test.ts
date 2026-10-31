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
import { standPass, standPassName } from '../src/gen/civ/story/display';
import { fullChronicle } from '../src/gen/civ/story/religionText';
import { rasterize } from '../src/gen/raster';
import { entrySpot } from '../src/ui/timelineLayout';
import { directorPlan } from '../src/ui/directorPlan';
import { fightEntries, passSides } from '../src/ui/panelData';
import { markSpot, pinnedPass } from '../src/ui/markInfo';

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

  it('守关那一仗对到关上:编年史写关名,事发地落在关口,导播单独一段、名牌写关名,卡片「这一带打过的仗」列着它', () => {
    const { w, c } = cases.get(seed)!;
    const kids = new Map(fullChronicle(c).flatMap((e) => (e.kind === 'war' ? (e.children ?? []) : [])).map((x) => [x.id, x]));
    const cells = standCells(w, c);
    expect(cells.length).toBeGreaterThan(0);
    for (const { annal, year } of cells) {
      const at = c.places.findIndex((p) => p.pass?.stands?.includes(annal));
      expect(at, `第 ${annal} 条史事对到一处关`).toBeGreaterThanOrEqual(0);
      expect(c.places.filter((p) => p.pass?.stands?.includes(annal))).toHaveLength(1);
      const p = c.places[at];
      expect(standPass(c.places, annal)).toBe(at);
      expect(standPassName(c, annal)).toBe(p.name);
      expect(p.pass!.since).toBeLessThanOrEqual(year);
      const e = kids.get(annal)!;
      expect(e.text).toContain(`守${p.name},`);
      expect(e.text).not.toMatch(/之隘|的山口/);
      expect(entrySpot(w, c, e)).toEqual({ cell: p.cell, kind: 'pass', id: at });
      expect(fightEntries(c, [...new Set(p.pass!.regions)]).some((x) => x.id === annal && x.kind === 'stand')).toBe(true);
      // 导播:那场仗排进来时(关注断后的那一国、小仗也排),守关这一下单独一段,镜头落在关口、名牌写关名
      const focus = { kind: 'polity' as const, id: c.annals[annal].a, min: 1 as const };
      const plan = directorPlan(w, c, { from: Math.floor(year), to: Math.floor(year) + 1, entries: fullChronicle(c), focus, pace: { mode: 'auto' } });
      // 同一年事多时可能略过(crowd),略过的也照样有事发地和名牌
      const cap = [...plan.segments.flatMap((s) => s.items), ...plan.skipped].find((it) => it.entry.id === annal && it.entry.kind === 'stand');
      expect(cap, `第 ${Math.floor(year)} 年守${p.name}`).toBeDefined();
      expect(cap!.place).toBe(p.name);
      expect(cap!.pin).toEqual([w.mesh.x[p.cell!], w.mesh.y[p.cell!]]);
      expect(cap!.type).toBe('war');
      // 讲了的:单独一段,镜头对着那处关
      const seg = plan.segments.find((s) => s.items.some((it) => it.entry.id === annal && it.entry.kind === 'stand'));
      if (seg) {
        expect(seg.items).toHaveLength(1);
        expect(seg.shot?.target).toEqual({ kind: 'pass', id: at });
      }
    }
    // 关两边:第一对州;两州治所南北差得比东西远(东西按纬度折成实际远近)写北边 / 南边,北边那州的治所在南边那州的北边;
    // 不然写西边 / 东边,西边那州的治所在东边那州的西边(按近的那一圈)
    for (const p of c.places) {
      if (p.kind !== 'pass') continue;
      const sides = passSides(w, c, p.pass!.regions);
      expect(sides.map((s) => s.r).sort()).toEqual(p.pass!.regions.slice(0, 2).sort());
      const [s0, s1] = sides.map((s) => c.regions.seat[s.r]);
      const dx = w.mesh.x[s1] - w.mesh.x[s0] - w.width * Math.round((w.mesh.x[s1] - w.mesh.x[s0]) / w.width);
      const dy = w.mesh.y[s1] - w.mesh.y[s0];
      const lat = 90 - (90 * (w.mesh.y[s0] + w.mesh.y[s1])) / w.height;
      const ns = Math.abs(dy) > Math.abs(dx) * Math.cos((lat * Math.PI) / 180);
      expect(sides.map((s) => s.k), p.name).toEqual(ns ? ['北边', '南边'] : ['西边', '东边']);
      if (ns) expect(dy, p.name).toBeGreaterThanOrEqual(0);
      else expect(dx, p.name).toBeGreaterThanOrEqual(0);
    }
  });

  it('钉在关上的标记:图钉正好在关口上 = 那处关(这一年地图上有它时);挪开一点就是普通的一个点', () => {
    const { w, c } = cases.get(seed)!;
    const raster = rasterize(w, 1);
    const at = c.places.findIndex((p) => p.kind === 'pass');
    const p = c.places[at];
    const pin: [number, number] = [w.mesh.x[p.cell!], w.mesh.y[p.cell!]];
    const y = Math.ceil(p.pass!.since);
    expect(pinnedPass(c, w, pin, y)).toBe(at);
    expect(markSpot(c, w, raster, pin, y).place).toBe(at);
    expect(pinnedPass(c, w, pin, y - 1)).toBe(-1);
    expect(pinnedPass(c, w, [pin[0] + w.mesh.spacing * 0.3, pin[1]], y)).toBe(-1);
  });
});

it('关两边的方位:两个种子里东西走向(西边 / 东边)、南北走向(北边 / 南边)的口子都有', () => {
  const kinds = new Set<string>();
  for (const { w, c } of cases.values()) for (const p of c.places) if (p.kind === 'pass') kinds.add(passSides(w, c, p.pass!.regions)[0]?.k);
  expect([...kinds].sort()).toEqual(['北边', '西边']);
});

it('改过地形的世界:守关那一句用那一年所在那一段地图上的关名', () => {
  const gate = (name: string, stands: number[]) => ({ kind: 'pass', name, pass: { stands } }) as unknown as Civ['places'][number];
  const civ = {
    annals: [{ year: 100 }, { year: 900 }],
    upheavals: [{ year: 500 }],
    eras: [{ places: [gate('旧关', [0, 1])] }],
    places: [gate('新关', [0, 1])],
  } as unknown as Civ;
  expect(standPassName(civ, 0)).toBe('旧关');
  expect(standPassName(civ, 1)).toBe('新关');
});
