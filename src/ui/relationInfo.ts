/**
 * 人物关系图的数据(RelationGraph.tsx 画,摆法见 relationLayout.ts):以一个人为中心,他和谁有关系、放进哪一簇、
 * 名字下面写什么、悬停时说哪几句。不改历史,打开时现算;和人物卡各行同一套算法(世系、联姻、领兵、掌实权、放逐)。
 *
 * 推演人物居中时,每一簇收哪些人:
 *   血亲    父(养父)、同父的兄弟、子(养子);前任 / 继任、争储、杀他、掌实权、放逐的对方是亲属的也算这里(按世系写称呼:孙、侄……)
 *   姻亲    外祖父(母亲是联姻嫁来的)、岳父(他娶了谁家的女儿)、女婿(谁娶了他的女儿)、外孙(女儿所生);妻(嫁来的宗室女)、夫(后妃的丈夫)
 *   母亲(Person.mom:嫁来的宗室女、临朝的太后)算血亲;后妃生的子女也是她的子女
 *   君臣    君主:在位时领兵的将领、在朝的名臣;将领、名臣、宗室:效力过的君主;不是亲属的权臣、前任 / 继任
 *   对手    同一场仗对面的统帅;不是亲属的争储对手、杀他的人、放逐他的人
 *   作者的人物  亲友里写了他、经历里勾了他的作者人物
 * 作者的人物居中时:他的亲友按写的字归簇(byWord),经历里勾到的推演人物单独一簇「经历里写到」;存档里的格式不动。
 *
 * 自己的关系不到 5 位时自动"多看一层":亲人的亲人(按世系算得出称呼的写"祖父""侄",算不出的写"父亲的女婿""同朝将领""某某之父"),
 * 淡一些、小一号。悬停的几句里"他"都换成了中心那位(多看一层的换成经过的那位)的名字;名字下面的红字照旧写"他"(指中心那位,
 * 她是女的写"她")。称呼都按对方的性别写(父 / 母、子 / 女、兄 / 姐、岳父 / 岳母……,gen/civ/gender.ts)。
 */
import type { Civ, Person, PersonSpouse } from '../gen/civ/types';
import type { AuthorCharacter } from '../gen/characters';
import { lifeInOrder, personKey, resolvePersonKey } from '../gen/characters';
import { polityName } from '../gen/civ/growth';
import { peopleIndex, personFame, personSpan } from '../gen/civ/story/peopleInfo';
import { childrenOf, fatherOf, kidsOf, motherOf } from '../gen/civ/story/lineageInfo';
import { brideMatchOf, brideName, heldOver, polityShort } from '../gen/civ/story/regentInfo';
import { consortRole, dowagerSpans, generalRole, isConsul, kinOf, ministerRole, personName, princeRole, rulerRole } from '../gen/civ/story/peopleText';
import { bySex, heOrShe, isFemale, kinWord } from '../gen/civ/story/gender';
import { MARK_HEX } from '../render/marks';
import { spaced, yearAt, yearShort, yearSpan, yearSpanAt, type Era } from '../gen/era';
import { lifeYears } from './characterInfo';

/** 簇:血亲、姻亲、君臣、对手;作者的人物(推演人物居中时);师友、其他、经历里写到(作者的人物居中时) */
export type Cluster = 'blood' | 'inlaw' | 'court' | 'rival' | 'author' | 'friend' | 'other' | 'story';
/** 摆在哪:血亲分上一辈 / 同辈 / 下一辈,多看一层的血亲分再上 / 再下一辈;别的按簇 */
export type Slot = 'up' | 'same' | 'down' | 'up2' | 'down2' | Exclude<Cluster, 'blood'>;
/** 图上的一个人:推演人物(civ.people 的下标)或作者的人物(AuthorCharacter.id) */
export type RelRef = { kind: 'person'; id: number } | { kind: 'character'; id: number };

export const CLUSTER_NAME: Readonly<Record<Cluster, string>> = {
  blood: '血亲',
  inlaw: '姻亲',
  court: '君臣',
  rival: '对手',
  author: '作者的人物',
  friend: '师友',
  other: '其他',
  story: '经历里写到',
};

export interface RelNode {
  /** 稳定的键:p + 人物编号 / c + 作者人物编号(换中心时同一个人靠它滑到新位置) */
  k: string;
  ref: RelRef;
  name: string;
  cluster: Cluster;
  slot: Slot;
  /** 名字下面的词:父、子、兄、岳父、将领、名臣、对阵、"父亲是他"…… */
  word: string;
  /** 跟在后面的红字(冲突:架空他、杀他、被他所徙……;"他"指中心那位) */
  tag: string;
  /** 有冲突(杀、争储、架空、放逐、对阵):线是红的 */
  clash: boolean;
  /** 别国的人:后面灰字写国名(简称) */
  sub: string;
  /** 悬停的几句(已换好名字) */
  why: string[];
  /** 身份、年份:"大澜皇帝，2623–2630 年在位" */
  role: string;
  /** 名单里右边的年份(生卒) */
  years: string;
  /** 没即位的宗室:头像外一圈虚线 */
  prince: boolean;
  /** 君主(放不下时先留) */
  ruler: boolean;
  /** 作者的人物:他的颜色(头像描一圈) */
  color: string | null;
  /** 推演人物的国家(头像底色);作者的人物没写国家 = −1 */
  polity: number;
  born: number;
  /** 名气(放不下时先留名气大的) */
  fame: number;
  /** 同一簇里的先后(年份) */
  sort: number;
  /** 多看一层的人:淡一些、小一号 */
  dim: boolean;
  /** 多看一层:经过谁(那位的 k) */
  via: string | null;
}

