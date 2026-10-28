/**
 * 推演里的女性:人物都按男的排完、起好名字以后(people.ts 的最后一步),按语感的规矩和比例把一部分人换成女的、另起女名。
 * 只换性别和名字(连带字、号,西幻同名女王的序数):谁在位、在位多久、领哪几仗、生卒、父子关系一样都不改 ——
 * 推演里本来就没有"继承顺序",父子兄弟是事后按年纪认的(lineage.ts),所以把某一位说成女儿、妹妹,历史一点不受影响。
 *
 * 谁能是女的:
 * - 世袭的君主,按语感分两种规矩(RULE):
 *   - 无子传女(中原、边塞):继位的是先君的孩子、先君那时没有别的在世的孩子;或是先君的手足、先君那时没有在世的孩子(兄终妹及)。
 *     开国之君(立国、自立、复国、篡位、起兵代之)不换
 *   - 长子女优先(仙侠、山海、西幻):继位的是先君在世的孩子里最年长的;或是先君的手足、先君那时没有在世的孩子。开国之君也可以
 *   两种都要:她没有娶过宗室女(不是联姻里的新郎),亲生的孩子都生在她 FERTILE 岁之间、她在世的时候。孙辈接位、远支、作者立的君主都不换
 * - 共和国的执政官:都可以
 * - 没即位的宗室:下面没有后人、没娶过亲、没掌过实权的(世系链上的照旧是男的);无子传女的语感里预定的继承人(太子)不换
 * - 将领、名臣:都可以
 * 能换的人里按语感抽(RATES,每个世界约 2 成君主、3 成能换的宗室、1 成多的将领名臣是女的)。
 * 随机数 keyed4(subSeed(seed, 'civ-gender'), 国家的位置锚, 生年, 出道那一刻, 身份):只看这个人自己,和别人换没换无关。
 *
 * 名字:女名表在 names/persons.ts(femaleGiven);东方带姓的语感保留原来的姓(王朝的姓、将领名臣自己的姓)。
 * 原来的男名记在 Person.maleName(不显示;头像的长相按它一代代往下传,她的后人长相不变)。
 * 按出道先后起,不和此前出道的人重名(名字少的语感至少和本国的人、前后 NAME_GAP 年里出生的同名人物错开);
 * 西幻同一朝的女王有 REUSE 的机会沿用本朝女王用过的名字(序数照男王的规矩编,男女分开数)。
 * 将领、名臣的字照女名另起(officials.ts 的 courtesyName),号的后半"先生""老人"换成"居士"(撞了别人的号就照旧)。
 * 纯计算,不碰 DOM。
 */
import type { PersonNamer } from '../names';
import { keyed4, subSeed } from './rand';
import { courtesyName } from './officials';
import { splitSurname } from './peopleText';
import type { Person, Polity, Year } from './types';

// ---- 调参 ----
/** 女君亲生的孩子要生在她这个岁数之间 */
const FERTILE: [number, number] = [16, 45];
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
 * 能换的人里有几成换成女的:ruler 世袭君主(按上面的规矩能换的那些;能换的约占世袭君主的 2 成 / 4 成,
 * 折下来女君约占世袭君主:中原、边塞 1 成,仙侠 3 成,山海、西幻 2 成)、consul 共和国执政官、prince 能换的宗室、general 将领、minister 名臣
 */
const RATES: Record<Group, Record<'ruler' | 'consul' | 'prince' | 'general' | 'minister', number>> = {
  central: { ruler: 0.5, consul: 0.1, prince: 0.3, general: 0.1, minister: 0.05 },
  frontier: { ruler: 0.5, consul: 0.1, prince: 0.3, general: 0.15, minister: 0.1 },
  xianxia: { ruler: 0.73, consul: 0.3, prince: 0.4, general: 0.3, minister: 0.3 },
  mythic: { ruler: 0.49, consul: 0.2, prince: 0.3, general: 0.2, minister: 0.2 },
  western: { ruler: 0.48, consul: 0.2, prince: 0.3, general: 0.15, minister: 0.15 },
};

