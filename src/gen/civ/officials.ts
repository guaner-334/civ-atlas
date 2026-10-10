/**
 * 名臣(文臣),和将领的官职、字号、籍贯。推演结束、排好君主和统帅以后调用(people.ts),
 * 和统帅一样按已经推出来的历史"贴"上去 —— 一样都不改,纯计算,不碰 DOM。
 *
 * **名臣**:按年份往后走,只看到当时为止的事(后来的历史变了,先前的大臣不变)。这一朝里真发生的事,每件找一位当时在朝、
 * 手上的事没满(一位最多经手 DEEDS_MAX 件)的大臣经手;没人在朝就当年起用一位,有人但都满了,要紧的事(PRIO_NEW)才另起一位:
 *   found     佐命:一朝的第一位上台时(立国、起兵代之、叛离自立、复国、篡位)
 *   regent    辅政:幼主(不满 YOUNG 岁)即位,辅政到他 ADULT 岁
 *   rank      劝进:国号升格、国号跟着变(称王、称帝、称大汗)
 *   enthrone  拥立:先君遇弑,迎立新君
 *   capital   迁都:主动迁都(力主迁都)、国都失守以后迁都(护驾)
 *   relief    赈灾:地形大事里本国受灾
 *   peace     议和:出使议和(得失的州记在史事里)
 *   war       主战:本国宣战时力主讨伐
 *   defend    守御:本国被攻时督运粮草、主持守御
 * 没人在朝的空当长了(GAP:王国、帝国 30–50 年,小国长些)补一位(在朝几十年、没经手大事的守成之臣);部落没有大臣。
 * 每位都在起他的那一年入仕,所以作者干预某一年以后,那年以前入仕的大臣一个不多、一个不少。
 * **官职**:入仕到去职一级级升(官名按当时的国号档位,东方、西幻、汗国、共和国各一套,见 CIVIL);
 *   同一时间最高的那个官(丞相、首相……)只有一位,后来的写次一级(TOP_ALT)。
 * **结局**:卒于任上(died)/ 致仕(retired)/ 新君即位时罢官(deposed);一朝终了时还在朝的:
 *   殉国(fell)、降(surrendered:亡国时降灭它的国家,改朝换代时归顺新朝)、归隐(fled)、随国归附(merged)。
 * **将领**:每次领兵时按此前打赢的仗数升官(MILITARY:校尉 → 中郎将 → 偏将军 → 前后左右将军 → 车骑将军 → 大将军;西幻骑士 → 统领 → 元帅……)。
 * **字号**:东方带姓的语感(中原、仙侠)的大臣、将领有字;一部分大臣有号(Person.art:号的后半,前半是籍贯的城名,见 officialText.ts)。
 *   其余语感没有字号。
 * **籍贯**:入仕(第一次领兵)那年本国的一座城,国都的机会大些。
 *
 * 随机数 keyed4(subSeed(seed, 'civ-officials'), 国家的位置锚, 第几朝, 键 × 16 + 用途, 种类),键按起这位大臣的那一年和缘由(不按第几位);
 * 将领按"国家的位置锚 + 本国第几位将领"。名字和将领一起按出道先后起,不和此前的人物重名(people.ts 的 NameBook)。
 */
import { Layer, type Annal, type ChangeLog, type Person, type PersonDeed, type PersonFate, type PersonPost, type Polity, type Settlement, type UpheavalFact, type Year } from './types';
import { keyed4, subSeed } from './rand';
import { capitalAt, polityTierAt, polityTitles } from './growth';

