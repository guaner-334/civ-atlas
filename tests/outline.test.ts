/**
 * 照大纲推演(gen/outline.ts;大纲的格式见 gen/edits.ts 文件头"大纲"):
 * - 照大纲推演的结果 = 带着同样的干预从第 0 年一口气推完,逐项一样(seed 7 / 2024 / 11,各一份随机大纲)
 * - 硬改:占据一片地方、立国(起名)、灭国、跟着前一条立起来的国家(`plot:编号`);只查不改的几种标"做不到";只讲故事不查
 * - 逐条查的先后:硬改的年份不早于前面落定的那年;落不进前后几年的标"前面的情节已经把这段时间定下了";超出推演年数的标出来
 * - 改了一条再推:前面没改的几条直接用上一次的,结果和从头算一样;再推前先去掉上一次硬改出来的干预
 * - 能叫停;存档往返(大纲、批改、硬改出来的干预的 plot 都带着);没大纲的世界配方不变;编年史【照大纲】(划给同一国的几州并成一条)
 * - 查得准:窗口里散了的盟也算结盟;硬改的地震水旱按下令的那一处查
 * - 大纲的清理(cleanOutline / cleanPlot)
 */
import { describe, expect, it } from 'vitest';
import { generateWorld, DEFAULT_PARAMS, type World } from '../src/gen/world';
import { generateCiv, type Civ } from '../src/gen/civ';
import { polityAlive } from '../src/gen/civ/growth';
import { ownersAt } from '../src/gen/civ/timeline';
import { buildChronicle } from '../src/gen/civ/story/chronicle';
import { runOutline, type OutlineCache } from '../src/gen/outline';
import {
  cleanIntervention,
  cleanOutline,
  cleanPlot,
  keyCells,
  ownInterventions,
  polityKey,
  regionKey,
  regionOfKey,
  resolveKey,
  type Intervention,
  type Plot,
  type WorldEdits,
} from '../src/gen/edits';
import { makeSave, parseSave, saveText } from '../src/gen/savefile';
import { recipeOfSave, recipeText } from '../src/gen/snapshot';
import { samplePlots } from '../scripts/lib/outlineSample';

const worlds = new Map<number, World>();
const world = (seed: number) => {
  let w = worlds.get(seed);
  if (!w) worlds.set(seed, (w = generateWorld({ ...DEFAULT_PARAMS, seed })));
  return w;
};
const bases = new Map<number, Civ>();
const baseCiv = (seed: number) => {
  let c = bases.get(seed);
  if (!c) bases.set(seed, (c = generateCiv(world(seed), {})));
  return c;
};

/** 两份历史逐项一样 */
function same(a: Civ, b: Civ, label: string) {
  expect(Object.keys(a).sort(), label).toEqual(Object.keys(b).sort());
  for (const k of Object.keys(b) as (keyof Civ)[]) expect(a[k], `${label} ${k}`).toEqual(b[k]);
}

/** 第 year 年两国都在的、各有几州的一对国家(a 大、b 小) */
function pairAt(civ: Civ, year: number): { a: number; b: number } {
  const own = ownersAt(civ, year).polity;
  const size = (p: number) => own.filter((x) => x === p).length;
  const alive = civ.polities.filter((p) => polityAlive(p, year) && polityAlive(p, year + 30) && size(p.id) >= 2).sort((x, y) => size(y.id) - size(x.id));
  return { a: alive[0].id, b: alive[1].id };
}

describe('照大纲推演 = 带着同样的干预从第 0 年一口气推完', () => {
  for (const seed of [7, 2024, 11]) {
    it(`seed ${seed}:12 条随机情节`, async () => {
      const w = world(seed);
      const plots = samplePlots(baseCiv(seed), seed, 12);
      expect(plots.length).toBe(12);
      const out = (await runOutline(w, {}, { plots, interventions: [] }))!;
      expect(out.review.map((r) => r.id)).toEqual(plots.map((p) => p.id));
      // 每条都有个着落;硬改出来的干预都带着它那条情节的编号、那条批改是"硬改的"
      for (const r of out.review) expect(['natural', 'forced', 'failed', 'story']).toContain(r.status);
      for (const v of out.interventions) expect(out.review.find((r) => r.id === v.plot)?.status).toBe('forced');
      expect(out.review.some((r) => r.status === 'forced')).toBe(true);
      same(out.civ, generateCiv(w, { interventions: out.interventions }), `seed ${seed}`);
    }, 120_000);
  }
});

