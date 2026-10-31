/**
 * 国家面板(宽屏在左边侧栏里,窄屏是底部抽屉),两页 —— 信息页(这里)和干预页(CommandPage.tsx;
 * 干预页里点「方针」或者概况里点「方针」一行,换成方针页 PolicyPage.tsx;点「灭国」换成灭国页 DestroyPage.tsx;
 * 点「天灾」换成天灾页 DisasterPage.tsx)。
 * 逐年推演里演一国(roleStore.ts)时看别国:「干预历史」变灰,按钮下面一句"你在演某国,只管自己的国家",点「切回造物主」就能改。
 *
 * 信息页(按时间轴当前那一年;没立国 = 立国那年的样子,已亡 = 亡国前的样子):
 *   顶部  颜色块、国名(可改,输入时预览国号变迁)、"国家，1045 年立国"、关闭
 *   按钮  干预历史(主操作;窄屏点了底部抽屉展开)/ 设为中心 / 改名 / 更多(复制分享链接(停在这一年、选中这国、地图照现在的样子;
 *         手机上去「存档」要先关掉这张卡片,所以放在这里)、在编年史中查看、让 AI 写国史、让 AI 讲名字由来;
 *         有主体民族时还有讲它的族名由来、给它起族名)
 *   概况  国都、政体(由已有的制度推出来的政体名,"某年起";点了换成朝政页 CourtPage.tsx,够不上议事的小国也能点)、君主(这一年在位的那位,点了看他;共和国写"执政")、王室(保住王室管着的那些年才有:"保住  到 1560 年",点了开「我的干预」)、实权(这一年有人掌着实权才有:"彭继桓  君主之子，2585 年起",
 *         见 gen/civ/regentInfo.ts)、方针(这一年照的方针,"某年起";没定方针、有人掌着实权的写"照彭继桓性格";写进待推演单子的标"待推演";
 *         点了开方针页)、疆域(历年州数的小柱图,和概览"国家"表同一份)、
 *         人口(境内各州的总人口:城 + 乡村)、钱粮(近几百年国库小柱 + 国库怎么样 + 岁入;点了换成钱粮页 FiscalPage.tsx)、
 *         朝政(征税的法子 + 分封、割据几州;够格议事或议过事的国家才有;点了换成朝政页 CourtPage.tsx)、主体民族(可点,开民族卡片)、国教(可点,"某年起";没有写"没有")、
 *         思潮(国中最盛那说,点了进朝政页的「思潮」那块;几成,小字"另有某说等 N 说";都不到半成不显示,ThoughtParts.tsx)、
 *         宗主("某年起称臣")/ 藩属 / 盟国(可点,名字后面是哪年称臣、结盟;有才写)、
 *         姻亲(最近一门亲 40 年内、那以后没开过战的国家,可点,名字后面是哪年结亲;有才写)、
 *         立约(这一年还在的约:约名可点、开条约卡片,"到哪年",下面一句和哪几国互不侵犯)/ 中立地(参与共建的,州名可点;有才写)、
 *         邻国(可点),来历 / 结局 / 历任国都(有才写;大迁徙迁来立的国,来历写"克拉尔族自诺敏塔拉西徙至此立国",地名点了跳到动身那年)
 *   历代君主  当前这位和前后各两位(新的在上;遇弑、被废这类结局写在名字后面),点一行看这个人;
 *             作者立的君主(让作者的人物即位):名字前面是他的圆头像,后面写「作者的人物」,点了开作者的人物卡;
 *         "全部 N 位"打开概览的人物页、只看这国的君主;"世系图"(不是共和国才有)打开这国的世系图,停在时间轴那一年的那一朝
 *   朝代  改朝换代过才有:一朝一行(新的在上),当前那一朝标"当前";点一行 = 时间轴跳到它开始的那年
 *   大事  到当前年份为止最近 5 条(可点:跳到那一年,地图上闪出事发地);"全部 N 件"打开概览的编年史页、只看这国的"全部"
 *         (N 和那里"全部"的条数一样,连同历代君主继位)
 *   名字由来(AI 释名,点了才出;先"生成中…"再出结果;没设置 AI 时一行提示 + "设置 AI")、AI 起名(改名时的入口);
 *         主体民族的族名由来、起族名接在后面
 *
 * 顶部、按钮、概况、小柱图、大事这些零件在 panelParts.tsx,城 / 地理实体 / 州的面板(CityPanel、PlacePanel、RegionPanel)
 * 用的是同一套。
 */
