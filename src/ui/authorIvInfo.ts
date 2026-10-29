/**
 * 作者的人物当将领、名臣、掌权(干预"任将 / 任臣" appoint、"让作者的人物掌权" regent 带 char,格式见 gen/edits.ts)在界面上的说法和状态
 * (写到这个人物的"他 / 她"按人物卡上的性别):人物卡的「为将」「为臣」「掌权」三块、概况的「仕途」(CharacterPanel.tsx)、
 * 任将 / 任臣 / 掌权三页(AuthorIvPages.tsx)、待推演的单子、「我的干预」共用。即位那一套见 crownInfo.ts。
 *
 * 一条的说法:"林小满为大衍王朝将，到 2442 年卸任""林小满为大衍王朝将（良将），到卒年（2461 年）""林小满入大衍王朝为臣，到 70 岁致仕"、
 * "苏晚以大臣专权掌大衍王朝国政，5 年后还政"。人物卡上一条有四种样子:待推演 / 下一步生效(还在单子里)、生效了(推演里有他)、没生效(写原因)。
 *
 * 将领挂帅的每一仗(ledWars):同一场仗接连几段并成一条;胜负按他挂帅那几年本方得失 —— 对方在这几年亡了、得的州比失的多 = 胜,
 * 失的多 = 兵败,一样多(连同都没有)= 无功。名臣经手的事人物卡上只列最大的 DEEDS_SHOWN 件(拥立、劝进、迁都、议和、赈灾、主战、守御的先后),
 * 其余折成"另经手 N 件"。
 *
 * 改人物的生卒、性格,删人物时问的那一句(authorEditAsk / authorDeleteAsk):即位那套(crownInfo.ts)扩到任将、任臣、掌权 ——
 * 它们抄着生卒(掌权还抄着性格),人物卡改了要不要一起改;删人物连这几任一起去掉,还是只删人物(那几任改叫"作者的人物",历史不变)。
 */
import type { Civ, Person, PersonDeed, PersonRegency, Polity } from '../gen/civ/types';
import { polityName } from '../gen/civ/growth';
import { cnNumber, regionList } from '../gen/civ/chronicle';
import { commandFoe, peopleIndex } from '../gen/civ/peopleInfo';
import { personName } from '../gen/civ/peopleText';
import { heOrShe, type Sexed } from '../gen/civ/gender';
import { postAt } from '../gen/civ/officialText';
import { interventionFate } from '../gen/stepwise';
import {
  AUTHOR_GENERAL_AGE_END,
  AUTHOR_MINISTER_AGE_END,
  AUTHOR_REGENT_AGE_END,
  cleanIntervention,
  commandAt,
  polityKey as polityKeyOf,
  resolveKey,
  ticksAt,
  type AppointSkill,
  type Intervention,
} from '../gen/edits';
import { eraText, spaced, yearAt, yearFull, yearSpanAt, type Era } from '../gen/era';
import { AUTHOR_RULER_DEFAULT, characterLeanings, type AuthorCharacter } from '../gen/characters';
import type { Pending } from './pendingStore';
import { crownDeleteAsk, crownEditAsk, type CrownAsk } from './crownInfo';

export type AppointIv = Extract<Intervention, { kind: 'appoint' }>;
export type AuthorRegentIv = Extract<Intervention, { kind: 'regent'; char: number }>;
/** 作者的人物当将领、名臣、掌权的一条 */
export type PostIv = AppointIv | AuthorRegentIv;
/** 哪一种:将领 / 名臣 / 掌权 */
export type PostRole = 'general' | 'minister' | 'regent';

export const postRole = (v: PostIv): PostRole => (v.kind === 'appoint' ? v.role : 'regent');
/** 这一条是不是作者人物 id 的任将任臣掌权 */
export const isPostOf = (v: Intervention, id: number): v is PostIv => (v.kind === 'appoint' || (v.kind === 'regent' && v.char !== undefined)) && v.char === id;

/** 能力三档怎么叫(不给 = 寻常) */
export const SKILL_NAMES: Readonly<Record<'plain' | AppointSkill, string>> = { plain: '寻常', good: '良将', great: '名将' };
/** 人物卡上名臣经手的事最多列几件(其余折起来) */
export const DEEDS_SHOWN = 5;
/** 掌权怎么掌(作者的人物) */
export const AUTHOR_HOW_NAMES: Readonly<Record<'chancellor' | 'general', string>> = { chancellor: '大臣专权', general: '大将专权' };