describe('硬改和做不到', () => {
  const seed = 7;
  it('占据、立国(起名)、跟着立起来的国家亡国;只查不改的、只讲故事的', async () => {
    const w = world(seed);
    const civ = baseCiv(seed);
    const { a, b } = pairAt(civ, 1600);
    const A = polityKey(civ, a);
    const B = polityKey(civ, b);
    const own = ownersAt(civ, 1600).polity;
    const bRegions = [...own.keys()].filter((r) => own[r] === b);
    const aRegion = [...own.keys()].find((r) => own[r] === a && civ.polities[a].capital !== civ.settlements.find((s) => s.region === r)?.id)!;
    const plots: Plot[] = [
      { id: 1, kind: 'hold', year: 1600, a: A, regions: bRegions.slice(0, 2).map((r) => regionKey(civ, r)), text: '甲国夺了乙国两州' },
      { id: 2, kind: 'found', year: 1700, region: regionKey(civ, aRegion), name: '新邦', text: '新邦立国' },
      { id: 3, kind: 'fall', year: 1706, span: 3, a: 'plot:2', b: A, text: '新邦亡于甲国' },
      { id: 4, kind: 'dynasty', year: 1900, a: A, span: 0, text: '甲国改朝换代' },
      { id: 5, kind: 'story', year: 1950, text: '雨夜出逃' },
    ];
    const out = (await runOutline(w, {}, { plots, interventions: [] }))!;
    const [hold, found, fall, dyn, story] = out.review;
    expect(hold.status === 'natural' || hold.status === 'forced').toBe(true);
    if (hold.status === 'forced') {
      const o = ownersAt(out.civ, hold.year + 255 / 256).polity;
      const ra = resolveKey(out.civ, A)!.id;
      for (const r of plots[0].regions!) expect(o[regionOfKey(r, keyCells(out.civ.regions))]).toBe(ra);
    }
    expect(found.status).toBe('forced');
    expect(found.year).toBe(1700);
    const np = resolveKey(out.civ, found.polity!)!.id;
    expect(out.civ.polities[np].founded).toBeGreaterThanOrEqual(1700);
    expect(out.civ.polities[np].founded).toBeLessThan(1701);
    // 新邦亡于 1703–1709 年间(自己亡的,或硬改的)
    expect(fall, JSON.stringify(out.review)).toMatchObject({ status: expect.stringMatching(/natural|forced/) });
    const ended = out.civ.polities[np].ended!;
    expect(ended).toBeGreaterThanOrEqual(1703);
    expect(ended).toBeLessThan(1710);
    if (dyn.status === 'failed') expect(dyn.reason).toBe('unsupported');
    expect(story).toEqual({ id: 5, status: 'story', year: 1950 });
    // 立国照情节起的名字
    expect(out.interventions.find((v) => v.plot === 2)).toMatchObject({ kind: 'found', name: '新邦', from: 1700 });
    same(out.civ, generateCiv(w, { interventions: out.interventions }), 'seed 7 硬改');
    // 编年史:硬改的那几条前面标【照大纲】
    const chron = buildChronicle(out.civ);
    const marked = chron.filter((e) => e.text.startsWith('【照大纲】'));
    expect(marked.length).toBeGreaterThan(0);
    expect(chron.some((e) => e.text.startsWith('【干预】'))).toBe(false);
    // 占据一片地方硬改划的几州并成一条
    const cedes = out.interventions.filter((v) => v.plot === 1 && v.kind === 'cede').length;
    if (cedes > 1) expect(marked.filter((e) => /州划归/.test(e.text) && !e.text.includes('欲')).length).toBe(1);
  }, 120_000);

  it('先后:硬改不早于前面落定的那年;落不进窗口的、超出推演年数的标出来', async () => {
    const w = world(seed);
    const civ = baseCiv(seed);
    const { a, b } = pairAt(civ, 2000);
    const A = polityKey(civ, a);
    const B = polityKey(civ, b);
    const own = ownersAt(civ, 2000).polity;
    const rb = [...own.keys()].filter((r) => own[r] === b).map((r) => regionKey(civ, r));
    const plots: Plot[] = [
      // 同一年两条:第 1 条硬改在 2000 年,第 2 条只能在 2001 年以后
      { id: 1, kind: 'hold', year: 2000, span: 0, a: A, regions: rb.slice(0, 1) },
      { id: 2, kind: 'hold', year: 2000, span: 3, a: A, regions: rb.slice(1, 2) },
      // 窗口只有 2000 这一年:前面已经定到 2001 年以后了
      { id: 3, kind: 'war', year: 2000, span: 0, a: B, b: A },
      { id: 4, kind: 'war', year: 3200, a: A, b: B },
    ];
    const out = (await runOutline(w, {}, { plots, interventions: [] }))!;
    const [r1, r2, r3, r4] = out.review;
    expect(r1.status).toBe('forced');
    expect(r1.year).toBe(2000);
    expect(r2.status === 'natural' || r2.year >= 2001).toBe(true);
    if (r3.status === 'failed') expect(['crowded', 'gone', 'notYet']).toContain(r3.reason);
    expect(r4).toMatchObject({ status: 'failed', reason: 'beyond' });
    const forced = out.interventions.filter((v) => v.plot !== undefined);
    for (let i = 1; i < forced.length; i++) expect(forced[i].from).toBeGreaterThan(forced[i - 1].from);
    same(out.civ, generateCiv(w, { interventions: out.interventions }), 'seed 7 先后');
  }, 120_000);
});

