/**
 * 人物:各国的历代君主、战争里的统帅。推演结束、起好国名和城名以后调用(index.ts),
 * 按已经推出来的历史"贴"上去 —— 立国、灭亡、并入、王朝更替、每场战争、每一仗的胜负都照史事,一样都不改。
 *
 * **君主**(每个国家从立国到灭亡,一朝接一朝,中间不断档):
 *   - 每一朝的第一位:立国之君 / 叛离自立的守将(分裂)/ 故国王室之后(复国;东方沿用故国末代的姓)/
 *     篡位的权臣(新朝的根据地就是国都)/ 起兵代之的新朝开国之君
 *   - 之后同一家里继位:即位的年纪、在位多少年按"国家的位置锚 + 第几位"随机取,一生不超过 MAX_AGE 岁;
 *     共和国的执政官任期短、任满卸任。这几样和倾向(开拓 / 好战 / 发展 / 重商,各 0–100,Person.leanings)在 rulers.ts,推演里用同一份
 *     (扩张算账、议和看当时在位的是谁),这里排出来的君主和推演里的一位不差
 *   - 一朝结束(改朝换代、亡国、并入他国)时在位的那一位是末代:被废、死于兵乱、殉国、出降、出奔、归附
 *   - 作者立的君主(干预"即位",在位表里带着,见 rulers.ts):在位的那一位让位(fate yielded),他接着在位(Person.author = 人物编号,
 *     rise crown;名字空着、由界面按人物卡填,生年照干预,不写卒年、不定称号;下台写退位 / 被废 / 出降 / 出奔 / 归附,不写殉国、死于兵乱),
 *     之后照常继位(继位的不连成他的儿子)。同一刻刚即位就让位的那一位(在位 0 天)不列
 *   - 称号(Person.title)去世以后才定,还在位的没有:东方按去世那年的国号档位 —— 帝国(王朝)用庙号(开国之君太祖,
 *     这一朝中途才称帝的第一位世祖;太宗、世宗……,末代"哀帝""末帝""废帝""少帝"),王国、国用谥号 + 王 / 公(按在位时开疆还是失地挑字),部落首领、可汗没有称号;
 *     西幻:同一国里同名的国王按先后编序数("阿尔德里克三世"),帝国里开疆最多的一位称"大帝";共和国执政官、汗不编序数
 * **统帅**(所有战争按史事先后一起排):开战时两边各有一位 —— 作者立的君主在位时作者下令打的仗(强制宣战)由他亲征;
 *   好战的君主有时亲征(好战越高越常亲征),否则派一位将领(本国在世、正闲着的将领先用,没有就新起一位);
 *   每一仗输的一方统帅有机会战死,下一仗换人;将领到年纪卸甲、去世也换人。君主亲征不会战死。
 *   据险断后(史事 stand):败退的一方另起一位将领(部将)守关隘,只经手这一条(PersonCommand.rear,不算统帅);
 *   结局照史事 —— 力战而死的当场战死,力竭被擒的不再领兵,全师而退的照常是本国的将领。
 *   这一方正由宗室(没即位、日后也不即位的王子)领兵的,有 PRINCE_REAR 的机会由他亲自断后(预定的继承人、日后还要用到他的不去):
 *   力战而死的当场战死,力竭被擒的不再领兵,全师而退的接着领兵;大军由部将收拢退下。
 *   将领、名臣按出道先后起名,尽量不和此前即位的君主、先出道的将领名臣重名;名字少的语感至少和本国君主、前后几百年的同名人物错开
 *   (同一国几百年后再出一位同名的将领,读起来像同一个人死了两次)。
 * **世系**(lineage.ts):按年纪给继位的君主连上父亲(子、孙、兄弟、侄、叔伯……),对不上的地方补一位没即位的宗室;
 *   复国之君接到故国末代那一朝的人下面(中间补几代故国宗室,隔得太远的算宗室远支,记成末帝的几世孙)。
 * **将门、世家**(kin.ts):新起的将领、名臣有机会是本国先前一位将领、名臣的孩子(随父姓、籍贯同父亲),一代代接下去有三代为将、父子相继为相。
 * **掌实权**(regents.ts,推演里定的段落,这里挂上人;Person.regencies):引兵入朝、太子监国 = 预定的继承人(引兵入朝那一刻杀兄弟,
 *   royals.ts 的 march);宗室摄政 = 幼主的叔父(日后要摄政的不战死、不卷进争储;篡位了就和接着即位的那位并成一人);
 *   名臣辅政、大臣专权 = 专门起的一位名臣(officials.ts;篡位了和新朝第一位并成一人,编号排在他做名臣时的位置);
 *   大将专权 = 那时本国战功最多的将领(没有就由一位大臣顶上)。有人掌着实权的那几年,名义君主不亲征。
 *   作者下令"让作者的人物掌权"的(干预带 char):每国每位作者的人物添一位(Person.author = 人物编号,role minister,
 *   名字空着、由界面按人物卡填,生年照干预,不写卒年;入仕 = 头一回掌权、去职 = 掌权了结),这几段都记成大臣专权;
 *   那时他正任着这国的将领 / 名臣(干预"任将 / 任臣")的,挂在他任职的那一位上(将领 = 大将专权),不另起。
 * **作者的人物任将任臣**(干预 appoint,任期、挂帅哪几仗见 appoint.ts):每一条添一位(Person.author = 人物编号,名字空着、生年照干预、不写卒年;
 *   from / until = 任期,fate = 怎么卸任的)。推演里的人一个不变,只是多了他:将领的 commands 是他挂帅的那几段(那几仗推演原来派的统帅照旧,
 *   编年史写成副将;君主亲征的,君主为帅、他随驾),官职照推演将领那套按胜仗升;名臣经手他在朝那几年朝中的事(officials.ts 的 courtDeeds,
 *   推演里经手的名臣照旧),官职按年资升。不进将门世家、世系,不会被换成女的(性别照人物卡)。
 * **联姻**(marriages.ts):娶亲的人记上配偶(宗室女只记一行:出自哪国、父亲、"某氏"),娶亲以后生的儿子记上母亲;要结亲的宗室结亲以前不战死。
 * **女性**(women.ts):上面都排完以后,按语感的规矩和比例把一部分君主、宗室、将领、名臣换成女的、另起女名(只换性别和名字,别的一样不改)。
 *
 * 随机数一律 keyed4(subSeed(seed, 'civ-people'), 国家的位置锚, 第几位, 用途, 种类):国家的位置锚 = 立国时国都的地块
 * (+ 这块地上第几个立国,同 naming.ts);一场战争里按"攻守两国的位置锚 + 宣战的年份"取(同 wars.ts)。
 * 干预某一年之前的历史不变,那之前已经下台的君主(名字、生卒、在位年份)、打完的仗的统帅也不变
 * (称号、编号可能变:日后多了一位同名的国王,前面那位就要编"一世")。名字按民族的语感取(naming.ts 的 personNamers)。纯计算,不碰 DOM。
 */
import { EXILE_TIES, type Annal, type Civ, type Person, type PersonCommand, type PersonDeed, type PersonFate, type PersonRegency, type PersonSpouse, type Polity, type RulerLeanings, type RulerRise, type Year } from './types';
import { parsePersonKey, type Intervention } from '../edits';
import { keyed4, subSeed } from './rand';
import { personNamers } from './naming';
import { annexedRemnants, capitalAt, polityTierAt } from './growth';
import { buildLineage } from './lineage';
import { HEIR_WEIGHT, PRINCE_AGE, PRINCE_LEAD, buildSons, contest, march, murderedAt, type Son } from './royals';
import { buildOfficials, courtDeeds, generalPosts, seniorityPosts, type ForcedRegent } from './officials';
import { authorPostsFrom } from './appoint';
import { RG_DIED, RG_PURGE, RG_RETURN, RG_START, RG_USURP, regencyBase, regentsFrom, type AuthorRegentIv, type Regency, type RegencyCtx } from './regents';
import { GROOM_SELF, matchesFrom, type Match } from './marriages';
import { IV_PEOPLE, K_RULER, MAX_AGE, U_AGE, actsFrom, fallFate, leaningEffect, reignBook, rulerBase, rulerTags, type Crown, type Reign } from './rulers';
import { policiesFrom, policyEffect, segAt } from './policy';
import { splitSurname } from './peopleText';
import { debutSex, nameWomen, pickWomen, type ConsortName } from './women';
import { K_BRIDE, K_DOWAGER, U_SURNAME, bears, brideBorn, consortDeath, consortRand, dowagerHomeU, isDowager, otherSurname } from './consorts';
import { HEIR, K_HOUSE_GENERAL, houseBase, pickHouses, withParentSurname } from './kin';
import { opensSeg, royalSeg } from './regime';
import { Issue, REFORM_RESTORE } from './councilRules';

// ---- 调参 ----
// 即位的年纪、在位年数、执政官任期、一生最多多少岁在 rulers.ts(推演里也要知道谁在位)
/** 被废、出降、出奔、归附、卸任以后最多再活这么多年 */
const AFTERLIFE = 15;
// 亡国之君殉国、出降、出奔的机会在 rulers.ts 的 fallFate(推演里出奔邻国用同一个判据)
/** 好战到顶的君主每场仗亲征的机会(再乘倾向折算的倍数,好战 50 以下不亲征,见 rulers.ts);亲征的年纪 */
const LEAD = 0.5;
const LEAD_AGE: [number, number] = [18, 58];
/** 将领:领兵的年纪、寿命、卸甲的年纪 */
const GENERAL_AGE: [number, number] = [24, 42];
const GENERAL_LIFE: [number, number] = [45, 82];
const RETIRE: [number, number] = [58, 70];
/** 输了的一仗统帅战死的机会:攻方没打下来 / 守方丢了州 */
const FALL_ATTACK = 0.06;
const FALL_DEFEND = 0.08;
/** 据险断后:这一方正由宗室领兵时,由他亲自守关隘的机会 */
const PRINCE_REAR = 0.5;
/** 西幻:继位的君主沿用本朝用过的名字的机会(同名多了才有"三世""四世") */
const REUSE = 0.55;
/** 帝国里开疆这么多州以上的君主,开疆最多的一位称"大帝" */
const GREAT_GAINS = 12;
/** 将领、名臣起名最多试几次、不和前后几年里的同名人物撞(见 NameBook) */
const NAME_TRIES = 40;
const NAME_GAP = 300;

// 随机数用途(1、2、14–19 是年纪、在位年数、倾向,在 rulers.ts)
// 3 = 遇弑(royals.ts 的 murderedAt);4 = 亡国之君的下场(rulers.ts 的 fallFate)
const U_AFTER = 5;
const U_REUSE = 7;
const U_PICK = 8;
const U_TITLE = 9;
const U_LIFE = 10;
const U_RETIRE = 11;
const U_LEAD = 12;
const U_FALL = 13;
/** 宗室领兵:替不替父出征、派哪个儿子(14–21 是倾向,在 rulers.ts) */
const U_PRINCE = 22;
const U_PRINCE_PICK = 23;
/** 据险断后:领兵的宗室亲自断后 */
const U_PRINCE_REAR = 24;
/** keyed4 最后一位:君主(K_RULER = 0,在 rulers.ts)/ 将领 / 战争 */
const K_GENERAL = 1;
/** keyed4 最后一位:作者的将领(任将,只挑"前后左右"将军) */
const K_AUTHOR = 7;
/** 起姓的第二位:改出来的共和那几段的执政(东方中式,各有各的姓) */
const K_CONSUL_SUR = 9;

const TICK = 256;
const q = (x: number) => Math.round(x * TICK) / TICK;
const lerp = (r: [number, number], u: number) => r[0] + (r[1] - r[0]) * u;

/** 要用到的 Civ 字段(index.ts 在拼 Civ 之前调用) */
export type PeopleInput = Pick<Civ, 'seed' | 'endYear' | 'polities' | 'settlements' | 'cultures' | 'annals'> &
  Partial<Pick<Civ, 'log' | 'upheavals'>> & {
    /** 州数(名臣的籍贯、筑城要按日志知道某一年哪个州归谁;没有日志 = 不排名臣) */
    regionCount?: number;
    /** 推出这份历史时带着的干预(史事 intervene 的 war 列是它的下标):作者立的君主、他亲征的强制宣战按它认;没有 = 没有干预 */
    interventions?: readonly Intervention[];
  };

/** 一国的史事索引:怎么结束的、每一次改朝换代、战争里的得失 */
interface PolityFacts {
  /** 灭亡(fall,a = 本国)/ 并入(merge,b = 本国) */
  fall?: Annal;
  merge?: Annal;
  /** 改朝换代、改制开一段的史事(按先后,对应 dynasties[1..];改制的见 regime.ts 的 opensSeg) */
  dynasty: Annal[];
  /** 战争里得失的州(年份、+1 得 / −1 失)、国都失守的年份 */
  swings: { year: Year; d: number }[];
  capitalLost: Year[];
}

function factsOf(civ: PeopleInput): PolityFacts[] {
  const out: PolityFacts[] = civ.polities.map(() => ({ dynasty: [], swings: [], capitalLost: [] }));
  const at = (p: number) => (p >= 0 && p < out.length ? out[p] : undefined);
  for (const e of civ.annals) {
    if (e.kind === 'fall') {
      const f = at(e.a);
      if (f && !f.fall) f.fall = e;
    } else if (e.kind === 'merge') {
      const f = at(e.b);
      if (f && !f.merge) f.merge = e;
    } else if (e.kind === 'dynasty' || opensSeg(e)) at(e.a)?.dynasty.push(e);
    else if (e.kind === 'conquer' && e.war >= 0) {
      at(e.a)?.swings.push({ year: e.year, d: 1 });
      at(e.b)?.swings.push({ year: e.year, d: -1 });
    } else if (e.kind === 'capital' && e.war >= 0) at(e.a)?.capitalLost.push(e.year);
  }
  return out;
}

