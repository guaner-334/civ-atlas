/**
 * 任将 / 任臣(干预 appoint,字段见 gen/edits.ts 文件头):作者的人物当某国的将领 / 名臣。
 * **只改人物和编年史,不改历史**:推演里只在 from 那一刻记一笔史事 intervene(b 列见下),这里由史事 + 干预列表推出
 * 他在任的那几年、怎么卸任的、将领挂帅的是哪几仗(people.ts 排人物、chronicle.ts 写编年史都用这一份)。纯计算,不碰 DOM。
 * 例外:将领带了能力(skill:良将 / 名将)的,他挂帅的那几仗本方兵力加成(wars.ts 的胜率),推演里打仗那一刻
 * 用 authorLeadsNow 问"此刻他手上是哪场" —— 和事后排人物是同一份规则、同一段代码(warsLed),只是史事记到那一刻为止。
 *
 * **任期**:那条史事那一刻起(生效了 = b 列 −1),到下面最早的那一刻为止 ——
 *   - 卸任年(until 那一年年初)/ 卒年(died)/ 都没有:将领 AUTHOR_GENERAL_AGE_END 岁卸甲、名臣 AUTHOR_MINISTER_AGE_END 岁致仕(至少一年);
 *     卸任年晚于卒年的到卒年
 *   - 这国亡了:有灭它的国家 = 出降,散了 = 出奔,并入别国 = 随国归附
 *   - 名臣:这国改朝换代(去职;想留任就再任一次)。将领照旧在任
 *   - 他又任了别的(哪国、将相都算)、即了位(同一个作者人物):前一个到那一刻为止;同一刻的,前一个算没生效(skip)
 *   任期里他在这国掌了实权(让作者的人物掌权,AppointInput.holds)、掌权比任期长的:到期没卸任,在任到掌权了结。
 *   到结束年份还在任 = until 不给。
 *
 * **挂帅哪几仗**(将领;规则不取随机数,只看到当时为止的史事,推演里也能逐刻算):
 *   - 上任那一刻本国正在打的仗(攻守都算)里挑一场;此刻没仗就等,下一场开打就挂帅
 *   - 挑的先后:宣战(declare)带 lead = 他、本国是攻方的那场(派他出征)> 最先开打的那场
 *   - 挂帅的那场打完(议和,或有一方亡了)换到还在打的里再挑一场;派他出征的那场一开打,手上那场交出去换过去
 *     (手上的也是派他出征的,照样换到新的那场)
 *   君主亲征的那几仗由君主为帅、他随驾 —— 谁亲征是排人物时定的(people.ts),这里不管;编年史按那一刻的统帅分(chronicle.ts)。
 */
import type { Annal, Polity, Year } from './types';
import { APPOINT_SKILL_POWER, AUTHOR_GENERAL_AGE_END, AUTHOR_MINISTER_AGE_END, type AppointRole, type Intervention } from '../edits';

/** 任将任臣的一条 */
export type AppointIv = Extract<Intervention, { kind: 'appoint' }>;

/**
 * 任将任臣没生效时史事 intervene 的 b 列(别的同即位、掌权:−2 他还没出生、−3 那一年这国已亡、−4 不满 16 岁(rulers.ts 的 IV_NOT_HIM)、
 * −19 他那时已去世(regents.ts 的 IV_GONE)):−20 那时他正是某国在位的君主(作者立的)
 */
export const IV_REIGNING = -20;
/** 任将任臣:要到这么多岁(同让他掌权) */
export const APPOINT_AGE = 16;

const TICK = 256;
const q = (x: number) => Math.round(x * TICK) / TICK;

/** 任期自然到哪一刻(卸任年 / 卒年 / 卸甲致仕的岁数,见文件头);t = 上任那一刻 */
export function appointEnd(v: Pick<AppointIv, 'role' | 'born' | 'died' | 'until'>, t: Year): { stop: Year; died: boolean } {
  const age = v.role === 'general' ? AUTHOR_GENERAL_AGE_END : AUTHOR_MINISTER_AGE_END;
  const back = v.until !== undefined ? v.until : v.died === undefined ? q(Math.max(t + 1, v.born + age)) : Infinity;
  return v.died !== undefined && v.died <= back ? { stop: v.died, died: true } : { stop: back, died: false };
}

