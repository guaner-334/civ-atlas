/**
 * 国家的朝政:概况里「政体」一行(FormRow)、「朝政」一行(CourtRow)和点进来的朝政页(CourtPage;卡片换页,和钱粮页同一种做法,只看不改)。
 * 议事定下的规矩只从推演结果里读(courtInfo.ts),政体名由已有的制度推出来(gen/civ/polityForm.ts),这一页不改历史。
 *
 *   「政体」一行  政体名(点了换成朝政页)+ 小字哪年起。每个国家都有(够不上议事的小国也能点进朝政页)
 *   「朝政」一行  三格小柱 = 征税的法子(一格地方代收、两格分成、三格朝廷直征)+ 法子(点了换成朝政页)+ 小字:
 *                 分封 N 州 / 割据 N 州(前面橙色小方块)/ 都有写两样;都没有写现在的法子哪年起;没议过写"没议过事"。
 *                 够格议事的国家(州数、立国年数够)都有这一行,不够格又没议过事的小国没有
 *   朝政页        上面一块:第几年、上次议事哪年;政体名(大字)、哪年起、一句为什么叫这个;
 *                 征税、兵制、官制三条分段条(现在那档亮着)叠在一起,共用一条"地方说了算 ↔ 朝廷说了算"的轴,
 *                 每条下面一句(哪年谁定的;征税写各州多交、朝廷多花多少)
 *                 分封:哪位君主哪年起、几州;州名(点了开州卡片)列前几个,「全部」展开;「在地图上看」
 *                 割据:现在的割据一处一行(哪几州、哪年起、多少年);名义上还归本国、一文不交、议没议过削藩;「在地图上看」
 *                 「在地图上看」:填色切到管辖,封地 / 割据的州一直圈亮(管辖填色下圈亮是蓝色),旁边挂小牌子;离开这一页收起
 *                 历次改制:一条时间条(立国到这一年,按政体名分段,现在那段是蓝的)+ 一条一行(新的在上;哪年、从什么变成什么、
 *                 因为哪次议事 / 升格 / 割据);点一条打开编年史、滚到那一年
 *                 历次议事:新的在上;年份、议题、结果标签(办成绿、妥协黄、搁置灰、谈崩红)、编年史那一句(君主名字可点)、
 *                 规矩因此变了的加一行"从此……";点一条打开编年史、滚到那一年
 *                 底部「返回」回到信息页
 */
import { useEffect, useMemo, useState } from 'react';
import type { Civ } from '../gen/civ/types';
import type { ChronicleEntry } from '../gen/civ/chronicle';
import { fullChronicle } from '../gen/civ/religionText';
import { regionLabel } from '../gen/civ/display';
import { yearAt, yearFull, yearShort } from '../gen/era';
import { formChangesAt, polityFormAt, type FormChange } from '../gen/civ/polityForm';
import { CONTROL_COLORS } from '../render/civ/control';
import { useEra } from './editsStore';
import { openInfoPage, setSheet } from './panelStore';
import { getCivHighlight, setCivHighlight, setCivShow, setSelection } from './civView';
import { fillShow } from './mapLayers';
import { openOverview } from './overviewStore';
import { EntryText, Row, rgb } from './panelParts';
import {
  ARMY_SEGS,
  LEVY_NAMES,
  OFFICE_SEGS,
  OUTCOME_KEYS,
  OUTCOME_NAMES,
  TAX_SEGS,
  armySay,
  courtEmpty,
  courtEvents,
  courtRowNote,
  courtView,
  fiefFoot,
  fiefSince,
  formChangeSay,
  formWhy,
  levySay,
  lordFoot,
  lordName,
  mapTagText,
  officeSay,
  ruleSeg,
  type CourtView,
} from './courtInfo';
import './fiscal.css';
import './court.css';

/** 分封那一块先列几个州名 */
const NAMES_FIRST = 7;
/** 割据的颜色(和管辖填色一样) */
const LORD_COLOR = rgb(CONTROL_COLORS[3] as [number, number, number]);

/** 征税的法子:三格小柱 */
function Pips({ tax }: { tax: number }) {
  return (
    <span className="ct-pips" aria-hidden="true">
      {[0, 1, 2].map((i) => (
        <i key={i} className={i <= tax ? 'on' : undefined} />
      ))}
    </span>
  );
}

/** 换成朝政页(手机上卡片拉满) */
function openCourt() {
  openInfoPage('court');
  setSheet('full');
}