export interface RelCenter {
  k: string;
  ref: RelRef;
  name: string;
  role: string;
  /** 作者的人物:他的颜色(卡片描一圈) */
  color: string | null;
  polity: number;
}

export interface RelGraph {
  center: RelCenter;
  /** 自己的关系在前,多看一层的在后(deep 时才有) */
  nodes: RelNode[];
  /** 自己的关系有几位 */
  own: number;
  /** 多看一层:打开着 = 多出了几位;没打开 = 能经过的推演人物有几位(只看是不是 0,0 = 按钮不可点;打开以后才去找) */
  more: number;
  /** 一位关系都没有时下面那句原因(有关系 = 空串) */
  empty: string;
}

/** 自己的关系不到这么多位时自动多看一层 */
export const DEEP_BELOW = 5;

// 女的称呼(母、姐、姑母……)和男的同一辈
// 隔着一位女性的(外祖父、舅父、姨母、表兄……,peopleText.ts 的 kinOf)同样按辈分
const UP = new Set([
  ...['父', '养父', '祖父', '曾祖父', '伯父', '叔父', '伯祖', '叔祖', '从伯父', '从叔父'],
  ...['母', '养母', '祖母', '曾祖母', '姑母', '姑祖母', '从姑母'],
  ...['外祖父', '外祖母', '外曾祖父', '外曾祖母', '舅父', '姨母', '舅祖', '姨祖母', '表伯父', '表叔父', '表姑母'],
]);
const SAME = new Set(['兄', '弟', '从兄', '从弟', '族兄', '族弟', '姐', '妹', '从姐', '从妹', '族姐', '族妹', '表兄', '表弟', '表姐', '表妹']);
/** 姻亲簇里的先后 */
export const INLAW_ORDER = ['夫', '妻', '外祖父', '外祖母', '岳父', '岳母', '公公', '婆婆', '女婿', '儿媳', '外孙', '外孙女'];

/** 推演人物血亲的称呼 → 摆在哪一辈 */
export function bloodSlot(word: string): 'up' | 'same' | 'down' {
  return UP.has(word) ? 'up' : SAME.has(word) ? 'same' : 'down';
}

/**
 * 作者人物的亲友"按字归簇"(写的是随便的字,按这个先后认:"师父"进师友、"姐夫"进姻亲、"杀父仇人"进对手);
 * 都认不出("旧识""故人")进其他
 */
export function byWord(rel: string): Exclude<Cluster, 'author' | 'story'> {
  if (/敌|仇|对手/.test(rel)) return 'rival';
  if (/师|友|徒|同窗/.test(rel)) return 'friend';
  if (/妻|夫|岳|婿|嫂|媳|妾|姻/.test(rel)) return 'inlaw';
  if (/主|君|臣|部将|门客|幕僚/.test(rel)) return 'court';
  if (/父|母|子|女|兄|弟|姐|妹|叔|伯|侄|孙|舅|姑|姨|祖/.test(rel)) return 'blood';
  return 'other';
}

/** 作者人物亲友里的血亲按字摆:儿女、孙侄在下,兄弟姐妹同辈,父母叔伯在上 */
export function charKinSlot(rel: string): 'up' | 'same' | 'down' {
  if (/(子|女|儿|孙|侄|甥)$/.test(rel)) return 'down';
  if (/兄|弟|姐|妹/.test(rel)) return 'same';
  if (/父|母|祖|伯|叔|舅|姑|姨/.test(rel)) return 'up';
  return 'down';
}

/** 同辈里算兄姐(摆左边)的 */
export const isElder = (word: string) => /兄|姐/.test(word);

// ---------------------------------------------------------------------------
// 推演人物的关系

/** 一条关系(对方的编号;同一个人几条关系并成一条,留最近的那一簇) */
export interface Tie {
  id: number;
  cluster: 'blood' | 'inlaw' | 'court' | 'rival';
  word: string;
  why: string[];
  clash: boolean;
  sort: number;
  tag: string;
}

const RANK: Record<Tie['cluster'], number> = { blood: 0, inlaw: 1, court: 2, rival: 3 };

const BEAT: Record<NonNullable<Person['claim']>['how'], [string, string]> = {
  merit: ['他以军功越过此人得立', '被他越过'],
  coup: ['他举兵杀之夺位', '被他所杀'],
  revolt: ['拥兵争位，被他击败身死', '被他所杀'],
  intrigue: ['他谮杀之得立', '被他所杀'],
  usurp: ['他杀之自立', '被他所杀'],
  secede: ['他不服此人即位，据地自立', '他自立'],
  march: ['他引兵还朝杀之', '被他所杀'],
  seize: ['他废之自立', '被他所废'],
};
const LOST: Record<NonNullable<Person['claim']>['how'], [string, string]> = {
  merit: ['以军功越过他得立', '越过他'],
  coup: ['举兵杀他夺位', '杀他'],
  revolt: ['他拥兵争位，兵败被杀', '杀他'],
  intrigue: ['谮杀他得立', '杀他'],
  usurp: ['杀他自立', '杀他'],
  secede: ['不服他即位，据地自立', '叛他'],
  march: ['引兵还朝杀他', '杀他'],
  seize: ['废他自立', '废他'],
};

