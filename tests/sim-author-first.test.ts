/**
 * 作者的干预优先:作者下的不许灭、禁止分裂、不许扩张、结盟、不许迁挡得住推演插件下的命令。
 * 挡下的不办、不进干预列表、不记史事,插件下一回合在 turn.refused 里看得到(只给一次);存下接着推和一口气推完一样。
 * 作者的干预和命令在同一格生效(from = Y、fromTick = 1),插件出手那一刻的世界和不下干预时一样,目标照它挑
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_PARAMS, generateWorld } from '../src/gen/world';
import { generateCiv, startContinue, type Civ } from '../src/gen/civ';
import { packValue, unpackValue } from '../src/gen/snapshot';
import { cultureKey, polityKey, type Intervention } from '../src/gen/edits';
import type { PluginRefused, SimPlugin } from '../src/gen/civ/engine/plugin';
import type { SimPolity, SimRead } from '../src/gen/civ/simRead';
import { REFUSE_REASONS } from '../src/gen/civ/simApi';
import { validateSimState } from '../src/gen/worldValidate';
import { civDiff } from '../scripts/lib/resumeFuzz';

const w = generateWorld({ ...DEFAULT_PARAMS, cells: 12000, seed: 2024 });
/** 插件出手的那一年、推到哪年 */
const Y = 1500;
const END = Y + 30;
/** 命令生效的那一格 */
const T = Y + 1 / 256;
/** 作者的干预和命令同一格生效 */
const AT = { from: Y, fromTick: 1 } as const;

/** 第 Y 年插件出手时看到的世界(不下命令的插件看到的,和不装插件一样) */
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
const alive = scene.polities.filter((p) => p.ended === undefined && p.size > 0);
const landsOf = (p: number) => [...scene.owner.keys()].filter((r) => scene.owner[r] === p);
const cityLands = (p: number) => landsOf(p).filter((r) => scene.cities.has(r));
const capRegion = (p: SimPolity) => scene.civ.settlements[p.capital].region;
const key = (p: number) => polityKey(scene.civ, p);

// 挑目标:三州以上的国、另外两国;有城的州不多的国(把有城的州都划走就亡)
const wide = alive.find((p) => p.size >= 3)!;
const [other, other2] = alive.filter((p) => p.id !== wide.id).map((p) => p.id);
const small = alive
  .filter((p) => p.id !== other && cityLands(p.id).length >= 2 && cityLands(p.id).length <= 12)
  .sort((a, b) => cityLands(a.id).length - cityLands(b.id).length || a.id - b.id)[0];
/** 不是国都的州;有人住、没有主的州 */
const sideLand = (p: number) => landsOf(p).find((r) => r !== capRegion(scene.polities[p]))!;
const wild = [...scene.owner.keys()].find((r) => scene.owner[r] < 0 && scene.peopled[r] >= 0)!;

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

function run(plan: Readonly<Record<number, unknown[]>>, interventions: Intervention[], endYear = END) {
  const log: Log = [];
  const civ = generateCiv(w, { endYear, plugins: [probe(plan, log)], interventions });
  return { civ, log, took: (civ.interventions ?? []).filter((v) => v.plugin === 'probe') };
}

/** 第 Y 年插件在州 r 立国,立出来的新国的稳定键(先推一遍看是哪一国) */
function bornKey(r: number) {
  const { civ } = run({ [Y]: [{ kind: 'found', region: r }] }, [], Y + 1);
  const p = civ.polities.find((q) => q.founded === T && civ.settlements[q.capital].region === r)!;
  return polityKey(civ, p.id);
}

/** 告诉了插件的那几回合 */
const told = (log: Log) => log.filter((x) => x.refused);

const roundTrip = (c: Civ) => unpackValue(packValue(c)) as Civ;
const bytes = (v: unknown) => {
  const x = packValue(v);
  return Buffer.from(x.buffer, x.byteOffset, x.byteLength);
};

