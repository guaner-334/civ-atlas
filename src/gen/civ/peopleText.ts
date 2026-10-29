/**
 * 人物的称呼(编年史、AI 材料共用):纯函数,只引 growth.ts / types.ts,不引起名器和推演代码。
 *
 * - 君主(带国名):东方 —— 帝国级 "大昌太宗"、王国 "昌庄王"、国 "昌穆公"、亡国之君 "大昌哀帝"、部落 "昌部首领李昭"、
 *   汗国 "乌耐汗国咄苾可汗";还在位的没有称号,写君号 + 名字:"大昌皇帝李昭""昌王李昭"。
 *   西幻 —— 国名词根 + 君号 + 名字(+ 序数 / 大帝):"索拉特国王阿尔德里克三世""索拉特皇帝阿尔德里克大帝""提布里亚执政官卡西乌斯"
 *   (汗国:汗 / 大汗;部落:酋长 / 首领)。
 * - 君主(不带国名,国名前文已经写了):rulerBare 带君号 —— 东方 "太宗""庄王""咄苾可汗""皇帝李昭",西幻 "国王阿尔德里克三世";
 *   rulerShort 不带君号 —— 东方 "太宗""李昭",西幻 "阿尔德里克三世"。
 * - 统帅:"大渭将李牧"(国名用当年的简称);领兵的宗室 "大渭皇子李昭"(princeRef)。名臣:"大景丞相"(ministerRole)。
 * 国名一律按年份现查(growth.ts),作者改了国名,称呼跟着变。君号、身份词、身后称号、亲属词分男女(Person.female),换哪个字见 gender.ts。
 * - 君主的倾向:名字和一句说明(LEANING_TEXT),复制生平的一行(leaningsText)
 */
import type { Civ, Person, PersonRegency, Polity, RulerLeanings, Year } from './types';
import { polityName, polityRootAt, polityShortTitle, polityTierAt, polityTitles } from './growth';
import { childWord, dowagerWord, eastRank, isFemale, khanWord, postTitle, princeWord, westRank } from './gender';

function polityOfPerson(civ: Civ, x: Person): Polity | null {
  return x.polity >= 0 && x.polity < civ.polities.length ? civ.polities[x.polity] : null;
}

/** 宗室那一刻是哪国的人:据地自立的宗室(新国家的开国之君)在立国以前还是父亲那国的 */
function princePolityAt(civ: Civ, x: Person, year: Year): Polity | null {
  const p = polityOfPerson(civ, x);
  if (!p || year >= p.founded || x.parent === undefined) return p;
  const f = civ.people?.[x.parent];
  return (f && polityOfPerson(civ, f)) ?? p;
}

const clampTier = (t: number) => Math.min(3, Math.max(0, t));

/** 东方单字国名去掉"大":"大昌" → "昌"(王、公、帝的称号前用) */
function core(root: string): string {
  const cs = [...root];
  return cs.length === 2 && cs[0] === '大' ? cs[1] : root;
}

/** 君主在位时的国号档位(按 year;year 不在在位期间就夹到在位期间里) */
function tierFor(p: Polity, x: Person, year: Year): number {
  const from = x.from ?? p.founded;
  const until = x.until ?? Infinity;
  const y = Math.min(Math.max(year, from), until - 1 / 512);
  return clampTier(polityTierAt(p, y));
}

/**
 * 君主的称呼,不带国名(国名前文已经写了):东方有称号的写称号("太宗""庄王""哀帝"),没有的写名字;
 * 西幻 名字 + 序数("阿尔德里克三世""阿尔德里克大帝")
 */
export function rulerShort(civ: Civ, x: Person): string {
  const p = polityOfPerson(civ, x);
  if (p?.eastern) return rulerTitle(civ, x) || x.name;
  return `${x.name}${rulerTitle(civ, x)}`;
}

