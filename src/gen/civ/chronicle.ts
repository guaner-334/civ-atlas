/**
 * 编年史(阶段 3):把 civ.annals(史事)写成一条条中文纪事,给界面上的"编年史"面板和"复制全文"用。
 * 纯函数,主线程用;只引 growth.ts / display.ts / types.ts,不引起名器和推演代码。
 *
 * - 一律按史事的字段读(各种类的字段含义见 types.ts 的 AnnalKind),不去翻变化日志推断。
 * - 国名用事发当年的国号(growth.ts 的 polityName),州名用 display.ts 的 regionLabel,城名用 settlements[i].name。
 * - **折叠**:同一个战争编号的宣战、攻占、被迫迁都(国都失守,capital 带战争编号)、灭亡、议和折叠成一条"战争"
 *   (起止年份、交战双方、结果),子条目是每一件事;标题写结果:"得瑞州等五州"、"昌国国都汾城陷落"(一场战争里
 *   迁了两次以上写"昌国连迁三都")、"昌国亡"。攻方先得后失写"得瑞州等三州而失雪西"(只有攻方的得失不带主语,
 *   国都失守不写"失国都",免得两个"失"说的不是同一方)。
 *   不是打下来的攻占各合成一条子条目,不写"攻取":议和时划清边界割让的(史事 peace 的 region = 紧挨在它前面的几条)
 *   写"议定疆界,乌绝原等三州划归大渭,雪西划归昌国"(标签"割");丢了国都撑不下去、残部一并归攻方的
 *   (亡国前同一刻连着的几条攻占)写"余下瑞州等三州尽归大渭"。
 *   不在战争里、收服部落地带的攻占,同一国前后相隔不到 TRIBAL_GAP 年的也折叠成一条(一条最长 TRIBAL_SPAN 年)。
 *   灭亡除了在战争的子条目里,也单独列一条(按国家筛选时要看得到;"大事"里由战争那一条说,不重复)。
 * - **分合**(阶段 3):分裂写"瑞州叛大渭自立,号瑞国,都于瑞城";复国(新国家有 Polity.restores)写
 *   "故昌遗民据瑞州起兵,脱大渭复国,号后昌国,都于瑞城"(标签"复");合并写"梅利斯国并入梅西亚王国"。
 *   攻占以前占有过的州(被夺走、议和割让、分裂出去之后又打回来)写"夺回"。
 * - **王朝更替**(阶段 3):东方写"大昌享国 312 年而亡,景氏起于青州代之,国号大景,定都青阳"(权臣篡位:"权臣景氏篡位,国号大景";
 *   入主旧都:"景氏起于青州,入主昌京,国号大景");西幻写"索拉特王国王室更迭,塞伦纳王朝享国 312 年而终,卡诺王朝兴,迁都卡诺"
 *   (汗国写"汗位易主")。标签"朝"。"享国 N 年"一律按当朝算(灭亡时也是),复国写"故景遗民"(亡国时那一朝的国号)。
 * - **城市兴衰**(阶段 3):洗劫写"大渭纵兵大掠汾城"(标签"掠"),折进那场战争;毁城写"大渭破昌国国都汾城,屠其民"
 *   (标签"毁"),折进战争,也单独列一条(和亡国一样);重建写"汾城重建"(换了民族另起新名:"汾城故址上筑起新城瑞城",标签"建");
 *   旧都衰落写"大昌旧都汾城渐衰"(亡了的国写"故都",标签"衰")。洗劫、毁城在史事里记在攻占前面,战争的子条目里排回攻占后面;
 *   战争标题里写毁了哪几座城("毁汾城")。
 * - **重要度**(界面上的"大事" = 重要度 3,一个世界 3000 年三四十条,一页读完,能当"世界简史"读:几个大国怎么兴起、
 *   打了哪几场改变格局的仗、怎么改朝换代、谁亡了;"全部"里什么都有):
 *   3 = 大国(到过第 2 档)立国、升格到一生最高的第 2 档以上(称王 / 称帝)、分出来的(复国的)国家日后长成大国、
 *       并掉的是大国、大国土崩瓦解、东方改朝换代(当时第 DYNASTY_TIER 档以上)、帝国级(第 CAPITAL_TIER 档)主动迁都、
 *       改变格局的战争:灭了大国、吞并一个像样的国家(亡的是"国"、易手 ≥ FALL_WAR 州;小国分出去又被原主收回的不算)、
 *       易手 ≥ BIG_WAR 州、攻下大国做了 ≥ OLD_CAPITAL 年的国都、两个第 3 档的帝国交兵且易手 ≥ TITAN_WAR 州、
 *       毁了大城(或做国都的城);
 *   2 = 小国立国、小国分裂 / 复国 / 并入大国、小国的改朝换代、降格、其余有得失的战争、战争里的每一件事(亡国、毁城那一条
 *       也单列,"大事"里由战争说)、夺别国的州、部落亡了、西幻的王室更迭(国名不变,地图上看不出来)、洗劫、城被毁、
 *       城(以上)重建、旧都衰落;
 *   1 = 部 → 国、只扩土不改国号、无功而还的战争、收服部落、村镇被毁、村镇重建。
 * - **大事合写**(combine):同一国家短时间(COMBINE_GAP 年)里连着的大事,后一件写进前一件,"大事"里不再单占一行
 *   ("全部"里照旧单列):改朝换代后不久有州叛离("…,国号大辰;七年后喀勒川叛大辰王朝自立,号库兹汗国");
 *   亡国之后逃难的迁徙写进那场战争("…,艾莱斯国亡,艾莱斯族南迁,入阿拉斯等五州")。
 * - **来历**(introduce):只看大事时,某国第一次出现、它的立国 / 分裂 / 复国不在大事里的,名字后面带一句来历:
 *   "艾莱斯国(第 2341 年立国)"、"塔提特汗国(第 2082 年叛哈尔提亚王国自立)"、"新塔提特汗国(第 2455 年脱哈尔提亚帝国复国)";
 *   改朝换代换了国号、那次改朝换代不在大事里的:"伊罗汗国(原居兰汗国)"。
 * - **同化与迁徙**(阶段 3,史事的 a、b 是民族):一波迁徙(同一刻、同一民族、同一起因)折成一条
 *   "居兰族避大渭兵锋西迁,入疏勒原等五州" / "乌耐族随乌耐汗国南下,徙居瑞州等三州"(方位读 Culture.migrations);
 *   逐州的同化按"新民族 + 原民族 + 统治的国家"折叠,相隔不到 ASSIM_GAP 年的算一段(一段最长 ASSIM_SPAN 年):
 *   "大渭治下,瑞州等五州的居兰人渐为渭人";统治民族反被同化写"大渭的居兰人渐染渭俗,…渐为渭人";
 *   部落地带的孤地(没有国家)写"瑞州的居兰人渐为渭人"。民族消亡单列一条"乌耐族亡"(大事)。
 *   迁入 ≥ MIGRATE_MAJOR 州的迁徙、同化 ≥ ASSIM_MAJOR 州的一段、民族消亡是大事。
 * - **干预**(阶段 4,史事 intervene;哪一条干预见 Civ.interventions[e.war]):"【干预】大昌与索拉特结盟"
 *   "【干预】大昌自此不亡"(有截止年份的加",至第 2750 年")"【干预】大昌向索拉特宣战"(没打成的写原因:"…,然两国不接壤,未能成行");
 *   划州"【干预】瑞州自大渭划归大昌,永为大昌之土";立国"【干预】瑞州脱大渭自立,号瑞国,都于瑞城"(紧跟着的 found 并进这一条);
 *   迁都"【干预】大昌自汾城迁都瑞城"(紧跟着的 capital 并进这一条);不许扩张"【干预】大昌自此止戈息兵,不再开疆拓土"。
 *   没生效的写原因("…,然其地无人居住""…,然瑞城属大渭");界面上的干预列表也用它(interventionOutcome)。标签"干",一律是大事。
 *   照大纲硬改出来的(干预带 plot,gen/edits.ts 文件头"大纲")前面标【照大纲】,别的写法一样:"【照大纲】大昌向索拉特宣战";
 *   同一条情节同一刻划给同一国的几州并成一条:"【照大纲】瑞州、汾州、雪西三州划归大昌"。
 *   援盟参战的战争(史事 war 的 settlement 列 = 盟国)写"索拉特应大昌之约伐某国"。
 * - **名臣**(Person.deeds):经手的事写上他(官职按那一年):议和"大景王朝遣礼部尚书百里青与萨尔斯坦帝国议和"
 *   (对方的使臣写在对方国名后面);称王称帝"…,丞相某某劝进"(西幻"…,首相某某力主其事");幼主即位"…,时年 11 岁,丞相某某辅政"
 *   (西幻"摄政");先君遇弑"…;丞相某某迎立其兄柳清瑶,是为睿宗"(西幻、汗国"拥立")。
 * - **灾异**(动荡、饥荒、民变、大崩解,unrest.ts):饥荒写"大渭瑞州等三州大饥,死者十之二"(标签"饥",只在"全部"里);
 *   民变连同讨伐它的那场战争折成一条"瑞州大饥,饥民奉李昭为主,据瑞城起事,号瑞国,叛大渭,…"再写结局
 *   ("旋为大渭所平""攻破汾城,大渭亡""得汾州,与大渭议和,割据一方";标签"起",攻破都城、亡了原来国家的是大事);
 *   民变被讨平的那条灭亡写"大渭讨平瑞国"(标签"平");大崩解写"大渭大乱,瑞州、汾州各自立国,大渭仅保汾城一隅"
 *   (地方崩加"诸州残破",散回部落"…土崩瓦解,二十三州散为部落…";标签"崩",一律是大事),紧跟着自立的几块是它的子条目。
 *   瘟疫(plague.ts)同一场折成一条"大疫起于维罗拉,传至特罗纳、哈尔兰,5 年间诸国死者十之二"(大瘟疫"大疫,起于…";标签"疫";
 *   大瘟疫、传到三国以上、死者十之二以上的是大事),子条目是逐年传到哪。
 *   全球大疫(pandemic.ts)写"克尔顿大疫:起于克尔顿,循航线传遍四洲,至五百六十一州,9 年乃息。城中死者十之四五,天下人口十去其二"
 *   ("天下"只给全球大疫);疫后荒废的城一国一条"某国疫后城邑荒废:甲、乙、丙等十三处,道路断绝"(子条目是每一处);
 *   凋敝结束一条"疫后凋敝三十年,至是始复。天下城邑荒废者六十余处,道路断绝近半"。这三样标签"疠"(界面上叫"大疫",颜色同瘟疫);
 *   逐年传到哪的子条目照旧是"疫"。
 * - **掌实权**(regents.ts,史事 regent,标签"权",见 regentEntry):帝国的引兵入朝、大臣大将专权,王国以上的叔父篡位是大事;太子监国、还政、伏诛、卒在"全部"里;
 *   幼主的叔父摄政、名臣辅政写在即位那一条("…,时年 9 岁,叔父某某摄政"),名臣、大臣篡位写在改朝换代那一条("…,丞相某某废幼主某某,自立为君")。
 * - **结亲**(marriages.ts,史事 marry,标签"姻",见 marryEntry):"南漓、大澜结亲:大澜德宗以女风氏妻南漓懿公胡炜";互嫁并成一条;议和时"是为和亲";
 *   两个帝国议和时的和亲是大事。
 * - 年份写法和时间轴一致:"第 N 年"(N = 年份取整)。州数等计数用中文数字("得瑞州等五州"),年数用阿拉伯数字。
 *
 * buildChronicle 按 civ 缓存(同一个 civ 只算一次)。
 */
import type { Annal, AnnalCause, AnnalKind, Civ, Culture, MigrationDir, Person, PersonRegency, PersonSpouse, Polity, Year } from './types';
import { REGENCY_KINDS, RG_DIED, RG_PURGE, RG_RETURN, RG_START, RG_USURP } from './regents';
import {
  TIER_REGIONS,
  annexedRemnants,
  dynastyIndexAt,
  dynastyTitle,
  polityName,
  polityRootAt,
  polityShortTitle,
  polityTierAt,
  polityTitles,
  populationAt,
  regionPopulationAt,
  settlementRank,
} from './growth';
import { pandemicsOf } from './pandemicInfo';
import { HABITABLE_SUIT, cultureLabel, regionLabel } from './display';
import { ownersAt } from './timeline';
import { plagueSpans } from './plagueSpans';
import { councilBefore } from './councilRules';
import { ageAt, generalRef, kinOf, leaderName, ministerRole, princeRef, princeTitle, reigningAt, rulerBare, rulerRef, rulerShort } from './peopleText';
import { eraText, monthTail, type Era } from '../era';
import { parsePersonKey, resolveKey, resolvePersonKey, type Intervention } from '../edits';
import { emptyPolicy, policyName, type PolicyIv } from './policy';
import { IV_NOT_HIM, IV_PEOPLE, IV_PROTECTED, IV_WAIT } from './rulers';
import { IV_TOLL, PLAGUE_IV, SLUMP_DEFAULT, quakeWord } from './calamity';
import { foesAt } from './fiscalBook';

/** 重要度:3 最重要 */
export type Importance = 1 | 2 | 3;
/** "大事"的门槛:重要度 3 */
export const MAJOR: Importance = 3;
/** 收服部落:同一国前后两次相隔不到这么多年,算同一轮,折叠成一条 */
export const TRIBAL_GAP = 30;
/** 收服部落:一轮最长这么多年(国家一直在扩张时,每一百年左右记一条,不会一条跨上千年) */
export const TRIBAL_SPAN = 100;
/** 易手这么多州以上的战争改变格局(大事) */
export const BIG_WAR = 15;
/** 攻下做了这么多年以上的国都(故都陷落)的战争是大事 */
export const OLD_CAPITAL = 300;
/** 到过这一档(王国 / 二十五州)以上的是大国:立国算大事 */
export const GREAT_TIER = 2;
/** 双方开战时都在这一档(帝国 / 七十州)以上:大国交兵,有得失就算大事 */
export const TITAN_TIER = 3;
/** 大国交兵:易手这么多州以上才算大事 */
export const TITAN_WAR = 8;
/** 灭国之战:亡的是大国,或者易手这么多州以上(吞并一个像样的国家),才算大事;小国(残部)被收拾掉的只在"全部"里 */
export const FALL_WAR = 6;
/** 改朝换代(东方)、主动迁都:当时在这一档(帝国 / 七十州)以上的是大事;小一些的国家只在"全部"里 */
export const DYNASTY_TIER = 2;
export const CAPITAL_TIER = 3;
/** 同化:同一国治下、同一对民族,前后相隔不到这么多年的算一段,折叠成一条;一段最长这么多年 */
export const ASSIM_GAP = 120;
export const ASSIM_SPAN = 300;
/** 一段同化改换了这么多州以上是大事;不到 ASSIM_MINOR 州的只在"全部"里算小事(重要度 1) */
export const ASSIM_MAJOR = 10;
export const ASSIM_MINOR = 3;
/** 一波迁徙迁入这么多州以上是大事 */
export const MIGRATE_MAJOR = 5;

/**
 * 纪事的种类:史事的种类,加上按人物排出来的君主继位(reign,不是史事,见 reignEntries)、
 * 信仰的大事(faith,不是史事,见 religionText.ts 的 faithEntries)、时代和物产的大事(era,见 developmentText.ts 的 developmentEntries)
 */
export type EntryKind = AnnalKind | 'reign' | 'faith' | 'era';

export interface ChronicleEntry {
  /** 这一条(第一条)史事在 civ.annals 里的下标;列表里唯一,当 key 用(君主继位 = civ.annals.length + 新君的 Person.id) */
  id: number;
  kind: EntryKind;
  /** 发生的年份(引擎精度的原值,1/256 年;显示取整)。折叠的条目 = 第一件事的年份 */
  year: Year;
  /** 截止年份:折叠的条目 = 最后一件事的年份(战争到结束年份还没打完 = civ.endYear);其余 = year */
  end: Year;
  /** 纪事正文(不带年份) */
  text: string;
  /** 一个字的标签(界面上的小印章):立 升 降 战 占 征 和 割 亡 迁 分 复 合 朝 徙 化 湮 掠 毁 建 衰 干 役 变 没 嗣 饥 起 崩 平 疫 权 姻;信仰:创 皈 传 派 圣;时代:代 */
  tag: string;
  importance: Importance;
  /** 相关国家(按国家筛选、地图高亮用;先主后次,不含 −1) */
  polities: number[];
  /** 事发的州(地图高亮用;升格、宣战、合并这类没有具体州的为空,界面高亮相关国家的国土) */
  regions: number[];
  /** 相关的城(立国 / 迁都的国都、攻占的城);没有 = −1 */
  settlement: number;
  /** 折叠进来的每一件事(按先后) */
  children?: ChronicleEntry[];
  /** 战争到结束年份还没打完 */
  ongoing?: boolean;
  /** 战争那一条的开头(由头和出兵,不含得失):回放视频里战争还没打完时只写这一句 */
  head?: string;
  /** 正文里写到的人物(Person.id;没有 = 不给) */
  people?: number[];
  /** 信仰的大事:哪种信仰(civ.religion.faiths 的下标;教派分立 = 新的教派) */
  faith?: number;
}

// ---------------------------------------------------------------------------
// 小工具

const CN_DIGITS = '零一二三四五六七八九';
const CN_UNITS = ['', '十', '百', '千'];

/** 计数用的中文数字(0–9999):5 → 五,12 → 十二,25 → 二十五,105 → 一百零五 */
export function cnNumber(n: number): string {
  const v = Math.floor(n);
  if (!(v >= 0) || v >= 10000) return String(Number.isFinite(v) ? v : 0);
  if (v < 10) return CN_DIGITS[v];
  const ds = String(v).split('').map(Number);
  let out = '';
  let zero = false;
  for (let i = 0; i < ds.length; i++) {
    const d = ds[i];
    const u = CN_UNITS[ds.length - 1 - i];
    if (d === 0) {
      zero = true;
      continue;
    }
    if (zero && out) out += '零';
    zero = false;
    out += (d === 1 && u === '十' && i === 0 ? '' : CN_DIGITS[d]) + u;
  }
  return out;
}

/** "第 N 年"(和时间轴一致:年份取整) */
export function yearText(y: Year): string {
  return `第 ${Math.floor(y)} 年`;
}

/** 条目的年份:"第 1240 年";跨年的折叠条目 "第 1240—1256 年" */
export function entryYearLabel(e: ChronicleEntry): string {
  const a = Math.floor(e.year);
  const b = Math.floor(e.end);
  return b > a ? `第 ${a}—${b} 年` : `第 ${a} 年`;
}

/** 条目的年份带月(一年 months 个月;0 = 只写年):"第 1240 年 3 月";跨年的折叠条目照旧 "第 1240—1256 年"(每一件事各自写月) */
export function entryYearMonthLabel(e: ChronicleEntry, months: number): string {
  return Math.floor(e.end) > Math.floor(e.year) ? entryYearLabel(e) : `${yearText(e.year)}${monthTail(e.year, months)}`;
}

function polityOf(civ: Civ, id: number): Polity | null {
  return id >= 0 && id < civ.polities.length ? civ.polities[id] : null;
}

/** 某年的国名(当年的国号);编号无效 = "某国" */
function pn(civ: Civ, id: number, year: Year): string {
  const p = polityOf(civ, id);
  return p ? polityName(p, year) || p.name || '某国' : '某国';
}

/** 城名;编号无效 / 没名字 = 空串 */
function cityName(civ: Civ, s: number): string {
  return s >= 0 && s < civ.settlements.length ? civ.settlements[s].name || '' : '';
}

/** 州名;编号无效 = 空串 */
function regionName(civ: Civ, r: number): string {
  return r >= 0 && r < civ.regions.count ? regionLabel(civ, r) : '';
}

/** 一串州:"瑞州"、"瑞州、青州"、"瑞州等五州"(人口上限大的写在前面) */
function regionList(civ: Civ, rs: readonly number[]): string {
  const ok = rs.filter((r) => r >= 0 && r < civ.regions.count);
  if (!ok.length) return '';
  const cap = civ.regions.capacity;
  const sorted = [...ok].sort((a, b) => cap[b] - cap[a] || a - b);
  if (sorted.length === 1) return regionName(civ, sorted[0]);
  if (sorted.length === 2) return `${regionName(civ, sorted[0])}、${regionName(civ, sorted[1])}`;
  return `${regionName(civ, sorted[0])}等${cnNumber(sorted.length)}州`;
}

/**
 * 议和割让的州,一一写出:"瑞州"、"瑞州、汾州两州"、"瑞州、汾州、雪西三州";多于 CEDE_NAMES 州的写前几州:
 * "瑞州、汾州、雪西、乌绝原、梅川等十二州"(按人口上限从大到小)
 */
const CEDE_NAMES = 5;
function regionNames(civ: Civ, rs: readonly number[]): string {
  const ok = rs.filter((r) => r >= 0 && r < civ.regions.count);
  if (!ok.length) return '';
  const cap = civ.regions.capacity;
  const sorted = [...ok].sort((a, b) => cap[b] - cap[a] || a - b);
  if (sorted.length === 1) return regionName(civ, sorted[0]);
  const n = sorted.length;
  const names = sorted.slice(0, CEDE_NAMES).map((r) => regionName(civ, r));
  return n <= CEDE_NAMES ? `${names.join('、')}${n === 2 ? '两' : cnNumber(n)}州` : `${names.join('、')}等${cnNumber(n)}州`;
}

function cultureOf(civ: Civ, id: number): Culture | null {
  return id >= 0 && id < civ.cultures.length ? civ.cultures[id] : null;
}

/** 族名:"居兰族";编号无效 = "某族" */
function cn(civ: Civ, id: number): string {
  const c = cultureOf(civ, id);
  return c && c.name ? cultureLabel(c) : '某族';
}

/** 族人:"居兰人";编号无效 = "异族人" */
function folk(civ: Civ, id: number): string {
  const c = cultureOf(civ, id);
  return c && c.name ? `${c.name}人` : '异族人';
}

/** 某年之前(不含这一年这一刻)的国都 */
function capitalBefore(p: Polity, year: Year): number {
  const c = p.capitals;
  if (!c || !c.length) return p.capital;
  let s = c[0].settlement;
  for (let i = 1; i < c.length && c[i].year < year; i++) s = c[i].settlement;
  return s;
}

/** 某年之前(不含这一刻)的国都做了多少年国都 */
function capitalHeld(p: Polity, year: Year): number {
  const c = p.capitals;
  if (!c || !c.length) return year - p.founded;
  let since = c[0].year;
  for (let i = 1; i < c.length && c[i].year < year; i++) since = c[i].year;
  return year - since;
}

/** 到过的最高档位(没有 titles = 0) */
function peakTier(p: Polity): number {
  let t = 0;
  for (const x of p.titles ?? []) if (x.tier > t) t = x.tier;
  return t;
}

/** 大国:到过第 GREAT_TIER 档(王国 / 二十五州)以上 */
function isGreat(p: Polity | null): boolean {
  return !!p && peakTier(p) >= GREAT_TIER;
}

/** 是个"国":到过第 1 档,或是分裂 / 复国出来的。一直是"X部"的部落亡了不算灭国 */
function isState(p: Polity | null): boolean {
  return !!p && (peakTier(p) >= 1 || p.parent !== undefined || p.restores !== undefined);
}

const uniq = (xs: number[]) => xs.filter((x, i) => x >= 0 && xs.indexOf(x) === i);

// ---------------------------------------------------------------------------
// 人物(Civ.people;没有人物的 civ 照旧不写人名)

interface Command {
  side: number;
  /** 经手的第一件、最后一件事(史事下标,见 PersonCommand) */
  first: number;
  last: number;
  person: Person;
}

/** 人物索引:每国的君主(按即位先后)、每场战争两边的统帅任期、名臣经手的事 */
interface PeopleIndex {
  rulers: Person[][];
  commands: Map<number, Command[]>;
  /** 史事下标 → 经手的名臣(议和、劝进) */
  envoys: Map<number, Person[]>;
  /** 新君(Person.id)→ 辅政 / 迎立他的名臣 */
  regent: Map<number, Person>;
  enthrone: Map<number, Person>;
  /** 人物编号 → 儿子(按出生先后;争储写"三子某某"用) */
  kids: Map<number, Person[]>;
  /** 据险断后(史事 stand 的下标)→ 守关隘的守将(不算统帅,不在 commands 里) */
  rear: Map<number, Person>;
  /** 史事下标(掌实权的掌权、还政、伏诛、篡位、卒那一条)→ 掌权的人、那一段(Person.regencies) */
  power: Map<number, { x: Person; g: PersonRegency }>;
  /** 幼主(Person.id)→ 摄政的叔父 */
  uncle: Map<number, Person>;
  /** 史事下标(结亲那一条)→ 娶亲的人、那一门亲(Person.spouses) */
  wed: Map<number, { x: Person; s: PersonSpouse }>;
}

const peopleCache = new WeakMap<object, PeopleIndex>();

function peopleOf(civ: Civ): PeopleIndex | null {
  const list = civ.people;
  if (!list || !list.length) return null;
  let ix = peopleCache.get(list);
  if (ix) return ix;
  ix = {
    rulers: civ.polities.map(() => []),
    commands: new Map(),
    envoys: new Map(),
    regent: new Map(),
    enthrone: new Map(),
    kids: new Map(),
    rear: new Map(),
    power: new Map(),
    uncle: new Map(),
    wed: new Map(),
  };
  for (const x of list) {
    if (x.parent !== undefined) {
      const ks = ix.kids.get(x.parent);
      if (ks) ks.push(x);
      else ix.kids.set(x.parent, [x]);
    }
    if (x.role === 'ruler' && x.polity >= 0 && x.polity < ix.rulers.length) ix.rulers[x.polity].push(x);
    for (const g of x.regencies ?? []) {
      ix.power.set(g.annal, { x, g });
      if (g.endAnnal !== undefined) ix.power.set(g.endAnnal, { x, g });
      if (g.kind === 'uncle') ix.uncle.set(g.ruler, x);
    }
    for (const s of x.spouses ?? []) ix.wed.set(s.annal, { x, s });
    // 名臣经手的事(篡位做了新朝第一位的名臣,做名臣时经手的事也在他身上)
    for (const d of x.role === 'minister' || x.role === 'ruler' ? (x.deeds ?? []) : []) {
      if ((d.kind === 'peace' || d.kind === 'rank') && d.annal !== undefined) {
        const m = ix.envoys.get(d.annal);
        if (m) m.push(x);
        else ix.envoys.set(d.annal, [x]);
      } else if ((d.kind === 'regent' || d.kind === 'enthrone') && d.person !== undefined && !ix[d.kind].has(d.person)) ix[d.kind].set(d.person, x);
    }
    for (const c of x.commands ?? []) {
      if (c.rear) {
        ix.rear.set(c.first, x);
        continue;
      }
      let m = ix.commands.get(c.war);
      if (!m) ix.commands.set(c.war, (m = []));
      m.push({ side: c.side, first: c.first, last: c.last, person: x });
    }
  }
  for (const rs of ix.rulers) rs.sort((a, b) => (a.from ?? 0) - (b.from ?? 0) || a.id - b.id);
  for (const ks of ix.kids.values()) ks.sort((a, b) => a.born - b.born || a.id - b.id);
  for (const m of ix.commands.values()) m.sort((a, b) => a.first - b.first || a.person.id - b.person.id);
  peopleCache.set(list, ix);
  return ix;
}