describe('作者的干预挡下插件的命令', () => {
  it('挑得到目标', () => {
    expect(wide).toBeDefined();
    expect(other2).toBeDefined();
    expect(small).toBeDefined();
    expect(wild).toBeDefined();
  });

  it.each([
    {
      name: '不许灭挡灭国',
      cmds: () => [{ kind: 'destroy', a: wide.id, b: other }],
      author: (): Intervention => ({ kind: 'protect', a: key(wide.id), ...AT }),
      refused: [{ kind: 'destroy', index: 0, why: 'protect' }],
    },
    {
      name: '不许灭挡划走最后一座有城的州(一次划几州:扣掉前面收下的再看)',
      cmds: () => cityLands(small.id).map((region) => ({ kind: 'cede', a: other, region })),
      author: (): Intervention => ({ kind: 'protect', a: key(small.id), ...AT }),
      refused: [{ kind: 'cede', index: cityLands(small.id).length - 1, why: 'protect' }],
    },
    {
      name: '不许灭挡在最后一座有城的州立国',
      cmds: () => {
        const rs = cityLands(small.id);
        return [...rs.slice(0, -1).map((region) => ({ kind: 'cede', a: other, region })), { kind: 'found', region: rs[rs.length - 1] }];
      },
      author: (): Intervention => ({ kind: 'protect', a: key(small.id), ...AT }),
      refused: [{ kind: 'found', index: cityLands(small.id).length - 1, why: 'protect' }],
    },
    {
      name: '禁止分裂挡从它的国土里立国',
      cmds: () => [{ kind: 'found', region: landsOf(wide.id).find((r) => r !== capRegion(wide))! }],
      author: (): Intervention => ({ kind: 'unity', a: key(wide.id), ...AT }),
      refused: [{ kind: 'found', index: 0, why: 'unity' }],
    },
    {
      name: '先划给禁止分裂的国、再在那里立国:照划过去以后的主人挡',
      cmds: () => {
        const r = landsOf(other).find((q) => q !== capRegion(scene.polities[other]))!;
        return [
          { kind: 'cede', a: wide.id, region: r },
          { kind: 'found', region: r },
        ];
      },
      author: (): Intervention => ({ kind: 'unity', a: key(wide.id), ...AT }),
      refused: [{ kind: 'found', index: 1, why: 'unity' }],
    },
    {
      name: '先从禁止分裂的国划走、再在那里立国:照收',
      cmds: () => {
        const r = landsOf(wide.id).find((q) => q !== capRegion(wide))!;
        return [
          { kind: 'cede', a: other, region: r },
          { kind: 'found', region: r },
        ];
      },
      author: (): Intervention => ({ kind: 'unity', a: key(wide.id), ...AT }),
      refused: [],
    },
    {
      name: '划给同一格已经灭掉的国(划不成)、再在那里立国:照原主挡',
      cmds: () => {
        const r = landsOf(wide.id).find((q) => q !== capRegion(wide))!;
        return [
          { kind: 'destroy', a: other2 },
          { kind: 'cede', a: other2, region: r },
          { kind: 'found', region: r },
        ];
      },
      author: (): Intervention => ({ kind: 'unity', a: key(wide.id), ...AT }),
      refused: [{ kind: 'found', index: 2, why: 'unity' }],
    },
    {
      name: '不许扩张挡它宣战,别国照样能对它宣战',
      cmds: () => [
        { kind: 'declare', a: wide.id, b: other },
        { kind: 'declare', a: other2, b: wide.id },
      ],
      author: (): Intervention => ({ kind: 'halt', a: key(wide.id), ...AT }),
      refused: [{ kind: 'declare', index: 0, why: 'halt' }],
    },
    {
      name: '不许扩张挡把别国的州、无主的州划给它,把它的州划走照收',
      cmds: () => [
        { kind: 'cede', a: wide.id, region: sideLand(other) },
        { kind: 'cede', a: wide.id, region: wild },
        { kind: 'cede', a: other2, region: sideLand(wide.id) },
      ],
      author: (): Intervention => ({ kind: 'halt', a: key(wide.id), ...AT }),
      refused: [
        { kind: 'cede', index: 0, why: 'halt' },
        { kind: 'cede', index: 1, why: 'halt' },
      ],
    },
    {
      name: '不许扩张挡灭别国并给它;灭国散成无主、并给别国、灭它自己照收',
      cmds: () => [
        { kind: 'destroy', a: other, b: wide.id },
        { kind: 'destroy', a: other2 },
        { kind: 'destroy', a: wide.id, b: other },
      ],
      author: (): Intervention => ({ kind: 'halt', a: key(wide.id), ...AT }),
      refused: [{ kind: 'destroy', index: 0, why: 'halt' }],
    },
    {
      name: '划给、并给同一格已经灭掉的不许扩张之国(办不成):照收',
      cmds: () => [
        { kind: 'destroy', a: wide.id },
        { kind: 'destroy', a: other, b: wide.id },
        { kind: 'cede', a: wide.id, region: sideLand(other2) },
      ],
      author: (): Intervention => ({ kind: 'halt', a: key(wide.id), ...AT }),
      refused: [],
    },
    {
      name: '先立国、再拿新国的键灭它并给不许扩张之国:照挡',
      cmds: () => {
        const r = sideLand(other);
        return [
          { kind: 'found', region: r },
          { kind: 'destroy', a: bornKey(r), b: wide.id },
        ];
      },
      author: (): Intervention => ({ kind: 'halt', a: key(wide.id), ...AT }),
      refused: [{ kind: 'destroy', index: 1, why: 'halt' }],
    },
    {
      name: '先立国、再把不许灭之国最后一座有城的州划给新国:照挡',
      cmds: () => {
        const rs = cityLands(small.id);
        const r = sideLand(other);
        return [
          ...rs.slice(0, -1).map((region) => ({ kind: 'cede', a: other, region })),
          { kind: 'found', region: r },
          { kind: 'cede', a: bornKey(r), region: rs[rs.length - 1] },
        ];
      },
      author: (): Intervention => ({ kind: 'protect', a: key(small.id), ...AT }),
      refused: [{ kind: 'cede', index: cityLands(small.id).length, why: 'protect' }],
    },
    {
      name: '不许扩张不挡立国:立出来的是新国,在它的州里、无主的州里都照收',
      cmds: () => [
        { kind: 'found', region: sideLand(wide.id) },
        { kind: 'found', region: wild },
      ],
      author: (): Intervention => ({ kind: 'halt', a: key(wide.id), ...AT }),
      refused: [],
    },
    {
      name: '作者的结盟挡两国之间的宣战(哪一方动手都挡),别的两国照打',
      cmds: () => [
        { kind: 'declare', a: other, b: wide.id },
        { kind: 'declare', a: wide.id, b: other2 },
        { kind: 'declare', a: wide.id, b: other },
      ],
      author: (): Intervention => ({ kind: 'ally', a: key(wide.id), b: key(other), ...AT }),
      refused: [
        { kind: 'declare', index: 0, why: 'ally' },
        { kind: 'declare', index: 2, why: 'ally' },
      ],
    },
    {
      name: '不许迁挡大迁徙',
      cmds: () => [{ kind: 'trek', folk: wide.culture, reach: 'far' }],
      author: (): Intervention => ({ kind: 'stay', folk: cultureKey(scene.civ, wide.culture), ...AT }),
      refused: [{ kind: 'trek', index: 0, why: 'stay' }],
    },
  ])('$name:挡下的不办、不进干预列表,下一回合告诉插件一次;没下干预时照收', ({ cmds, author, refused }) => {
    const plan = { [Y]: cmds() };
    const free = run(plan, []);
    expect(free.took.length).toBe(plan[Y].length);
    expect(told(free.log)).toEqual([]);

    const order = author();
    const got = run(plan, [order]);
    expect(got.civ.interventions![0]).toEqual(order);
    expect(got.took.length).toBe(plan[Y].length - refused.length);
    expect(got.took.map((v) => v.kind)).toEqual(plan[Y].filter((_, i) => !refused.some((r) => r.index === i)).map((c) => (c as { kind: string }).kind));
    expect(told(got.log)).toEqual(refused.length ? [{ year: Y + 10, refused }] : []);
    for (const r of refused) expect(REFUSE_REASONS).toContain(r.why);
    // 史事 intervene 只记收下的命令(war 列是干预列表的下标)
    for (const e of got.civ.annals) if (e.kind === 'intervene') expect(e.war).toBeLessThan(got.civ.interventions!.length);
  }, 60_000);

  it('挡下灭国、划走最后的州:那国没亡;没下干预时那一格就亡了', () => {
    const kill = { [Y]: [{ kind: 'destroy', a: wide.id }] };
    expect(run(kill, []).civ.polities[wide.id].ended).toBe(T);
    expect(run(kill, [{ kind: 'protect', a: key(wide.id), ...AT }]).civ.polities[wide.id].ended).toBeUndefined();
    const strip = { [Y]: cityLands(small.id).map((region) => ({ kind: 'cede', a: other, region })) };
    expect(run(strip, []).civ.polities[small.id].ended).toBe(T);
    const kept = run(strip, [{ kind: 'protect', a: key(small.id), ...AT }]);
    expect(kept.civ.polities[small.id].ended).toBeUndefined();
    // 划走的是国都也照收(另有城可以迁都),只挡最后那一州
    expect(kept.took.length).toBe(cityLands(small.id).length - 1);
  }, 60_000);

  it('挡下灭别国并给不许扩张之国:那国那一格没亡;没下干预时那一格亡了、并进去', () => {
    const merge = { [Y]: [{ kind: 'destroy', a: other, b: wide.id }] };
    const free = run(merge, []).civ;
    expect(free.polities[other].ended).toBe(T);
    expect(free.annals.some((e) => e.kind === 'fall' && e.a === other && e.b === wide.id)).toBe(true);
    expect(run(merge, [{ kind: 'halt', a: key(wide.id), ...AT }]).civ.polities[other].ended).not.toBe(T);
    // 同一格先立国、再拿新国的键并给它:没下干预时真并进去了
    const r = sideLand(other);
    const viaNew = run({ [Y]: [{ kind: 'found', region: r }, { kind: 'destroy', a: bornKey(r), b: wide.id }] }, []).civ;
    expect(viaNew.annals.some((e) => e.kind === 'fall' && e.b === wide.id && viaNew.polities[e.a].founded === T)).toBe(true);
  }, 60_000);

  it('两个插件同一刻下命令:后出手的照前一个收下的命令办完以后的归属看', () => {
    const r = landsOf(other).find((q) => q !== capRegion(scene.polities[other]))!;
    const one: Log = [];
    const two: Log = [];
    const civ = generateCiv(w, {
      endYear: END,
      plugins: [probe({ [Y]: [{ kind: 'cede', a: wide.id, region: r }] }, one, 'first'), probe({ [Y]: [{ kind: 'found', region: r }] }, two, 'second')],
      interventions: [{ kind: 'unity', a: key(wide.id), ...AT }],
    });
    expect((civ.interventions ?? []).filter((v) => v.plugin).map((v) => [v.plugin, v.kind])).toEqual([['first', 'cede']]);
    expect(told(one)).toEqual([]);
    expect(told(two)).toEqual([{ year: Y + 10, refused: [{ kind: 'found', index: 0, why: 'unity' }] }]);
  }, 60_000);

  it('插件自己下的结盟不挡它后来的宣战;作者的干预还没生效、已经到期的不挡', () => {
    const mine = run({ [Y]: [{ kind: 'ally', a: wide.id, b: other, until: Y + 40 }], [Y + 10]: [{ kind: 'declare', a: other, b: wide.id }] }, []);
    expect(mine.took.map((v) => v.kind)).toEqual(['ally', 'declare']);
    expect(told(mine.log)).toEqual([]);
    const plan = { [Y]: [{ kind: 'declare', a: wide.id, b: other }] };
    for (const order of [
      { kind: 'halt', a: key(wide.id), from: Y + 1 },
      { kind: 'halt', a: key(wide.id), from: Y - 50, until: Y },
    ] as Intervention[]) {
      const got = run(plan, [order]);
      expect(got.took.length, JSON.stringify(order)).toBe(1);
      expect(told(got.log)).toEqual([]);
    }
  }, 60_000);
});