import { Fragment, useMemo, useRef, useState, type RefObject } from 'react';
import type { Civ, Person, Polity } from '../gen/civ/types';
import type { Raster } from '../gen/raster';
import type { World } from '../gen/world';
import { cultureLabel, regionLabel } from '../gen/civ/story/display';
import { treatiesOfAt, treatyMembersAt, treatyTitle } from '../gen/civ/story/treatyInfo';
import { nationsWord, treatyPeriod, untilText, zonesOfAt } from './treatyRows';
import { capitalAt, dynastyIndexAt, polityAlive, polityName, polityTitleChain, populationLabel, regionPopulationAt } from '../gen/civ/growth';
import { ownersAt, type Owners } from '../gen/civ/timeline';
import { filterChronicle, polityChronicle } from '../gen/civ/story/chronicle';
import { fullChronicle } from '../gen/civ/story/religionText';
import { stateFaithAt } from '../gen/civ/religion';
import { dynastyKey, polityKey } from '../gen/edits';
import { spaced, yearAt, yearFull, yearShort, yearShortAt, yearSpan, yearSpanAt } from '../gen/era';
import { useEdits, useEra } from './editsStore';
import { CharAvatar } from './CharacterPanel';
import { setCivTime, setSelection } from './civView';
import { polityTrek } from './migrationInfo';
import { TrekFrom } from './TrekFrom';
import { peopleIndex, rulerAt } from '../gen/civ/story/peopleInfo';
import { isConsul, kinOf, personName, rulerFateWord } from '../gen/civ/story/peopleText';
import { REGENCY_VERB, holderAt, inLawsAt, type Held } from '../gen/civ/story/regentInfo';
import type { AiName } from './AiNamePanel';
import { openHistoryBook } from './HistoryBook';
import { NameEdit } from './NameEdit';
import { neighborsAt } from './Interventions';
import { polityTies } from '../gen/civ/diplomacy';
import { CommandPage } from './CommandPage';
import { openCmdPage, setPanelTab, setSheet, usePanel } from './panelStore';
import { PolicyPage } from './PolicyPage';
import { FiscalPage, FiscalRow } from './FiscalPage';
import { CourtPage, CourtRow, FormRow } from './CourtPage';
import { DestroyPage } from './DestroyPage';
import { DisasterPage } from './DisasterPage';
import { TrekPage } from './TrekPage';
import { BoostPage } from './BoostPage';
import { boostRow } from './boostInfo';
import { TreatyPage, ZonePage } from './TreatyPage';
import { policyRow, roleLock } from './policyInfo';
import { keepRow } from './keepInfo';
import { useRole } from './roleStore';
import { RoleLockNote } from './RoleBar';
import { usePending, type Pending } from './pendingStore';
import { useStepwiseOn } from './stepwiseStore';
import { shownYearOf } from './flyTo';
import { SPARK_N, polityHistory } from './WorldOverviewCountries';
import { openLineage, openOverview, openPeople } from './overviewStore';
import { Act, Acts, AiBox, AiSuggestLink, CenterAct, EventList, Link, MoreAct, PanelHead, Row, Spark, Stats, SubLine, rgb, useRevealAi } from './panelParts';
import { AiMenuItem, MenuItem, MenuSep } from './PopMenu';
import { Icon } from './icons';
import { copyMomentLink } from './shareMoment';
import { useAiOn } from '../ai/client';
import { FlagIcon } from './Flag';
import { FlagPanel } from './FlagPanel';
import { flagOf, useFlags } from './flagStore';
import { ERAS, developmentAt, eraLevel, eraOf } from '../gen/civ/development';
import { pandemicsOf, peakEraAt, slumpAt } from '../gen/civ/story/pandemicInfo';
import { ERA_COLORS, eraName } from '../render/civ/era';
import { PolityThoughtRow } from './ThoughtParts';
import './countryPanel.css';
import { lineageAt } from '../gen/civ/regime';
import { rootSegIndex } from '../gen/civ/polityRoot';

// ---------------------------------------------------------------------------
// 国家

/** 国名词根换成 root 的国家(预览用;东方第一朝的国号跟着换) */
function withRoot(p: Polity, root: string): Polity {
  const d = p.dynasties;
  return { ...p, name: root, dynasties: p.eastern && d && d.length ? d.map((x, i) => (i === 0 ? { ...x, name: root } : x)) : d };
}

let owners: Owners | undefined;
let preOwners: Owners | undefined;

/**
 * 第 year 年 id 这国在不在全球大疫的凋敝里(它境内有染了疫、凋敝还没结束的州):那一场哪年起、无人收拾几年、
 * 大疫前这国多少人(起疫前一刻它的国土上各州人口相加,千人);不在 = null
 */
function pandemicNow(civ: Civ, id: number, year: number): { year: number; slump: number; pre: number } | null {
  const list = pandemicsOf(civ);
  if (!list.length || !slumpAt(civ, year)) return null;
  // 凋敝还没结束、这国境内(这一年的国土)已经染上的那几场里最近起的一场
  preOwners = ownersAt(civ, year, preOwners);
  const own = preOwners.polity;
  let q = null as (typeof list)[number] | null;
  for (const x of list) if (x.year <= year && year < x.end && x.hits.some((h) => h.year <= year && own[h.region] === id)) q = x;
  if (!q) return null;
  const y0 = q.year - 1 / 64;
  preOwners = ownersAt(civ, y0, preOwners);
  let pre = 0;
  for (let r = 0; r < civ.regions.count; r++) if (preOwners.polity[r] === id) pre += regionPopulationAt(civ, r, y0);
  return { year: q.year, slump: q.slump, pre };
}

/** 历朝(东方每一朝的国号 / 西幻的王室);没改朝换代过 = 一段 */
function dynastySegments(civ: Civ, p: Polity): { name: string; from: number; to: number }[] {
  const last = p.ended ?? civ.endYear;
  const d = p.dynasties;
  if (!d || d.length < 2) return [{ name: p.name, from: p.founded, to: last }];
  // 改制开的共和、军政府那一段没有王室:写那时的国号("博戈维纳共和国")、"军政府"
  return d.map((x, i) => ({ name: x.regime === 'junta' ? '军政府' : x.regime ? polityName(p, x.year) : x.name || p.name, from: Math.max(p.founded, x.year), to: d[i + 1]?.year ?? last }));
}