/** 反过来查的索引(谁娶了他的女儿、谁的母亲是他的女儿、谁争储杀了他、谁被他放逐、每场战争谁领过兵),按人物列表存一份 */
interface Reverse {
  wed: Map<number, [Person, PersonSpouse][]>;
  grand: Map<number, Person[]>;
  lost: Map<number, Person[]>;
  exiled: Map<number, Person[]>;
  war: Map<number, Person[]>;
}
const reverseCache = new WeakMap<object, Reverse>();
function reverseIndex(civ: Civ): Reverse {
  const P = civ.people ?? [];
  const hit = reverseCache.get(P);
  if (hit) return hit;
  const r: Reverse = { wed: new Map(), grand: new Map(), lost: new Map(), exiled: new Map(), war: new Map() };
  const push = <T,>(m: Map<number, T[]>, k: number, v: T) => {
    const l = m.get(k);
    if (l) l.push(v);
    else m.set(k, [v]);
  };
  for (const o of P) {
    for (const s of o.spouses ?? []) push(r.wed, s.father, [o, s] as [Person, PersonSpouse]);
    const M = o.mom !== undefined ? P[o.mom] : undefined;
    if (M?.parent !== undefined && M.role === 'consort') push(r.grand, M.parent, o);
    for (const id of o.claim?.rivals ?? []) push(r.lost, id, o);
    if (o.exile?.by !== undefined) push(r.exiled, o.exile.by, o);
    const wars = new Set((o.commands ?? []).map((c) => c.war));
    for (const w of wars) push(r.war, w, o);
  }
  reverseCache.set(P, r);
  return r;
}

/** 先把关系图要反查的索引建好(空闲时调,第一次打开不用等) */
export function warmRelations(civ: Civ) {
  peopleIndex(civ);
  reverseIndex(civ);
}

/**
 * 一个推演人物的全部关系。说明里指 x 的地方写 him(关系图里换成中心那位的名字;不给 = "他" / "她");
 * 名字下面的红字(tag)照旧写"他"(x 是女的写"她")。称呼按对方的性别写(父 / 母、子 / 女、兄 / 姐……)
 */
