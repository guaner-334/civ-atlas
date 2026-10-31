/**
 * 推演里的女性:人物都按男的排完、起好名字以后(people.ts 的最后一步),按语感的规矩和比例把一部分人换成女的、另起女名。
 * 只换性别和名字(连带字,西幻同名女王的序数):谁在位、在位多久、领哪几仗、生卒、父子关系一样都不改 ——
 * 推演里本来就没有"继承顺序",父子兄弟是事后按年纪认的(lineage.ts),所以把某一位说成女儿、妹妹,历史一点不受影响。
 *
 * 谁能是女的:
 * - 世袭的君主,按语感分两种规矩(RULE):
 *   - 无子传女(中原、边塞):继位的是先君的孩子、先君那时没有别的在世的孩子;或是先君的手足、先君那时没有在世的孩子(兄终妹及)。
 *     开国之君(立国、自立、复国、篡位、起兵代之)不换
 *   - 长子女优先(仙侠、山海、西幻):继位的是先君在世的孩子里最年长的;或是先君的手足、先君那时没有在世的孩子。开国之君也可以
 *   两种都要:她命里的孩子(和原定接她位、按年纪连成她孩子的那一位)都生在她 FERTILE 岁之间、她在世时。
 *   孙辈接位、远支、作者立的君主不换
 * - 君主的儿女(royals.ts 的诸子):预定的继承人(太子)照上面君主的规矩、按预定即位的那一刻定;别的儿女都可以。
 *   后来争储得位、据地自立、摄政篡位、领兵、结亲,都还是出道时定的那样
 * - 世系里补出来的父辈(下面有后人)照旧是男的;共和国的执政官、将领、名臣都可以
 * 能换的人里按语感抽(RATES,每个世界约 2 成君主、1 成多的将领名臣、2 成多的宗室是女的)。
 *
 * 都只看这个人出道的那一刻就定得下来的事("先君有没有别的孩子在世""她的孩子生在几岁"按命里该有的儿子和原定的在位表算,
 * royals.ts 的 broodOf、rulers.ts 的 reignStep,和推到哪一年无关),随机数只看这个人自己 —— keyed4(subSeed(seed, 'civ-gender'),
 * 国家的位置锚, 生年, 身份),君主的儿女按父亲那一国、不分即位没即位,篡位的名臣按名臣算。所以接着往后推、
 * 在后面的年份干预以后重推,先出道的人性别、名字都不变。代价是日后才有的事不再回头看:她日后在联姻里结了亲,
 * 就是她嫁过去、配偶是对方的宗室子(她孩子的"母亲"就是她,不另记嫁来的宗室女);世系里后来连到她名下的孩子照连。
 *
 * 名字:女名表在 names/persons.ts(femaleGiven);东方带姓的语感保留原来的姓(王朝的姓、将领名臣自己的姓)。
 * 原来的男名记在 Person.maleName(不显示;头像的长相按它一代代往下传,她的后人长相不变)。
 * 按出道先后起,不和此前出道的人重名(名字少的语感至少和本国的人、前后 NAME_GAP 年里出生的同名人物错开);
 * 西幻同一朝的女王(和预定即位的公主)有 REUSE 的机会沿用本朝女王用过的名字(序数照男王的规矩编,男女分开数)。
 * 将领、名臣的字照女名另起(officials.ts 的 courtesyName)。后妃(嫁来的宗室女、临朝的太后,consorts.ts)本来就是女的,
 * 名字在这里和别的女性一起按出道先后起(nameWomen)。纯计算,不碰 DOM。
 */
import type { PersonNamer } from '../names';
import { keyed4, subSeed } from './rand';
import { courtesyName } from './officials';
import { splitSurname } from './peopleText';
import { broodOf, type Son } from './royals';
import { leaningEffect, reignBorn, reignStep, type Reign } from './rulers';
import type { Person, Polity, Year } from './types';
import { royalSeg, segLineage } from './regime';

// ---- 调参 ----
/** 女君亲生的孩子要生在她这个岁数之间 */
const FERTILE: [number, number] = [16, 45];
/** 世系里连父子的年纪、隔代的年纪差、遗腹子最多晚几年(同 lineage.ts):原定接她位的那一位怎么连到她身上 */
const GEN_AGE: [number, number] = [14, 55];
const BRIDGE_GAP = 40;
const POSTHUMOUS = 0.75;
/** 西幻女王沿用本朝女王名字的机会(同男王,people.ts 的 REUSE) */
const REUSE = 0.55;
/** 起女名最多试几次 */
const NAME_TRIES = 40;
/** 名字少的语感用满了以后:至少和前后这么多年里出生的同名人物错开(同 people.ts) */
const NAME_GAP = 300;

