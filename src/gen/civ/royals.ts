/**
 * 君主的诸子、养子,和老君主去世时的争储。people.ts 排完君主以后、排统帅以前调 buildSons,排统帅时让成年的儿子领兵,
 * 每位继位的君主即位那一刻调 contest 定"争没争、怎么争的";名字、编号、父亲(Person.parent)在 lineage.ts、people.ts 里补。
 *
 * **诸子**(每位寻常君主;共和国执政官、作者立的君主没有):
 *   - 在位表里排在他后面的那一位(rulers.ts 的 reignStep:第 k + 1 位从他不被打断时下台的那一刻即位)年纪合得上他的儿子
 *     (差 14 到 40 岁,和 lineage.ts 认"其子"的说法一样)就是预定的继承人:真的接着即位的,这个儿子就是那位君主本人(同一个 Person);
 *     没接上(改朝换代、作者立了别人、作者让父亲提早去世)的照样是他的儿子,只是没即位
 *   - 另外几个儿子(亲生的 0–5 个,按位置锚 + 第几位随机),父亲 SON_AGE 岁之间生,兄弟至少差 SON_GAP 年;
 *     父亲去世以后(遗腹子除外)、推到的最后一年以后出生的不算
 *   - 一个亲生儿子也没有的,有 ADOPT 的机会收一个养子(Person.adopted)
 *   - 出道 = 父亲即位、出生、被收养里最晚的那一刻(只往前看:之后的历史怎么变,这一刻以前有的儿子不变)
 * **领兵**(people.ts):在位君主成年、在世、闲着的儿子(还有先君的儿子,即君主的兄弟)替他出征,儿子越多越常领兵(诸子各领一军);
 *   预定的继承人在预定即位以前不战死,别的和将领一样会战死。
 * **争储**(contest):先君的儿子里还有成年、在世的,新君即位那一刻按"谁年长、谁战功多(领兵打赢的仗减打输的)"看争没争:
 *   - 新君是先君的儿子:他最年长、战功也不比谁少 = 不争;兄长还在、他的战功比兄长都多 = 以战功越过兄长得立(merit);
 *     不然有机会争起来:新君领过兵的举兵入宫,杀了兄长、战功比他多的兄弟(coup);没领过兵的,最大的对手领过兵就拥兵争位、
 *     兵败被杀(revolt),也没领过兵就被新君谮杀(intrigue);新君未满 RIVAL_AGE 岁的只有领过兵的兄长拥兵争位一种
 *   - 新君不是先君的儿子(兄弟、叔侄继位),先君的儿子还在:有机会杀了先君的长子自立(usurp)
 *   被杀的宗室卒于那一刻,结局 purged。疆域、兴亡、战争胜负、君主的在位年份一样都不改。
 *   先君晚年预定的继承人引兵入朝的(regents.ts;march):那一刻就杀兄长和战功比他多的兄弟(和举兵夺位同一种杀法),即位时不另争储。
 *   日后要摄政的叔父、要结亲的宗室(推演里还要用到他)不卷进争储(contest 的 spare)。
 * 随机数一律 keyed4(subSeed(seed, 'civ-people'), 国家的位置锚, 第几位君主 × 16 + 第几个儿子, 用途, K_SON)。纯计算,不碰 DOM。
 */
import type { Person, Polity, Year } from './types';
import { keyed4 } from './engine/rand';
import { K_RULER, reignBorn, reignStep, type Reign } from './rulers';
import { royalSeg, segLineage } from './regime';

// ---- 调参 ----
/** 亲生儿子 0、1、2……个的机会 */
const SONS: readonly number[] = [0.15, 0.25, 0.25, 0.17, 0.11, 0.07];
/** 父亲生儿子的年纪 */
const SON_AGE: [number, number] = [17, 50];
/** 兄弟出生至少差几年 */
const SON_GAP = 1;
/** 一生多少岁(不战死、不在争储里被杀) */
const SON_LIFE: [number, number] = [24, 78];
/** 预定的继承人没接上君位的:预定即位那年以后至少再活这么多年 */
const HEIR_AFTER = 1;
/** 遗腹子:父亲去世以后最多这么久出生(同 lineage.ts) */
export const POSTHUMOUS = 0.75;
/** 一个亲生儿子也没有的君主收养子的机会;收养时养子几岁、父亲比养子大多少岁 */
const ADOPT = 0.6;
const ADOPT_AT: [number, number] = [4, 16];
const ADOPT_GAP: [number, number] = [18, 45];
/** 领兵的年纪 */
export const PRINCE_AGE: [number, number] = [16, 60];
/** 每个能领兵的儿子替父出征的机会(n 个儿子:1 - (1 - PRINCE_LEAD)^n) */
export const PRINCE_LEAD = 0.5;
/** 几个儿子里派谁:预定即位以前的继承人(太子)算这么多份,别的一份 */
export const HEIR_WEIGHT = 3;
/** 争储里算"成年"的岁数 */
const RIVAL_AGE = 16;
/** 以战功越过兄长:战功至少这么多 */
const MERIT_MIN = 1;
/** 争起来的机会:有兄长在 / 自己最年长但有兄弟战功更多 / 不是先君的儿子 */
const CONTEST_ELDER = 0.3;
const CONTEST_MERIT = 0.25;
const CONTEST_USURP = 0.15;
/** 举兵夺位时每个对手被杀的机会(至少杀一个) */
const COUP_KILL = 0.7;
/** 在位时遇弑的机会(people.ts;遇弑的先君由名臣迎立新君,不争储,推演里也不起兵争位) */
const MURDER = 0.07;
/** 推演里据地争位(unrest.ts)的宗室多少岁之间 */
const CLAIM_AGE: [number, number] = [20, 60];

