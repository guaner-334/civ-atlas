/**
 * 名臣(文臣),和将领的官职、字号、籍贯。推演结束、排好君主和统帅以后调用(people.ts),
 * 和统帅一样按已经推出来的历史"贴"上去 —— 一样都不改,纯计算,不碰 DOM。
 *
 * **名臣**:每一朝几位(按这一朝的年数;王国、帝国多些,部落没有)。先挑这一朝里真发生的事,每件找一位当时在朝的大臣经手,
 * 没有就新起一位(一位最多经手 DEEDS_MAX 件):
 *   found     佐命:一朝的第一位上台时(立国、起兵代之、叛离自立、复国、篡位)
 *   regent    辅政:幼主(不满 YOUNG 岁)即位,辅政到他 ADULT 岁
 *   rank      劝进:国号升格(称王、称帝)
 *   enthrone  拥立:先君遇弑,迎立新君
 *   capital   迁都:主动迁都(力主迁都)、国都失守以后迁都(护驾)
 *   relief    赈灾:地形大事里本国受灾
 *   peace     议和:出使议和(得失的州记在史事里)
 *   war       主战:本国宣战时力主讨伐
 *   defend    守御:本国被攻时督运粮草、主持守御
 * 挑剩的名额放进这一朝还没人在朝的年份(在朝几十年、没经手大事的守成之臣)。
 * **官职**:入仕到去职一级级升(官名按当时的国号档位,东方、西幻、汗国、共和国各一套,见 CIVIL);
 *   同一时间最高的那个官(丞相、首相……)只有一位,后来的写次一级(TOP_ALT)。
 * **结局**:卒于任上(died)/ 致仕(retired)/ 新君即位时罢官(deposed);一朝终了时还在朝的:
 *   殉国(fell)、降(surrendered:亡国时降灭它的国家,改朝换代时归顺新朝)、归隐(fled)、随国归附(merged)。
 * **将领**:每次领兵时按此前打赢的仗数升官(MILITARY:校尉 → 中郎将 → 偏将军 → 前后左右将军 → 车骑将军 → 大将军;西幻骑士 → 统领 → 元帅……)。
 * **字号**:东方带姓的语感(中原、仙侠)的大臣、将领有字;一部分大臣有号(Person.art:号的后半,前半是籍贯的城名,见 officialText.ts)。
 *   其余语感没有字号。
 * **籍贯**:入仕(第一次领兵)那年本国的一座城,国都的机会大些。
 *
 * 随机数 keyed4(subSeed(seed, 'civ-officials'), 国家的位置锚, 第几朝, 第几位 × 16 + 用途, 种类);
 * 将领按"国家的位置锚 + 本国第几位将领"。名字和别的人物不重名(people.ts 的 NameBook)。
 */
import { Layer, type Annal, type ChangeLog, type Person, type PersonDeed, type PersonFate, type PersonPost, type Polity, type Settlement, type UpheavalFact, type Year } from './types';
import { keyed4, subSeed } from './rand';
import { capitalAt, polityTierAt } from './growth';

// ---- 调参 ----
/** 一朝几位:年数 ÷ PER_YEARS(王国、帝国 / 国),至少 1 位,最多 MAX */
const PER_YEARS: [number, number] = [70, 110];
const MAX: [number, number] = [8, 5];
/** 一位最多经手几件事 */
const DEEDS_MAX = 3;
/** 幼主:即位不满这么多岁;辅政到他这么多岁 */
const YOUNG = 12;
const ADULT = 18;
/** 入仕的年纪、经手大事时的年纪、致仕的年纪、寿命 */
const ENTER_AGE: [number, number] = [20, 30];
const PEAK_AGE: [number, number] = [36, 58];
const RETIRE_AGE: [number, number] = [62, 76];
const LIFE: [number, number] = [58, 86];
/** 佐命之臣:开国时的年纪 */
const FOUND_AGE: [number, number] = [26, 44];
/** 挑剩的名额:这一朝里没人在朝的空当至少这么多年才放一位 */
const GAP_MIN = 24;
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
const U_COUNT = 0;
const U_AGE = 1;
const U_ENTER = 2;
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
/** keyed4 最后一位:大臣 / 将领 */
const K_MINISTER = 0;
const K_GENERAL = 1;

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
  /** 起一个不和别人重名的名字(people.ts 的 NameBook) */
  pickName: (nameAt: (a: number) => string, born: Year, polity: number) => string;
}

/** 一件可以经手的事 */
interface Anchor {
  kind: PersonDeed['kind'];
  year: Year;
  /** 越小越先挑 */
  prio: number;
  deed: PersonDeed;
  /** 记在 deed.person 上的人(排好编号后换成编号) */
  who?: Person;
  taken?: boolean;
}

/** 正在排的一位大臣 */
interface Draft {
  x: Person;
  enter: Year;
  leave: Year;
  life: Year;
  /** 第几位(这一朝里) */
  slot: number;
  anchors: Anchor[];
}