export interface CountryPanelProps {
  civ: Civ;
  raw: Civ;
  raster: Raster | null;
  world: World;
  id: number;
  /** 时间轴当前那一年(取整) */
  year: number;
  names: Record<string, string>;
}

export function CountryPanel(props: CountryPanelProps) {
  const { tab, page, sub } = usePanel();
  const { civ, raw, raster, id, year } = props;
  const p = civ.polities[id];
  // 演一国时别国:干预入口变灰,只看信息页
  const lock = roleLock(civ, useRole(), id);
  // 改名的开关、AI 释名 / 起名:标题(改名、AI 起名)和信息页(名字由来的框、底部按钮)共用一份
  const d = p.dynasties;
  const di = p.eastern && d && d.length >= 2 ? dynastyIndexAt(p, shownYearOf(p, year, civ.endYear)) : 0;
  const [renaming, setRenaming] = useState(false);
  // 点了"名字由来""AI 起名":内容在信息页最下面,滚过去让它露出来
  const { ai, aiRef } = useRevealAi({ civ, raw, raster, target: { kind: 'polity', id, dynasty: di }, lazy: true });
  const shared: Shared = { renaming, setRenaming, ai, aiRef };
  return (
    <div className="cp" data-polity={id} data-tab={tab}>
      <CountryHead {...props} shared={shared} />
      {tab === 'cmd' && !lock ? (
        page?.kind === 'policy' ? (
          <PolicyPage key={id} civ={civ} id={id} year={year} from={page.year} />
        ) : page?.kind === 'destroy' ? (
          <DestroyPage key={id} civ={civ} id={id} year={year} from={page.year} />
        ) : page?.kind === 'disaster' ? (
          <DisasterPage key={id} civ={civ} polity={id} year={year} from={page.year} />
        ) : page?.kind === 'trek' ? (
          <TrekPage key={id} civ={civ} polity={id} year={year} from={page.year} />
        ) : page?.kind === 'boost' ? (
          <BoostPage key={id} civ={civ} id={id} year={year} from={page.year} />
        ) : page?.kind === 'treaty' ? (
          <TreatyPage key={id} civ={civ} world={props.world} id={id} year={year} from={page.year} />
        ) : page?.kind === 'neutral' ? (
          <ZonePage key={id} civ={civ} world={props.world} id={id} year={year} from={page.year} />
        ) : (
          <CommandPage civ={civ} raster={raster} world={props.world} id={id} year={year} />
        )
      ) : sub === 'fiscal' ? (
        <FiscalPage key={id} civ={civ} id={id} year={shownYearOf(p, year, civ.endYear)} />
      ) : sub === 'court' ? (
        <CourtPage key={id} civ={civ} id={id} year={shownYearOf(p, year, civ.endYear)} />
      ) : (
        <InfoPage {...props} p={p} shared={shared} lock={lock?.me ?? -1} />
      )}
    </div>
  );
}

interface Shared {
  renaming: boolean;
  setRenaming: (on: boolean) => void;
  ai: AiName;
  aiRef: RefObject<HTMLDivElement>;
}

/** 顶部:颜色块、国名(可改)、"国家，1045 年立国"、关闭 */
function CountryHead({ civ, raw, id, year, names, shared }: CountryPanelProps & { shared: Shared }) {
  const p = civ.polities[id];
  const era = useEra();
  const alive = polityAlive(p, year);
  const shownYear = shownYearOf(p, year, civ.endYear);
  const d = p.dynasties;
  // 东方改朝换代过的:标题上的国号是当朝的,改的是当朝的国号(第一朝 = 国名词根)
  // 改制开的那一段(共和、军政府、迎回旧王室)用的是别的一段的国名词根:改的是那一段的
  const di = p.eastern && d && d.length >= 2 ? rootSegIndex(p, dynastyIndexAt(p, shownYear)) : 0;
  const { renaming, setRenaming, ai } = shared;
  const withDynasty = (i: number, v: string): Polity => (i === 0 ? withRoot(p, v) : { ...p, dynasties: d!.map((y, j) => (j === i ? { ...y, name: v } : y)) });
  const extra = <AiSuggestLink ai={ai} />;
  // 国旗(卡片显示的那一年那一面,和标题的国名一致):点了打开旗帜详情
  const flags = useFlags();
  const flag = flagOf(flags, id, shownYear);
  const flagRef = useRef<HTMLButtonElement>(null);
  const [flagFor, setFlagFor] = useState<number | null>(null);
  const flagOpen = flagFor === id && !!flag;
  return (
    <PanelHead
      color={rgb(p.color)}
      icon={
        flag && (
          <button
            ref={flagRef}
            className="cp-flag"
            data-act="flag"
            title={`${polityName(p, shownYear)}的旗`}
            aria-label={`${polityName(p, shownYear)}的旗`}
            aria-expanded={flagOpen}
            onClick={() => setFlagFor(flagOpen ? null : id)}
          >
            <FlagIcon spec={flag.spec} w={39} />
          </button>
        )
      }
    >
      {flagOpen && <FlagPanel id={id} year={shownYear} anchor={flagRef} onClose={() => setFlagFor(null)} />}
      {di > 0 ? (
        <NameEdit
          k={dynastyKey(civ, id, di)}
          kind="dynasty"
          eastern
          shown={polityName(p, shownYear)}
          current={d![di].name}
          fallback={raw.polities[id].dynasties?.[di]?.name ?? d![di].name}
          names={names}
          big
          editing={renaming}
          onEditing={setRenaming}
          extra={extra}
          hint={`改的是当朝(第 ${di + 1} 朝)的国号;别的朝:点朝代条跳到那一朝再改`}
          preview={(v) => polityName(withDynasty(di, v), shownYear)}
        />
      ) : (
        <NameEdit
          k={polityKey(civ, id)}
          kind="polity"
          eastern={p.eastern}
          shown={polityName(p, shownYear)}
          current={p.name}
          fallback={raw.polities[id].name}
          names={names}
          big
          editing={renaming}
          onEditing={setRenaming}
          extra={extra}
          hint={p.eastern ? '国号按国土大小自动加:秦部 → 秦国 → 大秦 → 大秦王朝' : '国号(国 / 王国 / 帝国……)按国土大小自动加'}
          preview={(v) => polityTitleChain(withRoot(p, v))}
        />
      )}
      <SubLine
        parts={[
          '国家',
          p.ended !== undefined && year >= p.ended ? yearSpanAt(p.founded, p.ended, era) : `${yearAt(p.founded, era)}${alive ? '' : '才'}立国`,
        ]}
      />
    </PanelHead>
  );
}

