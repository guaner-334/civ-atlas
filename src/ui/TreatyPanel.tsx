/**
 * 条约卡片(点国家卡片「立约」一行、中立地卡片「来历」里的约名打开;和别的卡片同一套零件,见 panelParts.tsx),按时间轴当前那一年:
 *
 *   顶部  文书图标、约名(可改;没改过照会盟的城起,"丹枫关之约";议和顺带立的写"甲与乙之约")、
 *         "有限竞争之约，2300 年立"(约废了再加"，2344 年废";约满不续"，2380 年约满")、关闭
 *   按钮  编年史(主操作:打开编年史,停在这份约那几年)/ 改名 / 更多(复制分享链接、在编年史中查看)
 *   概况  立约(几国,可点;亡了的下面一句"某国 2332 年亡")、居间(居间那国出使的名臣,小字写哪国什么官;没有居间写"没有")、
 *         会于(会盟的城、那年)、约定("互不侵犯，各守今疆";约还在时下面一句细则;两国之约国界上有山河的"以云隐山为界")、
 *         期限("三十年 到 2330 年，还有 25 年";满了写"2330 年满",续约一次一句)、中立地(有才写,"2301 年设" / "2301–2344 年")、
 *         背约(第一次:谁、哪年伐谁;后面几次一次一句;没有写"还没有")
 *   大事  这份约的立约、续约、背约、约满,它的中立地设立、撤销,徙居、出奔那里的人(最近 5 条,可点)
 */
import { useMemo, useState, type ReactNode } from 'react';
import type { Civ } from '../gen/civ/types';
import { polityName } from '../gen/civ/growth';
import { regionLabel } from '../gen/civ/display';
import { envoyOf, treatyBook, treatyLine, treatyTitle, type TreatyInfo } from '../gen/civ/treatyInfo';
import { fullChronicle } from '../gen/civ/religionText';
import { treatyKey } from '../gen/edits';
import { yearAt, yearFull, yearSpanAt, type Era } from '../gen/era';
import { useEra } from './editsStore';
import { shownYearOf } from './flyTo';
import { openOverview } from './overviewStore';
import { copyMomentLink } from './shareMoment';
import { NameEdit } from './NameEdit';
import { MenuItem } from './PopMenu';
import { Icon } from './icons';
import { treatyEntries, treatyKindWord, termWord } from './treatyRows';
import { Act, Acts, EventList, Link, MoreAct, PanelHead, Row, Stats, SubLine, type DetailProps } from './panelParts';

/** 国家 p 在 year 那一刻的名字(没立国 = 立国那年的,已亡 = 亡国前的);找不到 = 空串 */
function pname(civ: Civ, p: number, year: number): string {
  const P = civ.polities[p];
  return P ? polityName(P, shownYearOf(P, year, civ.endYear)) : '';
}

/** 名臣那一刻的官名(没有 = "名臣") */
function postAt(x: { posts?: { title: string; from: number }[] }, year: number): string {
  let t = '';
  for (const p of x.posts ?? []) if (p.from <= year + 1e-6) t = p.title;
  return t || '名臣';
}

export function TreatyPanel({ civ, raw, id, year, names }: DetailProps) {
  const era = useEra();
  const [renaming, setRenaming] = useState(false);
  const x = treatyBook(civ).treaties[id];
  const all = useMemo(() => fullChronicle(civ), [civ]);
  const entries = useMemo(() => (x ? treatyEntries(civ, x, all) : []), [civ, x, all]);
  if (!x) return null;
  const ended = x.ended !== undefined && year >= x.ended;
  const title = treatyTitle(civ, id);
  // 编年史停在这份约那几年:约废了停在废的那年,还在就停在时间轴这一年
  const chronicle = () => openOverview('chronicle', { polity: x.parties[0], major: false, at: Math.min(civ.endYear, ended ? x.ended! : Math.max(year, x.start)) });
  const upTo = entries.filter((e) => e.year <= year + 1e-6);
  return (
    <div className="cp" data-treaty={id}>
      <PanelHead
        icon={
          <span className="cp-ico" aria-hidden="true">
            <Icon name="treaty" size={22} />
          </span>
        }
      >
        <NameEdit
          k={treatyKey(civ, id)}
          kind="treaty"
          shown={title}
          current={title}
          fallback={treatyTitle(raw, id)}
          names={names}
          big
          editing={renaming}
          onEditing={setRenaming}
          hint="约名,如“丹枫关之约”"
        />
        <SubLine
          parts={[
            treatyKindWord(x),
            `${yearAt(x.start, era)}立`,
            ended && (x.end === 'expire' ? `${yearAt(x.ended!, era)}约满` : `${yearAt(x.ended!, era)}废`),
          ]}
        />
      </PanelHead>
      <Acts>
        <Act icon="scroll" primary act="treaty-chronicle" onClick={chronicle}>
          编年史
        </Act>
        <Act icon="rename" act="rename" onClick={() => setRenaming(true)}>
          改名
        </Act>
        <MoreAct>
          <MenuItem icon={<Icon name="link" size={16} />} act="share-moment-link" note={`停在${yearFull(year, era)}`} onClick={() => void copyMomentLink()}>
            复制分享链接
          </MenuItem>
          <MenuItem icon={<Icon name="scroll" size={16} />} act="chronicle" onClick={chronicle}>
            在编年史中查看
          </MenuItem>
        </MoreAct>
      </Acts>
      <div className="cp-body">
        <Stats items={[]}>
          <TreatyRows civ={civ} x={x} year={year} era={era} />
        </Stats>
        <EventList
          civ={civ}
          upTo={upTo}
          empty="还没有"
          more={
            <button className="ins-link cp-more" data-act="chronicle" onClick={chronicle}>
              在编年史中查看
            </button>
          }
        />
      </div>
    </div>
  );
}