/** 名臣带官职:"丞相百里青""首相弗拉文斯"(官职按那一年) */
function ministerRef(x: Person, y: Year): string {
  let title = '';
  for (const p of x.posts ?? []) if (p.from <= y + 1e-6) title = p.title;
  return `${title}${x.name}`;
}

/** 东方中式的写法(汗国、西幻、共和国平实些) */
const classical = (p: Polity | null | undefined) => !!p?.eastern && p.lineage !== 'khanate';

/** 议和的开头:"甲遣礼部尚书某某与乙议和"(乙方的使臣:"甲与乙首相某某议和");people = 写到的名臣 */
function peaceHead(civ: Civ, ix: PeopleIndex | null, e: Annal, i: number, y: Year): { text: string; people: Person[] } {
  const ms = ix?.envoys.get(i) ?? [];
  const ma = ms.find((m) => m.polity === e.a);
  const mb = ms.find((m) => m.polity === e.b);
  const text = `${pn(civ, e.a, y)}${ma ? `遣${ministerRef(ma, y)}` : ''}与${pn(civ, e.b, y)}${mb ? ministerRef(mb, y) : ''}议和`;
  return { text, people: [ma, mb].filter((m): m is Person => !!m) };
}

/** 某一刻在位的君主(即位那一刻起算) */
function reigning(ix: PeopleIndex | null, p: number, t: Year): Person | null {
  const rs = ix?.rulers[p];
  if (!rs) return null;
  for (let i = rs.length - 1; i >= 0; i--) {
    const r = rs[i];
    if ((r.from ?? Infinity) <= t) return r.until === undefined || t < r.until ? r : null;
  }
  return null;
}

/** 在 t 这一刻失去君位的那一位(亡国、改朝换代的末代) */
function endedAt(ix: PeopleIndex | null, p: number, t: Year): Person | null {
  const rs = ix?.rulers[p];
  if (!rs) return null;
  for (let i = rs.length - 1; i >= 0; i--) if (rs[i].until === t) return rs[i];
  return null;
}

/** 某场战争某一方(0 = 攻方,1 = 守方)打第 i 条史事(宣战、战役、攻占)的统帅 */
function commander(ix: PeopleIndex | null, war: number, side: number, i: number): Person | null {
  const m = ix?.commands.get(war);
  if (!m || side < 0) return null;
  for (const c of m) if (c.side === side && c.first <= i && i <= c.last) return c.person;
  return null;
}

/** 在第 i 条史事(战役、攻占)里战死的那一方统帅 */
function fallenAt(ix: PeopleIndex | null, war: number, side: number, i: number): Person | null {
  for (const c of ix?.commands.get(war) ?? []) if (c.side === side && c.last === i && c.person.fate === 'battle') return c.person;
  return null;
}

/** 某国第 i 朝的第一位君主 */
function founderOf(ix: PeopleIndex | null, p: number, i: number): Person | null {
  return ix?.rulers[p]?.find((x) => (x.dynasty ?? 0) === i) ?? null;
}

/** 给纪事记上写到的人物 */
function withPeople(x: ChronicleEntry, ...ps: (Person | null | undefined)[]): ChronicleEntry {
  const ids = ps.filter((p): p is Person => !!p).map((p) => p.id);
  if (ids.length) x.people = uniq([...(x.people ?? []), ...ids]);
  return x;
}

// ---------------------------------------------------------------------------
// 单条史事 → 纪事

/** 国号变化:第几条 rank 史事对应 titles 里的哪一条(同一年有两条时按先后对上) */
interface Ctx {
  civ: Civ;
  /** 国家 → 已经用掉的 titles 下标 */
  titleUsed: Map<number, number>;
  /** 是"夺回"的攻占(史事下标):攻方以前占有过这一州(被夺走、议和割让、分裂出去之后又打回来) */
  retake: Set<number>;
  /** 分裂 / 复国出来的国家 → 它是从哪国分出去的(split 史事的 b) */
  splitFrom: Map<number, number>;
  /** 逃难的一波迁徙(条目 id)→ 不带起因的短句"艾莱斯族南迁,入阿拉斯等五州"(合写进战争那一条用,见 combine) */
  flight: Map<number, string>;
  /** 人物索引(没有人物 = null,照旧不写人名) */
  ix: PeopleIndex | null;
  /** 讨伐民变、据地争位的宗室的战争(war 的 cause = quell / heir)→ 起事的国家 */
  quell: Map<number, number>;
}

/**
 * 哪些攻占是"夺回":按史事从头翻,记下每一州先后归过哪些国家(攻占的原主、分裂出去的原主国),
 * 攻方以前占有过的就是夺回。只看史事(扩张得来、后来丢掉的州,丢的那条攻占里原主就是它)
 */
function retakes(A: readonly Annal[]): Set<number> {
  const had = new Map<number, Set<number>>();
  const out = new Set<number>();
  const add = (r: number, p: number) => {
    if (r < 0 || p < 0) return;
    let s = had.get(r);
    if (!s) had.set(r, (s = new Set()));
    s.add(p);
  };
  A.forEach((e, i) => {
    if (e.kind === 'conquer') {
      if (e.a >= 0 && had.get(e.region)?.has(e.a)) out.add(i);
      add(e.region, e.b);
      add(e.region, e.a);
    } else if (e.kind === 'split') {
      add(e.region, e.b);
      add(e.region, e.a);
    }
  });
  return out;
}

/** 升格 / 降格:[之前的档位, 之后的档位] */
function rankTiers(ctx: Ctx, e: Annal, p: Polity): [number, number] {
  const t = p.titles ?? [];
  const used = ctx.titleUsed.get(p.id) ?? 0;
  for (let j = Math.max(1, used); j < t.length; j++) {
    if (t[j].year === e.year) {
      ctx.titleUsed.set(p.id, j + 1);
      return [t[j - 1].tier, t[j].tier];
    }
  }
  // 数据对不上(titles 没记这一次):按年份现查
  let before = 0;
  let after = 0;
  for (const x of t) {
    if (x.year < e.year) before = x.tier;
    if (x.year <= e.year) after = x.tier;
  }
  return [before, after];
}

function rankEntry(ctx: Ctx, e: Annal, id: number): ChronicleEntry {
  const { civ } = ctx;
  const p = polityOf(civ, e.a);
  let text: string;
  let importance: Importance = 1;
  let tag = '升';
  if (!p) text = '某国更定国号';
  else {
    const titles = polityTitles(p, e.year);
    const [b, a] = rankTiers(ctx, e, p);
    const adviser = ctx.ix?.envoys.get(id)?.find((m) => m.polity === p.id);
    const oldName = titles[Math.min(3, Math.max(0, b))];
    const newName = titles[Math.min(3, Math.max(0, a))];
    if (a > b) {
      if (newName === oldName) {
        text = `${newName}拓地至${cnNumber(TIER_REGIONS[Math.min(3, a)])}州`;
        importance = a >= GREAT_TIER ? 2 : 1;
      } else if (newName.endsWith('帝国') && !oldName.endsWith('帝国')) {
        text = `${oldName}称帝,改号${newName}`;
        importance = 3;
      } else {
        text = `${oldName}升格为${newName}`;
        // 升到第 2 档以上(称王 / 称帝)是大事;后来还会再升一档的,"大事"里只留最高的那一次
        // (帝国的一生读起来是"立国 → 称帝",不再夹一条"称王");部 → 国是小事
        importance = a >= GREAT_TIER ? (a >= peakTier(p) ? 3 : 2) : 1;
      }
      if (adviser && newName !== oldName) {
        text += `,${ministerRef(adviser, e.year)}${classical(p) ? '劝进' : '力主其事'}`;
        return withPeople(base(e, id, text, importance, [e.a], [], tag), adviser);
      }
    } else if (a < b) {
      tag = '降';
      text = newName === oldName ? `${newName}国势衰微` : `${oldName}国势衰微,降为${newName}`;
      importance = newName === oldName ? 1 : 2;
    } else text = `${newName}更定国号`;
  }
  return base(e, id, text, importance, [e.a], [], tag);
}

/** 各种类的一字标签(降格另写"降";收服部落写"征") */
const TAG: Record<AnnalKind, string> = {
  found: '立',
  rank: '升',
  war: '战',
  conquer: '占',
  peace: '和',
  fall: '亡',
  capital: '迁',
  split: '分',
  merge: '合',
  dynasty: '朝',
  migrate: '徙',
  assimilate: '化',
  vanish: '湮',
  sack: '掠',
  ruin: '毁',
  rebuild: '建',
  decline: '衰',
  intervene: '干',
  battle: '役',
  upheaval: '变',
  sunk: '没',
  alliance: '盟',
  unally: '盟',
  submit: '臣',
  defect: '叛',
  diverge: '衍',
  famine: '饥',
  revolt: '起',
  collapse: '崩',
  plague: '疫',
  warlord: '据',
  reclaim: '收',
  defy: '抗',
  fiscal: '匮',
  council: '议',
  stand: '役',
  regent: '权',
  marry: '姻',
  pandemic: '疠',
  desolate: '疠',
};

function base(
  e: Annal,
  id: number,
  text: string,
  importance: Importance,
  polities: number[],
  regions: number[],
  tag = e.kind === 'conquer' && e.b < 0 ? '征' : TAG[e.kind] ?? '事',
): ChronicleEntry {
  return {
    id,
    kind: e.kind,
    year: e.year,
    end: e.year,
    text,
    tag,
    importance,
    polities: uniq(polities),
    regions: uniq(regions),
    settlement: e.settlement >= 0 ? e.settlement : -1,
  };
}

/**
 * 攻占一州:"大渭攻取瑞州,国都汾城陷落";war = 所在战争的双方(写子条目时守方是谁不用再说);
 * retake = 这一州开战前本来就是攻方的(战争中被夺走又打回来):"昌国夺回柳州,收复柳城";
 * who = 换掉开头的国名(写统帅:"大渭将李牧攻取瑞州")
 */
function conquerText(civ: Civ, e: Annal, war?: [number, number], retake = false, who?: string): string {
  const A = who ?? pn(civ, e.a, e.year);
  const r = regionName(civ, e.region) || '一州';
  if (e.b < 0) return `${A}征服${r}诸部`;
  const B = pn(civ, e.b, e.year);
  const implied = war && (e.b === war[0] || e.b === war[1]);
  const city = cityName(civ, e.settlement);
  if (retake) return `${A}${implied ? '' : `自${B}手中`}夺回${r}${city ? `,收复${city}` : ''}`;
  let t = implied ? `${A}攻取${r}` : `${A}攻取${B}之${r}`;
  if (city) {
    const owner = polityOf(civ, e.b);
    const wasCapital = owner && capitalBefore(owner, e.year) === e.settlement && owner.founded <= e.year;
    t += wasCapital ? `,国都${city}陷落` : `,${city}陷落`;
  }
  return t;
}

/** 亡国之君的下场 */
const LAST_FATE: Partial<Record<NonNullable<Person['fate']>, string>> = { fell: '殉国', surrendered: '出降', fled: '出奔' };

/** 灭亡:"大昌亡于大渭,享国 312 年";有人物的加上末代君主的下场:",哀帝殉国"(土崩瓦解、亡于天灾的出奔写"不知所终") */
function fallText(civ: Civ, e: Annal, last: Person | null = null): string {
  const A = pn(civ, e.a, e.year);
  let t = e.b >= 0 ? `${A}亡于${pn(civ, e.b, e.year)}` : e.b === -2 ? `${A}亡于天灾` : `${A}土崩瓦解`;
  const p = polityOf(civ, e.a);
  if (p && Number.isFinite(p.founded)) {
    // 享国按当朝算(改朝换代过的,从新朝那年起)
    const n = Math.floor(e.year) - Math.floor(reignStart(p, e.year));
    if (n >= 1) t += `,享国 ${n} 年`;
  }
  const how = last?.fate === 'fled' && e.b < 0 ? '不知所终' : last?.fate ? LAST_FATE[last.fate] : undefined;
  if (last && how) t += `,${rulerBare(civ, last, e.year)}${how}`;
  return t;
}

/** 某年那一朝从哪年起(没改朝换代过 = 立国那年) */
function reignStart(p: Polity, year: Year): Year {
  const d = p.dynasties;
  return d && d.length ? d[dynastyIndexAt(p, year)].year : p.founded;
}

/**
 * 编年史里称呼某一朝(year 年时的国号档位):东方 = 那一朝的国号简称("大昌""昌国";汗国写全称"乌耐汗国"),
 * 西幻 = "塞伦纳王朝"
 */
function reignName(civ: Civ, p: Polity, i: number, year: Year): string {
  if (!p.eastern) return dynastyTitle(p, i) || '旧王室';
  const d = p.dynasties?.[i];
  if (!d) return pn(civ, p.id, year);
  const tier = Math.max(0, polityTierAt(p, year));
  return p.lineage === 'khanate' ? polityTitles(p, d.year)[tier] : polityShortTitle(p, tier, d.year);
}

/**
 * 改朝换代 / 王室更迭:
 * 东方 "大昌享国 312 年而亡,景氏起于青州代之,国号大景,定都青阳"(根据地就是国都 = 权臣篡位;没迁都 = 入主旧都);
 * 西幻 "索拉特王国王室更迭,塞伦纳王朝享国 312 年而终,卡诺王朝兴,迁都卡诺"(汗国"汗位易主")。
 * 有人物的写人:"…而亡,景元起于青州代之""…而亡,权臣赵高废少帝自立""…,卡诺王朝兴,阿尔德里克三世即位"
 */
function dynastyText(civ: Civ, e: Annal, ix: PeopleIndex | null = null, usurped = false): string {
  const p = polityOf(civ, e.a);
  if (!p) return '某国改朝换代';
  const y = e.year;
  const i = Math.max(1, dynastyIndexAt(p, y));
  const d = p.dynasties ?? [];
  const n = d.length > i ? Math.floor(y) - Math.floor(d[i - 1].year) : 0;
  const lasted = n >= 1 ? `享国 ${n} 年` : '';
  const oldCap = capitalBefore(p, y);
  const moved = e.settlement >= 0 && e.settlement !== oldCap;
  const city = cityName(civ, e.settlement);
  const oldName = reignName(civ, p, i - 1, y);
  // 有人物:新朝的第一位、被废(被推翻)的末代
  const nu = founderOf(ix, p.id, i);
  const old = endedAt(ix, p.id, y);
  if (p.eastern) {
    const oldRoot = polityRootAt(p, y - 1 / 512);
    const newRoot = polityRootAt(p, y);
    const newName = reignName(civ, p, i, y);
    const house = newRoot !== oldRoot ? `${newRoot}氏` : '新朝';
    const r = regionName(civ, e.region);
    const coup = e.region >= 0 && oldCap >= 0 && oldCap < civ.settlements.length && civ.settlements[oldCap].region === e.region;
    let t = `${oldName}${lasted ? `${lasted}而亡` : '亡'}`;
    // 被废的末代:"权臣赵高废少帝自立"(称号本身带"废"字的写名字)
    const ousted = old ? (old.title && !old.title.startsWith('废') ? old.title : old.name) : '';
    // 掌实权的名臣、大臣篡位:"丞相契鸾废幼主季工,自立为君"(带他做名臣时的官职;末代未成年写"幼主")
    if (usurped && nu) {
      const young = old && ageAt(old, y) < 18 ? '幼主' : '';
      t += `,${nu.posts?.length ? ministerRef(nu, y - 1 / 512) : `权臣${nu.name}`}${ousted ? `废${young}${ousted}` : ''},自立为君`;
    } else if (coup || !r) t += nu ? `,权臣${nu.name}${ousted ? `废${ousted}` : ''}自立` : `,权臣${house}篡位`;
    else if (moved) t += `,${nu ? nu.name : house}起于${r}代之`;
    else t += `,${nu ? nu.name : house}起于${r}${cityName(civ, oldCap) ? `,入主${cityName(civ, oldCap)}` : '代之'}`;
    t += `,国号${newName}`;
    if (moved && city) t += `,定都${city}`;
    return t;
  }
  const realm = pn(civ, p.id, y);
  const what = p.lineage === 'khanate' ? '汗位易主' : '王室更迭';
  let t = `${realm}${what},${oldName}${lasted ? `${lasted}而终` : '绝嗣'},${reignName(civ, p, i, y)}兴`;
  if (usurped && nu) t += `,${nu.posts?.length ? ministerRef(nu, y - 1 / 512) : `权臣${nu.name}`}${old ? `废黜${old.name}` : ''},自立为王`;
  else if (nu) t += `,${rulerShort(civ, nu)}即位`;
  if (moved && city) t += `,迁都${city}`;
  return t;
}

/** 城 sid 在 year 这一刻之前的级别(0 村 … 3 大城;被毁的城看被毁前一刻) */
function rankBefore(civ: Civ, sid: number, year: Year): number {
  const s = sid >= 0 && sid < civ.settlements.length ? civ.settlements[sid] : null;
  return s ? settlementRank(populationAt(s, year - 1 / 512)) : 0;
}

/** 攻城那一刻被攻下的城:是守方的国都就写"昌国国都汾城",不是写"汾城" */
function besieged(civ: Civ, e: Annal): { city: string; capital: boolean } {
  const city = cityName(civ, e.settlement) || '一城';
  const owner = polityOf(civ, e.b);
  const capital = !!owner && owner.founded <= e.year && capitalBefore(owner, e.year) === e.settlement;
  return { city: capital ? `${pn(civ, e.b, e.year)}国都${city}` : city, capital };
}

/**
 * 毁城:城以上"大渭破昌国国都汾城,屠其民" / "…焚毁汾城,城遂成废墟" / "…破汾城,夷为平地";
 * 村镇轻一些:"柳镇毁于大渭兵火" / "大渭焚毁柳镇" / "大渭破柳镇,夷为平地"。
 * 三种说法按城、年份轮换,和攻方是哪种国家无关
 */
function ruinText(civ: Civ, e: Annal): string {
  const A = pn(civ, e.a, e.year);
  const { city } = besieged(civ, e);
  const v = (Math.max(0, e.settlement) * 7 + Math.floor(e.year)) % 3;
  if (rankBefore(civ, e.settlement, e.year) >= 2) {
    if (v === 0) return `${A}破${city},屠其民`;
    if (v === 1) return `${A}焚毁${city},城遂成废墟`;
    return `${A}破${city},夷为平地`;
  }
  if (v === 0) return `${city}毁于${A}兵火`;
  if (v === 1) return `${A}焚毁${city}`;
  return `${A}破${city},夷为平地`;
}

/** 毁城的重要度:大城(或做国都的城)被毁 3,城 2,村镇 1 */
function ruinImportance(civ: Civ, e: Annal): Importance {
  const rank = rankBefore(civ, e.settlement, e.year);
  return rank >= 3 || (rank >= 2 && besieged(civ, e).capital) ? 3 : rank >= 2 ? 2 : 1;
}

/** 洗劫:"大渭洗劫汾城";折损五成五以上写"纵兵大掠",七成以上再加"十室九空" */
function sackText(civ: Civ, e: Annal): string {
  const A = pn(civ, e.a, e.year);
  const { city } = besieged(civ, e);
  const s = e.settlement >= 0 ? civ.settlements[e.settlement] : undefined;
  const loss = s?.sacks?.find((k) => !k.cause && k.year === e.year)?.loss ?? 0;
  if (loss >= 0.7) return `${A}纵兵大掠${city},十室九空`;
  if (loss >= 0.55) return `${A}纵兵大掠${city}`;
  return `${A}洗劫${city}`;
}

/** 重建:"汾城重建"(荒废一百年以上写"荒废 230 年的汾城重建");换了民族另起新名:"汾城故址上筑起新城瑞城" */
function rebuildText(civ: Civ, e: Annal): string {
  const s = e.settlement >= 0 ? civ.settlements[e.settlement] : undefined;
  const city = cityName(civ, e.settlement) || '新城';
  const old = s?.rebuilds !== undefined ? civ.settlements[s.rebuilds] : undefined;
  if (!old) return `${city}建城`;
  if (old.name && old.name !== s!.name) return `${old.name}故址上筑起新城${city}`;
  const gap = old.ended !== undefined ? Math.floor(e.year) - Math.floor(old.ended) : 0;
  return gap >= 100 ? `荒废 ${gap} 年的${city}重建` : `${city}重建`;
}

/** 旧都衰落:"大昌旧都汾城渐衰";国家已经亡了(被并)的写"故都"(国名用亡国时的):"昌国故都汾城渐衰" */
function declineText(civ: Civ, e: Annal): string {
  const city = cityName(civ, e.settlement) || '旧都';
  const p = polityOf(civ, e.a);
  if (!p) return `旧都${city}渐衰`;
  if (p.ended !== undefined && p.ended <= e.year) return `${pn(civ, p.id, p.ended - 1 / 512)}故都${city}渐衰`;
  return `${pn(civ, p.id, e.year)}旧都${city}渐衰`;
}

/** 此刻(第 id 条史事之前)两国正在交战 */
function atWarBefore(civ: Civ, a: number, b: number, id: number): boolean {
  const open = new Set<number>();
  const A = civ.annals;
  for (let i = 0; i < id && i < A.length; i++) {
    const e = A[i];
    if (e.kind === 'war' && ((e.a === a && e.b === b) || (e.a === b && e.b === a))) open.add(e.war);
    else if (e.kind === 'peace') open.delete(e.war);
  }
  return open.size > 0;
}

/** 干预(阶段 4)的说法和结果:text = 编年史正文;ok = 生效了;why = 没生效的原因(短句,界面上的干预列表用) */
interface IvStory {
  text: string;
  ok: boolean;
  why?: string;
}

/** 干预(阶段 4):"【干预】大昌与索拉特结盟";没生效的写原因 */
/** 州键指不到州(改地形后那块地方成了水,或者格式不对) */
const NO_REGION = '这个世界没有这个州(改地形后那块地方可能成了水)';

function interveneStory(civ: Civ, e: Annal, id: number): IvStory {
  const v = civ.interventions?.[e.war];
  const y = e.year;
  const A = e.a >= 0 ? pn(civ, e.a, y) : '';
  const B = e.b >= 0 ? pn(civ, e.b, y) : '';
  const dead = (p: number) => {
    const q = polityOf(civ, p);
    return !!q && q.ended !== undefined && q.ended <= y;
  };
  // 照大纲硬改出来的(gen/edits.ts 文件头"大纲")标【照大纲】
  const tag = v?.plot !== undefined ? '【照大纲】' : '【干预】';
  const fail = (text: string, why: string): IvStory => ({ text: `${tag}${text}`, ok: false, why });
  const done = (text: string): IvStory => ({ text: `${tag}${text}`, ok: true });
  /** 紧跟在这条干预后面(同一刻)的史事 */
  const next = (k = 1) => {
    const n = civ.annals[id + k];
    return n && n.year === y ? n : undefined;
  };
  if (!v) return done(A);
  const R = regionName(civ, e.region) || '其州';
  switch (v.kind) {
    case 'protect': {
      const until = v.until !== undefined ? `,至第 ${v.until} 年` : '';
      return dead(e.a) ? fail(`欲保${A}不亡,然${A}已亡`, `那一年${A}已亡`) : done(`${A}自此不亡${until}`);
    }
    case 'unity':
      return dead(e.a) ? fail(`欲令${A}四境无叛,然${A}已亡`, `那一年${A}已亡`) : done(`${A}自此四境无叛,再无州郡自立`);
    case 'halt': {
      if (dead(e.a)) return fail(`欲令${A}止戈,然${A}已亡`, `那一年${A}已亡`);
      const until = v.until !== undefined ? `,至第 ${v.until} 年` : '';
      const peace = next()?.kind === 'peace' && next()!.a === e.a ? ',所起之兵尽罢' : '';
      return done(`${A}自此止戈息兵,不再开疆拓土${until}${peace}`);
    }
    case 'ally': {
      const until = v.until !== undefined ? `,约至第 ${v.until} 年` : '';
      if (!B) return fail(`${A}欲与他国结盟,然其国不存`, '对方在新历史里没有(或那一年还没立国)');
      const gone = dead(e.a) ? A : dead(e.b) ? B : '';
      return gone ? fail(`${A}欲与${B}结盟,然${gone}已亡`, `那一年${gone}已亡`) : done(`${A}与${B}结盟${until}`);
    }
    case 'declare': {
      if (!B) return fail(`${A}欲伐他国,然其国不存`, '对方在新历史里没有(或那一年还没立国)');
      // 盟国、宗藩、同一宗主的藩属之间:宣战前先记了盟约断了(unally)/ 一方不再称臣(defect),战争记在它后面
      const cut = next();
      const tie =
        !!cut &&
        ((cut.kind === 'unally' && ((cut.a === e.a && cut.b === e.b) || (cut.a === e.b && cut.b === e.a))) ||
          (cut.kind === 'defect' && (cut.a === e.a || cut.a === e.b)));
      const n = tie ? next(2) : cut;
      if (n && n.kind === 'war' && n.a === e.a && n.b === e.b) return done(`${A}向${B}宣战`);
      if (dead(e.a)) return fail(`欲令${A}伐${B},然${A}已亡`, `那一年${A}已亡`);
      if (dead(e.b)) return fail(`${A}欲伐${B},然${B}已亡`, `那一年${B}已亡`);
      if (atWarBefore(civ, e.a, e.b, id)) return fail(`${A}欲伐${B},然两国已在交战`, '两国那时已在交战');
      return fail(`${A}欲伐${B},然两国不接壤,未能成行`, '两国那时不接壤');
    }
    case 'cede': {
      if (e.region < 0) return fail(`欲以某州划归${A},然无此州`, NO_REGION);
      if (e.b === -2) return fail(`欲以${R}划归${A},然其地无人居住`, `那一年${R}没人住`);
      if (dead(e.a)) return fail(`欲以${R}划归${A},然${A}已亡`, `那一年${A}已亡`);
      const forever = v.permanent ? `,永为${A}之土` : '';
      if (e.b === e.a) return done(`${R}本属${A}${v.permanent ? `,自此永为${A}之土` : ''}`);
      return done(`${R}${e.b >= 0 ? `自${B}` : ''}划归${A}${forever}`);
    }
    case 'found': {
      if (e.a < 0 && e.region < 0) return fail('欲于某州立国,然无此州', NO_REGION);
      if (e.a < 0) {
        // 住不了人的州(海边冰原、大片荒漠……)立不成;住得了人的没人住时会有新民族来落脚,只有那州沉了这类意外才立不成
        const seat = civ.regions.seat[e.region];
        if (seat !== undefined && civ.habitat.suitability[seat] < HABITABLE_SUIT) return fail(`欲于${R}立国,然其地不可居`, `${R}住不了人`);
        return fail(`欲于${R}立国,然其地无人居住`, `那一年${R}没人住`);
      }
      const city = cityName(civ, e.settlement);
      const built = civ.settlements[e.settlement]?.founded === y;
      const seat = city ? (built ? `,筑${city}为都` : `,都于${city}`) : '';
      // 州里本来没人住:备好的新民族这一刻来落脚(cultures.ts 的 pioneerArrives)
      const cu = civ.cultures[civ.polities[e.a]?.culture ?? -1];
      if (cu && cu.pioneer === e.war && cu.hearth === e.region && cu.born === y) return done(`${R}本无人居,${cu.name}人徙居于此,立国,号${A}${seat}`);
      return done(e.b >= 0 ? `${R}脱${B}自立,号${A}${seat}` : `${R}立国,号${A}${seat}`);
    }
    case 'crown': {
      const who = authorName(civ, v.char);
      if (e.b === -3) return fail(`欲立${who}为${A}之主,然${A}已亡`, `那一年${A}已亡`);
      if (e.b === -2) return fail(`欲立${who}为${A}之主,然其人尚未出生`, `他第 ${v.born} 年才出生`);
      // 等在位的那位下台再即位:登记的这一条(真即位另记一条 b = −1,interventionOutcome 先找它)
      if (e.b === IV_WAIT) return waitStory(civ, e, who, A, fail, done);
      // 同一刻后面又给这国立了作者的人物(哪怕是同一个人):后立的顶替先立的(rulers.ts),先立的那条算没即位
      for (let k = id + 1; k < civ.annals.length && civ.annals[k].year === y; k++) {
        const n = civ.annals[k];
        if (n.kind === 'intervene' && n.a === e.a && n.b === -1 && civ.interventions?.[n.war]?.kind === 'crown') return fail(`欲立${who}为${A}之主,然同时又另立他人`, '同一年又给这国立了别的人物');
      }
      return done(`${who}即${A}君位`);
    }
    case 'policy': {
      if (e.b === -3) return fail(`欲定${A}方针,然${A}已亡`, `那一年${A}已亡`);
      if (emptyPolicy(v)) return done(`${A}罢方针,凡事听君主`);
      return done(`${A}${hadPolicy(civ, e, id) ? '改定' : '定'}方针${policyTail(civ, v, y)}`);
    }
    case 'destroy': {
      if (e.b === -3) return fail(`欲灭${A},然${A}已亡`, `那一年${A}已亡`);
      if (e.b === IV_PROTECTED) return fail(`欲灭${A},然又有令保${A}不亡`, `那一年${A}受后下的「保护」护着`);
      const n = e.n ? `${cnNumber(e.n)}州` : '其地';
      return done(e.b >= 0 ? `${A}亡,${n}并入${B}` : `${A}亡,${n}散为无主之地`);
    }
    case 'death':
    case 'temper':
      return personStory(civ, e, v, A, fail, done);
    case 'disaster':
      return disasterStory(civ, e, v, A, R, fail, done);
    case 'move': {
      const city = cityName(civ, e.settlement);
      if (!city) return fail(`${A}欲迁都,然其城尚未建起`, '那一年还没有这座城');
      if (dead(e.a)) return fail(`欲令${A}迁都${city},然${A}已亡`, `那一年${A}已亡`);
      if (e.b === -2) return fail(`${A}欲迁都${city},然${city}已毁`, `那一年${city}已毁`);
      if (e.b !== e.a) {
        return e.b >= 0
          ? fail(`${A}欲迁都${city},然${city}属${B}`, `${city}那时属${B},不在本国国土里`)
          : fail(`${A}欲迁都${city},然${city}不在${A}境内`, `${city}那时不在本国国土里`);
      }
      const n = next();
      if (!(n && n.kind === 'capital' && n.a === e.a && n.war < 0)) return done(`${city}本为${A}国都`);
      const p = polityOf(civ, e.a);
      const old = p ? cityName(civ, capitalBefore(p, y)) : '';
      return done(`${A}${old && old !== city ? `自${old}` : ''}迁都${city}`);
    }
    default:
      return done(A);
  }
}

