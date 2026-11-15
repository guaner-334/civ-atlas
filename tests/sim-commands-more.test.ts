/**
 * 推演插件的命令第二批:引擎现成的动作(停战、称臣、放藩、断盟、废约、撤中立地、划中立地、建城、推一把发展、改朝换代、分裂、改民族)
 * 和否决类(不许灭、禁止分裂、不许扩张、保住王室、不许迁)。每种:下了有效果、史事里有记、作者的干预挡得住的进 turn.refused;
 * 存下接着推和一口气推完一样;插件下的否决类挡不住作者的干预
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_PARAMS, generateWorld } from '../src/gen/world';
import { generateCiv, startCiv, startContinue, type Civ } from '../src/gen/civ';
import { packValue, unpackValue } from '../src/gen/snapshot';
import { cultureKey, foundedPolityKey, polityKey, regionKey, settlementKey, type Intervention } from '../src/gen/edits';
import { AdjKind } from '../src/gen/civ/types';
import type { PluginRefused, SimPlugin } from '../src/gen/civ/engine/plugin';
import type { SimPolity, SimRead } from '../src/gen/civ/simRead';
import { REFUSE_REASONS } from '../src/gen/civ/simApi';
import { treatyBook } from '../src/gen/civ/treatyBook';
import { polityTies, relationsAt } from '../src/gen/civ/diplomacy';
import { buildChronicle } from '../src/gen/civ/story/chronicle';
import { capitalAt, ownersAt, populationAt } from '../src/gen/readers/openQuery';
import { historyRelations } from '../src/plugin/read';
import { civDiff } from '../scripts/lib/resumeFuzz';

const w = generateWorld({ ...DEFAULT_PARAMS, cells: 12000, seed: 2024 });
/** 插件出手的那一年、推到哪年;命令生效的那一格 */
const Y = 1500;
const T = Y + 1 / 256;

/** 第 Y 年插件出手时看到的世界 */
function sceneAtY() {
  let got: { polities: SimPolity[]; owner: Int16Array; peopled: Int16Array; cities: Set<number> } | undefined;
  const scout: SimPlugin<SimRead> = {
    id: 'scout',
    every: 100,
    act(t) {
      if (t.year !== Y) return;
      const r = t.read;
      got = {
        polities: r.polities(),
        owner: r.owners('polity').slice(),
        peopled: r.owners('culture').slice(),
        cities: new Set(r.settlements().filter((s) => s.ended === undefined).map((s) => s.region)),
      };
    },
  };
  const civ = generateCiv(w, { endYear: Y, plugins: [scout] });
  return { civ, ...got! };
}

const scene = sceneAtY();
const P = scene.polities;
const alive = P.filter((p) => p.ended === undefined && p.size > 0);
const landsOf = (p: number) => [...scene.owner.keys()].filter((r) => scene.owner[r] === p);
const capRegion = (p: number) => scene.civ.settlements[P[p].capital].region;
const key = (p: number) => polityKey(scene.civ, p);

// 挑目标:交战、结盟、藩属各找一个(在没装插件的历史里找,出手那一年 y 起到 y + 1 还在);约、中立地少,插件自己先立
const base = generateCiv(w, { endYear: 3000 });
const lives = (p: number, y: number) => base.polities[p].founded < y && (base.polities[p].ended ?? Infinity) > y + 1;
function first<T>(pick: (y: number) => T | undefined): { y: number; x: T } {
  for (let y = 300; y < 2900; y += 10) {
    const x = pick(y);
    if (x !== undefined) return { y, x };
  }
  throw new Error('没找到');
}
const sameIn = (y: number, ok: (r: ReturnType<typeof relationsAt>) => boolean) => ok(relationsAt(base, y)) && ok(relationsAt(base, y + 1));
const atWar = first((y) => {
  const w0 = base.annals.find((e) => e.kind === 'war' && e.year < y && lives(e.a, y) && lives(e.b, y) && !base.annals.some((x) => x.kind === 'peace' && x.war === e.war && x.year <= y + 1));
  return w0 ? [w0.a, w0.b] : undefined;
});
const allied = first((y) => {
  const x = relationsAt(base, y).pacts.find((q) => sameIn(y, (r) => r.pacts.some((z) => z.a === q.a && z.b === q.b)));
  return x ? [x.a, x.b] : undefined;
});
const vassal = first((y) => [...relationsAt(base, y).liege.keys()].find((v) => sameIn(y, (r) => r.liege.has(v))));
const free = alive.filter((p) => p.liege < 0 && !alive.some((q) => q.liege === p.id));
/** 四州以上、国都以外还有两座城的王室国家 */
const wide = alive.find((p) => p.regime === 'crown' && p.liege < 0 && landsOf(p.id).filter((r) => r !== capRegion(p.id) && scene.cities.has(r)).length >= 2)!;
const sideCities = landsOf(wide.id).filter((r) => r !== capRegion(wide.id) && scene.cities.has(r));
const cityless = [...scene.owner.keys()].find((r) => scene.peopled[r] >= 0 && !scene.cities.has(r))!;
const otherFolk = scene.civ.cultures.findIndex((c, i) => c.ended === undefined && i !== scene.peopled[sideCities[0]] && scene.peopled.includes(i));
/** 接壤的两国(作者立约、划中立地用) */
const neighbor = (p: number) => {
  for (const r of landsOf(p)) for (const q of alive) if (q.id !== p && adjacent(r, q.id)) return q.id;
  return -1;
};
function adjacent(r: number, q: number): boolean {
  const reg = scene.civ.regions;
  for (let e = reg.adjStart[r]; e < reg.adjStart[r + 1]; e++) if (scene.owner[reg.adj[e]] === q) return true;
  return false;
}

type Log = { year: number; refused?: PluginRefused[] }[];

/** 照 plan 在那几年下命令的插件,每回合记下 turn.refused */
function probe(plan: Readonly<Record<number, unknown[]>>, log: Log, id = 'probe'): SimPlugin<SimRead> {
  return {
    id,
    every: 10,
    act(t) {
      log.push({ year: t.year, ...(t.refused ? { refused: t.refused.map((x) => ({ ...x })) } : {}) });
      const cmds = plan[t.year];
      return cmds ? { commands: cmds } : undefined;
    },
  };
}

