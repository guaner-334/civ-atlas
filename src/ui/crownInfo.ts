/**
 * 让作者的人物即位(干预"即位" crown,格式见 gen/edits.ts)在界面上的说法和状态(写到这个人物的"他 / 她"按人物卡上的性别):
 * 人物卡的「君位」一块(CharacterPanel.tsx)、让他即位那一页(CrownPage.tsx)、待推演的单子、「我的干预」、推完的提示条共用。
 *
 * 一条即位的说法:"林小满即有桑皇朝君位，1530 年退位"(填了退位年份)/ "……，到 1541 年卒"(到卒年)/ "林小满即有桑皇朝君位"(人物没写卒年:
 * 在位多久照寻常君主算)。人物卡上他的即位有四种样子:待推演 / 下一步生效(还在单子里)、生效了(推演里他当了君主)、没生效(写原因)。
 *
 * 改人物的生卒、性格,删人物时问的那一句(crownEditAsk / crownDeleteAsk,CrownAsk.tsx 弹出来):他的即位抄着生年、倾向、下台年份,
 * 人物卡改了,干预要不要跟着改(默认一起改 / 连即位一起去掉,重新推演)。
 */
import type { Civ, Person, Polity } from '../gen/civ/types';
import { dynastyTitle, polityAlive, polityName, polityShortTitle, polityTierAt, polityTitles } from '../gen/civ/growth';
import { ownersAt } from '../gen/civ/timeline';
import { peopleIndex, rulerAt } from '../gen/civ/story/peopleInfo';
import { royalAt } from '../gen/civ/regime';
import { personName } from '../gen/civ/story/peopleText';
import { heOrShe } from '../gen/civ/story/gender';
import { interventionFate } from '../gen/stepwise';
import { cleanIntervention, commandAt, resolveKey, ticksAt, type Intervention, type WorldEdits } from '../gen/edits';
import { AUTHOR_RULER_DEFAULT, characterLeanings, type AuthorCharacter } from '../gen/characters';
import { eraText, spaced, yearAt, yearFull, yearSpanAt, type Era } from '../gen/era';
import type { Pending } from './pendingStore';
import { KEEP_CROWN } from './keepInfo';

export type CrownIv = Extract<Intervention, { kind: 'crown' }>;

/** 另立一国、还没推演时,单子和人物卡上新国叫什么 */
export const NEW_POLITY = '新国';

/** 那一年的国名(那一年还没立国 / 已亡:立国时 / 亡国前的国号) */
function nameAt(p: Polity, year: number): string {
  const y = year < p.founded ? p.founded : p.ended !== undefined && year >= p.ended ? p.ended - 1 / 512 : year;
  return polityName(p, y) || p.name || '某国';
}

/** 一条即位的下台年份:until(没有 = 照寻常君主);abdicate = 作者填的退位年份 */
type CrownUntil = { until?: number; abdicate?: true };

/**
 * 这条即位是不是"到卒年":下台那年就是人物卡上的卒年,而且不是作者填的退位年份
 * (填了退位年份以后又把卒年改成同一年,照旧是"退位")
 */
export function crownToDeath(v: CrownUntil, died: number | undefined): boolean {
  return v.until !== undefined && died !== undefined && v.until === died && !v.abdicate;
}

/** 即位那一行的尾巴:"，1530 年退位" / "，到 1541 年卒" / ""(没给下台年份) */
export function crownTail(v: CrownUntil, died: number | undefined, era: Era | undefined): string {
  if (v.until === undefined) return '';
  return crownToDeath(v, died) ? `，到${spaced(yearAt(v.until, era))}卒` : `，${yearAt(v.until, era)}退位`;
}

/** 一条即位的说法:"林小满即有桑皇朝君位，1530 年退位";who = 人物的名字,A = 国名 */
export function crownLine(who: string, A: string, v: CrownUntil, died: number | undefined, era: Era | undefined): string {
  return `${who}即${A}君位${crownTail(v, died, era)}`;
}