type Say = (text: string, why: string) => IvStory;
type Done = (text: string) => IvStory;

/** 作者让他去世 / 改过倾向的那个人(人物里按 killed、moods 记着第几条干预) */
function personOfIv(civ: Civ, iv: number, kind: 'death' | 'temper'): Person | undefined {
  return civ.people?.find((x) => (kind === 'death' ? x.killed === iv : x.moods?.some((m) => m.iv === iv)));
}

/** 被作者让他去世的君主"卒"怎么写:"暴崩""暴薨""暴卒""猝然驾崩"(同君主继位那一条的崩 / 薨 / 卒 / 驾崩) */
function suddenDeath(civ: Civ, x: Person, y: Year): string {
  const p = polityOf(civ, x.polity);
  if (!p) return '暴卒';
  const [died] = deathWord(p, Math.max(0, polityTierAt(p, y - 1 / 512)));
  return died.length > 1 ? `猝然${died}` : `暴${died}`;
}

/** 改过的倾向里变得最多的那一样(差 10 以上):",自此厌兵"",自此好开边"……;都没怎么变 = 空串 */
function temperWord(from: Person['leanings'], to: NonNullable<Person['leanings']>): string {
  if (!from) return '';
  const words = { war: ['厌兵', '喜兵'], expand: ['安于守土', '好开边'], trade: ['轻商贾', '重商贾'], develop: ['怠于政事', '勤于政事'] } as const;
  let best: keyof typeof words | null = null;
  let most = 9;
  for (const k of ['war', 'expand', 'trade', 'develop'] as const) {
    const d = Math.abs(to[k] - from[k]);
    if (d > most) {
      most = d;
      best = k;
    }
  }
  return best ? `,自此${words[best][to[best] > from[best] ? 1 : 0]}` : '';
}

/**
 * 让人物去世 / 改君主倾向:"【干预】大澜皇帝燕溟暴崩,在位十一年""【干预】大澜将燕鸾澈卒""【干预】有桑丞相鸿丘卒"
 * "【干预】大澜皇帝燕溟性情大变,自此厌兵";没生效的写原因
 */
function personStory(civ: Civ, e: Annal, v: Extract<Intervention, { kind: 'death' | 'temper' }>, A: string, fail: Say, done: Done): IvStory {
  const y = e.year;
  const die = v.kind === 'death';
  const verb = die ? '令其卒' : '改其性情';
  const want = parsePersonKey(v.person)?.name || '其人';
  if (e.b === -3) return fail(`欲${verb},然${A}已亡`, `那一年${A}已亡`);
  const x = personOfIv(civ, e.war, v.kind);
  if (x && (e.b === -1 || e.b === IV_PEOPLE)) {
    if (!die) return done(`${rulerRef(civ, x, y)}性情大变${temperWord(x.leanings, v.leanings)}`);
    if (x.role === 'ruler') {
      const years = Math.floor(y) - Math.floor(x.from ?? y);
      return done(`${rulerRef(civ, x, y)}${suddenDeath(civ, x, y)}${years >= 1 ? `,在位${cnNumber(years)}年` : ',即位当年'}`);
    }
    return done(`${x.role === 'general' ? generalRef(civ, x, y) : `${ministerRole(civ, x)}${x.name}`}卒`);
  }
  // 没生效:按人物键找回这个人,说他那时在不在
  const id = resolvePersonKey(civ, v.person);
  const who = id >= 0 ? civ.people![id] : undefined;
  if (!who) return fail(`欲${verb}于${want},然新史无此人`, '新历史里没有这个人');
  if (who.died !== undefined && who.died <= y) return fail(`欲${verb}于${who.name},然其人已卒`, `第 ${Math.floor(who.died)} 年他已卒`);
  if (who.role === 'ruler' || e.b === IV_NOT_HIM) {
    if ((who.from ?? Infinity) > y) return fail(`欲${verb}于${who.name},然其人尚未即位`, who.from !== undefined ? `他第 ${Math.floor(who.from)} 年才即位` : '他没有即位');
    if (who.until !== undefined && who.until <= y) return fail(`欲${verb}于${who.name},然其人已不在位`, `第 ${Math.floor(who.until)} 年他已不在位`);
    return fail(`欲${verb}于${who.name},然其时在位者非其人`, '那一年在位的不是他');
  }
  const from = who.role === 'general' ? who.commands?.[0]?.from : who.from;
  const step = who.role === 'general' ? '领兵' : '入仕';
  if (who.role === 'minister' && who.until !== undefined && who.until <= y) return fail(`欲${verb}于${who.name},然其人已去职`, `第 ${Math.floor(who.until)} 年他已去职`);
  if (from === undefined || from >= y) return fail(`欲${verb}于${who.name},然其人尚未出仕`, from !== undefined ? `他第 ${Math.floor(from)} 年才${step}` : `他那时还没${step}`);
  return fail(`欲${verb}于${who.name},未成`, '没有生效');
}

/** 即位(等在位的那位下台)登记的那一条:还在等 = 照登记写;落空(没等到他下台就改朝换代、亡国、另立了别人)= 写原因 */
function waitStory(civ: Civ, e: Annal, who: string, A: string, fail: Say, done: Done): IvStory {
  const y = e.year;
  const cur = civ.people?.find((x) => x.role === 'ruler' && x.polity === e.a && (x.from ?? Infinity) <= y && (x.until === undefined || x.until > y));
  const curName = cur ? rulerShort(civ, cur) : '在位之君';
  if (!cur || cur.until === undefined) return done(`${who}待${curName}之后即${A}君位`);
  const p = polityOf(civ, e.a);
  if (p?.ended !== undefined && p.ended <= cur.until) return fail(`欲立${who}继${curName}为${A}之主,然${A}已亡`, `那一年${A}已亡`);
  const how = cur.fate === 'deposed' || cur.fate === 'overthrown' ? '被废(改朝换代)' : cur.fate === 'yielded' ? '让位' : '下台';
  return fail(`欲立${who}继${curName}为${A}之主,然${curName}${how},未及即位`, `${curName} ${Math.floor(cur.until)} 年${how},没等到他下台`);
}

/** 天灾:"【干预】星邑大疫,死者十之五""【干预】有桑皇朝大饥,民多饿死,死者十之三""【干预】翼门之野一带地震,城郭多圮,死者十之三" */
function disasterStory(civ: Civ, e: Annal, v: Extract<Intervention, { kind: 'disaster' }>, A: string, R: string, fail: Say, done: Done): IvStory {
  const toll = IV_TOLL[v.level];
  if (v.type === 'pandemic') {
    // 全球大疫:传到哪、死多少另有一条(pandemicEntries)
    const city = cityName(civ, e.settlement) || R;
    if (e.b <= 0) return fail(`欲令${city}起大疫,然其城已不在`, `那一年${city}已毁`);
    return done(`${A}${city}起大疫,疫后无人收拾${cnNumber(v.slump ?? SLUMP_DEFAULT)}年`);
  }
  if (v.type === 'plague') {
    const city = cityName(civ, e.settlement) || R;
    if (e.b <= 0) return fail(`欲降疫于${city},然其城已不在`, `那一年${city}已毁`);
    if (e.b === 2) return done(`${city}疫势转烈,死者${toll}`);
    return done(`${A}${city}大疫,死者${toll}`);
  }
  if (v.type === 'famine') {
    if (e.b <= 0) return v.a && A ? fail(`欲令${A}大饥,然${A}已亡`, `那一年${A}已亡`) : fail('欲降饥荒,然其地无人居住', '那一带那年没人住');
    if (v.a) return done(`${A}大饥,民多饿死,死者${toll}`);
    const where = e.b > 1 ? `${R}等${cnNumber(e.b)}州` : R;
    return done(`${where}大饥,民多饿死,死者${toll}`);
  }
  const word = e.region >= 0 ? quakeWord(civ.regions, e.region) : '地震';
  const what = word === '大水' ? '大水,漂没城郭' : word === '大旱' ? '大旱,赤地千里' : '地震,城郭多圮';
  if (e.b <= 0) return fail(`欲令${R}一带${word},然其地无人居住`, '那一带那年没人住');
  return done(`${R}一带${what}${e.b > 1 ? `,${cnNumber(e.b)}州受灾` : ''},死者${toll}`);
}

/** 这条方针之前这国已经照着别的方针(生效了、不是罢方针的):编年史写"改定方针" */
function hadPolicy(civ: Civ, e: Annal, id: number): boolean {
  for (let k = id - 1; k >= 0; k--) {
    const n = civ.annals[k];
    if (n.kind !== 'intervene' || n.a !== e.a || n.b !== -1) continue;
    const v = civ.interventions?.[n.war];
    if (v?.kind === 'policy') return !emptyPolicy(v);
  }
  return false;
}

/** 方针在编年史里的后半句:":扩张(细调过),仇莱尼多尔王国,亲温兹汗国"(没定名字、只挑了亲仇的不写名字;旋钮的数不写) */
function policyTail(civ: Civ, v: PolicyIv, y: Year): string {
  const name = policyName(v);
  const who = (keys: readonly string[] | undefined) =>
    (keys ?? [])
      .map((k) => {
        const r = resolveKey(civ, k);
        return r?.kind === 'polity' ? pn(civ, r.id, y) : '';
      })
      .filter(Boolean)
      .join('、');
  const parts = [name, who(v.foes) && `仇${who(v.foes)}`, who(v.friends) && `亲${who(v.friends)}`].filter(Boolean);
  return parts.length ? `:${parts.join(',')}` : '';
}

/**
 * 作者的人物叫什么:套过人物卡的历史(gen/characters.ts 的 applyCharacters)里有名字(Civ.authorNames,或他即位后的人物);
 * 没套过 = "作者的人物"
 */
function authorName(civ: Civ, char: number): string {
  return civ.authorNames?.[char] || civ.people?.find((x) => x.author === char && x.name)?.name || '作者的人物';
}

/** 干预"即位"立的那位君主(作者的人物;第 e 条史事那一刻在国家 e.a 即位的) */
function crownedAt(ix: PeopleIndex | null, e: Annal, char: number): Person | null {
  // 前一位被作者让他去世、等着的作者人物接位的:即位那一刻的下一刻才记史事
  return ix?.rulers[e.a]?.find((x) => x.author === char && x.from !== undefined && e.year - x.from >= 0 && e.year - x.from <= 1 / 256) ?? null;
}

/** 第 i 条史事是照大纲硬改的划州、生效了:同一条情节、同一刻、划给同一国的并成一条用的键(不是 = '') */
function plotCedeKey(civ: Civ, i: number): string {
  const e = civ.annals[i];
  if (!e || e.kind !== 'intervene') return '';
  const v = civ.interventions?.[e.war];
  if (v?.kind !== 'cede' || v.plot === undefined || !interveneStory(civ, e, i).ok) return '';
  return `${v.plot}|${e.a}|${e.year}`;
}

/** 从第 i 条起接连几条照大纲划给同一国的州(第 i 条不是 = []) */
function plotCedeRun(civ: Civ, i: number): number[] {
  const k = plotCedeKey(civ, i);
  if (!k) return [];
  const out = [i];
  while (plotCedeKey(civ, out[out.length - 1] + 1) === k) out.push(out[out.length - 1] + 1);
  return out;
}

/**
 * 这条史事(立国的 found、迁都的 capital、灭国的 fall、天灾引起的饥荒 famine)是紧跟在干预后面、由它引起的:
 * 编年史并进干预那一条,不另列(天灾的饥荒一国一条,接连几条都算)
 */
function foldedIntoIntervene(civ: Civ, i: number): boolean {
  const e = civ.annals[i];
  let j = i - 1;
  if (e.kind === 'famine') while (j >= 0 && civ.annals[j].kind === 'famine' && civ.annals[j].year === e.year) j--;
  const d = civ.annals[j];
  if (!d || d.kind !== 'intervene' || d.year !== e.year) return false;
  const v = civ.interventions?.[d.war];
  if (e.kind === 'famine') return v?.kind === 'disaster' && v.type !== 'plague';
  if (d.a !== e.a) return false;
  const kind = v?.kind;
  return (e.kind === 'found' && kind === 'found') || (e.kind === 'capital' && e.war < 0 && kind === 'move') || (e.kind === 'fall' && kind === 'destroy');
}

/**
 * 第 i 条干预(Civ.interventions 的下标)在这份历史里的结果(界面上的干预列表用):
 * annal = 它那条史事 intervene 的下标(没记 = −1:国家键指不到,原因由调用方按键说);ok = 生效了;why = 没生效的原因
 */
export function interventionOutcome(civ: Civ, i: number): { annal: number; ok: boolean; why?: string } {
  const A = civ.annals;
  for (let k = 0; k < A.length; k++) {
    if (A[k].kind !== 'intervene' || A[k].war !== i) continue;
    // 等在位的那位下台再即位:真即位了看即位那一条(同一条干预后记的 b = −1)
    if (A[k].b === IV_WAIT) {
      for (let j = k + 1; j < A.length; j++) if (A[j].kind === 'intervene' && A[j].war === i && A[j].b === -1) return { annal: j, ok: true };
    }
    const r = interveneStory(civ, A[k], k);
    return { annal: k, ok: r.ok, why: r.why };
  }
  return { annal: -1, ok: false };
}

/**
 * 宣战:"大渭起兵伐昌国"(援盟:"索拉特应大昌之约,起兵伐某国");有人物的写双方统帅:
 * "大渭以李牧为将,起兵伐昌国;昌国遣王翦拒之" / "大渭太宗亲征昌国;昌庄王亲自领兵拒之"
 */
/**
 * 战争那一条的开头(写开战的由头):"大渭欲复故土,伐昌国""大渭乘昌国与索拉特交兵,伐之""大渭欲并昌国,举兵伐之"
 * "大渭与昌国争边,起兵伐之""大渭背盟伐昌国""大渭兴兵讨昌国"(讨伐自立的藩属)"大渭应大昌之约伐昌国""大渭救其藩属瑞国,伐昌国";
 * 有统帅的写"遣李牧伐之""遣李牧讨昌国"。没记由头的(干预的强制宣战)写"大渭伐昌国"
 */
function warHead(civ: Civ, e: Annal, id: number, general: string): string {
  const y = e.year;
  const A = pn(civ, e.a, y);
  const B = pn(civ, e.b, y);
  const ally = e.settlement >= 0 ? pn(civ, e.settlement, y) : '';
  const go = (who: string) => (general ? `遣${general}伐${who}` : `伐${who}`);
  switch (e.cause) {
    case 'claim':
      return `${A}${claimText(civ, e, id)},${go(B)}`;
    case 'chaos': {
      const why = troubleOf(civ, e.b, id, e.a);
      return `${A}乘${B}${why || '之乱'},${go('之')}`;
    }
    case 'resource':
      return `${A}${covetText(civ, e)},${general ? `遣${general}伐之` : '起兵伐之'}`;
    case 'prey':
      return `${A}欲并${B},${general ? `遣${general}伐之` : '举兵伐之'}`;
    case 'expand':
      return `${A}与${B}争边,${general ? `遣${general}伐之` : '起兵伐之'}`;
    case 'betray':
      return general ? `${A}背盟,遣${general}伐${B}` : `${A}背盟伐${B}`;
    case 'punish':
      return `${A}以${B}绝贡,${general ? `遣${general}讨之` : '兴兵讨之'}`;
    case 'quell':
    case 'heir':
      return general ? `${A}遣${general}讨${B}` : `${A}发兵讨${B}`;
    case 'rescue':
      return ally ? `${A}救其藩属${ally},${go(B)}` : `${A}${go(B)}`;
    default:
      if (ally) return general ? `${A}应${ally}之约,遣${general}伐${B}` : `${A}应${ally}之约伐${B}`;
      return general ? `${A}遣${general}伐${B}` : `${A}伐${B}`;
  }
}

/**
 * 宣战的由头(史事 war 的 cause),写在"起兵伐某国"前面:"欲复故土,""乘昌国与索拉特交兵,""欲并昌国,""与昌国争边,"
 * "背盟,""应大昌之约,""救其藩属昌国,";讨伐自立的藩属不写由头,动词换成"讨"(见 warVerb)。干预的强制宣战、没记由头的 = 空串
 */
function warReason(civ: Civ, e: Annal, id: number): string {
  const y = e.year;
  const B = pn(civ, e.b, y);
  const ally = e.settlement >= 0 ? pn(civ, e.settlement, y) : '';
  switch (e.cause) {
    case 'claim':
      return `${claimText(civ, e, id)},`;
    case 'punish':
      return `以${pn(civ, e.b, e.year)}绝贡,`;
    case 'chaos': {
      const why = troubleOf(civ, e.b, id, e.a);
      return why ? `乘${B}${why},` : `乘${B}之乱,`;
    }
    case 'resource':
      return `${covetText(civ, e)},`;
    case 'prey':
      return `欲并${B},`;
    case 'expand':
      return `与${B}争边,`;
    case 'betray':
      return '背盟,';
    case 'rescue':
      return ally ? `救其藩属${ally},` : '';
    default:
      // 援盟(自然结成的盟约、阶段 4 干预的结盟):settlement 列是盟国,不是城
      return ally ? `应${ally}之约,` : '';
  }
}

/**
 * 史事数组的索引:"第 id 条史事之前"的几种查询(收复故土想夺回哪几州、某国此刻在和谁交战)不用每次从头翻一遍史事。
 * 从头翻的话,历史越长、要查的战争越多,两样一乘,几万年的历史要算好几秒。
 * 按史事数组记(套改名、沿用州出来的新对象共用同一个数组);数组长度变了就重建
 */
interface AnnalIndex {
  n: number;
  /** 有州的攻占(conquer):史事的 a(拿去的一方)→ b(丢掉的一方)→ 下标(从小到大) */
  conquer: Map<number, Map<number, number[]>>;
  /** 有州的攻占:下标 → 同一州下一次攻占的下标(没有 = Infinity) */
  nextConquer: Map<number, number>;
  /** 每国(含 −1)相关的开战、议和,按下标从小到大:[下标, 战争编号, 对手(议和 = NaN)] 三个一组 */
  wars: Map<number, number[]>;
}

const annalIndexCache = new WeakMap<readonly Annal[], AnnalIndex>();

function annalIndex(A: readonly Annal[]): AnnalIndex {
  const hit = annalIndexCache.get(A);
  if (hit && hit.n === A.length) return hit;
  const conquer = new Map<number, Map<number, number[]>>();
  const nextConquer = new Map<number, number>();
  const lastAt = new Map<number, number>();
  const wars = new Map<number, number[]>();
  /** 战争编号 → 打过这场仗的国(到这一条为止) */
  const sides = new Map<number, number[]>();
  const push = (p: number, i: number, war: number, foe: number) => {
    let l = wars.get(p);
    if (!l) wars.set(p, (l = []));
    l.push(i, war, foe);
  };
  for (let i = 0; i < A.length; i++) {
    const e = A[i];
    if (e.kind === 'conquer' && e.region >= 0) {
      let byB = conquer.get(e.a);
      if (!byB) conquer.set(e.a, (byB = new Map()));
      let l = byB.get(e.b);
      if (!l) byB.set(e.b, (l = []));
      l.push(i);
      const prev = lastAt.get(e.region);
      if (prev !== undefined) nextConquer.set(prev, i);
      nextConquer.set(i, Infinity);
      lastAt.set(e.region, i);
    } else if (e.kind === 'war') {
      push(e.a, i, e.war, e.b);
      if (e.b !== e.a) push(e.b, i, e.war, e.a);
      let s = sides.get(e.war);
      if (!s) sides.set(e.war, (s = []));
      if (!s.includes(e.a)) s.push(e.a);
      if (!s.includes(e.b)) s.push(e.b);
    } else if (e.kind === 'peace') {
      for (const p of sides.get(e.war) ?? []) push(p, i, e.war, NaN);
    }
  }
  const ix = { n: A.length, conquer, nextConquer, wars };
  annalIndexCache.set(A, ix);
  return ix;
}

/**
 * 收复故土的战争想夺回哪几州:开战前(第 id 条史事之前)最近一次易手是"守方从攻方手里拿去"的州
 * (攻占、议和割让都记成 conquer),开战那一年还在守方手里(后来分裂、被并、划走的不算),按人口上限从大到小。导出给测试核对索引
 */
export function claimsOf(civ: Civ, atk: number, def: number, id: number, year: Year): number[] {
  const A = civ.annals;
  const ix = annalIndex(A);
  const end = Math.min(id, A.length);
  const out: number[] = [];
  // 守方从攻方手里拿去的那几次里,是那一州在开战前最后一次易手的
  const list = ix.conquer.get(def)?.get(atk);
  if (list) {
    let own: Int16Array | null = null;
    for (const i of list) {
      if (i >= end) break;
      if (ix.nextConquer.get(i)! < end) continue;
      own ??= ownersAt(civ, year).polity;
      if (own[A[i].region] === def) out.push(A[i].region);
    }
  }
  const cap = civ.regions.capacity;
  return out.sort((a, b) => cap[b] - cap[a] || a - b);
}

/** 收复故土:"欲夺回瑞州" / "欲复瑞州等故地";从史事里找不到是哪几州的写"欲复故土" */
function claimText(civ: Civ, e: Annal, id: number): string {
  const rs = claimsOf(civ, e.a, e.b, id, e.year);
  const r = rs.length ? regionName(civ, rs[0]) : '';
  if (!r) return '欲复故土';
  return rs.length === 1 ? `欲夺回${r}` : `欲复${r}等故地`;
}

/** 宣战的动词:讨伐自立的藩属、起事的饥民写"讨",别的写"伐" */
const warVerb = (e: Annal) => (e.cause === 'punish' || e.cause === 'quell' || e.cause === 'heir' ? '讨' : '伐');

/** 由头里点了守方的名("以昌国绝贡,"、"乘昌国与索拉特交兵,"、"欲并昌国,"、"与昌国争边,"),后面写"伐之" */
const NAMES_FOE: ReadonlySet<AnnalCause> = new Set<AnnalCause>(['punish', 'chaos', 'prey', 'expand', 'resource']);

/** 为夺物产开战时写的字(下标同 development.ts 的 RESOURCES:粮、牲畜、铜锡、铁、煤、木材、盐、渔获、石油、稀有矿、金银),先后照这里 */
const COVET_WORD = ['粮', '马', '铜', '铁', '煤', '木', '盐', '渔', '油', '矿', '金'];
const COVET_ORDER = [6, 3, 2, 1, 4, 8, 9, 10, 0, 5, 7];

/** 为夺物产的由头:"欲夺昌国瑞州之铁""欲夺昌国瑞州之盐铁""欲夺昌国瑞州之铜与马";州名查不到写"欲得昌国之铁" */
function covetText(civ: Civ, e: Annal): string {
  const B = pn(civ, e.b, e.year);
  const ks = COVET_ORDER.filter((k) => (e.n ?? 0) & (1 << k));
  const what = ks.length === 2 && ks[0] === 6 && ks[1] === 3 ? '盐铁' : ks.length ? ks.map((k) => COVET_WORD[k]).join('与') : '地';
  const r = regionName(civ, e.region);
  return r ? `欲夺${B}${r}之${what}` : `欲得${B}之${what}`;
}

