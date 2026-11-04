/**
 * 编年史存占位符(src/gen/civ/story/nameTokens.ts):存下的文字里名字是占位符,显示时换成当前的名字。
 * - 样本世界、种子 7 和 2024、带作者人物的世界:换回名字和直接算逐条一样(不放宽)
 * - 改国名、城名、民族名、人物名……以前的史事跟着变,和直接算一样;没改的不变;一个名字是另一个名字的一部分也不误伤
 * - 第 1 版存的文字(算好的)读进来转成占位符:看到的文字不变;对不上的留原文
 * - 国旗:存的那一套和界面上算的逐面一样,改名不变
 */
import { describe, expect, it } from 'vitest';
import { applyCharacters, type AuthorCharacter } from '../src/gen/characters';
import { generateCiv, type Civ } from '../src/gen/civ';
import { flagBook, type FlagBook, type FlagSpec } from '../src/gen/civ/story/flags';
import { chronicleBlock, chronicleFromV1, chronicleOfBlock, inBuildChronicle, restoreEntries, type ChronicleBlock } from '../src/gen/civ/story/nameTokens';
import { chronicleOf, type ChroniclePart } from '../src/chronicleParts';
import { makePart, readLocalPart } from '../src/gen/snapshot';
import { buildChronicle, type ChronicleEntry } from '../src/gen/civ/story/chronicle';
import { fullChronicle } from '../src/gen/civ/story/religionText';
import { treatyBook } from '../src/gen/civ/treatyBook';
import { applyNames, cultureKey, dynastyKey, faithKey, personKey, placeKeyOf, polityKey, regionKey, settlementKey, tradeKey, treatyKey, type Intervention } from '../src/gen/edits';
import { civAtEra } from '../src/ui/eras';
import { mulberry32 } from '../src/gen/util';
import { DEFAULT_PARAMS, generateWorld, type World } from '../src/gen/world';
import { worldFlags } from '../src/worldRun';
import { openSample, readSamples } from './lib/savedWorlds';

const SLOW = 120_000;

/** 比较用:一条一行(连同子条目),写到的字段全算上 */
function lines(list: readonly ChronicleEntry[]): string[] {
  const out: string[] = [];
  const walk = (e: ChronicleEntry, d: number) => {
    const { children, ...rest } = e;
    out.push(`${d} ${JSON.stringify(rest, Object.keys(rest).sort())}`);
    for (const c of children ?? []) walk(c, d + 1);
  };
  for (const e of list) walk(e, 0);
  return out;
}

/** 两份逐条一样;不一样时报前几条 */
function expectSame(got: readonly ChronicleEntry[], want: readonly ChronicleEntry[], label: string) {
  const a = lines(got);
  const b = lines(want);
  const diff: string[] = [];
  for (let i = 0; i < Math.max(a.length, b.length) && diff.length < 4; i++) if (a[i] !== b[i]) diff.push(`存的换回 ${a[i]}\n直接算的 ${b[i]}`);
  expect(diff, label).toEqual([]);
  expect(a.length, label).toBe(b.length);
}

/** 比较改名时用:来历那句话(括号)不比。词根的字数改了,"写到这个国家"的地方可能挪到下一处,来历跟着挪 */
function noNotes(list: readonly ChronicleEntry[]): ChronicleEntry[] {
  const strip = (s: string) => s.replace(/\((第 \d+ 年|原)[^)]*\)/g, '');
  return list.map((e) => {
    const out: ChronicleEntry = { ...e, text: strip(e.text) };
    if (e.children) out.children = noNotes(e.children);
    return out;
  });
}

/** 换回来的文字里不能留占位符的字 */
function expectClean(list: readonly ChronicleEntry[], label: string) {
  expect(lines(list).filter((s) => /[-]/.test(s)), label).toEqual([]);
}

const worlds = new Map<number, World>();
const worldOf = (seed: number) => {
  let w = worlds.get(seed);
  if (!w) worlds.set(seed, (w = generateWorld({ ...DEFAULT_PARAMS, seed })));
  return w;
};
const civs = new Map<number, Civ>();
const civOf = (seed: number) => {
  let c = civs.get(seed);
  if (!c) civs.set(seed, (c = generateCiv(worldOf(seed))));
  return c;
};