export function personTies(civ: Civ, x: Person, era?: Era | null, him: string = heOrShe(x)): Tie[] {
  const out = new Map<number, Tie>();
  const ta = heOrShe(x);
  /** 红字里的"他"按 x 的性别 */
  const tg = (t: string) => t.replace(/他/g, ta);
  const P = civ.people ?? [];
  const ix = peopleIndex(civ);
  const rev = reverseIndex(civ);
  const at = (y: number) => spaced(yearAt(y, era));
  const span = (a: number, b?: number) => (b === undefined ? `${yearAt(a, era)}起` : Math.floor(a) === Math.floor(b) ? yearAt(a, era) : yearSpanAt(a, b, era));
  const add = (id: number | undefined, cluster: Tie['cluster'], word: string, why: string, clash = false, sort = 0, tag = '') => {
    if (id === undefined || id === x.id || !P[id]) return;
    const had = out.get(id);
    if (had) {
      if (!had.why.includes(why)) had.why.push(why);
      if (clash) had.clash = true;
      if (tag && !had.tag) had.tag = tag;
      if (RANK[cluster] < RANK[had.cluster]) {
        had.cluster = cluster;
        had.word = word;
      }
      return;
    }
    out.set(id, { id, cluster, word, why: [why], clash, sort, tag });
  };
  // 血亲:父、子、同父的兄弟
  const f = fatherOf(civ, x);
  if (f) {
    const w = kinWord(f, x.adopted ? '养父' : '父');
    add(f.id, 'blood', w, `${him}的${kinWord(f, x.adopted ? '养父' : '父亲')}`, false, 0);
  }
  // 母亲(嫁来的宗室女、临朝的太后)
  const M = motherOf(civ, x);
  if (M) add(M.id, 'blood', '母', `${him}的母亲`, false, 0);
  // 女的:世系里在她名下的 + 母亲记成她的
  for (const k of isFemale(x) ? childrenOf(civ, x) : kidsOf(civ, x))
    add(k.id, 'blood', kinWord(k, k.adopted ? '养子' : '子'), `${him}的${kinWord(k, k.adopted ? '养子' : '儿子')}${k.role === 'prince' ? '，未即位' : ''}`, false, 3);
  if (f) {
    for (const s of kidsOf(civ, f)) {
      if (s.id === x.id) continue;
      const elder = s.born < x.born;
      add(s.id, 'blood', kinWord(s, elder ? '兄' : '弟'), `${him}的${elder ? kinWord(s, '兄长') : isFemale(s) ? '妹妹' : '弟弟'}`, false, 1);
    }
  }
  // 前任、继任
  if (x.role === 'ruler') {
    const rs = ix.rulers[x.polity] ?? [];
    const k = rs.indexOf(x);
    const prev = k > 0 ? rs[k - 1] : undefined;
    const next = k >= 0 && k + 1 < rs.length ? rs[k + 1] : undefined;
    for (const [o, w] of [
      [prev, '前任'],
      [next, '继任'],
    ] as const) {
      if (!o) continue;
      const kin = kinOf(civ, x, o);
      const t = w === '前任' ? `${him}继其位` : `继${him}即位`;
      if (kin) add(o.id, 'blood', kin, t);
      else add(o.id, 'court', w, isConsul(civ, x) ? t : (o.dynasty ?? 0) !== (x.dynasty ?? 0) ? `${t}（${w === '前任' ? '前朝' : '新朝'}）` : t);
    }
  }
  // 姻亲
  if (M?.parent !== undefined && M.role === 'consort') add(M.parent, 'inlaw', kinWord(P[M.parent], '外祖父'), `其女${M.name}是${him}的母亲`);
  // 后妃(临朝篡位的女君也有):丈夫
  if (x.husband !== undefined) {
    const w = brideMatchOf(civ, x);
    add(x.husband, 'inlaw', '夫', w ? `${at(w.year)}嫁给${him}` : `${him}的丈夫`, false, w?.year ?? 0);
  }
  // 她是女的:嫁对方君主的儿子,对方君主是她的公公
  for (const s of x.spouses ?? []) {
    if (isFemale(x)) add(s.father, 'inlaw', bySex(P[s.father], '公公', '婆婆'), `${him}${at(s.year)}嫁其子`, false, s.year);
    else {
      add(s.father, 'inlaw', kinWord(P[s.father], '岳父'), `${him}${at(s.year)}娶其女${brideName(civ, s)}`, false, s.year);
      // 嫁来的宗室女是人物的:她本人
      if (s.person !== undefined) add(s.person, 'inlaw', '妻', `${at(s.year)}嫁给${him}`, false, s.year);
    }
  }
  // 女婿、外孙(按人物编号的先后,和一个个看过去一样)
  const wed = rev.wed.get(x.id) ?? [];
  const grand = rev.grand.get(x.id) ?? [];
  for (let i = 0, j = 0; i < wed.length || j < grand.length; ) {
    const o = i < wed.length && (j >= grand.length || wed[i][0].id <= grand[j].id) ? wed[i][0] : grand[j];
    while (i < wed.length && wed[i][0] === o) {
      const s = wed[i++][1];
      if (isFemale(o)) add(o.id, 'inlaw', '儿媳', `${yearAt(s.year, era)}嫁${him}的儿子`, false, s.year);
      else add(o.id, 'inlaw', '女婿', `${yearAt(s.year, era)}娶${him}的女儿${brideName(civ, s)}`, false, s.year);
    }
    if (j < grand.length && grand[j] === o) add(o.id, 'inlaw', kinWord(o, '外孙'), `${him}的女儿${P[grand[j++].mom!]?.name ?? ''}所生`);
  }
  // 争储、杀他、掌实权、放逐(对方是亲属的仍算血亲)
  if (x.claim) {
    const [w0, tag] = BEAT[x.claim.how];
    const why = w0.replace(/他/g, him);
    for (const r of x.claim.rivals) {
      const o = P[r];
      if (!o) continue;
      const kin = kinOf(civ, x, o);
      add(r, kin ? 'blood' : 'rival', kin || '争储', why, true, 2, tg(tag));
    }
  }
  for (const o of rev.lost.get(x.id) ?? []) {
    if (!o.claim) continue;
    const kin = kinOf(civ, x, o);
    const [w0, tag] = LOST[o.claim.how];
    const why = w0.replace(/他/g, him);
    add(o.id, kin ? 'blood' : 'rival', kin || '争储', why, true, 2, tg(tag));
  }
  if (x.rival !== undefined && !out.get(x.rival)?.tag) {
    const o = P[x.rival];
    const kin = o ? kinOf(civ, x, o) : '';
    add(x.rival, kin ? 'blood' : 'rival', kin || '对手', `杀${him}`, true, 2, tg('杀他'));
  }
  for (const h of heldOver(civ, x)) {
    const kin = kinOf(civ, x, h.x);
    add(h.x.id, kin ? 'blood' : h.x.role === 'minister' || h.x.role === 'general' ? 'court' : 'rival', kin || '权臣', `${span(h.g.from, h.g.until)}架空${him}、掌实权`, true, 2, tg('架空他'));
  }
  for (const g of x.regencies ?? []) {
    const o = P[g.ruler];
    if (!o) continue;
    const kin = kinOf(civ, x, o);
    add(o.id, kin ? 'blood' : 'court', kin || '君主', `${span(g.from, g.until)}在位时被${him}架空`, true, 2, tg('被他架空'));
  }
  if (x.exile?.by !== undefined) {
    const o = P[x.exile.by];
    if (o) {
      const kin = kinOf(civ, x, o);
      add(o.id, kin ? 'blood' : 'rival', kin || '放逐', `${yearAt(x.exile.year, era)}徙${him}`, true, 2, tg('徙他'));
    }
  }
  for (const o of rev.exiled.get(x.id) ?? []) {
    const kin = kinOf(civ, x, o);
    add(o.id, kin ? 'blood' : 'rival', kin || '放逐', `${yearAt(o.exile!.year, era)}被${him}所徙`, true, 2, tg('被他所徙'));
  }
  // 君臣
  if (x.role === 'ruler') {
    const from = x.from ?? x.born;
    const until = x.until ?? civ.endYear;
    for (const g of ix.generals[x.polity] ?? []) {
      const cs = (g.commands ?? []).filter((c) => c.until > from && c.from < until);
      if (cs.length) add(g.id, 'court', g.role === 'prince' ? '宗室' : '将领', `替${him}领兵（${span(cs[0].from, cs[cs.length - 1].until)}）`, false, cs[0].from);
    }
    for (const m of ix.ministers[x.polity] ?? []) {
      const mf = m.from ?? m.born;
      if (mf < until && (m.until ?? Infinity) > from) add(m.id, 'court', '名臣', `${him}在位时任${m.posts?.[m.posts.length - 1]?.title ?? '大臣'}（${span(mf, m.until)}在朝）`, false, mf);
    }
  } else {
    const cs = x.commands ?? [];
    const from = x.role === 'minister' ? (x.from ?? x.born) : cs[0]?.from;
    const until = x.role === 'minister' ? (x.until ?? civ.endYear) : cs[cs.length - 1]?.until;
    if (from !== undefined && until !== undefined) {
      for (const r of ix.rulers[x.polity] ?? []) {
        const rf = r.from ?? Infinity;
        const ru = r.until ?? Infinity;
        const hit = x.role === 'minister' ? rf < until && ru > from : cs.some((c) => rf < c.until && ru > c.from);
        if (!hit) continue;
        const kin = kinOf(civ, x, r);
        add(r.id, kin ? 'blood' : 'court', kin || '君主', `${him}效力于此君（${span(Math.max(r.from ?? 0, from), Math.min(ru, until))}）`, false, r.from ?? 0);
      }
    }
  }
  // 对手:同一场仗对面的统帅
  const cs = x.commands ?? [];
  if (cs.length) {
    const wars = ix.wars;
    // 同一场战争里领过兵的人(按人物编号的先后)
    const seen = new Set<Person>();
    for (const c of cs) for (const o of rev.war.get(c.war) ?? []) seen.add(o);
    for (const o of [...seen].sort((a, b) => a.id - b.id)) {
      if (o.id === x.id || o.polity === x.polity || !o.commands) continue;
      const hit = o.commands.filter((oc) => cs.some((c) => c.war === oc.war && oc.side !== c.side && oc.until > c.from && oc.from < c.until));
      if (!hit.length) continue;
      const w = wars.get(hit[0].war);
      const mine = cs.find((c) => c.war === hit[0].war)!;
      const pol = civ.polities[o.polity];
      add(o.id, 'rival', '对阵', `${yearAt(Math.max(hit[0].from, mine.from), era)}${him}${mine.side === 0 ? '伐' : '抗'}${w && pol ? polityName(pol, hit[0].from) : ''}，此人在对面领兵`, true, hit[0].from);
    }
  }
  return [...out.values()];
}

