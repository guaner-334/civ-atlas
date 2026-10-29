/**
 * 作者的人物进推演的第二批入口(ui/lifeIv.ts、ui/lifeTag.ts、ui/authorIvInfo.ts;gen/edits.ts 的 author):
 * - 国家的事记在作者人物名下:干预带 author(只认那几种),推演不看它(历史逐条一样),编年史后面写"(林小满之议)"
 * - 照经历开的那一页:开着时下的令记在他名下(一条),没开起来 / 过了一会儿的不算
 * - 国家干预页宣战选谁挂帅:照推演派一条;选了他、还不是将领 = 先任将(到卒年、能力寻常)再宣战,推演里这一仗由他挂帅;已是将领 = 只宣战
 * - 「一生」每段下面的状态:按生效那一年对上;已进推演(为将写起止年份、为臣只写入了哪国的朝)/ 待推演 / 没生效写原因;他那年的国家
 * - 同一时刻只有一个身份:掌着别国的权时又任将相、任着别国的将相时又掌权,下令时拦下
 * - 改生卒、删人物时问一句扩到任将、任臣
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_PARAMS, generateWorld, type World } from '../src/gen/world';
import { generateCiv, type Civ } from '../src/gen/civ';
import { ownersAt } from '../src/gen/civ/timeline';
import { polityName } from '../src/gen/civ/growth';
import { buildChronicle, type ChronicleEntry } from '../src/gen/civ/chronicle';
import { authorPostsFrom } from '../src/gen/civ/appoint';
import { applyCharacters, type AuthorCharacter } from '../src/gen/characters';
import { AUTHOR_IV_KINDS, cleanIntervention, polityKey, type Intervention } from '../src/gen/edits';
import { authorDeleteAsk, authorEditAsk, characterPosts, holdsPost, leadOrders, overlapWhy, type AppointIv } from '../src/ui/authorIvInfo';
import { characterCrowns } from '../src/ui/crownInfo';
import { lifePolity, lifeStatusText, lifeStatuses } from '../src/ui/lifeIv';
import { getLifeTag, holdLifeTag, lifeTagFor, lifeTagUsed, setLifeTag, stampLife, type LifeTag } from '../src/ui/lifeTag';
import type { Pending } from '../src/ui/pendingStore';

const LEAN = { expand: 35, war: 25, develop: 70, trade: 60 };
const LIN: AuthorCharacter = { id: 1, name: '林小满', color: 'red', born: 2398, died: 2461 };
const SU: AuthorCharacter = { id: 2, name: '苏晚', color: 'purple', born: 2402, died: 2458, female: true };

describe('国家的事记在作者人物名下(干预的 author)', () => {
  it('只认结盟、立约、划中立地、迁都、划州、灭国、立国、方针、天灾、大迁徙(连同不许迁);别的种类、不合格的编号去掉', () => {
    expect([...AUTHOR_IV_KINDS].sort()).toEqual(['ally', 'cede', 'destroy', 'disaster', 'found', 'move', 'neutral', 'policy', 'stay', 'treaty', 'trek']);
    const ally = { kind: 'ally', a: 'polity:c1#0', b: 'polity:c2#0', from: 1500, author: 3 };
    expect(cleanIntervention(ally)).toBe(ally);
    expect(cleanIntervention({ ...ally, author: 0 })).toEqual({ kind: 'ally', a: 'polity:c1#0', b: 'polity:c2#0', from: 1500 });
    expect(cleanIntervention({ ...ally, author: 1.5 })).not.toHaveProperty('author');
    expect(cleanIntervention({ kind: 'protect', a: 'polity:c1#0', from: 1500, author: 3 })).toEqual({ kind: 'protect', a: 'polity:c1#0', from: 1500 });
    expect(cleanIntervention({ kind: 'declare', a: 'polity:c1#0', b: 'polity:c2#0', from: 1500, author: 3 })).not.toHaveProperty('author');
  });
});

describe('照经历开的那一页(lifeTag.ts)', () => {
  const t: LifeTag = { char: 1, name: '林小满', he: '他', year: 2421, text: '为大衍将，伐后东定国', kind: 'ally', polity: 7, at: Date.now() };
  const ally: Intervention = { kind: 'ally', a: 'polity:c1#0', b: 'polity:c2#0', from: 2421 };
  it('那一页开着时下的令记在他名下(一条),单子上的话后面加"（林小满之议）";没开起来的不算', () => {
    setLifeTag(t);
    // 点了、那一页还没开起来:不记
    expect(stampLife(ally, '大衍王朝与新特利亚国结盟')).toBeNull();
    const release = holdLifeTag(t);
    expect(stampLife(ally, '大衍王朝与新特利亚国结盟')).toEqual({ v: { ...ally, author: 1 }, text: '大衍王朝与新特利亚国结盟（林小满之议）' });
    // 别的种类(保护、宣战)不记;已经带着的不再记
    expect(stampLife({ kind: 'protect', a: 'polity:c1#0', from: 2421 }, '大衍王朝:保护')).toBeNull();
    expect(stampLife({ ...ally, author: 2 }, 'x')).toBeNull();
    // 加进单子了:用掉,之后的照普通的
    lifeTagUsed();
    expect(getLifeTag()).toBeNull();
    expect(stampLife(ally, 'x')).toBeNull();
    release();
  });
  it('对得上种类、国家 / 州才算那一页;点了以后过了一会儿还没开起来的不算', () => {
    expect(lifeTagFor(t, ['ally', 'move'], { polity: 7 })).toBe(t);
    expect(lifeTagFor(t, ['ally', 'move'], { polity: 8 })).toBeNull();
    expect(lifeTagFor(t, ['policy'], { polity: 7 })).toBeNull();
    expect(lifeTagFor({ ...t, kind: undefined }, ['ally'], { polity: 7 })).toBeNull();
    expect(lifeTagFor({ ...t, at: Date.now() - 60_000 }, ['ally'], { polity: 7 })).toBeNull();
    expect(lifeTagFor({ ...t, kind: 'found', polity: undefined, region: 12 }, ['found'], { region: 12 })).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 种子 7(同稿子):第 2421 年国土最大的国家

const seed = 7;
const T = 2421;
let w: World | null = null;
let b: Civ | null = null;
const world = () => (w ??= generateWorld({ ...DEFAULT_PARAMS, seed }));
const base = () => (b ??= generateCiv(world()));
let pidMemo: number | null = null;
const pid = (): number => {
  if (pidMemo !== null) return pidMemo;
  const civ = base();
  const n = new Map<number, number>();
  for (const p of ownersAt(civ, T).polity) if (p >= 0) n.set(p, (n.get(p) ?? 0) + 1);
  const ok = [...n.entries()].filter(([id]) => {
    const P = civ.polities[id];
    return P.eastern && P.lineage !== 'republic' && P.founded < T - 50 && (P.ended ?? Infinity) > T + 30;
  });
  return (pidMemo = ok.sort((a, b) => b[1] - a[1])[0][0]);
};
/** 第 y 年和 p 接壤的国家 */
const nearOf = (civ: Civ, p: number, y: number): number[] => {
  const own = ownersAt(civ, y).polity;
  const reg = civ.regions;
  const out = new Set<number>();
  for (let r = 0; r < reg.count; r++) {
    if (own[r] !== p) continue;
    for (let k = reg.adjStart[r]; k < reg.adjStart[r + 1]; k++) {
      const q = own[reg.adj[k]];
      if (q >= 0 && q !== p) out.add(q);
    }
  }
  return [...out].sort((a, b) => a - b);
};
const flat = (es: ChronicleEntry[]): ChronicleEntry[] => es.flatMap((e) => [e, ...flat(e.children ?? [])]);