/** 语感分几类(讨论比例用) */
type Group = 'central' | 'xianxia' | 'frontier' | 'mythic' | 'western';
/** 女君怎么挑:sonless 无子传女,eldest 长子女优先 */
const RULE: Record<Group, 'sonless' | 'eldest'> = {
  central: 'sonless',
  frontier: 'sonless',
  xianxia: 'eldest',
  mythic: 'eldest',
  western: 'eldest',
};
/**
 * 能换的人里有几成换成女的:ruler 世袭君主(按上面的规矩能换的那些;能换的约占世袭君主的 1 成半 / 3 成多,
 * 折下来女君约占世袭君主:中原、边塞 1 成,仙侠 3 成,山海、西幻 2 成)、consul 共和国执政官、prince 能换的宗室、general 将领、minister 名臣
 */
const RATES: Record<Group, Record<'ruler' | 'consul' | 'prince' | 'general' | 'minister', number>> = {
  central: { ruler: 0.6, consul: 0.1, prince: 0.285, general: 0.1, minister: 0.05 },
  frontier: { ruler: 0.5, consul: 0.1, prince: 0.285, general: 0.15, minister: 0.1 },
  xianxia: { ruler: 0.9, consul: 0.3, prince: 0.38, general: 0.3, minister: 0.3 },
  mythic: { ruler: 0.66, consul: 0.2, prince: 0.285, general: 0.2, minister: 0.2 },
  western: { ruler: 0.63, consul: 0.2, prince: 0.285, general: 0.15, minister: 0.15 },
};

// ---- 随机数的用途、身份 ----
const U_PICK = 0;
const U_REUSE = 1;
const U_REUSE_PICK = 2;
/** 字用的随机数(courtesyName 的用途加上这个数) */
const U_COURTESY = 16;
/** 身份:宗室(有父亲的,即位没即位都算这一种)、别的君主、将领、名臣(篡位开国的名臣也算名臣) */
const K_ROYAL = 2;
const K: Record<Person['role'], number> = { ruler: 1, prince: K_ROYAL, general: 3, minister: 4, consort: 5 };

const TICK = 256;
const qi = (x: number) => Math.round(x * TICK);

const groupOf = (style: string): Group =>
  style === 'central' || style === 'xianxia' || style === 'frontier' || style === 'mythic' ? style : 'western';

export interface WomenCtx {
  seed: number;
  polities: readonly Polity[];
  /** 国家的位置锚(同 rulers.ts) */
  tag: readonly number[];
  styleOf: (p: Polity) => string;
  namerOf: (p: Polity) => PersonNamer;
  /** 在位表的随机数底数(rulers.ts 的 rulerBase):命里该有的儿子按它算 */
  rbase: number;
  /** 寻常君主 → 他在在位表里的那一项(rulers.ts) */
  reignOf: ReadonlyMap<Person, Reign>;
  /** 君主的诸子(royals.ts):父亲 → 儿子们(即位了的那一个是那位君主) */
  sons: ReadonlyMap<Person, readonly Son[]>;
  /** 篡位的名臣做名臣时的那一份 → 并成的新朝第一位(做名臣时的那一份跟着改,作者按名臣找他时找得到) */
  usurped: ReadonlyMap<Person, Person>;
  /** 重排这一国君主的称号(西幻同名的编序数) */
  retitle: (pid: number) => void;
}

/** 后妃起名用的(consorts.ts):姓(东方带姓的语感;别的 = 空串)、身份(起名的随机数用) */
export interface ConsortName {
  sur: string;
  kind: number;
}

