/**
 * 大纲里的「大迁徙」情节(gen/outline.ts;格式见 gen/edits.ts 文件头"大纲"):
 * - 推演自己起的那一次对得上(同一族、那几年动身、整条路线朝那个方位)= 照着发生了;方位不对不算
 * - 没发生:那一年下一条往那个方位的大迁徙令(干预 trek 带 dir,去处推演挑;那一档没有就放宽到中、近、远),
 *   动身的年份、民族、方位和情节对得上;结果和带着同样的干预从第 0 年一口气推完一样
 * - 那个方位上走不到 = 做不到(noWay);那年那一族还没有 = 做不到;大纲页上的说法
 * - 情节、干预的清理;大纲搬到别的世界时那一族记进"要重新指"
 */
import { describe, expect, it } from 'vitest';
import { generateWorld, DEFAULT_PARAMS, type World } from '../src/gen/world';
import { generateCiv, type Civ } from '../src/gen/civ';
import { trekModelOf } from '../src/gen/civ/migration';
import { ownersAt } from '../src/gen/civ/engine/timeline';
import { runOutline } from '../src/gen/outline';
import { TREK_DIRS, TREK_DIR_NAMES, cleanIntervention, cleanPlot, cultureKey, plotNeedsRedo, resolveKey, type Plot, type TrekDir, type TrekReach } from '../src/gen/edits';
import { checkText, resultText, whatCell, whoCell, type OutlineCtx } from '../src/ui/outlineInfo';
import { interventionText } from '../src/ui/Interventions';
import { moveOutline, outlineFrom } from '../src/ui/outlineMove';
import { resumeCiv } from '../src/gen/civ/modules';

const SEED = 7;
/** 下令的那一年(不是 5、20 的倍数:那一刻没有隔几年一次的事件抢在前面) */
const Y = 1213;

let w: World | undefined;
const world = () => (w ??= generateWorld({ ...DEFAULT_PARAMS, seed: SEED }));
let b: Civ | undefined;
const base = () => (b ??= generateCiv(world()));

/** 两份历史逐项一样 */
function same(a: Civ, b: Civ, label: string) {
  expect(Object.keys(a).sort(), label).toEqual(Object.keys(b).sort());
  for (const k of Object.keys(b) as (keyof Civ)[]) expect(a[k], `${label} ${k}`).toEqual(b[k]);
}

const dirOf = (name: string) => TREK_DIRS.find((d) => TREK_DIR_NAMES[d] === name)!;

/**
 * Y 年那一刻各族往各个方位推演挑得到的去处(和下令时同一套:中、近、远三档):
 * ok = 有去处的一族一方位(中那一档没有、放宽了才有的先),no = 三档都没有的一族一方位
 */
function scenes(civ: Civ) {
  const half = generateCiv(world(), { endYear: 1200 });
  const sim = resumeCiv(world(), half, []);
  sim.run(Y - 1 / 256);
  const tm = trekModelOf(sim)!;
  const cu = ownersAt(civ, Y).culture;
  const n = new Map<number, number>();
  for (let r = 0; r < cu.length; r++) if (cu[r] >= 0) n.set(cu[r], (n.get(cu[r]) ?? 0) + 1);
  const folks = [...n.entries()].sort((x, y) => y[1] - x[1] || x[0] - y[0]).map(([c]) => c);
  let ok: { c: number; d: TrekDir; widened: boolean } | null = null;
  let no: { c: number; d: TrekDir } | null = null;
  for (const c of folks)
    for (const d of TREK_DIRS) {
      const got = (['mid', 'near', 'far'] as TrekReach[]).map((r) => tm.pick!(c, Y, r, -1, undefined, TREK_DIR_NAMES[d]).target);
      if (got.every((t) => t < 0)) no ??= { c, d };
      else if (!ok?.widened) ok = !ok || got[0] < 0 ? { c, d, widened: got[0] < 0 } : ok;
    }
  return { ok, no };
}