/** 那一年的国名(那一年还没立国 / 已亡:立国时 / 亡国前的国号) */
export function polityNameAt(p: Polity, year: number): string {
  const y = year < p.founded ? p.founded : p.ended !== undefined && year >= p.ended ? p.ended - 1 / 512 : year;
  return polityName(p, y) || p.name || '某国';
}

/** 国家的稳定键 → 那一年的国名;这份历史里没有 = missing */
function keyPolityName(civ: Civ, key: string, year: number, missing = '（新历史里没有的国家）'): string {
  const k = resolveKey(civ, key);
  return k?.kind === 'polity' ? polityNameAt(civ.polities[k.id], year) : missing;
}

/** 任将任臣到什么时候的尾巴:"到 2442 年卸任" / "到卒年（2461 年）" / "到 65 岁卸甲" */
export function appointTail(v: { role: 'general' | 'minister'; until?: number; died?: number }, era: Era | undefined): string {
  if (v.until !== undefined) return `到${spaced(yearAt(v.until, era))}${v.role === 'general' ? '卸任' : '去职'}`;
  if (v.died !== undefined) return `到卒年（${yearAt(v.died, era)}）`;
  return v.role === 'general' ? `到 ${AUTHOR_GENERAL_AGE_END} 岁卸甲` : `到 ${AUTHOR_MINISTER_AGE_END} 岁致仕`;
}

/** 掌权到什么时候:"5 年后还政" / "到卒年（2458 年）" / "到 70 岁还政" */
export function regentTail(v: { years?: number; died?: number }, era: Era | undefined): string {
  if (v.years !== undefined) return `${v.years} 年后还政`;
  if (v.died !== undefined) return `到卒年（${yearAt(v.died, era)}）`;
  return `到 ${AUTHOR_REGENT_AGE_END} 岁还政`;
}

/** 一条的说法(单子、我的干预):who = 人物的名字,A = 国名 */
export function postLine(who: string, A: string, v: PostIv, era: Era | undefined): string {
  if (v.kind === 'regent') return `${who}以${AUTHOR_HOW_NAMES[v.how]}掌${A}国政，${regentTail(v, era)}`;
  if (v.role === 'minister') return `${who}入${A}为臣，${appointTail(v, era)}`;
  return `${who}为${A}将${v.skill ? `（${SKILL_NAMES[v.skill]}）` : ''}，${appointTail(v, era)}`;
}

/** 人物卡上他的一条任将任臣掌权 */
export type PostState =
  /** 还在单子里:待推演 / 下一步生效(逐年推演) */
  | { kind: 'queued'; v: PostIv; step: boolean; A: string }
  /** 生效了:x = 推演里的他(任将任臣:那一任的人物;掌权:掌权挂着的那位),g = 掌权的那一段 */
  | { kind: 'done'; v: PostIv; x: Person; A: string; g?: PersonRegency }
  /** 没生效:why = 原因;at = 在作者的干预列表里是第几条(去掉用;逐年推演里下的 = −1) */
  | { kind: 'void'; v: PostIv; A: string; why: string; at: number };

/**
 * 人物 id 的任将任臣掌权:单子里的(待推演 / 下一步生效)和这份历史里推过的(生效了 / 没生效),按生效那一刻先后。
 * 参数同 crownInfo.ts 的 characterCrowns
 */
export function characterPosts(civ: Civ, id: number, pending: readonly Pending[], ivs: readonly unknown[], step: boolean, era: Era | undefined, tick = 0): PostState[] {
  const out: PostState[] = [];
  (civ.interventions ?? []).forEach((v, i) => {
    if (!isPostOf(v, id)) return;
    const f = interventionFate(civ, i);
    if (f.state === 'later') return;
    const at = ivs.findIndex((x) => JSON.stringify(cleanIntervention(x)) === JSON.stringify(v));
    const e = f.annal >= 0 ? civ.annals[f.annal] : null;
    const A = e && e.a >= 0 && civ.polities[e.a] ? polityNameAt(civ.polities[e.a], v.from) : keyPolityName(civ, v.a, v.from);
    if (f.state === 'done' && e) {
      if (v.kind === 'appoint') {
        const x = civ.people?.find((p) => p.author === id && p.role === v.role && p.polity === e.a && p.from === e.year);
        if (x) return void out.push({ kind: 'done', v, x, A });
      } else {
        for (const x of civ.people ?? []) {
          const g = x.author === id ? x.regencies?.find((r) => r.annal === f.annal + 1) : undefined;
          if (g) return void out.push({ kind: 'done', v, x, A, g });
        }
      }
    }
    out.push({ kind: 'void', v, A, why: voidWhy(civ, v, e, f.state === 'void' ? f.why : '没有生效', era), at });
  });
  for (const p of pending) {
    if (p.kind !== 'iv' || !isPostOf(p.v, id)) continue;
    out.push({ kind: 'queued', v: p.v, step, A: keyPolityName(civ, p.v.a, p.v.from) });
  }
  const t = (x: PostState) => (x.kind === 'queued' && step ? ticksAt(x.v.from, tick) : commandAt(x.v));
  return out.sort((a, b) => t(a) - t(b));
}