/** 作者的人物叫什么:人物卡上的名字;人物删掉了 = 这份历史里记的(没有 = "作者的人物") */
export function crownWho(civ: Civ, char: number, chars: readonly AuthorCharacter[] | undefined): string {
  return chars?.find((c) => c.id === char)?.name || civ.authorNames?.[char] || AUTHOR_RULER_DEFAULT;
}

/** 那一年还在的国家(有国土的):大的在前;州数、那年在位的君主(共和国 = 执政) */
export interface AlivePolity {
  id: number;
  name: string;
  regions: number;
  ruler: string;
  /** 那一年没有王室、写"执政":海洋城邦共和一系,和改制以后的共和、军政府那些年(复辟以后照君主国) */
  republic: boolean;
}

export function alivePolities(civ: Civ, year: number): AlivePolity[] {
  const y = Math.min(civ.endYear, Math.max(0, year));
  const n = new Map<number, number>();
  for (const o of ownersAt(civ, y).polity) if (o >= 0) n.set(o, (n.get(o) ?? 0) + 1);
  return [...n.entries()]
    .filter(([id]) => polityAlive(civ.polities[id], y))
    .sort((a, b) => b[1] - a[1] || a[0] - b[0])
    .map(([id, regions]) => {
      const p = civ.polities[id];
      const r = rulerAt(civ, id, y);
      return { id, name: nameAt(p, y), regions, ruler: r ? personName(civ, r) : '', republic: !royalAt(p, y) };
    });
}

/**
 * 改朝换代以后新朝的称呼(和编年史"国号大辰"同一个说法):东方 = 国号简称("大辰";汗国写全称),eastern = true;
 * 西幻国名不变、只换王室 = "卡诺王朝",eastern = false。那一朝还没起名 = 空串
 */
export function newReignName(p: Polity, i: number): { name: string; eastern: boolean } {
  const d = p.dynasties?.[i];
  if (!d || !d.name) return { name: '', eastern: !!p.eastern };
  if (!p.eastern) return { name: dynastyTitle(p, i), eastern: false };
  const tier = Math.max(0, polityTierAt(p, d.year));
  return { name: p.lineage === 'khanate' ? polityTitles(p, d.year)[tier] : polityShortTitle(p, tier, d.year), eastern: true };
}

/** 人物卡上他的一条即位 */
export type CrownState =
  /** 还在单子里:待推演 / 下一步生效(逐年推演) */
  | { kind: 'queued'; v: CrownIv; step: boolean; A: string }
  /** 生效了:x = 推演里的他 */
  | { kind: 'done'; v: CrownIv; x: Person }
  /** 没生效:why = 原因;at = 在作者的干预列表里是第几条(去掉用;逐年推演里下的 = −1) */
  | { kind: 'void'; v: CrownIv; A: string; why: string; at: number };

/**
 * 人物 id 的即位:单子里的(待推演 / 下一步生效)和这份历史里推过的(生效了 / 没生效),按生效那一刻(年 + 第几格)先后,同一刻的照原来的先后。
 * ivs = 作者的干预列表(editsStore;"去掉这条即位"用);step = 在逐年推演;
 * tick = 逐年推演停在一年里的第几格(单子里的在下一步开头那一年的这一格生效;不在逐年推演、停在年初 = 0)
 */
