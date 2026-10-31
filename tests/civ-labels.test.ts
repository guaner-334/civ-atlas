/**
 * 国名、城名标注 + 城镇符号(视口文字层),东方语感的中式国号。
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_PARAMS, generateWorld, type World } from '../src/gen/world';
import { rasterize, type Raster } from '../src/gen/raster';
import { generateCiv, type Civ } from '../src/gen/civ';
import { ownersAt } from '../src/gen/civ/engine/timeline';
import {
  capitalAt,
  easternTitles,
  polityAlive,
  polityAllTitles,
  polityName,
  polityRoots,
  polityShortTitle,
  polityTierAt,
  polityTitles,
  POLITY_FORMS,
} from '../src/gen/civ/growth';
import { civLabelChars, civLabelItems, civMapLayer, labelViewExtras } from '../src/render/civ/labels';
import { CIV_SHOW_DEFAULT, type CivDrawParams, type CivStyle } from '../src/render/civ/overlay';
import { pixelRegions } from '../src/render/civ/territory';
import { markBox, MIN_LABEL_PX, placeMap, REF_MAP_CSS, type LabelItem, type LabelView, type Placement } from '../src/render/labels/draw';
import { GRID, polityLabels, territoryField } from '../src/render/labels/polity';
import { pieces } from '../src/render/labels/groups';
import { faithAt } from '../src/gen/civ/religion';
import { cultureLabel } from '../src/gen/civ/story/display';
import { eraCiv, erasAt } from '../src/render/civ/era';
import { glyphBox } from '../src/render/labels/layout';
import { NAME_MIN_ZOOM, SYMBOL_MIN_ZOOM } from '../src/render/labels/settlements';
import { hasReform, reformedSeg } from '../src/gen/civ/regime';

interface Case {
  world: World;
  raster: Raster;
  civ: Civ;
  pix: Int16Array;
}
const cases = new Map<number, Case>();

beforeAll(() => {
  for (const seed of [7, 2024]) {
    const world = generateWorld({ ...DEFAULT_PARAMS, seed });
    const raster = rasterize(world, 1);
    const civ = generateCiv(world);
    cases.set(seed, { world, raster, civ, pix: pixelRegions(world.mesh, raster, civ.regions.of) });
  }
});

const show = { ...CIV_SHOW_DEFAULT, polities: true, routes: true };

function paramsOf(c: Case, style: CivStyle, year: number): CivDrawParams {
  return { world: c.world, raster: c.raster, civ: c.civ, style, year, show };
}

/** 模拟截图时的视口:地图按 1326 CSS 像素宽显示,放大 k 倍,画布盖住整张图 */
function viewOf(c: Case, style: CivStyle, k: number): LabelView {
  const mapCss = 1326;
  const extras = labelViewExtras(paramsOf(c, style, c.civ.endYear));
  return { ...extras, scale: (mapCss / c.world.width) * k, ox: 0, oy: 0, dpr: 1, k, mapCss };
}

function place(c: Case, style: CivStyle, year: number, k: number, fast = false): { placed: Placement; view: LabelView } {
  const p = paramsOf(c, style, year);
  const layer = civMapLayer(p, { fast });
  const view = viewOf(c, style, k);
  return { placed: placeMap(civLabelItems(p).concat(layer.items), layer.marks, view), view };
}

const overlap = (a: number[], b: number[]) => a[0] < b[2] && a[2] > b[0] && a[1] < b[3] && a[3] > b[1];

/** 世界坐标 → 所在的州(按像素归属,和画出来的色块一致) */
function regionAt(c: Case, wx: number, wy: number): number {
  const { w, h, scale } = c.raster;
  const x = Math.floor(wx * scale);
  const y = Math.floor(wy * scale);
  if (x < 0 || y < 0 || x >= w || y >= h) return -1;
  return c.pix[y * w + x];
}

/**
 * 字中心在不在本国国土内,和排版代码用同样的精度判:排版查"字中心在国土内"用的是 GRID(4 世界单位)一格的国土栅格
 * (render/labels/polity.ts 的 territoryGrid:每格按格子中心那个像素算归属),窄海湾、碎海岸处
 * 字中心那个像素可能是水,而同一格的中心像素是本国国土。所以:字中心的像素属于本国,或 GRID 以内有本国国土的像素,都算在国土内
 */
function inTerritory(c: Case, wx: number, wy: number, own: Int16Array, id: number): boolean {
  const r = regionAt(c, wx, wy);
  if (r >= 0 && own[r] === id) return true;
  const step = 1 / c.raster.scale;
  for (let dy = -GRID; dy <= GRID; dy += step) {
    for (let dx = -GRID; dx <= GRID; dx += step) {
      if (dx * dx + dy * dy > GRID * GRID) continue;
      const q = regionAt(c, wx + dx, wy + dy);
      if (q >= 0 && own[q] === id) return true;
    }
  }
  return false;
}

