/**
 * 导播跟着谁(纯计算,不碰 DOM;单测 tests/follow.test.ts)。存法见 gen/edits.ts 文件头"导播跟着谁":
 * 记的是最初选的那个国家 / 人物的稳定键,这里按键在(往前推过、重推过的)历史里找回来。
 *
 * - 跟一个人:导播只讲他这一辈子(他在位、领兵、在朝时的事);他"不在了"(君主失去君位、名臣去职、将领去世)以后接着跟下一位 ——
 *   君主跟继任的(同一国按即位先后的下一位,改朝换代的也算),将领、名臣、没有继任的君主回到他的国家;那时国家也亡了 = 全世界的大事。
 *   一路接下去(继任的也不在了,再跟他的继任),所以"现在跟着谁"要按年份算(followAt)。
 * - 按键找不回这个人(重推以后没有他了、切到的那一支里没有他):回到他的国家(人物键的前半就是国家键)。
 * - 选人列表(followChoices):这一年在位、领兵、在朝的人(宗室不列),按国家分组,大国在前;作者立的君主也在里面。
 */
import type { Civ, Person } from '../gen/civ/types';
import { personKey, polityKey, resolveKey, resolvePersonKey, type FollowRef } from '../gen/edits';
import { personSpan, rulerNeighbors } from '../gen/civ/peopleInfo';
import { generalRole, isConsul, ministerRole, rulerFateWord, rulerRole } from '../gen/civ/peopleText';
import { yearAt, type Era } from '../gen/era';
import type { DirectorFocus } from './directorPlan';

/** 跟着谁(这份历史里的编号) */
export interface FollowTarget {
  kind: 'polity' | 'person';
  id: number;
}

/** 一段:这些年跟着谁 */
export interface FollowLeg {
  /** 这一段跟谁;null = 全世界的大事 */
  target: FollowTarget | null;
  /** 从哪年起(第一段 = −∞)、到哪年为止(不含;最后一段 = +∞) */
  from: number;
  to: number;
  /** 上一段跟的那个人(这一段是他不在了以后接着跟的);第一段 = null */
  prev: Person | null;
}

/** 一路接着跟最多几段(防止数据坏了转不出来;三千年的君主一国也就一两百位) */
const LEGS_MAX = 2000;

/** 编号 → 稳定键(国家 / 人物不存在、算不出键的 = null) */
export function followRefOf(civ: Civ, t: FollowTarget | null): FollowRef | null {
  if (!t) return null;
  if (t.kind === 'polity') {
    const key = civ.polities[t.id] ? polityKey(civ, t.id) : '';
    return key ? { kind: 'polity', key } : null;
  }
  const key = civ.people?.[t.id] ? personKey(civ, t.id) : '';
  return key ? { kind: 'person', key } : null;
}

/** 人物键里的国家键("person:polity:c123#0|ruler|…" → "polity:c123#0");不是人物键 = null */
export function polityKeyOfPerson(key: string): string | null {
  if (!key.startsWith('person:')) return null;
  const cut = key.indexOf('|');
  const k = key.slice('person:'.length, cut < 0 ? undefined : cut);
  return k.startsWith('polity:') ? k : null;
}

/** 稳定键 → 这份历史里的国家 / 人物;人物找不回来 = 他的国家;都找不到 = null */
export function resolveFollow(civ: Civ, ref: FollowRef | null | undefined): FollowTarget | null {
  if (!ref) return null;
  if (ref.kind === 'person') {
    const id = resolvePersonKey(civ, ref.key);
    if (id >= 0) return { kind: 'person', id };
    const pk = polityKeyOfPerson(ref.key);
    return pk ? resolveFollow(civ, { kind: 'polity', key: pk }) : null;
  }
  const r = resolveKey(civ, ref.key);
  return r && r.kind === 'polity' && civ.polities[r.id] ? { kind: 'polity', id: r.id } : null;
}

/**
 * 交给导播排期的关注对象(directorPlan.ts):国家 = 只放它的事;人 = 他这一辈子的事(他在台上时他那一国重要度 ≥ 2 的事也算,
 * 不然字幕太稀),他不在了接着跟下一位。别国的事都进"略过的"
 */
export function directorFocusOf(civ: Civ, ref: FollowRef | null | undefined): DirectorFocus | null {
  const t = resolveFollow(civ, ref);
  if (!t) return null;
  return t.kind === 'polity' ? { kind: 'polity', id: t.id, others: 'none' } : { kind: 'person', id: t.id, others: 'none', min: 2, relay: true };
}

/** 他什么时候不在了(导播接着跟下一位的那一刻):君主 = 失去君位;名臣 = 去职(没记就是去世);将领 = 去世;到最后还在 = +∞ */
export function personEnd(x: Person): number {
  if (x.role === 'ruler' || x.role === 'minister') return x.until ?? x.died ?? Infinity;
  return x.died ?? Infinity;
}

/** 他不在了以后接着跟谁:君主 = 继任的;将领、名臣、没有继任的君主 = 他的国家;那时国家也没了 = null(全世界的大事) */
export function followNext(civ: Civ, x: Person): FollowTarget | null {
  if (x.role === 'ruler') {
    const n = rulerNeighbors(civ, x).next;
    if (n) return { kind: 'person', id: n.id };
  }
  const p = civ.polities[x.polity];
  const end = personEnd(x);
  return p && (p.ended === undefined || p.ended > end) ? { kind: 'polity', id: p.id } : null;
}