/** 在位期间战争里得、失了几州,丢没丢过国都 */
function deedsOf(f: PolityFacts, from: Year, until: Year): { gains: number; losses: number; capital: boolean } {
  let gains = 0;
  let losses = 0;
  for (const s of f.swings) {
    if (s.year < from || s.year >= until) continue;
    if (s.d > 0) gains++;
    else losses++;
  }
  return { gains, losses, capital: f.capitalLost.some((y) => y >= from && y < until) };
}

// ---------------------------------------------------------------------------
// 称号

/** 庙号(东方帝国级):按在位时的作为挑,同一朝不重复 */
const TEMPLE = {
  great: ['世宗', '圣宗', '武宗', '神宗', '宪宗', '成宗'],
  bad: ['哀宗', '顺宗', '恭宗', '怀宗', '钦宗'],
  young: ['敬宗', '顺宗', '昭宗', '恭宗'],
  long: ['高宗', '仁宗', '宣宗'],
  restore: ['中宗', '宪宗', '肃宗'],
  plain: ['仁宗', '英宗', '宣宗', '德宗', '穆宗', '文宗', '孝宗', '睿宗', '兴宗', '道宗', '光宗', '宁宗', '理宗', '哲宗', '章宗', '肃宗', '代宗', '懿宗', '僖宗', '明宗', '景宗', '惠宗'],
};
/** 谥号(东方王国、国级,后面加"王""公") */
const POSTHUMOUS = {
  great: ['武', '威', '桓', '庄', '襄', '烈'],
  bad: ['哀', '愍', '灵', '怀', '厉', '幽'],
  young: ['殇', '悼', '冲'],
  long: ['文', '成', '康', '穆', '宣'],
  restore: ['宣', '献', '孝', '襄'],
  plain: ['文', '景', '宣', '成', '康', '昭', '献', '平', '定', '惠', '孝', '穆', '简', '靖', '顷', '懿', '德', '安', '僖', '恭'],
};
/** 末代帝王(亡国、被废、并入) */
const LAST_EMPEROR = ['哀帝', '末帝', '愍帝'];

type Deed = keyof typeof TEMPLE;

/** 从 pool 里随机的一处起,挑第一个这一朝还没用过的 */
function pickUnused(pool: readonly string[], used: ReadonlySet<string>, u: number): string {
  const k0 = Math.floor(u * pool.length);
  for (let j = 0; j < pool.length; j++) {
    const x = pool[(k0 + j) % pool.length];
    if (!used.has(x)) return x;
  }
  return '';
}

const CN = '零一二三四五六七八九';
/** 序数:1 → 一,12 → 十二,23 → 二十三,100 → 一百,105 → 一百零五,112 → 一百一十二(君主的"几世";推得很久的世界会过百) */
function ordinal(n: number): string {
  if (n < 10) return CN[n];
  if (n < 100) {
    const t = Math.floor(n / 10);
    return `${t === 1 ? '' : CN[t]}十${n % 10 ? CN[n % 10] : ''}`;
  }
  if (n >= 1000) return String(n);
  const r = n % 100;
  const head = `${CN[Math.floor(n / 100)]}百`;
  if (!r) return head;
  return r < 10 ? `${head}零${CN[r]}` : `${head}${CN[Math.floor(r / 10)]}十${r % 10 ? CN[r % 10] : ''}`;
}

const ENDED: ReadonlySet<PersonFate> = new Set(['deposed', 'overthrown', 'fell', 'surrendered', 'fled', 'merged']);

// ---------------------------------------------------------------------------

/**
 * 排出所有人物(Civ.people)。没有文明 / 没有国家 = 空数组。
 * 先排君主(按国家编号、即位先后),再按战争先后排统帅,最后是世系里补出来的没即位的宗室(lineage.ts);下标 = Person.id
 */
export function buildPeople(civ: PeopleInput): Person[] {
  // 作者让将领、名臣去世(干预 death;推演里不管,b = IV_PEOPLE):按先后一条条找到那个人,带上前面几条重排一遍
  // (前面的人提早去世,后面的将领可能换了人;那一刻以前的人物都不变,所以按那一刻的人物找)
  const asks = killAsks(civ);
  let kills: Kills = new Map();
  let r = peopleOnce(civ, kills);
  for (const k of asks) {
    // 后来篡位、和新朝第一位并成一人的名臣:按做名臣时的那一份找(让他在篡位以前去世,就不再并)
    const x = findPerson([...r.people, ...r.usurped], k);
    const id = x && r.ids.get(x);
    if (!x || !id || kills.has(id)) continue;
    const from = x.role === 'general' ? x.commands?.[0]?.from : x.from;
    // 那一刻在世、出过道才算;名臣还要在朝(已经致仕、罢官、随故朝去职的不算)
    if (from === undefined || from > k.t || (x.died !== undefined && x.died <= k.t)) continue;
    if (x.role === 'minister' && (from === k.t || (x.until !== undefined && x.until <= k.t))) continue;
    kills = new Map(kills).set(id, { t: k.t, iv: k.iv });
    r = peopleOnce(civ, kills);
  }
  return r.people;
}

/** 作者让将领、名臣去世:身份(将领 g国家:第几位,名臣 m国家:第几朝:slot)→ 那一刻、第几条干预 */
type Kills = ReadonlyMap<string, { t: Year; iv: number }>;

interface KillAsk {
  t: Year;
  iv: number;
  /** 国家(史事 intervene 的 a)、身份、名字、生年(取整)、同名同年生的第几位 */
  pid: number;
  role: 'general' | 'minister';
  name: string;
  born: number;
  n: number;
}

/** 史事里"让将领、名臣去世"的几条(按先后) */
function killAsks(civ: PeopleInput): KillAsk[] {
  const list = civ.interventions;
  if (!list?.length) return [];
  const out: KillAsk[] = [];
  for (const e of civ.annals) {
    if (e.kind !== 'intervene' || e.b !== IV_PEOPLE) continue;
    const v = list[e.war];
    if (v?.kind !== 'death') continue;
    const k = parsePersonKey(v.person);
    if (!k || (k.role !== 'general' && k.role !== 'minister')) continue;
    out.push({ t: e.year, iv: e.war, pid: e.a, role: k.role, name: k.name, born: k.born, n: k.n });
  }
  return out;
}

/** 按人物键的几样(同 edits.ts 的 personKey:同一国、同身份、同名、同年生的按编号先后数第几位)找人 */
function findPerson(people: readonly Person[], k: KillAsk): Person | undefined {
  let n = 0;
  for (const x of people) {
    if (x.polity !== k.pid || x.role !== k.role || x.name !== k.name || Math.round(x.born) !== k.born) continue;
    if (n++ === k.n) return x;
  }
  return undefined;
}

/** 君主 x 在 t 这一刻的倾向(作者改过的:t 以前最后一次改的) */
function leaningsOf(x: Person, t: Year): RulerLeanings {
  const ms = x.moods;
  if (ms) for (let i = ms.length - 1; i >= 0; i--) if (ms[i].year < t) return ms[i].leanings;
  return x.leanings!;
}