/** 带作者人物的历史:立君、任将、任臣、挂帅;两个女的 */
const BOLD = { expand: 100, war: 100, develop: 50, trade: 50 };
const CHARS: AuthorCharacter[] = [
  { id: 1, name: '林小满' } as AuthorCharacter,
  { id: 2, name: '百里青', female: true } as AuthorCharacter,
  { id: 3, name: '阿尔德里克', female: true } as AuthorCharacter,
];

/** 那一年州最多的两国 */
function biggest(civ: Civ, year: number): number[] {
  const alive = civ.polities.filter((p) => p.founded < year && (p.ended ?? Infinity) > year);
  return alive
    .map((p) => p.id)
    .slice()
    .sort((a, b) => a - b)
    .slice(0, 2);
}

function authored(seed: number): Civ {
  const base = civOf(seed);
  const [a, b] = biggest(base, 1000);
  const A = polityKey(base, a);
  const B = polityKey(base, b);
  const interventions: Intervention[] = [
    { kind: 'crown', a: A, char: 1, from: 1000, born: 970, leanings: BOLD } as Intervention,
    { kind: 'appoint', a: A, char: 2, role: 'general', born: 960, from: 1005 } as Intervention,
    { kind: 'appoint', a: B, char: 3, role: 'minister', born: 980, from: 1010 } as Intervention,
    { kind: 'declare', a: A, b: B, from: 1020, lead: 2 } as Intervention,
    { kind: 'ally', a: A, b: B, from: 1200, until: 1250 } as Intervention,
  ];
  return generateCiv(worldOf(seed), { interventions });
}

/** 一些改名:长短、开头的字都和原来不一样(单字 ↔ 两个字 ↔ 大X、带"之"、复姓) */
const NAMES = ['霜', '大霜', '景辰', '大景辰', '羊涂之野', '北海一带', '欧阳修', '阿尔德里克', '司马懿', 'Alba', '塔提特', '林小满', '丹枫', '瑞', '后昌', '西洲'];

/** 随机改掉 frac 比例的名字(十种能改的都改) */
function someRenames(civ: Civ, seed: number, frac: number): Record<string, string> {
  const rng = mulberry32(seed);
  const names: Record<string, string> = {};
  const add = (k: string) => {
    if (k && rng() < frac) names[k] = NAMES[Math.floor(rng() * NAMES.length)] + String.fromCodePoint(0x4e00 + 1000 + Math.floor(rng() * 8000)) + String.fromCodePoint(0x4e00 + 1000 + Math.floor(rng() * 8000));
  };
  civ.polities.forEach((p) => {
    add(polityKey(civ, p.id));
    (p.dynasties ?? []).forEach((_, i) => add(dynastyKey(civ, p.id, i)));
  });
  civ.settlements.forEach((s) => add(settlementKey(civ, s.id)));
  civ.places.forEach((_, i) => add(placeKeyOf(civ, i)));
  civ.cultures.forEach((_, i) => add(cultureKey(civ, i)));
  for (let r = 0; r < civ.regions.count; r++) add(regionKey(civ, r));
  (civ.religion?.faiths ?? []).forEach((_, i) => add(faithKey(civ, i)));
  (civ.people ?? []).forEach((_, i) => add(personKey(civ, i)));
  treatyBook(civ).treaties.forEach((x, i) => x && add(treatyKey(civ, i)));
  (civ.trade?.routes ?? []).forEach((_, i) => add(tradeKey(civ, i)));
  return names;
}

