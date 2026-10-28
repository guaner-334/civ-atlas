/**
 * AI 写列传、家传的提示词:把一个人、王室的一朝整理成"材料",连同写作要求交给 AI。
 * 写、存、阅读和写史书是同一套(ai/history.ts、ui/bookStore.ts):同一时间只写一部,被内容审核拦下自动带"克制"重写一次,
 * 写完扫现实里的词,存进本地的 AI 笔记;这里只管"写谁、给 AI 什么材料、提什么要求"。
 *
 * - 列传 · 推演里的人(person):人物卡上的事(概况一行一项、倾向、生平、君主的治绩)、他领兵打过的每一仗(谁攻、谁守、结果)、
 *   他在位 / 在朝 / 领兵时本国的事(连同掌权、联姻、放逐那几条)、材料里写到的人的生卒年。约 2000 字
 * - 列传 · 作者的人物(character):作者写的身份、生卒、国家、出生地、简介、亲友、每段经历,和经历里勾上的推演里的事与人。
 *   作者写的一个字不改,也不替作者添设定
 * - 家传(house):王室的一朝,从开国写到亡(或至今)。世系、每位君主怎么即位、争储、联姻、掌权摄政、放逐出奔、结局,
 *   这一朝里牵动这一家人的事;和国史的"本纪"错开 —— 写一家人,不写一国的兴衰。约 3000 字
 * - 材料少的(没什么事的宗室、只写了名字的人物、两三代就亡的一朝)按事的多少封顶篇幅,不让 AI 硬凑
 *
 * 人物卡那几行按卡片的算法写(ui/PersonPanel.tsx),作者人物的地名要地图才算得出:这两样由界面层组好,
 * 经 LifeSource 交进来(ui/lifeSource.ts)。这里是纯函数:不碰 DOM、不调 AI,同样的输入永远得到同样的文字。
 *
 * 和写史书合在一处的入口(bookPrompts、bookStoreScope……):"写什么"是一国一段历史的走 history.ts,是一个人、一朝的走这里
 */
import type { Civ, Person, Year } from '../../gen/civ/types';
import { buildChronicle, cnNumber, entryYearLabel, filterChronicle, reignEntries, type ChronicleEntry } from '../../gen/civ/chronicle';
import { polityName } from '../../gen/civ/growth';
import { personName, personRoleShort, splitSurname } from '../../gen/civ/peopleText';
import { riseText, rulerNeighbors } from '../../gen/civ/peopleInfo';
import { heldOver } from '../../gen/civ/regentInfo';
import { reignRecord } from '../../gen/civ/reignRecord';
import { dynastyEnd, dynastyLines, dynastyMembers, dynastyNote, dynastyRows, fatherOf, kidsOf, secededFrom, type DynastyRow } from '../../gen/civ/lineageInfo';
import { personNamers } from '../../gen/civ/naming';
import { personKey, polityKey, resolveKey, resolvePersonKey } from '../../gen/edits';
import {
  HISTORY_LENGTHS,
  HISTORY_STYLES,
  SERVE_AGE,
  SYSTEM_PROMPT,
  TONE,
  VERDICT_RULE,
  battleLines,
  buildHistoryPrompts,
  estimateTokens,
  hash,
  historyFingerprint,
  historyNoteKey,
  lengthLine,
  loadScope,
  storeScope,
  type HistoryLength,
  type HistoryOptions,
  type HistoryPrompts,
  type HistoryScope,
  type HistoryStyle,
  type StoredScope,
} from './history';

// ---------------------------------------------------------------------------
// 写什么

/** 列传(推演里的人 / 作者的人物)、家传(一国的第几朝:Polity.dynasties 的下标) */
export type LifeScope = { kind: 'person'; person: number } | { kind: 'character'; char: number } | { kind: 'house'; polity: number; dynasty: number };
/** 成书能写的:一国一段历史(史书)或一个人、一朝(列传、家传) */
export type BookScope = HistoryScope | LifeScope;

export interface BookOptions {
  scope: BookScope;
  style: HistoryStyle;
  length: HistoryLength;
}
export type LifeOptions = BookOptions & { scope: LifeScope };

/** 存档里记的:推演里的人按稳定键记(改地形重推后编号变了也找得到),作者的人物按人物编号,一朝按国家的稳定键 + 第几朝 */
export type LifeStoredScope =
  | { kind: 'person'; key: string; name: string }
  | { kind: 'character'; id: number; name: string }
  | { kind: 'house'; key: string; dynasty: number; name: string };
export type BookStoredScope = StoredScope | LifeStoredScope;