export function characterCrowns(civ: Civ, id: number, pending: readonly Pending[], ivs: readonly unknown[], step: boolean, era: Era | undefined, tick = 0): CrownState[] {
  const out: CrownState[] = [];
  const done = civ.interventions ?? [];
  done.forEach((v, i) => {
    if (v.kind !== 'crown' || v.char !== id) return;
    const at = ivs.findIndex((x) => JSON.stringify(cleanIntervention(x)) === JSON.stringify(v));
    const f = interventionFate(civ, i);
    if (f.state === 'later') return;
    const e = f.annal >= 0 ? civ.annals[f.annal] : null;
    const A = e && e.a >= 0 && civ.polities[e.a] ? nameAt(civ.polities[e.a], v.from) : keyPolityName(civ, v.a, v.from);
    if (f.state === 'done' && e) {
      const x = peopleIndex(civ).rulers[e.a]?.find((r) => r.author === id && r.from === e.year);
      if (x) {
        out.push({ kind: 'done', v, x });
        return;
      }
    }
    out.push({ kind: 'void', v, A, why: voidWhy(civ, v, e, f.state === 'void' ? f.why : '没有生效', era), at });
  });
  for (const p of pending) {
    if (p.kind !== 'iv' || p.v.kind !== 'crown' || p.v.char !== id) continue;
    out.push({ kind: 'queued', v: p.v, step, A: keyPolityName(civ, p.v.a, p.v.from, NEW_POLITY) });
  }
  const at = (x: CrownState) => (x.kind === 'queued' && step ? ticksAt(x.v.from, tick) : commandAt(x.v));
  return out.sort((a, b) => at(a) - at(b));
}

/** 国家的稳定键 → 那一年的国名;这份历史里没有(另立的新国还没推演)= missing */
function keyPolityName(civ: Civ, key: string, year: number, missing = '（新历史里没有的国家）'): string {
  const k = resolveKey(civ, key);
  return k?.kind === 'polity' ? nameAt(civ.polities[k.id], year) : missing;
}

/** 没生效的原因(人物卡上的一段):"那一年奥利亚王国已经亡了（1762 年）" / "他第 1650 年才出生"…… */
function voidWhy(civ: Civ, v: CrownIv, e: Civ['annals'][number] | null, why: string, era: Era | undefined): string {
  if (e && e.b === -3 && civ.polities[e.a]?.ended !== undefined) {
    const p = civ.polities[e.a];
    return `那一年${nameAt(p, v.from)}已经亡了（${yearAt(Math.floor(p.ended!), era)}）`;
  }
  return eraText(why, era);
}

/** 推完的提示条:"林小满即有桑皇朝君位，1530 年退位" / 没生效 "苏晚没能即位：第 1790 年奥利亚王国已亡"(后面由调用方接"；已从……起重新推演") */
export function crownDoneText(civ: Civ, v: CrownIv, i: number, chars: readonly AuthorCharacter[] | undefined, era: Era | undefined): { ok: boolean; text: string } {
  const who = crownWho(civ, v.char, chars);
  const died = chars?.find((c) => c.id === v.char)?.died;
  const f = i >= 0 ? interventionFate(civ, i) : null;
  const e = f && f.state !== 'later' && f.annal >= 0 ? civ.annals[f.annal] : null;
  const A = e && e.a >= 0 && civ.polities[e.a] ? nameAt(civ.polities[e.a], v.from) : keyPolityName(civ, v.a, v.from);
  if (f?.state === 'void') {
    const why = f.why.startsWith('那一年') ? `第 ${v.from} 年${f.why.slice(3)}` : f.why;
    return { ok: false, text: `${who}没能即位：${eraText(why, era)}` };
  }
  // 在位期间保住王室的:"燕昭即大澜王朝君位，在位期间保住王室"(下台年份不再写)
  return { ok: true, text: v.keep ? `${who}即${A}君位，${KEEP_CROWN}` : crownLine(who, A, v, died, era) };
}

// ---------------------------------------------------------------------------
// 改人物、删人物时问一句

/** 他在作者的干预列表里的一条即位:at = 第几条,x = 推演里的他(没生效 = null),A = 那年的国名 */
interface CrownAt {
  at: number;
  v: CrownIv;
  x: Person | null;
  A: string;
}