/** 将领挂帅的一段:哪场战争、哪一方(0 攻 1 守)、从哪一刻到哪一刻;start / stop = 接手、交出的那一刻在史事里的位置(stop 不含) */
export interface AuthorWar {
  war: number;
  side: 0 | 1;
  from: Year;
  until: Year;
  start: number;
  stop: number;
  /** 宣战带 lead = 他(派他出征)的那场 */
  sent?: true;
}

/**
 * 一条任将任臣(第 iv 条干预,史事 intervene 在 annal):
 * end:retired 卸任(到卸任年、卸甲致仕的岁数)/ died 卒于任上(到人物卡的卒年)/ surrendered 亡国出降 / fled 亡国出奔 /
 * merged 随国归附 / deposed 改朝换代去职(名臣)/ yielded 又任了别的、即了位;到结束年份还在任 = until、end 都不给。
 * skip:史事记着生效了,但同一刻他又任了别的(replaced)/ 又即了位(crowned),这一条算没生效(没有任期、没有人物)
 */
export interface AuthorPost {
  iv: number;
  char: number;
  role: AppointRole;
  polity: number;
  born: Year;
  annal: number;
  from: Year;
  until?: Year;
  end?: 'retired' | 'died' | 'surrendered' | 'fled' | 'merged' | 'deposed' | 'yielded';
  skip?: 'replaced' | 'crowned';
  /** 他上任那一刻是这国第几朝(Polity.dynasties 的下标) */
  dynasty: number;
  /** 将领挂帅的几段(按先后;名臣没有) */
  wars: AuthorWar[];
}

/** 要用到的 Civ 字段 */
export interface AppointInput {
  annals: readonly Annal[];
  polities: readonly Polity[];
  endYear: Year;
  interventions?: readonly Intervention[];
  /**
   * 让作者的人物掌权的那几段(people.ts 按推演里的掌权排出来的;没有 = 不管):作者人物、哪国、掌权那一刻、了结那一刻(还掌着 = 不给)、
   * 是不是卒于位。任期里在这国掌了权、掌权比任期长的,在任到掌权了结
   */
  holds?: readonly { char: number; polity: number; start: Year; stop?: Year; died?: boolean }[];
}

const cache = new WeakMap<readonly Annal[], { list: readonly Intervention[] | undefined; endYear: Year; n: number; out: AuthorPost[] }>();

/**
 * 生效了的任将任臣(史事 intervene b = −1 的,按史事先后;同一刻被顶替的也在里面,带 skip)。没有任将任臣 = 空数组
 * (没下这种令的世界只多扫一遍干预列表)
 */
export function authorPostsFrom(civ: AppointInput): AuthorPost[] {
  const list = civ.interventions;
  if (!list?.some((v) => v.kind === 'appoint')) return [];
  if (civ.holds?.length) return computePosts(civ, list);
  const hit = cache.get(civ.annals);
  if (hit && hit.list === list && hit.endYear === civ.endYear && hit.n === civ.annals.length) return hit.out;
  const out = computePosts(civ, list);
  cache.set(civ.annals, { list, endYear: civ.endYear, n: civ.annals.length, out });
  return out;
}

interface WarInfo {
  id: number;
  a: number;
  b: number;
  decl: number;
  start: Year;
  /** 议和那一条的位置(没有 = 一直打到最后,或有一方亡了) */
  endIdx: number;
  /** 宣战带 lead 的那位作者人物(派他出征;没有 = −1) */
  lead: number;
}

/**
 * 排任期、挂帅的几段。now 给了 = 推演里打仗那一刻(史事只记到那一刻,civ.endYear 也是它):还在任的将领手上那场记进 leads
 * (这一仗随后记成第 annals.length 条史事,事后排出来它落在那一段里)
 */