/** 列传、家传的文体:史书体 / 白话讲述 / 传说故事(写史书的那三种是一国一段的写法:纪传、编年不适合一个人) */
export const LIFE_STYLES: readonly HistoryStyle[] = ['classic', 'plain', 'legend'];
/** 篇幅:列传约 2000 字、家传约 3000 字(只有这一档) */
export const LIFE_LENGTH: HistoryLength = 'medium';
export const HOUSE_LENGTH: HistoryLength = 'k3';

export function isLifeScope(s: { kind: string }): s is LifeScope | LifeStoredScope {
  return s.kind === 'person' || s.kind === 'character' || s.kind === 'house';
}

/** 这一种要写多长 */
export function lifeLength(s: { kind: string }): HistoryLength {
  return s.kind === 'house' ? HOUSE_LENGTH : LIFE_LENGTH;
}

/** "列传" / "家传" */
export function lifeKind(s: { kind: string }): string {
  return s.kind === 'house' ? '家传' : '列传';
}

// ---------------------------------------------------------------------------
// 界面层交进来的(人物卡那几行、作者的人物)

/** 人物卡概况的一行:"在位"、"2325–2354 年，29 年" */
export interface CardLine {
  k: string;
  text: string;
}

/** 推演里的人的卡片(ui/PersonPanel.tsx 的 personCard):年份照推演写("2325–2354 年"),不按纪年 */
export interface PersonCard {
  lines: CardLine[];
  /** 倾向一句(君主、执政官);没有 = '' */
  leanings: string;
  /** 生平一段(将领、名臣);没有 = '' */
  bio: string;
  /** 他在位 / 在朝 / 领兵时本国的事,连同掌权、联姻、放逐那几条(按先后) */
  events: ChronicleEntry[];
}

/** 作者的人物(ui/lifeSource.ts 照人物卡组好):作者写的原样,地方写成地名,勾上的事与人找出来 */
export interface CharacterCard {
  name: string;
  born: number;
  died?: number;
  /** 身份("女史");没写 = '' */
  role: string;
  /** 国家(写了的,或出生地在生年归属的国家);没有 = '' */
  polity: string;
  /** 出生地("落烟渡（紫月洲）");没写 = '' */
  birthplace: string;
  /** 简介(作者写的,可以有换行) */
  note: string;
  /** 亲友:关系、名字;推演里的人带 Person.id */
  kin: { rel: string; name: string; person?: number }[];
  /** 一生(按年份):经历、在哪,勾上的推演里的事、人 */
  life: { year: number; text: string; where: string; events: ChronicleEntry[]; people: number[] }[];
}

export interface LifeSource {
  person(id: number): PersonCard | null;
  character(id: number): CharacterCard | null;
}

// ---------------------------------------------------------------------------
// 小工具

const Y = (y: Year) => Math.floor(y);
const len = (s: string) => s.replace(/\s/g, '').length;
/** 列传材料最多列几个相关的人 / 家传最多列几位没即位的宗室 */
const LIFE_PEOPLE = 14;
const HOUSE_PRINCES = 16;
/** 列传、家传材料里"本国的事"那一节最多多少字 */
const LIFE_EVENT_BUDGET = 4200;
const HOUSE_EVENT_BUDGET = 4200;
/** 列传领兵的仗最多列几行 */
const LIFE_BATTLES = 16;

function entryLine(e: ChronicleEntry): string {
  return `- ${e.importance >= 3 ? '★' : ''}${entryYearLabel(e)} ${e.text}`;
}

/** 在 budget 字以内挑纪事:先挑分量重的(score 高、大事),同分按先后;挑中的按年份排回去 */
function pickEvents(entries: readonly ChronicleEntry[], budget: number, score: (e: ChronicleEntry) => number = () => 0): { lines: string[]; dropped: number } {
  const order = entries.map((e, i) => ({ e, i, s: score(e) * 10 + e.importance })).sort((a, b) => b.s - a.s || a.i - b.i);
  const keep = new Set<number>();
  let used = 0;
  for (const { e, i } of order) {
    const n = len(entryLine(e));
    if (used + n > budget) continue;
    used += n;
    keep.add(i);
  }
  const lines = entries.filter((_, i) => keep.has(i)).map(entryLine);
  return { lines, dropped: entries.length - lines.length };
}

