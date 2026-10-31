/**
 * 作者下令「大迁徙」「不许迁」(干预 trek / stay;migration.ts 的 TrekModel.order、InterventionModel.stays):
 * 指定一州时真走过去落脚;推演挑时落在走得到的地方里"地好 × 守得弱"最高的那一州;不许迁时那一族不动;
 * 接着推和一口气推完一样;令的清理、存档、分享来回;旧存档没这类令照读。
 */
import { describe, expect, it } from 'vitest';
import { generateWorld, DEFAULT_PARAMS, type World } from '../src/gen/world';
import { generateCiv, type Civ } from '../src/gen/civ';
import { ownersAt } from '../src/gen/civ/engine/timeline';
import { polityModelOf } from '../src/gen/civ/polities';
import { trekModelOf } from '../src/gen/civ/migration';
import { IV_NO_WAY, searchTrek, trekPaths, trekRouteTo } from '../src/gen/civ/trekRoute';
import { buildChronicle } from '../src/gen/civ/story/chronicle';
import { cleanIntervention, cleanInterventions, cultureKey, regionKey, type Intervention } from '../src/gen/edits';
import { decodeShare, encodeShare, makeSave, parseSave, saveText } from '../src/gen/savefile';
import { resumeCiv } from '../src/gen/civ/modules';

const SEED = 7;
/** 下令的那一年(不是 5、20 的倍数:那一刻没有隔几年一次的事件抢在干预前面) */
const Y = 1213;

let w: World | undefined;
const world = () => (w ??= generateWorld({ ...DEFAULT_PARAMS, seed: SEED }));
let b: Civ | undefined;
const base = () => (b ??= generateCiv(world()));

function bytes(a: ArrayBufferView) {
  return Buffer.from(a.buffer, a.byteOffset, a.byteLength);
}

/** Y 年州最多的那一族、它住的一州(有城的先)、从那州陆路 8–14 州远的一州(有城、不是本族的;州号最小的那个) */
function scene(civ: Civ) {
  const cu = ownersAt(civ, Y).culture;
  const n = new Map<number, number>();
  for (let r = 0; r < cu.length; r++) if (cu[r] >= 0) n.set(cu[r], (n.get(cu[r]) ?? 0) + 1);
  const c = [...n.entries()].sort((x, y) => y[1] - x[1] || x[0] - y[0])[0][0];
  const city = (r: number) => civ.settlements.some((s) => s.region === r && s.founded <= Y && (s.ended === undefined || s.ended > Y));
  const homes = [];
  for (let r = 0; r < cu.length; r++) if (cu[r] === c) homes.push(r);
  const r0 = homes.find(city) ?? homes[0];
  const P = trekPaths(civ.regions.count);
  searchTrek(civ.regions, civ.regions.count, cu, c, r0, Infinity, P);
  let to = -1;
  let far = -1;
  for (let r = 0; r < cu.length; r++) {
    if (to < 0 && P.hops[r] >= 8 && P.hops[r] <= 14 && cu[r] >= 0 && cu[r] !== c && city(r)) to = r;
    // 陆路走不到的、有人住的一州(别的陆地)
    if (far < 0 && P.hops[r] < 0 && cu[r] >= 0) far = r;
  }
  return { c, r0, to, far, route: trekRouteTo(P, to) };
}