/** 君主的称号按性别的写法(Person.title 记的是男的写法;女君王国"庄女王"、国"穆君",见 gender.ts);没有称号 = 空串 */
export function rulerTitle(civ: Civ, x: Person): string {
  return postTitle(x, !!polityOfPerson(civ, x)?.eastern, x.title ?? '');
}

/** 君主的称呼,带国名(year = 写到的那一刻,决定国号和还在位时的君号) */
export function rulerRef(civ: Civ, x: Person, year: Year): string {
  return refOf(civ, x, year, true);
}

/**
 * 君主的称呼,不带国名、带君号(国名前文已经写了):东方有称号的写称号("哀帝""庄王"),没有的写君号 + 名字
 * ("咄苾可汗""首领李昭""皇帝李昭""昌王李昭");西幻 "国王阿尔德里克三世"
 */
export function rulerBare(civ: Civ, x: Person, year: Year): string {
  return refOf(civ, x, year, false);
}

function refOf(civ: Civ, x: Person, year: Year, realm: boolean): string {
  const p = polityOfPerson(civ, x);
  if (!p) return x.name;
  const tier = tierFor(p, x, year);
  const at = Math.min(Math.max(year, x.from ?? p.founded), (x.until ?? Infinity) - 1 / 512);
  const title = rulerTitle(civ, x);
  if (p.eastern) {
    const tribe = realm ? polityTitles(p, at)[0] : '';
    if (p.lineage === 'khanate') return tier <= 0 ? `${tribe}首领${x.name}` : `${realm ? polityName(p, at) : ''}${x.name}${khanWord(x)}`;
    if (tier <= 0) return `${tribe}首领${x.name}`;
    const root = polityRootAt(p, at);
    if (title) return !realm ? title : tier >= 3 ? `${polityShortTitle(p, 3, at)}${title}` : `${core(root)}${title}`;
    if (tier >= 3) return `${realm ? polityShortTitle(p, 3, at) : ''}${eastRank(x, 3)}${x.name}`;
    return `${core(root)}${eastRank(x, tier)}${x.name}`;
  }
  return `${realm ? polityRootAt(p, at) : ''}${westRank(x, p.lineage, tier)}${x.name}${title}`;
}

/** 这一刻领兵的是不是在位的君主本人(即位以前就领兵的不算亲征) */
export function reigningAt(x: Person, year: Year): boolean {
  return x.role === 'ruler' && (x.from ?? Infinity) <= year;
}

/**
 * 宗室(没即位的,或即位以前的君主)那一刻的身份词:父亲正在位 —— 东方帝国"皇子"、王国"王子"、国和部落"公子",汗国、西幻"王子"
 * (女:公主,国和部落公女);父亲不在位(先君的儿子、君主的兄弟)= "宗室"
 */
export function princeTitle(civ: Civ, x: Person, year: Year): string {
  const p = princePolityAt(civ, x, year);
  const f = x.parent !== undefined ? civ.people?.[x.parent] : undefined;
  if (!p || !f || f.role !== 'ruler' || (f.from ?? Infinity) > year || (f.until !== undefined && f.until <= year)) return '宗室';
  if (!p.eastern || p.lineage === 'khanate') return princeWord(x, '王子');
  const tier = clampTier(polityTierAt(p, year));
  return princeWord(x, tier >= 3 ? '皇子' : tier === 2 ? '王子' : '公子');
}

/** 宗室的称呼:"大渭皇子李昭""索拉特王子阿尔德里克" */
export function princeRef(civ: Civ, x: Person, year: Year): string {
  const p = princePolityAt(civ, x, year);
  if (!p) return x.name;
  return `${polityShortTitle(p, clampTier(polityTierAt(p, year)), year)}${princeTitle(civ, x, year)}${x.name}`;
}

/** 统帅不带国名:将领写名字,宗室 "皇子李昭"(君主亲征的用 rulerBare) */
export function leaderName(civ: Civ, x: Person, year: Year): string {
  if (x.role === 'general') return x.name;
  if (reigningAt(x, year)) return rulerBare(civ, x, year);
  return `${princeTitle(civ, x, year)}${x.name}`;
}

