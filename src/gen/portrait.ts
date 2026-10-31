/**
 * 人物头像(纯计算,不碰 DOM):按一个人的文化、身份、年龄、地位、倾向、血缘挑出一叠部件图,界面上叠起来就是他的头像。
 * 不影响推演,和生成器版本无关。部件表见 portraitParts.ts(图在 public/portraits/<组>/)。
 *
 * - 文化 → 服饰组:地名语感合并成 7 组(STYLE_GROUP);每组有几张底脸和一套部件
 * - 身份 → 衣服、头饰:君主(称帝的大国戴最高一档的冠)、共和国执政官、将领(甲、盔)、名臣(官服、官帽)、
 *   没即位的宗室、作者的人物(士人或平民装,作者写的身份是随手写的字,不去猜)
 * - 血缘 → 长相:一朝的第一位随机定底脸、脸型、鼻、眉形、会不会谢顶;儿子照父亲的来,每一项有一点机会变一下。
 *   一家人长得像,换了一家换一张脸
 * - 年龄 → 老少:按那一年的岁数,少年用年轻的脸,三十岁后留须,四十加一档皱纹,五十八再加一档、换老人的闭眼,
 *   四十五起头发胡子渐白(白的程度给界面上滤镜),一部分人五十后谢顶
 * - 倾向(君主、执政官才有)→ 打扮:哪一项特别高,衣服、饰物优先挑对应的那件(好战的甲领、重商的华服……)
 *
 * 随机数都从 subSeed(seed, '人物头像') 再按人物的稳定键(personKey)派生:干预、重推以后还是同一个人的,脸就不变。
 * 女的还没有部件(personPortrait 给 null,界面写名字);血缘按她原来的男名(Person.maleName)算,她的后人长相不跟着变。
 * 作者的人物按编号派生,再加上"换一张"换过几次(AuthorCharacter.portrait)。
 *
 * portraitMood:时间轴那一年他该是什么神情(卡片上的头像按它换表情、点头、低头)。
 */
import type { Civ, Person, Year } from './civ/types';
import { mulberry32, subSeed, type Rng } from './util';
import { polityTierAt } from './civ/growth';
import { isConsul } from './civ/story/peopleText';
import { personKey } from './characters';
import { PORTRAIT_PARTS } from './portraitParts';

export type PortraitGroupId = 'zhongyuan' | 'steppe' | 'mythic' | 'latin' | 'north' | 'desert' | 'elf';
export type PortraitLayer = 'body' | 'jaw' | 'nose' | 'wrinkle' | 'clothes' | 'brow' | 'eye' | 'mouth' | 'beard' | 'hair' | 'hat' | 'acc';
export type PortraitRole = 'ruler' | 'consul' | 'general' | 'minister' | 'royal' | 'scholar' | 'commoner';
export type PortraitExpr = 'calm' | 'smile' | 'frown' | 'angry' | 'surprise';
export type PortraitLean = 'war' | 'trade' | 'dev' | 'explore';

/**
 * 一件部件(portraitParts.ts 里的一行):
 *   id 文件名;layer 叠在哪一层;expr 表情(smile / frown / angry / surprise / closed 闭眼 / closed-old 老人闭眼 / talk-a、talk-o 口型);
 *   roles 给哪些身份穿戴;tier 君主的冠是哪一档(1 小国、2 王、3 称帝);lean 倾向对应的打扮;rare 少量随机的饰物(伤疤、眼罩);
 *   bald 谢顶;def 默认发型;hides 戴上就不画头发(头盔、帽、巾);young 年轻的身体;age 皱纹第几档;
 *   own 哪几张底脸有自己的一份(<id>.f<几>.webp);贴在脸上的层(身体、脸型、鼻、皱纹、眉眼嘴)别的脸没有 = 这张脸用不着
 *   (做这个表情和平静时一样),衣服、头发这些共用第一张脸那份;nobase 第一张脸没有这一件
 */
export interface PortraitPart {
  id: string;
  layer: PortraitLayer;
  expr?: string;
  roles?: PortraitRole[];
  tier?: number;
  lean?: string;
  rare?: boolean;
  bald?: boolean;
  def?: boolean;
  hides?: boolean;
  young?: boolean;
  age?: number;
  own?: number[];
  nobase?: boolean;
}