/** 〔人物〕里的一行:"- 惠宗苏鸾(大衍君主):生于第 2330 年,卒于第 2372 年;第 2354—2372 年在位" */
function personFacts(civ: Civ, x: Person): string {
  const end = Y(civ.endYear);
  const life = x.died !== undefined ? `生于第 ${Y(x.born)} 年,卒于第 ${Y(x.died)} 年` : `生于第 ${Y(x.born)} 年,到第 ${end} 年还在世`;
  const reign = x.role === 'ruler' && x.from !== undefined ? `;第 ${Y(x.from)}—${x.until !== undefined ? Y(x.until) : end} 年在位` : '';
  return `- ${personName(civ, x)}(${personRoleShort(civ, x)}):${life}${reign}`;
}

/** 本国的纪事(战争拆成一件一件)+ 历代继位,按先后(和人物卡「在位时」同一份) */
function polityEntries(civ: Civ, polity: number): ChronicleEntry[] {
  const out: ChronicleEntry[] = [];
  const seen = new Set<string>();
  const add = (e: ChronicleEntry) => {
    const k = `${e.kind}:${e.id}`;
    if (seen.has(k)) return;
    seen.add(k);
    out.push(e);
  };
  for (const e of filterChronicle(buildChronicle(civ), { polity })) {
    if (e.children?.length) e.children.forEach(add);
    else add(e);
  }
  filterChronicle(reignEntries(civ), { polity }).forEach(add);
  return out.sort((a, b) => a.year - b.year || a.id - b.id);
}

/** 事少的写不了那么长:按"事"的条数封顶(取整到百字,不少于 floor) */
function capChars(target: number, facts: number, base: number, per: number, floor: number): number {
  return Math.max(floor, Math.min(target, Math.round((base + per * facts) / 100) * 100));
}

// ---------------------------------------------------------------------------
// 书名、选项上的字

function personOf(civ: Civ, id: number): Person | null {
  const x = civ.people?.[id];
  return x && civ.polities[x.polity] ? x : null;
}

/** 一朝在 dynastyRows 里是第几行(没有 = −1) */
function rowOf(civ: Civ, polity: number, dynasty: number): { rows: DynastyRow[]; i: number } {
  const rows = civ.polities[polity] ? dynastyRows(civ, polity) : [];
  return { rows, i: rows.findIndex((r) => r.index === dynasty) };
}

/** 一朝王室的叫法:东方"衍朝苏氏"(中式起名、君主有姓)/"衍朝王室";西幻"卡诺王室"、汗国"某某汗室" */
export function houseName(civ: Civ, polity: number, dynasty: number): string {
  const p = civ.polities[polity];
  const { rows, i } = rowOf(civ, polity, dynasty);
  if (!p || i < 0) return '';
  const row = rows[i];
  const root = p.dynasties?.[dynasty]?.name || p.name;
  const first = row.rulers.find((x) => !!x.name) ?? row.rulers[0];
  if (p.eastern) {
    const surnamed = !!first && /^[一-鿿]{2,4}$/.test(first.name) && personNamers(civ.seed)(civ.cultures[p.culture]?.style || 'kingdom').surnamed;
    return `${root}朝${surnamed ? `${splitSurname(first.name)}氏` : '王室'}`;
  }
  return `${root}${p.lineage === 'khanate' ? '汗室' : '王室'}`;
}

/** 书名(不带书名号):"世祖苏珩羽传"、"沈青禾传"、"衍朝苏氏家传";找不到 = '' */
export function lifeTitle(civ: Civ, scope: LifeScope, src?: LifeSource | null): string {
  if (scope.kind === 'person') {
    const x = personOf(civ, scope.person);
    const n = x ? personName(civ, x) : '';
    return n ? `${n}传` : '';
  }
  if (scope.kind === 'character') {
    const c = src?.character(scope.char);
    return c?.name ? `${c.name}传` : '';
  }
  const h = houseName(civ, scope.polity, scope.dynasty);
  return h ? `${h}家传` : '';
}

/** "写什么"那一排上的字:"世祖苏珩羽列传"、"衍朝苏氏家传" */
export function lifeOptionLabel(civ: Civ, scope: LifeScope, src?: LifeSource | null): string {
  const t = lifeTitle(civ, scope, src);
  return scope.kind === 'house' || !t ? t : `${t.slice(0, -1)}列传`;
}

// ---------------------------------------------------------------------------
// 提示词

const LIFE_SYSTEM = SYSTEM_PROMPT.replace(
  /^[^\n]*/,
  '你是一位擅长写架空历史的中文作家,正在为一部奇幻世界的设定集撰写人物传记。这个世界的历史由推演程序生成,用户会给你「材料」:传主(或一家人)的生平、经历的事和相关的人。',
).replace('不写全书的书名', '不写传名(标题另有),不分章、不加小标题');