// 随机数用途
const U_COUNT = 1;
const U_BORN = 2;
const U_LIFE = 3;
const U_ADOPT = 4;
const U_CONTEST = 5;
const U_KILL = 6;
const U_MARCH = 7;
/** keyed4 最后一位(0 君主、1 将领在 people.ts) */
const K_SON = 3;
/** 君主的随机数里遇弑那一项(K_RULER;别的用途见 rulers.ts、people.ts) */
const U_MURDER = 3;

const TICK = 256;
const q = (x: number) => Math.round(x * TICK) / TICK;
const lerp = (r: [number, number], u: number) => r[0] + (r[1] - r[0]) * u;

/** 一个儿子 */
export interface Son {
  /** 没即位的 role = 'prince'(名字由 lineage.ts 起;预定的继承人的名字这里就有);预定的继承人真的即位了 = 那位君主 */
  p: Person;
  father: Person;
  /** 预定的继承人:预定即位的那一刻(那以前领兵不战死);别的儿子不给 */
  heirAt?: Year;
  adopted: boolean;
  /** 收进人物列表的那一刻 */
  debut: Year;
  /** 活到哪年(战死、争储被杀以后改成那一刻;到结束年份还在世 = Infinity) */
  end: Year;
}

/** 第 k 位君主在位时遇弑(people.ts 写成 fate murdered) */
export function murderedAt(base: number, tag: number, k: number): boolean {
  return keyed4(base, tag, k, U_MURDER, K_RULER) < MURDER;
}

/** 一位君主命里该有的亲生儿子(和推到哪一年、他哪年去世无关;用的时候再去掉还没出生、他去世以后才生的) */
export interface Brood {
  /** 预定的继承人(在位表里的下一位,年纪合得上):生年 */
  heir?: Year;
  /** 另外几个:第几个(随机数编号 s)、生年、寿数到哪年 */
  extra: { s: number; born: Year; life: Year }[];
}

/** r = 这位君主在在位表里的那一项(寻常君主);p = 他的国家 */
export function broodOf(base: number, tag: number, r: Reign, p: Pick<Polity, 'lineage' | 'kind' | 'dynasties'>): Brood {
  const U = (s: number, use: number) => keyed4(base, tag, r.k * 16 + s, use, K_SON);
  const fb = reignBorn(r);
  // 预定的继承人:在位表里的下一位(他不被打断时下台的那一刻即位),年纪合得上他的儿子
  const next = reignStep(base, tag, r.k + 1, r.j + 1, r.natural, segLineage(p, r.dynasty), p.kind);
  const hb = q(r.natural - next.age);
  const gap = hb - fb;
  const heir = gap >= 14 && gap < 40;
  const births: number[] = heir ? [hb] : [];
  // 另外几个亲生儿子
  let n = 0;
  for (let u = U(0, U_COUNT), acc = 0; n < SONS.length - 1 && u >= (acc += SONS[n]); n++);
  const want = Math.max(0, n - births.length);
  const lo = fb + SON_AGE[0];
  const hi = fb + SON_AGE[1];
  const extra: Brood['extra'] = [];
  for (let s = 1; s <= want; s++) {
    let b = q(lerp([lo, hi], U(s, U_BORN)));
    // 和别的兄弟错开(往后挪)
    for (let t = 0; t < 8 && births.some((o) => Math.abs(o - b) < SON_GAP); t++) b = q(b + SON_GAP);
    if (births.some((o) => Math.abs(o - b) < SON_GAP)) continue;
    births.push(b);
    extra.push({ s, born: b, life: sonLife(base, tag, r.k, s, b) });
  }
  return heir ? { heir: hb, extra } : { extra };
}

/** 第 k 位君主的第 s 个儿子(生于 born)寿数到哪年 */
function sonLife(base: number, tag: number, k: number, s: number, born: Year): Year {
  return q(born + lerp(SON_LIFE, Math.pow(keyed4(base, tag, k * 16 + s, U_LIFE, K_SON), 0.7)));
}