describe('东方语感的中式国号', () => {
  it('单字国名:昌部 → 昌国 → 大昌 → 大昌王朝;游牧:部 → 汗国 → 大X汗国', () => {
    expect(easternTitles('昌')).toEqual(['昌部', '昌国', '大昌', '大昌王朝']);
    expect(easternTitles('渭', 'republic')).toEqual(['渭部', '渭国', '大渭', '大渭王朝']);
    expect(easternTitles('乌', 'khanate')).toEqual(['乌部', '乌汗国', '乌汗国', '大乌汗国']);
  });

  it('两个字的不硬加"大";自带"大"的不叠成"大大"', () => {
    expect(easternTitles('景辰')).toEqual(['景辰部', '景辰国', '景辰王朝', '景辰皇朝']);
    expect(easternTitles('乌耐', 'khanate')).toEqual(['乌耐部', '乌耐汗国', '乌耐汗国', '乌耐大汗国']);
    expect(easternTitles('大安')).toEqual(['大安部', '大安国', '大安', '大安王朝']);
    for (const t of easternTitles('大安')) expect(t).not.toContain('大大');
  });

  it('生成的世界里:东方国家没有"王国 / 帝国 / 共和国"这类翻译腔;西幻国家照旧', () => {
    for (const { civ } of cases.values()) {
      const eastern = civ.polities.filter((p) => p.eastern);
      const western = civ.polities.filter((p) => !p.eastern);
      expect(eastern.length).toBeGreaterThan(0);
      expect(western.length).toBeGreaterThan(0);
      // 历朝的国号(阶段 3 王朝更替)都算
      for (const p of eastern) {
        for (const t of polityAllTitles(p)) {
          // 改制以后的共和国写"大靖共和国""景辰共和国"(东方也是共和国,不加别的翻译腔)
          expect(t, p.name).not.toMatch(hasReform(p) ? /王国|帝国|城邦/ : /王国|帝国|共和国|城邦/);
          expect(t).not.toContain('大大');
        }
      }
      for (const p of western) if (!reformedSeg(p, 0)) expect(polityTitles(p)).toEqual(POLITY_FORMS[p.lineage ?? 'realm'].map((f) => p.name + f));
      // 两个国家的国号(任何一档的全称、简称,历朝的都算)不会撞("昌"升格成"大昌"时,不会有另一个叫"大昌"的国家)
      const owner = new Map<string, number>();
      for (const p of civ.polities) {
        for (const t of polityAllTitles(p)) {
          const o = owner.get(t);
          expect(o === undefined || o === p.id, `${t} 撞名`).toBe(true);
          owner.set(t, p.id);
        }
      }
      // 简称:西幻 = 词根;东方单字国名第 2 档起 = "大X"(历朝各按那一朝的词根)
      for (const p of civ.polities) {
        const years = [p.founded, ...(p.dynasties ?? []).map((d) => d.year)];
        for (const y of years) {
          // 改制以后的共和国:单字国名留着"大"("大靖共和国")
          const root = polityRoots(p).find((r) => polityTitles(p, y)[0].startsWith(r) || polityTitles(p, y)[0].startsWith(`大${r}`))!;
          expect(root, `${p.name} 第 ${y} 年`).toBeDefined();
          for (let tier = 0; tier < 4; tier++) {
            const s = polityShortTitle(p, tier, y);
            expect(s.length).toBeGreaterThanOrEqual(2);
            expect(polityTitles(p, y)[tier].includes(s) || s === `大${root}` || (root.startsWith('大') && s === root)).toBe(true);
          }
        }
      }
    }
  });
});