describe(`推演里(种子 ${seed})`, () => {
  it('记在他名下的结盟:历史和不记的一样,编年史那一条后面写"(林小满之议)"', { timeout: 120_000 }, () => {
    const civ0 = base();
    const P = pid();
    const Q = nearOf(civ0, P, T)[0];
    const ally: Intervention = { kind: 'ally', a: polityKey(civ0, P), b: polityKey(civ0, Q), from: T };
    const plain = generateCiv(world(), { interventions: [ally] });
    const mine = generateCiv(world(), { interventions: [{ ...ally, author: 1 }] });
    expect(JSON.stringify(mine.annals)).toBe(JSON.stringify(plain.annals));
    expect(JSON.stringify(mine.polities)).toBe(JSON.stringify(plain.polities));
    const text = (c: Civ) => flat(buildChronicle(c)).find((e) => e.kind === 'intervene' && e.year === T)!.text;
    expect(text(applyCharacters(mine, [LIN]))).toBe(`${text(plain)}(林小满之议)`);
    expect(text(applyCharacters(plain, [LIN]))).not.toContain('之议');
  });

  it('宣战选谁挂帅:照推演派一条;还不是将领 = 先任将(到卒年、能力寻常)再宣战,推演里这一仗由他挂帅;已是将领 = 只宣战', { timeout: 120_000 }, () => {
    const civ0 = base();
    const P = pid();
    const a = polityKey(civ0, P);
    // 那年不在打的接壤邻国
    const busy = new Set(civ0.annals.filter((e) => e.kind === 'war' && e.year <= T && (e.a === P || e.b === P)).map((e) => (e.a === P ? e.b : e.a)));
    const Q = nearOf(civ0, P, T).find((q) => !busy.has(q)) ?? nearOf(civ0, P, T)[0];
    const bk = polityKey(civ0, Q);
    expect(leadOrders(a, bk, T, null, false)).toEqual({ appoint: null, declare: { kind: 'declare', a, b: bk, from: T } });
    expect(leadOrders(a, bk, T, LIN, true)).toEqual({ appoint: null, declare: { kind: 'declare', a, b: bk, from: T, lead: 1 } });
    const { appoint, declare } = leadOrders(a, bk, T, LIN, false);
    expect(appoint).toEqual({ kind: 'appoint', a, char: 1, role: 'general', born: 2398, died: 2461, from: T });
    expect(declare).toEqual({ kind: 'declare', a, b: bk, from: T, lead: 1 });
    // 推演里:任将生效、这一仗(派他出征)由他挂帅
    const civ = applyCharacters(generateCiv(world(), { interventions: [appoint!, declare] }), [LIN]);
    const war = civ.annals.find((e) => e.kind === 'war' && e.year === T && e.a === P && e.b === Q);
    expect(war).toBeDefined();
    const post = authorPostsFrom(civ).find((p) => p.iv === 0)!;
    expect(post).toMatchObject({ char: 1, role: 'general', polity: P, from: T });
    expect(post.skip).toBeUndefined();
    expect(post.wars.find((x) => x.war === war!.war)?.sent).toBe(true);
    // 人物卡上他这一任生效了,那年已是这国将领
    const posts = characterPosts(civ, 1, [], [appoint!, declare], false, undefined);
    expect(posts.map((s) => s.kind)).toEqual(['done']);
    expect(holdsPost(civ, posts, 'general', P, T + 1, T + 1)).toBe(true);
    expect(holdsPost(civ, posts, 'minister', P, T + 1, T + 1)).toBe(false);
    expect(holdsPost(civ, posts, 'general', Q, T + 1, T + 1)).toBe(false);
  });

  it('「一生」每段下面的状态、他那年的国家;同一时刻只有一个身份;改生卒、删人物时问一句', { timeout: 120_000 }, () => {
    const civ0 = base();
    const P = pid();
    const a = polityKey(civ0, P);
    const Q = nearOf(civ0, P, T)[0];
    const gv: AppointIv = { kind: 'appoint', a, char: 1, role: 'general', born: 2398, died: 2461, from: T, until: T + 21 };
    const mv: AppointIv = { kind: 'appoint', a, char: 1, role: 'minister', born: 2398, died: 2461, from: T + 21 };
    const ally: Intervention = { kind: 'ally', a, b: polityKey(civ0, Q), from: T + 5, author: 1 };
    const rv: Intervention = { kind: 'regent', a, char: 2, born: 2402, died: 2458, from: T + 15, how: 'chancellor', end: 'return', years: 5, leanings: LEAN };
    const ivs = [gv, mv, ally, rv];
    const civ = applyCharacters(generateCiv(world(), { interventions: ivs }), [LIN, SU]);
    const A = polityName(civ.polities[P], T);
    // 单子里还有一条记在他名下的迁都(第 T + 30 年)
    const move: Pending = { id: 9, from: T + 30, text: `${A}迁都某城（林小满之议）`, kind: 'iv', v: { kind: 'move', a, city: 'settlement:c1#0', from: T + 30, author: 1 } };
    const crowns = characterCrowns(civ, 1, [move], ivs, false, undefined);
    const posts = characterPosts(civ, 1, [move], ivs, false, undefined);
    const st = lifeStatuses(civ, 1, '林小满', [move], crowns, posts, false, undefined, (v) => (v.kind === 'ally' ? '结盟那一条' : '别的'));
    const gx = posts.find((s) => s.kind === 'done' && s.v === gv);
    expect(gx?.kind).toBe('done');
    const until = gx?.kind === 'done' ? gx.x.until : undefined;
    expect(st.get(T)?.map(lifeStatusText)).toEqual([`已进推演：林小满为${A}将，${T}–${until} 年`]);
    expect(st.get(T + 21)?.map(lifeStatusText)).toEqual([`已进推演：林小满入${polityName(civ.polities[P], T + 21)}为臣`]);
    expect(st.get(T + 5)?.map(lifeStatusText)).toEqual(['已进推演：结盟那一条']);
    expect(st.get(T + 30)?.map(lifeStatusText)).toEqual([`待推演：${A}迁都某城（林小满之议）`]);
    expect(lifeStatuses(civ, 1, '林小满', [move], crowns, posts, true, undefined, () => '').get(T + 30)?.map(lifeStatusText)[0]).toMatch(/^下一步生效：/);
    // 苏晚的掌权在她名下;林小满的不算进她名下
    const su = lifeStatuses(civ, 2, '苏晚', [], [], characterPosts(civ, 2, [], ivs, false, undefined), false, undefined, () => '');
    expect([...su.keys()]).toEqual([T + 15]);
    expect(su.get(T + 15)![0].text).toMatch(new RegExp(`^苏晚以大臣专权掌${A}国政，${T + 15}–\\d+ 年$`));
    // 他那年的国家:在任的那国;不在任时照人物卡上的(那年还在才算)
    expect(lifePolity(civ, crowns, posts, -1, T + 3)).toBe(P);
    expect(lifePolity(civ, crowns, posts, Q, T - 10)).toBe(civ.polities[Q].ended === undefined || civ.polities[Q].ended! > T - 10 ? Q : -1);
    expect(lifePolity(civ, crowns, posts, -1, T - 10)).toBe(-1);

    // 同一时刻只有一个身份:她掌着权那几年,任她为别国将领 / 名臣拦下;同一国的不拦(大臣专权);他任着将领那几年,让他掌别国的权拦下
    const suPosts = characterPosts(civ, 2, [], ivs, false, undefined);
    expect(overlapWhy(civ, suPosts, 'general', Q, T + 16, T + 16, '她', undefined)).toMatch(new RegExp(`^她 ${T + 15}–\\d+ 年掌${A}国政，同一时刻只有一个身份$`));
    expect(overlapWhy(civ, suPosts, 'minister', Q, T + 16, T + 16, '她', undefined)).not.toBeNull();
    expect(overlapWhy(civ, suPosts, 'general', P, T + 16, T + 16, '她', undefined)).toBeNull();
    expect(overlapWhy(civ, suPosts, 'general', Q, T + 40, T + 40, '她', undefined)).toBeNull();
    expect(overlapWhy(civ, posts, 'regent', Q, T + 3, T + 3, '他', undefined)).toMatch(new RegExp(`^他 ${T}–\\d+ 年是${A}的将领，同一时刻只有一个身份$`));
    expect(overlapWhy(civ, posts, 'regent', P, T + 3, T + 3, '他', undefined)).toBeNull();
    // 单子里的也算:单子里任她为别国将领、又让她掌那国以外的权
    const qg: Pending = { id: 3, from: T + 50, text: '', kind: 'iv', v: { kind: 'appoint', a: polityKey(civ, Q), char: 2, role: 'general', born: 2402, died: 2458, from: T + 30 } };
    expect(overlapWhy(civ, characterPosts(civ, 2, [qg], ivs, false, undefined), 'regent', P, T + 31, T + 31, '她', undefined)).toContain('的将领，同一时刻只有一个身份');

    // 删人物:当过将相的先问一句,连任职一起去掉 / 只删人物
    const del = authorDeleteAsk(civ, ivs, LIN, undefined)!;
    expect(del.title).toBe('删除人物「林小满」');
    expect(del.lead).toMatch(new RegExp(`^他当过${A}的将领（${T}–\\d+ 年）、.+的名臣（${T + 21}`));
    expect(del.yes[0]).toBe('连他的任职一起去掉');
    expect(del.no[0]).toBe('只删人物，任职留着');
    expect(del.ivs).toEqual([ally, rv]);
    expect(del.yes[1]).toMatch(new RegExp(`^从第 ${T} 年起重新推演`));
    const suDel = authorDeleteAsk(civ, ivs, SU, undefined)!;
    expect(suDel.yes[0]).toBe('连她的掌权一起去掉');
    expect(suDel.ivs).toEqual([gv, mv, ally]);
    // 改卒年:早到入朝那年以前 —— 为臣那一任去掉,为将那一任照新卒年;改名字不问
    const ed = authorEditAsk(civ, ivs, LIN, { ...LIN, died: T + 19 }, undefined)!;
    expect(ed.title).toBe('要一起改他的任职吗？');
    expect(ed.ivs).toEqual([{ ...gv, died: T + 19 }, ally, rv]);
    expect(ed.lead).toContain(`卒年改成 ${T + 19} 年，在`);
    expect(ed.yes[0]).toMatch(/^一起改：去掉.+的名臣那一任$/);
    expect(authorEditAsk(civ, ivs, LIN, { ...LIN, name: '林大满' }, undefined)).toBeNull();
    // 掌权抄着性格:改了性格要问
    const lean = authorEditAsk(civ, ivs, SU, { ...SU, leanings: { expand: 90, war: 90, develop: 10, trade: 10 } }, undefined)!;
    expect(lean.title).toBe('要一起改她的掌权吗？');
    expect(lean.ivs[3]).toMatchObject({ kind: 'regent', leanings: { expand: 90, war: 90, develop: 10, trade: 10 } });
  });
});