/** 人物 id 在作者的干预列表 ivs 里的即位(这份历史里推过的;逐年推演里下的不在列表里,不算) */
function crownsIn(civ: Civ, id: number, ivs: readonly Intervention[], era: Era | undefined): CrownAt[] {
  return characterCrowns(civ, id, [], ivs, false, era).flatMap((st): CrownAt[] => {
    if (st.kind === 'queued') return [];
    const at = st.kind === 'void' ? st.at : ivs.findIndex((x) => JSON.stringify(cleanIntervention(x)) === JSON.stringify(st.v));
    const v = ivs[at];
    if (at < 0 || v?.kind !== 'crown') return [];
    return [{ at, v, x: st.kind === 'done' ? st.x : null, A: st.kind === 'done' ? nameAt(civ.polities[st.x.polity], st.v.from) : st.A }];
  });
}

/** 问的那一句:标题、一段说明、两个选项(各一行字 + 一行小字);选第一项以后的干预列表、推完提示条上的话 */
export interface CrownAsk {
  title: string;
  lead: string;
  yes: [string, string];
  no: [string, string];
  /** 选第一项(一起改 / 连即位一起去掉)以后作者的干预列表 */
  ivs: Intervention[];
  /** 推完的提示条:"林小满的即位跟着改了" */
  done: string;
}

/**
 * 编辑人物点「完成」:改了生年、卒年、性格,他的即位(抄着这几样)要不要一起改。没有要改的 = null(直接存)。
 *   卒年:到卒年的即位跟着到新的卒年;填了退位年份、比新卒年晚的改成到卒年下台;没写下台年份、推演里在位过了新卒年的也到卒年;
 *         卒年早到即位那年(或更早)的,这条即位去掉;卒年去掉了,到卒年的改回照寻常君主
 *   生年、性格:照新的抄进去
 */
export function crownEditAsk(civ: Civ, ivs: readonly Intervention[], old: AuthorCharacter, next: AuthorCharacter, era: Era | undefined): CrownAsk | null {
  const born = next.born !== old.born;
  const lean = JSON.stringify(characterLeanings(next)) !== JSON.stringify(characterLeanings(old));
  const died = next.died !== old.died;
  if (!born && !lean && !died) return null;
  const list = crownsIn(civ, old.id, ivs, era);
  const out: (Intervention | null)[] = ivs.slice();
  let first: CrownAt | null = null;
  let gone = false;
  let moved = false;
  for (const e of list) {
    const v = e.v;
    if (died && next.died !== undefined && next.died <= v.from) {
      out[e.at] = null;
      first ??= e;
      gone = true;
      continue;
    }
    let w: CrownIv = { ...v };
    if (born) w.born = next.born;
    if (lean) w.leanings = characterLeanings(next);
    if (died) {
      // 没写下台年份:推演里在位到哪年(还在位 = 一直;没生效 = 不管)
      const end = v.until ?? (e.x ? (e.x.until ?? Infinity) : undefined);
      const toDeath = crownToDeath(v, old.died);
      if (next.died !== undefined && (toDeath || (end !== undefined && end > next.died))) {
        const { abdicate: _, ...rest } = w;
        w = { ...rest, until: next.died };
      } else if (next.died === undefined && toDeath) {
        const { until: _, abdicate: __, ...rest } = w;
        w = rest;
      }
      if (w.until !== v.until) moved = true;
    }
    if (JSON.stringify(w) === JSON.stringify(v)) continue;
    out[e.at] = w;
    first ??= e;
  }
  if (!first) return null;
  const e = first;
  const name = next.name;
  const he = heOrShe(next);
  const from = Math.min(...list.filter((x) => out[x.at] !== x.v).map((x) => x.v.from));
  const lead = e.x
    ? `${name}当过${e.A}的君主（${yearAt(e.v.from, era)}即位${crownTail(e.v, old.died, era)}）。`
    : `${name}有一条即位没生效（${yearAt(e.v.from, era)}即${e.A}君位）。`;
  const what: string[] = [];
  if (died)
    what.push(
      next.died === undefined
        ? '卒年去掉了'
        : `卒年改成${spaced(yearAt(next.died, era))}${gone ? '，在即位那年之前' : e.v.until !== undefined && !crownToDeath(e.v, old.died) && next.died < e.v.until ? '，比退位那年早' : ''}`,
    );
  if (born) what.push(`生年改成${spaced(yearAt(next.born, era))}`);
  if (lean) what.push('性格改了');
  const redo = `从${yearFull(from, era)}起重新推演`;
  const yes: [string, string] = gone
    ? ['一起改：去掉这条即位', `${redo}，${e.A}照原来的历史走`]
    : moved
      ? [next.died !== undefined ? `一起改：到${spaced(yearAt(next.died, era))}卒时下台` : '一起改：在位多久照寻常君主算', `${redo}；之后照常有人继位`]
      : ['一起改', `${redo}；${born ? `推演里${he}的年纪跟着改` : `${he}在位时照新的性格行事`}`];
  const no: [string, string] = [
    '只改人物卡',
    gone || moved
      ? e.v.until !== undefined
        ? `推演里${he}照旧当到${spaced(yearAt(e.v.until, era))}，和卒年对不上`
        : `推演里${he}照旧在位，和卒年对不上`
      : born
        ? `推演里${he}的年纪照旧，和生年对不上`
        : `推演里${he}照旧按原来的性格行事`,
  ];
  return {
    title: `要一起改${he}的即位吗？`,
    lead: lead + what.join('，') + '。',
    yes,
    no,
    ivs: out.filter((x): x is Intervention => x !== null),
    done: gone ? `${name}的即位去掉了` : `${name}的即位跟着改了`,
  };
}