describe('换回名字和直接算逐条一样', () => {
  it.each([7, 2024])('种子 %i', (seed) => {
    const civ = civOf(seed);
    const got = restoreEntries(chronicleBlock(civ).entries, civ);
    expectSame(got, fullChronicle({ ...civ }), `种子 ${seed}`);
    expectClean(got, `种子 ${seed}`);
    // 占位符算一遍不动原来的历史
    expect(civ.polities[0].name.charCodeAt(0)).toBeLessThan(0xe000);
  }, SLOW);

  it('样本世界', async () => {
    for (const s of readSamples()) {
      const { civ } = await openSample(s);
      const got = restoreEntries(chronicleBlock(civ).entries, civ);
      expectSame(got, fullChronicle({ ...civ }), s.name);
      expectClean(got, s.name);
    }
  }, SLOW);

  it.each([7, 2024])('带作者人物的世界(有女的),种子 %i', (seed) => {
    const civ = authored(seed);
    const block = chronicleBlock(civ, CHARS);
    const named = applyCharacters(civ, CHARS);
    const got = chronicleOfBlock(block, named)!;
    expectSame(got, fullChronicle(named), `种子 ${seed}`);
    expectClean(got, `种子 ${seed}`);
    expect(lines(got).some((s) => s.includes('林小满'))).toBe(true);
    expect(block.authorFemale).toEqual([2, 3]);
  }, SLOW);

  it('人物卡的名字改了,存的文字不用动;性别改了存的文字不能用,要现算', () => {
    const civ = authored(7);
    const block = chronicleBlock(civ, CHARS);
    const renamed = CHARS.map((c) => (c.id === 1 ? { ...c, name: '叶知秋' } : c));
    const named = applyCharacters(civ, renamed);
    const got = chronicleOfBlock(block, named)!;
    expectSame(got, fullChronicle(named), '改了人物卡的名字');
    expect(lines(got).some((s) => s.includes('叶知秋'))).toBe(true);
    expect(lines(got).some((s) => s.includes('林小满'))).toBe(false);
    expect(chronicleOfBlock(block, applyCharacters(civ, CHARS.map((c) => (c.id === 2 ? { id: 2, name: c.name } as AuthorCharacter : c))))).toBeNull();
  }, SLOW);
});

describe('改名以后', () => {
  it.each([
    [7, 0.1],
    [7, 0.5],
    [2024, 0.1],
    [2024, 0.5],
  ])('种子 %i,改掉 %f 的名字:和直接算一样', (seed, frac) => {
    const civ = civOf(seed);
    const block = chronicleBlock(civ);
    const names = someRenames(civ, seed + frac * 100, frac);
    const named = applyNames({ ...civ }, names);
    const got = restoreEntries(block.entries, named);
    expectSame(noNotes(got), noNotes(fullChronicle(named)), `种子 ${seed} 改名 ${frac}`);
    expectClean(got, `种子 ${seed} 改名 ${frac}`);
  }, SLOW);

  it('样本世界:同样', async () => {
    for (const s of readSamples()) {
      const { civ } = await openSample(s);
      const block = chronicleBlock(civ);
      const names = someRenames(civ, 5, 0.3);
      const named = applyNames({ ...civ }, names);
      expectSame(noNotes(restoreEntries(block.entries, named)), noNotes(fullChronicle(named)), s.name);
    }
  }, SLOW);

  it('改国名、城名、民族名、人物名:以前的史事跟着变,没写到它的条目不变', () => {
    const civ = civOf(7);
    const block = chronicleBlock(civ);
    const before = restoreEntries(block.entries, civ);
    const cases: [string, string, (e: ChronicleEntry) => boolean][] = [
      ['国', polityKey(civ, before.find((e) => e.polities.length)!.polities[0]), () => true],
      ['城', settlementKey(civ, before.find((e) => e.settlement >= 0)!.settlement), () => true],
      ['民族', cultureKey(civ, 0), () => true],
      ['人物', personKey(civ, before.find((e) => e.people?.length)!.people![0]), () => true],
    ];
    for (const [label, key] of cases) {
      const named = applyNames({ ...civ }, { [key]: '测试新名字' });
      const after = restoreEntries(block.entries, named);
      const a = lines(before);
      const b = lines(after);
      const changed = a.filter((s, i) => s !== b[i]);
      expect(changed.length, `${label}改了名,总有史事写到它`).toBeGreaterThan(0);
      expect(b.filter((s, i) => s !== a[i]).every((s) => s.includes('测试新名字')), `${label}:变了的条目都写着新名字`).toBe(true);
    }
  }, SLOW);

  it('一个名字是另一个名字的一部分:只换改了的那个', () => {
    const civ = civOf(7);
    // 两国:把第二国的名字起成"第一国名字 + 山",再改第一国
    const [a, b] = [civ.polities[0], civ.polities.find((p) => p.id !== civ.polities[0].id && !p.eastern) ?? civ.polities[1]];
    const longName = `${a.name}山`;
    const twin = applyNames({ ...civ }, { [polityKey(civ, b.id)]: longName });
    const block = chronicleBlock(civ);
    const named = applyNames({ ...civ }, { [polityKey(civ, b.id)]: longName, [polityKey(civ, a.id)]: '测试新名字' });
    const got = lines(restoreEntries(block.entries, named));
    expect(got.some((s) => s.includes(longName)), '写到第二国的条目名字一个字不动').toBe(true);
    expect(lines(fullChronicle(twin)).filter((s) => s.includes(longName)).length).toBe(got.filter((s) => s.includes(longName)).length);
  }, SLOW);
});

