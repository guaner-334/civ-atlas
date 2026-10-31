/**
 * 地图上的大迁徙路线(render/civ/migrations.ts)和界面上的几处(ui/migrationInfo.ts、civView.ts 的 jumpYearOf、flyTo.ts 的选中框):
 * 箭头随年份往前长、到了以后留 20 年再 30 年淡完,路上的事按年份出现,只在国家、民族填色上画;
 * 点编年史那一条跳到落脚那年;选中迁来立的国时镜头连来路一起框;国家卡片、人物卡的「来历」挑对人。
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_PARAMS, generateWorld, type World } from '../src/gen/world';
import { generateCiv, type Civ } from '../src/gen/civ';
import type { Migration } from '../src/gen/civ/types';
import { fullChronicle } from '../src/gen/civ/story/religionText';
import { peopleIndex } from '../src/gen/civ/story/peopleInfo';
import { rasterize, type Raster } from '../src/gen/raster';
import { CIV_SHOW_OFF, type CivDrawParams } from '../src/render/civ/overlay';
import { FADE, LINGER, drawTreks, trekAlpha, trekBox, trekLook, trekPath, trekReach, trekScene, treksShown } from '../src/render/civ/migrations';
import type { LabelView } from '../src/render/labels/draw';
import { labelProjection, mapProj, projector } from '../src/render/projection';
import { jumpYearOf, setCivShow } from '../src/ui/civView';
import { departureEntry, flashAlpha, personTrek, polityTrek, trekOfEntry } from '../src/ui/migrationInfo';
import { flatFly, selectionFocus } from '../src/ui/flyTo';

let world: World;
let civ: Civ;
let raster: Raster;
let L: Migration[];

const params = (year: number, show = { ...CIV_SHOW_OFF, polities: true }): CivDrawParams => ({ world, raster, civ, style: 'fantasy', year, show });

beforeAll(() => {
  world = generateWorld({ ...DEFAULT_PARAMS, seed: 7, cells: 12000 });
  civ = generateCiv(world);
  raster = rasterize(world, 1);
  L = civ.migrations ?? [];
  // Node 里没有 Path2D:只要能加点就行
  (globalThis as { Path2D?: unknown }).Path2D ??= class {
    moveTo() {}
    lineTo() {}
    bezierCurveTo() {}
    closePath() {}
  };
});

describe('路线和走到哪了', () => {
  it('路线一州一个点、对上抹圆后的折线:起点 0、终点全长、一路不往回', () => {
    expect(L.length).toBeGreaterThanOrEqual(2);
    L.forEach((M, m) => {
      const p = trekPath(civ, world, m)!;
      expect(p, `第 ${m} 次`).toBeTruthy();
      expect(p.node.length).toBe(M.route.length);
      expect(p.node[0]).toBe(0);
      expect(p.node[p.node.length - 1]).toBeCloseTo(p.L, 6);
      for (let j = 1; j < p.node.length; j++) expect(p.node[j]).toBeGreaterThanOrEqual(p.node[j - 1]);
      // 抹圆以后的起点、终点还在出发、落脚那一州的治所
      const seat = (r: number) => civ.regions.seat[r];
      expect(p.pts[0]).toBe(world.mesh.x[seat(M.route[0])]);
      expect(p.pts[1]).toBe(world.mesh.y[seat(M.route[0])]);
      expect(p.pts[p.pts.length - 1]).toBe(world.mesh.y[seat(M.route[M.route.length - 1])]);
      // 相邻两点不跨过东西接缝(x 接着走)
      for (let i = 2; i < p.pts.length; i += 2) expect(Math.abs(p.pts[i] - p.pts[i - 2])).toBeLessThan(world.width / 4);
    });
  });

  it('随年份往前长:动身时 0,到每一州的那一刻正好在那一州,到了以后是全长', () => {
    const M = L[0];
    const p = trekPath(civ, world, 0)!;
    expect(trekReach(M, p, M.year - 1)).toBe(0);
    expect(trekReach(M, p, M.year)).toBe(0);
    for (let j = 1; j < M.years.length; j++) expect(trekReach(M, p, M.years[j])).toBeCloseTo(p.node[j], 6);
    let last = -1;
    for (let t = M.year; t <= M.years[M.years.length - 1]; t += 0.25) {
      const s = trekReach(M, p, t);
      expect(s).toBeGreaterThanOrEqual(last);
      last = s;
    }
    expect(trekReach(M, p, M.years[M.years.length - 1] + 5)).toBe(p.L);
  });

  it('到了以后整条留 LINGER 年,再 FADE 年淡完,之后不在地图上', () => {
    const M = L.find((x) => x.settled !== undefined && x.settled + LINGER + FADE < civ.endYear)!;
    const m = L.indexOf(M);
    const S = M.settled!;
    expect(trekAlpha(M, (M.year + S) / 2)).toBe(1);
    expect(trekAlpha(M, S + LINGER)).toBe(1);
    expect(trekAlpha(M, S + LINGER + FADE / 2)).toBeCloseTo(0.5, 6);
    expect(trekAlpha(M, S + LINGER + FADE)).toBe(0);
    const on = (y: number) => trekScene(civ, world, y).some((t) => t.m === m);
    expect(on(M.year - 0.5)).toBe(false);
    expect(on(M.year + 0.1)).toBe(true);
    expect(on(S + LINGER + FADE - 1)).toBe(true);
    expect(on(S + LINGER + FADE + 0.1)).toBe(false);
    const t = trekScene(civ, world, S + 1).find((x) => x.m === m)!;
    expect(t.arrived).toBe(true);
    expect(t.upto).toBe(t.path.L);
  });

  it('路上的事:洗劫按史事、在路线上那一州;攻进去的那一下在落脚那一头;到了那一年才出现', () => {
    let raids = 0;
    let breaches = 0;
    L.forEach((M, m) => {
      const end = M.settled ?? civ.endYear;
      const all = trekScene(civ, world, Math.min(civ.endYear, end + 1)).find((t) => t.m === m)?.marks ?? [];
      const want = civ.annals.filter((e) => e.kind === 'trek' && e.war === m && e.n === 1);
      expect(all.filter((k) => k.kind === 'raid').map((k) => k.region)).toEqual(want.map((e) => e.region));
      for (const k of all) {
        if (k.kind === 'raid') {
          raids++;
          expect(M.route).toContain(k.region);
        } else {
          breaches++;
          expect(k.year).toBe(M.settled);
          expect(M.polity).toBeDefined();
          expect(M.war).toBeDefined();
        }
        // 早一点的年份里还没有
        const before = trekScene(civ, world, k.year - 0.01).find((t) => t.m === m)?.marks ?? [];
        expect(before.some((x) => x.kind === k.kind && x.region === k.region && x.year === k.year)).toBe(false);
      }
    });
    expect(raids).toBeGreaterThan(0);
    expect(breaches).toBeGreaterThan(0);
  });
});

describe('画不画、怎么画', () => {
  it('只在国家、民族填色上画', () => {
    expect(treksShown(params(0))).toBe(true);
    expect(treksShown(params(0, { ...CIV_SHOW_OFF, cultures: true }))).toBe(true);
    expect(treksShown(params(0, { ...CIV_SHOW_OFF }))).toBe(false);
    expect(treksShown(params(0, { ...CIV_SHOW_OFF, polities: true, faiths: true }))).toBe(false);
    expect(treksShown(params(0, { ...CIV_SHOW_OFF, polities: true, eras: true }))).toBe(false);
  });

  it('箭头用族色压深一点,字更深', () => {
    const lum = (css: string) => {
      const [r, g, b] = css.match(/\d+/g)!.map(Number);
      return 0.299 * r + 0.587 * g + 0.114 * b;
    };
    for (const cu of civ.cultures) {
      const look = trekLook(cu.color, 'fantasy');
      const base = 0.299 * cu.color[0] + 0.587 * cu.color[1] + 0.114 * cu.color[2];
      expect(lum(look.fill)).toBeLessThan(base + 1);
      expect(lum(look.ink)).toBeLessThan(lum(look.fill));
    }
    expect(trekLook([214, 158, 52], 'realistic').halo).toMatch(/255,255,255/);
  });

  it('画在文字层上:箭身、族名和动身那年、到了以后的年份;不填色时不画', () => {
    const M = L.find((x) => x.settled !== undefined)!;
    const texts: string[] = [];
    let fills = 0;
    const ctx = new Proxy(
      {},
      {
        get: (_t, k) =>
          k === 'fillText'
            ? (s: string) => texts.push(s)
            : k === 'fill'
              ? () => fills++
              : k === 'measureText'
                ? (s: string) => ({ width: s.length * 12 })
                : () => {},
        set: () => true,
      },
    ) as unknown as CanvasRenderingContext2D;
    const lv: LabelView = { scale: 1, ox: 0, oy: 0, dpr: 1, k: 1, mapCss: world.width, worldW: world.width, worldH: world.height, wrap: world.width, canvasW: world.width, canvasH: world.height };
    expect(drawTreks(ctx, params(M.settled! + 1, { ...CIV_SHOW_OFF }), lv, null)).toBe(0);
    expect(drawTreks(ctx, params(M.settled! + 1), lv, null)).toBeGreaterThan(0);
    expect(fills).toBeGreaterThan(0);
    expect(texts).toContain(`${civ.cultures[M.culture].name}族`);
    expect(texts).toContain(String(Math.floor(M.year)));
    expect(texts).toContain(String(Math.floor(M.settled!)));
    // 放大到 1.5 倍起写路上的事
    const raid = civ.annals.find((e) => e.kind === 'trek' && e.n === 1)!;
    texts.length = 0;
    drawTreks(ctx, params(raid.year + 0.01), { ...lv, k: 2, scale: 2 }, null);
    expect(texts.some((s) => s.startsWith(`${Math.floor(raid.year)} 掠`))).toBe(true);
  });

  it('弯边投影:路线跨过地图左右边(中央经线对面)时,两边各画一份,不丢那一截', () => {
    const M = L.find((x) => x.settled !== undefined)!;
    const p = trekPath(civ, world, L.indexOf(M))!;
    let lo = Infinity;
    let hi = -Infinity;
    for (let i = 0; i < p.pts.length; i += 2) [lo, hi] = [Math.min(lo, p.pts[i]), Math.max(hi, p.pts[i])];
    // 中央经线放在路线正中的对面:地图的左右边从路线中间穿过
    const seam = (lo + hi) / 2;
    const lon0 = ((seam / world.width) * 360 - 180 + 180 + 540) % 360 - 180;
    const mp = mapProj('robinson', lon0, world.width, world.height);
    const ctx = new Proxy({}, { get: (_t, k) => (k === 'measureText' ? (s: string) => ({ width: s.length * 12 }) : () => {}), set: () => true }) as unknown as CanvasRenderingContext2D;
    const lv: LabelView = { scale: 1, ox: 0, oy: 0, dpr: 1, k: 1, mapCss: world.width, worldW: world.width, worldH: world.height, wrap: 0, canvasW: world.width, canvasH: world.height, proj: labelProjection(mp) };
    expect(drawTreks(ctx, params(M.settled! + 1), lv, projector(mp))).toBeGreaterThanOrEqual(2);
    // 中央经线就在路线正中:一份就够
    const mid = mapProj('robinson', ((seam / world.width) * 360 - 180 + 540) % 360 - 180, world.width, world.height);
    expect(drawTreks(ctx, params(M.settled! + 1), { ...lv, proj: labelProjection(mid) }, projector(mid))).toBe(1);
  });

  it('选中迁来立的国:来路还在地图上时镜头连来路一起框,淡完以后只框国土;不填色时不框来路', () => {
    const M = L.find((x) => x.polity !== undefined && x.settled! + LINGER + FADE < (civ.polities[x.polity].ended ?? civ.endYear))!;
    const m = L.indexOf(M);
    const id = M.polity!;
    setCivShow({ ...CIV_SHOW_OFF, polities: true });
    const y = M.settled! + 1;
    const box = selectionFocus(world, civ, { kind: 'polity', id }, y)!.box!;
    const tb = trekBox(civ, world, m, y, (box[0] + box[2]) / 2)!;
    expect(box[0]).toBeLessThanOrEqual(tb[0] + 1e-6);
    expect(box[2]).toBeGreaterThanOrEqual(tb[2] - 1e-6);
    const later = M.settled! + LINGER + FADE + 1;
    expect(trekBox(civ, world, m, later, 0)).toBeNull();
    // 连来路一起按 1 倍也框不下(窄的画面):只框国土,和不画来路时一样飞
    const f = selectionFocus(world, civ, { kind: 'polity', id }, y)!;
    expect(f.core).toBeTruthy();
    const narrow = { sw: 90, sh: 900, bw: 1800, bh: 900 };
    const wide = { sw: 6000, sh: 3000, bw: 6000, bh: 3000 };
    const v0 = { k: 1, x: 0, y: 0 };
    const goal = (focus: typeof f) => ({ focus, kind: 'polity' as const });
    expect(flatFly(v0, narrow, world.width, world.height, goal(f))?.(1)).toEqual(flatFly(v0, narrow, world.width, world.height, goal(f.core!))?.(1));
    expect(flatFly(v0, wide, world.width, world.height, goal(f))?.(1)).not.toEqual(flatFly(v0, wide, world.width, world.height, goal(f.core!))?.(1));
    setCivShow({ ...CIV_SHOW_OFF });
    const plain = selectionFocus(world, civ, { kind: 'polity', id }, y)!;
    expect(plain.core).toBeUndefined();
    expect(plain.box![2] - plain.box![0]).toBeLessThanOrEqual(box[2] - box[0]);
    setCivShow({ ...CIV_SHOW_OFF, polities: true });
  });
});

describe('编年史、卡片', () => {
  it('点大迁徙那一条跳到落脚那年;经过里的一件、别的条目照它自己的年份', () => {
    const entries = fullChronicle(civ);
    const treks = entries.filter((e) => trekOfEntry(civ, e) >= 0);
    expect(treks.length).toBe(L.length);
    for (const e of treks) {
      const M = L[trekOfEntry(civ, e)];
      const y = jumpYearOf(e);
      if (M.settled !== undefined) expect(y).toBe(M.settled);
      else expect(y).toBe(civ.endYear);
      for (const k of e.children ?? []) expect(jumpYearOf(k)).toBe(k.year);
      // 动身那一件:「来历」里的地名点了跳过去
      const d = departureEntry(civ, trekOfEntry(civ, e))!;
      expect(d.year).toBe(M.year);
      expect(d.regions).toEqual([M.route[0]]);
    }
    for (const e of entries.slice(0, 400)) if (trekOfEntry(civ, e) < 0) expect(jumpYearOf(e)).toBe(e.year);
  });

  it('亮一下:约两秒,亮暗几回,闪完是 0', () => {
    expect(flashAlpha(0)).toBe(0);
    expect(flashAlpha(0.08 * 2200)).toBeCloseTo(1, 6);
    expect(flashAlpha(0.24 * 2200)).toBeCloseTo(0.3, 6);
    expect(flashAlpha(2200)).toBe(0);
    expect(flashAlpha(5000)).toBe(0);
  });

  it('国家卡片、人物卡的来历:迁来立的国;领头立国的是第一位君主,落脚以后生的、没活到落脚的不写', () => {
    let lead = 0;
    let follow = 0;
    for (const [m, M] of L.entries()) {
      if (M.polity === undefined) continue;
      expect(polityTrek(civ, M.polity)?.m).toBe(m);
      const first = peopleIndex(civ).rulers[M.polity][0];
      if (first) {
        expect(personTrek(civ, first)?.how).toBe('lead');
        lead++;
      }
      for (const x of civ.people ?? []) {
        if (x.polity !== M.polity) continue;
        const t = personTrek(civ, x);
        if (x.born >= M.settled! || (x.died !== undefined && x.died < M.settled!)) expect(t).toBeNull();
        else if (t && t.how !== 'lead') {
          follow++;
          expect(t.how).toBe(x.born < M.year ? 'follow' : 'road');
        }
      }
    }
    expect(lead).toBeGreaterThan(0);
    expect(follow).toBeGreaterThan(0);
    // 别的国家没有
    const other = civ.polities.find((p) => p.trek === undefined)!;
    expect(polityTrek(civ, other.id)).toBeNull();
  });
});