/** 两步共用的:随机数、按出道时的身份算的那几样 */
function prep(ctx: WomenCtx) {
  const { polities, tag } = ctx;
  const base = subSeed(ctx.seed, 'civ-gender');
  /** 人物 → 他做儿子的那一份(royals.ts;即位了的也有) */
  const sonOf = new Map<Person, Son>();
  for (const ss of ctx.sons.values()) for (const s of ss) sonOf.set(s.p, s);
  /** 篡位开国的名臣(按名臣定) */
  const exMinister = new Set(ctx.usurped.values());
  /**
   * 按出道时的身份定:君主的儿女(royals.ts 的诸子)按父亲那一国、算宗室(据地自立的开国之君和做宗室时一样);
   * 篡位开国的名臣算名臣;别的照身份(世系里后来补上的父亲不算:开国之君日后连上一位父亲,还是开国之君)
   */
  const home = (x: Person) => sonOf.get(x)?.father.polity ?? x.polity;
  const kind = (x: Person) => (exMinister.has(x) ? K.minister : sonOf.has(x) ? K_ROYAL : K[x.role]);
  const R = (x: Person, use: number) => keyed4(base, tag[home(x)] ?? 0, qi(x.born), kind(x), use);
  const group = (x: Person) => groupOf(polities[home(x)] ? ctx.styleOf(polities[home(x)]) : 'kingdom');
  /** 君主:一国一国、按即位先后(作者立的君主、作者让他让位的照常在表里,只是不换) */
  const reignsOf = (people: readonly Person[]) => {
    const reigns: Person[][] = polities.map(() => []);
    for (const x of people) if (x.role === 'ruler') reigns[x.polity]?.push(x);
    for (const list of reigns) list.sort((a, b) => a.from! - b.from! || a.id - b.id);
    return reigns;
  };
  return { sonOf, exMinister, home, kind, R, group, reignsOf };
}

/**
 * 这个人是男是女,出道时就定得下来的:君主之子、开国之君和 pickWomen 同一个判法(只看出道时的事);没即位、不是君主之子的宗室
 * 本来就不换(男)。继位的君主要按世系认先君是他父亲还是兄弟、作者立的君主、篡位开国的,这时说不准 = undefined。
 * 临朝的太后先按它定(consorts.ts):定了是女的父亲不安排太后,不会日后回头把她改成男的
 */
export function debutSex(x: Person, ctx: WomenCtx): 'male' | 'female' | undefined {
  if (x.female) return 'female';
  if (x.author !== undefined || x.rise === 'usurp') return undefined;
  if (x.rise === 'crown') return 'male';
  let son = false;
  for (const ss of ctx.sons.values()) for (const s of ss) if (s.p === x) son = true;
  if (!son && x.role === 'prince') return 'male';
  if (!son && x.rise === 'heir') return undefined;
  return pickWomen([x], ctx).has(x) ? 'female' : 'male';
}

/**
 * 谁是女的(只定、不改):people = 排好编号、连好父亲的人物(下标 = Person.id);keepMale = 照旧是男的
 * (临朝的太后的丈夫里出道时说不准的那几位,people.ts 给)
 */