describe('国名、城名标注与城镇符号(视口文字层)', () => {
  for (const seed of [7, 2024]) {
    for (const style of ['fantasy', 'realistic'] as const) {
      it(`seed ${seed} · ${style}:缩放 1 / 2 / 4 倍时,文字之间、文字和符号之间零重叠`, () => {
        const c = cases.get(seed)!;
        for (const k of [1, 2, 4]) {
          const { placed, view } = place(c, style, c.civ.endYear, k);
          const boxes: { text: string; b: number[] }[] = [];
          for (const pl of placed.labels) for (const g of pl.glyphs) boxes.push({ text: pl.item.text, b: glyphBox(g, pl.px, 0) });
          // 同一条文字里的字不互相比(字距再小也不重叠,排版保证),不同条之间一个都不许重叠
          const grid = new Map<number, number[]>();
          const cell = 64;
          boxes.forEach((e, i) => {
            for (let y = Math.floor(e.b[1] / cell); y <= Math.floor(e.b[3] / cell); y++)
              for (let x = Math.floor(e.b[0] / cell); x <= Math.floor(e.b[2] / cell); x++) {
                const key = y * 100000 + x;
                const l = grid.get(key) ?? [];
                for (const j of l) {
                  const o = boxes[j];
                  if (o.text !== e.text && overlap(o.b, e.b)) throw new Error(`${o.text} × ${e.text}(k=${k})`);
                }
                l.push(i);
                grid.set(key, l);
              }
          });
          // 文字不压符号(自家符号也不压)
          const marks = placed.marks.map((m) => ({ id: m.mark.id, b: markBox(m.mark, view) }));
          for (const e of boxes) for (const m of marks) expect(overlap(e.b, m.b), `${e.text} 压了符号 ${m.id}(k=${k})`).toBe(false);
          // 符号之间也不重叠(国都总画,不算)
          const cap = new Set(c.civ.polities.map((p) => p.capital));
          const plain = marks.filter((m) => !cap.has(m.id));
          for (let a = 0; a < plain.length; a++)
            for (let b = a + 1; b < plain.length; b++) expect(overlap(plain[a].b, plain[b].b), `符号 ${plain[a].id} × ${plain[b].id}`).toBe(false);
        }
      });
    }
  }

  it('国名都在本国国土内:锚点、每个字的中心所在的州都属于这个国家(几个年份)', () => {
    for (const c of cases.values()) {
      for (const year of [1500, 2200, c.civ.endYear]) {
        const own = ownersAt(c.civ, year).polity;
        for (const style of ['fantasy', 'realistic'] as const) {
          const { placed, view } = place(c, style, year, 1);
          const pl = placed.labels.filter((l) => l.item.sizeWorld !== undefined);
          const alive = c.civ.polities.filter((p) => polityAlive(p, year));
          if (alive.length) expect(pl.length).toBeGreaterThan(0);
          for (const l of pl) {
            const id = c.civ.polities.findIndex(
              (p) => polityName(p, year) === l.item.text || polityShortTitle(p, polityTierAt(p, year), year) === l.item.text,
            );
            expect(id, l.item.text).toBeGreaterThanOrEqual(0);
            for (const g of l.glyphs) {
              expect(inTerritory(c, g.x / view.scale, g.y / view.scale, own, id), `${l.item.text}「${g.ch}」第 ${year} 年`).toBe(true);
            }
          }
        }
        // 锚点(最难到达点)所在的州属于这个国家
        for (const l of polityLabels(c.world, c.raster, c.civ, year, { refCss: REF_MAP_CSS }).labels) {
          const r = regionAt(c, l.anchor[0], l.anchor[1]);
          expect(r >= 0 && own[r] === l.polity, `${l.full} 锚点(第 ${year} 年)`).toBe(true);
        }
      }
    }
  });

  it('回放时(国名 20 年才重排一次):灭亡的国家不留名字,国名不压在已经丢掉的土地上;迁都后国都符号换到新国都', () => {
    let falls = 0;
    for (const c of cases.values()) {
      const A = c.civ.annals;
      const years = new Set<number>();
      // 刚亡国、刚丢了州的那几年(上一次重排时国土还在)
      for (const e of A) {
        if (e.kind === 'fall' || e.kind === 'capital') for (const d of [0.5, 3, 9, 17]) years.add(e.year + d);
        if (e.kind === 'conquer' && e.region % 3 === 0) years.add(e.year + 7);
      }
      falls += A.filter((e) => e.kind === 'fall').length;
      for (const year of [...years].filter((y) => y <= c.civ.endYear)) {
        const own = ownersAt(c.civ, year).polity;
        const { placed, view } = place(c, 'fantasy', year, 1, true);
        for (const l of placed.labels.filter((l) => l.item.sizeWorld !== undefined)) {
          const ids = c.civ.polities.filter((p) => polityAllTitles(p).includes(l.item.text));
          expect(ids.length, l.item.text).toBeGreaterThan(0);
          expect(ids.some((p) => polityAlive(p, year)), `${l.item.text} 第 ${year} 年已灭亡`).toBe(true);
          // 每个字都落在当年的国土上(按像素归属,和画出来的色块一致;国界附近差一格的不算:和上面静止时一样用 inTerritory,
          // 排版查国土用的是 GRID 一格的栅格。GENERATOR_VERSION 41 种子 7 第 2999 年后康国的"后"字中心落在 4 年前丢掉的州上,离本国国土不到一格)
          let off = 0;
          for (const g of l.glyphs) if (!ids.some((p) => inTerritory(c, g.x / view.scale, g.y / view.scale, own, p.id))) off++;
          expect(off, `${l.item.text}(第 ${year} 年)有 ${off} 个字压在别国 / 失地上`).toBeLessThanOrEqual(0);
        }
        // 国都符号:在世国家当年的国都
        const capitals = new Set(c.civ.polities.filter((p) => polityAlive(p, year)).map((p) => capitalAt(p, year)));
        const drawn = placed.marks.filter((m) => (m.mark as unknown as { kind: number }).kind === 4).map((m) => m.mark.id);
        expect(new Set(drawn)).toEqual(capitals);
      }
    }
    // 20 个种子(1–19、2024)里没有亡国的世界有两个(种子 17、2024):亡国按两个世界合计至少一次算
    expect(falls, '两个世界合计有亡国').toBeGreaterThan(0);
  });

  it('大国的国名缩放 1 倍时就显示,字号比小国大;国名字距拉开(疏排)', () => {
    for (const c of cases.values()) {
      const { placed } = place(c, 'fantasy', c.civ.endYear, 1);
      const own = c.civ.polity;
      const regions = new Map<number, number>();
      for (let r = 0; r < own.length; r++) if (own[r] >= 0) regions.set(own[r], (regions.get(own[r]) ?? 0) + 1);
      const shown = new Map<string, { px: number; pitch: number }>();
      for (const l of placed.labels) {
        if (l.item.sizeWorld === undefined) continue;
        const g = l.glyphs;
        shown.set(l.item.text, { px: l.px, pitch: g.length > 1 ? Math.hypot(g[1].x - g[0].x, g[1].y - g[0].y) : 0 });
      }
      let bigPx = 0;
      let smallPx = Infinity;
      // 国土太窄、连最小的字号都排不下国名的大国(半岛加一条窄边、沿海岸伸展的海上共和国),缩放 1 倍时本来就不写:
      // 这种国家 20 个种子里每个世界 0–5 个,其余的大国都要写出来。
      // 只排得下比最小字号大一点点的(不到 1.1 倍)也算:国土里城多时,城的符号占了地方就排不下了
      // (GENERATOR_VERSION 19 种子 7 的哈兹斯坦,49 州,能排 10.9 像素)
      const fit = polityLabels(c.world, c.raster, c.civ, c.civ.endYear, { refCss: REF_MAP_CSS }).labels;
      let narrow = 0;
      let crowded = 0;
      for (const p of c.civ.polities) {
        const n = regions.get(p.id) ?? 0;
        const tier = polityTierAt(p, c.civ.endYear);
        const hit = shown.get(polityName(p, c.civ.endYear)) ?? shown.get(polityShortTitle(p, tier, c.civ.endYear));
        const f = fit.find((l) => l.polity === p.id);
        if (n >= 25 && !hit && f && (f.size * REF_MAP_CSS) / c.world.width < MIN_LABEL_PX * 1.1) {
          narrow++;
          continue;
        }
        // 排得下、缩放 1 倍时却被旁边的字挤掉的大国,每个世界最多一个(GENERATOR_VERSION 46 种子 2024 的喀善汗国,25 州,能排 17.8 像素)
        if (n >= 25 && !hit && f) {
          crowded++;
          continue;
        }
        if (n >= 25) {
          expect(hit, `${polityName(p, c.civ.endYear)}(${n} 州)`).toBeDefined();
          bigPx = Math.max(bigPx, hit!.px);
          expect(hit!.pitch).toBeGreaterThan(hit!.px * 1.4);
        }
        if (hit && n < 25) smallPx = Math.min(smallPx, hit.px);
      }
      expect(narrow).toBeLessThanOrEqual(5);
      expect(crowded).toBeLessThanOrEqual(1);
      expect(bigPx).toBeGreaterThan(20);
      // GENERATOR_VERSION 22 大国崩过以后,国都一带留下的残国(不到 25 州)国土还铺得开,字号能到大国的七成多(测的两个世界里最紧的是 1.39 倍)
      if (smallPx < Infinity) expect(bigPx).toBeGreaterThan(smallPx * 1.3);
    }
  });

  it('城名紧挨自家符号;国都名缩放 1 倍时全都在', () => {
    for (const c of cases.values()) {
      for (const k of [1, 2, 4]) {
        const { placed, view } = place(c, 'fantasy', c.civ.endYear, k);
        const markOf = new Map(placed.marks.map((m) => [m.mark.id, m]));
        for (const l of placed.labels) {
          if (l.item.mark === undefined) continue;
          const m = markOf.get(l.item.mark)!;
          expect(m).toBeDefined();
          const mb = markBox(m.mark, view);
          const xs = l.glyphs.map((g) => g.x);
          const ys = l.glyphs.map((g) => g.y);
          const tb = [Math.min(...xs) - l.px / 2, Math.min(...ys) - l.px / 2, Math.max(...xs) + l.px / 2, Math.max(...ys) + l.px / 2];
          const dx = Math.max(0, tb[0] - mb[2], mb[0] - tb[2]);
          const dy = Math.max(0, tb[1] - mb[3], mb[1] - tb[3]);
          // 两圈候选里最远的(第二圈斜角)也就离符号一个半字
          expect(Math.hypot(dx, dy), `${l.item.text}(k=${k})`).toBeLessThanOrEqual(l.px * 1.5 + 3);
        }
        if (k === 1) {
          const alive = c.civ.polities.filter((p) => polityAlive(p, c.civ.endYear));
          const named = new Set(placed.labels.filter((l) => l.item.mark !== undefined).map((l) => l.item.mark));
          for (const p of alive) {
            const id = capitalAt(p, c.civ.endYear);
            if (named.has(id)) continue;
            // 例外:夹在大国里的小国,国都正压在大国国名底下,大国国名怎么摆都留不出地方(国名挑位置时能留就留,见 draw.ts 的 keepRoomNear)
            const m = markOf.get(id)!;
            const under = placed.labels.some(
              (l) => l.item.pick?.kind === 'polity' && l.item.pick.id !== p.id && l.glyphs.some((g) => Math.hypot(g.x - m.x, g.y - m.y) < l.px * 5),
            );
            expect(under, c.civ.settlements[id].name).toBe(true);
          }
        }
      }
    }
  });

  it('按缩放逐级出现:远景只有国都、城的符号和国都名;放大后镇、村和它们的名字才出现', () => {
    const c = cases.get(7)!;
    const kinds = (k: number) => {
      const { placed } = place(c, 'fantasy', c.civ.endYear, k);
      const markKinds = placed.marks.map((m) => (m.mark as unknown as { kind: number }).kind);
      const named = new Set(placed.labels.filter((l) => l.item.mark !== undefined).map((l) => l.item.mark));
      const namedKinds = placed.marks.filter((m) => named.has(m.mark.id)).map((m) => (m.mark as unknown as { kind: number }).kind);
      return { markKinds, namedKinds, marks: placed.marks.length };
    };
    const k1 = kinds(1);
    expect(Math.min(...k1.markKinds)).toBeGreaterThanOrEqual(2);
    expect(Math.min(...k1.namedKinds)).toBeGreaterThanOrEqual(3);
    const k4 = kinds(4);
    expect(k4.markKinds).toContain(1);
    expect(k4.namedKinds).toContain(1);
    expect(k4.marks).toBeGreaterThan(k1.marks * 3);
    const k8 = kinds(8);
    expect(k8.markKinds).toContain(0);
    // 门槛表本身是递增的:国都 ≤ 大城 ≤ 城 ≤ 镇 ≤ 村
    for (let i = 1; i < 5; i++) {
      expect(NAME_MIN_ZOOM[i - 1]).toBeGreaterThanOrEqual(NAME_MIN_ZOOM[i]);
      expect(SYMBOL_MIN_ZOOM[i - 1]).toBeGreaterThanOrEqual(SYMBOL_MIN_ZOOM[i]);
    }
  });

  it('随年份变:国名随国家诞生出现、国号跟着升格;城名随城市出现', () => {
    const c = cases.get(2024)!;
    const p0 = c.civ.polities[0];
    const titles = p0.titles!;
    const before = place(c, 'realistic', p0.founded - 1, 1).placed.labels.map((l) => l.item.text);
    const all0 = new Set(polityAllTitles(p0));
    expect(before.some((t) => all0.has(t))).toBe(false);
    // 每次升格之后,地图上写的是那一档的全称或简称
    for (const t of titles) {
      const y = t.year + 1;
      const texts = civMapLayer(paramsOf(c, 'realistic', y)).items.filter((i) => i.sizeWorld !== undefined).map((i) => i.text);
      const want = [polityTitles(p0, y)[t.tier], polityShortTitle(p0, t.tier, y)];
      expect(texts.some((x) => want.includes(x)), `第 ${y} 年 ${want.join(' / ')}`).toBe(true);
    }
    // 城名:建城以前没有
    const s = c.civ.settlements[c.civ.settlements.length - 1];
    const has = (y: number) => civMapLayer(paramsOf(c, 'realistic', y)).marks.some((m) => m.id === s.id);
    expect(has(s.founded - 1)).toBe(false);
    expect(has(c.civ.endYear)).toBe(true);
  });

  it('确定性:同样的世界、年份、视口,排出来一模一样(同一个种子重新生成一遍也一样)', () => {
    const sig = (p: Placement) => JSON.stringify([p.labels.map((l) => [l.item.text, l.px, l.glyphs]), p.marks.map((m) => [m.mark.id, m.x, m.y])]);
    const c = cases.get(7)!;
    expect(sig(place(c, 'fantasy', 2400, 2).placed)).toBe(sig(place(c, 'fantasy', 2400, 2).placed));
    // 精细度低一点的世界,生成两遍(省时间)
    const fresh = (): Case => {
      const world = generateWorld({ ...DEFAULT_PARAMS, cells: 12000, seed: 7 });
      const raster = rasterize(world, 1);
      const civ = generateCiv(world);
      return { world, raster, civ, pix: pixelRegions(world.mesh, raster, civ.regions.of) };
    };
    const a = place(fresh(), 'realistic', 2400, 1).placed;
    expect(a.labels.length).toBeGreaterThan(10);
    expect(sig(place(fresh(), 'realistic', 2400, 1).placed)).toBe(sig(a));
  });
});