describe('大纲里的大迁徙', () => {
  it('推演自己起的那一次:同一族、那几年、同一个方位 = 照着发生了;方位不对不算', async () => {
    const civ = base();
    const M = civ.migrations?.find((x) => x.iv === undefined);
    expect(M, '这个世界推演自己起过大迁徙').toBeDefined();
    const y = Math.floor(M!.year);
    const folk = cultureKey(civ, M!.culture);
    const d = dirOf(M!.dir);
    const plots: Plot[] = [{ id: 1, kind: 'trek', year: y, span: 0, folk, dir: d, text: '北方部族南下' }];
    const out = (await runOutline(world(), {}, { plots, interventions: [] }))!;
    expect(out.review[0]).toEqual({ id: 1, status: 'natural', year: y });
    expect(out.interventions).toEqual([]);
    // 大纲页上那一格:"第 y 年某族一支某徙"
    const o: OutlineCtx = { civ: out.civ, plots, review: out.review };
    const F = `${civ.cultures[M!.culture].name}族`;
    expect(resultText(o, plots[0], out.review[0], out.interventions, () => '')).toBe(`第 ${y} 年${F}一支${M!.dir}徙`);
    expect(whoCell(o, plots[0]).parts[0].text).toBe(F);
    expect(whatCell(o, plots[0])).toEqual(['大迁徙', `往${M!.dir}`]);
    expect(checkText(o, plots[0])).toContain(`${F}有没有分出一支往${M!.dir}大迁徙`);
    // 不写方位也算
    const any = (await runOutline(world(), {}, { plots: [{ ...plots[0], dir: undefined }], interventions: [] }))!;
    expect(any.review[0].status).toBe('natural');
    // 方位不对不算:那一年照情节的方位另下一条令(走不到的标做不到)
    const opp = TREK_DIRS[(TREK_DIRS.indexOf(d) + 2) % 4];
    const back = (await runOutline(world(), {}, { plots: [{ ...plots[0], dir: opp }], interventions: [] }))!;
    expect(back.review[0].status).not.toBe('natural');
    if (back.review[0].status === 'forced') expect(back.civ.migrations?.find((x) => x.iv === 0)).toMatchObject({ culture: M!.culture, year: y, dir: TREK_DIR_NAMES[opp] });
    else expect(back.review[0]).toMatchObject({ status: 'failed', reason: 'noWay' });
  }, 120_000);

  it('没发生:那一年下令往那个方位迁,动身的年份、民族、方位对得上;走不到的、那年还没有这一族的标做不到', async () => {
    const civ = base();
    const { ok, no } = scenes(civ);
    expect(ok, '有一族一方位推演挑得到去处').not.toBeNull();
    expect(no, '有一族一方位三档都没有去处').not.toBeNull();
    // 那年还没有的一族(后来才分化出来的)
    const later = civ.cultures.findIndex((c) => c.born > Y + 20);
    const plots: Plot[] = [
      { id: 1, kind: 'trek', year: Y, span: 0, folk: cultureKey(civ, no!.c), dir: no!.d },
      { id: 2, kind: 'trek', year: Y, span: 0, folk: cultureKey(civ, ok!.c), dir: ok!.d, text: '某族南下' },
    ];
    if (later >= 0) plots.push({ id: 3, kind: 'trek', year: Y - 50, span: 0, folk: cultureKey(civ, later), dir: 'south' });
    // 那几年它没有自己往那个方位走
    for (const p of plots.slice(0, 2)) {
      const c = p.id === 1 ? no!.c : ok!.c;
      expect(civ.migrations?.some((x) => x.culture === c && Math.floor(x.year) === Y && x.dir === TREK_DIR_NAMES[p.dir!])).toBe(false);
    }
    const out = (await runOutline(world(), {}, { plots, interventions: [] }))!;
    const [nw, go, early] = out.review;
    expect(nw).toEqual({ id: 1, status: 'failed', year: Y, reason: 'noWay' });
    expect(go).toEqual({ id: 2, status: 'forced', year: Y });
    if (later >= 0) expect(early).toEqual({ id: 3, status: 'failed', year: Y - 50, reason: 'missing' });
    // 硬改出来的那一条:往那个方位的大迁徙令,去处推演挑
    const i = out.interventions.findIndex((v) => v.plot === 2);
    expect(out.interventions[i]).toEqual({ kind: 'trek', folk: cultureKey(civ, ok!.c), from: Y, dir: ok!.d, plot: 2 });
    expect(out.interventions.filter((v) => v.plot === 1 || v.plot === 3)).toEqual([]);
    const M = out.civ.migrations?.find((x) => x.iv === i);
    expect(M, '记进了 Civ.migrations').toBeDefined();
    expect([M!.culture, M!.year, M!.dir]).toEqual([ok!.c, Y, TREK_DIR_NAMES[ok!.d]]);
    same(out.civ, generateCiv(world(), { interventions: out.interventions }), 'seed 7 大迁徙');
    // 大纲页上的说法
    const o: OutlineCtx = { civ: out.civ, plots, review: out.review };
    const D = TREK_DIR_NAMES[no!.d];
    expect(resultText(o, plots[0], nw, out.interventions, () => '')).toBe(`做不到：第 ${Y} 年${civ.cultures[no!.c].name}族往${D}陆路走不到能去的地方`);
    const base1 = (v: Parameters<typeof interventionText>[1], k: number) => interventionText(out.civ, v, k);
    expect(resultText(o, plots[1], go, out.interventions, base1)).toBe(`第 ${Y} 年硬改：${civ.cultures[ok!.c].name}族：大迁徙，往${TREK_DIR_NAMES[ok!.d]}，去处推演挑`);
    if (later >= 0) {
      // 推完的这份历史里它后来才分化出来:写"还没出现"(硬改以后没分化出来的写"没有这一族")
      const q = resolveKey(out.civ, cultureKey(civ, later));
      const c = q?.kind === 'culture' ? out.civ.cultures[q.id] : undefined;
      const want = c && c.born > Y - 50 ? `第 ${Y - 50} 年${c.name}族还没出现` : '这段历史里没有这一族';
      expect(resultText(o, plots[2], early, out.interventions, () => '')).toBe(`做不到：${want}`);
    }
  }, 180_000);

  it('清理:大迁徙要那一族,方位只认东南西北;干预给了去处就不要方位', () => {
    const folk = 'culture:c123#0';
    expect(cleanPlot({ id: 1, kind: 'trek', year: 900 })).toBeNull();
    expect(cleanPlot({ id: 1, kind: 'trek', year: 900, folk: 'polity:c1#0' })).toBeNull();
    expect(cleanPlot({ id: 1, kind: 'trek', year: 900, folk, dir: 'south' })).toEqual({ id: 1, kind: 'trek', year: 900, folk, dir: 'south' });
    expect(cleanPlot({ id: 1, kind: 'trek', year: 900, folk, dir: 'up', a: 'polity:c1#0' })).toEqual({ id: 1, kind: 'trek', year: 900, folk });
    expect(cleanIntervention({ kind: 'trek', folk, from: 900, dir: 'west' })).toEqual({ kind: 'trek', folk, from: 900, dir: 'west' });
    expect(cleanIntervention({ kind: 'trek', folk, from: 900, dir: 'west', reach: 'far' })).toEqual({ kind: 'trek', folk, from: 900, reach: 'far', dir: 'west' });
    expect(cleanIntervention({ kind: 'trek', folk, from: 900, dir: 'west', to: 'region:c5' })).toEqual({ kind: 'trek', folk, from: 900, to: 'region:c5' });
    expect(cleanIntervention({ kind: 'trek', folk, from: 900, dir: 'sideways' })).toEqual({ kind: 'trek', folk, from: 900 });
  });

  it('大纲搬到别的世界:那一族对不上,记下原来的名字,要重新指', () => {
    const civ = base();
    const c = ownersAt(civ, Y).culture.find((x) => x >= 0)!;
    const plots: Plot[] = [{ id: 1, kind: 'trek', year: Y, folk: cultureKey(civ, c), dir: 'east' }];
    const from = outlineFrom({ civ, plots }, 'w1', 'map7');
    expect(from.names[1].folk).toBe(`${civ.cultures[c].name}族`);
    const moved = moveOutline(from, { roles: [], together: [] }, [], civ, false);
    expect(moved.plots[0]).toEqual({ id: 1, kind: 'trek', year: Y, dir: 'east', redo: { folk: `${civ.cultures[c].name}族` } });
    expect(plotNeedsRedo(moved.plots[0])).toBe(true);
    // 同一张地图、同一份历史:照旧
    expect(moveOutline(from, { roles: [], together: [] }, [], civ, true).plots[0]).toEqual(plots[0]);
  });
});