export function pickWomen(people: readonly Person[], ctx: WomenCtx, keepMale: ReadonlySet<Person> = new Set()): Set<Person> {
  const { polities, tag } = ctx;
  const women = new Set<Person>();
  if (!people.length) return women;
  const { sonOf, exMinister, kind, R, group, reignsOf } = prep(ctx);
  /** 一位寻常君主命里该有的儿子的生年;寿数(预定的继承人不知道,当一直在世) */
  const broodYears = (r: Reign | undefined, pid: number): { born: Year; life: Year }[] => {
    if (!r || r.crown || !polities[pid]) return [];
    const b = broodOf(ctx.rbase, tag[pid] ?? 0, r, polities[pid]);
    return [...(b.heir !== undefined ? [{ born: b.heir, life: Infinity }] : []), ...b.extra.map((e) => ({ born: e.born, life: e.life }))];
  };
  const same = (a: Year, b: Year) => Math.abs(a - b) < 1e-6;
  /**
   * 她命里的孩子都生在她 FERTILE 岁之间、她原定下台(寿终于位)以前(r = 她在在位表里的那一项):命里的儿子(broodOf),
   * 加上原定接她位的那一位 —— 年纪差得多的,世系里连成她的孩子或隔一代(中间补一位早卒的,lineage.ts 的说法)
   */
  const kidsFit = (x: Person, r: Reign | undefined): boolean => {
    const P = polities[x.polity];
    if (!r || r.crown || !P) return true;
    const ok = (b: Year) => b - x.born >= FERTILE[0] && b - x.born <= FERTILE[1] && b <= r.natural;
    if (!broodYears(r, x.polity).every((c) => ok(c.born))) return false;
    const hb = r.natural - reignStep(ctx.rbase, tag[P.id] ?? 0, r.k + 1, r.j + 1, r.natural, segLineage(P, r.dynasty), P.kind).age;
    if (hb - x.born < BRIDGE_GAP) return true;
    const lo = Math.max(x.born + GEN_AGE[0], hb - GEN_AGE[1]);
    const hi = Math.min(r.natural + POSTHUMOUS, hb - GEN_AGE[0]);
    return ok(lo <= hi ? (lo + hi) / 2 : hb);
  };

  /**
   * 君主(和预定的继承人)按规矩能不能是女的:t = 即位那一刻(预定的继承人按预定即位的那一刻),
   * F = 先君(pr = 他在在位表里的那一项),own = 她自己的那一项,child / sib = 她是先君的孩子 / 手足
   */
  const fits = (x: Person, rule: 'sonless' | 'eldest', t: Year, F: Person | undefined, own: Reign | undefined, how: 'child' | 'sib' | 'founder'): boolean => {
    if (!kidsFit(x, own)) return false;
    if (how === 'founder') return rule === 'eldest';
    const pr = F && F.author === undefined ? ctx.reignOf.get(F) : undefined;
    if (!F || !pr) return false;
    const alive = broodYears(pr, F.polity).filter((c) => c.born <= t && c.life > t);
    if (how === 'sib') return !alive.length;
    const others = alive.filter((c) => !same(c.born, x.born));
    return rule === 'sonless' ? !others.length : others.every((c) => c.born > x.born);
  };

  const reigns = reignsOf(people);
  /**
   * 预定的继承人照原定(父亲到期下台、他接着即位)在在位表里的那一项:不看后来真的怎样(父亲先没了、改朝换代),
   * 即位以前、以后,推到哪一年都一样
   */
  const heirReign = (s: Son): Reign | undefined => {
    const r = ctx.reignOf.get(s.father);
    const P = polities[s.father.polity];
    if (!r || !P) return undefined;
    const st = reignStep(ctx.rbase, tag[P.id] ?? 0, r.k + 1, r.j + 1, r.natural, segLineage(P, r.dynasty), P.kind);
    const next: Reign = { k: r.k + 1, dynasty: r.dynasty, j: r.j + 1, from: r.natural, age: st.age, natural: st.natural, leanings: st.leanings, eff: leaningEffect(st.leanings) };
    return same(reignBorn(next), s.p.born) ? next : undefined;
  };
  for (const x of people) {
    if (x.author !== undefined || x.rise === 'crown' || x.role === 'consort' || keepMale.has(x)) continue;
    const g = group(x);
    const u = R(x, U_PICK);
    const rule = RULE[g];
    if (x.role === 'general' || x.role === 'minister' || exMinister.has(x)) {
      if (u < RATES[g][x.role === 'ruler' ? 'minister' : x.role]) women.add(x);
      continue;
    }
    const P = polities[x.polity];
    if (x.role === 'ruler' && P && !royalSeg(P, x.dynasty ?? 0)) {
      if (u < RATES[g].consul) women.add(x);
      continue;
    }
    const son = sonOf.get(x);
    let ok = false;
    let rate = RATES[g].ruler;
    if (son) {
      // 君主的儿女(即位没即位都照出道时的定法,后来争储得位、据地自立、摄政篡位的也一样)
      if (son.heirAt !== undefined) {
        // 预定的继承人:照君主的规矩,按预定即位的那一刻
        ok = fits(x, rule, son.heirAt, son.father, heirReign(son), 'child');
      } else {
        ok = true;
        rate = RATES[g].prince;
      }
    } else if (x.role === 'prince') ok = false;
    else if (x.rise !== 'heir') ok = fits(x, rule, x.from!, undefined, ctx.reignOf.get(x), 'founder');
    else {
      const list = reigns[x.polity];
      const prev = list[list.indexOf(x) - 1];
      if (prev && (prev.dynasty ?? 0) === (x.dynasty ?? 0) && x.parent !== undefined) {
        if (x.parent === prev.id) ok = fits(x, rule, x.from!, prev, ctx.reignOf.get(x), 'child');
        else if (prev.parent !== undefined && x.parent === prev.parent) ok = fits(x, rule, x.from!, prev, ctx.reignOf.get(x), 'sib');
      }
    }
    if (ok && u < rate) women.add(x);
  }
  return women;
}