// ---------------------------------------------------------------------------
// 一个人的样子

/** 身份、年份(同人物卡顶上那一行):"大澜皇帝，2593–2623 年在位""大澜宗室，2599–2620" */
export function personRoleLine(civ: Civ, x: Person, era?: Era | null): string {
  const span = personSpan(x);
  const consul = isConsul(civ, x);
  if (x.role === 'consort') {
    // 临朝的太后:"大衍太后，2414–2421 年临朝";嫁来的宗室女:"大澜公主，2601–2662"
    const g = dowagerSpans(x)[0];
    if (g) {
      const east = !!civ.polities[P0(civ, g.ruler)?.polity ?? x.polity]?.eastern;
      return `${consortRole(civ, x)}，${span.until === null ? `${yearAt(span.from, era)}起` : yearSpanAt(span.from, span.until, era)}${east ? '临朝' : '摄政'}`;
    }
    return `${consortRole(civ, x, brideMatchOf(civ, x)?.year)}，${yearShort(x.born, era)}–${x.died !== undefined ? yearShort(x.died, era) : ''}`;
  }
  if (x.role === 'prince') return `${princeRole(civ, x)}，${yearShort(x.born, era)}–${x.died !== undefined ? yearShort(x.died, era) : ''}`;
  if (x.role === 'ruler')
    return span.until === null ? `${rulerRole(civ, x)}，${yearAt(span.from, era)}${consul ? '就任' : '即位'}` : `${rulerRole(civ, x)}，${yearSpanAt(span.from, span.until, era)}${consul ? '在任' : '在位'}`;
  if (x.role === 'minister')
    return span.until === null ? `${ministerRole(civ, x)}，${yearAt(span.from, era)}起在朝` : `${ministerRole(civ, x)}，${yearSpanAt(span.from, span.until, era)}在朝`;
  return `${generalRole(civ, x)}，${yearSpanAt(span.from, span.until ?? civ.endYear, era)}领兵`;
}

const P0 = (civ: Civ, id: number) => civ.people?.[id];

const lifeShort = (born: number, died: number | undefined, era?: Era | null) => (died !== undefined ? yearSpan(born, died, era) : `${yearShort(born, era)}–`);