function computePosts(civ: AppointInput, list: readonly Intervention[], now?: { t: Year; leads: AuthorLead[] }): AuthorPost[] {
  const { annals: A, polities } = civ;
  const N = A.length;
  const posts: AuthorPost[] = [];
  /** 作者人物 → 他即位的那几刻(史事位置) */
  const crowns = new Map<number, number[]>();
  const wars = new Map<number, WarInfo>();
  /** 国家 → 它打的仗(按开打先后) */
  const warsOf = new Map<number, WarInfo[]>();
  /** 国家 → 改朝换代那几条的位置 */
  const dynastyAt = new Map<number, number[]>();
  /** 国家 → 亡国(fall)/ 并入(merge)那一条 */
  const fallOf = new Map<number, Annal>();
  const mergeOf = new Map<number, Annal>();
  const push = <K, V>(m: Map<K, V[]>, k: K, v: V) => {
    const xs = m.get(k);
    if (xs) xs.push(v);
    else m.set(k, [v]);
  };
  /** 宣战干预(带 lead)的史事位置 → 那位作者人物;等紧跟着的那场 war 认领 */
  let leadAsk: { char: number; a: number; b: number; year: Year } | null = null;
  for (let i = 0; i < N; i++) {
    const e = A[i];
    if (leadAsk && (e.year !== leadAsk.year || (e.kind !== 'war' && e.kind !== 'unally' && e.kind !== 'defect'))) leadAsk = null;
    if (e.kind === 'intervene') {
      const v = list[e.war];
      if (v?.kind === 'appoint' && e.b === -1 && e.a >= 0) {
        const P = polities[e.a];
        posts.push({ iv: e.war, char: v.char, role: v.role, polity: e.a, born: v.born, annal: i, from: e.year, dynasty: P ? dynastyIndex(P, e.year) : 0, wars: [] });
      } else if (v?.kind === 'crown' && e.b === -1) push(crowns, v.char, i);
      else if (v?.kind === 'declare' && v.lead !== undefined && e.a >= 0 && e.b >= 0) leadAsk = { char: v.lead, a: e.a, b: e.b, year: e.year };
    } else if (e.kind === 'war' && e.war >= 0 && !wars.has(e.war)) {
      const lead = leadAsk && leadAsk.a === e.a && leadAsk.b === e.b ? leadAsk.char : -1;
      leadAsk = null;
      const w: WarInfo = { id: e.war, a: e.a, b: e.b, decl: i, start: e.year, endIdx: N, lead };
      wars.set(e.war, w);
      push(warsOf, e.a, w);
      push(warsOf, e.b, w);
    } else if (e.kind === 'peace' && e.war >= 0) {
      const w = wars.get(e.war);
      if (w && w.endIdx === N) w.endIdx = i;
    } else if (e.kind === 'dynasty' && e.a >= 0) push(dynastyAt, e.a, i);
    else if (e.kind === 'fall' && e.a >= 0 && !fallOf.has(e.a)) fallOf.set(e.a, e);
    else if (e.kind === 'merge' && e.b >= 0 && !mergeOf.has(e.b)) mergeOf.set(e.b, e);
  }
  /** 史事里第一条年份 ≥ t 的位置(到某一年年初为止的那一刻) */
  const indexAt = (t: Year) => {
    let lo = 0;
    let hi = N;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (A[mid].year < t) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  };
  /** 同一个作者人物的几条(任职、即位)按史事先后 */
  const byChar = new Map<number, AuthorPost[]>();
  for (const p of posts) push(byChar, p.char, p);
  for (const p of posts) {
    const v = list[p.iv] as AppointIv;
    const P = polities[p.polity];
    // 卸任、卒、卸甲致仕的岁数
    const nat = appointEnd(v, p.from);
    let stopIdx = nat.stop === Infinity ? N : indexAt(nat.stop);
    let until: Year | undefined = nat.stop;
    let end: AuthorPost['end'] = nat.died ? 'died' : 'retired';
    const cut = (idx: number, t: Year, why: NonNullable<AuthorPost['end']>) => {
      if (idx < stopIdx || (idx === stopIdx && t < (until ?? Infinity))) {
        stopIdx = idx;
        until = t;
        end = why;
      }
    };
    // 亡国:出降 / 出奔 / 随国归附
    if (P?.ended !== undefined) {
      const m = mergeOf.get(p.polity);
      const f = fallOf.get(p.polity);
      const e = m && (!f || m.year <= f.year) ? m : f;
      const idx = e ? A.indexOf(e) : indexAt(P.ended);
      cut(idx, P.ended, e === m && m ? 'merged' : f && f.b >= 0 ? 'surrendered' : 'fled');
    }
    // 名臣:改朝换代去职
    if (p.role === 'minister') for (const i of dynastyAt.get(p.polity) ?? []) if (i > p.annal) {
      cut(i, A[i].year, 'deposed');
      break;
    }
    // 又任了别的、即了位:前一个到那一刻为止(同一刻的,前一个算没生效)
    for (const o of byChar.get(p.char) ?? []) if (o.annal > p.annal) {
      if (A[o.annal].year === p.from) p.skip = 'replaced';
      else cut(o.annal, A[o.annal].year, 'yielded');
      break;
    }
    for (const i of crowns.get(p.char) ?? []) {
      if (A[i].year === p.from) p.skip = 'crowned';
      else if (i > p.annal) cut(i, A[i].year, 'yielded');
      else continue;
      break;
    }
    if (p.skip) continue;
    // 到期卸任以前在这国掌了权、掌权比任期长:在任到掌权了结
    if (end === 'retired' || end === 'died') {
      const h = civ.holds?.find((x) => x.char === p.char && x.polity === p.polity && x.start >= p.from && x.start < (until ?? Infinity));
      if (h && (h.stop === undefined || h.stop > (until ?? Infinity))) {
        until = h.stop ?? Infinity;
        end = h.died ? 'died' : 'retired';
        stopIdx = h.stop === undefined ? N : indexAt(h.stop);
      }
    }
    // 到结束年份还在任
    if (until === undefined || until > civ.endYear) {
      until = undefined;
      end = undefined;
      stopIdx = N;
    }
    if (until !== undefined) p.until = until;
    if (end) p.end = end;
    if (p.role !== 'general') continue;
    const led = warsLed(A, p, warsOf.get(p.polity) ?? [], polities, stopIdx, until ?? civ.endYear, until === undefined ? now?.t : undefined);
    p.wars = led.segs;
    if (now && led.cur) now.leads.push({ iv: p.iv, char: p.char, polity: p.polity, war: led.cur.war, side: led.cur.side });
  }
  return posts;
}