/** 各文体在列传、家传里的写法(what = "列传" / "家传") */
function lifeRule(style: HistoryStyle, what: string): string {
  if (style === 'plain')
    return `用现代汉语,像一篇写给普通读者的${what === '家传' ? '家族史' : '人物传记'}:讲清来龙去脉和前因后果,节奏明快,可以有少量生动的细节和人物言行;不用文言腔,也不要写成干巴巴的年表;少写景、少抒情,不用网络流行语和现代术语。`;
  if (style === 'legend')
    return '像世代口耳相传的传说,由说书人讲给听众:口语化,句子短,有画面;可以有预兆、梦兆、歌谣和传奇色彩,可以用"相传""据说"引出夸张的细节,但不要堆砌辞藻和比喻;生卒、即位、胜负、结局必须和材料一致。';
  return (
    `用浅近的文言写(半文半白,读者不查字典也能读懂),仿正史${what === '家传' ? '世家' : '列传'}的笔法:先写${what === '家传' ? '这一家的来历' : '名字、出身'},再按年叙事,写到结局;行文简练庄重,少用形容词。` +
    `篇末可以有一段"史臣曰",一两句,评${what === '家传' ? '这一家' : '这一生'}的得失,不要空谈"合久必分"之类的套话。` +
    VERDICT_RULE
  );
}

/** 一次写完的一篇 */
function lifePrompts(opts: LifeOptions, title: string, range: string, target: number, chars: number, head: string[], body: string, used: number, total: number): BookPrompts {
  const style = HISTORY_STYLES[opts.style];
  const L = HISTORY_LENGTHS[opts.length];
  const what = lifeKind(opts.scope);
  const h = [
    ...head,
    `- 文体:${style.label}。${lifeRule(opts.style, what)}`,
    lengthLine(chars),
    '- 体例:一篇到底,不分章、不加小标题,开头不写传名(标题另有);按年份先后叙事,可以分段',
    TONE,
  ].join('\n');
  const call = { title, chapter: null, chars, maxTokens: L.maxTokens, temperature: style.temperature, head: h, body, used, total };
  const input = LIFE_SYSTEM + h + body;
  return {
    options: opts,
    title,
    range,
    chars,
    system: LIFE_SYSTEM,
    sections: [],
    calls: [call],
    empty: false,
    fingerprint: hash(`${title}\n${body}`),
    inputChars: input.length,
    inputTokens: estimateTokens(input),
    whole: '篇',
    target,
  };
}

function emptyPrompts(opts: LifeOptions): BookPrompts {
  return { options: opts, title: '', range: '', chars: 0, system: LIFE_SYSTEM, sections: [], calls: [], empty: true, fingerprint: 'none', inputChars: 0, inputTokens: 0, whole: '篇', target: 0 };
}