describe('查得准', () => {
  it('窗口里散了的盟也算结盟;硬改的地震水旱按下令的那一处查', async () => {
    const seed = 7;
    const w = world(seed);
    const civ = baseCiv(seed);
    const { a, b } = pairAt(civ, 1500);
    const A = polityKey(civ, a);
    const B = polityKey(civ, b);
    // 作者自己下的结盟 1500–1510 年;情节写 1515 年前后 10 年两国结盟,不用再硬改
    const own: Intervention[] = [{ kind: 'ally', from: 1500, until: 1510, a: A, b: B }];
    // 地震水旱的那一处:第 1800 年有城的一州
    const city = civ.settlements.find((x) => x.founded < 1700 && (x.ended === undefined || x.ended > 1900))!;
    const center = regionKey(civ, city.region);
    const plots: Plot[] = [
      { id: 1, kind: 'ally', year: 1515, a: A, b: B },
      { id: 2, kind: 'disaster', year: 1800, span: 0, type: 'quake', level: 2, region: center },
    ];
    const out = (await runOutline(w, {}, { plots, interventions: own }))!;
    expect(out.review[0], JSON.stringify(out.review)).toMatchObject({ status: 'natural' });
    expect(out.review[1], JSON.stringify(out.review)).toMatchObject({ status: 'forced', year: 1800 });
    expect(out.interventions.filter((v) => v.plot === 1)).toEqual([]);
    expect(out.interventions.find((v) => v.plot === 2)).toMatchObject({ kind: 'disaster', type: 'quake', region: center, from: 1800 });
    same(out.civ, generateCiv(w, { interventions: out.interventions }), 'seed 7 查得准');
  }, 120_000);
});

describe('改了一条再推', () => {
  it('前面没改的直接用上一次的,结果和从头算一样;上一次硬改出来的先去掉', async () => {
    const seed = 2024;
    const w = world(seed);
    const plots = samplePlots(baseCiv(seed), seed, 10);
    const first = (await runOutline(w, {}, { plots, interventions: [] }, { key: 'w' }))!;
    expect(first.reused).toBe(0);
    // 改最后一条的年份;干预串照上一次的(带着硬改的)传进去
    const changed = plots.map((p, i) => (i === plots.length - 1 ? { ...p, year: p.year - 5 } : p));
    const again = (await runOutline(w, {}, { plots: changed, interventions: first.interventions }, { key: 'w', cache: first.cache }))!;
    expect(again.reused).toBe(plots.length - 1);
    const fresh = (await runOutline(w, {}, { plots: changed, interventions: [] }))!;
    expect(again.review).toEqual(fresh.review);
    expect(again.interventions).toEqual(fresh.interventions);
    same(again.civ, fresh.civ, '接着上一次算 = 从头算');
    // 键对不上(换了世界)不用上一次的
    const other = (await runOutline(w, {}, { plots: changed, interventions: [] }, { key: 'x', cache: first.cache }))!;
    expect(other.reused).toBe(0);
  }, 180_000);

  it('能叫停:查完两条就停 = null', async () => {
    const seed = 11;
    let n = 0;
    const out = await runOutline(world(seed), {}, { plots: samplePlots(baseCiv(seed), seed, 6), interventions: [] }, { progress: () => n++, stop: () => n >= 2 });
    expect(out).toBeNull();
    expect(n).toBe(2);
  }, 60_000);

  it('叫停时已经定下来的几条留着:再推接着用,结果和从头算一样', async () => {
    const seed = 2024;
    const w = world(seed);
    const plots = samplePlots(baseCiv(seed), seed, 6);
    let n = 0;
    let kept: OutlineCache | null = null;
    const out = await runOutline(w, {}, { plots, interventions: [] }, { key: 'w', progress: () => n++, stop: () => n >= 2, keep: (c) => (kept = c) });
    expect(out).toBeNull();
    expect(kept!.steps).toHaveLength(2);
    const again = (await runOutline(w, {}, { plots, interventions: [] }, { key: 'w', cache: kept }))!;
    expect(again.reused).toBe(2);
    const fresh = (await runOutline(w, {}, { plots, interventions: [] }))!;
    expect(again.review).toEqual(fresh.review);
    expect(again.interventions).toEqual(fresh.interventions);
    same(again.civ, fresh.civ, '叫停以后接着算 = 从头算');
  }, 180_000);
});