/**
 * 排出所有名臣(role = minister,按国家、朝代、入仕先后),顺带给将领填上籍贯、字号、官职。
 * fix:deed.person 先记成 Person,等 people.ts 排好编号再换(返回的 fixups)
 */
export function buildOfficials(input: OfficialsInput, ctx: OfficialsCtx, generals: readonly Person[]): { ministers: Person[]; fixups: [PersonDeed, Person][] } {
  const { polities, settlements, annals, endYear } = input;
  const base = subSeed(input.seed, 'civ-officials');
  const fixups: [PersonDeed, Person][] = [];
  const ministers: Person[] = [];
  const homeAsks: { x: Person; year: Year; u: number }[] = [];
  /** 每国最高的官谁在任:[起, 止] */
  const tops: [Year, Year][][] = polities.map(() => []);

  for (const p of polities) {
    const sys = systemOf(p);
    const segs = p.dynasties?.length ? p.dynasties : [{ year: p.founded, name: p.name, seat: p.capital }];
    const end = p.ended ?? endYear;
    const rs = ctx.rulers[p.id] ?? [];
    for (let i = 0; i < segs.length; i++) {
      const s = i === 0 ? p.founded : segs[i].year;
      const last = i + 1 >= segs.length;
      const e = last ? end : segs[i + 1].year;
      const len = e - s;
      if (len <= 0) continue;
      // 这一朝最高的档位:部落没有大臣(共和国从城邦起就有)
      const tierMax = maxTier(p, s, e);
      if (sys !== 'republic' && tierMax < 1) continue;
      const big = tierMax >= 2 ? 0 : 1;
      const R = (slot: number, use: number) => keyed4(base, ctx.tag[p.id], i, slot * 16 + use, K_MINISTER);
      const n = Math.max(1, Math.min(MAX[big], Math.round(len / PER_YEARS[big] + R(0, U_COUNT) - 0.5)));
      const anchors = anchorsOf(input, p, i, s, e, rs, sys);
      const drafts: Draft[] = [];
      const make = (Y: Year, kind: PersonDeed['kind'] | 'end' | null): Draft | null => {
        const slot = drafts.length;
        const r = (use: number) => R(slot + 1, use);
        let born: number;
        let enter: number;
        if (kind === 'found') {
          born = Y - lerp(FOUND_AGE, r(U_AGE));
          enter = Y;
        } else {
          born = Y - lerp(PEAK_AGE, r(U_AGE));
          enter = Math.max(s, born + lerp(ENTER_AGE, r(U_ENTER)));
        }
        // 一朝终了时在朝的那一位:在朝到那一刻
        const life = Math.max(born + lerp(LIFE, Math.pow(r(U_LIFE), 0.8)), Y + 2, kind === 'end' ? e + 1 : 0);
        const retire = Math.max(born + lerp(RETIRE_AGE, r(U_RETIRE)), Y + 1, kind === 'end' ? e : 0);
        let leave = Math.min(life, retire);
        if (leave > e) leave = e;
        if (!(leave > enter) || enter > Y + 1e-9 || leave < Y) return null;
        const x: Person = { id: -1, role: 'minister', polity: p.id, name: '', born: q(born), dynasty: i };
        const d: Draft = { x, enter: q(enter), leave: q(leave), life: q(life), slot, anchors: [] };
        drafts.push(d);
        return d;
      };
      const active = (Y: Year) => drafts.find((d) => d.enter <= Y && d.leave >= Y && d.anchors.length < DEEDS_MAX);
      // 先按事找人
      for (const a of anchors) {
        let d = active(a.year);
        if (!d && drafts.length < n) d = make(a.year, a.kind) ?? undefined;
        if (!d) continue;
        d.anchors.push(a);
        a.taken = true;
      }
      // 一朝终了(改朝换代、亡国、并入他国)时总有一位在朝(殉国、降、归隐);名额满了也加这一位
      if (!(last && p.ended === undefined) && !drafts.some((d) => d.leave >= e)) {
        const d = make(e - 1 / TICK, 'end');
        if (d) for (const a of anchors) if (!a.taken && d.anchors.length < DEEDS_MAX && a.year >= d.enter && a.year <= d.leave) ((a.taken = true), d.anchors.push(a));
      }
      // 挑剩的名额放进没人在朝的空当
      while (drafts.length < n) {
        const gap = widestGap(drafts, s, e);
        if (!gap || gap[1] - gap[0] < GAP_MIN) break;
        const mid = (gap[0] + gap[1]) / 2;
        const d = make(mid, null);
        if (!d) break;
        for (const a of anchors) if (!a.taken && d.anchors.length < DEEDS_MAX && a.year >= d.enter && a.year <= d.leave) ((a.taken = true), d.anchors.push(a));
      }
      // 在朝时还有没人经手的事,顺手记上
      for (const d of drafts)
        for (const a of anchors) if (!a.taken && d.anchors.length < DEEDS_MAX && a.year >= d.enter && a.year <= d.leave) ((a.taken = true), d.anchors.push(a));
      drafts.sort((a, b) => a.enter - b.enter || a.slot - b.slot);
      for (const d of drafts) {
        const r = (use: number) => R(d.slot + 1, use);
        const x = d.x;
        d.anchors.sort((a, b) => a.year - b.year);
        x.deeds = d.anchors.map((a) => {
          if (a.who) fixups.push([a.deed, a.who]);
          return a.deed;
        });
        x.from = d.enter;
        // 结局
        const ended = endOf(p, d, e, last, end, endYear, rs, input, r);
        x.until = ended.until;
        if (ended.fate) x.fate = ended.fate;
        if (ended.died !== undefined) x.died = ended.died;
        x.posts = civilPosts(p, sys, d, ended.until ?? endYear, tops[p.id], r);
        // 名字
        const namer = ctx.namerOf(p);
        const key = (a: number) => [ctx.tag[p.id], 3, i * 64 + d.slot, a];
        x.name = ctx.pickName((a) => namer.surname(...key(a)) + namer.given(...key(a)), x.born, p.id);
        const style = ctx.styleOf(p);
        if (namer.surnamed) x.courtesy = courtesyName(style, x.name, r);
        const tail = artTail(style, r, ART[0]);
        if (tail) x.art = tail;
        homeAsks.push({ x, year: d.enter, u: r(U_HOME) });
        ministers.push(x);
      }
    }
  }

  // ---- 将领:籍贯、字号、官职 ----
  const seen = polities.map(() => 0);
  for (const g of generals) {
    const p = polities[g.polity];
    if (!p || !g.commands?.length) continue;
    const gi = seen[p.id]++;
    const r = (use: number) => keyed4(base, ctx.tag[p.id], gi, use, K_GENERAL);
    const style = ctx.styleOf(p);
    if (ctx.namerOf(p).surnamed) g.courtesy = courtesyName(style, g.name, r);
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
  return { ministers, fixups };
}

/** 这一朝最高的档位 */
function maxTier(p: Polity, s: Year, e: Year): number {
  let t = polityTierAt(p, s);
  for (const x of p.titles ?? []) if (x.year >= s && x.year < e) t = Math.max(t, x.tier);
  return t;
}

/** 这一朝里能经手的事(按先挑的在前) */
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
      // 升格才算(降格不算)
      const before = polityTierAt(p, a.year - 1 / (2 * TICK));
      const after = polityTierAt(p, a.year);
      if (after > before && after >= (sys === 'republic' ? 3 : 2)) out.push({ kind: 'rank', year: a.year, prio: 1, deed: { kind: 'rank', year: a.year, annal: idx }, who: rulerAt(mine, a.year) });
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
  return out.sort((a, b) => a.prio - b.prio || a.year - b.year);
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

/** 这一朝里没人在朝的最长一段 */
function widestGap(drafts: readonly Draft[], s: Year, e: Year): [Year, Year] | null {
  const spans = drafts.map((d) => [d.enter, d.leave] as [Year, Year]).sort((a, b) => a[0] - b[0]);
  let best: [Year, Year] | null = null;
  let t = s;
  for (const [a, b] of [...spans, [e, e] as [Year, Year]]) {
    if (a > t && (!best || a - t > best[1] - best[0])) best = [t, a];
    t = Math.max(t, b);
  }
  return best;
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
    const fresh = rs.some((x) => x.rise === 'heir' && x.from !== undefined && x.from <= d.leave && x.from > d.leave - 1);
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
  const ladderAt = (y: Year) => CIVIL[sys][clampTier(polityTierAt(p, y))] ?? CIVIL[sys][1] ?? [];
  const top = ladderAt(topAt);
  const steps = Math.max(0, top.length - 1);
  const out: PersonPost[] = [];
  // 入仕到 topAt 之间排低几级(在朝短的少排几级;佐命之臣开国时直接拜最高的官)
  const below = first?.kind === 'found' ? 0 : Math.min(steps, Math.max(1, Math.round((topAt - d.enter) / 9)));
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

/** 将领的官职:每次领兵时按此前打赢的仗数定级 */
function generalPosts(p: Polity, g: Person, annals: readonly Annal[], r: (use: number) => number): PersonPost[] {
  const sys = systemOf(p);
  const wing = pickOf(WINGS, r(U_DEPT));
  const out: PersonPost[] = [];
  let wins = 0;
  for (const c of g.commands ?? []) {
    const lad = MILITARY[sys][clampTier(polityTierAt(p, c.from))];
    const rise = (from: Year) => {
      let k = 0;
      while (k + 1 < lad.length && wins >= PROMOTE[k + 1]) k++;
      const title = lad[k].replace('*', wing);
      if (!out.length || out[out.length - 1].title !== title) out.push({ title, from });
    };
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