/** 统帅的称呼:"大渭将李牧";君主亲征的用 rulerRef,宗室领兵的用 princeRef */
export function generalRef(civ: Civ, x: Person, year: Year): string {
  if (reigningAt(x, year)) return rulerRef(civ, x, year);
  if (x.role === 'ruler' || x.role === 'prince') return princeRef(civ, x, year);
  const p = polityOfPerson(civ, x);
  if (!p) return x.name;
  const tier = clampTier(polityTierAt(p, year));
  return `${polityShortTitle(p, tier, year)}将${x.name}`;
}

/** 某年的岁数(取整) */
export function ageAt(x: Person, year: Year): number {
  return Math.floor(year - x.born);
}

// ---------------------------------------------------------------------------
// 人物卡片、人物页用的写法

/** 人物页、人物卡片上的名字:东方有称号的 称号 + 名字("圣宗柳玄"),没有的写名字;西幻 "阿尔德里克三世";统帅 = 名字 */
export function personName(civ: Civ, x: Person): string {
  if (x.role !== 'ruler') return x.name;
  const p = polityOfPerson(civ, x);
  if (p?.eastern) return x.title ? `${rulerTitle(civ, x)}${x.name}` : x.name;
  return rulerShort(civ, x);
}

/** 君主在位的最后那一刻(还在位 = 结束年份;身份、国号都按它) */
function lastReignYear(civ: Civ, x: Person): Year {
  const end = x.until ?? civ.endYear;
  return Math.max(x.from ?? 0, end - 1 / 512);
}

/**
 * 君主的身份(卡片上名字下面那行的开头):国名 + 君号,按在位最后那年 ——
 * 东方 "大景皇帝""昌王""昌公""昌部首领""乌耐汗国可汗";西幻 "索拉特国王""提布里亚执政官"
 */
export function rulerRole(civ: Civ, x: Person): string {
  const p = polityOfPerson(civ, x);
  if (!p) return '';
  const at = lastReignYear(civ, x);
  const tier = tierFor(p, x, at);
  if (p.eastern) {
    if (p.lineage === 'khanate') return tier <= 0 ? `${polityTitles(p, at)[0]}首领` : `${polityName(p, at)}${khanWord(x)}`;
    if (tier <= 0) return `${polityTitles(p, at)[0]}首领`;
    if (tier >= 3) return `${polityShortTitle(p, 3, at)}${eastRank(x, 3)}`;
    return `${core(polityRootAt(p, at))}${eastRank(x, tier)}`;
  }
  return `${polityRootAt(p, at)}${westRank(x, p.lineage, tier)}`;
}

/** 名臣的身份:"大景丞相""兹拉季纳首相"(国名按做到最高那个官那年的简称) */
export function ministerRole(civ: Civ, x: Person): string {
  const ps = x.posts ?? [];
  const top = ps[ps.length - 1];
  const p = polityOfPerson(civ, x);
  if (!p) return top?.title ?? '大臣';
  const y = top?.from ?? x.from ?? x.born;
  return `${polityShortTitle(p, clampTier(polityTierAt(p, y)), y)}${top?.title ?? '大臣'}`;
}

/** 统帅的身份:"大景将领"(国名按第一次领兵那年的简称) */
export function generalRole(civ: Civ, x: Person): string {
  const p = polityOfPerson(civ, x);
  if (!p) return '将领';
  const y = x.commands?.[0]?.from ?? x.born;
  return `${polityShortTitle(p, clampTier(polityTierAt(p, y)), y)}将领`;
}

/**
 * 没即位的宗室的身份:"大景宗室"(国名按卒年的简称;死在他那一朝开国之前的(开国之君的父亲)按开国那年,
 * 免得起兵代衍朝的太祖的父亲写成"大衍宗室")
 */