/**
 * 他那时是不是 pid 那国的 role(将领 / 名臣):推过生效了的(推演里那一任 yv 那一刻在任)、单子里的(y 那年在任期里)。
 * posts = characterPosts 的结果;y = 生效年份,yv = 看推演用哪一刻(逐年推演的下一步还没算出来:"现在")
 */
export function holdsPost(civ: Civ, posts: readonly PostState[], role: 'general' | 'minister', pid: number, y: number, yv: number): boolean {
  const key = civ.polities[pid] ? polityKeyOf(civ, pid) : '';
  return posts.some((s) => {
    if (s.v.kind !== 'appoint' || s.v.role !== role) return false;
    if (s.kind === 'done') return s.x.polity === pid && (s.x.from ?? Infinity) <= yv && (s.x.until === undefined || s.x.until > yv);
    return s.kind === 'queued' && s.v.a === key && s.v.from <= y && (s.v.until === undefined || s.v.until > y);
  });
}

/**
 * 同一时刻只有一个身份:推演只管任将任臣之间、任职和即位之间(后一个顶掉前一个),掌权和任职之间不管 —— 下令时拦下。
 * 任将任臣(role = general / minister)那一年他正掌着别国的权、掌权(role = regent)那一年他正任着别国的将相 = 原因;没有 = null。
 * 同一国的不算(在那国任着将相掌权 = 大将 / 大臣专权)。posts = characterPosts 的结果;y = 生效年份,yv = 看推演用哪一刻
 */
export function overlapWhy(civ: Civ, posts: readonly PostState[], role: PostRole, pid: number, y: number, yv: number, he: string, era: Era | undefined): string | null {
  for (const s of posts) {
    if (s.kind === 'void') continue;
    const r = postRole(s.v);
    if (role === 'regent' ? r === 'regent' : r !== 'regent') continue;
    let p: number;
    let from: number;
    let until: number | undefined;
    if (s.kind === 'done') {
      p = s.x.polity;
      from = s.g ? s.g.from : (s.x.from ?? s.v.from);
      until = s.g ? s.g.until : s.x.until;
    } else {
      const k = resolveKey(civ, s.v.a);
      p = k?.kind === 'polity' ? k.id : -1;
      from = s.v.from;
      until = s.v.kind === 'regent' ? (s.v.years !== undefined ? s.v.from + s.v.years : s.v.died) : (s.v.until ?? s.v.died);
    }
    if (p === pid || p < 0) continue;
    const t = s.kind === 'done' ? yv : y;
    if (from > t || (until !== undefined && until <= t)) continue;
    const span = spaced(until !== undefined ? yearSpanAt(from, until, era) : `${yearAt(from, era)}起`);
    const A = s.A;
    return r === 'regent'
      ? `${he}${span}掌${A}国政，同一时刻只有一个身份`
      : `${he}${span}是${A}的${r === 'general' ? '将领' : '名臣'}，同一时刻只有一个身份`;
  }
  return null;
}

/**
 * 国家干预页宣战选了谁挂帅,加进单子的几条(CommandPage.tsx 的「谁挂帅」那一页):c = 作者的人物(照推演派 = null)、general = 他那年已是这国将领。
 * 照推演派 = 一条宣战;选了他、已是将领 = 一条带 lead 的宣战;还不是将领 = 先任他为将(到卒年、能力寻常),再一条带 lead 的宣战
 */