/** 推演里打仗那一刻,一位作者将领手上的那场:第几条干预、作者人物、哪国、哪场战争、哪一方(0 攻 1 守) */
export interface AuthorLead {
  iv: number;
  char: number;
  polity: number;
  war: number;
  side: 0 | 1;
}

/**
 * 推演里打仗那一刻(civ.annals 是史事记到此刻为止的那些,t = 此刻):还在任的作者将领各自手上是哪场仗。
 * 规则和事后 authorPostsFrom 排挂帅的那几段是同一段代码(warsLed),只看到当时为止的史事,所以两边一样:
 * 这一仗随后记下的史事,事后排出来正落在他挂帅的那一段里。civ.endYear 不看(按 t)。没有任将 = 空数组
 */
export function authorLeadsNow(civ: AppointInput, t: Year): AuthorLead[] {
  const list = civ.interventions;
  if (!list?.some((v) => v.kind === 'appoint')) return [];
  const leads: AuthorLead[] = [];
  computePosts({ ...civ, endYear: t }, list, { t, leads });
  return leads;
}

/**
 * 战争 war 里 pid 一方此刻由带能力的作者将领挂帅:本方兵力乘的数(没有 = 1;同一国几位作者将领领着同一场的,取最大的)。
 * leads = authorLeadsNow 的结果,side = pid 在这场里是哪一方。
 * 君主亲征的那几仗他随驾,这里也照样加(谁亲征是推完排人物时才定的,推演里分不出);要改成随驾不加,得先把亲征挪进推演
 */
export function skillPower(list: readonly Intervention[], leads: readonly AuthorLead[], pid: number, war: number, side: 0 | 1): number {
  let k = 1;
  for (const l of leads) {
    if (l.polity !== pid || l.war !== war || l.side !== side) continue;
    const v = list[l.iv];
    if (v?.kind === 'appoint' && v.skill) k = Math.max(k, APPOINT_SKILL_POWER[v.skill]);
  }
  return k;
}