// ---- 调参 ----
/** 一位最多经手几件事 */
const DEEDS_MAX = 3;
/** 幼主:即位不满这么多岁;辅政到他这么多岁 */
const YOUNG = 12;
const ADULT = 18;
/** 入仕的年纪、因一件事起用的年纪、致仕的年纪、寿命 */
const ENTER_AGE: [number, number] = [20, 30];
const CALL_AGE: [number, number] = [28, 50];
const RETIRE_AGE: [number, number] = [62, 76];
const LIFE: [number, number] = [58, 86];
/** 佐命之臣:开国时的年纪 */
const FOUND_AGE: [number, number] = [26, 44];
/** 一朝里没人在朝这么些年就补一位(王国、帝国 / 国):在朝几十年、没经手大事的守成之臣 */
const GAP: [number, number][] = [
  [30, 50],
  [50, 90],
];
/** 已经有人在朝、可他们经手的事满了:这么要紧的事(越小越要紧)才另起一位 */
const PRIO_NEW = 1;
/** 寻常的事(打仗、运粮、一般的议和、国都失守):没人在朝时只有 MINOR_NEW 的机会起一位 */
const PRIO_MINOR = 4;
const MINOR_NEW = 0.5;
/** 新君即位后一年内去职的,罢官的机会 */
const DISMISS = 0.4;
/** 一朝终了时还在朝:殉国、降的机会(其余归隐) */
const MARTYR = 0.35;
const YIELD = 0.4;
/** 籍贯是国都的机会(其余按城的大小挑) */
const HOME_CAPITAL = 0.2;
/** 有号的机会:大臣 / 将领 */
const ART: [number, number] = [0.4, 0.12];
/** 没经手大事的大臣做到次一级就止的机会 */
const CAPPED = 0.45;

// 随机数用途
const U_GAP = 0;
const U_MINOR = 14;
const U_AGE = 1;
const U_LIFE = 3;
const U_RETIRE = 4;
const U_FATE = 5;
const U_HOME = 6;
const U_STYLE = 7;
const U_CHAR = 8;
const U_ART = 9;
const U_ART2 = 10;
const U_DEPT = 11;
const U_POSTS = 12;
const U_CAP = 13;
/** keyed4 最后一位:大臣 / 将领 / 空当多长 */
const K_MINISTER = 0;
const K_GENERAL = 1;
const K_GAP = 2;
/** 大臣的随机数按起他的那一年(× SLOT_Q 取整)和缘由(经手的事 / 补空当 / 一朝终了),不按第几位 */
const SLOT_Q = 8;

const TICK = 256;
const q = (x: number) => Math.round(x * TICK) / TICK;
const lerp = (r: [number, number], u: number) => r[0] + (r[1] - r[0]) * u;

// ---------------------------------------------------------------------------
// 官名

/** 官制的一系:东方 / 西幻 / 汗国 / 共和国 */
type System = 'east' | 'west' | 'khan' | 'republic';

function systemOf(p: Polity): System {
  if (p.lineage === 'khanate') return 'khan';
  if (p.lineage === 'republic') return 'republic';
  return p.eastern ? 'east' : 'west';
}

/** 文官从低到高(按档位;最后一个是最高的那个官)。部落(档位 0)没有,共和国从城邦起就有 */
const CIVIL: Record<System, (string[] | null)[]> = {
  east: [null, ['邑宰', '大夫', '卿', '相'], ['邑宰', '大夫', '上卿', '相国'], ['县令', '郎中', '侍郎', '尚书', '丞相']],
  west: [null, ['书记官', '管家', '宫相'], ['书记官', '郡守', '掌玺大臣', '首相'], ['书记官', '行省总督', '掌玺大臣', '宰相']],
  khan: [null, ['必阇赤', '断事官', '大断事官'], ['必阇赤', '断事官', '大断事官'], ['必阇赤', '断事官', '大断事官']],
  republic: [
    ['财务官', '营造官', '裁判官', '监察官'],
    ['财务官', '营造官', '裁判官', '监察官'],
    ['财务官', '营造官', '裁判官', '监察官'],
    ['财务官', '行省总督', '裁判官', '监察官'],
  ],
};
/** 最高的官已经有人时,后来的写这个(按一系、档位) */
const TOP_ALT: Record<System, (string | null)[]> = {
  east: [null, '司徒', '亚卿', '御史大夫'],
  west: [null, '总管', '财政大臣', '财政大臣'],
  khan: [null, '断事官', '断事官', '断事官'],
  republic: ['裁判官', '裁判官', '裁判官', '裁判官'],
};
/** 东方帝国级的"尚书"按经手的事挑哪一部;没有对得上的随机 */
const DEPT: Partial<Record<PersonDeed['kind'], string>> = { peace: '礼部', relief: '户部', capital: '工部', regent: '吏部', enthrone: '吏部', rank: '礼部', war: '兵部', defend: '户部' };
const DEPTS = ['吏部', '户部', '礼部', '兵部', '刑部', '工部'];