export function leadOrders(a: string, b: string, y: number, c: Pick<AuthorCharacter, 'id' | 'born' | 'died'> | null, general: boolean): { appoint: AppointIv | null; declare: Intervention } {
  if (!c) return { appoint: null, declare: { kind: 'declare', a, b, from: y } };
  const declare: Intervention = { kind: 'declare', a, b, from: y, lead: c.id };
  if (general) return { appoint: null, declare };
  return { appoint: { kind: 'appoint', a, char: c.id, role: 'general', born: c.born, ...(c.died !== undefined ? { died: c.died } : {}), from: y }, declare };
}

/** 没生效的原因:"那一年后东定国已亡（2428 年）" / "他第 2398 年才出生"…… */
function voidWhy(civ: Civ, v: PostIv, e: Civ['annals'][number] | null, why: string, era: Era | undefined): string {
  if (e && e.b === -3 && civ.polities[e.a]?.ended !== undefined) {
    const p = civ.polities[e.a];
    return `那一年${polityNameAt(p, v.from)}已亡（${yearAt(Math.floor(p.ended!), era)}）`;
  }
  return eraText(why, era);
}

/** 没生效那段话的后半:"推演里没有这位将领。改年份或换一国，点「进推演…」重新下一条。" */
export function voidTail(v: PostIv, x: Sexed): string {
  const r = postRole(v);
  const none = r === 'general' ? '推演里没有这位将领' : r === 'minister' ? '推演里没有这位名臣' : `推演里${heOrShe(x)}没有掌权`;
  return `${none}。改年份或换一国，点「进推演…」重新下一条。`;
}

/** 推完的提示条:"林小满为大衍王朝将，到 2442 年卸任" / 没生效 "林小满没能为将：第 2430 年后东定国已亡" */
export function postDoneText(civ: Civ, v: PostIv, i: number, who: string, era: Era | undefined): { ok: boolean; text: string } {
  const f = i >= 0 ? interventionFate(civ, i) : null;
  const A = keyPolityName(civ, v.a, v.from);
  if (f?.state === 'void') {
    const why = f.why;
    const r = postRole(v);
    return { ok: false, text: `${who}没能${r === 'general' ? '为将' : r === 'minister' ? '入朝' : '掌权'}：${eraText(why.startsWith('那一年') ? `第 ${v.from} 年${why.slice(3)}` : why, era)}` };
  }
  return { ok: true, text: postLine(who, A, v, era) };
}

// ---------------------------------------------------------------------------
// 生效了以后:人物卡上的几行

/** 将领挂帅的一仗(同一场接连几段并成一条) */
export interface LedWar {
  war: number;
  /** 0 攻 1 守 */
  side: 0 | 1;
  /** 对面那国(没有 = −1) */
  foe: number;
  from: number;
  until: number;
  /** 这一场开打的那一条史事(点了看编年史) */
  decl: number;
  result: 'win' | 'even' | 'lose';
  /** 推演原来派的统帅(副将;君主亲征的不算) */
  deputies: Person[];
  /** 得失的州、守住几回、对面这几年亡了 */
  gained: number[];
  lost: number[];
  held: number;
  fell: boolean;
  /** 他交出以后:谁接着领兵(没有 = null)、这场仗哪年议和、议和时本方净得失几州(没议和 = 不给) */
  next: Person | null;
  peace?: { year: number; got: number; lost: number };
}

/** 胜负小标签的字 */
export const RESULT_WORD: Readonly<Record<LedWar['result'], string>> = { win: '胜', even: '无功', lose: '兵败' };

