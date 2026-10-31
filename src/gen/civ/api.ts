/**
 * 推演的子系统之间的具名接口:一个子系统提供,别的子系统取用,按名字分组(war = 战争那一组:别的子系统挂给战争的攻城、立约、
 * 钱粮、动荡……,和战争提供给别人的宣战、议和、多看一眼)。
 * 接口放在引擎的 CivSim.api 上(引擎不认识内容),每次推演一份;后提供的顶替先提供的,要接着调先前那个的自己先取出来:
 *   const prev = warApi(sim).onFall;  warApi(sim).onFall = (w, x, y, t) => { prev?.(w, x, y, t); … }
 * 都是可选的:没有子系统提供 = undefined,取用的一方照没有处理(和原来一样)。
 */
import type { CivSim } from './engine/sim';
import type { AnnalCause, Year } from './types';
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

/** 这次推演的战争那一组接口(没有就建一份空的) */
export function warApi(sim: CivSim): WarApi {
  return (sim.api.war ??= {}) as WarApi;
}