export function princeRole(civ: Civ, x: Person): string {
  const p = polityOfPerson(civ, x);
  if (!p) return '宗室';
  const start = x.dynasty ? (p.dynasties?.[x.dynasty]?.year ?? p.founded) : p.founded;
  const y = Math.max(start, Math.min(x.died ?? x.born, p.ended ?? civ.endYear) - 1 / 512);
  return `${polityShortTitle(p, clampTier(polityTierAt(p, y)), y)}宗室`;
}

/** 太后临朝的那几段(Person.regencies 里 kind = dowager;临朝篡位做了女君的也有);不是太后 = [] */
export function dowagerSpans(x: Person): PersonRegency[] {
  return (x.regencies ?? []).filter((g) => g.kind === 'dowager');
}

/** 这个人"那一国":临朝的太后 = 她临朝的那一国(嫁来的宗室女做了太后的,不是她娘家);别的 = Person.polity */
export function seatPolity(civ: Civ, x: Person): number {
  const g = x.role === 'consort' ? dowagerSpans(x)[0] : undefined;
  const N = g ? civ.people?.[g.ruler] : undefined;
  return N ? N.polity : x.polity;
}

/** 她临朝的那一国(幼主那一国;嫁来的宗室女做了太后的,不是她娘家) */
function dowagerPolity(civ: Civ, x: Person): Polity | null {
  const g = dowagerSpans(x)[0];
  const N = g ? civ.people?.[g.ruler] : undefined;
  return (N && polityOfPerson(civ, N)) ?? polityOfPerson(civ, x);
}

/** 太后的称呼(不带国名、不带名字):东方帝国、国"太后",王国"王太后",汗国"可敦";西幻帝国"皇太后"、别的"王太后"(按 year 那年的国号) */
export function dowagerWordOf(civ: Civ, x: Person, year: Year): string {
  const p = dowagerPolity(civ, x);
  return dowagerWord(p, p ? clampTier(polityTierAt(p, year)) : 0);
}

/** 太后的身份(卡片上名字下面那行的开头,按她临朝那年):"大衍太后""卢纳维亚皇太后" */
export function dowagerRole(civ: Civ, x: Person): string {
  const p = dowagerPolity(civ, x);
  const y = dowagerSpans(x)[0]?.from ?? x.born;
  if (!p) return '太后';
  const tier = clampTier(polityTierAt(p, y));
  return `${p.eastern ? polityShortTitle(p, tier, y) : polityRootAt(p, y)}${dowagerWord(p, tier)}`;
}

/**
 * 后妃的身份:太后见 dowagerRole;嫁来的宗室女按娘家结亲那年的国号 —— "大澜公主"(国、部落"公女";西幻、汗国"公主")。
 * year = 她结亲那年(不给 = 生年)
 */
export function consortRole(civ: Civ, x: Person, year?: Year): string {
  if (dowagerSpans(x).length) return dowagerRole(civ, x);
  const p = polityOfPerson(civ, x);
  const y = year ?? x.born;
  if (!p) return '公主';
  const tier = clampTier(polityTierAt(p, Math.max(p.founded, y)));
  if (!p.eastern || p.lineage === 'khanate') return `${polityRootAt(p, y)}${princeWord(x, '王子')}`;
  return `${polityShortTitle(p, tier, y)}${princeWord(x, tier >= 3 ? '皇子' : tier === 2 ? '王子' : '公子')}`;
}

/** 一个人简短的身份:"大景将领""大景君主""大景宗室""大景丞相"(共和国:"某某执政";国名按他上台那年的简称)。作者的人物勾选推演里的人时用 */
export function personRoleShort(civ: Civ, x: Person): string {
  if (x.role === 'consort') return consortRole(civ, x);
  if (x.role === 'prince') return princeRole(civ, x);
  if (x.role === 'minister') return ministerRole(civ, x);
  if (x.role !== 'ruler') return generalRole(civ, x);
  const p = polityOfPerson(civ, x);
  if (!p) return '君主';
  const y = x.from ?? x.born;
  return `${polityShortTitle(p, tierFor(p, x, y), y)}${p.lineage === 'republic' ? '执政' : '君主'}`;
}