/**
 * 推演里的据地争位(unrest.ts):先君 r 在 t 那一刻寿终、在位表里的下一位即位,先君的儿子里 CLAIM_AGE 岁之间、
 * 还在世的(不算预定的继承人)按长幼排。没有 = 空。人物里起兵的就是其中最年长的那位(people.ts 按生年认)
 */
export function claimants(base: number, tag: number, r: Reign, p: Pick<Polity, 'lineage' | 'kind'>, t: Year): Year[] {
  return broodOf(base, tag, r, p)
    .extra.filter((x) => x.born + CLAIM_AGE[0] <= t && x.born + CLAIM_AGE[1] >= t && x.life > t)
    .map((x) => x.born)
    .sort((a, b) => a - b);
}

/**
 * 每位君主的儿子(按出生先后)。rulers[国家] = 这国的君主(即位先后);reignOf = 每位寻常君主在在位表里的那一项。
 * 没即位的儿子 p.died / fate 先按寿数填,战死、争储被杀时 people.ts 再改
 */
export function buildSons(
  polities: readonly Polity[],
  rulers: readonly Person[][],
  reignOf: ReadonlyMap<Person, Reign>,
  /** heirName = 预定的继承人的名字(people.ts 照他接着即位时的起名方法先起好) */
  opts: { base: number; tag: readonly number[]; endYear: Year; heirName: (ruler: Person) => string },
): Map<Person, Son[]> {
  const out = new Map<Person, Son[]>();
  const { base, tag, endYear } = opts;
  for (const p of polities) {
    if (p.lineage === 'republic') continue;
    const list = rulers[p.id];
    list.forEach((R, idx) => {
      const r = reignOf.get(R);
      if (!r || R.author !== undefined || !royalSeg(p, r.dynasty)) return;
      const U = (s: number, use: number) => keyed4(base, tag[p.id], r.k * 16 + s, use, K_SON);
      const fatherEnd = (R.died ?? Infinity) + POSTHUMOUS;
      const sons: Son[] = [];
      const prince = (born: Year, life: Year): Person => {
        const x: Person = { id: -1, role: 'prince', polity: p.id, name: '', born, dynasty: R.dynasty ?? 0 };
        if (life <= endYear) {
          x.died = life;
          x.fate = 'died';
        }
        return x;
      };
      const lifeOf = (s: number, born: Year) => sonLife(base, tag[p.id], r.k, s, born);
      // 先排出所有该有的儿子的生年(和推到哪一年、父亲哪年去世无关),再去掉还没出生、父亲去世以后才生的:往后推不改早先有的儿子
      const { heir: hb, extra } = broodOf(base, tag[p.id], r, p);
      const born = (b: Year) => b <= fatherEnd && b <= endYear;
      if (hb !== undefined && born(hb)) {
        const X = list[idx + 1];
        const same = X && X.rise === 'heir' && X.author === undefined && (X.dynasty ?? 0) === (R.dynasty ?? 0) && X.born === hb && X.from === r.natural;
        const life = Math.max(lifeOf(0, hb), r.natural + HEIR_AFTER);
        const H = same ? X : prince(hb, life);
        if (!same) H.name = opts.heirName(R);
        sons.push({ p: H, father: R, heirAt: r.natural, adopted: false, debut: Math.max(R.from!, hb), end: same ? (X.died ?? Infinity) : life <= endYear ? life : Infinity });
      }
      for (const { s, born: b, life } of extra) {
        if (!born(b)) continue;
        sons.push({ p: prince(b, life), father: R, adopted: false, debut: Math.max(R.from!, b), end: life <= endYear ? life : Infinity });
      }
      // 命里一个亲生儿子也没有:收一个养子
      if (hb === undefined && !extra.length && U(8, U_ADOPT) < ADOPT) {
        const b = q(R.born + lerp(ADOPT_GAP, U(8, U_BORN)));
        const at = Math.max(R.from!, q(b + lerp(ADOPT_AT, U(8, U_ADOPT + 8))));
        const life = Math.max(lifeOf(8, b), at + 1);
        if (at < (R.died ?? Infinity) && at <= endYear) {
          const x = prince(b, life);
          x.adopted = true;
          sons.push({ p: x, father: R, adopted: true, debut: at, end: life <= endYear ? life : Infinity });
        }
      }
      if (!sons.length) return;
      sons.sort((a, b) => a.p.born - b.p.born);
      out.set(R, sons);
    });
  }
  return out;
}

/** 一个儿子领兵的战功:领兵时打赢的仗减打输的(people.ts 边排边记) */
export type MeritOf = (p: Person) => number;

