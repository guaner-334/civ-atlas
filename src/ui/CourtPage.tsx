/**
 * 国家的朝政:概况里「朝政」一行(CourtRow)和点进来的朝政页(CourtPage;卡片换页,和钱粮页同一种做法,只看不改)。
 * 议事定下的规矩只从推演结果里读(courtInfo.ts),这一页不改历史。
 *
 *   「朝政」一行  三格小柱 = 征税的法子(一格地方代收、两格分成、三格朝廷直征)+ 法子(点了换成朝政页)+ 小字:
 *                 分封 N 州 / 割据 N 州(前面橙色小方块)/ 都有写两样;都没有写现在的法子哪年起;没议过写"没议过事"。
 *                 够格议事的国家(州数、立国年数够)都有这一行,不够格又没议过事的小国没有
 *   朝政页        上面一块:第几年、上次议事哪年;征税三档分段条(现在那档亮着)+ 一句话(哪年谁定的、各州多交、朝廷多花多少)
 *                 分封:哪位君主哪年起、几州;州名(点了开州卡片)列前几个,「全部」展开;「在地图上看」
 *                 割据:现在的割据一处一行(哪几州、哪年起、多少年);名义上还归本国、一文不交、议没议过削藩;「在地图上看」
 *                 「在地图上看」:填色切到管辖,封地 / 割据的州一直圈亮(管辖填色下圈亮是蓝色),旁边挂小牌子;离开这一页收起
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
import { CONTROL_COLORS } from '../render/civ/control';
import { useEra } from './editsStore';
import { openInfoPage, setSheet } from './panelStore';
import { getCivHighlight, setCivHighlight, setCivShow, setSelection } from './civView';
import { fillShow } from './mapLayers';
import { openOverview } from './overviewStore';
import { EntryText, Row, rgb } from './panelParts';
import {
  LEVY_NAMES,
  OUTCOME_KEYS,
  OUTCOME_NAMES,
  courtEmpty,
  courtEvents,
  courtRowNote,
  courtView,
  fiefFoot,
  fiefSince,
  levySay,
  lordFoot,
  lordName,
  mapTagText,
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

/** 概况里「朝政」一行(不够格又没议过事的国家不显示) */
export function CourtRow({ civ, id, year }: { civ: Civ; id: number; year: number }) {
  const era = useEra();
  const v = useMemo(() => courtView(civ, id, year), [civ, id, year]);
  if (!v.shown) return null;
  const open = () => {
    openInfoPage('court');
    setSheet('full');
  };
  const fief = v.fiefs.length;
  const lord = v.lordRegions;
  return (
    <Row k="朝政" className="cp-terr ct-row">
      <Pips tax={v.rules.tax} />
      <button className="ins-link" data-act="court" onClick={open} title="看这一国的朝政">
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
  return (
    <div className="cr-page fs-page ct-page" data-court={id}>
      <div className="cp-body">
        <div className="cp-from fs-top">
          <div className="fs-lbl">
            <span>{yearFull(year, era)}</span>
            <span>{last ? `上次议事 ${yearAt(last.year, era)}` : '没议过事'}</span>
          </div>
          <div className="ct-h">征税</div>
          <div className="ct-seg" data-levy={v.rules.tax}>
            {LEVY_NAMES.map((t, i) => (
              <span key={t} className={i === v.rules.tax ? 'on' : undefined}>
                {t}
              </span>
            ))}
          </div>
          <div className="ct-axis">
            <span>地方留得多</span>
            <span>朝廷收得多</span>
          </div>
          <div className="fs-say">{levySay(civ, id, v, era)}</div>
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
        <Events civ={civ} id={id} events={events} />
      </div>
      {back}
    </div>
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