describe('第 1 版转第 2 版', () => {
  it.each([7, 2024])('种子 %i:看到的文字不变,全部换成占位符,一条不留原文', (seed) => {
    const civ = civOf(seed);
    const names = someRenames(civ, 3, 0.2);
    const stored = fullChronicle(applyNames({ ...civ }, names));
    const v2 = chronicleFromV1(stored, civ, names);
    const fresh = chronicleBlock(civ).entries;
    expect(v2.entries.every((e, i) => e === fresh[i] || lines([e]).join() === lines([fresh[i]]).join()), '都换成了占位符').toBe(true);
    expectSame(restoreEntries(v2.entries, applyNames({ ...civ }, names)), stored, `种子 ${seed}`);
  }, SLOW);

  it('样本世界:同样', async () => {
    for (const s of readSamples()) {
      const { civ } = await openSample(s);
      const stored = fullChronicle({ ...civ });
      const v2 = chronicleFromV1(stored, civ, {});
      expect(v2.entries.filter((e) => !e.text.includes('') && !e.text.includes('') && e.text !== fresh(civ, e)).length, s.name).toBe(0);
      expectSame(restoreEntries(v2.entries, civ), stored, s.name);
    }
  }, SLOW);

  it('带作者人物的世界(当时没套人物卡):转过来以后套上人物卡,名字能显示', () => {
    const civ = authored(7);
    const stored = fullChronicle({ ...civ });
    const v2 = chronicleFromV1(stored, civ, {});
    expectSame(restoreEntries(v2.entries, civ).map(noPeople), stored.map(noPeople), '没套人物卡时和存的一样');
    const named = applyCharacters(civ, CHARS.map((c) => ({ ...c, female: undefined })));
    const got = restoreEntries(v2.entries, named);
    expectSame(got.map(noPeople), fullChronicle(named).map(noPeople), '套上人物卡和直接算一样');
    expect(lines(got).some((s) => s.includes('林小满'))).toBe(true);
  }, SLOW);

  it('对不上的那条留原文,别的照换', () => {
    const civ = civOf(7);
    const stored = structuredClone(fullChronicle({ ...civ }));
    const i = stored.findIndex((e) => e.text.includes(civ.polities[0].name));
    stored[i].text += '(以前的写法)';
    const v2 = chronicleFromV1(stored, civ, {});
    expect(v2.entries[i].text).toBe(stored[i].text);
    const named = applyNames({ ...civ }, { [polityKey(civ, 0)]: '测试新名字' });
    const got = restoreEntries(v2.entries, named);
    expect(got[i].text, '留原文的这一条改名不跟着变').toBe(stored[i].text);
    expect(got.filter((e) => e.text.includes('测试新名字')).length).toBeGreaterThan(0);
  }, SLOW);

  it('这份历史读不懂:全留原文,不报错', () => {
    const stored = [{ id: 0, kind: 'found', year: 1, end: 1, text: '某国立国', tag: '立', importance: 2, polities: [], regions: [], settlement: -1 }] as ChronicleEntry[];
    const v2 = chronicleFromV1(stored, {} as Civ, {});
    expect(v2.entries).toEqual(stored);
  });
});

