/**
 * 君主的世系:谁是谁的父亲。people.ts 排完君主、将领以后调用,只往人物上添 Person.parent 和没即位的宗室,
 * 君主、将领的名字、生卒、在位年份一样都不改。
 *
 * 每个国家(共和国除外)每一朝,从第二位起按即位先后给继位的君主找父亲。年纪要对得上:父亲生他时 GEN_AGE 岁之间,
 * 他出生时父亲还在世(或刚去世不久,遗腹子)。先照两人的年纪差试最顺的说法:
 *   - 差 14 岁以上 → 前一位的儿子;差 40 岁以上 → 孙子(中间补一位没即位、在他即位前去世的父亲,早卒的太子)
 *   - 差得少 → 和前一位同一个父亲的兄弟(前一位没有父亲 —— 一朝的第一位 —— 就补一位没即位的父亲)
 * 对不上再依次试:前一位兄弟的儿子(侄)、前一位祖父的儿子(叔伯)、前一位叔伯的儿子(从兄弟);
 * 都不行、他比前一位小 14 岁以上的,算前一位过继的养子(Person.adopted);再不行就不连(宗室远支)。
 * 君主的诸子、养子(royals.ts 排好的,opts.sons)先挂在父亲下面,侄、从兄弟也可能是这些人的儿子;他们的名字也在这里起。
 * 补出来的人是 role = 'prince' 的人物(只有国家、朝代、名字、生卒、父亲);编号按"为了哪一位君主即位补的"那一刻排(people.ts)。
 *
 * **复国之君接上故国世系**:复国的第一位(rise = 'restore')在故国末代那一朝里找一位能做他祖上的人(末帝、末帝的诸子、
 * 那一朝别的君主和宗室),中间至多补 RESTORE_LINKS − 1 代没即位的宗室(故国的人,补的父辈都在他复国以前去世),
 * 隔的代数最少的优先,一样少的先挑末帝那一支、再挑年纪近的;他就是末帝的儿子也行(不用补人)。
 * 隔得太远、几代接不上的(亡国一两百年以后才复国的):补一位故国宗室当他的父亲,这一支算宗室远支,
 * "出自"照年纪差记成末帝的几世孙(Person.descent)。故国是共和国(没有王室)的不接。
 * 补出来的宗室在故国的世系图里;复国之君挂在父亲下面(他自己那一国的树里,树顶画出故国这几代,见 lineageInfo.ts)。
 *
 * 只往前看:每一位的父亲只取决于他和他之前的君主;补出来的宗室的生卒、名字只看补他的那一刻以前的人 ——
 * 干预某年之前、接着往后推,那时的世系都不变。不用随机数,名字按位置锚取(和君主、将领同一个起名器)。
 * 纯计算,不碰 DOM。
 */

import type { Person, Polity, Year } from './types';
import type { Son } from './royals';
import { royalSeg } from './regime';

/** 生儿子的年纪 */
const GEN_AGE: [number, number] = [14, 55];
/** 父亲去世后最多这么久出生(遗腹子) */
const POSTHUMOUS = 0.75;
/** 一生最多这么多岁(同 people.ts) */
const MAX_AGE = 88;
/** 补出来的开国之君的父亲:比两个儿子里年长的那个大多少岁(年纪差太大时少一些) */
const FOUNDER_FATHER_AGE = 30;
/** 补出来的宗室起名最多试几次(和那时本国已有的君主、将领、名臣、别的宗室都不重名) */
const PRINCE_NAME_TRIES = 120;
/** 用满了以后:至少和前后这么多年里出生的同名人物错开(同 people.ts) */
const NAME_GAP = 300;
/** 复国之君接上故国世系:从找到的祖上到他至多隔几代(补的宗室 = 这个数 − 1);补的那几代父子之间差多少岁 */
const RESTORE_LINKS = 3;
const RESTORE_GAP: [number, number] = [18, 45];
/** 补的宗室最多活到多少岁(都在复国以前去世);远支的父亲比他大多少岁;远支照年纪差折几世孙时一代算多少年 */
const RESTORE_LIFE = 64;
const DISTANT_FATHER = 30;
const DISTANT_GEN = 30;