/** 将领 x(作者的将领)挂帅的每一仗,按先后 */
export function ledWars(civ: Civ, x: Person): LedWar[] {
  const A = civ.annals;
  const ix = peopleIndex(civ);
  const out: LedWar[] = [];
  const pid = x.polity;
  // 同一场仗(同一方)几段并成一条:派他出征换过去、打完又回来领原来那场的也算一场
  const byWar = new Map<string, LedWar>();
  for (const c of x.commands ?? []) {
    if (c.rear) continue;
    let w = byWar.get(`${c.war}:${c.side}`);
    if (w) {
      w.from = Math.min(w.from, c.from);
      w.until = Math.max(w.until, c.until);
    } else {
      w = { war: c.war, side: c.side, foe: commandFoe(civ, c), from: c.from, until: c.until, decl: A.findIndex((e) => e.kind === 'war' && e.war === c.war), result: 'even', deputies: [], gained: [], lost: [], held: 0, fell: false, next: null };
      byWar.set(`${c.war}:${c.side}`, w);
      out.push(w);
    }
    for (let i = Math.max(0, c.first); i <= c.last && i < A.length; i++) {
      const e = A[i];
      if (e.war !== c.war) continue;
      if (e.kind === 'conquer' && e.a === pid && e.region >= 0) w.gained.push(e.region);
      else if (e.kind === 'conquer' && e.b === pid && e.region >= 0) w.lost.push(e.region);
      else if (e.kind === 'battle' && e.b === pid) w.held++;
    }
    // 副将:推演原来派的那几位(任期和他这一段叠着的)
    for (const g of ix.generals[pid] ?? []) {
      if (g.author !== undefined || w.deputies.includes(g)) continue;
      if (g.commands?.some((m) => m.war === c.war && m.side === c.side && !m.rear && m.from < c.until && m.until > c.from)) w.deputies.push(g);
    }
  }
  for (const w of out) {
    const F = w.foe >= 0 ? civ.polities[w.foe] : undefined;
    w.fell = !!F && F.ended !== undefined && F.ended >= w.from && F.ended <= w.until + 1e-6;
    const P = civ.polities[pid];
    const selfFell = !!P && P.ended !== undefined && P.ended >= w.from && P.ended <= w.until + 1e-6;
    w.result = w.fell ? 'win' : selfFell ? 'lose' : w.gained.length > w.lost.length ? 'win' : w.lost.length > w.gained.length ? 'lose' : 'even';
    // 他交出以后:接着领兵的推演将领,这场仗的议和
    const pi = A.findIndex((e) => e.kind === 'peace' && e.war === w.war);
    if (pi >= 0 && A[pi].year > w.until + 1e-6) w.peace = { year: A[pi].year, ...swing(civ, pi, pid) };
    if (pi < 0 || A[pi].year > w.until + 1e-6)
      w.next = ix.generals[pid]?.find((g) => g.author === undefined && g.commands?.some((m) => m.war === w.war && m.side === w.side && !m.rear && m.until > w.until + 1e-6 && m.from <= w.until + 1e-6)) ?? null;
  }
  return out;
}

/** 议和时这场仗里本国净得、失几州(同编年史"议和,得某州等五州":每一州最早的原主、最后是谁打下来的) */
function swing(civ: Civ, idx: number, polity: number): { got: number; lost: number } {
  const e = civ.annals[idx];
  const first = new Map<number, number>();
  const last = new Map<number, number>();
  for (let j = 0; j < idx; j++) {
    const c = civ.annals[j];
    if (c.kind !== 'conquer' || c.war !== e.war || c.region < 0) continue;
    if (!first.has(c.region)) first.set(c.region, c.b);
    last.set(c.region, c.a);
  }
  let got = 0;
  let lost = 0;
  for (const [r, by] of last) {
    const was = first.get(r);
    if (by === polity && was !== polity) got++;
    else if (was === polity && by !== polity) lost++;
  }
  return { got, lost };
}

/** 一仗的标题:"伐后东定国" / "御哈兹斯坦帝国" */
export function warTitle(civ: Civ, w: LedWar): string {
  const F = w.foe >= 0 ? civ.polities[w.foe] : undefined;
  return `${w.side === 0 ? '伐' : '御'}${F ? polityNameAt(F, w.from) : '敌国'}`;
}

/** 一仗下面两行:"2421–2428 年，副将凌鸾翎";"得关南道等四州，后东定国亡" / "击退来攻四次；他卸任后苏雪接着领兵，当年议和，疆界如故" */
export function warLines(civ: Civ, w: LedWar, x: Person, he: string, ongoing: boolean, era: Era | undefined): [string, string] {
  const span = ongoing ? `${yearAt(w.from, era)}起` : yearSpanAt(w.from, w.until, era);
  const first = `${span}${w.deputies.length ? `，副将${w.deputies.map((g) => personName(civ, g)).join('、')}` : ''}`;
  const parts: string[] = [];
  if (w.gained.length) parts.push(`得${regionList(civ, w.gained)}`);
  if (w.lost.length) parts.push(`失${regionList(civ, w.lost)}`);
  if (w.held) parts.push(`击退来攻${cnNumber(w.held)}次`);
  if (w.fell && w.foe >= 0) parts.push(`${polityNameAt(civ.polities[w.foe], w.until)}亡`);
  let line = parts.join('，') || (ongoing ? '' : '无功');
  if (!ongoing && (w.next || w.peace)) {
    const after: string[] = [];
    if (w.next) after.push(`${x.until !== undefined && Math.abs(x.until - w.until) < 1e-6 ? `${he}卸任后` : ''}${personName(civ, w.next)}接着领兵`);
    if (w.peace) {
      const same = Math.floor(w.peace.year) === Math.floor(w.until);
      const res = w.peace.got && w.peace.lost ? `得${cnNumber(w.peace.got)}州、割${cnNumber(w.peace.lost)}州` : w.peace.got ? `得${cnNumber(w.peace.got)}州` : w.peace.lost ? `割${cnNumber(w.peace.lost)}州` : '疆界如故';
      after.push(`${same ? '当年' : yearAt(w.peace.year, era)}议和，${res}`);
    }
    line = line ? `${line}；${after.join('，')}` : after.join('，');
  }
  return [first, line];
}