/** 概况里「政体」一行:政体名(点了换成朝政页)、哪年起 */
export function FormRow({ civ, id, year }: { civ: Civ; id: number; year: number }) {
  const era = useEra();
  const f = polityFormAt(civ, id, year);
  if (!f) return null;
  return (
    <Row k="政体" className="ct-form-row">
      <button className="ins-link" data-act="court-form" onClick={openCourt} title="看这一国的政体和朝政">
        {f.name}
      </button>
      <em className="cp-num-note">{yearAt(f.since, era)}起</em>
    </Row>
  );
}

/** 概况里「朝政」一行(不够格又没议过事的国家不显示) */
export function CourtRow({ civ, id, year }: { civ: Civ; id: number; year: number }) {
  const era = useEra();
  const v = useMemo(() => courtView(civ, id, year), [civ, id, year]);
  if (!v.shown) return null;
  const fief = v.fiefs.length;
  const lord = v.lordRegions;
  return (
    <Row k="朝政" className="cp-terr ct-row">
      <Pips tax={v.rules.tax} />
      <button className="ins-link" data-act="court" onClick={openCourt} title="看这一国的朝政">
        {LEVY_NAMES[v.rules.tax]}
      </button>
      <em className="cp-num-note">
        {fief > 0 && `分封 ${fief} 州`}
        {fief > 0 && lord > 0 && '，'}
        {lord > 0 && <span className="ct-lord">割据 {lord} 州</span>}
        {!fief && !lord && courtRowNote(v, era)}
      </em>
    </Row>
  );
}

/** 地图上圈亮哪一样 */
type Lit = { what: 'fief' | 'lord'; n: number } | null;

export function CourtPage({ civ, id, year }: { civ: Civ; id: number; year: number }) {
  const era = useEra();
  const v = useMemo(() => courtView(civ, id, year), [civ, id, year]);
  const back = (
    <div className="cp-foot">
      <button className="cp-btn" data-act="court-back" onClick={() => openInfoPage(null)}>
        返回
      </button>
    </div>
  );
  const [lit, setLit] = useState<Lit>(null);
  const lordRegions = useMemo(() => v.lords.flatMap((w) => w.regions), [v.lords]);
  const litRegions = lit?.what === 'fief' ? v.fiefs : lit?.what === 'lord' ? lordRegions : null;
  const tagText = litRegions ? mapTagText(civ, litRegions, lit!.what === 'fief' ? '封地' : '割据') : '';
  const tagCell = litRegions?.length ? civ.regions.seat[litRegions[0]] : -1;
  const litKey = litRegions?.join(',') ?? '';
  // 在地图上一直圈亮(换了年份、州跟着换);离开这一页收起
  useEffect(() => {
    if (!lit) return;
    if (!litRegions?.length) {
      if (getCivHighlight()?.steady) setCivHighlight(null);
      return;
    }
    setCivHighlight({ regions: litRegions, polities: [], year, steady: true, tag: tagCell >= 0 ? { text: tagText, cell: tagCell } : undefined });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lit, litKey, tagText, tagCell]);
  useEffect(
    () => () => {
      if (getCivHighlight()?.steady) setCivHighlight(null);
    },
    [],
  );
  const showOnMap = (what: 'fief' | 'lord') => {
    setCivShow(fillShow('control'));
    setLit((l) => ({ what, n: (l?.n ?? 0) + 1 }));
    // 手机:卡片收到半高,露出地图
    setSheet('half');
  };
  const events = useMemo(() => courtEvents(civ, v), [civ, v]);
  const last = events[0];
  const form = polityFormAt(civ, id, year);
  return (
    <div className="cr-page fs-page ct-page" data-court={id}>
      <div className="cp-body">
        <div className="cp-from fs-top">
          <div className="fs-lbl">
            <span>{yearFull(year, era)}</span>
            <span>{last ? `上次议事 ${yearAt(last.year, era)}` : '没议过事'}</span>
          </div>
          {form && (
            <>
              <div className="ct-gov">
                <b>{form.name}</b>
                <small>{yearAt(form.since, era)}起</small>
              </div>
              <div className="ct-why">{formWhy(form)}</div>
            </>
          )}
          <div className="ct-bars">
            <span className="ct-bk">征税</span>
            <Seg names={TAX_SEGS} on={v.rules.tax} kind="levy" />
            <div className="ct-say">{levySay(v, era)}</div>
            <span className="ct-bk">兵制</span>
            <Seg names={ARMY_SEGS} on={ruleSeg(v.rules.army)} kind="army" />
            <div className="ct-say">{armySay(civ, id, v, era)}</div>
            <span className="ct-bk">官制</span>
            <Seg names={OFFICE_SEGS} on={ruleSeg(v.rules.office)} kind="office" />
            <div className="ct-say">{officeSay(civ, id, v, era)}</div>
            <span />
            <div className="ct-axis">
              <span>地方说了算</span>
              <span>朝廷说了算</span>
            </div>
          </div>
        </div>
        <Fiefs civ={civ} id={id} v={v} onMap={() => showOnMap('fief')} />
        <section className="cp-sec" data-sec="lords">
          <div className="cp-sec-head">
            <span>割据</span>
            {v.lords.length > 0 && (
              <button className="ins-link fs-map" data-act="court-lord-map" onClick={() => showOnMap('lord')}>
                在地图上看
              </button>
            )}
          </div>
          <div className="cp-group fs-group">
            {v.lords.length ? (
              v.lords.map((w) => (
                <div key={w.region} className="fs-li">
                  <i className="fs-dot" style={{ background: LORD_COLOR }} />
                  <span className="fs-k">
                    {lordName(civ, w)}
                    <small>{yearAt(w.start, era)}起</small>
                  </span>
                  <span className="fs-n">
                    {Math.max(0, Math.floor(year) - Math.floor(w.start))}
                    <small>年</small>
                  </span>
                </div>
              ))
            ) : (
              <div className="fs-li">
                <span className="fs-k ct-none">现在没有割据的州</span>
              </div>
            )}
          </div>
          {/* 没议过事的国家,历次议事那一块已经说了什么时候才议,这里不重复 */}
          {(v.lords.length > 0 || v.rules.events.length > 0) && <div className="ct-foot">{lordFoot(civ, id, v, year, era)}</div>}
        </section>
        <Changes civ={civ} id={id} year={year} />
        <Events civ={civ} id={id} events={events} />
      </div>
      {back}
    </div>
  );
}

