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
  resolveKey,
  ticksAt,
  type AppointSkill,
  type Intervention,
} from '../gen/edits';
import { eraText, spaced, yearAt, yearSpanAt, type Era } from '../gen/era';
import type { Pending } from './pendingStore';

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