/** usurped = 篡位以后和新朝第一位并成一人的名臣(做名臣时的那一份,不在 people 里;作者让名臣去世时还按名臣找他) */
function peopleOnce(civ: PeopleInput, kills: Kills): { people: Person[]; ids: Map<Person, string>; usurped: Person[] } {
  const { polities, settlements, cultures, endYear } = civ;
  const ids = new Map<Person, string>();
  if (!polities.length) return { people: [], ids, usurped: [] };
  const base = rulerBase(civ.seed);
  // 位置锚和推演里一样(rulers.ts):推演按它定"哪一位在位、倾向是多少"
  const tag = rulerTags(polities, (sid) => settlements[sid]?.cell ?? -1);
  const facts = factsOf(civ);
  // 作者立的君主(干预"即位"):和推演里同一份,在位表照它排(rulers.ts);作者强制宣战打起来的仗
  const acts = actsFrom(civ.annals, civ.interventions);
  const forced = forcedWars(civ.annals, civ.interventions);
  // 国家方针(policy.ts):亲征的机会照君主倾向加上方针的胆量算,和推演里同一份
  const policies = policiesFrom(civ.annals, civ.interventions);
  /** 第几条干预 → 它那条史事 intervene 的下标(同一年先宣战、后即位的仗不算他下令的) */
  const ivAnnal = new Map<number, number>();
  civ.annals.forEach((e, i) => e.kind === 'intervene' && ivAnnal.set(e.war, i));
  /** 作者立的君主 → 立他的那一条(Crown) */
  const crownBy = new Map<Person, Crown>();
  const namerOf = personNamers(civ.seed);
  const styleOf = (p: Polity) => cultures[p.culture]?.style || 'kingdom';
  const rulers: Person[][] = polities.map(() => []);
  /** 作者让他去世、改过倾向的君主(一国排完再补上,见下) */
  const marks: [Person, Reign][] = [];
  /** 每国每一朝君主用过的名字(西幻:继位的君主沿用) */
  const pools: string[][][] = polities.map(() => []);
  /** 宗室争位、据地自立(推演里的史事 split,cause = heir):新国家 → 从哪国、哪一刻(先君寿终、新君即位那一刻) */
  const seceded = new Map<number, { from: number; T: Year }>();
  /** 国家 → 那几刻有宗室据地争位(这几次交接不另争储) */
  const secededAt = new Map<number, Set<Year>>();
  for (const e of civ.annals) {
    if (e.kind !== 'split' || e.cause !== 'heir' || polities[e.a]?.prince === undefined) continue;
    seceded.set(e.a, { from: e.b, T: e.year });
    let ts = secededAt.get(e.b);
    if (!ts) secededAt.set(e.b, (ts = new Set()));
    ts.add(e.year);
  }
  /** 先君(在 T 那一刻寿终的那一位) */
  const fatherAt = (pid: number, T: Year) => rulers[pid].find((x) => x.until === T && (x.fate === 'died' || x.fate === 'murdered'));
  /** 放逐到中立地、出奔中立地(treaties.ts 的史事 exile,下标);亡国之君出奔中立地的国家(他的结局写出奔) */
  const exiles = civ.annals.flatMap((e, i) => (e.kind === 'exile' ? [i] : []));
  const fledTo = new Set(exiles.filter((i) => civ.annals[i].cause === 'fled').map((i) => civ.annals[i].a));
  /** 寻常君主在在位表里的那一项、他预定的继承人叫什么(排诸子用) */
  const reignOf = new Map<Person, Reign>();
  const heirNames = new Map<Person, string>();
  // 掌实权的几段、结过的亲(regents.ts、marriages.ts):和推演里同一份,由史事推出来
  const rcx: RegencyCtx = { rbase: base, base: regencyBase(civ.seed), tag, polities, book: (pid, t) => reignBook(base, tag[pid], polities[pid], t, acts.get(pid)), ivs: civ.interventions };
  const regs = regentsFrom(rcx, civ.annals);
  const matches = matchesFrom(rcx, civ.annals);
  /** 国家 → 在位表第几位 → 那位君主 */
  const byK: Map<number, Person>[] = polities.map(() => new Map());
  /** 国家 → 各朝的姓(东方中式;名臣篡位开的新朝照它给他起名) */
  const surnames: string[][] = polities.map(() => []);
  /** 复辟时自立为君的执政 / 将军:新朝第一位 → 做执政时的那一份(同一个人;性别、名字照那一份) */
  const selfOf = new Map<Person, Person>();

  for (const p of polities) {
    const f = facts[p.id];
    const R = (k: number, use: number) => keyed4(base, tag[p.id], k, use, K_RULER);
    const namer = namerOf(styleOf(p));
    const segs = p.dynasties?.length ? p.dynasties : [{ year: p.founded, name: p.name, seat: p.capital }];
    const end = p.ended ?? endYear;
    const list = rulers[p.id];
    // 在位表:和推演里同一份(rulers.ts;带作者立的君主),排到结束那一刻
    const book = reignBook(base, tag[p.id], p, end, acts.get(p.id));
    let n = 0;
    let surname = '';
    for (let i = 0; i < segs.length; i++) {
      const segStart = i === 0 ? p.founded : segs[i].year;
      const last = i + 1 >= segs.length;
      const segEnd = last ? end : segs[i + 1].year;
      // 改制开的共和、军政府那几段:执政(有任期、不立储)
      const republic = !royalSeg(p, i);
      // 复辟迎回旧王室的那一段:沿用旧王室的姓
      const house = (segs[i] as { house?: number }).house;
      // 这一朝的第一位怎么上台的;东方中式的姓(新朝换姓,复国沿用故国末代的姓)
      let rise: RulerRise = 'found';
      if (i > 0) {
        const d = f.dynasty[i - 1];
        const old = settlements[capitalAt(p, segStart - 1 / (2 * TICK))];
        rise = d && d.kind !== 'dynasty' ? 'reform' : d && old && d.region === old.region ? 'usurp' : 'rise';
      } else if (p.restores !== undefined) rise = 'restore';
      else if (p.parent !== undefined) rise = 'rebel';
      const pool: string[] = [];
      pools[p.id][i] = pool;
      const fallen = rise === 'restore' ? polities[p.restores!] : undefined;
      const heirOf = fallen ? rulers[fallen.id][rulers[fallen.id].length - 1] : undefined;
      // 宗室据地争位立的国:开国之君是先君之子,随父姓
      const sire = i === 0 && seceded.has(p.id) ? fatherAt(seceded.get(p.id)!.from, p.founded) : undefined;
      if (namer.surnamed) {
        const prev = surname;
        surname = '';
        if (heirOf && namerOf(styleOf(fallen!)).surnamed) surname = splitSurname(heirOf.name);
        if (sire && namerOf(styleOf(polities[sire.polity])).surnamed) surname = splitSurname(sire.name);
        if (house !== undefined) surname = surnames[p.id][house] ?? '';
        for (let t = 0; !surname || (surname === prev && t < 20); t++) surname = namer.surname(tag[p.id], 0, i, t);
      }
      surnames[p.id][i] = surname;
      const usedGiven = new Set<string>();
      // 这一朝的君主,一位接一位(在位表里第 i 朝的那几位;即位的年纪、在位年数、倾向和推演里同一份)
      while (n < book.length && book[n].dynasty === i) {
        const r = book[n++];
        // 同一刻刚即位就让位给作者立的君主(在位 0 天):不列(作者让他去世的照列)
        if (r.cut !== undefined && r.cut === r.from && !r.death) continue;
        const { k, j, from, natural } = r;
        // 作者立的君主:名字由界面按人物卡填(characters.ts 的 applyCharacters),生年照干预,不写卒年、称号
        if (r.crown) {
          const person: Person = { id: -1, role: 'ruler', polity: p.id, name: '', born: r.crown.born, from, dynasty: i, rise: 'crown', leanings: { ...r.crown.leanings }, author: r.crown.char };
          list.push(person);
          byK[p.id].set(k, person);
          crownBy.set(person, r.crown);
          if (r.cut !== undefined) {
            // 又被后来作者立的君主取代
            person.until = r.cut;
            person.fate = 'yielded';
            continue;
          }
          if (natural < segEnd || (last && p.ended === undefined && natural === segEnd)) {
            // 到期退位,照常有人继位
            person.until = natural;
            person.fate = 'retired';
            continue;
          }
          if (last && p.ended === undefined) break;
          // 在位时改朝换代 = 被废;亡国 = 出降 / 出奔(推演只管君位,生死归人物卡)
          person.until = segEnd;
          if (!last) person.fate = 'deposed';
          else if (f.merge && (!f.fall || f.merge.year <= f.fall.year)) person.fate = 'merged';
          else person.fate = f.fall && f.fall.b >= 0 && !fledTo.has(p.id) ? fallFate(base, tag[p.id], r) : 'fled';
          break;
        }
        const born = q(from - r.age);
        const person: Person = { id: -1, role: 'ruler', polity: p.id, name: '', born, from, dynasty: i, rise: j === 0 ? rise : 'heir', leanings: { ...r.leanings } };
        // 名字;改出来的共和那几段的执政各有各的姓(东方中式),复辟时自立为君的执政 / 将军(生年和上一位一样)还是他
        const before = list[list.length - 1];
        const self = j === 0 && rise === 'reform' && !republic && house === undefined && before && before.born === born ? before : undefined;
        const sur = republic && namer.surnamed && p.lineage !== 'republic' ? namer.surname(tag[p.id], K_CONSUL_SUR, k, 0) : surname;
        person.name = self ? self.name : rulerName(namer, tag[p.id], k, j, sur, usedGiven, pool, R, republic, heirOf && pools[fallen!.id], before?.name);
        if (self) selfOf.set(person, self);
        if (self && namer.surnamed) surnames[p.id][i] = surname = splitSurname(self.name);
        list.push(person);
        reignOf.set(person, r);
        byK[p.id].set(k, person);
        // 预定的继承人(在位表里的下一位,royals.ts)的名字:和他真的接着即位时起的一样(即位以前就以这个名字领兵)
        if (!republic) heirNames.set(person, rulerName(namer, tag[p.id], k + 1, j + 1, surname, new Set(usedGiven), pool.slice(), R, false, undefined, person.name));
        if (r.death || r.moods) marks.push([person, r]);
        if (r.cut !== undefined) {
          // 让位给作者立的君主;被摄政的叔父废了(下一位是他,regents.ts)
          const seized = book[n]?.seize !== undefined && book[n].k === k + 1 && book[n].from === r.cut;
          person.until = r.cut;
          person.fate = seized ? 'deposed' : 'yielded';
          const died = q(Math.min(natural, r.cut + AFTERLIFE * R(k, U_AFTER)));
          if (died <= endYear) person.died = Math.max(r.cut, died);
          continue;
        }
        // 国家还在、恰好在推到的最后一刻交接的也交接:推演里那一刻已经是下一位在位(rulers.ts 的 reignBook)
        if (natural < segEnd || (last && p.ended === undefined && natural === segEnd)) {
          // 这一朝里正常交接:驾崩(偶尔遇弑);执政官任满卸任
          person.until = natural;
          if (republic) {
            person.fate = 'retired';
            const died = q(Math.min(born + MAX_AGE, natural + AFTERLIFE * R(k, U_AFTER)));
            if (died <= endYear) person.died = died;
          } else {
            person.fate = murderedAt(base, tag[p.id], k) ? 'murdered' : 'died';
            person.died = natural;
          }
          continue;
        }
        // 在位到这一朝结束;最后一朝、国家还在 = 到结束年份还在位
        if (last && p.ended === undefined) break;
        person.until = segEnd;
        let fate: PersonFate;
        if (!last) {
          // 下一朝是篡位(根据地就是此刻的国都)还是起兵代之(和下一朝第一位的 rise 同一个判据)
          const d = f.dynasty[i];
          const old = settlements[capitalAt(p, segEnd - 1 / (2 * TICK))];
          // 改制:被废(废君、革命、政变、迎回旧王室);军政府还政、执政自立为君的照卸任算
          if (d && d.kind !== 'dynasty') fate = (d.kind === 'council' && d.war === Issue.Return) || (d.kind === 'reform' && d.n === REFORM_RESTORE && d.b < 0) ? 'retired' : 'deposed';
          else fate = d && old && d.region === old.region ? 'deposed' : 'overthrown';
        } else if (f.merge && (!f.fall || f.merge.year <= f.fall.year)) fate = 'merged';
        else if (f.fall && f.fall.b >= 0 && !fledTo.has(p.id)) fate = fallFate(base, tag[p.id], r);
        else fate = 'fled';
        person.fate = fate;
        if (fate === 'overthrown' || fate === 'fell') person.died = segEnd;
        else {
          const died = q(Math.min(natural, segEnd + AFTERLIFE * R(k, U_AFTER)));
          if (died <= endYear) person.died = Math.max(segEnd, died);
        }
        break;
      }
    }
    // 作者让他去世(那一刻下台的也照这一刻卒)、改过他的倾向(下台以前的几次)
    for (const [x, r] of marks) {
      if (r.death) {
        x.died = r.death.t;
        x.killed = r.death.iv;
        if (x.fate === 'yielded' || x.fate === 'retired' || x.fate === 'murdered') x.fate = 'died';
        x.until ??= r.death.t;
      }
      const ms = r.moods?.filter((m) => m.t < (x.until ?? Infinity));
      if (ms?.length) x.moods = ms.map((m) => ({ year: m.t, leanings: { ...m.leanings }, iv: m.iv }));
    }
    marks.length = 0;
    titleRulers(p, list, f, base, tag[p.id]);
  }

  // ---- 诸子(royals.ts):排统帅以前定好,成年的替父出征 ----
  const sonsOf = buildSons(polities, rulers, reignOf, { base, tag, endYear, heirName: (r) => heirNames.get(r) ?? '' });
  // 据地争位的宗室:先君诸子里那一刻成年、在世的最年长的那位(royals.ts 的 claimants,生年记在 Polity.prince)。
  // 那以前照常替父兄领兵,那一刻起是新国家的开国之君(没在那以前战死的,排完世系以后和开国之君并成一人,见下)
  const claimed: { son: Son; F: Person; X: Person | undefined }[] = [];
  for (const [a, c] of seceded) {
    const F = rulers[a][0];
    const R = fatherAt(c.from, c.T);
    const son = R && sonsOf.get(R)?.find((s) => s.p.role === 'prince' && !s.adopted && s.heirAt === undefined && s.p.born === polities[a].prince);
    if (!F || !son) continue;
    son.end = Math.min(son.end, c.T);
    claimed.push({ son, F, X: rulers[c.from].find((x) => x.from === c.T) });
  }
  // 被新君徙到中立地的宗室(treaties.ts:先君之子,按生年认):那一刻起不再领兵、不卷进争储
  const banished = new Map<Person, Year>();
  /** 史事 exile 的下标 → 放逐 / 出奔的那位、徙他的君主 */
  const exiled = new Map<number, { x: Person; by?: Person }>();
  for (const i of exiles) {
    const e = civ.annals[i];
    if (e.cause === 'heir') {
      const R = fatherAt(e.a, e.year);
      const son = R && sonsOf.get(R)?.find((s) => s.p.role === 'prince' && !s.adopted && s.heirAt === undefined && s.p.born === e.n);
      if (!son) continue;
      banished.set(son.p, e.year);
      exiled.set(i, { x: son.p, by: rulers[e.a].find((x) => x.from === e.year) });
    } else {
      const x = rulers[e.a].find((r) => (e.cause === 'deposed' ? r.fate === 'deposed' && r.until === e.n : r.fate === 'fled' && r.until === e.year));
      if (x) exiled.set(i, { x });
    }
  }
  const away = (p: Person, t: Year) => (banished.get(p) ?? Infinity) <= t;
  /** 战功:领兵打赢的仗减打输的(争储时比) */
  const merit = new Map<Person, number>();
  /** 正领着兵的宗室、将领 → 卸下这一任(争储被杀、大将入朝秉政时用) */
  const leading = new Map<Person, (t: Year) => void>();

  // ---- 掌实权的几段(regents.ts):从哪年到哪年、怎么了结的(按史事和排好的君主定;人等下面挂) ----
  const spans: Span[] = [];
  /** 掌实权的一条史事(下标)→ 同一国的下一条 */
  const nextRegent = new Map<number, number>();
  {
    const last = new Map<number, number>();
    civ.annals.forEach((e, i) => {
      if (e.kind !== 'regent') return;
      const p = last.get(e.a);
      if (p !== undefined) nextRegent.set(p, i);
      last.set(e.a, i);
    });
  }
  for (const [pid, list] of regs) {
    const P = polities[pid];
    for (const g of list) {
      const N = byK[pid].get(g.k);
      if (!N) continue;
      const s: Span = { g, pid, N, from: g.start };
      // 还政、伏诛、篡位、卒那一条:这国下一条掌实权的史事(是下一段的掌权 = 这一段没办结局)
      const j = nextRegent.get(g.annal);
      const e = j !== undefined ? civ.annals[j] : undefined;
      if (e && e.n !== RG_START) {
        s.until = e.year;
        s.end = e.n === RG_RETURN ? 'return' : e.n === RG_PURGE ? 'purged' : e.n === RG_USURP ? 'usurp' : e.n === RG_DIED ? 'died' : undefined;
        s.endAnnal = j;
      }
      if (s.endAnnal === undefined) {
        // 没办结局就了结了:名义君主先没了(引兵入朝、太子监国:他去世、太子即位)、改朝换代、亡国、作者立了君主
        let until = Infinity;
        let end: PersonRegency['end'];
        const cut = (t: Year | undefined, why: PersonRegency['end']) => {
          if (t !== undefined && t > g.start && t < until) {
            until = t;
            end = why;
          }
        };
        if (g.kind === 'chancellor' || g.kind === 'general') cut(rulers[pid].find((x) => x.author !== undefined && x.from! > g.start)?.from, 'ruler');
        else {
          const X = rulers[pid][rulers[pid].indexOf(N) + 1];
          const succeed = (g.kind === 'march' || g.kind === 'heir') && X && X.from === N.until && X.born === g.born && (N.fate === 'died' || N.fate === 'murdered');
          cut(N.until, succeed ? 'succeed' : 'ruler');
        }
        cut(P.dynasties?.[g.dyn + 1]?.year, 'fallen');
        cut(P.ended, 'fallen');
        if (until <= endYear) {
          s.until = until;
          s.end = end;
        }
      }
      spans.push(s);
    }
  }
  /** 国家 pid 在 t 这一刻有人掌着实权(名义君主不再亲征) */
  const spansOf = new Map<number, Span[]>();
  for (const s of spans) {
    const l = spansOf.get(s.pid);
    if (l) l.push(s);
    else spansOf.set(s.pid, [s]);
  }
  /** 在位表第几位在位时有过引兵入朝(国家:位次) */
  const marchedAt = new Set(spans.filter((s) => s.g.kind === 'march').map((s) => `${s.pid}:${s.g.k}`));
  const held = (pid: number, t: Year) => !!spansOf.get(pid)?.some((s) => s.from < t && t < (s.until ?? Infinity));
  /** 不战死、不卷进争储(到这一刻为止):日后要摄政的叔父、要结亲的宗室(推演里还要用到他)、掌着权的大将 */
  const spare = new Map<Person, Year>();
  const keep = (x: Person | undefined, t: Year) => x && spare.set(x, Math.max(spare.get(x) ?? -Infinity, t));
  for (const s of spans) {
    const { g, pid } = s;
    if (g.kind !== 'uncle' || !g.uncle) continue;
    const F = byK[pid].get(g.uncle.k);
    keep(F && sonsOf.get(F)?.find((x) => x.p.role === 'prince' && x.heirAt === undefined && x.p.born === g.born)?.p, s.until ?? g.stop);
  }
  for (const m of matches) {
    const s = m.code & 15;
    if (s === 0 || s === GROOM_SELF) continue;
    const R = byK[m.a].get(m.code >> 4);
    keep(R && sonsOf.get(R)?.find((x) => x.p.role === 'prince' && x.heirAt === undefined && x.p.born === m.born)?.p, m.t);
  }
  const spared = (x: Person, t: Year) => (spare.get(x) ?? -Infinity) >= t;

  // ---- 统帅 ----
  const generals: Person[] = [];
  /** 将领第 a 次试的名字(名字等名臣排出来以后一起起,见 NameBook) */
  const genName = new Map<Person, (a: number) => string>();
  /** 将领 → 他是本国第几位将领(随机数的键) */
  const genIdx = new Map<Person, number>();
  const genOf: { p: Person; careerEnd: number; busy: number }[][] = polities.map(() => []);
  const busyRuler = new Map<Person, number>();
  const wars = warsOf(civ);
  const warBase = subSeed(civ.seed, 'civ-people-war');
  // 所有战争按史事先后一起排(宣战、每一仗、议和):同一国同时打几场仗时,哪位将领此刻闲着按此刻算,
  // 一场仗里换了统帅(作者让他去世、战死),不会连带改掉另一场仗在那以前的统帅
  const steps: { idx: number; run: () => void }[] = [];
  /** 国家 pid 在 t 这一刻新起一位将领(本国第几位将领 + 用途取随机数;名字等名臣排出来以后一起起) */
  const raise = (pid: number, t: Year) => {
    const list = genOf[pid];
    const gi = list.length;
    const G = (use: number) => keyed4(base, tag[pid], gi, use, K_GENERAL);
    const born = q(t - lerp(GENERAL_AGE, G(U_AGE)));
    let life = q(born + lerp(GENERAL_LIFE, Math.pow(G(U_LIFE), 0.8)));
    // 作者让他去世:到那一刻为止(他后来该领的仗换人)
    const id = `g${pid}:${gi}`;
    const kill = kills.get(id);
    if (kill && kill.t < life) life = kill.t;
    const careerEnd = Math.min(life, q(born + lerp(RETIRE, G(U_RETIRE))));
    const namer = namerOf(styleOf(polities[pid]));
    const person: Person = { id: -1, role: 'general', polity: pid, name: '', born };
    ids.set(person, id);
    genIdx.set(person, gi);
    if (kill && life === kill.t) person.killed = kill.iv;
    genName.set(person, (a) => namer.surname(tag[pid], 1, gi, a) + namer.given(tag[pid], 1, gi, a));
    if (life <= endYear) {
      person.died = life;
      person.fate = 'died';
    }
    generals.push(person);
    const g = { p: person, careerEnd, busy: -Infinity };
    list.push(g);
    return g;
  };
  for (const w of wars) {
    const sides = [w.a, w.b];
    const wr = (x: number, use: number) => keyed4((warBase ^ Math.imul(Math.round(w.start * TICK), 0x27d4eb2d)) >>> 0, tag[w.a] ?? 0, tag[w.b] ?? 0, x, use);
    /** keep = 君主亲征之前已经领兵到哪一年(作者立的君主强制亲征时,先前那场仗还没打完) */
    /** son = 领兵的是君主的儿子(没即位的宗室,或即位以前的君主) */
    const cur: ({ p: Person; careerEnd: number; cmd: PersonCommand; general: boolean; keep?: number; son?: Son } | null)[] = [null, null];
    const close = (s: number, until: Year) => {
      const c = cur[s];
      if (!c) return;
      if (c.son || c.general) leading.delete(c.p);
      c.cmd.until = Math.max(c.cmd.from, until);
      if (c.general) {
        const g = genOf[sides[s]].find((x) => x.p === c.p);
        if (g) g.busy = c.cmd.until;
      } else busyRuler.set(c.p, Math.max(c.keep ?? -Infinity, c.cmd.until));
      cur[s] = null;
    };
    const appoint = (s: number, t: Year, x: number, idx: number) => {
      const pid = sides[s];
      const P = polities[pid];
      if (!P || !(t >= P.founded) || (P.ended !== undefined && t > P.ended)) return;
      const command = (p: Person) => {
        const cmd: PersonCommand = { war: w.id, side: s as 0 | 1, from: t, until: t, first: idx, last: idx };
        (p.commands ??= []).push(cmd);
        return cmd;
      };
      // 好战的君主亲征(越好战越常亲征)
      const ruler = rulerAt(rulers[pid], t);
      // 作者立的君主即位那一刻,排在立他以前的事(同一年先下的宣战)他还没即位:不由他领兵
      const c = ruler && crownBy.get(ruler);
      if (ruler && (!c || ruler.from! < t || (ivAnnal.get(c.iv) ?? Infinity) < idx)) {
        // 作者立的君主在位时,作者下令打的仗(强制宣战,这国是攻方)一律由他亲征
        if (x === 0 && s === 0 && c && forced.has(w.id)) {
          cur[s] = { p: ruler, careerEnd: ruler.until ?? Infinity, cmd: command(ruler), general: false, keep: busyRuler.get(ruler) };
          busyRuler.set(ruler, Infinity);
          return;
        }
        const age = t - ruler.born;
        const free = (busyRuler.get(ruler) ?? -Infinity) <= t;
        const seg = policies.size ? segAt(policies.get(pid), t) : null;
        const ls = leaningsOf(ruler, t);
        const lead = (seg ? policyEffect(ls, seg.v) : leaningEffect(ls)).lead;
        // 有人掌着实权的那几年,名义君主不亲征
        if (free && royalSeg(P, ruler.dynasty ?? 0) && age >= LEAD_AGE[0] && age <= LEAD_AGE[1] && !held(pid, t) && wr(x * 2 + s, U_LEAD) < LEAD * lead) {
          cur[s] = { p: ruler, careerEnd: ruler.until ?? Infinity, cmd: command(ruler), general: false };
          busyRuler.set(ruler, Infinity);
          return;
        }
        // 成年、在世、闲着的儿子替父出征(儿子越多越常领兵);先君的儿子(君主的兄弟)也领兵
        const rs = rulers[pid];
        const before = rs[rs.indexOf(ruler) - 1];
        const kin = before && (before.dynasty ?? 0) === (ruler.dynasty ?? 0) ? [...(sonsOf.get(ruler) ?? []), ...(sonsOf.get(before) ?? [])] : (sonsOf.get(ruler) ?? []);
        const ok = kin.filter(
          (k) =>
            k.p !== ruler &&
            k.debut <= t &&
            t >= k.p.born + PRINCE_AGE[0] &&
            t <= k.p.born + PRINCE_AGE[1] &&
            k.end > t &&
            !away(k.p, t) &&
            (busyRuler.get(k.p) ?? -Infinity) <= t &&
            // 做过君主、已经下台的不再领兵
            (k.p.role !== 'ruler' || (k.p.until ?? Infinity) > t),
        );
        if (ok.length && wr(x * 2 + s, U_PRINCE) < 1 - Math.pow(1 - PRINCE_LEAD, ok.length)) {
          // 预定的继承人(太子)更常领兵:按 HEIR_WEIGHT 份算
          const wt = (k: Son) => (k.heirAt !== undefined && t <= k.heirAt ? HEIR_WEIGHT : 1);
          let u = wr(x * 2 + s, U_PRINCE_PICK) * ok.reduce((n, k) => n + wt(k), 0);
          let k = ok[ok.length - 1];
          for (const o of ok) if ((u -= wt(o)) < 0) {
            k = o;
            break;
          }
          // 后来即位的(预定的继承人):他下台(被废、让位)那一刻也就不再领兵,换人
          const reignEnd = k.p.role === 'ruler' ? (k.p.until ?? Infinity) : Infinity;
          cur[s] = { p: k.p, careerEnd: Math.min(k.end, k.p.born + PRINCE_AGE[1], reignEnd, banished.get(k.p) ?? Infinity), cmd: command(k.p), general: false, son: k };
          busyRuler.set(k.p, Infinity);
          leading.set(k.p, (u) => close(s, u));
          return;
        }
      }
      // 本国在世、正闲着的将领;没有就新起一位
      const g = genOf[pid].find((c) => c.busy <= t && c.careerEnd > t && c.p.born + GENERAL_AGE[0] <= t) ?? raise(pid, t);
      g.busy = Infinity;
      cur[s] = { p: g.p, careerEnd: g.careerEnd, cmd: command(g.p), general: true };
      // 他入朝秉政(大将专权)那一刻卸下这一任
      leading.set(g.p, (u) => cur[s]?.p === g.p && close(s, u));
    };
    steps.push({
      idx: w.decl,
      run: () => {
        appoint(0, w.start, 0, w.decl);
        appoint(1, w.start, 0, w.decl);
      },
    });
    for (let n = 0; n < w.events.length; n++) {
      const idx = w.events[n];
      steps.push({ idx, run: () => step(n, idx) });
    }
    const step = (n: number, idx: number) => {
      const e = civ.annals[idx];
      const t = e.year;
      for (let s = 0; s < 2; s++) {
        const c = cur[s];
        // 任期到头就换人:将领到了卒年、退下的那一刻,君主下台的那一刻(亡国那一刻君主还在:殉国、出降、出奔)
        if (c && (c.careerEnd < t || (c.careerEnd === t && (c.general || t !== polities[c.p.polity].ended)))) close(s, c.careerEnd);
        if (!cur[s]) appoint(s, t, n + 1, idx);
        const cs = cur[s];
        if (cs) cs.cmd.last = idx;
      }
      // 据险断后(wars.ts 的 stand):不是统帅打的,另起一位部将守关隘,结局照史事
      if (e.kind === 'stand') {
        const s = e.a === w.a ? 0 : e.a === w.b ? 1 : -1;
        if (s >= 0) rearGuard(s, t, idx, e.cause, n);
        return;
      }
      // 输的一方:攻方没打下来(battle 的 a)/ 丢了州(conquer 的 b)
      const loser = e.kind === 'battle' ? e.a : e.b;
      const s = loser === w.a ? 0 : loser === w.b ? 1 : -1;
      const c = s >= 0 ? cur[s] : null;
      // 战功:两边的统帅各记一笔
      if (s >= 0) {
        if (c) merit.set(c.p, (merit.get(c.p) ?? 0) - 1);
        const v = cur[1 - s];
        if (v) merit.set(v.p, (merit.get(v.p) ?? 0) + 1);
      }
      // 将领、没即位的宗室会战死(君主亲征、预定即位以前的继承人不会)
      if (
        c &&
        (c.general || (c.son && c.p.role === 'prince' && !(c.son.heirAt !== undefined && t <= c.son.heirAt))) &&
        !spared(c.p, t) &&
        wr(n + 1, U_FALL) < (e.kind === 'battle' ? FALL_ATTACK : FALL_DEFEND)
      ) {
        c.p.died = t;
        c.p.fate = 'battle';
        const g = genOf[sides[s]].find((x) => x.p === c.p);
        if (g) g.careerEnd = t;
        if (c.son) c.son.end = t;
        close(s, t);
      }
    };
    /**
     * 据险断后的守将:本国新起一位将领(部将),这一回只经手这一条史事(PersonCommand.rear)。
     * 力战而死 = 当场战死;力竭被擒 = 不再领兵(生死照常);全师而退 = 照常是本国的将领,日后还能领兵。
     * 这一方正由宗室领兵的,有 PRINCE_REAR 的机会由他亲自断后(见 princeRear)
     */
    const rearGuard = (s: number, t: Year, idx: number, how: Annal['cause'], n: number) => {
      const pid = sides[s];
      const P = polities[pid];
      if (!P || !(t >= P.founded) || (P.ended !== undefined && t > P.ended)) return;
      if (princeRear(s, t, idx, how, n)) return;
      const g = raise(pid, t);
      (g.p.commands ??= []).push({ war: w.id, side: s as 0 | 1, from: t, until: t, first: idx, last: idx, rear: true });
      g.busy = t;
      if (how === 'withdrew') return;
      g.careerEnd = Math.min(g.careerEnd, t);
      if (how === 'captured' || (g.p.died !== undefined && g.p.died < t)) return;
      g.p.died = t;
      g.p.fate = 'battle';
    };
    /**
     * 领兵的宗室亲自断后:这一方的统帅是没即位、日后也不即位的王子(不是预定的继承人、日后不用他摄政 / 结亲),
     * 有 PRINCE_REAR 的机会由他守关隘(这一条也记成 PersonCommand.rear)。力战而死 = 当场战死,这一任到此为止;
     * 力竭被擒 = 这一任到此为止、不再领兵(生死照常);全师而退 = 接着领兵。返回 true = 由他断后
     */
    const princeRear = (s: number, t: Year, idx: number, how: Annal['cause'], n: number): boolean => {
      const c = cur[s];
      if (!c?.son || c.p.role !== 'prince' || (c.son.heirAt !== undefined && t <= c.son.heirAt) || spared(c.p, t)) return false;
      if (wr(n + 1, U_PRINCE_REAR) >= PRINCE_REAR) return false;
      const x = c.p;
      (x.commands ??= []).push({ war: w.id, side: s as 0 | 1, from: t, until: t, first: idx, last: idx, rear: true });
      if (how === 'withdrew') return true;
      if (how !== 'captured') {
        x.died = t;
        x.fate = 'battle';
        c.son.end = t;
      }
      close(s, t);
      if (how === 'captured') busyRuler.set(x, Infinity);
      return true;
    };
    steps.push({
      idx: w.endIdx,
      run: () => {
        for (let s = 0; s < 2; s++) {
          const c = cur[s];
          if (c) close(s, Math.min(w.end, c.careerEnd));
        }
      },
    });
  }
  // 争储:继位的君主即位那一刻(那年以前的仗都打完了、战功记好了,那一刻以后的事还没排)
  const annalAt = (t: Year) => {
    let lo = 0;
    let hi = civ.annals.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (civ.annals[mid].year < t) lo = mid + 1;
      else hi = mid;
    }
    return lo - 0.5;
  };
  /** 新君 → 争储的结果(编号排好以后写进 Person.claim) */
  const claims = new Map<Person, { how: NonNullable<Person['claim']>['how']; rivals: Person[] }>();
  const rivalOf = new Map<Person, Person>();
  for (const p of polities) {
    if (p.lineage === 'republic') continue;
    const list = rulers[p.id];
    for (let k = 1; k < list.length; k++) {
      const X = list[k];
      const R = list[k - 1];
      const sons = sonsOf.get(R);
      const r = reignOf.get(X);
      // 先君遇弑的不争(名臣迎立新君,officials.ts)
      if (!sons || !r || X.rise !== 'heir' || R.author !== undefined || R.fate === 'murdered' || (R.dynasty ?? 0) !== (X.dynasty ?? 0) || X.from === undefined) continue;
      // 这一刻有宗室据地争位(推演里的内乱,见上):不另争储;摄政的叔父废了幼主的、先君晚年新君已引兵入朝的(regents.ts)也不争
      if (secededAt.get(p.id)?.has(X.from) || r.seize) continue;
      const rk = reignOf.get(R)?.k;
      if (marchedAt.has(`${p.id}:${rk}`)) continue;
      const T = X.from;
      steps.push({
        idx: annalAt(T),
        run: () => {
          const res = contest(X, R, T, banished.size ? sons.filter((s) => !away(s.p, T)) : sons, r.k, { base, tag: tag[p.id], merit: (x) => merit.get(x) ?? 0, armed: (x) => !!x.commands?.some((c) => c.from < T), spare: (x) => spared(x, T) });
          if (!res) return;
          claims.set(X, { how: res.how, rivals: res.rivals.map((s) => s.p) });
          for (const s of res.killed) {
            s.p.died = T;
            s.p.fate = 'purged';
            s.end = T;
            rivalOf.set(s.p, X);
            leading.get(s.p)?.(T);
          }
        },
      });
    }
  }
  // 掌实权(regents.ts)那一刻:引兵入朝的太子杀兄长和战功比他多的兄弟(和举兵夺位同一种杀法);大将专权的是本国战功最多的那位将领
  /** 大将专权 → 那位将领(没有合适的 = 不在里面,由名臣顶上) */
  const strongGenerals = new Map<Span, Person>();
  for (const s of spans) {
    const { g, pid, N } = s;
    if (g.kind === 'march') {
      steps.push({
        idx: g.annal,
        run: () => {
          const sons = sonsOf.get(N);
          const H = sons?.find((x) => x.heirAt !== undefined);
          if (!sons || !H) return;
          const res = march(H, g.start, sons, g.k, { base, tag: tag[pid], merit: (x) => merit.get(x) ?? 0, spare: (x) => spared(x, g.start) });
          claims.set(H.p, { how: 'march', rivals: res.rivals.map((x) => x.p) });
          for (const x of res.killed) {
            x.p.died = g.start;
            x.p.fate = 'purged';
            x.end = g.start;
            rivalOf.set(x.p, H.p);
            leading.get(x.p)?.(g.start);
          }
        },
      });
    } else if (g.kind === 'general' && !authorRegentOf(civ, g)) {
      // 作者下令"让他掌权"的将领:就是人物键里的那位(按生年认;名字这时还没起);推演里自己出的:本国战功最多的那位
      const iv = g.iv !== undefined ? civ.interventions?.[g.iv] : undefined;
      const who = iv?.kind === 'regent' ? parsePersonKey(iv.person) : null;
      steps.push({
        idx: g.annal,
        run: () => {
          const t = g.start;
          let best: (typeof genOf)[number][number] | undefined;
          for (const c of genOf[pid]) {
            if (!c.p.commands?.length || c.p.born + GENERAL_AGE[0] > t || c.careerEnd <= t || (c.p.died !== undefined && c.p.died <= t)) continue;
            if (g.iv !== undefined ? who && Math.round(c.p.born) === who.born && !best : !best || (merit.get(c.p) ?? 0) > (merit.get(best.p) ?? 0)) best = c;
          }
          if (!best) return;
          // 入朝秉政:正领着的兵就此交出、不再挂帅出征;掌着权的那几年不会战死
          leading.get(best.p)?.(t);
          best.careerEnd = Math.min(best.careerEnd, t);
          keep(best.p, s.until ?? g.stop);
          strongGenerals.set(s, best.p);
        },
      });
    }
  }
  steps.sort((u, v) => u.idx - v.idx);
  for (const x of steps) x.run();

  // ---- 后妃(consorts.ts)的头一半:名臣辅政里哪几段换成太后临朝(名臣那边不再为这一段起人)、她是谁 ----
  const CR = consortRand(civ.seed);
  /** 一门亲的娶亲的人(并成一人以后再查,查到的是并成的那位) */
  const groomOf = (m: Match): Person | undefined => {
    const R = byK[m.a].get(m.code >> 4);
    const s = m.code & 15;
    return !R ? undefined : s === GROOM_SELF ? R : sonsOf.get(R)?.find((x) => (s === 0 ? x.heirAt !== undefined : x.heirAt === undefined && x.p.born === m.born))?.p;
  };
  /** 一门亲里嫁女的那位(那一刻那国在位的君主;那国在这一刻被娶亲的一方并掉的,是并国以前在位的那位) */
  const brideFatherOf = (m: Match) => rulerAt(rulers[m.b] ?? [], m.t) ?? rulerAt(rulers[m.b] ?? [], m.t - 1 / 512);
  /** 娶亲的人 → 他的几门亲(按先后) */
  const wedsOf = new Map<Person, Match[]>();
  for (const m of matches) {
    const G = groomOf(m);
    if (!G || G.author !== undefined) continue;
    const l = wedsOf.get(G);
    if (l) l.push(m);
    else wedsOf.set(G, [m]);
  }
  /** 君主的儿子 → 父亲(royals.ts 的诸子) */
  const sonFather = new Map<Person, Person>();
  for (const [F, ss] of sonsOf) for (const x of ss) sonFather.set(x.p, F);
  /** 这位儿子的母亲是哪一门亲嫁来的(父亲娶她以后、下一门亲以前出生的);没有 = undefined */
  const motherMatch = (kid: Person, F: Person | undefined): Match | undefined => {
    let hit: Match | undefined;
    for (const m of (F && wedsOf.get(F)) ?? []) if (m.t < kid.born) hit = m;
    return hit;
  };
  /**
   * 一门亲里嫁来的宗室女(先只排生年、卒年,名字等下面起);并成一人以后、知道娶亲的是男是女以后再定收不收。
   * 生年、卒年只看结亲那一刻(推到哪一年都一样)
   */
  const brideOf = new Map<Match, Person>();
  const makeBride = (m: Match): Person => {
    let b = brideOf.get(m);
    if (b) return b;
    const F = brideFatherOf(m);
    const t0 = tag[m.b] ?? 0;
    const born = brideBorn(CR, t0, m.t, F?.born);
    const died = consortDeath(CR, t0, m.t, K_BRIDE, born, m.t + 1);
    b = { id: -1, role: 'consort', polity: m.b, name: '', female: true, born, died };
    if (F?.dynasty !== undefined) b.dynasty = F.dynasty;
    brideOf.set(m, b);
    return b;
  };
  /** 临朝的那几段 → 太后(嫁来的宗室女就是她本人;篡位的 = 新朝的第一位);她丈夫的幼主 */
  const dowagerOf = new Map<Span, Person>();
  /** 太后们的籍贯(嫁来的不要)、东方带姓的姓(篡位的照新朝的姓,已经在名字里) */
  const dowagerHomes: { x: Person; year: Year; u: number }[] = [];
  const dowagerSur = new Map<Person, string>();
  /** 太后的丈夫(幼主的父亲):royals.ts 的诸子里出道时就定得下来的(定了是女的不安排太后);说不准的排完世系再认、让他照旧是男的 */
  const husbandOf = new Map<Person, Person>();
  /** 太后是嫁来的宗室女的:娶她的人(照旧是男的,她才是人物) */
  const dowagerGrooms = new Set<Person>();
  const wctx0 = { seed: civ.seed, polities, tag, styleOf, namerOf: (p: Polity) => namerOf(styleOf(p)), rbase: base, reignOf, sons: sonsOf, usurped: new Map<Person, Person>(), retitle: () => {} };
  for (const s of spans) {
    const { g, pid, N } = s;
    if (g.kind !== 'minister' || g.iv !== undefined || N.author !== undefined) continue;
    const P = polities[pid];
    const t0 = tag[pid] ?? 0;
    if (!P || !isDowager(CR, t0, g.start, styleOf(P))) continue;
    const F = sonFather.get(N);
    // 摄政篡位的叔父、据地自立的开国之君日后才和做宗室时的他并成一人(出道时的身份那时才定):说不准
    const merging = !!F && (!!reignOf.get(F)?.seize || (seceded.has(F.polity) && rulers[F.polity][0] === F));
    const sex = F && !merging ? debutSex(F, wctx0) : undefined;
    if (sex === 'female') continue;
    const mm = motherMatch(N, F);
    if (mm) {
      // 幼主的母亲本来就是嫁来的宗室女:太后就是她(生年、寿数照她自己的:幼主要生在她 16–45 岁之间、她要活过原定还政的那一年;
      // 篡位开国的不换,新朝第一位的生年、姓对不上她)
      const b = makeBride(mm);
      if (g.outcome === 'usurp' || !bears(b.born, b.died, N.born) || (b.died ?? Infinity) <= g.stop) continue;
      dowagerOf.set(s, b);
      if (sex === 'male') husbandOf.set(N, F!);
      else dowagerGrooms.add(F!);
      continue;
    }
    // 别的:生年照推演里掌权的人,幼主要生在她 16–45 岁之间
    if (!bears(g.born, undefined, N.born)) continue;
    // 原定要篡位的(推到她篡位以前也是这一位):东方的姓照新朝的姓(和名臣篡位一样);篡了位就和新朝的第一位并成一人(下面)
    const died = consortDeath(CR, t0, g.start, K_DOWAGER, g.born, Math.max(g.stop + 1, g.start + 2));
    const x: Person = { id: -1, role: 'consort', polity: pid, name: '', female: true, born: g.born, died, dynasty: g.dyn };
    const namer = namerOf(styleOf(P));
    if (namer.surnamed) {
      const prev = surnames[pid][g.dyn] ?? '';
      dowagerSur.set(x, g.outcome === 'usurp' ? otherSurname((t) => namer.surname(tag[pid], 0, g.dyn + 1, t), prev) : otherSurname((t) => namer.surname(t0, K_DOWAGER, Math.round(g.start * 256), U_SURNAME + t), prev));
    }
    dowagerOf.set(s, x);
    if (F && sex === 'male') husbandOf.set(N, F);
    dowagerHomes.push({ x, year: g.start, u: dowagerHomeU(CR, t0, g.start) });
  }
  // ---- 将门(kin.ts):新起的将领有机会是本国先前一位将领的孩子;随父姓(起名时现读父辈的姓),籍贯同父亲(officials.ts)----
  const hBase = houseBase(civ.seed);
  const houseG = pickHouses(
    generals.map((x) => {
      const gi = genIdx.get(x)!;
      const cs = x.commands!;
      return { x, debut: cs[0].from, died: x.died ?? Infinity, merit: (t: Year) => cs.filter((c) => c.from < t).length, u: (use: number) => keyed4(hBase, tag[x.polity], gi, use, K_HOUSE_GENERAL) };
    }),
    HEIR.general,
  );
  for (const [x, f] of houseG) if (namerOf(styleOf(polities[x.polity])).surnamed) genName.set(x, withParentSurname(genName.get(x)!, f, splitSurname));

  // ---- 名臣(编号排在宗室后面,君主、将领、宗室的编号不变),顺带给将领填籍贯、号、官职(officials.ts)----
  // 掌实权的名臣、大臣(大将专权没有合适的将领的,也由一位大臣顶上):专门起一位,生年照推演里的;篡位的照新朝的姓起名
  const forcedRegs = new Map<number, ForcedRegent[]>();
  const forcedOf = new Map<Span, ForcedRegent>();
  for (const s of spans) {
    const { g, pid, N } = s;
    // 作者下令"让他掌权"的名臣、将领:就是他本人(下面按人物键认),不另起;换成太后临朝的那几段也不起
    if (g.iv !== undefined || dowagerOf.has(s)) continue;
    if (!(g.kind === 'minister' || g.kind === 'chancellor' || (g.kind === 'general' && !strongGenerals.has(s)))) continue;
    const P = polities[pid];
    const f: ForcedRegent = { dyn: g.dyn, year: g.start, born: g.born, stay: g.stop, kind: g.kind === 'minister' ? 'regent' : 'power', who: N };
    if (s.until !== undefined) f.until = s.until;
    if (s.end === 'purged' || s.end === 'died') f.fate = s.end;
    const namer = namerOf(styleOf(P));
    if (g.outcome === 'usurp' && namer.surnamed) {
      // 他篡位以后新朝的姓(和下面排君主时一样:换一个和这一朝不同的姓)
      const prev = surnames[pid][g.dyn] ?? '';
      let sur = '';
      for (let t = 0; !sur || (sur === prev && t < 20); t++) sur = namer.surname(tag[pid], 0, g.dyn + 1, t);
      f.surname = sur;
    }
    forcedOf.set(s, f);
    const list = forcedRegs.get(pid);
    if (list) list.push(f);
    else forcedRegs.set(pid, [f]);
  }
  const { ministers, fixups, nameAt, finish, regents: forcedPeople, houses: houseM } = civ.log
    ? buildOfficials(
        { seed: civ.seed, endYear, polities, settlements, annals: civ.annals, upheavals: civ.upheavals, log: civ.log, regionCount: civ.regionCount ?? 0 },
        { tag, rulers, styleOf, namerOf: (p) => namerOf(styleOf(p)), kills, ids, regents: forcedRegs, homes: dowagerHomes, houses: houseG },
        generals,
      )
    : { ministers: [], fixups: [], nameAt: new Map<Person, (a: number) => string>(), finish: () => {}, regents: new Map<ForcedRegent, Person>(), houses: new Map<Person, Person>() };

  // ---- 起名:将领、名臣按出道先后(第一次领兵、入仕)一个个起 ----
  const book = new NameBook(rulers);
  const naming = [
    ...generals.map((x, k) => ({ x, T: x.commands![0].from, at: genName.get(x)!, k })),
    ...ministers.map((x, k) => ({ x, T: x.from!, at: nameAt.get(x)!, k: generals.length + k })),
  ].sort((a, b) => a.T - b.T || a.k - b.k);
  for (const n of naming) n.x.name = book.pick(n.at, n.x.born, n.x.polity, n.T);
  finish();

  // 摄政的叔父废了幼主自立(regents.ts):排世系时他还当宗室(在他父亲名下、照宗室起名),排完再和即位的那一位并成一人
  const seizes: { son: Son; F: Person; N: Person }[] = [];
  for (const s of spans) {
    if (s.end !== 'usurp') continue;
    const F = byK[s.pid].get(s.g.k + 1);
    let son: Son | undefined;
    if (s.g.kind === 'uncle' && s.g.uncle) {
      const Fa = byK[s.pid].get(s.g.uncle.k);
      son = Fa && sonsOf.get(Fa)?.find((x) => x.p.role === 'prince' && x.heirAt === undefined && x.p.born === s.g.born);
    } else if (s.g.kind === 'march' || s.g.kind === 'heir') {
      // 作者下令"让他掌权"的太子到期篡位:废了父亲接着在位(同一朝),和预定的继承人并成一人
      son = sonsOf.get(s.N)?.find((x) => x.p.role === 'prince' && x.heirAt !== undefined && x.p.born === s.g.born);
    }
    if (!F || !son || !reignOf.get(F)?.seize) continue;
    seizes.push({ son, F, N: s.N });
    // 排世系时不按年纪给他另找父亲(并成一人时接上做宗室时的父亲)
    F.rise = 'rise';
  }

  // ---- 世系:谁是谁的父亲,补上没即位的宗室(不和本国的君主、将领、名臣重名)----
  const { princes, parentOf, debut, descent } = buildLineage(polities, rulers, [...generals, ...ministers], { tag, namerOf: (p) => namerOf(styleOf(p)), surnameOf: (r) => splitSurname(r.name), sons: sonsOf });
  // 据地争位的宗室和他立的国的开国之君并成一人:名字、父亲、早先领的兵都是做宗室时的(推到那一刻以前,他已经以宗室的身份在了)
  const merged = new Map<Person, Person>();
  // 摄政篡位的叔父同样并成一人(在本国,同一朝接着即位)
  for (const { son, F, N } of seizes) {
    F.rise = 'heir';
    const S = son.p;
    F.name = S.name;
    if (S.commands) F.commands = [...S.commands, ...(F.commands ?? [])];
    const f = parentOf.get(S);
    parentOf.delete(S);
    if (f) parentOf.set(F, f);
    if (S.adopted) F.adopted = true;
    merged.set(S, F);
    son.p = F;
    claims.set(F, { how: 'seize', rivals: [N] });
    titleRulers(polities[F.polity], rulers[F.polity], facts[F.polity], base, tag[F.polity]);
  }
  for (const { son, F, X } of claimed) {
    const S = son.p;
    if (S.fate === 'battle') {
      // 那以前就战死了:开国之君另是一位宗室(连不上父亲)
      if (X) claims.set(F, { how: 'secede', rivals: [X] });
      continue;
    }
    F.name = S.name;
    if (S.commands) F.commands = [...S.commands, ...(F.commands ?? [])];
    const f = parentOf.get(S);
    parentOf.delete(S);
    if (f) parentOf.set(F, f);
    if (S.adopted) F.adopted = true;
    merged.set(S, F);
    son.p = F;
    if (X) claims.set(F, { how: 'secede', rivals: [X] });
    titleRulers(polities[F.polity], rulers[F.polity], facts[F.polity], base, tag[F.polity]);
  }
  /**
   * F 改了名字(和做宗室、名臣时的他并成一人):他即位以后出道的将领、名臣起名时还不知道他叫什么 ——
   * 和他同国同名、或前后 NAME_GAP 年里出生的同名的,换一个(本国没人用的)
   */
  const renameClashes = (F: Person) => {
    const start = (o: Person) => (o.role === 'general' ? o.commands![0].from : o.role === 'prince' ? (debut.get(o) ?? o.born) : o.from!);
    for (const g of [...generals, ...ministers]) {
      if (g === F || g.name !== F.name || start(g) < F.from!) continue;
      if (g.polity !== F.polity && Math.abs(g.born - F.born) >= NAME_GAP) continue;
      // 换一个他出道时他那一国还没人用的(只看那以前出道的:往后推不改他的名字)
      const T = start(g);
      const taken = new Set([...rulers[g.polity], ...generals, ...ministers, ...princes].filter((o) => o.polity === g.polity && o !== g && start(o) <= T).map((o) => o.name));
      taken.add(F.name);
      const at = genName.get(g) ?? nameAt.get(g);
      for (let a = 1; at && a < NAME_TRIES && taken.has(g.name); a++) g.name = at(a);
    }
  };
  const seizers = new Set(seizes.map((s) => s.F));
  if (merged.size) {
    for (const [x, f] of parentOf) if (merged.has(f)) parentOf.set(x, merged.get(f)!);
    for (let i = princes.length - 1; i >= 0; i--) if (merged.has(princes[i])) princes.splice(i, 1);
    // 他立的国的将领、名臣(都在他即位以后出道)起名时还不知道他叫什么:撞了名的换一个本国没人用的(连同宗室)
    for (const F of merged.values()) {
      // 他即位以后出道、前后 NAME_GAP 年里出生的别国将领、名臣也不和他同名
      renameClashes(F);
      if (seizers.has(F)) continue;
      const taken = new Set([...rulers[F.polity], ...generals, ...ministers, ...princes].filter((o) => o.polity === F.polity).map((o) => o.name));
      for (const g of [...generals, ...ministers]) {
        if (g.polity !== F.polity || g.name !== F.name) continue;
        const at = genName.get(g) ?? nameAt.get(g);
        for (let a = 1; at && a < NAME_TRIES && taken.has(g.name); a++) g.name = at(a);
        taken.add(g.name);
      }
    }
  }
  // 掌实权的名臣、大臣篡位(改朝换代):和新朝的第一位并成一人 —— 名字、字号、籍贯、官职、经手的事都是做名臣时的,
  // 编号排在他做名臣时的位置(推到他篡位以前,他已经以名臣的身份在了;起名时就照新朝的姓起的)
  const usurpers = new Map<Person, Person>();
  /** 篡位的名臣 → 新朝第一位(并成的那一个) */
  const usurperOf = new Map<Person, Person>();
  for (const s of spans) {
    if (s.end !== 'usurp' || (s.g.kind !== 'minister' && s.g.kind !== 'chancellor')) continue;
    const f = forcedOf.get(s);
    const S = f && forcedPeople.get(f);
    const F = rulers[s.pid].find((x) => (x.dynasty ?? 0) === s.g.dyn + 1);
    // 作者让他在篡位以前去世的(干预;推演里不管名臣):不并,他照旧是去世的名臣,新朝的第一位另是一人
    if (!S || !F || F.rise !== 'usurp' || S.killed !== undefined) continue;
    F.name = S.name;
    if (S.courtesy) F.courtesy = S.courtesy;
    if (S.art) F.art = S.art;
    if (S.home !== undefined) F.home = S.home;
    if (S.posts) F.posts = S.posts;
    if (S.deeds) F.deeds = S.deeds;
    usurpers.set(F, S);
    usurperOf.set(S, F);
    titleRulers(polities[F.polity], rulers[F.polity], facts[F.polity], base, tag[F.polity]);
  }
  // 临朝的太后篡位(改朝换代):和新朝的第一位并成一人 —— 名字(照新朝的姓起)、籍贯是做太后时的,编号排在她临朝的那一刻
  /** 太后(做太后时的那一份,不收进人物)→ 新朝第一位 */
  const dowagerF = new Map<Person, Person>();
  for (const s of spans) {
    const D = dowagerOf.get(s);
    if (s.end !== 'usurp' || !D || D.role !== 'consort' || D.polity !== s.pid) continue;
    const F = rulers[s.pid].find((x) => (x.dynasty ?? 0) === s.g.dyn + 1);
    if (!F || F.rise !== 'usurp') continue;
    if (D.home !== undefined) F.home = D.home;
    dowagerF.set(D, F);
  }
  if (usurpers.size) {
    const gone = new Set(usurpers.values());
    for (let i = ministers.length - 1; i >= 0; i--) if (gone.has(ministers[i])) ministers.splice(i, 1);
    for (const F of usurpers.keys()) renameClashes(F);
  }
  // ---- 作者的人物任将任臣(appoint.ts):推演里的人一个不变,只是多了他 ----
  // 名字空着(界面按人物卡填)、生年照干预、不写卒年;任期、怎么卸任的、挂帅哪几仗照 appoint.ts 那一份
  const officers: Person[] = [];
  /** 作者的名臣经手的事记着的人(排好编号再换) */
  const officerFix: [PersonDeed, Person][] = [];
  // 让作者的人物掌权的那几段:任期里掌了权、掌权比任期长的,在任到掌权了结(appoint.ts)
  const holds = spans.flatMap((s) => {
    const av = authorRegentOf(civ, s.g);
    return av ? [{ char: av.char, polity: s.pid, start: s.g.start, ...(s.until !== undefined ? { stop: s.until } : {}), died: s.end === 'died' }] : [];
  });
  const aposts = civ.interventions?.length ? authorPostsFrom({ annals: civ.annals, polities, endYear, interventions: civ.interventions, holds }) : [];
  if (aposts.length) {
    const warById = new Map(wars.map((w) => [w.id, w]));
    for (const ap of aposts) {
      const P = polities[ap.polity];
      if (ap.skip || !P) continue;
      const x: Person = { id: -1, role: ap.role, polity: ap.polity, name: '', born: ap.born, from: ap.from, author: ap.char };
      if (ap.role === 'minister') x.dynasty = ap.dynasty;
      if (ap.until !== undefined) x.until = ap.until;
      if (ap.end) x.fate = ap.end;
      const stop = ap.until ?? endYear;
      if (ap.role === 'general') {
        // 挂帅的一段:第一件 = 接手那一刻,最后一件 = 交出以前那场战争的最后一仗
        const cs = ap.wars.map((w): PersonCommand => {
          let last = w.start;
          for (const i of warById.get(w.war)?.events ?? []) if (i >= w.start && i < w.stop && i > last) last = i;
          return { war: w.war, side: w.side, from: w.from, until: w.until, first: w.start, last };
        });
        if (cs.length) x.commands = cs;
        x.posts = generalPosts(P, x, civ.annals, (use) => keyed4(base, tag[ap.polity], ap.char, use, K_AUTHOR), ap.from);
      } else {
        const ds = courtDeeds({ annals: civ.annals, polities, upheavals: civ.upheavals }, P, ap.dynasty, ap.from, stop, rulers[ap.polity]);
        if (ds.length)
          x.deeds = ds.map(({ deed, who }) => {
            if (who) officerFix.push([deed, who]);
            return deed;
          });
        // 最高的官同一时间只一位:升到那一级的那一刻推演里本国的名臣正做着这个官,他写次一级(只看那一刻,往后推不改他先前的官)
        const held = (title: string, t: Year) =>
          ministers.some((m) => m.polity === ap.polity && (m.posts ?? []).some((pt, k, ps) => pt.title === title && pt.from <= t && (ps[k + 1]?.from ?? m.until ?? Infinity) > t));
        x.posts = seniorityPosts(P, ap.from, stop, held, x.deeds?.[0]?.kind);
      }
      officers.push(x);
    }
  }
  // 掌实权的那一段挂到人身上:引兵入朝、太子监国 = 预定的继承人;宗室摄政 = 叔父;名臣辅政、大臣专权 = 专门起的那位名臣(篡位了 = 新朝的第一位);
  // 大将专权 = 那位将领(没有合适的将领 = 顶上的那位大臣,记成大臣专权)
  const segs: [PersonRegency, Person][] = [];
  /** 作者的人物掌权(干预"让他掌权"带 char):每国每位作者的人物一位(国家:人物编号 → 他),出道 = 头一回掌权那一刻 */
  const authors = new Map<string, { x: Person; T: Year }>();
  for (const s of spans) {
    const { g } = s;
    let kind: PersonRegency['kind'] = g.kind;
    let holder: Person | undefined;
    const av = authorRegentOf(civ, g);
    // 他那时正任着这国的将领 / 名臣(干预"任将 / 任臣"):挂在他任职的那一位上(将领 = 大将专权、名臣 = 大臣专权);
    // 掌权比任期长的,任期已经排到掌权了结(appoint.ts 的 holds)
    const post = av && officers.find((x) => x.author === av.char && x.polity === s.pid && x.from! <= g.start && (x.until === undefined || x.until > g.start));
    if (post) {
      const seg: PersonRegency = { kind: post.role === 'general' ? 'general' : 'chancellor', from: s.from, ruler: -1, annal: g.annal };
      if (s.until !== undefined) seg.until = s.until;
      if (s.end) seg.end = s.end;
      if (s.endAnnal !== undefined) seg.endAnnal = s.endAnnal;
      (post.regencies ??= []).push(seg);
      segs.push([seg, s.N]);
      continue;
    }
    if (av) {
      // 没任职的:单起一位名臣。名字空着(界面按人物卡填,gen/characters.ts 的 applyCharacters)、不写卒年(生死归人物卡);按名臣的身份(大臣专权)
      const key = `${s.pid}:${av.char}`;
      let A = authors.get(key);
      if (!A) authors.set(key, (A = { x: { id: -1, role: 'minister', polity: s.pid, name: '', born: av.born, from: g.start, dynasty: g.dyn, author: av.char }, T: g.start }));
      const seg: PersonRegency = { kind: 'chancellor', from: s.from, ruler: -1, annal: g.annal };
      if (s.until !== undefined) seg.until = s.until;
      if (s.end) seg.end = s.end;
      if (s.endAnnal !== undefined) seg.endAnnal = s.endAnnal;
      // 掌权了结就去职(还掌着权 = 在朝)
      if (s.until !== undefined) A.x.until = s.until;
      else delete A.x.until;
      (A.x.regencies ??= []).push(seg);
      segs.push([seg, s.N]);
      continue;
    }
    if (g.kind === 'march' || g.kind === 'heir') holder = sonsOf.get(s.N)?.find((x) => x.heirAt !== undefined)?.p;
    else if (g.iv !== undefined && (g.kind === 'chancellor' || g.kind === 'general')) {
      // 作者下令"让他掌权"的名臣、将领:按人物键认(国家、生年、名字;名字对不上的按生年)
      const who = parsePersonKey(civ.interventions?.[g.iv]?.kind === 'regent' ? (civ.interventions[g.iv] as { person: string }).person : '');
      const pool = (g.kind === 'general' ? generals : ministers).filter((x) => x.polity === s.pid && who && Math.round(x.born) === who.born);
      holder = strongGenerals.get(s) ?? pool.find((x) => (x.defaultName ?? x.name) === who?.name) ?? pool[0];
    } else if (g.kind === 'uncle') {
      const Fa = g.uncle && byK[s.pid].get(g.uncle.k);
      holder = Fa ? sonsOf.get(Fa)?.find((x) => x.heirAt === undefined && x.p.born === g.born)?.p : undefined;
    } else if (dowagerOf.has(s)) {
      // 太后临朝(篡了位的 = 新朝的第一位)
      const D = dowagerOf.get(s)!;
      holder = dowagerF.get(D) ?? D;
      kind = 'dowager';
    } else {
      holder = strongGenerals.get(s);
      if (!holder) {
        const f = forcedOf.get(s);
        const S = f && forcedPeople.get(f);
        holder = S && usurperOf.get(S);
        holder ??= S;
        if (kind === 'general') kind = 'chancellor';
      }
    }
    if (!holder) continue;
    const seg: PersonRegency = { kind, from: s.from, ruler: -1, annal: g.annal };
    if (s.until !== undefined) seg.until = s.until;
    if (s.end) seg.end = s.end;
    if (s.endAnnal !== undefined) seg.endAnnal = s.endAnnal;
    // 作者让他去世(干预;推演里不管名臣、将领):掌权到他去世为止
    if (holder.killed !== undefined && holder.died !== undefined && holder.died < (seg.until ?? Infinity)) {
      seg.until = holder.died;
      seg.end = 'died';
      delete seg.endAnnal;
    }
    (holder.regencies ??= []).push(seg);
    segs.push([seg, s.N]);
    // 伏诛、卒于位:宗室、将领照那一刻(名臣在 officials.ts 里定了);他们掌着权的那几年不会先去世
    if (holder.killed !== undefined) continue;
    if ((s.end === 'purged' || s.end === 'died') && holder.role !== 'minister') {
      holder.died = s.until;
      holder.fate = s.end === 'purged' ? 'purged' : 'died';
      if (s.end === 'purged') rivalOf.set(holder, s.N);
    } else if (s.until !== undefined && holder.died !== undefined && holder.died < s.until && holder.role !== 'ruler') holder.died = s.until;
    else if (s.until === undefined && holder.died !== undefined && (holder.role === 'general' || holder.role === 'prince')) {
      // 推到最后还掌着权:推演里他还活着(寿数照推演里原定的了结那一刻往后算,人物这里先不写卒年)
      delete holder.died;
      delete holder.fate;
    }
  }
  // 将门、世家连上父辈(kin.ts 起名以前定的):掌权的那几段改过卒年,他出生时父辈已经不在了的不连;篡位、并进新朝的名臣不算。
  // 父辈后来改了名(和并成一人的开国之君撞名,见 renameClashes),孩子的姓跟着换(按出道先后,祖孙一路传下来)
  const staff = new Set<Person>([...generals, ...ministers]);
  const houses = [...houseG, ...houseM].filter(([x, f]) => staff.has(x) && staff.has(f) && x.born <= (f.died ?? Infinity));
  const debutOf = (x: Person) => (x.role === 'general' ? x.commands![0].from : x.from!);
  houses.sort((a, b) => debutOf(a[0]) - debutOf(b[0]));
  for (const [x, f] of houses) {
    parentOf.set(x, f);
    if (!namerOf(styleOf(polities[x.polity])).surnamed) continue;
    const sur = splitSurname(f.name);
    const own = splitSurname(x.name);
    if (own !== sur) x.name = sur + x.name.slice(own.length);
  }
  // 编号按出道先后排(同一年:君主、将领、宗室、名臣),接着往后推时先出道的人编号不变
  // 即位以前就是先君诸子之一的君主(royals.ts 预定的继承人、据地争位的宗室、摄政篡位的叔父):按做儿子出道的那一刻、在父亲那一国排;
  // 篡位的名臣:按他入仕的那一刻(推到他即位以前,他已经以宗室、名臣的身份在了)
  const asSon = new Map<Person, Son>();
  for (const ss of sonsOf.values()) for (const s of ss) if (s.p.role === 'ruler') asSon.set(s.p, s);
  // 临朝篡位的太后:按她临朝的那一刻(推到她篡位以前,她已经以太后的身份在了);后妃排在同一刻的人后面
  const dowagerAt = new Map<Person, Year>();
  for (const [s, D] of dowagerOf) dowagerAt.set(dowagerF.get(D) ?? D, s.from);
  const all: { x: Person; T: Year; r: number; pid: number; k: number }[] = [
    ...rulers.flat().map((x) => {
      const s = asSon.get(x);
      const m = usurpers.get(x);
      const d = dowagerAt.get(x);
      return s ? { x, T: s.debut, r: 2, pid: s.father.polity } : m ? { x, T: m.from!, r: 3, pid: x.polity } : d !== undefined ? { x, T: d, r: 4, pid: x.polity } : { x, T: x.from!, r: 0, pid: x.polity };
    }),
    ...generals.map((x) => ({ x, T: x.commands![0].from, r: 1, pid: x.polity })),
    ...princes.map((x) => ({ x, T: debut.get(x)!, r: 2, pid: x.polity })),
    ...ministers.map((x) => ({ x, T: x.from!, r: 3, pid: x.polity })),
    ...[...authors.values()].map(({ x, T }) => ({ x, T, r: 3, pid: x.polity })),
    ...officers.map((x) => ({ x, T: x.from!, r: x.role === 'general' ? 1 : 3, pid: x.polity })),
  ].map((e, k) => ({ ...e, k }));
  // 同一刻出道的宗室(一位君主即位时已经出生的几个儿子)按长幼
  const order = (a: (typeof all)[number], b: (typeof all)[number]) => a.T - b.T || a.r - b.r || a.pid - b.pid || (a.r === 2 ? a.x.born - b.x.born : 0) || a.k - b.k;
  /** 排编号、把按人记的关系换成编号(加进后妃以后再排一遍:别的人先后不变) */
  const number = (): Person[] => {
    all.sort(order);
    const list = all.map((e) => e.x);
    list.forEach((p, i) => (p.id = i));
    for (const [x, f] of parentOf) x.parent = f.id;
    for (const [x, d] of descent) x.descent = { from: d.from.id, gen: d.gen };
    for (const [x, c] of claims) x.claim = { how: c.how, rivals: c.rivals.map((r) => r.id) };
    for (const [x, by] of rivalOf) x.rival = by.id;
    for (const [d, x] of fixups) d.person = x.id;
    for (const [d, x] of officerFix) d.person = x.id;
    for (const [seg, N] of segs) seg.ruler = N.id;
    return list;
  };
  const wctx = {
    seed: civ.seed,
    polities,
    tag,
    styleOf,
    namerOf: (p: Polity) => namerOf(styleOf(p)),
    rbase: base,
    reignOf,
    sons: sonsOf,
    usurped: usurperOf,
    retitle: (pid: number) => titleRulers(polities[pid], rulers[pid], facts[pid], base, tag[pid]),
  };
  // 一部分人换成女的(women.ts):先定是谁(按出道时的身份;临朝的太后的丈夫照旧是男的:出道时定不下来的那几位排完世系才认)
  const keepMale = new Set<Person>(dowagerGrooms);
  for (const [s] of dowagerOf) {
    if (husbandOf.has(s.N)) continue;
    const H = parentOf.get(s.N);
    if (H && H.author === undefined) {
      husbandOf.set(s.N, H);
      keepMale.add(H);
    }
  }
  const women = pickWomen(number(), wctx, keepMale);
  // 自立为君的执政 / 将军和做执政时是同一个人:男女照那一份
  for (const [K, C] of selfOf) {
    if (women.has(C)) women.add(K);
    else women.delete(K);
  }

  // ---- 后妃(consorts.ts)的后一半:嫁来的宗室女(娶亲的是男的才有)、太后,收进人物、排编号 ----
  /** 收进来的后妃 → 起名用的姓、身份 */
  const consortNames = new Map<Person, ConsortName>();
  const brideOfMatch = new Map<Match, Person>();
  for (const m of matches) {
    const G = groomOf(m);
    if (!G || G.author !== undefined || women.has(G)) continue;
    const b = makeBride(m);
    brideOfMatch.set(m, b);
    if (consortNames.has(b)) continue;
    const F = brideFatherOf(m);
    const Q = polities[m.b];
    consortNames.set(b, { sur: F && F.author === undefined && Q && namerOf(styleOf(Q)).surnamed ? splitSurname(F.name) : '', kind: K_BRIDE });
    all.push({ x: b, T: m.t, r: 4, pid: m.b, k: all.length });
  }
  for (const [s, D] of dowagerOf) {
    const F = dowagerF.get(D);
    if (F) {
      // 篡了位的:新朝的第一位换成女的,名字照她做太后时的起法(推到她篡位以前、以后都是这个名字)
      consortNames.set(F, { sur: dowagerSur.get(D) ?? '', kind: K_DOWAGER });
      continue;
    }
    if (consortNames.has(D)) continue;
    consortNames.set(D, { sur: dowagerSur.get(D) ?? '', kind: K_DOWAGER });
    all.push({ x: D, T: s.from, r: 4, pid: D.polity, k: all.length });
  }
  const out = number();
  // 后妃的父亲、丈夫;太后是幼主的母亲
  for (const [m, b] of brideOfMatch) {
    const F = brideFatherOf(m);
    if (F) b.parent = F.id;
    b.husband = groomOf(m)!.id;
  }
  for (const [s, D] of dowagerOf) {
    const X = dowagerF.get(D) ?? D;
    if (X.id < 0) continue;
    // 嫁来的宗室女的丈夫上面按那门亲记了
    const H = husbandOf.get(s.N);
    if (H && !women.has(H) && X.husband === undefined) X.husband = H.id;
    s.N.mom = X.id;
  }
  // 联姻(marriages.ts):娶亲的人记上"配偶"(嫁来的宗室女是人物的记上她);她嫁过来以后生的儿子(生在她 16–45 岁之间)记上"母亲"
  const wed = new Set<Person>();
  for (const m of matches) {
    const groom = groomOf(m);
    if (!groom) continue;
    const father = brideFatherOf(m);
    const Q = polities[m.b];
    const name = father && father.author === undefined && Q && namerOf(styleOf(Q)).surnamed ? `${splitSurname(father.name)}氏` : '';
    const sp: PersonSpouse = { polity: m.b, father: father?.id ?? -1, name, year: m.t, annal: m.annal };
    if (m.war >= 0) sp.peace = m.war;
    const b = brideOfMatch.get(m);
    if (b) sp.person = b.id;
    (groom.spouses ??= []).push(sp);
    if (b) wed.add(groom);
  }
  for (const g of wed) {
    for (const s of sonsOf.get(g) ?? []) {
      if (s.p.mom !== undefined) continue;
      let mother: Person | undefined;
      for (const sp of g.spouses!) if (sp.year < s.p.born) mother = sp.person !== undefined ? out[sp.person] : undefined;
      if (mother && bears(mother.born, mother.died, s.p.born)) s.p.mom = mother.id;
    }
  }
  // 后妃到结束年份还在世的不写卒年
  for (const x of consortNames.keys()) {
    if (x.role !== 'consort') continue;
    if (x.died !== undefined && x.died > endYear) {
      delete x.died;
      delete x.fate;
    }
  }
  // 放逐到中立地、出奔中立地(那以前就死了的宗室不算);中立地撤销的年份。出奔邻国的:去了哪国、投奔它的缘由(没有中立地,zone = −1)
  for (const [i, { x, by }] of exiled) {
    const e = civ.annals[i];
    if ((x.died ?? Infinity) < e.year) continue;
    const how = e.cause === 'heir' ? 'heir' : e.cause === 'deposed' ? 'deposed' : 'fled';
    if (e.war < 0) {
      if (how === 'fled' && e.b >= 0) x.exile = { how, annal: i, zone: -1, region: e.region, year: e.year, to: e.b, tie: EXILE_TIES[e.n ?? -1] ?? 'near' };
      continue;
    }
    const end = civ.annals.find((a) => a.kind === 'neutral' && a.cause === 'lapse' && a.war === e.war);
    x.exile = { how, annal: i, zone: e.war, region: e.region, year: e.year, ...(by ? { by: by.id } : {}), ...(end ? { until: end.year } : {}) };
  }
  // 起女名(women.ts):换成女的人只换性别、名字、字,西幻同名女王另编序数;后妃一起按出道先后起
  nameWomen(out, wctx, new Set([...women, ...dowagerF.values()]), consortNames);
  // 自立为君的执政 / 将军:名字照做执政时的那一份(起女名、改撞名以后)
  for (const [K, C] of selfOf) K.name = C.name;
  return { people: out, ids, usurped: [...usurpers.values()] };
}

