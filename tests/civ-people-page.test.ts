/**
 * 人物页用的数据(gen/civ/peopleInfo.ts、peopleText.ts)和搜人名(ui/searchIndex.ts):
 * 名人按事迹挑、同种子同一批、那句话写得出来;亲属称呼和编年史里的"其弟""其孙"一致;
 * 纪事正文里的人名切得对;某年在位的君主;搜名字、称号找得到人;重推历史后按稳定键找回同一个人。
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_PARAMS, generateWorld } from '../src/gen/world';
import { generateCiv, type Civ } from '../src/gen/civ';
import { reignEntries } from '../src/gen/civ/story/chronicle';
import {
  FAME_MIN,
  commandFoes,
  famousPeople,
  fameLine,
  generalTally,
  peopleIndex,
  personMentions,
  personSpan,
  riseText,
  rulerAt,
  rulerNeighbors,
} from '../src/gen/civ/story/peopleInfo';
import { kinOf, personName, rulerFateWord, rulerRef, rulerRole, rulerShort } from '../src/gen/civ/story/peopleText';
import { searchCiv } from '../src/ui/searchIndex';
import { mapTarget, personKey, resolvePersonKey, selectionKey } from '../src/ui/flyTo';
import { royalSeg } from '../src/gen/civ/regime';

const civs = new Map<number, Civ>();
function civOf(seed: number): Civ {
  let c = civs.get(seed);
  if (!c) civs.set(seed, (c = generateCiv(generateWorld({ ...DEFAULT_PARAMS, seed }))));
  return c;
}

describe.each([7, 2024])('人物页 · seed=%i', (seed) => {
  it('名人:分数够、按上台年份新的在上;每人一句话,不出 undefined / NaN', () => {
    const civ = civOf(seed);
    const fs = famousPeople(civ);
    expect(fs.length).toBeGreaterThan(10);
    expect(fs.length).toBeLessThan(civ.people!.length / 5);
    let last = Infinity;
    for (const f of fs) {
      const x = civ.people![f.id];
      expect(f.score).toBeGreaterThanOrEqual(FAME_MIN);
      expect(f.deeds.length).toBeGreaterThan(0);
      const from = personSpan(x).from;
      expect(from).toBeLessThanOrEqual(last);
      last = from;
      const line = fameLine(civ, x, f);
      expect(line.length).toBeGreaterThan(4);
      expect(line).not.toMatch(/undefined|NaN|null/);
      expect(personName(civ, x)).not.toMatch(/undefined|NaN/);
    }
    // 将领、君主都有
    expect(fs.some((f) => civ.people![f.id].role === 'ruler')).toBe(true);
    expect(fs.some((f) => civ.people![f.id].role === 'general')).toBe(true);
  });

  it('同种子再生成一次:同一批名人,同样的话', () => {
    const a = civOf(seed);
    const b = generateCiv(generateWorld({ ...DEFAULT_PARAMS, seed }));
    const lines = (c: Civ) => famousPeople(c).map((f) => `${f.id} ${f.score} ${fameLine(c, c.people![f.id], f)}`);
    expect(lines(b)).toEqual(lines(a));
  });

  it('历代君主:前任 / 继任首尾相接;亲属称呼和编年史里写的一致;某年在位的就是那一位', () => {
    const civ = civOf(seed);
    const ix = peopleIndex(civ);
    const reigns = reignEntries(civ);
    let kinChecked = 0;
    for (const rs of ix.rulers) {
      for (let i = 0; i < (rs?.length ?? 0); i++) {
        const x = rs[i];
        const { prev, next } = rulerNeighbors(civ, x);
        expect(prev?.id ?? -1).toBe(i > 0 ? rs[i - 1].id : -1);
        expect(next?.id ?? -1).toBe(i + 1 < rs.length ? rs[i + 1].id : -1);
        const mid = (x.from! + (x.until ?? civ.endYear)) / 2;
        if (x.until === undefined || x.until > x.from! + 1 / 128) expect(rulerAt(civ, x.polity, mid)?.id).toBe(x.id);
        expect(rulerRole(civ, x)).not.toMatch(/undefined|NaN/);
        if (x.until !== undefined) expect(rulerFateWord(civ, x)).not.toMatch(/undefined/);
        expect(riseText(civ, x)).not.toMatch(/undefined|NaN/);
        // 同一朝的上一位传给他:编年史那一条写"其弟 / 其孙 / 其侄 / 太子 / 其子……",人物页写"继兄 / 继祖父 / 继叔父……某某即位"
        if (prev && x.rise === 'heir') {
          const e = reigns.find((r) => r.people?.[0] === prev.id && r.people?.[1] === x.id);
          if (!e || !royalSeg(civ.polities[x.polity], x.dynasty ?? 0)) continue;
          const k = kinOf(civ, prev, x);
          if (k === '子') expect(e.text).toMatch(/太子|世子|其子|长子|次子|[三四五六七八九十]+子/);
          else if (k === '女') expect(e.text).toMatch(/皇太女|王太女|其女|长女|次女|[三四五六七八九十]+女/);
          else if (k) expect(e.text).toContain(`其${k}`);
          expect(riseText(civ, x)).toMatch(new RegExp(`^继${kinOf(civ, x, prev)}`));
          kinChecked++;
        }
      }
    }
    expect(kinChecked).toBeGreaterThan(20);
  });

  it('将领:领兵的对手是另一方;攻下 / 守住的次数不为负', () => {
    const civ = civOf(seed);
    const gens = civ.people!.filter((x) => x.role === 'general');
    expect(gens.length).toBeGreaterThan(0);
    for (const x of gens) {
      const foes = commandFoes(civ, x);
      expect(foes.length).toBeGreaterThan(0);
      for (const f of foes) {
        expect(f.polity).not.toBe(x.polity);
        expect(civ.polities[f.polity]).toBeTruthy();
        expect(f.until).toBeGreaterThanOrEqual(f.from);
      }
      const t = generalTally(civ, x);
      expect(t.took).toBeGreaterThanOrEqual(0);
      expect(t.held).toBeGreaterThanOrEqual(0);
    }
  });

  it('纪事里的人名:每条写到的人都切得出来,拼回去和原文一样;自己不切', () => {
    const civ = civOf(seed);
    let found = 0;
    for (const e of reignEntries(civ)) {
      const ms = personMentions(civ, e.text, e.people, -1, e.year);
      expect(ms.map((m) => m.text).join('')).toBe(e.text);
      const ids = ms.filter((m) => m.person !== undefined).map((m) => m.person);
      expect(new Set(ids).size).toBe(ids.length);
      for (const id of ids) expect(e.people).toContain(id);
      if (ids.length === e.people!.length) found++;
      // 他自己的卡片里不变蓝
      const self = e.people![0];
      expect(personMentions(civ, e.text, e.people, self, e.year).some((m) => m.person === self)).toBe(false);
    }
    expect(found).toBeGreaterThan(reignEntries(civ).length * 0.9);
  });

  it('搜名字、称号都找得到这个人,点了选中他;重推后按稳定键找回', () => {
    const civ = civOf(seed);
    const x = civ.people!.find((p) => p.role === 'ruler' && p.title && p.until !== undefined)!;
    for (const q of [personName(civ, x), rulerShort(civ, x), x.name]) {
      const hits = searchCiv(civ, q, civ.endYear, 50);
      expect(hits.some((h) => h.kind === 'person' && h.id === x.id && h.select.kind === 'person')).toBe(true);
    }
    expect(mapTarget(civ, { kind: 'person', id: x.id })).toEqual({ kind: 'polity', id: x.polity });
    const key = selectionKey(civ, { kind: 'person', id: x.id });
    expect(key).toBe(personKey(civ, x.id));
    const again = generateCiv(generateWorld({ ...DEFAULT_PARAMS, seed }));
    expect(resolvePersonKey(again, key)).toBe(x.id);
  });
});

describe('人物页 · 几处写法', () => {
  it('亲属按世系说:子、孙、父、兄弟、侄、伯父 / 叔父(比父亲年长是伯)、从兄弟、隔三代的;连不上的是空串', () => {
    // 甲生乙、丙;乙生丁、戊;丙生己、壬;丁生辛;庚和他们不是一家
    const born = [100, 130, 135, 160, 162, 170, 120, 185, 150];
    const parent = [undefined, 0, 0, 1, 1, 2, undefined, 3, 2];
    const people = born.map((b, id) => ({ id, born: b, parent: parent[id] }));
    const civ = { people } as never;
    const [甲, 乙, 丙, 丁, 戊, 己, 庚, 辛, 壬] = people as never[];
    expect(kinOf(civ, 甲, 乙)).toBe('子');
    expect(kinOf(civ, 甲, 丁)).toBe('孙');
    expect(kinOf(civ, 乙, 甲)).toBe('父');
    expect(kinOf(civ, 丁, 甲)).toBe('祖父');
    expect(kinOf(civ, 乙, 丙)).toBe('弟');
    expect(kinOf(civ, 丙, 乙)).toBe('兄');
    expect(kinOf(civ, 丙, 丁)).toBe('侄');
    expect(kinOf(civ, 丁, 丙)).toBe('叔父');
    expect(kinOf(civ, 己, 乙)).toBe('伯父');
    expect(kinOf(civ, 丁, 己)).toBe('从弟');
    expect(kinOf(civ, 己, 戊)).toBe('从兄');
    expect(kinOf(civ, 丁, 庚)).toBe('');
    // 隔三代:曾孙、侄孙、叔祖;父亲的堂兄弟比父亲年长是从伯父
    expect(kinOf(civ, 甲, 辛)).toBe('曾孙');
    expect(kinOf(civ, 丙, 辛)).toBe('侄孙');
    expect(kinOf(civ, 辛, 丙)).toBe('叔祖');
    expect(kinOf(civ, 辛, 己)).toBe('从叔父');
    expect(kinOf(civ, 辛, 壬)).toBe('从伯父');
  });

  /**
   * 例子按条件现找(历史变了不用跟着改):东方君主,称号"末帝",接祖父的位,即位那条写了辅政的名臣(那条写到的正好三个人);
   * 这个世界里搜"末帝"搜得到他,搜到的里面有名人。GENERATOR_VERSION 43 时前七个种子里都没有,是种子 38 的末帝林霜云
   * (种子 1–45 里还有 39、44);41 时是种子 6 的末帝季工(前面几个种子里,
   * 种子 2024 的江溟还在,但那个世界搜"末帝"没有名人了);40 时是种子 2024 的大辰末帝江溟(不是名人;
   * 搜"末帝"头一个是名人大岳末帝百里玄衍),39 时是种子 2024 的大澜末帝燕溟(是名人,搜"末帝"头一个就是他);
   * 48 时前面这些种子里都没有了,种子 1–22 里头一个是种子 22 的末帝婆陵
   */
  const lastEmperor = () => {
    for (const seed of [2024, 7, 11, 42, 3, 5, 6, 38, 39, 44, 22]) {
      const civ = civOf(seed);
      const P = civ.people!;
      const famous = new Set(famousPeople(civ).map((f) => f.id));
      const hits = searchCiv(civ, '末帝', 2600);
      if (!hits.some((h) => h.kind === 'person' && famous.has(h.id))) continue;
      for (const h of hits) {
        if (h.kind !== 'person') continue;
        const x = P[h.id];
        if (x.role === 'ruler' && x.title === '末帝' && civ.polities[x.polity].eastern) return { civ, x, hits, famous };
      }
    }
    return null;
  };
  /**
   * 接祖父的位、即位那条写了辅政的名臣(那条写到的正好三个人)的东方君主(称号不限)。GENERATOR_VERSION 57(湿地)以后
   * 种子 1–120 里都没有同时是末帝的(种子 1–20 里接祖父位的末帝只剩 1 位,他即位那条没写辅政),和上面的末帝分开找
   */
  const grandson = () => {
    for (const seed of [2024, 7, 11, 42, 3, 5, 6, 38, 39, 44, 22]) {
      const civ = civOf(seed);
      const P = civ.people!;
      const reigns = reignEntries(civ);
      for (const x of P) {
        if (x.role !== 'ruler' || x.rise !== 'heir' || !civ.polities[x.polity].eastern) continue;
        const prev = rulerNeighbors(civ, x).prev;
        if (!prev || kinOf(civ, x, prev) !== '祖父') continue;
        const e = reigns.find((r) => r.people?.[1] === x.id);
        if (!e || e.people!.length !== 3 || e.people![0] !== prev.id || P[e.people![2]].role !== 'minister' || !e.text.includes('辅政')) continue;
        return { civ, x, prev, e };
      }
    }
    return null;
  };

  it('称号"末帝"的君主(按条件现找):搜"末帝"名人排在前面;接祖父位、辅政的名臣写进即位那条的(按条件现找):前一位连国名一起切、他和辅政的名臣切名字', () => {
    const found = lastEmperor();
    expect(found, '几个种子里要有这样一位末帝').toBeTruthy();
    const { civ, x, hits, famous } = found!;
    expect(personName(civ, x)).toBe(`末帝${x.name}`);
    expect(rulerRole(civ, x)).toMatch(/皇帝$/);
    // 名人在前:头一个是名人;名人都排在不是名人的前面
    expect(hits[0].kind === 'person' && famous.has(hits[0].id)).toBe(true);
    const fame = hits.map((h) => h.kind === 'person' && famous.has(h.id));
    const firstPlain = fame.indexOf(false);
    expect(firstPlain < 0 || fame.lastIndexOf(true) < firstPlain).toBe(true);
    const k = hits.findIndex((h) => h.kind === 'person' && h.id === x.id);
    expect(k).toBeGreaterThanOrEqual(0);
    const s = personSpan(x);
    expect(hits[k]).toMatchObject({ kind: 'person', id: x.id, name: `末帝${x.name}`, sub: `${rulerRole(civ, x)}，${Math.floor(s.from)}–${Math.floor(s.until!)}` });
    // 编年史里写他即位的那条("大辰怀宗崩……其孙江溟即位,……丞相墨渺缈辅政"):前一位连国名一起切、他和辅政的名臣切名字
    const g = grandson();
    expect(g, '几个种子里要有这样一位接祖父位的').toBeTruthy();
    const { civ: c2, x: y, prev, e } = g!;
    expect(riseText(c2, y)).toMatch(/^继祖父/);
    const ms = personMentions(c2, e.text, e.people, -1, e.year).filter((m) => m.person !== undefined);
    expect(ms.map((m) => m.person)).toEqual(e.people);
    expect(ms.map((m) => m.text)).toEqual([rulerRef(c2, prev, e.year), y.name, c2.people![e.people![2]].name]);
  }, 120_000);
});