describe('挡下的命令存下接着推', () => {
  const plan = { [Y]: [{ kind: 'destroy', a: wide.id }] };
  const order: Intervention = { kind: 'protect', a: key(wide.id), ...AT };

  it('推到出手那一刻存下(还没告诉插件):状态里带着,读回来接着推下一回合照样告诉它,和一口气推完一样', () => {
    const one = run(plan, [order]);
    const saved = roundTrip(run(plan, [order], Y).civ);
    const st = saved.simPlugins![0];
    expect(st.refused).toEqual([{ kind: 'destroy', index: 0, why: 'protect' }]);
    validateSimState(st, 'probe');
    const log: Log = [];
    const cont = startContinue(w, saved, { endYear: END, plugins: [probe(plan, log)], interventions: [order] });
    expect(cont).not.toBeNull();
    const rest = cont!.finish();
    expect(told(log)).toEqual([{ year: Y + 10, refused: st.refused }]);
    expect(civDiff(rest, one.civ)).toBeNull();
    expect(bytes(rest.simPlugins).equals(bytes(one.civ.simPlugins))).toBe(true);
    // 告诉过了就不再存
    expect(one.civ.simPlugins![0].refused).toBeUndefined();
  }, 60_000);

  it('世界文件里的挡下的命令:种类名、先后、条数不合规矩的不收', () => {
    const st = roundTrip(run(plan, [order], Y).civ).simPlugins![0];
    const ok = { kind: 'cede', index: 3, why: 'protect' };
    expect(() => validateSimState({ ...st, refused: [ok, { ...ok, index: 5 }] }, 'probe')).not.toThrow();
    for (const bad of [
      [ok, ok],
      [{ ...ok, kind: 'Cede' }],
      [{ ...ok, why: '' }],
      [{ ...ok, index: 64 }],
      [{ ...ok, extra: 1 }],
      Array.from({ length: 65 }, (_, i) => ({ ...ok, index: i })),
      'protect',
    ]) {
      expect(() => validateSimState({ ...st, refused: bad }, 'probe'), JSON.stringify(bad)).toThrow(/refused/);
    }
  }, 60_000);
});