/** 掌实权的一段(人物这一层):regents.ts 的那一段、名义君主、实际从哪年到哪年、怎么了结的 */
interface Span {
  g: Regency;
  pid: number;
  N: Person;
  from: Year;
  until?: Year;
  end?: PersonRegency['end'];
  endAnnal?: number;
}

/**
 * 起名不重名(将领、名臣):按出道先后一个个起,只和"那时已经有的"人比 —— 出道以前即位的君主、先出道的将领和名臣,
 * 再加上他去职以前本国即位的君主;所以后来的历史变了(作者干预某一年),先前已经去职的人名字不变。
 * 先试 NAME_TRIES 次,找一个这些人都没用过的名字;西幻有的语感名字不多(几百个),用满了就再试一轮,
 * 只求和本国那些君主、前后 NAME_GAP 年里出生的同名人物都不撞
 */
class NameBook {
  private readonly used = new Map<string, number[]>();
  /** 君主按即位先后,起名到哪一年就收进哪一年以前即位的 */
  private readonly queue: Person[];
  private k = 0;
  constructor(private readonly rulers: readonly Person[][]) {
    this.queue = rulers.flat().sort((a, b) => a.from! - b.from! || a.polity - b.polity || a.born - b.born);
  }
  private use(name: string, born: number): void {
    const ys = this.used.get(name);
    if (ys) ys.push(born);
    else this.used.set(name, [born]);
  }
  /** T = 出道那年(按先后调);只看这以前的人,后来的历史变了,名字不变 */
  pick(nameAt: (a: number) => string, born: number, polity: number, T: number): string {
    for (; this.k < this.queue.length && this.queue[this.k].from! <= T; this.k++) this.use(this.queue[this.k].name, this.queue[this.k].born);
    const royal = (x: string) => (this.rulers[polity] ?? []).some((r) => r.from! <= T && r.name === x);
    const near = (x: string) => royal(x) || !!this.used.get(x)?.some((y) => Math.abs(y - born) < NAME_GAP);
    // 起名不便宜(西幻要音译):每个候选只算一次
    const cands: string[] = [];
    const at = (a: number) => (cands[a] ??= nameAt(a));
    let name = '';
    for (let a = 0; a < NAME_TRIES && !name; a++) if (!this.used.has(at(a)) && !royal(at(a))) name = at(a);
    for (let a = 0; a < NAME_TRIES && !name; a++) if (!near(at(a))) name = at(a);
    name ||= at(0);
    this.use(name, born);
    return name;
  }
}

