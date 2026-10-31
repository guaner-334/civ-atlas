/**
 * 将门世家(gen/civ/kin.ts)和复国之君接上故国世系(gen/civ/lineage.ts):
 * 将领、名臣有一部分是本国先前一位将领、名臣的孩子(年纪合得上、随父姓、籍贯同父亲),有三代为将、父子相继为相;
 * 复国之君接到故国末代那一朝的人下面,中间补几代故国宗室,隔得太远的补一位父亲、记成末帝的几世孙。
 * 接着往后推,先出道的人父子关系不变。
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_PARAMS, generateWorld } from '../src/gen/world';
import { generateCiv, type Civ } from '../src/gen/civ';
import type { Person } from '../src/gen/civ/types';
import { splitSurname } from '../src/gen/civ/story/peopleText';
import { createPersonNamer } from '../src/gen/names/persons';
import { dynastyRows, fallenLabel, fromFallen, hasLineage, layoutDynasty, lineageText, restoredFrom } from '../src/gen/civ/story/lineageInfo';
import { royalSeg } from '../src/gen/civ/regime';

const worlds = new Map<number, ReturnType<typeof generateWorld>>();
const worldOf = (seed: number) => {
  let w = worlds.get(seed);
  if (!w) worlds.set(seed, (w = generateWorld({ ...DEFAULT_PARAMS, cells: 12000, seed })));
  return w;
};
const civs = new Map<number, Civ>();
const civOf = (seed: number) => {
  let c = civs.get(seed);
  if (!c) civs.set(seed, (c = generateCiv(worldOf(seed))));
  return c;
};
const surnamed = (c: Civ, x: Person) => createPersonNamer(c.seed, c.cultures[c.polities[x.polity].culture]?.style || 'kingdom').surnamed;
const debut = (x: Person) => (x.role === 'general' ? x.commands![0].from : x.from!);

describe.each([7, 2024])('将门、世家 · seed=%i', (seed) => {
  it('父辈是本国先前出道的同一种人,生他时 20–42 岁、他出生时在世;随父姓、籍贯同父亲;各占一成上下', () => {
    const c = civOf(seed);
    const P = c.people!;
    for (const role of ['general', 'minister'] as const) {
      const all = P.filter((x) => x.role === role);
      const kin = all.filter((x) => x.parent !== undefined);
      for (const x of kin) {
        const f = P[x.parent!];
        expect(f.role, x.name).toBe(role);
        expect(f.polity).toBe(x.polity);
        expect(debut(f)).toBeLessThan(debut(x));
        expect(x.born - f.born).toBeGreaterThanOrEqual(20 - 1 / 128);
        expect(x.born - f.born).toBeLessThanOrEqual(42 + 1 / 128);
        if (f.died !== undefined) expect(x.born).toBeLessThanOrEqual(f.died);
        if (surnamed(c, x)) expect(splitSurname(x.name), `${f.name} → ${x.name}`).toBe(splitSurname(f.name));
        expect(x.home).toBe(f.home);
      }
      // 将领一成上下、名臣半成到一成(20 个种子:将领 5.5%–16%,名臣 3.7%–10%;
      // GENERATOR_VERSION 56 滚雪球以后亡国快,父辈那一国先亡了的多:种子 1–20 将领 2.7%–13.7%(7 号最少)、名臣 3.4%–9.6%,将领的下限放到 2.5%)
      const share = kin.length / all.length;
      expect(share, role).toBeGreaterThan(role === 'general' ? 0.025 : 0.03);
      expect(share, role).toBeLessThan(role === 'general' ? 0.2 : 0.13);
      // 一位父辈名下至多两个
      const n = new Map<number, number>();
      for (const x of kin) n.set(x.parent!, (n.get(x.parent!) ?? 0) + 1);
      expect(Math.max(...n.values())).toBeLessThanOrEqual(2);
    }
    // 三代为将(或三代为臣)的有
    const three = P.filter((x) => (x.role === 'general' || x.role === 'minister') && x.parent !== undefined && P[x.parent].parent !== undefined);
    expect(three.length).toBeGreaterThan(0);
  });

  it('接着往后推:先出道的将领、名臣父辈不变', () => {
    const w = worldOf(seed);
    const full = civOf(seed);
    let n = 0;
    for (const cut of [1200, 2400]) {
      const part = generateCiv(w, { endYear: cut });
      for (const x of part.people!) {
        if (x.role !== 'general' && x.role !== 'minister') continue;
        const y = full.people![x.id];
        expect(y.born).toBe(x.born);
        expect(y.parent, `${cut} ${x.name}`).toBe(x.parent);
        if (x.parent !== undefined) n++;
      }
    }
    // (GENERATOR_VERSION 56 以后种子 1–20 是 11–60 个,7 号 13 个;以前下限 20)
    expect(n).toBeGreaterThan(10);
  }, 60_000);
});

describe.each([7, 2024])('复国之君接上故国世系 · seed=%i', (seed) => {
  it('故国有王室的复国之君都接上:父辈是故国末代那一朝的人;"出自"的君主在世系里(或隔得太远、只补了父亲);补的宗室在复国以前去世', () => {
    const c = civOf(seed);
    const P = c.people!;
    const rs = P.filter((x) => x.rise === 'restore' && x.author === undefined);
    expect(rs.length).toBeGreaterThan(3);
    let linked = 0;
    let near = 0;
    let far = 0;
    for (const F of rs) {
      const pol = c.polities[F.polity];
      const fallen = c.polities[pol.restores!];
      if (fallen.lineage === 'republic') {
        // 故国是共和国:没有王室,不接
        expect(F.parent).toBeUndefined();
        expect(F.descent).toBeUndefined();
        continue;
      }
      if (F.parent === undefined) continue;
      linked++;
      const f = P[F.parent];
      expect(f.polity).toBe(fallen.id);
      // 末代那一朝:有君主的最后一朝(改制改成共和、军政府的那几段没有王室)
      const lastDyn = Math.max(...P.filter((x) => x.role === 'ruler' && x.polity === fallen.id && royalSeg(fallen, x.dynasty ?? 0)).map((x) => x.dynasty ?? 0));
      expect(f.dynasty ?? 0).toBe(lastDyn);
      const age = F.born - f.born;
      expect(age).toBeGreaterThanOrEqual(14 - 1 / 128);
      expect(age).toBeLessThanOrEqual(55 + 1 / 128);
      // 补的宗室(为他补的,编号排在他后面):在复国以前去世,随末代的姓
      const L = P.filter((x) => x.role === 'ruler' && x.polity === fallen.id && royalSeg(fallen, x.dynasty ?? 0)).sort((a, b) => a.from! - b.from!).at(-1)!;
      for (let d: Person | undefined = f; d && d.role === 'prince' && d.id > F.id; d = d.parent !== undefined ? P[d.parent] : undefined) {
        expect(d.died!).toBeLessThan(F.from!);
        if (surnamed(c, L) && surnamed(c, d)) expect(splitSurname(d.name)).toBe(splitSurname(L.name));
      }
      const D = F.descent;
      if (!D) continue;
      const R = P[D.from];
      expect(R.role).toBe('ruler');
      expect(R.polity).toBe(fallen.id);
      // 中间几代都在世系里:往上数 gen 代正好是他;远支:只补了一位父亲(他没有父亲),隔四代以上
      let a: Person | undefined = F;
      for (let i = 0; i < D.gen && a; i++) a = a.parent !== undefined ? P[a.parent] : undefined;
      if (a === R) near++;
      else {
        far++;
        expect(f.parent).toBeUndefined();
        expect(D.gen).toBeGreaterThanOrEqual(4);
        expect(R).toBe(L);
      }
    }
    expect(linked).toBeGreaterThan(0);
    expect(near + far).toBeGreaterThan(0);
  });

  it('接着往后推:先复国的那几位接上的父辈、出自不变', () => {
    const w = worldOf(seed);
    const full = civOf(seed);
    let n = 0;
    for (const cut of [1200, 2000]) {
      const part = generateCiv(w, { endYear: cut });
      for (const x of part.people!) {
        if (x.rise !== 'restore') continue;
        const y = full.people![x.id];
        expect(y.parent).toBe(x.parent);
        expect(y.descent).toEqual(x.descent);
        if (x.parent !== undefined) n++;
      }
    }
    expect(n).toBeGreaterThan(0);
  }, 60_000);
});

describe.each([7, 2024])('复国之君的世系图 · seed=%i', (seed) => {
  it('他那一国第一朝的树:树根是他在故国的父辈,树顶往上到故国的一位君主;故国的树里他挂在父辈下面;复制全文写上故国那几代', () => {
    const c = civOf(seed);
    const P = c.people!;
    let up = 0;
    let down = 0;
    for (const F of P.filter((x) => x.rise === 'restore' && x.parent !== undefined)) {
      const pol = c.polities[F.polity];
      const f = P[F.parent!];
      if (hasLineage(c, F.polity)) {
        const t = layoutDynasty(c, dynastyRows(c, F.polity)[0])[0];
        const root = t.nodes.find((n) => n.depth === 0)!.p;
        expect(root).toBe(f);
        expect(fromFallen(c, root, F.polity)).toBe(true);
        expect(t.nodes.find((n) => n.p === F)!.depth).toBe(1);
        const chain = [...(t.up ?? []), root];
        for (let i = 1; i < chain.length; i++) expect(chain[i].parent).toBe(chain[i - 1].id);
        // 往上到故国的一位君主为止(远支只有树根一位)
        if (t.up?.length) expect(t.up[0].role).toBe('ruler');
        expect(lineageText(c, F.polity)).toContain(fallenLabel(c, pol.restores!));
        up++;
      }
      // 故国那一朝的树里:他挂在父辈下面
      const row = dynastyRows(c, pol.restores!).find((r) => r.index === (f.dynasty ?? 0));
      if (!row) continue;
      const t = layoutDynasty(c, row).find((x) => x.nodes.some((n) => n.p === F));
      expect(t, F.name).toBeTruthy();
      expect(restoredFrom(c, F, f.polity)).toBe(true);
      const nf = t!.nodes.find((n) => n.p === f)!;
      expect(t!.nodes.find((n) => n.p === F)!.depth).toBe(nf.depth + 1);
      down++;
    }
    expect(up).toBeGreaterThan(0);
    expect(down).toBeGreaterThan(0);
  });
});