/** 列传 · 推演里的人 */
function personPrompts(civ: Civ, opts: LifeOptions, id: number, src?: LifeSource | null): BookPrompts {
  const x = personOf(civ, id);
  const card = x ? src?.person(id) : null;
  const name = x ? personName(civ, x) : '';
  if (!x || !card || !name) return emptyPrompts(opts);
  const target = HISTORY_LENGTHS[opts.length].chars;
  const ruler = x.role === 'ruler';
  const end = Y(civ.endYear);
  const body: string[] = [];
  const role = personRoleShort(civ, x);
  const a = Y(x.born);
  const b = x.died !== undefined ? Y(x.died) : end;
  body.push(`〔传主〕${name}(${role}${x.name && !name.includes(x.name) ? `,本名${x.name}` : ''})。下面是他人物卡上的事("${a}–${b} 年"指第 ${a} 年到第 ${b} 年)`);
  for (const l of card.lines) body.push(`- ${l.k}:${l.text}`);
  if (card.leanings) body.push(`- 倾向:${card.leanings}(推演里他的脾性,写他的为人时参考,不要把数写进正文)`);
  if (card.bio) body.push('', '〔生平〕', card.bio);
  // 治绩(人物卡上那一段):他在位这些年本国的疆域、人口、战事、钱粮怎么变,在位时的大事
  const rec = ruler ? reignRecord(civ, x) : null;
  if (rec) {
    body.push('', '〔治绩〕(他在位这些年本国怎么变;数照这里写,不要夸大)');
    if (rec.short !== null) body.push(rec.short);
    else for (const r of rec.rows) body.push(`- ${r.k}:${r.lines.join(';')}${r.note ? `(${r.note})` : ''}`);
  }
  const battles = battleLines(civ, x);
  if (battles.length) {
    body.push('', '〔领兵打过的仗〕(每一仗写的是"攻方、守方 → 结果",谁攻谁守、胜负都不能改)');
    for (const b of battles.slice(0, LIFE_BATTLES)) body.push(`- ${b}`);
    if (battles.length > LIFE_BATTLES) body.push(`- (另有${cnNumber(battles.length - LIFE_BATTLES)}仗从略)`);
  }
  const head = ruler ? '在位时' : x.role === 'minister' ? '在朝时' : x.role === 'prince' ? '他经手的' : '领兵时';
  const ev = pickEvents(card.events, LIFE_EVENT_BUDGET, (e) => (e.people?.includes(x.id) ? 1 : 0));
  if (ev.lines.length) {
    body.push('', `〔${head}本国的事〕(按先后;★ 是大事)`, ...ev.lines);
    if (ev.dropped) body.push(`(另有${cnNumber(ev.dropped)}件小事从略)`);
  }
  // 写到的人:父子兄弟、前任继任、争储的对手、掌权的人,再加纪事里写到的(按写到的次数),按出生先后列生卒
  const ids: number[] = [];
  const addId = (p: Person | null | undefined) => {
    if (p && p.id !== x.id && p.name && !ids.includes(p.id)) ids.push(p.id);
  };
  addId(fatherOf(civ, x));
  if (ruler) {
    const { prev, next } = rulerNeighbors(civ, x);
    addId(prev);
    addId(next);
  }
  for (const k of kidsOf(civ, x)) addId(k);
  for (const r of x.claim?.rivals ?? []) addId(civ.people?.[r]);
  if (x.rival !== undefined) addId(civ.people?.[x.rival]);
  for (const g of x.regencies ?? []) addId(g.ruler >= 0 ? civ.people?.[g.ruler] : null);
  for (const h of heldOver(civ, x)) addId(h.x);
  const seen = new Map<number, number>();
  for (const e of card.events) for (const p of e.people ?? []) seen.set(p, (seen.get(p) ?? 0) + 1);
  [...seen].sort((a, b) => b[1] - a[1] || a[0] - b[0]).forEach(([p]) => addId(civ.people?.[p]));
  const people = ids
    .slice(0, LIFE_PEOPLE)
    .map((i) => civ.people![i])
    .sort((a, b) => a.born - b.born || a.id - b.id);
  if (people.length) body.push('', '〔人物〕(材料里写到的人:生卒年、在位年份照这里写)', ...people.map((p) => personFacts(civ, p)));
  const from = Y(x.born);
  const to = x.died !== undefined ? Y(x.died) : end;
  const facts = card.lines.length + Math.min(battles.length, LIFE_BATTLES) + ev.lines.length + (card.bio ? 3 : 0) + (rec?.facts.events.length ?? 0);
  const chars = capChars(target, facts, 800, 60, 800);
  const headLines = [
    `请给${name}写一篇列传,从出身写到结局,写他这个人。`,
    `- 史实:生卒、${ruler ? '即位、前任继任、' : ''}父子兄弟、争储、联姻、掌权、放逐出奔、结局和打过的每一仗(谁攻谁守、胜负),都照〔传主〕〔领兵打过的仗〕写,不能改;` +
      `一生的事只写在第 ${from}—${to} 年之间,${cnNumber(SERVE_AGE)}岁以前不出仕、不领兵;〔人物〕里的人也只在他们的生卒年之间出现`,
    `- 取舍:以他自己的事为主;本国的事只挑和他有关、能写出他的为人和处境的,其余一笔带过或略去,不要写成本国的编年史;材料里没有的年份就少写,不要编造史事`,
  ];
  const text = body.join('\n');
  return lifePrompts(opts, `${name}传`, `第 ${from}—${to} 年`, target, chars, headLines, `〔材料〕\n${text}`, ev.lines.length, card.events.length);
}