/** 一条分段条:现在那档亮着(data-levy / data-army / data-office = 第几格) */
function Seg({ names, on, kind }: { names: readonly string[]; on: number; kind: 'levy' | 'army' | 'office' }) {
  return (
    <div className="ct-seg" {...{ [`data-${kind}`]: on }}>
      {names.map((t, i) => (
        <span key={t} className={i === on ? 'on' : undefined}>
          {t}
        </span>
      ))}
    </div>
  );
}

/** 时间条上的一段宽过这么多才写名字 */
const BAR_LABEL = 0.16;
/** 时间条下面:中间那个年份(现在这个政体从哪年起)离两头太近就不写 */
const TICK_EDGE = [0.12, 0.85] as const;

/** 历次改制:一条时间条 + 一条一行(新的在上);点一条打开编年史、滚到那一年 */
function Changes({ civ, id, year }: { civ: Civ; id: number; year: number }) {
  const era = useEra();
  const list = formChangesAt(civ, id, year);
  if (!list.length) return null;
  const t0 = list[0].year;
  const span = Math.max(1e-6, year - t0);
  const segs = list.map((c, i) => ({ c, a: c.year, b: i + 1 < list.length ? list[i + 1].year : Math.max(year, c.year) }));
  const lastAt = (segs[segs.length - 1].a - t0) / span;
  const rows: { c: FormChange; later: boolean }[] = list.map((c, i) => ({ c, later: i + 1 < list.length })).reverse();
  return (
    <section className="cp-sec" data-sec="form-changes">
      <div className="cp-sec-head">
        <span>历次改制</span>
        {list.length > 1 && <span className="cp-count">{list.length - 1} 次</span>}
      </div>
      <div className="ct-tl">
        <div className="ct-tbar">
          {segs.map((s, i) => {
            const w = list.length === 1 ? 1 : (s.b - s.a) / span;
            const cur = i === segs.length - 1;
            return (
              <i key={i} className={cur ? 'cur' : i % 2 ? 'alt' : undefined} style={{ width: `${w * 100}%` }}>
                {w > BAR_LABEL ? s.c.to : ''}
              </i>
            );
          })}
        </div>
        <div className="ct-ticks">
          <span>{yearShort(t0, era)}</span>
          {segs.length > 1 && lastAt > TICK_EDGE[0] && lastAt < TICK_EDGE[1] && (
            <span className="m" style={{ left: `${lastAt * 100}%` }}>
              {yearShort(segs[segs.length - 1].a, era)}
            </span>
          )}
          <span className="r">{yearShort(year, era)}</span>
        </div>
      </div>
      <div className="cp-group fs-group">
        {rows.map(({ c, later }) => (
          <button
            key={c.year}
            className="ct-ev ct-chg"
            data-act="form-change"
            title="在编年史里看"
            onClick={() => openOverview('chronicle', { polity: id, major: false, at: c.year })}
          >
            <span className="ct-y">{yearShort(c.year, era)}</span>
            <span className="ct-ev-top">
              <span className="ct-issue">{c.from ? `${c.from} → ${c.to}` : c.to}</span>
            </span>
            <span className="ct-chg-text">{formChangeSay(civ, id, c, later)}</span>
          </button>
        ))}
      </div>
    </section>
  );
}