/** lock = 演一国时演的那一国(看的是别国:干预入口变灰、写一句;没在演 / 就是它 = −1) */
function InfoPage({ civ, raw, raster, world, id, year, p, shared, lock }: CountryPanelProps & { p: Polity; shared: Shared; lock: number }) {
  const era = useEra();
  const pending = usePending();
  const step = useStepwiseOn();
  const { ai } = shared;
  const aiOn = useAiOn();
  const shownYear = shownYearOf(p, year, civ.endYear);
  const alive = polityAlive(p, year);
  // 这一年的州数、人口(境内各州的总人口)、各民族的州数
  owners = ownersAt(civ, shownYear, owners);
  const own = owners;
  let n = 0;
  const folk = new Map<number, number>();
  let pop = 0;
  for (let r = 0; r < civ.regions.count; r++) {
    if (own.polity[r] !== id) continue;
    n++;
    pop += regionPopulationAt(civ, r, shownYear);
    const c = own.culture[r];
    if (c >= 0) folk.set(c, (folk.get(c) ?? 0) + 1);
  }
  const folks = [...folk].sort((a, b) => b[1] - a[1]);
  // 时代:按国都所在的州算
  const capSeat = civ.settlements[capitalAt(p, shownYear)];
  const eraNow = civ.development && capSeat && capSeat.region >= 0 ? eraOf(eraLevel(developmentAt(civ.development, shownYear), capSeat.region)) : null;
  const top = folks.length ? civ.cultures[folks[0][0]] : civ.cultures[p.culture];
  const share = folks.length && n > 1 ? Math.round((folks[0][1] / n) * 100) : null;
  // 主体民族(占这国一半以上的州):"更多"里讲它的族名由来、给它起族名(和州面板民族一行的同一套),结果也在面板最下面
  const mainFolk = folks.length && folks[0][1] * 2 >= n ? folks[0][0] : null;
  const folkAi = useRevealAi({ civ, raw, raster, target: mainFolk !== null ? { kind: 'culture', id: mainFolk } : null, lazy: true, what: '族名' });
  const near = useMemo(() => [...neighborsAt(civ, id, shownYear).near], [civ, id, shownYear]);
  // 邦交:宗主、藩属(哪年称臣)、盟国(哪年结盟、共御谁;作者下令的结盟也算)
  const ties = useMemo(() => polityTies(civ, id, shownYear), [civ, id, shownYear]);
  // 立约:这一年还在的约(约名可点,"到哪年",下面一句和哪几国互不侵犯);中立地:这一年参与共建的(州名可点)
  const pacts = useMemo(() => treatiesOfAt(civ, id, shownYear), [civ, id, shownYear]);
  const zones = useMemo(() => zonesOfAt(civ, id, shownYear), [civ, id, shownYear]);
  // 疆域小柱图:和概览"国家"表里的同一份(0 年到结束年份均匀取样的州数),按这国最多时的州数定高
  const hist = polityHistory(civ);
  const spark = hist.years.map((y, i) => ({ year: y, n: hist.spark[id * SPARK_N + i] }));
  const segs = useMemo(() => dynastySegments(civ, p), [civ, p]);
  // 朝代表每行前面那一朝的旗(一朝一面,下标和 segs 一样)
  const dynFlags = useFlags()?.book.eras[id];
  const related = useMemo(() => filterChronicle(fullChronicle(civ), { polity: id }), [civ, id]);
  // "全部 N 件":和编年史页只看这一国时的"全部"同一份(连同历代君主继位),点开就是这么多条
  const allCount = useMemo(() => polityChronicle(civ, fullChronicle(civ), id).length, [civ, id]);
  const upTo = related.filter((e) => e.year <= year + 1e-6);
  const maxN = Math.max(1, hist.peak[id] ?? 0);
  const span = Math.max(1, (p.ended ?? civ.endYear) - p.founded);
  const last = p.ended ?? civ.endYear;
  const di = segs.length > 1 ? dynastyIndexAt(p, Math.min(year, last - 1 / 512)) : 0;
  const cur = year >= p.founded && (year < last || (p.ended === undefined && year >= civ.endYear)) ? di : -1;
  // 来历 / 结局:按史事查是谁灭的
  const end = useMemo(() => {
    for (const a of civ.annals) {
      if (a.kind === 'fall' && a.a === id) return { how: 'fall' as const, by: a.b };
      if (a.kind === 'merge' && a.b === id) return { how: 'merge' as const, by: a.a };
    }
    return null;
  }, [civ, id]);
  // 大迁徙迁来立的国:「来历」写哪一族从哪里迁来
  const trek = useMemo(() => polityTrek(civ, id), [civ, id]);
  const stateFaith = stateFaithAt(civ.religion, id, shownYear);
  const other = (q: number, y: number) => (civ.polities[q] ? <Link to={{ kind: 'polity', id: q }}>{polityName(civ.polities[q], y)}</Link> : null);
  const capitals = p.capitals?.length ? p.capitals : [{ year: p.founded, settlement: p.capital }];
  const popText = pop > 0 ? populationLabel(pop) : '—';
  // 全球大疫:这一年这国在凋敝里(第几年、共几年)、大疫前这国多少人;时代到过更高的写"曾到某某"
  const plague = useMemo(() => pandemicNow(civ, id, shownYear), [civ, id, shownYear]);
  const eraPeak = useMemo(() => {
    if (!eraNow || !capSeat || !pandemicsOf(civ).some((q) => q.year <= shownYear)) return null;
    const e = eraOf(peakEraAt(civ, capSeat.region, shownYear)).era;
    return e > eraNow.era ? e : null;
  }, [civ, capSeat, eraNow, shownYear]);
  const cap = civ.settlements[capitalAt(p, shownYear)];
  const ruler = rulerAt(civ, id, shownYear);
  // 共和国(海洋城邦共和一系,和改制以后的共和、军政府那些年)写"执政"
  const consul = lineageAt(p, shownYear) === 'republic';
  // 这一年谁掌着实权(名义君主照旧在位)、姻亲(最近一门亲 40 年内、那以后没开过战)
  const held = ruler && !consul ? holderAt(civ, id, shownYear) : null;
  const inLaws = useMemo(() => inLawsAt(civ, id, shownYear), [civ, id, shownYear]);
  return (
    <>
      <Acts>
        <Act icon="intervene" primary={lock < 0} act="intervene" disabled={lock >= 0} onClick={() => (setPanelTab('cmd'), setSheet('full'))}>
          干预历史
        </Act>
        <CenterAct world={world} civ={civ} sel={{ kind: 'polity', id }} year={shownYear} />
        <Act icon="rename" act="rename" onClick={() => shared.setRenaming(true)}>
          改名
        </Act>
        <MoreAct>
          <MenuItem icon={<Icon name="link" size={16} />} act="share-moment-link" note={`停在${yearFull(year, era)}`} onClick={() => void copyMomentLink()}>
            复制分享链接
          </MenuItem>
          <MenuItem icon={<Icon name="scroll" size={16} />} act="chronicle" disabled={!allCount} onClick={() => openOverview('chronicle', { polity: id, major: false })}>
            在编年史中查看
          </MenuItem>
          {aiOn && <MenuSep />}
          <AiMenuItem icon={<Icon name="book" size={16} />} act="book" onClick={() => openHistoryBook({ polity: id })}>
            让 AI 写国史
          </AiMenuItem>
          <AiMenuItem icon={<Icon name="sparkle" size={16} />} ain="explain" disabled={ai.busy} onClick={ai.ask}>
            让 AI 讲名字由来
          </AiMenuItem>
          {mainFolk !== null && (
            <>
              <AiMenuItem icon={<Icon name="sparkle" size={16} />} act="culture-explain" disabled={folkAi.ai.busy} onClick={folkAi.ai.ask}>
                让 AI 讲{cultureLabel(civ.cultures[mainFolk])}的族名由来
              </AiMenuItem>
              <AiMenuItem icon={<Icon name="rename" size={16} />} act="culture-suggest" onClick={folkAi.ai.suggest}>
                让 AI 给{cultureLabel(civ.cultures[mainFolk])}起族名
              </AiMenuItem>
            </>
          )}
        </MoreAct>
      </Acts>
      {lock >= 0 && <RoleLockNote civ={civ} me={lock} who={polityName(p, shownYear)} year={shownYear} />}
      <div className="cp-body">
        <Stats items={[]}>
          <Row k="国都">{cap ? <Link to={{ kind: 'settlement', id: cap.id }}>{cap.name}</Link> : <span className="cp-none">无</span>}</Row>
          <FormRow civ={civ} id={id} year={shownYear} />
          {ruler && (
            <Row k={consul ? '执政' : '君主'}>
              <Link to={{ kind: 'person', id: ruler.id }}>{personName(civ, ruler)}</Link>
              <em className="cp-num-note">
                {yearAt(ruler.from ?? ruler.born, era)}
                {consul ? '就任' : '即位'}
              </em>
            </Row>
          )}
          {alive && <KeepRow civ={civ} id={id} year={shownYear} pending={pending} step={step} locked={lock >= 0} />}
          {held && ruler && (
            <Row k="实权">
              <Link to={{ kind: 'person', id: held.x.id }}>{held.x.name}</Link>
              <em className="cp-num-note">
                {heldWho(civ, ruler, held)}，{yearAt(held.g.from, era)}起
              </em>
            </Row>
          )}
          {alive && <PolicyRow civ={civ} id={id} year={shownYear} pending={pending} step={step} locked={lock >= 0} holder={held?.x.name} />}
          <Row k="疆域" className="cp-terr">
            <Spark
              title={`历年州数(最多时 ${maxN} 州)`}
              bars={spark.map((s) => ({
                h: Math.max(1, Math.round((s.n / maxN) * 16)),
                background: rgb(p.color),
                opacity: s.n ? (s.year <= year ? 1 : 0.35) : 0.2,
              }))}
            />
            <span data-stat="州">{n} 个州</span>
          </Row>
          <Row k="人口">
            {popText}
            {plague && plague.pre > pop && <em className="cp-num-note">大疫前约 {populationLabel(plague.pre).replace(/^约\s*/, '').replace(/人$/, '')}</em>}
          </Row>
          <FiscalRow civ={civ} id={id} year={shownYear} />
          <CourtRow civ={civ} id={id} year={shownYear} />
          {eraNow && (
            <Row k="时代" className="cp-era">
              <EraLadder era={eraNow.era} progress={eraNow.progress} />
              <span data-stat="时代">
                {eraName(eraNow.era)}
                <em className="cp-num-note">{Math.floor(eraNow.progress * 100)}%</em>
                {eraPeak !== null && <em className="cp-num-note">曾到{ERAS[eraPeak]}</em>}
              </span>
            </Row>
          )}
          {eraNow && <BoostRow civ={civ} id={id} year={shownYear} pending={pending} step={step} locked={lock >= 0} />}
          {plague && (
            <Row k="近况">
              <button className="ins-link" data-act="slump-chronicle" onClick={() => openOverview('chronicle', { polity: null, major: true, at: Math.floor(plague.year) })}>
                疫后凋敝
              </button>
              <em className="cp-num-note">
                第 {Math.max(1, Math.floor(shownYear) - Math.floor(plague.year))} 年，共 {plague.slump} 年
              </em>
            </Row>
          )}
          <Row k="主体民族">
            {top ? <Link to={{ kind: 'culture', id: top.id }}>{cultureLabel(top)}</Link> : '—'}
            {share !== null && <em className="cp-num-note">{share}%</em>}
          </Row>
          {civ.religion && (
            <Row k="国教">
              {stateFaith && civ.religion.faiths[stateFaith.faith] ? (
                <>
                  <Link to={{ kind: 'faith', id: stateFaith.faith }}>{civ.religion.faiths[stateFaith.faith].name}</Link>
                  <em className="cp-num-note">{yearAt(stateFaith.from, era)}起</em>
                </>
              ) : (
                <span className="cp-none">没有</span>
              )}
            </Row>
          )}
          <PolityThoughtRow civ={civ} id={id} year={shownYear} />
          {ties.liege && (
            <Row k="宗主">
              {other(ties.liege.liege, shownYear)}
              <em className="cp-num-note">{yearAt(ties.liege.since, era)}起称臣</em>
            </Row>
          )}
          {ties.vassals.length > 0 && (
            <Row k="藩属" className="cp-links">
              {ties.vassals.map((v) => (
                <span key={v.id} title={`${yearAt(v.since, era)}起称臣`}>
                  {other(v.id, shownYear)}
                  <em>{yearShort(v.since, era)}</em>
                </span>
              ))}
            </Row>
          )}
          {ties.allies.length > 0 && (
            <Row k="盟国" className="cp-links">
              {ties.allies.map((v) => (
                <span key={v.id} title={`${yearAt(v.since, era)}结盟${civ.polities[v.foe] ? `，共御${polityName(civ.polities[v.foe], shownYear)}` : ''}`}>
                  {other(v.id, shownYear)}
                  <em>{yearShort(v.since, era)}</em>
                </span>
              ))}
            </Row>
          )}
          {inLaws.length > 0 && (
            <Row k="姻亲" className="cp-links">
              {inLaws.map((v) => (
                <span key={v.polity} title={`${yearAt(v.year, era)}结亲`}>
                  {other(v.polity, shownYear)}
                  <em>{yearShort(v.year, era)}</em>
                </span>
              ))}
            </Row>
          )}
          {pacts.length > 0 && (
            <Row k="立约">
              {pacts.map((t) => {
                const others = treatyMembersAt(civ, t, shownYear).filter((q) => q !== id && civ.polities[q]);
                return (
                  <Fragment key={t.id}>
                    <Link to={{ kind: 'treaty', id: t.id }}>{treatyTitle(civ, t.id)}</Link>
                    <em className="cp-num-note">{untilText(treatyPeriod(t, shownYear).until, era)}</em>
                    {others.length > 0 && <span className="cp-vsub">与{others.map((q) => polityName(civ.polities[q], shownYear)).join('、')}互不侵犯</span>}
                  </Fragment>
                );
              })}
            </Row>
          )}
          {zones.length > 0 && (
            <Row k="中立地">
              {zones.map((z, i) => (
                <Fragment key={z.id}>
                  {i > 0 && <span className="cp-vsub" />}
                  <Link to={{ kind: 'region', id: z.region }}>{regionLabel(civ, z.region)}</Link>
                  <em className="cp-num-note">
                    {yearAt(z.from, era)}
                    {z.how === 'peace' ? '议和划出' : `${nationsWord(z.founders.length)}共建`}
                  </em>
                </Fragment>
              ))}
            </Row>
          )}
          <Row k="邻国" className="cp-links">
            {near.length ? (
              near
                .map((q) => civ.polities[q])
                .filter(Boolean)
                .map((q) => (
                  <Link key={q.id} to={{ kind: 'polity', id: q.id }}>
                    {polityName(q, shownYear)}
                  </Link>
                ))
            ) : (
              <span className="cp-none">无</span>
            )}
          </Row>
          {trek ? (
            <Row k="来历">
              {cultureLabel(civ.cultures[trek.M.culture])}自<TrekFrom civ={civ} m={trek.m} />
              {trek.M.dir}徙至此立国
            </Row>
          ) : (p.restores !== undefined && civ.polities[p.restores]) || (p.parent !== undefined && civ.polities[p.parent]) ? (
            <Row k="来历">
              {p.restores !== undefined && civ.polities[p.restores] ? (
                <>复{other(p.restores, civ.polities[p.restores].ended ?? p.founded)}之国</>
              ) : (
                <>叛{other(p.parent!, p.founded)}自立</>
              )}
            </Row>
          ) : null}
          {p.ended !== undefined && (
            <Row k="结局">
              {yearAt(p.ended, era)}
              {end?.how === 'fall' && end.by >= 0 ? <>亡于{other(end.by, p.ended)}</> : end?.how === 'merge' ? <>并入{other(end.by, p.ended)}</> : '亡'}
            </Row>
          )}
          {capitals.length > 1 && (
            <Row k="历任国都" className="cp-links">
              {capitals.map((c, i) => {
                const s = civ.settlements[c.settlement];
                if (!s) return null;
                const now = alive && capitalAt(p, year) === s.id;
                return (
                  <span key={i} className={now ? 'cp-now' : ''}>
                    <Link to={{ kind: 'settlement', id: s.id }}>{s.name}</Link>
                    <em>{yearShort(c.year, era)}</em>
                  </span>
                );
              })}
            </Row>
          )}
        </Stats>
        <RulerList civ={civ} id={id} year={shownYear} />
        {segs.length > 1 && (
          <section className="cp-sec cp-dyns">
            <div className="cp-sec-head">朝代</div>
            <div className="cp-group">
              {segs
                .map((s, i) => (
                  <button
                    key={i}
                    className={`cp-dyn-row${i === cur ? ' on' : ''}`}
                    title={`跳到${spaced(yearAt(Math.ceil(s.from), era))}`}
                    onClick={() => setCivTime({ year: Math.ceil(s.from), playing: false, story: false })}
                  >
                    <span className="cp-dyn-name">
                      {dynFlags?.[i] && <FlagIcon spec={dynFlags[i].spec} w={24} className="cp-dyn-flag" />}
                      {s.name}
                      {i === cur && <em className="cp-badge">当前</em>}
                    </span>
                    <span className="cp-dyn-span">
                      {i === segs.length - 1 && p.ended === undefined ? `${yearShortAt(s.from, era)}起` : yearSpan(s.from, s.to, era)}
                    </span>
                  </button>
                ))
                .reverse()}
            </div>
          </section>
        )}
        <EventList
          civ={civ}
          upTo={upTo}
          empty={year < p.founded ? '尚未立国' : '还没有'}
          more={
            allCount > 0 && (
              <button className="ins-link cp-more" data-act="chronicle" onClick={() => openOverview('chronicle', { polity: id, major: false })}>
                全部 {allCount} 件
              </button>
            )
          }
        />
        <AiBox ai={ai} aiRef={shared.aiRef} />
        <AiBox ai={folkAi.ai} aiRef={folkAi.aiRef} />
      </div>
    </>
  );
}

