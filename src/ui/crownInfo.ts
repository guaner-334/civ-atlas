/**
 * 让作者的人物即位(干预"即位" crown,格式见 gen/edits.ts)在界面上的说法和状态:
 * 人物卡的「君位」一块(CharacterPanel.tsx)、让他即位那一页(CrownPage.tsx)、待推演的单子、「我的干预」、推完的提示条共用。
 *
 * 一条即位的说法:"林小满即有桑皇朝君位，1530 年退位"(填了退位年份)/ "……，到 1541 年卒"(到卒年)/ "林小满即有桑皇朝君位"(人物没写卒年:
 * 在位多久照寻常君主算)。人物卡上他的即位有四种样子:待推演 / 下一步生效(还在单子里)、生效了(推演里他当了君主)、没生效(写原因)。
 */
import type { Civ, Person, Polity } from '../gen/civ/types';
import { dynastyTitle, polityAlive, polityName, polityShortTitle, polityTierAt, polityTitles } from '../gen/civ/growth';
import { ownersAt } from '../gen/civ/timeline';
import { peopleIndex, rulerAt } from '../gen/civ/peopleInfo';
import { personName } from '../gen/civ/peopleText';
import { interventionFate } from '../gen/stepwise';
import { cleanIntervention, resolveKey, type Intervention } from '../gen/edits';
import { AUTHOR_RULER_DEFAULT, type AuthorCharacter } from '../gen/characters';
import { eraText, spaced, yearAt, type Era } from '../gen/era';
import type { Pending } from './pendingStore';

export type CrownIv = Extract<Intervention, { kind: 'crown' }>;

/** 另立一国、还没推演时,单子和人物卡上新国叫什么 */
export const NEW_POLITY = '新国';

/** 那一年的国名(那一年还没立国 / 已亡:立国时 / 亡国前的国号) */
function nameAt(p: Polity, year: number): string {
  const y = year < p.founded ? p.founded : p.ended !== undefined && year >= p.ended ? p.ended - 1 / 512 : year;
  return polityName(p, y) || p.name || '某国';
}

/** 即位那一行的尾巴:"，1530 年退位" / "，到 1541 年卒" / ""(没给下台年份) */
export function crownTail(until: number | undefined, died: number | undefined, era: Era | undefined): string {
  if (until === undefined) return '';
  return died !== undefined && until === died ? `，到${spaced(yearAt(until, era))}卒` : `，${yearAt(until, era)}退位`;
}

/** 一条即位的说法:"林小满即有桑皇朝君位，1530 年退位";who = 人物的名字,A = 国名 */
export function crownLine(who: string, A: string, until: number | undefined, died: number | undefined, era: Era | undefined): string {
  return `${who}即${A}君位${crownTail(until, died, era)}`;
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
      return { id, name: nameAt(p, y), regions, ruler: r ? personName(civ, r) : '', republic: p.lineage === 'republic' };
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
 * 人物 id 的即位:单子里的(待推演 / 下一步生效)和这份历史里推过的(生效了 / 没生效),按生效年份先后。
 * ivs = 作者的干预列表(editsStore;"去掉这条即位"用);step = 在逐年推演
 */
export function characterCrowns(civ: Civ, id: number, pending: readonly Pending[], ivs: readonly unknown[], step: boolean, era: Era | undefined): CrownState[] {
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
  return out.sort((a, b) => a.v.from - b.v.from);
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
  return { ok: true, text: crownLine(who, A, v.until, died, era) };
}