const lastYear = (plan: Readonly<Record<number, unknown[]>>) => Math.max(0, ...Object.keys(plan).map(Number));

function run(plan: Readonly<Record<number, unknown[]>>, interventions: Intervention[] = [], endYear = lastYear(plan) + 30) {
  const log: Log = [];
  const civ = generateCiv(w, { endYear, plugins: [probe(plan, log)], interventions });
  return { civ, log, took: (civ.interventions ?? []).filter((v) => v.plugin === 'probe') };
}

/** 第 k 条命令(插件下的里第几条)那条史事 intervene,和紧跟在它后面同一刻的几条 */
function outcome(civ: Civ, k = 0) {
  const i = (civ.interventions ?? []).findIndex((v, j, all) => v.plugin === 'probe' && all.slice(0, j).filter((x) => x.plugin === 'probe').length === k);
  const at = civ.annals.findIndex((e) => e.kind === 'intervene' && e.war === i);
  const e = civ.annals[at];
  const after = civ.annals.slice(at + 1).filter((x) => x.year === e?.year);
  return { i, e, after };
}

const roundTrip = (c: Civ) => unpackValue(packValue(c)) as Civ;
const told = (log: Log) => log.filter((x) => x.refused);

/** 推到出手那一刻、生效那一格、之后几年各存一次再接着推,和一口气推完一样 */
function resumes(plan: Readonly<Record<number, unknown[]>>, interventions: Intervention[] = []) {
  const one = run(plan, interventions).civ;
  const y = Math.min(...Object.keys(plan).map(Number));
  for (const at of [y, y + 1 / 256, y + 7]) {
    const saved = roundTrip(run(plan, interventions, at).civ);
    const cont = startContinue(w, saved, { endYear: lastYear(plan) + 30, plugins: [probe(plan, [])], interventions });
    expect(cont, `${at} 接得上`).not.toBeNull();
    expect(civDiff(cont!.finish(), one), `推到 ${at} 接着推`).toBeNull();
  }
  return one;
}

/** 编年史里这条命令的那一行 */
function line(civ: Civ, k = 0): string {
  const { e } = outcome(civ, k);
  const id = civ.annals.indexOf(e);
  return buildChronicle(civ).find((x) => x.id === id)?.text ?? '';
}

describe('挑得到目标', () => {
  it('交战、结盟、藩属、约、中立地、没城的州、王室国家', () => {
    for (const x of [atWar, allied, vassal, wide]) expect(x).toBeDefined();
    expect(neighbor(wide.id)).toBeGreaterThanOrEqual(0);
    expect(cityless).toBeGreaterThanOrEqual(0);
    expect(otherFolk).toBeGreaterThanOrEqual(0);
    expect(free.length).toBeGreaterThan(2);
  });
});