function declareEntry(ctx: Ctx, e: Annal, id: number): ChronicleEntry {
  const { civ, ix } = ctx;
  const y = e.year;
  const A = pn(civ, e.a, y);
  const B = pn(civ, e.b, y);
  // 援盟、救藩:settlement 列是援的那一国,不是城
  const ally = e.settlement >= 0 ? e.settlement : -1;
  const pact = warReason(civ, e, id);
  const v = warVerb(e);
  const ca = commander(ix, e.war, 0, id);
  const cd = commander(ix, e.war, 1, id);
  const to = e.cause && NAMES_FOE.has(e.cause) ? '之' : B;
  let t: string;
  if (ca && reigningAt(ca, y)) t = `${rulerRef(civ, ca, y)}${pact}亲征${to}`;
  else if (ca) t = `${A}${pact}以${leaderName(civ, ca, y)}为将,起兵${v}${to}`;
  else t = `${A}${pact}起兵${v}${to}`;
  if (cd && reigningAt(cd, y)) t += `;${rulerRef(civ, cd, y)}亲自领兵拒之`;
  else if (cd) t += `;${B}遣${leaderName(civ, cd, y)}拒之`;
  const x = base(e, id, t, 2, ally >= 0 ? [e.a, e.b, ally] : [e.a, e.b], []);
  if (ally >= 0) x.settlement = -1;
  return withPeople(x, ca, cd);
}

function simpleEntry(ctx: Ctx, e: Annal, id: number): ChronicleEntry {
  const { civ } = ctx;
  const y = e.year;
  switch (e.kind) {
    case 'found': {
      const city = cityName(civ, e.settlement);
      const where = city || regionName(civ, e.region);
      // 大国立国是大事;后来没长成大国的(小国、部落)只在"全部"里
      const imp = isGreat(polityOf(civ, e.a)) ? 3 : 2;
      // 有人物的写开国之君:"李昭建大昌,都于汾城"
      const who = founderOf(ctx.ix, e.a, 0);
      let head = who?.rise === 'found' ? `${who.name}建${pn(civ, e.a, y)}` : `${pn(civ, e.a, y)}立国`;
      // 边缘立国:受邻近强国影响提早立的国("受大昌影响,李昭建平国")
      const mentor = e.b >= 0 && polityOf(civ, e.a)?.mentor === e.b ? e.b : -1;
      if (mentor >= 0) head = `受${pn(civ, mentor, y)}影响,${head}`;
      return withPeople(base(e, id, `${head}${where ? `,都于${where}` : ''}`, imp, mentor >= 0 ? [e.a, mentor] : [e.a], [e.region]), who?.rise === 'found' ? who : null);
    }
    case 'rank':
      return rankEntry(ctx, e, id);
    case 'war':
      return declareEntry(ctx, e, id);
    case 'conquer':
      return base(e, id, conquerText(civ, e, undefined, ctx.retake.has(id)), e.b >= 0 ? 2 : 1, [e.a, e.b], [e.region]);
    case 'peace': {
      const head = peaceHead(civ, ctx.ix, e, id, y);
      return withPeople(base(e, id, head.text, 2, [e.a, e.b], []), ...head.people);
    }
    case 'fall':
      // 民变被讨平:"大渭讨平瑞国"(标签"平")
      if (e.war >= 0 && ctx.quell.get(e.war) === e.a && e.b >= 0) return base(e, id, `${pn(civ, e.b, y)}讨平${pn(civ, e.a, y)}`, 2, [e.a, e.b], [e.region], '平');
      // 亡于战争的,"大事"里由那场战争说("…,昌国亡");不在战争里土崩瓦解的,大国是大事,小国、部落是小事
      const last = endedAt(ctx.ix, e.a, y);
      return withPeople(base(e, id, fallText(civ, e, last), e.war < 0 && isGreat(polityOf(civ, e.a)) ? 3 : 2, [e.a, e.b], [e.region]), last);
    case 'capital': {
      // 主动迁都(被迫迁都折进战争,见 warEntry):帝国级的是大事
      const p = polityOf(civ, e.a);
      const old = p ? cityName(civ, capitalBefore(p, y)) : '';
      const now = cityName(civ, e.settlement) || regionName(civ, e.region);
      const text = now
        ? `${pn(civ, e.a, y)}${old && old !== now ? `自${old}` : ''}迁都${now}`
        : `${pn(civ, e.a, y)}迁都`;
      return base(e, id, text, p && polityTierAt(p, y) >= CAPITAL_TIER ? 3 : 2, [e.a], [e.region]);
    }
    case 'split': {
      const A = pn(civ, e.a, y);
      const r = regionName(civ, e.region);
      const P = polityOf(civ, e.a);
      const fallen = polityOf(civ, P?.restores ?? -1);
      // 有人物的写起事的人:叛离自立的守将(西幻:领主)、复国的故国宗室(西幻:王室之后;故国是共和国的:旧臣)
      const lead = founderOf(ctx.ix, e.a, 0);
      const who = lead && (lead.rise === 'rebel' || lead.rise === 'restore') ? lead : null;
      let t: string;
      const X = e.cause === 'heir' && who?.claim?.how === 'secede' ? civ.people?.[who.claim.rivals[0]] : undefined;
      if (e.cause === 'heir') {
        // 宗室争位、据地自立:"大昌先君之子李昭不服其弟李恒即位,据瑞州起兵自立,号昭国"(先君的儿子没对上的:"大昌宗室李昭不服新君李恒即位,…")
        const kin = who && X && who.parent !== undefined ? kinOf(civ, who, X) : '';
        const head = who ? `${pn(civ, e.b, y)}${who.parent !== undefined ? '先君之子' : '宗室'}${who.name}` : `${pn(civ, e.b, y)}宗室`;
        const rival = X ? `${kin ? `其${kin}` : '新君'}${X.name}` : '新君';
        t = `${head}不服${rival}即位,${r ? `据${r}` : ''}起兵自立,号${A}`;
      } else if (fallen) {
        // 复国:"故昌遗民据瑞州起兵,脱大渭复国,号后昌国"("故昌宗室李昭据瑞州起兵,…")
        // 故国改朝换代过的,称它亡国时那一朝的国号("故景遗民")
        const folk = who ? `${fallen.lineage === 'republic' ? '旧臣' : P?.eastern ? '宗室' : '王室之后'}${who.name}` : '遗民';
        const head = `故${(fallen.name && polityRootAt(fallen, fallen.ended ?? y)) || '国'}${folk}${r ? `据${r}` : ''}`;
        t = e.b >= 0 ? `${head}起兵,脱${pn(civ, e.b, y)}复国,号${A}` : `${head}复国,号${A}`;
      } else {
        // "瑞州守将李昭叛大渭自立,号瑞国";割据多年以后自立的(control.ts):"割据瑞州的守将李昭叛大渭自立"
        const title = P?.eastern ? '守将' : '领主';
        const lord =
          e.cause === 'warlord' && r ? `割据${r}的${title}${who?.name ?? ''}` : who && r ? `${r}${title}${who.name}` : r;
        if (e.b >= 0) t = r ? `${lord}叛${pn(civ, e.b, y)}自立,号${A}` : `${A}脱离${pn(civ, e.b, y)}自立`;
        else t = r ? `${lord}自立,号${A}` : `${A}自立`;
      }
      const city = cityName(civ, e.settlement);
      if (city) t += `,都于${city}`;
      // 分出来(复国)以后长成大国的、复的是大国的是大事;小国分分合合只在"全部"里
      // (日后在"大事"里出现时,名字后面带一句来历,见 introduce)
      const imp = isGreat(polityOf(civ, e.a)) ? 3 : 2;
      return withPeople(base(e, id, t, imp, [e.a, e.b], [e.region], fallen ? '复' : '分'), r || fallen || e.cause === 'heir' ? who : null, X ?? null);
    }
    case 'famine':
      return base(e, id, famineText(civ, e), 2, [e.a], [e.region]);
    case 'warlord':
    case 'reclaim':
    case 'defy':
      return base(e, id, lordText(civ, e), 2, e.kind === 'defy' ? [e.a, e.b] : [e.a], [e.region]);
    case 'fiscal': {
      const foes = foesAt(civ, e.a, y);
      // 说法里点了名的交战国才算这条也和它有关
      return base(e, id, fiscalText(civ, e, foes), 2, e.war !== 0 && foes.length ? [e.a, foes[0]] : [e.a], [e.region]);
    }
    case 'council': {
      // 大国办成的改制是大事;搁置、谈崩(后面紧跟着割据、自立那一条)和小国的只在"全部"里。
      // 第二批里只有脱离转投(国土易手)算大事;改军制、改官制、分镇只在"全部"里(大国一个种子十来次,放进大事时间轴就挤了)
      const who = reigning(ctx.ix, e.a, y);
      const imp = e.n === 0 && (e.war <= 4 || e.war === 10) && isGreat(polityOf(civ, e.a)) ? 3 : 2;
      const t = councilText(civ, e, id, who);
      // 搁置的几种写法不写君主
      const named = who && (t.includes(who.name) || (!!who.title && t.includes(who.title)));
      // 脱离:b = 想转投的邻国
      return withPeople(base(e, id, t, imp, e.b >= 0 ? [e.a, e.b] : [e.a], [e.region]), named ? who : null);
    }
    case 'merge': {
      // 并掉的是大国才是大事
      // 藩属纳土归附宗主(diplomacy.ts)
      const t = e.b < 0 ? `${pn(civ, e.a, y)}并吞邻邦` : e.cause === 'vassal' ? `${pn(civ, e.b, y)}纳土归附${pn(civ, e.a, y)}` : `${pn(civ, e.b, y)}并入${pn(civ, e.a, y)}`;
      return base(e, id, t, isGreat(polityOf(civ, e.b)) ? 3 : 2, [e.a, e.b], []);
    }
    case 'dynasty': {
      // 东方帝国级的国家改朝换代(换国号,地图上的国名跟着变)是大事;西幻的王室更迭国名不变,小一些的国家的也不算
      // (换了的国号日后在"大事"里出现时带一句"原某国",见 introduce)
      const p = polityOf(civ, e.a);
      // 掌实权的名臣、大臣篡位(紧挨在前面的那条 regent,n = 3):写成篡位,是大事
      const pre = civ.annals[id - 1];
      const usurped = !!pre && pre.kind === 'regent' && pre.n === RG_USURP && pre.a === e.a && pre.year === e.year;
      const imp = p && p.eastern && polityTierAt(p, y) >= DYNASTY_TIER ? 3 : 2;
      const i = p ? Math.max(1, dynastyIndexAt(p, y)) : 1;
      const text = dynastyText(civ, e, ctx.ix, usurped);
      // 末代只在权臣篡位时写到("废少帝自立")
      const old = endedAt(ctx.ix, e.a, y);
      const ousted = !!old && /废(幼主|黜)?/.test(text) && (text.includes(old.name) || (!!old.title && text.includes(`废${old.title}`)));
      return withPeople(base(e, id, text, imp, [e.a], [e.region]), ousted ? old : null, founderOf(ctx.ix, e.a, i));
    }
    case 'sack':
      return base(e, id, sackText(civ, e), 2, [e.a, e.b], [e.region]);
    case 'ruin': {
      // 大城(或国都)被毁是大事,"大事"里由那场战争说("…,毁汾城",和亡国一样不重复);城被毁在"全部"里;村镇被毁是小事
      const imp = ruinImportance(civ, e);
      return base(e, id, ruinText(civ, e), e.war >= 0 ? (Math.min(imp, 2) as Importance) : imp, [e.a, e.b], [e.region]);
    }
    case 'rebuild': {
      const old = civ.settlements[e.settlement]?.rebuilds;
      const imp = old !== undefined && civ.settlements[old]?.ended !== undefined && rankBefore(civ, old, civ.settlements[old].ended!) >= 2 ? 2 : 1;
      return base(e, id, rebuildText(civ, e), imp, [e.a], [e.region]);
    }
    case 'decline':
      return base(e, id, declineText(civ, e), 2, [e.a], [e.region]);
    case 'vanish': {
      // 民族消亡:"乌耐族亡,最后的瑞州亦为渭人"
      const r = regionName(civ, e.region);
      const t = e.b >= 0 && r ? `${cn(civ, e.a)}亡,最后的${r}亦为${folk(civ, e.b)}` : `${cn(civ, e.a)}亡`;
      return { ...base(e, id, t, 3, [], [e.region]), settlement: -1 };
    }
    case 'diverge': {
      // 民族分化:"居兰族的一支在瑞州一带渐成一族,称北居兰族" / "大昌治下的居兰人与本族日渐疏远,自成北居兰族"
      const r = regionName(civ, e.region);
      const t =
        e.war >= 0
          ? `${pn(civ, e.war, y)}治下的${folk(civ, e.b)}与本族日渐疏远,自成${cn(civ, e.a)}`
          : `${cn(civ, e.b)}的一支${r ? `在${r}一带` : ''}渐成一族,称${cn(civ, e.a)}`;
      return { ...base(e, id, t, 2, e.war >= 0 ? [e.war] : [], [e.region]), settlement: -1 };
    }
    case 'assimilate':
      return assimChild(civ, e, id);
    case 'migrate':
      return migrateChild(civ, e, id, false);
    case 'upheaval':
      return upheavalEntry(ctx, [id]);
    case 'sunk':
      return base(e, id, sunkText(civ, e, true), 2, [e.a], [e.region]);
    case 'alliance':
    case 'unally':
    case 'submit':
    case 'defect':
      return diplomacyEntry(ctx, e, id);
    case 'intervene': {
      // 照大纲同一刻划给同一国的几州:并成一条
      const run = plotCedeRun(civ, id);
      if (run.length > 1) {
        const rs = run.map((j) => civ.annals[j].region);
        return base(e, id, `【照大纲】${regionNames(civ, rs)}划归${pn(civ, e.a, y)}`, 3, [e.a, ...run.map((j) => civ.annals[j].b)], rs);
      }
      const story = interveneStory(civ, e, id);
      const x = base(e, id, story.text, 3, [e.a, e.b], [e.region]);
      // 干预立的国:立国那条并进了这一条,开国之君也写在这里
      const v = civ.interventions?.[e.war];
      const who = story.ok && v?.kind === 'found' && e.a >= 0 ? founderOf(ctx.ix, e.a, 0) : null;
      // 同一刻接着立了作者的人物为君的,开国之君就是他(写在即位那一条)
      if (who && who.author === undefined) x.text += `,奉${who.name}为主`;
      // 即位:记上作者立的那位君主
      const crowned = story.ok && v?.kind === 'crown' ? crownedAt(ctx.ix, e, v.char) : null;
      return withPeople(x, who && who.author === undefined ? who : null, crowned);
    }
    case 'regent':
      return regentEntry(ctx, id) ?? base(e, id, `${pn(civ, e.a, y)}权臣秉政`, 1, [e.a], [e.region]);
    case 'marry':
      return marryEntry(ctx, id);
    default:
      return base(e, id, `${pn(civ, e.a, y)}有事`, 1, [e.a], []);
  }
}

// ---------------------------------------------------------------------------
// 邦交(diplomacy.ts):结盟、盟约断了、称臣、藩属自立

/** 第 id 条史事之前,a、b 最近一次结盟的那一条(没有 = undefined) */
function pactBefore(civ: Civ, a: number, b: number, id: number): Annal | undefined {
  for (let i = Math.min(id, civ.annals.length) - 1; i >= 0; i--) {
    const e = civ.annals[i];
    if (e.kind === 'alliance' && ((e.a === a && e.b === b) || (e.a === b && e.b === a))) return e;
  }
  return undefined;
}

/** 第 id 条史事之前,p 最近一次称臣的那一条(没有 = undefined) */
function submitBefore(civ: Civ, p: number, id: number): Annal | undefined {
  for (let i = Math.min(id, civ.annals.length) - 1; i >= 0; i--) {
    const e = civ.annals[i];
    if (e.kind === 'submit' && e.a === p) return e;
  }
  return undefined;
}

/** 两国中较弱的一方当年的国号档位(邦交大事看两国是不是都有分量) */
function minTier(civ: Civ, a: number, b: number, y: Year): number {
  const A = polityOf(civ, a);
  const B = polityOf(civ, b);
  return A && B ? Math.min(polityTierAt(A, y), polityTierAt(B, y)) : -1;
}

/**
 * 第 id 条史事之前,p 打过的仗里还没议和的那几场的对手,按开战先后(同一场仗又记了一次开战的,对手换成后来那个、次序不变)。
 * 只翻这国相关的开战、议和(annalIndex)。导出给测试核对索引
 */
export function openFoes(civ: Civ, p: number, id: number): number[] {
  const open = new Map<number, number>();
  const list = annalIndex(civ.annals).wars.get(p) ?? [];
  for (let k = 0; k < list.length && list[k] < id; k += 3) {
    if (Number.isNaN(list[k + 2])) open.delete(list[k + 1]);
    else open.set(list[k + 1], list[k + 2]);
  }
  return [...open.values()];
}

/** 某国此刻(第 id 条史事之前)的乱象:"与索拉特交兵" / "易代之乱" / "新失国都";没有 = 空串 */
function troubleOf(civ: Civ, p: number, id: number, except = -1): string {
  const A = civ.annals;
  const y = id < A.length ? A[id].year : civ.endYear;
  const foes = openFoes(civ, p, id).filter((q) => q !== except);
  if (foes.length) return `与${pn(civ, foes[foes.length - 1], y)}交兵`;
  const P = polityOf(civ, p);
  const d = P?.dynasties;
  if (d && d.length > 1 && d.some((x, i) => i > 0 && x.year <= y && y - x.year < 30)) return '易代之乱';
  const c = P?.capitals;
  if (c && c.some((x, i) => i > 0 && x.year <= y && y - x.year < 30)) return '新迁国都';
  return '';
}

/** 太子的叫法(东方按国号档位:帝国太子、王国世子、国公子;西幻王储) */
function heirWord(p: Polity | null, y: Year): string {
  if (!classical(p)) return '王储';
  const tier = polityTierAt(p!, y);
  return tier >= 3 ? '太子' : tier === 2 ? '世子' : '公子';
}

/** 掌实权的人怎么称呼:太子 / 世子某某、叔父(叔祖……)某某、丞相某某(带当年的官职;没有官职的写"权臣某某");N = 名义君主 */
function holderRef(civ: Civ, x: Person, kind: PersonRegency['kind'], y: Year, N?: Person): string {
  const p = polityOf(civ, x.polity);
  const east = classical(p);
  if (kind === 'march' || kind === 'heir') return `${heirWord(p, y)}${x.name}`;
  if (kind === 'uncle') {
    if (!east) return `摄政${x.name}`;
    // 兄终弟及时幼主和先君同辈:"其兄某某"
    const kin = (N && kinOf(civ, N, x)) || '叔父';
    return `${kin.length === 1 ? '其' : ''}${kin}${x.name}`;
  }
  return x.posts?.length ? ministerRef(x, y) : `${east ? '权臣' : '权臣'}${x.name}`;
}

/**
 * 掌实权(史事 regent,regents.ts;n:0 掌权、1 还政、2 伏诛、3 篡位、4 卒),标签"权":
 *   引兵入朝 "大承太子彭继桓自前线引兵还朝,杀其兄彭晖曦,尽易宫中宿卫;怀王虽在位,政出于彭继桓"(大事);
 *   太子监国 "大承怀王老病,太子彭继桓监国";
 *   大臣专权 "大承国势衰微,丞相某某总揽朝政;自是政出于某某,怀王拱手而已"(大事);
 *   大将专权 "大承大将军某某屡破南定,威震朝野;自是政出于某某,怀王拱手而已"(大事);
 *   还政 "南漓懿公胡炜年十八,丞相孙嵩曜还政";伏诛 "南漓懿公胡炜亲政,以谋逆诛丞相孙嵩曜";
 *   叔父篡位 "南漓摄政胡某废幼主胡炜,自立为君"(大事);卒 "丞相孙嵩曜卒,懿公胡炜始亲政"。
 * 宗室摄政、名臣辅政的掌权写在幼主即位那一条里(reignEntries),名臣、大臣篡位写在改朝换代那一条里(dynastyText):这里不另列(null)。
 * 西幻同样意思换说法("王储""摄政""大权已归某某")
 */
function regentEntry(ctx: Ctx, i: number): ChronicleEntry | null {
  const { civ } = ctx;
  const e = civ.annals[i];
  const hit = ctx.ix?.power.get(i);
  const x = hit?.x;
  const g = hit?.g;
  /** 推演里定的那一种(大将专权没有合适的将领、由大臣顶上的,人物上记成大臣专权) */
  const why = REGENCY_KINDS[e.b] ?? 'chancellor';
  const kind = g?.kind ?? why;
  const n = e.n ?? RG_START;
  if (n === RG_START && (kind === 'uncle' || kind === 'minister')) return null;
  if (n === RG_USURP && kind !== 'uncle') return null;
  const y = e.year;
  // 名义君主:掌权那一刻在位的那位;大臣、大将专权跨了几位君主的,了结那一条写那时在位的
  const strong = kind === 'chancellor' || kind === 'general';
  const N = (n !== RG_START && strong ? reigning(ctx.ix, e.a, y) : null) ?? (g ? civ.people?.[g.ruler] : undefined);
  const p = polityOf(civ, e.a);
  const east = classical(p);
  const P = pn(civ, e.a, y);
  const ruler = N ? rulerRef(civ, N, y) : P;
  const bare = N ? rulerBare(civ, N, y) : east ? '国君' : '国王';
  const who = x && g ? holderRef(civ, x, g.kind, y, N) : '权臣';
  const name = x?.name ?? '';
  let text = '';
  let imp: Importance = 2;
  // 大事:帝国(CAPITAL_TIER)的引兵入朝、大臣大将专权,王国以上(DYNASTY_TIER)的叔父篡位;小一些的国家只在"全部"里
  const tier = p ? polityTierAt(p, y) : 0;
  const rivals: Person[] = [];
  if (n === RG_START) {
    if (kind === 'march') {
      if (tier >= CAPITAL_TIER) imp = 3;
      // 杀掉的兄弟(人物里排的,royals.ts 的 march)
      if (x?.claim?.how === 'march') for (const id of x.claim.rivals) if (civ.people?.[id]) rivals.push(civ.people[id]);
      const kins = rivals.map((r, k) => `${k ? '' : '其'}${(x && kinOf(civ, x, r)) || '兄'}${r.name}`).join('、');
      const front = !!x?.commands?.some((c) => c.from < y && c.until >= y - 20);
      text = east
        ? `${P}${who}${front ? '自前线' : ''}引兵还朝,${kins ? `杀${kins},` : ''}尽易宫中宿卫;${bare}虽在位,政出于${name}`
        : `${P}${who}${front ? '自前线' : ''}率军回到都城,${kins ? `处死${kins.replace(/^其/, '')},` : ''}撤换王宫卫队;${bare}虽仍在位,大权已归${name}`;
      // 那时还在外领兵的兄弟:粮饷为他所制(推演里那场仗本国国力打折,regents.ts 的 MARCH_SUPPLY)
      const sibs = x && x.parent !== undefined ? (ctx.ix?.kids.get(x.parent) ?? []) : [];
      const away = sibs.find((o) => o !== x && o.role === 'prince' && !rivals.includes(o) && o.commands?.some((c) => c.from <= y && c.until > y));
      if (away) {
        rivals.push(away);
        text += east ? `;其${kinOf(civ, x!, away) || '弟'}${away.name}在外领兵,粮饷为${name}所制,无功而还` : `;${away.name}在外领兵,粮饷被${name}卡住,无功而返`;
      }
    } else if (kind === 'heir') text = east ? `${ruler}老病,${who}监国` : `${ruler}年老多病,${who}代为理政`;
    else if (kind === 'general') {
      if (tier >= CAPITAL_TIER) imp = 3;
      // 屡破的是他最近一次领兵打的那一国
      const c = x?.commands?.filter((v) => v.from < y).pop();
      const w = c ? civ.annals[c.first] : undefined;
      const foe = w && c ? (c.side === 0 ? w.b : w.a) : -1;
      const beat = foe >= 0 ? pn(civ, foe, y) : '强敌';
      text = east ? `${P}${who}屡破${beat},威震朝野;自是政出于${name},${bare}拱手而已` : `${P}${who}屡败${beat},威名远播,从此独揽大权,${bare}形同虚设`;
    } else {
      if (tier >= CAPITAL_TIER) imp = 3;
      // 这些年战败失地、丢了国都(推演里大臣专权的由头);接连开疆却没有合适的将领(大将专权由大臣顶上)
      const lead = why === 'general' ? (east ? '连年开疆' : '连年征战') : east ? '国势衰微' : '国势衰微';
      text = east ? `${P}${lead},${who}总揽朝政;自是政出于${name},${bare}拱手而已` : `${P}${lead},${who}独揽朝政,${bare}形同虚设`;
    }
  } else if (n === RG_RETURN) {
    const age = N ? ageAt(N, y) : 18;
    text = east ? `${ruler}年${cnNumber(age)},${who}还政` : `${ruler}年满 ${age} 岁,${who}交还大权`;
  } else if (n === RG_PURGE) {
    const child = kind === 'uncle' || kind === 'minister';
    text = child
      ? east
        ? `${ruler}亲政,以谋逆诛${who}`
        : `${ruler}亲政,以谋逆罪处死${who}`
      : east
        ? `${ruler}密谋诛${who},收其权柄`
        : `${ruler}设计处死${who},收回大权`;
  } else if (n === RG_USURP) {
    if (tier >= DYNASTY_TIER) imp = 3;
    const young = N ? `幼主${N.name}` : '幼主';
    text = east ? `${P}摄政${name}废${young},自立为君` : `${P}摄政${name}废黜${young},自立为王`;
  } else if (n === RG_DIED) text = east ? `${P}${kind === 'uncle' ? `摄政${name}` : who}卒,${bare}始亲政` : `${P}${kind === 'uncle' ? `摄政${name}` : who}去世,${bare}开始亲政`;
  else return null;
  return withPeople(base(e, i, text, imp, [e.a], [e.region]), x, N, ...rivals);
}

/**
 * 结亲(史事 marry,marriages.ts),标签"姻":"南漓、大澜结亲:大澜德宗以女风氏妻南漓懿公胡炜"(互嫁的紧跟着那一条并进来:
 * ";南漓懿公亦以女胡氏妻大澜太子风某,两国互为婚姻");议和时 "南漓、大澜议和,大澜德宗以宗室女风氏妻南漓懿公胡炜,是为和亲"。
 * 两个大国之间的算大事。西幻 "南漓与大澜联姻:大澜国王某某将女儿嫁给南漓国王某某"
 */