/** 「实权」一行的小字:宗室 "君主之子""君主之叔父";名臣、大臣 "丞相辅政""丞相专权";大将 "大将军专权" */
function heldWho(civ: Civ, ruler: Person, h: Held): string {
  const { x, g } = h;
  if (g.kind === 'march' || g.kind === 'heir' || g.kind === 'uncle') return `君主之${kinOf(civ, ruler, x) || '宗室'}`;
  const post = (x.posts ?? []).filter((v) => v.from <= g.from).pop()?.title ?? '';
  return `${post}${REGENCY_VERB[g.kind]}`;
}

/**
 * 概况「方针」一行(君主下面):"照君主性格 没定方针" / "扩张 1500 年起" / 单子里的"扩张 待推演"(逐年推演"下一步生效");
 * 点了进方针页(演一国时的别国:只写不点)
 */
function PolicyRow({ civ, id, year, pending, step, locked, holder }: { civ: Civ; id: number; year: number; pending: readonly Pending[]; step: boolean; locked: boolean; holder?: string }) {
  const era = useEra();
  const r0 = policyRow(civ, id, year, pending, step, era);
  // 有人掌着实权:推演照他的性格
  const r = holder && r0.name === '照君主性格' ? { ...r0, name: `照${holder}性格` } : r0;
  return (
    <Row k="方针">
      {locked ? (
        r.name
      ) : (
        <button className="ins-link" data-act="policy" onClick={() => (openCmdPage({ kind: 'policy', back: 'info' }), setSheet('full'))}>
          {r.name}
        </button>
      )}
      {r.tag ? <em className="cr-pending">{r.tag}</em> : <em className="cp-num-note pol-row-note">{r.note}</em>}
    </Row>
  );
}