describe('现成的动作:下了有效果、史事里有记、存下接着推一样', () => {
  it('停战:两国正在打的仗当即议和;没在交战的不办', () => {
    const { y, x: [a, b] } = atWar;
    const civ = resumes({ [y]: [{ kind: 'peace', a, b }] });
    const { e, after } = outcome(civ);
    expect([e.a, e.b, e.year]).toEqual([a, b, y + 1 / 256]);
    expect(e.n).toBeGreaterThanOrEqual(1);
    expect(after.some((x) => x.kind === 'peace' && [x.a, x.b].sort().join() === [a, b].sort().join())).toBe(true);
    expect(line(civ)).toMatch(/罢兵/);
    expect(outcome(run({ [Y]: [{ kind: 'peace', a: free[0].id, b: free[1].id }] }).civ).e.n).toBe(0);
  }, 120_000);

  it('称臣:a 当即向 b 称臣;已是藩属的不办', () => {
    const [a, b] = free;
    const civ = resumes({ [Y]: [{ kind: 'submit', a: a.id, b: b.id }] });
    const { e, after } = outcome(civ);
    expect(e.n).toBe(1);
    expect(after.some((x) => x.kind === 'submit' && x.a === a.id && x.b === b.id)).toBe(true);
    expect(polityTies(civ, a.id, T).liege?.liege).toBe(b.id);
    expect(line(civ)).toMatch(/称臣/);
    const { y, x: v } = vassal;
    const L = relationsAt(base, y).liege.get(v)!.liege;
    const again = run({ [y]: [{ kind: 'submit', a: v, b: L }] }).civ;
    expect(outcome(again).e.n).toBe(0);
    expect(line(again)).toMatch(/已称臣于/);
    // 自己有藩属的宗主不称臣(藩属不收藩属)
    const q = base.polities.find((x) => x.id !== L && x.id !== v && lives(x.id, y) && !relationsAt(base, y).liege.has(x.id))!;
    const lord = run({ [y]: [{ kind: 'submit', a: L, b: q.id }] }).civ;
    expect(outcome(lord).e.n).toBe(0);
    expect(line(lord)).toMatch(/自有藩属/);
    // 插件先让 a、c 结盟,a 称臣以后这个盟随之作废(和推演自己结的一样记 unally,cause = vassal);存下接着推一样
    const c = free[2];
    const sworn = resumes({ [Y]: [{ kind: 'ally', a: a.id, b: c.id }], [Y + 10]: [{ kind: 'submit', a: a.id, b: b.id }] });
    expect(outcome(sworn, 1).e.n).toBe(1);
    expect(outcome(sworn, 1).after.some((x) => x.kind === 'unally' && x.a === a.id && x.b === c.id && x.cause === 'vassal')).toBe(true);
    expect(polityTies(sworn, a.id, Y + 5).allies.some((x) => x.id === c.id)).toBe(true);
    expect(polityTies(sworn, a.id, Y + 15).allies.some((x) => x.id === c.id)).toBe(false);
  }, 120_000);

  it('放藩:藩属不再称臣;不是藩属的不办', () => {
    const { y, x: v } = vassal;
    const L = relationsAt(base, y).liege.get(v)!.liege;
    const civ = resumes({ [y]: [{ kind: 'release', a: v }] });
    const { e, after } = outcome(civ);
    expect(e.b).toBe(L);
    expect(after.some((x) => x.kind === 'defect' && x.a === v && x.cause === 'decree')).toBe(true);
    expect(polityTies(civ, v, y + 1 / 256).liege).toBeUndefined();
    expect(line(civ)).toMatch(/放藩属/);
    expect(outcome(run({ [Y]: [{ kind: 'release', a: free[0].id }] }).civ).e.b).toBe(-1);
  }, 120_000);

  it('断盟:推演结的盟当即断了;插件自己结的盟也断得了', () => {
    const { y, x: [a, b] } = allied;
    const civ = resumes({ [y]: [{ kind: 'unally', a, b }] });
    const { e, after } = outcome(civ);
    expect(e.n).toBe(1);
    expect(after.some((x) => x.kind === 'unally' && x.cause === 'decree')).toBe(true);
    expect(polityTies(civ, a, y + 1 / 256).allies.some((x) => x.id === b)).toBe(false);
    // 插件先结盟,过十年再断:断以后两国的盟不算了
    const [p, q] = free;
    const two = resumes({ [Y]: [{ kind: 'ally', a: p.id, b: q.id }], [Y + 10]: [{ kind: 'unally', a: p.id, b: q.id }] });
    expect(outcome(two, 1).e.n).toBe(1);
    expect(outcome(two, 1).after.some((x) => x.kind === 'unally' && x.cause === 'decree')).toBe(true);
    expect(polityTies(two, p.id, Y + 5).allies.some((x) => x.id === q.id)).toBe(true);
    expect(polityTies(two, p.id, Y + 15).allies.some((x) => x.id === q.id)).toBe(false);
  }, 180_000);

  it('废约:两国同在的约当即作废(插件先立约、十年后废)', () => {
    const a = wide.id;
    const b = neighbor(a);
    const civ = resumes({ [Y]: [{ kind: 'treaty', a, ps: [b] }], [Y + 10]: [{ kind: 'annul', a, b }] });
    const made = civ.annals.find((x) => x.kind === 'treaty' && x.year === T)!;
    const { e, after } = outcome(civ, 1);
    expect(e.n).toBe(1);
    expect(after.some((z) => z.kind === 'expire' && z.war === made.war && z.cause === 'decree')).toBe(true);
    expect(treatyBook(civ).treaties[made.war].ended).toBe(Y + 10 + 1 / 256);
    expect(line(civ, 1)).toMatch(/作废/);
    expect(outcome(run({ [Y]: [{ kind: 'annul', a, b }] }).civ).e.n).toBe(0);
  }, 120_000);

  it('撤中立地:这州当即不再是中立地(插件先划、十年后撤);不是中立地的不办', () => {
    const a = wide.id;
    const b = neighbor(a);
    const r = landsOf(a).find((q) => q !== capRegion(a) && adjacent(q, b))!;
    const civ = resumes({ [Y]: [{ kind: 'neutral', a, region: r, ps: [b] }], [Y + 10]: [{ kind: 'unzone', region: r }] });
    const made = civ.annals.find((x) => x.kind === 'neutral' && x.region === r && x.year === T)!;
    const { e, after } = outcome(civ, 1);
    expect(e.b).toBe(-1);
    expect(after.some((z) => z.kind === 'neutral' && z.cause === 'lapse' && z.war === made.war)).toBe(true);
    expect(line(civ, 1)).toMatch(/不复为中立地/);
    expect(outcome(run({ [Y]: [{ kind: 'unzone', region: capRegion(a) }] }).civ).e.b).toBe(-21);
  }, 120_000);

  it('建城:没城的州当即建一座城;已有城的不办', () => {
    const civ = resumes({ [Y]: [{ kind: 'city', region: cityless }] });
    const { e } = outcome(civ);
    expect(e.b).toBe(-1);
    expect(civ.settlements[e.settlement]).toMatchObject({ region: cityless, founded: T });
    expect(line(civ)).toMatch(/筑/);
    expect(outcome(run({ [Y]: [{ kind: 'city', region: capRegion(wide.id) }] }).civ).e.b).toBe(-22);
  }, 120_000);

  it('改朝换代:王室国家当即换一朝(新朝起于点名的州);存下接着推一样', () => {
    const civ = resumes({ [Y]: [{ kind: 'dynasty', a: wide.id, region: sideCities[0] }] });
    const { e, after } = outcome(civ);
    expect(e.b).toBe(-1);
    const d = after.find((x) => x.kind === 'dynasty' && x.a === wide.id)!;
    expect(d.region).toBe(sideCities[0]);
    expect(civ.polities[wide.id].dynasties!.some((x) => x.year === T)).toBe(true);
  }, 120_000);

  it('分裂:点名的州(连同断开的碎块)分出去立新国,国都是其中最大的城;国都不分', () => {
    const civ = resumes({ [Y]: [{ kind: 'secede', a: wide.id, regions: [...sideCities, capRegion(wide.id)], name: '东国' }] });
    const { e, after } = outcome(civ);
    const n = civ.polities[e.b];
    expect(n).toMatchObject({ founded: T, parent: wide.id });
    expect(after.some((x) => x.kind === 'split' && x.a === e.b && x.b === wide.id && x.cause === 'decree')).toBe(true);
    expect(e.n).toBeGreaterThanOrEqual(sideCities.length);
    expect(civ.settlements[n.capital].region).not.toBe(capRegion(wide.id));
    expect(line(civ)).toMatch(/自立/);
    // 只点了国都:不办
    expect(outcome(run({ [Y]: [{ kind: 'secede', a: wide.id, regions: [capRegion(wide.id)] }] }).civ).e.b).toBe(-23);
  }, 120_000);

  it('改民族:这州的民族当即换成点名的那一族', () => {
    const r = sideCities[0];
    const civ = resumes({ [Y]: [{ kind: 'convert', region: r, folk: otherFolk }] });
    const { e, after } = outcome(civ);
    expect([e.b, e.n, e.region]).toEqual([-1, otherFolk, r]);
    expect(after.some((x) => x.kind === 'assimilate' && x.a === otherFolk && x.region === r && x.cause === 'decree')).toBe(true);
    expect(line(civ)).toMatch(/化为/);
  }, 120_000);

  it('划中立地、推一把发展(快几倍:这个世界头一条也挂得上)', () => {
    const b = neighbor(wide.id);
    const r = landsOf(wide.id).find((q) => q !== capRegion(wide.id) && adjacent(q, b))!;
    const civ = resumes({ [Y]: [{ kind: 'neutral', a: wide.id, region: r, ps: [b] }, { kind: 'boost', a: wide.id, mul: 10, until: Y + 20 }] });
    expect(outcome(civ, 0).e.b).toBe(-1);
    expect(civ.annals.some((x) => x.kind === 'neutral' && x.region === r && x.year === T)).toBe(true);
    expect(outcome(civ, 1).e.b).toBe(-1);
    // 推了的国都长得比不推快(推演插件下的头一条快几倍,这时才挂上)
    const dev = (c: Civ) => c.development!.state!.cur.slice(capRegion(wide.id) * 5, capRegion(wide.id) * 5 + 4).reduce((x, y) => x + y, 0);
    expect(dev(run({ [Y]: [{ kind: 'boost', a: wide.id, mul: 10, until: Y + 20 }] }).civ)).toBeGreaterThan(dev(run({}, [], Y + 30).civ));
  }, 120_000);
});