/** 武官从低到高(按一系、档位);"前后左右"在 generalPosts 里按人挑 */
const MILITARY: Record<System, string[][]> = {
  east: [['偏将'], ['司马', '将军'], ['司马', '将军', '上将军'], ['校尉', '中郎将', '偏将军', '*将军', '车骑将军', '大将军']],
  west: [['战士'], ['骑士', '统领'], ['骑士', '统领', '元帅'], ['骑士', '统领', '元帅', '大元帅']],
  khan: [['十夫长'], ['百夫长', '千户', '万户'], ['百夫长', '千户', '万户'], ['百夫长', '千户', '万户', '大万户']],
  republic: [['百夫长', '军团长'], ['百夫长', '军团长', '统帅'], ['百夫长', '军团长', '统帅'], ['百夫长', '军团长', '统帅']],
};
/** 升到第 k 级要先打赢几仗(攻下的州 + 守住的仗) */
const PROMOTE = [0, 2, 4, 7, 10, 14];
const WINGS = ['前', '后', '左', '右'];

const clampTier = (t: number) => Math.max(0, Math.min(3, t));

// ---------------------------------------------------------------------------
// 字号

/** 字的前一个字 / 后一个字(和名里的字不重) */
const COURTESY_HEAD = ['子', '伯', '仲', '叔', '季', '元', '文', '德', '公', '长', '景', '彦', '孟', '仲'];
const COURTESY_TAIL = ['之', '卿', '甫', '夫'];
/** 字里用的字(按语感;带姓的两种) */
const COURTESY_CHARS: Record<string, string> = {
  central: '昭明远达通和正信德方平安宁谦恭惠厚仁义礼智敬济光华修彦云衡伯舒朗博渊文良弘承泰谨直诚思道',
  xianxia: '玄清微远渺离寒澈遥尘霄岚霁云深幽宁默逸白素凝隐川羽泓旷',
};
/** 号的后半(按语感) */
const ART_TAIL: Record<string, string[]> = {
  central: ['居士', '先生', '山人', '老人', '主人'],
  xianxia: ['居士', '散人', '真人', '子', '山人'],
};
/** 籍贯城名只有一个字时,号补一个字("汾" → "汾阳居士") */
const ART_PAD = ['阳', '山', '溪', '亭', '川'];

function pickOf<T>(list: readonly T[], u: number): T {
  return list[Math.min(list.length - 1, Math.floor(u * list.length))];
}

/** 字:"子昭""伯远""达之";和名里的字不重 */
export function courtesyName(style: string, name: string, R: (use: number) => number): string {
  const pool = [...(COURTESY_CHARS[style] ?? COURTESY_CHARS.central)].filter((c) => !name.includes(c));
  const ch = pickOf(pool, R(U_CHAR));
  const u = R(U_STYLE);
  if (u < 0.2) return ch + pickOf(COURTESY_TAIL, (u / 0.2 + R(U_ART2)) % 1);
  const head = pickOf(
    COURTESY_HEAD.filter((c) => !name.includes(c) && c !== ch),
    (u - 0.2) / 0.8,
  );
  return head + ch;
}

/** 号的后半(前半是籍贯城名去掉"城"字;一个字的补一个字):有号的机会按身份 */
function artTail(style: string, R: (use: number) => number, chance: number): string | undefined {
  const tails = ART_TAIL[style];
  if (!tails || R(U_ART) >= chance) return undefined;
  return pickOf(tails, R(U_ART2));
}

/** 号:籍贯城名("揽霞城" → "揽霞";"汾城" → "汾阳")+ 后半 */
export function artName(city: string, tail: string): string {
  let base = city.replace(/(城|镇|邑|关|堡|寨|州|郡|县|村|集)$/, '');
  if (!base) base = city;
  if ([...base].length === 1) base += ART_PAD[base.charCodeAt(0) % ART_PAD.length];
  return base + tail;
}

// ---------------------------------------------------------------------------

export interface OfficialsInput {
  seed: number;
  endYear: Year;
  polities: readonly Polity[];
  settlements: readonly Settlement[];
  annals: readonly Annal[];
  upheavals?: readonly UpheavalFact[];
  /** 归属日志(timeline.ts 的那一份):籍贯、筑城要知道某一年哪个州归谁 */
  log: Pick<ChangeLog, 'size' | 'year' | 'region' | 'layer' | 'value'>;
  regionCount: number;
}