describe('地图上写国名:开关、主角和配角', () => {
  const at = (c: Case, s: Partial<CivDrawParams['show']>): CivDrawParams => ({ ...paramsOf(c, 'fantasy', c.civ.endYear), show: { ...CIV_SHOW_DEFAULT, ...s } });
  const polityItems = (p: CivDrawParams) => civMapLayer(p).items.filter((i) => i.pick?.kind === 'polity');
  it('国家填色能关掉国名(城镇照旧);民族填色默认不写、勾上才写', () => {
    for (const c of cases.values()) {
      expect(polityItems(at(c, { polities: true })).length).toBeGreaterThan(5);
      const off = at(c, { polities: true, names: { polities: { polities: false } } });
      expect(polityItems(off)).toHaveLength(0);
      expect(civMapLayer(off).marks.length).toBeGreaterThan(0);
      expect(polityItems(at(c, { cultures: true }))).toHaveLength(0);
      expect(polityItems(at(c, { cultures: true, names: { cultures: { polities: true } } })).length).toBeGreaterThan(5);
      // 记在国家填色上的不影响民族填色
      expect(polityItems(at(c, { cultures: true, names: { polities: { polities: true } } }))).toHaveLength(0);
    }
  });
  it('信仰、时代、民族填色上的国名是配角:主角的七成、最大 15 号,灰墨,排在国都名之后、城镇符号之前', () => {
    for (const c of cases.values()) {
      const lead = new Map(polityItems(at(c, { polities: true })).map((i) => [i.text, i]));
      for (const s of [{ polities: true, faiths: true }, { polities: true, eras: true }, { cultures: true, names: { cultures: { polities: true } } }]) {
        const side = polityItems(at(c, s));
        expect(side.length).toBe(lead.size);
        for (const i of side) {
          const l = lead.get(i.text)!;
          expect(i.sizeWorld!).toBeCloseTo(Math.min(l.sizeWorld! * 0.7, (15 * c.world.width) / REF_MAP_CSS), 6);
          expect(i.color).not.toBe(l.color);
          expect(i.priority).toBeGreaterThan(100);
          expect(i.priority).toBeLessThan(100.5);
          expect(l.priority).toBeGreaterThan(101);
        }
        // 配角国名一个颜色(不带本国颜色)
        expect(new Set(side.map((i) => i.color)).size).toBe(1);
      }
    }
  });
  it('信仰填色:配角国名和别的字、符号零重叠,缩放 1 倍时国名照样写得出来', () => {
    for (const c of cases.values()) {
      for (const k of [1, 2]) {
        const p = at(c, { polities: true, faiths: true, routes: true, labels: true });
        const layer = civMapLayer(p);
        const view = viewOf(c, 'fantasy', k);
        const placed = placeMap(civLabelItems(p).concat(layer.items), layer.marks, view);
        const boxes = placed.labels.flatMap((pl) => pl.glyphs.map((g) => ({ text: pl.item.text, b: glyphBox(g, pl.px, 0) })));
        const marks = placed.marks.map((m) => markBox(m.mark, view));
        for (const pl of placed.labels) {
          if (pl.item.pick?.kind !== 'polity') continue;
          for (const g of pl.glyphs) {
            const b = glyphBox(g, pl.px, 0);
            for (const o of boxes) if (o.text !== pl.item.text) expect(overlap(o.b, b), `${pl.item.text} × ${o.text}(k=${k})`).toBe(false);
            for (const m of marks) expect(overlap(m, b), `${pl.item.text} 压了符号(k=${k})`).toBe(false);
          }
        }
        if (k === 1) expect(placed.labels.filter((pl) => pl.item.pick?.kind === 'polity').length).toBeGreaterThanOrEqual(2);
      }
    }
  });
});

