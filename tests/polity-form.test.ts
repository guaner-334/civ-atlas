/**
 * 政体名(src/gen/civ/polityForm.ts)和朝政页上那几句(src/ui/courtInfo.ts):
 * 名字表的每一行用造出来的输入核对(不靠某个种子的历史);再挑种子 7、2024 第 3000 年的几国对一对;
 * 缓存的结果(只在议事、升格、管辖快照那几年看)和当年现算的一样;历次改制前后接得上;句子写得出来。
 */
import { describe, expect, it } from 'vitest';
import { generateWorld, DEFAULT_PARAMS } from '../src/gen/world';
import { generateCiv, type Civ } from '../src/gen/civ';
import { polityAlive, polityName } from '../src/gen/civ/growth';
import { courtRulesAt } from '../src/gen/civ/council';
import {
  FORMS,
  centralScore,
  formChangesAt,
  formFactsAt,
  formName,
  polityFormAt,
  type FormFacts,
  type FormName,
} from '../src/gen/civ/polityForm';
import { armySay, courtView, formChangeSay, formWhy, levySay, officeSay, ruleSeg } from '../src/ui/courtInfo';

const civs = new Map<number, Civ>();
function civOf(seed: number): Civ {
  let c = civs.get(seed);
  if (!c) civs.set(seed, (c = generateCiv(generateWorld({ ...DEFAULT_PARAMS, seed }))));
  return c;
}

/** 一个普通的农耕王国:第 2 档、10 州、规矩都是原样 */
const base: FormFacts = { lineage: 'realm', tier: 2, tax: 0, army: 0, office: 0, fief: false, regions: 10, lords: 0 };
const f = (o: Partial<FormFacts>): FormFacts => ({ ...base, ...o });

