/**
 * 推演插件的命令第二批:引擎现成的动作(停战、称臣、放藩、断盟、废约、撤中立地、划中立地、建城、推一把发展、改朝换代、分裂、改民族)
 * 和否决类(不许灭、禁止分裂、不许扩张、保住王室、不许迁)。每种:下了有效果、史事里有记、作者的干预挡得住的进 turn.refused;
 * 存下接着推和一口气推完一样;插件下的否决类挡不住作者的干预
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_PARAMS, generateWorld } from '../src/gen/world';
import { generateCiv, startCiv, startContinue, type Civ } from '../src/gen/civ';
import { packValue, unpackValue } from '../src/gen/snapshot';
import { cultureKey, polityKey, regionKey, type Intervention } from '../src/gen/edits';
import type { PluginRefused, SimPlugin } from '../src/gen/civ/engine/plugin';
import type { SimPolity, SimRead } from '../src/gen/civ/simRead';
import { REFUSE_REASONS } from '../src/gen/civ/simApi';
import { treatyBook } from '../src/gen/civ/treatyBook';
import { polityTies, relationsAt } from '../src/gen/civ/diplomacy';
import { buildChronicle } from '../src/gen/civ/story/chronicle';
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
    const civ = resumes({ [Y]: [{ kind: 'secede', a: wide.id, regions: [...sideCities, capRegion(wide.id)], name: '东' }] });
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
  }, 120_000);

  it('同一批先撤中立地、再在那州立国:照还回去的原主挡(禁止分裂)', () => {
    const a = wide.id;
    const b = neighbor(a);
    const r = landsOf(a).find((q) => q !== capRegion(a) && adjacent(q, b))!;
    const got = run({ [Y]: [{ kind: 'neutral', a, region: r, ps: [b] }], [Y + 10]: [{ kind: 'unzone', region: r }, { kind: 'found', region: r }] }, [{ kind: 'unity', a: key(a), ...AT }]);
    expect(told(got.log)).toEqual([{ year: Y + 20, refused: [{ kind: 'found', index: 1, why: 'unity' }] }]);
    expect(got.took.map((v) => v.kind)).toEqual(['neutral', 'unzone']);
  }, 60_000);

  it('民族键也认(改民族)', () => {
    const got = run({ [Y]: [{ kind: 'convert', region: sideCities[0], folk: cultureKey(scene.civ, otherFolk) }] });
    expect(outcome(got.civ).e.n).toBe(otherFolk);
  }, 60_000);
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
