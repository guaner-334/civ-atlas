/**
 * 称呼分男女(gen/civ/gender.ts、peopleText.ts 的 kinOf):男女两套词都对 ——
 * 代词、子女、君号、身后称号、身份词、预定的继承人、亲属词(含隔着一位女性的外孙、舅父、表兄……)、嫁娶、争储;
 * 没有性别这一项的人物(旧存档、现在推演出来的人)一律按男的写;推演出来的人物现在都没有这一项。
 * 再拿推演出来的君主、宗室改成女的,看称呼、编年史的继位那一句跟着变。
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_PARAMS, generateWorld } from '../src/gen/world';
import { generateCiv, type Civ } from '../src/gen/civ';
import type { Person, Polity } from '../src/gen/civ/types';
import { polityTierAt } from '../src/gen/civ/growth';
import {
  bySex,
  childWord,
  eastRank,
  heOrShe,
  heirWord,
  isFemale,
  khanWord,
  kinWord,
  mateWord,
  postTitle,
  princeWord,
  rivalsWord,
  spouseWord,
  wedVerb,
  westRank,
} from '../src/gen/civ/gender';
import { kinOf, personName, princeTitle, rulerBare, rulerRef, rulerRole, rulerShort, rulerTitle } from '../src/gen/civ/peopleText';
import { reignEntries } from '../src/gen/civ/chronicle';
import { lineageKin, lineageTag } from '../src/gen/civ/lineageInfo';

const F = { female: true } as const;
const M = {};

describe('按性别取的字', () => {
  it('没写性别 = 男', () => {
    expect(isFemale(undefined)).toBe(false);
    expect(isFemale(null)).toBe(false);
    expect(isFemale(M)).toBe(false);
    expect(isFemale(F)).toBe(true);
    expect(bySex(M, 'a', 'b')).toBe('a');
    expect(bySex(F, 'a', 'b')).toBe('b');
  });

  it('代词、子女', () => {
    expect([heOrShe(M), heOrShe(F), heOrShe(undefined)]).toEqual(['他', '她', '他']);
    expect([childWord(M), childWord(F)]).toEqual(['子', '女']);
  });

  it('东方君号:皇帝 / 女帝、王 / 女王、公 / 女君、可汗 / 女可汗,首领不分', () => {
    expect([0, 1, 2, 3].map((t) => eastRank(M, t))).toEqual(['首领', '公', '王', '皇帝']);
    expect([0, 1, 2, 3].map((t) => eastRank(F, t))).toEqual(['首领', '女君', '女王', '女帝']);
    expect([khanWord(M), khanWord(F)]).toEqual(['可汗', '女可汗']);
  });

  it('西幻君号:国王 / 女王、皇帝 / 女皇、汗 / 女汗;酋长、执政官不分', () => {
    expect([0, 1, 2, 3].map((t) => westRank(M, 'realm', t))).toEqual(['酋长', '国王', '国王', '皇帝']);
    expect([0, 1, 2, 3].map((t) => westRank(F, 'realm', t))).toEqual(['酋长', '女王', '女王', '女皇']);
    expect([0, 1, 2, 3].map((t) => westRank(F, undefined, t))).toEqual(['酋长', '女王', '女王', '女皇']);
    expect([0, 1, 2, 3].map((t) => westRank(M, 'khanate', t))).toEqual(['首领', '汗', '汗', '大汗']);
    expect([0, 1, 2, 3].map((t) => westRank(F, 'khanate', t))).toEqual(['首领', '女汗', '女汗', '女大汗']);
    expect([0, 1, 2, 3].map((t) => westRank(F, 'republic', t))).toEqual(['执政官', '执政官', '执政官', '女皇']);
  });

  it('身后称号:王国谥号 + 女王、国谥号 + 君;帝国庙号、哀帝、西幻照旧', () => {
    expect(postTitle(F, true, '庄王')).toBe('庄女王');
    expect(postTitle(F, true, '穆公')).toBe('穆君');
    expect(postTitle(F, true, '太宗')).toBe('太宗');
    expect(postTitle(F, true, '哀帝')).toBe('哀帝');
    expect(postTitle(F, true, '')).toBe('');
    expect(postTitle(F, false, '三世')).toBe('三世');
    expect(postTitle(F, false, '大帝')).toBe('大帝');
    for (const t of ['庄王', '穆公', '太宗', '哀帝']) expect(postTitle(M, true, t)).toBe(t);
  });

  it('身份词、预定的继承人', () => {
    expect((['皇子', '王子', '公子'] as const).map((w) => princeWord(M, w))).toEqual(['皇子', '王子', '公子']);
    expect((['皇子', '王子', '公子'] as const).map((w) => princeWord(F, w))).toEqual(['公主', '公主', '公女']);
    expect([3, 2, 1, 0].map((t) => heirWord(M, t))).toEqual(['太子', '世子', '公子', '公子']);
    expect([3, 2, 1, 0].map((t) => heirWord(F, t))).toEqual(['皇太女', '王太女', '公女', '公女']);
    expect([heirWord(M), heirWord(F)]).toEqual(['太子', '太女']);
  });

  it('单个亲属词、嫁娶、配偶', () => {
    const pairs: [string, string][] = [
      ['子', '女'],
      ['父', '母'],
      ['父亲', '母亲'],
      ['养父', '养母'],
      ['养子', '养女'],
      ['兄', '姐'],
      ['兄长', '姐姐'],
      ['弟', '妹'],
      ['叔父', '姑母'],
      ['伯父', '姑母'],
      ['侄', '侄女'],
      ['族兄', '族姐'],
    ];
    for (const [m, f] of pairs) {
      expect(kinWord(M, m)).toBe(m);
      expect(kinWord(F, m)).toBe(f);
    }
    expect(kinWord(F, '宗室')).toBe('宗室');
    expect([wedVerb(M), wedVerb(F)]).toEqual(['娶', '嫁']);
    expect([mateWord(M), mateWord(F)]).toEqual(['宗室女', '宗室子']);
    expect([spouseWord(M), spouseWord(F)]).toEqual(['妻', '夫']);
  });

  it('诸子争储:有女的换说法', () => {
    expect(rivalsWord([M, M], true)).toBe('诸子争立');
    expect(rivalsWord([M, M], false)).toBe('诸子争位');
    expect(rivalsWord([M, F], true)).toBe('兄妹争立');
    expect(rivalsWord([F, M], false)).toBe('王子公主争位');
    expect(rivalsWord([F, F], true)).toBe('诸女争立');
    expect(rivalsWord([F, F], false)).toBe('诸公主争位');
  });
});

/** 手搭的一家人(只用到世系:parent、born、adopted、female) */
function family(): Civ {
  const P = (id: number, born: number, parent?: number, more: Partial<Person> = {}): Person => ({
    id,
    role: 'prince',
    polity: 0,
    name: `p${id}`,
    born,
    ...(parent !== undefined ? { parent } : {}),
    ...more,
  });
  const people: Person[] = [
    P(0, 0), //                           祖父
    P(1, 20, 0), //                       父
    P(2, 18, 0, { female: true }), //     姑母(比父亲大)
    P(3, 25, 0), //                       叔父
    P(4, 15, 0), //                       伯父
    P(5, 45, 1), //                       我
    P(6, 40, 1, { female: true }), //     姐
    P(7, 50, 1, { female: true }), //     妹
    P(8, 70, 5, { female: true }), //     女
    P(9, 72, 5), //                       子
    P(10, 75, 5, { female: true, adopted: true }), // 养女
    P(11, 95, 9, { female: true }), //    孙女(经儿子)
    P(12, 92, 8), //                      外孙(经女儿)
    P(13, 44, 2), //                      表兄(姑母的儿子)
    P(14, 47, 3, { female: true }), //    从妹(叔父的女儿)
    P(15, 65, 6, { female: true }), //    外甥女(姐姐的女儿)
    P(16, 66, 17, { female: true }), //   侄女(哥哥的女儿)
    P(17, 42, 1), //                      兄
    P(18, 62, 6), //                      外甥(姐姐的儿子)
    P(19, 85, 18), //                     外甥的儿子
  ];
  return { people } as unknown as Civ;
}