/**
 * 概况「推一把」一行(时代下面,写法同方针那一行):"快 10 倍 到 1550 年" / "直接进铁器 1500 年" / 单子里的"快 10 倍 待推演";
 * 只在管着的那些年有(没有 = 不出这一行);点了进推一把那一页(演一国时的别国:只写不点)
 */
function BoostRow({ civ, id, year, pending, step, locked }: { civ: Civ; id: number; year: number; pending: readonly Pending[]; step: boolean; locked: boolean }) {
  const era = useEra();
  const r = boostRow(civ, id, year, pending, step, era);
  if (!r) return null;
  return (
    <Row k="推一把">
      {locked ? (
        r.name
      ) : (
        <button className="ins-link" data-act="boost" onClick={() => (openCmdPage({ kind: 'boost', back: 'info' }), setSheet('full'))}>
          {r.name}
        </button>
      )}
      {r.tag ? <em className="cr-pending">{r.tag}</em> : <em className="cp-num-note pol-row-note">{r.note}</em>}
    </Row>
  );
}

/**
 * 概况「王室」一行(君主下面;只在保住王室管着的那些年有,keepInfo.ts):"保住  到 1560 年" / "保住  到燕昭下台" / 单子里的"保住  待推演";
 * 点了打开「我的干预」(演一国时的别国:只写不点)
 */
