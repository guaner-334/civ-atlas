/**
 * 世系图要用的数据(gen/civ/lineageInfo.ts):一国有几朝、标题和结尾那句、父亲 / 子嗣两头对得上、
 * 一朝的树里每人正好一次、不重叠、父亲在传下去那一支的正上方、兄弟按长幼从左往右;复制出来的家谱文字。
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_PARAMS, generateWorld } from '../src/gen/world';
import { generateCiv, type Civ } from '../src/gen/civ';
import type { Person } from '../src/gen/civ/types';
import { peopleIndex } from '../src/gen/civ/peopleInfo';
import { royalSeg } from '../src/gen/civ/regime';
import { personName, princeRole, rulerShort } from '../src/gen/civ/peopleText';
import { dynastyEnd, dynastyMembers, dynastyNote, dynastyRowAt, dynastyRows, fatherOf, hasLineage, kidsOf, layoutDynasty, lineageText, reignOrder, restoredFrom } from '../src/gen/civ/lineageInfo';

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
      // 改制开的共和、军政府那几段的执政不进世系图
      const royal = (ix.rulers[p.id] ?? []).filter((x) => royalSeg(p, x.dynasty ?? 0));
      if (!hasLineage(civ, p.id)) {
        expect(p.lineage === 'republic' || !royal.length).toBe(true);
        continue;
      }
      const rows = dynastyRows(civ, p.id);
      expect(rows.flatMap((r) => r.rulers)).toEqual(royal);
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
        // (复国之君的宗室远支 —— 隔得太远、只补了一位父亲的那一支 —— 不算)
        distant += trees.filter((t) => t.distant && !t.nodes.some((n) => restoredFrom(civ, n.p, p.id))).length;
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
    expect(distant).toBeLessThan(10);
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
    // 嫁到别国的女儿写"嫁某国"
    const people = lines.filter((l) => /年在位$|未即位| 嫁[^ ]+ /.test(l));
    expect(people).toHaveLength(rows.reduce((n, r) => n + dynastyMembers(civ, r).length, 0));
    expect(text).not.toMatch(/undefined|NaN/);
  });
});

describe('世系图 · seed=7 的几处写法(例子按条件现找)', () => {
  // 例子按条件现找,历史变了不用跟着改朝名、人名(GENERATOR_VERSION 40 时找到的写在各段的注释里;种子 7 里找不到就换种子 2024)
  const seeds = [7, 2024];
  /** 西幻(不是汗国、共和国)、到结束还在、第一朝是立国的国家里,篡位开出的一朝(不是第一朝、也不是最后一朝,下一朝不是篡位来的) */
  const usurped = () => {
    for (const seed of seeds) {
      const civ = civOf(seed);
      for (const p of civ.polities) {
        if (p.eastern || p.lineage === 'khanate' || p.lineage === 'republic' || p.ended !== undefined) continue;
        const rows = dynastyRows(civ, p.id);
        if (rows[0]?.rulers[0].rise !== 'found') continue;
        const i = rows.findIndex((r, k) => k > 0 && k < rows.length - 1 && r.rulers[0].rise === 'usurp' && rows[k + 1].rulers[0].rise !== 'usurp');
        if (i > 0) return { civ, rows, i };
      }
    }
    return null;
  };
  /** 西幻君主,父亲是没即位的宗室 */
  const princeSon = () => {
    for (const seed of seeds) {
      const civ = civOf(seed);
      // 父亲在他那一朝的树上(世系图、复制出来的世系里排在他上面)
      const inTree = (x: Person) => {
        const row = dynastyRows(civ, x.polity).find((r) => r.rulers.includes(x));
        return !!row && layoutDynasty(civ, row).some((t) => t.nodes.some((n) => n.p === fatherOf(civ, x)));
      };
      const xw = civ.people!.find((x) => x.role === 'ruler' && !civ.polities[x.polity].eastern && fatherOf(civ, x)?.role === 'prince' && x.until !== undefined && inTree(x));
      if (xw) return { civ, xw };
    }
    return null;
  };
  /** 东方的国家里,开国之君的父亲死在这一朝之前的一朝(树根是没即位的宗室) */
  const lateRoot = () => {
    for (const seed of seeds) {
      const civ = civOf(seed);
      for (const p of civ.polities) {
        if (!p.eastern) continue;
        const rows = dynastyRows(civ, p.id);
        const h = rows.findIndex((r, k) => {
          const top = k > 0 ? layoutDynasty(civ, r)[0]?.nodes[0]?.p : undefined;
          return top?.role === 'prince' && top.died !== undefined && top.died < r.from;
        });
        if (h > 0) return { civ, rows, h };
      }
    }
    return null;
  };

  it('篡位开出的一朝:标题、结尾、篡位的开国之君是树根;父亲没即位的君主:父亲是宗室,世系里排在父亲下面;受旧朝之后才兴的一朝,开国之君的父亲算本朝宗室', () => {
    // 1. 篡位开出的一朝(GENERATOR_VERSION 40 时是卢梅亚的维斯佩拉朝,1016–1346 年,奥克提乌斯一世篡位,后来王室更迭、拉沃罗纳兴)
    const u = usurped();
    expect(u, '要有篡位开出的一朝').toBeTruthy();
    const { rows, i } = u!;
    const civ = u!.civ;
    const row = rows[i];
    const founder = row.rulers[0];
    const span = `${Math.floor(row.from)}–${Math.floor(row.to!)} 年`;
    expect(dynastyNote(civ, rows, i)).toBe(`${span}，${row.rulers.length} 位君主；${rulerShort(civ, founder)}篡位`);
    expect(dynastyEnd(civ, rows, i)).toBe(`${Math.floor(row.to!)} 年，王室更迭，${rows[i + 1].name}兴`);
    expect(dynastyEnd(civ, rows, i - 1)).toBe(`${Math.floor(row.from)} 年，${rulerShort(civ, founder)}篡位`);
    // 最后一朝:还在 = 空串;后来改制改共和的写改了国号
    expect(dynastyEnd(civ, rows, rows.length - 1)).toMatch(/^$|改称/);
    expect(dynastyNote(civ, rows, 0)).toMatch(/；.+立国$/);
    expect(dynastyRowAt(rows, (row.from + row.to!) / 2)).toBe(i);
    // 篡位的权臣没有连上父亲:这一朝的树从他起
    expect(fatherOf(civ, founder)).toBeUndefined();
    expect(layoutDynasty(civ, row)[0].nodes[0].p).toBe(founder);

    // 2. 父亲没即位的西幻君主(GENERATOR_VERSION 40 时是埃维里亚的威尔贝尔特二世,父亲特里斯贝尔特,兄弟威洛尔德、埃姆里克)
    const s = princeSon();
    expect(s, '要有父亲没即位的君主').toBeTruthy();
    const { xw } = s!;
    const c2 = s!.civ;
    const f = fatherOf(c2, xw) as Person;
    expect(f.role).toBe('prince');
    expect(f.polity).toBe(xw.polity);
    expect(kidsOf(c2, f)).toContain(xw);
    for (const k of kidsOf(c2, f)) expect(k.parent).toBe(f.id);
    // 复制出来的世系:他那一行("3 威尔贝尔特二世 545–548 年在位")往上最近的、少缩进一层的那行是父亲("特里斯贝尔特 未即位 …")
    const r2 = dynastyRows(c2, xw.polity).find((r) => r.rulers.includes(xw))!;
    const text = lineageText(c2, xw.polity).split('\n');
    const pad = (l: string) => l.length - l.trimStart().length;
    const mine = `${reignOrder(r2, xw)} ${personName(c2, xw)} ${Math.floor(xw.from!)}–${Math.floor(xw.until!)} 年在位`;
    const xi = text.findIndex((l) => l.trimStart() === mine);
    expect(xi, mine).toBeGreaterThan(0);
    expect(pad(text[xi])).toBeGreaterThan(0);
    let fi = xi - 1;
    while (fi > 0 && pad(text[fi]) !== pad(text[xi]) - 2) fi--;
    expect(text[fi].trimStart().startsWith(`${personName(c2, f)} 未即位`), text[fi]).toBe(true);
    expect(princeRole(c2, f)).toMatch(/^\S+宗室$/);

    // 3. 开国之君的父亲死在这一朝之前,也算这一朝的宗室(GENERATOR_VERSION 40 时是天灵的岳朝,树根慕容风墨是"大岳宗室",不写成"天灵宗室")
    const l = lateRoot();
    expect(l, '要有树根是没即位宗室的一朝').toBeTruthy();
    const root = layoutDynasty(l!.civ, l!.rows[l!.h])[0].nodes[0].p;
    expect(root.role).toBe('prince');
    expect(root.died!).toBeLessThan(l!.rows[l!.h].from);
    expect(princeRole(l!.civ, root)).toContain(l!.rows[l!.h].name);
    // 凡是开国之君的父亲死在新朝之前的(树根是没即位的宗室),都不写成上一朝的宗室
    let roots = 0;
    for (const p of civ.polities) {
      const pr = dynastyRows(civ, p.id);
      pr.forEach((r, k) => {
        const top = k > 0 ? layoutDynasty(civ, r)[0]?.nodes[0]?.p : undefined;
        if (top?.role !== 'prince' || !(top.died! < r.from)) return;
        roots++;
        expect(princeRole(civ, top), `${p.name} ${r.name}`).not.toContain(pr[k - 1].name);
      });
    }
    expect(roots).toBeGreaterThan(0);
  });
});