describe('kinOf:男女两套亲属词', () => {
  const civ = family();
  const p = civ.people!;
  const k = (a: number, b: number) => kinOf(civ, p[a], p[b]);

  it('全是男的照旧', () => {
    expect(k(5, 9)).toBe('子');
    expect(k(5, 1)).toBe('父');
    expect(k(5, 0)).toBe('祖父');
    expect(k(5, 17)).toBe('兄');
    expect(k(5, 3)).toBe('叔父');
    expect(k(5, 4)).toBe('伯父');
    expect(k(17, 5)).toBe('弟');
    expect(k(1, 5)).toBe('子');
    expect(k(0, 5)).toBe('孙');
  });

  it('b 是女的', () => {
    expect(k(5, 8)).toBe('女');
    expect(k(5, 10)).toBe('养女');
    expect(k(5, 6)).toBe('姐');
    expect(k(5, 7)).toBe('妹');
    expect(k(5, 2)).toBe('姑母');
    expect(k(5, 14)).toBe('从妹');
    expect(k(5, 16)).toBe('侄女');
    expect(k(5, 11)).toBe('孙女');
    expect(k(1, 11)).toBe('曾孙女');
    expect(k(18, 6)).toBe('母');
    expect(k(10, 5)).toBe('养父');
    expect(k(19, 6)).toBe('祖母');
  });

  it('隔着一位女性:外孙、外甥、外祖父、舅父、姨母、表兄', () => {
    expect(k(5, 12)).toBe('外孙');
    expect(k(5, 15)).toBe('外甥女');
    expect(k(5, 18)).toBe('外甥');
    expect(k(5, 19)).toBe('外甥孙');
    expect(k(12, 5)).toBe('外祖父');
    expect(k(18, 1)).toBe('外祖父');
    expect(k(18, 5)).toBe('舅父');
    expect(k(18, 7)).toBe('姨母');
    expect(k(5, 13)).toBe('表兄');
    expect(k(13, 5)).toBe('表弟');
    expect(k(13, 14)).toBe('表妹');
  });
});