export interface PortraitGroupParts {
  /** 几张底脸 */
  faces: number;
  parts: PortraitPart[];
}

/** 一层图:src 相对 public/portraits/ 的路径;white = 头发、胡须,跟着变白 */
export interface PortraitImg {
  src: string;
  layer: PortraitLayer;
  white?: boolean;
  /** 眨眼时才露出来的闭眼(portraitLayers 给) */
  blink?: boolean;
}

/** 一张头像 */
export interface Portrait {
  group: PortraitGroupId;
  /** 底脸(1 起) */
  face: number;
  /** 平静时的那叠图,从后往前 */
  layers: PortraitImg[];
  /** 头发、胡须白到什么程度(0–1;界面上用滤镜) */
  white: number;
  /** 每种表情换上去的眉、眼、嘴(平静不用换) */
  exprs: Partial<Record<Exclude<PortraitExpr, 'calm'>, PortraitImg[]>>;
  /** 眨眼时盖上去的闭眼(老人用带眼角皱纹的那张) */
  blink: PortraitImg[];
}

/** 地名语感 → 服饰组 */
export const STYLE_GROUP: Record<string, PortraitGroupId> = {
  central: 'zhongyuan',
  xianxia: 'zhongyuan',
  frontier: 'steppe',
  steppe: 'steppe',
  mythic: 'mythic',
  imperial: 'latin',
  hellenic: 'latin',
  kingdom: 'north',
  nordic: 'north',
  slavic: 'north',
  desert: 'desert',
  elven: 'elf',
};

/** 从后往前的层序 */
const ORDER: readonly PortraitLayer[] = ['body', 'jaw', 'nose', 'wrinkle', 'clothes', 'brow', 'eye', 'mouth', 'beard', 'hair', 'hat', 'acc'];
const EXPRS = ['smile', 'frown', 'angry', 'surprise'] as const;

/** 几岁算少年(用年轻的脸)、几岁起留须、两档皱纹、头发开始白、全白、可能谢顶 */
const AGE_YOUNG = 21;
const AGE_BEARD = 30;
const AGE_WRINKLE = [40, 58] as const;
const AGE_WHITE = [45, 75] as const;
const AGE_BALD = 50;

/** 有部件的组(某一组的图还没有时退到同一边的组,再退到中原) */
function partsOf(group: PortraitGroupId): { group: PortraitGroupId; parts: PortraitGroupParts } | null {
  const tries: PortraitGroupId[] = [group, ...(EASTERN.has(group) ? (['zhongyuan'] as const) : (['north', 'latin', 'zhongyuan'] as const))];
  for (const g of tries) {
    const p = PORTRAIT_PARTS[g];
    if (p && p.parts.length) return { group: g, parts: p };
  }
  return null;
}
const EASTERN = new Set<PortraitGroupId>(['zhongyuan', 'steppe', 'mythic']);

/** 某国(下标)的服饰组 */
export function polityGroup(civ: Civ, polity: number): PortraitGroupId {
  const p = civ.polities[polity];
  const style = p ? civ.cultures[p.culture]?.style : undefined;
  return (style && STYLE_GROUP[style]) || (p && !p.eastern ? 'north' : 'zhongyuan');
}

// ---------------------------------------------------------------------------
// 血缘

/** 长相里往下传的几项:底脸、脸型 / 鼻 / 眉形(0 = 底脸本来的,1 起 = 第几件)、会不会谢顶 */
interface Genes {
  face: number;
  jaw: number;
  nose: number;
  brow: number;
  bald: boolean;
}

/** 儿子每一项和父亲不一样的机会(底脸少变,脸型、鼻、眉多变一点) */
const MUTATE = { face: 0.06, feature: 0.22, bald: 0.25 };

function randomGenes(rng: Rng, g: PortraitGroupParts): Genes {
  const n = (layer: PortraitLayer) => g.parts.filter((p) => p.layer === layer && !p.expr && !p.nobase).length;
  return {
    face: 1 + Math.floor(rng() * g.faces),
    jaw: Math.floor(rng() * (n('jaw') + 1)),
    nose: Math.floor(rng() * (n('nose') + 1)),
    brow: Math.floor(rng() * (n('brow') + 1)),
    bald: rng() < 0.3,
  };
}