export interface OfficialsCtx {
  /** 国家的位置锚(people.ts) */
  tag: readonly number[];
  /** 每国的君主(即位先后) */
  rulers: readonly Person[][];
  /** 语感 */
  styleOf: (p: Polity) => string;
  /** 带不带姓、起名 */
  namerOf: (p: Polity) => { surnamed: boolean; surname(...k: number[]): string; given(...k: number[]): string };
}

export interface Officials {
  /** 名臣(按国家、朝代、入仕先后);名字还空着 */
  ministers: Person[];
  /** deed.person 先记成 Person,等 people.ts 排好编号再换 */
  fixups: [PersonDeed, Person][];
  /** 名臣第 a 次试的名字(people.ts 和将领一起按出道先后起名,见 NameBook) */
  nameAt: Map<Person, (a: number) => string>;
  /** 名字定了以后调:名臣、将领的字(字和名里的字不重) */
  finish: () => void;
}

/** 一件可以经手的事 */
interface Anchor {
  kind: PersonDeed['kind'];
  year: Year;
  /** 越小越要紧 */
  prio: number;
  deed: PersonDeed;
  /** 记在 deed.person 上的人(排好编号后换成编号) */
  who?: Person;
}

/** 正在排的一位大臣 */
interface Draft {
  x: Person;
  enter: Year;
  leave: Year;
  life: Year;
  /** 随机数的键(起他的那一年、缘由) */
  slot: number;
  anchors: Anchor[];
}

/**
 * 排出所有名臣(role = minister),顺带给将领填上籍贯、号、官职。
 * 按年份往后走,只看到当时为止的事:一件事来了,找一位当时在朝、手上的事没满的大臣经手,没有就新起一位;
 * 没人在朝的空当长了补一位。起谁都在那一年入仕,所以后来的历史变了(作者干预某一年),先前入仕的大臣还是那几位。
 */