/** 某一刻在位的君主(即位那一刻起算;到结束年份还在位的 until 不给) */
export function rulerAt(list: readonly Person[], t: Year): Person | undefined {
  for (let i = list.length - 1; i >= 0; i--) {
    const r = list[i];
    if (r.from! <= t) return r.until === undefined || t < r.until ? r : undefined;
  }
  return undefined;
}

/**
 * 国家 pid 的君主 father 嫁出去的女儿叫什么(和上面排人物时记"配偶"的一样;为他联姻的填写页先写给作者看):
 * 东方带姓的语感 = 他的姓 + 氏("风氏");别的语感、作者立的君主 = 空串
 */
export function brideNameOf(civ: Civ, pid: number, father: Person | undefined): string {
  const Q = civ.polities[pid];
  if (!Q || !father || father.author !== undefined) return '';
  return personNamers(civ.seed)(civ.cultures[Q.culture]?.style || 'kingdom').surnamed ? `${splitSurname(father.name)}氏` : '';
}

/**
 * 第 k 位君主(这一朝第 j 位)的名字:
 * - 东方中式:本朝的姓 + 名(同一朝里不重名);边塞、山海:名(同一国里不重名)
 * - 西幻:继位的君主有 REUSE 的机会沿用本朝用过的名字(上一位的除外;复国的第一位沿用故国末代王朝的名字);共和国执政官一律另起
 */