/** 列传 · 作者的人物 */
function characterPrompts(civ: Civ, opts: LifeOptions, id: number, src?: LifeSource | null): BookPrompts {
  const c = src?.character(id);
  if (!c || !c.name) return emptyPrompts(opts);
  const target = HISTORY_LENGTHS[opts.length].chars;
  const body: string[] = ['〔传主〕(作者写的人物;下面每一项都是作者定的)', `- 名字:${c.name}`];
  body.push(`- 生卒:${c.died !== undefined ? `生于第 ${Y(c.born)} 年,卒于第 ${Y(c.died)} 年` : `生于第 ${Y(c.born)} 年(作者没写卒年)`}`);
  if (c.role) body.push(`- 身份:${c.role}`);
  if (c.polity) body.push(`- 国家:${c.polity}`);
  if (c.birthplace) body.push(`- 出生地:${c.birthplace}`);
  if (c.note) body.push('', '〔简介〕(作者写的)', c.note);
  if (c.kin.length) body.push('', '〔亲友〕(作者写的;括号里是关系)', ...c.kin.map((k) => `- ${k.name}${k.rel ? `(${k.rel})` : ''}`));
  const people: number[] = [];
  const add = (p: number) => {
    if (!people.includes(p) && civ.people?.[p]?.name) people.push(p);
  };
  for (const k of c.kin) if (k.person !== undefined) add(k.person);
  let events = 0;
  if (c.life.length) {
    body.push('', '〔经历〕(作者写的,按年份;下面缩进的是他勾上的推演里的事与人)');
    for (const e of c.life) {
      const age = e.year - c.born;
      const note = [age > 0 ? `${age} 岁` : '', e.where].filter(Boolean).join(',');
      body.push(`- 第 ${Y(e.year)} 年${note ? `(${note})` : ''}:${e.text || '(没写经历)'}`);
      for (const ev of e.events) {
        body.push(`  - 推演里的事:${entryYearLabel(ev)} ${ev.text}`);
        events++;
      }
      for (const p of e.people) {
        const x = civ.people?.[p];
        if (x?.name) body.push(`  - 推演里的人:${personName(civ, x)}`);
        add(p);
      }
    }
  }
  const ps = people.map((i) => civ.people![i]).sort((a, b) => a.born - b.born || a.id - b.id);
  if (ps.length) body.push('', '〔人物〕(推演里的人:生卒年、在位年份照这里写)', ...ps.map((p) => personFacts(civ, p)));
  const facts = 2 + (c.role ? 1 : 0) + Math.ceil(len(c.note) / 60) + c.kin.length + c.life.length * 2 + events;
  const chars = capChars(target, facts, 800, 60, 800);
  const to = c.died !== undefined ? Y(c.died) : Y(Math.max(c.born, ...c.life.map((e) => e.year)));
  const headLines = [
    `请给作者的人物${c.name}写一篇列传,从出身写到结局。`,
    '- 作者写的不许改:〔传主〕〔简介〕〔亲友〕〔经历〕都是作者自己定的,名字、身份、生卒、亲友和每段经历照写,不要和它们矛盾;' +
      '作者没写的身世、亲属、官职、师承、法术之类的设定不要替他添,只补合情理的场面、言行和心境',
    '- 推演里的事与人:〔经历〕里勾上的事、〔人物〕里的人照材料写(年份、谁攻谁守、胜负、谁在位都不能改);他和这些事、这些人是什么关系,只按作者写的经历来写',
    `- 取舍:以作者写的经历为骨架,按年份写下来;作者没写的年份少写,不要编造大事`,
  ];
  return lifePrompts(opts, `${c.name}传`, c.died !== undefined || to > Y(c.born) ? `第 ${Y(c.born)}—${to} 年` : `第 ${Y(c.born)} 年`, target, chars, headLines, `〔材料〕\n${body.join('\n')}`, events, events);
}

/** 家传里每位君主那一行留卡片上的这几项 */
const HOUSE_KEYS = new Set(['生卒', '在位', '在任', '争储', '争位', '掌权', '实权', '母亲', '配偶', '放逐', '出奔', '结局']);
/** 没即位的宗室留这几项 */
const PRINCE_KEYS = new Set(['生卒', '掌权', '母亲', '配偶', '放逐', '出奔', '结局', '对手', '领兵']);
/** 一家人的事:继位、掌权、联姻、放逐出奔、改朝换代、立国亡国、分裂自立、复国、升格 */
const FAMILY_KINDS = new Set(['reign', 'regent', 'marry', 'exile', 'dynasty', 'found', 'fall', 'split', 'reclaim', 'rank']);
/** 打仗的事:写到这一家的人也只算背景 */
const WAR_KINDS = new Set(['war', 'battle', 'conquer', 'sack', 'ruin', 'peace']);