// ---- 随机数的用途、身份 ----
const U_PICK = 0;
const U_REUSE = 1;
const U_REUSE_PICK = 2;
/** 字用的随机数(courtesyName 的用途加上这个数) */
const U_COURTESY = 16;
const K: Record<Person['role'], number> = { ruler: 1, prince: 2, general: 3, minister: 4 };

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
  /** 预定的继承人、没即位就没了的宗室(royals.ts 的 heirAt) */
  heirs: ReadonlySet<Person>;
  /** 篡位的名臣做名臣时的那一份 → 并成的新朝第一位(做名臣时的那一份跟着改,作者按名臣找他时找得到) */
  usurped: ReadonlyMap<Person, Person>;
  /** 重排这一国君主的称号(西幻同名的编序数) */
  retitle: (pid: number) => void;
}

/** people = 排好编号、连好父亲的全部人物(下标 = Person.id);就地改 */
export function assignWomen(people: Person[], ctx: WomenCtx): void {
  const { polities, tag } = ctx;
  if (!people.length) return;
  const base = subSeed(ctx.seed, 'civ-gender');
  const kids = new Map<number, Person[]>();
  for (const x of people) {
    if (x.parent === undefined) continue;
    const l = kids.get(x.parent);
    if (l) l.push(x);
    else kids.set(x.parent, [x]);
  }
  const kidsOf = (x: Person) => kids.get(x.id) ?? [];
  const alive = (x: Person, t: Year) => x.born <= t && (x.died === undefined || x.died > t);
  const group = (x: Person) => groupOf(polities[x.polity] ? ctx.styleOf(polities[x.polity]) : 'kingdom');
  /** 这个人身份对应的随机数(出道那一刻:君主即位、名臣入仕、将领第一次领兵、宗室按父亲的生年) */
  const R = (x: Person, use: number) => {
    const start = x.role === 'general' ? (x.commands?.[0]?.from ?? x.born) : x.role === 'prince' ? (x.parent !== undefined ? (people[x.parent]?.born ?? 0) : 0) : (x.from ?? x.born);
    return keyed4(base, tag[x.polity] ?? 0, qi(x.born), (qi(start) ^ Math.imul(use, 0x9e3779b1)) | 0, K[x.role]);
  };

  // ---- 谁换成女的 ----
  /** 君主 x(上一位 prev)按规矩能不能是女的 */
  const rulerFits = (x: Person, prev: Person | undefined, rule: 'sonless' | 'eldest'): boolean => {
    if (x.spouses?.length) return false;
    for (const c of kidsOf(x)) {
      if (c.adopted) continue;
      const age = c.born - x.born;
      if (age < FERTILE[0] || age > FERTILE[1] || (x.died !== undefined && c.born > x.died)) return false;
    }
    // 开国之君(这一朝的第一位)
    if (x.rise !== 'heir') return rule === 'eldest';
    if (!prev || prev.author !== undefined || (prev.dynasty ?? 0) !== (x.dynasty ?? 0) || x.parent === undefined) return false;
    const t = x.from!;
    const others = kidsOf(prev).filter((c) => c !== x && alive(c, t));
    // 先君的孩子:无子传女 = 先君没有别的在世的孩子;长子女优先 = 在世的孩子里她最年长
    if (x.parent === prev.id) return rule === 'sonless' ? !others.length : others.every((c) => c.born >= x.born);
    // 先君的手足:先君那时没有在世的孩子
    if (prev.parent !== undefined && x.parent === prev.parent) return !others.length;
    return false;
  };
  const women = new Set<Person>();
  // 君主:一国一国、按即位先后(作者立的君主、作者让他让位的照常在表里,只是不换)
  const reigns: Person[][] = polities.map(() => []);
  for (const x of people) if (x.role === 'ruler') reigns[x.polity]?.push(x);
  for (const list of reigns) list.sort((a, b) => a.from! - b.from! || a.id - b.id);
  for (const p of polities) {
    const list = reigns[p.id];
    if (!list.length) continue;
    const g = groupOf(ctx.styleOf(p));
    if (p.lineage === 'republic') {
      for (const x of list) if (x.author === undefined && R(x, U_PICK) < RATES[g].consul) women.add(x);
      continue;
    }
    for (let k = 0; k < list.length; k++) {
      const x = list[k];
      if (x.author !== undefined || x.rise === 'crown') continue;
      if (!rulerFits(x, list[k - 1], RULE[g])) continue;
      if (R(x, U_PICK) < RATES[g].ruler) women.add(x);
    }
  }
  for (const x of people) {
    if (x.author !== undefined) continue;
    const g = group(x);
    if (x.role === 'prince') {
      if (kidsOf(x).length || x.spouses?.length || x.regencies?.length) continue;
      if (RULE[g] === 'sonless' && ctx.heirs.has(x)) continue;
      if (R(x, U_PICK) < RATES[g].prince) women.add(x);
    } else if (x.role === 'general' || x.role === 'minister') {
      if (R(x, U_PICK) < RATES[g][x.role]) women.add(x);
    }
  }
  if (!women.size) return;

  // ---- 起女名:按出道先后(编号),不和此前出道的人重名 ----
  /** 名字 → 用过的人的生年;国家 → 本国用过的名字 */
  const used = new Map<string, Year[]>();
  const mine: Set<string>[] = polities.map(() => new Set());
  const use = (x: Person) => {
    const ys = used.get(x.name);
    if (ys) ys.push(x.born);
    else used.set(x.name, [x.born]);
    mine[x.polity]?.add(x.name);
  };
  /** 西幻:国家 → 第几朝 → 这一朝女王用过的名字 */
  const queens = new Map<string, string[]>();
  const retitle = new Set<number>();
  // 号:同一座城、同一个后半的不出第二位
  const arts = new Set<string>();
  for (const x of people) if (x.art && x.home !== undefined) arts.add(`${x.home}|${x.art}`);
  for (const x of people) {
    if (!women.has(x)) {
      use(x);
      continue;
    }
    const P = polities[x.polity];
    const namer = ctx.namerOf(P);
    const sur = namer.surnamed ? splitSurname(x.name) : '';
    const at = (a: number) => sur + namer.femaleGiven(tag[x.polity] ?? 0, K[x.role], qi(x.born), a);
    let name = '';
    const western = namer.family === 'western';
    const realm = x.role === 'ruler' && P.lineage !== 'republic';
    const qk = `${x.polity}:${x.dynasty ?? 0}`;
    if (western && realm) {
      // 沿用本朝女王的名字(上一位的除外)
      const prev = reigns[x.polity][reigns[x.polity].indexOf(x) - 1];
      const pool = (queens.get(qk) ?? []).filter((n) => n !== prev?.name);
      if (pool.length && R(x, U_REUSE) < REUSE) name = pool[Math.floor(R(x, U_REUSE_PICK) * pool.length)];
    }
    if (!name) {
      const near = (n: string) => mine[x.polity].has(n) || !!used.get(n)?.some((y) => Math.abs(y - x.born) < NAME_GAP);
      const cands: string[] = [];
      const cand = (a: number) => (cands[a] ??= at(a));
      for (let a = 0; a < NAME_TRIES && !name; a++) if (!used.has(cand(a)) && !mine[x.polity].has(cand(a))) name = cand(a);
      for (let a = 0; a < NAME_TRIES && !name; a++) if (!near(cand(a))) name = cand(a);
      name ||= cand(0);
    }
    if (western && realm) {
      const q = queens.get(qk);
      if (!q) queens.set(qk, [name]);
      else if (!q.includes(name)) q.push(name);
      retitle.add(x.polity);
    }
    x.maleName = x.name;
    x.name = name;
    x.female = true;
    use(x);
    // 字照女名另起;号的后半"先生""老人"换成"居士"
    if (x.courtesy) x.courtesy = courtesyName(ctx.styleOf(P), name, (u) => R(x, U_COURTESY + u), true);
    if ((x.art === '先生' || x.art === '老人') && x.home !== undefined && !arts.has(`${x.home}|居士`)) {
      arts.add(`${x.home}|居士`);
      x.art = '居士';
    }
  }
  for (const [S, F] of ctx.usurped) {
    if (!F.female) continue;
    S.female = true;
    S.maleName = F.maleName;
    S.name = F.name;
    if (F.courtesy) S.courtesy = F.courtesy;
    if (F.art) S.art = F.art;
  }
  for (const pid of retitle) ctx.retitle(pid);
}
