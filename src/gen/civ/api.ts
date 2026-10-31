/**
 * 推演的子系统之间的具名接口:一个子系统提供,别的子系统取用,按名字分组(war = 战争那一组:别的子系统挂给战争的攻城、立约、
 * 钱粮、动荡……,和战争提供给别人的宣战、议和、多看一眼)。
 * 接口放在引擎的 CivSim.api 上(引擎不认识内容),每次推演一份;后提供的顶替先提供的,要接着调先前那个的自己先取出来:
 *   const prev = civApi(sim).war.onFall;  civApi(sim).war.onFall = (w, x, y, t) => { prev?.(w, x, y, t); … }
 * 都是可选的:没有子系统提供 = undefined,取用的一方照没有处理(和原来一样)。
 */
import type { CivSim } from './engine/sim';
import type { Annal, AnnalCause, Polity, Year } from './types';
import type { Reign } from './rulers';
import type { War } from './wars';

/** 战争那一组 */
export interface WarApi {
  /**
   * 阶段 3 城市兴衰(cities.ts 提供):战役里攻下一州(攻方打下来、守方反攻夺回;议和割让、亡国时残部归攻方的不算)、
   * 州里有城时调用 —— 城可能被洗劫、被毁。在记这条攻占之前调(洗劫 / 毁城记在攻占前面),sid = 州里的城,
   * capital = 打下的是守方的国都
   */
  onAssault?: (w: War, x: number, y: number, r: number, sid: number, t: number, capital: boolean) => void;
  /**
   * x 向 y 宣战(installWars 填;看邻国、干预的强制宣战、援盟、救藩、讨伐叛藩共用):记 war、预约第一仗;y 的盟国可能援盟。
   * ally = 援的是哪国(援盟、救藩宣战时给,不再连锁);cause = 为什么打(史事 war 的 cause;干预的强制宣战不给)
   */
  declare?: (x: number, y: number, t: Year, ally?: number, cause?: AnnalCause) => War;
  /**
   * 立约(treaties.ts 提供):p 看邻国时和 q 有没有约:−1 = 没有;0 = 约期内,不打;大于 0 = 可以背约去打,宣战赔率乘这个数
   * (背约先记 breach:宣战时 DiplomacyModel.sever 那一步记)
   */
  treaty?: (p: number, q: number, t: Year, pow: Float64Array) => number;
  /** 立约(treaties.ts 提供):厌战、僵持罢兵(攻方没达成目标)、议和之后:两国可能顺带立约、划缓冲中立地 */
  onTruce?: (w: War, t: Year) => void;
  /** 立约(treaties.ts 提供):y 亡于 x(记了 fall、它的仗都议和了)之后:亡国之君出奔中立地 */
  onFall?: (w: War, x: number, y: number, t: Year) => void;
  /** 邦交(diplomacy.ts 提供):x 向 y 宣战(不是援盟)之后,y 的盟国援盟 / 坐视不救,y 的宗主来救 */
  onDeclare?: (w: War, x: number, y: number, t: Year) => void;
  /** 邦交(diplomacy.ts 提供):第 i 仗之后守方奉表称臣、攻方受降罢兵(已经议和 = true;capitalFell = 这一仗攻方打下了守方的国都) */
  sue?: (w: War, i: number, t: Year, pow: Float64Array, capitalFell: boolean) => boolean;
  /** 议和(installWars 填;干预的结盟用:结盟那一刻正在交战的两国当即议和) */
  makePeace?: (w: War, t: Year) => void;
  /** 照大纲顺着引时替国家 p 多看一眼邻国(installWars 填;k ≥ LOOK_K,随机数按它取,不接着预约) */
  look?: (p: number, k: number, t: Year) => void;
  /** 动荡(unrest.ts 提供):国内越乱越想对外开战转移矛盾,邻国也越想趁虚而入 */
  unrest?: (p: number, t: Year) => number;
  /** 士气(unrest.ts 提供):战争 w 里 x 一方的国力倍数(讨伐民变:起事的饥民初起时声势大,朝廷一方人心不附) */
  morale?: (w: War, x: number, t: Year) => number;
  /**
   * 讨伐民变的战争(unrest.ts 提供):朝廷一方刚丢的州也能马上去打(不等 HOLD 年),起事的一方反攻不限于夺回失地(往都城打)
   */
  revolt?: (w: War) => boolean;
  /** 民变(unrest.ts 提供):战争 w 里 x 打下了 y 的国都,y 就此亡国、余下的州一并归 x(起事的饥民攻破都城) */
  overthrow?: (w: War, x: number, y: number, t: Year) => boolean;
  /**
   * 大迁徙(migration.ts 提供):战争 w 里 x 打下了 y 的国都 r(y 还有别的州,没被 overthrow 整个吞掉):返回 true = 已经办完
   * (迁来的一支打进大国国都:占着国都一带,那国迁都、议和、大崩解),不再照常迁都 / 并掉残部
   */
  storm?: (w: War, x: number, y: number, r: number, t: Year) => boolean;
  /**
   * 中央管到什么程度(control.ts 提供):国家 p 此刻各州出兵的几成(0–1;割据的州 0)。返回的函数要马上用完(下一次调 levy 前)
   */
  levy?: (p: number, t: Year) => (r: number) => number;
  /**
   * 国力的数表(control.ts 提供;stateTables.ts):国家 p 最近一步算的国力(城的人口 × 出兵的几成 × 军力系数 × 方针给的倍数)。
   * 那一步还没有这国(这一年里才立国)、还没算过 = −1,照下面 powers 现算
   */
  power?: (p: number) => number;
  /** 钱粮(control.ts 提供):国家 p 此刻国用不足到什么程度(0–1):宣战少、打着的仗早罢 */
  broke?: (p: number, t: Year) => number;
  /** 钱粮(control.ts 提供):国家 p 的国库攒到几成(0–1;满 = 攒够了几年的用度) */
  purse?: (p: number, t: Year) => number;
  /** 钱粮(control.ts 提供):州 r 的收入(田赋、工商、市税之和)是国家 p 每州平均的几倍(p 还没算过账 = 0):为掠夺而战挑富州 */
  rich?: (p: number, r: number) => number;
  /** 割据(control.ts 提供):国家 p 此刻有几处割据、最早起的那处在哪州(没有 = n 为 0):邻国趁虚而入 */
  lords?: (p: number, t: Year) => { n: number; region: number };
  /** 疫后凋敝(unrest.ts 提供):国家 p 近年染疫的州占国土几成(全球大疫凋敝还没过的州算进去;0–1):邻国趁虚而入 */
  blight?: (p: number, t: Year) => number;
  /** 中央管到什么程度(control.ts 提供):战争 w 的第一仗之前(点兵),割据的地方抗命不出兵时记一条 defy */
  onMuster?: (w: War, t: Year) => void;
  /** 物产(development.ts 提供):州 r 有的物产(按位;地里有、没采空吃空的) */
  resOf?: (r: number) => number;
  /** 物产(development.ts 提供):国家 p 此刻缺、又想要的物产(按位);门槛要的那样(快进下一个时代却没有)单独给 gate */
  wantOf?: (p: number) => { want: number; gate: number };
  /** 掌实权(regency.ts 提供):战争 w 里 x 一方的国力倍数(引兵入朝那一刻正在打的仗,粮饷为掌权的人所制,几年里淡回) */
  supply?: (w: War, x: number, t: Year) => number;
  /**
   * 作者的将领(干预任将带能力,interventions.ts 提供;没有带能力的任将 = 不给):战争 w 里 x 一方此刻由良将 / 名将挂帅时的兵力倍数,
   * 别的 = 1。只管打仗的胜率(chance),看邻国、议和不管
   */
  led?: (w: War, x: number, t: Year) => number;
  /** 联姻(marriage.ts 提供):p 看要不要打 q 时宣战赔率的倍数(两国结着亲、在位的君主母亲出自 q);没有 = 1 */
  kin?: (p: number, q: number, t: Year) => number;
  /** 联姻(marriage.ts 提供):背盟去打盟国 q 时赔率再乘的(两国结着亲);没有 = 1 */
  kinBetray?: (p: number, q: number, t: Year) => number;
  /** 联姻(marriage.ts 提供):战争 w 打到厌战、达成目标,两国议和之后(以和亲作结) */
  onPeace?: (w: War, t: Year) => void;
}