/** 战绩:"挂帅 2 仗：胜 1、无功 1"(没仗 = '') */
export function warTally(ws: readonly LedWar[]): string {
  if (!ws.length) return '';
  const n = (r: LedWar['result']) => ws.filter((w) => w.result === r).length;
  const parts = (['win', 'even', 'lose'] as const).filter((r) => n(r) > 0).map((r) => `${RESULT_WORD[r]} ${n(r)}`);
  return `挂帅 ${ws.length} 仗：${parts.join('、')}`;
}

/** 经手的事的先后(越小越大的事;同等按年份) */
const DEED_RANK: Readonly<Record<PersonDeed['kind'], number>> = { found: 0, regent: 0, power: 0, enthrone: 1, rank: 2, capital: 3, peace: 4, relief: 5, war: 6, defend: 7 };

/** 名臣经手的事:人物卡上列的几件(最大的 DEEDS_SHOWN 件,按年份)和折起来的几件(按年份) */
export function deedsShown(ds: readonly PersonDeed[]): { shown: PersonDeed[]; folded: PersonDeed[] } {
  if (ds.length <= DEEDS_SHOWN) return { shown: [...ds], folded: [] };
  const pick = new Set([...ds].sort((a, b) => DEED_RANK[a.kind] - DEED_RANK[b.kind] || a.year - b.year).slice(0, DEEDS_SHOWN));
  return { shown: ds.filter((d) => pick.has(d)), folded: ds.filter((d) => !pick.has(d)) };
}

/** 经手的一件事:"与新特利亚国议和""力主伐后东定国""迁都梅雪城""主持赈灾" */
export function deedText(civ: Civ, x: Person, d: PersonDeed): string {
  const e = d.annal !== undefined ? civ.annals[d.annal] : undefined;
  const foeId = e ? (e.a === x.polity ? e.b : e.a) : -1;
  const foe = foeId >= 0 && civ.polities[foeId] ? polityNameAt(civ.polities[foeId], d.year) : '敌国';
  const who = d.person !== undefined ? civ.people?.[d.person] : undefined;
  const city = e && e.settlement >= 0 ? (civ.settlements[e.settlement]?.name ?? '') : '';
  switch (d.kind) {
    case 'peace':
      return `与${foe}议和`;
    case 'war':
      return `力主伐${foe}`;
    case 'defend':
      return `${foe}来攻，主持守御`;
    case 'capital':
      return e && e.war >= 0 ? `国都失守，护驾迁都${city}` : `力主迁都${city}`;
    case 'relief':
      return '主持赈灾';
    case 'rank':
      return '劝进';
    case 'enthrone':
      return who ? `迎立${personName(civ, who)}` : '拥立新君';
    default:
      return '经手朝政';
  }
}

/** 同一件事推演里经手的那位名臣:"礼部尚书温曜曦"(没有 = '') */
export function deedPeer(civ: Civ, x: Person, d: PersonDeed): string {
  if (d.annal === undefined && d.upheaval === undefined) return '';
  const m = civ.people?.find(
    (p) => p.role === 'minister' && p.author === undefined && p.polity === x.polity && p.deeds?.some((o) => o.kind === d.kind && o.annal === d.annal && o.upheaval === d.upheaval),
  );
  return m ? `${postAt(m, d.year)?.title ?? ''}${m.name}` : '';
}