describe('否决类:管推演自己的事,挡不住作者的干预,也不挡插件的命令', () => {
  it('不许扩张(带 until):它挑起的仗当即议和,到期重新扩张;存下接着推跨过到期那一刻也一样', () => {
    const { y, x: [a] } = atWar;
    const plan = { [y]: [{ kind: 'halt', a, until: y + 12 }] };
    const civ = resumes(plan);
    expect(outcome(civ).e.b).toBe(-1);
    // 到期那一刻、到期以后存下接着推
    for (const at of [y + 12, y + 12 + 1 / 256, y + 15]) {
      const cont = startContinue(w, roundTrip(run(plan, [], at).civ), { endYear: y + 30, plugins: [probe(plan, [])] });
      expect(civDiff(cont!.finish(), civ), `推到 ${at}`).toBeNull();
    }
  }, 180_000);

  it('不许灭、禁止分裂、保住王室、不许迁:收下、记史事;存下接着推一样', () => {
    const civ = resumes({
      [Y]: [
        { kind: 'protect', a: wide.id, until: Y + 20 },
        { kind: 'unity', a: wide.id, until: Y + 20 },
        { kind: 'keep', a: wide.id },
        { kind: 'stay', folk: wide.culture },
      ],
    });
    for (let k = 0; k < 4; k++) expect(outcome(civ, k).e, `第 ${k} 条`).toBeDefined();
    expect(line(civ, 1)).toMatch(/至第 1520 年/);
  }, 120_000);

  it('插件的不许灭挡不住作者的灭国;插件自己先下不许灭、后下灭国:照灭', () => {
    const order: Intervention = { kind: 'destroy', a: key(wide.id), from: Y + 5 };
    const civ = run({ [Y]: [{ kind: 'protect', a: wide.id }] }, [order]).civ;
    expect(civ.polities[wide.id].ended).toBe(Y + 5);
    const mine = run({ [Y]: [{ kind: 'protect', a: wide.id }], [Y + 10]: [{ kind: 'destroy', a: wide.id }] }).civ;
    expect(mine.polities[wide.id].ended).toBe(Y + 10 + 1 / 256);
  }, 120_000);

  it('插件的保住王室挡得住推演自己的改朝换代:没下时有、下了没有(seed 2024,一国一直保着)', () => {
    const base = generateCiv(w, { endYear: 3000 });
    const busy = base.polities.find((p) => p.founded < Y && (p.ended ?? 3000) > 2500 && (p.dynasties ?? []).filter((d) => d.year > Y).length >= 1)!;
    expect(busy).toBeDefined();
    const kept = generateCiv(w, { endYear: 3000, plugins: [probe({ [Y]: [{ kind: 'keep', a: busy.id }] }, [])] });
    expect((kept.polities[busy.id].dynasties ?? []).filter((d) => d.year > Y).length).toBe(0);
  }, 120_000);
});