function KeepRow({ civ, id, year, pending, step, locked }: { civ: Civ; id: number; year: number; pending: readonly Pending[]; step: boolean; locked: boolean }) {
  const era = useEra();
  const r = keepRow(civ, id, year, pending, step, era);
  if (!r) return null;
  return (
    <Row k="王室">
      {locked ? (
        '保住'
      ) : (
        <button className="ins-link" data-act="keep-row" onClick={() => openOverview('interventions')}>
          保住
        </button>
      )}
      {r.tag ? <em className="cr-pending">{r.tag}</em> : <em className="cp-num-note">{r.note}</em>}
    </Row>
  );
}

/** 历代君主:当前这位(这一年在位的;没有 = 这一年之前最近的一位)和前后各两位,新的在上 */
function RulerList({ civ, id, year }: { civ: Civ; id: number; year: number }) {
  const era = useEra();
  const chars = useEdits().characters;
  const rs = peopleIndex(civ).rulers[id] ?? [];
  if (!rs.length) return null;
  let k = 0;
  for (let i = 0; i < rs.length; i++) if ((rs[i].from ?? Infinity) <= year) k = i;
  const cur = rulerAt(civ, id, year);
  const a = Math.max(0, Math.min(k - 2, rs.length - 5));
  const near = rs.slice(a, a + 5).reverse();
  const consul = isConsul(civ, rs[0]);
  return (
    <section className="cp-sec cp-dyns cp-rulers">
      <div className="cp-sec-head cp-events-head">
        <span>{consul ? '历任执政' : '历代君主'}</span>
        <span className="cp-more-links">
          {!consul && (
            <button className="ins-link cp-more" data-act="rulers-lineage" onClick={() => openLineage(id)}>
              世系图
            </button>
          )}
          <button className="ins-link cp-more" data-act="all-rulers" onClick={() => openPeople({ list: 'rulers', polity: id })}>
            全部 {rs.length} 位
          </button>
        </span>
      </div>
      <div className="cp-group">
        {near.map((r) => {
          const on = r === cur;
          const fate = r.fate && r.fate !== 'died' && r.fate !== 'retired' ? rulerFateWord(civ, r) : '';
          // 作者立的君主(人物卡删掉了:名字就是"作者的人物",不再加头像和小字)
          const ac = r.author !== undefined ? chars?.find((c) => c.id === r.author) : undefined;
          return (
            <button key={r.id} className={`cp-dyn-row${on ? ' on' : ''}`} data-person={r.id} onClick={() => setSelection({ kind: 'person', id: r.id })}>
              <span className="cp-dyn-name">
                {ac && <CharAvatar c={ac} size={18} cls="cr-av" />}
                {personName(civ, r)}
                {ac && <em className="cp-num-note">作者的人物</em>}
                {on && <em className="cp-badge">当前</em>}
                {fate && <em className="cp-num-note">{fate}</em>}
              </span>
              <span className="cp-dyn-span">{r.until !== undefined ? yearSpan(r.from ?? r.born, r.until, era) : `${yearShortAt(r.from ?? r.born, era)}起`}</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

/** 时代的小梯子:九格,走过的时代涂上颜色,当前这格从下往上填到走了几成 */
function EraLadder({ era, progress }: { era: number; progress: number }) {
  return (
    <span className="cp-ladder" aria-hidden="true">
      {ERA_COLORS.map((c, i) => (
        <i key={i} style={i < era ? { background: rgb(c) } : undefined}>
          {i === era && <b style={{ height: `${Math.round(progress * 100)}%`, background: rgb(c) }} />}
        </i>
      ))}
    </span>
  );
}