describe('作者下令大迁徙', () => {
  it('迁往指定的州:那一年从那州分出一支,沿陆路走到那一州落脚(这一族改住进去),之前的历史一字不变', () => {
    const civ = base();
    const { c, r0, to, route } = scene(civ);
    expect(to, '找得到 8–14 州远的目的地').toBeGreaterThanOrEqual(0);
    const v: Intervention = { kind: 'trek', folk: cultureKey(civ, c), from: Y, region: regionKey(civ, r0), to: regionKey(civ, to) };
    const got = generateCiv(world(), { interventions: [v] });
    const M = got.migrations?.find((x) => x.iv === 0);
    expect(M, '记进了 Civ.migrations').toBeDefined();
    expect(M!.culture).toBe(c);
    expect(M!.year).toBe(Y);
    expect(M!.route[0]).toBe(r0);
    expect(M!.route[M!.route.length - 1]).toBe(to);
    // 和界面上估的路线同一套找路:路线一样
    expect(M!.route).toEqual(route);
    // 一州挨一州(陆路)、年份严格递增,到了落脚
    const reg = got.regions;
    for (let j = 1; j < M!.route.length; j++) {
      const a = M!.route[j - 1];
      let ok = false;
      for (let e = reg.adjStart[a]; e < reg.adjStart[a + 1]; e++) if (reg.adj[e] === M!.route[j] && reg.adjKind[e] <= 2) ok = true;
      expect(ok, `第 ${j} 步走陆路`).toBe(true);
      expect(M!.years[j]).toBeGreaterThan(M!.years[j - 1]);
    }
    expect(M!.settled).toBe(M!.years[M!.years.length - 1]);
    expect(M!.lands?.length ?? 0, '落脚改住进去的州').toBeGreaterThan(0);
    const cu = ownersAt(got, M!.settled!).culture;
    for (const r of M!.lands!) expect(cu[r]).toBe(c);
    // 史事:干预(b = −1 动身了,民族在 n,州 = 目的地)紧跟着动身
    const k = got.annals.findIndex((e) => e.kind === 'intervene' && e.war === 0);
    const e = got.annals[k];
    expect([e.year, e.a, e.b, e.n, e.region]).toEqual([Y, -1, -1, c, to]);
    expect(got.annals[k + 1]).toMatchObject({ kind: 'trek', n: 0, a: c, region: r0, year: Y });
    // 编年史:"【干预】某族一支举族某徙,往某州"
    const text = buildChronicle(got).find((x) => x.id === k)?.text ?? '';
    expect(text).toMatch(new RegExp(`^【干预】${civ.cultures[c].name}族一支举族[东南西北]徙,往`));
    // 下令那一年之前的历史一字不变
    const before = (x: Civ) => JSON.stringify(x.annals.filter((a) => a.year < Y));
    expect(before(got)).toBe(before(civ));
  }, 120_000);

  it('推演挑:落在走得到的地方里"地好 × 守得弱 × 远近"最高的那一州;近 / 远各在那一档的远近里', () => {
    const civ = base();
    const { c } = scene(civ);
    // 下令那一刻以前的样子:切在那一刻的前一格接着推
    const half = generateCiv(world(), { endYear: 1200 });
    const sim = resumeCiv(world(), half, []);
    sim.run(Y - 1 / 256);
    const tm = trekModelOf(sim)!;
    const pm = polityModelOf(sim)!;
    const values = new Map<number, number>();
    const mid = tm.pick!(c, Y, 'mid', -1, values);
    expect(values.size, '候选的州不止几个').toBeGreaterThan(5);
    expect(mid.target).toBeGreaterThanOrEqual(0);
    const best = Math.max(...values.values());
    expect(values.get(mid.target)).toBe(best);
    // 候选:有城、不是本族、走得到;值 = 地好 × 守得弱 × 远近,地好、守得弱都是正的
    for (const r of values.keys()) {
      expect(pm.cityOf[r], `州 ${r} 有城`).toBeGreaterThanOrEqual(0);
      expect(sim.owners[0][r]).not.toBe(c);
    }
    expect(mid.hops).toBeGreaterThanOrEqual(5);
    expect(mid.hops).toBeLessThanOrEqual(20);
    const near = tm.pick!(c, Y, 'near', -1);
    const far = tm.pick!(c, Y, 'far', -1);
    expect(near.hops).toBeGreaterThanOrEqual(2);
    expect(near.hops).toBeLessThanOrEqual(10);
    expect(far.hops).toBeGreaterThanOrEqual(10);
    expect(far.hops).toBeLessThanOrEqual(40);
    // 真下令时就去那一州
    const got = generateCiv(world(), { interventions: [{ kind: 'trek', folk: cultureKey(civ, c), from: Y }] });
    const M = got.migrations?.find((x) => x.iv === 0);
    expect(M?.route[M.route.length - 1]).toBe(mid.target);
    const gotFar = generateCiv(world(), { interventions: [{ kind: 'trek', folk: cultureKey(civ, c), from: Y, reach: 'far' }] });
    const F = gotFar.migrations?.find((x) => x.iv === 0);
    expect(F?.route[F.route.length - 1]).toBe(far.target);
  }, 180_000);

  it('陆路走不到的州:不动身,史事记走不成,编年史写"陆路不通"', () => {
    const civ = base();
    const { c, r0, far } = scene(civ);
    expect(far, '有一州在别的陆地上').toBeGreaterThanOrEqual(0);
    const v: Intervention = { kind: 'trek', folk: cultureKey(civ, c), from: Y, region: regionKey(civ, r0), to: regionKey(civ, far) };
    const got = generateCiv(world(), { interventions: [v] });
    expect(got.migrations?.some((x) => x.iv === 0)).toBe(false);
    const k = got.annals.findIndex((e) => e.kind === 'intervene' && e.war === 0);
    expect(got.annals[k].b).toBe(IV_NO_WAY);
    expect(buildChronicle(got).find((x) => x.id === k)?.text).toMatch(/陆路不通$/);
  }, 120_000);

  it('不许迁:推演里本来要走的那一族在生效期里不走(已经下令的照走)', () => {
    const civ = base();
    const M0 = (civ.migrations ?? []).find((x) => x.year > 400);
    expect(M0, '不下令时有一次大迁徙').toBeDefined();
    const c0 = M0!.culture;
    const from = Math.floor(M0!.year) - 30;
    const stay: Intervention = { kind: 'stay', folk: cultureKey(civ, c0), from };
    const got = generateCiv(world(), { interventions: [stay] });
    expect(got.migrations?.some((x) => x.culture === c0 && x.year >= from)).toBe(false);
    const e = got.annals.find((a) => a.kind === 'intervene' && a.war === 0)!;
    expect([e.a, e.b, e.n]).toEqual([-1, -1, c0]);
    expect(buildChronicle(got).some((x) => x.text.startsWith(`【干预】${civ.cultures[c0].name}族自此安居故土`))).toBe(true);
    // 到某一年为止:过了那一年照常可能走(规则只在生效期里挡)
    const until: Intervention = { ...stay, until: from + 1 };
    const got2 = generateCiv(world(), { interventions: [until] });
    expect(JSON.stringify(got2.migrations?.filter((x) => x.year < from))).toBe(JSON.stringify(civ.migrations?.filter((x) => x.year < from)));
    // 同时下令这一族迁往某处:照走
    const go: Intervention = { kind: 'trek', folk: cultureKey(civ, c0), from: from + 5 };
    const got3 = generateCiv(world(), { interventions: [stay, go] });
    expect(got3.migrations?.some((x) => x.iv === 1 && x.culture === c0)).toBe(true);
  }, 240_000);

  it('接着推:在动身、路上、落脚那一刻切开接着推,和带着令一口气推完逐字节一致(连同 Civ.migrations)', () => {
    const civ = base();
    const { c, r0, to } = scene(civ);
    const v: Intervention = { kind: 'trek', folk: cultureKey(civ, c), from: Y, region: regionKey(civ, r0), to: regionKey(civ, to) };
    const whole = generateCiv(world(), { interventions: [v] });
    const M = whole.migrations!.find((x) => x.iv === 0)!;
    for (const cut of [Y, Math.floor((M.year + M.settled!) / 2), M.settled!]) {
      const half = generateCiv(world(), { endYear: cut, interventions: [v] });
      const sim = resumeCiv(world(), half, [v]);
      sim.run(whole.endYear);
      const res = sim.result();
      const tag = `从第 ${cut} 年接着推`;
      expect(res.log.size, tag).toBe(whole.log.size);
      for (const k of ['year', 'region', 'layer', 'value', 'cause'] as const) {
        expect(bytes(res.log[k]).equals(bytes(whole.log[k].subarray(0, whole.log.size))), `${tag}:日志 ${k}`).toBe(true);
      }
      expect(JSON.stringify(res.annals), `${tag}:史事`).toBe(JSON.stringify(whole.annals));
      expect(JSON.stringify(trekModelOf(sim)!.list), `${tag}:大迁徙`).toBe(JSON.stringify(whole.migrations));
    }
  }, 300_000);
});