const geneCache = new WeakMap<object, Map<number, Genes>>();

/** 推演里的人的长相:有父亲的照父亲的来(同一组才传;父亲不在同一组 = 当开国的算) */
function personGenes(civ: Civ, x: Person, group: PortraitGroupId, g: PortraitGroupParts, seed: number): Genes {
  const list = civ.people ?? [];
  let memo = geneCache.get(list);
  if (!memo) geneCache.set(list, (memo = new Map()));
  const hit = memo.get(x.id);
  if (hit) return hit;
  // 往上找到这一支的第一位(或已经算过的那一位),再一代代往下算(不递归,长的世系也不会爆栈)
  const chain: Person[] = [];
  let genes: Genes | undefined;
  for (let p: Person | undefined = x; p; ) {
    const known = memo.get(p.id);
    if (known) {
      genes = known;
      break;
    }
    chain.push(p);
    const f: Person | undefined = p.parent !== undefined ? list[p.parent] : undefined;
    p = f && !chain.includes(f) && polityGroup(civ, f.polity) === group ? f : undefined;
  }
  for (let i = chain.length - 1; i >= 0; i--) {
    const p = chain[i];
    const rng = mulberry32(subSeed(seed, `${bloodKey(civ, p)}|血缘`));
    if (!genes) genes = randomGenes(rng, g);
    else {
      const fresh = randomGenes(rng, g);
      genes = {
        face: rng() < MUTATE.face ? fresh.face : genes.face,
        jaw: rng() < MUTATE.feature ? fresh.jaw : genes.jaw,
        nose: rng() < MUTATE.feature ? fresh.nose : genes.nose,
        brow: rng() < MUTATE.feature ? fresh.brow : genes.brow,
        bald: rng() < MUTATE.bald ? fresh.bald : genes.bald,
      };
    }
    memo.set(p.id, genes);
  }
  return genes!;
}

// ---------------------------------------------------------------------------
// 拼一张

interface Who {
  role: PortraitRole;
  age: number;
  /** 君主:国号档位(0–3) */
  tier?: number;
  /** 倾向里特别高的那一项 */
  lean?: PortraitLean;
  /** 将领、好战的君主:饰物里伤疤、眼罩多一点机会 */
  martial?: boolean;
}

/** 贴在脸上的层:每张底脸各有一套,不借别的脸的(借了会把第一张脸的五官贴到别的脸上) */
const FACE_LAYERS = new Set<PortraitLayer>(['body', 'jaw', 'nose', 'wrinkle', 'brow', 'eye', 'mouth']);

/** 一件部件在这张底脸上用哪张图;这张脸没有(做这个表情和平静时一样)= null,不叠 */
function img(group: PortraitGroupId, p: PortraitPart, face: number): PortraitImg | null {
  let suffix = '';
  if (face > 1 && p.own?.includes(face)) suffix = `.f${face}`;
  else if (face > 1 ? FACE_LAYERS.has(p.layer) : p.nobase) return null;
  return { src: `${group}/${p.id}${suffix}.webp`, layer: p.layer, ...(p.layer === 'hair' || p.layer === 'beard' ? { white: true } : {}) };
}

const pickOne = <T,>(rng: Rng, list: readonly T[]): T | undefined => (list.length ? list[Math.floor(rng() * list.length)] : undefined);

/** 挑一件,倾向对得上的优先 */
function pickLean(rng: Rng, list: readonly PortraitPart[], lean: PortraitLean | undefined): PortraitPart | undefined {
  const hit = lean ? list.filter((p) => p.lean === lean) : [];
  const roll = rng();
  if (hit.length && roll < 0.75) return pickOne(rng, hit);
  return pickOne(rng, list.filter((p) => !p.lean).length ? list.filter((p) => !p.lean) : list);
}