/** 共和国的执政官(写"执政""在任""任满",不写"君主""在位") */
export function isConsul(civ: Civ, x: Person): boolean {
  return x.role === 'ruler' && polityOfPerson(civ, x)?.lineage === 'republic';
}

/** 往上数几代的祖先(0 = 自己);没记父亲的到此为止 */
function ancestors(civ: Civ, x: Person, max: number): Person[] {
  const out = [x];
  for (let p = x; out.length <= max && p.parent !== undefined; ) {
    const f = civ.people?.[p.parent];
    if (!f) break;
    out.push(f);
    p = f;
  }
  return out;
}

/**
 * b 是 a 的什么人,按世系(Person.parent,lineage.ts)说:子、养子、孙、父、养父、兄、弟、侄、伯父、叔父、从兄、从弟……;
 * 往上三代都找不到同一位祖先 = 空串(同一朝的宗室远支,或者根本不是一家)。
 * 编年史的"其子 / 其侄"(kinOf(先君, 新君))、人物页的"继叔父某某即位"(kinOf(新君, 先君))、人物卡片前任继任后面的小字都用它。
 * b 是女的(Person.female)换成女的说法:女、孙女、母、祖母、姐、妹、侄女、姑母、从姐……;
 * a、b 之间隔着一位女性(两头和同一位祖先不算):外孙、外祖父、外甥、舅父 / 姨母、表兄 / 表妹、舅祖 / 姨祖母……
 */
export function kinOf(civ: Civ, a: Person, b: Person): string {
  // 母亲不在世系里(世系只按父亲连):b 是 a 的母亲 / a 是 b 的母亲(联姻嫁来的宗室女、临朝的太后,Person.mom)
  if (a.mom !== undefined && a.mom === b.id) return '母';
  if (b.mom !== undefined && b.mom === a.id) return childWord(b);
  const up = 3;
  const as = ancestors(civ, a, up);
  const bs = ancestors(civ, b, up);
  for (let n = 1; n <= up * 2; n++) {
    for (let i = Math.max(0, n - up); i <= Math.min(up, n); i++) {
      const j = n - i;
      if (as[i] === undefined || bs[j] === undefined || as[i] !== bs[j]) continue;
      // a 往上 i 代、b 往上 j 代是同一位
      const elder = b.born < a.born;
      const f = isFemale(b);
      const via = as.slice(1, i).some(isFemale) || bs.slice(1, j).some(isFemale);
      const sex = (m: string, w: string) => (f ? w : m);
      // 收养的(Person.adopted)只在父子这一层写明:养子、养父
      if (i === 0) {
        if (j === 1) return b.adopted ? sex('养子', '养女') : sex('子', '女');
        return `${via ? '外' : ''}${['', '', '孙', '曾孙'][j]}${f ? '女' : ''}`;
      }
      if (j === 0) {
        if (i === 1) return a.adopted ? sex('养父', '养母') : sex('父', '母');
        return `${via ? '外' : ''}${['', '', '祖', '曾祖'][i]}${sex('父', '母')}`;
      }
      if (i === 1 && j === 1) return elder ? sex('兄', '姐') : sex('弟', '妹');
      if (i === 1 && j === 2) return via ? sex('外甥', '外甥女') : sex('侄', '侄女');
      if (i === 1 && j === 3) return via ? sex('外甥孙', '外甥孙女') : sex('侄孙', '侄孙女');
      if (i === 2 && j === 1) return via ? sex('舅父', '姨母') : f ? '姑母' : b.born < as[1].born ? '伯父' : '叔父';
      if (i === 2 && j === 2) return `${via ? '表' : '从'}${elder ? sex('兄', '姐') : sex('弟', '妹')}`;
      if (i === 2 && j === 3) return `${via ? '表' : '从'}${sex('侄', '侄女')}`;
      if (i === 3 && j === 1) return via ? sex('舅祖', '姨祖母') : f ? '姑祖母' : b.born < as[2].born ? '伯祖' : '叔祖';
      if (i === 3 && j === 2) return `${via ? '表' : '从'}${f ? '姑母' : b.born < as[1].born ? '伯父' : '叔父'}`;
      return elder ? sex('族兄', '族姐') : sex('族弟', '族妹');
    }
  }
  return '';
}