describe('存档和配方', () => {
  it('大纲、批改、硬改出来的干预往返不变;配方不看大纲', () => {
    const plots: Plot[] = [
      { id: 1, kind: 'war', year: 1520, a: 'polity:c4567#0', b: 'polity:c8123#0', text: '北燕伐南梁' },
      { id: 3, kind: 'death', year: 1600, after: 1, span: 20, person: 'person:polity:c4567#0|ruler|燕溟|1540', how: 'murdered' },
    ];
    const interventions: Intervention[] = [
      { kind: 'protect', a: 'polity:c4567#0', from: 900 },
      { kind: 'declare', a: 'polity:c4567#0', b: 'polity:c8123#0', from: 1520, plot: 1 },
    ];
    const edits: WorldEdits = { names: {}, interventions, terrain: [], outline: { plots, review: [{ id: 1, status: 'forced', year: 1520 }, { id: 3, status: 'failed', year: 1541, reason: 'notReigning' }] } };
    const save = makeSave({ ...DEFAULT_PARAMS, seed: 7 }, edits, 'x');
    const back = parseSave(saveText(save));
    if (!back.ok) throw new Error(back.error);
    expect(back.warnings).toEqual([]);
    expect(back.save.edits.outline).toEqual(edits.outline);
    expect(back.save.edits.interventions).toEqual(interventions);
    expect(cleanIntervention(interventions[1])).toBe(interventions[1]);
    expect(ownInterventions(interventions)).toEqual([interventions[0]]);
    const plain = makeSave({ ...DEFAULT_PARAMS, seed: 7 }, { ...edits, outline: undefined }, 'x');
    expect(recipeText(recipeOfSave(save))).toBe(recipeText(recipeOfSave(plain)));
    expect('outline' in plain.edits).toBe(false);
  });
});

describe('大纲的清理', () => {
  it('cleanPlot:缺字段的不要,用不上的字段去掉,年份、前后几年取整夹回', () => {
    expect(cleanPlot({ id: 1, kind: 'war', year: 10, a: 'polity:c1#0' })).toBeNull();
    expect(cleanPlot({ id: 1, kind: 'nope', year: 10 })).toBeNull();
    expect(cleanPlot({ id: 0, kind: 'story', year: 10 })).toBeNull();
    expect(cleanPlot({ id: 2, kind: 'story', year: 12.7, span: 10, city: 'settlement:c3#0', b: 'polity:c1#0' })).toEqual({ id: 2, kind: 'story', year: 12, city: 'settlement:c3#0' });
    expect(cleanPlot({ id: 2, kind: 'fall', year: 5, a: 'polity:c1#0', b: 'polity:c1#0', span: 9999 })).toEqual({ id: 2, kind: 'fall', year: 5, span: 500, a: 'polity:c1#0' });
    expect(cleanPlot({ id: 2, kind: 'hold', year: 5, a: 'plot:1' })).toBeNull();
    expect(cleanPlot({ id: 2, kind: 'hold', year: 5, a: 'plot:1', mark: 3 })).toEqual({ id: 2, kind: 'hold', year: 5, a: 'plot:1', mark: 3 });
    expect(cleanPlot({ id: 2, kind: 'disaster', year: 5, type: 'famine', city: 'settlement:c3#0', regions: ['region:c1', 'region:c1', 'x'] })).toEqual({
      id: 2,
      kind: 'disaster',
      year: 5,
      type: 'famine',
      regions: ['region:c1'],
    });
    expect(cleanPlot({ id: 2, kind: 'disaster', year: 5, type: 'plague' })).toBeNull();
    const ok: Plot = { id: 4, kind: 'found', year: 30, region: 'region:c9', name: '秦', text: '秦立国' };
    expect(cleanPlot(ok)).toBe(ok);
  });

  it('cleanOutline:编号重复的换新编号,after 只能指前面的,批改只留指得到的', () => {
    const o = cleanOutline({
      plots: [
        { id: 5, kind: 'story', year: 1, after: 6 },
        { id: 5, kind: 'story', year: 2 },
        { id: 6, kind: 'story', year: 3, after: 5 },
        { id: 7, kind: 'oops', year: 3 },
      ],
      review: [{ id: 6, status: 'story', year: 3 }, { id: 99, status: 'story', year: 3 }, { id: 5, status: 'failed', year: 1, reason: 'nope' }],
    })!;
    expect(o.plots).toEqual([
      { id: 5, kind: 'story', year: 1 },
      { id: 7, kind: 'story', year: 2 },
      { id: 6, kind: 'story', year: 3, after: 5 },
    ]);
    expect(o.review).toEqual([{ id: 5, status: 'failed', year: 1 }, { id: 6, status: 'story', year: 3 }]);
    expect(cleanOutline({ plots: [] })).toBeUndefined();
    const fine = { plots: [{ id: 1, kind: 'story', year: 3 }] };
    expect(cleanOutline(fine)).toBe(fine);
  });
});