describe('坏文字', () => {
  it('指不到东西、认不出的占位符:不报错,不留方块', () => {
    const civ = civOf(7);
    const bad = (text: string) => restoreEntries([{ id: 0, kind: 'found', year: 1, end: 1, text, tag: '立', importance: 2, polities: [], regions: [], settlement: -1 } as ChronicleEntry], civ)[0].text;
    expect(bad('甲p999999乙')).toBe('甲乙');
    expect(bad('甲z1乙')).toBe('甲乙');
    expect(bad('甲p0s9r乙').length).toBeGreaterThan(2);
    expect(bad('甲hasp0乙')).not.toMatch(/[-]/);
    expect(bad('')).toBe('');
    // 嵌得很深也很快算完
    const deep = 'empty'.repeat(5000) + '尽头' + '否'.repeat(5000);
    expect(bad(deep)).not.toMatch(/[-]/);
  }, SLOW);
});

describe('国旗:读存的', () => {
  /** 找到一个有后人的国家(复国、分家、仿它的);它和它的后人受影响,别的不受影响 */
  function withHeirs(civ: Civ) {
    const heirs = (id: number) => civ.polities.filter((p) => p.restores === id || p.parent === id || (p.parent === undefined && p.mentor === id));
    const root = civ.polities.find((p) => heirs(p.id).length) ?? civ.polities[0];
    return { root, heirs };
  }
  const SPEC = { shape: 'rect', layout: 'plain', c: ['W'] } as unknown as FlagSpec;
  /** 几种改旗:第一朝、最后一朝、有后人的国家、好几国一起 */
  function overrideSets(civ: Civ): Record<string, FlagSpec>[] {
    const { root } = withHeirs(civ);
    const dyn = civ.polities.find((p) => (p.dynasties?.length ?? 0) >= 2);
    const sets: Record<string, FlagSpec>[] = [{}, { [polityKey(civ, 0)]: SPEC }, { [polityKey(civ, root.id)]: SPEC }];
    if (dyn) {
      sets.push({ [dynastyKey(civ, dyn.id, 1)]: SPEC });
      sets.push({ [dynastyKey(civ, dyn.id, dyn.dynasties!.length - 1)]: SPEC, [polityKey(civ, root.id)]: SPEC });
    }
    return sets;
  }

  async function check(world: World, civ: Civ, label: string) {
    // 存的一样读回来(和世界里存的一样过一遍打包)
    const stored = (await readLocalPart(await makePart('flags', worldFlags(world, civ)))) as FlagBook;
    const geo = civAtEra(civ, 0);
    for (const ov of overrideSets(civ)) {
      expect(flagBook(world, geo, ov, stored), `${label} 改旗 ${Object.keys(ov).length} 面`).toEqual(flagBook(world, geo, ov));
    }
  }

  it.each([7, 2024])('种子 %i:读存的和现算逐面一样,改了旗的也一样', async (seed) => check(worldOf(seed), civOf(seed), `种子 ${seed}`), SLOW);

  it('样本世界:同样', async () => {
    for (const s of readSamples()) {
      const { world, civ } = await openSample(s);
      await check(world, civ, s.name);
    }
  }, SLOW);

  it('没受影响的国家用存的,受影响的(后面的朝、分家、复国)现算', () => {
    const world = worldOf(7);
    const civ = civOf(7);
    const real = flagBook(world, civ);
    // 存的那一套和现在的规矩不一样了:每面都换成 SPEC
    const old: FlagBook = { eras: real.eras.map((list) => list.map((e) => ({ ...e, spec: SPEC }))) };
    expect(flagBook(world, civ, {}, old), '没改旗:全用存的').toEqual(old);
    const { root, heirs } = withHeirs(civ);
    const ov = { [polityKey(civ, root.id)]: { ...SPEC, c: ['R'] } as unknown as FlagSpec };
    const got = flagBook(world, civ, ov, old);
    const touched = new Set<number>([root.id]);
    for (let grew = true; grew; ) {
      grew = false;
      for (const id of [...touched]) {
        for (const h of heirs(id)) {
          if (!touched.has(h.id)) {
            touched.add(h.id);
            grew = true;
          }
        }
      }
    }
    expect(touched.size, '测试用的国家有后人').toBeGreaterThan(1);
    civ.polities.forEach((p) => {
      if (touched.has(p.id)) expect(got.eras[p.id], `${p.id} 受影响:不是存的`).not.toBe(old.eras[p.id]);
      else expect(got.eras[p.id], `${p.id} 没受影响:用存的`).toBe(old.eras[p.id]);
    });
    expect(got.eras[root.id][0].how).toBe('edited');
  }, SLOW);

  it('存的旗和国家对不上:不用', () => {
    const world = worldOf(7);
    const civ = civOf(7);
    expect(flagBook(world, civ, {}, { eras: [] })).toEqual(flagBook(world, civ));
  }, SLOW);
});