function compose(group: PortraitGroupId, g: PortraitGroupParts, genes: Genes, who: Who, rng: Rng): Portrait {
  const P = g.parts;
  const face = Math.min(genes.face, g.faces);
  const of = (layer: PortraitLayer) => P.filter((p) => p.layer === layer && !p.expr);
  const has = (role: PortraitRole) => (p: PortraitPart) => p.roles?.includes(role);
  const out: (PortraitPart | undefined)[] = [];
  const young = who.age < AGE_YOUNG;
  // 每一项都先掷好骰子,哪一项用不上也照掷:年龄变了,别的打扮不跟着变
  const r = { clothes: rng(), hat: rng(), hatOn: rng(), hair: rng(), hairDef: rng(), beard: rng(), beardOn: rng(), acc: rng(), accOn: rng() };
  const seq = (x: number): Rng => mulberry32(Math.floor(x * 2 ** 32));

  out.push(P.find((p) => p.layer === 'body' && (young ? p.young : !p.young)) ?? P.find((p) => p.layer === 'body'));
  // 脸型、鼻、眉形:0 = 底脸本来的
  for (const [layer, k] of [['jaw', genes.jaw], ['nose', genes.nose], ['brow', genes.brow]] as const) if (k > 0) out.push(of(layer).filter((p) => !p.nobase)[k - 1]);
  if (!young && who.age >= AGE_WRINKLE[0]) out.push(of('wrinkle').find((p) => p.age === (who.age >= AGE_WRINKLE[1] ? 2 : 1)));

  const role = who.role;
  const clothes = of('clothes').filter(has(role));
  const fallback = role === 'consul' ? 'ruler' : role === 'royal' ? 'ruler' : role === 'scholar' ? 'commoner' : role === 'commoner' ? 'scholar' : 'ruler';
  out.push(pickLean(seq(r.clothes), clothes.length ? clothes : of('clothes').filter(has(fallback)), who.lean));

  // 头饰:君主按国号档位挑冠;执政官、宗室、作者的人物有一半不戴;将领、名臣都戴
  let hat: PortraitPart | undefined;
  const hats = of('hat').filter(has(role));
  if (role === 'ruler') {
    const want = Math.max(1, Math.min(3, who.tier ?? 1));
    const tiers = hats.filter((p) => p.tier !== undefined);
    const best = tiers.length ? tiers.reduce((a, b) => (Math.abs((b.tier ?? 1) - want) < Math.abs((a.tier ?? 1) - want) ? b : a)).tier : undefined;
    hat = pickOne(seq(r.hat), tiers.filter((p) => p.tier === best));
  } else {
    const wear = role === 'general' ? 0.85 : role === 'minister' ? 1 : 0.5;
    if (r.hatOn < wear) hat = pickOne(seq(r.hat), hats);
  }
  if (hat) out.push(hat);

  // 头发:戴盔、帽、巾的不画;老了可能谢顶;少年都用默认的
  if (!hat?.hides) {
    const hair = of('hair');
    const def = hair.find((p) => p.def);
    const bald = hair.find((p) => p.bald);
    const others = hair.filter((p) => !p.def && !p.bald);
    if (genes.bald && bald && who.age >= AGE_BALD) out.push(bald);
    else if (young || r.hairDef < 0.55 || !others.length) out.push(def ?? others[0]);
    else out.push(pickOne(seq(r.hair), others));
  }

  // 胡须:三十岁前一半人没有;精灵大多不留
  const beards = of('beard');
  const shaven = group === 'elf' ? 0.75 : 0.1;
  if (!young && r.beardOn >= shaven && (who.age >= AGE_BEARD || r.beardOn > 0.55)) out.push(pickOne(seq(r.beard), beards));

  // 饰物:倾向特别高的配对应那件;将领、好战的君主偶尔带伤疤、眼罩
  const accs = of('acc');
  const leanAcc = who.lean ? accs.filter((p) => p.lean === who.lean) : [];
  if (leanAcc.length && r.accOn < 0.4) out.push(pickOne(seq(r.acc), leanAcc));
  else if (r.accOn > (who.martial ? 0.88 : 0.97)) out.push(pickOne(seq(r.acc), accs.filter((p) => p.rare)));

  const layers = out.filter((p): p is PortraitPart => !!p).sort((a, b) => ORDER.indexOf(a.layer) - ORDER.indexOf(b.layer));
  const imgs = layers.map((p) => img(group, p, face)).filter((x): x is PortraitImg => !!x);
  const exprs: Portrait['exprs'] = {};
  for (const e of EXPRS) {
    const set = P.filter((p) => p.expr === e).map((p) => img(group, p, face)).filter((x): x is PortraitImg => !!x);
    if (set.length) exprs[e] = set;
  }
  const old = who.age >= AGE_WRINKLE[1];
  const closed = (name: string) => P.filter((p) => p.expr === name).map((p) => img(group, p, face)).filter((x): x is PortraitImg => !!x);
  // 没有年轻闭眼图的组(画出来和睁眼一样,没切成层)用老人的闭眼
  const useOld = closed('closed-old').length > 0 && (old || !closed('closed').some((x) => x.layer === 'eye'));
  const blink = useOld ? [...closed('closed').filter((x) => x.layer !== 'eye'), ...closed('closed-old')] : closed('closed');
  const white = Math.max(0, Math.min(1, (who.age - AGE_WHITE[0]) / (AGE_WHITE[1] - AGE_WHITE[0])));
  return { group, face, layers: imgs, white: Math.round(white * 100) / 100, exprs, blink };
}