/** 仕途(概况一行):做过的将相、掌权,"左将军、礼部尚书"、年份"2421–2446 年"(还在任的 "2421 年起");没当过 = null */
export function careerLine(posts: readonly PostState[], era: Era | undefined): { titles: string; span: string } | null {
  const done = posts.filter((s): s is Extract<PostState, { kind: 'done' }> => s.kind === 'done');
  if (!done.length) return null;
  const titles: string[] = [];
  let from = Infinity;
  let until = -Infinity;
  let open = false;
  for (const s of done) {
    const t = s.g ? AUTHOR_HOW_NAMES[s.g.kind === 'general' ? 'general' : 'chancellor'] : (s.x.posts?.[s.x.posts.length - 1]?.title ?? (s.x.role === 'general' ? '将领' : '名臣'));
    if (!titles.includes(t)) titles.push(t);
    const f = s.g ? s.g.from : (s.x.from ?? s.v.from);
    const u = s.g ? s.g.until : s.x.until;
    from = Math.min(from, f);
    if (u === undefined) open = true;
    else until = Math.max(until, u);
  }
  return { titles: titles.join('、'), span: open ? `${yearAt(from, era)}起` : yearSpanAt(from, until, era) };
}

// ---------------------------------------------------------------------------
// 改人物、删人物时问一句(即位那套扩到任将、任臣、掌权;crownInfo.ts 的 crownEditAsk / crownDeleteAsk,CrownAsk.tsx 弹出来)

/** 他在作者的干预列表 ivs 里的一条任将任臣掌权(这份历史里推过的):at = 第几条,st = 人物卡上那一条的样子 */
interface PostAt {
  at: number;
  v: PostIv;
  st: Exclude<PostState, { kind: 'queued' }>;
}

function postsIn(civ: Civ, id: number, ivs: readonly Intervention[], era: Era | undefined): PostAt[] {
  return characterPosts(civ, id, [], ivs, false, era).flatMap((st): PostAt[] => {
    if (st.kind === 'queued') return [];
    const at = st.kind === 'void' ? st.at : ivs.findIndex((x) => JSON.stringify(cleanIntervention(x)) === JSON.stringify(st.v));
    const v = ivs[at];
    if (at < 0 || !v || !isPostOf(v, id)) return [];
    return [{ at, v, st }];
  });
}

/** 一任的说法:"大衍王朝的将领（2421–2442 年）" / "大衍王朝的名臣（2442 年起）" / "掌大衍王朝的权（2436–2441 年）";没生效的写"一条没生效的任将（2430 年，后东定国）" */
function postWhat(p: PostAt, era: Era | undefined): string {
  const r = postRole(p.v);
  if (p.st.kind !== 'done') return `一条没生效的${r === 'general' ? '任将' : r === 'minister' ? '任臣' : '掌权'}（${yearAt(p.v.from, era)}，${p.st.A}）`;
  const from = p.st.g ? p.st.g.from : (p.st.x.from ?? p.v.from);
  const until = p.st.g ? p.st.g.until : p.st.x.until;
  const span = until !== undefined ? yearSpanAt(from, until, era) : `${yearAt(from, era)}起`;
  return r === 'regent' ? `掌${p.st.A}的权（${span}）` : `${p.st.A}的${r === 'general' ? '将领' : '名臣'}（${span}）`;
}

/** 他名下这几样怎么叫:"即位、任职、掌权"(有哪样写哪样) */
function holdWords(crown: boolean, posts: readonly PostAt[]): string {
  const w: string[] = [];
  if (crown) w.push('即位');
  if (posts.some((p) => p.v.kind === 'appoint')) w.push('任职');
  if (posts.some((p) => p.v.kind === 'regent')) w.push('掌权');
  return w.join('、');
}

/** 改过以后的列表比原来的:去掉、改了的那几条里最早的生效年份 */
function redoFrom(before: readonly Intervention[], after: readonly Intervention[]): number {
  const kept = new Set(after.map((v) => JSON.stringify(v)));
  return Math.min(...before.filter((v) => !kept.has(JSON.stringify(v))).map((v) => v.from));
}

/**
 * 编辑人物点「完成」:改了生年、卒年、性格,他的即位、任将任臣掌权(抄着生卒;掌权还抄着性格)要不要一起改。都没有要改的 = null(直接存)。
 * 即位照 crownEditAsk;任将任臣掌权:生年、卒年照新的抄进去(卒年早到上任那年或更早的,这一条去掉;卒年去掉了 = 到卸甲致仕的岁数),掌权的性格照新的。
 * 只有即位要改的,问的话和以前一样
 */