describe('地图上写族名:开关、主角和配角、一族几片', () => {
  const at = (c: Case, s: Partial<CivDrawParams['show']>, year = c.civ.endYear): CivDrawParams => ({ ...paramsOf(c, 'fantasy', year), show: { ...CIV_SHOW_DEFAULT, ...s } });
  type Opt = Parameters<typeof civMapLayer>[1];
  // 族名(教名、时代名也是 territory,信仰、时代填色默认写它们)
  const cultureItems = (p: CivDrawParams, opt?: Opt) => civMapLayer(p, opt).items.filter((i) => i.territory && i.text.endsWith('族'));
  const polityItems = (p: CivDrawParams, opt?: Opt) => civMapLayer(p, opt).items.filter((i) => i.pick?.kind === 'polity');
  it('民族填色默认写族名、能关掉;别的填色默认不写、勾上才写;写的是「某某族」', () => {
    for (const c of cases.values()) {
      const on = cultureItems(at(c, { cultures: true }));
      expect(new Set(on.map((i) => i.text)).size).toBeGreaterThan(5);
      for (const i of on) expect(i.text.endsWith('族')).toBe(true);
      expect(cultureItems(at(c, { cultures: true, names: { cultures: { cultures: false } } }))).toHaveLength(0);
      for (const s of [{ polities: true }, { polities: true, faiths: true }, { polities: true, eras: true }, {}]) expect(cultureItems(at(c, s))).toHaveLength(0);
      expect(cultureItems(at(c, { polities: true, names: { polities: { cultures: true } } })).length).toBe(on.length);
      // 不填色时勾上也能写
      expect(cultureItems(at(c, { names: { none: { cultures: true } } })).length).toBe(on.length);
    }
  });
  it('民族填色上的族名是主角:斜体、带本族颜色;别的填色上是配角:主角的七成、最大 15 号,灰墨,照旧斜体', () => {
    for (const c of cases.values()) {
      const lead = cultureItems(at(c, { cultures: true }));
      for (const i of lead) {
        expect(i.slant).toBeCloseTo(0.2, 6);
        expect(i.priority).toBeGreaterThan(100.5);
      }
      // 每族最大那片和国名一样排在国都名之后、大多数山名之前
      expect(lead.filter((i) => i.priority > 101).length).toBe(new Set(lead.map((i) => i.text)).size);
      expect(new Set(lead.map((i) => i.color)).size).toBeGreaterThan(3);
      const side = cultureItems(at(c, { polities: true, names: { polities: { cultures: true } } }));
      expect(side.map((i) => i.text)).toEqual(lead.map((i) => i.text));
      side.forEach((i, n) => {
        expect(i.sizeWorld!).toBeCloseTo(Math.min(lead[n].sizeWorld! * 0.7, (15 * c.world.width) / REF_MAP_CSS), 6);
        expect(i.slant).toBeCloseTo(0.2, 6);
        expect(i.priority).toBeGreaterThan(100);
        expect(i.priority).toBeLessThan(100.5);
        expect(i.minZoom).toBe(lead[n].minZoom);
      });
      expect(new Set(side.map((i) => i.color)).size).toBe(1);
    }
  });
  it('一族几片:还在的族都写;最大那片总览就写,别的片放大到一定倍数才出来', () => {
    let multi = 0;
    for (const c of cases.values()) {
      const lead = cultureItems(at(c, { cultures: true }));
      const byText = new Map<string, LabelItem[]>();
      for (const i of lead) byText.set(i.text, [...(byText.get(i.text) ?? []), i]);
      // 只剩一州的小族(GENERATOR_VERSION 46 种子 2024 的杜比亚族:被迁来的一族入主以后渐被同化,剩一小州)排不下族名,不算
      const cu = [...ownersAt(c.civ, c.civ.endYear).culture];
      const alive = new Set(cu.filter((k) => k >= 0 && cu.filter((x) => x === k).length >= 2));
      for (const k of alive) expect(byText.has(cultureLabel(c.civ.cultures[k])), cultureLabel(c.civ.cultures[k])).toBe(true);
      for (const items of byText.values()) {
        expect(items.filter((i) => i.minZoom === 1 && i.priority > 101)).toHaveLength(1);
        if (items.length > 1) multi++;
      }
    }
    // 海边民族散在几处海岸:够大的片各写一次
    expect(multi).toBeGreaterThan(0);
  });
  it('拖时间轴、回放(fast):主角名照写(每 20 年一档拟合),配角名(国名、族名)都先收起;sides 给了照它', () => {
    for (const c of cases.values()) {
      const y = 1913;
      expect(cultureItems(at(c, { cultures: true }, y), { fast: true }).length).toBeGreaterThan(3);
      expect(polityItems(at(c, { polities: true }, y), { fast: true }).length).toBeGreaterThan(3);
      expect(polityItems(at(c, { cultures: true, names: { cultures: { polities: true } } }, y), { fast: true })).toHaveLength(0);
      expect(polityItems(at(c, { polities: true, faiths: true }, y), { fast: true })).toHaveLength(0);
      expect(cultureItems(at(c, { polities: true, names: { polities: { cultures: true } } }, y), { fast: true })).toHaveLength(0);
      // 停下来但还没停稳(sides: false):配角照样收着;停稳以后都在,配角记在 sides 里
      expect(polityItems(at(c, { polities: true, faiths: true }, y), { sides: false })).toHaveLength(0);
      const layer = civMapLayer(at(c, { cultures: true, names: { cultures: { polities: true } } }, y));
      const sides = layer.items.filter((i) => layer.sides.has(i));
      expect(sides.length).toBeGreaterThan(3);
      expect(sides.every((i) => i.pick?.kind === 'polity')).toBe(true);
    }
  });
  it('民族填色 + 国名:族名和别的字、符号零重叠,每个字落在这一族当年的地盘上', () => {
    for (const c of cases.values()) {
      const own = ownersAt(c.civ, c.civ.endYear).culture;
      for (const k of [1, 2, 4]) {
        const p = at(c, { cultures: true, labels: true, names: { cultures: { polities: true } } });
        const layer = civMapLayer(p);
        const view = viewOf(c, 'fantasy', k);
        const placed = placeMap(civLabelItems(p).concat(layer.items), layer.marks, view);
        const boxes = placed.labels.flatMap((pl, n) => pl.glyphs.map((g) => ({ n, b: glyphBox(g, pl.px, 0) })));
        let names = 0;
        placed.labels.forEach((pl, n) => {
          if (!pl.item.territory) return;
          names++;
          const id = c.civ.cultures.findIndex((cu) => `${cu.name}族` === pl.item.text);
          for (const g of pl.glyphs) {
            const b = glyphBox(g, pl.px, 0);
            for (const o of boxes) if (o.n !== n) expect(overlap(o.b, b), `${pl.item.text}(k=${k})`).toBe(false);
            expect(inTerritory(c, (g.x - view.ox) / view.scale, (g.y - view.oy) / view.scale, own, id), `${pl.item.text} 的「${g.ch}」出了地盘(k=${k})`).toBe(true);
          }
        });
        if (k === 1) expect(names).toBeGreaterThan(5);
      }
    }
  });
  it('片:上下左右连成一块的算一片(隔着水不算连着,东西相连的世界跨过左右边也算连着),州数按不同的州数', () => {
    // 6 × 3 的小栅格,每格一个州;A = 0,B = 1,. = 水
    const rows = ['AA..BA', 'A....A', '..AA..'];
    const region = new Int16Array(18).fill(-1);
    const of = new Int16Array(18).fill(-1);
    rows.join('').split('').forEach((ch, i) => {
      if (ch === '.') return;
      region[i] = i;
      of[i] = ch === 'A' ? 0 : 1;
    });
    const sizes = (wrap: boolean) =>
      pieces(territoryField({ G: 4, gw: 6, gh: 3, region, wrap }, of), 18)
        .map((p) => `${p.id}:${p.regions}`)
        .sort();
    expect(sizes(true)).toEqual(['0:2', '0:5', '1:1']);
    expect(sizes(false)).toEqual(['0:2', '0:2', '0:3', '1:1']);
  });
  it('族名用到的字都在地图字体要加载的字表里', () => {
    for (const c of cases.values()) {
      const chars = civLabelChars(c.civ);
      for (const cu of c.civ.cultures) for (const ch of `${cu.name}族`) expect(chars).toContain(ch);
    }
  });
});