export function buildOfficials(input: OfficialsInput, ctx: OfficialsCtx, generals: readonly Person[]): Officials {
  const { polities, settlements, annals, endYear } = input;
  const base = subSeed(input.seed, 'civ-officials');
  const fixups: [PersonDeed, Person][] = [];
  const ministers: Person[] = [];
  const nameAt = new Map<Person, (a: number) => string>();
  const later: (() => void)[] = [];
  const homeAsks: { x: Person; year: Year; u: number }[] = [];
  /** 每国最高的官谁在任:[起, 止] */
  const tops: [Year, Year][][] = polities.map(() => []);

  for (const p of polities) {
    const sys = systemOf(p);
    const segs = p.dynasties?.length ? p.dynasties : [{ year: p.founded, name: p.name, seat: p.capital }];
    const end = p.ended ?? endYear;
    const rs = ctx.rulers[p.id] ?? [];
    const namer = ctx.namerOf(p);
    const style = ctx.styleOf(p);
    for (let i = 0; i < segs.length; i++) {
      const s = i === 0 ? p.founded : segs[i].year;
      const last = i + 1 >= segs.length;
      const e = last ? end : segs[i + 1].year;
      if (e - s <= 0) continue;
      const R = (slot: number, use: number) => keyed4(base, ctx.tag[p.id], i, slot * 16 + use, K_MINISTER);
      // 部落没有大臣(共和国从城邦起就有)
      const staffed = (y: Year) => sys === 'republic' || polityTierAt(p, y) >= 1;
      const anchors = anchorsOf(input, p, i, s, e, rs, sys);
      const drafts: Draft[] = [];
      /** why:0 为一件事起用 / 1 补空当;都在 Y 这一年入仕 */
      const make = (Y: Year, why: 0 | 1, kind?: PersonDeed['kind']): Draft | null => {
        const slot = Math.round(Y * SLOT_Q) * 2 + why;
        const r = (use: number) => R(slot, use);
        const born = Y - lerp(kind === 'found' ? FOUND_AGE : why === 1 ? ENTER_AGE : CALL_AGE, r(U_AGE));
        const enter = Y;
        const life = Math.max(born + lerp(LIFE, Math.pow(r(U_LIFE), 0.8)), Y + 2);
        const retire = Math.max(born + lerp(RETIRE_AGE, r(U_RETIRE)), Y + 1);
        const leave = Math.min(life, retire, e);
        if (!(leave > enter)) return null;
        const x: Person = { id: -1, role: 'minister', polity: p.id, name: '', born: q(born), dynasty: i };
        const d: Draft = { x, enter: q(enter), leave: q(leave), life: q(life), slot, anchors: [] };
        drafts.push(d);
        return d;
      };
      // 往后走:下一件事、下一个该补人的空当,哪个先到先办
      let cover = s;
      let k = 0;
      while (true) {
        const a = anchors[k];
        const gapAt = q(cover + lerp(GAP[polityTierAt(p, cover) >= 2 ? 0 : 1], keyed4(base, ctx.tag[p.id], i, Math.round(cover * SLOT_Q) * 16 + U_GAP, K_GAP)));
        if (gapAt < e && (!a || gapAt < a.year)) {
          const d = staffed(gapAt) ? make(gapAt, 1) : null;
          cover = d ? Math.max(cover, d.leave) : gapAt;
          continue;
        }
        if (!a) break;
        k++;
        if (!staffed(a.year)) continue;
        const on = drafts.filter((x) => x.enter <= a.year && x.leave >= a.year);
        // 没人在朝:要紧的事起一位;寻常的事(打仗、运粮、一般的议和)一半的机会起一位,不然这件事没有名臣经手
        const fresh = on.length ? a.prio <= PRIO_NEW : a.prio < PRIO_MINOR || keyed4(base, ctx.tag[p.id], i, Math.round(a.year * SLOT_Q) * 16 + U_MINOR, K_GAP) < MINOR_NEW;
        const d = on.find((x) => x.anchors.length < DEEDS_MAX) ?? (fresh ? make(a.year, 0, a.kind) : null);
        if (!d) continue;
        d.anchors.push(a);
        cover = Math.max(cover, d.leave);
      }
      drafts.sort((a, b) => a.enter - b.enter || a.slot - b.slot);
      for (const d of drafts) {
        const r = (use: number) => R(d.slot, use);
        const x = d.x;
        x.deeds = d.anchors.map((a) => {
          if (a.who) fixups.push([a.deed, a.who]);
          // 辅政到他去职为止
          if (a.deed.until !== undefined) a.deed.until = Math.min(a.deed.until, d.leave);
          return a.deed;
        });
        x.from = d.enter;
        // 结局
        const ended = endOf(p, d, e, last, end, endYear, rs, input, r);
        x.until = ended.until;
        if (ended.fate) x.fate = ended.fate;
        if (ended.died !== undefined) x.died = ended.died;
        x.posts = civilPosts(p, sys, d, ended.until ?? endYear, tops[p.id], r);
        nameAt.set(x, (a) => namer.surname(ctx.tag[p.id], 3, i, d.slot, a) + namer.given(ctx.tag[p.id], 3, i, d.slot, a));
        if (namer.surnamed) later.push(() => (x.courtesy = courtesyName(style, x.name, r)));
        const tail = artTail(style, r, ART[0]);
        if (tail) x.art = tail;
        homeAsks.push({ x, year: d.enter, u: r(U_HOME) });
        ministers.push(x);
      }
    }
  }

  // ---- 将领:籍贯、号、官职 ----
  const seen = polities.map(() => 0);
  for (const g of generals) {
    const p = polities[g.polity];
    if (!p || !g.commands?.length) continue;
    const gi = seen[p.id]++;
    const r = (use: number) => keyed4(base, ctx.tag[p.id], gi, use, K_GENERAL);
    const style = ctx.styleOf(p);
    if (ctx.namerOf(p).surnamed) later.push(() => (g.courtesy = courtesyName(style, g.name, r)));
    const tail = artTail(style, r, ART[1]);
    if (tail) g.art = tail;
    g.posts = generalPosts(p, g, annals, r);
    homeAsks.push({ x: g, year: g.commands[0].from, u: r(U_HOME) });
  }

  resolveHomes(input, homeAsks);
  // 号不和先前的人撞(同一座城出的人多,"揽霞子"不出第二位):换一个后半,都用过了就不起号
  const arts = new Set<string>();
  for (const { x } of homeAsks) {
    const city = x.home !== undefined ? settlements[x.home]?.name : undefined;
    if (!x.art || !city) continue;
    const tails = [x.art, ...(ART_TAIL[ctx.styleOf(polities[x.polity])] ?? []).filter((t) => t !== x.art)];
    const tail = tails.find((t) => !arts.has(artName(city, t)));
    if (tail) {
      x.art = tail;
      arts.add(artName(city, tail));
    } else delete x.art;
  }
  return { ministers, fixups, nameAt, finish: () => later.forEach((f) => f()) };
}

