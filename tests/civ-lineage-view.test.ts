/**
 * 世系图要用的数据(gen/civ/lineageInfo.ts):一国有几朝、标题和结尾那句、父亲 / 子嗣两头对得上、
 * 一朝的树里每人正好一次、不重叠、父亲在传下去那一支的正上方、兄弟按长幼从左往右;复制出来的家谱文字。
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_PARAMS, generateWorld } from '../src/gen/world';
import { generateCiv, type Civ } from '../src/gen/civ';
import type { Person } from '../src/gen/civ/types';
import { peopleIndex } from '../src/gen/civ/peopleInfo';
import { princeRole } from '../src/gen/civ/peopleText';
import { dynastyEnd, dynastyMembers, dynastyNote, dynastyRowAt, dynastyRows, fatherOf, hasLineage, kidsOf, layoutDynasty, lineageText } from '../src/gen/civ/lineageInfo';

const civs = new Map<number, Civ>();
function civOf(seed: number): Civ {
  let c = civs.get(seed);
  if (!c) civs.set(seed, (c = generateCiv(generateWorld({ ...DEFAULT_PARAMS, seed }))));
  return c;
}

describe.each([7, 2024])('世系图 · seed=%i', (seed) => {
  it('各朝:君主一个不落、按先后;父亲和子嗣两头对得上', () => {
    const civ = civOf(seed);
    const ix = peopleIndex(civ);
    for (const p of civ.polities) {
      if (!hasLineage(civ, p.id)) {
        expect(p.lineage === 'republic' || !ix.rulers[p.id]?.length).toBe(true);
        continue;
      }
      const rows = dynastyRows(civ, p.id);
      expect(rows.flatMap((r) => r.rulers)).toEqual(ix.rulers[p.id]);
      for (let i = 1; i < rows.length; i++) expect(rows[i].from).toBeGreaterThanOrEqual(rows[i - 1].from);
      expect(dynastyRowAt(rows, -1e9)).toBe(0);
      expect(dynastyRowAt(rows, 1e9)).toBe(rows.length - 1);
    }
    for (const x of civ.people!) {
      const f = fatherOf(civ, x);
      if (f) expect(kidsOf(civ, f)).toContain(x);
      const ks = kidsOf(civ, x);
      for (const k of ks) expect(fatherOf(civ, k)).toBe(x);
      for (let i = 1; i < ks.length; i++) expect(ks[i].born).toBeGreaterThanOrEqual(ks[i - 1].born);
    }
  });

  it('一朝的树:每人正好一次、一格一人;下一代低一行,父亲在一个儿子正上方;兄弟按长幼从左往右', () => {
    const civ = civOf(seed);
    let distant = 0;
    for (const p of civ.polities) {
      if (!hasLineage(civ, p.id)) continue;
      for (const row of dynastyRows(civ, p.id)) {
        const trees = layoutDynasty(civ, row);
        const members = dynastyMembers(civ, row);
        const placed = trees.flatMap((t) => t.nodes.map((n) => n.p));
        expect(new Set(placed).size).toBe(placed.length);
        expect(new Set(placed)).toEqual(new Set(members));
        // 第一棵是开国那一支
        expect(trees[0].distant).toBe(false);
        expect(trees[0].nodes.some((n) => n.p === row.rulers[0])).toBe(true);
        distant += trees.filter((t) => t.distant).length;
        for (const t of trees) {
          const at = new Map(t.nodes.map((n) => [n.p, n]));
          const cells = new Set(t.nodes.map((n) => `${n.x},${n.depth}`));
          expect(cells.size).toBe(t.nodes.length);
          expect(t.nodes.filter((n) => n.depth === 0)).toHaveLength(1);
          for (const n of t.nodes) {
            expect(Number.isInteger(n.x)).toBe(true);
            const ks = kidsOf(civ, n.p)
              .map((k) => at.get(k))
              .filter((k): k is NonNullable<typeof k> => !!k);
            if (!ks.length) continue;
            for (const k of ks) expect(k.depth).toBe(n.depth + 1);
            expect(ks.map((k) => k.x)).toContain(n.x);
            for (let i = 1; i < ks.length; i++) expect(ks[i].x).toBeGreaterThan(ks[i - 1].x);
          }
        }
      }
    }
    // 兜底成"宗室"的君主很少(连不上开国那一支,另起一棵)
    expect(distant).toBeLessThan(6);
  });

  it('复制成文字:一朝一段,标题、每人一行(下一代多缩两格)、结尾那句', () => {
    const civ = civOf(seed);
    const p = civ.polities.find((q) => hasLineage(civ, q.id) && (q.dynasties?.length ?? 0) > 1)!;
    const rows = dynastyRows(civ, p.id);
    const text = lineageText(civ, p.id);
    const lines = text.split('\n');
    for (let i = 0; i < rows.length; i++) {
      expect(lines).toContain(`${rows[i].name}(${dynastyNote(civ, rows, i)})`);
      const end = dynastyEnd(civ, rows, i);
      if (end) expect(lines).toContain(end);
    }
    const people = lines.filter((l) => /年在位$|未即位/.test(l));
    expect(people).toHaveLength(rows.reduce((n, r) => n + dynastyMembers(civ, r).length, 0));
    expect(text).not.toMatch(/undefined|NaN/);
  });
});

describe('世系图 · seed=7 的大景', () => {
  it('景朝:标题、结尾、宣王的父亲是没即位的柳尘泠;篡位的开国之君是树根;霄朝开国之君的父亲也是霄的宗室', () => {
    const civ = civOf(7);
    const rows = dynastyRows(civ, 0);
    expect(rows.map((r) => r.name)).toEqual(['云羽', '霄', '辰', '衍', '景', '渊']);
    const i = rows.findIndex((r) => r.name === '景');
    expect(dynastyNote(civ, rows, i)).toBe('2408–2794 年，26 位君主；平王柳泠清篡位');
    expect(dynastyEnd(civ, rows, i)).toBe('2794 年，渊朝起兵代之');
    expect(dynastyEnd(civ, rows, i - 1)).toBe('2408 年，平王篡位');
    expect(dynastyEnd(civ, rows, rows.length - 1)).toBe('');
    expect(dynastyNote(civ, rows, 0)).toMatch(/；.+立国$/);
    expect(dynastyRowAt(rows, 2512)).toBe(i);
    const xw = civ.people!.find((x) => x.name === '柳珩琅' && x.role === 'ruler')!;
    const f = fatherOf(civ, xw) as Person;
    expect(f).toMatchObject({ role: 'prince', name: '柳尘泠' });
    expect(kidsOf(civ, f).map((k) => k.name)).toEqual(['柳清瑶', '柳珩琅']);
    expect(lineageText(civ, 0)).toContain('\n        8 宣王柳珩琅 2482–2489 年在位\n');
    expect(princeRole(civ, f)).toBe('大景宗室');
    // 篡位的权臣没有连上父亲:这一朝的树从他起
    expect(layoutDynasty(civ, rows[i])[0].nodes[0].p).toMatchObject({ role: 'ruler', name: '柳泠清' });
    // 霄朝开国之君的父亲死在霄朝开国之前,也算霄的宗室(不写成"大云羽宗室")
    const h = rows.findIndex((r) => r.name === '霄');
    const root = layoutDynasty(civ, rows[h])[0].nodes[0].p;
    expect(root).toMatchObject({ role: 'prince', name: '云冥' });
    expect(root.died!).toBeLessThan(rows[h].from);
    expect(princeRole(civ, root)).toBe('大霄宗室');
  });
});