/**
 * 删人物:当过君主的(推演里即位了)先问 —— 连他的即位一起去掉(重新推演),还是只删人物(推演里那位君主改叫"作者的人物",历史不变)。
 * 没当过 = null(直接删);去掉的时候没生效的即位也一起去掉
 */
export function crownDeleteAsk(civ: Civ, ivs: readonly Intervention[], c: AuthorCharacter, era: Era | undefined): CrownAsk | null {
  const list = crownsIn(civ, c.id, ivs, era);
  const done = list.filter((e) => e.x);
  if (!done.length) return null;
  const span = (e: CrownAt) => {
    const f = e.x!.from ?? e.v.from;
    return e.x!.until !== undefined ? yearSpanAt(f, e.x!.until, era) : `${yearAt(f, era)}起`;
  };
  const As = [...new Set(done.map((e) => e.A))];
  const he = heOrShe(c);
  const lead = As.length === 1 ? `${he}当过${As[0]}的君主（${done.map(span).join('、')}）。` : `${he}当过${done.map((e) => `${e.A}（${span(e)}）`).join('、')}的君主。`;
  const drop = new Set(list.map((e) => e.at));
  const from = Math.min(...list.map((e) => e.v.from));
  return {
    title: `删除人物「${c.name}」`,
    lead,
    yes: [`连${he}的即位一起去掉`, `从${yearFull(from, era)}起重新推演，${As.join('、')}照原来的历史走`],
    no: ['只删人物，君位留着', `推演里那位君主改叫「${AUTHOR_RULER_DEFAULT}」，历史不变`],
    ivs: ivs.filter((_, i) => !drop.has(i)),
    done: `已删除人物「${c.name}」和${he}的即位`,
  };
}

/** 推完的提示条:一句话;undo = 提示条上的「撤销」(删人物连即位一起去掉的:人物、即位都放回去) */
export interface CrownResimNote {
  text: string;
  undo?: () => void;
}
/** 刚才因为问的那一句改了干预(App 推完据此写提示条;edits = 改了以后的修改,取一次就没了) */
let resimNote: (CrownResimNote & { edits: WorldEdits }) | null = null;
export function noteCrownResim(edits: WorldEdits, text: string, undo?: () => void) {
  resimNote = { edits, text, undo };
}
export function takeCrownResim(edits: WorldEdits): CrownResimNote | null {
  if (!resimNote || resimNote.edits !== edits) return null;
  const { text, undo } = resimNote;
  resimNote = null;
  return { text, undo };
}