/** 他在台上那几年(国名按那时候的) */
const activeYear = (civ: Civ, x: Person) => Math.min(x.until ?? x.died ?? civ.endYear, civ.polities[x.polity]?.ended ?? civ.endYear) - 0.01;

/** 嫁到别国的女儿(中心不是她丈夫那一国):灰字写"嫁克拉尔";别的 = undefined(照常写别国的国名) */
function wedSub(civ: Civ, x: Person, centerPolity: number): string | undefined {
  if (x.role !== 'consort' || x.husband === undefined) return undefined;
  const H = civ.people?.[x.husband];
  const w = brideMatchOf(civ, x);
  if (!H || !w || H.polity === x.polity || H.polity === centerPolity) return undefined;
  return `嫁${polityShort(civ, H.polity, w.year)}`;
}

/** 推演人物的一格(还没定簇、名字下面写什么) */
function personNode(civ: Civ, x: Person, centerPolity: number, era?: Era | null): RelNode {
  return {
    k: `p${x.id}`,
    ref: { kind: 'person', id: x.id },
    name: personName(civ, x),
    cluster: 'blood',
    slot: 'down',
    word: '',
    tag: '',
    clash: false,
    sub: wedSub(civ, x, centerPolity) ?? (x.polity !== centerPolity && civ.polities[x.polity] ? polityShort(civ, x.polity, activeYear(civ, x)) : ''),
    why: [],
    role: personRoleLine(civ, x, era),
    years: lifeShort(x.born, x.died, era),
    prince: x.role === 'prince',
    ruler: x.role === 'ruler',
    color: null,
    polity: x.polity,
    born: x.born,
    fame: personFame(civ, x)?.score ?? 0,
    sort: 0,
    dim: false,
    via: null,
  };
}

function charNode(c: AuthorCharacter, polity: number, era?: Era | null): RelNode {
  return {
    k: `c${c.id}`,
    ref: { kind: 'character', id: c.id },
    name: c.name,
    cluster: 'author',
    slot: 'author',
    word: '',
    tag: '',
    clash: false,
    sub: '',
    why: [],
    role: `作者的人物，${lifeYears(c, era ?? undefined)}`,
    years: lifeShort(c.born, c.died, era),
    prince: false,
    ruler: false,
    color: MARK_HEX[c.color],
    polity,
    born: c.born,
    fame: 0,
    sort: c.born,
    dim: false,
    via: null,
  };
}


// ---------------------------------------------------------------------------
// 一张图

export interface GraphOpts {
  /** 多看一层:null = 照自动(自己的关系不到 5 位时打开) */
  deep?: boolean | null;
  era?: Era | null;
  /** 作者人物的国家(头像的服饰、底色;算不出 = −1)。不给 = 只看他写的国家 */
  charPolity?: (c: AuthorCharacter) => number;
}

/** 这个人在不在(推演人物的编号、作者人物的编号对得上) */
export function refExists(civ: Civ, chars: readonly AuthorCharacter[] | undefined, ref: RelRef): boolean {
  return ref.kind === 'person' ? !!civ.people?.[ref.id] && !!civ.polities[civ.people[ref.id].polity] : !!chars?.some((c) => c.id === ref.id);
}

export const refKey = (ref: RelRef) => `${ref.kind === 'person' ? 'p' : 'c'}${ref.id}`;

/** 以 ref 为中心的一张关系图;人不在了 = null */
export function relationGraph(civ: Civ, chars: readonly AuthorCharacter[] | undefined, ref: RelRef, opts: GraphOpts = {}): RelGraph | null {
  const era = opts.era ?? null;
  const polOf = opts.charPolity ?? ((c: AuthorCharacter) => -1);
  if (ref.kind === 'person') {
    const x = civ.people?.[ref.id];
    if (!x || !civ.polities[x.polity]) return null;
    return personGraph(civ, chars ?? [], x, polOf, opts.deep ?? null, era);
  }
  const c = chars?.find((q) => q.id === ref.id);
  if (!c) return null;
  return charGraph(civ, chars ?? [], c, polOf, opts.deep ?? null, era);
}

function personGraph(civ: Civ, chars: readonly AuthorCharacter[], x: Person, polOf: (c: AuthorCharacter) => number, deep: boolean | null, era: Era | null): RelGraph {
  const P = civ.people!;
  const center: RelCenter = { k: `p${x.id}`, ref: { kind: 'person', id: x.id }, name: personName(civ, x), role: personRoleLine(civ, x, era), color: null, polity: x.polity };
  const nodes: RelNode[] = [];
  for (const t of personTies(civ, x, era, center.name)) {
    const n = personNode(civ, P[t.id], x.polity, era);
    Object.assign(n, { cluster: t.cluster, slot: t.cluster === 'blood' ? bloodSlot(t.word) : t.cluster, word: t.word, tag: t.tag, clash: t.clash, why: t.why, sort: t.sort });
    nodes.push(n);
  }
  // 作者的人物:亲友里写了他、经历里勾了他的
  const key = personKey(civ, x.id);
  if (key) {
    for (const c of chars) {
      const kin = c.kin?.find((k) => k.person === key);
      const lives = lifeInOrder(c).filter(({ e }) => e.people?.includes(key));
      if (!kin && !lives.length) continue;
      const n = charNode(c, polOf(c), era);
      const why: string[] = [];
      // 作者写的字(人物名、关系、经历)原样放,不换里面的"他"
      if (kin) why.push(`${c.name}的亲友里写着：${kin.rel ? `${kin.rel}是${center.name}` : `有${center.name}`}`);
      for (const { e } of lives) why.push(`经历里写到${center.name}：${yearAt(e.year, era)}${e.text || '（没写经历）'}`);
      const ta = heOrShe(x);
      n.word = kin ? (kin.rel ? `${kin.rel}是${ta}` : `亲友里有${ta}`) : `经历里写到${ta}`;
      n.why = why;
      nodes.push(n);
    }
  }
  const own = nodes.length;
  const on = deep ?? own < DEEP_BELOW;
  const ring2 = on ? deepRing(civ, x, null, nodes, x.polity, era) : [];
  return { center, nodes: [...nodes, ...ring2], own, more: on ? ring2.length : vias(nodes), empty: own ? '' : emptyReason(civ, x, era) };
}