function rulerName(
  namer: ReturnType<ReturnType<typeof personNamers>>,
  tag: number,
  k: number,
  j: number,
  surname: string,
  used: Set<string>,
  pool: string[],
  R: (k: number, use: number) => number,
  republic: boolean,
  fallenPools: string[][] | undefined,
  prev: string | undefined,
): string {
  if (namer.family === 'western') {
    let name = '';
    const old = fallenPools?.[fallenPools.length - 1];
    if (j === 0 && old?.length) name = old[Math.floor(R(k, U_PICK) * old.length)];
    else if (!republic && j > 0 && R(k, U_REUSE) < REUSE) {
      // 不沿用上一位的名字(兄弟同名、父子接连同名读起来都别扭)
      const names = pool.filter((x) => x !== prev);
      if (names.length) name = names[Math.floor(R(k, U_PICK) * names.length)];
    }
    for (let a = 0; !name || (republic && used.has(name) && a < 12); a++) name = namer.given(tag, 0, k, a);
    if (!pool.includes(name)) pool.push(name);
    used.add(name);
    return name;
  }
  let given = '';
  for (let a = 0; !given || (used.has(given) && a < 24); a++) given = namer.given(tag, 0, k, a);
  used.add(given);
  return surname + given;
}

/** 定称号(去世以后才有;见文件头) */
function titleRulers(p: Polity, list: Person[], f: PolityFacts, base: number, tag: number): void {
  const T = (k: number, use: number) => keyed4(base, tag, k, use, K_RULER);
  // 作者立的君主没有称号(名字也是人物卡上的,不和别的君主编序数),别的君主照旧排
  if (!p.eastern) {
    // 西幻:同名的国王编序数(在位的也编);帝国里开疆最多的一位称大帝
    if (p.lineage === 'realm' || p.lineage === undefined) {
      const count = new Map<string, number>();
      // 男王、女王分开数(女名和男名偶尔撞上)
      const key = (r: Person) => (r.female ? `女:${r.name}` : r.name);
      for (const r of list) if (r.author === undefined) count.set(key(r), (count.get(key(r)) ?? 0) + 1);
      const seen = new Map<string, number>();
      for (const r of list) {
        if (r.author !== undefined) {
          r.title = '';
          continue;
        }
        const n = (seen.get(key(r)) ?? 0) + 1;
        seen.set(key(r), n);
        r.title = count.get(key(r))! > 1 ? `${ordinal(n)}世` : '';
      }
      let best: Person | undefined;
      let most = GREAT_GAINS - 1;
      for (const r of list) {
        if (r.author !== undefined || r.until === undefined || polityTierAt(p, r.until - 1 / TICK) < 3) continue;
        const g = deedsOf(f, r.from!, r.until).gains;
        if (g > most) {
          most = g;
          best = r;
        }
      }
      if (best) best.title = '大帝';
    } else for (const r of list) r.title = '';
    return;
  }
  // 东方:汗国没有庙号谥号
  if (p.lineage === 'khanate') {
    for (const r of list) r.title = '';
    return;
  }
  const used = new Map<number, Set<string>>();
  let prev: Person | undefined;
  let prevDeed: Deed | 'last' | '' = '';
  list.forEach((r, k) => {
    const dyn = r.dynasty ?? 0;
    let u = used.get(dyn);
    if (!u) used.set(dyn, (u = new Set()));
    if (prev && (prev.dynasty ?? 0) !== dyn) prevDeed = '';
    const until = r.until;
    if (r.author !== undefined) {
      // 作者立的君主:不定称号,也不占这一朝的庙号谥号(他是开国之君的话,继位的那位称"世祖")
      r.title = '';
      prev = r;
      prevDeed = '';
      return;
    }
    if (until === undefined) {
      r.title = '';
      prev = r;
      return;
    }
    const tier = polityTierAt(p, until - 1 / TICK);
    const d = deedsOf(f, r.from!, until);
    const ageAtEnd = (r.died ?? until) - r.born;
    let deed: Deed = 'plain';
    if (d.gains >= 5 && d.gains >= 2 * d.losses) deed = 'great';
    else if ((d.losses >= 4 && d.losses > d.gains) || d.capital) deed = 'bad';
    else if (ageAtEnd < 25) deed = 'young';
    else if (prevDeed === 'bad' && d.gains >= 2) deed = 'restore';
    else if (until - r.from! >= 35) deed = 'long';
    const lastOne = !!r.fate && ENDED.has(r.fate);
    // 这一朝的第一位(开国之君;这一朝中途才称帝的,第一位称帝驾崩的叫"世祖")
    const founder = !prev || (prev.dynasty ?? 0) !== dyn;
    let title = '';
    if (tier <= 0) title = '';
    else if (tier >= 3) {
      if (lastOne) {
        const pool = r.fate === 'deposed' ? ['废帝', ...LAST_EMPEROR] : ageAtEnd < 20 ? ['少帝', ...LAST_EMPEROR] : LAST_EMPEROR;
        title = pickUnused(pool, u, r.fate === 'deposed' || ageAtEnd < 20 ? 0 : T(k, U_TITLE));
      } else if (!u.has('太祖') && !u.has('世祖')) title = founder ? '太祖' : '世祖';
      else if (prev?.title === '太祖' && (prev.dynasty ?? 0) === dyn && !u.has('太宗') && deed !== 'young' && deed !== 'bad') title = '太宗';
      else title = pickUnused(TEMPLE[deed], u, T(k, U_TITLE)) || pickUnused(TEMPLE.plain, u, T(k, U_TITLE));
      if (!title) title = `${pickUnused(POSTHUMOUS.plain, u, T(k, U_TITLE)) || '后'}帝`;
    } else {
      const rank = tier >= 2 ? '王' : '公';
      const pool = lastOne ? POSTHUMOUS.bad : POSTHUMOUS[deed];
      const used2 = new Set([...u].filter((x) => x.endsWith(rank)).map((x) => x.slice(0, -1)));
      const s = pickUnused(pool, used2, T(k, U_TITLE)) || pickUnused(POSTHUMOUS.plain, used2, T(k, U_TITLE));
      title = s ? s + rank : '';
    }
    if (title) u.add(title);
    r.title = title;
    prev = r;
    prevDeed = lastOne ? 'last' : deed;
  });
}