describe('大迁徙、不许迁的令:清理、存档、分享', () => {
  const trek = { kind: 'trek', folk: 'culture:c1234#0', from: 1500, region: 'region:c88', to: 'region:c99' } as const;
  const stay = { kind: 'stay', folk: 'culture:c1234#0', from: 1500, until: 1600 } as const;

  it('合格的原样返回;格式不对的去掉;给了目的地就不要远近,中是默认不写', () => {
    expect(cleanIntervention(trek)).toBe(trek);
    expect(cleanIntervention(stay)).toBe(stay);
    const pick = { kind: 'trek', folk: 'culture:c1234#0', from: 1500, reach: 'far' };
    expect(cleanIntervention(pick)).toBe(pick);
    expect(cleanIntervention({ ...trek, reach: 'far' })).toEqual(trek);
    expect(cleanIntervention({ kind: 'trek', folk: 'culture:c1234#0', from: 1500, reach: 'mid' })).toEqual({ kind: 'trek', folk: 'culture:c1234#0', from: 1500 });
    expect(cleanIntervention({ kind: 'trek', folk: 'culture:c1234#0', from: 1500, reach: 'x', to: 'polity:c1#0' })).toEqual({ kind: 'trek', folk: 'culture:c1234#0', from: 1500 });
    expect(cleanIntervention({ ...trek, folk: 'polity:c1234#0' })).toBeNull();
    expect(cleanIntervention({ kind: 'trek', from: 1500 })).toBeNull();
    expect(cleanIntervention({ ...stay, until: 1400 })).toEqual({ kind: 'stay', folk: 'culture:c1234#0', from: 1500 });
    expect(cleanIntervention({ ...stay, a: 'polity:c1#0' })).toEqual(stay);
  });

  it('存档、分享链接来回不变;旧存档里没有这类令照读', async () => {
    const interventions: Intervention[] = [{ kind: 'protect', a: 'polity:c123#0', from: 1200 }, trek, stay];
    const save = makeSave({ ...DEFAULT_PARAMS, seed: SEED }, { names: {}, interventions, terrain: [] }, '3f9a0c1d7b2e', '大迁徙', '2026-10-28T08:00:00.000Z');
    const r = parseSave(saveText(save));
    expect(r.ok && r.save.edits.interventions).toEqual(interventions);
    expect(r.ok && cleanInterventions(r.save.edits.interventions)).toEqual(interventions);
    const s = await decodeShare(await encodeShare(save));
    expect(s.ok && s.save.edits.interventions).toEqual(interventions);
    // 旧存档(没有大迁徙的令):照读,清理后原样
    const old = makeSave({ ...DEFAULT_PARAMS, seed: SEED }, { names: {}, interventions: [interventions[0]], terrain: [] }, '3f9a0c1d7b2e', '旧', '2026-10-01T08:00:00.000Z');
    const o = parseSave(saveText(old));
    expect(o.ok && o.warnings).toEqual([]);
    const list = o.ok ? o.save.edits.interventions : [];
    expect(cleanInterventions(list)).toBe(list);
  });
});