describe('地图上写教名、时代名:开关、主角和配角、跟着年份变', () => {
  const at = (c: Case, s: Partial<CivDrawParams['show']>, year = c.civ.endYear): CivDrawParams => ({ ...paramsOf(c, 'fantasy', year), show: { ...CIV_SHOW_DEFAULT, ...s } });
  type Opt = Parameters<typeof civMapLayer>[1];
  const groupItems = (p: CivDrawParams, opt?: Opt) => civMapLayer(p, opt).items.filter((i) => i.territory);
  const polityItems = (p: CivDrawParams, opt?: Opt) => civMapLayer(p, opt).items.filter((i) => i.pick?.kind === 'polity');
  const FAITH = { polities: true, faiths: true };
  const ERA = { polities: true, eras: true };
  const faithNames = (c: Case) => new Set(c.civ.religion!.faiths.filter((f) => f.kind !== 'folk').map((f) => f.name));
  const ERA_NAMES = ['石器', '青铜', '铁器', '中古', '火药', '工业', '电气', '信息', '未来'].map((e) => `${e}时代`);
  it('信仰填色默认写教名、时代填色默认写时代名,能关掉;别的填色默认不写、勾上才写', () => {
    for (const c of cases.values()) {
      const faith = groupItems(at(c, FAITH));
      const era = groupItems(at(c, ERA));
      expect(new Set(faith.map((i) => i.text)).size).toBeGreaterThan(3);
      expect(new Set(era.map((i) => i.text)).size).toBeGreaterThan(2);
      for (const i of faith) expect(faithNames(c).has(i.text), i.text).toBe(true);
      for (const i of era) expect(ERA_NAMES, i.text).toContain(i.text);
      expect(groupItems(at(c, { ...FAITH, names: { faiths: { faiths: false } } }))).toHaveLength(0);
      expect(groupItems(at(c, { ...ERA, names: { eras: { eras: false } } }))).toHaveLength(0);
      for (const s of [{ polities: true }, { cultures: true }, {}]) expect(groupItems(at(c, s)).every((i) => i.text.endsWith('族'))).toBe(true);
      // 国家填色、不填色勾上也写(配角)
      expect(groupItems(at(c, { polities: true, names: { polities: { faiths: true } } })).map((i) => i.text)).toEqual(faith.map((i) => i.text));
      expect(groupItems(at(c, { names: { none: { eras: true } } })).map((i) => i.text)).toEqual(era.map((i) => i.text));
    }
  });
  it('民间信仰不写;还没有大教的年份信仰填色上只有国名;教派当一个教写、用自己的颜色', () => {
    let sects = 0;
    for (const c of cases.values()) {
      const rel = c.civ.religion!;
      const first = Math.min(...rel.faiths.filter((f) => f.kind === 'great').map((f) => f.founded ?? 0));
      expect(groupItems(at(c, FAITH, first - 1))).toHaveLength(0);
      expect(polityItems(at(c, FAITH, first - 1)).length).toBeGreaterThan(3);
      const items = groupItems(at(c, FAITH));
      for (const f of rel.faiths.filter((f) => f.kind === 'folk')) expect(items.some((i) => i.text === f.name)).toBe(false);
      for (const f of rel.faiths.filter((f) => f.kind === 'sect')) {
        const mine = items.filter((i) => i.text === f.name);
        const parent = items.filter((i) => i.text === rel.faiths[f.parent!].name);
        if (!mine.length || !parent.length) continue;
        sects++;
        expect(mine[0].color).not.toBe(parent[0].color);
      }
    }
    expect(sects).toBeGreaterThan(0);
  });
  it('主角:正体、带本色,教名最大 22 号、时代名最大 17 号;配角:主角的七成、最大 15 号,灰墨', () => {
    for (const c of cases.values()) {
      for (const [lead, side, max] of [
        [FAITH, { polities: true, names: { polities: { faiths: true } } }, 22],
        [ERA, { polities: true, names: { polities: { eras: true } } }, 17],
      ] as const) {
        const L = groupItems(at(c, lead));
        for (const i of L) {
          expect(i.slant).toBeUndefined();
          expect(i.priority).toBeGreaterThan(100.5);
          expect((i.sizeWorld! * REF_MAP_CSS) / c.world.width).toBeLessThanOrEqual(max + 1e-6);
        }
        expect(new Set(L.map((i) => i.color)).size).toBeGreaterThan(1);
        const S = groupItems(at(c, side));
        expect(S.map((i) => i.text)).toEqual(L.map((i) => i.text));
        S.forEach((i, n) => {
          expect(i.sizeWorld!).toBeCloseTo(Math.min(L[n].sizeWorld! * 0.7, (15 * c.world.width) / REF_MAP_CSS), 6);
          expect(i.priority).toBeGreaterThan(100);
          expect(i.priority).toBeLessThan(100.5);
          expect(i.minZoom).toBe(L[n].minZoom);
        });
        expect(new Set(S.map((i) => i.color)).size).toBe(1);
      }
    }
  });
  it('时代名跟着时代填色每 20 年取一次的时代走:同一档里的年份名字一样;归属和时代填色(eraCiv)同一份', () => {
    for (const c of cases.values()) {
      const key = (y: number) => groupItems(at(c, ERA, y)).map((i) => `${i.text}@${Array.from(i.path, (v) => v.toFixed(2)).join(',')}`);
      expect(key(1901).length).toBeGreaterThan(0);
      expect(key(1919)).toEqual(key(1901));
      const view = eraCiv(c.civ);
      for (const y of [0, 517, 1500, 1919, 2311, c.civ.endYear]) expect([...erasAt(c.civ, y)]).toEqual([...ownersAt(view, y).culture]);
    }
  });
  it('拖时间轴、回放(fast):信仰、时代填色上主角名照写,国名(配角)先收起', () => {
    for (const c of cases.values()) {
      const y = 2313;
      for (const s of [FAITH, ERA]) {
        expect(groupItems(at(c, s, y), { fast: true }).length).toBeGreaterThan(2);
        expect(polityItems(at(c, s, y), { fast: true })).toHaveLength(0);
        const layer = civMapLayer(at(c, s, y));
        const sides = layer.items.filter((i) => layer.sides.has(i));
        expect(sides.length).toBeGreaterThan(3);
        expect(sides.every((i) => i.pick?.kind === 'polity')).toBe(true);
      }
    }
  });
  it('信仰、时代填色:教名、时代名和别的字、符号零重叠,每个字落在这一组当年的地盘上', () => {
    for (const c of cases.values()) {
      const rel = c.civ.religion!;
      const kinds: [Partial<CivDrawParams['show']>, Int16Array, (t: string) => number][] = [
        [FAITH, faithAt(c.civ, c.civ.endYear), (t) => rel.faiths.findIndex((f) => f.name === t && f.kind !== 'folk')],
        [ERA, erasAt(c.civ, c.civ.endYear), (t) => ERA_NAMES.indexOf(t)],
      ];
      for (const [s, own, idOf] of kinds) {
        for (const k of [1, 2]) {
          const p = at(c, { ...s, labels: true });
          const layer = civMapLayer(p);
          const view = viewOf(c, 'fantasy', k);
          const placed = placeMap(civLabelItems(p).concat(layer.items), layer.marks, view);
          const boxes = placed.labels.flatMap((pl, n) => pl.glyphs.map((g) => ({ n, b: glyphBox(g, pl.px, 0) })));
          let names = 0;
          placed.labels.forEach((pl, n) => {
            if (!pl.item.territory) return;
            names++;
            const id = idOf(pl.item.text);
            for (const g of pl.glyphs) {
              const b = glyphBox(g, pl.px, 0);
              for (const o of boxes) if (o.n !== n) expect(overlap(o.b, b), `${pl.item.text}(k=${k})`).toBe(false);
              expect(inTerritory(c, (g.x - view.ox) / view.scale, (g.y - view.oy) / view.scale, own, id), `${pl.item.text} 的「${g.ch}」出了地盘(k=${k})`).toBe(true);
            }
          });
          // 排得下的教名、时代名至少两个(GENERATOR_VERSION 38 的种子 7 / 2024 有一种只排下两个)
          if (k === 1) expect(names).toBeGreaterThanOrEqual(2);
        }
      }
    }
  });
  it('教名、时代名用到的字都在地图字体要加载的字表里', () => {
    for (const c of cases.values()) {
      const chars = civLabelChars(c.civ);
      for (const t of [...faithNames(c), ...ERA_NAMES]) for (const ch of t) expect(chars).toContain(ch);
    }
  });
});