describe('作者的干预挡下命令(新的几种挡法)', () => {
  const AT = { from: Y, fromTick: 1 } as const;
  it.each([
    { name: '保住王室挡改朝换代', cmd: () => ({ kind: 'dynasty', a: wide.id }), author: (): Intervention => ({ kind: 'keep', a: key(wide.id), ...AT }), why: 'keep' },
    { name: '禁止分裂挡分裂', cmd: () => ({ kind: 'secede', a: wide.id, regions: sideCities }), author: (): Intervention => ({ kind: 'unity', a: key(wide.id), ...AT }), why: 'unity' },
    { name: '不许扩张挡别国向它称臣', cmd: () => ({ kind: 'submit', a: free[0].id, b: free[1].id }), author: (): Intervention => ({ kind: 'halt', a: key(free[1].id), ...AT }), why: 'halt' },
    { name: '作者的结盟挡断盟', cmd: () => ({ kind: 'unally', a: free[0].id, b: free[1].id }), author: (): Intervention => ({ kind: 'ally', a: key(free[0].id), b: key(free[1].id), ...AT }), why: 'ally' },
  ])('$name', ({ cmd, author, why }) => {
    const plan = { [Y]: [cmd()] };
    const got = run(plan, [author()]);
    expect(got.took).toEqual([]);
    expect(told(got.log)).toEqual([{ year: Y + 10, refused: [{ kind: (cmd() as { kind: string }).kind, index: 0, why }] }]);
    expect(REFUSE_REASONS).toContain(why);
  }, 60_000);

  it('作者立的约挡废约、作者划的中立地挡撤中立地;插件自己立的照废', () => {
    const a = wide.id;
    const b = neighbor(a);
    const r = landsOf(a).find((q) => q !== capRegion(a) && adjacent(q, b))!;
    const orders: Intervention[] = [
      { kind: 'treaty', a: key(a), ps: [key(b)], from: Y - 10, keep: true },
      { kind: 'neutral', a: key(a), region: regionKey(scene.civ, r), ps: [key(b)], from: Y - 10, lasting: true },
    ];
    const got = run({ [Y]: [{ kind: 'annul', a, b }, { kind: 'unzone', region: r }] }, orders);
    expect(got.took).toEqual([]);
    expect(told(got.log)[0].refused).toEqual([
      { kind: 'annul', index: 0, why: 'treaty' },
      { kind: 'unzone', index: 1, why: 'neutral' },
    ]);
    const mine = run({ [Y - 10]: [{ kind: 'treaty', a, ps: [b], keep: true }], [Y]: [{ kind: 'annul', a, b }] });
    expect(told(mine.log)).toEqual([]);
    expect(outcome(mine.civ, 1).e.n).toBeGreaterThanOrEqual(1);
    // 插件立的约、作者依这份约划的中立地:废约会连带撤掉它,照撤中立地挡
    const zoned = run({ [Y - 20]: [{ kind: 'treaty', a, ps: [b], keep: true }], [Y]: [{ kind: 'annul', a, b }] }, [{ kind: 'neutral', a: key(a), region: regionKey(scene.civ, r), ps: [key(b)], from: Y - 10 }]);
    expect(zoned.civ.annals.some((x) => x.kind === 'neutral' && x.region === r && x.cause === 'decree' && x.year === Y - 10)).toBe(true);
    expect(told(zoned.log)).toEqual([{ year: Y + 10, refused: [{ kind: 'annul', index: 0, why: 'neutral' }] }]);
  }, 120_000);

  it('同一批先撤中立地、再在那州立国:照还回去的原主挡(禁止分裂)', () => {
    const a = wide.id;
    const b = neighbor(a);
    const r = landsOf(a).find((q) => q !== capRegion(a) && adjacent(q, b))!;
    const got = run({ [Y]: [{ kind: 'neutral', a, region: r, ps: [b] }], [Y + 10]: [{ kind: 'unzone', region: r }, { kind: 'found', region: r }] }, [{ kind: 'unity', a: key(a), ...AT }]);
    expect(told(got.log)).toEqual([{ year: Y + 20, refused: [{ kind: 'found', index: 1, why: 'unity' }] }]);
    expect(got.took.map((v) => v.kind)).toEqual(['neutral', 'unzone']);
    // 废约连带撤了中立地,一样照还回去的原主挡
    const viaAnnul = run({ [Y]: [{ kind: 'treaty', a, ps: [b], zone: r }], [Y + 10]: [{ kind: 'annul', a, b }, { kind: 'found', region: r }] }, [{ kind: 'unity', a: key(a), ...AT }]);
    expect(viaAnnul.civ.annals.some((x) => x.kind === 'neutral' && x.region === r && x.year === T)).toBe(true);
    expect(told(viaAnnul.log)).toEqual([{ year: Y + 20, refused: [{ kind: 'found', index: 1, why: 'unity' }] }]);
  }, 60_000);

  it('民族键也认(改民族)', () => {
    const got = run({ [Y]: [{ kind: 'convert', region: sideCities[0], folk: cultureKey(scene.civ, otherFolk) }] });
    expect(outcome(got.civ).e.n).toBe(otherFolk);
  }, 60_000);

  it('同一批先分裂立新国、再拿它的稳定键划走受保护独城国的国都:照不许灭挡', () => {
    const { y, x: { solo, soloCap, parent, seat } } = first((y) => {
      const own = ownersAt(base, y).polity;
      const cs = base.settlements.filter((s) => s.founded <= y && (s.ended === undefined || s.ended > y));
      const cityAt = new Map(cs.map((s) => [s.region, s]));
      const ps = base.polities.filter((p) => lives(p.id, y));
      const solo = ps.find((p) => [...own.keys()].filter((r) => own[r] === p.id && cityAt.has(r)).length === 1);
      if (!solo) return undefined;
      const soloCap = base.settlements[capitalAt(solo, y)].region;
      const parent = ps.find((p) => {
        if (p.id === solo.id) return false;
        const cap = base.settlements[capitalAt(p, y)].region;
        return [...own.keys()].some((r) => own[r] === p.id && r !== cap && cityAt.has(r));
      });
      if (!parent) return undefined;
      const pCap = base.settlements[capitalAt(parent, y)].region;
      const sides = [...own.keys()].filter((r) => own[r] === parent.id && r !== pCap && cityAt.has(r));
      sides.sort((a, b) => populationAt(cityAt.get(b)!, y + 1 / 256) - populationAt(cityAt.get(a)!, y + 1 / 256));
      return { solo: solo.id, soloCap, parent: parent.id, seat: sides[0] };
    });
    const before = generateCiv(w, { endYear: y });
    const born = foundedPolityKey(before, regionKey(before, seat), y + 1 / 256)!;
    const got = run(
      { [y]: [{ kind: 'secede', a: parent, regions: [seat] }, { kind: 'cede', a: born, region: soloCap }] },
      [{ kind: 'protect', a: polityKey(before, solo), from: y, fromTick: 1 }],
    );
    expect(told(got.log)).toEqual([{ year: y + 10, refused: [{ kind: 'cede', index: 1, why: 'protect' }] }]);
    expect(got.took.map((v) => v.kind)).toEqual(['secede']);
    expect(got.civ.polities[solo].ended).not.toBe(y + 1 / 256);
  }, 60_000);

  it('同一批先划走一条通路再分裂另一条:按投影归属算断开的州,照不许灭挡', () => {
    const reg = base.regions;
    const reach = (own: ArrayLike<number>, p: number, cap: number, skip: ReadonlySet<number>) => {
      const seen = new Set<number>([cap]);
      const q = [cap];
      for (let h = 0; h < q.length; h++) {
        const r = q[h];
        for (let k = reg.adjStart[r]; k < reg.adjStart[r + 1]; k++) {
          if (reg.adjKind[k] === AdjKind.SeaRoute) continue;
          const j = reg.adj[k];
          if (!seen.has(j) && !skip.has(j) && own[j] === p) {
            seen.add(j);
            q.push(j);
          }
        }
      }
      return seen;
    };
    const { y, x: { p, other, cap, mid1, rs } } = first((y) => {
      if (y < 350) return undefined;
      const own = ownersAt(base, y).polity;
      const cities = new Set(base.settlements.filter((s) => s.founded <= y && (s.ended === undefined || s.ended > y)).map((s) => s.region));
      const ps = base.polities.filter((x) => x.founded < y - 35 && lives(x.id, y));
      const settled = (r: number, id: number) => {
        for (let t = y - 35; t <= y; t += 5) if (ownersAt(base, t).polity[r] !== id) return false;
        return true;
      };
      for (const pol of ps) {
        const other = ps.find((x) => x.id !== pol.id);
        if (!other) continue;
        const cap = base.settlements[capitalAt(pol, y)].region;
        const full = reach(own, pol.id, cap, new Set());
        const nonCap = [...full].filter((r) => r !== cap);
        for (const far of nonCap) {
          if (!cities.has(far)) continue;
          for (const mid1 of nonCap) {
            if (mid1 === far) continue;
            for (const mid2 of nonCap) {
              if (mid2 === far || mid2 === mid1) continue;
              const rs = [mid2, ...nonCap.filter((r) => r !== far && r !== mid1 && r !== mid2 && cities.has(r))];
              const rsSet = new Set(rs);
              if (!reach(own, pol.id, cap, rsSet).has(far)) continue;
              const rest = reach(own, pol.id, cap, new Set([mid1, ...rs]));
              if (rest.has(far)) continue;
              const disc = [...full].filter((r) => r !== mid1 && !rsSet.has(r) && !rest.has(r));
              if (disc.some((r) => !settled(r, pol.id))) continue;
              return { p: pol.id, other: other.id, cap, mid1, rs };
            }
          }
        }
      }
      return undefined;
    });
    const got = run(
      { [y]: [{ kind: 'cede', a: other, region: mid1 }, { kind: 'secede', a: p, regions: rs }, { kind: 'found', region: cap }] },
      [{ kind: 'protect', a: polityKey(base, p), from: y, fromTick: 1 }],
    );
    expect(told(got.log)).toEqual([{ year: y + 10, refused: [{ kind: 'found', index: 2, why: 'protect' }] }]);
    expect(got.took.map((v) => v.kind)).toEqual(['cede', 'secede']);
    expect(got.civ.polities[p].ended).not.toBe(y + 1 / 256);
  }, 60_000);

  it('同一批先把两城国的另一座城划中立地、再在国都立国:照不许灭挡', () => {
    const { y, x: { two, other, cap, side } } = first((y) => {
      const own = ownersAt(base, y).polity;
      const liege = relationsAt(base, y).liege;
      const cities = new Set(base.settlements.filter((s) => s.founded <= y && (s.ended === undefined || s.ended > y)).map((s) => s.region));
      const ps = base.polities.filter((p) => lives(p.id, y) && !liege.has(p.id));
      for (const p of ps) {
        const cs = [...own.keys()].filter((r) => own[r] === p.id && cities.has(r));
        if (cs.length !== 2) continue;
        const cap = base.settlements[capitalAt(p, y)].region;
        const side = cs.find((r) => r !== cap);
        const other = ps.find((q) => q.id !== p.id);
        if (side !== undefined && other) return { two: p.id, other: other.id, cap, side };
      }
      return undefined;
    });
    const got = run(
      { [y]: [{ kind: 'neutral', a: two, region: side, ps: [other] }, { kind: 'found', region: cap }] },
      [{ kind: 'protect', a: polityKey(base, two), from: y, fromTick: 1 }],
    );
    expect(told(got.log)).toEqual([{ year: y + 10, refused: [{ kind: 'found', index: 1, why: 'protect' }] }]);
    expect(got.took.map((v) => v.kind)).toEqual(['neutral']);
    expect(got.civ.polities[two].ended).not.toBe(y + 1 / 256);
  }, 60_000);

  it('同一批先请别国共建中立地遭拒、再在国都立国:对方不肯不挪归属,不误挡', () => {
    const { y, x: { two, vassalOther, cap, side } } = first((y) => {
      const own = ownersAt(base, y).polity;
      const liege = relationsAt(base, y).liege;
      const cities = new Set(base.settlements.filter((s) => s.founded <= y && (s.ended === undefined || s.ended > y)).map((s) => s.region));
      const ps = base.polities.filter((p) => lives(p.id, y));
      for (const p of ps) {
        if (liege.has(p.id)) continue;
        const cs = [...own.keys()].filter((r) => own[r] === p.id && cities.has(r));
        if (cs.length !== 2) continue;
        const cap = base.settlements[capitalAt(p, y)].region;
        const side = cs.find((r) => r !== cap);
        const vassalOther = ps.find((q) => q.id !== p.id && liege.has(q.id) && liege.get(q.id)!.liege !== p.id);
        if (side !== undefined && vassalOther) return { two: p.id, vassalOther: vassalOther.id, cap, side };
      }
      return undefined;
    });
    const guard: Intervention[] = [{ kind: 'protect', a: polityKey(base, two), from: y, fromTick: 1 }];
    const got = run({ [y]: [{ kind: 'neutral', a: two, region: side, ps: [vassalOther], ask: true }, { kind: 'found', region: cap }] }, guard);
    expect(told(got.log)).toEqual([]);
    expect(got.took.map((v) => v.kind)).toEqual(['neutral', 'found']);
    expect(got.civ.polities[two].ended).not.toBe(y + 1 / 256);
    const viaTreaty = run({ [y]: [{ kind: 'treaty', a: two, ps: [vassalOther], zone: side, ask: true }, { kind: 'found', region: cap }] }, guard);
    expect(told(viaTreaty.log)).toEqual([]);
    expect(viaTreaty.took.map((v) => v.kind)).toEqual(['treaty', 'found']);
    expect(viaTreaty.civ.polities[two].ended).not.toBe(y + 1 / 256);
  }, 120_000);

  it('同一批先划中立地再废约、再在国都立国:撤回原主的不误挡,一直留着的照不许灭挡', () => {
    const reg = base.regions;
    const isLand = (k: number) => k === AdjKind.Flat || k === AdjKind.River || k === AdjKind.Mountain;
    const { y, x: { two, other, cap, side } } = first((y) => {
      const own = ownersAt(base, y).polity;
      const liege = relationsAt(base, y).liege;
      const cities = new Set(base.settlements.filter((s) => s.founded <= y && (s.ended === undefined || s.ended > y)).map((s) => s.region));
      const ps = base.polities.filter((p) => lives(p.id, y) && !liege.has(p.id));
      for (const p of ps) {
        const cs = [...own.keys()].filter((r) => own[r] === p.id && cities.has(r));
        if (cs.length !== 2) continue;
        const cap = base.settlements[capitalAt(p, y)].region;
        const side = cs.find((r) => r !== cap);
        if (side === undefined) continue;
        let touchesRest = false;
        for (let e = reg.adjStart[side]; e < reg.adjStart[side + 1]; e++) {
          if (isLand(reg.adjKind[e]) && reg.adj[e] !== side && own[reg.adj[e]] === p.id) touchesRest = true;
        }
        const other = ps.find((q) => q.id !== p.id);
        if (touchesRest && other) return { two: p.id, other: other.id, cap, side };
      }
      return undefined;
    });
    const guard: Intervention[] = [{ kind: 'protect', a: polityKey(base, two), from: y, fromTick: 1 }];
    const restored = run(
      { [y]: [{ kind: 'neutral', a: two, region: side, ps: [other] }, { kind: 'annul', a: two, b: other }, { kind: 'found', region: cap }] },
      guard,
    );
    expect(told(restored.log)).toEqual([]);
    expect(restored.took.map((v) => v.kind)).toEqual(['neutral', 'annul', 'found']);
    expect(restored.civ.polities[two].ended).not.toBe(y + 1 / 256);
    const lasting = run(
      { [y]: [{ kind: 'neutral', a: two, region: side, ps: [other], lasting: true }, { kind: 'annul', a: two, b: other }, { kind: 'found', region: cap }] },
      guard,
    );
    expect(told(lasting.log)).toEqual([{ year: y + 10, refused: [{ kind: 'found', index: 2, why: 'protect' }] }]);
    expect(lasting.took.map((v) => v.kind)).toEqual(['neutral', 'annul']);
  }, 120_000);

  it('同一批先迁都到另一座城再划它做中立地、再在旧国都立国:新国都划不成,不误挡', () => {
    const { y, x: { two, other, oldCap, newCap, newCity } } = first((y) => {
      const own = ownersAt(base, y).polity;
      const liege = relationsAt(base, y).liege;
      const liveCities = base.settlements.filter((s) => s.founded < y && (s.ended === undefined || s.ended > y));
      const cityAt = new Map(liveCities.map((s) => [s.region, s.id]));
      const ps = base.polities.filter((p) => lives(p.id, y) && !liege.has(p.id));
      for (const p of ps) {
        const cs = [...own.keys()].filter((r) => own[r] === p.id && cityAt.has(r));
        if (cs.length !== 2) continue;
        const oldCap = base.settlements[capitalAt(p, y)].region;
        const newCap = cs.find((r) => r !== oldCap);
        const other = ps.find((q) => q.id !== p.id);
        if (newCap !== undefined && other) return { two: p.id, other: other.id, oldCap, newCap, newCity: settlementKey(base, cityAt.get(newCap)!) };
      }
      return undefined;
    });
    const guard: Intervention[] = [{ kind: 'protect', a: polityKey(base, two), from: y, fromTick: 1 }];
    const got = run(
      { [y]: [{ kind: 'move', a: two, city: newCity }, { kind: 'neutral', a: two, region: newCap, ps: [other] }, { kind: 'found', region: oldCap }] },
      guard,
    );
    expect(told(got.log)).toEqual([]);
    expect(got.took.map((v) => v.kind)).toEqual(['move', 'neutral', 'found']);
    expect(got.civ.polities[two].ended).not.toBe(y + 1 / 256);
    const viaTreaty = run(
      { [y]: [{ kind: 'move', a: two, city: newCity }, { kind: 'treaty', a: two, ps: [other], zone: newCap }, { kind: 'found', region: oldCap }] },
      guard,
    );
    expect(told(viaTreaty.log)).toEqual([]);
    expect(viaTreaty.took.map((v) => v.kind)).toEqual(['move', 'treaty', 'found']);
    expect(viaTreaty.civ.polities[two].ended).not.toBe(y + 1 / 256);
  }, 120_000);

  it('同一批先划中立地再宣战背约、再在国都立国:撤回原主的不误挡,一直留着的照不许灭挡', () => {
    const reg = base.regions;
    const isLand = (k: number) => k === AdjKind.Flat || k === AdjKind.River || k === AdjKind.Mountain;
    const { y, x: { two, other, cap, side } } = first((y) => {
      const own = ownersAt(base, y).polity;
      const liege = relationsAt(base, y).liege;
      const cities = new Set(base.settlements.filter((s) => s.founded <= y && (s.ended === undefined || s.ended > y)).map((s) => s.region));
      const ps = base.polities.filter((p) => lives(p.id, y) && !liege.has(p.id));
      const inWar = (a: number, b: number) =>
        base.annals.some(
          (e) =>
            e.kind === 'war' &&
            e.year <= y &&
            ((e.a === a && e.b === b) || (e.a === b && e.b === a)) &&
            !base.annals.some((x) => x.kind === 'peace' && x.war === e.war && x.year <= y),
        );
      for (const p of ps) {
        const lands = [...own.keys()].filter((r) => own[r] === p.id);
        const cs = lands.filter((r) => cities.has(r));
        if (cs.length !== 2) continue;
        const cap = base.settlements[capitalAt(p, y)].region;
        const side = cs.find((r) => r !== cap);
        if (side === undefined) continue;
        const rest = lands.filter((r) => r !== side);
        const touchesRest = rest.some((r) => {
          for (let e = reg.adjStart[r]; e < reg.adjStart[r + 1]; e++) if (isLand(reg.adjKind[e]) && reg.adj[e] === side) return true;
          return false;
        });
        if (!touchesRest) continue;
        for (const q of ps) {
          if (q.id === p.id || inWar(p.id, q.id)) continue;
          const bordersElsewhere = rest.some((r) => {
            for (let e = reg.adjStart[r]; e < reg.adjStart[r + 1]; e++) if (isLand(reg.adjKind[e]) && own[reg.adj[e]] === q.id) return true;
            return false;
          });
          if (bordersElsewhere) return { two: p.id, other: q.id, cap, side };
        }
      }
      return undefined;
    });
    const guard: Intervention[] = [{ kind: 'protect', a: polityKey(base, two), from: y, fromTick: 1 }];
    const restored = run(
      { [y]: [{ kind: 'neutral', a: two, region: side, ps: [other] }, { kind: 'declare', a: two, b: other }, { kind: 'found', region: cap }] },
      guard,
    );
    expect(told(restored.log)).toEqual([]);
    expect(restored.took.map((v) => v.kind)).toEqual(['neutral', 'declare', 'found']);
    expect(restored.civ.polities[two].ended).not.toBe(y + 1 / 256);
    const lasting = run(
      { [y]: [{ kind: 'neutral', a: two, region: side, ps: [other], lasting: true }, { kind: 'declare', a: two, b: other }, { kind: 'found', region: cap }] },
      guard,
    );
    expect(told(lasting.log)).toEqual([{ year: y + 10, refused: [{ kind: 'found', index: 2, why: 'protect' }] }]);
    expect(lasting.took.map((v) => v.kind)).toEqual(['neutral', 'declare']);
  }, 120_000);

  it('插件结的盟经断盟或办成了的称臣解除以后,读历史的接口不再报', () => {
    const hasPair = (civ: Civ, year: number, a: number, b: number) =>
      historyRelations(civ, { year }).alliances.some((x) => (x.a === a && x.b === b) || (x.a === b && x.b === a));
    const [p, q, r] = free;
    const unallied = run({ [Y]: [{ kind: 'ally', a: p.id, b: q.id }], [Y + 10]: [{ kind: 'unally', a: p.id, b: q.id }] }).civ;
    expect(hasPair(unallied, Y + 5, p.id, q.id)).toBe(true);
    expect(hasPair(unallied, Y + 15, p.id, q.id)).toBe(false);
    const submitted = run({ [Y]: [{ kind: 'ally', a: p.id, b: r.id }], [Y + 10]: [{ kind: 'submit', a: p.id, b: q.id }] }).civ;
    expect(outcome(submitted, 1).e.n).toBe(1);
    expect(hasPair(submitted, Y + 5, p.id, r.id)).toBe(true);
    expect(hasPair(submitted, Y + 15, p.id, r.id)).toBe(false);
  }, 120_000);
});