/** 这一朝里能经手的事(按年份) */
function anchorsOf(input: OfficialsInput, p: Polity, dyn: number, s: Year, e: Year, rs: readonly Person[], sys: System): Anchor[] {
  const { annals } = input;
  const out: Anchor[] = [];
  const inSeg = (y: Year) => y >= s && y < e;
  const mine = rs.filter((r) => (r.dynasty ?? 0) === dyn);
  // 佐命:这一朝的第一位
  const first = mine[0];
  if (first && first.rise && first.rise !== 'heir' && sys !== 'republic') out.push({ kind: 'found', year: first.from!, prio: 0, deed: { kind: 'found', year: first.from! }, who: first });
  // 辅政:幼主即位
  if (sys !== 'republic')
    for (const r of mine) {
      if (r.rise !== 'heir' || r.from === undefined || r.from - r.born >= YOUNG) continue;
      const until = Math.min(q(r.born + ADULT), r.until ?? e, e);
      out.push({ kind: 'regent', year: r.from, prio: 3, deed: { kind: 'regent', year: r.from, until }, who: r });
    }
  // 拥立:先君遇弑
  for (let k = 0; k + 1 < mine.length; k++) {
    const r = mine[k];
    if (r.fate === 'murdered' && r.until !== undefined && inSeg(r.until)) out.push({ kind: 'enthrone', year: r.until, prio: 1, deed: { kind: 'enthrone', year: r.until }, who: mine[k + 1] });
  }
  annals.forEach((a, idx) => {
    if (!inSeg(a.year)) return;
    if (a.kind === 'rank' && a.a === p.id) {
      // 升格、国号跟着变了才算(汗国第 1、2 档都叫"汗国",那次不算)
      const before = polityTierAt(p, a.year - 1 / (2 * TICK));
      const after = polityTierAt(p, a.year);
      const titles = polityTitles(p, a.year);
      if (after > before && after >= (sys === 'republic' ? 3 : 2) && titles[Math.max(0, before)] !== titles[after]) out.push({ kind: 'rank', year: a.year, prio: 1, deed: { kind: 'rank', year: a.year, annal: idx }, who: rulerAt(mine, a.year) });
    } else if (a.kind === 'capital' && a.a === p.id) {
      if (a.b === -2) return; // 天灾迁都算进赈灾
      out.push({ kind: 'capital', year: a.year, prio: a.war < 0 ? 2 : 4, deed: { kind: 'capital', year: a.year, annal: idx } });
    } else if (a.kind === 'war' && a.war >= 0 && (a.a === p.id || a.b === p.id)) {
      // 宣战:本国先动手的"力主讨伐",被打的"督运粮草、守御"
      const kind = a.a === p.id ? 'war' : 'defend';
      out.push({ kind, year: a.year, prio: kind === 'war' ? 4 : 5, deed: { kind, year: a.year, annal: idx } });
    } else if (a.kind === 'peace' && (a.a === p.id || a.b === p.id)) {
      // 一方已亡、兵戈自息的不算
      const other = polityOf(input, a.a === p.id ? a.b : a.a);
      if (!other || (other.ended !== undefined && other.ended <= a.year) || (p.ended !== undefined && p.ended <= a.year)) return;
      out.push({ kind: 'peace', year: a.year, prio: a.region > 0 ? 2 : 4, deed: { kind: 'peace', year: a.year, annal: idx } });
    }
  });
  (input.upheavals ?? []).forEach((u, k) => {
    if (inSeg(u.year) && (u.polity === p.id || u.drownedBy.includes(p.id))) out.push({ kind: 'relief', year: u.year, prio: 2, deed: { kind: 'relief', year: u.year, upheaval: k } });
  });
  return out.sort((a, b) => a.year - b.year || a.prio - b.prio);
}

function polityOf(input: OfficialsInput, id: number): Polity | undefined {
  return id >= 0 ? input.polities[id] : undefined;
}

/** 某一刻在位的君主(同 people.ts 的 rulerAt) */
function rulerAt(list: readonly Person[], t: Year): Person | undefined {
  for (let i = list.length - 1; i >= 0; i--) {
    const r = list[i];
    if (r.from! <= t) return r.until === undefined || t < r.until ? r : undefined;
  }
  return undefined;
}