/** 概况的七行 */
function TreatyRows({ civ, x, year, era }: { civ: Civ; x: TreatyInfo; year: number; era: Era | undefined }) {
  const ended = x.ended !== undefined && year >= x.ended;
  const pn = (p: number, y = year) => pname(civ, p, y);
  const polity = (p: number) => (civ.polities[p] ? <Link to={{ kind: 'polity', id: p }}>{pn(p)}</Link> : null);
  // 立约的几国:立约时的,加上续约时才在约里的(不会有,续约只会少);亡了的下面一句
  const parties = x.parties;
  const gone = parties.filter((p) => civ.polities[p]?.ended !== undefined && civ.polities[p].ended! <= year);
  // 居间:居间那国当时在朝的名臣
  const envoy = x.by >= 0 ? envoyOf(civ, x.by, x.start) : null;
  const city = x.settlement >= 0 ? civ.settlements[x.settlement] : undefined;
  const line = x.kind === 'pact' ? treatyLine(civ, x) : -1;
  // 期限:第一期到哪年;续约一次一句(到这一年为止的)
  const first = x.start + x.term;
  const renewals = x.renewals.filter((r) => r.year <= year + 1e-6);
  const live = !ended && year >= x.start;
  const left = (until: number) => (live && year < until ? `，还有 ${Math.max(1, Math.floor(until) - Math.floor(year))} 年` : '');
  const lastIsFirst = renewals.length === 0;
  const noRenew = ended && x.end === 'expire' ? '，不续' : '';
  const termNote = year < first && !ended ? `到 ${yearAt(first, era)}${left(first)}` : `${yearAt(first, era)}满${lastIsFirst ? noRenew : ''}`;
  const zone = x.zone >= 0 ? treatyBook(civ).zones[x.zone] : undefined;
  const zoneOver = zone?.ended !== undefined && year >= zone.ended;
  const breaches = x.breaches.filter((b) => b.year <= year + 1e-6);
  const lapsed = (b: { year: number }) => (x.end === 'lapse' && x.ended !== undefined && Math.abs(x.ended - b.year) < 1e-6 && year >= x.ended ? '，约废' : '');
  const sub = (s: ReactNode) => <span className="cp-vsub">{s}</span>;
  return (
    <>
      <Row k="立约" className="cp-links">
        {parties.map((p) => (
          <span key={p}>{polity(p)}</span>
        ))}
        {gone.length > 0 && sub(gone.map((p) => `${pn(p)} ${yearAt(civ.polities[p].ended!, era)}亡`).join('，'))}
      </Row>
      <Row k="居间">
        {envoy ? (
          <>
            <Link to={{ kind: 'person', id: envoy.id }}>{envoy.name}</Link>
            <em className="cp-num-note">
              {pn(x.by, x.start)}
              {postAt(envoy, x.start)}
            </em>
          </>
        ) : x.by >= 0 ? (
          polity(x.by)
        ) : (
          <span className="cp-none">没有</span>
        )}
      </Row>
      {city && (
        <Row k="会于">
          <Link to={{ kind: 'settlement', id: city.id }}>{city.name}</Link>
          <em className="cp-num-note">{yearAt(x.start, era)}</em>
        </Row>
      )}
      <Row k="约定">
        {x.kind === 'limited' ? '互不侵犯，各守今疆' : line >= 0 ? `互不侵犯，以${civ.places[line].name}为界` : '互不侵犯'}
        {x.kind === 'limited' && !ended && sub('不占对方旁边的无主之地，不收对方的藩属')}
      </Row>
      <Row k="期限">
        {termWord(x.term)}
        <em className="cp-num-note">{termNote}</em>
        {renewals.map((r, i) => {
          const until = r.year + r.term;
          const last = i === renewals.length - 1;
          return (
            <span key={r.annal} className="cp-vsub">
              {r.parties.map((p) => pn(p, r.year)).join('、')}续约{termWord(r.term)}，到 {yearAt(until, era)}
              {last ? (year < until && !ended ? left(until) : noRenew) : ''}
            </span>
          );
        })}
      </Row>
      {zone && (
        <Row k="中立地">
          <Link to={{ kind: 'region', id: zone.region }}>{regionLabel(civ, zone.region)}</Link>
          <em className="cp-num-note">{zoneOver ? yearSpanAt(zone.from, zone.ended!, era) : `${yearAt(zone.from, era)}设`}</em>
        </Row>
      )}
      <Row k="背约">
        {breaches.length ? (
          <>
            {polity(breaches[0].by)}
            <em className="cp-num-note">
              {yearAt(breaches[0].year, era)}伐{pn(breaches[0].against, breaches[0].year)}
              {lapsed(breaches[0])}
            </em>
            {breaches.slice(1).map((b) => (
              <span key={b.annal} className="cp-vsub">
                {pn(b.by, b.year)} {yearAt(b.year, era)}伐{pn(b.against, b.year)}
                {lapsed(b)}
              </span>
            ))}
          </>
        ) : (
          <span className="cp-none">{ended ? '没有' : '还没有'}</span>
        )}
      </Row>
    </>
  );
}