/** 每十年挑一国和它一个邻国,新的十几种轮着下一条(实体给读口里的编号) */
const MIX = ['peace', 'submit', 'release', 'unally', 'annul', 'unzone', 'city', 'dynasty', 'secede', 'convert', 'neutral', 'boost', 'protect', 'unity', 'halt', 'keep', 'stay'] as const;
function mixer(): SimPlugin<SimRead> {
  return {
    id: 'mixer',
    every: 10,
    act(turn) {
      if (turn.year === 0) return;
      const r = turn.read;
      const owner = r.owners('polity');
      const folk = r.owners('culture');
      const { neighbors } = r.regions();
      const ps = r.polities();
      const alive = ps.filter((p) => p.ended === undefined && p.size > 0);
      if (alive.length < 2) return;
      const ss = r.settlements();
      const pick = <T>(xs: readonly T[], k: number): T => xs[Math.floor(turn.rand(turn.year * 256, k) * xs.length)];
      const a = pick(alive, 1);
      const capR = ss[a.capital].region;
      const mine = [...owner.keys()].filter((q) => owner[q] === a.id && q !== capR);
      const near = new Set<number>();
      for (const q of mine) {
        for (let e = neighbors.start[q]; e < neighbors.start[q + 1]; e++) {
          const o = owner[neighbors.list[e]];
          if (o >= 0 && o !== a.id) near.add(o);
        }
      }
      const b = near.size ? pick([...near].sort((x, y) => x - y), 2) : alive.find((p) => p.id !== a.id)!.id;
      const y = Math.floor(turn.year);
      const kind = MIX[Math.round(turn.year / 10) % MIX.length];
      const side = mine.length ? pick(mine, 3) : capR;
      const other = folk.find((c) => c >= 0 && c !== folk[side]) ?? folk[side];
      const vassal = alive.find((p) => p.liege >= 0);
      const fighter = alive.find((p) => p.wars.length);
      const cmd =
        kind === 'peace' && fighter ? { kind, a: fighter.id, b: fighter.wars[0] }
        : kind === 'peace' || kind === 'submit' || kind === 'unally' || kind === 'annul' ? { kind, a: a.id, b }
        : kind === 'release' ? { kind, a: vassal ? vassal.id : a.id }
        : kind === 'city' ? { kind, region: [...folk.keys()].find((q) => folk[q] >= 0 && !ss.some((s) => s.ended === undefined && s.region === q)) ?? side }
        : kind === 'unzone' ? { kind, region: side }
        : kind === 'dynasty' ? { kind, a: a.id, region: side }
        : kind === 'secede' ? { kind, a: a.id, regions: mine.length ? mine.slice(0, 3) : [capR] }
        : kind === 'convert' ? { kind, region: side, folk: other }
        : kind === 'neutral' ? { kind, a: a.id, region: side, ps: [b] }
        : kind === 'boost' ? { kind, a: a.id, mul: 3, until: y + 15 }
        : kind === 'stay' ? { kind, folk: a.culture, until: y + 25 }
        : { kind, a: a.id, until: y + 25 };
      return { commands: [cmd] };
    },
  };
}