/**
 * 一场战争:双方、起止、宣战那条史事的下标、要排统帅的每一仗(没打下来的战役、战役里打下来的州、据险断后;
 * 议和割让、亡国时残部归攻方的不算;史事下标)
 */
interface WarFacts {
  id: number;
  a: number;
  b: number;
  start: Year;
  end: Year;
  decl: number;
  events: number[];
  /** 议和那一条史事的下标(还在打的 = 史事条数 + 战争编号,排在最后) */
  endIdx: number;
}

/**
 * 作者强制宣战(干预 declare)打起来的战争(战争编号):史事 intervene 后面同一刻紧跟着的那场 war
 * (盟国、宗藩之间开战,中间先记了盟约断了 / 藩属自立)
 */
function forcedWars(annals: readonly Annal[], list: readonly Intervention[] | undefined): Set<number> {
  const out = new Set<number>();
  if (!list?.length) return out;
  annals.forEach((e, i) => {
    if (e.kind !== 'intervene' || e.a < 0 || e.b < 0 || list[e.war]?.kind !== 'declare') return;
    for (let j = i + 1; j < annals.length && annals[j].year === e.year; j++) {
      const w = annals[j];
      if (w.kind === 'war') {
        if (w.a === e.a && w.b === e.b && w.war >= 0) out.add(w.war);
        break;
      }
      if (w.kind !== 'unally' && w.kind !== 'defect') break;
    }
  });
  return out;
}