function charGraph(civ: Civ, chars: readonly AuthorCharacter[], c: AuthorCharacter, polOf: (c: AuthorCharacter) => number, deep: boolean | null, era: Era | null): RelGraph {
  const P = civ.people ?? [];
  const center: RelCenter = { k: `c${c.id}`, ref: { kind: 'character', id: c.id }, name: c.name, role: `作者的人物，${lifeYears(c, era ?? undefined)}`, color: MARK_HEX[c.color], polity: polOf(c) };
  const nodes: RelNode[] = [];
  const seen = new Set<string>();
  for (const k of c.kin ?? []) {
    let n: RelNode | null = null;
    if (k.char !== undefined) {
      const o = chars.find((q) => q.id === k.char);
      if (o && o.id !== c.id) n = charNode(o, polOf(o), era);
    } else if (k.person) {
      const id = resolvePersonKey(civ, k.person);
      if (id >= 0 && P[id] && civ.polities[P[id].polity]) n = personNode(civ, P[id], center.polity, era);
    }
    if (!n || seen.has(n.k)) continue;
    seen.add(n.k);
    const rel = k.rel.trim();
    const cl = rel ? byWord(rel) : 'other';
    Object.assign(n, { cluster: cl, slot: cl === 'blood' ? charKinSlot(rel) : cl, word: rel || '亲友', why: [`${c.name}的${rel || '亲友'}`] });
    nodes.push(n);
  }
  // 经历里勾到的推演人物
  for (const { e } of lifeInOrder(c)) {
    for (const pk of e.people ?? []) {
      const id = resolvePersonKey(civ, pk);
      if (id < 0 || !P[id] || !civ.polities[P[id].polity]) continue;
      const line = `${yearAt(e.year, era)}${e.text || '（没写经历）'}`;
      const had = nodes.find((q) => q.k === `p${id}`);
      if (had) {
        if (!had.why.includes(line)) had.why.push(line);
        continue;
      }
      const n = personNode(civ, P[id], center.polity, era);
      Object.assign(n, { cluster: 'story', slot: 'story', word: '经历里写到', why: [line], sort: e.year });
      nodes.push(n);
    }
  }
  const own = nodes.length;
  const on = deep ?? own < DEEP_BELOW;
  const ring2 = on ? deepRing(civ, null, c, nodes, center.polity, era) : [];
  return {
    center,
    nodes: [...nodes, ...ring2],
    own,
    more: on ? ring2.length : vias(nodes),
    empty: own ? '' : '亲友里还没写人，经历里也没勾推演里的人',
  };
}

/** 第一圈里能经过的推演人物有几位(多看一层从他们往外找) */
const vias = (nodes: readonly RelNode[]) => nodes.filter((n) => n.ref.kind === 'person').length;

/** 称呼的全写(多看一层:"父亲的女婿""兄长的将领") */
const FULL: Record<string, string> = {
  父: '父亲',
  养父: '养父',
  兄: '兄长',
  弟: '弟弟',
  子: '儿子',
  养子: '养子',
  侄: '侄子',
  孙: '孙子',
  叔父: '叔父',
  伯父: '伯父',
  外祖父: '外祖父',
  岳父: '岳父',
  女婿: '女婿',
  外孙: '外孙',
  母: '母亲',
  养母: '养母',
  姐: '姐姐',
  妹: '妹妹',
  女: '女儿',
  养女: '养女',
  侄女: '侄女',
  孙女: '孙女',
  姑母: '姑母',
  外祖母: '外祖母',
  岳母: '岳母',
  外孙女: '外孙女',
  公公: '公公',
  婆婆: '婆婆',
  儿媳: '儿媳',
};

/** 多看一层:经过的每一位,每一簇最多多出这么几位 */
export const DEEP_PER_VIA = 2;