describe('新的十几种轮着下:分段推、存下接着推都和一口气推完一样', () => {
  it.each([7, 2024])('seed %i 推 3000 年', (seed) => {
    const world = seed === 2024 ? w : generateWorld({ ...DEFAULT_PARAMS, cells: 12000, seed });
    const one = generateCiv(world, { plugins: [mixer()] });
    const ivs = one.interventions ?? [];
    expect(new Set(ivs.filter((v) => v.plugin === 'mixer').map((v) => v.kind)).size).toBe(MIX.length);
    // 办成了的:b = −1(撤中立地、建城、改朝换代、改民族、否决类、推一把)、n ≥ 1(停战、称臣、断盟、废约)、分裂 b = 新国
    const done = new Set<string>();
    for (const e of one.annals) {
      if (e.kind !== 'intervene') continue;
      const k = ivs[e.war].kind;
      if (e.b === -1 || (e.n ?? 0) > 0 || (k === 'secede' && e.b >= 0) || (k === 'release' && e.b >= 0)) done.add(k);
    }
    for (const k of ['peace', 'city', 'dynasty', 'secede', 'convert', 'boost', 'protect', 'halt', 'keep', 'stay']) expect(done.has(k), k).toBe(true);
    const run = startCiv(world, { plugins: [mixer()] });
    for (const t of [333, 1000 + 1 / 256, 1777.5, 2400]) run.advance(t);
    expect(civDiff(run.finish(), one)).toBeNull();
    for (const at of [1200, 2410 + 1 / 256]) {
      const cont = startContinue(world, roundTrip(generateCiv(world, { plugins: [mixer()], endYear: at })), { plugins: [mixer()] });
      expect(civDiff(cont!.finish(), one), `推到 ${at} 接着推`).toBeNull();
    }
  }, 240_000);
});