/** 倾向里特别高(≥ 70)的那一项 */
function leanOf(x: Person): PortraitLean | undefined {
  const l = x.leanings;
  if (!l) return undefined;
  const all: [PortraitLean, number][] = [
    ['war', l.war],
    ['trade', l.trade],
    ['dev', l.develop],
    ['explore', l.expand],
  ];
  const top = all.reduce((a, b) => (b[1] > a[1] ? b : a));
  return top[1] >= 70 ? top[0] : undefined;
}

/**
 * 血缘(长相往下传)按哪个键算:一般就是人物的稳定键;女的按她原来的男名(推演先按男的排过一遍,见 civ/women.ts),
 * 这样换成女的以后,她的子孙长相和原来一样
 */
function bloodKey(civ: Civ, p: Person): string {
  const k = personKey(civ, p.id);
  if (!p.maleName) return k;
  const parts = k.split('|');
  if (parts.length >= 4) parts[2] = p.maleName;
  return parts.join('|');
}

/** 推演里的人在某一年的头像(去世以后 = 去世那年的样子);部件还没有(女性的部件还没画)= null */
export function personPortrait(civ: Civ, id: number, year: Year): Portrait | null {
  const x = civ.people?.[id];
  if (!x || x.female) return null;
  const want = polityGroup(civ, x.polity);
  const found = partsOf(want);
  if (!found) return null;
  const { group, parts } = found;
  const seed = subSeed(civ.seed, '人物头像');
  const genes = personGenes(civ, x, want, parts, seed);
  const at = x.died !== undefined ? Math.min(year, x.died) : year;
  const role: PortraitRole =
    x.role === 'ruler' ? (isConsul(civ, x) ? 'consul' : 'ruler') : x.role === 'prince' ? 'royal' : x.role === 'general' ? 'general' : 'minister';
  const p = civ.polities[x.polity];
  const tier = role === 'ruler' && p ? Math.max(0, polityTierAt(p, Math.max(at, x.from ?? at))) : undefined;
  const lean = leanOf(x);
  const who: Who = { role, age: Math.max(0, Math.floor(at - x.born)), tier, lean, martial: role === 'general' || lean === 'war' };
  return compose(group, parts, genes, who, mulberry32(subSeed(seed, `${personKey(civ, x.id)}|打扮`)));
}

/**
 * 作者的人物在某一年的头像:id 人物编号,swap "换一张"换过几次,born / died 生卒,polity 他的国家(下标,−1 = 不知道)。
 * 身份按编号随机成士人或平民
 */
export function characterPortrait(civ: Civ, c: { id: number; born: number; died?: number; portrait?: number }, polity: number, year: Year): Portrait | null {
  const found = partsOf(polity >= 0 ? polityGroup(civ, polity) : 'zhongyuan');
  if (!found) return null;
  const { group, parts } = found;
  const rng = mulberry32(subSeed(subSeed(civ.seed, '人物头像'), `char:${c.id}|${c.portrait ?? 0}`));
  const genes = randomGenes(rng, parts);
  const at = c.died !== undefined ? Math.min(year, c.died) : year;
  const role: PortraitRole = rng() < 0.6 ? 'scholar' : 'commoner';
  return compose(group, parts, genes, { role, age: Math.max(0, Math.floor(at - c.born)) }, rng);
}