/** polity那一组(原来挂在 PolityModel 上) */
export interface PolityApi {
  /**
   * 新君即位那一刻(Ev.Reign;k = 他在在位表 list 里第几位,k ≥ 1)、处理完扩张以后调(unrest.ts 提供:先君的儿子据地争位)
   */
  onReign?: (pid: number, k: number, list: readonly Reign[], t: Year) => void;
  /**
   * 新君即位那一刻、onReign(宗室争位、放逐失势的宗室)之后调,不管那边有没有截住(regency.ts 提供:
   * 预约他晚年的引兵入朝、太子监国;继位的幼主当即定摄政 / 辅政)
   */
  afterReign?: (pid: number, k: number, list: readonly Reign[], t: Year) => void;
  /**
   * 立约与中立地(treaties.ts 提供):无主的州 r 此刻进不去 —— 是中立地(谁都不扩张进去、不在那里立国;pid = −1 = 立国),
   * 或者 pid 和邻国立了"有限竞争"之约,r 挨着约国的国土(各守今疆)
   */
  closed?: (r: number, pid: number, t: Year) => boolean;
}

/** politics那一组(原来挂在 PoliticsModel 上) */
export interface PoliticsApi {
  /**
   * 国家此刻的危机(hook 里填):国土太大、刚丢了国都 / 迁了都、正在打仗、这些年接连丢州。
   * 动荡(control.ts 的数表,规则见 stateTables.ts)在它上面再加边远、异族、王朝老了、饥荒、民变、割据
   */
  strain?: (P: Polity, t: Year) => number;
  /** 动荡(control.ts 提供,读每年年初算的数表;没挂 = 只看危机):分裂的"动荡"那一项用它 */
  unrest?: (P: Polity, t: Year) => number;
  /** 这一年里又有 n 州闹了饥荒,动荡再加多少(control.ts 提供;表里下一年才算进去,民变当时就要算上) */
  famineBump?: (P: Polity, n: number) => number;
  /** 看内政时最先看的大崩解(unrest.ts 提供):崩了 = true,这一次看内政就到此为止 */
  crisis?: (P: Polity, k: number, t: Year) => boolean;
  /**
   * 迁来的一支打进大国国都时当即大崩解(unrest.ts 提供;migration.ts 用):不看国土、立国年数、动荡,崩法照常挑。
   * k = 取随机数用的"第几次"(和看内政的错开);禁止分裂的干预护着、散不成几块 = false
   */
  shatter?: (P: Polity, k: number, t: Year) => boolean;
  /** 照大纲顺着引时替国家 p 多看一眼内政(installPolitics 填):只看大崩解、分裂(k ≥ LOOK_K,随机数按它取,不接着预约) */
  look?: (p: number, k: number, t: Year) => void;
  /**
   * 州组从 parent 分出去,立新国(国都 sid,起事的州 rising;hook 里填):记一条 kind(split / revolt;split 带 cause),
   * 新国都是某个同族亡国的故都时算复国(宗室据地争位 cause = heir 的不算)。州组不用连着国都以外的碎块(要的先用 cutOff 补上);
   * extra = 新国家另带的字段(不是复国时;如宗室争位的 Polity.prince)
   */
  secede?: (parent: number, group: number[], sid: number, rising: number, t: Year, kind: 'split' | 'revolt', cause?: AnnalCause, extra?: Partial<Polity>) => Polity;
  /** 州组(升序)从 pid 分出去以后,pid 和国都断开的碎块也并进来(hook 里填;碎块太大、有刚换过国家的州 = null) */
  cutOff?: (pid: number, group: number[], t: Year, cap: number) => number[] | null;
  /** 州组里人口最多的城(hook 里填;没有城 = −1) */
  biggestCity?: (group: readonly number[], t: Year) => number;
  /** 看内政时分裂没成之后:收回割据、新起割据(control.ts 提供);出了一件事 = true */
  lordCheck?: (P: Polity, k: number, t: Year) => boolean;
  /** 看内政最后(分裂、割据、合并、迁都都没出事):议一件事(council.ts 提供) */
  councilCheck?: (P: Polity, k: number, t: Year) => void;
}