/** 结局:去职那年、怎么去职的、卒年 */
function endOf(
  p: Polity,
  d: Draft,
  e: Year,
  last: boolean,
  end: Year,
  endYear: Year,
  rs: readonly Person[],
  input: OfficialsInput,
  r: (use: number) => number,
): { until?: Year; fate?: PersonFate; died?: Year } {
  const died = d.life <= endYear ? d.life : undefined;
  if (d.leave < e) {
    // 一朝里去职:卒于任上 / 新君即位后不久罢官 / 致仕
    if (died !== undefined && d.leave >= d.life) return { until: d.leave, fate: 'died', died };
    // 共和国的执政是选出来的,换人不算"新君即位"
    const fresh = p.lineage !== 'republic' && rs.some((x) => x.rise === 'heir' && x.from !== undefined && x.from <= d.leave && x.from > d.leave - 1);
    const fate: PersonFate = fresh && r(U_FATE) < DISMISS ? 'deposed' : 'retired';
    return { until: d.leave, fate, died };
  }
  // 在朝到这一朝终了
  if (last && p.ended === undefined) {
    // 国家还在、朝代没换:到结束年份还在朝
    return died !== undefined ? { until: d.leave, fate: 'died', died } : {};
  }
  const u = r(U_FATE);
  const merged = last && input.annals.some((a) => a.kind === 'merge' && a.b === p.id && a.year === end);
  if (merged) return { until: e, fate: 'merged', died };
  const fate: PersonFate = u < MARTYR ? 'fell' : u < MARTYR + YIELD ? 'surrendered' : 'fled';
  return { until: e, fate, died: fate === 'fell' ? e : died };
}

/** 文官的官职:入仕的官、中间几级、最高的那级(经手第一件大事前后升到);同时最高的官只一位 */
function civilPosts(p: Polity, sys: System, d: Draft, until: Year, tops: [Year, Year][], r: (use: number) => number): PersonPost[] {
  const T = Math.max(1, until - d.enter);
  const first = d.anchors[0];
  // 升到最高那级:佐命的开国时;辅政、劝进、拥立那一刻;别的在朝过半前后
  let topAt = d.enter + T * (0.45 + 0.25 * r(U_POSTS));
  // 辅政、劝进、拥立的时候已经是最高那级
  const major = d.anchors.find((a) => a.kind === 'found' || a.kind === 'regent' || a.kind === 'rank' || a.kind === 'enthrone');
  if (major) topAt = Math.min(topAt, major.year);
  topAt = q(Math.max(d.enter, Math.min(topAt, until)));
  // 佐命之臣开国时、为辅政拥立这类大事起用的(和在朝很短的)入仕当年直接拜最高的官
  if (first?.kind === 'found' || topAt - d.enter < 2) topAt = d.enter;
  const ladderAt = (y: Year) => CIVIL[sys][clampTier(polityTierAt(p, y))] ?? CIVIL[sys][1] ?? [];
  const top = ladderAt(topAt);
  const steps = Math.max(0, top.length - 1);
  const out: PersonPost[] = [];
  // 入仕到 topAt 之间排低几级(在朝短的少排几级)
  const below = topAt === d.enter ? 0 : Math.min(steps, Math.max(1, Math.round((topAt - d.enter) / 9)));
  for (let k = 0; k < below; k++) {
    const y = q(d.enter + ((topAt - d.enter) * k) / below);
    const lad = ladderAt(y);
    const rank = Math.min(lad.length - 2, Math.max(0, steps - below + k));
    out.push({ title: lad[Math.max(0, rank)] ?? lad[0], from: y });
  }
  // 最高那级:已经有人在任就写次一级;没经手开国、辅政、劝进、拥立这类大事的,有一些做到次一级就止(尚书、掌玺大臣……),不是人人拜相
  const tier = clampTier(polityTierAt(p, topAt));
  const capped = !major && top.length >= 2 && r(U_CAP) < CAPPED;
  const busy = !capped && tops.some(([a, b]) => a < until && b > topAt);
  let title = capped ? top[top.length - 2] : busy ? (TOP_ALT[sys][tier] ?? top[top.length - 2]) : top[top.length - 1];
  if (!busy && !capped) tops.push([topAt, until]);
  if (!title) title = top[top.length - 1];
  out.push({ title, from: topAt });
  // 东方帝国级的尚书按经手的事挑哪一部
  for (const post of out) {
    if (post.title !== '尚书') continue;
    const k = d.anchors.find((a) => DEPT[a.kind])?.kind;
    post.title = (k ? DEPT[k]! : pickOf(DEPTS, r(U_DEPT))) + '尚书';
  }
  // 同一个官名接连两级的合并(档位变了以后可能重名)
  return out.filter((x, k) => k === 0 || x.title !== out[k - 1].title);
}