const TICK = 256;
const q = (x: number) => Math.round(x * TICK) / TICK;

interface Node {
  p: Person;
  born: Year;
  /** 卒年;还在世 = Infinity */
  died: Year;
  parent?: Node;
  kids: Node[];
  /** 补出来的宗室:为了哪一位君主即位补的(那一刻);君主的诸子:Son.debut */
  debut?: Year;
  /** 补出来的先后(起名排序用) */
  order?: number;
  /** 复国之君接上故国补出来的宗室:随这位君主的姓(故国末代的姓) */
  sur?: Person;
}

export interface LineageNamer {
  /** 东方中式:名字前面要加姓 */
  surnamed: boolean;
  given(...key: number[]): string;
}

/**
 * 给每国的君主连上父亲,返回补出来的宗室(按国家、补出来的先后)和补他们的那一刻(debut)。rulers[国家] = 这国的君主(即位先后);
 * Person.parent 先记成 Person(parentOf),等 people.ts 排好编号再换成编号
 */
export function buildLineage(
  polities: readonly Polity[],
  rulers: readonly Person[][],
  /** 别的人物(将领、名臣):补出来的宗室不和本国的这些人重名 */
  generals: readonly Person[],
  opts: {
    tag: readonly number[];
    namerOf: (p: Polity) => LineageNamer;
    surnameOf: (ruler: Person) => string;
    /** 君主的诸子(royals.ts;没即位的在这里起名、算进返回的宗室,出道那一刻 = Son.debut) */
    sons?: ReadonlyMap<Person, readonly Son[]>;
  },
): { princes: Person[]; parentOf: Map<Person, Person>; debut: Map<Person, Year>; descent: Map<Person, { from: Person; gen: number }> } {
  const princes: Person[] = [];
  const parentOf = new Map<Person, Person>();
  const debut = new Map<Person, Year>();
  /** 复国之君 → 出自故国哪位君主、隔几代 */
  const descent = new Map<Person, { from: Person; gen: number }>();
  /** 故国 → 复它的国家 */
  const restorers = new Map<number, Polity[]>();
  for (const P of polities) {
    if (P.restores === undefined) continue;
    const l = restorers.get(P.restores);
    if (l) l.push(P);
    else restorers.set(P.restores, [P]);
  }
  /** 复国之君(接好了故国的父辈)→ 他那个节点:排他自己那一国时接着用,继位的兄弟、侄子照样能连到这位父辈下面 */
  const restored = new Map<Person, Node>();
  /** 各国的将领、名臣:出道那年 + 名字 */
  const generalNames: [Year, string, Year][][] = polities.map(() => []);
  for (const g of generals) generalNames[g.polity]?.push([g.commands?.[0]?.from ?? g.from ?? g.born, g.name, g.born]);
  for (const p of polities) {
    if (p.lineage === 'republic') continue;
    // 改制开的共和、军政府那几段的执政不连世系
    const list = rulers[p.id].filter((x) => royalSeg(p, x.dynasty ?? 0));
    const mine: Node[] = [];
    const nodes = new Map<Person, Node>();
    const prince = (born: Year, died: Year, dynasty: number, at: Year): Node => {
      const x: Person = { id: -1, role: 'prince', polity: p.id, name: '', born: q(born), died: q(died), fate: 'died', dynasty };
      const n: Node = { p: x, born: x.born, died: x.died!, kids: [], debut: at };
      mine.push(n);
      return n;
    };
    const fits = (f: Node, x: Node) => {
      const age = x.born - f.born;
      if (age < GEN_AGE[0] || age > GEN_AGE[1]) return false;
      return x.born <= f.died + POSTHUMOUS;
    };
    const adopt = (f: Node, x: Node) => {
      x.parent = f;
      f.kids.push(x);
    };
    const child = (f: Node | undefined, x: Node) => !!f && fits(f, x) && (adopt(f, x), true);
    /** 补一位没即位的宗室:f 的儿子、x 的父亲,在 x 即位前去世 */
    const bridge = (f: Node | undefined, x: Node, from: Year): boolean => {
      if (!f) return false;
      const lo = Math.max(f.born + GEN_AGE[0], x.born - GEN_AGE[1]);
      const hi = Math.min(f.died + POSTHUMOUS, x.born - GEN_AGE[0]);
      if (lo > hi) return false;
      const b = (lo + hi) / 2;
      const m = prince(b, Math.max(x.born, Math.min(from - 1, b + MAX_AGE)), x.p.dynasty ?? 0, from);
      adopt(f, m);
      adopt(m, x);
      return true;
    };
    /** 诸子里即位了的(预定的继承人)→ 父亲 */
    const sonOf = new Map<Person, Node>();
    for (let k = 0; k < list.length; k++) {
      const r = list[k];
      const X: Node = restored.get(r) ?? { p: r, born: r.born, died: r.died ?? Infinity, kids: [] };
      nodes.set(r, X);
      // 他的诸子先挂上(即位了的那一个等他即位时再挂)
      for (const s of opts.sons?.get(r) ?? []) {
        if (s.p.role === 'ruler') {
          sonOf.set(s.p, X);
          continue;
        }
        const n: Node = { p: s.p, born: s.p.born, died: s.p.died ?? Infinity, kids: [], debut: s.debut };
        mine.push(n);
        adopt(X, n);
      }
      // 复辟迎回旧王室(那一段的 house):第一位接到旧王室最后那位下面(和继位一样按年纪连)
      const house = r.rise === 'reform' ? p.dynasties?.[r.dynasty ?? 0]?.house : undefined;
      const prev = house !== undefined ? list.slice(0, k).reverse().find((x) => (p.dynasties?.[x.dynasty ?? 0]?.house ?? x.dynasty ?? 0) === house) : list[k - 1];
      // 作者立的君主(Person.author)不连父子:他自己不算谁的儿子,继他之位的也不硬说是他的儿子
      if (!prev || (house === undefined && (r.rise !== 'heir' || (prev.dynasty ?? 0) !== (r.dynasty ?? 0))) || prev.author !== undefined) continue;
      const PV = nodes.get(prev)!;
      const born = sonOf.get(r);
      if (born) {
        adopt(born, X);
        continue;
      }
      const gap = r.born - prev.born;
      const from = r.from ?? r.born;
      // 1) 照年纪差最顺的说法
      let ok = false;
      if (gap >= 40) ok = bridge(PV, X, from);
      else if (gap >= GEN_AGE[0]) ok = child(PV, X);
      else if (PV.parent) ok = child(PV.parent, X);
      else {
        const a = Math.min(PV.born, X.born);
        const b = Math.max(PV.born, X.born);
        if (b - a <= GEN_AGE[1] - GEN_AGE[0]) {
          const f = prince(a - Math.max(GEN_AGE[0], Math.min(FOUNDER_FATHER_AGE, GEN_AGE[1] - (b - a))), b, r.dynasty ?? 0, from);
          adopt(f, PV);
          adopt(f, X);
          ok = true;
        }
      }
      if (ok) continue;
      // 2) 对不上:按辈分由近到远
      const G = PV.parent;
      const GG = G?.parent;
      if (gap >= GEN_AGE[0] && child(PV, X)) continue;
      if (G && G.kids.some((s) => s !== PV && child(s, X))) continue;
      if (bridge(G, X, from)) continue;
      if (child(GG, X)) continue;
      if (gap >= 2 * GEN_AGE[0] && bridge(PV, X, from)) continue;
      if (GG && GG.kids.some((s) => s !== G && child(s, X))) continue;
      if (bridge(GG, X, from)) continue;
      // 前一位过继的养子
      if (gap >= GEN_AGE[0]) {
        adopt(PV, X);
        r.adopted = true;
      }
    }
    // 复这一国的复国之君:接到末代那一朝的人下面(中间补几代宗室);接不上的补一位父亲,算宗室远支
    const L = list[list.length - 1];
    for (const P of restorers.get(p.id) ?? []) {
      const F = rulers[P.id]?.[0];
      if (!L || L.author !== undefined || !F || F.rise !== 'restore' || F.author !== undefined) continue;
      const lastDyn = L.dynasty ?? 0;
      const at = F.from ?? F.born;
      const FN: Node = { p: F, born: F.born, died: F.died ?? Infinity, kids: [] };
      /** 从 A 接到他要几代(接不上 = Infinity):父子差的岁数在范围里、A 生下一代时还在世 */
      const links = (A: Node): number => {
        const D = F.born - A.born;
        for (let s = 1; s <= RESTORE_LINKS; s++) {
          const g = D / s;
          const lo = s === 1 ? GEN_AGE[0] : RESTORE_GAP[0];
          const hi = s === 1 ? GEN_AGE[1] : RESTORE_GAP[1];
          if (g < lo) break;
          if (g > hi || A.born + g > A.died + POSTHUMOUS) continue;
          return s;
        }
        return Infinity;
      };
      const fromL = (A: Node) => {
        for (let d: Node | undefined = A; d; d = d.parent) if (d.p === L) return true;
        return false;
      };
      let best: Node | undefined;
      let bestS = Infinity;
      for (const A of [...nodes.values(), ...mine]) {
        if ((A.p.dynasty ?? 0) !== lastDyn || A.p.polity !== p.id || A.debut! > at) continue;
        const s = links(A);
        if (s === Infinity) continue;
        const better = !best || s < bestS || (s === bestS && (fromL(A) !== fromL(best) ? fromL(A) : A.born > best.born));
        if (better) {
          best = A;
          bestS = s;
        }
      }
      /** 补一位宗室(故国的人,在复国以前去世),child 是他的孩子 */
      const bridge = (born: Year, child: Node): Node => {
        const m = prince(born, Math.max(child.born, Math.min(at - 1, born + RESTORE_LIFE)), lastDyn, at);
        m.sur = L;
        adopt(m, child);
        return m;
      };
      if (best) {
        let child = FN;
        const D = F.born - best.born;
        for (let i = bestS - 1; i >= 1; i--) child = bridge(best.born + (i * D) / bestS, child);
        adopt(best, child);
        // 出自:往上数到第一位故国的君主
        let gen = 0;
        for (let d: Node | undefined = FN; d; d = d.parent, gen++) {
          if (d !== FN && d.p.role === 'ruler' && d.p.polity === p.id) {
            descent.set(F, { from: d.p, gen });
            break;
          }
        }
      } else {
        // 远支:补一位父亲;照年纪差记成末帝的几世孙(差得不够几代的不记)
        bridge(F.born - DISTANT_FATHER, FN);
        const D = F.born - L.born;
        if (D >= (RESTORE_LINKS + 1) * RESTORE_GAP[0]) {
          const gen = Math.max(RESTORE_LINKS + 1, Math.min(Math.floor(D / RESTORE_GAP[0]), Math.max(Math.ceil(D / RESTORE_GAP[1]), Math.round(D / DISTANT_GEN))));
          descent.set(F, { from: L, gen });
        }
      }
      parentOf.set(F, FN.parent!.p);
      restored.set(F, FN);
    }
    // 宗室的名字:东方中式 = 本朝的姓 + 名;不和出道那一刻这国已有的君主、将领、名臣、先出道的宗室(连同预定的继承人)同名
    // (按出道的先后起;出道一样早的按补出来的先后)。预定的继承人(royals.ts)名字已经起好,不改
    const namer = opts.namerOf(p);
    /** 用过的名字 → 那些人的生年 */
    const used = new Map<string, Year[]>();
    const use = (name: string, born: Year) => {
      const ys = used.get(name);
      if (ys) ys.push(born);
      else used.set(name, [born]);
    };
    let ri = 0;
    let gi = 0;
    const others = generalNames[p.id].slice().sort((a, b) => a[0] - b[0]);
    // 预定的继承人(即位了的、还没即位的都算):做儿子出道那一刻起名字就算用过了 ——
    // 还没即位的名字是照他即位时先起好的,往后推他即位了也是这个名字:同一刻出道的兄弟不会推到这里时和他同名、推远了又改名
    const heirs: [Year, string, Year][] = [];
    for (const r of list) for (const s of opts.sons?.get(r) ?? []) if (s.p.role === 'ruler' || (s.heirAt !== undefined && s.p.name)) heirs.push([s.debut, s.p.name, s.p.born]);
    heirs.sort((a, b) => a[0] - b[0]);
    let hi = 0;
    mine.forEach((n, i) => (n.order = i));
    mine.sort((a, b) => a.debut! - b.debut! || a.order! - b.order!);
    let named = 0;
    mine.forEach((n) => {
      const t = n.debut!;
      for (; ri < list.length && (list[ri].from ?? list[ri].born) <= t; ri++) use(list[ri].name, list[ri].born);
      for (; gi < others.length && others[gi][0] <= t; gi++) use(others[gi][1], others[gi][2]);
      for (; hi < heirs.length && heirs[hi][0] <= t; hi++) use(heirs[hi][1], heirs[hi][2]);
      // 预定的继承人没即位的:名字照君主起(西幻可以和先君同名)。和那以前出道的将领、名臣撞了也照旧 —— 他日后即位,
      // 君主的名字本来就不避先出道的将领、名臣;这里另起的话,推到他即位以前、以后名字就不一样了(接着推改了过去)。
      // 东方的和那以前即位的君主撞了另起(父亲被废、换了一支即位时,照"下一位君主"起的名字会和真即位的那位一样)
      const crowned = (x: string) => !!p.eastern && list.some((o) => o.name === x && (o.from ?? o.born) <= t && Math.abs(o.born - n.born) < NAME_GAP);
      if (n.p.name && !crowned(n.p.name)) {
        use(n.p.name, n.born);
        if (Number.isFinite(n.died)) n.p.died = q(n.died);
        debut.set(n.p, t);
        return;
      }
      const i = named++;
      let r: Person | undefined = n.sur;
      // (复国之君是别国的君主,不随他的姓)
      for (let d: Node | undefined = n; d && !r; d = d.kids.find((c) => c.p.role === 'ruler') ?? d.kids[0]) if (d.p.role === 'ruler' && d.p.polity === p.id) r = d.p;
      // 没有即位的子孙(君主的诸子):随父亲的姓
      for (let d = n.parent; d && !r; d = d.parent) if (d.p.role === 'ruler') r = d.p;
      const sur = namer.surnamed && r ? opts.surnameOf(r) : '';
      // 名字少的语感(几百个、抽出来常重复)一国用过的名字多了,24 次常常凑不出没用过的:多试几次;
      // 宗室多的国家用满了,就只求和前后 NAME_GAP 年里出生的同名人物不撞
      const at = (a: number) => sur + namer.given(opts.tag[p.id], 2, i, a);
      const near = (x: string) => !!used.get(x)?.some((y) => Math.abs(y - n.born) < NAME_GAP);
      let name = '';
      for (let a = 0; a < PRINCE_NAME_TRIES && !name; a++) if (!used.has(at(a))) name = at(a);
      for (let a = 0; a < PRINCE_NAME_TRIES && !name; a++) if (!near(at(a))) name = at(a);
      name ||= at(0);
      use(name, n.born);
      n.p.name = name;
      if (Number.isFinite(n.died)) n.p.died = q(n.died);
      debut.set(n.p, t);
    });
    for (const n of [...nodes.values(), ...mine]) if (n.parent) parentOf.set(n.p, n.parent.p);
    princes.push(...mine.map((n) => n.p));
  }
  return { princes, parentOf, debut, descent };
}