function marryEntry(ctx: Ctx, i: number): ChronicleEntry {
  const { civ } = ctx;
  const A = civ.annals;
  const e = A[i];
  const y = e.year;
  const east = classical(polityOf(civ, e.a));
  const next = A[i + 1];
  const mutual = next && next.kind === 'marry' && next.year === y && next.a === e.b && next.b === e.a && next.war < 0 && e.war < 0;
  const people: Person[] = [];
  /** 一门亲的半句:"大澜德宗以女风氏妻南漓懿公胡炜" */
  const half = (j: number, also: boolean): string => {
    const f = A[j];
    const w = ctx.ix?.wed.get(j);
    const groom = w?.x;
    const F = w && w.s.father >= 0 ? civ.people?.[w.s.father] : undefined;
    if (groom) people.push(groom);
    if (F) people.push(F);
    const fa = F ? rulerRef(civ, F, y) : `${pn(civ, f.b, y)}${east ? '国君' : '国王'}`;
    const gr = !groom ? pn(civ, f.a, y) : reigningAt(groom, y) ? `${rulerRef(civ, groom, y)}${groom.title ? groom.name : ''}` : princeRef(civ, groom, y);
    const her = w?.s.name ?? '';
    if (!east) return `${fa}${also ? '也' : ''}将女儿${her}嫁给${gr}`;
    return `${fa}${also ? '亦' : ''}以${f.war >= 0 ? '宗室女' : '女'}${her}妻${gr}`;
  };
  const head = east ? `${pn(civ, e.a, y)}、${pn(civ, e.b, y)}${e.war >= 0 ? '议和,' : '结亲:'}` : `${pn(civ, e.a, y)}与${pn(civ, e.b, y)}${e.war >= 0 ? '议和,' : '联姻:'}`;
  let text = head + half(i, false);
  if (e.war >= 0) text += east ? ',是为和亲' : ',以示和好';
  if (mutual) text += `;${half(i + 1, true)}${east ? ',两国互为婚姻' : ',两国结为姻亲'}`;
  // 两个帝国(当时都在 TITAN_TIER)议和时和亲才是大事(寻常结亲常有,只在"全部"里)
  const A0 = polityOf(civ, e.a);
  const B0 = polityOf(civ, e.b);
  const imp: Importance = e.war >= 0 && A0 && B0 && polityTierAt(A0, y) >= TITAN_TIER && polityTierAt(B0, y) >= TITAN_TIER ? 3 : 2;
  return withPeople(base(e, i, text, imp, [e.a, e.b], [e.region]), ...people);
}

/** 第 i 条结亲是不是紧跟在前一条后面的互嫁(并进前一条) */
function mutualTail(A: readonly Annal[], i: number): boolean {
  const e = A[i];
  const prev = A[i - 1];
  return !!prev && prev.kind === 'marry' && prev.year === e.year && prev.a === e.b && prev.b === e.a && e.war < 0 && prev.war < 0;
}

/**
 * 结盟 "大渭与昌国结盟,共御索拉特";盟约渐废 "索拉特既亡,大渭与昌国之盟遂废" / "大渭与昌国之盟渐废";
 * 坐视不救 "索拉特伐昌国,大渭坐视不救,两国之盟遂绝";背盟 "大渭背弃与昌国之盟"(折进那场战争,标题写"背盟伐");
 * 一方称臣 "昌国既称臣于大渭,与索拉特之盟遂废";
 * 畏强邻称臣 "昌国畏大渭之强,遣使称臣,岁岁纳贡"(战败称臣折进那场战争的议和);
 * 藩属自立 "昌国乘大渭与索拉特交兵,绝其朝贡,不复称臣"。
 * 称臣、自立的一方当时在第 2 档(王国)以上是大事;结盟要两国都在第 3 档(帝国)以上才算大事(结盟常有,大多后来渐废)
 */
function diplomacyEntry(ctx: Ctx, e: Annal, id: number): ChronicleEntry {
  const { civ } = ctx;
  const y = e.year;
  const A = pn(civ, e.a, y);
  const B = pn(civ, e.b, y);
  switch (e.kind) {
    case 'alliance': {
      const f = e.foe ?? -1;
      const F = polityOf(civ, f);
      const t = F ? `${A}与${B}结盟,共御${pn(civ, f, y)}` : `${A}与${B}结盟`;
      return { ...base(e, id, t, minTier(civ, e.a, e.b, y) >= TITAN_TIER ? 3 : 2, [e.a, e.b, f], []), settlement: -1 };
    }
    case 'unally': {
      if (e.cause === 'abandon') {
        const w = civ.annals.find((x) => x.kind === 'war' && x.war === e.war);
        const head = w ? `${pn(civ, w.a, y)}伐${B},` : `${B}遭兵,`;
        return base(e, id, `${head}${A}坐视不救,两国之盟遂绝`, 2, [e.a, e.b], [], '绝');
      }
      if (e.cause === 'betray') return base(e, id, `${A}背弃与${B}之盟`, 2, [e.a, e.b], [], '背');
      if (e.cause === 'vassal') {
        const s = submitBefore(civ, e.a, id + 1);
        return base(e, id, s ? `${A}既称臣于${pn(civ, s.b, y)},与${B}之盟遂废` : `${A}与${B}之盟遂废`, 1, [e.a, e.b], [], '绝');
      }
      const f = pactBefore(civ, e.a, e.b, id)?.foe ?? -1;
      const F = polityOf(civ, f);
      const gone = !!F && F.ended !== undefined && F.ended <= y;
      const t = gone ? `${pn(civ, f, F!.ended! - 1 / 512)}既亡,${A}与${B}之盟遂废` : F ? `${pn(civ, f, y)}既衰,${A}与${B}之盟渐废` : `${A}与${B}之盟渐废`;
      return base(e, id, t, 1, [e.a, e.b], [], '绝');
    }
    case 'submit': {
      const t = `${A}畏${B}之强,遣使称臣,岁岁纳贡`;
      const P = polityOf(civ, e.a);
      return base(e, id, t, P && polityTierAt(P, y) >= GREAT_TIER ? 3 : 2, [e.a, e.b], [e.region]);
    }
    case 'defect': {
      // 作者下令宗主向藩属开战:宗藩反目
      const why = e.cause === 'betray' ? '' : troubleOf(civ, e.b, id);
      const t = e.cause === 'betray' ? `${B}与藩属${A}反目,${A}不复称臣` : why ? `${A}乘${B}${why},绝其朝贡,不复称臣` : `${A}绝${B}之贡,不复称臣`;
      const P = polityOf(civ, e.a);
      return base(e, id, t, P && polityTierAt(P, y) >= GREAT_TIER ? 3 : 2, [e.a, e.b], [e.region]);
    }
    default:
      return base(e, id, `${A}有事`, 1, [e.a], []);
  }
}

// ---------------------------------------------------------------------------
// 地形大事:那一刻的后果(城没了、迁都、亡国)折叠成一条

/** 城在地形大事里没了:"揽霞城没于水" / "别尔格勒毁于火山";who = 带上国名("大霄揽霞城没于水") */
function sunkText(civ: Civ, e: Annal, who = false): string {
  const city = cityName(civ, e.settlement) || '一城';
  const head = who && e.a >= 0 ? pn(civ, e.a, e.year) : '';
  return `${head}${city}${e.b === 1 ? '没于水' : '毁于火山'}`;
}

/** 这条史事是地形大事那一刻的后果(紧跟在 upheaval 后面、同一刻的 sunk / 因天灾迁都 / 亡于天灾):编年史并进大事那一条 */
function upheavalTail(e: Annal, head: Annal): boolean {
  if (e.year !== head.year) return false;
  return e.kind === 'sunk' || (e.kind === 'capital' && e.b === -2) || (e.kind === 'fall' && e.b === -2);
}

/**
 * 地形大事:"海水漫入大霄,六州沉入海中,揽霞城等十城没于水,迁都长风城" / "兹拉季纳王国境内火山喷发,国都别尔格勒被毁,
 * 迁都奥斯托斯克" / "萨尔斯坦帝国与库那汗国之间的海峡隆起成陆"。ids = upheaval 那一条和紧跟着的后果(upheavalTail)
 */
function upheavalEntry(ctx: Ctx, ids: number[]): ChronicleEntry {
  const { civ } = ctx;
  const A = civ.annals;
  const e = A[ids[0]];
  const y = e.year;
  const F = civ.upheavals?.[e.a];
  const tail = ids.slice(1).map((i) => A[i]);
  const P = F?.polity ?? -1;
  const where = P >= 0 ? pn(civ, P, y) : '';
  const rn = regionName(civ, e.region);
  const kinds = F?.kinds ?? [];
  let t: string;
  if (kinds.includes('volcano')) {
    if (where) t = `${where}境内火山喷发`;
    else if (F?.added.length) t = '海中火山喷发,隆起新岛';
    else t = `${rn || '荒野之中'}火山喷发`;
  } else if (kinds.includes('sink') && (!kinds.includes('raise') || F!.sunk >= F!.risen)) {
    t = where ? `海水漫入${where}` : rn ? `海水漫入${rn}一带` : '海水漫入';
    const drowned = F ? F.drowned.filter((_, i) => P < 0 || F.drownedBy[i] === P).length : 0;
    if (drowned) t += `,${cnNumber(drowned)}州沉入海中`;
    else if (F?.shrunk.length) t += ',沿岸之地沉入海中';
  } else if (F?.joined && F.joinedBy) {
    const side = (i: number) => (F.joinedBy![i] >= 0 ? pn(civ, F.joinedBy![i], y) : regionName(civ, F.joined![i]) || '荒野');
    t = F.joinedBy[0] >= 0 && F.joinedBy[0] === F.joinedBy[1] ? `${where || side(0)}境内的海峡隆起成陆` : `${side(0)}与${side(1)}之间的海峡隆起成陆`;
  } else if (F?.added.length && !F.grown.length) t = `${where || rn ? `${where || rn}外` : ''}海中隆起新岛`;
  else t = `${where || rn || ''}沿海隆起新陆`;
  // 没了的城:先说毁于火山的,再说没于水的(各自国都在前,史事里已经排好)
  const cities = (list: Annal[], word: string) => {
    if (!list.length) return '';
    const first = list[0];
    const p = polityOf(civ, first.a);
    // 只没了国都一座城时点明是国都("国都别尔格勒被毁");好几座城时只举头一座("揽霞城等十城没于水",后面有迁都)
    const cap = list.length === 1 && !!p && capitalBefore(p, y) === first.settlement && p.founded < y;
    const name = `${cap ? (first.a === P ? '国都' : `${pn(civ, first.a, y)}国都`) : ''}${cityName(civ, first.settlement) || '一城'}`;
    return list.length > 1 ? `,${name}等${cnNumber(list.length)}城${word}` : `,${name}${word}`;
  };
  const sunk = tail.filter((x) => x.kind === 'sunk');
  t += cities(
    sunk.filter((x) => x.b === 0),
    '被毁',
  );
  t += cities(
    sunk.filter((x) => x.b === 1),
    '没于水',
  );
  for (const x of tail) {
    if (x.kind === 'capital') t += `,${x.a === P ? '' : pn(civ, x.a, y)}迁都${cityName(civ, x.settlement) || regionName(civ, x.region)}`;
    else if (x.kind === 'fall') t += `,${pn(civ, x.a, y)}亡`;
  }
  const regions = [e.region, ...(F ? [...F.drowned, ...F.shrunk, ...F.grown, ...F.added] : [])].filter((r) => r >= 0);
  const polities = [P, ...(F?.joinedBy ?? []), ...tail.map((x) => x.a)].filter((p) => p >= 0);
  const x = { ...base(e, ids[0], t, 3, polities, regions), settlement: -1 };
  if (tail.length) {
    x.children = ids.slice(1).map((i) => {
      const c = A[i];
      if (c.kind === 'sunk') return base(c, i, sunkText(civ, c), 2, [c.a], [c.region]);
      return simpleEntry(ctx, c, i);
    });
  }
  return x;
}

// ---------------------------------------------------------------------------
// 战争:折叠成一条

function warEntry(ctx: Ctx, ids: number[]): ChronicleEntry {
  const { civ } = ctx;
  const A = civ.annals;
  const list = ids.map((i) => A[i]);
  const decl = list.find((e) => e.kind === 'war') ?? list[0];
  const atk = decl.a;
  const def = decl.b;
  const start = list[0].year;
  // 净得失:每一州最早的原主、最后是谁打下来的
  const firstOwner = new Map<number, number>();
  const lastBy = new Map<number, number>();
  const fought: number[] = [];
  for (const e of list) {
    if (e.kind !== 'conquer' || e.region < 0) continue;
    if (!firstOwner.has(e.region)) {
      firstOwner.set(e.region, e.b);
      fought.push(e.region);
    }
    lastBy.set(e.region, e.a);
  }
  const gained = (side: number) => fought.filter((r) => lastBy.get(r) === side && firstOwner.get(r) !== side);
  const gainA = gained(atk);
  const gainD = def >= 0 ? gained(def) : [];
  const falls = list.filter((e) => e.kind === 'fall');
  // 被迫迁都(国都失守),按国家分:这场战争里亡了的不再说迁都
  const moves = new Map<number, Annal[]>();
  for (const e of list) {
    if (e.kind !== 'capital' || falls.some((f) => f.a === e.a)) continue;
    let m = moves.get(e.a);
    if (!m) moves.set(e.a, (m = []));
    m.push(e);
  }
  const peace = [...list].reverse().find((e) => e.kind === 'peace');
  // 战败称臣(邦交):紧跟在议和后面,写进议和那一条和标题
  const sworn = list.find((e) => e.kind === 'submit');
  const lastYear = list[list.length - 1].year;
  const over = !!peace || falls.some((f) => f.a === atk || f.a === def);
  const end = over ? (peace ? peace.year : lastYear) : Math.max(lastYear, civ.endYear);

  // 子条目:洗劫、毁城在史事里记在攻占前面(同一刻),这里排回那条攻占后面
  const order: number[] = [];
  let held: number[] = [];
  for (const i of ids) {
    const e = A[i];
    if (e.kind === 'sack' || e.kind === 'ruin') {
      held.push(i);
      continue;
    }
    // 称臣写进议和那一条,背盟写进宣战那一条("背盟,起兵伐某国"),不另列
    if (e.kind === 'submit' || (e.kind === 'unally' && e.cause === 'betray')) continue;
    order.push(i);
    if (e.kind === 'conquer' && held.length) {
      order.push(...held.filter((j) => A[j].region === e.region));
      held = held.filter((j) => A[j].region !== e.region);
    }
  }
  order.push(...held);
  // 不是打下来的攻占:议和时划界割让的(peace 的 region = 紧挨在它前面的几条)、丢了国都撑不下去残部一并归攻方的
  // (亡国前同一刻、打下国都以后连着的几条攻占,见 growth.ts 的 annexedRemnants)。各合成一条子条目,不写"攻取"
  const special = new Map<number, 'cede' | 'annex'>();
  for (const i of ids) {
    const e = A[i];
    if (e.kind === 'peace' && e.region > 0) {
      for (let j = Math.max(0, i - e.region); j < i; j++) if (A[j].kind === 'conquer' && A[j].war === e.war) special.set(j, 'cede');
    } else if (e.kind === 'fall') {
      for (const j of annexedRemnants(civ, i)) special.set(j, 'annex');
    }
  }
  // 人物:统帅这场战争里第一次出场写全("大渭将李牧攻取瑞州"),之后攻占只写国名
  const ix = ctx.ix;
  const named = new Set<number>();
  const sideOf = (p: number) => (p === atk ? 0 : p === def ? 1 : -1);
  // 同一处、同一攻方、两边同一对统帅接连没打下来的几仗合成一条("三度攻至城下,…皆不克");中间这一州易手了就另算
  const battles = new Map<number, number[]>();
  const folded = new Set<number>();
  {
    const open = new Map<string, number>();
    for (const i of order) {
      const e = A[i];
      if (e.kind === 'conquer') {
        for (const [key, head] of open) if (A[head].region === e.region) open.delete(key);
        continue;
      }
      if (e.kind !== 'battle') continue;
      const s = sideOf(e.a);
      const ca = s >= 0 ? commander(ix, e.war, s, i) : null;
      const cd = s >= 0 ? commander(ix, e.war, 1 - s, i) : null;
      const key = `${e.region}|${e.a}|${ca?.id ?? -1}|${cd?.id ?? -1}`;
      const head = open.get(key);
      if (head === undefined) {
        open.set(key, i);
        battles.set(i, [i]);
      } else {
        battles.get(head)!.push(i);
        folded.add(i);
      }
    }
  }
  const children: ChronicleEntry[] = [];
  for (let k = 0; k < order.length; k++) {
    const i = order[k];
    if (folded.has(i)) continue;
    const sp = special.get(i);
    if (!sp) {
      children.push(childEntry(i));
      continue;
    }
    const group = [i];
    while (k + 1 < order.length && special.get(order[k + 1]) === sp) group.push(order[++k]);
    const e = A[i];
    const rs = uniq(group.map((j) => A[j].region));
    let text: string;
    if (sp === 'cede') {
      // "议定疆界,乌绝原等三州划归大渭,雪西划归昌国"
      const to = uniq(group.map((j) => A[j].a));
      text = `议定疆界,${to.map((p) => `${regionList(civ, group.filter((j) => A[j].a === p).map((j) => A[j].region)) || '一州'}划归${pn(civ, p, e.year)}`).join(',')}`;
    } else text = rs.length > 1 ? `余下${regionList(civ, rs)}尽归${pn(civ, e.a, e.year)}` : `余下${regionList(civ, rs) || '一州'}亦归${pn(civ, e.a, e.year)}`;
    const kids = group.map((j) => A[j]);
    children.push({ ...base(e, i, text, 2, kids.flatMap((c) => [c.a, c.b]), rs, sp === 'cede' ? '割' : '占'), settlement: -1 });
  }
  function childEntry(i: number): ChronicleEntry {
    const e = A[i];
    if (e.kind === 'war') {
      const x = declareEntry(ctx, e, i);
      for (const id of x.people ?? []) named.add(id);
      return x;
    }
    if (e.kind === 'battle') return battleChild(battles.get(i) ?? [i]);
    if (e.kind === 'stand') return standChild(i);
    if (e.kind === 'conquer') {
      // 这场战争里被夺走又打回来的,或者以前就是攻方的(议和割让、分裂出去、上一场战争丢掉的)
      const retake = (e.region >= 0 && firstOwner.get(e.region) === e.a) || ctx.retake.has(i);
      const s = sideOf(e.a);
      const c = s >= 0 ? commander(ix, e.war, s, i) : null;
      const fresh = c && !named.has(c.id) ? c : null;
      if (fresh) named.add(fresh.id);
      let t = conquerText(civ, e, [atk, def], retake, fresh ? generalRef(civ, fresh, e.year) : undefined);
      // 守方统帅战死:"…,守将王翦战死"(领兵的宗室:"…,公子胡翔战死")
      const lost = s >= 0 ? fallenAt(ix, e.war, 1 - s, i) : null;
      if (lost) t += `,${lost.role === 'prince' ? princeTitle(civ, lost, e.year) : '守将'}${lost.name}战死`;
      return withPeople(base(e, i, t, e.b >= 0 ? 2 : 1, [e.a, e.b], [e.region]), fresh, lost);
    }
    if (e.kind === 'unally') {
      // 坐视不救:"索拉特坐视不救,与昌国之盟遂绝";背盟写在宣战那一条和标题里
      return base(e, i, `${pn(civ, e.a, e.year)}坐视不救,与${pn(civ, e.b, e.year)}之盟遂绝`, 2, [e.a, e.b], [], '绝');
    }
    if (e.kind === 'peace') {
      const y = e.year;
      const fallen = falls.find((f) => f.year <= y && (f.a === atk || f.a === def));
      // 一方在另一场战争里亡国,这场仗随之结束(见 wars.ts:亡国的国家打着的仗都记一条议和)
      const gone = fallen
        ? -1
        : [atk, def].find((s) => {
            const p = polityOf(civ, s);
            return !!p && p.ended !== undefined && p.ended <= y;
          }) ?? -1;
      let t: string;
      let envoys: Person[] = [];
      if (fallen) t = `${pn(civ, fallen.a, fallen.year)}既亡,兵戈遂息`;
      else if (gone >= 0) t = `${pn(civ, gone, y)}既亡,兵戈遂息`;
      else {
        // 议和条款:"大渭遣礼部尚书某某与昌国丞相某某议和:昌国奉表称臣,岁岁纳贡;昌国割瑞州、汾州、雪西三州予大渭"
        const head = peaceHead(civ, ix, e, i, y);
        t = head.text;
        envoys = head.people;
        const terms: string[] = [];
        if (sworn) terms.push(`${pn(civ, sworn.a, y)}奉表称臣,岁岁纳贡`);
        if (gainA.length) terms.push(`${pn(civ, def, y)}割${regionNames(civ, gainA)}予${pn(civ, atk, y)}`);
        if (gainD.length) terms.push(`${pn(civ, atk, y)}割${regionNames(civ, gainD)}予${pn(civ, def, y)}`);
        t += terms.length ? `:${terms.join(';')}` : ',疆界如故';
      }
      return withPeople(base(e, i, t, 2, sworn && sworn.a !== e.a && sworn.a !== e.b ? [e.a, e.b, sworn.a] : [e.a, e.b], [...gainA, ...gainD]), ...envoys);
    }
    if (e.kind === 'capital') {
      // 被迫迁都:紧跟在"国都某城陷落"那一条攻占后面,只说迁到哪
      const now = cityName(civ, e.settlement) || regionName(civ, e.region);
      return base(e, i, `${pn(civ, e.a, e.year)}${now ? `迁都${now}` : '另立国都'}`, 2, [e.a], [e.region]);
    }
    return simpleEntry(ctx, e, i);
  }
  /**
   * 战役(攻方这一仗没打下来):州里有城的是攻城 "汾城之战,大渭将李牧攻至城下,王翦坚守,不克"
   * (三种说法按城、年份轮换;守方的国都:"…围攻昌国国都,…");没有城的是野战 "瑞州之战,大渭将李牧渡河来攻,为昌国将王翦所败";
   * 守方反攻写"反攻";攻方统帅战死加 ",李牧战死"。接连几仗合成一条:"…前后 7 年三度攻至城下,王翦坚守,皆不克"
   */
  function battleChild(ids: number[]): ChronicleEntry {
    const e = A[ids[0]];
    const last = A[ids[ids.length - 1]];
    const y = e.year;
    const n = ids.length;
    const s = sideOf(e.a);
    const counter = s === 1;
    const ca = s >= 0 ? commander(ix, e.war, s, ids[0]) : null;
    const cd = s >= 0 ? commander(ix, e.war, 1 - s, ids[0]) : null;
    const dead = s >= 0 ? fallenAt(ix, e.war, s, ids[n - 1]) : null;
    const who = ca ? generalRef(civ, ca, y) : pn(civ, e.a, y);
    const years = Math.floor(last.year) - Math.floor(y);
    const times = n >= 2 ? `${years >= 2 ? `前后 ${years} 年` : ''}${n === 2 ? '两' : cnNumber(n)}度` : '';
    const all = n >= 2 ? '皆' : '';
    const city = cityName(civ, e.settlement);
    let t: string;
    if (city) {
      const owner = polityOf(civ, e.b);
      const capital = !!owner && owner.founded <= y && capitalBefore(owner, y) === e.settlement;
      const guard = cd ? (named.has(cd.id) && !reigningAt(cd, y) ? cd.name : generalRef(civ, cd, y)) : '';
      const v = n >= 2 || capital ? 0 : (Math.max(0, e.settlement) * 7 + Math.floor(y)) % 3;
      const attack = capital
        ? `${counter ? '反攻' : '围攻'}${pn(civ, e.b, y)}国都`
        : (counter ? ['反攻至城下', '回师围城', '反攻其城'] : ['攻至城下', '围城', '攻城'])[v];
      t = `${city}之战,${who}${times}${attack}`;
      if (v === 0) t += guard ? `,${guard}坚守,${all}不克` : `,${all}不克`;
      else if (v === 1) t += guard ? `,${guard}据城死守,城不下` : ',城坚不下';
      else t += guard ? `,为${guard}所却` : '不下';
    } else {
      const r = regionName(civ, e.region) || '边境';
      t = `${r}之战,${who}${times}${VIA[e.via ?? 0] ?? ''}${counter ? '反攻' : '来攻'},${all}为${cd ? generalRef(civ, cd, y) : `${pn(civ, e.b, y)}守军`}所败`;
    }
    if (dead) t += `,${dead.name}战死`;
    for (const x of [ca, cd]) if (x) named.add(x.id);
    return withPeople({ ...base(e, ids[0], t, 2, [e.a, e.b], [e.region]), end: last.year }, ca, cd);
  }
  /**
   * 据险断后(wars.ts 的 stand):败退的一方留一支兵守住山口,挡住追兵,掩护大军撤走。
   * 东方 "昌国军败退,部将李信以八百人守汾州之隘,拒大渭军三日,力战而死;王翦得以收兵退保汾州";
   * 汗国 "…,李信率八百骑扼守汾州山口,挡住大渭军三日,战死;…";
   * 西幻 "…,李信率八百人扼守汾州的山口,挡住大渭大军三天,力战阵亡;王翦得以率主力撤回汾州"。
   * 守将的结局(Annal.cause):力战而死 / 力竭被擒 / 全师而退;没有人物时不写人名。带多少人按这一条随手挑一个说法
   */
  function standChild(i: number): ChronicleEntry {
    const e = A[i];
    const y = e.year;
    const P = polityOf(civ, e.a);
    const east = classical(P);
    const khan = !!P?.eastern && !east;
    const r = regionName(civ, e.region);
    // 大军退保关隘后面的哪州(Annal.foe;没记 = 关隘所在的州)
    const hold = e.foe ?? e.region;
    const back = regionName(civ, hold);
    // 州名里已经带"之"的("羊涂之野")不再叠一个"之":写"羊涂之野隘口"
    const pass = r ? (east ? (r.includes('之') ? `${r}隘口` : `${r}之隘`) : khan ? `${r}山口` : `${r}的山口`) : east ? '险隘' : '山口';
    const s = sideOf(e.a);
    const rear = ix?.rear.get(i) ?? null;
    // 掩护的是这一方的统帅:这一刻以前就在领兵的才写名字(这一刻才换上来的写"大军")
    const lc = s >= 0 ? (ix?.commands.get(e.war)?.find((c) => c.side === s && c.first < i && i <= c.last) ?? null) : null;
    const lead = lc ? (named.has(lc.person.id) && lc.person.role === 'general' ? lc.person.name : generalRef(civ, lc.person, y)) : '';
    const men = STAND_MEN[((Math.imul(Math.max(0, e.region) + 1, 0x9e3779b1) ^ Math.imul(Math.floor(y) + 7 * Math.max(0, e.war), 0x85ebca6b)) >>> 0) % STAND_MEN.length];
    const days = e.n ?? 3;
    const d = `${days === 2 ? '两' : cnNumber(days)}${east || khan ? '日' : '天'}`;
    const how = e.cause === 'captured' ? 1 : e.cause === 'withdrew' ? 2 : 0;
    let t = `${pn(civ, e.a, y)}军败退,`;
    if (east) t += `${rear ? `部将${rear.name}以${men}人` : `留${men}人`}守${pass},拒${pn(civ, e.b, y)}军${d}`;
    else t += `${rear ? `${rear.name}率${men}${khan ? '骑' : '人'}` : `留下${men}${khan ? '骑' : '人'}`}扼守${pass},挡住${pn(civ, e.b, y)}${khan ? '军' : '大军'}${d}`;
    const ends = rear
      ? east
        ? ['力战而死', '力竭被执', '全师而还']
        : khan
          ? ['战死', '力竭被擒', '全师而还']
          : ['力战阵亡', '力竭被俘', '随后全身而退']
      : east
        ? ['守者尽殁', '守者力竭被执', '全师而还']
        : ['守军全部战死', '守军力竭被俘', '守军随后全身而退'];
    t += `,${ends[how]}`;
    t += east || khan ? `;${lead ? `${lead}得以收兵` : '大军得以'}退保${back || '后方'}` : `;${lead ? `${lead}得以率主力` : '主力得以'}撤回${back || '后方'}`;
    for (const x of [rear, lc?.person]) if (x) named.add(x.id);
    return withPeople(base(e, i, t, 2, [e.a, e.b], [e.region, hold]), rear, lc?.person);
  }

  // 标题:"大渭伐昌,得瑞州等五州";攻方先得后失:"得瑞州等三州而失雪西"(只有攻方的得失不带主语,别的一律点名)
  const parts: string[] = [];
  const got = gainA.length ? `${over ? '' : '已'}得${regionList(civ, gainA)}` : '';
  if (gainD.length) parts.push(`${got ? `${got}而` : '反'}失${regionList(civ, gainD)}`);
  else if (got) parts.push(got);
  // 国都失守:"昌国国都汾城陷落"(不写"昌国失国都",免得和攻方的"失某州"两个"失"说的不是同一方);迁了两次以上:"昌国连迁三都"
  let oldCapital = false;
  for (const [pid, ms] of moves) {
    const p = polityOf(civ, pid);
    if (isGreat(p) && ms.some((e) => capitalHeld(p!, e.year) >= OLD_CAPITAL)) oldCapital = true;
    const who = pn(civ, pid, start);
    if (ms.length >= 2) parts.push(`${who}连迁${ms.length === 2 ? '两' : cnNumber(ms.length)}都`);
    else {
      const lost = p ? cityName(civ, capitalBefore(p, ms[0].year)) : '';
      parts.push(lost ? `${who}国都${lost}陷落` : `${who}国都陷落`);
    }
  }
  for (const f of falls) parts.push(`${pn(civ, f.a, f.year)}亡`);
  if (sworn) parts.push(`${pn(civ, sworn.a, sworn.year)}称臣`);
  // 攻守方国都没打下来:"围汾城不克"(写在得失后面;别的什么都没有:"围汾城不克而还")
  const D0 = polityOf(civ, def);
  const siege = D0
    ? list.find(
        (e) =>
          e.kind === 'battle' &&
          e.a === atk &&
          e.b === def &&
          e.settlement >= 0 &&
          capitalBefore(D0, e.year) === e.settlement &&
          !list.some((c) => c.kind === 'conquer' && c.settlement === e.settlement && c.year >= e.year),
      )
    : undefined;
  const siegeCity = siege ? cityName(civ, siege.settlement) : '';
  // 毁了哪几座城(村镇不说):"毁汾城、瑞城"
  const razed = list.filter((e) => e.kind === 'ruin' && rankBefore(civ, e.settlement, e.year) >= 2).map((e) => cityName(civ, e.settlement));
  if (razed.some(Boolean)) parts.push(`毁${razed.filter(Boolean).slice(0, 2).join('、')}${razed.length > 2 ? '等城' : ''}`);
  if (siegeCity) {
    if (over && !parts.length) parts.push(`围${siegeCity}不克而还`);
    else parts.splice(got || gainD.length ? 1 : 0, 0, `围${siegeCity}不克`);
  }
  if (!over) parts.push('战事未休');
  else if (!parts.length) parts.push('无功而还');
  // 援盟、救藩(邦交;阶段 4 干预的结盟):settlement 列是援的那一国
  const ally = decl.kind === 'war' && decl.settlement >= 0 ? decl.settlement : -1;
  // 有人物的写开战时攻方的统帅:"大渭遣李牧伐昌国,…";君主亲征:"大渭伐昌国,太宗亲征,…"
  // (君主写在国名后面会把"大事"里国名后的来历隔开,所以放到逗号后面)
  const lead = decl.kind === 'war' ? commander(ix, decl.war, 0, ids[list.indexOf(decl)]) : null;
  if (lead && reigningAt(lead, start)) parts.unshift(`${rulerBare(civ, lead, start)}亲征`);
  const head = warHead(civ, decl, ids[list.indexOf(decl)], lead && !reigningAt(lead, start) ? leaderName(civ, lead, start) : '');
  const text = `${head},${parts.join(',')}`;
  // 改变格局的战争是大事:灭了大国(或吞并一个像样的国家)、易手很多州、攻下做了很久的国都、两个帝国交兵且有得失
  const A0 = polityOf(civ, atk);
  const gains = gainA.length + gainD.length;
  const titans = !!A0 && !!D0 && polityTierAt(A0, start) >= TITAN_TIER && polityTierAt(D0, start) >= TITAN_TIER && gains >= TITAN_WAR;
  const conquest = falls.some((f) => {
    const p = polityOf(civ, f.a);
    // 小国分出去(复国)又被原主收回:分出去那一条只在"全部"里,收回来也不算改变格局(易手很多州的照旧是大事)
    const back = !!p && ctx.splitFrom.get(p.id) === f.b;
    return isGreat(p) || (isState(p) && gains >= FALL_WAR && !back);
  });
  // 毁了大城 / 国都的战争也是大事(毁城那一条单列,但"大事"里由战争说)
  const razedMajor = list.some((e) => e.kind === 'ruin' && ruinImportance(civ, e) >= MAJOR);
  // 大国(到过第 2 档)战败称臣也是大事
  const bowed = !!sworn && isGreat(polityOf(civ, sworn.a));
  const major = conquest || gains >= BIG_WAR || oldCapital || titans || razedMajor || bowed;
  const importance: Importance = major ? 3 : gains > 0 || moves.size > 0 || falls.length > 0 || !!sworn ? 2 : 1;
  const polities = [atk, def];
  for (const e of list) polities.push(e.a, e.b);
  if (ally >= 0) polities.push(ally);
  // 事发地:打下来的州;一州没打下来的,就是没打下来的那几仗的战场
  const sites = fought.length ? fought : uniq(list.filter((e) => e.kind === 'battle' && e.region >= 0).map((e) => e.region));
  return withPeople(
    {
      id: ids[0],
      kind: 'war',
      year: start,
      end,
      text,
      tag: '战',
      importance,
      polities: uniq(polities),
      regions: sites,
      settlement: -1,
      children,
      ongoing: !over,
      head,
    },
    lead,
  );
}