function warsOf(civ: PeopleInput): WarFacts[] {
  const A = civ.annals;
  const wars: WarFacts[] = [];
  const byId = new Map<number, WarFacts>();
  /** 不是打下来的攻占(割让、并掉残部) */
  const skip = new Set<number>();
  A.forEach((e, i) => {
    if (e.kind === 'peace' && e.region > 0) {
      for (let j = Math.max(0, i - e.region); j < i; j++) if (A[j].kind === 'conquer' && A[j].war === e.war) skip.add(j);
    } else if (e.kind === 'fall' && e.war >= 0) {
      for (const j of annexedRemnants(civ, i)) skip.add(j);
    }
  });
  A.forEach((e, i) => {
    if (e.kind === 'war' && e.war >= 0 && !byId.has(e.war)) {
      const w: WarFacts = { id: e.war, a: e.a, b: e.b, start: e.year, end: civ.endYear, decl: i, events: [], endIdx: A.length + e.war };
      byId.set(e.war, w);
      wars.push(w);
    } else if (e.war >= 0 && (e.kind === 'battle' || e.kind === 'stand' || (e.kind === 'conquer' && !skip.has(i)))) byId.get(e.war)?.events.push(i);
    else if (e.kind === 'peace' && e.war >= 0) {
      const w = byId.get(e.war);
      if (w) {
        w.end = e.year;
        w.endIdx = i;
      }
    }
  });
  return wars;
}

/** 掌权的一段是作者下令"让作者的人物掌权"来的(干预带 char):那一条干预;别的 = null */
function authorRegentOf(civ: PeopleInput, g: Regency): AuthorRegentIv | null {
  const v = g.iv !== undefined ? civ.interventions?.[g.iv] : undefined;
  return v?.kind === 'regent' && v.char !== undefined ? v : null;
}