export function authorEditAsk(civ: Civ, ivs: readonly Intervention[], old: AuthorCharacter, next: AuthorCharacter, era: Era | undefined): CrownAsk | null {
  const crown = crownEditAsk(civ, ivs, old, next, era);
  const born = next.born !== old.born;
  const died = next.died !== old.died;
  const lean = JSON.stringify(characterLeanings(next)) !== JSON.stringify(characterLeanings(old));
  if (!born && !died && !lean) return crown;
  const base = crown ? crown.ivs : ivs.slice();
  const out: (Intervention | null)[] = base.slice();
  const changed: PostAt[] = [];
  const gone: PostAt[] = [];
  for (const p of postsIn(civ, old.id, base, era)) {
    const v = p.v;
    if (died && next.died !== undefined && next.died <= v.from) {
      out[p.at] = null;
      changed.push(p);
      gone.push(p);
      continue;
    }
    let w: PostIv = { ...v };
    if (born) w.born = next.born;
    if (died) {
      if (next.died !== undefined) w.died = next.died;
      else {
        const { died: _, ...rest } = w;
        w = rest as PostIv;
      }
    }
    if (lean && w.kind === 'regent') w.leanings = characterLeanings(next);
    if (JSON.stringify(w) === JSON.stringify(v)) continue;
    out[p.at] = w;
    changed.push(p);
  }
  if (!changed.length) return crown;
  const he = heOrShe(next);
  const name = next.name;
  const words = holdWords(!!crown, changed);
  const final = out.filter((x): x is Intervention => x !== null);
  const what: string[] = [];
  const goneWhat = gone.map((p) => (p.v.kind === 'regent' ? `掌${p.st.A}的权` : `${p.st.A}的${p.v.role === 'general' ? '将领' : '名臣'}`));
  if (died) what.push(next.died === undefined ? '卒年去掉了' : `卒年改成${spaced(yearAt(next.died, era))}${gone.length ? `，在${goneWhat.join('、')}那一任上任以前` : ''}`);
  if (born) what.push(`生年改成${spaced(yearAt(next.born, era))}`);
  if (lean && changed.some((p) => p.v.kind === 'regent')) what.push('性格改了');
  const posts = `${name}当过${changed.map((p) => postWhat(p, era)).join('、')}。`;
  return {
    title: `要一起改${he}的${words}吗？`,
    lead: crown ? `${crown.lead}${posts}` : `${posts}${what.join('，')}。`,
    yes: [gone.length ? `一起改：去掉${goneWhat.join('、')}那一任` : '一起改', `从${yearFull(redoFrom(ivs, final), era)}起重新推演；推演里${he}的${words}照新的${died ? '卒年' : born ? '生年' : '性格'}算`],
    no: ['只改人物卡', `推演里${he}的${words}照旧，和人物卡对不上`],
    ivs: final,
    done: `${name}的${words}跟着改了`,
  };
}

/**
 * 删人物:即位过、任过将相、掌过权的(推演里生效了的)先问 —— 连这些一起去掉(重新推演),还是只删人物(推演里那几任改叫"作者的人物",历史不变)。
 * 都没有 = null(直接删);只即位过的,问的话和以前一样(crownDeleteAsk)。去掉的时候没生效的那几条也一起去掉
 */
export function authorDeleteAsk(civ: Civ, ivs: readonly Intervention[], c: AuthorCharacter, era: Era | undefined): CrownAsk | null {
  const crown = crownDeleteAsk(civ, ivs, c, era);
  const posts = postsIn(civ, c.id, ivs, era);
  const done = posts.filter((p) => p.st.kind === 'done');
  if (!done.length) return crown;
  const he = heOrShe(c);
  const final = (crown ? crown.ivs : ivs).filter((v) => !posts.some((p) => p.v === v));
  const words = holdWords(!!crown, done);
  const As = [...new Set(done.map((p) => p.st.A))];
  return {
    title: `删除人物「${c.name}」`,
    lead: `${crown ? crown.lead : ''}${he}当过${done.map((p) => postWhat(p, era)).join('、')}。`,
    yes: [`连${he}的${words}一起去掉`, `从${yearFull(redoFrom(ivs, final), era)}起重新推演，${As.join('、')}照原来的历史走`],
    no: [`只删人物，${words}留着`, `推演里那几任改叫「${AUTHOR_RULER_DEFAULT}」，历史不变`],
    ivs: final,
    done: `已删除人物「${c.name}」和${he}的${words}`,
  };
}