describe('国旗', () => {
  /** 界面上算的:没有地形大事 = 整段历史;有 = 第一件以前的地形(ui/App.tsx 的 flagGeo) */
  function shownFlags(world: World, civ: Civ, names: Record<string, string>, chars?: readonly AuthorCharacter[]) {
    const raw = civ;
    if (raw.eras?.length) return flagBook(world, applyNames(civAtEra(raw, 0), names));
    return flagBook(world, applyCharacters(applyNames(raw, names), chars));
  }

  it.each([7, 2024])('种子 %i:存的和界面上的逐面一样,改名也一样', (seed) => {
    const world = worldOf(seed);
    const civ = civOf(seed);
    const stored = worldFlags(world, civ);
    expect(stored).toEqual(shownFlags(world, civ, {}));
    expect(stored).toEqual(shownFlags(world, civ, someRenames(civ, 9, 0.5)));
  }, SLOW);

  it('样本世界(带地形大事的按第一件以前的地形配)', async () => {
    for (const s of readSamples()) {
      const { world, civ } = await openSample(s);
      expect(worldFlags(world, civ), s.name).toEqual(shownFlags(world, civ, {}));
      expect(worldFlags(world, civ), s.name).toEqual(shownFlags(world, civ, someRenames(civ, 9, 0.5)));
    }
  }, SLOW);

  it('带作者人物的世界', () => {
    const civ = authored(7);
    const world = worldOf(7);
    expect(worldFlags(world, civ)).toEqual(shownFlags(world, civ, {}, CHARS));
  }, SLOW);
});

describe('buildChronicle 那一份', () => {
  const same = (civ: Civ, label: string) => {
    const c = { ...civ };
    expect(lines(fullChronicle(c).filter(inBuildChronicle)), label).toEqual(lines(buildChronicle(c)));
  };
  it.each([7, 2024])('种子 %i:全部条目按种类筛出来的就是 buildChronicle 那几条,按顺序', (seed) => same(civOf(seed), `种子 ${seed}`), SLOW);
  it('样本世界、带作者人物的世界:同样', async () => {
    for (const s of readSamples()) same((await openSample(s)).civ, s.name);
    same(applyCharacters(authored(7), CHARS), '作者人物');
  }, SLOW);
});