// ---------------------------------------------------------------------------
// 饥荒、民变、大崩解(unrest.ts)

/**
 * 割据、收回、抗命(control.ts):"瑞州守将拥兵自重,割据瑞州等三州,名义上仍奉大渭" /
 * "大渭收回割据二十六年的瑞州" / "大渭与昌国交兵,瑞州守将拥兵不出"(西幻:守将 → 领主)
 */
function lordText(civ: Civ, e: Annal): string {
  const A = pn(civ, e.a, e.year);
  const r = regionName(civ, e.region) || cityName(civ, e.settlement) || '一方';
  const lord = `${r}${polityOf(civ, e.a)?.eastern ? '守将' : '领主'}`;
  if (e.kind === 'warlord') return `${lord}拥兵自重,割据${e.war > 1 ? `${r}等${e.war === 2 ? '两' : cnNumber(e.war)}州` : r},名义上仍奉${A}`;
  if (e.kind === 'reclaim') return e.war >= 1 ? `${A}收回割据${cnNumber(e.war)}年的${r}` : `${A}收回${r}`;
  return `${A}与${pn(civ, e.b, e.year)}交兵,${lord}拥兵不出`;
}

/**
 * 国用不足(control.ts 的钱粮):史事记了主要是因为打仗(war = 0)还是地方拖欠(1);拖欠的那年还在打仗就两样都写。
 * "大霄连年用兵,府库空竭" / "大霄诸州多截留赋税,府库空竭" / "大霄用兵于奥利亚,诸州又多截留赋税,府库空竭"
 */
function fiscalText(civ: Civ, e: Annal, foes: number[]): string {
  const A = pn(civ, e.a, e.year);
  if (e.war === 0) return `${A}连年用兵,府库空竭`;
  if (foes.length) return `${A}用兵于${pn(civ, foes[0], e.year)},诸州又多截留赋税,府库空竭`;
  return `${A}诸州多截留赋税,府库空竭`;
}

/**
 * 议事(council.ts;议题在 war 列,结果在 n 列:0 办成、1 妥协、2 搁置、3 谈崩):写谁推、谁拦、成没成。who = 当时在位的君主(没有人物 = null)。
 * "大渭国用不足,太宗行直征之法,遣官至瑞州等地自收赋税" / "大渭议行直征,瑞州等地豪族力阻,改与地方分成" /
 * "大渭太宗削藩,收回割据四十年的瑞州" / "大渭边地难制,群臣请分封瑞州等边州,太宗不许"(西幻:贵族、领主,写得平实些);
 * 第二批:"大渭太宗收诸将兵权,精兵尽隶禁军" / "大渭议行铨选,瑞州等地豪族力阻,改为铨选、荐举各半" /
 * "大渭太宗分瑞州之镇,守将所领诸州尽归朝廷,只留瑞州一州" / "大渭瑞州守将举所领诸州归附大燕,朝廷不能制"
 */
function councilText(civ: Civ, e: Annal, id: number, who: Person | null): string {
  const y = e.year;
  const A = pn(civ, e.a, y);
  const P = polityOf(civ, e.a);
  const east = !!P?.eastern;
  const r = regionName(civ, e.region) || cityName(civ, e.settlement) || (east ? '边地' : '边境');
  /** "大渭太宗"(没有人物 = 国名)、"太宗"(没有人物 = 空)、"太宗"(没有人物 = "朝廷") */
  const ref = who ? rulerRef(civ, who, y) : A;
  const bare = who ? rulerBare(civ, who, y) : '';
  const court = bare || (east ? '朝廷' : '王室');
  const lord = east ? '守将' : '领主';
  const out = e.n ?? 2;
  switch (e.war) {
    case 0: {
      // 罢直征:原来是直征还是分成(这国上一次办成 / 妥协的直征)
      let half = false;
      for (let i = id - 1; i >= 0; i--) {
        const x = civ.annals[i];
        if (x.kind === 'council' && x.a === e.a && x.war === 2 && (x.n === 0 || x.n === 1)) {
          half = x.n === 1;
          break;
        }
      }
      const old = half ? (east ? '分成之法' : '分成征税') : east ? '直征' : '直接征税';
      if (out === 0) return east ? `${A}${old}所得不抵所费,复由地方代收` : `${A}${old}入不敷出,复由地方代收`;
      return east ? `${A}群臣请罢${old},${court}不许` : `${A}有人请废除${old},${court}不许`;
    }
    case 1: {
      // 削藩:那处割据起了几年(这国在那州最近一次割据)
      let since = NaN;
      for (let i = id - 1; i >= 0; i--) {
        const x = civ.annals[i];
        if (x.kind === 'warlord' && x.a === e.a && x.region === e.region) {
          since = x.year;
          break;
        }
      }
      const n = Math.round(y - since);
      const years = n >= 1 ? `割据${cnNumber(n)}年的` : '';
      if (out === 0) return east ? `${ref}削藩,收回${years}${r}` : `${ref}削夺${r}${lord}之权,收回${years}${r}`;
      if (out === 3) return east ? `${ref}削藩,${r}${lord}不受命` : `${ref}削夺${r}${lord}之权,${lord}举兵抗命`;
      return east ? `${A}议削${r}之藩,恐其生变,事寝` : `${A}议削夺${r}${lord}之权,恐其生变,作罢`;
    }
    case 2: {
      // 直征:国用不足才议的(cause = broke),不然是君主锐意兴革
      const head = e.cause === 'broke' ? `${A}${east ? '国用不足' : '国库空虚'},${bare}` : who ? `${ref}${east ? '锐意兴革,' : '有意革新,'}` : A;
      const foes = `${r}等地${east ? '豪族' : '贵族'}力阻`;
      if (out === 0) return east ? `${head}行直征之法,遣官至${r}等地自收赋税` : `${head}改由王室官吏直接征税,派员前往${r}等地`;
      if (out === 1) return east ? `${head}议行直征,${foes},改与地方分成` : `${head}议由王室直接征税,${foes},改为与地方分成`;
      if (out === 3) return east ? `${head}强行直征,${r}${lord}拒不奉诏` : `${head}强推直接征税,${r}${lord}拒不从命`;
      return east ? `${head}议行直征,${foes},事寝` : `${head}议由王室直接征税,${foes},不了了之`;
    }
    case 3: {
      // 改土归流
      if (out === 0) return east ? `${ref}改土归流,${r}等边州归朝廷直辖` : `${ref}收回边地封授,${r}等地归王室直辖`;
      if (out === 3) return east ? `${ref}改土归流,${r}${lord}拒不奉诏` : `${ref}收回边地封授,${r}${lord}拒不从命`;
      return east ? `${A}议改土归流,${r}等地土官力阻,事寝` : `${A}议收回边地封授,${r}等地领主力阻,作罢`;
    }
    case 4: {
      // 分封边地
      if (out === 0) return east ? `${A}边地难制,${bare}分封${r}等边州,许其自治,岁纳贡赋` : `${A}边地难治,${bare}将${r}等边地封给当地领主自治,岁纳贡赋`;
      return east ? `${A}边地难制,群臣请分封${r}等边州,${court}不许` : `${A}边地难治,有人请将${r}等边地封给当地领主,${court}不许`;
    }
    case 5: {
      // 收兵权:设了边镇的是罢边镇
      if (before(civ, id).army < 0) {
        if (out === 0) return east ? `${ref}罢边镇,${r}等地兵马归朝廷节制` : `${ref}撤销边境军镇,${r}等地兵马重归王室调遣`;
        if (out === 3) return east ? `${ref}罢边镇,${r}${lord}拥兵不受代` : `${ref}撤销边境军镇,${r}${lord}拥兵抗命`;
        return east ? `${A}议罢边镇,${r}等地边将力阻,事寝` : `${A}议撤销边境军镇,${r}等地将领力阻,作罢`;
      }
      if (out === 0) return east ? `${ref}收诸将兵权,精兵尽隶禁军` : `${ref}收回各地领主的兵权,组建王室常备军`;
      if (out === 1) return east ? `${A}议收兵权,${r}等地守将力阻,改遣监军` : `${A}议收回各地兵权,${r}等地领主力阻,改为派员监军`;
      if (out === 3) return east ? `${ref}欲收兵权,${r}${lord}拥兵抗命` : `${ref}要收回兵权,${r}${lord}举兵抗命`;
      return east ? `${A}议收兵权,${r}等地守将力阻,事寝` : `${A}议收回各地兵权,${r}等地领主力阻,作罢`;
    }
    case 6: {
      // 放兵权:收着兵权的是罢禁军,不然是设边镇
      if (before(civ, id).army > 0) {
        if (out === 0) return east ? `${A}禁军所费不赀,罢之,复由州郡征发` : `${A}常备军开销太大,就此裁撤,复由各地征兵`;
        return east ? `${A}群臣请罢禁军,${court}不许` : `${A}有人请裁撤常备军,${court}不许`;
      }
      if (out === 0) return east ? `${A}边事日繁,${bare}置边镇于${r}等地,许边将专兵、自筹军饷` : `${A}边境多事,${bare}在${r}等地设立军镇,由边将自行募兵筹饷`;
      return east ? `${A}群臣请置边镇于${r}等地,${court}不许` : `${A}有人请在${r}等地设立军镇,${court}不许`;
    }
    case 7: {
      // 收任免:许了自辟的是收回辟署
      if (before(civ, id).office < 0) {
        if (out === 0) return east ? `${ref}收回州郡辟署之权,${r}等地长吏复由朝廷选派` : `${ref}收回地方自选官员之权,${r}等地官员复由王室任命`;
        if (out === 3) return east ? `${ref}收辟署之权,${r}豪族据城抗命` : `${ref}收回地方自选官员之权,${r}贵族据城抗命`;
        return east ? `${A}议收辟署之权,${r}等地豪族力阻,事寝` : `${A}议收回地方自选官员之权,${r}等地贵族力阻,作罢`;
      }
      if (out === 0) return east ? `${ref}行铨选之法,${r}等地长吏皆由朝廷选派` : `${ref}改由王室任命各地官员,${r}等地不再由贵族把持`;
      if (out === 1) return east ? `${A}议行铨选,${r}等地豪族力阻,改为铨选、荐举各半` : `${A}议由王室任命各地官员,${r}等地贵族力阻,改为王室和贵族各任一半`;
      if (out === 3) return east ? `${ref}强行铨选,${r}豪族据城抗命` : `${ref}强行任命地方官员,${r}贵族据城抗命`;
      return east ? `${A}议行铨选,${r}等地豪族力阻,事寝` : `${A}议由王室任命各地官员,${r}等地贵族力阻,不了了之`;
    }
    case 8: {
      // 放任免:铨选着的是罢铨选,不然是许自辟
      if (before(civ, id).office > 0) {
        if (out === 0) return east ? `${A}冗官所费不赀,罢铨选之法,复许州郡荐举` : `${A}官员开销太大,不再由王室任命,复由地方推举`;
        return east ? `${A}群臣请罢铨选,${court}不许` : `${A}有人请废除王室任命官员之制,${court}不许`;
      }
      if (out === 0) return east ? `${A}国用不足,地方多事,${bare}许${r}等州郡自辟僚属,豪族世守其地` : `${A}国库空虚,地方不宁,${bare}准许${r}等地贵族自选官员、世袭其职`;
      return east ? `${A}群臣请许州郡自辟僚属,${court}不许` : `${A}有人请准许地方贵族自选官员,${court}不许`;
    }
    case 9: {
      // 改组(分镇)
      if (out === 0) return east ? `${ref}分${r}之镇,${lord}所领诸州尽归朝廷,只留${r}一州` : `${ref}拆分${r}领主的领地,只给他留下${r}一地`;
      if (out === 1) return east ? `${ref}议分${r}之镇,${lord}力争,析其半归朝廷` : `${ref}议拆分${r}领主的领地,领主力争,只收回一半`;
      if (out === 3) return east ? `${ref}议分${r}之镇,${r}${lord}不受命` : `${ref}拆分${r}领主的领地,${lord}举兵抗命`;
      return east ? `${A}议分${r}之镇,恐其生变,事寝` : `${A}议拆分${r}领主的领地,恐其生变,作罢`;
    }
    default: {
      // 脱离:地方提的(b = 想转投的邻国);谈崩的后面紧跟着自立那一条
      const B = pn(civ, e.b, y);
      if (out === 0) return east ? `${A}${r}${lord}举所领诸州归附${B},朝廷不能制` : `${A}的${r}${lord}率领地改投${B},${court}无力阻止`;
      if (out === 3) return east ? `${A}${r}${lord}欲以所领诸州归附${B},${court}不许,遂举兵` : `${A}的${r}${lord}想改投${B},${court}不准,${lord}举兵抗命`;
      return east ? `${A}${r}${lord}欲以所领诸州归附${B},朝廷遣使抚谕,事寝` : `${A}的${r}${lord}想改投${B},王室派人安抚,作罢`;
    }
  }
}

/** 各条议事议之前那国的军制、官制(council.ts 的 councilBefore;按史事数组缓存,接着推长了就重算) */
const beforeCache = new WeakMap<readonly Annal[], ReturnType<typeof councilBefore>>();
function before(civ: Civ, id: number): { army: number; office: number } {
  let b = beforeCache.get(civ.annals);
  if (!b || b.length !== civ.annals.length) beforeCache.set(civ.annals, (b = councilBefore(civ.annals)));
  return b[id] ?? { army: 0, office: 0 };
}

/** 一州闹饥荒(地震水旱:cause = quake)时城里的人口折损(Settlement.sacks 里同一种、同一年的那一条;找不到 = 0) */
function famineLoss(civ: Civ, e: Annal): number {
  const s = e.settlement >= 0 ? civ.settlements[e.settlement] : undefined;
  const cause = e.cause === 'quake' ? 'quake' : 'famine';
  return s?.sacks?.find((k) => k.cause === cause && k.year === e.year)?.loss ?? 0;
}

/** "死者十之二"(按灾最重那州城里的折损;一成以下的不写);三成以上的加"人相食" */
function famineToll(loss: number): string {
  const k = Math.round(loss * 10);
  if (k < 1) return '';
  return `${k >= 3 ? ',人相食' : ''},死者十之${cnNumber(k)}`;
}

/**
 * 饥荒:"大渭瑞州等三州大饥,死者十之二"(标签"饥")。
 * 「天灾」多 / 很多时自己发生的地震水旱(cause = quake,没有干预那一条可并):"大渭瑞州一带地震,城郭多圮,死者十之二"
 */
function famineText(civ: Civ, e: Annal): string {
  const r = regionName(civ, e.region) || cityName(civ, e.settlement);
  if (e.cause === 'quake') {
    const s = e.settlement >= 0 ? civ.settlements[e.settlement] : undefined;
    const from = s?.sacks?.find((k) => k.cause === 'quake' && k.year === e.year)?.from ?? e.region;
    const word = from >= 0 ? quakeWord(civ.regions, from) : '地震';
    const what = word === '大水' ? '大水,漂没城郭' : word === '大旱' ? '大旱,赤地千里' : '地震,城郭多圮';
    const k = Math.round(famineLoss(civ, e) * 10);
    return `${e.a >= 0 ? pn(civ, e.a, e.year) : ''}${r || '境内'}一带${what}${e.b > 1 ? `,${cnNumber(e.b)}州受灾` : ''}${k >= 1 ? `,死者十之${cnNumber(k)}` : ''}`;
  }
  const where = e.b > 1 ? `${r || '诸州'}等${cnNumber(e.b)}州` : r || '境内';
  return `${e.a >= 0 ? pn(civ, e.a, e.year) : ''}${where}大饥${famineToll(famineLoss(civ, e))}`;
}

/**
 * 民变(史事 revolt + 讨伐它的那场战争)写成一条:"瑞州大饥,饥民奉李昭为主,据瑞城起事,号瑞国,叛大渭"
 * 再写结局:"旋为大渭所平"("十二年后为大渭所平")/ "攻破汾城,大渭亡"(大事)/ "得汾州等三州,与大渭议和,割据一方"/ "战事未休"。
 * 标签"起";子条目是那场战争的每一件事(讨伐、攻占、战役、议和、亡国)。攻破都城、亡了原来国家的是大事
 */
function revoltEntry(ctx: Ctx, ids: number[]): ChronicleEntry {
  const { civ } = ctx;
  const A = civ.annals;
  const e = A[ids[0]];
  const y = e.year;
  const rebel = e.a;
  const court = e.b;
  const war = warEntry(ctx, ids.slice(1));
  const list = ids.map((i) => A[i]);
  const r = regionName(civ, e.region);
  const city = cityName(civ, e.settlement);
  const lead = founderOf(ctx.ix, rebel, 0);
  const who = lead && lead.rise === 'rebel' ? lead : null;
  const t = `${r || city || '境内'}大饥,饥民${who ? `奉${who.name}为主,` : ''}${city ? `据${city}起事` : '起事'},号${pn(civ, rebel, y)},叛${pn(civ, court, y)}`;
  const fallR = list.find((f) => f.kind === 'fall' && f.a === rebel);
  const fallC = list.find((f) => f.kind === 'fall' && f.a === court && f.b === rebel);
  const peace = list.find((f) => f.kind === 'peace');
  let outcome: string;
  if (fallC) {
    const C = polityOf(civ, court);
    const cap = C ? cityName(civ, capitalBefore(C, fallC.year)) : '';
    const n = Math.floor(fallC.year) - Math.floor(y);
    outcome = `${n >= 2 ? `${n} 年后` : ''}攻破${cap || '都城'},${pn(civ, court, fallC.year)}亡`;
  } else if (fallR) {
    const n = Math.floor(fallR.year) - Math.floor(y);
    outcome = `${n >= 2 ? `${n} 年后` : '旋'}为${pn(civ, court, fallR.year)}所平`;
  } else if (peace) {
    // 净得的州:最后是起事的一方打下来的
    const lastBy = new Map<number, number>();
    for (const c of list) if (c.kind === 'conquer' && c.region >= 0) lastBy.set(c.region, c.a);
    const got = [...lastBy].filter(([, by]) => by === rebel).map(([q]) => q);
    outcome = `${got.length ? `得${regionList(civ, got)},` : ''}与${pn(civ, court, peace.year)}议和,割据一方`;
  } else outcome = '战事未休';
  const polities = uniq([rebel, court, ...war.polities]);
  return withPeople(
    {
      ...war,
      id: ids[0],
      kind: 'revolt',
      year: y,
      text: `${t},${outcome}`,
      tag: '起',
      importance: fallC ? 3 : 2,
      polities,
      regions: uniq([e.region, ...war.regions]),
      settlement: e.settlement,
      head: undefined,
      // 只记句子里写到的人(讨伐的统帅写在子条目里)
      people: undefined,
    },
    who,
  );
}

/** 紧跟在大崩解后面、并进那一条的:那几块自立(split,cause = collapse) */
function collapseTail(e: Annal, head: Annal): boolean {
  return e.year === head.year && e.kind === 'split' && e.cause === 'collapse' && e.b === head.a;
}

/**
 * 大崩解:"大渭大乱,瑞州、汾州、雪西各自立国,大渭仅保汾城一隅"(地方崩加"诸州残破";散回部落:"大渭土崩瓦解,
 * 二十三州散为部落,大渭仅保汾城一隅")。标签"崩",一律是大事;子条目是各块自立("瑞州守将李昭叛大渭自立,号瑞国,都于瑞城")
 */