/** diplomacy那一组(原来挂在 DiplomacyModel 上) */
export interface DiplomacyApi {
  /** 记一条邦交的史事并更新模型(installDiplomacy 提供;wars.ts 背盟时用) */
  note?: (kind: Annal['kind'], f: Partial<Omit<Annal, 'year' | 'kind'>>) => void;
  /**
   * x 向 y 宣战、记 war 之前(installDiplomacy 提供;wars.ts 的 declare 调,war = 这场战争的编号):
   * 两国结着盟、有宗藩之分的,就此断了;同是一国的藩属的,攻方先自立。
   * 自然开战都先避开了这些(背盟先记了 unally),只有作者下令的宣战会走到这里
   */
  sever?: (x: number, y: number, t: Year, war: number) => void;
  /** 接壤的在世邻国(installDiplomacy 提供;联姻挑亲家用) */
  neighborsOf?: (p: number) => number[];
  /** 看邦交时(第 k 次)先看要不要和别国结亲(marriage.ts 提供) */
  marry?: (p: number, k: number, t: Year) => void;
  /** 两国结着亲的分量(marriage.ts 提供;0 = 没有 / 断了,1 = 刚结亲,KIN_FADE 年里淡到 0):挑盟友、援盟照它加 */
  bond?: (p: number, q: number, t: Year) => number;
  /** 立约(treaties.ts 提供):两国此刻在同一份约里(约期内互不宣战,和结盟一样算友好) */
  bound?: (p: number, q: number) => boolean;
  /** 立约(treaties.ts 提供):q 和 L 立了有限竞争之约,不收 L 的藩属(刚脱离 L 的国家来称臣也不收) */
  limits?: (q: number, L: number) => boolean;
  /** 立约(treaties.ts 提供):看邦交时称臣、结盟都没成,接着看要不要和邻国立约(threat = 最怕的强邻,−1 = 没有) */
  onCheck?: (p: number, k: number, t: Year, threat: number) => void;
}

/** 一次推演的全部具名接口,按组 */
export interface CivApi {
  diplomacy: DiplomacyApi;
  politics: PoliticsApi;
  polity: PolityApi;
  war: WarApi;
}

/** 这次推演的具名接口(第一次取时建好各组的空表) */
export function civApi(sim: CivSim): CivApi {
  const a = sim.api as Partial<CivApi>;
  if (!a.war) a.war = {};
  if (!a.diplomacy) a.diplomacy = {};
  if (!a.politics) a.politics = {};
  if (!a.polity) a.polity = {};
  return a as CivApi;
}