/** 家传 */
function housePrompts(civ: Civ, opts: LifeOptions, polity: number, dynasty: number, src?: LifeSource | null): BookPrompts {
  const p = civ.polities[polity];
  const { rows, i } = rowOf(civ, polity, dynasty);
  const name = houseName(civ, polity, dynasty);
  if (!p || i < 0 || !src || !name) return emptyPrompts(opts);
  const row = rows[i];
  const target = HISTORY_LENGTHS[opts.length].chars;
  const end = Y(civ.endYear);
  const from = Y(row.from);
  const to = row.to !== undefined ? Y(row.to) : end;
  const members = dynastyMembers(civ, row);
  const memberIds = new Set(members.map((x) => x.id));
  const body: string[] = [];
  const close = dynastyEnd(civ, rows, i);
  body.push(`〔这一朝〕${row.name}:${dynastyNote(civ, rows, i)}。${close ? `结局:${close}。` : `到第 ${end} 年还在。`}国号:${polityName(p, Math.min(row.to ?? civ.endYear, civ.endYear) - 1 / 512)}`);
  body.push('', `〔世系〕(一人一行,下一代多缩两格;数字是这一朝第几位君主,"未即位"的是没即位的宗室;"${from}–${to} 年"指第 ${from} 年到第 ${to} 年)`);
  body.push(...dynastyLines(civ, polity, rows, i).slice(1));
  // 每位君主:怎么即位,卡片上的生卒、在位、争储、掌权、联姻、放逐、结局
  body.push('', '〔君主〕(按即位先后;每人一行,照他人物卡上的事)');
  let facts = 0;
  row.rulers.forEach((x, k) => {
    const card = src.person(x.id);
    const rise = riseText(civ, x);
    const items = [rise ? `即位:${rise}` : '', ...(card?.lines ?? []).filter((l) => HOUSE_KEYS.has(l.k)).map((l) => `${l.k}:${l.text}`)].filter(Boolean);
    facts += items.length;
    body.push(`- 第 ${k + 1} 位 ${personName(civ, x)}${x.name && !personName(civ, x).includes(x.name) ? `(本名${x.name})` : ''}:${items.join(';')}`);
  });
  // 没即位的宗室:有事的才列(争储被杀、战死、掌过权、被放逐、出奔、据地自立)
  const princes = members.filter((x) => !row.rulers.includes(x) && (secededFrom(civ, x, polity) || x.fate === 'purged' || x.fate === 'battle' || !!x.regencies?.length || !!x.exile));
  if (princes.length) {
    body.push('', '〔宗室〕(没即位的、据地自立去了别国的,有事可记的几位)');
    for (const x of princes.slice(0, HOUSE_PRINCES)) {
      const card = src.person(x.id);
      const seceded = secededFrom(civ, x, polity);
      const items = (card?.lines ?? []).filter((l) => (seceded ? HOUSE_KEYS : PRINCE_KEYS).has(l.k)).map((l) => `${l.k}:${l.text}`);
      const f = fatherOf(civ, x);
      facts += items.length;
      body.push(`- ${personName(civ, x)}${f ? `(${personName(civ, f)}之子)` : ''}${seceded ? `,据地自立为${polityName(civ.polities[x.polity], x.from ?? x.born)}之君` : ''}:${items.join(';')}`);
    }
    if (princes.length > HOUSE_PRINCES) body.push(`- (另有${cnNumber(princes.length - HOUSE_PRINCES)}位从略)`);
  }
  // 这一朝里一家人的事:继位、掌权、联姻、放逐出奔、改朝换代……先挑这些,再挑写到这一家人的、大事
  const inRow = (e: ChronicleEntry) => Y(e.year) >= from && Y(e.year) <= to;
  const mine = (e: ChronicleEntry) => !!e.people?.some((id) => memberIds.has(id));
  const all = polityEntries(civ, polity).filter((e) => inRow(e) && (FAMILY_KINDS.has(e.kind) || (mine(e) && !WAR_KINDS.has(e.kind)) || e.importance >= 3));
  const ev = pickEvents(all, HOUSE_EVENT_BUDGET, (e) => (FAMILY_KINDS.has(e.kind) ? 2 : mine(e) ? 1 : 0));
  if (ev.lines.length) {
    body.push('', '〔这一朝一家人的事〕(按先后;★ 是大事,只作背景)', ...ev.lines);
    if (ev.dropped) body.push(`(另有${cnNumber(ev.dropped)}件从略)`);
  }
  facts += ev.lines.length;
  const chars = capChars(target, facts, 600, 30, 1000);
  const ended = row.to !== undefined;
  const headLines = [
    `请给${name}写一篇家传:写这一家人从第 ${from} 年${i === 0 ? '立国' : '开朝'}到${ended ? `第 ${to} 年${rows[i + 1] ? '失国' : '国亡'}` : `第 ${end} 年`}的事。`,
    '- 写一家人,不写一国的兴衰(那是国史的本纪):重在谁继了谁、兄弟叔侄争储、和别国联姻、幼主即位有人摄政、权臣宗室掌权、宗室被放逐或出奔、远支复起这些家事;' +
      '打仗、疆域只在牵动这一家人时一笔带过',
    '- 世系照〔世系〕〔君主〕写:谁是谁的父亲、兄弟,第几位君主,哪几年在位,怎么即位、怎么结局,都不能改;不要另编君主,没即位的宗室不要写成即过位;每个人的事只写在他的生卒年之间',
    '- 取舍:二十几位君主不必人人细写,挑家里出了事的几代写透,其余一两句带过',
  ];
  return lifePrompts(opts, `${name}家传`, `第 ${from}—${to} 年`, target, chars, headLines, `〔材料〕\n${body.join('\n')}`, ev.lines.length, all.length);
}