/**
 * 多看一层:第一圈每个推演人物自己的关系(第一圈和中心那位不算),只看和经过那位最近的几样 ——
 * 父辈:他的血亲、姻亲、君臣;兄弟、儿子:他们的血亲(侄、孙);君主:同朝的将领、名臣(和中心那位在台上的年份隔得近的在前);
 * 将领、名臣:效力的君主;对手、姻亲、作者写的亲友:他们的血亲。经过的每一位、每一簇最多 DEEP_PER_VIA 位,按年份先后。
 * 按世系算得出和中心那位是什么亲的放血亲(祖父在上、侄孙挂在他父亲下面),算不出的写"父亲的女婿""同朝将领""某某之父",
 * 簇跟着那一条关系(对方是经过那位的血亲时,跟着经过那位的簇)
 */
function deepRing(civ: Civ, x: Person | null, c: AuthorCharacter | null, first: readonly RelNode[], centerPolity: number, era: Era | null): RelNode[] {
  const P = civ.people ?? [];
  const taken = new Set(first.map((n) => n.k));
  if (x) taken.add(`p${x.id}`);
  const span = x ? personSpan(x) : null;
  const mine = span ? ([span.from, span.until ?? civ.endYear] as const) : null;
  const out: RelNode[] = [];
  for (const via of first) {
    if (via.ref.kind !== 'person') continue;
    const v = P[via.ref.id];
    const allow = (u: Tie): boolean => {
      if (via.cluster === 'blood') return via.slot === 'up' ? u.cluster !== 'rival' : u.cluster === 'blood';
      if (via.cluster === 'court') return u.cluster === 'court';
      return u.cluster === 'blood';
    };
    // 同朝的人:和中心那位在台上的年份隔得近的在前(有重叠的最前)
    const gap = (u: Tie) => {
      if (via.word !== '君主' || !mine) return 0;
      const s = personSpan(P[u.id]);
      return Math.max(0, s.from - mine[1], mine[0] - (s.until ?? civ.endYear));
    };
    const ties = personTies(civ, v, era, via.name)
      .filter((u) => !taken.has(`p${u.id}`) && allow(u))
      .sort((a, b) => gap(a) - gap(b) || (a.cluster === 'inlaw' && b.cluster === 'inlaw' ? INLAW_ORDER.indexOf(a.word) - INLAW_ORDER.indexOf(b.word) : 0) || a.sort - b.sort || a.id - b.id);
    const count = new Map<string, number>();
    for (const u of ties) {
      const o = P[u.id];
      const kin = x ? kinOf(civ, x, o) : '';
      const viaWord = FULL[via.word] ?? (c && via.cluster !== 'story' ? via.word : '');
      let word: string;
      if (kin) word = kin;
      else if (via.word === '君主' && (u.word === '将领' || u.word === '名臣')) word = `同朝${u.word}`;
      else if (viaWord) word = `${viaWord}的${FULL[u.word] ?? u.word}`;
      else word = `${via.name}之${u.word}`;
      let cluster: Cluster = kin ? 'blood' : u.cluster === 'blood' ? via.cluster : u.cluster;
      let slot: Slot = kin ? (UP.has(kin) ? 'up2' : 'down2') : (cluster as Slot);
      // 算不出称呼的血亲(作者的人物居中):父亲的父亲、兄弟的儿子照样摆在家谱上下,别的放其他
      if (!kin && cluster === 'blood') {
        if (via.slot === 'up' && UP.has(u.word)) slot = 'up2';
        else if ((via.slot === 'same' || via.slot === 'down') && (u.word === '子' || u.word === '养子' || u.word === '女' || u.word === '养女')) slot = 'down2';
        else slot = cluster = 'other';
      }
      const n = (count.get(cluster) ?? 0) + 1;
      if (n > DEEP_PER_VIA) continue;
      count.set(cluster, n);
      taken.add(`p${u.id}`);
      const node = personNode(civ, o, centerPolity, era);
      Object.assign(node, { cluster, slot, word, clash: u.clash, why: u.why, sort: u.sort, dim: true, via: via.k });
      out.push(node);
    }
  }
  return out;
}

/** 一位关系都没有时的原因:"他只在 1488 年抗大岳时领过一次兵；那几年太岳国的君主、对面的统帅，推演里都没有记下。" */
export function emptyReason(civ: Civ, x: Person, era?: Era | null): string {
  const pol = civ.polities[x.polity];
  const ta = heOrShe(x);
  const pn = pol ? polityName(pol, activeYear(civ, x)) : `${ta}的国家`;
  const cs = x.commands ?? [];
  if (cs.length) {
    const wars = new Set(cs.map((c) => c.war));
    const w = peopleIndex(civ).wars.get(cs[0].war);
    const foe = w ? (cs[0].side === 0 ? w.b : w.a) : -1;
    const foeName = foe >= 0 && civ.polities[foe] ? polityName(civ.polities[foe], cs[0].from) : '';
    const once = wars.size === 1 && foeName ? `${ta}只在${spaced(yearAt(cs[0].from, era))}${cs[0].side === 0 ? '伐' : '抗'}${foeName}时领过一次兵` : `${ta}${spaced(yearSpanAt(cs[0].from, cs[cs.length - 1].until, era))}领过兵`;
    return `${once}；那几年${pn}的君主、对面的统帅，推演里都没有记下。`;
  }
  if (x.role === 'minister') return `那几年${pn}的君主、同朝的人，推演里都没有记下。`;
  if (x.role === 'prince') return `推演里没记下${ta}的父兄、子嗣。`;
  return `推演里没记下${ta}的前任、继任和同朝的人。`;
}