/** 从 start 起一路接着跟,排到 until 年为止(含)的几段;start 不是人 = 一段到底 */
export function followLegs(civ: Civ, start: FollowTarget | null, until = Infinity): FollowLeg[] {
  const legs: FollowLeg[] = [];
  let t = start;
  let from = -Infinity;
  let prev: Person | null = null;
  for (let i = 0; i < LEGS_MAX; i++) {
    const x = t?.kind === 'person' ? civ.people?.[t.id] : undefined;
    const end = x ? personEnd(x) : Infinity;
    if (!x || !(end < Infinity) || end > until) {
      legs.push({ target: x || t?.kind !== 'person' ? t : null, from, to: Infinity, prev });
      return legs;
    }
    // 接着跟的那位比上一位还早不在了(数据怪):这一段长度为 0,照样往下接
    const to = Math.max(from, end);
    legs.push({ target: t, from, to, prev });
    prev = x;
    from = to;
    t = followNext(civ, x);
  }
  legs.push({ target: null, from, to: Infinity, prev });
  return legs;
}

/** 第 year 年跟着谁(那一段) */
export function followAt(civ: Civ, start: FollowTarget | null, year: number): FollowLeg {
  const legs = followLegs(civ, start, year);
  for (let i = legs.length - 1; i >= 0; i--) if (year >= legs[i].from) return legs[i];
  return legs[0];
}

/**
 * 这一年他在不在台上:君主在位、名臣在朝;将领 = 第一次领兵以后、去世以前(两仗之间也算 ——
 * 逐年推演里还不知道他以后还打不打,和 personEnd 一样跟到他去世)
 */
export function activeAt(x: Person, year: number): boolean {
  if (x.role === 'prince') return false;
  const s = personSpan(x);
  if (year < s.from) return false;
  if (x.role === 'general') return year < personEnd(x);
  return s.until === null || year < s.until;
}

/** 能"关注他"的人:君主、将领、名臣(宗室是世系图里补出来的,没有自己的事) */
export function canFollow(x: Person | undefined | null): x is Person {
  return !!x && x.role !== 'prince';
}

/** 名牌、选人列表上的身份:"大澜皇帝""大澜将领""大澜丞相" */
export function followRole(civ: Civ, x: Person): string {
  return x.role === 'ruler' ? rulerRole(civ, x) : x.role === 'minister' ? ministerRole(civ, x) : x.role === 'general' ? generalRole(civ, x) : '';
}

/** 他怎么不在了(名牌上"燕溟死于兵乱"):君主照人物卡的结局;将领战死 / 去世;名臣去世、致仕、罢官…… */
export function goneWord(civ: Civ, x: Person): string {
  if (x.role === 'ruler') return rulerFateWord(civ, x) || '下台';
  if (x.role === 'general') return x.fate === 'battle' ? '战死' : '去世';
  const east = !!civ.polities[x.polity]?.eastern;
  switch (x.fate) {
    case 'retired':
      return east ? '致仕' : '卸任';
    case 'deposed':
      return '罢官';
    case 'fell':
      return '殉节';
    case 'surrendered':
      return '归降';
    case 'fled':
      return '归隐';
    case 'merged':
      return '随国归附';
    case 'died':
      return '去世';
    default:
      return x.died !== undefined && x.until !== undefined && x.died <= x.until ? '去世' : '离任';
  }
}

/** 名牌第二行:君主"在位第 36 年"(还没即位 = "1489 年即位");将领"1510 年起领兵";名臣"1501 年起在朝" */
export function followSub(civ: Civ, x: Person, year: number, era?: Era | null): string {
  const s = personSpan(x);
  if (x.role === 'ruler') {
    const consul = isConsul(civ, x);
    if (year < s.from) return `${yearAt(s.from, era)}${consul ? '就任' : '即位'}`;
    return `${consul ? '在任' : '在位'}第 ${Math.floor(year - s.from) + 1} 年`;
  }
  return `${yearAt(s.from, era)}起${x.role === 'minister' ? '在朝' : '领兵'}`;
}

/** 选人列表的一组:一国这一年在台上的人(君主、将领、名臣,各按上台先后) */
export interface FollowGroup {
  polity: number;
  people: Person[];
}

const ROLE_ORDER: Record<Person['role'], number> = { ruler: 0, general: 1, minister: 2, prince: 3 };

/**
 * 选人列表:第 year 年在台上的人,按国家分组;rank = 国家排在前面的先后(大国在前,没给的按编号)。
 * keep = 正在跟着的那个人:不在台上也列在他那一国的最前面
 */
export function followChoices(civ: Civ, year: number, rank: (polity: number) => number, keep: number | null = null): FollowGroup[] {
  const by = new Map<number, Person[]>();
  for (const x of civ.people ?? []) {
    if (!canFollow(x) || !civ.polities[x.polity]) continue;
    if (x.id !== keep && !activeAt(x, year)) continue;
    let g = by.get(x.polity);
    if (!g) by.set(x.polity, (g = []));
    g.push(x);
  }
  const start = (x: Person) => personSpan(x).from;
  const groups = [...by.entries()].map(([polity, people]) => ({
    polity,
    people: people.sort((a, b) => (b.id === keep ? 1 : 0) - (a.id === keep ? 1 : 0) || ROLE_ORDER[a.role] - ROLE_ORDER[b.role] || start(a) - start(b) || a.id - b.id),
  }));
  const kp = keep !== null ? civ.people?.[keep]?.polity : undefined;
  return groups.sort((a, b) => (b.polity === kp ? 1 : 0) - (a.polity === kp ? 1 : 0) || rank(a.polity) - rank(b.polity) || a.polity - b.polity);
}