function collapseEntry(ctx: Ctx, ids: number[]): ChronicleEntry {
  const { civ } = ctx;
  const A = civ.annals;
  const e = A[ids[0]];
  const y = e.year;
  const P = pn(civ, e.a, y);
  const city = cityName(civ, e.settlement) || regionName(civ, e.region);
  const keep = city ? `,${P}仅保${city}一隅` : '';
  const pieces = ids.slice(1).map((i) => A[i]);
  const children = ids.slice(1).map((i) => simpleEntry(ctx, A[i], i));
  let text: string;
  if (e.b === 2) text = `${P}土崩瓦解,${e.war > 0 ? `${cnNumber(e.war)}州` : '诸州'}散为部落${keep}`;
  else {
    const names = uniq(pieces.map((s) => s.region)).map((r) => regionName(civ, r)).filter(Boolean);
    const rose = names.length ? `${names.join('、')}各自立国` : '诸州各自立国';
    text = `${P}大乱,${e.b === 1 ? '诸州残破,' : ''}${rose}${keep}`;
  }
  return {
    ...base(e, ids[0], text, 3, uniq([e.a, ...pieces.map((s) => s.a)]), uniq(pieces.map((s) => s.region))),
    ...(children.length ? { children } : {}),
  };
}

/** 大瘟疫染了至少这么多州才写成"天下大疫" */
const GREAT_WRITE = 30;

/** "死者十之二"(大瘟疫"十之三四");不到一成的不写 */
function plagueToll(loss: number, great: boolean): string {
  const k = Math.round(loss * 10);
  if (k < 1) return '';
  return `死者十之${cnNumber(k)}${great && k < 9 ? cnNumber(k + 1) : ''}`;
}

/**
 * 瘟疫(plague.ts;同一场的几条史事 plague 折成一条):"大疫起于维罗拉,传至特罗纳、哈尔兰、碧台等地,5 年间诸国死者十之二"
 * (只在一国:"…,5 年间大渭死者十之一";没传开:"大渭维罗拉大疫,死者十之一";大瘟疫染了 GREAT_WRITE 州以上:"天下大疫,起于维罗拉,
 * 传至…等五国四十州,12 年乃息(起疫那年也算一年),死者十之三四")。死几成按染疫各城的平均。标签"疫";大瘟疫、传到三国以上、死者十之二以上的是大事。
 * 子条目是逐年传到哪("大渭维罗拉起疫""疫传至大渭瑞州等三州")
 */
function plagueEntry(ctx: Ctx, ids: number[]): ChronicleEntry {
  const { civ } = ctx;
  const A = civ.annals;
  const e = A[ids[0]];
  const span = plagueSpans(civ).find((x) => x.id === e.war);
  const hits = span?.hits ?? [];
  // 大瘟疫没传开的(港口孤悬、头几年就止住了)照一般的大疫写
  const great = e.cause === 'great' && hits.length >= GREAT_WRITE;
  const mean = hits.length ? hits.reduce((a, h) => a + h.loss, 0) / hits.length : 0;
  const toll = plagueToll(mean, great);
  const end = Math.max(A[ids[ids.length - 1]].year, span?.end ?? e.year);
  const origin = cityName(civ, e.settlement) || regionName(civ, e.region) || '一城';
  const list = ids.map((i) => A[i]);
  const polities = uniq(list.map((x) => x.a).filter((p) => p >= 0));
  // 传到哪:后来几条各写死得最多的那城(和起疫的不重名),最多三处
  const places: string[] = [];
  for (const x of list.slice(1)) {
    const n = cityName(civ, x.settlement) || regionName(civ, x.region);
    if (n && n !== origin && !places.includes(n)) places.push(n);
  }
  const shown = places.slice(0, 3).join('、');
  const more = places.length > 3 ? '等地' : '';
  // 闹了几个年头(起疫那年、最后染上的那年都算)
  const years = Math.floor(end) - Math.floor(e.year) + 1;
  let text: string;
  if (great) {
    // "天下"留给全球大疫(pandemicEntries):大瘟疫只传一片
    const where = shown ? `,传至${shown}等${polities.length > 1 ? `${cnNumber(polities.length)}国` : ''}${cnNumber(hits.length)}州` : '';
    text = `大疫,起于${origin}${where}${years >= 2 ? `,${years} 年乃息` : ''}${toll ? `,${toll}` : ''}`;
  } else if (!shown) text = `${pn(civ, e.a, e.year)}${origin}大疫${toll ? `,${toll}` : ''}`;
  else {
    const who = polities.length > 1 ? '诸国' : pn(civ, e.a, e.year);
    text = `大疫起于${origin},传至${shown}${more}${toll ? `,${years >= 2 ? `${years} 年间` : ''}${who}${toll}` : ''}`;
  }
  const children =
    ids.length > 1
      ? ids.map((i, n) => {
          const x = A[i];
          const r = regionName(civ, x.region) || cityName(civ, x.settlement) || '一州';
          const where = x.b > 1 ? `${r}等${cnNumber(x.b)}州` : r;
          return base(x, i, n === 0 ? `${pn(civ, x.a, x.year)}${origin}起疫` : `疫传至${pn(civ, x.a, x.year)}${where}`, 1, [x.a], [x.region]);
        })
      : undefined;
  const big = great || polities.length >= 3 || mean >= 0.195;
  return {
    // 点这一条时标出染过疫的每一州(史事一国一年只记死得最多的那州)
    ...base(e, ids[0], text, big ? 3 : 2, polities, uniq([...list.map((x) => x.region), ...hits.map((h) => h.region)])),
    end,
    ...(children ? { children } : {}),
  };
}

/** 全球大疫:一块陆地上有这么多州才算一"洲"(传遍几洲只数这样的) */
const CONTINENT_REGIONS = 12;

/** 第 year 年天下人口(千人;各州的城 + 乡村) */
function worldPopulationAt(civ: Civ, year: Year): number {
  let sum = 0;
  for (let r = 0; r < civ.regions.count; r++) sum += regionPopulationAt(civ, r, year);
  return sum;
}

/** "六十余处"(二十以上按十取整;整十的不写"余")、"十三处" */
function placeCount(n: number): string {
  if (n < 20) return `${cnNumber(n)}处`;
  const tens = Math.floor(n / 10) * 10;
  return `${cnNumber(tens)}${n > tens ? '余' : ''}处`;
}

/**
 * 全球大疫(pandemic.ts;史事 pandemic 和同一场的几条 plague):
 * "克尔顿大疫:起于克尔顿,循航线传遍四洲,至五百六十一州,9 年乃息。城中死者十之四五,天下人口十去其二"(大事,标签"疫";
 * 子条目是逐年传到哪,同瘟疫);凋敝结束(推到了那年)另一条"疫后凋敝三十年,至是始复。天下城邑荒废者六十余处,道路断绝近半"(大事)。
 * 天下人口按起疫时记下的疫前人口(史事 pandemic 的 n)和传完下一年的比
 */
function pandemicEntries(ctx: Ctx, at: number, ids: number[]): ChronicleEntry[] {
  const { civ } = ctx;
  const A = civ.annals;
  const e = A[at];
  const info = pandemicsOf(civ).find((p) => p.annal === at);
  const hits = info?.hits ?? [];
  const origin = cityName(civ, e.settlement) || regionName(civ, e.region) || '一城';
  const list = ids.map((i) => A[i]);
  const polities = uniq(list.map((x) => x.a).filter((p) => p >= 0));
  const last = Math.max(e.year, ...hits.map((h) => h.year), ...list.map((x) => x.year));
  const years = Math.floor(last) - Math.floor(e.year) + 1;
  // 传遍几洲:染了疫的大陆(一块陆地上有 CONTINENT_REGIONS 州以上)
  const lm = civ.regions.landmass;
  const size = new Map<number, number>();
  for (let r = 0; r < civ.regions.count; r++) size.set(lm[r], (size.get(lm[r]) ?? 0) + 1);
  const lands = new Set<number>();
  for (const h of hits) if ((size.get(lm[h.region]) ?? 0) >= CONTINENT_REGIONS) lands.add(lm[h.region]);
  const reach = lands.size >= 2 ? `,循航线传遍${cnNumber(lands.size)}洲` : '';
  const mean = hits.length ? hits.reduce((s, h) => s + h.loss, 0) / hits.length : 0;
  const k = Math.round(mean * 10);
  const cityToll = k >= 1 ? `城中死者十之${cnNumber(k)}${k < 9 ? cnNumber(k + 1) : ''}` : '';
  // 天下人口:疫前(史事里记的)和传完的下一年
  const after = Math.min(civ.endYear, Math.floor(last) + 1);
  const drop = e.n && e.n > 0 ? 1 - worldPopulationAt(civ, after) / e.n : 0;
  const d = Math.round(drop * 10);
  const popToll = d >= 1 ? `天下人口十去其${cnNumber(d)}` : '';
  const tolls = [cityToll, popToll].filter(Boolean).join(',');
  const text = `${origin}大疫:起于${origin}${reach}${hits.length > 1 ? `,至${cnNumber(hits.length)}州` : ''}${years >= 2 ? `,${years} 年乃息` : ''}${tolls ? `。${tolls}` : ''}`;
  const children =
    ids.length > 1
      ? ids.map((i, n) => {
          const x = A[i];
          const r = regionName(civ, x.region) || cityName(civ, x.settlement) || '一州';
          const where = x.b > 1 ? `${r}等${cnNumber(x.b)}州` : r;
          return { ...base(x, i, n === 0 ? `${pn(civ, x.a, x.year)}${origin}起疫` : `疫传至${pn(civ, x.a, x.year)}${where}`, 1, [x.a], [x.region]), kind: 'plague' as const };
        })
      : undefined;
  const out: ChronicleEntry[] = [
    {
      ...base(e, ids[0] ?? at, text, 3, polities.length ? polities : e.a >= 0 ? [e.a] : [], uniq([e.region, ...hits.map((h) => h.region)].filter((r) => r >= 0))),
      kind: 'plague',
      end: last,
      ...(children ? { children } : {}),
    },
  ];
  // 凋敝结束(推到了那年;没传开的不写)
  if (info && ids.length && info.end <= civ.endYear) {
    const parts = [`疫后凋敝${cnNumber(info.slump)}年,至是始复`];
    const n = info.desolated.length;
    const roads = brokenRoads(civ, info.year, info.end);
    const roadText = roads >= 0.4 ? '道路断绝近半' : roads >= 0.2 ? '道路多有断绝' : roads >= 0.05 ? '道路间有断绝' : '';
    const tail = [n ? `天下城邑荒废者${placeCount(n)}` : '', roadText].filter(Boolean).join(',');
    if (tail) parts.push(tail);
    out.push({
      ...base({ ...e, year: info.end }, at, parts.join('。'), 3, [], uniq(hits.map((h) => h.region))),
      kind: 'plague',
    });
  }
  return out;
}

/** 起疫时通着的陆路里,到凋敝结束断了几成(推完以后的路表;荒废的城、失修的路都算) */
function brokenRoads(civ: Civ, from: Year, to: Year): number {
  let all = 0;
  let cut = 0;
  for (const r of civ.routes) {
    if (r.kind === 'sea' || r.built > from || (r.abandoned ?? Infinity) <= from) continue;
    all++;
    if ((r.abandoned ?? Infinity) <= to) cut++;
  }
  return all ? cut / all : 0;
}

/** 疫后城邑荒废(史事 desolate,同一场、同一国折成一条):"埃维里亚帝国疫后城邑荒废:塞尔维尔、伦盖特、阿斯特顿等十三处,道路断绝" */
function desolateEntry(ctx: Ctx, ids: number[]): ChronicleEntry {
  const { civ } = ctx;
  const A = civ.annals;
  const e = A[ids[0]];
  const list = ids.map((i) => A[i]);
  const names = [...new Set(list.map((x) => cityName(civ, x.settlement) || regionName(civ, x.region)).filter(Boolean))];
  const shown = names.slice(0, 3).join('、');
  const who = e.a >= 0 ? pn(civ, e.a, e.year) : '诸部';
  const n = list.length;
  const what = shown ? `:${shown}${n > 3 || names.length < n ? `等${cnNumber(n)}处` : ''}` : `${cnNumber(n)}处`;
  const children = list.map((x, j) => ({ ...base(x, ids[j], `${cityName(civ, x.settlement) || regionName(civ, x.region) || '一城'}荒废`, 1, x.a >= 0 ? [x.a] : [], [x.region]), kind: 'plague' as const }));
  return {
    ...base(e, ids[0], `${who}疫后城邑荒废${what},道路断绝`, n >= 5 ? 3 : 2, e.a >= 0 ? [e.a] : [], uniq(list.map((x) => x.region))),
    kind: 'plague',
    end: list[list.length - 1].year,
    ...(n > 1 ? { children } : {}),
  };
}

/** 战役里攻方从哪种边打过去(AdjKind:平地、跨河、翻山、海峡、航线) */
const VIA = ['', '渡河', '翻山', '渡海', '浮海'];
/** 据险断后的那支兵有多少人(编年史随手挑一个说法) */
const STAND_MEN = ['三百', '五百', '七百', '八百', '数百', '千余'];

// ---------------------------------------------------------------------------
// 同化与迁徙(阶段 3):史事的 a、b 是民族,war 列借来记国家

/** 同化的一州:"瑞州的居兰人渐为渭人" */
function assimChild(civ: Civ, e: Annal, id: number): ChronicleEntry {
  const r = regionName(civ, e.region) || '一州';
  return { ...base(e, id, `${r}的${folk(civ, e.b)}渐为${folk(civ, e.a)}`, 1, [e.war], [e.region]), settlement: -1 };
}

/** 随征服而来的移民(起因的国家是迁徙民族自己的国家) */
function isSettlers(civ: Civ, e: Annal): boolean {
  return polityOf(civ, e.war)?.culture === e.a;
}

/** 迁徙的一州:"居兰人迁入疏勒原(原为乌耐人所居)" */
function migrateChild(civ: Civ, e: Annal, id: number, inWave: boolean): ChronicleEntry {
  const r = regionName(civ, e.region) || '一州';
  const verb = isSettlers(civ, e) ? '徙居' : '迁入';
  const was = e.b >= 0 ? `(原为${folk(civ, e.b)}所居)` : '(原为无人之地)';
  return { ...base(e, id, `${folk(civ, e.a)}${verb}${r}${was}`, inWave ? 2 : 1, [e.war], [e.region]), settlement: -1 };
}

/** 迁徙的方位(Culture.migrations 里同一年的那一波;同一年有几波按先后对上) */
function migrationDir(civ: Civ, e: Annal, used: Map<number, number>): MigrationDir | null {
  const list = cultureOf(civ, e.a)?.migrations ?? [];
  const from = used.get(e.a) ?? 0;
  for (let i = from; i < list.length; i++) {
    if (list[i].year === e.year) {
      used.set(e.a, i + 1);
      return list[i].dir;
    }
  }
  return null;
}

/** 随征服南下 / 北上 / 东进 / 西进 */
const ADVANCE: Record<MigrationDir, string> = { 东: '东进', 西: '西进', 南: '南下', 北: '北上' };

/** 一波迁徙(同一刻、同一民族、同一起因)折成一条 */
function migrationEntry(ctx: Ctx, ids: number[], dirUsed: Map<number, number>): ChronicleEntry {
  const { civ } = ctx;
  const A = civ.annals;
  const e0 = A[ids[0]];
  const dir = migrationDir(civ, e0, dirUsed);
  const regions = uniq(ids.map((i) => A[i].region));
  const where = regionList(civ, regions) || '他处';
  const who = cn(civ, e0.a);
  let text: string;
  if (isSettlers(civ, e0)) text = `${who}随${pn(civ, e0.war, e0.year)}${dir ? ADVANCE[dir] : '而来'},徙居${where}`;
  else if (e0.war >= 0) {
    text = `${who}避${pn(civ, e0.war, e0.year)}兵锋${dir ? `${dir}迁` : '外迁'},入${where}`;
    ctx.flight.set(ids[0], `${who}${dir ? `${dir}迁` : '外迁'},入${where}`);
  }
  else text = `${who}${dir ? `${dir}迁` : '迁徙'},入${where}`;
  const kids = ids.map((i) => migrateChild(civ, A[i], i, true));
  const importance: Importance = regions.length >= MIGRATE_MAJOR ? 3 : 2;
  return {
    id: ids[0],
    kind: 'migrate',
    year: e0.year,
    end: e0.year,
    text,
    tag: '徙',
    importance,
    polities: uniq([e0.war]),
    regions,
    settlement: -1,
    children: kids.length > 1 ? kids : undefined,
  };
}

/** 同化:同一国治下、同一对民族,相隔不到 ASSIM_GAP 年的折成一段(一段最长 ASSIM_SPAN 年) */
function assimEntries(ctx: Ctx, groups: Map<string, number[]>, out: ChronicleEntry[]) {
  const { civ } = ctx;
  const A = civ.annals;
  for (const ids of groups.values()) {
    let group: number[] = [];
    const flush = () => {
      if (!group.length) return;
      const first = A[group[0]];
      const last = A[group[group.length - 1]];
      const regions = uniq(group.map((i) => A[i].region));
      const where = regionList(civ, regions) || '一州';
      const P = polityOf(civ, first.war);
      let text: string;
      if (P && P.culture === first.b) text = `${pn(civ, first.war, first.year)}的${folk(civ, first.b)}渐染${cultureOf(civ, first.a)?.name ?? '异族'}俗,${where}渐为${folk(civ, first.a)}`;
      else if (P) text = `${pn(civ, first.war, first.year)}治下,${where}的${folk(civ, first.b)}渐为${folk(civ, first.a)}`;
      else text = `${where}的${folk(civ, first.b)}渐为${folk(civ, first.a)}`;
      const importance: Importance = regions.length >= ASSIM_MAJOR ? 3 : regions.length >= ASSIM_MINOR ? 2 : 1;
      const kids = group.map((i) => assimChild(civ, A[i], i));
      out.push({
        id: group[0],
        kind: 'assimilate',
        year: first.year,
        end: last.year,
        text,
        tag: '化',
        importance,
        polities: uniq([first.war]),
        regions,
        settlement: -1,
        children: kids.length > 1 ? kids : undefined,
      });
      group = [];
    };
    for (const i of ids) {
      if (group.length && (A[i].year - A[group[group.length - 1]].year > ASSIM_GAP || A[i].year - A[group[0]].year > ASSIM_SPAN)) flush();
      group.push(i);
    }
    flush();
  }
}

// ---------------------------------------------------------------------------
// 收服部落:同一国接连几次折叠成一条

function tribalEntries(ctx: Ctx, byPolity: Map<number, number[]>, out: ChronicleEntry[]) {
  const { civ } = ctx;
  const A = civ.annals;
  for (const [pid, ids] of byPolity) {
    let group: number[] = [];
    const flush = () => {
      if (!group.length) return;
      const kids = group.map((i) => simpleEntry(ctx, A[i], i));
      if (kids.length === 1) out.push(kids[0]);
      else {
        const first = A[group[0]];
        const last = A[group[group.length - 1]];
        const regions = uniq(group.map((i) => A[i].region));
        out.push({
          id: group[0],
          kind: 'conquer',
          year: first.year,
          end: last.year,
          text: `${pn(civ, pid, first.year)}征服${regionList(civ, regions)}诸部`,
          tag: '征',
          importance: 1,
          polities: [pid],
          regions,
          settlement: -1,
          children: kids,
        });
      }
      group = [];
    };
    for (const i of ids) {
      if (group.length && (A[i].year - A[group[group.length - 1]].year > TRIBAL_GAP || A[i].year - A[group[0]].year > TRIBAL_SPAN)) {
        flush();
      }
      group.push(i);
    }
    flush();
  }
}

// ---------------------------------------------------------------------------
// "大事"里合写:同一国家短时间里连着的几件大事,后一件写进前一件里,"大事"里不再单占一行("全部"里照旧单列)

/** 前一件事之后这么多年以内的,合写进前一件 */
export const COMBINE_GAP = 10;

/** 合写:返回"哪一条里说了哪几国的来历"(合写进改朝换代那一条的分裂) */
function combine(ctx: Ctx, list: ChronicleEntry[]): Map<ChronicleEntry, number> {
  const told = new Map<ChronicleEntry, number>();
  const { civ } = ctx;
  const A = civ.annals;
  const later = (n: number) => (n >= 1 ? `${cnNumber(n)}年后` : '同年');
  for (let k = 0; k < list.length; k++) {
    const e = list[k];
    if (e.importance < MAJOR) continue;
    // 改朝换代之后不久就有州叛离:"…国号大辰;七年后喀勒川叛大辰王朝自立,号库兹汗国"
    if (e.kind === 'split' && e.polities.length > 1) {
      const from = e.polities[1];
      let d: ChronicleEntry | undefined;
      for (let j = k - 1; j >= 0 && e.year - list[j].year <= COMBINE_GAP; j--) {
        const x = list[j];
        if (x.kind === 'dynasty' && x.importance >= MAJOR && x.polities[0] === from) {
          d = x;
          break;
        }
      }
      if (d) {
        d.text += `;${later(Math.floor(e.year) - Math.floor(d.year))}${e.text}`;
        d.polities = uniq([...d.polities, ...e.polities]);
        d.regions = uniq([...d.regions, ...e.regions]);
        if (e.people?.length) d.people = uniq([...(d.people ?? []), ...e.people]);
        e.importance = 2;
        told.set(d, e.polities[0]);
      }
    }
    // 亡国(失地)之后逃难的一波迁徙:"…,艾莱斯国亡,艾莱斯族南迁,入阿拉斯等五州"
    const short = e.kind === 'migrate' ? ctx.flight.get(e.id) : undefined;
    if (short) {
      const by = A[e.id].war;
      const folk = A[e.id].a;
      let w: ChronicleEntry | undefined;
      for (let j = k - 1; j >= 0; j--) {
        const x = list[j];
        if (x.kind !== 'war' || x.importance < MAJOR || e.year - x.end > COMBINE_GAP || e.year < x.year) continue;
        const [a, b] = x.polities;
        const other = a === by ? b : b === by ? a : -1;
        if (other >= 0 && polityOf(civ, other)?.culture === folk) {
          w = x;
          break;
        }
      }
      if (w) {
        w.text += `,${short}`;
        w.regions = uniq([...w.regions, ...e.regions]);
        e.importance = 2;
      }
    }
  }
  return told;
}

// ---------------------------------------------------------------------------
// "大事"里的来历:只看大事时,第一次出现、来历没说过的国家带一句来历

/**
 * 改了国号的国家,旧国号 root 那一朝最后一刻(改朝换代的前一刻)的全称,和到 year 年为止又改了几次:
 * "原居兰汗国"、"原居兰汗国,两度易代"。找不到 = "原" + root
 */
function renamedFrom(p: Polity, root: string, year: Year): string {
  const d = p.dynasties ?? [];
  const now = dynastyIndexAt(p, year);
  for (let i = Math.min(now, d.length - 1); i >= 1; i--) {
    if (polityRootAt(p, d[i - 1].year) !== root) continue;
    const n = now - i + 1;
    return `原${polityName(p, d[i].year - 1 / 512)}${n >= 2 ? `,${n === 2 ? '两' : cnNumber(n)}度易代` : ''}`;
  }
  return `原${root}`;
}

/** 这个国家在 year 年可能写进纪事里的名字(四档全称 + 简称;长的在前) */
function namesOf(p: Polity, year: Year): string[] {
  const out = new Set<string>(polityTitles(p, year));
  for (let t = 0; t < 4; t++) out.add(polityShortTitle(p, t, year));
  return [...out].filter(Boolean).sort((a, b) => b.length - a.length);
}

/** 名字在正文里第一次出现的位置(不算嵌在别国名字里的:"后高弥汗国"里的"高弥汗国");没有 = null */
function firstMention(text: string, mine: string[], others: string[]): { at: number; len: number } | null {
  const spans: [number, number][] = [];
  for (const n of others) for (let i = text.indexOf(n); i >= 0; i = text.indexOf(n, i + 1)) spans.push([i, i + n.length]);
  let best: { at: number; len: number } | null = null;
  for (const n of mine) {
    for (let i = text.indexOf(n); i >= 0; i = text.indexOf(n, i + 1)) {
      const end = i + n.length;
      if (spans.some(([s, e]) => s <= i && e >= end && e - s > n.length)) continue;
      if (!best || i < best.at || (i === best.at && n.length > best.len)) best = { at: i, len: n.length };
      break;
    }
  }
  return best;
}

/**
 * 只看"大事"也读得懂:按先后翻大事,每个国家第一次出现、它的来历(立国 / 分裂 / 复国)不在大事里的,名字后面带一句来历:
 * "艾莱斯国(第 1850 年立国)"、"塔提特汗国(第 2082 年叛哈尔提亚王国自立)"、"新塔提特汗国(第 2455 年脱哈尔提亚帝国复国)";
 * 改朝换代换了国号(东方小一些的国家改朝换代不是大事)、新国号在大事里第一次出现的:"伊罗汗国(原居兰汗国)"。
 * 只改大事的正文(全部里也是这一条,多一句来历不碍事)。分成小步(同 chronicleSteps)
 */
function* introduce(civ: Civ, list: ChronicleEntry[], told: ReadonlyMap<ChronicleEntry, number>): Generator<void, void> {
  const A = civ.annals;
  // 每个国家的来历(立国 / 分裂 / 复国那条史事)
  const origin = new Map<number, Annal>();
  for (const e of A) if ((e.kind === 'found' || e.kind === 'split' || e.kind === 'revolt') && e.a >= 0 && !origin.has(e.a)) origin.set(e.a, e);
  /** 国家 → 大事里最近一次出现时的国号词根 */
  const shown = new Map<number, string>();
  let n = 0;
  for (const e of list) {
    if (++n % 512 === 0) yield;
    if (e.importance < MAJOR) continue;
    const y = e.year;
    const pids = e.polities.filter((id) => polityOf(civ, id));
    const personNames = (e.people ?? []).map((k) => civ.people?.[k]?.name ?? '').filter(Boolean);
    // 立国、分裂、复国这一条本身就是来历(干预"立国"那一条也是)
    const founding = e.kind === 'found' || e.kind === 'split' || e.kind === 'revolt' || (e.kind === 'intervene' && civ.interventions?.[A[e.id]?.war]?.kind === 'found');
    if (founding && pids.length) shown.set(pids[0], polityRootAt(civ.polities[pids[0]], y));
    const also = told.get(e);
    if (also !== undefined && polityOf(civ, also)) shown.set(also, polityRootAt(civ.polities[also], y));
    const names = new Map<number, string[]>();
    const nameAt = (id: number) => {
      let n = names.get(id);
      if (!n) {
        const p = civ.polities[id];
        // 改朝换代这一条写的是旧朝的国号("大昌享国 312 年而亡")
        n = e.kind === 'dynasty' && id === pids[0] ? namesOf(p, y - 1 / 512) : namesOf(p, y);
        names.set(id, n);
      }
      return n;
    };
    // 位置都按原文找(不在加进去的来历里找),最后从后往前插
    const inserts: { at: number; note: string }[] = [];
    for (const id of pids) {
      const p = civ.polities[id];
      // 只管正文里写到的(战争的子条目里才有的第三国不算出现过);嵌在人名里的不算
      const m = firstMention(e.text, nameAt(id), [...pids.filter((x) => x !== id).flatMap(nameAt), ...personNames]);
      if (!m) continue;
      // 改朝换代这一条写的是旧朝的国号:按前一刻算
      const at = e.kind === 'dynasty' && id === pids[0] ? y - 1 / 512 : y;
      const root = polityRootAt(p, at);
      const was = shown.get(id);
      let note = '';
      if (was === undefined) {
        const o = origin.get(id);
        if (o) {
          const oy = o.year;
          if (o.kind === 'found') note = `第 ${Math.floor(oy)} 年立国`;
          else if (o.kind === 'revolt') note = o.b >= 0 ? `第 ${Math.floor(oy)} 年饥民起事,叛${pn(civ, o.b, oy)}自立` : `第 ${Math.floor(oy)} 年饥民起事`;
          else if (p.restores !== undefined) note = o.b >= 0 ? `第 ${Math.floor(oy)} 年脱${pn(civ, o.b, oy)}复国` : `第 ${Math.floor(oy)} 年复国`;
          else note = o.b >= 0 ? `第 ${Math.floor(oy)} 年叛${pn(civ, o.b, oy)}自立` : `第 ${Math.floor(oy)} 年自立`;
          const first = polityRootAt(p, oy);
          if (first !== root) note += `,${renamedFrom(p, first, at)}`;
        }
      } else if (was !== root) note = renamedFrom(p, was, at);
      if (note) inserts.push({ at: m.at + m.len, note });
      shown.set(id, e.kind === 'dynasty' && id === pids[0] ? polityRootAt(p, y) : root);
    }
    inserts.sort((a, b) => b.at - a.at);
    for (const { at, note } of inserts) e.text = `${e.text.slice(0, at)}(${note})${e.text.slice(at)}`;
  }
}