describe('第一次新建和再次打开', () => {
  /** 第一次:线程算的;再次打开:存下的那一块打包、读回来再换名字。都和直接算比 */
  async function roundTrip(civ: Civ, names: Record<string, string>, chars: readonly AuthorCharacter[] | undefined, label: string) {
    const first = chronicleOf(civ, names, 1, chars);
    const part = await makePart('chronicle', first.block);
    const block = (await readLocalPart(part)) as ChronicleBlock;
    const again = chronicleOf(civ, names, 2, chars, block);
    expect(again.block, `${label}:用的是存的那一块`).toBe(block);
    const text = (parts: readonly ChroniclePart[]) => lines(parts.flatMap((p) => p.entries));
    expect(text(again.parts), label).toEqual(text(first.parts));
    expect(text(first.parts), label).toEqual(lines(fullChronicle(applyCharacters(applyNames({ ...civ }, names), chars))));
    expect(again.parts[0].authors, label).toBe(first.parts[0].authors);
    expect(again.parts.flatMap((p) => [...p.build]), label).toEqual(first.parts.flatMap((p) => [...p.build]));
  }

  it.each([7, 2024])('种子 %i:编年史逐条一样', async (seed) => {
    await roundTrip(civOf(seed), {}, undefined, `种子 ${seed}`);
    await roundTrip(authored(seed), {}, CHARS, `种子 ${seed} 作者人物`);
  }, SLOW);

  it('样本世界:编年史逐条一样,改了名的也一样', async () => {
    for (const s of readSamples()) {
      const { civ } = await openSample(s);
      await roundTrip(civ, {}, undefined, s.name);
    }
  }, SLOW);

  it('人物卡的性别改过、块读不懂:退回现算', () => {
    const civ = authored(7);
    const block = chronicleBlock(civ, CHARS);
    const chars = CHARS.map((c) => (c.id === 2 ? ({ id: 2, name: c.name } as AuthorCharacter) : c));
    const changed = chronicleOf(civ, {}, 1, chars, block);
    expect(changed.block, '性别改过:现算了一块').not.toBe(block);
    expect(changed.block.authorFemale).toEqual([3]);
    expect(lines(changed.parts.flatMap((p) => p.entries))).toEqual(lines(fullChronicle(applyCharacters(civ, chars))));
    for (const bad of [{}, { entries: 'x' }, { entries: [{}] }, null] as unknown as ChronicleBlock[]) {
      const got = chronicleOf(civ, {}, 1, CHARS, bad);
      expect(got.block).not.toBe(bad);
      expect(lines(got.parts.flatMap((p) => p.entries))).toEqual(lines(fullChronicle(applyCharacters(civ, CHARS))));
    }
  }, SLOW);

  it('存的文字和现在的写法不一样:用存的,改名照样跟着变', () => {
    const civ = civOf(7);
    const block = chronicleBlock(civ);
    const changed: ChronicleBlock = { entries: block.entries.map((e) => ({ ...e, text: `${e.text}(旧写法)` })) };
    const key = polityKey(civ, changed.entries.find((e) => e.polities.length)!.polities[0]);
    const entries = chronicleOf(civ, { [key]: '测试新名字' }, 1, undefined, changed).parts.flatMap((p) => p.entries);
    expect(entries.every((e) => e.text.endsWith('(旧写法)'))).toBe(true);
    expect(entries.some((e) => e.text.includes('测试新名字'))).toBe(true);
  }, SLOW);
});

describe('来历不插到别的名字中间', () => {
  it('国名碰巧是民族名字的一部分:来历写在真正写到国家的地方,和占位符算的一样', () => {
    const civ = civOf(8);
    const direct = fullChronicle({ ...civ });
    expectSame(restoreEntries(chronicleBlock(civ).entries, civ), direct, '种子 8');
    const names = civ.cultures.map((c) => c.name);
    const inside = direct.filter((e) => names.some((n) => [...e.text.matchAll(/\((第 \d+ 年|原)[^)]*\)族/g)].length && e.text.includes(`${n}(`)));
    expect(inside.map((e) => e.text)).toEqual([]);
  }, SLOW);

  it('种子 7、2024 上一条不变(基准见存下的世界的测试):只动了碰巧的那种', () => {
    for (const seed of [7, 2024]) expectSame(restoreEntries(chronicleBlock(civOf(seed)).entries, civOf(seed)), fullChronicle({ ...civOf(seed) }), `种子 ${seed}`);
  }, SLOW);
});

function noPeople(e: ChronicleEntry): ChronicleEntry {
  const { people: _p, ...rest } = e;
  void _p;
  return { ...rest, ...(e.children ? { children: e.children.map(noPeople) } : {}) } as ChronicleEntry;
}

function fresh(civ: Civ, e: ChronicleEntry): string {
  return restoreEntries([e], civ)[0].text;
}