/** 某国某一年的那套官(从低到高;文官带上最高的官已经有人时写的那个,尚书不分部、将军不分前后左右写成"*将军") */
export function postLadder(p: Polity, role: 'minister' | 'general', year: Year): readonly string[] {
  const sys = systemOf(p);
  const tier = clampTier(polityTierAt(p, year));
  if (role === 'general') return MILITARY[sys][tier];
  const lad = CIVIL[sys][tier] ?? CIVIL[sys][1] ?? [];
  const alt = TOP_ALT[sys][tier];
  return alt && !lad.includes(alt) ? [...lad.slice(0, -1), alt, lad[lad.length - 1]] : lad;
}

/**
 * 将领的官职:每次领兵时按此前打赢的仗数定级,用那一年本国档位的那套官。
 * 国号升格换了一套官时,照已经做到的位置(在那套官里的比例)落到新的那套上,只升不降
 */
function generalPosts(p: Polity, g: Person, annals: readonly Annal[], r: (use: number) => number): PersonPost[] {
  const sys = systemOf(p);
  const wing = pickOf(WINGS, r(U_DEPT));
  const out: PersonPost[] = [];
  let wins = 0;
  let grade = 0;
  const rise = (from: Year) => {
    const lad = MILITARY[sys][clampTier(polityTierAt(p, from))];
    const n = lad.length - 1;
    let k = n > 0 ? Math.min(n, Math.ceil(grade * n - 1e-9)) : 0;
    while (k + 1 < lad.length && wins >= PROMOTE[k + 1]) k++;
    if (n > 0) grade = Math.max(grade, k / n);
    const title = lad[k].replace('*', wing);
    if (!out.length || out[out.length - 1].title !== title) out.push({ title, from });
  };
  for (const c of g.commands ?? []) {
    rise(c.from);
    // 打赢一仗(攻方攻下一州、守方守住)记一功,功够了当年就升
    for (let i = c.first; i <= c.last; i++) {
      const a = annals[i];
      if (!a || a.war !== c.war) continue;
      if ((a.kind === 'conquer' && a.a === g.polity) || (a.kind === 'battle' && a.b === g.polity)) {
        wins++;
        rise(a.year);
      }
    }
  }
  return out;
}

/** 籍贯:那一年本国的城里挑一座(国都的机会大些);按年份扫一遍日志 */
function resolveHomes(input: OfficialsInput, asks: { x: Person; year: Year; u: number }[]): void {
  const { settlements, log, polities } = input;
  const owner = new Int16Array(input.regionCount).fill(-1);
  asks.sort((a, b) => a.year - b.year || a.x.polity - b.x.polity || a.x.born - b.x.born || a.u - b.u);
  let k = 0;
  for (const ask of asks) {
    while (k < log.size && log.year[k] <= ask.year) {
      if (log.layer[k] === Layer.Polity && log.region[k] < owner.length) owner[log.region[k]] = log.value[k];
      k++;
    }
    const p = polities[ask.x.polity];
    const cap = capitalAt(p, ask.year);
    if (ask.u < HOME_CAPITAL && settlements[cap]) {
      ask.x.home = cap;
      continue;
    }
    const cands = settlements.filter((s) => s.founded <= ask.year && !(s.ended !== undefined && s.ended <= ask.year) && s.region >= 0 && owner[s.region] === p.id);
    if (!cands.length) {
      if (settlements[cap]) ask.x.home = cap;
      continue;
    }
    // 大城的机会大些(按容量的平方根)
    let sum = 0;
    for (const s of cands) sum += Math.sqrt(s.capacity);
    let t = ((ask.u - HOME_CAPITAL) / (1 - HOME_CAPITAL)) * sum;
    let pick = cands[cands.length - 1];
    for (const s of cands) {
      t -= Math.sqrt(s.capacity);
      if (t <= 0) {
        pick = s;
        break;
      }
    }
    ask.x.home = pick.id;
  }
}