describe('推演出来的人物改成女的', () => {
  let raw: Civ | undefined;
  let civ: Civ | undefined;
  /** 推演出来的世界(一部分人物是女的) */
  const rawOf = () => (raw ??= generateCiv(generateWorld({ ...DEFAULT_PARAMS, cells: 12000, seed: 7 })));
  /** 同一个世界,女的都换回原来的男的(下面手动挑几位换成女的,看称呼怎么跟着变) */
  const civOf = () =>
    (civ ??= { ...rawOf(), people: rawOf().people!.map((x) => (x.female ? (({ female: _f, maleName, ...rest }) => ({ ...rest, name: maleName! }))(x) : x)) });
  /** 把几位换成女的(一份新的 Civ,原来的不动);polities 可以顺带改几国 */
  const withFemale = (c: Civ, ids: readonly number[], polities?: (p: Polity) => Polity): Civ => {
    const set = new Set(ids);
    return {
      ...c,
      people: c.people!.map((x) => (set.has(x.id) ? { ...x, female: true as const } : x)),
      polities: polities ? c.polities.map(polities) : c.polities,
    };
  };
  const rulers = () => civOf().people!.filter((x) => x.role === 'ruler' && x.author === undefined);
  const tierEnd = (c: Civ, x: Person) => polityTierAt(c.polities[x.polity], (x.until ?? c.endYear) - 1 / 512);

  it('推演出来的人物:女的记 female: true、男的没有这一项;照 JSON 读回来也一样', () => {
    const r = rawOf();
    expect(r.people!.some((x) => x.female === true)).toBe(true);
    expect(r.people!.every((x) => !('female' in x) || x.female === true)).toBe(true);
    const her = r.people!.find((x) => x.female && x.role === 'ruler')!;
    expect(isFemale(JSON.parse(JSON.stringify(her)) as Person)).toBe(true);
    const c = civOf();
    expect(c.people!.some((x) => 'female' in x)).toBe(false);
    const x = rulers()[0];
    const back = JSON.parse(JSON.stringify(x)) as Person;
    expect(isFemale(back)).toBe(false);
    expect(rulerRef(c, back, x.from!)).toBe(rulerRef(c, x, x.from!));
  });

  it('东方王国、国:身后"庄女王""穆君",卡片名字、身份跟着换', () => {
    const c = civOf();
    for (const rank of ['王', '公'] as const) {
      const x = rulers().find((r) => c.polities[r.polity].eastern && r.title?.endsWith(rank) && tierEnd(c, r) === (rank === '王' ? 2 : 1));
      expect(x, rank).toBeDefined();
      const c2 = withFemale(c, [x!.id]);
      const y = c2.people![x!.id];
      const s = x!.title!.slice(0, -1);
      const want = rank === '王' ? `${s}女王` : `${s}君`;
      expect(rulerTitle(c2, y)).toBe(want);
      expect(rulerShort(c2, y)).toBe(want);
      expect(personName(c2, y)).toBe(`${want}${y.name}`);
      expect(rulerRef(c2, y, (y.until ?? c.endYear) - 1 / 512).endsWith(want)).toBe(true);
      expect(rulerRole(c2, y)).toMatch(rank === '王' ? /女王$/ : /女君$/);
      // 男的照旧
      expect(rulerTitle(c, x!)).toBe(x!.title);
    }
  });

  it('东方帝国:庙号照旧;在位时写女帝', () => {
    const c = civOf();
    const x = rulers().find((r) => c.polities[r.polity].eastern && r.title?.endsWith('宗') && tierEnd(c, r) >= 3);
    expect(x).toBeDefined();
    const c2 = withFemale(c, [x!.id]);
    expect(rulerTitle(c2, c2.people![x!.id])).toBe(x!.title);
    // 在位时(没有称号的写君号 + 名字):把称号去掉看
    const live = { ...c2.people![x!.id], title: '' };
    const end = live.until! - 1 / 512;
    expect(rulerRef(c2, live, end)).toContain(`女帝${live.name}`);
    expect(rulerBare(c2, live, end)).toBe(`女帝${live.name}`);
    expect(rulerRole(c2, live)).toMatch(/女帝$/);
  });

  it('西幻:国王 → 女王、皇帝 → 女皇,序数照旧', () => {
    const c = civOf();
    const x = rulers().find((r) => !c.polities[r.polity].eastern && (c.polities[r.polity].lineage ?? 'realm') === 'realm' && r.title?.endsWith('世') && tierEnd(c, r) === 2);
    expect(x).toBeDefined();
    const c2 = withFemale(c, [x!.id]);
    const y = c2.people![x!.id];
    const end = (y.until ?? c.endYear) - 1 / 512;
    expect(rulerRef(c2, y, end)).toContain(`女王${y.name}${x!.title}`);
    expect(rulerRef(c, x!, end)).toContain(`国王${x!.name}${x!.title}`);
    const e = rulers().find((r) => !c.polities[r.polity].eastern && (c.polities[r.polity].lineage ?? 'realm') === 'realm' && tierEnd(c, r) >= 3);
    expect(e).toBeDefined();
    const c3 = withFemale(c, [e!.id]);
    expect(rulerRole(c3, c3.people![e!.id])).toMatch(/女皇$/);
  });

  it('东方汗国:女可汗', () => {
    const c = civOf();
    const x = rulers().find((r) => c.polities[r.polity].eastern && tierEnd(c, r) >= 1);
    expect(x).toBeDefined();
    const pid = x!.polity;
    const c2 = withFemale(c, [x!.id], (p) => (p.id === pid ? { ...p, lineage: 'khanate' } : p));
    const y = c2.people![x!.id];
    expect(rulerRef(c2, y, (y.until ?? c.endYear) - 1 / 512).endsWith(`${y.name}女可汗`)).toBe(true);
    expect(rulerRole(c2, y)).toMatch(/女可汗$/);
  });

  it('宗室身份词:皇子、王子 → 公主,公子 → 公女', () => {
    const c = civOf();
    const MAP: Record<string, string> = { 皇子: '公主', 王子: '公主', 公子: '公女' };
    const seen = new Set<string>();
    for (const x of c.people!) {
      if (x.role !== 'prince') continue;
      const t = princeTitle(c, x, x.born + 18);
      if (!MAP[t] || seen.has(t)) continue;
      seen.add(t);
      const c2 = withFemale(c, [x.id]);
      expect(princeTitle(c2, c2.people![x.id], x.born + 18)).toBe(MAP[t]);
    }
    expect(seen.size).toBeGreaterThanOrEqual(2);
  });

  it('世系图小灰字:养女;配偶小标"夫"', () => {
    const c = civOf();
    const a = c.people!.find((x) => x.adopted && x.role === 'prince' && !x.fate && !x.regencies);
    if (a) {
      expect(lineageTag(c, a, a.polity)).toBe('养子');
      const c2 = withFemale(c, [a.id]);
      expect(lineageTag(c2, c2.people![a.id], a.polity)).toBe('养女');
    }
    const s = c.people!.find((x) => x.spouses?.length);
    if (s) {
      expect(lineageKin(c, s)!.text.startsWith('妻')).toBe(true);
      const c2 = withFemale(c, [s.id]);
      expect(lineageKin(c2, c2.people![s.id])!.text.startsWith('夫')).toBe(true);
    }
  });

  it('编年史继位那一句:太子 → 皇太女 / 王太女,"是为某王" → "是为某女王"', () => {
    const c = civOf();
    const n0 = c.annals.length;
    const before = new Map(reignEntries(c).map((e) => [e.id, e.text]));
    // 帝国、王国里父死子继、没有争储的一条
    const hit = rulers().find((x) => {
      const t = before.get(n0 + x.id);
      return !!t && !x.claim && (t.includes(`太子${x.name}`) || t.includes(`世子${x.name}`));
    });
    expect(hit).toBeDefined();
    const c2 = withFemale(c, [hit!.id]);
    const after = new Map(reignEntries(c2).map((e) => [e.id, e.text]));
    const was = before.get(n0 + hit!.id)!;
    const now = after.get(n0 + hit!.id)!;
    const want = was
      .replace(`太子${hit!.name}`, `皇太女${hit!.name}`)
      .replace(`世子${hit!.name}`, `王太女${hit!.name}`)
      .replace(`是为${hit!.title}`, `是为${rulerTitle(c2, c2.people![hit!.id])}`);
    expect(now).toBe(want);
    expect(now).not.toBe(was);
    expect(after.size).toBe(before.size);
  });
});