/** 第 t 年这国是第几朝 */
function dynastyIndex(P: Polity, t: Year): number {
  let k = 0;
  const ds = P.dynasties ?? [];
  for (let i = 1; i < ds.length; i++) if (ds[i].year <= t) k = i;
  return k;
}

/**
 * 将领挂帅的几段(规则见文件头):从他上任那条史事走到 stop(不含)。
 * now 给了(推演里打仗那一刻,他还在任、stop = 史事条数):走完以后再看此刻(第 stop 条、年份 now,即将记下的这一仗)手上那场还在不在打,
 * 不在就换一场 —— 和事后走到那一条时一样;cur = 此刻手上的那场(没仗 = null)。不给 now 时 cur 不用
 */
function warsLed(
  A: readonly Annal[],
  p: AuthorPost,
  mine: readonly WarInfo[],
  polities: readonly Polity[],
  stop: number,
  until: Year,
  now?: Year,
): { segs: AuthorWar[]; cur: { war: number; side: 0 | 1 } | null } {
  const out: AuthorWar[] = [];
  const pid = p.polity;
  const N = A.length;
  /** 第 i 条史事那一刻(年份 t,不给 = 那条的)还在打(开打了、没议和、两边都还在);endIdx = N 是到此为止还没议和 */
  const live = (w: WarInfo, i: number, t: Year = A[Math.min(i, N - 1)]?.year ?? until) => {
    if (w.decl > i || (w.endIdx < N && w.endIdx <= i)) return false;
    const gone = (x: number) => {
      const P = polities[x];
      return !!P && P.ended !== undefined && P.ended < t;
    };
    return !gone(w.a) && !gone(w.b);
  };
  const sentHere = (w: WarInfo) => w.lead === p.char && w.a === pid;
  const pick = (i: number, t?: Year): WarInfo | null => {
    let best: WarInfo | null = null;
    for (const w of mine) {
      if (!live(w, i, t)) continue;
      if (sentHere(w)) return w;
      best ??= w;
    }
    return best;
  };
  let cur = null as { w: WarInfo; start: number; from: Year } | null;
  const close = (i: number, t: Year) => {
    if (!cur) return;
    // 同一刻接手又交出(上任那一刻正在打的仗、派他出征的那场同一刻开打):不算挂过帅
    if (t <= cur.from) {
      cur = null;
      return;
    }
    const seg: AuthorWar = { war: cur.w.id, side: cur.w.a === pid ? 0 : 1, from: cur.from, until: t, start: cur.start, stop: i };
    if (sentHere(cur.w)) seg.sent = true;
    out.push(seg);
    cur = null;
  };
  const take = (w: WarInfo | null, i: number) => {
    if (w) cur = { w, start: i, from: A[i]?.year ?? until };
  };
  take(pick(p.annal), p.annal);
  for (let i = p.annal + 1; i < stop && i < A.length; i++) {
    const e = A[i];
    if (cur && !live(cur.w, i)) {
      close(i, e.year);
      take(pick(i), i);
    }
    if (e.kind !== 'war' || (e.a !== pid && e.b !== pid)) continue;
    const w = mine.find((x) => x.decl === i);
    if (!w) continue;
    if (!cur) take(w, i);
    else if (sentHere(w)) {
      close(i, e.year);
      take(w, i);
    }
  }
  if (now !== undefined) {
    // 推演里打仗那一刻:手上那场此刻打完了(有一方亡了还没记议和)就换一场,和事后走到这一仗那条史事时一样
    if (cur && !live(cur.w, stop, now)) {
      close(stop, now);
      take(pick(stop, now), stop);
    }
    return { segs: out, cur: cur ? { war: cur.w.id, side: cur.w.a === pid ? 0 : 1 } : null };
  }
  if (cur) {
    const end = stop < A.length ? A[stop].year : until;
    close(stop, Math.min(end, until));
  }
  return { segs: out, cur: null };
}