/** 君主的结局(卡片、人物页):"驾崩""遇弑""被废""殉国"……;还在位 = 空串 */
export function rulerFateWord(civ: Civ, x: Person): string {
  const p = polityOfPerson(civ, x);
  if (!p || !x.fate) return '';
  const tier = tierFor(p, x, lastReignYear(civ, x));
  switch (x.fate) {
    case 'died':
      if (!p.eastern) return tier >= 1 ? '驾崩' : '去世';
      return p.lineage === 'khanate' || tier <= 0 ? '去世' : tier >= 3 ? '驾崩' : '薨';
    case 'murdered':
      return p.eastern ? '遇弑' : '遇刺身亡';
    case 'deposed':
      return '被废';
    case 'overthrown':
      return '死于兵乱';
    case 'fell':
      return '亡国殉国';
    case 'surrendered':
      return '亡国出降';
    case 'fled':
      return '亡国出奔';
    case 'merged':
      return '国并入他国';
    case 'retired':
      // 作者立的君主到期下台(生死归人物卡管)
      return x.author !== undefined && p.lineage !== 'republic' ? '退位' : '任满';
    case 'battle':
      return '战死';
    case 'yielded':
      return '让位';
    case 'purged':
      return '争储被杀';
  }
}

/**
 * 君主倾向的名字和说明,按人物卡片上的先后(键同 RulerLeanings;各项在推演里管什么见 rulers.ts)。
 * 发展、重商重视贸易的一面推演里还没有用上,说明照样写
 */
export const LEANING_TEXT: Record<keyof RulerLeanings, { name: string; note: string }> = {
  expand: { name: '开拓', note: '更愿意开垦偏远贫瘠的土地' },
  war: { name: '好战', note: '更容易发动战争且更难停止' },
  develop: { name: '发展', note: '更重视领地内的建设' },
  trade: { name: '重商', note: '偏向沿海、大河和港口，重视贸易' },
};
export const LEANING_KEYS = Object.keys(LEANING_TEXT) as (keyof RulerLeanings)[];

/** "开拓 47，好战 69，发展 63，重商 64"(复制生平) */
export function leaningsText(l: RulerLeanings): string {
  return LEANING_KEYS.map((k) => `${LEANING_TEXT[k].name} ${l[k]}`).join('，');
}

/** 东方中式的全名拆出姓(复姓两个字) */
export function splitSurname(full: string): string {
  const two = full.slice(0, 2);
  return COMPOUND.has(two) && full.length > 2 ? two : full.slice(0, 1);
}
const COMPOUND = new Set(['司马', '欧阳', '上官', '慕容', '宇文', '长孙', '独孤', '皇甫', '令狐', '尉迟', '南宫', '司空', '东方', '端木', '百里']);

/** 改过的倾向:"开拓 53→78、好战 50→20"(只写变了的;不知道原来的 = "开拓 78、好战 20";都没变 = 空串) */
export function leaningsChange(from: RulerLeanings | undefined, to: RulerLeanings): string {
  return LEANING_KEYS.filter((k) => !from || from[k] !== to[k])
    .map((k) => `${LEANING_TEXT[k].name} ${from ? `${from[k]}→` : ''}${to[k]}`)
    .join('、');
}