// ---------------------------------------------------------------------------

const cache = new WeakMap<Civ, ChronicleEntry[]>();

/**
 * 别处已经替这份 civ 算好的编年史(后台线程按同样的历史、同样的改名算的,和 buildChronicle(civ) 逐条一样):记进缓存,不再重算。
 * 已经算过的不换
 */
export function primeChronicle(civ: Civ, entries: ChronicleEntry[]) {
  if (!cache.has(civ)) cache.set(civ, entries);
}

/** 这份 civ 的编年史已经算过(或别处替它算好了) */
export function chronicleCached(civ: Civ): boolean {
  return cache.has(civ);
}

/** 一步一步走完(同步) */
export function runSteps<T>(g: Generator<void, T>): T {
  for (;;) {
    const r = g.next();
    if (r.done) return r.value;
  }
}

/** civ.annals → 编年史条目(按年份排好;同一年按发生先后)。按 civ 缓存 */
export function buildChronicle(civ: Civ): ChronicleEntry[] {
  return cache.get(civ) ?? runSteps(chronicleSteps(civ));
}

/**
 * 同 buildChronicle,分成许多小步(每一步不到一毫秒):界面可以一块一块地算,块与块之间让出主线程(src/ui/chronicleHandoff.ts)。
 * 走完和 buildChronicle 的结果逐条一样,记进同一个缓存;走的中途别处已经算好了的,用先算好的那份
 */
export function* chronicleSteps(civ: Civ): Generator<void, ChronicleEntry[]> {
  const hit = cache.get(civ);
  if (hit) return hit;
  const A = civ.annals ?? [];
  const splitFrom = new Map<number, number>();
  for (const e of A) if (e.kind === 'split' && e.a >= 0 && e.b >= 0) splitFrom.set(e.a, e.b);
  const quell = new Map<number, number>();
  for (const e of A) if (e.kind === 'war' && (e.cause === 'quell' || e.cause === 'heir')) quell.set(e.war, e.b);
  const retake = retakes(A);
  yield;
  const ctx: Ctx = { civ, titleUsed: new Map(), retake, splitFrom, flight: new Map(), ix: peopleOf(civ), quell };
  yield;
  const out: ChronicleEntry[] = [];
  const wars = new Map<number, number[]>();
  const plagues = new Map<number, number[]>();
  const tribal = new Map<number, number[]>();
  // 全球大疫(pandemic.ts):起疫那条(第几场 → 下标);疫后荒废的城按"第几场 + 国家"折成一条
  const pandemics = new Map<number, number>();
  const desolate = new Map<string, number[]>();
  // 同化与迁徙:一波迁徙(同一刻、同一民族、同一起因);同一国治下同一对民族的同化
  const waves = new Map<string, number[]>();
  const assim = new Map<string, number[]>();
  // 分裂出来的国家不再记"立国";并入别国的不再记"瓦解"(合并那条已经说了)
  const splitOf = new Set<number>();
  const mergedAt = new Set<string>();
  for (const e of A) {
    if (e.kind === 'split' && e.a >= 0) splitOf.add(e.a);
    if (e.kind === 'merge' && e.b >= 0) mergedAt.add(`${e.b}|${e.year}`);
  }
  yield;
  /** 走了几条:每走一段停一步 */
  let n = 0;
  for (let i = 0; i < A.length; i++) {
    if (++n % 128 === 0) yield;
    const e = A[i];
    // 地形大事:那一刻的后果(城没了、迁都、亡于天灾)并进大事那一条
    if (e.kind === 'upheaval') {
      const ids = [i];
      while (i + 1 < A.length && upheavalTail(A[i + 1], e)) ids.push(++i);
      out.push(upheavalEntry(ctx, ids));
      continue;
    }
    // 大崩解:紧跟着自立的几块并进崩解那一条
    if (e.kind === 'collapse') {
      const ids = [i];
      while (i + 1 < A.length && collapseTail(A[i + 1], e)) ids.push(++i);
      out.push(collapseEntry(ctx, ids));
      continue;
    }
    // 瘟疫:同一场的几条并成一条
    if (e.kind === 'plague') {
      let g = plagues.get(e.war);
      if (!g) plagues.set(e.war, (g = []));
      g.push(i);
      continue;
    }
    if (e.kind === 'pandemic') {
      pandemics.set(e.war, i);
      continue;
    }
    if (e.kind === 'desolate') {
      const key = `${e.war}|${e.a}`;
      let g = desolate.get(key);
      if (!g) desolate.set(key, (g = []));
      g.push(i);
      continue;
    }
    // 民变:并进讨伐它的那场战争(紧跟着记的 war,cause = quell),写成一条民变
    if (e.kind === 'revolt') {
      const w = A[i + 1];
      if (w && w.kind === 'war' && w.cause === 'quell' && w.b === e.a) {
        wars.set(w.war, [i]);
        continue;
      }
    }
    // 被迫迁都(capital 带战争编号)、洗劫、毁城(阶段 3 城市兴衰)也折进那场战争
    // 邦交:战败称臣(submit 带战争编号)、背盟来攻、坐视不救(unally 带战争编号)也折进那场战争
    const inWar =
      e.war >= 0 &&
      (e.kind === 'war' ||
        e.kind === 'conquer' ||
        e.kind === 'battle' ||
        e.kind === 'peace' ||
        e.kind === 'fall' ||
        e.kind === 'capital' ||
        e.kind === 'sack' ||
        e.kind === 'ruin' ||
        e.kind === 'submit' ||
        e.kind === 'unally' ||
        e.kind === 'stand');
    if (inWar) {
      let g = wars.get(e.war);
      if (!g) wars.set(e.war, (g = []));
      g.push(i);
      // 亡国、毁城另列一条(下面照常处理)
      if (e.kind !== 'fall' && e.kind !== 'ruin') continue;
    }
    if (e.kind === 'found' && splitOf.has(e.a)) continue;
    // 干预引起的立国、迁都并进干预那一条
    if ((e.kind === 'found' || e.kind === 'capital' || e.kind === 'fall' || e.kind === 'famine') && foldedIntoIntervene(civ, i)) continue;
    // 照大纲划给同一国的几州并进头一条
    if (e.kind === 'intervene' && i > 0 && plotCedeKey(civ, i) && plotCedeKey(civ, i - 1) === plotCedeKey(civ, i)) continue;
    // 照大纲顺着引的方针(gen/outline.ts)不写进编年史,只在大纲的批改里写
    if (e.kind === 'intervene' && civ.interventions?.[e.war]?.guide) continue;
    // 即位(等在位的那位下台):登记的那一条不列,真即位时另有一条
    if (e.kind === 'intervene' && e.b === IV_WAIT && civ.interventions?.[e.war]?.kind === 'crown') continue;
    if (e.kind === 'fall' && e.b < 0 && mergedAt.has(`${e.a}|${e.year}`)) continue;
    if (e.kind === 'conquer' && e.b < 0 && e.a >= 0) {
      let g = tribal.get(e.a);
      if (!g) tribal.set(e.a, (g = []));
      g.push(i);
      continue;
    }
    // 掌实权:幼主的摄政、辅政写在即位那一条,名臣篡位写在改朝换代那一条(regentEntry 给 null)
    if (e.kind === 'regent') {
      const x = regentEntry(ctx, i);
      if (x) out.push(x);
      continue;
    }
    // 结亲:互嫁的第二门并进第一门
    if (e.kind === 'marry') {
      if (!mutualTail(A, i)) out.push(marryEntry(ctx, i));
      continue;
    }
    if (e.kind === 'migrate' || e.kind === 'assimilate') {
      const map = e.kind === 'migrate' ? waves : assim;
      const key = e.kind === 'migrate' ? `${e.year}|${e.a}|${e.war}` : `${e.a}|${e.b}|${e.war}`;
      let g = map.get(key);
      if (!g) map.set(key, (g = []));
      g.push(i);
      continue;
    }
    out.push(simpleEntry(ctx, e, i));
  }
  for (const ids of wars.values()) {
    if (++n % 8 === 0) yield;
    out.push(A[ids[0]].kind === 'revolt' ? revoltEntry(ctx, ids) : warEntry(ctx, ids));
  }
  for (const ids of plagues.values()) {
    if (++n % 32 === 0) yield;
    if (pandemics.has(A[ids[0]].war)) continue;
    // 作者下的瘟疫没传开(只有起疫那一条):干预那一条已经写了
    if (ids.length === 1 && A[ids[0]].war >= PLAGUE_IV) continue;
    out.push(plagueEntry(ctx, ids));
  }
  // 全球大疫:一场一条(子条目是逐年传到哪),凋敝结束另一条;疫后荒废的城一国一条
  for (const [k, at] of pandemics) {
    yield;
    out.push(...pandemicEntries(ctx, at, plagues.get(k) ?? []));
  }
  for (const ids of desolate.values()) out.push(desolateEntry(ctx, ids));
  yield;
  tribalEntries(ctx, tribal, out);
  yield;
  const dirUsed = new Map<number, number>();
  for (const ids of waves.values()) {
    if (++n % 32 === 0) yield;
    out.push(migrationEntry(ctx, ids, dirUsed));
  }
  yield;
  assimEntries(ctx, assim, out);
  yield;
  out.sort((a, b) => a.year - b.year || a.id - b.id);
  yield;
  const told = combine(ctx, out);
  yield;
  yield* introduce(civ, out, told);
  const again = cache.get(civ);
  if (again) return again;
  cache.set(civ, out);
  return out;
}

// ---------------------------------------------------------------------------
// 君主继位(按人物排,不是史事)

const reignCache = new WeakMap<Civ, ChronicleEntry[]>();

/** 君主去世的说法:[正常去世, 遇弑] */
function deathWord(p: Polity, tier: number): [string, string] {
  if (!p.eastern) return [tier >= 1 ? '驾崩' : '去世', '遇刺身亡'];
  if (p.lineage === 'khanate' || tier <= 0) return ['卒', '遇弑'];
  return [tier >= 3 ? '崩' : '薨', '遇弑'];
}

/**
 * 君主继位:同一朝里一位接一位(一朝的第一位不算,立国、分裂、复国、改朝换代那一条已经写了):
 * 东方 "大昌太宗崩,在位 23 年;太子李昭即位,是为高宗"(王国"世子",年少的加",时年 9 岁");
 * 汗国、部落 "乌耐汗国咄苾可汗卒,在位 12 年;其弟阿史那继为可汗";
 * 西幻 "索拉特国王阿尔德里克二世驾崩,在位 31 年;其子阿尔德里克三世即位";共和国 "提布里亚执政官卡西乌斯任满,马库斯继任"。
 * 新君是先君的什么人按世系说(peopleText.ts 的 kinOf:子、孙、弟、兄、侄、叔父……;连不上的写"宗室")。
 * 名臣迎立、辅政的写上他:"…;丞相某某迎立其兄柳清瑶,是为睿宗""…,时年 11 岁,丞相某某辅政"。
 * 诸子争储(Person.claim,royals.ts):"…;三子李昭以军功即位""…;诸子争立,三子李昭举兵杀其兄李明,即位"
 * "…;诸子争立,三子李昭谮杀其兄李明,即位""…;太子李昭即位,…;其兄李明拥兵争位,兵败被杀""…;其弟李昭杀太子李明,即位"(西幻平实些)。
 * 标签"嗣",重要度 1;id = civ.annals.length + 新君的 Person.id。没有人物 = 空数组。
 * 不在 buildChronicle 里(那里只有史事,AI 材料、地点的纪事都用它);要列继位的地方自己并进去(mergeChronicle)。按 civ 缓存
 */
export function reignEntries(civ: Civ): ChronicleEntry[] {
  const hit = reignCache.get(civ);
  if (hit) return hit;
  const out: ChronicleEntry[] = [];
  const ix = peopleOf(civ);
  const n0 = civ.annals?.length ?? 0;
  for (const list of ix?.rulers ?? []) {
    for (let k = 1; k < list.length; k++) {
      const x = list[k];
      const prev = list[k - 1];
      const p = polityOf(civ, x.polity);
      if (!p || x.rise !== 'heir' || (prev.dynasty ?? 0) !== (x.dynasty ?? 0) || x.from === undefined) continue;
      // 摄政的叔父废了幼主自立:掌实权那一条(篡位)已经写了
      if (x.claim?.how === 'seize') continue;
      const y = x.from;
      const tier = Math.max(0, polityTierAt(p, y - 1 / 512));
      const reign = Math.floor(y) - Math.floor(prev.from ?? y);
      const span = reign >= 1 ? `,在位 ${reign} 年` : '';
      const ref = rulerRef(civ, prev, y);
      const minis: Person[] = [];
      let text: string;
      if (p.lineage === 'republic') text = `${ref}任满,${x.name}继任`;
      else if (prev.author !== undefined) {
        // 作者立的君主到期退位(生死归人物卡管),继他之位的不连成他的儿子
        const then = p.eastern && (p.lineage === 'khanate' || tier <= 0) ? `${x.name}继为${p.lineage === 'khanate' && tier > 0 ? '可汗' : '首领'}` : p.eastern ? `${x.name}即位${x.title ? `,是为${x.title}` : ''}` : `${rulerShort(civ, x)}即位`;
        text = `${ref}退位${span};${then}`;
      } else {
        const [died, killed] = deathWord(p, tier);
        const k = kinOf(civ, prev, x);
        const heirWord = p.eastern && p.lineage !== 'khanate' && tier >= 3 ? '太子' : p.eastern && p.lineage !== 'khanate' && tier === 2 ? '世子' : '';
        let kin = !k ? '宗室' : k !== '子' ? `其${k}` : heirWord || '其子';
        const age = ageAt(x, y);
        const young = age < 15 ? `,时年 ${age} 岁` : '';
        const east = classical(p);
        // 诸子争储:换掉"太子某某"那一截(前面加"诸子争立,"、后面接"兵败被杀"的写在最后)
        let fight = '';
        let tail = '';
        // 先君晚年引兵入朝的:杀兄弟写在掌权那一条里,即位这里照寻常写
        const claim = x.claim?.how === 'march' ? undefined : x.claim;
        if (claim && ix) {
          const rivals = claim.rivals.map((id) => civ.people![id]).filter(Boolean);
          // "其兄李明、李晖、弟李曜":和前一个同辈分的不再写
          const kins = rivals.map((r) => kinOf(civ, x, r) || '兄');
          const list = rivals.map((r, i) => `${i ? '' : '其'}${i && kins[i] === kins[i - 1] ? '' : kins[i]}${r.name}`).join('、');
          // 第几个儿子:长子、次子、三子……(养子写养子)
          const sons = ix.kids.get(prev.id) ?? [];
          const n = sons.filter((o) => !o.adopted).indexOf(x);
          const ord = k === '养子' ? '养子' : k !== '子' ? kin : n === 0 ? '长子' : n === 1 ? '次子' : n > 1 ? `${cnNumber(n + 1)}子` : kin;
          if (claim.how === 'merit') kin = `${ord}${x.name}以${east ? '军功' : '战功'}越${list}`;
          else if (claim.how === 'coup') {
            fight = east ? '诸子争立,' : '诸子争位,';
            kin = `${ord}${x.name}${east ? '举兵' : '起兵入宫,'}杀${list},`;
          } else if (claim.how === 'intrigue') {
            fight = east ? '诸子争立,' : '诸子争位,';
            kin = east ? `${ord}${x.name}谮杀${list},` : `${ord}${x.name}构陷${list}致死,`;
          } else if (claim.how === 'usurp') {
            const r = rivals[0];
            kin = `${kin}${x.name}杀${heirWord || `其${(r && kinOf(civ, x, r)) || '族人'}`}${r?.name ?? ''},`;
          } else if (claim.how === 'revolt' && rivals.length) tail = `;${list}${east ? '拥兵争位,兵败被杀' : '起兵争位,兵败被杀'}`;
        }
        // 名臣迎立(先君遇弑)、辅政(幼主);争储的不写迎立
        const by = prev.fate === 'murdered' && !fight && claim?.how !== 'usurp' ? ix?.enthrone.get(x.id) : undefined;
        const regent = ix?.regent.get(x.id);
        const lead = by ? `${ministerRef(by, y)}${east ? '迎立' : '拥立'}` : '';
        let then: string;
        // 争储换掉了"太子某某"那一截的,名字已经在 kin 里
        const nm = (s: string) => (claim && claim.how !== 'revolt' ? '' : s);
        if (p.eastern && p.lineage === 'khanate') then = by ? `${lead}${kin}${x.name}为${tier <= 0 ? '首领' : '可汗'}` : `${kin}${nm(x.name)}继为${tier <= 0 ? '首领' : '可汗'}`;
        else if (p.eastern && tier <= 0) then = by ? `${lead}${kin}${x.name}为首领` : `${kin}${nm(x.name)}继为首领`;
        else if (p.eastern) then = `${lead}${kin}${nm(x.name)}${by ? '' : '即位'}${x.title ? `,是为${x.title}` : ''}`;
        else then = claim && claim.how !== 'revolt' ? `${kin}即位${x.title ? `,是为${rulerShort(civ, x)}` : ''}` : `${lead}${kin}${rulerShort(civ, x)}即位`;
        then = fight + then;
        // 叔父摄政(regents.ts):"…,时年 9 岁,叔父某某摄政"
        const uncle = ix?.uncle.get(x.id);
        const uk = uncle ? kinOf(civ, x, uncle) || '叔父' : '';
        const aid = uncle ? `,${uk.length === 1 ? '其' : ''}${uk}${uncle.name}摄政` : !regent ? '' : regent === by ? (east ? ',遂辅政' : ',并摄政') : `,${ministerRef(regent, y)}${east ? '辅政' : '摄政'}`;
        // 作者让他去世的:那一年的干预那一条已经写了"暴崩,在位几年"
        text = prev.killed !== undefined ? `${ref}既${died};${then}${young}${aid}${tail}` : `${ref}${prev.fate === 'murdered' ? killed : died}${span};${then}${young}${aid}${tail}`;
        if (by) minis.push(by);
        if (regent && regent !== by && !uncle) minis.push(regent);
        if (uncle) minis.push(uncle);
      }
      out.push({
        id: n0 + x.id,
        kind: 'reign',
        year: y,
        end: y,
        text,
        tag: '嗣',
        importance: 1,
        polities: [p.id],
        regions: [],
        settlement: -1,
        people: [prev.id, x.id, ...minis.map((m) => m.id), ...(x.claim && x.claim.how !== 'march' ? x.claim.rivals : [])],
      });
    }
  }
  out.sort((a, b) => a.year - b.year || a.id - b.id);
  reignCache.set(civ, out);
  return out;
}

/** 两串按年份排好的纪事并成一串(同一年按 id;继位的 id 比史事大,同一刻排在史事后面) */
export function mergeChronicle(a: readonly ChronicleEntry[], b: readonly ChronicleEntry[]): ChronicleEntry[] {
  if (!b.length) return a.slice();
  if (!a.length) return b.slice();
  const out: ChronicleEntry[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    if (j >= b.length || (i < a.length && (a[i].year < b[j].year || (a[i].year === b[j].year && a[i].id <= b[j].id)))) out.push(a[i++]);
    else out.push(b[j++]);
  }
  return out;
}

/**
 * 只看一国时的"全部":这一国的纪事,按年份并进这一国的历代君主继位。
 * 编年史页按国家看时列的、国家面板"全部 N 件"数的都是这一份(两边条数对得上)
 */
export function polityChronicle(civ: Civ, all: readonly ChronicleEntry[], polity: number): ChronicleEntry[] {
  return mergeChronicle(filterChronicle(all, { polity }), filterChronicle(reignEntries(civ), { polity }));
}

export interface ChronicleFilter {
  /** 只看大事(重要度 ≥ MAJOR) */
  major?: boolean;
  /** 只看和这个国家有关的(null / 不给 = 全部国家) */
  polity?: number | null;
}

/** 这一条和某国有关(折叠条目:它自己或任一子条目) */
export function entryInvolves(e: ChronicleEntry, polity: number): boolean {
  return e.polities.includes(polity) || !!e.children?.some((c) => c.polities.includes(polity));
}

/** 按"大事 / 全部"、国家筛选(保持顺序) */
export function filterChronicle(entries: readonly ChronicleEntry[], f: ChronicleFilter): ChronicleEntry[] {
  const pol = f.polity ?? null;
  return entries.filter((e) => (!f.major || e.importance >= MAJOR) && (pol === null || entryInvolves(e, pol)));
}

/** 纯文本(复制给 OC 作者写设定用):一条一行,折叠条目的子条目缩进列在下面;era = 年份照这个纪年写;months = 一年几个月(0 = 只写年) */
export function chronicleText(entries: readonly ChronicleEntry[], title?: string, era?: Era, months = 0): string {
  const lines: string[] = [];
  if (title) lines.push(title, '');
  for (const e of entries) {
    lines.push(eraText(`${entryYearMonthLabel(e, months)} ${e.text}`, era));
    for (const c of e.children ?? []) lines.push(eraText(`    ${entryYearMonthLabel(c, months)} ${c.text}`, era));
  }
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// 导出(阶段 4):整本编年史写成 Markdown / 纯文本文件,给 OC 作者拿去写设定

/** 导出时一个时代(一节)多少年:整段历史分成五到八节 */
export function chronicleEraYears(endYear: Year): number {
  const want = Math.max(1, endYear) / 6;
  return [50, 100, 200, 250, 500, 1000, 2000].find((n) => n >= want) ?? 5000;
}

export interface ChronicleDocOptions {
  format: 'md' | 'txt';
  /** 标题里的世界种子 */
  seed: number;
  /** 和默认值不同的世界参数(一句话,可选;同一种子 + 参数 = 同一个世界) */
  params?: string;
  /** 一节多少年;不给按 chronicleEraYears */
  eraYears?: number;
  /** 全部纪事(不给 = buildChronicle 的史事;界面上导出时给史事 + 宗教大事,见 religionText.ts 的 fullChronicle) */
  entries?: readonly ChronicleEntry[];
  /** 年份照这个纪年写(不给 = "第 N 年";分节照样按第几年分) */
  era?: Era;
  /** 一年几个月,纪事写到哪一月(不给 / 0 = 只写年) */
  months?: number;
}

/** Markdown 里有特殊含义的几个符号前面加反斜杠(纪事是中文,一般用不到,防个万一) */
function mdEscape(s: string): string {
  return s.replace(/([\\`*_[\]<>#|])/g, '\\$1');
}

/**
 * 整本编年史:标题带种子和年份范围;先"大事"(一页简史,按时代分节,不列战争里的每一件事),
 * 再"全部纪事"(按时代分节,战争等折叠条目的每一件事缩进列在下面)。同一个 civ 永远得到同样的文字。
 */
export function chronicleDocument(civ: Civ, opt: ChronicleDocOptions): string {
  const md = opt.format === 'md';
  const all = opt.entries ?? buildChronicle(civ);
  const majors = filterChronicle(all, { major: true });
  const end = Math.floor(civ.endYear);
  const span = Math.max(1, Math.floor(opt.eraYears ?? chronicleEraYears(civ.endYear)));
  const era = opt.era;
  const months = opt.months ?? 0;
  const title = eraText(`编年史 · 种子 ${opt.seed} · 第 0—${end} 年`, era);
  const esc = md ? (s: string) => mdEscape(eraText(s, era)) : (s: string) => eraText(s, era);
  const out: string[] = [];
  out.push(md ? `# ${esc(title)}` : title, '');
  const about = all.length
    ? `「文明与地图」推演生成。大事 ${majors.length} 条(一页简史);全部 ${all.length} 条(每一次攻占、洗劫、同化、迁徙都在)。`
    : '「文明与地图」推演生成。这颗星球上没有文明兴起,编年史是空的。';
  const params = opt.params ? `世界参数:${opt.params}(同一种子 + 参数 = 同一个世界)` : '同一种子 + 默认参数 = 同一个世界。';
  if (md) out.push(`> ${esc(about)}  `, `> ${esc(params)}`, '');
  else out.push(about, params, '');

  // 最后一节包含结束年份(三千年:第 2500—3000 年,不单开一节"第 3000—3000 年")
  const lastEra = Math.max(0, Math.ceil(end / span) - 1);
  const eraOf = (y: Year) => Math.min(Math.floor(Math.max(0, y) / span), lastEra);
  const eraTitle = (i: number) => esc(`第 ${i * span}—${i === lastEra ? end : (i + 1) * span - 1} 年`);
  const section = (name: string, list: readonly ChronicleEntry[], children: boolean) => {
    out.push(md ? `## ${name}` : `════ ${name} ════`, '');
    if (!list.length) out.push('(无)', '');
    let sec = -1;
    for (const e of list) {
      const i = eraOf(e.year);
      if (i !== sec) {
        if (sec >= 0) out.push('');
        sec = i;
        out.push(md ? `### ${eraTitle(i)}` : `【${eraTitle(i)}】`, '');
      }
      const ey = esc(entryYearMonthLabel(e, months));
      out.push(md ? `- **${ey}** ${esc(e.text)}` : `${ey} ${esc(e.text)}`);
      if (children)
        for (const c of e.children ?? []) {
          const cy = esc(entryYearMonthLabel(c, months));
          out.push(md ? `  - ${cy} ${esc(c.text)}` : `    ${cy} ${esc(c.text)}`);
        }
    }
    out.push('');
  };
  if (all.length) {
    section('大事', majors, false);
    section('全部纪事', all, true);
  }
  return out.join('\n');
}