/** 列传、家传的提示词(一次写完一篇;找不到人、这一朝时 empty) */
export function buildLifePrompts(civ: Civ, opts: LifeOptions, src?: LifeSource | null): BookPrompts {
  const s = opts.scope;
  if (s.kind === 'person') return personPrompts(civ, opts, s.person, src);
  if (s.kind === 'character') return characterPrompts(civ, opts, s.char, src);
  return housePrompts(civ, opts, s.polity, s.dynasty, src);
}

// ---------------------------------------------------------------------------
// 和写史书合在一处的入口

/** 提示词:史书 = HistoryPrompts;列传、家传多一个 target(所选篇幅;材料少时 chars 比它少) */
export interface BookPrompts extends Omit<HistoryPrompts, 'options'> {
  options: BookOptions;
  target?: number;
}

export function bookPrompts(civ: Civ, opts: BookOptions, src?: LifeSource | null): BookPrompts {
  return isLifeScope(opts.scope) ? buildLifePrompts(civ, opts as LifeOptions, src) : buildHistoryPrompts(civ, opts as HistoryOptions);
}

/** 历史指纹:史书照 historyFingerprint;列传、家传 = 材料的摘要(改名、干预、改地形重推,或作者改了人物以后就变了) */
export function bookFingerprint(civ: Civ, opts: BookOptions, src?: LifeSource | null): string {
  return isLifeScope(opts.scope) ? buildLifePrompts(civ, opts as LifeOptions, src).fingerprint : historyFingerprint(civ, opts.scope as HistoryScope);
}

export function bookStoreScope(civ: Civ, scope: BookScope, src?: LifeSource | null): BookStoredScope {
  if (!isLifeScope(scope)) return storeScope(civ, scope);
  if (scope.kind === 'person') return { kind: 'person', key: personKey(civ, scope.person), name: lifeTitle(civ, scope, src).slice(0, -1) };
  if (scope.kind === 'character') return { kind: 'character', id: scope.char, name: src?.character(scope.char)?.name ?? '' };
  return { kind: 'house', key: polityKey(civ, scope.polity) ?? '', dynasty: scope.dynasty, name: houseName(civ, scope.polity, scope.dynasty) };
}

/** 存档里记的 → 这个世界里的;人、这一朝在现在的历史里找不到了(作者删了这个人物)= null */
export function bookLoadScope(civ: Civ, s: BookStoredScope, src?: LifeSource | null): BookScope | null {
  if (!isLifeScope(s)) return loadScope(civ, s as StoredScope);
  if (s.kind === 'person') {
    const id = s.key ? resolvePersonKey(civ, s.key) : -1;
    return id >= 0 && personOf(civ, id) ? { kind: 'person', person: id } : null;
  }
  if (s.kind === 'character') return src?.character(s.id) ? { kind: 'character', char: s.id } : null;
  const r = resolveKey(civ, s.key);
  if (!r || r.kind !== 'polity' || !civ.polities[r.id]) return null;
  return rowOf(civ, r.id, s.dynasty).i >= 0 ? { kind: 'house', polity: r.id, dynasty: s.dynasty } : null;
}

/** 笔记的键:同一个人(一朝)+ 文体 + 篇幅 = 同一篇(重写就覆盖) */
export function bookNoteKey(s: BookStoredScope, style: HistoryStyle, length: HistoryLength): string {
  if (!isLifeScope(s)) return historyNoteKey(s as StoredScope, style, length);
  const where = s.kind === 'person' ? `person:${s.key}` : s.kind === 'character' ? `char:${s.id}` : `house:${s.key}#${s.dynasty}`;
  return `史书:${where}:${style}:${length}`;
}

/** 找不到时的说法(阅读页"写于历史改变之前"后面那半句) */
export function lifeMissing(s: LifeStoredScope): string {
  if (s.kind === 'character') return `作者的人物${s.name ? `「${s.name}」` : ''}已经删掉了`;
  if (s.kind === 'house') return `现在的历史里没有${s.name || '这一朝'}了`;
  return `现在的历史里没有${s.name || '这个人'}了`;
}