export interface ContestResult {
  how: NonNullable<Person['claim']>['how'];
  /** 越过的兄长(merit)/ 杀掉的对手 */
  rivals: Son[];
  /** 要杀的(merit 的为空) */
  killed: Son[];
}

/**
 * 新君 X 在 T 那一刻继先君 R 之位:争没争、怎么争的(见文件头)。sons = R 的儿子;k = X 在在位表里第几位(随机数用);
 * merit = 到这一刻为止的战功;armed = 领没领过兵。不争 = null
 */
export function contest(
  X: Person,
  R: Person,
  T: Year,
  sons: readonly Son[],
  k: number,
  opts: { base: number; tag: number; merit: MeritOf; armed: (p: Person) => boolean; spare?: (p: Person) => boolean },
): ContestResult | null {
  const U = (s: number, use: number) => keyed4(opts.base, opts.tag, k * 16 + s, use, K_SON);
  // 日后要摄政的叔父、要结亲的宗室(推演里还要用到他,regents.ts、marriages.ts)不卷进来
  const alive = sons.filter((s) => s.p !== X && s.p.role === 'prince' && s.p.born + RIVAL_AGE <= T && s.end > T && !opts.spare?.(s.p));
  if (!alive.length) return null;
  const gap = X.born - R.born;
  const isSon = sons.some((s) => s.p === X) || (gap >= 14 && gap < 40 && X.born <= (R.died ?? Infinity) + POSTHUMOUS);
  if (!isSon) {
    // 兄弟、叔侄继位(成年了的),先君的儿子还在:杀了先君的长子自立
    if (T - X.born < RIVAL_AGE || U(0, U_CONTEST) >= CONTEST_USURP) return null;
    const eldest = alive[0];
    return { how: 'usurp', rivals: [eldest], killed: [eldest] };
  }
  const mx = opts.merit(X);
  const elders = alive.filter((s) => s.p.born < X.born);
  const best = Math.max(...alive.map((s) => opts.merit(s.p)));
  if (!elders.length && mx >= best) return null;
  const grown = T - X.born >= RIVAL_AGE;
  if (grown && elders.length && mx >= MERIT_MIN && elders.every((s) => opts.merit(s.p) < mx) && best <= mx) return { how: 'merit', rivals: elders, killed: [] };
  if (U(0, U_CONTEST) >= (elders.length ? CONTEST_ELDER : CONTEST_MERIT)) return null;
  // 对手:兄长、战功比他多的兄弟
  const threats = alive.filter((s) => s.p.born < X.born || opts.merit(s.p) > mx);
  // 幼主:只有领过兵的兄长拥兵争位(兵败被杀)
  if (!grown) {
    const armed = threats.filter((s) => opts.armed(s.p));
    if (!armed.length) return null;
    let top = armed[0];
    for (const s of armed) if (opts.merit(s.p) > opts.merit(top.p)) top = s;
    return { how: 'revolt', rivals: [top], killed: [top] };
  }
  if (opts.armed(X)) {
    const killed = threats.filter((s, i) => U(1 + i, U_KILL) < COUP_KILL);
    if (!killed.length) killed.push(threats[0]);
    return { how: 'coup', rivals: killed, killed };
  }
  // 最大的对手:战功最多的(一样多的取年长的)
  let top = threats[0];
  for (const s of threats) if (opts.merit(s.p) > opts.merit(top.p)) top = s;
  // 他领过兵:拥兵争位,兵败被杀;没领过兵:被新君谮杀
  return { how: opts.armed(top.p) ? 'revolt' : 'intrigue', rivals: [top], killed: [top] };
}

/**
 * 引兵入朝(regents.ts 的 march):先君 R 在位的 T 那一刻,预定的继承人 X 引兵还朝掌权 —— 和举兵夺位同一种杀法:
 * 兄长、战功比他多的成年兄弟各有 COUP_KILL 的机会被杀(有这样的对手至少杀一个)。sons = R 的儿子;k = R 在在位表里第几位。
 * 没有对手 = 杀的为空(照样掌权)
 */
export function march(
  X: Son,
  T: Year,
  sons: readonly Son[],
  k: number,
  opts: { base: number; tag: number; merit: MeritOf; spare?: (p: Person) => boolean },
): ContestResult {
  const U = (s: number, use: number) => keyed4(opts.base, opts.tag, k * 16 + s, use, K_SON);
  const mx = opts.merit(X.p);
  const threats = sons.filter(
    (s) => s !== X && s.p.role === 'prince' && s.p.born + RIVAL_AGE <= T && s.end > T && !opts.spare?.(s.p) && (s.p.born < X.p.born || opts.merit(s.p) > mx),
  );
  const killed = threats.filter((s, i) => U(1 + i, U_MARCH) < COUP_KILL);
  if (!killed.length && threats.length) killed.push(threats[0]);
  return { how: 'march', rivals: killed, killed };
}