/** 分封:哪位君主哪年起、几州;州名列前几个,「全部」展开 */
function Fiefs({ civ, id, v, onMap }: { civ: Civ; id: number; v: CourtView; onMap: () => void }) {
  const era = useEra();
  const [all, setAll] = useState(false);
  const on = v.rules.fiefBy >= 0;
  const n = v.fiefs.length;
  const shown = all ? v.fiefs : v.fiefs.slice(0, NAMES_FIRST);
  return (
    <section className="cp-sec" data-sec="fiefs">
      <div className="cp-sec-head">
        <span>分封</span>
        {n > 0 && (
          <button className="ins-link fs-map" data-act="court-fief-map" onClick={onMap}>
            在地图上看
          </button>
        )}
      </div>
      <div className="cp-group fs-group">
        {on ? (
          <div className="fs-li">
            <span className="fs-k">
              边州封给当地
              <small>{fiefSince(civ, id, v, era)}</small>
            </span>
            <span className="fs-n">
              {n}
              <small>州</small>
            </span>
          </div>
        ) : (
          <div className="fs-li">
            <span className="fs-k ct-none">没有分封</span>
          </div>
        )}
        {n > 0 && (
          <div className="ct-names">
            {shown.map((r, i) => (
              <span key={r}>
                {i > 0 && '、'}
                <button className="ins-link" onClick={() => setSelection({ kind: 'region', id: r })}>
                  {regionLabel(civ, r)}
                </button>
              </span>
            ))}
            {n > NAMES_FIRST && (
              <>
                {!all && <span className="ct-more"> 等 {n} 州</span>}{' '}
                <button className="ins-link" data-act="court-fief-all" onClick={() => setAll(!all)}>
                  {all ? '收起' : '全部'}
                </button>
              </>
            )}
          </div>
        )}
      </div>
      {on && <div className="ct-foot">{fiefFoot(v)}</div>}
    </section>
  );
}

/** 历次议事(新的在上);点一条打开编年史、滚到那一年 */
function Events({ civ, id, events }: { civ: Civ; id: number; events: ReturnType<typeof courtEvents> }) {
  const era = useEra();
  // 编年史里议事那几条(正文、写到的人物)
  const entries = useMemo(() => {
    const m = new Map<number, ChronicleEntry>();
    if (!events.length) return m;
    for (const e of fullChronicle(civ)) if (e.kind === 'council') m.set(e.id, e);
    return m;
  }, [civ, events.length]);
  return (
    <section className="cp-sec" data-sec="councils">
      <div className="cp-sec-head">
        <span>历次议事</span>
        {events.length > 0 && (
          <span className="fs-sum">
            <b>{events.length}</b> 次
          </span>
        )}
      </div>
      <div className="cp-group fs-group">
        {events.length ? (
          events.map((ev) => {
            const entry = entries.get(ev.id);
            return (
              <button
                key={ev.id}
                className="ct-ev"
                data-out={OUTCOME_KEYS[ev.out]}
                title="在编年史里看"
                onClick={() => openOverview('chronicle', { polity: id, major: false, at: ev.year })}
              >
                <span className="ct-y">{yearShort(ev.year, era)}</span>
                <span className="ct-ev-top">
                  <span className="ct-issue">{ev.issue}</span>
                  <span className={`ct-chip ${OUTCOME_KEYS[ev.out]}`}>{OUTCOME_NAMES[ev.out]}</span>
                </span>
                {entry && (
                  <span className="ct-ev-text">
                    <EntryText civ={civ} e={entry} />
                  </span>
                )}
                {ev.then && <span className="ct-ev-then">{ev.then}</span>}
              </button>
            );
          })
        ) : (
          <div className="ct-empty">{courtEmpty()}</div>
        )}
      </div>
    </section>
  );
}