/**
 * 某种表情时的那叠图:平静的图里眉形那一层让位给表情的眉。
 * blink = 连眨眼的闭眼图一起给(标着 blink,界面上平时藏着,眨眼时露一下);同一层里排在最后,头饰照样盖在它上面
 */
export function portraitLayers(p: Portrait, expr: PortraitExpr, blink = false): PortraitImg[] {
  const swap = expr === 'calm' ? undefined : p.exprs[expr];
  const swapped = new Set((swap ?? []).map((x) => x.layer));
  const base = swap ? p.layers.filter((x) => !(x.layer === 'brow' && swapped.has('brow'))) : p.layers;
  const all = [...base, ...(swap ?? []), ...(blink ? p.blink.map((x) => ({ ...x, blink: true })) : [])];
  return all.sort((a, b) => ORDER.indexOf(a.layer) - ORDER.indexOf(b.layer) || Number(!!a.blink) - Number(!!b.blink));
}

// ---------------------------------------------------------------------------
// 神情

/** 那一年的神情:expr 表情;act 打开卡片时多做的一下(nod 点头、bow 低头) */
export interface PortraitMood {
  expr: PortraitExpr;
  act?: 'nod' | 'bow';
}

/**
 * 时间轴那一年他该是什么神情:
 *   即位、入仕那年 微笑、点头;领兵那年打了胜仗、攻下城 微笑;打了败仗、丢了城 发怒、低头;在打仗但没分出胜负 皱眉;
 *   君主没亲征,本国那年攻下城 微笑、丢了城 皱眉;别的时候平静。去世以后 / 还没出生 = 平静(卡片上换成画像,不动)
 */
export function portraitMood(civ: Civ, x: Person, year: Year): PortraitMood {
  const y = Math.floor(year);
  if (y < x.born || (x.died !== undefined && y > x.died)) return { expr: 'calm' };
  let won = 0;
  let lost = 0;
  let fighting = false;
  const A = civ.annals;
  for (const c of x.commands ?? []) {
    if (y < Math.floor(c.from) || y > Math.floor(c.until)) continue;
    fighting = true;
    for (let i = Math.max(0, c.first); i <= c.last && i < A.length; i++) {
      const e = A[i];
      if (e.war !== c.war || Math.floor(e.year) !== y) continue;
      if (e.kind === 'conquer') e.a === x.polity ? won++ : e.b === x.polity && lost++;
      if (e.kind === 'battle') e.b === x.polity ? won++ : e.a === x.polity && lost++;
    }
  }
  if (lost > won) return { expr: 'angry', act: 'bow' };
  if (won) return { expr: 'smile' };
  if (fighting) return { expr: 'frown' };
  if ((x.role === 'ruler' || x.role === 'minister') && x.from !== undefined && Math.floor(x.from) === y) return { expr: 'smile', act: 'nod' };
  if (x.role === 'ruler' && x.from !== undefined && x.from <= year && (x.until === undefined || year < x.until)) {
    let gain = 0;
    let loss = 0;
    for (const e of yearAnnals(civ, y)) {
      if (e.kind !== 'conquer') continue;
      if (e.a === x.polity) gain++;
      else if (e.b === x.polity) loss++;
    }
    if (loss > gain) return { expr: 'frown' };
    if (gain) return { expr: 'smile' };
  }
  return { expr: 'calm' };
}

/** 某一年的史事(史事按年份排好,二分找起点) */
function yearAnnals(civ: Civ, y: number) {
  const A = civ.annals;
  let lo = 0;
  let hi = A.length;
  while (lo < hi) {
    const m = (lo + hi) >> 1;
    if (A[m].year < y) lo = m + 1;
    else hi = m;
  }
  const out = [];
  for (let i = lo; i < A.length && A[i].year < y + 1; i++) out.push(A[i]);
  return out;
}