/**
 * 换成女的、起女名:people = 排好编号、连好父亲的全部人物(下标 = Person.id;就地改),women = pickWomen 挑的再加上
 * 临朝篡位的太后(新朝第一位);consorts = 后妃(都是女的,名字还空着)的姓和身份
 */
export function nameWomen(people: Person[], ctx: WomenCtx, women: ReadonlySet<Person>, consorts: ReadonlyMap<Person, ConsortName> = new Map()): void {
  const { polities, tag } = ctx;
  if (!people.length || (!women.size && !consorts.size)) return;
  const { sonOf, exMinister, home, kind, R, reignsOf } = prep(ctx);
  const reigns = reignsOf(people);

  // ---- 起女名:按出道先后(编号),不和此前出道的人重名 ----
  /** 名字 → 用过的人的生年;国家 → 本国用过的名字 */
  const used = new Map<string, Year[]>();
  const mine: Set<string>[] = polities.map(() => new Set());
  const use = (x: Person) => {
    const ys = used.get(x.name);
    if (ys) ys.push(x.born);
    else used.set(x.name, [x.born]);
    mine[home(x)]?.add(x.name);
  };
  /** 西幻:国家:第几朝 → 这一朝女王(和预定即位的公主)用过的名字 */
  const queens = new Map<string, string[]>();
  const retitle = new Set<number>();
  for (const x of people) {
    const cn = consorts.get(x);
    if (!women.has(x) && !cn) {
      use(x);
      continue;
    }
    const pid = home(x);
    const P = polities[pid];
    const namer = ctx.namerOf(P);
    const sur = cn ? cn.sur : namer.surnamed ? splitSurname(x.name) : '';
    const at = (a: number) => sur + namer.femaleGiven(tag[pid] ?? 0, cn ? cn.kind : kind(x), qi(x.born), a);
    let name = '';
    const son = sonOf.get(x);
    // 西幻世袭的君主、预定即位的公主:有机会沿用本朝女王的名字(上一位的除外)。按出道时的身份定(别的公主后来争位、自立当了女王也不改名)
    const queen = !cn && namer.family === 'western' && royalSeg(P, x.dynasty ?? 0) && !exMinister.has(x) && (son ? son.heirAt !== undefined : x.role === 'ruler');
    const qk = `${pid}:${x.dynasty ?? 0}`;
    if (queen) {
      const list = reigns[x.polity];
      const prev = son ? son.father : list[list.indexOf(x) - 1];
      const pool = (queens.get(qk) ?? []).filter((n) => n !== prev?.name);
      if (pool.length && R(x, U_REUSE) < REUSE) name = pool[Math.floor(R(x, U_REUSE_PICK) * pool.length)];
    }
    if (!name) {
      const near = (n: string) => mine[pid].has(n) || !!used.get(n)?.some((y) => Math.abs(y - x.born) < NAME_GAP);
      const cands: string[] = [];
      const cand = (a: number) => (cands[a] ??= at(a));
      for (let a = 0; a < NAME_TRIES && !name; a++) if (!used.has(cand(a)) && !mine[pid].has(cand(a))) name = cand(a);
      for (let a = 0; a < NAME_TRIES && !name; a++) if (!near(cand(a))) name = cand(a);
      name ||= cand(0);
    }
    if (queen) {
      const q = queens.get(qk);
      if (!q) queens.set(qk, [name]);
      else if (!q.includes(name)) q.push(name);
    }
    // 西幻改了名的君主(篡位开国的名臣也算):这一国同名的另编序数
    if (x.role === 'ruler' && namer.family === 'western') retitle.add(x.polity);
    // 后妃本来没有名字(不记男名);临朝篡位的太后记下新朝第一位原来的男名(头像按它往下传)
    if (x.name) x.maleName = x.name;
    x.name = name;
    x.female = true;
    use(x);
    // 字照女名另起
    if (x.courtesy) x.courtesy = courtesyName(ctx.styleOf(P), name, (u) => R(x, U_COURTESY + u), true);
  }
  for (const [S, F] of ctx.usurped) {
    if (!F.female) continue;
    S.female = true;
    S.maleName = F.maleName;
    S.name = F.name;
    if (F.courtesy) S.courtesy = F.courtesy;
  }
  for (const pid of retitle) ctx.retitle(pid);
}