describe('政体名', () => {
  it('名字表的每一行都对得上(造出来的输入,一行一个)', () => {
    const cases: [FormName, FormFacts][] = [
      ['诸侯割据', f({ regions: 12, lords: 6 })],
      ['城邦', f({ lineage: 'republic', tier: 0, regions: 2 })],
      ['商人共和国', f({ lineage: 'republic', tier: 1 })],
      ['海上帝国', f({ lineage: 'republic', tier: 3, regions: 80 })],
      ['部落', f({ tier: 0, regions: 3 })],
      ['部落联盟', f({ tier: 0, regions: 4 })],
      ['集权王国', f({ tax: 2, army: 1 })],
      ['官僚帝国', f({ tier: 3, army: 1, office: 1 })],
      ['封建王国', f({ fief: true })],
      ['封建帝国', f({ tier: 3, army: -1 })],
      ['汗国', f({ lineage: 'khanate', tier: 1 })],
      ['游牧帝国', f({ lineage: 'khanate', tier: 3 })],
      ['王国', f({})],
      ['帝国', f({ tier: 3 })],
    ];
    // 表里 14 行,一行不漏
    expect(cases.map((c) => c[0])).toEqual(FORMS.map((r) => r.name));
    for (const [name, facts] of cases) expect(formName(facts), name).toBe(name);
  });

  it('收归朝廷够两样:直征、禁军、铨选各算一样,分成、监军、参半各算半样', () => {
    expect(centralScore({ tax: 2, army: 1, office: 1 })).toBe(3);
    expect(centralScore({ tax: 1, army: 0.5, office: 0.5 })).toBe(1.5);
    expect(centralScore({ tax: 0, army: -1, office: -1 })).toBe(0);
    // 分成、监军、参半加起来只有一样半:不算集权(只收了一点,还是王国)
    expect(formName(f({ tax: 1, army: 0.5, office: 0.5 }))).toBe('王国');
    // 直征 + 监军 + 参半 = 两样:集权
    expect(formName(f({ tax: 2, army: 0.5, office: 0.5 }))).toBe('集权王国');
    // 只有一样整的(铨选):还是王国
    expect(formName(f({ office: 1 }))).toBe('王国');
  });

  it('先对上的算数:割据压过共和、共和压过集权、集权压过封建、封建压过游牧', () => {
    // 6 州以上一半割据:共和国也是诸侯割据;不到 6 州不算
    expect(formName(f({ lineage: 'republic', tier: 1, regions: 6, lords: 3 }))).toBe('诸侯割据');
    expect(formName(f({ regions: 5, lords: 5 }))).toBe('封建王国');
    // 共和一系收了大权也照旧是共和国;还没称国的部落收了大权也还是部落
    expect(formName(f({ lineage: 'republic', tier: 2, tax: 2, army: 1, office: 1 }))).toBe('商人共和国');
    expect(formName(f({ tier: 0, regions: 2, tax: 2, army: 1 }))).toBe('部落');
    // 收归朝廷够两样,同时分封着边地:算集权
    expect(formName(f({ tax: 2, office: 1, fief: true }))).toBe('集权王国');
    // 游牧一系设了边镇:封建
    expect(formName(f({ lineage: 'khanate', tier: 3, army: -1 }))).toBe('封建帝国');
    // 一成半的州割据算封建,不到不算
    expect(formName(f({ regions: 20, lords: 3 }))).toBe('封建王国');
    expect(formName(f({ regions: 20, lords: 2 }))).toBe('王国');
    // 国号第 1、2 档都是王国那一头,第 3 档帝国
    expect(formName(f({ tier: 1 }))).toBe('王国');
    expect(formName(f({ tier: 3, fief: true }))).toBe('封建帝国');
  });

  it('种子 7、2024 第 3000 年:博戈维纳王国王国(635 年起)、大霄王朝封建帝国;伊昌汗国集权王国、基帕尔大汗国当过游牧帝国', () => {
    const at = (seed: number, name: string) => {
      const civ = civOf(seed);
      const P = civ.polities.find((q) => polityName(q, 3000) === name);
      expect(P, name).toBeTruthy();
      return { look: polityFormAt(civ, P!.id, 3000)!, changes: formChangesAt(civ, P!.id, 3000).map((c) => c.to) };
    };
    // 博戈维纳 2783 年才议成直征(有了户籍以后),收归朝廷的只有一样,还是王国
    // (GENERATOR_VERSION 48 时代做法以前 1894 年收兵权、2018 年行铨选,是集权王国;有熊皇朝是官僚帝国、卢纳维亚帝国是封建帝国)
    const boge = at(7, '博戈维纳王国');
    expect([boge.look.name, Math.floor(boge.look.since)]).toEqual(['王国', 635]);
    expect(boge.changes).toEqual(['部落', '王国']);
    // 先是帝国,后来因议事分封了边地,成了封建帝国
    const da = at(7, '大霄王朝');
    expect(da.look.name).toBe('封建帝国');
    expect(da.changes.slice(-2)).toEqual(['帝国', '封建帝国']);
    // 先是汗国,当过封建王国,后来收归朝廷的够了两样,成了集权王国
    const yi = at(2024, '伊昌汗国');
    expect(yi.look.name).toBe('集权王国');
    expect(yi.changes).toContain('封建王国');
    const ki = at(2024, '基帕尔大汗国');
    expect(ki.look.name).toBe('封建帝国');
    expect(ki.changes).toContain('游牧帝国');
  }, 120_000);

  it('缓存的(只在议事、升格、管辖快照那几年看)和现算的一样;历次改制前后接得上', () => {
    for (const seed of [7, 2024]) {
      const civ = civOf(seed);
      const ys = (civ.development?.controlYears ?? []).filter((y) => y % 500 === 0);
      expect(ys.length).toBeGreaterThan(2);
      let changed = 0;
      for (const P of civ.polities) {
        for (const y of ys) {
          if (!polityAlive(P, y)) continue;
          const look = polityFormAt(civ, P.id, y)!;
          // 管辖快照那几年是看过的,和当年现算的一样
          expect(look.facts, `种子 ${seed} 国家 ${P.id} 第 ${y} 年`).toEqual(formFactsAt(civ, P.id, y));
          expect(look.name).toBe(formName(look.facts));
          // 规矩和朝政页用的一样
          const rules = courtRulesAt(civ, P.id, y);
          expect([look.facts.tax, look.facts.army, look.facts.office, look.facts.fief]).toEqual([rules.tax, rules.army, rules.office, rules.fiefBy >= 0]);
        }
        const list = formChangesAt(civ, P.id, civ.endYear);
        if (!list.length) continue;
        expect(list[0]).toMatchObject({ cause: 'found', from: null, year: P.founded });
        for (let i = 1; i < list.length; i++) {
          const c = list[i];
          changed++;
          expect(c.from).toBe(list[i - 1].to);
          expect(c.to).not.toBe(c.from);
          expect(c.year).toBeGreaterThan(list[i - 1].year);
          if (c.cause === 'council') expect(civ.annals[c.event]).toMatchObject({ kind: 'council', a: P.id, year: c.year });
          // 政体名从哪年起 = 最后一次改制那年
          expect(polityFormAt(civ, P.id, c.year)).toMatchObject({ name: c.to, since: c.year });
        }
        const now = polityFormAt(civ, P.id, Math.min(civ.endYear, P.ended ?? Infinity));
        expect(now?.name).toBe(list[list.length - 1].to);
        // 拖到更早:只列到那一年为止
        const mid = list[Math.floor(list.length / 2)];
        expect(formChangesAt(civ, P.id, mid.year).at(-1)).toBe(mid);
      }
      expect(changed).toBeGreaterThan(20);
      // 还没立国:没有政体
      const late = civ.polities.find((q) => q.founded > 500)!;
      expect(polityFormAt(civ, late.id, late.founded - 1)).toBeNull();
      expect(formChangesAt(civ, late.id, late.founded - 1)).toEqual([]);
    }
  }, 120_000);

  it('朝政页的句子:为什么叫这个、三条各一句、每次改制因为什么', () => {
    const seen = new Set<string>();
    for (const seed of [7, 2024]) {
      const civ = civOf(seed);
      for (const P of civ.polities) {
        const y = Math.min(civ.endYear, P.ended ?? Infinity);
        const look = polityFormAt(civ, P.id, y);
        if (!look) continue;
        seen.add(look.name);
        expect(formWhy(look), look.name).toMatch(/\S/);
        const v = courtView(civ, P.id, y);
        expect(levySay(v)).toMatch([/自己收税/, /分成/, /直征/][v.rules.tax]);
        const army = armySay(civ, P.id, v);
        const office = officeSay(civ, P.id, v);
        expect(army).toMatch(/。$/);
        expect(office).toMatch(/。$/);
        // 改过兵制、官制的写哪年
        if (v.rules.army !== 0) expect(army).toMatch(/^\d+ 年/);
        if (v.rules.office !== 0) expect(office).toMatch(/^\d+ 年/);
        expect([0, 1, 2, 3]).toContain(ruleSeg(v.rules.army));
        const list = formChangesAt(civ, P.id, y);
        list.forEach((c, i) => {
          const s = formChangeSay(civ, P.id, c, i + 1 < list.length);
          expect(s, `${c.from} → ${c.to}(${c.cause})`).toMatch(/\S/);
          if (c.cause === 'council') expect(s).toMatch(/议/);
          if (c.cause === 'title') expect(s).toMatch(/^国号升格，称/);
        });
      }
    }
    // 两个种子里各国最后那年的名字够多(14 个里现在有 12 个;推演改了历史会变,门槛放宽些)
    expect(seen.size).toBeGreaterThanOrEqual(9);
  }, 120_000);
});
